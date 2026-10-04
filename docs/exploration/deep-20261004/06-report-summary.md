# 探索报告 06：报表 / 汇总统计域

- 探索代理：第 6 号（报表 / 汇总统计域）
- 日期：2026-10-04
- 分支：`backup`（只读，未改动任何源文件）
- 覆盖文件：`generateSummaryReport` / `getReportDetail` / `getReports` / `getReportFileUrl`（各含 index.js + package.json）、`pages/report-list` / `report-detail` / `report-history` / `supplier-home`（各 4 文件）、`seed-data/report_file.json`
- 交叉验证文件（用于判断口径正确性，非分配清单）：`createReceipt/index.js`、`createPurchaseOrder/index.js`、`dataService/index.js`、`utils/cloud.js`、`utils/meta.js`、`getSupplierOrders/index.js`、`app.js`、`pages/store-switch`

---

## 1. 概览

报表域是「**服务端生成 CSV 文件 + `report_file` 集合做元数据索引**」的架构，不存在 Excel/PDF/图片，全部是 UTF-8 with BOM 的 CSV：

| 报表类型 | 生成者 | 生成时机 | 文件 |
|---|---|---|---|
| `store_order_report` | `createPurchaseOrder`（`createPurchaseOrder/index.js:379-399`） | 下单提交即生成 | CSV |
| `store_receipt_report` | `createReceipt`（`createReceipt/index.js:599-618`） | 每批收货后 | CSV（全量行） |
| `store_receipt_price_report` | `createReceipt`（`createReceipt/index.js:623-654`） | 每批收货后 | CSV（**仅可付款行**） |
| `supplier_order_report` | `createPurchaseOrder`（`createPurchaseOrder/index.js:425-450`） | 每单一供应商一份 | CSV |
| `supplier_receipt_report` / `supplier_receipt_price_report` | `createReceipt`（`createReceipt/index.js:673-736`） | 每批收货 × 每供应商 | CSV |
| `store_daily_summary_report` / `store_monthly_summary_report` | `generateSummaryReport` | **用户手动点「生成汇总」** | CSV（聚合行） |

元数据集合 `report_file` 的关键字段（`generateSummaryReport/index.js:243-260`、`seed-data/report_file.json:1-17`）：`report_id`、`report_type`、`report_scope`、`scope_id`、`scope_name`、`related_date`、`basis_date_type`、`file_name`、`file_url`（fileID）、`file_version`、`generated_at`、`generated_by_system`、`status`（`generated` / `superseded`）、`has_abnormal`、`abnormal_summary`、`excluded_rows`、`total_amount`、`item_count`、`regenerated`。

版本号来自共享集合 `report_version_counter`，key = `${reportType}_${scopeId}_${relatedDate}`。

**本域最核心的问题**：`getReportDetail` 不是读 CSV，而是**按报表元数据里的 scope/date 从 `purchase_order_item` / `receipt_item` 重新查库重建行数据**（`getReportDetail/index.js:78-83`），而这个重建口径与 CSV 生成时的口径**在 4 类报表上都不一致**（详见 §3、§4.2）。这是本次探索发现的最高风险簇。

---

## 2. 报表生成链路时序

### 2.1 汇总报表（手动）

```
report-list.wxml:6  [生成汇总 ▸]
  → report-list.js:125 generateSummary()
     ├─ 前端角色闸门：仅 super_admin / purchaser（report-list.js:127-131）
     ├─ wx.showActionSheet → 强制 date = 今天本地日期（report-list.js:136-138）
     └─ cloud.callFunction('generateSummaryReport', { period, date, storeId })
          → getSessionUser (index.js:12-38)
          → 角色校验：store_manager / purchaser / super_admin（:166-168）
          → isDate 校验（:78-82, :172）
          → 非全局角色强制 storeId = user.default_store_id（:174-181）
          → store 存在性校验（:184-186）
          → getStoreReceipts: count() + skip/limit 分页取 receipt_id（:85-106, :188）
          → loadReceiptItems: 每 20 个 receipt_id 一块，_.in + skip/limit（:109-126, :189）
          → loadProductCategoryMap / loadSupplierNameMap（:129-160, :190-191）
          → 按 supplier_id|product_id 聚合（:193-219）
          → 组装 CSV（:223-230）
          → getNextVersion: CAS 取号（:53-76, :234）
          → cloud.uploadFile（:238-241）
          → report_file.add（:243-261）
          → 返回 { fileID, fileName, totalAmount, itemCount }
  → report-list.js:152-153 util.showSuccess + this.reload()
```

### 2.2 查看链路

```
report-list / report-history → goDetail
  → report-detail.js:24 getReportDetail({ reportId })
     → 权限校验（getReportDetail/index.js:56-77）
     → 按 report_type 分 5 个分支重建 rows（:84-254）
        · store_order_report       → purchase_order_item by purchase_order_id
        · store_receipt_report / store_receipt_price_report → receipt by purchase_order_id **limit(1)** + receipt_item
        · supplier_order_report    → purchase_order by order_date **limit(200)** + items by supplier_id
        · supplier_receipt_report / _price → receipt by receipt_date **limit(200)** + items by supplier_id
        · store_daily/monthly_summary_report → cloud.downloadFile 下载 CSV → RFC4180 解析回 rows（:203-253）
  → report-detail.wxml 按类型渲染 5 个表格块
  → 导出：report-detail.js:96-125 getReportFileUrl({ fileId }) → wx.downloadFile → wx.openDocument
```

只有汇总报表的详情是**读自己生成的文件**，其余 4 类都是重建——这两条路径的分歧是全部正确性问题的来源。

---

## 3. 统计口径与正确性

### 3.1 `generateSummaryReport` 的口径

- **时间范围**：`daily` 按 `receipt_date === date`；`monthly` 按 `receipt_date ∈ [YYYY-MM-01, YYYY-MM-31]`（`generateSummaryReport/index.js:87-91`）。区间是字符串比较，`YYYY-02-31` 这种"无效上界"在字典序下仍能正确排除 3 月数据（`'2026-02-31' < '2026-03-01'`），**不构成 bug**，但可读性差，且依赖"receipt_date 恒为 `YYYY-MM-DD`"这一约定。
- **维度**：门店（`scope_id`）× 供应商 × 商品（key = `supplier_id|product_id`，同商品多供应商分行，`:193-200`）。**没有分类维度聚合**，`category` 只是装饰列。
- **状态口径**：
  - 取数**只看 `receipt.store_id` + `receipt_date`**，**完全不读 `receipt.receipt_status`**（`completed` / `abnormal`，见 `createReceipt/index.js:478`）。异常收货单照常计入，这是合理的（异常是收货事实）。
  - **完全不读 `purchase_order.order_status`**，也不与订单状态做 join。所幸 `dataService.cancelOrder` 禁止已有收货记录的订单作废（`dataService/index.js:1352-1355, :1373-1376`），因此"已取消订单的收货被计入汇总"这一路径当前不可达。**这依赖上游约束，而非本函数自证**——属于耦合风险。
  - **不按 `payable_flag` 过滤**（`:213-218`）：质量/错货/缺价行的金额全部计入 `total_amount`。
  - **按 `is_manual` 整体剔除**（`:196-197`），连下单/实收数量也不计，注释说明"手动行金额走凭证核销"。这是明确的产品口径。
- **生成物**：**聚合行**写入 CSV + `report_file` 元数据行 + 云存储文件，三者都有。行数据**未单独落库**，后续只能靠回读 CSV 重建（见 §4.2）。

### 3.2 合计与求和一致性

**做得好的地方**（历史提交 `a346020` "report totals" 的成果，已验证落地）：

- 逐行先舍入到分再累加，避免"先累加后舍入"的尾差：
  - 汇总：`generateSummaryReport/index.js:217-218` → `subtotal = round(received×price×100)/100`，`agg.amount = round(agg+subtotal)`
  - 带价报表：`createReceipt/index.js:633-635, :716-718`；补生成：`dataService/index.js:1239-1240, :1299-1300`
  - 页面重建：`getReportDetail/index.js:118-119, :191-192` 用同一公式
- 三份 CSV 与三份重建口径**同为逐行舍入**，代码注释显式对齐（`getReportDetail/index.js:118`、`:191` 都标注 P2-62/P0-8）。
- 合计行 `totalAmount = round(Σrow.amount)`（`generateSummaryReport/index.js:221`），与 `合计` 行一致。
- **单位**：全链路是"元 + 浮点数量"，没有分/元换算；金额一律 2 位小数，数量保留 3 位小数（`:214-215` 的 `round(×1000)/1000`）。**未发现 1 分钱尾差风险**。

**分页聚合 vs 全量聚合**：`getStoreReceipts` / `loadReceiptItems` 都是"count + skip/limit 全量拉取"（`:96-104, :116-123`），**是全量聚合，不是分页聚合**，因此不存在分页累加丢数问题。但两个 `skip/limit` 都**没有 `orderBy`**——CloudBase 无序分页顺序不保证，跨页可能重复或漏读，直接导致汇总金额/数量偏差（见 §9 R5）。

### 3.3 结算口径不一致（中-高）

`store_receipt_price_report` / `supplier_receipt_price_report` 的 CSV **只含可付款行**（`createReceipt/index.js:626` `items.filter(item => item.payableFlag && !item.isManual)`、`:707`、`:1232`），而 `generateSummaryReport` 的汇总金额**不做 payable 过滤**（`generateSummaryReport/index.js:213-218`）。

结果：**同一门店同一天的「日汇总 total_amount」≠ 当天「带价格收货报表合计之和」**，差额 = 质量/错货/缺价行的金额。如果日/月汇总是对账或付款依据，两者会对不上；如果只是运营看板，则口径需要在 UI 上明示。当前两处都没有任何提示（`report-detail.wxml:119-142` 汇总块没有 `excludedNote`，而带价块有，`:25-27`）。

---

## 4. 四个云函数逐一分析

### 4.1 `generateSummaryReport`（276 行）

| 项 | 结论 |
|---|---|
| 认证 | 共享 `getSessionUser`（`:12-38`），支持 B12 多设备会话数组 + 旧单会话字段兜底，过期时间用 `Number.isFinite` 兜住脏数据。**健壮** |
| 权限 | `:166-168` 允许 `store_manager` / `purchaser` / `super_admin`；`:174-181` 非全局角色强制 `storeId = user.default_store_id` 并拒绝跨店。**无越权风险** |
| 参数校验 | `period` 白名单（`:170`）、`date` 严格 `YYYY-MM-DD` 且反查 UTC 构造校验闰年（`:78-82, :172`）。**扎实** |
| 文件名 | `reports/summary/{period}/{storeId}/{date}-summary-v{n}-{base36}-{hex6}.csv`（`:237`），随机后缀防撞路径。`safePathPart` 存在但**未用于路径**（只用于 `createReceipt` 侧含中文门店名），本函数路径不含用户可控中文，**无路径注入** |
| CSV 安全 | `csvField` 做双引号转义 + 防公式注入（`=+-@` 前缀加 `'`，`:41-46`）。**到位** |
| 并发取号 | `getNextVersion` 是"读旧值 → `where({_id, count: old}).update` → `updated===1` 才算抢到 → 重试 5 次"的 CAS（`:59-75`），修掉了原来"`_.inc` 后回读"导致双方回读同一最终值的跳号/碰撞问题。**实现正确**，5 次重试耗尽抛错 |
| 幂等 | **无**。见 §5 |
| 错误处理 | 顶层 `try/catch` 吞掉异常返回 `{code:-1}`（`:272-275`）；`uploadFile` 在 `report_file.add` **之前**，若 `add` 失败会产生孤儿 CSV 且版本号已消耗（`:238-261`），无回滚 |

**本函数发现的正确性 bug**（详见 §9 R1）：`orderQty` 累加 `order_qty_snapshot`（`:214`），而 `receipt_item.order_qty_snapshot` 写的是**整行订单量而非本批实收量**（`createReceipt/index.js:278, :287-297` 用 `orderItem.order_qty` 构造 `canonicalItems`，`:497` 原样落库）。**分批收货时每批都重复携带整行下单量**，汇总把 N 批的下单量相加 → **下单数量被放大 N 倍**。`received_qty` 是本批量，累加正确；`price_snapshot` 是单价，无累加问题。所以只有"下单数量"列失真。

### 4.2 `getReportDetail`（261 行）

权限（`:56-77`）：`super_admin`/`purchaser` 全量；`chef` 只看本店 `store_order_report`；`store_manager` 看本店全部 store scope。**与 `getReports`、`getReportFileUrl` 三处口径一致**。

| 分支 | 重建口径 | 与 CSV 文件是否一致 |
|---|---|---|
| `store_order_report`（`:84-97`） | `purchase_order_item by purchase_order_id` limit(1000) | 一致（单订单，CSV 同源） |
| `store_receipt_report` / `store_receipt_price_report`（`:98-129`） | `receipt by purchase_order_id` **`.limit(1)`** → 第一个收货单 | **不一致**：分批收货时每批一份报表（`report_id = RPT_SR_{receiptId}`），但 `limit(1)` 永远返回该订单**第一张**收货单 → 第 2、3 批的详情页显示第 1 批的行；且带价报表的 CSV 只含可付款行，重建却返回全量行 |
| `supplier_order_report`（`:130-160`） | `purchase_order by order_date` **`.limit(200)`**（跨全部门店、无分页）+ items by `supplier_id` | **不一致**：CSV 是**单订单**（`createPurchaseOrder/index.js:425-450`），详情页却是**该供应商当日全部门店全部订单**的并集；且 `limit(200)` 无分页，跨店订单 >200 时静默截断 |
| `supplier_receipt_report` / `_price`（`:161-202`） | `receipt by receipt_date` **`.limit(200)`**（跨全部门店）+ items by `supplier_id` | **不一致**：同上，CSV 是单批单收货单，详情页是该供应商当日全部门店的并集 |
| 汇总报表（`:203-253`） | 下载 CSV + RFC4180 解析 | 一致（唯一走文件路径的分支），解析失败**向上抛**而非静默空表（`:248-252`），这点做得对 |

其他：
- `supplier_order_report` 分支把 `order.store_name` 直接暴露为 `storeName`（`:153`），供应商侧报表的详情数据含**门店名**——但供应商角色本身无法调用本函数（`:72-74` 非全局角色只放 chef/store_manager），所以不构成越权。
- 汇总 CSV 解析跳过 `f[0] === '合计'`（`:237`）；若某商品名恰好叫"合计"会被漏掉（极低概率）。
- 返回体是 `{ ...report, rows }` 全量透出（`:256`），未做字段裁剪。
- `isManual` 在汇总分支不存在，前端汇总块的异常横幅不会出现——符合口径。

### 4.3 `getReports`（103 行）

- **参数校验**：`reportScope` 白名单（`:46`）、`reportType` 白名单 8 种（`:68-76`）、`relatedDate` 正则（`:47`）。**齐全**。
- **分页上限**：`page = clamp(1, 1000)`，`pageSize = clamp(1, 50)`（`:88-89`），`Number(...) || 默认值` 兜住 NaN 与非数字字符串。最大 `skip = 999×50 = 49950`，不会打爆查询。
- **排序**：硬编码 `orderBy('generated_at', 'desc')`（`:93`），**不接受前端排序字段 → 无排序注入面**。
- **角色过滤**：chef → store + `store_order_report` + 本店（`:50-56`）；store_manager → store + 本店（`:56-60`）；purchaser/super_admin → 可选 scope（`:61-63`）。并在 `:78-86` **二次强制覆盖** chef/store_manager 的 scope/scope_id，防止客户端参数把范围放宽（注释 "Client filters can narrow results but cannot expand role scope"）。**这是标准的"只收窄不放宽"写法，正确**。
- **缺陷 1**：`:43` 解构了 `storeId` 但**全文从未使用**。前端 `report-list.js:75` / `report-history.js:62` 都传了 `storeId`（`currentStore.storeId`），实际被服务端静默丢弃：purchaser/super_admin 恒为全门店，store_manager/chef 恒用 `user.default_store_id`。目前因店长只有单店而不产生实际偏差，但 **API 契约与实现不符**，一旦店长有多店授权即成越权反向缺陷（看不到应看到的）或误显示。
- **缺陷 2**：不返回 `total_amount` / `item_count` 的归一化字段（`utils/cloud.js:212-225` 的 `normalizeReport` 也未映射），因此**报表列表上看不到任何金额**，只能进详情。对"汇总报表"这种以金额为核心的报表，列表层缺金额是可见性缺口（信息性，非安全问题）。
- **缺陷 3**：不区分 `status`，`superseded` 报表与正常报表混列（前端靠 tag 标"已作废"，`report-list.wxml:41`），也没有"最新一版"标记。同一 store+date 存在多版本时无法一眼判断哪份有效。

### 4.4 `getReportFileUrl`（64 行）

- **鉴权**：同 `getSessionUser`（`:11-37`）。
- **fileID 归属校验**：`:46` 用 `report_file.where({ file_url: fileId })` **反查元数据**，即只有登记过的 fileID 才可能换取临时链接——**不存在拿任意 fileID 换 URL 的越权路径**（优于"信任客户端传 fileID 直接 getTempFileURL"的常见写法）。
- **角色校验**：`:49-54` 与 `getReportDetail` 完全同口径（chef 仅本店 `store_order_report`）。
- **临时链接**：`cloud.getTempFileURL({ fileList: [fileId] })`（`:55`），有效期由平台决定（通常约 2 小时，**待确认具体配置**）；**未返回/未缓存有效期**，前端也没有任何过期处理（`report-detail.js:106-121` 只在失败时 toast）。
- **无 `status` 检查**：`superseded` 报表的文件仍可下载（`report-detail.wxml:41` 会标"已作废"，但导出按钮不拦截）。业务上多半可接受，但审计角度是缺口。
- **`user.default_store_id` 未前置校验**：`:50` 直接比较 `report.scope_id !== user.default_store_id`。若某 store_manager 账号 `default_store_id` 为空且存在 `scope_id` 为空的报表，则 `'' !== ''` 为 false → 放行。现实中 `scope_id` 不会为空，属理论边界，但与 `getReports`（`:54`、`:59` 先判 `!user.default_store_id` 返回 403）的写法不一致，建议对齐。
- **供应商角色拿不到任何报表文件**（`:49` 只认 chef/store_manager/purchaser/super_admin）。供应商的"账单"实际走 `getSupplierReceipts` 而非报表，属于产品分层选择，非缺陷，但**报表域里没有可供供应商下载的对账单**，值得确认是否符合业务预期。

---

## 5. 幂等与并发

### 5.1 已有保障

- `report_version_counter` 的 CAS 取号（`generateSummaryReport/index.js:59-75`，同一实现也用于 `createReceipt/index.js:77`、`createPurchaseOrder/index.js:82`、`dataService/index.js:365`）保证**版本号不重复**。
- 文件名带 `Date.now().toString(36) + randomBytes(3)` 后缀（`:237`），并发同店同日生成不会互相覆盖。
- `report_id` = `RPT_{DS|MS}_{storeId}_{date}_v{version}`（`:245`），因 version 唯一而唯一。
- 补生成用 `_RG` 后缀区分（`dataService/index.js:1221, :1248, :1281, :1308`），避免与原件 `report_id` 碰撞。

### 5.2 缺口：汇总报表没有任何幂等

1. **无唯一键 / 无重复检测**：生成前不查"该 store + period + date 是否已存在报表"（`generateSummaryReport/index.js:188` 直接开始取数）。
2. **无"生成中"锁**：没有 `status: 'generating'` 之类的占位记录，也没有前端按钮禁用（`report-list.js:125-156` 无 `isGenerating` 标志）。
3. **前端可重入**：`generateSummary` 是 `async` 但无防重入；快速双击"生成汇总"→ 两个 `wx.showActionSheet` → 两次云函数调用 → **两条报表记录 + 两个 CSV + 版本号跳到 v1、v2**，`report-list` 会同时列出两份"v1 / v2"，用户无从分辨哪份有效（`getReports` 也不标最新版，见 §4.3 缺陷 3）。
4. **月汇总的版本计数 key 含传入日期而非月份**（`:232-234` → `store_monthly_summary_report_S001_2026-10-04`）：10-04 和 10-05 各生成一次月汇总，各自从 v1 开始，**同一月份的报表版本会重号**（`report-list.wxml:42` 显示 `v{fileVersion}`，两份月汇总都显示 v1）。`report_id` 本身不碰撞（含日期），但用户看到的版本号语义错误。
5. `getNextVersion` 与 `report_file.add` **不在同一事务**：`add` 失败会留下已消耗的版本号与孤儿文件（见 §4.1）。5 次 CAS 重试耗尽抛错返回 -1，用户视角是"生成失败"，但版本号已前进——**跳号**，无影响数据正确性，仅影响可读性。

### 5.3 相关：其他报表的幂等

`createReceipt` / `createPurchaseOrder` 的报表生成失败只做**补偿**：订单打 `missing_reports` 标记 + 定向通知管理员，由 `dataService.regenerateReceiptReports`（`dataService/index.js:1164-1331`）补生成，**不做去重**——连续点两次补生成会得到两份 `_RG` 后缀的新报表。`missing_reports` 在补生成成功后清除（`:1324-1329`），但清除发生在 `return` 之前，若中途失败已生成的部分不受影响（注释也如此声明，`:1321`）。属可接受的最终一致策略，但报表列表会出现重复条目。

---

## 6. 权限与数据范围

### 6.1 逐角色矩阵

| 角色 | 生成汇总 | 报表列表范围 | 详情 | 下载文件 |
|---|---|---|---|---|
| `super_admin` | 允许，可指定任意门店（`generateSummaryReport/index.js:174`） | 全部（`getReports/index.js:61-63`） | 全部（`getReportDetail/index.js:72`） | 全部（`getReportFileUrl/index.js:49`） |
| `purchaser` | 允许，可指定任意门店 | 全部 | 全部 | 全部 |
| `store_manager` | **后端允许**（`:166`），限本店（`:176-180`）；**前端拦截**（`report-list.js:127-131`） | 本店全部 store scope（`getReports/index.js:56-60`） | 本店全部类型（`getReportDetail/index.js:74-76`） | 本店全部类型（`getReportFileUrl/index.js:50`） |
| `chef` | 拒绝（-403） | 本店 `store_order_report`（`getReports/index.js:50-56`） | 仅 `store_order_report`（`:74-76`） | 仅 `store_order_report`（`getReportFileUrl/index.js:53`） |
| `supplier` | 拒绝（-403） | 拒绝（`getReports/index.js:64-66`） | 拒绝（`:74`） | 拒绝（`getReportFileUrl/index.js:49-51`） |

### 6.2 结论

- **未发现跨店 / 跨供应商越权**。三处读取路径的判定条件一致（`scope_id === user.default_store_id` + chef 类型白名单），且服务端始终使用 `user.default_store_id` 而非客户端传入值，**客户端伪造 `storeId` 无效**（`getReports/index.js:43` 的 `storeId` 干脆被忽略）。
- **chef 的参数覆盖已修复**：`:53` 先设 `report_type = 'store_order_report'`，`:73-76` 被客户端传入值覆盖后，`:79-86` 再次强制覆盖回来。这是明显针对"客户端参数扩大范围"的加固，正确。
- **前端与后端不一致（中）**：`report-list.js:126` 注释写"与云函数 GLOBAL_ROLES 口径一致：下单人员/店长点了必 403"，**这句注释是错的**——`generateSummaryReport/index.js:166-167` 明确允许 `store_manager`，且 `:176-181` 专门为店长实现了"强制本店"分支。即**店长本可以在后端生成自己门店的日/月汇总，却被前端 `util.showToast('仅管理员可生成汇总报表')` 拦死**。要么后端是过度设计，要么前端是过度限制，两者必有一处需修正。
- **前端汇总入口对所有角色可见**：`report-list.wxml:6` 无 `wx:if` 角色判断，chef 也会看到"生成汇总"按钮并点出提示，属 UX 噪音。
- **门店维度**：`purchaser`/`super_admin` 的报表列表**不按 `currentStore` 过滤**（`getReports` 忽略 `storeId`），所以管理员在 A 店点"生成汇总"（`report-list.js:145` 取 `currentStore.storeId`）后，列表里同时混着所有门店的报表。可接受，但"生成"是门店粒度、"查看"是全量粒度，粒度不对称。
- `getReportDetail` / `getReportFileUrl` **未前置校验 `user.default_store_id` 存在性**（`getReports` 有），属 §4.4 提到的边界不一致。

---

## 7. 文件生命周期

| 环节 | 现状 |
|---|---|
| 存储位置 | 云存储 `reports/{store,supplier,summary}/...`；汇总走 `reports/summary/{period}/{storeId}/...csv`（`generateSummaryReport/index.js:237`） |
| 元数据 | `report_file` 集合，`file_url` 存 fileID（`:253`） |
| 临时 URL | `getReportFileUrl` → `cloud.getTempFileURL`（`getReportFileUrl/index.js:55`）。有效期由平台决定（通常 ~2h，**待确认**）；**不返回过期时间** |
| 过期处理 | **无**。`report-detail.js:106-121` 仅在 `wx.downloadFile` fail 时 toast "下载失败"，不会提示重新取链接，也不会自动重试 `getReportFileUrl` |
| 删除 / 清理 | **`report_file` 全库无 `remove`，云存储报表文件无任何删除逻辑**（全仓 `cloud.deleteFile` 只出现在 `dataService/index.js:1602` 清旧凭证图、`importProducts/index.js:94` 清导入模板）。作废只改状态：`dataService.cancelOrder` 把 order 类报表置 `status: 'superseded'`（`dataService/index.js:1399-1406`），文件与记录都保留。**报表文件无限累积**，长期是存储成本与检索噪声问题 |
| fileID 归属校验 | **有且做得对**：`getReportFileUrl` 以 `file_url` 反查 `report_file`（`:46`）作为前置条件，再加角色 + scope 双重判定 |
| 孤儿文件 | 存在两类：① `getNextVersion` 已取号、`uploadFile` 成功但 `report_file.add` 失败（`generateSummaryReport/index.js:238-261`）；② 补生成中途失败产生的部分 CSV（`dataService/index.js:1319-1322`）。两者都无清理机制 |
| 重名 / 覆盖 | 不会。随机后缀防撞路径（`:236-237`）；`createReceipt` 侧文件名含 receiptId |
| 编码 | 全部 `String.fromCharCode(0xFEFF) + csv`（BOM），`getReportDetail` 解析时 `replace(/^﻿/, '')` 剥除（`getReportDetail/index.js:210`）。**一致** |

---

## 8. 前端页面分析

### 8.1 三页职责划分（实际）

| 页面 | 职责 | 数据来源 | 差异点 |
|---|---|---|---|
| `report-list` | **报表中心 / 日常入口**：按类型 tab + 日期筛选 + 生成汇总 + 进详情 | `getReports`（`report-list.js:73-80`） | 有生成入口；tab 按角色裁剪（`:40-65`）；**tab 里没有日/月汇总两项**（`:46-62` 只有 6 种） |
| `report-history` | **历史报表 / 全量检索**：scope + type + 日期三筛选 | `getReports`（`report-history.js:60-68`） | 类型选项由 `meta.reportTypeMap` 全量生成（`:29-34`），**包含日/月汇总**；无生成入口 |
| `report-detail` | 详情渲染 + 导出 | `getReportDetail` | 合计逻辑分 price / summary 两路（`report-detail.js:53-66`） |

所以**日/月汇总报表在 `report-list` 只能靠"全部"tab 找到**，`report-history` 可精确筛选。这是一个可见性设计缺陷：生成后 `that.reload()`（`report-list.js:153`）只有在当前 tab 是"全部"且日期筛选为空时才看得到新报表。

### 8.2 刷新 / 缓存 / 导出

- **刷新**：两列表页都在 `onShow` 调 `reload()`（`report-list.js:20-24`、`report-history.js:27-38`），下拉刷新 + `onReachBottom` 追加。`reload()` 重置 `page=1, hasMore=true`（`:35-38`），逻辑正确。
- **缓存**：**完全无缓存**，每次 `onShow` 全量重拉第 1 页。列表页频繁进出会有重复请求，但无脏数据风险。
- **追加边界**：`hasMore = reports.length < total`（`:98`、`report-history.js:82`）。若翻页过程中有新报表插入（`orderBy generated_at desc` 且新数据插到最前），第 2 页会与第 1 页**重叠**，造成重复卡片。低概率，LOW。
- **失败处理**：`result.code !== 0` 只 toast，不更新列表（`:99-102`），追加场景下 `isLoadingMore` 会复位。**但 `loadReports` 没有 try/catch**：`cloud.callFunction` 内部已 catch 并返回 `{code:-1,...}`（`utils/cloud.js:72-75`），所以不会抛到页面，`isLoadingMore` 会正常复位。**正确**。
- **导出**：仅 `report-detail` 有导出按钮（`report-detail.wxml:151-154`）。两条分支：有 `fileUrl` → `getReportFileUrl` → `wx.downloadFile` → `wx.openDocument(showMenu:true)`；无文件 → toast "该报表尚未生成可下载文件"（`report-detail.js:98-124`）。`seed-data/report_file.json` 里所有 `file_url` 都是空串（`:11, :27, :42, :57, :74, :87, :101, :117, :131, :147, :161`），因此**种子数据的报表在详情页都只能看重建行、无法导出**。
- **金额展示**：`report-detail.wxml:93, :133` 直接 `¥{{item.subtotal}}`。汇总报表的 `subtotal` 来自 CSV 解析后的 `Number(f[6])`（`getReportDetail/index.js:245`），`Number("42.50")` → `42.5`，**页面显示 `¥42.5` 而非 `¥42.50`**；`unitPrice` 同理。视觉一致性问题，LOW。
- **合计口径**：`report-detail.js:53-66`
  - price 报表：`rows.filter(r => r.payable !== false && !r.isManual)` 求和，并算出 `excludedNote`（`:56-62`）。**与 CSV 合计一致**（CSV 只含可付款非手动行）。
  - summary 报表：全部行求和（`:63-66`）。**与 CSV 合计一致**。
  - 但**表格渲染的不是一致的那批行**：wxml `:87-94` 把 `rows` 全部渲染（含不可付款 / 手动行），CSV 里没有这些行。用户看到的表格比导出的文件**多出若干行**，只有 `excludedNote` 提示了"另有 N 行未计入合计"，没有提示"这些行也不在文件里"。**页面表格 ≠ 导出文件行集**，MEDIUM。
- **异常横幅**：`report-detail.js:48-52` 用行内 `abnormal` 反推 `hasAbnormal` 与 `abnormalSummary`，兜底了元数据缺失的情况，做得细致。

### 8.3 小缺陷

- `report-history.wxml:5` `共 {{reports.length}} 份报表`：显示的是**当前已加载条数**，不是 `total`。滚动加载到 40 条时会显示"共 40 份"，误导。`report-history.js` 已拿到 `total`（`:81`）但没存进 data。LOW。
- `report-history.js:29-34` 类型选项对**所有角色**都是全量 8 种，chef 选"供应商账单"会得到空列表（服务端在 `getReports/index.js:79-83` 强制回退到 `store_order_report` + `scope_id`，与所选 type 冲突 → 空结果）。UX 误导，LOW。
- `report-detail.wxml:128` `wx:key="productName"`：汇总报表同商品多供应商会产生**重复 productName**（聚合 key 是 `supplier_id|product_id`，`generateSummaryReport/index.js:200`），违反 `wx:key` 唯一性，小程序会告警并可能渲染错乱。LOW-MEDIUM。
- `report-detail.js:18-26` 详情请求无重试、无超时；汇总分支要走 `cloud.downloadFile` + 解析（`getReportDetail/index.js:209-252`），链路最长，失败时只 toast "加载失败"，用户无重试入口（页面已加载完，只能手动返回重进）。LOW。

### 8.4 `supplier-home` 与报表域的关系

**结论：`supplier-home` 不聚合报表 / 财务数据，与报表域无数据交集。**

- 页面数据只有两块：供货商基本信息（`app.globalData.supplierInfo`，`supplier-home.js:39-45`）、订单状态统计（`loadStats`，`:83-93`）。
- 统计来源是 `getSupplierOrders` 的 `statusCounts`（`supplier-home.js:85`），取的是**订单确认状态**（pending/confirmed/shipped/done/cancelled，`getSupplierOrders/index.js:84`），**不含金额、不含报表、不含汇总**。注释也写明"只取 statusCounts，pageSize 压到最小"（`supplier-home.js:84`）。
- 功能入口指向 `supplier-orders` / `supplier-receipts` / `supplier-prices`（`:100-110`），对应 `getSupplierOrders` / `getSupplierReceipts` / `getSupplierPrices`——**都不是报表域的云函数**。
- 因此"供应商能否越权看到别的供应商的汇总"这一项：**供应商角色根本进不了报表域**（§6.1），风险为 0；但反过来，**供应商拿不到自己那份账单 CSV**，只能看 `supplier-receipts` 页面。

### 8.5 `report-list.js` 未提交改动评估

`git diff` 显示 3 处改动，**全部是把可选链 `?.` 改写为 `&&` 短路表达式**：

| 位置 | 原 | 现 |
|---|---|---|
| `:42`（`initTabs`） | `app.globalData.userInfo?.role \|\| 'purchaser'` | `(app.globalData.userInfo && app.globalData.userInfo.role) \|\| 'purchaser'` |
| `:69-70`（`loadReports`） | `app.globalData.userInfo?.role` / `app.globalData.currentStore?.storeId` | `app.globalData.userInfo && app.globalData.userInfo.role` / `app.globalData.currentStore && app.globalData.currentStore.storeId` |
| `:145`（`generateSummary`） | `app.globalData.currentStore?.storeId \|\| ''` | `(app.globalData.currentStore && app.globalData.currentStore.storeId) \|\| ''` |

`report-list.wxml` / `.wxss` / `.json` **无任何未提交改动**（`git diff` 为空）。

**语义等价性逐条验证**：
- `A?.role` 在 `A` 为 `null`/`undefined` 时返回 `undefined`；`A && A.role` 在 `A` 为 falsy 时返回 `A` 本身（`undefined` 或 `null`）。后续都接 `\|\| 'purchaser'`，两者最终都是 `'purchaser'`。**等价**。
- `currentStore?.storeId` → `undefined`；`currentStore && currentStore.storeId` → `undefined`（当 `currentStore` 为 null）。第 3 处接 `\|\| ''`，等价。
- 若 `currentStore` 存在但 `storeId` 缺失，两者都得到 `undefined`/`''`。**等价**。

**结论：改动语义完全等价，不引入新问题。** 动机应是兼容性——微信小程序的可选链语法依赖较新的开发者工具 / 基础库（ES6→ES5 转译需 `enhance: true`），改写为原生 `&&` 可避免旧环境编译失败。

**佐证：同一仓库里 `report-history.js:56-57` 已经是这种风格**（`app.globalData.userInfo ? ... : 'purchaser'`），说明这是有意的统一方向，只是 `report-list` 漏改了。**改动是正确且必要的**。

**但需注意两点**：
1. `report-list.js:127` 的 `generateSummary` 里仍是 `(getApp().globalData.userInfo || {}).role` 第三种写法，仓库内三种风格并存，后续统一时可一起处理（不影响正确性）。
2. **这个改动本身是安全的，但它旁边的既有 bug 仍然存在**：`:126` 的注释与后端不符（后端允许 store_manager 生成），改动并未触及该行。

另注：工作区还有 `project.config.json` 的未提交改动（新增 `cloudfunctionRoot: "cloudfunctions/"` 与忽略 `采购流程图.png`），与报表域无关，仅是开发配置，`cloudfunctionRoot` 会让开发者工具识别云函数目录（**是正确且必要的配置**，否则工具不认云函数根目录）。

---

## 9. 风险清单

| # | 严重度 | 风险 | 触发条件 | 证据 |
|---|---|---|---|---|
| R1 | **高** | 汇总报表「下单数量」在分批收货时被成倍放大。`order_qty_snapshot` 存的是整行订单量，非本批量；汇总按批累加 | 采购单存在 ≥2 个收货批次（`partial_received` 流程，`createReceipt/index.js:455-468` 显式支持） | `createReceipt/index.js:278, :287-297, :497`；`generateSummaryReport/index.js:214` |
| R2 | **高** | 带价报表（门店/供应商）详情页显示第 1 批的行，而非本批报表对应的那一批 | 订单分批收货 → 每批各一份 `RPT_SR_*` / `RPT_SRP_*` 报表；点第 2 批及以上报表 | `getReportDetail/index.js:100-105`（`.limit(1)`）；`createReceipt/index.js:586, :610` |
| R3 | **高** | 供应商类报表（订货/到货/带价）详情页显示该供应商**当日全部门店全部单据**的并集，与 CSV 的单订单/单批次内容不符；且 `.limit(200)` 无分页，跨店单量 >200 静默截断 | 同一供应商当天在多家门店有单 | `getReportDetail/index.js:130-160, :161-202`（按 `date` 查、`limit(200)`）；对照 `createPurchaseOrder/index.js:425-450`、`createReceipt/index.js:673-736` 均为单订单/单批 |
| R4 | **中** | 日/月汇总的金额口径含不可付款行（质量/错货/缺价），与带价报表/结算口径不一致，两者对不上 | 门店当天存在质量/错货/缺价异常收货 | `generateSummaryReport/index.js:213-218`（无 `payable_flag` 过滤）对照 `createReceipt/index.js:626, :707` |
| R5 | **中** | 汇总取数的两处 `skip/limit` 无 `orderBy`，CloudBase 无序分页顺序不保证 → 跨页重复或漏读 → 汇总金额/数量随机偏差 | 门店当日 receipt > 100，或单块 receipt_item > 100 | `generateSummaryReport/index.js:96-104, :116-123` |
| R6 | **中** | 汇总报表无幂等：无唯一键、无生成中锁、无前端防重入 → 重复点生成产生多条报表 + 多个 CSV，且不标最新版 | 双击"生成汇总"，或多管理员同店同日并行生成 | `generateSummaryReport/index.js:188`（生成前不查重）；`report-list.js:125-156`（无 `isGenerating`）；`getReports/index.js:91-96`（无最新版标记） |
| R7 | **中** | 带价报表详情页的**行集**与导出文件不一致：页面渲染全部行（含不可付款/手动行），CSV 只含可付款非手动行；仅用一句"另有 N 行未计入合计"提示金额差异，未提示行集差异 | 打开任何带异常/手动行的带价报表 | `getReportDetail/index.js:106-128, :175-200`（全量行）；`createReceipt/index.js:626`；`report-detail.wxml:87-94, :25-27` |
| R8 | **中** | 前端禁止 `store_manager` 生成汇总，但后端明确允许并为其实现了"强制本店"分支；注释声称二者一致，实际不一致 | 店长点"生成汇总" | `report-list.js:126-131`（注释 + 拦截）对照 `generateSummaryReport/index.js:166-168, :174-181` |
| R9 | **中** | 月汇总无法补生成历史月份：日期被前端硬编码为"今天"，云端也没有日期回补入口 | 11 月想补 10 月的月汇总 | `report-list.js:136-138`（`today` 硬编码）；`generateSummaryReport/index.js:171-172` 虽接受任意合法日期但前端不给传 |
| R10 | **中** | 月汇总版本号按"传入日期"计而非"月份"计 → 同一月份多次生成的月汇总各自从 v1 开始，前端显示重复 v1 | 同月不同日各生成一次月汇总 | `generateSummaryReport/index.js:233-234, :245`；`report-list.wxml:42` |
| R11 | **低** | `getReports` 解构 `storeId` 但从未使用；前端两个页面都在传 | 多门店授权的店长/采购员 | `getReports/index.js:43`（vs `:54, :59`）；`report-list.js:75`、`report-history.js:62` |
| R12 | **低** | `report_file` 与云存储报表文件无任何清理机制，无限累积；作废只改 `status` | 长期运行 | 全仓无 `report_file.remove`；`cloud.deleteFile` 仅见 `dataService/index.js:1602`、`importProducts/index.js:94`；`dataService/index.js:1399-1406` |
| R13 | **低** | `getNextVersion` 取号 → `uploadFile` → `report_file.add` 非原子，`add` 失败留下孤儿 CSV 且版本号跳号；补生成中途失败同样留孤儿 | 云存储/DB 抖动 | `generateSummaryReport/index.js:234, :238-261`；`dataService/index.js:1319-1322` |
| R14 | **低** | 报表文件临时链接过期无处理：不返回过期时间，前端 `wx.downloadFile` 失败只 toast，不重试取链 | 长时间停留在详情页后点导出 | `getReportFileUrl/index.js:55-59`；`report-detail.js:106-121` |
| R15 | **低** | 日/月汇总报表在 `report-list` 无独立 tab，只能靠"全部"找到；生成后 `reload()` 在 tab≠全部或日期筛选非空时看不到 | 生成汇总后切在非"全部" tab | `report-list.js:40-65`（tabs 只有 6 种）对照 `utils/meta.js:39-40`（meta 有 8 种） |
| R16 | **低** | `report-history.wxml:5` "共 N 份报表" 显示当前已加载条数而非 total，随滚动增长误导 | 翻页加载后 | `report-history.wxml:5`；`report-history.js:81`（`total` 未存入 data） |
| R17 | **低** | 汇总详情 `wx:key="productName"` 在同商品多供应商时重复 | 同商品由 ≥2 家供应商供货 | `report-detail.wxml:128` 对照 `generateSummaryReport/index.js:200` |
| R18 | **低** | 金额/单价未格式化，页面显示 `¥42.5` 而非 `¥42.50`；CSV 解析丢失小数位 | 打开任何带金额的报表详情 | `report-detail.wxml:93, :133`；`getReportDetail/index.js:243-245`（`Number(f[4..6])`） |
| R19 | **低** | `getReportDetail` / `getReportFileUrl` 未前置校验 `user.default_store_id`，与 `getReports` 不一致；当 `scope_id` 与 `default_store_id` 同为空字符串时判定通过（理论边界） | 账号缺 `default_store_id` 且报表 `scope_id` 为空 | `getReportDetail/index.js:73-77`、`getReportFileUrl/index.js:49-54` 对照 `getReports/index.js:54, :59` |
| R20 | **低** | `getReportFileUrl` 不校验 `status`，`superseded` 报表仍可下载 | 下载已作废报表 | `getReportFileUrl/index.js:46-55`；作废标记在 `dataService/index.js:1403-1405` |
| R21 | **低** | chef 在 `report-history` 可选到无权类型（供应商类），得到空列表；且 scope 选项对 chef 开放 `supplier` | chef 打开历史报表 | `report-history.js:20-24, :29-34` 对照 `getReports/index.js:79-83`（强制回退导致冲突） |
| R22 | 信息性 | 报表列表不展示 `total_amount` / `item_count`，汇总报表在列表层看不到金额 | 浏览列表 | `utils/cloud.js:212-225`（`normalizeReport` 未映射）；`getReports/index.js:98` |

---

## 10. 待确认清单

1. **月汇总/日汇总的产品定位**：是对账/付款依据，还是运营看板？若是前者，R4（payable 口径）必须与带价报表对齐；若是后者，应在 UI 明示"含不可付款行"。
2. **`report_version_counter` 的月汇总计数 key 是否应改为月份**（`YYYY-MM` 而非传入日期）——R10 的修法取决于此。
3. **是否已有云函数索引配置**（`report_file` 上 `report_id`、`file_url`、`{report_scope, report_type, scope_id, related_date}`、`generated_at` 复合索引；`receipt` 上 `{store_id, receipt_date}`；`receipt_item` 上 `{receipt_id}`、`{purchase_order_item_id}`）？本仓无 `database/rule` 或索引脚本可查，R5 的排序稳定性与整体性能都取决于此。
4. **`getTempFileURL` 的实际有效期配置**（平台默认约 2 小时），以及是否需要前端按过期时间提前刷新。
5. **供应商是否应该拿到自己的对账单 CSV**？当前报表域对 `supplier` 角色完全关闭，账单数据只在 `supplier-receipts` 页面可见。
6. **`store_manager` 是否应能生成本店汇总**（R8）——前后端二者取一。
7. **历史月份汇总的补生成入口**（R9）是否需要开放给管理员手动指定日期。
8. **分批收货的报表粒度**：现在每批一份报表 + 详情页重建口径错乱（R2/R3）。需确认设计意图是"每批一份"还是"每单一份、多批合并"，再决定修 `getReportDetail` 还是修生成侧。
9. **`order_qty_snapshot` 的语义**：R1 的根因是字段语义（"整行订单量"）与汇总需求（"本批下单量"）不匹配。若字段语义不改，汇总侧需按 `purchase_order_item_id` 去重取最大值；若改字段，会影响异常台账、少货判定等下游（`createReceipt/index.js:519-520` 的 shortage 描述也用它）。
10. **`receipt_abnormal` 状态的订单**是否允许继续分批收货（`createReceipt/index.js:407-408` 注释说允许）——若允许，汇总的 `orderQty` 放大倍数会更高。
