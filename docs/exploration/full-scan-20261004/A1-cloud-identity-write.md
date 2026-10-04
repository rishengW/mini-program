# A1 云函数身份与写入路径勘察报告

勘察日期：2026-10-04　分支：backup
范围：`cloudfunctions/{authService,dataService,createPurchaseOrder,createReceipt,confirmSupplierOrder}/`
方法：逐文件完整读取，无抽样；仅用 Read / Glob / Grep。未执行 git 命令，未修改任何已有文件。

---

## 1. 文件清单与职责

| 文件 | 行数 | 职责 |
|---|---|---|
| `cloudfunctions/authService/index.js` | 684 | 认证与主数据管理：登录/登出/会话校验/改密、账号 CRUD（软删除）、门店 CRUD 与停用；角色与门店/供货商绑定校验 |
| `cloudfunctions/dataService/index.js` | 1681 | 通用数据服务网关：分类/商品/供应商主数据、订单审核（含改量）、消息中心、异常台账、首页统计、异常后补结算、报表补生成/补价、作废与取消申请、催审、手动单凭证核销 |
| `cloudfunctions/createPurchaseOrder/index.js` | 516 | 采购单创建 / 草稿编辑 / 提交；生成①门店下单报表、②供应商订货汇总（CSV 上传云存储） |
| `cloudfunctions/createReceipt/index.js` | 799 | 收货验收（B3 分批收货）；生成③门店收货、④门店带价、⑤供应商到货、⑥供应商带价账单 |
| `cloudfunctions/confirmSupplierOrder/index.js` | 124 | 供货商确认接单 / 标记发货，写入订单 `supplier_confirmations[supplier_id]` |

合计 3804 行，全部读完。

---

## 2. action 路由表

### 2.1 authService — `exports.main` index.js:657-684，`switch (event.action)`

| action | 行号 | 目标函数 |
|---|---|---|
| login | 660 | `login` 156-247 |
| validate | 661 | `validateSession` 251-267 |
| logout | 662 | `logout` 269-286 |
| changePassword | 663 | `changePassword` 288-312 |
| getStores | 664 | `getStores` 314-332 |
| createStore | 665 | `createStore` 516-587 |
| updateStore | 666 | `updateStore` 590-618 |
| setStoreStatus | 667 | `setStoreStatus` 622-655 |
| listUsers | 668 | `listUsers` 341-349 |
| createUser | 669 | `createUser` 351-391 |
| updateUser | 670 | `updateUser` 393-440 |
| resetPassword | 671 | `resetPassword` 442-468 |
| setUserStatus | 672 | `setUserStatus` 473-506 |
| deleteUser | 673 | `deleteUser` 510-512（委托 setUserStatus status:0） |
| default | 674 | `{code:-1,'不支持的认证操作'}` |

外层 try/catch：676-683，对「集合不存在」返回初始化文案。

### 2.2 dataService — `exports.main` index.js:1650-1681

| action | 行号 | 目标函数 |
|---|---|---|
| getCategories | 1653 | 54-81 |
| saveProduct | 1654 | 91-130 |
| toggleProduct | 1655 | 132-141 |
| saveSupplier | 1656 | 143-174 |
| toggleSupplier | 1657 | 176-185 |
| auditOrder | 1658 | 491-629 |
| getMessages | 1659 | 644-673 |
| markMessageRead | 1660 | 675-695 |
| markAllMessagesRead | 1661 | 697-713 |
| getAbnormalRecords | 1662 | 729-764 |
| startAbnormal | 1663 | 766-780 |
| resolveAbnormal | 1664 | 782-832 |
| closeAbnormal | 1665 | 834-856 |
| getOrderStats | 1666 | 859-897 |
| settleReceipt | 1667 | 902-1045 |
| repriceReceipt | 1668 | 1098-1166 |
| regenerateReceiptReports | 1669 | 1168-1335 |
| regenerateOrderReports | 1670 | 1051-1086 |
| cancelOrder | 1671 | 1342-1429 |
| requestCancel | 1672 | 1432-1479 |
| remindAudit | 1673 | 1482-1543 |
| verifyManualOrder | 1674 | 1549-1648（action 参数 `verifyAction`: submit/approve/reject，1550 行） |
| default | 1675 | `{code:-1,'不支持的数据操作'}` |

辅助（非对外入口）：`createMessage` 187-206、`getStoreManagerId` 209-220、`resolveActiveRecipient` 224-239、`notifySuppliersNewOrder` 296-346、`sendSubscribeMessage` 269-293、`getSupplierUsers` 254-266、`regenerateApprovedOrderReports` 394-489、`csvField` 350-355、`safePathPart` 357-359、`getNextVersion` 361-387。

### 2.3 单入口云函数（无 action 分发）

- `createPurchaseOrder/index.js:138` — 入参：`authToken, orderId, storeId, storeName, orderDate, deliveryDate, createdBy, createdByName, items, remark, orderStatus='submitted', requestId=''`（148-160）
- `createReceipt/index.js:169` — 入参：`authToken, purchaseOrderId, storeId, storeName, receivedBy, overallRemark, photoFileIds, items, receiptDate`（174-182, 327）
- `confirmSupplierOrder/index.js:50` — 入参：`authToken, orderId, action ∈ {confirm, ship}`（58-62），`ACTION_STATUS` 映射到 confirmed/shipped（14）

---

## 3. 数据契约（按集合分组）

### `app_user`
字段：`user_id`(U+时间戳+hex)、`username`(唯一，3-32 位 a-z0-9_.-)、`name`、`mobile`、`role`(chef/store_manager/purchaser/super_admin/supplier)、`role_label`、`default_store_id`、`default_supplier_id`、`status`(0/1)、`password_salt`(16B hex)、`password_hash`(PBKDF2-SHA256, 32B, 120000 轮)、`password_iterations`、`openid`(登录时由 `cloud.getWXContext()` 写入)、`sessions[{token_hash, expires_at}]`(上限 5，挤出最旧)、`session_token_hash`/`session_expires_at`(旧单会话兼容)、`login_fail_count`、`login_locked_until`(失败 5 次锁 10 分钟)、`last_login_at`、`created_at`、`updated_at`。
索引依赖：`username`（登录唯一查）、`session_token_hash`、嵌套字段 `sessions.token_hash`、`status`、`role+default_store_id+status`（查店长/供货商账号）。
会话 TTL 7 天（`SESSION_TTL_MS` 13 行）；token 为 32 随机字节 hex，库内只存 SHA256 摘要。

### `store`
`store_id`('S'+3 位序号，创建后不可改)、`store_name`(唯一，≤30 字)、`store_code`(默认取 store_id)、`status`、`created_at`、`updated_at`。停用前置条件：无未完结订单（642 行 `ACTIVE_ORDER_STATUS`）。

### `supplier`
`supplier_id`('SUP'...)、`supplier_name`(逻辑唯一)、`contact_name`、`contact_phone`、`remark`、`status`、`created_at`、`updated_at`。**无停用前置检查**（见 M7 相关项）。

### `product`
`product_id`('P'...)、`product_name`、`category_level_1`、`category_level_2_id`、`category_name`、`unit`、`spec`、`default_supplier_id`、`manufacturer_name`、`status`、`created_at`、`updated_at`。

### `category`
`category_id`(**数字**)、`category_level_1`、`category_level_1_name`、`category_level_1_icon`、`category_name`、`sort_no`、`icon`、`status`。

### `supplier_product_price`
`price_id`、`supplier_id`、`product_id`、`price`、`currency`('CNY')、`effective_date`(**字符串 'YYYY-MM-DD'**)、`expiry_date`、`is_current`(0/1)、`updated_by`、`created_at`、`updated_at`。调价采用「置旧行 is_current=0 + insert 新行」，**历史行永不删除**，每次调价 +1 行。

### `purchase_order`
`purchase_order_id` == `order_no`、`store_id`、`store_name`、`order_date`、`delivery_date`、`order_status`、`backfilled`、`is_manual`、`verify_status`、`verify_amount`、`verify_voucher_file_ids`、`verify_note`、`verify_submitted_by`、`verify_submitted_at`、`verify_reject_note`、`verified_by`、`verified_at`、`verify_cancel_note`、`request_id`、`remark`、`created_by`、`created_by_name`、`created_at`、`submitted_at`、`audit_remark`、`audited_by`、`audited_at`、`updated_at`、`supplier_confirmations{<supplier_id>: {status: confirmed|shipped, updated_at, updated_by}}`、`missing_reports`、`cancel_reason`、`cancelled_by`、`cancelled_at`、`cancel_requested`、`cancel_requested_by`、`cancel_request_reason`、`cancel_requested_at`、`audit_reminded_at`。

**`order_status` 枚举**：`draft`(写)、`submitted`(写)、`rejected`(写)、`approved`(写)、`partial_received`(写)、`receipt_abnormal`(写)、`received`(写)、`cancelled`(写)；**从未被写入**：`pending_approval`、`report_generated`、`to_receive`、`completed`（仅出现在白名单/常量里）。

**`verify_status` 枚举**：`''`(非手动单)、`none`(手动单初始/作废重置)、`pending`、`approved`、`rejected`。

### `purchase_order_item`
`item_id`(`${orderNo}_${i+1}`)、`purchase_order_id`、`product_id`、`product_name_snapshot`、`category_snapshot`、`unit_snapshot`、`supplier_id`、`order_qty`、`original_order_qty`（首次改量留档）、`approved_qty`、`is_manual`、`remark`、`created_at`、`updated_at`。

### `receipt`
`receipt_id`('RCP'+时间戳+6 hex)、`purchase_order_id`、`store_id`、`store_name`、`receipt_date`、`backfilled`、`received_by`、`receipt_status`('completed'|'abnormal')、`overall_remark`、`photo_file_ids`(≤9，须以 `receipts/<purchaseOrderId>/` 开头)、`batch_no`、`is_final`、`missing_reports`、`settle_lock`(bool)、`settle_lock_at`(**number 毫秒，与同集合其他 Date 字段类型不一致**)、`created_at`、`updated_at`。

### `receipt_item`
`receipt_item_id`(`${receiptId}_${i+1}`)、`receipt_id`、`purchase_order_item_id`、`product_id`、`product_name`、`supplier_id`、`received_qty`、`order_qty_snapshot`、`unit_snapshot`、`price_snapshot`、`payable_flag`、`is_manual`、`is_shortage`、`is_quality_issue`、`is_wrong_item`、`remark`、`created_at`、`updated_at`。

### `abnormal_record`
`abnormal_id`(`${receiptId}_${行序号}_${type}`)、`receipt_id`、`purchase_order_id`、`product_id`、`supplier_id`、`store_id`、`store_name`、`type`(`shortage`/`quality`/`wrong_item`/`missing_price`)、`description`、`status`(`pending`→`processing`→`resolved`→`closed`)、`resolution`、`payment_decision`(`pay_received`/`reject`/`''`)、`handled_by`、`resolved_by`、`resolved_at`、`closed_by`、`closed_at`、`created_at`、`updated_at`。

### `report_file`
`report_id`、`report_type`(`store_order_report`/`supplier_order_report`/`store_receipt_report`/`store_receipt_price_report`/`supplier_receipt_report`/`supplier_receipt_price_report`)、`report_scope`('store'|'supplier')、`scope_id`、`scope_name`、`related_date`、`source_order_id`、`basis_date_type`('order_date'|'receipt_date')、`file_name`、`file_url`、`file_version`、`generated_at`、`generated_by_system`、`status`('generated'|'superseded')、`has_abnormal`、`abnormal_summary`、`excluded_rows`、`regenerated`、`settle_for_receipt`、`settle_type`('increment')、`updated_at`。
report_id 命名：`RPT_SO_<order>` / `..._A`(审核后重发) / `RPT_SR_<receipt>` / `RPT_SRP_` / `RPT_SUR_<sid>_<receipt>` / `RPT_SURP_` / `..._RG`(补生成) / `..._S`(补结算)。

### `report_version_counter`
`_id` = `${reportType}_${scopeId}_${relatedDate}`、`count`、`updated_at`。CAS 取号：读旧值 → `where({_id, count:旧值}).update(count:旧值+1)` → `updated===1` 才算抢到，最多 5 次重试，失败抛错。

### `message`
`message_id`、`type`(`order`/`receive`/`abnormal`/`approval`/`cancel`)、`title`、`content`、`biz_id`、`recipient_user_id`(''=广播)、`store_id`、`scope_type`('supplier')、`scope_id`、`read`(bool，**全代码库只写 false，无 true 写入点**)、`read_by[]`、`read_at`、`created_at`。

---

## 4. 关键流程与调用链

### 4.1 登录 / 鉴权
- 登录：`authService:156` 查 `app_user.username` → 锁定检查 168-172 → `verifyPassword` 174（PBKDF2 + `timingSafeEqual` 42）→ 失败则 `login_fail_count: _.inc(1)` 177 + 条件更新 `_.gte(5)` 写锁 182-190 → 状态/expectedRole 校验 194-197 → 供货商走 `findSupplier` 203，门店走 `getDefaultStore` 206 → 生成 32 字节 token 210 → `sessions` 数组挤到 5 条 213-216 → `doc.update` 写入并记 openid 218-230。
- 会话裁决：`getSessionUser`（5 处重复实现）先查 `{status:1, sessions:{token_hash}}` → 未命中回退 `{session_token_hash, status:1}` → 逐条校验 `expires_at > Date.now()`。
- 角色门：`requireUser(event, roles)` `dataService:45-52`；`requireSuperAdmin` `authService:334-339`。
- openid：**仅**在登录时由 `cloud.getWXContext().OPENID` 写入 `app_user.openid`（authService:229），供订阅消息 touser 使用；各业务云函数**不使用** openid 做权限判定，权限全部基于 `authToken → user.role + default_store_id/default_supplier_id`。

### 4.2 下单（createPurchaseOrder）
`getSessionUser` 143 → 角色白名单 chef/store_manager/super_admin/purchaser 145 → 日期校验 163-177 → 幂等预查 184-201 → 门店归属 211-252 → 商品规范化 265-306（档案商品按 `product.status=1` 批量取，20 个一批）→ 手动单约束 309-316 → 事务 353-406（新建：事务内幂等复查 366-376；编辑：更新头 + 删旧明细 355-362）→ 草稿直接返回 410-412 → 提交消息 414 → ① 门店下单报表 419-438 → ② 供应商订货汇总（按 supplierId 分组，跳过 `unknown`）440-489 → 报表失败走 `markOrderReportsMissing` 495-508（打 `missing_reports` + 定向通知超管），**仍返回 code 0**。

### 4.3 收货（createReceipt）
角色 store_manager/super_admin/purchaser 173 → 门店归属与门店有效性 183-199 → 明细数上限 50（203-207，事务操作数 ≈6×行数）→ 字段完整性 208-215、照片前缀 219-226 → 订单加载与状态白名单 `['approved','report_generated','partial_received']` 228-241 → 以库内 `purchase_order_item` 为准重建明细 248-303（不信任客户端的 productId/supplier/unit/orderQty）→ 事务外历史实收聚合 263-273 + 预检超收 285-290 → 批次号预取 311-315 → 店长 ID 预取 334 → 短收标记 340-343 → **价格快照** 348-399（按 `effective_date <= receiptDate` 取最新档，同日优先 `is_current`；手动行跳过；0 价→`payableFlag=false`+`isMissingPrice`）→ **事务** 409-583（复查状态 410-421、事务内重算历史 423-447、终态判定 `txIsFinalBatch` 451-456、非终批清 short 459-461、事务内批次号 466-471、写 receipt 474、写 receipt_item + abnormal_record 490-551、更新 order_status 556-558、写 message 568-582）→ 报表 ③④⑤⑥ 585-740 → 报表失败补偿 741-773 → 返回 775-785。

### 4.4 供应商确认（confirmSupplierOrder）
`getSessionUser` 52 → role 必须 supplier 54 → `default_supplier_id` 55 → action 映射 confirmed/shipped 59-62 → **越权防护**：该订单必须含本供应商商品行 65-69 → **条件更新原子写入** `where({purchase_order_id, order_status: _.in(allowed)})` 78-80 → ship 时向门店写消息 86-117（best-effort）。状态白名单：confirm 需 `['approved','report_generated','to_receive']`，ship 另加 `partial_received`（12-13）。

### 4.5 审核（dataService.auditOrder 491-629）
角色 purchaser/super_admin → 自单自审拦截 502-507 → 状态白名单 508 → 改量校验 `0 < approveQty <= order_qty` 526-538 → 事务（复查状态 542-550、逐行改量并首次留档 original_order_qty 551-565、写审核结论 566-574）→ 事务后复查防并发作废 581-590 → 审核消息 592-603 → `qtyChanged` 时 `regenerateApprovedOrderReports`（重置 `supplier_confirmations`、旧报表标 superseded、按批准量重出①②）→ `notifySuppliersNewOrder`（站内消息 scope_type=supplier + 微信订阅消息）。

### 4.6 dataService 通用读写
主数据：`getCategories`(status=1, sort_no asc, limit 100)、`saveProduct`/`toggleProduct`、`saveSupplier`/`toggleSupplier`。
消息：`getMessages` 过滤条件下推数据库（recipient OR 空串/自/不存在，再按 role 叠 store 或 supplier scope）；`markMessageRead` 逐条 `read_by: _.push`；`markAllMessagesRead` 逐条 N+1。
异常台账：`pending→processing→resolved→closed` 单向机，非全局角色限本店；`resolveAbnormal` 附 `payment_decision`。
结算：`settleReceipt`（GLOBAL_ROLES）→ 全异常已结案 → `_S` 幂等检查 → 条件更新抢锁（10 分钟自愈）→ 仅结算 `pay_received` 解锁行（**排除 status='closed'**）→ 增量账单 → finally 释放锁。
补偿：`regenerateOrderReports` / `regenerateReceiptReports` / `repriceReceipt`（补价 → 刷新 price_snapshot + 关缺价异常 → 重出③④⑤⑥，`_RG` 后缀）。
单据治理：`cancelOrder`（事务内复查 + 清 supplier_confirmations + 报表 superseded）、`requestCancel`（条件更新防重）、`remindAudit`（1 小时限频 + 消息失败回退标记）、`verifyManualOrder`（submit/approve/reject 分段权限 + 凭证路径前缀校验 + 条件更新状态机）。

---

## 5. 权限与数据隔离模型

| 维度 | 口径 |
|---|---|
| 身份来源 | `authToken`（32B 随机 hex，库内只存 SHA256）。`getSessionUser` 是**唯一**身份裁决点，5 个文件各自重复实现 |
| 权限模型 | 无 openid 权限判定；全部基于 `user.role` + `default_store_id` / `default_supplier_id` |
| 全局角色 | `GLOBAL_ROLES = ['super_admin','purchaser']`（dataService:8），跨门店 |
| 门店角色 | `chef`、`store_manager`：读写被强制收敛到 `default_store_id`（createPurchaseOrder:212-218、createReceipt:184-190、getMessages:658-664） |
| 供货商角色 | 只能看/确认 `supplier_confirmations` 中属于自己 `supplier_id` 的订单（confirmSupplierOrder:65-69 用订单明细行反查），消息按 `scope_type='supplier' + scope_id` 定向（getMessages:655-657） |
| 单据资产 | 草稿属门店资产：本店店长可代改本店任意人的草稿（createPurchaseOrder:230-238），含离职员工草稿 |
| 自单自审 | 禁止（dataService:502-507），比较 `created_by` 与审核人 user_id/_id 双值 |
| 客户端数据 | 收货侧**完全不信**客户端的 productId/supplierId/unit/orderQty，以 `purchase_order_item` 为准（createReceipt:246-303）；付款资格 `payableFlag` 服务端裁决（390-392）；照片/凭证 fileID 强制路径前缀校验（createReceipt:222-226、dataService:1557-1562） |
| 隔离缺口 | 见 M5（消息已读授权缺 scope 维度）、M11（getStores 不限角色）、L12（用户名时序侧信道） |

越权风险评估：三个写入路径的越权防护整体较扎实（角色 + 门店/供货商归属双重校验 + 条件更新原子化），主要缺口集中在消息中心的已读操作与元数据读取接口，而非核心金额路径。

---

## 6. 发现的问题

### 【阻断】
无。

### 【高】

**H1｜dataService/index.js:946 — 「关闭」异常永久吞掉付款裁决，造成供应商账单永久缺行（漏账）**
`payReceivedRecords = abnormalRes.data.filter(item => item.status !== 'closed' && item.payment_decision === 'pay_received')`。
触发：管理员 `resolveAbnormal(paymentDecision:'pay_received')`（782-832）→ `closeAbnormal`（834-856，仅要求 `status==='resolved'`）→ `settleReceipt`：此时 917 行的 `openAbnormal`（pending/processing）为空，流程通过，但 946 行把已关闭的裁决记录排除，最终 966-968 返回「没有因异常处理解锁的明细行，无需补结算」。
影响：该行永远不进任何补充账单，无告警、无标记，只能人工对账发现。

**H2｜authService/index.js:499-503 — 停用账号未清 `sessions` 数组，重新启用后旧会话复活**
`setUserStatus` 停用分支只写 `session_token_hash:''` 与 `session_expires_at:null`，**未清 `sessions`**。对比 `changePassword:305`、`resetPassword:461`、`updateUser:433` 均执行 `sessions: []`。
触发：停用某账号 → 7 天 TTL 内重新启用（setUserStatus status:1）→ 该账号任一未过期设备无需重新登录即恢复访问。
影响：与 470-472 行注释「防止将来重新启用时旧会话复活」直接矛盾；离职/被停用账号横向访问风险。

**H3｜dataService/index.js:417 — 超级管理员可被 updateUser 降级，无「最后一名超管」保护**
`const effectiveRole = target.username === 'admin' ? 'super_admin' : input.role`，仅硬编码保护用户名 `admin`。`setUserStatus` 有「至少保留一名在岗超管」保护（484-493），`updateUser` 完全没有。
触发：`updateUser({id:<非 admin 的超管>, role:'chef', defaultStoreId:'S001'})`；超管也可自降。
影响：系统失去管理入口（账号/门店/供应商/审核/作废全部 403），只能直改数据库恢复。

**H4｜createPurchaseOrder/index.js:301（+dataService:302、453；createReceipt:354）— 商品无默认供应商时被三处静默丢弃，采购闭环断裂且无提示**
`supplierId: product.default_supplier_id || ''` 落库为空串后：① 下单报表归入 `unknown` 组并在 465 行 `continue` 跳过；② `notifySuppliersNewOrder` 301-302 行跳过不通知；③ 收货取价 354 行 filter 掉、395 行必然落 `missing_price` 异常。
触发：商品档案未配 `default_supplier_id` 即下单并提交。
影响：该商品永不生成供应商订货单、供货商收不到任何通知、收货后必进异常台账并漏进结算账单；管理员全程无感知。

**H5｜createPurchaseOrder/index.js:364-376 — 新建路径幂等复查为 check-then-act，并发窗口内可双建单**
事务内 `where({request_id, created_by}).get()` 后再 `add()`，两次并发请求都读不到重复即双双提交。注释已承认「终极防线是 (request_id, created_by) 唯一索引，见修复计划 B6-2」——该索引不存在。
触发：前端超时重试或双击，两请求落在同一事务提交窗口。
影响：两张不同 `purchase_order_id` 的同业务单，各自生成报表（版本号继续自增）与消息，需人工对账删除。

### 【中】

**M1｜dataService/index.js:548, 1374, 1378, 1382（createPurchaseOrder:373 同样）— `transaction.rollback({code,msg})` 自定义信息可能被丢弃**
调用处传对象，随后靠 `err.errMsg.includes('该订单已经审核')` 等子串匹配还原业务文案。wx-server-sdk 的 `Transaction.rollback()` 文档签名为无参（本地未安装 node_modules，无法实测，需确认）。若参数被忽略，并发审核/并发作废会 `throw err` 到 1677 行外层 catch，用户只看到「CloudBase 数据操作失败，请稍后重试」，无法判断订单其实已处理成功或已被他人处理。

**M2｜createReceipt/index.js:783 — 返回值 `priceReportsSkipped: hasAbnormal` 与实现语义相反**
624-626 行注释与 630 行 `items.filter(item => item.payableFlag && !item.isManual)` 明确带价报表**始终生成、只过滤可付款行**。前端若据此提示「已跳过带价报表」即误导。

**M3｜createReceipt/index.js:263-267 与 428-431 — 历史实收聚合 `limit(1000)` 可被截断，超收防线失效**
两张查询均 `where({purchase_order_item_id: _.in(ids)}).limit(1000)`。100 行订单经多批收货后 `receipt_item` 行数持续增长（每批最多 50 行），超过 1000 行时事务外预检与事务内 `txHistoryQty` 都被截断，`historyQty + receivedQty > orderQty` 判断基于不完整数据。
影响：允许超收、账单多计金额，且事务内判定同样失效。

**M4｜dataService/index.js:810-830 / 1420-1427 / 1471-1477 — 前置写入已提交后 createMessage 抛错被误报为整体失败**
`resolveAbnormal`、`cancelOrder`、`requestCancel` 中 createMessage 无 try/catch，一旦消息集合写入失败，整个 action 落到 1677 行返回「CloudBase 数据操作失败」，而异常/订单状态实际已变更，用户会重复提交。`auditOrder:600-603` 已按 P2-16 修复，其余 handler 未同步。

**M5｜dataService/index.js:682-685 — markMessageRead 归属校验缺 scope 维度**
`belongsToUser`（recipient_user_id）+ `belongsToStore`（store_id）两条，未校验 `scope_type`/`scope_id`。供货商 `default_store_id` 为空，故 `!message.store_id` 恒真，可读取并把任何 `store_id='' && recipient_user_id=''` 的消息标记已读。当前这类消息恰好只有供货商定向消息（`notifySuppliersNewOrder:324-331` 不传 storeId），叠加 message `_id` 不可猜测，实际危害有限，但授权模型漏了租户维度，后续新增广播类消息会立刻扩大危害面。

**M6｜dataService/index.js:1447 vs 1357 — requestCancel 与 cancelOrder 状态机不闭合，形成死工单**
requestCancel 接受 `partial_received`，cancelOrder 明确拒绝 `partial_received`（1357）。门店可对已部分收货订单提交取消申请，管理员收到「收到取消申请」消息后永远无法执行作废。

**M7｜dataService/index.js:1357-1362 — 已确认/已发货订单仍可作废，且供应商侧零通知**
cancelOrder 只挡 `partial_received/received/receipt_abnormal`，`approved` 可通过，即使 `supplier_confirmations` 已有 confirmed/shipped。事务内 1389 行清空确认标记，但 S3 口径「供应商触达走线下」意味着供应商可能已备货/发货后才被内部消息提醒。

**M8｜dataService/index.js:921-926 / 960-962 — settleReceipt 对 receipt_item 的解锁动作无幂等标记**
`payable_flag: true` 的置位在账单生成之前发生，且无「本行已由哪次补结算解锁」的记录。账单生成中途崩溃时 finally 释放锁、第二次重试会重新找到相同解锁行——功能上能自愈，但缺少可审计的幂等锚点，无法区分「本次解锁」与「历史已解锁」。

**M9｜createPurchaseOrder/index.js:289-290 — 手动商品 productId 不做存在性校验**
档案商品在 293-294 行有 `productMap` 校验，手动商品直接 `{...item, productId}` 落库。客户端可写入任意字符串（含与真实商品同号的 ID）到 `purchase_order_item.product_id`，污染报表、异常台账，并影响 `repriceReceipt` 的 `${supplier_id}|${product_id}` 价格匹配键。

**M10｜createPurchaseOrder/index.js:355-362 — 草稿编辑单事务操作数最高 201 次**
`1 update + ≤100 remove + ≤100 add`。createReceipt 注释（204-206）按「6×行数」估算并据此把行数压到 50，但未给出平台事务操作上限的确切值。若上限低于 201，100 行草稿的编辑/提交会硬失败。需确认平台单事务操作上限。

**M11｜authService/index.js:322-330 — getStores 不限角色，供货商可拉全量门店列表**
仅 `getStore(sessions)` 后按 `STORE_ROLES` 收敛，`purchaser/super_admin/supplier` 均返回全部门店（limit 100）。门店编号与名称对外部供货商账号可见。

**M12｜dataService/index.js:732 — chef 角色调用 getAbnormalRecords 静默返回空数组**
与 start/resolve/closeAbnormal 的 403 口径不一致，前端无法区分「无异常」与「无权限」，也不符合其余接口的最小权限表达。

### 【低】

L1｜createReceipt/index.js:132-167 — `ensureReceiptMessage` 全文件无调用点，死代码。
L2｜dataService/index.js:1144-1153 — repriceReceipt 直接 pending/processing→resolved，只写 `handled_by` 不写 `resolved_by`/`resolved_at`，审计字段与 resolveAbnormal 不一致。
L3｜dataService/index.js:1451 — 门店归属校验为死代码（1435 行已 requireUser(GLOBAL_ROLES)，角色必在全局集合内）。
L4｜dataService/index.js:936, 1039 — `settle_lock_at` 写 `Date.now()`（number），同集合其他时间字段用 `db.serverDate()`（Date），类型不一致。
L5｜getSessionUser 在 5 个文件中重复实现；authService:106-131 与其余 4 份写法不同（无 `Array.isArray` 守卫、用 `(user.sessions||[])`），后续单一版本修复必然漂移。
L6｜`message.read` 全代码库只写 false、从无 true 写入点（getMessages 靠 `read_by` 兜底）；`markMessageRead` 写单个 `read_at`，被后读者覆盖，实为「最后一次读取时间」。
L7｜authService:341-348 `listUsers` limit 100 无分页；getCategories / getMessages / getAbnormalRecords 同样固定 limit 100，超量静默截断。
L8｜authService:544-547 createStore 序号探测全量取 limit(1000)，门店超 1000 家后取不全 → 撞号 → 3 次重试后失败。
L9｜死状态枚举 `pending_approval`/`report_generated`/`to_receive`/`completed` 在本范围 5 文件内从无写入点，却散布在 8+ 处白名单（createReceipt:239,417；dataService:508,547,876,1357,1360,1381,1447；confirmSupplierOrder:12-13；authService:642）。无功能影响，但白名单与实际状态机不一致，易误导维护。
L10｜同 report_type `store_order_report` 的两个版本列结构不一致：createPurchaseOrder:422 头不含「备注」，dataService:431 含「备注」+「审核后重发」；收货侧 ③⑤ 报表同样在 infoHead 上多出「报表失败后补生成」列。按列位置解析的下游会错位。
L11｜createPurchaseOrder:422 CSV「经办人」取客户端 `createdByName`（未校验），库内 `created_by_name` 取服务端 user.name，两者可能不一致。
L12｜authService:174 用户不存在时不执行 pbkdf2，与存在用户路径耗时差异构成用户名枚举时序侧信道；失败锁定为账号级，无 openid/IP 维度限速。
L13｜authService:214 sessions 清理用 `new Date(s.expires_at).getTime() > Date.now()`，非法日期字符串得到 NaN → 静默丢弃该会话（属预期，但无日志）。
L14｜dataService:259 getSupplierUsers limit 20，供货商账号数超 20 时其余账号收不到微信订阅消息（站内消息不受影响）。
L15｜createPurchaseOrder:166 `isBackfilled` 仅字符串比较、actualDate 无下限（可传 2000-01-01）；createReceipt:327-329 receiptDate 同样无下限。
L16｜createReceipt:395 `isMissingPrice` 判定未排除 hardAbnormal 行：质量问题且缺价的行会同时登记 quality 与 missing_price 两条异常。

---

## 7. 代码与注释 / 日志不一致

1. `authService:470-472` 注释「停用即可断会话……防止将来重新启用时旧会话复活」 vs `499-503` 实际未清 `sessions` 数组（对应 H2）。
2. `createReceipt:624-626` 注释「带价报表始终生成」 vs `783` 返回值 `priceReportsSkipped: hasAbnormal`（对应 M2）。
3. `dataService:1450` 注释「门店归属校验：全局角色可跨门店，门店角色仅可对本门店订单提交取消申请」 vs 1435 行 requireUser(GLOBAL_ROLES) 已使门店角色无法进入，注释描述的分支不存在（对应 L3）。
4. `dataService:1088-1097` 两个注释块顺序与实际函数顺序错位：1088-1092 描述收货报表补生成、1093-1097 描述补价补账，但 `regenerateReceiptReports`（1168）定义在 `repriceReceipt`（1098）之后却被前一个注释先行描述，阅读时易把注释安到错误的函数上。
5. 返回契约不一致：`createPurchaseOrder` 返回 `reportsGenerated: 数量`，`createReceipt` 同样只返回数量，但 `regenerateReceiptReports:1334` 返回 `generated: 明细数组`。调用方无法从下单/收货返回值判断具体缺哪类报表。
6. `dataService:1401-1402` 注释声明「事务内 where().update() 不携带 transactionId」，但同一文件 `423-425`（regenerateApprovedOrderReports，事务外，可接受）与 `1081-1083`、`1330-1332`（事务外）使用了 where().update()；而 `createReceipt:568` 的 `transaction.collection('message').add()` 未被该结论覆盖——两处结论并存但未明确 add() 是否在事务内，注释口径不完整。

---

## 8. 未确认的业务模糊点

1. **`receipt_abnormal` 是否为终态？** createReceipt:555 会写入该状态，但全代码库无任何「异常全部结案后 receipt_abnormal → received」的跃迁。settleReceipt 不改 order_status。后果：订单永远停在 receipt_abnormal，`getOrderStats:878` 的「已收货」卡片（仅计 `received`）不计入，而 `getPurchaseOrders:89` 单独计数。仪表盘与列表口径不一致，需产品确认是否刻意。
2. **手动单凭证核销金额无任何校验**（dataService:1631 仅要求 >0）。是否需要与「实收数量 × 参考单价」做偏差阈值告警（如 ±20%）？当前金额完全由管理员手填且是唯一金额来源。
3. **`closeAbnormal` 的语义**：关闭一条带 `payment_decision='pay_received'` 的记录会使其永久不补结算（H1）。「关闭」究竟是仅结案，还是撤销付款裁决？是否应禁止关闭已带付款裁决的记录，或关闭时回滚裁决并告警？
4. **商品无默认供应商时的正确业务路径**（H4）：应否在下单/审核环节强制补供应商？还是允许「先下单后分配」？当前代码没有任何「分配供应商」入口，auditOrder 改量也不改 `supplier_id`。
5. **已发货订单可否作废**（M7）：当前允许，且供应商侧无任何系统通知（S3 走线下）。是否应禁止「已发货订单作废」，或强制下发供应商通知？
6. **审核改量只允许减量**（dataService:534 要求 `approveQty <= order_qty`）。门店漏报需要增补时的唯一路径是新建一张单——这是刻意约束还是遗漏？
7. **会话策略**：7 天 TTL、无 refresh、多设备上限 5（挤出最旧）。供货商与店长是否需要差异化策略？
8. **收货异常类型 quality/wrong_item 完全由收货方自助勾选**，且直接决定是否计入付款结算（createReceipt:383-392）。是否需要供应商申诉/双方确认环节？

---

## 9. 覆盖率声明

- 实际读取文件数：**5 / 5**，无遗漏、无抽样。
- 逐文件完整行数：authService/index.js 684、dataService/index.js 1681、createPurchaseOrder/index.js 516、createReceipt/index.js 799、confirmSupplierOrder/index.js 124，合计 **3804 行**，全部读完。
- 交叉验证：另以只读方式核对了 `cloudfunctions/updateProductPrice/index.js:82-123`（确认 `effective_date` 为 `'YYYY-MM-DD'` 字符串，与 createReceipt 的 `_.lte(receiptDate)` 字符串比较口径一致），并用 Grep 全文扫描 `order_status` / `effective_date` / `rollback(` / `payment_decision` / `settle_lock` / 各状态枚举的写入点分布。
- 未执行任何 git 命令，未修改任何已有文件，未访问外网。`docs/exploration/coverage-20261004/` 未触碰。
- 发现统计：【阻断】0、【高】5、【中】12、【低】16，另代码/注释不一致 6 条、业务模糊点 8 条。
- 局限：本地未安装 `wx-server-sdk`（`cloudfunctions/*/node_modules` 不存在），M1 关于 `transaction.rollback()` 是否接受参数的结论基于文档签名推断，需在部署环境实测确认；平台单事务操作上限（M10）与 (request_id, created_by) 唯一索引缺失（H5）依赖云端配置，未能在本地验证。
