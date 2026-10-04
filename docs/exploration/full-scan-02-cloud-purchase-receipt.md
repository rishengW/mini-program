# 批 2：采购 / 收货 / 供应商确认 云函数全量扫描

> 范围：`cloudfunctions/{createPurchaseOrder,getPurchaseOrders,getPurchaseOrderDetail,createReceipt,getReceipts,confirmSupplierOrder,getSupplierOrders,getSupplierReceipts}`（8 个 index.js + 8 个 package.json）
> 方法：逐行读代码，不采信注释。结论均带 `文件:行号`。拿不准标【待核实】。
> 与 batch1 的重叠：batch1 已覆盖 `createPurchaseOrder` / `createReceipt` 的鉴权复制与事务概况，本文不重复其「技术底座/鉴权模型」章节，但**在下文逐函数章节里会指出 batch1 未覆盖的实现级缺陷**（见问题清单 H1、H2）。
> 与 batch2（前端）的关系：本文末尾「batch2 待核实项结论」逐一回收 batch2 末尾的 8 个【待核实】。

---

## 0. 文件覆盖清单

| 路径 | 行数 | 一句话职责 |
|---|---|---|
| `cloudfunctions/createPurchaseOrder/index.js` | 471 | 创建/编辑采购单（订单头 + 明细事务写入），提交后自动生成门店下单报表 + 供应商订货汇总报表 |
| `cloudfunctions/getPurchaseOrders/index.js` | 148 | 采购单列表：按角色收敛范围、9 组状态计数、分页、批量拼明细与下单人显示名 |
| `cloudfunctions/getPurchaseOrderDetail/index.js` | 129 | 采购单详情：主表 + 明细（非 chef 补供应商名）+ 关联收货单 + 关联报表（chef 只给 store 维度） |
| `cloudfunctions/createReceipt/index.js` | 752 | 分批收货验收：以订单明细为准的规范校验、协议价现取、异常登记、订单状态推进，事务后生成 4 类报表 |
| `cloudfunctions/getReceipts/index.js` | 92 | 收货记录列表（chef 直接返回空），分页 + 批量拼明细 |
| `cloudfunctions/confirmSupplierOrder/index.js` | 124 | 供应商确认接单 / 标记发货，写入 `purchase_order.supplier_confirmations[supplierId]`，条件更新防竞态 |
| `cloudfunctions/getSupplierOrders/index.js` | 136 | 供应商视角订单列表：只嵌本供应商明细、派生 5 态、内存分页 |
| `cloudfunctions/getSupplierReceipts/index.js` | 119 | 供应商视角收货明细平铺：join 收货主表取日期/门店，join 异常记录取裁决，后端算金额 |
| 各 `package.json` | 6~13 | 8 个均只依赖 `wx-server-sdk: ~2.6.3`，与 batch1 结论一致，无共享模块 |

---

## 1. `createPurchaseOrder`（471 行）

### 1.1 入口与入参契约

单入口 `exports.main`，无 action 分支。入参（`L104-116`）：

| 入参 | 必填 | 校验 | 行号 |
|---|---|---|---|
| `authToken` | 是 | `getSessionUser` | L99-100 |
| `orderId` | 否 | 有值则必须是 `order_status==='draft'` 的既有单 | L169-178 |
| `storeId` / `storeName` | 条件 | 非全局角色被服务端强制覆盖为 `user.default_store_id` + 门店表真名 | L161-167 |
| `orderDate` | 否 | 默认服务端 UTC+8 当日 | L119-120 |
| `deliveryDate` | 否 | 默认回退 `orderDate` | L125 |
| `createdBy` | 否 | **完全忽略**（解构后无任何引用） | L110 |
| `createdByName` | 否 | 仅进入 CSV「经办人」列，不落库 | L356 |
| `items` | 是 | 数组非空、≤100 行 | L203、L210 |
| `items[].productId` | 条件 | 空/非档案商品必须为手动商品 | L228-239 |
| `items[].orderQty` | 是 | `Number()` 有限、`>0`、`<=1000000`，**无整数校验** | L231-233 |
| `remark` | 否 | 无长度限制 | L288 |
| `orderStatus` | 否 | 白名单 `['draft','submitted']`，默认 `submitted` | L114、L206 |
| `requestId` | 否 | 幂等键，按 `request_id + created_by` 查重 | L139-150 |

### 1.2 读写集合与状态变更

- 读：`app_user`（会话）、`store`、`product`（`status:1`，20 条分块）、`supplier`、`purchase_order`、`purchase_order_item`、`report_version_counter`
- 写：`purchase_order`（add/update）、`purchase_order_item`（add，编辑时先逐条 remove）、`message`、`report_file`、`report_version_counter`
- 状态：新建 `draft|submitted`；编辑仅限 `draft → draft|submitted`；`submitted` 之后本函数**不可再编辑**（L176-178）

### 1.3 关键机制

- **事务**：`db.runTransaction`（L301-341）包裹订单头 + 全部明细 + 编辑态删旧明细 —— 头与行同提交同回滚，正确。
- **幂等**：L141-150 查重命中直接返回原单号，且对「本次正在编辑的同一草稿」开了例外口子（L157）—— 语义正确，但**查重在事务外**（见问题 M4）。
- **报表在事务外**：L352-423 生成失败不回滚订单，改为打 `missing_reports: true` + 定向通知（L433-466）—— 补偿设计合理，但通知写入有确定性缺陷（H2）。
- **拆单/手动单**：`manualCount>5` 拒绝（L259）、手动与档案混单拒绝（L263-264），与前端 S9 拆单口径一致。
- **无价格**：`purchase_order_item` 持久化字段（L326-338）里**没有任何单价/金额字段**。下单阶段不存在价格快照，价格在收货时现取（见 §4）。

### 1.4 返回体

- 成功：`{code:0, data:{orderId, reportGenerated, reportsGenerated[, idempotent, reportWarning]}}`
- 失败：`{code:-401|-403|-1, msg}`（无 `data` 字段）
- 结构统一，全部 `{code,msg,data}` 形态。

---

## 2. `getPurchaseOrders`（148 行）

### 2.1 入参契约

| 入参 | 默认 | 说明 | 行号 |
|---|---|---|---|
| `page` | 1 | `max(1, min(1000, floor(Number()||1)))` | L44 |
| `pageSize` | 20 | `min(100, max(1, ...))` | L45 |
| `role` | — | **解构后未使用**（L43），范围完全由会话角色决定 | L43 |
| `storeId` | — | 仅全局角色生效 | L62 |
| `createdBy` | — | 仅全局角色生效 | L63 |
| `orderStatus` | — | 原样入 query，无枚举校验；另有 `to_verify` / `receivable` 两个虚拟筛选 | L70-78 |
| `orderDate` | — | 精确等值 | L78 |

### 2.2 角色收敛（无越权）

- `chef`：`store_id = default_store_id` **且** `created_by = 自己`（L51-55）
- `store_manager`：仅 `store_id`（L56-59）
- `super_admin` / `purchaser`：可加 `storeId` / `createdBy` 筛选（L60-63）
- `supplier`：落入 else → `-403`（L64-66）—— **供应商侧与内部侧边界确实隔开**

### 2.3 返回体字段（前端契约的关键）

`data` 每项 = `...order`（原始 snake_case 全量保留）+ `created_by_name` 兜底 + `items`（**原始 `purchase_order_item` 文档，snake_case**：`item_id` / `product_id` / `product_name_snapshot` / `category_snapshot` / `unit_snapshot` / `order_qty` / `is_manual` / `supplier_id`）。

- 顶层：`{code:0, data, total, page, pageSize, statusCounts}`（L143）
- `statusCounts` 9 个键：`all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable`（L96-106），统计基于「角色约束但不含当前 orderStatus」的 baseQuery（L81-83），不受 tab 切换影响 —— 正确做法。

### 2.4 缺陷

- items / 主表查询均**无 `orderBy`**（L119-124、L121-124）：明细顺序不确定，`item_id` 形如 `PO…_1/_2/_10`，字符串序会错排。
- `creatorMap` 以 `user_id` 为键（L134-135），而写入端用 `user.user_id || user._id`（createPurchaseOrder:292）→ 只有 `_id` 兜底的账号查不到显示名（L25）。
- `count` 与 `get` 分两次请求（L108-114），翻页期间可能 ±1 抖动。

---

## 3. `getPurchaseOrderDetail`（129 行）

### 3.1 鉴权

`L58-67`：非全局角色必须 `chef|store_manager`；必须 `order.store_id === user.default_store_id`；`chef` 还必须是自己创建的。**与 §2.2 的列表口径完全一致，无「列表看不到、详情可打」的越权缝。**

### 3.2 信息边界（做得对的地方）

- 供应商名只给非 chef（L85-97）
- 报表元数据（含供应商名）对 chef 过滤为 `report_scope==='store'`（L107-113）
- 全量 `...order` 下发（含 `supplier_confirmations` / `verify_status` / `missing_reports` / `verify_voucher_file_ids`），前端 `purchase-detail.js:37` 读的是 `result.data.supplier_confirmations`（snake）—— **匹配，可用**。

### 3.3 返回体

`{code:0, data:{...order, created_by_name, items, receipts, reports}}`

### 3.4 缺陷

- `receipts` 查询**无 `orderBy`**（L100-103），`limit(100)`：分批收货下批次顺序由存储顺序决定，`receive-verify.js:25` 取 `receipts[0]` 作为「已收货补偿」判据 —— 并发分批时可能取到非最新批次。
- `items` / `reports` 同样无 `orderBy`。
- `created_by_name` 兜底链（L68-75）与列表侧 §2.4 同一个 `_id` 缺口。

---

## 4. `createReceipt`（752 行）—— 本批最复杂，问题也最集中

### 4.1 入参契约

| 入参 | 必填 | 校验 | 行号 |
|---|---|---|---|
| `authToken` | 是 | 角色白名单 `['store_manager','super_admin','purchaser']` —— **chef 被明确拒绝** | L164 |
| `purchaseOrderId` | 是 | 必须存在 | L182-184、L217-223 |
| `storeId` | 条件 | 非全局强制为 `default_store_id`，且必须等于 `order.store_id` | L175-190、L225-227 |
| `receivedBy` | 否 | **被服务端覆盖**为 `user.name||user.username||receivedBy` | L232 |
| `overallRemark` | 否 | 无长度限制 | L170 |
| `photoFileIds` | 否 | 数组、≤9、每个必须包含子串 `receipts/<purchaseOrderId>/` | L205-215 |
| `items` | 是 | 数组非空、≤100 | L191-196 |
| `items[].orderItemId` | 是 | 必须在订单明细中、本批内不重复 | L263-270 |
| `items[].receivedQty` | 是 | `typeof === 'number'`（**严格判型**）、有限、`>=0`；累计 ≤ order_qty | L197-201、L271-279 |
| `items[].orderQty` | 是 | 必须上送且为 number，**但随后被 DB 值覆盖** | L197-201、L287 |
| `items[].productName` / `unit` | 是 | 必须上送，**但随后被 DB 值覆盖** | L197-201、L284/288 |
| `items[].isQualityIssue` / `isWrongItem` / `isShortage` | 否 | 客户端可控，仅 `isShortage` 会被服务端强制置 true（单向） | L325-328 |
| `items[].priceSnapshot` | 否 | **恒被服务端覆盖** | L348-351 |
| `items[].payableFlag` | 否 | **只能压低不能抬高** | L363 |
| `receiptDate` | 否 | 严格 `YYYY-MM-DD`，否则服务端 UTC+8 当日；早于今日打 `backfilled` | L311-318、L435 |

### 4.2 状态机（实测）

前置白名单（事务外 L228 与事务内 L392 完全相同）：`['approved','report_generated','partial_received','to_receive']`

后置（L509）：
```
isFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'
```

收货单自身状态（L437）：`completed` | `abnormal`

### 4.3 价格与金额（后端全权）

- 单价来源：`supplier_product_price` where `product_id in chunk AND is_current:1`（L342-346），按 `` `${supplier_id}|${product_id}` `` 建 map（L350）。**是收货时现取，不是下单快照。**
- 手动商品行跳过取价（L339），`priceSnapshot=0`、`payableFlag=false` 为预期（L360-362）
- 档案商品 `priceSnapshot<=0` 且实收>0 → 置 `isMissingPrice`（L366-368）→ 进入 `hasAbnormal`（L370）
- `payableFlag = !hardAbnormal && (客户端未强制 false) && priceSnapshot>0`（L363），`hardAbnormal` = 非 shortage 的异常（L357）
- 金额只在报表侧计算：逐行 `Math.round(qty*price*100)/100` 再累加（L588-593、L671-676），保证「行小计之和 = 合计」；**主表/明细不落金额，`getSupplierReceipts` 现算**（§7.3）

### 4.4 事务与并发

- 事务（L384-536）内：复查订单状态、**复查历史累计实收防超收**（L398-419）、批次号重算（L421-427）、写 `receipt`、逐行写 `receipt_item` + `abnormal_record`、推进 `order_status`、写 `message` —— 范围完整，正确。
- 三个受控异常 `RECEIPT_EXISTS` / `ORDER_NOT_RECEIVABLE` / `OVER_RECEIVE` 在 catch 中精确映射（L739-748），未把 DB 错误原样透出。
- **但无幂等键**：`receipt` 表无 `request_id`，`receipt_id` 是 `RCP + Date.now() + 3 随机字节`（L320）—— 并发双击只能靠事务内的超收校验兜住一部分（见 H5）。

### 4.5 返回体

`{code:0, data:{receiptId, reportsGenerated, reportWarning, hasAbnormal, abnormalTypeNames, priceReportsSkipped}}`；失败 `{code:-1, msg}`。

---

## 5. `getReceipts`（92 行）

### 5.1 入参契约

| 入参 | 说明 | 行号 |
|---|---|---|
| `page` / `pageSize` | 同 §2.1 口径 | L45-46 |
| `role` | 解构后未使用 | L44 |
| `storeId` | **解构后从未进入 query** | L44、L61 |
| `receiptDate` | 精确等值 | L61 |
| （无 `receipt_status` / `purchaseOrderId` 筛选） | — | — |

### 5.2 角色口径

- `chef` → 直接 `{code:0, data:[], total:0}`（L50-52，不报错）
- `store_manager` → 强制 `store_id`（L53-55）
- `super_admin` / `purchaser` → 不限（L56-59）
- `supplier` → `-403`（L56-57）

### 5.3 返回体与缺陷

`{code:0, data:[{...receipt, items}], total, page, pageSize}`；`orderBy('created_at','desc')`（L66）—— 按创建时间而非 `batch_no`，同毫秒并发批次顺序不确定。

**缺陷**：`storeId` 是死参数。`receive-list.js:28` 明确传了 `storeId`（意图按门店过滤），店长侧被服务端强制收敛所以看不出问题，但 purchaser/admin 侧**完全没有门店过滤能力**，前端只能退而依赖 `getPurchaseOrders` 的 `receivable` 虚拟筛选（见 §2.1）。

---

## 6. `confirmSupplierOrder`（124 行）

### 6.1 鉴权与越权防护（做得最扎实的一个）

1. 角色必须为 `supplier`（L54）
2. `supplierId = user.default_supplier_id`，**服务端派生，不接客户端参数**（L55-56）
3. **必须证明该订单真的含本供应商商品**：`purchase_order_item` where `purchase_order_id AND supplier_id`（L65-69）→ 无匹配 `-403`
4. 手动单天然不可达：手动行 `supplier_id:''`（createPurchaseOrder:250），供应商的 `supplierId` 非空，查询不会命中

### 6.2 状态机

| action | 允许的 `order_status` | 写入 | 行号 |
|---|---|---|---|
| `confirm` | `['submitted','approved']` | `supplier_confirmations[supplierId].status='confirmed'` | L12、L14 |
| `ship` | `['submitted','approved','report_generated','to_receive','partial_received']` | `.status='shipped'` | L13 |

- **用条件更新实现原子「检查状态+写入」**（L78-83）：`where({purchase_order_id, order_status: _.in(allowed)})` → `updated===0` 即拒绝。这是本批唯一用条件更新做并发控制的地方，正确且值得抄。
- 不影响主订单状态流转（L3 注释），与内部审批/收货正交 —— 边界干净。
- `ship` 额外给订单所属门店写站内消息（L86-117），`confirm` 不写 —— 不对称，但注释说明了。
- 返回：`{code:0, data:{orderId, supplierId, status}}`

### 6.3 缺陷

- `receipt_abnormal` **不在** SHIPPABLE（L13）→ 订单一旦进入收货异常，供应商不能再补标发货（与 H1 同型死锁）。
- `approved` 状态下 `confirm` 与 `ship` 的白名单重叠（L12 含 approved、L13 含 approved），且写入目标是同一个键（L73-77）→ 供应商可把已 `shipped` 自降回 `confirmed`，无审计标记区分。
- 订单作废后 `supplier_confirmations` 不清理（无对应删除逻辑），`deriveConfirmStatus` 靠 `order_status==='cancelled'` 在读取端盖掉（getSupplierOrders:51）。

---

## 7. `getSupplierOrders`（136 行）

### 7.1 鉴权与入参

角色必须 `supplier`（L61）、必须有 `default_supplier_id`（L62-63）。入参：`confirmStatus`（`all|pending|confirmed|shipped|done|cancelled`）、`orderDate`、`page`、`pageSize`（L65-67）。

### 7.2 状态派生

- 隐藏：`draft` / `rejected`（L11）
- 完成：`received` / `receipt_abnormal` / `completed` → `done`（L14、L50）
- 其余取 `supplier_confirmations[supplierId].status`，缺省 `pending`（L52-54）
- `statusCounts` 在全量可见集上统计，不受 tab 过滤影响（L106-109）—— 正确

### 7.3 信息边界

只嵌本供应商自己的明细（L120-129），`items` 来源就是 L71-75 按 `supplier_id` 查出的那份 —— **不会泄漏同单其他供应商的商品**，注释与实现相符。

### 7.4 缺陷（本批最严重的实现缺陷集中在这里）

- **全量拉取 + 内存分页**：L71-75 每次调用把该供应商**全部历史**订单明细拉进来（`limit(1000)`，无 `purchase_order_id` 限定、无分页），然后 L116 内存排序、L118 内存 slice。**供应商累计订单行超过 1000 后，超出的部分静默消失**，`statusCounts` 也随之失真。
- **排序键与格式假设不符**：L116 `String(b.created_at||'').localeCompare(String(a.created_at||''))`。`created_at` 由 `db.serverDate()` 写入，`utils/cloud.js:81-83` 专门处理了 `value instanceof Date` 分支，说明回读形态包含 Date 对象；`String(Date)` 得到 `"Wed Oct 03 2026 ..."`，以**星期/月份名开头**，`localeCompare` 结果与时间先后无关 —— 跨年跨月时列表顺序全错【待核实：SDK 是否可能返回 ISO 字符串；若是字符串则该问题不成立，需实测一次】。

---

## 8. `getSupplierReceipts`（119 行）

### 8.1 入参

只有 `page` / `pageSize`（L49-50）；`role` 必须 `supplier`、必须 `default_supplier_id`（L45-47）。查询 `{supplier_id, is_manual: _.neq(true)}`（L54）—— `receipt_item` 无 `receipt_date`，注释说明日期在主表（L52），实现与注释相符。

### 8.2 金额与异常（后端算，前端零信任）

- `amount = Math.round(received_qty * price_snapshot * 100)/100`（L101-109）—— **金额服务端现算，前端无法伪造**
- join `receipt` 主表补 `receipt_date/store_id/store_name/purchase_order_id`（L67-76）
- join `abnormal_record`（同 `supplier_id`）带回 `type/status/resolution/payment_decision`（L78-97），供供应商对账（S7）
- `abnormalMap` 键为 `` `${receipt_id}_${product_id}` ``（L88），与本批 `createReceipt` 写明细的粒度一致

### 8.3 返回体

`{code:0, data:[{...item, receipt_date, store_id, store_name, purchase_order_id, amount, abnormals}], total, page, pageSize}` —— 分页正确（`count` + `skip/limit`，L56-62）。

### 8.4 缺陷

- 供应商能看到 `payable_flag` / `is_shortage` / `is_quality_issue` 等内部字段（`...item` 全量展开，L104）—— 与带价账单报表口径一致，属设计内，但比「只给金额」宽。
- 无 `receipt_date` / `store_id` 筛选能力（L52 注释已承认），量大后只能翻页。

---

## 9. 问题清单

### 🔴 高

**H1｜`receipt_abnormal` 终态死锁，且注释与实现直接矛盾**
`createReceipt/index.js:386` 注释写「已全部收齐（received）才拦截；**receipt_abnormal 状态允许继续补收**」，但紧随其后的 L392 白名单 `['approved','report_generated','partial_received','to_receive']` **不含 `receipt_abnormal`**，事务外的 L228 也不含。
触发：最后一批收货带任何异常（少货/质量/错货/**缺价**）→ L509 把订单置 `receipt_abnormal` → 该订单永久无法再提交收货。
放大路径：档案商品未配协议价时 L366-368 会置 `isMissingPrice` → L370 `hasAbnormal=true` → 一批**数量完全收齐**的收货也会把订单打成 `receipt_abnormal`。供应商事后补价、或门店要补收短到部分，都无路可走，只能走异常流程文字处理。
影响：终态不可恢复；B3「分批收货」能力在异常后失效。
建议：把 `receipt_abnormal` 加入两处白名单，或在 `isFinalBatch && hasAbnormal` 时改为一个可继续补收的中间态（如 `receipt_abnormal_partial`），并在 `abnormal_record` 裁决后提供状态回退。同时修掉 L386 的注释。

**H2｜报表失败通知永远写不进去（`ReferenceError: orderData is not defined`）**
`createPurchaseOrder/index.js:454` 在 `catch` 块里引用 `orderData`，而 `orderData` 是 `try` 块内的 `const`（L273）。`try`/`catch` 是同级块作用域，catch 内引用不到 → 抛 `ReferenceError`。
执行顺序：L438-440 先成功写下 `missing_reports:true` → L441-445 成功查到管理员 → L446-459 构造 `message.add` 的 data 字面量时求值 L454 抛错 → `message` 从未写入 → 被 L460 的 `catch (markErr)` 静默吞掉（只留一条 console.error）。
触发：订单已落库、报表生成阶段抛错（上传失败、`getNextVersion` 三次重试耗尽等）。
影响：清单 #7 设计的「定向通知能行动的管理员补生成」完全不工作，缺口只剩 `missing_reports` 标记等人去翻。与 batch2 发现的 `purchase-detail.js:153 that is not defined` 是同一型缺陷（成功路径被异常吞掉，用户/管理员都收不到反馈）。
建议：把 `store_id` 从 `persistedOrderNo` 反查，或在事务后把 `storeId` 提升为函数级 `let`。

**H3｜供应商订单列表：全量 1000 行截断 + 排序键失效**
`getSupplierOrders/index.js:71-75` 每次调用全量拉取该供应商所有历史订单明细（`limit(1000)`），L116 用 `String(created_at).localeCompare` 内存排序，L118 内存分页。
触发：① 供应商累计订单行 > 1000 → 超出部分静默丢失，`statusCounts` 同步失真；② `created_at` 回读为 Date 对象时 `String()` 得到以星期/月份名开头的字符串，`localeCompare` 与时间无关，跨年/跨月列表顺序全乱。
影响：供应商看不到全部订单、tab 计数错误、列表顺序不可信。这是「供应商侧唯一入口」，无其他降级路径。
建议：改成 `purchase_order_id in [...]` 的服务端分页；排序改为 `orderBy('created_at','desc')` 服务端完成（与 `getPurchaseOrders:111` 一致）。

**H4｜收货无幂等键，并发双击可重复收货、批次号重号**
`createReceipt/index.js` 全程没有 `request_id` 概念，`receipt` 表也无幂等字段；`receipt_id` 是 `RCP+Date.now()+3 随机字节`（L320）。批次号是 `count+1`（L422-427，事务内读），事务内的读不会给其他事务加锁。
触发：同一订单两笔并发收货（双击、双设备、超时重试）。
影响：① 两笔都能通过 L392 状态白名单（`receipt_abnormal` 除外），插入两条收货单；② 两笔读到同一个 count → **`batch_no` 重号**；③ `isFinalBatch` 在事务外按旧 history 算（L373-379），两笔可能一个判终批一个判非终批，订单状态被后写者覆盖。超收校验（L410-418）只能拦下「数量加起来超量」的情形，拦不住「两笔各收一部分」和「两笔同量但都通过」。
影响：批次号不可作为业务唯一依据；分批收货的批次语义在多终端下不可靠。
建议：`receipt` 加 `request_id` 幂等键（照抄 `createPurchaseOrder:141-150` 的写法），并把批次号改成与 `report_version_counter` 同款的原子计数器（`createPurchaseOrder:77-94` 已有实现可复用）。

### 🟠 中

**M1｜`payableFlag` 客户端可单方面压低，配合异常标记可绕过付款结算**
`createReceipt/index.js:363`：`payableFlag = !hardAbnormal && item.payableFlag !== false && priceSnapshot > 0`。前端传 `payableFlag:true` 无效（被当作「未强制」），传 `false` 直接生效；同样 `isQualityIssue` / `isWrongItem`（L281 透传）会把行标为 `hardAbnormal`（L357）→ 该行被带价报表排除（L583、L664）。
触发：店长对本店订单把某行标 `isQualityIssue` 或传 `payableFlag:false`。
影响：全额到货的行可以不进任何带价账单，无需审批闸；无审计痕迹区分「真异常」与「人为压价」。
建议：`payableFlag` 完全由服务端派生（删除 `item.payableFlag !== false` 这一支），并把客户端可控的异常标记改为需要 `abnormal_record` 侧二次确认才生效。

**M2｜数量校验：严格判型制造误拒，且缺整数/小数口径**
`createReceipt/index.js:197-201` 用 `typeof item.receivedQty !== 'number'` 判型 → 前端传字符串 `"5"` 直接被判「验收信息不完整」；同时 `orderQty` / `productName` / `unit` 被要求上送，但 L280-290 一律用 DB 值覆盖 —— 这三个字段是**纯浪费的失败面**。
`createPurchaseOrder/index.js:232` 只校验 `>0 && <=1000000`，**不校验整数** → 下单量可存 `3.5` 件。
影响：判型过严导致偶发「填了数量却被判无效」；小数与整数无统一口径，下游按件数统计会偏。
建议：统一改成 `Number()` 转换后校验，并明确「可小数」还是「必须整数」；删除 `orderQty/productName/unit` 的上送要求。

**M3｜编辑草稿时订单头 update 影响 0 行不报错 → 可能留下孤儿明细**
`createPurchaseOrder/index.js:303` `transaction...update()` 未检查 `stats.updated`；若 `purchase_order` 文档在读取（L170-175）与事务之间被删/作废，此处更新 0 行不抛错，而 L304-310 仍删掉旧明细、L323-340 仍写入新明细。
影响：数据库里出现有明细无订单头的孤立数据，报表与列表都查不到，异常记录/收货引用会指向不存在的单。
建议：`updated === 0` 时显式抛错回滚。

**M4｜下单幂等查重在事务外，并发同 requestId 可重复建单**
`createPurchaseOrder/index.js:141-150` 查重与 L301 建单不在同一原子域，且无唯一索引兜底。
触发：同一页面并发两笔提交（拆单场景下前端确实会并发发两笔，`purchase-create.js` 拆单路径带 `:c`/`:m` 子键，子键不同的两笔不会互相命中，但同一子键的并发会同时通过）。
影响：极端并发下重复建单，且两份都会各自生成报表（`report_id` 以 `RPT_SO_+orderNo` 命名，orderNo 不同 → 无去重）。
建议：`purchase_order` 对 `request_id` 建唯一索引（空串场景除外），或把查重放进事务。

**M5｜`isFinalBatch` 在事务外计算，与终态写入不在同一原子域**
`createReceipt/index.js:373-379` 用事务前的 `historyQtyMap` 计算，L509 在事务内据它写终态。并发分批时判断与写入可能不一致（同 H4 第③点）。
影响：订单可能停在 `partial_received` 却实际已收齐，或反过来已收齐却仍停在 `partial_received`。
建议：把 `isFinalBatch` 移到事务内、基于 `txHistoryQty` 计算。

**M6｜`getPurchaseOrderDetail.receipts` / `getReceipts.items` 无排序**
`getPurchaseOrderDetail/index.js:100-103` receipts 无 `orderBy`；`getPurchaseOrders/index.js:121-124` 与 `getReceipts/index.js:76-79` 的 items 无 `orderBy`。
影响：`receive-verify.js:25` 取 `receipts[0]` 作已收货补偿判据可能拿到旧批次；明细展示顺序不确定（`item_id` 字符串序 `1,10,2`）。
建议：receipts `orderBy('batch_no','asc')`，items `orderBy('item_id','asc')`（或写入时带序号字段）。

**M7｜`getReceipts.storeId` 是死参数，管理员侧无门店过滤能力**
`getReceipts/index.js:44` 解构了 `storeId`，L61 只用了 `receiptDate`。`receive-list.js:28` 明确传 `storeId`。
影响：店长侧因服务端强制收敛而看不出问题；purchaser/admin 侧传了也不过滤，前端只能退而依赖 `getPurchaseOrders` 的 `receivable` 虚拟筛选。
建议：全局角色支持 `storeId` 过滤，或删除该死参数并同步前端。

**M8｜`confirmSupplierOrder` 的 SHIPPABLE 不含 `receipt_abnormal`，与 H1 同型**
`confirmSupplierOrder/index.js:13`。订单进收货异常后供应商无法再补标发货，而 `partial_received` 在 S8 中被明确加入了该白名单（L11 注释）—— 同一批状态漏了同一个。
建议：与 H1 一起改。

**M9｜4 个从未被写入的死状态散落在 8+ 处白名单**
全局 grep 结论：`pending_approval`、`report_generated`、`to_receive`、`completed` **无任何写入方**（写入点只有 `createPurchaseOrder:278`、`createReceipt:512`、`dataService:552/1303/1413`）。但仍在这些位置出现：`createReceipt:228/392`、`getPurchaseOrders:74/94`、`confirmSupplierOrder:13`、`getSupplierOrders:14`、`meta.js:6-12`、`dataService:844/1294/1297/1348`、`updateProductPrice:43`、`authService:632`。
影响：状态机文档化困难；`createReceipt` 的 4 态白名单实际只有 2 个可达（`approved`、`partial_received`），维护者极易误以为 4 个都可达；`meta.js` 里 4 个状态永远不会显示。
建议：明确是「保留兼容」还是「清理」，二选一后统一。

**M10｜客户端可把全额收货行标为 `isShortage`，生成虚假异常记录**
`createReceipt/index.js:325-328` 只在 `累计 < 下单量` 时**强制置 true**，不反向强制 false。
影响：`abnormal_record` 里出现「下单 10 实收 10」的少货记录，异常列表噪音（不影响金额，因为 shortage 不算 `hardAbnormal`，L357）。
建议：`isShortage` 改为服务端完全派生。

**M11｜报表 `report_id` 无去重，补生成可能重复**
`createPurchaseOrder/index.js:365`（`RPT_SO_+orderNo`）、`createReceipt/index.js:567/600/649/684`（`RPT_SR_`/`RPT_SRP_`/`RPT_SUR_`/`RPT_SURP_`）都是幂等命名的 id，但写入前**没有查重**；而 `dataService:1019-1020`/`1268-1269` 的补生成流程只清 `missing_reports` 标记。
影响：补生成多次 → `report_file` 出现多份同名同类型的报表记录，报表历史页重复展示。
建议：补生成前先按 `report_id` 查重或先删后建。

**M12｜`getPurchaseOrders` 的 `orderStatus` 无枚举校验，前端却大量依赖服务端筛选能力**
`getPurchaseOrders/index.js:75-76` 原样入 query（无害但静默）。更值得指出的是能力与使用错位：后端已提供 `receivable` 虚拟筛选（L73-74）与 `statusCounts`（L96-106），但 `approval-list.js:24`、`receive-list.js:23` 都只传 `pageSize:100` 再客户端过滤 —— 后端能力齐全而前端没用，是 batch2 已确认的 100 条截断问题在服务端侧的对应结论：**后端具备修复条件，问题在前端调用方式**。

### 🟡 低

**L1｜`createdBy` 入参被完全忽略，`createdByName` 进 CSV**
`createPurchaseOrder/index.js:110` 解构后无引用；L356 把客户端的 `createdByName` 写进 CSV「经办人」列（CSV 有公式注入防护，`csvField` L42-46，故无注入风险，但可控文本落报表）。库里的 `created_by`/`created_by_name` 一律由会话派生（L291-296），**正确**。

**L2｜`overallRemark` / `items[].remark` 无长度限制**（`createReceipt:170`、L465）

**L3｜照片只校验子串**：`createReceipt:212-215` 只要求包含 `receipts/<orderId>/`，不校验 `cloud://` 形态；跨订单复用照片已被拦住（前缀含尾随 `/`，`receipts/PO123456/` 不匹配 `receipts/PO123/`），但任意含该子串的字符串可通过。

**L4｜`supplier_confirmations` 在订单作废后不清理**（`confirmSupplierOrder:73-77`），读取端靠 `getSupplierOrders:51` 盖掉。

**L5｜`approved` 状态下 `confirmed`/`shipped` 可互相覆盖**（`confirmSupplierOrder:12-13` + L73-77），供应商可自降状态，无审计标记。

**L6｜`getPurchaseOrders` 的 count 与 get 不在同一事务**（L108-114），翻页期间 ±1 抖动。

**L7｜creatorMap 以 `user_id` 为键**（`getPurchaseOrders:134-135`），而写入端 `user.user_id || user._id` → `_id` 兜底情形查不到显示名（`getPurchaseOrderDetail:68-75` 同样）。

**L8｜`store` 集合被重复查询 3 次**（`createReceipt:178-180`、L188-190、L231），冗余但无害。

**L9｜`receipt` 主表不落金额**，供应商侧金额靠 `getSupplierReceipts:109` 现算 —— 一致，但意味着「金额」在系统里没有持久化权威副本，只能靠 `receipt_item.price_snapshot` 重建。

---

## 10. batch2 待核实项结论（逐一回收）

| # | batch2 位置与问题 | 结论 | 证据 |
|---|---|---|---|
| 1 | `batch2:53` 前端 `canReceive` 与云函数 `receiveOrder` 状态校验是否一致 | **成立且完全一致，无双向缺口** | 前端 4 处硬编码集 `['approved','report_generated','partial_received','to_receive']`（purchase-detail:71、purchase-list:123、receive-list:46）与 `createReceipt:228` / `:392` **逐字相同**；后端未额外放行任何状态。注意：chef 在前端（purchase-detail:71 `role!=='chef'`）和后端（createReceipt:164 白名单不含 chef）两侧都拦，一致 |
| 2 | `batch2:99` `getPurchaseOrders` 的 items 返回形状，`approval-list` 两列是否空白 | **不成立（前端已自解，不会空白）** | 后端只返回原始 snake_case（`product_name_snapshot`/`order_qty`，`getPurchaseOrders:137-140`）；但 `approval-list.js:35` 调了 `cloud.normalizePurchaseOrder`，L49-50 显式 `productName: item.productNameSnapshot`、`requestedQty: item.orderQty`；`approval-detail.js:40,43` 同样。两列有值 |
| 3 | `batch2:105` / `batch2:199` `auditOrder` 对空 `items` 的处理 | 落在 dataService（batch1 范围），顺带给结论：**空 items = 按申请量全批**，且后端有上限 | `dataService:544-549` `approvedQty = qtyMap[item.item_id]`，空 items → `qtyMap` 空 → `Number.isFinite(undefined)` 为假 → 不改量；`dataService:521-524` 校验 `qty > Number(sourceItem.order_qty)` 直接拒绝，**batch2 结论 #8「审批量可任意超出申请量」在后端被拦住**，只是前端无提示 |
| 4 | `batch2:204` 已批准/驳回单点按钮是否被服务端二次校验 | **成立，服务端二次校验存在且事务内复查** | `dataService:499` 拦 `!['submitted','pending_approval']`；`dataService:538-541` 事务内再复查并 rollback |
| 5 | `batch2:335` `createReceipt` 是否覆盖/忽略 `priceSnapshot` 与 `payableFlag` | **priceSnapshot 恒被覆盖（前端 0 值无影响）；payableFlag 前端只可压低不可抬高** | `createReceipt:348-351` 无条件按 `supplier_product_price` 现取；`:363` `item.payableFlag !== false` 只允许客户端强制 false（见 M1） |
| 6 | `batch2:463` 服务端是否为空 `createdBy` 兜底 | **成立，且比兜底更彻底：直接忽略入参** | `createPurchaseOrder:291-296` 一律取会话 `user.user_id||user._id` / `user.name||user.username`，入参 `createdBy`（L110）无任何引用。batch2 §9.2 担心的「显示名写进 purchase_order 表」不存在 |
| 7 | `batch2:579` 服务端是否校验 `orderStatus` | **成立，有白名单** | `createPurchaseOrder:206` `!['draft','submitted'].includes(orderStatus)` → `-1`。状态跃迁风险被后端拦住 |
| 8 | `batch2:121` `getAbnormalRecords` 空 payload 是否按会话收敛 | **不在本批 8 函数范围内**（`getAbnormalRecords` 在 dataService），转跨批次 | — |

---

## 11. 跨批次待核实项

1. **`dataService:552` `order_status: event.status` 无枚举校验** —— `auditOrder` 只校验**前置**状态（`dataService:499`）与 `event.status` 的 `rejected`/`approved` 分支语义，但 `event.status` **原样写库**。构造 `status:'received'` 或 `'cancelled'` 的调用可跳过整个收货流程。这是本批状态机的写入侧唯一缺口，需 dataService 侧确认并加白名单。
2. **`dataService` 两个取消白名单不一致** —— `requestCancel:1348` 允许 `partial_received`，但 `cancelOrder:1294` 拒绝 `partial_received`/`received`/`receipt_abnormal` → 采购员可对部分收货单提交取消申请，管理员确认后必然被拒，属无效操作路径。
3. **`supplier_product_price` 的 `(supplier_id, product_id, is_current)` 唯一性** —— `createReceipt:342-346` 按该组合建 map 时若存在多条 `is_current:1` 记录，后者覆盖前者且无告警。需 updateProductPrice / dataService 侧确认是否保证唯一（影响金额准确性）。
4. **`normalizePurchaseOrder` 未映射的字段读取口径** —— `utils/cloud.js` 只映射了 `verifyStatus`/`verifyAmount`/`isManual` 等，`backfilled`、`missing_reports` 仅靠 `...order` 原始保留（snake）。需确认 `purchase-list.wxml` / `purchase-detail.wxml` 读 `missing_reports` 用的是 snake 还是 camel —— 若用 camel 则「缺报表」标记静默不显示（与 batch2 §9.8 同型风险）。
5. **`product.category_name` vs `category_level_1`** —— `createPurchaseOrder:248` 双读 + 回退 `item.category`，说明商品表分类字段名不确定。需 getProducts / importProducts 侧确认真实字段（影响报表「分类」列取值）。
6. **`created_at` 回读形态** —— 决定 H3 的排序问题是否成立。需实测一次 `getSupplierOrders` 返回值里 `created_at` 是 Date 对象还是 ISO 字符串（`utils/cloud.js:81-83` 的 `instanceof Date` 分支暗示两者都可能出现）。
7. **`receipt_item` / `purchase_order_item` 的 `limit(1000)` 假设** —— 多个函数（`createReceipt:239/255/402/423`、`getPurchaseOrderDetail:80`、`getReceipts:78`）都假设单订单明细 ≤ 1000，而 `createPurchaseOrder:210` 已把上限锁在 100，故安全；但 `createReceipt:255` 的 `_.in(allOrderItemIds)` 一次性带 100 个 id，属边界内。
8. **`report_file` 补生成的唯一性** —— 见 M11，需 dataService 的 `regenerateOrderReports` / `regenerateReceiptReports`（`dataService:1019-1020`、`:1268-1269`）确认是「删后建」还是「追加」。
