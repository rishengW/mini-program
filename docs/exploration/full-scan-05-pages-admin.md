# 批 5：管理后台 7 页横向扫描（28 文件全读）

> 范围：`pages/index`、`product-manage`、`price-manage`、`store-manage`、`store-switch`、`supplier-manage`、`user-manage`（各 js/json/wxml/wxss，共 28 文件 2524 行）
> 只读参考：`utils/cloud.js`、`utils/auth-guard.js`、`utils/meta.js`、`utils/util.js`、`app.js`、`app.json`
> 交叉核验：`cloudfunctions/*`（authService / dataService / getProducts / getSuppliers / getProductPrices / updateProductPrice / getPurchaseOrders / getReports / createPurchaseOrder）
> 方法：只信代码不信注释，结论带 `文件:行号`。与 batch1/2、controller-horizontal-scan、full-scan-06 已结案的条目不重复展开。
> 版本：以磁盘当前内容为准（commit 5268379 已含 store-manage +81 / supplier-manage +56 / product-manage +58）。

---

## 0. 文件覆盖清单（28 文件）

| 路径 | 行数 | 职责 |
|---|---|---|
| `pages/index/index.js` | 182 | 首页聚合（门店/用户头、管理台入口、4 张统计卡、最近单、最近报表、退出） |
| `pages/index/index.wxml` | 109 | 首页视图 |
| `pages/index/index.wxss` | 176 | 首页样式（含未使用的门店弹窗样式） |
| `pages/index/index.json` | 2 | 标题「首页」，无组件 |
| `pages/product-manage/product-manage.js` | 250 | 商品增删改 + Excel 批量导入 + L1 分类筛选 |
| `pages/product-manage/product-manage.wxml` | 128 | 商品列表 + 导入结果弹窗 + 新增/编辑弹窗 |
| `pages/product-manage/product-manage.wxss` | 61 | 样式 |
| `pages/product-manage/product-manage.json` | 4 | 标题「商品管理」 |
| `pages/price-manage/price-manage.js` | 228 | 协议价列表（供应商筛选 + 搜索）+ 改价（dryRun 波及提示）+ 首次定价 |
| `pages/price-manage/price-manage.wxml` | 102 | 价格列表 + 两个弹窗 |
| `pages/price-manage/price-manage.wxss` | 55 | 样式 |
| `pages/price-manage/price-manage.json` | 4 | 标题「价格管理」 |
| `pages/store-manage/store-manage.js` | 120 | 门店增改 + 软停用/恢复 |
| `pages/store-manage/store-manage.wxml` | 62 | 门店列表 + 单个弹窗 |
| `pages/store-manage/store-manage.wxss` | 148 | 样式 |
| `pages/store-manage/store-manage.json` | 3 | 标题「门店管理」 |
| `pages/store-switch/store-switch.js` | 44 | 门店选择（改 globalData + storage） |
| `pages/store-switch/store-switch.wxml` | 16 | 门店卡片列表 |
| `pages/store-switch/store-switch.wxss` | 71 | 样式 |
| `pages/store-switch/store-switch.json` | 2 | 标题「切换门店」 |
| `pages/supplier-manage/supplier-manage.js` | 121 | 供应商增改 + 启停 + 跳该供应商价格 |
| `pages/supplier-manage/supplier-manage.wxml` | 67 | 供应商列表 + 弹窗 |
| `pages/supplier-manage/supplier-manage.wxss` | 34 | 样式 |
| `pages/supplier-manage/supplier-manage.json` | 4 | 标题「供应商管理」 |
| `pages/user-manage/user-manage.js` | 251 | 账号增改 + 重置密码 + 停用/恢复 |
| `pages/user-manage/user-manage.wxml` | 116 | 账号列表 + 重置密码弹窗 + 新增/编辑弹窗 |
| `pages/user-manage/user-manage.wxss` | 160 | 样式 |
| `pages/user-manage/user-manage.json` | 4 | 标题「账号管理」 |

**事件绑定 × js 方法对照（7 页全量比对，共 62 处绑定）**：**0 处对不上**。
所有 `bindtap` / `bindinput` / `bindchange` / `catchtap` 目标方法在对应 js 中均有定义，无 `bind:tap`（带冒号）误写、无大小写错位、无缺方法。
反向存在 **1 处死代码**：`index.js:126 stopBubble()` 在 `index.wxml` 中无任何 `catchtap` 引用（见 §L1）。

**data 字段 × wxml 引用对照**：**0 处「wxml 引用但 js 从未赋值」**。
7 页所有 wxml 引用的字段（含 `item.*` 派生字段）都能在 js 的 `setData` 或云函数返回体的归一化映射中找到来源。
反向存在「js 定义但 wxml 不引用」的 3 处，均为 js 内部中间量，非缺陷：`product-manage.js:17 categories`（供 `filteredCategories` 过滤用）、`price-manage.js:9 allPrices`（供 `applyFilter` 与去重判定用）、`price-manage.js:20 products` / `:10 suppliers`（wxml 实际引用了，属正确用法）。

---

## 1. `pages/index/index.js`（182 行）

### 1.1 职责与数据流
- **无 `onLoad`**，全部逻辑在 `onShow`（`js:21`）。首页是 tabBar 页（`app.json:44`），每次切回 tab 都会重跑。
- 三重前置判断：`requireLogin()`（`js:22`）→ `app.globalData.isLoggedIn` 复查 + `wx.redirectTo`（`js:24-26`）→ supplier 角色 `reLaunch` 到供货商门户（`js:31-33`）。
- `storeId` 取自 `app.globalData.currentStore.storeId || .id || ''`（`js:35-37`）。
- **4 个云函数 `Promise.all` 并发**（`js:41-56`）：`getPurchaseOrders{role,storeId,createdBy,pageSize:3}`、`getReports{role,storeId,reportType:'',relatedDate:''}`、`dataService{action:'getMessages'}`、`dataService{action:'getOrderStats',storeId}`。
- 统计卡来自 `getOrderStats` 服务端聚合（`js:72-77`），不受分页截断影响 —— 口径正确。

### 1.2 派生字段（`js:91-106`）
| 字段 | 来源 | 行号 |
|---|---|---|
| `statusText` / `statusType` | `meta.getStatusInfo(o.orderStatus)` | `js:92,95-96` |
| `itemCount` | `o.items.length` | `js:97` |
| `manualCount` | `o.items.filter(i => i.isManual).length` | `js:98` |
| `createdBy` | `normalizePurchaseOrder.createdBy`（`cloud.js:153`，回退链 `created_by_name → created_by`） | wxml:84 |
| `orderDate` / `storeName` | `cloud.js:150 / :149` | wxml:74,80 |
| `typeLabel` / `typeIconClass` | `meta.getReportTypeInfo(r.reportType)` | `js:104-105` |
| `scopeName` / `relatedDate` | `normalizeReport`（`cloud.js:219,220`） | wxml:100 |

归一化链路完整，wxml 引用的字段均有值，**不存在「引用未映射字段导致空态」的情况**。

### 1.3 跳转与传参
- `goStatPage`（`js:155-167`）：`message` → `switchTab` 消息页；`abnormal` → 异常列表（**该分支永不触发**：`stats` 数组从不产出 `status:'abnormal'`，`js:80-88` 只产出 `submitted` / `receivable` / `received` / `message` / `to_verify`，属死分支）；其余 → 写 `getApp().globalData.pendingListFilter = status` + `switchTab` 到采购页。
- 消费端已确认存在：`purchase-list.js:34-36` 在 `onShow` 读取并清空 `pendingListFilter`，且 `receivable` / `to_verify` 都在其 tab 集合内（`purchase-list.js:90,98`）—— 首页卡片点击链路**成立**。
- `goAction`（`js:177-181`）：`data-url` → `navigateTo`，`data-taburl` → `switchTab`（报表 tab，`wxml:94`）。

### 1.4 问题
- **H2 · 首页消费 dataService 两个 action，会话过期不跳登录**（见问题清单 H2）。
- **M2 · 无任何 loading / error / 空态三态**（`js:62-65,108-116`）：任一请求失败即 `return`，`setData` 未执行 → 页面**沿用上一次渲染的旧数据**，只显示一句 toast。用户看到的仍是过期统计数字。
- **M3 · 每次 `onShow` 无节流并发 4 个云函数**（`js:41-56`）；其中 `getPurchaseOrders` 服务端内部再跑 9 个 `count`（`getPurchaseOrders/index.js:84-94`），`getOrderStats` 再跑 4 个 `count`（`dataService/index.js:847-855`）。切 tab 即触发，无缓存。

---

## 2. `pages/product-manage/`（js 250 行）

### 2.1 职责与数据流
- 仅 `onShow`（`js:23-26`）→ `requireLogin()` → `loadData()`。**无分页、无 `onPullDownRefresh`、无 `onReachBottom`、无 loading 态**。
- `loadData`（`js:28-63`）3 个并发：`getProducts{includeInactive:true}`、`dataService{action:'getCategories'}`、`getSuppliers{includeInactive:true}`。
- 列表在前端派生 `categoryName` / `l1Name` / `supplierName`（`js:46-55`），供应商缺失兜底 `'未指定'`。
- 筛选 `applyFilter`（`js:75-85`）纯前端：L1 分类 + 关键字（仅匹配 `name`）。
- Excel 导入（`js:110-165`）：`chooseMessageFile` → `wx.cloud.uploadFile` → `importProducts{fileID}`，结果弹窗展示前 10 条错误行。

### 2.2 调用云函数与入参来源
| action | 入参 | 来源 |
|---|---|---|
| `getProducts` | `includeInactive:true` | 硬编码（`js:31`） |
| `dataService.getCategories` | 无 | — |
| `getSuppliers` | `includeInactive:true` | 硬编码（`js:33`） |
| `importProducts` | `fileID` | `wx.cloud.uploadFile` 返回值（`js:140`） |
| `dataService.saveProduct` | `productId`(编辑时) + `...form` + `name/unit` trim | 表单（`js:209-215`） |
| `dataService.toggleProduct` | `productId` | 列表项 id（`js:239-242`） |

### 2.3 前后端校验对照
| 项 | 前端（`js:199-204`） | 后端（`dataService:91-130`） | 结论 |
|---|---|---|---|
| 名称非空 | ✓ `form.name.trim()` | ✓ `:94-97` | 一致 |
| 分类必填 | ✓ `form.categoryId` | ✓ `findCategory` 反查（`:96,:109-111`） | 一致，后端以 `categoryId` 为唯一真相 |
| 单位非空 | ✓ | ✓ | 一致 |
| **名称重复** | ✗ 未校验 | **✗ 后端也未查重** | **双端都缺** → 见 H4 |
| 供应商有效性 | 前端只校验「已选」 | ✓ `:99-105` 停用供应商拒绝 | 后端兜住 |
| 厂家/品牌 | **wxml:109 标 `*` 必填但不校验** | 空串兜底 `'默认'`（`:115`） | 标注与实现不符 → 见 M11 |
| `spec` 长度 | 不限 | 不限 | 双端一致 |

### 2.4 问题
- **H4 · `saveProduct` 无重名检测**（`dataService:91-130` 全函数无 duplicate 查询；对照 `saveSupplier:155-161`、`createStore:516-522`、`createUser:357-361`、`updateUser:404-409` 均有查重）。
- **M12 · 无前端角色门禁**（`js:23-26` 仅 `requireLogin`）→ 见 H3。
- **L2 · `const app = getApp()` 未使用**（`js:208`、`js:238`）。
- **L7 · `wx:key="index"` 用于字符串数组**（`wxml:64` 的 `importResult.lines`），数组插入时 key 会错位复用节点。
- **L8 · 提交冗余字段**：`js:209-215` 传 `categoryL1` / `categoryL1Name` / `categoryName` / `supplierName`，后端 `dataService:91-130` 全部忽略（只用 `categoryId` + `defaultSupplierId` 反查）。无害但易误导维护者以为这些字段落库。
- 提交防连点用 `this._submitting`（`js:200,206,221`），**按钮无 loading/disabled 视觉态**（`wxml:124`）→ 双击静默无反应。低。

---

## 3. `pages/price-manage/`（js 228 行）

### 3.1 职责与数据流
- `onLoad(options)`（`js:24-27`）：`requireLogin()` + 读 `options.supplierId` 存入 `this._initialSupplierId`（供 `supplier-manage.goProducts` 深链，`supplier-manage.js:119`）。
- `onShow`（`js:29`）直接 `loadData()` —— **未复查登录态**（与其余 6 页不一致，见 §L10）。
- `loadData`（`js:31-72`）3 并发：`getSuppliers`、`getProducts`、`getProductPrices{onlyCurrent:true}`；服务端返回体已带 `product_name`/`unit`（`getProductPrices/index.js:75-82`），前端用本地 map 再补一次 `productName`/`productUnit`/`productCategory`/`supplierName`（`js:49-59`）。
- `applyFilter`（`js:74-91`）：供应商 + 关键字，再按供应商名排序。
- **改价两段式**（`js:125-170`）：先 `dryRun:true` 取 `affectedOrders`，>0 时弹「调价波及提醒」确认框，确认后二次调用真实提交。与 `updateProductPrice/index.js:97-101` 的 dryRun 契约吻合。
- **首次定价**（`js:173-227`）：`showAddPrice` → 选供应商/商品/填价 → `updateProductPrice`（无 dryRun）。

### 3.2 前后端校验对照
| 项 | 前端 | 后端（`updateProductPrice:71-89`） | 结论 |
|---|---|---|---|
| 价格有效性 | `parseFloat` + `isNaN` + `>0`（`js:127-128,200-201`） | `Number` + `isFinite` + `>0`（`:76-79`） | 一致 |
| **小数位** | ✗ 不限（`wxml:54,89` `type="digit"` 允许任意位） | ✗ 不限 | 双端都缺 → 见 M9 |
| 供应商/商品必填 | ✓ `js:198-201` | ✓ `:73-75` | 一致 |
| 重复组合拦截 | ✓ 前端基于 `allPrices` 查重（`js:204-205`） | ✗ 后端不查重，靠事务把旧行 `is_current:0`（`:106-131`） | 前端拦截点受 limit 200 截断影响 → 见 H5 |
| 生效日期 | 不传 | 后端强制当天（`:80-89`） | 后端兜住 |
| 权限 | ✗ 前端无门禁 | ✓ `:70` `['super_admin','purchaser']` | 后端兜住（chef 会拿到 -403，`js:39-41` 的 toast 会显示后端文案） |

### 3.3 问题
- **M8 · `applyFilter` 原地 `sort` 污染 `allPrices`**（`js:76` `list = this.data.allPrices` 无筛选时为同一引用，`js:88` `list.sort(...)` 直接改写 data）→ 后续任何依赖 `allPrices` 原始顺序的逻辑（当前仅 `js:204` 的 `some()` 查重）都读的是被排序后的数组。当前无实际错乱，属隐患。
- **M9 · 价格无小数位约束**：`wxml:54` / `wxml:89` 均为 `type="digit"`，可输入 `3.14159`；后端 `updateProductPrice:76-79` 只校验 `>0`。B2B 结算价建议限制 2 位。
- **L6 · 前端 `updatedBy` 基本无效**：`js:133,214` 传 `updatedBy = userInfo.name`，但后端 `updateProductPrice:126` 优先 `user.user_id || user._id`，`updatedBy` 仅在二者都缺失时兜底 → 审计字段实际记的是 user_id 而非姓名。前端这行是无效代码。
- **L15 · 价格展示无 `toFixed`**（`wxml:30,31,49`）：整数价格显示 `¥4` 而非 `¥4.00`，与协议价的金额语义不一致。
- **L14 · `suppliers` 空数组时 `onAddSupplierPick` 抛错风险极低**：picker range 为空时无法触发 change，故不构成实际问题。
- `savePrice` 的两段式提交**未在 `finally` 中重置 `_submitting`**（`js:143-144,150-151,169` 逐分支手写）；`cloud.callFunction` 内部已吞异常并返回 `{code:-1}`（`cloud.js:72-75`），故不会永久卡死。低。

---

## 4. `pages/store-manage/`（js 120 行）

### 4.1 职责与数据流
- `onShow`（`js:14-17`）→ `requireLogin()` → `loadData()`。**无分页**。
- `loadData`（`js:19-29`）：`util.showLoading()` → `authService{action:'getStores', includeInactive:1}` → `hideLoading()`。**这是 7 页中唯一有 loading 遮罩的列表加载**（与 store-manage/user-manage 一致，另 5 页无）。
- 表单仅「门店名称」一个字段（`js:11`）；编号创建后只读（`wxml:49-53`，与后端 `updateStore` 不写 `store_code` 一致，`authService:604-606`）。
- 停用前拦截（`js:91-119`）：确认框明示「停用后下单不可再选择，历史单据保留」。

### 4.2 前后端校验对照
| 项 | 前端 | 后端 | 结论 |
|---|---|---|---|
| 名称非空 | ✓ `js:57-58` | ✓ `authService:512,586` | 一致 |
| 名称长度 ≤30 | ✓ `wxml:45` `maxlength="30"` | ✓ `:513,587` | 一致（双端一致，少见的好样例） |
| 名称重复 | ✗ 前端不查 | ✓ `:516-522` 新增 / `:596-602` 编辑（排除自身） | 后端兜住 |
| 重复停用/启用 | ✗ 前端不查 | ✓ `:625-627` 返回「已是停用/正常状态」 | 后端兜住 |
| 停用有在途单 | ✗ 前端不查 | ✓ `:630-638` 拒绝并提示单数 | 后端兜住 |
| 权限 | **✗ 前端无任何角色门禁** | ✓ `requireSuperAdmin`（`authService:334-338`） | 后端兜住但**读接口不兜** → 见 H3 |

### 4.3 问题
- **H3 · 非超管可完整浏览门店管理界面**：`getStores`（`authService:314-332`）**只校验登录，不校验超管**；`includeInactive` 为真时 `query.status` 不被设置（`:319-321`），purchaser 会拿到全部门店（含停用），chef/store_manager 拿到自己那 1 家（`:322-325`）。UI 上完整渲染「编辑 / 停用」按钮，点下去才由 `createStore:507` / `updateStore:581` / `setStoreStatus:613` 的 `requireSuperAdmin` 拒绝，而该拒绝是**嵌套结构**，文案被吞（见 H3 详述）。
- 前端文案与实际能力不符：`index.js:121` 注释「后端各 store 操作同样校验超管身份」成立，但 `getStores` 读操作并不校验，「可见」与「可操作」脱节。

---

## 5. `pages/store-switch/`（js 44 行）— 全项目最关键的隐性缺陷

### 5.1 职责与数据流
- 仅 `onLoad`（`js:9-30`），**不是 `onShow`** → 每次都要重新进页面才刷新门店列表。
- supplier 角色 `reLaunch` 到供货商门户（`js:13-17`）。
- `getStores`（`js:19-21`）**不传 `includeInactive`** → 后端 `authService:321` 强制 `query.status = 1`，停用门店不出现在切换列表里（与 store-manage 的 `includeInactive:1` 口径不同，属有意为之：停用的门店不应可选）。

### 5.2 切换的实际作用范围（核心结论）
`selectStore`（`js:32-43`）只做 3 件事：
1. `app.globalData.currentStore = store`（`:37`）
2. `wx.setStorageSync('currentStore', store)`（`:38`）
3. 局部 `setData` 高亮 + toast + 800ms 后 `navigateBack`（`:39-41`）

**不调用任何云函数，不写 `app_user.default_store_id`。** 即门店切换是**纯前端本地状态**。冷启动会恢复（`app.js:40-42` 从 storage 读回），退出登录会清除（`index.js:144-147`）。

### 5.3 但后端对所有「门店角色」把门店钉死在 `default_store_id`
逐接口实测（均为只信代码结论）：

| 接口 | 门店角色（chef / store_manager）的行为 | 行号 |
|---|---|---|
| `createPurchaseOrder` | **强制** `storeId = user.default_store_id`；传入不同门店直接 `-403`「无权为其他门店创建采购订单」 | `createPurchaseOrder/index.js:162-163` |
| `getPurchaseOrders` | 强制 `query.store_id = user.default_store_id`，**忽略** event.storeId | `getPurchaseOrders/index.js:58-59` |
| `getReports` | 强制 `query.scope_id = user.default_store_id`，**忽略** event.storeId | `getReports/index.js:59-60` |
| `dataService.getOrderStats` | 强制 `baseQuery.store_id = user.default_store_id`，**忽略** event.storeId | `dataService/index.js:838` |
| `getPurchaseOrders`（chef 额外） | 再叠 `created_by = user.user_id`，忽略前端 `createdBy` | `getPurchaseOrders/index.js:55` |

**GLOBAL 角色（super_admin / purchaser）才真正吃 storeId**：`getPurchaseOrders/index.js:62`、`getReports/index.js:63`（走 reportScope）、`dataService/index.js:840`。

### 5.4 由此推出的功能矛盾（H1）
对 chef / store_manager，门店切换后：
- **下单页**：`purchase-create.js:316-324` 用 `currentStore` 提交 → 切到另一门店后下单会拿到 `-403 无权为其他门店创建采购订单`，前端下单前无任何预告。
- **首页 / 采购列表 / 报表 / 统计**：数据**全部仍是默认门店**的（后端忽略 storeId），UI 顶栏门店名却是新门店 → **显示与数据不一致**。
- 换句话说：门店切换对门店角色**唯一有实际数据效果的地方是「下单失败」**，其余位置纯属显示切换。

### 5.5 感知边界（问题 5 的定论）
- **能感知**：所有在 `onShow` 读 `globalData.currentStore` 的页面，切完门店 `navigateBack` 后都会重算（`purchase-list.js:58`、`report-list.js:70,145`、`receive-list.js:14`、`receive-verify.js:168-171`、`index.js:35`、`approval-list.js:21`、`report-history.js:57`）。
- **不能感知 / 无实质效果**：对门店角色，即使感知到了新 currentStore，后端仍返回默认门店数据 → 感知与否都不改变数据。
- **`store-switch` 自身无空态**：`stores` 为空时页面只剩标题（`wxml:7`），无任何提示；`selectStore` 找不到 store 时**静默无反应**（`js:34-42` 无 else 分支）。

---

## 6. `pages/supplier-manage/`（js 121 行）

### 6.1 职责与数据流
- 仅 `onShow`（`js:15-18`）→ `requireLogin()` → `loadData()`。无分页、无 loading 态。
- `loadData`（`js:20-35`）：`getSuppliers{includeInactive:true}` 单接口，前端对结果做关键字过滤（含 `supplierName` 与 `contactName`）。

### 6.2 问题
- **M1 · 搜索联系人永远搜不到**（这是本批最直接的「文案与实现不符」bug）：
  - `wxml:9` placeholder 承诺「搜索供应商/联系人」，前端 `js:30-33` 确实对 `contactName` 做了二次过滤。
  - 但 `onSearch`（`js:37-40`）**每次键入都重新调用 `loadData()` 把 keyword 下推给后端**，而 `getSuppliers` 的 keyword 只匹配 `supplier_name`（`getSuppliers/index.js:60-62` `db.RegExp({ regexp: keyword })` 仅作用于 `supplier_name`）。
  - 结果：搜「张三」→ 后端按供应商名正则过滤 → 返回空 → 前端二次过滤空数组 → 空态「暂无供应商」。**联系人搜索在架构上不可达**。
  - 附带代价：每次击键一次网络往返 + 全量重拉（对比 `product-manage.js:70-85` 的纯前端 `applyFilter`，两页写法不一致）。
- **M12 · 无前端角色门禁**（`js:15-18` 仅 `requireLogin`）→ 见 H3。写操作由 `dataService.saveSupplier:144` / `toggleSupplier:177` 的 `MANAGEMENT_ROLES` 兜住。
- **L5 · supplier 角色访问时显示假数据**：`getSuppliers/index.js:45-51` 对 supplier 角色硬编码 `product_count: 0`，而 `wxml:20` 直接展示「供应 {{item.productCount}} 个商品」→ 显示「供应 0 个商品」。当前 supplier 无入口，属潜伏缺陷。
- **L9 · 电话无格式校验**：`wxml:54` `type="number"` 只限输入形态，前端不校验长度/位数，后端 `dataService:151` 仅 `String().trim()`。
- `goProducts`（`js:117-120`）深链到 `price-manage?supplierId=`，与 `price-manage.js:26` 的 `_initialSupplierId` 消费端闭合 ✓。

---

## 7. `pages/user-manage/`（js 251 行）

### 7.1 职责与数据流
- 仅 `onShow`（`js:26-29`）→ `requireLogin()` → `loadData()`。无分页、无 loading 态（有 `util.showLoading` 遮罩）。
- `loadData`（`js:31-55`）3 并发：`authService{action:'listUsers'}`、`authService{action:'getStores'}`（**不传 includeInactive**）、`getSuppliers{}`。
- 角色选项静态写死 5 个（`js:15-21`），与 `authService:14-22` 的 ROLE_LABELS 定义一致。
- `displayStoreName`（`js:42-49`）：supplier 角色显示供货商名，其余显示门店名，找不到显示 `'未关联'` / `'全部/无'`。

### 7.2 前后端校验对照
| 项 | 前端（`js:180-193`） | 后端（`validateUserInput:133-154`） | 结论 |
|---|---|---|---|
| 账号非空 | ✓ | ✓ | 一致 |
| **账号格式** | ✗ 不校验 | ✓ `:139-141` `^[a-z0-9_.-]{3,32}$` | 后端兜住，但用户输「测试账号」才会收到错误 → 体验差（L11） |
| 姓名非空 | ✓ | ✓ | 一致 |
| 密码 ≥6 位 | ✓ `js:185-187`（用 `trim()` 后长度） | ✓ `:144-146`（未 trim） | 前端传的是 `trim()` 后值（`js:200`），实际一致 |
| 门店/供货商关联 | ✓ `js:188-193` | ✓ `:147-152` | 一致（`STORE_ROLES` 同含 chef/store_manager） |
| 账号重复 | ✗ 前端不查 | ✓ `createUser:357-361` / `updateUser:404-409`（排除自身） | 后端兜住 |
| 关联门店/供货商有效性 | ✗ 前端不查 | ✓ `:362-367,410-415` `findStore/findSupplier` 要求 status:1 | 后端兜住 |
| 停用 admin | ✓ 前端拦截 `js:228`（toast「默认系统超管不可停用」） | ✓ 后端亦有保护 | 双端一致 |
| 重置自己密码 | ✗ 前端不拦 | ✓ `resetPassword:446` 拒绝并提示去安全设置 | 后端兜住 |
| **超管自编辑** | ✗ 前端不拦 | **✗ 后端也不拦** | 见 M4 |
| 创建同级超管 | ✗ 无二级确认 | ✗ 无二级确认 | 见 M7 |

### 7.3 问题
- **H3 / M5 · `loadData` 忽略 `suppliersResult.code`**（`js:39-53`）：
  - 条件只判 `usersResult.code === 0 && storesResult.code === 0`，`suppliersResult.code` 从未被检查。
  - `js:41` 用 `suppliersResult.code === 0 ? data : []` 静默降级 → supplier 角色账号的关联名全部显示 `'未关联'`（`js:46`），用户以为数据丢了。
  - 更糟的是错误文案：非超管进入时 `listUsers` 返回**嵌套** `{ error: { code:-403, msg:'仅超级管理员可以管理账号' } }`（`authService:336-337`），`usersResult.code` 为 `undefined` → 走 else 分支 `js:52` `usersResult.msg`（undefined）→ `storesResult.msg`（undefined，getStores 成功）→ **最终显示「账号数据加载失败」**，而非真实原因。用户会以为系统故障。
- **M4 · 超管可编辑当前登录账号，并清掉自己的会话**：`updateUser`（`authService:393-440`）**没有** `resetPassword:446` 那样的 `event.id === auth.user._id` 自操作拦截。前端 `user-manage.js:209-210` 允许对任意 item（含自己）提交编辑。一旦填了新密码，后端 `:433-435` 会清空 `sessions` / `session_token_hash` / `session_expires_at` → 超管自己被踢下线，界面却停在账号管理页。
- **M6 · `getStores` 不传 `includeInactive`（`js:36`）→ 停用门店从 picker 消失且展示误导**：
  - 停用门店不进 `stores` 数组 → picker 选不到（与后端 `findStore` 要求 status:1 一致，属合理约束）。
  - 但 `js:43` `stores.find(s => s.storeId === u.defaultStoreId)` 找不到已停用的门店 → `displayStoreName` 落到 `'全部/无'`（`js:47`）。**一个关联了停用门店的 chef 会在列表中显示为「关联门店：全部/无」**，与真实状态相反。
  - 同理 `js:66,71,84-85` 编辑这类账号时 picker 预选中项 0 且显示「请选择所属门店」。
- **M7 · 角色 picker 允许选「超级管理员」，创建同级超管无二次确认**（`js:15-21` 的 roles 含 `super_admin`；`js:180-213` 无角色提升确认；后端 `createUser:351-391` 也不拦）。
- **L3 · `showAddForm` 未初始化 `storeIndex` / `supplierIndex`**（`js:60` 对比 `showEditForm:82,85,88`）→ `wxml:93` `value="{{form.storeIndex || 0}}"` 恒为 0，picker 打开时默认高亮第 1 个门店，但 `form.defaultStoreId` 仍为空。展示与状态不一致（显示的是「请选择所属门店」placeholder，属轻微误导）。
- **L2 · `const app = getApp()` 未使用**（`js:33,130,207`）。

---

## 8. 角色清单定义与漂移（问题 3 定论）

**真正的常量定义只有 3 处，且值完全相同（`['super_admin','purchaser']`）：**
1. `cloudfunctions/dataService/index.js:8` — `GLOBAL_ROLES`
2. `cloudfunctions/dataService/index.js:9` — `MANAGEMENT_ROLES`（**与上一行同值，重复定义**）
3. `cloudfunctions/importProducts/index.js:8` — `MANAGEMENT_ROLES`（跨函数复制，无共享模块）

**内联字面量 `['super_admin','purchaser']` 副本：后端 11 处**
`getPurchaseOrders/index.js:50`、`createPurchaseOrder/index.js:160`、`createReceipt/index.js:174`、`getPurchaseOrderDetail/index.js:58`、`getReportDetail/index.js:72`、`getReceipts/index.js:56`、`getReportFileUrl/index.js:49`、`getProductPrices/index.js:51`、`updateProductPrice/index.js:70`、`getProducts/index.js:44`、`getSuppliers/index.js:53`。

**已发生的漂移实例（1 处）：** `generateSummaryReport/index.js:160` 用 `['store_manager','purchaser','super_admin']`，**多了 store_manager**。这正是 `report-list.js:126-131` 硬编码 `['super_admin','purchaser']` 与后端口径冲突的根因（full-scan-06 已记录，此处补上漂移成因）。

**前端硬编码副本（7 处）**：`index.js:86`、`index.js:113`、`approval-list.js:14`、`approval-detail.js:17`、`purchase-list.js:85`、`purchase-detail.js:74`、`report-list.js:128`。

**本批 7 页的角色硬编码逐条核对结论：**
| 位置 | 前端门槛 | 对应后端门槛 | 是否一致 |
|---|---|---|---|
| `index.wxml:30` 采购审核入口 | `isManager`(super_admin/purchaser, `js:113`) | `dataService.auditOrder` MANAGEMENT_ROLES | ✓ 一致 |
| `index.wxml:34` 商品管理入口 | `isManager` | `dataService.saveProduct:92` MANAGEMENT_ROLES | ✓ 一致 |
| `index.wxml:38` 供应商入口 | `isManager` | `dataService.saveSupplier:144` MANAGEMENT_ROLES | ✓ 一致 |
| `index.wxml:42` 价格管理入口 | `isManager` | `updateProductPrice:70` / `getProductPrices:51` | ✓ 一致 |
| `index.wxml:46` 账号管理入口 | `isSuperAdmin`(仅 super_admin, `js:112`) | `authService.requireSuperAdmin:337` | ✓ 一致 |
| `index.wxml:50` 门店管理入口 | `isSuperAdmin` | `createStore:507` / `updateStore:581` / `setStoreStatus:613` | ✓ 一致 |
| `index.wxml:59` 待核销卡片 | `isManager`（`js:86` 条件 push） | `getOrderStats:852-854` GLOBAL_ROLES | ✓ 一致 |

**即：入口可见性口径全部正确，但入口之后的页面自身零守卫** —— 直接输 URL / 从其他页面深链即可进入（H3）。对比 `approval-list.js:14` / `approval-detail.js:17` 在页面内也做了 `!['super_admin','purchaser'].includes(me)` 守卫 + `navigateBack`，本批 5 个管理页**一个都没有**。

**孤儿页疑点定论（问题 1）：4 个页面都不是孤儿页，全部有入口，且入口角色门禁正确：**
- `pages/product-manage` ← `index.wxml:34`（`goAction`，`isManager` 可见）
- `pages/supplier-manage` ← `index.wxml:38`（`goAction`，`isManager` 可见）
- `pages/user-manage` ← `index.wxml:46`（`goAction`，`isSuperAdmin` 可见）
- `pages/approval-list` ← `index.wxml:30`（`goAction`，`isManager` 可见）
- 附带：`pages/price-manage` 有 2 个入口（`index.wxml:42` + `supplier-manage.js:119` 深链）；`pages/store-manage` ← `index.wxml:50`（`openStoreManage`）；`pages/store-switch` ← `index.js:119`（`goStore`，所有非 supplier 角色）
- 主控 grep 抓不到的原因是：入口写在 `data-url` 属性里（`index.wxml:30-46`），路径是模板数据属性而非 `wx.navigateTo` 字面量。

---

## 9. 问题清单

### 高

**H1 · 门店切换对门店角色实质失效，与后端门店收敛口径冲突**
- 位置：`store-switch.js:37-38`（只写本地）× `createPurchaseOrder/index.js:162-163`、`getPurchaseOrders/index.js:58-59`、`getReports/index.js:59-60`、`dataService/index.js:838`
- 触发：chef / store_manager 切换门店后下单，或查看首页/列表/报表
- 影响：下单 `-403`「无权为其他门店创建采购订单」（无预告）；其余位置 UI 门店名已变但数据仍是默认门店 → 显示与数据不一致
- 建议：产品先定「门店角色是否允许跨门店」；若不允许，store-switch 对门店角色应隐藏入口或明确标注「仅管理员可跨门店」；若允许，后端 4 处需改为接受 storeId 并做门店归属校验

**H2 · 首页会话过期不跳登录，且失败时展示旧数据**
- 位置：`index.js:54`（`dataService getMessages`）、`index.js:55`（`dataService getOrderStats`）、判定式 `index.js:62`
- 触发：会话过期后切回首页 tab
- 影响：`dataService` 返回嵌套 `{ error:{code:-401} }`（`dataService/index.js:47-49`），`result.code` 为 undefined → `js:62` 判定失败 → 只弹「首页数据加载失败，请稍后重试」，**不触发 `cloud.js:68` 的跳登录**；同时 `setData` 未执行，页面停留上一次的统计数字（误导）
- 建议：同 controller-horizontal-scan F1，前端拍平嵌套结构或后端改扁平返回；首页补 error 态替换旧数据

**H3 · 5 个管理页零前端角色守卫 + authService 嵌套错误结构吞掉真实文案**
- 位置：`product-manage.js:23-26`、`price-manage.js:24-29`、`store-manage.js:14-17`、`supplier-manage.js:15-18`、`user-manage.js:26-29`（全部只有 `requireLogin`）；`authService/index.js:336-337`（嵌套结构）
- 触发：chef / store_manager / purchaser 直接进 `/pages/store-manage/store-manage` 或 `/pages/user-manage/user-manage`
- 影响：① store-manage 的读接口 `getStores` 不校验超管（`authService:314-332`），非超管可完整浏览门店列表并看到编辑/停用按钮；② 操作被拒时文案被吞 —— user-manage 显示「账号数据加载失败」（`user-manage.js:52`）、store-manage 显示「操作失败」（`store-manage.js:114`），而非「仅超级管理员可以管理账号」；③ 对照 `approval-list.js:14` 有页面内守卫，本批 5 页全缺，标准不一致
- 建议：5 页 `onShow` 加与 approval-list 一致的角色守卫 + `navigateBack`；`getStores` 加超管校验或拆出「选门店用」的独立 action

**H4 · `saveProduct` 无重名检测（双端都缺）**
- 位置：`cloudfunctions/dataService/index.js:91-130`（全函数无 duplicate 查询）；`product-manage.js:199-204`（前端亦未校验）
- 触发：超管新增两个同名商品
- 影响：重名商品进入商品库，Excel 导入的「按名称匹配分类/供应商」逻辑与商品管理列表都会出现歧义
- 对照：`saveSupplier:155-161`、`createStore:516-522,596-602`、`createUser:357-361`、`updateUser:404-409` **全部有查重**，唯独商品没有
- 建议：后端加 `product_name` 查重（编辑时排除自身 `_id`），前端提交前本地比对 `this.data.products`

**H5 · 5 个列表接口硬编码 limit，管理页无分页、无总数、无截断提示**
- 位置：`getProducts/index.js:53` `limit(200)`、`getSuppliers/index.js:67` `limit(100)`、`getProductPrices/index.js:60` `limit(200)`、`authService/listUsers:346` `limit(100)`、`getStores:329` `limit(100)`；前端 `product-manage.js:28-63` / `price-manage.js:31-72` / `supplier-manage.js:20-35` / `store-manage.js:19-29` / `user-manage.js:31-55` 均无分页、无 `total`
- 触发：商品 >200 / 供应商 >100 / 价格 >200 / 账号 >100 / 门店 >100
- 影响：超出部分**静默丢失**，页面 `共 N 个` 计数（各 wxml 的 `filteredProducts.length` / `priceList.length` / `suppliers.length` / `stores.length` / `users.length`）显示的是被截断后的数，用户无感知
- 连带：`price-manage.js:204` 的「该供应商已有此商品价格」去重判定基于被截断的 `allPrices`，价格表 >200 条时会误判为「不存在」，引导用户重复定价（后端事务不会崩，但会多出价格行）
- 建议：接口返回 `total`，前端分页或至少展示「已达上限，请缩小筛选」

### 中

**M1 · 供应商联系人搜索永远搜不到**
- 位置：`supplier-manage.wxml:9`（placeholder 承诺「搜索供应商/联系人」）、`supplier-manage.js:37-40`（每次键入下推 keyword 重拉）、`getSuppliers/index.js:60-62`（keyword 只匹配 `supplier_name`）
- 触发：搜联系人姓名
- 影响：后端先按供应商名过滤返回空，前端二次过滤（`js:30-33` 含 `contactName`）在空数组上无结果 → 永远「暂无供应商」；且每击键一次网络往返（对比 `product-manage.js:70-85` 纯前端过滤，两页写法不一致）
- 建议：keyword 只走前端过滤（删除 `onSearch → loadData` 的下推），或后端 `supplier_name/contact_name` 用 `_.or` 联合正则

**M2 · 首页无 loading / error / 空态三态，失败时沿用旧数据**
- 位置：`index.js:62-65`（失败即 `return`）、`js:108-116`（唯一 setData）
- 触发：4 个并发中任一失败
- 影响：页面显示上一次渲染的统计数字与列表，用户以为数据是新的；对照 `purchase-list.js:73-75` 有 `loadFailed` 置位
- 建议：加 `loadFailed` / `loading` 标志，失败时用空态替换旧数据

**M3 · 首页每次 `onShow` 并发 4 个云函数，无缓存无节流**
- 位置：`index.js:41-56`；服务端放大：`getPurchaseOrders/index.js:84-94`（9 个 count）、`dataService/index.js:847-855`（4 个 count）
- 触发：每次切回首页 tab（tabBar 页，切换极频繁）
- 影响：单次进入 ≈ 4 次云函数调用 + 13 个 count 查询，无节流无缓存
- 建议：`onShow` 加 5~10s 防抖，或 `onLoad` 拉取 + `onShow` 仅刷新易变项

**M4 · 超管可编辑当前登录账号，并清掉自己的会话**
- 位置：`user-manage.js:209-210`（允许编辑任意 item）、`authService/index.js:393-440`（无 `event.id === auth.user._id` 拦截，对照 `resetPassword:446` 有）
- 触发：超管编辑自己并填写新密码
- 影响：`authService:433-435` 清空 `sessions` / token → 超管自己被踢下线，而界面停在账号管理页，无提示
- 建议：后端 `updateUser` 加自编辑拦截（至少禁止改密码），或前端把「重置自己密码」引导到 account 页

**M5 · `user-manage.loadData` 忽略 `suppliersResult.code`**
- 位置：`user-manage.js:39`（条件只判 users/stores）、`js:41`（`suppliersResult.code === 0 ? data : []` 静默降级）
- 触发：`getSuppliers` 失败（限流、-401、-403 均可能）
- 影响：supplier 角色账号的关联名全部显示「未关联」（`js:46`），页面 toast 报「账号数据加载失败」而实际用户/门店数据是好的
- 建议：`suppliersResult.code !== 0` 时明确 toast 其 msg，或降级为「（加载失败）」而非「未关联」

**M6 · user-manage 的 `getStores` 不传 `includeInactive`，停用门店相关显示反向误导**
- 位置：`user-manage.js:36`、`js:43-48`、`js:66,71,84-85`
- 触发：某 chef/store_manager 账号关联的门店已被停用
- 影响：`stores.find` 找不到 → `displayStoreName` 落到 `'全部/无'`，列表显示「关联门店：全部/无」，与真实状态（关联了停用门店）相反；编辑时 picker 预选中项 0 且显示「请选择所属门店」
- 建议：`getStores` 传 `includeInactive:1`（仅超管可见此页，无越权风险），`displayStoreName` 对停用门店显示「门店名（已停用）」

**M7 · 创建同级超管无二级确认**
- 位置：`user-manage.js:15-21`（roles 含 `super_admin`）、`js:180-213`（无角色提升判定）；后端 `authService/index.js:351-391` 亦不拦
- 触发：超管在账号管理里选角色「超级管理员」并保存
- 影响：一次误触即产生新的超管，且创建者与被创建者权限完全对等，无审计确认
- 建议：`form.role === 'super_admin' && !editItem` 时弹二次确认（含输入账号名确认）

**M8 · `applyFilter` 原地 `sort` 污染 `allPrices`**
- 位置：`price-manage.js:76`（`list = this.data.allPrices`，无筛选时为同一引用）、`js:88`（`list.sort(...)`）
- 触发：未选中任何供应商筛选时打开页面
- 影响：`this.data.allPrices` 被永久改写为按供应商名排序；当前唯一消费者 `js:204` 的 `some()` 查重不受影响，属潜伏隐患
- 建议：`list = [...this.data.allPrices]` 或 `const sorted = list.slice().sort(...)`

**M9 · 价格无小数位约束（双端都缺）**
- 位置：`price-manage.wxml:54`、`wxml:89`（`type="digit"` 允许任意位小数）、`updateProductPrice/index.js:76-79`（仅校验 `> 0`）
- 触发：输入 `3.14159`
- 影响：协议价写入超长小数，结算金额与报表金额出现舍入歧义
- 建议：前后端统一 `Math.round(price*100)/100` 或校验 `/\d+\.\d{0,2}/`

**M10 · 4 个管理页无 loading 态，加载中呈空白**
- 位置：`product-manage.js:28-63`、`price-manage.js:31-72`、`supplier-manage.js:20-35`、`store-switch.js:9-30` 均未 `util.showLoading`（对照 `store-manage.js:20`、`user-manage.js:32` 有）
- 触发：网络慢时进入页面
- 影响：product-manage 空态「暂无商品」（`wxml:50`）会因 `filteredProducts` 初始为 `[]` 而**闪现**；列表页看起来像空库
- 建议：加 `loading` 标志位，`loading && list.length===0` 时不渲染空态

**M11 · product-manage「厂家/品牌」标注必填但前后端都不校验**
- 位置：`product-manage.wxml:109`（label 带 `*`）、`product-manage.js:199-204`（只校验 name/categoryId/unit）、`dataService/index.js:115`（空串兜底 `'默认'`）
- 触发：编辑商品时清空厂家字段并保存
- 影响：标注必填的字段实际可存空（被后端兜成「默认」），与 wxml 承诺不符；`importProducts` 的模板说明（`product-manage.js:162`）也只说「名称/分类/单位必填」，未含厂家
- 建议：去掉 `*` 或补前端校验（后端已有 `'默认'` 兜底，属设计选择，需产品拍板）

### 低

- **L1 · `index.js:126 stopBubble()` 死代码**：`index.wxml` 无任何 `catchtap` 引用（index 页无自绘弹窗，wxss:119-176 的门店弹窗样式同样是死样式）。
- **L2 · `const app = getApp()` 未使用**：`product-manage.js:208,238`、`supplier-manage.js:21,75,104`、`price-manage.js:32`、`user-manage.js:33,130,207`。注意 `price-manage.js:132,209` 的 `getApp()` **是有用的**（`:133` / `:214` 取 `userInfo.name` 作为 `updatedBy`），不在死代码之列。
- **L3 · `user-manage.js:60 showAddForm` 未初始化 `storeIndex`/`supplierIndex`**，`wxml:93,102` 的 `value="{{... || 0}}"` 恒为 0，picker 打开默认高亮第 1 项而 `defaultStoreId` 仍为空。
- **L4 · `index.js:22-27` 双重登录检查冗余**：`requireLogin()` 已 `reLaunch` 登录页，紧接着 `js:24-26` 又 `wx.redirectTo` 同一目标。
- **L5 · `getSuppliers/index.js:45-51` 对 supplier 角色硬编码 `product_count: 0`**，`supplier-manage.wxml:20` 直接展示 → 若 supplier 角色进入该页会显示「供应 0 个商品」。当前无入口，属潜伏缺陷。
- **L6 · `price-manage.js:133,214` 的 `updatedBy` 基本无效**：`updateProductPrice/index.js:126` 优先 `user.user_id || user._id`，审计字段实际记 user_id 而非姓名。
- **L7 · `product-manage.wxml:64` `wx:key="index"` 用于字符串数组** `importResult.lines`，数组变化时节点复用错位。
- **L8 · `product-manage.js:209-215` 提交冗余字段** `categoryL1`/`categoryL1Name`/`categoryName`/`supplierName`，后端 `dataService:91-130` 全部忽略。
- **L9 · `supplier-manage.wxml:54` 电话仅 `type="number"`**，前后端均不校验位数。
- **L10 · `price-manage.js:29 onShow` 未复查登录态**（`onLoad:25` 有），与其他 6 页不一致。
- **L11 · `user-manage` 前端不校验账号格式**（`js:182` 仅非空），后端 `authService:139-141` 的 `^[a-z0-9_.-]{3,32}$` 兜住，但用户需输错才能看到规则。
- **L12 · `index.js:45 createdBy` 兜底链用 `user.name`**（真实姓名），对 chef 而言是死参数（后端 `getPurchaseOrders:55` 强制用 `user_id`），但若后端哪天采信前端 createdBy 会变成错误匹配。
- **L13 · `store-switch.js:34-42` 找不到 store 时静默无反应**（无 else）；`stores` 为空时无空态（`wxml:7`）。
- **L14 · `authService:419-420` 只护 admin 的 `username`，不护 `name`**：超管可把 admin 账号的显示名改成任意值。
- **L15 · `price-manage.wxml:30,31,49` 价格无 `toFixed(2)`**，整数价显示 `¥4`。
- **L16 · 管理页弹窗保存按钮无 loading/disabled 态**（`product-manage.wxml:124`、`price-manage.wxml:63,99`、`supplier-manage.wxml:63`、`store-manage.wxml:58`、`user-manage.wxml:112`），依赖 `this._submitting` 静默拦截连点，用户看不到反馈。

---

## 10. 跨批次待核实项

| # | 待核实内容 | 去哪里找 |
|---|---|---|
| 1 | `getPurchaseOrders` 在 `:43` **解构了 `role` 但过滤逻辑 `:50-66` 全程只用会话 `user.role`**，`role` 是死参数（`index.js:43`、`purchase-list.js:62` 都在传）；`purchase-list` 还带 `user.role \|\| 'purchaser'` 兜底 —— 兜底对结果无影响，但说明前端误以为后端读该参数 | `cloudfunctions/getPurchaseOrders/index.js:43`（解构）、`:50-66`（未引用）；本批已实测确认，供批 2 修正表述 |
| 2 | `getPurchaseOrders` 对 chef **忽略前端 `createdBy`**，强制用会话 `user_id`（`:55`）；前端 `user.name` 兜底（`index.js:45`、`purchase-list.js:64`）是错误匹配隐患 | 同上 |
| 3 | `getReceipts:44` 的 storeId 死参数（主控线索，需批 1/6 确认全貌） | `cloudfunctions/getReceipts/index.js` |
| 4 | 除本批列出的 5 个接口外，其余查询接口是否也有「传了过滤参数但后端没收敛」的情况（如 `getReports` 的 `reportType` / `relatedDate` 空串是否等价于不传、`getOrderStats` 的 storeId 对 GLOBAL 角色是否生效 —— 后者已确认 `dataService:840` 生效） | `getReports/index.js:43-48,68+`、各云函数 event 解构行 |
| 5 | `purchase-create` 是否只 `onLoad` 读一次 `currentStore`（`purchase-create.js:34`、提交时 `:316-324` 重读）—— 若页面内有门店 picker，切换后的刷新边界需批 2 确认 | `pages/purchase-create/purchase-create.js` |
| 6 | 产品拍板：门店角色（chef / store_manager）是否应允许为其他门店操作？H1 的修复方向完全取决于此 | 产品确认 |
| 7 | `dataService` / `authService` 嵌套 `{ error: {...} }` 与 `utils/cloud.js:68` 只查顶层 code 的冲突（controller-horizontal-scan F1 已结案，本批新增影响面：`index.js:54-55` 的 getMessages/getOrderStats、`user-manage.js` 的 listUsers/createUser/updateUser/setUserStatus/resetPassword、`store-manage.js` 的 createStore/updateStore/setStoreStatus） | `cloudfunctions/dataService/index.js:47-56`、`cloudfunctions/authService/index.js:336-337` |
| 8 | `user-manage.js:36` 与 `store-switch.js:19` 的 `getStores` 不传 `includeInactive` 是否为有意约束（前者影响 M6，后者影响「停用门店不可选」的期望） | 产品/后端意图确认 |
| 9 | `importProducts` 的模板说明（`product-manage.js:162`）与 `saveProduct` 的校验口径是否一致（厂家/品牌在导入侧是否必填） | `cloudfunctions/importProducts/index.js` |
| 10 | 「禁用 ES2020 语法」隐含约束：本批 28 文件确认 **0 处 `?.`、0 处 `??`**，符合；但 `product-manage.js:115` 的 `res.tempFiles && res.tempFiles[0]`、`store-switch.js:13` 的 `app.globalData.userInfo \|\| {}` 都是手写判空，建议保持该风格 | 全项目约定 |
