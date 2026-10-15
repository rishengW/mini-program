# A7 · 报表页 + 供应商端页（8 页）· 函数级清单

> 代理：A7 · 报表页（3 页）与供应商端页（5 页）
> 仓库基线：`backup` 分支（含 `73b0730 audit`）
> 本批共 8 页 × 4 文件 = 32 个文件，另读网关 `utils/cloud.js`（283 行）。

---

## 0. 范围与方法

### 0.1 实际读取确认（32 个文件全部逐行读毕）

**报表（内部）3 页**

| 文件 | 行数 |
|---|---|
| `pages/report-list/report-list.js` | 163 |
| `pages/report-list/report-list.wxml` | 63 |
| `pages/report-list/report-list.wxss` | 127 |
| `pages/report-list/report-list.json` | 4 |
| `pages/report-detail/report-detail.js` | 126 |
| `pages/report-detail/report-detail.wxml` | 159 |
| `pages/report-detail/report-detail.wxss` | 118 |
| `pages/report-detail/report-detail.json` | 3 |
| `pages/report-history/report-history.js` | 115 |
| `pages/report-history/report-history.wxml` | 43 |
| `pages/report-history/report-history.wxss` | 27 |
| `pages/report-history/report-history.json` | 5 |

小计 953 行。

**供应商端 5 页**

| 文件 | 行数 |
|---|---|
| `pages/supplier-home/supplier-home.js` | 134 |
| `pages/supplier-home/supplier-home.wxml` | 82 |
| `pages/supplier-home/supplier-home.wxss` | 168 |
| `pages/supplier-home/supplier-home.json` | 4 |
| `pages/supplier-orders/supplier-orders.js` | 131 |
| `pages/supplier-orders/supplier-orders.wxml` | 49 |
| `pages/supplier-orders/supplier-orders.wxss` | 70 |
| `pages/supplier-orders/supplier-orders.json` | 5 |
| `pages/supplier-receipts/supplier-receipts.js` | 82 |
| `pages/supplier-receipts/supplier-receipts.wxml` | 31 |
| `pages/supplier-receipts/supplier-receipts.wxss` | 16 |
| `pages/supplier-receipts/supplier-receipts.json` | 5 |
| `pages/supplier-prices/supplier-prices.js` | 42 |
| `pages/supplier-prices/supplier-prices.wxml` | 19 |
| `pages/supplier-prices/supplier-prices.wxss` | 17 |
| `pages/supplier-prices/supplier-prices.json` | 4 |
| `pages/supplier-messages/supplier-messages.js` | 66 |
| `pages/supplier-messages/supplier-messages.wxml` | 27 |
| `pages/supplier-messages/supplier-messages.wxss` | 78 |
| `pages/supplier-messages/supplier-messages.json` | 3 |

小计 1033 行。**32 个文件合计 1986 行。**

**额外只读**

- `utils/cloud.js` 283 行（全文）
- `utils/meta.js` 67 行（全文）
- `utils/util.js` 127 行（全文）
- `utils/auth-guard.js` 16 行（全文）
- `app.json` 74 行（全文，用于核对页面注册与 tabBar 归属）
- `pages/message/message.js` 83 行（全文，仅用于第 5 节与供应商消息页的字段/调用对比）
- `styles/icons.wxss`：仅以 Grep 抽查类名存在性，未逐行读

### 0.2 未读范围声明

- **未读任何云函数服务端代码（`cloudfunctions/*`）**。故凡涉及「后端 `where` 是否按会话 supplierId 过滤」「后端是否信任前端传入的 `role`/`storeId`」的判据，一律标「未验证：需读云函数源码」，不做推测。
- 未读 `.json` 引用的第三方组件源码（本批 8 页 `usingComponents` 全部为空对象）。
- 未做真机 / 开发者工具运行验证；所有 `wx.openDocument`、`wx.downloadFile` 的实际行为结论均为静态推断。
- 未读 `pages/index/index.js`（`tabBar` 报表页的兄弟页），仅在 `app.json` 层确认注册。

### 0.3 检索证据（用于支撑负结论）

- 云调用点枚举：对 8 个页面的 `.js` 用 `callFunction\(\s*'[^']+'\s*,\s*\{[^}]*\}` 多行 Grep，命中 **13 个**调用点（含 `getReports`×2、`getReportDetail`、`getReportFileUrl`、`generateSummaryReport`、`getSupplierOrders`×2、`confirmSupplierOrder`、`getSupplierReceipts`、`getProductPrices`、`dataService`×4、`authService`×1）。注意：`getSupplierReceipts` 的单行匹配被截断，已由逐行 Read 补确认（`supplier-receipts.js:39-42`）。
- 前端 `supplierId` / `supplier_id` / `storeId` / `store_id` 检索：`Grep supplier-*.js` 全量命中仅 `supplier-home.js:11,41`（`supplierName` 纯展示 data 字段）与**非供应商端**的 `supplier-manage.js`（内部管理页，不在本批范围）。详见第 5 节。
- 图标类名存在性：`report-list.wxml:16` 动态拼接 `icon-{iconBase}-{white|grey}`，iconBase ∈ {chart, clipboard, package, tag, factory, truck}，共需 12 个类；Grep `styles/icons.wxss` 确认 `.icon-chart-grey/white`、`.icon-clipboard-grey/white`、`.icon-package-grey/white`、`.icon-tag-grey/white`、`.icon-factory-grey/white`、`.icon-truck-grey/white` **全部存在**，故动态类名不断链。

---

## 1. 页面配置与生命周期

> tabBar 归属（`app.json:42-67`）：`pages/index/index`（首页）、`pages/purchase-list/purchase-list`（采购）、**`pages/report-list/report-list`（报表）**、`pages/message/message`（消息）共 4 项。
> 本批 8 页中**只有 `report-list` 属于 tabBar**；`report-detail`、`report-history`、供应商端 5 页全部**不在 tabBar**，均可被 `navigateTo` 压栈（`app.json:16-17, 21, 24-28`）。

### 1.1 `pages/report-list/report-list`（报表中心，tabBar 页）

- **`.json`**：`navigationBarTitleText: "报表中心"`、`enablePullDownRefresh: true`（`report-list.json:2-3`）。`onPullDownRefresh` 已在 JS 定义（`report-list.js:26-28`），下拉可反馈。
- **tabBar 归属**：是（`app.json:55-60`）。由此产生约束：其它页面若要回到报表中心，必须用 `wx.switchTab` 而非 `navigateTo`。本批 8 页内无跳往本页的边。
- **生命周期**：仅 `onShow`（`report-list.js:20-24`）→ `authGuard.requireLogin()` → `initTabs()` → `reload()`。**无 `onLoad`**，首次进入与从 `report-detail` / `report-history` 返回都会重跑 `initTabs()` + 拉第一页。
- **数据来源**：`getReports`（列表 + 分页）、`generateSummaryReport`（写）、`app.globalData.userInfo.role` 与 `app.globalData.currentStore.storeId`（角色/门店上下文，见第 5 节）。
- **首帧**：`reports: []` 初始值使 wxml:59 `reports.length === 0` 命中，**首帧先渲染"暂无报表"空态再被数据覆盖**（无 loading 占位，`isLoadingMore` 不被 wxml 读取，见 §3.4）。

### 1.2 `pages/report-detail/report-detail`（报表详情）

- **`.json`**：仅 `navigationBarTitleText: "报表详情"`（`report-detail.json:2`）。**未声明 `enablePullDownRefresh`**，与 JS 未定义 `onPullDownRefresh` 一致。
- **tabBar 归属**：否。
- **生命周期**：仅 `onLoad(options)`（`report-detail.js:18-80`）。**无 `onShow`** → 从 `purchase-detail` 返回本页不会重拉数据；`exportReport` 读取的是 `onLoad` 时缓存在 `this.data.report` 的对象。
- **数据来源**：`getReportDetail`（只读一次）、`getReportFileUrl`（换取临时链接）。

### 1.3 `pages/report-history/report-history`（历史报表）

- **`.json`**：`navigationBarTitleText: "历史报表"`、`enablePullDownRefresh: true`（`report-history.json:2-4`）。JS 已定义 `onPullDownRefresh`（`report-history.js:40-42`）。
- **tabBar 归属**：否。
- **生命周期**：仅 `onShow`（`report-history.js:27-38`）→ 守卫 → 重建 `reportTypeOptions` → 重算 `filterTypeLabel` → `reload()`。
- **数据来源**：`getReports`（比 `report-list` 多传 `reportScope` 筛选）。

### 1.4 `pages/supplier-home/supplier-home`（供货商工作台）

- **`.json`**：`navigationBarTitleText: "供货商工作台"`（`supplier-home.json:2`）。**无 `enablePullDownRefresh`**。
- **tabBar 归属**：否（`app.json:24`）—— 供应商入口页本身不在 tabBar，供应商角色的主入口靠登录后的 `reLaunch`。
- **生命周期**：仅 `onShow`（`supplier-home.js:24-49`），且是**三重守卫**：`authGuard.requireLogin()`（:25）→ `wx.hideHomeButton()`（:27，隐藏胶囊返回首页按钮）→ 未登录 `redirectTo /pages/login/login`（:29-32）→ 非 supplier 角色 `reLaunch /pages/index/index`（:35-38）。
- **数据来源**：`getSupplierOrders`（仅取 `statusCounts`）、`dataService.getMessages`、`app.globalData.supplierInfo` / `storage supplierInfo`（本地缓存，`supplier-home.js:39`）、`authService.logout`。

### 1.5 `pages/supplier-orders/supplier-orders`（采购订单）

- **`.json`**：`navigationBarTitleText: "采购订单"`、`onReachBottomDistance: 50`（`supplier-orders.json:2-4`）。
- **生命周期**：`onLoad(options)`（:27-32，读 `options.status` 并校验是否属于 `TABS` key 集合）+ `onShow`（:34-46，未登录/非供应商守卫后 `reload()`）+ `onReachBottom`（:48-52）。
- **注意**：`onLoad` **不触发数据加载**，加载发生在 `onShow`，因此 `onLoad` 设置的 `activeTab` 能被 `onShow → reload()` 读到。

### 1.6 `pages/supplier-receipts/supplier-receipts`（收货记录）

- **`.json`**：`navigationBarTitleText: "收货记录"`、`onReachBottomDistance: 50`（`supplier-receipts.json:2-4`）。
- **生命周期**：`onShow`（:15-28，守卫后 `loadReceipts(1,false)`）+ `onReachBottom`（:30-34）。**整页无任何点击绑定**（`supplier-receipts.wxml` 0 个 `bindtap`/`catchtap`）。

### 1.7 `pages/supplier-prices/supplier-prices`（商品价格）

- **`.json`**：仅 `navigationBarTitleText: "商品价格"`（`supplier-prices.json:2`）。**无 `onReachBottomDistance`、无分页** —— 与 JS 一次性全量拉取一致。
- **生命周期**：仅 `onShow`（:12-25）。**0 个点击绑定**。

### 1.8 `pages/supplier-messages/supplier-messages`（我的消息）

- **`.json`**：仅 `navigationBarTitleText: "我的消息"`（`supplier-messages.json:2`）。
- **生命周期**：`async onShow`（:12-21），守卫条件与另外 4 个供应商页**不一致**（见 §7 死态条目 D-6）。

### 1.9 供应商端守卫口径不一致（横向观察）

| 页面 | 未登录 → | 非 supplier 角色 → |
|---|---|---|
| `supplier-home` :29-38 | `redirectTo /login` | `reLaunch /index` |
| `supplier-orders` :37-44 | `redirectTo /login` | `reLaunch /index` |
| `supplier-receipts` :19-26 | `redirectTo /login` | `reLaunch /index` |
| `supplier-prices` :16-23 | `redirectTo /login` | `reLaunch /index` |
| `supplier-messages` :16-18 | 合并条件 → `reLaunch /login` | `reLaunch /login` |

`supplier-messages` 把两种失败合并为一条 `reLaunch('/pages/login/login')`（`supplier-messages.js:16-17`）：非供应商账号误入会跳到登录页而非门店首页。

---

## 2. 前端函数清单

### 2.1 `report-list.js`

#### `### onShow()` `(report-list.js:20-24)`
- **触发方式**：框架生命周期（tabBar 页每次切到本页都会触发）
- **入参**：无
- **调用云函数**：间接 → `getReports`（经 `reload()` → `loadReports(1,false)`）
- **成功/失败分支**：自身无分支
- **副作用**：`authGuard.requireLogin()`
- **契约风险**：无缓存/去抖。tabBar 页每次切换都重跑 `initTabs()` + 重拉第一页；切页频繁则重复请求
- **WXML 绑定核查**：无绑定

#### `### onPullDownRefresh()` `(report-list.js:26-28)`
- **触发方式**：`.json` 开启 `enablePullDownRefresh` 后的下拉手势
- **入参**：无
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：用 `.finally()` 保证无论成败都 `wx.stopPullDownRefresh()`（:27）—— 写法正确
- **副作用**：`wx.stopPullDownRefresh()`
- **契约风险**：`reload()` 内部无 `await` 保护链，但 `.finally` 已覆盖异常路径
- **WXML 绑定核查**：无绑定（由 `.json` 声明驱动）

#### `### onReachBottom()` `(report-list.js:30-33)`
- **触发方式**：滚到底部
- **入参**：读 `this.data.isLoadingMore` / `this.data.hasMore`
- **调用云函数**：间接 → `getReports(page+1, append=true)`
- **成功/失败分支**：无
- **副作用**：无
- **契约风险**：`.json` **未声明 `onReachBottomDistance`**（`report-list.json` 全文 4 行），用默认 50px。`report-list.js:32` 传 `this.data.page + 1`，而 `page` 只在 `loadReports` 成功后才更新（:98），因此连点不会重复请求（`isLoadingMore` 挡住）
- **WXML 绑定核查**：无绑定

#### `### reload()` `(report-list.js:35-38)`
- **触发方式**：内部调用（`onShow`、`onPullDownRefresh`、`switchType`、`onDateFilter`、`clearDateFilter`、`generateSummary` 成功回调）
- **入参**：无
- **调用云函数**：间接 → `getReports(1,false)`
- **成功/失败分支**：先 `setData({page:1, hasMore:true})` 再调用；**注意**：不清空 `this.data.reports`，因此筛选切换的瞬间旧列表仍可见，直到新结果 `append=false` 覆盖（`loadReports:96`）
- **副作用**：`setData`
- **契约风险**：无 loading 标记 → 快速切换 tab 时后发请求可能覆盖先发结果（未验证是否真发生，取决于网络时序）
- **WXML 绑定核查**：无绑定（内部）

#### `### initTabs()` `(report-list.js:40-65)`
- **触发方式**：`onShow` 内部调用
- **入参**：`getApp().globalData.userInfo.role`（缺省 `'purchaser'`）
- **调用云函数**：无
- **成功/失败分支**：按角色分 3 支：`chef` → 1 个 tab（:45-47）；`store_manager` → 3 个（:47-52）；其它（含 `super_admin`/`purchaser`/空）→ 6 个（:53-62）。`setData({typeTabs})`
- **副作用**：`setData`
- **契约风险**：`role` 为空串时落到 `else` 分支，**默认给全量 6 类 tab**（:53）。若 `userInfo.role` 尚未回填（守卫只校验 `isLoggedIn && authToken`，不校验 `userInfo.role` 存在，见 `auth-guard.js:8`），未识别角色会看到包含 `supplier_*` 的 tab
- **WXML 绑定核查**：无绑定（内部）

#### `### loadReports(page, append)` `(report-list.js:67-103)`
- **触发方式**：`reload()` / `onReachBottom()`
- **入参**：`page`（number）、`append`（boolean）
- **调用云函数**：`getReports`，完整参数列表（`report-list.js:73-80`）：
  `role`（取自 `app.globalData.userInfo.role`，缺省 `'purchaser'`）、`storeId`（`app.globalData.currentStore.storeId`）、`reportType`（`activeType==='all'` 时传空串）、`relatedDate`（`filterDate` 或空串）、`page`、`pageSize`（常量 `PAGE_SIZE=20`，`report-list.js:7`）
  **期望返回**：`{code, data: Report[], total, msg}`
- **成功/失败分支**：
  - 成功 `code===0`（:82）→ 逐条 `cloud.normalizeReport` + 补 `hasAbnormal`/`abnormalSummary`/`abnormalLabel`/`typeLabel`/`typeIconClass`/`typeColor`（:83-95）；`append` 时 concat（:96）；`hasMore = reports.length < total`（:98）
  - 失败（:99-102）→ 仅 `setData({isLoadingMore:false})` + `util.showToast(result.msg || '报表加载失败')`；**`reports` 保持旧值**（不清空），空列表首次失败即停在空态
- **副作用**：`setData`
- **契约风险**：
  1. **`role` 与 `storeId` 由前端传入**（:74-75）—— 详见第 5 节，这是本批唯一的前端传身份标识点。
  2. `abnormalLabel = '收货异常' + (abnormalSummary ? ' · '+abnormalSummary : '')`（:90）—— 对 `supplier_order_report`、`store_order_report`、`summary` 类报表硬编码"收货异常"文案，语义不准确（非缺陷审计范畴，仅记录契约口径）
  3. `typeInfo = meta.getReportTypeInfo(...)` 未命中时回退 `{label: type||'未知报表', iconClass:'icon-file-grey'}`（`meta.js:59-61`），不会崩
- **WXML 绑定核查**：无绑定（内部）

#### `### switchType(e)` `(report-list.js:105-108)`
- **触发方式**：`bindtap="switchType"`（`report-list.wxml:15`）
- **入参**：`e.currentTarget.dataset.value` → 写入 `activeType`
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({activeType})` + `reload()`
- **契约风险**：`dataset.value` 未校验；但取值仅来自本页生成的 `typeTabs`，实际不可注入
- **WXML 绑定核查**：有绑定（`wxml:15`，`data-value="{{item.value}}"`）

#### `### onDateFilter(e)` `(report-list.js:110-113)`
- **触发方式**：`bindchange="onDateFilter"`（`report-list.wxml:24`，`picker mode="date"`）
- **入参**：`e.detail.value`（`YYYY-MM-DD` 字符串）
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterDate})` + `reload()`
- **契约风险**：`e.detail.value` 为空串时（用户取消选择）等价于清除筛选，行为可接受
- **WXML 绑定核查**：有绑定（`wxml:24`）

#### `### clearDateFilter()` `(report-list.js:115-118)`
- **触发方式**：`bindtap="clearDateFilter"`（`report-list.wxml:30`，`wx:if="{{filterDate}}"`）
- **入参**：无
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterDate:''})` + `reload()`
- **契约风险**：无
- **WXML 绑定核查**：有绑定（`wxml:30`）

#### `### goHistory()` `(report-list.js:120-122)`
- **触发方式**：`bindtap="goHistory"`（`report-list.wxml:7`）
- **入参**：无
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：`wx.navigateTo({url:'/pages/report-history/report-history'})`，**不传任何参数**
- **契约风险**：无
- **WXML 绑定核查**：有绑定（`wxml:7`）

#### `### generateSummary()` `(report-list.js:125-156)`
- **触发方式**：`bindtap="generateSummary"`（`report-list.wxml:6`）
- **入参**：`getApp().globalData.userInfo.role`；`wx.showActionSheet` 的 `res.tapIndex`
- **调用云函数**：`generateSummaryReport`（`report-list.js:142-146`），参数：`period`（`'daily'|'monthly'`）、`date`（**前端 `new Date()` 算出的 `YYYY-MM-DD`**）、`storeId`（`app.globalData.currentStore.storeId` 或空串）。**期望返回**：`{code, msg}`
- **成功/失败分支**：
  - 前端角色闸（:127-131）：`me` 不在 `['super_admin','purchaser']` → toast「仅管理员可生成汇总报表」并 return（**不发请求**）
  - 失败 `code!==0`（:148-151）→ toast `(result.msg) || '汇总报表生成失败'`
  - 成功（:152-153）→ `util.showSuccess('汇总报表已生成')` + `that.reload()`
- **副作用**：`wx.showActionSheet`、`util.showLoading('生成中...')` → `wx.hideLoading()`（**注意**：`hideLoading` 在 `await` 之后、`code` 判断之前调用，:147，顺序正确）
- **契约风险**：
  1. **`date` 用客户端时钟生成**（:136-138）—— 客户端时间被篡改或跨日边界时，前端显示的"今日"与服务端"今日"可能不一致；`period`/`date` 均可由客户端决定，最终权限仍取决于后端（未验证后端是否用会话覆盖）
  2. 前端角色闸与后端 `GLOBAL_ROLES` 口径一致性依赖注释声明（:126），后端实际校验**未验证**
  3. `wx.hideLoading` 在 `fail` 分支外无条件执行；若 `callFunction` 本身抛同步异常（不会，`cloud.js:65-75` 已 try/catch 包裹），mask 会残留 —— 此处无实际问题
  4. `util.showSuccess` 内部也是 `wx.showToast`（`util.js:68-70`），与 `hideLoading` 同属 toast 通道，存在**"生成成功"提示被下一个 `showToast` 覆盖**的竞态可能（未验证实际时序）
- **WXML 绑定核查**：有绑定（`wxml:6`）

#### `### goDetail(e)` `(report-list.js:158-162)`
- **触发方式**：`bindtap="goDetail"`（`report-list.wxml:34`，卡片整体）
- **入参**：`e.currentTarget.dataset.id` ← `data-id="{{item.reportId}}"`
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：`wx.navigateTo({url:'/pages/report-detail/report-detail?id='+id})`
- **契约风险**：`id` 未编码（`encodeURIComponent`）；`reportId` 通常是无特殊字符的雪花/ULID 串，实际风险低
- **WXML 绑定核查**：有绑定（`wxml:34`）

### 2.2 `report-detail.js`

#### `### onLoad(options)` `(report-detail.js:18-80)`
- **触发方式**：框架生命周期
- **入参**：`options.id` → `reportId`（:20）。**未校验 `options.id` 是否存在**：若为空/undefined，仍会带 `reportId: undefined` 发请求（后端行为未验证）
- **调用云函数**：`getReportDetail`（`report-detail.js:24-26`），参数仅 `reportId`。**期望返回**：`{code, data: Report 原始文档}`
- **成功/失败分支**：
  - 成功 `code===0 && result.data`（:29）：
    - 组装 `rpt`（:32-44）：保留原始 `...report` 展开，显式规范化 `reportType`/`scopeName`/`relatedDate`/`generatedAt`/`fileVersion`/`reportScope`/`sourceOrderId`/`hasAbnormal`/`abnormalSummary`
    - **前端推算异常**（:48-52）：`rows.some(row => row.abnormal)` 为真则 `hasAbnormal=true`；若后端未给 `abnormalSummary`，用 `rows[*].abnormalTypeNames` 去重后 join('、') 兜底
    - **前端算合计**（:53-66）：`reportType` 含 `'price'` → 只累加 `payable !== false && !isManual` 的 `Number(r.subtotal)||0`，`toFixed(2)`，并生成 `excludedNote`；含 `'summary'` → 累加所有 `r.subtotal||0`；**其它 6 种报表类型 `totalAmount` 恒为 `'0.00'`**（但 wxml 只在 price/summary 两个 block 里显示合计，见 `report-detail.wxml:95-100, 135-141`，故不可见，无实际误导）
  - 失败（:77-79）：**仅 `util.showToast('加载失败')`**，`setData` 完全不执行 → `data` 停在初始值 `{report:{}, rows:[], totalAmount:'0.00'}` → `report.reportType` 为 `undefined` → wxml 所有 6 个 `wx:if/wx:elif` block 全不命中 → 落到 `wx:else`（`report-detail.wxml:145-147`）显示「报表数据加载中...」。**永久卡死，无任何重试入口**。详见第 4 节。
- **副作用**：`util.showLoading('加载报表...')`（:22）→ `util.hideLoading()`（:27，**在 `await` 之后无条件执行，顺序正确**）
- **契约风险**：
  1. **失败态与加载态视觉完全相同**（永远"加载中"），且 toast 2 秒后消失即无任何线索
  2. 合计金额**完全在前端计算**（:58-65），与下载文件是否对平只依赖"与 Excel 生成口径一致"的注释声明（:54-55）；前端与后端两处实现口径漂移即错位
  3. `report.fileUrl` 由后端原始文档透传（:98 读 `report.fileUrl || report.file_url`）—— `getReportDetail` 是否真的返回 `file_url` 字段，**未验证**（需读云函数）
- **WXML 绑定核查**：无绑定（框架生命周期）

#### `### goSourceOrder()` `(report-detail.js:83-87)`
- **触发方式**：`bindtap="goSourceOrder"`（`report-detail.wxml:13` 报表头链接、`wxml:54` 收货报表行商品名、`wxml:89` 带价格收货报表行商品名）
- **入参**：**无参**。函数体读 `this.data.report.sourceOrderId`（:84）；**`wxml:89` 处传了 `data-order-id="{{item.purchaseOrderId}}"` 但本方法完全不读 `e.currentTarget.dataset`**（见 §7 死参）
- **调用云函数**：无
- **成功/失败分支**：`!orderId` → 静默 return（:85），不提示
- **副作用**：`wx.navigateTo({url:'/pages/purchase-detail/purchase-detail?id='+orderId})`
- **契约风险**：`wxml:13` 用 `wx:if="{{report.reportScope === 'store' && report.sourceOrderId}}"` 双重门控（仅门店作用域显示），但 `wxml:54`、`wxml:89` **无门控**——只要 `report.sourceOrderId` 非空，行内链接就可能出现。若某类行级明细需要不同订单号，行点击会错跳到报表头那个单一 `sourceOrderId`
- **WXML 绑定核查**：有绑定（`wxml:13, 54, 89`）

#### `### goRowOrder(e)` `(report-detail.js:90-94)`
- **触发方式**：`bindtap="goRowOrder"`（`report-detail.wxml:72` 供应商到货、`wxml:90` 供应商带价格账单、`wxml:112` 供应商订货）
- **入参**：`e.currentTarget.dataset.orderId` ← `data-order-id="{{item.purchaseOrderId}}"`
- **调用云函数**：无
- **成功/失败分支**：`!orderId` → 静默 return
- **副作用**：`wx.navigateTo` → `purchase-detail?id=`
- **契约风险**：依赖后端 `rows[].purchaseOrderId` 字段名；若后端给的是 snake_case `purchase_order_id`，`dataset.orderId` 恒为空 → 点击静默无反应。`report-detail.js:91` 读 `dataset.orderId`，而 `wxml` 的 `data-order-id="{{item.purchaseOrderId}}"` 用的是 camelCase，**两边一致**；但后端是否按 camelCase 返回 `rows` 元素，**未验证**
- **WXML 绑定核查**：有绑定（`wxml:72, 90, 112`）

#### `### exportReport()` `(report-detail.js:96-125)`
- **触发方式**：`bindtap="exportReport"`（`report-detail.wxml:152` 按钮「导出报表文件」）
- **入参**：无参，读 `this.data.report.fileUrl || report.file_url`
- **调用云函数**：`getReportFileUrl`（`report-detail.js:100-102`），参数 `fileId: report.fileUrl || report.file_url`。**期望返回**：`{code, data: {url}}`
- **成功/失败分支**（3 级）：
  1. 无 `fileUrl`/`file_url`（:122-124）→ toast「该报表尚未生成可下载文件」
  2. `fileResult.code !== 0` 或 `!fileResult.data`（:103-105, 119-121）→ toast「文件链接获取失败」
  3. 拿到 `fileUrl`（:106-118）→ `wx.downloadFile({url: fileUrl})`：
     - `fail`（:117）→ toast「下载失败」
     - `success` → `wx.openDocument({filePath: res.tempFilePath, showMenu: true})`：
       - `success`（:113）→ `util.showSuccess('文件已打开')`
       - `fail`（:114）→ toast「打开失败」
- **副作用**：`wx.downloadFile`、`wx.openDocument(showMenu:true)`、多次 `wx.showToast`。**不使用 `wx.cloud.downloadFile` / `wx.cloud.saveFile` / `wx.showShareMenu`**，也不走 `utils/cloud.js` 的 `getFileUrl`/`getFileUrls`（`cloud.js:243-268`）—— 导出链路完全绕开网关的无鉴权直连路径，改用 `getReportFileUrl` 云函数换链接。转发/另存能力来自 `showMenu: true`（:112），不是 `wx.showShareMenu`
- **契约风险**（**这是全批最关键的契约点，详见第 4 节**）：
  1. **`wx.openDocument` 未传 `fileType`**（:110-115 只有 `filePath` + `showMenu`）。按微信公开文档 `fileType` 枚举为 `doc/docx/xls/xlsx/ppt/pptx/pdf`，**不含 `csv`**；不传时由文件扩展名推断，`.csv` 推断不到合法类型 → 预期走 `fail` → toast「打开失败」。**真机行为未验证**（需开发者工具/真机确认失败文案）
  2. `wx.downloadFile` 的 `url` 是云存储临时链接（`getReportFileUrl` 返回），若该域名未配置进小程序后台 `downloadFile` 合法域名，下载直接 fail。域名配置**未验证**
  3. 全链路**无 loading mask**：导出过程没有任何 `showLoading`，按钮可连点（无 `_submitting` 之类的防抖），多次点击会并发触发多次 `openDocument`
  4. 失败后**无重试入口**：按钮仍在，用户只能再点一次；`report-detail` 无 `onShow`，返回再进也不会重拉
- **WXML 绑定核查**：有绑定（`wxml:152`）

### 2.3 `report-history.js`

#### `### onShow()` `(report-history.js:27-38)`
- **触发方式**：框架生命周期
- **入参**：无
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：重建 `reportTypeOptions`（:29-34，含 `{value:'', label:'全部类型'}` + `meta.reportTypeMap` 全部 8 个 key）；再按 `this.data.filterType` 反查 `selectedType` 重算 `filterTypeLabel`（:35-36，未命中回退 `'全部类型'`）；然后 `reload()`
- **副作用**：`setData`
- **契约风险**：`onShow` 每次返回都重建选项数组，若 `picker` 的选中态丢失，视觉标签会重置为"全部类型"而 `filterType` 仍在 —— 轻微口径错位（未验证实际表现）
- **WXML 绑定核查**：无绑定

#### `### onPullDownRefresh()` `(report-history.js:40-42)`
- **触发方式**：`.json` 的 `enablePullDownRefresh: true`（`report-history.json:4`）
- **入参**：无
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：`.finally(() => wx.stopPullDownRefresh())`
- **副作用**：`wx.stopPullDownRefresh()`
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### onReachBottom()` `(report-history.js:44-47)`
- **触发方式**：滚到底部（`.json` **未声明 `onReachBottomDistance`**，用默认值）
- **入参**：读 `isLoadingMore` / `hasMore`
- **调用云函数**：间接 → `getReports(page+1, true)`
- **成功/失败分支**：无
- **副作用**：无
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### reload()` `(report-history.js:49-52)`
- **触发方式**：`onShow`、`onPullDownRefresh`、`onScopeChange`、`onTypeChange`、`onDateChange`、`clearDate`
- **入参**：无
- **调用云函数**：间接 → `getReports(1,false)`
- **成功/失败分支**：`setData({page:1, hasMore:true})` 后调用；**不清空 `reports`**（同 `report-list`）
- **副作用**：`setData`
- **契约风险**：同 `report-list.reload`
- **WXML 绑定核查**：无绑定

#### `### loadReports(page, append)` `(report-history.js:54-87)`
- **触发方式**：`reload()` / `onReachBottom()`
- **入参**：`page`、`append`
- **调用云函数**：`getReports`（`report-history.js:60-68`），参数：`role`（`app.globalData.userInfo.role || 'purchaser'`）、`storeId`（`app.globalData.currentStore.storeId || ''`）、`reportScope`（`filterScope!=='all'` 时传值，否则空串）、`reportType`（`filterType`）、`relatedDate`（`filterDate`）、`page`、`pageSize=20`（:7）。**期望返回**：`{code, data: Report[], total, msg}`
- **成功/失败分支**：
  - 成功（:70-82）→ `normalizeReport` + `typeLabel/typeIconClass/typeColor`；**注意：与 `report-list` 不同，这里不计算 `hasAbnormal`/`abnormalSummary`/`abnormalLabel`**（:71-79），因此历史页卡片无法显示异常标记
  - 失败（:83-86）→ `setData({isLoadingMore:false})` + toast
- **副作用**：`setData`
- **契约风险**：
  1. **`total` 被读到（:81）但从未写入 `data`** —— 只用于算 `hasMore`，导致 `report-history.wxml:5` 的「共 N 份报表」只能读 `reports.length`（已加载条数）。这是旧审计指出的问题，**本次确认仍未修**
  2. `role`/`storeId` 由前端传入（:61-62），同 `report-list`
- **WXML 绑定核查**：无绑定（内部）

#### `### onScopeChange(e)` `(report-history.js:89-93)`
- **触发方式**：`bindchange="onScopeChange"`（`report-history.wxml:11`）
- **入参**：`e.detail.value`（picker 下标）→ `this.data.scopeOptions[下标].value`
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterScope})` + `reload()`
- **契约风险**：**未做下标越界校验**；`scopeOptions` 是 `data` 里的固定 3 项数组（:20-24），实际不可能越界
- **WXML 绑定核查**：有绑定（`wxml:11`）

#### `### onTypeChange(e)` `(report-history.js:95-99)`
- **触发方式**：`bindchange="onTypeChange"`（`report-history.wxml:14`）
- **入参**：`e.detail.value` → `this.data.reportTypeOptions[下标]` → `{value, label}`
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterType, filterTypeLabel})` + `reload()`
- **契约风险**：**同样未做下标越界校验**；`selected` 为 undefined 时会 `TypeError: Cannot read properties of undefined (reading 'value')`。理论不可达（`picker` 只返回合法下标）
- **WXML 绑定核查**：有绑定（`wxml:14`）

#### `### onDateChange(e)` `(report-history.js:101-104)`
- **触发方式**：`bindchange="onDateChange"`（`report-history.wxml:19`）
- **入参**：`e.detail.value`
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterDate})` + `reload()`
- **WXML 绑定核查**：有绑定（`wxml:19`）

#### `### clearDate()` `(report-history.js:106-109)`
- **触发方式**：`bindtap="clearDate"`（`report-history.wxml:22`，`wx:if="{{filterDate}}"`）
- **入参**：无
- **调用云函数**：间接 → `getReports`
- **成功/失败分支**：无
- **副作用**：`setData({filterDate:''})` + `reload()`
- **WXML 绑定核查**：有绑定（`wxml:22`）

#### `### goDetail(e)` `(report-history.js:111-114)`
- **触发方式**：`bindtap="goDetail"`（`report-history.wxml:27`）
- **入参**：`e.currentTarget.dataset.id` ← `data-id="{{item.reportId}}"`
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：`wx.navigateTo` → `report-detail?id=`
- **契约风险**：同 `report-list.goDetail`
- **WXML 绑定核查**：有绑定（`wxml:27`）

### 2.4 供应商端 5 页

#### `### supplier-home · onShow()` `(supplier-home.js:24-49)`
- **触发方式**：框架生命周期
- **入参**：无
- **调用云函数**：间接 → `getSupplierOrders`、`dataService.getMessages`
- **成功/失败分支**：`requireLogin()` 失败 return；`!app.globalData.isLoggedIn` → `wx.redirectTo('/pages/login/login')` return（:29-32）；`user.role !== 'supplier'` → `wx.reLaunch('/pages/index/index')` return（:35-38）
- **副作用**：`wx.hideHomeButton()`（:27）、`setData({supplierName, contactName, contactPhone, userName})`（:40-45）、随后并发调用 `loadStats()` / `loadNotice()` / `requestNewOrderSubscribe()`（**均不 `await`**，:46-48）
- **契约风险**：`supplierInfo` 取 `app.globalData.supplierInfo || wx.getStorageSync('supplierInfo') || {}`（:39）—— 供应商名称等**纯本地缓存**展示，无云函数核对；`supplierName` 缺省显示 `'供货商'`
- **WXML 绑定核查**：无绑定

#### `### supplier-home · loadNotice()` `(supplier-home.js:51-62)`
- **触发方式**：`onShow` 内部调用
- **入参**：无
- **调用云函数**：`dataService` + `action: 'getMessages'`（**无任何参数**，:53）。**期望返回**：`{code, data: Message[]}`
- **成功/失败分支**：`!res || res.code !== 0` → **静默 return**（:54，不 toast，不提示）
- **副作用**：`setData({unreadCount, latestMessage})`；`unreadCount = messages.filter(m => !m.read).length`；`latestMessage` 只取 `messages[0]` 的 `{title, content}`
- **契约风险**：
  1. **失败静默**：消息拉取失败时首页通知条按 `unreadCount=0` + `latestMessage=null` 渲染，`wxml:14` 的 `wx:if="{{unreadCount > 0 || latestMessage}}"` 使通知条整体消失 —— 用户无法区分"无消息"和"接口失败"
  2. 依赖 `dataService.getMessages` 在后端按会话过滤，**未验证**（否则供应商可见内部消息）
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-home · goMessages() / goMessageCenter()` `(supplier-home.js:64-71)`
- **触发方式**：`goMessages` ← `bindtap`（`wxml:38`「我的消息」入口项）；`goMessageCenter` ← `bindtap`（`wxml:14` 通知条）
- **入参**：无
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：两者都 `wx.navigateTo({url:'/pages/supplier-messages/supplier-messages'})`
- **契约风险**：**两个方法体完全相同**，纯冗余（见 §7 死代码 B-1）
- **WXML 绑定核查**：均有绑定

#### `### supplier-home · requestNewOrderSubscribe()` `(supplier-home.js:73-81)`
- **触发方式**：`onShow` 内部调用
- **入参**：无
- **调用云函数**：无
- **成功/失败分支**：`if (!NEW_ORDER_TEMPLATE_ID || !wx.requestSubscribeMessage) return`（:76）
- **副作用**：`wx.requestSubscribeMessage({tmplIds, complete:()=>{}})`
- **契约风险**：**完全死代码**。`NEW_ORDER_TEMPLATE_ID = ''`（`supplier-home.js:7`）恒为空串 → :76 恒 return，`wx.requestSubscribeMessage` 永远不会执行。注释（:6-7、:73-74）说明模板 ID 待申请后填入
- **WXML 绑定核查**：**无绑定**

#### `### supplier-home · loadStats()` `(supplier-home.js:83-93)`
- **触发方式**：`onShow` 内部调用
- **入参**：无
- **调用云函数**：`getSupplierOrders`（:85），参数 `{page: 1, pageSize: 1}`。**期望返回**：`{code, statusCounts}` —— **只取 `statusCounts`，丢弃 `data`**（`pageSize` 压到 1 的注释在 :84）
- **成功/失败分支**：`!res || res.code !== 0 || !res.statusCounts` → **静默 return**（:86），`stats` 保持初始值 `value: 0`
- **副作用**：`setData({stats})`，按 `item.key`（`pending`/`confirmed`/`shipped`）从 `counts` 取值，缺省 0
- **契约风险**：
  1. **用 1 条订单的完整明细请求换取计数**，带宽浪费（虽已把 `pageSize` 压到 1）
  2. 首页 `stats` 只有 3 个 key，而 `supplier-orders` 的 `TABS` 有 5 个（`pending/confirmed/shipped/done/all`，`supplier-orders.js:7-13`）—— `done`、`all` 的计数在首页不可见
  3. **失败静默**：统计条停留在全 0，用户无法判断是"没有订单"还是"接口失败"
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-home · goStatPage(e)` `(supplier-home.js:95-98)`
- **触发方式**：`bindtap="goStatPage"`（`wxml:28`）
- **入参**：`e.currentTarget.dataset.status` ← `data-status="{{item.key}}"`（`pending`/`confirmed`/`shipped`）
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：`wx.navigateTo('/pages/supplier-orders/supplier-orders?status='+status)`
- **契约风险**：无（目标页 `onLoad` 会校验 `status` 是否属于 `TABS` key，`supplier-orders.js:29-31`）
- **WXML 绑定核查**：有绑定（`wxml:28`）

#### `### supplier-home · goOrders() / goReceipts() / goPrices() / goAccount()` `(supplier-home.js:100-114)`
- **触发方式**：分别为 `wxml:47, 55, 63, 71`
- **入参**：无
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：依次 `navigateTo` → `supplier-orders` / `supplier-receipts` / `supplier-prices` / `account`（**`account` 不在本批范围**）
- **契约风险**：无
- **WXML 绑定核查**：均有绑定

#### `### supplier-home · switchAccount()` `(supplier-home.js:116-133)`
- **触发方式**：`bindtap="switchAccount"`（`wxml:81` 按钮「退出登录」）
- **入参**：无
- **调用云函数**：`authService` + `action: 'logout'`（:120）。**期望返回**：未检查（`await` 后不读 `code`）
- **成功/失败分支**：
  - `util.showConfirm('退出当前供货商账号？')` 取消 → return（:117-118）
  - **`logout` 云函数失败也继续执行本地清理与跳转**（:120-132 无 `code` 判断）—— 本地会话被清，但服务端会话可能仍有效（未验证 `logout` 是否做服务端失效）
- **副作用**：`app.globalData` 全部清空（:121-125）、6 个 `wx.removeStorageSync`（:126-131：`userInfo`/`currentStore`/`supplierInfo`/`authToken`/`sessionExpiresAt`/`account_history`）、`wx.reLaunch('/pages/login/login')`
- **契约风险**：**云函数调用无 `code` 校验**；且与 `cloud.js` 的统一 401 处理无交互
- **WXML 绑定核查**：有绑定（`wxml:81`）

#### `### supplier-orders · onLoad(options)` `(supplier-orders.js:27-32)`
- **触发方式**：框架生命周期
- **入参**：`options.status` → 校验 `TABS.some(t => t.key === options.status)` 才写入 `activeTab`（:29-31）
- **调用云函数**：无
- **成功/失败分支**：非法值静默忽略（保留默认 `'pending'`）
- **副作用**：`setData({activeTab})`
- **契约风险**：入参校验正确，是本批唯一对导航参数做白名单校验的页面
- **WXML 绑定核查**：无绑定

#### `### supplier-orders · onShow()` `(supplier-orders.js:34-46)`
- **触发方式**：框架生命周期
- **入参**：无
- **调用云函数**：间接 → `getSupplierOrders`
- **成功/失败分支**：未登录 → `redirectTo /login` return；非 supplier → `reLaunch /index` return
- **副作用**：`reload()`
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### supplier-orders · onReachBottom()` `(supplier-orders.js:48-52)`
- **触发方式**：滚到底部（`.json` 声明 `onReachBottomDistance: 50`）
- **入参**：`orders.length`、`total`、`loading`
- **调用云函数**：间接 → `getSupplierOrders(page+1, true)`
- **成功/失败分支**：`loading || orders.length >= total` → return
- **副作用**：无
- **契约风险**：`orders.length >= total` 判据在**分页失败后 `total` 未更新**时会提前停止加载（:74-77 失败路径不更新 `total`，但 `orders.length` 也不会增长，因此不会误判为"全部加载完"—— 逻辑闭合）
- **WXML 绑定核查**：无绑定

#### `### supplier-orders · switchTab(e)` `(supplier-orders.js:54-59)`
- **触发方式**：`bindtap="switchTab"`（`wxml:8`）
- **入参**：`e.currentTarget.dataset.key`
- **调用云函数**：间接 → `getSupplierOrders`
- **成功/失败分支**：`key === this.data.activeTab` → return（:56，避免重复请求）
- **副作用**：`setData({activeTab})` + `reload()`
- **契约风险**：无
- **WXML 绑定核查**：有绑定（`wxml:8`）

#### `### supplier-orders · reload()` `(supplier-orders.js:61-63)`
- **触发方式**：`onShow`、`switchTab`、`doAction` 成功回调
- **入参**：无
- **调用云函数**：间接 → `getSupplierOrders(1, false)`
- **成功/失败分支**：无
- **副作用**：无直接 `setData`
- **契约风险**：无
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-orders · loadOrders(page, append)` `(supplier-orders.js:65-85)`
- **触发方式**：`reload()` / `onReachBottom()`
- **入参**：`page`、`append`
- **调用云函数**：`getSupplierOrders`（`supplier-orders.js:68-72`），参数：`confirmStatus: this.data.activeTab`（**取自前端 TABS key**）、`page`、`pageSize: this.data.pageSize`（20）。**期望返回**：`{code, data: Order[], total, statusCounts}`
- **成功/失败分支**：
  - `!res || res.code !== 0`（:74-77）→ toast `(res.msg) || '订单加载失败，请稍后重试'`，`orders` 保持旧值
  - 成功（:78-84）→ `decorateOrder` 逐条装饰 → `setData({orders, page, total, statusCounts})`
- **副作用**：`setData`
- **契约风险**：
  1. `setData({loading:false})` 在 `await` 之后**无条件执行**（:73），失败路径也释放 loading —— 正确
  2. **`confirmStatus` 由前端决定**（:69），值为 TABS 的 key；后端若不做映射校验，前端可传任意字符串。传什么字符串是否会导致后端抛错或返回越权数据，**未验证**
  3. `loading` 在 wxml 仅用于抑制空态（`wxml:43`），**无加载态 UI** —— 首屏请求期间页面空白
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-orders · decorateOrder(order)` `(supplier-orders.js:87-101)`
- **触发方式**：`loadOrders` 内部调用
- **入参**：后端原始 order 对象
- **调用云函数**：无（但调用 `cloud.normalizePurchaseOrder` 与 `meta.getStatusInfo`/`meta.getSupplierConfirmInfo`）
- **成功/失败分支**：无
- **副作用**：返回新对象，附加 `myConfirmStatus`（`order.my_confirm_status || 'pending'`）、`statusText`、`statusType`、`confirmText`、`confirmType`、`canConfirm`（`my_confirm_status === 'pending'`）、`canShip`（`=== 'confirmed'`）
- **契约风险**：
  1. **`canConfirm`/`canShip` 由前端根据 `my_confirm_status` 计算**（:98-99），只控制按钮显隐；真正的写权限必须由 `confirmSupplierOrder` 后端校验
  2. 读的是 snake_case `order.my_confirm_status`（:90, :98, :99），而 `normalizePurchaseOrder` 不认识这个字段（`cloud.js:139-169` 无映射），故必须直接读原文 —— 契约口径分裂（同一对象既有 camelCase 又有 snake_case）
  3. `my_confirm_status` 为 `undefined` 时 `canConfirm=false` 但 `myConfirmStatus` 兜底为 `'pending'` → **按钮不显示但标签显示"待确认"**，状态与可操作性矛盾
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-orders · confirmOrder(e)` `(supplier-orders.js:103-108)`
- **触发方式**：`catchtap="confirmOrder"`（`wxml:38`，`wx:if="{{item.canConfirm}}"`）
- **入参**：`e.currentTarget.dataset.id` ← `data-id="{{item.purchaseOrderId}}"`
- **调用云函数**：间接 → `confirmSupplierOrder`
- **成功/失败分支**：`util.showConfirm('确认接收该订单并开始备货？')` 取消 → return
- **副作用**：转调 `doAction(orderId, 'confirm', '已确认接单')`
- **契约风险**：`catchtap`（非 `bindtap`）阻止冒泡，正确；`orderId` 无空值校验（`!orderId` 时仍会发请求）
- **WXML 绑定核查**：有绑定（`wxml:38`）

#### `### supplier-orders · shipOrder(e)` `(supplier-orders.js:110-115)`
- **触发方式**：`catchtap="shipOrder"`（`wxml:39`，`wx:if="{{item.canShip}}"`）
- **入参**：`e.currentTarget.dataset.id`
- **调用云函数**：间接 → `confirmSupplierOrder`
- **成功/失败分支**：确认弹窗取消 → return
- **副作用**：转调 `doAction(orderId, 'ship', '已标记发货')`
- **契约风险**：同 `confirmOrder`
- **WXML 绑定核查**：有绑定（`wxml:39`）

#### `### supplier-orders · doAction(orderId, action, successText)` `(supplier-orders.js:117-130)`
- **触发方式**：`confirmOrder` / `shipOrder` 内部调用
- **入参**：`orderId`（字符串）、`action`（`'confirm'`|`'ship'`）、`successText`
- **调用云函数**：`confirmSupplierOrder`（:121），参数仅 `{orderId, action}`。**期望返回**：`{code, msg}`
- **成功/失败分支**：
  - `this._submitting` 为真 → 直接 return（:118-119，**防连点，且无提示**）
  - `code === 0`（:124-126）→ `util.showSuccess(successText)` + `this.reload()`
  - 否则（:127-129）→ toast `(res.msg) || '操作失败，请稍后重试'`
- **副作用**：`this._submitting = true/false`（**实例属性，非 `data`**，不进 diff）、`util.showLoading('提交中...')` → `util.hideLoading()`（:122，无条件执行）
- **契约风险**：
  1. **`_submitting` 若在 `await` 中抛异常不会被复位**（:123 在 `callFunction` 之后）。实际 `cloud.callFunction` 已内部 try/catch（`cloud.js:65-75`）不会抛，故无实际死锁
  2. `orderId` 完全由前端提供 —— **越权关键面**，详见第 5 节
  3. `action` 只接受 `'confirm'`/`'ship'`，前端硬编码，无注入路径
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-receipts · onShow()` `(supplier-receipts.js:15-28)`
- **触发方式**：框架生命周期
- **入参**：无
- **调用云函数**：间接 → `getSupplierReceipts`
- **成功/失败分支**：未登录 → `redirectTo /login`；非 supplier → `reLaunch /index`
- **副作用**：`loadReceipts(1, false)`
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### supplier-receipts · onReachBottom()` `(supplier-receipts.js:30-34)`
- **触发方式**：滚到底部（`.json` 声明 `onReachBottomDistance: 50`）
- **入参**：`items.length`、`total`、`loading`
- **调用云函数**：间接 → `getSupplierReceipts(page+1, true)`
- **成功/失败分支**：`loading || items.length >= total` → return
- **副作用**：无
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### supplier-receipts · loadReceipts(page, append)` `(supplier-receipts.js:36-81)`
- **触发方式**：`onShow` / `onReachBottom`
- **入参**：`page`、`append`
- **调用云函数**：`getSupplierReceipts`（:39-42），参数仅 `{page, pageSize: this.data.pageSize}`（20）。**期望返回**：`{code, data: ReceiptItem[], total, msg}`
- **成功/失败分支**：`!res || res.code !== 0`（:44-46）→ toast；`loading` 在 `await` 后无条件置 false（:43）
- **副作用**：`setData({items, page, total})`
- **前端计算**（:48-75）：`receivedQty = Number(item.received_qty)||0`、`orderQty = Number(item.order_qty_snapshot)||0`、`abnormal = !item.is_manual && (receivedQty !== orderQty || item.payable_flag === false)`（:53）、`abnormals` 逐条映射（:55-65，含 `type`/`status` 中文映射与 `payment_decision` 裁决文案）、`priceText = '¥' + (Number(item.price_snapshot)||0).toFixed(2)`、`amountText = '¥' + (Number(item.amount)||0).toFixed(2)`
- **契约风险**：
  1. **`abnormal` 判定完全在前端**（:53），与后端 `receipt.abnormal` 口径可能不一致；供应商看到的"异常/正常"标签（`wxml:6-7`）不反映后端裁决状态
  2. 字段全是 snake_case 原文（`received_qty`/`order_qty_snapshot`/`price_snapshot`/`payable_flag`/`is_manual`/`receipt_item_id`），**未走 `cloud.normalizePurchaseItem`**，与 `supplier-orders` 用 `normalizePurchaseOrder` 的口径不一致
  3. `abnormal` 的 `payable_flag === false` 判据：`payable_flag` 缺失时为 `undefined !== false`，不误判 —— 逻辑正确
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-prices · onShow()` `(supplier-prices.js:12-25)`
- **触发方式**：框架生命周期
- **入参**：无
- **调用云函数**：间接 → `getProductPrices`
- **成功/失败分支**：未登录 → `redirectTo /login`；非 supplier → `reLaunch /index`
- **副作用**：`loadPrices()`
- **契约风险**：无
- **WXML 绑定核查**：无绑定

#### `### supplier-prices · loadPrices()` `(supplier-prices.js:27-41)`
- **触发方式**：`onShow`
- **入参**：无
- **调用云函数**：`getProductPrices`（:30），参数仅 `{onlyCurrent: true}`。注释（:29）声称「云函数会为供货商角色强制限定只能查自己的价格」—— **该断言未验证**
- **成功/失败分支**：`!res || res.code !== 0`（:32-35）→ toast「价格数据加载失败，请稍后重试」；`loading` 在 `await` 后无条件置 false（:31）
- **副作用**：`setData({prices})`，`priceText = '¥' + (Number(item.price)||0).toFixed(2)`
- **契约风险**：
  1. **失败态伪装为空态**：`supplier-prices.wxml:15` 是 `wx:if="{{prices.length === 0 && !loading}}"` —— 请求失败后 `prices` 仍为空数组且 `loading=false` → 页面显示「暂无生效中的协议价格」，与"确实没有价格"完全无法区分
  2. **无分页、无下拉刷新、无重试入口**：`.json` 未声明 `enablePullDownRefresh`/`onReachBottomDistance`，JS 无 `onPullDownRefresh`
  3. 字段用 snake_case 原文（`price_id`/`product_name`/`unit`/`effective_date`），**未走 `cloud.normalizePrice`**
  4. **前端格式化价格文本**（`toFixed(2)`），展示口径自洽但后端改字段会静默变 0
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-messages · onShow()` `(supplier-messages.js:12-21)`
- **触发方式**：框架生命周期（`async`）
- **入参**：无
- **调用云函数**：间接 → `dataService.getMessages`
- **成功/失败分支**：`!app.globalData.isLoggedIn || user.role !== 'supplier'` → `wx.reLaunch('/pages/login/login')` return（:16-18）
- **副作用**：`await this.loadMessages()`（**这是本批唯一 `await` 数据加载的生命周期**）
- **契约风险**：**守卫口径与另 4 个供应商页不一致**（见 §1.9）
- **WXML 绑定核查**：无绑定

#### `### supplier-messages · loadMessages()` `(supplier-messages.js:23-36)`
- **触发方式**：`onShow`
- **入参**：无
- **调用云函数**：`dataService` + `action: 'getMessages'`（**无参数**，:24）。**期望返回**：`{code, data: Message[]}`
- **成功/失败分支**：`!result || result.code !== 0`（:25-28）→ toast「消息加载失败」；`loading` 未定义（data 中无此键）→ 加载中无 UI
- **副作用**：`setData({messages, unreadCount})`；每条映射 `time = cloud.formatDateTime(m.time)`、`timeAgo = util.getRelativeTime(cloud.formatDateTime(m.time))`（:31-32，**两次重复调用 `formatDateTime`**）
- **契约风险**：`timeAgo` 只对「过去时间」有意义；若后端 `time` 是将来时间（时钟偏差），`getRelativeTime` 的 `diff` 为负 → `minutes<1` 命中返回 `'刚刚'`（`util.js:54`），不报错但语义错
- **WXML 绑定核查**：无绑定（内部）

#### `### supplier-messages · readMessage(e)` `(supplier-messages.js:38-57)`
- **触发方式**：`bindtap="readMessage"`（`wxml:8`）
- **入参**：`e.currentTarget.dataset.id` ← `data-id="{{item.id}}"`
- **调用云函数**：`dataService` + `action: 'markMessageRead', id`（**仅当该条未读时**，:43-49）。**期望返回**：`{code, msg}`
- **成功/失败分支**：
  - `idx < 0`（找不到 id）→ 静默 return（:41）
  - 未读 → `markMessageRead`；`result.code !== 0` → toast 并 `return`（:45）
  - 已读 → 跳过网络请求
  - **`message.bizId` 存在**（:52）→ `wx.navigateTo('/pages/supplier-orders/supplier-orders')` return
  - 否则 → `util.showToast('已读')`
- **副作用**：`setData({'messages[idx].read': true, unreadCount: max(0, -1)})`、`wx.navigateTo`、`wx.showToast`
- **契约风险**：
  1. **`bizId` 只用于判断存在，从不作为 URL 参数传递**（:52-54）—— 供应商点「订单通知」后进入 `supplier-orders` 默认 tab（`pending`），若该订单已确认/已发货，用户看不到目标订单。对比内部 `message.js:66` 会拼 `?id=` + `bizId`。详见 §5.4
  2. `markMessageRead` 传的是**前端持有的消息 id**，后端若不校验归属，可越权标记他人消息已读（未验证）
  3. 已读消息每次点击都会走 :52/:56 分支 → 重复点击已读消息每次都 toast「已读」或跳转
- **WXML 绑定核查**：有绑定（`wxml:8`）

#### `### supplier-messages · markAllRead()` `(supplier-messages.js:59-65)`
- **触发方式**：`bindtap="markAllRead"`（`wxml:5`「全部已读」，`wx:if="{{unreadCount > 0}}"`）
- **入参**：无
- **调用云函数**：`dataService` + `action: 'markAllMessagesRead'`（**无参数**，:60）。**期望返回**：`{code, msg}`
- **成功/失败分支**：`result.code !== 0` → toast「消息状态更新失败」；成功 → 本地全部置 `read:true`、`unreadCount:0`、`showSuccess('全部已读')`
- **副作用**：`setData`、`wx.showToast`
- **契约风险**：**`markAllMessagesRead` 无任何参数** —— 作用域完全由后端按会话决定；若后端未按会话过滤，供应商可一次性标记内部消息全部已读（**未验证**）
- **WXML 绑定核查**：有绑定（`wxml:5`）

---

## 3. ★ 专项一：WXML ↔ JS 双向对账（本批 8 页）

**核查方法**：对每个页面提取 wxml 中全部 `bindtap` / `catchtap` / `bindchange` 目标名与 js `Page({})` 方法键做集合差；再对 wxml 全部 `{{...}}` 插值与 `wx:if`/`wx:for` 条件中的根键做来源追溯。

### 3.1 A 类：wxml 引用了但 js 没有（点了没反应）

**结论：0 条。已逐页核实，全部 20 个事件绑定目标在对应 js 中都有同名方法。**

绑定清单（wxml:行号 → js:行号）：

| 页面 | wxml 绑定 | js 方法 |
|---|---|---|
| report-list | `generateSummary`(6)、`goHistory`(7)、`switchType`(15)、`onDateFilter`(24)、`clearDateFilter`(30)、`goDetail`(34) | :125 / :120 / :105 / :110 / :115 / :158 |
| report-detail | `goSourceOrder`(13,54,89)、`goRowOrder`(72,90,112)、`exportReport`(152) | :83 / :90 / :96 |
| report-history | `onScopeChange`(11)、`onTypeChange`(14)、`onDateChange`(19)、`clearDate`(22)、`goDetail`(27) | :89 / :95 / :101 / :106 / :111 |
| supplier-home | `goMessageCenter`(14)、`goStatPage`(28)、`goMessages`(38)、`goOrders`(47)、`goReceipts`(55)、`goPrices`(63)、`goAccount`(71)、`switchAccount`(81) | :69 / :95 / :64 / :100 / :104 / :108 / :112 / :116 |
| supplier-orders | `switchTab`(8)、`confirmOrder`(38)、`shipOrder`(39) | :54 / :103 / :110 |
| supplier-receipts | **0 个绑定**（整页只读） | — |
| supplier-prices | **0 个绑定**（整页只读） | — |
| supplier-messages | `markAllRead`(5)、`readMessage`(8) | :59 / :38 |

### 3.2 B 类：js 定义了但 wxml 没引用（页面死代码）

排除框架生命周期（`onLoad`/`onShow`/`onPullDownRefresh`/`onReachBottom`）与纯内部转调（`reload`/`loadXxx`/`decorateOrder`/`doAction`/`initTabs`），剩余：

**B-1 · `requestNewOrderSubscribe()`（`supplier-home.js:73-81`）— 完全死代码**
- 无 wxml 绑定；唯一调用点是 `onShow:48`。
- 函数首行 `if (!NEW_ORDER_TEMPLATE_ID || !wx.requestSubscribeMessage) return`（:76），而 `NEW_ORDER_TEMPLATE_ID = ''`（:7）**在源码中是硬编码空串** → 该判断恒为真 → 函数体 `wx.requestSubscribeMessage` **永远不可达**。
- 证据：`supplier-home.js:7` 的常量声明 + `:76` 的短路条件。这是**确定闭合**的死代码，不依赖任何后端行为。
- 连带死代码：`supplier-home.js:6-7` 的注释说明"模板 ID 申请通过后填入"—— 说明这是计划中但未落地的功能。

**B-2 · `goMessages()` 与 `goMessageCenter()` 功能完全重复（`supplier-home.js:64-71`）**
- 两者函数体均为 `wx.navigateTo({url:'/pages/supplier-messages/supplier-messages'})`，且**各自都有 wxml 绑定**（`goMessages` ← `wxml:38`，`goMessageCenter` ← `wxml:14`）。
- 严格意义上不属于 B 类（都有引用），属**冗余方法**。保留两个是为了"通知条"和"菜单入口"的语义区分，实际可合并为一个。

### 3.3 C 类：wxml 读的 data 键在 js 无来源（永远走默认分支）

**C-1 · `item.status`（"已作废"标签）来源不确定**
- `report-list.wxml:41` 与 `report-history.wxml:31` 均用 `wx:if="{{item.status === 'superseded'}}"` 渲染「已作废」标签。
- 但 `cloud.normalizeReport`（`utils/cloud.js:212-225`）**没有 `status` 字段的映射分支**（它只映射 `reportId/reportType/reportScope/scopeId/scopeName/relatedDate/generatedAt/fileVersion/fileUrl`）。
- `report-list.js:87` / `report-history.js:74` 的写法是 `...cloud.normalizeReport(r)` —— `normalizeReport` 内部 `...report` 展开会把后端原文的所有键原样带出，因此 `status` 仅在**后端原始文档里恰好存在名为 `status` 的键**时才有值。
- **结论**：`status` 键存在与否完全取决于后端返回体，前端无任何归一化保障。若后端改用 `fileStatus`/`state` 等命名，「已作废」标签会静默消失。**未验证：需读 `getReports` 云函数确认返回体是否含 `status`。**

**C-2 · `report-detail` 的 `rows` 元素字段全部为后端原文，零归一化**
- `report-detail.js:47` 直接 `const rows = report.rows || []`，**不调用 `cloud.normalizePurchaseItem`**，随后整体塞进 `setData({rows})`。
- wxml 依赖的字段名（全部按 camelCase 读取）：
  - `store_order_report`（`wxml:38-41`）：`productName`、`category`、`unit`、`orderQty`
  - `store_receipt_report`（`wxml:53-59`）：`receivedQty`、`orderQty`、`unit`、`abnormal`、`abnormalStatus`、`abnormalText`
  - `supplier_receipt_report`（`wxml:70-75`）：`purchaseOrderId`、`storeName`、`productName`、`receivedQty`、`unit`、`abnormal`、`abnormalStatus`、`abnormalText`
  - `*_receipt_price_report`（`wxml:87-93`）：`purchaseOrderId`、`productName`、`receivedQty || qty`、`unitPrice`、`subtotal`
  - `supplier_order_report`（`wxml:111-115`）：`purchaseOrderId`、`productName`、`storeName`、`orderQty || qty`、`unit`
  - `*_summary_report`（`wxml:128-133`）：`productName`、`supplierName`、`orderQty`、`receivedQty`、`subtotal`
- 另 `report-detail.js:48,51` 读 `row.abnormal`、`row.abnormalTypeNames`（用于前端推断异常）。
- **结论**：这些字段名必须与 `getReportDetail` 云函数的输出完全一致，**未验证**。注意同仓其它页（`supplier-receipts`）用 snake_case 原文，两处口径不同 —— 说明报表云函数与收货云函数**返回风格不一致**是既成事实，而非笔误。

**C-3 · `wx:key="productName"` 键冲突风险（`report-detail.wxml:128`）**
- 门店日/月汇总 block 用 `wx:key="productName"`。汇总报表按商品聚合，但同一商品可能来自不同供应商（`wxml:130` 明确渲染了 `{{item.supplierName}}` 列）—— 同商品 + 不同供应商的两行会 `productName` 撞键。
- 撞键后果：微信小程序会打 `key should be unique` 警告，长列表下可能出现行错位/渲染丢失。
- **结论**：键选择与数据模型不自洽。**未验证实际是否出现重复商品行**（取决于汇总逻辑是否跨供应商合并）。

**C-4 · 首帧空态闪现（3 个列表页）**
- `report-list` 初始 `reports: []`（`report-list.js:14`），`onShow → reload()` 是异步；首次渲染时 `wxml:59` 的 `wx:if="{{reports.length === 0}}"` 命中，**先闪一帧「暂无报表」再被数据覆盖**。
- `report-history` 同理（初始 `reports: []`，`wxml:39`）。
- `supplier-orders`（初始 `orders: []`）与 `supplier-receipts`（初始 `items: []`）**没有这个问题**：它们的空态条件都带 `&& !loading`（`wxml:43`、`wxml:25`），而 `loadOrders`/`loadReceipts` 是同步先 `setData({loading:true})`。
- **结论**：两个报表页缺少 loading 门控，首帧空态闪现。这是**确定存在**的视觉缺陷（不依赖后端）。

**C-5 · `report-detail` 失败后永久停在 `wx:else` 的「加载中」占位**
- `report-detail.wxml:144-147` 的 `wx:else` 显示「报表数据加载中...」。
- 6 个报表 block 的 `wx:if/wx:elif` 覆盖 `store_order_report`、`store_receipt_report`、`supplier_receipt_report`、`store_receipt_price_report`、`supplier_receipt_price_report`、`supplier_order_report`、`store_daily_summary_report`、`store_monthly_summary_report` 共 8 种，与 `meta.reportTypeMap`（`meta.js:32-41`）的 8 个 key **完全对齐**，覆盖无遗漏。
- 但 `getReportDetail` 失败时 `setData` 根本不执行（`report-detail.js:77-79`），`report.reportType` 为 `undefined` → 8 个 block 全不命中 → 落入 `wx:else`，而该占位文案是「加载中...」而非错误提示。**文案与真实状态不符**，且无重试入口。详见 §4。

### 3.4 D 类：js 写入的 data 键 wxml 从未读取（无意义状态）

共 13 个键。按"是否有实际危害"分两档：

**D-档 1（分页/加载标志，仅驱动内部逻辑，无任何 UI 反馈）—— 9 个键**

| 页面 | 键 | JS 写入位置 | wxml 读取情况 |
|---|---|---|---|
| report-list | `page` | :15, :32, :98 | **从未读取** |
| report-list | `hasMore` | :16, :32, :98 | **从未读取** |
| report-list | `isLoadingMore` | :17, :71, :98, :100 | **从未读取** |
| report-history | `page` | :17, :32(经 reload), :82 | **从未读取** |
| report-history | `hasMore` | :18, :50, :82 | **从未读取** |
| report-history | `isLoadingMore` | :19, :58, :82, :84 | **从未读取** |
| supplier-orders | `page` | :21, :51, :81 | **从未读取** |
| supplier-orders | `pageSize` | :22 | **从未读取**（仅 JS 内部当常量用，放进 `data` 无意义） |
| supplier-receipts | `page` | :9, :33, :78 | **从未读取** |

> 实际危害：**两个报表页完全没有任何"加载中/没有更多了"的 UI**。`supplier-orders` 与 `supplier-receipts` 至少有 `已加载全部 {{total}} 条` 的 footer（`wxml:48`、`wxml:30`），但没有"正在加载更多"的态。把 `pageSize` 放进 `data` 是本批唯一纯粹的"常量误入响应式数据"。

**D-档 2（真·死数据，逻辑上也没人用）—— 4 个键**

| 页面 | 键 | JS 写入位置 | 说明 |
|---|---|---|---|
| supplier-orders | `myConfirmStatus` | `decorateOrder` :93 | wxml 只读 `confirmText`/`confirmType`/`canConfirm`/`canShip`，从未读 `myConfirmStatus` |
| supplier-orders | `statusType` | `decorateOrder` :95 | wxml:24 只把 `statusText` 当纯文本插值，**没有任何 `tag-{{item.statusType}}` 或 `text-{{item.statusType}}`** —— 订单状态的彩色 tag 类名从未生效，所有订单状态都是同一个 `text-tertiary` 灰色（`wxml:23`） |
| supplier-receipts | `pageSize` | :10 | 同 supplier-orders，常量误入 data |
| supplier-messages | `messages[i].time` | :31 | wxml:19 只读 `item.timeAgo`；`time` 计算了但从未渲染 |

**D-档 2 中最刺眼的一条是 `statusType`**：`decorateOrder` 精心从 `meta.getStatusInfo` 取出 `type`（`grey/primary/warning/success/danger`，`meta.js:1-20`）并写入 `statusType`，wxml 却只用了 `text` 字段 —— 订单状态色标整列退化为灰色。`supplier-receipts` 那边倒是用了色标（`wxml:6-7` 的 `tag-danger`/`tag-success`），两页不一致。

---

## 4. ★ 专项二：报表导出链路端到端核查

### 4.1 链路全景（逐步）

```
[可选] report-list.generateSummary()                    (report-list.js:125-156)
        └─ generateSummaryReport {period, date, storeId}      (:142-146)
        └─ 成功后 that.reload()                              (:153)
                                ↓
[1] report-list.loadReports()                            (report-list.js:67-103)
        └─ getReports {role, storeId, reportType, relatedDate, page, pageSize=20}  (:73-80)
        └─ result.data[] 逐条 cloud.normalizeReport()       (:87)
           → fileUrl: report.fileUrl || report.file_url || ''   (cloud.js:223)
        └─ wxml 只渲染「查看」，data-id="{{item.reportId}}"    (report-list.wxml:34, 54)
           ★ fileUrl 在列表页被归一化出来但【未被使用】
                                ↓
[2] report-list.goDetail(e)                              (report-list.js:158-162)
        └─ navigateTo '/pages/report-detail/report-detail?id='+dataset.id
                                ↓
[3] report-detail.onLoad(options)                        (report-detail.js:18-80)
        └─ getReportDetail {reportId: options.id}                (:24-26)
        └─ rpt = {...report, ...}   ← 【不走 normalizeReport】(:32-44)
           因此 rpt 上同时保留 fileUrl 与 file_url 两个键
        └─ setData({report: rpt, rows, totalAmount, ...})         (:68-76)
        └─ 失败 → 仅 util.showToast('加载失败')，【不 setData】(:77-79)
                                ↓
[4] 用户点「导出报表文件」                                  (report-detail.wxml:152)
        └─ exportReport()                                       (report-detail.js:96-125)
        └─ if (report.fileUrl || report.file_url)               (:98)
             否 → toast「该报表尚未生成可下载文件」并 return    (:122-124)
        └─ getReportFileUrl {fileId: report.fileUrl || report.file_url}   (:100-102)
        └─ fileUrl = (code===0 && data) ? data.url : null       (:103-105)
             否 → toast「文件链接获取失败」并 return           (:119-121)
                                ↓
[5] wx.downloadFile({url: fileUrl})                        (report-detail.js:107-118)
        └─ fail  → toast「下载失败」                          (:117)
        └─ success → wx.openDocument(...)
                                ↓
[6] wx.openDocument({filePath: res.tempFilePath, showMenu: true})   (:110-115)
        └─ 【未传 fileType】
        └─ success → util.showSuccess('文件已打开')          (:113)
        └─ fail    → util.showToast('打开失败')              (:114)
                                ↓
[7] 关闭文档 → 回到详情页（无 onShow，不重拉，可再次点导出）
```

### 4.2 `fileID` 从哪来、经哪条路径换成 URL

- **来源**：`getReportDetail` 返回的报表文档原文。前端在 `report-detail.js:98` 用 `report.fileUrl || report.file_url` 双读兜底。
- **换链接的唯一路径**：**`getReportFileUrl` 云函数**（`report-detail.js:100-102`），参数名 `fileId`（camelCase），期望返回 `{code, data: {url}}`。
- **明确没有走** `utils/cloud.js` 的 `getFileUrl`（`cloud.js:243-252`）与 `getFileUrls`（`cloud.js:255-268`）—— 即已知背景中提到的 `wx.cloud.getTempFileURL` 客户端直连无鉴权路径。**本批 8 页中没有任何一处调用 `getFileUrl` / `getFileUrls`**（证据：8 个页面的 `cloud.callFunction` 调用点全枚举见 §0.3，且全文无 `getFileUrl` 引用）。
  - 因此：导出链路的鉴权完全落在 `getReportFileUrl` 云函数内部（该函数是否校验"该 fileID 属于该 reportId、该 reportId 属于当前会话可见范围"，**未验证：需读云函数源码**）。
- **`getReports` 返回的 `file_url` 虽被 `normalizeReport` 提取成 `fileUrl`（`cloud.js:223`），但在列表页没有被任何 wxml 节点消费** —— 列表页只负责跳详情。所以"列表页拿到了 fileID"这个前提**在本页不成立**：列表页确实把它归一化进了 `reports[].fileUrl`，但那是**无意义的状态**（属 §3.4 D 类同源问题，此处为字段级而非 data 键级）。

### 4.3 `wx.openDocument` 是否传 `fileType`；未传时对 `.csv` 的后果

- **代码事实**：`report-detail.js:110-115` 的 `wx.openDocument` 参数对象**只有 `filePath` 与 `showMenu` 两个键**，**确实未传 `fileType`**。旧报告此条**成立，仍未修**。
- 按微信公开文档，`fileType` 的取值枚举为 `doc / docx / xls / xlsx / ppt / pptx / pdf`，**不包含 `csv`**；不传时微信按文件扩展名推断类型。
- **对 `.csv` 的后果（静态推断）**：`.csv` 不在支持枚举内 → 推断不到合法类型 → 预期触发 `fail` → 只弹 toast「打开失败」（`report-detail.js:114`）。由于 `showMenu: true` 提供的"转发/另存为"浮层是 `openDocument` **成功之后**才出现的，打开失败意味着**用户连转发和另存都拿不到** —— 整个导出功能在此点完全失效。
- **一个关键反向可能**：`report-detail.js:54` 的注释写的是「**P0-8：与 Excel 生成口径一致**——只累加可付款的非手动行」，暗示后端产物是 Excel（`.xlsx`）。若产物实为 `.xlsx`，它在支持枚举内，未传 `fileType` 由扩展名推断也能成功打开。
- **结论**：**前端代码完全无法判断产物扩展名**（全链路没有任何一处检查扩展名或 MIME）。到底是"csv 必失败"还是"xlsx 可成功"，取决于后端生成逻辑。→ **未验证：需读报表生成云函数确认产物扩展名**。

### 4.4 失败态呈现与重试入口（逐步）

| 步骤 | 失败表现（提示文案） | 页面停留状态 | 有无重试入口 |
|---|---|---|---|
| [3] `getReportDetail` | toast「加载失败」（`report-detail.js:78`） | **报表内容区永久停在 `wxml:146`「报表数据加载中...」**；报表头显示空白（`typeLabel`/`scopeLabel` 均空）；导出按钮仍可点 | **无**（本页无 `onShow`，按钮点了也只会在第 [4]/[5] 步因 `report.fileUrl` 为空而 toast「该报表尚未生成可下载文件」）。唯一出路是返回重进，让 `onLoad` 重跑 |
| [4] 无 `fileUrl` | toast「该报表尚未生成可下载文件」（:123） | 详情页正常展示数据 | 无（生成入口只在 `report-list`） |
| [4] `getReportFileUrl` 失败 | toast「文件链接获取失败」（:120） | 详情页正常 | 有：再点一次导出按钮 |
| [5] `wx.downloadFile` fail | toast「下载失败」（:117） | 详情页正常 | 有 |
| [6] `wx.openDocument` fail | toast「打开失败」（:114） | 详情页正常 | 有 |

**核心断裂点判定**：

1. **断裂点 A（结构级，最严重）**：第 [3] 步失败 → 页面**永久停留在"加载中"文案**，且没有任何重试 UI。这是"catch 吞错后仍显示加载中"的典型形态。旧报告指出的问题**本次确认仍未修**。
2. **断裂点 B（功能性）**：第 [6] 步 `wx.openDocument` 未传 `fileType`。若产物是 `.csv`，则打开必失败，且失败路径**没有任何降级方案**（例如回退为直接展示 `rows` 表格、或提示"请手动保存"）。注意 `rows` 表格在 wxml 中本来就完整渲染了（:30-142），**用户其实已经能在线看全部数据**，"导出"失败只是拿不到离线文件 —— 但代码没有把这一点告诉用户。
3. **断裂点 C（体验级）**：第 [4]→[6] 全程**无 `wx.showLoading` mask、无防连点**（`exportReport` 没有 `_submitting` 之类的标志，对比 `supplier-orders.doAction:118-119` 有）。连点会并发触发多次 `wx.downloadFile` + `wx.openDocument`。
4. **断裂点 D（配置级，未验证）**：第 [5] 步用的是 `wx.downloadFile(url)`（URL 版）而非 `wx.cloud.downloadFile(fileID)`。前者受小程序后台 **`downloadFile` 合法域名白名单**约束，云存储临时链接域名若未配置则一律 fail。域名配置**未验证**（在小程序后台，不在代码仓）。

### 4.5 与"转发/另存"能力的关系

- 本页**未调用** `wx.showShareMenu`。
- 「转发/另存」能力完全来自 `wx.openDocument` 的 `showMenu: true`（`report-detail.js:112`）—— 该参数控制是否显示文档查看器右上角的"···"菜单（含转发给好友/群、保存到手机）。
- 因此转发链路的**前置条件**是 `openDocument` 成功；若断裂点 B 命中，转发能力一并失效。
- 报表页无任何 `onShareAppMessage` 定义（`report-list.js`/`report-detail.js`/`report-history.js` 全文均无），因此本页也不参与小程序转发卡片。

---

## 5. ★ 专项三：供应商端越权面独立验证

### 5.1 检索证据（先给方法，再给结论）

对 8 个页面的 `.js` 用多行 Grep 枚举全部 `cloud.callFunction` 调用点（§0.3），并对 `supplier-*.js` 单独 Grep `supplierId|supplier_id|storeId|store_id|supplier_name|supplierName`。

Grep 命中结果（仅列供应商端 5 页相关）：
- `pages/supplier-home/supplier-home.js:11` → `supplierName: ''`（`data` 初始字段声明）
- `pages/supplier-home/supplier-home.js:41` → `supplierName: supplier.supplierName || '供货商'`（`setData` 展示值）
- `pages/supplier-manage/supplier-manage.js:12,32,45,50,54,71,78,80,94,99,100,107,119` → **全部属于内部行政管理页，不在本批范围**

**没有任何一条命中出现在 `cloud.callFunction(...)` 的参数对象里。**

### 5.2 供应商端 10 个云调用点逐一核查

| # | 位置 | 云函数 | 传入参数（完整） | 含 supplierId/storeId？ |
|---|---|---|---|---|
| 1 | `supplier-home.js:53` | `dataService` | `{action:'getMessages'}` | **否** |
| 2 | `supplier-home.js:85` | `getSupplierOrders` | `{page:1, pageSize:1}` | **否** |
| 3 | `supplier-home.js:120` | `authService` | `{action:'logout'}` | **否** |
| 4 | `supplier-orders.js:68-72` | `getSupplierOrders` | `{confirmStatus, page, pageSize}` | **否** |
| 5 | `supplier-orders.js:121` | `confirmSupplierOrder` | `{orderId, action}` | **否** |
| 6 | `supplier-receipts.js:39-42` | `getSupplierReceipts` | `{page, pageSize}` | **否** |
| 7 | `supplier-prices.js:30` | `getProductPrices` | `{onlyCurrent:true}` | **否** |
| 8 | `supplier-messages.js:24` | `dataService` | `{action:'getMessages'}` | **否** |
| 9 | `supplier-messages.js:44` | `dataService` | `{action:'markMessageRead', id}` | **否** |
| 10 | `supplier-messages.js:60` | `dataService` | `{action:'markAllMessagesRead'}` | **否** |

> 所有 10 个调用点均经 `utils/cloud.js` 的 `callFunction`（`cloud.js:49-76`），该函数会在 `requestData` 中自动注入 `authToken`（`cloud.js:56-64`，取自 `app.globalData.authToken` 或 `wx.getStorageSync('authToken')`）。因此**服务端唯一可用的身份凭证就是 `authToken`**，前端确实没有传任何供应商/门店标识。

### 5.3 结论：`supplierId` 前端 0 处传参 —— 已确认

**「供应商端 `supplierId` 全部由服务端从会话派生，前端 0 处传参」这一旧报告结论，前半句成立，后半句无法从前端验证。**

- **成立部分（有证据）**：本批 5 个供应商页的 10 个云调用点中，`supplierId` / `supplier_id` / `storeId` / `store_id` / `supplierName` 作为**请求参数**出现次数为 **0**（证据见 §5.1 的 Grep 结果 + §5.2 的逐点列表）。前端唯一传的可疑标识是 `orderId`、`confirmStatus`、`id`（消息 id）、`onlyCurrent`、`action`、`page`、`pageSize`。
- **无法验证部分**：「由服务端从会话派生」是后端行为。判据需要读 `getSupplierOrders` / `getSupplierReceipts` / `getProductPrices` / `confirmSupplierOrder` / `dataService` 的云函数源码，核查它们的 `where` 条件是否形如 `{supplier_id: db.command.eq(session.supplierId)}`。**未验证：本批未读任何云函数源码。**
- **额外发现（撤回默认信任）**：`supplier-prices.js:29` 的注释写着「云函数会为供货商角色强制限定只能查自己的价格」—— **这是前端对后端行为的断言，而非可验证的事实**。前端源码无法证明它成立。同理 `report-list.js:126` 的注释「与云函数 GLOBAL_ROLES 口径一致」也是前端对后端的信任声明。这类"注释即安全边界"的写法本身就是风险信号。

### 5.4 前端确实传入的"本应由服务端决定"的参数（诚实清单）

供应商端 5 页**没有**传身份标识，但传了 3 类可被误信的参数：

| 参数 | 位置 | 值来源 | 若后端误信的风险 |
|---|---|---|---|
| `orderId` | `supplier-orders.js:121` | `wxml:38,39` 的 `data-id="{{item.purchaseOrderId}}"`，即列表接口回吐的数据 | **写操作越权**：供应商 A 可对自己的 `orderId` 列表外的单号发起 `confirm`/`ship`。若后端未校验 `order.supplierId === session.supplierId`，可越权代他人确认接单/标记发货 |
| `confirmStatus` | `supplier-orders.js:69` | `this.data.activeTab`，取自前端硬编码 `TABS`（`supplier-orders.js:7-13`） | 传非枚举值是否导致后端抛错或返回未预期集合 —— 未验证 |
| `id`（消息 id） | `supplier-messages.js:44` | `wxml:8` 的 `data-id="{{item.id}}"`，来自 `getMessages` 回吐 | 可传任意 id 标记他人消息已读 |
| （无参数） | `supplier-messages.js:60` | — | `markAllMessagesRead` 作用域完全由后端决定；未加任何限定 |
| `onlyCurrent` | `supplier-prices.js:30` | 前端常量 `true` | 只是查询开关，无越权面 |

### 5.5 反向：内部报表页把 `role` 和 `storeId` 由前端传入 —— 本批最重要的越权面发现

**这是本批 8 页中唯一的前端传入身份标识点，且属于"本应由服务端决定"的参数。**

| 位置 | 云函数 | 前端传入 |
|---|---|---|
| `report-list.js:74-75` | `getReports` | `role`、`storeId` |
| `report-history.js:61-62` | `getReports` | `role`、`storeId` |
| `report-list.js:145` | `generateSummaryReport` | `storeId`（另传 `period`、`date`，日期由客户端 `new Date()` 算出，`:136-138`） |

- `role` 的取值（`report-list.js:42, 69`）来自 `app.globalData.userInfo.role`，**该值由登录响应写入本地，用户可在开发者工具 / storage 中篡改**。
- 前端确实做了**展示层**的角色控制（`initTabs` 按 role 决定显示哪些 tab，`report-list.js:45-62`）和**一层写闸**（`generateSummary` 检查 `me` 是否在 `['super_admin','purchaser']`，`report-list.js:127-131`）。
- 但 `getReports` 的 `role` / `storeId` 是**数据过滤参数**。如果后端直接用前端传的 `role` 做数据范围判定，则 `purchaser` 可在抓包里改 `role: 'super_admin'` 拉取 `supplier_order_report` / `supplier_receipt_report` / `supplier_receipt_price_report` 三类供应商报表 —— 这正是 `initTabs` 注释（`report-list.js:53`「管理员看全部」）声称被隔离的内容。
- **未验证：后端 `getReports` 是否信任前端 `role`。判据需读云函数源码。**
- 同类问题在 `storeId` 上存在：内部用户可通过 `store-switch` 切换门店（`app.json:6` 注册了该页），`currentStore.storeId` 因而受用户控制；若后端只按 `storeId` 过滤而不与会话权限交叉校验，跨门店读取成为可能。
- **对比**：供应商端 5 页对同一问题的处理是正确的（完全不传身份标识，把决定权交给后端）。**两处的口径不一致本身就是一个需要后端确认的疑点。**

### 5.6 供应商能否读到不属于自己的数据 —— 判据与状态

| 数据面 | 前端可传递的越权向量 | 是否闭合 |
|---|---|---|
| 订单列表 `getSupplierOrders` | 仅 `confirmStatus`/`page`/`pageSize`，均无身份语义 | **依赖后端，未验证** |
| 订单写操作 `confirmSupplierOrder` | `orderId`（前端提供） | **依赖后端 `where` 校验 `order.supplierId === 会话 supplierId`，未验证。这是全批唯一具备实际越权危害面的调用点** |
| 收货记录 `getSupplierReceipts` | 仅分页参数 | **依赖后端，未验证** |
| 价格 `getProductPrices` | 仅 `onlyCurrent` | **依赖后端，未验证**；且 `supplier-prices.js:29` 的注释断言不可作为证据 |
| 消息读 `getMessages` | 无任何参数 | **依赖后端，未验证**（无参数 = 作用域 100% 由后端决定，无法从前端推断） |
| 消息写 `markMessageRead` | `id`（前端提供） | **依赖后端，未验证** |
| 消息写 `markAllMessagesRead` | 无任何参数 | **依赖后端，未验证** |

**小结**：供应商端 5 页在**"是否传身份标识"这一维度是干净的**（0 处），但因为本批不读后端，**"能否越权"这个问题无法闭合，只能给出判据位置**。唯一存在真实危害面的是 `confirmSupplierOrder` 的 `orderId` —— 因为它是一个**写操作**，且其目标对象 id 由前端提供，前端无法自查。

### 5.7 `supplier-messages` 与内部 `message` 页的差异（已读 `pages/message/message.js` 全文 83 行）

**调用与字段：几乎完全相同。**

| 维度 | `pages/message/message.js`（内部） | `supplier-messages`（供应商） |
|---|---|---|
| 拉取 | `dataService` + `{action:'getMessages'}`（`message.js:15-17`） | `dataService` + `{action:'getMessages'}`（`supplier-messages.js:24`）—— **参数完全一致，均无供应商/角色标识** |
| 字段归一化 | `time = cloud.formatDateTime(m.time)`、`timeAgo = util.getRelativeTime(...)`（`message.js:22-26`） | 同样两行（`supplier-messages.js:29-33`），但 `formatDateTime` **被调用了两次**（先存 `time` 再算 `timeAgo`），内部页只调一次 |
| 未读数 | `messages.filter(m => !m.read).length`（`message.js:27`） | 同（`supplier-messages.js:34`） |
| 标记单条已读 | `dataService` + `{action:'markMessageRead', id}`（`message.js:38-41`） | 同（`supplier-messages.js:44`） |
| 全部已读 | `dataService` + `{action:'markAllMessagesRead'}`（`message.js:75-77`） | 同（`supplier-messages.js:60`） |

**差异只在读后路由与守卫**：

1. **路由逻辑**：内部 `message.js:48-69` 按 `role` → `type` → `bizId` 前缀三级分流（supplier 角色 → `supplier-orders`；`abnormal` → `abnormal-list`；`receive` 或 `bizId` 以 `RCP` 开头 → `receive-list`；否则 → `purchase-detail?id=bizId`）。供应商页 `supplier-messages.js:51-55` **只做一件事**：`bizId` 存在就跳 `supplier-orders`。
2. **`bizId` 的使用方式不同（这是真实缺陷）**：
   - 内部页 `message.js:66` → `wx.navigateTo({url:'/pages/purchase-detail/purchase-detail?id=' + message.bizId})` —— **把 `bizId` 作为目标页参数传过去**，用户直达该订单。
   - 供应商页 `supplier-messages.js:52-54` → `if (message.bizId) { wx.navigateTo({url:'/pages/supplier-orders/supplier-orders'}) }` —— **`bizId` 只用于判断存在性，从未拼进 URL**。后果：供应商点「新订单通知」后落在 `supplier-orders` 的默认 tab（`activeTab: 'pending'`，`supplier-orders.js:18`），若该订单已被自己确认或已发货，用户在该 tab 下**找不到目标订单**，必须手动切 tab。
   - 注意内部页对 supplier 角色的分支（`message.js:53-55`）也**不传 `bizId`**，写法与供应商页一致 —— 说明这个缺陷是**两处同源的既有实现**，不是供应商页抄漏。
3. **守卫口径**：内部页只有 `authGuard.requireLogin()`（`message.js:13`）；供应商页额外要求 `role === 'supplier'`，不满足则 `reLaunch('/pages/login/login')`（`supplier-messages.js:16-18`）—— 与另 4 个供应商页用 `reLaunch('/pages/index/index')` 不一致（见 §1.9）。
4. **死变量**：内部页 `message.js:37` 有 `const app = getApp()` 从未使用；供应商页对应位置无此行。
5. **入口归属**：内部 `message` 是 **tabBar 页**（`app.json:61-66`），供应商消息页不是（`app.json:28`）—— 因此供应商消息页可被 `navigateTo` 正常压栈，而内部消息页只能 `switchTab`。这一事实解释了为什么两个页面代码几乎重复：**供应商角色不进内部 tabBar，所以必须另起一页**。

---

## 6. 页面间导航与参数传递

共 **13 条导航边**（含重复方法），本批 8 页内 **0 条指向 tabBar 页**（唯一 tabBar 页 `report-list` 无入边），跳转方式全部正确（非 tabBar 用 `navigateTo`，会话失效用 `redirectTo`/`reLaunch`）。

| # | 起点方法 | 目标 | 传参 | 目标页是否读取 | 结论 |
|---|---|---|---|---|---|
| 1 | `report-list.generateSummary` (js:133) | 无（`wx.showActionSheet`） | — | — | 非导航 |
| 2 | `report-list.goHistory` (js:121) | `report-history` | **无** | `report-history` 无 `onLoad`，仅 `onShow` | 正常（目标页不需要参数） |
| 3 | `report-list.goDetail` (js:159-161) | `report-detail?id=` | `id` = `dataset.id` ← `item.reportId` | `report-detail.js:20` 读 `options.id` | **参数被正确使用** |
| 4 | `report-history.goDetail` (js:113) | `report-detail?id=` | `id` = `dataset.id` | 同上 | **参数被正确使用** |
| 5 | `report-detail.goSourceOrder` (js:86) | `purchase-detail?id=` | `id` = `report.sourceOrderId`（**读全局 `data`，不读 `dataset`**） | 目标页不在本批，**未验证** | 见下「死参 1」 |
| 6 | `report-detail.goRowOrder` (js:93) | `purchase-detail?id=` | `id` = `dataset.orderId` ← `item.purchaseOrderId` | 目标页不在本批，**未验证** | 正常 |
| 7 | `supplier-home.goStatPage` (js:97) | `supplier-orders?status=` | `status` = `dataset.status`（`pending`/`confirmed`/`shipped`） | `supplier-orders.js:29-31` 读取并做 `TABS` 白名单校验 | **参数被正确使用（唯一做白名单校验的入参）** |
| 8 | `supplier-home.goOrders` (js:101) | `supplier-orders` | **无** | `options.status === undefined` → 白名单校验不通过 → 保留默认 `'pending'` | 正常（语义即"全部"，但实际落在"待确认"） |
| 9 | `supplier-home.goReceipts` (js:105) | `supplier-receipts` | 无 | 目标页无 `onLoad` | 正常 |
| 10 | `supplier-home.goPrices` (js:109) | `supplier-prices` | 无 | 目标页无 `onLoad` | 正常 |
| 11 | `supplier-home.goAccount` (js:113) | `account` | 无 | 不在本批 | 未验证 |
| 12 | `supplier-home.goMessages` (js:66) / `goMessageCenter` (js:70) | `supplier-messages` | 无 | 目标页无 `onLoad` | 正常（两方法体相同，见 §3.2 B-2） |
| 13 | `supplier-messages.readMessage` (js:53) | `supplier-orders` | **无（`bizId` 未拼入）** | `options.status === undefined` → 默认 `'pending'` | 见下「死参 2」 |

**死参 1 · `report-detail.wxml:89` 的 `data-order-id="{{item.purchaseOrderId}}"`**
- 该行是 `store_receipt_price_report` block 的商品名，`bindtap="goSourceOrder"`，并显式传了 `data-order-id`。
- 但 `goSourceOrder()`（`report-detail.js:83-87`）**函数签名无 `e` 参数**，函数体只读 `this.data.report.sourceOrderId`（:84），**完全不读 `dataset`**。
- 后果：带价格收货报表的行级点击会跳到报表头那一个单一 `sourceOrderId`，而不是当前行的 `purchaseOrderId`。对"一行对应一张采购单"的门店带价格报表**语义恰好正确**（同一张单的所有行同一个 `sourceOrderId`），但 `data-order-id` 属性本身就是无效代码；若未来数据模型变成"一报表多采购单"，此处会静默出错。
- 对比：同一 block 的 `wx:else` 分支（`wxml:90`）用 `bindtap="goRowOrder"`，而 `goRowOrder(e)`（`report-detail.js:91`）**确实读 `e.currentTarget.dataset.orderId`** —— 两个方法的入参处理风格不一致，说明 `wxml:89` 的 `data-order-id` 是照着 `wxml:90` 抄过来的。

**死参 2 · `supplier-messages.js:52` 的 `message.bizId`**
- `if (message.bizId)` 只用于判断存在性，随后 `wx.navigateTo({url:'/pages/supplier-orders/supplier-orders'})` **不拼任何参数**。
- 后果：供应商点"新订单通知"落到 `supplier-orders` 默认 tab（`pending`），目标订单若已被自己确认/发货则在该 tab 下不可见，用户必须手动切 tab。
- 对比内部 `pages/message/message.js:66` 会拼 `?id=` + `bizId` 直达详情。注意 `message.js:53-55` 对 supplier 角色的分支**同样不拼** —— 该缺陷两处同源。

**未验证**：目标页 `purchase-detail`、`account` 是否读取 `options.id`（不在本批 8 页范围）。

---

## 7. 死代码与未闭合点

### 7.1 无绑定方法 / 冗余方法

| 编号 | 位置 | 类型 | 说明 |
|---|---|---|---|
| X-1 | `supplier-home.js:73-81`（`requestNewOrderSubscribe`）+ `:7`（`NEW_ORDER_TEMPLATE_ID = ''`） | **完全死代码** | 无 wxml 绑定；唯一调用点 `onShow:48`；首行短路条件因常量恒为空串而**永远返回**，`wx.requestSubscribeMessage` 不可达。证据链闭合，不依赖任何后端行为 |
| X-2 | `supplier-home.js:64-71`（`goMessages` / `goMessageCenter`） | 冗余 | 两方法体逐字相同且各自有绑定，可合并 |
| X-3 | `pages/message/message.js:37`（`const app = getApp()`） | 死变量 | 出参后从未使用（本页仅因 §5.7 对比而读入，不计入本批 8 页） |

### 7.2 无来源 / 无消费者 data 键

| 编号 | 位置 | 说明 |
|---|---|---|
| X-4 | `report-list.js:15-17` / `report-history.js:17-19` 的 `page`/`hasMore`/`isLoadingMore` | 6 个键**全部只写不读**。直接后果：**两个报表列表页没有任何"加载中…"/"没有更多了"UI**。`report-list` 甚至没有 `list-footer` 节点 |
| X-5 | `supplier-orders.js:21-22` / `supplier-receipts.js:9-10` 的 `page`/`pageSize` | 4 个键只写不读。`pageSize` 是常量，放进 `data` 使其进入响应式 diff，纯浪费 |
| X-6 | `supplier-orders.js:93` `myConfirmStatus`、`:95` `statusType` | `decorateOrder` 算出后无人消费。**`statusType` 最刺眼**：`meta.getStatusInfo` 返回的 `type`（`grey/primary/warning/success/danger`）从未映射到任何 CSS 类，`wxml:24` 只把 `statusText` 当纯文本渲染在 `text-tertiary` 里 → **订单状态色标整列退化为灰色** |
| X-7 | `supplier-messages.js:31` `messages[i].time` | 只写不读（`wxml:19` 只用 `timeAgo`）；且为算它而**重复调用 `formatDateTime` 两次** |

### 7.3 分页未启用 / 无加载反馈

| 编号 | 位置 | 说明 |
|---|---|---|
| X-8 | `report-list.json` / `report-history.json` | 两页均**未声明 `onReachBottomDistance`**，用框架默认值。`.json` 已开 `enablePullDownRefresh` 且 JS 有实现，配对正确 |
| X-9 | `supplier-prices` 全页 | **无分页、无 `onPullDownRefresh`、无 `onReachBottom`、无 `.json` 刷新声明** —— 一次性全量拉取，价格条目增长后无加载路径。功能上自洽（协议价条目通常少），但与另两页供应商列表页的口径不一致 |
| X-10 | `supplier-orders.js:67` / `supplier-receipts.js:38` 的 `setData({loading:true})` | `loading` 在 wxml 中**仅用于抑制空态**（`wxml:43` / `wxml:25` 的 `&& !loading`），**不存在任何加载态 UI 节点**。首屏请求期间两页都是纯空白 |
| X-11 | `report-list.js:96` / `report-history.js:80` 的 `reload()` 不清空 `reports` | 切换筛选 tab 时旧列表残留到请求返回前，视觉上短暂显示"不属于当前筛选"的数据；且并发筛选无先后覆盖保护 |

### 7.4 catch 吞错后仍显示"加载中"或"成功"（本批最集中的一类）

| 编号 | 位置 | 表现 | 是否仍是旧报告问题 |
|---|---|---|---|
| **X-12** | `report-detail.js:77-79` + `report-detail.wxml:145-147` | `getReportDetail` 失败仅 `util.showToast('加载失败')`，**不执行 `setData`** → `data` 停在初始 `{report:{}, rows:[]}` → `reportType` 为 `undefined` → 8 个 block 全不命中 → 落到 `wx:else` 显示「报表数据加载中...」。**文案与真实状态完全不符，且永久卡死无重试入口** | **旧报告"云函数失败只 toast 而页面停留在加载中"→ 确认仍未修** |
| **X-13** | `report-history.wxml:5` + `report-history.js:81-82` | `共 {{reports.length}} 份报表` 读的是**已加载条数**。JS 明明拿到了 `result.total`（:81）却只用来算 `hasMore`，从未 `setData` | **旧报告"共 N 份读的是已加载条数"→ 确认仍未修** |
| X-14 | `supplier-home.js:54, 86` | `loadNotice` / `loadStats` 失败**完全静默 return**（不 toast）→ 通知条消失、统计条全 0，与"确实无消息/无订单"无法区分 | 新增 |
| X-15 | `supplier-prices.js:32-35` + `wxml:15` | 请求失败后 `prices` 仍为空数组且 `loading=false` → 页面显示「暂无生效中的协议价格」。**失败态被伪装成空态**，用户会以为"没有价格"而非"加载失败" | 新增 |
| X-16 | `report-list.js:99-102` / `report-history.js:83-86` | 列表失败时 `reports` 保持旧值（不清空）→ 旧数据继续展示，仅一个 toast。首次加载失败则停在"暂无报表"空态 | 新增（口径与 `supplier-prices` 相反：这里保留旧值，那里重置为空） |

### 7.5 其它未闭合点

| 编号 | 位置 | 说明 |
|---|---|---|
| X-17 | `report-detail.js:96-125` `exportReport` | **无 `wx.showLoading`、无防连点标志**（对比 `supplier-orders.doAction:118-119` 有 `this._submitting`）。连点会并发触发多个 `wx.downloadFile` + `wx.openDocument` |
| X-18 | `supplier-home.js:120` `switchAccount` | `await cloud.callFunction('authService', {action:'logout'})` **完全不检查返回 `code`**，失败也继续清本地会话并跳转登录页。服务端会话是否同步失效 **未验证** |
| X-19 | `report-detail.wxml:128` `wx:key="productName"` | 门店汇总 block 用商品名作 key，但同 block 又渲染 `supplierName` 列 → 同商品多供应商行会撞键。是否真出现重复行 **未验证** |
| X-20 | `supplier-receipts.wxml:21` `wx:key="index"` | 异常明细列表用数组下标作 key，稳定键缺失。列表很短，影响有限 |
| X-21 | `supplier-receipts` 整页 | **0 个交互绑定**，供应商无法从收货记录跳回对应订单核对（对比 `report-detail.goRowOrder` 有行级跳转）。`wxml:9` 展示了 `purchase_order_id` 但点不动 |
| X-22 | `supplier-messages.js:16-18` | 守卫条件与另 4 个供应商页不一致（合并成一个 `reLaunch('/pages/login/login')`），非供应商误入被跳登录页 |
| X-23 | `report-history.js:89-99` | `onScopeChange` / `onTypeChange` **不做 picker 下标越界校验**；`onTypeChange` 的 `this.data.reportTypeOptions[e.detail.value]` 若返回 undefined 会直接抛 `TypeError`。理论不可达（picker 只回合法下标），但防御缺失 |
| X-24 | `report-detail.js:18-20` | `onLoad` **不校验 `options.id` 是否存在**，缺失时仍带 `reportId: undefined` 发请求。后果取决于后端（未验证） |
| X-25 | `supplier-orders.js:103-115` | `confirmOrder` / `shipOrder` **不校验 `orderId` 空值**，`!orderId` 时仍会发 `confirmSupplierOrder` |
| X-26 | `supplier-orders.js:93, 98-99` | `my_confirm_status` 为 `undefined` 时 `myConfirmStatus` 兜底成 `'pending'`（标签显示"待确认"），但 `canConfirm` 判定为 `false`（按钮不显示）→ **状态标签与可操作性矛盾** |
| X-27 | `report-list.js:90` | `abnormalLabel = '收货异常' + ...` 对所有报表类型硬编码"收货异常"文案，对 `store_order_report` / `supplier_order_report` / `summary` 类语义不准。属口径问题非崩溃 |
| X-28 | `report-history.js:71-79` vs `report-list.js:83-95` | 两个列表页对同一条目做**不同程度**的装饰：`report-history` 不计算 `hasAbnormal`/`abnormalSummary`/`abnormalLabel` → 历史页卡片永远没有异常标记。是否为有意简化 **未验证** |
| X-29 | `report-detail.js:46-66` | 合计金额完全前端计算。`totalAmount` 对非 `price`/`summary` 类型恒为 `'0.00'`，而 `wxml` 只在 `price`/`summary` 两个 block 里渲染合计（`wxml:99, 140`）→ 该默认值实际不可见，无误导，但代码意图不清晰 |
| X-30 | `report-detail.js` 全文件 | **无 `onShow`**：从 `purchase-detail` 返回不重拉。`exportReport` 依赖 `onLoad` 缓存的 `report` 对象，因此导出功能不受影响；但如果后端报表在停留期间被作废（`status='superseded'`），页面不会反映 |

---

## 8. 未验证清单

**U-1 · `getReportDetail` 返回体是否包含 `file_url` / `fileUrl` 字段** —— 决定导出链路起点是否成立。建议：读该云函数源码，或直接抓一次 `getReportDetail` 的返回包。
**U-2 · 报表文件的实际扩展名是 `.csv` 还是 `.xlsx`** —— 决定 `wx.openDocument` 不传 `fileType` 是"必失败"还是"碰巧成功"。建议：读报表生成云函数（`generateSummaryReport` 及各类报表生成逻辑）中的文件名构造。
**U-3 · `wx.downloadFile` 合法域名白名单是否包含云存储临时链接域名** —— 决定下载步骤是否必失败。建议：在小程序后台"开发管理 → 服务器域名"查看 `downloadFile 合法域名`配置（配置在后台，不在代码仓）。
**U-4 · `wx.openDocument` 对 `.csv` 且不传 `fileType` 的真机实际表现** —— 本文按公开文档枚举推断会走 `fail`。建议：真机跑一次导出，观察是弹「打开失败」还是直接抛异常，以及控制台 `errMsg` 原文。
**U-5 · 后端 `getReports` 是否信任前端传入的 `role` / `storeId`** —— **优先级最高**。建议：读 `getReports` 云函数，确认数据范围是取自会话还是取自入参；若取自入参，则 `purchaser` 抓包改 `role: 'super_admin'` 可拉取供应商报表。
**U-6 · `getReports` 返回体是否含名为 `status` 的键** —— 决定两页的「已作废」标签（`report-list.wxml:41`、`report-history.wxml:31`）是否永远不显示。
**U-7 · `getReportDetail` 的 `rows` 元素字段名是 camelCase 还是 snake_case** —— 决定 6 个 block 的表格能否渲染出数据（前端 100% 按 camelCase 读，如 `productName`/`orderQty`/`purchaseOrderId`/`abnormalTypeNames`）。建议：抓包比对一次，或读云函数输出构造。
**U-8 · `getSupplierOrders` / `getSupplierReceipts` / `getProductPrices` 的 `where` 条件是否按会话 `supplierId` 过滤** —— 供应商读越权面的判据。建议：读三个云函数源码，确认过滤键来自 `session.supplierId` 而非入参。
**U-9 · `confirmSupplierOrder` 是否校验 `order.supplierId === 会话 supplierId`** —— **优先级最高**，全批唯一具备实际危害面的调用点（写操作 + 目标 id 由前端提供）。建议：读该云函数，重点看它是否用入参 `orderId` 查单后与会话供应商比对。
**U-10 · `dataService.getMessages` 是否按会话过滤** —— 供应商首页与消息页均无参调用，作用域 100% 由后端决定；若不按会话过滤，供应商可读到内部消息。
**U-11 · `markMessageRead` / `markAllMessagesRead` 是否校验消息归属** —— 供应商能否越权标记内部消息已读。
**U-12 · `generateSummaryReport` 的后端角色校验是否与前端 `['super_admin','purchaser']` 口径一致；后端是否用会话覆盖前端传入的 `date`/`storeId`** —— 前端注释（`report-list.js:126`）自称"与云函数 GLOBAL_ROLES 口径一致"，但注释不是证据。
**U-13 · 汇总报表的 `rows` 是否存在"同商品 + 多供应商"行** —— 决定 `wx:key="productName"` 是否真撞键。
**U-14 · `wx.openDocument` 的 `showMenu: true` 在实际版本中提供的菜单项** —— 本文据公开文档推断含转发/保存；若基础库行为变化，"转发/另存"能力会静默失效。
**U-15 · 供应商角色登录后的落点是否确实是 `supplier-home`** —— 登录页不在本批，`supplier-home` 的重定向目标 `/pages/index/index` 与 `/pages/login/login` 的正确性取决于登录页实现。
**U-16 · `getReports` 对 `reportType: ''` / `reportScope: ''` 空串的处理** —— 前端用空串表示"不限"（`report-list.js:76, 77`、`report-history.js:63, 64`），若后端把空串当字面值过滤，则"全部"筛选会返回空集。

**共 16 项。** 其中 U-5、U-9 与数据越权直接相关，建议优先核实。

---

## 9. 行数对账

| 分组 | 文件数 | 行数 |
|---|---|---|
| 报表 3 页（`js`+`wxml`+`wxss`+`json`） | 12 | 953 |
| 供应商端 5 页（`js`+`wxml`+`wxss`+`json`） | 20 | 1033 |
| **本批 32 个文件合计** | **32** | **1986** |
| 额外只读：`utils/cloud.js` | 1 | 283 |
| 额外只读：`utils/meta.js` | 1 | 67 |
| 额外只读：`utils/util.js` | 1 | 127 |
| 额外只读：`utils/auth-guard.js` | 1 | 16 |
| 额外只读：`app.json` | 1 | 74 |
| 额外只读：`pages/message/message.js`（仅用于 §5.7 对比） | 1 | 83 |
| **额外只读合计** | **6** | **650** |
| **实际读取总计** | **38** | **2636** |

补充：`styles/icons.wxss` 仅以 Grep 抽查类名存在性（确认 `report-list.wxml:16` 动态拼接所需的 12 个 `icon-{base}-{white|grey}` 类**全部存在**），未逐行读取，故未计入行数。

分文件行数见 §0.1 两张表格。
