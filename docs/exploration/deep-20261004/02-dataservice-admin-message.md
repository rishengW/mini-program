# 深度探索 02：dataService 数据服务云函数 + 管理后台页 + 消息中心

- 探索代理：第 2 号（dataService + 管理后台 + 消息中心）
- 日期：2026-10-04
- 分支：backup（只读探索，未修改任何源文件）
- 覆盖文件：`cloudfunctions/dataService/index.js`（1678 行，**逐行完整读完**）、`dataService/package.json`、`pages/store-manage/*`、`pages/supplier-manage/*`、`pages/message/*`、`pages/supplier-messages/*`（每个页面 js/json/wxml/wxss 四件套全读）
- 交叉核实（只读）：`utils/cloud.js`、`utils/util.js`、`utils/auth-guard.js`、`app.json`、`pages/index/index.js`、`pages/index/index.wxml`、`pages/supplier-home/supplier-home.js`、`cloudfunctions/getSuppliers/index.js`、`cloudfunctions/authService/index.js`（门店 CRUD 部分）、`cloudfunctions/createReceipt/index.js` 与 `cloudfunctions/createPurchaseOrder/index.js` 的 message 写入点

---

## 1. 概览

`dataService` 是典型的**万能分发器**：单一入口 `exports.main`（`cloudfunctions/dataService/index.js:1646`），按 `event.authToken` 换会话、按 `event.action` 字符串 switch 分发，共 **22 个 case + 1 个 default**（`:1648-1672`）。文件 83KB / 1678 行，是本项目最大的云函数。

角色常量（`:8-11`）：

| 常量 | 值 | 用途 |
|---|---|---|
| `GLOBAL_ROLES` | `['super_admin','purchaser']` | 全局管理（报表/结算/作废/补价） |
| `MANAGEMENT_ROLES` | `['super_admin','purchaser']` | 主数据 + 审核（与 GLOBAL_ROLES 同值，重复定义） |
| `VOUCHER_SUBMIT_ROLES` | `['super_admin','purchaser','store_manager']` | 手动单凭证**提交**（核销裁决仍限 GLOBAL_ROLES，`:1548`） |

会话机制（`:17-52`）：`authToken` → sha256 → 先查 `app_user.sessions[]` 数组（多设备会话），查不到再查旧单会话字段 `session_token_hash`；过期时间 `expires_at`/`session_expires_at` 双重兜底。`requireUser(event, roles)` 是全站唯一的鉴权原语，返回 `{user}` 或 `{error:{code,msg}}`。

依赖（`dataService/package.json`）：仅 `wx-server-sdk ~2.6.3`，无第三方库。

**关键边界发现：`store-manage` 页面完全不调用 dataService**，门店 CRUD 全部在 `authService`（`getStores`/`createStore`/`updateStore`/`setStoreStatus`，`authService/index.js:664-667`）。dataService 里**没有任何门店 action**，任务假设的"删门店 → 商品/供应商/订单级联"需在 authService 侧看（结论见 §5）。

---

## 2. Action 分发表

| # | action | 定义行 | 角色门槛 | 主要集合 | 读/写 | 事务 |
|---|---|---|---|---|---|---|
| 1 | `getCategories` | :54 | 任意登录 | `category` | 读 | — |
| 2 | `saveProduct` | :91 | MANAGEMENT | `product` `category` `supplier` | 写 | 否 |
| 3 | `toggleProduct` | :132 | MANAGEMENT | `product` | 写 | 否 |
| 4 | `saveSupplier` | :143 | MANAGEMENT | `supplier` | 写 | 否 |
| 5 | `toggleSupplier` | :176 | MANAGEMENT | `supplier` | 写 | 否 |
| 6 | `auditOrder` | :487 | MANAGEMENT | `purchase_order` `purchase_order_item` `report_file` `report_version_counter` `supplier` `message` | 写 | **是**（:536） |
| 7 | `getMessages` | :640 | 任意登录（角色过滤） | `message` | 读 | — |
| 8 | `markMessageRead` | :671 | 任意登录 + 归属校验 | `message` | 写 | 否 |
| 9 | `markAllMessagesRead` | :693 | 任意登录 | `message` | 写（串行循环） | 否 |
| 10 | `getAbnormalRecords` | :725 | 任意登录（chef 返回 `[]`） | `abnormal_record` `supplier` | 读 | — |
| 11 | `startAbnormal` | :762 | store_manager/purchaser/super_admin + 门店归属 | `abnormal_record` | 写 | 否 |
| 12 | `resolveAbnormal` | :778 | 同上 | `abnormal_record` `message` | 写 | 否 |
| 13 | `closeAbnormal` | :830 | 同上 | `abnormal_record` | 写 | 否 |
| 14 | `getOrderStats` | :855 | 任意登录（角色 scope） | `purchase_order` | 读（count 聚合） | — |
| 15 | `settleReceipt` | :898 | GLOBAL | `receipt` `abnormal_record` `receipt_item` `supplier` `report_file` `report_version_counter` | 写 | CAS 锁（:928） |
| 16 | `regenerateOrderReports` | :1047 | GLOBAL | `purchase_order(_item)` `report_file` … | 写 | 否 |
| 17 | `repriceReceipt` | :1094 | GLOBAL | `receipt_item` `supplier_product_price` `abnormal_record` | 写 | 否 |
| 18 | `regenerateReceiptReports` | :1164 | GLOBAL | `receipt` `receipt_item` `supplier` `report_file` `purchase_order` | 写 | 否 |
| 19 | `cancelOrder` | :1338 | GLOBAL | `purchase_order` `report_file` `message` | 写 | **是**（:1360） |
| 20 | `requestCancel` | :1428 | GLOBAL | `purchase_order` `message` | 写 | CAS（:1452） |
| 21 | `remindAudit` | :1478 | chef/store_manager/purchaser/super_admin + 门店归属 + 1h 限频 | `purchase_order` `message` | 写 | CAS（:1505） |
| 22 | `verifyManualOrder` | :1545 | submit→VOUCHER_SUBMIT；approve/reject→GLOBAL | `purchase_order` + 云存储 `deleteFile` | 写 | CAS（:1581/:1616/:1628） |
| — | default | :1671 | — | — | 返回 `{code:-1,msg:'不支持的数据操作'}` | — |

辅助函数（非 action）：`getSessionUser`:17、`requireUser`:45、`findCategory`:83、`createMessage`:187、`getStoreManagerId`:209、`resolveActiveRecipient`:224、`getSupplierUsers`:254、`sendSubscribeMessage`:269、`notifySuppliersNewOrder`:296、`csvField`:350、`safePathPart`:357、`getNextVersion`:361、`regenerateApprovedOrderReports`:390、`publicMessage`:627。

---

## 3. 逐 action 详解

### 3.1 主数据：`saveProduct` / `toggleProduct` / `saveProduct` 依赖链

- `saveProduct`（:91-130）：`name`/`unit` 非空；`findCategory(categoryId)` 必须命中 `status:1` 的分类；`defaultSupplierId` 若非空必须命中 `supplier.status:1`。写库时把分类的 `category_level_1` / `category_level_2_id` / `category_name` **快照进 product**，供应商只存 id。有 `productId` 走 update，无则生成 `P + Date.now() + 3 字节 hex`。
- `toggleProduct`（:132-141）：`status = status===1 ? 0 : 1` 翻转，**无任何前置校验**（见 §7 R6）。
- `saveSupplier`（:143-174）：名称非空；重名检查用 `where({supplier_name}).limit(100)` 后在内存排除自身 id（:155-161）。**无长度/格式校验**（§7 R7）。
- `toggleSupplier`（:176-185）：翻转 status，**无未完结订单检查**（对比 `setStoreStatus` 有，§5）。

### 3.2 `auditOrder`（:487-625）—— 全流程最严谨的 action

1. 状态枚举校验（:490）、订单存在（:496）。
2. **禁自单自审**（:498-503）：`auditorId = user_id || _id`，与 `[order.created_by, auth.user._id]` 比对，覆盖 created_by 存 user_id 或 _id 两种历史写法。
3. 幂等：`order_status` 不在 `['submitted','pending_approval']` 直接拒绝（:504-506）。
4. 驳回必填原因（:507-509）。
5. 改量校验（:516-534）：`items` 非数组拒绝；每个 `itemId` 必须在库内 `validIds` 中；`approveQty` 必须 `Number.isFinite && > 0 && <= sourceItem.order_qty`。**注意 `> 0` 而非 `>= 0`**，避免 0 量静默清空该行。
6. **事务 + 事务内复查**（:536-575）：`transaction.rollback({code,msg})` 抛自定义消息，外层 catch 用**子串匹配**（:573）翻译回业务文案 —— 因为 SDK 把 rollback 信息塞进 `errMsg`，这种写法脆弱但已加注释。
7. 改量留档（:554）：`original_order_qty` 仅首次写入，不随重复审核覆盖。
8. **事务后二次复查**（:577-586）：事务提交与后续动作之间存在窗口，若订单已被作废则跳过报表重算与供应商通知（不花钱群发）。
9. 消息写入**降级为警告**（:588-599，P2-16 注释）—— 事务已提交，消息失败不能把整个操作报失败。
10. `qtyChanged` 判定（:603-606）→ `regenerateApprovedOrderReports`（:390-485）：把旧 `store_order_report`/`supplier_order_report` 标记 `superseded`（保留审计痕迹，:419-421），按批准数量重出 ①② 报表，改量时清空 `supplier_confirmations` 并定向发消息提醒（:405-417）；`qtyChanged=false`（补生成场景）跳过重置，避免误发消息。
11. 审核通过 → `notifySuppliersNewOrder`（:296-346）：按供应商分组计数（跳过 `is_manual`，:300-302），**先写站内消息（必写兜底）再发微信订阅消息（尽力而为）**。`SUBSCRIBE_TEMPLATE_ID = ''`（:244）→ 当前只记日志不发（:270-273）；43101 未订阅错误降级为 debug 日志（:287-288）。**下单明细无价格字段（价格快照在收货时生成），故摘要只报项数不报金额**（:303-304）。

### 3.3 消息三兄弟

- `getMessages`（:640-669）：查询条件**下推数据库**（注释明确说避免"先取全局 100 条再内存过滤"导致门店消息丢失）：
  - `recipientCondition = _.or([{recipient_user_id:''}, {recipient_user_id: userId}, {recipient_user_id: _.exists(false)}])`
  - supplier → `_.and([recipient, {scope_type:'supplier', scope_id: default_supplier_id || ''}])`（:651-654）
  - 非全局（store_manager/chef）→ `_.and([recipient, storeCondition])`，storeCondition 含 `store_id:''` / 本店 / `_.exists(false)`（:654-661）
  - 全局角色 → **只有 recipientCondition，不加 store/scope 过滤**（:650）
  - `orderBy('created_at','desc').limit(100)`，**无分页参数、无 offset**。
  - 已读合并：`read: !!message.read || readBy.includes(userId)`（:666），兼容旧数据双轨制。
- `markMessageRead`（:671-691）：归属校验 `belongsToUser`（recipient 为空或等于自己）+ `belongsToStore`（全局或 store 为空或本店），任一不满足 `-403`。已读用 `read_by: _.push(userId)` + 去重，**同门店其他成员的未读状态不受影响**（:682-689）。
- `markAllMessagesRead`（:693-709）：先调 `getMessages`，再对返回的未读消息**逐条 `doc().get()` + `update()`**（最多 100 条 = 200 次串行 DB 往返，见 §7 R8）。

### 3.4 异常记录：`getAbnormalRecords` / `startAbnormal` / `resolveAbnormal` / `closeAbnormal`

- 状态机：`pending → processing → resolved → closed`，每步都校验前置状态（:771 / :791 / :841），越级操作被拒。
- 门店归属校验在三个写 action 中重复出现（:768 / :788 / :838）：非全局角色只能处理 `store_id === default_store_id` 的记录。
- `getAbnormalRecords`（:725-760）：chef 直接返回 `[]`（:728）；非全局按 `default_store_id` 过滤；供应商名称批量回查（20 个 id 一批，:741-745）；`ABNORMAL_TYPE_NAMES`/`ABNORMAL_STATUS_NAMES` 字典翻译（:711-723），含注释说明 `missing_price` 缺失时列表会显示裸英文。
- `resolveAbnormal`（:778-827）：`paymentDecision` 白名单 `['pay_received','reject']`（:794），非白名单归为 `''`；写库后发 2 条消息（:806-816 定向店长；:820-826 门店广播"待补结算提醒"）。**这两条消息没有 try/catch**（§7 R2）。
- 异常记录 id 约定：`{receiptId}_{行序号}_{type}`（:949 注释）。注意 `type` 可能是 `missing_price`（含下划线），故解析只用 `parts[0]`/`parts[1]`，是安全的。

### 3.5 `getOrderStats`（:855-893）

注释明确说明用**服务端 count 聚合**替代"前端拉全量再 filter"（超 100 条即失真）。四个 count `Promise.all` 并行。角色口径：chef 加 `created_by` 过滤（只看自己的单）；store_manager 按门店；全局可按 `event.storeId` 指定；无 `default_store_id` 的 chef/store_manager 返回 `-403`。`to_verify`（待核销手动单）仅全局角色统计，其余固定 `{total:0}`（:880-882）。

### 3.6 `settleReceipt`（:898-1041）—— 异常处理后补结算

- 前置：异常必须全部 `resolved`/`closed`（:909-914）；已补过则拒绝（:916-923，检查 `report_id` 以 `receiptId + '_S'` 结尾）。
- **P1-2 并发锁**（:927-936）：条件更新抢占 `settle_lock`，锁带 `settle_lock_at` 时间戳，超 10 分钟视为崩溃残留可接管（自愈）。注意 `settle_lock_at` 存的是**数字** `Date.now()`（:932），与全站 `db.serverDate()` 不一致，但 `_.lt(数字)` 对缺失字段/null 仍成立（BSON 类型序），功能上没问题。
- **P0-2 只结算增量**（:939-973）：只取 `payment_decision === 'pay_received'` 且 `status !== 'closed'` 的异常解锁行，不再把全部可付款行重复计入 —— 注释明确说明这与原 ⑥ 账单合计 ≡ 应付总额。手动行显式排除（:954 / :973）。
- **finally 必释放锁**（:1031-1040），失败可重试，成功由 `_S` 幂等检查兜底。
- 严重问题：中途失败 + `_S` 用 `some()` 判定的组合（§7 R1）。

### 3.7 报表补生成三兄弟

- `regenerateOrderReports`（:1047-1082）：按订单重读 `purchase_order_item`，走 `regenerateApprovedOrderReports(order, items, qtyMap, false)` —— **`qtyChanged=false` 避免误清供应商确认、误发"改量"消息**（`业务模糊点确认清单.md:367` 有对应决策记录）。成功后清 `missing_reports` 标记。
  - **全项目无前端调用者**（grep 结果：仅 `dataService/index.js:1047`/`:1666` 自身、`createPurchaseOrder/index.js:463` 的注释、以及 docs 引用）。仍是 GLOBAL_ROLES 可调的写接口 → 死入口（§7 R9）。
- `repriceReceipt`（:1094-1162）：缺价补账。只处理 `!is_manual && supplier_id && price_snapshot <= 0` 的行（:1106）；批量取 `supplier_product_price` 的 `is_current:1` 价（20 个 product_id 一批，:1112-1119），键 `${supplier_id}|${product_id}`；逐行更新 `price_snapshot` + `payable_flag:true`（:1126-1128）；关闭对应 `missing_price` 异常（:1136-1148）；最后调 `regenerateReceiptReports(event)`（:1152）。
- `regenerateReceiptReports`（:1164-1331）：重出 ③门店收货 / ④门店带价 / ⑤供应商到货 / ⑥供应商带价 四类报表。带价类只取 `payable_flag !== false && price_snapshot > 0` 行（:1232 / :1292），`excluded_rows` 记录剔除数（:1253 / :1313）。金额计算 `Math.round(x*100)/100` 两位小数（:1239-1240）。失败时 catch 返回已生成清单（:1319-1322）—— **部分成功可见但不回滚**。
  - `report_id` 用固定 `_RG` 后缀（:1221 / :1248 / :1281 / :1308），**不唯一**。注释（:1093）自称"幂等"，实际无任何去重。

### 3.8 `cancelOrder` / `requestCancel`

- `cancelOrder`（:1338-1425）：必填原因（:142）；已有收货（`partial_received`/`received`/`receipt_abnormal`）拒绝（:1353-1355）；仅 `submitted`/`approved`/`report_generated` 可作废（:1356-1358）。**事务内复查**（:1360-1380）防止窗口内并发收货把已收货订单作废（P1-3 注释）。作废时清空 `supplier_confirmations`（P2-23，:1383-1385）；手动单重置 `verify_status` 并留 `verify_cancel_note`（清单 #23，:1391-1395，凭证文件**保留在 `vouchers/` 留痕，只重置状态**）。**P1-4 注释**（:1397-1398）记录了一个重要 SDK 限制：事务内 `where().update()` 不携带 transactionId、不在事务保护内，因此改为 `where().get()` + 逐条 `doc().update()`（:1399-1406）。
- `requestCancel`（:1428-1475）：条件更新防重复（:1452-1465）。**`:1447` 的门店归属校验是死代码** —— 前面 `requireUser(event, GLOBAL_ROLES)` 已把所有非全局角色拦掉，`!GLOBAL_ROLES.includes(...)` 恒为 false（§7 R10）。

### 3.9 `remindAudit`（:1478-1539）

- 限频 1 小时（:1498-1502），**条件更新兜底防并发**（:1505-1517，`audit_reminded_at` 用 `_.exists(false)` 或 `_.lt(now-1h)`）。
- **P2-17**（:1525-1537）：消息写失败时**回退限频标记**，否则催办永久丢失且 1 小时内无法重试。这是全函数里唯一"标记推进 → 副作用失败 → 回滚标记"的完整实现，值得推广到 `resolveAbnormal`。

### 3.10 `verifyManualOrder`（:1545-1644）

- 权限两段：`submit` → VOUCHER_SUBMIT_ROLES（含 store_manager），`approve`/`reject` → GLOBAL_ROLES（:1548）。
- **P0-5 凭证校验**（:1553-1558）：数量 ≤ 9；每个 fileID 必须是字符串且 `startsWith('vouchers/{orderId}/')` —— 防越权引用他人/他门店的凭证路径。
- `storeId` 归属：store_manager 只能操作本店（:1566-1568）。
- `submit`（:1574-1608）：门槛放宽到 `received`/`receipt_abnormal`/`partial_received` 三态（P0-7 修订，注释说明原因：少货常态停在 partial_received，要求 received 会让主链路永不可达）；已 `approved` 拒绝重提；条件更新 `verify_status: _.neq('approved')`（:1581-1583）防重传盖回；被替换的旧凭证图用 `cloud.deleteFile` 清理（:1596-1606），**只删通过前缀校验的本订单文件**（P0-5 防越权删除）。
- `reject`（:1613-1626）：必填原因（P2-24），驳回原因单独存 `verify_reject_note`，不覆盖提交人备注。
- `approve`（:1627-1643）：金额必须 `Number.isFinite && > 0`；条件更新保证只有 pending 可裁决。

---

## 4. 事务与幂等盘点

| 手段 | 位置 | 评价 |
|---|---|---|
| `db.runTransaction` + 事务内复查状态 | `auditOrder:536`、`cancelOrder:1360` | 正确。两处都处理了 `rollback({code,msg})` 自定义信息回传 |
| CAS 条件更新（`where({...}).update()` + `stats.updated`） | `settleReceipt:928`（带 10 分钟过期锁）、`requestCancel:1452`、`remindAudit:1505`、`verifyManualOrder:1581/1616/1628` | 正确且是本项目主流幂等手段 |
| `getNextVersion` CAS 取号 | :361-383 | 注释记录修复历史：原 `_.inc` 后回读在并发下会回读到同一最终值导致 report_id 碰撞，改为"读旧值 → 条件更新 count=旧值 → 重试 5 次" |
| 事务后二次复查 | `auditOrder:577-586` | 处理事务提交与副作用之间的窗口 |
| 副作用失败回滚标记 | `remindAudit:1525-1537` | 唯一实例，`resolveAbnormal` 缺失（R2） |
| 副作用失败降级为警告 | `auditOrder:588-599` | 正确 |

**未用事务/锁的写入链（脏数据风险集中区）**：
1. `resolveAbnormal`：`abnormal_record` 置 `resolved` → 发 2 条消息（无 try/catch）。
2. `settleReceipt`：逐条置 `receipt_item.payable_flag=true` → 逐供应商上传 CSV + add `report_file`（中途失败不回滚、锁释放、`_S` 幂等检查挡住重试）。
3. `repriceReceipt`：逐条改 `price_snapshot` + 关异常 → `regenerateReceiptReports`（失败则改价不可逆、入口返回"没有缺价行"）。
4. `regenerateOrderReports` / `regenerateReceiptReports`：每份报表一条 `report_file`，固定后缀不唯一，无去重。

---

## 5. 数据删除语义与级联

**结论：dataService 内零硬删除任何数据库记录。**

| 实体 | 删除语义 | 证据 |
|---|---|---|
| `product` | 软删：`status` 翻转 | :132-141 |
| `supplier` | 软删：`status` 翻转 | :176-185 |
| `purchase_order` | 状态机终态 `cancelled`，保留全部历史字段 | :1381-1396 |
| `abnormal_record` | 状态机终态 `closed`，保留 `resolution`/`resolved_by`/`resolved_at` | :796-805 / :843-850 |
| `report_file` | **标记 `superseded`，云存储文件不删**（保留审计痕迹） | :419-421、:1399-1406 |
| 云存储凭证图 | **唯一真删除**：`cloud.deleteFile`，仅限 `vouchers/{orderId}/` 前缀内、被本次重传替换的文件 | :1596-1606 |
| `message` | 从不删除（无 TTL 证据） | 全文无 message 删除 |

**门店停用（级联问题的实际落点，在 authService）**：`setStoreStatus`（`authService/index.js:622-655`）是软删，`status` 0/1；**有前置阻断**：停用前 `count` 未完结采购单（`draft/submitted/pending_approval/approved/report_generated/partial_received/to_receive`），`>0` 则拒绝（:639-648）。**不做任何级联清理** —— 历史单据、`app_user.default_store_id`、product/supplier 关系全部保留，可恢复（:620-621 注释）。

**级联缺口**：`toggleSupplier`（:176-185）与 `toggleProduct`（:132-141）**完全没有等价的前置检查**：
- 停用供应商后，`product.default_supplier_id` 仍指向它；`getSuppliers` 的 `product_count` 仍计数；
- 下单侧靠 `supplier.status:1` 过滤（`saveProduct:100-104` 校验 defaultSupplierId 必须启用）阻断新引用；
- 但 `repriceReceipt`（:1114-1118）按 `supplier_product_price.is_current=1` 补价时**不按 supplier.status 过滤** → 停用供应商的历史收货单仍可补出账单。业务口径上是否可接受需确认（R11）。

---

## 6. 消息中心机制

### 6.1 写入方（`message` 是 6 个云函数共用的通知总线）

| 写入方 | 位置 | type | 定向方式 |
|---|---|---|---|
| dataService（`createMessage`:187-206） | 8 处调用 | approval / order / abnormal / cancel | storeId 广播 或 recipientUserId 定向 或 `scope_type='supplier'`+`scope_id` |
| `createPurchaseOrder` | :57、:473 | order / abnormal | storeId 广播；报表失败定向 adminId |
| `createReceipt` | :145、:564、:753 | **receive** / abnormal | recipientUserId 或 storeId |
| `confirmSupplierOrder` | :98 | — | — |

- dataService 内 `createMessage` 调用点：`auditOrder:589`、`notifySuppliersNewOrder:324`、`regenerateApprovedOrderReports:410`、`resolveAbnormal:806`、`resolveAbnormal:820`、`cancelOrder:1416`、`requestCancel:1467`、`remindAudit:1519`。
- **`type:'receive'` 不在 dataService 内产生**（全文无匹配），由 `createReceipt:148/567` 写入；前端 `message.js:61-62` 的 `type==='receive'` 判断和 `bizId` 前缀 `RCP` 兜底是有意义的。
- 收件人解析：`resolveActiveRecipient`（:224-239）—— 创建人已停用/不存在时改发本店店长，仍查不到回退 `''`（门店广播），**避免消息落进死信箱**；`getStoreManagerId`（:209-220）查不到时 catch 降级为门店广播。

### 6.2 已读状态：双轨制且 `read` 是死字段

- 写入端恒为 `read: false`（:201）。**全项目 grep 无任何地方写 `read: true`** → `read` 布尔字段是死字段，靠读端 `!!message.read || readBy.includes(userId)`（:666）兼容。
- `read_by` 数组：push 前 `includes` 去重（:684-689），但**无上限、无裁剪**，且 message 文档无 TTL → 集合与文档无限增长（R12）。
- **schema 漂移**：`createReceipt`/`createPurchaseOrder` 写的消息多数**没有 `read_by` 字段**（`createPurchaseOrder:57-67`、`createReceipt:145-157` 均无），只有 `createPurchaseOrder:483` 有 `read_by:[]`；也没有 `scope_type`/`scope_id`。dataService 读端用 `Array.isArray(message.read_by) ? ... : []`（:664）做了兼容，是正确防御。

### 6.3 推送时机

审核通过 → ①站内消息（**必写兜底**）→ ②微信订阅消息（尽力而为）。`SUBSCRIBE_TEMPLATE_ID = ''`（:244）→ 当前订阅消息通道实际**关闭**（:270-273 只记日志）；模板字段配置在 :246-251。供应商门户侧 `supplier-home.js:75-79` 静默拉起 `wx.requestSubscribeMessage` 一次性订阅（授权一次可推一条，注释 :73-74）。触达现状 = 仅站内消息 + 供应商主动进入门户。

### 6.4 两个消息页共用同一集合

`pages/message`（内部员工，**tabBar 页**，`app.json:62-66`）与 `pages/messages`/`supplier-messages`（供应商门户，非 tabBar）都调 `dataService.getMessages`，**无重复建设**，隔离完全依赖服务端角色过滤。

### 6.5 未读计数：前端本地计算，基于截断结果

`message.js:27`、`supplier-messages.js:34`、`supplier-home.js:56`、`index.js:78` 全部是 `messages.filter(m => !m.read).length`，而 messages 最多 100 条 → **历史未读 > 100 时铃铛角标少计**。服务端只有 `getOrderStats` 用 `count()`，消息侧无 count 接口。

---

## 7. 风险清单

严重度：**高** = 数据错误/财务损失/跨角色越权且已可触发；**中** = 功能不可用或需特定条件；**低** = 健壮性/一致性。

| ID | 严重度 | 位置 | 触发条件 | 影响 |
|---|---|---|---|---|
| **R1** | **高** | `settleReceipt:916-923` + `:997-1029` | 补结算过程中，为供应商 A 生成 `_S` 报表成功后、供应商 B 的 CSV 上传或 add 失败（云存储/网络抖动）→ catch 抛错 → finally 释放锁 | 重试时 `settledRes.data.some(r => report_id.endsWith(receiptId+'_S'))` **用 `some()` 而非"所有供应商齐"** → A 的记录命中 → 返回"该收货单已补结算，请勿重复操作"。**供应商 B 的补充账单永久缺失**，且 receipt_item 的 `payable_flag` 已被置 true（:956-958），财务对账出现应收/应账单不一致。根因是幂等判定的粒度错误 |
| **R2** | **中** | `resolveAbnormal:796-826` | `abnormal_record` 已置 `resolved` 后，`createMessage`（:806 或 :820）写入失败 | 顶层 catch 返回"CloudBase 数据操作失败"，用户以为失败而重试 → 但 status 已是 resolved，重试得到"只有处理中异常才能标记为已解决" → **异常实际已解决但用户无法感知**，且"异常已解决""待补结算提醒"两条消息永久丢失（补结算提醒丢失会直接导致供应商账单缺一笔，正是 :818-819 注释想防的事）。对比 `auditOrder:588-599` 有 try/catch 降级、`remindAudit:1525-1537` 有回滚标记，此处缺失，口径不一致 |
| **R3** | **中** | `getMessages:650-661` | 任意 `store_manager` / `chef` 登录并调用 `getMessages`（`message.js:15`、`index.js:54` 即触发） | `notifySuppliersNewOrder:324-331` 产生的供应商定向消息**不传 `storeId`/`recipientUserId`**，故 `store_id=''`、`recipient_user_id=''`。非全局角色的查询只有 recipient/store 两个条件、**没有 `scope_type` 过滤** → `store_id:''` 命中 storeCondition、`recipient_user_id:''` 命中 recipientCondition → **门店角色（含权限最低的 chef）能看到所有门店、所有供应商的新订单通知**（内容含他人门店名、采购单号、该供应商项数）。与 :652 注释声明的"供货商消息按供货商档案定向（不绑门店）"的设计意图相悖。附带后果：全员未读角标虚高；`markMessageRead:679-681` 同样不校验 scope → 门店角色可把供应商消息标已读（不改供应商的 read_by，故不污染供应商未读态） |
| **R4** | **中** | `repriceReceipt:1121-1152` | 补价成功（price_snapshot 已改、异常已关）后 `regenerateReceiptReports` 失败 | 价格不可逆；重试 `repriceReceipt` 时 `missingItems` 已空（:1106）→ 返回"该收货单没有缺价行，无需补账"，**该入口永久无法重出账单**，只能改调 `regenerateReceiptReports`（receive-list 有单独按钮，但用户不会知道）。`regenerateReceiptReports` 自身 catch 后返回部分成功清单（:1319-1322），不回滚 |
| **R5** | **中** | `getMessages:662` + `markAllMessagesRead:700-707` | 用户历史消息 > 100 条 | 无分页/offset 参数，`limit(100)` 硬编码 → 第 101 条起的历史消息**永不可达**；"全部已读"只覆盖前 100 条 → **第 101 条起的未读永远不会被标记已读**，未读角标永久不消。且循环逐条 get+update，100 条 = 200 次串行往返，有云函数超时风险 |
| **R6** | **中** | `toggleProduct:135`、`toggleSupplier:179` | 调用时 `productId`/`supplierId` 为空/未传（前端崩溃、参数被剥离、直接调云函数） | 无空值校验。`where({product_id: undefined})` 在微信云开发中不会命中"无该字段"而是被忽略/宽松匹配 → `limit(1)` 后可能命中**任意第一条**记录并翻转其 status → 静默误停用无关商品/供应商。攻击面限于 purchaser/super_admin，但数据破坏面大 |
| **R7** | **中** | `regenerateOrderReports:1047-1082`、`regenerateReceiptReports:1219-1315` | 任意 GLOBAL 角色重复调用（无 UI 限制；`regenerateOrderReports` 甚至无前端调用者） | `report_id` 固定后缀（`_A` / `_RG`）不唯一，**无去重**：每次调用新增一批 `report_file` + 版本号递增 + 云存储新文件，旧文件不标记 superseded（`regenerateReceiptReports` 路径）。注释 :1093 自称"幂等"与实际不符。purchaser 循环调用可刷爆 `report_file` 表与云存储配额（`settleReceipt` 有 CAS 锁，这两个没有） |
| **R8** | **中** | `markAllMessagesRead:700-707` | 未读消息接近 100 条 | 逐条 `doc().get()` + `doc().update()` 串行 = 最多 200 次 DB 往返，无批量。云函数默认超时下可能整体超时，用户看到"消息状态更新失败"但其实已改了一部分 |
| **R9** | **低中** | `saveSupplier:146-153`、`saveProduct:94-117` | 直接调云函数或绕过前端 | `supplierName`/`contactName`/`contactPhone`/`remark`/`spec` **均无长度上限、无格式校验**（前端 wxml 也无 `maxlength`；`contactPhone` 的 `type="number"` 只是输入提示）。可写超长字段，导致列表渲染退化、正则检索变慢 |
| **R10** | **低** | `requestCancel:1447-1449` | 永不触发 | `requireUser(event, GLOBAL_ROLES)`（:1431）已拦掉所有非全局角色，`!GLOBAL_ROLES.includes(auth.user.role)` 恒为 false → **门店归属校验是死代码**，且会误导维护者以为该 action 对门店角色开放（与 :1429-1430 注释"取消仅管理员可发起"一致）。删除或改为注释即可 |
| **R11** | **低中** | `repriceReceipt:1114-1118` | 同一 `(supplier_id, product_id)` 存在多条 `is_current=1` 的价格行 | `priceMap` 以 `${supplier_id}\|${product_id}` 为键、遍历时**后者覆盖前者，无确定性排序** → 补价可能取到错误单价，直接写进账单金额。是否可能产生重复 `is_current` 行取决于 price-manage 的写入约束（**待确认**） |
| **R12** | **低** | `message` 集合 + `read_by`（:684-689、:700-706） | 长期运行 | `read_by` 无上限无裁剪；message 无 TTL/归档；`read` 字段永远为 false（死字段）→ 集合单调增长。另外 `createReceipt:147`/`:566` 用固定 `message_id: MSG_RECEIVE_${receiptId}`，同一收货单走两条路径会产生**重复 message_id**（dataService 用随机后缀，:188） |
| **R13** | **低** | `getCategories:60` | 分类数 > 100 | `limit(100)` 硬编码，一级分类 `level1Map` 也随之静默截断 |
| **R14** | **低** | `getMessages`（全局角色分支，:650） | purchaser/super_admin 调 `getMessages` | 管理员可读到**所有** supplier 定向消息（含其他门店订单详情）。设计意图（管理员全局可见）但 `getSuppliers:44-52` 明确给 supplier 角色做了反遍历，两侧口径不对称 |
| **R15** | **低** | `getAbnormalRecords:730-731` | supplier 角色调 `getAbnormalRecords` | 落进 `query.store_id = ''` 分支（supplier 无 `default_store_id`）→ 恰好查不到数据（异常记录 store_id 恒为真值），**安全但靠巧合而非显式拒绝**。应像 `getOrderStats:870` 一样显式 `-403` |
| **R16** | **低** | `message.js:24-25`、`supplier-messages.js:31-32` | 每次都执行 | `cloud.formatDateTime(m.time)` 的结果又被传入 `util.getRelativeTime(cloud.formatDateTime(m.time))` —— 重复格式化。`formatDateTime` 对已是可解析字符串的输入**原样返回**（`cloud.js:113-115`），故幂等无害，纯冗余。另外两处 `getApp()` 结果赋值给 `app` 后从未使用（`message.js:14`、`supplier-messages.js:14` 仅后者用） |
| **R17** | **低** | `store-manage.js:14-17`、`supplier-manage.js:15-18` | purchaser 深链/收藏进入管理页 | 页面内部**无角色判断**，只有 `authGuard.requireLogin()`（仅查登录态，`auth-guard.js:5-14`）。写操作会 403，但 purchaser 能先看到全部列表与按钮。入口已收敛（`index.wxml:50` 门店管理 `wx:if="{{isSuperAdmin}}"`；:25 供应商管理 `wx:if="{{isManager}}"`），属防御纵深缺口 |
| **R18** | **低** | `supplier-manage.js:30-33` + `getSuppliers:64-67` | 供应商数 > 100 | 搜索在**前端内存过滤**，但 `getSuppliers` 本身支持 `keyword` 后端化（:60-62）却未被使用；`limit(100)` 先截断再过滤 → 第 101 个供应商搜不到 |
| **R19** | **低** | `store-manage.js:22` → `authService.getStores:318-321` | store_manager/chef 传 `includeInactive` | `includeInactive` 对所有角色开放（只按 `STORE_ROLES` 收窄到本店），非仅超管。影响面限于本店记录可见性，但与 `authService:318` 注释"供门店管理页拉全量列表"的意图不完全一致 |
| **R20** | **低** | `toggleSupplier:176-185`（对比 `authService.setStoreStatus:639-648`） | 停用供应商 | 门店停用有"未完结采购单阻断"，供应商停用**无等价检查**，且 `repriceReceipt` 补价不按 supplier.status 过滤 → 停用后仍能对该供应商补出账单。业务口径需确认（见 §5） |

**正面发现（已做对的）**：CSV 公式注入防护 `csvField:350-355`（`=+-@` 开头加单引号、双引号转义、`0xFEFF` BOM 头）；文件名路径清理 `safePathPart:357-359`；自单自审禁止 `:498-503`；`approveQty` 严格 `>0` 且 `<= order_qty` `:530`；`verifyManualOrder` 的凭证数量上限 + 前缀校验 + 只删本订单文件 `:1553-1558`、`:1596-1606`；`getNextVersion` CAS 取号 `:361-383`；`settleReceipt` 带过期自愈的并发锁 `:927-936`；`remindAudit` 限频 + 失败回滚标记 `:1497-1537`；`auditOrder`/`cancelOrder` 事务内复查状态；**无 Excel/CSV 导入逻辑**（只有导出），故导入侧注入风险不适用。

---

## 8. 前端契约一致性对照

### 8.1 `store-manage` → **authService（不是 dataService）**

| 页面调用 | action | 后端 | 状态 |
|---|---|---|---|
| `store-manage.js:22` | `authService.getStores({includeInactive:1})` | `authService:314-332` | ✅ `includeInactive` 已实现（`:319-321`） |
| `:65-69` | `updateStore({storeId, storeName})` | `:590-618` | ✅ 字段全匹配 |
| `:71-74` | `createStore({storeName})` | `:516+` | ✅ 页面未传 `storeCode`，后端支持可选 |
| `:103-107` | `setStoreStatus({storeId, status})` | `:622-655` | ✅ `status` 0/1 白名单校验（`:627`） |

- 前端传了但后端不用的字段：**无**。
- 后端支持但页面不用的字段：`createStore.storeCode`（页面提示"编号将自动生成"，wxml:54）。
- 命名注意：页面 JS 变量叫 `stores`，列表 key 是 `storeId`（wxml:12），而 `authService.publicStore` 的字段口径需与之一致 —— 页面能正常渲染说明契约对齐。

### 8.2 `supplier-manage` → **getSuppliers（读）+ dataService（写）双入口**

| 页面调用 | 目标 | 后端 | 状态 |
|---|---|---|---|
| `:22-24` loadData | `getSuppliers({includeInactive:true})` | `getSuppliers/index.js:39-68` | ✅ `includeInactive` 受 `isManager` 限制（`:53-54`） |
| `:76-81` 保存 | `dataService.saveSupplier` | `dataService:143-174` | ✅ |
| `:105-108` 启停 | `dataService.toggleSupplier` | `:176-185` | ✅ |

- 前端传字段 `supplierId/supplierName/contactName/contactPhone/remark`（`:78-80`）→ 后端 `:146-153` 全部使用，**无冗余字段**。
- wxml:20 展示 `item.productCount` → 来自 `getSuppliers` 计算并经 `cloud.normalizeSupplier:196` 映射 `product_count → productCount`，契约成立。
- wxml:23 `goProducts` → `/pages/price-manage/price-manage?supplierId=`，与 dataService 无关。
- **缺口**：后端 `getSuppliers` 有 `keyword` 参数（`getSuppliers:60-62`），前端搜索却走内存过滤（`:30-33`），见 R18。

### 8.3 `message` / `supplier-messages` → dataService

| 页面调用 | 入参 | 后端返回字段 | 页面使用 |
|---|---|---|---|
| `getMessages` | 无 | id / messageId / type / title / content / bizId / read / time | id、type、title、content、bizId、read、time 全用；**`messageId` 完全未用** |
| `markMessageRead` | `{id}`（= `message._id`，`publicMessage:629`） | `{code:0}` | ✅ |
| `markAllMessagesRead` | 无 | `{code:0}` | ✅ |

- **前端传了但后端不用的字段：无。**
- **前端依赖但后端未返回的字段：无。**
- 两个页面 wxml/wxss 近乎完全重复（唯一差异：message.wxml:11-15 按 approval/order/receive/abnormal 分 5 个图标分支，supplier-messages.wxml:11-12 只按 order/其他 2 个分支）；`.json` 标题不同（"消息中心" / "我的消息"）；跳转逻辑不同（message.js:51-69 按 role/type/bizId 前缀三路分流，supplier-messages.js:52-56 一律跳 supplier-orders）。可抽公共组件，但当前无功能缺陷。
- `supplier-messages.js:16-19` 额外做了 role 校验（非 supplier 则 reLaunch 登录），`message.js` 没有（tabBar 页，靠后端过滤兜底）。

### 8.4 反向核对：dataService 的 22 个 action 的前端调用方

全部 22 个 action 都有前端调用者，**唯一例外是 `regenerateOrderReports`**（仅文档与 `createPurchaseOrder:463` 注释引用）—— 见 R7。其余调用分布：`getCategories`×2（purchase-create、product-manage）、`saveProduct`/`toggleProduct`（product-manage）、`auditOrder`×4（approval-list×2、approval-detail×2）、`getMessages`×4（message、supplier-messages、supplier-home、index）、`getOrderStats`×1（index）、异常 4 件套（abnormal-list）、`settleReceipt`/`regenerateReceiptReports`/`repriceReceipt`（receive-list）、`verifyManualOrder`×2 / `remindAudit` / `requestCancel` / `cancelOrder`（purchase-detail）。

---

## 9. 待确认清单

1. **R11 的前置条件**：`supplier_product_price` 是否保证 `(supplier_id, product_id)` 在 `is_current=1` 下唯一？（决定补价取错单价是否可实际发生，在 price-manage 写入侧）
2. **`report_file.report_id` 是否有数据库唯一索引**？决定 `_RG`/`_A` 重复写入是"数据冗余"还是"直接写失败"。
3. **`report-list` / `report-history` 页如何展示 `status='superseded'` 与同 `report_id` 的多条 `_RG` 记录**？（决定 R7 在 UI 上是否可见）
4. **`type:'receive'` 消息的完整来源清单**：已确认 `createReceipt:145/564/753`、`createPurchaseOrder:57/473`、`confirmSupplierOrder:98` 也写 message 集合，但本代理未逐行读这三个文件，其 `store_id`/`recipient_user_id`/`scope_type` 填充口径需与 §6.2 的 schema 漂移结论合并复核。
5. **`confirmSupplierOrder:98` 的消息是否设置了 `scope_type:'supplier'`**？若未设，R3 的越权可见面会进一步扩大。
6. **云函数超时配置**（`markAllMessagesRead` 200 次串行往返、`settleReceipt`/`regenerateReceiptReports` 多份 CSV 上传是否在限内）。
7. **`message` 集合与 `abnormal_record` 是否有 TTL/归档策略**（决定 R12 的增速）。
8. **停用供应商后是否应阻断 `repriceReceipt` 补价**（业务口径，R20 / §5）。
9. **R3 的修复方案需兼容旧数据**：`createReceipt`/`createPurchaseOrder` 写的消息**没有 `scope_type` 字段**，故过滤条件必须写成 `_.or([{scope_type: _.neq('supplier')}, {scope_type: _.exists(false)}])`，不能只用 `_.neq('supplier')`（对缺失字段行为取决于 SDK/BSON 序）。
