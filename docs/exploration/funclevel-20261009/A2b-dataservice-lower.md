# A2b · dataService 下半段（638–1692 行）· 函数级清单

## 0. 范围与方法

- 目标文件：`E:\酒店采购管理0804\17-12\cloudfunctions\dataService\index.js`
- 实读区间：**638–1692 行**，分 3 段读取（638–907 / 906–1265 / 1266–1693），无跳读。文件实际末行为 1693（空行），`exports.main` 的 `switch` 结束于 1687、总 `catch` 结束于 1691、`}` 在 1692。
- **不含 1–637 行**，该段见同批 A2a 报告。本段为了解上下文额外只读了：1–60 行（角色常量、`getSessionUser`、`requireUser`）、190–227 行（`createMessage` / `getStoreManagerId`）、355–380 行（`csvField` / `safePathPart` / `getNextVersion` 头部），仅用于确认契约，不重复审计。
- 前端调用点用 Grep 在 `**/*.js` 全仓检索 `action: '<name>'`，命中集合见第 1 节；另对 `cancel_requested`、`verify_status`、`read_at`、`abnormal_id` 做了全仓/全函数检索以支撑负结论。
- 全部返回形状均为**顶层扁平 `{code, msg, data?}`**。本段所有 `requireUser` 失败都经 A2a 核实的 33 处 `if (auth.error) return auth.error` 解嵌套，`utils/cloud.js:68` 的 `if (result.code === -401)` 拦截可正常命中。本段**未发现**任何嵌套 `{error:{code,msg}}` 的产出点。

---

## 1. 本段 action 分发表

switch 段（1670–1685）共 16 个 case，另有 `publicMessage`（638）为纯函数辅助器、`exports.main` 兜底 `default: { code:-1, msg:'不支持的数据操作' }`（1686）与总 catch `{ code:-1, msg:'CloudBase 数据操作失败，请稍后重试' }`（1690）。

| event.action | 处理函数 | 行号 | `requireUser` 角色白名单原文 | 前端调用点 |
|---|---|---|---|---|
| getMessages | `getMessages` | 651–680 | 无白名单（`requireUser(event)`） | `pages/index/index.js:54`、`pages/message/message.js:16`、`pages/supplier-messages/supplier-messages.js:24`、`pages/supplier-home/supplier-home.js:53` |
| markMessageRead | `markMessageRead` | 682–702 | 无白名单 | `pages/message/message.js:39`、`pages/supplier-messages/supplier-messages.js:44` |
| markAllMessagesRead | `markAllMessagesRead` | 704–720 | 无白名单 | `pages/message/message.js:76`、`pages/supplier-messages/supplier-messages.js:60` |
| getAbnormalRecords | `getAbnormalRecords` | 736–771 | 无白名单 | `pages/abnormal-list/abnormal-list.js:17` |
| startAbnormal | `startAbnormal` | 773–787 | `['store_manager', 'purchaser', 'super_admin']` | `pages/abnormal-list/abnormal-list.js:52` |
| resolveAbnormal | `resolveAbnormal` | 789–839 | `['store_manager', 'purchaser', 'super_admin']` | `pages/abnormal-list/abnormal-list.js:82` |
| closeAbnormal | `closeAbnormal` | 841–863 | `['store_manager', 'purchaser', 'super_admin']` | `pages/abnormal-list/abnormal-list.js:100` |
| getOrderStats | `getOrderStats` | 866–904 | 无白名单 | `pages/index/index.js:55` |
| settleReceipt | `settleReceipt` | 909–1052 | `GLOBAL_ROLES`（= `['super_admin','purchaser']`，dataService:8） | `pages/receive-list/receive-list.js:127` |
| regenerateOrderReports | `regenerateOrderReports` | 1058–1093 | `GLOBAL_ROLES` | **0 个**（见第 6 节，证据见下） |
| repriceReceipt | `repriceReceipt` | 1105–1173 | `GLOBAL_ROLES` | `pages/receive-list/receive-list.js:172` |
| regenerateReceiptReports | `regenerateReceiptReports` | 1175–1342 | `GLOBAL_ROLES` | `pages/receive-list/receive-list.js:149`（另被 `repriceReceipt:1163` 内部同步调用） |
| cancelOrder | `cancelOrder` | 1349–1436 | `GLOBAL_ROLES` | `pages/purchase-detail/purchase-detail.js:289` |
| requestCancel | `requestCancel` | 1439–1486 | `GLOBAL_ROLES` | `pages/purchase-detail/purchase-detail.js:261` |
| remindAudit | `remindAudit` | 1489–1550 | `['chef', 'store_manager', 'purchaser', 'super_admin']` | `pages/purchase-detail/purchase-detail.js:197` |
| verifyManualOrder | `verifyManualOrder` | 1556–1659 | `action === 'submit' ? VOUCHER_SUBMIT_ROLES : GLOBAL_ROLES` | `pages/purchase-detail/purchase-detail.js:162`（submit）、`:231`（approve/reject） |

**常量抄录**（1–11 行，供本段引用）：
```js
const GLOBAL_ROLES = ['super_admin', 'purchaser']                      // :8
const MANAGEMENT_ROLES = ['super_admin', 'purchaser']                   // :9
const VOUCHER_SUBMIT_ROLES = ['super_admin', 'purchaser', 'store_manager']  // :11
```
`requireUser(event, roles)`（52–59）语义：会话缺失/过期 → `{ error: { code:-401, msg:'登录已过期，请重新登录' } }`；角色不在白名单 → `{ error: { code:-403, msg:'当前账号无权执行该操作' } }`；成功 → `{ user }`。**本段所有函数都在 `requireUser` 返回后第一行 `if (auth.error) return auth.error` 解嵌套**，因此前端拿到的是扁平 `-401/-403`。

**`regenerateOrderReports` 的 0 调用点证据**：全仓 `Grep glob="**/*.js" pattern="action: '(…|regenerateOrderReports|…)'"` 命中 13 个前端文件，命中列表不含任何页面调用 `regenerateOrderReports`；仅 `cloudfunctions/dataService/index.js` 自身命中（定义与 switch case）。函数体内亦无其它函数调用它（本段 16 个 handler 内无交叉调用，唯一内部调用是 `repriceReceipt:1163 → regenerateReceiptReports`）。与主代理结论一致，此处仅记录它的契约与影响（第 3 节）。

---

## 2. 集合与字段写入矩阵（本段范围）

### `message` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:697-699` update | markMessageRead | `read_by`（`_.push(userId)`）、`read_at`（`db.serverDate()`） |
| `:715-717` update | markAllMessagesRead | `read_by`（`_.push(userId)`）、`read_at` |
| `:196-211` add（`createMessage`，本段 5 个调用点） | resolveAbnormal:817 / :831、cancelOrder:1427、requestCancel:1478、remindAudit:1530 | `message_id`、`type`、`title`、`content`、`biz_id`、`recipient_user_id`、`store_id`、`scope_type`、`scope_id`、`read:false`、`read_by:[]`、`created_at` |

本段 `createMessage` 的 5 个调用**均未传** `scopeType`/`scopeId`，故本段不产生任何供货商定向消息；`resolveAbnormal:817` 是唯一带 `recipientUserId` 的（=`getStoreManagerId(record.store_id)`，`:825`），`:831` 不带 recipient，落到门店广播。
**`read_at`（698/716）全仓无任何读取点**——证据：`Grep glob="**/*.js" pattern="read_at"` 仅命中 698、716 两处写入，`publicMessage`(638–649) 也不回传该字段。属死写。

### `abnormal_record` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:783-785` update | startAbnormal | `status:'processing'`、`handled_by`、`updated_at` |
| `:807-816` update | resolveAbnormal | `status:'resolved'`、`resolution`、`payment_decision`、`resolved_by`、`resolved_at`、`updated_at` |
| `:854-860` update | closeAbnormal | `status:'closed'`、`closed_by`、`closed_at`、`updated_at` |
| `:1152-1158` update | repriceReceipt | `status:'resolved'`、`resolution`、`handled_by`、`updated_at`（**无** `resolved_by`/`resolved_at`/`payment_decision`） |
| `:920-923` read only | settleReceipt | — |

### `receipt_item` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:967-969` update | settleReceipt | `payable_flag:true`、`updated_at` |
| `:1137-1139` update | repriceReceipt | `price_snapshot`、`payable_flag:true`、`updated_at` |

### `receipt` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:942-944` 条件 update（并发锁抢占） | settleReceipt | `settle_lock:true`、`settle_lock_at:Date.now()`、`updated_at` |
| `:1045-1047` update（`finally` 释放锁） | settleReceipt | `settle_lock:false`、`settle_lock_at:null`、`updated_at` |

本段无其它 `receipt` 写入，**不改** `receipt_status`、不关闭异常记录。

### `report_file` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:1029-1038` add | settleReceipt | `report_id:'RPT_SURP_'+sid+'_'+receiptId+'_S'`、`report_type:'supplier_receipt_price_report'`、`report_scope:'supplier'`、`scope_id`、`scope_name`、`related_date`、`source_order_id`、`basis_date_type:'receipt_date'`、`file_name`、`file_url`、`file_version`、`generated_at`、`generated_by_system:true`、`status:'generated'`、`settle_for_receipt`、`settle_type:'increment'` |
| `:1230-1239` add（③） | regenerateReceiptReports | `report_id:'RPT_SR_'+receiptId+'_RG'`、`report_type:'store_receipt_report'`、`report_scope:'store'`、`scope_id`、`scope_name`、`related_date`、`source_order_id`、`basis_date_type`、`file_name`、`file_url`、`file_version`、`generated_at`、`generated_by_system:true`、`status:'generated'`、`has_abnormal`、`regenerated:true` |
| `:1257-1266` add（④） | regenerateReceiptReports | `report_id:'RPT_SRP_'+receiptId+'_RG'`、`report_type:'store_receipt_price_report'`、…同上…、`excluded_rows`、`regenerated:true` |
| `:1290-1299` add（⑤） | regenerateReceiptReports | `report_id:'RPT_SUR_'+sid+'_'+receiptId+'_RG'`、`report_type:'supplier_receipt_report'`、`report_scope:'supplier'`、…同上…、`has_abnormal`、`regenerated:true` |
| `:1317-1325` add（⑥） | regenerateReceiptReports | `report_id:'RPT_SURP_'+sid+'_'+receiptId+'_RG'`、`report_type:'supplier_receipt_price_report'`、`report_scope:'supplier'`、…同上…、`excluded_rows`、`regenerated:true` |
| `:1414-1416` update（事务内逐条） | cancelOrder | `status:'superseded'`、`updated_at` |

`regenerateOrderReports` 本身不直接写 `report_file`，经 `:1085 → regenerateApprovedOrderReports`（定义于 401 行，属 A2a 范围）间接写入 ①`store_order_report`（report_id `RPT_SO_{orderNo}_A`，见 447 行）与 ②供应商订货汇总。

### `purchase_order` 集合
| 写入点 | 触发的函数 | 字段 |
|---|---|---|
| `:1088-1090` 条件 update | regenerateOrderReports | `missing_reports:false`、`updated_at`（where：`{purchase_order_id, missing_reports:true}`） |
| `:1337-1339` 条件 update | regenerateReceiptReports | `missing_reports:false`、`updated_at`（同上 where，仅 `purchaseOrderId` 非空时） |
| `:1407` update（事务内） | cancelOrder | `order_status:'cancelled'`、`supplier_confirmations:{}`、`cancel_reason`、`cancelled_by`、`cancelled_at`、`updated_at`；手动单追加 `verify_status:'none'`、`verify_cancel_note` |
| `:1465-1473` 条件 update | requestCancel | `cancel_requested:true`、`cancel_requested_by`、`cancel_request_reason`、`cancel_requested_at`、`updated_at`（where：`{_id, cancel_requested:_.neq(true)}`） |
| `:1525` 条件 update | remindAudit | `audit_reminded_at`、`updated_at`（where 含 `$or`，见 3 节） |
| `:1541-1543` update（失败回退） | remindAudit | `audit_reminded_at`（回写旧值或 `null`）、`updated_at` |
| `:1595-1604` 条件 update | verifyManualOrder·submit | `verify_status:'pending'`、`verify_voucher_file_ids`、`verify_note`、`verify_submitted_by`、`verify_submitted_at`、`updated_at`（where：`{_id, verify_status:_.neq('approved')}`） |
| `:1633-1636` 条件 update | verifyManualOrder·reject | `verify_status:'rejected'`、`verify_reject_note`、`updated_at`（where：`{_id, verify_status:'pending'}`） |
| `:1645-1653` 条件 update | verifyManualOrder·approve | `verify_status:'approved'`、`verify_amount`、`verify_note`、`verified_by`、`verified_at`、`updated_at`（where：`{_id, verify_status:'pending'}`） |

### `report_version_counter` 集合（经 `getNextVersion`，定义 368 行）
本段调用点：settleReceipt:1014（每供应商 1 次）、regenerateReceiptReports:1222 / :1245 / :1282 / :1305。写入 `count`、`updated_at`，CAS 语义见 368–380 行（读旧值 → `.where({_id, count:current})` 条件 +1 → `updated===1` 才算抢到，最多 5 次重试）。

### 云存储（非集合）
- `cloud.uploadFile`：settleReceipt:1028（`reports/supplier/{date}/supplier-receipt-price-{name}-{date}-{rid}-settle-v{n}.csv`）、regenerateReceiptReports:1229 / :1256 / :1289 / :1316。均以 BOM（`String.fromCharCode(0xFEFF)`）+ UTF-8 Buffer 上传。
- `cloud.deleteFile`：verifyManualOrder:1617，清理被替换的旧凭证（`vouchers/{orderId}/` 前缀内、且不在新列表中的 fileID）。

---

## 3. 函数清单

### `publicMessage(message)` (行 638–649)
- **职责**：把 `message` 集合原始文档映射为前端展示结构。
- **入参**：单个消息文档对象（非 event）。无校验。
- **返回**：`{ id, messageId, type, title, content, bizId, read, time }`。`bizId` 空值兜底 `''`，`read` 布尔化。
- **副作用**：无。
- **权限**：不适用。
- **幂等**：纯函数。
- **调用点**：`getMessages:677`。
- **契约风险**：不回传 `read_at`，而 `markMessageRead`/`markAllMessagesRead` 写了它（698/716）——写入即永无消费（见第 6 节）。

### `getMessages(event)` (行 651–680)
- **职责**：按角色口径返回当前用户可见的最新消息列表。
- **入参**：仅 `event.authToken`。其余字段无。
- **返回**：成功 `{ code:0, data: list }`，`list[i]` 为 `publicMessage` 结构且 `read` 已合并 `read_by` 命中。失败为 `-401/-403`（顶层扁平）。
- **副作用**：只读。
- **权限**：无白名单。可见范围**由服务端会话派生**，前端不参与：
  - 收信人条件（656–660）：`recipient_user_id` 为 `''` / 等于本人 user_id / 字段不存在，三者 OR。
  - `role === 'supplier'`（662–664）：追加 `{ scope_type:'supplier', scope_id: auth.user.default_supplier_id || '' }`，**不绑门店**。
  - 非全局且非供货商（665–672，即 `chef`/`store_manager`）：追加 `store_id` 为 `''`/等于本人 default_store_id/字段不存在的 OR。
  - `GLOBAL_ROLES`（super_admin/purchaser）：不加任何范围条件，全量可见。
  - 排序 `created_at desc`，`limit(100)`（673）。
- **幂等**：只读，天然幂等。
- **调用点**：`index.js:54`、`message.js:16`、`supplier-messages.js:24`、`supplier-home.js:53`，全部**只传 action**，不传任何过滤参数；`message.js:27` / `supplier-messages.js:34` 期望 `data` 数组且用 `m.read` 计未读、`m.id`/`m.time`/`m.bizId` 做交互。
- **契约风险**：`limit(100)` 硬上限，无分页；超出 100 条时老消息静默不可见。供货商分支依赖 `auth.user.default_supplier_id`，该字段是否为空未在本段验证（未验证 #5）。

### `markMessageRead(event)` (行 682–702)
- **职责**：把单条消息记入当前用户的已读数组。
- **入参**：`event.id`（必填，缺失 → `-1 '消息信息缺失'` :685）；`authToken`。
- **返回**：成功 `{ code:0 }`；`-1 '消息信息缺失'`、`-1 '消息不存在'`（:688，`message.doc(id).get()` 取回空）、`-403 '无权操作该消息'`（:692）、`-401/-403` 鉴权。
- **副作用**：`message.read_by` += userId、`message.read_at` = serverDate()（仅当 `read_by` 尚未含该用户，:696 去重）。**不写** `read` 布尔。
- **权限**：无白名单。可见/可改校验在 689–692：
  - `belongsToUser`（690）：`!message.recipient_user_id || recipient_user_id === 本人user_id`。
  - `belongsToStore`（691）：`isGlobal || !message.store_id || message.store_id === 本人default_store_id`。
  - 注意 **`belongsToStore` 对供货商无 `scope_type/scope_id` 分支**，与 `getMessages:662-664` 的口径不一致。
- **幂等**：`read_by` 去重（696）保证重复点击不重复推入，但仍会刷新 `read_at`。
- **调用点**：`message.js:39`、`supplier-messages.js:44`，均只传 `{ action, id }`，`id` 来自列表项 `m.id`（= 文档 `_id`）。
- **契约风险**：供货商可越界标记已读——`getMessages` 对供货商按 `scope_type='supplier'` 定向过滤，但 `markMessageRead` 的门店条件只看 `message.store_id`。凡 `store_id` 为 `''` 的门店广播消息，任何供货商调用 `belongsToStore` 均命中 `!message.store_id` 分支为 true，`belongsToUser` 也命中 `!recipient_user_id`，因此**任何供货商都能把任意门店广播消息 push 进自己的 read_by**（:697）。仅污染 `read_by` 数组、不返回消息内容，危害低但属口径不一致。另外 `id` 直接用作 `doc(event.id)`，无 store/scope 二次校验，越权写入面就是上面这条。

### `markAllMessagesRead(event)` (行 704–720)
- **职责**：把当前用户可见的全部未读消息逐条标记已读。
- **入参**：仅 `authToken`。
- **返回**：`{ code:0 }`；若 `getMessages` 返回非 0 则原样透传（:709）。
- **副作用**：对每条未读、且 `read_by` 未含本人的消息执行 `message.read_by` += userId、`read_at`（:715-717）。N+1 次 `doc().get()` + `doc().update()`，最多 100 轮。
- **权限**：无白名单；可见范围完全继承 `getMessages`（:708 复用）。
- **幂等**：靠 :711 `filter(item => !item.read)` + :714 `readBy.includes(userId)` 双重去重。
- **调用点**：`message.js:76`、`supplier-messages.js:60`，均只传 action；调用方期望 `code===0` 后本地把 `unreadCount` 置 0（`message.js:79-81`）。
- **契约风险**：未读判定用的是 `getMessages` 已合并 `read` 布尔的结果（:710 注释也自陈），随后又逐条回读原始 `read_by` 去重；若两次读取之间另有用户已读，本函数会 `continue` 跳过，最终返回 `code:0` 但**部分消息实际未写**，前端却把 `unreadCount` 强制置 0（`message.js:80`），存在短暂的界面/数据不一致。

### `getAbnormalRecords(event)` (行 736–771)
- **职责**：列出异常记录并补齐供应商名与中文枚举名。
- **入参**：可选 `event.status`（用于服务端过滤）；`authToken`。
- **返回**：`{ code:0, data: list }`，每项 `{ id, abnormalId, type, typeName, description, supplierName, storeName, status, statusName, createdAt, resolution }`。
- **副作用**：只读（`abnormal_record`、`supplier`）。供应商按每 20 个 ID 分块查询（752–756）。
- **权限**：无白名单。范围控制：`chef` 直接返回 `{ code:0, data: [] }`（:739，硬编码短路）；非全局角色加 `store_id = auth.user.default_store_id`（:742）；`GLOBAL_ROLES` 不加门店条件。**`event.storeId` 被完全忽略**——全局角色无法按门店筛选。
- **幂等**：只读。
- **调用点**：`abnormal-list.js:17`，**只传 action，不传 status**；前端在 37–44 行用 `activeFilter` 在**内存**里二次过滤 `status`。因此 :743 的 `event.status` 服务端过滤在当前唯一调用点上从未被使用。
- **契约风险**：`limit(100)` 无分页（:747）；`event.status` 入参在前端实际未被使用（dead 入参，见第 6 节）。枚举字典 `ABNORMAL_TYPE_NAMES`（722–728）含 `missing_price`，若异常库中存在字典外 type，前端拿到裸英文（761 兜底 `|| item.type`）。

### `startAbnormal(event)` (行 773–787)
- **职责**：`pending → processing`。
- **入参**：`event.id`（缺失 → `-1 '异常记录信息缺失'` :776）。
- **返回**：`{ code:0 }`；`-1 '异常记录信息缺失'`、`-1 '异常记录不存在'`（:778）、`-403 '当前账号无权处理该门店异常'`（:780）、`-1 '该异常已进入处理流程'`（:782）。
- **副作用**：`abnormal_record.status='processing'`、`handled_by=auth.user.name`、`updated_at`。
- **权限**：`['store_manager','purchaser','super_admin']`；:779 门店归属校验（非全局且 `store_id !== default_store_id` → -403）。
- **幂等 / 并发**：**无条件 `doc().update()`，无 CAS**——状态前置条件用读后判断（:782），并发下两个用户可重复写入 `processing`（幂等结果相同，`handled_by` 后被覆盖，影响小）。
- **调用点**：`abnormal-list.js:52`，传 `{ id }`。
- **契约风险**：无 CAS（同上）；无通知。

### `resolveAbnormal(event)` (行 789–839)
- **职责**：`processing → resolved`，同时裁决异常行是否转回可付款，并发两条消息。
- **入参**：`event.id`（:792 缺失 → `-1 '异常记录信息缺失'`）；`event.resolution`（String trim 后空 → `-1 '请填写处理结果'` :793-794）；`event.paymentDecision`（:805 仅在 `['pay_received','reject']` 内取原值，否则 `''`，**不报错**）。
- **返回**：`{ code:0 }`；`-1 '异常记录信息缺失'`、`-1 '请填写处理结果'`、`-1 '异常记录不存在'`（:798）、`-403 '当前账号无权处理该门店异常'`（:800）、`-1 '只有处理中异常才能标记为已解决'`（:802）。
- **副作用**：
  - `abnormal_record.status='resolved'`、`resolution`、`payment_decision`、`resolved_by`、`resolved_at`、`updated_at`（:807-816）。
  - 消息 1（:817-827）：`type:'abnormal'`、`title:'异常已解决'`，`recipientUserId = await getStoreManagerId(record.store_id)`、`storeId = record.store_id`，`bizId = record.abnormal_id || event.id`；文案按 `paymentDecision==='pay_received'` 分两版。
  - 消息 2（:831-837）：`type:'abnormal'`、`title:'待补结算提醒'`，**无 recipient → 门店广播**，`bizId = record.receipt_id || record.abnormal_id || event.id`，`storeId = record.store_id`。
  - **不改 `payable_flag`**——转回可付款的实际写入发生在 `settleReceipt:967-969`，本函数只留下 `payment_decision` 裁决。
- **权限**：`['store_manager','purchaser','super_admin']` + :799 门店归属校验。
- **幂等 / 并发**：无条件 `doc().update()`（:807），前置状态靠读后判断（:802），**无 CAS**；重复调用会把 `resolved_at` 刷成当前时间并重复发 2 条消息（无去重）。
- **调用点**：`abnormal-list.js:82`，传 `{ id, resolution, paymentDecision }`；`paymentDecision` 由 :79 的确认弹窗决定（确认 → `'pay_received'`，取消 → `'reject'`）。
- **契约风险**：无 CAS + 重复发消息；`paymentDecision` 非法值静默降级为 `''` 而非报错（对调用方是"取消"语义，前端正好只传两个合法值，当前不触发）。

### `closeAbnormal(event)` (行 841–863)
- **职责**：`resolved → closed`。
- **入参**：`event.id`（:844 → `-1 '异常记录信息缺失'`）。
- **返回**：`{ code:0 }`；`-1 '异常记录信息缺失'`、`-1 '异常记录不存在'`（:848）、`-403 '当前账号无权处理该门店异常'`（:850）、`-1 '只有已解决异常才能关闭'`（:852）。
- **副作用**：`abnormal_record.status='closed'`、`closed_by`、`closed_at`、`updated_at`。**不发消息、不通知**。
- **权限**：`['store_manager','purchaser','super_admin']` + :849 门店归属校验。
- **幂等 / 并发**：无条件 update，无 CAS。
- **调用点**：`abnormal-list.js:100`，传 `{ id }`；调用方 :96 的确认文案是"关闭后不可继续处理"。
- **契约风险**：无 CAS；`closed` 为无出口终态（见第 4 节），且没有任何校验阻止"未补结算就关闭"——`closeAbnormal` 不检查 `payment_decision` 或是否已补结算，关闭后再也无法由 `settleReceipt:953` 捞取（`status !== 'closed'` 条件把它排除）。

### `getOrderStats(event)` (行 866–904)
- **职责**：首页 4 张状态卡的服务端聚合计数。
- **入参**：可选 `event.storeId`（仅 `GLOBAL_ROLES` 生效，:879）。
- **返回**：`{ code:0, data:{ submitted, receivable, received, to_verify } }`。
- **副作用**：只读 `purchase_order`，4 个 `count()` 用 `Promise.all` 并发（:886-894）。
- **权限**：无白名单，但内部按角色构造查询，未命中任一分支返回 `-403 '当前账号无权查看采购订单'`（:881）；`chef`/`store_manager` 未关联门店返回 `-403 '账号未关联有效门店'`（:872/:876）。`chef` 额外加 `created_by = user_id`（:874）只看自己的单。
- **幂等**：只读。
- **调用点**：`index.js:55`，传 `{ action, storeId }`；调用方 :72-77 读 `submitted/receivable/received/to_verify`，:78 的未读数来自 `getMessages` 而非本函数。
- **契约风险**：
  - `receivableStatuses = ['approved','report_generated','partial_received']`（:883）**不含 `receipt_abnormal`**，而 `receivedQuery` 只匹配 `order_status:'received'`（:885）。因此处于 `receipt_abnormal` 的订单在首页**既不计入"待收货"也不计入"已完成"**（`receipt_abnormal` 是 `cancelOrder:1364` 明确识别的合法状态之一，属真实存在的状态值）。
  - `to_verify`（:892）只按 `verify_status:'pending'` 计数，未加 `is_manual:true`。当前不会多算——`verify_status='pending'` 在本段唯一写入点 `verifyManualOrder:1597`，且 :1576 已在前置排除非手动单；但若未来其它函数写入该字段则会失真。

### `settleReceipt(event)` (行 909–1052) —— 重点
- **职责**：异常全部处理完成后，为"因 `pay_received` 裁决而解锁"的明细行**增量**生成供应商带价账单。
- **入参**：`event.receiptId`（String trim，空 → `-1 '缺少收货单号'` :912-913）。
- **返回**：成功 `{ code:0, data:{ generatedSuppliers, count } }`；失败 `-1` 逐个：
  - `'缺少收货单号'`（:913）、`'收货单不存在'`（:917）、`'尚有未处理完成的异常，无法补结算'`（:925，存在 `status` 为 `pending`/`processing` 的异常）、`'该收货单已补结算，请勿重复操作'`（:933，已有 `report_id` 以 `{receiptId}_S` 结尾的记录）、`'补结算正在处理中，请勿重复操作'`（:946，抢锁失败）、`'没有因异常处理解锁的明细行，无需补结算'`（:974）、`'无可结算的明细行'`（:985）。全部为**顶层扁平**。
- **副作用**（逐项）：
  - `receipt`：抢锁写 `settle_lock:true` + `settle_lock_at`（:942-944）；`finally` 释放 `settle_lock:false` + `settle_lock_at:null`（:1045-1047，释放失败仅 `console.error` :1049，不影响返回）。
  - `receipt_item`：**只对本次解锁行**写 `payable_flag:true` + `updated_at`（:967-969）。
  - `report_file`：每个供应商新增一条 `supplier_receipt_price_report`（:1029-1038），`report_id` 带 `_S` 后缀，`settle_for_receipt`、`settle_type:'increment'`。
  - 云存储：每供应商上传 1 份 CSV（:1028）。
  - **不写 `abnormal_record` 任何字段，不写 `receipt` 状态字段**。
- **权限**：`GLOBAL_ROLES`。**不按 `store_id` 限制**——全局角色可补结算任意门店收货单（设计意图：管理员集中结算）。调用者身份由会话派生，前端不传身份。
- **幂等 / 并发控制**：三层，是本段最完整的一个
  1. `report_file` 幂等检查（:928-934）：已有 `{receiptId}_S` 记录直接拒绝；
  2. 条件更新抢锁（:939-947）：`.where(_.or([{_id, settle_lock:_.neq(true)}, {_id, settle_lock_at:_.lt(staleCutoff)}]))` 更新 `updated===0` 即视为被占用；`staleCutoff = Date.now() - 10*60*1000`（:938），锁超 10 分钟视为崩溃残留可被接管；
  3. `finally` 无条件释放锁（:1042-1051），失败可重发，成功后由第 1 层兜底。
  - 注意锁是**普通条件更新，不是 `db.runTransaction`**，跨集合（receipt / receipt_item / report_file）非原子。
- **调用点**：`receive-list.js:127`，只传 `{ action:'settleReceipt', receiptId }`；:132-136 仅判断 `code===0` 并提示成功，**不读取 `data.generatedSuppliers/count`**。
- **如何改写异常记录状态与付款标记（重点回答）**：**不触碰 `abnormal_record`**。它只读异常记录（:920-923）用于两道门禁：① `pending/processing` 存在即拒绝（:924-925）；② 取 `status !== 'closed' && payment_decision === 'pay_received'` 的记录作为解锁依据（:953）。真正改 `payable_flag` 的是本函数（:967-969），**没有绕过 `resolveAbnormal` 的任何出口**——`resolveAbnormal:807-816` 从不写 `payable_flag`，二者无竞争写者；`resolveAbnormal` 是状态与裁决的写入方，`settleReceipt` 是裁决的**消费者**。因此"补结算"是异常生命周期的下游动作，而不是替代路径。（另有一个并列写者是 `repriceReceipt:1137-1139`，但针对的是缺价行而非 `pay_received` 行，不重叠。）
- **契约风险**：
  - `abnormalRes` 查询 `.limit(100)`（:922）——单收货单异常记录超 100 条时，:924 的"全部处理完成"判断会漏掉截断之外的记录，可能放行不该放行的补结算。
  - `settledRes` 查询 `.limit(100)`（:930）同理，幂等检查在极端数据量下可能失效。
  - 解锁定位依赖 `abnormal_id` 的 `_` 分割（:961-963）：`parts = abnormal_id.split('_')`，`itemItemId = receiptId + '_' + parts[1]`。已核实 `createReceipt:543` 生成 `abnormal_id = \`${receiptId}_${i+1}_${type}\``、`receiptId = 'RCP' + 时间戳 + 6位hex`（`createReceipt:339`，**不含 `_`**），故 `parts[1]` 确为行序号，分割安全。但若未来 `receiptId` 或 `type` 引入下划线，此逻辑会静默错位。
  - `payable_flag:true` 写入（:967-969）在锁内、但在任何事务之外；若上传/入库中途失败，`receipt_item` 已被改而 `report_file` 未生成，重跑会因 `unlockedIds` 仍能命中（价格快照不变、`is_manual` 不变）而重新进入生成流程，`_S` 检查未命中，**可自愈**。但 `payable_flag` 已为 true 的行不会被 :968 重复写（无副作用），可接受。
  - `receipt.purchase_order_id` 为空时 `source_order_id` 写 `''`（:990/:1033），且 :929 的幂等查询也用 `''` 匹配，可能误命中其它无采购单收货单的补结算记录。

### `regenerateOrderReports(event)` (行 1058–1093)
- **职责**：下单报表失败后的补偿入口，重走 ①门店下单 / ②供应商订货汇总报表，并清除 `missing_reports` 标记。
- **入参**：`event.orderId`（String trim，空 → `-1 '缺少订单号'` :1061-1062）。
- **返回**：`{ code:0, data:{ orderId, regenerated:true } }`；失败 `-1 '缺少订单号'` / `'采购订单不存在'`（:1069）/ `'订单明细不存在，无法补生成'`（:1076）。
- **副作用**：
  - 经 `:1085 → regenerateApprovedOrderReports(order, orderItems, qtyMap, false)`（定义 401 行，A2a 范围）写 ①②报表；第 4 参 `qtyChanged=false`。
  - `purchase_order.missing_reports:false`（:1088-1090，条件更新 where `missing_reports:true`）。
- **权限**：`GLOBAL_ROLES`，无 `store_id` 限制。
- **幂等**：`qtyMap` 取数据库当前下单量（:1079-1083，`item.item_id || item._id` 为 key）；报表是否幂等取决于 `regenerateApprovedOrderReports` 内部（注释 :1057 称"内部已含 superseded 标记"）。**无并发锁、无重复调用检查**——两次调用会生成两版 ①② 报表。
- **调用点**：**全仓 0 个前端调用点**（证据见第 1 节末）。
- **契约风险**：这是全链路唯一能补出 ①② 报表的入口，而前端无任何触发路径。`createPurchaseOrder:82` 与 `createReceipt:757/761` 会置 `missing_reports:true`，其中下单阶段失败的标记**只能**由本函数清掉（`regenerateReceiptReports:1337-1339` 只在收货阶段按 `purchaseOrderId` 清，且需该订单已完成收货并存在收货单）。即：**下单报表生成失败后，`missing_reports` 标记在自动化路径上永不被清除**，只能靠手工改库或补上前端入口。

### `repriceReceipt(event)` (行 1105–1173)
- **职责**：为缺价（`missing_price`）明细行按当前协议价补刷价格快照并转回可付款，关闭对应异常，再重出 ③④⑤⑥ 报表。
- **入参**：`event.receiptId`（:1108-1109 空 → `-1 '缺少收货单号'`）。
- **返回**：成功 `{ code:0, data:{ message, repriced, stillMissing } }`；失败 `-1 '缺少收货单号'` / `'该收货单没有缺价行，无需补账'`（:1118）/ `仍未找到协议价：{商品名列表}。请先在价格管理页补配价格`（:1143）；`regen.code !== 0` 时原样透传 `regenerateReceiptReports` 的返回（:1164）。
- **副作用**：
  - `receipt_item`：对每个能取到 `>0` 协议价的行写 `price_snapshot`、`payable_flag:true`、`updated_at`（:1137-1139）。
  - `abnormal_record`：把该收货单 `type:'missing_price'` 且 `status` 在 `pending/processing` 的记录改为 `status:'resolved'`、`resolution:'已补配协议价并刷新价格快照，账单按补价重出'`、`handled_by:auth.user.name`、`updated_at`（:1152-1158）。**不写 `resolved_by`/`resolved_at`/`payment_decision`**。
  - 再经 `:1163` 同步调用 `regenerateReceiptReports(event)` 写 ③④⑤⑥ 报表 + 清 `missing_reports`。
- **权限**：`GLOBAL_ROLES`，无 `store_id` 限制。协议价取 `supplier_product_price` 中 `is_current:1`（:1126），按 20 个 `product_id` 分块（:1123-1130）。
- **幂等**：无锁、无重复检查；已补价的行因 `price_snapshot > 0` 不再进入 `missingItems`（:1117 条件含 `<= 0`），故重复调用对已补行是空操作，只会在仍有缺价行时重复刷新。
- **调用点**：`receive-list.js:172`，只传 `{ action, receiptId }`；调用方 :181-182 读 `data.message` 展示。
- **契约风险**：
  - **绕过异常状态机**：`resolveAbnormal` 要求 `processing → resolved`（:802），而本函数把 `pending` 与 `processing` 一并直接改成 `resolved`（:1148），跳过了 `startAbnormal`。
  - 审计链不完整：写 `handled_by` 却不写 `resolved_by`/`resolved_at`（:1156-1157），与 `resolveAbnormal:812-813` 的字段集不一致——同一条异常记录走两条路径会有两种字段形态。
  - 未校验收货单是否存在（只查 `receipt_item`），也无 `receipt_status`/门店校验。
  - `stillMissing` 只记录 `product_name`（:1136），多个同名商品会串在一起，无法定位具体行。

### `regenerateReceiptReports(event)` (行 1175–1342)
- **职责**：按 `receipt_item` 重走 ③门店收货 / ④门店带价 / ⑤供应商到货 / ⑥供应商带价账单四类报表，并清除订单 `missing_reports` 标记。
- **入参**：`event.receiptId`（:1178-1179 空 → `-1 '缺少收货单号'`）。
- **返回**：成功 `{ code:0, data:{ generated, count } }`（`generated` 为报表类型字符串数组，⑤⑥ 带 `:supplierId` 后缀）；失败 `-1 '缺少收货单号'` / `'收货单不存在'`（:1183）/ `'收货明细不存在，无法补生成'`（:1190）/ `'补生成失败，请稍后重试（已生成的报表不受影响）'`（:1332，**且此时 `data.generated` 会带上已生成项**）。
- **副作用**：
  - `report_file` 新增最多 2+N 条（③ 1 条 :1230-1239；④ 仅 `payableItems` 非空时 :1244-1267；每供应商 ⑤ :1290-1299 + ⑥ 仅 `supPayable` 非空时 :1304-1328），`report_id` 均以 `_RG` 结尾，`regenerated:true`，③⑤ 带 `has_abnormal`，④⑥ 带 `excluded_rows`。
  - `report_version_counter` 经 `getNextVersion`（1222/1245/1282/1305）。
  - `purchase_order.missing_reports:false`（:1336-1340，仅 `purchaseOrderId` 非空）。
  - 云存储 4+N 次 `uploadFile`。
  - **不改** `receipt_item` / `receipt` / `abnormal_record`。
- **权限**：`GLOBAL_ROLES`，无 `store_id` 限制。
- **幂等**：**仅靠 `getNextVersion` 的版本号 CAS 递增**，**没有 `settleReceipt` 那样的 `_S` 后缀去重守卫**。`report_id` 每次都是同一个 `'RPT_SR_'+receiptId+'_RG'` 形式，因此重复调用会**追加**多条 `report_id` 相同、`file_version` 递增、状态均为 `generated` 的记录，且不会把旧的 `_RG` 记录标 `superseded`。
- **调用点**：`receive-list.js:149`（前端，传 `{ action, receiptId }`，调用方 :154-158 只判 `code`）；`repriceReceipt:1163`（服务端内部调用，透传同一个 `event`）。
- **契约风险**：
  - 与注释 :1098「复用 regenerateReceiptReports 的报表重建逻辑（_RG 后缀，幂等）」**不符**——代码中不存在 `_RG` 去重判断，"幂等"仅指版本号递增不碰撞，不是不重复生成。
  - `catch`（:1330-1333）返回 `code:-1` 但**不重抛、不回滚已写记录**，且 :1335-1340 的 `missing_reports` 清标记在 `catch` 之外，因此失败时标记**不会**被清除（正确），但已生成的部分报表保留在库中（无标记、无 superseded）。
  - `④`/`⑥` 的可付款判定用 `item.payable_flag !== false`（:1243/:1303），即 `undefined` 也算可付款，与 `settleReceipt:984` 的同款判定一致但与 `:965` 的显式 `!target.is_manual` 组合口径需前端理解一致。
  - `limit(1000)`（:1187）为明细读取上限，超出截断静默丢行。

### `cancelOrder(event)` (行 1349–1436) —— 重点
- **职责**：管理员直接作废订单（两阶段中的"确认"），并把相关下单报表标 `superseded`。
- **入参**：`event.reason`（String trim 空 → `-1 '作废必须填写原因'` :1552-1553）、`event.orderId`（缺失 → `-1 '缺少订单号'` :1354）。
- **返回**：`{ code:0 }`；`-1 '作废必须填写原因'`、`'缺少订单号'`、`'采购订单不存在'`（:1361）、`'该订单已有收货记录，不能作废，请走异常处理流程'`（:1365 事务外 / :1385 事务内）、`'当前状态的订单不可作废'`（:1368 / :1389）；事务内 `rollback` 携带的信息经 :1418-1424 的子串匹配转为**相同文案的顶层 `{code:-1,msg}`**，不匹配则 `throw err` 由 `exports.main` 的总 catch 兜底为 `'CloudBase 数据操作失败，请稍后重试'`（:1690）。
- **副作用**：
  - `purchase_order`（事务内 :1407）：`order_status:'cancelled'`、`supplier_confirmations:{}`（**清空供应商确认**，:1394-1396）、`cancel_reason`、`cancelled_by:auth.user.name`、`cancelled_at`、`updated_at`；手动单且 `verify_status` 非 `none` 时追加 `verify_status:'none'` 与 `verify_cancel_note`（:1402-1406）。
  - `report_file`（事务内逐条 :1410-1417）：`source_order_id` 等于该订单且 `report_type` 属于 `store_order_report` / `supplier_order_report` 的记录 → `status:'superseded'`、`updated_at`。**只作废这两类下单报表**，不动收货类报表（由状态前置条件保证此时不会有收货）。
  - 消息（事务外 :1427-1434）：`type:'cancel'`、`title:'采购单已作废'`、`storeId:order.store_id`、`bizId:event.orderId`，**无 recipient → 门店广播**，文案要求经办人线下告知供应商。
- **权限**：`GLOBAL_ROLES`（:1350）。**谁能发起**：只有 `super_admin` / `purchaser`；店长与下单人**没有** `cancelOrder` 权限，只能走 `requestCancel`。门店归属不做校验（全局角色可跨门店作废）。
- **状态前置条件**：`order_status` 必须属于 `['submitted','approved','report_generated']`（:1367），`['partial_received','received','receipt_abnormal']` 一律拒绝（:1364）；事务内再复查一次（:1384-1391）。
- **是否清空供应商确认**：是，`supplier_confirmations: {}`（:1396）。
- **是否作废报表**：是，仅 ①`store_order_report` 与 ②`supplier_order_report` 两类（:1411）。
- **订单终态是否有出口**：`cancelled` 在本段及全仓**无任何转移出口**——`requestCancel:1454` 的前置集合不含 `cancelled`，`verifyManualOrder` 亦不检查该状态，A2a 范围内的 `auditOrder` 也不接受 `cancelled`。属无出口终态。
- **幂等 / 并发控制**：使用 `db.runTransaction`（:1371），事务内 `.where().get()` 复查状态（:1375-1378，注释 :1408 说明 SDK 不支持事务内 `where().update()`，故改为 get + 逐条 `doc().update()`）。
  - **但主单更新 :1407 是无条件 `transaction.collection('purchase_order').doc(current._id).update(...)`，不带 `order_status` 条件**。事务内 :1384 的状态复查与 :1407 的写入之间仍存在窗口；正确性完全依赖 CloudBase 事务的隔离级别（未验证 #2）。这与其他函数惯用的 `.where({_id, 旧状态}).update()` CAS 风格不一致。
- **调用点**：`purchase-detail.js:289`，传 `{ action:'cancelOrder', orderId: d.purchaseOrderId, reason }`；调用方 :295-299 只判 `code`。
- **契约风险**：
  - 见上：主单更新无 CAS 条件。
  - **不检查、也不清除 `cancel_requested`**：`Grep glob="**/*.js" pattern="cancel_requested"` 全仓仅命中 `dataService:1464`（where 条件）、`dataService:1467`（写入）与 `utils/cloud.js:162`（展示读取 `cancelRequested`）。因此作废一个"已有取消申请"的订单后，`cancel_requested` 永久为 `true`，`utils/cloud.js:162` 会继续把它渲染成 `cancelRequested:true`，与 `cancelled` 状态并存。
  - **不检查、也不清除 `missing_reports`**，作废单上残留该标记。
  - 事务外的 `createMessage`（:1427）若失败，`exports.main` 的总 catch 会返回 `-1 'CloudBase 数据操作失败，请稍后重试'`，但**订单已被作废**——调用方看到失败提示后若重试，会被 :1368 的"当前状态的订单不可作废"挡回，属可解释但不直观。
  - `report_file` 逐条 `doc().update()` 在事务内，但若 `rptRes.data` 为空则不执行任何作废动作，也不报错（正常）。

### `requestCancel(event)` (行 1439–1486) —— 重点
- **职责**：管理员提交取消申请，落标记并发通知，等待 `cancelOrder` 执行。
- **入参**：`event.reason`（空 → `-1 '申请取消必须填写原因'` :1445）、`event.orderId`（缺失 → `-1 '缺少订单号'` :1446）。
- **返回**：`{ code:0 }`；`-1 '申请取消必须填写原因'`、`'缺少订单号'`、`'采购订单不存在'`（:1453）、`'当前状态的订单无法申请取消'`（:1455）、`-403 '当前账号无权对该门店订单申请取消'`（:1459）、`'该订单已有待确认的取消申请，请勿重复提交'`（:1475）。
- **副作用**：`purchase_order.cancel_requested:true`、`cancel_requested_by:auth.user.name`、`cancel_request_reason`、`cancel_requested_at`、`updated_at`（:1465-1473，条件更新 where `{_id, cancel_requested:_.neq(true)}`）；消息 `type:'cancel'`、`title:'收到取消申请'`、`storeId:order.store_id`、`bizId:event.orderId`，**无 recipient → 门店广播**（:1478-1484）。
- **权限**：`GLOBAL_ROLES`（:1442）——与 :1440 注释一致，仅管理员（purchaser/super_admin）可发起；`super_admin` 可经 `cancelOrder` 直接作废而无需申请。
- **状态前置条件**：`['submitted','approved','report_generated','partial_received']`（:1454）。
- **CAS**：`cancel_requested: _.neq(true)` 条件更新 + `updated===0` 拒绝（:1474-1476），防重复提交。
- **调用点**：`purchase-detail.js:261`，传 `{ action:'requestCancel', orderId, reason }`。
- **契约风险**：
  - **请求与执行的前置状态不一致**：`requestCancel` 允许 `partial_received`（:1454），而 `cancelOrder` 明确拒绝 `partial_received`（:1364）。因此对部分收货订单提交申请后，**没有任何路径能批准它**，形成死端。
  - **`cancel_requested` 无清除出口**（证据见 `cancelOrder` 一节）：管理员决定"不取消"时，订单上永久残留 `cancel_requested:true`，此后 `requestCancel` 会永远返回"该订单已有待确认的取消申请"，`utils/cloud.js:162` 也一直显示为待确认。这是本段最明显的未闭合点。
  - 条件更新成功即返回 `code:0`，但随后的 `createMessage`（:1478）失败会经总 catch 变成 `-1`，此时标记**已写入且不会被回退**（与 `remindAudit` 的 P2-17 回退模式不同，此处无回退）。

### `remindAudit(event)` (行 1489–1550)
- **职责**：向管理员发催审消息，1 小时限频。
- **入参**：`event.orderId`（缺失 → `-1 '缺少订单号'` :1492）。
- **返回**：`{ code:0 }`；`-1 '缺少订单号'`、`'采购订单不存在'`（:1499）、`'该订单当前无需催审'`（:1501，`order_status !== 'submitted'`）、`-403 '当前账号无权催办该门店订单'`（:1505）、`'已催办过，请 1 小时后再试'`（:1512 读后判断 / :1527 CAS 未命中）、`'催办消息发送失败，请稍后重试'`（:1547，消息写入失败回退标记后返回）。
- **副作用**：`purchase_order.audit_reminded_at`（:1525 写入，:1541-1543 失败回退为旧值或 `null`）、`updated_at`；消息 `type:'approval'`、`title:'采购单催审提醒'`、`storeId:order.store_id`、`bizId:event.orderId`，**无 recipient → 门店广播**（:1530-1536）。
- **权限**：`['chef','store_manager','purchaser','super_admin']`（:1490）；:1504 门店归属校验（非全局且 `order.store_id !== default_store_id` → -403）。
- **幂等 / 并发控制**：双保险——读后判断（:1510-1513）+ 条件更新 CAS（:1516-1525）。CAS 的 where 是 `{ _id, order_status:'submitted', $or:[{audit_reminded_at:_.exists(false)}, {audit_reminded_at:_.lt(new Date(Date.now()-ONE_HOUR))}] }`。
  - 与全仓惯用的 `_.or([...])` 写法不一致（见 :656、:664、:939 均用 `_.or`），本处用 Mongo 风格 `$or` 字面量。TCB 数据库通常兼容 `$or`，但**未经验证**（未验证 #3）。若不被识别，CAS 永不命中，将永远返回"已催办过"。
  - 消息写入失败时的回退（:1536-1548）设计正确：`createMessage` 被 `.catch` 捕获，回写 `audit_reminded_at` 旧值，返回 `-1`。
- **调用点**：`purchase-detail.js:197`，传 `{ action:'remindAudit', orderId }`。
- **契约风险**：
  - `$or` 兼容性（未验证 #3）。
  - 消息**不做定向**：催审消息 `storeId` 为订单门店，无 `recipientUserId`，因此同门店的店长/厨师也会收到"请尽快处理"，但实际只有管理员能审。属于体验噪声而非数据错误。
  - `audit_reminded_at` 用 `db.serverDate()` 写入（:1525），判断用 `Date.now()`（:1511/:1522）——两者是云函数同一环境的时钟，实践上无差异。

### `verifyManualOrder(event)` (行 1556–1659) —— 重点
- **职责**：手动商品专用单的付款凭证核销闭环（提交 / 驳回 / 通过三态）。
- **入参**与校验（按行号）：
  - `event.verifyAction` → String（:1557），合法值 `submit` / `approve` / `reject`，其它 → `-1 '无效的核销动作'`（:1626）。
  - `event.orderId` → String trim（:1561）；查询后不存在 → `-1 '采购订单不存在'`（:1575）；`!order.is_manual` → `-1 '仅手动商品专用单需要凭证核销'`（:1576）。
  - `event.amount` → `Number()`（:1562）；仅 `approve` 分支强校验 `!Number.isFinite(amount) || amount <= 0` → `-1 '请填写大于0的实付金额'`（:1642）。**`submit`/`reject` 分支完全不校验 `amount`**。
  - `event.voucherFileIds` → 必须为数组，过滤掉 falsy（:1563）；`length > 9` → `-1 '付款凭证最多9张'`（:1567）；任一 fileID 的 cloudPath 不以 `vouchers/{orderId}/` 开头 → `-1 '付款凭证信息无效，请重新上传'`（:1569）。
  - `event.note` → String trim（:1571）；`reject` 分支为空 → `-1 '请填写驳回原因'`（:1630）；`submit` 分支不强制。
- **返回**：全部**顶层扁平**。
  - submit 成功 `{ code:0, data:{ message:'凭证已提交，等待管理员核销' } }`（:1622）；失败 `-1 '订单尚在收货中，需全部批次收货完成后才能提交付款凭证'`（:1588）、`-1 '该单已核销通过，无需重复提交'`（:1590 读后 / :1606 CAS）。
  - reject 成功 `{ code:0, data:{ message:'已驳回，请门店重新提交凭证' } }`（:1640）；失败 `-1 '该单没有待核销的凭证'`（:1627）、`-1 '请填写驳回原因'`、`-1 '该单核销状态已变化，请刷新后重试'`（:1638）。
  - approve 成功 `{ code:0, data:{ message:'核销完成，实付金额已回填' } }`（:1658）；失败同 reject 加 `-1 '请填写大于0的实付金额'`（:1642）。
  - 通用：`-1 '无效的核销动作'`（:1626）、`-403 '无权操作其他门店的采购订单'`（:1579，仅店长）。
- **权限**（分两段，:1559）：
  - `submit` → `VOUCHER_SUBMIT_ROLES = ['super_admin','purchaser','store_manager']`（常量原文见第 1 节）
  - `approve` / `reject` / 其它 → `GLOBAL_ROLES`
  - 门店归属仅对 `store_manager` 校验（:1578）；管理员/采购员可跨门店核销。
  - 调用者身份**完全由会话派生**（`auth.user.user_id || auth.user._id`），前端只传 `orderId`/`verifyAction`/`amount`/`note`/`voucherFileIds`。
- **金额与凭证的校验**：
  - 金额：唯一可信来源是凭证，不查协议价表（:1554-1555 注释）；`approve` 时强校验 `> 0` 且有限（:1642），写入 `verify_amount`。
  - 凭证：数量上限 9（:1567）+ **fileID 必须落在本订单自己的凭证目录** `vouchers/{orderId}/`（:1566-1569）。`cloudPathOfFileId`（:19-22）先剥离 `cloud://{env}.{bucket}/` 协议头再比对，规避了注释 :18 提到的 200cb63 历史缺陷。
- **旧凭证删除逻辑**（:1608-1621）：仅在 submit 分支、CAS 成功之后执行。取 `order.verify_voucher_file_ids`（旧列表），过滤出"cloudPath 以本订单前缀开头 **且** 不在新列表中"的 `staleFileIds`，再 `cloud.deleteFile({ fileList })`；删除失败只 `console.error`（:1619）不影响返回。
- **三个分支的字段写入与 CAS（重点核对结果）**：
  | 分支 | 前置状态 | CAS 条件（原文） | 写入字段 |
  |---|---|---|---|
  | submit（:1593-1604） | `order_status ∈ {received, receipt_abnormal, partial_received}`（:1587）且 `verify_status !== 'approved'`（:1590） | `.where({ _id: order._id, verify_status: _.neq('approved') })` | `verify_status:'pending'`、`verify_voucher_file_ids`、`verify_note`、`verify_submitted_by`、`verify_submitted_at`、`updated_at` |
  | reject（:1631-1636） | `verify_status === 'pending'`（:1627） | `.where({ _id: order._id, verify_status: 'pending' })` | `verify_status:'rejected'`、`verify_reject_note`、`updated_at` |
  | approve（:1643-1654） | `verify_status === 'pending'`（:1627） | `.where({ _id: order._id, verify_status: 'pending' })` | `verify_status:'approved'`、`verify_amount`、`verify_note`、`verified_by`、`verified_at`、`updated_at` |
  - **三个分支的 CAS 都齐**，且都检查 `updated === 0` 并转固定文案。CAS 是 `where().update()` 条件更新，**不是 `db.runTransaction`**——三处都是单文档单条 update，无跨集合写入，单文档条件更新足以保证正确性。
  - `rejected` 可被重新 `submit`（因为 submit 的 CAS 只排除 `approved`），`approved` 不可回退（无出口终态）。
  - submit 的 `order_status` 门槛在 :1587 放宽到 `partial_received`（注释 :1582-1585 说明替代原 #22 门槛，理由是手动单常态停在 `partial_received`），与前端 `purchase-detail` 展示口径对齐。
- **调用点**：
  - `purchase-detail.js:162`（submit）：传 `{ orderId: this.orderId, verifyAction:'submit', voucherFileIds: fileIds }`，**不传 `amount`/`note`**；:143-144 `wx.chooseMedia` 的 `count: 3` 是前端单次选择上限（后端上限 9）。
  - `purchase-detail.js:231`（approve/reject）：传 `{ orderId: d.purchaseOrderId, verifyAction, amount: amount || undefined, note }`。
- **契约风险**：
  - `voucherPrefix`（:1566）用的是**未 trim 的 `event.orderId`**，而 `orderId`（:1561）是 trim 后的。两者不一致时，凭证目录校验与订单查询会指向不同订单号。当前前端传的都是 `purchaseOrderId`（无空白），不触发；但属于潜在不一致。
  - 校验顺序问题：`voucherFileIds` 的前缀校验（:1568）在订单存在性校验（:1573-1575）之前。`orderId` 为空且传了凭证时返回 `'付款凭证信息无效，请重新上传'` 而非更准确的 `'采购订单不存在'`。
  - 旧凭证删除在 CAS 成功**之后**：写入新列表与删除旧文件之间存在窗口，若删除失败会留下孤儿文件（仅日志，:1619）。且若 CAS 未命中（已核销），**不会**执行删除——正确行为。
  - `submit` 分支写 `verify_note`，`approve` 分支也写 `verify_note`（:1649）——核销人填的备注会**覆盖**提交人的备注；而 `reject` 分支特意用独立字段 `verify_reject_note` 避免覆盖（:1634 注释），三处对 `note` 的持久化策略不统一。
  - 前端 `chooseMedia count:3` 与后端上限 9 不一致（未验证 #9，可能是有意留扩展余地）。

---

## 4. 状态机转移（本段范围）

### `purchase_order.order_status`
- `submitted` / `approved` / `report_generated` --(`cancelOrder`, :1407)--> `cancelled`
- 本段**无其它** `order_status` 写入（`auditOrder` 属 A2a；收货相关转移在 `createReceipt` 云函数）。
- 不可作废的前置拒绝态：`partial_received` / `received` / `receipt_abnormal`（:1364）。
- **无出口终态：`cancelled`**（证据：全仓 `Grep` 无任何函数以 `cancelled` 为源状态做转移；`requestCancel:1454`、`cancelOrder:1367`、`verifyManualOrder:1587` 的前置集合均不含它）。

### `purchase_order.verify_status`（仅手动单有意义）
- 空 / `none` / `rejected` / `pending` --(`verifyManualOrder`·submit, :1597)--> `pending`
- `pending` --(`verifyManualOrder`·reject, :1635)--> `rejected`
- `pending` --(`verifyManualOrder`·approve, :1647)--> `approved`
- `pending` / `rejected` / 其它非 `none` --(`cancelOrder`, :1404)--> `none`（作废时重置，仅手动单）
- **无出口终态：`approved`**（submit 的 CAS 明确排除 `approved`（:1594），无其它写点把它改回）。

### `purchase_order` 上的辅助标记
- `missing_reports: true → false`：(`regenerateOrderReports`, :1088-1090) 与 (`regenerateReceiptReports`, :1337-1339)。置 true 的点在主代理已核实（`createPurchaseOrder:82`、`createReceipt:757/761`）。
- `cancel_requested: 非true → true`（`requestCancel`, :1467）——**没有任何 `true → 非true` 的出口**。证据：全仓 `Grep glob="**/*.js" pattern="cancel_requested"` 仅 3 处命中（`dataService:1464` 读作 where 条件、`:1467` 写入、`utils/cloud.js:162` 展示读取），无清除点。→ **悬挂状态**（非业务终态但无出口）。
- `audit_reminded_at: 无/旧 → serverDate`（`remindAudit`, :1525；失败回退 :1541-1543）——可反复推进，不算终态。

### `receipt`
- `settle_lock: 非true/超时 → true`（`settleReceipt`, :942-944，带 `staleCutoff` 10 分钟接管）
- `settle_lock: true → false`（`settleReceipt` finally, :1045-1047）
- 有出口，非终态。本段**不改** `receipt_status`。

### `receipt_item`
- `payable_flag: 任意 → true`：(`settleReceipt`, :967-969，仅 `pay_received` 解锁行) 与 (`repriceReceipt`, :1137-1139，仅缺价行)
- 本段**无 `true → false` 的出口**；置 false 的点在 `createReceipt`（A2a 范围外）。
- `price_snapshot: 0/缺 → 当前协议价`（`repriceReceipt`, :1137-1139）。

### `abnormal_record.status`
- `pending` --(`startAbnormal`, :783)--> `processing`
- `processing` --(`resolveAbnormal`, :807-816)--> `resolved`
- `pending | processing` --(`repriceReceipt`, :1152-1158，**仅 `type='missing_price'`，绕过 processing 中间态**)--> `resolved`
- `resolved` --(`closeAbnormal`, :854-860)--> `closed`
- **无出口终态：`closed`**（无任何函数把 `closed` 改回；且 `settleReceipt:953` 显式排除 `closed`，关闭即永久失去补结算资格）。
- `resolved` 本身有出口（→ closed），但若从未被 close 会长期停留——这是允许的稳态，不算无出口终态。

### `report_file.status`
- 新增即 `generated`（`settleReceipt` :1035、`regenerateReceiptReports` :1236/:1264/:1296/:1324）
- `generated` --(`cancelOrder`, :1414-1416，仅 `store_order_report`/`supplier_order_report`)--> `superseded`
- **无出口终态：`superseded`**（本段无 `superseded → generated` 的写点；语义上它是墓碑态，符合设计）。

### `message`
- `read_by: [] → push(userId)`（`markMessageRead`, :697；`markAllMessagesRead`, :715）——只增不减，无出口。
- `read`（文档级布尔）由 `createMessage` 初始化为 `false`（:208），**本段没有任何写入点把它改为 true**（只写 `read_by`）。读取侧在 `getMessages:677` 用 `!!message.read || readBy.includes(userId)` 合并。→ `read` 布尔在本段是**只写 false 的死字段**。

**汇总：无出口终态 4 个**（`order_status='cancelled'`、`verify_status='approved'`、`abnormal_record.status='closed'`、`report_file.status='superseded'`，其中前 3 个是业务意义上的无出口，第 4 个是设计上的墓碑态）；**另有 1 个悬挂标记 `cancel_requested=true` 无清除出口**，以及 1 个 `resolved` 稳态可长期停留。

---

## 5. 调用图（本段内的边）

### 同步函数调用
- `exports.main`（:1661）→ 16 个 handler（各 `event.action` case）
- `markAllMessagesRead`（:708）→ `getMessages`
- `getMessages`（:677）→ `publicMessage`
- `repriceReceipt`（:1163）→ `regenerateReceiptReports`（**同一个 `event` 透传**，故两者重复做了一次 `requireUser` 与收货单查询）
- `regenerateOrderReports`（:1085）→ `regenerateApprovedOrderReports`（定义 401，A2a 范围）
- `settleReceipt`（:1014）、`regenerateReceiptReports`（:1222/:1245/:1282/:1305）→ `getNextVersion`（368）
- `settleReceipt` / `regenerateReceiptReports` → `csvField`（357）、`safePathPart`（364）
- `resolveAbnormal`（:825）→ `getStoreManagerId`（216）
- 全部 16 个 handler → `requireUser`（52）；消息类 handler → `createMessage`（194）

### 数据库间接影响（非函数调用，但产生跨集合状态耦合）
- `resolveAbnormal` 写 `payment_decision` → 被 `settleReceipt:953` 消费（跨请求，人工间隔触发）
- `repriceReceipt` 写 `receipt_item.payable_flag/price_snapshot` → 被 `regenerateReceiptReports:1243/:1303` 在**同一请求内**读取并纳入 ④⑥ 报表
- `resolveAbnormal` / `repriceReceipt` 把异常推到 `resolved` → 解除 `settleReceipt:924` 的门禁
- `closeAbnormal` 把异常推到 `closed` → **永久排除**出 `settleReceipt:953` 的解锁集合（不可逆）
- `cancelOrder` 写 `report_file.status='superseded'` → 影响报表列表展示口径
- `verifyManualOrder` 写 `verify_status` → 被 `getOrderStats:892` 与 `getPurchaseOrders` 的 `to_verify` 统计消费
- `cancelOrder` 写 `verify_status='none'` → 改变 `getOrderStats:892` 的计数

### 消息通知（`createMessage`，全部为门店广播，除 :817 外均无 recipient）
- `resolveAbnormal` → 2 条（`type:'abnormal'`：「异常已解决」定向店长、「待补结算提醒」广播）
- `cancelOrder` → 1 条（`type:'cancel'`）
- `requestCancel` → 1 条（`type:'cancel'`）
- `remindAudit` → 1 条（`type:'approval'`）
- `startAbnormal` / `closeAbnormal` / `settleReceipt` / `repriceReceipt` / `regenerateReceiptReports` / `regenerateOrderReports` / `verifyManualOrder` → **均不发消息**（异常关闭、补结算完成、补生成完成、核销完成都无通知）

---

## 6. 死代码与未闭合点

1. **`regenerateOrderReports`（1058–1093）：定义在 switch（:1681）但全仓 0 个前端调用点。** 证据：全仓 `Grep glob="**/*.js"` 检索 `action: 'regenerateOrderReports'` 仅在 `dataService/index.js` 自身命中（定义 + case），13 个前端页面文件无一命中；本段 16 个 handler 内也无函数调用它。影响：`createPurchaseOrder:82` 打的 `missing_reports:true` 标记在下单阶段没有任何自动化补偿路径能清掉（`regenerateReceiptReports:1337` 只在收货后按 `purchaseOrderId` 清），①② 报表生成失败后只能人工干预。
2. **`getAbnormalRecords` 的 `event.status` 入参（:743）从未被任何调用方传入。** 证据：`abnormal-list.js:17` 只传 `{ action: 'getAbnormalRecords' }`，前端在 :37-44 用 `activeFilter` 内存过滤。该入参是 dead 入参。
3. **`message.read_at` 字段（写于 :698、:716）全仓无读取点。** 证据：`Grep glob="**/*.js" pattern="read_at"` 仅命中这两行写入；`publicMessage`(638-649) 不返回它，前端两个消息页也不读。属死写。
4. **`message.read` 布尔在本段是只写 `false` 的死字段**：初始化于 `createMessage:208`，本段无任何写 true 的点；只有 `getMessages:677` 读取并用 `read_by` 兜底。
5. **`publicMessage` 的入参无校验**，若 `message` 为 undefined 会直接抛错并被 `exports.main` 总 catch 吞成通用文案——但实际调用点 `getMessages:674` 的 `result.data.map` 已保证是文档对象，不可达。
6. **`getOrderStats` 的 `event.storeId` 只在全局角色分支生效（:879）**，`chef`/`store_manager` 传了也被忽略（由服务端按 `default_store_id` 强制覆盖），不构成越权但属静默忽略。
7. **catch 吞错后仍返回成功的情况**：本段**未出现**"catch 吞错后仍返回 `code:0`"的模式。相反有两处刻意反模式：`settleReceipt` 的锁释放失败仅日志（:1048-1050）但主流程返回正常；`verifyManualOrder` 旧凭证删除失败仅日志（:1618-1620）但返回 `code:0`。这两处都是"尽力而为的清理动作失败不阻断主流程"，语义正确，不算吞错。
8. **`repriceReceipt` 与 `regenerateReceiptReports` 的重复鉴权与重复查询**：`:1163` 透传同一个 `event`，`regenerateReceiptReports:1176` 又跑一次 `requireUser`，`:1181` 又查一次收货单——非 bug，属冗余。
9. **`regenerateReceiptReports` 的注释与实现不符**：:1098 注释声称「_RG 后缀，幂等」，但代码中**没有** `_RG` 去重守卫（对比 `settleReceipt:928-934` 有 `_S` 守卫）。重复调用会追加多条 `report_id` 相同、`file_version` 递增、状态均为 `generated` 的记录，旧记录不被标 `superseded`。这是**行为未闭合点**，不是死代码。
10. **`requestCancel` 的 `cancel_requested=true` 无任何清除出口**（证据见第 4 节），且 `cancelOrder` 既不校验也不清理它——这是本段最实质的未闭合点：管理员"驳回申请"这个业务动作在系统里**没有对应实现**，只能靠改库。
11. **`requestCancel` 与 `cancelOrder` 的前置状态集合不一致**（:1454 含 `partial_received`，:1364 拒绝它）→ 部分收货订单的取消申请永远无法被批准，形成死端申请。
12. **`repriceReceipt` 绕过 `resolveAbnormal` 的状态门禁**：把 `pending` 直接改成 `resolved`（:1148 的 `status: _.in(['pending','processing'])`），跳过了 `startAbnormal` 的 `pending→processing` 与 `resolved_by`/`resolved_at` 字段（只写 `handled_by`），使同一集合内出现两种审计字段形态。

---

## 7. 未验证清单

1. **`transaction.rollback({ code, msg })` 的 `errMsg` 是否原样携带该对象内容**（`cancelOrder:1418-1424` 的 catch 依赖 `err.errMsg.includes(...)` 子串匹配来还原业务文案）。若 TCB SDK 把对象序列化成别的字符串，三条业务文案都会退化到 `exports.main` 的通用错误。建议：在预发环境构造一个 `partial_received` 订单并发 `cancelOrder`，观察返回 `msg` 是"该订单已有收货记录，不能作废…"还是"CloudBase 数据操作失败，请稍后重试"。
2. **CloudBase 事务隔离级别是否真正消除 `cancelOrder` 主单更新的 TOCTOU**（:1375 `transaction.collection().where().get()` 复查 vs :1407 无条件 `transaction.collection().doc(_id).update()`）。若事务内 get 与 update 不是快照读，并发收货可能仍把已收货订单作废。建议：并发压测——同一订单同时发起 `createReceipt`（推入 `partial_received`）与 `cancelOrder`，检查最终 `order_status` 与账单是否漏。
3. **`remindAudit` 的 `$or` 字面量（:1520）是否被 TCB 数据库识别**。全仓其余 4 处复合条件均用 `_.or([...])`（:656、:664、:939 等）。若 `$or` 不被识别，CAS 永不命中，所有催办都会返回"已催办过，请 1 小时后再试"。建议：清掉某订单的 `audit_reminded_at` 后调用 `remindAudit`，看是否首次即成功。
4. **`order_status='receipt_abnormal'` 不在 `getOrderStats` 的 `receivableStatuses`（:883）是否为设计意图**：该状态的订单在首页既不计入"待收货"也不计入"已完成"（:885 只匹配 `received`），只在收货/异常页面可见。建议：产品确认是否需要新增卡片或把它并入 `received`。
5. **供货商 `auth.user.default_supplier_id` 是否总是非空**。`getMessages:664` 用 `auth.user.default_supplier_id || ''` 做 `scope_id` 匹配；若该字段为空，供货商会看到所有 `scope_type='supplier' && scope_id=''` 的消息（越界读取）。建议：检查建号/绑号流程是否强制写入该字段，并抽查供货商账号的 `getMessages` 返回。
6. **`message.recipient_user_id` / `store_id` 越权已读的暴露面**：`markMessageRead:691` 的 `belongsToStore` 无 `scope_type/scope_id` 分支，任何供货商都能把 `store_id=''` 的门店广播消息 push 进自己的 `read_by`。危害限于污染 `read_by` 数组与 `read_at`，不返回内容。建议：把 :689-692 的校验逻辑抽取为与 `getMessages` 共用的单一函数，避免口径漂移。
7. **`markAllMessagesRead` 的部分写入语义**：返回 `code:0` 时可能仍有消息未写（:711-714 双重过滤 + 前端 `message.js:80` 强制 `unreadCount=0`）。建议：确认前端是否需要按返回的实际写入条数重算。
8. **`verifyManualOrder` 的 `voucherPrefix` 使用未 trim 的 `event.orderId`（:1566）与 `orderId` trim 后值（:1561）不一致**，以及凭证前缀校验（:1568）早于订单存在性校验（:1573）的顺序是否可接受。建议：确认 `orderId` 是否可能带空白字符。
9. **前端 `chooseMedia` 的 `count: 3`（purchase-detail.js:144）与后端上限 9（:1567）** 是否为有意差异。建议：确认是否需要放开前端上限。
10. **`limit(100)` 截断的实际风险量级**：`getMessages:673`、`getAbnormalRecords:747`、`settleReceipt:922`（异常记录）、`:930`（已补结算报表）、以及 `limit(1000)`（`receipt_item` :956/:978/:1113/:1186）。建议：按生产数据统计单收货单异常记录数与单用户消息数的分布，确认 100/1000 是否足够。
11. **`abnormal_id` 解析（`settleReceipt:961-963`）对未来 `receiptId`/`type` 含下划线变更的脆弱性**。当前已核实安全：`createReceipt:339` 生成 `receiptId = 'RCP' + Date.now() + 6位hex`（无 `_`），`createReceipt:543` 生成 `abnormal_id = \`${receiptId}_${i+1}_${type}\``，与 `:963` 的 `receiptId + '_' + parts[1]` 对应一致。建议：若未来改动 ID 格式，同步更新该解析逻辑。
12. **`cancelOrder` 是否应当清除 `cancel_requested` / `missing_reports`** 属设计意图问题（本段确认无清除点，见第 4、6 节），建议产品确认后补一条清理逻辑。

---

## 8. 行数对账

| 区段 | 起始行 | 结束行 | 内容 |
|---|---|---|---|
| 1 | 638 | 649 | `publicMessage`（辅助器） |
| 2 | 651 | 680 | `getMessages` |
| 3 | 682 | 702 | `markMessageRead` |
| 4 | 704 | 720 | `markAllMessagesRead` |
| 5 | 722 | 734 | `ABNORMAL_TYPE_NAMES` / `ABNORMAL_STATUS_NAMES` 常量 |
| 6 | 736 | 771 | `getAbnormalRecords` |
| 7 | 773 | 787 | `startAbnormal` |
| 8 | 789 | 839 | `resolveAbnormal` |
| 9 | 841 | 863 | `closeAbnormal` |
| 10 | 866 | 904 | `getOrderStats` |
| 11 | 909 | 1052 | `settleReceipt`（含 :906-908 注释） |
| 12 | 1058 | 1093 | `regenerateOrderReports`（含 :1054-1057 注释） |
| 13 | 1105 | 1173 | `repriceReceipt`（含 :1095-1104 注释） |
| 14 | 1175 | 1342 | `regenerateReceiptReports` |
| 15 | 1349 | 1436 | `cancelOrder`（含 :1344-1348 注释） |
| 16 | 1439 | 1486 | `requestCancel` |
| 17 | 1489 | 1550 | `remindAudit` |
| 18 | 1556 | 1659 | `verifyManualOrder`（含 :1552-1555 注释） |
| 19 | 1661 | 1692 | `exports.main` + switch + 总 catch（文件末行 1693 为空行） |
| — | 合计 | 638–1692 | **1055 行，已 100% 覆盖，无跳读** |

- 本段函数定义数：**17**（16 个 action handler + 1 个辅助器 `publicMessage`），另有 2 个常量字典（`ABNORMAL_TYPE_NAMES`、`ABNORMAL_STATUS_NAMES`）。
- switch 内本段 action 数：**16**（:1670–:1685）。
- `requireUser` 带角色白名单的 handler：**8**（startAbnormal / resolveAbnormal / closeAbnormal / settleReceipt / regenerateOrderReports / repriceReceipt / regenerateReceiptReports / cancelOrder / requestCancel / remindAudit / verifyManualOrder 共 11 个——其中 4 个异常 handler 用门店角色列表、5 个报表/作废/申请 handler 用 `GLOBAL_ROLES`、`remindAudit` 用四角色列表、`verifyManualOrder` 用三元分支）；无白名单的 handler：**5**（getMessages / markMessageRead / markAllMessagesRead / getAbnormalRecords / getOrderStats），它们的范围限制改在函数体内按角色手工实现。
- 前端调用点总数：**22 处**（覆盖 15 个 action；`regenerateOrderReports` 为 0）。
- 未闭合点：**12 条**（第 6 节）；无出口终态 **4 个** + 悬挂标记 **1 个**（第 4 节）；未验证项 **12 条**（第 7 节）。
