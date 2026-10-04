# 05 收货单与异常记录域 深度探索报告

- 探索代理：第 5 号
- 日期：2026-10-04
- 分支：backup
- 已读文件：createReceipt/index.js（796 行，完整）、getReceipts/index.js（93 行，完整）、getSupplierReceipts/index.js（120 行，完整）、receive-verify 4 文件、receive-list 4 文件、abnormal-list 4 文件、supplier-receipts 4 文件、seed-data/{receipt,receipt_item,abnormal_record}.json
- 为回答分析点 5/6 额外读入：dataService/index.js:711-1046（异常状态机 + settleReceipt）、:1094-1162（repriceReceipt）、:1580-1629（verifyManualOrder 凭证删除）、getPurchaseOrderDetail/index.js（完整）、utils/cloud.js:227-241（uploadReceiptPhotos）、:49-67（callFunction）

---

## 1. 概览

收货域是「采购单审批完成 → 验收 → 生成 4 类报表 → 异常跟进 → 补结算」的主链路。核心写入口只有一个：`createReceipt`，它同时负责收货落库、异常登记、订单状态推进、消息下发和报表生成。异常的状态机与补结算在 `dataService` 里，属于本域的外延但强耦合。

设计上有两个明确的架构取舍，都是刻意的：

1. **不把已收数量回写采购单**。`purchase_order` / `purchase_order_item` 没有任何 `received_qty` 字段被本域写入（`createReceipt` 事务内只改 `order_status` 与 `updated_at`，见 `cloudfunctions/createReceipt/index.js:552-554`）。已收累计永远从 `receipt_item` 现场聚合（`createReceipt/index.js:260-269`、`:424-433`，`cloudfunctions/getPurchaseOrderDetail/index.js:101-116`）。好处是无陈旧聚合风险；代价是每次收货都要全量扫描该单所有明细行。
2. **报表生成与收货落库分离**。收货数据在一个事务里，4 类报表在事务外，失败靠 `missing_reports` 标记 + 定向通知 + `regenerateReceiptReports` 手工补偿（`createReceipt/index.js:737-769`）。

---

## 2. 数据模型与关联

### 2.1 `receipt`（收货单主表）

写入点：`createReceipt/index.js:470-484`

| 字段 | 来源/含义 |
|---|---|
| `receipt_id` | `'RCP' + Date.now() + crypto.randomBytes(3).toString('hex')`（`:327`）。**不含下划线**，这一性质被下游 `settleReceipt` 的字符串解析依赖（见 6.3） |
| `purchase_order_id` | 客户端传入，`:171` |
| `store_id` / `store_name` | 门店主表校验后取库内值，`:183-185`、`:193-195`、`:238` |
| `receipt_date` | `YYYY-MM-DD` 字符串；客户端本地日期优先，格式校验 `isReceiptDate`（`:318-322`），否则按 UTC+8 取服务端日期（`:323-325`） |
| `backfilled` | 补录历史日期标记，`:476` |
| `received_by` | 服务端取 `user.name`，不信任客户端（`:239`） |
| `receipt_status` | `'abnormal' \| 'completed'`（`:478`） |
| `overall_remark` | 客户端，`:478` |
| `photo_file_ids` | 客户端上传的 fileID 数组，`:479` |
| `batch_no` | 事务内按该单已提交收货单数 +1（`:462-467`） |
| `is_final` | 事务内新鲜重算：所有订单行 `历史累计 + 本批 >= order_qty`（`:449-452`） |
| `missing_reports` | 事务后补偿标记（`:748`） |
| `settle_lock` / `settle_lock_at` | `settleReceipt` 并发锁（`dataService/index.js:928-933`、`:1034`） |
| `created_at` | `db.serverDate()` |

### 2.2 `receipt_item`（收货明细）

写入点：`createReceipt/index.js:486-509`

| 字段 | 来源 |
|---|---|
| `receipt_item_id` | `receiptId + '_' + (i+1)`（`:490`）。**行序号 = 提交数组下标 +1**，被 `settleReceipt` 反向解析依赖 |
| `receipt_id` | |
| `purchase_order_item_id` | `item.orderItemId`（`:492`） |
| `product_id` / `product_name` / `supplier_id` / `unit_snapshot` | **全部取订单行库内值，不信任客户端**（`:290-295`） |
| `received_qty` | 客户端 `receivedQty`（`:496`）——这是唯一从客户端采信的数量 |
| `order_qty_snapshot` | **订单整单下单量**（`:497`），不是本批应到量。这是第 8.4 条供应商端误判异常的根因 |
| `price_snapshot` | 服务端从 `supplier_product_price` 取收货日当日有效价（`:351-374`） |
| `payable_flag` | 服务端裁决（`:383-394`、`:500`） |
| `is_manual` | 订单行 `is_manual`（`:293`、`:502`） |
| `is_shortage` / `is_quality_issue` / `is_wrong_item` | `:503-505` |
| `remark` | 客户端（内部验收备注） |

**注意：`is_missing_price` 不落 `receipt_item`**，`missing_price` 只体现在 `abnormal_record`（`:515`、`:529-545`）。`receipt_item` 上只有 `price_snapshot <= 0` 与 `payable_flag === false` 可反推，`repriceReceipt` 正是这样筛的（`dataService/index.js:1106`）。

### 2.3 `abnormal_record`（异常记录，独立集合）

写入点：`createReceipt/index.js:529-545`

**结论：异常记录是独立集合，不是收货单的子项数组。** 关联方式为 `receipt_id` + `product_id`，且一行明细可按异常类型一对多展开（少货/质量/错货/缺价各一条）。

| 字段 | 值 |
|---|---|
| `abnormal_id` | `` `${receiptId}_${i + 1}_${type}` ``（`:531`） |
| `receipt_id` / `purchase_order_id` / `product_id` / `supplier_id` / `store_id` / `store_name` | |
| `type` | `shortage \| quality \| wrong_item \| missing_price`（字典 `:52-57`） |
| `description` | 服务端拼装文案 + 客户端 remark 追加（`:518-528`） |
| `status` | `pending`（初始，`:540`） |
| `resolution` | `''`（初始，`:541`） |
| `handled_by` / `resolved_by` / `resolved_at` / `payment_decision` / `closed_by` / `closed_at` | 由 `startAbnormal` / `resolveAbnormal` / `closeAbnormal` 后续写入（`dataService/index.js:772-773`、`:796-804`、`:843-849`） |

### 2.4 关联键总览

- `receipt.purchase_order_id` → `purchase_order.purchase_order_id`
- `receipt_item.purchase_order_item_id` → `purchase_order_item.item_id || purchase_order_item._id`（构造映射 `createReceipt/index.js:250-254`）
- `receipt_item.receipt_id` → `receipt.receipt_id`
- `abnormal_record.receipt_id` → `receipt.receipt_id`
- `abnormal_record.abnormal_id` ↔ `receipt_item.receipt_item_id`：去掉 `_{type}` 后缀（`settleReceipt` 依赖，`dataService/index.js:949-952`）
- `report_file.source_order_id` → `purchase_order.purchase_order_id`；补结算账单额外带 `settle_for_receipt`（`dataService/index.js:1025`）

### 2.5 seed-data 与线上 schema 漂移

| 项 | seed-data | 线上实际 |
|---|---|---|
| `abnormal_record.abnormal_id` | `ABN20260805001` | `RCP..._1_shortage`（`createReceipt:531`） |
| `receipt` | 无 `batch_no`/`is_final`/`photo_file_ids`/`backfilled` | 全有 |
| `receipt_item` | 无 `is_manual`/`is_shortage`/`is_quality_issue`/`is_wrong_item` | 全有 |
| `receipt.receipt_date` | `2026-08-05` | 同（一致） |

seed 的 `abnormal_id` 格式会导致 `settleReceipt` 的行定位失效（`parts[0] === receiptId` 不成立 → 跳过），见风险 R13。

---

## 3. 三个云函数逐一分析

### 3.1 createReceipt（796 行，本域核心）

**执行阶段划分：**

| 阶段 | 行号 | 事务内? |
|---|---|---|
| 会话 + 角色校验 | 165-186 | 否 |
| 入参结构校验（items/photoFileIds） | 196-222 | 否 |
| 订单/门店/订单行加载 + 门店一致性 | 224-249 | 否 |
| 客户端明细 → 库内权威明细规范化 | 250-299 | 否 |
| 空批次拦截 | 300-305 | 否 |
| 批次号 / 终态预检 | 306-314 | 否 |
| 收货日期 + receiptId 生成 | 316-327 | 否 |
| 店长 ID 预取 | 330 | 否 |
| 少货预标注 | 336-339 | 否 |
| 价格快照计算 + payableFlag + missing_price | 347-395 | 否 |
| **事务**：状态复查、超收复查、终态重算、主表/明细/异常/订单/消息写入 | 405-579 | **是** |
| 供应商名批量查 | 588-596 | 否 |
| 报表 1-4 生成（version 取号 + uploadFile + report_file.add） | 598-736 | 否 |
| 报表失败补偿（missing_reports + 消息） | 737-769 | 否 |

**权限：** 白名单 `store_manager / super_admin / purchaser`（`:169`）。非全局角色强制 `storeId = user.default_store_id` 并校验门店存在（`:180-186`）；订单门店一致性二次校验（`:232-234`、`:240`）。`chef` 被白名单天然排除。

**服务端权威化（做得好）：** `productId` / `productName` / `supplierId` / `orderQty` / `unit` 全部由订单行覆盖客户端值（`:287-297`），`receivedBy` 用库内用户名（`:239`），`priceSnapshot` 与 `payableFlag` 完全重算（`:371-394`），门店名从库取（`:195`）。客户端传入的 `priceSnapshot` / `payableFlag` 被静默忽略——P1-10 有明确注释（`:386-387`）。

**行数上限：** `items.length > 50` 拒绝（`:199-203`），注释说明是按单事务操作数估算（`6×行数`）压到平台上限内。

**校验盲点（`:204-211`）：** 要求客户端必须传 `productId` / `productName` / `unit` 为真值，但这些字段随后会被库内值覆盖。即服务端本可自行推导的字段却作为拒绝条件——过严，且报错文案「验收信息不完整」具有误导性。见 R23。

### 3.2 getReceipts（93 行）

- 角色：`chef` 返回空数组（`:50-52`）；`store_manager` 按 `default_store_id` 过滤（`:53-55`）；`super_admin`/`purchaser` 不限（`:56-58`）；其余 -403（`:56-57`）。
- `receiptDate` 精确等值过滤（`:61`），**前端从未传过该参数**（`receive-list.js:26-31`），属死参数。
- 明细批量查询：按 20 个 `receipt_id` 分块 `_.in`，`limit(1000)`（`:74-84`）——20 单 × 50 行 = 1000 行正好触顶，边界会截断。
- 返回 `countRes.total` + 当前页，`receipt.items` 就地挂上。
- 错误路径：try/catch 兜底 -1（`:88-91`）。**没有分页越界处理**（page 上限 1000，`:45`），无数据时返回空而非错误，行为合理。
- 注意：`chef` 的 `-403` 分支（`:57`）永远不可达，因为 `:50` 已提前 return。

### 3.3 getSupplierReceipts（120 行）

- 严格 `role === 'supplier'`（`:45`），`supplierId` 取 `user.default_supplier_id`（`:46`），查询条件 `{ supplier_id: supplierId, is_manual: _.neq(true) }`（`:54`）。**scope 隔离正确**：supplier_id 完全由会话派生，客户端无法注入。
- 平铺返回 `receipt_item` 明细（非收货单维度），批量 join `receipt` 主表拿日期/门店/订单号（`:67-76`），再 join `abnormal_record` 按 `receipt_id + product_id` 聚成 `abnormals`（`:79-97`）。
- `amount` 现场算：`Math.round(receivedQty * price * 100)/100`（`:109`），与 `createReceipt` CSV 小计公式（`:634`、`:717`）**一致**，对账口径统一。
- 代码小瑕疵：`:67` 的 `receiptIds` 与 `:79` 的 `receiptIdsAll` 计算完全相同，属冗余变量（R20）。
- 详见第 8 节（信息泄露）。

---

## 4. 事务边界与幂等

### 4.1 事务内的写操作（`createReceipt/index.js:405-579`）

1. `receipt.add`（`:470`）
2. `receipt_item.add` × N（`:488`）
3. `abnormal_record.add` × M（`:529`）
4. `purchase_order.update`（`:552`）
5. `message.add`（`:564`）

**事务外的写操作：** `report_version_counter` CAS 递增（`:78-92`，经 `getNextVersion`）、`cloud.uploadFile` × 1-4、`report_file.add` × 1-4、以及报表失败补偿的 `purchase_order.update` + `receipt.update` + `message.add`（`:744-765`）。

### 4.2 部分失败脏数据风险

- **事务内**：任一 `add`/`update` 抛错即整体回滚，5 类写入原子性成立。写入顺序是先主表→明细/异常→订单状态→消息，消息放最后是有意的（注释 `:556-559`），但不影响原子性。
- **事务外**：报表层失败不影响收货数据，靠 `missing_reports` 标记 + `MSG_REPORT_MISSING_` 定向通知 + `regenerateReceiptReports` 补偿，链路完整（`:737-769`）。这是本域补偿设计最扎实的一处。
- **残留脏数据**：客户端已上传的收货照片在 `cloud://receipts/{orderId}/`，若收货事务回滚则成孤儿文件，无任何清理逻辑（R18）。
- **版本号跳号**：`getNextVersion` 在事务外，报表后续 `uploadFile`/`report_file.add` 失败时版本号已消耗，永不复用（R16）。影响仅限编号连续性，不影响正确性。

### 4.3 事务内的重算（防并发）

事务回调开头重读订单（`:406`）、重查全部订单行历史实收（`:422-433`）、重算 `txIsFinalBatch`（`:449-452`）、重清 `isShortage`（`:455-457`）、重算批次号（`:462-466`）。事务外的 `:336-339`、`:341-342`、`:311` 均为预检，注释明确说明以事务内为准。**并发正确性做得很好。**

### 4.4 幂等保护 —— 存在缺口

现有防御（三层）：

| 层 | 位置 | 效果 |
|---|---|---|
| 事务外订单状态 | `:312-314` | 仅拦 `received` |
| 事务内订单状态 | `:408-412` → `RECEIPT_EXISTS` | 仅拦 `received` |
| 事务内累计超收 | `:434-443` → `OVER_RECEIVE` | 拦 `历史 + 本批 > 下单量` |

**缺口：部分收货批次的重复提交不会被拦。** 推演：

1. 订单行下单 10 件。第 1 批实收 5 件 → 事务提交，`txIsFinalBatch = false` → `order_status = 'partial_received'`（`:551`）。
2. 响应丢失，客户端重试同一批 5 件。
3. 事务内 `:408` 检查 `order_status !== 'received'` → 通过。
4. 事务内 `:438` 检查 `txHistoryQty(5) + receivedQty(5) = 10 <= orderQty(10)` → **通过**。
5. 生成第二张收货单（`batch_no = 2`），订单转 `received`。

后果：同一批实物被记录两次；供应商收到 2 份到货汇总 + 2 份带价账单（合计金额恰好等于订单金额，所以**不直接多付钱**，但对账、消息中心、`receipt_item` 台账全部重复）；且后续无法区分哪一张是真的。客户端有 `recoverCommittedReceipt` 兜底（`receive-verify.js:6-37`），但只对特定错误文案生效，且拿到的可能是旧批次（见 R10）。

**无客户端幂等键**：请求体不含 idempotency key，服务端也不校验（`:170-178` 解构中无此字段）。

### 4.5 状态机与死锁状态

`createReceipt` 写入的 `order_status`：`received`（收齐无异常）/ `receipt_abnormal`（收齐有异常）/ `partial_received`（未收齐）（`:551`）。

- **`receipt_abnormal` 是终态且无任何代码把它推进到 `received`**——全仓检索确认只有 `getPurchaseOrders:89`（单独计数）、`dataService:1353`（拒绝作废）、`dataService:1575`（允许凭证核销）、`getSupplierOrders:14`、`purchase-detail.js:39`（视为完成）引用它。
- **注释与代码矛盾**：`:407` 写「receipt_abnormal 状态允许继续补收」，但 `:413` 的允许列表 `['approved','report_generated','partial_received']` **不含** `receipt_abnormal` → 实际会抛 `ORDER_NOT_RECEIVABLE`，前端收到「当前订单状态不可收货，请刷新订单后重试」（`:787`）。因为 `receipt_abnormal` 只在 `txIsFinalBatch` 为真时产生（所有行已收齐），所以功能上无法真正「继续补收」——注释是错的，代码是对的。但这条注释会误导后人去「修」`:413`，那样会让已完成订单可被无限收货（R19）。
- **统计口径漏计**：`dataService.getOrderStats:872-874` 的 `receivableStatuses` 与 `receivedQuery` 都不含 `receipt_abnormal` → 一张已收齐但带质量问题的订单，既不进「待收货」也不进「已收货」，首页统计凭空消失（R9）。

---

## 5. 数量与金额对账规则

### 5.1 数量校验矩阵

| 场景 | 服务端行为 | 行号 |
|---|---|---|
| 负数 | 拒（`receivedQty < 0`） | `:206`、`:281` |
| 非数字/非有限 | 拒 | `:206`、`:207` |
| 零（单行） | **允许**；整批至少一行 `>0` 或有异常标记，否则拒 | `:300-305` |
| 超收（历史+本批 > 下单量） | 拒（事务外 `:284` 预检 + 事务内 `:438` 权威） | `:284`、`:438` |
| 小数 | **允许**，无整数约束、无上限 | `:206` 仅 `Number.isFinite` |
| 下单量为 0（审批清零） | 允许收 0，触发自动 shortage | `:451`（`>= 0` 恒真） |

前端本地校验用的是 `item.receivedQty > item.orderQty`（`receive-verify.js:161`），**不是** `> item.remainingQty`——分批场景下用户按整单量填数会被后端拒绝（R6）。

### 5.2 金额计算

- **按快照价 × 实收数**，与下单金额无关：`subtotal = Math.round(receivedQty * priceSnapshot * 100)/100`（`:634`、`:717`），`getSupplierReceipts:109` 同一公式。
- 价格来源：`supplier_product_price where product_id in (...) and effective_date <= receiptDate`，同 key 取 `effective_date` 最新、同日取 `is_current === 1`（`:351-370`）。注释说明这是为补录历史日期设计的（P1-11），避免 `is_current` 指向今日价格。
- **逐行先舍入到分再累加**（`:633-635`、`:716-718`），保证「各行小计之和 = 合计」，且 CSV 合计与明细一致。
- 手动商品行：跳过协议价查询（`:350`），`price_snapshot = 0`、`payable_flag = false`，金额走凭证核销回填（`verifyManualOrder` 写 `verify_amount`，`dataService:1633`）。
- 报表 2/4（带价）只含 `payableFlag && !isManual` 行，`excluded_rows` 记录剔除数（`:626`、`:649`、`:707`、`:732`）。

### 5.3 可付款裁决（完全服务端）

`:379-394`：

- `hardAbnormal = 异常类型中存在非 shortage 者`
- 手动行 → `payable_flag = false`
- 其余 → `payable_flag = !hardAbnormal && priceSnapshot > 0`
- `priceSnapshot <= 0 && supplierId && receivedQty > 0` → 追加 `missing_price`

**业务后果：** 少货（shortage）**不**剔除付款（按实收数自然少计）；质量/错货**整行不付**，供应商承担全额损失，除非后续裁决 `pay_received` 走补结算；缺价行不付，走 `repriceReceipt`。

### 5.4 差异金额、容差、货损归属

- **无差异金额字段**：`receipt` / `receipt_item` / `abnormal_record` 均无 `difference_amount` 类字段，`abnormal_record.description` 里只有文字描述（`下单30斤，实收28斤`）。
- **无容差带宽**：不区分「短收 2%」与「短收 50%」，全部进异常台账、全部不影响付款（shortage 不罚额外金额）。
- **无货损/扣款归属**：质量问题不产生任何扣款单据，只是把该行从账单里剔除——供应商侧表现为「少收钱」而非「被扣款」，无法从报表追溯扣款原因（`abnormal_record` 不进入任何 CSV）。

---

## 6. 异常记录流程

### 6.1 异常类型枚举与触发条件

| type | 触发条件 | 来源 |
|---|---|---|
| `shortage` | **自动**：`历史累计 + 本批 < 下单量`，但**仅最终批判定**（非最终批在事务内被清零） | `:336-339` 预标、`:455-457` 事务内重算、`:512` 落库 |
| `quality` | 客户端勾选 `isQualityIssue` | `:62`、`:513`；前端 `receive-verify.wxml:46-49` |
| `wrong_item` | 客户端勾选 `isWrongItem` | `:63`、`:514`；`wxml:50-53` |
| `missing_price` | **自动**：非手动行、有供应商、`price_snapshot <= 0` 且 `receivedQty > 0` | `:391`、`:515` |

字典 `ABNORMAL_TYPE_NAMES` 在 `createReceipt:52-57` 与 `dataService:711-717` 各定义一份（`dataService` 侧多了中文注释说明），**两处手工同步，无单一来源**。

`P1-16` 的处理值得肯定：非最终批不生成 shortage，避免分批收货把异常台账灌满虚假记录（`:453-457`）。

### 6.2 状态机与审批语义

`pending → processing → resolved → closed`，严格单向：

| 动作 | 前置状态 | 行号 |
|---|---|---|
| `startAbnormal` | `pending` | `dataService:771`、写入 `:772-773` |
| `resolveAbnormal` | `processing` | `:791`、写入 `:796-804` |
| `closeAbnormal` | `resolved` | `:841`、写入 `:843-849` |

角色：`['store_manager', 'purchaser', 'super_admin']`（`:763`、`:779`、`:831`）；门店范围校验 `record.store_id !== auth.user.default_store_id → -403`（`:768`、`:788`、`:838`）。

**审批强度问题：** 全流程无角色分离——提交验收的同一个店长可以 start → resolve → close 自己制造的异常，并自行裁决是否付款给供应商（`payment_decision`）。异常记录创建时是 `pending`，没有任何「双人复核」或「必须不同账号关闭」的约束（R2）。

`resolveAbnormal` 要求 `resolution` 非空（`:782-783`）；`payment_decision` 只接受 `'pay_received' | 'reject'`，否则写空串（`:794`）——即不裁决是合法状态。

### 6.3 与结算的联动

**无自动结算。** `settleReceipt` 为手动入口（`dataService:895-1041`），仅 `GLOBAL_ROLES`（`:899`），前端仅对 `purchaser/super_admin` 暴露按钮（`receive-list.js:87`、`receive-list.wxml:52`）。

前置条件与幂等：

- 该收货单所有异常必须 `resolved/closed`（`:909-914`）
- `report_id` 以 `${receiptId}_S` 结尾的记录存在则拒（`:917-923`）
- `settle_lock` 条件更新抢占，10 分钟残留锁自愈（`:927-936`），`finally` 释放（`:1031-1040`）

结算范围（`P0-2` 修复后的口径）：`abnormalRes.data.filter(status !== 'closed' && payment_decision === 'pay_received')`（`:942`），按 `abnormal_id` 解析行序号定位 `receipt_item`，把 `payable_flag` 翻 `true`（`:956-958`），生成 `_S` 增量账单（`:997-1027`），**只含增量行**，不覆盖原 ⑥ 账单。

**两处严重缺陷：**

1. **关闭丢失付款裁决（R2）：** `:942` 显式排除 `status === 'closed'`。即：店长以 `pay_received` 解决异常后，再点「关闭异常」，该行**永远不会被结算**，供应商少收一笔钱。前端关闭文案（`abnormal-list.js:96`「关闭后不可继续处理」）完全没提这一点。
2. **repriceReceipt × settleReceipt 双付（R1，新发现）：** 一行同时有 `missing_price` 与 `quality` 异常是可能的（`:391` 与 `:393-394` 互不排斥）。若先跑 `repriceReceipt`：它把该行 `price_snapshot` 刷为现价、`payable_flag = true`（`dataService:1126-1128`）并调用 `regenerateReceiptReports`（`:1152`）重出 ④⑥ 账单 → 该行已进入账单。随后管理员跑 `settleReceipt`：该行的 `quality` 异常若是 `pay_received` + `resolved`，会被 `:942` 命中并解锁，再生成一份 `_S` 增量账单包含**同一行** → **同一行实收金额被付两次**。`settleReceipt` 的 `_S` 幂等检查（`:921`）只防「补结算跑两次」，不防「补价已出账 + 补结算再出账」。

### 6.4 消息中心联动

| 事件 | 消息 | 位置 |
|---|---|---|
| 收货（正常/异常） | 1 条，事务内；异常定向店长，正常门店广播 | `createReceipt:564-578` |
| 报表生成失败 | 1 条，定向超管 | `:752-765` |
| 异常解决 | **2 条**（解决通知 + 待补结算提醒） | `dataService:806-826` |
| 开始处理 / 关闭异常 | **0 条** | `:772-773`、`:843-849` |
| 供应商侧 | **无推送**（`notifySuppliersNewOrder` 仅用于下单） | — |

异常 `biz_id` 用 `receipt_id`（`:562`、`:153`），`message_id = MSG_RECEIVE_${receiptId}` 稳定可去重。

**死代码：** `ensureReceiptMessage`（`:130-163`）定义了但 `exports.main` 从未调用——被 `:564` 的事务内写入取代，但函数与注释仍保留，且 `业务模糊点确认清单.md:176` 仍把它当作「补写路径已落地」引用（行号已过期）。见 R15。

### 6.5 与报表的关系

`receipt.receipt_status = 'abnormal'` 时：报表 1/3（不含价）照常生成并含异常行与异常类型列；报表 2/4（带价）只含可付款行，`excluded_rows` 记数。即**异常只阻塞异常行，不阻塞整单**（B4/B6 行级隔离，`:620-622`）。

---

## 7. 附件 fileID 校验

### 7.1 createReceipt 的校验（`:212-222`）

```js
if (!Array.isArray(photoFileIds)) return { code: -1, ... }   // 212
if (photoFileIds.length > 9) return { code: -1, ... }         // 215
const photoPrefix = `receipts/${purchaseOrderId}/`            // 219
if (photoFileIds.some(id => typeof id !== 'string' || !id.startsWith(photoPrefix))) return {...}  // 220
```

- 上限 9 张 ✓（前端 `count: 9 - photos.length` 同步，`receive-verify.js:124`）
- **仅 `startsWith` 路径前缀，无 `cloud://` 前缀校验**，无文件存在性校验，无目录穿越防护。
- 客户端可提交 `receipts/PO_A/../../vouchers/PO_B/xxx.jpg`——`startsWith('receipts/PO_A/')` 为真，**校验通过**。落库后 `receive-list.js:99` 调 `getFileUrls`（`utils/cloud.js:243-250`）会把该任意 fileID 换成临时链接供本单查看 → 越权读取他人云存储文件。需要恶意客户端（小程序代码可反编译），但该校验的存在意义正是防此，属实现未达设计目标（R7）。
- `purchaseOrderId` 未做净化（对比 `uploadReceiptPhotos` 用 `replace(/[^a-zA-Z0-9_-]/g,'')`，`cloud.js:231`），但 `:224-230` 的订单存在性查询会先拦下畸形值。
- 跨门店隔离实际由 `:181`、`:232`、`:240` 的门店校验承担，与前缀校验互补。
- 落库时 `photoFileIds.filter(Boolean)`（`:479`）过滤空串 ✓。

### 7.2 凭证删除（`verifyManualOrder`，历史修复点）

`dataService:1596-1606`：

```js
const staleFileIds = oldFileIds.filter(id => id && typeof id === 'string' &&
  id.startsWith(voucherPrefix) && !voucherFileIds.includes(id))
```

**确认修复到位**：只删「服务端已存的历史凭证中、通过本单前缀校验、且不在新列表里」的 fileID。删除面被限定在本单历史凭证范围内。删除仅由本单提交人（`VOUCHER_SUBMIT_ROLES`，`:11`）触发，`deleteFile` 带 try/catch 兜底（`:1601-1605`），失败只留孤儿文件不阻断主流程。

### 7.3 收货照片无删除路径

全仓 `cloud.deleteFile` 仅两处：`dataService:1602`（凭证替换）、`importProducts:94`（导入文件）。**`receipt.photo_file_ids` 没有任何删除入口**——云存储永久累积（R18）。`cancelOrder`（`dataService:1353`）明确拒绝作废已有收货记录的订单，也不清理照片。

---

## 8. 供应商侧隔离

### 8.1 作用域

隔离正确（见 3.3）。额外确认：

- `receipt_item.supplier_id` 由订单行派生（`createReceipt:292`），客户端无法注入。
- 无 `store_id` 过滤是**故意的**：供应商可见其供货的全部门店，对账需要。
- `is_manual: _.neq(true)` 显式排除手动行（`getSupplierReceipts:54` 注释称「双保险，不依赖 supplier_id 为空的隐式前提」）。
- 空 `supplier_id` 的非手动行对任何供应商不可见（`createReceipt:292` 允许 `''`，R21）。

### 8.2 信息泄露

`getSupplierReceipts:104` 直接 `...item` 平铺整个 `receipt_item` 文档，未做字段白名单。因此供应商能拿到：

| 泄露字段 | 严重度 | 前端是否展示 |
|---|---|---|
| `remark`（**内部验收备注**，店长手填） | **中** | 是，`supplier-receipts.wxml:19`「备注: {{item.remark}}」 |
| `abnormals[].resolution`（**内部处理结论**，如「已补配协议价…」） | **中** | 是，`supplier-receipts.js:62` 拼进 `rec.text` |
| `abnormals[].payment_decision`（**付款裁决**） | 低（对账需要，但裁决未关闭前即暴露） | 是，`:58-60` 渲染为「裁决：按实收补款 / 维持不付款」 |
| `receipt.receipt_status` / `payable_flag` | 低（对账需要） | 间接（`:53`） |

**未泄露的（做对了）：** `receipt.overall_remark`（整单备注）未 join 下发；`report_file` 未 join；`purchase_order.verify_amount` / `verify_note` 未下发；`abnormal_record.handled_by/resolved_by/closed_by`（内部处理人身份）在 `:90-95` 被显式挑字段丢掉 ✓。

也就是说：字段白名单意识在 `abnormals` 上存在（`:90-95` 只取 4 个字段），但在 `item` 本体上完全缺失（`:104` 平铺）。这是设计上的不一致。

**业务影响示例：** 店长在异常备注里写「这批货质量太差，下次不再进货」或「已和店长商量要扣款」，会原样出现在供应商端。

### 8.3 异常类型的文案缺口

`supplier-receipts.js:56` 的映射表只有 `{ shortage, quality, wrong_item }`，**缺 `missing_price`** → 供应商看到裸英文 `missing_price`（R11）。同时这也把内部「未配价」这个采购侧问题暴露给了供应商。

### 8.4 分批收货被误判为异常（中）

`supplier-receipts.js:53`：

```js
const abnormal = !item.is_manual && (receivedQty !== orderQty || item.payable_flag === false)
```

而 `orderQty = Number(item.order_qty_snapshot)`（`:50`），`order_qty_snapshot` 是**整单下单量**（`createReceipt:497`），不是本批应到量。因此 B3 分批收货下，**任何非最终批次的明细行都会被标红为「异常」**，并在 `supplier-receipts.wxml:6` 显示红色 `异常` tag。

`getSupplierReceipts:105-108` join 收货单主表时只带 `receipt_date / store_id / store_name / purchase_order_id`，**没带 `batch_no` 与 `is_final`**，前端无法自我修正。

注意：真正的 `shortage` 判定在 `createReceipt:455-457` 已按最终批处理过，`is_shortage` 字段是准确的——错的只是供应商前端的展示逻辑（它没用 `is_shortage`，而是自己重算了一遍并用了错的基准）。

---

## 9. 前端页面分析

### 9.1 receive-verify（验收页）

**流程：** `onLoad` → `getPurchaseOrderDetail` → 本地构造 `items`（默认 `receivedQty: 0`、`payableFlag: true`、三个异常标记全 false）→ 逐项填数/勾选/备注 → 可选拍照 → `submitReceipt`。

**分批收货支持（B3）：** 展示「已收 X / 剩余 Y」（wxml:25-27），数据来自 `getPurchaseOrderDetail:113-116` 的 `received_total` / `remaining_qty`。默认本批不收该行（`:93`），留空表示 0。

**提交前过滤：** `submitItems = items.filter(receivedQty > 0 || isShortage || isQualityIssue || isWrongItem)`（`:168`）——其余行本批不收，不发到后端。

**问题清单：**

1. **超收校验用错基准（R6）：** `:161` 用 `item.receivedQty > item.orderQty`，应为 `> item.remainingQty`。第 2 批用户按整单量填数，前端放行、后端拒绝（后端文案是「累计实收超过下单量」，不指明是哪个批次的问题）。
2. **双击竞态（R14）：** `isSubmitting` 在 `:188` 才置 `true`，而 `:150` 的守卫在函数入口。两次快速点击都可能通过 `:150`（两者都解构到 `false`），各自弹出确认框并各自提交。按钮虽有 `loading/disabled="{{isSubmitting}}"`（wxml:92），但第一次点击在 `await showConfirm` 之前不阻塞第二次点击进入函数体。主要防线是后端超收校验——而它在部分批次重试场景下**不生效**（见 4.4）。
3. **丢失响应恢复不可靠（R10）：** `recoverCommittedReceipt`（`:6-37`）用 `getPurchaseOrderDetail` 反查，但 `receipts[0]` 的取值不可靠——`getPurchaseOrderDetail:120-123` 查 `receipt` 时**没有 `orderBy`**，`receipts[0]` 可能是任意一张历史收货单；且 `:20-21` 的判定 `detail.orderStatus !== 'received' && receipts.length === 0` 在已有历史批次的订单上恒为 `receipts.length > 0`，会把旧批次的 `receiptId` 当成本次提交结果展示给用户。
4. **异常文案写反（R8）：** `:256`「已生成N份不含价格的收货报表，**带价格报表未生成**」——但后端 `createReceipt:624-653` 在有可付款行时**确实生成了**带价报表（只是剔除了异常行）。`reportsGenerated` 计数也包含它。文案会误导用户以为少了一张账单。
5. **`priceSnapshot: 0` / `payableFlag: true` 硬编码上送（`:94-95`、`:218-219`）：** 服务端重算后忽略，无害但冗余；一旦后人改了服务端信任客户端，就会引入结算注入。
6. `choosePhoto` 用 `wx.chooseMedia` + `count: 9 - this.data.photos.length`（`:124`），与后端 9 张上限一致 ✓；拒绝权限时有兜底提示（`:131-136`）✓。
7. 提交顺序问题：`cloud.uploadReceiptPhotos`（`:199`）在 `callFunction('createReceipt')` 之前，照片上传成功但收货失败会留下孤儿文件（服务端无清理，R18）。

### 9.2 receive-list（待收货 + 最近收货记录）

- 待收货过滤 `['approved','report_generated','partial_received']`（`:46`）——**不含 `receipt_abnormal`**，已收齐但带异常的订单从此列表消失（符合预期，但配合 R9 的统计漏计值得注意）。
- `hasMissingPrice` 检测（`:76-78`）同时兼容 `priceSnapshot` / `price_snapshot` 与 `isManual` / `is_manual`，`getReceipts` 返回原始 snake_case 文档 → 走的是兜底分支，可用但脆弱（R24）。
- 三个操作按钮的可见性都与后端权限口径对齐（`:84-87` 的 `canRegenerate/canReprice/canSettle` 全部为 `purchaser/super_admin`），避免店长看到点了必 403 的入口 ✓。
- 三个操作都有 `this._submitting` 互斥（`:123`、`:145`、`:168`）✓——但注意这三个操作共用**同一个** `_submitting` 标志，一个在跑时另两个静默 return 且**无提示**（`:145-146`、`:168-169` 直接 `return`）。属小的 UX 缺陷。
- `previewReceiptPhotos` 每次现取临时链接不缓存（`:91-106` 注释说明 2 小时有效期）✓。
- 失败时「保留旧数据 + 提示，不渲染假空态」（`:57-62`）✓。

### 9.3 abnormal-list（异常记录）

- 数据源 `dataService.getAbnormalRecords`，后端 `limit(100)` 无分页（`dataService:736`）→ 超 100 条静默截断，前端无「加载更多」（R22）。
- 筛选是**纯前端** filter（`:39-41`），但后端也支持 `event.status` 过滤（`dataService:732`）——前端没用上，等于每次拉全量 100 条。
- 筛选 tab 覆盖 `pending/processing/resolved/closed` 四种状态 ✓，与后端字典 `ABNORMAL_STATUS_NAMES` 一致。
- `statusColorMap`（`:42`）四种状态齐全 ✓。
- **`closeAbnormal` 确认文案无风险提示（R2）：** `:96`「确认关闭该异常记录？关闭后不可继续处理。」——完全没提「关闭会导致已裁决的付款失效」。
- `resolveAbnormal` 的付款裁决提示（`:78-79`）把「是否按实收转回可付款」作为一次 confirm，且用「取消 = 维持不付款」表达，用户极易误点——裁决是不可撤销的高影响财务动作。
- `promptResolution` 用 `wx.showModal({editable:true})`（`:62-68`）收集处理结果，仅前端校验非空（`:73-75`），后端同样校验（`dataService:782-783`）✓ 双保险。
- 未使用 `authToken` 显式传参——`utils/cloud.js:49-64` 的 `callFunction` 会自动注入 `app.globalData.authToken`，✓ 无认证缺口。
- `handleAbnormal` 失败时只 `showToast(result.msg)` 不刷新列表（`:55`），状态可能已变更但页面未更新。

### 9.4 supplier-receipts（供应商收货记录）

- 双重登录/角色守卫：`authGuard.requireLogin()` + `app.globalData.isLoggedIn` + `user.role !== 'supplier'` → reLaunch（`:15-26`）✓。
- 分页：`onReachBottom` + `items.length >= total` 终止 + `loading` 防重入（`:30-43`）✓。
- 无限滚动加载，`onReachBottomDistance: 50`（json:4）✓。
- 数据映射见 8.2/8.3/8.4。
- 空态判断 `items.length === 0 && !loading`（wxml:25）✓，底部「已加载全部 N 条」✓。

---

## 10. 风险清单

严重度定义：**高** = 造成错误付款/资金损失或跨主体数据泄露；**中** = 数据不一致、权限/校验实现未达设计目标、明显误导用户；**低** = 文案/可观测性/维护性问题。

| # | 严重度 | 风险 | 触发条件 | 证据 |
|---|---|---|---|---|
| R1 | **高** | **repriceReceipt 与 settleReceipt 叠加导致同一明细行被结算两次** | 一行同时有 `missing_price` 与 `quality`/`wrong_item` 异常；先跑补价补账（刷新 `price_snapshot` + `payable_flag=true` 并重出账单），再跑补结算（`quality` 异常为 `pay_received`+`resolved` → 解锁同一行 → 出 `_S` 增量账单） | `createReceipt:391-394`；`dataService:1106-1128`、`:1152`；`:942-973`、`:997-1027`；`:921-923` 幂等检查只防「补结算跑两次」 |
| R2 | **高** | **关闭异常会静默抹掉付款裁决**，供应商永久少收一笔 | `resolveAbnormal(paymentDecision='pay_received')` 后点「关闭异常」 | `dataService:942` `filter(status !== 'closed' && payment_decision === 'pay_received')`；`:830-851` close 无裁决校验、无确认文案；`abnormal-list.js:96` |
| R3 | **高** | **部分批次重复提交不被拦**：响应丢失后重试生成第二张收货单、重复消息与报表 | 第 1 批未收齐（→ `partial_received`）+ 响应丢失 + 用户重试同一批；`历史+本批 == 下单量` 时超收校验通过 | `createReceipt:408-412`、`:438-443`；无幂等键（`:170-178`） |
| R4 | **中** | **供应商端可见内部验收备注与内部处理结论** | 常态：任意有 remark 或有 `resolution` 的明细 | `getSupplierReceipts:104` 平铺 `...item`；`:90-95` 只挑 4 字段（对比可见意识存在但不一致）；`supplier-receipts.wxml:19`、`supplier-receipts.js:62` |
| R5 | **中** | **分批收货的每个非最终批次在供应商端被误标「异常」**（红 tag） | B3 分批收货，任一非最终批次 | `supplier-receipts.js:53` `receivedQty !== orderQty`；`order_qty_snapshot` 存整单量 `createReceipt:497`；`getSupplierReceipts:105-108` 未下发 `batch_no`/`is_final` |
| R6 | **中** | 前端超收校验用 `orderQty` 而非 `remainingQty`，分批场景下误导性拒绝 | 第 2 批按整单量填数 | `receive-verify.js:161` |
| R7 | **中** | 照片 fileID 仅 `startsWith` 前缀校验，可目录穿越越权引用他人云存储文件 | 恶意客户端提交 `receipts/PO_A/../../vouchers/PO_B/x.jpg` | `createReceipt:219-222`；无 `cloud://` 校验、无存在性校验；`cloud.js:231` 的净化只在上传侧、下载侧 `cloud.js:243` 直接换链接 |
| R8 | **中** | 前端成功提示「带价格报表未生成」与后端实际行为矛盾；`priceReportsSkipped` 字段无真实含义 | 有异常且有可付款行时提交 | `receive-verify.js:256` vs `createReceipt:624-653`、`:779` |
| R9 | **中低** | `receipt_abnormal` 终态订单在首页统计中凭空消失（既非待收货也非已收货） | 收齐且带异常 | `dataService:872-874` |
| R10 | **中低** | 丢失响应恢复取到旧批次 `receiptId`，向用户误报成功 | 响应丢失 + 订单已有历史批次 | `receive-verify.js:20-35`；`getPurchaseOrderDetail:120-123` 无 `orderBy` |
| R11 | 低 | 供应商端 `missing_price` 显示裸英文，且暴露内部缺价事实 | 缺价异常 | `supplier-receipts.js:56` |
| R12 | 低 | `receipt_status='abnormal'` 不在 `meta.js:statusMap`（只有 `receipt_abnormal`）；命名不对称 | 任何新页面用 `getStatusInfo` 渲染收货状态 | `meta.js:9`；`receive-list.js:71-72` 目前硬编码兜底 |
| R13 | 低 | seed-data schema 漂移：`abnormal_id` 格式不匹配会让 `settleReceipt` 行定位失效 | 用 seed 数据测补结算 | `seed-data/abnormal_record.json` `ABN20260805001` vs `createReceipt:531`；`dataService:950-952` |
| R14 | 低 | 验收提交双击竞态：`isSubmitting` 在 `await showConfirm` 之前才置位 | 快速双击 | `receive-verify.js:150`、`:188` |
| R15 | 低 | `ensureReceiptMessage` 死代码（定义但从未调用），且需求文档仍引用它为「补写路径」 | — | `createReceipt:130-163` vs `:564`；`业务模糊点确认清单.md:176` 行号已过期 |
| R16 | 低 | 报表版本号在事务外 CAS 递增，报表失败仍消耗编号 → 版本跳号 | 报表上传/入库失败 | `createReceipt:78-92`、`:598-618` |
| R17 | 低 | 数量允许小数、无上限、无整数约束；无差异金额字段、无容差带宽、无扣款归属 | 常态 | `createReceipt:206`；`abnormal_record` schema 无金额字段 |
| R18 | 低 | 收货照片无任何删除路径，云存储永久累积；收货失败留孤儿文件 | 常态 | 全仓 `deleteFile` 仅 `dataService:1602`、`importProducts:94` |
| R19 | 低 | 注释与代码矛盾：`:407` 称 `receipt_abnormal` 可继续补收，`:413` 实际拒绝 | 维护者据此「修复」`:413` 会让已完成订单可被无限收货 | `createReceipt:407` vs `:413` |
| R20 | 低 | `receiptIds` 与 `receiptIdsAll` 完全重复 | — | `getSupplierReceipts:67` vs `:79` |
| R21 | 低 | `supplier_id` 为空的非手动行对任何供应商不可见 | 订单行缺供应商 | `createReceipt:292` 允许 `''`；`getSupplierReceipts:54` |
| R22 | 低 | 异常列表后端 `limit(100)` 无分页，前端无加载更多，静默截断 | 累计 >100 条 | `dataService:736`；`abnormal-list.js:36-44`（后端 `:732` 支持 status 过滤但前端未用） |
| R23 | 低 | 服务端把客户端 `productId/productName/unit` 作为拒绝条件，但随后会用库内值覆盖 → 过严 + 报错文案误导 | 精简客户端字段 | `createReceipt:204-211` vs `:287-297` |
| R24 | 低 | `hasMissingPrice` 依赖 snake_case 兜底分支（getReceipts 返回原始文档），字段改名即失效 | — | `receive-list.js:76-78`；`getReceipts:85` |
| R25 | 低 | `startAbnormal` / `closeAbnormal` 无消息通知；供应商侧异常无主动推送 | 常态 | `dataService:772-773`、`:843-849` |
| R26 | 低 | `resolveAbnormal` 一次 confirm 承载不可撤销的付款裁决，「取消=维持不付款」易误触 | 常态 | `abnormal-list.js:78-79` |
| R27 | 低 | receive-list 三个操作共用同一 `_submitting` 标志，占用时静默 return 无提示 | 连续点击不同操作 | `receive-list.js:123`、`:145`、`:168` |
| R28 | 低 | 异常审批无角色分离：同一店长可自造异常 → 自处理 → 自裁决付款 → 自关闭 | 常态 | `dataService:763`、`:779`、`:831` 角色集合完全相同 |

---

## 11. 待确认清单

1. **R1 是否为真实漏洞？** 需确认 `regenerateReceiptReports`（`dataService:1164+`）是否会对已生成过账单的行标 `superseded` 并让 `_S` 增量账单与之叠加——本次只读到 `:1164` 函数开头，未读完整实现。若它标 `superseded` 且报表消费端按「最新未 superseded」取数，则实际付款仍可能只取一份；需要看报表下载/结算消费端逻辑才能定论。
2. **`closeAbnormal` 排除 `pay_received` 是有意设计还是疏漏？** `dataService:942` 的注释只说「只结算本次因异常处理解锁的行」，没解释为何要排除 closed。若是「关闭=放弃裁决」的有意语义，则前端文案（R26/R2）必须补提示。
3. **`receipt.photo_file_ids` 是否需要清理策略？** 目前无删除路径、无生命周期任务，属确认过的现状（`docs/exploration/rescan-20261004-R2-data-contract.md:650` 已记录），是否接受永久累积需产品拍板。
4. **`receipt_abnormal` 是否应可继续收货？** 依赖业务确认「收齐后不允许再验收」。当前实现（`:413`）拒绝，注释（`:407`）声称允许，二者必有一个要改（R19）。
5. **供应商端是否应看到 `remark` / `resolution`？** 若是设计意图（透明对账），则应保留但需明确告知店长「此处文字会展示给供应商」；若不是，`getSupplierReceipts:104` 应改为字段白名单（R4）。
6. **小数数量是否为业务允许？** 单位含「斤/两」时小数合理，但无精度上限、无四舍五入规则说明（R17），需业务确认口径。
7. **`dataService` 的 `ABNORMAL_TYPE_NAMES` 与 `createReceipt:52-57` 应否抽为共享字典？** 两份手工同步，已出现一次漂移（`dataService` 侧多了注释、供应商前端第三份还缺 `missing_price`）（R11）。
8. **`getReceipts` 的 `receiptDate` 参数**：前端从未使用，是否为废弃参数？（`getReceipts:61`）
9. **未读**：`report-list` 页面（当前工作区有未提交修改，`git status` 显示 `M pages/report-list/report-list.js`）、`dataService.regenerateReceiptReports` 全文（`:1164-1338`）、`utils/meta.js` 全文。这些不在本次任务清单内，涉及报表消费端与状态字典，与 R1/R12 的定论相关。

---

## 附：本域做得好的地方（避免后续误改）

1. **服务端权威化彻底**：商品身份、供应商、单位、下单量、价格、可付款资格全部服务端裁决，客户端参数只影响「实收数量」与「异常勾选」两类真该由人决定的输入（`createReceipt:287-297`、`:371-394`）。
2. **事务内新鲜重算**：终态、超收、批次号、少货标记全部在事务内用新数据重算，事务外只做预检，并发正确性到位（`:419-468`）。
3. **报表生成与收货落库解耦 + 完整补偿链路**：`missing_reports` 标记 + 定向通知超管 + 手工补生成入口，无静默缺失（`:737-769`、`receive-list.wxml:50-52`）。
4. **B3 分批收货 + P1-16 非最终批不产生虚假 shortage**（`:453-457`）。
5. **settleReceipt 三重并发/幂等保护**：条件更新状态前置、`_S` 后缀去重、`settle_lock` 带 10 分钟自愈（`dataService:908-936`、`:1031-1040`）。
6. **行级结算隔离（B4/B6）**：异常只剔除异常行，正常商品可继续结算（`:620-622`）。
7. **供应商作用域隔离正确**：`supplier_id` 完全由会话派生，客户端不可注入（`getSupplierReceipts:45-54`）。
8. **凭证删除面已被正确收窄**到本单历史凭证 + 前缀校验（`dataService:1596-1606`）。
9. **前端按钮权限与后端口径对齐**，避免店长看到点了必 403 的入口（`receive-list.js:84-87`）。
10. **CSV 防公式注入 + 文件名净化**（`createReceipt:41-50`）。
