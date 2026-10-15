# A3 · 写入域云函数 · 函数级清单

## 0. 范围与方法

**已逐行全读的文件（当前工作区实际行号，HEAD `73b0730`）：**

| 文件 | 声明行数 | 实测末行 | 分段读取区间 |
|---|---|---|---|
| `cloudfunctions/createReceipt/index.js` | 807 | 807（`}`）+ 808 空行 | `1-420`、`418-808`（重叠 3 行用于接续） |
| `cloudfunctions/createPurchaseOrder/index.js` | 516 | 516（`}`）+ 517 空行 | `1-517`（一次读完） |
| `cloudfunctions/generateSummaryReport/index.js` | 280 | 280（`}`）+ 281 空行 | `1-281`（一次读完） |
| `cloudfunctions/confirmSupplierOrder/index.js` | 124 | 124（`}`）+ 125 空行 | `1-125`（一次读完） |

**合计 807 + 516 + 280 + 124 = 1727 行，与任务声明一致。**

**额外只读文件（用于建立调用边与交叉验证）：**
- `utils/cloud.js`（1-283，全读）
- `cloudfunctions/dataService/index.js`：`1-30`、`500-547`、`545-589`、`1075-1113`、`1328-1343`、`1540-1659`（分块）
- `cloudfunctions/importProducts/index.js`：`65-109`
- `pages/receive-verify/receive-verify.js`：`1-40`、`40-101`、`185-265`
- `pages/purchase-create/purchase-create.js`：`300-429`
- `pages/purchase-detail/purchase-detail.js`：`140-180`、`300-401`
- `pages/supplier-orders/supplier-orders.js`：`95-131`
- `pages/report-list/report-list.js`：`120-163`

**方法说明：** 全文用 Read 分段逐行读取，未使用 Grep 抽样代替正文阅读；Grep 仅用于①专项一的库内前缀校验普查、②状态字面量写入点普查、③调用点定位。所有结论均落到 `文件:行号`。旧审计报告中 `createReceipt` 的行号（如 `:228`/`:392`）与本域当前行号（`:247`/`:425`）不一致，本清单一律以当前工作区行号为准。

---

## 1. 四个云函数的对外契约总表

四个函数均为 `exports.main = async (event = {}) => {...}` 形式，返回**顶层扁平** `{ code, msg, data }`。本域内**不存在**嵌套 `{ error: { code, msg } }` 变体（嵌套变体在 `dataService.requireUser` 中，非本域）。

### 1.1 `createReceipt`（`cloudfunctions/createReceipt/index.js`）

**event 字段全表：**

| 字段 | 类型 | 必填 | 校验位置 | 缺失/非法时返回 |
|---|---|---|---|---|
| `authToken` | string | 是 | `:178`（`getSessionUser`） | `{code:-401, msg:'登录已过期，请重新登录'}` |
| `purchaseOrderId` | string | 是 | `:198-200` | `{code:-1, msg:'订单信息缺失，请返回订单列表后重新进入验收'}` |
| `storeId` | string | 否（非全局角色由服务端强制） | `:191-197`、`:201-206` | `{code:-403,...}` / `{code:-1, msg:'门店信息缺失，请重新登录或切换门店后再试'}` |
| `storeName` | string | 否（服务端覆盖） | `:201-206`、`:206`、`:250` | 同上 |
| `receivedBy` | string | 否 | `:185` 默认 `''`、`:251` 被服务端覆盖 | 无（被静默覆盖） |
| `overallRemark` | string | 否 | `:186` 默认 `''`，**无长度/trim 校验** | 无 |
| `photoFileIds` | string[] | 否 | `:223-228`（类型/上限）、`:231-234`（前缀归属） | `{code:-1, msg:'验收照片信息格式不正确，请重新选择照片'}` / `'验收照片最多9张'` / `'验收照片信息无效，请重新上传'` |
| `receiptDate` | string `YYYY-MM-DD` | 否 | `:330-337`（仅格式，无上下界） | 无（回退服务端 UTC+8 当天） |
| `items` | object[] | 是 | `:207-209`（非空）、`:210-214`（≤50）、`:215-222`（逐字段）、`:282-298`（与订单行匹配、累计不超收）、`:313-317`（空批次） | 见各位置文案 |
| `items[].orderItemId` | string | 是 | `:284-288`（必须在订单行 map 中且不重复） | `{code:-1, msg:'验收明细与采购订单不匹配，请刷新订单后重试'}` |
| `items[].productId/productName/unit/orderQty/receivedQty` | string/number | 是 | `:215-222` 仅校验存在性与 `receivedQty` 类型，**值本身被服务端从数据库重建** | `{code:-1, msg:'部分商品的验收信息不完整，请检查后重试'}` |
| `items[].priceSnapshot` / `payableFlag` | number/bool | 否 | **服务端完全忽略**，`:385-386`、`:395-401` 重算 | 无（静默丢弃） |
| `items[].isShortage` | bool | 否 | `:348-351` 服务端按累计量重写、`:467-469` 非最终批清零 | 无（静默覆盖） |
| `items[].isQualityIssue` / `isWrongItem` | bool | 否 | **零校验**，仅 `:70`/`:71` 判真后取用 | 无（客户端可任意声明） |
| `items[].remark` | string | 否 | 无 | 无 |

**成功返回形状（`:783-793`）：**
```js
{ code: 0, data: {
    receiptId,                        // 'RCP' + Date.now() + 6位hex（:339）
    reportsGenerated,                 // number，0~4
    reportWarning,                    // '' 或 '报表生成失败，请联系管理员处理。'（:751）
    hasAbnormal,                      // bool
    abnormalTypeNames,                // string[]（中文类型名）
    priceReportsSkipped: hasAbnormal  // ⚠ 语义与实现不符，见 §2.2 R8
} }
```

**全部可能 `code`：** `0`（`:783`）、`-401`（`:179`）、`-403`（`:180`、`:192`、`:195`、`:205`、`:252`）、`-1`（其余所有业务/异常路径，共 20+ 处）。**无 `-403` 之外的权限细分码，无 `error` 嵌套。**

### 1.2 `createPurchaseOrder`（`cloudfunctions/createPurchaseOrder/index.js`）

| 字段 | 类型 | 必填 | 校验位置 | 缺失/非法时返回 |
|---|---|---|---|---|
| `authToken` | string | 是 | `:143` | `{code:-401, msg:'登录已过期，请重新登录'}` |
| `orderId` | string | 否（编辑草稿时必填） | `:220-245` | `{code:-1, msg:'订单不存在'}` / `'只有草稿订单可以编辑或提交'` |
| `storeId` | string | 条件 | `:211-218`（非全局）、`:247-252`（全局）、`:254-256` | `{code:-403,...}` / `{code:-1, msg:'门店和采购商品不能为空'}` |
| `storeName` | string | 否（服务端覆盖） | `:217`、`:251` | 无 |
| `orderDate` | string `YYYY-MM-DD` | 否 | `:163-166`、`:170-177` | `{code:-1, msg:'采购日期或期望到货日期无效'}` |
| `deliveryDate` | string `YYYY-MM-DD` | 否 | `:169`、`:170-177` | 同上 |
| `createdBy` | string | 否 | `:154` 解构后**从未引用**（死字段） | 无 |
| `createdByName` | string | 否 | `:155`，仅 `:422` 用于 CSV「经办人」列；入库值由 `:345-347` 服务端重算 | 无 |
| `items` | object[] | 是 | `:254-261`（≤100）、` :277-305`（逐行）、`:308-316`（手动单规则） | 见各位置文案 |
| `items[].orderQty` | number | 是 | `:282-284`（`Number.isFinite` 且 `0 < qty <= 1000000`） | `{code:-1, msg:'商品信息或采购数量无效，请检查后重试'}` |
| `remark` | string | 否 | `:339` 无长度校验 | 无 |
| `orderStatus` | `'draft'\|'submitted'` | 否 | `:158` 默认 `'submitted'`、`:257-259` | `{code:-1, msg:'采购单状态无效'}` |
| `requestId` | string | 否 | `:183-201` 事务外查重、`:366-376` 事务内复查 | 命中不一致时 `{code:-1, msg:'该请求此前已创建过…'}` |

**成功返回形状：**
- 新建/编辑草稿：`{ code:0, data:{ orderId, reportGenerated:false, reportsGenerated:0 } }`（`:410-412`）
- 提交成功：`{ code:0, data:{ orderId, reportGenerated:true, reportsGenerated:<数量> } }`（`:491-494`）
- 幂等命中：`{ code:0, data:{ orderId, reportGenerated:false, reportsGenerated:0, idempotent:true } }`（`:208-210`）
- 订单已落库但报表失败：`{ code:0, data:{ orderId, reportGenerated:false, reportsGenerated:0, reportWarning:'订单已保存，但报表生成失败，请联系管理员处理。' } }`（`:504-507`）

**全部可能 `code`：** `0`（`:209`、`:411`、`:492`、`:505`）、`-401`（`:144`）、`-403`（`:146`、`:213`、`:216`、`:237`、`:241`、`:250`）、`-1`（其余）。

### 1.3 `generateSummaryReport`（`cloudfunctions/generateSummaryReport/index.js`）

| 字段 | 类型 | 必填 | 校验位置 | 缺失/非法时返回 |
|---|---|---|---|---|
| `authToken` | string | 是 | `:168` | `{code:-401, msg:'登录已过期，请重新登录'}` |
| `period` | `'daily'\|'monthly'` | 是 | `:173-174` | `{code:-1, msg:'汇总类型无效'}` |
| `date` | string `YYYY-MM-DD` | 是 | `:175-176`（`isDate`） | `{code:-1, msg:'日期格式无效，应为 YYYY-MM-DD'}` |
| `storeId` | string | 全局角色必填 | `:178-186` | `{code:-403, msg:'请指定门店'}` 实际文案为 `'请指定门店'`（`:186`，code 为 `-1`） |

**成功返回形状（`:267-275`）：**
```js
{ code: 0, data: { fileID, fileName, totalAmount, itemCount } }
```
**全部可能 `code`：** `0`（`:268`）、`-401`（`:169`）、`-403`（`:171`、`:182`、`:183`）、`-1`（`:174`、`:176`、`:186`、`:189`、`:278`）。
⚠ `:186` 的 `请指定门店` 返回 `code:-1` 而非 `-403`，与紧邻的 `:182`/`:183` 权限文案不一致。

### 1.4 `confirmSupplierOrder`（`cloudfunctions/confirmSupplierOrder/index.js`）

| 字段 | 类型 | 必填 | 校验位置 | 缺失/非法时返回 |
|---|---|---|---|---|
| `authToken` | string | 是 | `:52` | `{code:-401, msg:'登录已过期，请重新登录'}` |
| `orderId` | string | 是 | `:60` | `{code:-1, msg:'订单信息缺失'}` |
| `action` | `'confirm'\|'ship'` | 是 | `:59`（`ACTION_STATUS` 查表）、`:62` | `{code:-1, msg:'不支持的操作类型'}` |

**成功返回形状（`:119`）：**
```js
{ code: 0, data: { orderId, supplierId, status } }   // status ∈ {'confirmed','shipped'}
```
**全部可能 `code`：** `0`（`:119`）、`-401`（`:53`）、`-403`（`:54`、`:56`、`:69`）、`-1`（`:60`、`:61`、`:82`、`:122`）。

---

## 2. 函数清单

### `cloudPathOfFileId(fileId)` `(createReceipt/index.js:52-57)`

- **职责**：把 `cloud://{env}.{bucket}/{cloudPath}` 形态的 fileID 剥成 `{cloudPath}`，供前缀归属校验使用；非法输入返回空串。
- **入参**：`fileId` 任意类型（`typeof fileId === 'string' ? fileId : ''`，`:55` 做了类型守卫）。
- **返回**：匹配时返回捕获组 `match[1]`（string），否则 `''`（string）。永不抛异常、永不返回 `undefined`/`null`。
- **副作用**：无。纯函数。
- **权限**：无门禁（内部辅助函数，不对外）。
- **幂等/并发**：天然幂等。
- **调用点**：`createReceipt/index.js:232`（照片归属校验）。**同一份副本存在于 `dataService/index.js:17-22`，调用点 `:1568`、`:1612-1613`。**
- **契约风险**：正则 `/^cloud:\/\/[^/]+\/(.+)$/` 不做路径规范化，`../` 序列可穿过前缀（详见 §3.1 边界表与 §3.2）。

---

### `exports.main(event)` — createReceipt `(createReceipt/index.js:176-807)`

- **职责**：门店收货验收（支持分批）——服务端重建订单行、快照收货日协议价、裁决付款资格、写收货主表+明细+异常台账+订单状态+站内消息，事务提交后生成 1~4 份 CSV 报表。
- **入参**：见 §1.1 全表。
- **返回**：见 §1.1；失败全部为**顶层** `{code:-1, msg}` 或 `{code:-403,...}`，事务内抛出的三个自定义错误在 `:794-803` 被翻译为业务文案：
  - `'该订单已完成收货，请勿重复提交'`（`RECEIPT_EXISTS`，`:420-424` 抛出）
  - `'当前订单状态不可收货，请刷新订单后重试'`（`ORDER_NOT_RECEIVABLE`，`:425-429` 抛出）
  - `'商品{名}累计实收超过下单量，请检查后重试'`（`OVER_RECEIVE:{名}`，`:450-454` 抛出，`:802` 用 `startsWith('OVER_RECEIVE:')` 解析）
- **副作用**（逐个字段）：
  - `receipt`：**新增**（`:482-496`）字段 `receipt_id`、`purchase_order_id`、`store_id`、`store_name`、`receipt_date`、`backfilled`、`received_by`、`receipt_status`（`'completed'`|`'abnormal'`）、`overall_remark`、`photo_file_ids`、`batch_no`、`is_final`、`created_at`；**更新** `missing_reports:true`（`:760-762`，事务外补偿路径）
  - `receipt_item`：**新增**（`:500-521`）字段 `receipt_item_id`、`receipt_id`、`purchase_order_item_id`、`product_id`、`product_name`、`supplier_id`、`received_qty`、`order_qty_snapshot`、`unit_snapshot`、`price_snapshot`、`payable_flag`、`is_manual`、`is_shortage`、`is_quality_issue`、`is_wrong_item`、`remark`、`created_at`。**注意：不落 `is_missing_price`**（`isMissingPrice` 只在内存对象与 `abnormal_record` 上生效，`:403-405`、`:527`）
  - `abnormal_record`：**新增**（`:541-557`）字段 `abnormal_id`、`receipt_id`、`purchase_order_id`、`product_id`、`supplier_id`、`store_id`、`store_name`、`type`、`description`、`status:'pending'`、`resolution:''`、`created_at`、`updated_at`。每行最多 4 条（shortage/quality/wrong_item/missing_price）
  - `purchase_order`：**更新** `order_status`（`:563-566`）+ `updated_at`；补偿路径**更新** `missing_reports:true`（`:756-758`）
  - `message`：**新增**（`:576-590`，事务内）`message_id='MSG_RECEIVE_'+receiptId`、`type`（`'receive'`|`'abnormal'`）、`title`、`content`、`biz_id=receiptId`、`recipient_user_id`（异常→店长 ID，正常→`''`）、`store_id`、`read:false`、`created_at`。**无 `read_by`、无 `scope_type`/`scope_id`**；补偿路径**新增** `MSG_REPORT_MISSING_{receiptId}`（`:765-777`），同样无 `read_by`
  - `report_version_counter`：**CAS 更新/新增** `count`、`updated_at`（经 `getNextVersion`，`:612`、`:640`、`:692`、`:722`）
  - `report_file`：**新增** 1~4 条（`:620-629`、`:653-663`、`:702-711`、`:737-746`），`status:'generated'`、`generated_by_system:true`、`has_abnormal`、`abnormal_summary`、`excluded_rows`
  - 云存储：**上传** CSV ×1~4（`:619`、`:652`、`:701`、`:736`），路径 `reports/store/{日期}/...` 与 `reports/supplier/{日期}/...`
  - **删除**：无。
- **权限**：角色白名单原文 `['store_manager', 'super_admin', 'purchaser']`（`:180`）。**调用者身份由服务端从 `authToken` 经 `getSessionUser` 派生**（`:178`），不信任任何前端传入的身份字段。非全局角色强制 `storeId = user.default_store_id` 并校验门店有效（`:191-197`），`:252` 二次校验订单门店归属。
- **幂等 / 并发控制**：
  - `db.runTransaction`（`:417-591`）覆盖：订单状态复查、历史累计实收复查、终态重算、`receipt` add、`receipt_item` add、`abnormal_record` add、`purchase_order.order_status` 更新、`message` add。**这是「写主表 + 写子表 + 写异常 + 写状态 + 发消息」的完整事务边界。**
  - **无幂等键**：event 中没有 `requestId`，服务端不查重。重试安全性依赖①事务内 `received` 拦截（`:420-424`）②事务内累计超收拦截（`:446-455`）③前端 `recoverCommittedReceipt`（`receive-verify.js:6-37`）反查。**响应丢失场景下若订单尚处 `partial_received`（非最终批），服务端无法区分「已成功提交」与「彻底失败」，重试会产生第二张收货单（`batch_no` 不同）。**
  - `batch_no` 在事务内按 `receipt` 计数生成（`:474-479`），规避并发重号。
- **调用点**：
  - `pages/receive-verify/receive-verify.js:200-225` —— 唯一调用点。实际传入 `purchaseOrderId`、`storeId`、`storeName`、`receivedBy`、`overallRemark`、`photoFileIds`（来自 `:199` `cloud.uploadReceiptPhotos(photos, order.purchaseOrderId)`）、`receiptDate`、`items[]`（`orderItemId`、`productId`、`productName`、`supplierId`、`receivedQty`、`orderQty`、`unit`、`priceSnapshot`、`payableFlag`、`isShortage`、`isQualityIssue`、`isWrongItem`、`remark`）。
  - 调用方期望字段（`:248-257`）：`result.data.reportsGenerated`、`result.data.reportWarning`、`result.data.hasAbnormal`、`result.data.abnormalTypeNames`。**不读取** `data.receiptId`、**不读取** `data.priceReportsSkipped`。
- **契约风险**：
  - **R1（终态无出口）**：`:419` 注释称「`receipt_abnormal` 状态允许继续补收」，但紧随的 `:425` 白名单是 `['approved', 'report_generated', 'partial_received']`，**不含 `receipt_abnormal`**；事务外的 `:247` 同样不含。→ 订单一旦进入 `receipt_abnormal`，`createReceipt` 永久拒绝，且本域无任何函数能把它转出。
  - **R2（幽灵状态放行）**：`:247` 与 `:425` 的白名单含 `report_generated`，但全库 grep 无任何函数写出 `report_generated`（写入点仅 `createPurchaseOrder:329`、`createReceipt:563-566`、`dataService:501/575`、`dataService:1393`、`dataService:1519`）→ 该分支不可达。
  - **R3（`priceReportsSkipped` 语义错误）**：`:791` 返回 `priceReportsSkipped: hasAbnormal`，但报表 2/4 的实际门槛是 `payableItems.length > 0`（`:638`、`:719-720`）。全部行都因「缺价」而非「异常」被剔除时 `hasAbnormal=true` 成立；反之若某行 `payableFlag=false` 但无任何异常标记（服务端 `:400` 只由异常与价格决定，理论上不会发生，但客户端无法区分）时该字段失真。前端 `receive-verify.js` **不读取此字段**，属死返回值。
  - **R4（异常类型零校验）**：`isQualityIssue`/`isWrongItem` 完全信任客户端（`:70`、`:71` 判真即用），可凭空声明异常；而 `isShortage` 服务端重算（`:348-351`）、`payableFlag`/`priceSnapshot` 服务端重算（`:385-401`）。三类异常的可信度口径不一致。
  - **R5（事务边界不完整，按任务专项要求明确指出）**：事务内 = `receipt` + `receipt_item` + `abnormal_record` + `purchase_order.order_status` + `message`。事务外 = `report_version_counter` CAS（4 次）、`cloud.uploadFile`（1~4 次）、`report_file.add`（1~4 次）、以及报表失败补偿的 `purchase_order.missing_reports` + `receipt.missing_reports` + `message`。**「生成报表」整段在事务外，无事务保护。**
  - **R6（补偿只能向前）**：`:749-781` 的补偿只在报表阶段失败后写 `missing_reports:true` 与通知；已生成的部分报表**不回滚**，已消耗的 `report_version_counter` 不复用 → 版本号跳号。且 `receipt.missing_reports:true`（`:760-762`）在全库**无任何复位点**（`dataService:1088-1090`、`:1337-1339` 只复位 `purchase_order`）→ 收货单上的「缺报表」标记一旦写入即永久，即使管理员补生成成功也不清除。
  - **R7（`receiptDate` 无上下界）**：`:330-337` 只校验 `YYYY-MM-DD` 格式，允许未来日期与任意历史日期；`backfilled` 只在 `receiptDate < 今天` 时置真（`:488`），未来日期既不报错也不打标。
  - **R8（订单号未净化即拼前缀）**：`photoPrefix = 'receipts/' + purchaseOrderId + '/'`（`:231`）未做白名单清洗（对比 `utils/cloud.js:231` 用 `/[^a-zA-Z0-9_-]/g`）。缓解因素：`:236-242` 的存在性查询先拦下不存在的畸形单；且 `createPurchaseOrder:322` 生成的单号只含 `PO+数字+base36+hex`。残留风险仅在编辑路径（`:220-225` 只做存在性检查）与手工改库场景。
  - **R9（`message` schema 不一致）**：`:576-590` 与 `:765-777` 的消息**无 `read_by` 字段**，而同域 `createPurchaseOrder:98` 与 `:110` 有 `read_by: []`，`confirmSupplierOrder:110` 也有。读侧 `dataService:675-676`、`:693-698` 用 `Array.isArray(...)` 容错，故非硬缺陷，但已读标记语义在这些记录上退化。
  - **R10（`overallRemark`/`remark` 无长度限制）**、`photoFileIds` 元素为 `null`/`undefined` 时会以 `'验收照片信息无效'` 硬拒（`cloudPathOfFileId` 返回 `''`）而非过滤——`:491` 虽有 `.filter(Boolean)`，但校验发生在过滤之前。

---

### `exports.main(event)` — createPurchaseOrder `(createPurchaseOrder/index.js:138-516)`

- **职责**：创建/编辑采购草稿与提交采购申请，并在事务提交后自动生成门店下单报表 + 供应商订货汇总表。
- **入参**：见 §1.2 全表。
- **返回**：见 §1.2 四种形状，全部**顶层** `{code,msg,data}`。
- **副作用**（逐个字段）：
  - `purchase_order`：**新增**（`:377-385`）`purchase_order_id`、`order_no`、`store_id`、`store_name`、`order_date`、`delivery_date`、`order_status`、`backfilled`、`is_manual`、`verify_status`（手动单 `'none'`，其余 `''`）、`verify_amount:null`、`verify_voucher_file_ids:[]`、`request_id`、`remark`、`created_by`、`created_by_name`、`submitted_at`（仅提交）、`created_at`、`updated_at`；**更新**（编辑草稿 `:355`）同一集合（`created_by`/`created_by_name` 保留原值，`:342-347`）；补偿路径**更新** `missing_reports:true`（`:82`）
  - `purchase_order_item`：编辑草稿时**批量删除**旧行（`:356-362`，`doc().remove()` 逐条），随后**新增**新行（`:388-405`）字段 `item_id`、`purchase_order_id`、`product_id`、`product_name_snapshot`、`category_snapshot`、`unit_snapshot`、`supplier_id`、`order_qty`、`is_manual`、`remark`、`created_at`
  - `message`：**新增**提交消息（`:57-69`）`message_id='MSG'+Date.now()+8位hex`、`type:'order'`、`biz_id=orderNo`、`store_id`、`read:false`（**无 `read_by`**）；补偿路径**新增** `MSG_ORDER_REPORT_MISSING_{orderNo}`（`:88-100`，**有 `read_by:[]`**，`recipient_user_id` 指向首个超管）
  - `report_version_counter`：**CAS 更新/新增**（`:419`、`:468`）
  - `report_file`：**新增** `store_order_report`（`:429-437`，`report_id='RPT_SO_'+orderNo`）与每个供应商一条 `supplier_order_report`（`:478-486`，`report_id='RPT_SUO_'+sid+'_'+orderNo`）
  - 云存储：**上传** CSV（`:428`、`:477`）
  - **删除**：仅 `purchase_order_item` 旧行（`:360-362`）。
- **权限**：角色白名单原文 `['chef', 'store_manager', 'super_admin', 'purchaser']`（`:145`）。身份由 `getSessionUser` 服务端派生（`:143`）。非全局角色强制本店（`:212-218`）；草稿编辑额外校验 `:233-239`（创建人或本店店长可代改，`created_by` 保留原创建人）与 `:240-242`（编辑不可换门店）。
- **幂等 / 并发控制**：
  - **有幂等键** `request_id`（`:183-201` 事务外预检 + `:366-376` 事务内复查），命中同状态单直接返回原单号（`:208-210`），状态不一致时拒绝（`:195-197`）。**注释 `:364-365` 明确承认 check-then-act 非严格原子，终极防线依赖 `(request_id, created_by)` 唯一索引——该索引是否存在未验证（仓库无 schema/索引定义文件）。**
  - `db.runTransaction`（`:353-406`）覆盖：`purchase_order` add/update、`purchase_order_item` 删旧+增新、事务内幂等复查。**事务外**：`createSubmissionMessage`（`:414`）、`getNextVersion` ×N、`cloud.uploadFile` ×N、`report_file.add` ×N、`markOrderReportsMissing`。
  - 重试安全性：事务内失败整体回滚；事务后失败（报表阶段）返回 `code:0` + `reportWarning`，避免客户端重试重复建单（`:496-507`）。
- **调用点**：
  - `pages/purchase-create/purchase-create.js:370`（拆单-档案单）、`:385`（拆单-手动单）、`:412`（单一路径）——经 `buildPayload`（`:320-336`）传 `storeId`、`storeName`、`orderId`、`orderDate`、`deliveryDate`、`createdBy`、`createdByName`、`items`（`toPayloadItems`，`:344-359`）、`remark`、`orderStatus`、`requestId`（`this.requestId + ':' + orderStatus + reqSuffix`，`:335`）
  - `pages/purchase-detail/purchase-detail.js:336`（`copyToDraft`，`orderStatus:'draft'`、`requestId:_genRequestId('copy')`）、`:372`（`submitRequest`，`orderStatus:'submitted'`、`requestId:_genRequestId('submit')`）
  - 调用方期望字段：`data.orderId`（`:379`、`:399`、`:350`）、`data.reportWarning`（`:400`、`:420`）。
- **契约风险**：
  - **R1（报表经办人 ≠ 入库经办人）**：CSV 报表1 的「经办人」列取**前端传入**的 `createdByName`（`:422`），而入库的 `created_by_name` 由服务端重算为 `user.name || user.username`（`:345-347`）。前端 `buildPayload` 传的是 `user.name || user.username`（`purchase-create.js:327`）所以通常一致，但 `purchase-detail.js:379` 传的是 `d.createdBy`（归一化后的显示名）→ 与库里存的 `created_by_name` 可能不同，报表与数据库出现两处口径。
  - **R2（`createdBy` 死字段）**：`:154` 解构后全文无引用（grep 确认仅 `:154` 声明、`:422` 用的是 `createdByName`）。
  - **R3（手动/非手动单 `verify_status` 口径分裂）**：手动单写 `'none'`，非手动单写 `''`（`:335`）。下游需同时容忍两种「未核销」表示。
  - **R4（事务边界不完整）**：事务内 = `purchase_order` + `purchase_order_item`。**「发通知」与「生成报表」全在事务外**（`:414`、`:419-489`）；`createSubmissionMessage` 的 catch 吞错（`:70-72`）→ 订单成功但提交消息可能永久缺失，且无补偿。
  - **R5（`getNextVersion`→`uploadFile`→`report_file.add` 三步非原子）**：取号成功但 `add` 失败 → 版本号永久跳号 + 云存储孤儿 CSV。补偿为 `markOrderReportsMissing`（`:78-105`），只写标记+通知，不清理文件、不复用版本号。
  - **R6（`created_by` 双值兼容）**：`:342-344` 与 `:186` 用 `user.user_id || user._id`，与 `createReceipt` 及 `dataService` 的写法一致，但全库存在 `user_id`/`_id` 两套主键口径（`dataService:512` 显式做双值包含判断）→ 跨函数按 `created_by` 关联时可能失配。
  - **R7（`order_qty` 上限 1,000,000，`:283`）**：与 `createReceipt` 的实收校验共用 `order_qty`，超大下单量不会被本函数拦截。

---

### `exports.main(event)` — generateSummaryReport `(generateSummaryReport/index.js:166-280)`

- **职责**：按门店+期间（日/月）聚合 `receipt`/`receipt_item`，生成一份 CSV 汇总报表并登记 `report_file`。
- **入参**：见 §1.3 全表。
- **返回**：见 §1.3。
- **副作用**（逐个字段）：
  - `report_version_counter`：**CAS 更新/新增**（`:238` 经 `getNextVersion`，`reportType='store_daily_summary_report'`|`'store_monthly_summary_report'`）
  - `report_file`：**新增**（`:247-265`）`report_id='RPT_DS_{storeId}_{date}_v{version}'`|`'RPT_MS_...'`、`report_type`、`report_scope:'store'`、`scope_id`、`scope_name`、`related_date`、`basis_date_type:'summary_date'`、`file_name`、`file_url`、`file_version`、`generated_at`、`generated_by_system:false`、`status:'generated'`、`total_amount`、`item_count`
  - 云存储：**上传** CSV（`:242-245`，`reports/summary/{daily|monthly}/{storeId}/...`，含 BOM）
  - **只读**：`receipt`（`:90-109`，只取 `receipt_id`）、`receipt_item`（`:121-127`）、`product`（`:138-145`）、`supplier`（`:156-161`）、`store`（`:188`）、`app_user`（`:16-38`）
  - **删除**：无。**不写 `purchase_order`、`message`、`abnormal_record`。**
- **权限**：角色白名单原文 `['store_manager', 'purchaser', 'super_admin']`（`:170`）。身份服务端派生（`:168`）。`:178` 判定 `isGlobal = ['purchaser','super_admin']`；店长强制 `storeId = user.default_store_id`（`:180-185`），越权门店返回 `-403`。
- **幂等 / 并发控制**：**无 `db.runTransaction`，无幂等键。** 并发安全性完全依赖 `getNextVersion` 的 CAS 取号（`:59-79`）+ 文件名随机后缀（`:241`，`Date.now().toString(36)` + 3 字节随机 hex）避免同路径覆盖。→ **同一门店同一天可无限重复生成**，每次产生新 `report_id`/新 `file_version`，无去重、无拦截。
- **调用点**：
  - `pages/report-list/report-list.js:142-146` —— 唯一调用点。传 `period`、`date`（前端按本地时区拼 `YYYY-MM-DD`，`:138`）、`storeId`（`app.globalData.currentStore.storeId || ''`，`:145`）。
  - 调用方期望字段：只判 `result.code === 0`（`:148`），**不读取 `data` 中任何字段**，随后 `reload()`。
  - ⚠ 前端 `:127-131` 只放行 `['super_admin','purchaser']`，**店长被前端拦截**，但后端 `:170` 允许 `store_manager` → **后端比前端宽**。
- **契约风险**：
  - **R1（三条报表链路中唯一无补偿）**：`uploadFile`（`:242-245`）→ `report_file.add`（`:247-265`）不原子；顶层 catch（`:276-279`）只返回 `{code:-1}`，**不写 `missing_reports`、不发通知、不清理孤儿 CSV、不复用已消耗的版本号**。对比 `createPurchaseOrder:75-105/499-507` 与 `createReceipt:749-781` 均有补偿。
  - **R2（汇总口径不区分异常）**：聚合时**不检查 `receipt.receipt_status`**，`completed` 与 `abnormal` 的收货单一视同仁计入（`:89-110` 只按 `store_id`+`receipt_date` 筛选）。仅按 `item.is_manual` 排除手动行（`:200-201`）。
  - **R3（月汇总的 `date` 语义）**：月汇总按 `${date.slice(0,7)}-01` ~ `-31` 取整月（`:94`），`related_date` 存传入的完整日期（`:237`），`pathDate` 用月份（`:239`）→ 传 `2026-10-05` 与 `2026-10-31` 生成的报表内容完全相同，但 `report_id` 与 `related_date` 不同 → 同月多份「不同日期」的相同内容汇总。
  - **R4（空数据不拦截）**：`receipts.length === 0` 时 `items = []`（`:193`），仍生成只有表头+合计 0 的 CSV 与 `report_file` 记录（`:229-234`、`:242-265`）。
  - **R5（`:186` code 语义）**：`请指定门店` 返回 `-1` 而非 `-403`，与 `:182`/`:183` 的权限文案同级但 code 不同，前端无法据此区分「未选门店」与「未授权」。
  - **R6（分类名双源）**：`:206-211` 用 `categoryMap[pid].category`（`product.category_name || category_level_1`）兜底，单位优先 `item.unit_snapshot` 再 `meta.unit`（`:211`）→ 商品档案改名后，历史汇总报表分类名与收货明细快照不一致（未验证是否影响对账口径）。

---

### `exports.main(event)` — confirmSupplierOrder `(confirmSupplierOrder/index.js:50-124)`

- **职责**：供货商对归属自己的订单行确认接单（`confirm`）或标记发货（`ship`），写入订单的 `supplier_confirmations` 子文档，发货时向门店发站内消息。
- **入参**：见 §1.4 全表。
- **返回**：见 §1.4，顶层扁平。
- **副作用**（逐个字段）：
  - `purchase_order`：**条件更新**（`:78-80`）`supplier_confirmations.{supplierId} = { status, updated_at, updated_by }`（`:72-77`）+ 顶层 `updated_at`。**不修改 `order_status`**（文件头 `:1-3` 明确说明主状态流转不受影响）。
  - `message`：仅 `action==='ship'` 时**新增**（`:98-113`）`message_id='MSG'+Date.now()+8位hex`、`type:'order'`、`title:'供货商已发货'`、`content`、`biz_id=orderId`、`recipient_user_id:''`、`store_id=order.store_id||''`、`scope_type:''`、`scope_id:''`、`read:false`、`read_by:[]`、`created_at`
  - **只读**：`purchase_order_item`（`:65-68`，越权校验）、`supplier`（`:93-96`，取名称）、`purchase_order`（`:88-90`，取 `order_no`/`store_id`）、`app_user`（`:26-35`）
  - **删除**：无。
- **权限**：角色白名单原文 `user.role !== 'supplier'` → `-403`（`:54`）。**供货商身份完全由服务端会话派生**：`supplierId = user.default_supplier_id`（`:55`），**不信任任何前端传入的供货商标识**（event 中无 `supplierId` 字段）。越权防护：`:65-69` 要求该订单必须含此供货商的商品行，否则 `-403 '该订单不包含贵司供货的商品'`。
- **幂等 / 并发控制**：**无 `db.runTransaction`、无幂等键。** 并发控制靠**条件更新**：`.where({ purchase_order_id, order_status: _.in(allowedStatus) }).update(...)`（`:78-80`），`stats.updated === 0` 时拒绝（`:81-83`）。→ 「检查状态 + 写入确认」是单步原子操作，避免读-判-写竞态（注释 `:71`）。
  - **重试安全性差**：重复调用 `ship` 每次都成功（子文档被覆盖为同值），但**每次都会新增一条站内消息**（`:86-117` 无条件 `message.add`）→ 消息可无限重复。`confirm` 重复调用则是纯覆盖写，无副作用放大。
- **调用点**：
  - `pages/supplier-orders/supplier-orders.js:121` —— 唯一调用点：`cloud.callFunction('confirmSupplierOrder', { orderId, action })`，`action` 来自 `:107`（`'confirm'`）与 `:114`（`'ship'`）。
  - 调用方期望字段：只判 `res.code === 0`（`:124`），随后 `this.reload()`；**不读取 `data`**。
- **契约风险**：
  - **R1（消息重复）**：如上，`ship` 无幂等保护，`:98-113` 每次发货都 `add` 一条消息，无 `biz_id + type` 去重（对比 `createReceipt:578` 用稳定 `MSG_RECEIVE_{receiptId}`，本函数用 `Date.now()` 随机 ID）。
  - **R2（发货标记与消息之间无事务）**：`:78-80` 条件更新成功后，`:86-91` 再做两次**普通查询**才 `:98` 写消息；消息写入失败被 `:114-116` catch 吞掉 → 发货标记已落库但门店收不到通知，且无任何补偿/补发入口。
  - **R3（白名单含两个幽灵状态）**：`:12` `['approved','report_generated','to_receive']`、`:13` 追加 `partial_received`。grep 全库确认 `report_generated` 与 `to_receive` **均无任何写入点** → 这两个分支不可达（历史遗留状态）。可达的仅 `approved`（`dataService:501/575` 审核通过）与 `partial_received`（`createReceipt:563`）。
  - **R4（`supplier_confirmations` 只增不改不删）**：`status` 在 `confirmed`↔`shipped` 之间可反复覆盖，无单调性约束（可「先发货后回退为确认」）；取消订单（`dataService:1393` 写 `order_status:'cancelled'`）时**不清理** `supplier_confirmations`。
  - **R5（前端与服务端白名单不一致，非本域但影响调用契约）**：`supplier-orders.js:98` `canConfirm: order.my_confirm_status === 'pending'`、`:99` `canShip: my_confirm_status === 'confirmed'`，完全忽略 `order_status` → 订单进入不可确认状态后按钮仍显示，点击必然被 `:82` 拒绝并显示「订单不存在或当前状态不可操作」，用户误判为系统故障。

---

## 3. ★ 专项一：fileID 归属校验修复的完整性核查

### 3.1 `cloudPathOfFileId` 正则的边界行为表

源码（`createReceipt/index.js:54-57`，与 `dataService/index.js:19-22` 逐字相同）：
```js
function cloudPathOfFileId(fileId) {
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(typeof fileId === 'string' ? fileId : '')
  return match ? match[1] : ''
}
```
要点：`^cloud://` 字面量锚定；`[^/]+` 匹配**恰好第一段**（bucket），因为字符类排除 `/`，无法跨越第一个斜杠；`\/` 匹配第一个斜杠；`(.+)` 贪婪取到结尾（`.` 不匹配换行）；`$` 无 `m` 标志，匹配结尾或结尾换行符之前。

| # | 输入 | 返回 | 后续 `startsWith(prefix)` 结果 |
|---|---|---|---|
| 1 | `cloud://env-1gp.bucket/receipts/P001/a.jpg` | `receipts/P001/a.jpg` | 对 `receipts/P001/` → **true（放行）** |
| 2 | `''`（空串） | `''` | false（拒收） |
| 3 | `undefined` / `null` / `0` / `123` / `{}` / `[]`（非字符串） | `''`（`typeof` 守卫生效） | false（拒收） |
| 4 | `'receipts/P001/a.jpg'`（缺协议头，即旧 bug 形态） | `''` | false（拒收） |
| 5 | `'cloud://'`（协议头后无内容） | `''`（`[^/]+` 至少 1 字符） | false |
| 6 | `'cloud://env-1gp.bucket'`（有 bucket 无斜杠） | `''` | false |
| 7 | `'cloud:///receipts/P001/a.jpg'`（bucket 为空） | `''` | false |
| 8 | `'cloud://env/receipts/P001/a.jpg'`（多段 bucket） | `receipts/P001/a.jpg`（只剥第一段，`[^/]` 无法跨过 `/`） | 取决于 prefix |
| 9 | `'CLOUD://env/receipts/P001/a.jpg'`（大写协议头） | `''`（正则区分大小写） | false（拒收；wx 实际返回小写，低危） |
| 10 | `'cloud://env//receipts/P001/a.jpg'`（双斜杠） | `/receipts/P001/a.jpg` | false（因前导 `/`） |
| 11 | `'cloud://env/receipts/P001/../../vouchers/P002/x.jpg'` | `receipts/P001/../../vouchers/P002/x.jpg` | 对 `receipts/P001/` → **true（放行，路径穿越）** |
| 12 | `'cloud://env/receipts%2FP001/a.jpg'`（URL 编码斜杠） | `receipts%2FP001/a.jpg` | false（不解码） |
| 13 | 超长字符串（如 100KB 路径） | 完整捕获组，无长度限制 | 不崩溃，仅内存占用 |
| 14 | `'cloud://env/receipts/P001/a.jpg\n'`（尾随换行） | `receipts/P001/a.jpg`（`$` 在 `\n` 前匹配） | 按无换行判定 |
| 15 | `'cloud://env/receipts/P001/a.jpg '`（尾随空格） | `receipts/P001/a.jpg ` | 前缀判断不受影响，仍 true |

**结论：修复对「协议头剥离」这一目标完全达成**（旧 bug 形态 #4 由「必然被拒」变为「正确放行」，#2/#3/#5/#6/#7 等非法输入仍安全拒收）。**但前缀比对仍是纯字符串 `startsWith`，不做路径规范化，`../` 序列可穿过前缀（#11）。**

### 3.2 全库「文件路径归属校验」位置普查与是否漏改

在 `cloudfunctions/**/*.js` 全量 grep `startsWith`、`cloudPathOfFileId`、`receipts/`、`vouchers/`、`reports/`、`cloud://`、`deleteFile`、`photoFileIds`、`voucherFileIds`、`fileID` 后，所有涉及「用户可控 fileID 的归属校验」的位置如下：

| # | 位置 | 校验对象 | 是否先剥协议头 | 判定 |
|---|---|---|---|---|
| A | `createReceipt/index.js:231-234` | 验收照片 `photoFileIds`，前缀 `receipts/${purchaseOrderId}/` | ✅ `cloudPathOfFileId`（`:232`） | **已修复** |
| B | `dataService/index.js:1566-1570` | 付款凭证 `voucherFileIds`，前缀 `vouchers/${orderId}/` | ✅ `cloudPathOfFileId`（`:1568`） | **已修复** |
| C | `dataService/index.js:1609-1621` | 删除旧凭证文件（`cloud.deleteFile`），前缀同 B | ✅ `cloudPathOfFileId`（`:1612`）+ `startsWith`（`:1613`）+ 再排除本次新上传（`:1613`） | **已修复**（这是 `73b0730` 之外更早的一次同型修复，属删除侧防护） |
| D | `importProducts/index.js:86-94` | `event.fileID`（管理员 Excel 导入）→ `cloud.downloadFile`（`:92`）+ `cloud.deleteFile`（`:94`） | ❌ **完全无前缀校验** | **漏改/缺失**——见下 |
| E | 报表路径 `reports/store|supplier|summary/...`（`createPurchaseOrder:427/476`、`generateSummaryReport:241`、`createReceipt:618/651/700/735`、`dataService:443/484/1027/1228/1255/1288/1315`） | 服务端自行 `cloud.uploadFile` 生成 | 不适用 | 无需归属校验（路径不含用户输入） |
| F | `getReportDetail/index.js:209` | `cloud.downloadFile({ fileID: report.file_url })` | 不适用 | `file_url` 由服务端写入 `report_file`，非用户输入 |

**漏改条目 D 展开（唯一未闭合点）：** `importProducts` 由 `MANAGEMENT_ROLES = ['super_admin','purchaser']` 把守（`importProducts/index.js:8`、`:83`），但 `event.fileID` 无任何前缀/目录校验，直接进入 `cloud.downloadFile` 与 `cloud.deleteFile`。攻击面：管理员（超管/采购员）可传入**任意** fileID——
- `downloadFile`：可读任意云存储文件内容（他人凭证、他人收货照片、其他报表），且 Excel 解析失败仅返回「文件下载或解析失败」（`:96-98`），可低噪声探测；
- `deleteFile`：可删除任意文件（包括他人已登记的付款凭证 `vouchers/**` 与验收照片 `receipts/**`），被删文件在数据库中仍是有效引用，形成**永久孤儿引用**。
缓解因素：需要已登录管理员账号，且正常调用方 `product-manage.js:168` 只上传到 `imports/products/`。**该函数不在本次 A3 分配范围内，但它是全库唯一仍在做「用户 fileID → 云存储下载/删除」却无归属校验的入口，应在缺陷侧单独登记。**

### 3.3 上传路径 `{cloudPath}` 由谁决定

**收货照片（`utils/cloud.js:227-241`）：**
```js
async function uploadReceiptPhotos(localPaths = [], purchaseOrderId = 'receipt') {
  const safeOrderId = String(purchaseOrderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'receipt'
  const timestamp = Date.now()
  ... wx.cloud.uploadFile({
      cloudPath: `receipts/${safeOrderId}/${timestamp}-${index}.${extension}`,
      filePath
    }).then(res => res.fileID)
```
- **顶层目录 `receipts/` 硬编码，前端不可改。**
- **二级目录名（订单号段）由前端参数 `purchaseOrderId` 决定**，经 `/[^a-zA-Z0-9_-]/g` 白名单清洗（`:231`），空值兜底 `'receipt'`。
- 文件名由服务端时间戳 + 数组下标 + 扩展名组成，客户端不能指定文件名；扩展名来自 `filePath` 匹配 `\.([a-zA-Z0-9]+)`（`:234-235`），可控制但仅限字母数字。
- 唯一调用点：`pages/receive-verify/receive-verify.js:199` 传 `order.purchaseOrderId`。

**付款凭证（`pages/purchase-detail/purchase-detail.js:154-159`）：**
```js
const cloudPath = `vouchers/${this.orderId}/${Date.now()}_${i}${ext}`
const up = await wx.cloud.uploadFile({ cloudPath, filePath: res.tempFiles[i].tempFilePath })
```
- **顶层目录 `vouchers/` 硬编码，前端不可改。**
- 二级目录名取 `this.orderId`（页面 data，来自详情加载），**未做白名单清洗**（但 `purchase_order_id` 由服务端生成，只含安全字符）。
- `ext` 来自 `res.tempFiles[i].tempFilePath.match(/\.\w+$/) || ['jpg']`（`:156`），`\w` 不含 `/`，无法穿越目录。

**结论——前缀校验实际防住了什么、防不住什么：**

因为前端**能改的是二级目录名、而不能改顶层目录**，而服务端恰好比对的是「`{顶层}/{本订单号}/`」，所以：

**防住了：**
1. 跨订单/跨门店照片引用落库——把 A 门店订单的照片 fileID 挂到 B 订单上（`:232`/`dataService:1568` 直接拒绝）；
2. 恶意客户端用 `wx.cloud.uploadFile` 直传到 `receipts/他人订单号/` 后引用回本单（二级目录名由服务端拼，与 `purchaseOrderId` 严格绑定）；
3. **删除侧越权**——`dataService:1611-1614` 只删通过前缀校验且不在本次上传列表内的文件，防止用旧凭证字段反删他人文件。

**防不住：**
1. **路径穿越**：`cloudPathOfFileId` 不做 `normalize`，`receipts/PO_A/../../vouchers/PO_B/x.jpg` 通过 `startsWith('receipts/PO_A/')`（§3.1 #11）。实际危害取决于客户端能否构造出该 fileID 形态且目标文件真实存在——小程序端无法 `uploadFile` 到含 `..` 的路径（`safeOrderId` 清洗 + `wx.cloud.uploadFile` 行为未验证），但**已存在的合法 fileID 若被拼接前缀仍可绕过**，且服务端从不校验文件真实存在性；
2. **文件存在性证明**：服务端从不 `downloadFile` 或查询文件元数据，无法证明该 fileID 确实由本会话本次上传，也无法证明它属于本订单的**本次**上传（前缀是订单级而非批次级，历史批次的照片可被重复挂到后续批次）；
3. **文件内容/MIME 类型**：服务端不校验后缀与内容类型，前端虽用 `wx.chooseMedia` 限图片，但上传后服务端无二次校验；
4. **读取侧零校验**：`utils/cloud.js:243-268` 的 `getFileUrl`/`getFileUrls` 是前端直调 `wx.cloud.getTempFileURL`，**任何登录用户（含供货商账号）都能把任意 fileID 换成可下载临时链接**。因此数据库里被落库的任何 fileID（包括 `photo_file_ids`、`verify_voucher_file_ids`、`report_file.file_url`）对全体登录用户等价可读。**归属校验只是「写入侧闸门」，不构成访问控制**——真正的访问控制依赖 `getTempFileURL` 的环境鉴权语义，这属于超出本仓代码可验证范围的部分（见 §7）。

---

## 4. ★ 专项二：状态机转移全图

### 4.1 `purchase_order.order_status`

| 旧值 | 新值 | 触发（文件:行号） |
|---|---|---|
| ∅（新建） | `draft` | `createPurchaseOrder:329` → `:377-385`（`orderStatus` 入参，`:257` 校验） |
| ∅（新建） | `submitted` | 同上（`:329`），且 `submitted_at` 写入（`:348`） |
| `draft` | `draft`（编辑覆盖） | `createPurchaseOrder:355`（仅 `existingOrder.order_status === 'draft'` 可编辑，`:227-229`） |
| `draft` | `submitted` | `createPurchaseOrder:355`（`orderStatus:'submitted'` 编辑提交，前端 `purchase-detail.js:382`） |
| ∅（本域内无写入方） | `approved` | `dataService:501`/`:575`（审核域，非本域） |
| ∅（本域内无写入方） | `rejected` | `dataService:501`/`:575` |
| `approved` \| `report_generated` \| `partial_received` | `received` | `createReceipt:563-566`（`txIsFinalBatch && !hasAbnormal`） |
| `approved` \| `report_generated` \| `partial_received` | `receipt_abnormal` | `createReceipt:563-566`（`txIsFinalBatch && hasAbnormal`） |
| `approved` \| `report_generated` \| `partial_received` | `partial_received` | `createReceipt:563-566`（`!txIsFinalBatch`） |
| `partial_received` | `received` / `receipt_abnormal` / `partial_received` | 同上（分批收货循环） |
| ∅（本域内无写入方） | `cancelled` | `dataService:1393` |

**本域写出点只有 2 处：`createPurchaseOrder:329` 与 `createReceipt:563-566`。** `confirmSupplierOrder` 与 `generateSummaryReport` **完全不写 `order_status`**。

**终态无出口（本域内）：**
- **`received`**：`createReceipt:420-424` 显式 throw `RECEIPT_EXISTS`，`:324-326` 事务外预检亦拒。本域无任何函数能把它转出；`dataService.cancelOrder` 也拒绝作废已有收货记录的订单（`dataService:1393` 上下文 grep 确认拒绝列表含 `received`）。→ **真终态。**
- **`receipt_abnormal`**：`:425` 与 `:247` 的白名单**不含**它 → 本域永久拒绝。**注释 `:419` 声称「`receipt_abnormal` 状态允许继续补收」与代码矛盾** → 本域内无出口；需由异常处理域（`dataService` 的异常流程）转出，而异常流程按 grep 结果只改 `abnormal_record.status`，**不回写 `purchase_order.order_status`** → **实际死锁状态**。
- **`cancelled`**：无本域出口（`draft` 之外的任何状态都不能再被 `createPurchaseOrder` 编辑，`:227-229`）。

**幽灵状态（有白名单、无写入方）：**
- `report_generated`：出现在 `createReceipt:247`/`:425`、`confirmSupplierOrder:12`/`:13` 的可达集合中，但 grep 全库无任何 `order_status: 'report_generated'` 写入点 → **不可达分支**。
- `to_receive`：`confirmSupplierOrder:12`/`:13` 含它；旧版 `createReceipt` 白名单也曾含它（旧报告 `:228`/`:392` 记载），**当前 `createReceipt:247`/`:425` 已移除** → 该状态既无写入方也基本无读取放行方，纯遗留。

### 4.2 `purchase_order` 其他状态字段

| 字段 | 转移 | 触发 |
|---|---|---|
| `verify_status` | ∅ → `'none'`（仅手动单） | `createPurchaseOrder:335` |
| `verify_status` | ∅ → `''`（非手动单，空串而非 `'none'`） | `createPurchaseOrder:335` |
| `verify_status` | `'none'`/`''` → `pending` → `approved`/`rejected` | **非本域**（`dataService:1597`、`:1635`、`:1647`） |
| `missing_reports` | ∅ → `true` | `createPurchaseOrder:82`（报表失败补偿）、`createReceipt:757` |
| `missing_reports` | `true` → `false` | **非本域**：`dataService:1090`、`:1339` |
| `supplier_confirmations.{supplierId}.status` | ∅/`confirmed`/`shipped` → `confirmed` 或 `shipped`（可反复覆盖，无单调约束） | `confirmSupplierOrder:72-80` |
| `backfilled` | ∅ → `true`/`false` | `createPurchaseOrder:331`（`actualDate < today`） |
| `is_manual` | ∅ → `true`/`false` | `createPurchaseOrder:333` |
| `cancel_requested` | 本域**从不写** | — |
| `audit_reminded_at` | 本域**从不写** | — |

### 4.3 子表状态字段

| 集合.字段 | 转移 | 触发 |
|---|---|---|
| `receipt.receipt_status` | ∅ → `'completed'` 或 `'abnormal'` | `createReceipt:490` |
| `receipt.is_final` | ∅ → `true`/`false` | `createReceipt:493`（事务内新鲜重算 `txIsFinalBatch`，`:461-464`） |
| `receipt.batch_no` | ∅ → 递增整数（订单内计数） | `createReceipt:492`（事务内 `:474-479`） |
| `receipt.backfilled` | ∅ → `true`/`false` | `createReceipt:488` |
| `receipt.missing_reports` | ∅ → `true` | `createReceipt:761`；**全库无 `false` 复位点** → 只进不出 |
| `receipt_item.payable_flag` | ∅ → `true`/`false` | `createReceipt:512`（服务端裁决，`:395-401`） |
| `receipt_item.is_shortage` | ∅ → `true`/`false` | `createReceipt:515`（事务外 `:348-351` 置位，事务内 `:467-469` 非最终批清零） |
| `receipt_item.is_quality_issue` / `is_wrong_item` | ∅ → 直接取客户端布尔 | `createReceipt:516-517` |
| `receipt_item.is_manual` | ∅ → `true`/`false` | `createReceipt:514` |
| `receipt_item.price_snapshot` | ∅ → 收货日现价或 0 | `createReceipt:511`（`:385-386`） |
| `abnormal_record.status` | ∅ → `'pending'` | `createReceipt:552` |
| `abnormal_record.status` | `'pending'` → `processing`/`resolved`/`closed` | **非本域**（`dataService:690-695` 字典） |
| `abnormal_record.resolution` | ∅ → `''` | `createReceipt:553` |
| `report_file.status` | ∅ → `'generated'` | `createPurchaseOrder:435`/`:484`、`generateSummaryReport:261`、`createReceipt:626`/`:659`/`:708`/`:743` |
| `report_file.status` | `'generated'` → `'superseded'` | **非本域**（`dataService:1314-1316` 作废单时） |
| `message.read` | ∅ → `false` | 4 个函数全部写 `false` |
| `message.read_by` | ∅ → `[]` | **仅** `createPurchaseOrder:98`、`confirmSupplierOrder:110`；`createReceipt:587`、`:774`、`createPurchaseOrder:66` **未写** |

### 4.4 `report_version_counter` 与 `supplier_product_price`

- `report_version_counter.count`：∅ → 1（新增，`:71`/`generateSummaryReport:71`），随后 CAS `current → current+1`（`createReceipt:90-92`、`createPurchaseOrder:120-122`、`generateSummaryReport:64-66`）。三处 `getNextVersion` 实现**逐字相同**。
- `supplier_product_price`：**本域 4 个函数全部只读，无任何写入**。`createReceipt:369-381` 按 `product_id` + `effective_date <= receiptDate` 分块查询，按 `(supplier_id, product_id)` 取最新有效档（同日优先 `is_current`）。**本域不改价、不锁价、不写价格快照到该集合**（价格快照落在 `receipt_item.price_snapshot`）。

### 4.5 事务边界核查（任务专项问题）

| 函数 | 事务内 | 事务外（半提交区） |
|---|---|---|
| `createReceipt` | `receipt` add、`receipt_item` add、`abnormal_record` add、`purchase_order.order_status` 更新、`message` add（`:417-591`） | `report_version_counter` CAS ×1-4、`cloud.uploadFile` ×1-4、`report_file.add` ×1-4、`purchase_order.missing_reports`、`receipt.missing_reports`、`MSG_REPORT_MISSING` 消息（`:610-781`） |
| `createPurchaseOrder` | `purchase_order` add/update、`purchase_order_item` 删旧+增新、事务内幂等复查（`:353-406`） | `message` 提交消息（`:414`）、`report_version_counter`、`cloud.uploadFile` ×2 类、`report_file.add`、`markOrderReportsMissing`（`:414-507`） |
| `generateSummaryReport` | **无事务** | 全部（`getNextVersion`、`uploadFile`、`report_file.add`） |
| `confirmSupplierOrder` | **无事务** | 条件更新（本身原子）、发货后的两次普通查询、`message` add（`:78-117`） |

**结论：**「写主表 + 写子表 + 写状态 + 发消息」在 `createReceipt` 中**完整落在同一事务内**（含 `message`），这是最完整的边界；但「生成报表」在两个写函数中**都在事务外**，`generateSummaryReport` 与 `confirmSupplierOrder` **完全无事务**。所有云存储操作（`cloud.uploadFile`/`deleteFile`）**不可能**被数据库事务保护，是天然的半提交点。

---

## 5. 调用图

**同步调用（云函数 → 云函数）：** **无。** 本域 4 个函数互相之间**没有任何直接的 `callFunction` 调用**——四个函数是平行的独立部署单元，共享代码（`getSessionUser`/`csvField`/`safePathPart`/`getNextVersion`/`cloudPathOfFileId`）以副本形式各自携带。

**前端 → 云函数（同步）：**
```
purchase-create.js:370 ─┐
purchase-create.js:385 ─┼─→ createPurchaseOrder
purchase-create.js:412 ─┘
purchase-detail.js:336 ─┐
purchase-detail.js:372 ─┴─→ createPurchaseOrder

receive-verify.js:199 ─→ utils/cloud.js uploadReceiptPhotos（前端直调 wx.cloud.uploadFile）
receive-verify.js:200 ─→ createReceipt
receive-verify.js:17  ─→ getPurchaseOrderDetail（非本域，断线恢复用）

report-list.js:142 ────→ generateSummaryReport

supplier-orders.js:121 ─→ confirmSupplierOrder
```

**数据库间接影响（跨函数，非调用关系）：**
- `createPurchaseOrder` 写 `purchase_order.order_status='submitted'` → 被 `dataService.updateOrderStatus`（`dataService:515`）读取作审核前置
- `dataService` 写 `'approved'` → 被 `createReceipt:247/425` 读取作收货前置，被 `confirmSupplierOrder:79` 读取作确认前置
- `createReceipt` 写 `partial_received`/`receipt_abnormal`/`received` → 被 `confirmSupplierOrder:13` 读取（`partial_received` 允许补标发货），被 `dataService` 的作废/取消/统计读取
- `createReceipt` 写 `receipt_item.price_snapshot` → 被 `dataService` 的结算/补生成/补价（`:1096-1113`）读取
- `createPurchaseOrder` 写 `verify_status='none'` → 被 `dataService.verifyManualOrder`（`:1587`）读取作核销前置
- `createPurchaseOrder`/`createReceipt` 写 `missing_reports=true` → 被 `dataService.regenerateOrderReports`（`:1088-1090`）/`regenerateReceiptReports`（`:1337-1339`）读取并复位
- 三者共用 `report_version_counter` 同一计数器集合（`_id = 类型_范围_日期`），**互相 CAS 竞争**

**消息通知（异步，经 `message` 集合间接投递）：**
- `createPurchaseOrder:57-69` → 提交消息（门店广播，`type:'order'`，`biz_id=orderNo`）
- `createPurchaseOrder:88-100` → 缺报表通知（定向超管，`type:'abnormal'`）
- `createReceipt:576-590` → 收货完成/异常（异常定向店长，正常门店广播，`biz_id=receiptId`）
- `createReceipt:765-777` → 缺报表通知（定向超管）
- `confirmSupplierOrder:98-113` → 发货通知（门店广播，`biz_id=orderId`）

---

## 6. 死代码与未闭合点

| # | 项 | 证据 |
|---|---|---|
| 1 | **`ensureReceiptMessage` 定义但从未调用** | `createReceipt/index.js:141-174`（34 行）定义；全库 grep 无任何调用点。被 `:576-590` 的事务内写入取代。注释 `:139-140`「Backfill the notification for receipts created by an older deployment」声称的补写路径实际不存在；`业务模糊点确认清单.md:176` 仍把它当作「补写路径已落地」引用（行号已过期） |
| 2 | **`createdBy` 解构后从未引用** | `createPurchaseOrder/index.js:154`；grep 确认全文仅此一处出现（`:422` 用的是 `createdByName`） |
| 3 | **`data.priceReportsSkipped` 返回但调用方不读取** | `createReceipt:791` 返回；`receive-verify.js:248-257` 只读 `reportsGenerated`/`reportWarning`/`hasAbnormal`/`abnormalTypeNames` |
| 4 | **`data.confirmSupplierOrder.data` 返回但调用方不读取** | `confirmSupplierOrder:119` 返回 `{orderId, supplierId, status}`；`supplier-orders.js:124-126` 只判 `code` 后 `reload()` |
| 5 | **`data.generateSummaryReport.data` 返回但调用方不读取** | `generateSummaryReport:267-275` 返回 `{fileID, fileName, totalAmount, itemCount}`；`report-list.js:148-153` 只判 `code` 后 `reload()` |
| 6 | **不可达分支：`order_status='report_generated'`** | `createReceipt:247`/`:425`、`confirmSupplierOrder:12`/`:13` 放行；全库无写入点 |
| 7 | **不可达分支：`order_status='to_receive'`** | 仅 `confirmSupplierOrder:12`/`:13` 放行；全库无写入点；`createReceipt` 当前白名单已移除该值 |
| 8 | **注释与代码矛盾** | `createReceipt:419` 注释「`receipt_abnormal` 状态允许继续补收」，但 `:425` 白名单 `['approved','report_generated','partial_received']` 不含 `receipt_abnormal` |
| 9 | **`receipt.missing_reports=true` 只进不出** | 写入 `createReceipt:760-762`；`dataService:1088-1090`、`:1337-1339` 两处复位都只针对 `purchase_order` 集合 |
| 10 | **事务内回滚信息可能被吞** | `createPurchaseOrder:371-375` 用 `transaction.rollback({code,msg})` 后 `return`，回滚消息仅在 `:511-513` 通过 `idempotentConflictNo` 变量透传；若 `rollback` 本身抛出且 `idempotentConflictNo` 已赋值则可透传，但若赋值前抛错则退化为通用文案 `:514` |
| 11 | **`markOrderReportsMissing` 的 catch 全吞** | `createPurchaseOrder:102-104`；补偿失败后只剩 `console.error`，前端已收到 `code:0`+`reportWarning`，**管理员可能收不到补生成通知而无人知晓** |
| 12 | **`createSubmissionMessage` 的 catch 全吞** | `createPurchaseOrder:70-72`；提交消息永久缺失无补偿 |
| 13 | **`confirmSupplierOrder` 发货消息 catch 全吞** | `confirmSupplierOrder:114-116`；发货标记已落库但门店无通知，无补发入口 |
| 14 | **`confirmSupplierOrder` `ship` 无幂等 → 消息可无限重复** | `:86-117` 每次成功都 `message.add`，ID 为 `Date.now()` 随机（`:100`），无 `biz_id+type` 去重 |
| 15 | **事务内失败后的补偿逻辑是否真能执行到** | **能执行到**：`createReceipt:749-781` 与 `createPurchaseOrder:495-514` 的补偿都在**外层 catch / 外层 try 尾部**，事务内 `throw` 会冒泡到外层 `:794`（但外层 catch 只处理 3 个自定义错误码后返回 `-1`，**不执行报表补偿**——因为报表补偿在报表段的独立 `try/catch` 内，`:610`/`:749`，而报表段在事务**之后**才执行）。→ 补偿路径确实可达，**但只对「事务已成功提交、报表阶段失败」这一种情形生效**；「事务内失败」不走报表补偿（正确，因为此时无收货单可补） |
| 16 | **`getItemAbnormalNames`/`ABNORMAL_TYPE_NAMES` 的 `missing_price` 键** | `createReceipt:63` 字典含 `missing_price`，`:537-538` 生成描述，`:403-405` 置位——链路完整，**非死代码**（列出以说明已核查） |

---

## 7. 未验证清单

| # | 事项 | 为什么无法从代码确认 | 建议验证方式 |
|---|---|---|---|
| 1 | `report_file.report_id` 是否唯一约束 | 仓库无 schema/索引定义文件（`config.json`/`cloudbaserc.json` 均无），TCB 索引只能在控制台看 | 控制台查看 `report_file` 索引；或用两个云函数并发建单观察是否出现重复 `report_id` |
| 2 | `(request_id, created_by)` 唯一索引是否存在 | `createPurchaseOrder:364-365` 注释称「终极防线是唯一索引，见修复计划 B6-2」，但仓库内无索引定义 | 控制台查看 `purchase_order` 索引 |
| 3 | `receipt.receipt_id`、`receipt_item.receipt_item_id`、`abnormal_record.abnormal_id`、`message.message_id` 的唯一性 | 均由 `Date.now()` + 随机字节生成（`createReceipt:339`、`:502`、`:543`、`:578`），无索引兜底 | 控制台查索引；并发压测 |
| 4 | `db.command.push` 作用于**不存在**的 `read_by` 字段时的行为 | `createReceipt:576-590`、`:765-777` 与 `createPurchaseOrder:57-69` 写消息不带 `read_by`，而 `dataService:698` 用 `_.push(userId)` 更新；`dataService:675-676` 有 `Array.isArray` 容错但 `push` 对缺字段的行为属 SDK 语义 | 需要 `wx-server-sdk` 运行时实测；或读 TCB 官方文档 `$push` 对缺字段的行为 |
| 5 | `db.runTransaction` 对 `message.add` 的支持边界 | 代码把 `message.add` 放进事务（`createReceipt:576`），注释 `:568-575` 声称「同一事务」，但 TCB 事务是否覆盖所有集合、单事务操作数上限的具体值未在仓库内声明；`createReceipt:211-212` 注释估算「6×行数」上限 50 行 | 需 SDK 运行时确认；建议核对 TCB 事务文档的操作数与集合限制 |
| 6 | `transaction.rollback({ code, msg })` 抛出的错误结构 | `createPurchaseOrder:511-513` 依赖外层 catch 读取 `idempotentConflictNo` 而非 `err` 内容；`dataService:582-585` 则靠 `err.errMsg.includes(...)` 判断——两处对 rollback 错误结构的假设不同 | 需运行时确认 `rollback` 抛出对象的形状 |
| 7 | `cloud.deleteFile` 对不存在/已删除 fileID 的行为 | `importProducts:94`、`dataService:1617` 都用 `deleteFile`，catch 后仅记日志 | 需运行时确认 |
| 8 | `wx.cloud.getTempFileURL` 的环境鉴权语义 | 决定 §3.3 第 4 点「读取侧零校验」的实际危害等级——若任意登录用户可解析任意 fileID，则前缀校验不构成访问控制 | 用供货商账号调用 `getFileUrls` 解析他人凭证 fileID 实测 |
| 9 | `wx.cloud.uploadFile` 是否拒绝含 `..` 的 `cloudPath` | 决定 §3.1 #11 路径穿越在真实链路中是否可达 | 需小程序运行时实测 |
| 10 | `wx.cloud.uploadFile` 返回 fileID 的完整格式 | §3.1 表格以 `cloud://{env}.{bucket}/{cloudPath}` 为前提，多段 bucket（如含额外路径段）时正则只剥第一段（#8） | 打印真实 `res.fileID` 确认格式 |
| 11 | `db.command.where` 数组元素匹配语义 | `getSessionUser`（四个函数 `:26-31`）用 `{ sessions: { token_hash } }` 做数组内对象匹配 | 需运行时确认该写法在 TCB 中确实匹配数组元素 |
| 12 | 云函数超时/并发默认配置 | 仓库内无 `config.json`/`cloudbaserc.json`；`createReceipt` 最坏路径含 20+ 次串行 DB 调用与 4 次 `cloud.uploadFile` | 控制台确认超时与并发配置 |
| 13 | `receipt_item.order_qty_snapshot` 在审核改量后与 `purchase_order_item.order_qty` 的一致性 | `dataService:565-567` 会改 `order_qty`/`approved_qty`，而 `createReceipt:490`/`:509` 取的是**当前** `order_qty`；已收货的批次不受影响，但未收完的批次在改量后会用新值 | 需业务口径确认（属异常流程域） |

---

## 8. 行数对账

| 文件 | 任务声明 | 实测内容行数 | 差异 | 本次分段读取覆盖 |
|---|---|---|---|---|
| `cloudfunctions/createReceipt/index.js` | 807 | 807 | 0 | `1-420` + `418-808` → 100% |
| `cloudfunctions/createPurchaseOrder/index.js` | 516 | 516 | 0 | `1-517` → 100% |
| `cloudfunctions/generateSummaryReport/index.js` | 280 | 280 | 0 | `1-281` → 100% |
| `cloudfunctions/confirmSupplierOrder/index.js` | 124 | 124 | 0 | `1-125` → 100% |
| **合计** | **1727** | **1727** | **0** | **100%** |

行号偏移说明：任务提示旧报告中 `createReceipt` 第 52 行之后行号偏移约 +7。实测对照——旧报告引用的「照片前缀校验 `:224`/`:228`」在当前为 `:231`/`:232`（+7~+8）；旧报告「事务内状态复查 `:392`」当前为 `:425`（+33，因 B3 分批收货逻辑后插入）；旧报告「事务内 `:386` 注释」当前为 `:419`。→ **偏移量非固定 +7，而是随插入块累加，本清单一律以当前工作区行号为准。**

本清单额外读取的文件（不计入 1727）：`utils/cloud.js`（283 行，全读）、`pages/receive-verify/receive-verify.js`（`:1-40`、`:40-101`、`:185-265`）、`pages/purchase-create/purchase-create.js`（`:300-429`）、`pages/purchase-detail/purchase-detail.js`（`:140-180`、`:300-401`）、`pages/supplier-orders/supplier-orders.js`（`:95-131`）、`pages/report-list/report-list.js`（`:120-163`）、`cloudfunctions/dataService/index.js`（`:1-30`、`:500-547`、`:545-589`、`:1075-1113`、`:1328-1343`、`:1540-1659`，分块）、`cloudfunctions/importProducts/index.js`（`:65-109`）。

---

## 9. 自检

（写入后抽查的行号引用核对结果）

| 引用 | 抽查实际内容 | 结论 |
|---|---|---|
| `createReceipt/index.js:55` 正则 | `const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(typeof fileId === 'string' ? fileId : '')` | ✅ 与 §3.1 源码引用一致 |
| `createReceipt/index.js:232` 前缀校验 | `if (photoFileIds.some(id => !cloudPathOfFileId(id).startsWith(photoPrefix))) {` | ✅ 已剥协议头 |
| `createReceipt/index.js:425` 事务内白名单 | `if (!['approved', 'report_generated', 'partial_received'].includes(latestOrderRes.data.order_status)) {` | ✅ 确实不含 `receipt_abnormal`，R1 成立 |
| `createReceipt/index.js:419` 矛盾注释 | `// B3 分批收货：已全部收齐（received）才拦截；receipt_abnormal 状态允许继续补收` | ✅ 注释与 `:425` 矛盾成立 |
| `createReceipt/index.js:490` | `receipt_status: hasAbnormal ? 'abnormal' : 'completed', overall_remark: overallRemark,` | ✅ 字段与取值一致 |
| `createReceipt/index.js:563-566` | `const nextStatus = txIsFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'` + `.update({ data: { order_status: nextStatus, updated_at: db.serverDate() } })` | ✅ 与 §4.1 转移表一致 |
| `createReceipt/index.js:760-762` | `await db.collection('receipt').where({ receipt_id: receiptId }).update({ data: { missing_reports: true } })` | ✅ 第 9 条死代码结论（无复位点）成立 |
| `createReceipt/index.js:791` | `priceReportsSkipped: hasAbnormal` | ✅ R3 成立 |
| `createPurchaseOrder/index.js:154` | `createdBy,` | ✅ 全文仅此一处，第 2 条死代码成立 |
| `createPurchaseOrder/index.js:329` | `order_status: orderStatus,` | ✅ |
| `createPurchaseOrder/index.js:353` | `await db.runTransaction(async transaction => {` | ✅ 事务起点一致 |
| `createPurchaseOrder/index.js:422` | CSV 行含 `csvField('经办人'), csvField(createdByName || '')` | ✅ R1 成立 |
| `generateSummaryReport/index.js:241` | `const fileName = \`reports/summary/${period}/${storeId}/${pathDate}-summary-v${version}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.csv\`` | ✅ 随机后缀成立 |
| `generateSummaryReport/index.js:261` | `status: 'generated',` | ✅ |
| `confirmSupplierOrder/index.js:79` | `.where({ purchase_order_id: orderId, order_status: _.in(allowedStatus) })` | ✅ 条件更新（非事务）成立 |
| `confirmSupplierOrder/index.js:100` | `message_id: 'MSG' + Date.now() + crypto.randomBytes(4).toString('hex'),` | ✅ 随机 ID、无去重，R5 成立 |
| `utils/cloud.js:231` | `const safeOrderId = String(purchaseOrderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'receipt'` | ✅ 二级目录名由前端决定、顶层 `receipts/` 硬编码（`:237`） |
| `importProducts/index.js:92`/`:94` | `const res = await cloud.downloadFile({ fileID })` / `try { await cloud.deleteFile({ fileList: [fileID] }) } catch (e) {...}` | ✅ 无归属校验，漏改条目 D 成立 |

**抽查结论：18 处行号引用全部与源码一致，无编造、无偏移。**

---
