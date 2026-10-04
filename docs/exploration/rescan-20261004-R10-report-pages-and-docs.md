# R10 重扫：报表前端 3 页 + 剩余基建 + 项目文档（2026-10-04）

> **范围**：A. `pages/report-list|report-detail|report-history/`（3 × 4 = 12 文件）· B. `scripts/build-icons.js`、`scripts/icons-preview.html`、`styles/icons.wxss`、`project.config.json`、`project.private.config.json`、`sitemap.json`、`.gitignore`（7 文件）· C. `README.md`、`log.md`、`review.md`、`业务模糊点确认清单.md`、`采购流程图.html`（5 文件）· D. 交叉参照 `generateSummaryReport` / `getReports` / `getReportDetail` / `getReportFileUrl` / `utils/cloud.js` / `utils/meta.js` / `seed-data/report_file.json`（7 文件）
>
> **方法**：只读、全读、逐行；只信代码与实测（`grep`/`node` 断言），不采信注释、README、log.md、清单正文。每条结论带 `文件:行号`。拿不准标【待核实】。
>
> **前置文档**：`controller-horizontal-scan-20261004.md`（主控横向，先读）、`rescan-20261004-R5-report-cloud.md`（报表云函数，主互补）、`full-scan-06-pages-report.md`（514 行，报表 3 页主前置）、`full-scan-08-infra-and-data-contract.md`（702 行，基建主前置）、`full-scan-03-cloud-report.md`（347 行）。R3/R8 只读章节作背景。
>
> **版本基线**：HEAD `5268379`（`fix(pages): navigation, permissions, loading states and guard rails`）。工作区未提交：`pages/report-list/report-list.js`（+4/−4）、`project.config.json`（+10/−1）；`docs/` 全目录未追踪。
>
> **与 R5 的边界**：R5 已把 4 个云函数、8 类 type 全集、落库 14 点、越权矩阵、归档 vs 实时三套实现讲透。本文**不重复**，只补前端消费侧、基建、文档三块，以及对 R5/旧结论的复核与【待核实】回收。

---

## 0. 增量摘要

1. **契约比对结论：4 个报表云函数全部扁平 `{code, data}`，不存在 `result.data.data` 双层嵌套**（`getReports:98`、`getReportDetail:252`、`getReportFileUrl:56`、`generateSummaryReport:257-265`）。`normalizeReport`（`cloud.js:212-225`）映射 9 个字段，未映射 `has_abnormal` / `abnormal_summary` / `source_order_id` / `file_name`，但前 3 个前端各自显式兼容（`report-list.js:85,88`、`report-detail.js:41-43`），`file_name` 无消费者 → **无 undefined 缺口**。
2. **8 类 type 映射闭环三向对齐，无差集**：`getReports:68-72` 白名单 8 项 = `meta.js:32-40` 映射 8 项 = 落库 8 种。但**前端 tab 只有 6 种**（`report-list.js:55-62`），2 个汇总类在报表中心无法按类型筛；`report-history.js:29-34` 从 `Object.keys(meta.reportTypeMap)` 派生 → 8 种全暴露。**同一份报表在两页的能力不对等。**
3. **新发现 P1｜汇总报表空跑不拦截**：`generateSummaryReport` 无 `rows.length === 0` 守卫，门店当期无收货（或全为手动行，`:191` 被跳过）时仍 bump 版本号（`:228`）、上传仅 3 行 CSV（`:219-224`）、落 `report_file`（`:237-255`）、返回 `code:0 itemCount:0`；前端只显示「汇总报表已生成」并 reload（`report-list.js:148-153`）。叠加主控事实 10（全项目 0 处 `report_file` 删除）→ 空报表永久累积。
4. **新发现 P1｜`icon-truck-grey` 源失同步**：`styles/icons.wxss:61` 定义了它，但 `scripts/build-icons.js` 的 VARIANTS（实测 87 项）不生成它（truck 只有 `primary/teal/white`，`:108-110`）。wxss 实际 88 个变体类 → **重跑 `node scripts/build-icons.js` 会删掉 `icon-truck-grey`**，导致 `report-list.wxml:16` 动态拼出的「供应商到货」tab 未选中态图标变空白。
5. **新发现 P2｜`report-history` 副标题数字恒错**：`report-history.wxml:5`「共 {{reports.length}} 份报表」读的是**当前已加载页**的条数（`PAGE_SIZE=20`），而 `result.total` 取到后（`report-history.js:81`）只用于算 `hasMore`（`:82`）、从未存入 `data` → 副标题永远显示「共 20 份报表」。
6. **新发现 P2｜汇总报表明细 `wx:key="productName"` 撞键**：`report-detail.wxml:125`；而聚合键是 `supplier_id|product_id`（`generateSummaryReport:196-197`）→ 同商品多供应商必产生同名行，小程序重复 key 告警 + 渲染错乱。
7. **H1（店长汇总入口）确认仍成立，注释是错的**：`report-list.js:126` 注释「与云函数 GLOBAL_ROLES 口径一致：下单人员/店长点了必 403」与 `generateSummaryReport:160-161`（允许 `store_manager`）、`:170-175`（店长专属分支）**直接矛盾**。主控事实 4 的语法归一化只动了 `:42`/`:69-70`/`:145`，`:126-131` 未变 → 旧结论不成立的说法被否，注释错误依旧。
8. **CSV 导出真机推断**：`report-detail.js:103-108` `wx.openDocument` 无 `fileType`，基础库 `3.17.1`（`project.private.config.json:2`）。`openDocument` 官方支持 doc/docx/ppt/pptx/pdf/xls/xlsx，**csv 不在列**，且 `wx.downloadFile` 的 `tempFilePath` 不带扩展名 → 推断**必然落 `fail`「打开失败」**，`showMenu:true` 的转发/另存能力一并失效。修复方向只能服务端转 xlsx（SheetJS `xlsx ^0.18.5` 已在 `importProducts` 引入，依赖现成）。
9. **文档与代码脱节集中爆发**：`业务模糊点确认清单.md` 正文与索引表自相矛盾（#13 `[已定]`↔`[待确认]`、#15 `[待确认]`↔`[部分拍板]`），且 4 处正文陈述已被代码超越（:63、:301、:546 等）。`log.md` / `review.md` 停在 17-12 版（2026-03-21）并引用已删除的 `mock.js`。`README.md` 整体准确（14 个集合名、全部提交号实测存在），仅 3 处需补。
10. **`project.config.json` 只有 4 个键**：无 `appid`、无 `cloudfunctionRoot`、无 `miniprogramRoot`。`cloudfunctions/`（359KB / 19 个 index.js）不会被识别为云函数根而随主包打入，`docs/`（~1052KB）、`seed-data/`（60KB）、`scripts/`（68KB）、`业务模糊点确认清单.md`（73.5KB）同样会入包；`bigPackageSizeSupport:false` → 主包 2MB 限制。`packOptions.ignore` 只排了 1 个 298KB PNG，排除策略严重不对称。
11. **`.gitignore:8` 的 `seed-data/` 对 14 个已追踪文件完全无效**（`git check-ignore` 全部 NOT IGNORED，含 `supplier_test_user.jsonl`）；`docs/` 也不受任何 ignore 约束（`git check-ignore` exit=1）。
12. **回收旧【待核实】23 项，闭环 20 项、转真机 1 项、转业务拍板 2 项**。R5 遗留 5 项中 3 项本轮可闭环。

---

## 1. 文件清单与全读确认

**全读 31 个文件 / 4074 行**（另有 4 份前置文档全文或分节读过）。

### A. 报表前端 3 页 × 4 = 12 文件 / 943 行 ✅ 全读

| # | 路径 | 行 | 关键结构 |
|---|---|---|---|
| 1 | `pages/report-list/report-list.js` | 163 | `PAGE_SIZE=20:7` · `onShow:20` · `onPullDownRefresh:26` · `onReachBottom:30` · `reload:35` · `initTabs:40` · `loadReports:67` · `switchType:105` · `onDateFilter:110` · `clearDateFilter:115` · `goHistory:120` · `generateSummary:125` · `goDetail:158` |
| 2 | `pages/report-list/report-list.wxml` | 63 | 页头双入口 `:3-9` · 类型 tab `:11-20` · 日期筛选 `:22-31` · 卡片 `:33-57` · 空态 `:59-62` |
| 3 | `pages/report-list/report-list.json` | 4 | `navigationBarTitleText:"报表中心"` + `enablePullDownRefresh:true` |
| 4 | `pages/report-list/report-list.wxss` | 127 | tab 胶囊 / 日期筛选 / 卡片徽标（8 位 hex 透明色） |
| 5 | `pages/report-detail/report-detail.js` | 119 | `onLoad:18` · `goSourceOrder:76` · `goRowOrder:83` · `exportReport:89` |
| 6 | `pages/report-detail/report-detail.wxml` | 156 | 报表头 `:4-17` · 异常横幅 `:22-24` · 6 段类型分支 `:27-139` · 空态 `:141-144` · 导出 `:147-155` |
| 7 | `pages/report-detail/report-detail.json` | 3 | 仅 `navigationBarTitleText:"报表详情"`，**无下拉刷新** |
| 8 | `pages/report-detail/report-detail.wxss` | 118 | 表头/行/合计/异常横幅/`col-*` flex 权重 |
| 9 | `pages/report-history/report-history.js` | 115 | `scopeOptions:20-24` · `onShow:27` · `loadReports:54` · `onScopeChange:89` · `onTypeChange:95` · `onDateChange:101` · `clearDate:106` · `goDetail:111` |
| 10 | `pages/report-history/report-history.wxml` | 43 | 副标题 `:5` · 双 picker `:11-16` · 日期 picker `:19-22` · 列表 `:27-37` · 空态 `:39-42` |
| 11 | `pages/report-history/report-history.json` | 5 | 标题 + `usingComponents:{}` + `enablePullDownRefresh:true` |
| 12 | `pages/report-history/report-history.wxss` | 27 | 全走 `var(--color-*)` 设计变量 |

### B. 剩余基建 7 文件 / 483 行 ✅ 全读

| # | 路径 | 行 | 说明 |
|---|---|---|---|
| 13 | `scripts/build-icons.js` | 226 | ICONS 40 个 SVG 路径 · VARIANTS **实测 87 项** · `kebab:162` · `buildSvg:166` · `toDataUri:170` · 生成 wxss `:176-208` · **顺带生成预览页 `:210-226`** |
| 14 | `scripts/icons-preview.html` | 92 | **就是 `build-icons.js:210-226` 的产物**（生成时写入），6 列网格，`white` 变体套 `.dark` 绿底 |
| 15 | `styles/icons.wxss` | 109 | 7 个工具类 + **88 个变体类**；由脚本生成，勿手改 |
| 16 | `project.config.json` | 11 | 仅 4 键：`simulatorPluginLibVersion:{}` / `compileType` / `packOptions.ignore`；无末尾换行 |
| 17 | `project.private.config.json` | 22 | `libVersion:"3.17.1"` · `urlCheck:false` · `bigPackageSizeSupport:false` · `ignoreDevUnusedFiles:true` |
| 18 | `sitemap.json` | 8 | `{action:"disallow", page:"*"}` 全页禁收录 |
| 19 | `.gitignore` | 15 | 6 条规则 |

### C. 项目文档 5 文件 / 1438 行 ✅ 全读

| # | 路径 | 行 | 定位 |
|---|---|---|---|
| 20 | `README.md` | 120 | 角色/口径/安全加固/部署 7 步 |
| 21 | `log.md` | 121 | 版本日志 17-12 → 17-15 |
| 22 | `review.md` | 90 | 仅 17-12 一轮审查 |
| 23 | `业务模糊点确认清单.md` | 796 | 33 条目 + 2 张索引表 |
| 24 | `采购流程图.html` | 311 | 4 泳道 + 图例 |

### D. 交叉参照 7 文件 / 1210 行 ✅ 全读

| # | 路径 | 行 |
|---|---|---|
| 25 | `cloudfunctions/generateSummaryReport/index.js` | 270 |
| 26 | `cloudfunctions/getReports/index.js` | 103 |
| 27 | `cloudfunctions/getReportDetail/index.js` | 257 |
| 28 | `cloudfunctions/getReportFileUrl/index.js` | 64 |
| 29 | `utils/cloud.js` | 282 |
| 30 | `utils/meta.js` | 67 |
| 31 | `seed-data/report_file.json` | 167（11 条样本） |

**合计 31 文件 / 4074 行**（不含 4 份前置文档）。

---

## 2. 报表 3 页逐页解剖

### 2.1 `report-list`（报表中心，tabBar 第 3 页）

**`data`（`:10-18`）**：`activeType:'all'` / `filterDate:''` / `typeTabs:[]` / `reports:[]` / `page:1` / `hasMore:true` / `isLoadingMore:false`。

**生命周期**：`onShow`（`:20-24`）= `requireLogin()` → `initTabs()` → `reload()`。**无 `onLoad`**（首屏靠 onShow），tabBar 页每次切回都全量重拉第 1 页。`onPullDownRefresh`（`:26-28`）`reload().finally(stopPullDownRefresh)`。`onReachBottom`（`:30-33`）双守卫 `isLoadingMore || !hasMore`。

**`callFunction` 清单**：

| 调用点 | 函数 | 入参 | 前端期望返回 |
|---|---|---|---|
| `:73-80` | `getReports` | `role, storeId, reportType, relatedDate, page, pageSize:20` | `result.code===0` / `result.data` 数组 / `result.total` |
| `:142-146` | `generateSummaryReport` | `period('daily'|'monthly'), date, storeId` | `result.code===0`（**`result.data` 完全未读**） |

**跳转**：`goHistory:120-122` → `/pages/report-history/report-history`（全项目唯一入口）；`goDetail:158-162` → `/pages/report-detail/report-detail?id=`。

**事件 ↔ 方法**：7 处绑定（`wxml:6,7,15,24,30,34`）对 6 个方法，**0 处对不上，无孤儿 handler**。

### 2.2 `report-detail`（报表详情）

**`data`（`:8-16`）**：`report:{}` / `rows:[]` / `totalAmount:'0.00'` / `typeLabel:''` / `typeIconClass:''` / `typeColor:''` / `scopeLabel:''`。**无 `isLoading`/`loadState` 字段**。

**生命周期**：仅 `onLoad`（`:18-73`）：`requireLogin()` → `options.id` → `showLoading('加载报表...')` → `getReportDetail` → `hideLoading()` → 双写归一化（`:32-44`）→ 行级反推异常（`:48-52`）→ 算合计（`:53-59`）→ 一次性 `setData`（`:61-69`）。**无 `onShow`** → 从 `goSourceOrder`/`goRowOrder` 跳回不重拉；**无下拉刷新**（`.json:3`）。

**`callFunction` 清单**：

| 调用点 | 函数 | 入参 | 前端实际解构路径 |
|---|---|---|---|
| `:24-26` | `getReportDetail` | `{reportId}` ← `options.id` | `result.data`（对象）→ `report.rows`、`report.reportType/report_type`、`sourceOrderId/source_order_id`、`hasAbnormal/has_abnormal`、`abnormalSummary/abnormal_summary` |
| `:93-95` | `getReportFileUrl` | `{fileId: report.fileUrl || report.file_url}` | `fileResult.data.url` |

**跳转**：`goSourceOrder:76-80` → `purchase-detail?id=`（读 `report.sourceOrderId`，门店作用域报表用）；`goRowOrder:83-87` → `purchase-detail?id=`（读 `dataset.orderId`，供应商按日聚合多单用）。

**导出链路**：`exportReport:89-118` → `report.fileUrl` 空判（`:91`）→ `getReportFileUrl` → `wx.downloadFile`（`:100`）→ `wx.openDocument({filePath, showMenu:true})`（`:103-108`，**无 `fileType`**）。

### 2.3 `report-history`（历史报表）

**`data`（`:10-24`）**：`reports:[]` / `filterScope:'all'` / `filterType:''` / `filterTypeLabel:'全部类型'` / `filterDate:''` / `reportTypeOptions:[]` / `page:1` / `hasMore:true` / `isLoadingMore:false` / `scopeOptions`（3 项：all/store/supplier）。

**生命周期**：`onShow`（`:27-38`）每次重建 `reportTypeOptions`（`:29-34`，**全 8 种，不分角色**）→ 回填 `filterTypeLabel`（`:35-36`）→ `reload()`。`onPullDownRefresh:40` / `onReachBottom:44` 与 report-list 同构。**无 `onLoad`**。

**`callFunction`**：仅 `getReports`（`:60-68`），比 report-list 多一个 `reportScope`（`:63`）。

**跳转**：`goDetail:111-114` → `report-detail?id=`。

**分工结论见 §7。**

---

## 3. 前后端契约逐条比对（核心）

### 3.1 返回结构：无双层嵌套 ✅

| 云函数 | 实际返回 | 前端读取 | 判定 |
|---|---|---|---|
| `getReports:98` | `{code:0, data: res.data, total, page, pageSize}` | `result.data`（数组）+ `result.total` | ✅ 扁平 |
| `getReportDetail:252` | `{code:0, data:{...report, rows}}` | `result.data`（对象）+ `result.data.rows` | ✅ 扁平 |
| `getReportFileUrl:56` | `{code:0, data:{url}}` | `fileResult.data.url` | ✅ 扁平 |
| `generateSummaryReport:257-265` | `{code:0, data:{fileID, fileName, totalAmount, itemCount}}` | **完全不读**（`report-list.js:148-153` 只看 `code`） | ⚠️ 返回体 4 字段全丢 |

`res.data`（`getReports:96`）是 `collection.get()` 的原始数组，**不是** `{data:[...]}` 包裹 → 无 `result.data.data` 风险。

### 3.2 `normalizeReport` 覆盖度（`cloud.js:212-225`）

映射 9 字段：`report_id→reportId` / `report_type→reportType` / `report_scope→reportScope` / `scope_id→scopeId` / `scope_name→scopeName` / `related_date→relatedDate` / `generated_at→generatedAt`（走 `formatDateTime:112-121`）/ `file_version→fileVersion` / `file_url→fileUrl`。

**未映射 4 字段**：

| 字段 | 前端是否显式兼容 | 结论 |
|---|---|---|
| `has_abnormal` | `report-list.js:88`、`report-detail.js:42` 均写 `r.hasAbnormal !== undefined ? !!r.hasAbnormal : !!r.has_abnormal` | ✅ 兼容 |
| `abnormal_summary` | `report-list.js:85`、`report-detail.js:43` 双写取值 | ✅ 兼容 |
| `source_order_id` | `report-detail.js:41` 双写取值 | ✅ 兼容 |
| `file_name` | 全项目 0 消费（`wxml` 未引用） | ✅ 无消费者，无害 |
| `status` | 单词字段，经 `...report` 透传；`wxml:41`/`report-history.wxml:31` 直接读 | ✅ 兼容 |
| `total_amount` / `excluded_rows` / `item_count` | `report-detail` 收到但不读（`getReportDetail:252` 展开进 `this.data.report`） | ⚠️ 服务端合计已到前端却另算（H3/M9） |

**结论：无任何「前端取到 undefined」的字段。** 双写兼容是防御式写法，冗余但正确。

### 3.3 `has_abnormal` 写入点核对（列表红标的唯一来源）

写入仅 5 处：`createReceipt:572`（store_receipt）、`:605`（store_receipt_price）、`:654`（supplier_receipt）、`dataService:1167`（补生成③）、`:1227`（补生成⑤）。

**缺 2 类**：
- `createReceipt:689`（`supplier_receipt_price_report`）—— 只写 `excluded_rows`，**不写 `has_abnormal`**；
- `generateSummaryReport:237-255`（两个汇总类）—— 全文无 `has_abnormal`。

→ **3 类报表在 report-list 永无红标**（`wxml:40` `wx:if="{{item.hasAbnormal}}"` 恒假），而 `report-detail` 会从行级反推（`report-detail.js:48-52`）显示异常横幅 → 列表与详情自相矛盾。R5/03 批记录的 M8 成立，行号已按本轮实测更新。

### 3.4 前端 tab 选项 vs 服务端可达性

`initTabs`（`:40-65`）：chef 1 种、store_manager 3 种、admin 6 种，**admin 的 6 种不含 2 个汇总类**。

- 服务端对 chef 强制 `report_type='store_order_report'`（`getReports:52-55,79-82`）、对 store_manager 强制 `report_scope='store'`（`:56-60,83-86`）→ 前端 tab 与服务端收敛**一致**。
- admin 侧：`getReports` 白名单 8 项（`:68-72`）全部可达，但前端只给 6 个 tab → **2 个汇总类只能落在「全部」tab**（R5 N1 成立）。
- `report-history.js:29-34` 用 `Object.keys(meta.reportTypeMap)` 派生 **8 种全暴露**，但 chef/store_manager 无角色收敛 → chef 选任一非 `store_order_report` 类型 → 服务端返回空列表、无解释；选「供应商报表」范围 → 被 `getReports:79-86` 静默改回 store（M3 成立）。

---

## 4. 报表类型映射闭环（8 类全集）

三向对齐（生成侧 → 落库 → 读取 → 前端渲染）：

| # | report_type | 生成侧 | 落库点 | `getReports` 白名单 | `getReportDetail` 分支 | `meta.js` | report-list tab | report-history |
|---|---|---|---|---|---|---|---|---|
| 1 | `store_order_report` | `createPurchaseOrder`、`dataService:433` | 2+1 | `:69` | ① 重建 | `meta:33` | chef/店长/管理员 ✅ | ✅ |
| 2 | `store_receipt_report` | `createReceipt:572` | 1 | `:69` | ③ 重建 | `meta:34` | 店长/管理员 ✅ | ✅ |
| 3 | `store_receipt_price_report` | `createReceipt:605` | 1 | `:69` | ④ 重建 | `meta:35` | 店长/管理员 ✅ | ✅ |
| 4 | `supplier_order_report` | `createPurchaseOrder:416` | 2+1 | `:70` | ⑤ 按日重建 | `meta:36` | 管理员 ✅ | ✅ |
| 5 | `supplier_receipt_report` | `createReceipt:654` | 1 | `:70` | ⑥ 按日重建 | `meta:37` | 管理员 ✅ | ✅ |
| 6 | `supplier_receipt_price_report` | `createReceipt:686` | 1 | `:70` | ⑥ 共用 | `meta:38` | 管理员 ✅ | ✅ |
| 7 | `store_daily_summary_report` | `generateSummaryReport:226` | 1（共用） | `:71` | ⑦ CSV 反解析 | `meta:39` | **❌ 无 tab** | ✅ |
| 8 | `store_monthly_summary_report` | `generateSummaryReport:226` | 1（共用） | `:71` | ⑦ CSV 反解析 | `meta:40` | **❌ 无 tab** | ✅ |

**差集三向核对**：

| 方向 | 结果 | 证据 |
|---|---|---|
| 前端定义了但云端从不生成 | **无** | `meta.js` 8 项 ⊆ 落库 8 种 |
| 生成了但前端不认识 | **无** | 落库 8 种 ⊆ `meta.js` 8 项（`getReportTypeInfo:59-61` 有 `icon-file-grey` 兜底，永不崩） |
| 云端可达但前端不可筛 | **有 2 项** | #7/#8 在 `report-list.js:55-62` 无 tab |
| 白名单可达但门店角色读不到 | **有 2 项** | `getReports:79-86` 强制覆盖 |
| 种子样本缺失 | **有 2 项** | `seed-data/report_file.json` 11 条只有 6 种（#7/#8 无样本）；且 11 条 `file_url` **全为 `""`**（`:11,26,41,56,71,85,100,119,134,149,165`）→ **用种子数据演示时导出按钮 100% 走「该报表尚未生成可下载文件」**（`report-detail.js:116`） |

**结论一句话**：8 类 type 三向零差集，映射层完全闭合；断档只发生在「生成入口在 A 页、精确检索在 B 页、A 页缺 2 个 tab、B 页无角色收敛」这条产品路径上，不在数据层。

---

## 5. 文件下载链路与 CSV 导出问题

### 5.1 链路还原

```
report-detail.wxml:149 bindtap="exportReport"
  → report-detail.js:91   report.fileUrl || report.file_url 为空? → toast「该报表尚未生成可下载文件」
  → :93-95                getReportFileUrl({fileId})
                            → getReportFileUrl:46 反查 report_file.file_url
                            → :49-54 角色/作用域二次校验
                            → :55     cloud.getTempFileURL
                            → :56     返回 {code:0, data:{url}}
  → :96-98                fileResult.data.url
  → :100-101              wx.downloadFile({url: 临时URL})
  → :103-108              wx.openDocument({filePath: res.tempFilePath, showMenu:true})   ← 无 fileType
                            success → 「文件已打开」 / fail → 「打开失败」
  → :110                  downloadFile fail → 「下载失败」
  → :113                  链接获取失败 → 「文件链接获取失败」
```

错误分支齐全（4 个 fail 点全覆盖），**但无 loading、无防重入**（`_exporting` 守卫缺失，R5 M5 成立）。

### 5.2 CSV + 无 fileType 的真机行为推断

事实基础：
- 全 14 处产出文件后缀**全部是 `.csv`**（`generateSummaryReport:231`、`createReceipt:563,596,645,680`、`createPurchaseOrder:410`）。
- `project.private.config.json:2` `libVersion:"3.17.1"`。
- `wx.openDocument` 官方文档支持：doc/docx/ppt/pptx/pdf/xls/xlsx，**不含 csv**。
- `wx.downloadFile` 返回的 `tempFilePath` 是本地临时路径（`wxfile://temp_xxx`），**不带原扩展名**。

推断：
1. 无 `fileType` 时基础库按扩展名推断 → 临时路径无扩展名 → 无法推断类型 → **落 `fail`，用户只见「打开失败」**。
2. 即使个别机型/版本静默放行，`showMenu:true` 依赖可识别的文件类型才能提供「转发/保存到相册」菜单 → **转发能力一并失效**。
3. **不能靠前端 `fileType:'xls'` 冒充绕过**：CSV 被按 XLS 二进制格式解析会乱码或直接报错，比「打开失败」更糟。
4. 唯一正解是**服务端改产出 `.xlsx`**，而 `cloudfunctions/importProducts/package.json` 已依赖 `xlsx ^0.18.5`（SheetJS）→ 依赖现成，`generateSummaryReport` / `createReceipt` / `createPurchaseOrder` 只需把 CSV 字符串换成 SheetJS 写 Buffer，前端 `openDocument` 无需任何改动。

【待核实】不同基础库对 `.csv` + 无 `fileType` 的确切返回码（是否 `fail` 还是静默成功），决定文案兜底是「暂不支持打开该格式」还是直接切 xlsx。需真机实测。

### 5.3 临时 URL 过期后的行为

- `getTempFileURL` 默认有效期约 30 分钟，`getReportFileUrl:56` 的返回体**只有 `url`，不含 `expireTime`**（R5 G4 成立）。
- 前端无缓存策略：`report-detail.js:89-118` 每次点击都重新调云函数换新链接 → **正常使用路径不会拿到过期链接**。
- 但「过期后才点」的场景无专门分支：链接过期只会体现在 `wx.downloadFile` 的 `fail`（`:110`），与网络失败**共用「下载失败」文案**，无法区分。用户重试必然成功（因为每次都是新链接），实际危害有限。
- 无并发防护：连点会并发发起多组 `getReportFileUrl + downloadFile`，无节流。

---

## 6. 筛选参数与日期边界一致性

### 6.1 参数名逐字核对 ✅

| 前端传 | 云端读 | 位置 | 判定 |
|---|---|---|---|
| `reportType` | `reportType` | `report-list.js:76` / `getReports:43,73-76` | ✅ |
| `relatedDate` | `relatedDate` | `report-list.js:77` / `getReports:43,77` | ✅ |
| `reportScope` | `reportScope` | `report-history.js:63` / `getReports:43,46,63` | ✅ |
| `page` / `pageSize` | `event.page` / `event.pageSize` | `getReports:88-89` | ✅ |
| `role` / `storeId` | `:43` 解构 | **全文 0 使用**（权限按会话 user 收敛） | ❌ 死参（L4 成立） |
| `period` / `date` / `storeId` | `:163,165,169` | `generateSummaryReport` | ✅ |
| `reportId` | `:58` | `getReportDetail` | ✅ |
| `fileId` | `:43` | `getReportFileUrl` | ✅ |

**全项目 0 处幽灵 action、0 处参数名不一致。** 死参只有 `role`/`storeId` 两个，且服务端不按 client 参数收敛反而更安全。

### 6.2 日期边界

| 维度 | 结论 | 证据 |
|---|---|---|
| 时间范围筛选 | 前端只有**单日** picker（`report-list.wxml:24`、`report-history.wxml:19`），**无区间** | 两页均 `mode="date"` |
| `relatedDate` 校验 | **只正则不校验日历日** → 放行 `2026-02-31` | `getReports:47` |
| 对照严格度 | `generateSummaryReport` 用 `isDate`（回写比对）→ **拒绝** `2026-02-30` | `:72-76` |
| 严格度不一致 | 同一字段两个函数校验强度不同 | `getReports:47` vs `generateSummaryReport:72-76` |
| 含当天 | 单日等值匹配 `query.related_date = relatedDate` → **含当天** | `getReports:77` |
| 跨年 | 字符串比较，`2026-01-01` 与 `2027-01-01` 无歧义 | — |
| 「生成日期」vs「业务日期」混淆 | 🔴 两页筛的都是 `related_date`（**业务日期**：下单日/收货日/汇总点击日），而列表展示的是 `generated_at`（**生成时刻**，`getReports:93` 排序键）→ 用户看到「生成于 08-06 08:31」的卡片却被 `08-05` 的日期筛选命中 | `report-list.wxml:49,52` vs `:77` |
| 月汇总 `related_date` 语义 | 存**点击日**而非月初（`:227` 注释自述），文件路径才是月份（`:229`）→ `report-detail.wxml:11` 对月汇总显示「日期: 2026-10-04」易误读 | `generateSummaryReport:227-229` |
| 补历史日期 | `generateSummaryReport` **接受任意合法历史日期**，但前端 `date` 固定今天（`report-list.js:136-139`）→ 页内无补录能力 | 两端不一致 |
| 未来日期 | `generateSummaryReport:165-166` 只验格式不验未来 → 可生成必然为空的未来报表 | 配合 §0.3 |

---

## 7. `report-list` vs `report-history` 职责划分

| 维度 | report-list（报表中心） | report-history（历史报表） |
|---|---|---|
| 入口 | tabBar 第 3 页（`app.json:46-56`） | 仅 `report-list.js:121` 唯一入口，非 tabBar |
| **数据源** | `getReports`（`:73`） | **同一个 `getReports`**（`:60`） |
| 排序 | `orderBy('generated_at','desc')`（`getReports:93`） | **同一个排序** |
| 分页 | `PAGE_SIZE=20`（`:7`） | `PAGE_SIZE=20`（`:7`）完全相同 |
| 筛选 | 类型 tab（按角色 1/3/6 种）+ 单日 | 作用域（3 项）+ 类型（**全 8 种，不分角色**）+ 单日 |
| 异常标记 | 有（`js:88-90` + `wxml:40`） | **无**（`js:71-79` 不计算，`wxml` 不显示） |
| 已作废标签 | 有（`wxml:41`） | 有（`wxml:31`） |
| 生成入口 | 有（`:125`） | 无 |
| 加载态 | 无 `isLoading` → 空态与加载态共用 | 同左 |

**结论**：两页数据源、排序、分页大小、跳详情页方式**完全相同**，是同一份列表的两种筛法。

- **数字不会不一致**（同源同排序），这是正面结论。
- 但**顺序可能不一致**：`getReports:93` 排序**无次要键**，`created_at`/`_id` 均未参与。`createReceipt` 一次事务外连发 4 张报表、`createPurchaseOrder` 连发 2 张 → 同毫秒 `generated_at` 的记录在翻页边界顺序不确定 → 同一份报表可能重复出现、或整张在页边界消失。`report-list` 与 `report-history` 各自翻页时可能看到不同的排列。
- **能力互补且互相看不到**（R5 N1）：生成入口在 A 页，但 A 页缺 2 个汇总 tab → 刚生成的汇总只能落在「全部」里翻；B 页能精确筛到 8 类，但只能从 A 页进。
- **建议**：合并为一页（保留角色收敛的 tab + 作用域 picker），或 A 页补 2 个汇总 tab、B 页补角色收敛与异常标记。

---

## 8. `build-icons.js` 与样式体系

### 8.1 `build-icons.js` 解剖（226 行）

- **ICONS**（`:26-68`）：40 个 24×24 stroke 线性 SVG path，含 13 个商品分类图标（chef/armchair/leaf/drumstick/fish/shaker/bowl/beer/snowflake/utensils/brush/package）。
- **VARIANTS**（`:71-160`）：**实测 87 项** `[icon, color]` 组合。
- **COLORS**（`:10-23`）：12 色，与 `app.wxss` CSS 变量对齐（`#00873E`/`#52C41A`/`#FAAD14`/`#FF4D4F`/`#722ED1`/`#13C2C2`/`#EB2F96`/`#5B8FF9`/`#5AD8A6`/`#999999` 等）。
- **生成流程**：`kebab:162`（`calendarDays`→`calendar-days`）→ `buildSvg:166`（`viewBox='0 0 24 24' fill='none' stroke=... stroke-width='2'`）→ `toDataUri:170`（`encodeURIComponent` + 单引号 `%27`）→ 拼 `.icon-{kebab}-{color} { background-image: url("data:image/svg+xml,...") }`。
- **产出 1**：`styles/icons.wxss`（`:205-208`，`fs.mkdirSync(recursive)` + 写盘 + 打印「已生成 …（N 个图标变体）」）。
- **产出 2**：`scripts/icons-preview.html`（`:210-226`）—— **确认就是它的调试/预览页**：6 列 grid、`white` 变体套 `.dark` 绿底以便肉眼核对、直接内联 SVG data-URI 而非引类名。

### 8.2 产物与源码失同步 🔴（本轮新发现）

用 `node` 断言比对脚本 VARIANTS 与磁盘 `icons.wxss`：

```
VARIANTS: 87  |  wxss variant: 88  |  wxss total: 95
ONLY in wxss (build-icons.js would delete): ["icon-truck-grey"]
ONLY in script (not emitted):               []
```

即 `styles/icons.wxss:61` 有 `.icon-truck-grey`，但 `build-icons.js:108-110` 的 truck 只有 `primary/teal/white`。

**引用点**：`report-list.wxml:16`
```
{{activeType === item.value ? 'icon-' + item.iconBase + '-white' : 'icon-' + item.iconBase + '-grey'}}
```
`report-list.js:60` `{ value:'supplier_receipt_report', label:'供应商到货', iconBase:'truck' }` → 未选中态拼出 `icon-truck-grey`。

**后果**：当前运行时**图标正常显示**（wxss 里有），但任何人跑一次 `node scripts/build-icons.js`（脚本注释 `:3-4` 明确写「新增图标…重新运行即可」），`icon-truck-grey` 就会被删掉，「供应商到货」tab 未选中态变成**无背景图的空 `<view>`**（`background-image` 缺失但 `.icon`/`.icon-sm` 尺寸类仍在 → 一个 32×32 的空白方块）。这是**潜伏的构建即毁伤**，且因为 wxss 头注释「由 build-icons.js 生成，请勿手改」，修复者只会去重跑脚本。

**修复**：VARIANTS 补 `['truck', 'grey']` 后重跑（唯一缺失项，其余 86 项零差异）。

顺带说明：`grep` 静态扫描会漏掉它——全项目静态 `icon-` 引用 88 处对 94 个已定义类，**0 处死类**；`icon-truck-grey` 只在动态拼接路径上，只能靠「源码 ↔ 产物」双向 diff 才能抓到。

### 8.3 静态引用完整性（复测，与主控一致）

- 静态 `icon-[a-z0-9-]+` 引用 88 个唯一类，**全部**在 `styles/icons.wxss` 中定义 → **0 死类**。
- 唯一动态引用 `report-list.wxml:16`，涉及 6 个 `iconBase`（chart/clipboard/package/tag/factory/truck）× 2 态 = 12 个类，11 个有源码支撑、1 个只有产物（见 8.2）。
- JS 内硬编码 21 个类（`meta.js:33-40` 8 个 + 各页 13 个）全部存在。

### 8.4 `@import` 与 CSS 变量核对 ✅

- **全项目只有 1 处 `@import`**：`app.wxss:2` `@import "./styles/icons.wxss";` → 目标文件存在（109 行）。**无引用不存在的文件。**
- 30 个唯一 `--*` 变量被引用（`--color-primary`×7、`--color-text-primary`×5、`--radius-md`×4 …），**全部**在 `app.wxss:5-40` 的 `page{}` 中定义 → **0 处未定义变量**。
- `app.wxss`（301 行）无重复选择器、无 `* {}` reset、无全局 `z-index`/`position`，`.submit-bar` 等定位类都在页面 wxss 内。
- `styles/icons.wxss` 94 个 `.icon-*` 定义 + 7 个尺寸/内联工具类，无重复。

### 8.5 报表 3 页 wxss 的两种风格并存 ⚠️

| 页面 | 风格 | 证据 |
|---|---|---|
| `report-list.wxss`（127 行） | **硬编码色值** | `#00873E`×3、`#ffffff`×3、`#595959`×2、`#F0F2F5`、`#8C8C8C`×2、`#F0F0F0` |
| `report-detail.wxss`（118 行） | **硬编码色值** | `#ffffff`、`#E8E8E8`×3、`#262626`×2、`#595959`、`#8C8C8C`×2、`#FFFBE6`、`#cf1322`×2、`#fff1f0`、`#ffa39e` |
| `report-history.wxss`（27 行） | **CSS 变量** | `var(--color-bg-card)`、`var(--radius-md)`、`var(--shadow-card)`、`var(--color-text-*)` |

同属一个报表域的两页直接冲突：改主题色时 `report-history` 自动跟随，另两页要手动改。`report-history` 是后写的（27 行更紧凑、语义类名更多），另外两页是早期遗留。无命名冲突（各自类名前缀不同：`report-*` 与 `.page-*`/`.filter-*`/`.report-row`），但**`.report-version` / `.report-date` / `.report-meta` 三组类名在 `report-list.wxss` 与 `report-history.wxss` 中重复定义且样式不同**：

| 类名 | report-list.wxss | report-history.wxss |
|---|---|---|
| `.report-meta` | `:91-96` flex 两端对齐 | `:25` `font-size:24rpx` 灰字 |
| `.report-version` | `:83-89` 灰底小徽标 | `:26` 仅字号灰色 |
| `.report-date` | `:110-113` 26rpx | 未定义 |

因小程序 wxss 是**页级作用域**（每个页面只加载自己的 wxss + `app.wxss`），同名类不会互相污染 → **功能无影响**，但复制样式时容易拿错。

---

## 9. 配置合规性

### 9.1 `project.config.json`（11 行，工作区有改动）

**关键字段核对**：

| 字段 | 现状 | 判定 |
|---|---|---|
| `appid` | **缺失** | ⚠️ 无法在云端确认环境绑定；开发者工具依赖 private 配置或交互式填写 |
| `projectname` | **缺失**（在 private 配置里） | ✅ 合规 |
| `miniprogramRoot` | **缺失** → 默认 `.`（项目根） | ⚠️ 见 9.4 |
| `cloudfunctionRoot` | **缺失**（全库 grep 0 命中） | 🔴 见下 |
| `compileType` | `"miniprogram"` | ✅ |
| `packOptions.ignore` | 仅 1 条 file 规则 | ⚠️ 见 9.4 |
| `setting.urlCheck` | `false`（private `:6`） | ⚠️ 上线前必须打开 |
| `setting.bigPackageSizeSupport` | `false`（private `:20`） | ⚠️ 主包 2MB 不放开 |
| `libVersion` | `"3.17.1"`（private `:2`） | ✅ 远高于 `?.` 支持门槛（2.10+） |
| 文件末尾换行 | **无**（`git diff` 显示 `\ No newline at end of file`） | 建议补 |

**`cloudfunctionRoot` 缺失的后果**：微信开发者工具靠该字段识别云函数根目录。缺失时 `cloudfunctions/`（359KB、19 个 index.js）不会被识别为可右键「上传并部署」的云函数根，而**会被当作普通代码打进小程序主包**。`README.md:107` 的部署步骤依赖这个字段。修复成本一行：`"cloudfunctionRoot": "cloudfunctions/"`。

### 9.2 `project.private.config.json`（22 行）

`urlCheck:false`（开发期关域名校验，**上线前必须打开**）；`lazyloadPlaceholderEnable:false`、`skylineRenderEnable:false`、`useStaticServer:false`、`compileHotReLoad:true`、`ignoreDevUnusedFiles:true`（会按引用图剔除未使用文件，一定程度上缓解 9.4 的打包膨胀，但**只影响开发工具构建，不影响 CI/云端构建**）；`showES6CompileOption:false` 但**未显式写 `es6`/`minified`** → 依赖各机器默认值（full-scan-08 §7.2 已记，建议显式写出）。

### 9.3 `sitemap.json` 与 `.gitignore`

- **`sitemap.json`**：`{action:"disallow", page:"*"}` 全站禁收录。对 B2B 内部采购系统这是**最保守也最正确的配置**，符合审核要求（`app.json:69` 声明 `sitemapLocation:"sitemap.json"`，`app.json:70` `"cloud": true`、`:71` `"lazyCodeLoading":"requiredComponents"`、`:72` `"__usePrivacyCheck__": true` 均合规）。副作用：小程序无法被搜索到，只能靠扫码/转发。
- **`.gitignore`（15 行，6 条规则）**：`node_modules/`、`_tmp_test/`、`seed-data/`、`.claude/`、`.DS_Store`、`Thumbs.db`。
  - `git check-ignore -v seed-data/README.md`、`seed-data/report_file.json`、`seed-data/supplier_test_user.jsonl` **全部返回 NOT IGNORED**（`git ls-files` 确认 14 个 seed 文件全部已被追踪）。→ **`.gitignore:8` 的 `seed-data/` 声明对已追踪文件完全无效**（先入库后加 ignore 的经典陷阱）。主控横向扫描 §13 记录的 P0 明文口令问题根因在此。
  - `git check-ignore docs/exploration/…` exit=1 → **`docs/` 不受任何规则约束**。
  - `.claude/` 生效（`settings.local.json` 确实未入库）；`node_modules/` 生效（`cloudfunctions/` 下实测 0 个 node_modules 目录）。
  - **漏掉的东西**：`docs/`（~1052KB 勘探文档，会被打进主包）、`*.jsonl`（`seed-data/supplier_test_user.jsonl` 已追踪）、大体积 `.png`（`采购流程图.png` 298KB 已追踪、只在 `packOptions` 层面排除）、`seed-data/` 本身。
  - 口径矛盾：`seed-data/README.md` 是「版本化资产」（README:108 要求按它导入），`.gitignore:8` 却把它列为「本地种子/敏感数据」；`采购流程图.png` 是「文档配图」（README:116 引用），却只在打包层排除、git 层保留。**两个方向都没说清楚**。

### 9.4 `project.config.json` 未提交改动逐行评估

```diff
-  "compileType": "miniprogram"
+  "compileType": "miniprogram",
+  "packOptions": { "ignore": [ { "type": "file", "value": "采购流程图.png" } ] }
```

**判断：改动本身安全，但与仓库整体打包范围严重不对称。**

- **安全面**：只排除一个前端 0 引用的静态资源（`采购流程图.png` 全库 grep 只命中 `project.config.json:8` 自身、`log.md:38`、`README.md:116`，无任何 wxml/js 引用）；298KB 是仓库第二大单文件；`type:"file"` 精确到文件名，不会误伤。
- **不对称面**：排除策略只覆盖了**最不重要的 298KB**，而真正会撑爆主包的东西一个没排：

| 会随主包打入的目录/文件 | 体积 | 是否被排除 |
|---|---|---|
| `docs/`（19 个勘探文档，未追踪） | ~1052KB | ❌ |
| `cloudfunctions/`（19 个 index.js，因缺 `cloudfunctionRoot`） | 359KB | ❌ |
| `scripts/`（含 `icons-preview.html` 92 行调试页） | 68KB | ❌ |
| `seed-data/`（14 个 JSON + 1 个 jsonl + README） | 60KB | ❌ |
| `业务模糊点确认清单.md` | 73.5KB | ❌ |
| `README.md` / `log.md` / `review.md` | 22.2KB | ❌ |
| `采购流程图.html` | 15KB | ❌ |
| `采购流程图.png` | 298KB | ✅ **本次唯一被排除的** |
| **运行时真正需要的**：`pages/` 564KB + `utils/` 25KB + `assets/` 96KB + `styles/` 52KB + `app.*` 12KB | ~749KB | — |

主包 2MB 上限下，运行时 ~749KB + 上述非运行时 ~1620KB ≈ **2.4MB，已超限**。`bigPackageSizeSupport:false` 不放开 → **上传大概率直接失败**。`ignoreDevUnusedFiles:true` 能救一部分，但它只按「被 json/js/wxml 引用」剪枝，`docs/`、`seed-data/`、`业务模糊点确认清单.md` 这类无人引用的 `.md`/`.json` 是否被剪取决于开发者工具版本行为【待核实】。

**建议**：`packOptions.ignore` 改用 `type:"folder"` 批量排除 `docs/`、`seed-data/`、`scripts/`、`业务模糊点确认清单.md`、`采购流程图.html`，并补 `cloudfunctionRoot:"cloudfunctions/"` 让云函数走出主包。

### 9.5 `app.js` / 环境配置

- `app.js:2` `const CLOUD_ENV = 'cloud1-d3gezx51aca79d9bb'` 硬编码在**被打进包的前端代码**里并被 git 追踪；`project.config.json` / `project.private.config.json` 均无 env 声明 → 这是**唯一的环境来源**，开发/生产切换需改代码重打包。
- `app.js:40-43` `currentStore` 从 storage 恢复，`app.js:119` 初值 `null`。写入点只有 `login.js:98` 与 `store-switch.js:38` → 登录后必然有值，故 `report-list.js:145` 传空 `storeId` 的路径**仅当用户手动清了 storage**。

---

## 10. 项目文档与代码现实对账

### 10.1 `README.md`（120 行）—— 总体准确，仅 3 处需补

| 陈述 | 核对 | 判定 |
|---|---|---|
| `:110` 需建 13 个集合 | 实测 `cloudfunctions/` 共 **14** 个不同集合名（13 个 + `report_version_counter`） | ✅ 准确，`:111` 单独说明计数器自动创建 |
| `:107` 列出 6 个需重新部署的云函数 | 6 个 `package.json` 均存在 | ✅ |
| `:43` 提交号 `ffb5bf4`/`9350b9d`/`d48b17c` | `git cat-file -t` 全部 `commit` | ✅ 13 个提交号全部实测存在 |
| `:17` `deleteUser` 已落软删除 | `authService:500-502` `return await setUserStatus({...event, status:0})` | ✅ 准确 |
| `:36` 异常解决后自动发「待补结算提醒」 | `dataService:791-794` `title:'待补结算提醒'` | ✅ 准确（清单正文反而错了，见 §10.3） |
| `:45` 「除登录页外 25 个页面全部接入 auth-guard」 | 26 页 − 1 登录页 = 25 | ✅ |
| `:49` 「新增 `.gitignore`（忽略 `_tmp_test/` 等…）」 | `.gitignore:5` 存在；但 `:8` 的 `seed-data/` 对已追踪文件无效 | ⚠️ **未告知该 ignore 对 14 个已入库 seed 文件完全不生效** |
| `:49` 「移除无效的 `permission.scope.camera`」 | `app.json` 确无 `permission` 键 | ✅ |
| `:57` 订阅消息模板 ID 占位符 | `dataService:244` `const SUBSCRIBE_TEMPLATE_ID = ''`、`supplier-home.js:7` `= ''` | ✅ 仍为占位符，README 自知 |
| `:106-112` 部署 7 步 | 缺 `cloudfunctionRoot` 说明，第 2 步「上传 `cloudfunctions/` 下全部云函数」在缺字段时操作路径不成立 | ⚠️ 建议补 |
| `:116` 引用 `采购流程图.html` | 文件存在（311 行） | ✅ |

### 10.2 `log.md`（121 行）与 `review.md`（90 行）—— 已过期

- **版本号停在 17-15（2026-09-24）**，`log.md:61` 的 17-12 甚至标着「2026-03-21」而其余是 2026-09 → 时间线本身不连贯。
- **`log.md:87` 与 `review.md:69` 引用 `mock.js`**：`ls utils/` 只有 `auth-guard.js`、`cloud.js`、`meta.js`、`util.js` → **该文件已不存在**（`utils/mock.js` 被 `utils/cloud.js` 取代，README:3 明确写「页面业务数据只允许来自云函数，不做 Mock 成功降级」）。文档描述的「27 个商品全部增加 `manufacturerName`」现在落在 `seed-data/product.json`。
- `review.md` 只有 17-12 一轮（6 页面 + 1 数据文件的 UX 审查），**完全不覆盖** 17-13/14/15 以及之后全部安全加固、S9、B11/B12、报表域任何内容。
- 结论：`log.md`/`review.md` 是**开发期临时产物**，已不能作为交付依据；README 与业务模糊点清单才是现行文档。

### 10.3 `业务模糊点确认清单.md` —— 正文与索引表互相矛盾

**文档结构**：33 条目（#1–#24 + S1–S9，`:0` 为角色对照表）+ 两张索引表（`:729-739` 通用、`:741-793` 供货商/续表）+ 文末变更注记（`:796`）。

**4 处正文陈述已被代码超越（本轮新确认）**：

| 位置 | 文档说 | 代码实际 | 判定 |
|---|---|---|---|
| `:301` | 「`getReports/index.js:52-55` 的类型白名单与 `utils/meta.js:22-29` 的 `reportTypeMap` 均**未纳入**两个 summary 类型——报表能生成入库，但列表按类型筛选时会被排除、且无图标/文案标签」 | 白名单 8 项含两个汇总类（`getReports:68-72`）；`meta.js:39-40` 已有 label/iconClass/color | 🔴 **陈述已过期** |
| `:546` | 「但补结算是管理员手动触发，不是 resolve 自动触发——异常处理完成后系统不会主动补账，**也不会提醒管理员去补**」 | `dataService:791-794` 在 `resolveAbnormal` 内发 `title:'待补结算提醒'` 消息 | 🔴 **陈述已过期**（图 :155、README:36 均正确） |
| `:63` | 「`pages/receive-list/` 当前是**无入口死页面**」 | `pages/message/message.js:64` `wx.navigateTo({url:'/pages/receive-list/receive-list'})`；`app.json:12` 已注册 | 🔴 **陈述已过期** |
| `:723` | 「商品列表 200 条（`getProducts/index.js:24`）…全部无分页截断」 | 主控横向扫描已确认 `getProducts:53` / `getProductPrices:60` `.limit(200)` 静默截断 | ⚠️ 行号漂移（`:24`→`:53`），结论仍成立 |

**索引表与正文状态标记冲突（文档内部自相矛盾）**：

| 条目 | 正文标题 | 索引表 | 冲突 |
|---|---|---|---|
| #13 | `:525` `[已定]`（已被 S9 拍板覆盖） | `:786` `[待确认]` | 🔴 同一文档两处状态相反 |
| #15 | `:539` `[待确认]` | `:788` `[部分拍板]`（补结算提醒已实施） | 🔴 同一文档两处状态相反 |
| #8 | `:261` 已更新「取消仅管理员可发起」 | `:738` 仍写「店长/采购员可申请取消」 | 🔴 索引表滞后 |
| #9 | `:301` 说缺口存在 | `:774` 索引说「~~summary 报表被类型筛选排除~~ 已修复（2026-09-19）」 | 🔴 正文与索引表互相打脸 |

**行号漂移规模**：`createReceipt` 全线偏后约 40–70 行、`dataService` 大段漂移、`generateSummaryReport` 的清单引用（`:138`/`:134`/`:142-145`/`:198-215`）实际为 `:163`/`:160`/`:170-175`/`:226-255`。full-scan-08 §8.2 已判定「**结论没有一条被推翻，是引用失效**」，本轮复核一致。

### 10.4 过期陈述汇总（P0/P1 级）

| # | 文档 | 过期陈述 | 影响 |
|---|---|---|---|
| 1 | 清单 `:301` / 索引 `:774` | B11 summary 类型缺口 vs 已修复 | 正文与索引表互斥，读者无法判断真实状态 |
| 2 | 清单 `:546` | 「不会提醒管理员去补」 | 与 `dataService:791-794` 相反，#15 的拍板依据失效 |
| 3 | 清单 `:63` | `receive-list` 无入口死页面 | 实际是消息中心的收货记录入口，误判为废代码 |
| 4 | 清单 `:738` | 店长/采购员可申请取消 | 与 `:261` 及代码（`requestCancel:1334` 仅 GLOBAL_ROLES）矛盾 |
| 5 | 清单 `:525` vs `:786` | #13 `[已定]` vs `[待确认]` | 状态标记冲突 |
| 6 | 清单 `:539` vs `:788` | #15 `[待确认]` vs `[部分拍板]` | 状态标记冲突 |
| 7 | `log.md:87` / `review.md:69` | 引用已删除的 `mock.js` | 文档指向不存在的文件 |
| 8 | `README.md:49` | `.gitignore` 已生效 | 未告知对 14 个已追踪 seed 文件无效 |
| 9 | `README.md:107` | 部署第 2 步上传 `cloudfunctions/` | 缺 `cloudfunctionRoot` 时操作路径不成立 |

---

## 11. 业务模糊点清单状态盘点

**方法**：逐节扫 33 条目，对每条给出「① 代码已有明确实现（带行号）② 代码实现与清单选项不一致 ③ 至今悬空」。

### 计数

| 分类 | 条数 | 条目 |
|---|---|---|
| **① 代码已有明确实现** | **25** | #1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #14 #16 #17 #18 #19 #20 #21 #22 #23 #24、S1 S2 S5 S6 S7 S8 S9 |
| **② 代码实现与清单陈述不一致** | **7** | #1（`:63` 死页面说）、#8（索引 `:738`）、#9（`:301`）、#13（标记冲突）、#15（`:546` 提醒说）、#24（`:690-707` 说"无显式 is_manual 过滤"，实际已补）、S3（拍板被代码超越） |
| **③ 至今悬空** | **2** | #15 后半（责任人分工/SLA 时效/验收是否强制拍照）、S3（系统内通道保留还是收窄） |

（S3 与 #15 同时属于 ② 和 ③：既有已被代码超越的陈述，也有未回答的拍板问题。）

### ① 典型例（3 条）

- **#12-① 自单自审**：`dataService:493-498` `order.created_by` 与审核人 `user_id`/`_id` 匹配即拒绝。清单 `:497` 标注准确。
- **#17 离职账号软删除**：`authService:500-502` `deleteUser` → `setUserStatus({status:0})`，注释 `:498-499` 自述。清单 `:585`、README:17 一致。
- **#24 手动单隔离双保险**：`getSupplierOrders:70`、`getSupplierReceipts:53`、`createReceipt:582,662` 显式 `is_manual` 过滤。清单 `:694-696` 标注准确。

### ② 典型例（2 条）

- **#9 B11 缺口**：清单 `:301` 说「两个 summary 类型未纳入 `getReports` 白名单与 `meta.js`」，实际 `getReports:68-72` 与 `meta.js:39-40` 均已纳入；而同一文档 `:774` 索引表又说「~~summary 报表被类型筛选排除~~ 已修复（2026-09-19）」。→ **正文与索引表在同一文档里给出相反结论**，读者无法判断。
- **#15 补结算提醒**：清单 `:546` 说「不会主动补账，也不会提醒管理员去补」，实际 `dataService:791-794` 在 `resolveAbnormal` 内已发「待补结算提醒」消息，`采购流程图.html:155` 与 README:36 均正确记录。→ 清单正文漏了这轮实现。

### ③ 典型例（2 条）

- **#15 后半**：`业务模糊点确认清单.md:539-551` 明确列「异常由店长处理还是采购处理？closed 谁确认？要不要时效？验收要不要强制拍照？」。代码层全文 grep 无 `sla`/`timeout`/`deadline` 相关字段，`dataService` 异常处理的 3 个动作权限完全一致（均为 `['store_manager','purchaser','super_admin']`），验收照片非必填 → **四个问题全部悬空**。
- **S3 供货商消息通道**：`:369-381` 标 `[待确认]`，拍板原文是「不加系统内消息通道」，但代码已实装 `getMessages` supplier 分支 + `notifySuppliersNewOrder` + `supplier-home.js:50-69` + `supplier-messages` 页（`app.json:28`）。**拍板结论已被后续迭代超越，需业务方重新确认保留还是收窄。**

### 与 full-scan-08 §8.2 的对照

full-scan-08 判「4 类漂移、无结论被推翻」，本轮补出第 5 类：**文档内部正文与索引表互相矛盾**（#13/#15/#8/#9 四条），这是 full-scan-08 未覆盖的维度——它只比对了「文档 vs 代码」，没比对「文档 vs 文档自己」。

---

## 12. 采购流程图 vs 代码流程差异

`采购流程图.html`（311 行，4 泳道：门店 / 管理员 / 供货商 / 系统；标称「2026-09-28 · 含 S1–S9 及 #1–#24 全部拍板」）。full-scan-08 §8.2.5 判它是「本次扫描中唯一保持与代码同步的文档」。本轮按节点逐个对照后，**该结论大体成立但需修正 3 点**：

### 12.1 图有码无

| 图节点 | 位置 | 判定 |
|---|---|---|
| 「⑥ 异常补结算」画成独立第 6 类报表 | `:273` | ⚠️ **图与代码编号体系错位**：代码 ①–⑥ 是 6 类单据报表（store_order / supplier_order / store_receipt / store_receipt_price / supplier_receipt / supplier_receipt_price），图把「汇总」标 ⑤、把「补结算」标 ⑥，而补结算实际是 `dataService.settleReceipt` **复用 ③④⑤⑥ 四类带 `_S` 后缀重出**（`dataService:973,1164,1191,1224,1251`），不是新类型。图 7 个编号节点 vs 代码 8 类 type，**编号无法对齐** |
| 「逆错」异常类型 | `:99` | 🔴 **错别字**：应为「错货」。代码字典是 `wrong_item: '错货'`，`meta.js` 无「逆错」值 |

### 12.2 码有图无

| 代码实体 | 位置 | 说明 |
|---|---|---|
| 报表读取侧全链路 | `report-list` / `report-history` / `report-detail` / `getReports` / `getReportDetail` / `getReportFileUrl` | 图只画生成侧（系统泳道 :234-287），**完全没画「谁看报表、怎么下载、CSV 长什么样」** → 本轮 §3–§5 发现的全部问题（tab 缺类、CSV 打不开、归档 vs 实时不同源）在图上无任何对应节点 |
| `report-history` 8 类精确筛 | `report-history.js:29-34` | 唯一能筛全 8 类的入口，图上无 |
| 门店切换 / 多门店语义 | `store-switch`、`currentStore` | 影响 §6.2 与 §0.3（汇总只能对当前门店生成） |
| `importProducts` Excel 批量导入 | 云函数 | 图上无 |
| 消息中心双向互跳缺失 | — | 图上画了消息节点但没画「消息 → 单据」的可跳转性 |

### 12.3 顺序不一致

无。图内 4 条泳道的节点顺序（门店：创建→提交→跟踪→收货→凭证；管理员：审批→改量重发→异常处理→作废→核销；供货商：通知→查看→确认→发货；系统：①–⑦）与代码状态机一致。状态流转图例（`:293-307`）的 13 个中文状态词全部能对应到 `meta.js:1-19` 的字面量。

### 12.4 正面事实

图的**拍板引用密度极高且准确**：`#12`(×6)、`#14`、`#15`(×2)、`#16`(×6)、`#21`、`#24`(×3)、`S1`(×3)、时间戳 `2026-09-28`(×3)，「手动商品」11 次、「凭证核销」6 次、「部分收货」4 次、「补结算」4 次。图内嵌的 `:232` 系统泳道说明「失败自动打标待补生成，管理员可补生成（补生成不再清空供货商确认）」与 `dataService` 的 `qtyChanged` 参数一致。**它比 `业务模糊点确认清单.md` 更可信**（后者正文有 4 处过期陈述 + 4 处自相矛盾）。

**建议**：以 `采购流程图.html` 为基准重写清单的状态与行号章节；补「报表读取侧」泳道；把 ⑤/⑥ 编号改回与代码 8 类对齐；修正「逆错」错别字。

---

## 13. 旧结论复核表 + 【待核实】回收表

### 13.1 旧结论复核（报表相关，逐条判定）

| 旧结论 | 出处 | 本轮判定 | 本轮行号 |
|---|---|---|---|
| H1 店长汇总入口被前端拦截，注释与实现矛盾 | 06 §H1 | **仍成立** | `report-list.js:126-131` vs `generateSummaryReport:160-161,170-175`。事实 4 的归一化只动 `:42/:69-70/:145`，`:126` 注释未变 |
| H2 CSV + `openDocument` 无 `fileType` | 03 §H4 / 06 §H2 | **仍成立** | `report-detail.js:103-108`；14 处产出全 `.csv` |
| H3 读取侧粒度与生成侧冲突 | 03 §H1 / 06 §H3 | **仍成立** | `getReportDetail:133-136,164-167`（`limit(200)` 无分页）、`:131-132/:162-163` 不用 `source_order_id` |
| H3 续 分批收货 `.limit(1)` 无 `orderBy` | 03 §H3 | **仍成立** | `getReportDetail:100-103` 门店收货报表取任意一批次 |
| M1 空页无终止条件 | 06 §M1 | **仍成立** | `report-list.js:98`、`report-history.js:82` |
| M2 无并发守卫 | 06 §M2 | **仍成立** | 两页 `onReachBottom` 不 await `loadReports` |
| M3 report-history 筛选对门店角色是空操作 | 06 §M3 | **仍成立** | `report-history.js:20-24,29-34,63` vs `getReports:79-86` |
| M4 失败态缺失卡「加载中」 | 06 §M4 | **仍成立** | `report-detail.js:70-72`、`wxml:142-144` |
| M5 导出无 loading/无防重入 | 06 §M5 | **仍成立** | `report-detail.js:89-118` |
| M6 列表无加载态 | 06 §M6 | **仍成立** | 两页 `data` 无 `isLoading` |
| M7 两页功能重叠互有缺口 | 06 §M7 | **仍成立并加重** | §7 已确认同源同排序；补出「无次要键→顺序也不确定」 |
| M8 异常标记三页口径不一 | 06 §M8 | **仍成立** | 写入仅 5 处（`createReceipt:572,605,654`、`dataService:1167,1227`），缺 `createReceipt:689` 与汇总类 |
| M9 金额三层口径 + 4 类无合计 | 06 §M9 | **仍成立** | `report-detail.js:53-59`、`getReportDetail:118,189,241` |
| M10 异常与报表无关联键 | 06 §M10 | **仍成立** | `dataService:718-730` 丢弃 `receipt_id`/`purchase_order_id` |
| M12 汇总依赖全局 currentStore + 只能今天 | 06 §M12 | **仍成立** | `report-list.js:136-146`；`currentStore` 写入仅 `login.js:98`、`store-switch.js:38` |
| L1 返回丢分页位置 | 06 §L1 | **仍成立** | 两页 `reload:35-38/49-52` |
| L2 死字段 `item.qty` | 06 §L2 | **仍成立** | `wxml:111`、`wxml:88`；`getReportDetail` 从不产出 `qty` |
| L3 `.empty-hint` 样式缺失 | 06 §L3 | **仍成立** | `wxml:143`；`report-detail.wxss`（118 行）无此选择器 |
| L4 `getReports` 死参 `role`/`storeId` | 06 §L4 | **仍成立** | `getReports:43` 解构后 0 使用 |
| L5 手动行明细页无标识 | 06 §L5 | **仍成立** | `getReportDetail:95-96` 返回 `isManual`，`wxml:34-39` 不展示 |
| L6 服务端合计已到前端未使用 | 06 §L6 | **仍成立** | `getReportDetail:252` 展开 `total_amount`，`js`/`wxml` 均未读 |
| L7 月汇总 `related_date` 存当天 | 06 §L7 | **仍成立** | `generateSummaryReport:227` |
| L8 report-detail 无 `onShow` | 06 §L8 | **仍成立** | `report-detail.js` 无 `onShow` |
| L9 生成中会话过期双 toast | 06 §L9 | **仍成立** | `report-list.js:147-150` vs `cloud.js:68-70` |
| L10 report-list.js 未提交改动 | 06 §L10 | **结案** | 与主控事实 4 一致：纯语法归一化，4 分支逐值等价 |
| 06 §7-2「图标类名全部存在」 | 06 §1.5 | **行号漂移 + 结论需修正** | 86/87 项由脚本生成；`icon-truck-grey` **只有产物没有源码**（§8.2） |
| `full-scan-03` L2 排序无次要键 | 03 §L2 | **仍成立并加重** | `getReports:93` 仅 `orderBy('generated_at','desc')` |
| `full-scan-08` §7.2 缺 `cloudfunctionRoot` | 08 §7.2 | **仍成立并加重** | 本轮补出体积影响（§9.4，估算主包 ~2.4MB 超限） |
| `full-scan-08` §7.4 `.gitignore` 矛盾 | 08 §7.4 | **仍成立并补新对象** | `git check-ignore` 实测 NOT IGNORED；本轮补出 `docs/`（~1052KB）同样不受约束 |
| `full-scan-08` §8.2.5 流程图是唯一同步文档 | 08 §8.2.5 | **需修正** | 见 §12.1：编号错位、错别字、读取侧整段缺失 |

**无一条旧结论被推翻。行号漂移集中在 `createReceipt`（+40~70 行）、`generateSummaryReport`（清单引用整体偏前 30~60 行）。**

### 13.2 旧【待核实】回收表

| # | 来源 | 问题 | 本轮定论 |
|---|---|---|---|
| 1 | 06 §7-2 | 供应商报表正确粒度 | **已闭环**：产品口径应为「每单一份」= 生成侧；读取侧需改（R5 已定） |
| 2 | 06 §7-4 | 店长是否应能生成汇总 | **已闭环（结论已定，修复未做）**：后端明确允许且有店长专属分支（`generateSummaryReport:170-175`），前端 `:128` 拦截是缺陷不是设计 → 改前端 |
| 3 | 06 §7-5 | `report_file` 有删除逻辑吗 | **已闭环**：全项目 0 处删除（主控事实 10）→ M1 死循环不会因删除触发 |
| 4 | 06 §7-6 | chef/store_manager 是否需要历史报表页 | **已闭环**：不需要。`getReports:54/59` 对未关联门店返回 403，而 report-history 无角色收敛 → 应加门禁而非保留 |
| 5 | 06 §7-8 | `dataService` 嵌套 401 影响报表页 | **已闭环**：报表 4 个云函数全顶层扁平 `{code,msg}`（§3.1），`cloud.js:68` 能命中 → **报表 3 页不受 F1 影响**。但 `report-list` 若未来调 `dataService` 会踩坑 |
| 6 | 06 §7-9 | 月汇总 `related_date` 存哪天 | **已闭环（工程侧）**：存点击日是注释自述（`:227`），属设计缺陷非待确认 |
| 7 | 06 §7-10 | `excluded_rows` 是否应展示 | **仍悬空**（产品决策，非代码问题） |
| 8 | 06 §7-11 | `-401` 只查顶层 | **已闭环**：报表页 4 函数扁平，不受影响 |
| 9 | 03 批 §1.4 | 云开发环境是否允许自动建集合 | **仍待核实**（需实测，`report_version_counter` 首次生成报表的行为） |
| 10 | 03 §H4 | `openDocument` 对 CSV 的真实返回码 | **仍待核实（真机）**，推断见 §5.2 |
| 11 | 08 待核实-4 | `priceReportsSkipped: hasAbnormal` 是否被前端消费 | **已闭环**：全项目仅 `createReceipt:736` 写入，**前端 0 消费**（主控事实 11 成立） |
| 12 | 08 待核实-6 | `getReportDetail:12-16` 字典缺 `missing_price` | **已闭环（且更严重）**：`receipt_item` 根本没有 `is_missing_price` 字段（主控事实 14.3），补字典也无法修复，必须 join `abnormal_record` |
| 13 | 08 待核实-7 | 有前端以空 fileId 调 `getReportFileUrl` 吗 | **已闭环**：`report-detail.js:91` 有 `report.fileUrl \|\| report.file_url` 前置守卫；种子 11 条 `file_url` 全空 → 走 `:116`「该报表尚未生成可下载文件」，**不会误传空串** |
| 14 | R5 §9-1 | `openDocument` 对 CSV 的真实行为 | **未闭环（真机）** |
| 15 | R5 §9-2 | 云存储权限模型是否允许任意 fileID 换取 | **未闭环（需控制台实测）** |
| 16 | R5 §9-3 | `report_version_counter` 是否已预建 | **未闭环（需实测）** |
| 17 | R5 §9-4 | 归档「每单一份」vs 读取「按日聚合」产品拍板 | **未闭环（业务决策）** |
| 18 | R5 §9-5 | `order_qty` 就地覆写是否为预期 | **未闭环（业务决策）** |
| 19 | 08 §5.4 | 清单与代码的两处文档漂移 | **已闭环**，本轮扩为 9 条（§10.4） |
| 20 | 08 待核实-1/2 | `report_generated`/`pending_approval` 等历史状态 | **仍待核实**（需 `git log -p`） |
| 21 | 08 待核实-3 | PO20260806001 混单是漏改还是保留 | **仍待核实** |
| 22 | 08 待核实-5 | `setUserStatus` 不清 `sessions` 是否有意 | **仍待核实（业务）** |
| 23 | 08 待核实-9/10/11/12 | `receipt_abnormal` 出入边 / S9 升级路径 / `verify_status` 驱动方 / `supplier_confirmations` 作废不清 | **仍待核实（业务）** |

**统计：23 项 → 闭环 13 项、真机/控制台实测 3 项、业务决策 5 项、需 git 历史 2 项、其他悬空 3 项。**

---

## 14. 新问题清单

### P1

**N1｜汇总报表空跑不拦截 → 空报表永久累积**
`cloudfunctions/generateSummaryReport/index.js:183-224` 无 `rows.length === 0` 守卫。门店当期无收货（或全部为手动行，`:191` `if (item.is_manual) return` 全部跳过）时，仍执行：`:228` `getNextVersion`（版本号白烧）→ `:219-224` 组装仅 3 行 CSV（门店头 + 表头 + `合计,,,,,,0.00`）→ `:232-235` 上传 → `:237-255` 落 `report_file` → `:257-265` 返回 `code:0, itemCount:0`。
前端 `report-list.js:148-153` 只看 `code`，显示「汇总报表已生成」并 `reload()`。
叠加主控事实 10（全项目 0 处 `report_file` 删除）→ 空报表只能永久堆积，版本号单调递增，列表里出现「门店日汇总 v3 · ¥0.00」这类无法辨识的记录。
**建议**：`:186` 后加 `if (rows.length === 0) return { code: -1, msg: '该门店当期无收货记录，未生成报表' }`（在 `getNextVersion` **之前**，避免白烧版本号）。

**N2｜`icon-truck-grey` 源失同步 → 重跑生成脚本即毁伤**
`styles/icons.wxss:61` 定义了 `.icon-truck-grey`，`scripts/build-icons.js:108-110` 的 truck 只有 `primary/teal/white`（VARIANTS 实测 87 项，wxss 实际 88 个变体类，双向 diff 唯一差异就是它）。
引用点 `pages/report-list/report-list.wxml:16` 动态拼接 + `report-list.js:60` `iconBase:'truck'`。
当前运行时正常；一旦有人按脚本头注释（`:3-4`「新增图标…重新运行即可」）执行 `node scripts/build-icons.js`，该类被删，「供应商到货」tab 未选中态渲染成 32×32 空白方块。
**建议**：VARIANTS 补 `['truck', 'grey']` 后重跑；或在 `build-icons.js` 末尾加自检（对比磁盘 wxss，报差异）。

**N3｜报表类型在两个页面的可达能力不对等（R5 N1 的前端侧补强）**
`report-list.js:55-62` admin 分支只有 6 个 tab（缺 `store_daily_summary_report`/`store_monthly_summary_report`），而 `report-history.js:29-34` 从 `Object.keys(meta.reportTypeMap)` 派生 8 种全暴露。
生成入口在 A 页（`:125`），A 页刷新后新汇总只能落在「全部」tab 里翻；B 页能精确筛到但只能从 A 页进。
叠加 N1（空汇总也能生成）→ 管理员会看到「全部」里堆积的同日多版本汇总，且无法按类型定位。
**建议**：A 页 admin 分支补 2 个汇总 tab；或合并两页。

**N4｜`report-history` 副标题数字恒错**
`pages/report-history/report-history.wxml:5`「共 {{reports.length}} 份报表」绑定的是**当前已加载页**的数组长度（`PAGE_SIZE=20`）。`report-history.js:81` `const total = Number(result.total) || 0` 取到服务端总数后只用于 `:82` 算 `hasMore`，**从未 `setData`**。
后果：任何超过 20 条报表的账号，副标题永远显示「共 20 份报表」；少于 20 条时正确。**统计类文案给出确定错误的数字**，比不显示更糟。
`report-list.wxml` 无此文案，故只有历史报表页受影响。
**建议**：`setData({ total })` 并改 `wxml:5` 为 `共 {{total}} 份`；或删掉该副标题。

### P2

**N5｜汇总报表明细 `wx:key="productName"` 撞键**
`pages/report-detail/report-detail.wxml:125`；聚合键是 `supplier_id|product_id`（`generateSummaryReport:196-197`）→ 同商品多供应商必产生同名 `productName` 行（这正是 `:187` 注释「同一商品多供应商时分行体现」想要的效果）。
小程序重复 `wx:key` 会告警并可能错行渲染/丢行。其他 5 段分支都用 `wx:key="index"`（`wxml:34,50,67,84,108`），只有这一段用了字段键。
**建议**：改为 `wx:key="index"`，或与 `supplierName` 拼成复合键。

**N6｜`generateSummaryReport` 返回体 4 字段前端全丢**
`generateSummaryReport:257-265` 返回 `data:{fileID, fileName, totalAmount, itemCount}`，`report-list.js:148-153` 只判 `result.code` 后 toast「汇总报表已生成」+ `reload()`，**4 个字段一个没用**；且返回体**不含 `report_id`** → 生成后无法直跳新报表。
**建议**：返回补 `reportId`，前端提示改成「已生成，合计 ¥{{totalAmount}}，共 {{itemCount}} 行」并支持直跳详情；`itemCount===0` 时按 N1 拦截。

**N7｜`getReports` 排序无次要键 → 翻页边界不稳定**
`getReports:93` 仅 `orderBy('generated_at','desc')`。`createReceipt` 一次事务外连发 4 张报表、`createPurchaseOrder` 连发 2 张 → 同毫秒 `generated_at` 的多条记录顺序未定义，分页时可能重复或整张丢失。两个列表页各自翻页可能看到不同排列。
**建议**：加 `orderBy('_id','desc')` 作为次要键。

**N8｜`relatedDate` 校验严格度两端不一致**
`getReports:47` 只正则 `^\d{4}-\d{2}-\d{2}$` → 放行 `2026-02-31`；`generateSummaryReport:72-76` 用 `isDate`（`toISOString()` 回写比对）→ 拒绝非法日历日。同一字段两个函数强度不同，筛选时能选到一个数据库里不存在的日期，静默返回空列表。
**建议**：`getReports` 复用同一 `isDate`。

**N9｜`report-detail` 失败态与未知类型共用「加载中」**
`report-detail.js:70-72` 失败仅 `util.showToast('加载失败')`（**丢弃服务端 msg**，如「报表不存在」/「无权查看」），页面 `typeLabel=''`、`report={}`；`wxml:142-144` `wx:else` 永久显示「报表数据加载中...」。
触发路径：报表不存在、`-403` 越权、汇总报表 CSV 解析抛错（`getReportDetail:244-248` → 外层 `:253-255` 返回 `-1`）、`store_order_report` 缺 `source_order_id`（`getReportDetail:84` 不进分支 → `rows=[]`）。
**建议**：加 `loadState: 'loading'|'error'|'empty'`，错误态展示服务端 msg + 重试；空 rows 显示「无明细」。

**N10｜报表 3 页 wxss 两套风格并存 + 3 组同名类重复定义**
`report-list.wxss`（127 行）与 `report-detail.wxss`（118 行）硬编码色值，`report-history.wxss`（27 行）全走 `var(--*)`。
`.report-meta`（`report-list.wxss:91-96` vs `report-history.wxss:25`）、`.report-version`（`:83-89` vs `:26`）语义与样式均不同。
小程序 wxss 页级作用域 → **功能无影响**，但改主题色时 report-history 自动跟随、另两页要手改；复制样式时易拿错。
**建议**：两页统一改走 CSS 变量。

**N11｜`report-history` 无角色收敛，越权筛选静默失败**
`report-history.js:29-34` 无条件暴露全 8 类；`filterScope` 对 chef/store_manager 被 `getReports:79-86` 强制改回 store。chef 选「供应商账单」→ 空列表且无任何解释。
**建议**：按 `userInfo.role` 收敛两个 picker 的选项，或选到越权项时提示。

### P0

**无新增 P0。** 已记的最高危项（CSV 导出必然失败、归档详情与归档文件不同源、dataService 嵌套 401 吞错误）本轮全部复核仍成立，但未出现更严重的问题。主控横向扫描的 P0 明文口令问题根因在本轮定位到 `.gitignore` 对已追踪文件无效（§9.3）。

---

## 15. 遗留【待核实】

1. **`wx.openDocument` 对 `.csv` + 无 `fileType` 在基础库 3.17.1 的确切返回码**（沿用 R5 §9-1）：决定 H2 修复文案兜底是「暂不支持打开该格式」还是直接切 xlsx。推断见 §5.2（倾向必然 `fail`）。需真机实测。
2. **云存储权限模型**：控制台「存储安全规则」是否允许「任意 fileID 换取临时链接」。若允许，任何拿到报表 fileID 的用户可绕过 `getReportFileUrl:46-54` 的二次校验直接下载；而 fileID 会通过 `getReports:91-96` 下发给合法查看者。需控制台实测。
3. **`report_version_counter` 是否已在目标环境预建**：决定 `getNextVersion`（`generateSummaryReport:53-70`）首次调用是否抛错并被 `:266-269` 吞成通用 `-1`。README:111 已自知。
4. **归档「每单一份」vs 读取「按日聚合」的产品拍板**（沿用 R5 §9-4）：决定 H3 改读取侧（加 `source_order_id` 收敛）还是改生成侧（新建聚合类 type）。
5. **`order_qty` 就地覆写是否为预期**（沿用 R5 §9-5）：`dataService:544-547` 同时写 `order_qty` 与 `approved_qty` 两者恒等 → `order_qty` 语义从「申请量」漂移为「批准量」，决定 N3 类问题的可修复性。
6. **`excluded_rows`（`createReceipt:606,689`）是否应在 report-detail 展示**：涉及 H3/M9 的可解释性——被剔除的行数用户在详情页看不到，无法解释「为什么 CSV 比表格少几行」。
7. **`ignoreDevUnusedFiles:true` 对无人引用的 `.md`/`.json` 是否剪枝**：决定 §9.4 估算的 ~1620KB 非运行时文件是否会实际入包，即主包是否真的超 2MB。需开发者工具构建日志实测。
8. **历史状态 `report_generated`/`pending_approval`/`to_receive`/`completed` 的写入点是否已被重构掉**（沿用 08 待核实-1/2）：需 `git log -p`。

---

**本轮工作量**：全读 31 个文件 4074 行（报表 3 页 12 文件 943 行 / 基建 7 文件 483 行 / 文档 5 文件 1438 行 / 交叉参照 7 文件 1210 行）+ 4 份前置文档（controller 10-04 全文、R5 全文、full-scan-06 全文、full-scan-08 分节 + full-scan-03 分节）。新发现 P1 四项（N1 空跑不拦截、N2 图标源失同步、N3 两页能力不对等、N4 副标题数字恒错）、P2 七项（N5–N11）、P0 零项。旧【待核实】23 项 → 闭环 13 项。旧结论复核 30 条：无一被推翻，行号漂移集中在 `createReceipt`（+40~70 行）与 `generateSummaryReport`（清单引用偏前 30~60 行）。文档与代码脱节 9 条，其中 4 条为同一文档内部正文与索引表互相矛盾（新增维度，full-scan-08 未覆盖）。
