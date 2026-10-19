# 报表域安全复审（A6）—— 生成 / 列表 / 详情 / 文件链接 + 报表页面

- 审计时间：2026-10-18
- 范围：`generateSummaryReport` / `getReports` / `getReportDetail` / `getReportFileUrl` 四个云函数 + `pages/report-list`、`pages/report-detail`、`pages/report-history` 三组页面 + `seed-data/report_file.json` + `utils/cloud.js`、`utils/meta.js`
- 基线：以工作区未提交内容为准（`getReports`、`getReportDetail`、`getReportFileUrl` 均有未提交改动，已按当前文件内容审计）

---

## 结论摘要

B 系列整改后，报表链路的**核心授权已收敛**：`getReports` / `getReportDetail` / `getReportFileUrl` 三者都按 `user.role + report_scope + scope_id === user.default_store_id` 做了服务端强制裁剪，客户端传入的 `role / storeId / scope_id / reportType` 不能扩权；`file_url` 已从列表与详情响应中剥离，下载统一走 `getReportFileUrl` 二次鉴权。**未发现可被证明的跨门店 / 跨角色 IDOR**。

本轮发现集中在 **金额口径污染、审计一致性、DoS、以及几处潜伏缺守（guard 缺失 / status 不生效）**，最高严重度 P2。

| # | 严重度 | 标题 | 位置 |
|---|--------|------|------|
| 1 | P2 | 日/月汇总金额口径污染：取消单与不可付款行仍计入金额 | generateSummaryReport/index.js:192-223 |
| 2 | P2 | 详情页行数据实时重算，与下载文件快照不一致，作废单仍可展开 | getReportDetail/index.js:80-160 |
| 3 | P2 | 汇总生成无幂等/无节流/无日期上界，可单账号耗尽 DB 与存储配额 | generateSummaryReport/index.js:173-245 |
| 4 | P2(潜伏) | `store_receipt_report` 分支缺 `orderId` 空值守卫，`where({})` 可命中任意门店收货单 | getReportDetail/index.js:98-104 |
| 5 | P3 | `status: 'superseded'` 不作废：列表、详情、下载链接全部照常放行 | getReports/index.js:90-104；getReportFileUrl/index.js:51-59 |
| 6 | P3 | `getReportFileUrl` 未校验 `user.default_store_id` 存在性，与 `getReports` 口径不一致 | getReportFileUrl/index.js:53-58 |
| 7 | P3 | 无守卫的 `file_url` 精确匹配入参 + `file_name` 全路径外泄，构成 fileID 重建原料 | getReportFileUrl/index.js:48-50；getReports/index.js:100-103 |
| 8 | P3 | 详情页对「无价格」收货报表仍下发 `unitPrice` / `subtotal` | getReportDetail/index.js:110-127 |
| 9 | P3 | 明细查询多处硬 `limit`，无 orderBy，量级超限后静默漏数导致金额对不平 | getReportDetail/index.js:88,102,137,168 |
| 10 | P3 | `utils/cloud.js` 保留未受保护的 `getFileUrl(fileID)` 万能换链原语 | utils/cloud.js:244-269 |
| 11 | P3 | 月汇总上界用 `-31` 字符串比较，2 月/4 月/6 月等月份口径依赖字典序巧合成立 | generateSummaryReport/index.js:94 |
| 12 | P3 | 客户端传入 `storeId` / `role` 在 `getReports` 中完全被忽略（死参数，易误读为已生效） | getReports/index.js:43,61-66 |

---

## 详细发现

### 1. P2 —— 日/月汇总金额口径污染：取消单与不可付款行仍计入金额

**位置**：`cloudfunctions/generateSummaryReport/index.js:89-95`、`:192-223`、`:262`

**攻击/破坏步骤**
1. 门店对某订单收货，产生 `receipt`（`receipt_status: 'abnormal'`，其中部分行 `payable_flag: false`，例如少货/质量问题）。
2. 采购端审核通过订单后发起取消（`dataService` 允许 `partial_received / received / receipt_abnormal` 状态的订单被改为 `cancelled`，见 `dataService/index.js:1393-1402`）——收货单与明细行不会被回滚。
3. 采购员/店长调用 `generateSummaryReport({ period:'daily', date, storeId })`。
4. `getStoreReceipts` 仅按 `store_id + receipt_date` 取单，不过滤任何状态；聚合循环只跳过 `is_manual`，仍把 `payable_flag === false` 行和已取消订单的收货行计入 `amount`，并把结果写进 `report_file.total_amount`。
5. 得到的「日/月汇总」金额高于实际应付金额，且被固化为历史报表元数据，后续对账、补结算均以它为基准。

**证据**

```js
// :90-95  只按门店+日期取单，无状态过滤
const baseWhere = { store_id: storeId }
if (period === 'daily') { baseWhere.receipt_date = date }
else { baseWhere.receipt_date = _.gte(`${date.slice(0,7)}-01`).and(_.lte(`${date.slice(0,7)}-31`)) }

// :200-222  聚合：只跳过 is_manual，payable_flag / receipt_status 均未参与判断
items.forEach(item => {
  if (item.is_manual) return
  ...
  const subtotal = Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100
  agg.amount = Math.round((agg.amount + subtotal) * 100) / 100
})
```

对比：`dataService/index.js:1255-1262` 生成「带价格」报表时明确只纳入 `payable_flag !== false` 行；`getReportDetail` 前端合计同样 `rows.filter(r => r.payable !== false && !r.isManual)`（`report-detail.js:56`）。唯独汇总报表口径最宽。

**修复建议**：`getStoreReceipts` 增加 `receipt_status` / 关联订单 `order_status !== 'cancelled'` 过滤；聚合循环增加 `if (item.payable_flag === false) return`，与带价格报表及前端合计口径对齐。

---

### 2. P2 —— 详情页行数据实时重算，与下载文件快照不一致；作废报表仍可展开

**位置**：`cloudfunctions/getReportDetail/index.js:80-160`

**破坏步骤**
1. 收货提交时生成 `RPT_SR_xxx` v1，CSV 快照写入云存储。
2. 门店后续「补结算 / 重新生成」或订单被审核重发，`dataService/index.js:432-434` 将旧报表标为 `status: 'superseded'`，但 `receipt_item` / `purchase_order_item` 的数值可能已被修订。
3. 采购员打开 v1 详情页：行数据由 `purchase_order_item` / `receipt_item` **实时**重建，拿到的是**修订后**的数量与单价。
4. 同一页点「导出报表文件」，下载到的 CSV 是 v1 的**快照**。页面合计与文件合计对不上；列表页标记「已作废」的报表内容仍可完整展开与下载。

**证据**

```js
// :84-89  行数据从当前数据库重建，而不是解析已固化的 CSV
const orderId = report.source_order_id
if (type === 'store_order_report' && orderId) {
  const itemsRes = await db.collection('purchase_order_item')
    .where({ purchase_order_id: orderId }).limit(1000).get()
  rows = itemsRes.data.map(...)
}
```

对比：汇总报表类型（`:203-253`）**正确**地从已下载 CSV 解析行数据，说明代码库内已有正确范式。

**修复建议**：非汇总类型改为优先解析 `file_url` 快照（复用汇总类型的解析路径），仅在无文件时降级实时重建；同时在 `getReportDetail` / `getReportFileUrl` 对 `status === 'superseded'` 返回明确的「该版本已作废」或仅返回元数据。

---

### 3. P2 —— 汇总生成无幂等、无节流、无日期上界：单账号可耗尽 DB / 存储配额

**位置**：`cloudfunctions/generateSummaryReport/index.js:173-245`

**攻击步骤**
1. 任意持有 `store_manager` / `purchaser` / `super_admin` 角色的账号（店长即可）。
2. 循环调用 `generateSummaryReport({ period:'monthly', date:'2024-01-01', storeId })`，`isDate` 只校验格式，**无历史/未来上界**。
3. 每次调用 = 1 次 `count` + `⌈receipt/100⌉` 次分页取单 + 每个 20 单分块 ×`⌈item/100⌉` 次取明细 + 商品/供应商映射查询 + 1 次云存储上传 + 1 条 `report_file` 写入 + 1 次 `report_version_counter` 条件更新。
4. `getNextVersion`（`:53-79`）每次调用都递增版本号并上传新文件，**没有任何"同门店同日已存在"的拦截**——不存在去重。
5. 结果：`report_file` 无限膨胀、云存储配额耗尽、集合被低价值 CSV 淹没，正常报表被冲淡；月汇总在繁忙门店可产生数百次数据库读。

**证据**

```js
// :176  仅校验格式，无时间上界
if (!isDate(date)) return { code: -1, msg: '日期格式无效，应为 YYYY-MM-DD' }
// :238-245  每次调用都取新版本号并上传新文件，无重复生成拦截
const version = await getNextVersion(reportType, storeId, relatedDate)
const fileName = `reports/summary/${period}/${storeId}/${pathDate}-summary-v${version}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.csv`
const uploadRes = await cloud.uploadFile({ cloudPath: fileName, fileContent: ... })
```

**修复建议**：① 限制 `date <= 今日` 且限制历史回溯窗口（如 13 个月）；② 对同一 `reportType+storeId+relatedDate` 加短 TTL 幂等锁（复用 `report_version_counter`）；③ 对单账号加调用频率上限。

---

### 4. P2（潜伏）—— `store_receipt_report` 分支缺 `orderId` 空值守卫

**位置**：`cloudfunctions/getReportDetail/index.js:98-104`

**攻击步骤**
1. 存在一条 `report_type === 'store_receipt_report'` 且 `source_order_id` 缺失/为空串的 `report_file` 记录（当前两个写入点 `createReceipt/index.js:624-626`、`dataService/index.js:1241-1243` 都会写入该字段，故**当前不可由客户端构造**）。
2. `const orderId = report.source_order_id` 为 falsy，进入该分支时执行 `db.collection('receipt').where({ purchase_order_id: undefined })`。
3. `wx-server-sdk` 对 `undefined` 字段序列化的行为不可依赖：若被剔除则等价 `where({})` → `limit(1)` 命中**任意门店**的某张收货单，随后取回其全部 `receipt_item`（含 `price_snapshot`、`received_qty`），返回给 `scope_id === user.default_store_id` 的店长——即**跨门店数据泄漏**。
4. `store_order_report` 分支有 `&& orderId` 守卫（`:84`），收货分支没有，属于守卫不一致。

**证据**

```js
// :84  下单报表分支：有守卫
if (type === 'store_order_report' && orderId) {
// :98  收货报表分支：无守卫
} else if (type === 'store_receipt_report' || type === 'store_receipt_price_report') {
  const receiptRes = await db.collection('receipt')
    .where({ purchase_order_id: orderId })   // orderId 可能为 undefined
    .limit(1).get()
```

**[待确认]**：需要确认两点才能定级——① `wx-server-sdk` 对 `where({x: undefined})` 是抛错还是剔除字段；② 线上是否存在 `source_order_id` 为空的收货报表记录（含历史导入数据，`seed-data/report_file.json` 中该字段齐全）。若确认可剔除且存在脏数据，则升级为 P0/P1 跨门店 IDOR。

**修复建议**：在收货/汇总两个分支入口统一加 `if (!orderId) return { code: -1, msg: '报表缺少来源单据' }`；或在校验区对 report 记录做一次完整性校验。

---

### 5. P3 —— `status: 'superseded'` 不作废：列表、详情、下载链接全部放行

**位置**：`cloudfunctions/getReports/index.js:90-104`、`getReportFileUrl/index.js:51-59`、`getReportDetail/index.js:61-69`

**证据**

```js
// getReports：query 从未包含 status 条件，作废报表照常列出（前端只是多打一个「已作废」tag）
const countRes = await db.collection('report_file').where(query).count()
// getReportFileUrl：拿到记录后只做角色/门店校验，不校验 status
if (!reportRes.data.length || !reportRes.data[0].file_url) return { code: -1, msg: '报表文件不存在' }
const report = reportRes.data[0]
if (!['super_admin', 'purchaser'].includes(user.role)) { ... }
```

**说明**：`dataService/index.js:432-434` 与 `:447-453` 明确用 `status: 'superseded'` 标记旧版本，但读取侧三处均不消费该字段，作废标记仅是 UI 装饰。业务语义上"作废"应意味着不可再作为依据下载；至少应与发现 #2 一并处理。

**修复建议**：读取侧统一加 `status: _.neq('superseded')` 过滤（或在详情/下载时对 superseded 返回专用文案与仅元数据）。

---

### 6. P3 —— `getReportFileUrl` 未校验 `user.default_store_id`，与 `getReports` 口径不一致

**位置**：`cloudfunctions/getReportFileUrl/index.js:53-58`

**证据**

```js
if (!['super_admin', 'purchaser'].includes(user.role)) {
  if (!['chef', 'store_manager'].includes(user.role)
      || report.report_scope !== 'store'
      || report.scope_id !== user.default_store_id) {          // default_store_id 未先判空
    return { code: -403, msg: '无权下载该报表文件' }
  }
```

`getReports` 两处均有 `if (!user.default_store_id) return { code: -403, ... }`（`:54`、`:59`），下载侧漏了。当 `user.default_store_id` 为 `undefined` 且报表 `scope_id` 同样为 `undefined` 时，`undefined !== undefined` 为 `false`，校验通过。当前所有 `report_file` 写入点都设置了 `scope_id`，故不可触发，属潜伏不一致。

**修复建议**：在 `getReportFileUrl` 与 `getReportDetail` 的非全局分支开头补 `if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }`，并把该判断收敛成一个 `canAccessReport(user, report)` 共用函数，三处复用。

---

### 7. P3 —— `file_url` 精确匹配入参 + `file_name` 全路径外泄，构成 fileID 重建原料

**位置**：`cloudfunctions/getReportFileUrl/index.js:43-51`、`cloudfunctions/getReports/index.js:100-103`

**证据**

```js
// :43-50  fileId 入参走 file_url 精确匹配
const { reportId, fileId } = event || {}
const reportRes = reportId
  ? await db.collection('report_file').where({ report_id: reportId }).limit(1).get()
  : await db.collection('report_file').where({ file_url: fileId }).limit(1).get()

// getReports:100-103  剥离 file_url，但 file_name（完整对象键）仍外泄
const { file_url, ...rest } = item
return { ...rest, has_file: !!file_url }
```

**说明**：`fileId` 路径本身仍会落回同一套角色/门店校验（`:53-58`），**不构成鉴权绕过**。风险在于：`file_name`（如 `reports/summary/daily/S001/2026-10-18-summary-v3-xxxx.csv`）是完整对象键，而 CloudBase fileID 是 `cloud://<env>/<对象键>` 结构；配合 CloudBase 的 `envId`（小程序端固定可见），fileID 可被离线重建，再配合发现 #10 的客户端万能换链原语即可换链。

**[待确认]**：需确认线上 `report_file.file_url` 中的 bucket 段是否等于 `envId`，以及 `wx.cloud.getTempFileURL` 是否接受 `cloud://<envId>/<file_name>` 形式的拼接 ID。若成立，则 #7+#10 组合可升级为 P1（客户端持任意报表全路径即可换链下载，仅受 #6 的门店校验约束）。

**修复建议**：移除 `getReportFileUrl` 的 `fileId` 兼容入参（或记录 deprecation 后按调用量下线）；`file_name` 如需返回，改为不含可拼接路径的对象键哈希，或仅在管理员视图返回。

---

### 8. P3 —— 详情页对「无价格」收货报表仍下发 `unitPrice` / `subtotal`

**位置**：`cloudfunctions/getReportDetail/index.js:110-127`

**证据**

```js
} else if (type === 'store_receipt_report' || type === 'store_receipt_price_report') {
  ...
  return {
    productName: item.product_name,
    orderQty: item.order_qty_snapshot,
    receivedQty: item.received_qty,
    unit: item.unit_snapshot,
    unitPrice: item.price_snapshot,      // 两个类型一视同仁
    subtotal: Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100,
```

而 `dataService/index.js:1235` 生成的「门店收货报表」CSV 明确**不含**单价/金额列（只有数量、单位、异常状态、备注、是否付款），前端 `report-detail.wxml:46-60` 对 `store_receipt_report` 也只渲染数量列。服务端多下发了一层数据。

**说明**：可读该类型的角色（店长）本身也能读 `store_receipt_price_report`，因此**不是跨边界泄漏**，属 API/文件口径不一致的防御纵深问题；若未来对厨师放开收货报表，此处会直接变成价格泄漏。

**修复建议**：按 `type === 'store_receipt_price_report'` 条件性下发 `unitPrice` / `subtotal` / `payable`。

---

### 9. P3 —— 明细查询多处硬 `limit` 且无 `orderBy`，量级超限后静默漏数

**位置**：`cloudfunctions/getReportDetail/index.js:88,102,137,168`

**证据**

```js
.where({ purchase_order_id: orderId }).limit(1000).get()        // :88  无 orderBy
.where({ purchase_order_id: orderId }).limit(1).get()           // :102 多批次收货只取首张
.where({ order_date: date }).limit(200).get()                   // :137 全店当日订单只取 200
.where({ receipt_date: date }).limit(200).get()                 // :168 全店当日收货单只取 200
```

**说明**：`:137` 的 200 单上限还会**连带丢弃**后续分块的明细行（`:140` 的 `orderMap` 缺失则 `if (!order) return` 直接跳过），且行数据是实时重建、没有"截断"标记。`getSupplierOrders/index.js:72-85` 已用 `orderBy('_id','asc') + 循环分页` 修掉同类问题，报表详情侧未同步。

**修复建议**：改为分页取全量（参照 `getSupplierOrders` 的写法）并对超限返回显式告警；`:102` 改为按 `purchase_order_id` 取全部收货单并按批次合并。

---

### 10. P3 —— `utils/cloud.js` 保留未受保护的 `getFileUrl(fileID)` 万能换链原语

**位置**：`utils/cloud.js:244-269`

**证据**

```js
async function getFileUrl(fileID) {
  if (!wx.cloud || !fileID) return null
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })   // 任意 fileID，无归属校验
    return res.fileList[0].tempFileURL
  } catch (err) { ... }
}
```

`getReports/index.js:98-99` 的注释明确写道"防止客户端从列表拿到 fileID 后绕过鉴权直调 `wx.cloud.getTempFileURL`"，但同仓库里这个原语一直存在并导出。当前仅 `receive-list.js:99`、`purchase-detail.js:121` 使用（收货照片、凭证图，均经各自云函数鉴权后拿到 ID），**未被报表链路调用**。

**修复建议**：删除该导出或收敛为"仅允许 `receipts/`、`vouchers/` 前缀"，从结构上消除绕过路径；`getReports` 的剥离注释也应指向该约束而非仅靠"没人用"。

---

### 11. P3 —— 月汇总上界 `-31` 依赖字典序巧合

**位置**：`cloudfunctions/generateSummaryReport/index.js:94`

**证据**

```js
baseWhere.receipt_date = _.gte(`${date.slice(0, 7)}-01`).and(_.lte(`${date.slice(0, 7)}-31`))
```

`2026-02-31` 不是合法日期，但因 `receipt_date` 存的是字符串，字典序下 `"2026-02-31" > "2026-02-28"` 仍成立，功能上没漏。问题是口径脆弱：一旦 `receipt_date` 改为 Date 类型或存在补零差异即静默错位。建议改成 `lte(`${month}-28`)` 之外的稳妥写法（`gte(firstDay).and(lte(lastDayOfRealMonth))` 或用 `_.lt(nextMonthFirstDay)`）。

---

### 12. P3 —— 客户端 `storeId` / `role` 在 `getReports` 中完全失效（死参数）

**位置**：`cloudfunctions/getReports/index.js:43,61-66`

```js
const { role, storeId, reportScope, reportType, relatedDate } = event || {}
...
} else if (user.role === 'purchaser' || user.role === 'super_admin') {
  if (reportScope) query.report_scope = reportScope   // storeId 从未被使用
```

`pages/report-list/report-list.js:73-80` 与 `pages/report-history/report-history.js:60-68` 都在传 `storeId`，服务端始终忽略。行为正确（服务端按 `user.role` 判定，不信任客户端），但死参数容易被后续维护者误读为"已按门店过滤"，从而在别处效仿。建议直接删除该字段并移除前端传参，或改为对全局角色提供真正的门店收窄（若业务需要）。

---

## 已核查但确认无问题的点

- **报表文件越权下载 IDOR（重点项 1）**：未复现。`getReportFileUrl` 三处校验完整（角色白名单 → scope/store 绑定 → chef 类型限制），`reportId` 可枚举但枚举结果仍被同一套校验约束。
- **fileID 可枚举绕过归属（重点项 2）**：`fileId` 入参走 `file_url` 精确匹配后**仍回落到同一鉴权**，不构成绕过；风险仅在 #7 的 fileID 重建组合场景，已单列。
- **跨门店报表泄漏（重点项 3）**：`getReports` 对 chef/store_manager 强制 `scope_id = user.default_store_id`，且在客户端过滤后（`:79-86`）二次重设，无法用 `reportScope`/`reportType` 扩权。
- **供应商读内部汇总（重点项 4）**：不存在。三个报表云函数对 `role === 'supplier'` 一律返回 403，供应商门户（`getSupplierOrders`）自带 `default_supplier_id` 绑定，未暴露任何 `report_file` 记录。供应商账单报表（含价格）仅 `purchaser`/`super_admin` 可见。
- **生成报表越权（重点项 5）**：`generateSummaryReport:170-172` 服务端强制三角色白名单，`:180-184` 店长强制限定本店，前端 `report-list.js:127-131` 的拦截只是冗余而非唯一防线。
- **报表元数据注入（重点项 8）**：`report_file` 的全部写入点均为云函数（`generateSummaryReport`、`createReceipt`、`createPurchaseOrder`、`dataService`），无客户端写入路径，`title/scope_id/supplierId` 等字段不可被客户端影响。
- **报表内容含敏感字段（重点项 9）**：汇总 CSV 仅含商品/供应商/分类/单位/数量/金额，无手机号、无内部备注；供应商账单 CSV 不含门店侧经办人手机号。
- **CSV 公式注入**：`generateSummaryReport:41-46` 对 `= + - @` 开头的值统一加 `'` 前缀，且所有字段经 `csvField` 包裹；`dataService` 侧同款实现一致。
- **仅前端隐藏（重点项 11）**：`report-list.js` 的"仅管理员可生成"提示之外，云函数有独立校验。
- **分页/limit（重点项 12）**：`getReports:88-89` 对 `page`（上限 1000）与 `pageSize`（上限 50）均做了夹紧，`skip` 上限约 49,950，无 offset 放大。
- **文件 URL 过期（重点项 10）**：`getReportFileUrl` 每次实时换取临时链接，不缓存长时效 URL。

---

## 已通读但无发现的文件

- `pages/report-list/report-list.wxml`（163 行 js + wxml）：仅渲染与筛选，权限提示逻辑与云函数口径一致
- `pages/report-history/report-history.wxml` / `report-history.js`：筛选参数传递方式与 `report-list` 相同，无越权面
- `pages/report-list/report-list.wxss`（127 行）、`report-detail.wxss`（118 行）、`report-history.wxss`（27 行）、三个 `.json`：样式与页面配置
- `utils/meta.js`：纯标签/图标映射，无数据访问
- `seed-data/report_file.json`：字段齐全（`scope_id` / `source_order_id` 均有值），未提供可绕过场景
- `utils/cloud.js`：`callFunction` 统一附加 `authToken`，`normalizeReport` 会带出 `fileUrl` 字段但服务端已不下发，故取到空串

## 未覆盖 / 存疑

1. **`wx-server-sdk` 对 `where({x: undefined})` 的行为**（影响 #4 定级）——需实际调用验证或查 SDK 文档。
2. **`wx.cloud.getTempFileURL` 是否接受 `cloud://<envId>/<file_name>` 拼接 ID**（影响 #7 定级）——需在云开发控制台用 `envId` + `file_name` 实测。
3. **`report_file` 的历史导入数据是否可能存在 `scope_id` / `source_order_id` 为空**——需 SQL 级核查线上集合，直接决定 #4 是否升级为 P0/P1。
4. **`purchaser` 角色是否应受门店集合约束**：三个读取函数与 `generateSummaryReport` 均把 `purchaser` 视为全门店全局。若采购账号实际按事业部/分公司委派，则属过度授权（P1 级设计问题），需业务确认角色模型。
5. **`receipt.receipt_status` 与订单 `cancelled` 的联动清理责任**在 `dataService`（A2/A3 范围），本报告仅指出报表侧未做防御；若该侧已保证取消不回滚明细，则 #1 需相应调整描述。
6. **`createPurchaseOrder` / `createReceipt` 生成的供应商账单报表**是否含门店侧成本或异常率、以及供应商是否可通过其它入口获取，属 A5/A7 范围，本报告仅确认报表三读入口对 `supplier` 角色封闭。
7. 云存储目录 `reports/summary/${period}/${storeId}/...`（`generateSummaryReport:241`）的 `storeId` 未做路径字符消毒，虽已由 `store.store_id` 存在性校验兜底，但 `store_id` 的取值约束不在本域，建议 A2 确认建店接口对 `store_id` 的字符集限制。
