# A5 收货写入域 + 收货/异常前端页面 重扫报告

- 扫描日期：2026-10-18
- 范围：`createReceipt` / `getReceipts` / `getSupplierReceipts` / `dataService` 的异常与补结算域 / `receive-list` / `receive-verify` / `abnormal-list` / `supplier-receipts` / `utils/cloud.js` / `utils/meta.js` / 收货相关 seed
- 基线：git 工作区当前内容（`createReceipt/index.js` 有未提交修改，以工作区为准）
- 交叉核实：`getPurchaseOrderDetail`（验收页数据源）、`confirmSupplierOrder`、`authService`（供应商账号绑定）、`updateProductPrice`（`effective_date` 类型）

---

## 一、漏洞清单

### A5-1 【P1】客户端可写入的异常标记 `isQualityIssue/isWrongItem` 直接决定付款资格，可静默剔除应付行并伪造异常台账

**位置**
- `cloudfunctions/createReceipt/index.js:300-310`（`...inputItem` 原样展开客户端明细）
- `cloudfunctions/createReceipt/index.js:391-407`（`hardAbnormal` → `payableFlag`）
- `cloudfunctions/createReceipt/index.js:525-529`（按这些标记写 `abnormal_record`）
- 对比：`isShortage` 是服务端重算的（`349-352`、事务内 `469-471`），而 `productId/supplierId/orderQty/priceSnapshot` 全部服务端取值。

**证据**
```js
canonicalItems.push({
  ...inputItem,                       // ← isQualityIssue / isWrongItem 原样透传，无任何校验
  orderItemId,
  productId: orderItem.product_id,
  productName: orderItem.product_name_snapshot,
  ...
})
...
const hardAbnormal = abnormalTypes.some(t => t !== 'shortage')   // ← 完全由上面透传的布尔值驱动
item.payableFlag = !hardAbnormal && priceSnapshot > 0
```

**与代码自身声明的不变量冲突**：`createReceipt:399-401` 注释写明"付款资格完全由服务端裁决……不信任客户端传来的 `payableFlag`——否则改客户端参数即可把正常行挤出（或塞回）结算账单"。`payableFlag` 确实被覆写，但决定它的输入（`isQualityIssue/isWrongItem`）仍是客户端可控——注释描述的"把正常行挤出结算账单"攻击路径依然成立。

**攻击步骤**
1. 用 `purchaser`（全局角色，可跨所有门店）或本店 `store_manager` 的 `authToken` 调 `createReceipt`。
2. `items` 里对一条本应付款的正常行附加 `isQualityIssue: true` 或 `isWrongItem: true`，`receivedQty` 填合法数量。
3. 结果：该行 `payableFlag=false`，被排除在报表④/⑥（门店/供应商带价账单）之外；同时写入一条 `type=quality|wrong_item` 的 `abnormal_record`。
4. 管理员（或该店长本人）调 `dataService.resolveAbnormal({id, resolution, paymentDecision:'reject'})` → 该行永久不进账单，形成"静默少付货款"，且台账上只留下一条看似合规的异常记录。
5. 反向滥用：制造虚假质量/错货异常，出现在供应商端 `getSupplierReceipts` 的异常列表里，可发起虚假对账争议或施压采购改价。

**影响**：应付金额被人为压低（漏付供应商）、异常台账被伪造、审计链断裂（付款裁决无独立复核证据）。

**修复建议**：服务端不接受客户端的异常定性输入，改为按服务端事实（`receivedQty vs order_qty`）推导 `shortage`；`quality/wrong_item` 走独立的异常提交流程（需填写说明 + 与收货人不同的处理人），并禁止用异常裁决去修改已生成账单行的 `payable_flag`（须走冲销/红冲流程留痕）。

---

### A5-2 【P2】`receiptDate` 只校验格式不校验范围 → 操纵协议价档位选择、污染报表归档日期

**位置**
- `cloudfunctions/createReceipt/index.js:331-338`（只校验 `YYYY-MM-DD` 格式）
- `cloudfunctions/createReceipt/index.js:366-382`（`effective_date: _.lte(receiptDate)`，无下界、无上限）
- `cloudfunctions/createReceipt/index.js:484-497`（`receipt_date` 原样落库；`backfilled` 仅在 `< 今日` 时置位）

**证据**
```js
const receiptDate = isReceiptDate(event.receiptDate)
  ? event.receiptDate                    // ← '2099-12-31' / '2001-01-01' 均通过
  : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
...
const priceRes = await db.collection('supplier_product_price')
  .where({ product_id: _.in(idChunk), effective_date: _.lte(receiptDate) })  // ← 无下界
  .limit(1000)
  .get()
// 同日多行时优先 is_current；否则取 effective_date 最新一档 → 收货日越晚，命中价越高
```

**攻击步骤**
1. 以本店 `store_manager` 身份对已审批订单提交收货，`receiptDate` 传未来日期（如协议价上调后的一天）。
2. 价格快照取"最新一档"→ `priceSnapshot` 抬升 → 报表④/⑥ 的 `小计/合计` 与应付金额同步抬升；且 `receipt_date < 今日` 为假，`backfilled` 标记不会置位，对账侧无痕迹。
3. 反之传一个更早的历史日期，可命中更低的历史档位压低应付金额。
4. 附带后果：`related_date`、云存储路径 `reports/store/{receiptDate}/...`、`getNextVersion` 计数器全部落到攻击者自选日期，可批量污染跨日汇总报表（门店日/月汇总按 `related_date` 归集）。

**影响**：单价档位由客户端间接决定 → 应付金额可双向操纵；报表归档日期可污染。

**修复建议**：`receiptDate` 限定在 `[order.order_date, 服务端今日]` 区间（允许补录时另走带审批/留痕的补录接口）；价格查询同时加 `effective_date >= 订单日期` 下界。

---

### A5-3 【P2】分批收货的历史累计聚合受 `limit(1000)` 截断 → 超收硬校验可被绕过

**位置**
- `cloudfunctions/createReceipt/index.js:438-441`（事务内 `txHistoryRes`）
- `cloudfunctions/createReceipt/index.js:448-457`（唯一的上限拦截点）
- `cloudfunctions/createReceipt/index.js:463-466`（`txIsFinalBatch` 同受该截断影响）
- `cloudfunctions/createReceipt/index.js:257-262`（订单明细 `.limit(1000)`，无 `orderBy`）

**证据**
```js
const txHistoryRes = await transaction.collection('receipt_item')
  .where({ purchase_order_item_id: _.in(txItemIds) })
  .limit(1000)                    // ← 超出即静默截断，且无 orderBy，返回哪 1000 条不确定
  .get()
...
if (!Number.isFinite(orderQty) || txHistoryQtyVal + item.receivedQty > orderQty) {  // ← 依赖被截断的累计值
  const overError = new Error(`OVER_RECEIVE:${item.productName}`)
```

**攻击步骤**
1. 构造一个明细行数较多的采购单（例如 100 行），经 B3 分批收货累计产生 >1000 条 `receipt_item`（100 行 × 11 批即达阈值）。
2. 再次提交收货：`txItemIds` 含全部订单行，`txHistoryRes` 只返回 1000 条 → `txHistoryQty` 系统性低估 → `txHistoryQtyVal + receivedQty > orderQty` 判定失效。
3. 结果：实收可超过下单量，超额部分以正常 `payableFlag=true` 进入带价账单 → 虚增应付金额。
4. 次生影响：`txIsFinalBatch` 同样被低估，订单可能永久停在 `partial_received`，或对已超额订单反复补收。
5. 附带：订单明细 `.limit(1000)` + 无 `orderBy` → 超过 1000 行的订单，部分行在整条收货链路上不可见（无法验收、也无法被计入收齐判定）。

**影响**：应付金额虚增（P0-3/P1-5 修复的超收防线在高基数订单上失效）。

**修复建议**：累计量改为服务端聚合（`aggregate().group()` 按 `purchase_order_item_id` 求和），不要靠拉取明细逐条累加；订单明细查询去掉 `limit` 或改为聚合统计行数并报错拦截超限单。

---

### A5-4 【P2】`settleReceipt` 解锁付款不校验异常类型，质量/错货行可被裁决"转回可付款"并生成供应商账单

**位置**
- `cloudfunctions/dataService/index.js:962-979`
- 上游：`cloudfunctions/dataService/index.js:813-820`（`resolveAbnormal` 接受任意类型的 `paymentDecision`）
- 前端触发：`pages/abnormal-list/abnormal-list.js:77-86`（所有异常类型都弹同一个"是否按实收转回可付款"确认框）

**证据**
```js
const payReceivedRecords = abnormalRes.data.filter(item => item.status !== 'closed' && item.payment_decision === 'pay_received')
...
const target = itemResForPay.data.find(it => it.receipt_item_id === itemItemId)
if (target && !target.is_manual && Number(target.price_snapshot) > 0) {
  unlockedIds.add(target._id)
  await db.collection('receipt_item').doc(target._id).update({ data: { payable_flag: true, ... } })  // ← 不校验 rec.type
}
```

**攻击步骤**
1. 收货时对某行勾选"质量问题/错货"（或该行为真实质量异常），生成 `type=quality|wrong_item` 异常，该行原账单被剔除。
2. 店长对该异常 `resolveAbnormal({ paymentDecision:'pay_received' })`，然后管理员 `settleReceipt`。
3. 结果：质量/错货行被改写 `payable_flag=true` 并进入增量供应商账单，突破 `createReceipt:390-391` 明确的业务硬约束"质量/错货行不得进入付款结算"。

**影响**：付款裁决的状态机绕过；B4 的行级结算隔离被异常裁决流程反向推翻。
`[待确认]` 是否业务上允许"质量行按实收付款"（如让步接收）。若不允许，需在 `settleReceipt` 与 `resolveAbnormal` 双端加类型白名单。

**修复建议**：`resolveAbnormal` 仅对 `shortage`/`missing_price` 接受 `pay_received`；`settleReceipt` 侧对 `rec.type` 做白名单兜底校验，并在解锁时校验目标行原 `payable_flag === false`。

---

### A5-5 【P2】`regenerateReceiptReports` 无幂等、无 superseded 标记 → 重复执行产生重复供应商账单

**位置**
- `cloudfunctions/dataService/index.js:1184-1350`（全函数无 `report_file` 已存在检查、无旧报表状态改写）
- 对比：`settleReceipt` 有 `_S` 后缀幂等检查（`dataService:937-943`）与并发锁（`947-956`），本函数两者皆无
- 间接触发：`cloudfunctions/dataService/index.js:1171-1173`（`repriceReceipt` 无条件调用它）

**证据**
```js
// settleReceipt 的做法：
if (settledRes.data.some(r => String(r.report_id || '').endsWith(receiptId + '_S'))) {
  return { code: -1, msg: '该收货单已补结算，请勿重复操作' }
}
// regenerateReceiptReports 里没有任何等价检查，每次调用直接：
await db.collection('report_file').add({ data: { report_id: 'RPT_SURP_' + sid + '_' + receiptId + '_RG', ... status: 'generated' } })
```

**攻击步骤**
1. 以 `purchaser/super_admin` 反复调用 `dataService({action:'regenerateReceiptReports', receiptId})`（云函数公开可调用，前端按钮只是入口）。
2. 每次调用都新增一份③④⑤⑥报表，`report_id` 完全相同（如 `RPT_SURP_SUP001_RCPxxx_RG`），只有 `file_version` 递增；旧报表 `status` 保持 `generated`，未被标记 `superseded`。
3. 结果：报表中心出现 N 份同一账单，按报表逐份对外发对账即重复计费；无任何审计字段能区分哪一份有效。
4. 附带：`repriceReceipt` 场景下若一张单有两条缺价行、分两次补价，第二次会再产出一整套 `_RG` 报表，同样重复。

**影响**：应付金额重复出账；报表版本治理缺失。
说明：触发者限于全局管理角色（内部越权，非外部攻击者），故定为 P2 而非 P1。

**修复建议**：进入函数先查 `report_file` 是否已有 `report_id = *_RG` 且 `status='generated'` 的记录，命中则标记旧记录 `superseded` 或直接拒绝；补生成加与 `settleReceipt` 同款的条件更新锁。

---

### A5-6 【P2】收货不校验 `cancel_requested` 与供应商确认状态，作废申请中的订单可照常收货并出账

**位置**
- `cloudfunctions/createReceipt/index.js:247-250`（状态白名单，不含 `cancelled` 但也不读 `cancel_requested`）
- `cloudfunctions/dataService/index.js:1463, 1472-1480`（`requestCancel` 只写标记，`order_status` 保持 `approved/report_generated/partial_received`）
- `cloudfunctions/confirmSupplierOrder/index.js:71-83`（供应商确认只写 `supplier_confirmations.{sid}`，不改 `order_status`）

**证据**
```js
// createReceipt
if (!['approved', 'report_generated', 'partial_received', 'receipt_abnormal'].includes(order.order_status)) {
  return { code: -1, msg: '订单尚未审批通过，不可收货' }
}                                   // ← 从未读取 order.cancel_requested / order.supplier_confirmations
// requestCancel（dataService）
.where({ _id: order._id, cancel_requested: _.neq(true) })
.update({ data: { cancel_requested: true, ... } })   // ← order_status 不变
```

**攻击步骤**
1. 管理员对某 `approved` 订单发起取消申请（`requestCancel`）→ 订单挂 `cancel_requested=true`，状态仍为 `approved`。
2. 门店店长照常在 `receive-verify` 提交收货（前端 `receive-list.js:46` 的过滤条件也不含 `cancel_requested`，界面照常显示该单）→ 生成收货单与带价账单，订单进入 `partial_received/received`。
3. 之后管理员再想作废会被 `cancelOrder` 的"已有收货记录不能作废"拦下（`dataService:1370-1380`）→ 订单在"作废申请中"的状态下完成结算，两条流程互相锁死且无告警。
4. 流程前提中的"供应商确认"环节同样无硬门禁：`createReceipt` 从不读取 `supplier_confirmations`，供应商未确认/已发货与否都不影响收货与出账。

**影响**：作废流程失效、供应商在已被要求取消的订单上继续被结算；状态机与流程前提不一致。
`[待确认]` "供应商确认后才可收货"是否为强制业务规则；若是，此处为硬门禁缺失。

**修复建议**：`createReceipt` 事务内复查 `cancel_requested`（及按需复查 `supplier_confirmations[对应供应商].status`），命中则抛错回滚；前端 `receive-list` 同步过滤/标注。

---

### A5-7 【P3】`repriceReceipt` 无条件把缺价行置为可付款，不校验质量/错货标记

**位置** `cloudfunctions/dataService/index.js:1126, 1143-1150`

**证据**
```js
const missingItems = items.filter(item => !item.is_manual && item.supplier_id && Number(item.price_snapshot || 0) <= 0)
...
await db.collection('receipt_item').doc(item._id).update({
  data: { price_snapshot: price, payable_flag: true, updated_at: db.serverDate() }   // ← 忽略 is_quality_issue / is_wrong_item / is_shortage
})
```
若某行同时缺价且被标记质量/错货，补价后该行会被转成可付款并随 `regenerateReceiptReports` 进账单（同 A5-4 的隔离绕过，且此路径连异常裁决都不需要）。

**修复建议**：置位前校验 `!is_quality_issue && !is_wrong_item`；缺价行补价后仍需走异常处理留痕。

---

### A5-8 【P3】`getAbnormalRecords` 缺少 `default_store_id` 空值守卫，非全局角色存在跨门店越权读取的条件

**位置** `cloudfunctions/dataService/index.js:745-752`；对照 `cloudfunctions/getReceipts/index.js:53-55`（有守卫）

**证据**
```js
const query = {}
if (!GLOBAL_ROLES.includes(auth.user.role)) query.store_id = auth.user.default_store_id   // ← 未判空
```
若某条 `store_manager` 记录的 `default_store_id` 缺失/为 `undefined`（区别于 `''`），`where({store_id: undefined})` 在序列化时该字段被丢弃 → 查询退化为空条件 → 返回全库异常记录（含其它门店的 `description`、`resolution`、供应商与门店名）。当前 seed 中 `store_manager` 均为 `S001`，故实际不可触发。
`[待确认]` 是否存在历史/迁移脚本创建的 `store_manager` 无 `default_store_id`；`authService.createUser/updateUser`（`362,410`）只校验"门店存在"，未强制非空。

**修复建议**：与 `getReceipts` 一致，`!auth.user.default_store_id` 时直接返回 `-403`。

---

### A5-9 【P3】供应商端接口向供应商返回内部处理结论与内部付款裁决

**位置**
- `cloudfunctions/getSupplierReceipts/index.js:81-95`
- `pages/supplier-receipts/supplier-receipts.js:53-64`、`pages/supplier-receipts/supplier-receipts.wxml:20-22`
- 同域：`cloudfunctions/getSupplierReceipts/index.js:99-111`（`...item` 把 `remark`、`is_quality_issue`、`is_wrong_item` 等内部字段一并下发）

**证据**
```js
abnormalMap[key].push({
  type: rec.type || '',
  status: rec.status || '',
  resolution: rec.resolution || '',          // ← 内部处理结果原文（可能含"与财务确认不予付款"等）
  payment_decision: rec.payment_decision || ''
})
```
供应商页面直接渲染：`裁决：按实收补款 / 裁决：维持不付款` + `resolution` 全文。

说明：代码注释标注为"S7 拍板"（有意为之，供供应商对账），因此列为 P3 提示项。边界问题在于 `resolution` 是内部自由文本，未做信息分级，内部谈判口径/成本相关表述会原样出站到供应商。

**修复建议**：供应商端只下发 `type/status/裁决结论`，不下发 `resolution` 原文；内部备注统一收敛到内部报表。

---

### A5-10 【P3】收货写入无客户端幂等键，网络抖动/重试会产生重复收货单

**位置** `cloudfunctions/createReceipt/index.js:320-324, 340`；缓解措施在前端 `pages/receive-verify/receive-verify.js:6-37, 234-246`

**证据**
```js
const batchNo = historyReceiptRes.data.length + 1   // ← 纯计数
const receiptId = 'RCP' + Date.now() + crypto.randomBytes(3).toString('hex')  // ← 无客户端幂等键
```
事务内只拦截"订单已 `received`"（`421-425`），对同一订单的并发/重试不会去重。前端虽用 `getPurchaseOrderDetail` 回查做补偿，但服务端仍会落到第二张收货单。

**攻击步骤**：客户端并发发两个 `createReceipt`（同一订单同一批明细）→ 两张收货单 + 两套报表 + `batch_no` 重号风险被 `txBatchNo` 计数吸收，但 `report_version_counter` 与异常台账被重复灌入。数量受 `order_qty` 上限约束，故定 P3。

**修复建议**：支持客户端传 `idempotencyKey`，服务端按 `(purchase_order_id, key)` 做条件插入去重；或按 `(purchase_order_id, 明细行, 数量)` 做短窗口去重。

---

### A5-11 【P3】订单 `store_id` 为空时，全局角色可把收货归属到任意门店

**位置** `cloudfunctions/createReceipt/index.js:244-246, 190-197, 204-206`

**证据**
```js
if (order.store_id && order.store_id !== storeId) {          // ← store_id 为空时短路跳过
  return { code: -1, msg: '订单门店与当前门店不一致，请切换门店后重试' }
}
...
storeName = order.store_name || storeName                    // ← 门店名回退到客户端/查询值
```
`storeId` 对全局角色是客户端传入的（仅校验门店存在且启用），随后进 `receipt.store_id` 与报表 `scope_id`。对 `store_id` 缺失的历史订单，一张收货单可被挂到任意门店名下，影响门店维度对账与月汇总。

**修复建议**：`order.store_id` 缺失时直接拒绝收货并要求补全订单归属，不允许回退到客户端 `storeId`。

---

### A5-12 【P3】收货后无独立复核环节，同一店长既提交收货又裁决本店异常付款

**位置**
- `cloudfunctions/createReceipt/index.js:252`（`receivedBy = user.name || user.username || receivedBy`，服务端取值，正确）
- `cloudfunctions/createReceipt/index.js:565-568`（收货提交即推进 `partial_received/received` 并直接生成带价报表，无"待复核"态）
- `cloudfunctions/dataService/index.js:798-825`（本店店长即可对本店异常做 `payment_decision` 裁决）

**证据**
```js
const nextStatus = txIsFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'
await transaction.collection('purchase_order').doc(order._id)
  .update({ data: { order_status: nextStatus, updated_at: db.serverDate() } })   // ← 无复核前置态
```
`received_by` 与后续 `resolved_by` 可为同一账号，`receipt` 上没有任何 reviewer 字段与 `receipt.abnormal_resolution_by != received_by` 的校验。

**影响**：职责未分离（收货人自裁付款），金额调整缺少第二人控制。

**修复建议**：增加"待复核"中间态或要求 `resolved_by !== receipt.received_by`；对"异常裁决改付款"类动作强制全局角色执行并留痕。

---

## 二、已核实为安全的点（本轮重点排查后确认无问题）

| 排查项 | 结论与证据 |
|---|---|
| 收货超量硬校验 | `createReceipt:297-299`（事务外预检）+ `452-457`（事务内新鲜累计复算）双层拦截，`OVER_RECEIVE` 抛错回滚。仅 `limit(1000)` 截断为例外（见 A5-3） |
| 数量/单价篡改 | `priceSnapshot`（`384-387`）、`payableFlag`（`396-407`）、`orderQty/productId/supplierId/unit/productName/isManual`（`300-310`）全部服务端取值；客户端传入的 `priceSnapshot/payableFlag` 被覆盖。结算金额服务端重算（`648-652`、`731-735`） |
| 跨单收货 | 按 `purchase_order_id` 查主表（`236-243`）+ 门店一致性校验（`244-246`）+ 状态白名单（`248-250`，事务内复查 `421-431`）；状态机 `received → 再次收货` 被 `325-327` 与 `421-425` 双向拦截；`submitted/pending_approval/rejected/cancelled/completed` 均不在白名单 |
| 明细归属 | `orderItemMap` 由服务端订单明细构建（`263-267`），客户端 `orderItemId` 不匹配即拒绝（`286-289`）；同批重复行拦截（`287 seenOrderItems`） |
| `getReceipts` IDOR | 权限完全按 `user.role` 判定，`event.role/storeId` 不参与授权（`getReceipts:44,49-59`）；`store_manager` 强制 `query.store_id = user.default_store_id`，`supplier` 直接 `-403`，`chef` 返回空 |
| 供应商端跨供应商读取 | `supplierId = user.default_supplier_id`（`getSupplierReceipts:46`），客户端无法传入；`receipt_item.supplier_id` 由 `createReceipt` 从订单明细服务端写入；账号绑定仅超管可写（`authService:380,437`，`updateUser` 需 `requireSuperAdmin`） |
| 异常域越权与状态回退 | `startAbnormal/resolveAbnormal/closeAbnormal`（`dataService:783,799,851`）均先 `requireUser` 角色白名单，再校验 `record.store_id === user.default_store_id`（非全局）；状态机单向 `pending→processing→resolved→closed`，无回退入口 |
| 写操作事务性 | 收货主表、明细、异常记录、订单状态、消息全部在同一 `db.runTransaction` 内（`createReceipt:418-593`）；报表生成失败有 `missing_reports` 标记 + 定向通知补偿（`751-783`） |
| 照片归属 | `createReceipt:229-234` 校验 `fileID` 剥离协议头后必须以 `receipts/{purchaseOrderId}/` 开头 |
| CSV 注入 | `csvField`（`41-46`）对 `= + - @` 开头值加 `'` 前缀 |
| 手动商品隔离 | `payableFlag=false`（`396-397`）+ 报表侧双保险过滤 `!item.isManual`（`640,721`）+ `getSupplierReceipts:54` `is_manual: _.neq(true)` |
| 会话与会话过期 | 各函数统一 `getSessionUser`（token hash 查询 + 过期校验），`getReceipts/createReceipt/getSupplierReceipts` 一致 |

---

## 三、已通读但无发现的文件

- `cloudfunctions/getReceipts/index.js`（92 行全读）
- `pages/receive-list/receive-list.wxml`（57 行）、`receive-list.wxss`（44 行，纯样式）、`receive-list.json`
- `pages/receive-verify/receive-verify.wxml`（94 行）、`receive-verify.wxss`（145 行，纯样式）、`receive-verify.json`
- `pages/abnormal-list/abnormal-list.wxml`（57 行）、`abnormal-list.wxss`（73 行，纯样式）、`abnormal-list.json`
- `pages/supplier-receipts/supplier-receipts.wxml`（31 行）、`supplier-receipts.wxss`（16 行，纯样式）、`supplier-receipts.json`
- `utils/cloud.js`（283 行全读）：`callFunction` 强制附带 `authToken`，401 统一跳登录；`uploadReceiptPhotos` 对订单号做 `[^a-zA-Z0-9_-]` 清洗后拼路径，无目录穿越
- `utils/meta.js`（67 行全读）：纯展示映射表
- `seed-data/receipt.json` / `receipt_item.json` / `abnormal_record.json`：仅样例数据，无脚本执行
- `pages/receive-verify/receive-verify.js`、`pages/receive-list/receive-list.js`、`pages/abnormal-list/abnormal-list.js`、`pages/supplier-receipts/supplier-receipts.js`：前端仅作展示与参数透传，未承载权限/金额判定（相关判定缺口已在上表与 A5-1/2/6 中指向服务端）

---

## 四、未覆盖 / 存疑（需其他子代理或业务确认）

1. **供应商确认是否为强制前置**：A5-6 中的 `supplier_confirmations` 未作为收货门禁，需业务确认（`confirmSupplierOrder`、`createPurchaseOrder` 归 A4）。
2. **`abnormal_record` 是否存在除 `createReceipt` 外的写入入口**：本域内只发现 `createReceipt` 写入；`getReportDetail/getReports` 等只读，未逐一核实其是否可写异常状态（归 A3/A5 交界）。
3. **`receipt`/`receipt_item` 是否有其他云函数可直接改金额字段**：本域内仅 `settleReceipt`（改 `payable_flag`）与 `repriceReceipt`（改 `price_snapshot`）两处，均限全局角色；`createPurchaseOrder/dataService.auditOrder` 是否可改 `order_qty` 从而影响后续超收判定（归 A4，`dataService:500 regenerateApprovedOrderReports(qtyChanged)` 提示存在改量路径）。
4. **`report_file` 的读取侧授权**：`getReports/getReportFileUrl` 是否允许供应商跨供应商读取带价报表，不在本次范围（归 A3/A7）；但 A5-5 的重复账单会经该链路对外暴露。
5. **`repriceReceipt` 重复 `_RG` 报表**（A5-5 附带）：需确认业务是否允许"一条缺价行补价一次即出账"，或需按行拆分账单。
6. **`abnormal-list.js:50`** 有 `const app = getApp()` 未使用；`resolveAbnormal.js` 中 `handleAbnormal` 同样残留未使用变量——无安全问题，仅代码卫生。
7. **前端 A5-1 无法从 UI 复现**：`receive-verify.wxml:46-52` 的勾选框是正常业务交互，但同一标记可被直接调云函数伪造，故该缺口只能靠服务端修复。
8. **`getAbnormalRecords` 越权（A5-8）需数据侧确认**：需要线上 `app_user` 中是否存在 `role='store_manager'` 且 `default_store_id` 缺失/`undefined` 的记录。
