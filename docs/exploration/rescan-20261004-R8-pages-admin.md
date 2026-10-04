# R8 重扫：管理后台前端 7 页（2026-10-04）

> **范围**：`pages/index`、`product-manage`、`price-manage`、`store-manage`、`store-switch`、`supplier-manage`、`user-manage`（各 js/json/wxml/wxss，共 28 文件 2524 行），全读不抽样
> **交叉参照（只读）**：`cloudfunctions/{dataService,authService,getProducts,getProductPrices,updateProductPrice,getSuppliers,getPurchaseOrders,getReports,importProducts}/index.js`、`utils/{cloud,auth-guard,meta,util}.js`、`app.js`、`app.json`、`seed-data/{product,supplier,store,app_user}.json`、`pages/{purchase-create,purchase-list,report-list,receive-list}/` 取 storeId 消费端
> **前置文档**：`full-scan-05-pages-admin.md`（456 行，本批主前置）、`full-scan-01-identity-session.md`、`full-scan-04-cloud-data-product.md`、`full-scan-08-infra-and-data-contract.md`（新增引用）、`controller-horizontal-scan-20261003.md`
> **版本基线**：HEAD = `52683793`（`fix(pages): navigation, permissions, loading states and guard rails`），当前工作区含未提交改动 `pages/report-list/report-list.js`（不在本批边界）与 `project.config.json`（仅加 `packOptions.ignore`，与代码无关）
> **页面改动历史**（`git log --oneline -8` 命中）：`5268379` → `76a840f`（bench bakcup）→ `0c535ba` → `ede7bcb`（Excel 导入）→ `cab6d8a` → `1ea54d6`（user-manage 门店 picker 必填标记）→ `bf02f39` → `b700bcc`
> **方法**：只信代码不信注释；每条结论带 `文件:行号`；旧文档已结案条目不重复展开，只做「仍成立 / 已修复 / 行号漂移 / 无法确认」判定与增量。

---

## 0. 增量摘要

**本次相对 full-scan-05 的实质增量（10 条，其中 1 条 P0、5 条 P1）：**

| # | 级别 | 一句话 |
|---|---|---|
| **N-1** | **P0** | **`dataService` 22 处 + `authService` 8 处 action 把 -401/-403 返回成 `{ error: {...} }` 嵌套结构，`utils/cloud.js:68` 只查顶层 `result.code` → 会话过期时这些页面的任何请求都不触发跳登录**（full-scan-05 只把影响面记在 `index.js:54-55` 与 user-manage/store-manage 的 toast 文案上，未识别为会话失效兜底缺失） |
| N-2 | P1 | `getReports` 对 GLOBAL 角色**完全忽略 event.storeId**（解构于 `getReports:43`，`:49-66` 全程未引用）→ 管理员切门店后首页「最近报表」与整个报表 tab 仍显示全部门店，而同屏 4 张统计卡与「最近采购单」都按门店过滤 |
| N-3 | P1 | `authService.getStores:322-324` 对门店角色强制 `query.store_id = default_store_id` → **chef/store_manager 在 store-switch 只能看到自己那 1 家门店**，full-scan-05 H1 描述的「切到别的门店下单被 -403」路径已不可达，H1 的实际形态变为「单门店用户仍看到『切换 ▸』，进去是无意义的空操作」 |
| N-4 | P1 | **停用门店断链：`setStoreStatus:630-638` 的在途单检查只列 7 个状态，漏 `receipt_abnormal`**；且不检查门店下是否还有活跃账号 → 停用后该店 chef/store_manager 因 `login:206-207` 找不到 status:1 的门店而**集体登录失败**，前端无任何预告 |
| N-5 | P1 | `getProducts:44-45` / `getSuppliers:53-54` 新增 `if (includeInactive && !isManager) return { code: -403 }` 后端守卫，但 `product-manage.js:31,33` 与 `price-manage.js:34,35` 仍硬编码 `includeInactive: true` → 非管理员深链进页时 3 个并发中 2 个 -403，页面停留旧数据 |
| N-6 | P1 | `user-manage.js` 三个写操作（`saveUser:180` / `saveResetPassword:115` / `toggleUserStatus:226`）**全部无 `_submitting` 防重**，5268379 只覆盖了 product/store/supplier-manage；当前靠 `util.showLoading` 的 `mask:true` 副作用兜住 |
| N-7 | P2 | `supplier-manage` UI 与 `saveSupplier` 都**没有 `address` 字段**，但 seed 数据有 → 新建供应商的 address 恒为空串，且无任何入口补录 |
| N-8 | P2 | `price-manage.js:54` 商品被删后价格行显示裸 `productId`（如 `¥4 / P001`） |
| N-9 | P2 | `user-manage.js:42` `usersResult.data.map` 无空数组兜底；`:52` toast 文案取 `usersResult.msg`，对嵌套 `-403` 取到 undefined |
| N-10 | P2 | 7 页中 **0 个有 `enablePullDownRefresh`、0 个有 `onReachBottom`**（已 grep 全 `pages/` 确认），5 个管理列表页均为单次全量拉取 + 服务端硬 limit，超量静默丢失（确认并升级 H5） |

**旧结论复核**：full-scan-05 的 H1 前提已失效（N-3）；H3 的影响面被 N-1 大幅放大；H4/H5/M1/M2/M4/M5/M6/M7/M8/M9/M10/M11/L1-L16 全部**仍成立**，行号无漂移（28 文件当前行数与 full-scan-05 表格逐格一致，2524 行）；`getOrderStats.received` 口径在 `3558678` 已改为与列表「已收货」tab 一致，**首页 5 张卡与 purchase-list 5 个 tab 的口径已对齐**（见 §5）。

---

## 1. 文件清单与全读确认（28 文件 2524 行）

| 路径 | 行数 | 本轮实际读取 | 关键差异 vs full-scan-05 |
|---|---|---|---|
| `pages/index/index.js` | 182 | 全读 | 无变更 |
| `pages/index/index.json` | 2 | 全读 | 无变更 |
| `pages/index/index.wxml` | 109 | 全读 | 无变更 |
| `pages/index/index.wxss` | 176 | 头部 + 全文扫描 | 无变更 |
| `pages/product-manage/product-manage.js` | 250 | 全读 | 无变更 |
| `pages/product-manage/product-manage.json` | 4 | 全读 | 无变更 |
| `pages/product-manage/product-manage.wxml` | 128 | 全读 | 无变更 |
| `pages/product-manage/product-manage.wxss` | 61 | 头部扫描 | 无变更 |
| `pages/price-manage/price-manage.js` | 228 | 全读 | 无变更 |
| `pages/price-manage/price-manage.json` | 4 | 全读 | 无变更 |
| `pages/price-manage/price-manage.wxml` | 102 | 全读 | 无变更 |
| `pages/price-manage/price-manage.wxss` | 55 | 头部扫描 | 无变更 |
| `pages/store-manage/store-manage.js` | 120 | 全读 | 无变更 |
| `pages/store-manage/store-manage.json` | 3 | 全读 | 无变更 |
| `pages/store-manage/store-manage.wxml` | 62 | 全读 | 无变更 |
| `pages/store-manage/store-manage.wxss` | 148 | 头部扫描 | 无变更 |
| `pages/store-switch/store-switch.js` | 44 | 全读 | 无变更 |
| `pages/store-switch/store-switch.json` | 2 | 全读 | 无变更 |
| `pages/store-switch/store-switch.wxml` | 16 | 全读 | 无变更 |
| `pages/store-switch/store-switch.wxss` | 71 | 头部扫描 | 无变更 |
| `pages/supplier-manage/supplier-manage.js` | 121 | 全读 | 无变更 |
| `pages/supplier-manage/supplier-manage.json` | 4 | 全读 | 无变更 |
| `pages/supplier-manage/supplier-manage.wxml` | 67 | 全读 | 无变更 |
| `pages/supplier-manage/supplier-manage.wxss` | 34 | 头部扫描 | 无变更 |
| `pages/user-manage/user-manage.js` | 251 | 全读 | 无变更 |
| `pages/user-manage/user-manage.json` | 4 | 全读 | 无变更 |
| `pages/user-manage/user-manage.wxml` | 116 | 全读 | 无变更 |
| `pages/user-manage/user-manage.wxss` | 160 | 头部扫描 | 无变更 |
| **合计** | **2524** | 28/28 | — |

**生命周期钩子盘点（7 页实测）**：`index:21` / `product-manage:23` / `price-manage:24,29` / `store-manage:14` / `store-switch:9` / `supplier-manage:15` / `user-manage:26` —— 仅 `price-manage` 与 `store-switch` 有 `onLoad`（分别为深链参数与一次性加载），其余 5 页仅 `onShow`。**7 页全部无 `onHide` / `onUnload` / `onPullDownRefresh` / `onReachBottom`**，且 7 个 `.json` 中 **0 个设 `enablePullDownRefresh`**（全 `pages/` 只有 purchase-list / receive-list / approval-list / report-list / report-history 5 页开启）。

---

## 2. 逐页解剖

### 2.1 `pages/index/`（182 + 109 + 176 + 2 = 469 行）

**职责**：门店/用户头、4~5 张统计卡、管理工作台 6 入口、最近采购单 3 条、最近报表 3 条、消息铃铛、退出登录。tabBar 首页（`app.json:44`）。

**`data` 字段清单（`index.js:9-19`，9 个）**：`storeName`、`userName`、`roleLabel`、`stats`、`recentOrders`、`recentReports`、`isSuperAdmin`、`isManager`、`unreadMsg`。wxml 引用全部有源。

**数据流**：无 `onLoad`，全部在 `onShow:21`。三重前置：`authGuard.requireLogin():22` → `app.globalData.isLoggedIn` 复查 + `wx.redirectTo:24-26` → supplier 角色 `reLaunch:31-33`。`storeId` 取 `store.storeId || store.id || ''`（`:37`）。

**4 个云函数 `Promise.all` 并发（`:41-56`）**：

| # | 调用 | 入参 | 期望返回结构 |
|---|---|---|---|
| 1 | `getPurchaseOrders` | `{role, storeId, createdBy, pageSize:3}` | `{code, data:[order...], total, page, pageSize, statusCounts}` |
| 2 | `getReports` | `{role, storeId, reportType:'', relatedDate:''}` | `{code, data:[report...], total, page, pageSize}` |
| 3 | `dataService` | `{action:'getMessages'}` | `{code, data:[message...]}` |
| 4 | `dataService` | `{action:'getOrderStats', storeId}` | `{code, data:{submitted, receivable, received, to_verify}}` |

**统计卡构造（`:80-88`）**：固定 4 张（待处理=submitted / 待收货=receivable / 已完成=received / 需关注=未读消息数），`isManager` 时第 5 张（待核销=to_verify）。

**跳转目标（全部核对 `app.json:2-29` 注册）**：
| 触发 | 方法 | 目标 | 注册 |
|---|---|---|---|
| 门店名 | `goStore:119` | `/pages/store-switch/store-switch` | `app.json:6` |
| 铃铛 / 需关注卡 | `goMessages:129` / `goStatPage:157-159` | `switchTab /pages/message/message` | `app.json:62` |
| 密码设置 | `goAccount:133` | `/pages/account/account` | `app.json:4` |
| 退出 | `switchAccount:135-152` | `reLaunch /pages/login/login` | `app.json:3` |
| 采购审核 / 商品 / 供应商 / 价格 | `goAction:177-181` via `data-url` | 4 个管理页 | `app.json:10,18,19,20` |
| 账号 / 门店管理 | `goAction` / `openStoreManage:122` | `user-manage` / `store-manage` | `app.json:22,23` |
| 异常卡 | `goStatPage:160-161` | `/pages/abnormal-list/abnormal-list` | `app.json:14`（**死分支**，stats 从不产出 `abnormal`） |
| 其余卡 | `goStatPage:162-165` | `switchTab purchase-list` + `pendingListFilter` | 消费端 `purchase-list.js:34-36` |
| 最近采购单 | `goOrderDetail:169` | `purchase-detail?id=` | `app.json:8` |
| 最近报表 | `goReportDetail:173` | `report-detail?id=` | `app.json:17` |
| 查看全部报表 | `goAction:179` via `data-taburl` | `switchTab report-list` | `app.json:56` |

**页面级守卫**：仅 `requireLogin`，**无角色守卫**（与其余 5 个管理页一致）。

**问题**：M2（无 loading/error/空态三态，失败沿用旧数据）、M3（每次 `onShow` 4 并发无节流）、H2（dataService 两个 action 走嵌套结构，见 N-1）、L1（`stopBubble:126` 死代码）、L4（双重登录检查冗余）、L12（chef 的 `createdBy` 是死参数）、N-2（最近报表不受 storeId 影响）。

**NEW · `index.js:110` `userName: user.name` 无判空**：`:29` 取 `user = app.globalData.userInfo`，`:31` 只在 supplier 分支用了 `user &&` 保护；若 `isLoggedIn=true` 而 `userInfo=null`（`app.js:78 clearSession` 与 `validateSessionOnLaunch` 的并发窗口），`:43 user.role` 抛 TypeError → `Promise.all` reject → `:57-60` catch 弹「首页数据加载失败」而非跳登录。低概率但路径存在。

---

### 2.2 `pages/product-manage/`（250 + 128 + 61 + 4 = 443 行）

**职责**：商品增删改（软删=停用）、L1 分类筛选、关键字搜索、Excel 批量导入。

**`data`（`:8-20`，11 个）**：`products`、`filteredProducts`、`activeL1`、`keyword`、`showAdd`、`editItem`、`form`（10 字段）、`categoryL1List`、`categories`、`filteredCategories`、`suppliers`、`importResult`。

**数据流**：仅 `onShow:23`。`loadData:28-63` 三并发：`getProducts{includeInactive:true}` / `dataService.getCategories` / `getSuppliers{includeInactive:true}`。前端派生 `categoryName`/`l1Name`/`supplierName`（`:46-55`）。`applyFilter:75-85` 纯前端（L1 + 仅匹配 `name`）。

**`callFunction` 清单（6 处）**：
| 位置 | action / 函数 | 入参 | 关键消费点 |
|---|---|---|---|
| `:31` | `getProducts` | `{includeInactive:true}` | `result.data` → `normalizeProduct` |
| `:32` | `dataService` | `{action:'getCategories'}` | `result.data.categories` / `.level1`（`dataService:80` 返回 `{level1, categories}`）✓ |
| `:33` | `getSuppliers` | `{includeInactive:true}` | `result.data` → `normalizeSupplier` |
| `:140` | `importProducts` | `{fileID}` | `d.total/inserted/failed/errors` |
| `:209` | `dataService` | `{action:'saveProduct', productId?, ...form}` | `result.code` |
| `:239` | `dataService` | `{action:'toggleProduct', productId}` | `result.data.status` |

**前后端校验对照**：name/category/unit 双端一致；**重名双端都缺**（H4）；停用供应商由后端 `dataService:99-105` 兜住；厂家/品牌 wxml:109 标 `*` 但双端都不校验（M11）。

**问题**：H4、M12（无角色守卫）、L2（`app = getApp()` 未使用 ×2）、L7（`wx:key="index"` 用于字符串数组 `wxml:64`）、L8（提交冗余字段）、L16（保存按钮无 loading 态）、**N-5**（`:31,33` 硬编码 includeInactive 会在非管理员处 -403）。

---

### 2.3 `pages/price-manage/`（228 + 102 + 55 + 4 = 389 行）

**职责**：协议价列表（供应商筛选 + 商品搜索）、改价（dryRun 波及提示两段式）、首次定价。

**`data`（`:7-21`，12 个）**：`priceList`、`allPrices`、`suppliers`、`supplierOptions`、`selectedSupplierId`、`selectedSupplierName`、`keyword`、`showEdit`、`editItem`、`newPrice`、`showAdd`、`products`、`addForm`（5 字段）。

**数据流**：`onLoad:24`（读 `options.supplierId` → `_initialSupplierId`）+ `onShow:29`（**未复查登录态**，L10）。`loadData:31-72` 三并发。

**`callFunction` 清单（5 处）**：
| 位置 | 调用 | 入参 | 返回消费 |
|---|---|---|---|
| `:34` | `getSuppliers` | `{includeInactive:true}` | `normalizeSupplier` |
| `:35` | `getProducts` | `{includeInactive:true}` | `normalizeProduct` |
| `:36` | `getProductPrices` | `{onlyCurrent:true}` | `normalizePrice`；服务端已带 `product_name`/`unit`（`getProductPrices:75-82`），前端再补一次 |
| `:135` | `updateProductPrice` | `{supplierId, productId, newPrice, updatedBy, dryRun:true}` | `probe.data.affectedOrders` ✓ 与 `:97-101` 契约吻合 |
| `:155` / `:210` | `updateProductPrice` | 同上无 dryRun | `result.data.affectedOrders` |

**后端契约核对**：`getProductPrices:51` 对非 super_admin/purchaser 直接 -403 → chef 深链进页时整个「新增价格」与列表全废；`updateProductPrice:70` 同守卫；`updateProductPrice:90-95` 要求供应商与商品 `status:1`。

**问题**：M8（`applyFilter` 原地 sort 污染 `allPrices`）、M9（价格无小数位约束，`wxml:54,89` `type="digit"` + 后端 `:76-79` 仅 `>0`）、L6（`updatedBy` 基本无效，后端 `:126` 优先 `user.user_id`）、L15（价格无 `toFixed(2)`）、L10、**N-5**、**N-8**（`:54` 商品缺失显示裸 productId）。

---

### 2.4 `pages/store-manage/`（120 + 62 + 148 + 3 = 333 行）

**职责**：门店增改 + 软停用/恢复。**本批 7 页中写权限最重的入口**。

**`data`（`:7-12`，4 个）**：`stores`、`showForm`、`editItem`、`form{storeName}`。

**数据流**：仅 `onShow:14` → `loadData:19-29`。`util.showLoading()` + `authService{action:'getStores', includeInactive:1}` + `hideLoading()`。**7 页中唯一两个有 loading 遮罩的列表加载之一**（另一个是 user-manage）。

**`callFunction` 清单（4 处）**：
| 位置 | action | 入参 | 后端守卫 |
|---|---|---|---|
| `:22` | `authService` | `{action:'getStores', includeInactive:1}` | **仅校验登录，无超管校验**（`authService:314-332`） |
| `:65` | `authService` | `{action:'updateStore', storeId, storeName}` | `requireSuperAdmin:581` |
| `:71` | `authService` | `{action:'createStore', storeName}` | `requireSuperAdmin:507` |
| `:103` | `authService` | `{action:'setStoreStatus', storeId, status}` | `requireSuperAdmin:613` |

**前后端校验对照**：名称非空 / 长度 ≤30 双端一致（`wxml:45 maxlength="30"` ↔ `:513,587`）；重名由后端 `:516-522` / `:596-602`（排除自身）兜住；重复启停由 `:625-627` 兜住；停用有在途单由 `:630-638` 兜住（**但漏 `receipt_abnormal`，见 §4**）。

**返回结构注意**：`store-manage.js:25` `this.setData({ stores: res.data || [] })` **不经 `normalizeStore`**，直接消费 `publicStore`（`authService:64-72`）的 `{id, storeId, storeName, storeCode, status}` —— 与 wxml 的 `item.storeId/storeName/storeCode/status` 完全对齐 ✓。这是本批唯一的正向契约样本。

**问题**：H3、**N-4**（停用断链）、**N-1**（4 个 action 全走嵌套 -403）。

---

### 2.5 `pages/store-switch/`（44 + 16 + 71 + 2 = 133 行）

**职责**：选择当前门店，改 `globalData.currentStore` + storage。**纯前端本地状态，不调任何云函数、不写 `app_user.default_store_id`**。

**`data`（`:7`，2 个）**：`stores`、`currentStoreId`。

**数据流**：仅 `onLoad:9`（**非 onShow** → 每次要重新进页面才刷新）。supplier 角色 `reLaunch:14-17`。`getStores`（`:19-21`）**不传 includeInactive**。

**`selectStore:32-43` 只做 3 件事**：写 `globalData.currentStore:37`、`wx.setStorageSync('currentStore'):38`、局部高亮 + toast + 800ms 后 `navigateBack:39-41`。

**NEW · 门店角色的可见性（推翻 full-scan-05 H1 的前提）**：`authService:322-324` 对 `STORE_ROLES`（chef/store_manager）强制 `query.store_id = user.default_store_id` → **门店角色在切换列表里永远只有 1 家门店**。因此：
- H1 描述的「切到别的门店 → `createPurchaseOrder:162-163` 返回 -403」路径**已不可达**；
- H1 描述的「首页/列表/报表 UI 门店名变了但数据仍是默认门店」**对门店角色也不再发生**（切不了）；
- 实际残留问题是：`index.wxml:7` 对单门店用户仍显示「切换 ▸」，点进去看到 1 张带「当前」角标的卡片，切换是空操作 —— **UX 冗余而非数据不一致**。
- 对 super_admin/purchaser 则不同：`getStores` 无 `store_id` 约束，能看到全部门店并可切换，且 `getPurchaseOrders:62` / `dataService:840` 对 GLOBAL 角色生效 storeId → 切换有真实数据效果，**但报表除外（N-2）**。

**问题**：L13（`selectStore` 找不到 store 无 else 分支；`stores` 为空时无空态，`wxml:7` 只剩标题）、**N-3**。

---

### 2.6 `pages/supplier-manage/`（121 + 67 + 34 + 4 = 226 行）

**职责**：供应商增改 + 启停 + 跳该供应商价格页。

**`data`（`:7-13`，5 个）**：`suppliers`、`keyword`、`showAdd`、`editItem`、`form`（4 字段）。

**数据流**：仅 `onShow:15` → `loadData:20-35`。单接口 `getSuppliers{includeInactive:true}`，前端二次过滤含 `supplierName` 与 `contactName`（`:30-33`）。

**`callFunction` 清单（3 处）**：`getSuppliers:22` / `dataService.saveSupplier:76` / `dataService.toggleSupplier:105`。跳转 `goProducts:119` → `price-manage?supplierId=`（消费端 `price-manage.js:26` `_initialSupplierId` ✓ 闭合）。

**问题**：M1（联系人搜索架构性不可达：`onSearch:37-40` 每击键下推 keyword 给后端，而 `getSuppliers:60-62` 的 `db.RegExp` 只作用于 `supplier_name` → 搜联系人永远空态）、M12、L9（电话无位数校验）、**N-1**、**N-5**、**N-7**（无 address 字段）、L5 形态变化（见下）。

**L5 复核定论**：`getSuppliers:45-51` 对 supplier 角色返回自己的档案并硬编码 `product_count: 0` —— 但 `:53-54` 新增的 `if (includeInactive && !isManager) return -403` 会让 supplier 角色**在调用 `getSuppliers({includeInactive:true})` 时直接拿到 -403**，因此「显示『供应 0 个商品』」的形态已不会发生，取而代之是整页 toast「当前账号无权查看停用供应商」+ 空态。缺陷从「假数据」变成「页面失败」，**仍是缺陷**。

---

### 2.7 `pages/user-manage/`（251 + 116 + 160 + 4 = 531 行）

**职责**：账号增改、重置密码、停用/恢复。**本批唯一能改角色与凭据的入口**。

**`data`（`:7-23`，9 个）**：`users`、`showAdd`、`editItem`、`showReset`、`resetItem`、`resetForm`、`form`（9 字段）、`roles`（静态 5 项）、`stores`、`suppliers`。

**数据流**：仅 `onShow:26` → `loadData:31-55`。三并发：`authService.listUsers` / `authService.getStores`（**不传 includeInactive**）/ `getSuppliers{}`。`util.showLoading()` 遮罩。

**`callFunction` 清单（5 处）**：
| 位置 | action | 入参 | 后端守卫 |
|---|---|---|---|
| `:35` | `listUsers` | — | `requireSuperAdmin:342` |
| `:36` | `getStores` | — | **仅登录**（`authService:315`） |
| `:37` | `getSuppliers` | `{}` | 仅登录（`getSuppliers:42`） |
| `:131` | `resetPassword` | `{id, newPassword}` | `requireSuperAdmin:443` + 自检 `:446` |
| `:210` / `:212` | `updateUser` / `createUser` | `{id?, username, name, password, role, roleLabel, defaultStoreId, defaultSupplierId}` | `requireSuperAdmin:394` / `:352` |
| `:237` | `setUserStatus` | `{id, status}` | `requireSuperAdmin:474` + 自检 `:479` + admin 保护 `:484` |

**前后端校验对照**（10 项，见 §3.2）。**关键新核**：`updateUser:417-419` 强制 `effectiveRole = target.username === 'admin' ? 'super_admin' : input.role` 且 `username: target.username === 'admin' ? 'admin' : input.username` → **admin 账号的角色与账号名在后端被钉死，无法被降级**。full-scan-05 的 L14 表述「只护 admin 的 username，不护 name」需修正：**护了 username 与 role，仅 `name`/`mobile` 未护**。

**问题**：M4、M5、M6、M7、L2、L3、L11、L14（修正）、**N-1**（5 个 action 全走嵌套 -403）、**N-6**（三个写操作无 `_submitting`）、**N-9**（`:42` 无空数组兜底 + `:52` toast 取 undefined）。

---

## 3. 写权限矩阵

### 3.1 总表：入口 → 调用 → 云端校验 → 实际可操作角色

| # | 入口（页 + 按钮） | handler | 调用 | 云端校验条件 | 实际能做的角色 |
|---|---|---|---|---|---|
| W1 | product-manage FAB `wxml:56` | `showAddForm` → `saveProduct:199` | `dataService.saveProduct:91` | `requireUser(MANAGEMENT_ROLES):92` | super_admin / purchaser |
| W2 | product-manage 编辑按钮 `wxml:41` | 同上 | 同上（带 `productId`） | 同上 | 同上 |
| W3 | product-manage 启停 `wxml:42` | `toggleStatus:225` | `dataService.toggleProduct:132` | `requireUser(MANAGEMENT_ROLES):133` | 同上 |
| W4 | product-manage Excel 导入 `wxml:15` | `uploadImportFile:132` | `importProducts:52` | `requireUser(MANAGEMENT_ROLES)` | 同上 |
| W5 | price-manage 改价 `wxml:63` | `savePrice:125` | `updateProductPrice:66` | `role in ['super_admin','purchaser']:70` | 同上 |
| W6 | price-manage 首次定价 `wxml:98` | `saveNewPrice:196` | 同上 | 同上 | 同上 |
| W7 | store-manage FAB `wxml:36` | `saveStore:54`（新增） | `authService.createStore:506` | `requireSuperAdmin:507` | **仅 super_admin** |
| W8 | store-manage 编辑 `wxml:23` | `saveStore:65` | `authService.updateStore:580` | `requireSuperAdmin:581` | 仅 super_admin |
| W9 | store-manage 停用/启用 `wxml:24` | `toggleStoreStatus:91` | `authService.setStoreStatus:612` | `requireSuperAdmin:613` | 仅 super_admin |
| W10 | supplier-manage FAB `wxml:37` | `saveSupplier:68` | `dataService.saveSupplier:143` | `requireUser(MANAGEMENT_ROLES):144` | super_admin / purchaser |
| W11 | supplier-manage 启停 `wxml:25` | `toggleStatus:91` | `dataService.toggleSupplier:176` | `requireUser(MANAGEMENT_ROLES):177` | 同上 |
| W12 | user-manage FAB `wxml:38` | `saveUser:180`（新增） | `authService.createUser:351` | `requireSuperAdmin:352` | 仅 super_admin |
| W13 | user-manage 编辑 `wxml:24` | `saveUser:209` | `authService.updateUser:393` | `requireSuperAdmin:394` | 仅 super_admin |
| W14 | user-manage 重置密码 `wxml:25` | `saveResetPassword:115` | `authService.resetPassword:442` | `requireSuperAdmin:443` + `:446` 禁自操作 | 仅 super_admin（且不能是本人） |
| W15 | user-manage 停用/启用 `wxml:26` | `toggleUserStatus:226` | `authService.setUserStatus:473` | `requireSuperAdmin:474` + `:479` 禁自操作 + `:484` 禁 admin | 仅 super_admin（非本人、非 admin） |
| W16 | index 门店切换 `index.wxml:6` | `goStore:119` | 无云函数（纯本地） | 无 | 所有非 supplier 角色 |
| W17 | index 退出登录 `index.wxml:108` | `switchAccount:135` | `authService.logout:269` | 无角色要求（仅清自己会话） | 所有角色 |

**云端角色常量分布**（复核 full-scan-05 §8）：`dataService:8 GLOBAL_ROLES`、`:9 MANAGEMENT_ROLES`（同值重复定义）、`importProducts:8 MANAGEMENT_ROLES`，后端内联字面量 11 处、前端硬编码 7 处 —— **本次未见新增漂移**。

### 3.2 过度授权（前端能点到，但角色不该有）

| # | 现象 | 证据 |
|---|---|---|
| **OA-1** | **purchaser（管理员）可完整浏览门店管理**：`store-manage` 读接口 `authService.getStores:314-332` **只校验登录、不校验超管**，且 `:319-321` 在 `includeInactive` 为真时不设 `query.status` → purchaser 能拿到**全部门店含停用门店及其 store_code**。UI 完整渲染编辑/停用按钮，点下去由 `:581/:613` 的 `requireSuperAdmin` 拒绝，而拒绝是嵌套结构 → 文案被吞成「操作失败」（`store-manage.js:114`） | `authService:314-332` + `store-manage.js:22,114` |
| OA-2 | 5 个管理页零前端角色守卫（H3 仍成立）：`product-manage.js:23-26`、`price-manage.js:29`、`store-manage.js:14-17`、`supplier-manage.js:15-18`、`user-manage.js:26-29` 全只有 `requireLogin` | 对照 `approval-list.js:14` 有页面内守卫 |
| OA-3 | `user-manage` 的角色 picker 允许选「超级管理员」，创建同级超管无二次确认（M7 仍成立）；`createUser:351-391` 后端也不拦 | `user-manage.js:15-21,180-213` |
| OA-4 | `product-manage` 的「默认供应商」picker（`wxml:115`）包含停用供应商（因 `getSuppliers{includeInactive:true}`），管理员可主动给商品指定一个停用供应商 —— 后端 `dataService:99-105` 才拒绝，用户需点保存才看到错误 | `product-manage.js:33` + `dataService:99-105` |
| OA-5 | 超管可编辑 admin 账号的 `name` / `mobile`（`updateUser:420-421` 无 admin 保护） | `authService:417-421` |

### 3.3 授权缺口（角色应该有但入口不存在或被挡住）

| # | 现象 | 证据 |
|---|---|---|
| **GAP-1** | **没有任何入口能修改供应商 `address`**：seed 数据有该字段（`seed-data/supplier.json:1-3`），`supplier-manage.wxml` 只有 4 个字段（名称/联系人/电话/备注），`dataService.saveSupplier:148-153` 也不写 `address` → 新建供应商的 address 恒为空串；编辑时 `update` 只改列出的字段所以不会覆盖旧值，但**无任何入口可补录**。而 `seed-data/product.json` 与 `getSuppliers:87-90` 都透传了该字段，说明它设计上存在 | `supplier-manage.wxml:44-59` + `dataService:148-153` |
| **GAP-2** | **没有「转移超管身份」的显式流程**：admin 账号角色被后端钉死（`updateUser:417`），无法把 admin 的超管身份移交给另一账号；唯一路径是「新建一个 super_admin」+「停掉 admin」。若超管只有一个且密码遗失，其他账号无自救路径（`resetPassword` 只护本人） | `authService:351-391,417,446` |
| GAP-3 | purchaser 无法创建/编辑/停用门店（`requireSuperAdmin`），但 purchaser 在 `getStores` 里能读到全部门店信息（含 store_code）→ 看得见、动不了（OA-1 的反面） | `authService:314-332` vs `:507,581,613` |
| GAP-4 | **停用门店前无法预知账号影响面**：`setStoreStatus:630-638` 只检查在途采购单，不检查门店下是否有活跃 `app_user` → 停用后该店 chef/store_manager 因 `login:206-207`（`getDefaultStore` → `findStore` 要求 `status:1`）而登录失败，无任何预告与列表提示 | `authService:630-638` + `:206-207` + `:93-104` |
| GAP-5 | 停用门店前无法预知 `receipt_abnormal` 状态单据（见 §4） | `authService:632` |

### 3.4 user-manage 自锁风险专项核查

| 场景 | 前端 | 后端 | 结论 |
|---|---|---|---|
| 停用自己 | `user-manage.js:228` 只拦 `username === 'admin'` | `setUserStatus:479` `event.id === auth.user._id` 拒绝 | **后端兜住** ✓ |
| 停用 admin | 前端拦（`:228`） | `setUserStatus:484` `target.username === 'admin'` 拒绝 | **双端一致** ✓ |
| 降级 admin 角色 | 前端不拦 | `updateUser:417` `effectiveRole = target.username === 'admin' ? 'super_admin' : input.role` | **后端兜住** ✓（full-scan-05 L14 表述需修正） |
| 重置自己密码 | 前端不拦 | `resetPassword:446` 拒绝并提示去安全设置 | **后端兜住** ✓ |
| **超管编辑自己并填新密码** | `user-manage.js:209-210` 允许对任意 item 提交 | `updateUser:393-440` **无 `event.id === auth.user._id` 拦截**，`:428-435` 填了密码就清 `sessions` / `session_token_hash` / `session_expires_at` | **仍成立（M4）**：超管自己被踢下线，界面停在账号管理页，无提示。**且叠加 N-1**：若此时会话恰好过期，返回的是嵌套 `{error:{code:-401}}`，`cloud.js:68` 不识别 → 页面只显示「保存失败」 |
| 创建同级超管 | 无二次确认 | `createUser:351-391` 不拦 | **仍成立（M7）** |
| 误删管理员导致无人能管 | 无二次确认（停用按钮无二次弹窗之外的确认） | `setUserStatus` 有确认框但只看 `item.name/username` | 依赖确认框文案，可接受 |

### 3.5 删除语义专项核查

| 数据 | 入口 | 语义 | 证据 |
|---|---|---|---|
| 商品 | `toggleProduct` | **软删**（`status: 1→0` 翻转），历史单据 `product_name_snapshot` 不受影响 | `dataService:138-139` |
| 供应商 | `toggleSupplier` | **软删**，同上 | `dataService:182-183` |
| 门店 | `setStoreStatus` | **软删**，`store_id`/`store_code` 保留，`app_user.default_store_id` 与 `purchase_order.store_id` 追溯链保留 | `authService:641-644` |
| 账号 | `setUserStatus` / `deleteUser` | **软删**，`deleteUser:500-502` 直接转调 `setUserStatus(status:0)`；`user_id`/`username`/`created_by` 追溯链保留 | `authService:489-495,500-502` |
| 价格 | `updateProductPrice` | **不删**：旧行 `is_current:0` 归档，新行插入 | `updateProductPrice:106-131` |

**结论：7 页掌握的所有「删除」入口无一为硬删，误删不可恢复的风险不存在。** 唯一的数据永久销毁点在本批之外：`dataService.verifyManualOrder:1484-1490` 用 `cloud.deleteFile` 删除被替换的旧凭证图（有意为之，有 catch 兜底）。

### 3.6 多门店越权操作专项核查

| 场景 | 结果 |
|---|---|
| chef 为其他门店下单 | **拦**：`createPurchaseOrder:162-163` 强制 `storeId = default_store_id` 并 -403 |
| chef 看其他门店订单 | **拦**：`getPurchaseOrders:54-55` 强制 `store_id + created_by` |
| store_manager 为其他门店下单 | **拦**：同上 `:162-163` |
| store_manager 操作其他门店的手动单核销 | **拦**：`verifyManualOrder:1453-1455` |
| store_manager 看其他门店报表 | **拦**：`getReports:83-86` 二次收敛 `scope_id` |
| chef 看其他门店报表 | **拦**：`getReports:79-82` 二次收敛 |
| super_admin / purchaser 操作任意门店 | **允许**（设计意图，`getStores` 无 store_id 约束） |
| **chef 在 store-switch 切到其他门店** | **无法**：`authService:322-324` 只返回自己那 1 家（N-3） |
| **chef 操作其他门店的门店管理** | **拦（写）不拦（读）**：`getStores` 无超管校验（OA-1）；`createStore/updateStore/setStoreStatus` 全 `requireSuperAdmin` |

**结论：门店维度的越权写入全部被后端拦死；唯一渗漏面是门店档案的「读」（OA-1），以及报表维度的 storeId 被忽略（N-2）。**

---

## 4. 停用门店（inactive store）端到端闭合验证

| 环节 | 代码 | 是否闭合 |
|---|---|---|
| 1. 前端停用操作 | `store-manage.js:103-107` → `authService.setStoreStatus{storeId, status:0}` | ✓ |
| 2. 幂等检查 | `authService:625-627` 返回「该门店已是停用状态」 | ✓ |
| 3. 在途单拦截 | `authService:630-638`，`ACTIVE_ORDER_STATUS = ['draft','submitted','pending_approval','approved','report_generated','partial_received','to_receive']` | **部分 ✗**：漏 `receipt_abnormal`。对比 `cancelOrder:1294` 的列表包含 `receipt_abnormal` → **有收货异常未处理的门店可以被停用，异常处理流程（`startAbnormal:734` / `resolveAbnormal:750`）会在门店停用后继续跑**，而 `getAbnormalRecords:703` 对非 GLOBAL 角色用 `store_id = default_store_id` 过滤 —— 店长账号此时已因门店停用无法登录（见环节 6），异常单无人可处理 |
| 4. 写库 | `authService:641-644` 只改 `status` | ✓ |
| 5. store-switch 不再列出 | `store-switch.js:19-21` 不传 `includeInactive` → `authService:321` 强制 `query.status = 1` → 停用门店不出现在切换列表 | ✓ |
| 6. 该店账号登录 | `login:206-207` → `getDefaultStore:93-104` → `findStore:75-82` 要求 `status:1` → 返回 null → `:207` `{code:-1, msg:'账号未关联有效门店，请联系管理员'}` | **✗ 断链**：chef/store_manager 集体登录失败，**停用前无任何账号影响面检查与预告**（GAP-4） |
| 7. user-manage 账号关联显示 | `user-manage.js:36` 不传 `includeInactive` → `:43` `stores.find` 找不到 → `displayStoreName` 落到 `'全部/无'`（`js:47`） | **✗ 误导**（M6 仍成立）：关联了停用门店的 chef 显示为「关联门店：全部/无」，与真实状态相反；编辑时 picker 预选中项 0 且显示「请选择所属门店」 |
| 8. 下单页 | `purchase-create` 无门店 picker，用 `currentStore`；若超管把 currentStore 切到某门店后该门店被停用，本地 `currentStore` 仍在 → 提交时 `createPurchaseOrder:198-199` 查 `status:1` 失败 | **部分 ✓**：后端拦得住，但**前端 `purchase-create.js:316-324` 无停用预告**，用户填完整单才收到错误 |
| 9. 采购列表 / 报表历史单据 | `getPurchaseOrders` / `getReports` 均只按 `store_id`/`scope_id` 查，**不过滤 store.status** | ✓ 历史单据与报表仍可见（符合预期） |
| 10. 商品/供应商关联 | 商品 `default_supplier_id`、账号 `default_store_id` 均保留原值 | ✓ 追溯链完整 |
| 11. 恢复入口 | `store-manage.js:103-107` `status:1`，无在途单限制（`authService:630` 只在 `status===0` 时检查） | ✓ |

**一句话结论：停用门店链路在第 3、6、7、8 环节断链——`receipt_abnormal` 漏拦、停用后该店账号集体登录失败无预告、user-manage 显示反向误导、下单页无前端预告；核心数据（历史单据/报表/追溯链）保留完整，恢复入口可用。**

---

## 5. 首页数据口径对账

### 5.1 五张卡的数据来源与筛选口径

| 卡片 | 值来源 | 后端口径 | 点击去向 | 与 purchase-list tab 一致性 |
|---|---|---|---|---|
| 待处理 | `statsData.submitted` | `getOrderStats:848` `order_status='submitted'`（+ baseQuery 角色收敛） | `pendingListFilter='submitted'` → purchase-list「已提交」tab | **✓ 一致**（`getPurchaseOrders:86`） |
| 待收货 | `statsData.receivable` | `getOrderStats:849` `order_status in ['approved','report_generated','partial_received','to_receive']` | `receivable` | **✓ 一致**（`getPurchaseOrders:94`，注释明写同口径） |
| 已完成 | `statsData.received` | `getOrderStats:846-850` `order_status='received'`（**无 `verify_status` 过滤**） | `received` | **✓ 一致**（`getPurchaseOrders:88`）。注：full-scan-04/batch1 曾记为 `received && verify_status != 'pending'`，`3558678` 已改为仅 `order_status='received'`，两处已对齐 |
| 需关注 | `messages.filter(m => !m.read).length` | `getMessages:635-639`，`read = !!message.read \|\| read_by.includes(userId)` | 消息页 | ✓ 与 message 页同口径 |
| 待核销 | `statsData.to_verify` | `getOrderStats:852-854` **仅 GLOBAL 角色** `verify_status='pending'` | `to_verify` | **✓ 一致**（`getPurchaseOrders:92`），但见 5.2 |

**baseQuery 角色收敛核对**（`getOrderStats:832-843` vs `getPurchaseOrders:51-66`）：
- chef：`store_id = default_store_id` + `created_by = user_id`（`getOrderStats:834-835`）vs（`getPurchaseOrders:54-55`）**✓ 一致**
- store_manager：`store_id = default_store_id`（`:838`）vs（`:59`）**✓ 一致**
- GLOBAL：`storeId` 生效（`:840`）vs（`:62`）**✓ 一致**

### 5.2 口径不一致清单

| # | 级别 | 现象 |
|---|---|---|
| **D-1** | **P1** | **首页「最近报表」与整个报表 tab 不受门店切换影响**：`getReports:43` 解构 `storeId` 但 `:49-66` 全程未引用，GLOBAL 角色分支（`:61-66`）只吃 `reportScope`。而 `report-list.js:70,75` 明确传 `storeId`，`index.js:50` 也传。→ 管理员切到 S002 后，同屏 4 张卡 + 最近采购单按 S002 过滤，「最近报表」与报表 tab 仍显示**全部门店**报表，`scopeName` 会显示 S001/S003 的报表。这是「显示与数据不一致」的活样本，与 N-3 是同一病灶的两侧 |
| **D-2** | P2 | **「待核销」卡在真实数据上恒为 0**：`verify_status='pending'` 全项目唯一写入点是 `dataService:1466-1477`（人工提交付款凭证时），收货流程 `createReceipt` 从不写 `verify_status` → 手动单收齐后停在 `order_status='received'` + `verify_status='none'`，**同时计入「已完成」又不进「待核销」**，管理员的催办卡片永远空。已在 `full-scan-08:522-525` 结案为 H-4，此处从首页消费端确认其可见影响 |
| D-3 | P2 | 首页「最近采购单」对 chef 传的 `createdBy = user.userId \|\| user.id \|\| user.name`（`index.js:45`）是死参数（`getPurchaseOrders:55` 强制用 `user_id`），但对 GLOBAL 角色 `createdBy` **会被采信**（`:63`）；`index.js:45` 对 GLOBAL 角色传的是空串所以不触发。当前无错，但后端一旦改动口径即错（L12） |
| D-4 | P3 | 首页统计走服务端聚合（正确），但 `getPurchaseOrders` 在首页也带了 `pageSize:3`，导致**为 3 条列表多算了 9 个 count**（`getPurchaseOrders:84-95`）。首页单次进入 = 4 个云函数 + 13 个 count，无节流（M3） |

### 5.3 `onShow` 重复请求

首页是 tabBar 页，每次切回 tab 都重跑 `onShow`（`index.js:21`）→ 4 个云函数全并发、无缓存、无节流（M3 仍成立）。叠加 `getPurchaseOrders:84-95` 的 9 个 count 与 `getOrderStats:847-855` 的 4 个 count，**单次切回首页 ≈ 4 次云函数调用 + 13 次数据库 count**。对照 `purchase-list.js:41` 有 `onPullDownRefresh` 但同样无节流。

---

## 6. 前后端契约比对 + 导航闭环核对

### 6.1 `callFunction` 解构路径 vs 云函数实际返回路径（28 处，逐条）

| 页 | 调用 | 前端解构路径 | 后端实际返回 | 判定 |
|---|---|---|---|---|
| index:42 | getPurchaseOrders | `ordersResult.data` | `{code, data, total, page, pageSize, statusCounts}` | ✓ |
| index:48 | getReports | `reportsResult.data` | `{code, data, total, page, pageSize}` | ✓ |
| index:54 | dataService.getMessages | `messagesResult.data` | `{code, data}` | ✓（但 -403/-401 为**嵌套**，见 N-1） |
| index:55 | dataService.getOrderStats | `statsResult.data.{submitted,receivable,received,to_verify}` | 同名 ✓ | ✓（同上嵌套风险） |
| product:31 | getProducts | `productResult.data` | `{code, data}` | ✓ |
| product:32 | dataService.getCategories | `categoryResult.data.categories` / `.level1` | `dataService:80` `{code, data:{level1, categories}}` | ✓ 双层结构对齐 |
| product:33 | getSuppliers | `supplierResult.data` | `{code, data}` | ✓ |
| product:140 | importProducts | `d.total/inserted/failed/errors` | ✓ | ✓ |
| product:209 / 239 | dataService | `result.code` / `result.data.status` | 成功 `{code:0, data:{...}}`；**失败 `{error:{code,msg}}` 嵌套** | **⚠ undefined 风险** |
| price:34/35/36 | 三个 get* | `.data` | ✓ | ✓ |
| price:135 | updateProductPrice dryRun | `probe.data.affectedOrders` | `updateProductPrice:100` `{code:0, data:{dryRun, affectedOrders}}` | ✓ |
| price:155/210 | updateProductPrice | `result.data.affectedOrders` | `:133` `{code:0, data:{priceId, affectedOrders, message}}` | ✓ |
| store-manage:22 | authService.getStores | `res.data` → 直接 setData | `{code, data:[publicStore]}` | ✓ **不经 normalize，直接消费 publicStore**，字段与 wxml 全对齐 |
| store-manage:65/71/103 | authService | `res.code` / `res.msg` | 成功扁平 ✓；**失败嵌套** | **⚠ undefined 风险** |
| store-switch:19 | authService.getStores | `result.data` | 扁平 `{code, data}`（`authService:316,331` 是扁平返回） | ✓ 唯一无嵌套风险的 authService 读接口 |
| supplier-manage:22/76/105 | getSuppliers / dataService | `.data` / `result.code` | ✓ / **嵌套** | **⚠** |
| user-manage:35 | authService.listUsers | `usersResult.code` / `.data` | 成功扁平；**-403 嵌套 `{error:{code:-403,msg:'仅超级管理员可以管理账号'}}`** | **⚠ `usersResult.msg` 为 undefined**（N-9） |
| user-manage:36 | authService.getStores | `storesResult.data` | 扁平 ✓ | ✓ |
| user-manage:37 | getSuppliers | `suppliersResult.code` | 扁平 ✓ | ✓ |
| user-manage:131/210/212/237 | authService | `res.code` / `res.msg` | **全嵌套** | **⚠** |

**undefined 风险汇总**：
1. **嵌套结构（P0）**：`dataService` 22 处 `if (auth.error) return auth.error`（`:56,93,134,145,178,484,614,645,667,699,736,752,804,829,872,990,1037,1107,1281,1337,1385,1442`）+ `authService` 8 处（`:343,353,395,444,475,508,582,614`）共 **30 个 action** 的 -401/-403 返回 `{ error: { code, msg } }`，无顶层 `code`。`utils/cloud.js:67-70` 只做 `if (result.code === -401) handleSessionExpired()` → **嵌套 -401 不触发跳登录**，前端拿到 `result.code === undefined` → 一律走 `result.msg \|\| '通用文案'` 分支，真实原因被吞。影响 W1-W6、W10-W15 全部写操作与 `index:54-55`。
2. **`_id` 字段**：本批前端**从不直接读 `_id`**（`user-manage` 用 `item.id`，后端 `publicUser:51` 已映射 `id: user._id`；`store-manage` 用 `storeId`，`publicStore:68` 已映射）。✓ 无风险。
3. **批量 limit 100 默认值**：`getSuppliers:67 limit(100)`、`authService.listUsers:346 limit(100)`、`getStores:329 limit(100)`、`getProducts:53 limit(200)`、`getProductPrices:60 limit(200)`、`getReports:89 pageSize max 50`。**5 个管理列表页均不传分页参数、无 `total` 消费、无截断提示**（H5 仍成立）。`user-manage` 的 `users.length`、`store-manage` 的 `stores.length` 等「共 N 个」计数都是**截断后**的数字。

### 6.2 导航闭环核对

**跳转目标 vs `app.json:2-29` 注册**：7 页共 13 个跳转目标，全部已注册 ✓。逐个 `navigateTo` 参数名核对：

| 跳转 | URL | onLoad 消费 | 判定 |
|---|---|---|---|
| `index.js:119` | `/pages/store-switch/store-switch` | `store-switch.js:9 onLoad()` 无参数 | ✓ |
| `index.js:123` | `/pages/store-manage/store-manage` | `store-manage.js:14 onShow()` 无参数 | ✓ |
| `index.js:170` | `purchase-detail?id=` | `purchase-detail` 读 `options.id` | ✓ |
| `index.js:174` | `report-detail?id=` | 读 `options.id` | ✓ |
| `index.wxml:30/34/38/42/46` `data-url` | approval-list / product-manage / supplier-manage / price-manage / user-manage | 目标页 `onShow`/`onLoad` 均无参数 | ✓ |
| `index.wxml:94` `data-taburl` | `switchTab /pages/report-list/report-list` | tabBar 页，正确用 switchTab | ✓ |
| `supplier-manage.js:119` | `price-manage?supplierId=` | `price-manage.js:24-26` `options.supplierId` → `_initialSupplierId`，`:60` 消费后 `:62` 清空 | **✓ 完整闭合** |
| `index.js:164-165` | `switchTab purchase-list` + `pendingListFilter` | `purchase-list.js:34-36` 读并清空 | ✓ |

**事件绑定 × js 方法对照**：7 页共 62 处绑定，**0 处对不上**（复核 full-scan-05 §0 结论仍成立）。**`data-` 属性名 × handler 读取名**：11 处 `data-` 使用（`data-url`/`data-taburl`/`data-status`/`data-id`×7/`data-item`×5/`data-field`×2/`data-value`×3）与 handler 中的 `dataset.*` 读取**全部一致** ✓。

---

## 7. 旧结论复核表 + 【待核实】回收表

### 7.1 full-scan-05 结论复核

| 编号 | 结论 | 当前判定 | 证据 |
|---|---|---|---|
| **H1** | 门店切换对门店角色实质失效，与后端门店收敛口径冲突 | **⚠ 前提失效，需改写** | `authService:322-324` 让门店角色只能看到自己 1 家门店 → 「切到别的门店下单被 -403」不可达；「UI 变了数据没变」对门店角色也不发生。残留问题降级为 UX 冗余（单门店用户仍看到「切换 ▸」）。**但对 GLOBAL 角色，H1 的第二个症状仍存在（D-1）** |
| H2 | 首页消费 dataService 两个 action，会话过期不跳登录 | **✓ 成立且被大幅放大** | 升级为 N-1：不止首页 2 处，是 30 个 action 全链路；`cloud.js:68` 只查顶层 code |
| H3 | 5 个管理页零前端角色守卫 + 嵌套错误吞文案 | **✓ 成立** | 5 个 `onShow` 行号无漂移；OA-1 给出具体渗漏面（purchaser 可读全部门店含停用） |
| H4 | `saveProduct` 无重名检测（双端都缺） | **✓ 成立** | `dataService:91-130` 全函数无 duplicate 查询 |
| H5 | 5 个列表接口硬编码 limit，无分页无总数 | **✓ 成立并升级** | N-10：确认 7 页 0 个 `enablePullDownRefresh`、0 个 `onReachBottom` |
| M1 | 供应商联系人搜索永远搜不到 | **✓ 成立** | `getSuppliers:60-62` `db.RegExp` 仅作用于 `supplier_name` |
| M2 | 首页无三态，失败沿用旧数据 | **✓ 成立** | `index.js:62-65` |
| M3 | 首页每次 onShow 并发 4 个云函数 | **✓ 成立** | `index.js:41-56` + 13 个 count |
| M4 | 超管可编辑当前登录账号并清自己会话 | **✓ 成立，叠加 N-1 更隐蔽** | `authService:393-440` 无自检；`updateUser:428-435` 清 sessions |
| M5 | `user-manage.loadData` 忽略 `suppliersResult.code` | **✓ 成立** | `user-manage.js:39-41` |
| M6 | getStores 不传 includeInactive → 停用门店显示反向误导 | **✓ 成立**，是 §4 断链环节 7 | `user-manage.js:36,43,47` |
| M7 | 创建同级超管无二级确认 | **✓ 成立** | `user-manage.js:15-21,180-213` + `createUser:351-391` 不拦 |
| M8 | `applyFilter` 原地 sort 污染 `allPrices` | **✓ 成立** | `price-manage.js:76,88` |
| M9 | 价格无小数位约束（双端都缺） | **✓ 成立** | `price-manage.wxml:54,89` + `updateProductPrice:76-79` |
| M10 | 4 个管理页无 loading 态 | **✓ 成立** | product/price/supplier-manage + store-switch 均无 `util.showLoading` |
| M11 | 厂家/品牌标必填但不校验 | **✓ 成立** | `product-manage.wxml:109` + `dataService:115` 兜底 `'默认'` |
| L1 | `index.js:126 stopBubble` 死代码 | **✓ 成立** | `index.wxml` 无 `catchtap` 引用 |
| L2 | `const app = getApp()` 未使用 | **✓ 成立** | product:208,238 / supplier:21,75,104 / price:32 / user:33,130,207 |
| L3 | `showAddForm` 未初始化 index | **✓ 成立** | `user-manage.js:57-61` |
| L4 | 双重登录检查冗余 | **✓ 成立** | `index.js:22-27` |
| L5 | supplier 角色 `product_count:0` 假数据 | **✓ 成立但形态变化** | 新增 `getSuppliers:53-54` 守卫后变成「整页 -403」而非「显示 0」 |
| L6 | `updatedBy` 基本无效 | **✓ 成立** | `updateProductPrice:126` 优先 `user.user_id` |
| L7 | `wx:key="index"` 用于字符串数组 | **✓ 成立** | `product-manage.wxml:64` |
| L8 | 提交冗余字段 | **✓ 成立** | `product-manage.js:209-215` vs `dataService:107-117` |
| L9 | 电话无位数校验 | **✓ 成立** | `supplier-manage.wxml:54` + `dataService:151` |
| L10 | price-manage onShow 未复查登录态 | **✓ 成立** | `price-manage.js:29` |
| L11 | 前端不校验账号格式 | **✓ 成立** | `user-manage.js:182` vs `authService:139-141` |
| L12 | chef 的 createdBy 是错误匹配隐患 | **✓ 成立** | `getPurchaseOrders:55` 强制 user_id |
| L13 | store-switch 无 else、无空态 | **✓ 成立** | `store-switch.js:32-43` + `wxml:7` |
| **L14** | authService 只护 admin 的 username，不护 name | **⚠ 表述需修正** | `updateUser:417-419` 同时护了 `username` 与 `role`（`effectiveRole` 强制 super_admin），**仅 `name`/`mobile` 未护**（`:420-421`）。原表述低估了后端保护力度 |
| L15 | 价格无 `toFixed(2)` | **✓ 成立** | `price-manage.wxml:30,31,49` |
| L16 | 保存按钮无 loading/disabled 态 | **✓ 成立**，并新增 N-6（user-manage 连 `_submitting` 都没有） | 5 个弹窗按钮 |

**5268379 合并情况与回归检查**：commit 说明列了 10 项改动，命中本批 3 页（product-manage +58 / store-manage +81 / supplier-manage +56 的 `_submitting` 与确认框）。回归确认：
- product-manage `saveProduct:200,206,221` / `toggleStatus:226,236,247` ✓ 到位
- store-manage `saveStore:55,60,86` / `toggleStoreStatus:92,100,117` ✓ 到位
- supplier-manage `saveSupplier:69,73,87` / `toggleStatus:92,102,113` ✓ 到位
- **user-manage 未覆盖** → N-6
- **price-manage 的 `savePrice:129-169` 与 `saveNewPrice:206-227` 仍是逐分支手写 `_submitting = false` 而非 `try/finally`**，与 5268379 的写法不一致（product/store/supplier 三个页都改成了 `try/finally`）→ 风格回归不彻底，但 `cloud.callFunction` 内部吞异常故不会永久卡死

### 7.2 【待核实】回收

| # | 原待核实项 | 本轮结论 |
|---|---|---|
| 1 | `getPurchaseOrders` 解构 `role` 但未使用，是死参数 | **✓ 结案**：`getPurchaseOrders:43` 解构 `role`，`:49-66` 全程只用会话 `user.role`，`:70-77` 用 `isGlobal`。死参数确认。前端 `index.js:43`、`purchase-list` 都在传 |
| 2 | chef 的 `createdBy` 被后端忽略 | **✓ 结案**：`getPurchaseOrders:55` 强制 `user.user_id \|\| user._id`。对 GLOBAL 角色 `:63` 会采信前端 `createdBy` |
| 3 | `getReceipts` 的 storeId 死参数 | **→ 移交批 2**（不在本批边界） |
| 4 | `getReports` 的 `reportType`/`relatedDate` 空串等价性；`getOrderStats.storeId` 对 GLOBAL 是否生效 | **✓ 结案**：`getReports:73-77` 用 truthy 判断，空串等价于不传 ✓；`getOrderStats.storeId` 对 GLOBAL **生效**（`dataService:840`）✓；**但 `getReports.storeId` 对 GLOBAL 完全不生效**（N-2/D-1） |
| 5 | `purchase-create` 门店读取边界 | **✓ 结案**：无门店 picker，仅 `purchase-create.js:316-324` 提交时读 `currentStore` |
| 6 | 门店角色是否应允许跨门店操作（产品拍板） | **✓ 技术侧结案**：后端已把门店角色钉死在 `default_store_id`（下单/列表/报表/统计 4 处），且 `getStores:322-324` 只返回自己 1 家 → **实际口径已是「不允许跨门店」**。剩余是产品需决定是否保留 store-switch 对门店角色的入口（UX 问题） |
| 7 | 嵌套 `{error:{...}}` 与 `cloud.js:68` 的冲突影响面 | **✓ 结案并大幅扩展**：见 N-1，共 30 个 action |
| 8 | `getStores` 不传 includeInactive 是否为有意约束 | **✓ 结案**：`user-manage`（M6）与 `store-switch` 的意图不同。store-switch 不传是**有意**（停用门店不可选）；user-manage 不传是**无意识副作用**（该页仅超管可见，无越权风险，`includeInactive:1` 是纯收益，见 M6 建议） |
| 9 | `importProducts` 模板说明与 `saveProduct` 校验口径一致性 | **✓ 结案**：`importProducts:11-19` 的 `HEADER_ALIASES` 含 `manufacturerName`（'厂家','厂家/品牌','品牌'），与 `saveProduct:115` 的 `'默认'` 兜底一致；模板说明（`product-manage.js:162`）「名称/分类/单位必填」与后端一致，厂家非必填 ✓ |
| 10 | ES2020 语法禁用约束 | **✓ 结案**：28 文件 0 处 `?.` / 0 处 `??`（本轮通读确认）；工作区未提交的 `report-list.js` 改动正是把 `?.` 改为手写判空，说明该约束仍在被遵守 |

---

## 8. 新问题清单

### P0

**N-1 · 会话失效兜底缺失：30 个 action 的 -401 被嵌套结构吞掉，不触发跳登录**
- 位置：`dataService/index.js` 22 处 `if (auth.error) return auth.error`（`:56,93,134,145,178,484,614,645,667,699,736,752,804,829,872,990,1037,1107,1281,1337,1385,1442`）；`authService/index.js` 8 处（`:343,353,395,444,475,508,582,614`）；消费端 `utils/cloud.js:67-70`
- 触发：会话过期后（7 天 TTL，`authService:13`）在任一管理页做任何写操作，或首页切回 tab
- 影响：① 不触发 `handleSessionExpired` → 用户不会被带去做登录，页面停留在已过期状态继续尝试操作；② `result.code` 为 undefined → 前端一律走 `result.msg \|\| '通用文案'`，真实原因（-401/-403）被吞成「商品保存失败」/「操作失败」/「账号数据加载失败」；③ 影响 W1-W6、W10-W15 全部写入口与 `index:54-55`。**这是全项目最严重的横向缺陷**，本批 7 页是其主要受害面
- 建议：后端把 `auth.error` 拍平为 `{ code: err.code, msg: err.msg }`（或前端 `cloud.js:67-70` 增加 `result.error` 分支：`const result = res.result || {}; if (result.code === -401 || (result.error && result.error.code === -401)) handleSessionExpired(); if (result.error) return result.error`）

### P1

**N-2 · `getReports` 对 GLOBAL 角色忽略 `storeId`，报表维度与订单维度口径分裂**
- 位置：`getReports/index.js:43`（解构）与 `:61-66`（GLOBAL 分支只吃 `reportScope`）；消费端 `report-list.js:70,75`、`index.js:50`
- 触发：super_admin / purchaser 在 store-switch 切到某门店后看报表
- 影响：订单类数据（4 张卡 + 最近采购单 + 采购列表）按门店过滤，报表类数据（首页最近报表 + 整个报表 tab）显示全部门店 → 顶栏门店名与数据不一致；D-1
- 建议：`getReports` GLOBAL 分支补 `if (storeId) query.scope_id = storeId`（注意 scope 可能是 supplier，需按 `reportScope` 分流），或明确产品意图为「管理员报表不随门店切换」并去掉前端的 storeId 传参与报表页的门店提示

**N-3 · 门店角色在 store-switch 只有 1 家门店，「切换」是空操作**
- 位置：`authService:322-324`；`index.wxml:7` 对所有非 supplier 角色显示「切换 ▸」
- 影响：chef/store_manager 点「切换 ▸」进去只看到自己那 1 家带「当前」角标的卡片，无任何可切目标；`store-switch.js:32-43` 选中后 toast「已切换到 X」并返回，实际什么都没变
- 建议：`index.js:119 goStore` 对 `STORE_ROLES` 不显示「切换 ▸」文案（或改成只读门店信息）；或 `store-switch` 在 `stores.length <= 1` 时给一句「当前账号仅关联一家门店」的空态

**N-4 · 停用门店断链：`receipt_abnormal` 漏拦 + 无账号影响面检查**
- 位置：`authService:630-638`（在途单列表漏 `receipt_abnormal`，对比 `dataService:1294` 的列表包含）；`:206-207` + `:93-104`（停用后该店账号登录失败）
- 触发：超管停用一家有收货异常单据、或仍有活跃 chef/manager 账号的门店
- 影响：① 异常单在门店停用后无人可处理（店长登录不了）；② 该店所有账号登录失败且停用前无任何预告；③ 超管看不到「这个门店下还有 N 个账号」
- 建议：`ACTIVE_ORDER_STATUS` 补 `receipt_abnormal` 并抽成共享常量；停用前 count `app_user where default_store_id = X and status = 1` 并提示账号数

**N-5 · 后端新增 `includeInactive` 守卫，前端 3 个页面硬编码不匹配**
- 位置：`getProducts:44-45`、`getSuppliers:53-54`（新增守卫）；`product-manage.js:31,33`、`price-manage.js:34,35`（硬编码 `includeInactive: true`）
- 触发：chef/store_manager/supplier 通过深链（如从 store-manage 被拦后重试、或手动输路径）进入 product-manage / price-manage
- 影响：3 个并发中 2 个返回扁平 -403「当前账号无权查看停用商品/供应商」→ 页面 toast 该文案但**列表仍是旧数据**（`loadData` 在 `:35-38` / `:38-41` 直接 return，不 setData）
- 建议：要么 5 个管理页 `onShow` 加角色守卫 + `navigateBack`（与 OA-2 一并解决），要么这两页改为 `includeInactive: isManager`

**N-6 · `user-manage` 三个写操作无 `_submitting` 防重，5268379 未覆盖**
- 位置：`user-manage.js:180 saveUser` / `:115 saveResetPassword` / `:226 toggleUserStatus`
- 现状：靠 `util.showLoading`（`util.js:72-73` `mask: true`）的遮罩副作用兜住连点，非显式防重；且三个函数**均未用 `try/finally`**（`hideLoading` 在 `:215,136,242` 手写，若 `cloud.callFunction` 之外的语句抛错则 loading 卡死）
- 影响：与 product/store/supplier-manage 的保护方式不一致；`showConfirm` 期间无遮罩，双击确认框的「确认重置」可能提交两次（后端 `resetPassword` 无幂等但重复设置密码是幂等语义，实际无损）
- 建议：与其余 4 页对齐 `_submitting` + `try/finally`

### P2

**N-7 · 供应商 `address` 字段无入口（授权缺口 GAP-1）**
- 位置：`supplier-manage.wxml:44-59`（只有 4 字段）、`dataService:148-153`（不写 address）；对照 `seed-data/supplier.json:1-3` 有 address、`getSuppliers:87-90` 透传
- 影响：新建供应商 address 恒为空串，且永远无法补录；编辑时不会被覆盖（`update` 只改列出的字段）

**N-8 · price-manage 商品被删后价格行显示裸 productId**
- 位置：`price-manage.js:54` `productName: product ? product.name : price.productId`；`wxml:25` 直接渲染
- 影响：商品被停用后被 `getProductPrices` 仍返回（`:55` 只查 `is_current`，不 join 商品状态），前端本地 map 查不到（因 `getProducts:47` 过滤了 `status:1`）→ 显示 `¥4 / P001`

**N-9 · `user-manage.loadData` 的健壮性缺口**
- 位置：`user-manage.js:42` `usersResult.data.map(...)` 无 `|| []` 兜底；`:52` `util.showToast(usersResult.msg || storesResult.msg || '账号数据加载失败')`
- 影响：`:42` 若 `data` 为 undefined 会抛 TypeError（当前 `listUsers:348` 总是返回数组，属潜伏）；`:52` 对嵌套 -403 取 `usersResult.msg` 得 undefined → 落到「账号数据加载失败」，与真实原因「仅超级管理员可以管理账号」不符

**N-10 · 7 页 0 个下拉刷新、0 个触底加载，5 个列表页无分页**
- 位置：全 `pages/` grep 确认 `enablePullDownRefresh` 只出现在 purchase-list / receive-list / approval-list / report-list / report-history 5 页；7 个管理页 `.json` 均无该配置，js 中 0 个 `onPullDownRefresh` / `onReachBottom`
- 影响：管理页数据只能靠离开页面再进来刷新；超量数据静默丢失（H5）

**D-2 · 首页「待核销」卡在真实数据上恒为 0**
- 位置：`dataService:852-854` 计数 `verify_status='pending'`；该状态唯一写入点 `dataService:1466-1477`（人工提交凭证）；`createReceipt` 从不写 `verify_status`
- 影响：手动单收齐后停在 `order_status='received'` + `verify_status='none'`，同时计入「已完成」又不进「待核销」，管理员催办卡片永远空（`full-scan-08:522-525` H-4 的消费端确认）

**NEW · `index.js:110` `userName: user.name` 无判空**
- 位置：`index.js:29` 取 `user`，`:31` 只在 supplier 分支保护，`:43 user.role` 未保护；对照 `app.js:78` `clearSession` 与 `:48-70` `validateSessionOnLaunch` 的并发窗口
- 影响：`isLoggedIn=true` 且 `userInfo=null` 时抛 TypeError → catch 弹「首页数据加载失败」而非跳登录。低概率

### P3

- **NEW · `price-manage.js:69`** 深链 `supplierId` 不在列表时（供应商被删/停用）`selectedSupplierName` 显示裸 id：`selectedSupplier ? selectedSupplier.supplierName : (selectedSupplierId || '全部供应商')`
- **NEW · `getPurchaseOrders:43` 死参数 `role`** + `index.js:43` 与 `purchase-list` 都在传 —— 前端误以为后端读该参数
- **NEW · `store-manage.js:81,112` 与 `supplier-manage.js:85`** `this.loadData()` 未 `await`（product-manage `:219,245` 已 await）→ `_submitting` 在 finally 中提前复位，防护窗口不含 reload
- **NEW · 7 页的 `app = getApp()` 死代码共 7 处**（L2 已列），`user-manage.js:130,207` 尤其明显（`saveResetPassword` / `saveUser` 内取 app 但从未使用）
- **NEW · `user-manage.wxml:107`** 「暂无启用中的供货商，请先在供应商管理中创建」仅在 `form.role === 'supplier'` 时显示（`wxml:100` 的 `wx:if` 内），而 `saveUser:191-192` 的校验在所有角色切换后才触发 → 若用户先选 chef 再切 supplier 但未选供应商，会看到 toast 而非该提示。轻微
- **NEW · `product-manage.js:162` 模板说明称「名称/分类/单位必填」，但 `importProducts` 实际是否校验需以 `importProducts:11-19 HEADER_ALIASES` 为准** —— 本轮未逐行核 `importProducts` 的必填判定逻辑（已核列名映射），标【待核实】

---

## 9. 遗留【待核实】

| # | 待核实内容 | 去哪里找 |
|---|---|---|
| 1 | `importProducts` 的必填校验逻辑与模板说明是否完全一致（本轮只核了 `HEADER_ALIASES:11-19` 的列名映射，未逐行核错误行生成逻辑） | `cloudfunctions/importProducts/index.js:60-209` |
| 2 | `getReports.storeId` 对 GLOBAL 角色失效（N-2）究竟是「漏实现」还是「管理员报表本就该全部门店」—— 需产品拍板；两种修法成本差异大 | 产品确认 |
| 3 | `store-switch` 对门店角色是否保留入口（N-3）—— 取决于产品是否希望门店角色感知「自己只有一家店」 | 产品确认 |
| 4 | 停用门店前是否需要阻断「门店下仍有活跃账号」（N-4 / GAP-4）—— 产品需确认「门店停用后账号是否应保留但无法登录」的口径 | 产品确认 |
| 5 | `verify_status='pending'` 是否本应由收货驱动（D-2）—— `full-scan-08:678` 已列为待拍板，本轮从首页消费端确认了可见影响，仍待产品决定 | 产品确认 |
| 6 | `authService.getStores` 是否应对非超管角色拒绝返回停用门店（OA-1）—— 建议直接给 `getStores` 加超管校验或拆出「选门店用」的独立 action，但需确认 purchaser 是否有「看全部门店档案」的正当需求 | 产品 + 安全确认 |
| 7 | `app_user` 的 `mobile` 字段在 `user-manage` 无入口（`updateUser:421` 会写入 `event.mobile`，前端 payload 从不传 → 恒为 `''`）；`seed-data/app_user.json` 有手机号 | 与 GAP-1 同类，可合并处理 |

---

*本轮全读文件：28 个页面文件（2524 行）+ 交叉参照 12 个云函数/工具/配置/种子文件（dataService 1559 / authService 675 全读，其余按行区间定点读取）；总读取约 6600 行。结论均带 `文件:行号`。*
