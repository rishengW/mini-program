# 全面覆盖勘探 A：身份域 + dataService

- 日期：2026-10-04　分支：backup（全程只读，未改任何源码、未做任何 git 操作）
- 逐行完整读取（无 excerpt 跳读）：
  - `cloudfunctions/authService/index.js`（684 行）
  - `cloudfunctions/dataService/index.js`（1681 行）
  - `cloudfunctions/authService/package.json`、`cloudfunctions/dataService/package.json`
- 目录确认（Glob）：两个函数目录下**只有 `index.js` + `package.json`**，均**无 `config.json` / `config.index.js` / `node_modules`**，无额外配置层。两者依赖均只有 `wx-server-sdk ~2.6.3`，无第三方库、无公共模块（会话/CSV/版本号逻辑各自复制一份）。
- 交叉验证（只读 grep，用于回答"死状态"与 SDK 语义两个问题）：全仓 19 个云函数的 `doc().get()`、`_.set`、`$or`、`_.or`、`order_status` 字面量，以及 `createPurchaseOrder`/`createReceipt`/`confirmSupplierOrder`/`getSupplierOrders`/`getPurchaseOrders` 的状态读写方与 `seed-data/abnormal_record.json`。
- 参考但未复制：`docs/exploration/deep-20261004/INDEX.md`、`01-identity-auth-session.md`、`02-dataservice-admin-message.md`。每条旧结论均以当前代码独立复核，标注为「仍然成立 / 代码已变化 / 旧报告判断有误」，对照结论集中在文末第 5 节。

---

## 0. 结论摘要（最重要的 6 条）

1. **超管入口可以被彻底锁死（两条独立路径，同源）**：`authService/setUserStatus:484-494` 的「最后一名超管」保护被错误地限定在 `target.username === 'admin'`，非 admin 超管停用时**完全不校验在岗超管数**；`updateUser:393-440` 既无「禁止操作自己」也无「最后一名超管」保护。两者组合可让**在岗超管数归零**，此后全部 `requireSuperAdmin` action 永久 `-403`，只能直连数据库恢复。这是本轮最严重的新发现（旧报告 R1/R2 已发现两个子问题，但漏掉了保护范围这一根因）。
2. **补结算存在两个不可逆缺口**：`dataService/settleReceipt:921-927` 用 `some()` 判定 `_S` 幂等 → 多供应商中途失败后**其余供应商账单永久缺失**（且 `payable_flag` 已置 true）；`:946` 排除 `status='closed'` → 异常用 `pay_received` 解决后**一旦被关闭就永久无法补结算**。两处都会造成供应商漏账，且状态不可回退。
3. **「操作成功但副作用没落地」的系统性模式，三个口径不一致**：`resolveAbnormal:800-830`（消息无 try/catch，重试被拒）、`cancelOrder:1420-1427`（消息无 try/catch）、`remindAudit:1523-1541`（`.catch` 里的 `return {code:-1}` 被 `await` 丢弃，**仍返回 code:0**，前端显示"已催办"但消息未写入）。同一文件内 `auditOrder:592-603` 是唯一正确的降级实现。
4. **停用门店 / 供应商会连带锁死账号登录，且无前置阻断**：`authService:77-79` 的 `findStore`/`findSupplier` 强制 `status:1`，而 `setStoreStatus` 只有"在途采购单"一道阻断、`toggleSupplier` **零阻断** → 停用即让该门店/供应商的全部账号无法登录，且 `repriceReceipt` 补价仍不按 `supplier.status` 过滤。
5. **越权面**：`getMessages:649-666` 非全局角色查询不含 `scope_type` 过滤，供应商定向消息（`store_id=''`、`recipient_user_id=''`）对**权限最低的 chef 全员可见**（含他人门店名与采购单号）—— 与 `:656` 注释声明的设计意图相悖；另有 `authService/getStores:322` 未排除 supplier 角色，供货商可枚举全部门店档案。
6. **会话体系有一处潜伏分裂点**：19 份 `getSessionUser` 副本中，`authService:106-131` 的 legacy 分支不要求 token 存在于 `sessions` 数组，其余（含本轮实测的 `dataService:17-43`）要求。当前**没有写入路径能构造出分歧态**（login 恒同步两字段），所以属潜伏点而非现存漏洞 —— 但将来任何"只清一个字段"的改动都会立刻分裂成「认证服务认、业务服务不认」。

---

## 1. `cloudfunctions/authService/index.js`（684 行）

### 1.1 文件职责

**自建账号表 + 自签随机 token 的认证与档案管理入口**：不走微信登录态（`openid` 仅顺手记录用于订阅消息），按 `event.action` 分发 14 个 case，覆盖登录/会话校验/登出/改密、门店 CRUD、账号管理。

### 1.2 Action 清单（入参 → 出参）

| # | action | 定义行 | 鉴权 | 入参字段 | 出参结构 |
|---|---|---|---|---|---|
| 1 | `login` | 156 | 无（登录本身） | `username`, `password`, `expectedRole?` | `{code, data:{user:publicUser, store:publicStore\|null, supplier:{supplierId,supplierName,contactName,contactPhone}\|null, sessionToken, sessionExpiresAt}}` |
| 2 | `validate` | 251 | `getSessionUser` | `authToken` | `{code, data:{user:publicUser, sessionExpiresAt}}` |
| 3 | `logout` | 269 | `getSessionUser`（允许为空） | `authToken` | `{code:0}`（无效 token 也返回 0） |
| 4 | `changePassword` | 288 | `getSessionUser` | `authToken`, `currentPassword`, `newPassword` | `{code:0}` |
| 5 | `getStores` | 314 | `getSessionUser` | `includeInactive?` | `{code, data:[publicStore]}` |
| 6 | `createStore` | 516 | `requireSuperAdmin` | `authToken`, `storeName`, `storeCode?` | `{code, data:{storeId, storeName, storeCode}}` |
| 7 | `updateStore` | 590 | `requireSuperAdmin` | `authToken`, `storeId`, `storeName` | `{code, data:publicStore}` |
| 8 | `setStoreStatus` | 622 | `requireSuperAdmin` | `authToken`, `storeId`, `status` | `{code, data:{storeId, status}}` |
| 9 | `listUsers` | 341 | `requireSuperAdmin` | `authToken` | `{code, data:[publicUser]}` |
| 10 | `createUser` | 351 | `requireSuperAdmin` | `authToken`, `username`, `name`, `password`, `role`, `mobile?`, `defaultStoreId?`, `defaultSupplierId?` | `{code, data:publicUser}` |
| 11 | `updateUser` | 393 | `requireSuperAdmin` | `authToken`, `id`, `username`, `name`, `password?`, `role`, `mobile?`, `defaultStoreId?`, `defaultSupplierId?` | `{code, data:publicUser}` |
| 12 | `resetPassword` | 442 | `requireSuperAdmin` | `authToken`, `id`, `newPassword` | `{code:0}` |
| 13 | `setUserStatus` | 473 | `requireSuperAdmin` | `authToken`, `id`, `status` | `{code, data:{status}}` |
| 14 | `deleteUser` | 510 | `requireSuperAdmin` | `authToken`, `id` | 转发 `setUserStatus({...event, status:0})` |
| — | default | 674 | — | — | `{code:-1, msg:'不支持的认证操作'}` |

顶层 catch（`:676-683`）：消息含 `collection`/`集合` → 「登录数据尚未初始化，请联系管理员」；否则统一「登录服务异常，请稍后重试」。

**公开出参形状**：`publicUser`（:49-62）→ `{id, userId, username, name, mobile, role, roleLabel, defaultStoreId, defaultSupplierId, status}`，**不含密码盐/哈希/迭代数/sessions/openid**，无敏感字段泄漏。`publicStore`（:64-73）→ `{id, storeId, storeName, storeCode, status}`。

### 1.3 读写的集合与关键字段

| 集合 | 读 | 写 | 关键字段 |
|---|---|---|---|
| `app_user` | login:161、getSessionUser:109/116、getDefaultStore:94、listUsers:344、updateUser:398、resetPassword:451、setUserStatus:481、setUserStatus 计数:487 | login:230、changePassword:300、createUser:371、updateUser:437、resetPassword:456、setUserStatus:504、login 失败计数:177/182 | `_id`（updateUser/resetPassword/setUserStatus 的 `id` 入参）、`user_id`（业务主键，chef 订单作用域）、`username`（唯一性靠查询非索引）、`role`/`role_label`、`default_store_id`/`default_supplier_id`、`status`（0/1）、`password_salt`/`password_hash`/`password_iterations`、`sessions[]`（元素 `{token_hash, expires_at}`，上限 5）、`session_token_hash`/`session_expires_at`（旧单会话兼容）、`login_fail_count`/`login_locked_until`、`openid`、`last_login_at`、`created_at`/`updated_at` |
| `store` | findStore:77、getDefaultStore:98、getStores:326、updateStore:599/606、createStore:526/534/544、setStoreStatus:629 | createUser:371（无，仅校验）、createStore:564、updateStore:614、setStoreStatus:651 | `_id`、`store_id`（`S+3位序号`，不可改）、`store_name`、`store_code`、`status` |
| `supplier` | findSupplier:86、createUser:365 | 无（只读校验 + 登录时展示） | `supplier_id`、`supplier_name`、`contact_name`、`contact_phone`、`status` |
| `purchase_order` | setStoreStatus:643（`count()` 阻断检查） | 无 | `store_id`、`order_status` |

**索引假设（代码未声明，需控制台确认）**：`app_user.username`、`app_user.sessions.token_hash`（数组元素匹配）、`app_user.session_token_hash` —— 这三条是**每个请求都在跑**的热路径（19 个云函数各自查一次）；`store.store_id`、`supplier.supplier_id` 为唯一查询键；`purchase_order(store_id, order_status)` 供阻断检查。

### 1.4 身份获取与越权面

- **openId/role/storeId 的取值**：全部来自服务端 `getSessionUser(authToken)` 的数据库回查（`:109-112`），**从不信任前端传入的 role/storeId**。`openid` 只在 `login:218` 通过 `cloud.getWXContext().OPENID` 取，不参与鉴权。
- **角色裁决函数唯一**：`requireSuperAdmin:334-339`（`-403`），另有 `getSessionUser` 直接判 `status:1` 的硬前置（`:110`）。
- **越权评估**：13 个需登录的 action 全部调用 `getSessionUser` 或 `requireSuperAdmin`，**无遗漏、无绕过**。未发现纵向越权（普通用户调管理 action）。
- **横向越权（本轮新发现 2 处）**：
  - `getStores:322` 的收窄条件是 `STORE_ROLES.includes(user.role)`，而 `STORE_ROLES = ['chef','store_manager']`（`:21`）**不含 supplier** → supplier 走 `where({status:1})`，返回**全部门店**。
  - `getStores` 的 `includeInactive`（`:319`）对所有登录用户开放（非仅超管）；对 STORE_ROLES 仍收窄到本店，故影响面限于"看本店停用记录"。
- **作用域信任**：`updateUser`/`setUserStatus`/`resetPassword` 的 `event.id` 直接 `doc(id).get()` —— 有 `requireSuperAdmin` 兜底，不构成越权；但 id 由前端提供且无格式校验（见问题 A-14）。

### 1.5 状态流转与业务校验

- **账号状态机**：`1 正常 ⇄ 0 停用`，软删除（`deleteUser` 直接落到 `setUserStatus(status:0)`，`:508-512`），历史记录保留以维持 `created_by` 追溯链。无 `pending`/`deleted` 中间态。
- **门店状态机**：`1 正常 ⇄ 0 停用`，软删；停用前用 `ACTIVE_ORDER_STATUS`（`:642`）count 未完结采购单，`>0` 拒绝。编号创建后不可改（`:589` 注释 + `updateStore` 只写 `store_name`）。
- **密码策略**：PBKDF2-SHA256 / 固定 120000 迭代 / 16 字节随机盐 / hex；比对用 `timingSafeEqual` + 长度预检（`:38-43`，实现正确）。策略仅「≥6 位」，无复杂度要求。
- **会话**：`crypto.randomBytes(32)` token，库中只存 SHA-256 哈希；TTL 7 天；每账号最多 5 条会话，挤出最旧；登录同时双写 `sessions[]` 与旧单会话字段。
- **登录锁定**：per-user，5 次失败锁 10 分钟；用原子 `_.inc` + 条件更新（`login_fail_count: _.gte(5)`）防并发顺延。
- **角色入口互斥**：`expectedRole` 服务端强制（`:195-197`），超管与普通角色入口互斥 —— 但**仅在传入时校验**。

### 1.6 错误处理 / 并发 / 幂等

| 手段 | 位置 | 评价 |
|---|---|---|
| 原子 `_.inc` + 条件更新 | login:177-190 | 正确，防并发绕过锁定 |
| 条件更新 `_.gte` | login:183 | 正确，防重复写锁 |
| 序号重试（3 次） | createStore:562-581 | 有兜底，但撞号仅重试 store_id，`storeCode` 冲突时 3 次都撞同一编号 |
| 无事务、无乐观锁、无 version 字段 | 全文件 | 账号/门店管理为低频操作，可接受 |
| **无幂等键** | createUser（查重与写入非原子 :357-371） | 并发可建重名账号 |
| 无事务 | login:161-230（读→算→整数组覆盖写） | 并发登录会丢会话，见 A-4 |

### 1.7 问题（authService）

| ID | 级别 | 位置 | 问题 | 可复现触发场景 |
|---|---|---|---|---|
| **A-1** | **高** | `:479-494`（保护范围）+ `:393-440`（无任何保护） | **「最后一名超管」保护被错误限定在 `target.username === 'admin'`**；`updateUser` 则完全没有在岗超管检查。系统可被驱动到**在岗超管数 = 0** | 账号 admin、admin2 均为在岗超管。① `setUserStatus(admin, 0)` → guard 生效，admin2 在岗，允许停用；② `setUserStatus(admin2, 0)` → `username !== 'admin'`，**跳过 guard**，允许。此后所有 `requireSuperAdmin` action 返回 `-403`，管理入口永久锁死，只能直连数据库恢复。或：`updateUser(admin2, role:'purchaser')` 同样无检查 |
| **A-2** | **高** | `:393-440` | `updateUser` **既无「禁止操作自己」也无「最后一名超管」保护**（对照 `resetPassword:446`、`setUserStatus:479` 都有 `event.id === auth.user._id` 保护，唯此处缺） | username 非 admin 的超管在账号管理页把**自己**的角色改成 `purchaser` 保存 → 角色立即生效（`getSessionUser` 每次现读 role），若系统仅剩该超管则管理入口锁死 |
| **A-3** | **高** | 写 `:499-504`；校验 `:109-112`；注释自称已防 `:470-472` | 停用只清 `session_token_hash`/`session_expires_at`，**未清 `sessions` 数组**；而会话校验查的正是 `sessions` → **停用→再启用会复活旧会话** | 员工 A 在 3 台设备各登录一次 → 停用 A（旧 token 因 `status=0` 暂时失效）→ 7 天内重新启用 → 旧设备 token **无需重新登录即复活**。对照组 `changePassword:305`、`resetPassword:461`、`updateUser:433` 都写了 `sessions: []`，唯此处漏 |
| A-4 | 中 | `:213-216` 计算 + `:230` 整数组覆盖写 | **并发登录同一账号会随机丢失会话**：读旧值→各自 push→覆盖写，最后写者胜出，被覆盖掉的那个 token 既不在 `sessions` 也不等于 `session_token_hash` | 同一账号两台设备几乎同时点登录（或单设备双击）→ 先返回 token 的那台设备，首个请求即 `-401`「登录已过期」 |
| A-5 | 中 | `:314-332`（收窄条件 `:322`） | `getStores` **未排除 supplier 角色** → 供货商可列出全部门店（名称/编号/状态）。dataService 对 supplier 做了显式收窄（`getMessages:655-657`、`getAbnormalRecords:732`、`getOrderStats:874`），此处缺 | supplier 角色调用 `getStores`（或任何前端未拦截该 action 的入口）→ 返回全部门店档案 |
| A-6 | 中 | `:622-655`；连锁 `:77-79`、`:93-96`、`:206-207` | 停用门店会**连带锁死该门店全部账号的登录**（`findStore` 强制 `status:1` → `getDefaultStore` 返回 null → 登录报「账号未关联有效门店」），但**只有"在途采购单"一道阻断**，无"该门店仍有在岗账号"检查，也无任何提示 | 停用一个还有 5 个在用账号的门店 → 这 5 个账号下一次登录全部失败，且无法自行恢复 |
| A-7 | 中 | `:344-348` | `listUsers` `.limit(100)` 无分页、无 `total` → 账号 > 100 时超出部分**在前端完全不可见**（不能编辑/停用/重置密码），只能直连数据库 | 账号总数超过 100 |
| A-8 | 中 | `verifyPassword:40` + `hashPassword:32` | `password_iterations` **信任数据库值、无下限校验**；`Number(iterations) \|\| 120000` 只挡住 0/falsy，写入 `1` 就会用 1 次迭代 | 数据库被直改 / 历史数据 / 种子数据写入低迭代数 → 密码强度被静默降级而服务端照旧信任 |
| A-9 | 中 | `:106-131`（本文件）vs `dataService:17-43` 等其余 18 份 | 会话校验逻辑**复制 19 份**，且本文件的 legacy 分支**不要求 token 存在于 `sessions` 数组**，其余 18 份（含本轮实测的 dataService 版）要求 | 潜伏态：当前无写入路径能构造出「`session_token_hash` 命中但 token 不在 `sessions`」的分歧态（login 恒同步两字段）。将来任何"只清一个字段"的改动 → 认证服务认、业务服务不认 |
| A-10 | 中 | `:174`、`:171`、`:194` | **用户枚举**：`:174` `!user \|\| !verifyPassword(...)` 短路 → 用户名不存在时**不跑 PBKDF2**（120k 迭代时序可远程区分）；`:171` 泄露锁定剩余分钟；`:194` 单独提示「账号已停用」。锁定是 per-user，无 per-openid/IP 频控、无验证码 | 攻击者用固定密码扫用户名列表，由响应时序 + 三类文案稳定枚举出存在/停用/被锁的用户 |
| A-11 | 中 | `:288-312` | `changePassword` **无失败次数限制**（对照 `login:166-191` 有完整 5 次锁定机制） | 持有效 token 者反复提交 `changePassword` 对当前密码无限爆破 |
| A-12 | 中 | `:642` | `ACTIVE_ORDER_STATUS` **未含 `receipt_abnormal`**（也未含 `rejected`）→ 已收货但存在未处理异常的门店可直接停用 | 门店有 `receipt_abnormal` 状态订单 → count 为 0 → 停用成功，异常流程被中途切断。是否可接受属业务口径 |
| A-13 | 中 | `:484-493`（后端）vs 前端 `user-manage.js` 硬编码禁止停用 `admin` | 前后端对 `admin` 账号口径冲突：后端**明确允许**停用（前提还有另一名在岗超管），前端提示「默认系统超管不可停用」→ 掩盖真实能力 | 管理员按前端提示认为 admin 不可停用；反之非 admin 的超管在前端无任何拦截 |
| A-14 | 低 | `:398-400`、`:438`、`:451-453`、`:481-483` | **`if (!target) return {msg:'用户不存在'}` 是死代码**：同仓所有 `getCounter` 都用 `.catch(() => null)` 包裹 `doc().get()`（`createPurchaseOrder:116`、`createReceipt:79/410`、`dataService:367`），说明 SDK 对不存在的文档是**抛错**而非返回空 | 传一个不存在的 `id`（旧客户端缓存、手滑）→ 直接抛错 → 顶层 `:682` 返回通用文案「登录服务异常，请稍后重试」，丢失「用户不存在」提示 |
| A-15 | 低 | `:641` | `const _ = db.command` **遮蔽**模块级 `:6` 的同名变量（`:644` 仍在用，故非错误） | 极易被误改为「这里应该用模块级的 `_`」 |
| A-16 | 低 | `:269-286` | `logout` 清 `session_token_hash: ''`/`session_expires_at: null` 会让**所有设备的 legacy 会话**同时失效，与 `:272` 注释「仅移除当前设备的会话」不符；且无效 token 也返回 `{code:0}`，前端无法区分真登出与 token 本就无效 | 一台 legacy 设备登出 → 其他 legacy 设备静默掉线 |
| A-17 | 低 | `:543-547` | 序号取现有最大值，`.field({store_id:true}).limit(1000)` 取候选；注释称「全量遍历而非采样」实际有 1000 上限 | 门店数 > 1000 → `maxSeq` 失真 → `store_id` 撞号（重试仅 3 次） |
| A-18 | 低 | `:520-532`、`:595-612` | 门店名查重只做 `trim()`，未处理全角空格/大小写 → 可建出视觉上重复的门店 | 手工创建「第一门店」与「第一门店　」（全角空格） |
| A-19 | 低 | `:217-229` | `openid` 每次登录覆盖（注释自述「以后登录者为准」）→ 同一微信号先登门店账号后登供货商账号，推送 `touser` 指向后登录账号 | 同一微信上先后登录两个业务身份的账号 → 业务消息可能推到错误的业务身份 |
| A-20 | 低 | `:376`、`:421`、`:144/:295/:449`、`:195` | `mobile` 仅 `trim()` 无格式校验；密码仅 ≥6 位无复杂度要求；`expectedRole` 仅在传入时校验 → 省略即可绕过角色入口互斥（后端 action 仍拦截，**不构成越权**） | 弱密码 `123456` 可通过 |

---

## 2. `cloudfunctions/dataService/index.js`（1681 行）

### 2.1 文件职责

**万能分发器**：唯一入口 `exports.main`（`:1650`）按 `event.authToken` 换会话、按 `event.action` switch 分发 **22 个 case + 1 default**，覆盖分类/商品/供应商主数据、订单审核、消息中心、异常记录、首页统计、补结算、报表补生成、作废/申请取消、催审、手动单凭证核销。

### 2.2 Action 清单（完整 22 个）

| # | action | 定义行 | 角色门槛 | 入参字段 | 主要集合（读→写） | 写手段 | 出参 |
|---|---|---|---|---|---|---|---|
| 1 | `getCategories` | 54 | 任意登录 | — | category 读 | — | `{code, data:{level1:[], categories:[]}}` |
| 2 | `saveProduct` | 91 | MANAGEMENT | `productId?`, `name`, `unit`, `categoryId`, `defaultSupplierId?`, `spec?`, `manufacturerName?` | product(读+写)、category(读)、supplier(读) | 无事务 | `{code, data:{productId}}` |
| 3 | `toggleProduct` | 132 | MANAGEMENT | `productId` | product(读+写) | 无事务 | `{code, data:{status}}` |
| 4 | `saveSupplier` | 143 | MANAGEMENT | `supplierId?`, `supplierName`, `contactName?`, `contactPhone?`, `remark?` | supplier(读+写) | 无事务 | `{code, data:{supplierId}}` |
| 5 | `toggleSupplier` | 176 | MANAGEMENT | `supplierId` | supplier(读+写) | 无事务 | `{code, data:{status}}` |
| 6 | `auditOrder` | 491 | MANAGEMENT | `orderId`, `status`(approved/rejected), `auditRemark?`, `items?[{itemId, approveQty}]` | purchase_order(+_item) 读、report_file 读+写、report_version_counter 写、supplier 读、message 写 | **事务**(540) + 事务后复查(583) | `{code, data:{reportWarning}}` |
| 7 | `getMessages` | 644 | 任意登录（角色过滤） | — | message 读 | — | `{code, data:[{id,messageId,type,title,content,bizId,read,time}]}` |
| 8 | `markMessageRead` | 675 | 任意登录 + 归属校验 | `id` | message 读+写 | 按用户 push | `{code:0}` / `{code:-403}` |
| 9 | `markAllMessagesRead` | 697 | 任意登录 | — | message 读+写 | **串行循环**（最多 100 条 = 200 次往返） | `{code:0}` |
| 10 | `getAbnormalRecords` | 729 | 任意登录（chef 返回 `[]`） | `status?` | abnormal_record 读、supplier 读 | — | `{code, data:[{id,abnormalId,type,typeName,description,supplierName,storeName,status,statusName,createdAt,resolution}]}` |
| 11 | `startAbnormal` | 766 | store_manager/purchaser/super_admin + 门店归属 | `id` | abnormal_record 读+写 | 无事务 | `{code:0}` |
| 12 | `resolveAbnormal` | 782 | 同上 | `id`, `resolution`, `paymentDecision?`(pay_received/reject) | abnormal_record 读+写、message 写 | 无事务、**消息无 try/catch** | `{code:0}` |
| 13 | `closeAbnormal` | 834 | 同上 | `id` | abnormal_record 读+写 | 无事务 | `{code:0}` |
| 14 | `getOrderStats` | 859 | 任意登录（角色 scope） | `storeId?`（仅全局角色生效） | purchase_order count 聚合（4 个并行） | — | `{code, data:{submitted, receivable, received, to_verify}}` |
| 15 | `settleReceipt` | 902 | GLOBAL | `receiptId` | receipt(读+写锁)、receipt_item(读+写)、abnormal_record(读)、supplier(读)、report_file(写)、report_version_counter(写) | **CAS 锁**(932，10 分钟自愈) | `{code, data:{generatedSuppliers, count}}` |
| 16 | `repriceReceipt` | 1098 | GLOBAL | `receiptId` | receipt_item(读+写)、supplier_product_price(读)、abnormal_record(读+写) + 调 `regenerateReceiptReports` | 无事务 | `{code, data:{message, repriced, stillMissing}}` |
| 17 | `regenerateReceiptReports` | 1168 | GLOBAL | `receiptId` | receipt(+_item) 读、supplier 读、report_file 写、purchase_order 写 | 无事务（catch 返回部分成功） | `{code, data:{generated, count}}` |
| 18 | `regenerateOrderReports` | 1051 | GLOBAL | `orderId` | purchase_order(+_item) 读+写、report_file 写 | 无事务 | `{code, data:{orderId, regenerated}}`（**死入口**，无前端调用方） |
| 19 | `cancelOrder` | 1342 | GLOBAL | `orderId`, `reason` | purchase_order 读+写、report_file 读+写、message 写 | **事务**(1364) | `{code:0}` |
| 20 | `requestCancel` | 1432 | GLOBAL | `orderId`, `reason` | purchase_order 读+写、message 写 | **CAS**(1456) | `{code:0}` |
| 21 | `remindAudit` | 1482 | chef/store_manager/purchaser/super_admin + 门店归属 + 1h 限频 | `orderId` | purchase_order 读+写、message 写 | **CAS**(1509) + 失败回滚标记 | `{code:0}` |
| 22 | `verifyManualOrder` | 1549 | `submit`→VOUCHER_SUBMIT；`approve/reject`→GLOBAL | `verifyAction`, `orderId`, `amount?`, `voucherFileIds?`, `note?` | purchase_order 读+写 + `cloud.deleteFile` | **CAS**(1585/1620/1632) | `{code, data:{message}}` |
| — | default | 1675 | — | — | — | — | `{code:-1, msg:'不支持的数据操作'}` |

**辅助函数（非 action）**：`hashToken`:13、`getSessionUser`:17、`requireUser`:45、`findCategory`:83、`createMessage`:187、`getStoreManagerId`:209、`resolveActiveRecipient`:224、`getSupplierUsers`:254、`sendSubscribeMessage`:269、`notifySuppliersNewOrder`:296、`csvField`:350、`safePathPart`:357、`getNextVersion`:361、`regenerateApprovedOrderReports`:394、`publicMessage`:631。

**角色常量**：`GLOBAL_ROLES=['super_admin','purchaser']`(:8)、`MANAGEMENT_ROLES` **同值重复定义**(:9)、`VOUCHER_SUBMIT_ROLES=['super_admin','purchaser','store_manager']`(:11)。

### 2.3 集合与关键字段

| 集合 | 读写 | 关键字段 |
|---|---|---|
| `category` | 读（`getCategories`、`findCategory`） | `category_id`(Number)、`category_name`、`category_level_1`/`category_level_1_name`/`category_level_1_icon`、`sort_no`、`icon`、`status`。**全仓零写入**，无管理界面 |
| `product` | 读+写 | `product_id`(`P+时间戳+6hex`)、`product_name`、`category_level_1`/`category_level_2_id`/`category_name`（快照）、`unit`、`spec`、`default_supplier_id`、`manufacturer_name`、`status` |
| `supplier` | 读+写 | `supplier_id`(`SUP+时间戳+6hex`)、`supplier_name`、`contact_name`、`contact_phone`、`remark`、`status` |
| `purchase_order` | 读+写 | `purchase_order_id`、`order_status`、`store_id`/`store_name`、`created_by`、`is_manual`、`supplier_confirmations`、`missing_reports`、`cancel_requested`/`cancel_requested_at`/`cancel_request_reason`/`cancel_requested_by`、`audit_reminded_at`、`verify_status`/`verify_amount`/`verify_voucher_file_ids`/`verify_note`/`verify_reject_note`/`verify_submitted_by`/`verify_cancel_note` |
| `purchase_order_item` | 读+写 | `item_id`、`purchase_order_id`、`order_qty`、`approved_qty`、`original_order_qty`、`product_name_snapshot`、`category_snapshot`、`unit_snapshot`、`supplier_id`、`is_manual` |
| `receipt` | 读+写（补结算锁） | `receipt_id`、`receipt_date`、`batch_no`、`is_final`、`receipt_status`、`received_by`、`purchase_order_id`、`settle_lock`、`settle_lock_at`（**数字 Date.now()**，与全站 serverDate 不一致） |
| `receipt_item` | 读+写 | `receipt_item_id`(`{receiptId}_{序号}`)、`receipt_id`、`received_qty`、`order_qty_snapshot`、`price_snapshot`、`payable_flag`、`is_manual`、`supplier_id`、`product_id`、`is_shortage`/`is_quality_issue`/`is_wrong_item` |
| `abnormal_record` | 读+写 | `abnormal_id`(`{receiptId}_{行序号}_{type}`)、`receipt_id`、`type`、`status`(pending→processing→resolved→closed)、`resolution`、`payment_decision`、`handled_by`、`resolved_by`、`closed_by`、`store_id`/`store_name`、`supplier_id` |
| `supplier_product_price` | 只读 | `product_id`、`supplier_id`、`price`、`is_current`、`effective_date` |
| `message` | 读+写 | `message_id`、`type`(approval/order/abnormal/cancel/receive)、`title`、`content`、`biz_id`、`recipient_user_id`、`store_id`、`scope_type`/`scope_id`、`read`(恒 false，**死字段**)、`read_by[]`、`read_at` |
| `report_file` | 读+写 | `report_id`、`report_type`、`report_scope`、`scope_id`/`scope_name`、`related_date`、`source_order_id`、`basis_date_type`、`file_name`/`file_url`/`file_version`、`status`(generated/superseded)、`settle_for_receipt`/`settle_type`、`excluded_rows`、`has_abnormal`、`regenerated` |
| `report_version_counter` | 读+写 | `_id`(`{type}_{scopeId}_{date}`)、`count` |

### 2.4 身份与越权

- 身份全部来自 `getSessionUser(authToken)` 的服务端回查（`:17-43`），`requireUser(event, roles)`（`:45-52`）是唯一鉴权原语。
- **未发现纵向越权**：22 个 action 全部先过 `requireUser`，写权限按角色分层（MANAGEMENT / GLOBAL / VOUCHER_SUBMIT）。
- **横向越权 1 处（新）**：`getMessages` 非全局角色查询缺 `scope_type` 过滤（见 D-4），门店角色可见所有供应商定向消息。
- 门店归属校验在 `startAbnormal:772`、`resolveAbnormal:792`、`closeAbnormal:1442`、`remindAudit:1497`、`verifyManualOrder:1570` 重复出现；`requestCancel:1451` 处为**死代码**。
- 客户端伪造 `storeId` 对全局角色只是筛选器（`getOrderStats:872`），对非全局角色一律被服务端覆盖为 `default_store_id` —— 服务端从不信任前端作用域参数。

### 2.5 状态流转与业务校验

| 对象 | 状态机 | 校验 |
|---|---|---|
| `abnormal_record` | `pending → processing → resolved → closed` | 每步校验前置（`:775/:795/:845`），越级被拒 |
| `purchase_order`（审核） | `submitted/pending_approval → approved / rejected` | 禁自审（`:504-507`）、幂等（`:508`）、驳回必填原因（`:511`）、改量 `>0` 且 `<= order_qty`（`:534`） |
| `purchase_order`（作废） | `submitted/approved/report_generated → cancelled` | 必填原因、已有收货（`partial_received/received/receipt_abnormal`）拒绝（`:1357`）、事务内复查（`:1364-1384`） |
| `purchase_order`（凭证核销） | `none → pending ⇄ rejected → approved` | 门槛放宽到 `received/receipt_abnormal/partial_received` 三态（`:1579`）、凭证 ≤9 张 + 前缀校验（`:1559-1562`）、金额 `>0` 且 finite（`:1631`） |
| 报表 | `generated → superseded` | 仅下单类在改量重算时标记（`:423-425`）；收货类**不标记** |

### 2.6 错误处理 / 并发 / 幂等

| 手段 | 位置 | 评价 |
|---|---|---|
| `runTransaction` + 事务内复查 + `rollback({code,msg})` + 子串匹配回传 | `auditOrder:540-579`、`cancelOrder:1364-1418` | 正确。两处都处理了 SDK 把 rollback 信息塞进 `errMsg` 的脆弱性 |
| 事务后二次复查 | `auditOrder:583-590` | 正确处理事务提交与副作用之间的窗口 |
| 副作用失败降级为警告 | `auditOrder:592-603`、`:612-619`、`:621-627`；`cancelOrder` **缺** | 本文件唯一正确示范；`resolveAbnormal`、`cancelOrder` 缺 |
| 副作用失败回滚标记 | `remindAudit:1529-1541` | 逻辑正确但返回码有缺陷（见 D-11） |
| CAS 条件更新（`stats.updated===1`） | `settleReceipt:932-940`（带 10 分钟过期自愈）、`requestCancel:1456-1469`、`remindAudit:1509-1521`、`verifyManualOrder:1585/1620/1632` | 正确，是本项目主流幂等手段 |
| `getNextVersion` CAS 取号 | `:361-387` | 读旧值→条件更新→5 次重试，末次带真实错误原因，避免了 `_.inc` 后回读的并发碰撞 |
| 事务内避开 `where().update()` | `cancelOrder:1401-1406` | 正确处理 SDK「事务内 where().update() 不带 transactionId」限制 |
| **完全无幂等** | `regenerateOrderReports`、`regenerateReceiptReports`、`repriceReceipt`、`resolveAbnormal`、`settleReceipt` 的部分失败路径 | 见 D-1/D-2/D-8/D-10 |
| **无唯一索引** | `report_file.report_id`、`app_user.username`、`store.store_id`、`supplier.supplier_name` | 依赖查询查重，并发可穿透 |

### 2.7 问题（dataService）

| ID | 级别 | 位置 | 问题 | 可复现触发场景 |
|---|---|---|---|---|
| **D-1** | **高** | `:921-927`（`some()` 判定）+ `:960-962`（先置 flag）+ `:1004-1033`（逐供应商生成） | **补结算幂等粒度错误 → 中途失败后其余供应商账单永久缺失**。幂等检查按 `report_id endsWith(receiptId + '_S')` 的 `some()` 判定，而 report_id 是**每供应商一份**（`:1024`），命中任意一份即视为「已补结算」 | 收货单 R 有 3 个供应商的 `pay_received` 异常行。补结算时供应商 A 的 CSV 上传或 `add` 成功、供应商 B 失败 → `finally` 释放锁。重试 → `some()` 命中 A 的那条 → 返回「该收货单已补结算，请勿重复操作」。**B、C 的补充账单永不存在**，而 `receipt_item.payable_flag` 已在 `:960-962` 置 true → 财务对账应收/应账单不一致 |
| **D-2** | **高** | `:946`（`item.status !== 'closed'`） | **异常用 `pay_received` 解决后一旦关闭就永久无法补结算**，且状态不可回退 | 店长 `resolveAbnormal`（`paymentDecision:'pay_received'`）→ 管理员点「关闭异常」→ 再补结算 → `payReceivedRecords` 为空 → `unlockedIds.size===0` → 「没有因异常处理解锁的明细行，无需补结算」。此路**不可逆**（`closed` 不能回退），前端 `closeAbnormal` 按钮无任何提示 |
| D-3 | 中-高 | `:800-830`（写状态后连发 2 条消息，**均无 try/catch**） | 异常已置 `resolved`，消息写入失败时用户看到「CloudBase 数据操作失败」而重试被拒，「待补结算提醒」永久丢失 → 直接导致供应商账单缺一笔（正是 `:822-823` 注释想防的事） | `:800` 更新成功，`:810` 或 `:824` 的 `createMessage` 抛错 → 顶层 `:1679` 返回通用错误。重试 → `:795`「只有处理中异常才能标记为已解决」。对照 `auditOrder:592-603` 有降级、`remindAudit:1529-1541` 有回滚，**唯此处缺** |
| D-4 | 中 | `:649-666`（非全局角色分支 `:658-664`） | **`getMessages` 非全局角色查询不含 `scope_type` 过滤** → 供应商定向消息对权限最低的 chef 全员可见。`notifySuppliersNewOrder:324-331` 的消息不传 `storeId`/`recipientUserId` → `store_id=''`、`recipient_user_id=''`，恰好同时命中 `storeCondition` 的 `{store_id:''}` 与 `recipientCondition` 的 `{recipient_user_id:''}` | 任意 store_manager/chef 打开消息中心（`message.js`、`index.js` 即触发）→ 看到所有门店、所有供应商的新订单通知（含他人门店名、采购单号、该供应商项数）。与 `:656` 注释声明的设计意图相悖。附带：`markMessageRead:683-685` 同样不校验 scope → 门店角色可把供应商消息标已读（污染 `read_by`，但不改供应商的已读态）。**修复注意**：旧数据无 `scope_type` 字段，过滤必须写成 `_.or([{scope_type: _.neq('supplier')}, {scope_type: _.exists(false)}])`，不能只用 `_.neq` |
| D-5 | 中 | `:666`（`.limit(100)` 无分页/offset）+ `:704-710` | 历史消息 > 100 条时第 101 条起**永不可达**；「全部已读」只覆盖前 100 条 → 尾部未读**永久不消**、角标恒亮。且逐条 `doc().get()+update()` 串行 = 最多 200 次 DB 往返，有云函数超时风险 | 累计消息超过 100 条 |
| D-6 | 中 | `:135`、`:179` | `toggleProduct`/`toggleSupplier` **无空参校验**：`where({product_id: undefined})` → SDK 丢弃 undefined 键 → where 为空 → 匹配全部文档 → `.limit(1)` 命中任意第一条 → **静默翻转无关记录的 status** | 调用时 `productId`/`supplierId` 为空（前端崩溃、参数被剥离、直接调云函数）→ 随机一个商品/供应商被停用。攻击面限 purchaser/super_admin，但数据破坏面大 |
| D-7 | 中 | `:176-185`（零前置检查）+ 连锁 `authService:203-204`、`:204`；`repriceReceipt:1118-1122` 不按 `supplier.status` 过滤 | 停用供应商**无任何前置检查**，且会**立即锁死该供应商全部账号登录**；停用后仍能对该供应商补出账单。对比 `authService/setStoreStatus:639-648` 有在途采购单阻断 | 停用仍有 10 个未完结订单的供应商 → 其账号无法登录；`repriceReceipt` 仍为该供应商生成账单 |
| D-8 | 中 | `:1130-1132`（不可逆改价）→ `:1156`（报表可能失败） | 补价成功（`price_snapshot` 已改、异常已关）后 `regenerateReceiptReports` 失败 → 重试时 `:1110` 的 `missingItems` 已空 → 「该收货单没有缺价行，无需补账」→ **本入口永久无法重出账单**，只能绕道单独调 `regenerateReceiptReports`（用户不会知道） | 补价过程中云存储抖动 |
| D-9 | 中 | `:1114-1122` | `priceMap` 以 `${supplier_id}\|${product_id}` 为键，遍历**无确定性排序、后者覆盖前者** → 同一 (supplier, product) 存在多条 `is_current=1` 时**补价可能取到错误单价并直接写进账单金额**。另 `:1120` `limit(100)` 对 20 个 product 分块，供应商多时可能截断 | 价格管理侧允许同一 (供应商,商品) 有多条当前有效价 |
| D-10 | 中 | `:1051-1086`、`:1168-1335`；`report_id` 固定后缀 `:440/:481`（`_A`）、`:1225/:1252/:1285/:1312`（`_RG`） | **两个报表补生成 action 不幂等**：`report_id` 固定后缀不唯一、无唯一索引、无去重；`regenerateReceiptReports` 还不把旧记录标 `superseded`（对照 `regenerateApprovedOrderReports:423-425` 标了）。注释 `:1097` 自称「幂等」与实际不符 → 可刷爆 `report_file` 表与云存储配额（`settleReceipt` 有 CAS 锁，这两个没有） | 任意 GLOBAL 角色重复调用（无 UI 限制）；`regenerateOrderReports` **全项目无前端调用方**，是仍对外开放的写接口（死入口） |
| D-11 | 中 | `:1523-1541` | **催审消息写失败仍返回成功**：`.catch` 回调内的 `return {code:-1, msg:'催办消息发送失败，请稍后重试'}` 只作为 Promise 结果被 `await` 丢弃，函数继续执行 `:1541 return {code:0}` → 前端显示「已催办」但催审消息实际未写入。限频标记已正确回退（`:1533-1536`），但用户不会重试 | 消息写入瞬时失败（网络/云抖动） |
| D-12 | 中 | `:1447`（允许 `partial_received`）vs `cancelOrder:1357`（禁止） | **申请取消的状态集与执行作废的状态集不一致** → `partial_received` 的取消申请**永远无法闭环**（管理员点确认必被拒），且申请已写入 `cancel_requested=true` 并发了通知 | 采购员对一张部分收货的单提交取消申请 → 管理员确认 → 「该订单已有收货记录，不能作废」 |
| D-13 | 中 | `:1420-1427` | `cancelOrder` 的 `createMessage` **无 try/catch**：事务已提交（订单已作废），消息写失败时顶层返回通用错误 → 用户误判作废失败而重试 → 「当前状态的订单不可作废」。口径与 `auditOrder:592-603` 不一致 | 消息写入瞬时失败 |
| D-14 | 中 | `:504-507` | 自审保护被 `order.created_by &&` 短路保护：历史数据 `created_by` 为空/缺失时，**下单人可审核自己的单** | 订单 `created_by` 为空 |
| D-15 | 低 | `:1450-1453` | 门店归属校验是**死代码**：`:1435` `requireUser(event, GLOBAL_ROLES)` 已拦掉所有非全局角色，`!GLOBAL_ROLES.includes(auth.user.role)` 恒为 false | 永不触发；且会误导维护者以为该 action 对门店角色开放 |
| D-16 | 低 | `:1513-1516` | **全项目唯一一处用 `$or` 对象键**（其余 4 处均用 `_.or()`：`:228/:649/:659/:932`），与全仓风格不一致。若 SDK 不支持该写法则条件查询永不命中 → `updated===0` → **首次催审直接返回「已催办过，请 1 小时后再试」**。功能实测可用则说明 SDK 支持，但仍建议统一写法以消除可移植性风险 | 首次对某单催审 |
| D-17 | 低（**待确认**） | `:412`（`supplier_confirmations: _.set({})`）vs `cancelOrder:1389`（`supplier_confirmations: {}`） | 同一字段两种写法。**语义取决于 wx-server-sdk `_.set` 的底层映射**：若为 MongoDB `$set`（总是覆盖）则改量审核会正确清空确认；若为文档描述的「已存在则不变」，则 `:409` 的前置条件已保证字段存在且非空 → `_.set({})` **永远是空操作** → 改量后供应商确认状态不被重置（供应商门户仍显示「已确认接单」而报表已按新数量重发）。当前环境无法安装依赖验证（目录无 `node_modules`，网络不可达），**待确认**，建议统一用裸 `{}` 消除歧义 | 审核改量某张已有供应商确认的单 |
| D-18 | 低 | `:609`（`approvedQty >= 0`）vs `:534`（`qty <= 0` 拒绝）；`:523-525` | 两个字面条件在此处等价（`>0` 已保证），但不一致易误改。另：`event.items` 传空数组时 `qtyChanged=false` 且**不改任何明细数量** → 等于「按原下单量全额批准」，可能掩盖前端漏传 items | 前端误传 `items: []` |
| D-19 | 低 | `:515-518` 读、`:551` 遍历 | 事务内用的是事务**外**读的 `itemResult.data` 快照，并发删除明细时 `transaction.collection().doc().update()` 会抛错回滚整单 | 审核过程中明细被并发修改 |
| D-20 | 低 | `:732`（仅排除 chef）、`:735` | supplier 落入 `query.store_id = ''` 分支 → 恰好查不到数据，**安全靠巧合而非显式拒绝**（异常记录 `store_id` 恒为真值） | supplier 角色调 `getAbnormalRecords` |
| D-21 | 低 | `:876-886` | 首页统计不计入 `rejected`、`receipt_abnormal`、`to_verify`（虚拟筛）→ 驳回单与异常单在任何卡片都不可见。**已确认设计如此**（`purchase-detail.js:78-79`、`:319-323` 提供「驳回单复制为新草稿」的 B7 出口），非死态 | — |
| D-22 | 低 | `:201`（`read` 恒 false）、`:684-691`、`:704-710` | `read` 布尔**全项目无人写 true**，是死字段；`read_by` 无上限无裁剪、`read_at` 被并发覆盖、`message` 无 TTL/归档 → 集合单调增长 | 长期运行 |
| D-23 | 低 | `:146-153`、`:94-117` | `supplierName`/`contactName`/`contactPhone`/`remark`/`spec` **均无长度上限、无格式校验**；`saveProduct` 无商品名查重；主数据写入无 `updated_by` 审计字段（改价/改供应商只能靠 `updated_at` 反推） | 直接调云函数或绕过前端 |
| D-24 | 低 | `:310-313`、`:259` | `where(_.in(supplierIds)).limit(100)` 可能截断供应商名；`getSupplierUsers` `limit(20)` 后**串行** `await` 订阅消息，量大时逼近超时。（当前 `SUBSCRIBE_TEMPLATE_ID=''`，`:270` 直接 return，实际不发） | 单单供应商数 > 100 或账号数接近 20 |
| D-25 | 低 | `:953-956`（解析约定）vs `seed-data/abnormal_record.json` | **seed 契约漂移**：seed 的 `abnormal_id:"ABN20260805001"` 是单段格式，违反 `{receiptId}_{行序号}_{type}`（`createReceipt:535`）。该记录**永远无法解锁任何 `receipt_item`** → 对 `RCP20260805001` 做补结算必得「没有因异常处理解锁的明细行」 | 用 seed 数据跑补结算回归测试 |
| D-26 | 低 | `:1385-1394` | 作废后 `cancel_requested`/`cancel_requested_at`/`cancel_request_reason`/`cancel_requested_by` 残留不清（无消费方，影响小） | — |
| D-27 | 低 | `:190-204` | `createMessage` 的 `type`/`title`/`content` 无长度校验；`data.storeId \|\| ''` 缺省为空 → **忘传 storeId 即全员广播**（当前 8 处调用点都传了，属隐患） | 后续新增调用点忘传 `storeId` |
| D-28 | 低 | `:913-916`、`:947-950`、`:970-973` | 多处 `limit(100/1000)` 硬编码，异常数/明细数超限会静默截断（含 `openAbnormal` 可能漏判 → 在尚有未处理异常时放行补结算） | 单收货单异常/明细数超限 |
| D-29 | 低 | `:17-43` | `getSessionUser` 与 authService 版存在语义差异（见 A-9），两文件及全仓共 19 份副本 | 见 A-9 |

### 2.8 正面结论（已做对，避免下一轮重复怀疑）

- **CSV 公式注入防护** `csvField:350-355`：`=+-@` 开头加单引号、双引号转义、`0xFEFF` BOM 头；文件名路径清理 `safePathPart:357-359`。
- **`getNextVersion:361-387`** CAS 取号：读旧值 → 条件更新（`count` 仍等于旧值才写旧值+1）→ 5 次重试，末次带真实错误原因，正确避开了 `_.inc` 后回读的并发碰撞。
- **`auditOrder` / `cancelOrder`** 事务内复查状态 + `rollback({code,msg})` 自定义信息回传 + `auditOrder:583-590` 事务后二次复查（处理事务提交与副作用之间的窗口，避免向已作废单刷报表/花钱群发）。
- **`cancelOrder:1401-1406`** 正确处理 SDK「事务内 `where().update()` 不携带 transactionId」的限制，改为 `where().get()` + 逐条 `doc().update()`。
- **`verifyManualOrder`** 权限两段（提交含 store_manager、裁决限 GLOBAL）+ 凭证 ≤9 张 + fileID 前缀校验（`:1557-1562`）+ 只删本订单目录内被替换的旧文件（`:1600-1610`）+ 三处 CAS 防并发重提/重复裁决 + 驳回原因单独存 `verify_reject_note` 不被重传覆盖。
- **`settleReceipt:932-940`** 带 10 分钟过期自愈的 CAS 并发锁 + `finally` 必释放。
- **`remindAudit`** 1h 限频 + CAS 兜底 + 失败回滚标记（返回码有 D-11 缺陷，但回滚逻辑正确）。
- **`markMessageRead`** 按用户已读（不污染同门店其他人的未读态）+ 归属校验；读端对旧数据 `read_by` 缺失做了 `Array.isArray` 兼容。
- **金额口径**：全程先乘 100 再 `Math.round` 后除 100，逐行累加再取整，无一分钱尾差（`:1014-1015`、`:1243-1244`、`:1303-1304`）。
- **无 Excel/CSV 导入逻辑**（只有导出），导入侧注入风险不适用。
- **零硬删除**：全文件内数据库记录只做软删/状态翻转；唯一真删除是云存储凭证图，且仅限本订单前缀内被替换的文件。

---

## 3. package.json（两个，各 9 行）

| 项 | authService | dataService |
|---|---|---|
| name | `authService` | `dataService` |
| version | `1.0.0` | `1.0.0` |
| description | 数据库登录、会话、门店与用户管理 | CloudBase 分类、主数据、审批、消息与异常服务 |
| main | `index.js` | `index.js` |
| dependencies | `wx-server-sdk: ~2.6.3` | `wx-server-sdk: ~2.6.3` |

两者一致，均无 `scripts`/`devDependencies`/`engines`，均无第三方库。`~2.6.3` 与全仓 19 个云函数统一（旧报告结论**仍然成立**）。

---

## 4. 目录结构确认

Glob 结果：`cloudfunctions/authService/` = `{index.js, package.json}`；`cloudfunctions/dataService/` = `{index.js, package.json}`。**均无 `config.json`、无 `config.index.js`、无 `node_modules`、无 `index.html` 或其他入口文件**。即：无独立超时/内存配置层（超时走云控制台默认值）、无公共模块，会话/CSV/版本号/字典全部在两个文件内各自复制。

---

## 5. 与旧报告不一致之处

| # | 旧结论 | 本轮复核 |
|---|---|---|
| 1 | **INDEX.md 把 `pending_approval`、`report_generated`、`to_receive` 列为「4 个死状态」，并称 `to_receive` 是「陷阱态」（既不在 createReceipt 可收货集合、也不在 cancelOrder 可作废集合，落入即永久卡死）** | **旧报告判断有误（至少部分）**。这三个状态都有活跃读取方：`pending_approval` → `auditOrder:508/547`；`report_generated` → `cancelOrder:1360/1381`、`getOrderStats:876`、`getPurchaseOrders:74/94`、`confirmSupplierOrder`；`to_receive` → `confirmSupplierOrder` 的 `CONFIRMABLE_ORDER_STATUS`/`SHIPPABLE_ORDER_STATUS`、`updateProductPrice:43` 的 `INFLIGHT_ORDER_STATUS`、`authService:642`。真正的事实是它们**没有任何写入方**（这才是"死状态"的成因），但把「读得到」和「死」混为一谈会误导清理动作。`to_receive` 作为「陷阱态」的说法不成立——它在 `confirmSupplierOrder` 里是**唯一**额外的可确认/发货入口 |
| 2 | **报告 01 R18：「门店/用户名查重缺归一化，含 `createUser:357-361`」** | **旧报告判断有误（用户名部分）**。`validateUserInput:134` 已执行 `normalizeUsername`（小写 + trim），`createUser:357` 与 `updateUser:404` 用的都是归一化后的 `input.username`，用户名查重**是归一化过的**。仅 `store_name` 查重（`:520-532`、`:595-612`）确实只做 `trim()` |
| 3 | **报告 01 R3：`getSessionUser` 复制 19 份，authService 那份 legacy 分支语义与其余 18 份不同** | **仍然成立**，且本轮独立验证了 `dataService:17-43` 属「严格版」（要求 token 在 `sessions` 内）。补充一个旧报告没有的事实：**当前没有任何写入路径能构造出分歧态**（login 恒同步两字段），故这是潜伏点而非现存漏洞 |
| 4 | **报告 01 R1（停用→再启用复活旧会话）、R2（`updateUser` 无自我保护/最后超管保护）** | **均仍然成立**，行号一致。但本轮发现**更严重的同源根因 A-1**：「最后一名超管」保护被错误地限定在 `username === 'admin'`，旧报告未覆盖 |
| 5 | **报告 01 R18 之外的 R4-R17**（用户枚举、`changePassword` 无爆破限制、`listUsers` limit 100、`password_iterations` 信任库值、openid 覆盖、`logout` 恒 code:0、`mobile` 无校验等） | **均仍然成立**，逐一复验通过 |
| 6 | **报告 02 的 R1（`settleReceipt` 幂等粒度）、R2（`resolveAbnormal` 无 try/catch）、R3（`getMessages` 跨门店泄露）、R4（`repriceReceipt` 失败堵死）、R5（消息无分页）、R6（toggle 无空参校验）、R7（报表不幂等）、R8（markAllMessagesRead 串行）、R10（requestCancel 死代码）、R11（价格键碰撞）、R12（message 增长）、R13（getCategories limit）、R15（supplier 巧合安全）、R20（供应商停用无检查）** | **均仍然成立**。当前文件 1681 行 vs 旧报告 1678 行，**行号有 ±2 行整体偏移**（旧报告 :916-923 → 现 :921-927；旧 :650-661 → 现 :649-666 等），内容未变 |
| 7 | **INDEX.md M6 声称「CAS versioning」「idempotency hardening」** | **仍然成立**：version 只落在 `report_version_counter`（`purchase_order`/`purchase_order_item` 无 `version` 字段）；幂等集中在 `settleReceipt`/`requestCancel`/`remindAudit`/`verifyManualOrder` 四处 CAS，`regenerate*Reports`/`repriceReceipt`/`resolveAbnormal` 完全无幂等 |
| 8 | 旧报告**未覆盖、本轮新增** | **A-1**（最后超管保护范围错，高）、**A-4**（并发登录丢会话，中）、**A-5**（supplier 可列全部门店，中）、**A-6**（停用门店锁死账号，中）、**A-14**（`doc().get()` 抛错致 4 处判空为死代码，低）、**D-2**（异常关闭后永久无法补结算，高）、**D-7**（停用供应商锁死账号，中）、**D-11**（催审失败仍报成功，中）、**D-12**（`partial_received` 申请取消死锁，中）、**D-13**（cancelOrder 消息无降级，中）、**D-14**（`created_by` 为空则自审保护失效，中）、**D-16**（全仓唯一 `$or` 写法，低）、**D-17**（`_.set({})` 语义歧义，待确认）、**D-25**（seed 异常 id 违反解析约定，低） |

---

## 6. 问题清单（合并，按级别排序）

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| **高** | `authService:479-494` + `:393-440` | 最后一名超管保护被限定在 `username === 'admin'`；`updateUser` 无在岗超管检查 → 在岗超管数可归零，管理入口永久锁死 | 停用 admin（另一超管在岗，允许）→ 再停用非 admin 超管（跳过 guard） |
| **高** | `authService:393-440` | `updateUser` 无「禁止操作自己」、无「最后一名超管」保护 | 非 admin 超管把自己降权 |
| **高** | `authService:499-504` / 校验 `:109-112` / 注释 `:470-472` | 停用未清 `sessions` 数组，而校验查的正是它 → 停用→再启用复活旧会话（注释自称已防，实际未防） | 停用 → 7 天内重新启用，旧设备 token 立即复活 |
| **高** | `dataService:921-927` + `:960-962` + `:1004-1033` | `_S` 幂等用 `some()`，粒度是「任一份」而非「全部供应商齐」→ 中途失败后其余供应商补充账单永久缺失，且 `payable_flag` 已置 true | 供应商 A 成功、B 失败 → 重试被幂等挡住 |
| **高** | `dataService:946` | 排除 `status='closed'` → 异常用 `pay_received` 解决后一旦关闭就永久无法补结算，状态不可回退 | resolve(pay_received) → 关闭异常 → 补结算报「无需补结算」 |
| 中 | `dataService:800-830` | 先置 `resolved` 再发 2 条消息且**无 try/catch** → 消息失败抛顶层错误、状态不可逆、重试被拒，「待补结算提醒」丢失 | 消息写入瞬时失败 |
| 中 | `dataService:649-666` | 非全局角色查询缺 `scope_type` 过滤 → 供应商定向消息对 chef 全员可见（含他人门店名/采购单号），与 `:656` 注释相悖 | 任意 store_manager/chef 打开消息中心 |
| 中 | `dataService:666` + `:704-710` | 消息 `.limit(100)` 无分页 → 尾部消息永不可达、未读角标恒亮；markAllMessagesRead 最多 200 次串行往返 | 累计消息 > 100 |
| 中 | `dataService:135`、`:179` | toggle 无空参校验 → `where` 为空命中第一条，静默误停用无关商品/供应商 | 参数为空时调用 |
| 中 | `authService:213-216` + `:230` | 并发登录同一账号会随机丢失会话（整数组覆盖写） | 两设备同时登录 / 双击登录 |
| 中 | `authService:322` | `getStores` 未排除 supplier → 供货商可枚举全部门店档案 | supplier 调用 getStores |
| 中 | `authService:622-655`（连锁 `:77-79`/`:93-96`/`:207`） | 停用门店连带锁死该门店全部账号登录，仅有「在途采购单」一道阻断 | 停用仍有在岗账号的门店 |
| 中 | `dataService:176-185`（连锁 `authService:203-204`）+ `:1118-1122` | 停用供应商零前置检查、立即锁死该供应商账号登录，且补价不按 `supplier.status` 过滤 | 停用仍有订单的供应商 |
| 中 | `dataService:1130-1132` → `:1156` | 补价不可逆 + 报表失败 → 重试时缺价行已空 → 本入口永久无法重出账单 | 补价过程中云存储抖动 |
| 中 | `dataService:1114-1122` | 价格键碰撞且遍历无排序 → 补价可能取错单价并写入账单 | 同一 (供应商,商品) 多条 `is_current=1` |
| 中 | `dataService:1051-1086`、`:1168-1335` | 两个报表补生成 action 不幂等、`report_id` 固定后缀不唯一、收货类不标 superseded；注释自称幂等与实际不符；`regenerateOrderReports` 为死入口 | GLOBAL 角色重复调用 |
| 中 | `dataService:1523-1541` | `.catch` 里的 `return {code:-1}` 被 `await` 丢弃，消息写失败仍返回 `code:0` → 前端显示「已催办」但消息未写入 | 消息写入瞬时失败 |
| 中 | `dataService:1447` vs `cancelOrder:1357` | 申请取消状态集含 `partial_received`，执行作废不含 → 该类申请永远无法闭环 | 对部分收货单申请取消 |
| 中 | `dataService:1420-1427` | `cancelOrder` 的 createMessage 无 try/catch → 订单已作废但返回通用错误 | 消息写入瞬时失败 |
| 中 | `dataService:504-507` | 自审保护被 `order.created_by &&` 短路 → `created_by` 为空的历史单可自审 | 历史数据 `created_by` 缺失 |
| 中 | `authService:344-348` | `listUsers` `.limit(100)` 无分页 → 账号 > 100 时超出部分前端不可见 | 账号数 > 100 |
| 中 | `authService:40` + `:32` | `password_iterations` 信任库值无下限（仅挡住 0/falsy） | 库内被写入低迭代数 |
| 中 | `authService:106-131` vs `dataService:17-43` 等 19 份 | 会话校验复制 19 份且语义分裂（本文件 legacy 分支不要求 token 在 `sessions` 内）；当前无路径可触发，属潜伏点 | 将来任一"只清一个字段"的改动 |
| 中 | `authService:174/:171/:194` | 用户枚举：短路不跑 PBKDF2（时序可区分）+ 泄露锁定剩余分钟 + 单独提示停用；无 per-openid 频控 | 固定密码扫用户名 |
| 中 | `authService:288-312` | `changePassword` 无失败次数限制 → 持有效 token 可无限爆破当前密码 | 反复提交 changePassword |
| 中 | `authService:642` | `ACTIVE_ORDER_STATUS` 未含 `receipt_abnormal` → 有未处理异常收货单的门店可直接停用 | 门店有 `receipt_abnormal` 订单 |
| 中 | `authService:484-493` vs 前端硬编码 | 后端允许停用 `admin`（有另一名超管时），前端提示「不可停用」→ 口径冲突 | 按前端提示行动 |
| 低 | `authService:398-400/:438/:451-453/:481-483` | `doc().get()` 对不存在的文档抛错（同仓 `getCounter` 全部 `.catch(()=>null)` 即为证据）→ 4 处「用户不存在」判空是死代码，前端得到通用文案 | 传不存在的 id |
| 低 | `authService:641` | `const _ = db.command` 遮蔽模块级 `_` | 维护时误改 |
| 低 | `authService:269-286` | logout 清空会话字段会使所有 legacy 设备失效（与注释「仅当前设备」不符）；无效 token 也返回 `code:0` | legacy 多设备 |
| 低 | `authService:543-547` | 序号候选 `.limit(1000)`，注释称「全量遍历」实际有上限 | 门店 > 1000 |
| 低 | `authService:520-532`、`:595-612` | `store_name` 查重只做 trim，未归一化全角空格/大小写 | 手工创建视觉重复门店 |
| 低 | `authService:217-229` | `openid` 每次登录覆盖 → 同微信号多账号推送可能错投 | 同微信号先后登两个业务身份 |
| 低 | `authService:376/:421`、`:144/:295/:449`、`:195` | `mobile` 无格式校验；密码仅 ≥6 位无复杂度；`expectedRole` 省略即绕过角色入口互斥（action 仍拦截，非越权） | — |
| 低 | `dataService:1450-1453` | `requestCancel` 门店归属校验是死代码（`requireUser(GLOBAL_ROLES)` 已拦掉） | 永不触发 |
| 低 | `dataService:1513-1516` | 全仓唯一 `$or` 对象键写法（其余 4 处用 `_.or()`）→ 若 SDK 不支持则首次催审直接返回「已催办过」；建议统一写法 | 首次催审 |
| 低（待确认） | `dataService:412` vs `cancelOrder:1389` | 同字段两种写法；若 `_.set` 语义为「已存在则不变」，则改量后供应商确认状态**永远不被重置**。当前无法安装依赖验证 | 审核改量已有确认记录的单 |
| 低 | `dataService:609` vs `:534`、`:523-525` | `qtyChanged` 用 `>=0` 与校验的 `<=0` 字面不一致；`items:[]` 等于按原量全额批准，可能掩盖前端漏传 | 前端误传空 items |
| 低 | `dataService:515-518` → `:551` | 事务内使用事务外读的快照，并发删明细会回滚整单 | 并发修改 |
| 低 | `dataService:732`、`:735` | supplier 靠「查不到数据」巧合安全，而非显式 `-403` | supplier 调 getAbnormalRecords |
| 低 | `dataService:876-886` | 首页不计 `rejected`/`receipt_abnormal`（已确认设计如此，B7 提供复制为新草稿的出口） | — |
| 低 | `dataService:201`、`:684-691`、`:704-710` | `read` 是死字段（恒 false）；`read_by` 无裁剪；message 无 TTL → 集合单调增长 | 长期运行 |
| 低 | `dataService:146-153`、`:94-117` | 主数据字段无长度/格式校验；商品无名称查重；无 `updated_by` 审计字段 | 绕过前端直调 |
| 低 | `dataService:310-313`、`:259` | 供应商名/账号查询 `limit(100)`/`limit(20)` + 串行推送，量大逼近超时 | 供应商数 > 100 |
| 低 | `dataService:953-956` vs `seed-data/abnormal_record.json` | seed 的 `abnormal_id` 单段格式违反 `{receiptId}_{行序号}_{type}` 约定 → 该记录永远无法解锁，阻塞补结算回归测试 | 用 seed 数据跑补结算 |
| 低 | `dataService:1385-1394` | 作废后 `cancel_requested*` 残留不清 | — |
| 低 | `dataService:190-204` | `createMessage` 内容无长度校验；`storeId` 缺省为 `''` → 忘传即全员广播 | 新增调用点忘传 |
| 低 | `dataService:913-916/:947-950/:970-973` | 多处 `limit` 硬编码，超限静默截断（含 `openAbnormal` 可能漏判） | 异常/明细数超限 |

---

## 7. 待确认清单

1. **`_.set` 语义**（D-17）：需在装好依赖的环境验证 `_.set({})` 是否覆盖已存在字段。这是「改量审核是否真的重置供应商确认」的唯一决定因素，建议直接改成 `cancelOrder:1389` 的裸 `{}` 写法消除歧义。
2. **`$or` 对象键**（D-16）：需实测或查 SDK 文档确认。若不支持，`remindAudit` 完全不可用。
3. **数据库索引**：`app_user.username`、`app_user.sessions.token_hash`、`app_user.session_token_hash`、`report_file.report_id` 是否建了唯一索引（决定 A-14/D-10 是「并发穿透」还是「直接写失败」）。
4. **`supplier_product_price` 是否保证 `(supplier_id, product_id)` 在 `is_current=1` 下唯一**（决定 D-9 是否可实际发生）。
5. **云函数超时配置**：`markAllMessagesRead` 200 次串行往返、`settleReceipt`/`regenerateReceiptReports` 多份 CSV 上传、`notifySuppliersNewOrder` 最多 20 次串行推送是否在默认时限内。
6. **业务口径**：停用门店/供应商连带锁死账号登录是否可接受（A-6/D-7）；`receipt_abnormal` 是否应阻断门店停用（A-12）；异常关闭后是否应保留补结算能力（D-2）；供应商停用后是否应阻断补价（D-7）。
7. **`getCategories`/`getMessages`/`listUsers` 的分页**：账号、消息、分类三处 `limit(100)` 是否需支持翻页（决定 D-5/A-7 的产品取舍）。
8. **`seed-data/abnormal_record.json` 的 `abnormal_id`** 是否应改造成 `{receiptId}_{行序号}_{type}` 格式以支持补结算回归测试（D-25）。
