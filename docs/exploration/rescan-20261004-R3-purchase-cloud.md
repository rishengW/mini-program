# R3 重扫：采购链路云函数（2026-10-04）

> **范围**：`cloudfunctions/{createPurchaseOrder,getPurchaseOrders,getPurchaseOrderDetail,getSupplierOrders,confirmSupplierOrder}/index.js`（5 个，1008 行）+ 各自 `package.json`（5 个）。
> **交叉参照（只读，用于验证结论）**：`createReceipt/index.js`(752)、`getReceipts/index.js`(92)、`getSupplierReceipts/index.js`(119)、`dataService/index.js`（1559 行，**部分读**，见 §1）、`authService/index.js`（**未读**，本批不消费）、`pages/{purchase-create,purchase-detail,purchase-list,approval-list,approval-detail,receive-list,receive-verify,supplier-orders,supplier-receipts}/*.js`、`utils/cloud.js`、`utils/meta.js`。
> **方法**：逐行读代码，不采信注释/README/log.md。每条结论带 `文件:行号`。拿不准标【待核实】。
> **前置文档**：`docs/exploration/full-scan-02-cloud-purchase-receipt.md`(427 行，主前置)、`batch1-cloudfunctions-data.md`、`batch2-purchase-flow.md`、`controller-horizontal-scan.md`、`controller-horizontal-scan-20261003.md`。
> **版本基线**：HEAD = `5268379`（`fix(pages): navigation, permissions, loading states and guard rails`），工作区未提交改动 `pages/report-list/report-list.js`、`project.config.json`（均为 ES2020 可选链回退，**与本批 5 个云函数无关**，未纳入本批结论）。本批 5 个云函数与工作区无关、无未提交改动。

---

## 0. 增量摘要

1. **确认 full-scan-02 的 H2 在当前代码下仍然触发**：`createPurchaseOrder:454` 在 catch 块内引用 try 块内 `const orderData`（L273）→ 必然 `ReferenceError`。full-scan-02 与 controller-20261003 H14 两处独立复核均正确，**该行未修复**。这是本批唯一的「注释声称已防御、实际必然抛错」型缺陷。
2. **新发现 P0 级（列表页数据完整性）**：`getPurchaseOrders:119-124` 明细批量查询按 20 个订单号分块、`.limit(1000)`，而单单上限 100 行（`createPurchaseOrder:210`）→ 20 单 × 100 行 = 2000 行 > 1000，**超出部分静默丢弃**。pageSize 默认 20 正好等于分块大小，**触发条件不是极端场景而是每单平均 ≥50 行**。这比 full-scan-02 H3 的「供应商累计 1000 行」触发门槛低一个量级，且影响的是内部采购列表主页面。
3. **新发现 P1（CSV 公式注入防护不完整）**：`csvField`（`createPurchaseOrder:42-47`）只拦 `^[=+\-@]`，不拦 `\t`/`\r`/`\n` 开头的单元格；而 `items[].remark` 是下单人（chef）可控字段，经 `createPurchaseOrder:336` 落库、`:359`/`:407` 写入两份报表 → **chef 可把公式注入门店下单报表与供应商订货汇总报表**。
4. **新发现 P1（门店停用后在途订单永久卡死）**：`createPurchaseOrder:164/198` 与 `createReceipt:178/188` 都要求 `store.status: 1`，但 `getPurchaseOrders`/`getPurchaseOrderDetail`/`confirmSupplierOrder`/`getSupplierOrders` **均不检查** → 门店停用后历史单据仍全量可见、供应商仍可确认发货，但**该门店所有在途订单永久无法收货、无法闭环**。
5. **新发现 P1（供应商侧字段泄漏）**：`getSupplierOrders:127` 以 `...order` 全量展开下发，包含 `supplier_confirmations`（**同单其他供应商的 supplier_id 与确认状态**）、`created_by_name`、`remark`、`delivery_date`、`is_manual`、`verify_status`；`getSupplierReceipts:104` 同样全量展开，泄漏门店侧 `remark`（验收备注）与全部异常标记字段。商品行本身的供应商隔离是**正确**的（`getSupplierOrders:71` 按 `supplier_id` 过滤），泄漏发生在订单头层。
6. **`receipt_abnormal` 终态死锁（H1）仍成立**：`createReceipt:386` 注释写「receipt_abnormal 状态允许继续补收」，但 `:392` 白名单 `['approved','report_generated','partial_received','to_receive']` 不含它，`:1294` 也拒绝作废 → **该状态无出路**，且 S8 新增的 `partial_received` 使 `approved → partial_received → receipt_abnormal` 成为常态路径，死锁不再需要「缺一件」也能触发。
7. **前端 8 个【待核实】已全部回收**（见 §4），其中 2 项结论与 batch2 预期不同：① `auditOrder` 空 `items` **不是**「按申请量全批」而是**「完全不改量」**（区别很大）；② `getAbnormalRecords` **确实**按会话收敛，batch2 担心的越权不成立。
8. **审批侧无一处并发缺口**：`dataService:533-541` 事务内复查 + rollback 已挡住并发重复审批；`confirmSupplierOrder:78-80` 条件更新原子性正确。**收货侧（H4/M5）与建单侧（M4）的幂等缺口全部仍在**。

---

## 1. 文件清单与全读确认

| # | 文件 | 行数 | 读法 |
|---|---|---|---|
| 1 | `cloudfunctions/createPurchaseOrder/index.js` | 471 | **全读** |
| 2 | `cloudfunctions/getPurchaseOrders/index.js` | 148 | **全读** |
| 3 | `cloudfunctions/getPurchaseOrderDetail/index.js` | 129 | **全读** |
| 4 | `cloudfunctions/getSupplierOrders/index.js` | 136 | **全读** |
| 5 | `cloudfunctions/confirmSupplierOrder/index.js` | 124 | **全读** |
| 6 | 上述 5 个 `package.json` | 各 7~9 | **全读**，均仅依赖 `wx-server-sdk: ~2.6.3` |
| 7 | `cloudfunctions/createReceipt/index.js` | 752 | **全读**（下游参照） |
| 8 | `cloudfunctions/getReceipts/index.js` | 92 | **全读** |
| 9 | `cloudfunctions/getSupplierReceipts/index.js` | 119 | **全读** |
| 10 | `cloudfunctions/dataService/index.js` | 1559 | **部分读**（L91-130 `saveProduct`、L482-600 `auditOrder`、L697-731 `getAbnormalRecords`、L827-906 `getOrderStats`/`settleReceipt`、L1010-1025 `regenerateOrderReports` 尾、L1255-1272 `regenerateReceiptReports` 尾、L1279-1559 `cancelOrder`/`requestCancel`/`remindAudit`/`verifyManualOrder`/`main`）；未读区间与本批结论无关 |
| 11 | `cloudfunctions/authService/index.js` | 674 | **未读**（本批 5 函数使用内联 `getSessionUser`，不调用 authService） |
| 12 | `utils/cloud.js` | 282 | **全读** |
| 13 | `utils/meta.js` | 67 | **全读** |
| 14 | `pages/purchase-create/purchase-create.js` | 432 | **全读** |
| 15 | `pages/purchase-detail/purchase-detail.js` | 385 | **全读** |
| 16 | `pages/purchase-list/purchase-list.js` | 154 | **全读** |
| 17 | `pages/approval-list/approval-list.js` | 105 | **全读** |
| 18 | `pages/approval-detail/approval-detail.js` | 113 | **全读** |
| 19 | `pages/receive-list/receive-list.js` | 185 | **全读** |
| 20 | `pages/receive-verify/receive-verify.js` | 269 | **全读** |
| 21 | `pages/supplier-orders/supplier-orders.js` | 131 | **全读** |
| 22 | `pages/supplier-receipts/supplier-receipts.js` | 82 | **全读** |
| 23-27 | 5 份前置文档 | 427 / 1252+ / 751 / ~190 / ~420 | **全读或定向读相关章节** |

**代码全读合计 4176 行（22 个 .js）+ 5 个 package.json**；部分读 `dataService` 约 600 行；未读 `authService` 674 行。

**5 个目标云函数共用的 `getSessionUser` 是逐字复制**（`createPurchaseOrder:13-39`、`getPurchaseOrders:11-36`、`getPurchaseOrderDetail:11-36`、`getSupplierOrders:20-45`、`confirmSupplierOrder:21-47`），5 份完全一致，无漂移。行为：先查 `app_user.sessions` 数组（多设备），未命中再回退 `session_token_hash`（legacy），两处 `where` 都带 `status: 1`，再校验 `expires_at`/`session_expires_at` 未过期。→ 与 controller-20261003 H16 一致：**停用账号期间 token 失效，重新启用后旧 token 复活**（`sessions[]` 从不清理）。

---

## 2. 逐函数解剖

### 2.1 `createPurchaseOrder`（471 行）—— 建单 + 生成下单类报表

**入参（L104-116）**

| 入参 | 必填 | 校验 | 行号 |
|---|---|---|---|
| `authToken` | 是 | `getSessionUser` → 空则 `-401`；角色白名单 `['chef','store_manager','super_admin','purchaser']` → 否则 `-403` | L99-103 |
| `orderId` | 否 | 有值时必须存在（L174）且 `order_status==='draft'`（L176），否则 `-1` | L169-194 |
| `storeId` / `storeName` | 条件 | **非全局角色无条件丢弃客户端值**，强制取 `user.default_store_id`；查 `store where {store_id, status:1}` 不存在 → `-403 '账号未关联有效门店'`，`storeName` 一律从库取（L166） | L160-167 |
| `orderDate` | 否 | 默认服务端 UTC+8 当日（L119-120） | L119-120 |
| `deliveryDate` | 否 | 默认回退 `orderDate`（L125） | L125 |
| `createdBy` | 否 | **完全忽略**（解构后全函数无引用） | L110 |
| `createdByName` | 否 | 仅进入 CSV「经办人」列（L356），**不落库** | L356 |
| `items` | 是 | 数组非空（L203）、`>100` 拒绝（L210） | L203-210 |
| `items[].productId` | 条件 | 空串/非档案必须 `isManual`；档案商品必须 `product.status:1` 存在，否则 `-1 '部分商品已下架或不存在'` | L214-223、L242-243 |
| `items[].orderQty` | 是 | `Number()` 有限、`>0`、`<=1000000`，**无整数校验** | L231-233 |
| `items[].remark` | 否 | **无长度限制、无清洗** | L336 |
| `orderStatus` | 否 | 白名单 `['draft','submitted']`，默认 `'submitted'` | L114、L206-208 |
| `requestId` | 否 | trim 后作幂等键，空串则跳过幂等 | L139-150 |
| `remark`（单级） | 否 | **无长度限制**，仅落 `orderData.remark` | L288 |

**日期校验（L126-133）**：`isDate` 要求严格 `YYYY-MM-DD` 且 `new Date(`${text}T00:00:00Z`)` 回环一致（拒绝 `2026-13-40`）；再要求 `actualDeliveryDate >= actualDate`。`isBackfilled = actualDate < today`（L122），仅打标不拒绝。

**读写集合**
- 读：`app_user`（会话）、`store`（`status:1`）、`product`（`status:1`，20 条/块，L216-223）、`supplier`（L387-396）、`purchase_order`（幂等查重 L141-145、编辑态读取 L170-174）、`purchase_order_item`（编辑态取旧行 L304-307）、`report_version_counter`
- 写：`purchase_order`（add L312-320 / update L303）、`purchase_order_item`（编辑态逐条 remove L308-310 + 全量 add L323-340）、`message`（L348 提交消息、L446-459 缺报表通知）、`report_file`（L363-371、L412-420）、`report_version_counter`（`getNextVersion` L77-94，`_.inc(1)` 原子自增 + 冲突重试）

**事务（L301-341）**：单个 `db.runTransaction` 包裹「订单头 add/update + 旧明细全删 + 全部新明细 add」，头与行同提交同回滚，**正确**。

**状态写入（L278）**：`order_status: orderStatus`，取值域 `{'draft','submitted'}`。`submitted_at` 仅当 `orderStatus==='submitted'` 时写（L297）。`created_by = user.user_id || user._id`（L293），编辑态沿用原 `created_by`（L291-292）。`verify_status` 初始值：手动单 `'none'`，非手动单 `''`（L284）——**两种空值写法并存**，下游 `getOrderStats:853` 用 `verify_status: 'pending'` 判定，不受影响。

**返回结构**

```
成功新建/编辑/提交：
{ code: 0, data: { orderId: String, reportGenerated: Boolean, reportsGenerated: Number } }
保存草稿（L344-346）：
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0 } }
幂等命中（L157-159）：
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0, idempotent: true } }
报表失败但订单已落库（L463-466）：
{ code: 0, data: { orderId, reportGenerated: false, reportsGenerated: 0,
                  reportWarning: '订单已保存，但报表生成失败，请联系管理员处理。' } }
失败：{ code: -401 | -403 | -1, msg: String }      ← 失败分支一律无 data 字段
```

**错误码全集**：`-401`（L100）、`-403`（L102、L162、L165、L186、L190、L199）、`-1`（L132、L158? 否、L174、L177、L204、L207、L210、L233、L235、L238、L243、L260、L264、L429-469 catch 兜底 L469）。**注意 `-403` 与 `-1` 混用**：门店类权限失败用 `-403`（L162/165/199），而「无权编辑该草稿」（L186）与「编辑草稿时不能更换门店」（L190）也用 `-403`，与「订单不存在」（L174，`-1`）区分合理。

**幂等（L135-159）**：查 `purchase_order where {request_id, created_by} orderBy created_at desc limit 1`，命中且非「本次正在编辑的同一草稿」（L157 例外：`orderId && orderId===idempotentOrderNo && idempotentIsDraft`）→ 直接返回原单号。**例外设计正确**，避免同页改内容再保存被静默短路。**但查重在事务外**（见 §6 P1-5）。

**报表（L348-423）**：① `store_order_report` 全量行；② `supplier_order_report` 按供应商分组，`is_manual` 行显式跳过（L378）。**报表在事务之外**，失败不回滚订单，改为打 `missing_reports: true` + 定向通知超管（L433-466）。`report_id` 形如 `RPT_SO_${orderNo}` / `RPT_SUO_${supplierId}_${orderNo}`——**不含版本号**，补生成会追加新记录（见 §6 P2-9）。手动单报表头额外插一行「单据类型 / 手动商品专用单」（L355）。

---

### 2.2 `getPurchaseOrders`（148 行）—— 采购单列表

**入参（L43）**：`const { role, storeId, orderStatus, orderDate, createdBy } = event`
- `role`：**解构后全函数无引用**（死参数，L43）
- `storeId` / `createdBy`：**仅全局角色生效**（L62-63）
- `orderStatus`：无枚举校验，`to_verify`（L70-72）、`receivable`（L73-74）两个虚拟筛选，其余原样入 query（L75-77）
- `orderDate`：精确等值（L78），**全项目无任何调用方传入**（见 §6 P2-10）
- `page`：`Math.max(1, Math.min(1000, Math.floor(Number(event.page)||1)))`（L44）
- `pageSize`：`Math.min(100, Math.max(1, Math.floor(Number(event.pageSize)||20)))`（L45），**上限 100 与前端 `approval-list.js:26`/`receive-list.js:24` 硬编码 100 耦合**

**角色收敛（L50-66）**
| 角色 | 查询条件 | 行号 |
|---|---|---|
| `chef` | `store_id = default_store_id` **且** `created_by = user.user_id||user._id` | L52-55 |
| `store_manager` | 仅 `store_id = default_store_id`（**丢弃前端 storeId**） | L56-59 |
| `super_admin`/`purchaser` | 可选 `store_id` / `created_by` 筛选 | L60-63 |
| 其他（含 `supplier`、`admin`） | `-403 '当前账号无权查看采购订单'` | L64-66 |

**关键设计**：范围完全由**会话角色**决定，`event.role` 不参与判定 → 前端 `purchase-list.js:62` / `receive-list.js:15` 的 `user.role || 'purchaser'` 兜底**不会造成越权**，最坏只是无意义的参数。

**`statusCounts`（L81-106）**：在**剔除 `order_status` 与 `verify_status` 后的 baseQuery** 上并行发 9 个 `count()`（`Promise.all`，L84-95），不受 tab 切换影响——**正确做法**。键：`all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable`。

**返回结构（L143）**

```
{ code: 0,
  data: [ { ...purchase_order 原始 snake_case 全量,
            created_by_name: String,      // L139 兜底链
            items: [ 原始 purchase_order_item 文档(snake_case), ... ] } ],
  total: Number, page: Number, pageSize: Number,
  statusCounts: { all, draft, submitted, received, receiptAbnormal,
                  cancelled, partialReceived, toVerify, receivable } }
失败：{ code: -401 | -403 | -1, msg }
```

**`items` 是原始 `purchase_order_item` 文档**，字段为 snake_case：`item_id` / `product_id` / `product_name_snapshot` / `category_snapshot` / `unit_snapshot` / `supplier_id` / `order_qty` / `is_manual` / `remark` / `approved_qty`（改量后）/ `created_at`。前端经 `utils/cloud.js:123-137 normalizePurchaseItem` 转 camelCase（`productNameSnapshot`/`orderQty`/`isManual`）——**契约匹配**。

**单页 DB 调用次数**：9 个 count + 1 count + 1 get + 明细分块 get + 创建人分块 get ≈ **11~14 次/次翻页**。

---

### 2.3 `getPurchaseOrderDetail`（129 行）

**入参**：`orderId`（L44），缺失 → `-1 '订单信息缺失'`（L45）。

**鉴权（L57-67）**：非全局角色必须 `['chef','store_manager']`（L60），必须 `order.store_id === user.default_store_id`（L61-62），`chef` 还必须 `order.created_by === user.user_id||user._id`（L64-65）。**与 §2.2 的列表口径逐字一致，不存在「列表看不到、详情可打」的越权缝**。

**读了 4 个集合**：`purchase_order`（L48-51）、`app_user`（补 `created_by_name`，L70-73）、`purchase_order_item`（L78-81）、`receipt`（L100-103）、`supplier`（L90-93，仅非 chef）、`report_file`（L107-110）——**共 6 次查询，全部无 `orderBy`**（见 §6 P1-6）。

**信息边界（做得对的地方）**：`chef` 不补 `supplier_name`（L86-97 跳过），报表元数据只留 `report_scope==='store'`（L111-113）→ **chef 不见供应商身份与供应商级报表**。

**返回结构（L115-123）**

```
{ code: 0, data: {
    ...purchase_order 原始 snake_case 全量,
    created_by_name: String,
    items:   [ purchase_order_item (+supplier_name，非 chef) ],
    receipts:[ receipt 文档 ],
    reports: [ report_file 文档 ] } }
失败：{ code: -401 | -403 | -1, msg }
```

**`...order` 全量下发**：包含 `supplier_confirmations`、`verify_status`/`verify_amount`/`verify_voucher_file_ids`、`missing_reports`、`cancel_requested`、`audit_remark`、`backfilled`、`is_manual`。前端 `purchase-detail.js:37` 读 `result.data.supplier_confirmations`（snake）——**匹配**；`utils/cloud.js:155-162 normalizePurchaseOrder` 已映射 `isManual/verifyStatus/verifyAmount/verifyNote/verifyRejectNote/verifyVoucherFileIds/cancelRequested`——**匹配**。`backfilled` 与 `missing_reports` **未被 normalize 映射**，只能靠 `...order` 原始保留（snake）。

---

### 2.4 `getSupplierOrders`（136 行）

**入参**：`confirmStatus`、`orderDate`（L65）；`page`/`pageSize` 同 §2.2 口径（L66-67）。

**鉴权（L59-63）**：必须 `role==='supplier'`，必须有 `user.default_supplier_id` → 否则 `-403 '账号未关联供货商，请联系管理员'`。`supplierId` **完全由服务端派生，不接客户端参数**——正确。

**状态派生（L10-14、L48-55）**
- `HIDDEN_ORDER_STATUS = ['draft','rejected']`（L11）→ 草稿/驳回单供应商不可见
- `DONE_ORDER_STATUS = ['received','receipt_abnormal','completed']`（L14）→ 派生 `'done'`
- `order_status==='cancelled'` → `'cancelled'`（L51）
- 其余取 `supplier_confirmations[supplierId].status`，缺省 `'pending'`（L52-54）

**读写集合**：读 `app_user`、`purchase_order_item`（L71-75，`{supplier_id, is_manual: _.neq(true)}`）、`purchase_order`（L91-97，20 个/块）。**不写任何集合**。

**返回结构（L131）**

```
{ code: 0,
  data: [ { ...purchase_order 全量(snake_case),
            my_confirm_status: 'pending'|'confirmed'|'shipped'|'done'|'cancelled',
            items: [ 仅本供应商的 purchase_order_item 行 ] } ],
  total, page, pageSize,
  statusCounts: { all, pending, confirmed, shipped, done, cancelled } }
空数据（L77-86）：{ code:0, data:[], total:0, page, pageSize, statusCounts:{ 全 0 } }
失败：{ code: -401 | -403 | -1, msg }
```

前端 `supplier-orders.js:90` 读 `order.my_confirm_status`（snake）——**匹配**。

---

### 2.5 `confirmSupplierOrder`（124 行）

**入参**：`orderId`、`action`（L58）。`supplierId` 服务端派生（L55）。`ACTION_STATUS = { confirm:'confirmed', ship:'shipped' }`（L14）→ 其余 action 返回 `-1 '不支持的操作类型'`（L61）。

**动作级状态白名单（L12-13）**
| action | 允许的 `order_status` | 写入值 |
|---|---|---|
| `confirm` | `['submitted','approved']` | `supplier_confirmations[sid].status = 'confirmed'` |
| `ship` | `['submitted','approved','report_generated','to_receive','partial_received']` | `supplier_confirmations[sid].status = 'shipped'` |

**读写集合**：读 `app_user`、`purchase_order_item`（L65-68，**关键越权防护**）、`purchase_order`（L88-91，ship 分支取门店）；写 `purchase_order`（L78-80 条件更新）、`message`（L98-113，仅 ship）。**不在事务内**（单次条件更新本身原子）。

**返回结构（L119）**：`{ code: 0, data: { orderId, supplierId, status } }`；失败 `{ code: -401|-403|-1, msg }`。

**错误分支**：`-401`（L53）、`-403`（L54 非供应商、L56 无供应商绑定、L69 订单不含本供应商商品）、`-1`（L60 缺订单号、L61 非法 action、L81 条件更新 0 行）。

---

## 3. 采购单状态机

### 3.1 状态全集（枚举代码中所有 `order_status` 字面量）

| 状态 | 中文（`meta.js`） | 写入方 | 中文对照来源 |
|---|---|---|---|
| `draft` | 草稿 | `createPurchaseOrder:278` | `meta.js:2` |
| `submitted` | 已提交 | `createPurchaseOrder:278`（默认值） | `meta.js:3` |
| `pending_approval` | 待审核 | **无写入方** | `meta.js:4` |
| `approved` | 已通过 | `dataService:552` | `meta.js:5` |
| `rejected` | 已驳回 | `dataService:552` | `meta.js:6` |
| `report_generated` | 已生成报表 | **无写入方** | `meta.js:7` |
| `to_receive` | 待收货 | **无写入方** | `meta.js:12` |
| `partial_received` | 部分收货 | `createReceipt:512` | `meta.js:10` |
| `received` | 已收货 | `createReceipt:512` | `meta.js:8` |
| `receipt_abnormal` | 收货异常 | `createReceipt:512` | `meta.js:9` |
| `completed` | 已完成 | **无写入方** | `meta.js:11` |
| `cancelled` | 已作废 | `dataService:1303` | `meta.js:18` |

写入点全集共 4 处：`createPurchaseOrder:278`、`createReceipt:512`、`dataService:552`、`dataService:1303`。**`pending_approval` / `report_generated` / `to_receive` / `completed` 四个状态全项目无任何写入方**（与 batch1 §6.3、controller-horizontal-scan「附：状态机全景」一致，本次复核确认仍未修复）。

> 注：`to_verify` 与 `receivable` **不是** `order_status` 值，是 `getPurchaseOrders:70/73` 的查询别名（`to_verify` 映射 `verify_status:'pending'`，`receivable` 映射 `_.in(['approved','report_generated','partial_received','to_receive'])`）。前端 `purchase-list.js:86-98` 构造 tab 时用的是别名值，与服务端口径一致。

### 3.2 合法流转边（代码实际实现）

```
(无) ──createPurchaseOrder(draft)──► draft
(无) ──createPurchaseOrder(submitted，默认)──► submitted

draft ──edit(存草稿)──► draft
draft ──edit(提交审核)──► submitted        [createPurchaseOrder:278]

submitted ──auditOrder(approved)──► approved      [dataService:552]
submitted ──auditOrder(rejected)──► rejected      [dataService:552]
submitted ──cancelOrder──► cancelled              [dataService:1303，经 1297 白名单]
submitted ──confirmSupplierOrder(confirm/ship)──► submitted  [仅写 supplier_confirmations，不改 order_status]

approved ──createReceipt(未收齐)──► partial_received   [createReceipt:512]
approved ──createReceipt(收齐且无异常)──► received
approved ──createReceipt(收齐且有异常)──► receipt_abnormal
approved ──cancelOrder──► cancelled               [dataService:1297]
approved ──confirmSupplierOrder(任意 action)──► approved   [不改 order_status]

partial_received ──createReceipt──► partial_received / received / receipt_abnormal  [createReceipt:392 白名单含 partial_received]
partial_received ──requestCancel──► partial_received (仅写 cancel_requested:true)   [dataService:1348]

rejected ──(无出边)──► 永久终态；只能前端复制为新草稿 [purchase-detail.js:304]
draft    ──(无出边除自循环/提交)──►
cancelled ──(无出边)──► 永久终态
received ──(无出边)──► 终态；手动单另走 verify_status
receipt_abnormal ──(无出边)──► 终态 ★
```

供应商侧 `supplier_confirmations[sid].status` 是**独立子状态机**（`pending → confirmed → shipped`，见 `meta.js:23-29 supplierConfirmMap`），**不影响 `order_status`**。

### 3.3 代码未拦住、但业务上不该出现的跳转（本次重点）

| # | 问题 | 代码证据 | 影响 |
|---|---|---|---|
| **S-1** | **`receipt_abnormal` 是永久死锁态** | `createReceipt:392` 白名单不含它；`createReceipt:387` 只拦 `received`；`dataService:1294` 作废也拒它 | 无法补收、无法作废。`:386` 注释明确写「receipt_abnormal 状态允许继续补收」——**注释与实现直接矛盾**。S8 引入 `partial_received` 后，`approved → partial_received → receipt_abnormal` 成为常规路径，死锁不再需要「最后一批缺一件」触发 |
| **S-2** | **`partial_received` 可申请取消但永不生效** | `dataService:1348` `requestCancel` 白名单**含** `partial_received`；`dataService:1294/1297` `cancelOrder` **拒绝** `partial_received` | 采购员申请后，订单被写上 `cancel_requested:true` + 发通知，管理员确认必然被拒；且 `purchase-detail.js:85` 用 `!order.cancelRequested` 控制按钮 → **用户永久失去申请取消入口**。batch1 §23 #2 已列为跨批次待核实，**本次确认成立** |
| **S-3** | **`rejected` 单无任何后端出边，且复制路径无角色门禁** | `createPurchaseOrder:176` 拒绝非草稿；`dataService:499` 拒绝再审；`dataService:1297` 拒绝作废；`purchase-detail.js:79` `canCopy = order.orderStatus==='rejected'`（**无任何角色判断**） | 驳回单只能靠前端复制成新草稿；任意能打开该驳回单详情页的角色都可复制。后端 `createPurchaseOrder` 会按会话强制门店，故非本店员工复制出的单会落在自己门店——**跨门店复制风险** |
| **S-4** | **`draft` 单无法作废** | `dataService:1297` 白名单 `['submitted','approved','report_generated']` **不含 `draft`** | 草稿是永久态，只能被编辑/提交，无删除或作废出口 → 数据库持续积累废弃草稿 |
| **S-5** | **供应商可对 `submitted` 单标发货（审批前发货）** | `confirmSupplierOrder:13` `SHIPPABLE` 含 `submitted` | 设计上有意（S8），但与该单随后被 `rejected` 组合时会产生不一致：订单被驳回后 `supplier_confirmations[sid].status` 仍为 `shipped`，`getSupplierOrders:11` 靠 `HIDDEN` 隐藏而非清理 |
| **S-6** | **`supplier_confirmations` 无状态迁移约束，可自降** | `confirmSupplierOrder:73-77` 两个 action 写同一个键，只按 `order_status` 做条件更新，**不检查当前确认状态** | `approved` 状态下 `CONFIRMABLE` 与 `SHIPPABLE` 重叠（L12、L13 都含 `approved`）→ 供应商可 `confirmed → shipped → confirmed` 反复来回，`updated_by`/`updated_at` 被最后一次覆盖，**无审计痕迹** |
| **S-7** | **4 个死状态散落在 10+ 处白名单** | `createReceipt:228/392`、`getPurchaseOrders:74/84-95`、`confirmSupplierOrder:13`、`getSupplierOrders:14`、`dataService:499/538/844/1297/1348`、`meta.js:4/7/11/12` | `createReceipt:392` 的 4 态白名单**实际只有 2 个可达**（`approved`、`partial_received`）。维护者极易误以为 4 态都可达而漏加新态 |
| **S-8** | **`orderStatus` 由客户端决定 draft/submitted，但后端有白名单兜底** | `createPurchaseOrder:114` 默认 `'submitted'`、`:206-208` 白名单拦截 | **风险已被拦住**：客户端无法构造非法状态。这是 batch2 §8.5 的【待核实】项，结论见 §4 |

---

## 4. 前端 8 个【待核实】回收表

| # | batch2 位置与问题 | 结论 | 证据 |
|---|---|---|---|
| 1 | `batch2:53` 前端 `canReceive` 与云函数收货状态校验是否一致 | **成立且完全一致，无双向缺口** | 前端 3 处硬编码集 `['approved','report_generated','partial_received','to_receive']`（`purchase-list.js:123`、`purchase-detail.js:71`、`receive-list.js:46`）与 `createReceipt:228`/`:392` **逐字相同**；后端未额外放行任何状态。`report_generated`/`to_receive` 在两侧都是死状态。**注意**：`purchase-list.js:118` `canReceiveRole = role !== 'chef'` 与 `receive-verify.js:53` 拦 chef 一致，但 `receive-list.js` **无角色门禁** → chef 也能看到收货列表并点「去收货」，在 `receive-verify.js:53-57` 才被拦（多走一跳） |
| 2 | `batch2:99` `getPurchaseOrders` 的 items 形状，`approval-list` 两列是否空白 | **不成立（前端已自解）** | 后端只返回 snake_case 原始行（`getPurchaseOrders:125-127`，字段 `product_name_snapshot`/`order_qty`）；但 `approval-list.js:47-51` 现在**显式重映射** `productName: item.productNameSnapshot`、`requestedQty: item.orderQty` 后再渲染。`approval-list.wxml:17` 的 `{{prod.productName}} ×{{prod.requestedQty}}` 因此**有值**。full-scan-02 的同类结论已过期 |
| 3 | `batch2:105` / `batch2:199` `auditOrder` 对空 `items` 的处理 | **部分成立，但语义与 batch2 猜测不同——空 items = 「完全不改量」而非「按申请量全批」** | `dataService:514-516` `qtyMap` 由 `event.items` 填；空数组 → `qtyMap` 空。`:543-548` 只有 `Number.isFinite(approvedQty) && approvedQty > 0` 才更新 `purchase_order_item` → **一行都不改**。两路径效果等价（申请量=批准量），但机制是「跳过」而非「按申请量写入」。`approval-list.js:77` 快审传 `items: []`，`approval-detail.js:81` 详情传全量 `[{itemId, approveQty}]`。**上限防护在后端**：`dataService:525` `qty > Number(sourceItem.order_qty)` 直接 `-1` → **batch2 §4.3「审批量可任意超出申请量」在前端不拦，但后端拦住了**，只是前端无提示 |
| 4 | `batch2:204` 已批准/驳回单点按钮是否被服务端二次校验 | **成立，且比 batch2 预期更强：事务内复查** | `dataService:499` 前置拦 `!['submitted','pending_approval']`；`dataService:533-541` **事务内再查一次**并在状态不符时 `transaction.rollback()` → 并发双审批第二个必失败。`approval-detail.wxml` 的两个按钮确实无 `wx:if` 状态条件，但点下去必然被服务端拒绝 |
| 5 | `batch2:335` `createReceipt` 是否覆盖/忽略 `priceSnapshot` 与 `payableFlag` | **priceSnapshot 恒被覆盖；payableFlag 前端只可压低不可抬高** | `createReceipt:348-351` 无条件按 `supplier_product_price` 现取覆盖 `item.priceSnapshot` → 前端 `receive-verify.js:87` 的硬编码 `0` **完全无害**。`createReceipt:363` `payableFlag = !hardAbnormal && item.payableFlag !== false && priceSnapshot > 0` → 前端传 `true` 无效（被当作「未强制」），传 `false` 生效。前端 `receive-verify.js:88` 恒传 `true` → **当前无害，但字段本身是客户端可控的压低开关**（见 §6 P1-9） |
| 6 | `batch2:463` 服务端是否为空 `createdBy` 兜底 | **成立且更彻底：直接忽略入参** | `createPurchaseOrder:291-296` 一律取会话 `user.user_id||user._id` / `user.name||user.username`，入参 `createdBy`（L110）解构后**全函数零引用**。`createdByName` 仅进 CSV（L356）不落库。batch2 §9.2 担心的「显示名写进 purchase_order 表」不存在。**但** `purchase-create.js:329` 与 `purchase-detail.js:362` 仍在传 `createdBy: d.createdById`，属纯浪费参数 |
| 7 | `batch2:579` 服务端是否校验 `orderStatus` | **成立，有白名单** | `createPurchaseOrder:206-208` `!['draft','submitted'].includes(orderStatus)` → `-1 '采购单状态无效'`。状态跃迁风险被后端拦住（对应 §3.3 S-8） |
| 8 | `batch2:121` `getAbnormalRecords` 空 payload 是否按会话收敛 | **成立，确实按会话收敛——batch2 担心的越权不成立** | `dataService:703` `if (!GLOBAL_ROLES.includes(auth.user.role)) query.store_id = auth.user.default_store_id` → 非全局角色被强制收窄到本店；`dataService:700` chef 直接返回空数组。**但**两个新问题：① `dataService:708` `.limit(100)` **硬编码无分页**，异常超 100 条静默截断；② `dataService:704` 支持 `status` 筛选但 `abnormal-list` 走客户端过滤，服务端能力闲置。**注意**：supplier 角色会走到 L703，`query.store_id = undefined`（供应商无 `default_store_id`）——供应商侧实际通过 `getSupplierReceipts:83-96` 的另一条通道取异常，不走此函数 |

---

## 5. 旧结论复核表

> 复核对象：`full-scan-02-cloud-purchase-receipt.md` 与本批相关的条目，以及 `batch1` / controller 横向扫描中采购域条目。判定口径：**仍成立**（代码未变）/ **已修复** / **行号漂移** / **无法确认**。

| 旧编号 | 旧结论 | 当前判定 | 证据 |
|---|---|---|---|
| **H1** | `receipt_abnormal` 终态死锁，`:386` 注释与 `:392` 白名单矛盾 | **仍成立，且更严重** | `createReceipt:386` 注释、`:392` 白名单一字未变；`:387` 只拦 `received`。S8 引入 `partial_received` 使死锁可达路径从「最后一批带异常」扩大到「任一批带异常后收齐」。`dataService:1294` 仍拒绝作废该态 |
| **H2** | `createPurchaseOrder:454` catch 内引用 try 内 `const orderData` → 必然 ReferenceError | **仍成立，一行未改** | L273 `const orderData` 在外层 try 内声明；L429 `catch` 是同层兄弟块；L454 `orderData && orderData.store_id` 在外层 catch 的内层 try（L437 起）中引用。执行到该标识符即抛 `ReferenceError`，`&&` 短路轮不到。`L440` 的 `missing_reports:true` 在抛错前已落库 → **有标记、无告警消息**的孤儿状态（与 controller-20261003 H14 完全一致） |
| **H3** | 供应商订单列表全量 1000 行截断 + 排序键失效 | **仍成立，两个子问题都未改** | 截断：`getSupplierOrders:71-75` `limit(1000)` 且无 `purchase_order_id` 限定、无分页。排序：`getSupplierOrders:116` `String(b.created_at||'').localeCompare(...)`。`created_at` 由 `db.serverDate()` 写入，云函数内回读为 `Date` 对象，`String(Date)` = `"Wed Oct 04 2026 22:00:00 GMT+0800"` → **按星期名排序，跨月全乱**（`utils/cloud.js:80` 的 `instanceof Date` 分支证明项目确实会拿到 Date）。内存分页 `:118` `filtered.slice` 一并沿用 |
| **H4** | 收货无幂等键，并发双击可重复收货、批次号重号 | **仍成立** | `createReceipt` 全文无 `request_id`；`:320` `receiptId = 'RCP'+Date.now()+random3hex`；`:421-427` 批号 `txHistoryReceiptRes.data.length + 1` 在事务内但 `count` 不保证跨事务唯一 → 两个并发事务各读到同一 count → 批号重号 |
| **H5** | （full-scan-02 中 H5 归入 H4 影响） | **同上** | — |
| **M1** | `payableFlag` 客户端可单方面压低 | **仍成立** | `createReceipt:363` `item.payableFlag !== false` 一支未改。前端 `receive-verify.js:212` 恒传 `true`，故**当前无实际滥用**，但字段语义仍是客户端可控 |
| **M2** | 数量校验：严格判型制造误拒，缺整数口径 | **仍成立** | `createReceipt:197-201` `typeof item.receivedQty !== 'number'` 仍在（前端 `receive-verify.js:102` 恒产出 number，故实际不触发）；`createPurchaseOrder:232` 仍不校验整数，`3.5` 件可入库 |
| **M3** | 编辑草稿 update 影响 0 行不报错 → 孤儿明细 | **仍成立** | `createPurchaseOrder:303` `transaction...update()` 无 `stats.updated` 检查；若订单头在 L170-175 读取与 L301 事务之间被作废/删除，此处静默失败而 L304-310 仍删旧行、L323-340 仍写新行 |
| **M4** | 下单幂等查重在事务外，并发同 requestId 可重复建单 | **仍成立** | `createPurchaseOrder:141-150` 查重在 L301 事务之外，且 `request_id` 无唯一索引 |
| **M5** | `isFinalBatch` 在事务外计算 | **仍成立** | `createReceipt:373-379` 用事务前 `historyQtyMap` 算，`:509` 在事务内据它写终态 |
| **M6** | `getPurchaseOrderDetail.receipts` / 列表 items 无排序 | **仍成立** | `getPurchaseOrderDetail:100-103` receipts 无 `orderBy`；`:107-110` reports 无 `orderBy`；`:78-81` items 无 `orderBy`；`getPurchaseOrders:121-124` items 无 `orderBy`；`getReceipts:76-79` items 无 `orderBy`。**共 5 处**（旧文档列 3 处，本次补齐） |
| **M7** | `getReceipts.storeId` 是死参数 | **仍成立** | `getReceipts:44` 解构 `storeId`，`:61` 只用 `receiptDate`；`receive-list.js:28` 明确传了 `storeId`。purchaser/super_admin 侧无门店过滤能力 |
| **M8** | `confirmSupplierOrder.SHIPPABLE` 不含 `receipt_abnormal` | **仍成立** | `confirmSupplierOrder:13` 一字未变 |
| **M9** | 4 个死状态散落 8+ 处 | **仍成立，本次枚举到 10+ 处** | 见 §3.1 与 §3.3 S-7 |
| **M10** | 客户端可把全额收货行标 `isShortage` | **仍成立** | `createReceipt:325-328` 只单向强制 true |
| **M11** | 报表 `report_id` 无去重，补生成重复 | **仍成立** | `createPurchaseOrder:365/414` 幂等命名 id，写入前无查重；`dataService:1017-1020`、`:1266-1269` 只清 `missing_reports` 标记不删旧记录 |
| **M12** | `orderStatus` 无枚举校验，前端却依赖服务端筛选 | **仍成立，且本次补出服务端筛选能力更闲置** | `getPurchaseOrders:75-77` 原样入 query；后端已具备 `statusCounts`（L84-106）与 `receivable`/`to_verify` 虚拟筛选（L70-74），但 `approval-list.js:22-27` 与 `receive-list.js:20-25` 仍 `pageSize:100` + 客户端 filter |
| **L1** | `createdBy` 被忽略、`createdByName` 进 CSV | **仍成立** | `createPurchaseOrder:110` 无引用；`:356` 进 CSV「经办人」列 |
| **L4** | `supplier_confirmations` 作废后不清理 | **仍成立** | `dataService:1301-1319` 作废事务只改 `order_status`/`cancel_*`/`report_file.status`；靠 `getSupplierOrders:51` 读取端盖掉 |
| **L5** | `approved` 状态下 `confirmed`/`shipped` 可互覆 | **仍成立** | 见 §3.3 S-6 |
| **L7** | `creatorMap` 以 `user_id` 为键 | **仍成立** | `getPurchaseOrders:134-135` `where({user_id: _.in(idChunk)})` + `creatorMap[user.user_id]`；写入端 `createPurchaseOrder:293` 用 `user.user_id \|\| user._id` → `_id` 兜底情形查不到显示名，`:139` 回退到 `created_by_name` 或裸 id |
| **L8** | `store` 集合被重复查询 3 次 | **仍成立** | `createReceipt:178`、`:188`、以及 `:231` 附近；无害 |
| **L9** | `receipt` 主表不落金额 | **仍成立** | 金额只在 `receipt_item.price_snapshot` 与报表 CSV 中；`getSupplierReceipts:109` 现算 |
| **batch2 §1** | `purchase-detail.js:153` `that is not defined` | **✅ 已修复** | 当前 `purchase-detail.js:154` 为 `this.loadData()`，`submitVoucher` 有完整 `try/catch/finally`（`:137-163`）且 `this._submitting` 在 finally 复位 |
| **batch2 §4.3** | 审批量可任意超出申请量 | **部分修复** | 前端 `approval-detail.js:73` 仍只校验 `> 0` 无上限；但**后端 `dataService:525` 已拦**（`qty > Number(sourceItem.order_qty)` → `-1`）。风险从「数据被污染」降为「前端无提示、用户要重填」 |
| **batch2 §5.4** | 补结算无角色条件、点按钮必 403 | **✅ 已修复** | `receive-list.js:87` 新增 `canSettle`，`receive-list.wxml` 应按 `canSettle` 隐藏 |
| **batch2 §9.2** | `user.name` 兜底为 ID 三处同源 | **✅ 后端已中和** | `getPurchaseOrders:55` 对 chef 强制用 `user.user_id||user._id`，**忽略前端传的 `createdBy`**；`createPurchaseOrder:291-296` 忽略 `createdBy`。故 `purchase-list.js:64`/`receive-list.js:23`/`purchase-create.js:329` 的兜底值**不再造成数据污染**，最坏是无害浪费参数 |
| **batch2 §9.5** | `approval-list`/`receive-list` 100 条截断 | **仍成立，且本次定性为 P1 功能阻断** | `approval-list.js:26` `pageSize:100`（无 `page`、无 `orderStatus`）+ `:36` 客户端 filter；`receive-list.js:24` 同。后端 `getPurchaseOrders:111` 按 `created_at desc` 排序 → **取到的是最新 100 单，其中待审批/待收货的单子超 100 后永久不可见**，无任何提示 |
| **batch1 §6.3 / 横向扫描「附」** | 4 个死状态 | **仍成立** | 见 §3.1 |
| **batch1 跨批次 #2** | 两个取消白名单不一致 | **✅ 已确认成立** | 见 §3.3 S-2 |
| **batch1 §23 #4** | `verify_amount` 未做 2 位小数舍入 | **仍成立** | `dataService:1509` 只校验 `Number.isFinite(amount) && amount > 0`；前端 `purchase-detail.js:204` `parseFloat(input)` 同样无小数位限制 → `12.345` 可入库。报表侧 `toFixed(2)` 会四舍五入展示，但**库里存的是三位小数** |
| **controller-20261003 H14** | `createPurchaseOrder:454` ReferenceError 复核 | **仍成立（一行未改）** | 见 H2 |
| **controller-20261003 H17** | 门店切换对门店角色是纯装饰 | **仍成立** | `createPurchaseOrder:161-167` 强制 `default_store_id`；`getPurchaseOrders:56-59` 忽略前端 `storeId` |
| **controller-horizontal F5-2** | `regenerateOrderReports` 无调用方，订货报表缺补生成入口 | **仍成立** | `dataService:1546` 有 `case 'regenerateOrderReports'`，但 `pages/` 下无调用点（`receive-list.js:139-160` 只有 `regenerateReceiptReports` 按钮）。**订货类报表①②一旦生成失败，只能靠改 `missing_reports` 标记等人发现** |
| **controller-horizontal F7** | `pending_approval` 死状态但前端仍引用 | **仍成立** | `approval-list.js:36` 仍在 filter 里引用 |
| **横向扫描 H11** | JS 端字符串排序危险 | **仍成立** | `getSupplierOrders:116` 唯一命中点 |

---

## 6. 新问题清单（P0/P1/P2）

### 🔴 P0

**P0-1｜`getPurchaseOrders` 明细查询 `.limit(1000)` 在默认分页下就会截断**
`getPurchaseOrders:119-124`：订单号按 20 个/块查询 `purchase_order_item`，`.limit(1000)`。而 `createPurchaseOrder:210` 明确允许单单 100 行明细 → 20 单 × 100 行 = **2000 行 > 1000**。
- **触发门槛极低**：`pageSize` 默认 20（L45）正好等于分块大小，只要**任意 20 单中平均 ≥51 行**就截断。手动单上限 5 行（`:259`），所以只需档案单偏大。
- **后果**：`getPurchaseOrders:127` 按 `purchase_order_id` 分组，被截断的订单其 `items` 为空数组（`:140` `itemGroups[...] || []`）→ 前端 `purchase-list.js:129` `itemCount: o.items.length` **显示 0 种商品**，`purchase-list.js:121` `manualCount` 归零，`approval-list.js:47-51` 的商品 tag 整行消失。**不报错、不告警**。
- **对比**：`getSupplierOrders:71-75` 的 1000 截断需要供应商累计 1000 行（full-scan-02 H3），门槛高一个量级；本条**在首页级功能上触发**。
- 建议：改为按 `purchase_order_id` 分组逐单查（受 §2.2 的 14 次调用成本影响），或把明细查询下推为子查询式的分页内嵌。

**P0-2｜CSV 公式注入防护不完整：`\t`/`\r`/`\n` 开头单元格可执行公式**
`createPurchaseOrder:42-47` `csvField`：
```js
if (/^[=+\-@]/.test(s)) s = "'" + s
```
只拦 4 个字符。**OWASP 的 CSV 注入触发集还包括 `\t`（制表符）、`\r`、`\n`**——以这些字符开头的单元格同样会被 Excel/WPS/LibreOffice 解析为公式，而这里的正则 `^[=+\-@]` 不匹配。
- **可控输入路径**：`items[].remark`（`createPurchaseOrder:232-254` 只校验 productId/qty，**remark 零校验零长度限制**）→ `:336` 原样落 `purchase_order_item.remark` → `:359` 写入门店下单报表「备注」列、`:407` 写入供应商订货汇总「备注」列。
- **攻击者**：任意 chef 或 store_manager（下单角色白名单 `:101` 含 chef），无需任何管理员权限。
- **影响**：供应商/门店管理员在 Excel 打开报表时公式被执行（`cmd|'/C calc'!A0`、`WEBSERVICE()` 拉远程内容、`HYPERLINK()` 钓鱼链接）。
- 建议：正则改为 `/^[=+\-@\t\r\n]/`；同时对 `remark` 加长度上限（与 `createReceipt:215` 照片校验那种「客户端输入必须设界」的口径一致）。

### 🟠 P1

**P1-3｜门店停用后在途订单永久卡死**
`createPurchaseOrder:164`/`:198` 与 `createReceipt:178`/`:188` 都要求 `store where {store_id, status:1}`；而 `getPurchaseOrders`、`getPurchaseOrderDetail`、`confirmSupplierOrder`、`getSupplierOrders` **均不检查门店状态**。
- 结果：门店被停用后，历史采购单与收货记录**全部仍可正常查看**（含金额与凭证），供应商**仍可确认接单/标记发货**，但**该门店所有 `approved`/`partial_received` 在途订单永久无法收货、永久无法作废闭环**（`dataService:1297` 白名单不含 `partial_received`）。
- 这与 batch1 §23 提到的 `setStoreStatus` 停用前置检查配合后，**停用动作本身会因在途订单被拒**——但如果管理员绕过（例如先作废 `submitted` 单，留下 `approved`/`partial_received` 单），就会卡死。
- 建议：门店停用应要求「无在途订单」为前置条件并在同一校验内检查 `approved`/`partial_received`；或收货时不因门店停用而拒绝对在途订单的收尾。

**P1-4｜供应商侧订单头字段泄漏（跨供应商情报 + 内部字段）**
`getSupplierOrders:126-129` 以 `{...order, items}` 全量下发 `purchase_order` 文档。商品行本身按 `supplier_id` 正确隔离（`:71`），但**订单头泄漏**：
- `supplier_confirmations`：包含**同单其他供应商的 `supplier_id` 与其确认/发货状态** → 供应商 A 可枚举同单供应商名单并获知谁已确认、谁已发货（排他性情报）。
- `created_by_name`、`created_by`、`remark`（门店侧备注）、`delivery_date`、`is_manual`、`verify_status`、`cancel_requested`、`audit_remark`、`backfilled`、`missing_reports`。
- 同型问题：`getSupplierReceipts:104` `{...item, ...}` 全量下发 `receipt_item`，泄漏门店侧 `remark`（验收备注）、`is_shortage`/`is_quality_issue`/`is_wrong_item`/`payable_flag`、`order_qty_snapshot`。异常记录 join（`:83-86`）倒是正确加了 `supplier_id` 过滤。
- **不构成越权写入**：`confirmSupplierOrder:65-69` 必须证明订单真的含本供应商商品，无法据此确认别人的行。故定级 P1 而非 P0。
- 建议：两处都改为白名单下发（与 `dataService:718-730 getAbnormalRecords` 的 10 字段白名单口径一致），供应商侧只给 `purchase_order_id`/`order_date`/`delivery_date`/`store_name`/`my_confirm_status`/本供应商明细。

**P1-5｜下单幂等查重在事务外，且无唯一索引（M4 复核 + 前端无防抖放大）**
`createPurchaseOrder:141-150` 查重 → L301 才进事务，两者之间无锁。`request_id` 未建唯一索引 → 同 requestId 并发两笔都查空、都建单。
- **前端放大路径（batch2 已提但本次确认后端也未兜住）**：`purchase-detail.js:304-338 copyToDraft` 与 `:340-377 submitRequest` **完全没有 `_submitting` 防抖**（对比 `approval-detail.js:67-70`、`:94-99` 有完整 `try/finally`）。`_genRequestId`（`:289-296`）保证同 kind 同键，但**键相同只能挡住串行重试，挡不住并发双发**。
- `purchase-create.js:340-343` 的防抖置位在 `await util.showConfirm` **之后**（注释 `:30-31` 声称要防的正是这个窗口）→ 弹窗期间双击并发两笔，`purchase-create.js:337` 的 requestId 相同 → 落到 M4 的后端缺口。
- 建议：`purchase_order` 对 `request_id`（非空）建唯一索引；前端把 `setData({isSubmitting:true})` 移到 confirm 之前（`receive-verify.js:181` 是正确写法）。

**P1-6｜5 处查询无 `orderBy`，明细/批次/报表顺序由存储顺序决定**
- `getPurchaseOrders:121-124` items 无 `orderBy` → `purchase-list` 明细展示顺序、`itemCount` 不稳定
- `getPurchaseOrderDetail:78-81` items 无 `orderBy`
- `getPurchaseOrderDetail:100-103` receipts **无 `orderBy` 且 `limit(100)`** → `receive-verify.js:23` 补偿逻辑取 `receipts[0]` 判定「本次单」，分批收货下**可能取到旧批次**
- `getPurchaseOrderDetail:107-110` reports 无 `orderBy`
- `getReceipts:76-79` items 无 `orderBy`
- 对比 `getPurchaseOrders:111` 与 `getReceipts:66` 的主表都有 `orderBy('created_at','desc')` —— **主表规范、从表缺失**，属同一作者的疏漏。
- 注：`purchase_order_item.item_id` 形如 `${orderNo}_1` / `_10`，若用字符串 `orderBy('item_id')` 会错排（`1,10,2`）；需引入数字序号字段或按 `_id` 插入序。

**P1-7｜`receipt.missing_reports` 一旦写入永不重置**
`createReceipt:702`（`purchase_order`）与 `:706`（`receipt`）都写 `missing_reports:true`；补生成只清 `purchase_order`（`dataService:1017-1020`、`:1266-1269`），**全项目无任何清除 `receipt.missing_reports` 的代码**。
- 后果：`receive-list.js:74` `missingReports: !!receipt.missing_reports` 恒为 true → **补生成按钮永久可见**，管理员可无限重复点补生成；且报表已齐，UI 仍显示「缺报表」。
- 叠加 M11（`report_id` 无去重）→ 每次点击都追加一份新报表记录，报表历史页重复。

**P1-8｜`approval-list` / `receive-list` 的 100 条截断是功能性阻断（复核升级为 P1）**
`approval-list.js:22-27`（`pageSize:100`、无 `page`、无 `orderStatus`）+ `:36` 客户端 filter；`receive-list.js:20-25` 同型。后端 `getPurchaseOrders:111` 按 `created_at desc` 排序、`pageSize` 上限 100（`:45`）。
- 结果：**该角色/门店名下订单总数 > 100 后，超出部分中的待审批单与待收货单被静默丢弃**，管理员看不到、也无「还有更多」提示。后端已具备 `receivable` 虚拟筛选（`:73-74`）与 `statusCounts`（`:84-106`），**修复条件齐备但前端未用**。
- 与 §6 P0-1 组合后：即使列表页不截断，单个订单的明细也可能被 1000 上限截断。

**P1-9｜`payableFlag` 与异常标记均为客户端可控的单向压低开关（M1 复核）**
`createReceipt:363` `payableFlag = !hardAbnormal && item.payableFlag !== false && priceSnapshot > 0`；`:281` `isQualityIssue`/`isWrongItem` 直接透传。
- 当前前端 `receive-verify.js:88,212` 恒传 `payableFlag:true`，UI 无控件 → **现状无害**。
- 但字段语义是「客户端传 `false` 即生效」，配合 `:357` `hardAbnormal`（非 shortage 的异常即剔除出付款）→ 店长可对本店订单把全额到货行标 `isQualityIssue` 或传 `payableFlag:false`，**该行不进任何带价账单、无需任何审批闸、且无审计痕迹区分「真异常」与「人为压价」**。
- 建议：`payableFlag` 完全由服务端派生（删除 `item.payableFlag !== false` 一支）；客户端可控的异常标记改为需 `abnormal_record` 侧二次确认才生效。

**P1-10｜`getSupplierOrders` 全量拉取 + 内存排序键失效（H3 复核，确认未修）**
见 §5 H3。两个子问题均一字未改：`getSupplierOrders:71-75` 无分页 `limit(1000)`；`:116` `String(created_at).localeCompare` 按星期名排序。

### 🟡 P2

**P2-11｜草稿单无法作废、无删除出口**
`dataService:1297` `cancelOrder` 白名单 `['submitted','approved','report_generated']` 不含 `draft` → 草稿是永久态，只能编辑/提交。废弃草稿持续积累，且 `getPurchaseOrders:86` 的 `draft` tab 计数只增不减。

**P2-12｜`requestCancel` 与 `cancelOrder` 白名单不一致导致「永久待确认」的孤儿标记**
见 §3.3 S-2。`dataService:1348` 允许 `partial_received` 申请取消，`:1294` 拒绝其作废 → 申请必然被拒，且 `cancel_requested:true` 让 `purchase-detail.js:85` 永久隐藏申请入口。建议两处白名单收敛为同一常量。

**P2-13｜`supplier_confirmations` 无状态迁移约束（S-6）**
`confirmSupplierOrder:73-77` 两个 action 写同一键，只按 `order_status` 条件更新，不检查当前确认状态 → 供应商可 `shipped → confirmed` 自降。建议条件更新里追加 `supplier_confirmations.<sid>.status` 的前置约束（如 `ship` 要求当前非 `shipped`，`confirm` 要求当前非 `shipped`）。

**P2-14｜`verify_amount` 与 `order_qty` 均无精度/整数约束**
`dataService:1509` `Number.isFinite(amount) && amount > 0` → `12.345` 可入库（报表侧 `toFixed(2)` 展示时四舍五入，库与报表口径不一致）；`createPurchaseOrder:232` 只校验 `>0 && <=1000000` → `3.5` 件可下单。与 M2 同型。

**P2-15｜`receiptDate` 由客户端时钟决定**
`receive-verify.js:201` `receiptDate: util.formatDate(new Date())`，`createReceipt:316-318` 校验格式后接受 → 客户端时钟可被篡改，任意历史/未来收货日期可入库（早于今日打 `backfilled` 标记，`:435`，**可追溯但不拦截**）。采购侧 `createPurchaseOrder:131-132` 只要求 `deliveryDate >= orderDate`，不限制未来日期 → 采购日期也可选任意未来日期。

**P2-16｜异常记录列表无分页，硬编码 100 条**
`dataService:708` `.limit(100)`，`abnormal-list` 又在此基础上做客户端状态过滤（`dataService:704` 的 `status` 筛选参数闲置）。异常超 100 条后**最早的静默丢失**。同时 `getAbnormalRecords` 返回体白名单（`:718-730`）**不含 `receipt_id`/`purchase_order_id`/`product_id`**（controller-20261003 H12 已确认），异常记录无法跳回原收货单/采购单/商品，两侧无法互跳对账。

**P2-17｜`getReceipts.storeId` 死参数（M7 复核）**
`getReceipts:44` 解构未使用；`receive-list.js:28` 明确传了。purchaser/super_admin 侧无按门店筛选收货记录的能力，只能退而依赖 `getPurchaseOrders` 的 `receivable` 虚拟筛选。

**P2-18｜无默认供应商的商品永远不出现在任何供应商报表**
`createPurchaseOrder:250` `supplierId: product.default_supplier_id || ''` → 空供应商；`:378-382` 归入 `unknown` 组；`:398-399` 循环 `if (sid === 'unknown') continue` 跳过 → **该类商品的明细既不进任何 `supplier_order_report`，也不会被任何供应商看到或确认**。`getSupplierOrders:71` 同样按 `supplier_id` 过滤，空供应商行对全部供应商不可见。属静默漏单，前端 `purchase-create` 无任何提示。

**P2-19｜`getPurchaseOrders` 每次翻页 11~14 个 DB 请求**
`:84-95` 9 个并行 `count()` + `:108` 1 个 `count()` + `:109-114` 1 个 `get()` + 明细分块 `get()` + 创建人分块 `get()`。`statusCounts` 与 `total` 分两次请求（`:108` vs `:84-95`）→ **翻页期间计数可能 ±1 抖动**（L6 已提）。`getPurchaseOrders:131-135` 的创建人查询上限 20 个/块但 `.limit(100)`，与 L7 的 `user_id` 键问题叠加。

**P2-20｜幂等命中分支不返回 `reportWarning` 与 `missing_reports`**
`createPurchaseOrder:157-159` 幂等命中返回 `{orderId, reportGenerated:false, reportsGenerated:0, idempotent:true}`，**不带 `reportWarning`**。若首次请求订单已落库但报表生成失败（L433-466 路径，已打 `missing_reports:true`），用户超时重试会命中幂等分支，前端 `purchase-create.js:417-424` 读到 `reportWarning` 为空 → 显示「采购申请已提交，下单报表已自动生成」**——实际报表没生成**。用户永远看不到失败提示，只能等超管来查 `missing_reports`。建议幂等分支回查 `missing_reports` 并透传。

**P2-21｜CSV 中客户端可控文本不止 `remark`**
`createPurchaseOrder:356` 把客户端 `createdByName` 写入 CSV「经办人」列；`purchase-detail.js:362` `createdByName: d.createdBy`（取的是**显示名**）→ 采购员代提交他人草稿时，可把任意字符串写进报表。虽经 `csvField` 引号包裹无逗号逃逸，但结合 P0-2 的制表符缺口，**代提交者可以注入公式**。

**P2-22｜`product.category_name` 空值时把分类编码当分类名**
`createPurchaseOrder:248` `product.category_name || product.category_level_1 || item.category || ''`。`dataService:109-111 saveProduct` 三个字段都写（`category_level_1` 存**一级分类编码**，`category_name` 存二级名称），所以正常数据 `category_name` 非空。**但** `importProducts`（Excel 批量导入，commit `ede7bcb`）若只写了 `category_level_1`，`category_snapshot` 就会写入编码而非名称，报表「分类」列与 `approval-detail.js:41` 的「规格」列（本应显示规格、实际显示品类）一起失真。**与 batch1 漂移 D（`category_snapshot` 两种格式并存）同源**，需核实 importProducts 是否写 `category_name`【待核实】。

---

## 7. 遗留【待核实】

以下问题**无法仅凭代码判定**，需实测或跨批次确认：

1. **【承接 batch1 §23 #1】`transaction.rollback({code,msg})` 的参数是否进入 `err.errMsg`** —— `dataService:539` 带对象参数 rollback，`:561` 依赖 `err.errMsg.includes('该订单已经审核')`。若 SDK 不序列化该对象，用户看到的是通用报错而非友好文案。**功能不受影响**（仍能拦住重复审批），只影响文案。需实测 wx-server-sdk。

2. **【承接 batch1 §23 #2】`.where({$or: [...]})` 字面量是否被 SDK 识别** —— `dataService:1412-1415` `remindAudit` 的条件更新用 `$or` 字面量，官方写法是 `_.or([...])`。若不被识别，`updated===0` → **催审功能对所有订单静默失效**（用户总收到「已催办过」）。同函数 `getMessages:623-626` 用的是 `_.or([...])` 正确写法——**同一文件两种写法并存**，风险面收窄到 `remindAudit` 一处。需实测。

3. **【承接 batch1】`created_at` 在云函数内的回读形态** —— 决定 H3/P1-10 的排序问题严重度。`utils/cloud.js:80` 有 `instanceof Date` 分支，但那是**前端**（云函数返回值经 JSON 序列化后变 ISO 字符串）。**云函数内部** `db.collection().get()` 对 `db.serverDate()` 写入的字段是否返回 `Date` 对象需实测一次 `getSupplierOrders` 的 `String(created_at)` 结果。若是 Date 对象则 `getSupplierOrders:116` 按星期名排序（跨年/跨月全乱）；若是 ISO 字符串则该问题不成立、排序正确。

4. **【承接 batch1】`supplier_product_price` 的 `(supplier_id, product_id, is_current)` 唯一性** —— `createReceipt:342-346` 按该组合建 map，若存在多条 `is_current:1` 记录则后者覆盖前者且无告警，**直接影响金额准确性**。需 `updateProductPrice` / `dataService` 侧确认是否保证唯一。

5. **【承接 batch1 漂移 D】`importProducts` 是否写 `product.category_name`** —— 决定 P2-22 是否成立。若只写 `category_level_1`，所有 Excel 导入商品的采购单 `category_snapshot` 都会是编码而非名称。

6. **【承接 batch1 §23 #4】前端 `purchase-detail.js:204` 的 `parseFloat(input)` 是否已格式化为两位小数** —— 代码上看没有（`:204` 直接 `parseFloat`，无 `toFixed`），但需确认 UX 上是否会阻止用户输入三位小数（`util.js:101-116 showPrompt` 若带 inputType 限制则不同）。

7. **【跨批次】`regenerateOrderReports` 是否有前端入口的计划** —— controller-horizontal F5-2 已确认「无调用方」，订货类报表缺报表后的补偿路径目前只剩 `missing_reports` 标记 + 一条**必然写不进去**的通知（H2）。这是当前采购域**兜底链路最薄弱处**，需产品侧确认是「有意不提供」还是「漏做」。

8. **【跨批次】`receipt_item` / `purchase_order_item` 的 `limit(1000)` 假设** —— 多个函数（`createReceipt:239/255/402/423`、`getPurchaseOrderDetail:80`、`getReceipts:78`、`getPurchaseOrders:123`）都假设单订单明细 ≤1000，而 `createPurchaseOrder:210` 已把上限锁在 100，**单单维度安全**；但 P0-1 证明**分块查询维度不安全**（20 单 × 100 行 = 2000 > 1000）。这是「单文档上限」与「查询批次上限」两个不同维度的混淆。

---

## 附：本批确认的良好设计（避免只报问题）

- `createPurchaseOrder:141-159` 幂等键 + 「本次正在编辑的同一草稿」例外口子，语义正确，避免「同页改内容再保存被静默短路」。
- `createPurchaseOrder:160-167` 非全局角色**无条件丢弃客户端 storeId/storeName**，门店名一律从库取 → 前端 `purchase-create.js:324-325` 的上送值完全无害。
- `createPurchaseOrder:212-213` 注释「客户端快照只是展示数据」与实现一致：L244-253 全部从 `product` 集合重建快照。
- `createPurchaseOrder:301-341` 订单头与全部明细同事务，编辑态先删旧行后写新行，头行一致性正确。
- `createPurchaseOrder:429-469` catch 里区分「订单已落库」与「未落库」，前者返回 `code:0 + reportWarning` 而非错误 → 避免客户端重试造成重复建单。**兜底意图正确，只是 L454 一处作用域错误让它失效**（H2）。
- `getPurchaseOrders:84-106` `statusCounts` 基于剔除当前 tab 过滤的 baseQuery 统计，不受 tab 切换影响——**正确做法**。
- `getPurchaseOrderDetail:57-67` 鉴权与列表口径逐字一致，无「列表看不到、详情可打」的越权缝。
- `getPurchaseOrderDetail:86-97` chef 不补供应商名、`:111-113` chef 只看 `report_scope==='store'` 的报表 → 信息边界干净。
- `getSupplierOrders:71` 明细按 `supplier_id` 隔离 + `is_manual: _.neq(true)` 双保险，**不会泄漏同单其他供应商的商品**（订单头泄漏是另一问题，P1-4）。
- `confirmSupplierOrder:55` `supplierId` 服务端派生不接客户端参数；`:65-69` 必须证明订单含本供应商商品；`:78-83` 条件更新原子「检查状态+写入」→ **全项目最干净的一处并发防护**。
- `createReceipt:197-201` 与 `:280-290` 明细以 DB 值为权威重建，客户端 `productName`/`unit`/`orderQty`/`priceSnapshot` 一律被覆盖 → **价格与商品身份不可伪造**。
- `createReceipt:591-593`、`:674-676` 逐行先舍入到分再累加，保证「各行小计之和 = 合计」，报表侧金额一致。
- `dataService:533-541` 审批事务内复查状态 → 并发双审批第二个必失败，**审批侧无并发缺口**。
- `utils/cloud.js:78-110 parseDateValue` 对 Date/秒毫秒/`$date`/`seconds`+`nanoseconds`/`toDate()` 全覆盖，是项目里最健壮的一段。
- `utils/cloud.js:56-64 callFunction` 自动注入 authToken；`:68-70` 统一 `-401` 跳登录（**仅对顶层 `code:-401` 生效**，dataService 的嵌套 `{error:{code}}` 不触发，见 controller-20261003 H10）。
- 5 个目标云函数的 `getSessionUser` 逐字一致、无漂移。
