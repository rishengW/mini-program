# A3 勘察报告：C 端采购收货主业务动线（11 页面 / 44 文件）

勘察日期：2026-10-04
勘察分支：backup
勘察范围：pages/index、login、message、purchase-create、purchase-detail、purchase-list、receive-list、receive-verify、approval-list、approval-detail、abnormal-list 全部 .js / .wxml / .wxss / .json
辅助参照（不计入 44 文件）：utils/cloud.js、utils/util.js、utils/meta.js、utils/auth-guard.js、app.json

---

## 0. 前置事实（决定了后续判定口径）

- `utils/cloud.js:49-76 callFunction` **从不抛异常**：内部 try/catch，任何失败都返回 `{code:-1, errorType, msg}`。因此「`await callFunction` 之后 hideLoading 不执行导致遮罩卡死」这一类问题在本项目中**不存在**，本报告不将其列为缺陷。
- 但 `cloud.uploadReceiptPhotos`（`cloud.js:227-241`）**会抛异常**（ensureCloudReady 失败 throw、`wx.cloud.uploadFile` reject），receive-verify 已正确包 try/catch。
- `cloud.getFileUrls`（`cloud.js:255-268`）内部吞异常返回 `[]`，不抛。
- tabBar 页面只有 4 个：index、purchase-list、report-list、message（app.json:43-67）。purchase-list / message 的 `onLoad(options)` 实际上拿不到深链参数。
- `enablePullDownRefresh: true` 仅声明于 purchase-list、receive-list、approval-list 三个页面 json。abnormal-list / approval-detail / purchase-detail / receive-verify / index / message 均未开启下拉刷新。
- `util.showPrompt`（util.js:101）依赖 `wx.showModal` 的 `editable` 能力（base lib ≥ 2.17.1），取消返回 `null`，支持时返回 `res.content || ''`。
- `auth-guard.js requireLogin`：未登录 `wx.reLaunch` 到 login 并返回 false；11 个页面中除 login 外 10 个都在生命周期首行调用。

---

## 1. 文件清单与职责

### pages/index（首页，tabBar）
| 文件 | 行数 | 职责 |
|---|---|---|
| index.js | 182 | 4 个云函数并发拉首页聚合数据；状态卡（可点击跳列表）；管理工作台入口分发；退出登录 |
| index.wxml | 109 | 门店头 + 铃铛 + 管理工作台 + 2×N 状态卡 + 最近采购单 + 最近报表 + 页底退出按钮 |
| index.wxss | 176 | 布局与卡片样式；含已废弃的 `.modal-mask/.modal-content/.form-field/.modal-actions` 新增门店弹窗样式 |
| index.json | 2 | 仅 navigationBarTitleText「首页」，未开启下拉刷新 |

### pages/login（登录）
| 文件 | 行数 | 职责 |
|---|---|---|
| login.js | 104 | 角色三选一 + 超管登录切换；调用 authService login；写 globalData 与 storage；按角色 reLaunch 分流 |
| login.wxml | 66 | 角色选择 + 账号密码输入 + 超管登录切换入口 |
| login.wxss | 202 | 登录页样式；含已废弃的 `.history-*` 账号历史样式 |
| login.json | 3 | 标题「登录」+ 导航栏背景色 |

### pages/message（消息中心，tabBar）
| 文件 | 行数 | 职责 |
|---|---|---|
| message.js | 83 | onShow 拉全量消息；点击已读 + 按 type/bizId 前缀路由；全部已读 |
| message.wxml | 30 | 消息列表（未读高亮 + 红点）+ 空态 + 全部已读 |
| message.wxss | 78 | 消息条目样式 |
| message.json | 2 | 仅标题「消息中心」 |

### pages/purchase-create（建单，最重页面）
| 文件 | 行数 | 职责 |
|---|---|---|
| purchase-create.js | 435 | 分类/商品加载与本地过滤；数量双向编辑（`_qtyMap` 实例态）；手动商品 5 个上限；草稿回填；**自动拆单**（档案单+手动单）；requestId 幂等键与 `:c/:c2/:c3/:m` 子键 |
| purchase-create.wxml | 147 | L1 tab + 搜索 + L2 横滚 + 商品卡 + 手动商品区 + 日期 + 备注 + 底部提交 + 手动添加弹窗 |
| purchase-create.wxss | 164 | 数量控件/卡片/弹窗样式 |
| purchase-create.json | 2 | 标题「门店采购申请」 |

### pages/purchase-detail（采购单详情）
| 文件 | 行数 | 职责 |
|---|---|---|
| purchase-detail.js | 401 | onShow 重载详情；按角色生成供货商分组；11 个 `canXxx` 权限位计算；凭证上传/核销/驳回；催审；作废/申请取消；驳回单复制草稿；草稿提交审核 |
| purchase-detail.wxml | 140 | 状态卡 + 基本信息 + 商品清单（分组/平铺双分支）+ 付款核销卡 + 6 组条件底栏按钮 |
| purchase-detail.wxss | 152 | 状态卡/信息网格/供货商分组/凭证图样式 |
| purchase-detail.json | 2 | 标题「采购申请详情」 |

### pages/purchase-list（我的采购，tabBar）
| 文件 | 行数 | 职责 |
|---|---|---|
| purchase-list.js | 154 | 服务端分页（PAGE_SIZE=20）+ 服务端状态筛选 + statusCounts 计数 + 上拉加载 + 下拉刷新 + `pendingListFilter` 消费 |
| purchase-list.wxml | 46 | 筛选 tab + 列表 + 失败/空态 + FAB 新建 |
| purchase-list.wxss | 122 | 筛选栏/标签/FAB；含已废弃的 `.reject-reason` |
| purchase-list.json | 3 | 标题「我的采购」+ enablePullDownRefresh |

### pages/receive-list（待收货订单）
| 文件 | 行数 | 职责 |
|---|---|---|
| receive-list.js | 185 | 待收货订单（服务端取 100 条后本地过滤）+ 最近收货记录 5 条 + 照片预览 + 补结算/补生成报表/补价补账 |
| receive-list.wxml | 57 | 待收货列表 + 最近收货记录（含缺报表/缺价/照片/补结算入口）+ 空态 |
| receive-list.wxss | 44 | 条目样式 |
| receive-list.json | 3 | 标题「待收货订单」+ enablePullDownRefresh |

### pages/receive-verify（收货验收）
| 文件 | 行数 | 职责 |
|---|---|---|
| receive-verify.js | 276 | chef 拦截；分批收货逐项录入实收量与 3 类异常；照片最多 9 张；提交 createReceipt；**断线后回查恢复** `recoverCommittedReceipt` |
| receive-verify.wxml | 94 | 订单头（硬编码「待验收」）+ 逐项验收（已收/剩余提示）+ 照片 + 总备注 + 提交 |
| receive-verify.wxss | 145 | 验收行/勾选组/照片网格样式 |
| receive-verify.json | 2 | 标题「收货验收」 |

### pages/approval-list（待审核申请）
| 文件 | 行数 | 职责 |
|---|---|---|
| approval-list.js | 105 | 管理员角色拦截；服务端取 100 条后本地过滤 submitted/pending_approval；列表页一键通过/驳回 |
| approval-list.wxml | 36 | 列表 + 通过/驳回按钮 + 失败/空态 |
| approval-list.wxss | 70 | 条目/标签/手动徽标样式 |
| approval-list.json | 3 | 标题「待审核申请」+ enablePullDownRefresh |

### pages/approval-detail（审核详情）
| 文件 | 行数 | 职责 |
|---|---|---|
| approval-detail.js | 113 | 管理员拦截；详情加载；逐行可编辑审核数量；通过/驳回；加载失败重试 |
| approval-detail.wxml | 70 | 失败态（带重试）+ 申请信息 + 可改数量的商品清单 + 审核备注与按钮 |
| approval-detail.wxss | 80 | 信息网格/商品行/审核输入样式 |
| approval-detail.json | 2 | 标题「审核详情」 |

### pages/abnormal-list（异常记录）
| 文件 | 行数 | 职责 |
|---|---|---|
| abnormal-list.js | 110 | 全量拉异常记录 + 本地状态筛选 + 开始处理/填写结果（含付款裁决）/关闭 |
| abnormal-list.wxml | 57 | 5 个筛选 tab + 列表（类型点/状态/处理结果/按状态出按钮）+ 空态 |
| abnormal-list.wxss | 73 | 筛选栏/类型圆点（仅 4 类着色）样式 |
| abnormal-list.json | 2 | 仅标题「异常记录」，无下拉刷新 |

---

## 2. 页面清单与生命周期

| 页面 | onLoad | onShow | onUnload | 主要入站来源与参数 |
|---|---|---|---|---|
| index | 无 | requireLogin → supplier 角色 reLaunch supplier-home → 4 个云函数并发 | 无 | tabBar；login 成功后 `wx.switchTab`（login.js:101） |
| login | 无 | 每次清空 username/password | 无 | reLaunch：auth-guard / index 退出登录 / 会话 401 |
| message | 无 | requireLogin → getMessages 全量 → setData | 无 | tabBar；index 铃铛与状态卡 `wx.switchTab`（index.js:130,159） |
| purchase-create | requireLogin → 取 `options.orderId \|\| options.id` → 建 requestId → 设今天/明天 → loadReferenceData → 有草稿号则 loadExistingOrder | 无 | 无 | purchase-list FAB（无参，js:152）；purchase-detail 编辑（`?orderId=`，js:316）；purchase-detail 复制后跳转（js:350） |
| purchase-detail | requireLogin → 取 `options.id \|\| options.orderId` → 缺参仅 toast **不返回** | 有 orderId 则 loadData | 无 | index.js:170 `?id=`；purchase-list.js:138 `?id=`；message.js:66 `?id=` |
| purchase-list | requireLogin → 仅读 `options.status`（tabBar 页面实际拿不到） | 读并清空 `globalData.pendingListFilter` → reload | 无 | tabBar；index 状态卡经 `pendingListFilter` |
| receive-list | 无 | requireLogin → getPurchaseOrders(pageSize:100) + getReceipts 并发 | 无 | index 状态卡「待收货」→ purchase-list 间接；purchase-detail `goReceive`；purchase-list 直接收货 |
| receive-verify | requireLogin → chef 拦截并 navigateBack → 取 `options.orderId \|\| options.id` → getPurchaseOrderDetail → 无状态预检 → 建 items | 无 | 无 | purchase-detail `goReceive`（js:398，带 `orderId`+`storeId`）；purchase-list `goReceive`（js:146，带 `orderId`+`storeId`）；**receive-list `goVerify`（js:114）只带 `orderId`** |
| approval-list | 无 | requireLogin → 非 super_admin/purchaser 拦截并 navigateBack → getPurchaseOrders(pageSize:100) | 无 | index.wxml 管理工作台 `data-url`（index.wxml:30） |
| approval-detail | requireLogin → 非 super_admin/purchaser 拦截 → 取 `options.id \|\| options.orderId` → getPurchaseOrderDetail | **无** | 无 | approval-list `goDetail`（js:65，`?id=`） |
| abnormal-list | 无 | requireLogin → getAbnormalRecords（无参）→ 本地筛选 | 无 | index `goStatPage('abnormal')`（js:161，**死分支**）；message `readMessage` type=abnormal（js:58） |

---

## 3. 页面 → 云函数调用矩阵

### index.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| index.js:42 | getPurchaseOrders | `{role, storeId, createdBy(chef 时传 userId，否则 ''), pageSize:3}` | `data[]` → normalizePurchaseOrder → `slice(0,3)` → recentOrders |
| index.js:48 | getReports | `{role, storeId, reportType:'', relatedDate:''}` | `data[]` → normalizeReport → `slice(0,3)` |
| index.js:54 | dataService | `{action:'getMessages'}`（**无 storeId/role**） | `data[]` → `filter(!m.read).length` → 铃铛与状态卡 |
| index.js:55 | dataService | `{action:'getOrderStats', storeId}` | `data.{submitted,receivable,received,to_verify}` → 4 张状态卡 |
| index.js:139 | authService | `{action:'logout'}` | **返回值完全未检查**，无论成败都清本地态并 reLaunch |

### login.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| login.js:52 | authService | `{action:'login', username, password, expectedRole: 超管?'super_admin':selectedRole}` | `data.{user,store,supplier,sessionToken,sessionExpiresAt}` → globalData 5 字段 + 4 个 storage；`code!==0` 时按 `errorType` 分支弹「登录服务不可用」或 toast |

### message.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| message.js:15 | dataService | `{action:'getMessages'}` | `data[]` → 每条补 `time`/`timeAgo` → setData；`filter(!read).length` → unreadCount |
| message.js:38 | dataService | `{action:'markMessageRead', id}` | 成功后本地 `messages[idx].read=true`、unreadCount 递减（**先请求后改本地，非乐观更新**） |
| message.js:75 | dataService | `{action:'markAllMessagesRead'}` | 成功后本地全量置已读 |

### purchase-create.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :57 | getPurchaseOrderDetail | `{orderId: editingOrderId}` | normalizePurchaseOrder → 校验 `orderStatus==='draft'`，否则 toast 并 navigateBack → 回填 orderDate/deliveryDate/remark/manualItems + `_qtyMap` |
| :104 | dataService | `{action:'getCategories'}` | `data.{level1[], categories[]}` → 按 emoji 映射图标类名 → 修正 activeL1 |
| :126 | getProducts | `{includeInactive:false}` | `data[]` → normalizeProduct → `products` |
| :370 / :385 / :412 | createPurchaseOrder | `{storeId, storeName, orderId, orderDate, deliveryDate, createdBy, createdByName, items[], remark, orderStatus, requestId}` | `data.orderId`（回填 catalogOrderId/manualOrderId）；`data.reportWarning` 拼入成功弹窗 |

### purchase-detail.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :23 | getPurchaseOrderDetail | `{orderId}` | normalizePurchaseOrder → 11 个 canXxx；`result.data.supplier_confirmations` 直接按原始 camelCase 读 |
| :117 | cloud.getFileUrls | `order.verifyVoucherFileIds` | `[]` → voucherImages 预览 |
| :161 | dataService | `{action:'verifyManualOrder', orderId, verifyAction:'submit', voucherFileIds}` | 成功后 loadData 刷新 |
| :196 | dataService | `{action:'remindAudit', orderId}` | 仅 toast（后端 1h 限频） |
| :230 | dataService | `{action:'verifyManualOrder', orderId, verifyAction:'approve'|'reject', amount, note}` | amount 来自 `showPrompt` 的 `parseFloat`；成功后 loadData |
| :260 | dataService | `{action:'requestCancel', orderId, reason}` | 成功后 loadData |
| :288 | dataService | `{action:'cancelOrder', orderId, reason}` | 成功后 loadData |
| :336 | createPurchaseOrder | `{storeId, storeName, orderDate(今天), deliveryDate, items, remark, orderStatus:'draft', requestId}`（**无 createdBy/createdByName**） | `data.orderId` → 800ms 后 navigateTo purchase-create?orderId= |
| :372 | createPurchaseOrder | `{orderId, storeId, storeName, orderDate, deliveryDate, createdBy:createdById, createdByName:createdBy, items, remark, orderStatus:'submitted', requestId}` | 成功后 1000ms navigateBack |

### purchase-list.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :71 | getPurchaseOrders | `{role, storeId, createdBy(chef 时 userId), page, pageSize:20, orderStatus?:activeFilter}` | `data[]` → normalizePurchaseOrder → concat/替换；`result.total` → hasMore；`result.statusCounts` → 9 个 tab 计数 |

### receive-list.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :20 | getPurchaseOrders | `{role, storeId, createdBy, pageSize:100}`（**无 page**） | 本地 `filter(['approved','report_generated','partial_received'])` |
| :26 | getReceipts | `{role, storeId, page:1, pageSize:5}` | 逐字段 camelCase/snake_case 双读 → hasAbnormal / missingReports / hasMissingPrice / photoCount |
| :99 | cloud.getFileUrls | `receipt.photo_file_ids` | 全屏预览 |
| :126 | dataService | `{action:'settleReceipt', receiptId}` | 仅 toast |
| :148 | dataService | `{action:'regenerateReceiptReports', receiptId}` | toast 后 `await this.onShow()` 刷新 |
| :171 | dataService | `{action:'repriceReceipt', receiptId}` | `data.message` → toast → onShow |

### receive-verify.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :65 | getPurchaseOrderDetail | `{orderId}` | normalizePurchaseOrder → items（含 `received_total`/`remaining_qty` 原始 snake_case） |
| :17 | getPurchaseOrderDetail | `{orderId}` | 恢复路径：读 `detail.receipts[0]` 与 orderStatus |
| :199 | cloud.uploadReceiptPhotos | `(photos, orderId)` | 返回 fileID 数组（**会抛异常**） |
| :200 | createReceipt | `{purchaseOrderId, storeId, storeName, receivedBy: 显示名, overallRemark, photoFileIds, receiptDate: 本地日期, items[]}` | `data.{reportsGenerated, reportWarning, hasAbnormal, abnormalTypeNames}` → showModal 文案 |

### approval-list.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :22 | getPurchaseOrders | `{role, storeId, createdBy:'', pageSize:100}` | 本地 `filter(submitted \| pending_approval)` → 重命名字段 + 标 isManual |
| :75 | dataService | `{action:'auditOrder', orderId, status:'approved', items:[]}` | `data.reportWarning` → toast |
| :96 | dataService | `{action:'auditOrder', orderId, status:'rejected', auditRemark:'审核驳回', items:[]}` | 仅 toast |

### approval-detail.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :24 | getPurchaseOrderDetail | `{orderId}` | normalizePurchaseOrder → detail（requestedQty/approveQty 均初始化为 orderQty） |
| :79 | dataService | `{action:'auditOrder', orderId, status:'approved', items:[{itemId, approveQty}]}` | 成功后 800ms navigateBack |
| :104 | dataService | `{action:'auditOrder', orderId, status:'rejected', auditRemark, items:[]}` | 同上 |

### abnormal-list.js
| 位置 | 云函数 | 入参 | 返回值消费 |
|---|---|---|---|
| :16 | dataService | `{action:'getAbnormalRecords'}`（**无任何参数**） | `data[]` → 补 `createdAt` → 本地筛选 |
| :51 | dataService | `{action:'startAbnormal', id}` | toast 后 onShow |
| :81 | dataService | `{action:'resolveAbnormal', id, resolution, paymentDecision:'pay_received'\|'reject'}` | toast 后 onShow |
| :99 | dataService | `{action:'closeAbnormal', id}` | toast 后 onShow |

---

## 4. 前端状态与缓存

**全局（app.globalData）**：`isLoggedIn / userInfo / authToken / currentStore / supplierInfo`（+ login 写入），运行时挂 `pendingListFilter`（index.js:164 写 → purchase-list.js:34-36 读并清零，链路完整）。

**storage**：`userInfo / authToken / sessionExpiresAt / currentStore / supplierInfo`（login.js:83-99 写，index.js:146-150 与 login.js:86 清）。`account_history` 在每次登录成功后被无条件删除（login.js:86），但登录页已不渲染账号历史（login.wxml 无对应节点，login.wxss:120-196 为死样式）。

**页面本地副本（关键）**
- **purchase-create 用 `this._qtyMap`（实例属性，不在 data）维护档案商品数量**，切分类/切搜索时通过 `filterProducts` 回灌到 `displayProducts`（js:172-179），机制正确。但拆单成功档案部分后 `this._qtyMap = {}` + `filterProducts()`（js:383-384）会立即清空数量 UI——此时若手动单失败，页面提示「直接再次点击即可」，语义成立，但用户已看不到刚才选的档案商品数量，**属可预期的部分丢失**。
- **purchase-detail 无 storage 缓存，每次 onShow 全量重载**（js:16-18）→ 返回即刷新，一致性良好。
- **approval-detail 只在 onLoad 加载一次，无 onShow**（js:13）→ 两个管理员同时审核、或审核后返回该页，页面仍显示「待审核」并保留可点的通过/驳回按钮（wxml:64-67），只能靠后端拒绝兜底。
- **abnormal-list / receive-list / message / index 全部 onShow 重载**，一致。
- **receive-verify 只在 onLoad 加载，无 onShow**（js:48）：用户从「去收货」进入、提交失败返回、再进来时不会刷新，可能基于旧的 `remaining_qty` 继续填写。
- **多处各自维护同一份数据的不同投影**：index（stats + recentOrders 3 条）、purchase-list（分页全量）、receive-list（100 条过滤）、approval-list（100 条过滤）四个页面各拉一遍 getPurchaseOrders/getOrderStats，**没有共享缓存**，同一时刻不同页面看到的计数口径可能短暂不一致（例如提交后回到首页 stats 与 purchase-list tab 计数更新时点不同）。

---

## 5. 表单校验与金额/数量计算

**关键结论：整个 C 端采购动线前端从不计算金额，也不显示任何采购金额。** 建单页只有数量；详情页商品行只显示 `×数量 单位`（purchase-detail.wxml:61,78）；金额只出现在手动单凭证核销处：`¥{{detail.verifyAmount}}`（purchase-detail.wxml:100，原样渲染）与 `verifyDecide` 的 `parseFloat(input)`（js:220，仅校验 `>0`，**不做两位小数截断、不做金额上限、不做与订单规模的比例校验**）。

**数量校验对照**
| 位置 | 校验 | 缺口 |
|---|---|---|
| purchase-create.js:187 | `parseFloat \|\| 0` | 无上限、无小数位限制、接受 `1e3` 等科学计数；0 表示不选，语义正确 |
| purchase-create.js:271 | `parseFloat \|\| 1` | **输入 0 被吞成 1**，手动商品数量无法置 0，只能用 ✕ 删除 |
| purchase-create.js:246 | `!qty \|\| parseFloat(qty) <= 0` → toast | 正确 |
| approval-detail.js:73 | `!(Number(item.approveQty) > 0)` | **只有下界无上界**，不校验 `approveQty ≤ requestedQty` |
| receive-verify.js:159-162 | `< 0` 且 `> item.orderQty` | **比对的是订单量而非剩余量**（见问题清单 H1） |

**单位换算**：全程按商品自带 `unit` 字符串原样传递，前端无换算。同一商品「斤/箱/瓶」由商品档案决定，验收页照抄 `unitSnapshot`。

**四舍五入口径**：前端唯一的浮点来源是 `parseFloat`（数量、实付金额），**没有任何一处做 `toFixed` 或 `Math.round(x*100)/100`**。数量小数（0.5 斤）会原样进入后端。

**边界输入**
- 0：档案商品数量 0 = 不选（正确）；手动商品数量 0 被改写成 1（错误）；审核数量 0 被正确拦截。
- 负数：purchase-create 无负数入口（− 按钮 `Math.max(0, qty-1)`）；receive-verify 显式拦截 `<0`；approval-detail **可输入负数**（`type="digit"` 在小程序中通常不允许负号，但 `parseFloat` 层面不校验）。
- 超大值：所有数量/金额输入均无上限。
- 空格：login.js:49 `!username \|\| !password` 不 trim，`'   '` 可通过必填；approval-detail.js:95 同样不 trim，`'   '` 可通过「驳回原因必填」。

---

## 6. 交互与可用性缺陷

1. **首次进入无 loading 态**：index（4 个并发云调用，index.js:41-61）、purchase-create（`loadReferenceData` 两次串行调用，js:103-123）都只 `setData` 不给遮罩，页面上先是一片空白或空态文字。purchase-list 的 `isLoading` 在 wxml 里**没有任何对应渲染节点**（purchase-list.wxml 只有 loadFailed 与空态），首次进入同样是空白。
2. **purchase-create 提交防重入位置偏后**：`isSubmitting` 在 `util.showConfirm` **之后**才置位（js:338-341），而代码注释（js:30）自己承认「confirm 弹窗期间双击会并发创建两张订单」。目前靠 `requestId` 幂等键兜底，但 `saveDraft` 与 `submitRequest` 是两个按钮、`:draft`/`:submitted` 两个不同键，快速连点两按钮会产生两次真实建单请求。对照 receive-verify.js:187-189 先置位再弹窗的正确写法，此处应对齐。
3. **purchase-detail.submitRequest 完全无防重入**（js:356-393），其余 4 个动作都有 `_submitting` 守卫。靠 `_genRequestId('submit')` 幂等键兜底。
4. **abnormal-list 三个操作（js:47/71/95）全无防重入守卫**，双击可重复调用 startAbnormal/resolveAbnormal/closeAbnormal。
5. **空态语义混淆**：abnormal-list 筛选无结果与真正无记录共用「暂无异常记录」（js:36-44 + wxml:53-56）；approval-list `page-count` 显示 `{{list.length}}`（wxml:5）但那是筛选后的条数，标签却是「共 X 条」。
6. **加载失败兜底不统一**：purchase-list（loadFailed + 下拉重试，但**无重试按钮**，wxml:36-39）、approval-list（同）、approval-detail（有「重试」按钮，wxml:4-8，最佳）；receive-list 失败仅 toast 不留失败态；index 失败仅 toast；purchase-detail 失败仅 toast；abnormal-list 失败仅 toast 且保留旧数据。
7. **审批/收货按钮可见性**：purchase-detail 的 11 个 `canXxx` 权限位计算完整且互斥关系正确（`canSubmitVoucher` 与 `canVerify` 因 verifyStatus 互斥，`canRemindAudit` 与凭证类互斥）；但 `canReceive` 同时出现在 purchase-detail（js:71）与 purchase-list（js:123）两处，各自硬编码 `['approved','report_generated','partial_received']`，与 index 的 `statsData.receivable`、receive-list 的同一三元数组共 4 处复制，**改口径需改 4 处**。
8. **乐观更新与状态错位**：message.js 先请求后改本地（正确）；receive-list 的 `regenerateReports`/`repriceReceipt` 成功后 `await this.onShow()` 全量刷新（正确）；receive-verify 提交成功后直接跳走（正确）。**真正错位的是 approval-detail 无 onShow** 与 receive-verify 无 onShow（见第 4 节）。
9. **下拉刷新只配了 3 个页面**：abnormal-list / approval-detail / index / message / receive-verify 用户无法下拉刷新，index 与 message 只能通过切 tab 触发 onShow。
10. **照片仅存内存**：receive-verify 选完 9 张照片后若返回或切后台，照片全部丢失，需重新拍摄（js:122-138）。
11. **字数上限不一致**：purchase-create 备注 `maxlength="200"`（wxml:97），receive-verify 的「异常说明」与「总体备注」无上限（wxml:59,86），approval-detail「审核备注」无上限（wxml:62）。

---

## 7. 发现的问题

### 【阻断】
（本次勘察未发现使主业务动线整体不可用的阻断级缺陷。）

### 【高】

**H1 — 分批收货允许累计超收**
- 位置：`receive-verify/receive-verify.js:159-162`
- 描述：`invalidQty` 判定为 `item.receivedQty > item.orderQty`，比对的是**订单总量**而非剩余量。代码自己在 `:80-92` 注释「默认本批上限为剩余量」，但校验与默认值都未实现上限。
- 触发场景：某行订单 10 件，第一批已收 6 件 → 再次进入验收页（UI 会提示「已收 6，剩余 4」）→ 用户输入 10 → 校验通过 → 累计 16 件入库。
- 影响面：库存与账单超收，直接放大应付金额；后续「补结算」会以超收量出账。

**H2 — 断线恢复逻辑对分批收货订单产生假成功**
- 位置：`receive-verify/receive-verify.js:21`
- 描述：`if (detail.orderStatus !== 'received' && receipts.length === 0) return null`。分批收货场景下订单本来就有历史 receipts，且 orderStatus 可能是 `partial_received`，因此**任何** createReceipt 失败（包括后端主动拒绝）都会走恢复路径被判为成功。
- 触发场景：第二次分批收货时 createReceipt 因任何原因返回失败 → 回查详情发现已有 receipts → 直接以 `code:0, recovered:true` 呈现 → 弹窗显示「收货已提交，X 份报表已自动生成」并跳报表中心，用户认为本次收货成功，实际未落库。
- 影响面：用户失去失败反馈，收货明细缺失；`reportsGenerated: 0` 仍显示成功。

**H3 — 手动商品分类写成英文字面量**
- 位置：`purchase-create/purchase-create.js:240`（`setManualCategory` 写死 `'kitchen'/'front'`）、`:345-348`（`toPayloadItems` 用 `categoryL1List.find(c => c.id === item.categoryL1)`）
- 描述：L1 分类的真实 id 来自 `dataService getCategories`（js:104-115），js:117-119 明确处理了「activeL1 在列表里找不到就退回第一个」的情况，说明 id 值域不由前端掌控；而手动商品永远携带 `'kitchen'/'front'`，`find` 命中不了 → `catL1Name = item.categoryL1` → 提交的 `category` 字段就是英文 `'kitchen'` 或 `'front'`。wxml:127-128 的按钮文案却是中文「后厨/前厅」。
- 触发场景：任一手动商品提交 → 该行的 category 快照为 `kitchen`/`front` → 详情页 `{{item.categorySnapshot}}`（purchase-detail.wxml:58,75）显示英文单词。
- 影响面：所有手动单（即凭证核销链路的全部商品）分类数据错误；`loadExistingOrder`（js:78）用 `/前厅|front/i` 反解，能"稳定复现错误"，草稿再编辑也无法修正。

**H4 — 同一个 auditOrder 存在两套入参契约**
- 位置：`approval-list/approval-list.js:77`（`items:[]`）与 `approval-detail/approval-detail.js:81`（`items:[{itemId, approveQty}]`）
- 描述：列表页一键「通过」不传任何行级数量，详情页逐行可改并传 `approveQty`。前端侧无法判断后端把 `items:[]` 解释为「沿用原申请量」还是「审批为空」。
- 触发场景：管理员在列表页直接点「通过」一张含 5 行商品的申请 → 若后端按空数组处理，该订单审批后可能没有任何可收货行，主链路断在收货环节。
- 影响面：审批结果不可预测；列表页静默丢失「按行调整审批量」这一能力（用户不知道列表页通过不等于详情页通过）。

**H5 — 服务端取 100 条 + 本地过滤，超出即漏单**
- 位置：`receive-list/receive-list.js:24`（`pageSize:100` 后 `filter`）、`approval-list/approval-list.js:26`（同）
- 描述：两页都把状态过滤留在前端，而 purchase-list 已改为服务端下推（purchase-list.js:68-69 注释「状态过滤下推到服务端，翻页时口径一致」）。同一数据源三种口径并存。
- 触发场景：门店累计订单超过 100 条且排序以创建时间倒序 → 早期的 `submitted`/`approved` 订单不在前 100 条内 → 待审核/待收货列表漏掉它们，管理员以为无待办。
- 影响面：漏审、漏收，且无任何提示。

**H6 — 审核数量无上界，可批准远超申请量**
- 位置：`approval-detail/approval-detail.js:73`
- 描述：`invalidItem` 只校验 `Number(item.approveQty) > 0`，无 `≤ requestedQty` 校验，无小数与位数限制。
- 触发场景：管理员在「审核数量」输入框把 5 改成 500 → 通过 → 订单按 500 收货与出账。
- 影响面：金额与库存被审批动作放大 2 个数量级，无任何前端提示。

**H7 — 异常记录页零角色校验 + 跨门店可见**
- 位置：`abnormal-list/abnormal-list.js:13-18`（无角色拦截）、`:16`（`getAbnormalRecords` 不带 storeId/role）
- 描述：approval-list/approval-detail 都用 `['super_admin','purchaser']` 拦截，receive-verify 拦截 chef，而 abnormal-list 对 chef/store_manager/purchaser/super_admin 全部开放查看与操作。
- 触发场景：门店店长（甚至下单人员）进入「异常记录」→ 看到其他门店的异常 → 点「填写处理结果」→ 弹窗里选择「取消」表示"维持不可付款" → 该裁决进入补结算口径。
- 影响面：跨门店数据可见 + 付款裁决权外泄，而付款裁决直接影响补结算账单。

**H8 — 前端硬编码 `priceSnapshot: 0` 与 `payableFlag: true` 提交**
- 位置：`receive-verify/receive-verify.js:94-95`（初始化）、`:218-219`（提交）
- 描述：所有收货行都以 `priceSnapshot: 0`、`payableFlag: true` 提交，前端全链路无价格。receive-list.js:76-78 的 `hasMissingPrice` 判断（档案商品、有供应商、价格 ≤ 0）与「补价补账」入口（js:163-183）证明这条链路是"零价格落库 + 后端按协议价回填"。
- 触发场景：任一非手动行的收货 → priceSnapshot 落 0 → 依赖 `repriceReceipt` 补价才能出带价账单。
- 影响面：如果后端任何一处信任客户端 priceSnapshot，全部账单金额为 0；前端对金额完全无感，无法自查。

### 【中】

**M1 — 快速切换筛选存在请求竞争，列表与选中 tab 错位**
- `purchase-list/purchase-list.js:111-114`、`:55-109`
- 连续点「草稿」→「已收货」，两个 `loadData` 并发；后发先至时 `setData` 用先到的响应覆盖 `orders`，而 `activeFilter` 已指向第二个 tab → 用户看到「已收货」下的草稿数据。`switchFilter` 与 `onShow → reload` 之间也无请求序号守卫。

**M2 — approval-detail 无 onShow，审核页状态可长期过期**
- `approval-detail/approval-detail.js:13`（仅 onLoad）
- 两名管理员同时打开同一张申请；或 A 审批后 B 仍停留在该页 → B 的页面仍显示「待审核」并保留可点的通过/驳回按钮（wxml:64-67），点击后只能靠后端拒绝兜底，且用户看到「审核失败」无法理解原因。wxml:17 的「待审核」标签还是硬编码。

**M3 — receive-verify 不预检订单状态，标签恒为「待验收」**
- `receive-verify/receive-verify.js:73-77`（只校验 items 非空）、`receive-verify.wxml:7`（硬编码 `<view class="tag tag-warning">待验收</view>`）
- 对已 `received` 的订单再次进入该页，页面照常可填可交；wxml 标签也照常显示「待验收」。仅靠 createReceipt 后端拒绝兜底。

**M4 — 三个入口跳 receive-verify 的入参不一致**
- `receive-list/receive-list.js:114`（只传 `orderId`）vs `purchase-detail.js:398` 与 `purchase-list.js:146`（`orderId` + `storeId`）
- receive-verify.js:177 用 `order.storeId || currentStore.storeId` 兜底所以不会崩，但契约不统一：从 receive-list 进入时依赖了订单数据里的 storeId 与 globalData，任一处缺失会落到 js:179 的「门店信息缺失，请重新登录」。

**M5 — auditRemark 不 trim，纯空格可通过必填校验**
- `approval-detail/approval-detail.js:95`（`if (!this.data.auditRemark)`）、`:106`（原样提交）
- 输入三个空格 → 通过校验 → 驳回原因落库为 `'   '`，下单人看到的驳回理由为空白。purchase-detail.js:254/283 的 cancel/requestCancel 都有 `.trim()`，此处遗漏。

**M6 — 列表页驳回写死原因，无用户输入**
- `approval-list/approval-list.js:98`（`auditRemark: '审核驳回'`）
- 与详情页「驳回原因必填」的口径相反；列表页一键驳回后，申请人拿到的理由永远是固定字符串，审计不可追溯真实原因。

**M7 — 手动商品数量输入 0 被吞成 1**
- `purchase-create/purchase-create.js:271`（`parseFloat(e.detail.value) || 1`）
- 手动商品数量框输入 0 → 显示变成 1。档案商品同类输入（js:187）用 `|| 0` 表示不选，两套语义不一致，用户会以为"清零了"而实际提交了 1 件。

**M8 — 实付金额无精度与格式处理**
- `purchase-detail/purchase-detail.js:220`（`parseFloat(input)`）、`purchase-detail.wxml:100`（`¥{{detail.verifyAmount}}` 原样）
- 输入 `12.345` 原样提交；显示也不做 `toFixed(2)`，出现 `¥12.345`。与全系统无四舍五入口径叠加。

**M9 — message 已读路由用严格相等比对 id**
- `message/message.js:33`（`findIndex(m => m.id === id)`）
- `data-id="{{item.id}}"` 经 dataset 出来是字符串，若后端返回数字 id 则 `idx === -1` → 静默返回，点击无任何反应，也不报错。用户会以为消息点不动。

**M10 — 收货记录状态文案被压成二值**
- `receive-list/receive-list.js:71-72`
- `receiptStatus !== 'abnormal'` 一律显示「已收货 / success」，任何其他状态（如草稿、部分、驳回）都会被显示成「已收货」。

**M11 — abnormal-list 三个操作无防重入守卫**
- `abnormal-list/abnormal-list.js:47`、`:71`、`:95`
- 其余页面同类操作均有 `_submitting`。双击可重复提交 startAbnormal / resolveAbnormal / closeAbnormal。

**M12 — purchase-list 缺「已驳回」筛选**
- `purchase-list/purchase-list.js:86-99`
- filterTabs 覆盖 draft/submitted/receivable/partial_received/received/receipt_abnormal/cancelled，唯独没有 `rejected`。被驳回的单只能在「全部」里翻找，而「复制为新草稿」的入口在详情页（purchase-detail.wxml:110-112）——被驳回单的补救路径在列表层不可发现。

**M13 — index 退出登录不校验 authService 返回**
- `index/index.js:139-151`
- `callFunction('authService', {action:'logout'})` 的返回值被完全忽略，无论后端是否成功注销（含返回 -401 被拦截跳登录），前端都清本地态并 reLaunch。功能上影响有限，但与"会话已失效"的真实状态可能脱节。

**M14 — index 的 `goStatPage('abnormal')` 是死分支**
- `index/index.js:160-161`
- `stats` 数组只产出 `submitted / receivable / received / message / to_verify`（js:80-88），从不产出 `abnormal`，该分支永不触发。异常记录的入口实际只来自 message 页与（已删除的）快捷操作。

**M15 — index 首页 4 个并发调用无遮罩、无单项失败降级**
- `index/index.js:41-65`
- 任一 code 非 0 即整页 toast 返回，四个数据块全空。首页作为 C 端第一屏，网络抖动一次就整页空白。

**M16 — receive-verify 的 catch 把「createReceipt 失败」说成「照片上传失败」**
- `receive-verify/receive-verify.js:226-228`
- try 块同时包住 `uploadReceiptPhotos` 与 `callFunction('createReceipt')`，任一抛错都统一提示「照片上传失败，请检查网络后重试」，误导排查方向。

**M17 — purchase-create 提交确认弹窗后才置位防重入**
- `purchase-create/purchase-create.js:338-341`（对照 receive-verify.js:187-189 的正确写法）
- 靠 requestId 幂等键兜底，但 `:draft` 与 `:submitted` 是两个不同键，连点两个按钮会产生两次真实建单请求。

**M18 — approval-list / purchase-detail 的 auditOrder / createPurchaseOrder 调用未判 result 为空**
- `approval-list/approval-list.js:79,100`、`approval-detail/approval-detail.js:83,108`、`abnormal-list/abnormal-list.js:55`
- 由于 `callFunction` 保证返回对象，这里**不会**抛 TypeError（前置事实已核实）；但同一批页面中 receive-list/abnormal-list 其他位置都写了 `!result ||`，风格不一致，一旦 callFunction 实现变更会集中出错。

### 【低】

- **L1** `const app = getApp()` 声明后未使用：`approval-list/approval-list.js:74`、`:95`；`abnormal-list/abnormal-list.js:50`、`:80`、`:98`；`purchase-detail/purchase-detail.js:371`；`message/message.js:37`。
- **L2** 死样式：`login/login.wxss:120-196`（`.history-*`，账号历史已下线）、`index/index.wxss:119-176`（`.modal-*`，新增门店弹窗已删除）、`purchase-list/purchase-list.wxss:69-76`（`.reject-reason`，wxml 无对应节点）。
- **L3** `abnormal-list/abnormal-list.wxss:39-42` 只定义 `quality/shortage/delay/wrong_item` 四类的圆点颜色，`type` 值不匹配时 `type-dot` 恒为灰，异常类型视觉上不可区分。
- **L4** `purchase-list/purchase-list.js:23-29` 的 `options.status` 分支对 tabBar 页面实际不可达（tabBar 页 onLoad 拿不到深链参数），属死代码；但反过来深链构造 `?status=xxx` 也会原样下推成非法筛选值。
- **L5** `purchase-list/purchase-list.js:131` 的 `timeAgo` 只在渲染时算一次，页面停留久了不更新；`receive-list`/`approval-list` 同类。
- **L6** `message/message.js:15-17` 消息无分页全量拉取，随消息增长线性变慢；index.js:54 同样全量拉一次只为算未读数。
- **L7** `index/index.js:69,78` `messages.filter` 未防御 `data` 为非数组（后端返回对象时会抛）。
- **L8** `login/login.js:49` 账号密码不 trim，纯空格可通过必填校验。
- **L9** `login/login.js:86` 每次登录无条件删 `account_history`，与"保留上次账号"的常见预期相反（若为安全刻意设计则合理，但无注释说明）。
- **L10** `utils/util.js:101` `showPrompt` 依赖 `wx.showModal` 的 `editable`（base lib ≥ 2.17.1）。在低版本基础库上 `res.content` 恒为 undefined → 返回 `''` → purchase-detail 的「核销通过」与三个取消/作废入口的必填校验永远无法通过，按钮点了没反应。
- **L11** `receive-verify/receive-verify.wxml:59,86` 异常说明与总体备注无字数上限（purchase-create 备注是 `maxlength="200"`），`approval-detail.wxml:62` 同样无上限。
- **L12** `receive-verify/receive-verify.js:23` 恢复路径 `receipts[0]` 只取第一张收货单，分批场景下返回的 receiptId 可能不是本次那张。
- **L13** `receive-verify/receive-verify.js:81-84` 直接读原始 `item.received_total` / `item.remaining_qty`（snake_case），未走 `normalizePurchaseItem`；若后端改为 camelCase，剩余量提示会静默失效（回退到 `orderQty - 0`）。
- **L14** `purchase-detail/purchase-detail.js:103` `!['approved'].includes(verifyStatus)` 等价于 `verifyStatus !== 'approved'`，写法易误读，未来 verifyStatus 增加状态时容易漏判。
- **L15** `purchase-detail/purchase-detail.js:13` 缺参时仅 toast，不 navigateBack，用户停在一张空白详情页。

---

## 8. 与后端契约的潜在不匹配（仅前端侧观察，未读云函数实现）

1. **`orderStatus` 承载了非状态枚举值**：`purchase-list.js:69` 把 `activeFilter` 直接下推为 `orderStatus`，而 tab 值里 `receivable`、`to_verify` 不在 `utils/meta.js:1-19` 的状态表中（状态表里是 `to_receive`）。计数侧用的是 `statusCounts.receivable` / `statusCounts.toVerify`（camelCase），筛选侧用的是 `orderStatus='receivable'` / `'to_verify'`（下划线），**同一概念两套命名**。若后端按状态字面匹配，这两个 tab 会返回空列表。
2. **`createdBy` 语义在 create 与 detail 之间相反**：purchase-create.js:326 传 `createdBy: user.userId || ... || user.name`、`createdByName: user.name`；purchase-detail.js:378-379 传 `createdBy: d.createdById`、`createdByName: d.createdBy`（依赖 `normalizePurchaseOrder` cloud.js:152-153 的 `createdById || created_by || ''` 回退链）。`copyToDraft`（js:336-346）**完全不传 createdBy/createdByName**，新草稿的提交人只能靠后端从 token 补；若后端不补，详情页「提交人」一栏为空。
3. **`items` 在 auditOrder 上有两种形态**：`[]`（approval-list.js:77,98）与 `[{itemId, approveQty}]`（approval-detail.js:81）；后者也不带 `isManual` / `productName`，只能靠后端按 itemId 合并。
4. **手动商品的 `productId` 是前端造的临时 ID**：purchase-create.js:350 `productId: item.productId || item.tempId`，tempId 形如 `MANUAL_1729...`（js:248）；草稿回填时 js:80 又用 `item.productId || item.itemId` 当 tempId 回灌。整条链路依赖后端把 `MANUAL_` 前缀的字符串当 productId 存储并原样返回。
5. **`priceSnapshot` / `payableFlag` 由前端硬编码为 `0` / `true`**（receive-verify.js:218-219），金额全部依赖后端回填；`settleReceipt`、`repriceReceipt`、`resolveAbnormal(paymentDecision)` 三个后续动作的存在说明这是有意设计，但前端不提供任何校验依据。
6. **`receive-verify` 的 `storeId` 可选**：`goVerify` 三处入参不一致（见 M4），后端必须能容忍缺 `storeId` 或从 purchaseOrderId 反查。
7. **`getAbnormalRecords` 零入参**（abnormal-list.js:16），作用域完全由后端决定；`dataService getMessages`（index.js:54、message.js:15）同样零入参，跨门店/跨角色的可见范围无法从前端确认。
8. **`getPurchaseOrders` 的 `createdBy` 只在 chef 时传 userId、其他角色传空串**（index.js:45、purchase-list.js:64、receive-list.js:23、approval-list.js:25）。也就是说非 chef 角色的可见范围完全由后端按 role/storeId 收敛；而 approval-list.js:24 用 `store.storeId || ''`（无 `store.id` 回退），其他三处都是 `store.storeId || store.id || ''`——由于 `currentStore` 实际由 authService 以 `storeId` 返回，`store.id` 回退在其他页面本身是死代码，此处差异暂无实害，但口径不统一。
9. **`receive-list` 依赖后端返回 camelCase/snake_case 双字段**（receive-list.js:63-80 每个字段都做双读），说明后端 schema 存在两种命名并存；而 `receive-verify` 只读 snake_case（见 L13），两页对同一数据源的字段命名假设不同。
10. **异常类型的字符串值域**：abnormal-list.wxss:39-42 假定 `type ∈ {quality, shortage, delay, wrong_item}`，而 receive-verify 提交的异常标记是 `isShortage / isQualityIssue / isWrongItem` 三个布尔（js:220-222）。`isQualityIssue` → `quality`、`isWrongItem` → `wrong_item` 的映射关系完全在后端，前端无任何对照，一旦后端新增类型或改名，前端圆点与文案都会静默错。

---

## 9. 未确认的业务模糊点

1. **零价格下单是否是刻意设计**：前端从不提交、从不显示任何采购金额，`priceSnapshot` 恒为 0、`payableFlag` 恒为 true，账单金额全靠后端按协议价回填（receive-verify.js:94-95,218-219），receive-list 的「缺价待补/补价补账」入口（js:162-183）进一步印证。需要确认：这是"下单只锁量、价格后置"的刻意流程，还是历史遗留？若刻意，C 端缺少任何金额预览意味着下单人对订单规模无感知。
2. **超收是否合法**：`receivedQty` 只校验 `≤ orderQty`（receive-verify.js:161），UI 却展示"剩余量"（wxml:25-27）。P1-17 注释声称"默认本批上限为剩余量"但代码没实现上限。手动单"少货是常态"（purchase-detail.js:91-92 注释），那么超收在业务上是否允许？若允许，累计量的校验责任在后端哪一层？
3. **异常处理的付款裁决交互**：abnormal-list.js:78-79 用 `showConfirm` 的「取消」按钮表示"维持不可付款"，`paymentDecision='reject'`。取消=一个正式业务动作而非放弃操作，且没有第三条"放弃本次处理"的路径；用户误点取消会直接提交 `reject`。命名上 `reject` 也与"驳回"混用。需要确认这是预期交互还是临时权宜。
4. **列表页一键通过是否应允许跳过逐行核量**：approval-list.js:77 传 `items:[]`，approval-detail.js:81 传逐行 `approveQty`。两条路径语义不同（前者按原申请量、后者可调整），但列表页 UI 上没有任何提示"此处通过不调整数量"。需要确认这是否为产品有意简化。
5. **角色权限矩阵在采购动线上不一致**：approval 两页只放 super_admin/purchaser；receive-verify 拦 chef；purchase-detail 的 `canReceive` 排除 chef 但放行 store_manager；而 abnormal-list 对所有角色完全开放（含 chef）。异常记录页既能看跨门店数据又能裁决付款，需要确认是否刻意为之。
6. **验收异常三勾选与实收数量的关系**：少货/质量问题/错货三个勾选（receive-verify.wxml:42-53）与实收数量无联动——勾选"少货"时实收数量仍可为满额，勾选"错货"时仍可提交实收量。业务上错货是否意味着该行不应计入实收？
7. **日期口径**：`orderDate` 的 picker 无 `start` 限制（purchase-create.wxml:81），可任意选历史日期；`deliveryDate` 仅 `start="{{today}}"`（wxml:87），无上限。补录入历史订单是否是预期场景？`receiptDate` 则用本地日期避免 UTC 归档偏差（receive-verify.js:207-208），说明日期口径已被踩过坑，但下单侧未同步处理。
8. **手动商品 5 个上限与拆单**：每单手动商品上限 5（purchase-create.js:224），而档案/手动商品混合会自动拆成两张单（js:362-401）。用户视角一次提交产生两张单号，需要确认用户是否能理解"手动单金额待凭证核销"这条独立流程（仅在成功弹窗里出现一次，js:426）。

---

## 10. 覆盖率声明

- **实际读取：44 / 44 个文件，无遗漏，无抽样**。合计 4332 行（index 469、login 375、message 193、purchase-create 748、purchase-detail 695、purchase-list 325、receive-list 289、receive-verify 517、approval-list 214、approval-detail 265、abnormal-list 242）。
- 每个 .js 与 .wxml 逐行读完；每个 .wxss 逐行读完（纯样式，已核对其中 3 处死样式）；每个 .json 逐行读完（用于确认 `enablePullDownRefresh` 与导航栏配置）。
- 为核实契约与调用行为，额外读取（不计入 44）：`utils/cloud.js`、`utils/util.js`、`utils/meta.js`、`utils/auth-guard.js`、`app.json`。
- **未读取**：`cloudfunctions/` 下任何云函数实现、`docs/exploration/` 下既有报告、其余页面（account、store-switch、store-manage、report-list、report-detail、product-manage、supplier-manage、price-manage、report-history、user-manage、supplier-*）。第 8 节所有条目均明确限定为"前端侧观察"，未通过云函数实现做推断。
