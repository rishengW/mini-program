# 全量扫描 06：报表 3 页 + 异常列表（16 文件）

范围：`pages/report-list/`、`pages/report-history/`、`pages/report-detail/`（各 4 文件全读），
`pages/abnormal-list/`（4 文件，只读参考，用于异常口径交叉核对）。
参考基线：`utils/cloud.js`（callFunction / normalizeReport / formatDateTime）、`utils/auth-guard.js`、
`utils/meta.js`（reportTypeMap / getReportTypeInfo）、`utils/util.js`。
已对齐不重复：`batch1-cloudfunctions-data.md` §4.9/§5.6（报表生成与异常链）、
`batch2-purchase-flow.md` §3（abnormal-list 交互细节）、`controller-horizontal-scan.md` F1/F9。

---

## 0. 文件覆盖清单（16 个）

| # | 路径 | 行数 | 一句话职责 |
|---|---|---|---|
| 1 | `pages/report-list/report-list.js` | 163 | tabBar「报表」页：按角色出类型 tab + 日期筛选 + 分页拉 `getReports` + 生成汇总入口 |
| 2 | `pages/report-list/report-list.wxml` | 63 | 报表卡片列表（类型徽标/异常标签/已作废/版本/作用域/日期）+ 空态 |
| 3 | `pages/report-list/report-list.wxss` | 127 | tab 胶囊、日期筛选、卡片与徽标样式（含 8 位 hex 透明色） |
| 4 | `pages/report-list/report-list.json` | 4 | 标题「报表中心」+ `enablePullDownRefresh:true` |
| 5 | `pages/report-history/report-history.js` | 115 | 历史报表页：作用域/类型/日期三筛选 + 分页拉同一 `getReports` |
| 6 | `pages/report-history/report-history.wxml` | 43 | 紧凑列表行（图标/名称+已作废/作用域·日期/版本·生成时间）+ 空态 |
| 7 | `pages/report-history/report-history.wxss` | 27 | 走 `var(--color-*)` 设计变量的筛选器与列表行样式 |
| 8 | `pages/report-history/report-history.json` | 5 | 标题「历史报表」+ `enablePullDownRefresh:true` |
| 9 | `pages/report-detail/report-detail.js` | 119 | 拉 `getReportDetail`，按 `reportType` 归一化字段、反推异常、算合计、导出文件 |
| 10 | `pages/report-detail/report-detail.wxml` | 156 | 6 段按类型分支的表格 + 关联采购单跳转 + 导出按钮 |
| 11 | `pages/report-detail/report-detail.wxss` | 118 | 表头/行/合计/异常横幅/列宽（`col-*` flex 权重） |
| 12 | `pages/report-detail/report-detail.json` | 3 | 仅标题「报表详情」，无下拉刷新 |
| 13 | `pages/abnormal-list/abnormal-list.js` | 110 | 拉 `dataService.getAbnormalRecords` + 本地状态筛选 + 三个状态流转动作 |
| 14 | `pages/abnormal-list/abnormal-list.wxml` | 57 | 状态页签 + 异常卡（类型圆点/状态标签/描述/处理结果/操作）+ 空态 |
| 15 | `pages/abnormal-list/abnormal-list.wxss` | 73 | 页签、卡片、四种类型圆点色（未知类型落回灰） |
| 16 | `pages/abnormal-list/abnormal-list.json` | 2 | 仅标题「异常记录」，无下拉刷新 |

工作区状态：`report-list.js` 有未提交改动，`git diff` 仅 4 处 `?.` → `&&`（`:42`、`:69-70`、`:145`），
无逻辑变化；本报告以磁盘当前内容为准。

---

## 1. `pages/report-list/`（报表中心，tabBar 第 3 页）

### 1.1 职责与生命周期
- `onShow`（`js:20-24`）：`authGuard.requireLogin()` → `initTabs()` → `reload()`。
  本页是 tabBar 页（`app.json:56`），**每次切回都会全量重拉第 1 页**。
- `onPullDownRefresh`（`:26-28`）：`reload().finally(stopPullDownRefresh)` ✅。
- `onReachBottom`（`:30-33`）：`isLoadingMore || !hasMore` 双守卫，然后 `loadReports(page+1, true)`。
- `onLoad` **未定义**（首次进入靠 `onShow`），无 `onHide`/`onUnload`。

### 1.2 云函数调用
| 调用点 | 函数/action | 入参 | 入参来源 |
|---|---|---|---|
| `js:73-80` | `getReports` | `role, storeId, reportType, relatedDate, page, pageSize:20` | `role`←`globalData.userInfo.role`（默认 `'purchaser'`）；`storeId`←`globalData.currentStore.storeId`；`reportType`←tab（`'all'`→`''`）；`relatedDate`←日期筛选 |
| `js:142-146` | `generateSummaryReport` | `period, date, storeId` | `period`←ActionSheet 0/1 → `'daily'/'monthly'`；`date`←**固定今天**（`:136-139`）；`storeId`←全局 `currentStore` |

注意：`getReports` 服务端**完全不用** `role`/`storeId`（`getReports/index.js:43` 解构后未引用），
权限一律按会话 user 收敛（`:50-66`）。前端这两个入参是死参数（见 L4）。

### 1.3 tab 按角色收敛（`initTabs`，`js:40-65`）
- `chef` → 仅 `store_order_report`；`store_manager` → 3 种门店报表；其它（含 admin）→ 6 种。
- **admin 的 6 种里没有 `store_daily_summary_report` / `store_monthly_summary_report`**（`:55-62`），
  与 `generateSummary` 能生成的类型不匹配（见 M7）。
- 与 `getReports` 的角色收敛（`getReports:50-66`）一致 ✅。

### 1.4 data 字段 × wxml 引用对照（`js:10-18`）
| wxml 引用 | 赋值来源 | 状态 |
|---|---|---|
| `typeTabs` / `item.value,label,iconBase` | `js:64` `initTabs` | ✅ |
| `activeType` | `js:11` data、`js:106` switchType | ✅ |
| `filterDate` | `js:12` data、`js:111` onDateFilter | ✅ |
| `reports[].reportId,reportScope,scopeName,relatedDate,generatedAt,fileVersion` | `cloud.normalizeReport`（`cloud.js:212-225`） | ✅ |
| `reports[].typeLabel,typeIconClass,typeColor` | `js:91-93` ← `meta.getReportTypeInfo` | ✅ |
| `reports[].hasAbnormal` | `js:88` ← DB `has_abnormal`/`hasAbnormal` | ✅（但口径见 M8） |
| `reports[].abnormalLabel` | `js:90` 前端拼接 `收货异常 · ${abnormalSummary}` | ✅ |
| `reports[].status`（`wxml:41` 判 `'superseded'`） | DB `status`：写 `'generated'`（`createPurchaseOrder:418`、`createReceipt:653,688`、`generateSummaryReport:251`），写 `'superseded'`（`dataService:416,1318`） | ✅ 会被赋值 |
| `reports.length`（空态 `wxml:59`） | `js:98` | ✅ |

**「wxml 用但从未赋值」的字段：无。**
反向：`js` 有赋值但 wxml 未用的 —— `isLoadingMore`（无 UI 展示）、`page`、`hasMore`。

### 1.5 事件绑定 × js 方法对照
| wxml 绑定 | js 方法 | 匹配 |
|---|---|---|
| `wxml:6` `bindtap="generateSummary"` | `js:125` | ✅ |
| `wxml:7` `bindtap="goHistory"` | `js:120` | ✅ |
| `wxml:15` `bindtap="switchType"` `data-value` | `js:105` | ✅ |
| `wxml:24` `bindchange="onDateFilter"` | `js:110` | ✅ |
| `wxml:30` `bindtap="clearDateFilter"` | `js:115` | ✅ |
| `wxml:34` `bindtap="goDetail"` `data-id` | `js:158` | ✅ |

**21 处绑定 / 13 个方法，全项目 0 处对不上。** 无孤儿 handler。
图标类名 `icon-{chart,clipboard,package,tag,factory,truck}-{white,grey}` 全部在 `styles/icons.wxss` 存在 ✅。

### 1.6 生成报表交互链路
`generateSummary`（`js:125-156`）：
1. 前端硬编码门禁 `['super_admin','purchaser']`（`:128`）→ 其它角色 toast「仅管理员可生成汇总报表」并 return。
2. `wx.showActionSheet` 选日/月 → `util.showLoading('生成中...')`（`util.js:72-74`，`mask:true`）。
3. `await callFunction` → `wx.hideLoading()`（先 hide 后 toast，顺序正确）。
4. 失败：`util.showToast(result.msg || '汇总报表生成失败')`（`:148-150`）→ **不刷新、不重试入口**。
5. 成功：`util.showSuccess('汇总报表已生成')` → `that.reload()`（`:152-153`）。

链路缺口：
- **请求在飞时无法退出**：`showLoading({mask:true})` 阻断点击，因此「生成中离开页面再回来」在本页
  几乎不可触发；`that.reload()` 只在 resolve 后调用，`setData on destroyed` 风险低（`that` 是闭包引用）。
  但若此时会话已过期（`-401`），`callFunction` 内部已 `reLaunch` 登录页（`cloud.js:68-70`），
  紧接着 `hideLoading` + `showToast` 在即将销毁的页面上执行，用户会同时看到「登录已过期」和「汇总报表生成失败」两条 toast。
- **成功后无新报表定位**，且若当前不在「全部」tab，新汇总报表不可见（`:153` 用当前 `activeType` 刷新）。
- **`date` 永远取今天**（`:136-139`），无补历史日期能力；管理员无法在页内选门店（见 M12）。

---

## 2. `pages/report-history/`（历史报表）

### 2.1 职责与生命周期
- `onShow`（`js:27-38`）：`requireLogin()` → 重建 `reportTypeOptions`（**全 8 种，不分角色**）→ 回填 `filterTypeLabel` → `reload()`。
- `onPullDownRefresh`（`:40-42`）✅；`onReachBottom`（`:44-47`）双守卫 ✅；无 `onLoad`。
- **唯一入口**：`report-list.js:120-122`（全项目仅此一处 `navigateTo`），非 tabBar 页 → 从详情页返回必然丢分页（L1）。

### 2.2 云函数调用
`js:60-68` → `getReports`，入参 `role, storeId, reportScope, reportType, relatedDate, page, pageSize:20`。
`reportScope`←作用域 picker（`'all'`→`''`）；`reportType`←类型 picker 原始 value。

**服务端对 `reportScope` 的使用是角色敏感的**：`getReports:46` 校验合法性，但
`:63` 只在 `purchaser/super_admin` 分支下写 `query.report_scope`；chef/store_manager 在
`:52-60` 与 `:79-86` 被强制 `report_scope='store'`。→ 见 M3。

### 2.3 data 字段 × wxml 引用对照（`js:10-24`）
| wxml 引用 | 赋值来源 | 状态 |
|---|---|---|
| `scopeOptions` / `filterScope` | `js:20-24` data、`js:91` onScopeChange | ✅ |
| `reportTypeOptions` / `filterTypeLabel` | `js:29-36`、`js:97` | ✅ |
| `filterDate` | `js:15` data、`js:102` | ✅ |
| `reports[].reportId,typeLabel,typeIconClass,typeColor,scopeName,relatedDate,fileVersion,generatedAt` | `js:71-79` + `normalizeReport` | ✅ |
| `reports[].status`（`wxml:31`） | 同 report-list | ✅ |
| `reports.length`（空态 `wxml:39`） | `js:82` | ✅ |

**「wxml 用但从未赋值」的字段：无。**
**但本页 `map` 里不计算 `hasAbnormal`/`abnormalLabel`，wxml 也不显示** → 同一份报表在
「报表中心」有红色异常标签、在「历史报表」没有（M8）。

### 2.4 事件绑定 × js 方法对照
| wxml 绑定 | js 方法 | 匹配 |
|---|---|---|
| `wxml:11` `bindchange="onScopeChange"` | `js:89` | ✅ |
| `wxml:14` `bindchange="onTypeChange"` | `js:95` | ✅ |
| `wxml:19` `bindchange="onDateChange"` | `js:101` | ✅ |
| `wxml:22` `bindtap="clearDate"` | `js:106` | ✅ |
| `wxml:27` `bindtap="goDetail"` `data-id` | `js:111` | ✅ |

**0 处对不上，无孤儿 handler。**

### 2.5 三态与分页
- 空态 ✅（`wxml:39-42`）；**无加载态**（`js:10-24` 无 `isLoading`）→ 首屏先闪「暂无报表」；
  失败只有 toast（`:84-85`），无失败视图。
- 分页与 report-list 完全同构 → M1/M2 两个缺陷本页同样存在。
- 下拉刷新 `reload()` 重置 `page=1, hasMore=true` ✅（分页被正确重置）。

---

## 3. `pages/report-detail/`（报表详情）

### 3.1 职责与生命周期
- `onLoad`（`js:18-73`）：`requireLogin()` → `options.id` → `util.showLoading('加载报表...')` →
  `getReportDetail({reportId})` → `hideLoading()` → 归一化 + 反推异常 + 算合计 + 一次性 `setData`。
- **无 `onShow`**：从 `goSourceOrder`/`goRowOrder` 跳回时不重拉（报表被 regenerate/supersede 后页面保持旧值）。
- 无下拉刷新（`json:3`）。

### 3.2 云函数调用
| 调用点 | 函数 | 入参 | 返回消费 |
|---|---|---|---|
| `js:24-26` | `getReportDetail` | `{reportId}` ← `options.id` | `result.data` → 展开为 `report`（snake_case 双写归一化 `js:32-44`）+ `result.data.rows` |
| `js:93-95` | `getReportFileUrl` | `{fileId: report.fileUrl || report.file_url}` | `result.data.url`（`:96-98`） |

服务端返回结构核对：`getReportDetail:252` 返回 `{ code:0, data:{ ...report, rows } }`
（report 为**原始 snake_case 记录**，`total_amount`/`excluded_rows` 也在里面）；
`getReportFileUrl:57` 返回 `{ code:0, data:{ url } }`，`fileId` 参数名一致 ✅。

### 3.3 展示正确性（合计/单位/精度/空报表）
- **合计是前端造的，不是服务端给的**：`js:53-59` 仅对 `reportType.includes('price')` 和
  `includes('summary')` 两类，用**屏幕上所有行**的 `subtotal` 求和再 `toFixed(2)`；
  其余四类（`store_order_report`、`supplier_order_report`、`store_receipt_report`、`supplier_receipt_report`）
  **完全没有合计行**，连「合计数量」都没有，`data.totalAmount='0.00'`（`:11`）保留但不显示。
  → 前端层面「明细相加 = 合计」恒成立（因为是同一批行求和），**但它与服务端口径不等**，见 H3。
- **服务端两套合计并存且未使用**：`report_file.total_amount`（`generateSummaryReport:252`）已随
  `{...report}` 到达 `this.data.report.total_amount`，但 `js`/`wxml` 均未读取；
  汇总报表的行来自 CSV 反解析（`getReportDetail:203-249`），若解析丢行则前端合计与 CSV 合计静默不一致。
- **精度**：`js:55,58` 只在最后 `toFixed(2)`，累加过程不逐行舍入；与
  服务端 CSV 的 `Math.round(x*100)/100`（`generateSummaryReport:211-215`）及
  `getReportDetail:118,189` 的 `(qty*price).toFixed(2)*1` 三层口径不同（与 controller F9 一致）。
- **行内小数位不一致**：`wxml:89` `¥{{item.unitPrice}}` 渲染服务端裸 `price_snapshot`（`getReportDetail:117,188`），
  `3` 显示成 `¥3`、`12.5` 显示成 `¥12.5`；同行 `subtotal`（`:118`）已两位 → 同一行位数不齐。
  汇总行 `subtotal: Number(f[6]) || 0`（`getReportDetail:241`）同样是裸 Number。
- **NaN 风险**（F9 已记）：`getReportDetail:118` 若 `price_snapshot` 为 `undefined` →
  `subtotal = NaN` → 行显示 `¥NaN` 且合计 `NaN.toFixed(2)` = `"NaN"`；
  汇总报表侧 `Number(f[6]) || 0` 有保护，两类不一致。
- **单位**：`item.unit` 三类报表显示（`wxml:37,54,71,112`），下单报表带 `unit_snapshot` ✅；
  汇总报表的 `unit` 来自 CSV 第 4 列（`getReportDetail:238`）✅。
- **空报表**：
  - `rows=[]` 时各类型分支只显示表头、无「无明细」提示；
  - 未知/空 `reportType` 落 `wxml:142-144` 的 `wx:else` → **永久显示「报表数据加载中...」**（M4）；
  - `store_order_report` 在 `source_order_id` 缺失时 `getReportDetail:84` 不进分支 → rows=[]，同样只有表头。

### 3.4 异常口径（本页是三者中最权威的一个）
`js:47-52`：从 `rows[].abnormal` 反推 `rpt.hasAbnormal`，并从 `rows[].abnormalTypeNames` 去重拼 `abnormalSummary`。
服务端 `getReportDetail:18-24` 的 `getAbnormalTypeNames` 从 `receipt_item.is_shortage/is_quality_issue/is_wrong_item`
实时算出，覆盖收货类报表 ✅。
但汇总报表行（`:234-242`）**不含** `abnormal` 字段 → 汇总报表永远无异常横幅（无异常语义，属预期）。

### 3.5 文件下载链路（`exportReport`，`js:89-118`）
1. `report.fileUrl || report.file_url` 为空 → toast「该报表尚未生成可下载文件」（`:116`）✅
2. `getReportFileUrl` 失败或无 url → toast「文件链接获取失败」（`:113`）✅
3. `wx.downloadFile` → `success` → `wx.openDocument({filePath, showMenu:true})`；
   `fail` → toast「下载失败」（`:110`）✅
4. `openDocument` `success` → 「文件已打开」；`fail` → 「打开失败」（`:107`）✅

**错误分支齐全，但存在两个实质问题**：
- `openDocument` 未传 `fileType`，而**全项目报表文件后缀都是 `.csv`**
  （`generateSummaryReport:231`、`createReceipt:563,596,645,680`、`createPurchaseOrder:410`）；
  微信 `openDocument` 仅支持 doc/docx/ppt/pptx/pdf/xls/xlsx → 汇总报表导出必然落到「打开失败」（H2）。
- **无 loading、无防重入**：三跳期间按钮可重复点击，重复下载（M5）。
- 无「临时链接过期」专门分支：链接过期只会体现在 `downloadFile` 的 `fail` 里，用户只见「下载失败」，无法区分链接过期与网络失败。

### 3.6 data 字段 × wxml 引用对照（`js:8-16`）
| wxml 引用 | 赋值来源 | 状态 |
|---|---|---|
| `typeLabel/typeIconClass/typeColor/scopeLabel` | `js:65-68` | ✅ |
| `report.reportType/reportScope/scopeName/relatedDate/fileVersion/generatedAt/sourceOrderId/hasAbnormal/abnormalSummary` | `js:32-49` | ✅ |
| `rows[].productName` | 6 类分支全部产出（`getReportDetail:91,113,152,184,235`） | ✅ |
| `rows[].category`（`wxml:36,120`） | `:92`、`:237` | ✅ |
| `rows[].unit` | `:93,116,154,187,238` | ✅ |
| `rows[].orderQty`（`wxml:38,52,111,128`） | `:94,114,153,186,239` | ✅ |
| `rows[].receivedQty`（`wxml:53,70,88,129`） | `:115,185,240` | ✅ |
| `rows[].unitPrice`（`wxml:89`） | `:117,188` | ✅ |
| `rows[].subtotal`（`wxml:90,130`） | `:118,189,241` | ✅ |
| `rows[].abnormal/abnormalStatus/abnormalText`（`wxml:55,72`） | `:120-123,191-194` | ✅ |
| `rows[].purchaseOrderId`（`wxml:67,69,86,87,108,109`） | `:150,182` | ✅ |
| `rows[].storeName`（`wxml:68,110`） | `:151,183` | ✅ |
| `rows[].supplierName`（`wxml:127`） | `:236` | ✅ |
| `totalAmount`（`wxml:96,137`） | `js:11` / `:55,58` | ✅ |
| `wxml:88` `{{item.receivedQty || item.qty}}`、`wxml:111` `{{item.orderQty || item.qty}}` | **`getReportDetail` 从不产出 `qty`** | ❌ 死 fallback（L2） |

**「wxml 用但从未赋值」的主字段：无**；唯一死引用是 `item.qty` 兜底。
**「js 赋值但 wxml 未用」**：`report.total_amount`（`getReportDetail:252` 已到前端）、`report.excluded_rows`
（`createReceipt:606,689` 已写库）、`rows[].payable`（`getReportDetail:119,190`）、`rows[].isManual`（`:95`）、
`rows[].remark` —— 其中 `payable`/`excluded_rows` 直接导致 H3 的口径偏差在页面上不可见。

### 3.7 事件绑定 × js 方法对照
| wxml 绑定 | js 方法 | 匹配 |
|---|---|---|
| `wxml:13` `bindtap="goSourceOrder"` | `js:76` | ✅ |
| `wxml:51` `bindtap="goSourceOrder"`（无 data） | `js:76` | ✅ |
| `wxml:69,87,109` `bindtap="goRowOrder"` `data-order-id` | `js:83` | ✅ |
| `wxml:86` `bindtap="goSourceOrder"` `data-order-id="{{item.purchaseOrderId}}"` | `js:76` | ⚠️ 方法匹配，但 `goSourceOrder()` 只读 `this.data.report.sourceOrderId`，**该 `data-order-id` 是死数据**（L2） |
| `wxml:149` `bindtap="exportReport"` | `js:89` | ✅ |

`js:86-87` 用 `wx:if/wx:else` 拆静态绑定，注释（`wxml:85`）解释「动态 bindtap 在部分基础库不生效」——
注释与做法一致 ✅。

---

## 4. 列表 vs 历史的分工（核查项 2）

| 维度 | report-list（报表中心） | report-history（历史报表） |
|---|---|---|
| 入口 | tabBar 第 3 页（`app.json:56`） | 仅 `report-list.js:121` 唯一入口 |
| 数据源 | `getReports`，`orderBy('generated_at','desc')`（`getReports:93`） | **同一个 `getReports`，同一排序** |
| 分页 | `PAGE_SIZE=20` | `PAGE_SIZE=20`（完全相同） |
| 筛选 | 类型 tab（按角色收敛 1/3/6 种）+ 日期 | 作用域（3 项）+ 类型（**全 8 种，不分角色**）+ 日期 |
| 异常标记 | 有（`js:88-90` + `wxml:40`） | **无** |
| 已作废标签 | 有（`wxml:41`） | 有（`wxml:31`） |
| 生成入口 | 有 | 无 |

**结论：功能高度重叠，且互相有缺口。**
- 重叠：两个页面对同一份数据、同排序、同跳详情页；一份报表在两处可见。
- 缺口 A：admin 在 report-list 无汇总类型 tab（M7），刚生成的日/月汇总只能留在「全部」tab 里翻。
- 缺口 B：report-history 的「范围」筛选对 chef/store_manager 是空操作（M3），
  「类型」对 chef 全选都会空列表，页面没有任何越权提示。
- 缺口 C：同一份报表的异常状态在两页表现不一致（M8）。
- 用户视角风险：**「我在哪能找到我那份报表」没有确定答案** —— 生成后的新报表只在 report-list
  的「全部」tab 可见（且要翻页），而 report-history 反而能按类型精确筛到。

---

## 5. `pages/abnormal-list/`（只读参考，异常口径交叉核对）

> 交互细节已由 `batch2-purchase-flow.md` §3 覆盖（无防抖、`showConfirm` fail 被当作「不付款」、
> `statusColorMap` 页面内重复定义、未知 `type` 落回灰圆点）。本节只补**与报表链路的交叉核对**。

### 5.1 数据来源
`abnormal-list.js:16-18` → `dataService` `action:'getAbnormalRecords'`，**payload 为空对象**（不传 status）。
服务端 `dataService:697-732`：
- `chef` 直接返回 `{code:0, data:[]}`（`:700`）→ 页面显示「暂无异常记录」，语义被误读为「没有异常」。
- 非 GLOBAL_ROLES 按 `store_id = default_store_id` 收敛（`:703`）；GLOBAL_ROLES 无收敛 ✅。
- `where({status})` 只在 `event.status` 有值时下推（`:704`）—— **前端完全不用**，
  本地 `applyFilter`（`js:36-45`）重复过滤，意味着点「待处理」仍拉全量。
- `limit(100)` 硬截断、无分页参数（`:705-709`），前端也无分页 UI / loading 态（M11）。

### 5.2 与 report-detail 的口径一致性核查（核查项 10）
**两条异常链是并列的两套数据，且没有暴露关联键。**

| | 数据来源 | 触发写入 | 是否含关联单号 |
|---|---|---|---|
| 报表里的「收货异常」标记 | `receipt_item.is_shortage/is_quality_issue/is_wrong_item`，由 `getReportDetail:18-24` 实时算 | `createReceipt` 收货时 | 报表记录有 `source_order_id`（`createReceipt:569` 等） |
| 异常记录列表 | `abnormal_record` 集合，`createReceipt:488-503` 事务内写入 | 同上，**与上面同一次收货** | 库里有 `receipt_id`/`purchase_order_id`/`product_id`/`store_id` |

关键：**`dataService.getAbnormalRecords` 的返回体（`:718-730`）丢弃了 `receipt_id`、`purchase_order_id`、`product_id`**，
只返回 `id/abnormalId/type/typeName/description/supplierName/storeName/status/statusName/createdAt/resolution`。
结果：
- 在 report-detail 看到「收货异常：少货/缺货」（`report-detail.js:48-52` 反推）→ **无法跳到对应异常记录**；
- 在 abnormal-list 看到一条异常 → **无法跳回来源收货单/报表**；
- 报表列表的 `hasAbnormal`（`report-list.js:88`）与 abnormal-list 的待处理条数**无法对账**。
- 另外 `supplier_receipt_price_report` 写库时只有 `excluded_rows`（`createReceipt:689`），**没有 `has_abnormal`**，
  → 该类报表在 report-list 永远无异常标签，而 report-detail 会从行反推出异常（M8）。

### 5.3 权限与会话症状（横向 F1 在本页的表现）
`dataService:45-52` 的 `requireUser` 返回**嵌套** `{ error: { code:-401 } }`，
`getAbnormalRecords:699` 原样 `return auth.error`；`utils/cloud.js:68` 只判顶层 `result.code`。
**本页面用户可见症状**（F1 已定性，此处只记页面表现）：
- 会话过期后进入本页 → `js:19-21` 判 `result.code !== 0`（undefined ≠ 0）为真 → toast「异常记录加载失败」→ return，
  列表停在空态，**不跳登录**；
- `js:55` → 「异常处理状态更新失败」；`js:87-90` → 「异常解决状态更新失败」；`js:103-105` → 「异常关闭失败」；
- `-403`（店长越店处理，`dataService:740-742`）同样被吞 → 越权被降级成通用文案；
- 用户可无限重复点击无效按钮，且无任何「登录已过期」提示。

---

## 6. 问题清单

### 高

**H1. 前端门禁与云函数权限口径相反，店长被错误拦截（注释与实现不符）**
- 位置：`pages/report-list/report-list.js:126-131`；对照 `cloudfunctions/generateSummaryReport/index.js:160`、`:170-175`、`cloudfunctions/dataService/index.js:8`
- 触发：店长（`store_manager`）点击「生成汇总 ▸」。
- 影响：云函数明确允许 `['store_manager','purchaser','super_admin']` 且为店长写了
  「强制限定自己的门店」分支（`:170-175`），前端却硬编码 `['super_admin','purchaser']` 拦截，
  店长永远只能看到「仅管理员可生成汇总报表」。`js:126` 注释「与云函数 GLOBAL_ROLES 口径一致：下单人员/店长点了必 403」
  与实现直接矛盾（`GLOBAL_ROLES` 是 `dataService:8` 的定义，与 `generateSummaryReport:160` 的清单不同）。
- 建议：前端门槛改为与云函数一致并复用单一常量；或把云函数收紧为 GLOBAL_ROLES 并删除 `:170-175` 店长分支。

**H2. 报表文件是 CSV，`wx.openDocument` 不支持 → 汇总报表导出必然失败**
- 位置：`pages/report-detail/report-detail.js:103-108`；文件后缀 `cloudfunctions/generateSummaryReport/index.js:231`
  （另 `createReceipt:563,596,645,680`、`createPurchaseOrder:410` 同为 `.csv`）
- 触发：任意报表详情页点「导出报表文件」。
- 影响：`openDocument` 仅支持 doc/docx/ppt/pptx/pdf/xls/xlsx，未传 `fileType`；所有报表在打开环节落到
  `fail` → 只显示「打开失败」（`:107`），用户拿不到文件，`showMenu:true` 的转发能力一并失效。
- 建议：服务端生成 `.xlsx`（或在服务端提供 xlsx 转换），前端明确按扩展名分流；短期把失败文案改为
  「暂不支持打开该格式」。【待核实】不同基础库对 `.csv` 的实际返回需真机确认。

**H3. report-detail 的表格与报表文件口径不一致：supplier_* 按日重建、带价报表未按可付款过滤 → 合计与 CSV 不等**
- 位置：读取侧 `cloudfunctions/getReportDetail/index.js:128-158`（supplier_order，忽略 `source_order_id`，
  按 `order_date`+`supplier_id` 扫当日**全部**采购单）、`:159-198`（supplier_receipt，同上，按 `receipt_date` 扫当日**全部**收货单，
  且对 `supplier_receipt_price_report` 未过滤 `payable_flag`/`is_manual`，只把 `payable` 挂到行上 `:190`）；
  生成侧 `createPurchaseOrder/index.js:398-421`（每单每供应商一份 CSV，仅含该单明细）、
  `createReceipt/index.js:583`、`:664`（带价报表 `filter(i => i.payableFlag && !i.isManual)`）、`:631-656`；
  前端 `pages/report-detail/report-detail.js:53-59` 用屏幕上所有行的 `subtotal` 求和展示合计。
- 触发：同一供应商同一天有多张采购单/收货单；或收货含异常行/手动行。
- 影响：① report-list 出现同一天同一供应商的 N 份 v1..vN 报表，点进任一份看到的明细都是当日全部订单，
  而导出的 CSV 只有 1 单 → **页面表格 ≠ 报表文件**；② 带价报表合计把不可付款行、手动行算进去，
  与 CSV 合计、`report_file.total_amount`（`generateSummaryReport:252`）口径不同，属金额口径错误；
  ③ `getReportDetail:129-130`、`:159-161` 的注释自述「按日聚合多单」，与生成侧「每单一份」矛盾（注释与实现对不上）。
- 建议：读取侧用 `report.source_order_id` 收敛范围；带价类型加 `payable_flag:true` 并排除手动行；
  前端合计改用服务端返回值。

### 中

**M1. 触底加载无「空页」终止条件 → 重复追加 / 死循环**
- `pages/report-list/report-list.js:96-98`、`pages/report-history/report-history.js:80-82`
- 触发：`countRes.total` 与分页查询结果不一致（期间有 supersede/删除/补生成）导致某页返回 0 行。
- 影响：`hasMore` 仅在 `reports.length < total` 为假时置 false；空页不改变 `hasMore` → 下次触底重复追加同一页，
  列表出现重复卡片且永不停止。
- 建议：`if (!newReports.length) hasMore = false`。

**M2. 无并发请求守卫 → 翻页与刷新竞态产生重复行**
- `pages/report-list/report-list.js:30-38,71,96`、`pages/report-history/report-history.js:44-52,58,80`
- 触发：触底加载 page 2 期间下拉刷新或切类型（report-list 因 `onShow` 每次切回都 reload，`:20-24`）。
- 影响：append 请求晚于刷新返回时，`this.data.reports.concat(newReports)` 把旧页结果拼到新一批列表上，
  随后 `page` 被写成 2 → 重复/错位数据。`onReachBottom` 不 await `loadReports`，`isLoadingMore`
  虽在首个 await 前同步置位，但无法阻止「刷新覆盖 + append 迟到」的组合。
- 建议：加请求序号/`this._reqSeq` 校验或统一 `reload()` 时置 `isLoadingMore=false` 并丢弃在飞 append。

**M3. report-history 的范围/类型筛选对 chef、store_manager 是空操作（无角色门禁）**
- `pages/report-history/report-history.js:20-24,29-34,63`；对照 `cloudfunctions/getReports/index.js:46,52-66,79-86`
- 触发：店长选「供应商报表」；厨师选任何非 `store_order_report` 的类型。
- 影响：服务端只在全局角色分支应用 `reportScope`（`:63`），门店角色被强制 `report_scope='store'`
  → 店长「供应商报表」实际返回门店报表，**看起来筛选成功**；厨师选到无权类型直接空列表、无解释。
  本页对 `userInfo.role` 没有任何收敛，也无「当前账号无权」提示。
- 建议：按角色收敛两个 picker 的选项；选到越权项时给出提示而非静默空列表。

**M4. report-detail 失败态/空态缺失：加载失败与未知类型都卡在「报表数据加载中...」**
- `pages/report-detail/report-detail.js:70-72`、`pages/report-detail/report-detail.wxml:142-144`、
  `cloudfunctions/getReportDetail/index.js:68,84,244-248,253-255`
- 触发：报表不存在、汇总报表 CSV 解析失败（服务端 `throw` → `:253-255` 返回 `code:-1`）、
  `reportType` 不在 6 个分支内、`store_order_report` 缺 `source_order_id`。
- 影响：失败只 toast「加载失败」（丢弃服务端 msg，如「报表不存在」），页面 `typeLabel=''`、`report={}`；
  未知类型和空 rows 都落 `wx:else` 的「报表数据加载中...」→ 永远显示加载中；空明细只有表头、无「无明细」提示。
- 建议：加 `loadState`（loading/error/empty），错误态展示服务端 msg + 重试。

**M5. 导出链路无 loading、无防重入**
- `pages/report-detail/report-detail.js:89-118`
- 触发：点「导出报表文件」后连续点击。
- 影响：`getReportFileUrl`→`downloadFile`→`openDocument` 三跳期间按钮可用，重复下载；无进度反馈。
  错误分支本身齐全（`:107,110,113,116`），但无「链接过期」专门分支，链接过期与网络失败都只显示「下载失败」。
- 建议：入口加 `util.showLoading` + `this._exporting` 守卫，并在 `downloadFile.fail` 里区分 statusCode。

**M6. 两个列表页无加载态，首屏先闪「暂无报表」**
- `pages/report-list/report-list.js:10-18` + `wxml:59-62`；`pages/report-history/report-history.js:10-24` + `wxml:39-42`
- 触发：进入页面、下拉刷新、切 tab。
- 影响：`reports.length === 0` 同时表示「加载中」和「真的没有」，冷启动必现空态闪烁；失败只有 toast，无失败视图/重试。
- 建议：加 `isLoading`，加载态与空态分离。

**M7. report-list 与 report-history 功能重叠且互相缺口**
- `pages/report-list/report-list.js:40-65,120-122`、`pages/report-history/report-history.js:29-34`、`app.json:21,56`
- 触发：admin 生成汇总后寻找报表。
- 影响：两页同数据源、同排序、同 `PAGE_SIZE`、同跳详情页，完全重叠；
  admin 在 report-list 的 tab 里**没有**日/月汇总类型（`:55-62`），刚生成的汇总报表只能留在「全部」tab 里翻；
  而 report-history 能按类型精确筛到，且它是唯一能筛全部 8 种的入口 —— 但只有从 report-list 才能进入。
- 建议：合并为一页，或在 report-list 补汇总类型 tab、report-history 补角色收敛与异常标记。

**M8. 异常标记在三个页面口径互不相同**
- `pages/report-list/report-list.js:88-90`（有）、`pages/report-history/report-history.js:71-79`（无）、
  `pages/report-detail/report-detail.js:47-52`（从行反推）；服务端 `createReceipt/index.js:572,605,654` 有写、`:689` 未写
- 触发：查看 `supplier_receipt_price_report` 类报表。
- 影响：同一份报表在「报表中心」有红色异常标签、在「历史报表」没有；
  `supplier_receipt_price_report` 写库时只有 `excluded_rows`（`:689`）无 `has_abnormal` → report-list 永远无标签，
  但 report-detail 会从行反推出异常横幅 → 列表与详情自相矛盾。
- 建议：统一以「行级反推」为唯一口径，或在服务端补齐 `has_abnormal` 写入点。

**M9. 金额格式化三层口径不统一 + 部分报表无合计**
- `pages/report-detail/report-detail.js:11,53-59`；`wxml:89`（裸 `unitPrice`）、`:90,130`（`subtotal`）；
  `getReportDetail/index.js:118,189,241`；对照 `generateSummaryReport/index.js:211-215`（服务端 `Math.round(x*100)/100`）
- 触发：任意带价/汇总报表；或价格/单价为 `undefined`。
- 影响：① 行内 `¥3` 与 `¥3.00` 并存（`unitPrice` 未格式化，`subtotal` 已两位）；
  ② 合计只在前端 `toFixed(2)` 一次，累加过程不舍入，与 CSV 合计可能差 1 分；
  ③ `price_snapshot` 为 `undefined` 时 `subtotal = NaN` → 行显示 `¥NaN`、合计显示 `¥NaN`（汇总报表侧有 `|| 0` 保护，两类不一致）；
  ④ `store_order_report`/`supplier_order_report`/`store_receipt_report`/`supplier_receipt_report` 四类**完全没有合计行**，无「合计数量」。
  与 controller F9 记录的分布一致。
- 建议：前端统一 `formatAmount()`；对四类报表补「合计数量」；`subtotal` 加 `Number(...)||0`。

**M10. 异常记录与报表之间没有暴露关联键，两套异常数据无法互查**
- `cloudfunctions/dataService/index.js:718-730`（返回体丢弃 `receipt_id`/`purchase_order_id`/`product_id`）；
  库内实际存在 `cloudfunctions/createReceipt/index.js:488-503`
- 触发：从 report-detail 的「收货异常：少货/缺货」想跳异常记录；或从 abnormal-list 想跳回来源单。
- 影响：两条异常链同源于一次收货（`receipt_item` 标记 vs `abnormal_record` 记录），但没有任何 join key 暴露给前端，
  report-detail 无法跳异常记录、abnormal-list 无法跳报表/收货单，报表的 `hasAbnormal` 与异常待处理数无法对账。
- 建议：`getAbnormalRecords` 返回 `receipt_id`/`purchase_order_id`；两边加互跳入口。

**M11. abnormal-list 100 条静默截断 + 无分页/加载态 + 服务端过滤能力未使用**
- `pages/abnormal-list/abnormal-list.js:16-18,36-45`；`cloudfunctions/dataService/index.js:697-732`
- 触发：单店异常记录超过 100 条。
- 影响：服务端 `limit(100)` 硬截断（`:705-709`）且不接受分页参数；页面也无分页 UI、无 loading 态
  （`json` 未开 `enablePullDownRefresh`）→ 超出部分静默丢失；
  服务端 `event.status` 下推（`:704`）前端完全不用，点「待处理」仍拉全量 100 条再本地过滤；
  chef 角色服务端返回 `[]`（`:700`），页面显示「暂无异常记录」，语义被误读为「没有异常」。
- 建议：服务端开放分页 + 状态参数下推；页面区分「无权限/空」与「真的没有」。

**M12. 管理员生成汇总依赖全局 currentStore，页内无门店选择，且只能生成「今天」**
- `pages/report-list/report-list.js:136-146`；`cloudfunctions/generateSummaryReport/index.js:176`
- 触发：管理员未选择当前门店时点「生成本月月汇总」。
- 影响：`storeId` 传 `''` → 服务端返回「请指定门店」（`:176`）→ 前端只显示该 msg，无门店选择入口；
  跨门店生成必须先跑去别处切换全局门店；`date` 固定为今天（`:136-139`），无法补历史日期；
  生成成功仅 toast + reload，新报表在无对应 tab 时不可见（见 M7）。
- 建议：页内加门店选择器（管理员）+ 日期选择器；生成成功后跳到新报表。

### 低

**L1. 返回丢失分页位置**：`report-list.js:20-24,35-38`、`report-history.js:27-38,49-52`
每次 `onShow`/`reload` 都把 `page` 重置为 1；report-history 非 tabBar 页，从详情页返回即回到第一页。

**L2. 死字段 / 死 dataset**：`report-detail.wxml:88` `{{item.receivedQty || item.qty}}`、`:111`
`{{item.orderQty || item.qty}}` —— `getReportDetail` 从不产出 `qty`，兜底永不生效；
`report-detail.wxml:86` 的 `data-order-id` 未被 `goSourceOrder()`（`js:76-80`）读取。

**L3. `.empty-hint` 样式缺失**：`report-detail.wxml:143` 用的类只在 `index.wxss` / `purchase-create.wxss`
定义，`report-detail.wxss`（118 行）无此选择器 → 该分支无样式兜底。

**L4. `getReports` 的 `role`/`storeId` 是死入参**：`getReports/index.js:43` 解构后从未使用
（权限一律按会话 user 收敛，安全性反而更好）；两个列表页仍传（`report-list.js:73-80`、`report-history.js:60-68`）。
副作用：前端若本地 `userInfo.role` 缓存过期（账号被降级/停用），tab 与筛选项会与服务端结果不一致，
表现为「点了没数据」+ toast「当前账号无权查看报表」。

**L5. 手动行在明细页无标识**：`getReportDetail:95-96` 已返回 `isManual`/`remark`，`wxml:34-39` 不展示；
汇总报表服务端已排除手动行（`generateSummaryReport:191`）→ 明细页与汇总页对手动行的处理不透明。

**L6. 服务端合计已到前端但未使用**：`getReportDetail:252` 返回 `{...report, rows}`，
`total_amount`/`excluded_rows` 已在 `this.data.report` 里，`js`/`wxml` 均未读取（前端另算，见 M9）；
`generateSummaryReport:257-265` 返回的 `totalAmount`/`itemCount` 也被 `report-list.js:152` 丢弃（只 toast「已生成」）。

**L7. 月汇总的 `related_date` 存的是当天日期**：`generateSummaryReport:227`（注释自述「月汇总也存传入日期」），
`pathDate` 才是月份（`:229`）；`report-detail.wxml:11` 因此显示「日期: 2026-10-03」而它是月汇总，易误读。
另 `getStoreReceipts:84` 用字符串 `_.lte('YYYY-MM-31')` 做上界。

**L8. report-detail 无 `onShow`**：从 `goSourceOrder`/`goRowOrder` 返回不重拉，
报表被 `dataService:416,1318` 标记 superseded 或重新生成后，本页保持旧值。

**L9. 生成汇总中会话过期的双 toast**：`report-list.js:147-150` 与 `utils/cloud.js:68-70,43-46`
同时触发 → 用户同时看到「登录已过期，请重新登录」和「汇总报表生成失败」。

**L10. report-list.js 工作区未提交改动**：`git diff` 仅 `:42`、`:69-70`、`:145` 三处 `?.` → `&&`
（共 4 行 +4/-4），无逻辑变化，不影响本报告结论。

---

## 7. 跨批次待核实项

| # | 要确认什么 | 去哪里找 |
|---|---|---|
| 1 | `wx.openDocument` 对 `.csv` 在各基础库的真实行为（报错码/静默放行/是否可 `fileType:'csv'`），决定 H2 修复是「前端分流」还是「服务端转 xlsx」 | 真机实测；服务端文件后缀已确认全为 `.csv`（`generateSummaryReport:231`、`createReceipt:563,596,645,680`、`createPurchaseOrder:410`） |
| 2 | 供应商报表的正确粒度：生成侧「每单一份」（`createPurchaseOrder:398-421`）还是读取侧「每日聚合」（`getReportDetail:128-158`）—— 二者必有一个错，决定 H3 改哪一侧 | `getReportDetail` + `createPurchaseOrder`/`createReceipt` 的产品口径确认 |
| 3 | `receipt_item` 是否已落 `is_manual`（`generateSummaryReport:191` 在用），`getReportDetail:181-196` 是否应据此过滤并暴露 `payable` | `createReceipt` 事务内 `receipt_item` 写入字段 |
| 4 | 店长是否应能生成汇总报表：云函数留了店长分支（`generateSummaryReport:170-175`），前端却拦截（`report-list.js:128`）；`GLOBAL_ROLES`（`dataService:8`）与云函数清单不一致的原因 | 产品确认 + 是否统一常量 |
| 5 | `report_file` 是否有删除记录（batch1 §4.11 `missing_reports` 补偿链路），导致 `count` 与分页查询不一致而触发 M1 死循环 | `dataService.regenerateReceiptReports` / `regenerateOrderReports`（`:1150-1270`）与 `missing_reports` 链路 |
| 6 | chef/store_manager 是否需要「历史报表」页：`getReports:54` 对未关联门店的 chef 返回 403，report-history 无任何角色收敛 | `getReports` 角色矩阵 + 产品确认 |
| 7 | 单店 `abnormal_record` 超 100 条的实际概率，以及是否应把状态过滤下推（服务端 `event.status` 已支持但前端不用） | `dataService:697-732` + 实际数据量 |
| 8 | 服务端 `dataService`/`importProducts` 的嵌套 `{error:{code:-401}}` 修复后，abnormal-list 三个 handler 的 toast 才会正确显示「登录已过期」 | controller F1 的修复项（本页为受影响页面之一） |
| 9 | 月汇总 `related_date` 应存「当天」还是「月初」（`generateSummaryReport:227` 注释自述存当天） | 产品确认 |
| 10 | 带价报表被排除的行数 `excluded_rows`（`createReceipt:606,689`）是否应在 report-detail 展示（目前前端未读） | 产品确认，涉及 H3/M9 的可解释性 |
| 11 | `utils/cloud.js` 的 `-401` 只查顶层是否统一拍平（否则 report-list/report-history/report-detail 的 4 个云函数虽返回扁平结构，但任何未来 dataService 调用都会踩坑） | `utils/cloud.js:68-70` |
