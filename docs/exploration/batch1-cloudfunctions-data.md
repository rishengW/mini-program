# 批 1：云函数 + 数据层 探索报告

> 范围：`cloudfunctions/`（20 个云函数 index.js + 20 个 package.json）、`seed-data/`（16 个文件）、`scripts/build-icons.js`
> 状态：**进行中**（本版本覆盖 authService / dataService / createPurchaseOrder / createReceipt + 全部 20 个 package.json）
> 方法：逐行读代码，不采信注释。结论均带 `文件:行号`。拿不准标「待核实」。

---

## 0. 技术底座（20 个 package.json）

- 所有 20 个云函数依赖 **仅** `wx-server-sdk: ~2.6.3`，唯一例外 `importProducts` 额外依赖 `xlsx: ^0.18.5`（SheetJS）。
- **无任何共享模块**：`hashToken` / `getSessionUser` / `csvField` / `safePathPart` / `getNextVersion` / `getStoreManagerId` 在 6+ 个云函数里各自复制一份（`authService/index.js:45-47,106-131`、`dataService/index.js:13-43`、`createPurchaseOrder/index.js:9-11,42-94`、`createReceipt/index.js:9-11,41-90`）。`dataService/index.js:349` 注释也承认"云函数各自独立部署，无法共享模块"。
- 后果：鉴权逻辑改动要改 6 处，**任何一处漏改即为越权面**。下文"鉴权矩阵"逐函数列出各自实际写法。
- 全部 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`，未固定环境 ID。

---

## 1. 鉴权 / 权限模型

### 1.1 Token 机制（`authService`）

- 密码哈希：`crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256')`（`authService/index.js:28-36`）。`PASSWORD_ITERATIONS=120000`、`PASSWORD_KEY_LENGTH=32`（L11-12）。
- 校验：`crypto.timingSafeEqual`，先比对 `length`（`L38-43`）—— 常量时间比较正确。
- 会话：`crypto.randomBytes(32).toString('hex')` 原始 token 只在 login 返回一次（`L210`、`L243`），库里只存 SHA256 哈希（`hashToken`，`L45-47`）。**token 不落库明文，正确。**
- 多设备：`user.sessions` 数组每设备一条，`SESSION_TTL_MS = 7 天`（L13），最多保留 5 条、挤出最旧（L212-216）。
- **兼容层**：`getSessionUser` 先查 `sessions` 数组，未命中再回退单会话字段 `session_token_hash` + `session_expires_at`（`authService/index.js:114-124`）。logout 时把 `session_token_hash` 置 `''`、`session_expires_at` 置 `null`（L279-280），**但 `sessions` 数组里其他设备的会话不受影响**（L273-275，注释确认"仅移除当前设备"）。
- 失效判定：`getSessionUser` 用 `where({ status: 1, sessions: { token_hash } })`，即**停用（status=0）账号的会话立即失效**（L109-112）。

### 1.2 登录防爆破

`authService/index.js:166-192`：
- 连续失败 5 次 → 锁 10 分钟。
- 失败计数用 `login_fail_count: _.inc(1)` **原子自增**，再用 `where({ _id, login_fail_count: _.gte(5) })` **条件更新**写锁并归零。
- 这个"条件更新归零"写法正确：并发下第一个请求归零后，其余请求的 where 不匹配，不会重复顺延锁定期。

### 1.3 角色定义（`authService/index.js:14-22`）

| role | roleLabel | 归属 |
|---|---|---|
| `chef` | 门店下单人员 | 门店（`STORE_ROLES`） |
| `store_manager` | 店长 | 门店（`STORE_ROLES`） |
| `purchaser` | 管理员 | 全局（`GLOBAL_ROLES`） |
| `super_admin` | 超级管理员 | 全局（`GLOBAL_ROLES`） |
| `supplier` | 供货商 | 供货商档案 |

`GLOBAL_ROLES = ['super_admin','purchaser']`、`MANAGEMENT_ROLES` 同值（`dataService/index.js:8-9`）；`VOUCHER_SUBMIT_ROLES = ['super_admin','purchaser','store_manager']`（L11）。

### 1.4 账号管理（仅超管）

`requireSuperAdmin`（`authService/index.js:331-336`）：`user.role !== 'super_admin'` → `-403`。
保护超管的 3 道闸：
1. `updateUser`：`effectiveRole = target.username === 'admin' ? 'super_admin' : input.role`（L414），admin 的 username 与 role 均被强制回写（L416、L420）——**超管角色不能被降级**。
2. `setUserStatus`：`target.username === 'admin'` → 拒绝停用（L481）。
3. `updateUser` 不重置 admin 的 `default_store_id`/`default_supplier_id` 逻辑依赖 effectiveRole。

**注意**：`createUser`（L348-388）允许超管创建任意 role（含 `super_admin`），无二级确认。设计如此，但意味着"谁能成为超管"只由超管一个人决定。

### 1.5 逐云函数鉴权矩阵（读实际代码，非注释）

| 云函数 | 取会话方式 | 角色校验 | 行号 | 是否有越权/缺失 |
|---|---|---|---|---|
| authService.login | 无需会话 | `expectedRole` 可选校验 | 156-197 | 无 |
| authService.validate | getSessionUser | 无 | 251-267 | 无（返回自己的 user） |
| authService.logout | getSessionUser | 无 | 269-286 | **仅移除自己的会话**，安全 |
| authService.changePassword | getSessionUser | 无 | 288-312 | 需验证旧密码，安全 |
| authService.getStores | getSessionUser | 无 | 314-329 | 门店角色被强制限定 `default_store_id`（L319-322），安全 |
| authService.createStore / updateStore / setStoreStatus | requireSuperAdmin | super_admin | 503-642 | 无 |
| authService.listUsers / createUser / updateUser / resetPassword / setUserStatus / deleteUser | requireSuperAdmin | super_admin | 338-499 | 无 |
| dataService.getCategories | requireUser(**无角色参数**) | **任意已登录** | 54-56 | 无（只读 status:1 分类） |
| dataService.saveProduct / toggleProduct / saveSupplier / toggleSupplier | MANAGEMENT_ROLES | 2 个全局角色 | 92, 133, 144, 177 | 无 |
| dataService.auditOrder | MANAGEMENT_ROLES | + 自单自审拦截 | 483-498 | 无 |
| dataService.getMessages / markMessageRead / markAllMessagesRead | requireUser(**无角色参数**) | 消息内按 store/scope 过滤 | 612-680 | 见 1.6 |
| dataService.getAbnormalRecords | requireUser(**无角色参数**) | chef 返回空数组 | 695-701 | 无 |
| dataService.startAbnormal / resolveAbnormal / closeAbnormal | `['store_manager','purchaser','super_admin']` + 门店归属复查 | | 733, 749, 801 + 738-740/758-760/808-810 | 无 |
| dataService.getOrderStats | requireUser(**无角色参数**) | 内部按角色收敛 | 825-841 | 无 |
| dataService.settleReceipt / repriceReceipt / regenerateReceiptReports / regenerateOrderReports | GLOBAL_ROLES | 2 个全局角色 | 869, 1034, 1104, 987 | 无 |
| dataService.cancelOrder / requestCancel | GLOBAL_ROLES | | 1278, 1334 | 见 3.4（requestCancel 有死代码） |
| dataService.remindAudit | `['chef','store_manager','purchaser','super_admin']` + 门店归属 | | 1381-1398 | 无 |
| dataService.verifyManualOrder | submit→VOUCHER_SUBMIT_ROLES；approve/reject→GLOBAL_ROLES | | 1437-1440 | 见 5.5 |
| createPurchaseOrder | 内联 getSessionUser | `['chef','store_manager','super_admin','purchaser']` | 99-103 | 见 3.1 |
| createReceipt | 内联 getSessionUser | `['store_manager','super_admin','purchaser']` | 162-164 | 见 4.1 |
| confirmSupplierOrder | **待读** | | | |
| generateSummaryReport | **待读** | | | |
| getProductPrices / getProducts / getPurchaseOrderDetail / getPurchaseOrders / getReceipts / getReportDetail / getReportFileUrl / getReports / getSupplierOrders / getSupplierReceipts / getSuppliers / importProducts / updateProductPrice | **待读** | | | |

**结论（截至本版本）**：4 个已细读云函数中**无"完全无鉴权"的函数**。但 `requireUser(event)` 无角色参数的 6 个 dataService action（getCategories / getMessages / markMessageRead / markAllMessagesRead / getAbnormalRecords / getOrderStats）是"弱鉴权"—— 仅要求有效会话，越权边界完全靠函数体内的 store_id/scope 过滤，改动风险高。

### 1.6 消息可见性口径（`dataService.getMessages`，L612-640）

过滤条件下推到数据库（避免"取全局最新 100 条再内存过滤"）：
- `recipientCondition = _.or([{recipient_user_id:''}, {recipient_user_id:userId}, {recipient_user_id:_.exists(false)}])`（L617-621）
- `supplier` 角色：`_.and([recipientCondition, {scope_type:'supplier', scope_id:user.default_supplier_id}])`（L623-625）
- 非全局角色：`_.and([recipientCondition, storeCondition])`，storeCondition 允许 `store_id:''` 或匹配或字段缺失（L626-633）
- 全局角色（purchaser/super_admin）：**不加门店过滤 → 可见全部门店消息**（L626 的 else-if 不进入）

已读判定：`read_by.includes(userId) || message.read`（L638），`read_by` 数组按用户记录，`read` 布尔保留为全局已读兼容旧数据。

**边界 case（低危）**：`markMessageRead`（L643-663）的归属判定是
`belongsToUser = !message.recipient_user_id || message.recipient_user_id === userId`
`belongsToStore = isGlobal || !message.store_id || message.store_id === default_store_id`
供货商账号 `default_store_id` 为空 → `message.store_id === ''` 恒真，所以**供货商可以 mark-read 任何 `store_id` 为空且 `recipient_user_id` 为空的全局广播消息**。由于 getMessages 对 supplier 强制 `scope_type='supplier'`，实际可见集已被限定；但 `markMessageRead` 接收的是**客户端传入的 message `_id`**，不做"该消息是否在当前用户可见集内"的复查，只做字面归属判定 → 供货商若能拿到某条 `store_id:''` + `recipient_user_id:''` 的消息 `_id`（例如通过异常消息的 `receipt_id`/`biz_id` 猜解），可越权标记其已读。影响限于读状态，**低危，建议加 scope_type 复查**。

### 1.7 错误码约定

| code | 含义 | 出现位置 |
|---|---|---|
| `0` | 成功 | 全部 |
| `-1` | 业务/校验失败，msg 为中文可展示文案 | 全部 |
| `-401` | 会话无效/过期 | authService:253,270,290；dataService:47；createPurchaseOrder:100；createReceipt:163 |
| `-403` | 已登录但无权限 | authService:334；dataService:49,753,739…；createPurchaseOrder:102,162,165,186,190,199；createReceipt:164,176,179,189,233 |

**返回格式不统一（真实存在）**：
- 有权限的：`{ code, msg }` 或 `{ code, data }` 或 `{ code, data, msg }`（createReceipt:728-738 同时给 data + 无 msg）
- `dataService.requireUser` 的**错误对象结构与主返回不同**：`{ error: { code, msg } }`（`dataService/index.js:47,49`），而 `authService.requireSuperAdmin` 也是 `{ error: { code, msg } }`（`authService:333-334`）。调用方 `if (auth.error) return auth.error` 会把 `{ error: {...} }` 整体返回给客户端 —— **客户端收到的错误是 `{error:{code:-403,msg:...}}` 而非 `{code:-403,msg:...}`**。
  - 影响：客户端若统一按 `res.code !== 0` 判定，会把这些鉴权错误当成"成功但无 data"。`auditOrder`/`saveProduct`/`settleReceipt` 等所有走 `requireUser`/`requireSuperAdmin` 的 action 全部受影响。**这是跨 4 个云函数一致存在的响应契约缺陷。**

### 1.8 吞掉的 catch（已细读部分）

| 位置 | 行为 |
|---|---|
| `authService/index.js:663-670` | 兜底 `console.error` + 集合缺失特判 → `'登录数据尚未初始化'`；其余统一 `'登录服务异常'` |
| `dataService/index.js:1553-1556` | 全部异常吞成 `'CloudBase 数据操作失败，请稍后重试'`，**包括 `-401/-403` 以外的内部错误全部无差异返回** |
| `dataService/index.js:216-219,233-235,262-265,332-334,583-586,592-594,1079-1088` | 通知/报表类失败降级为日志，不阻断主流程（有意设计） |
| `createPurchaseOrder/index.js:55-73,433-467` | 消息/报表失败降级；**订单已落库时返回 code:0 + reportWarning**（有意设计） |
| `createReceipt/index.js:95-121,125-158,694-726` | 同上，落库后报表失败返回 code:0 + reportWarning |

**注意 `dataService` 与 `createPurchaseOrder`/`createReceipt` 的失败语义不一致**：前者报表失败返回 `{code:0, data:{reportWarning}}`（auditOrder:596），后者也是 code:0+reportWarning。但 `regenerateReceiptReports` 报表失败返回 `{code:-1, msg:'补生成失败…', data:{generated}}`（L1258-1260）—— **同属 dataService 内部两种语义**，客户端需按 action 分别处理。

---

## 2. 角色 × 能力矩阵（从代码反推）

| 能力 | chef | store_manager | purchaser | super_admin | supplier |
|---|---|---|---|---|---|
| 登录（含 expectedRole） | ✓ | ✓ | ✓ | ✓ | ✓ |
| 创建采购单 | ✓（本店+本人） | ✓（本店） | ✓（任意门店） | ✓（任意门店） | ✗ |
| 编辑草稿 | 本人草稿 | **本店任意人草稿**（createPurchaseOrder:182-188） | ✓ | ✓ | ✗ |
| 审核（改量） | ✗ | ✗ | ✓（非自单） | ✓（非自单） | ✗ |
| 提交收货 | ✗ | ✓（本店） | ✓ | ✓ | ✗ |
| 异常 start/resolve/close | ✗（getAbnormalRecords 返回空） | ✓（本店） | ✓ | ✓ | ✗ |
| 提交付款凭证 (submit) | ✗ | ✓（本店） | ✓ | ✓ | ✗ |
| 核销裁决 (approve/reject) | ✗ | ✗ | ✓ | ✓ | ✗ |
| 补结算 settleReceipt | ✗ | ✗ | ✓ | ✓ | ✗ |
| 补价 repriceReceipt | ✗ | ✗ | ✓ | ✓ | ✓(读价) |
| 作废 cancelOrder | ✗ | ✗ | ✓ | ✓ | ✗ |
| 申请取消 requestCancel | ✗ | ✗ | ✓ | ✓ | ✗ |
| 催审 remindAudit | ✓（本店） | ✓（本店） | ✓ | ✓ | ✗ |
| 改主数据（商品/供应商） | ✗ | ✗ | ✓ | ✓ | ✗ |
| 管账号/门店 | ✗ | ✗ | ✗ | ✓ | ✗ |
| 看自己供货的订单/收货 | | | | | ✓（见 getSupplierOrders/Receipts，待读） |

---

## 3. createPurchaseOrder 详解（471 行）

### 3.1 鉴权与归属

- 角色白名单 `['chef','store_manager','super_admin','purchaser']`（L101-103），supplier 被排除。
- 非全局角色（chef/store_manager）：
  - `storeId` 若传入且 ≠ `default_store_id` → `-403`（L162）
  - `storeId = user.default_store_id`，再查 `store` 集合 `status:1`，不存在 → `-403 '账号未关联有效门店'`（L164-165）
  - **`storeName` 从数据库取**（L166），不信任客户端 —— 正确。
- 全局角色：`storeId` 必填，查 `store` `status:1`（L196-201）。
- **编辑草稿时的门店不可变**：`isGlobal && inputStoreId && existingOrder.store_id !== inputStoreId` → `-403`（L189-191）。

### 3.2 幂等设计（L135-159）

- `request_id` + `created_by` 查 `purchase_order`，`orderBy('created_at','desc').limit(1)`。
- 命中且非"本次正在编辑的同一草稿" → 直接返回原单号 + `idempotent: true`（L157-159）。
- 例外逻辑（L157）：`orderId && orderId === idempotentOrderNo && idempotentIsDraft` → 继续走编辑流程，避免"同页改内容再次保存被幂等短路静默丢弃"。
- **并发缺陷（待确认严重度）**：幂等查重在事务之外，且 `request_id` 未建唯一索引。两个并发请求同时带同一 `request_id` → 都查不到 → 都建单，产生两张同号语义重复的订单（`order_no` 因含随机后缀不同）。**超卖防护不在此层**（采购单本身无库存扣减，风险为重复采购）。
- **`request_id` 空字符串时完全跳过幂等**（L139 `if (trimmedRequestId)`）。

### 3.3 校验清单

| 校验 | 行号 |
|---|---|
| 日期格式严格 `^\d{4}-\d{2}-\d{2}$` 且 `new Date(...).toISOString()` 回环一致（拒绝 2026-13-40） | 126-133 |
| `actualDeliveryDate >= actualDate` | 131-132 |
| 明细数 ≤ 100 | 210 |
| 每行 `productId` 非空、`qty` 有限数、`0 < qty <= 1000000` | 231-234 |
| 商品不可重复（`seenProductIds`） | 235-236 |
| 档案商品必须存在于 `product` 且 `status:1` | 214-223, 242-243 |
| 手动商品 name/unit 必填 | 237-240 |
| 手动商品 ≤ 5 个 | 257-261 |
| **手动商品与档案商品强制拆单** | 262-265 |

- **服务端重建快照**（L244-253）：`product_name` / `category` / `unit` / `supplier_id` 全部从 `product` 集合取，客户端同名参数被覆盖。注释 L212-213 明确"客户端快照只是展示数据"。
  - **例外**：`item.category` 的兜底顺序是 `product.category_name || product.category_level_1 || item.category || ''`（L248）。`category_level_1` 存的是**一级分类编码**（见 seed-data，待核实格式），一旦 `category_name` 为空就会把编码当分类名写进 CSV。
  - **手动商品**：`{...item}` 原样展开（L239），`productName`/`unit` 用客户端值（已 trim），`supplierId` 强制 `''`，`isManual:true`。
- `backfilled = actualDate < today`（L122），today 按 **UTC+8** 计算（L119）。补录历史日期允许，打标供对账区分。

### 3.4 事务（L301-341）

单事务包含：订单头 add/update + 旧明细全删（编辑场景，L304-310）+ 全部新明细 add（L323-340）。
- 订单号：新建时 `orderId || ('PO' + YYYYMMDD + Date.now().toString(36) + random2hex)`（L271）。
- `purchase_order_id` 与 `order_no` **同时写入且同值**（L314），属冗余双字段（历史兼容）。
- `submitted_at` 仅在 `orderStatus==='submitted'` 时写（L297）。
- **`verify_status` 初始值不对称**：手动单 `'none'`，非手动单 `''`（L284）。下游 `getOrderStats` 用 `verify_status: _.neq('pending')` 判定已收（dataService:844），两种写法都能过。
- `created_by` 双值兼容：`user.user_id || user._id`（L293），历史数据可能是 `_id`。

### 3.5 报表生成（事务之外，L348-423）

① `store_order_report`（全量行）、② `supplier_order_report`（按供应商分组，排除手动行 L378）。
- 版本号：`getNextVersion(reportType, scopeId, date)` → `report_version_counter` 集合，**原子 `_.inc(1)` 后读回**，3 次重试（L77-94）。counterId = `${reportType}_${scopeId}_${relatedDate}`。
- CSV 编码：`String.fromCharCode(0xFEFF)`（UTF-8 BOM）+ `csvField` 双引号包裹 + **公式注入防护** `/^[=+\-@]/` 前置 `'`（L42-47）。
- 路径：`reports/{store|supplier}/{date}/{类型}-{safePathPart(name)}-{date}-{orderNo}-v{ver}.csv`（L361,410）。
- `report_file.report_id`：① `RPT_SO_${orderNo}`、② `RPT_SUO_${sid}_${orderNo}`（L365,414）—— **不含版本号**。
- `report_file` 字段：`report_id, report_type, report_scope, scope_id, scope_name, related_date, source_order_id, basis_date_type, file_name, file_url, file_version, generated_at, generated_by_system, status`。

### 3.6 报表失败补偿（L429-469）

- `persistedOrderNo` 非空（订单已落库）→ `code:0` + `reportWarning`，并写 `purchase_order.missing_reports=true` + 定向通知一个 `super_admin`（`limit(1)`，L541-545 —— **只取第一个超管，多超管场景只有 1 人收到**）。
- `message_id: 'MSG_ORDER_REPORT_MISSING_' + orderNo`（L548）—— **稳定 ID，但重复触发会因 ID 不同（orderNo 不同）而不会冲突；同一订单重试报表不会重写此消息**。
- 报表本身未生成 → 前端只能看到 `reportGenerated: false`。

---

## 4. createReceipt 详解（752 行）

### 4.1 鉴权与归属

- 角色 `['store_manager','super_admin','purchaser']`（L164），**chef 不能收货**。
- 非全局角色强制 `storeId = default_store_id` + 门店 status:1 校验（L175-181）。
- **全局角色也被要求传 `storeId`/`storeName`**（L185-187），再查 store 存在（L188-190），并校验 `order.store_id === storeId`（L225-227）。
- 事务前 L233 再做一次 `!isGlobal && order.store_id !== default_store_id` 复查。

### 4.2 照片 fileID 校验（L205-215）

- 数量 ≤ 9。
- 每个 fileID 必须 `String.includes('receipts/${purchaseOrderId}/')`。
- **弱校验**：`includes` 是子串匹配，`cloud://xxx/bcreceipts/PO123/evil.jpg` 可通过；且未校验 `cloud://` 前缀。实际风险低（fileID 只能读到自己上传的文件），但校验本身不严格。

### 4.3 反伪造：订单明细以服务端为准（L237-292）

- `purchase_order_item` 按 `purchase_order_id` 全量读回（limit 1000）。
- 客户端每行必须以 `orderItemId` 命中服务端行，否则 `-1`；重复提交同一行也 `-1`（`seenOrderItems`，L267-270）。
- `productId` / `productName` / `supplierId` / `isManual` / `orderQty` / `unit` **全部用服务端值覆盖**（L280-290），客户端同名参数被丢弃。
- `receivedQty` 必须 `typeof === 'number'` 且有限数（L199-200），严格类型，字符串 `"2"` 会被拒。

### 4.4 超收防护（三层）

1. **事务外预检**（L252-279）：`historyQtyMap` 聚合全部 `receipt_item`（`purchase_order_item_id in [...]`，limit 1000），`historyQty + receivedQty > orderQty` → 拒绝。
2. **事务内复查**（L398-419）：重新聚合历史，超收抛 `OVER_RECEIVE` 错误码，`runTransaction` 回滚。
3. 错误在 L746-747 被翻译成中文 msg。

**这是"超卖/超付"防护的核心，写法正确（事务内二次校验）。**

### 4.5 ⚠️ 缺陷：`isFinalBatch` 在事务外计算 → 并发分批收货可让订单永久卡在 `partial_received`

- `isFinalBatch`（L373-379）基于**事务外**的 `historyQtyMap` 计算。
- 事务内（L384-536）**只复查超收与订单状态，不重算 `isFinalBatch`**；L508-512 直接用事务外的值写 `order_status`。
- 复现场景：订单某行下单量 10，历史 0。
  - 并发批次 A 收 6、批次 B 收 4。两者都读到 history=0。
  - A：累计 6 < 10 → `isFinalBatch=false`；B：累计 4 < 10 → `false`。
  - 超收校验通过（6+4=10 ≤ 10），两笔都落库，`order_status` 最后一次写入为 `partial_received`。
  - **订单实际已收齐，但状态永远停在 `partial_received`**。
  - 补救路径也走不通：L296-298 要求"本批至少收一件或打了异常标记"，而所有行累计已 = 下单量，再提交只能 `receivedQty:0` 且无异常 → 被 L296 拒绝。
- 影响面：`partial_received` 会一直出现在"待收货"统计（dataService:842 `receivableStatuses` 含 partial_received），且 `verifyManualOrder.submit` 要求 `order_status==='received'`（dataService:1458）—— **手动单可能永远无法核销闭环**。
- 严重度：中高（需并发触发，但触发后无自愈路径）。修复建议：事务内按 tx 历史重算 `isFinalBatch`。

### 4.6 缺价与异常类型

`ABNORMAL_TYPE_NAMES`（L52-57）：`shortage` 少货/缺货、`quality` 质量问题、`wrong_item` 错货、`missing_price` 缺价待补。
- 少货判定（L325-328）：`cumulativeQty < orderQty` → 强制 `isShortage=true`（**覆盖客户端值**）。分批未收完的行不算少货。
- `missing_price`（L366-368）：非手动、有供应商、`priceSnapshot <= 0`、`receivedQty > 0`。

### 4.7 价格快照与可付款判定（L333-370）

- 取价：`supplier_product_price` `where({product_id: _.in(chunk20), is_current:1}).limit(100)`，键 `${supplier_id}|${product_id}`（L340-347）。
- **⚠️ limit 截断风险**：一个 20 商品的 chunk 会取出这 20 个商品**所有供应商**的当前价（未按 supplier 过滤）。若结果 > 100 条，`.limit(100)` 静截断，**部分供应商的价格会被漏取 → 记 0 价 → 误报 missing_price 异常**。与 `dataService.repriceReceipt:1051-1058`、`createPurchaseOrder` 供应商批量查询（L389 `.limit(100)` 对 20 个 supplier_id，安全）同类写法。**createReceipt 与 repriceReceipt 两处受影响。**
- `payableFlag`（L360-369）：
  - 手动行 → `false`
  - 否则 `!hardAbnormal && item.payableFlag !== false && priceSnapshot > 0`
  - `hardAbnormal = abnormalTypes.some(t => t !== 'shortage')` —— **少货不排除付款**（按实收数量付款），质量/错货/缺价排除。
- **⚠️ 客户端可控字段泄漏到结算**：`item.payableFlag !== false` 中的 `item.payableFlag` 来自 `items[i]` 的原样展开（L281 `{...inputItem, ...}`），L459 `payable_flag: item.payableFlag !== false` 直接落库。
  - 即**提交收货的店长可以主动把某行 `payableFlag` 设为 `false`，让该行带价账单静默缺席，且不生成任何 abnormal_record**（abnormalTypes 不含 payableFlag）。
  - 后果：账单金额被人为压低、缺漏无审计痕迹、`settleReceipt`/`repriceReceipt` 的"payable_flag !== false"补结算逻辑也会跳过该行（dataService:923,1171,1231）。
  - 严重度：中高。修复建议：服务端不读客户端 `payableFlag`，完全由 `hardAbnormal && price>0` 推导。

### 4.8 事务内容（L384-536）

单事务：
1. 事务内读订单复查状态（L385-396），`received` → 抛 `RECEIPT_EXISTS`；不在可收货白名单 → 抛 `ORDER_NOT_RECEIVABLE`。
2. 事务内复查超收（L398-419）→ `OVER_RECEIVE`。
3. 事务内重算 `batch_no` = 该订单已有 `receipt` 条数 + 1（L421-427）。**批次号事务内生成，正确。**
4. 写 `receipt` 头（L429-443）：`receipt_id`、`purchase_order_id`、`store_id/name`、`receipt_date`、`backfilled`、`received_by`、`receipt_status`（`abnormal`/`completed`）、`overall_remark`、`photo_file_ids`、`batch_no`、`is_final`。
5. 写 `receipt_item`（L445-468）：`receipt_item_id = ${receiptId}_${i+1}`、`purchase_order_item_id`、`product_id`、`product_name`、`supplier_id`、`received_qty`、`order_qty_snapshot`、`unit_snapshot`、`price_snapshot`、`payable_flag`、`is_manual`、`is_shortage`、`is_quality_issue`、`is_wrong_item`、`remark`。
6. 每行每个异常类型写一条 `abnormal_record`（L470-505），`abnormal_id = ${receiptId}_${i+1}_${type}`，`status:'pending'`。
7. 更新 `purchase_order.order_status`（L508-512）：`isFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'`。
8. **写 message 也在事务内**（L520-535），稳定 ID `MSG_RECEIVE_${receiptId}`。异常消息定向店长（`getStoreManagerId`），正常消息门店广播。

### 4.9 4 类报表（L555-693）

| # | report_type | report_id 前缀 | 行范围 | 金额 |
|---|---|---|---|---|
| ③ | `store_receipt_report` | `RPT_SR_${receiptId}` | 全量行 | 无价 |
| ④ | `store_receipt_price_report` | `RPT_SRP_${receiptId}` | `payableFlag && !isManual` | 有小计+合计 |
| ⑤ | `supplier_receipt_report` | `RPT_SUR_${sid}_${receiptId}` | 该供应商全量行 | 无价 |
| ⑥ | `supplier_receipt_price_report` | `RPT_SURP_${sid}_${receiptId}` | 该供应商可付款行 | 有小计+合计 |

- ④⑥ 在无 payable 行时**直接跳过不生成**（L584, L665），此时该供应商账单当批为空 —— 前端只能靠 `excluded_rows` 判断。
- 金额公式（**全项目统一写法**）：
  - 行小计 `subtotal = Math.round(receivedQty * price * 100) / 100`（L591, 674）
  - 合计 `total = Math.round((total + subtotal) * 100) / 100`（L592, 675）
  - 输出 `subtotal.toFixed(2)`（L593, 676）
  - 即**先分行舍入到"分"再累加，累加过程再舍入**，保证"各行小计之和 == 合计"。单位是**元**（不是分），2 位小数。
- `infoHead`（L543）含采购单号/门店/收货日期/下单日期/期望到货/验收人/批次。
- ③⑤ 标记 `has_abnormal` + `abnormal_summary`（L572, 654）。

### 4.10 ⚠️ 返回字段 `priceReportsSkipped` 语义错误

L736：`priceReportsSkipped: hasAbnormal`。
但 B4 设计（L577-579 注释 + L583, L664）是**带价报表仍然生成，只是剔除异常行**。所以只要有可付款行，带价报表就生成了，`priceReportsSkipped=true` 是**错误陈述**。前端若据此提示"因异常未生成带价报表"会误导用户。建议删掉该字段或改为 `payableRowsExcluded`。

### 4.11 ⚠️ `missing_reports` 补偿链路的对称性

- createReceipt 报表失败 → `purchase_order.missing_reports=true` + `receipt.missing_reports=true`（L701-707）+ 通知一个 super_admin。
- 补生成入口 `dataService.regenerateReceiptReports`（L1103-1270）生成 `_RG` 后缀的 4 类报表，成功后清 `purchase_order.missing_reports`（L1263-1268）。
- **但不清 `receipt.missing_reports`**（只在 L705 写）。grep 全文无对 `receipt.missing_reports` 的清除操作 → **收货单上的"缺报表"标记一旦写上就永久存在**（待核实 getReceipts 是否用它展示）。
- 且 `_RG` 报表的 `report_id` 与首次生成的 `RPT_SR_${receiptId}` 不同（多了 `_RG`），所以 report_file 集合里同一收货单会有 2 组记录；但**重复执行 regenerateReceiptReports 会反复插入同 `_RG` report_id 的 `status:'generated'` 行**（L1158-1166 等，无先 superseded 老 `_RG` 行的逻辑）—— 与 `regenerateApprovedOrderReports`（dataService:414-416 先置 superseded）不对称。

---

## 5. dataService 详解（1557 行）

### 5.1 审核 `auditOrder`（L482-597）

- 角色 `MANAGEMENT_ROLES`；状态白名单 `['submitted','pending_approval']`（L499）。
- **自单自审拦截**（L495-498）：`auditorId = user.user_id || user._id`，`order.created_by` 在 `[created_by, user._id]` 内 → 拒绝。注释 L493-494 说明双值兼容。
- 驳回必须填原因（L502-504）。
- 改量校验（L517-529）：`itemId` 必须在服务端行集合内、`qty` 有限数、`0 < qty <= sourceItem.order_qty` —— **只能减量不能加量**。
- 事务（L531-563）：事务内复查状态 → 不匹配则 `transaction.rollback({code:-1, msg:'该订单已经审核…'})`。
  - **⚠️ 待核实**：`transaction.rollback(data)` 的语义。wx-server-sdk 的 `rollback()` 通常不带参数（参数会被当作回调返回值抛出）。L561 的 `err.errMsg.includes('该订单已经审核')` 依赖该参数进入 errMsg。若 SDK 不序列化该对象，用户看到的是通用报错而不是友好文案。**需实测确认，功能不受影响（仍能拦住重复审核）。**
- 事务后：写 message（L565-571）；`qtyChanged`（L575-578，`approvedQty >= 0 && approvedQty !== order_qty`）→ `regenerateApprovedOrderReports`（L580-587，失败仅记 warning）；批准则 `notifySuppliersNewOrder`（L589-595，失败仅记日志）。

### 5.2 `regenerateApprovedOrderReports`（L385-480）

- 先置旧报表 `status:'superseded'`（L414-416，`where source_order_id + report_type in [store_order_report, supplier_order_report]`）—— **与 cancelOrder:1314-1316 同款**。
- 改量时清空 `order.supplier_confirmations`（`_.set({})`，L400-404）并发内部消息（L405-411）。
- report_id 带 `_A` 后缀（L431, 472），与首生成区分。
- `order`/`itemResult.data` 取自**事务前**（L491, L506-509），因此报表里的快照是审核前值 + `qtyMap` 覆盖（L392）。**字段快照用的是 `purchase_order_item` 的快照字段而非重新查 product**，一致性好。

### 5.3 通知供货商（L296-346）

- 手动行跳过（`item.is_manual`，L300）。
- 站内消息必写（`scope_type:'supplier'` + `scope_id`），失败仅记日志（L323-334）。
- 微信订阅消息：`SUBSCRIBE_TEMPLATE_ID = ''`（L244）**默认关闭**，只记日志。`43101`（未订阅）降级为 log（L287-288）。
- 消息内容只报项数不报金额（L321），因为"下单明细无价格字段"（L303）—— 与 createPurchaseOrder 落库字段一致（purchase_order_item 无 price 字段，正确）。

### 5.4 消息中心（L599-681）

- `publicMessage` 输出 `id/messageId/type/title/content/bizId/read/time`（L599-610）。
- `markAllMessagesRead`（L665-681）：先 `getMessages` 取列表，再逐条读原文去重推送 `read_by`。**N+1 查询**（每条一次 get + 一次 update），100 条消息 = 200 次 DB 操作。云函数默认超时 20s，量大时可能超时。

### 5.5 手动单凭证核销 `verifyManualOrder`（L1436-1524）

- `verifyAction`: `submit` / `approve` / `reject`。
- 权限：submit → `VOUCHER_SUBMIT_ROLES`（含 store_manager）；其余 → `GLOBAL_ROLES`（L1437-1440）。
- `order.is_manual` 必须为真（L1449）；店长只能操作本店（L1451-1453）。
- submit：要求 `order_status==='received'`（L1458）、`verify_status!=='approved'`（L1461）、必须有凭证文件（L1462）。条件更新 `verify_status: _.neq('approved')` 防并发盖写（L1464-1478）。
  - **⚠️ 云存储删除攻击面**：L1480-1488 计算"旧凭证中不在新列表里的"并 `cloud.deleteFile({fileList})`。`staleFileIds` 来自**服务端已存的** `order.verify_voucher_file_ids`，因此只有已认证用户之前提交过的 fileID 才会被删。**越权删除风险被限定在本单历史凭证范围内**，但"认证用户可删除自己此前上传到云存储的文件"是设计内的副作用（文件留在 `vouchers/` 被删即永久丢失）。
- approve：`amount` 必须有限数且 > 0（L1507），**无上限校验**（不与任何订单金额比较），`verify_status` 条件更新 `'pending'` → `'approved'`，写 `verify_amount`/`verified_by`/`verified_at`（L1508-1522）。
  - `amount` 未做金额精度处理（未 `Math.round(x*100)/100`），直接存 `Number`，与全项目"2 位小数"口径不一致。**若客户端传 `123.456`，落库即 123.456。**
- reject：`verify_status: 'pending'` → `'rejected'`，写 `verify_reject_note`（L1496-1505）。

### 5.6 异常处理链（L695-822）

状态机：`pending → processing → resolved → closed`。
- `startAbnormal` 要求当前 `pending`（L741）。
- `resolveAbnormal` 要求当前 `processing`（L761），必须有 `resolution`（L752-753）。
- `payment_decision` ∈ `['pay_received','reject']`，否则存 `''`（L764）。
- 门店归属复查（L738-740, 758-760, 808-810）。
- resolve 时发两条消息：一条定向店长（L776-786），一条"待补结算提醒"（L790-796）。

### 5.7 ⚠️ `settleReceipt` 补结算无并发保护（L868-980）

- 角色 `GLOBAL_ROLES`。
- 拒绝条件：存在 `pending/processing` 异常（L879-884）。
- **重复结算判定**（L887-893）：查 `report_file` 中 `report_type='supplier_receipt_price_report' && source_order_id=purchase_order_id`，若有 `report_id` 以 `${receiptId}_S` 结尾 → 拒绝。
- **⚠️ 该判定与后续写库之间无事务、无条件更新** → 两个并发 settleReceipt 都能通过 L891 检查，**各生成一份 `_S` 账单，导致供应商被重复计费（双份账单）**。
  - 与 `auditOrder`/`cancelOrder`/`verifyManualOrder` 普遍使用"条件更新兜底并发"的做法不一致。
  - 严重度：中（需管理员并发点击，但后果是重复出账）。
- 复付逻辑（L896-915）：`status !== 'closed' && payment_decision === 'pay_received'` 的异常，按 `abnormal_id` 反解行号 → `receipt_id + '_' + parts[1]` 匹配 `receipt_item_id` → 把 `payable_flag` 置 `true`。
  - 与 createReceipt 的 `abnormal_id = ${receiptId}_${i+1}_${type}`、`receipt_item_id = ${receiptId}_${i+1}` **格式一致，解析正确**（L904-908）。
- 金额过滤（L923）：`!is_manual && payable_flag !== false && Number(price_snapshot) > 0`。
- 金额公式与 createReceipt 一致（L956-960）。
- report_id `RPT_SURP_${sid}_${receiptId}_S`（L969），带 `settle_for_receipt` 冗余字段（L974）。

### 5.8 `repriceReceipt` 补价补账（L1033-1101）

- 只处理 `!is_manual && supplier_id && price_snapshot <= 0` 的行（L1045）。
- 取价同样用 `_.in(chunk20) + is_current:1 + limit(100)`（L1051-1058）→ **同 4.7 的截断风险**。
- 补价后直接置 `payable_flag: true`（L1065-1067）。
- 关闭对应 `missing_price` 异常（L1075-1088）：置 `resolved` + `resolution` + `handled_by`，**但不写 `resolved_by` / `resolved_at` / `payment_decision`** —— 与 `resolveAbnormal`（L766-775 写 resolved_by/resolved_at）口径不一致，且这些异常无法再走 `closeAbnormal`（会因 status 已是 resolved 而被 L811 拦住并提示"只有已解决异常才能关闭"—— 实际上 resolved 是能关的，但缺少 close 之前的字段）。
  - 另外：这些异常**没有 `resolution` 之外的处置人追溯完整性**，`resolved_by` 缺失意味着"谁补的价"只能从 `handled_by` 看。
- 复用 `regenerateReceiptReports(event)`（L1091）重出 4 类报表。

### 5.9 ⚠️ `requestCancel` 死代码（L1331-1378）

- L1334 `requireUser(event, GLOBAL_ROLES)` 已限定只有 purchaser/super_admin 能进入。
- L1350-1352 的门店归属校验 `if (!GLOBAL_ROLES.includes(auth.user.role) && ...)` **恒为 false**（角色一定在 GLOBAL_ROLES 内）→ 该分支永不执行。
- 注释 L1332-1333 也承认"下单人员/店长无取消权限"，所以门店归属校验本就无意义。属**残留死代码**，建议删除以免误导后续维护者以为存在门店级校验。

### 5.10 `remindAudit` 催审（L1381-1430）

- 角色 `['chef','store_manager','purchaser','super_admin']`；订单必须 `submitted`（L1392）。
- 门店归属校验（L1396-1398）—— 此处有效（非全局角色确实会进来）。
- 限频 1 小时（L1401-1405）+ 条件更新兜底（L1408-1420）。
- **⚠️ 待核实**：L1412-1415 在 `.where()` 内使用字面量 `$or` 键：
  ```js
  .where({ _id, order_status: 'submitted', $or: [{audit_reminded_at: _.exists(false)}, {audit_reminded_at: _.lt(...)}] })
  ```
  wx-server-sdk 的官方写法是 `_.or([...])` 生成命令对象。若 `where({$or: ...})` 不被 SDK 识别为逻辑运算符，该 where 会退化为"查询文档中真的有个 `$or` 字段" → 匹配 0 条 → `updated===0` → 用户收到"已催办过，请 1 小时后再试"，**催审功能对所有订单失效**（静默失败，功能不可用）。
  - 注意：前面 L1402-1405 的**非条件更新**预检已经能拦住大部分重复催审，所以影响是"1 小时窗口内的重复催审被正确拒绝，但窗口之后的首次催审可能也被误拒"。**需实测确认 SDK 是否支持 `$or` 字面量。**

### 5.11 ⚠️ `cancelOrder` 的状态白名单与 `setStoreStatus` 的 ACTIVE 列表不一致

- `cancelOrder`（L1295）允许作废：`['submitted','approved','report_generated']`；已有收货（`partial_received/to_receive/received/receipt_abnormal`）拒绝（L1292）。
- `authService.setStoreStatus`（L629）的 `ACTIVE_ORDER_STATUS` = `['draft','submitted','pending_approval','approved','report_generated','partial_received','to_receive']`。
  - **遗漏 `receipt_abnormal`**：一个门店若挂着 `receipt_abnormal` 状态的订单（有异常未闭环），仍可被停用。
  - 含 `draft` / `pending_approval`，但 `pending_approval` **全项目无任何写入点**（见 §6.3），属遗留值；`draft` 是真实存在的（createPurchaseOrder 支持保存草稿），但草稿属于"未提交"，把它算进"未完结"导致**有草稿就停用不了门店**——口径偏保守但可接受。
- `setStoreStatus` 停用检查用 `purchase_order.store_id` 计数（L630-634），正确。

### 5.12 `getOrderStats` 首页统计（L824-863）

- chef：`store_id + created_by` 双条件（L830-833）→ 只看自己下的单。
- store_manager：仅 `store_id`（L834-836）。
- 全局：可选 `event.storeId` 过滤（L837-839）。
- 计数口径：
  - `submitted` = 待审核
  - `receivable` = `order_status in ['approved','report_generated','partial_received','to_receive']`（L842）
  - `received` = `order_status==='received' && verify_status !== 'pending'`（L844）→ **待核销的手动单不计入已完成**
  - `to_verify` = 仅全局角色的 `verify_status==='pending'` 计数（L850-852）
- 全部 `count()` 服务端聚合，4 个查询 `Promise.all` 并发（L845-853）。

---

## 6. 数据库集合与字段字典（从代码 + 待补 seed-data）

> seed-data 尚未细读，本表先由代码反推；标注「待 seed 核对」的字段需与 seed-data 对照。

### 6.1 `app_user`
| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | DB 主键 |
| `user_id` | string | 业务 ID，`'U' + Date.now() + random3hex`（authService:367） |
| `username` | string | `^[a-z0-9_.-]{3,32}$`，唯一（authService:139, 354-358） |
| `name` | string | 姓名，必填 |
| `mobile` | string | 可选 |
| `role` | enum | chef/store_manager/purchaser/super_admin/supplier |
| `role_label` | string | 中文标签（authService:14-20） |
| `default_store_id` | string | 门店角色必填，其他为 `''` |
| `default_supplier_id` | string | supplier 角色必填，其他为 `''` |
| `status` | 0/1 | 1=正常；getSessionUser 强制过滤 |
| `password_salt` / `password_hash` / `password_iterations` | string/string/number | PBKDF2-SHA256, 120000 次, 32B key |
| `sessions` | array | `[{token_hash, expires_at}]`，最多 5 |
| `session_token_hash` / `session_expires_at` | string/date | 旧单会话兼容字段（指向最新会话） |
| `login_fail_count` / `login_locked_until` | number/date | 登录锁定 |
| `last_login_at` / `openid` / `created_at` / `updated_at` | date | openid 供订阅消息推送 |

### 6.2 `store`
`store_id`（`S001` 格式，正则 `/^S(\d+)$/` 用于取序号，authService:537）、`store_name`（≤30 字）、`store_code`、`status`(0/1)、`created_at`、`updated_at`。
- 新增门店序号：全量取 `store_id`（`.field({store_id:true}).limit(1000)`，L531-539）取最大+1，插入撞号递增重试 3 次（L547-568）。
- **⚠️ limit(1000) 截断**：门店超过 1000 家后，新门店序号只在前 1000 家里取最大，可能与后面的门店撞号（重试 3 次可能仍撞）。当前量级无影响，属远期隐患。

### 6.3 `purchase_order`（核心状态机）

| 状态 | 写入点 | 说明 |
|---|---|---|
| `draft` | createPurchaseOrder:278 | 草稿 |
| `submitted` | createPurchaseOrder:278（默认） | 已提交待审核 |
| `approved` | dataService.auditOrder:552 | 审核通过 |
| `rejected` | dataService.auditOrder:552 | 已驳回 |
| `partial_received` | createReceipt:509 | 分批未收齐 |
| `receipt_abnormal` | createReceipt:509 | 收齐但有异常 |
| `received` | createReceipt:509 | 收齐无异常 |
| `cancelled` | dataService.cancelOrder:1301 | 已作废 |
| `report_generated` | **无任何写入点** | ⚠️ 遗留值 |
| `pending_approval` | **无任何写入点** | ⚠️ 遗留值 |

**⚠️ 全项目 grep 确认**：`report_generated` 和 `pending_approval` 在 8 处被**读取/接受**（createReceipt:228,392；dataService:842,1295,1346；authService:629；updateProductPrice:43；confirmSupplierOrder:13；getPurchaseOrders:74），但**没有任何代码写入这两个状态**。采购单实际流转是 `submitted → approved → partial_received/receipt_abnormal/received`。
- 后果：这些状态出现在白名单里是"宽松接受历史数据"，不致出错，但会让维护者误以为存在"审核通过但未生成报表"和"待审批（区别于 submitted）"两个真实状态。**建议清理白名单或补齐写入逻辑。**

其他字段：`purchase_order_id` / `order_no`（同值冗余）、`store_id`、`store_name`、`order_date`、`delivery_date`、`backfilled`(bool)、`is_manual`(bool)、`verify_status`（`''`/`none`/`pending`/`approved`/`rejected`）、`verify_amount`、`verify_voucher_file_ids`、`verify_note`、`verify_submitted_by`/`verify_submitted_at`/`verified_by`/`verified_at`/`verify_reject_note`、`request_id`、`remark`、`created_by`、`created_by_name`、`submitted_at`、`audit_remark`/`audited_by`/`audited_at`、`cancel_reason`/`cancelled_by`/`cancelled_at`、`cancel_requested`/`cancel_requested_by`/`cancel_request_reason`/`cancel_requested_at`、`audit_reminded_at`、`missing_reports`(bool)、`supplier_confirmations`(map)、`updated_at`。

### 6.4 `purchase_order_item`
`item_id`（`${orderNo}_${i+1}`）、`purchase_order_id`、`product_id`、`product_name_snapshot`、`category_snapshot`、`unit_snapshot`、`supplier_id`、`order_qty`、`is_manual`、`remark`、`created_at`、`updated_at`、`approved_qty`（审核改量后写，dataService:546）。
- **无 price 字段**（价格是收货时才快照的），与 L303 注释一致。

### 6.5 `receipt` / `receipt_item`
见 §4.8。`receipt_status` ∈ `['completed','abnormal']`。`receipt_item.payable_flag` 缺省视为可付款（旧数据兼容，dataService:923 `payable_flag !== false`）。

### 6.6 `abnormal_record`
`abnormal_id`（`${receiptId}_${i+1}_${type}`）、`receipt_id`、`purchase_order_id`、`product_id`、`supplier_id`、`store_id`、`store_name`、`type`（shortage/quality/wrong_item/missing_price）、`description`、`status`（pending/processing/resolved/closed）、`resolution`、`payment_decision`（''/pay_received/reject）、`handled_by`、`resolved_by`、`resolved_at`、`closed_by`、`closed_at`。
- ⚠️ `repriceReceipt` 关闭 missing_price 异常时只写 `handled_by`，缺 `resolved_by`/`resolved_at`（§5.8）。

### 6.7 `supplier_product_price`
`product_id`、`supplier_id`、`price`、`is_current`(1/0)、`updated_at`（待读 updateProductPrice 确认全字段）。

### 6.8 `report_file`
`report_id`、`report_type`、`report_scope`（store/supplier）、`scope_id`、`scope_name`、`related_date`、`source_order_id`、`basis_date_type`（order_date/receipt_date）、`file_name`、`file_url`、`file_version`、`generated_at`、`generated_by_system`、`status`（generated/superseded）、`has_abnormal`、`abnormal_summary`、`excluded_rows`、`settle_for_receipt`、`regenerated`。
- **⚠️ `report_id` 不是唯一键**：同一 `report_id` 可同时存在 `status:'generated'` 与 `status:'superseded'` 的行（先置 superseded 再插新行），`regenerateReceiptReports` 反复执行还会插入多条同 `_RG` 的 generated 行。
- **`report_file` 无删除逻辑**：作废/改量只标记 superseded，文件仍在云存储（有意保留审计痕迹）。

### 6.9 `report_version_counter`
`_id` = `${reportType}_${scopeId}_${relatedDate}`、`count`、`updated_at`。原子 `_.inc(1)` 递增，3 次重试。

### 6.10 `message`
`message_id`、`type`（order/approval/cancel/receive/abnormal）、`title`、`content`、`biz_id`、`recipient_user_id`、`store_id`、`scope_type`、`scope_id`、`read`(bool)、`read_by`(array)、`read_at`、`created_at`。

---

## 7. 事务与并发汇总（已细读部分）

| 云函数/action | 事务 | 并发防护 |
|---|---|---|
| createPurchaseOrder 建单 | `runTransaction`（头+明细+删旧行） | request_id 幂等查重在事务外（§3.2 竞态） |
| createReceipt 收货 | `runTransaction`（头+明细+异常+订单状态+消息） | 事务内二次超收校验 ✅；**`isFinalBatch` 未在事务内重算 ❌** |
| dataService.auditOrder | `runTransaction` | 事务内状态复查 ✅ |
| dataService.cancelOrder | `runTransaction`（状态+报表 superseded） | **无事务内状态复查** —— 两个并发 cancel 都会成功写 cancelled（幂等无害，但 message 会发两次） |
| dataService.settleReceipt | **无事务、无条件更新** | ❌ 并发重复补结算 → 双份账单（§5.7） |
| dataService.repriceReceipt | 无事务 | 重复执行幂等（第二次查不到缺价行）✅ |
| dataService.regenerateReceiptReports | 无事务 | ❌ 重复执行插入重复 generated 行（§4.11） |
| dataService.regenerateOrderReports | 无事务 | 内部 superseded 逻辑缓解 ✅ |
| dataService.startAbnormal/resolveAbnormal/closeAbnormal | 无事务 | 状态白名单前置检查，无事务内复查 → 并发 resolve 两次会都通过？（status 检查在 update 前，无 where 条件）⚠️ |
| dataService.verifyManualOrder | 无事务 | 条件更新 `verify_status: _.neq('approved')` / `=== 'pending'` ✅ |
| dataService.requestCancel | 无事务 | 条件更新 `cancel_requested: _.neq(true)` ✅ |
| dataService.remindAudit | 无事务 | 条件更新（但 `$or` 字面量待核实） |
| authService.login 失败计数 | 无事务 | `_.inc` 原子自增 + 条件更新归零 ✅ |
| authService.createUser/updateUser | 无事务 | 查重非原子 → 并发同名创建可能双写 ⚠️ |
| authService.createStore | 无事务 | 序号重试 3 次 ✅ |

**未用事务保护但有超付/超卖风险的关键点**：
1. `settleReceipt` 并发 → 重复账单（中高危）
2. `createReceipt` 并发 → 订单卡死 partial_received（中危）
3. `startAbnormal/resolveAbnormal/closeAbnormal` 无 where 条件更新 → 并发状态跳变（低危，后果是异常状态错位）

---

## 8. 金额与公式逻辑汇总（已细读部分）

| 公式 | 位置 | 说明 |
|---|---|---|
| `subtotal = Math.round(qty * price * 100) / 100` | createReceipt:591, 674；dataService:959, 1178, 1238 | 逐行舍入到分 |
| `total = Math.round((total + subtotal) * 100) / 100` | createReceipt:592, 675；dataService:960, 1179, 1239 | 累加时再舍入 |
| `subtotal.toFixed(2)` / `total.toFixed(2)` 输出 CSV | createReceipt:593-595, 676-678；dataService:961-963, 1180-1182, 1240-1242 | 统一 2 位小数 |
| `qty * price` 无税率、无折扣、无运费 | 全项目 | **采购系统不含税额/折扣/运费概念**（待核实是否需求内） |
| `verify_amount = Number(event.amount)` | dataService:1442, 1513 | **未做 2 位小数舍入**，与其他金额口径不一致 |
| 审核改量 `qty > 0 && qty <= order_qty` | dataService:525 | 只能减量 |
| 超收判定 `historyQty + receivedQty > order_qty` | createReceipt:277, 414 | 事务内外双重校验 |
| 累计判齐 `history + this >= order_qty` | createReceipt:378 | `>=` 而非 `===`，允许超收判齐（但超收已被上层拦） |
| CSV 公式注入防护 `/^[=+\-@]/ → 前置单引号` | 全项目 csvField | ✅ |
| CSV UTF-8 BOM `String.fromCharCode(0xFEFF)` | 全项目 | ✅ |
| 密码 PBKDF2 120000 次 SHA256 32B | authService:28-36 | ✅ |

**精度口径**：全项目金额以**元**为单位、2 位小数；唯一例外是 `verify_amount`（手动单凭证金额）未舍入。

---

## 9. 数据一致性：创建 → 供应商订单 → 收货 → 报表 链路

```
createPurchaseOrder
  purchase_order(order_no, store_*, order_date, delivery_date, is_manual, order_status='submitted')
  purchase_order_item(product_id, *_snapshot, supplier_id, order_qty, is_manual, remark)
  report_file ① store_order_report  ② supplier_order_report(按 supplier 分组)
        ↓ auditOrder (可选改量: order_qty/approved_qty)
        ↓   → regenerateApprovedOrderReports(改量时) ①'_A' ②'_A' + superseded 旧行
        ↓   → notifySuppliersNewOrder (message scope_type='supplier')
createReceipt (可多次, batch_no 递增)
  receipt(receipt_id, purchase_order_id, store_*, receipt_date, batch_no, is_final, receipt_status)
  receipt_item(receipt_item_id, purchase_order_item_id, product_id, *_snapshot,
               price_snapshot ← supplier_product_price.is_current=1,
               payable_flag, is_manual, is_shortage, is_quality_issue, is_wrong_item)
  abnormal_record(abnormal_id=${receiptId}_${i+1}_${type}, ...)
  report_file ③ store_receipt_report ④ store_receipt_price_report
               ⑤ supplier_receipt_report ⑥ supplier_receipt_price_report
        ↓ resolveAbnormal(payment_decision='pay_received')
        ↓ settleReceipt → ⑥'_S' (补结算账单)
        ↓ repriceReceipt → 刷新 price_snapshot + payable_flag=true → ③④⑤⑥'_RG'
verifyManualOrder (仅 is_manual 单) → purchase_order.verify_amount / verify_status
```

**关键字段传递一致性核查（已细读部分）**：

| 传递点 | 一致性 |
|---|---|
| `purchase_order_item.item_id` → `receipt_item.purchase_order_item_id` | ✅ createReceipt:451 |
| `abnormal_id` 与 `receipt_item_id` 反解关系（settleReceipt:904-908） | ✅ 格式匹配 |
| 供应商分组键 `supplier_id`（下单 vs 收货） | ✅ 都来自 `purchase_order_item.supplier_id` |
| `store_id`/`store_name` 在 receipt 层重取自 store 集合 | ✅ createReceipt:188-190 |
| `order_no` 用于报表 `source_order_id` | ✅ |
| **`category_name` 命名** | ⚠️ product 集合里同时有 `category_name`（dataService:111 写入）与 `category_level_1`/`category_level_2_id`；createPurchaseOrder:248 的兜底顺序可能把编码当名称 |
| **`receipt.receipt_status` vs `purchase_order.order_status`** | ⚠️ 两套状态字段，receipt 用 `completed/abnormal`，订单用 `received/receipt_abnormal`，命名不对应，容易误读 |
| **`missing_reports`** | ⚠️ `receipt.missing_reports` 无清除路径（§4.11） |

---

## 10. confirmSupplierOrder 详解（124 行）

供货商角色唯一可执行的写操作。

- 鉴权：`user.role !== 'supplier'` → `-403`（L54）；`default_supplier_id` 必填（L55-56）。
- **越权防护**（L64-69）：查 `purchase_order_item` `where({purchase_order_id, supplier_id})`，必须真的含本供货商商品，否则 `-403 '该订单不包含贵司供货的商品'`。**这是"供货商只能确认自己供货的部分"的关键，写法正确。**
- 动作：`confirm` → status `'confirmed'`；`ship` → `'shipped'`（L14, L62）。
- 状态白名单（L12-13）：
  - `CONFIRMABLE_ORDER_STATUS = ['submitted','approved']`
  - `SHIPPABLE_ORDER_STATUS = ['submitted','approved','report_generated','to_receive','partial_received']`
  - 注意 `ship` 的白名单**不含 `receipt_abnormal`**，即订单收齐但有异常时供货商不能再标发货。
- **原子条件更新**（L78-83）：`where({purchase_order_id, order_status: _.in(allowedStatus)})` → `update`，`updated===0` 则返回"订单不存在或当前状态不可操作"。避免读-判-写竞态。**这是全项目最干净的一处并发防护。**
- 写入结构（L73-77）：`purchase_order.supplier_confirmations[supplier_id] = {status, updated_at, updated_by}`。
  - **⚠️ 无并发保护的多供货商覆盖**：每个供货商写自己的键，互不覆盖 ✅。但同一供货商重复操作会**静默覆盖前值**（`confirmed` → `shipped` 或反向）—— 没有"只能前进不能回退"的约束。
- 发货消息（L86-117）：写站内消息给门店，`scope_type:''`/`scope_id:''`，`recipient_user_id:''`（门店广播）。失败仅记日志。
- **⚠️ 与 dataService.regenerateApprovedOrderReports 的耦合**：改量时 `supplier_confirmations` 被 `_.set({})` 清空（dataService:400-404），供货商需重新确认。链路闭合 ✅。

---

## 11. getPurchaseOrders 详解（144 行）

- 鉴权 + 角色过滤（L50-66）：chef → `store_id + created_by`；store_manager → `store_id`；全局 → 可选 `storeId`/`createdBy`。
- 分页（L44-45）：`page` 夹在 `[1,1000]`，`pageSize` 夹在 `[1,100]`。
- 虚拟状态（L70-77）：
  - `to_verify` → `verify_status:'pending'`，**仅全局角色**（L71）
  - `receivable` → `order_status in ['approved','report_generated','partial_received','to_receive']`
  - 其他任意字符串 → 直接当 `order_status` 查（无效值返回空，无风险）

### 11.1 ⚠️ Bug：`statusCounts` 在 `to_verify` 视图下被污染

- L81 `baseQuery = {...query}`，L82 只 `delete baseQuery.order_status`。
- 当 `orderStatus==='to_verify'` 时，`query.verify_status='pending'` 已进入 `baseQuery`。
- 结果：8 个 tab 计数（all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify）**全部被限定在 `verify_status='pending'` 的子集内** → tab 数字全部错误（例如"全部"会只显示待核销单数）。
- 严重度：中低（仅"待核销"tab 下的筛选栏计数错误，切换其他 tab 正常）。

### 11.2 ⚠️ Bug：订单明细批量查询 `limit(1000)` 截断

- L115-125：按 `purchase_order_id in (chunk of 20)` 查明细，`.limit(1000)`。
- 一页 `pageSize=100` × 每单最多 100 明细 = 10000 行，**远超 1000 上限 → 静默截断**。
- 默认 pageSize=20 时上限 2000 行，同样会截断。
- 影响：订单列表的明细展示可能不完整，**无任何报错或提示**。
- 严重度：中（影响列表页展示正确性）。

### 11.3 其他

- `creatorMap` 用 `user_id in (chunk)` limit 100（L127-132）—— 一页 ≤100 单，安全。
- 返回 `{...order}` **整个订单文档**（L134），包括 `verify_voucher_file_ids`（云存储 fileID）、`request_id`、`supplier_confirmations`、`cancel_*` 等内部字段。
  - **⚠️ 凭证 fileID 暴露面**：chef 只能看到自己创建的订单，但若 chef 自己创建了手动单，其凭证 fileID 会在列表返回中出现。小程序内持有 `cloud://` fileID 可直接 `downloadFile`，**无需经过 getReportFileUrl 的鉴权**。影响限于本店厨师，低危，但属于"绕过报表鉴权读文件"的一条路径。

---

## 12. getReportDetail 详解（206 行）—— 多处数据一致性缺陷

### 12.1 鉴权（L72-77）

- 非全局角色必须是 `chef` 或 `store_manager`（L74）。
- 报表必须 `report_scope==='store'` 且 `scope_id===user.default_store_id`（L75）。
- chef 额外限制：只能看 `store_order_report`（L76）。
- **⚠️ `supplier` 角色在 L74 被直接拒绝** → **供货商无法经 getReportDetail 查看自己的带价账单**（supplier_receipt_price_report 的 report_scope 是 'supplier'，即使通过 L75 也会失败）。供货商的账单查看必须走 getReports / getSupplierReceipts / getReportFileUrl（待核实这三者是否给供货商留了通道）。

### 12.2 ⚠️ 严重：分批收货时收货报表详情丢批次

L98-104：
```js
const receiptRes = await db.collection('receipt')
  .where({ purchase_order_id: orderId })
  .limit(1)
  .get()
const receiptId = receiptRes.data[0].receipt_id
```
- `report_file.source_order_id` 存的是 `purchase_order_id`，**多个批次的 store_receipt_report 共享同一个 source_order_id**（createReceipt:569, 602）。
- 无 `orderBy` + `limit(1)` → **只重建任意一批（通常第 1 批）的明细**。
- 结果：**第 2 批及以后的收货报表，详情数据显示的是第 1 批**，与 CSV 内容不符。
- 严重度：高（分批收货是主流程，用户看到的数字是错的）。
- 修复建议：从 report_file 里带上 `settle_for_receipt` 之外的 receipt_id（当前 report_file **没有存 receipt_id 字段**，只有 source_order_id）—— 需在 createReceipt 写 report_file 时补 `source_receipt_id` 字段。

### 12.3 ⚠️ 严重：superseded 报表的详情数据被"改量后的新值"污染

- L62-65 只按 `report_id` 查，**不检查 `report.status`**。
- 各类型的行数据全部**从当前业务表重建**（L84-198），不读 CSV 固化的内容。
- 审核改量后 `purchase_order_item.order_qty` 被更新（dataService:545-547），旧 `store_order_report`（已 `superseded`）的详情会显示**改量后的数量**。
- 结果：**superseded 报表的详情数据 ≠ CSV 内容**。审计追溯失效。
- 严重度：中高（影响"改量前后对账"这一核心审计场景）。

### 12.4 ⚠️ 供应商报表详情的 200 条截断与状态缺失

- `supplier_order_report`（L133-136）：`where({order_date: date}).limit(200)` → **超过 200 单/天截断**。
- `supplier_receipt_report`（L164-167）：`where({receipt_date: date}).limit(200)` → 同上。
- **两者都不过滤 `order_status`** → 已作废（`cancelled`）、已驳回（`rejected`）订单的明细会进入详情数据。CSV 里这些订单的报表已被 superseded（cancelOrder:1314-1316）不会生成，但详情重建时不检查 → **详情与 CSV 不一致**。
- 严重度：中（单日超 200 单或有作废单时出错）。

### 12.5 ⚠️ `subtotal` 计算口径与 CSV 不一致

- getReportDetail（L118, 189）：`(item.received_qty * item.price_snapshot).toFixed(2) * 1`
- createReceipt CSV（L591, 674）：`Math.round(received_qty * price * 100) / 100`
- 差异：`toFixed(2) * 1` 会经过字符串转换再回浮点，**边界值可能产生 `59.97000000000001` 类误差**；`Math.round(x*100)/100` 无此问题。两者在 0.005 边界处可能差 1 分。
- **⚠️ 且 getReportDetail 的 subtotal 对 `payable_flag===false` 的行也照常计算**（L118, 189 无 payable 过滤），而 CSV 带价报表只含 payable 行 → 前端若直接对详情数据求和会**多算不可付款行的金额**。
- **⚠️ 无缺失值保护**：`price_snapshot` 缺失（旧数据）→ `NaN.toFixed(2)*1` = `NaN`，前端直接渲染 "NaN"。
- 严重度：中（金额展示不一致，可能引发对账争议）。

### 12.6 异常类型字典缺一项

`ABNORMAL_TYPE_NAMES`（L12-16）只有 `shortage`/`quality`/`wrong_item`，**缺 `missing_price`**（createReceipt:52-57 有 4 种）。且 `getAbnormalTypeNames`（L18-24）只读 `is_shortage`/`is_quality_issue`/`is_wrong_item` 三个落库字段（`receipt_item` 确实没有 `is_missing_price` 字段）。**缺价异常在报表详情中完全不可见**，只能在异常记录页看到。

---

## 13. generateSummaryReport 详解（270 行）

- 角色 `['store_manager','purchaser','super_admin']`（L160）；chef 不可用。
- 店长强制本店（L170-175）；全局必须传 `storeId`（L176）。
- `period` ∈ `['daily','monthly']`，`date` 严格格式校验（L163-166）。

### 13.1 ⚠️ 停用门店仍可生成汇总

L178：`db.collection('store').where({ store_id: storeId })` —— **未加 `status: 1`**。
对比：createPurchaseOrder:198、createReceipt:188、authService:586/617 都带 `status: 1`。
→ 停用的门店仍可生成日/月汇总报表。低危（只读历史数据），但口径不一致。

### 13.2 月汇总日期上界写法脆弱（功能正确）

L84：`receipt_date: _.gte('${month}-01').and(_.lte('${month}-31'))`
- 用 `-31` 作上界。对 30 天月/2 月，`'2026-02-31'` 在字符串比较下仍 > 该月所有真实日期，**能覆盖整月**，功能正确。
- 但依赖"库里不存在 02-31 文档"这一隐式前提，属脆弱写法。

### 13.3 ⚠️ `generated_by_system: false` 与全项目不一致

L250 写 `generated_by_system: false`，而 createPurchaseOrder:369/418、createReceipt:571/604/653/688、dataService:435/476/973/1164/1191/1224/1251 全部写 `true`。
- generateSummaryReport 也是**纯系统自动生成**（无手工上传路径）。
- 若 getReports / getReportDetail 用 `generated_by_system` 区分"系统报表 vs 手工上传报表"，**汇总报表会被误标为手工上传**。
- 严重度：中低（影响报表列表的标签展示，不影响数据）。

### 13.4 ⚠️ `related_date` 语义不一致

- L227 `relatedDate = date`（月汇总也存传入的**某一天**），L229 `pathDate = date.slice(0,7)`（文件名用月份）。
- 结果：月汇总报表的 `report_file.related_date` = `'2026-10-20'` 而非 `'2026-10-01'`。
- 同一门店同一月份用不同日期触发，会生成 `related_date` 不同的多条记录，且 `getNextVersion('store_monthly_summary_report', storeId, relatedDate)`（L228）**版本号按天递增而非按月** → 月汇总版本号会随触发日期跳变。
- 严重度：中（月汇总的版本管理与筛选会错乱）。

### 13.5 ⚠️ 汇总金额不含手动单凭证金额

L191：`if (item.is_manual) return` —— 手动商品行整体排除。
- 但手动单的实付金额存在于 `purchase_order.verify_amount`（凭证核销回填），**从不进任何 receipt_item，也不进汇总表**。
- 结果：**日/月汇总金额系统性低于实际采购支出**，差额 = 全部手动单凭证金额。
- 严重度：中高（这是报表的口径缺口，管理层看到的数字与真实支出不符，且无任何提示）。

### 13.6 精度

- 数量累加 `* 1000 / 1000`（L208-209）—— 3 位小数（支持 0.5kg 类小数数量）✅
- 金额 `* 100 / 100` + `toFixed(2)`（L211-212, 222, 224）✅
- `report_file.total_amount` / `item_count`（L252-253）—— **仅此报表类型写入这两个字段**，其他 report_type 无。
- `report_id = RPT_DS_${storeId}_${date}_v${version}`（L239）—— **全项目唯一带版本号的 report_id**，不会与其他类型冲突。
- 文件名额外加 `Date.now().toString(36) + random3hex`（L231）。**L230 注释声称"并发生成同门店同日汇总会取到相同版本号"——这是错误注释**：`getNextVersion` 本身就是原子自增（L57-69，与 createPurchaseOrder:75-76 的设计意图一致），并发不可能取得相同版本号。随机后缀是冗余但无害。**此例说明本仓库注释不可信，必须以代码为准。**

---

## 14. updateProductPrice 详解（138 行）

- 角色 `['super_admin','purchaser']`（L70）。
- 校验：`price` 有限数且 `> 0`（L76-79）。
- **S5：仅支持当天生效**（L80-85）—— `effective_date` 必须等于服务端 UTC+8 今天，拒绝预约调价。
- 供应商/商品必须 `status: 1`（L90-95）。
- `dryRun === true`（L99-101）：只校验+计数不落库，供前端弹确认框。

### 14.1 事务（L106-131）—— 写法正确

事务内：先把现有 `is_current:1` 的行全部置 0（L107-115），再插入新行 `is_current:1`（L116-130）。
- 解决了并发"两条 current 价"的经典问题 ✅。
- 但 `.where(...).limit(100)` 取 current 行——**同一 (supplier, product) 只应有一条 current**，limit 100 是防御性冗余。

### 14.2 ⚠️ `price_id` 无随机后缀

L103：`priceId = 'PRC_' + Date.now()` —— **无 `crypto.randomBytes` 后缀**。
- 全项目其他 ID 生成（authService:367、dataService:91、createPurchaseOrder:271、createReceipt:320、importProducts:172）**全部带随机后缀**。
- 同毫秒并发调价会生成相同 `price_id`。事务保证不会出现两条 current，但 **price_id 会重复**。
- 严重度：低（price_id 目前未被用作查询键，但破坏 ID 唯一性约定）。

### 14.3 在途单波及计数 `countInflightOrders`（L44-64）

- 先查 `purchase_order_item where {supplier_id, product_id}` **limit 1000**（L46-49）→ 截断风险（同一供应商+商品在 >1000 条明细中）。
- 再按 `purchase_order_id in (chunk20) + order_status in INFLIGHT` 计数（L52-57）。
- `INFLIGHT_ORDER_STATUS = ['submitted','pending_approval','approved','report_generated','partial_received','to_receive']`（L43）—— **含两个遗留状态** `pending_approval`/`report_generated`（见 §6.3，全项目无写入点）。
- 失败降级为 0（L60-63），**静默失败会让前端以为"无波及"而放行调价**。低危。

### 14.4 `updated_by` 兜底顺序（L126）

`user.user_id || user._id || updatedBy || 'system'` —— 客户端传的 `updatedBy` 仅作最后兜底，**无法伪造操作人** ✅。

---

## 15. importProducts 详解（209 行）—— Excel 批量导入

### 15.1 鉴权与输入

- 角色 `MANAGEMENT_ROLES = ['super_admin','purchaser']`（L8, L83）。
- 输入：`event.fileID`（云存储 fileID），`cloud.downloadFile({fileID})` 下载（L92）。
- **⚠️ fileID 完全由客户端指定**：已认证管理员可下载云存储中**任意已知 fileID**（不限 `vouchers/`、`receipts/`、`reports/` 路径）。管理员工号，风险受控但无路径校验，与 createReceipt:211-215 的 `photoPrefix` 校验形成对比。
- 解析：`XLSX.read(res.fileContent, {type:'buffer'})`（L93），取第一个 sheet（L97）。
- **⚠️ 无文件大小/行数上限**：SheetJS 解析超大文件有 zip bomb / DoS 风险；云函数内存 256MB-2GB，超时默认 20s。

### 15.2 模板与列映射

- `HEADER_ALIASES`（L11-19）：
  - `name`: 商品名称/品名
  - `categoryL1`: 一级分类
  - `categoryName`: 二级分类/分类
  - `unit`: 单位
  - `spec`: 规格
  - `manufacturerName`: 厂家/厂家品牌/品牌
  - `supplierName`: 默认供应商/供应商
- 必需列：`name`、`categoryName`、`unit`（L103-105）。`categoryL1` 可选（用于消歧）。
- `mapHeader`（L67-80）：按别名匹配，**同一 field 只取第一个命中列**（L73 `!colMap[field]`）。

### 15.3 ⚠️ 分类匹配歧义未消除

L146-152：
- 先按 `category_name` 精确匹配，`candidates[0]` 取第一个。
- 仅当填了 `categoryL1` 才用 `category_level_1_name` 收窄。
- **未填写一级分类 + 存在同名二级分类跨多个一级分类** → 取 `candidates[0]`（数据库返回顺序不确定）→ **可能挂到错误的一级分类**。
- 严重度：中低（数据质量问题，不影响金额）。

### 15.4 ⚠️ 无事务 + 无行数上限 → 大文件必然超时且部分导入

- 全量加载 `product` 集合并分页（L116-124，`skip+limit(100)`，**无 status 过滤**，含停用商品参与去重）。
- **逐条 `add`**（L189-196），无事务。
- 单行失败仅记入 errors（L193-195），**不中断**。
- 结果：1000 行文件 = 1000 次串行 DB 写入，必然超时；**已写入的部分不会回滚**。
- **重试是幂等的**（去重基于 `product_name|manufacturer_name`，已导入的会命中 existingKeys 跳过，L156-159）✅ —— 这一点设计正确。
- 严重度：中高（可用性问题，需前端分批上传或后端改批量 add）。
- `errors.slice(0, 50)`（L204）+ `failed: errors.length`（全量计数）✅。

### 15.5 写入字段（L171-184）

`product_id`（`P+Date.now()+random4hex`）、`product_name`、`category_level_1`、`category_level_2_id`、`category_name`、`unit`、`spec`、`manufacturer_name`、`default_supplier_id`、`status:1`、`created_at`、`updated_at`。
- **与 dataService.saveProduct（L107-117）的字段集完全一致** ✅（两者都无 `category_level_2_icon`，`manufacturer_name` 默认 '默认'）。
- 供应商按名称匹配，匹配不到则留空 `''` 并记 warning（L162-169），**不阻断导入** ✅。

---

## 16. 全项目读取类云函数的鉴权与截断速查（待逐个细读）

已读 5 个（authService / dataService / createPurchaseOrder / createReceipt / confirmSupplierOrder / generateSummaryReport / getPurchaseOrders / getReportDetail / importProducts / updateProductPrice = 10 个）。

**已确认的通用模式**（10 个云函数一致）：
- `getSessionUser` 复制粘贴 10 份，逻辑完全相同（含 legacy 兼容分支）。
- 错误码统一 `-1/-401/-403/0`。
- **唯一不一致**：`requireUser` 包装（dataService / importProducts）返回 `{error:{code,msg}}`，内联写法（其余 8 个）返回 `{code,msg}`。

---

## 17. getReportFileUrl 详解（64 行）—— 文件下载鉴权

- 输入 `fileId`（`cloud://` fileID）。
- **L46-47 先查 `report_file.where({file_url: fileId})`，未命中直接返回"报表文件不存在"** → **本函数不是任意文件下载通道**，只放行 `report_file` 集合登记过的 fileID。✅ 比 importProducts 的裸 `downloadFile` 严格。
- 角色校验（L49-54）：全局放行；非全局必须 chef/store_manager 且 `report_scope==='store'` 且 `scope_id===default_store_id`；chef 额外限 `report_type==='store_order_report'`。
- **⚠️ 不检查 `report.status`** → **`superseded` 状态的旧报表文件仍可下载**。云存储文件从不删除（cancelOrder/改量只标记 superseded），所以旧版本永久可取。设计内（审计留痕），但注意"改量前后都能下"。
- **⚠️ supplier 角色在 L50 被拒** → 供货商**无法下载自己的带价账单 CSV**（见 §18.2）。

## 18. 读取类云函数总表（7 个）

### 18.1 getProducts（66 行）

- 鉴权：任意已登录（chef 可）；`includeInactive` 仅 manager（L45-47）。✅
- **⚠️ 严重：`.limit(200)` 硬上限，无分页、无 total**（L53）→ **商品超过 200 个即静默截断**，前端无法察觉。
- **⚠️ `keyword` 是内存过滤**（L56-59）：先取 200 条再 filter → **只能搜到前 200 条里的匹配项**；且只搜 `product_name`（不搜 spec/manufacturer_name）。
- `categoryId` 转 `Number`（L50），`categoryL1` 用字符串编码。
- 严重度：**中高**（商品库增长后列表页静默失真）。

### 18.2 getReports（103 行）

- 角色过滤（L50-66）：chef → store + `store_order_report` + 本店；store_manager → store + 本店；purchaser/super_admin → 全部（可选 reportScope）。
- **⚠️ `supplier` 角色在 L64-66 被直接拒绝**。
- 结论：**供货商在 getReports / getReportDetail / getReportFileUrl 三处全部被拒** → **供货商无法在本系统内查看或下载自己的带价账单（supplier_receipt_price_report）**。
  - 供货商能看到的只有：getSupplierOrders（订单视图，无价格）、getSupplierReceipts（收货明细视图，**有价格**，见 §18.5）。
  - 即供货商用 getSupplierReceipts 的 `amount` 字段对账，但**拿不到带价账单 CSV 文件**。与 dataService:1322 注释"S3 拍板：供应商触达走线下"一致——设计如此，但属**产品缺口**，应明确记录。
- L79-86 对 chef/store_manager 的收敛是 L50-60 的**重复代码**（注释 L78 意图"客户端过滤只能收窄不能扩大"）。冗余无害。
- `pageSize` 上限 50（L89），getPurchaseOrders 是 100 —— 不一致。
- `reportType` 白名单 8 种（L68-76）、`reportScope` 白名单 2 种（L46）、`relatedDate` 格式校验（L47）✅。
- **⚠️ 不过滤 `status`** → 列表含 `superseded` 记录；且 generateSummaryReport 从不置 superseded → **报表列表无限膨胀**。

### 18.3 getReportDetail / getReportFileUrl 的 supplier 缺口（已述）

### 18.4 getSuppliers（96 行）

- supplier 角色只看自己档案（L45-52），且**强制 `product_count: 0`**。
  - ⚠️ supplier 分支**不做 status 过滤**（L47-50 无 status 条件），但 authService.login:203-204 已用 `findSupplier`（status:1）拦住停用供应商登录 ✅。
- **⚠️ 越权：`status` 参数未做权限校验**（L58）：
  ```js
  if (status !== undefined && status !== null && status !== '') query.status = status
  else if (!includeInactive || !isManager) query.status = 1
  ```
  - chef 传 `status: 0` → **直接查看已停用供应商的完整档案（含联系人姓名、联系电话）**，绕过 L54 的 `includeInactive` 校验。
  - 对比 getProducts:45-47 的正确写法（`includeInactive && !isManager` → -403）。
  - 修复：`status` 需限定 `0/1`，且非 manager 强制 `status: 1`。
  - 严重度：**中（信息泄露）**。
- **⚠️ `keyword` 直接用 `db.RegExp({regexp: keyword, options:'i'})`**（L61）→ **正则注入**（客户端可传 `.*` 或复杂正则造成慢查询）。低危。
- ⚠️ `.limit(100)`（L67）—— 供应商超 100 截断。
- ⚠️ `product_count` 用 `default_supplier_id in (chunk20)` **limit 1000**（L76-79）—— 默认商品超 1000 时计数不准。

### 18.5 getSupplierOrders（136 行）—— 供货商订单视图

- 鉴权：`user.role !== 'supplier'` → -403（L61）；`default_supplier_id` 必填（L63）。✅
- 数据链路：**先取该供货商全部订单明细 → 内存过滤订单 → 内存分页**（L72-118）。
- ⚠️ **严重：明细查询 `.limit(1000)` 且不分页**（L72-75）→ 供货商历史明细超 1000 行时**早期订单完全不可见**。
- ⚠️ **严重 Bug：排序按"星期几英文名"而非时间**（L116）：
  ```js
  filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  ```
  `created_at` 是 `db.serverDate()` 写入的 `Date` 对象，`String(Date)` 在 Node 里返回 `'Tue Oct 06 2026 12:26:40 GMT+0000 (Coordinated Universal Time)'`（`toString()`，**非 ISO 格式**）。
  → `localeCompare` 按字符串比较 → **先比星期几（Fri/Ged/Mon/Tue...），再比月份，再比日期**。
  → **供货商看到的订单列表顺序完全错乱**（按星期几英文名排序）。
  - 修复：`new Date(b.created_at).getTime() - new Date(a.created_at).getTime()`。
  - 严重度：**中高**（列表顺序错乱，直接影响供货商接单效率）。
- ⚠️ `HIDDEN_ORDER_STATUS = ['draft','rejected']`（L11）—— 供货商看不到草稿/驳回单 ✅。
- ⚠️ `DONE_ORDER_STATUS = ['received','receipt_abnormal','completed']`（L14）—— **含 `completed`，但 `completed` 不是 `purchase_order` 的状态**（`purchase_order` 用 `received`，`receipt` 才用 `completed`）。遗留/错误值，低危。
- ⚠️ **返回 `{...order}` 整个订单文档**（L127）→ 供货商能看到 `created_by_name`（下单人姓名）、`audited_by`（审核人姓名）、`cancel_reason`/`cancelled_by`（作废原因与操作人）、`verify_note` 等**内部人员信息**。
  - 严重度：**中（信息泄露）**。建议只下发供货商需要的字段（订单号、门店、日期、自己的明细、确认状态）。
- ⚠️ `statusCounts` 受 `orderDate` 过滤影响（L106 注释只声称不受 tab 过滤影响）—— 低危。

### 18.6 getSupplierReceipts（119 行）—— 供货商对账视图

- 鉴权：`user.role !== 'supplier'` → -403（L45）✅。
- 查询 `{supplier_id, is_manual: _.neq(true)}`（L54）。
  - ⚠️ `_.neq(true)` 对**未写 `is_manual` 字段的旧数据**会包含该行（字段不存在 ≠ true），但旧手动行的 `supplier_id` 为空 → 已被 `supplier_id` 条件排除。双保险成立 ✅。
- 金额 `Math.round(receivedQty * price * 100) / 100`（L109）✅ 与全项目一致。
- ⚠️ **`amount` 对 `payable_flag === false` 的行照常计算**（L101-102, 109 无 payable 过滤）→ **质量/错货/缺价行（不可付款）也显示金额**，供货商会误以为会付款。**与 §12.5 的 getReportDetail 同类缺陷。**
  - 严重度：**中高（对账争议来源）**。
- ⚠️ **完全不支持日期过滤**（L52 注释说明 `receipt_item` 无 `receipt_date` 字段），且**代码里根本没有 `orderDate` 参数处理** → 供货商对账只能翻页，效率低。对比 getSupplierOrders 支持 orderDate（L100）。
  - 严重度：**中（功能缺口）**。
- 异常记录 join：key `${receipt_id}_${product_id}`（L88），带回 `type/status/resolution/payment_decision`（L90-95）✅。
  - ⚠️ 同一次收货同一商品有多个异常类型 → 数组包含多条 ✅ 正确。
  - ⚠️ `abnormal_record.resolution` 会把**内部处理结论**下发给供货商（如"已补配协议价并刷新价格快照，账单按补价重出"）。信息泄露程度可接受（对账需要），但 `payment_decision` 的 `reject`/`pay_received` 语义对供货商是黑盒。低危。

### 18.7 getPurchaseOrderDetail（129 行）

- 鉴权（L58-67）：全局放行；非全局必须 chef/store_manager；本店校验；chef 额外限本人创建的单 ✅。
- **⚠️ `supplier` 角色在 L60 被拒** → 供货商看不到订单详情（走 getSupplierOrders）。
- **⚠️ chef 不下发 `supplier_name`**（L85-97，注释 L84"chef 不见供应商身份"），**但 `items` 是 `{...item}` 原样展开，`supplier_id` 字段仍下发** → chef 能看到供应商 ID 字符串。低危（ID 无语义），但与注释声称的口径不完全一致。
- **⚠️ 严重：`reports` 过滤不彻底 → 越权下载带价报表**（L107-113）：
  ```js
  const reports = user.role === 'chef'
    ? reportRes.data.filter(r => r.report_scope === 'store')
    : reportRes.data
  ```
  chef 只过滤 `report_scope === 'store'`，**`store_receipt_price_report`（带价收货报表）也属于 store 范围** → chef 拿到其 `report_id` / `file_name` / **`file_url`（cloud fileID）**。
  - getReportFileUrl:53 与 getReportDetail:76 都限制 chef 只能访问 `store_order_report` ✅。
  - **但 chef 持有 `file_url` 就能在小程序内直接 `wx.cloud.downloadFile`，完全绕过 getReportFileUrl 的 report_type 限制。**
  - 严重度：**中（鉴权绕过：chef 可下载带价收货报表 CSV，看到供应商单价）**。
  - 修复：chef 的 reports 应同时过滤 `report_type === 'store_order_report'`，或不下发 `file_url` 字段。
- ⚠️ `receipts` 全量下发（L121），含 `photo_file_ids`（验收照片 fileID）→ chef 可下载本店验收照片。低危。
- `created_by_name` 兜底查 app_user（L69-75）✅。

### 18.8 getReceipts（92 行）

- chef 直接返回空数组（L50-52）✅；store_manager 限本店（L53-55）；supplier 被拒（L56-57）。
- **⚠️ `storeId` 参数被解构但从未使用**（L44）→ **purchaser/super_admin 无法按门店筛选收货记录**。
  - 对比 getPurchaseOrders:62 支持 `if (storeId) query.store_id = storeId`。
  - 严重度：**中（管理员收货列表无法按门店筛选，后端不支持）**。
- ⚠️ 明细批量查询 `.limit(1000)`（L76-79）→ 一页 100 张 receipt × 100 明细 = 10000 行，**静默截断**。同 getPurchaseOrders:117。
- ⚠️ `receiptDate` 无格式校验（L61），无效值返回空，无风险。

### 18.9 getProductPrices（89 行）

- supplier 强制 `query.supplier_id = user.default_supplier_id`（L46-49），**忽略前端传入** ✅。
- chef/store_manager 被拒（L51）✅。
- `onlyCurrent` → `is_current: 1`。`.orderBy('effective_date','desc').limit(200)`（L59-60）。
- ⚠️ 供应商历史价格（`is_current:0` 不删除）累计超 200 条 → 截断。low（前端通常传 onlyCurrent）。
- ⚠️ 兜底 `product.product_name || product.name`（L79）—— `product.name` **不是 product 集合的字段**，冗余兜底。无害。

---

## 19. 全部 20 个云函数的权限与截断缺陷汇总

### 19.1 鉴权缺陷（按严重度排序）

| # | 位置 | 缺陷 | 严重度 |
|---|---|---|---|
| 1 | createReceipt:360-369, 459 | 客户端可控 `payableFlag` 落入 `receipt_item.payable_flag`，可静默把行排除出带价账单且无异常记录 | 中高 |
| 2 | getPurchaseOrderDetail:111-113 | chef 拿到 `store_receipt_price_report` 的 `file_url`，可绕过 getReportFileUrl 直接 `downloadFile` 看供应商单价 | 中 |
| 3 | getSuppliers:58 | chef 传 `status:0` 即可查看停用供应商的联系人姓名/电话，绕过 includeInactive 校验 | 中 |
| 4 | getSupplierOrders:127 | 返回完整订单文档，供货商看到下单人/审核人/作废人姓名与内部作废原因 | 中 |
| 5 | getPurchaseOrders:134 | 返回完整订单文档，chef 可见 `verify_voucher_file_ids`（付款凭证 fileID），可绕过鉴权下载 | 低 |
| 6 | getPurchaseOrderDetail:96 | chef 的 items 仍含 `supplier_id`，与"chef 不见供应商身份"的注释口径不一致 | 低 |
| 7 | dataService:1480-1488 | `verifyManualOrder.submit` 按客户端传入的 fileID 列表删云存储文件（限定在本单历史凭证范围内） | 低 |
| 8 | dataService:643-653 | `markMessageRead` 不做可见集复查，只按字面归属判定，供货商可能越权标记全局广播消息已读 | 低 |
| 9 | importProducts:92 | `downloadFile({fileID})` 无路径校验，认证管理员可下载任意已知 fileID | 低（管理员工号） |

### 19.2 ⚠️ 供货商角色在三处报表入口全部被拒

`getReports`（L64-66）、`getReportDetail`（L74）、`getReportFileUrl`（L50）、`getPurchaseOrderDetail`（L60）、`getReceipts`（L56-57）—— **`supplier` 角色在这些入口全部 -403**。
供货商能拿到的价格信息**只有** `getSupplierReceipts` 的 `amount` 字段（§18.6）。
→ **供货商无法下载/查看自己的带价账单 CSV**，与"供应商触达走线下"的设计一致，但属**明确的产品缺口**。

### 19.3 静默截断清单（全部无报错、无 total 提示）

| 位置 | limit | 触发条件 |
|---|---|---|
| getProducts:53 | 200 | 商品超 200 个 |
| getProducts:53 + 56-59 | 200 | 关键词搜索只能搜前 200 条 |
| getSuppliers:67 | 100 | 供应商超 100 个 |
| getPurchaseOrders:117-120 | 1000 | 一页 20+ 单 × 多明细 |
| getReceipts:76-79 | 1000 | 一页 100 张 receipt × 多明细 |
| getSupplierOrders:72-75 | 1000 | 供货商历史明细超 1000 行 |
| getReportDetail:133-136, 164-167 | 200 | 单日超 200 单 |
| createReceipt:340-347 / dataService:1051-1058 | 100（每 20 商品） | 20 商品的全部供应商当前价超 100 条 → **误报缺价** |
| updateProductPrice:46-49 | 1000 | 同一供应商+商品明细超 1000 |
| importProducts:120 | 100 | 商品超 10000 个（100 次串行分页，可能超时） |
| authService:531-533 | 1000 | 门店超 1000 家 → 序号可能与后续门店撞号 |
| createPurchaseOrder:216-223 | 100（每 20 商品） | 单次下单 ≤100 商品，chunk 20 × 1 商品/条 = 最多 20 条，安全 ✅ |

### 19.4 数据正确性缺陷（非安全）

| # | 位置 | 缺陷 |
|---|---|---|
| 1 | getSupplierOrders:116 | `String(Date).localeCompare` → 订单按**星期几英文名**排序，顺序完全错乱 |
| 2 | getReportDetail:98-104 | 分批收货时收货报表详情只重建**任意一批**，与 CSV 不符 |
| 3 | getReportDetail:62-65, 84-198 | superseded 报表详情从当前业务表重建 → 显示**改量后的新值**，审计失效 |
| 4 | getReportDetail:118, 189 | `subtotal` 用 `toFixed(2)*1`（与 CSV 的 `Math.round(x*100)/100` 口径不同），且**不过滤 payable**、**无 NaN 保护** |
| 5 | getSupplierReceipts:101-109 | `amount` 对不可付款行照常计算 → 对账口径不一致 |
| 6 | getPurchaseOrders:81-92 | `to_verify` 视图下 tab 计数被 `verify_status` 污染 |
| 7 | generateSummaryReport:191 | 汇总金额系统性不含手动单凭证金额 |
| 8 | generateSummaryReport:227-228 | 月汇总 `related_date` 存单天日期 → 版本号按天跳变 |
| 9 | generateSummaryReport:250 | `generated_by_system: false` 与全项目不一致 |
| 10 | createReceipt:736 | 返回字段 `priceReportsSkipped` 语义错误 |
| 11 | getReceipts:44 | `storeId` 参数被忽略，管理员无法按门店筛选收货记录 |
| 12 | dataService:repriceReceipt | 关闭 missing_price 异常只写 `handled_by`，缺 `resolved_by/resolved_at` |
| 13 | dataService:1350-1352 | `requestCancel` 门店归属校验是死代码 |
| 14 | dataService:1412-1415 | `where({$or: ...})` 字面量是否被 SDK 识别**待核实**（若不识别则催审功能静默失效） |
| 15 | dataService:887-893 | `settleReceipt` 无事务/无条件更新 → 并发重复补结算 |
| 16 | createReceipt:373-379 | `isFinalBatch` 事务外计算 → 并发分批收货可让订单永久卡在 `partial_received` |

### 19.5 响应契约不一致

`requireUser`（dataService:45-52、importProducts:52-59）返回 `{ error: { code, msg } }`，被 `if (auth.error) return auth.error` 原样返回客户端 → 客户端收到 `{error:{code:-403,msg:...}}` 而非 `{code:-403,msg:...}`。
影响范围：**dataService 全部 action** + **importProducts**。其余 18 个云函数用内联写法，返回 `{code,msg}`。
→ 客户端若统一按 `res.code !== 0` 判定，会把这批鉴权错误当成功。

---

## 20. seed-data 详解（16 个文件，全部读完）

### 20.1 ✅ 已实测验证：seed 密码哈希与 README 声明的初始密码完全匹配

用与 `authService.hashPassword`（`authService/index.js:28-36`）**完全相同**的参数（`crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256')`）逐一复算：

| 账号 | 初始密码 | 结果 |
|---|---|---|
| admin | Admin@2026 | **MATCH** |
| chef | Chef@2026 | **MATCH** |
| manager | Manager@2026 | **MATCH** |
| admin_user | Purchaser@2026 | **MATCH** |
| supplier_test | Supplier@2026 | **MATCH** |

5/5 全部匹配。**README 的初始密码表可信。**（实测方式：本地 node 用 `crypto.pbkdf2Sync` 复算并与 seed 的 `password_hash` 比对。）

### 20.2 seed 与代码的字段漂移表（重点）

#### ⚠️ 漂移 A：`supplier` 集合字段两侧不互含

| 字段 | seed-data | 代码（dataService.saveSupplier:148-153） | 影响 |
|---|---|---|---|
| `address` | **有**（6 条全部有） | **从不写、从不读**（全项目 grep 0 命中） | 新建供应商永远没有 address；seed 的 address 是**孤儿字段** |
| `remark` | **无** | **写但不读**（saveSupplier:151 写入，无读取点） | 编辑供应商会新增 remark 字段，seed 老数据无 |

→ **dataService.saveSupplier 写入 `{supplier_name, contact_name, contact_phone, remark, updated_at}`，而 seed 是 `{supplier_id, supplier_name, contact_name, contact_phone, address, status, created_at, updated_at}`**。两侧字段集合几乎不重叠（除 4 个共有字段）。
- DB `update` 是合并语义 → 编辑 seed 供应商时 `address` 不会被清空 ✅。
- 但**新建供应商没有 address** → 前端若展示 address 会显示空。
- 严重度：**中（数据模型不一致）**。

#### ⚠️ 漂移 B：`purchase_order` 缺 8 个代码必写字段

seed 的 3 条订单只有：`purchase_order_id, order_no, store_id, store_name, order_date, created_by, order_status, remark, created_at, updated_at`。

代码 `createPurchaseOrder:273-298` 必写但 seed 缺失：
`delivery_date`、`backfilled`、`is_manual`、`verify_status`、`verify_amount`、`verify_voucher_file_ids`、`request_id`、**`created_by_name`**

- `created_by_name` 缺失 → getPurchaseOrders:135 / getPurchaseOrderDetail:68 都有 `|| creatorMap[...] || order.created_by` 兜底 ✅ **不坏**。
- `is_manual` 缺失 → falsy → 不会被误判为手动单 ✅。
- `verify_status` 缺失 → `_.neq('pending')` 对缺失字段为 true ✅。
- `delivery_date` 缺失 → createReceipt:542 `order.delivery_date || ''` 兜底 ✅。
- 严重度：低（有兜底，但字段集不一致）。

#### ⚠️ 漂移 C：seed 的 PO20260806001 是**混单**，违反当前代码的强制拆单规则

seed 的 PO20260806001 明细含 3 条档案商品（P001/P006/P013）+ 1 条手动商品（MANUAL_001，`is_manual:true`）。
而 `createPurchaseOrder:262-265`：
```js
if (manualCount > 0 && manualCount < items.length) {
  return { code: -1, msg: '手动商品需单独下单：手动商品与档案商品不能混在同一张采购单' }
}
```
→ **seed 数据当前无法由代码复现**，且该订单头的 `is_manual` 缺失（falsy）→ **`verifyManualOrder` 会拒绝对该订单核销**（dataService:1449 `if (!order.is_manual)`）。
- 严重度：**中（测试数据与规则冲突，误导开发者以为手动单可混单）**。

#### ⚠️ 漂移 D：`purchase_order_item.category_snapshot` 两种格式并存

- seed：`'后厨-蔬菜'`（一级-二级拼接，9 条全部如此）
- 代码 `createPurchaseOrder:248`：`product.category_name || product.category_level_1 || item.category || ''` → `'蔬菜'`（只有二级）
- → **同一集合两种格式并存**，CSV 报表与详情展示的分类格式不一致。
- 严重度：低（展示差异）。

#### ⚠️ 漂移 E：`receipt_item` 缺 `is_manual`/`is_shortage`/`is_quality_issue`/`is_wrong_item`

seed 的 3 条 receipt_item 只有 `receipt_item_id, receipt_id, purchase_order_item_id, product_id, product_name, supplier_id, received_qty, order_qty_snapshot, unit_snapshot, price_snapshot, payable_flag, remark, created_at`。

代码 `createReceipt:447-467` 额外写 `is_manual, is_shortage, is_quality_issue, is_wrong_item`。
- seed 第 1 行：`received_qty:28, order_qty_snapshot:30`，remark "少到 2 斤，已登记" → **明显少货，但 `is_shortage` 字段缺失**。
- **后果**：`getReportDetail:20-22`（读 `item.is_shortage`）与 `createReceipt:61-63`（读 `item.isShortage`）都读不到 → **seed 的少货异常在报表详情中不可见**。
- 但 `payable_flag: true` ✅ 正确（少货按实收付款，不剔除，符合 B4 设计）。
- 严重度：低（演示数据不完整）。

#### ⚠️ 漂移 F：`abnormal_record.abnormal_id` 格式与代码不一致 → settleReceipt 复付逻辑对 seed 数据失效

- seed：`abnormal_id: "ABN20260805001"`（单段，无下划线）
- 代码 `createReceipt:490`：`${receiptId}_${i+1}_${type}` = `"RCP20260805001_1_shortage"`（三段）
- `dataService.settleReceipt:904-908` 的复付逻辑：
  ```js
  const parts = String(rec.abnormal_id || '').split('_')
  if (parts.length < 3 || parts[0] !== receiptId) continue
  const itemItemId = receiptId + '_' + parts[1]
  ```
  seed 的 `"ABN20260805001"` → `split('_')` 长度 1 < 3 → **`continue` 跳过**。
- → **对 seed 数据的 `payment_decision='pay_received'` 异常，补结算的"转回可付款"逻辑完全不生效**。
- 严重度：**低（仅影响 seed 演示）**，但暴露了一个真实风险：**代码依赖 abnormal_id 的字符串格式做业务逻辑，而 abnormal_id 是自由格式的（无唯一索引、无格式约束），历史/手工数据一旦格式不符就静默失效**。

#### ⚠️ 漂移 G：`report_file` 缺 `basis_date_type`，且该字段全项目"只写不读"

- 代码写 `basis_date_type` 共 **14 处**：createPurchaseOrder:367,416；createReceipt:569,602,651,686；dataService:433,474,971,1162,1189,1222,1249；generateSummaryReport:245。
- **读取点：0 处**（getReports / getReportDetail / getReportFileUrl 均不读）。
- → **确认是"写入侧孤儿字段"**。seed 的 report_file 恰好也没写它，所以 seed 与"实际被使用的字段"一致，但与"代码写入的字段"不一致。
- 严重度：低（死字段，可考虑删除或补上读取逻辑）。

#### ⚠️ 漂移 H：`expiry_date` 全项目"只写 null，从不检查"

- `updateProductPrice:124` 写入 `expiry_date: null`（永不失效）。
- **没有任何代码检查 `expiry_date`**；createReceipt/repriceReceipt 查价只用 `is_current: 1`。
- seed 有 `expiry_date: "2026-07-31"` 的历史价格（PRC001，已置 `is_current: 0`）✅。
- → **过期价格不会被自动失效**，必须靠管理员手动调价把 `is_current` 置 0。如果供应商协议价到期但没人调价，**旧价格会一直生效**。
- 严重度：**中（价格治理缺口）**。

#### ⚠️ 漂移 I：`receipt.missing_reports` 一旦写入永不清除

- 写入 `true`：createReceipt:702（purchase_order）、createReceipt:706（**receipt**）、createPurchaseOrder:440（purchase_order）
- 清除 `false`：dataService:1017-1018、1266-1267 —— **都只清除 `purchase_order.missing_reports`**
- → **`receipt.missing_reports` 全项目无清除路径**。一旦报表生成失败并打上标记，收货单永远显示"缺报表"，即使报表后来补生成成功。
- 严重度：**中（数据一致性）**。

#### ⚠️ 漂移 J：`message` 集合字段集不一致（全局已读 vs 按用户已读）

- `dataService.createMessage:189-205`：写 `read_by: []`（按用户已读）+ `scope_type/scope_id`
- `createReceipt:521-534` / `createPurchaseOrder:55-73` / `confirmSupplierOrder:98-112`：**不写 `read_by`**，只有全局 `read` 布尔
- `getMessages:636` / `markMessageRead:656` 都有 `Array.isArray(...) ? ... : []` 兜底 ✅ **不坏**。
- 但**同一集合里两种已读语义并存**，属遗留设计。
- 严重度：低。

#### ⚠️ 漂移 K：seed 的异常消息 `biz_id` 指向 abnormal_id，代码指向 receipt_id

- seed message.json 第 3 行：`biz_id: "ABN20260805001"`（异常记录 ID），`recipient_user_id: ""`（门店广播）
- 代码 `createReceipt:523-534`：`biz_id: receiptId`，`recipient_user_id: abnormalRecipient`（**定向店长**）
- → seed 与代码的消息路由口径不同（seed 广播 vs 代码定向店长）。
- 严重度：低。

### 20.3 ⚠️ 导入格式不一致：report_file.json 是 JSON 数组，其余是 JSONL

- `report_file.json` 是 `[ {...}, {...} ]`（JSON 数组，167 行）
- 其余 13 个数据文件是 **JSONL**（每行一个 JSON 对象）
- README:5-19 建议"按顺序导入到集合"，但**同一个导入工具无法同时处理两种格式**。
- 严重度：低（导入时需手动调整 report_file.json）。

### 20.4 ⚠️ 日期字段类型混存：seed 用字符串，代码用 Date 对象

- seed 全部 `created_at`/`updated_at`/`generated_at`/`receipt_date` 等用**字符串**（如 `"2026-08-14 09:00:00"`，非标准 ISO，缺 `T` 和时区）
- 代码用 `db.serverDate()` 写**Date 对象**
- README:39 明确说明这是有意为之。
- **后果**：
  1. `orderBy('created_at','desc')`（getPurchaseOrders:107、getReceipts:66 等）在**混型数据**下行为不确定 —— CloudBase 对 Date 与 String 混存的排序顺序由 SDK 决定，**seed 数据与云函数写入的数据不会按时间正确交错**。
  2. **更关键**：`getSupplierOrders:116` 的 `String(created_at).localeCompare(...)` ——
     - seed 字符串 `'2026-08-06 10:00:00'` → `String()` 原样 → **字典序排序正确** ✅
     - 代码写的 Date 对象 → `String()` 得 `'Tue Aug 06 2026 12:26:40 GMT+0000 (Coordinated Universal Time)'` → **按星期几英文名排序，完全错乱** ❌
     - → **这解释了为什么 getSupplierOrders 的排序 bug 在演示环境可能没被发现**：seed 数据是字符串，排序正常；生产数据全是 Date 对象，全部错乱。
- 严重度：低（类型混存本身）→ 但**放大了 §18.5 的排序 bug**。

### 20.5 seed 与代码一致性核查：状态机枚举值

| 状态 | seed 出现 | 代码写入 | 代码接受 | 结论 |
|---|---|---|---|---|
| `submitted` | PO20260806001 ✅ | createPurchaseOrder:278 ✅ | 多处 ✅ | 一致 |
| `received` | PO20260805001 ✅ | createReceipt:509 ✅ | 多处 ✅ | 一致 |
| `approved` | PO20260804001 ✅ | dataService:552 ✅ | 多处 ✅ | 一致 |
| `cancelled` | 无 | cancelOrder:1301 ✅ | 多处 ✅ | 一致（seed 缺样例） |
| `partial_received` | 无 | createReceipt:509 ✅ | 多处 ✅ | 一致（seed 缺样例） |
| `receipt_abnormal` | 无 | createReceipt:509 ✅ | 多处 ✅ | 一致（seed 缺样例） |
| `rejected` | 无 | dataService:552 ✅ | 多处 ✅ | 一致（seed 缺样例） |
| `draft` | 无 | createPurchaseOrder:278 ✅ | 多处 ✅ | 一致（seed 缺样例） |
| `report_generated` | 无 | **无写入点** | 8 处接受 | ⚠️ **遗留死状态** |
| `pending_approval` | 无 | **无写入点** | 8 处接受 | ⚠️ **遗留死状态** |
| `completed` | receipt.receipt_status ✅ | createReceipt:437 ✅ | 仅 getSupplierOrders:14 当作**订单**状态 | ⚠️ 语义混淆 |

- `receipt_status` 的枚举（`completed`/`abnormal`）与 `order_status` 的枚举（`received`/`receipt_abnormal`）**两套命名不对应**，`getSupplierOrders:14` 还把 `completed` 混进订单状态白名单。
- 严重度：低（有兜底，但易误导）。

### 20.6 孤儿字段清单（汇总）

| 字段 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `supplier.address` | seed 有 6 条，代码 0 命中 | **seed 侧孤儿** | 代码从不读写 |
| `supplier_product_price.expiry_date` | 代码写 `null`，seed 有真实值 | **双侧孤儿** | 写入但从不检查 → 过期价格不自动失效 |
| `report_file.basis_date_type` | 代码写 14 处，读 0 处 | **代码侧孤儿** | 纯死字段 |
| `supplier_product_price.currency` | 代码写 `'CNY'`（updateProductPrice:122） | **代码侧孤儿** | 无读取点，硬编码 |
| `supplier.remark` | 代码写（saveSupplier:151），读 0 处 | **代码侧孤儿** | seed 无此字段 |
| `report_file.total_amount` / `item_count` | 仅 generateSummaryReport:252-253 写 | 汇总报表专属 | 其他 report_type 无，非孤儿但非通用 |
| `purchase_order.request_id` | 代码写（createPurchaseOrder:287） | 幂等键 | 有读取点（createPurchaseOrder:142 幂等查重）✅ 非孤儿 |
| `message.scope_type` / `scope_id` | dataService 写，getMessages 读 | ✅ 非孤儿 | supplier 消息定向用 |

### 20.7 supplier_test_user.jsonl

app_user.json 中 U004（supplier_test）的**单独副本**，JSONL 格式，字段完全相同。用途：README 未说明，推测是供货商账号的独立导入文件（便于单独重置供货商测试账号）。

---

## 21. scripts/build-icons.js 详解（12KB，227 行）

与数据层无关的纯 UI 图标生成脚本，但有两处值得记录：

- **41 个 `ICONS`（24×24 viewBox SVG 路径），89 个 `VARIANTS`（图标×颜色组合）**，生成 `styles/icons.wxss`（**其他批次的文件，本代理不触碰**）+ `scripts/icons-preview.html`。
- 颜色板 12 色（`COLORS`），与 app.wxss CSS 变量对齐（L9 注释）。
- ⚠️ **死代码**：`toDataUri`（L170-173）
  ```js
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27')
  ```
  `encodeURIComponent("'")` 的结果本就是 `'%27'`，所以 `.replace(/'/g, '%27')` **永远匹配不到单引号**，是冗余死代码。注释 L171 声称"单引号也编码掉"，意图正确但实现无效。无害。
- **已核对**：`VARIANTS` 引用的 41 个 icon 名全部存在于 `ICONS`，12 个 color 名全部存在于 `COLORS` → **无缺失键**。但代码**无运行时校验**：若新增 VARIANT 引用不存在的 icon，`ICONS[icon]` 为 `undefined`，`buildSvg` 会生成 `d='undefined'` 的 SVG（静默错误）。
- `kebab`（L162-164）：camelCase → kebab-case，`calendarDays` → `calendar-days` ✅。
- ⚠️ **分类图标覆盖缺口**：`VARIANTS` 中的分类类图标（chef/armchair/leaf/drumstick/fish/shaker/bowl/beer/snowflake/utensils/brush）去重后 11 个，seed 的 `category.json` 有 **12 个二级分类**（蔬菜/肉类/海鲜水产/调料干货/粮油/酒水饮料/冻品/豆制品/纸品/餐具/清洁用品/包装材料）。**至少有 1 个分类无对应 SVG 图标**。
  - 另外 seed 的 `category.json` 有 `icon` 字段存 **emoji**（如 `'🥬'`），且 `category_id` 8/9/12 的 emoji 为空字符串 → **分类图标实际有两套体系并存**（category 集合的 emoji vs build-icons 生成的 SVG）。前端如何映射属 UI 批次，此处仅记录观察。

---

## 22. 本批完成度

| 范围 | 数量 | 完成 |
|---|---|---|
| `cloudfunctions/` 云函数 index.js | 20 | ✅ 20/20 逐行读完 |
| `cloudfunctions/` package.json | 20 | ✅ 20/20 读完 |
| `seed-data/` 文件 | 16 | ✅ 16/16 读完 |
| `scripts/build-icons.js` | 1 | ✅ 读完 |

**总计 57 个文件，5436 行云函数代码 + 16 份 seed 数据 + 227 行脚本，全部读完。**

未触碰（其他批次）：`pages/`、`utils/`、`styles/`、`app.*`、`scripts/icons-preview.html`。

---

## 23. 待核实事项（无法仅凭代码判定）

1. **`transaction.rollback(data)` 的参数语义**（dataService:539）：`rollback({code:-1, msg:'...'})` 的参数是否进入 `err.errMsg`。L561 的 `err.errMsg.includes('该订单已经审核')` 依赖此行为。**需实测 wx-server-sdk 的 rollback 实现**。功能不受影响（仍能拦住重复审核），只影响用户看到的文案。
2. **`.where({$or: [...]})` 字面量是否被 SDK 识别**（dataService:1412-1415）：wx-server-sdk 官方写法是 `_.or([...])`。若 `$or` 字面量不被识别为逻辑运算符，where 会退化为"查询文档中真的有个 `$or` 字段" → 匹配 0 条 → `updated===0` → **`remindAudit` 催审功能对所有订单静默失效**（用户总是收到"已催办过"）。**需实测**。
3. **`getSuppliers` 的 `status` 参数越权**（§18.4）：需确认小程序前端是否会传 `status: 0`（若前端永远不传，实际危害有限）。
4. **`verify_amount` 未做 2 位小数舍入**（dataService:1507-1513）：需确认前端提交时是否已格式化。
5. **`report_file.file_url` 为空字符串的 seed 记录**（README:47 说明是有意为之）：`getReportFileUrl` 对空 file_url 查询会命中该记录，然后 `cloud.getTempFileURL({fileList:['']})` 会失败 → 返回"获取链接失败"。需确认前端对 seed 数据的降级展示。
