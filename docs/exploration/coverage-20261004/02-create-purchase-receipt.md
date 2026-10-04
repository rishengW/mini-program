# 全面覆盖勘探 B：createPurchaseOrder + createReceipt（2026-10-04）

> 探索代理：子代理 B ｜ 分支：backup ｜ HEAD：`07b6461`
> 逐行完整读取（无 excerpt 跳读）：
> - `cloudfunctions/createPurchaseOrder/index.js`（516 行）
> - `cloudfunctions/createReceipt/index.js`（799 行）
> - `cloudfunctions/createPurchaseOrder/package.json`（9 行）、`cloudfunctions/createReceipt/package.json`（9 行）
> - Glob 确认两个目录**只有 `index.js` + `package.json`**，无 `config.json` / `config.index.js` / `cloudbaserc` 等任何其他文件
> - Grep 确认依赖：两个函数**只 require `wx-server-sdk` 与 `crypto`**，不依赖 `dataService` / `authService`
>
> 为交叉验证结论另行只读：`getSupplierOrders/index.js`(137)、`confirmSupplierOrder/index.js`(1-40)、`getReports/index.js`(103)、`getReportFileUrl/index.js`、`getReportDetail/index.js`、`dataService/index.js`(1545-1589)、`utils/cloud.js`(200-268)、`updateProductPrice/index.js`(75-138)
>
> 参考但未照抄：`deep-20261004/04-purchase-order-lifecycle.md`、`deep-20261004/05-receipt-abnormal.md`、`rescan-20261004-R3-purchase-cloud.md`、`rescan-20261004-R4-receipt-abnormal-cloud.md`。所有旧结论均已对照当前代码重新验证，标注见 §5。
>
> 只读约束遵守：未修改任何业务代码 / wxml / wxss / 配置 / seed-data；未 commit / push / 切分支。唯一写入即本文件。

---

## 0. 结论摘要

1. **两个云函数完全没有共享模块依赖，五段代码逐字复制。** `getSessionUser`、`hashToken`、`csvField`、`safePathPart`、`getNextVersion` 在两个文件各写一份（`createPurchaseOrder:9-136` vs `createReceipt:9-99`），且**已出现漂移**：`getNextVersion` 两份都改成 CAS，但 `getSessionUser` 是同一份的复制。修任何一处都必须手工同步另一份。
2. **新建 P0 回归：附件 fileID 校验写成 `startsWith`，与 `cloud://` 前缀的 fileID 永远不匹配。** `createReceipt:224` 校验验收照片、`dataService:1560` 校验付款凭证，都用 `id.startsWith('receipts/{订单号}/')` / `startsWith('vouchers/{订单号}/')`；而 `wx.cloud.uploadFile` 返回的 fileID 形如 `cloud://env.xxx/receipts/PO…/123-0.jpg`。→ **带照片提交收货、手动单凭证核销两个功能被完全阻断**（无照片收货仍可提交）。R4 §9 曾建议「改用 `indexOf(photoPrefix) === 8`」，实现时被误改成 `startsWith`。
3. **旧报告的头号缺陷 H2 已修复。** `createPurchaseOrder` 的报表补偿逻辑已从 `catch` 块内联代码抽成模块级函数 `markOrderReportsMissing`（78-105），并用函数级变量 `persistedOrderNo` / `persistedStoreId`（139-141）取代原来 catch 里引用 try 内 `const orderData` 的写法。R3 §0/§5 与 deep-04 §4.1 两处独立记录的「必然 ReferenceError」结论**已过期**。
4. **旧报告 N7 只修了一半。** `txIsFinalBatch` 已移入事务内重算（`createReceipt:453-456`），「并发下永久卡 `partial_received`」闭合；但 `isShortage` 仍只用**事务外**快照预标（340-343）、事务内只在「非最终批」时清零（459-461）、最终批不重算 → 并发最终批下仍会写出**虚假 `shortage` 异常**，并把订单推进 `receipt_abnormal` 死角。
5. **供应商可见性口径已收紧，但订单头仍全量泄漏。** `getSupplierOrders:12` 的隐藏集合已扩为 `['draft','submitted','pending_approval','rejected']`，`confirmSupplierOrder:12-13` 已去掉 `submitted` → **未内部审批通过的订单供应商看不到、也无法确认/发货**（旧报告 S-1/S-5 已闭合）。但 `getSupplierOrders:128` 仍 `...order` 全量下发，`supplier_confirmations`（同单其他供应商的状态与操作者）、`remark`、`audit_remark` 等内部字段继续泄漏。
6. **事务完整性：收货侧最扎实，下单侧报表层是半提交集中区。** `createReceipt` 把 `receipt`+`receipt_item`+`abnormal_record`+`purchase_order.order_status`+`message` 全部塞进一个事务；`createPurchaseOrder` 只把主表+明细放进事务，`message` 与 2 类报表 + `report_file` + `report_version_counter` 全部在事务外，补偿链路（`missing_reports` + 定向通知）完整但**无法覆盖「提交后、打标记前进程被杀」**。
7. **两个函数都没有 `version` 字段、没有唯一索引。** 全库 CAS 只存在于 `report_version_counter` 一张计数器表。`purchase_order` / `receipt` / `receipt_item` 均靠「事务内重读 + 状态白名单 + 手工回滚」弱化防并发，**下单侧的草稿编辑路径连重读都没有**。

---

## 1. 依赖与复制粘贴盘点

### 1.1 依赖（Grep 实测）

```
cloudfunctions/createPurchaseOrder/index.js:3  const cloud = require('wx-server-sdk')
cloudfunctions/createPurchaseOrder/index.js:4  const crypto  = require('crypto')
cloudfunctions/createReceipt/index.js:3        const cloud = require('wx-server-sdk')
cloudfunctions/createReceipt/index.js:4        const crypto  = require('crypto')
```

**不依赖 `dataService` / `authService`** —— 鉴权逻辑完全自实现（见 1.2）。`dataService` 里的 `requireUser` 与本文件里的 `getSessionUser` 是**两套独立实现**。

### 1.2 复制粘贴函数清单

| 函数 | createPurchaseOrder | createReceipt | 是否逐字一致 |
|---|---|---|---|
| `hashToken` | 9-11 | 9-11 | ✅ 一致 |
| `getSessionUser` | 13-39 | 13-39 | ✅ 一致（27 行） |
| `csvField` | 41-47 | 41-46 | ✅ 一致（含防公式注入正则） |
| `safePathPart` | 49-51 | 48-50 | ✅ 一致 |
| `getNextVersion` | 109-136 | 73-99 | ✅ 一致（均已改 CAS） |
| `markOrderReportsMissing` | 78-105 | — | 仅下单侧 |
| `createSubmissionMessage` | 55-73 | — | 仅下单侧 |
| `ensureReceiptMessage` | — | 134-167 | 仅收货侧，**从未被调用** |

合计约 **72 行鉴权/工具代码被复制两份**，加上 `getSessionUser` 在全库 19 份（R3 §1 已确认），一处鉴权逻辑变更需同步 20 处。

### 1.3 package.json（两份均已全读）

| 字段 | createPurchaseOrder | createReceipt |
|---|---|---|
| name | `createPurchaseOrder` | `createReceipt` |
| version | `1.0.0` | `1.0.0` |
| description | `创建采购申请 + 自动生成下单报表` | `收货确认 + 自动生成报表` |
| main | `index.js` | `index.js` |
| dependencies | `wx-server-sdk: ~2.6.3` | `wx-server-sdk: ~2.6.3` |

唯一依赖 `wx-server-sdk ~2.6.3`；`crypto` 是 Node 内置，未声明。**两份均无 `config.json` / `cloudbaserc.json`**（Glob 确认目录内仅 2 个文件）→ 环境变量、超时时间、并发配置只能依赖控制台默认值。两个函数最坏路径都需要 20+ 次串行 DB 调用与 1-4 次 `cloud.uploadFile`，**默认 20s / 30s 超时在报表生成阶段可能不够**（见 §3.5 半提交）。

---

## 2. 逐文件分析：createPurchaseOrder/index.js（516 行）

### 2.1 文件职责

**一句话：创建采购申请（新建 / 编辑草稿 / 存草稿 / 提交审核），并在事务外同步生成「门店下单报表 + 供应商订货汇总」两类 CSV。**

### 2.2 入参字段清单

| 字段 | 类型 | 必填 | 校验规则 | 行号 |
|---|---|---|---|---|
| `authToken` | string | 是 | `getSessionUser` → 空返回 `-401`；角色必须 ∈ `[chef, store_manager, super_admin, purchaser]`，否则 `-403` | 143-147 |
| `orderId` | string | 否（编辑草稿时必填） | 存在（220-225）且 `order_status==='draft'`（227-229）；本店店长可代改本店任何人的草稿（233-239）；编辑时禁止换门店（240-242） | 220-245 |
| `storeId` | string | 全局角色必填 | 非全局角色**无条件丢弃客户端值**，强制取 `user.default_store_id`（212-215）；`store where {store_id, status:1}` 不存在 → `-403` | 211-218, 247-252 |
| `storeName` | string | 否 | **服务端总是覆盖**为库内 `store.store_name`（217, 251）；仅编辑草稿且客户端未传时沿用原单（244） | 217, 244, 251 |
| `orderDate` | string | 否 | 缺省 UTC+8 当日（163-164）；`isDate` 严格 `YYYY-MM-DD` + 回环校验（170-174）；**无下界、无上界**，补录历史日期只打 `backfilled` 标记（165-166） | 163-177 |
| `deliveryDate` | string | 否 | 缺省回退 `orderDate`，再缺省回退当日（169）；必须 `>= actualDate`（175） | 169, 175 |
| `createdBy` | string | 否 | **完全忽略**（154 解构后全文零引用） | 154 |
| `createdByName` | string | 否 | **不落库**，仅写入报表 CSV「经办人」列（422） | 155, 422 |
| `items` | array | 是 | 非空（254）、`>100` 拒绝（261） | 254-261 |
| `items[].productId` | string | 档案商品必填 | trim 后非空（283）；必须存在 `product where {product_id, status:1}`（293-294） | 279, 283, 293-294 |
| `items[].orderQty` | number | 是 | `Number.isFinite` 且 `0 < q <= 1000000`，**无整数校验**（283-284） | 282-285 |
| `items[].productId` 重复 | — | — | 同单不允许重复商品（286-287） | 286-287 |
| `items[].isManual` | bool | 否 | 手动商品强制 `supplierId:''`（290）；数量 `>5` 拒绝（310-312）；**手动与档案禁混单**（314-316） | 288-316 |
| `items[].productName` / `unit` | string | 手动商品必填 | 手动商品必须非空（289）；档案商品一律用库内值覆盖（298-301） | 289, 298-301 |
| `items[].remark` | string | 否 | **无长度限制、无字符清洗** → 直接进 CSV（425, 473） | 401 |
| `remark` | string | 否 | **无长度限制**，落 `orderData.remark` | 339 |
| `orderStatus` | string | 否，默认 `'submitted'` | 白名单 `['draft','submitted']`（257-259） | 158, 257-259 |
| `requestId` | string | 否 | trim 后作为幂等键（183）；空串则**幂等完全不生效** | 183-201 |

**出参结构：**

```js
// 成功（新建/编辑/提交）
{ code: 0, data: { orderId, reportGenerated: true, reportsGenerated: <0|1|2> } }
// 存草稿（410-412）
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0 } }
// 幂等命中（208-210）
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0, idempotent: true } }
// 订单已落库、报表失败（499-507）
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0,
                   reportWarning: '订单已保存，但报表生成失败，请联系管理员处理。' } }
// 失败（全部分支无 data 字段）
{ code: -401, msg }   // 144
{ code: -403, msg }   // 146, 213, 216, 237, 241, 250
{ code: -1,   msg }   // 176, 196, 209, 225, 228, 248, 255, 258, 261, 284, 286, 289, 294, 311, 315, 506, 512, 514
```

### 2.3 读写的云数据库集合

**读：**
- `app_user`（会话校验，17-25）
- `store`（`{store_id, status:1}`，215, 249）
- `product`（`{product_id: _.in(chunk), status:1}`，20 条/块，`limit(100)`，267-274）
- `purchase_order`（幂等查重 185-189；编辑态读取 221-224；事务内幂等复查 367-370）
- `purchase_order_item`（编辑态取旧行，356-359）
- `supplier`（`{supplier_id: _.in(chunk)}`，20 条/块，`limit(100)`，**无 `status:1`**，453-461）
- `report_version_counter`（`getNextVersion` 读，116）

**写：**
- `purchase_order`（新建 add 377-385；编辑 update 355；报表失败补偿 update 80-82）
- `purchase_order_item`（编辑态逐条 remove 360-362；新建 add 388-405）
- `message`（提交消息 57-68；缺报表通知 88-100）
- `report_file`（门店下单报表 429-437；供应商订货汇总 478-486）
- `report_version_counter`（CAS 递增，120-127）
- 云存储 `reports/store/{date}/…csv`、`reports/supplier/{date}/…csv`（428, 477）

**`purchase_order` 关键字段：** `purchase_order_id` / `order_no`（同值）、`store_id` / `store_name`、`order_date` / `delivery_date`、`order_status`、`backfilled`、`is_manual`、`verify_status` / `verify_amount` / `verify_voucher_file_ids`、`request_id`、`remark`、`created_by` / `created_by_name` / `created_at` / `submitted_at` / `updated_at`、`missing_reports`（补偿写）。**无 `version` 字段。**

**`purchase_order_item` 关键字段：** `item_id = orderNo + '_' + (i+1)`、`purchase_order_id`、`product_id`、`product_name_snapshot`、`category_snapshot`、`unit_snapshot`、`supplier_id`、`order_qty`、`is_manual`、`remark`、`created_at`。**无单价 / 无金额 / 无税额。**

### 2.4 事务边界与半提交风险（重点）

```
runTransaction(async transaction => {            353
  if (existingOrder) {                            354
    transaction.doc(order._id).update(orderData)  355   ← 无条件、无 stats 检查
    get 旧明细 limit(1000)                        356-359
    逐条 remove                                   360-362
  } else {                                        363
    事务内复查幂等键 → rollback + return          366-376   ← 仅新建分支有
    transaction.add purchase_order                377-385
  }
  逐条 add purchase_order_item                    388-405
})                                                406
persistedOrderNo / persistedStoreId = ...         407-408
─────────── 事务外 ───────────
createSubmissionMessage（内部 try/catch，永不抛） 414
getNextVersion（CAS，事务外）                     419
cloud.uploadFile + report_file.add               428-437
每个供应商：getNextVersion + uploadFile + add      468-487
─────────── 失败补偿（catch）───────────
markOrderReportsMissing（missing_reports + 定向通知超管） 503
```

**事务内（原子）：** `purchase_order` + `purchase_order_item`。订单头与全部明细同提交同回滚，**正确**。

**事务外（半提交区）：** `message`（提交消息）、`report_version_counter`（CAS 递增）、`cloud.uploadFile`（CSV 文件）、`report_file`（报表元数据）、以及补偿用的 `purchase_order.missing_reports` 更新与缺报表通知消息。

| 失败点 | 结果 | 后果 |
|---|---|---|
| 事务内任一写入失败 | 主表与明细整体回滚 | ✅ 无残留 |
| 事务提交成功、`message` 写入失败 | `createSubmissionMessage` 内部 try/catch（56-72）永不抛 | 订单无提交消息，**静默**（低） |
| 门店下单报表已写、供应商报表生成失败 | 已落库的 `store_order_report` 不回滚；`report_file` 半套 | 打 `missing_reports:true` + 通知超管（503）；**但补生成会追加 `report_id` 完全相同的第二份**（见 §5.6 第 5 条） |
| `getNextVersion` 成功、`uploadFile` 失败 | 计数器已消耗 | **版本号永久跳号**，不复用（低） |
| `uploadFile` 成功、`report_file.add` 失败 | 云存储残留孤儿 CSV | 报表中心看不到该文件，且无清理逻辑（低） |
| **进程在 407 行之后、503 行之前被杀** | 订单已提交、报表缺失、**`missing_reports` 未打标** | **永久缺报表且无任何标记、无任何通知**（中，旧报告 M-9 仍成立） |
| 全部报表成功 | 正常 | ✅ |

**对比 `createReceipt`：** 收货侧把 `message` 放进了同一个事务（`createReceipt:568-582`），下单侧却放在事务外 → **两个函数对「消息是否属于事务」的口径不一致**。

### 2.5 并发 / 幂等

**订单号生成（319-322）：**
```js
const orderNo = orderId || ('PO' + dateStr + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'))
```
毫秒 base36 + 4 位随机 hex，碰撞概率极低，但**无唯一索引兜底**。

**幂等三层防御：**

| 层 | 位置 | 效果 |
|---|---|---|
| 事务外预查 | 183-201 | 按 `(request_id, created_by)` 取最近一条；命中且状态一致 → 直接返回原单号 + `idempotent:true`；命中但状态不一致（存草稿 vs 提交）→ 拒绝（195-197）；例外：命中的正是本次要编辑的草稿（208） |
| 事务内复查 | 366-376 | **仅新建分支**：再查一次，命中则 `transaction.rollback({code:-1,msg})` + `return`，回滚信息由 511-513 透传 |
| 编辑分支 | — | **没有任何复查，也没有条件更新** |

**重复提交 / 双击 / 重复收货会怎样：**

| 场景 | 结果 |
|---|---|
| 同 `requestId`、同类型、串行重试 | 命中幂等，返回原单号（209）✅ |
| 同 `requestId`、不同操作类型（存草稿→提交） | 拒绝「与本次操作类型不一致」（196）✅（前端键本身已拼入 orderStatus，正常流程不会命中） |
| 同 `requestId` 并发双击 | 事务内复查命中，一方回滚报「检测到重复建单」（371-374）✅ —— **但前提见 §5.6 第 4 条** |
| 两个不同 `requestId` 同时提交同一草稿 | **无任何拦截**：两份都走到 355 的无条件 update，两份都生成报表（见 §5.6 第 1 条） |
| `requestId` 为空 / 未传 | 幂等**完全不生效**（184 `if (trimmedRequestId)`） |
| 前端未传 `orderId`、直接新建重复单 | 无任何拦截（业务层允许） |

**CAS 实现（`getNextVersion`，109-136）：** 标准「读旧值 → 条件更新 `where({_id, count: current})` → 判 `updated===1`」，最多 5 次重试；计数器不存在时 `add({_id, count:1})`，撞 `_id` 则重试走 CAS。写法正确（旧报告 R4 §6.3 对 `createPurchaseOrder` 侧的同型问题已在此闭合）。
唯一残留：若计数器文档存在但 `count` 为 `null`/`NaN`/负数（118 判空失败），会落到 `add` 分支必然撞 `_id`，5 次后抛 `计数器更新失败` → 报表整体失败 → 打 `missing_reports`。低。

### 2.6 权限与数据可见性

| 角色 | 能否建单 | 门店范围 |
|---|---|---|
| `chef` | ✅ | 仅 `default_store_id`（212-218） |
| `store_manager` | ✅ | 仅本店；且可代改/代提交本店任何人的草稿（233-239，#18 拍板） |
| `purchaser` / `super_admin` | ✅ | 任意有效门店（247-252），但编辑草稿时禁止换门店（240-242） |
| `supplier` | ❌ `-403`（145-147） | — |

**非全局角色的 `storeId` / `storeName` 被无条件丢弃并从库重取**（212-218）→ 客户端无法伪造门店归属。

**供应商能否看到未内部审批通过的订单 —— 本次复核结论：看不到。**
- `createPurchaseOrder` 在 `orderStatus==='submitted'` 时**同步生成供应商订货汇总报表**（464-489，`report_scope:'supplier'`），即**报表文件在内部审批通过前就已存在**；
- 但 `getSupplierOrders:12` 的隐藏集合为 `['draft','submitted','pending_approval','rejected']` → 供应商订单列表看不到；
- `confirmSupplierOrder:12-13` 的 `CONFIRMABLE`/`SHIPPABLE` 白名单**不含 `submitted`** → 无法确认/发货；
- `getReports`（49-66）对 `supplier` 角色直接 `-403`，`getReportFileUrl:49-53` / `getReportDetail:72-76` 也不给 supplier → **供应商没有任何通道能拿到这些报表文件**。
- 结论：**「提交即生成供应商报表」与「供应商看不到未审批单」两条规则共存，报表文件是内网可见的孤儿资产**，无实际泄漏路径。属设计冗余而非漏洞。

### 2.7 金额 / 数量计算

**采购单域完全没有金额。** `purchase_order_item` 落库字段无 `unit_price` / `amount` / `tax`，`purchase_order` 无合计字段；两类报表 CSV 也不含金额（423, 471 只报商品/分类/单位/数量/备注）。价格在收货环节才快照（`createReceipt:361-374`）。这是 deep-04 §5.1 已确认的显式设计决策，本次复核**仍然成立**。

**数量处理：**
- 下单量校验：`0 < orderQty <= 1000000`、`Number.isFinite`（283-285），**允许小数、无整数校验**（`3.5` 件可入库）。
- 单商品种类上限 100（261）；手动商品 5 个（310-312）；手动与档案禁混单（314-316）。
- **负数 / 零值**：`qty <= 0` 全部拒绝（283-284）✅。
- **超大值**：上限 1000000（283）✅，但无「单商品 × 全单合计」的上限。
- 手动商品强制 `supplierId:''`（290）→ 该类商品的行归入 `unknown` 分组并被 `if (sid === 'unknown') continue`（465）跳过 → **无默认供应商的档案商品同样不进任何供应商订货报表**（见 §5.6 第 6 条）。

**无四舍五入问题**（本域无金额）。

### 2.8 本文件问题（详见 §5.6）

`csvField` 防公式注入正则不完整（45）；编辑草稿路径无条件更新 + 无幂等复查（355, 356-362）；幂等命中分支不回查 `missing_reports`（209）；`rollback` 后 `return` 的语义不确定（373-374）；供应商查询缺 `status:1`（455）；`report_id` 无查重导致补生成重复（431, 480）；`event.createdBy` 完全忽略（154）；`remark`/`createdByName` 无长度限制（339, 422）；进程被杀窗口（407→503）。

---

## 3. 逐文件分析：createReceipt/index.js（799 行）

### 3.1 文件职责

**一句话：门店验收采购到货（支持分批），登记四类异常、推进订单状态，并按验收结果生成 4 类收货报表。**

### 3.2 入参字段清单

| 字段 | 类型 | 必填 | 校验规则 | 行号 |
|---|---|---|---|---|
| `authToken` | string | 是 | `getSessionUser` → `-401`；角色必须 ∈ `[store_manager, super_admin, purchaser]`，否则 `-403`（**chef 被天然排除**） | 171-173 |
| `purchaseOrderId` | string | 是 | 缺失 `-1`（191-193）；必须存在（228-233）；`order.store_id` 与本次 `storeId` 必须一致（236-238）；`order_status` 必须 ∈ `[approved, report_generated, partial_received]`（239-241） | 228-244 |
| `storeId` / `storeName` | string | 是 | 非全局角色强制取 `default_store_id`（184-190）；`store where {store_id, status:1}` 不存在 → `-403`；`storeName` 一律从库取 | 183-199 |
| `receivedBy` | string | 否 | **服务端覆盖**为 `user.name \|\| user.username`（243） | 178, 243 |
| `overallRemark` | string | 否 | **无长度限制**，落 `receipt.overall_remark` | 179, 482 |
| `photoFileIds` | array\<string\> | 否，默认 `[]` | 必须数组（216-218）、`>9` 拒绝（219-221）、**每项必须 `startsWith('receipts/{purchaseOrderId}/')`**（223-226）——见 §0.2，**此校验与真实 fileID 形态冲突** | 216-226 |
| `items` | array | 是 | 非空（200-202）、`>50` 拒绝（203-207） | 200-207 |
| `items[].orderItemId` | string | 是 | 必须能映射到库内订单行（277-279）；同批内不允许重复（278） | 274-281 |
| `items[].productId` / `productName` / `unit` | string | 是 | **要求客户端传真值**（208-210），但随后**全部被库内订单行值覆盖**（294-299）→ 过严 + 报错文案误导 | 208-211, 291-301 |
| `items[].receivedQty` | number | 是 | `typeof === 'number'`（210）、`Number.isFinite`、`>= 0`（210, 285）；**允许小数、无整数校验**；单行可 0 | 285-287 |
| `items[].orderQty` | number | 是 | `typeof === 'number'` + `Number.isFinite`（211），**随后被库内 `order_qty` 覆盖**（282） | 211, 282 |
| `items[].receivedQty` 累计 | — | — | `历史累计 + 本批 > 下单量` → 拒绝（事务外 288-290 + 事务内 442-446 权威） | 288-290, 442-446 |
| `items[].isShortage` | bool | 否 | 客户端可预置 true，服务端**只在最终批判定**，非最终批强制清零（340-343, 459-461） | 61, 340-343 |
| `items[].isQualityIssue` / `isWrongItem` | bool | 否 | **完全客户端可控，服务端零校验、零二次确认** | 62-63 |
| `items[].isMissingPrice` | bool | 否 | 由服务端派生，客户端值被覆盖 | 65, 395-397 |
| `items[].priceSnapshot` / `payableFlag` / `remark` | — | — | 价格与可付款资格**完全服务端重算**（375-399）；`remark` 无长度限制，落库并进 CSV | 391-392, 510 |
| `receiptDate` | string | 否 | 严格 `YYYY-MM-DD` 格式校验（322-329），不通过则取服务端 UTC+8 当日；**无下界、无上界**（任意历史/未来日期可入库） | 320-329 |
| `requestId` / 任何幂等键 | — | — | **不存在**：解构（174-182）中无此字段，`receipt` 表也无幂等字段 | — |

**出参结构：**
```js
{ code: 0, data: {
    receiptId,                       // 'RCP' + Date.now() + 6 位随机 hex
    reportsGenerated: <0..4>,
    reportWarning: string,           // '' 或 '报表生成失败，请联系管理员处理。'
    hasAbnormal: boolean,
    abnormalTypeNames: string[],
    priceReportsSkipped: boolean     // = hasAbnormal，语义含糊（见 §5.7 第 9 条）
  } }
{ code: -1, msg }   // 788 RECEIPT_EXISTS / 791 ORDER_NOT_RECEIVABLE / 794 OVER_RECEIVE / 192,195,201,206,214,217,220,225,233,237,240,244,253,279,286,289,308,317,797 兜底
{ code: -401, msg } // 172
{ code: -403, msg } // 173, 185, 188, 198, 244
```

### 3.3 读写的云数据库集合

**读：** `app_user`（17-25）；`store`（187, 197，`{store_id, status:1}`）；`purchase_order`（228-231，事务内重读 410）；`purchase_order_item`（248-251，`limit(1000)`）；`receipt_item`（事务外历史 264-267，事务内历史 428-431，均 `limit(1000)`）；`receipt`（批次计数 311-314，事务内 466-469）；`supplier_product_price`（361-364，`{product_id: _.in(chunk), effective_date: _.lte(receiptDate)}`，`limit(1000)`）；`supplier`（595-599, 669-675）；`report_version_counter`。

**写：** `receipt`（474-488）；`receipt_item`（490-513）；`abnormal_record`（533-549）；`purchase_order.order_status`（555-558）；`message`（568-582，**事务内**）；`report_file`（612-621, 645-655, 694-703, 729-738）；`report_version_counter`；补偿写 `purchase_order.missing_reports`（748-750）与 `receipt.missing_reports`（752-754）+ 缺报表通知消息（757-768）。

**关键字段：**
- `receipt`：`receipt_id`、`purchase_order_id`、`store_id` / `store_name`、`receipt_date`、`backfilled`、`received_by`、`receipt_status`（`abnormal`|`completed`）、`overall_remark`、`photo_file_ids`、`batch_no`、`is_final`、`missing_reports`、`created_at`。**无 `version`、无幂等键。**
- `receipt_item`：`receipt_item_id = receiptId + '_' + (i+1)`、`receipt_id`、`purchase_order_item_id`、`product_id` / `product_name` / `supplier_id` / `unit_snapshot`、`received_qty`、`order_qty_snapshot`（**整单下单量，非本批应到量**）、`price_snapshot`、`payable_flag`、`is_manual`、`is_shortage` / `is_quality_issue` / `is_wrong_item`、`remark`、`created_at`。**不落 `is_missing_price`。**
- `abnormal_record`：`abnormal_id = receiptId + '_' + (i+1) + '_' + type`、`receipt_id`、`purchase_order_id`、`product_id`、`supplier_id`、`store_id` / `store_name`、`type`、`description`、`status:'pending'`、`resolution:''`、`created_at`、`updated_at`。**不落数量 / 单价 / 金额 / `receipt_item_id`。**

### 3.4 事务边界与半提交风险（重点）

```
runTransaction(async transaction => {           409
  事务内重读订单 → RECEIPT_EXISTS / ORDER_NOT_RECEIVABLE   410-421
  事务内重查全部订单行的历史实收（limit 1000）              426-437
  事务内超收复查 → OVER_RECEIVE                      438-447
  事务内重算 txIsFinalBatch                           451-456
  非最终批 → 强制清零全部 isShortage                   459-461
  重算 hasAbnormal / abnormalTypeNames                462-463
  事务内重算 txBatchNo = 已提交收货单数 + 1             466-472
  transaction.add receipt                             474-488
  transaction.add receipt_item × N                    490-513
  transaction.add abnormal_record × M                 533-549
  transaction.update purchase_order.order_status       555-558
  transaction.add message                             568-582     ← 消息在事务内
})                                                   583
─────────── 事务外 ───────────
批量查供应商名                                       592-600
报表1 门店收货（无价）      getNextVersion + upload + add   604-622
报表2 门店带价（仅可付款行）                       628-657
报表3 供应商到货（无价）      按供应商分组                 678-705
报表4 供应商带价账单                            708-740
失败补偿：missing_reports ×2 + 定向通知超管          741-773
```

**事务内（原子）：** `receipt` + `receipt_item` + `abnormal_record` + `purchase_order.order_status` + `message`。这是全仓事务最完整的一处，**收货数据与站内消息的原子性成立**（对比下单侧消息在事务外）。

**事务外（半提交区）：** 与下单侧完全同型 —— `report_version_counter` CAS、`cloud.uploadFile` × 1-4、`report_file` × 1-4，以及补偿写。

| 失败点 | 结果 |
|---|---|
| 事务内任一写入失败 | 5 类写入整体回滚，订单状态**不会**被推进 | ✅ |
| 事务提交成功、报表全部失败 | `reportWarning` + 补偿打 `missing_reports`（订单与收货单各一处）+ 定向通知超管 → `receive-list` 可见补生成入口 | ✅ 补偿链路完整 |
| 报表 1 成功、报表 2 失败 | 已落库的报表 1 不回滚 → `report_file` 半套（缺带价账单） | 打 `missing_reports`；补生成**追加**而非替换（见 §5.7 第 7 条） |
| `getNextVersion` 成功、`uploadFile` 失败 | 版本号永久跳号 | 低 |
| `uploadFile` 成功、`report_file.add` 失败 | 云存储孤儿 CSV | 低 |
| **进程在事务提交后、747 行之前被杀** | 收货已提交、报表缺失、`missing_reports` 未打标 | **永久缺报表无标记**（中，同下单侧） |
| **客户端已上传照片、事务回滚** | 云存储 `receipts/{orderId}/` 下残留孤儿照片 | 全仓无 `receipt.photo_file_ids` 的删除路径（R4 §7.3 仍成立） |

### 3.5 并发 / 幂等

**核心事实：本函数完全没有幂等键。** 解构（174-182）中无 `requestId`，`receipt` 表也无幂等字段，`receipt_id = 'RCP' + Date.now() + randomBytes(3)`（331）——`Date.now()` 毫秒级 + 6 位随机 hex，碰撞概率极低，**但数据库无唯一约束**。

**三层已有的并发防御：**

| 层 | 位置 | 拦截什么 |
|---|---|---|
| 事务外订单状态 | 316-318 | 仅 `received` |
| 事务内订单状态 | 410-421 | `received` → `RECEIPT_EXISTS`；非白名单 → `ORDER_NOT_RECEIVABLE` |
| 事务内累计超收 | 438-447 | `历史累计 + 本批 > 下单量` → `OVER_RECEIVE` |

**重复提交 / 并发双击 / 重复收货会怎样：**

| 场景 | 结果 |
|---|---|
| 订单已 `received`，再点提交 | `RECEIPT_EXISTS` → 友好提示 ✅ |
| 订单 `partial_received`，**重复提交同一批** | ⚠️ **不被拦**：`历史累计 + 本批 <= 下单量` 时校验通过 → 生成第二张收货单（`batch_no` 递增至 2）、重复消息、重复报表、重复异常台账。见 §5.7 第 1 条 |
| 并发双击（同批） | 同上。两个事务的 `receipt_item` 写入不互相冲突，唯一可能的串行化点是 556 的 `purchase_order` 更新 → **依赖 SDK 的写冲突重试，无显式 CAS** |
| 并发最终批（应收 10，T1 收 3、T2 收 7） | T2 事务内重读历史 → `txIsFinalBatch=true` ✅（已修）；**但 `isShortage` 已按事务外快照预标为 true 且最终批不清零** → 产生一条虚假短收异常，并把订单推进 `receipt_abnormal`。见 §5.7 第 2 条 |
| 批次号并发 | `txBatchNo = 已提交收货单数 + 1`（466-471）在事务内读快照 → 两个并发事务各读到同一 count → **`batch_no` 重号**。见 §5.7 第 3 条 |
| `receipt_id` 碰撞 | 毫秒 + 6 位随机 hex，理论可能，无唯一索引兜底 |

**`batch_no` 重号的注释与实现不符**：465 行注释称「批次号在事务内按已提交收货单数生成，避免并发重号」——事务内读取的是**快照**，不保证跨事务唯一。R4 §6.3 的判断仍然正确。

### 3.6 权限与数据可见性

| 角色 | 能否收货 | 门店范围 |
|---|---|---|
| `store_manager` | ✅ | 仅本店（184-190 + 244 二次校验） |
| `purchaser` / `super_admin` | ✅ | 任意（但 `order.store_id` 必须等于传入的 `storeId`，236-238） |
| `chef` | ❌ `-403`（173） | — |
| `supplier` | ❌ `-403`（173） | — |

**服务端权威化做得彻底（保持旧报告结论）：** `productId` / `productName` / `supplierId` / `unit` / `orderQty` 全部由订单行覆盖（291-301）；`receivedBy` 用库内用户名（243）；`priceSnapshot` 与 `payableFlag` 完全重算（375-399）；门店名从库取（199）；`storeId` 非全局角色被强制覆盖（186）。客户端唯一能影响业务结果的输入是 `receivedQty`（实收数）与 `isQualityIssue` / `isWrongItem` / `remark`（异常勾选与备注）——**其中异常勾选零校验**（见 §5.7 第 5 条）。

**供应商可见性：** `createReceipt` 本身不面向 supplier（角色白名单已排除）。收货生成的 `supplier_receipt_report` / `supplier_receipt_price_report` 写入 `report_file`，但 `getReports` / `getReportFileUrl` / `getReportDetail` 对 supplier 角色一律 `-403`，供应商侧统一走 `getSupplierReceipts`（按 `supplier_id` 过滤）→ **无供应商越权下载通道**。

### 3.7 金额 / 数量计算

**单价来源（P1-11 已落地）：** `supplier_product_price where {product_id: _.in(20条chunk), effective_date: _.lte(receiptDate)} limit(1000)`（361-364）→ 按 `(supplier_id|product_id)` 分组取 `effective_date` 最新一档，同日多行优先 `is_current===1`（366-372）→ `priceMap[key] = Number(price) || 0`（373）。
- 旧报告 R4 §2.1 描述的 `is_current:1` + `limit(100)` 写法**已被替换**（代码已变化）。
- 取价规则与 `updateProductPrice:103-131` 的写入口径自洽：`effective_date` 落库为 `YYYY-MM-DD` 字符串（`updateProductPrice:123`），故 `_.lte(字符串)` 与 `localeCompare` 比较正确。
- `updateProductPrice:77-79` 强制 `price > 0` → **系统内不存在合法 0 元价**，`priceSnapshot <= 0` 确实等价于「无价格行」（R4【待核实】#5 可回收）。
- `updateProductPrice:106-115` 在事务内先把旧 `is_current:1` 置 0 再插入新行 → 每个 `(supplier, product)` 至多一条当前价（R4【待核实】#2 可回收，**仅限经该函数写入的行**；seed / import 数据不受此约束）。

**可付款资格（P1-10 已落地）：**
```js
const hardAbnormal = abnormalTypes.some(t => t !== 'shortage')
if (item.isManual)            item.payableFlag = false                       // 387-388
else                          item.payableFlag = !hardAbnormal && priceSnapshot > 0   // 392
```
旧报告的「`item.payableFlag !== false`」客户端压低分支**已删除** ✅。少货不排除付款（按实收计价，B4 拍板）；质量 / 错货整行剔出付款；缺价行不付款 + 生成 `missing_price` 异常。

**缺失：** `missing_price` 的触发条件 `!item.isManual && priceSnapshot <= 0 && item.supplierId && item.receivedQty > 0`（395）**仍要求 `supplierId` 非空** → 无默认供应商的档案商品**既不进带价账单、也不生成任何异常**，完全静默（R4 N4 仍成立）。

**四舍五入（两处带价报表，口径一致）：**
```js
const subtotal = Math.round(item.receivedQty * price * 100) / 100   // 逐行先取整到分
totalAmount  = Math.round((totalAmount + subtotal) * 100) / 100     // 累加后再取整
csv += [..., csvField(subtotal.toFixed(2))]
```
（638-639, 721-722）→「各行小计之和 = 合计」自洽，无尾差调整行。与 `getSupplierReceipts:109` 现算公式一致。

**数量处理：**
- 负数拒绝（210, 285）；非有限数拒绝（210-211）；单行 0 允许，整批必须至少一行 `>0` 或有异常标记（304-309）✅
- **小数无整数校验**（`3.5` 件可入库）；**无上限**（受 `orderQty` 约束间接限界）
- **裸浮点比较**：455 行 `txHistoryQty[key] + thisQtyMap[key] >= Number(oi.order_qty)`、288 行 `historyQty + receivedQty > orderQty` 均无容差 → 分批累加 `0.1 + 0.2` 类场景可能判不出「收齐」，订单停在 `partial_received`
- **`order_qty_snapshot` 存整单下单量**（501），非本批应到量 → 下游 `supplier-receipts.js:53` 用 `receivedQty !== orderQty` 判异常，分批场景系统性误报（R4 §8.4 仍成立）
- **超大值**：客户端可传 `1e308` 的 `receivedQty`，由 442 的超收校验兜底；`orderQty` 由库内值覆盖 → 安全

### 3.8 本文件问题（详见 §5.7）

照片 fileID `startsWith` 校验与 `cloud://` 形态冲突（224）；无幂等键导致重复收货（174-182, 331）；`isShortage` 最终批不重算（340-343 vs 459-461）；`batch_no` 快照计数（466-471）；`isQualityIssue`/`isWrongItem` 零校验（62-63）；`missing_price` 无供应商行静默（395）；`receipt_item` 不落 `is_missing_price`（490-513）；`abnormal_record` 不落数量/金额（533-549）；短收描述用本批数量（524）；`ensureReceiptMessage` 死代码（134-167）；`receiptDate` 无上下界（320-329）；`overallRemark`/`remark` 无长度限制。

---

## 4. package.json 与目录结构

| 项 | createPurchaseOrder | createReceipt |
|---|---|---|
| 目录内容（Glob 实测） | `index.js`, `package.json` **仅此两个文件** | 同 |
| `config.json` / `config.index.js` / `cloudbaserc.json` | **无** | **无** |
| 依赖 | `wx-server-sdk: ~2.6.3`（唯一） | `wx-server-sdk: ~2.6.3`（唯一） |
| `crypto` | Node 内置，未声明 | 同 |
| `version` | `1.0.0`（两份从未随代码演进 bump） | 同 |
| 共享模块 | **无** | **无** |

**影响：** 没有 `config.json` → 无法在代码中声明超时时间、并发实例数、环境变量。`createReceipt` 最坏路径为「会话 + 门店 + 订单 + 订单行 + 历史 ×2 + 批次 + 价格分块 + 供应商名 ×2 + 事务内 5 类写入 + 4 类报表（各含 CAS + 上传 + add）」≈ **30+ 次串行网络调用**；`createPurchaseOrder` 约 15-25 次。在微信云开发默认超时（云函数 20s，控制台可调至 60s）下，**报表阶段超时会导致订单/收货已提交但报表缺失**，且超时点恰好落在补偿标记之前（见 §5.6 第 8 条、§5.7 第 8 条）。

---

## 5. 旧报告结论复核

标注：**仍成立** = 当前代码原样存在；**代码已变化** = 旧报告描述的实现已被改写；**旧报告判断有误** = 旧报告的结论本身不成立。

### 5.1 已被修复 / 代码已变化的旧结论

| 旧编号 | 旧结论 | 判定 | 当前证据 |
|---|---|---|---|
| **R3 §0/§5 H2、deep-04 §4.1、controller-20261003 H14** | `createPurchaseOrder` catch 内引用 try 内 `const orderData` → 必然 `ReferenceError`，缺报表通知永远写不进去 | **代码已变化（已修复）** | 补偿逻辑抽成模块级 `markOrderReportsMissing`（78-105），函数级变量 `persistedOrderNo`/`persistedStoreId`（139-141）承载；注释 75-77 明确说明原缺陷成因 |
| **R3 M4 / P1-5（部分）** | 下单幂等只有事务外一层查重 | **代码已变化** | 新增事务内复查（366-376）+ 回滚信息透传（511-513）+ 状态一致性校验（195-197） |
| **R4 N28** | 价格查询 `.limit(100)` 截断 → 误报 missing_price | **代码已变化** | 改为 `effective_date: _.lte(receiptDate)` + `limit(1000)`（361-364） |
| **deep-04 §5.2 / R4 §2.1** | 取价只看 `is_current` 标志 | **代码已变化（P1-11）** | 取 `effective_date <= 收货日` 的最新一档（357-372） |
| **R3 P1-9 / M1（前半）** | `payableFlag` 客户端可压低（`item.payableFlag !== false`） | **代码已变化（P1-10）** | 该分支已删除，完全服务端裁决（392） |
| **R4 N7（前半）** | `isFinalBatch` 在事务外算 → 并发卡死 `partial_received` | **代码已变化（P0-3，只修一半）** | `txIsFinalBatch` 已移入事务（451-456）；但 `isShortage` 未同步重算 |
| **deep-04 §4.3 / R3 M5** | 全库无 CAS，唯一性无保障 | **代码已变化** | 两个函数的 `getNextVersion` 均已改标准 CAS（`createPurchaseOrder:115-124`、`createReceipt:78-86`） |
| **deep-04 §7.1 S-1（下单侧）、R3 §3.3 S-5** | 供应商可见 `submitted` 订单、可在审批前确认发货 | **代码已变化（已修复）** | `getSupplierOrders:12` 隐藏集合含 `submitted`；`confirmSupplierOrder:12-13` 白名单已去掉 `submitted` |
| **R4 §9 L3** | 照片只校验子串包含（`includes`） | **代码已变化（但改成更糟的形态）** | 现用 `startsWith`（224），从「子串可穿越」变成「合法值也全部拒绝」 |
| **R3 待核实 #3** | `created_at` 回读形态未知 | **仍无法确认**（不在本任务范围） | — |
| **R4 待核实 #2** | `supplier_product_price` 唯一性 | **可回收（部分）** | `updateProductPrice:106-115` 事务内保证每 `(supplier, product)` 至多一条 `is_current:1`；但不保证 `effective_date` 唯一，seed/import 数据不受约束 |
| **R4 待核实 #5** | 0 元价是否与「未配价」不可区分 | **可回收（可区分）** | `updateProductPrice:77-79` 强制 `price > 0`，故 `<=0` 即无价 |
| **R4 R15 / N13** | `ensureReceiptMessage` 死代码 | **仍成立** | 定义于 134-167，全库 Grep 无任何调用点 |
| **R3 P2-15 / R4 待核实** | `receiptDate` 由客户端决定 | **仍成立** | 320-329 只校验格式，无上下界 |

### 5.2 仍然成立的旧结论（当前代码原样存在）

- **`purchase_order` 无 `version` 字段、无 `(request_id, created_by)` 唯一索引**（deep-04 §4.3）：`Grep version` 在两个文件中只命中 `report_version_counter` 与 `report_file.file_version`。注释 365 自认「终极防线是 (request_id, created_by) 唯一索引，见修复计划 B6-2」。
- **编辑草稿路径无条件更新、无幂等复查**（R3 M3 / deep-04 H-1）：355 `doc(_id).update()` 无 `stats` 检查、无 `order_status` 条件；356-362 删旧行无状态条件；366-376 的幂等复查**只在 else 新建分支**。
- **幂等可被完全绕过**（deep-04 H-3）：`requestId` 为空则 184 行整段跳过。
- **`receipt_abnormal` 永久死角**（R3 H1 / R4 N1）：239-241 与 417-421 两个白名单都不含它；411 行注释仍写「receipt_abnormal 状态允许继续补收」与白名单**直接矛盾**。
- **`receipt_item` 不落 `is_missing_price`**（R4 §3.3-a）：490-513 的落库字段中无该键。
- **`abnormal_record` 不落数量 / 单价 / 金额 / `receipt_item_id`**（R4 N12）：533-549。
- **短收描述用本批数量而非累计**（R4 N11）：524。
- **`isQualityIssue` / `isWrongItem` 完全客户端可控**（R3 M1 后半）：62-63 透传，无二次确认。
- **无供应商的档案商品静默漏账**（R4 N4）：395 的 `item.supplierId` 条件。
- **实收 0 的短收行以 0.00 计入带价账单**（R4 N14）：630 / 711 的过滤条件只判 `payableFlag && !isManual`。
- **`batch_no` 并发重号**（R4 N19）：466-471。
- **报表 `report_id` 确定性命名 + 无查重**（R3 M11）：`createPurchaseOrder:431` / `:480`、`createReceipt:614` / `:647` / `:696` / `:728`。
- **报表在事务外、进程被杀则永久缺报表无标记**（deep-04 M-9）：`createPurchaseOrder:407→503`、`createReceipt:583→747`。
- **`csvField` 防公式注入正则只拦 `^[=+\-@]`**（R3 P0-2）：`createPurchaseOrder:45`、`createReceipt:43`，两处都漏 `\t` / `\r` / `\n`。
- **`event.createdBy` 完全忽略、`createdByName` 只进 CSV**（deep-04 L-1 / M-10）：154 无引用，422 唯一使用点。
- **`verify_status` 双空值语义**（deep-04 M-11）：335 `'none'` vs `''`。
- **无供应商行的档案商品不进任何供应商报表**（R3 P2-18）：465 `if (sid === 'unknown') continue`。
- **门店停用即在途订单永久卡死**（R3 P1-3）：197-199 的 `status:1` 过滤。
- **`getSupplierOrders` `...order` 全量下发**（deep-04 S-1 / R3 P1-4）：127-130 仍含 `supplier_confirmations` 全量 map。
- **收货照片无删除路径**（R4 §7.3）：全仓 `deleteFile` 仅 `dataService:1602` 与 `importProducts:94`。
- **服务端要求上送随后被覆盖的字段**（R4 R23）：208-210 要求 `productId/productName/unit`，294-299 全部用库内值覆盖。

### 5.3 旧报告判断有误 / 需要修正的地方

1. **R4 §9 的校验实现与建议方向均已被执行，但结论错误。** R4 原文称旧代码 `id.includes(photoPrefix)`「✅ 通过」并建议「改用 `indexOf(photoPrefix) === 8`」（8 = `cloud://` 的长度）。当前代码改成了 `startsWith`，**既没有实现 `=== 8` 的位置校验，也没有保留 `includes` 的可用性**，直接把功能改坏了。旧报告对「`startsWith` 更安全」的默认假设未考虑 fileID 的 `cloud://` 前缀。
2. **deep-04 §4.1 的补偿缺陷描述已过期**（H2 已修），该节表格中「事务提交成功、报表生成失败 → 全链路静默」的结论不再成立：现在会打 `missing_reports` 标记并向超管定向通知。
3. **R4 §2.1 的 `payableFlag = !hardAbnormal && item.payableFlag !== false && priceSnapshot > 0` 已过期**：当前为 `!hardAbnormal && priceSnapshot > 0`（392），客户端压低通道已封闭。但同一节的「`isQualityIssue`/`isWrongItem` 完全客户端可控」**仍然成立**——异常勾选与可付款资格是两条独立通道，前者未被 P1-10 覆盖。
4. **R4 N7 的「已修」判定偏乐观**：`txIsFinalBatch` 确实进了事务，但 `isShortage` 的正向置位仍在事务外且最终批不清零，**虚假短收异常路径仍然存在**，且它会把订单推进 `receipt_abnormal` 死角（与 R3 H1 叠加）。
5. **deep-04 §2.1 把 `receipt_abnormal` 标为「可继续补收」**（迁移图 T13）与当前代码矛盾：白名单不含该状态，实际不可继续收货。deep-04 的迁移图与 R4 的判定冲突，**以 R4（拒绝补收）为准**。
6. **R3 P2-15 把「客户端可篡改收货日期」定为 P2 低估了实际影响**：`receiptDate` 直接决定取价区间（`_.lte(receiptDate)`，362）→ 客户端传一个更早的 `receiptDate` 可以**让同一批货按旧价结算**，这是金额层面的影响，不只是审计标记问题（详见 §5.7 第 6 条）。

---

## 6. 问题清单

级别：**高** = 功能阻断 / 数据错误 / 越权 / 金额错误；**中** = 数据不一致 / 校验未达设计目标 / 明确误导用户；**低** = 可观测性 / 冗余 / 死代码。

### 6.1 createPurchaseOrder/index.js

| # | 级别 | 位置 | 问题 | 触发场景 |
|---|---|---|---|---|
| P1 | **高** | 355, 356-362 | 编辑草稿路径**无条件 update + 无 `stats` 检查 + 无 `order_status` 条件**，且事务内幂等复查只在新建分支（366-376） | 两个页面实例 / 两台设备同时打开同一草稿并各自提交：两份都通过 227 的 `draft` 检查，都在 355 覆盖写入，都删旧行、都写新行 → 订单被后写者覆盖，`purchase_order_item` 出现两套新行；两方都生成报表且 `report_id` 相同 |
| P2 | **高** | 45 | `csvField` 防公式注入正则 `/^[=+\-@]/` 漏 `\t`/`\r`/`\n` | chef 在 `items[].remark` 或整单 `remark` 填入以制表符开头的字符串（283-285 对 remark 零校验）→ 落库后经 425/473 写入门店下单报表与供应商订货汇总报表 → Excel/WPS 打开即执行公式 |
| P3 | 中 | 209 | 幂等命中分支返回 `reportGenerated:false` 但**不带 `reportWarning`、不回查 `missing_reports`** | 首次请求订单已落库但报表生成失败（已打 `missing_reports:true`）→ 用户超时重试命中幂等 → 前端显示「提交成功」，实际报表缺失，用户永远看不到提示 |
| P4 | 中 | 373-374 | `await transaction.rollback({code:-1,msg})` 后紧接 `return`——**依赖「传参会 reject」这一未验证的 SDK 语义**（同文件 createReceipt 用的是 `throw`，全库两种风格并存：`dataService:548/1374/1378/1382` 也用 `rollback`） | 若该版本的 `rollback(obj)` 不抛错而是正常 resolve，则 `runTransaction` 视为成功 → 407 行把 `persistedOrderNo` 设为一个**从未落库**的订单号 → 继续为不存在的订单生成报表并返回 `code:0`，用户重试时另用新 `requestId` 再建一单 → 重复建单 |
| P5 | 中 | 431, 480 | `report_id` 确定性命名（`RPT_SO_${orderNo}` / `RPT_SUO_${sid}_${orderNo}`）且 `add` 前无查重 | 报表生成失败后管理员补生成 → 追加 `report_id` 完全相同的第二份 `report_file` 记录，报表中心出现重复条目、无法区分有效版本 |
| P6 | 中 | 407 → 503 | **事务提交后、打 `missing_reports` 标记前的进程中断窗口** | 云函数在 408 行之后被回收 / 超时（两份 `package.json` 均无 `config.json`，只能用默认超时）→ 订单永久缺报表，且无标记、无通知、无补生成入口提示 |
| P7 | 中 | 455 | 供应商名称批量查询不带 `status:1`（对比 215 / 249 查门店都带） | 供应商被停用后，其名称仍写入订货汇总报表；停用供应商的档案商品行仍归入其分组并生成报表 |
| P8 | 低 | 183-201 | `requestId` 为空则幂等整段跳过 | 前端未传或被清空（云函数可被直接调用，参数可枚举）→ 重复建单无拦截 |
| P9 | 低 | 154, 422 | `event.createdBy` 完全忽略；`createdByName` 只进 CSV 不落库 | 代提交他人草稿时客户端传入的「经办人」会写进报表，而库内 `created_by_name` 由会话推导（345-347）→ 报表与单据口径可能不一致 |
| P10 | 低 | 414 vs `createReceipt:568-582` | **消息是否属于事务的口径不一致**：下单侧提交消息在事务外 | 消息写入失败静默无感（56-72 内部 catch）；订单已提交但消息中心无记录 |
| P11 | 低 | 428, 477 | `uploadFile` 成功后若 `report_file.add` 失败 → 云存储孤儿 CSV，无清理逻辑 | 报表元数据写入失败 |
| P12 | 低 | 419, 468 | `getNextVersion` 在事务外、报表失败仍消耗版本号 → 版本跳号 | 上传 / 入库失败 |
| P13 | 低 | 157, 339, 401 | `remark` / `items[].remark` / `createdByName` 无长度上限、无字符清洗 | 超长文本进库并进 CSV |
| P14 | 低 | 335 | `verify_status` 普通单 `''`、手动单 `'none'` 两种空值并存 | 下游若改用存在性 / `IS NULL` 判断会误判 |
| P15 | 低 | 465 | 无默认供应商的档案商品行归入 `unknown` 分组并被跳过 → 不进任何供应商订货报表 | 商品建档未设默认供应商即下单 |

### 6.2 createReceipt/index.js

| # | 级别 | 位置 | 问题 | 触发场景 |
|---|---|---|---|---|
| R1 | **高** | 224（同型：`dataService:1560`） | **`startsWith('receipts/{orderId}/')` 与真实 fileID 形态冲突**：`wx.cloud.uploadFile` 返回 `cloud://env.xxx/receipts/{orderId}/ts-i.jpg`（`utils/cloud.js:239` 直接透传 `res.fileID`，`purchase-detail.js:159` 同样直接 push）→ 合法文件 100% 不匹配 | **任何带照片的收货提交** → `-1 '验收照片信息无效，请重新上传'`，功能完全阻断（不带照片仍可通过）。同型的 `dataService:1560` 使**手动单付款凭证核销同样被阻断** |
| R2 | **高** | 174-182, 331 | **全程无幂等键**：`requestId` 不存在于入参、`receipt` 表无幂等字段 | 订单 `partial_received` 时首次提交响应丢失 → 用户重试同一批 → 事务内 `历史累计 + 本批 <= 下单量` 校验**通过** → 生成第二张收货单、重复站内信、重复 4 类报表、重复异常台账；两批实物相同但记录重复，无法区分哪一张是真的 |
| R3 | **高** | 340-343 vs 459-461 | `isShortage` 用**事务外**快照预标 true，事务内只在「非最终批」时清零、**最终批不重算** | 应收 10，两笔并发：T1 收 3、T2 收 7。T2 在 264-273 读历史时 T1 未提交 → 预标 `isShortage=true`；T2 事务内 `txIsFinalBatch=true`（3+7=10≥10）→ 不清零 → 落一条**虚假 `shortage` 异常**（描述「下单10，实收7」）→ 订单进入 `receipt_abnormal`（555），叠加 5.2 的死角结论：**单永久卡死**，且异常必须人工 resolve 才能补结算 |
| R4 | **高** | 320-329, 362 | `receiptDate` 完全由客户端决定且**无上下界**，而它直接决定取价区间 `_.lte(receiptDate)` | 客户端传一个更早的 `receiptDate`（如把 2026-10-04 改成 2026-01-01）→ 该批货按 1 月的旧协议价结算 → **同一批货按任意历史价出账**。`backfilled` 标记只打标不拦截（480），无金额层面的任何防护 |
| R5 | 中 | 62-63 | `isQualityIssue` / `isWrongItem` **完全客户端可控、零校验、零二次确认** | 店长对本店订单把全额到货行标为质量问题 → 该行 `payableFlag=false`（392）→ 整行剔出供应商带价账单、无需任何审批闸、且 `abnormal_record` 中无痕迹区分「真异常」与「人为压价」。验收人与后续付款放行人为同一角色（`dataService` 异常流角色集合相同） |
| R6 | 中 | 395 | `missing_price` 触发条件要求 `item.supplierId` 非空 | 无默认供应商的档案商品全量到货 → `priceSnapshot=0` → `payableFlag=false` → 不进带价账单、**不生成任何异常记录、不发消息、前端无标签** → #11 拍板要消灭的「静默漏账」只剩一半被覆盖 |
| R7 | 中 | 466-471 | `txBatchNo = 事务内读取的已提交收货单数 + 1`，快照读不保证跨事务唯一（465 行注释声称「避免并发重号」，**注释与实现不符**） | 两笔并发收货 → 各自读到同一 count → 相同 `batch_no`；CSV「批次」列（590）与列表排序语义在并发下不可信 |
| R8 | 中 | 583 → 747 | 事务提交后、打 `missing_reports` 前的进程中断窗口（同 P6） | 云函数超时 / 被回收 → 收货已提交、4 类报表缺失、无标记无通知 |
| R9 | 中 | 783 | `priceReportsSkipped: hasAbnormal` 字段语义与实现不符：只要有可付款行，带价报表**确实生成了** | 有异常且有可付款行时，前端把 `priceReportsSkipped` 当真 → 误报「带价报表未生成」，实际少一张账单的提示是假的 |
| R10 | 中 | 490-513 | `receipt_item` 不落 `is_missing_price` | 缺价信息只存在于 `abnormal_record`；下游 `regenerateReceiptReports` / `getReportDetail` 派生异常类型时读不到该标志 → 补生成后的报表「异常类型」列丢失「缺价待补」，而 `has_abnormal` 仍为 true，自相矛盾 |
| R11 | 中 | 208-211 vs 294-299 | 服务端要求客户端必传 `productId` / `productName` / `unit`，随后**全部用库内订单行值覆盖** | 精简客户端字段或旧版页面调用 → 被 `-1 '验收信息不完整'` 拒绝，而报错文案与实际缺失字段无关 |
| R12 | 低 | 134-167 | `ensureReceiptMessage` 定义后**从未被调用**（全库 Grep 无引用） | 纯死代码 34 行；注释 101-103 声称的「补写路径」实际不存在 |
| R13 | 低 | 43 | `csvField` 同 P2 的正则缺口 | 客户端 `items[].remark`（510）与 `overallRemark`（482）进报表 1/3/4 的备注列 |
| R14 | 低 | 501 | `order_qty_snapshot` 存**整单下单量**而非本批应到量 | 下游 `supplier-receipts.js:53` 用 `receivedQty !== orderQty` 判异常 → 任何非最终批次都被误标红 |
| R15 | 低 | 524 | 短收描述用本批数量而非累计量 | 分批收货第 2 批的异常文案系统性偏悲观 |
| R16 | 低 | 533-549 | `abnormal_record` 不落数量 / 单价 / 金额 / `receipt_item_id` | 异常台账无法独立对账「差多少货、差多少钱」，只能靠 `receipt_id` 反查 |
| R17 | 低 | 630, 711 | 带价报表只过滤 `payableFlag && !isManual`，不滤数量 | 实收 0 的短收行 `payableFlag=true` → 以 0.00 计入带价账单 |
| R18 | 低 | 455, 288 | 数量比较为裸浮点、无容差 | 分批累加 0.1+0.2 类场景可能判不出「收齐」→ 订单停在 `partial_received` |
| R19 | 低 | 210-211 | `receivedQty` / `orderQty` 允许小数、无整数校验、无上限 | `3.5` 件可入库 |
| R20 | 低 | 179, 510 | `overallRemark` / `items[].remark` 无长度限制 | 超长文本进库并进 CSV |
| R21 | 低 | 265-267, 429-431 | 历史 `receipt_item` 查询 `limit(1000)` | 同一订单收货行数 > 1000 时历史累计被截断 → 超收校验失真 |
| R22 | 低 | 483 | `photoFileIds.filter(Boolean)` 落库前过滤空串，但校验阶段（224）先拒空串 | 空串触发的是「格式无效」而非「含空项」，文案不准确 |

### 6.3 跨函数 / 依赖层面

| # | 级别 | 位置 | 问题 | 触发场景 |
|---|---|---|---|---|
| X1 | **高** | `dataService:1560` | 与 R1 同型的 `startsWith('vouchers/{orderId}/')` | 手动商品单凭证核销提交被完全阻断 |
| X2 | 中 | 两份 `package.json` 均无 `config.json` | 无法声明超时 / 并发 / 环境变量；`createReceipt` 最坏路径约 30+ 次串行网络调用 | 报表阶段超时 → 恰好落在补偿标记之前 |
| X3 | 中 | 五段约 72 行工具/鉴权代码被复制两份，且 `getSessionUser` 全库 19 份 | 鉴权 / 取号 / CSV 规则变更需手工同步 20+ 处；已出现 `getNextVersion` 两份同步、`getSessionUser` 依赖外部漂移的风险 | 任何一次鉴权逻辑改动 |
| X4 | 低 | `createPurchaseOrder` 报表在事务外 vs `createReceipt` 消息在事务内 | 两个函数的「哪些写入算事务一部分」口径不一致 | 维护者据一方实现推断另一方 |

---

## 7. 遗留待核实

1. **`transaction.rollback({code,msg})` 的语义**（P4）：传参时是否使 `runTransaction` reject？直接决定 373-374 是「友好拦截」还是「幻影订单」。全库 5 处同型调用（`dataService:548/1374/1378/1382`、`createPurchaseOrder:373`）都依赖它，而 `dataService:561` 还依赖 `err.errMsg` 包含传入文案。**需实测 wx-server-sdk，或统一改为 `throw`。**
2. **`receipt` / `receipt_item` / `purchase_order` / `message` 是否已在云开发控制台建唯一索引**：代码无法体现。`(request_id, created_by)`、`receipt_id`、`report_id`、`message_id`、`report_version_counter._id` 全都没有唯一索引兜底。
3. **`receipt_date` 是否应设上下界**（R4）：当前完全信任客户端，且它决定金额。需业务确认是「审计标记即可」还是「必须设界」。
4. **`isQualityIssue` / `isWrongItem` 是否应需二次确认**（R5）：验收人与付款放行人为同一角色，无二方审批。
5. **微信云开发默认超时值**：决定 P6 / R8 的窗口实际大小。
6. **`effective_date` 在 seed / importProducts 写入路径下是否唯一**：`updateProductPrice` 只保证自己写入的行唯一。

---

## 附：本域做得好的地方（避免后续误改）

1. **服务端权威化彻底**（收货侧）：商品身份、供应商、单位、下单量、价格、可付款资格全部服务端重算，客户端唯一有效输入是「实收数量」与「异常勾选」两类（291-301, 375-399）。
2. **事务内新鲜重算**：订单状态、历史累计、超收、终态、批次号、少货标记全部在事务内用新数据重算，事务外只做预检（410-472），并发正确性到位。
3. **`getNextVersion` 标准 CAS**：读旧值 → 条件更新 → 判 `updated===1`，最多 5 次重试，撞 `_id` 走 add 路径（两个文件均已修）。
4. **`createPurchaseOrder` 的幂等设计有「本次正在编辑的同一草稿」例外口子**（195, 208），避免同页改内容再保存被静默短路。
5. **补偿链路完整**：下单侧与收货侧报表失败都打 `missing_reports` 标记 + 定向通知超管 + 提供补生成入口，无静默缺失（唯一例外是进程中断窗口）。
6. **收货侧把 `message` 放进同一事务**（568-582），且 `message_id = MSG_RECEIVE_${receiptId}` 稳定可识别。
7. **供应商可见性已收紧**：`getSupplierOrders` 隐藏 `submitted`/`pending_approval`，`confirmSupplierOrder` 要求审批后，报表接口对 supplier 一律 `-403`。
8. **取价规则正确**：按 `effective_date <= 收货日` 取最新一档而非只看 `is_current`，与 `updateProductPrice` 的写入口径自洽（P1-11）。
9. **可付款资格完全服务端裁决**，删除了客户端压低分支（P1-10）。
10. **金额口径自洽**：逐行先舍入到分再累加、合计再取整，CSV 明细与合计一致（638-639, 721-722）。
