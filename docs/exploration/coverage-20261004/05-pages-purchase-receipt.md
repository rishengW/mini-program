# 覆盖勘探 05：采购 / 收货 / 审批 / 异常 前端 8 页

> **范围**：`pages/{purchase-create, purchase-detail, purchase-list, receive-list, receive-verify, approval-list, approval-detail, abnormal-list}` × 4 文件（.js/.json/.wxml/.wxss）= **32 文件，3295 行，全读完成**。
> **基线**：HEAD = `07b6461`（fix(supplier): restrict order visibility and actions until internal approval），工作区干净，分支 `backup`。
> **交叉参照（只读）**：`utils/{cloud,util,meta,auth-guard}.js`、`app.js`、`pages/store-switch/store-switch.js`、云函数 `dataService`(1681 行)、`createPurchaseOrder`(517)、`getPurchaseOrders`(149)、`getPurchaseOrderDetail`、`getReceipts`(93)、`createReceipt`(≥753)、`getProducts`(67)、`authService`(getStores)。
> **方法**：只信代码不信注释。所有结论带 `文件:行号`。与旧报告不一致处显式标注。
> **前置文档**：`rescan-20261004-R7-pages-purchase-receipt.md`（598 行，本批唯一直接前置）、`full-scan-02-cloud-purchase-receipt.md`。

---

## 0. 结论摘要

**规模**：8 页 / 32 文件 / 3295 行。33 个 `callFunction` 调用点，云函数 6 个（`getPurchaseOrderDetail`、`getPurchaseOrders`、`getProducts`、`createPurchaseOrder`、`createReceipt`、`dataService`）。

**本批最高价值的 4 个结论：**

1. **旧报告头号结论 N1 判断有误——`dataService` 的会话过期处理实际上是正常的。** `dataService:45-52` 的 `requireUser` 确实返回嵌套 `{ error: { code: -401 } }`，但全部 25 个调用点统一写成 `if (auth.error) return auth.error`，**返回的是内层对象**，即顶层 `{ code: -401, msg }`，`utils/cloud.js:68` 的 `result.code === -401` 能正常命中并跳登录。旧报告基于"嵌套结构会穿透到客户端"的推断，漏看了 `return auth.error` 这一层。
2. **旧报告 N9（`createPurchaseOrder` ReferenceError 使报表告警永久失效）已修复。** 现为模块级 `markOrderReportsMissing(orderNo, storeId)` + 函数级 `persistedOrderNo`/`persistedStoreId`（`createPurchaseOrder:75-105`、`:139-141`、`:503`），注释明确记录了原缺陷。
3. **旧报告 N2（门店切换误伤 chef/store_manager）大幅高估。** `authService:getStores` 对 `STORE_ROLES` 强制 `query.store_id = user.default_store_id`，**chef/store_manager 在门店切换页只看到一个门店，根本无法切到其他门店**。管理员切换则被服务端完整支持（`createPurchaseOrder:247-252`）。真实残留仅是"currentStore 被其他页面清空后建单页报错"这一支。
4. **新发现的高危问题：`receive-verify` 的补偿逻辑在分批收货场景下会给出假成功。** `receive-verify.js:23-25` 以 `receipts[0]` 假定首元素即本次提交，而 B3 分批收货上线后一笔订单常态存在多张收货单——**只要该订单历史上收过货，一次真实失败的提交就会被判成"验收完成"并把用户引导去报表中心**。

**其他要点：**

- **js ↔ wxml 绑定不匹配 3 组**（详见 §3）：`purchase-detail` 有 10 个 wxml 引用字段未进 `data` 初值（首帧闪烁 + 状态文本空白）；`purchase-list` 的 `isLoading`/`isLoadingMore` 是纯死字段（全页无任何加载指示）；`purchase-create` 的 `isSubmitting` 被置位但 wxml 两个按钮无 `disabled`/`loading`。
- **契约层面 0 处致命不匹配。** `normalizePurchaseOrder → normalizePurchaseItem`（`cloud.js:123-169`）已把 snake_case 全量归一化，前端 33 个调用点全部取到值。无 F1/H10 型双层包裹。
- **前端严于/松于云端的错位 5 处**，其中 1 处（`receive-list` 补结算按钮）会让用户点击必失败。
- **防抖矩阵：13 个写操作只有 `receive-verify.submitReceipt` 一个满分**（置位在弹窗前 + `finally` 复位 + UI 锁）；`abnormal-list` 3 个写操作 + `purchase-detail` 的 `copyToDraft`/`submitRequest` 完全裸奔。
- **旧报告 8 处判断有误或已变化**（详见 §7）。

---

## 1. 文件清单与 json 配置

| 页面 | js | wxml | wxss | json | 合计 |
|---|---|---|---|---|---|
| purchase-create | 435 | 147 | 164 | 2 | 748 |
| purchase-detail | 401 | 140 | 152 | 2 | 695 |
| purchase-list | 154 | 46 | 122 | 3 | 325 |
| receive-list | 185 | 57 | 44 | 3 | 289 |
| receive-verify | 276 | 94 | 145 | 2 | 517 |
| approval-list | 105 | 36 | 70 | 3 | 214 |
| approval-detail | 113 | 70 | 80 | 2 | 265 |
| abnormal-list | 110 | 57 | 73 | 2 | 242 |
| **合计** | **1779** | **647** | **850** | **19** | **3295** |

**json 配置核对（8/8 已读）：**

| 页面 | navigationBarTitleText | enablePullDownRefresh | js 侧实现 |
|---|---|---|---|
| purchase-create | 门店采购申请 | 未开 | 无（表单页，合理） |
| purchase-detail | 采购申请详情 | 未开 | `onShow` 重拉（:16-18）→ 合理 |
| purchase-list | 我的采购 | ✅ | onPullDownRefresh :41-43 / onReachBottom :45-48 → **本批唯一完整分页** |
| receive-list | 待收货订单 | ✅ | onPullDownRefresh :108-111 → `await this.onShow()` |
| receive-verify | 收货验收 | 未开 | 仅 onLoad（:48）→ 见问题 M5 |
| approval-list | 待审核申请 | ✅ | onPullDownRefresh :59-62 → `await this.onShow()` |
| approval-detail | 审核详情 | 未开 | 仅 onLoad（:13）→ 见问题 M5 |
| abnormal-list | 异常记录 | 未开 | `onShow` 重拉（:13）→ 但**无 loadFailed 态**，失败时只显示"暂无异常记录" |

---

## 2. 逐页解剖

### 2.1 `purchase-create`（js 435 行）——采购建单，本批最复杂

**职责**：门店采购申请建单（档案商品按分类选择 + 手动商品最多 5 个），自动拆单为档案单/手动单，支持草稿与提交。

- **`data`（:9-31）**：`categoryL1List / activeL1:'kitchen' / filteredCategories / activeCategoryId:1 / products / displayProducts / searchKey / manualItems / showManualPopup / manualForm{name,categoryL1,unit,qty,remark} / orderDate / deliveryDate / remark / today / tomorrow / totalCount / isSubmitting`。
- **`this` 会话态（不进 setData）**：`editingOrderId`(:36)、`manualOrderId`(:37)、`catalogOrderId`(:38)、`catalogOrderSubmitted`(:41)、`catalogSeq`(:42)、`requestId`(:44)、`_qtyMap`(:92)。
- **生命周期**：`onLoad`(:34-53) → `loadReferenceData()`(:51) → `getCategories` + `getProducts` + `filterProducts()`；`editingOrderId` 存在则 `loadExistingOrder()`(:52)。**无 `onShow`**（从详情页复制草稿返回后不刷新）。
- **callFunction（6 处）**：
  | 位置 | 函数 | 入参 |
  |---|---|---|
  | :57 | getPurchaseOrderDetail | `{ orderId }` |
  | :104 | dataService/getCategories | `{}` |
  | :126 | getProducts | `{ includeInactive: false }` |
  | :370 / :385 / :412 | createPurchaseOrder | `buildPayload(items, orderId, suffix)` |
- **`buildPayload`（:320-336）字段**：`storeId, storeName, orderId, orderDate, deliveryDate, createdBy, createdByName, items, remark, orderStatus, requestId`。`requestId = this.requestId + ':' + orderStatus + suffix`（`:c`/`:c2`/…/`:m`）。
- **`toPayloadItems`（:344-359）字段**：`productId, productName, category, unit, supplierId, orderQty, isManual, remark`。
- **跳转**：:68 navigateBack（非草稿被拒）、:429 navigateBack（成功）。
- **权限**：前端**零门禁**，只 `requireLogin()`。真校验在 `createPurchaseOrder:145-147`（白名单 chef/store_manager/super_admin/purchaser，**不含 supplier**）。

### 2.2 `purchase-detail`（js 401 行）——详情 + 10 个权限 flag

**职责**：采购单详情展示（按供货商分组）、编辑/提交/复制/作废/催审、手动单凭证提交与核销。

- **`data`（:8）**：`{ detail:{items:[]}, canReceive, canEdit, canCancel, voucherImages }`。**仅 5 个字段**。
- **生命周期**：`onLoad`(:10-14) 取参；`onShow`(:16-18) 重拉。
- **callFunction（9 处）**：:23 getPurchaseOrderDetail；:161 dataService/verifyManualOrder(submit)；:196 remindAudit；:230 verifyManualOrder(approve|reject)；:260 requestCancel；:288 cancelOrder；:336/:372 createPurchaseOrder（copyToDraft / submitRequest）；:117 `cloud.getFileUrls`。
- **10 个权限 flag（:71-113）**：
  | flag | 行 | 条件 | 与云端对照 |
  |---|---|---|---|
  | canReceive | :71 | `role !== 'chef'` && status ∈ {approved, report_generated, partial_received} | ✅ 与 `createReceipt:239/:417` 逐字一致 |
  | canEdit | :73-77 | draft && (super_admin/purchaser ‖ `createdById===userId` ‖ store_manager && `storeId===defaultStoreId`) | ✅ 与 `createPurchaseOrder:233-239` 一致 |
  | canCopy | :79 | status='rejected'，**无角色校验** | ⚠️ 与 canEdit 不对称 |
  | canCancel | :81 | submitted && {purchaser, super_admin} | ✅ |
  | canRequestCancel | :85 | {approved, report_generated} && {purchaser, super_admin} && `!cancelRequested` | ✅ 比 `requestCancel:1343+` 更严 |
  | canForceCancel | :86 | 同上 && super_admin | ✅ |
  | canRemindAudit | :88 | submitted && **非**{purchaser, super_admin} | ⚠️ 云端允许管理员催自己 |
  | canSubmitVoucher | :97-100 | isManual && {store_manager,purchaser,super_admin} && status ∈ {received, receipt_abnormal, partial_received} && verifyStatus ∈ {none, rejected} | ✅ 与 `verifyManualOrder:1552/:1578-1583` 一致 |
  | canVerify | :112-113 | isManual && verifyStatus='pending' && {purchaser, super_admin} | ✅ 一致 |
- **幂等**：`_genRequestId(kind)`(:305-312) 按 kind 缓存，仅用于 copy/submit 两条路径。
- **跳转**：:316 editRequest → purchase-create?orderId=；:350 copyToDraft → purchase-create?orderId=；:389 navigateBack；:398 goReceive → receive-verify?orderId=&storeId=。

### 2.3 `purchase-list`（js 154 行）——服务端分页，本批数据流最规范

**职责**：门店采购单列表，8(+1) 个状态 tab、上拉加载、下拉刷新、直达详情/收货。

- **`data`（:11-20）**：`activeFilter:'all' / filterTabs / filteredList / orders / isLoading / isLoadingMore / loadFailed / hasMore:true / page:1`。`PAGE_SIZE=20`(:8)。
- **生命周期**：`onLoad`(:23-29) 只读 `options.status`，**不校验合法值**；`onShow`(:31-39) 读 `app.globalData.pendingListFilter` 并清空 → `reload()`；onPullDownRefresh(:41-43) → `reload().finally(stopPullDownRefresh)`；onReachBottom(:45-48) 带三重守卫。
- **callFunction（1 处）**：:71 getPurchaseOrders，入参 `{role, storeId, createdBy, page, pageSize, orderStatus?}`。
- **tab 计数**：:84-99 全部取 `result.statusCounts`，键名与 `getPurchaseOrders:96-106` **逐字一致**（all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable）。✅
- **`renderList`（:116-134）**：`canReceiveRole = role !== 'chef'`(:118)；`canReceive`(:123)；`manualCount`(:121) 被 wxml:28 使用；`itemCount`(:128) **wxml 未使用**。
- **跳转**：:138 goDetail → purchase-detail?id=；:146 goReceive → receive-verify?orderId=&storeId=；:152 goCreate → purchase-create。

### 2.4 `approval-list`（js 105 行）——审批列表

**职责**：待审核采购单列表，列表内直接通过/驳回。

- **`data`（:8）**：`{ list:[], loadFailed:false }`。
- **门禁（:13-18）**：`!['super_admin','purchaser'].includes(me)` → toast + `setTimeout(navigateBack, 800)`。**纯前端**，URL 可直接构造进入；真校验在 `auditOrder:492-493`（MANAGEMENT_ROLES）。
- **callFunction（3 处）**：:22 getPurchaseOrders（`pageSize:100`、**无 page、无 orderStatus**）；:75/:96 dataService/auditOrder。
- **客户端过滤（:36）**：`.filter(o => o.orderStatus === 'submitted' || o.orderStatus === 'pending_approval')`。
- **items 重映射（:47-51）**：`productName: item.productNameSnapshot` / `requestedQty: item.orderQty` —— **实际为冗余**，`cloud.js:128/:133` 的 `normalizePurchaseItem` 已完成归一（旧报告认为是修复点，见 §7-9）。
- **跳转**：:16 门禁失败 navigateBack；:65 goDetail → approval-detail?id=。

### 2.5 `approval-detail`（js 113 行）——审批详情

**职责**：审核单详情，逐行改审批数量后通过/驳回。

- **`data`（:7-11）**：`{ detail:{}, auditRemark:'', loadFailed:false }`。
- **门禁（:16-21）**：与 approval-list 同口径。
- **`:22` 取参**：`options.id || options.orderId || ''` —— 双名兼容但**无空值防御**；:24 空 id 仍发请求 → 服务端 `getPurchaseOrderDetail:45` 返回明确错误 → `loadFailed:true` → wxml:4-8 失败态 + 重试按钮。**但 `retryLoad`(:57-60) 用同一个空 id 重试，必然再次失败 → 死按钮**。
- **callFunction（3 处）**：:24 getPurchaseOrderDetail；:79 dataService/auditOrder(approved, items 全量)；:104 dataService/auditOrder(rejected, items: [])。
- **数量校验（:73-77）**：`find(item => !(Number(item.approveQty) > 0))` → 仅下限校验，**无上限**；服务端 `auditOrder:534` 兜住「审批数量必须大于 0 且不超过下单数量」。
- **按钮防抖（:67-68 / :94-99）**：入口检查 + **置位在 confirm 之前** + try/finally —— **本批除 receive-verify 外最规范**。
- **`rejectRequest`（:95）**：`if (!this.data.auditRemark)` **未 trim** → 纯空格通过 → 服务端 `:511-512` 以「驳回时必须填写原因」拒绝，前端无提示。
- **仅 onLoad，无 onShow、无下拉刷新**。

### 2.6 `receive-list`（js 185 行）——待收货 + 收货记录 + 3 个补操作

**职责**：待收货订单列表 + 最近收货记录 + 缺报表补生成 / 缺价补账 / 异常后补结算。

- **`data`（:8）**：`{ orders:[], receipts:[] }`。**无 loadFailed、无 canRegenerate/canReprice/canSettle 初值**。
- **门禁（:11）**：仅 `requireLogin()` —— **无任何角色判断**（chef/supplier 均可进入）。
- **并发双请求（:18-37）**：`Promise.all([getPurchaseOrders(pageSize:100), getReceipts(page:1,pageSize:5)])`，外层 try/catch。
- **callFunction（5 处）**：:20 getPurchaseOrders；:26 getReceipts；:126 dataService/settleReceipt；:148 regenerateReceiptReports；:171 repriceReceipt。
- **`role` 兜底（:15）**：`user.role || 'store_manager'` —— 与 `purchase-list:62` 的 `|| 'purchaser'` 不一致（**两者都是死参数**，`getPurchaseOrders:43` 解构后从未使用）。
- **补操作权限（:84-87）**：`canRegenerate/canReprice/canSettle` 同值 `{purchaser, super_admin}` ✅ 与 `dataService:903/1100/1170` 的 GLOBAL_ROLES 一致。
- **`hasMissingPrice`（:76-78）**：`Number(...) <= 0` **把合法的 0 价（赠品）也判为缺价**；且无供应商的行永不被判缺价。
- **失败分支（:57-62）**：收货记录失败时保留 orders + toast，**不渲染假空态** —— 本批异常处理最周到。但 :38-41 分支（待收货订单失败）直接 `return`，**不 setData** → 上一页的旧数据留在屏幕上。
- **跳转**：:114 goVerify → `receive-verify?orderId=`（**无 storeId**，receive-verify 从不读该参数 → 三处入口参数集不同却都工作）。

### 2.7 `receive-verify`（js 276 行）——收货验收

**职责**：分批收货验收，逐项填实收数量 + 异常勾选 + 现场照片，提交后生成报表。

- **`data`（:40-46）**：`{ order:{}, items:[], photos:[], overallRemark:'', isSubmitting:false }`。
- **门禁（:50-57）**：只拦 chef（排除法）。参数 `options.orderId || options.id`(:58) + **空值防御**(:59-62) —— 本批唯一对空参数显式防御的入口页。
- **callFunction（3 处）**：:17 getPurchaseOrderDetail（补偿路径内）；:65 getPurchaseOrderDetail（主加载）；:200 createReceipt。
- **items 初始化（:79-101）**：`receivedTotal / remainingQty`（P1-17）+ `receivedQty:0 / priceSnapshot:0 / payableFlag:true / isShortage/isQualityIssue/isWrongItem:false / remark:''`。
- **数量校验（:159-162）**：类型 + `Number.isFinite` + `< 0` + `> item.orderQty` 四维。**`orderQty` 由 `normalizePurchaseItem:133` 归一，不会是 undefined**（旧报告此处担忧不成立）。
- **防抖（:149-150 / :188-191 / :229-232）**：入口检查 + **置位在 confirm 之前**(:188) + 取消复位(:191) + `finally` 复位(:231) + **wxml:92 `loading="{{isSubmitting}}" disabled="{{isSubmitting}}"`** —— **本批唯一满分**。
- **提交后补偿（:6-37 `recoverCommittedReceipt`）**：`errorType==='CLOUD_UNAVAILABLE'` 或 `/已完成收货|不可收货|连接失败|Not connected/i` → 重查详情 → `orderStatus==='received' || receipts.length>0` 则合成 `code:0`。**`receipts[0]`(:23) 假定首元素即本次单** —— 分批收货下必错。
- **照片先上传后提交（:199→:200）**：上传成功而 `createReceipt` 失败 → **孤儿文件无回滚**。
- **wxml:7 硬编码 `<view class="tag tag-warning">待验收</view>`**，无状态判断。

### 2.8 `abnormal-list`（js 110 行）——异常跟进

**职责**：收货异常台账，三段状态流转（开始处理 → 填写结果 → 关闭）。

- **`data`（:7-11）**：`{ activeFilter:'all', filteredList:[], records:[] }`。**无 loadFailed**。
- **callFunction（4 处）**：:16 dataService/getAbnormalRecords（**payload 空对象**）；:51 startAbnormal；:81 resolveAbnormal；:99 closeAbnormal。
- **时间（:25）**：`cloud.formatDateTime(item.createdAt)`；其余原样透传。
- **本地筛选（:36-45）**：`activeFilter !== 'all'` 时客户端 filter；`statusColorMap`(:42) **在页面内重复定义**而非复用 `meta.getStatusInfo`（`meta.js:14-17` 取值一致）→ 双处漂移隐患。
- **状态机三动作**：pending → 开始处理(wxml:42)；processing → 填写处理结果(wxml:46)；resolved → 关闭异常(wxml:49)。**三个动作都不回写 `purchase_order`**。
- **付款裁决（:78-79）**：
  ```js
  const payConfirmed = await util.showConfirm('该异常行是否按实收数量转回可付款？…\n「取消」则维持不可付款')
  const paymentDecision = payConfirmed ? 'pay_received' : 'reject'
  ```
  而 `util.showConfirm`（`util.js:83-96`）在 `wx.showModal` **fail 时 resolve(false)** → **弹窗调用失败 = 静默提交 reject 并把异常标记 resolved**。
- **`promptResolution`（:60-69）**：`wx.showModal({editable:true, success})` **无 fail 回调** → 弹窗失败时 Promise 永挂起，handler 静默停止（无 toast、无 loading、无按钮复位）。
- **`:55` 不一致**：`if (result.code !== 0) return …` **缺 `!result ||` 前缀**，而 :87/:103 都有。
- **死代码**：:50、:80、:98 三处 `const app = getApp()` 声明后从未使用。

---

## 3. js ↔ wxml 绑定一致性核对（隐藏 bug 专项）

### 3.1 wxml 引用了但 `data` 初值缺失的字段

**`purchase-detail` —— 10 个字段未进 `data`（:8 只声明 5 个）：**

| wxml 引用 | 行 | 首次渲染取值 | 后果 |
|---|---|---|---|
| `supplierGroups` | :46 | `undefined` | `wx:if` 为假 → **非 chef 用户首帧走 :67-81 的 chef 平铺分支**，随后 setData 跳变成分组布局 → 视觉闪烁 |
| `detail.statusType` | :3 | `undefined` | `status-bg-` 空类名 → 状态卡首帧**无背景色** |
| `detail.statusText` | :10 | `undefined` | 状态卡首帧空白 |
| `canCopy` | :110 | `undefined` | 按钮隐藏 → 安全 |
| `canRequestCancel` / `canForceCancel` | :123/:124/:125 | `undefined` | 隐藏 → 安全 |
| `canRemindAudit` | :119 | `undefined` | 隐藏 → 安全 |
| `isManualOrder` | :85 | `undefined` | 隐藏 → 安全 |
| `verifyStatus` | :89/:90/:91/:102 | `undefined` | 落到 `wx:else` 显示「待提交凭证」→ **手动单首帧文案错误** |
| `voucherBlockReason` | :92/:96 | `undefined` | 隐藏 → 安全 |
| `canSubmitVoucher` / `canVerify` | :133/:136 | `undefined` | 隐藏 → 安全 |

**`receive-list` —— 3 个字段未进 `data`（:8 只声明 2 个）：** `canRegenerate`(:50)、`canReprice`(:51)、`canSettle`(:52)。全部只读不改 → **隐藏即安全**；且 :57-62 的失败分支不设置它们，三个补入口**正确地保持隐藏**。

其余 6 页：**所有 wxml 引用字段均已在 `data` 中初始化，0 处缺失**。

### 3.2 js 置位了但 wxml 从未绑定的字段（死状态）

| 页面 | 字段 | js 行 | wxml | 后果 |
|---|---|---|---|---|
| purchase-list | `isLoading` | :59 / :74 / :105 | **无引用** | **全页无任何加载指示**：下拉刷新期间无 spinner（仅系统下拉动画）、首屏空白 |
| purchase-list | `isLoadingMore` | :59 / :74 / :106 | **无引用** | 上拉加载无「加载中…」「没有更多了」提示，静默追加 |
| purchase-list | `itemCount` | :128 | **无引用**（receive-list:23 同名在用） | 死字段 |
| purchase-create | `isSubmitting` | :341 / :373 / :388 / :416 | **wxml:107-108 两个按钮无 `disabled`/`loading`** | **提交过程中无视觉反馈**；配合弹窗前未置位，双击靠服务端幂等兜底 |
| receive-list | `manualCount` | :54 | **无引用** | 死字段 |
| approval-list | `statusText` | :45 | **无引用** | 死字段（列表无状态标签） |
| purchase-create | `products` / `categories` / `tomorrow` | :135 / :120 / :50 | 无引用 | 仅内部使用（filterProducts/toPayloadItems），非死代码 |

### 3.3 `data-*` 与 handler 读取名一致性

逐对核对 **全部一致，0 处错配**：
- receive-verify :34/:43/:47 `data-index`+`data-field` ↔ js:106-107 `const {index, field} = e.currentTarget.dataset` ✅
- purchase-list :13/:17/:32 `data-id` ↔ js:138/:142 `e.currentTarget.dataset.id` ✅
- approval-list :8/:23/:24 `data-id` ↔ js:65/:69/:89 ✅
- approval-detail :52 `data-index` ↔ js:51 ✅
- abnormal-list :43/:46/:49 `data-id` ↔ js:53/:83/:100 ✅
- purchase-create :14/:28/:45-48/:69-73/:122-141 `data-id`/`data-index`/`data-field`/`data-cat` ↔ js 对应 `dataset.id/index/field/cat` ✅

**`catchtap` vs `bindtap` 使用正确**：列表项整块 `bindtap` 进详情、内嵌按钮 `catchtap` 阻止冒泡（purchase-list:32、approval-list:23-24、receive-list:49-52、receive-verify:73）。**0 处绑定写错。**

### 3.4 `wx:key` 核对

**全批齐备**：purchase-create:12/26/35/62；purchase-detail:47/52/68/98；purchase-list:4/12/18；approval-list:8/17；approval-detail:42；receive-list:7/14/34；receive-verify:19/71；abnormal-list:16。

- ⚠️ **purchase-create.wxml:62 `wx:key="tempId"`，而 `tempId` 由 `Date.now()` 生成（js:248）→ 同毫秒添加两条会碰撞**。碰撞后果：服务端 `createPurchaseOrder:286` `seenProductIds[productId]` 命中 → **整单被拒「采购商品不能重复，请检查后重试」**（一条完全误导的文案，用户不知道是两个手动商品撞了时间戳）。
- ⚠️ **receive-verify.wxml:71 `wx:key="index"`** 配合 :73 的 `deletePhoto` 数组中间删元素 → 图片可能错位。低风险。

---

## 4. 云函数契约比对（33 个调用点）

**未匹配数：0 处。** 关键前置：`cloud.js:139-169` 的 `normalizePurchaseOrder` 对 items 调用 `normalizePurchaseItem`(:123-137)，已把 `product_name_snapshot / order_qty / is_manual / supplier_id / verify_*` 全量归一为 camelCase，因此前端直接取 `productNameSnapshot` / `orderQty` / `isManual` 均有效。

| # | 位置 | 函数/action | 前端读取 | 实际返回 | 判定 |
|---|---|---|---|---|---|
| 1 | create:57 | getPurchaseOrderDetail | `result.data` | 单层 `{code,data:{...order,items,receipts}}` | ✅ |
| 2 | create:104 | dataService/getCategories | `data.level1` / `data.categories` | `{code:0,data:{level1,categories}}` (ds:80) | ✅ |
| 3 | create:126 | getProducts | `result.data[]` | `{code:0,data:list}` snake_case (gp:61) | ✅ |
| 4 | create:370/385/412 | createPurchaseOrder | `data.orderId` / `data.reportWarning` | `{code:0,data:{orderId,reportGenerated,reportsGenerated[,reportWarning,idempotent]}}` (cPO:209/493) | ✅ |
| 5 | detail:23 | getPurchaseOrderDetail | `result.data.supplier_confirmations` | 原始 snake_case | ✅ |
| 6 | detail:161/230 | dataService/verifyManualOrder | `result.code` / `msg` | `{code:0,data:{message}}` | ✅ |
| 7 | detail:196 | dataService/remindAudit | `result.code` | `{code:0}` 无 data | ✅ |
| 8 | detail:260 | dataService/requestCancel | `result.code` | `{code:0}` | ✅ |
| 9 | detail:288 | dataService/cancelOrder | `result.code` | `{code:0}` | ✅ |
| 10 | detail:336/372 | createPurchaseOrder | 同 #4 | 同 #4 | ✅ |
| 11 | list:71 | getPurchaseOrders | `result.data` / `total` / `statusCounts` | `{code:0,data,total,page,pageSize,statusCounts}` (gPO:143) | ✅ **单层** |
| 12 | aplist:22 | getPurchaseOrders | 同 #11 | 同 #11 | ✅ |
| 13 | aplist:75/96 | dataService/auditOrder | `result.data.reportWarning` | `{code:0,data:{reportWarning}}` (ds:592/617) | ✅ |
| 14 | adetail:24 | getPurchaseOrderDetail | 同 #1 | 同 #1 | ✅ |
| 15 | adetail:79/104 | dataService/auditOrder | 同 #13 | 同 #13 | ✅ |
| 16 | rlist:20 | getPurchaseOrders | 同 #11 | 同 #11 | ✅ |
| 17 | rlist:26 | getReceipts | `receipt.receipt_id / receipt_status / missing_reports / photo_file_ids` | `{...receipt, items}` 原始 snake_case (gR:85) | ✅ 前端双读兼容 |
| 18 | rlist:126 | dataService/settleReceipt | `result.code` | `{code:0}` / `{code:-1,msg}` (ds:903+) | ✅ |
| 19 | rlist:148 | dataService/regenerateReceiptReports | `result.code` | 同 | ✅ |
| 20 | rlist:171 | dataService/repriceReceipt | `result.data.message` | `{code:0,data:{message,…}}` | ✅ |
| 21 | rverify:17/65 | getPurchaseOrderDetail | `detail.receipts` / `detail.orderStatus` | 同 #1 | ✅ |
| 22 | rverify:200 | createReceipt | `data.receiptId/reportsGenerated/reportWarning/hasAbnormal/abnormalTypeNames` | `{code:0,data:{…}}` | ✅ |
| 23 | ablist:16 | dataService/getAbnormalRecords | 10 字段白名单 | 10 字段 (ds:750-762) **逐字段命中** | ✅ |
| 24 | ablist:51/81/99 | start/resolve/closeAbnormal | `result.code` | `{code:0}` / `{code:-1,msg}` | ✅ |

### 4.1 前端上送但服务端忽略/覆盖（无用负载，不产生脏数据）

| 前端位置 | 上送字段 | 服务端行为 |
|---|---|---|
| receive-verify:218-219 | `priceSnapshot`（恒 0）/ `payableFlag`（恒 true） | `createReceipt:378` 无条件覆盖、`:392` 完全重算 |
| receive-verify:213/214/216/217 | `productName`/`supplierId`/`orderQty`/`unit` | `:291-300` canonicalItems 用 DB 值全量覆盖；但 `:208-215` 仍要求这四个必须上送且类型合法 → **纯浪费的失败面** |
| create:326 / list:64 / rlist:23 | `createdBy` | `createPurchaseOrder:342-344` 完全忽略，一律取会话 |
| list:64 / rlist:23（chef 分支） | `createdBy` | `getPurchaseOrders:51-55` chef 分支只用自己的 user_id，不进 query |
| list:62 / rlist:21/27 | `role` | `getPurchaseOrders:43` / `getReceipts:44` 解构后从未使用 |
| rlist:28 / aplist:24 / list:63 | `storeId` | 仅全局角色生效（gPO:60-63）；`getReceipts` 对管理员**完全忽略** |
| rlist:114 / detail:398 / list:146 | `storeId`（传参） | `receive-verify:58` 只读 `orderId`/`id` → **三条入口中该参数全是死查询参数** |

### 4.2 死返回（服务端给了、前端没用）

- `createReceipt` `priceReportsSkipped` —— receive-verify:249-252 只读 4 个字段。
- `createPurchaseOrder` `reportGenerated` / `reportsGenerated` / **`idempotent`** —— 前端不区分「新建」与「幂等命中」，统一显示「提交成功」（用户在复制草稿被幂等短路时不知情）。
- `getPurchaseOrders` `page` / `pageSize` —— purchase-list 用本地 `this.data.page`。
- `getReceipts` `total` / `page` / `pageSize` —— receive-list 固定 pageSize=5，永不知有没有第 2 页（设计内）。
- `getAbnormalRecords` 的 `purchase_order_id` / `product_id` / `receipt_id` —— **DB 里都有**（`createReceipt:532-535` 已落库），但 ds:750-762 的 10 字段投影**丢掉了全部对账外键** → 异常记录无法跳回收货单/采购单，两侧无法互跳对账。

### 4.3 前端可影响持久化结果的字段（需注明）

| 位置 | 字段 | 影响 |
|---|---|---|
| receive-verify:208 | `receiptDate`（客户端时钟） | `createReceipt:327-329` **接受客户端值**并据它判 `backfilled`、且作为价格取档依据（`:362` `effective_date <= receiptDate`）→ **客户端可篡改归档日期、"补录"标记与取价时点** |
| receive-verify:204 | `receivedBy`（可为空串） | `:243` 被会话覆盖为 `user.name \|\| user.username \|\| receivedBy` → 安全 |
| create:327 | `createdByName` | 不进 DB（`:345-347` 用会话），**但进 CSV 报表**（`cPO:422` `经办人` 字段）→ 客户端可往供应商订货报表写入伪造经办人（仅报表，`csvField` 已防公式注入） |

---

## 5. 表单校验与防重复提交

### 5.1 校验矩阵

| 项 | 位置 | 现状 |
|---|---|---|
| 采购数量小数 | create:187 `parseFloat ‖ 0`；wxml:46 `type="digit"` | ⚠️ 允许小数；服务端 `cPO:283` 只校 `>0 && <=1000000`，**不校整数** → 下单量可存 3.5 件 |
| 空值语义不一致 | create:187 空→0；create:271 空→**1** | ⚠️ 清空手动商品数量框会得到 1 并回填 |
| 数量负数 | `type="digit"` + `cPO:283 qty<=0` 拒绝 | ✅ 双向拦住 |
| 手动商品名称/单位 | create:244-246 trim 后校验 | ✅ 最严格处 |
| 手动商品名称长度 | create:247 | ⚠️ 无上限（无 `maxlength`），服务端也不校长度 |
| 采购日期交叉 | wxml:81 采购日期**无 `start`/`end`**；:87 期望到货 `start="{{today}}"` | ⚠️ 可提交「采购日期晚于到货日期」；服务端 `cPO:175` 拒绝，但报「采购日期或期望到货日期无效」，**用户看不出是哪天** |
| 审批数量 | adetail:73-77 仅 `> 0`，无上限 | ✅ 服务端 `ds:534` 兜住「不超过下单数量」 |
| 实收数量 | rverify:159-162 四维完整 | ✅（`orderQty` 由 normalize 兜底，不会是 undefined） |
| 异常说明 | rverify wxml:57-60 勾选后出现 textarea，**无强制校验** | ⚠️ `isShortage:true + remark:''` 可提交 |
| 驳回原因 | adetail:95 `if (!this.data.auditRemark)` **未 trim** | ⚠️ 纯空格通过，服务端 `ds:511` 打回 |
| 审批备注 | adetail:62 textarea **无 `maxlength`** | ⚠️ 无上限 |
| 收货总备注 | rverify:86 textarea **无 `maxlength`** | ⚠️ 无上限 |
| 手动商品备注 | create:141 input **无 `maxlength`** | ⚠️ 无上限 |
| 采购单备注 | create:97 `maxlength="200"` | ✅ |
| 核销金额 | detail:220-221 `isNaN ‖ amount<=0` | ⚠️ **无小数位上限**（`12.345` 通过）；服务端 `ds` approve 段同样只校 `>0` |
| 取消/作废原因 | detail:253-256 / :281-284 trim 后校验 | ✅ |
| 照片上限 | rverify wxml:75 `photos.length < 9` + `count: 9 - length` | ✅ 前后端一致（`cR:219` 9 张） |
| 凭证上限 | detail:143 `count: 3` vs 服务端 `ds:1559` 上限 9 | ⚠️ 不一致但无害（前端更严） |

### 5.2 防重复提交矩阵（13 个写操作实测）

| handler | 入口检查 | 置位时机 | finally 复位 | UI 锁 | 判定 |
|---|---|---|---|---|---|
| **receive-verify.submitReceipt** | ✅ :150 | **confirm 前** :188 | ✅ :229-232 | ✅ wxml:92 | **本批唯一满分** |
| approval-detail.approveRequest / rejectRequest | ✅ :67 / :94 | confirm 前 :68 / :99 | ✅ :88-89 / :109-110 | ❌ | 良好 |
| approval-list.approveRequest / rejectRequest | ✅ :69 / :90 | confirm 前 :70 / :91 | ✅ :84-85 / :101-102 | ❌ | 良好 |
| purchase-detail.submitVoucher | ✅ :140 | 入口 :141 | ✅ :177-179 | ❌ | 良好 |
| purchase-detail.remindAudit | ✅ :193 | 入口 :194 | ✅ :206-207 | ❌ | 良好 |
| purchase-detail.verifyDecide | ✅ :212 | **prompt 后** :228 | ❌ :238 | ❌ | ⚠️ prompt 期间可连点 |
| purchase-detail.requestCancel | ✅ :257 | **prompt 后** :258 | ❌ :266 | ❌ | ⚠️ 同上 |
| purchase-detail.cancelOrder | ✅ :285 | **prompt 后** :286 | ❌ :294 | ❌ | ⚠️ 同上 |
| **purchase-detail.copyToDraft** | ❌ | ❌ | ❌ | ❌ | ⚠️ **完全裸奔**，仅靠 `requestId` 服务端去重 |
| **purchase-detail.submitRequest** | ❌ | ❌ | ❌ | ❌ | ⚠️ **完全裸奔**，同上 |
| purchase-create._saveOrder | ✅ :291 | **confirm 后** :341（注释 :30-31 声称要防的窗口恰好开放） | ❌ :373/:388/:416 三处显式 | ❌ wxml:107-108 | ⚠️ 注释与实现矛盾 |
| receive-list.settle / regenerate / reprice | ✅ :123/:145/:168 | confirm 后 :124/:146/:169 | ❌ :131/:153/:176 | ❌ | ⚠️ 网络窗口受保护，复位不在 finally |
| **abnormal-list.handle / resolve / close** | ❌ | ❌ | ❌ | ❌ | ⚠️ **三处全裸奔** + 全程无 loading |

**云端幂等兜底覆盖**：createPurchaseOrder 有 `request_id` 查重（cPO:184-200、事务内 :366-376）✅；auditOrder 事务内复查（ds:540-550）✅；settleReceipt 有并发锁 + `_S` 后缀查重 ✅；verifyManualOrder 条件更新 CAS（ds:1585-1598、:1632-1636、:1664-1668）✅；start/resolve/closeAbnormal 靠状态机 ✅。**唯一「前端无防抖 + 云端无幂等」的组合：`createReceipt`**（cR:331 `receiptId` 仅时间戳+随机，无 `request_id` 概念）—— 但 `receive-verify` 恰是本批防抖满分的页面，实际风险由前端承担住。

### 5.3 loading 配对（9 处未配对）

| 位置 | showLoading | hideLoading |
|---|---|---|
| detail:21 | :21 | :26（**之后** :117 才 `getFileUrls` → loading 已消失、凭证图稍后出现） |
| detail:152 | :152 | :167 / catch :175（成功路径不在 finally） |
| detail:229 / :259 / :287 | 同 | :237 / :265 / :293（**均不在 finally**） |
| create:342 | :342 | :372 / :387 / :411 三处显式（`toPayloadItems`/`buildPayload` 抛错则永久遮罩） |
| rlist:98 / :125 / :147 / :170 | util/wx 混用 | :100 / :130 / :152 / :175（**均不在 finally**） |
| **receive-verify:195 / :235** | :195 / :235 | finally :230 / :243 ✅ **唯一配对规范** |
| **abnormal-list 全部** | **无** | — ⚠️ 4 个异步写操作**全程无 loading**，网络慢时用户无反馈 |

**API 混用**：`receive-list:98/100/125/130/147/152/170/175` 混用 `util.showLoading`（mask:true）与 `wx.hideLoading`（mask 默认 false）——功能等价但两套 API 交错，读代码时难判断配对。

---

## 6. 权限与前端/云端错位

**服务端常量（`dataService:8-11`）**：`GLOBAL_ROLES = ['super_admin','purchaser']`、`MANAGEMENT_ROLES`（同值冗余）、`VOUCHER_SUBMIT_ROLES = ['super_admin','purchaser','store_manager']`。

| 页面 | 前端准入 | 服务端 | 错位 |
|---|---|---|---|
| purchase-create | **零门禁** | `cPO:145-147` 白名单含 chef/store_manager/super_admin/purchaser，**不含 supplier** | ⚠️ supplier 可进建单页、可填完整表单、提交必 403。前端藏入口与云端白名单无一致性检查 |
| purchase-list | **零门禁**（FAB wxml:45 无门槛） | 同上 | ⚠️ 同上 |
| purchase-list 列表 | `canReceiveRole = role !== 'chef'`(:118) | `gPO:64-65` supplier 返 -403 | ⚠️ **supplier 进入后永久停在「加载失败，请下拉重试」**，对一个本不该在此的角色给出误导提示，且下拉永远失败 |
| approval-list / approval-detail | `{super_admin, purchaser}` 白名单(:14 / :17) | `ds:492-493` MANAGEMENT_ROLES | ✅ 逐字一致 |
| **审批自审** | **前端无「不能审自己的单」判断** | `ds:504-507` 禁止自单自审 | 🔴 **前端显示「通过/驳回」，云端必拒**「不能审核自己下的单，请由其他管理员审核」。管理员看到自己下的单，点按钮才失败 |
| receive-list | **无门禁** | `ds:903/1100/1170` GLOBAL_ROLES | ✅ `canSettle/canReprice/canRegenerate`(:84-87) 已对齐 |
| receive-verify | 仅拦 chef（排除法 :53） | `cR:173` `{store_manager, super_admin, purchaser}` | ✅ 逐字等价（chef/supplier 均被拦） |
| **abnormal-list** | **无门禁** | `ds:730-732` chef 返 `[]`；`ds:735` 非全局角色 `query.store_id = default_store_id` | ⚠️ **chef 静默空列表** → 显示「暂无异常记录」，与真实无异常不可区分。**supplier 是读侧越权面**：无 `default_store_id` → `query.store_id = undefined` → query 可能退化为全量，含 supplierName/storeName/resolution（写侧被 :767/:783/:835 白名单兜住，**只有读侧漏**）【待核实 SDK 对 undefined 的处理】 |
| purchase-detail.canCopy | status='rejected'，**无角色校验**(:79) | `cPO:145-147` 白名单 | ⚠️ chef/supplier 对任意驳回单都能复制出新草稿，与 :73-77 canEdit 的严格限制明显不对称 |
| purchase-detail.canCancel / canRequestCancel | `{purchaser, super_admin}` | `ds:1343+` GLOBAL_ROLES | ✅ 一致（前端比 `requestCancel` 更严，不走死路） |
| purchase-detail.canSubmitVoucher / canVerify | 见 §2.2 | `ds:1552` 按 action 分两段 | ✅ 逐字一致 |
| purchase-detail.canRemindAudit | **排除** purchaser/super_admin(:88) | `ds:remindAudit` 允许 | ⚠️ 前端过度收紧（语义说得通：管理员不必催自己） |
| purchase-detail.canReceive 对 supplier | `role !== 'chef'` → **supplier 为真** | `cR:173` 不含 supplier | ⚠️ supplier 深链进入详情页会看到「去收货」按钮，点击必 403（列表侧已被 -403 挡住，仅深链可达） |
| **门店切换** | 前端照用 `currentStore.storeId`（create:321 / list:63 / rlist:16） | `cPO:213` 非全局角色 `storeId !== default_store_id` → -403；`gPO:51-63` 非全局角色强制 `default_store_id` | ⚠️ **详见 §7-3**：因 `authService:getStores` 对 STORE_ROLES 只返回本门店，chef/store_manager **实际无法切换到其他门店**，原判定大幅高估。残留仅 currentStore 被清空时的建单页报错 |

**结构性根源**：角色清单在前端 8+ 处、云端 5 处独立硬编码，无单一来源。本批确认主要漂移形态是**「前端排除法（`role !== 'chef'`）vs 云端白名单」**——任何新增角色（如 supplier）默认获得收货/建单/详情入口。

---

## 7. 与旧报告（R7 / full-scan-02）的不一致处

**8 处判断有误或代码已变化，其中 3 处属旧报告的实质误判。**

### 7-1 🔴 旧报告 N1「17 个 dataService 调用点会话过期静默」—— **判断有误，该缺陷不存在**

旧报告称 `dataService:45-52` 的 `requireUser` 返回嵌套 `{ error: { code: -401 } }`，而 `cloud.js:68` 只判顶层 `result.code === -401`，因此 17 个 dataService 调用点全部静默。

**实测**：`requireUser` 的返回形状确实是嵌套的，但 `dataService` 内**全部 25 个调用点**统一写成：

```js
const auth = await requireUser(event[, roles])
if (auth.error) return auth.error      // 返回的是「内层」对象
```

`auth.error` = `{ code: -401, msg: '登录已过期，请重新登录' }`，作为 `exports.main` 的返回值即是**顶层** `code: -401`，`cloud.js:68` 正常命中 `handleSessionExpired`。**分发器（ds:1641-1681）也没有做任何二次包裹。** 旧报告漏看了 `return auth.error` 这一层解包。

**残留风险（真实但不同）**：`cloud.js:68` 只处理 `-401`，**不处理 `-403`**。会话有效但越权时（如 supplier 进 dataService 写操作），前端只显示 toast、不跳登录——这是期望行为，不算缺陷。

### 7-2 ✅ 旧报告 N9「createPurchaseOrder:454 ReferenceError 使报表告警永久失效」—— **已修复**

`markOrderReportsMissing` 已提升为**模块级函数**（`cPO:78-105`，接收 `orderNo`/`storeId` 参数），`persistedOrderNo`/`persistedStoreId` 提升到**函数级**（`cPO:139-141`），catch 内调用在 `:503`。注释（`:75-77`、`:139-141`）明确记录了这个缺陷与修复方式。旧报告的判定已失效。

### 7-3 🔴 旧报告 N2「门店切换对 chef/store_manager 是纯装饰 + 建单必 403」—— **大幅高估**

旧报告的核心论据是 `createPurchaseOrder:160-164`（现 `:213`）与 `getPurchaseOrders:52-66` 对非全局角色强制 `default_store_id`，因此切换门店会被打回 403。服务端逻辑确实如此，**但 chef/store_manager 根本无法切换到其他门店**：

```js
// authService:getStores
if (STORE_ROLES.includes(user.role)) {
  if (!user.default_store_id) return { code: -1, msg: '账号未关联有效门店…' }
  query.store_id = user.default_store_id     // ← 只返回本门店
}
```

`store-switch.js:26-29` 直接用该结果渲染列表 → chef/store_manager 只有一个可选门店。而超管/采购员（非 STORE_ROLES）拿到全量门店，切换后被 `cPO:247-252` 完整支持。

**真实残留（新问题）**：`currentStore` 会在多处被清空为 `null`（`app.js:78/:80`、`index.js:144`、`account.js:64`、`supplier-home.js:123`）。此时 `purchase-create:315-318` 的 `if (!store.storeId && !store.id)` 会挡住建单并提示「当前未选择门店」——**而服务端本可从 `default_store_id` 自行推导门店**。前端比服务端更严 → chef 的 currentStore 被清空后建单页变成死胡同（可通过 store-switch 恢复，但流程反直觉）。

### 7-4 ✅ 旧报告 §7.1#1「createReceipt 状态白名单含 `to_receive`」—— **代码已变化**

现为 `['approved','report_generated','partial_received']`（`cR:239` 事务外、`:417` 事务内），**不含 `to_receive`**，与前端三处硬编码（`purchase-list:123`、`purchase-detail:71`、`receive-list:46`）**完全逐字一致**。前后端口径现已对齐。

### 7-5 🟡 旧报告 N10「createReceipt 无幂等键 → batch_no 重号」—— **部分修复**

批次号已移入事务内按已提交收货单数生成（`cR:466-468` `txBatchNo = txHistoryReceiptRes.data.length + 1`），终态判定 `txIsFinalBatch` 也移入事务内重算（`:451-456`），超收校验在事务内用 `txHistoryQty` 复查（`:426-447`）—— **batch_no 重号与 is_final 覆盖两个后果已消除**。但 `receiptId`（`:331`）仍只有时间戳+随机，`receipt` 表无幂等字段，并发双击仍可能插入两张收货单（各收一部分）。风险从「重号+终态覆盖」降为「多一张收货单」。

### 7-6 ✅ 旧报告「receive-verify `orderQty === undefined` 时上限静默失效」—— **担忧不成立**

`receive-verify:89` 的 `orderQty: item.orderQty` 取自 `cloud.normalizePurchaseOrder → normalizePurchaseItem`，后者 `cloud.js:133` 写 `orderQty: item.orderQty !== undefined ? item.orderQty : item.order_qty` → **不会是 undefined**。旧报告此处担忧不成立。

### 7-7 🟡 旧报告 N25「`createdBy` 三处把显示名当 ID 下推」—— **夸大**

`authService:publicUser`（`:49-58`）返回 camelCase `userId: user.user_id || user._id`，而三处兜底链的第一步就是 `user.userId`（`purchase-list:64`、`receive-list:23`、`purchase-create:326`）→ **第一步即命中真 ID**，`user.name` 分支实际不会走到。三处仍是死参数，但「显示名写进 ID 字段」的表述不成立。

### 7-8 ✅ 旧报告 §2.4「approval-list 字段重映射是 `5268379` 的修复点」—— **实为冗余**

`getPurchaseOrders:137-141` 确实返回原始 snake_case items，但 `cloud.normalizePurchaseOrder`（`cloud.js:167`）会对 items 逐条调用 `normalizePurchaseItem`（`:128` `productNameSnapshot`、`:133` `orderQty`）→ 归一化已在 `approval-list:35` 完成。`:47-51` 的 `productName: item.productNameSnapshot` / `requestedQty: item.orderQty` 是**冗余重映射**（把已归一的字段再赋一次同名值），不是修复。同理 `:53` `isManual: o.isManual` 也冗余（`cloud.js:156` 已归一）。**功能正确，但旧报告把冗余代码记成了缺陷修复。**

### 7-9 🟡 旧报告 N18「purchase-detail canEdit 用 defaultStoreId 而非当前门店」—— **表述可商榷，非缺陷**

`defaultStoreId` 与店长可操作门店的范围完全等价（`getStores` 对店长只返回本门店），且 store_manager 只能操作默认门店是既定口径，`:76` 的选择自洽。

---

## 8. 问题清单

### 高

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| 高 | `abnormal-list.js:78-79` | `paymentDecision = payConfirmed ? 'pay_received' : 'reject'`，而 `util.showConfirm` 在 `wx.showModal` fail 时 resolve(false) → **弹窗调用失败被当成业务裁决「维持不可付款」并提交，同时把异常标记为 resolved**（`ds:782-809` 成功写入） | 网络抖动导致弹窗 API 失败；或用户中途反悔取消，得到的却是一条已提交的「不可付款」裁决 + 成功 toast「已标记为已解决」 |
| 高 | `receive-verify.js:23-25` | 补偿逻辑 `const receipt = receipts[0]` 假定首元素即本次提交的收货单；判定条件是 `receipts.length > 0` | **分批收货后该订单已有历史收货单时，一次真实失败的提交会被判成成功**：用户看到「验收完成」并被引导去报表中心，实际本批未落库 |
| 高 | `createReceipt:417` + `dataService:766-779/782-829/834-837` | `receipt_abnormal` 不在可收货白名单（`:417`），而 `:411` 注释声称「允许继续补收」；三个异常动作只改 `abnormal_record`，**从不回写 `purchase_order.order_status`** | 最后一批带异常收货把订单打成 `receipt_abnormal` 后：**不能再收货（服务端拦）、异常流程也不回退状态** → 订单永久卡在「收货异常」，异常全部关闭后状态毫无变化 |
| 高 | `approval-list.js` / `approval-detail.js`（全文件） | 无「不能审自己的单」前端判断，而 `ds:504-507` 已禁止自单自审 | 管理员看到自己下的单，按钮可点，点击后被告知「不能审核自己下的单」；列表内批量通过时逐单失败 |
| 高 | `purchase-create.js:103-123` | `loadReferenceData` 在 `getCategories` 失败时 `toast + return`，**而 `loadProducts` 就在同一函数尾部（:122）** → 商品永不加载 | 分类接口一次失败 → 页面显示「暂无商品」，用户无法建单，**无重试按钮、无 loadFailed 态**，只能退出重进 |

### 中

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| 中 | `receive-verify.wxml:57-60` + `createReceipt:459-463` | 勾选异常后 `remark` 无强制校验；服务端在非最终批**静默清除用户的 `isShortage`** 并重算 `hasAbnormal` | 分批收货中（还有行没收齐）勾选「少货」并填写说明 → **勾选被丢弃、不生成异常记录、响应 `hasAbnormal=false`**，用户看到「验收完成」，remark 只落在 receipt_item 上无入口可见 |
| 中 | `approval-list.js:22-27` + `:36` | `pageSize:100`（服务端硬上限 `gPO:45`）+ 无 `orderStatus` 下推 + 客户端 filter | 门店内非 submitted 单超过 100 条时，submitted 单可能根本不在首 100 条里 → **待审核单静默丢失** |
| 中 | `receive-list.js:20-25` | `getPurchaseOrders pageSize:100` 无翻页 + `getReceipts pageSize:5` 无翻页 | 待收货单超过 100 条时截断；收货记录只显示最近 5 条 |
| 中 | `abnormal-list.js:16-18` + `ds:736-740` | 不传 `status`（服务端 `:736` 支持）+ `.limit(100)` 硬编码 + 客户端 filter | 异常记录超过 100 条时静默丢失；每次筛选都先拉 100 条再本地过筛 |
| 中 | `getProducts:53` / `dataService:60` | `.limit(200)` / `.limit(100)` 硬截断，无分页；`purchase-create:126` 一次拉全量 | 在售商品 > 200 时**排尾商品在建单页永远选不到**，截断不报错、不提示 |
| 中 | `abnormal-list.js:60-69` | `wx.showModal({editable:true, success})` **无 `fail` 回调** → Promise 永挂起 | 弹窗调用失败时 handler 静默停在 :72，**无 toast、无 loading、无按钮复位**（对照 `util.showPrompt` 有 `fail(){resolve(null)}`——本页面绕过了工具函数自写了个更脆的版本） |
| 中 | `approval-detail.js:13` / `receive-verify.js:48` | 仅 onLoad 加载，**无 onShow 刷新、无下拉刷新** | 管理员在 A 单审批后返回再看 B 单详情是旧状态；收货人验收页切后台（拍照/接电话）回来，订单可能已被他人部分收货或作废而不重拉 → 用旧状态提交 |
| 中 | `approval-detail.js:95` | `if (!this.data.auditRemark)` **未 trim** | 用户输入纯空格 → 前端放行 → 服务端 `ds:511` 以「驳回时必须填写原因」拒绝，前端无任何提示 |
| 中 | `approval-detail.wxml:17` + `:58-68` | 硬编码 `<view class="tag tag-warning">待审核</view>` 与操作卡**均无状态判断** | 管理员手动/深链进入已审批、已驳回、已作废单 → 仍显示「待审核」+ 可点的通过/驳回按钮（服务端 `ds:508` 拒绝，前端藏按钮与服务端拦之间无一致性） |
| 中 | `receive-verify.wxml:7` | 硬编码 `<view class="tag tag-warning">待验收</view>` 无状态判断 | 部分收货（partial_received）的订单进验收页仍显示「待验收」 |
| 中 | `purchase-create.js:299-302` | `_qtyMap` 里的 pid 在 `this.data.products` 中 `find` 不到时**静默丢弃**（`getProducts` 只返回在架商品） | 保存草稿 → 该商品在别处被停用 → 回来编辑提交 → **该行静默消失**，用户看到「提交成功」但少了一行 |
| 中 | `purchase-create.js:248` + `wxml:62` | `tempId: 'MANUAL_' + Date.now()` + `wx:key="tempId"` | 同毫秒添加两条手动商品 → key 碰撞；且服务端 `cPO:286` 查重命中 → **整单被拒「采购商品不能重复，请检查后重试」**（完全误导的文案） |
| 中 | `receive-list.js:52` + `ds:settleReceipt` | 补结算按钮只判 `hasAbnormal && canSettle`，而服务端要求「异常记录全部 resolved/closed」 | 异常仍在 pending/processing 时按钮可见，**点击必失败**「尚有未处理完成的异常，无法补结算」；且 `settleReceipt` 成功后**不刷新列表**（对照 regenerate/reprice 有 `await this.onShow()`） |
| 中 | `purchase-create.js:315-318` | 要求 `currentStore.storeId` 非空，而服务端可从 `default_store_id` 自行推导 | `currentStore` 被其他页面清空为 null 后，chef 建单页提示「当前未选择门店」成为死胡同 |
| 中 | `abnormal-list.js`（全文件） | 无 `loadFailed` 态、无角色门禁 | `getAbnormalRecords` 失败 → 只显示「暂无异常记录」，与真实无异常不可区分；chef 收到 `{code:0,data:[]}` 同样是假空态 |
| 中 | `purchase-detail.js:79` | `canCopy = order.orderStatus === 'rejected'`，**无角色校验** | chef/supplier 对任意驳回单都能复制出新草稿，与 :73-77 canEdit 的严格限制明显不对称 |
| 中 | `purchase-detail.js:10` / `:16-18` | onLoad 只 `showToast`，不置 loadFailed、不 return 阻断 | 空 orderId 仍发请求，页面以空 `detail` 渲染（状态卡无背景、无状态文字、商品清单「商品清单 ()」） |
| 中 | `purchase-create.js:167` | 搜索限定在 `p.categoryL1 === activeL1` 内 | 搜索当前一级分类下不存在的商品 → 显示「暂无商品」，用户以为商品库里没有 |
| 中 | `receive-verify.js:199→:200` | 照片先上传后提交，失败无回滚 | `uploadReceiptPhotos` 成功而 `createReceipt` 失败 → **已上传照片成孤儿文件**，无清理 |

### 低

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| 低 | `detail:238/266/294` + `rlist:131/153/176` | `_submitting` 复位不在 `finally` | 请求窗口内抛错 → 锁永久为 true → 按钮静默失效（`callFunction` 内部吞异常降低了概率） |
| 低 | 9 处 `showLoading` 未配对 | `detail:21/152/229/259/287`、`create:342`、`rlist:98/125/147/170` | 抛错路径上遮罩永久停留 |
| 低 | `rlist:98/100/125/130/147/152/170/175` | `util.showLoading`（mask:true）与 `wx.hideLoading`（mask 默认 false）混用 | 读代码时难判断配对关系 |
| 低 | `purchase-list:59/74/105-106` + `wxml` | `isLoading`/`isLoadingMore` 是纯死字段，wxml 无引用 | **全页无任何加载指示**：下拉刷新期间无 spinner、上拉加载无「没有更多了」 |
| 低 | `create:341/373/388/416` + `wxml:107-108` | `isSubmitting` 被置位但两个按钮无 `disabled`/`loading` | 提交过程中无视觉反馈；用户只会觉得「按钮点了没反应」 |
| 低 | `detail:8` + `wxml:3/10/46/85/89-92/96/102/110/119/123-125/133/136` | 10 个 wxml 引用字段未进 `data` 初值 | 非 chef 用户首帧走 chef 平铺分支后跳变分组（视觉闪烁）；`status-bg-` 空类名 → 状态卡首帧无背景色、状态文字空白；手动单首帧显示「待提交凭证」 |
| 低 | `detail:100` + `wxml` | `¥{{detail.verifyAmount}}` + `wx:if` 真值判断；`verifyAmount` 可能为 `''` | **无 `toFixed(2)`**（`¥123.5` 直出）；**0 元无法展示**（falsy 隐藏）。本批 8 页 0 处 `toFixed`、0 处千分位 |
| 低 | `abnormal-list:55` | `if (result.code !== 0) return …` 缺 `!result ‖` 前缀（:87/:103 都有） | `callFunction` 实际不返回 null（`cloud.js:67` 兜底），风险低但不一致 |
| 低 | `abnormal-list:42` + `wxss:39-42` | `statusColorMap` 在页面内重复定义而非复用 `meta.getStatusInfo`；**`.type-dot-missing_price` 缺失**、`.type-dot-delay` 是死样式（`ABNORMAL_TYPE_NAMES` ds:715-721 只有 shortage/quality/wrong_item/missing_price） | 缺价异常在列表里**落回灰色 `#BFBFBF`，没有视觉区分**；两处状态字典后续必然漂移 |
| 低 | `abnormal-list:50/80/98` | 三处 `const app = getApp()` 声明后从未使用 | 死代码 |
| 低 | `detail:117` | `loadData` 先 `hideLoading`(:26) 再 `getFileUrls`(:117) | loading 已消失、凭证图稍后才出现，用户无反馈 |
| 低 | `create:326/327` | `createdByName` 客户端可控并进 CSV 报表（`cPO:422` 经办人字段）；`createdBy`/`role`/`storeId` 三处死参数 | 客户端可往供应商订货报表写入伪造经办人（仅报表，不进 DB，`csvField` 已防公式注入） |
| 低 | `create:187` / `:271` | 数量空值语义不一致（空→0 vs 空→1）；全链路无整数约束（`type="digit"` 允许小数，`cPO:283` 不校整数） | 清空手动商品数量框得到 1 并回填；下单量可存 3.5 件 |
| 低 | `create.wxml:81` | 采购日期 picker 无 `start`/`end` | 可提交「采购日期晚于到货日期」，服务端 `cPO:175` 拒绝但报「采购日期或期望到货日期无效」，用户看不出是哪天 |
| 低 | `adetail:73-77` | 审批数量仅校下限，无上限 | 输入超量 → 服务端拒绝「审批数量必须大于 0 且不超过下单数量」，前端无提示 |
| 低 | `detail:220-221` | 核销金额无小数位上限 | 输入 `12.345` 可通过，服务端同样只校 `>0` |
| 低 | `adetail:62` / `rverify:86` / `create:141` | 三处 textarea/input **无 `maxlength`**（`create:97` 有 200） | 超长文本无限制 |
| 低 | `rverify.wxml:71` | `wx:key="index"` 配合 `deletePhoto` 中间删元素 | 照片删除后可能错位（低风险） |
| 低 | `rverify:8-11` | 补偿正则 `/已完成收货\|不可收货\|连接失败\|Not connected/i` 把**业务拒绝**也纳入补偿触发 | 依赖 `detail.orderStatus`/`receipts.length` 二次判据收敛，配合上表「高」级问题共同放大 |
| 低 | `receive-verify.js:53` | 门禁用排除法 `role === 'chef'` 而非白名单 | 未来新增角色默认获得验收入口 |
| 低 | 死样式 | `purchase-detail.wxss:29-34` `.status-reason`、`:111-114` `.qty-approved`；`purchase-list.wxss:69-76` `.reject-reason`；`receive-list.wxss:33-35` `.delivery-info`、`:37-39` `.order-amount` | 迁移残留，无引用 |
| 低 | `rlist:54` / `plist:128` / `aplist:45` | `manualCount` / `itemCount` / `statusText` 三个死字段 | 计算了但 wxml 未引用 |
| 低 | `getAbnormalRecords` 投影（`ds:750-762`） | 10 字段白名单**丢掉 `receipt_id`/`purchase_order_id`/`product_id`**（DB 里都有，`cR:532-535` 已落库） | 异常记录无法跳回对应收货单/采购单，两侧无法互跳对账 |
| 低 | `rlist:114` vs `plist:146` vs `detail:398` | `goVerify` 三条入口：一条不带 `storeId`、两条带；`receive-verify:58` 从不读该参数 | 死查询参数，不一致但无害 |
| 低 | `verifyManualOrder` approve 段（`ds` :1657-1661） | 核销通过时 `verify_note: ''` 覆盖 | 门店提交凭证时写的备注在核销通过后被清空 |

---

## 9. 遗留【待核实】

1. **wx-server-sdk 对 `where` 中 `undefined` 值的处理** —— 决定 abnormal-list 的 supplier 读侧越权是否成立（`ds:735` `query.store_id = auth.user.default_store_id`，supplier 无该字段）。若是「忽略该字段」则 query 退化为 `{}` → 全量异常记录，含 supplierName/storeName/resolution/description。写侧被 `ds:767/783/835` 的 `{store_manager,purchaser,super_admin}` 白名单兜住，**只有读侧漏**。
2. **`supplier_product_price` 的 `(supplier_id, product_id, effective_date)` 唯一性** —— `createReceipt:365-373` 按组合取最新档，同日多行时优先 `is_current`；多条同时命中且都非 current 时结果取决于查询顺序。属 price-manage 边界。
3. **异常「关闭」与主单据状态的最终口径** —— `purchase_order.order_status='receipt_abnormal'` 是否应当由某个动作回退，当前**三个异常动作与 settleReceipt 都不回写**，属业务流程决策而非纯代码缺陷。

---

## 附：本批横向一致性小结

| 维度 | 本批现状 |
|---|---|
| 唯一「满分」写操作 | `receive-verify.submitReceipt`（置位早 + finally + UI 锁） |
| 唯一完整分页页 | `purchase-list`（服务端游标 + statusCounts + loadFailed） |
| 权限表达最完整 | `purchase-detail`（10 flag，与云端逐字一致），但 canCopy 破例 |
| 完全无门禁 | `receive-list`、`abnormal-list`（后者叠加云端读侧漏）、`purchase-create`/`purchase-list` FAB |
| 完全无防抖 | `abnormal-list`（3 写操作）、`purchase-detail.copyToDraft`/`submitRequest` |
| 完全无 loading | `abnormal-list`（4 个异步写操作） |
| 契约不匹配 | **0 处致命**（`normalizePurchaseItem` 已全量归一）；1 处误导（客户端 `receiptDate` 影响归档日期与取价）；7 处无用负载；3 处死查询参数 |
| 双层包裹问题 | **0 处**（5 个非 dataService 函数全单层 `data`；dataService 的 -401 经 `return auth.error` 解包后也是顶层） |
| 导航闭环 | 10 个目标全部在 `app.json` 注册、参数名逐对一致、tab 页正确用 switchTab（`rverify:266`） |
| 最大风险 | abnormal-list 的弹窗失败=业务裁决 + receive-verify 分批收货假成功 + receipt_abnormal 状态死锁 + 自审前端不同步 |
| 与旧报告分歧 | **8 处**：N1 判断有误（-401 实际正常）、N9 已修复、N2 大幅高估、createReceipt 白名单已收窄对齐、N10 部分修复、orderQty 担忧不成立、createdBy 表述夸大、approval-list 重映射实为冗余 |
