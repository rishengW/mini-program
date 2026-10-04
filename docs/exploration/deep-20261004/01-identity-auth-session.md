# 深度探索 01：身份 / 权限 / 会话域

> 日期：2026-10-04　作者：探索代理 01　分支：backup（只读，未改任何源码）
> 范围：`cloudfunctions/authService/`（index.js 684 行 + package.json）、`utils/`（cloud.js 282 / auth-guard.js 16 / meta.js 67 / util.js 127）、`app.js`（124）、`pages/login|account|store-switch|user-manage` 各 4 文件全读。
> 交叉验证（只读抽查，用于回答"跨门店泄露"与"会话校验一致性"两个问题）：`getSuppliers/index.js`、`getPurchaseOrders/index.js`、`createPurchaseOrder/index.js`（各 getSessionUser + 角色作用域段）、`getReportDetail|importProducts|updateProductPrice|createReceipt|dataService` 的 getSessionUser 全文 diff、`pages/index/index.js`、`seed-data/app_user.json`、`app.json`。
> 所有结论均带 `文件:行号`；未读到/无法从代码判定的写「待确认」。

---

## 1. 概览

本域是一个「自建账号表 + 自签随机 token」体系，不走微信登录态。核心事实：

- **身份来源**：`app_user` 集合，用户名+密码登录；`openid` 只是登录时顺手记录（`cloudfunctions/authService/index.js:218-229`），**不参与鉴权**，仅注释说明用于订阅消息推送。
- **会话模型**：PBKDF2-SHA256/120000 迭代哈希（`:11-12, :28-43`）；token = `crypto.randomBytes(32).toString('hex')`（`:210`），存库时只存 SHA-256(token)（`:45-47, :215, :221`）；TTL = 7 天（`:13`）；**每账号最多 5 条会话**（`:212-216`）。
- **兼容双写**：每次登录同时写 `sessions` 数组（多设备）与 `session_token_hash`/`session_expires_at`（旧单会话字段）（`:219-223`），读取时先查数组再降级查旧字段（`:106-131`）。
- **鉴权入口唯一**：19 个云函数全部自行复制一份 `getSessionUser(authToken)` 并在 main 里调用（已逐个确认，无绕过）。`authService` 内部 14 个 action 里，需登录的 13 个全部调用 `getSessionUser` 或 `requireSuperAdmin`（`:334-339`），无遗漏。
- **前端只有一层守卫**：`utils/auth-guard.js:5-14` 的 `requireLogin()` 只判 `globalData.isLoggedIn && authToken`；`utils/cloud.js:49-76` 自动附带 token 并对 `-401` 统一清会话跳登录（`:34-47`）。**前端不做角色判断，一切权限靠云函数裁决**——这是正确的设计取向，但也意味着前端"入口可见性"与后端权限是两套独立逻辑（见风险 R7/R8）。
- **本次最重要的两个发现**：
  1. **停用→再启用会复活旧会话**（注释声称已防住，实际没防住）：`setUserStatus` 停用只清 `session_token_hash`/`session_expires_at`，**没清 `sessions` 数组**（`:499-504`），而会话校验恰好查 `sessions`（`:109-110`）。
  2. **`updateUser` 是唯一一个既没有"禁止操作自己"、也没有"最后一个超管"保护的管理动作**（`:393-440`），对比 `resetPassword:446`、`setUserStatus:479, :484-493` 都有保护。

---

## 2. 身份与角色数据模型

### 2.1 角色枚举

`ROLE_LABELS`（`authService/index.js:14-20`）共 5 个角色：

| role | role_label | 是否绑门店 | 是否绑供货商 | 作用域语义 |
|---|---|---|---|---|
| `chef` | 门店下单人员 | 必须（`:147-149`） | — | 只看本店**自己创建**的订单 |
| `store_manager` | 店长 | 必须（`:147-149`） | — | 看本店全部 |
| `purchaser` | 管理员 | 否 | — | 全局（跨门店） |
| `super_admin` | 超级管理员 | 否 | — | 全局 + 账号/门店/供货商档案管理 |
| `supplier` | 供货商 | 否 | 必须（`:150-152`） | 只认 `default_supplier_id` |

`STORE_ROLES = ['chef','store_manager']`（`:21`）是**硬编码常量，在 5 处重复字面量**（`:21, :96, :147, :196`（间接）, `:322`），任何新增"绑门店角色"都要改多处——见风险 R16。

### 2.2 `app_user` 字段（由 `createUser:371-388` 与 seed 数据反推）

| 字段 | 写入点 | 说明 |
|---|---|---|
| `_id` | 自动生成 | 云数据库 doc id，`updateUser`/`resetPassword`/`setUserStatus` 均用它当 `id` |
| `user_id` | `createUser:370, :373` | `'U'+Date.now()+random(3)`，业务侧主键；`chef` 订单作用域用它（`getPurchaseOrders/index.js:55`） |
| `username` | `:374` | `normalizeUsername` 强制小写+trim，正则 `^[a-z0-9_.-]{3,32}$`（`:24-26, :139-141`） |
| `name` / `mobile` | `:375-376` | `mobile` 只 trim，**无格式校验** |
| `role` / `role_label` | `:377-378` | label 由服务端按 `ROLE_LABELS` 重算，不信任前端传入 |
| `default_store_id` | `:379` | 非门店角色写 `''`（不是 null） |
| `default_supplier_id` | `:380` | 非供货商角色写 `''` |
| `status` | `:381` | `1` 正常 / `0` 停用；`publicUser` 缺省按 1 处理（`:60`） |
| `password_salt` / `password_hash` / `password_iterations` | `:382-384` | 16 字节随机盐、hex 输出、固定 120000 |
| `sessions` | 登录时 `:213-216` | 数组，元素 `{token_hash, expires_at}`，最多 5 条 |
| `session_token_hash` / `session_expires_at` | `:220-222` | 旧字段兼容，指向**最新**一次登录 |
| `login_fail_count` / `login_locked_until` | `:177-190` | 5 次失败锁 10 分钟，per-user |
| `openid` / `last_login_at` | `:229, :226` | openid 后登录者覆盖 |
| `created_at` / `updated_at` | `:385-386` | serverDate |

### 2.3 密码与轮换机制

- **哈希**：`crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')` → hex（`:28-36`）。校验用 `crypto.timingSafeEqual` 并先比对长度（`:38-43`）——实现正确。
- **初始密码**：`seed-data/app_user.json` 5 条记录全部带 `password_salt`/`password_hash`/`password_iterations:120000`（该文件 5 行），即"初始密码"以已哈希形式随种子数据分发。历史提交"rotate initial passwords"的意图是轮换这批种子密码；**生产库是否已轮换无法从代码判定 → 待确认**。
- **轮换入口有 3 条**，行为不完全一致：
  - `changePassword`（本人改密，`:288-312`）：需旧密码，清 **全部** `sessions`（`:305`）。
  - `resetPassword`（超管重置他人，`:442-468`）：禁操作自己（`:446`），清全部 `sessions`（`:461`）。
  - `updateUser` 带 `password` 时（`:428-436`）：清全部 `sessions`（`:433-435`），但**允许操作自己**（无 `id === auth.user._id` 判断）。
- **迭代次数信任链有缺口**：`verifyPassword` 直接用 `user.password_iterations`（`:40`），无下限校验。三个写入点都写 120000，但**数据库被直改后，低迭代数会被照样信任** → 见风险 R9。

---

## 3. 鉴权链路时序

### 3.1 冷启动（`app.js`）

1. `onLaunch` → `initCloud()`（`:98-113`，失败置 `cloudReady=false` 但**不阻断**后续逻辑）→ 隐私监听 → 读本地 `userInfo`/`authToken`/`sessionExpiresAt`。
2. 本地判有效（`:21`，含 iOS 日期格式兼容 `:13-20`）→ 置 `globalData.isLoggedIn=true`，供货商额外恢复 `supplierInfo`（`:27-29`）。
3. **异步** `validateSessionOnLaunch`（`:48-70`）：`authService validate` 成功则用服务端返回刷新本地用户信息与过期时间（`:55-63`）；失败走 `clearSession()`（`:73-82`）；**网络异常静默保留本地登录态**（`:67-69`），由后续请求的 `-401` 兜底。

结论：`globalData.isLoggedIn` 是"乐观态"，与服务端真实会话存在时间窗（首屏到 validate 返回之间）。窗口内的请求若服务端已失效，返回 `-401` 由 `utils/cloud.js:68-70` 统一处理。这个设计是自洽的。

### 3.2 登录（`login.js` → `authService login`）

```
login.js:47-71  callFunction('authService', {action:'login', username, password, expectedRole})
  → authService:156-247
     ① 查 username（:161-164，不带 status）
     ② 锁定期检查（:167-173）→ 命中直接拒
     ③ verifyPassword 失败 → 原子 inc fail_count（:177-179）+ 条件锁（:182-190，`_.gte(5)` 防并发顺延）→ 拒
     ④ status!==1 → 拒（:194）
     ⑤ expectedRole 不匹配 → 拒（:195-197）
     ⑥ supplier：findSupplier 校验（:202-204）；否则 getDefaultStore（:205-208）
     ⑦ 生成 token + 追加 session（上限 5，挤出最旧，:210-216）
     ⑧ 记录 openid（:218-229）+ 原子写回（:230）
     ⑨ 返回 {user, store, supplier, sessionToken, sessionExpiresAt}（:232-246）
  → login.js:73-103 写 globalData + storage（去掉 account_history，:86）
     supplier → supplier-home；其他 → switchTab index
```

关键点：`expectedRole` 由前端 `isSuperAdminLogin ? 'super_admin' : selectedRole` 决定（`login.js:56`），服务端强制校验（`:195-197`）——**超管账号走普通角色入口会被拒，chef 走超管入口也会被拒**，角色隔离在登录时就成立。

### 3.3 普通请求

`utils/cloud.js:49-76`：`ensureCloudReady()` → 合并 data → **自动注入 `authToken`**（`:56-64`，优先页面显式传入）→ `wx.cloud.callFunction` → `code === -401` 触发 `handleSessionExpired()`（`:34-47`，1.5s 防抖 + 清会话 + toast + 0.6s 后 reLaunch）。

### 3.4 会话校验（`getSessionUser`，`authService:106-131`）

1. 空 token → null。
2. `where({ status: 1, sessions: { token_hash: hash } })`（`:109-112`）——**`status:1` 是硬性前置，停用账号的既有会话立即失效**（回答重点问题 5：停用后不能调用，成立）。
3. 命中则从数组里找该 session 并校验 `expires_at`（`:126-130`）。
4. 未命中则降级查 `session_token_hash`（`:115-124`），同样校验过期。
5. 注意步骤 4 **不要求该 token 存在于 `sessions` 数组中**（其他 18 份副本要求）→ 见风险 R3。

---

## 4. 每个云函数动作的权限矩阵

| # | action | 鉴权 | 关键入参 | 读 | 写 | 越权面评估 |
|---|---|---|---|---|---|---|
| 1 | `login` | 无（登录本身） | username,password,expectedRole? | app_user,store,supplier | app_user | 锁定机制 per-user；无 per-openid/IP 频控（R4） |
| 2 | `validate` | getSessionUser | authToken | app_user | — | 只回显 publicUser，无敏感字段泄漏 |
| 3 | `logout` | getSessionUser（可空） | authToken | app_user | app_user | 仅删当前设备会话（`:273-275`），**无效 token 也返回 code:0**（R13） |
| 4 | `changePassword` | getSessionUser | currentPassword,newPassword | app_user | app_user | 无爆破限制（R5）；清**全部**设备会话与前端文案不符（R11） |
| 5 | `getStores` | getSessionUser | includeInactive? | store | — | STORE_ROLES 只回本店（`:322-325`）；purchaser/super_admin 回全量；includeInactive 无角色限制（任何登录用户可传 1 看停用门店）— 低风险 |
| 6 | `createStore` | requireSuperAdmin | storeName,storeCode? | store | store | 序号取 max+1，3 次重试（`:543-585`）；名称查重无归一化（R18） |
| 7 | `updateStore` | requireSuperAdmin | storeId,storeName | store | store | 编号不可改（`:589` 注释 + 仅写 store_name），设计正确 |
| 8 | `setStoreStatus` | requireSuperAdmin | storeId,status | store,purchase_order | store | 停用前查在途单（`:640-649`）；`ACTIVE_ORDER_STATUS` 未含 `confirmed` → 待确认 |
| 9 | `listUsers` | requireSuperAdmin | — | app_user | — | **`.limit(100)` 无分页**（`:344-348`）→ 账号盲区（R6） |
| 10 | `createUser` | requireSuperAdmin | 全字段 | app_user,store,supplier | app_user | 查重与写入非原子（`:357-371`）；无"提权二次确认"（R7） |
| 11 | `updateUser` | requireSuperAdmin | id + 全字段 | app_user,store,supplier | app_user | **无自我保护、无最后超管保护**（R2） |
| 12 | `resetPassword` | requireSuperAdmin | id,newPassword | app_user | app_user | 有自我保护（`:446`） |
| 13 | `setUserStatus` | requireSuperAdmin | id,status | app_user | app_user | 有自我保护（`:479`）+ 最后超管保护（`:484-493`）；**但停用未清 sessions 数组**（R1） |
| 14 | `deleteUser` | 转 `setUserStatus(status:0)`（`:510-512`） | id | — | — | 软删除，继承 R1 |

`requireSuperAdmin`（`:334-339`）是唯一角色裁决函数，返回 `{error:{code:-403}}`；`utils/cloud.js` 只对 `-401` 做跳登录，`-403` 走普通 toast——行为正确。

---

## 5. 逐页面分析

### 5.1 `pages/login/`（login.js 104 行）
- 角色四选一 + 超管开关（`login.js:10-16, :38-45`）；切换角色/开关都会清空输入（`:31-35, :40-44`），避免账号密码跨角色残留。
- `onShow` 每次清空白名单据（`:19-22`），注释说明是"不公示测试账号"，同时 `login.js:86` 主动删 `account_history`。
- **遗留死代码**：`login.wxss:120-196` 保留 77 行 `history-*` 样式，wxml 已无对应节点（R15）。
- 无"记住我"、无验证码、无图形挑战；错误文案对失败/锁定/停用三种情况可区分（R4）。
- 竞态：无防重复提交。`login()` 期间按钮可连点，`showLoading` 遮罩部分缓解，但**双击可能产生两条会话**（服务端上限 5 条，最旧被挤出，不构成越权，只是多一条有效会话）。

### 5.2 `pages/account/`（account.js 71 行）
- 双重守卫：`requireLogin()` + `globalData.isLoggedIn` 再判一次（`:14-26`），重复但无害。
- 前端校验（长度 6、两次一致，`:35-39`）与服务端（`:295-297`）一致。
- 改密成功后走 `app.clearSession()`（`:58-67`）→ reLaunch 登录页。服务端已清全部设备会话（`:305`），前端文案只说"当前登录会话"（`account.wxml:26`）→ R11。
- 该页**没有任何角色限制**：任何登录用户（含 supplier/chef）都能改自己密码。合理。

### 5.3 `pages/store-switch/`（store-switch.js 44 行）
- `onLoad` 里 `requireLogin()`（`:10`）→ supplier 直接弹回供应商门户（`:13-17`）→ `getStores`（不带 includeInactive）→ 渲染列表。
- `selectStore`（`:32-42`）只改 `app.globalData.currentStore` + storage，**不调任何云函数**。
- **作用域结论（回答重点问题 4）**：
  - `chef`/`store_manager`：`getStores` 被服务端强制成只有 `default_store_id` 一家（`authService:322-325`），切换页只会显示一家，无选择余地。
  - `purchaser`/`super_admin`：可看全量并任意切换。但下游是否安全？已抽查两个代表云函数——`createPurchaseOrder/index.js:174-180` 对非全局角色**强制 `storeId = user.default_store_id` 并在传参不符时直接 403**，`:202-204` 禁止编辑草稿换门店，`:209-214` 校验目标门店存在且启用；`getPurchaseOrders/index.js:50-66` 对 chef/store_manager **按 `user.default_store_id` 强制过滤**（忽略前端传参），对全局角色才接受 `storeId` 作为筛选项（`:62`）。即：**`currentStore` 对全局角色只是"筛选器"，对非全局角色是纯展示字段，服务端从不信任**。本次未发现跨门店数据泄露。
  - 待确认：`currentStore.storeId` 是否还被其他云函数当作作用域参数信任（本次只抽查上述两个）。

### 5.4 `pages/user-manage/`（user-manage.js 251 行）
- **入口无角色前置**：`onShow` 只调 `requireLogin()`（`:26-29`）。非超管直接访问该路径会得到空列表 + toast"仅超级管理员可以管理账号"（`:51-53` 透传 `-403` 文案），不泄露数据但 UX 不一致（R7）。真正入口 `index.wxml:46` 是纯前端 `isSuperAdmin` 判断，而 `isSuperAdmin` 来自本地 `userInfo`（`index.js:112`）——**被降权/停用的账号在 validate 返回前仍能看到入口**（视觉问题，后端仍拦截）。
- `loadData`（`:31-55`）并发拉 `listUsers` + `getStores` + `getSuppliers`。注意 `getStores` 不带 `includeInactive`（正确，因为 `createUser`/`updateUser` 都用 `findStore` 的 `status:1` 校验，选停用门店会被拒）；`suppliersResult.code` 被忽略（`:41` 用三目兜底空数组），供货商拉取失败时列表静默为空。
- `saveUser`（`:180-223`）：前端校验与服务端 `validateUserInput` 口径一致；`defaultStoreId`/`defaultSupplierId` 对不适用角色传 `null`（`:203-204`），服务端非该角色写 `''`（`:379-380`），一致。
- `toggleUserStatus`（`:225-250`）：**前端硬编码 `item.username === 'admin'` 禁止停用**（`:228`），文案"默认系统超管不可停用"与后端能力冲突（后端允许停用 admin，只要求先有另一名在岗超管，`authService:484-493`）→ R8。
- 表单里 `roles` 数组**包含 `super_admin`**（`user-manage.js:19`），`wxml:83-89` 的 picker 直接可选，且**编辑自己也没有任何拦截**（wxml 无 `item.username` 相关条件）→ R2/R7。
- 无分页、无搜索（`:12-30` 全量渲染）→ 与 `listUsers` 的 `limit(100)` 叠加成 R6。

---

## 6. 风险清单（按严重度排序）

| # | 严重度 | 问题 | 证据行号 | 触发条件 | 建议 |
|---|---|---|---|---|---|
| R1 | **高** | 停用→再启用会复活旧会话：`setUserStatus` 停用只清 `session_token_hash`/`session_expires_at`，**未清 `sessions` 数组**；而会话校验查的正是 `sessions` | 写：`authService/index.js:499-504`；校验：`:109-112, :126-130`；注释自称已防（`:471-472`）；对照组 `changePassword:305` / `resetPassword:461` 都清了 `sessions: []` | 超管停用某账号 → 该账号原有设备（最多 5 台）在 7 天内仍持有有效 token → 超管启用该账号 → `getSessionUser` 立即匹配成功。典型场景：员工离职停用、账号复用给新员工启用，前员工设备仍可访问 | `setUserStatus` 在 `status===0` 时同时写 `sessions: []`（与 changePassword 对齐）；`deleteUser` 自动继承 |
| R2 | **高** | `updateUser` 既无"禁止操作自己"也无"最后一个超管"保护，可**自我降权锁死管理入口** | `authService/index.js:393-440`（无任何 `id === auth.user._id` 判断；`:417-427` 仅在 `target.username === 'admin'` 时强制回 super_admin）；对照 `resetPassword:446`、`setUserStatus:479, :484-493` 都有；`user-manage.js:15-21, wxml:83-89` picker 暴露全部 5 个角色且无自我保护 | 用户名非 `admin` 的超管（例如 `admin_user`）在账号管理页编辑自己，把角色改成 `purchaser` 保存 → 角色立即降级，前端无警告 → 系统若再无超管则彻底失去管理入口，只能直连数据库恢复 | `updateUser` 增加：① `event.id === auth.user._id` 禁止改自己的 role/username（或至少提示）；② 若目标原为 super_admin，降级/删除前要求"在岗超管数 ≥ 2"；③ 前端对"编辑自己+改角色"加二次确认 |
| R3 | **中** | 会话校验逻辑**复制 19 份**，且存在两份语义差异 | `getSessionUser` 定义 19 处（`grep "async function getSessionUser"` 全表）；18 份完全一致（如 `getSuppliers/index.js:11-37`），`authService/index.js:106-131` 的 legacy 分支**不要求 token 存在于 `sessions` 数组**，其余 18 份在 `sessions` 非空时要求（`:28-33`） | 目前潜伏：`session_token_hash` 的 token 总会同步 push 进 `sessions`（`:215, :221`）。但任何未来改动若只清其中一个字段，`authService` 会放过已被吊销的 token，其余 18 个云函数会拦——形成"认证服务认、业务服务不认"的分裂 | 抽成公共模块（如 `cloudfunctions/common/session.js` 各函数 require）或至少统一为同一份文本；同时补一条断言：清 `session_token_hash` 的地方必须同时清 `sessions` |
| R4 | **中** | 用户枚举 + 状态泄露 | ① `:174` `if (!user \|\| !verifyPassword(...))` 短路 → 用户名不存在时**完全不跑 PBKDF2**，120k 迭代时序差可远程区分；② `:194` 停用账号返回"账号已停用"；③ `:169-172` 锁定期返回"请 X 分钟后重试"（泄露锁定剩余时间）；④ 锁定是 **per-user**（`:166-191`），无 per-openid/IP 频控、无验证码 | 攻击者用固定密码扫用户名列表：由响应时序 + 三类文案可稳定枚举出存在/停用/被锁的用户 | 对所有请求恒执行一次 `verifyPassword`（对假 salt）以抹平时序；统一为"账号或密码错误"；增加 per-openid 频控 |
| R5 | **中** | `changePassword` 无失败次数限制，已登录者可对当前密码爆破 | `authService/index.js:288-312`：`verifyPassword` 失败仅 `return`，无任何计数/锁定（对照 `login:166-190` 有完整锁定） | 持有效 token 者反复提交 changePassword | 复用 `login_fail_count`/`login_locked_until` 机制到 changePassword；或限制 N 次后强制登出 |
| R6 | **中** | `listUsers` 固定 `limit(100)` 且前端无分页 → 账号盲区 | `authService/index.js:344-348`（`.limit(100).get()`）；`user-manage.js:31-55` 一次性全量渲染，无翻页 | 账号总数 > 100 时，超出部分在前端不可见：不能编辑、不能停用、不能重置密码，只能直连数据库 | `listUsers` 支持 page/pageSize；或至少返回 `total` 并在前端提示"共 N 个账号，当前显示前 100" |
| R7 | **中** | 提权路径无二次确认：新建/修改用户可直接选 `super_admin` | `user-manage.js:15-21`（roles 含 super_admin）、`user-manage.wxml:83-89`（picker 无条件暴露）、`authService/index.js:351-390`（createUser 无额外确认/口令/审批） | 账号被钓鱼或密码泄露 → 一次保存即获得永久超管，无二次验证；`createUser` 查重与写入也非原子（`:357-371`），并发可建重名账号 | 创建/提升超管时要求输入当前超管密码或二次确认弹窗；`username` 加唯一索引 |
| R8 | **中** | 前后端对 `admin` 账号口径冲突 | 前端 `user-manage.js:228` 硬编码禁止停用 `admin` 并提示"默认系统超管不可停用"；后端 `authService/index.js:484-493` 明确**允许**停用（前提是还有另一名在岗超管，`01f53fe` 提交的意图） | 管理员按前端提示认为 admin 无法停用 → 掩盖了真实能力；反之非 `admin` 的超管在前端无任何拦截，但后端会拦"最后一名超管" | 前端改为动态提示：调用后端结果而非本地硬编码；文案与后端 `:492` 对齐 |
| R9 | **中** | `password_iterations` 信任数据库值，无下限 | `authService/index.js:38-42` 用 `user.password_iterations`；常量在 `:11`；三处写入均写 120000（`:304, :384, :432`），但**无任何读取校验** | 数据库被直改/历史数据/种子数据写入低迭代数 → 服务端照旧信任，密码强度被静默降级 | `verifyPassword` 内加 `Math.max(iterations, PASSWORD_ITERATIONS)` 或迁移校验 |
| R10 | **中** | `openid` 覆盖导致订阅消息可能错投 | `authService/index.js:217-229`（注释自述"同一微信号多账号登录时以后登录者为准"）；`login()` 每次登录覆盖 `openid` | 同一微信上先登门店账号、后登供货商账号 → `openid` 变成该微信号，消息推送的 touser 指向后登录账号对应的微信，可能把 A 账号的业务消息推到同一个人（或反向往另一个业务身份推送） | 改为"用户-设备"级 openid 映射（存 openid 时带 user_id + openid 双键），推送前按账号匹配 |
| R11 | **低** | `changePassword` 清**全部**设备会话，前端文案只说"当前会话" | 服务端 `:305` `sessions: []`；前端文案 `account.wxml:26`「更新后当前登录会话会失效」 | 多设备用户改密后其他设备静默掉线，与文案不符 | 文案改为"所有设备"；或后端只清当前 token 对应会话 |
| R12 | **低** | 管理页无前端角色前置校验 | `user-manage.js:26-29` 只 `requireLogin()`；`index.wxml:46` 用本地 `isSuperAdmin`（`index.js:112`） | 非超管直接输路径可进入页面（拿到空列表 + 403 toast）；被降权账号在 validate 返回前仍看得到入口 | `requireLogin` 增加可选角色参数（`requireRole('super_admin')`），并在进入时校验 |
| R13 | **低** | `logout` 恒返回 `code:0` | `authService/index.js:269-286`（user 为 null 时也 `return {code:0}`） | 前端无法区分"真的登出"与"token 本就无效" | 无效 token 返回 `{code:-401}`，让 `utils/cloud.js` 统一清会话 |
| R14 | **低** | 密码策略仅"≥6 位"，无复杂度要求 | `authService/index.js:144-146, :295, :449` | 弱密码（如 `123456`）可通过 | 提高至 8 位 + 字母数字混合；或至少禁止与用户名相同 |
| R15 | **低** | 缩进异常 / 变量遮蔽 / 废弃样式 | `store-switch.js:9-10`、`user-manage.js:26-27`（`if (!authGuard.requireLogin()) return` 顶格）；`authService/index.js:641` `const _ = db.command` 遮蔽模块级 `:6`；`login.wxss:120-196` 77 行 `history-*` 死样式 | 不影响执行，但掩盖后续缩进错误 | 顺手修；`_:641` 建议删除（顶部已定义） |
| R16 | **低** | `STORE_ROLES` 与 `'purchaser'`/`'super_admin'` 全局角色列表在多处硬编码 | `authService/index.js:21`；字面量出现在 `:96, :147, :196, :322`，以及 `getStores:322-325`（非门店角色即全量）；`getPurchaseOrders/index.js:50` 又各写一份 | 新增角色时容易漏改某一处，产生"登录能进、查数据被拒"或不该可见却可见 | 抽成共享角色常量（前端 `utils/meta.js` + 云函数公共模块各一份） |
| R17 | **低** | `mobile` 无格式校验 | `authService/index.js:376, :421` 仅 `trim()` | 可写入任意字符串；后续若有手机号短信/登录需求会踩坑 | 加正则校验或明确"仅展示用" |
| R18 | **低** | 门店/用户名查重缺归一化 | `authService/index.js:520-532`（仅 trim，未处理全角空格/大小写）、`updateStore:595-612`、`createUser:357-361` | 可建出视觉上重复的门店名/用户名 | 统一做 `trim()` + 全角转半角 + 小写化后再查重 |

---

## 7. 待确认清单

1. **生产库是否已轮换 `seed-data/app_user.json` 里的初始密码**（5 条带 hash 的种子记录）。代码无法判定 → 需核对线上 `app_user.password_hash` 与种子是否一致。
2. **数据库索引**：`app_user.username`、`app_user.sessions`（数组元素）、`app_user.session_token_hash` 是否建了索引。`getSessionUser` 每个请求 1~2 次查询，全 19 个云函数都在跑。
3. **`ACTIVE_ORDER_STATUS`（`authService:642`）是否覆盖全部在途状态**：该常量未含 `confirmed`，若它是采购单/供货商确认的在途状态，则存在"还有在途单却成功停用门店"的窗口。（该清单属于采购流域，需与对应代理对齐。）
4. **`currentStore.storeId` 是否被其他云函数当作作用域参数信任**：本次只抽查 `getPurchaseOrders`、`createPurchaseOrder`。`getReports`、`getReceipts`、`dataService` 等未逐一验证。
5. **`password_iterations` 线上历史值**是否全部 ≥120000（与 R9 配套的实证）。
6. **`getStores` 的 `includeInactive` 是否需要角色限制**（`:319` 目前任何登录用户都能传 1 看停用门店，注释说是给门店管理页用的，但门店管理页由超管操作）。
7. **登录无防重复提交**：连点是否已在服务端被 5 条会话上限吸收即可，还是应加请求级锁（属产品取舍）。
8. **`utils/cloud.js:56-64` 自动注入 token 的副作用**：`login` 调用本身依赖此机制（无 token 时传空串），确认没有其他"应无身份"的调用被误带 token。
9. **云开发安全规则**：是否已关闭客户端直连集合读写（本域只读源码，无法验证控制台配置）。
10. **`index.js:45` 给 chef 传 `createdBy`**：后端 `getPurchaseOrders:51-55` 对 chef 自行用 `user.user_id` 覆盖，前端传参形同无效，但两者若日后口径变化会静默错配。

---

## 附：已排除的疑点（读后确认安全）

- **停用后旧会话是否可用**：`status:1` 是 `getSessionUser` 的硬前置（`:109-110`），停用即时失效——**除 R1 描述的"停用→再启用"复活路径外**，成立。
- **跨门店数据泄露**：服务端一律按 `user.default_store_id` 强制作用域（`createPurchaseOrder:174-180, :209-214`；`getPurchaseOrders:50-66`），不信任前端 `currentStore`；`store-switch` 对 chef/store_manager 只能看到一家。抽查范围内不成立。
- **token 存储**：库中只存 SHA-256 哈希（`:45-47`），token 本身 256 位随机（`:210`），彩虹表不可行。
- **密码比对**：`timingSafeEqual` + 长度预检（`:38-43`）实现正确。
- **角色混淆登录**：`expectedRole` 服务端强制（`:195-197`），超管/普通角色入口互斥。
- **超管不可改自己**的"部分"防护确实存在：`updateUser` 对 `username==='admin'` 强制回 super_admin/`admin`（`:417-419`），**但仅限 username 恰好为 `admin` 的账号**（R2 的触发条件正在于此）。
- **19 个云函数全部调用 `getSessionUser`**，无一个绕过会话校验（`grep "getSessionUser\(event"` 逐个确认）。
