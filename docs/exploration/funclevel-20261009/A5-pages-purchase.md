# A5 · 采购域页面（下单/详情/列表）· 函数级清单

## 0. 范围与方法

### 0.1 实际读取确认（12 个分配文件，全部逐行 Read）

| 文件 | Read 观测行数 | 字符数 | 备注 |
|---|---|---|---|
| pages/purchase-create/purchase-create.js | 436 | 18165 | 全仓最复杂页面逻辑 |
| pages/purchase-create/purchase-create.wxml | 148 | 7329 | |
| pages/purchase-create/purchase-create.wxss | 165 | 5747 | |
| pages/purchase-create/purchase-create.json | 3 | 50 | |
| pages/purchase-detail/purchase-detail.js | 402 | 15975 | |
| pages/purchase-detail/purchase-detail.wxml | 141 | 7380 | |
| pages/purchase-detail/purchase-detail.wxss | 153 | 2364 | |
| pages/purchase-detail/purchase-detail.json | 3 | 52 | |
| pages/purchase-list/purchase-list.js | 155 | 5142 | |
| pages/purchase-list/purchase-list.wxml | 47 | 2194 | |
| pages/purchase-list/purchase-list.wxss | 123 | 1913 | |
| pages/purchase-list/purchase-list.json | 4 | 80 | |

### 0.2 额外读取（只读，用于确认契约闭环）

| 文件 | 读取范围 |
|---|---|
| utils/cloud.js | 1-283 全文（前端唯一云调用网关） |
| utils/util.js | 1-128 全文 |
| utils/meta.js | 1-68 全文 |
| utils/auth-guard.js | 1-17 全文 |
| app.json | 1-75 全文（页面注册 + tabBar 归属） |
| cloudfunctions/createPurchaseOrder/index.js | 1-517 全文（下单契约/数量校验） |
| cloudfunctions/getPurchaseOrders/index.js | 1-149 全文（列表契约/statusCounts） |
| cloudfunctions/getPurchaseOrderDetail/index.js | 39-150（详情契约） |
| cloudfunctions/dataService/index.js | 1-40 + 1349-1668（cancelOrder/requestCancel/remindAudit/verifyManualOrder） |

累计 Read 约 3460 行。

### 0.3 未读范围（不对其下结论）

- 后端 `dataService` 的 auditOrder/settleReceipt/getOrderStats 等未读段（1-1348 中段）。
- pages/receive-verify、pages/approval-*、pages/index、pages/message、pages/report-detail 的 JS 全文（仅用 Grep 取证导航边）。
- 收货实收量、审批改量、验收照片三条链路的后端实现细节（属其他代理批次，本批仅在 4 节做边界标注）。

### 0.4 一个必须记录的取证事件（防误报）

批量 Read 三个 json 时，返回内容与请求路径**错位**（`purchase-list.json` 请求返回了详情的标题内容，`purchase-detail.json` 请求返回了列表的标题+enablePullDownRefresh）。随后用 `[System.IO.File]::ReadAllText` 逐文件带标签 dump 原始字节、并用 Grep 复核，得到权威结论：

```
purchase-list.json   = { "navigationBarTitleText": "我的采购", "enablePullDownRefresh": true }
purchase-create.json = { "navigationBarTitleText": "门店采购申请" }
purchase-detail.json = { "navigationBarTitleText": "采购申请详情" }   ← 无 enablePullDownRefresh
```

三个文件的标题与开关**各自正确、与 JS 一致**：列表页有 `onPullDownRefresh`（js:41）且 json 开启；详情页无该生命周期且 json 未开启。
**因此本报告不提出"json 配置错换"这类缺陷**——那是工具返回顺序错位造成的假象，已用独立取证排除。

---

## 1. 页面配置与生命周期

### 1.1 pages/purchase-create（非 tabBar）

- **app.json 注册**：app.json:7 `"pages/purchase-create/purchase-create"`，不在 tabBar（tabBar 仅 index / purchase-list / report-list / message，app.json:42-66）。
- **json 配置**：仅 `navigationBarTitleText: "门店采购申请"`。无 enablePullDownRefresh，页面也确实没有 `onPullDownRefresh`。
- **data 声明**（js:9-32）：categoryL1List / activeL1('kitchen') / filteredCategories / activeCategoryId(1) / products / displayProducts / searchKey / manualItems / showManualPopup / manualForm / orderDate / deliveryDate / remark / today / tomorrow / totalCount / isSubmitting。
  - 注意：JS 运行时还 setData 了**未声明**的 `categories`（js:120）。
  - 另有一批**不在 data 的实例属性**：editingOrderId / manualOrderId / catalogOrderId / catalogOrderSubmitted / catalogSeq / requestId（js:36-44）、_qtyMap（js:92）。
- **onLoad(options)**（js:34-53）：
  1. `authGuard.requireLogin()` 守卫（js:35）。
  2. 取 `options.orderId || options.id` 为 editingOrderId（js:36）。
  3. 初始化 6 个拆单/幂等实例属性（js:37-44）。
  4. 生成 `requestId = 'REQ' + Date.now() + 随机6位`（js:44）。
  5. 计算 today / tomorrow，`setData({ today, tomorrow, orderDate: today, deliveryDate: tomorrow })`（js:45-50）。
  6. `await loadReferenceData()` → 若 editingOrderId 非空 `await loadExistingOrder()`（js:51-52）。
- **其他生命周期**：无 onShow/onHide/onUnload/onPullDownRefresh/onReachBottom/onShareAppMessage。
  - 后果：下单页**不重进就不刷新分类/商品**；从该页返回又进入会走完整 onLoad（navigateTo 每次都是新实例），所以不刷新是可接受的。
- **数据来源**：全部来自云函数（dataService.getCategories、getProducts、getPurchaseOrderDetail），无 Mock、无本地缓存。

### 1.2 pages/purchase-detail（非 tabBar）

- **app.json 注册**：app.json:8，非 tabBar。
- **json 配置**：仅 `navigationBarTitleText: "采购申请详情"`；无 enablePullDownRefresh，JS 也无 `onPullDownRefresh`——刷新入口依赖"返回再进"或列表页 onShow。
- **data 声明**（js:8）：`{ detail: { items: [] }, canReceive: false, canEdit: false, canCancel: false, voucherImages: [] }`。
  - 但 loadData 还 setData 了 10 个**未声明**键：supplierGroups / canCopy / canRemindAudit / isManualOrder / verifyStatus / voucherBlockReason / canSubmitVoucher / canVerify / canRequestCancel / canForceCancel（js:119-135）。
- **onLoad(options)**（js:10-14）：仅做守卫 + 读 `options.id || options.orderId`，**不发请求**。无 id 时 toast，但不 navigateBack。
- **onShow()**（js:16-18）：`if (this.orderId) this.loadData()`——**所有数据都靠 onShow 拉取**，从 receive-verify 收货返回后自动刷新。
- **无 onHide/onUnload/onPullDownRefresh/onReachBottom/onShareAppMessage**。

### 1.3 pages/purchase-list（**tabBar 页**）

- **app.json 注册**：app.json:9 且 app.json:50-54 是 tabBar 第 2 项（text "采购"）。
- **json 配置**：`navigationBarTitleText: "我的采购"` + `enablePullDownRefresh: true`（Grep 复核：json:2、json:3）。与 JS 的 `onPullDownRefresh` 配对正确。
- **data 声明**（js:11-21）：activeFilter('all') / filterTabs / filteredList / orders / isLoading / isLoadingMore / loadFailed / hasMore / page(1)。
- **onLoad(options)**（js:23-29）：守卫 + 读 `options.status`（见 6 节，实际永远为空）。
- **onShow()**（js:31-39）：读 `app.globalData.pendingListFilter`（首页状态卡经 switchTab 带过来的暂存），清空后 `this.reload()`。**每次 tab 切换都重拉第 1 页**。
- **onPullDownRefresh()**（js:41-43）：`this.reload().finally(() => wx.stopPullDownRefresh())`。注意 `reload()` 返回 `loadData(1,false)` 的 Promise（js:50-53），`.finally` 可正确挂上。
- **onReachBottom()**（js:45-48）：`isLoading || isLoadingMore || !hasMore` 三重护栏，然后 `loadData(page+1, true)`。
- **无 onHide/onUnload/onShareAppMessage**。
- **常量**：`PAGE_SIZE = 20`（js:8）。

---

## 2. 前端函数清单

### 2.1 purchase-create（下单页）

#### `onLoad(options)` (purchase-create.js:34-53)
- **触发方式**：页面实例创建。
- **入参**：`options.orderId || options.id`（js:36）。全仓只有 detail 页两处用 `?orderId=`（detail.js:316、350），无任何 `?id=` 调用点 → `options.id` 分支未使用。
- **调用云函数**：间接两跳 `dataService{action:'getCategories'}`、`getProducts{includeInactive:false}`、（有 editingOrderId 时）`getPurchaseOrderDetail{orderId}`。
- **成功/失败分支**：自身不做校验；失败分支分散在三个 load* 方法。
- **副作用**：无 wx. 调用（除 loadExistingOrder 内）。
- **契约风险**：6 个幂等/拆单实例属性写在 js 顶层而非 data，无法从 wxml 观察；`requestId` 每次进入页面重生成（js:44），意味着"进页面→离开→再进"后重试链断裂，此时服务端幂等键是新的，靠后端事务内复查（createPurchaseOrder:364-376）兜底。
- **WXML 绑定核查**：生命周期，无绑定（正常）。

#### `loadExistingOrder()` (purchase-create.js:55-101)
- **触发方式**：仅 onLoad 内部调用（js:52），**无 wxml 绑定**。
- **入参**：`this.editingOrderId`。
- **调用云函数**：`getPurchaseOrderDetail{orderId}`（js:57-59）。期望返回 `data` 为订单主表 + `items`。
- **成功/失败分支**：失败 → `util.showToast(msg || '草稿加载失败')` 后 return，**页面停留在空表单**（js:61-64）。成功但 `orderStatus !== 'draft'` → toast「只有草稿订单可以编辑」+ 600ms 后 `wx.navigateBack()`（js:66-70）。
- **副作用**：`util.showLoading('加载草稿...')` / `util.hideLoading()`（js:56、60）。
- **关键逻辑**：逐行拆分为 `_qtyMap[productId] = Number(orderQty)||0`（档案行，js:88-90）与 `manualItems[]`（手动行，js:76-88）；手动行 categoryL1 靠正则 `/前厅|front/i` 从 categorySnapshot 反推（js:78）——**脆弱**：快照里若不含"前厅/front"字样一律归 kitchen。
- **契约风险**：不回填 `this.manualOrderId`（见 6 节 D4 重复建单缺陷）。
- **WXML 绑定核查**：**无绑定**（内部调用，正常）。

#### `loadReferenceData()` (purchase-create.js:103-123)
- **触发方式**：onLoad 调用（js:51），无 wxml 绑定。
- **调用云函数**：`dataService{action:'getCategories'}`（js:104）。期望返回 `data.level1[]` 与 `data.categories[]`。
- **成功/失败分支**：失败仅 toast「分类数据加载失败」并 return（js:105-108）→ **`loadProducts()` 不会执行**（js:122 在 return 之后），页面只剩空分类与空商品列表。
- **副作用**：`decorate()` 用 `meta.getCategoryIconBase(c.icon)` 把 emoji 映射成 `icon-{base}-grey/white`（js:111-114）；activeL1 兜底为列表第一项 id（js:117-119）。
- **契约风险**：`data.categories` 是 setData 写入但**未在 data:{} 声明**的键（js:120）。
- **WXML 绑定核查**：无绑定。

#### `loadProducts()` (purchase-create.js:125-137)
- **触发方式**：loadReferenceData 调用（js:122），无 wxml 绑定。
- **调用云函数**：`getProducts{includeInactive:false}`（js:126-128）。
- **成功/失败分支**：失败 toast + `setData({displayProducts:[]})`（js:129-132）→ wxml:52 显示「暂无商品」，**与"该分类下真的没有商品"表现完全相同**，用户无从区分。
- **副作用**：`cloud.normalizeProduct` 映射（js:134）。
- **WXML 绑定核查**：无绑定。

#### `switchL1(e)` (purchase-create.js:140-144)
- **触发方式**：wxml:14 `bindtap="switchL1" data-id="{{item.id}}"`。
- **入参**：`e.currentTarget.dataset.id`。
- **调用云函数**：无。
- **成功/失败分支**：无分支；`setData({activeL1, searchKey:''})` → `updateFilteredCategories()` → `filterProducts()`。
- **副作用**：清空搜索框（受控输入 wxml:21 `value="{{searchKey}}"`）。
- **WXML 绑定核查**：**已绑定**（wxml:14）。

#### `updateFilteredCategories()` (purchase-create.js:146-150)
- **触发方式**：内部调用（js:121、142），无 wxml 绑定。
- **入参**：无；读 `this.data.categories`、`this.data.activeL1`。
- **契约风险**：`filtered[0].id` 为 null 时 `activeCategoryId: null`（js:148-149）→ `filterProducts` 的 `p.categoryId === null` 永远不命中 → 该 L1 下二级分类为空则商品列表为空，属预期。
- **WXML 绑定核查**：无绑定。

#### `selectCategory(e)` (purchase-create.js:152-155)
- **触发方式**：wxml:28 `bindtap="selectCategory" data-id="{{item.id}}"`。
- **入参**：`dataset.id`；副作用：清空 searchKey、重新 filterProducts。
- **WXML 绑定核查**：**已绑定**（wxml:28）。

#### `onSearchInput(e)` (purchase-create.js:157-160)
- **触发方式**：wxml:21 `bindinput="onSearchInput"`。
- **入参**：`e.detail.value`。
- **契约风险**：无防抖、无长度限制；`filterProducts` 里 `toLowerCase()` 大小写不敏感，但**中文商品名搜索无拼音/分词支持**，且必须命中当前 L1（js:167）。
- **WXML 绑定核查**：**已绑定**（wxml:21）。

#### `filterProducts()` (purchase-create.js:162-182)
- **触发方式**：内部调用（js:99、143、154、159、170、384），无 wxml 绑定。
- **入参**：`this.data.{activeL1,activeCategoryId,searchKey,products}` + `this._qtyMap`。
- **成功/失败分支**：搜索态按 `categoryL1 + name` 过滤（js:165-167，忽略二级分类）；非搜索态按 `categoryL1 + categoryId` 过滤（js:169）。
- **副作用**：把 `_qtyMap[productId]` 回填成每行 `qty`（js:172-179），默认 0。
- **契约风险**：`manufacturerName` 兜底 `'默认'`（js:177），与 `cloud.normalizeProduct` 的兜底重复（cloud.js:182）。
- **WXML 绑定核查**：无绑定。

#### `onProductQtyInput(e)` (purchase-create.js:185-193)
- **触发方式**：wxml:47 `bindinput="onProductQtyInput" data-index="{{index}}"`。
- **入参**：`dataset.index`、`e.detail.value`。
- **调用云函数**：无（本地态）。
- **契约风险**（**前端可控数量字段 #1**）：`parseFloat(e.detail.value) || 0`——
  - **允许小数**（`type="digit"` 允许小数点，js:187）；
  - **无上限**（可输入 999999999）；
  - `''` → 0；
  - 不做整数校验。
  后端独立复算：`createPurchaseOrder/index.js:282-285` `Number(item.orderQty)` 必须 finite 且 `>0` 且 `<=1000000`，否则整单拒绝。**后端有上限兜底，前端没有**。
- **WXML 绑定核查**：**已绑定**（wxml:47）。

#### `increaseProductQty(e)` (purchase-create.js:195-203)
- **触发方式**：wxml:48 `bindtap="increaseProductQty" data-index="{{index}}"`。
- **契约风险**：`+1` 无上限，同 #1；**注意它与输入框不同步**：直接 `setData([\`displayProducts[${idx}].qty\`])`，绕过 `bindinput`，但 `_qtyMap` 已同步更新，最终提交读的是 `_qtyMap`（js:295），一致。
- **WXML 绑定核查**：**已绑定**（wxml:48）。

#### `decreaseProductQty(e)` (purchase-create.js:205-213)
- **触发方式**：wxml:45 `bindtap="decreaseProductQty" data-index="{{index}}"`。
- **契约风险**：`Math.max(0, qty-1)` 下限 0（js:208）→ 0 会被 `_saveOrder` 的 `qtyMap[pid] > 0` 过滤（js:298）→ 等价于删除该行。**档案行可以减到 0，手动行不能（下限 1）**，两侧不对称。
- **WXML 绑定核查**：**已绑定**（wxml:45）。

#### `_updateTotal()` (purchase-create.js:215-220)
- **触发方式**：内部调用（js:100、181、192、202、212、254、277），无 wxml 绑定。
- **契约风险**：`totalCount` 是"种数"不是"总数量"，wxml:105 文案为「共 {{totalCount}} 种商品」，一致。
- **WXML 绑定核查**：无绑定（写 `totalCount`，wxml:105 只读总数）。

#### `showManualForm()` (purchase-create.js:223-232)
- **触发方式**：wxml:59 `bindtap="showManualForm"`。
- **契约风险**：硬上限 5 个手动商品（js:224），后端 `createPurchaseOrder:310-312` 同样校验 >5 拒绝 → 前后端一致。
- **WXML 绑定核查**：**已绑定**（wxml:59）。

#### `hideManualForm()` / `preventBubble()` (purchase-create.js:233, 234)
- **触发方式**：wxml:113 `bindtap="hideManualForm"`（遮罩）、wxml:114 `catchtap="preventBubble"`、wxml:117 `bindtap="hideManualForm"`（关闭按钮）。
- **契约风险**：`preventBubble` 是空函数，作用就是"占位以触发 catchtap 阻断冒泡"，属正确实现，**不是死代码**。
- **WXML 绑定核查**：均已绑定。

#### `onManualInput(e)` (purchase-create.js:236-238)
- **触发方式**：wxml:122/133/137/141 `bindinput="onManualInput" data-field="..."`。
- **入参**：`dataset.field`（name|unit|qty|remark）、`e.detail.value`。
- **契约风险**：路径写法 `[\`manualForm.${field}\`]`，`field` 来自 wxml 字面量、非用户可控 → 无注入面。qty 在此处**不做任何校验**，校验推迟到 `confirmManual`。
- **WXML 绑定核查**：**已绑定**（4 处）。

#### `setManualCategory(e)` (purchase-create.js:239-241)
- **触发方式**：wxml:127/128 `bindtap="setManualCategory" data-cat="kitchen|front"`。
- **契约风险**：枚举白名单式（只有两个字面量按钮），无非法值入口。
- **WXML 绑定核查**：**已绑定**（2 处）。

#### `confirmManual()` (purchase-create.js:242-256)
- **触发方式**：wxml:143 `bindtap="confirmManual"`。
- **入参**：读 `this.data.manualForm`。
- **契约风险**（**前端可控数量字段 #2 + 文本字段**）：
  - name 空校验（js:244）、unit 空校验（js:245）、qty `!qty || parseFloat(qty) <= 0` 校验（js:246）→ **允许小数、无上限**；
  - `tempId = 'MANUAL_' + Date.now()`（js:248）→ 后端把该值当 productId 持久化（createPurchaseOrder:290 `productId: item.productId`，前端传入 `item.productId || item.tempId`，js:350）。**手动商品的 productId 由前端生成，且同一秒内多次点击会产生相同 tempId**（js:248）→ 后端 `seenProductIds` 重复校验（createPurchaseOrder:286-287）会报「采购商品不能重复」。
  - remark 无长度限制（wxml:141 无 maxlength，而整单备注 wxml:97 有 maxlength=200）。
- **WXML 绑定核查**：**已绑定**（wxml:143）。

#### `increaseManualQty(e)` / `decreaseManualQty(e)` / `onManualQtyInput(e)` (purchase-create.js:259-272)
- **触发方式**：wxml:71 / wxml:69 / wxml:70 的 bindtap/bindinput，`data-index="{{index}}"`。
- **契约风险**：
  - `decreaseManualQty` 下限 1（js:265 `if qty > 1`）；
  - `onManualQtyInput` `parseFloat(...) || 1`（js:271）→ 空/0 归 1，**允许小数**，无上限；
  - 三个方法都**不调用 `_updateTotal()`**（种数不变，正确）。
- **WXML 绑定核查**：均已绑定。

#### `removeManualItem(e)` (purchase-create.js:273-278)
- **触发方式**：wxml:73 `bindtap="removeManualItem" data-index="{{index}}"`。
- **副作用**：`splice` + `_updateTotal()`。
- **WXML 绑定核查**：**已绑定**（wxml:73）。

#### `onOrderDateChange(e)` / `onDeliveryDateChange(e)` / `onRemarkInput(e)` (purchase-create.js:281-283)
- **触发方式**：wxml:81 picker `bindchange`、wxml:87 picker `bindchange`、wxml:96 textarea `bindinput`。
- **契约风险**：采购日期 picker **无 start/end 限制**（wxml:81 只有 value），期望到货 picker 有 `start="{{today}}"`（wxml:87）→ **前端无法保证 `orderDate <= deliveryDate`**：把采购日期选到明天、到货日期只能选今天 → 后端 `createPurchaseOrder:175` 以「采购日期或期望到货日期无效」整单拒绝，且前端无预检提示。
- **WXML 绑定核查**：均已绑定。

#### `saveDraft()` (purchase-create.js:286)
- **触发方式**：wxml:107 `bindtap="saveDraft"`。
- **实现**：`return this._saveOrder('draft')`。
- **WXML 绑定核查**：**已绑定**（wxml:107）。

#### `submitRequest()` (purchase-create.js:288)
- **触发方式**：wxml:108 `bindtap="submitRequest"`。
- **实现**：`return this._saveOrder('submitted')`。
- **WXML 绑定核查**：**已绑定**（wxml:108）。

#### `_saveOrder(orderStatus)` (purchase-create.js:290-434)
- **触发方式**：仅 saveDraft / submitRequest 内部调用，无 wxml 绑定。
- **入参**：`orderStatus` 为 `'draft'` 或 `'submitted'`。
- **调用云函数**：`createPurchaseOrder`，最多连发 **2 次**（拆单场景，js:370、385）。
- **完整传参**（`buildPayload`，js:320-336）：`storeId, storeName, orderId, orderDate, deliveryDate, createdBy, createdByName, items, remark, orderStatus, requestId`。
  - `requestId = this.requestId + ':' + orderStatus + reqSuffix`（js:335）；拆单时档案单带 `:c` / `:c2`+、手动单带 `:m`（js:369、411）。
- **`toPayloadItems` 明细映射**（js:344-359）：`productId (=item.productId || item.tempId), productName, category (L1名-L2名拼接), unit, supplierId (defaultSupplierId || supplierId || null), orderQty, isManual, remark`。
- **成功/失败分支**：
  - 拆单档案单失败（js:371-376）：hideLoading + isSubmitting=false + toast，return。
  - 档案单成功、手动单失败（js:377-398）：**已落库的档案单不撤回**，`wx.showModal` 告知部分成功 + 提示可重试不重复建单。
  - 整单成功（js:417-430）：重置 requestId + showModal（内容区分 warning / splitOrder / 普通）+ `wx.navigateBack()`。
  - 整单失败（js:431-433）：toast。
- **副作用**：`util.showConfirm`（js:338）、`util.showLoading`（js:342）、`setData({isSubmitting:true/false})`（js:341、373、388、416）、`wx.showModal`（js:390、421）、`wx.navigateBack()`（js:429）。
- **契约风险**：
  1. **`isSubmitting` 的置位晚于确认框**：`setData({isSubmitting:true})` 在 `await util.showConfirm()` 之后（js:338 → js:341），且 wxml:107-108 的两个按钮**都没有 `disabled="{{isSubmitting}}"`** → 双击防线只有 wx.showLoading 的 `mask:true`（util.js:73）和后端 `request_id + created_by` 幂等（createPurchaseOrder:183-210、364-376）。
  2. **`storeId`/`storeName`/`createdBy`/`createdByName` 前端直传但后端覆盖/忽略**：非全局角色强制 `user.default_store_id` 并回查 store_name（createPurchaseOrder:212-218、251）；`created_by` 完全取服务端值（createPurchaseOrder:342-347）→ 前端伪造无效果，但也意味着**传了也没用**（冗余字段）。
  3. **`storeName` 可能为 undefined**：js:322 `store.storeName || store.name`，js:315 只校验了 storeId 存在（`!store.storeId && !store.id`），未校验 storeName。后端 isGlobal 分支会回查覆盖（createPurchaseOrder:251），非全局分支同样覆盖（:217）→ 兜底成立。
  4. **`createdBy` 兜底到 `user.username`**（js:326）：字段名与后端 `created_by`（用户 id）语义不同，但后端忽略该字段 → 无实际影响。
  5. **手动单草稿被编辑时不复用单号**：见 6 节 D4（本方法 js:403-412）。
- **WXML 绑定核查**：无绑定（由两个绑定方法间接触发）。

### 2.2 purchase-detail（详情页）

#### `onLoad(options)` (purchase-detail.js:10-14)
- **触发方式**：页面创建。
- **入参**：`options.id || options.orderId`。**4 处入边全部用 `?id=`**（index.js:170、message.js:66、report-detail.js:86、93、purchase-list.js:138）→ `options.orderId` 兜底分支未使用。
- **成功/失败分支**：无 id → `util.showToast('未获取到采购订单，请返回后重试')`，**不 navigateBack**（js:13）→ 用户停在空白页，只能左滑返回。
- **WXML 绑定核查**：生命周期。

#### `onShow()` (purchase-detail.js:16-18)
- **触发方式**：生命周期（进入 / 从收货页返回均触发）。
- **调用云函数**：间接 `getPurchaseOrderDetail`。
- **契约风险**：无防抖；`loadData` 内 `util.showLoading` + 多次 await（含 `getFileUrls`），返回页后重复请求属预期设计。
- **WXML 绑定核查**：生命周期。

#### `loadData()` (purchase-detail.js:20-136)
- **触发方式**：onShow + 各操作成功后的内部调用（js:170、241、269、297），无 wxml 绑定。
- **入参**：`this.orderId`。
- **调用云函数**：`getPurchaseOrderDetail{orderId}`（js:23-25），随后 `cloud.getFileUrls(order.verifyVoucherFileIds)`（js:117）。
- **期望返回字段**：`data`（订单主表，含 `supplier_confirmations`、`verify_*`）、`data.items[]`、`data.receipts[]`、`data.reports[]`。
  - **实际使用**：只用 `data` + `data.supplier_confirmations` + `data.items`；**`receipts` / `reports` / items 上的 `received_total` / `remaining_qty` 全部未使用**（Grep `receipts|reports|received_total|remaining_qty|submittedAt` 于 purchase-detail 目录 → No matches）。
- **成功/失败分支**（**最刺眼的一条**）：失败时 `js:27-30` **只 toast，不置任何失败态**；页面停留在初始 `detail:{items:[]}`（js:8）→ wxml:44 渲染「商品清单 (0)」**、wxml:10 显示空状态文字**，用户会误判为"该单没有商品"。
- **关键权限/展示推导**（js:71-114）：canReceive、canEdit、canCopy、canCancel、canRequestCancel、canForceCancel、canRemindAudit、canSubmitVoucher、voucherBlockReason、canVerify 共 10 个布尔/文案。
- **chef 信息边界**：js:46-52 平铺 + 逐行打 supplierConfirm 标签；js:53-70 非 chef 按 supplierId 分组。**注意 chef 分支 `confirmTagOf(item.supplierId)` 仍使用行上的 `supplier_id`**（后端不下发 supplier_name，但 supplier_id 仍在明细里，getPurchaseOrderDetail:86-97）→ chef 能逐行看到供应商确认状态（待确认/已确认/已发货），可间接推断供货归属。属信息暴露边界，需产品确认是否符合"chef 不见供应商身份"的意图。
- **契约风险**：10 个 setData 键未在 data:{} 声明（js:119-135）；首次渲染 `detail.statusType` 为 undefined → wxml:3 类名 `status-bg-undefined`（wxss 无此规则）→ **状态卡首帧白字无底色、不可读**。
- **`voucherBlockReason` 的条件冗余**：js:103 外层写了 `!['approved'].includes(verifyStatus)`，但 `canSubmitVoucher`（js:97-100）已经要求 `verifyStatus ∈ ['none','rejected']`，`'approved'` 与 `'pending'` 都使 `canSubmitVoucher === false` → 外层这个排除条件只挡了 `'approved'`，而 `'pending'` 由 js:104-105 单独处理，**当前逻辑覆盖完整但外层条件可读性差**。
- **覆盖矩阵核对**（js:102-111 与 wxml:87-102 逐格对照）：`approved` → wxml:89 已核销；`pending` → js:105「凭证已提交，等待管理员核销」+ wxml:90；`rejected` → 可再提交（`canSubmitVoucher` 放行）且 wxml:91/102 展示驳回原因；`none` + 未收货完 → js:107「订单尚在收货中…」；`none` + 已收货完 + 非授权角色 → js:109「当前账号无权提交付款凭证」。**五个状态均有出口，无静默隐藏**。
- **WXML 绑定核查**：无绑定（内部/生命周期触发）。

#### `submitVoucher()` (purchase-detail.js:139-180)
- **触发方式**：wxml:134 `bindtap="submitVoucher"`（仅 `canSubmitVoucher` 时渲染）。
- **调用云函数**：`dataService{action:'verifyManualOrder', orderId, verifyAction:'submit', voucherFileIds}`（js:161-166）。
- **成功/失败分支**：取消选择（!res 或 tempFiles 空）→ 复位 `_submitting` 静默 return（js:148-151）；成功 → showSuccess + `loadData()`；失败 → toast；catch → hideLoading + toast（js:174-177）。
- **副作用**：`wx.chooseMedia({count:3, mediaType:['image'], sourceType:['album','camera']})`（js:143-146）；**`wx.cloud.uploadFile({cloudPath: 'vouchers/${this.orderId}/${Date.now()}_${i}${ext}', filePath})` 直传，js:156-158**；`util.showLoading/hideLoading`。
- **契约风险**（**上传路径由前端决定**）：
  1. `this.orderId` **未做字符清洗**，直接拼进 cloudPath（js:157）。对比 `cloud.uploadReceiptPhotos` 有 `safeOrderId = String(...).replace(/[^a-zA-Z0-9_-]/g,'')`（cloud.js:231）→ 同一仓库两套上传口径不一致。
  2. **前端 3 张 vs 后端 9 张**：chooseMedia `count:3`（js:144）vs 后端 `voucherFileIds.length > 9` 拒绝（dataService:1567）→ 上限不一致（前端更严）。
  3. 后端按 `vouchers/${orderId}/` 前缀校验 fileID 归属（dataService:1564-1570）；因路径与同一 `orderId` 同源构造，**不构成跨订单取用他人文件**，但 `..` / 分隔符会原样进入云存储路径。
  4. `_submitting` 是实例属性而非 data，wxml 无法据此 disable 按钮。
- **WXML 绑定核查**：**已绑定**（wxml:134）。

#### `previewVoucher(e)` (purchase-detail.js:183-189)
- **触发方式**：wxml:98 `bindtap="previewVoucher" data-index="{{index}}"`。
- **副作用**：`wx.previewImage({urls: voucherImages, current: voucherImages[idx]})`。
- **契约风险**：`voucherImages` 是临时链接数组（`cloud.getFileUrls` 返回），**没有空值保护**；但按钮外层有 `wx:if="{{voucherImages.length}}"`（wxml:97），实际不可达。
- **WXML 绑定核查**：**已绑定**（wxml:98）。

#### `remindAudit()` (purchase-detail.js:192-208)
- **触发方式**：wxml:120 `bindtap="remindAudit"`。
- **调用云函数**：`dataService{action:'remindAudit', orderId: this.orderId}`（js:196-199）。
- **成功/失败分支**：成功 toast「已提醒管理员审核」；失败 toast msg（js:200-204）。
- **契约风险**：**复用 `_submitting` 做互斥**（js:193-194），与 submitVoucher/verifyDecide 共用同一个锁 → 语义上是"页面级提交锁"，合理但命名易误读。后端 1 小时限频（dataService:1508-1528）。
- **WXML 绑定核查**：**已绑定**（wxml:120）。

#### `verifyDecide(e)` (purchase-detail.js:211-245)
- **触发方式**：wxml:137 `bindtap="verifyDecide" data-approve="false"`、wxml:138 `bindtap="verifyDecide" data-approve="true"`。
- **入参**：`dataset.approve`（字符串 `"true"`/`"false"`）→ js:213 同时兼容 `=== true` 与 `=== 'true'`，判断正确。
- **调用云函数**：`dataService{action:'verifyManualOrder', orderId: d.purchaseOrderId, verifyAction: 'approve'|'reject', amount, note}`（js:230-236）。
- **成功/失败分支**：取消输入（input===null）→ 静默 return（js:219、224）；金额非法 toast（js:221）；驳回无原因 toast（js:225）；成功 showSuccess + loadData；失败 toast。
- **契约风险**（**前端可控金额字段 #1，也是本域唯一金额**）：
  - `amount = parseFloat(input)`（js:220）；仅校验 `isNaN || amount <= 0`（js:221）。
  - **无上限、无小数精度限制、无与订单规模的合理性比对** → 核销人可填任意金额（含 0.01 或 99999999.999）。
  - 后端唯一防线：`dataService:1642` `!Number.isFinite(amount) || amount <= 0` → 同样只拦非正数，**不拦上限、不做四舍五入**（dataService:1648 直接 `verify_amount: amount` 落库）。
  - 该金额是手动单**唯一的货币真值**（`dataService:1552-1555` 注释明确"金额唯一可信来源是凭证，不查协议价表"）→ 属设计如此，但**前端无二次确认金额回显**（只有 showPrompt 输入），误录即闭环。
  - **`amount: amount || undefined`（js:234）**：`amount === 0` 会退化成 undefined → 但前面已拦 >0，不可达。
- **WXML 绑定核查**：**已绑定**（wxml:137、138 两处，data-approve 区分）。

#### `requestCancel()` (purchase-detail.js:248-273)
- **触发方式**：wxml:124 `bindtap="requestCancel"`（`canRequestCancel` 时渲染）。
- **调用云函数**：`dataService{action:'requestCancel', orderId: d.purchaseOrderId, reason}`（js:260-264）。
- **成功/失败分支**：无 reason toast（js:253-256）；成功 showSuccess + loadData；失败 toast。
- **契约风险**：`_submitting` 的置位（js:258）在 `showPrompt` await **之后**，理论上双击可产生两次输入弹窗；后端用条件更新兜底（dataService:1463-1476 `cancel_requested: _.neq(true)`）→ 不会重复标记。
- **WXML 绑定核查**：**已绑定**（wxml:124）。

#### `cancelOrder()` (purchase-detail.js:276-301)
- **触发方式**：wxml:115 `bindtap="cancelOrder"`（`canCancel`）与 wxml:125 `bindtap="cancelOrder"`（`canForceCancel`），**同一方法两处绑定**。
- **调用云函数**：`dataService{action:'cancelOrder', orderId, reason}`（js:288-292）。
- **契约风险**：与 requestCancel 相同的"锁置位晚于输入框"问题；后端双重状态检查（事务外 dataService:1363-1369 + 事务内 :1371-1391）兜底。
- **WXML 绑定核查**：**已绑定**（wxml:115、125）。

#### `_genRequestId(kind)` (purchase-detail.js:303-312)
- **触发方式**：内部调用（js:345 'copy'、js:384 'submit'），无 wxml 绑定。
- **契约风险**：**按页面存活期缓存**（js:307 `if (!this._requestIds[kind])`）→ 同一详情页存活期间反复提交/复制，**永远用同一个 requestId**。若第一次失败且单已落库，重试会命中幂等返回旧单号（正确）；但若第一次真正失败、用户改完又想提交一次新的，也会命中旧键——不过 createPurchaseOrder:195 有状态一致性校验会显式报错而非静默吞掉。
- **WXML 绑定核查**：无绑定。

#### `editRequest()` (purchase-detail.js:314-317)
- **触发方式**：wxml:106 `bindtap="editRequest"`。
- **副作用**：`wx.navigateTo('/pages/purchase-create/purchase-create?orderId=' + d.purchaseOrderId)`。
- **WXML 绑定核查**：**已绑定**（wxml:106）。

#### `copyToDraft()` (purchase-detail.js:320-354)
- **触发方式**：wxml:111 `bindtap="copyToDraft"`（`canCopy`，即原单 `rejected`）。
- **调用云函数**：`createPurchaseOrder{storeId, storeName, orderDate: 今天, deliveryDate: d.deliveryDate || 今天, items, remark, orderStatus:'draft', requestId}`（js:336-346）。
- **成功/失败分支**：成功 showSuccess + 800ms 后 navigateTo 新草稿（js:348-350）；失败 toast。
- **契约风险**：**完全复刻原单明细行**（js:325-334），`orderQty` 原样带出；`orderDate` 强制今天、`deliveryDate` 沿用原单 → **若原单 deliveryDate 早于今天，后端 `actualDeliveryDate < actualDate` 校验（createPurchaseOrder:175）整单拒绝**，提示为「采购日期或期望到货日期无效」，用户难以理解原因。前端无预检。
- **副作用**：`util.showConfirm`（js:323）、`util.showLoading/hideLoading`、`wx.navigateTo`。
- **WXML 绑定核查**：**已绑定**（wxml:111）。

#### `submitRequest()` (purchase-detail.js:356-393)
- **触发方式**：wxml:107 `bindtap="submitRequest"`（`canEdit`）。
- **调用云函数**：`createPurchaseOrder{orderId, storeId, storeName, orderDate, deliveryDate, createdBy: d.createdById, createdByName: d.createdBy, items, remark, orderStatus:'submitted', requestId}`（js:372-385）。
- **成功/失败分支**：成功 showSuccess + 1000ms 后 `wx.navigateBack()`；失败 toast。
- **契约风险**：
  1. **本方法没有 `_submitting` 互斥锁**（对比 requestCancel/cancelOrder/verifyDecide 都有）→ 双击可产生两个并发请求。后端幂等（同 requestId + 状态一致性校验，createPurchaseOrder:183-210）会拦掉重复提交并返回 idempotent 结果，**不会产生重复单**，但用户会看到两次 toast。
  2. 直接传 `createdBy: d.createdById` → 后端忽略（createPurchaseOrder:342-347 取 existingOrder.created_by 或当前用户），字段冗余。
  3. 混单风险：原样带出全部明细行；后端强制"手动商品不能与档案商品混单"（createPurchaseOrder:313-316）→ 若存在混单草稿会被拒绝。正常流程下草稿已拆单，故不可达。
- **WXML 绑定核查**：**已绑定**（wxml:107）。

#### `goReceive()` (purchase-detail.js:395-400)
- **触发方式**：wxml:129 `bindtap="goReceive"`（`canReceive`）。
- **副作用**：`wx.navigateTo('/pages/receive-verify/receive-verify?orderId=' + d.purchaseOrderId + '&storeId=' + d.storeId)`。
- **WXML 绑定核查**：**已绑定**（wxml:129）。

### 2.3 purchase-list（列表页）

#### `onLoad(options)` (purchase-list.js:23-29)
- **触发方式**：页面创建。
- **入参**：`options.status`。
- **契约风险**：**死分支**——本页唯一入边是 `index.js:165` 的 `wx.switchTab`，tabBar 页 switchTab 无法携带 URL 参数（index.js:163 注释自证"switchTab 不支持 URL 传参，改经全局暂存传递"），全仓无任何 `navigateTo` 到本页 → `options.status` 恒为空串。
- **WXML 绑定核查**：生命周期。

#### `onShow()` (purchase-list.js:31-39)
- **触发方式**：生命周期（tab 切换每次触发）。
- **调用云函数**：间接 `getPurchaseOrders`（经 reload → loadData）。
- **副作用**：读取并清空 `app.globalData.pendingListFilter`（js:34-37）。
- **WXML 绑定核查**：生命周期。

#### `onPullDownRefresh()` (purchase-list.js:41-43)
- **触发方式**：json `enablePullDownRefresh: true` 开启的页面级下拉。
- **成功/失败分支**：`finally` 中无条件 `wx.stopPullDownRefresh()` → 即使 loadData 失败（loadData 内已 return，非 throw）也能停住动画。
- **WXML 绑定核查**：**页面级配置绑定**（json:3）。

#### `onReachBottom()` (purchase-list.js:45-48)
- **触发方式**：页面级触底。
- **契约风险**：三重护栏 `isLoading || isLoadingMore || !hasMore`；但**页面内没有任何"加载中/没有更多"的 UI**（wxml 只渲染 `loadFailed`），上拉过程对用户完全无反馈。
- **WXML 绑定核查**：**页面级配置绑定**（隐式，page 默认支持触底）。

#### `reload()` (purchase-list.js:50-53)
- **触发方式**：内部调用（js:38、42、113）。
- **契约风险**：`setData({page:1, hasMore:true})` 后 `return this.loadData(1, false)` → **返回值是 Promise**，`onPullDownRefresh` 的 `.finally` 依赖这一点（js:42）。若未来改造成 `return` 缺失会静默失效。
- **WXML 绑定核查**：无绑定。

#### `loadData(page, append)` (purchase-list.js:55-109)
- **触发方式**：内部调用（reload / onReachBottom）。
- **入参**：`page`（1 起）、`append`（布尔）。
- **调用云函数**：`getPurchaseOrders{role, storeId, createdBy, page, pageSize:20, orderStatus?}`（js:61-71）。
  - `role: user.role || 'purchaser'`（js:62）→ **默认角色兜底成 'purchaser'（全局角色）**。后端实际按 session 用户判定权限（getPurchaseOrders:50-66 只读 `event.role` 用于判断？见下）。
  - 核对：`getPurchaseOrders/index.js:43` 解构 `role` 但**全文从未使用 event.role**——权限完全由 `user.role`（session 查出的真实角色）决定，js:50-66。**因此前端传的 `role` 是冗余字段，兜底成 'purchaser' 不越权**。
  - `storeId`：仅 isGlobal 分支生效（getPurchaseOrders:62）→ 管理员列表页只显示当前所选门店的单子。
  - `createdBy`：仅 `user.role === 'chef'` 时前端填（js:64），但后端 chef 分支强制用 `user.user_id`（getPurchaseOrders:55）→ **冗余字段**。
  - `orderStatus`：`activeFilter !== 'all'` 时下推（js:69），值域含虚拟筛选 `'receivable'` / `'to_verify'`，后端有专门分支（getPurchaseOrders:70-76）→ 契约匹配。
- **期望返回**：`data[]`、`total`、`statusCounts{all,draft,submitted,received,receiptAbnormal,cancelled,partialReceived,toVerify,receivable}`。
  - 前端读取的 9 个键（js:87-99）与后端 statusCounts 的 9 个键**完全一一对应**，无字段名错配。
- **成功/失败分支**：失败 → `setData({isLoading:false,isLoadingMore:false,loadFailed: page===1})` + toast（js:72-77）；成功 → 归一化 + 拼接 + 重建 filterTabs + `renderList()`（js:78-108）。
- **契约风险**：
  1. `hasMore: orders.length < total`（js:104）——**用累计条数与 total 比**，正确；但 append 路径下 `orders` 已含历史页数据，逻辑成立。
  2. **`statusCounts` 口径重叠**：后端 `receivable` = `order_status IN (approved, report_generated, partial_received)`（getPurchaseOrders:94），`partialReceived` = `order_status = partial_received`（:91）→ **「待收货」徽标数包含「部分收货」徽标数**，各 tab 徽标相加 ≠ 全部。属口径问题非缺陷。
  3. `total` 来自 `countRes.total`（getPurchaseOrders:108），与列表同 query → 一致。
- **WXML 绑定核查**：无绑定。

#### `switchFilter(e)` (purchase-list.js:111-114)
- **触发方式**：wxml:6 `bindtap="switchFilter" data-value="{{item.value}}"`。
- **入参**：`dataset.value`（all|draft|submitted|receivable|partial_received|received|receipt_abnormal|cancelled|to_verify）。
- **契约风险**：不做白名单校验，直接把字面量下推为 `orderStatus`。当前 filterTabs 由 JS 自身构造（js:86-99），无用户输入入口 → 实际安全。
- **WXML 绑定核查**：**已绑定**（wxml:6）。

#### `renderList()` (purchase-list.js:116-135)
- **触发方式**：内部调用（js:108）。
- **入参**：无；读 `this.data.orders` + 当前用户角色。
- **契约风险**：
  1. `canReceiveRole = currentUser.role !== 'chef'`（js:118）→ 店长/采购员/超管都可直接从列表页去收货，与详情页 canReceive 口径一致（detail.js:71）。
  2. **`itemCount` 计算后无任何 wxml 读取点**（js:128，见 6 节 D1）。
  3. `timeAgo: util.getRelativeTime(o.createdAt)`（js:131）——`createdAt` 已经是 `formatDateTime` 输出的 `"YYYY-MM-DD HH:mm"` 字符串（cloud.js:163），`util.parseDate` 走 `/` 替换分支可正确解析。
- **WXML 绑定核查**：无绑定（产物 `filteredList` 由 wxml:12 消费）。

#### `goDetail(e)` (purchase-list.js:137-139)
- **触发方式**：wxml:13、wxml:17 两处 `bindtap="goDetail" data-id="{{item.purchaseOrderId}}"`。
- **副作用**：`wx.navigateTo('/pages/purchase-detail/purchase-detail?id=' + ...)`。
- **契约风险**：`dataset.id` 未做 URL 编码（订单号形如 `PO20261009...`，仅字母数字，实际安全）。
- **WXML 绑定核查**：**已绑定**（wxml:13、17）。

#### `goReceive(e)` (purchase-list.js:141-149)
- **触发方式**：wxml:32 `catchtap="goReceive" data-id="{{item.purchaseOrderId}}"`——用 **catchtap** 阻断冒泡，避免同时触发行上的 goDetail。
- **入参**：`dataset.id` → 在 `this.data.orders` 里 find 出完整 order（js:143）取 storeId。
- **契约风险**：**在 `orders`（服务端原序）里 find，而非 `filteredList`**——两者元素同引用，逻辑成立；但 find 不到时**静默无反应**（js:144 `if (order)` 无 else）→ 按钮点了没反应且无任何提示。当前不可达（按钮只渲染在 filteredList 的行上）。
- **WXML 绑定核查**：**已绑定**（wxml:32，catchtap）。

#### `goCreate()` (purchase-list.js:151-153)
- **触发方式**：wxml:45 `bindtap="goCreate"`（浮动 + 号）。
- **副作用**：`wx.navigateTo('/pages/purchase-create/purchase-create')`，**不传任何参数**。
- **WXML 绑定核查**：**已绑定**（wxml:45）。

---

## 3. ★ 专项一：WXML ↔ JS 双向对账

### 3.1 方向 A：wxml 引用了但 js 没有 → **0 条**

逐一枚举三个 wxml 的全部事件绑定并逐个在对应 js 中定位方法体，全部命中：

**purchase-create.wxml**（17 个不同 handler，共 24 处绑定）
| wxml 行 | 绑定 | js 方法(行号) |
|---|---|---|
| 14 | bindtap switchL1 | 140 |
| 21 | bindinput onSearchInput | 157 |
| 28 | bindtap selectCategory | 152 |
| 45 | bindtap decreaseProductQty | 205 |
| 47 | bindinput onProductQtyInput | 185 |
| 48 | bindtap increaseProductQty | 195 |
| 59 | bindtap showManualForm | 223 |
| 69 | bindtap decreaseManualQty | 263 |
| 70 | bindinput onManualQtyInput | 269 |
| 71 | bindtap increaseManualQty | 259 |
| 73 | bindtap removeManualItem | 273 |
| 81 | bindchange onOrderDateChange | 281 |
| 87 | bindchange onDeliveryDateChange | 282 |
| 96 | bindinput onRemarkInput | 283 |
| 107 | bindtap saveDraft | 286 |
| 108 | bindtap submitRequest | 288 |
| 113/117 | bindtap hideManualForm | 233 |
| 114 | catchtap preventBubble | 234 |
| 122/133/137/141 | bindinput onManualInput | 236 |
| 127/128 | bindtap setManualCategory | 239 |
| 143 | bindtap confirmManual | 242 |

**purchase-detail.wxml**（10 个不同 handler，共 11 处绑定）
| wxml 行 | 绑定 | js 方法(行号) |
|---|---|---|
| 98 | bindtap previewVoucher | 183 |
| 106 | bindtap editRequest | 314 |
| 107 | bindtap submitRequest | 356 |
| 111 | bindtap copyToDraft | 320 |
| 115 | bindtap cancelOrder | 276 |
| 120 | bindtap remindAudit | 192 |
| 124 | bindtap requestCancel | 248 |
| 125 | bindtap cancelOrder | 276 |
| 129 | bindtap goReceive | 395 |
| 134 | bindtap submitVoucher | 139 |
| 137 / 138 | bindtap verifyDecide | 211（data-approve 区分） |

**purchase-list.wxml**（4 个不同 handler，共 5 处绑定）
| wxml 行 | 绑定 | js 方法(行号) |
|---|---|---|
| 6 | bindtap switchFilter | 111 |
| 13 / 17 | bindtap goDetail | 137 |
| 32 | catchtap goReceive | 141 |
| 45 | bindtap goCreate | 151 |

### 3.2 方向 B：js 定义了但 wxml 没引用 → **0 条**

三个页面的每个 Page 方法都能归类为「生命周期」「wxml 绑定」「被其他方法内部调用」之一：

- **purchase-create**：onLoad(生命周期)、loadExistingOrder(js:52)、loadReferenceData(js:51)、loadProducts(js:122)、updateFilteredCategories(js:121/142)、filterProducts(js:99/143/154/159/384)、_updateTotal(js:100/181/192/202/212/254/277)、_saveOrder(js:286/288) + 18 个 wxml 绑定方法。**无孤儿方法**。
- **purchase-detail**：onLoad/onShow(生命周期)、loadData(js:16/170/241/269/297)、_genRequestId(js:345/384) + 10 个 wxml 绑定方法。**无孤儿方法**。
- **purchase-list**：onLoad/onShow/onPullDownRefresh/onReachBottom(生命周期)、reload(js:38/42/113)、loadData(js:52/47)、renderList(js:108) + 4 个 wxml 绑定方法。**无孤儿方法**。

### 3.3 方向 C：wxml 读的 data 键在 js 没有来源 → **2 条**（1 条真实、1 条设计使然）

| # | 位置 | 现象 | 判定 |
|---|---|---|---|
| C1 | purchase-detail.wxml:3 `class="status-card status-bg-{{detail.statusType}}"` | `data.detail` 初值为 `{items: []}`（detail.js:8），`statusType` 只有在 loadData 成功 setData 后才有值（detail.js:121）→ **首帧类名为 `status-bg-undefined`**，wxss 只定义了 grey/primary/warning/success/danger 五种（wxss:13-17），无匹配规则 → 状态卡白字压在透明底上，**首帧文字不可读**；一旦加载失败（detail.js:27-30 不置失败态）则永久停留该态 | **真实缺陷** |
| C2 | purchase-detail.wxml:46 `wx:if="{{supplierGroups}}"` | `supplierGroups` 在 chef 分支下恒为 `null`（detail.js:45 `let supplierGroups = null`，js:119 setData 写入 null）→ chef 永远走 wxml:67 的 `wx:else` 平铺分支 | **设计使然**（detail.js:46 与 wxml:66 均有注释说明），非缺陷 |

补充核查（均有来源，不算 C 类）：
- `wxml:73 item.supplierConfirmText` 仅 chef 分支赋值（detail.js:48-52），非 chef 分支不渲染该键 → 来源存在但条件性。
- `purchase-list.wxml:8 item.count > 0` 来源后端 `statusCounts`（getPurchaseOrders:96-106），字段名一一对应。
- `purchase-create.wxml:46 value="{{item.qty || ''}}"` 来源 `filterProducts` 回填（create.js:172-179）。
- `purchase-create.wxml:87 start="{{today}}"` 来源 onLoad setData（create.js:50）。

### 3.4 方向 D：js 写入但 wxml 从不读取 → **7 条**

| # | 位置 | 现象 | 判定 |
|---|---|---|---|
| D1 | purchase-list.js:128 `itemCount: o.items.length` | 写入 `filteredList`，但 purchase-list.wxml 全文**没有任何商品种数渲染点**（只渲染 wxml:18-20 的 name×qty 标签）→ **纯死字段** | 死代码 |
| D2 | purchase-create.js:26 `tomorrow` | 仅在 js:50 用于初始化 `deliveryDate`，wxml 全文只读 `today`（wxml:87）→ `tomorrow` 写入 data 后无人读 | 死 data 键 |
| D3 | purchase-create.js:31 `isSubmitting` | setData 写入 4 次（js:341/373/388/416），**wxml:107-108 的两个按钮没有 `disabled="{{isSubmitting}}"`**，也无 loading 遮罩文案 → 该标志只服务 JS 内部护栏 | 标志定义但从未用于绑定（见 6 节） |
| D4 | purchase-list.js:16/17 `isLoading` / `isLoadingMore` | 写入（js:59/74/105/106），**wxml 没有任何加载中 UI**（wxml:36-43 只有 `loadFailed` 与空态）→ 上拉加载/下拉刷新过程零反馈 | 无意义状态 |
| D5 | purchase-create.js:14 `products` + js:120 `categories` | wxml 只读 `displayProducts` / `filteredCategories`；这两个是 JS 内部计算源（js:169/345-347）→ 属"仅供计算的状态"，非死代码，但**未在 data:{} 声明 categories**（wxss/初始化不可见） | 内部状态，非缺陷 |
| D6 | purchase-detail.js:8 `canCancel` / `voucherImages` | 均已绑定（wxml:115、97）→ **不算 D 类**，此处记录以证明已核对 | — |
| D7 | 详情域后端下发但前端不读：`receipts`、`reports`、items.`received_total` / `remaining_qty`（getPurchaseOrderDetail:113-116、141-142） | Grep `receipts|reports|received_total|remaining_qty|submittedAt` 于 `pages/purchase-detail/` → **No matches** → 后端为分批收货专门聚合了「已收 X / 剩余 Y」，**详情页从不展示**，用户看不到收货进度 | 无意义数据（前端侧） |

---

## 4. ★ 专项二：前端可控字段与金额/数量计算普查

### 4.0 本域货币字段的真实情况（先说结论）

**下单流程不存在金额字段。** `createPurchaseOrder/index.js:324-341` 构造的 `orderData` 中没有任何价格/金额键；两张报表（下单报表 csv1 :423-426、供应商订货汇总 :471-474）也只写数量、不写金额。
因此**"下单金额可篡改"在本域不成立**——没有下单金额。
本域唯一的货币真值是 `verify_amount`（手动单实付金额），见 4.2。

### 4.1 数量类字段

| 字段 | 前端位置 | 前端校验 | 后端独立复算 | 可否篡改 / 效果 |
|---|---|---|---|---|
| 档案商品下单数量 `orderQty` | create.js:185-193 `parseFloat(e.detail.value) || 0`；wxml:46 `type="digit"` | 无上限、无整数校验、允许小数、允许 0（0 会被 :298 过滤掉） | **是**：createPurchaseOrder:282-285 `Number(item.orderQty)` 必须 finite、`>0`、`<=1000000` | 可篡改量级，后端拦 `(0, 1e6]`；**小数会被接受并持久化**（后端无整数约束） |
| 手动商品数量 `qty` | create.js:242-256 confirmManual（`!qty || parseFloat(qty)<=0` 拒绝，:246）；:269-272 `parseFloat \|\| 1`；:263-268 下限 1。**两个输入口都是 `type="digit"`**（弹窗 wxml:137、行内 wxml:70） | 提交前校验 >0，**无上限、允许小数** | **是**：同上（createPurchaseOrder:282-285，手动行走同一校验） | 同上；另外手动行不能减到 0（:265），档案行可以（:208）——两侧不对称；弹窗内 qty 字段**校验被推迟到"确认添加"**，输入过程中无任何提示 |
| 手动商品条数 | create.js:223-227 上限 5 | 前端 5 | **是**：createPurchaseOrder:309-312 `> 5` 拒绝 | 前后端一致，可安全篡改尝试但会被拦 |
| 明细节数 | — | 前端无上限 | **是**：createPurchaseOrder:261 `items.length > 100` 拒绝 | 前端不设上限，超长只能靠后端拦 |

### 4.2 金额类字段（全批仅 1 处）

| 字段 | 前端位置 | 前端校验 | 后端独立复算 | 可否篡改 / 效果 |
|---|---|---|---|---|
| 手动单实付金额 `verify_amount` | detail.js:211-245 `verifyDecide`：`util.showPrompt` 输入 → `parseFloat(input)`（:220），仅拦 `isNaN \|\| amount <= 0`（:221） | 只校验 >0 | **部分**：dataService:1642 只拦 `!Number.isFinite(amount) \|\| amount <= 0`；**无上限、无精度约束、无与订单规模的合理性比对**，dataService:1648 原样落库 | **完全由核销人键盘决定**。可填 0.01 或 99999999.999。设计如此（dataService:1552-1555 注释"金额唯一可信来源是凭证，不查协议价表"），但前端**没有金额回显二次确认**，误录即闭环 |

### 4.3 日期类字段

| 字段 | 前端位置 | 前端校验 | 后端复算 | 备注 |
|---|---|---|---|---|
| `orderDate` | create.js:281 + wxml:81 picker（**无 start/end**） | 无 | createPurchaseOrder:170-177 `isDate()` 严格校验格式与真实日历日 | 允许补录历史日期，后端打 `backfilled` 标（:166、:331） |
| `deliveryDate` | create.js:282 + wxml:87 picker（`start="{{today}}"`） | 只能选今天及以后 | 同上 + `actualDeliveryDate < actualDate` 拒绝 | **前端无法保证 orderDate ≤ deliveryDate**：采购日期选明天 + 到货日期只能选今天 → 后端整单拒绝「采购日期或期望到货日期无效」，无预检 |
| 复制草稿的日期 | detail.js:339-340 `orderDate: 今天`、`deliveryDate: d.deliveryDate \|\| 今天` | 无 | 同上 | 若原单 deliveryDate 早于今天 → **整单被拒**，提示语用户难懂 |

### 4.4 文本 / 快照类字段

| 字段 | 前端位置 | 前端校验 | 后端处理 | 备注 |
|---|---|---|---|---|
| 整单备注 `remark` | create.wxml:97 `maxlength="200"` | 前端限 200 | createPurchaseOrder:339 `remark \|\| ''` **无长度校验** | 可绕过 maxlength 超长 |
| 明细备注 | create.wxml:141（无 maxlength） | 无 | createPurchaseOrder:401 原样存 | 无上限 |
| 手动商品名称/单位 | create.js:244-245 非空校验 | 有 | createPurchaseOrder:289 非空复校 | 一致 |
| 手动商品分类快照 `category` | create.js:345-348 由 L1 名称 + L2 名称拼接 | 前端拼文本 | createPurchaseOrder:396 **原样持久化** `category_snapshot: item.category`（档案行走 :299 取 DB 值） | **手动单的分类标签是前端可写文本**，无金额影响 |
| 档案商品的 productName/unit/category/supplierId | create.js:349-358 前端传 | — | createPurchaseOrder:295-304 **全部用 DB 值覆盖**（product_name / category_name / unit / default_supplier_id） | 前端传值仅作展示，**无法篡改落库快照** → 契约安全 |
| `storeId` / `storeName` | create.js:315-322 | 只校验 storeId 非空 | 非全局角色强制 `user.default_store_id` 并回查名称（:212-218）；全局角色校验门店有效并回查（:247-252） | 前端传值**被覆盖**，冗余 |
| `createdBy` / `createdByName` | create.js:326-327、detail.js:378-379 | — | createPurchaseOrder:342-347 **完全取服务端值** | 前端传值**被忽略**，冗余 |
| 手动商品 `productId` | create.js:248 `'MANUAL_' + Date.now()` → :350 作为 productId 提交 | 无 | createPurchaseOrder:290 原样存；:286-287 同单内重复即拒 | **同秒内连点"确认添加"生成相同 tempId → 后端报「采购商品不能重复」** |

### 4.5 上传路径归属

| 项 | 位置 | 路径由谁决定 | 备注 |
|---|---|---|---|
| 付款凭证 | detail.js:156-158 `cloudPath: 'vouchers/${this.orderId}/${Date.now()}_${i}${ext}'` | **前端决定**，`this.orderId` 取自 URL 参数、**未清洗** | 对比 cloud.js:231 `uploadReceiptPhotos` 有 `replace(/[^a-zA-Z0-9_-]/g,'')` 清洗 → **同仓两套上传口径不一致**；后端按 `vouchers/{orderId}/` 前缀校验归属（dataService:1564-1570），因路径与同一 orderId 同源构造，不构成跨单取用 |
| 凭证张数 | 前端 `count:3`（detail.js:144） vs 后端上限 9（dataService:1567） | 前端更严 | 不一致但不越权 |
| 验收照片 | **不在本批**（receive-verify.js:123/199 走 `cloud.uploadReceiptPhotos`） | 前端 | 本批仅边界标注 |
| 收货实收量 / 审批改量 | **不在本批**（receive-verify / approval 域） | — | 本批页面只被动展示，且后端聚合的 `received_total`/`remaining_qty` 详情页未渲染（见 D7） |

---

## 5. 页面间导航与参数传递

### 5.1 本批 3 页的出边

| # | 来源 | 目标 | 参数 | 目标 onLoad 是否读取 |
|---|---|---|---|---|
| E1 | purchase-list.js:138 `goDetail` | /pages/purchase-detail | `?id=<purchaseOrderId>` | 读（detail.js:12 `options.id \|\| options.orderId`） |
| E2 | purchase-list.js:146 `goReceive` | /pages/receive-verify | `?orderId=<id>&storeId=<storeId>` | 越出本批，未验证 |
| E3 | purchase-list.js:152 `goCreate` | /pages/purchase-create | **无参数** | create.js:36 读 `options.orderId \|\| options.id` → 均为 undefined → 新建流程 |
| E4 | purchase-detail.js:316 `editRequest` | /pages/purchase-create | `?orderId=<purchaseOrderId>` | 读（create.js:36），进入草稿编辑 |
| E5 | purchase-detail.js:350 `copyToDraft`（成功后 800ms） | /pages/purchase-create | `?orderId=<新草稿单号>` | 读（create.js:36） |
| E6 | purchase-detail.js:398 `goReceive` | /pages/receive-verify | `?orderId=<purchaseOrderId>&storeId=<storeId>` | 越出本批，未验证 |
| E7 | purchase-create.js:68 / :429 `wx.navigateBack()` | 上一页 | — | 无参数 |

### 5.2 指向本批页面的入边（全仓 Grep 取证）

| # | 来源 | 目标 | 参数 |
|---|---|---|---|
| I1 | pages/index/index.js:170 | /pages/purchase-detail | `?id=<dataset.id>` |
| I2 | pages/message/message.js:66 | /pages/purchase-detail | `?id=<message.bizId>` |
| I3 | pages/report-detail/report-detail.js:86 | /pages/purchase-detail | `?id=<orderId>` |
| I4 | pages/report-detail/report-detail.js:93 | /pages/purchase-detail | `?id=<orderId>` |
| I5 | purchase-list.js:138 | /pages/purchase-detail | `?id=` |
| I6 | purchase-detail.js:316 / :350 | /pages/purchase-create | `?orderId=` |
| I7 | purchase-list.js:152 | /pages/purchase-create | 无 |
| I8 | pages/index/index.js:165 | /pages/purchase-list | **`wx.switchTab`，无 URL 参数**（筛选值经 `globalData.pendingListFilter` 传递，index.js:163-164） |

### 5.3 读了但没用的参数

- `purchase-list.js:26` `options.status` —— **4 条入边（含唯一实际入边 I8）都没有传 status**；tabBar 页 switchTab 本身也不支持 URL 传参（index.js:163 注释自证）→ **恒为空串，死分支**。
- `purchase-detail.js:12` `options.orderId` 兜底 —— 5 条入边全部用 `?id=` → 兜底分支未使用（无害）。
- `purchase-create.js:36` `options.id` 兜底 —— 2 条入边全部用 `?orderId=` → 兜底分支未使用（无害）。

---

## 6. 死代码与未闭合点

| # | 位置 | 类型 | 证据 |
|---|---|---|---|
| 1 | purchase-list.js:26-28 | 死分支（参数永远为空） | 唯一入边 index.js:165 是 `wx.switchTab`；全仓 Grep `purchase-list` 无任何 `navigateTo` |
| 2 | purchase-list.js:128 `itemCount` | 死字段（算而不用） | wxml 全文无商品种数渲染点 |
| 3 | purchase-list.js:16/17 `isLoading` / `isLoadingMore` | 无 loading UI 的护栏标志 | wxml:36-43 只有 loadFailed 与空态，无任何加载中态 |
| 4 | purchase-create.js:26 `tomorrow` | 死 data 键 | wxml 仅读 `today`（wxml:87） |
| 5 | purchase-create.js:31 `isSubmitting` | 定义了但从未绑定到按钮 | wxml:107-108 无 `disabled` |
| 6 | purchase-list.js:144-148 `goReceive` 的 `if (order)` | catch 无 else 静默吞错 | find 不到时按钮点击无任何反馈 |
| 7 | purchase-detail.js:27-30 `loadData` 失败分支 | **吞错最刺眼**：只 toast，不置失败态 | 页面停留 `detail:{items:[]}` → wxml:44 渲染「商品清单 (0)」，用户误判为无商品 |
| 8 | purchase-create.js:105-108 / :129-132 | 加载失败与"无商品"同表现 | 均落到 wxml:52「暂无商品」 |
| 9 | purchase-detail.js:13 `onLoad` 无 id | 只 toast 不 navigateBack | 用户停在空白页，只能左滑 |
| 10 | purchase-detail.js:356-393 `submitRequest` | 缺 `_submitting` 互斥锁 | 同页 requestCancel(:257)/cancelOrder(:285)/verifyDecide(:212)/submitVoucher(:140) 都有锁 |
| 11 | purchase-detail.js:157 上传 cloudPath | 未清洗 `this.orderId` | 对比 cloud.js:231 `uploadReceiptPhotos` 有字符清洗，同仓口径不一致 |
| 12 | purchase-detail.js:144 vs dataService:1567 | 张数上限不一致（前端 3 / 后端 9） | 前端更严，不越权 |
| 13 | purchase-create.js:31 / :120 | `isSubmitting` / `categories` 未在 data:{} 声明 | categories 靠 setData 动态创建 |
| 14 | purchase-detail.js:119-135 | 10 个 setData 键未在 data:{} 声明 | supplierGroups/canCopy/canRequestCancel/canForceCancel/canRemindAudit/isManualOrder/verifyStatus/voucherBlockReason/canSubmitVoucher/canVerify |
| 15 | utils/cloud.js:243-252 `getFileUrl`（单数） | 全仓页面无调用点 | Grep `getFileUrl\(` 于 pages/ 仅命中 `getFileUrls(`（复数），单数零命中 |
| 16 | purchase-create.js:403-412 | **契约缺陷：手动单草稿被编辑时重复建单** | 见下方详述 |

### 6.1 编号 16 详述：手动单草稿经详情页「编辑」后再提交 → 重复建单

- **前置可达性**：chef 在下单页只加手动商品 → `hasManual=true, hasCatalog=false` → 走 else 分支（create.js:402-413）→ `reuseId = this.manualOrderId || undefined`，首次 `manualOrderId = ''`（create.js:37）→ `reuseId = undefined` → **新建一张纯手动草稿**，且 `this.manualOrderId` 直到成功分支 js:399 才会赋值，但那是拆单分支，本路径不回写。
- **回到详情页**：该草稿 `orderStatus === 'draft'` 且 `createdById` 匹配 → `canEdit = true`（detail.js:73-77）→ 显示「编辑」按钮（wxml:106）。
- **触发**：`editRequest` → `?orderId=<该手动草稿>` → create.js:36 `editingOrderId = <草稿号>`；loadExistingOrder 把手动行装进 `manualItems`（create.js:76-88），**但不回填 `this.manualOrderId`**（全方法无此赋值）。
- **提交**：此时 `hasManual=true, hasCatalog=false` → else 分支 → `reuseId = this.manualOrderId || undefined` = **undefined**（因为 `manualOrderId` 仍是 `''`）→ **不带 orderId 请求** → 后端视为新建（createPurchaseOrder:322 `orderNo = orderId || 生成新号`）→ **产生一张新单，原草稿原封不动留在草稿列表**。
- **后果**：一份采购意图落两张单；新单走提交→审批→报表，旧草稿永久滞留。
- **archP1-14 注释（create.js:405-407）**说明该分流是为了避免手动单号被误当作编辑目标，但代价是丢掉了 `editingOrderId` 这条本可复用的路径。
- **验证状态**：纯静态推演，未真机复现（见 7 节 U6）。

---

## 7. 未验证清单

| # | 事项 | 建议验证方式 |
|---|---|---|
| U1 | `wx.showModal({editable:true})`（util.js:103-107）依赖基础库 ≥2.17.1，`showPrompt` 是 detail 页 4 个写操作（verifyDecide/requestCancel/cancelOrder/copyToDraft）的唯一输入通道 | 真机/开发者工具确认基础库版本；低于该版本时 4 处输入框降级为普通确认框，`res.content` 恒为空 → 所有必填原因/金额都会被拦 |
| U2 | `isSubmitting` 未绑定 disabled，双击两个提交按钮的真实并发行为（依赖 `wx.showLoading({mask:true})`，util.js:73 阻断） | 真机连点两下「提交申请」，抓云函数请求次数；预期靠后端 request_id 幂等兜底 |
| U3 | detail.js:356 `submitRequest` 无互斥锁，双击「提交审核」的并发表现 | 同上，期望后端 createPurchaseOrder:183-210 幂等拦住并返回 idempotent |
| U4 | `catchtap` 用于 button 上（purchase-list.wxml:32）阻断冒泡的实际效果——是否成功避免同时触发同行的 goDetail | 真机点「去收货」按钮，确认只跳一个页面 |
| U5 | tabBar 页下拉刷新动画表现（purchase-list.json:3 开启 + js:41 有实现，静态已配对） | 真机下拉，确认动画能被 `wx.stopPullDownRefresh` 停住 |
| U6 | **6.1 节的手动单草稿重复建单缺陷** | 开发者工具：chef 账号 → 只加 1 个手动商品 → 存草稿 → 详情「编辑」→ 提交申请 → 回列表看是否出现 1 张草稿 + 1 张正式单 |
| U7 | `type="digit"` 输入小数/超大值的后端接受度（后端仅 finite/>0/<=1e6，无整数约束，createPurchaseOrder:282-285） | 手动单/档案单输入 `0.5` 与 `99999999`，确认落库值 |
| U8 | 详情页不展示「已收 X / 剩余 Y」（后端已下发 received_total/remaining_qty，getPurchaseOrderDetail:113-116）是否属设计取舍 | 需产品确认；建议收货中状态至少展示 remaining |
| U9 | chef 逐行看到供应商确认状态（detail.js:48-52 用 `item.supplierId` 打标签）是否符合"chef 不见供应商身份"的信息边界 | 需产品确认；后端明确不下发 supplier_name（getPurchaseOrderDetail:83-97） |
| U10 | `verify_amount` 无上限/无精度（detail.js:220-221 + dataService:1642）的实际录入风险 | 产品确认是否需要对金额做区间/精度校验或二次回显确认 |
| U11 | `MANUAL_` + `Date.now()` 同秒重名导致「采购商品不能重复」（create.js:248 + createPurchaseOrder:286-287） | 真机连续快速点两次「确认添加」再加同一商品名 |
| U12 | 前端无法保证 orderDate ≤ deliveryDate（wxml:81 无 start，wxml:87 start=today）导致后端整单拒绝的提示是否可理解 | 真机构造：采购日期选明天、到货日期保持今天 → 观察报错文案 |

共 **12 项**。

---

## 8. 行数对账

| 文件 | Read 观测行数 | PowerShell `Measure-Object -Line` | 差值 |
|---|---|---|---|
| pages/purchase-create/purchase-create.js | 436 | 402 | +34 |
| pages/purchase-create/purchase-create.wxml | 148 | 136 | +12 |
| pages/purchase-create/purchase-create.wxss | 165 | 149 | +16 |
| pages/purchase-create/purchase-create.json | 3 | 3 | 0 |
| pages/purchase-detail/purchase-detail.js | 402 | 385 | +17 |
| pages/purchase-detail/purchase-detail.wxml | 141 | 130 | +11 |
| pages/purchase-detail/purchase-detail.wxss | 153 | 128 | +25 |
| pages/purchase-detail/purchase-detail.json | 3 | 3 | 0 |
| pages/purchase-list/purchase-list.js | 155 | 138 | +17 |
| pages/purchase-list/purchase-list.wxml | 47 | 43 | +4 |
| pages/purchase-list/purchase-list.wxss | 123 | 108 | +15 |
| pages/purchase-list/purchase-list.json | 4 | 4 | 0 |
| utils/cloud.js | 283 | 265 | +18 |
| utils/util.js | 128 | 115 | +13 |
| utils/meta.js | 68 | 59 | +9 |
| utils/auth-guard.js | 17 | 15 | +2 |
| app.json | 75 | 74 | +1 |

- **本批 12 个文件 Read 行数合计 = 1820 行**；额外读取（utils 4 个 + app.json）= 496 行；后端核对读取（createPurchaseOrder 517 + getPurchaseOrders 149 + getPurchaseOrderDetail 112 + dataService 260）≈ 1038 行。**总计约 3354 行**。
- 差值列全部为正，符合已知的 Windows 上 `Measure-Object -Line` 少计 1–34 行现象；**本报告所有行号引用一律以 Read 观测行号为准**。

### 8.1 取证可靠性声明

本报告 0.4 节记录的 json 内容错位事件说明：批量 Read 的返回顺序可能与请求顺序不一致。三个 json 的最终内容均用独立手段复核过（`[System.IO.File]::ReadAllText` 带路径标签 dump + Grep 逐行定位）。因此**本报告没有提出"三个 json 的标题/开关被错换"这类缺陷**——那个结论是工具返回顺序造成的假象，已被排除。

---

## 9. 结论计数（便于汇总）

| 专项 | 条数 | 最刺眼 |
|---|---|---|
| 方向 A（wxml 引用了但 js 没有） | **0** | — （3 页共 40 处事件绑定、31 个 handler 全部命中） |
| 方向 B（js 定义了但 wxml 没引用） | **0** | — （每个方法均为生命周期 / 绑定 / 内部调用三者之一） |
| 方向 C（wxml 读的键无来源） | **2**（1 真实 + 1 设计使然） | `purchase-detail.wxml:3` 首帧 `status-bg-undefined` → 状态卡白字不可读；加载失败则永久停留 |
| 方向 D（js 写但 wxml 从不读） | **7** | `purchase-list.js:128 itemCount` 纯死字段；`purchase-detail` 从不展示后端已下发的 `received_total/remaining_qty` |
| 前端可控数量/金额字段 | **3 个数量 + 1 个金额** | `verify_amount`（detail.js:220）前后端都只拦 >0，**无上限、无精度**；数量后端有 1e6 上限但无整数约束 |
| 后端独立复算 | 数量 ✓（createPurchaseOrder:282-285）、金额部分 ✓（dataService:1642）、日期 ✓（:170-177）、快照/门店/创建人 ✓ 后端覆盖 | 下单金额**字段不存在**（createPurchaseOrder:324-341）→ 该篡改面在本域不成立 |
| 死代码 / 未闭合点 | **16 条** | #7 `purchase-detail.js:27-30` 加载失败只 toast、不置失败态 → 渲染「商品清单 (0)」；#16 手动单草稿被编辑后重复建单（create.js:403-412） |
| 未验证项 | **12 条** | U6 手动单草稿重复建单需真机复现；U1 `wx.showModal({editable:true})` 基础库版本依赖 |
