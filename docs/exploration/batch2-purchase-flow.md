# 批 2：采购主流程前端页面探索报告

> 范围：`pages/purchase-create`、`purchase-detail`、`purchase-list`、`receive-list`、`receive-verify`、`abnormal-list`、`approval-list`、`approval-detail`（32 个文件全读）
> 只读参考：`utils/cloud.js`、`utils/auth-guard.js`、`utils/meta.js`、`utils/util.js`
> 方法：只信代码不信注释，结论带 `文件:行号`。标注【待核实】= 需要云函数侧（其他批次）确认。

---

## 0. 公共封装契约（判断前端可信度的基准）

| 封装 | 位置 | 关键点 |
|---|---|---|
| `callFunction(name, data)` | `utils/cloud.js:49` | 自动注入 `authToken`（`:57-64`）；`code === -401` 统一跳登录（`:68-70`）；异常统一转 `{code:-1, errorType, msg}`（`:72-75`）——**云函数抛异常永远不会让页面崩，但也会静默变成一句通用错误** |
| `normalizePurchaseOrder` | `utils/cloud.js:139-169` | snake_case→camelCase；`deliveryDate` 回退 `orderDate`（`:143`）；`submittedAt` 回退 `createdAt`（`:164`）；新增字段 `isManual/verifyStatus/verifyAmount/verifyNote/verifyRejectNote/verifyVoucherFileIds/cancelRequested`（`:156-162`）；`items` 走 `normalizePurchaseItem`（`:167`） |
| `normalizePurchaseItem` | `utils/cloud.js:123-137` | 产出 `productNameSnapshot`、`orderQty`、`isManual`。**不产出** `productName`、`requestedQty`、`unitPrice` |
| `meta.getStatusInfo` | `utils/meta.js:43` | 未知状态返回 `{text: 原值或'未知', type:'grey'}`（`:44`），不抛错 |
| `authGuard.requireLogin()` | `utils/auth-guard.js:5-14` | 只看 `globalData.isLoggedIn && authToken`；失败 `wx.reLaunch` 到登录页 |
| `util.showConfirm` | `utils/util.js:83-96` | `resolve(res.confirm)`；`fail` 分支 `resolve(false)`——**弹窗失败等同于"取消"，无第三态** |

**归一化契约风险**：所有页面拿到云函数数据后都 `map(cloud.normalizePurchaseOrder)`，但 wxml 里若直接引用**未被归一化映射**的字段（如 `productName`、`requestedQty`），只能依赖云函数返回体里恰好带了这些原始字段（`{...item}` 展开保留）。见 §4 审批页问题。

---

## 1. `pages/purchase-list/`（js 142 行）

### 1.1 职责与数据流
- `onLoad(options)`：`requireLogin()` 后仅读取 `options.status` 作为初始筛选（`js:22-28`）。**未校验 `options.status` 是否在合法值集合内**，非法值会原样下推到 `params.orderStatus`（`js:60`）→ 服务端返回空列表，用户看到"暂无采购申请"，无任何提示。
- `onShow → reload()`（`js:30,41-44`）：每次进页面全量重拉第 1 页。
- `loadData(page, append)`（`js:46-97`）调用云函数 `getPurchaseOrders`，参数：
  - `role`（`js:53`）：`user.role || 'purchaser'` —— **角色兜底成 purchaser**。若 `userInfo.role` 为空（例如 app 全局状态未就绪），一个 chef 会被当成采购员拉全量数据。
  - `storeId`（`js:54`）：`store.storeId || store.id || ''`
  - `createdBy`（`js:55`）：`user.role === 'chef' ? (user.userId || user.id || user.name || '') : ''`
  - `page/pageSize`（`PAGE_SIZE = 20`，`js:8`）
  - `orderStatus` 仅在非 `all` 时附加（`js:60`）
- 服务端返回体使用 `result.total` 与 `result.statusCounts` 驱动分页与 tab 计数（`js:71-83`）——口径正确，未做前端二次统计。

### 1.2 公式与派生字段
`renderList()`（`js:104-123`）逐单派生：

| 字段 | 公式（行号） | 是否回传云函数 |
|---|---|---|
| `itemCount` | `o.items.length`（`js:116`） | 否，纯展示 |
| `manualCount` | `o.items.filter(i => i.isManual).length`（`js:109`） | 否，纯展示 |
| `timeAgo` | `util.getRelativeTime(o.createdAt)`（`js:119`） | 否 |
| `statusText / statusType` | `meta.getStatusInfo(o.orderStatus)`（`js:108`） | 否 |
| `canReceive` | `canReceiveRole && ['approved','report_generated','partial_received','to_receive'].includes(o.orderStatus)`（`js:111`） | 否，仅控制按钮显隐 |

**无金额计算**：本页面不展示金额，不做任何 `toFixed`。

### 1.3 状态机与按钮可见性
- `canReceiveRole = currentUser.role !== 'chef'`（`js:106`）—— chef 永远看不到"去收货"；**manager / admin / super_admin / purchaser / supplier 全部可见**（`!=='chef'` 是白名单的反面，属于"排除法"，任何新增角色都会默认获得收货权）。
- 可收货状态集 `['approved','report_generated','partial_received','to_receive']`（`js:111`）。注意 `report_generated` 与 `received` 不在其中，`to_receive` 存在于 `meta.statusMap`（`meta.js:12`）但**未出现在本页面 tab 中**（`js:75-82` 的 tab 列表没有 `to_receive`），意味着 `to_receive` 的单子只能靠"全部"tab 被翻到。
- 【待核实】前端 `canReceive` 与云函数 `receiveOrder` 的状态校验是否一致——若云函数允许 `submitted/pending_approval` 收货，则前端隐藏按钮无意义；反之若云函数额外允许 `to_verify` 之类状态，按钮会漏出。
- `goReceive`（`js:129-137`）：`this.data.orders.find(...)` 找不到则**静默不跳转、不提示**（`js:132` 无 else 分支）。用户点了按钮没反应。

### 1.4 角色分支
- 仅两处角色判断：`createdBy` 过滤（`js:55`）与 `canReceiveRole`（`js:106`）。
- `isGlobal = ['super_admin','purchaser'].includes(role)`（`js:74`）→ 仅这两个角色能看到"待核销"tab（`js:85-87`）。
- 注释 `// 清单 #12` 与 `// 清单 #20`（`js:73,84`）暗示存在一份外部清单文档，**角色判断写在前端（`js:85`），按钮级权限不在这里，而在 tab 级**。

### 1.5 异常路径
- 云函数失败：`util.showToast` 后 `return`（`js:63-67`），loading 已复位。
- 空列表：`empty-state`（`wxml:36-39`）。
- 分页到底：`hasMore: orders.length < total`（`js:92`）。**边界问题**：若服务端 `total` 缺失（`Number(undefined)=NaN → ||0`，`js:71`），`hasMore` 立即为 false，翻页永久关闭——静默降级为"只看第一页"，无任何提示。
- 下拉刷新：`onPullDownRefresh → reload().finally(stopPullDownRefresh)`（`js:32-34`），且 json 已开 `enablePullDownRefresh`。正确。
- **无 `onShow` 并发保护**：`onShow` 每次都直接 `reload()`，若用户在 `loadData` 进行中被切回，会并发两次 `setData({isLoading:true})` 与两次写入；后完成的请求可能覆盖先完成的（旧页码覆盖新页码）。同类风险见 §3 审核页。

### 1.6 交互缺陷
- **`js:55` 的 `user.name` 兜底**：`createdBy` 是 ID 语义参数，fallback 到显示名会把"张三"当 ID 发给服务端做等值过滤——chef 角色下很可能查不到任何单，且查不到时表现为"暂无采购申请"，极难定位。
- FAB（`wxml:41`）无角色门槛：任何登录用户（含 chef）都可新建采购单。

### 1.7 样式
- `#00873E`（品牌绿）与 `meta.reportTypeMap` 的 `#00873E`（`meta.js:33`）一致。
- `purchase-list.wxss:69-76` 定义了 `.reject-reason`（驳回原因红条），**wxml 中无任何引用 → 死样式**。

---

## 2. `pages/approval-list/`（js 96 行）

### 2.1 职责与数据流
- 角色门禁在 `onShow` 首段（`js:13-18`）：`!['super_admin','purchaser'].includes(me)` → toast + `setTimeout(navigateBack, 800)`。
  - **`admin` 角色被显式排除**（注释 `meta` 侧无 `admin` 定义，但任务约定存在 admin 角色）。若业务上 admin 也应审批，此处是漏放。
  - **`manager` 角色同样被排除**，与 §1.3 中"manager 可收货"形成不对称。
  - 门禁只在前端，页面 URL 可直接被构造访问。
- 拉取（`js:22-27`）：`getPurchaseOrders`，`pageSize: 100`，**不传 `orderStatus`**，只传 `role/storeId/createdBy:''`。
- 客户端筛选（`js:33`）：`.filter(o => o.orderStatus === 'submitted' || o.orderStatus === 'pending_approval')`。

### 2.2 关键缺陷：100 条截断
`pageSize: 100`（`js:26`）+ 客户端 filter（`js:33`）+ **无分页参数**（`js:22-27` 无 `page`）意味着：当该 role/store 名下订单总数 > 100 时，**超出部分中的待审批单会被静默丢弃**，管理员看不到、也不会收到任何"还有更多"的提示。这是本页面最严重的功能风险。

### 2.3 派生字段
`js:34-45`：`id: o.purchaseOrderId`、`requesterName: o.createdBy`、`expectedDeliveryDate: o.deliveryDate || o.orderDate`、`statusText`、`isManual`。无金额公式。

### 2.4 wxml / js 字段不一致（重要）
`approval-list.wxml:17`：
```
<text ...>{{prod.productName}} ×{{prod.requestedQty}}</text>
```
但 `normalizePurchaseItem`（`cloud.js:123-137`）产出的字段是 `productNameSnapshot` 与 `orderQty`，**`productName` / `requestedQty` 不在归一化映射里**——只能靠云函数返回体里恰好带这两个原始字段。若云函数返回 snake_case（`product_name`、`order_qty`），此处两列将同时空白，且**不报错、不告警**（wxml 绑定 undefined 渲染为空串）。对照 `purchase-list.wxml:19` 用的是正确的 `{{prod.productNameSnapshot}} ×{{prod.orderQty}}`。【待核实】云函数 `getPurchaseOrders` 的 items 返回形状。

### 2.5 审批动作
- `approveRequest`（`js:59-78`）：`this._submitting` 防抖（`js:60-61`）→ `util.showConfirm` → 调 `dataService` `action:'auditOrder'`，payload `{orderId, status:'approved', items:[]}`（`js:66-69`）→ 成功时读 `result.data.reportWarning` 展示（`js:71-72`）→ `this.onShow()` 重拉。
- `rejectRequest`（`js:80-95`）：payload `{orderId, status:'rejected', auditRemark:'审核驳回', items:[]}`（`js:87-90`）。
- **驳回理由写死为 `'审核驳回'`（`js:89`）**，未调用 `util.showPrompt`（`util.js:101-116` 已有可输入弹窗但此处未用），审计留痕价值低。
- `items: []` 恒传空数组（`js:68,89`）——【待核实】云函数 `auditOrder` 是否用 items 做逐项定价；若不用则无害。
- **共享防抖标志**：`this._submitting` 同时保护通过与驳回，两个不同按钮共用一把锁。行为上可接受，但若用户点"通过"被 confirm 取消（`js:64` `if (!confirmed) return`），`finally` 仍会复位——**此处正确**（`js:62` try 包住）。
- 成功后 `this.onShow()` 重跑门禁与请求（`js:73,91`）——非分页列表可接受，但会重发 `pageSize:100` 请求。

### 2.6 异常路径
- 失败 toast（`js:28-31,74,91`）。
- `goDetail`（`js:55-57`）无 id 校验，`dataset.id` 缺失时跳 `...?id=undefined`。

### 2.7 样式
- `.manual-badge`（`wxss:61-70`）在 `wxml:13` 使用，颜色 `#FA8C16/#FFD591/#FFF7E6` 与 `meta.reportTypeMap` 的 `#FAAD14` 系略有偏差（同色系不同值），非功能性。

---

## 3. `pages/abnormal-list/`（js 110 行）

### 3.1 职责与数据流
- `onShow`（`js:13-29`）：`requireLogin()` 后调 `dataService` `action:'getAbnormalRecords'`，**payload 为空对象**（`js:16-18`）——不传 `role`、`storeId`、`createdBy`，即请求该云函数"全量"。是否被云函数侧按会话收敛【待核实】，但**前端层面没有任何范围过滤**。
- 时间格式化：`cloud.formatDateTime(item.createdAt)`（`js:25`）；其余字段原样透传。
- **本地筛选**（`js:36-45`）：`activeFilter !== 'all'` 时 `list.filter(r => r.status === activeFilter)`，纯前端过滤（与 `purchase-list` 的服务端下推口径不同，此处数据量假设较小）。

### 3.2 状态映射
`statusColorMap = {pending:'warning', processing:'primary', resolved:'success', closed:'grey'}`（`js:42`）——与 `meta.statusMap`（`meta.js:14-17`）取值完全一致，但**在页面内重复定义而非复用 `meta.getStatusInfo`**；若后续 meta 调整将造成双处漂移。wxml 用 `tag-{{item.statusColor}}`（`wxml:23`）。

### 3.3 三个动作（状态机）
| 按钮 | wxml 条件 | handler | action | payload |
|---|---|---|---|---|
| 开始处理 | `item.status === 'pending'`（`wxml:42`） | `handleAbnormal`（`js:47-58`） | `startAbnormal` | `{id}` |
| 填写处理结果 | `item.status === 'processing'`（`wxml:45`） | `resolveAbnormal`（`js:71-93`） | `resolveAbnormal` | `{id, resolution, paymentDecision}` |
| 关闭异常 | `item.status === 'resolved'`（`wxml:48`） | `closeAbnormal`（`js:95-109`） | `closeAbnormal` | `{id}` |

按钮显隐完全由前端 `status` 驱动；**云函数侧是否重复校验当前状态未在前端体现**。

### 3.4 付款裁决逻辑（本页面唯一的业务分支）
`js:77-79`：
```
const payConfirmed = await util.showConfirm('该异常行是否按实收数量转回可付款？…\n「取消」则维持不可付款')
const paymentDecision = payConfirmed ? 'pay_received' : 'reject'
```
- 语义：confirm → `pay_received`；cancel → `reject`。
- **风险**：`util.showConfirm`（`util.js:91-94`）在 `wx.showModal` 调用 `fail` 时 `resolve(false)`，即**弹窗本身失败会被当作用户主动选择"不付款"**，静默地关闭了该异常行的补结算资格。这是"失败默认走降级路径"的典型。
- `resolution` 为空时 `showToast('请填写处理结果')` 并 return（`js:73-76`）——`promptResolution`（`js:60-69`）在 `!res.confirm` 时返回 `''`，与"用户填了空格"无法区分。

### 3.5 异常路径与交互缺陷
- **三个 handler 均无防抖**：`handleAbnormal`/`resolveAbnormal`/`closeAbnormal`（`js:47,71,95`）都**没有** `this._submitting` 之类的守卫（对照 `approval-list.js:60-61` 有）。快速双击"开始处理"会并发两次 `startAbnormal`。
- 成功后均 `await this.onShow()` 重拉全量（`js:57,92,108`）。
- `handleAbnormal` 失败分支 `if (result.code !== 0) return util.showToast(...)`（`js:55`）——注意此处**未判空 `result`**，而 `js:87,103` 都有 `!result ||` 前缀，`js:55` 缺一致保护（`cloud.callFunction` 实际不会返回 null，风险低但不一致）。
- 无下拉刷新（json 未开 `enablePullDownRefresh`），但 `onShow` 每次重拉，可接受。

### 3.6 样式
- `type-dot-quality/shortage/delay/wrong_item`（`wxss:39-42`）四色，wxml `type-dot-{{item.type}}`（`wxml:20`）——**若云函数返回的 `type` 不是这四个值之一，圆点落回灰色 `#BFBFBF`（`wxss:36`），静默降级**。

---

## 4. `pages/approval-detail/`（js 105 行）

### 4.1 职责与数据流
- 门禁（`js:14-20`）：与 `approval-list` 完全相同 `['super_admin','purchaser']`，**`admin`/`manager` 同样被排除**；失败 `setTimeout(navigateBack, 800)`。
- `this.orderId = options.id || options.orderId || ''`（`js:21`）——兼容两种参数名，**但对空值无防御**：`orderId === ''` 时仍会调用 `getPurchaseOrderDetail`（`js:23-25`）。
- 拉取 `getPurchaseOrderDetail` → `normalizePurchaseOrder`（`js:30`）。
- **仅 `onLoad` 加载一次**，无 `onShow` 刷新、无下拉刷新（json 未开）。管理员审批后返回再进入看到的是旧数据（虽然此时已 `navigateBack`）。

### 4.2 items 字段重映射（wxml 契约）
`js:36-43`：
| wxml 字段 | 来源 | 行号 |
|---|---|---|
| `productName` | `item.productNameSnapshot` | `js:38` |
| `spec` | `item.categorySnapshot` | `js:39` |
| `unit` | `item.unitSnapshot` | `js:40` |
| `requestedQty` | `item.orderQty` | `js:41` |
| `approveQty` | `item.orderQty`（初始=申请量） | `js:42` |

**语义缺陷**：`wxml:37` 标签写的是 `{{item.spec}} · {{item.unit}}`，但 `spec` 实际填的是 `categorySnapshot`（品类），而非规格。商品"规格"列展示的其实是品类名。`normalizePurchaseItem`（`cloud.js:123-137`）本身没有产出任何 spec 类字段（无 `specSnapshot`），因此这个错位无法在归一化层修好，只能在页面层。

### 4.3 前端计算值回写云函数（本批次最关键的可信度问题）
**审核数量 `approveQty` 是前端可编辑值，且被直接写入云函数参与改单**：
- 输入：`onApproveQtyInput`（`js:48-52`）`parseFloat(e.detail.value) || 0` → `setData({ 'detail.items[index].approveQty': val })`。
- 提交：`js:71-74`
  ```
  action: 'auditOrder', orderId: this.orderId, status: 'approved',
  items: this.data.detail.items.map(item => ({ itemId: item.itemId, approveQty: item.approveQty }))
  ```
  → 前端算出的 `approveQty` **全量提交，服务端按此改库**。
- 前端唯一校验：`js:64-69` `find(item => !(Number(item.approveQty) > 0))` → toast「审批数量必须大于 0」。
  - `type="digit"`（`wxml:43`）允许小数、禁止负号（多数键盘），故负数通常输不进来，但 `0` / `0.00` 可以。
  - **没有上限校验**：`approveQty` 可以任意大于 `requestedQty`（申请 10、批 1000 前端不拦）。
  - **没有"不得超过申请量"的提示**，也没有把 `requestedQty` 与 `approveQty` 的差异可视化。
- 提交的是**全部行**（含用户未触碰的行，其 `approveQty` 仍等于 `orderQty`）→ 服务端收到完整清单。若某行 `itemId` 为空（`normalizePurchaseItem` 里 `itemId: item.itemId || item.item_id || ''`），会以空 `itemId` 提交。

### 4.4 与 `approval-list` 快审路径的契约分叉（重要）
| 入口 | items 参数 | 行号 |
|---|---|---|
| `approval-list.approveRequest` | `items: []` | `approval-list.js:68` |
| `approval-detail.approveRequest` | `items: [{itemId, approveQty}...]`（全量） | `approval-detail.js:73` |

同一 action `auditOrder` + 同一 `status:'approved'`，**两个调用方对 `items` 的语义完全不同**：一处是空数组，一处是全量覆盖。这意味着云函数必须同时兼容"空=按申请量全批"和"非空=按提交值批"两种口径。这是前端契约层面的分叉点，任一侧变更都可能静默破坏另一侧。【待核实】云函数 `auditOrder` 对空 `items` 的处理。

### 4.5 状态机与按钮可见性
- `wxml:9` **无条件渲染** `<view class="tag tag-warning">待审核</view>`，无 `wx:if` 状态判断。
- `wxml:56-59` 通过/驳回两个按钮**完全没有状态条件**，只受 4.1 的角色门禁约束。
  → 已批准/已驳回的单子通过分享或手动拼 URL 进入本页时，仍显示"待审核"且按钮可点；点击后由服务端拒绝（【待核实】服务端是否二次校验状态）。前端"藏按钮"与"服务端拦"之间**没有一致性检查**。
- `wxml:8` 手动单提示 `tag tag-warning`：`线下采购·凭证核销（不核协议价）`——文案含业务规则声明，但前端不区分手动单与非手动单的审批行为（两条路径同样提交 `items`）。

### 4.6 表单校验与异常路径
- 驳回原因：`js:87-90` `if (!this.data.auditRemark)` → toast「请填写驳回原因」。注意**未 trim**，纯空格字符串会通过校验（`'   '` 为 truthy）。
- 通过路径无二次原因要求。
- 失败 toast（`js:27-29,79,100`）。
- `approveRequest` / `rejectRequest` 均有 `this._submitting` + `try/finally`（`js:59-82,85-104`）——**这是本批次最规范的防抖写法**，可作为其他页面的对照基准。
- `data` 初始化 `{ detail: {}, auditRemark: '' }`（`js:7-10`）；加载失败时 `detail` 仍为 `{}`，`wx:for="{{detail.items}}"` 对 undefined 安全（不渲染），但底部操作卡（按钮+文本域）仍可见。

### 4.7 样式
- `approve-input` 宽 `100rpx`（`wxss:64`），输入 5 位以上数字会溢出/滚动，长数量下可读性差。
- `.qty-approve`/`.qty-request` 等均在用；无死样式。

---

## 5. `pages/receive-list/`（js 183 行）

### 5.1 职责与数据流
- 门禁仅 `requireLogin()`（`js:11`），**无角色限制**——任何登录角色（含 chef、supplier）都能进入本页并点击"去收货"。
- `role = user.role || 'store_manager'`（`js:15`）——**兜底角色是 `store_manager`，与 `purchase-list` 的 `'purchaser'`（`purchase-list.js:53`）不一致**。两页对同一份 `getPurchaseOrders` 的默认角色假设不同。
- 并发双请求（`js:19-32`）：`Promise.all([getPurchaseOrders(pageSize:100), getReceipts(page:1,pageSize:5)])`，外层 `try/catch`（`js:33-37`）——**本批次唯一用 try/catch 包裹 `Promise.all` 的页面**（其他页面依赖 `callFunction` 内部吞异常）。
- 订单筛选（`js:46`）：`['approved','report_generated','partial_received','to_receive']`——与 `purchase-list.js:111` 的 `canReceive` 状态集**完全相同**，但**未叠加 `role !== 'chef'` 的角色判断**。同一个"可收货"集合在两页的实现口径不一致。
- `createdBy` 兜底同样含 `user.name`（`js:23`），与 `purchase-list.js:55` 是同一处问题的复制。

### 5.2 前端公式与派生字段
`orders`（`js:47-56`）：`statusText/statusType/itemCount/manualCount`。
`receipts`（`js:63-81`）：

| 字段 | 公式 | 行号 | 回写云函数？ |
|---|---|---|---|
| `hasAbnormal` | `(receiptStatus) === 'abnormal'` | `js:70` | 否，控制按钮显隐 |
| `statusText` | abnormal ? '收货异常' : '已收货' | `js:71` | 否 |
| `statusType` | abnormal ? 'danger' : 'success' | `js:72` | 否 |
| `missingReports` | `!!receipt.missing_reports` | `js:74` | 否 |
| `hasMissingPrice` | 见下 | `js:76-78` | 否，控制按钮显隐 |
| `photoCount` | `(receipt.photo_file_ids \|\| []).length` | `js:79` | 否 |
| `canRegenerate` | `['purchaser','super_admin'].includes(user.role)` | `js:84` | 否 |
| `canReprice` | 同左 | `js:85` | 否 |

**`hasMissingPrice` 公式（`js:76-78`）逐字抄录**：
```js
hasMissingPrice: (receipt.items || []).some(it =>
  !it.isManual && !it.is_manual && (it.supplierId || it.supplier_id) &&
  Number(it.priceSnapshot !== undefined ? it.priceSnapshot : it.price_snapshot || 0) <= 0)
```
- 运算符优先级：`a ? b : c || d` 解析为 `a ? b : (c || d)`，此处**写法正确**。
- 语义问题：`<= 0` 把**合法的 0 价**（赠品/免费料）也判为"缺价待补"，可能引发无意义的补价操作。
- 语义问题：若 `priceSnapshot === null`（非 `undefined`），三元命中 `null` → `Number(null) === 0` → 判为缺价。
- 依赖 `(it.supplierId || it.supplier_id)` 真值：无供应商的行**永不**被判缺价，即便价格为 0。
- `manualCount`（`js:54`）计算后 **wxml 未引用 → 死字段**。

### 5.3 字段形状脆弱点
`receipts` 映射中 `receiptId/receiptDate/storeName/receivedBy/receiptStatus` 全部做了 camel/snake 双读（`js:65-69`），但 `missing_reports`（`js:74`）与 `photo_file_ids`（`js:79`）**只读 snake_case**。若云函数统一返回 camelCase，这两项会静默为 `false` / `0`——缺报表与照片入口同时消失，且无任何报错。

### 5.4 三个补操作（状态机 + 权限）
| 按钮 | wxml 显隐条件 | handler | action | 成功后续 |
|---|---|---|---|---|
| 补结算 | `item.hasAbnormal`（`wxml:52`）——**无角色条件** | `settleReceipt`（`js:116-135`） | `settleReceipt` | **不刷新列表**（`js:134`） |
| 补生成 | `item.missingReports && canRegenerate`（`wxml:50`） | `regenerateReports`（`js:138-158`） | `regenerateReceiptReports` | `await this.onShow()` |
| 补价补账 | `item.hasMissingPrice && canReprice`（`wxml:51`） | `repriceReceipt`（`js:161-182`） | `repriceReceipt` | `await this.onShow()` |

### 5.5 交互缺陷（三个 handler 共性）
1. **防抖检查位于 confirm 之后**：`js:120-121 / 142-143 / 165-166`——先弹确认框再判 `this._submitting`。确认框未关闭期间连点两次会弹出两个 confirm。
2. **`this._submitting = false` 不在 `finally`**：`js:129 / 151 / 174`。对比 `approval-detail.js:61-82` 的 `try/finally`，此处若 `setData`/`showSuccess`/`onShow` 抛错，锁不释放，**该按钮永久失效直到页面重建**。
3. **`wx.hideLoading()` 同样不在 `finally`**：`js:128 / 150 / 173`。若前置步骤抛错，loading 遮罩不消失。
4. **三个不同 action 共用同一把 `this._submitting` 锁**：一个补结算进行中的卡顿会连带锁住补生成与补价。
5. **`settleReceipt` 成功后不刷新**（`js:134` 只有 toast），"补结算"按钮继续可见，可重复点击（依赖服务端幂等）；另两个 handler 都有 `await this.onShow()`。
6. `previewReceiptPhotos`（`js:90-104`）无防抖；`current: urls[0]`（`js:103`）忽略索引语义（`data-index` 实为收货单索引，非照片索引，行为可接受但参数命名误导）。

### 5.6 异常路径
- `receiptResult` 失败时保留旧 `orders` 并 toast（`js:57-62`），注释明确写了"不渲染成假空态"——**本批次异常处理最周到的一处**。副作用：`canRegenerate/canReprice` 不在此分支设置（`js:60` 只 set `orders`），而 `data` 初始无这两键（`js:8`），undefined → 按钮全部隐藏，管理员在收货记录加载失败时看不到补操作入口。
- 无分页：`getPurchaseOrders pageSize:100` + `getReceipts pageSize:5` 均无翻页，**>100 单时同样静默截断**（与 §2.2 同源问题）。
- 下拉刷新 `onPullDownRefresh → await this.onShow()`（`js:106-109`），json 已开启。

### 5.7 跳转契约不一致
`goVerify`（`js:111-113`）只传 `orderId`：
```
wx.navigateTo({ url: '/pages/receive-verify/receive-verify?orderId=' + e.currentTarget.dataset.id })
```
而 `purchase-list.js:134` 传的是 `?orderId= + storeId=`。**同一目标页两条入口的参数集不同**，`receive-verify` 必须能容忍缺 `storeId`。见 §6。

### 5.8 样式
- `wxss:37-39` `.order-amount` 定义但 wxml 未引用 → 死样式（本页不展示金额）。
- wxml 内联样式 `style="gap:12rpx;"`（`wxml:37`）、`style="margin-top:8rpx;"`（`wxml:42`）、`style="display:flex;gap:16rpx;"`（`wxml:48`）——与 wxss 混用，未收敛。
- 颜色 `#262626/#595959/#F0F0F0` 与全局灰阶一致。

---

## 6. `pages/receive-verify/`（js 269 行）

### 6.1 职责与数据流
- 角色门禁（`js:50-57`）：**只拦 `chef`**（`if (currentUser.role === 'chef')`）。这是"排除法"单点，与 `purchase-list.js:106` 的 `role !== 'chef'` 口径一致，但与 `receive-list.js`（无任何角色门禁）不一致——**两个入口页对同一目标页的准入标准不同**。
- 参数：`const id = options.orderId || options.id`（`js:58`）双名兼容 + 空值防御（`js:59-62`）——**本批次唯一对空参数做了显式防御的入口页**。
- 拉取 `getPurchaseOrderDetail` → `normalizePurchaseOrder`（`js:65-73`）；`items` 为空时 toast 并 return（`js:74-77`）。
- **仅 `onLoad` 加载一次**，无 `onShow` 刷新、无下拉刷新（json 未开）。

### 6.2 items 初始化（前端值 vs 服务端值）
`js:79-94` 逐行构造：
```js
{ ...item,
  productName: item.productNameSnapshot,
  unit: item.unitSnapshot,
  orderQty: item.orderQty,
  receivedQty: 0,          // 前端默认 0
  priceSnapshot: 0,        // ← 恒为 0，全文无任何赋值
  payableFlag: true,       // ← 恒为 true，UI 上无控件
  isShortage: false, isQualityIssue: false, isWrongItem: false,
  remark: '' }
```

### 6.3 前端可信度审计（本批次最严重问题集中区）
`createReceipt` payload（`js:193-218`）逐字段标注：

| 字段 | 来源 | 前端可信度风险 |
|---|---|---|
| `purchaseOrderId` | `order.purchaseOrderId`（`js:194`） | 安全，来自服务端详情 |
| `storeId` / `storeName` | `order.storeId \|\| currentStore.storeId \|\| currentStore.id`（`js:170-171`） | ⚠️ **前端上送的门店名/ID 会被写库**；`storeId` 缺失时 `showToast` 并中止（`js:172-175`），有防御 |
| `receivedBy` | `user.name \|\| user.username \|\| ''`（`js:197`） | ⚠️ 可为空串；且取本地 `userInfo`，非会话权威身份 |
| `overallRemark` | 用户输入，**未 trim**（`js:198`） | 低 |
| `photoFileIds` | `uploadReceiptPhotos` 返回值（`js:192`） | 安全 |
| `receiptDate` | `util.formatDate(new Date())`（`js:201`） | ⚠️ **由客户端时钟决定归档日期**，注释（`js:200`）说明是为了避免 UTC 跨日，但客户端时钟可被篡改；服务端应自行取日期 |
| items[].`receivedQty` | 用户输入，已校验（见 6.4） | 受控 |
| items[].`orderQty` | `item.orderQty`（`js:209`） | 透传服务端值，安全 |
| items[].`priceSnapshot` | **恒为 `0`**（`js:211`） | 🔴 **前端硬编码 0 提交入库**。若服务端信任该字段，所有收货明细价格归零；若服务端忽略并自算，则该字段是死负载 |
| items[].`payableFlag` | **恒为 `true`**（`js:212`） | 🔴 **前端硬编码 true 提交入库**，UI 上没有任何控件可改它。同上二选一 |
| items[].`isShortage`/`isQualityIssue`/`isWrongItem` | 用户勾选（`js:213-215`） | 受控，但**勾选不强制填写异常说明**（见 6.5） |
| items[].`productName` | `item.productName \|\| item.productNameSnapshot`（`js:206`） | 快照回显，安全 |
| items[].`orderItemId` | `item.itemId`（`js:204`） | 安全 |
| items[].`supplierId` | `item.supplierId`（`js:207`） | 透传 |

**结论**：`priceSnapshot` 与 `payableFlag` 是**前端单方面写定的持久化字段**，且前端不提供任何修改入口。这是"前端可信值参与写库"的最直接实例。【待核实】`createReceipt` 是否覆盖/忽略这两个字段。

### 6.4 数量校验
`js:152-155`：
```js
const invalidQty = items.some(item => (
  typeof item.receivedQty !== 'number' || !Number.isFinite(item.receivedQty) ||
  item.receivedQty < 0 || item.receivedQty > item.orderQty))
```
- 校验维度完整：类型、有限性、下界 0、上界 `orderQty`。
- **边界缺口**：`orderQty` 若为 `undefined`（`normalizePurchaseItem` 中 `orderQty: item.orderQty !== undefined ? ... : item.order_qty` 可能两缺），`receivedQty > undefined` 恒为 false → **上限校验静默失效**。
- 小数放行（`type="digit"`），如 `0.5` 合法；配合称重类单位合理。
- `onReceivedQtyInput`（`js:98-103`）：`raw === '' ? 0 : (parseFloat(raw) || 0)`，空值归 0，`"1.5abc"` 归 1.5。

### 6.5 校验完整性问题
- **勾选异常但不填说明可提交**：`wxml:53-57` 的异常说明 `textarea` 仅当有勾选时出现（`wx:if`），但 `_saveOrder` 无对应校验——`isShortage: true` + `remark: ''` 可提交。异常记录（§3）的 `description` 将为空。
- **实收 0 且不勾选异常的行被丢弃**（`js:161`），符合"B3 分批收货"语义，注释完备。
- `submitItems.length === 0` 时 toast（`js:162-165`）。

### 6.6 提交防抖（本批次最佳实践）
- `js:143` `if (isSubmitting) return` —— 入口第一行。
- **`js:181` `this.setData({ isSubmitting: true })` 位于 `await util.showConfirm(msg)` 之前**（`js:182`），注释明确写"避免弹窗期间双击并发提交"。
- `js:222-225` `finally` 里 `hideLoading` + `isSubmitting: false`。
- `wxml:88` 按钮带 `loading="{{isSubmitting}}" disabled="{{isSubmitting}}"` —— **唯一同时具备 UI 锁与逻辑锁的提交按钮**。
- ⚠️ 但 `isSubmitting` 在 `js:224` 复位后，恢复流程（`js:227-239`）与成功弹窗（`js:251-264`）期间按钮已解锁；此时若用户快速操作，理论上可再次进入。

### 6.7 提交后补偿：`recoverCommittedReceipt`（`js:6-37`）
- 触发条件（`js:8-11`）：`failedResult.errorType === 'CLOUD_UNAVAILABLE'` **或** `/已完成收货|不可收货|连接失败|Not connected/i.test(msg)`。
- 补偿动作：重查 `getPurchaseOrderDetail`，若 `detail.orderStatus === 'received'` 或 `receipts.length > 0`（`js:21`），**合成 `code:0` 的成功结果**（`js:26-36`）。
- ⚠️ **语义风险**：正则把"已完成收货""不可收货"这类**业务拒绝**也纳入补偿触发。若服务端因状态不合法拒绝（返回 `code:-1, msg:'不可收货'`），而该单恰已是 `received` 状态，则向用户合成"收货已保存 + 连接中断导致报表状态未返回"的成功弹窗——**用户被误导为成功，实际可能是重复提交**。
- ⚠️ `receipts[0]`（`js:23`）假定收货记录数组首元素即本次单；分批/多次收货场景下可能取错记录。
- ⚠️ 补偿结果 `reportsGenerated: 0` 硬编码（`js:30`），因 `reportWarning` 存在而走上分支文案（`js:246-247`），未误导。

### 6.8 存储泄漏
**照片先上传再提交**（`js:192` → `js:193`）：若 `createReceipt` 失败（含网络中断、服务端拒绝），**已上传的照片成为孤儿文件**，无回滚/清理逻辑。`cloud.uploadReceiptPhotos`（`cloud.js:227-241`）上传到 `receipts/${safeOrderId}/${ts}-${i}.${ext}`。

### 6.9 异常路径
- 加载失败 toast（`js:69-72`）；空商品 toast（`js:74-77`）。
- `choosePhoto`（`js:115-131`）：`count: 9 - photos.length` 正确封顶；`fail` 分支用 `/cancel/i` 区分用户取消与权限拒绝（`js:126`）——**本批次对授权失败处理最精细**。
- 提交失败：走 6.7 补偿，否则 toast（`js:266`）。
- 成功弹窗（`js:251-264`）三分支文案：正常 → confirmText"查看报表" + cancel"返回"；有 warning 或异常 → 仅"返回"。`res.confirm && !hasReportWarning && !hasAbnormal`（`js:258`）控制 `switchTab` 到 `report-list`。逻辑自洽。

### 6.10 wxml/js 一致性
- wxml 引用的 `item.productName/unit/orderQty/receivedQty/isShortage/isQualityIssue/isWrongItem/remark` 全部在 `js:79-94` 初始化。**无死字段**。
- `wxml:7` 硬编码 `tag tag-warning` "待验收"，**无状态判断**（与 §4.5 同型问题）。结合 6.7，打开一个已收货订单会显示"待验收"并允许提交。
- `wxml:88` 提交按钮是全页唯一交互控件，位置为普通流内（`wxss:142-145`），**非 fixed 悬浮**——长表单下需滚动到底才能提交。

### 6.11 样式
- 硬编码色值 `#FFF2F0/#FF4D4F`（`wxss:76-78`）、`#F0F2F5`（`wxss:48,68`）、`#D9D9D9`（`wxss:125`）——与全局灰阶/红系一致，但**未使用 `purchase-create.wxss` 那样的 CSS 变量**（见 §8.7），跨页风格机制不统一。

---

## 7. `pages/purchase-detail/`（js 384 行）

### 7.1 🔴 已确认运行时缺陷：`that is not defined`
`submitVoucher` 内 `js:153`：
```js
if (result && result.code === 0) {
  util.showSuccess('凭证已提交')
  that.loadData()          // ← `that` 在本文件从未定义
```
全文件无 `const that = this`（grep 确认：整个 `pages/` 下唯一 `const that = this` 在 `report-list.js:126`，非本批次）。执行路径：
`submitVoucher` 的 `try`（`js:136`）→ 凭证上传成功 → `verifyManualOrder` 返回 `code:0` → `js:153` 抛 `ReferenceError: that is not defined` → 被 `js:157 catch` 捕获 → **`util.showToast('凭证上传失败，请重试')`**。
**结果：用户凭证已提交入库，却收到"凭证上传失败"提示，页面也不刷新**。这是可稳定复现的功能性 bug，且属于"假阴性报错"，会诱导用户重复上传凭证。

### 7.2 数据加载与角色分支
- `onLoad`（`js:10-14`）只取 id 并在缺失时 toast，**不中止**；`onShow`（`js:16-18`）`if (this.orderId) this.loadData()` 才真正拉取。缺 id 时页面只剩空状态卡与无按钮区。
- **`onShow` 每次重拉**（`js:17`）——与其他详情页（approval-detail 仅 onLoad）不一致，但对本页更合理（凭证/核销状态会变）。
- 供货商分组（`js:37-70`）：
  - `confirmations = result.data.supplier_confirmations || {}`（`js:37`）——**只读 snake_case**，若云函数返回 `supplierConfirmations` 则分组标签全部失效。
  - `showConfirm = !['draft','rejected','cancelled'].includes(status)`（`js:38`）
  - `isDone = ['received','receipt_abnormal','completed'].includes(status)`（`js:39`）→ 强制显示 `done`
  - **chef 分支**（`js:46-52`）：不加供应商组，逐行挂 `supplierConfirmText/Type`——注释说明"后端不下发供货商名称"，但**前端仍渲染供应商确认标签**，与"chef 不见供应商身份"的意图存在张力（标签文案本身不含供应商名，风险有限）。
  - 非 chef 分支（`js:53-69`）：按 `supplierId` 分组，`supplierName: item.supplierName || (sid ? sid : '未指定供应商')`（`js:61`）——**供应商名缺失时回退为原始 ID**，UI 上会显示一串 ID。

### 7.3 权限矩阵（本批次最完整，`js:71-97`）

| Flag | 条件 | 行号 |
|---|---|---|
| `canReceive` | `role !== 'chef'` 且 status ∈ {approved, report_generated, partial_received, to_receive} | `js:71` |
| `canEdit` | status='draft' 且（super_admin/purchaser **或** `order.createdById === userId` **或** store_manager 且 `order.storeId === currentUser.defaultStoreId`） | `js:73-77` |
| `canCopy` | status='rejected' ——**完全无角色校验** | `js:79` |
| `canCancel` | status='submitted' 且 role ∈ {purchaser, super_admin} | `js:81` |
| `canRequestCancel` | status ∈ cancelEligible 且 role ∈ {purchaser, super_admin} 且 `!order.cancelRequested` | `js:83-84` |
| `canForceCancel` | status ∈ cancelEligible 且 role === 'super_admin' | `js:85` |
| `canRemindAudit` | status='submitted' 且 role ∉ {purchaser, super_admin} | `js:87` |
| `canSubmitVoucher` | isManual 且 role ∈ {store_manager, purchaser, super_admin} 且 status='received' 且 verifyStatus ∈ {none, rejected} | `js:92-95` |
| `canVerify` | isManual 且 verifyStatus='pending' 且 role ∈ {purchaser, super_admin} | `js:96-97` |

**问题**：
1. **`canCopy` 无角色门禁**（`js:79`）——chef、supplier 等任意角色对驳回单都能复制出新草稿，与 `canEdit` 的严格限制明显不对称。
2. **`canEdit` 的 store_manager 分支用 `currentUser.defaultStoreId`（`js:76`）而非 `currentStore.storeId`**——店长切换到非默认门店后，其默认门店的订单反而不满足条件；语义上大概率应为当前门店。
3. **`createdById` 与 `createdBy` 同源风险**：`normalizePurchaseOrder`（`cloud.js:152-153`）中 `createdById` 回退链包含 `created_by`，`createdBy` 回退链同样包含 `created_by`——若云函数仅返回 `created_by`（显示名），则 `createdById === userId`（`js:75`）变成"名字 === ID"，恒不成立，本人无法编辑自己草稿。
4. `canCancel` 与 `canForceCancel` 状态集互斥（submitted vs approved+），实际不会同时出现；`wxml:120-123` 两者可共存于同一容器。

### 7.4 金额与前端计算
- **唯一金额展示**：`wxml:97` `实付金额：¥{{detail.verifyAmount}}`，`wx:if="{{detail.verifyAmount}}"`。**无 `toFixed(2)`**——`¥123.5` 直接渲染，两位小数不补齐。`verifyAmount` 来源为 `normalizePurchaseOrder`（`cloud.js:158`），可能为 `''`（falsy 隐藏）。
- 本页**不做任何金额计算**，`verifyAmount` 完全来自服务端（由 `verifyDecide` 回写）。

### 7.5 凭证核销金额（前端采集 → 服务端写库）
`verifyDecide`（`js:194-228`）：
- `approve` 时 `util.showPrompt` 采集金额（`js:201`），`amount = parseFloat(input)`（`js:203`），校验 `isNaN(amount) || amount <= 0`（`js:204`）——**接受任意小数，无小数位上限**（如 `12.345` 可通过）。
- reject 时 `note = input.trim()`（`js:208-209`），空串拦截。
- **⚠️ `this._submitting = true` 在 `showPrompt` 之后（`js:211`）**，弹窗期间可连点两次；`_submitting = false`（`js:221`）不在 `finally`。
- `amount: amount || undefined`（`js:217`）。
- `orderId: d.purchaseOrderId`（`js:215`）——与 `submitVoucher` 用 `this.orderId`（`js:146`）不一致（等价但风格分裂）。

### 7.6 幂等键设计（`_genRequestId`，`js:286-295`）
```js
_genRequestId(kind) {
  if (!this._requestIds) this._requestIds = {}
  if (!this._requestIds[kind]) {
    this._requestIds[kind] = `${kind}_${d.purchaseOrderId || ''}_${Date.now()}_${Math.random()...}`
  }
  return this._requestIds[kind]
}
```
- **首次生成后缓存，页面存活期内同 kind 返回同一键** → 超时重试可被服务端去重。设计正确。
- 用于 `copyToDraft`（`js:328`，kind='copy'）与 `submitRequest`（`js:367`，kind='submit'）。
- ⚠️ **`kind='copy'` 键在页面存活期内不重置**：若用户在同一页面实例上复制两次（`canCopy` 仅对 rejected 单成立，复制后 `navigateTo` 离开本页，实际难以发生），第二次会命中第一次的键而被服务端判重。低概率潜伏问题。
- ⚠️ **`copyToDraft` 完全没有 `_submitting` 防抖**（`js:303-337`）——双击会并发两次 `createPurchaseOrder`；`requestId` 是唯一的兜底防御。

### 7.7 两个 payload 构造
- `copyToDraft`（`js:318-329`）与 `submitRequest`（`js:353-368`）的 items 形状**完全相同**：`{productId, productName, category, unit, supplierId, orderQty, isManual, remark}`。
  - **⚠️ 均缺 `itemId`**：编辑保存草稿时丢失原始 item 身份，服务端只能按 productId 匹配。
  - **⚠️ 均无价格字段**：定价完全在服务端（与 §6.3 的 `priceSnapshot` 硬编码 0 形成对比）。
  - `category: item.categorySnapshot`（`js:311,346`）——快照字符串当规范字段回写。
- `submitRequest` 额外带 `createdBy: d.createdById`、`createdByName: d.createdBy`（`js:361-362`）——**代提交他人草稿时保留原始下单人**，语义正确。
- `copyToDraft` 不带 createdBy → 新草稿下单人由服务端从会话推断，与 submit 路径口径不同。【待核实】服务端是否为空 createdBy 兜底。

### 7.8 各 handler 的防抖一致性

| handler | `_submitting` 位置 | `finally` | 结论 |
|---|---|---|---|
| `submitVoucher`（`js:122`） | 入口 | ✅（`js:160-162`） | 规范（但内部有 `that` bug） |
| `remindAudit`（`js:175`） | 入口 | ✅（`js:188-190`） | 规范 |
| `verifyDecide`（`js:194`） | 弹窗后（`js:211`） | ❌ | 有并发窗口 |
| `requestCancel`（`js:231`） | 弹窗后（`js:241`） | ❌ | 有并发窗口 |
| `cancelOrder`（`js:259`） | 弹窗后（`js:269`） | ❌ | 有并发窗口 |
| `copyToDraft`（`js:303`） | 无 | ❌ | 完全无防抖 |

**全部共享同一把 `this._submitting` 锁**，任一操作卡住会连带阻塞其他操作。

### 7.9 状态卡与图标
- `wxml:3` `status-bg-{{detail.statusType}}`；`wxss:13-17` 定义 grey/primary/warning/success/danger 五种渐变，与 `meta.statusMap` 的 type 取值**完全对应**。
- `wxml:5-8` 图标仅区分 draft/submitted/received，其余全部落回 clipboard——`approved`/`pending_approval`/`partial_received`/`receipt_abnormal`/`cancelled`/`to_receive`/`completed` 视觉无差异。
- `wxml:26` `{{detail.deliveryDate || detail.orderDate}}` 与 `normalizePurchaseOrder` 已做的同值回退（`cloud.js:143`）重复，无害。

### 7.10 wxml/js 一致性
- ⚠️ `supplierGroups` 未在 `data` 初始化（`js:8`），`wxml:46` 用 `wx:if="{{supplierGroups}}"`。加载完成前非 chef 用户会短暂渲染 chef 分支的平铺布局（闪烁）。
- ⚠️ `detail` 初值为 `{ items: [] }`（`js:8`），无 `statusType` → `status-bg-` 空类名，状态卡首帧无背景色。
- 凭证图 `wxml:95` `bindtap="previewVoucher" data-index="{{index}}"`，`js:166-172` 用 `urls: this.data.voucherImages` 全量 + `current` 定位——正确。
- `wxml:94` `wx:if="{{voucherImages.length}}"` 防空数组，`previewVoucher` 内部无空数组防御但可达路径已排除。

### 7.11 加载副作用
- `loadData` 在 `util.hideLoading()`（`js:26`）**之后**才 `await cloud.getFileUrls(...)`（`js:99-102`）取凭证图——loading 已消失，凭证区稍后才出现，无 loading 反馈。
- `hideLoading` 不在 `finally`，`normalizePurchaseOrder`/`getStatusInfo` 抛错会留下遮罩（低概率）。

### 7.12 样式
- `wxss` 全部硬编码色值（`#262626/#595959/#8C8C8C/#E8E8E8/#F0F0F0/#FFF7E6/#FAAD14` 等），**未使用 CSS 变量**，与 `purchase-create.wxss` 的 token 化风格形成对照。
- `manual-goods-row`（`wxss:127-130`）用左侧黄色边框区分手动商品，`wxml:52,68` 使用。

---

## 8. `pages/purchase-create/`（js 432 行，本批次最复杂）

### 8.1 数据结构：`data` vs `this`
- `data`（`js:9-32`）：分类/商品/手动项/日期/备注/`totalCount`/`isSubmitting`。
- **`this` 上的会话态**（不进 setData）：`editingOrderId`（`js:36`）、`manualOrderId`（`js:37`）、`catalogOrderId`（`js:38`）、`catalogOrderSubmitted`（`js:41`）、`catalogSeq`（`js:42`）、`requestId`（`js:44`）、`_qtyMap`（`js:93,176`）。
- ⚠️ **`_qtyMap` 不在 `data` 中**，是商品数量的唯一真源。`displayProducts` 里的 `qty` 只是渲染镜像（`js:175-183`）。这一设计避免了 `setData` 全量重建，但意味着**任何绕过 `filterProducts` 的 `setData` 都可能导致显示数量与真源不同步**。
- ⚠️ `categories` 未在 `data` 初始化（`js:9-32` 无此键），而 `updateFilteredCategories`（`js:150`）直接 `this.data.categories.filter(...)`——若被提前调用会 `TypeError`。实际调用点在 `loadReferenceData`（`js:123`，setData 之后）与 `switchL1`（`js:145`，用户操作时），路径安全但脆弱。
- ⚠️ `activeCategoryId: 1`（`js:14`）是**数字字面量**，而 `wxml:27` 用严格相等 `activeCategoryId === item.id`。若云函数返回的分类 id 为字符串，初始值永不匹配（首帧可能空列表）；`updateFilteredCategories` 用 `filtered[0].id` 覆盖后恢复正常。**初始值 1 实为死值**。【待核实】`getCategories` 返回的 id 类型。

### 8.2 数据加载链
`onLoad`（`js:34-53`）→ `loadReferenceData()`（`js:51`）→ `loadProducts()`（`js:124`）→ `filterProducts()`（`js:139`）；随后 `if (this.editingOrderId) loadExistingOrder()`（`js:52`）。
- ⚠️ **`getCategories` 失败即终止**（`js:107-110`）：toast 后 return，`loadProducts` 不再执行，页面停留在无分类无商品状态，**除刷新外无恢复手段**。
- `getProducts`（`js:129-131`）`includeInactive: false`，**无分页、全量入内存**——大商品库下的性能与 setData 体积风险。
- `loadProducts` 失败时 `setData({ displayProducts: [] })`（`js:134`）→ wxml 显示"暂无商品"（`wxml:52`）——**加载失败与真空类目不可区分**，用户会以为商品库为空。

### 8.3 分类与搜索
- `switchL1`（`js:143-147`）切换时清空 `searchKey`。
- `filterProducts`（`js:165-183`）：
  - 搜索模式：`p.categoryL1 === activeL1 && p.name.toLowerCase().includes(key)`（`js:170`）——**搜索被限制在当前一级分类内**。搜索一个属于其他 L1 的商品名会返回空，且无任何提示，用户会以为商品不存在。这是典型的隐式过滤陷阱。
  - 非搜索模式：`p.categoryL1 === activeL1 && p.categoryId === activeCategoryId`（`js:172`）。
  - 数量回填：`this._qtyMap[p.productId]`（`js:176`）。

### 8.4 数量输入与校验
| handler | 逻辑 | 行号 |
|---|---|---|
| `onProductQtyInput` | `parseFloat(e.detail.value) || 0`，无上限 | `js:188-196` |
| `increaseProductQty` | `(p.qty \|\| 0) + 1` | `js:198-206` |
| `decreaseProductQty` | `Math.max(0, (p.qty \|\| 0) - 1)` 钳制到 0 | `js:208-216` |
| `onManualQtyInput` | `parseFloat(e.detail.value) \|\| 1` **空值归 1** | `js:272-275` |
| `decreaseManualQty` | `qty > 1` 才减，下限 1 | `js:266-271` |

- ⚠️ **`onProductQtyInput` 与 `onManualQtyInput` 的空值语义不一致**：前者空→0，后者空→1。清空手动商品数量框会得到 1 并回填显示。
- `confirmManual`（`js:245-259`）校验完备：`!name.trim()`、`!unit.trim()`、`!qty || parseFloat(qty) <= 0`，并 `trim()` 后入库。**本批次表单校验最严格处**。
- `type="digit"`（`wxml:46,70,137`）统一禁止负号与字母，但**允许小数**。
- **⚠️ 无日期交叉校验**：`_saveOrder`（`js:295`）只检查 `deliveryDate` 非空，**不校验 `deliveryDate >= orderDate`**。`wxml:87` 的到货 picker 有 `start="{{today}}"`（页面加载日）但采购日期 picker（`wxml:81`）**无任何 `start`/`end` 约束**，可选任意历史日期 → 可提交"采购日期晚于到货日期"的单据。
- ⚠️ `removeManualItem`（`js:276-281`）无二次确认，直接删除。

### 8.5 🔴 提交防抖位置错误（与注释自相矛盾）
注释 `js:30-31`：`// 提交防重入：confirm 弹窗期间双击会并发创建两张订单`。
实际代码顺序：
```
js:294  if (this.data.isSubmitting) return
js:340  const confirmed = await util.showConfirm(...)   ← 先弹窗
js:343  this.setData({ isSubmitting: true })            ← 后置位
```
**置位在弹窗之后，注释声称要防的窗口恰好开放**：用户在 confirm 弹窗打开期间连点两次，两次 `_saveOrder` 都会通过 `js:294` 检查（此刻仍为 false），弹出两个确认框；两次确认都会发出 `createPurchaseOrder` 请求。真正的兜底是**相同的 `requestId`**（`js:337`，失败不重置），靠服务端幂等去重。
**对照 `receive-verify.js:181` 把 `setData({isSubmitting:true})` 放在 confirm 之前——正确写法。**

### 8.6 三条提交路径与幂等子键

`_saveOrder(orderStatus)`（`js:293-431`）在 `hasManual && hasCatalog` 时拆单，否则走单路。

| 路径 | 条件 | 档案单 | 手动单 | 行号 |
|---|---|---|---|---|
| A 拆单 | `hasManual && hasCatalog` | `orderId = editingOrderId \|\| (catalogReusable ? catalogOrderId : undefined)`，suffix `':c'` 或 `':c' + (++catalogSeq)` | `orderId = manualOrderId \|\| undefined`，suffix `':m'` | `js:364-403` |
| B 纯档案单 | `hasCatalog && !hasManual` | `orderId = editingOrderId \|\| manualOrderId \|\| undefined`，**suffix `''`** | — | `js:404-410` |
| C 纯手动单/拆单重试 | `hasManual && !hasCatalog` | — | `orderId = editingOrderId \|\| manualOrderId \|\| undefined`，suffix `':m'` | `js:404-410` |

**幂等键设计（值得肯定）**：
- `this.requestId = 'REQ' + Date.now() + Math.random().toString(36).slice(2,8)`（`js:44`），**仅整单成功后重置**（`js:416`）→ 失败重试复用同键，服务端可查重。
- 拆单用 `:c`/`:m` 子键隔离两笔请求，避免互相误判（`js:334-337`）。
- `catalogOrderSubmitted`（`js:383`）+ `catalogSeq`（`js:42,371`）：档案单已提交后追加档案商品会递增 `:c2/:c3`，**避免复用 `:c` 命中首单导致本轮商品被静默丢弃**——注释与实现一致，是本批次设计最精细处。

**关键缺陷：拆单部分失败的恢复语义**
- 档案单成功、手动单失败时（`js:388-399`）：`catalogOrderId` 记录、`editingOrderId=''`、`_qtyMap={}`、`filterProducts()` 清空显示（`js:381-386`），弹 `showCancel:false` 的"部分提交成功"并 return。
- 用户再点提交 → 进入**路径 C**（`hasCatalog=false`）→ `reuseId = '' || '' || undefined` → 新建手动单，key `REQ...:m`（与上次手动失败同一键）→ 服务端可去重。**恢复路径正确**。
- ⚠️ 但此时 `manualItems` 仍在 `data` 中，**手动商品不会被清空**，用户看不到"档案部分已提交"的视觉确认（仅靠弹窗文案）。若用户此时误以为整单失败而刷新页面，已提交的档案单在列表可见，尚可接受。

### 8.7 payload 构造与前端回写字段

`buildPayload`（`js:323-338`）：
| 字段 | 值 | 风险 |
|---|---|---|
| `storeId` | `store.storeId \|\| store.id`（`js:324`） | 缺门店时 `js:318-321` 提前拦截，有防御 |
| `storeName` | `store.storeName \|\| store.name`（`js:325`） | ⚠️ 前端上送写库 |
| `createdBy` | `user.userId \|\| user.id \|\| user.name \|\| user.username`（`js:329`） | 🔴 **兜底到显示名当 ID**（与 `purchase-list.js:55`、`receive-list.js:23` 同一问题） |
| `createdByName` | `user.name \|\| user.username`（`js:330`） | 低 |
| `orderStatus` | `'draft'` / `'submitted'`（`js:289-291` 传入） | ⚠️ **前端决定单据状态**，见下 |
| `requestId` | `this.requestId + reqSuffix`（`js:337`） | 设计良好 |

⚠️ **`orderStatus` 由前端指定**：`_saveOrder('draft')` 与 `_saveOrder('submitted')` 走同一 action `createPurchaseOrder`，状态完全由客户端传入。服务端若不校验"新单必须为 draft/submitted"或"编辑单不允许直接 submitted"，则存在状态跃迁风险。【待核实】服务端是否校验。

`toPayloadItems`（`js:346-361`）：
```js
{ productId: item.productId || item.tempId,      // 手动商品用 tempId 当 productId
  productName: item.name,
  category: catName,                             // 前端字符串拼接
  unit: item.unit,
  supplierId: item.defaultSupplierId || item.supplierId || null,
  orderQty: item.qty,
  isManual: !!item.isManual,
  remark: item.remark || '' }
```
- **⚠️ `productId: item.productId || item.tempId`**（`js:352`）：手动商品无 productId，`tempId`（`'MANUAL_' + Date.now()`，`js:251`）**被当作 productId 提交**。服务端必须靠 `isManual: true` 识别，否则会尝试按 `MANUAL_172...` 查商品档案。
- **⚠️ `category` 由前端字符串拼接**（`js:347-350`）：`catL1Name + '-' + cat2.name`。档案商品得到 `'厨房-蔬菜'`，手动商品因无 `categoryId` 只得到 `'厨房'`（`js:350`）——**两类商品入库的分类粒度不一致**，下游报表按分类聚合时会产生偏差。
- **无任何价格字段**——定价完全服务端（正面）。
- **无 `itemId`**——编辑草稿保存时丢失行身份（与 §7.7 同源）。
- ⚠️ `wx:key="tempId"`（`wxml:62`）在 `js:251` 用 `Date.now()` 生成，同毫秒内添加两条会碰撞。

### 8.8 本批次唯一的正面：无前端金额计算
全文件 grep 无 `toFixed`、无金额累加。**`totalCount` 是行数不是数量、更不是金额**：
```js
_updateTotal() {                                   // js:218-223
  const qtyMap = this._qtyMap || {}
  let count = Object.values(qtyMap).filter(v => v > 0).length
  count += this.data.manualItems.length
  this.setData({ totalCount: count })
}
```
`wxml:105` 显示为 `共 {{totalCount}} 种商品`——命名 `totalCount` 易误读为数量合计，实际是"选了几种商品"。**采购金额在本页完全不可见**，用户提交前无法预估金额。

### 8.9 三条路径的 payload 差异汇总
| | 档案单 | 手动单 |
|---|---|---|
| `orderId` | 草稿单号 / 已提交则新建 | `manualOrderId`（重试沿用） |
| `requestId` 后缀 | `:c` / `:c2`… | `:m` |
| `items` | `selectedProducts`（来自 `_qtyMap`） | `manualItems` |
| `items[].productId` | 真实 productId | **`MANUAL_<ts>` 伪 ID** |
| `items[].category` | `L1-L2` 两级 | **仅 L1** |
| `items[].supplierId` | `defaultSupplierId` 优先 | `supplierId`（通常 null） |

### 8.10 异常路径
- `allItems.length === 0` → toast（`js:308`）。
- `!this.data.deliveryDate` → toast（`js:295`）。
- `!store.storeId && !store.id` → toast（`js:318-321`）。
- 档案单失败 → toast + 复位 `isSubmitting`（`js:373-378`）。
- 手动单失败 → 部分成功弹窗（`js:388-399`）。
- 整单失败 → toast（`js:429`）。
- ⚠️ **无 `try/finally` 包裹主流程**：`isSubmitting` 在 `js:375/390/413` 三处显式复位，覆盖了所有正常返回路径；但若 `toPayloadItems`/`buildPayload` 内部抛错（例如 `this.data.products.find` 返回 undefined 后解构），`isSubmitting` 保持 true → **底部按钮永久失效**（`wxml:107-108` 无 disabled 属性，视觉上看不到锁，只会觉得按钮点了没反应）。

### 8.11 wxml/js 一致性
- `data` 全部字段均被 wxml 或 js 使用，**无死字段**。
- ⚠️ **底部按钮无 `loading`/`disabled`**（`wxml:107-108`）——提交过程中无视觉反馈，对照 `receive-verify.wxml:88`。
- `wxml:46` 用 `value="{{item.qty || ''}}"`（0 显示为空 + placeholder "0"），`wxml:70` 用 `value="{{item.qty}}"`（0 显示为 "0"）——**同一页两类数量输入的 0 值渲染不一致**。
- `wxml:100-101` 用固定 `height:140rpx` 占位抵消 fixed 底栏，魔法数字与 `wxss:129-135` 的底栏高度耦合，改一处需改另一处。
- `wxml:113-114` mask `bindtap` + popup `catchtap="preventBubble"`（`js:237` 空函数）——冒泡抑制正确。
- `wxml:127-128` 引用 `icon-chef-primary/grey`、`icon-armchair-primary/grey`，与 `meta.categoryIconMap`（`meta.js:49-53`）的 emoji→图标映射体系一致。

### 8.12 样式：本批次唯一 token 化页面
`purchase-create.wxss` **系统使用 CSS 变量**：`var(--color-bg-page)`、`var(--color-bg-card)`、`var(--shadow-card)`、`var(--radius-md)`、`var(--color-primary)`（`wxss:5,18,21,27,36,39,44,49,77,81,162`）。
其余 7 个页面（purchase-list / approval-list / abnormal-list / approval-detail / receive-list / receive-verify / purchase-detail）的 wxss **全部硬编码色值**（`#00873E`、`#ffffff`、`#F0F2F5`、`#8C8C8C` 等）。
即便本页也仍有硬编码残留：`rgba(0,135,62,0.03)`（`wxss:49`）、`rgba(0,135,62,0.06)`（`wxss:162`）、`#F0F2F5`、`#F5F7FA`、`#FFF7E6`、`#FAAD14`、`#E0E2E5`、`#BFBFBF` 等——品牌绿的 rgba 形式没有对应 token。
**结论：项目处于"token 迁移进行中"的状态，采购创建页已迁移，其余采购流程页未迁移。**

---

## 9. 跨页面横向对照

### 9.1 防抖实现一览（本批次最大的横向不一致）
| 页面/handler | 入口检查 | 置位时机 | finally | UI 锁 |
|---|---|---|---|---|
| `approval-detail.approve/reject` | ✅ | confirm 前 | ✅ | 无 |
| `purchase-detail.submitVoucher/remindAudit` | ✅ | 入口 | ✅ | 无 |
| `purchase-detail.verifyDecide/requestCancel/cancelOrder` | ✅ | **弹窗后** | ❌ | 无 |
| `purchase-detail.copyToDraft` | ❌ | — | ❌ | 无 |
| `receive-verify.submitReceipt` | ✅ | **confirm 前** | ✅ | ✅ `loading/disabled` |
| `receive-list.settle/regenerate/reprice` | ✅ | **弹窗后** | ❌ | 无 |
| `abnormal-list.handle/resolve/close` | ❌ | — | ❌ | 无 |
| `purchase-list.*` | 无写操作 | — | — | — |
| `purchase-create._saveOrder` | ✅ | **弹窗后（与注释矛盾）** | ❌ | 无 |

**结论：只有一处（`receive-verify.js:181`）同时满足"置位在弹窗前 + finally 复位 + UI 锁"。其余写操作存在"弹窗期并发"或"抛错后锁死"至少一种风险。**

### 9.2 `user.name` 兜底为 ID 的三处同源问题
| 位置 | 代码 |
|---|---|
| `purchase-list.js:55` | `user.role === 'chef' ? (user.userId \|\| user.id \|\| user.name \|\| '') : ''` |
| `receive-list.js:23` | `createdBy: role === 'chef' ? (user.userId \|\| user.id \|\| user.name \|\| '') : ''` |
| `purchase-create.js:329` | `createdBy: user.userId \|\| user.id \|\| user.name \|\| user.username` |

三处都把显示名作为 `createdBy`（ID 语义）下推给服务端；前两处影响"我的采购"过滤（查不到则显示空列表），第三处**直接把名字写进 purchase_order 表**。

### 9.3 角色门禁的三套口径
| 页面 | 准入判断 | 行号 |
|---|---|---|
| `purchase-list` | `canReceiveRole = role !== 'chef'`（排除法） | `js:106` |
| `approval-list` / `approval-detail` | `['super_admin','purchaser'].includes(role)`（白名单，**排除 admin**） | `js:13-18` / `js:15-20` |
| `receive-verify` | `role === 'chef'` 才拦（排除法） | `js:53` |
| `receive-list` | **无门禁** | — |
| `abnormal-list` | **无门禁** | — |
| `purchase-detail` | 9 个细粒度 flag（最完整） | `js:71-97` |

**没有一个统一的角色-操作矩阵常量**；同一"收货"能力在 `purchase-list`（排除法）、`receive-list`（无判断）、`purchase-detail`（排除法 + 状态集）三处各写一遍。

### 9.4 状态集硬编码重复
`['approved','report_generated','partial_received','to_receive']` 在 4 处独立硬编码：
- `purchase-list.js:111`（canReceive）
- `purchase-detail.js:71`（canReceive）、`js:83`（cancelEligible）
- `receive-list.js:46`（orders filter）
- `purchase-detail.js:83` 另加 `['approved',...]`

`meta.statusMap`（`meta.js:1-20`）是状态→文案的映射，**不含状态→可操作性的映射**。任一状态机变更需同时改 4+ 处。

### 9.5 100 条截断
| 页面 | 取数 | 过滤 |
|---|---|---|
| `approval-list` | `pageSize: 100`，无 `orderStatus`（`js:26`） | 客户端 filter（`js:33`）→ **>100 单静默丢单** |
| `receive-list` | `pageSize: 100`（`js:24`） | 客户端 filter（`js:46`）→ 同上 |
| `purchase-list` | `pageSize: 20` + `page` + 服务端 `statusCounts`（`js:60-83`） | 服务端筛选 → **正确做法** |

### 9.6 前端计算值写库清单（可信度审计总表）
| 值 | 页面 | 提交字段 | 严重度 |
|---|---|---|---|
| `priceSnapshot` | receive-verify | 恒为 `0` | 🔴 高 |
| `payableFlag` | receive-verify | 恒为 `true` | 🔴 高 |
| `receiptDate` | receive-verify | 客户端时钟 | 🟠 中 |
| `storeId`/`storeName` | receive-verify / purchase-create | 客户端上送 | 🟠 中 |
| `receivedBy` | receive-verify | 可空串 | 🟠 中 |
| `approveQty` | approval-detail | 用户输入，仅校验 `>0`，**无上限** | 🟠 中 |
| `amount`（核销实付） | purchase-detail | 用户输入，仅校验 `>0` 且非 NaN，**无小数位限制** | 🟡 低 |
| `orderStatus` | purchase-create | 客户端指定 `'draft'/'submitted'` | 🟠 中 |
| `category` | purchase-create | 前端字符串拼接，**手动/档案粒度不一致** | 🟠 中 |
| `productId` | purchase-create | 手动单用 `MANUAL_<ts>` 伪 ID | 🟠 中 |
| `createdBy` | purchase-create / purchase-list / receive-list | 兜底到显示名 | 🟠 中 |
| `paymentDecision` | abnormal-list | 弹窗失败等同"取消"= `reject` | 🟡 低 |

### 9.7 死代码 / 死样式
| 类型 | 位置 |
|---|---|
| 死字段 | `receive-list.js:54` `manualCount`（计算但 wxml 未引用） |
| 死 CSS | `purchase-list.wxss:69-76` `.reject-reason` |
| 死 CSS | `receive-list.wxss:37-39` `.order-amount` |
| 死值 | `purchase-create.js:14` `activeCategoryId: 1`（首帧后被覆盖） |
| 重复定义 | `abnormal-list.js:42` 本地 `statusColorMap` 与 `meta.statusMap` 重复 |
| 未用工具 | `approval-list.js:89` 驳回理由写死，未用 `util.showPrompt`（`util.js:101-116`） |

### 9.8 前端字段名与归一化契约不一致
| wxml 引用 | 归一化产出 | 后果 |
|---|---|---|
| `approval-list.wxml:17` `prod.productName` / `prod.requestedQty` | `productNameSnapshot` / `orderQty` | 若云函数未额外返回这两个原始字段，**商品名与数量两列同时空白**，且不报错 |
| `receive-list.js:74,79` `missing_reports` / `photo_file_ids` | 只读 snake，同函数其他字段均双读 | camelCase 返回时缺报表标记与照片入口静默消失 |
| `purchase-detail.js:37` `supplier_confirmations` | 只读 snake | 同上 |
| `receive-list.js:76-78` `priceSnapshot`/`price_snapshot` | 双读，写法正确 | — |

---

## 10. 结论（按严重度排序）

1. 🔴 **`purchase-detail.js:153` `that.loadData()` 引用未定义变量** —— 凭证提交成功后抛 `ReferenceError`，被 catch 转成"凭证上传失败，请重试"。用户实际已提交但收到失败提示，页面不刷新。可稳定复现。
2. 🔴 **`receive-verify.js:211-212` `priceSnapshot: 0` / `payableFlag: true` 硬编码入库** —— 前端单方面写定的持久化字段，且 UI 无任何修改入口。要么服务端必须忽略（否则价格归零），要么这两列永远无意义。
3. 🟠 **`approval-list.js:26,33` 与 `receive-list.js:24,46`：`pageSize:100` + 客户端过滤** —— 订单超 100 条后，超出的待审批/待收货单被静默丢弃，无任何提示。
4. 🟠 **`receive-verify.js:6-37` 补偿函数正则把"不可收货/已完成收货"等业务拒绝当网络失败** —— 可能向重复提交的用户合成"收货已保存"的成功弹窗。
5. 🟠 **提交防抖置位时机普遍错误**（§9.1）—— 6 个 handler 把 `_submitting` 置在 confirm 之后，注释声称要防的"弹窗期双击并发"恰好开放；且多数不在 `finally` 复位，抛错后按钮永久锁死。
6. 🟠 **`purchase-create.js:352,349-350` 手动商品用 `MANUAL_<ts>` 当 productId、category 拼接粒度不一致** —— 手动单与档案单入库数据形状不同，下游按 productId 查档或按分类聚合都会出问题。
7. 🟠 **`user.name` 兜底为 ID 的三处同源问题**（§9.2）—— 其中 `purchase-create.js:329` 会把显示名写进 purchase_order 表。
8. 🟠 **`approval-detail.js:65` 审批数量仅校验 `> 0`，无上限** —— 审批量可任意超出申请量，前端无提示、无可视化差异。
9. 🟡 **照片先传后提交，失败即孤儿文件**（`receive-verify.js:192-193`）—— 无回滚清理。
10. 🟡 **`approval-list.wxml:17` 字段名与归一化契约不符**（`productName`/`requestedQty` 非归一化产出）—— 潜在整列空白。
11. 🟡 **异常列表无防抖、无范围过滤**（`abnormal-list.js:47,71,95` 与 `js:16-18` 空 payload）。
12. 🟡 **样式迁移不完整**：仅 `purchase-create.wxss` 使用 CSS 变量，其余 7 页全硬编码。


