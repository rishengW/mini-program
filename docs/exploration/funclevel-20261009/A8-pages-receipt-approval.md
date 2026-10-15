# A8 · 收货/审批/异常/消息页（6 页）· 函数级清单

> 基线：`backup` @ `73b0730`（与 `00-crosscutting-verified.md` 同基线）
> 范围：`pages/approval-list`、`pages/approval-detail`、`pages/receive-list`、`pages/receive-verify`、`pages/abnormal-list`、`pages/message` 各 4 件套，共 24 个文件
> 契约对照来源：`utils/cloud.js`（283 行）、`utils/util.js`（128 行）、`utils/auth-guard.js`（17 行）、`utils/meta.js`（68 行）、`app.json`（75 行），以及只读对照的 6 个云函数（`getPurchaseOrders`/`getPurchaseOrderDetail`/`getReceipts`/`createReceipt`/`dataService`/`createPurchaseOrder`/`confirmSupplierOrder`）

---

## 0. 范围与方法

24 个文件全部逐行 Read 完成，实测行数（`Measure-Object` 计数，与 Read 输出一致）：

| 目录 | .js | .wxml | .wxss | .json |
|---|---|---|---|---|
| approval-list | 105 | 36 | 70 | 4 |
| approval-detail | 113 | 70 | 80 | 3 |
| receive-list | 185 | 57 | 44 | 4 |
| receive-verify | 276 | 94 | 145 | 3 |
| abnormal-list | 110 | 57 | 73 | 3 |
| message | 83 | 30 | 78 | 3 |
| **合计** | **872** | **344** | **490** | **20** |

六页共 **37 个前端方法**（含 1 个模块级函数 `recoverCommittedReceipt`）。

**未读范围声明**：
- 6 个 wxss 均为纯样式（已逐个 Read 确认，无 JS 逻辑），仅在其中做了一次"CSS 类名 ↔ wxml class 属性"抽查，不做完整样式审计。
- 云函数侧仅读了与本批页面契约直接相关的片段（`dataService` 的 `auditOrder`/`getMessages`/`markMessageRead`/`markAllMessagesRead`/`getAbnormalRecords`/`startAbnormal`/`resolveAbnormal`/`closeAbnormal`/`settleReceipt`/`repriceReceipt`/`regenerateReceiptReports`/`createMessage`/`getOrderStats`/`regenerateApprovedOrderReports`/催审，`createReceipt` 全文，`getPurchaseOrders`/`getPurchaseOrderDetail`/`getReceipts` 全文，`createPurchaseOrder`/`confirmSupplierOrder` 的消息与状态写入片段）。未读：`purchase-detail`、`report-list`、`supplier-*` 等 25 个其余页面（属其他子代理范围）。
- 未运行小程序，所有"运行时行为"结论均标注为静态推断。

---

## 1. 页面配置与生命周期

### 1.1 approval-list（待审核列表）
- `Page()` data：`{ list: [], loadFailed: false }`（:8）——**只有这两个键，无 loading 态**。
- `.json`：`navigationBarTitleText: '待审核申请'`、`enablePullDownRefresh: true`（:2-3）。
- `app.json`：注册在 `pages[7]`（app.json:10），**非 tabBar 页**。
- 生命周期：只有 `onShow`（:10）+ `onPullDownRefresh`（:59）。**无 `onLoad`**，因此不接受任何跳转参数——审批列表永远只能看"全部待审"，无法按门店/创建人筛选（`storeId` 只能取当前选中门店）。
- 数据来源：`getPurchaseOrders`（独立云函数，非 dataService action），参数 `{role, storeId, createdBy:'', pageSize:100}`。
- 双层守卫：`authGuard.requireLogin()`（:11）+ 角色白名单 `['super_admin','purchaser']`（:14），不满足则 toast + 800ms 后 `navigateBack`。

### 1.2 approval-detail（审批详情，改量审批在此）
- data：`{ detail: {}, auditRemark: '', loadFailed: false }`（:7-11）。**无 loading 态**。
- `.json`：仅标题（2 行）。无下拉刷新。
- `app.json`：`pages[8]`（app.json:11），非 tabBar。
- 生命周期：`onLoad(options)`（:13）读 `options.id || options.orderId`（:22）。有 `retryLoad`（:57）作为失败重试入口。
- 角色守卫同 approval-list（:16-21）。
- 数据来源：`getPurchaseOrderDetail`（独立云函数）。

### 1.3 receive-list（待收货 + 最近收货记录，双数据源）
- data：`{ orders: [], receipts: [] }`（:8）——**两个键，无 loading、无 loadFailed**。
- `.json`：标题 + `enablePullDownRefresh: true`（:2-3）。
- `app.json`：`pages[9]`（app.json:12），非 tabBar。
- 生命周期：`onShow`（:10）+ `onPullDownRefresh`（:108）。无 `onLoad` → 不接受任何参数（对消息跳转闭环的影响见 §5）。
- 数据来源：`Promise.all` 并行拉 `getPurchaseOrders`（pageSize 100）+ `getReceipts`（page 1, pageSize 5）（:19-32）。
- 额外派生三个权限标志 `canRegenerate`/`canReprice`/`canSettle`（:84-87），全部只在成功分支写入。

### 1.4 receive-verify（收货验收，全仓最复杂的写页）
- data：`{ order: {}, items: [], photos: [], overallRemark: '', isSubmitting: false }`（:40-46）。
- `.json`：仅标题。无下拉刷新。
- `app.json`：`pages[10]`（app.json:13），非 tabBar。
- 生命周期：`onLoad(options)`（:48）读 `options.orderId || options.id`（:58）。
- 模块级函数 `recoverCommittedReceipt`（:6-37）用于"响应丢失但事务已提交"的自愈判定。
- 角色守卫：仅拦 `chef`（:53），因为 `createReceipt` 后端白名单不含 chef；其余角色（含 supplier）不做前端拦截，交由后端 403。

### 1.5 abnormal-list（异常处理）
- data：`{ activeFilter: 'all', filteredList: [], records: [] }`（:7-11）。**无 loading、无 loadFailed**。
- `.json`：仅标题。无下拉刷新。
- `app.json`：`pages[11]`（app.json:14），非 tabBar。
- 生命周期：只有 `onShow`（:13）。**无 `onLoad`** → 跳转参数全部丢弃（§5 关键结论）。
- 数据来源：`dataService.getAbnormalRecords`，**不传任何参数**——门店/角色过滤完全由后端从会话派生。

### 1.6 message（消息中心）
- data：`{ messages: [], unreadCount: 0 }`（:7-10）。**无 loading、无 loadFailed**。
- `.json`：仅标题。无下拉刷新，js 也未实现 `onPullDownRefresh`。
- `app.json`：`pages[13]`（app.json:15），**是 tabBar 第 4 页**（app.json:61-66，文字"消息"、图标 `assets/icons/bell.png`）。因此它是所有业务通知的落点，且只能靠 `switchTab` 进入、`navigateTo` 离开。
- 生命周期：只有 `onShow`（:12）。无 `onLoad`。
- 数据来源：`dataService.getMessages`，无参数。

**跨页共性**：6 页里有 **4 页（receive-list / abnormal-list / message / receive-verify）在数据加载失败时不置任何失败态**，失败后 `data` 保持空数组，wxml 的 `wx:if="{{xxx.length === 0}}"` 因此渲染出**假空态**（"暂无待收货订单"/"暂无异常记录"/"暂无消息"）。只有 approval-list（:30 `loadFailed`）与 approval-detail（:28 `loadFailed`）做了区分。详见 §7。

---

## 2. 前端函数清单

> 失败态核查为每方法必填项。`-` 表示该字段不适用。

### 2.1 pages/approval-list/approval-list.js（105 行）

#### `onShow()` （approval-list.js:10-57）
- **触发方式**：`onShow` 生命周期（页面每次显示，含从 approval-detail 返回）
- **入参**：无（无 `options`）；读 `getApp().globalData.userInfo.role`、`userInfo`、`currentStore.storeId`
- **调用云函数**：`getPurchaseOrders`，参数 `{role, storeId, createdBy:'', pageSize:100}`；期望返回 `{code, data:[order...], total, page, pageSize, statusCounts}`
- **成功分支**：`setData({loadFailed:false})` → map `cloud.normalizePurchaseOrder` → 过滤 `orderStatus ∈ {submitted, pending_approval}` → 重命名快照字段 → `setData({list})`
- **失败分支**：**置 `loadFailed:true` 并 toast + return**（:28-33）——本批中做得最规范的失败态。wxml:28-31 有对应"加载失败，请下拉重试"分支
- **副作用**：无 `wx.` 调用、无 `setStorage`
- **契约风险**：①`role` 是死参数——`getPurchaseOrders:43-66` 完全从会话派生角色，不读 `event.role`；②`pending_approval` 是死状态，全仓无写入点（`createPurchaseOrder:158` 默认 `orderStatus='submitted'`；`grep pending_approval` 在 `cloudfunctions/` 下只出现于读取白名单 `dataService:515/554`、统计 `getPurchaseOrders:87`、以及在途状态集合 `updateProductPrice:43`、隐藏列表 `getSupplierOrders:12`，无任何写入）→ 过滤条件的一半是永假分支；③`pageSize:100` 写死，超过 100 条待审会静默截断，且 wxml:5 的"共 N 条"显示的是**截断后**的长度，与实际待审数不符
- **WXML 绑定核查**：本方法无绑定（生命周期）

#### `onPullDownRefresh()` （approval-list.js:59-62）
- **触发方式**：`.json:3` `enablePullDownRefresh: true` → 框架绑定
- **入参**：无
- **调用云函数**：无（内部调 `this.onShow()`）
- **成功/失败分支**：**不判断 `onShow` 结果就直接 `wx.stopPullDownRefresh()`**（:60-61）。`onShow` 失败时已置 `loadFailed:true`，所以刷新后能看到失败态，但下拉动画无条件停止——可接受
- **副作用**：`wx.stopPullDownRefresh()`
- **契约风险**：`onShow` 是 async 但此处 `await` 正确
- **WXML 绑定核查**：框架绑定，非 wxml 显式引用

#### `goDetail(e)` （approval-list.js:64-66）
- **触发方式**：wxml:8 `bindtap="goDetail" data-id="{{item.id}}"`
- **入参**：`e.currentTarget.dataset.id`（= `purchaseOrderId`，由 :41 `id: o.purchaseOrderId` 赋值）
- **调用云函数**：无
- **成功/失败分支**：无异步，无失败态
- **副作用**：`wx.navigateTo({url:'/pages/approval-detail/approval-detail?id='+id})`
- **契约风险**：**`id` 未做 URL 编码**——`purchase_order_id` 形如 `PO20261009xxxx`（纯字母数字下划线，见 `createPurchaseOrder:392` 的 item_id 规则同源），实测无特殊字符，风险为 0 但未编码是隐患
- **WXML 绑定核查**：有绑定（wxml:8）

#### `approveRequest(e)` （approval-list.js:68-87）
- **触发方式**：wxml:24 `catchtap="approveRequest" data-id="{{item.id}}"`（`catchtap` 阻断冒泡，避免同时触发外层 `bindtap="goDetail"`）
- **入参**：`e.currentTarget.dataset.id`
- **调用云函数**：`dataService`，`{action:'auditOrder', orderId, status:'approved', items:[]}`；期望返回 `{code, data:{reportWarning}}`
- **成功分支**：有 `reportWarning` → toast 警告；无 → `showSuccess('已通过')`；随后 `this.onShow()` 刷新列表（不跳走）
- **失败分支**：`util.showToast(result.msg || '审核失败')` → **return，不置失败态**。列表不刷新，用户可重试；`_submitting` 在 `finally` 中复位（:84-86）
- **副作用**：`util.showConfirm`（wx.showModal）、`util.showToast`/`showSuccess`；**无 loading**（确认框期间无遮罩，靠 `_submitting` 布尔防双击）
- **契约风险**：**★ 列表页审批传 `items:[]` → 后端 `qtyMap` 为空（`dataService:526-532`）→ 不写 `approved_qty`/`original_order_qty`（:558-571）→ `qtyChanged=false`（:614-617）→ 跳过下单报表重算**。也就是说**从列表页一键"通过"永远按申请全量通过**，改量能力只在 approval-detail 可用。若审批人漏看明细直接点列表"通过"，改量机会被跳过，且没有任何提示。这是本批最实质的交互缺陷
- **WXML 绑定核查**：有绑定（wxml:24）

#### `rejectRequest(e)` （approval-list.js:89-104）
- **触发方式**：wxml:23 `catchtap="rejectRequest" data-id="{{item.id}}"`
- **入参**：`e.currentTarget.dataset.id`
- **调用云函数**：`dataService`，`{action:'auditOrder', orderId, status:'rejected', auditRemark:'审核驳回', items:[]}`
- **成功分支**：`showToast('已驳回')` + `this.onShow()`
- **失败分支**：toast + return，`finally` 复位 `_submitting`
- **副作用**：`util.showConfirm`
- **契约风险**：**★ `auditRemark` 硬编码为 `'审核驳回'`**——用户无法填写驳回原因。对比 approval-detail 的 `rejectRequest` 会校验 `this.data.auditRemark` 必填（approval-detail.js:95-98），列表页绕过该入口即可以一句模板文案驳回任意订单；后端 `dataService:518` 只要求非空，无法察觉。两页驳回语义不一致
- **WXML 绑定核查**：有绑定（wxml:23）

### 2.2 pages/approval-detail/approval-detail.js（113 行）

#### `onLoad(options = {})` （approval-detail.js:13-48）
- **触发方式**：`onLoad` 生命周期
- **入参**：`options.id || options.orderId`（:22）
- **调用云函数**：`getPurchaseOrderDetail`，`{orderId}`；期望返回 `{code, data:{...order, items, receipts, reports}}`
- **成功分支**：`normalizePurchaseOrder` → 构造 `detail`（含 `requesterName`/`expectedDeliveryDate`/`submittedAt` + items 映射出 `productName`/`spec`/`unit`/`requestedQty`/`approveQty`）→ `setData({detail})`
- **失败分支**：**置 `loadFailed:true`** + toast + return（:27-31）；wxml:4-8 有失败态与"重试"按钮 → `retryLoad`
- **副作用**：无
- **契约风险**：①**items 映射把 `item.categorySnapshot` 当 `spec`**（:41）——快照字段语义被改名，若后端快照口径变化会静默错位；②`detail.items[].approveQty` 默认等于 `orderQty`（:44），未做"审批量不得超过下单量"的前端校验，只能靠后端 `dataService:541` 兜住（`qty > sourceItem.order_qty` → 拒绝）；③未校验 `detail.orderStatus`，页面不阻止对已审核订单重复提交（后端 `dataService:515` 会拒）
- **WXML 绑定核查**：无绑定（生命周期）

#### `onApproveQtyInput(e)` （approval-detail.js:50-54）
- **触发方式**：wxml:51-52 `bindinput="onApproveQtyInput" data-index="{{index}}"`
- **入参**：`dataset.index`、`e.detail.value`
- **调用云函数**：无
- **成功/失败分支**：无异步
- **副作用**：`setData({ ['detail.items[index].approveQty']: val })`
- **契约风险**：**★ `parseFloat(e.detail.value) || 0`——输入过程中中间态会被吞成 0**。用户清空输入框想重填时 value 变 `0`，`setData` 写入 0，再点"通过"会被 :73 的校验拦下并 toast「审批数量必须大于 0」。功能上安全（后端也拦），但 UX 上"清空即 0"会让用户以为输入被清空了。另外小数会被 `parseFloat` 接受（wxml 用 `type="digit"` 允许小数点），后端 `dataService:541` 只校验 `qty > 0`，**非整数审批量可通过**（是否算缺陷取决于业务是否允许小数收货，未验证）
- **WXML 绑定核查**：有绑定（wxml:52）

#### `retryLoad()` （approval-detail.js:57-60）
- **触发方式**：wxml:7 `bindtap="retryLoad"`
- **入参**：无（用 `this.orderId`）
- **调用云函数**：内部调 `this.onLoad({id: this.orderId, orderId: this.orderId})`
- **成功/失败分支**：先 `setData({loadFailed:false})` 再重载；失败会再次置 `loadFailed:true`——**唯一有"失败→重试"闭环的页面**
- **副作用**：无
- **WXML 绑定核查**：有绑定（wxml:7）

#### `onAuditRemarkInput(e)` （approval-detail.js:62-64）
- **触发方式**：wxml:62 `bindinput="onAuditRemarkInput"`
- **入参**：`e.detail.value`
- **调用云函数**：无；**副作用**：`setData({auditRemark})`
- **契约风险**：无长度上限、无 trim；后端 `dataService:518` 用 `String(...).trim()` 判空 → 纯空格能通过前端非空检查（:95 `if (!this.data.auditRemark)` 对 `'   '` 为真，能拦住），实际上前端也拦得住纯空格
- **WXML 绑定核查**：有绑定（wxml:62）

#### `approveRequest()` （approval-detail.js:66-91）
- **触发方式**：wxml:66 `bindtap="approveRequest"`（**无 data-* 传参**，用 `this.orderId`）
- **入参**：无（dataset 空）
- **调用云函数**：`dataService`，`{action:'auditOrder', orderId:this.orderId, status:'approved', items:[{itemId, approveQty}...]}`（:79-82，全量传所有行）
- **成功分支**：有 `reportWarning` → toast；否则 `showSuccess('审核通过')`；800ms 后 `wx.navigateBack()`
- **失败分支**：toast + return，`finally` 复位 `_submitting`；**页面停留在原状，用户已填的审批量与备注都还在**——可重试
- **副作用**：`util.showConfirm`、`wx.navigateBack`
- **契约风险**：前端只校验 `approveQty > 0`（:73），不校验上限，见 `onApproveQtyInput` 条目
- **WXML 绑定核查**：有绑定（wxml:66）

#### `rejectRequest()` （approval-detail.js:93-112）
- **触发方式**：wxml:65 `bindtap="rejectRequest"`
- **入参**：无
- **调用云函数**：`dataService`，`{action:'auditOrder', orderId, status:'rejected', auditRemark:this.data.auditRemark, items:[]}`
- **成功分支**：`showToast('已驳回')` + 800ms 后 `navigateBack`
- **失败分支**：`auditRemark` 为空时 toast「请填写驳回原因」+ return（:95-98）；云函数失败 toast + return
- **副作用**：`util.showConfirm`、`wx.navigateBack`
- **契约风险**：无
- **WXML 绑定核查**：有绑定（wxml:65）

### 2.3 pages/receive-list/receive-list.js（185 行）

#### `onShow()` （receive-list.js:10-89）
- **触发方式**：`onShow` 生命周期
- **入参**：无；读 `globalData.userInfo.{role,userId,id,name}`、`globalData.currentStore.{storeId,id}`
- **调用云函数**：`Promise.all([getPurchaseOrders{role,storeId,createdBy,pageSize:100}, getReceipts{role,storeId,page:1,pageSize:5}])`
- **成功分支**：orders 过滤 `['approved','report_generated','partial_received']` 并派生 `itemCount`/`manualCount`/`statusText`/`statusType`；receipts 逐条归一化（`receiptId`/`receiptDate`/`storeName`/`receivedBy`/`receiptStatus`/`hasAbnormal`/`statusText`/`statusType`/`missingReports`/`hasMissingPrice`/`photoCount`/`items`）；`setData({orders, receipts, canRegenerate, canReprice, canSettle})`
- **失败分支**：
  - 抛异常（catch :33-37）：toast + return，**不置失败态**
  - `result.code !== 0`（:38-41）：toast + return，**★ `orders` 仍为空数组 → wxml:27-30 渲染"暂无待收货订单"假空态**。这是本批最刺眼的失败态缺陷
  - `receiptResult.code !== 0`（:57-62）：toast + `setData({orders})` + return——**这里反而做对了**（注释 :58 明确说明"不渲染成'没有记录'的假空态"），保留旧 `receipts` 数据。但注意 `orders` 被清空重设、`canRegenerate/canReprice/canSettle` 三个标志**不写入**（见 :82-88 只在下方成功路径写）
- **副作用**：无 `wx.` 调用（除 toast）、无 storage
- **契约风险**：
  - **`role`/`storeId` 传参对 chef 与 store_manager 全是死参数**：`getPurchaseOrders:51-60` 与 `getReceipts:50-58` 一律从会话派生；chef 分支（:23）传 `createdBy: user.userId || user.id || user.name || ''`，其中 `user.name` 兜底**语义错误**（createdBy 应为 ID），且即便传对也被后端忽略
  - **`hasMissingPrice`（:76-78）在前端复刻了后端 `createReceipt:403` 的缺价判定**，字段名用 camelCase 兼容（`it.priceSnapshot !== undefined ? it.priceSnapshot : it.price_snapshot`）——双重实现易漂移，且判定依据 `receipt.items`（即 `receipt_item` 原始文档），与后端 `missing_price` 异常记录是**两套独立信号**（后者才会让 `settleReceipt`/`repriceReceipt` 生效）
  - **`receiptDate` 与 `orderDate` 未经过 `cloud.formatDateTime` 格式化**：wxml:9 `{{item.storeName}} · {{item.orderDate}}` 与 wxml:36 `{{item.storeName}} · {{item.receiptDate}}` 直接渲染原始值。`orderDate` 来自 `normalizePurchaseOrder:140`（原样字符串，未被 formatDateTime 处理），`receiptDate` 来自 `receipt.receipt_date` 原样（getReceipts:85 直接 spread）。后端 `created_at` 是 `db.serverDate()` 的 Date 对象，而 `order_date`/`receipt_date` 是客户端/服务端写入的字符串——**存储形状不一致**，前端呈现取决于历史写入格式（`createReceipt:335-337` 写的是 `YYYY-MM-DD` 字符串，`createPurchaseOrder` 同）→ 大概率显示为纯日期字符串而非完整时间戳；但与其他页面统一用 `formatDateTime` 的做法不符，且一旦有 Date 对象写入就会显示 `[object Object]`。列为契约风险 + 未验证
  - `pageSize:5`（:30）使"最近收货记录"永远只有 5 条，页面标题写"最近收货记录"（wxml:33）语义自洽，但**没有任何翻页/查看全部入口**，超 5 条的历史收货只能去 supplier-receipts 或报表页看（是否算缺陷未验证，属产品决策）
- **WXML 绑定核查**：无绑定（生命周期）

#### `onPullDownRefresh()` （receive-list.js:108-111）
- **触发方式**：`.json:3` 下拉刷新 → 框架绑定
- **入参**：无；**调用云函数**：内部调 `onShow`
- **成功/失败分支**：无条件 `wx.stopPullDownRefresh()`（:110）
- **契约风险**：`await this.onShow()`——`onShow` 内部有 `return` 提前退出但不抛错，故不会中断
- **WXML 绑定核查**：框架绑定

#### `previewReceiptPhotos(e)` （receive-list.js:92-106）
- **触发方式**：wxml:49 `catchtap="previewReceiptPhotos" data-index="{{index}}"`
- **入参**：`dataset.index` → `this.data.receipts[index]` → `receipt.photo_file_ids`
- **调用云函数**：**`cloud.getFileUrls(fileIds)`**（cloud.js:255，客户端直调 `wx.cloud.getTempFileURL`，**无鉴权**——已核实事实，不重报）
- **成功分支**：`wx.previewImage({current: urls[0], urls})`
- **失败分支**：`fileIds` 为空或 `urls` 为空 → toast「照片加载失败，请稍后重试」+ return；**不置失败态**（本方法无失败态可置）
- **副作用**：`util.showLoading('加载照片...')` → `wx.hideLoading()`（:98-100），**`hideLoading` 不在 finally 中**——若 `getFileUrls` 抛错（cloud.js:255 内部有 try/catch 返回 `[]`，不抛），会跳过 hideLoading。当前实际不会悬挂，但结构不健壮
- **契约风险**：`wx.previewImage` 的 `current` 恒为 `urls[0]`，**忽略用户点击的是哪张照片**（data-index 只用于定位 receipt，不用于定位图序）。多图预览时始终从第一张打开。小缺陷
- **WXML 绑定核查**：有绑定（wxml:49）

#### `goVerify(e)` （receive-list.js:113-115）
- **触发方式**：wxml:7 `bindtap="goVerify" data-id="{{item.purchaseOrderId}}"`
- **入参**：`dataset.id`
- **调用云函数**：无
- **成功/失败分支**：无
- **副作用**：`wx.navigateTo('/pages/receive-verify/receive-verify?orderId='+id)`
- **契约风险**：跳转后 receive-verify 的 `onLoad` 读 `options.orderId`（receive-verify.js:58）→ 契约一致 ✓
- **WXML 绑定核查**：有绑定（wxml:7）

#### `settleReceipt(e)` （receive-list.js:118-137）
- **触发方式**：wxml:52 `catchtap="settleReceipt" data-id="{{item.receiptId}}"`，可见条件 `item.hasAbnormal && canSettle`
- **入参**：`dataset.id`（receiptId）
- **调用云函数**：`dataService`，`{action:'settleReceipt', receiptId}`；期望返回 `{code, data:{generatedSuppliers, count}}`
- **成功分支**：`showSuccess('补结算完成，已生成补充账单')`；**★ 不调用 `this.onShow()` 刷新**（对比 `regenerateReports:159` 与 `repriceReceipt:183` 都调了）→ "补结算"链接因 `hasAbnormal` 不变而持续可见，用户可重复点击，靠后端幂等检查 `dataService:932-933`（`report_id` 以 `receiptId+'_S'` 结尾）+ 并发锁 `:939-947` 兜住，第二次会得到「该收货单已补结算，请勿重复操作」的 toast
- **失败分支**：toast + return，无失败态；`_submitting` 在 :131 复位
- **副作用**：`util.showConfirm`、`util.showLoading('补结算中...')` → `wx.hideLoading()`（:130，同样不在 finally）
- **契约风险**：**`_submitting` 在 `showConfirm` 之后才置位**（:121-124），与 receive-verify.js:187-188 的注释「先置位再弹确认框，避免弹窗期间双击并发提交」相反——确认框弹出期间双击可并发进入。实际影响小（需连点两次），但两页写法不一致
- **WXML 绑定核查**：有绑定（wxml:52）

#### `regenerateReports(e)` （receive-list.js:140-160）
- **触发方式**：wxml:50 `catchtap="regenerateReports" data-id="{{item.receiptId}}"`，可见条件 `item.missingReports && canRegenerate`
- **入参**：`dataset.id`
- **调用云函数**：`dataService`，`{action:'regenerateReceiptReports', receiptId}`
- **成功分支**：`showSuccess('补生成完成')` + `await this.onShow()`（:159，刷新后 `missing_reports` 被后端 `dataService:1339` 清 false → 链接消失，闭环正确）
- **失败分支**：toast + return
- **副作用**：`showConfirm`、`showLoading('补生成中...')`/`hideLoading`（:152-153，不在 finally）
- **契约风险**：**★ 这是"收货侧"缺报表的补救路径（`MSG_REPORT_MISSING` 消息指向它）。但"下单侧"缺报表（`MSG_ORDER_REPORT_MISSING`，`createPurchaseOrder:88-100`）的唯一补救 `regenerateOrderReports` 前端 0 调用**（已核实事实，不重报）——本方法是**唯一可达**的补报表入口，覆盖了 createReceipt 的失败场景，未覆盖 createPurchaseOrder 的失败场景
- **WXML 绑定核查**：有绑定（wxml:50）

#### `repriceReceipt(e)` （receive-list.js:163-184）
- **触发方式**：wxml:51 `catchtap="repriceReceipt" data-id="{{item.receiptId}}"`，可见条件 `item.hasMissingPrice && canReprice`
- **入参**：`dataset.id`
- **调用云函数**：`dataService`，`{action:'repriceReceipt', receiptId}`；期望返回 `{code, data:{message, repriced, stillMissing}}`
- **成功分支**：`showSuccess(data.message || '补价补账完成')` + `await this.onShow()`（:183）
- **失败分支**：toast + return。后端两种业务失败：无缺价行 `dataService:1118`、补价后仍缺 `:1143`
- **副作用**：`showConfirm`、`showLoading('补价补账中...')`/`hideLoading`（:175-176，不在 finally）
- **契约风险**：**前置条件是"商品已配价"，但页面不提供价格管理页的跳转**（`price-manage` 在 app.json:20 存在）。用户点了按钮、提示"请先在价格管理页补配价格"后，需要自行导航——提示文案里写了这句（:166），但没有可点链接。可用性缺口（非崩溃）
- **WXML 绑定核查**：有绑定（wxml:51）

### 2.4 pages/receive-verify/receive-verify.js（276 行）

#### `recoverCommittedReceipt(orderId, failedResult)` （receive-verify.js:6-37，模块级）
- **触发方式**：内部调用，`submitReceipt` 失败后（:238）
- **入参**：`orderId`、`failedResult`（{code,msg,errorType}）
- **调用云函数**：`getPurchaseOrderDetail`，`{orderId}`（幂等读）
- **成功/失败分支**：
  - 前置门 `shouldCheck`（:8-11）：`errorType==='CLOUD_UNAVAILABLE'` 或 `msg` 匹配 `/已完成收货|不可收货|连接失败|Not connected/i`，否则返回 `null`
  - 查到 `orderStatus==='received'` 或 `receipts.length>0`（:21）→ 构造一个 `code:0` 的伪成功返回，含 `reportWarning:'连接中断导致报表状态未返回，请稍后在报表中心查看。'` 与 `recovered:true`
  - 否则返回 `null`
- **副作用**：无
- **契约风险**：**★ 用 `receipts[0]` 作为"本次提交"的结果证据（:23）**。`getPurchaseOrderDetail:120-123` 查 `receipt` **没有 `orderBy`**，MongoDB 默认按 `_id` 自然序返回，`receipts[0]` 是**最早一批**收货单。分批收货场景下：若第 3 批提交遭遇网络丢失（`errorType==='CLOUD_UNAVAILABLE'`），而订单此前已有第 1、2 批记录，该函数会把**第 1 批**的 `receiptId` 当作本次提交结果返回，并展示 `hasAbnormal`（基于第 1 批状态）与固定的 `abnormalTypeNames: []`、`reportWarning`。用户会被告知"收货已保存"，但展示的是历史批次的单号与异常状态，**可能误判为"本批没有异常"**。此外 `recovered:true` 这个字段前端从未消费（:248-271 的分支只看 `hasReportWarning`/`hasAbnormal`），属死字段
  - `shouldCheck` 的正则匹配 `不可收货`/`已完成收货` 是**业务失败文案**，但 `getPurchaseOrderDetail` 复查能正确区分（订单状态未变 → `receipts.length===0` → 返回 null），因此这两类误报被正确抑制；真正的问题只在 `CLOUD_UNAVAILABLE` 与分批共存时
- **WXML 绑定核查**：无绑定（内部函数）

#### `onLoad(options = {})` （receive-verify.js:48-103）
- **触发方式**：`onLoad` 生命周期
- **入参**：`options.orderId || options.id`（:58）
- **调用云函数**：`getPurchaseOrderDetail`，`{orderId:id}`
- **成功分支**：`normalizePurchaseOrder` → items 映射出 `receivedTotal`（:81，读 `item.received_total`）、`remainingQty`（:82-84，优先 `item.remaining_qty`，缺失则 `orderQty - receivedTotal` 兜底）、`receivedQty:0`、`priceSnapshot:0`、`payableFlag:true`、三个异常布尔 false、`remark:''` → `setData({order, items})`
- **失败分支**：
  - 无 id（:59-62）：toast + return，**不置失败态**
  - 订单加载失败（:69-72）：toast + return，**★ 不置失败态**——页面停在只含"待验收"标签的空壳上，商品列表 `wx:for="{{items}}"` 不渲染，提交按钮仍可见且可点（点了会 toast「订单信息加载失败」，:151-154），**无重试入口**（对比 approval-detail 有 `retryLoad`）
  - 明细为空（:74-77）：toast + return
- **副作用**：`util.showLoading('加载中...')` → `util.hideLoading()`（:64-68），**同样不在 finally**——若 `callFunction` 返回（不抛错）则正常，但若 `normalizePurchaseOrder` 抛错（极端情况）会悬挂 loading。实际风险低
- **契约风险**：
  - `remaining_qty` 兜底逻辑与后端 `getPurchaseOrderDetail:113-116` 完全一致，冗余但安全
  - **`priceSnapshot:0` 与 `payableFlag:true` 是前端写死并在 `submitReceipt` 中回传（:218-219），但后端 `createReceipt:383-405` 完全重算这两个值**（注释 P1-10「付款资格完全由服务端裁决…不信任客户端传来的 payableFlag」）→ 请求体里这两个字段是纯噪音，且 `priceSnapshot:0` 会被后端覆盖，前端永不显示真实价格
- **WXML 绑定核查**：无绑定（生命周期）

#### `onReceivedQtyInput(e)` （receive-verify.js:105-110）
- **触发方式**：wxml:33-34 `bindinput="onReceivedQtyInput" data-index="{{index}}"`
- **入参**：`dataset.index`、`e.detail.value`
- **调用云函数**：无；**副作用**：`setData({ ['items[index].receivedQty']: raw==='' ? 0 : (parseFloat(raw)||0) })`
- **契约风险**：**★ 与 `submitReceipt` 的校验（:159-162）不一致**——`submitReceipt` 校验 `typeof item.receivedQty !== 'number'`，但 `onReceivedQtyInput` 把空字符串转成 `0`（number），所以 typeof 检查**永远不会失败**，属于死检查。真正会拦下非法输入的是 `!Number.isFinite` 与 `> item.orderQty`。而 `> item.orderQty` 用的是**下单量**而非**剩余量**（:161 `item.receivedQty > item.orderQty`）——分批收货第 2 批时，UI 允许填到下单量（比如下单 10、已收 4、可再收 6，但 UI 允许填 10），后端 `createReceipt:296-298` 与事务内 :450-454 用**累计量**拦截并给出准确文案「累计实收超过下单量」。所以前端提示文案「实收数量不能超过订单数量」是**错误口径**（应该是"不能超过剩余可收数量"），用户被前端拦下时得到的信息会误导
- **WXML 绑定核查**：有绑定（wxml:34）

#### `toggleCheck(e)` （receive-verify.js:112-115）
- **触发方式**：wxml:43/47/51 `bindtap="toggleCheck" data-index data-field`
- **入参**：`dataset.{index, field}`（field ∈ {isShortage, isQualityIssue, isWrongItem}）
- **调用云函数**：无；**副作用**：`setData({ ['items[index].'+field]: !this.data.items[index][field] })`
- **契约风险**：**`field` 未做白名单校验**，理论上可传入任意路径段（如 `field='[constructor].p'`）。小程序 `setData` 路径语法不支持 `[]` 通配，且 dataset 来自本页 wxml 的三个固定值，实际不可利用。低风险，记录备查
- **WXML 绑定核查**：有绑定（wxml:43,47,51）

#### `onItemRemarkInput(e)` （receive-verify.js:117-120）
- **触发方式**：wxml:60 `bindinput="onItemRemarkInput" data-index="{{index}}"`（异常说明框，仅在 :57 `wx:if` 异常标记被勾选时可见）
- **入参**：`dataset.index`、`e.detail.value`
- **副作用**：`setData({ ['items[index].remark']: e.detail.value })`
- **契约风险**：无长度限制；后端 `createReceipt:540` 会把 remark 拼进异常描述（`description += '：'+item.remark`）→ 无注入风险（进 CSV 前经 `csvField` 转义），但超长文本会撑大描述字段
- **WXML 绑定核查**：有绑定（wxml:60）

#### `choosePhoto()` （receive-verify.js:122-138）
- **触发方式**：wxml:75 `bindtap="choosePhoto"`
- **入参**：无
- **调用云函数**：无（仅 `wx.chooseMedia`）
- **成功分支**：`setData({photos: [...this.data.photos, ...newPhotos]})`，上限 `count: 9 - this.data.photos.length`（:124）
- **失败分支**：**用户取消不提示**（:133 判断 `/cancel/i`），其他失败（权限拒绝）→ toast「未获得相册/相机权限，无法选择照片」
- **副作用**：`wx.chooseMedia({count, mediaType:['image'], sourceType:['camera','album']})`
- **契约风险**：
  - **★ `fail` 回调未区分"部分成功"**——`wx.chooseMedia` 在权限被授予但相册为空等场景正常返回 success；但若 `success` 抛错（如 `res.tempFiles` 非数组）会导致 `setData` 挂在未捕获异常上。低风险
  - **照片路径 `receipts/{orderId}/{timestamp}-{index}.{ext}` 由 `cloud.uploadReceiptPhotos`（cloud.js:227-241）决定，不是本页决定**——本页只负责把本地路径传给 `submitReceipt`（:199）。路径中的 `orderId` 经 `replace(/[^a-zA-Z0-9_-]/g,'')` 清洗，安全
  - 9 张上限与 wxml:75 `wx:if="{{photos.length < 9}}"` 一致 ✓
- **WXML 绑定核查**：有绑定（wxml:75）

#### `deletePhoto(e)` （receive-verify.js:140-144）
- **触发方式**：wxml:73 `catchtap="deletePhoto" data-index="{{index}}"`
- **入参**：`dataset.index`
- **副作用**：`photos.splice(index,1)` → `setData({photos})`
- **契约风险**：`splice` 后无边界校验（`index` 越界时 `splice` 静默无操作），低风险
- **WXML 绑定核查**：有绑定（wxml:73）

#### `onOverallRemarkInput(e)` （receive-verify.js:146）
- **触发方式**：wxml:86 `bindinput="onOverallRemarkInput"`
- **副作用**：`setData({overallRemark: e.detail.value})`
- **WXML 绑定核查**：有绑定（wxml:86）

#### `submitReceipt()` （receive-verify.js:148-275）
- **触发方式**：wxml:92 `bindtap="submitReceipt"`，按钮 `loading="{{isSubmitting}}" disabled="{{isSubmitting}}"`
- **入参**：无（全从 `this.data` 读）
- **调用云函数**：`cloud.uploadReceiptPhotos(photos, order.purchaseOrderId)`（:199）→ `createReceipt`，参数完整列表（:200-225）：
  `purchaseOrderId, storeId, storeName, receivedBy, overallRemark, photoFileIds, receiptDate, items[{orderItemId, productId, productName, supplierId, receivedQty, orderQty, unit, priceSnapshot, payableFlag, isShortage, isQualityIssue, isWrongItem, remark}]`
- **前端校验链**：`isSubmitting`（:150）→ `order.purchaseOrderId`（:151-154）→ `items.length`（:155-158）→ 数量合法性（:159-166）→ `submitItems` 非空（:168-172，筛选 `receivedQty>0 || 任一异常标记`）→ 门店信息（:177-182）
- **成功/失败分支**：
  - 照片上传或 createReceipt **抛错**（:226-229）：catch 里统一置 `result = {code:-1, msg:'照片上传失败，请检查网络后重试'}` —— **★ 这个 catch 同时包住 `uploadReceiptPhotos` 与 `callFunction` 两步，但 `callFunction` 永不抛错**（cloud.js:65-75 内部 try/catch 返回错误对象），所以实际只有照片上传会命中；文案却把两种可能都归为"照片上传失败"。此外**照片上传是逐张 `Promise.all`（cloud.js:233-240），若第 5 张失败，前 4 张已上传成功但本次提交放弃 → 云存储留下 4 个孤儿文件，无任何补偿/清理**。这是明确的补偿缺失
  - `result.code !== 0`（:234-246）：`showLoading('确认收货状态...')` → `recoverCommittedReceipt` → `hideLoading`；命中则用伪成功结果替换
  - `result.code === 0`（:248-271）：`wx.showModal`，文案按 `hasReportWarning`/`hasAbnormal` 三分支拼装（:253-257）；`hasAbnormal || hasReportWarning` 时 `showCancel:false`、`confirmText:'返回'` → 只 `navigateBack`；否则 `showCancel:true`、`confirmText:'查看报表'` → `switchTab('/pages/report-list/report-list')`（report-list 是 tabBar 页 app.json:56 ✓ 用 switchTab 正确）
  - 最终失败（:272-274）：toast + return，**页面保留全部已填数据，用户可修改后重试**——这是本批最完备的失败处理
- **副作用**：`util.showConfirm`（:189）、`util.showLoading('提交中...')`（:195）、`util.hideLoading()`（:230 finally ✓）、`setData({isSubmitting})`（:188 置位、:191 复位、:231 finally 复位）
- **契约风险**：
  - **★ `isSubmitting` 在 `showConfirm` 之前置位（:187-188），取消后置回（:190-192）——这是正确的防双击写法**，但 receive-list 的 `settleReceipt`/`regenerateReports`/`repriceReceipt` 三处都是反着的（先弹确认再置位），两页不一致
  - **`receiptDate: util.formatDate(new Date())`（:208）完全信任客户端时钟**——后端 `createReceipt:330-337` 只校验格式合法（`isReceiptDate`），并**允许任意过去日期**（打 `backfilled` 标记），也**允许未来日期**（既不拒也不打标）。因此本页面可通过改本机时间把收货日写成任意值，包括未来日期。后端未验证是否应拒
  - **`storeName` 可被客户端影响**：:178 `storeName = order.storeName || currentStore.storeName || currentStore.name`，后端 :250 `storeName = order.store_name || storeName` —— 若订单 `store_name` 为空（历史数据），会采用客户端传入值并写入 `receipt.store_name` 与报表 CSV。`storeId` 有后端强校验（:244 `order.store_id !== storeId` 拒绝），但 `storeName` 无对应校验 → **门店名可被客户端写入**（低风险，需订单缺 store_name 才触发）
  - 提交确认文案 :186 里"第${receivedLines}行"把行数拼进"第X行"，语义应为"第 X 行"还是"共 X 行"读起来别扭，属文案问题
- **WXML 绑定核查**：有绑定（wxml:92）

### 2.5 pages/abnormal-list/abnormal-list.js（110 行）

#### `onShow()` （abnormal-list.js:13-29）
- **触发方式**：`onShow` 生命周期
- **入参**：无
- **调用云函数**：`dataService`，`{action:'getAbnormalRecords'}`（**无参数**，门店/角色过滤由后端 `dataService:741-743` 从会话派生）
- **成功分支**：`createdAt` 经 `cloud.formatDateTime` 格式化 → `setData({records})` → `this.applyFilter()`
- **失败分支**：toast + return，**★ 不置失败态 → `records`/`filteredList` 保持空 → wxml:53-56 渲染"暂无异常记录"假空态**
- **副作用**：无
- **契约风险**：**chef 角色后端直接返回 `{code:0, data:[]}`（`dataService:739`）**，前端无角色拦截、页面也无角色提示 → chef 能看到一个永远"暂无异常记录"的页面。不算漏洞但属无效入口
- **WXML 绑定核查**：无绑定（生命周期）

#### `switchFilter(e)` （abnormal-list.js:31-34）
- **触发方式**：wxml:9-13 五个 `bindtap="switchFilter" data-value`
- **入参**：`dataset.value`（'all'|'pending'|'processing'|'resolved'|'closed'）
- **副作用**：`setData({activeFilter})` + `this.applyFilter()`
- **契约风险**：筛选值与后端 `ABNORMAL_STATUS_NAMES`（dataService:729-734）四个状态一一对应 ✓，加 'all' 共 5 个，wxml 五个 tab 全覆盖
- **WXML 绑定核查**：有绑定（wxml:9,10,11,12,13）

#### `applyFilter()` （abnormal-list.js:36-45）
- **触发方式**：内部调用（`onShow` 后、`switchFilter` 后）
- **入参**：无（读 `this.data.activeFilter`、`this.data.records`）
- **副作用**：`setData({filteredList})`，并派生 `statusColor`（`{pending:'warning', processing:'primary', resolved:'success', closed:'grey'}`，兜底 'grey'）
- **契约风险**：**★ 全量前端内存筛选，无分页**。后端 `getAbnormalRecords:744-748` 固定 `limit(100)`，超 100 条异常记录会静默丢失且无法感知。与 `getMessages` 的 `limit(100)` 同为系统性上限（已在跨域报告记录过消息分页问题，此处为同一模式在异常域的复现）
- **WXML 绑定核查**：无绑定（内部函数）

#### `handleAbnormal(e)` （abnormal-list.js:47-58）
- **触发方式**：wxml:43 `catchtap="handleAbnormal" data-id="{{item.id}}"`，可见条件 `item.status === 'pending'`
- **入参**：`dataset.id`（= `abnormal_record._id`，由后端 `dataService:758` `id: item._id` 赋值）
- **调用云函数**：`dataService`，`{action:'startAbnormal', id}`
- **成功分支**：`showSuccess('已标记为处理中')` + `await this.onShow()`（:57，刷新后按钮切到"填写处理结果"，状态机闭环 ✓）
- **失败分支**：toast + return，无失败态。后端校验链：`status !== 'pending'` → 拒绝（dataService:782）；非全局角色跨门店 → 403（:779-781）
- **副作用**：`util.showConfirm`；**`const app = getApp()`（:50）赋值后从未使用——死变量**
- **契约风险**：**`data-id` 传的是文档 `_id` 而非 `abnormal_id` 业务键**，前端无法从 UI 看出这一点；三个写操作（start/resolve/close）全部用 `_id`，与后端一致 ✓
- **WXML 绑定核查**：有绑定（wxml:43）

#### `promptResolution()` （abnormal-list.js:60-69）
- **触发方式**：内部调用（仅 `resolveAbnormal` 调）
- **入参**：无
- **调用云函数**：无；**副作用**：`wx.showModal({editable:true, placeholderText:'请输入处理结果或解决方案'})`，返回 Promise，确认 → `String(res.content||'').trim()`，取消 → `''`
- **契约风险**：**★ 取消与"输入空串"两种情况返回同值 `''`**，`resolveAbnormal` 里统一 toast「请填写处理结果」（:73-76）。用户主动取消也会被当成"没填"提示填写，属文案不精确，非功能缺陷
- **WXML 绑定核查**：无绑定（内部函数）

#### `resolveAbnormal(e)` （abnormal-list.js:71-93）
- **触发方式**：wxml:46 `catchtap="resolveAbnormal" data-id="{{item.id}}"`，可见条件 `item.status === 'processing'`
- **入参**：`dataset.id`
- **调用云函数**：`dataService`，`{action:'resolveAbnormal', id, resolution, paymentDecision}`；`paymentDecision = payConfirmed ? 'pay_received' : 'reject'`（:78-79）
- **成功分支**：`showSuccess('已标记为已解决')` + `await this.onShow()`（按钮切到"关闭异常"，闭环 ✓）
- **失败分支**：toast + return。后端校验：`resolution` 空 → 拒绝（:794）；`status !== 'processing'` → 拒绝（:802）；跨门店 → 403（:799-801）
- **副作用**：`promptResolution`（wx.showModal）+ `util.showConfirm`；`const app = getApp()`（:80）未使用——死变量
- **契约风险**：
  - **★ 付款裁决对话框（:78）对**所有**异常类型一视同仁地弹出**，包括 `missing_price`。但 `settleReceipt:965` 解锁条件要求 `Number(target.price_snapshot) > 0`——缺价行快照为 0，即使用户选了 `pay_received`，`settleReceipt` 也会返回「没有因异常处理解锁的明细行，无需补结算」（:973-975）。**缺价异常经本流程裁决为"转回可付款"是一条死路**：异常状态变 `resolved`、状态机推进到"关闭"，但钱永远进不了账单。正确路径是 `repriceReceipt`（先在价格管理补价），而 `repriceReceipt` 会自己把 `missing_price` 异常置 resolved（dataService:1147-1160）。两条路径会互相覆盖
  - **`quality`/`wrong_item` 选 `pay_received` 会被 `settleReceipt:965` 真正解锁**（只排除 `is_manual` 与 0 价）→ 质量/错货的商品可以被裁决为"照常付款"。这是后端 B4 裁决的设计口径，但前端确认文案「该异常行是否按实收数量转回可付款？」**没有区分异常类型**，用户勾选"质量问题"后又选"转回可付款"没有任何二次警示。业务风险，非代码缺陷
  - `paymentDecision` 为 `'reject'` 时后端 `settleReceipt:953` 的 `payReceivedRecords` 过滤会排除它 → 该异常行永不进账单，且无任何后续提示。与文案「「取消」则维持不可付款」一致 ✓
- **WXML 绑定核查**：有绑定（wxml:46）

#### `closeAbnormal(e)` （abnormal-list.js:95-109）
- **触发方式**：wxml:49 `catchtap="closeAbnormal" data-id="{{item.id}}"`，可见条件 `item.status === 'resolved'`
- **入参**：`dataset.id`
- **调用云函数**：`dataService`，`{action:'closeAbnormal', id}`
- **成功分支**：`showSuccess('异常已关闭')` + `await this.onShow()`（关闭后 wxml 三个 `wx:if/elif` 全不命中 → 卡片不再显示按钮，闭环 ✓）
- **失败分支**：toast + return
- **副作用**：`util.showConfirm`；`const app = getApp()`（:98）未使用——死变量
- **契约风险**：**`status==='closed'` 的记录无任何操作入口**（wxml 无对应分支），且 `closeAbnormal` 之后**没有任何"重新打开"路径**——用户误点关闭后，该异常永久无法再处理，只能靠数据库直改。这是不可逆操作且确认文案只说"关闭后不可继续处理"（:96），未提示不可撤销。风险项
- **WXML 绑定核查**：有绑定（wxml:49）

### 2.6 pages/message/message.js（83 行）

#### `onShow()` （message.js:12-29）
- **触发方式**：`onShow` 生命周期（tabBar 页每次切到都触发）
- **入参**：无
- **调用云函数**：`dataService`，`{action:'getMessages'}`（无参数，后端 `dataService:651-679` 按角色/门店/收件人派生过滤，固定 `limit(100)`）
- **成功分支**：每条映射出 `time`（`cloud.formatDateTime(m.time)`）与 `timeAgo`（`util.getRelativeTime(cloud.formatDateTime(m.time))`）；`unreadCount = messages.filter(m => !m.read).length`；`setData({messages, unreadCount})`
- **失败分支**：toast + return，**★ 不置失败态 → `messages` 保持空 → wxml:26-29 渲染"暂无消息"假空态**。对 tabBar 首页级页面而言，这是本批影响面最大的假空态
- **副作用**：无
- **契约风险**：
  - **`timeAgo` 双重格式化**：`formatDateTime(m.time)` 把 Date 转成 `'YYYY-MM-DD HH:mm'` 字符串，再交给 `util.getRelativeTime`（util.js:44）内部 `parseDate` 重新解析。能工作，但每次多一轮序列化/反序列化。且 `formatDateTime` 截断到分钟（cloud.js:120），`< 1 分钟`的消息会被显示为「X 分钟前」而非「刚刚」——因为解析回来的时间是整分钟，`now - d` 至少接近整分钟
  - **`read` 字段由后端合并 `read_by` 后返回（dataService:674-678），前端直接消费 ✓**（跨域已核实，不重报）
  - **后端固定 `limit(100)`（dataService:673），超 100 条消息静默丢失且无翻页**——tabBar 常驻页面，消息量大时最老的消息永久不可见
- **WXML 绑定核查**：无绑定（生命周期）

#### `readMessage(e)` （message.js:31-71）
- **触发方式**：wxml:8 `bindtap="readMessage" data-id="{{item.id}}"`
- **入参**：`dataset.id`（= `message._id`）
- **调用云函数**：`dataService`，`{action:'markMessageRead', id}`（仅当 `!message.read` 时）
- **成功分支**：
  - 未读：写库成功后 `setData({'messages[idx].read': true, unreadCount: Math.max(0, unreadCount-1)})`（:43-46）
  - 已读：跳过写库，直接进路由
  - 路由（:51-69）：`supplier` 角色 → `supplier-orders`；`type==='abnormal'` → `abnormal-list`；`type==='receive' || bizId.startsWith('RCP')` → `receive-list`；其他 → `purchase-detail?id=bizId`
  - **无 `message.bizId` 时** → `util.showToast('已读')`（:70），**不跳转**
- **失败分支**：`markMessageRead` 失败 → `return util.showToast(...)`（:42）→ **★ 标记失败即中止，既不跳转也不更新本地 `read` 状态**。用户看到的仍是未读样式，重复点击会重复请求。注意 `util.showToast` 返回 `undefined`，`return undefined` 无害
- **副作用**：`wx.navigateTo`（4 种目标）或 `util.showToast`
- **契约风险**：**★ 路由分支全部丢弃 `bizId`**——三个目标页（`abnormal-list`/`receive-list`/`supplier-orders`）均**无 `onLoad` 实现**，无法接收定位参数。详见 §5。这是本批最核心的闭环缺口
  - **`isReceiptMsg` 兜底逻辑（:61-62）用 `bizId.indexOf('RCP')===0` 判收货单**——但 `RCP` 前缀是 `createReceipt:339` 硬编码的 `receiptId = 'RCP' + Date.now() + ...`，与 `abnormal_id`（`${receiptId}_${i}_${type}`，createReceipt:543）同前缀。**因此 `type:'abnormal'` 的 `MSG_RECEIVE_*`（biz_id 是 receiptId）会先命中 :57 的 `type==='abnormal'` 分支跳异常列表，不会落到 :61 的收货分支**——两个分支的语义边界是 type 优先，兜底只对 type 缺失/异常的旧消息生效。逻辑正确但注释（:48-50）说"异常类跳异常处理列表；收货类 bizId 是收货单号(RCP…)，跳收货列表"，读者容易误以为两个分支等价
- **WXML 绑定核查**：有绑定（wxml:8）

#### `markAllRead()` （message.js:73-82）
- **触发方式**：wxml:5 `bindtap="markAllRead"`，可见条件 `unreadCount > 0`
- **入参**：无
- **调用云函数**：`dataService`，`{action:'markAllMessagesRead'}`（后端 `dataService:704-720` 内部复用 `getMessages` 后逐条 `read_by.push`）
- **成功分支**：本地批量置 `read:true` + `unreadCount:0` + `showSuccess('全部已读')`
- **失败分支**：toast + return，**本地状态不变**（正确——不回滚乐观更新，因为本来就没做乐观更新）
- **副作用**：`util.showToast`/`showSuccess`
- **契约风险**：**无 loading 遮罩**，100 条消息逐条串行写库（dataService:711-718 是 for 循环，非并发），点击后界面冻结感明显；且**按钮无 `disabled`**，可重复点击并发写入 `read_by`（后端 `:714` 有 `includes(userId)` 去重兜住，不会重复写入）
- **WXML 绑定核查**：有绑定（wxml:5）

---

## 3. ★ 专项一：WXML ↔ JS 双向对账（本批 6 页）

对账方法：逐个抽取 6 个 wxml 中的 `bindtap`/`catchtap`/`bindinput` 目标名、`data-*` 键、以及 `{{}}` 插值与 `wx:if`/`wx:for` 中引用的所有 data 路径，与 6 个 js 的 `Page()` 方法表和 `data` 初始键 + `setData` 写入点双向比对。

### A 类：wxml 引用了但 js 没有 → **0 条**

逐页证据（全部 18 个事件目标均在 js 中有同名方法）：

| wxml 行 | 事件目标 | js 定义位置 |
|---|---|---|
| approval-list.wxml:8,23,24 | goDetail / rejectRequest / approveRequest | approval-list.js:64 / 89 / 68 |
| approval-detail.wxml:7,52,62,65,66 | retryLoad / onApproveQtyInput / onAuditRemarkInput / rejectRequest / approveRequest | approval-detail.js:57 / 50 / 62 / 93 / 66 |
| receive-list.wxml:7,49,50,51,52 | goVerify / previewReceiptPhotos / regenerateReports / repriceReceipt / settleReceipt | receive-list.js:113 / 92 / 140 / 163 / 118 |
| receive-verify.wxml:34,43,47,51,60,73,75,86,92 | onReceivedQtyInput / toggleCheck ×3 / onItemRemarkInput / deletePhoto / choosePhoto / onOverallRemarkInput / submitReceipt | receive-verify.js:105 / 112 / 117 / 140 / 122 / 146 / 148 |
| abnormal-list.wxml:9-13,43,46,49 | switchFilter ×5 / handleAbnormal / resolveAbnormal / closeAbnormal | abnormal-list.js:31 / 47 / 71 / 95 |
| message.wxml:5,8 | markAllRead / readMessage | message.js:73 / 31 |

**本批不存在"点了没反应"的绑定缺失**——这是 6 页里质量最好的一项。

### B 类：js 定义了但 wxml 没引用 → **0 条**

6 个 js 里除生命周期钩子（`onShow` ×6、`onLoad` ×2、`onPullDownRefresh` ×2）外的方法全部被 wxml 显式绑定。生命周期钩子由框架调用，不计入死代码。

`approval-list.onPullDownRefresh`（:59）与 `receive-list.onPullDownRefresh`（:108）的对应 `.json` 均设了 `enablePullDownRefresh: true` ✓；反之 `receive-verify`/`abnormal-list`/`message`/`approval-detail` 的 json 未开启下拉刷新、js 也未实现 `onPullDownRefresh` ✓——**开启状态与实现状态严格一致，无"开了刷新但没实现"或"实现了但没开"的错配**。

### C 类：wxml 读的 data 键在 js 里无来源 → **0 条严格项，1 条"条件来源"项**

严格逐项核对（全部 6 页 wxml 引用的 data 路径在 js 中均有赋值点）：
- approval-list.wxml 引用 `list.length`(:5)、`item.id`(:8)、`item.requesterName`(:11)、`item.expectedDeliveryDate`(:12)、`item.isManual`(:13)、`item.items`(:17)、`prod.productName`(:17)、`prod.requestedQty`(:17)、`item.submittedAt`(:20)、`loadFailed`(:28)、`list.length`(:32) —— 来源 approval-list.js:34-56 ✓
- approval-detail.wxml 引用 `loadFailed`(:4)、`detail.isManual`(:16)、`detail.requesterName`(:23)、`detail.expectedDeliveryDate`(:27)、`detail.submittedAt`(:31)、`detail.remark`(:34)、`detail.items`(:42)、`item.productName`(:44)、`item.spec`(:45)、`item.unit`(:45)、`item.requestedQty`(:48)、`item.approveQty`(:51)、`auditRemark`(:62) —— 来源 approval-detail.js:33-47、:63 ✓
- receive-list.wxml 全部 24 个引用键（见 §2.3）——来源 receive-list.js:44-88 ✓
- receive-verify.wxml 全部 18 个引用键 —— 来源 receive-verify.js:79-102 与 :129/:143/:146/:188 ✓
- abnormal-list.wxml 全部 13 个引用键 —— 来源 abnormal-list.js:23-44 ✓
- message.wxml 引用 `unreadCount`(:5)、`messages`(:8)、`item.read`(:8,17)、`item.type`(:11-15)、`item.title`(:20)、`item.content`(:21)、`item.timeAgo`(:22)、`item.id`(:8)、`messages.length`(:26) —— 来源 message.js:22-28 ✓

**条件来源项（1 条）**：`receive-list.wxml:50,51,52` 的 `canRegenerate`/`canReprice`/`canSettle` 三个开关，**只在 `onShow` 的"两个请求都成功"路径写入**（receive-list.js:82-88）。在 `receiptResult.code !== 0` 的失败路径（:57-62）提前 return，三个开关保持未定义 → `wx:if` 恒假 → **管理员在收货记录加载失败后看不到任何"补生成/补价补账/补结算"入口**，而页面上"待收货订单"列表仍正常显示，用户无从得知入口缺失。首帧渲染时同样为假（无 `setData` 前），这是预期的防误触，不算缺陷；但失败路径的不写入属于遗漏。

**首帧渲染核查**：6 页均无初始加载占位（loading 骨架），首帧到 `setData` 之间：
- approval-list / approval-detail：`list:[]`/`detail:{}` → 直接显示空态文案（"暂无待审核申请"），随后被真实数据覆盖。**首帧会闪现"暂无…"**，属可接受但未处理
- receive-list：`orders:[]` + `receipts:[]` → 首帧同时显示"暂无待收货订单"和隐藏收货记录卡片
- receive-verify：**首帧 `items:[]` → 商品验收卡片标题下方空一块，但底部"提交验收"按钮已可点**（:92 无 `disabled` 初始态）——点击会得到 `!order.purchaseOrderId` 的 toast（:151-154），有兜底
- abnormal-list / message：均首帧空态闪现

### D 类：js 写入的 data 键 wxml 从未读取 → **4 条**

| # | 位置 | data 键 | 证据 | 影响 |
|---|---|---|---|---|
| D1 | approval-list.js:45 | `list[].statusText` | 由 `meta.getStatusInfo(o.orderStatus).text` 生成；approval-list.wxml 全文 36 行中无任何 `statusText` 引用（wxml 只显示 `requesterName`/`expectedDeliveryDate`/`isManual`/`items`/`submittedAt`） | 白算。且本页列表**根本没有任何状态标签**——虽然过滤后全是 `submitted`/`pending_approval`，但视觉上无法区分"已提交"与"待审核"两种语义 |
| D2 | receive-list.js:54 | `orders[].manualCount` | `o.items.filter(i => i.isManual).length`；receive-list.wxml 全文 57 行无 `manualCount` 引用。wxml:16 实际用 `product.isManual ? '(手动)' : ''` 逐行标注 | 白算，功能被 :16 的内联标注替代 |
| D3 | message.js:24 | `messages[].time` | 写入格式化后的时间字符串；message.wxml 只读 `item.timeAgo`（:22），从未读 `item.time` | 白算。`timeAgo` 才是渲染值；`time` 疑似遗留（`getRelativeTime` 内部已自行 parse） |
| D4 | abnormal-list.js:27 | `records`（整个数组） | wxml 只 `wx:for="{{filteredList}}"`（:16），`records` 仅被 `applyFilter`（:38）内部消费 | **非死代码**——是 `filteredList` 的源数据镜像，保留是合理的。此处仅为完备性记录，不计入缺陷 |

**另有大量"spread 展开后未读"字段**，不作逐条统计但需说明：`approval-detail.js:33-34` 用 `...order` 把 `normalizePurchaseOrder` 产出的约 30 个字段（`orderNo`/`orderId`/`storeId`/`orderStatus`/`createdAt`/`verifyStatus`/`verifyAmount`/`cancelRequested`/`isManual`/`auditRemark`…）全部塞进 `detail`，wxml 只消费其中 5 个。同理 `receive-verify.js:73` 把整个 normalized order 放入 `order`，wxml 只用 `storeName`/`orderNo`/`deliveryDate`。这类冗余不影响功能，但 **`detail.orderStatus` 与 `order.orderStatus` 从未被 wxml 读取**，直接导致下面这条：

**★ approval-detail.wxml:17 的"待审核"标签是硬编码**：`<view class="tag tag-warning">待审核</view>` 无任何 `wx:if`，不读 `detail.orderStatus`。当前不会显现问题（审批成功后 800ms 跳走 :86，且 approval-list 过滤掉已审单 → 进不到此页），但一旦有任何路径让此页在审批后重新显示（例如未来加"审批历史"入口），标签会恒显"待审核"。同页 :16 的 `detail.isManual` 标签倒是真的做了条件渲染——两个相邻标签一个条件一个硬编码，风格不一致。

---

## 4. ★ 专项二：收货与异常的状态处理链核查

### 4.1 一批收货如何在前端构造

**数据起点**：`receive-verify.onLoad` 拉 `getPurchaseOrderDetail`（receive-verify.js:65-67），后端返回每行的 `received_total` 与 `remaining_qty`（getPurchaseOrderDetail:113-116，按 `receipt_item` 聚合 `received_qty` 求和，非分页 limit 1000）。

**行构造**（receive-verify.js:79-101）：
- `productName` ← `item.productNameSnapshot`，`unit` ← `item.unitSnapshot`
- `receivedTotal` ← `item.received_total`（:81）
- `remainingQty` ← 优先 `item.remaining_qty`（:82-83），缺失时兜底 `max(0, orderQty - receivedTotal)`（:84）——与后端算法完全一致，冗余
- `receivedQty: 0`（:93）：**默认本批不收**，对应 wxml:18 的提示文案「分批收货：本次实收数量（留空/0 表示本批不收该行）」
- `priceSnapshot: 0`、`payableFlag: true`（:94-95）：**前端写死的占位值，回传后端后被完全覆盖**（createReceipt:385 重算价格、:395-405 重算付款资格）
- 三个异常布尔 `isShortage/isQualityIssue/isWrongItem: false`、`remark: ''`

**WXML 交互层**（receive-verify.wxml）：
- :19-23 商品名 + `订单: ×{{item.orderQty}} {{item.unit}}`
- :25-27 `wx:if="{{item.receivedTotal > 0}}"` 显示「已收 X {unit}，剩余 Y」或「已收齐」——**只有收过货的行才显示，首行收货不显示对照信息**
- :33-34 实收数量 `type="digit"` input
- :42-53 三个异常开关（少货/缺货、质量问题、错货），`data-field` 分别为 `isShortage`/`isQualityIssue`/`isWrongItem`
- :57-61 异常说明 textarea，**仅在三个标记任一被勾选时可见**（`wx:if`）
- :70-79 照片网格，上限 9 张（:75 `wx:if="{{photos.length < 9}}"`）
- :86 总体备注
- :92 提交按钮

**照片上传路径由谁决定**：**由 `utils/cloud.js:227-241` 的 `uploadReceiptPhotos` 决定**，不是页面。路径规则 `receipts/{清洗后的purchaseOrderId}/{Date.now()}-{索引}.{扩展名}`，扩展名从本地路径正则提取（cloud.js:234-235），缺省 `jpg`。页面只在 `submitReceipt:199` 调用它，拿到 `fileID` 数组传给云函数。

**后端权威化**（createReceipt:254-311）：后端明确注释「The order lines in the database are authoritative. Do not trust the client」——用订单行覆盖客户端传入的 `productId`/`productName`/`supplierId`/`orderQty`/`unit`，只信任 `orderItemId`（订单行 ID）与 `receivedQty`/异常标记/备注。所以前端传 `productId: item.productId`、`productName`、`supplierId`、`unit`、`priceSnapshot`、`payableFlag` 六个字段**全部被后端丢弃或覆盖**（:302-308），属于请求体噪音。

### 4.2 提交后的成功/失败/部分成功判定，是否有补偿或回滚提示

`submitReceipt`（receive-verify.js:148-275）的判定链：

1. **前端校验**（:149-182）：`isSubmitting` → `purchaseOrderId` → `items.length` → 数量合法性 → `submitItems` 非空 → 门店信息
2. **确认框前**置 `isSubmitting:true`（:188），取消则复位（:190-192）——防双击
3. **写操作**：先 `uploadReceiptPhotos`（:199）再 `createReceipt`（:200），共一个 try/catch
4. **抛错分支**（:226-229）：统一 `{code:-1, msg:'照片上传失败，请检查网络后重试'}`
5. **业务失败分支**（:234-246）：`showLoading('确认收货状态...')` → `recoverCommittedReceipt` → `hideLoading`
6. **成功分支**（:248-271）：`wx.showModal`，三分支文案 + 两种跳转
7. **最终失败**（:272-274）：toast，页面保留全部输入

**补偿/回滚机制核查——三条明确缺失**：

- **缺失 1：照片孤儿文件**。`uploadReceiptPhotos` 内部 `Promise.all`（cloud.js:233-240）逐张上传，**无部分成功回滚**。若第 5/9 张失败，前 4 张已落云存储，但 `createReceipt` 未执行 → 这 4 个 fileID 永远不会被任何 `receipt.photo_file_ids` 引用。用户看到的只是「照片上传失败」，重试会再上传一批，孤儿持续累积。**无任何清理机制、无任何提示**。
- **缺失 2：无"部分成功"概念**。`createReceipt` 后端是单事务（createReceipt:417-591，主表+明细+异常记录+消息+订单状态全在一个 `runTransaction` 内），所以不存在后端部分成功；但**报表生成在事务外**（:593-781），失败时 `reportWarning` 非空 + 打 `missing_reports` 标记。前端在 :253-254 正确区分了这一种"主单成功但报表失败"，文案「收货已保存。报表生成失败，请联系管理员处理。」并给出 `reportWarning`。这是本批唯一被妥善处理的部分成功场景。
- **缺失 3：无客户端重试/回滚提示**。最终失败（:272-274）只有一句 toast，不提示"数据已保留可重试"，也不给出网络状况指引。数据确实保留在 `this.data` 中，用户可改可重试——**这是隐式的好设计，但没有文案确认**。

**★ `recoverCommittedReceipt` 的分批歧义（重要缺陷）**：见 §2.4 详述。核心：`receipts[0]` 取自无 `orderBy` 的查询（getPurchaseOrderDetail:120-123），分批场景下会把**历史批次**的收货结果当作本次提交结果返回，`hasAbnormal` 基于历史批次、`abnormalTypeNames` 固定为空数组、文案固定为报表警告。**用户可能在"本批有异常、历史批无异常"时被误报为本批无异常**，从而直接 `navigateBack` 离开而不处理异常。同时 `recovered:true` 字段前端从不消费（:248-271 只读 `reportsGenerated`/`reportWarning`/`hasAbnormal`/`abnormalTypeNames`）。

### 4.3 异常记录如何创建、如何裁决

**创建点只有一个**：`createReceipt` 事务内（createReceipt:523-557）。每行商品按四种类型展开：`isShortage`→`shortage`、`isQualityIssue`→`quality`、`isWrongItem`→`wrong_item`、`isMissingPrice`→`missing_price`。`abnormal_id` 格式 `${receiptId}_${行序号+1}_${type}`（:543），`status:'pending'`，初始 `resolution:''`。

**少货标记的来源有两处，且口径不同**：
- 事务外预检（createReceipt:348-351）：`cumulativeQty < orderQty` → 强制 `isShortage=true`（**即使用户未勾选**，注释 :344-345 明确「实收少于下单即为少货」）
- 事务内重算（:461-469）：`txIsFinalBatch` 为 false（还有行未收齐）时**清空所有 `isShortage`**，注释 P1-16「短收只在最终批判定，避免正常分批收货把异常台账灌满虚假 shortage」

所以**只有最终批次的短收才会产生 `shortage` 异常记录**。前端 wxml 却无条件展示三个勾选框，用户在中间批次勾选"少货/缺货"不会留下异常记录（被 :468 清掉）——**UI 允许的操作在后端被静默丢弃，且无任何提示**。这是前后端口径不一致中用户感知最强的一处。

**`missing_price` 的生成**（createReceipt:401-405）：非手动行 + 有供应商 + `priceSnapshot <= 0` + `receivedQty > 0` → `isMissingPrice=true`。注意**手动商品行跳过**（:395-396，0 价为预期行为），与前端 receive-list 的 `hasMissingPrice` 判定（receive-list.js:76-78）条件一致（`!isManual && supplierId && price <= 0`），**但 receive-list 的判定不含 `receivedQty > 0`**，对 0 收货的缺价行会多算一条标记。微小差异。

**裁决三步状态机**：

| 步骤 | 前端入口 | 可见条件（wxml） | 后端前置校验 | 状态转移 |
|---|---|---|---|---|
| 开始处理 | `handleAbnormal`（abnormal-list.js:47） | `item.status === 'pending'`（wxml:42） | `status !== 'pending'` 拒绝（dataService:782） | pending → processing，写 `handled_by` |
| 填写处理结果 | `resolveAbnormal`（:71） | `item.status === 'processing'`（wxml:45） | `resolution` 空拒绝（:794）；`status !== 'processing'` 拒绝（:802） | processing → resolved，写 `resolution`/`payment_decision`/`resolved_by`/`resolved_at` |
| 关闭异常 | `closeAbnormal`（:95） | `item.status === 'resolved'`（wxml:48） | `status !== 'resolved'` 拒绝（:852） | resolved → closed，写 `closed_by`/`closed_at` |

**状态机前后端完全对齐 ✓**，且 `closed` 态无操作入口（wxml 无对应分支），符合"关闭即终态"设计。**但无重新打开路径**——误点关闭不可撤销（§2.5 已述）。

**裁决按钮的可见条件核查**：
- 三个按钮互斥（`wx:if` / `wx:elif` / `wx:elif`），同一时刻最多显示一个 ✓
- **`paymentDecision` 对异常类型不敏感**：`resolveAbnormal`（abnormal-list.js:77-79）对所有类型弹同一个付款裁决框。`missing_price` 选 `pay_received` 是死路（`settleReceipt:965` 要求 `price_snapshot > 0`）；`quality`/`wrong_item` 选 `pay_received` 会被真实解锁付款（`:965` 只排除 `is_manual` 与 0 价）——**质量/错货商品可以被合法裁决为照常付款**，前端无任何按类型警示
- **裁决结果无前端回显差异**：`payment_decision` 写库后，`getAbnormalRecords` 的返回映射（dataService:757-769）**不含 `payment_decision` 字段** → wxml 无法显示"该行已裁决为可付款/不可付款"。`resolution-box`（wxml:37-39）只显示 `resolution` 文本。**用户关闭异常后无法追溯当时的付款裁决**

### 4.4 补结算与改价重报的入口与前置条件

**`settleReceipt`（补结算）**：
- 入口：receive-list.wxml:52，可见条件 `item.hasAbnormal && canSettle`
- `hasAbnormal` ← `receipt.receipt_status === 'abnormal'`（receive-list.js:70）；`canSettle` ← `['purchaser','super_admin'].includes(user.role)`（:87）
- 后端前置（dataService:909-985）：`requireUser(GLOBAL_ROLES)` → 收货单存在 → **全部异常已 `resolved`/`closed`**（:920-925，否则「尚有未处理完成的异常，无法补结算」）→ 未被结算过（:927-934）→ 并发锁抢占（:936-947）→ **必须有 `pay_received` 裁决的异常行**（:953）→ 且该行 `!is_manual && price_snapshot > 0`（:965）
- 产物：只结算**本次因裁决解锁的行**，`report_id` 带 `_S` 后缀，CSV 表头标注「异常处理后补结算（增量）」（:1008-1027）

**前置条件与前端入口的错位**：前端 `hasAbnormal` 只看 `receipt.receipt_status`，**不看异常是否已解决**。所以一张"异常全部已解决、状态仍为 abnormal"的收货单，其"补结算"按钮始终可见，点了却会因「尚有未处理完成的异常」或「没有因异常处理解锁的明细行」被拒。这是**入口可见性与可操作性脱钩**——用户反复点击只会收到拒绝文案。理想做法是按钮条件应为「存在 `payment_decision==='pay_received'` 且未结算的异常」，但 `getReceipts` 不返回该信息，前端无法判断。

**`repriceReceipt`（改价重报）**：
- 入口：receive-list.wxml:51，可见条件 `item.hasMissingPrice && canReprice`
- `hasMissingPrice` ← 前端从 `receipt.items` 现算（receive-list.js:76-78），**与后端 `missing_price` 异常记录是两套独立信号**
- 后端前置（dataService:1105-1172）：`GLOBAL_ROLES` → 收货单 → 存在缺价行（:1117，非手动+有供应商+快照 ≤ 0）→ 批量取当前 `is_current` 协议价（:1121-1130）→ 刷新 `price_snapshot` 并置 `payable_flag:true`（:1137-1139）→ 若仍有缺价行则拒绝并列出商品名（:1142-1144）→ 把对应 `missing_price` 异常置 `resolved`（:1147-1160）→ **递归调用 `regenerateReceiptReports`**（:1163）

**★ 两条路径的字段名一致性核查**：
- `receiptId`：前端 `dataset.id` = `receipt.receiptId`（receive-list.js:65 归一化）；后端读 `event.receiptId` ✓
- `id`（异常）：前端 `dataset.id` = `item.id`（getAbnormalRecords:758 `id: item._id`）；后端读 `event.id` 并用 `db.collection('abnormal_record').doc(event.id)` ✓
- `resolution` / `paymentDecision`：前后端同名 ✓
- **不一致点**：前端异常列表拿到的 `typeName`（dataService:761）来自 `ABNORMAL_TYPE_NAMES`，含 `missing_price: '缺价待补'`（:727）；但 **wxss 中 `type-dot-missing_price` 未定义**（abnormal-list.wxss:39-42 只定义了 `quality`/`shortage`/`delay`/`wrong_item`）→ 缺价异常的行显示为默认灰色圆点；而 **`type-dot-delay` 定义了但 `delay` 类型全仓不存在**（`ABNORMAL_TYPE_NAMES` 无此键、`createReceipt:523-527` 不产生）→ 死 CSS 类 + 缺类并存，两个方向各错一个

---

## 5. ★ 专项三：消息中心与跳转闭环

`message.js` 是 tabBar 第 4 页（app.json:61-66），是所有业务通知的唯一落点。全仓 `createMessage` 直接写入点共 **9 处**，按 `type` 归类如下（生成位置均已逐个 Read 取证）。

### 5.1 `type: 'approval'` —— 2 处生产者，闭环正常

| 生产者 | bizId | 前端路由 | 闭环 |
|---|---|---|---|
| `dataService:601-606`（auditOrder 后）`title:'采购申请已通过/已驳回'`，content 含 `order.order_no` | `event.orderId`（= `purchase_order_id`） | `message.js:66` → `purchase-detail?id=bizId` | **✓ 正常**。purchase-detail.js:12 读 `options.id \|\| options.orderId`，契约一致 |
| `dataService:1531-1536`（催审提醒）`title:'采购单催审提醒'` | `event.orderId` | 同上 | **✓ 正常** |

### 5.2 `type: 'order'` —— 3 处生产者，2 正常 1 死信

| 生产者 | bizId | 前端路由 | 闭环 |
|---|---|---|---|
| `createPurchaseOrder:60-63`（提交采购申请）`title:'采购申请已提交'` | `orderNo`（= `purchase_order_id`） | `purchase-detail?id=bizId` | **✓ 正常** |
| `confirmSupplierOrder:101-104`（供应商发货）`title:'供货商已发货'` | `orderId` | `purchase-detail?id=bizId` | **✓ 正常** |
| `dataService:421-427`（审核改量后重置供应商确认）`title:'订单改量，供货商需重新确认'` | **未传 `bizId`** → `createMessage:202` 兜底为 `''` | `message.js:51` `if (message.bizId)` 为假 → :70 `showToast('已读')` | **✗ 死信**：点了只标记已读，不跳转，无任何后续动作入口。该消息要求"线下通知供应商"，本就是纯告知，但 UI 上表现为"点了没反应"，用户体验与真正失效不可区分 |

**★ 同域附加问题——跨租户可见**：`dataService:331-338`（供货商新订单通知）走 `createMessage` 时传 `scopeType:'supplier'`、`scopeId:supplierId`，但**未传 `storeId`** → 落库 `store_id:''`（createMessage:204）。`getMessages:662-664` 只对 `role==='supplier'` 加 `scope_type/scope_id` 过滤，对 store_manager/purchaser 只加 `store_id` 条件，而 `store_id:''` 命中 :668 的 `{store_id:''}` 分支 → **店长/采购员会在消息中心看到本该只给供货商看的"您有新的采购订单"**，且该消息 `bizId` 为空 → 点击落到 `showToast('已读')`。可见性越界 + 死信双击穿。

### 5.3 `type: 'receive'` —— 1 处生产者，闭环断裂

| 生产者 | bizId | 前端路由 | 闭环 |
|---|---|---|---|
| `createReceipt:579-584`（正常收货完成，事务内写入）`title:'收货验收完成'`，content 含收货日期+门店 | `receiptId`（`RCP` 前缀，createReceipt:339） | `message.js:63-64` → `navigateTo('/pages/receive-list/receive-list')`，**不带任何参数** | **✗ 断裂**：receive-list **无 `onLoad`**（receive-list.js 全文 185 行只有 onShow/onPullDownRefresh + 7 个方法），无法接收 receiptId；页面也无"按收货单号定位"的输入框或筛选器。落地后只能肉眼在"最近收货记录"（仅 5 条，receive-list.js:30）里找，**超过 5 条历史时目标单根本不在列表里** |

### 5.4 `type: 'abnormal'` —— 5 处生产者，5 处全部断裂或落错域

`message.js:57-59` 对所有 `type==='abnormal'` 一律 `navigateTo('/pages/abnormal-list/abnormal-list')`，不带参数。abnormal-list **无 `onLoad`**（abnormal-list.js 全文 110 行），无法接收 bizId，也无定位能力。

| # | 生产者 | bizId 实际内容 | 路由目标 | 目标页能否处理 |
|---|---|---|---|---|
| a | `createReceipt:579-585`「收货异常待处理」（有异常时） | `receiptId`（RCP…） | abnormal-list | **✗ 落错域**：bizId 是收货单号，异常列表按 `abnormal_record` 列表展示。异常记录确实因该收货产生、且 `receipt_id` 字段关联（createReceipt:544），**但 abnormal-list 无"按收货单过滤"能力**，用户需自己从上往下数。若同时有多张收货单的异常，无法区分是哪张 |
| b | `createReceipt:765-776`「收货报表生成失败」 | `receiptId` | abnormal-list | **✗ 完全错误**：content 明写「请管理员**在收货记录中**补生成」（:770），要求去 receive-list 点"补生成"，但 `type:'abnormal'` 把它送到 abnormal-list，**该页没有"补生成"按钮**（按钮在 receive-list.wxml:50）。**文案指路与路由相反** |
| c | `createPurchaseOrder:88-100`「订货报表生成失败」（下单侧） | `orderNo`（订单号） | abnormal-list | **✗ 完全错误域**：这是报表问题不是异常记录问题，异常列表里根本没有对应条目（`abnormal_record` 只在 createReceipt 产生）。且唯一能补订单侧报表的 `regenerateOrderReports` 前端 0 调用（已核实事实）。**系统通知管理员做一件没有任何页面能做的事**，且送到做不了事的页面 |
| d | `dataService:817-827`「异常已解决」 | `abnormal_id` | abnormal-list | **△ 半断裂**：域对了，但 abnormal-list 无定位，用户需自己找。且该消息定向店长（:825 `getStoreManagerId`），店长看到后需切到该异常条目确认——列表按 `created_at` 倒序（dataService:746）且限 100 条，通常能找到 |
| e | `dataService:831-837`「待补结算提醒」 | `receiptId` | abnormal-list | **✗ 落错域**：content 明写「请管理员尽快执行**补结算（settleReceipt）**」（:834），但 `settleReceipt` 按钮在 receive-list.wxml:52，abnormal-list 没有。与 b 同源问题 |

**闭环缺口统计**：`type:'abnormal'` 5 处生产者中 **3 处（b、c、e）指向一个执行不了所需动作的页面**，1 处（a）域对但无定位，1 处（d）域对但无定位。加上 `type:'receive'` 1 处断裂、`type:'order'` 1 处死信（无 bizId）、1 处跨租户可见死信（无 bizId），**消息中心 9 个生产者中有 6 个的点击行为不达目标**。

**根因总结**：全仓只有 `purchase-detail` 实现了带参数的 `onLoad` 消费（`options.id`）。`receive-list`、`abnormal-list`、`supplier-orders` 三个跳转目标页均无 `onLoad`，`message.js` 的路由分支在三个目标上**都不传参**。因此 `message.js:48-50` 的注释描述的"收货类 bizId 是收货单号(RCP…)，跳收货列表"在功能上是**不成立的**——跳过去了也无法用这个单号做任何事。

---

## 6. 页面间导航与参数传递

### 6.1 出边（本批 6 页发出的导航）

| # | 源方法 | 目标 | URL 参数 | 目标页是否读取 |
|---|---|---|---|---|
| 1 | approval-list.js:65 `goDetail` | `/pages/approval-detail/approval-detail` | `id` | **✓ 读**（approval-detail.js:22 `options.id \|\| options.orderId`） |
| 2 | approval-list.js:86 `approveRequest` | 无导航，`this.onShow()` 刷新 | - | - |
| 3 | approval-list.js:100 `rejectRequest` | 无导航，`this.onShow()` 刷新 | - | - |
| 4 | approval-detail.js:86 `approveRequest` | `wx.navigateBack()`（800ms 后） | - | - |
| 5 | approval-detail.js:108 `rejectRequest` | `wx.navigateBack()`（800ms 后） | - | - |
| 6 | receive-list.js:114 `goVerify` | `/pages/receive-verify/receive-verify` | `orderId` | **✓ 读**（receive-verify.js:58 `options.orderId \|\| options.id`） |
| 7 | receive-list.js:82-87 权限标志 | 无导航 | - | - |
| 8 | receive-verify.js:266 `submitReceipt` 成功无异常 | `wx.switchTab('/pages/report-list/report-list')` | 无 | 未验证：report-list 不在本批范围 |
| 9 | receive-verify.js:268 `submitReceipt` 其他情况 | `wx.navigateBack()` | - | - |
| 10 | abnormal-list.js 全部 3 个写操作 | 无导航，`this.onShow()` 刷新 | - | - |
| 11 | message.js:54 `readMessage`（supplier 角色） | `/pages/supplier-orders/supplier-orders` | **无** | 未验证：supplier-orders 不在本批范围 |
| 12 | message.js:58 | `/pages/abnormal-list/abnormal-list` | **无（丢弃 bizId）** | **✗ 目标页无 onLoad，读了也没用** |
| 13 | message.js:64 | `/pages/receive-list/receive-list` | **无（丢弃 bizId）** | **✗ 目标页无 onLoad，读了也没用** |
| 14 | message.js:66 | `/pages/purchase-detail/purchase-detail` | `id` | **✓ 读**（purchase-detail.js:12） |
| 15 | abnormal-list.js:14 / approval-list.js:16 / approval-detail.js:19 / receive-verify.js:55 守卫失败 | `wx.navigateBack()`（800-1200ms 后） | - | - |

### 6.2 入边（进入本批 6 页的来源）

- `approval-detail`：仅从 approval-list:65 进入。参数 `id` ✓
- `receive-verify`：仅从 receive-list:114 进入。参数 `orderId` ✓
- `approval-list` / `receive-list` / `abnormal-list` / `message`：**均无 `onLoad`，不接受任何参数**。`approval-list` 与 `receive-list` 是 tabBar 之外的列表页，理论上应从 index 页进入——**index.js 不在本批范围，未验证是否有入口链接到 approval-list / receive-list**（若 index 未提供入口，approval-list 只能靠 search 或直链到达，属产品可达性问题）

### 6.3 参数读取但没用 / 读了没用

- **`receive-verify.js:58` 读 `options.id` 作为 `orderId` 的兜底**，但唯一入边（receive-list:114）只传 `orderId` → **`options.id` 分支永不可达**（防御性代码，无害）
- **`approval-detail.js:22` 读 `options.orderId` 兜底**，唯一入边只传 `id` → 同理永不可达
- **`message.js:51-68` 读了 `message.bizId` 但在 3 个分支（supplier-orders / abnormal-list / receive-list）全部丢弃** → 已计入 §5 闭环缺口
- **`getPurchaseOrders` 的 `role`/`storeId`/`createdBy` 参数**：`role` 全仓不被读取（getPurchaseOrders:43-66 从会话派生）；`createdBy` 仅 `isGlobal` 分支读取（:63），chef 分支忽略（:55 用会话 ID）；`storeId` 仅 `isGlobal` 分支读取（:62）。approval-list 传 `createdBy:''`（:25，空串 → 后端 :63 判假 → 不过滤 ✓ 正确）；receive-list 为 chef 传 `createdBy: user.name` 兜底（:23）→ **语义错误且被忽略**（详见 §2.3）
- **`getReceipts` 的 `role`/`storeId`/`receiptDate`**：`role` 与 `storeId` 被完全忽略（getReceipts:49-59 从会话派生）；`receiptDate` 会生效（:61）但 receive-list 从不传 → 该参数在本批无调用

---

## 7. 死代码与未闭合点

按严重程度排列。

### 7.1 假空态（catch 吞错后仍显示"暂无数据"）—— 4 处

| # | 位置 | 失败路径 | 用户所见 |
|---|---|---|---|
| 1 | **receive-list.js:38-41** | `getPurchaseOrders` 返回非 0 | wxml:27-30「暂无待收货订单」——**订单加载失败被显示成没有订单**，用户会以为今天没货要收 |
| 2 | **receive-list.js:33-37** | `Promise.all` 抛异常 | 同上 |
| 3 | **abnormal-list.js:19-22** | `getAbnormalRecords` 返回非 0 | wxml:53-56「暂无异常记录」——异常处理是最该被看见的流程，此处的假空态会让管理员误以为无异常待办 |
| 4 | **message.js:18-21** | `getMessages` 返回非 0 | wxml:26-29「暂无消息」——tabBar 常驻页，假空态影响面最大 |

对照正例：**approval-list.js:28-33**（置 `loadFailed:true` + wxml:28-31 有失败态分支）与 **approval-detail.js:27-31**（置 `loadFailed:true` + wxml:4-8 有失败态 + "重试"按钮）——同批代码中存在正确写法，说明这是**局部遗漏而非系统性设计**，修复成本低。

### 7.2 失败后不刷新/不重试

| # | 位置 | 问题 |
|---|---|---|
| 1 | **receive-verify.js:69-72** | 订单加载失败 → toast + return，页面停在只有"待验收"标签的空壳，**商品列表空、提交按钮仍可点**。无 `loadFailed` 态、无重试按钮。对比 approval-detail 有 `retryLoad`。用户唯一的出路是 `navigateBack` 后重进 |
| 2 | **receive-verify.js:59-62** | 无 id 时同样只 toast，无失败态 |
| 3 | **receive-list.js:118-137** | `settleReceipt` 成功后**不调 `this.onShow()`**（对比 :159 `regenerateReports` 与 :183 `repriceReceipt` 都调了）→ "补结算"链接持续可见，重复点击靠后端幂等拒绝 |
| 4 | **message.js:42** | `markMessageRead` 失败 → `return util.showToast(...)` 中止，**本地 `read` 状态不更新、不跳转**；`util.showToast` 返回 `undefined`，`return undefined` 无害但写法易误导 |

### 7.3 `hideLoading` 不在 finally 中 —— 6 处（结构隐患，当前无实际悬挂）

`receive-list.js:99-100`（previewReceiptPhotos）、`:125-130`（settleReceipt）、`:147-152`（regenerateReports）、`:170-175`（repriceReceipt）、`receive-verify.js:64-68`（onLoad）、`:235-243`（recoverCommittedReceipt 外层，此处 :242-243 是 finally ✓ 正确）。共 5 处结构隐患。实际不会悬挂的原因是 `cloud.callFunction` 内部 try/catch 永不抛错（cloud.js:65-75），但 `cloud.getFileUrls`/`uploadReceiptPhotos` 会抛错——**`previewReceiptPhotos` 是唯一真实可能悬挂 loading 的路径**（cloud.js:255-268 内部有 try/catch 返回 `[]`，实测不抛；`uploadReceiptPhotos` 在 :199 处被外层 catch 包住，catch 里无 hideLoading，但 :230 的 finally 会执行 ✓）。**结论：当前无实际悬挂，但 5 处结构不健壮，且唯一有风险的 `previewReceiptPhotos` 恰好缺 finally。**

### 7.4 死变量与死字段

| # | 位置 | 内容 |
|---|---|---|
| 1 | approval-list.js:74 | `const app = getApp()` 未使用 |
| 2 | approval-list.js:95 | 同上 |
| 3 | approval-detail.js:78 | 同上 |
| 4 | approval-detail.js:103 | 同上 |
| 5 | abnormal-list.js:50, 80, 98 | 3 处同上 |
| 6 | message.js:37, 74 | 2 处同上 |
| 7 | receive-verify.js:234 | `let recovered` + `recovered:true` 字段前端从不消费（:248-271 只读 `reportsGenerated`/`reportWarning`/`hasAbnormal`/`abnormalTypeNames`） |
| 8 | receive-verify.js:249 | `reportsGenerated` 被读取并用于文案，但 `recoverCommittedReceipt` 恒返回 `0`（:31）→ 恢复路径下永远显示「已生成0份」 |
| 9 | receive-list.js:54 | `manualCount` 白算（§3 D2） |
| 10 | approval-list.js:45 | `statusText` 白算（§3 D1） |
| 11 | message.js:24 | `messages[].time` 白算（§3 D3） |
| 12 | abnormal-list.wxss:41 | `.type-dot-delay` 对应 `delay` 类型，全仓无此类型（`ABNORMAL_TYPE_NAMES` 无、createReceipt:523-527 不产生）→ 死 CSS |
| 13 | abnormal-list.wxss:39-42 | `.type-dot-missing_price` **未定义** → 缺价异常显示默认灰点（CSS 缺失） |
| 14 | receive-list.wxss:33-39 | `.delivery-info`、`.order-amount` 两个类在 receive-list.wxml 中无引用 → 死 CSS |
| 15 | receive-verify.wxml:71 | `wx:key="index"` 在 `wx:for="{{photos}}"` 中无效——`wx:key` 期望的是 item 的属性名，而 `photos` 的 item 是字符串（fileID 路径），无 `index` 属性 → 退化为默认列表键。功能正常（有 `data-index` 供删除用），但语义错误 |
| 16 | receive-list.wxml:23 | `{{item.itemCount}}种商品` 显示的是**订单行数**，含手动行；`manualCount` 明明算出来了却不用来区分「X 种商品（含 Y 个手动）」 |

### 7.5 定义了但从未绑定的标志 / 分页未启用

| # | 位置 | 问题 |
|---|---|---|
| 1 | **approval-list.js:26** | `pageSize:100` 写死，**无分页、无加载更多**。待审单超 100 条时静默截断，wxml:5 的"共 N 条"显示截断后计数 |
| 2 | **receive-list.js:24** | 同上，`pageSize:100` |
| 3 | **receive-list.js:30** | `pageSize:5` 写死，"最近收货记录"仅 5 条，**无查看全部入口** |
| 4 | **abnormal-list.js:17** | `getAbnormalRecords` 无分页参数，后端固定 `limit(100)`（dataService:748）→ 异常超 100 条静默丢失 |
| 5 | **message.js:16** | `getMessages` 无分页参数，后端固定 `limit(100)`（dataService:673）→ **tabBar 常驻页消息超 100 条最老的永久不可见**，且无任何提示 |
| 6 | **receive-list.js:82-88** | `canRegenerate`/`canReprice`/`canSettle` 只在双请求成功路径写入，`receiptResult` 失败路径不写（§3 C 类） |
| 7 | 全部 6 页 | **无任何 `loading` 骨架/占位态**。首帧到 `setData` 之间，5 页直接闪现空态文案，receive-verify 闪现"提交按钮可点但无商品" |
| 8 | receive-verify.js:160 | `typeof item.receivedQty !== 'number'` 是**死检查**——`onReceivedQtyInput` 已把空串转为 `0`（:109），永远是 number |

### 7.6 补偿逻辑依赖错误假设

| # | 位置 | 假设 | 为何错误 |
|---|---|---|---|
| 1 | **receive-verify.js:23-25** | 「`receipts[0]` 就是本次提交的收货单」 | `getPurchaseOrderDetail:120-123` 查 receipt 无 `orderBy`，分批场景下 `receipts[0]` 是历史最早批次。会把历史批次的异常状态报给本次提交 |
| 2 | **abnormal-list.js:77-79** | 「付款裁决对所有异常类型同样有效」 | `settleReceipt:965` 要求 `price_snapshot > 0` → `missing_price` 异常选 `pay_received` 永远无法解锁，状态机推进到 resolved 但钱进不了账单，形成死锁闭环 |
| 3 | **receive-verify.js:159-166** | 「实收数量上限是订单数量」 | 分批收货的上限应为 `remaining_qty`（订单量 − 历史累计）。后端 createReceipt:296-298 与 :450-454 用累计量拦截，前端用下单量 → 前端提示文案「实收数量不能超过订单数量」是错误口径 |
| 4 | **receive-list.js:76-78** | 「前端算出的 `hasMissingPrice` 等价于后端 `missing_price` 异常」 | 两套独立信号。后端判定额外要求 `receivedQty > 0`（createReceipt:403），且后端异常记录才是 `repriceReceipt` 的操作对象。前端标记只用于按钮可见性 |
| 5 | **message.js:61-62** | 「`bizId` 以 RCP 开头即为收货消息」 | `abnormal_id` 也以 receiptId 开头（createReceipt:543 `${receiptId}_${i}_${type}`）→ 同为 RCP 前缀。因 `type==='abnormal'` 分支（:57）先命中，此兜底只对 type 缺失的旧消息生效，边界靠 type 优先保证 |
| 6 | **approval-list.js:36** | 「`pending_approval` 是有效状态」 | 全仓无写入点（`grep pending_approval` 在 cloudfunctions 下仅出现在读取白名单与在途状态集合），过滤条件一半永假。旧审计报告 审查报告-2026-09-30.md:848 已独立确认 |
| 7 | **abnormal-list.js:96** | 「关闭异常可反悔」 | 确认文案仅说"关闭后不可继续处理"，未提示不可撤销；后端无 reopen 入口 |
| 8 | **receive-list.js:121-124, 145-147, 168-170** | 「弹窗后可再置防重锁」 | 与 receive-verify.js:187-188 的正确写法（先置位再弹确认）相反。弹窗期间双击可并发进入同一写操作，靠后端幂等/锁兜住 |

### 7.7 前端校验漏项汇总（后端均有兜底）

| # | 位置 | 前端漏检 | 后端兜底 |
|---|---|---|---|
| 1 | receive-verify.js:159-162 | 数量上限用 `orderQty` 而非 `remaining_qty` | createReceipt:296-298 + :450-454 累计量校验 |
| 2 | approval-detail.js:73 | `approveQty` 无上界校验、无非整数校验 | dataService:541 `qty > sourceItem.order_qty` 拒绝 |
| 3 | receive-verify.js:105-110 | 无上限拦截（依赖 submit 时校验） | 同上 |
| 4 | approval-list.js:68-87 | 列表页审批不收集改量（`items:[]`） | 后端无兜底——**这是行为缺陷不是校验漏项**：改量机会被跳过 |
| 5 | abnormal-list.js:117（onItemRemarkInput 无长度） | 备注无长度限制 | 无后端长度限制，仅 CSV 转义（csvField） |

---

## 8. 未验证清单

以下事项无法从代码静态确认，均需运行时或数据核验：

| # | 事项 | 建议验证方式 |
|---|---|---|
| 1 | `order_date` / `receipt_date` 在数据库中的实际存储形状（字符串 vs Date 对象） | 查询 `purchase_order.order_date` 与 `receipt.receipt_date` 各 5 条样例；receive-list.wxml:9/:36 直接渲染未格式化值，若为 Date 对象会显示 `[object Object]` |
| 2 | receive-list 假空态在真机上的用户影响面 | 断网或用未授权 token 触发 `getPurchaseOrders` 返回 -401/-1，观察是否显示"暂无待收货订单" |
| 3 | `regenerateOrderReports`（下单侧补报表）是否真的前端 0 调用 | 已由跨域报告确认，本批仅复核 `pages/` 目录下的 `approval-list`/`receive-list`/`receive-verify`/`abnormal-list`/`message` 五页均无调用 |
| 4 | `index` 页是否提供 approval-list / receive-list 的入口 | 需读 `pages/index/index.js`（不在本批范围）；若无入口，两页只能靠消息跳转到达，而消息跳转不带参数 |
| 5 | `receive-verify` 的分批收货在真实并发下的 `recoverCommittedReceipt` 误报率 | 需构造：同一订单 3 批次提交，第 3 批人为中断网络，观察是否误报第 1 批结果 |
| 6 | `missing_price` 异常经 `resolveAbnormal` 裁决为 `pay_received` 后的账单缺口金额 | 需实际执行：建缺价收货单 → 异常列表选"转回可付款" → 补结算，验证是否得到"没有因异常处理解锁的明细行" |
| 7 | 质量/错货异常选 `pay_received` 是否被业务视为合法 | 需产品确认；代码上 `settleReceipt:965` 允许，前端无按类型警示 |
| 8 | `message.markAllRead` 在 100 条消息下的实际耗时与界面冻结感 | 后端 dataService:711-718 是串行 for 循环，每条一次读写，需真机测 |
| 9 | 供货商消息（scope_type=supplier, store_id=''）是否真被店长/采购员看到 | 需以 store_manager 角色查询 message 集合，验证 getMessages:666-671 的 storeCondition 是否命中 `store_id:''` |
| 10 | `wx.chooseMedia` 的 9 张上限与 `wx.cloud.uploadFile` 单张超时在网络抖动下的部分成功比例 | 弱网测试，观察孤儿文件累积 |
| 11 | `approval-detail` 允许小数审批量是否业务合法 | `type="digit"` 允许小数点，前端只校验 `> 0`，后端只校验 `qty > 0 && qty <= order_qty`（dataService:541） |
| 12 | `closeAbnormal` 误点关闭后的实际恢复手段 | 代码层无任何 reopen 入口，恢复只能靠数据库直改 |
| 13 | `receive-verify` 的 `receiptDate` 客户端可任意指定（含未来日期） | createReceipt:330-337 只校验格式与有效性，不拒未来日期、不打 backfilled 标记 |
| 14 | 6 页 wxss 中未引用的类是否全部为本报告已列出的 4 处 | 本报告抽查了 receive-list/abnormal-list 两页的类名引用；approval-list/approval-detail/receive-verify/message 的 wxss 类名未逐一比对 |
| 15 | `approval-list` 与 `receive-list` 在 tabBar 之外的可达性 | 见第 4 项 |

---

## 9. 行数对账

| 文件 | 实测行数（Measure-Object） | 报告引用最末行 | 一致性 |
|---|---|---|---|
| pages/approval-list/approval-list.js | 105 | :105（`})`） | ✓ |
| pages/approval-list/approval-list.wxml | 36 | :36（`</view>`） | ✓ |
| pages/approval-list/approval-list.wxss | 70 | :70 | ✓ |
| pages/approval-list/approval-list.json | 4 | :4 | ✓ |
| pages/approval-detail/approval-detail.js | 113 | :113（`})`） | ✓ |
| pages/approval-detail/approval-detail.wxml | 70 | :70（`</view>`） | ✓ |
| pages/approval-detail/approval-detail.wxss | 80 | :80 | ✓ |
| pages/approval-detail/approval-detail.json | 3 | :3 | ✓ |
| pages/receive-list/receive-list.js | 185 | :185（`})`） | ✓ |
| pages/receive-list/receive-list.wxml | 57 | :57（`</view>`） | ✓ |
| pages/receive-list/receive-list.wxss | 44 | :44 | ✓ |
| pages/receive-list/receive-list.json | 4 | :4 | ✓ |
| pages/receive-verify/receive-verify.js | 276 | :276（`})`） | ✓ |
| pages/receive-verify/receive-verify.wxml | 94 | :94（`</view>`） | ✓ |
| pages/receive-verify/receive-verify.wxss | 145 | :145 | ✓ |
| pages/receive-verify/receive-verify.json | 3 | :3 | ✓ |
| pages/abnormal-list/abnormal-list.js | 110 | :110（`})`） | ✓ |
| pages/abnormal-list/abnormal-list.wxml | 57 | :57（`</view>`） | ✓ |
| pages/abnormal-list/abnormal-list.wxss | 73 | :73 | ✓ |
| pages/abnormal-list/abnormal-list.json | 3 | :3 | ✓ |
| pages/message/message.js | 83 | :83（`})`） | ✓ |
| pages/message/message.wxml | 30 | :30（`</view>`） | ✓ |
| pages/message/message.wxss | 78 | :78 | ✓ |
| pages/message/message.json | 3 | :3 | ✓ |
| **合计（24 文件）** | **1,726** | — | ✓ |

验算：js 105+113+185+276+110+83 = 872；wxml 36+70+57+94+57+30 = 344；wxss 70+80+44+145+73+78 = 490；json 4+3+4+3+3+3 = 20；872+344+490+20 = **1,726** ✓

附加读取（只读对照，不计入 24）：`utils/cloud.js` 283、`utils/util.js` 128、`utils/auth-guard.js` 17、`utils/meta.js` 68、`app.json` 75；云函数片段：`getPurchaseOrders` 148、`getPurchaseOrderDetail` 149、`getReceipts` 92、`createReceipt` 807、`dataService` 相关段（498-648、650-863、909-1049、1100-1229、194-227、318-460、1510-1549）、`createPurchaseOrder` 片段、`confirmSupplierOrder` 片段。

**方法计数**：approval-list 5 + approval-detail 6 + receive-list 7 + receive-verify 9（含模块级 `recoverCommittedReceipt`）+ abnormal-list 7 + message 3 = **37 个**，与 §0 声明一致。

**WXML↔JS 对账统计**：A 类 0 条、B 类 0 条、C 类 0 严格项 + 1 条件来源项、D 类 4 条（其中 D4 已判定为非死代码）。

---

## 附：本报告未重报的已核实事项（供索引）

以下已在 `00-crosscutting-verified.md` 或跨域报告中锁定，本批仅在正文中标注引用，未重复取证：
- X1（嵌套 -401 致会话过期不跳登录）不成立 —— 撤回
- `getFileUrls` 客户端直调 `wx.cloud.getTempFileURL` 无鉴权（cloud.js:255）
- `getReports` 返回原始文档含 `file_url`；`getReports:43` 的 `role`/`storeId` 为死参数
- `confirmSupplierOrder` 已闭合（supplierId 会话派生 + 商品归属校验 + CAS）
- `createReceipt:425` 白名单不含 `receipt_abnormal` 致死锁；`settleReceipt` 不触碰 `abnormal_record`
- `cancel_requested` 全仓只写不清；`requestCancel` 允许 `partial_received` 而 `cancelOrder` 拒绝
- `message.js` 读 `m.id`/`m.bizId`/`m.time` 是正确的（`dataService:638-649 publicMessage` 已映射）
- `createPurchaseOrder:90-93` 的 `MSG_ORDER_REPORT_MISSING`（`type:'abnormal'`）路由错误 + `regenerateOrderReports` 前端 0 调用
- `getReceipts` 对 chef 空分支返回形状缺 `page`/`pageSize`（A4 已记）
- `pending_approval` 死状态（审查报告-2026-09-30.md:848 已独立确认）

