# R7 重扫：采购 / 审批 / 收货 / 异常 前端 8 页（2026-10-04）

> **范围**：`pages/{purchase-create,purchase-detail,purchase-list,approval-list,approval-detail,receive-list,receive-verify,abnormal-list}` × 4 文件 = 32 文件全读。
> **交叉参照（只读）**：`utils/{cloud,util,auth-guard,meta}.js`、`app.json`、云函数 `createPurchaseOrder`/`getPurchaseOrders`/`getPurchaseOrderDetail`/`getReceipts`/`createReceipt`/`getProducts`/`dataService`（1559 行）。
> **方法**：只信代码不信注释。结论带 `文件:行号`。拿不准标【待核实】。全程未修改任何业务文件，唯一写操作是本报告。
> **前置文档**：`batch2-purchase-flow.md`（390 行，主前置）、`full-scan-02-cloud-purchase-receipt.md`（217 行）、`full-scan-06-pages-report.md`（279 行，取异常视角）、`controller-horizontal-scan-20261003.md`（236 行，横向实测）。
> **版本基线**：HEAD = `5268379`。工作区未提交改动仅 `pages/report-list/report-list.js`（4 处 `?.` → `&&` 显式判断，不在本批边界内）与 `project.config.json`。
> **页面改动历史**：`5268379` fix(pages) → `0c535ba` style(ui) → `cab6d8a` style(icons) → `151d39f` feat(approval): remindAudit #12-3 → `a83f605` feat(auth): 禁止自审 → `f237064` fix(security): savePrice 守卫 + 限管理员取消 → `d48b17c` fix(security): 并发/幂等 → `9350b9d` fix(security): 中低风险。
> **`5268379` 触及本批 6 个文件**（`+229/-88` 全局）：`approval-detail(js+12,wxml+9)`、`approval-list(js+11,wxml+6)`、`purchase-detail(js+5)`、`purchase-list(js+16,wxml+6)`、`receive-list(js+4,wxml+2)`。**未触及 `purchase-create`、`receive-verify`、`abnormal-list`、`purchase-detail.wxml`** —— 这四处的旧缺陷按原样存活。

---

## 0. 增量摘要

1. **P0（本批最高价值）：17 个 `dataService` 调用点的会话过期全部静默**。`dataService:45-52` 的 `requireUser` 返回**嵌套** `{ error: { code: -401 } }`，而 `utils/cloud.js:68` 只判 `result.code === -401`（顶层）。本批 8 页共 **33 个 callFunction 点，其中 17 个走 dataService**（见 §3）——会话过期时这 17 个都不跳登录，只弹通用错误，用户无限重试。主控 H10 已判 F1 未修，本批确认其**最大受害面就是这 8 页**。
2. **`purchase-detail.js:153` `that.loadData()` 已修复** → 现为 `this.loadData()`（`5268379` diff 铁证）。batch2 头号结论**已失效**。
3. **`approval-list` 商品列空白问题已修复**：`5268379` 在 `approval-list.js:47-50` 加了 `productName: item.productNameSnapshot` / `requestedQty: item.orderQty` 显式重映射。batch2 §2.4 结论**已失效**。
4. **新发现：门店切换对门店角色是"顶栏变了、数据没变 + 下单必 403"**。`createPurchaseOrder:160-164` 与 `getPurchaseOrders:52-66` 对非全局角色强制 `default_store_id`。`purchase-create.js:324` 把切换后的 `currentStore.storeId` 下推 → chef/store_manager 一旦切过店，**提交必 403「无权为其他门店创建采购订单」，前端无任何预告**。这是主控 H17 在我这批页面里的直接落点。
5. **新发现：`abnormal-list` 三个写操作零防抖 + `resolveAbnormal` 把"取消"当业务裁决**。`abnormal-list.js:47/71/95` 全页无 `_submitting`；`:79` `paymentDecision = payConfirmed ? 'pay_received' : 'reject'` —— 而 `util.showConfirm` 在 `wx.showModal` **fail 时 resolve(false)**（`util.js:91-94`），所以"弹窗调用失败"会被静默当成"维持不可付款"并提交。
6. **服务端对前端"写库值"的零信任程度比 batch2 估计的好得多**：`createReceipt:350-351` 恒覆盖 `priceSnapshot`、`:361-368` 恒重算 `payableFlag`；`createPurchaseOrder:291-296` 完全忽略客户端 `createdBy`。→ batch2 的 🔴 #2（前端硬编码价格入库）**降级**：不产生脏数据，只是无用负载。
7. **契约不匹配实测 9 处**（§3），其中**致命 0 处**、**误导 3 处**、**无用负载 6 处**。`getPurchaseOrders`/`getPurchaseOrderDetail`/`getReceipts`/`createReceipt`/`createPurchaseOrder` 全部是单层 `data`，**未发现 F1/H10 型双层包裹**。
8. **导航闭环完全闭合**：10 个不同跳转目标全部在 `app.json` 注册，**参数名逐对核对全部一致**（§4）。全批 0 处 `?.`。
9. **batch2 的 10 个【待核实】标记（9 个独立问题）全部回收，0 个遗留**（§7）。
10. **`5268379` 修复彻底度**：5 项声明全部落地且未引入回归；但它**只加了 loadFailed 三件套，没动防抖/finally/按钮 UI 锁**，所以"抛错后按钮永久失效"这一类缺陷在本批仍存 8 处（§6）。

---

## 1. 文件清单与全读确认

| 页面 | js | wxml | wxss | json | 合计 |
|---|---|---|---|---|---|
| purchase-create | 432 | 147 | 164 | 2 | 745 |
| purchase-detail | 385 | 137 | 152 | 2 | 676 |
| purchase-list | 154 | 46 | 122 | 3 | 325 |
| approval-list | 105 | 36 | 70 | 3 | 214 |
| approval-detail | 113 | 70 | 80 | 2 | 265 |
| receive-list | 185 | 57 | 44 | 3 | 289 |
| receive-verify | 269 | 90 | 145 | 2 | 506 |
| abnormal-list | 110 | 57 | 73 | 3 | 243 |
| **合计** | **1753** | **635** | **870** | **20** | **3278** |

全读确认：**32/32**。交叉参照另读 9 个文件（4 个 utils + `app.json` + 6 个云函数 index.js），另通读 4 份前置文档。

`json` 侧要点：`purchase-list`/`approval-list`/`receive-list` 有 `enablePullDownRefresh`；`purchase-create`/`purchase-detail`/`approval-detail`/`receive-verify`/`abnormal-list` **均未开**。→ `abnormal-list` 无下拉刷新，仅靠 `onShow` 重拉（可接受，因它是唯一入口页形态）；`purchase-detail` 无下拉刷新但有 `onShow` 重拉，行为合理。

---

## 2. 逐页解剖（8 节）

### 2.1 `purchase-create`（js 432 行）— 采购建单，本批最复杂

- **`data`（js:9-31）**：`categoryL1List / activeL1:'kitchen' / filteredCategories / activeCategoryId:1 / products / displayProducts / searchKey / manualItems / showManualPopup / manualForm{name,categoryL1,unit,qty,remark} / orderDate / deliveryDate / remark / today / tomorrow / totalCount / isSubmitting`。
- **`this` 会话态（不进 setData）**：`editingOrderId`(:36)、`manualOrderId`(:37)、`catalogOrderId`(:38)、`catalogOrderSubmitted`(:41)、`catalogSeq`(:42)、`requestId`(:44)、`_qtyMap`(:93)。
- **onLoad 链（:34-53）** → `loadReferenceData()`(:51) → `loadCategories` + `loadProducts` → `filterProducts()`；`editingOrderId` 存在则 `loadExistingOrder()`(:52)。
- **callFunction（6 处）**：
  | 位置 | 函数 | 入参 | 期望返回 |
  |---|---|---|---|
  | :58 | getPurchaseOrderDetail | `{orderId}` | `data:{...order,items}` |
  | :106 | dataService/getCategories | `{}` | `data:{level1:[],categories:[]}` |
  | :129 | getProducts | `{includeInactive:false}` | `data:[product]` |
  | :372/:387/:409 | createPurchaseOrder | `buildPayload(items, orderId, suffix)` | `data:{orderId,reportGenerated,reportsGenerated,reportWarning?}` |
- **事件处理器**：`switchL1`(:143)、`selectCategory`(:155)、`onSearchInput`(:160)、`onProductQtyInput`(:188)、`increaseProductQty`(:198)、`decreaseProductQty`(:208)、`showManualForm`(:226)、`hideManualForm`(:236)、`onManualInput`(:239)、`setManualCategory`(:242)、`confirmManual`(:245)、`increaseManualQty`(:262)、`decreaseManualQty`(:266)、`onManualQtyInput`(:272)、`removeManualItem`(:276)、`onOrderDateChange`(:284)、`onDeliveryDateChange`(:285)、`onRemarkInput`(:286)、`saveDraft`(:289)、`submitRequest`(:291)、`_saveOrder`(:293)、`preventBubble`(:237 空函数)。
- **跳转**：`:69` navigateBack（非草稿编辑被拒）、`:426` navigateBack（提交成功）。
- **拆单模型**：档案单 `:c`/`:c2…`，手动单 `:m`；`orderId` 复用草稿号，`requestId` 仅整单成功才重置(:416)。

### 2.2 `purchase-detail`（js 385 行）— 详情 + 9 个权限 flag

- **`data`（:8）**：`detail:{items:[]}` + `canReceive/canEdit/canCancel` + `voucherImages:[]`。
  ⚠️ **`supplierGroups / canCopy / canRequestCancel / canForceCancel / canRemindAudit / isManualOrder / verifyStatus / canSubmitVoucher / canVerify` 均未在 `data` 初始化**，首次渲染前 wxml `wx:if="{{supplierGroups}}"`(:46) 为假 → **非 chef 用户首帧渲染 chef 平铺分支，然后跳变成分组布局（视觉闪烁）**。`detail` 也无 `statusType` → `status-bg-` 空类名。
- **9 个 flag（:71-98，本批权限表达最完整处）**：
  | flag | 行 | 条件 |
  |---|---|---|
  | canReceive | :71 | `role !== 'chef'` && status ∈ {approved, report_generated, partial_received, to_receive} |
  | canEdit | :73-77 | status='draft' && (super_admin/purchaser \|\| `createdById === userId` \|\| store_manager && `storeId === currentUser.defaultStoreId`) |
  | canCopy | :79 | status='rejected' —— **完全无角色校验** |
  | canCancel | :81 | status='submitted' && {purchaser, super_admin} |
  | cancelEligible | :83 | `{approved, report_generated}`（`5268379` 删掉了 partial_received/to_receive，与服务端对齐） |
  | canRequestCancel | :85 | cancelEligible && {purchaser, super_admin} && `!order.cancelRequested` |
  | canForceCancel | :86 | cancelEligible && role='super_admin' |
  | canRemindAudit | :88 | status='submitted' && **非**{purchaser, super_admin} |
  | canSubmitVoucher / canVerify | :93-98 | isManual && {store_manager,purchaser,super_admin} && status='received' && verifyStatus ∈ {none,rejected} / isManual && verifyStatus='pending' && {purchaser,super_admin} |
- **callFunction（8 处）**：:23 getPurchaseOrderDetail；:145 dataService/verifyManualOrder(submit)；:180 dataService/remindAudit；:214 dataService/verifyManualOrder(approve\|reject)；:244 dataService/requestCancel；:272 dataService/cancelOrder；:320/:356 createPurchaseOrder（copyToDraft / submitRequest）。
- **幂等**：`_genRequestId(kind)`(:289-296) 按 kind 缓存，用于 copy/submit 两条路径。
- **跳转**：:300 editRequest → purchase-create?id=；:334 copyToDraft 成功 → purchase-create?orderId=；:373 submitRequest 成功 → navigateBack；:381-383 goReceive → receive-verify?orderId=&storeId=。

### 2.3 `purchase-list`（js 154 行）— 服务端分页，本批数据流最规范

- **`data`（:11-20）**：`activeFilter:'all' / filterTabs:[] / filteredList:[] / orders:[] / isLoading / isLoadingMore / loadFailed / hasMore:true / page:1`。`PAGE_SIZE=20`(:8)。
- **`onLoad`(:23-29)**：只读 `options.status`，**不校验合法值**。
- **`onShow`(:31-39)**：读 `app.globalData.pendingListFilter` 并清空 → `reload()`。**这是 `5268379` 修的 switchTab 传参问题**（`index.js:164` 写入）。
- **callFunction（1 处）**：:71 getPurchaseOrders，入参 `{role, storeId, createdBy, page, pageSize, orderStatus?}`。
- **失败态（:72-78）**：`loadFailed: page === 1` + toast；成功后 `:78` 复位。wxml:36-43 有"加载失败，请下拉重试"专属空态。**这是 `5268379` 新增**。
- **tab（:86-99）**：8 个 + `isGlobal` 时加"待核销"。计数全部取 `result.statusCounts`，**键名与云函数 `getPurchaseOrders:96-106` 逐字一致**（all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable）✓。
- **`renderList`(:116-134)**：`canReceiveRole = role !== 'chef'`(:118)；`canReceive`(:123)；`manualCount`(:121) 被 wxml:28 使用（**非死字段**）。
- **跳转**：:138 goDetail → purchase-detail?id=；:145-148 goReceive → receive-verify?orderId=&storeId=；:152 goCreate → purchase-create。

### 2.4 `approval-list`（js 105 行）— 审批列表

- **`data`（:8）**：`{ list: [], loadFailed: false }`。
- **门禁（:13-18）**：`!['super_admin','purchaser'].includes(me)` → toast + `setTimeout(navigateBack, 800)`。**仅前端**，URL 可直接构造进入。
- **callFunction（3 处）**：:22 getPurchaseOrders（`pageSize:100`、**无 `page`、无 `orderStatus`**）；:79/:104 dataService/auditOrder（approve/reject）。
- **客户端过滤（:36）**：`.filter(o => o.orderStatus === 'submitted' || o.orderStatus === 'pending_approval')`。
- **items 重映射（:47-51）**：`productName: item.productNameSnapshot`、`requestedQty: item.orderQty` —— **`5268379` 的修复点**，wxml:17 因此两列有值。
- **驳回理由写死**：:98 `auditRemark: '审核驳回'`，未用 `util.showPrompt`（`util.js:101-116` 可用）。
- **跳转**：:16 门禁失败 navigateBack；:65 goDetail → approval-detail?id=。

### 2.5 `approval-detail`（js 113 行）— 审批详情

- **`data`（:7-11）**：`{ detail: {}, auditRemark: '', loadFailed: false }`。
- **门禁（:16-21）**：与 approval-list 同口径。
- **`:22` `this.orderId = options.id || options.orderId || ''`** —— 双名兼容但**无空值防御**；:24 空 id 仍会请求。服务端 `getPurchaseOrderDetail:44-45` 返回 `{code:-1,msg:'订单信息缺失'}` → `loadFailed:true` → wxml:4-8 显示失败态 + 重试按钮（:57-60 retryLoad 调 `this.onLoad({...})`）。**行为可接受，但 retryLoad 用同一个空 id 重试，必然再次失败** —— 死循环按钮。
- **callFunction（3 处）**：:24 getPurchaseOrderDetail；:79 dataService/auditOrder(approved, items 全量)；:104 dataService/auditOrder(rejected, items 空)。
- **数量校验（:73-77）**：`find(item => !(Number(item.approveQty) > 0))` → 仅下限校验，**无上限**。
- **`:38-45` items 映射**：`productName/productNameSnapshot`、`spec: categorySnapshot`、`unit: unitSnapshot`、`requestedQty: orderQty`、`approveQty: orderQty`。
- **按钮防抖（:67-68、:94-99）**：入口检查 + **置位在 confirm 之前** + try/finally（:88-89、:109-110）—— **本批最规范**。
- **wxml:17 硬编码 `<view class="tag tag-warning">待审核</view>`，无 `wx:if`**；wxml:59-68 操作卡同样无状态条件。**已批准/已驳回单手动进本页仍显示"待审核"且按钮可点**（服务端 `auditOrder:499` 会拒绝，前端"藏按钮"与"服务端拦"之间无一致性检查）。
- **仅 `onLoad` 加载，无 `onShow` 刷新、无下拉刷新**。

### 2.6 `receive-list`（js 185 行）— 待收货 + 收货记录 + 3 个补操作

- **`data`（:8）**：`{ orders: [], receipts: [] }`。**无 `loadFailed`、无 `canRegenerate/canReprice/canSettle` 初始化**。
- **门禁（:11）**：仅 `requireLogin()` —— **无任何角色判断**（chef/supplier 均可进入）。
- **并发双请求（:18-37）**：`Promise.all([getPurchaseOrders(pageSize:100), getReceipts(page:1,pageSize:5)])` 外层 try/catch —— **本批唯一用 try/catch 包 Promise.all 的页面**。
- **callFunction（5 处）**：:20 getPurchaseOrders；:26 getReceipts；:126 dataService/settleReceipt；:148 dataService/regenerateReceiptReports；:171 dataService/repriceReceipt。
- **`role` 兜底（:15）**：`user.role || 'store_manager'` —— **与 `purchase-list.js:62` 的 `|| 'purchaser'` 不一致**，同一云函数两个默认角色假设。
- **`createdBy`（:23）**：`role === 'chef' ? (user.userId || user.id || user.name || '') : ''` —— 把显示名当 ID 下推（**服务端对 chef 完全忽略此参数**，见 §3，故实为无害死参数）。
- **补操作权限（:84-87）**：`canRegenerate/canReprice/canSettle` 三者同值 `{purchaser, super_admin}`。**`canSettle` 是 `5268379` 新增**（注释明确写"后端同为 GLOBAL_ROLES 校验"）。
- **`hasMissingPrice`（:76-78）**：`!it.isManual && !it.is_manual && (it.supplierId || it.supplier_id) && Number(it.priceSnapshot ?? it.price_snapshot || 0) <= 0` —— **`<= 0` 把合法的 0 价（赠品）也判为"缺价待补"**；且无供应商的行永不被判缺价。
- **失败分支（:57-62）**：收货记录失败时保留旧 orders + toast，**不渲染假空态** —— 本批异常处理最周到。但 `canRegenerate/canReprice/canSettle` 不在此分支设置 → 三者 undefined → 三个补入口全部隐藏。
- **三个补操作防抖（:123-124/:145-146/:168-169）**：`if (this._submitting) return` 在 **confirm 之后**、`this._submitting = true` 紧跟，`:131/:153/:176` 复位 —— **均在 confirm 与请求之间，网络窗口被保护，但复位不在 `finally`**。
- **跳转**：:114 goVerify → `receive-verify?orderId=`（**只传 orderId，与 purchase-detail/purchase-list 的 `&storeId=` 不一致**；但 receive-verify 从不读 `options.storeId`，故三处入口参数集不同却都工作 —— 见 §4）。

### 2.7 `receive-verify`（js 269 行）— 收货验收

- **`data`（:40-46）**：`{ order: {}, items: [], photos: [], overallRemark: '', isSubmitting: false }`。
- **门禁（:50-57）**：**只拦 chef**（排除法）。参数 `options.orderId || options.id`(:58) + **空值防御**(:59-62) —— **本批唯一对空参数显式防御的入口页**。
- **callFunction（3 处）**：:17 getPurchaseOrderDetail（`recoverCommittedReceipt` 补偿内）；:65 getPurchaseOrderDetail（主加载）；:193 createReceipt。
- **items 初始化（:79-94）**：`receivedQty:0 / priceSnapshot:0 / payableFlag:true / isShortage:false / isQualityIssue:false / isWrongItem:false / remark:''`。
- **数量校验（:152-155）**：类型 + 有限性 + `< 0` + `> item.orderQty` 四维完整。**边界缺口**：`orderQty` 为 `undefined` 时 `> undefined` 恒 false → 上限静默失效。
- **防抖（:181-186）**：`this.setData({ isSubmitting: true })` **位于 confirm 之前**（:181，注释明写"避免弹窗期间双击并发提交"）；:183-186 取消时复位；:222-225 `finally` 里 `hideLoading` + `isSubmitting:false` —— **本批唯一同时满足"置位在弹窗前 + finally 复位 + UI 锁"的写操作**（wxml:88 `loading="{{isSubmitting}}" disabled="{{isSubmitting}}"`）。
- **提交后补偿（:6-37 `recoverCommittedReceipt`）**：`errorType === 'CLOUD_UNAVAILABLE'` 或 `/已完成收货|不可收货|连接失败|Not connected/i.test(msg)` → 重查详情 → `orderStatus === 'received'` 或 `receipts.length > 0` 则合成 `code:0`。**语义风险**：正则把"不可收货"这类**业务拒绝**也纳入补偿触发；`receipts[0]`(:23) 假定首元素即本次单，分批/多次收货下可能取错。
- **照片先上传后提交（:192→:193）**：`uploadReceiptPhotos` 成功而 `createReceipt` 失败 → **已上传照片成孤儿文件**，无回滚。
- **wxml:7 硬编码 `<view class="tag tag-warning">待验收</view>` 无状态判断**（与 approval-detail 同型）。
- **异常勾选不强制填写说明**：wxml:53-57 的 textarea 仅在勾选时出现，但 `_saveOrder` 无对应校验 → `isShortage:true + remark:''` 可提交，异常记录 `description` 只有默认文案。

### 2.8 `abnormal-list`（js 110 行）— 异常跟进

- **`data`（:7-11）**：`{ activeFilter:'all', filteredList:[], records:[] }`。
- **callFunction（4 处）**：:16 dataService/getAbnormalRecords（**payload 空对象**）；:51 startAbnormal；:81 resolveAbnormal；:99 closeAbnormal。
- **时间（:25）**：`cloud.formatDateTime(item.createdAt)`；其余原样透传。
- **本地筛选（:36-45）**：`activeFilter !== 'all'` 时客户端 filter；`statusColorMap`(:42) **在页面内重复定义**而非复用 `meta.getStatusInfo`（`meta.js:14-17` 取值完全一致）→ 双处漂移隐患。
- **状态机三动作**：pending→"开始处理"(wxml:42)；processing→"填写处理结果"(wxml:45)；resolved→"关闭异常"(wxml:48)。
- **付款裁决（:77-79）**：
  ```js
  const payConfirmed = await util.showConfirm('该异常行是否按实收数量转回可付款？...\n「取消」则维持不可付款')
  const paymentDecision = payConfirmed ? 'pay_received' : 'reject'
  ```
- **`promptResolution`（:60-69）**：`wx.showModal({editable:true, success: ...})` **无 `fail` 回调** → 弹窗失败时 Promise 永挂起，handler 静默停止（无 toast、无 loading）。
- **`:55` 不一致**：`if (result.code !== 0) return ...` **缺 `!result ||` 前缀**，而 :87/:103 都有。

---

## 3. 前后端契约比对表（callFunction 全集，33 处）

| # | 页面:行 | 云函数 / action | 前端解构路径 | 云函数实际返回 | 判定 |
|---|---|---|---|---|---|
| 1 | purchase-create:58 | getPurchaseOrderDetail | `result.data` → `normalizePurchaseOrder` | `{code:0,data:{...order,created_by_name,items,receipts,reports}}`（cf:115-124） | ✅ |
| 2 | purchase-create:106 | dataService/getCategories | `data.level1`、`data.categories` | `{code:0,data:{level1,categories}}`（ds:80） | ✅ |
| 3 | purchase-create:129 | getProducts | `result.data[]` → `normalizeProduct` | `{code:0,data:list}`（gp:61），snake_case | ✅ |
| 4 | purchase-create:372/387/409 | createPurchaseOrder | `data.orderId`、`data.reportWarning` | `{code:0,data:{orderId,reportGenerated,reportsGenerated[,reportWarning,idempotent]}}`（cPO:427/158/345/465） | ✅ |
| 5 | purchase-detail:23 | getPurchaseOrderDetail | `result.data.supplier_confirmations` | 原始 snake（cPO detail cf:118 `...order`） | ✅ |
| 6 | purchase-detail:145/214 | dataService/verifyManualOrder | `result.code`、`result.msg` | `{code:0,data:{message}}`（ds:1491/1507/1525） | ✅ |
| 7 | purchase-detail:180 | dataService/remindAudit | `result.code` | `{code:0}`（ds:1431）无 data | ✅ |
| 8 | purchase-detail:244 | dataService/requestCancel | `result.code` | `{code:0}`（ds:1379） | ✅ |
| 9 | purchase-detail:272 | dataService/cancelOrder | `result.code` | `{code:0}`（ds:1329） | ✅ |
| 10 | purchase-detail:320/356 | createPurchaseOrder | 同 #4 | 同 #4 | ✅ |
| 11 | purchase-list:71 | getPurchaseOrders | `result.data/total/statusCounts` | `{code:0,data,total,page,pageSize,statusCounts}`（gPO:143） | ✅ **单层，无包裹** |
| 12 | approval-list:22 | getPurchaseOrders | 同 #11 | 同 #11 | ✅ |
| 13 | approval-list:79/104 | dataService/auditOrder | `result.data.reportWarning` | `{code:0,data:{reportWarning}}`（ds:596） | ✅ |
| 14 | approval-detail:24 | getPurchaseOrderDetail | 同 #1 | 同 #1 | ✅ |
| 15 | approval-detail:79/104 | dataService/auditOrder | 同 #13 | 同 #13 | ✅ |
| 16 | receive-list:20 | getPurchaseOrders | 同 #11 | 同 #11 | ✅ |
| 17 | receive-list:26 | getReceipts | `result.data[].receipt_id/receipt_date/...` | `{code:0,data:[{...receipt,items}],total,page,pageSize}`（gR:87）snake_case | ✅ **双读兼容** |
| 18 | receive-list:126 | dataService/settleReceipt | `result.code` | `{code:0}` / `{code:-1,msg}`（ds:886/894/926） | ✅ |
| 19 | receive-list:148 | dataService/regenerateReceiptReports | `result.code` | 同 | ✅ |
| 20 | receive-list:171 | dataService/repriceReceipt | `result.data.message` | `{code:0,data:{message,repriced,stillMissing}}`（ds:1096-1102） | ✅ |
| 21 | receive-verify:17/65 | getPurchaseOrderDetail | `detail.receipts`、`detail.orderStatus` | 同 #1 | ✅ |
| 22 | receive-verify:193 | createReceipt | `data.receiptId/reportsGenerated/reportWarning/hasAbnormal/abnormalTypeNames` | `{code:0,data:{receiptId,reportsGenerated,reportWarning,hasAbnormal,abnormalTypeNames,priceReportsSkipped}}`（cR:728-738） | ✅ 5/6 命中，`priceReportsSkipped` 前端未用（死返回） |
| 23 | abnormal-list:16 | dataService/getAbnormalRecords | `data[].id/type/typeName/description/supplierName/storeName/status/statusName/createdAt/resolution` | 10 字段白名单（ds:718-730）**逐字段全命中** | ✅ |
| 24 | abnormal-list:51/81/99 | start/resolve/closeAbnormal | `result.code` | `{code:0}` / `{code:-1,msg}`（ds:747/799/823） | ✅ |

**未匹配数：0 处前端取到 `undefined` 导致字段缺失**（唯一例外见下）。

### 3.1 前端上送但服务端忽略/覆盖 —— 6 处（无用负载，非损坏）

| 前端位置 | 上送字段 | 服务端行为 | 后果 |
|---|---|---|---|
| receive-verify:211 | `priceSnapshot`（恒 `0`） | `createReceipt:350-351` **无条件覆盖**为 `supplier_product_price` 现取值 | 无损坏。batch2 🔴#2 降级 |
| receive-verify:212 | `payableFlag`（恒 `true`） | `createReceipt:361-368` 恒重算（手动行 false；档案行 `!hardAbnormal && priceSnapshot>0`） | 无损坏 |
| receive-verify:206/207/209/210 | `productName`/`supplierId`/`orderQty`/`unit` | `createReceipt:280-292` canonicalItems 用 DB 值全量覆盖 | 无损坏，但 :197-201 要求这四个必须上送且类型合法 → **纯浪费的失败面** |
| purchase-create:329 / receive-list:23 / purchase-list:64 | `createdBy`（兜底到显示名） | `createPurchaseOrder:291-296` **完全忽略**，一律取会话 `user.user_id \|\| user._id` | 无损坏。batch2 的"名字写进 purchase_order 表"担忧**不成立** |
| purchase-list:64 / receive-list:23（chef 分支） | `createdBy` | `getPurchaseOrders:51-55` chef 分支**只用自己的 user_id**，event.createdBy 不进入 query | 死参数，无害 |
| receive-list:20/26 | `role` | `getPurchaseOrders:43` / `getReceipts:44` 解构后**从未使用**，一律按会话角色 | 死参数，无害 |

### 3.2 前端上送且服务端接受但语义需注明 —— 3 处（误导）

1. **receive-verify:201 `receiptDate`**（客户端时钟）→ `createReceipt:311-318` **接受客户端值**（`isReceiptDate` 校验格式后直接用），并据它判 `backfilled`。→ **客户端可篡改归档日期与"补录"标记**。
2. **receive-verify:197 `receivedBy`**（`user.name \|\| user.username`，可为空串）→ `createReceipt:232` **被会话覆盖**为 `user.name \|\| user.username \|\| receivedBy`，安全。
3. **receive-verify:195-196 `storeId/storeName`** → `createReceipt:176-180/190/231` 全部覆盖，安全。前端 :172-175 的空值守卫因此是**多余的防御**（但无害）。

### 3.3 云函数返回但前端未消费（死返回）

- `createReceipt:736` `priceReportsSkipped` —— receive-verify 未读（:242-245 只读 4 个字段）。
- `createPurchaseOrder:427` `reportGenerated` / `reportsGenerated` —— purchase-create 未读（只读 `orderId` 与 `reportWarning`）。
- `getPurchaseOrders:143` `page`/`pageSize` —— purchase-list 未回读（用本地 `this.data.page`）。
- `getReceipts:87` `page`/`pageSize`/`total` —— receive-list 未读，因此**永不知道还有没有第 2 页**（pageSize 固定 5，无分页 UI，设计内）。
- `createPurchaseOrder:158` `idempotent:true` —— 前端未区分"新建"与"幂等命中"，弹窗文案统一显示"提交成功"。

### 3.4 **无 F1/H10 型双层包裹**

`getPurchaseOrders`/`getPurchaseOrderDetail`/`getReceipts`/`createReceipt`/`createPurchaseOrder` 五个函数**全部单层 `data`**，本批 16 个非 dataService 调用点不存在"取到 undefined"的包裹问题。**本批的契约风险不在包裹结构，而在 §3.1 的无用负载与 §5 的鉴权返回形状**。

---

## 4. 导航闭环核对表

`app.json` 注册 26 页，本批 8 页全在注册表（:7-14）。tabBar 4 项：index / **purchase-list** / **report-list** / message。

| # | 出处 | 方式 | 目标 | 已注册 | 传参 | 目标 onLoad 读参 | 参数名一致 |
|---|---|---|---|---|---|---|---|
| 1 | purchase-detail:300 | navigateTo | purchase-create | ✅ | `?orderId=` | purchase-create:36 `options.orderId \|\| options.id` | ✅ |
| 2 | purchase-detail:334 | navigateTo | purchase-create | ✅ | `?orderId=` | 同上 | ✅ |
| 3 | purchase-detail:381-383 | navigateTo | receive-verify | ✅ | `?orderId=&storeId=` | receive-verify:58 `options.orderId \|\| options.id` | ✅（storeId 未被读） |
| 4 | purchase-list:138 | navigateTo | purchase-detail | ✅ | `?id=` | purchase-detail:12 `options.id \|\| options.orderId` | ✅ |
| 5 | purchase-list:145-148 | navigateTo | receive-verify | ✅ | `?orderId=&storeId=` | 同 #3 | ✅ |
| 6 | purchase-list:152 | navigateTo | purchase-create | ✅ | 无 | purchase-create:36 空串兜底 | ✅ |
| 7 | approval-list:65 | navigateTo | approval-detail | ✅ | `?id=` | approval-detail:22 `options.id \|\| options.orderId` | ✅ |
| 8 | receive-list:114 | navigateTo | receive-verify | ✅ | `?orderId=`（**无 storeId**） | 同 #3 | ✅ |
| 9 | receive-verify:259 | **switchTab** | report-list | ✅（tab 页） | 无 | — | ✅ **正确用 switchTab** |
| 10 | receive-verify:261 | navigateBack | — | — | — | — | ✅ |

**入站（index 侧）**：`index.js:161` navigateTo abnormal-list（无参）；`index.js:164-165` 写 `pendingListFilter` + switchTab purchase-list；`index.js:170` navigateTo purchase-detail?id=；approval-list / receive-list 经 `index.wxml` 的 `data-url` + dataset（主控 H19 已确认）。**全部闭合。**

**结论：导航闭环完全闭合。10 个目标全部注册、全部参数名逐对一致、tab 页正确用 switchTab、无 `navigateTo` 指向 tab 页的非法跳转。**

**唯一瑕疵**：`&storeId=` 在 #3/#5 上送、在 #8 缺失，而 `receive-verify` **从不读 `options.storeId`**（:58 只读 id）→ 该参数在三条入口里都是**死查询参数**。不一致但无害；建议要么三条都删，要么 receive-verify 真正读它。

**`?.` 检查**：本批 8 页 0 处可选链、0 处 `??`（与主控 H1 全项目清零结论一致）。

---

## 5. 角色守卫与前端/云端错位

服务端常量（`dataService:8-11`）：`GLOBAL_ROLES = ['super_admin','purchaser']`、`MANAGEMENT_ROLES = ['super_admin','purchaser']`（同值冗余）、`VOUCHER_SUBMIT_ROLES = ['super_admin','purchaser','store_manager']`。

| 页面 | 前端准入 | 服务端 | 错位 |
|---|---|---|---|
| purchase-list | `canReceiveRole = role !== 'chef'`（排除法，:118） | getPurchaseOrders 对 supplier 返 -403 | ⚠️ **supplier 进入后永久停在"加载失败"**：`getPurchaseOrders:64-66` 返 -403，`purchase-list:74` 置 `loadFailed:true`，页面显示"加载失败，请下拉重试" —— 对一个本不该在此的角色给出误导提示，且下拉永远失败 |
| purchase-list FAB | **无任何角色门槛**（wxml:45） | createPurchaseOrder:101 白名单含 chef/store_manager/super_admin/purchaser，**不含 supplier** | ⚠️ **supplier 可进建单页、可填完整表单、提交必 403**。前端"藏入口"与云端白名单之间无一致性检查 |
| approval-list / approval-detail | `['super_admin','purchaser']` 白名单 | auditOrder:483 `MANAGEMENT_ROLES` | ✅ 逐字一致 |
| **approval（自审）** | **前端无"不能审自己的单"判断** | `auditOrder:493-498` 禁止自单自审（`a83f605` 新增） | 🔴 **前端显示"通过/驳回"按钮，云端必拒**："不能审核自己下的单，请由其他管理员审核"。管理员看到自己下的单，点按钮才失败。这是 `5268379` 之外的**新功能未同步到前端**的缺口 |
| receive-list | **无门禁** | settleReceipt/repriceReceipt/regenerateReceiptReports 均 `GLOBAL_ROLES` | ✅ **已修**：`canSettle`(:87) 是 `5268379` 新增，注释明确对齐 |
| receive-verify | 仅拦 chef（排除法，:53） | createReceipt:164 `['store_manager','super_admin','purchaser']` | ✅ 逐字等价（chef/supplier 均被拦） |
| abnormal-list | **无门禁** | getAbnormalRecords `requireUser(event)` **无角色限制**；start/resolve/close 限 `{store_manager,purchaser,super_admin}` | ⚠️ **chef 静默空列表**（ds:700 返 `[]`）→ 看到"暂无异常记录"，与真实无异常不可区分。**supplier 则是权限边界漏洞**：ds:703 `query.store_id = auth.user.default_store_id`，supplier 无 `default_store_id` → `store_id: undefined` → **query 退化为全量**（【待核实】wx-server-sdk 对 `undefined` 值的处理），supplier 可能读到跨门店异常记录的 supplierName/storeName/resolution。写操作侧有角色白名单兜住，读侧没有 |
| purchase-detail canCopy | status='rejected'，**无角色校验**（:79） | createPurchaseOrder:101 白名单 | ⚠️ chef/supplier 对任意驳回单都能复制出新草稿；与 `canEdit` 的严格限制明显不对称 |
| purchase-detail canCancel / canRequestCancel | `{purchaser,super_admin}` | cancelOrder:1280 / requestCancel:1336 均 `GLOBAL_ROLES` | ✅ 一致 |
| purchase-detail canSubmitVoucher / canVerify | 见 §2.2 | verifyManualOrder:1441 按 action 分两段 | ✅ 逐字一致 |
| purchase-detail canRemindAudit | 排除 purchaser/super_admin | remindAudit:1384 **允许** purchaser/super_admin | ⚠️ 前端**过度收紧**（管理员本人不能给自己催审，语义上说得通，但属前端严于云端） |
| **purchase-create / receive-list / purchase-list 的 `storeId` 下推** | 用切换后的 `currentStore` | createPurchaseOrder:160-164、getPurchaseOrders:52-66 对非全局角色**强制 `default_store_id`** | 🔴 **门店切换对 chef/store_manager 是纯装饰 + 一个坑**：顶栏显示新门店、列表数据仍是旧门店；一旦切过店再建单，`createPurchaseOrder:162` 直接 -403「无权为其他门店创建采购订单」，前端**无任何预告**。这是本批最影响真实用户行为的错位 |

**结构性根源**：主控 H13 已指出角色清单在前端 11 处、云端 5 处独立硬编码，无单一来源。本批确认该判断成立，并补出**"前端排除法 vs 云端白名单"是主要漂移形态**：`role !== 'chef'` 这种写法让任何新增角色（如 supplier）**默认获得**收货/建单入口。

---

## 6. loading / 防重 / 分页 三件套体检

### 6.1 防抖矩阵（HEAD 实测，取代 batch2 §9.1）

| handler | 入口检查 | 置位时机 | finally 复位 | UI 锁 | 判定 |
|---|---|---|---|---|---|
| receive-verify.submitReceipt | ✅ :143 | **confirm 前** :181 | ✅ :222-225 | ✅ wxml:88 loading+disabled | **本批唯一满分** |
| approval-detail.approve/reject | ✅ :67/:94 | confirm 前 :68/:99 | ✅ :88/:109 | ❌ | 良好 |
| purchase-detail.submitVoucher | ✅ :124 | 入口 :125 | ✅ :161-162 | ❌ | 良好 |
| purchase-detail.remindAudit | ✅ :177 | 入口 :178 | ✅ :189-190 | ❌ | 良好 |
| purchase-detail.verifyDecide | ✅ :196 | **prompt 后** :212 | ❌ :222 | ❌ | ⚠️ prompt 期间可连点 |
| purchase-detail.requestCancel | ✅ :241 | prompt 后 :242 | ❌ :250 | ❌ | ⚠️ 同上 |
| purchase-detail.cancelOrder | ✅ :269 | prompt 后 :270 | ❌ :278 | ❌ | ⚠️ 同上 |
| **purchase-detail.copyToDraft** | ❌ | ❌ | ❌ | ❌ | ⚠️ **完全无防抖**，仅靠 `requestId` 服务端去重 |
| receive-list.settle/regenerate/reprice | ✅ :123/:145/:168 | confirm 后 :124/:146/:169 | ❌ :131/:153/:176 | ❌ | ⚠️ 网络窗口受保护，但复位不在 finally |
| **abnormal-list.handle/resolve/close** | ❌ | ❌ | ❌ | ❌ | ⚠️ **三处全裸**（服务端状态机 :743/:763/:813 兜住幂等，双击仅产生多一次失败 toast） |
| purchase-create._saveOrder | ✅ :294 | **confirm 后** :343（注释 :30-31 声称要防的窗口恰好开放） | ❌ :375/:390/:413 三处显式复位 | ❌ wxml:107-108 无 disabled | ⚠️ **注释与实现矛盾**；靠 `requestId` 幂等兜底 |
| approval-list.approve/reject | ✅ :69/:90 | confirm 前 :70/:91 | ✅ :84/:101 | ❌ | 良好 |
| purchase-list / receive-list 读操作 | — | — | — | ❌ isLoading 只控请求不控按钮 | 可接受 |

**结论：13 个写操作里只有 1 个（receive-verify）满足"置位早 + finally 复位 + UI 锁"三条。8 处存在"抛错后 `_submitting` 永久为 true → 按钮永久失效"的风险**（`callFunction` 内部吞异常降低了触发概率，但 `setData`/`wx.hideLoading` 之后到复位之间任何抛错都会命中）。**云端幂等兜底覆盖情况**：createPurchaseOrder 有 `request_id` 查重（cPO:140-150）✅；auditOrder 有事务内复查（ds:531-541）✅；settleReceipt 有 `report_id` 后缀查重（ds:889-895）✅；repriceReceipt 有 missing_price 异常关闭幂等（ds:1076-1090）✅；verifyManualOrder 有条件更新（ds:1466-1479/1498-1507/1510-1524）✅；**createReceipt 无幂等键**（H4，cf:320 `receiptId` 仅时间戳+随机）❌；start/resolve/closeAbnormal 靠状态机 ✅。→ **唯一"前端无防抖 + 云端无幂等"的组合是 `abnormal-list.resolveAbnormal`**（靠 ds:763 状态机兜住），与 `receive-verify` 之外的收货路径（H4 并发双击可重复收货、批次号重号）。

### 6.2 loading 配对

| 页面 | showLoading | hideLoading 位置 | 风险 |
|---|---|---|---|
| purchase-detail.loadData | :21 | :26（**之后** :102 才 getFileUrls） | ⚠️ loading 已消失、凭证图稍后才出现，无反馈 |
| purchase-detail.submitVoucher | :136 | :151 / catch:159 | ⚠️ 成功路径 :151 不在 finally |
| purchase-detail.verifyDecide | :213 | :221 | ⚠️ 不在 finally |
| purchase-detail.requestCancel | :243 | :249 | ⚠️ 不在 finally |
| purchase-detail.cancelOrder | :271 | :277 | ⚠️ 不在 finally |
| purchase-create._saveOrder | :344 | :374/:389/:412 三处显式 | ⚠️ `toPayloadItems`/`buildPayload` 抛错则永久遮罩 |
| approval-detail.approve/reject | 无 | — | 无遮罩，仅靠 `_submitting`（可接受） |
| receive-list.settle/regenerate/reprice | :125/:147/:170（`util.showLoading`） | :130/:152/:175（`wx.hideLoading`） | ⚠️ 不在 finally；且 `util.showLoading` / `wx.hideLoading` **混用两套 API** |
| receive-list.previewReceiptPhotos | :98（util） | :100（wx） | ⚠️ 同上混用，且不在 finally |
| receive-verify.submitReceipt | :188 / :228 | finally :223 / :236 | ✅ **唯一配对规范** |
| abnormal-list.（全部） | **无** | — | ⚠️ 4 个异步写操作**全程无 loading**，网络慢时用户无反馈 |

**未配对的 `showLoading` 共 9 处**。全批无"按钮永久 loading"事故点（按钮无 loading 属性），但"遮罩永久停留"事故点 9 处。

### 6.3 下拉刷新 / 分页

| 页面 | json 开开关 | js 实现 | 配对 |
|---|---|---|---|
| purchase-list | ✅ | onPullDownRefresh :41-43、onReachBottom :45-48、`reload` 重置 page=1/hasMore=true(:50-53) | ✅ **本批唯一完整分页** |
| approval-list | ✅ | onPullDownRefresh :59-62 → `await this.onShow()` | ⚠️ 无分页：`pageSize:100` + 客户端 filter，**>100 单静默丢单** |
| receive-list | ✅ | onPullDownRefresh :108-110 → `await this.onShow()` | ⚠️ 同上：`getPurchaseOrders pageSize:100` + `getReceipts pageSize:5` 均无翻页 |
| purchase-create / purchase-detail / approval-detail / receive-verify / abnormal-list | ❌ | 前两者用 `onShow` 重拉（purchase-detail:16-18）或 `onLoad` 单次（approval-detail、receive-verify） | ⚠️ **approval-detail 与 receive-verify 无 `onShow` 刷新、无下拉刷新**：管理员审批后返回再进看到旧数据；收货人改数量后切后台再回来也不会重拉 |

**分页游标重置**：只有 purchase-list 有游标（`page`/`hasMore`），重置时机正确（`reload` :51）。其余 7 页无游标，不存在重置问题，但 approval-list / receive-list 的 100 条截断是真问题。

### 6.4 金额展示

- **`toFixed` 出现次数：本批 8 页 0 处**。
- 唯一金额展示点：`purchase-detail.wxml:97` `¥{{detail.verifyAmount}}`（`wx:if="{{detail.verifyAmount}}"`）—— **无 `toFixed(2)`**，`¥123.5` 直出；`verifyAmount` 可能为 `''`（`cloud.js:158`），falsy 时隐藏，**0 元无法展示**。
- `purchase-create` 全页**无任何金额计算**：`_updateTotal`(:218-223) 统计的是"选了几种商品"，wxml:105 文案"共 N 种商品" —— 命名 `totalCount` 易误读为数量合计。**用户提交前无法预估采购金额**。
- 其余 6 页不展示金额。
- 无千分位。

### 6.5 表单校验

| 项 | 位置 | 现状 |
|---|---|---|
| 采购数量小数 | purchase-create:190/274 `parseFloat \|\| 0` / `\|\| 1`；wxml `type="digit"` | ⚠️ **允许小数**；服务端 cPO:231-233 只校 `>0 && <=1000000`，**也不校整数** → 下单量可存 3.5 件 |
| 空值语义不一致 | purchase-create:190 空→0；:274 空→**1** | ⚠️ 清空手动商品数量框会得到 1 并回填 |
| 数量负数 | `type="digit"` + 服务端 `cPO:232 qty<=0` 拒绝 | ✅ 双向拦住 |
| 采购日期无约束 | wxml:81 采购日期 picker **无 `start`/`end`**；:87 期望到货有 `start="{{today}}"` | ⚠️ 可提交"采购日期晚于到货日期"。**服务端 cPO:131 会拒绝**（`actualDeliveryDate < actualDate` → "采购日期或期望到货日期无效"）→ 前端 gap 有服务端兜底，但用户看到的是**不直观的报错文案** |
| 手动商品名称/单位 | purchase-create:247-249 trim 后校验 | ✅ 最严格处 |
| 审批数量 | approval-detail:73-77 仅 `> 0`，**无上限** | ✅ **服务端 auditOrder:517-529 兜住**：`qty > Number(sourceItem.order_qty)` 直接拒绝「审批数量必须大于 0 且不超过下单数量」→ batch2 §4.3 的"审批量可任意超出申请量"**后端已拦**，只是前端无提示 |
| 实收数量 | receive-verify:152-155 四维完整 | ⚠️ `orderQty === undefined` 时上限失效 |
| 异常说明 | receive-verify 勾选后不强制填写 | ⚠️ `isShortage:true + remark:''` 可提交 |
| 驳回原因 | approval-detail:95 `if (!this.data.auditRemark)` **未 trim** | ⚠️ 纯空格字符串通过；服务端 ds:502 `String(...).trim()` 会拒 → 用户输入空格被服务端以"驳回时必须填写原因"打回，前端无提示 |
| 备注长度 | wxml:96 `maxlength="200"` | ✅ |
| 核销金额 | purchase-detail:204-205 `isNaN \|\| amount <= 0` | ⚠️ **无小数位上限**（`12.345` 可通过）；服务端 ds:1509 同样只校 `> 0` |
| 取消/作废原因 | purchase-detail:237-240 / :265-268 trim 后校验 | ✅ |

### 6.6 wxml 层

- **`wx:key` 全批齐备**：purchase-create:12/26/35/62；purchase-list:4/12/18；purchase-detail:47/52/68/95；approval-list:8/17；approval-detail:42；receive-list:7/14/34；receive-verify:19/67；abnormal-list:16。
  ⚠️ `purchase-create.wxml:62` `wx:key="tempId"` 而 tempId 由 `Date.now()` 生成（js:251）→ **同毫秒添加两条会碰撞**；碰撞的具体后果是服务端 cPO:235 `seenProductIds[productId]` 命中 → **整单被拒「采购商品不能重复，请检查后重试」**（一条误导文案）。
  ⚠️ `receive-verify.wxml:67` `wx:key="index"` —— 用索引当 key，配合 :69 的删除操作（数组中间删元素）可能导致图片错位。低风险。
- **`data-` 与 handler 读取名一致性**：逐对核对全部一致。receive-verify:39/43/47 `data-index`+`data-field` ↔ js:106-107 `const {index, field} = e.currentTarget.dataset` ✅；purchase-list:32 `data-id` ↔ js:142 ✅；abnormal-list:43/46/49 `data-id` ↔ js:53/83/100 ✅。
- **绑定写错**：0 处。`catchtap` vs `bindtap` 使用正确（列表项整块 `bindtap` 进详情、内嵌按钮 `catchtap` 阻止冒泡：purchase-list:32、approval-list:23-24、receive-list:49-52）。
- **wxml 硬编码状态标签**：approval-detail:17「待审核」、receive-verify:7「待验收」—— 两处无条件渲染（见 §2.5/§2.7）。
- **`wx:if` 空值陷阱**：purchase-detail:44 `{{detail.items.length}}` —— `detail` 初值 `{items:[]}` 安全；:94 `voucherImages.length` 安全。
- **内联样式**：purchase-create:95/97/101、receive-verify:55/80 —— 与 wxss 混用，未收敛。

### 6.7 异常列表状态流转（含"关闭是否回写主单据"）

| 动作 | 前端条件 | 服务端校验 | 回写主单据 |
|---|---|---|---|
| 开始处理 | `status === 'pending'`（wxml:42） | ds:743 `status !== 'pending'` 拒绝 | 仅 `abnormal_record.status='processing'` + `handled_by`（ds:744-746）|
| 填写处理结果 | `status === 'processing'`（wxml:45） | ds:763 `status !== 'processing'` 拒绝；ds:755 resolution 必填 | 仅 `abnormal_record`：status/resolution/`payment_decision`/resolved_by（ds:768-777）+ 2 条 message |
| 关闭异常 | `status === 'resolved'`（wxml:48） | ds:813 `status !== 'resolved''` 拒绝 | 仅 `abnormal_record.status='closed'`（ds:815-821）|

**关键结论：三个动作都不回写 `purchase_order`。** `purchase_order.order_status = 'receipt_abnormal'` **永远不会被异常流程清掉**。

叠加 `createReceipt` 的 H1 死锁：cf:386 注释写「receipt_abnormal 状态允许继续补收」，但 cf:392 白名单 `['approved','report_generated','partial_received','to_receive']` **不含 `receipt_abnormal`**，事务外 cf:228 也不含 → **最后一批带任何异常的收货把订单打成 `receipt_abnormal` 后，该订单永久无法再收货，且异常流程也不回写状态**。整单永久卡在"收货异常"，只能靠人工改库。

补结算路径（`settleReceipt` ds:870-926）**只在异常全部 resolved/closed 后才允许**（ds:885-886），但补结算也只生成报表、改 `receipt_item.payable_flag`（ds:912-914），**同样不回写 `order_status`**。

---

## 7. batch2 待核实回收表 + 旧结论复核表

### 7.1 【待核实】回收（batch2 实测 10 个标记 / 9 个独立问题；任务书称 8 个，差异是 :105 与 :199 重复问 `auditOrder` 的 items 语义）

| # | batch2 位置 | 问题 | 结论 | 云端铁证 |
|---|---|---|---|---|
| 1 | :53 | 前端 `canReceive` 与云函数收货状态校验是否一致 | **一致，逐字相同** | `createReceipt:228` 与 `:392` 白名单 `['approved','report_generated','partial_received','to_receive']`；前端 purchase-list:123、purchase-detail:71、receive-list:46 三处硬编码**完全相同** |
| 2 | :99 | `getPurchaseOrders` items 形状 → approval-list 两列是否空白 | **已修复（5268379）** | 云端 `getPurchaseOrders:137-141` 返回**原始 snake_case** item；`5268379` 在 `approval-list.js:47-50` 加了 `productName: item.productNameSnapshot` / `requestedQty: item.orderQty` 显式重映射 → 两列有值 |
| 3 | :105 / :199 | `auditOrder` 对空 items 的处理；两个调用方 items 语义分叉 | **确认分叉成立，后端双兼容** | ds:517 `if (event.status==='approved' && Array.isArray(event.items))` —— 空数组进入循环体 0 次 → qtyMap 空 → ds:542-549 不改量 → **空 items = 按申请量全批**；非空则 ds:525 逐行校验 `qty > sourceItem.order_qty` 拒绝。两个前端调用方（approval-list:77/98 传 `[]`，approval-detail:81 传全量）**都被正确服务** |
| 4 | :121 | `getAbnormalRecords` 空 payload 是否按会话收敛 | **收敛** | ds:700 chef 返 `[]`；ds:703 非全局角色强制 `query.store_id = default_store_id`。**但 supplier 落入该分支时 `default_store_id` 为 undefined** → query 退化为全量（【待核实】SDK 对 undefined 的处理）→ **读侧存在越权面**，写侧被 ds:735/751/803 角色白名单兜住 |
| 5 | :204 | 已批准/驳回单点按钮是否被服务端二次校验 | **是，且事务内复查** | ds:499 `!['submitted','pending_approval']` 拒绝；ds:531-541 事务内再复查并 rollback |
| 6 | :335 | `createReceipt` 是否覆盖/忽略 `priceSnapshot`/`payableFlag` | **恒覆盖** | cR:350-351 `item.priceSnapshot = priceMap[...] \|\| 0` 无条件；cR:361-368 `payableFlag` 完全重算。**前端硬编码 0/true 是无用负载，不产生脏数据** |
| 7 | :463 | 服务端是否为空 `createdBy` 兜底 | **比兜底更彻底：完全忽略** | cPO:291-296 一律取会话 `user.user_id \|\| user._id` / `user.name \|\| user.username`；入参 `createdBy`（cPO:110）**无任何引用** |
| 8 | :506 | `getCategories` 返回的 id 类型 → `activeCategoryId: 1` 是否死值 | **数字，非死值** | ds:73 `id: item.category_id`；ds:85 `findCategory` 用 `Number(categoryId)` 查询 → **`category_id` 是 Number** → `activeCategoryId: 1` 与严格相等 `===` 兼容。batch2 的"死值"担忧**不成立**（但注意 ds:60 `limit(100)` 与 getProducts:53 `limit(200)` 的截断，见 §8 N4） |
| 9 | :579 | 服务端是否校验 `orderStatus` | **有白名单** | cPO:206-208 `!['draft','submitted'].includes(orderStatus)` → -1「采购单状态无效」 |

**9/9 回收完毕，0 遗留。**

### 7.2 旧结论复核（batch2 §10 结论列表，按 HEAD 5268379 逐条判定）

| batch2 结论 | 判定 | 证据 |
|---|---|---|
| 🔴1 `purchase-detail.js:153` `that.loadData()` | **已修复** | `5268379` diff：`-        that.loadData()` `+        this.loadData()`，现为 js:154 |
| 🔴2 `receive-verify.js:211-212` `priceSnapshot:0`/`payableFlag:true` 硬编码入库 | **降级为 🟡** | cR:350-351/:361-368 恒覆盖。不产生脏数据，只是无用负载 + 失败面 |
| 🟠3 approval-list / receive-list `pageSize:100` + 客户端过滤 | **仍成立** | approval-list:26/:36、receive-list:24/:46 未动 |
| 🟠4 receive-verify:6-37 补偿正则把业务拒绝当网络失败 | **仍成立** | :8-11 正则未动；:21/:23 判据未动 |
| 🟠5 提交防抖置位时机普遍错误 | **仍成立（未触及）** | 见 §6.1，8 处"抛错后锁死"，`5268379` 未动 purchase-create/receive-verify 之外的防抖 |
| 🟠6 `MANUAL_<ts>` 当 productId + category 粒度不一致 | **仍成立，但危害被低估了一处** | cPO:235 查重会让同毫秒双手动商品被拒「采购商品不能重复」 |
| 🟠7 `user.name` 兜底为 ID 三处 | **降级为无害** | cPO:291-296 忽略入参；gPO:51-55 忽略 event.createdBy。三处均为死参数 |
| 🟠8 approval-detail:65 审批数量无上限 | **后端已拦** | ds:525 `qty > Number(sourceItem.order_qty)` 拒绝 |
| 🟡9 照片先传后提交，失败即孤儿 | **仍成立** | cR 无回滚；前端 receive-verify:192→193 未动 |
| 🟡10 `approval-list.wxml:17` 字段名与归一化契约不符 | **已修复** | 见 §7.1 #2 |
| 🟡11 异常列表无防抖、无范围过滤 | **前半仍成立；后半已澄清** | 无防抖 ✅；范围过滤**云端已有**（ds:703），但 supplier 分支退化 |
| 🟡12 样式迁移不完整 | **仍成立** | 仅 purchase-create.wxss token 化 |
| §9.4 状态集硬编码 4 处 | **行号漂移** | 现为 purchase-list:123、purchase-detail:71、receive-list:46，共 3 处（batch2 记 4 处，`purchase-detail:83` 的 cancelEligible 已被 5268379 收窄为 `{approved, report_generated}`，不再是收货状态集） |
| §9.3 `receive-list` 无角色门禁 | **仍成立** | receive-list:11 仅 `requireLogin()` |
| §9.3 `abnormal-list` 无角色门禁 | **仍成立，且暴露云端读侧越权面** | 见 §5 |
| §2.4 `canCopy` 无角色门禁 | **仍成立** | purchase-detail:79 未动 |
| §4.5 wxml:17 无条件"待审核" | **仍成立** | approval-detail.wxml:17 未动（`5268379` 只加了 loadFailed，没加状态条件） |
| §4.1 approval-detail 空 id 无防御 | **仍成立，但后果已缓解** | js:22 未动；但 `getPurchaseOrderDetail:44-45` 返回明确错误 + loadFailed 态，不再是静默空页 |

**统计：仍成立 8 项、已修复 2 项、已澄清/降级 3 项、行号漂移 2 项、无法确认 0 项。**

### 7.3 5268379 修复效果评估

| 声明项 | 落地情况 | 彻底度 | 回归 |
|---|---|---|---|
| index/purchase-list: switchTab + 全局 pendingListFilter | ✅ index:164 写入、purchase-list:34-36 读取并清空 | 彻底（清空防止二次进入沿用旧值） | 无 |
| purchase-list 加 receivable tab | ✅ :90 + 云端 gPO:73-74/:94 支持 `receivable` 虚拟筛选 + `:105` `counts.receivable` | 彻底 | 无 |
| approval-list 字段重映射 | ✅ :47-50 | 彻底 | 无 |
| approval-list / approval-detail loadFailed 态 | ✅ approval-list:28-34 + wxml:28-35；approval-detail:27-30 + wxml:4-8 + retryLoad :57-60 | **approval-detail 的 retryLoad 用同一个空 id 重试，必然再次失败 → 死按钮**（轻微） | 无 |
| purchase-detail `that` → `this` | ✅ :154 | 彻底 | 无 |
| purchase-detail cancelEligible 对齐后端 | ✅ :83 收窄 | 彻底（现在前端比后端 ds:1348 **更严**：不放过 partial_received/to_receive） | 无 |
| receive-list canSettle | ✅ :87 + wxml:52 | 彻底 | 无 |
| purchase-list loadFailed 态 | ✅ :74/:78 + wxml:36-43 | 彻底 | 无 |

**8/8 落地，0 回归。** 但它**完全没碰**：防抖/finally（§6.1）、按钮 UI 锁（purchase-create wxml:107-108、approval-detail wxml:65-66）、角色门禁（receive-list、abnormal-list、purchase-create FAB）、自审前端提示（`a83f605` 新增的云端限制）、门店切换误伤（H17）。**这五项构成本批的剩余风险面。**

---

## 8. 新问题清单（P0 / P1 / P2）

### P0 —— 影响真实用户流程且无兜底

**N1｜17 个 dataService 调用点的会话过期被静默吞掉，不跳登录**
`dataService:45-52` `requireUser` 返回**嵌套** `{ error: { code: -401, msg } }`；`utils/cloud.js:67-70` 只判 `result.code === -401`（顶层）。全批 33 个 callFunction 点中 **17 个走 dataService**：purchase-create:106（1）、purchase-detail:145/180/214/244/272（5）、approval-list:79/104（2）、approval-detail:79/104（2）、receive-list:126/148/171（3）、abnormal-list:16/51/81/99（4）。
会话过期时这 17 个点的表现：`result.code` 为 `undefined` → `undefined !== 0` 为真 → 走错误分支 → toast `result.msg`（也是 `undefined`）→ 落到通用文案。**`handleSessionExpired` 永不触发，用户留在过期会话里反复重试。**
修复成本 6 行：3 个 helper（dataService:47/49、authService:336/337、importProducts:54/56）改为顶层返回。

**N2｜门店切换对 chef/store_manager 是"顶栏变了、数据没变"，且切过店后建单必 403**
`store-switch.js` 只写 `globalData.currentStore`（主控 H17）。而：
- `getPurchaseOrders:52-59` 对 chef/store_manager **强制** `store_id = default_store_id`，忽略前端 :63 上送的 storeId；
- `createPurchaseOrder:160-164` 对非全局角色 `storeId !== default_store_id` → **-403「无权为其他门店创建采购订单」**，`purchase-create.js:324` 上送的正是切换后的值。
用户视角："我切了门店，列表没变；再点提交，报错。" **本批 4 页（purchase-list / receive-list / purchase-create / receive-verify）都会碰到。**
最小修复：对门店角色隐藏门店切换入口；或在 purchase-create 提交前比对 `currentStore.storeId === userInfo.defaultStoreId` 并预告。

### P1 —— 功能缺陷 / 明显 UX 陷阱

**N3｜`abnormal-list.resolveAbnormal` 把"取消弹窗"当成业务裁决「维持不可付款」**
`abnormal-list.js:78-79`：
```js
const payConfirmed = await util.showConfirm('该异常行是否按实收数量转回可付款？...\n「取消」则维持不可付款')
const paymentDecision = payConfirmed ? 'pay_received' : 'reject'
```
而 `util.showConfirm`（util.js:83-96）在 `wx.showModal` **`fail` 时 `resolve(false)`** → **弹窗调用失败 = 静默提交 `paymentDecision:'reject'` 并把异常标记为 resolved**（ds:763-777 成功写入）。用户想中途反悔，得到的却是一条已提交的"不可付款"裁决记录，且 :81 的成功 toast 会告诉他"已标记为已解决"。
同型问题：`purchase-detail:203` 的 `showPrompt` 取消返回 `null`（:203-204 有 `if (input === null) return`，✅ 处理正确）—— **说明作者知道这个坑，但 `abnormal-list` 没按同样的模式处理**。

**N4｜`getProducts` `limit(200)` 硬截断 → 建单页商品库静默不全**
`getProducts:53` `.limit(200)`，无分页。`purchase-create.js:129-131` 一次拉全量。门店在售商品 > 200 时，**排尾商品在建单页永远选不到**，且 :133 的失败分支只在 `code !== 0` 时触发，**截断不报错、不提示**。叠加 `getCategories:60` 的 `limit(100)`。
对照：`getPurchaseOrders:108-114` 有完整分页 —— **同一项目里商品查询没有，这是能力不齐而非设计取舍**。

**N5｜supplier 角色可能读到跨门店异常记录（读侧越权）**
`getAbnormalRecords:700-703`：
```js
if (auth.user.role === 'chef') return { code: 0, data: [] }
if (!GLOBAL_ROLES.includes(auth.user.role)) query.store_id = auth.user.default_store_id
```
supplier 不在 `chef` 分支，也非 GLOBAL → 进入第二分支，但 supplier 无 `default_store_id` → `query.store_id = undefined`。若 wx-server-sdk 忽略 undefined 字段，则 query 退化为 `{}` → **全量异常记录**，含 `supplierName`/`storeName`/`resolution`/`description`（ds:718-730）—— 供应商可看到**其他门店**的收货差异与处理结论。
写操作侧被 ds:735/751/803 的 `['store_manager','purchaser','super_admin']` 白名单兜住，**只有读侧漏**。【待核实】wx-server-sdk 对 `undefined` where 值的实际处理。

**N6｜自审禁止（a83f605）只在云端，前端审批列表仍显示可操作按钮**
`auditOrder:493-498`：`if (order.created_by && [order.created_by, auth.user._id].includes(auditorId)) return { code:-1, msg:'不能审核自己下的单，请由其他管理员审核' }`。
`approval-list.js` 与 `approval-detail.js` **都无对应前端判断** → 采购员/超管看到自己下的单，按钮可点，点击后才被告知被拒。这是 `a83f605`（在 5268379 之前）新增能力未同步前端的典型滞后。

**N7｜`approval-detail` 与 `receive-verify` 无 `onShow` 刷新 + 无下拉刷新**
approval-detail:13 仅 `onLoad`；receive-verify:48 仅 `onLoad`。json 两者均未开 `enablePullDownRefresh`。
后果：管理员在 A 页审批、返回再进 B 单详情看到旧状态；收货人在验收页切后台（拍照/接电话）回来，订单状态可能已被他人改变（部分收货、作废）而不重拉 → 用旧状态提交。对照 `purchase-detail:16-18` 有 `onShow` 重拉 —— **同为详情页，口径不一致**。

**N8｜异常"关闭"不回写主单据，叠加 H1 造成订单永久卡死**
三个异常动作（ds:744/768/815）都只改 `abnormal_record`，**从不回写 `purchase_order.order_status`**；`settleReceipt`（ds:912-914）也只改 `receipt_item.payable_flag` 与生成报表。
而 `createReceipt:392` 白名单不含 `receipt_abnormal`（cf:386 注释与实现矛盾）→ **最后一批带异常的收货把订单打成 `receipt_abnormal` 后：不能再收货（cR:392 拦）、异常流程也不回退状态**。订单永久停在"收货异常"，`abnormal-list` 里所有相关异常关闭后**订单状态毫无变化**。
这是"前端看不到、也不提示"的系统级死锁。

**N9｜`createPurchaseOrder:454` ReferenceError 使报表失败告警永久失效**（主控 H14 已复核，本批独立复核确认）
`:273` `const orderData = {...}` 声明在**外层 try 块内**；`:429` `} catch (err) {` 是外层 try 的 catch；`:454` `store_id: orderData && orderData.store_id || ''` 在 catch 内的内层 try（`:437` 起）中引用。
`const` 是块级作用域，`:454` 求值即抛 `ReferenceError`，`&&` 短路轮不到。**顺序后果**：`:440` `missing_reports:true` 已落库 → `:446` message 写入前的字面量求值抛错 → 被 `:460-462` `catch (markErr)` 静默吞掉 → `:463-466` **照样返回 `code:0` + `reportWarning`**。
净效果：报表丢了、有标记、客户端被告知"请联系管理员"，而**唯一设计来兜底的告警消息机制自身失效且无声无息**，只剩 `:461` 一行 `console.error`。
`5268379` 与 `3558678` 均**未触及**此文件。

**N10｜`createReceipt` 无幂等键，前端唯一"满分防抖"页面之外无保护**
`createReceipt:320` `receiptId = 'RCP' + Date.now() + crypto.randomBytes(3)`，**无 `request_id` 概念**，`receipt` 表无幂等字段。`purchase-detail.js:289-296` 的 `_genRequestId` 只用于 copy/submit 两条路径，**`receive-verify:193` 的 createReceipt 不带任何幂等键**。
并发双击 / 双设备 / 超时重试 → 两笔都通过 `:228`/`:392` 状态白名单 → 插入两条收货单 → `:426` 事务内 `count+1` 读到同一个 count → **`batch_no` 重号**；`isFinalBatch` 在事务外按旧 history 算（:373-379）→ 订单终态被后写者覆盖。超收校验（:410-418）只拦"数量加起来超量"，拦不住"两笔各收一部分"。
对照 `createPurchaseOrder:140-150` 已有可复用的查重写法。

### P2 —— 一致性 / 卫生 / 数据质量

**N11｜`receive-list` 三个补操作与 `purchase-detail` 三个 handler 的 `_submitting` 复位不在 `finally`**
receive-list:131/153/176；purchase-detail:222/250/278。请求窗口内抛错 → 锁永久为 true → 按钮静默失效。`callFunction` 内部吞异常降低了概率，但 `setData`/`wx.hideLoading` 与复位之间任何抛错都会命中。

**N12｜9 处 `showLoading` 未配对**
purchase-detail:21/136/213/243/271、purchase-create:344、receive-list:125/147/170、receive-list:98。仅 `receive-verify:188/:228` 在 finally 中配对。

**N13｜`util.showLoading` 与 `wx.hideLoading` 混用**
receive-list:98/100/125/130/147/152/170/175。功能等价但两套 API 交错，读代码时难以判断配对关系。

**N14｜`abnormal-list` 4 个异步写操作全程无 loading、无防抖**
:16/:51/:81/:99。网络慢时用户无反馈；:47-58/:71-93/:95-109 无 `_submitting`。云端状态机（ds:743/:763/:813）兜住了幂等，所以后果止于"多一次失败 toast"。

**N15｜`abnormal-list.promptResolution` 无 `fail` 回调 → Promise 永挂起**
:60-69 `wx.showModal({ editable:true, success })` 无 `fail`。弹窗调用失败时 Promise 永不 resolve → handler 静默停在 :72，**无 toast、无 loading、无按钮复位**（因无锁）。对照 `util.showPrompt`（util.js:101-116）有 `fail() { resolve(null) }` —— **本页面绕过了工具函数、自己写了个更脆的版本**。

**N16｜`abnormal-list:55` 缺 `!result ||` 前缀**
`if (result.code !== 0) return util.showToast(result.msg || ...)`，而 :87/:103 都有 `!result ||`。`callFunction` 实际不返回 null（:67 兜底），风险低但不一致。

**N17｜`purchase-detail.canCopy` 无角色门禁**
:79 `canCopy = order.orderStatus === 'rejected'`。chef/supplier 对任意驳回单都能复制出新草稿，与 :73-77 `canEdit` 的严格限制明显不对称。

**N18｜`purchase-detail` 的 store_manager 分支用 `defaultStoreId` 而非当前门店**
:76 `order.storeId === currentUser.defaultStoreId`。店长切换到非默认门店后，其默认门店的草稿反而**不满足** canEdit。语义上应为当前门店 —— 但在 N2 的门店切换语义下这个选择是自洽的（店长只能操作默认门店的单）。**属"口径需要明确"而非确定 bug**。

**N19｜`verifyAmount` 无 `toFixed(2)`，0 元无法展示**
purchase-detail.wxml:97 `¥{{detail.verifyAmount}}` + `wx:if="{{detail.verifyAmount}}"`。`cloud.js:158` 允许返回 `''`。本批 0 处 `toFixed`、0 处千分位。

**N20｜`getPurchaseOrders`/`getReceipts` 的 `role` 入参是死参数**
gPO:43 解构后从未使用（一律按会话角色）；gR:44 同。purchase-list:62、receive-list:21/27 上送的值完全无效。**注意 purchase-list:62 的 `|| 'purchaser'` 兜底因此毫无影响**（原担心"chef 被当采购员拉全量"不成立）。

**N21｜`getReceipts.storeId` 是死参数，管理员侧无门店过滤能力**
gR:44 解构、:61 只用 `receiptDate`。receive-list:26 明确传了 `storeId` → 对 purchaser/super_admin **完全不生效**。店长侧因服务端强制收敛看不出问题。

**N22｜死代码 / 死样式**
- receive-list:54 `manualCount` 计算但 wxml 未引用（purchase-list:28 有引用，同名字段两页口径不同）
- purchase-list.wxss:69-76 `.reject-reason` 无引用
- receive-list.wxss:37-39 `.order-amount` 无引用
- abnormal-list.wxss:41 `.type-dot-delay` 无对应数据（`ABNORMAL_TYPE_NAMES` ds:683-689 只有 shortage/quality/wrong_item/missing_price）
- **abnormal-list 的 `missing_price` 类型无专属圆点色** → 落回 `#BFBFBF` 灰色（wxss:36），与 shortage 的黄色同层但视觉同级 → 缺价异常在列表里**没有视觉区分**

**N23｜`purchase-detail.wxml` 的 `supplierGroups`/`statusType` 首帧闪烁**
data:8 未初始化 `supplierGroups`（wxml:46 `wx:if`）→ 非 chef 用户首帧走 chef 平铺分支再跳变分组布局；`detail` 无 `statusType` → `status-bg-` 空类名，状态卡首帧无背景色。

**N24｜日期交叉校验缺失（有服务端兜底，但报错不直观）**
purchase-create.wxml:81 采购日期 picker 无 `start`/`end`；:87 期望到货只有 `start="{{today}}"`。可提交"采购日期晚于到货日期"，服务端 cPO:131 拒绝并报「采购日期或期望到货日期无效」—— 用户看不出是哪天的问题。

**N25｜`createdBy` 三处把显示名当 ID 下推**
purchase-list:64、receive-list:23、purchase-create:329。**三处对云端都是死参数**（见 N20 + cPO:291-296 忽略），故**无害** —— 但代码读起来暗示"服务端信任前端传的 createdBy"，是**误导性的正确**，建议直接删掉这三个字段。

**N26｜数量空值语义不一致**
purchase-create:190 空→0；:274 空→**1**。清空手动商品数量框会得到 1 并回填显示。

**N27｜小数口径全链路缺失**
前端 `type="digit"` 允许小数（purchase-create:46/70/137、receive-verify:29、approval-detail:51）；服务端 cPO:231-233 不校整数 → **下单量可存 3.5 件**。`createReceipt:199` 用 `typeof === 'number'` 严格判型 → 前端传字符串 `"5"` 会被判「验收信息不完整」，但 receive-verify:100-102 总是 `parseFloat` → 恒为 number，实际不会触发。**判型过严与全链路无整数约束并存**。

**N28｜`purchase-create` 底部按钮无 `loading`/`disabled`**
wxml:107-108。提交过程中无视觉反馈；配合 §6.1 的"抛错后永久锁死"，用户只会觉得"按钮点了没反应"。对照 receive-verify.wxml:88。

**N29｜`getAbnormalRecords` 服务端能力闲置 + `limit(100)` 硬截断**
ds:704 支持 `event.status` 过滤，但 abnormal-list:16-18 不传 → 每次筛选都先拉 100 条再本地过筛（:39-41）；ds:708 `.limit(100)` 硬编码 → **超 100 条异常静默丢失**。

**N30｜异常记录丢对账外键**
ds:718-730 的 10 字段白名单**无 `receipt_id` / `purchase_order_id` / `product_id`**，而 cR:491-493 三者均已落库。→ 异常记录无法跳回对应收货单/采购单，两侧无法互跳对账。

---

## 9. 遗留【待核实】

1. **wx-server-sdk 对 `where` 中 `undefined` 值的处理** —— 决定 N5（supplier 读侧越权）是否成立。ds:703 `query.store_id = auth.user.default_store_id`，supplier 无该字段。若是"忽略该字段"则 query 退化为全量；若是"匹配 undefined 文档"则返回空。需实测一次。
2. **`getSupplierOrders` 的 `created_at` 回读形态** —— 决定主控 H11 的排序隐患是否成立。`utils/cloud.js:80-82` 有 `instanceof Date` 分支，暗示两者都可能出现；若为 Date 对象，`String(date)` 以星期名开头 → `localeCompare` 与时间无关，跨年跨月列表全乱。需实测。
3. **`supplier_product_price` 的 `(supplier_id, product_id, is_current)` 唯一性** —— `createReceipt:340-346` 按该组合建 map，多条 `is_current:1` 时后者覆盖前者且无告警，直接影响金额准确性。属 price-manage / updateProductPrice 边界。
4. **`report_file` 补生成的唯一性** —— `settleReceipt:889-895` 按 `report_id` 后缀 `_S` 查重，`regenerateReceiptReports` 用 `_RG` 后缀，但 `createReceipt` 的四类报表 `report_id`（cR:567/600/649/684）**写入前不查重** → 补生成多次会产生多份同名报表。属 dataService 边界。
5. **`purchase-list` `onLoad(options.status)` 的合法值集合** —— :26-28 原样下推，云端 gPO:70-77 只认 `to_verify`/`receivable`/具体状态，其他值静默返回空列表。当前唯一入站路径是 index:164 的 `pendingListFilter`（值来自 index.wxml 的 dataset，已核对闭合），**风险可控**，但深链构造 `?status=xxx` 可打空列表。

**无跨批次遗留项。** batch2 的 10 个【待核实】已全部回收（§7.1），其末尾的 3 个跨批次项（dataService status 枚举校验、双白名单不一致、supplier_product_price 唯一性）中前两项本批已能定论：
- **`dataService:552` `order_status: event.status` 无枚举校验 → 已修**：ds:485 `if (!['approved','rejected'].includes(event.status)) return {code:-1,msg:'审核状态无效'}` 在写入前拦住，构造 `status:'received'` 会被拒。
- **`requestCancel` / `cancelOrder` 两个白名单不一致 → 仍成立，但前端已规避**：requestCancel ds:1348 允许 `partial_received`/`to_receive`，cancelOrder ds:1294 明确拒绝。前端 `cancelEligible`（purchase-detail:83，`5268379` 收窄）只放行 `{approved, report_generated}` → **用户走不到这条死路**。但服务端仍是开放状态：直接构造 `requestCancel` 可对 partial_received 单调出 `cancel_requested:true`，而 `canForceCancel` 为假、无任何"拒绝取消申请"的 action、`cancelOrder` 也不清 `cancel_requested`（ds:1302-1308）→ **该标记一旦置上就无法清除**，前端 `:85` 的 `!order.cancelRequested` 会让"申请取消"按钮永久消失。

---

### 附：本批横向一致性小结

| 维度 | 本批现状 |
|---|---|
| 唯一"满分"实现 | `receive-verify.submitReceipt`（置位早 + finally + UI 锁）|
| 唯一完整分页页 | `purchase-list`（服务端游标 + statusCounts + loadFailed）|
| 唯一零金额计算主张 | `purchase-create`（用户提交前看不到金额）|
| 唯一 token 化 wxss | `purchase-create.wxss` |
| 权限表达最完整 | `purchase-detail`（9 flag），但 canCopy 破例 |
| 完全无门禁 | `receive-list`、`abnormal-list`（后者叠加云端读侧漏）|
| 完全无防抖 | `abnormal-list`（3 写操作）、`purchase-detail.copyToDraft` |
| 契约不匹配 | 0 处致命、3 处误导（客户端日期/名称）、6 处无用负载 |
| 导航闭环 | 10/10 闭合，0 参数名错配 |
| 双层包裹问题 | 0 处（五函数全单层 `data`）|
| 最大风险 | N1（17 点鉴权静默）+ N2（门店切换误伤）+ N8/N9（异常闭环与告警双失效）|
