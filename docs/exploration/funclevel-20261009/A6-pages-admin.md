# A6 · 管理端页面（7 页）· 函数级清单

## 0. 范围与方法

**逐行读取确认：28/28 个文件全部读取完毕**，共 2567 行（明细见第 8 节）。

辅助读取（用于核对调用契约，非本批结论来源）：`utils/cloud.js`(283)、`utils/util.js`(128)、`utils/auth-guard.js`(17)、`utils/meta.js`(68)、`app.json`(75)。
为核实「后端门禁 / 返回字段」的负结论，另只读交叉核对了 `cloudfunctions/authService/index.js`、`cloudfunctions/dataService/index.js`、`cloudfunctions/updateProductPrice/index.js` 的相关片段（行号在正文中给出）。

**未读范围**：其余 5 个云函数（`getProducts`、`getSuppliers`、`getPurchaseOrders`、`getProductPrices`、`importProducts`、`getReports`）的完整实现未读；`app.js`、`app.wxss` 全文未读（仅对 `app.wxss` 做了类名存在性检索）；本批 7 页之外的 20 个页面未读。涉及这些位置的结论均标为「未验证」。

**方法**：每个 JS 方法逐个提取触发绑定、入参、云调用契约、成功/失败分支、副作用；再对 7 页做 wxml↔js 双向对账。所有负结论（无绑定/无调用/无校验）均给出检索证据。

---

## 1. 页面配置与生命周期

### 1.1 首页看板 `pages/index/`（app.json:5 注册，**tabBar 第 1 项** app.json:43-48）

- `.json`：仅 `navigationBarTitleText: "首页"`（index.json:2）。**未开 `enablePullDownRefresh`**，JS 中也无 `onPullDownRefresh` / `onReachBottom` —— 配置与实现一致，首页无下拉刷新、无分页。
- `Page()` 字段：`data` 9 键（index.js:9-19）+ 11 个方法，**无 `onLoad`**。
- `onShow()`（index.js:21-117）是本页唯一的数据入口，**每次显示都重拉 4 个云调用**（Promise.all，index.js:41-56）：`getPurchaseOrders`、`getReports`、`dataService.getMessages`、`dataService.getOrderStats`。这是全系统唯一一处「tab 首页 onShow 无条件重拉」，与第 5 节的刷新关系直接相关。
- 数据来源：`app.globalData.userInfo` / `currentStore`（index.js:29,35）+ 上述 4 个云函数；**无 `wx.getStorage` 读取**（只在 `switchAccount` 里删，index.js:146-150）。
- 三重守卫：`authGuard.requireLogin()`（:22）→ `app.globalData.isLoggedIn` 复查（:24-27）→ `user.role === 'supplier'` 转供货商门户（:31-34）。

### 1.2 账号管理 `pages/user-manage/`（app.json:22 注册，**非 tab**）

- `.json`：`navigationBarTitleText: "账号管理"` + `usingComponents: {}`（user-manage.json:2-3）。
- `Page()` 字段：`data` 8 键（:7-24）+ 16 个方法，**无 `onLoad`**。
- `onShow()`（:26-29）= `requireLogin()` + `this.loadData()`，**每次显示重拉 3 个云调用**（:34-38）。
- 数据来源：`authService.listUsers` / `authService.getStores` / `getSuppliers`。**注意 `getStores` 未传 `includeInactive`**（:36），后端 `getStores` 因此只返回 `status:1` 的门店（authService:319-321）。

### 1.3 商品管理 `pages/product-manage/`（app.json:18 注册，**非 tab**）

- `.json`：`navigationBarTitleText: "商品管理"` + `usingComponents: {}`。
- `Page()` 字段：`data` 11 键（:15-28）+ 20 个方法 + 模块级私有函数 `isUserCancel`（:10-12）。**无 `onLoad`**。
- `onShow()`（:30-33）= `requireLogin()` + `loadData()`，重拉 3 个云调用（:36-40）。
- 数据来源：`getProducts({includeInactive:true})`、`dataService.getCategories`、`getSuppliers({includeInactive:true})`。

### 1.4 价格管理 `pages/price-manage/`（app.json:20 注册，**非 tab**）

- `.json`：`navigationBarTitleText: "价格管理"` + `usingComponents: {}`。
- `Page()` 字段：`data` 13 键（:7-22）+ 17 个方法。**有 `onLoad(options)`**（:24-27）读 `options.supplierId`。
- `onShow()`（:29）直接 `this.loadData()`，**未调 `requireLogin()`** —— 与本页 `onLoad` 的守卫不对称（见 2.4.3）。
- 数据来源：`getSuppliers({includeInactive:true})`、`getProducts({includeInactive:true})`、`getProductPrices({onlyCurrent:true})`。

### 1.5 供应商管理 `pages/supplier-manage/`（app.json:19 注册，**非 tab**）

- `.json`：`navigationBarTitleText: "供应商管理"` + `usingComponents: {}`。
- `Page()` 字段：`data` 6 键（:7-13）+ 11 个方法，**无 `onLoad`**。
- `onShow()`（:15-18）= `requireLogin()` + `loadData()`。
- 数据来源：`getSuppliers({includeInactive:true})` 单次全量拉取，前端内存过滤。

### 1.6 门店管理 `pages/store-manage/`（app.json:23 注册，**非 tab**）

- `.json`：仅 `navigationBarTitleText: "门店管理"`（无 `usingComponents`）。
- `Page()` 字段：`data` 4 键（:7-12）+ 9 个方法，**无 `onLoad`**。
- `onShow()`（:14-17）= `requireLogin()` + `loadData()`。
- 数据来源：`authService.getStores({includeInactive:1})`（:22，**唯一显式拉全量含停用的管理页**）。

### 1.7 门店切换 `pages/store-switch/`（app.json:6 注册，**非 tab**）

- `.json`：`navigationBarTitleText: "切换门店"`。
- `Page()` 字段：`data` 2 键（:7）+ 2 个方法。**用 `onLoad` 而非 `onShow` 拉数据**（:9）—— 从 store-manage 等其他页面切回本页时数据不刷新（本页只有一个入口，实际影响低）。
- 数据来源：`app.globalData.currentStore` + `authService.getStores`（:19-21，**未传 `includeInactive`**）。
- **供货商守卫**：`user.role === 'supplier'` → `reLaunch` 到供货商门户（:13-17）。

### 1.8 7 页共性：全部无 `onUnload`、无 `onPullDownRefresh`、无 `onReachBottom`、无分页

统一模式为「`onShow` → `requireLogin()` → 全量拉取 → 前端内存过滤」；唯一例外是 `price-manage` 的 `onShow` 缺守卫（2.4.3）。

---

## 2. 前端函数清单

### 2.1 首页看板 `pages/index/index.js`（182 行，11 方法）

#### `onShow()` `(index.js:21-117)`
- **触发方式**：生命周期（tab 页每次 `switchTab` / `navigateBack` 均触发）
- **入参**：无。内部取 `app.globalData.userInfo`、`app.globalData.currentStore`
- **调用云函数**（:41-56，`Promise.all` 并行 4 个）：
  1. `getPurchaseOrders` ← `{ role: user.role, storeId, createdBy: user.role==='chef' ? (user.userId||user.id||user.name) : '', pageSize: 3 }`，期望 `data[]`
  2. `getReports` ← `{ role, storeId, reportType: '', relatedDate: '' }`，期望 `data[]`
  3. `dataService` `action:'getMessages'` ← `{}`，期望 `data[]`（含 `read` 布尔）
  4. `dataService` `action:'getOrderStats'` ← `{ storeId }`，期望 `data{submitted,receivable,received,to_verify}`
- **成功分支**（:67-116）：`cloud.normalizePurchaseOrder` / `normalizeReport` 归一化；统计卡固定 4 张（:80-85），`['super_admin','purchaser']` 追加第 5 张「待核销」（:86-88）；`setData` 9 键
- **失败分支**：网络层异常 → catch（:57-61）toast「首页数据加载失败」+ `return`；任一 `code !== 0` → toast + `return`（:62-65）。**4 个调用全失败才提示，无部分降级**
- **副作用**：仅 `wx.switchTab`/`wx.navigateTo`（在其它方法中）
- **契约风险**：① `user` 为 null 时 :45 `user.role` 抛 TypeError，被 :57 catch 兜住但提示文案与真实原因不符；② `unreadMsg` 由 `messages.filter(m => !m.read).length` 算出（:78），而 `getMessages` 后端 `.limit(100)`（dataService:673）→ 消息超 100 条时未读数**低估**；③ `createdBy` 入参对 chef 传 `user.userId`，后端 `getPurchaseOrders` 是否消费**未验证**（该云函数未读）；④ `getOrderStats` 的 `to_verify` 后端按 `verify_status:'pending'` 计数（dataService:892），**不含 `order_status` 与 `isManual` 过滤**，与本页 :76 注释「已收货待核销的手动单」口径不符 → 「待核销」卡片数字可能大于实际待核销数
- **WXML 绑定核查**：无绑定（生命周期）

#### `goStore()` `(index.js:119)`
- **触发方式**：`index.wxml:6` `bindtap="goStore"`（整块 store-info）
- **入参**：无。**调用云函数**：无（纯导航）
- **成功/失败分支**：`wx.navigateTo('/pages/store-switch/store-switch')`，无返回处理
- **契约风险**：`chef`/`store_manager` 点击后目标页只会返回 1 家自己的门店（见 2.7），「切换」无实际意义
- **WXML 绑定核查**：`index.wxml:6` ✓

#### `openStoreManage()` `(index.js:122-124)`
- **触发方式**：`index.wxml:50` `bindtap="openStoreManage"`（`wx:if="{{isSuperAdmin}}"` 包裹）
- **入参**：无。**调用云函数**：无
- **成功/失败分支**：`wx.navigateTo('/pages/store-manage/store-manage')`
- **契约风险**：入口有 `isSuperAdmin` 门禁，但目标页自身无角色门禁（见 4.0）
- **WXML 绑定核查**：`index.wxml:50` ✓

#### `stopBubble()` `(index.js:126)`
- **触发方式**：无。**调用云函数**：无
- **契约风险**：空实现占位
- **WXML 绑定核查**：**无绑定**（`index.wxml` 全文无任何 `catchtap`，grep 证据见第 6 节）

#### `goMessages()` `(index.js:129-131)`
- **触发方式**：`index.wxml:13` `bindtap="goMessages"`（铃铛）
- **入参**：无。**调用云函数**：无
- **成功/失败分支**：`wx.switchTab({ url: '/pages/message/message' })`（tabBar 页必须用 switchTab，注释已记）
- **WXML 绑定核查**：`index.wxml:13` ✓

#### `goAccount()` `(index.js:133)`
- **触发方式**：`index.wxml:17` `bindtap="goAccount"`（「密码设置」）
- **入参**：无。**调用云函数**：无
- **成功/失败分支**：`wx.navigateTo('/pages/account/account')`
- **WXML 绑定核查**：`index.wxml:17` ✓

#### `switchAccount()` `(index.js:135-152)`
- **触发方式**：`index.wxml:108` `bindtap="switchAccount"`（页底「退出登录」按钮）
- **入参**：无
- **调用云函数**：`authService` `action:'logout'` ← `{}`（**不判返回值**，:139-141；后端 logout 忽略无效 token，authService:269-285，仍返回 `{code:0}`）
- **成功/失败分支**：先 `util.showConfirm('退出当前账号？')`，取消即 return；确认后置 `app.globalData` 4 字段为清空值
- **副作用**：`wx.removeStorageSync` × 5：`userInfo`、`currentStore`、`authToken`、`sessionExpiresAt`、`account_history`（:146-150）；`wx.reLaunch('/pages/login/login')`
- **契约风险**：`await cloud.callFunction(...)` 的返回值被丢弃，即使 `-401`（会话已失效）也会继续清本地态 —— 结果仍是回到登录页，行为可接受
- **WXML 绑定核查**：`index.wxml:108` ✓

#### `goStatPage(e)` `(index.js:155-167)`
- **触发方式**：`index.wxml:59` `bindtap="goStatPage"` + `data-status="{{item.status}}"`
- **入参**：`e.currentTarget.dataset.status`（取值域由 :80-88 决定：`submitted`/`receivable`/`received`/`message`/`to_verify`）
- **调用云函数**：无
- **成功/失败分支**：`message` → `switchTab` 消息页；`abnormal` → `navigateTo` 异常列表；其余 → 写 `getApp().globalData.pendingListFilter = status` + `switchTab` 采购页
- **副作用**：写全局暂存 `pendingListFilter`（消费端 `purchase-list.js:34-36` 读并清空，已核对闭合）
- **契约风险**：`abnormal` 分支**永不触发** —— `stats` 数组不产出该值（:80-88），属死分支；`to_verify` 落到 else 分支传 `pendingListFilter='to_verify'`，消费端是否把 `to_verify` 当合法 tab **未验证**（purchase-list 未在本批范围内）
- **WXML 绑定核查**：`index.wxml:59` ✓

#### `goOrderDetail(e)` `(index.js:169-171)`
- **触发方式**：`index.wxml:71` `bindtap="goOrderDetail"` + `data-id="{{item.purchaseOrderId}}"`
- **入参**：`dataset.id`（`wx:key="purchaseOrderId"`）
- **调用云函数**：无。**副作用**：`wx.navigateTo('/pages/purchase-detail/purchase-detail?id=' + id)`，**字符串拼接无编码**（id 为后端生成的 `PO...` 形式，实际无注入面）
- **WXML 绑定核查**：`index.wxml:71` ✓

#### `goReportDetail(e)` `(index.js:173-175)`
- **触发方式**：`index.wxml:96` `bindtap="goReportDetail"` + `data-id="{{item.reportId}}"`
- **入参**：`dataset.id`
- **调用云函数**：无。**副作用**：`wx.navigateTo('/pages/report-detail/report-detail?id=' + id)`
- **契约风险**：本页只 `slice(0, 3)` 展示报表元信息（:103），**未使用 `fileUrl`/fileID**，因此报表下载绕过链在本页无暴露面
- **WXML 绑定核查**：`index.wxml:96` ✓

#### `goAction(e)` `(index.js:177-181)`
- **触发方式**：`index.wxml:30,34,38,42,46` `bindtap="goAction"` + `data-url`；`index.wxml:94` `bindtap="goAction"` + `data-taburl`
- **入参**：`dataset.url` / `dataset.taburl`
- **调用云函数**：无。**副作用**：`taburl` → `switchTab`；`url` → `navigateTo`
- **契约风险**：URL 全部来自 wxml 静态字面量，非用户输入；`isSuperAdmin` 的两个入口（user-manage、store-manage）由 wxml `wx:if` 控制
- **WXML 绑定核查**：`index.wxml:30/34/38/42/46/94` ✓

### 2.2 账号管理 `pages/user-manage/user-manage.js`（251 行，16 方法）

#### `onShow()` `(user-manage.js:26-29)`
- **触发方式**：生命周期
- **入参**：无。**调用云函数**：无（转调 `loadData`）
- **契约风险**：`this.loadData()` **未 await、无 catch** —— loadData 内抛错将成为未捕获的 Promise rejection，且 `hideLoading` 不再执行
- **WXML 绑定核查**：无绑定

#### `loadData()` `(user-manage.js:31-55)`
- **触发方式**：`onShow`、`saveUser` 成功后（:219）、`toggleUserStatus` 成功后（:246）、`saveResetPassword` 后不重拉
- **入参**：无
- **调用云函数**（:34-38 `Promise.all`）：`authService.listUsers` ← `{}`；`authService.getStores` ← `{}`；`getSuppliers` ← `{}`
- **成功分支**（:39-50）：为每个用户补算 `displayStoreName`（supplier 取供应商名，其余取门店名，缺失分别显示 `u.defaultSupplierId || '未关联'` / `'全部/无'`），`setData({users, stores, suppliers})`
- **失败分支**（:51-53）：`toast(usersResult.msg || storesResult.msg || '账号数据加载失败')` —— **suppliers 失败被静默吞掉**（:41 用 `suppliersResult.code === 0 ? ... : []` 降级为空数组）
- **副作用**：`util.showLoading()`（:32）/`util.hideLoading()`（:54）
- **契约风险**：**`:42 usersResult.data.map(...)` 无 null 保护**，而 :39 只判了 `code`。若后端返回 `code:0, data:null` 会抛 TypeError，`:54 hideLoading()` 永不执行 → **loading 遮罩永久卡死**（本页唯一一处 `showLoading` 无 `finally`）
- **WXML 绑定核查**：无绑定

#### `showAddForm()` `(user-manage.js:57-62)`
- **触发方式**：`user-manage.wxml:38` `bindtap="showAddForm"`（FAB「＋」）
- **入参**：无。**调用云函数**：无
- **成功分支**：`setData({ showAdd:true, editItem:null, form:{...全空, role:'chef', roleLabel:'门店下单人员'} })`
- **契约风险**：**未设置 `roleIndex`/`storeIndex`/`supplierIndex`**，wxml:84/93/102 的 `value="{{form.roleIndex || 0}}"` 回落到 0 → 与 `form.role='chef'` 恰好一致，但门店/供应商下拉的显示项（index 0）与 `form.defaultStoreId=''` **不一致**（下拉看似已选第一项，实为空）
- **WXML 绑定核查**：`user-manage.wxml:38` ✓

#### `showEditForm(e)` `(user-manage.js:64-91)`
- **触发方式**：`user-manage.wxml:24` `bindtap="showEditForm"` + `data-item="{{item}}"`
- **入参**：`dataset.item`（整个用户对象，来自 loadData 的 `users` 项）
- **调用云函数**：无
- **成功分支**：计算 `rIdx`/`sIdx`/`supIdx` 三个 picker 预置下标；`setData({ showAdd:true, editItem:item, form:{...} })`
- **契约风险**：① `sIdx` 用 `this.data.stores`（**仅启用门店**）匹配，若用户挂在已停用门店上则 `sIdx=-1 → storeIndex=0`，而 `form.defaultStoreId` 仍是该停用门店 id → **下拉显示与实值背离**，用户不碰下拉直接保存就会带着停用门店通过 :188 校验；② `form.password` 固定置 `''`（:79），符合「留空不改密码」语义
- **WXML 绑定核查**：`user-manage.wxml:24` ✓

#### `closeForm()` `(user-manage.js:93-95)`
- **触发方式**：`user-manage.wxml:63` `bindtap="closeForm"`（遮罩，点击蒙层关闭）+ `:111`（「取消」按钮）
- **入参**：无。**调用云函数**：无。**副作用**：`setData({ showAdd:false })`，**不清 `editItem`**
- **契约风险**：`editItem` 残留。因 `showAdd` 为 false 弹窗不渲染，:112 等后续保存前必经过 `showAddForm`/`showEditForm` 重置，实际无危害，但属易踩坑写法
- **WXML 绑定核查**：`user-manage.wxml:63,111` ✓

#### `showResetForm(e)` `(user-manage.js:97-104)`
- **触发方式**：`user-manage.wxml:25` `bindtap="showResetForm"` + `data-item="{{item}}"`
- **入参**：`dataset.item`
- **调用云函数**：无。**成功分支**：`setData({ showReset:true, resetItem:item, resetForm:{newPassword:'',confirmPassword:''} })`
- **WXML 绑定核查**：`user-manage.wxml:25` ✓

#### `closeResetForm()` `(user-manage.js:106-108)`
- **触发方式**：`user-manage.wxml:41` `bindtap="closeResetForm"`（遮罩）+ `:56`（「取消」）
- **入参**：无。**调用云函数**：无。**副作用**：`setData({ showReset:false, resetItem:null })`
- **WXML 绑定核查**：`user-manage.wxml:41,56` ✓

#### `onResetInput(e)` `(user-manage.js:110-113)`
- **触发方式**：`user-manage.wxml:48,52` `bindinput="onResetInput"` + `data-field`
- **入参**：`dataset.field`（`newPassword`/`confirmPassword`）、`e.detail.value`
- **调用云函数**：无。**副作用**：`setData({ ['resetForm.'+field]: value })`
- **契约风险**：**无 `maxlength` 限制、无格式限制**（wxml:48,52 的 `input` 未设 `maxlength`），长度/一致性校验全部推迟到 `saveResetPassword`
- **WXML 绑定核查**：`user-manage.wxml:48,52` ✓

#### `saveResetPassword()` `(user-manage.js:115-144)`
- **触发方式**：`user-manage.wxml:57` `bindtap="saveResetPassword"`（「确认重置」）
- **入参**：`this.data.resetItem`、`this.data.resetForm`
- **调用云函数**：`authService` `action:'resetPassword'` ← `{ id: resetItem.id, newPassword }`，期望 `{code, msg}`
- **成功/失败分支**：前端校验（空值 :118-120、长度 ≥6 :121、两次一致 :122-124）→ `util.showConfirm` 二次确认 → `code===0` 关弹窗 + `showSuccess('密码已重置')`；否则 `toast(res.msg)`。**不重拉列表**（重置密码不改列表字段，合理）
- **副作用**：`util.showLoading()`/`hideLoading()`
- **契约风险**：前端**未拦截「重置自己」**，后端 `resetPassword:446` 会拦并返回「请在安全设置中修改当前账号密码」，前端以 toast 展示 —— 前端文案无提示，用户在弹窗里填完后才被拒
- **WXML 绑定核查**：`user-manage.wxml:57` ✓

#### `onFormInput(e)` `(user-manage.js:146-149)`
- **触发方式**：`user-manage.wxml:69,74,79` `bindinput="onFormInput"` + `data-field`
- **入参**：`dataset.field`（`username`/`name`/`password`）、`e.detail.value`
- **调用云函数**：无。**副作用**：`setData({ ['form.'+field]: value })`
- **契约风险**：无任何即时校验；`username` 的合法格式 `^[a-z0-9_.-]{3,32}$`（authService:139）**前端完全不提示**，用户输入大写/中文会静默通过到后端才被拒
- **WXML 绑定核查**：`user-manage.wxml:69,74,79` ✓

#### `onRoleChange(e)` `(user-manage.js:151-158)`
- **触发方式**：`user-manage.wxml:84` picker `bindchange="onRoleChange"`（`range="{{roles}}" range-key="label"`）
- **入参**：`e.detail.value`（下标）
- **调用云函数**：无。**副作用**：`setData` 写 `form.role` / `form.roleLabel` / `form.roleIndex`
- **契约风险**：`this.data.roles[e.detail.value]` **无越界保护**（正常 picker 不会越界，风险极低）；切换角色后**不清 `form.defaultStoreId`/`form.defaultSupplierId`**，导致「先把角色切成 supplier 再切回 chef」时残留 `defaultSupplierId`，而 :204 在非 supplier 时置 null，最终被丢弃 —— 无数据危害
- **WXML 绑定核查**：`user-manage.wxml:84` ✓

#### `onStoreChange(e)` `(user-manage.js:160-167)`
- **触发方式**：`user-manage.wxml:93` picker `bindchange="onStoreChange"`（`range="{{stores}}" range-key="storeName"`，`wx:if` 限 chef/store_manager）
- **入参**：`e.detail.value`
- **调用云函数**：无。**副作用**：写 `form.defaultStoreId`/`form.storeName`/`form.storeIndex`
- **契约风险**：`stores` 为空时 `this.data.stores[e.detail.value]` 为 undefined → 报 TypeError；但 picker 无选项时无法触发 change，实际不可达
- **WXML 绑定核查**：`user-manage.wxml:93` ✓

#### `onSupplierChange(e)` `(user-manage.js:169-176)`
- **触发方式**：`user-manage.wxml:102` picker `bindchange`（`wx:if` 限 supplier 角色）
- **入参**：`e.detail.value`
- **调用云函数**：无。**副作用**：写 `form.defaultSupplierId`/`form.supplierName`/`form.supplierIndex`
- **契约风险**：与 `onStoreChange` 同类；wxml:107 已对 `suppliers.length===0` 给出提示
- **WXML 绑定核查**：`user-manage.wxml:102` ✓

#### `stopBubble()` `(user-manage.js:178)`
- **触发方式**：`user-manage.wxml:42` `catchtap="stopBubble"`（重置密码弹窗体）+ `:64`（新增/编辑弹窗体）
- **入参**：无。**调用云函数**：无
- **WXML 绑定核查**：`user-manage.wxml:42,64` ✓（本页两处以 `catchtap` 阻止蒙层关闭事件冒泡）

#### `saveUser()` `(user-manage.js:180-223)`
- **触发方式**：`user-manage.wxml:112` `bindtap="saveUser"`（「保存」）
- **入参**：`this.data.form`、`this.data.editItem`
- **调用云函数**：新增 → `authService.createUser` ← payload（:212）；编辑 → `authService.updateUser` ← `{ id: editItem.id, ...payload }`（:210）。**payload 共 8 键**（:197-205）：`username`、`name`、`password`、`role`、`roleLabel`、`defaultStoreId`、`defaultSupplierId`（编辑/新增同构）
- **成功分支**（:216-219）：`showSuccess('保存成功')` + `closeForm()` + `loadData()`
- **失败分支**（:220-222）：`toast(res.msg || '保存失败')`
- **副作用**：`util.showLoading()`/`hideLoading()`
- **契约风险**：
  ① **前端校验仅 5 条**：账号非空/姓名非空（:182）、密码 ≥6（:185，仅新增必填 :182）、chef/store_manager 必须有门店（:188）、supplier 必须有供应商（:191）；**无账号格式校验、无长度上限、无重复检查、无「禁止改名 admin」校验**，全部依赖后端 `validateUserInput`（authService:133-154）与查重（:357-361 / :404-409）
  ② **`password` 恒发送**（:200 `form.password.trim()`），编辑不填密码时发空串；后端 `updateUser:428` 以 `if (input.password)` 判空跳过，语义正确
  ③ **`roleLabel` 是前端自造字段**：:202 由 `this.data.roles` 查出；后端 `createUser:378` / `updateUser:423` **完全忽略**它并用自己的 `ROLE_LABELS[input.role]` 计算 → 该字段为无意义传输。已核对前端 `roles`（:15-21）与后端 `ROLE_LABELS`（authService:14-20）**五组文案完全一致**，故当前无显示偏差，但若前端改文案会静默失效
  ④ **无防重提交**：`saveUser` 无 `_submitting` 守卫（对比 `saveStore`/`saveSupplier`/`saveProduct` 均有），连点两次「保存」会连发两次 `createUser`；后端靠账号查重兜底（:357-361），第二次报「该登录账号已存在」，用户看到误导性错误
  ⑤ **前端未拦截「编辑自己为 chef」与「停用 admin」**：:228 只拦了 `toggleUserStatus` 的 `admin`；`saveUser` 对 `editItem.username==='admin'` 无任何拦截 —— 幸而后端 `updateUser:417-419` 强制把 admin 的 `role`/`username` 钉死为 `super_admin`/`admin`，本次写入被静默改写（用户看到「保存成功」但角色没变）
  ⑥ **`updateUser` 后端没有「最后一个超管不可降级」保护**（对比 `setUserStatus:484-493` 有），前端也无 → 唯一超管可把自己改成 `chef` 造成系统锁死（见第 4 节）
- **WXML 绑定核查**：`user-manage.wxml:112` ✓

#### `toggleUserStatus(e)` `(user-manage.js:226-250)`
- **触发方式**：`user-manage.wxml:26` `bindtap="toggleUserStatus"` + `data-item="{{item}}"`
- **入参**：`dataset.item`
- **调用云函数**：`authService.setUserStatus` ← `{ id: item.id, status: item.status===1 ? 0 : 1 }`（:237-241），期望 `{code, msg}`
- **成功/失败分支**：前端先拦 `item.username==='admin'`（:228）→ `showConfirm` 双向文案（停用/恢复）→ `code===0` 成功 + `loadData()` 刷新；失败 `toast(res.msg)`
- **契约风险**：① `item.status` 取自列表渲染值，与后端真实状态可能过期（本页每次 onShow 重拉，窗口很小）；② 方向判断完全靠前端 `item.status===1`，后端 `setUserStatus:495-497` 会拒绝幂等值并返回「该账号已是停用状态」→ 表现为无谓的 toast；③ 无 `_submitting` 守卫
- **WXML 绑定核查**：`user-manage.wxml:26` ✓

### 2.3 商品管理 `pages/product-manage/product-manage.js`（284 行，20 方法 + 1 模块级函数）

#### `isUserCancel(errMsg)` `(product-manage.js:10-12)`（模块级，非 Page 方法）
- **触发方式**：被 `chooseImportFile` 的 fail 分支调用（:154）
- **入参**：`errMsg` 字符串；**用严格结尾正则** `/fail\s+cancel(\s+by\s+user)?$/i` 判定用户主动取消
- **契约风险**：无。注释（:7-9）明确记录宽松 `includes('cancel')` 会误吞「环境不支持」类错误，是踩坑后的修正
- **WXML 绑定核查**：无绑定（内部函数）

#### `onShow()` `(product-manage.js:30-33)`
- **触发方式**：生命周期
- **入参**：无。**调用云函数**：无（转调 `loadData`）
- **WXML 绑定核查**：无绑定

#### `loadData()` `(product-manage.js:35-69)`
- **触发方式**：`onShow`、`saveProduct` 成功后（:254）、`toggleStatus` 成功后（:279）、`uploadImportFile` 成功后（:186）
- **入参**：无
- **调用云函数**（:36-40 `Promise.all`）：`getProducts({includeInactive:true})`；`dataService.getCategories({})`；`getSuppliers({includeInactive:true})`
- **成功分支**（:45-68）：为分类补 `iconClass`/`iconClassActive`（经 `meta.getCategoryIconBase`，:45-48）；商品补 `categoryName`/`l1Name`/`supplierName`（:52-61，`l1Name` 缺失时回落为 `p.categoryL1` 原值，供应商缺失显示 `'未指定'`）；`setData({products, categoryL1List, categories, suppliers})` + `applyFilter()`
- **失败分支**（:41-44）：取第一个失败者 `msg`，`toast(... || '商品数据加载失败')` + `return`
- **副作用**：**无 loading**（`loadData` 内不调 `util.showLoading`）
- **契约风险**：① `data` 全部有 `|| []` 保护，无崩溃面；② 依赖后端 `getCategories` 返回 `{level1, categories}` 结构（dataService:87 已核对一致）；③ 分类/商品均为**单次全量拉取**，`getCategories` 后端 `.limit(100)`（dataService:67）→ 二级分类超 100 条静默丢失，且 `level1` 由内存 map 去重（dataService:70-78）
- **WXML 绑定核查**：无绑定

#### `switchL1(e)` `(product-manage.js:71-74)`
- **触发方式**：`product-manage.wxml:21`（「全部」）与 `:23`（各 L1 分类，`wx:for`）`bindtap="switchL1"` + `data-value`
- **入参**：`dataset.value`（`'all'` 或 `item.id`）
- **调用云函数**：无。**副作用**：`setData({activeL1})` + `applyFilter()`
- **契约风险**：`data-value` 与 `activeL1` 比较用 `===`；`categoryL1` 后端为字符串（`category_level_1`），一致
- **WXML 绑定核查**：`product-manage.wxml:21,23` ✓

#### `onSearch(e)` `(product-manage.js:76-79)`
- **触发方式**：`product-manage.wxml:10` `bindinput="onSearch"` + `value="{{keyword}}"`
- **入参**：`e.detail.value`
- **调用云函数**：**无（纯前端过滤，对比 supplier-manage 每次输入都发网络请求）**
- **副作用**：`setData({keyword})` + `applyFilter()`
- **契约风险**：按商品名 `includes` 过滤，大小写不敏感；**不匹配 `categoryName`/`unit`/`manufacturerName`**，与 supplier-manage 的 placeholder「搜索供应商/联系人」口径不同
- **WXML 绑定核查**：`product-manage.wxml:10` ✓

#### `applyFilter()` `(product-manage.js:81-91)`
- **触发方式**：内部调用（`loadData`/`switchL1`/`onSearch`）
- **入参**：无，读 `this.data.products`/`activeL1`/`keyword`
- **调用云函数**：无。**副作用**：`setData({ filteredProducts: list })`
- **契约风险**：`p.name.toLowerCase()` —— 若某商品 `name` 为空字符串仍安全；但 `normalizeProduct` 保证 `name` 至少为 `''`（cloud.js:175），无崩溃面
- **WXML 绑定核查**：无绑定

#### `showAddForm()` `(product-manage.js:93-100)`
- **触发方式**：`product-manage.wxml:56` `bindtap="showAddForm"`（FAB）
- **入参**：无
- **调用云函数**：无
- **成功分支**：预填第一个 L1（`categoryL1List[0]`）到 `form.categoryL1`/`categoryL1Name`，并按该 L1 计算 `filteredCategories`
- **契约风险**：`categoryL1List` 为空时 `firstL1 = {}` → `form.categoryL1=''`，随后 :238-239 校验会拦「请选择分类」；但弹窗里二级分类下拉为空，用户只能先选一级 —— 交互可用
- **WXML 绑定核查**：`product-manage.wxml:56` ✓

#### `showEditForm(e)` `(product-manage.js:102-111)`
- **触发方式**：`product-manage.wxml:41` `bindtap="showEditForm"` + `data-id="{{item.productId}}"`
- **入参**：`dataset.id`
- **调用云函数**：无
- **成功分支**：在 `this.data.products` 中 `find` 后填表；找不到则**静默不弹窗**（:104 `if (p)`）
- **契约风险**：**三个 picker 均未设置 `value` 属性**（wxml:84,91,115），编辑态下 picker 内部高亮恒为 index 0，而 `form.categoryL1Name`/`categoryName`/`supplierName` 显示的是真实值 → **显示值与下拉高亮背离**（方向 C，见第 3 节）
- **WXML 绑定核查**：`product-manage.wxml:41` ✓

#### `closeForm()` `(product-manage.js:113)`
- **触发方式**：`product-manage.wxml:73` `bindtap="closeForm"`（遮罩）+ `:123`（「取消」）
- **入参**：无。**调用云函数**：无。**副作用**：`setData({ showAdd:false })`
- **WXML 绑定核查**：`product-manage.wxml:73,123` ✓

#### `importEnvBlocker()` `(product-manage.js:119-130)`
- **触发方式**：内部调用（`chooseImportFile` :133）
- **入参**：无
- **调用云函数**：无。**`wx.` 调用**：`wx.getSystemInfoSync()`（:123，包在 try/catch 里）
- **返回**：`'unsupported'` / `'devtools'` / `'desktop'` / `''`
- **契约风险**：无。注释（:115-118）记录了「点击完全没反应」的排查结论
- **WXML 绑定核查**：无绑定

#### `chooseImportFile()` `(product-manage.js:132-162)`
- **触发方式**：`product-manage.wxml:15` `bindtap="chooseImportFile"`（「Excel 导入」）
- **入参**：无
- **调用云函数**：无（后续 `uploadImportFile` 才调）
- **成功分支**：环境受限时 `wx.showModal` 说明「需手机打开小程序」并 `return`（:134-143）
- **失败分支**：`wx.chooseMessageFile` 的 `fail` 中，**仅用户取消静默返回**（:154），其余一律 `wx.showModal` 弹原始 `errMsg`（:155-159）
- **副作用**：`wx.chooseMessageFile({count:1, type:'file'})`（:144-146）
- **契约风险**：`success` 回调里 `res.tempFiles && res.tempFiles[0]` 为空时 `return` **且无任何提示**（:149）
- **WXML 绑定核查**：`product-manage.wxml:15` ✓

#### `uploadImportFile(file)` `(product-manage.js:164-191)`
- **触发方式**：内部调用（`chooseImportFile` :150）
- **入参**：`file`（`tempFiles[0]`，取用 `.name` 与 `.path`）
- **调用云函数**：先 `wx.cloud.uploadFile({ cloudPath: 'imports/products/{ts}_{rand}.xlsx', filePath })`（:168-171），再 `importProducts` ← `{ fileID: up.fileID }`（:172），期望 `data{total, inserted, failed, errors[], warnings[]}`
- **成功分支**（:175-186）：拼装 `lines`（首行汇总 + 逐行错误 + warnings），`setData({importResult:{show:true, summary, lines}})`，随后 `await this.loadData()`
- **失败分支**：扩展名非 `.xlsx` → `toast('请选择 .xlsx 文件')`（:165）；`code!==0` → `toast(result.msg)`（:174）；异常 → `catch` 里 `hideLoading()` + `toast('导入失败：' + message)`（:187-189）
- **副作用**：`wx.showLoading({title:'导入中...', mask:true})` / `wx.hideLoading()`
- **契约风险**：① **`result.data` 直接解引用**（:175 `const d = result.data || {}` 有保护，但 :176 起的 `d.total`/`d.inserted`/`d.failed` 未做数字校验，缺失时汇总显示 `共 undefined 行`）；② 前端**不校验文件体积与行数上限**；③ 上传路径含 `Date.now()` + 随机数，无目录隔离，任何通过 `MANAGEMENT_ROLES` 的用户可写 `imports/`
- **WXML 绑定核查**：无绑定

#### `closeImportResult()` `(product-manage.js:193)`
- **触发方式**：`product-manage.wxml:59` `bindtap="closeImportResult"`（遮罩）+ `:67`（「知道了」）
- **入参**：无。**调用云函数**：无。**副作用**：`setData({ 'importResult.show': false })`，**保留 `lines` 内容**（下次导入前不清空，无害）
- **WXML 绑定核查**：`product-manage.wxml:59,67` ✓

#### `showTemplateInfo()` `(product-manage.js:195-201)`
- **触发方式**：`product-manage.wxml:16` `bindtap="showTemplateInfo"`（「模板说明」）
- **入参**：无。**调用云函数**：无。**副作用**：`wx.showModal`（`showCancel:false`）
- **契约风险**：模板说明是**硬编码文案**（:198），与后端 `importProducts` 的真实列名解析规则可能漂移 —— `importProducts` 实现未读，**未验证**一致性
- **WXML 绑定核查**：`product-manage.wxml:16` ✓

#### `stopBubble()` `(product-manage.js:204)`
- **触发方式**：`product-manage.wxml:60`（导入结果弹窗）+ `:74`（新增/编辑弹窗）`catchtap="stopBubble"`
- **入参**：无。**调用云函数**：无
- **WXML 绑定核查**：`product-manage.wxml:60,74` ✓

#### `onFormInput(e)` `(product-manage.js:206-209)`
- **触发方式**：`product-manage.wxml:79,100,105,110` `bindinput="onFormInput"` + `data-field`
- **入参**：`dataset.field`（`name`/`unit`/`spec`/`manufacturerName`）、`e.detail.value`
- **调用云函数**：无。**副作用**：`setData({ ['form.'+field]: value })`
- **契约风险**：4 个 input 均**无 `maxlength`**；`manufacturerName` 在 wxml:109 标了「*」但 :238-240 不校验（后端 `saveProduct:122` 用 `|| '默认'` 兜底）
- **WXML 绑定核查**：`product-manage.wxml:79,100,105,110` ✓

#### `onL1Change(e)` `(product-manage.js:211-220)`
- **触发方式**：`product-manage.wxml:84` picker `bindchange="onL1Change"`（`range="{{categoryL1List}}" range-key="name"`）
- **入参**：`e.detail.value`
- **调用云函数**：无。**副作用**：写 `form.categoryL1`/`categoryL1Name`，**清空** `form.categoryId`/`categoryName`，重算 `filteredCategories`
- **契约风险**：切换一级分类后强制清空二级分类，是正确设计
- **WXML 绑定核查**：`product-manage.wxml:84` ✓

#### `onCategoryChange(e)` `(product-manage.js:222-228)`
- **触发方式**：`product-manage.wxml:91` picker `bindchange="onCategoryChange"`
- **入参**：`e.detail.value`（在 `filteredCategories` 中的下标）
- **调用云函数**：无。**副作用**：写 `form.categoryId`/`categoryName`
- **契约风险**：`cats[e.detail.value]` **无越界保护**；`filteredCategories` 为空时 picker 不可交互，实际不可达
- **WXML 绑定核查**：`product-manage.wxml:91` ✓

#### `onSupplierChange(e)` `(product-manage.js:230-233)`
- **触发方式**：`product-manage.wxml:115` picker `bindchange="onSupplierChange"`
- **入参**：`e.detail.value`
- **调用云函数**：无。**副作用**：写 `form.defaultSupplierId`/`supplierName`（有 `if (supplier)` 保护）
- **契约风险**：**无法把默认供应商清空** —— 一旦选过就没有「无」选项，只能改成另一个供应商
- **WXML 绑定核查**：`product-manage.wxml:115` ✓

#### `saveProduct()` `(product-manage.js:235-258)`
- **触发方式**：`product-manage.wxml:124` `bindtap="saveProduct"`（「保存」）
- **入参**：`this.data.form`、`this.data.editItem`
- **调用云函数**：`dataService` `action:'saveProduct'` ← `{ productId: editItem && editItem.productId, ...form, name: form.name.trim(), unit: form.unit.trim() }`（:244-250），期望 `{code, msg}`
- **成功分支**：`code!==0` → `toast` + `return`；成功 → `showSuccess(编辑?'商品已更新':'商品已添加')` + 关弹窗 + `await loadData()`
- **失败分支**：`finally` 里清 `_submitting`（:255-257）
- **副作用**：`this._submitting` 防重（:236, :242）—— **注意 `_submitting` 是实例属性而非 `data`，不参与渲染**
- **契约风险**：
  ① 前端仅校验 3 项（名称 :238、分类 :239、单位 :240）；**厂家名必填标注与校验不符**（wxml:109 标 `*`，JS 不拦）
  ② **`...form` 展开把 `categoryL1`/`categoryL1Name`/`categoryName`/`supplierName` 一并上送**，后端 `saveProduct:116-118` 全部忽略（自己从分类记录反查）→ 4 个无意义字段
  ③ **后端无商品名查重**（dataService:98-137 全文无 duplicate 检查）→ 可创建任意多个同名商品；`toggleProduct` 也按 `product_id` 单条操作，同名会互相干扰。这是本批唯一「后端查重完全缺失」的写操作（对比 `createStore`/`saveSupplier`/`createUser` 都有）
  ④ 无名称/单位长度上限（后端也无）
- **WXML 绑定核查**：`product-manage.wxml:124` ✓

#### `toggleStatus(e)` `(product-manage.js:260-283)`
- **触发方式**：`product-manage.wxml:42` `bindtap="toggleStatus"` + `data-id="{{item.productId}}"`
- **入参**：`dataset.id`
- **调用云函数**：`dataService` `action:'toggleProduct'` ← `{ productId: id }`（:273-276），期望 `data.status`
- **成功/失败分支**：`product` 找不到则 `return`（:264）→ `showConfirm` 双向文案（:267-269）→ `code!==0` → `toast`；成功 → `showSuccess(result.data && result.data.status===1 ? '已启用' : '已停用')` + `loadData()`
- **契约风险**：① 方向文案由前端 `product.status===1` 预判（:266），但后端 `toggleProduct:145` 自行翻转，若两者过期不一致则 toast 与实际不符；② **前端不显示「该商品已被某未完结订单引用」之类的提示**，后端 `toggleProduct` 也不检查引用（dataService:139-148）→ 停用即从下单可选范围消失，历史单据仍引用
- **WXML 绑定核查**：`product-manage.wxml:42` ✓

### 2.4 价格管理 `pages/price-manage/price-manage.js`（228 行，17 方法）

#### `onLoad(options)` `(price-manage.js:24-27)`
- **触发方式**：生命周期
- **入参**：`options.supplierId`（来自 `supplier-manage.goProducts`）
- **调用云函数**：无。**副作用**：写实例属性 `this._initialSupplierId`（非 `data`）
- **契约风险**：**唯一读 URL 参数的入口**；`requireLogin()` 在此执行（:25）
- **WXML 绑定核查**：无绑定

#### `onShow()` `(price-manage.js:29)`
- **触发方式**：生命周期
- **入参**：无。**调用云函数**：无（转调 `loadData`）
- **契约风险**：**未调用 `authGuard.requireLogin()`**，与 :25 的 `onLoad` 守卫不对称。若 `onLoad` 中 `requireLogin` 触发 `reLaunch` 而本页 `onShow` 仍被执行，则会带空 `authToken` 发出 3 个云调用（`cloud.js:57-64` 会在 `authToken` 为空时读 storage 兜底）→ 后端返回 `-401` → `cloud.js:68` 再次触发跳登录。**`onLoad` 内 `reLaunch` 是否仍触发同页 `onShow` 属微信运行时行为，未验证**
- **WXML 绑定核查**：无绑定

#### `loadData()` `(price-manage.js:31-72)`
- **触发方式**：`onShow`、`savePrice` 成功后（:165）、`saveNewPrice` 成功后（:222）
- **入参**：无
- **调用云函数**（:33-37 `Promise.all`）：`getSuppliers({includeInactive:true})`；`getProducts({includeInactive:true})`；`getProductPrices({onlyCurrent:true})`
- **成功分支**（:43-71）：建 `supplierMap`/`productMap`，为每条价格补 `productName`/`productUnit`/`productCategory`/`supplierName`（:49-59，商品缺失时回落到 `price.productId` 原文，分类回落到 `categoryName || categoryL1 || ''`）；合并「全部供应商」哨兵项到 `supplierOptions`（:66）；消费一次 `_initialSupplierId` 后清空（:60-62）；`setData` 8 键 + `applyFilter()`
- **失败分支**（:38-42）：取首个失败者 `msg` → `toast` + `return`
- **副作用**：**无 loading**
- **契约风险**：① **`:32 const app = getApp()` 声明后从未使用**（死变量）；② `effectiveDate`/`price` 未做格式化，`price` 直接 `¥{{item.price}}` 展示（wxml:30），**无小数位截断**；③ 三个调用均为单次全量拉取，价格表超量静默丢失（`getProductPrices` 实现未读，**未验证**是否有 limit）
- **WXML 绑定核查**：无绑定

#### `applyFilter()` `(price-manage.js:74-91)`
- **触发方式**：内部调用（`loadData`/`onSearch`/`onSupplierFilter`）
- **入参**：无
- **调用云函数**：无。**副作用**：`setData({ priceList: list })`
- **契约风险**：**`:88 list.sort(...)` 直接原地排序 `this.data.allPrices`**（`filter` 返回新数组但 `selectedSupplierId` 与 `keyword` 都为空时 `list` 就是 `allPrices` 本身）→ 会永久改写 `allPrices` 顺序；当前仅按供应商名升序，无功能危害，但属易踩坑写法
- **WXML 绑定核查**：无绑定

#### `onSearch(e)` `(price-manage.js:93-96)`
- **触发方式**：`price-manage.wxml:17` `bindinput="onSearch"` + `value="{{keyword}}"`
- **入参**：`e.detail.value`
- **调用云函数**：无（前端过滤）。**副作用**：`setData({keyword})` + `applyFilter()`
- **WXML 绑定核查**：`price-manage.wxml:17` ✓

#### `onSupplierFilter(e)` `(price-manage.js:98-107)`
- **触发方式**：`price-manage.wxml:10` picker `bindchange="onSupplierFilter"`（`range="{{supplierOptions}}" range-key="supplierName"`）
- **入参**：`e.detail.value`
- **调用云函数**：无
- **副作用**：`idx == 0` 时清空筛选，否则取 `supplierOptions[idx]`；`applyFilter()`
- **契约风险**：`idx == 0` 用**宽松相等**（:100），与全文件其余 `===` 不一致；`supplierOptions[idx]` 无越界保护
- **WXML 绑定核查**：`price-manage.wxml:10` ✓

#### `showEditPrice(e)` `(price-manage.js:109-114)`
- **触发方式**：`price-manage.wxml:22` `bindtap="showEditPrice"` + `data-id="{{item.priceId}}"`
- **入参**：`dataset.id`
- **调用云函数**：无
- **成功分支**：在 `priceList` 中 `find`，命中则 `setData({ showEdit:true, editItem:item, newPrice: String(item.price) })`
- **契约风险**：找不到则静默不弹窗；`editItem` 存的是**筛选后列表的项**，含前端补算的 `productName`/`supplierName`
- **WXML 绑定核查**：`price-manage.wxml:22` ✓

#### `closeEdit()` `(price-manage.js:116)`
- **触发方式**：`price-manage.wxml:42`（遮罩）+ `:62`（「取消」）
- **入参**：无。**调用云函数**：无。**副作用**：`setData({ showEdit:false })`
- **WXML 绑定核查**：`price-manage.wxml:42,62` ✓

#### `stopBubble()` `(price-manage.js:119)`
- **触发方式**：`price-manage.wxml:43`（编辑弹窗）+ `:70`（新增弹窗）`catchtap="stopBubble"`
- **入参**：无。**WXML 绑定核查**：`price-manage.wxml:43,70` ✓

#### `onPriceInput(e)` `(price-manage.js:121-123)`
- **触发方式**：`price-manage.wxml:54` `bindinput="onPriceInput"`（`type="digit"` + `focus="true"`）
- **入参**：`e.detail.value`
- **调用云函数**：无。**副作用**：`setData({ newPrice: e.detail.value })`，**原样保存字符串**
- **契约风险**：`type="digit"` 允许小数点与逗号以外的字符；前端**不限制小数位数、不限制上限、不阻止连续小数点**（`1.2.3` 可输入）
- **WXML 绑定核查**：`price-manage.wxml:54` ✓

#### `savePrice()` `(price-manage.js:125-170)`
- **触发方式**：`price-manage.wxml:63` `bindtap="savePrice"`（「确认修改」）
- **入参**：`this.data.editItem`、`this.data.newPrice`
- **调用云函数**（两步）：
  1. `updateProductPrice` ← `{ supplierId, productId, newPrice: price, updatedBy, dryRun: true }`（:135-141）—— 仅校验 + 计在途单
  2. 用户确认后 `updateProductPrice` ← `{ supplierId, productId, newPrice, updatedBy }`（:155-160）
- **成功/失败分支**：`isNaN(price) || price <= 0` → `toast('请输入有效价格')`（:128）；dryRun `code!==0` → 清 `_submitting` + `toast`（:142-145）；`affected > 0` 时弹「调价波及提醒」，取消则清 `_submitting` 返回（:147-153）；正式调用 `code===0` → `showToast`（`affected>0` 时 `icon:'none'`）+ 关弹窗 + `loadData()`
- **副作用**：`this._submitting` 防重（:129, :130, :143, :150, :169）
- **契约风险**：
  ① **前端只做 `isNaN` 与 `> 0` 两项校验**；后端 `updateProductPrice:76-79` 同样只做 `Number.isFinite` 与 `> 0` → **价格精度与上限前后端都无约束**，`0.000001` 与 `999999999.99` 均可入库
  ② **`_submitting` 检查在 `parseFloat` 之后**（:127-129），顺序无功能影响但属不一致写法（`saveNewPrice` 相同）
  ③ **`updatedBy` 是前端自造的展示名**（:133 `userInfo.name`），后端 `updateProductPrice:126` 强制用 `user.user_id || user._id`，**该入参实际被忽略**（仅作最后兜底）→ 审计日志里记的是用户 ID 而非姓名
  ④ **正式调用不传 `dryRun`**（:155-160），后端 `event.dryRun === true` 判定为假（updateProductPrice:99），正确落库
  ⑤ `affected` 计数依赖后端 `countInflightOrders`，其 `catch` **异常时按 0 处理**（updateProductPrice:60-63）→ 波及面可能显示 0 而实际有影响，前端无法察觉
- **WXML 绑定核查**：`price-manage.wxml:63` ✓

#### `showAddPrice()` `(price-manage.js:173-178)`
- **触发方式**：`price-manage.wxml:18` `bindtap="showAddPrice"`（「+ 新增价格」按钮）
- **入参**：无。**调用云函数**：无
- **成功分支**：`setData({ showAdd:true, addForm:{supplierId:'',supplierName:'',productId:'',productName:'',price:''} })`
- **WXML 绑定核查**：`price-manage.wxml:18` ✓

#### `closeAdd()` `(price-manage.js:180)`
- **触发方式**：`price-manage.wxml:69`（遮罩）+ `:97`（「取消」）
- **入参**：无。**副作用**：`setData({ showAdd:false })`
- **WXML 绑定核查**：`price-manage.wxml:69,97` ✓

#### `onAddSupplierPick(e)` `(price-manage.js:182-185)`
- **触发方式**：`price-manage.wxml:75` picker `bindchange="onAddSupplierPick"`（`range="{{suppliers}}"`）
- **入参**：`e.detail.value`
- **副作用**：写 `addForm.supplierId`/`supplierName`（有 `if (sup)` 保护）
- **契约风险**：picker **无 `value` 属性**，与 product-manage 同类问题
- **WXML 绑定核查**：`price-manage.wxml:75` ✓

#### `onAddProductPick(e)` `(price-manage.js:187-190)`
- **触发方式**：`price-manage.wxml:82` picker `bindchange="onAddProductPick"`（`range="{{products}}" range-key="name"`）
- **入参**：`e.detail.value`
- **副作用**：写 `addForm.productId`/`productName`（有 `if (product)` 保护）
- **契约风险**：商品下拉来自 `getProducts({includeInactive:true})`，**包含停用商品** → 可为「停用商品 × 供应商」首次定价，而后端 `updateProductPrice:92` 会拒绝「商品已停用」→ 前端可选但提交必失败
- **WXML 绑定核查**：`price-manage.wxml:82` ✓

#### `onAddPriceInput(e)` `(price-manage.js:192-194)`
- **触发方式**：`price-manage.wxml:89` `bindinput`（`type="digit"` + `focus="true"`）
- **入参**：`e.detail.value`
- **副作用**：`setData({ 'addForm.price': value })`
- **契约风险**：与 `onPriceInput` 相同，无精度/上限拦截
- **WXML 绑定核查**：`price-manage.wxml:89` ✓

#### `saveNewPrice()` `(price-manage.js:196-227)`
- **触发方式**：`price-manage.wxml:98` `bindtap="saveNewPrice"`（「确认添加」）
- **入参**：`this.data.addForm`
- **调用云函数**：`updateProductPrice` ← `{ supplierId, productId, newPrice: price, updatedBy }`（:210-215，**无 `dryRun`**），期望 `{code, msg, data.affectedOrders}`
- **成功/失败分支**：供应商/商品必填（:198-199）→ 价格有效性（:200-201）→ **前端查重**：`allPrices.some(...)` 命中则 `toast('该供应商已有此商品价格，请在列表中修改')`（:204-205）；成功 → `showToast`（区分有无在途单）+ 关弹窗 + `loadData()`
- **契约风险**：
  ① **前端查重是纯 UX 引导，不承担数据一致性** —— 后端 `updateProductPrice:106-129` 用事务把旧 `is_current=1` 全部置 0 再插入新行，无论是否首次都会正确收敛；因此「新增价格」与「修改价格」后端是**同一个操作**，前端区分的价值仅为提示在途单影响
  ② 查重基于 `onlyCurrent:true` 的当前价，**并发场景**（两个端同时新增）仍靠后端事务兜底
  ③ 停用商品/停用供应商可选（见 `onAddProductPick`），提交才被拒
  ④ `updatedBy` 同样被后端忽略（见 `savePrice`）
- **WXML 绑定核查**：`price-manage.wxml:98` ✓

### 2.5 供应商管理 `pages/supplier-manage/supplier-manage.js`（121 行，11 方法）

#### `onShow()` `(supplier-manage.js:15-18)`
- **触发方式**：生命周期
- **入参**：无。**调用云函数**：无（转调 `loadData`）
- **WXML 绑定核查**：无绑定

#### `loadData()` `(supplier-manage.js:20-35)`
- **触发方式**：`onShow`、`onSearch`（**每次输入**）、`saveSupplier` 成功后（:85）、`toggleStatus` 成功后（:111）
- **入参**：无
- **调用云函数**：`getSuppliers({ includeInactive: true })`（:22-24），期望 `data[]`
- **成功分支**：`normalizeSupplier` 归一化后，若有 `keyword` 则按 `supplierName` 或 `contactName` 过滤（:30-33）；`setData({suppliers: list})`
- **失败分支**：`!result || result.code !== 0` → `toast(result.msg || '供应商数据加载失败')` + `return`
- **副作用**：**无 loading**
- **契约风险**：① **`:21 const app = getApp()` 声明后从未使用**（死变量，本页共 3 处同类：:21、:75、:104）；② **每次按键都触发一次完整云函数调用**（:37-40 → :39），无防抖、无节流 —— 与 product-manage 的纯前端过滤策略不一致；③ `keyword` 过滤只覆盖名称与联系人，**不覆盖 `contactPhone`**（尽管 placeholder 只写「搜索供应商/联系人」，一致）
- **WXML 绑定核查**：无绑定

#### `onSearch(e)` `(supplier-manage.js:37-40)`
- **触发方式**：`supplier-manage.wxml:9` `bindinput="onSearch"` + `value="{{keyword}}"`
- **入参**：`e.detail.value`
- **调用云函数**：经 `loadData` 间接调用 `getSuppliers`
- **副作用**：`setData({keyword})` + `loadData()`
- **契约风险**：见 `loadData` ② —— 输入 10 个字 = 10 次云调用；且**没有 loading 提示**，用户看到的现象是列表闪动
- **WXML 绑定核查**：`supplier-manage.wxml:9` ✓

#### `showAddForm()` `(supplier-manage.js:42-47)`
- **触发方式**：`supplier-manage.wxml:37` `bindtap="showAddForm"`（FAB）
- **入参**：无。**调用云函数**：无
- **副作用**：`setData({ showAdd:true, editItem:null, form:{supplierName:'',contactName:'',contactPhone:'',remark:''} })`
- **WXML 绑定核查**：`supplier-manage.wxml:37` ✓

#### `showEditForm(e)` `(supplier-manage.js:49-57)`
- **触发方式**：`supplier-manage.wxml:24` `bindtap="showEditForm"` + `data-id="{{item.supplierId}}"`
- **入参**：`dataset.id`
- **调用云函数**：无
- **成功分支**：`this.data.suppliers.find(...)` 命中后填表（4 字段均带 `|| ''` 兜底）；未命中静默不弹窗
- **契约风险**：**编辑的是「筛选后」列表中的项**，与 product-manage 一致
- **WXML 绑定核查**：`supplier-manage.wxml:24` ✓

#### `closeForm()` `(supplier-manage.js:59)`
- **触发方式**：`supplier-manage.wxml:40`（遮罩）+ `:62`（「取消」）
- **入参**：无。**副作用**：`setData({ showAdd:false })`
- **WXML 绑定核查**：`supplier-manage.wxml:40,62` ✓

#### `stopBubble()` `(supplier-manage.js:62)`
- **触发方式**：`supplier-manage.wxml:41` `catchtap="stopBubble"`
- **入参**：无。**WXML 绑定核查**：`supplier-manage.wxml:41` ✓

#### `onFormInput(e)` `(supplier-manage.js:64-66)`
- **触发方式**：`supplier-manage.wxml:46,50,54,58` `bindinput="onFormInput"` + `data-field`
- **入参**：`dataset.field`、`e.detail.value`
- **副作用**：`setData({ ['form.'+field]: value })`
- **契约风险**：4 个输入均**无 `maxlength`**（wxml:46,50,54,58；`textarea` :58 同样无上限）；`contactPhone` 用 `type="number"` 仅限制键盘，**不校验号码格式、不拦空值**
- **WXML 绑定核查**：`supplier-manage.wxml:46,50,54,58` ✓

#### `saveSupplier()` `(supplier-manage.js:68-89)`
- **触发方式**：`supplier-manage.wxml:63` `bindtap="saveSupplier"`（「保存」）
- **入参**：`this.data.form`、`this.data.editItem`
- **调用云函数**：`dataService` `action:'saveSupplier'` ← `{ supplierId: editItem && editItem.supplierId, ...form, supplierName: form.supplierName.trim() }`（:76-81），期望 `{code, msg}`
- **成功/失败分支**：名称必填（:71）→ 调用 → `code!==0` `toast` + `return`；成功 → `showSuccess(编辑?'供应商已更新':'供应商已添加')` + 关弹窗 + `loadData()`；`finally` 清 `_submitting`
- **副作用**：`:75 const app = getApp()` **死变量**；`this._submitting` 防重（:69, :73）
- **契约风险**：
  ① **前端只校验供应商名非空**；联系人/电话/备注零校验（后端 `saveSupplier:153-160` 也只对名称 `trim` 判空，其余原样入库）→ 可存空电话、超长备注
  ② **后端查重用 `.limit(100)`**（dataService:162-167）→ 供应商超过 100 家后，重复名称检查会静默漏检。对比 `createStore` 已把查重改为无条件查询（authService:525-529 注释明确「原 orderBy+limit(100) 在门店超过 100 家后查不到」）→ **该修复未同步到 `saveSupplier`**，同类缺陷仍在
  ③ **无联系电话格式与唯一性约束**
- **WXML 绑定核查**：`supplier-manage.wxml:63` ✓

#### `toggleStatus(e)` `(supplier-manage.js:91-115)`
- **触发方式**：`supplier-manage.wxml:25` `bindtap="toggleStatus"` + `data-id="{{item.supplierId}}"`
- **入参**：`dataset.id`
- **调用云函数**：`dataService` `action:'toggleSupplier'` ← `{ supplierId: id }`（:105-108），期望 `data.status`
- **成功/失败分支**：`supplier` 找不到 `return`（:95）→ `showConfirm` 双向文案 → `code!==0` `toast`；成功 → `showSuccess(result.data && result.data.status===1 ? '已启用':'已停用')` + `loadData()`
- **副作用**：`:104 const app = getApp()` **死变量**；`this._submitting` 防重
- **契约风险**：① 方向文案由前端 `supplier.status===1` 预判，后端 `toggleSupplier` 自行翻转（dataService:189）；② **停用供应商不影响其价格记录** —— 后续 `updateProductPrice` 会因 `supplier.status=1` 条件拒绝（updateProductPrice:91），即「先停用再改价」必失败，前端无提示
- **WXML 绑定核查**：`supplier-manage.wxml:25` ✓

#### `goProducts(e)` `(supplier-manage.js:117-120)`
- **触发方式**：`supplier-manage.wxml:23` `bindtap="goProducts"` + `data-id="{{item.supplierId}}"`（价格标签图标）
- **入参**：`dataset.id`
- **调用云函数**：无。**副作用**：`wx.navigateTo('/pages/price-manage/price-manage?supplierId=' + id)`
- **契约风险**：目标页 `price-manage.onLoad` 读取 `options.supplierId`（price-manage.js:26），链路闭合（见第 5 节）
- **WXML 绑定核查**：`supplier-manage.wxml:23` ✓

### 2.6 门店管理 `pages/store-manage/store-manage.js`（120 行，9 方法）

#### `onShow()` `(store-manage.js:14-17)`
- **触发方式**：生命周期
- **入参**：无。**调用云函数**：无（转调 `loadData`）
- **WXML 绑定核查**：无绑定

#### `loadData()` `(store-manage.js:19-29)`
- **触发方式**：`onShow`、`saveStore` 成功后（:81）、`toggleStoreStatus` 成功后（:112）
- **入参**：无
- **调用云函数**：`authService.getStores` ← `{ includeInactive: 1 }`（:22，**数字 1，后端 `=== 1 || === true` 均匹配** authService:319），期望 `data[]`
- **成功分支**：`setData({ stores: res.data || [] })`
- **失败分支**：`toast((res && res.msg) || '门店加载失败，请稍后重试')`
- **副作用**：`util.showLoading()`（:20）/`util.hideLoading()`（:23），**hide 在判断前无条件执行，即使异常也会执行到**（无 await 中断风险，因为只有一个 await）
- **契约风险**：**后端 `getStores` 有 `.limit(100)`**（authService:329）→ 门店超 100 家静默丢失
- **WXML 绑定核查**：无绑定

#### `showAddForm()` `(store-manage.js:31-33)`
- **触发方式**：`store-manage.wxml:36` `bindtap="showAddForm"`（FAB）
- **入参**：无。**副作用**：`setData({ showForm:true, editItem:null, form:{storeName:''} })`
- **WXML 绑定核查**：`store-manage.wxml:36` ✓

#### `showEditForm(e)` `(store-manage.js:35-42)`
- **触发方式**：`store-manage.wxml:23` `bindtap="showEditForm"` + `data-item="{{item}}"`
- **入参**：`dataset.item`
- **副作用**：`setData({ showForm:true, editItem:item, form:{storeName: item.storeName || ''} })`
- **契约风险**：`editItem` 携带完整门店对象，使 wxml:51 能直接显示 `editItem.storeCode`（只读展示）
- **WXML 绑定核查**：`store-manage.wxml:23` ✓

#### `closeForm()` `(store-manage.js:44-46)`
- **触发方式**：`store-manage.wxml:39`（遮罩）+ `:57`（「取消」）
- **入参**：无。**副作用**：`setData({ showForm:false, editItem:null })`（**清空 editItem，比 user-manage/product-manage 更严谨**）
- **WXML 绑定核查**：`store-manage.wxml:39,57` ✓

#### `onStoreNameInput(e)` `(store-manage.js:48-50)`
- **触发方式**：`store-manage.wxml:46` `bindinput="onStoreNameInput"`（`maxlength="30"`）
- **入参**：`e.detail.value`
- **副作用**：`setData({ 'form.storeName': value })`
- **契约风险**：`maxlength` 与后端 `storeName.length > 30` 校验（authService:523, :597）**完全一致**
- **WXML 绑定核查**：`store-manage.wxml:46` ✓

#### `stopBubble()` `(store-manage.js:52)`
- **触发方式**：`store-manage.wxml:40` `catchtap="stopBubble"`
- **入参**：无。**WXML 绑定核查**：`store-manage.wxml:40` ✓

#### `saveStore()` `(store-manage.js:54-88)`
- **触发方式**：`store-manage.wxml:58` `bindtap="saveStore"`（「保存」）
- **入参**：`this.data.form`、`this.data.editItem`
- **调用云函数**：新增 → `authService.createStore` ← `{ storeName }`（:71-74）；编辑 → `authService.updateStore` ← `{ storeId: editItem.storeId, storeName }`（:65-69）
- **成功/失败分支**：`storeName` 必填（:57-58）→ `code===0` → `showSuccess(编辑?'保存成功':'门店已创建')` + `closeForm()` + `loadData()`；否则 `toast(res.msg || '保存失败，请稍后重试')`
- **副作用**：`this._submitting` 防重（:55, :60, :86）；`showLoading`/`hideLoading`
- **契约风险**：
  ① **前端从不发送 `storeCode`** —— 后端 `createStore:521-541` 接受客户端 `storeCode` 并做查重，**该后门在本页无暴露面**，但 API 层仍开放（可由其它客户端构造编号）
  ② 门店编号生成在后端：`store_id = 'S' + pad(maxSeq+1)`，并发撞号递增重试最多 3 次（authService:543-581）
  ③ 名称必填/长度前后端双检，一致
- **WXML 绑定核查**：`store-manage.wxml:58` ✓

#### `toggleStoreStatus(e)` `(store-manage.js:90-119)`
- **触发方式**：`store-manage.wxml:24` `bindtap="toggleStoreStatus"` + `data-item="{{item}}"`
- **入参**：`dataset.item`
- **调用云函数**：`authService.setStoreStatus` ← `{ storeId: item.storeId, status: item.status===1 ? 0 : 1 }`（:103-107）
- **成功/失败分支**：`showConfirm` 双向文案（:95-97）→ `code===0` → `showSuccess(已停用/已启用)` + `loadData()`；否则 `toast`
- **副作用**：`this._submitting` 防重
- **契约风险**：
  ① 后端 `setStoreStatus:640-648` 在停用前检查未完结采购单并拒绝 —— 前端**没有预检提示**，用户点完确认才被 toast 拒绝
  ② **后端不检查门店是否被账号引用**（`setStoreStatus:622-655` 全文无 `app_user` 检查）：停用一家门店后，挂在它上面的所有 `chef`/`store_manager` 账号登录会直接失败（`getDefaultStore:93-96` 对 STORE_ROLES 返回 null → `login:206-207` 报「账号未关联有效门店」）。**前后端均无「还有 N 个账号挂在本网店」的提示**，属静默锁人
- **WXML 绑定核查**：`store-manage.wxml:24` ✓

### 2.7 门店切换 `pages/store-switch/store-switch.js`（44 行，2 方法）

#### `onLoad()` `(store-switch.js:9-30)`
- **触发方式**：生命周期（**async**）
- **入参**：无（**不读 `options`**）
- **调用云函数**：`authService.getStores` ← `{}`（:19-21，**未传 `includeInactive`** → 只返回启用门店），期望 `data[]`
- **成功分支**：`setData({ stores: result.data || [], currentStoreId: currentStore ? (currentStore.storeId || currentStore.id) : '' })`
- **失败分支**：`!result || result.code !== 0` → `toast(result.msg || '门店加载失败，请稍后重试')` + `return`
- **前置守卫**：`requireLogin()`（:10）→ 供货商角色 `reLaunch` 到供货商门户（:13-17）
- **契约风险**：
  ① **后端 `getStores:322-324` 对 `chef`/`store_manager` 强制 `store_id = user.default_store_id`** → 这两类角色只会拿到**唯一一家**门店。而 `index.wxml:7` 对**所有角色**都显示「切换 ▸」入口 → 厨师/店长点进去看到 1 张卡片和「当前」标记，「门店切换」功能对他们形同虚设（方向 C 类问题，见第 3 节）
  ② 对未关联门店的 chef/store_manager，后端返回 `{code:-1, msg:'账号未关联有效门店'}`（authService:323）→ 本页 toast 后页面停在空列表
  ③ `purchaser`/`super_admin` 不在 `STORE_ROLES` 中，`query` 无 `store_id` 条件 → 拿到全部门店（`.limit(100)`）
- **WXML 绑定核查**：无绑定

#### `selectStore(e)` `(store-switch.js:32-43)`
- **触发方式**：`store-switch.wxml:9` `bindtap="selectStore"` + `data-id="{{item.storeId}}"`
- **入参**：`dataset.id`
- **调用云函数**：**无 —— 全系统唯一「完全不写云端」的状态切换**
- **成功分支**：`stores.find` 命中 → 写 `app.globalData.currentStore = store` + `wx.setStorageSync('currentStore', store)` + `setData({currentStoreId})` + `showSuccess('已切换到 '+name)` + `setTimeout(()=>wx.navigateBack(), 800)`；未命中则**静默无动作**
- **副作用**：`wx.setStorageSync` 键 `currentStore`（与 `index.switchAccount:147` 的清理键一致）；`setTimeout` 800ms 后返回
- **契约风险**：
  ① **门店选择是纯本地态**，切换动作不通知任何服务端 → 后端每个云函数都凭请求里的 `storeId` 自行裁决，因此不存在「服务端记住当前门店」的一致性问题；但反之，**同一账号在另一台设备上的门店选择不会同步**（本地 storage 各自独立）
  ② **切换本身不做权限裁决**：purchaser/super_admin 可以切到任意门店，随后 `getPurchaseOrders`/`getOrderStats` 等会按 `storeId` 返回该门店数据 —— 权限收敛完全依赖后续每个云函数各自实现（`getOrderStats:878-879` 已核对：对 GLOBAL_ROLES 接受 `event.storeId`）
  ③ **停用门店无法作为切换目标**（`getStores` 未传 `includeInactive`），但当前选中的门店若被 store-manage 停用，`currentStore` 仍指向它 → 后续请求带上已停用 `storeId`，各云函数的反应未统一验证（**未验证**）
- **WXML 绑定核查**：`store-switch.wxml:9` ✓

---

## 3. ★ 专项一：WXML ↔ JS 双向对账（本批 7 页）

### 3.1 方向 A：wxml 引用了但 js 没有 → 点了没反应

**本批 7 页：0 条。** 逐页核对结果：
- index：`goStore`(wxml:6)、`goMessages`(:13)、`goAccount`(:17)、`goAction`(:30,34,38,42,46,94)、`openStoreManage`(:50)、`goStatPage`(:59)、`goOrderDetail`(:71)、`goReportDetail`(:96)、`switchAccount`(:108) —— 全部在 js 中存在（js:119,129,133,177,122,155,169,173,135）。
- user-manage：wxml:24,25,26,38,41,42,48,52,56,57,63,64,69,74,79,84,93,102,111,112 共 20 处绑定，全部命中。
- product-manage：wxml:10,15,16,21,23,41,42,56,59,60,67,73,74,79,84,91,100,105,110,115,123,124 共 22 处，全部命中。
- price-manage：wxml:10,17,18,22,42,43,54,62,63,69,70,75,82,89,97,98 共 16 处，全部命中。
- supplier-manage：wxml:9,23,24,25,37,40,41,46,50,54,58,62,63 共 13 处，全部命中。
- store-manage：wxml:23,24,36,39,40,46,57,58 共 8 处，全部命中。
- store-switch：wxml:9 共 1 处，命中。

检索方式：对 7 个 wxml 逐个提取 `bindtap|catchtap|bindinput|bindchange` 目标函数名，与 js 中 `Page()` 的方法表交叉比对；无未定义引用。

### 3.2 方向 B：js 定义了但 wxml 没引用 → 页面死代码

**2 条：**

1. **`index.js:126 stopBubble()` —— 无绑定。** `index.wxml` 全文无任何 `catchtap`（grep `bindtap|catchtap|bindinput|bindchange` 后逐处确认，`index.wxml` 内 `catchtap` 出现次数为 0）。首页无弹窗，此空方法纯属从其它管理页复制遗留。

2. **`index.js:160-161 goStatPage` 的 `abnormal` 分支 —— 永不触发。** `stats` 数组由 :80-88 生成，取值域恒为 `{submitted, receivable, received, message, to_verify}`，**从不产出 `abnormal`**；因此 `wx.navigateTo('/pages/abnormal-list/abnormal-list')` 是不可达代码。

**次级（属内部方法，不属页面死代码）**：`product-manage.js:119 importEnvBlocker()` 与 `:164 uploadImportFile()` 无 wxml 绑定但均有内部调用点（:133、:150）；`price-manage.js` 的 `loadData`/`applyFilter`、`user-manage.js` 的 `loadData` 同类。**非死代码。**

### 3.3 方向 C：wxml 读的 `data` 键在 js 里无来源 → 永远走默认分支

**3 条（含 1 条功能性影响）：**

1. **`product-manage.wxml:84,91,115` 三个 `picker` 无 `value` 属性** —— picker 的内部选中下标恒为 0。编辑态下 `form.categoryL1Name`/`form.categoryName`/`form.supplierName` 显示真实值，但用户点开下拉看到的默认高亮是第 1 项 → **显示值与交互高亮背离**，用户误以为「这一项没被选中」而重复选择。同类问题见 `price-manage.wxml:75,82`（新增价格弹窗的两个 picker）。

2. **`user-manage.wxml:93` 门店 picker 的候选集缺项** —— `stores` 来自 `getStores` 未传 `includeInactive`（user-manage.js:36），后端只返回启用门店（authService:321）。若某账号挂在**已停用**门店上，`showEditForm:71` 得到 `sIdx=-1` → `storeIndex=0`，但 `form.defaultStoreId` 保留原停用门店 id：下拉显示第 1 家门店（`storeName` 为空 → 显示「请选择所属门店」），保存时 :188 校验通过（`defaultStoreId` 非空），**实际保存的是停用门店**。

3. **`store-switch` 对 chef/store_manager 永远只有 1 项** —— `index.wxml:7` 无条件渲染「切换 ▸」，但 `getStores:322-324` 把这两类角色限制到唯一门店 → 「切换」永远无第二选项。属 UI 承诺与数据能力不匹配。

**已核对无来源问题的键**（列出以免误报）：`index` 的 9 个 data 键全部在 wxml 中被读取；`user-manage` 8 键全部被读；`price-manage` 13 键、`supplier-manage` 6 键、`store-manage` 4 键、`product-manage` 11 键中的 `showAdd`/`filteredProducts`/`categoryL1List`/`filteredCategories`/`suppliers`/`products`/`keyword`/`activeL1`/`showAdd`/`editItem`/`importResult` 均被读。

### 3.4 方向 D：js 写入的 `data` 键 wxml 从未读取

**0 条真正无意义状态。** 以下 3 个「只写不读」的键经核实均为**合理的前端缓存/派生中间态**，不作为缺陷：

- `price-manage.js:67 allPrices` —— wxml 只读 `priceList`；`allPrices` 供 `applyFilter`(:76) 与 `saveNewPrice`(:204) 查重使用。
- `product-manage.js:63 products` / `:65 categories` —— wxml 读 `filteredProducts`/`filteredCategories`/`categoryL1List`；`products` 供 `showEditForm`(:103)/`toggleStatus`(:263)/`applyFilter`(:82)，`categories` 供 `showAddForm`(:98)/`showEditForm`(:108)/`onL1Change`(:218)。
- `index.js` 无此情况。

**另有 3 个非 `data` 实例属性**（不参与渲染，属私有状态，非缺陷）：`price-manage.js:26 _initialSupplierId`、`product-manage.js:236/242 _submitting`、`supplier-manage.js:69/73 _submitting`、`price-manage.js:129/130 _submitting`、`store-manage.js:55/60 _submitting`。

---

## 4. ★ 专项二：管理端写操作的输入校验普查

### 4.0 前置结论：本批 6 个管理页前端均无角色门禁

**证据**：逐页 `onShow`/`onLoad` 只调用 `authGuard.requireLogin()`（user-manage.js:27、product-manage.js:31、price-manage.js:25、supplier-manage.js:16、store-manage.js:15、store-switch.js:10），`utils/auth-guard.js:5-14` **全文只有 `requireLogin()` 一个函数**，无 `requireRole` 类能力。因此任何已登录用户（含 chef、supplier）都能通过 URL 直达这些页面并看到管理 UI；实际拦截全部落在云端。

已核对的云端门禁：
- `authService.requireSuperAdmin`（authService:334-338）→ 覆盖 `listUsers`(:342)、`createUser`(:352)、`updateUser`(:394)、`resetPassword`(:443)、`setUserStatus`(:474)、`createStore`(:517)、`updateStore`(:591)、`setStoreStatus`(:623) —— **全部 8 个账号/门店写操作与 listUsers 均要求 `super_admin`**。
- `dataService.requireUser(event, MANAGEMENT_ROLES)`（dataService:99,140,151,184，`MANAGEMENT_ROLES=['super_admin','purchaser']` dataService:9）→ 覆盖 `saveProduct`、`toggleProduct`、`saveSupplier`、`toggleSupplier`。
- `updateProductPrice` 手写判断 `['super_admin','purchaser']`（updateProductPrice:70）。
- **例外**：`dataService.getCategories`（:62）只 `requireUser` 无角色限制；`getStores`（authService:314）只 `requireUser` + 角色化查询。

### 4.1 建账号 `createUser` / `updateUser`（user-manage.js:180-223）

| 字段 | 前端校验 | 后端校验（位置） | 可否绕过 |
|---|---|---|---|
| `username` | 仅非空（:182） | `^[a-z0-9_.-]{3,32}$`（authService:139）+ 小写化（:24-26）+ 查重（:357-361 / :404-409） | 前端可提交大写/中文/超长，**后端静默小写化**（用户看到的与入库的字符集不同，前端无提示） |
| `name` | 仅非空（:182） | 非空（:142），**无长度上限** | 可提交超长姓名 |
| `password` | 新增必填 + ≥6（:182, :185） | `requirePassword \|\| password` 时 ≥6（:144），**无复杂度/字符集要求** | 可提交 `123456`、纯数字、前后端一致 |
| `role` | 由 picker 选择（:151-158） | `ROLE_LABELS[role]` 存在性（:143） | **前端可任意构造 role 值**，但后端白名单拦死，无法注入新角色 |
| `roleLabel` | 前端自造（:202） | **完全忽略**，后端自算（:378 / :423） | 无意义字段，改文案不生效 |
| `defaultStoreId` | chef/store_manager 必填（:188） | 必填（:147）+ `findStore` 校验存在且启用（:362 / :410） | 可构造任意 storeId，后端查不到即拒；**停用门店会被拒** |
| `defaultSupplierId` | supplier 必填（:191） | 必填（:150）+ `findSupplier`（:365 / :413） | 同上 |

**越权组合构造能力（重点核查结论）**：
- **角色 / 门店归属 / 启用状态三者均可由 super_admin 自由组合**，后端唯一的硬约束是：admin 账号的 `role`/`username` 被钉死（:417-419）、停用最后一个超管被拒（:484-493）、停用不能操作自己（:479）、重置密码不能重置自己（:446）。
- **缺口 1：`updateUser` 没有「最后一个超管不可降级」保护。** `setUserStatus` 有（:487-492），`updateUser` 没有 → 唯一超管可把自己改成 `chef` 并指定一家门店，保存成功后系统失去唯一管理入口，且前端**无任何拦截或提示**（user-manage.js:180-223 全文无 `editItem.username==='admin'` 判断）。这是本批最危险的组合缺口。
- **缺口 2：前端 `saveUser` 对 admin 完全无拦截**，用户编辑 admin 的姓名能成功，改角色则被后端静默改写（返回「保存成功」但角色未变）。
- **缺口 3：前端 `toggleUserStatus` 拦的是 `item.username==='admin'`**（:228），但后端 admin 停用其实是有条件允许的（:486-492）→ 前端拦截比后端更严，功能被提前砍掉。
- **缺口 4：前端无「不能把自己改成 supplier 且不留门店」之类的语义检查**，靠后端角色-归属耦合校验兜底。

### 4.2 重置密码 `resetPassword`（user-manage.js:115-144）

- 前端：非空（:118）、≥6（:121）、两次一致（:122）、二次确认（:126）。
- 后端：`id` 必填（:445）、**禁止重置自己**（:446）、≥6（:449）、目标存在（:453）。
- **绕过点**：无密码复杂度校验，`123456` 前后端均放行；前端不提示「不能重置自己」，用户填完才被拒。
- 后端重置会清 `sessions`/`session_token_hash`/`session_expires_at`（:461-463）→ 目标账号所有设备立即掉线，前端文案未提及。

### 4.3 停用/启用账号 `setUserStatus`（user-manage.js:226-250）

- 前端：仅拦 admin（:228）+ 二次确认。
- 后端：`status` 必须是 `0/1`（:477-478）、禁止操作自己（:479）、admin 停用需另有在岗超管（:484-493）、幂等值拒绝（:495-497）。
- **绕过点**：`status` 由前端 `item.status===1 ? 0 : 1` 推导，前端**无法构造 2/99 等非法值**；但方向判断基于可能过期的列表快照，会导致后端幂等拒绝。
- **无引用检查**：停用账号不影响历史单据的 `created_by` 追溯（authService:470 注释明确设计如此），但**也不检查该账号是否有在途待办**。

### 4.4 建/改商品 `saveProduct`（product-manage.js:235-258）

| 字段 | 前端校验 | 后端校验 | 可否绕过 |
|---|---|---|---|
| `name` | 非空（:238） | 非空（dataService:101,104），**无长度上限、无查重** | **可创建任意多个同名商品**；可提交超长名称 |
| `categoryId` | 非空（:239） | `findCategory(Number(categoryId))` 存在且 `status:1`（:92, :103-104） | 可构造任意 id，查不到即拒；**停用分类被拒** |
| `categoryL1`/`categoryL1Name`/`categoryName`/`supplierName` | 无 | **全部忽略**（:116-118 从分类记录反查） | 无意义传输字段 |
| `unit` | 非空（:240） | 非空（:102,104），**无长度上限** | 可提交超长单位 |
| `manufacturerName` | **wxml 标 `*` 但 JS 不校验** | `|| '默认'` 兜底（:122） | 空值静默变「默认」 |
| `defaultSupplierId` | 无 | 非空时校验存在且启用（:106-112） | 可构造任意 id |
| `spec` | 无 | 仅 trim（:120） | 无限制 |

- **后端查重完全缺失**（dataService:98-137 全文无 duplicate 检查）—— 这是本批 6 类写操作中**唯一没有任何重名保护**的。
- **无价格/数量/金额字段**，前端不涉及金额计算。

### 4.5 商品启停 `toggleProduct`（product-manage.js:260-283）

- 前端：二次确认 + `_submitting` 防重。
- 后端：`productId` 存在性（dataService:142-144），状态自行翻转（:145），**不检查是否被在途订单引用**。
- **绕过点**：`status` 不由客户端决定（后端翻转），前端无法构造非法状态。

### 4.6 建/改供应商 `saveSupplier`（supplier-manage.js:68-89）

| 字段 | 前端校验 | 后端校验 | 可否绕过 |
|---|---|---|---|
| `supplierName` | 非空（:71） | 非空（dataService:153-154）+ **查重用 `.limit(100)`**（:162-167） | **供应商超 100 家后重名静默漏检**（对比 `createStore` 已修复，authService:525-529） |
| `contactName`/`contactPhone`/`remark` | **无** | 仅 `String().trim()`（:157-159） | 可存空电话、超长备注、任意字符 |

- `contactPhone` 用 `type="number"`（wxml:54）**只影响键盘样式，不校验格式**，可输入空串或 `abc`（`type="number"` 在部分设备仍可输入）。
- **供应商档案含联系方式且前端全量展示**（wxml:19 `contactName`/`contactPhone`），而 `getSuppliers` 无角色门禁（已知背景）→ 任何角色可遍历全量供应商联系方式。

### 4.7 供应商启停 `toggleSupplier`（supplier-manage.js:91-115）

- 前端：二次确认 + `_submitting`。
- 后端：存在性 + 自行翻转（dataService:186-190），**不检查是否被价格记录或商品默认供应商引用**。
- 副作用：停用后 `updateProductPrice` 会因 `supplier.status=1` 条件拒绝改价（updateProductPrice:91），前端无提示。

### 4.8 建/改门店 `createStore` / `updateStore`（store-manage.js:54-88）

| 字段 | 前端校验 | 后端校验 | 可否绕过 |
|---|---|---|---|
| `storeName` | 非空（:57）+ `maxlength=30`（wxml:45） | 非空 + `length > 30` 拒绝（authService:520-523, :595-597）+ 重名查重（:526-532 / :606-612） | 前后端一致，无绕过面 |
| `storeCode` | **前端从不发送** | 后端接受并查重（:533-541） | **API 层后门**：本页无暴露面，但云函数仍接受客户端编号 |
| `storeId` | 取自 `editItem.storeId`（:67），**非用户输入** | 必填 + 存在性（:593, :599-604） | 可构造任意 storeId，存在性检查兜底 |

- 门店编号由后端生成 `S + pad(maxSeq+1)`（:543-555），并发撞号重试 3 次（:562-581）—— **前端完全不可控**，符合「编号创建后不可修改」的 UI 承诺（wxml:52）。
- **前端无法构造越权组合**：门店只有名称与状态两个可变维度，且状态翻转由后端执行。

### 4.9 门店启停 `setStoreStatus`（store-manage.js:90-119）

- 前端：二次确认 + `_submitting`。
- 后端：`status` 必须 `0/1`（:626-627）、幂等拒绝（:635-637）、**停用前检查未完结采购单**（:640-648，状态集 7 个）。
- **绕过点**：
  ① **不检查门店是否被账号引用** → 停用后挂在上面的 chef/store_manager 全部登录失败（`getDefaultStore:93-96` 对 STORE_ROLES 返回 null → `login:206-207` 报错）。前后端均无提示，属静默锁人。
  ② 未完结订单检查在后端，前端无预检 → 用户必须点两次才被拒。

### 4.10 改价 / 首次定价 `updateProductPrice`（price-manage.js:125-170, 196-227）

| 字段 | 前端校验 | 后端校验 | 可否绕过 |
|---|---|---|---|
| `newPrice` | `parseFloat` + `isNaN` + `>0`（:127-128, :200-201） | `Number()` + `Number.isFinite` + `>0`（updateProductPrice:76-79） | **精度与上限前后端均无约束**：`0.000001`、`999999999.99` 均可入库；`type="digit"` 不阻止 `1.2.3`（`Number('1.2.3')` → NaN，会被拒） |
| `supplierId`/`productId` | picker 选择，非空校验（:198-199） | 存在性 + `status:1`（updateProductPrice:90-95） | 可构造任意 id；**停用商品/供应商可选但必被拒** |
| `updatedBy` | `userInfo.name`（:133, :214） | **忽略**，强制用 `user.user_id || user._id`（updateProductPrice:126） | 前端展示名不进审计日志，记的是 ID |
| `dryRun` | 改价先发 `true`（:140），正式请求不传 | `=== true` 时只校验计数（:99-101） | 客户端可跳过 dryRun 直接写，无安全影响（权限已在 :70 判定） |
| `effectiveDate` | **前端从不发送** | 默认今天，非今天即拒（updateProductPrice:81-89） | 前端无暴露面；但**云函数仍接受客户端生效日期**，构造未来日期会被 :83-85 拒绝 |

- **前端查重（:204-205）是 UX 而非数据保护**：后端事务会把所有 `is_current=1` 置 0 再插入（:106-129），并发下仍收敛。
- **金额计算全部在后端/结算侧**，本批页面不做任何金额运算。
- **波及面计数有静默降级**：`countInflightOrders` 异常时按 0 返回（updateProductPrice:60-63）→ 前端可能显示「无在途单」而实际有影响。

### 4.11 汇总：可绕过前端直接构造的高危字段

| 风险字段 | 位置 | 危害 |
|---|---|---|
| **`updateUser` 的 `role`（自我降级）** | user-manage.js:201 + authService:393-427 | **唯一超管可把自己降级为 chef，系统锁死且无任何前后端拦截** —— 最高危 |
| **`newPrice` 精度/上限** | price-manage.js:127, :200 | 极小值/极大值入库，影响所有按此价结算的单据 |
| **`createUser.username` 字符集** | user-manage.js:198 + authService:139 | 前端不拦，后端静默小写化，用户认知与入库值不一致 |
| **`saveSupplier` 重名漏检** | dataService:162-167 | 供应商 >100 家后可重复建档，导致价格/商品关联歧义 |
| **`saveProduct` 无重名校验** | dataService:98-137 | 任意重名商品，下单时选择歧义 |
| **`setStoreStatus` 停用带账号的门店** | store-manage.js:91-119 + authService:622-655 | 静默锁死该门店全部 chef/store_manager 的登录 |
| **`createStore.storeCode` 后门** | authService:533-541 | 本页不发，但云函数接受客户端编号（可由非本页客户端调用） |
| **`updatedBy` 审计字段被忽略** | price-manage.js:133 + updateProductPrice:126 | 调价审计记录的是用户 ID 而非姓名，追责链退化 |

---

## 5. 页面间导航与参数传递

### 5.1 全部导航边（本批 7 页产生）

| # | 源方法（位置） | 目标 | API | 携带参数 | 目标页是否消费 |
|---|---|---|---|---|---|
| 1 | `index.goStore` (index.js:119) | `/pages/store-switch/store-switch` | `navigateTo` | 无 | 目标页 `onLoad` **不读 `options`**（store-switch.js:9-10 无参数解构）—— 无需参数，闭合 |
| 2 | `index.openStoreManage` (:123) | `/pages/store-manage/store-manage` | `navigateTo` | 无 | 目标页无 `onLoad`，无参数需求，闭合 |
| 3 | `index.goAccount` (:133) | `/pages/account/account` | `navigateTo` | 无 | 闭合 |
| 4 | `index.goMessages` (:130) | `/pages/message/message` | `switchTab` | 无 | 目标页是 tabBar 页，闭合 |
| 5 | `index.goStatPage` `message` (:159) | `/pages/message/message` | `switchTab` | 无 | 闭合 |
| 6 | `index.goStatPage` `abnormal` (:161) | `/pages/abnormal-list/abnormal-list` | `navigateTo` | 无 | **不可达分支**（`stats` 不产出 `abnormal`，见 3.2） |
| 7 | `index.goStatPage` 其余 (:164-165) | `/pages/purchase-list/purchase-list` | `switchTab` | **借 `app.globalData.pendingListFilter` 传递**（值 ∈ `{submitted, receivable, received, to_verify}`） | **消费端已核对存在**：`purchase-list.js:34-36` 在 `onShow` 读取并清空。链路闭合 |
| 8 | `index.goOrderDetail` (:170) | `/pages/purchase-detail/purchase-detail?id=` | `navigateTo` | `id` = `item.purchaseOrderId` | 闭合（目标页读 `options.id`，目标页未在本批范围，**入参名一致性未逐字验证**） |
| 9 | `index.goReportDetail` (:174) | `/pages/report-detail/report-detail?id=` | `navigateTo` | `id` = `item.reportId` | 同上，**未验证** |
| 10 | `index.goAction` (`data-url`) (:180) | approval-list / product-manage / supplier-manage / price-manage / user-manage | `navigateTo` | 无 | 5 条边全部无参，闭合 |
| 11 | `index.goAction` (`data-taburl`) (:179) | `/pages/report-list/report-list` | `switchTab` | 无 | 闭合 |
| 12 | `index.switchAccount` (:151) | `/pages/login/login` | `reLaunch` | 无 | 闭合 |
| 13 | `index.onShow` supplier 守卫 (:32) | `/pages/supplier-home/supplier-home` | `reLaunch` | 无 | 闭合 |
| 14 | `store-switch.selectStore` (:41) | 上一页 | `navigateBack`（延迟 800ms） | 无 | 无参数，靠 `app.globalData.currentStore` + storage 传值 |
| 15 | `store-switch.onLoad` supplier 守卫 (:15) | `/pages/supplier-home/supplier-home` | `reLaunch` | 无 | 闭合 |
| 16 | `supplier-manage.goProducts` (:119) | `/pages/price-manage/price-manage?supplierId=` | `navigateTo` | `supplierId` | **消费端已核对**：`price-manage.js:26` `onLoad` 读 `options.supplierId` 存入 `this._initialSupplierId`，:60 消费并置空。链路闭合 |
| 17 | `index.onShow` 登录失效兜底 (:25) | `/pages/login/login` | `redirectTo` | 无 | 闭合 |

**参数传递结论**：本批共 17 条导航边，**只有 2 条携带数据**（#7 借全局暂存、#16 借 URL query），两者消费端均已逐行核对闭合。**无「传了参数但目标页不读」的边**。

### 5.2 index 作为 tab 首页与各管理页的刷新关系

**index 是唯一在 `onShow` 无条件重拉的 tab 页**（index.js:21-117），因此：

- 从 `store-switch` `navigateBack` 回首页 → `onShow` 触发 → 4 个云调用全部重发 → 门店名/统计卡/最近单据/未读数全部刷新。**门店切换后的刷新链路成立**（store-switch.js:37-38 写 `currentStore`，index.js:35 读之）。
- 从 `purchase-detail`/`report-detail`/`approval-list` 等详情页返回 → 同样全量重拉。**但 index 无分页/下拉刷新，用户无法手动触发**。

**6 个管理页的刷新关系**（全部为 `onShow` 重拉，**非 tab 页，`navigateTo` 返回时必然触发**）：

| 页面 | `onShow` 重拉 | 自身写操作后是否刷新 | 外部改动后是否感知 |
|---|---|---|---|
| user-manage | 是（:27-28） | `saveUser`:219、`toggleUserStatus`:246 主动 `loadData()`；`saveResetPassword` 后**不刷新**（无需，密码不显示在列表） | 其它设备新建账号 → 返回本页时刷新 ✓ |
| product-manage | 是（:31-32） | `saveProduct`:254、`toggleStatus`:279、`uploadImportFile`:186 均 `loadData()` | ✓ |
| price-manage | 是（:29） | `savePrice`:165、`saveNewPrice`:222 均 `loadData()` | ✓ |
| supplier-manage | 是（:16-17） | `saveSupplier`:85、`toggleStatus`:111 均 `loadData()` | ✓ |
| store-manage | 是（:15-16） | `saveStore`:81、`toggleStoreStatus`:112 均 `loadData()` | ✓ |
| store-switch | **否**（用 `onLoad`，:9） | 唯一写入点 `selectStore` 直接 `setData` | 用户在 store-manage 新建门店后，**已打开的 store-switch 不会感知**（但本页无「返回列表」入口可复用，实际影响低） |

**跨页一致性缺口**：`store-manage` 停用某门店后，`user-manage` 的门店下拉（`getStores` 不带 `includeInactive`，user-manage.js:36）会在下次 `onShow` 时自动收缩候选集，**但已打开的编辑弹窗不会刷新** —— 用户在弹窗里看到的门店列表是打开时的快照（`showEditForm` 直接读 `this.data.stores`，:66-67）。

### 5.3 数据流缺口：`currentStore` 只有本地态

`store-switch.selectStore`（store-switch.js:37-38）写 `app.globalData.currentStore` + `wx.setStorageSync('currentStore')`，**不发任何云调用**。`index.switchAccount`（index.js:147）在退出时清理该键。二者键名一致，无泄漏。

---

## 6. 死代码与未闭合点

### 6.1 无绑定方法（页面级死代码）

1. **`index.js:126 stopBubble()`** —— `index.wxml` 全文无 `catchtap`。
2. **`index.js:160-161 goStatPage` 的 `abnormal` 分支** —— `stats` 取值域不含 `abnormal`。

其余 6 页无此问题；内部方法（`loadData`/`applyFilter`/`importEnvBlocker`/`uploadImportFile`）均有明确调用点。

### 6.2 死变量（`getApp()` 取而未用）

共 **4 处**，全部在异步函数内声明后未使用：

1. `price-manage.js:32` `loadData` 内 `const app = getApp()`
2. `supplier-manage.js:21` `loadData` 内 `const app = getApp()`
3. `supplier-manage.js:75` `saveSupplier` 内 `const app = getApp()`
4. `supplier-manage.js:104` `toggleStatus` 内 `const app = getApp()`

对比：`user-manage.js:130` 的 `const app = getApp()` 同样**未使用**（`saveResetPassword` 只用了 `resetItem`/`resetForm`）—— **实际是 5 处**。检索方式：逐个异步函数体核对 `app.` 出现次数。

（`user-manage.js:33`、`:207`、`store-manage` 与 `store-switch` 的 `getApp()` 均有实际使用，不计入。）

### 6.3 无意义的状态标志 / loading

**本批未发现「定义了从未绑定的 loading 或 hasMore 标志」。** 核查结果：

- 7 页 **全部无 `loading`/`hasMore`/`pageNum` 类 `data` 键**，因此不存在这类死标志。
- **分页全部未启用**：7 页 JSON 均无 `enablePullDownRefresh`，JS 均无 `onPullDownRefresh`/`onReachBottom`/`onPageScroll`。`product-manage`/`supplier-manage`/`price-manage`/`store-manage`/`user-manage` 均为单次全量拉取模式（已知背景所述模式），超量静默丢失。
- **`loading` 用的是 `wx.showLoading` 全局遮罩而非 `data` 标志**，涉及 3 处：`user-manage.js:32/:129/:236`、`store-manage.js:20/:62/:102`。

### 6.4 catch 吞错 / 错误处理不完备

1. **`user-manage.js:41`** `suppliersResult.code !== 0 ? [] : suppliersResult.data` —— **供货商拉取失败被静默降级为空数组**，用户看到的是「暂无启用中的供货商」提示（wxml:107）而非错误，而 `saveUser` 里 supplier 角色又要求必填供应商（:191）→ 形成死锁式的误报体验。
2. **`user-manage.js:51-53`** 失败提示只取 `usersResult.msg || storesResult.msg`，**suppliers 的 msg 永不参与**。
3. **`user-manage.js:31-55 loadData` 无 `try/catch` 且无 `finally`** —— :42 `usersResult.data.map` 若无 null 保护会抛错，:54 `hideLoading()` 永不执行，**loading 遮罩永久卡死**。是全批唯一一处 `showLoading` 无兜底。
4. **`index.js:57-61`** catch 的提示文案固定为「首页数据加载失败」，实际可能是 :45 `user.role` 的 TypeError，**提示与真实原因不符**。
5. **`product-manage.js:149`** `chooseMessageFile` 的 `success` 回调中 `res.tempFiles` 为空时 `return`，**无任何提示**。
6. **`store-switch.js:35`** `stores.find` 未命中时**静默无动作**（用户点击卡片无反应）。
7. **`product-manage.js:104` / `supplier-manage.js:51` / `price-manage.js:111`** 编辑目标 `find` 未命中时静默不弹窗（同类，风险低：数据来自同一 `loadData`）。

### 6.5 输入框约束缺失（无 `maxlength`）

全批 **11 个输入控件无 `maxlength`**：
- `user-manage.js` 对应 wxml:69（username）、:74（name）、:79（password）、:48、:52（resetForm 两字段）—— 5 处
- `product-manage.js` 对应 wxml:79（name）、:100（unit）、:105（spec）、:110（manufacturerName）—— 4 处
- `supplier-manage.js` 对应 wxml:46（supplierName）、:50（contactName）、:54（contactPhone）、:58（remark textarea）—— 4 处
- `price-manage.js` 对应 wxml:54、:89 —— 2 处（数字输入，影响较小）

对比：`store-manage.wxml:45` 的 `maxlength="30"` 与后端校验一致，是全批唯一设了上限的文本输入。

### 6.6 样式死代码（WXSS）

1. **`store-switch.wxss` 7 个类无对应 WXML 节点**：`.page-desc`(3)、`.store-card-header`(23)、`.store-icon`(29)、`.store-content`(34)、`.store-card-info`(58)、`.info-row`(63)、`.info-label`(69)。`store-switch.wxml` 仅 16 行，只用 `page-header`/`page-title`/`store-card`/`store-card-active`/`store-card-name`/`current-badge`/`store-card-code`/`text-sm`/`text-tertiary` → 这 7 个类是旧版「门店卡片带图标与详情行」布局的残留。
2. **`index.wxss:119-177` 整段「新增门店弹窗」样式**（`.modal-mask`/`.modal-content`/`.modal-title`/`.form-field`/`.form-input`/`.form-hint`/`.modal-actions`/`.modal-btn`/`.modal-btn-secondary`/`.modal-btn-primary`，注释明确写着「新增门店弹窗」）—— `index.wxml` **无任何弹窗节点**（wxml:66 注释「快捷操作已删除」）。其中 `.form-label`/`.form-input` 在 `app.wxss:207/213` 有全局定义，故这两条不致渲染异常；`.modal-content`/`.modal-actions`/`.modal-btn*`/`.form-field` **在全局无定义**，是纯残留（共约 59 行死样式）。
3. `user-manage.wxss` / `product-manage.wxss` / `price-manage.wxss` / `supplier-manage.wxss` / `store-manage.wxss` **未发现死类**（逐类比对 wxml 后确认）。

### 6.7 其它不一致

- **`supplier-manage.onSearch` 每次按键发一次云调用**（:37-40 → :39），无防抖；`product-manage`/`price-manage` 同类交互是纯前端过滤。三种策略在同一批管理页内并存。
- **`price-manage.js:88`** `list.sort(...)` 在 `selectedSupplierId` 与 `keyword` 均为空时**原地改写 `this.data.allPrices`** 的顺序（`filter` 未调用，`list` 即 `allPrices` 本身引用）。
- **`user-manage.js:93-95 closeForm`** 不清 `editItem`（对比 `store-manage.js:44-46` 清了），因 `showAdd` 置 false 而无害，但属不一致写法。
- **`product-manage.js:204 stopBubble` 与 `price-manage.js:119`、`supplier-manage.js:62`、`store-manage.js:52`、`user-manage.js:178`** 五处同名空方法，靠 `catchtap` 阻止冒泡；`index.js:126` 同名方法却无绑定（见 6.1）。

---

## 7. 未验证清单

| # | 未验证事项 | 原因 | 建议验证方式 |
|---|---|---|---|
| 1 | `price-manage.onLoad` 中 `reLaunch` 后同页 `onShow` 是否仍执行 | 属微信运行时行为，代码无法确认 | 开发者工具中用未登录态直接进入 `/pages/price-manage/price-manage?supplierId=S001`，观察网络面板是否有 3 个空 token 调用 |
| 2 | `getPurchaseOrders` 是否消费 index 传入的 `createdBy` 与 `pageSize` | 该云函数不在本批读取范围 | 读 `cloudfunctions/getPurchaseOrders/index.js`，核对 `createdBy`/`pageSize` 入参处理 |
| 3 | `getProductPrices({onlyCurrent:true})` 是否有 limit、`data[].price/effectiveDate/isCurrent` 字段名是否与 `normalizePrice` 匹配 | 该云函数不在读取范围 | 读 `cloudfunctions/getProductPrices/index.js` |
| 4 | `importProducts` 的列名解析规则是否与 `showTemplateInfo` 硬编码文案（product-manage.js:198）一致 | 该云函数不在读取范围 | 读 `cloudfunctions/importProducts/index.js` 的表头映射 |
| 5 | `getPurchaseOrders`/`getReports`/`getProducts`/`getSuppliers` 是否存在服务端 limit 导致超量静默丢失 | 未读实现 | 逐云函数核对 `.limit()` |
| 6 | `pendingListFilter='to_verify'` 是否被 `purchase-list` 当作合法 tab | purchase-list 不在本批范围 | 读 `pages/purchase-list/purchase-list.js` 的 tab 集合定义 |
| 7 | `purchaser`/`super_admin` 切到已停用门店后，各云函数对停用 `storeId` 的反应是否统一 | 需逐个云函数核对 | 用超管账号：先在 store-manage 停用某门店，再在该门店上下文下单/看统计 |
| 8 | `wx.chooseMessageFile` 在真机上的 `success` 回调 `tempFiles` 结构 | 需真机 | 真机预览走一次 Excel 导入 |
| 9 | `input type="digit"` 是否允许输入 `1.2.3` | 设备/基础库相关 | 真机输入验证；代码侧 `Number('1.2.3')` 为 NaN，后端会拒 |
| 10 | `input type="number"` 是否允许输入非数字字符（供应商电话） | 设备/基础库相关 | 真机输入验证 |
| 11 | `index.goOrderDetail`/`goReportDetail` 的 `options.id` 在目标页的字段名一致性 | 目标页不在本批范围 | 读两个目标页的 `onLoad` |
| 12 | `purchaser` 角色能否看到 `index.wxml:46/50` 两个超管入口（`isSuperAdmin` 判定为 false 应隐藏） | 需真机/开发者工具切换角色确认渲染 | 用 purchaser 账号登录看首页「管理工作台」是否只有 4 个入口 |
| 13 | 非管理角色（chef/supplier）直接访问 6 个管理页时的实际 UI 表现 | 需真机；代码侧已确认后端全部 403 | 开发者工具中用 chef 账号 `navigateTo` 各管理页，确认只看到空态与误导性 toast |
| 14 | `user-manage` 编辑 admin 改角色时，前端 `showSuccess('保存成功')` 与后端静默改写角色（authService:417-419）的体感 | 需真机 | 编辑 admin → 角色改为「门店下单人员」并选一家门店 → 保存后重新打开确认角色 |
| 15 | `store-switch` 的 800ms 延迟返回中 toast 与导航的时序 | 需真机 | 真机观察切换反馈是否被导航打断 |

**共 15 项未验证**，其中 1、8、9、10、12、13、14、15 需真机/开发者工具，2–7、11 为读其它云函数/页面即可确认。

---

## 8. 行数对账

### 8.1 本批 28 个文件（逐行读取）

| 文件 | 行数 | 文件 | 行数 |
|---|---|---|---|
| pages/index/index.js | 182 | pages/user-manage/user-manage.js | 251 |
| pages/index/index.wxml | 109 | pages/user-manage/user-manage.wxml | 116 |
| pages/index/index.wxss | 177 | pages/user-manage/user-manage.wxss | 161 |
| pages/index/index.json | 3 | pages/user-manage/user-manage.json | 4 |
| pages/product-manage/product-manage.js | 284 | pages/product-manage/product-manage.wxml | 128 |
| pages/product-manage/product-manage.wxss | 62 | pages/product-manage/product-manage.json | 4 |
| pages/price-manage/price-manage.js | 228 | pages/price-manage/price-manage.wxml | 102 |
| pages/price-manage/price-manage.wxss | 56 | pages/price-manage/price-manage.json | 4 |
| pages/supplier-manage/supplier-manage.js | 121 | pages/supplier-manage/supplier-manage.wxml | 67 |
| pages/supplier-manage/supplier-manage.wxss | 35 | pages/supplier-manage/supplier-manage.json | 4 |
| pages/store-manage/store-manage.js | 120 | pages/store-manage/store-manage.wxml | 62 |
| pages/store-manage/store-manage.wxss | 149 | pages/store-manage/store-manage.json | 3 |
| pages/store-switch/store-switch.js | 44 | pages/store-switch/store-switch.wxml | 16 |
| pages/store-switch/store-switch.wxss | 72 | pages/store-switch/store-switch.json | 3 |

**小计：28 个文件，2567 行** —— js 1230 行 / wxml 600 行 / wxss 712 行 / json 25 行（1230+600+712+25 = 2567）。

**行数统计方法**：各文件行数取 `Read` 工具输出的末行号（已逐文件核对，不使用 `Measure-Object -Line`，以规避 Windows 下 `-Line` 少计 15–43 行的已知问题）。报告自身的字节数/行数在交付回复中给出，不在文内自引用以免随编辑漂移。

### 8.2 辅助读取（用于核对契约，非本批结论来源）

| 文件 | 读取范围 | 行数 |
|---|---|---|
| utils/cloud.js | 全文 1-283 | 283 |
| utils/util.js | 全文 1-128 | 128 |
| utils/auth-guard.js | 全文 1-17 | 17 |
| utils/meta.js | 全文 1-68 | 68 |
| app.json | 全文 1-75 | 75 |
| cloudfunctions/authService/index.js | 1-23、24-155、200-283、300-475、470-685 | 约 465（含重复段） |
| cloudfunctions/dataService/index.js | 55-190、651-700、860-904 | 约 178 |
| cloudfunctions/updateProductPrice/index.js | 40-129 | 90 |
| pages/purchase-list/purchase-list.js | grep 命中 34-36 | 3（仅核对消费端） |

