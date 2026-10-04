# full-scan-01：身份与会话域（authService + 鉴权底座 + 登录/账号/消息三页）

> 范围：`cloudfunctions/authService/`、`utils/`（4 文件）、`app.js/json/wxss`、`pages/login|account|message/`
> 只读参考：`dataService/index.js`（消息与消息已读的落地）、`createPurchaseOrder/index.js`、`getPurchaseOrders/index.js`、`store-switch.js`、`index.js`、`supplier-home.js`、`report-list.js`、`importProducts/index.js`（仅用于交叉验证结论）
> 方法：逐行读码，不采信注释与 README。结论均带 `文件:行号`。【待核实】= 需云函数控制台或跨批次确认。
> 已有文档不重复：鉴权复制问题、角色定义表、登录防爆破写法已由 `batch1-cloudfunctions-data.md` §1 记录；嵌套返回结构 F1/H10 由 `controller-horizontal-scan*.md` 记录；`report-list.js:126` 注释矛盾已由 `full-scan-06-pages-report.md` 记录。本文件只在**与自己结论冲突处**点名。

---

## 0. 文件覆盖清单

| 路径 | 行数 | 一句话职责 |
|---|---|---|
| `cloudfunctions/authService/index.js` | 674 | 权限中枢：14 个 action，覆盖登录/会话/门店/账号/供货商档案管理 |
| `cloudfunctions/authService/package.json` | 9 | 仅依赖 `wx-server-sdk ~2.6.3` |
| `utils/auth-guard.js` | 16 | `requireLogin()` 单一守卫，仅判 `globalData.isLoggedIn && authToken` |
| `utils/cloud.js` | 282 | `callFunction` 封装 + 9 个字段归一化器 + 文件上传/链接 |
| `utils/meta.js` | 67 | 状态/报表类型/供货商确认/分类图标 4 张字典 |
| `utils/util.js` | 127 | 日期格式化、toast、loading、confirm/prompt 弹窗 Promise 化 |
| `app.js` | 124 | 冷启动登录态恢复、会话服务端复检、`clearSession` |
| `app.json` | 74 | 26 页注册 + 4 项 tabBar + 云能力与隐私开关 |
| `app.wxss` | 300 | 全局设计变量 + 卡片/按钮/标签/表单/空态/文本工具类 |
| `pages/login/login.js` | 104 | 角色四选一 + 超管开关登录，成功写本地态并跳首页 |
| `pages/login/login.json` | 3 | 导航标题「登录」 |
| `pages/login/login.wxml` | 66 | 两个 `block` 分支（普通角色 / 超级管理员） |
| `pages/login/login.wxss` | 202 | 登录页样式，含 77 行已废弃的 history-* 样式 |
| `pages/account/account.js` | 71 | 改密表单，成功后清会话跳登录 |
| `pages/account/account.json` | 5 | 标题「安全设置」+ 白色标题文字 |
| `pages/account/account.wxml` | 28 | 账号摘要 + 三段密码输入 |
| `pages/account/account.wxss` | 58 | 头像与信息、密码卡样式 |
| `pages/message/message.js` | 83 | 消息列表 + 已读/全部已读 + 按类型路由 |
| `pages/message/message.json` | 2 | 仅标题，**未开** `enablePullDownRefresh` |
| `pages/message/message.wxml` | 30 | 消息列表 + 空态 |
| `pages/message/message.wxss` | 78 | 消息项/未读底/红点样式 |

---

## 1. authService：14 个 action 全表

入口 `exports.main`（`index.js:647-674`）是单一 `switch(event.action)`，未知 action 返回 `{code:-1, msg:'不支持的认证操作'}`（`:664`）；外层 `try/catch` 把所有异常压成一句通用文案（`:666-673`），仅当错误消息含 `collection`/`集合` 时返回"登录数据尚未初始化"（`:669-670`）——**云函数抛异常永远不会让前端崩，但也不会给页面定位线索**。

鉴权只有两种写法，14 个 action 无遗漏、无第三种风格：

| # | action | 前置鉴权 | 关键入参 | 读集合 | 写集合 | 成功返回 | 失败返回 | 失败返回结构 |
|---|---|---|---|---|---|---|---|---|
| 1 | `login` | 无（登录本身） | `username`,`password`,`expectedRole?` | app_user, store, supplier | app_user | `{code:0,data:{user,store,supplier,sessionToken,sessionExpiresAt}}`（:232-246） | `{code:-1,msg}` | **顶层** |
| 2 | `validate` | `getSessionUser(authToken)` | `authToken` | app_user | — | `{code:0,data:{user,sessionExpiresAt}}`（:254-266） | `{code:-401,msg}`（:253） | **顶层** |
| 3 | `logout` | `getSessionUser`（可空，不拒） | `authToken` | app_user | app_user | `{code:0}`（:285） | **无失败分支，恒成功** | **顶层** |
| 4 | `changePassword` | `getSessionUser` | `authToken`,`currentPassword`,`newPassword` | app_user | app_user | `{code:0}`（:311） | `-401`(:290) / `-1`(:294,295,296,297) | **顶层** |
| 5 | `getStores` | `getSessionUser` | `authToken`,`includeInactive?` | store | — | `{code:0,data:[publicStore]}`（:331） | `-401`(:316) / `-1`(:323) | **顶层** |
| 6 | `createStore` | `requireSuperAdmin` | `token`,`storeName`,`storeCode?` | store | store | `{code:0,data:{storeId,storeName,storeCode}}`（:576） | `-401/-403`(:507) / `-1`(:512,513,521,529,574) | **混合** |
| 7 | `updateStore` | `requireSuperAdmin` | `token`,`storeId`,`storeName` | store | store | `{code:0,data:publicStore}`（:607） | `-401/-403`(:581) / `-1`(:583,586,587,594,601) | **混合** |
| 8 | `setStoreStatus` | `requireSuperAdmin` | `token`,`storeId`,`status` | store, purchase_order | store | `{code:0,data:{storeId,status}}`（:644） | `-401/-403`(:613) / `-1`(:615,617,624,626,637) | **混合** |
| 9 | `listUsers` | `requireSuperAdmin` | `token` | app_user | — | `{code:0,data:[publicUser]}`（:348） | `-401/-403`(:342) | **混合** |
| 10 | `createUser` | `requireSuperAdmin` | `token`,`username`,`name`,`password`,`role`,`mobile?`,`defaultStoreId?`,`defaultSupplierId?` | app_user, store, supplier | app_user | `{code:0,data:publicUser}`（:390） | `-401/-403`(:352) / `-1`(:355,361,363,366) | **混合** |
| 11 | `updateUser` | `requireSuperAdmin` | `token`,`id`,同上（password 可选） | app_user, store, supplier | app_user | `{code:0,data:publicUser}`（:439） | `-401/-403`(:394) / `-1`(:396,400,402,408,411,414) | **混合** |
| 12 | `resetPassword` | `requireSuperAdmin` | `token`,`id`,`newPassword` | app_user | app_user | `{code:0}`（:467） | `-401/-403`(:443) / `-1`(:445,446,449,453) | **混合** |
| 13 | `setUserStatus` | `requireSuperAdmin` | `token`,`id`,`status` | app_user | app_user | `{code:0,data:{status}}`（:495） | `-401/-403`(:474) / `-1`(:476,478,479,483,484,486) | **混合** |
| 14 | `deleteUser` | 转 `setUserStatus({status:0})`（:501） | `token`,`id` | app_user | app_user | 同 setUserStatus | 同 setUserStatus | **混合** |

**核对主控清单的结论**：顶层 53 处 + 嵌套 2 处，与主控 H10 一致。9 个"混合" action 的嵌套只来自 `requireSuperAdmin` 的 `:336`/`:337` 两处，业务校验失败（`:512` 之后所有）全部是顶层。**没有 action 漏鉴权**：唯一不带鉴权的是 `login` 本身，合理。

### 1.1 三个"混合"结构的实际前端行为

`requireSuperAdmin`（:334-339）返回 `{error:{code,msg}}`，9 个调用点一律 `if (auth.error) return auth.error` 原样透出（:342-343、:352-353、:394-395、:443-444、:474-475、:507-508、:581-582、:613-614）。

`utils/cloud.js:68` 只判 `result.code === -401`。对嵌套返回，`result.code === undefined` → **不触发 `handleSessionExpired`**；页面侧 `result.code !== 0` 成立 → 走失败分支，`result.msg` 为 `undefined` → 显示页面兜底文案。

实测调用点（全项目 grep `authService`）：

| 前端调用点 | action | 嵌套路径下用户看到 |
|---|---|---|
| `user-manage.js:35` | listUsers | `:39` 的 `&&` 判空失败 → 走 else 兜底文案，不跳登录 |
| `user-manage.js:131` | resetPassword | 兜底文案 |
| `user-manage.js:210` | updateUser | 兜底文案 |
| `user-manage.js:212` | createUser | 兜底文案 |
| `user-manage.js:237` | setUserStatus | 兜底文案 |
| `store-manage.js:65` | updateStore | 兜底文案 |
| `store-manage.js:71` | createStore | 兜底文案 |
| `store-manage.js:103` | setStoreStatus | 兜底文案 |

两种症状：
1. **会话过期静默退化**（-401）：超管在账号/门店管理页会话过期，页面反复弹通用错误，**永远不被踢回登录页**。
2. **越权被伪装成故障**（-403）：`purchaser`（角色 label 恰为"管理员"）打开这两个页面触发 -403，前端显示"加载失败"而非"无权操作"，用户无法区分"系统坏了"与"角色不够"。

**与已有文档冲突处**：`controller-horizontal-scan.md` F1 结尾断言"`authService` 返回扁平 `{code,msg}`，工作正常"——该断言只对 `login`/`validate`/`logout`/`changePassword`/`getStores` 这 5 个 action 成立；其余 9 个 action 与 dataService 完全同病。主控 20261003 版 H10 已把边界修正为"账号管理分支"，本文件确认并补上逐调用点清单。

---

## 2. Token 生命周期

### 2.1 生成 / 签名 / 存储

| 环节 | 实现 | 位置 |
|---|---|---|
| 生成 | `crypto.randomBytes(32).toString('hex')`，256 bit 熵，无签名、无结构 | `index.js:210` |
| 落库 | **只存 SHA256 哈希**，明文 token 仅在 login 响应里出现一次 | `hashToken` :45-47；写入 :215, :221 |
| 多设备 | `user.sessions[]` 每设备一条 `{token_hash, expires_at}`，过滤已过期后 push，超 5 条挤出最旧 | :212-216 |
| 有效期 | `SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`（7 天），登录时以服务端 `Date.now()` 起算 | :13, :211 |
| 兼容层 | `session_token_hash` + `session_expires_at` 单会话字段，注释称"指向最新会话" | :220-222 |
| 密码 | `pbkdf2Sync(password, salt, 120000, 32, 'sha256')`；校验用 `crypto.timingSafeEqual` 且先比长度 | :28-43 |
| 盐 | 改密/建号时 `crypto.randomBytes(16).toString('hex')` 全新生成 | :299, :369, :429, :455 |

### 2.2 过期判定

`getSessionUser`（:106-131）：

1. `where({status:1, sessions:{token_hash}}).limit(1)`（:109-112）—— 依赖 MongoDB 对数组元素的隐式匹配；`status:1` 过滤使**停用账号会话立即失效**。
2. 未命中回退 legacy：`where({session_token_hash, status:1})`，再判 `session_expires_at`（:114-124）。
3. 命中后在 JS 里 `.find(s => s.token_hash === tokenHash)` 取出该条，判 `expires_at`（:126-129）。
4. **时间比较全部用服务端 `Date.now()`**（:122-123, :128-129），不使用客户端时间。✔

### 2.3 登出如何失效

`logout`（:269-286）：`getSessionUser` 拿到 user 后，从 `sessions` 过滤掉当前 token_hash（:273-275），把 `session_token_hash` 置 `''`、`session_expires_at` 置 `null`（:279-280）。**仅移除当前设备，其他设备会话不受影响**（:272 注释与实现一致）。token 无效/缺失时静默返回 `{code:0}`。

**失效的对称性核对**（"改密/停用后老会话必须死"）：

| 触发 | 清 `sessions[]` | 清 legacy 字段 | 结论 |
|---|---|---|---|
| `changePassword` | ✔ `sessions: []`（:305） | ✔（:306-307） | 全部设备登出 ✔ |
| `resetPassword` | ✔（:461） | ✔（:462-463） | ✔ |
| `updateUser` 带 password | ✔（:433） | ✔（:434-435） | ✔ |
| `setUserStatus(0)` / `deleteUser` | ✘ **未清** | ✔（:491-492） | **缺陷，见问题 M2** |
| `logout` | ✔ 过滤当前条（:275） | ✔ | ✔ |

### 2.4 「已登出仍可访问 / token 可预测 / 客户端时间」三项专项结论

- **已登出仍可访问**：无。登出、改密、被停用的三条路径都断会话；唯一漏洞是 M2（停用后再启用复活），不是"登出后"。
- **token 可预测**：否。32 字节随机数，无用户名/时间戳成分，无规律。库中不留明文。
- **时间比较用客户端时间**：服务端判定全部用 `Date.now()`。客户端只做一层"提前失效"的粗判（`app.js:21`），且被 `validateSessionOnLaunch`（:32, :48-70）异步纠正；即使伪造 `sessionExpiresAt` 到未来，服务端首个请求即 -401。✔
- **补充缺陷**：`app.js` 无 `onShow`，会话复检只在冷启动 `onLaunch`（:32）发生；**后台恢复（温启动）不复检**，只能靠单次请求 401 兜底，而 401 兜底对 §1.1 的嵌套返回无效。

---

## 3. 角色模型与权限判定表

### 3.1 角色定义

`ROLE_LABELS`（:14-20）定义 5 个角色全集；`STORE_ROLES = ['chef','store_manager']`（:21）；`SUPPLIER_ROLE = 'supplier'`（:22）。**authService 内部没有 GLOBAL_ROLES 常量**，超管判定是硬编码字符串（:337）。

### 3.2 权限判定还原表

| 角色 | roleLabel | 绑定 | 可执行 | 被拦 |
|---|---|---|---|---|
| `chef` | 门店下单人员 | 必须 `default_store_id`（:147-149, :206-207） | 建/改/提交自己门店自己的草稿；看本店本人建的单（`getPurchaseOrders` :51-55）；改自己密码；`getStores` 只返回自己门店（:322-325）；消息定向本店+本人 | 看他人单据（服务端绑死 `store_id`+`created_by`）；看异常记录（`getAbnormalRecords` 对 chef 直接返回 `[]`）；审批/核销/作废/报表/商品价格/账号门店管理 |
| `store_manager` | 店长 | 必须 | chef 全部 + 本店全部单与异常（`getPurchaseOrders` :56-59）；代改本店**任何人**草稿（`createPurchaseOrder` :179-187）；凭证核销 **submit**（`dataService:1441` VOUCHER_SUBMIT_ROLES 含 store_manager）；`generateSummaryReport` 有店长分支【待核实，full-scan-06 已记】 | 账号/门店管理（`requireSuperAdmin` 只认 super_admin）；核销 approve/reject（GLOBAL_ROLES）；自单自审 |
| `purchaser` | 管理员 | 无（全局） | 全局单据、按门店/创建人筛选（`getPurchaseOrders` :60-63）；审批、核销、作废/取消申请、商品/供应商/价格管理、报表；`getStores` 返回**全部门店**（:321-330 未收敛）；可切换任意门店 | **账号管理、门店管理 9 个 action 全部 -403**（:337）；异常记录仍按全局口径返回 |
| `super_admin` | 超级管理员 | 无 | purchaser 全部 + 账号/门店管理 9 个 action；可用 `createUser` 创建**新的 super_admin**（:377，无二次确认） | 仅 `username === 'admin'` 受三重保护（:417/:419 强制回写、:484 不可停用） |
| `supplier` | 供货商 | 必须 `default_supplier_id`（:150-152, :202-204） | 供货商门户、确认订单、供货商报表、消息按 `scope_type=supplier`+`scope_id` 定向（`dataService` :623-625）；改自己密码 | 采购单列表直接 -403（`getPurchaseOrders` :64-65）；收货/异常/审批/商品/价格/账号门店管理；`store-switch` 前端拦截并送回供货商门户（:14-17） |

### 3.3 角色清单的 6 处独立来源（漂移风险）

| 位置 | 常量 | 值 |
|---|---|---|
| `authService/index.js:14-20` | `ROLE_LABELS` keys | chef / store_manager / purchaser / super_admin / supplier |
| `authService/index.js:21` | `STORE_ROLES` | chef, store_manager |
| `authService/index.js:337` | 硬编码字符串 | `'super_admin'` |
| `dataService/index.js:8` | `GLOBAL_ROLES` | super_admin, purchaser |
| `dataService/index.js:9` | `MANAGEMENT_ROLES` | super_admin, purchaser（**与 :8 同文件同值冗余**） |
| `dataService/index.js:11` | `VOUCHER_SUBMIT_ROLES` | super_admin, purchaser, store_manager |
| `importProducts/index.js:8` | `MANAGEMENT_ROLES` | super_admin, purchaser（第 3 份副本） |

前端另有硬编码清单：`pages/report-list/report-list.js:128`、`pages/login/login.js:10-14`（角色选择器，**不含 super_admin**，超管只能走 `isSuperAdminLogin` 开关）、`pages/receive-list/receive-list.js:86`。

---

## 4. 越权面专项核查

按"用户传入 id 即可读/改他人数据"逐条查：

| 路径 | 判定 |
|---|---|
| `updateUser` / `resetPassword` / `setUserStatus` / `deleteUser` 的 `event.id`（Mongo `_id`） | 服务端不校验归属，但 `requireSuperAdmin` 已把入口锁死在唯一 super_admin → **不构成越权** |
| `updateStore` / `setStoreStatus` 的 `event.storeId` | 同上，入口即 super_admin → 不构成越权 |
| `getStores` | chef/store_manager 强制 `query.store_id = user.default_store_id`（:322-325）；**supplier 未收敛**，见问题 L7 |
| `login` 的 `expectedRole` | 客户端可伪造，但服务端用 `user.role !== event.expectedRole` 裁决（:195-197），伪造无效 |
| `changePassword` 的 `currentPassword` | 双重校验：会话 + 旧密码（:289-296）✔ |
| 消息（`getMessages`/`markMessageRead`/`markAllMessagesRead`） | `recipient_user_id` + `store_id`/`supplier scope_id` 双条件绑定（`dataService` :615-633, :650-653）；跨人 `markMessageRead` 返回 -403 **顶层**（:653），前端能正确提示 ✔ |
| 管理员接口是否真校验管理员身份 | `requireSuperAdmin` 只认 `role === 'super_admin'`（:337），purchaser 会被拦 → 校验真实有效（只是失败结构嵌套，见 §1.1） |
| 供应商账号与内部账号串号 | 登录时按角色分叉加载档案（:202-208）：supplier 取 `supplier` 集合并要求存在，其他角色取 `store`；supplier 无法拿到 store（`getDefaultStore` 对 STORE_ROLES 之外才走"默认门店"兜底，supplier 走 supplier 分支）→ **不串号** ✔ |
| `authToken` 注入 | `utils/cloud.js:57-64`：仅在调用方未显式传 `authToken` 时注入 `globalData.authToken`，回退 `wx.getStorageSync`。业务页面全部走这个注入，无页面自行伪造 token |

**内部 ID 暴露（信息项）**：`publicUser`（:49-62）同时返回 `id: user._id`（Mongo 内部主键）与 `userId: user.user_id`（业务号 `U+时间戳`），`listUsers` 把这批 `_id` 吐给前端，前端再以 `id` 回传。仅 super_admin 可见，非越权，但内部主键无必要外泄。

---

## 5. `utils/cloud.js` 封装契约

### 5.1 `callFunction(name, data)`（:49-76）

| 环节 | 行为 | 位置 |
|---|---|---|
| 云能力就绪 | `!wx.cloud` → 直接返回 `{code:-1,errorType:'CLOUD_UNAVAILABLE'}`；否则尝试补调 `app.initCloud()` | :50-52, :19-30 |
| authToken 注入 | 仅当 `!requestData.authToken` 时注入 `globalData.authToken \|\| wx.getStorageSync('authToken') \|\| ''` | :56-64 |
| 结果兜底 | `res.result \|\| {code:-1,msg:'云函数未返回有效结果'}` | :67 |
| 401 拦截 | **仅** `result.code === -401` → `handleSessionExpired()` | :68-70 |
| 异常吞掉 | `catch` 一律转 `getCloudFailureResult`：正则识别 `-501000 / FUNCTION_NOT_FOUND / 函数.*不存在` → `FUNCTION_NOT_DEPLOYED`，否则 `CLOUD_UNAVAILABLE` | :72-75, :6-17 |

`handleSessionExpired`（:32-47）：`app.clearSession()` → toast「登录已过期，请重新登录」→ 600ms 后 `wx.reLaunch('/pages/login/login')`；`redirectingToLogin` 防抖 1500ms（:42）。

### 5.2 两条失败路径的前端实际行为差异

| | 「云函数抛异常」 | 「云函数返回 error 字段（嵌套）」 |
|---|---|---|
| 前端拿到的对象 | `{code:-1, errorType, msg:'通用文案'}`（`getCloudFailureResult`） | `{error:{code:-401\|-403,msg}}`，顶层 `code`/`msg` 均 `undefined` |
| 页面判断 | `code !== 0` → 失败分支，`msg` 有值 → **显示具体文案** | `code !== 0` → 失败分支，`msg` 为 `undefined` → **显示页面兜底文案** |
| 是否跳登录 | 否（`-1 !== -401`） | **否**（`:68` 判 `result.code`，为 `undefined`） |
| 用户症状 | "登录服务异常，请稍后重试" 或 "云函数 xxx 尚未部署" | 业务兜底文案（如"消息加载失败"），与真实原因（会话过期/越权）完全无关 |

**关键不对称**：真正需要跳登录的 -401 被静默降级；而真正的网络/部署故障反而有明确文案。即"最该被纠正的状态"最不可见。

### 5.3 导出函数与被使用面

`module.exports`（:270-282）：`callFunction`、`formatDateTime`、`normalizePurchaseOrder`、`normalizePurchaseItem`、`normalizeProduct`、`normalizeSupplier`、`normalizePrice`、`normalizeReport`、`uploadReceiptPhotos`、`getFileUrl`、`getFileUrls`。

- 身份域内实际用到：`callFunction`（全部页面）、`formatDateTime`（`message.js:24`）。
- 归一化器**全部产出 snake_case→camelCase 且用 `...item` 展开保留原始字段**（:124-136 等），所以 wxml 引用未映射字段不会报 undefined，只是语义靠云函数恰好带了原始字段。
- **本域内未发现需要归一化的字段**：`publicUser`/`publicStore` 在服务端就已返回 camelCase（:49-73），前端直接消费，无归一化调用。

---

## 6. auth-guard 覆盖与实际强度

### 6.1 `requireLogin`（`utils/auth-guard.js:5-14`）

只看 `app.globalData.isLoggedIn && app.globalData.authToken`（:8）；失败 `wx.reLaunch('/pages/login/login')`（:12）；`getApp()` 抛错被吞（:11）。**不校验 `sessionExpiresAt`**。

### 6.2 覆盖矩阵

- `app.json` 注册 **26** 页；`pages/` 下 **26** 个目录，一一对应，无未注册页、无注册但不存在的页面（实测 + 主控 H3 一致）。
- 26 页中 **25 页**在首行调用 `requireLogin()`，唯一例外 `pages/login/login`（本身即登录页）→ **覆盖率 100%**。
- 无页面绕过；无页面用 `onLoad` 以外的时机做首次鉴权。

### 6.3 TabBar 与 onLaunch 链路

`tabBar` 4 项：`index` / `purchase-list` / `report-list` / `message`（`app.json:43-66`），全部已注册、全部 `pagePath` 与 `pages` 数组一致。

| TabBar 页 | 鉴权时机 | 刷新机制 |
|---|---|---|
| `pages/index/index` | `onShow`（`index.js:21` `async onShow`） | 每次切 tab 重拉 |
| `pages/purchase-list/purchase-list` | `onLoad`(:23) + `onShow`(:31) | `onPullDownRefresh`(:41) 已开 |
| `pages/report-list/report-list` | `onShow`(:20) | `onPullDownRefresh`(:26) 已开 |
| `pages/message/message` | `onShow`（`message.js:12` `async onShow`） | **未开下拉刷新**（`message.json` 仅 1 项配置） |

`app.json` 全项目仅 5 个 json 开了 `enablePullDownRefresh`（purchase-list / receive-list / approval-list / report-list / report-history）。

### 6.4 覆盖率的实质短板

计数 100% 不等于防护有效，三处缺口：

1. `requireLogin` 不查过期（:8）→ 过期态只能在**首个云请求 401 时**才被纠正。
2. 401 纠正对 §1.1 的嵌套返回无效 → dataService / importProducts / authService 的 9 个超管 action 路径下，过期会话可长期驻留。
3. `app.js` 无 `onShow`（:4-124 只有 `onLaunch`），温启动不复检。

`requireLogin` 用 `reLaunch` 而非 `switchTab`：TabBar 页被守卫跳转时会重建页面栈。属可接受实现，但若守卫在 TabBar 页触发，用户当前 tab 选中态会丢失。

---

## 7. 登录 / 账号 / 消息三页

### 7.1 `pages/login`

| 项 | 实测 |
|---|---|
| 表单 | 账号 + 密码 + 角色四选一（chef/store_manager/purchaser/supplier，`js:10-15`）；超管单独走 `isSuperAdminLogin` 开关（`js:38-45`, wxml:43-61） |
| 提交 | `expectedRole: isSuperAdminLogin ? 'super_admin' : selectedRole`（`js:56`）；服务端裁决（`authService:195-197`）✔ |
| loading | `showLoading('登录中')` → `hideLoading()`（`js:51,58`），异常路径也一定 `hideLoading` ✔ |
| 错误分诊 | `code===0` 成功；`res.errorType` → 弹模态「登录服务不可用」；否则 `showToast(res.msg \|\| '账号或密码错误')`（`js:60-70`）✔ |
| 成功落地 | 写 `globalData` + `setStorageSync` 四项（userInfo/authToken/sessionExpiresAt/currentStore 或 supplierInfo），1000ms 后 `switchTab('/pages/index/index')`；supplier 走 `reLaunch('/pages/supplier-home/supplier-home')`（`js:73-103`）✔ |
| 空态/防重 | **无 submitting 标志**，按钮可连点 → 并发多次 login（见问题 L8） |
| 隐私 | 不在页面公示测试账号（`js:19-22` 每次 `onShow` 清空两栏）✔ |

### 7.2 `pages/account`

- 任意角色可进（无角色判断），功能只有改密 —— 合理。
- 表单校验：三栏非空、新密码 ≥6、两次一致（`js:35-39`）；服务端另有"新旧不能相同"（`authService:297`），前端未做 → 用户会先看到服务端文案，可接受。
- 成功后 `app.clearSession()`（`js:59`）+ 900ms 后 `reLaunch` 登录页 ✔。
- `js:52` 的 `if (res.code !== -401)` 是对 `utils/cloud.js` 统一拦截的**正确假设**（changePassword 返回顶层，注释与实现相符）✔。
- **UI 文案 understated**：`account.wxml:26` 写"更新后当前登录会话会失效"，实际服务端清 `sessions: []` → **该用户所有设备同时登出**（`authService:305`）。

### 7.3 `pages/message`

- `onShow` 重拉，无下拉刷新、无轮询、无定时；新消息依赖切 tab 触发 `onShow` 才可见。
- `unreadCount` **仅本地计算**（`js:27`），全项目 0 处 `setTabBarBadge`（grep 确认）→ **消息 tab 永远无未读角标**，"消息中心"的未读提示完全依赖用户主动进入。
- 已读/全部已读均服务端落库（`dataService` read_by 数组去重，:654-660, :672-678），本地只做乐观更新 ✔。
- 路由：`bizId` 存在时按 type 跳（abnormal→异常列表；receive 或 `bizId` 以 `'RCP'` 开头→收货列表；其他→采购单详情），supplier 一律跳供货商订单（`js:51-69`）。
- **图标与路由口径不一致**：`message.wxml:11-15` 只认 4 种 type（approval/order/receive/abnormal），缺 type 时显示默认 chat 图标；但 `js:61-62` 的路由兜底认 `bizId` 前缀 `'RCP'` → **同一旧消息可能显示"聊天"图标却跳到收货列表**。
- `markMessageRead` 失败会 `return` 且**不跳转**（`js:42`）✔，不产生"点了没反应"。
- 死代码：`js:14`、`js:74` 两处 `const app = getApp()` 从未使用。
- `js:24-25` 双重转换：`formatDateTime(m.time)` 再 `getRelativeTime(...)` 解析回 Date，依赖 `-`→`/` 兼容 iOS，可用但绕。

---

## 8. app.json 与真实页面一致性

- 注册 26 页 ↔ 目录 26 个：**一一对应**，无未注册页、无注册但不存在的页（主控 H3 同结论，本文件独立复算一致）。
- tabBar 4 项 `pagePath` 全部在注册表内。
- 全项目 grep 出的 26 个 `/pages/*/*` 跳转目标**全部存在对应 .js 文件**（含 `supplier-home`、`user-manage` 等主控 H4 怀疑的孤儿页）。
- `"cloud": true`、`"lazyCodeLoading": "requiredComponents"`、`"__usePrivacyCheck__": true`、`"sitemapLocation": "sitemap.json"` 均在位（`app.json:69-73`）。
- `app.js:2` 硬编码 `CLOUD_ENV = 'cloud1-d3gezx51aca79d9bb'`（前端固定环境），而全部云函数用 `cloud.DYNAMIC_CURRENT_ENV`（`authService:4` 等）。**两端环境选择策略不同**，靠部署时同一环境兜底，非缺陷但值得记录。

---

## 9. 问题清单

### 高

**H1 · authService 9 个超管 action 的失败返回是嵌套结构，会话过期不跳登录、越权被伪装成故障**
`cloudfunctions/authService/index.js:334-338`（`requireSuperAdmin` → `:336` -401、`:337` -403）；调用点 `:342-343 / :352-353 / :394-395 / :443-444 / :474-475 / :507-508 / :581-582 / :613-614`；前端判定 `utils/cloud.js:68`。
触发：(a) 超管在账号/门店管理页会话过期后任意操作；(b) `purchaser` 角色打开 `user-manage` / `store-manage`。
影响：(a) 列表加载失败只显示兜底文案，用户可无限重复点击且**永不被踢回登录页**；(b) 越权（-403）被降级为"加载失败"，用户无法区分故障与权限不足。波及 `user-manage.js:35/131/210/212/237`、`store-manage.js:22/65/71/103` 共 8 处调用点。
建议：把 `:336`/`:337` 的 `{ error: { ... } }` 拍平成 `{ ... }`（2 行，前端零改动）。与 `dataService:47/49`、`importProducts:54/56` 一并改，属全项目改动最小、收益最大的一处。

### 中

**M2 · 停用账号重新启用后旧 token 复活（注释与实现相反）**
`authService/index.js:489-494`；对照 `:305` / `:433` / `:461` 均清 `sessions: []`；错误注释 `:471-472`。
触发：super_admin 对某账号 `setUserStatus(status:0)`，7 天内又 `setUserStatus(status:1)`（误停用后撤销、`deleteUser`(:500-502) 同理）。
影响：停用期间 `getSessionUser` 的 `where({status:1,...})` 过滤使会话确实失效；但重新启用后 `sessions[]` 里的旧 token_hash 仍在且未过期 → **持旧 token 的设备无需重新登录即可访问**。注释声称"再清 token 防止旧会话复活"，实现恰好没清 `sessions`。
建议：`:490` 的 `if (status === 0)` 分支追加 `updateData.sessions = []`。

**M3 · `getSessionUser` 已复制成多份且结构分叉，改动需同步 20 处**
`authService:106-131` vs `createPurchaseOrder/index.js:13-39`、`getPurchaseOrders/index.js:11-39`。
两版逻辑等价（都做过期判定）但结构不同：authService 在 legacy 分支内判定（:121-123），副本在函数尾部统一判定（:36-38）。当前无行为差异。
影响：将来修一处漏改另一处 = 立即产生越权面（batch1 已记录 6+ 处复制，本项目无共享模块）。【待核实】20 份副本是否逐一等价。
建议：确认无法抽共享模块后，在 CLAUDE.md 固化"改鉴权必须全量 diff 所有副本"。

**M4 · 同一账号并发登录相互覆盖会话（丢失更新）**
`authService/index.js:213-216`（读-改-整体写回）+ `:230`（`doc().update({data:{sessions}})` 全量覆盖），非原子数组操作。同型写法：`logout` `:273-283`、`changePassword` `:305`。
触发：两台设备（或一台设备连点登录按钮，`login.js` 无 submitting 禁用）几乎同时登录。
影响：后写者覆盖前写者，前者的 token 不在库里 → 登录成功后立即 -401，表现为"登录成功但秒退"。症状诡异、难复现。
建议：改用 `db.command.push` 原子追加（配合应用层裁剪 5 条上限），或记录为已知限制。

**M5 · 角色清单有 7 处独立来源，含同一文件内两个同值常量**
见 §3.3 表：`authService:14-20`、`:21`、`:337`、`dataService:8`、`dataService:9`（与 :8 同文件同值冗余）、`dataService:11`、`importProducts:8`，外加前端 `report-list.js:128`、`login.js:10-14`、`receive-list.js:86` 三份硬编码。
影响：新增角色或调整归属需改 7+ 处，漏改即产生"某角色在某功能下既看不到入口又被服务端拒绝"的不一致。`report-list.js:126` 的注释指向 `GLOBAL_ROLES` 但实际执行的是 `generateSummaryReport` 的另一套清单，注释误导（full-scan-06 已记录矛盾，本文件补充"authService 内根本没有 GLOBAL_ROLES 常量"这一事实）。
建议：收敛为单一来源；至少先删 `dataService:9` 的重复定义。

**M6 · 整个管理面单点依赖魔法字符串 `'admin'`**
`authService/index.js:417, :419, :484` 三处硬编码 `username === 'admin'`；`:377` 允许 super_admin 创建新 super_admin 且无二次确认；`:484` 只保护这一个用户名。
影响：`purchaser`（label 恰为"管理员"）无任何账号/门店管理权，全部管理面只归 super_admin；除 `username === 'admin'` 外，任何 super_admin 都可被停用/删除。保护对象由"最后一个超管"降级为"一个恰好叫 admin 的账号"。若未来把 admin 改名（当前被 `:419` 强制回写挡住），保护机制即静默失效。
建议：把 `'admin'` 抽为命名常量，并改为"最后一个超管不可停用"的结构性保护。

### 低

**L1 · 前后端两套日期解析能力差距大**
`app.js:15-20` 的 `parseExpires` 只处理数字与 `"YYYY-MM-DD HH:mm"`（`-`→`/`），解析失败静默 NaN 导致本地登出；`utils/cloud.js:78-110` 的 `parseDateValue` 处理 number/Date/纯数字字符串/`$date`/`$timestamp`/`seconds+nanos` 共 6 种形态。app.js 场景只收 ISO 字符串，实际够用，但两处能力不一致，将来复用易踩坑。（主控 F2 已记，此处确认结论方向正确）

**L2 · `app.js` 无 `onShow`，温启动不复检会话**
`app.js:4-124` 只有 `onLaunch`；`validateSessionOnLaunch` 仅在冷启动 `:32` 调用。后台恢复不进 onLaunch → 只能靠单次请求 401 兜底，而该兜底对 H1 的嵌套返回无效。

**L3 · `requireLogin` 不校验过期，计数覆盖 100% 但防护有窗口**
`utils/auth-guard.js:8` 只看 `isLoggedIn && authToken`。25/25 非登录页覆盖，但过期态需等首个云请求。详见 §6.4。

**L4 · 改密 UI 文案与实现不符（所有设备 vs 当前会话）**
`account.wxml:26` "更新后当前登录会话会失效" vs `authService:305` `sessions: []` 清空全部设备。

**L5 · `account.js:16-20` 死代码 + 跳转方式不一致**
`requireLogin()` 返回 true 已保证 `isLoggedIn === true`，紧随的 `if (!app.globalData.isLoggedIn)` 永假，且它用 `wx.redirectTo` 而 `requireLogin` 用 `wx.reLaunch`，两条路径永不汇合。

**L6 · 未使用变量**
`message.js` 有 **3 处** `const app = getApp()` 从未使用：`:14`（onShow）、`:37`（readMessage 内 `if (!message.read)` 块）、`:74`（markAllRead）。三处 `callFunction` 都不需要 `app`，纯死代码。（`account.js:42` 的 `app` 在 `:59-65` 有使用，不在列）

**L7 · `getStores` 对 supplier 角色不收敛**
`authService/index.js:319-331`：仅 `STORE_ROLES` 收敛到 `default_store_id`（:322-325），`purchaser`/`super_admin`/`supplier` 均返回全部门店（limit 100，含 store_name/store_code）。当前无 supplier 页面调用（调用方仅 `user-manage.js:36`、`store-manage.js:22`、`store-switch.js:19`），现状不暴露；但持 supplier token 直接调用即可枚举全部门店名称与编号。
建议：supplier 直接返回 `{code:-403}` 或空数组。

**L8 · 登录按钮无防重，用户可自行触发锁号**
`login.js:47-71` 无 submitting 标志；`authService:177-179` 每次失败 `login_fail_count: _.inc(1)`，`182-190` 连续 5 次锁 10 分钟。用户连点 6 次错误密码即自锁；同时每次成功都新建 session（最多 5 条挤出最旧，与 M4 叠加）。
建议：登录期间 `disabled="{{submitting}}"`。

**L9 · 登录响应文案泄露账号状态**
`authService:169-172` 已锁定→"账号已锁定，请N分钟后重试"；`:192` 不存在或密码错→"账号或密码错误"；`:194` 停用→"账号已停用"。三条文案让攻击者区分「账号是否存在」「是否停用」「是否正被爆破」。锁定只在 `if (user)`（:175）时生效，对不存在的用户名无任何限速，爆破未知用户名不受约束。
建议：统一为"账号或密码错误"，或对"用户名不存在"也走同样的计数（用虚拟计数键）。

**L10 · `createStore` 序号与唯一性依赖未见证据**
`authService:534-542` 用 `limit(1000)` 全量遍历求最大序号，>1000 家门店会漏算；`:552-571` 的撞号重试依赖 `add` 抛错，但**代码中无 `store.store_id` 唯一索引证据**——若无索引，`add` 永不抛错，重试分支为死代码，并发下会产生重复 store_id。【待核实：TCB 控制台查 store 集合索引】

**L11 · `getStores` / `listUsers` 无分页**
`:329`、`:346` 均 `limit(100)`。超管门店或账号超过 100 个时静默截断，页面无从感知。

**L12 · `setStoreStatus` 停用前只查采购单，不查收货/异常/账号绑定**
`authService:630-639` 只统计 `purchase_order` 的 7 个活动状态（:632），不查 `receipt`、`abnormal_record`，也不查仍指向该门店的 `app_user.default_store_id`。停用后这些记录仍持有该 `store_id`，而 `getStores` 默认 `status:1` 过滤 → UI 上找不到门店名。`store` 集合本身保留记录（status=0），追溯链未断，属 UI 表现层缺口。

**L13 · 消息中心无未读角标，TabBar 永远是灰色**
`message.js:27` 本地算 `unreadCount`；全项目 0 处 `setTabBarBadge`/`showTabBarRedDot`（grep 确认）。消息 tab 无角标，未读提示完全依赖用户主动进入页面。

**L14 · 消息图标与消息路由的判定口径不一致**
`message.wxml:11-15` 只认 4 种 type，缺 type 显示默认 chat 图标；`message.js:61-62` 路由兜底认 `bizId` 前缀 `'RCP'`。同一旧消息可能显示聊天图标却跳到收货列表。

**L15 · `utils/meta.js` 状态字典：落库值全覆盖，但 `superseded` 走 wxml 硬编码而非字典**
实测全项目写入的 `purchase_order.order_status` 共 12 个值（draft/submitted/pending_approval/approved/rejected/report_generated/received/receipt_abnormal/partial_received/completed/to_receive/cancelled），`meta.js:1-20` 的 18 项**全部命中** ✔；异常记录 4 值（pending/processing/resolved/closed，`dataService:690-695`）与报表 `generated` 也都在字典内 ✔。
但 `report_file.status = 'superseded'`（`dataService:416`、`:1318`）**不在字典内**，改由 wxml 硬编码渲染：`report-history.wxml:31`、`report-list.wxml:41` 用 `wx:if="{{item.status === 'superseded'}}"` 显示「已作废」。同一值两条渲染路径，新页面若走 `getStatusInfo`（`meta.js:43-45` 对未知值返回裸英文不抛错）会显示英文原值。
另：`confirmed` 同时存在于 `statusMap`(:13) 与 `supplierConfirmMap`(:25)，但全项目无 `status: 'confirmed'` 写入（供货商确认写在 `purchase_order.supplier_confirmations` 上）→ 字典冗余项。
`to_verify` / `receivable` 是 `getPurchaseOrders:70-74` 的虚拟筛选值，从不落库，字典中也没有 → 正确。

**L16 · `showConfirm` 把弹窗失败当作"取消"**
`utils/util.js:83-96` 的 `fail` 分支 `resolve(false)`，无第三态；`showPrompt`（:101-116）同样。退出登录等确认式流程在弹窗失败时会静默视为取消，用户不知操作未执行。

**L17 · `handleSessionExpired` 防抖窗口与 toast 时长错位**
`utils/cloud.js:42` 防抖 1500ms、`:44-46` reLaunch 延迟 600ms、toast duration 2000ms（`util.js:65`）。1500ms 内第二次 -401 既不弹 toast 也不 reLaunch，但页面已走失败分支 → 用户只看到一条通用错误。低概率并发场景。

**L18 · 样式与代码残留（清理项）**
`login.wxss:120-196` 共 77 行 `history-*` 样式、`login.js:86`、`index.js:131`、`supplier-home.js:131` 的 `account_history` 清理，均为"最近登录账号"功能下线后的残留；而 `app.clearSession`（`app.js:74`）的键清单里**没有** `account_history` —— 三处清理逻辑不一致（唯一差异即此死键）。另 `app.wxss:203-222` 与 `login.wxss:92-110` 对 `.form-group/.form-label/.form-input` 重复定义，靠加载顺序覆盖。

---

## 10. 跨批次待核实项

| # | 要确认什么 | 去哪个文件找 |
|---|---|---|
| 1 | F1/H1 的修复落点由谁拍板：改 3 个 helper（服务端 6 行）还是改 `utils/cloud.js:68`（前端 1 行 + 拍平） | `dataService/index.js:45-49`、`importProducts/index.js:52-56`、`authService/index.js:334-338` |
| 2 | `store.store_id` 是否有唯一索引（决定 L10 的撞号重试是活代码还是死代码） | TCB 控制台索引配置，代码中查不到 |
| 3 | 20 份 `getSessionUser` 副本是否逐一等价（M3） | 全 `cloudfunctions/*/index.js` grep `getSessionUser` |
| 4 | `getSuppliers` 是否鉴权、是否按角色收敛（`user-manage.js:37` 在超管页调用但未传显式 token） | `cloudfunctions/getSuppliers/index.js`（建议归 full-scan-05 管理后台批次） |
| 5 | `purchaser` 被排除在账号/门店管理外是否符合产品预期（M6） | 产品确认；关联 `业务模糊点确认清单.md` |
| 6 | `app_user.openid` 被"后登录者覆盖"（`authService:229`）与供货商订阅消息推送（`dataService:253-261` 按 `scope_id` 查该供货商所有启用账号）是否语义一致：同一微信号登过两个供货商账号时两个账号都被推，是否可接受 | `cloudfunctions/dataService/index.js:253-280` |
| 7 | `superseded` 是否应从 wxml 硬编码收敛进 `meta.js` 字典（L15 已实测：12 个落库 `order_status` 与异常/报表状态全覆盖，唯一双路径值是 `superseded`） | `pages/report-history/report-history.wxml:31`、`pages/report-list/report-list.wxml:41` |
| 8 | `generateSummaryReport` 店长分支 vs `report-list.js:126` 注释矛盾（M5 已交叉，full-scan-06 已记结论，此处只登记一致性依赖） | `cloudfunctions/generateSummaryReport/index.js:160-175` |
| 9 | `supplier` 角色能否触达 `getStores` 之外的门店/单据数据面（L7 的延伸） | full-scan-07 供应商批次 |
| 10 | 消息页无 TabBar 角标（L13）是否属产品缺口还是有意设计 | 产品确认 |
