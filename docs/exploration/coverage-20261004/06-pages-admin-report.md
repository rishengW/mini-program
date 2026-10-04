# 子代理 F｜后台管理 5 页 + 门店切换 + 报表 3 页 全量勘探（2026-10-04）

> **范围**：`pages/{price-manage,product-manage,supplier-manage,store-manage,store-switch,user-manage,report-list,report-history,report-detail}/` 共 **9 页 × 4 文件 = 36 文件 / 3042 行**，全读不抽样。
> **交叉参照（只读）**：`cloudfunctions/{dataService,authService,getSuppliers,getProducts,getProductPrices,importProducts,updateProductPrice,getReports,getReportDetail,getReportFileUrl,generateSummaryReport,createReceipt}/index.js`、`utils/{cloud,util,meta,auth-guard}.js`、`pages/index/index.{js,wxml}`、`app.json`、`styles/icons.wxss`。
> **旧报告对照（先读后独立验证）**：`rescan-20261004-R8-pages-admin.md`、`rescan-20261004-R10-report-pages-and-docs.md`、`full-scan-05-pages-admin.md`、`full-scan-06-pages-report.md`，以及本批前置 `01/02/05/07`。
> **方法**：只信当前代码。每条结论带 `文件:行号`。与旧报告不一致处单列 §6。

---

## 0. 结论摘要

1. **最大问题是跨模块的 -401 结构不兼容**：`dataService` / `authService` 的管理类 action 把鉴权失败返回成 `{ error: { code, msg } }` **嵌套**结构（`dataService/index.js:46-49`、`authService/index.js:334-338`），而 `utils/cloud.js:68` 只判顶层 `result.code === -401`。**本组 4 个管理页的 10 个写操作在会话过期时不会触发跳登录**，前端只弹一条 `msg` 为 undefined 的通用失败提示，用户被永久困在页面上。R8 N-1 **仍然成立**。
2. **门店停用的在途单检查漏一个终态**：`authService/index.js:642` 的 `ACTIVE_ORDER_STATUS` 不含 `receipt_abnormal`，而 `createReceipt/index.js:555` 会把订单置为该终态。停用门店后该店 chef/store_manager 因 `login:206-207` 找不到有效门店集体无法登录，前端确认文案完全没提。R8 N-4 **仍然成立**。
3. **报表三页口径不齐**：`getReports` 解构 `storeId` 但全程未用（`getReports/index.js:43` vs `:49-66`），管理员切门店无效；report-list 类型 tab 只有 6 类、report-history 有 8 类；report-history 副标题「共 X 份」读的是已加载页数而非 `total`；前端还把店长的汇总报表生成入口误屏蔽（`report-list.js:126-131` 注释与 `generateSummaryReport/index.js:170` 直接矛盾）。
4. **导出按钮在当前实现下必失败**：全部报表落库为 `.csv`（`generateSummaryReport:241`、`dataService:436/477/1020/1221/1248/1281/1308`），`report-detail.js:110` 用 `wx.openDocument` 打开且未传 `fileType`，基础库不支持 csv → 推断必然落 fail「打开失败」。
5. **加载态全线缺失**：本组 9 页 wxml **0 处**绑定 `isLoading` / `loading` / `hasMore`（grep 实测）。`report-list.js:17`、`report-history.js:19` 的 `isLoadingMore` 只写不读，与 purchase-list 的 `isLoading` 同型问题一致；5 个管理列表页中只有 store-manage / user-manage 有 `showLoading`，price/product/supplier-manage 与 store-switch 完全没有。
6. **写操作防抖本组其实覆盖较全**：14 个写操作里 8 个有 `_submitting` 标志，5 个靠 `util.showLoading({mask:true})` 副作用兜住，只有 `store-switch.selectStore` 完全裸奔。与「13 个写操作只有 1 个满分」的全局印象不同——本组是相对健康的一批，主要缺口在 user-manage 的 3 个操作缺少标志位。
7. **供应商角色被后端挡在全部 9 页之外**，唯一缺口是 `authService.getStores` 无任何角色门禁（supplier 可枚举全部门店名 + 编号，store-manage 传 `includeInactive:1` 连停用门店也能拿）。
8. **js/wxml 绑定基本一一对应**：9 页均无「wxml 引用但 js 从未 setData」的裸字段（user-manage 的 3 个 picker index 例外，但有 `|| 0` 兜底）；死字段集中在 `isLoadingMore` × 2 和 7 处 `const app = getApp()`。

---

## 1. 覆盖范围确认（36 文件 / 3042 行）

| 页面 | js | json | wxml | wxss | 合计 |
|---|---|---|---|---|---|
| price-manage | 228 | 4 | 102 | 55 | 389 |
| product-manage | 284 | 4 | 128 | 61 | 477 |
| supplier-manage | 121 | 4 | 67 | 34 | 226 |
| store-manage | 120 | 3 | 62 | 148 | 333 |
| store-switch | 44 | 2 | 16 | 71 | 133 |
| user-manage | 251 | 4 | 116 | 160 | 531 |
| report-list | 163 | 4 | 63 | 127 | 357 |
| report-history | 115 | 5 | 43 | 27 | 190 |
| report-detail | 126 | 3 | 159 | 118 | 406 |
| **合计** | | | | | **3042** |

**生命周期盘点**：仅 `price-manage:24`、`store-switch:9`、`report-detail:18` 有 `onLoad`；其余 6 页只有 `onShow`。**0 页**有 `onHide` / `onUnload`。
**`enablePullDownRefresh`**：只有 `report-list.json` 与 `report-history.json` 开启（且实现了 `onPullDownRefresh` + `onReachBottom`）。**price-manage / product-manage / supplier-manage / store-manage / store-switch / user-manage / report-detail 7 页均未开启**——已知普遍问题在本组**仍然成立**，且这 5 个管理列表页全部是单次全量拉取 + 服务端硬 limit（getProducts/getSuppliers `limit(100)`、getProductPrices `limit(200)`、authService.listUsers `limit(100)`），超量静默丢失。
**全项目下拉刷新分布**（grep `pages/`）：approval-list、purchase-list、receive-list、supplier-orders、supplier-receipts、report-list、report-history 共 7 页；本组占 2 页。

---

## 2. 逐页解剖

### 2.1 `pages/price-manage/`（389 行）

**职责**：供应商×商品协议价的列表浏览、按供应商/关键词本地过滤、改价与首次定价。

**json**：仅 `navigationBarTitleText:"价格管理"` + `usingComponents:{}`，**无 `enablePullDownRefresh`**、无 `onReachBottom`（列表单次拉取 `getProductPrices limit(200)`）。

**数据流**：`onLoad:24` 存深链 `supplierId`（无 `requireLogin` 之外的处理）→ `onShow:29` → `loadData`。**三个云函数 `Promise.all` 并发**：`getSuppliers({includeInactive:true})`、`getProducts({includeInactive:true})`、`getProductPrices({onlyCurrent:true})`，全部 code===0 才渲染，任一失败取第一个非 0 的 `msg` toast 并 return（`:38-42`）。改价 `savePrice:125` 走**两步式**：先 `updateProductPrice({dryRun:true})` 拿 `affectedOrders`，`>0` 时 `util.showConfirm` 提示波及在途单数，再正式提交；新增价格 `saveNewPrice:196` 单步提交。
`applyFilter:74` 纯前端过滤（供应商 + 关键词小写 includes）+ 按供应商名 localeCompare 排序。

**状态字段 vs wxml 绑定**：14 个字段（`priceList/allPrices/suppliers/supplierOptions/selectedSupplierId/selectedSupplierName/keyword/showEdit/editItem/newPrice/showAdd/products/addForm`）**全部有 wxml 消费者**，`allPrices` 与 `products` 虽不直接渲染但被 `applyFilter`/`showAddProductPick` 消费，无死字段。wxml 无裸引用字段。唯一死代码：`loadData:32` 的 `const app = getApp()` 未被使用。

**危险性操作**：改价有条件二次确认（`affected > 0` 才弹，`:147-153`）；`affected === 0` 时直接提交、**无确认**；首次定价 `saveNewPrice` **完全无确认**（注释称对在途单是"好消息"，但它是不可逆写入价格表的新行）。后端 `updateProductPrice:70` 限 `super_admin|purchaser`，且 `:101-108` 强制"仅当天生效"。

**格式化**：`¥{{item.price}}`（wxml:30）与编辑弹窗 `¥{{editItem.price}}`（wxml:49）**原样输出**。后端 `updateProductPrice:104` 存 `Number(newPrice)` 不截位，前端 `:127`/`:200` 只校验 `isNaN || <= 0`，price 可以是 12.345；而报表侧 `getReportDetail:119` 用 `Math.round(x*100)/100` 逐行舍入到分 → **价格管理页与报表金额口径不一致**。`effectiveDate` 是 `YYYY-MM-DD` 字符串，展示正常。无千分位、无空值占位（`productUnit`/`productCategory` 为空时 wxml:26 会出现连续空格与 `·`）。

**防抖**：`savePrice` 与 `saveNewPrice` 均有 `_submitting` + finally 语义（`:129-130` / `:206-207`，实际是在函数尾部复位），改价的两步调用串行受同一个标志保护。**改价/新增价格在防重复提交上是本组最规范的**。

**异常处理**：`cloud.callFunction` 永不 throw（`utils/cloud.js:72-75` 兜底成结果对象），所以 `loadData` 无 try/catch 也安全；失败有 toast。但 `loadData` **没有 showLoading**，失败/加载中页面表现为「暂无价格数据」空态，用户无法区分"真的没有"和"还没回来"。

### 2.2 `pages/product-manage/`（477 行）

**职责**：商品 CRUD、Excel 批量导入、一级分类 Tab 切换 + 关键词过滤、启停用。

**json**：仅标题，**无下拉刷新**。列表前端一次拉全量（`getProducts limit(100)`）。

**数据流**：`onShow:30` → `loadData:35` 三路并发（getProducts / dataService.getCategories / getSuppliers，均带 includeInactive），任一失败 toast return。`applyFilter:81` 前端过滤。写操作：`saveProduct:235`（dataService.saveProduct）、`toggleStatus:260`（dataService.toggleProduct）。导入链路 `chooseImportFile:132` → `uploadImportFile:164`：先 `importEnvBlocker:119` 探测 `wx.chooseMessageFile` / devtools / windows|mac 平台并主动弹窗说明，再 `wx.cloud.uploadFile` 上传到 `imports/products/`，再 `importProducts`。

**状态字段 vs wxml**：13 个字段全部有消费者；`categories` 不直接渲染但被 `filteredCategories` 派生使用。wxml 裸引用：无。**picker 未绑定 `value`**（wxml:84/91/115），选中后滚轮不回显当前项（一级分类靠 `form.categoryL1Name` 文字兜住，二级分类与供应商同理）。

**危险性操作**：启停用有二次确认（`:265-270`）✓。Excel 导入**无任何二次确认**，且 `importProducts` 内部逐条 add 无事务、无行数上限；`importProducts/index.js:182` 把 `e.message` 原文塞进 `errors[].msg`，由 `product-manage.wxml:62-65` 弹窗直接展示给终端用户（内部异常信息泄露）。模板说明有独立弹窗（`showTemplateInfo:195`）✓。

**导入体验**：`:119-143` 的环境探测是本组最细的一段（`isUserCancel:10-12` 严格正则匹配 `fail cancel`，避免把"环境不支持"误判成取消而静默），值得点名。`uploadImportFile:164` 只用 `showLoading({mask:true})` 兜防重复，**无 `_submitting` 标志**。

**格式化**：无金额字段；`item.manufacturerName || '默认'`、`item.supplierName` 有占位（`normalizeProduct:182` 默认 '默认'）。无千分位。

**异常处理**：`saveProduct`/`toggleStatus` 均 try/finally 复位 `_submitting` ✓；`loadData` 无 showLoading、无 try/catch（依赖 callFunction 不 throw，安全）。

### 2.3 `pages/supplier-manage/`（226 行）

**职责**：供应商 CRUD、关键词搜索、启停用、跳转到该供应商的价格管理。

**json**：仅标题，无下拉刷新。

**数据流**：`onShow:15` → `loadData:20` → `getSuppliers({includeInactive:true})`，关键词在**前端**过滤（`:30-33`）。写操作：`saveSupplier:68`、`toggleStatus:91`（均 dataService）。`goProducts:117` 带 `supplierId` 深链到 price-manage。

**问题**：`onSearch:37` 每次击键直接调 `loadData()` → **无防抖的服务端往返**（虽然服务端不做搜索，但每次击键都拉全量 + 云函数内部按 20 个 id 分批回查 product 计数），快速输入产生并发请求，后发先至时旧响应按新 `keyword` 过滤旧数据；且 `loadData` **无 showLoading**。这是本组唯一一处击键触发网络请求。

**状态字段 vs wxml**：5 个字段全部对应，无死字段、无裸引用。死代码：`loadData:21`、`saveSupplier:75`、`toggleStatus:104` 三处 `const app = getApp()` 全部未使用。

**危险性操作**：停用有二次确认（`:96-101`）✓，文案说明"停用后下单不可再选择，历史单据保留"。但**后端 `toggleSupplier` 没有"该供应商是否仍被商品引用 / 是否有在途单"的检查**——停用后 `updateProductPrice:85` 会因 `status:1` 查询不到而报"供应商不存在或已停用"，前端只能在改价时才知道。同理 `toggleProduct` 无在途单检查。

**异常处理**：写操作 try/finally ✓，失败 toast `result.msg || '供应商保存失败'`。注意 `saveSupplier` 走 dataService → 会话过期时返回嵌套 `{error:{code:-401}}`，`result.msg` 为 undefined → 只显示 `'供应商保存失败'`（见 §0.1）。

### 2.4 `pages/store-manage/`（333 行）

**职责**：门店 CRUD（编号自动生成且不可改）与停用/启用。

**json**：仅标题，无下拉刷新。

**数据流**：`onShow:14` → `loadData:19` → `authService.getStores({includeInactive:1})`（**唯一带 includeInactive 的读路径**，否则停用门店无法在 UI 上恢复）。写操作：`saveStore:54`（createStore/updateStore）、`toggleStoreStatus:91`（setStoreStatus）。`showLoading`/`hideLoading` 包住读写两条链路。

**状态字段 vs wxml**：4 个字段（`stores/showForm/editItem/form`）全部对应。wxml 用 `item.storeCode`（`:19`/`:51`），后端 `publicStore` 有该字段 ✓。

**危险性操作**：停用有二次确认（`:95-97`）✓，且**后端 `setStoreStatus:639-649` 有在途单检查**——但 `ACTIVE_ORDER_STATUS`（`:642`）只列 7 个状态，**漏 `receipt_abnormal`**（`createReceipt:555` 写入的终态）。同时后端不检查"该门店是否还有活跃账号"，而 `login:206-207` 要求账号能查到 status:1 的门店 → 停用一家还有在库 chef/store_manager 的门店，这些账号集体登录失败，前端确认文案只说"下单时不可再选择该门店，历史单据保留"，完全没有预告。
**读路径无门禁**：`getStores`（`authService:310-331`）只校验登录，不校验角色。purchaser 深链进 store-manage 能读到全量门店（含停用），写操作才被 `requireSuperAdmin` 拦成 -403。首页入口 `index.wxml:49` 已用 `wx:if="{{isSuperAdmin}}"` 隐藏，但小程序路径可被构造直达。

**异常处理**：`showLoading` **不在 finally**（`:20-23`、`:62-87`）——若 `hideLoading` 后 `closeForm`/`loadData` 抛错，loading 悬挂。写操作有 `_submitting` ✓。

### 2.5 `pages/store-switch/`（133 行）

**职责**：从门店列表切换到当前门店（写 globalData + storage 后回退上一页）。

**json**：仅标题，无下拉刷新。

**数据流**：`onLoad:9`（async）→ `requireLogin` → **supplier 角色前端 `reLaunch` 回供应商门户**（`:14-17`）→ `authService.getStores()`（**不带 includeInactive**，只取启用门店，正确）→ 与 `globalData.currentStore` 比对高亮。`selectStore:32` 写 `app.globalData.currentStore` + `wx.setStorageSync('currentStore')` + `setData` 高亮 + `setTimeout(navigateBack, 800)`。

**问题**：
- **无空态、无加载态、无失败视图**：`loadData` 失败只 toast 一次（`:22-24`）就 return，页面只剩标题「选择门店」；门店数为 0（purchaser 无门店 / 数据异常）时页面完全空白，用户只能物理返回。
- **`selectStore` 无任何防重复**：连点两下会排两个 `setTimeout(navigateBack)`，可能多弹一层页面栈。
- **后端 getStores 无角色门禁**：supplier 角色其实可以枚举全部门店名 + 编号（`:14-17` 只在前端拦），这是本组唯一的供应商可见性缺口。

**wxss 死代码**：7 个选择器未被 wxml 使用——`.info-label` `.info-row` `.page-desc` `.store-card-header` `.store-card-info` `.store-content` `.store-icon`。

### 2.6 `pages/user-manage/`（531 行）

**职责**：账号 CRUD、角色分配（含门店/供应商关联）、重置密码、停用/启用。

**json**：仅标题 + `usingComponents:{}`，**无下拉刷新**。

**数据流**：`onShow:26` → `loadData:31` 三路并发（`authService.listUsers` / `getStores` / `getSuppliers`），仅当 users 与 stores 都成功才渲染（`:39`），suppliers 失败静默降级为空数组（`:41`）——设计合理。`displayStoreName:45-47` 按角色区分"关联供货商 / 关联门店"。写操作：`saveUser:180`、`saveResetPassword:115`、`toggleUserStatus:226`，全部 `authService`。

**状态字段 vs wxml**：10 个字段全部有消费者。唯一瑕疵：wxml `:84/:93/:102` 绑定 `form.roleIndex || 0` / `form.storeIndex || 0` / `form.supplierIndex || 0`，但这 3 个键**不在 data 初值 `form`（js:14）里**，只在 `showEditForm:82-88` 与三个 change 回调里被设置。新增账号时 picker 恒从第 0 项起，`form.role` 初值 `'chef'` 与 `roles[0]` 一致所以不穿帮；但 `stores`/`suppliers` 未加载完就打开弹窗时 picker 指向第 0 项而 `form.defaultStoreId` 仍为空，会显示"某某门店"却提交了空 id（后端 `validateUserInput:147-152` 兜住并报错）。

**危险性操作与后端闸门**（本组最危险的一页，后端最严）：
- **无硬删除入口**，只有停用（`toggleUserStatus`），有二次确认 ✓。前端 `:228` 只拦 `username === 'admin'`；后端更严：`setUserStatus:479` 拦"操作当前登录账号"、`:484-493` 拦"停用后不再有其他在岗超管"。**前端与后端口径不一致但后端更严，安全**。
- **重置密码**：前端有确认（`:126`）但**不拦重置自己**，后端 `resetPassword:446` 拦 `event.id === auth.user._id` 并引导去安全设置 ✓。
- `updateUser:417-419` 把 `admin` 账号的 username/role 硬锁回 `super_admin`，防止把自己锁死 ✓。
- 所有 5 个 action 走 `requireSuperAdmin`，**purchaser（"管理员"角色）无法管理账号**，与首页 `wx:if="{{isSuperAdmin}}"` 一致。

**防抖裸奔清单**：`saveUser` / `saveResetPassword` / `toggleUserStatus` **三个写操作都没有 `_submitting` 标志**，只靠 `util.showLoading({mask:true})` 的触摸遮罩副作用挡住连点。遮罩是同步生效的所以实际难触发重复提交，但一旦未来把 `showLoading` 换成非 mask 或改造成并行请求就会裸奔。R8 N-6 **仍然成立**。

**异常处理**：`loadData` 的 `showLoading`/`hideLoading` **不在 finally**（`:32`/`:54`）——`usersResult.data.map`（`:42`）在 code===0 但 data 为 null 时抛错，loading 永挂且页面停在旧数据。写操作失败 toast 有兜底文案，但因 §0.1 的嵌套结构问题，**会话过期时只显示 `'保存失败'/'密码重置失败'/'操作失败'` 且不跳登录**。

### 2.7 `pages/report-list/`（357 行）

**职责**：报表中心 tab 页（`app.json:56`），类型 Tab + 日期筛选 + 分页列表 + 生成汇总入口 + 跳历史报表。

**json**：标题 + `enablePullDownRefresh:true` ✓，实现了 `onPullDownRefresh:26` 与 `onReachBottom:30`（本组唯一两处）。

**数据流**：`onShow:20` → `initTabs:40`（按角色裁 tab）+ `reload:35` → `loadReports:67`（`getReports`，`PAGE_SIZE=20`，`reportType` 为空串表示全部）。`hasMore = reports.length < total`（`:98`）——口径正确。`generateSummary:125` 走 `generateSummaryReport`，`storeId` 取当前门店。

**类型 Tab 与角色**：chef → 1 类；store_manager → 3 类；purchaser/super_admin → 6 类。**6 类里没有 `store_daily_summary_report` / `store_monthly_summary_report`**，而 `report-history.js:29-34` 从 `Object.keys(meta.reportTypeMap)` 派生出全部 8 类 → **同一批报表在两页的筛选能力不对等**；`generateSummary` 刚生成的汇总报表只能靠 `activeType==='all'` 看到，没有专属 tab。

**汇总报表生成入口的功能性 bug**：`:126-131` 前端拦截 `['super_admin','purchaser']` 之外的角色，注释写"与云函数 GLOBAL_ROLES 口径一致：下单人员/店长点了必 403"，但 `generateSummaryReport/index.js:170` 是 `['store_manager','purchaser','super_admin']`，`:178-185` 还有店长强制绑定自有门店的专属分支。**店长被前端误屏蔽，且注释与代码直接矛盾**。

**状态字段 vs wxml**：`isLoadingMore`（`:17`）在 `:31/:71/:98/:100` 被读写 **4 次但 wxml 从未绑定** → 触底翻页期间没有任何"加载中/没有更多"反馈，与 purchase-list 的 `isLoading` 同型问题。`page`/`hasMore` 是内部状态不算死字段。wxml 无裸引用。

**分页/加载/空态**：空态有（wxml:59-62），触底续页有，下拉刷新有。缺：加载中指示、"没有更多"结束提示；首屏 `reports=[]` 期间会先闪一下「暂无报表」再被数据替换（`reload:36` 只重置 page/hasMore，不清空 reports，二次进入时反而保留旧数据直到新响应回来）。

**防抖**：`switchType:105` / `onDateFilter:110` / `clearDateFilter:115` 均直接 `reload()` 无防抖，快速连点产生并发 `loadReports(1,false)`，后发先至会覆盖正确结果。`generateSummary` 靠 `showLoading('生成中...')` 的 mask 兜住，无标志位。

**异常处理**：`result.code !== 0` 有 toast（`:99-101`）✓；`generateSummaryReport` 无 `rows.length===0` 守卫（`generateSummaryReport:224-263`），空跑也 bump 版本号、上传仅 3 行的 CSV、落库并返回 `code:0 itemCount:0`，前端只显示「汇总报表已生成」并 reload（`:152-153`），叠加全项目无 `report_file` 删除路径 → 空报表永久累积。

### 2.8 `pages/report-history/`（190 行）

**职责**：历史报表检索（作用域 + 类型 + 日期三维筛选）与分页列表。

**json**：标题 + `usingComponents:{}` + `enablePullDownRefresh:true` ✓。

**数据流**：`onShow:27` 重建 `reportTypeOptions`（从 `meta.reportTypeMap` 派生 8 类）并同步 `filterTypeLabel` → `reload` → `loadReports:54`（`getReports`，多传 `reportScope`）。作用域 picker 用 `scopeOptions:20-24` 三选项。

**副标题数字恒错**：wxml:5「共 {{reports.length}} 份报表」读的是**已加载条数**（`PAGE_SIZE=20`）；`loadReports:81` 拿到 `result.total` 后只用于算 `hasMore`（`:82`），**从未存入 data**。超过 20 条时永远显示「共 20 份报表」。而 report-list 干脆不显示条数 → 两页对"总数"的处理不一致。

**状态字段 vs wxml**：`isLoadingMore`（`:19`）同 report-list，4 次读写 0 次绑定。`filterScope` 在 wxml:12 用一个三目表达式 `scopeOptions[filterScope === 'all' ? 0 : (filterScope === 'store' ? 1 : 2)]` 反查 label，绕过了 picker 的 `value` 绑定能力，可读性差但功能正确。wxml:11-15 两个 picker **未绑定 `value`**，选中后滚轮不回显。

**空态/加载态**：空态有（wxml:39-42）；加载中指示无；首屏会闪空态。

**筛选一致性**：`filterType` 允许 8 类，但 `getReports:73-76` 会按 `allowedReportTypes`（8 项）校验后写入 query，再在 `:79-86` 对 chef/store_manager 强制收敛回自有门店 + store_order_report → 后端收敛正确，前端不会越权。

### 2.9 `pages/report-detail/`（406 行）

**职责**：单份报表详情渲染（6 段类型分支）+ 异常横幅 + 导出文件。

**json**：仅标题，**无下拉刷新**（详情页可接受）。

**数据流**：`onLoad:18` → `getReportDetail({reportId})` → 组装 `rpt`（驼峰/蛇形双读）→ 算 `totalAmount` → setData。`goSourceOrder:83` / `goRowOrder:90` 按行跳采购单；`exportReport:96` 走 `getReportFileUrl` → `wx.downloadFile` → `wx.openDocument`。

**合计口径（正确且与文件对齐）**：
- `reportType.includes('price')`（`:53`）：只累加 `payable !== false && !isManual` 的行，`Number(r.subtotal)` 求和后 `.toFixed(2)`，被剔除行数写入 `excludedNote` 并在 wxml:25-27 展示。与后端 `getReportDetail:119/192` 的"逐行先舍入到分"、`generateSummaryReport:221` 同口径 ✓。
- `reportType.includes('summary')`（`:63`）：直接 `r.subtotal` 求和。后端 `getReportDetail:245` 用 `Number(f[6]) || 0` 从 CSV 回读 → 是 number，累加正确。
- 其余 4 类（store_order / store_receipt / supplier_order / supplier_receipt）**totalAmount 恒为 `'0.00'`**，且这 4 段 wxml 都不渲染合计行 → 一致，不会误导。

**格式化不一致**：行级金额 `¥{{item.unitPrice}}` / `¥{{item.subtotal}}`（wxml:92-93）原样输出，而合计走 `toFixed(2)` → 同一张表内「¥12.5」与「¥12.50」混排。无千分位。空值：`item.category`（wxml:39）、`item.unit` 为空时无占位符。`scopeLabel`（`:75`）用 `reportScope === 'store' ? '门店' : '供应商'`，reportScope 为空时误判为「供应商」。

**wx:key 撞键**：wxml:128 汇总段用 `wx:key="productName"`，而聚合键是 `supplier_id|product_id`（`generateSummaryReport:204`，注释明说"同一商品多供应商时分行体现"）→ 同商品多供应商必产生同名行，重复 key 告警 + 渲染错乱。其余段用 `wx:key="index"`（反模式但不出错）。

**失败视图缺失（本组最差）**：`onLoad:77-79` 云函数失败只 toast「加载失败」，wxml 走 `wx:else` 分支显示「报表数据加载中...」（wxml:146）→ **失败被伪装成加载中，用户无限等待**。无 try/catch、无失败重试入口、无空态区分。

**导出链路必失败**：全部报表落库为 `.csv`（`generateSummaryReport:241`、`dataService:436/477/1020/1221/1248/1281/1308`），`:110` `wx.openDocument` 未传 `fileType`，`wx.downloadFile` 的 `tempFilePath` 也不带扩展名，基础库 `openDocument` 官方支持 doc/docx/ppt/pptx/pdf/xls/xlsx 不含 csv → 推断必然落 `fail()` → 只显示「打开失败」，`showMenu:true` 的转发/另存一并失效。

**状态字段 vs wxml**：7 个字段（`report/rows/totalAmount/typeLabel/typeIconClass/typeColor/scopeLabel`）**全部绑定** ✓，`report.excludedNote` 由 `:61` 条件写入并被 wxml:25 消费 ✓。死代码：`onLoad:21` 的 `const app = getApp()` 未使用。

**报表三页跳转一致性**：report-list `goDetail:159` 与 report-history `goDetail:112` 都用 `/pages/report-detail/report-detail?id=` + `item.reportId`，report-detail `onLoad:20` 读 `options.id` → **三页 id 口径一致 ✓**，无参数漂移。

---

## 3. 报表三页横向口径对照

| 维度 | report-list | report-history | 结论 |
|---|---|---|---|
| 类型全集 | 6 类硬编码（:55-62） | 8 类从 `meta.reportTypeMap` 派生（:29-34） | **不一致**，缺 2 个汇总类 |
| 作用域筛选 | 无 | 有（scopeOptions） | 不对等 |
| 总数展示 | 不展示 | 展示 `reports.length`（错） | **两页都没有正确的 total 展示** |
| storeId 传参 | 传（:75） | 传（:62） | 后端 `getReports:43` 解构后**从未使用**，管理员切门店无效 |
| 分页 | `hasMore = reports.length < total` ✓ | 同 ✓ | 一致 |
| 触底/下拉 | ✓ / ✓ | ✓ / ✓ | 一致 |
| isLoadingMore | 写 4 次，wxml 0 次 | 写 4 次，wxml 0 次 | **同型问题** |
| 跳详情 | `id=` + reportId | `id=` + reportId | **一致** |
| 作废标记 | `status === 'superseded'` ✓ | ✓ | 一致 |
| 异常标记 | `hasAbnormal` + abnormalLabel | 不显示 | 不对等（history 无异常入口） |

`getReports` 对 chef/store_manager 的二次收敛（`:79-86`）在 reportType 先被前端参数污染之后仍强制覆盖 → 后端越权防护正确，前端两页都不存在越权面。

---

## 4. 供应商角色可见性（后端闸门逐条核验）

首页 `index.js:31` 对 supplier 直接 `reLaunch` 到供应商门户，`index.wxml:30` 用 `wx:if="{{isManager}}"` 隐藏管理卡片，`user-manage`/`store-manage` 入口再叠 `isSuperAdmin`。**前端 requireLogin 确实只校验登录态**（`utils/auth-guard.js:5-14`，无任何角色判断），因此逐条查了后端：

| 页面 | 读路径后端闸门 | 写路径后端闸门 | 供应商可达？ |
|---|---|---|---|
| product-manage | getProducts/getSuppliers（supplier → 仅自己）/getCategories（**任意登录用户**） | `MANAGEMENT_ROLES`（super_admin\|purchaser） | 否 |
| supplier-manage | getSuppliers（supplier → 仅自己档案） | `MANAGEMENT_ROLES` | 否 |
| price-manage | getProductPrices（supplier → `query.supplier_id = 自己`，**忽略前端 supplierId**） | `['super_admin','purchaser']` | 否 |
| store-manage | getStores（**无角色门禁**） | `requireSuperAdmin` | **读路径可触达** |
| store-switch | getStores（**无角色门禁**） | 无 | **读路径可触达** |
| user-manage | listUsers/createUser/updateUser/resetPassword/setUserStatus 全部 `requireSuperAdmin` | 同 | 否 |
| report-list | getReports（supplier → -403） | generateSummaryReport（supplier → -403） | 否 |
| report-history | getReports（supplier → -403） | — | 否 |
| report-detail | getReportDetail/getReportFileUrl（supplier → -403，`:74` / `:50-51`） | — | 否 |

**唯一缺口**：`authService.getStores:310-331` 只校验登录。supplier 角色调用可枚举全部门店的 `store_name` + `store_code`；purchaser 传 `includeInactive:1` 可拿全量含停用门店。`store-switch.js:14-17` 的 supplier 拦截与 `index.wxml` 的入口隐藏都是纯前端保护。
**附带**：`getSuppliers` 对 chef/store_manager 返回全量供应商（含 `contact_phone`），无门店归属收敛；`getSuppliers:61` 的 `db.RegExp({ regexp: keyword })` 未转义客户端输入，存在非法正则报错/ReDoS 面（前端 supplier-manage 实际走本地过滤，仅直调 API 可触达）。

---

## 5. 分页 / 下拉刷新 / 空态 / 加载态完整性矩阵

| 页面 | 分页 | 下拉刷新 | 空态 | 加载中指示 |
|---|---|---|---|---|
| price-manage | ✗（单次 limit 200） | ✗ | ✓ | ✗ |
| product-manage | ✗（单次 limit 100） | ✗ | ✓ | ✗ |
| supplier-manage | ✗（单次 limit 100） | ✗ | ✓ | ✗ |
| store-manage | ✗（单次 limit 100） | ✗ | ✓ | ✗（仅 store-manage 的 loadData/saveStore/toggleStoreStatus 有 `showLoading`） |
| store-switch | ✗ | ✗ | **✗** | ✗ |
| user-manage | ✗（limit 100） | ✗ | ✓ | ✗（loadData/saveUser/toggleUserStatus 有 `showLoading`） |
| report-list | ✓ | ✓ | ✓ | ✗（`isLoadingMore` 未绑定） |
| report-history | ✓ | ✓ | ✓ | ✗（`isLoadingMore` 未绑定） |
| report-detail | — | ✗ | ✗（失败伪装成加载中） | 一次性 showLoading ✓ |

**已知「定义了 isLoading 但 wxml 未绑定」问题在本组的实例**：`report-list.js:17`、`report-history.js:19` 两处 `isLoadingMore`，共 8 次 setData 读写，wxml **0 次引用**（grep `isLoading|hasMore|loading` 于 9 页 wxml 结果为空）。

---

## 6. 与旧报告对照（仍然成立 / 代码已变化 / 旧报告判断有误）

| 旧结论 | 出处 | 本轮判定 |
|---|---|---|
| N-1 dataService/authService 嵌套 `-401` 使会话过期不跳登录 | R8 §0 | **仍然成立**。`dataService:46-49`、`authService:334-338` 与 `cloud.js:68` 均未变。本轮把影响面精确到本组 10 个写操作的具体行号 |
| N-2 `getReports` 忽略 `storeId` | R8 §0 | **仍然成立**（`getReports:43` 解构，`:49-66` 未引用） |
| N-4 `setStoreStatus` 在途单检查漏 `receipt_abnormal` | R8 §0 | **仍然成立**（`authService:642`）。已确认 `receipt_abnormal` 是真实终态（`createReceipt:555`、`meta.js:9`） |
| N-5 管理页硬编码 `includeInactive:true`，非管理员深链 2 个并发 -403 | R8 §0 | **仍然成立**。行号漂移：`product-manage.js:31,33` → **现 :37,:39**；`price-manage.js:34,35` → **现 :34,:35**（未漂移） |
| N-6 user-manage 三个写操作无 `_submitting` | R8 §0 | **仍然成立**（`saveUser:180`/`saveResetPassword:115`/`toggleUserStatus:226`） |
| N-9 `user-manage.js:42` `usersResult.data.map` 无空数组兜底 | R8 §0 | **仍然成立**，且叠加 `showLoading` 不在 finally → loading 永挂 |
| N-10 7 页 0 个 `enablePullDownRefresh` | R8 §0 | **仍然成立**（R8 统计的 7 页中无一开启；本轮补测全项目共 7 页开启，均不在 R8 的 7 页内） |
| R8 对 product-manage 的行号基线（250 行） | R8 §1 | **代码已变化**：现 284 行，新增 `isUserCancel:10-12` 与 `importEnvBlocker:119-143` 的环境探测块，导入相关行号整体下移 |
| report-history 副标题数字恒错 | R10 §0.5 | **仍然成立**（wxml:5 + `report-history.js:81` 的 total 未入 data） |
| report-list tab 只有 6 类、history 有 8 类 | R10 §0.2 | **仍然成立** |
| `generateSummaryReport` 空跑不拦截 | R10 §0.3 | **仍然成立**（`:224-263` 无 `rows.length===0` 守卫） |
| `report-detail.wxml:125` `wx:key="productName"` 撞键 | R10 §0.6 | **仍然成立，行号漂移 125 → :128** |
| `report-list.js:126` 注释与 `generateSummaryReport` 的 store_manager 口径矛盾 | R10 §0.7 | **仍然成立**，且本轮明确其为**功能性 bug**：店长被前端误屏蔽，后端 `:170` 与 `:178-185` 都支持店长 |
| `report-detail.js:103-108` openDocument 打开 csv 必失败 | R10 §0.8 | **仍然成立**。行号漂移 `:103-108` → **现 :107-118**。本轮补证：全部 8 处报表落库均为 `.csv`，无一为 xlsx |
| 报表 4 云函数契约扁平无双层嵌套 | R10 §0.1 | **仍然成立**，本轮独立复核 `getReports:98`/`getReportDetail:256`/`getReportFileUrl:57`/`generateSummaryReport:247-264` 均为扁平 `{code,data}` |
| R10 称 report-detail.js 119 行 / wxml 156 行 | R10 §1 | **代码已变化**：现 js 126 行 / wxml 159 行 |
| 「report-list 有 isLoading 但 wxml 未绑定」类问题（purchase-list 同型） | 任务书 | **仍然成立并扩展**：本组 report-list/report-history 各有 1 处 `isLoadingMore` 未绑定；且 9 页 wxml 对加载态的绑定数为 0 |
| R8 认为本组写操作防抖覆盖差 | 任务书前提（全局 13 写操作仅 1 满分） | **旧印象在本组不成立**：本组 14 个写操作中 8 个有 `_submitting`、5 个有 `showLoading(mask)`，只有 `store-switch.selectStore` 完全裸奔 |
| `report_file.total_amount` 是否被前端消费 | — | **本轮新发现**：`generateSummaryReport:262` 写入，全项目 0 处读取（前端 report-detail 自己重算），字段目前无消费者 |

---

## 7. 问题清单

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| 高 | `cloudfunctions/dataService/index.js:46-49` + `authService/index.js:334-338` vs `utils/cloud.js:68` | -401/-403 返回嵌套 `{error:{code,msg}}`，前端只判顶层 `code` → 会话过期不跳登录，且 toast 拿到 undefined 的 msg | 会话过期（7 天 TTL）后在 product/supplier/store/user-manage 执行任一写操作，如 `product-manage.js:244`、`supplier-manage.js:76`、`store-manage.js:103`、`user-manage.js:210` |
| 高 | `cloudfunctions/authService/index.js:642` | `ACTIVE_ORDER_STATUS` 漏 `receipt_abnormal`（`createReceipt:555` 的真实终态）→ 在途单检查对该状态失效；且不停用门店前不检查是否有活跃账号 | store-manage 停用一家存在收货异常未结订单、且仍有 chef/store_manager 在库的门店 → 这些账号因 `login:206-207` 集体登录失败 |
| 中 | `pages/report-list/report-list.js:126-131` | 前端拦截 store_manager 生成汇总，注释称与 `GLOBAL_ROLES` 一致，但 `generateSummaryReport/index.js:170` 与 `:178-185` 明确支持店长 | 店长点击「生成汇总 ▸」只得到「仅管理员可生成汇总报表」，功能被误屏蔽 |
| 中 | `pages/report-history/report-history.wxml:5` + `report-history.js:81` | 副标题「共 N 份」读已加载条数；`result.total` 只用于算 hasMore 从未入 data | 报表超过 20 条后翻页，副标题永远停在「共 20 份报表」 |
| 中 | `pages/report-list/report-list.js:55-62` | typeTabs 硬编码 6 类，缺 `store_daily_summary_report`/`store_monthly_summary_report`；report-history 派生 8 类 | 刚生成的日/月汇总只能靠「全部」tab 找到，无专属筛选；两页能力不对等 |
| 中 | `cloudfunctions/getReports/index.js:43` | 解构 `storeId` 但 `:49-66` 全程未引用，前端传的 storeId 被丢弃 | 管理员在 store-switch 切到某门店后打开报表中心/历史报表，仍显示全部门店报表 |
| 中 | `pages/report-detail/report-detail.js:96-125` | `wx.openDocument` 打开 `.csv` 未传 `fileType`，且 tempFilePath 无扩展名；全部报表落库均为 csv | 详情页点「导出报表文件」→ 必然走 `fail()` 显示「打开失败」，`showMenu:true` 的转发/另存一并失效 |
| 中 | `pages/report-detail/report-detail.js:77-79` + `report-detail.wxml:146` | 云函数失败只 toast「加载失败」，wxml 落 `wx:else` 显示「报表数据加载中...」 | 点进一个已删除/无权限/云函数超时的报表，页面永久停在"加载中"，无重试入口 |
| 中 | `pages/supplier-manage/supplier-manage.js:37-40` | `onSearch` 无防抖直接 `loadData()`，每次击键拉全量 + 云函数内分批回查 product 计数；`loadData:20-35` 无 showLoading | 快速输入 5 个字 → 5 次并发云函数调用，后发先至时旧响应按新关键词过滤旧数据 |
| 中 | `pages/store-switch/store-switch.js:26-30` | 无空态、无加载态、无失败视图 | 门店为 0（purchaser 无门店/数据异常）时页面只剩标题；加载失败只 toast 一次后永久空白 |
| 中 | `cloudfunctions/generateSummaryReport/index.js:224-263` | 无 `rows.length === 0` 守卫，空跑仍 bump 版本号、上传 3 行 CSV、落库返回 `code:0 itemCount:0` | 门店当日无收货（或全为手动行，`:201` 被跳过）时点「生成今日日汇总」→ 前端显示「汇总报表已生成」，空报表永久累积 |
| 中 | `pages/report-detail/report-detail.wxml:128` | `wx:key="productName"`，聚合键实为 `supplier_id\|product_id`（`generateSummaryReport:204`） | 同商品来自多家供应商的汇总报表 → 重复 key 告警 + 渲染错乱 |
| 中 | `pages/report-list/report-list.js:17`、`pages/report-history/report-history.js:19` | `isLoadingMore` 读写各 4 次但 wxml 0 次绑定；触底翻页无任何"加载中/没有更多"反馈 | 第 2 页加载期间用户重复触底，视觉无任何变化 |
| 中 | `pages/report-detail/report-detail.wxml:92-93` | 行级 `¥{{item.unitPrice}}`/`¥{{item.subtotal}}` 原样输出，合计走 `toFixed(2)` | 同一张价格报表内「¥12.5」与「¥12.50」混排 |
| 中 | `pages/price-manage/price-manage.wxml:30` + `cloudfunctions/updateProductPrice/index.js:104` | 后端存 `Number(newPrice)` 不截位，前端 `:127`/`:200` 只校验 `>0`；展示原样 | 输入 `12.345` → 价格表存 12.345，列表显示「¥12.345」，而报表侧逐行舍入到分，两口径不一致 |
| 中 | `pages/user-manage/user-manage.js:31-55` | `showLoading` 不在 finally，`usersResult.data.map`（:42）在 code===0 但 data 为 null 时抛错 | 后端返回 code:0 + data:null → loading 永挂，页面停在旧数据 |
| 中 | `pages/user-manage/user-manage.js:180/115/226` | 三个写操作均无 `_submitting`，仅靠 `showLoading({mask:true})` 副作用兜住 | 遮罩是同步生效的所以当前难触发，但一旦改为非 mask 或并行请求即裸奔 |
| 中 | `cloudfunctions/importProducts/index.js:182` | `e.message` 原文进 `errors[].msg`，由 `product-manage.wxml:62-65` 弹窗直接展示 | 云函数写入失败时把底层异常（集合名/字段名/超时）暴露给终端用户 |
| 中 | `cloudfunctions/importProducts/index.js:186-194` | 逐条 add 无事务，中途失败留下半量数据；`rows.length` 无上限校验 | 大表导入超时 → 部分商品已入库且无法回滚；`total` 统计含全空行（`:199`） |
| 中 | `pages/product-manage/product-manage.js:132-161` | Excel 批量导入全程无二次确认（唯一无确认的批量写操作） | 误选文件点确定即上传入库，无撤销入口 |
| 低 | `cloudfunctions/authService/index.js:310-331` | `getStores` 无任何角色门禁 | supplier 角色调用可枚举全部门店名+编号（store-switch:14-17 只前端拦）；purchaser 传 includeInactive=1 拿全量含停用门店 |
| 低 | `pages/store-switch/store-switch.js:32-42` | `selectStore` 无防重复，连点排两个 `setTimeout(navigateBack)` | 快速连点同一门店卡 → 多弹一层页面栈 |
| 低 | `pages/price-manage/price-manage.js:88` | `list.sort()` 在无筛选时原地排序 `this.data.allPrices`（list 为其引用） | 排序副作用写入源数组，下次 loadData 前筛选顺序被污染 |
| 低 | `pages/price-manage/price-manage.js:60-62,69` | 深链 supplierId 不在供应商表中时 `selectedSupplierName` 回退成裸 id | 手工构造 `price-manage?supplierId=任意值` → 筛选器显示原始 id |
| 低 | `pages/user-manage/user-manage.wxml:84/93/102` | 绑定 `form.roleIndex/storeIndex/supplierIndex`，但 `data.form`（js:14）未定义这 3 键，仅靠 `\|\| 0` 兜底 | stores/suppliers 未加载完就打开新增弹窗 → picker 显示第 0 项但提交空 id（后端兜住） |
| 低 | `pages/report-detail/report-detail.js:75` | `scopeLabel = reportScope === 'store' ? '门店' : '供应商'` | reportScope 为空时误判为「供应商」 |
| 低 | `pages/report-list/report-list.js:105-118`、`report-history.js:89-104` | 切换类型/作用域/日期无防抖，可并发触发多次 reload | 快速连点 tab → 并发 loadReports，后发先至覆盖正确结果 |
| 低 | `pages/report-history/report-history.wxml:11-15`、`pages/product-manage/product-manage.wxml:84/91/115` | picker 未绑定 `value`，选中后滚轮不回显当前项 | 关闭重开 picker 时选中项不归位（靠文字兜住显示） |
| 低 | `pages/report-list/report-list.js:96` | 翻页 append 用 `reports.concat`，无 reportId 去重 | 翻页瞬间后台新增/删除报表 → 列表可能重复或跳号 |
| 低 | `cloudfunctions/getSuppliers/index.js:61` | `db.RegExp({ regexp: keyword })` 未转义客户端输入 | 直调 API 传非法正则（如 `(`）→ 查询报错；恶意正则可致 ReDoS |
| 低 | `cloudfunctions/getSuppliers/index.js:53-59` | chef/store_manager 可取全量供应商含 `contact_phone`，无门店归属收敛 | 下单人员账号读取其他门店供应商的联系电话 |
| 低 | `pages/price-manage/price-manage.js:133/214` | 传 `updatedBy: userInfo.name`，但后端 `updateProductPrice:126` 用 `user.user_id \|\| user._id \|\| updatedBy` | 前端传的姓名永不生效，审计链上是 id 而非姓名 |
| 低 | 死代码 `const app = getApp()` | price-manage:32、supplier-manage:21/75/104、user-manage:33/130/207、report-detail:21 | 共 7 处未使用 |
| 低 | `pages/store-switch/store-switch.wxss` | 7 个死选择器：`.info-label .info-row .page-desc .store-card-header .store-card-info .store-content .store-icon` | wxml 未使用，纯冗余 |
| 低 | `pages/price-manage/price-manage.js:147-153` | 改价仅 `affected > 0` 才二次确认；首次定价 `saveNewPrice` 完全无确认 | 无在途单时改价、以及首次定价直接写入价格表，不可逆 |
| 低 | `pages/report-list/report-list.js:42` | `role` 缺省回退为 `'purchaser'`，缺角色时展示全部 6 个管理 tab | userInfo.role 为空时前端显示管理员 tab，随后每次请求被后端 -403 |
| 低 | `cloudfunctions/generateSummaryReport/index.js:262` | `report_file.total_amount` 写入但全项目 0 处读取（前端 report-detail 自己重算） | 字段无消费者，页内合计与库内 total_amount 可能各自演化 |

---

## 8. 修复优先级建议（供主控参考，不改代码）

1. **先修 §0.1 的嵌套 -401**：在 `utils/cloud.js:68` 增加 `const code = result.code ?? result.error?.code` 一处即可覆盖全部 20 处嵌套返回，收益最大。
2. **`setStoreStatus` 补 `receipt_abnormal` 到 `ACTIVE_ORDER_STATUS`**，并加"该门店是否还有 status:1 的账号"检查，或在 store-manage 的确认文案里预告。
3. **report-list 放开 store_manager** 并删掉错误注释；补齐 2 个汇总类 tab。
4. **report-history 把 total 入 data**（`this.setData({total})` + wxml 用 total），或直接与 report-list 统一为不显示总数。
5. **导出改服务端转 xlsx**（`SheetJS xlsx ^0.18.5` 已在 importProducts 引入，依赖现成），或至少给 `openDocument` 补 `fileType`。
6. **两个报表页补加载中/到底提示**并绑定 `isLoadingMore`；report-detail 补失败视图与重试。
7. **supplier-manage.onSearch 加 300ms 防抖**（或改为纯本地过滤，去掉击键网络往返）。
8. **user-manage 三个写操作补 `_submitting`**，`loadData` 的 loading 移进 finally。
9. **`getStores` 加角色门禁**（supplier 直接 -403）。
