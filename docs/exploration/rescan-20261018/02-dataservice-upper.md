# dataService 云函数 · 前半段(第 1–900 行)安全审计

- 审计对象:`cloudfunctions/dataService/index.js` 第 1–900 行(工作区未提交版本)
- 审计人:安全审计子代理 A2(只读)
- 配套参照:`utils/cloud.js`、`utils/meta.js`、`seed-data/{app_user,store,message}.json`、跨函数消息写入方 `createPurchaseOrder` / `createReceipt` / `confirmSupplierOrder`、鉴权会话写入方 `authService`
- 覆盖的 action(来自第 1714 行分发表):`getCategories`、`saveProduct`、`toggleProduct`、`saveSupplier`、`toggleSupplier`、`auditOrder`、`getMessages`、`markMessageRead`、`markAllMessagesRead`、`getAbnormalRecords`、`startAbnormal`、`resolveAbnormal`、`closeAbnormal`、`getOrderStats`(函数体 875–913,尾部 900–913 落在 A3 段,已一并复核)
- 边界:`settleReceipt`(918 起)、`repriceReceipt`、`regenerateReceiptReports`、`regenerateOrderReports`、`cancelOrder`、`requestCancel`、`rejectCancel`、`remindAudit`、`verifyManualOrder` 属 A3 范围,本段仅在需要判定影响面时引用(`settleReceipt` 第 962 行的 `payment_decision` 消费点)

## 结论概览

本段代码整体防御水位较高:所有 action 均调用 `requireUser`(第 52–59 行),角色从服务端会话解析而非客户端参数;写操作普遍使用事务 + 事务内复查(549–559)或条件更新 CAS(962 段之外,本段 `getNextVersion` 368–394);`publicMessage`(640–651)做了字段白名单;未发现 `password_hash` / 成本价 / 他人手机号泄漏;未发现可任意创建 admin、改角色、删门店的入口(用户/门店管理不在本文件,由 `authService` 承担)。

本段**未出现 P0/P1**。主要问题集中在:财务裁决的岗位分离缺口(P2)、异常/消息域按 `_id` 操作时的租户维度校验缺失(P2/P3)、以及若干非原子与输入长度不设限的健壮性问题(P3)。

---

## P2 发现

### P2-1 `resolveAbnormal` 把"付款裁决"下放给店长,无管理员二次确认

**位置**:`cloudfunctions/dataService/index.js:798–825`(角色白名单 799、状态闸门 811、`paymentDecision` 813–825)

**证据**

```js
async function resolveAbnormal(event) {
  const auth = await requireUser(event, ['store_manager', 'purchaser', 'super_admin'])   // 799
  ...
  if (record.status !== 'processing') return { code: -1, msg: '只有处理中异常才能标记为已解决' }
  // 付款裁决:pay_received = 异常行转回可付款(补结算时纳入);reject = 维持不可付款
  const paymentDecision = ['pay_received', 'reject'].includes(event.paymentDecision) ? event.paymentDecision : ''
  await db.collection('abnormal_record').doc(event.id).update({
    data: { status: 'resolved', resolution, payment_decision: paymentDecision, ... }
  })
```

**影响链(已核实消费点)**:`settleReceipt` 第 962 行 `abnormalRes.data.filter(item => item.status !== 'closed' && item.payment_decision === 'pay_received')`,随后第 974–978 行把这些行 `payable_flag` 置 `true` 并计入补充账单。第 840–846 行的提醒消息也明确要求"管理员尽快执行补结算"。

**攻击步骤**

1. 攻击者持有门店 S001 的 `store_manager` token(店长账号,业务上由门店自行发放/管理)。
2. 调用 `dataService` action=`resolveAbnormal`,params:`{ id: <S001 某条 status='processing' 的 abnormal_record._id>, resolution: '协商处理完毕', paymentDecision: 'pay_received' }`。
3. 通过第 808 行门店校验(同门店),`payment_decision` 被写入 `pay_received`。
4. 管理员在补结算时被系统提醒"异常已解决",`settleReceipt` 将该异常行重新计入应付,供应商账单被抬高。

**为什么是问题**:同一条链路上,异常的上报/处理责任人(店长)与付款放行裁决人是同一人,且 `closeAbnormal`(850–851)同一白名单,意味着店长可独立完成"处理 → 解锁付款 → 关闭"全流程,无任何管理员签核,`resolved_by` 只记姓名(见 P3-6)。属于职责分离(SoD)缺口,而非越权访问;严重度取决于门店与供应商是否存在合谋或账目被外部审计追溯的诉求。

**修复建议**:`paymentDecision` 的写入限定 `GLOBAL_ROLES`;店长侧 `resolveAbnormal` 只允许写 `resolution` 并把 `payment_decision` 置空,裁决改由管理员在 `settleReceipt` 之前单独 action 完成;两处都把操作者 `user_id` 一并落库。

---

### P2-2 `getAbnormalRecords` 对 `supplier` 角色退化为 `where({ store_id: '' })`,异常台账越域可读

**位置**:`cloudfunctions/dataService/index.js:745–757`

**证据**

```js
async function getAbnormalRecords(event) {
  const auth = await requireUser(event)
  ...
  if (auth.user.role === 'chef') return { code: 0, data: [] }
  const query = {}
  if (!GLOBAL_ROLES.includes(auth.user.role)) query.store_id = auth.user.default_store_id   // 750–751
  if (event.status) query.status = event.status
  const result = await db.collection('abnormal_record').where(query)...
```

`GLOBAL_ROLES = ['super_admin', 'purchaser']`(第 8 行)。`supplier` 既非 `chef` 也不在全局角色内,而 `seed-data/app_user.json` 中供货商账号 `default_store_id` 为空串(第 5 行 `{"user_id":"U004","role":"supplier",...,"default_store_id":""}`),因此供货商调用该 action 得到的是 `where({ store_id: '' })`——一个"读取所有 store_id 为空的异常记录"的查询,而不是空结果或 403。

**攻击步骤**:以 `role: 'supplier'` 账号 token 调用 `dataService` action=`getAbnormalRecords`,params `{}`,即返回全部 `store_id === ''` 的异常台账,字段含 `description`(内部门店填报口径)、`resolution`(处理结论)、`store_name`、`supplier_name`、`abnormal_id`、`receipt_id`(第 766–778 行)。

**当前实际可利用性**:`[待确认-低]` 已核实 `createReceipt` 第 550 行 `store_id: storeId` 且第 191–195 行对非全局角色强制 `default_store_id` 非空,`seed-data/abnormal_record.json` 亦均有 `store_id`,因此当前数据下查询结果为空集。该缺口是**潜性**的:一旦出现 `store_id` 缺失的历史/手工/迁移数据(例如异常记录由其它入口补录、字段名改动、按供应商维度建的记录),全量供应商将同时读到,且本函数对 `supplier` 角色没有任何显式拦截,属"沉默的权限缺口"。

**修复建议**:在第 748 行之后对非全局角色再判一次 `auth.user.default_store_id`,为空则直接 `return { code: 0, data: [] }`(或 403),不要把这个空值下推到 `where`。

---

## P3 发现

### P3-1 `markMessageRead` 缺少 `scope_type/scope_id` 归属校验,供货商可跨租户写他人消息文档

**位置**:`cloudfunctions/dataService/index.js:691–711`(关键 698–709)

**证据**

```js
  const messageResult = await db.collection('message').doc(event.id).get()
  const message = messageResult.data
  ...
  const isGlobal = GLOBAL_ROLES.includes(auth.user.role)
  const belongsToUser = !message.recipient_user_id || message.recipient_user_id === (auth.user.user_id || auth.user._id)
  const belongsToStore = isGlobal || !message.store_id || message.store_id === auth.user.default_store_id
  if (!belongsToUser || !belongsToStore) return { code: -403, msg: '无权操作该消息' }
  ...
  await db.collection('message').doc(event.id).update({ data: { read_by: _.push(userId), read_at: db.serverDate() } })
```

**对照读路径**:`getMessages`(664–666)对供货商强制 `scope_type: 'supplier'` + `scope_id: default_supplier_id`;但 `markMessageRead` 的归属判断完全没有 `scope_type`/`scope_id` 这一维。

**攻击步骤**

1. 供货商 A 的订单被审核后,`notifySuppliersNewOrder`(331–338)写入消息:`scope_type: 'supplier'`、`scope_id: <A 的 supplier_id>`、`recipient_user_id: ''`(createMessage 203 行 `data.recipientUserId || ''`)、`store_id: ''`(204 行,未传 `storeId`)。
2. 供货商 B 拿到该消息 `_id`(可通过供应商门户已读列表、订单详情页跳转参数或 `_id` 探测),调用 action=`markMessageRead` params `{ id: <该 _id> }`。
3. `belongsToUser = !'' === true`,`belongsToStore = !'' === true` → 校验通过,供货商 B 的 `user_id` 被 `push` 进供货商 A 消息的 `read_by`,`read_at` 被改写。

**影响**:不产生数据泄露(该 action 不回传正文,`getMessages` 仍按 `scope_id` 隔离),但构成跨租户写入:`read_at` 被外部租户篡改(影响"最后已读时间"类统计)、`read_by` 数组被外部租户污染。同时该 action 构成对消息 `_id` 的存在性 oracle(code 0 vs "消息不存在")。

**修复建议**:把 `getMessages` 的完整过滤条件(含 `scope_type`/`scope_id` 与门店维度)复用为 `markMessageRead` 的 `where` 查询条件,并只对该查询命中结果做条件更新(`updated === 1` 才算通过),不再"先 doc(id) 后判空"。

---

### P3-2 `getMessages` 供货商分支在 `default_supplier_id` 为空时退化为 `scope_id: ''`

**位置**:`cloudfunctions/dataService/index.js:664–666`

**证据**

```js
if (auth.user.role === 'supplier') {
  // 供货商消息按供货商档案定向(不绑门店):只收 scope_type=supplier 且 scope_id 匹配的消息
  query = _.and([recipientCondition, { scope_type: 'supplier', scope_id: auth.user.default_supplier_id || '' }])
```

**说明**:若某供货商账号未绑定 `default_supplier_id`(数据修复失败、老账号、被停用后重建等),查询退化为 `{ scope_type: 'supplier', scope_id: '' }`,将匹配所有 `scope_id` 为空串的供应商定向消息。已 grep 全仓 `scope_type: 'supplier'` 写入点:仅本文件 337 行,且上游 308–309 行 `if (!sid) return` 保证非空,`confirmSupplierOrder:107` 写的是 `scope_type: ''`。因此当前不可利用,属潜性缺口;另外该分支对空 `default_supplier_id` 未做 403 提前退出。

**修复建议**:供货商角色在无 `default_supplier_id` 时直接返回空列表,不使用 `|| ''` 兜底下推。

---

### P3-3 `startAbnormal` / `resolveAbnormal` / `closeAbnormal` 为"读判 + 无条件写",并发双写导致通知重复

**位置**:`cloudfunctions/dataService/index.js:786–795`、`805–825`、`855–862`

**证据**

```js
const result = await db.collection('abnormal_record').doc(event.id).get()
const record = result.data
...
if (record.status !== 'processing') return { code: -1, msg: '只有处理中异常才能标记为已解决' }
const paymentDecision = ['pay_received', 'reject'].includes(event.paymentDecision) ? event.paymentDecision : ''
await db.collection('abnormal_record').doc(event.id).update({
  data: { status: 'resolved', resolution, payment_decision: paymentDecision, ... }   // 无条件写
})
await createMessage({ ... })   // 826
await createMessage({ ... })   // 840
```

**攻击步骤**:两个会话(或客户端重试)并发调用 `resolveAbnormal` 同一 `id`。双方均在 805 行读到 `status === 'processing'`,双方均通过 811 行闸门,双方各自写入并把 `resolution`/`payment_decision` 后写覆盖前写,且各自发送 2 条 `createMessage`(826、840),共产生 4 条"异常已解决 / 待补结算"通知,`resolution` 与 `payment_decision` 最终值为未定义先后次序中的后者。

**对比**:同一文件 `auditOrder` 用了事务内复查(549–559),`settleReceipt` 用了 `settle_lock` 条件更新抢占(948–956),而异常域三件套完全没有等价保护——同一文件内的防护水位不一致。

**修复建议**:改为条件更新 `where({ _id: record._id, status: 'processing' }).update(...)` 并判 `stats.updated === 1`,未命中直接返回"该异常状态已变化",通知只在命中分支发送。

---

### P3-4 `auditOrder` 审批数量上界校验在 `order_qty` 非数字时被静默绕过

**位置**:`cloudfunctions/dataService/index.js:543`

**证据**

```js
const sourceItem = item && item.itemId ? itemResult.data.find(source => source.item_id === item.itemId) : null
// qty <= 0 拒绝:0 通过会把该行静默改成 0 量,审批数量必须为正数
if (!item || !validIds.has(item.itemId) || !Number.isFinite(qty) || qty <= 0 || qty > Number(sourceItem && sourceItem.order_qty)) {
  return { code: -1, msg: '审批数量必须大于 0 且不超过下单数量,请检查后重试' }
}
```

**说明**:当 `sourceItem.order_qty` 为 `undefined` 或非数字字符串时,`Number(...)` 为 `NaN`,`qty > NaN` 恒为 `false`,上界校验被短路跳过,审批方可写入任意正数(无上限,注意此处也不再有 `createPurchaseOrder` 的 `qty > 1000000` 兜底,因为该兜底只存在于建单侧 287–290 行)。已核实 `createPurchaseOrder:287–290` 强制 `Number.isFinite(qty) && qty > 0 && qty <= 1000000`,故当前无客户端可造的脏数据,属潜性缺口;`null`/`""` 情形会退化为 0 而被正确拒绝,仅 `undefined`/非数字字符串会绕过。

**修复建议**:把上界提取为 `const maxQty = Number(sourceItem && sourceItem.order_qty)` 并显式判 `!Number.isFinite(maxQty) || qty > maxQty` 时拒绝。

---

### P3-5 `saveSupplier` 同名唯一性为"先查后写",无唯一索引兜底;且扫描上限 100

**位置**:`cloudfunctions/dataService/index.js:162–168`

**证据**

```js
const duplicateSupplierRes = await db.collection('supplier')
  .where({ supplier_name: supplierName })
  .limit(100)
  .get()
if (duplicateSupplierRes.data.some(item => item.supplier_id !== event.supplierId)) {
  return { code: -1, msg: '该供应商名称已存在' }
}
```

**说明**:check-then-act 无事务无唯一索引,两个管理端并发新建同名供应商可双写成功,后续 `notifySuppliersNewOrder`(317–322)按 `supplier_id` 取名的 `nameById` 会取到随机一条,导致订货单/消息正文中的供应商名称错配。此外 `.limit(100)` 意味着同名记录超过 100 条时校验可能漏判(极低概率,但属同一类缺陷)。

**修复建议**:为 `supplier_name` 建唯一索引(或在事务内用 `_.neq` 条件插入);至少把查重与写入包进同一事务并复查。

---

### P3-6 全部问责字段只记 `auth.user.name`,可伪造、可重名、改名后不可追溯

**位置**:`cloudfunctions/dataService/index.js:579`(`audited_by`)、`793`(`handled_by`)、`821`(`resolved_by`)、`866`(`closed_by`)

**证据**

```js
await transaction.collection('purchase_order').doc(order._id).update({
  data: { order_status: event.status, audit_remark: ..., audited_by: auth.user.name, audited_at: db.serverDate(), ... }
})
```

**说明**:`app_user.name` 是可变、非唯一的展示名(`seed-data/app_user.json` 中亦无唯一性约束)。审计链因此可被"改名"事后抹平,且重名账号无法区分;这与 P2-1 的 SoD 缺口叠加后,付款裁决与审核记录都不具备抗抵赖性。作为对照,`verifyManualOrder` 第 1701 行用的是 `verified_by: auth.user.user_id || auth.user._id`,同一文件内两种口径并存。

**修复建议**:所有 `*_by` 字段落 `user_id`(或 `_id`),展示名另存 `*_by_name` 快照。

---

### P3-7 `regenerateApprovedOrderReports` 报表重算非原子,`report_id` 固定字符串,失败重试产生重复报表文档

**位置**:`cloudfunctions/dataService/index.js:432–455`、`488–496`(调用点 621–628)

**证据**

```js
await db.collection('report_file').where({ source_order_id: orderNo, report_type: _.in([...]) })
  .update({ data: { status: 'superseded', updated_at: db.serverDate() } })
...
await db.collection('report_file').add({
  data: { report_id: 'RPT_SO_' + orderNo + '_A', report_type: 'store_order_report', ..., status: 'generated' }
})
```

**说明**:先批量 `superseded` 再逐份 `add`,`report_id` 为确定性拼接字符串(非唯一性生成),且整段在事务外(623 行 `await regenerateApprovedOrderReports` 在 549–588 事务之后)。若"已作废旧版 → 上传 CSV → add"中间任一步失败,重试该审核(或管理员手动补生成)会得到同一 `report_id` 的两份 `report_file`,下游 `getReports` / 报表列表按 `report_id` 去重口径不明时会双计。`getNextVersion`(368–394)已用 CAS 处理版本号,但文档唯一性未处理。

**修复建议**:`report_file.report_id` 建唯一索引;重算前用 `where({ report_id }).count()` 或条件插入保证幂等。

---

### P3-8 多处客户端字符串写入无长度上限,可造成存储放大

**位置**:`cloudfunctions/dataService/index.js:120–122`(`spec`/`manufacturerName`)、`158–159`(`contactPhone`/`remark`)、`578`(`auditRemark`)、`802`(`resolution`)、`197–203`(`createMessage` 的 `title`/`content`/`bizId`)

**证据**

```js
const resolution = String(event.resolution || '').trim()
if (!resolution) return { code: -1, msg: '请填写处理结果' }
...
  await db.collection('abnormal_record').doc(event.id).update({
    data: { status: 'resolved', resolution, ... }   // 无长度上限
  })
```

**说明**:仅校验非空,不校验长度。`store_manager` 可把数百 KB 文本写入 `abnormal_record.resolution`,并经 828–831 行进一步落进 `message.content`;商品/供应商的 `remark`、`spec`、`auditRemark` 同理。危害为存储成本与后续 `getAbnormalRecords`(753–757,`.limit(100)` 全字段返回)的响应体积放大,非直接数据泄露(该集合无成本价等敏感字段)。

**修复建议**:对每个可写字段设明确上限(如 `resolution`/`remark` ≤ 2000 字符)并在校验处统一拒绝。

---

### P3-9 `auditOrder` 驳回分支对 `event.items` 只做 approved 校验,非数组直接抛 TypeError

**位置**:`cloudfunctions/dataService/index.js:529–534`

**证据**

```js
if (event.status === 'approved' && event.items !== undefined && !Array.isArray(event.items)) {
  return { code: -1, msg: '审核明细格式无效' }
}
;(event.items || []).forEach(item => {
  if (item && item.itemId) qtyMap[item.itemId] = Number(item.approveQty)
})
```

**说明**:`status === 'rejected'` 时跳过 529 行校验,`event.items` 若为对象或字符串,532 行 `.forEach` 不存在即抛 `TypeError`,由 `exports.main`(1740–1742)兜底成通用错误"CloudBase 数据操作失败"。影响为错误信息被吞、驳回请求静默失败(需重发),属健壮性问题而非权限问题。

**修复建议**:把 `Array.isArray(event.items)` 校验提到分支外,统一拒绝非数组。

---

## 已通读但无发现(明确排除)

- **敏感字段泄漏**:本段返回路径仅 `publicMessage`(640–651,白名单 8 字段)、`getAbnormalRecords`(766–778,无 `price_snapshot`/`cost` 类字段)、`getCategories`(79–85)、`saveProduct`/`saveSupplier`/`toggleProduct`/`toggleSupplier`(仅回 `id`/`status`)、`auditOrder`(仅回 `reportWarning`)、`getOrderStats`(仅回 4 个计数)。`app_user.password_hash` / `password_salt`(seed 第 1 行存在该字段)在本段无任何读取路径。
- **客户端伪造身份**:本段所有 `role`/`userId`/`storeId` 判断均取自 `auth.user`(getSessionUser 解析),未出现 `event.role` / `event.isAdmin` / `event.userId` 参与授权;已逐行核对 14 个 action 全部调用 `requireUser`,无裸奔 action。
- **越权建 admin / 改角色 / 删门店 / 分配他店**:本文件不含用户与门店管理 action(分发表 1715–1737 无 `saveUser`/`saveStore` 等),该面由 `authService` 承担,不在本段。
- **自单自审绕过**:511–516 行校验已覆盖 `created_by` 存 `user_id` 或 `_id` 两种口径(数组 `[order.created_by, auth.user._id].includes(auditorId)`,而 `auditorId = user_id || _id`);seed 数据 `created_by` 为 `U001` 形式,与 `createPurchaseOrder:347–349` 写入口径一致。
- **状态机绕过(审核域)**:`auditOrder` 双重状态闸门(517 事务外 + 556 事务内)+ 事务提交后复查(592–599),`rejected` 必须填原因(520),审批数量必须为正且不超下单量(543)。异常域状态机 `pending→processing→resolved→closed` 单向(791/811/861),无回退入口。
- **where 注入**:`event.status`(752)、`event.storeId`(888)、`event.orderId`(506)、`event.id`(695/786 等)均为标量下推,未做字符串拼接;`findCategory` 用 `Number(categoryId)`(92)天然过滤对象/数组入参。
- **分页 DoS**:`getMessages`(682,limit 100)、`getAbnormalRecords`(756,limit 100)、`getCategories`(67,limit 100)、`getOrderStats`(896–902,`count()` 聚合)均有界;`purchase_order_item` 查询 `limit 1000`(526)配合建单侧"每单最多 100 种"(createPurchaseOrder:266)不成风险。
- **会话机制**:`getSessionUser`(24–50)按 `token_hash`(SHA256)+ `status: 1` + 会话过期三重过滤,兼容旧单会话字段;token 由 `authService:210` `crypto.randomBytes(32)` 生成,256 bit 熵,加盐与否不影响抗猜测性。
- **供货商订阅消息越权**:`sendSubscribeMessage`(276–300)仅由 `notifySuppliersNewOrder` 内部调用,`user.openid` 取自服务端查询 `getSupplierUsers`(261–273),不接受客户端 openid;`SUBSCRIBE_TEMPLATE_ID = ''`(251)时全量空转。
- **`message.read` 全局已读被他人翻转**:`markMessageRead` 写的是 `read_by` 数组 + `read_at`(706–708),不改 `read` 布尔;`getMessages`(686)按 `read || readBy.includes(userId)` 计算,因此他人无法通过已读操作翻转自己的未读状态。

---

## 未覆盖 / 存疑

1. **P2-1 的严重度取决于业务口径**:`store_manager` 是否被授权做付款裁决,是业务设计问题。本审计按"付款放行须管理员签核"判定为 P2;若业务方拍板店长可裁决,则该条降级为"需在文档中明示"的观察项。请业务方确认。
2. **P2-2 / P3-2 的实际可利用性需生产数据确认**:已核实当前写入方均保证 `store_id`/`scope_id` 非空,故当前应为空集;但若生产库存在历史迁移数据、`store_id` 缺失的异常记录,或 `scope_id: ''` 的供应商消息,两条即为真实越权读取。建议在生产库执行一次 `db.collection('abnormal_record').where({ store_id: _.or([_.exists(false), '']) }).count()` 与 `db.collection('message').where({ scope_type: 'supplier', scope_id: '' }).count()` 核实。
3. **A3 边界交叉**:
   - `getOrderStats` 函数体 875–913,尾部 900–913 落在 A3 段;其中 887–888 行"管理员可传任意 `event.storeId` 下推计数"(仅计数、无字段投影,当前无泄漏面)已由本段复核,若 A3 在 `verify_status: 'pending'` 分支发现异常请合并结论。
   - `settleReceipt`(918 起,A3)是 P2-1 影响链的落点,本段仅引用其第 962/974–978 行以判定影响,未审计该 action 自身的权限与并发逻辑。
   - `regenerateOrderReports`(分发表 1732,A3)与本段 P3-7 同族(报表重算非原子 + 确定性 `report_id`),建议 A3 一并核。
4. **`purchaser` 角色全局化的设计含义**:`seed-data/app_user.json` 第 4 行采购员 `default_store_id: ""`,且 `GLOBAL_ROLES`/`MANAGEMENT_ROLES` 均含 `purchaser`,即"采购员"在本系统等同全局管理员(可跨店审核、可跨店读全部异常台账、可停用任意供应商)。若业务预期采购员应按店分工,则该角色定义本身即为越权面,需业务方确认。
5. **`authService` 的会话写入侧未审计**:本段仅审计会话消费侧。若 `authService` 的 `saveUser`/`setUserRole` 存在越权(普通员工改自身角色为 `purchaser`),则本段所有基于 `auth.user.role` 的防护全部失效。建议横向扫描确认。
6. **`resolveActiveRecipient`(231–246)与 `getStoreManagerId`(216–227)的收件人回退逻辑**:目标用户查不到时回退本店店长、再回退 `''`(门店广播)。回退到 `''` 意味着消息变门店广播;若某门店无店长,定向给具体经办人的敏感消息(如改量通知)将广播给全店,含厨师/下厨人员。属信息面扩大而非越权,标 `[待确认]`,需要业务方确认门店无店长时的期望行为。
