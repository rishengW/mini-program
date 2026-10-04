# 07 基础设施 / 鉴权 / 供应商端与通用页面（覆盖勘探）

- 分支：`backup`（只读排查，未修改任何源码，未提交）
- 范围：`app.js`、`app.json`、`app.wxss`、`sitemap.json`、`project.config.json`、`project.private.config.json`、`.gitignore`、`utils/*`（4 个）、`styles/icons.wxss`、`scripts/*`（2 个）、`assets/**`（9 个）、10 个页面四件套（共 40 个文件，2365 行）；交叉核对 6 个云函数（`authService`/`dataService`/`getSupplierOrders`/`getSupplierReceipts`/`confirmSupplierOrder`/`getPurchaseOrders`/`getProductPrices`/`getSuppliers`）
- 方法：全部目标文件逐个完整读取，未抽样；`assets/*.png` 未读二进制（按体积判断），`scripts/icons-preview.html` 只读头部确认由生成器产出
- 与旧报告关系：`deep-20261004/01-identity-auth-session.md`、`deep-20261004/07-infra-config-assets.md`、`rescan-20261004-R9-pages-supplier-auth.md`、`full-scan-08-infra-and-data-contract.md` 仅作参考，本文所有结论均以当前代码为准独立验证，并在 §5 标注"仍然成立 / 代码已变化 / 旧报告判断有误"

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 页面注册一致性 | `app.json` 注册 26 页 ↔ `pages/` 实际 26 目录，**双向零差异**：无"注册了但文件不存在"，无"文件存在但没注册" |
| tabBar 图标 | 4 项 tab × 2 态 = 8 条路径全部真实存在；`assets/` 9 个文件**全部被引用，无死资源、无缺失引用** |
| 上传包 | 126 文件 / **465,733 B（≈455KB）**，远低于 2MB 主包上限；`scripts`/`seed-data`/`cloudfunctions`/`.md`/`.html` 均被 packOptions 排除 |
| 鉴权真实强度 | 前端 `requireLogin` 强度为 **0**（纯导航守卫，只读本地标志）；真正强度在 19 个云函数各自复制的 `getSessionUser`（`status:1` + 会话哈希 + TTL 三重硬前置）。**供应商 supplierId 全部由服务端从会话派生，前端 7 处调用 0 处传参**——前端传参不可信这个攻击面在本项目不存在 |
| 供应商"审批前不可见" | **已落实在服务端**：`getSupplierOrders` 的 `HIDDEN_ORDER_STATUS = ['draft','submitted','pending_approval','rejected']` + `confirmSupplierOrder` 的 `CONFIRMABLE/SHIPPABLE_ORDER_STATUS` 白名单双闸门 |
| 最大的两个问题 | ① `dataService` 的 `-401` 被包成 `{error:{code:-401}}`，前端只判顶层 `code` → **`message`/`supplier-messages` 两页会话过期后不跳登录页**（R9 P0-2 仍然成立）② `getSupplierOrders` 全量展开 `purchase_order` 主表 → 供应商拿到**同单其他供应商的确认状态**等内部字段（R9 P0-1 仍然成立） |
| 新发现 | `getAbnormalRecords` 无角色闸门 → 供应商可跨门店读异常记录（§5 N1）；`setUserStatus` 停用不清 `sessions` 数组 → 停用再启用后旧会话复活（N2，注释自称已防复活，实际没防）；`getSupplierOrders` 用 `String(Date)` 做内存排序 → 按星期几字母序错排（N3，回收 R9 待核实 #1） |
| 死资源 | `styles/icons.wxss` 94 条规则中 **44 条（22,001 B，44%）无任何引用**；3 个页面合计 **≈163 行死 CSS**；`app.js:121 companyInfo`、3 处 `account_history` 死键 |
| 未处理的历史项 | `login-logo.jpg` 83,376 B（占上传包 18%）两次审计建议压到 10KB 内，**至今未处理**；`seed-data` 已写 ignore 但 15 个文件仍在 git 追踪 |

---

## 1. 基础框架

### 1.1 `app.js`（124 行）

**启动流程（`onLaunch`）**：`initCloud()` → `initPrivacyListener()` → 读 `userInfo`/`authToken`/`sessionExpiresAt` 三个 storage → `parseExpires` 兼容解析（数字直接用；字符串把 `-` 换 `/` 并去 `T`，失败视为会话无效——注释明确是为绕 iOS JSCore 解析 `2026-09-24 12:00:00` 返回 Invalid Date 的问题）→ `sessionValid = authToken && sessionExpiresAt && parseExpires(...) > Date.now()` → 有效则灌 `globalData`（供应商角色额外恢复 `supplierInfo`）并异步 `validateSessionOnLaunch`；存在残留但已失效则 `removeStorageSync` 五个键 → 最后读 `currentStore`。

**全局状态字段（8 个 + 1 个动态）**：`isLoggedIn`、`userInfo`、`authToken`、`currentStore`、`supplierInfo`、`companyInfo`、`cloudReady`，运行时挂 `pendingListFilter`（`index.js:164` 写 → `purchase-list.js:34-36` 读并清零，链路完整）。

**登录态恢复**：只做本地判定，`validateSessionOnLaunch` 异步向 `authService validate` 复核，成功则用服务端返回的 `user` 覆盖本地缓存，失败/`code!==0` 调 `clearSession()`。网络异常 `catch` 静默保持本地登录态，由请求级 `-401` 兜底。

**角色路由分发**：**`app.js` 本身不做任何角色分发**。`app.json` 只有一套 tabBar（内部用户 4 个 tab），**供应商完全没有 tabBar**。分发点实际分散在 5 处：`login.js:90-97`（供应商登录后 `reLaunch supplier-home`）、`index.js:31-34`（供应商误入首页 → `reLaunch supplier-home`）、`store-switch.js:14-17`（供应商 → `supplier-home`）、`supplier-home/orders/receipts/prices` 四页反向守卫（非供应商 → `reLaunch index`）。供应商 4 个页面全部靠 `navigateTo` 串联，返回链完全依赖"返回上一页"。

**冷启动入口** = `app.json` 的 `pages[0]` = `pages/login/login`。即使会话仍有效，**启动后也不会自动跳转**（`sessionValid` 分支只置 `globalData`，不 `reLaunch`），用户必须再登一次。

**异常兜底**：`initCloud` 与 `clearSession` 各自 `try/catch`；`validateSessionOnLaunch` 失败分支只清状态不跳页。**全项目无 `onError` / `onUnhandledRejection` 全局兜底**。

### 1.2 `app.json`（74 行）

注册 26 条页面路径 ↔ `pages/` 目录实际 26 个（脚本比对结果：`registered not on disk: []`，`on disk not registered: []`）。四件套（`.js`/`.wxml`/`.json`/`.wxss`）全部齐备。**死页面与孤儿页均为 0。**

- `tabBar.list` 4 项：`pages/index/index`（首页，`home`/`home-active`）、`pages/purchase-list/purchase-list`（采购，`cart`/`cart-active`）、`pages/report-list/report-list`（报表，`report`/`report-active`）、`pages/message/message`（消息，`bell`/`bell-active`）——8 条路径逐一核实全部真实存在。`assets/icons/` 下没有第 9 个未引用文件。
- `window` 绿色导航栏 `#00873E` + `titleText` 白色；`style: v2`；`cloud: true`；`lazyCodeLoading: "requiredComponents"`；`__usePrivacyCheck__: true`。
- **无 `subpackages` 配置 → 26 页全部在主包**。
- `sitemap.json` 单条 `disallow *`，全部页面不收录搜索。

### 1.3 `utils/cloud.js`（283 行）——⚠ 文件名与职责错位

**实际职责是"云函数调用封装 + 字段归一化"**，而不是元数据。`utils/auth-guard.js` 才是登录守卫（17 行），`utils/meta.js` 才是状态字典（68 行）——三个文件的命名与职责全部错位，读代码时极易误判。

**调用约定**：`callFunction(name, data = {})` → `ensureCloudReady()`（`wx.cloud` 缺失或 `globalData.cloudReady===false` 时补调 `app.initCloud()`）→ 浅拷贝 `data` 并**自动补 `authToken`**（`globalData.authToken` → `wx.getStorageSync('authToken')` → `''`，已显式传 token 则不改）→ `await wx.cloud.callFunction({name, data: requestData})` → `res.result` 为空时归一为 `{code:-1, msg:'云函数未返回有效结果'}` → `result.code === -401` 触发 `handleSessionExpired()`。

**超时/重试**：**两者都没有**。完全依赖微信 SDK 默认超时（约 60s），无任何业务重试。失败走 `getCloudFailureResult` 二分归一化：正则匹配 `-501000|FUNCTION_NOT_FOUND|函数.*不存在` → `{errorType:'FUNCTION_NOT_DEPLOYED', msg:'云函数 X 尚未部署'}`；其余 → `{errorType:'CLOUD_UNAVAILABLE', msg:'CloudBase 服务连接失败，请稍后重试'}`。

**错误归一化的真实缺口**：只判顶层 `result.code`，**无法识别 `dataService` 返回的嵌套结构** `{error:{code:-401,...}}`（见 §4 P0-2）。

**批量**：`getFileUrls` 按 50 条分批（对齐 `getTempFileURL` 单次上限）；`uploadReceiptPhotos` 用 `Promise.all` 并发上传，`cloudPath` 为 `receipts/{safeOrderId}/{timestamp}-{index}.{ext}`，`safeOrderId` 用 `/[^a-zA-Z0-9_-]/g` 白名单清洗，空值兜底 `'receipt'`（→ 未传单号时所有收货图堆在 `receipts/receipt/` 同一目录）。

**归一化层**：`normalizePurchaseOrder/Item`、`normalizeProduct`、`normalizeSupplier`、`normalizePrice`、`normalizeReport` 五个函数统一兼容 snake_case/camelCase 双写法。边界：`normalizePurchaseOrder:143` 的 `deliveryDate` 回退到 `orderDate`——旧单据（`delivery_date` 字段引入前的）会显示"下单日 = 期望到货日"，可能误导收货排期。

### 1.4 `utils/auth-guard.js`（17 行）+ 前端鉴权真实强度

```
requireLogin()：getApp().globalData.isLoggedIn && globalData.authToken → true
               否则 wx.reLaunch('/pages/login/login')，返回 false
```

**真实强度：0**。它只读本地内存标志，可被三类方式绕过：① 直接构造云函数请求（不经任何页面）② 篡改 `storage`/`globalData` ③ 小程序码、分享卡片、订阅消息跳转直达页面路径。**真正的强度全部在服务端**：19 个云函数各自复制一份 `getSessionUser(authToken)`，硬前置 `status: 1` + `sessions[].token_hash` 或旧 `session_token_hash` + `expires_at > now`。26 个业务页的 `onLoad`/`onShow` 首行**全部**调用了 `requireLogin`（逐个 grep 确认），4 个 tabBar 页也覆盖。

**代价**：会话过期的检测完全依赖请求返回 `-401` 后的 `handleSessionExpired()`（清会话 + toast + 600ms 后 `reLaunch`，带 1500ms 防抖）。一旦某个云函数把 `-401` 包进嵌套结构，这条兜底就整个失效（§4 P0-2）。

### 1.5 `utils/meta.js`（68 行）——⚠ 任务描述与实体不符

**它不是"角色/门店元数据存储"**，而是一份**纯常量字典**：`statusMap`（18 项）、`supplierConfirmMap`（5 项）、`reportTypeMap`（8 项）、`categoryIconMap`（13 项 emoji→图标基础名），以及 4 个查询函数。**没有缓存，因此不存在缓存失效问题**；三个 `getXxxInfo` 全部有兜底（未知值 → `{text: 原值, type:'grey'}` / `{iconClass:'icon-file-grey'}`），不会崩。

**角色/门店元数据的真实存储位置与失效机制**：

| 数据 | 服务端来源 | 客户端位置 | 刷新时机 |
|---|---|---|---|
| `userInfo` | `authService` `publicUser` | `globalData` + `storage` | 登录 + `validateSessionOnLaunch`（每次冷启动） |
| `currentStore` | `authService getStores`/`login` | `globalData` + `storage` | 仅 `store-switch.js:37-38` 手动切换 |
| `supplierInfo` | `authService login` 时一次性返回 | `globalData` + `storage` | **仅登录时**，此后从不刷新 |

**缺口**：管理员在后台改门店名、改供应商联系人/电话后，客户端要**重新登录**才能看到新值；会话 `validate` 只刷新 `userInfo`，不刷新 `currentStore`/`supplierInfo`。对 `supplier-home` 的联系人展示影响可见。

### 1.6 `utils/util.js`（128 行）边界

- `parseDate(date)`：`!date` 直接返 `null`（→ `date === 0` 即 epoch ms 0 被误判为无效）；只按**毫秒**解释数字，**不支持秒级时间戳**，也不识别 `{$date}`/`{$timestamp}`/`{seconds,nanoseconds}` 形态——与 `cloud.js:78-110` 的 `parseDateValue` 能力不对等（后者全支持）。两套解析器并存是维护隐患。
- `formatDate(date, format)`：只认 4 种格式（`YYYY-MM-DD`/`YYYY-MM-DD HH:mm`/`MM-DD HH:mm`/`MM月DD日`），**未知格式静默回退 `YYYY-MM-DD` 且不告警**。
- `getRelativeTime`：`!Number.isFinite(diff)` 有守卫；未来时间（时钟偏移）得负差值 → 归为"刚刚"，不崩；>7 天回退 `MM-DD HH:mm`，**丢年份**。
- `showToast`/`showSuccess`/`showLoading`/`hideLoading`：**无 try/catch**，在 Page 生命周期外调用会抛错。
- `showConfirm`/`showPrompt`：`success(res){ resolve(res.confirm) }`，`fail()` 一律 `resolve(false/null)`——**弹窗 API 本身失败被当成用户取消**（§5 N8）。
- `showPrompt` 用 `editable: true`（需基础库 2.17.1+），项目 `libVersion: 3.17.1`，满足。

### 1.7 `scripts/build-icons.js`（227 行）

纯生成器：`COLORS`（12 色）+ `ICONS`（40 个 24×24 线性 SVG path）+ `VARIANTS`（94 组"图标-颜色"）→ `kebab`/`buildSvg`/`toDataUri`（单引号也编码为 `%27`，保证 `url('...')` 与 `url("...")` 都不截断）→ 生成 `styles/icons.wxss`（94 条 `.icon-{name}-{color}` 规则 + 尺寸工具类）与 `scripts/icons-preview.html`。

**是否会覆盖/误删资源**：**不会**。写入面只有 2 个文件（`styles/icons.wxss`、`scripts/icons-preview.html`），均为 `fs.writeFileSync` 定点覆盖；**无 `rm`、无递归删除、无通配符清理**；`fs.mkdirSync(dirname, {recursive:true})` 只建目录。不触碰 `assets/`、`pages/`、`styles/` 下其他文件。脚本幂等（输出无时间戳/随机量，重复运行字节级一致）。

问题：`COLORS` 是 `app.wxss` CSS 变量的硬编码副本，注释自称"与 app.wxss CSS 变量保持一致"，**双源且需人工同步**；94 组 VARIANTS 中 **44 组从未被任何页面引用**（占 `icons.wxss` 22,001 B / 44%），全部随主包下发。

---

## 2. 页面

10 个页面 × 4 文件 = 40 个文件，共 **2365 行**，全部完整读取。js/wxml 绑定一致性做了脚本化比对：**无任何"wxml 引用了但 js 从未 setData"的字段**（比对中命中的 `active`/`danger`/`tertiary`/`length` 均为 CSS 类名片段或数组方法，非数据字段）。

### 2.1 `pages/index/`（182+109+176+2 行）

首页，tabBar。`onShow` 守卫 → 供应商 `reLaunch supplier-home` → 读 `user`/`currentStore` → **`Promise.all` 并发 4 个云函数**：`getPurchaseOrders`（`{role, storeId, createdBy, pageSize:3}`）、`getReports`（`{role, storeId, reportType:'', relatedDate:''}`）、`dataService getMessages`、`dataService getOrderStats`。

数据流：统计走服务端聚合计数（`statsResult.data`），最近订单只取 3 条、最近报表取 3 条；`unreadMsg` = 消息里未读数；`stats` 4 卡，`super_admin`/`purchaser` 追加"待核销"卡；订单与报表经 `cloud.normalizePurchaseOrder` / `normalizeReport` 归一化后加 `statusText`/`statusType`/`itemCount`/`manualCount`/`typeLabel`/`typeIconClass`。

**无下拉刷新、无分页**（列表固定 3 条）。异常处理：`Promise.all` 外层 `try/catch` → toast + `return`；任一 `code !== 0` → toast + `return`。失败时页面显示 `stats` 全 0 + "暂无采购单" + "暂无报表"（**失败态伪装成空态**）。

导航：`goStore`/`openStoreManage`/`goAccount`/`goMessages`（`switchTab`）/`goStatPage`（tab 页走 `switchTab` 并借 `globalData.pendingListFilter` 传筛选态，因 `switchTab` 不支持 URL 传参——注释明确记录）/`goOrderDetail`/`goReportDetail`/`goAction`/`switchAccount`。

问题：① `:45` 的 `createdBy: user.role === 'chef' ? (user.userId||user.id||user.name) : ''` 是**永不生效的死参数**（`getPurchaseOrders` 对 chef 强制用服务端 `user_id`，对管理员客户端恒传 `''`），且兜底用 `user.name` 冒充 id 属契约错位；② `:160-161` 的 `status === 'abnormal'` 分支为死分支（`stats` 从未生成该 key）；③ `:139-150` 退出登录手工清 5 个 storage 键 + 4 个 globalData 字段，**漏清 `supplierInfo`**（对照 `supplier-home.js:124,128` 都清了），三处清理逻辑三套实现；④ `unreadMsg > 99` 显示 `99+`，但服务端 `getMessages` 只取最新 100 条，未读超过 100 条时红点数错（见 P0-5）。

### 2.2 `pages/login/`（104+66+202+3 行）

登录页。角色四选一（`chef`/`store_manager`/`purchaser`/`supplier`）+ "超级管理员登录"独立表单。`onShow` 每次清空 `username`/`password`（注释：不预填任何账号，避免向使用者公示测试账号）。`login()` → `authService login`（带 `expectedRole`）→ 成功写 `globalData` + 4 个 storage 键 + 清 `account_history` → 供应商 `reLaunch supplier-home`，其余 `switchTab index`。

异常处理分三档：`code===0` 成功；`res.errorType` 存在 → `showModal` "登录服务不可用"；否则 `showToast(res.msg || '账号或密码错误')`。**云函数不可用与账号错误两种失败被明确区分**，是 10 个页面里最完整的一档。

问题：`login.wxss:120-196` 保留 **77 行 `.history-*` 死样式**（账号切换历史已下线，wxml 无对应节点）；`account_history` 只在 `:86` 删除、全项目 0 处写入。

### 2.3 `pages/account/`（71+28+58+5 行）

密码重置页。`onShow` 守卫 → 灌 `userInfo` + 取 `name` 首字做头像 + 清空表单。`submit()` 三道前端校验（完整性、≥6 位、两次一致）→ `authService changePassword` → 失败时 `code !== -401` 才 toast（`-401` 由 `cloud.js` 统一拦截）→ 成功调 `app.clearSession()`（有降级兜底：`typeof` 判断不存在时手工清 5 键）→ `reLaunch login`。

**注**：`account` 的 `json` 标题是"安全设置"，而 `index.wxml:19` 入口文案是"密码设置"、`supplier-home.wxml:75` 是"账号设置"，三处命名不统一（纯文案问题）。`user === null` 时 `wxml:6` 的 `{{user.name}}` 会渲染空白，但 `requireLogin` 已保证有值。

### 2.4 `pages/message/`（83+30+78+2 行）

消息中心，tabBar。**无角色守卫**（只 `requireLogin`）——供应商理论上可达内部 tabBar（数据层仍被服务端挡住）。`onShow` 调 `dataService getMessages`，`time`/`timeAgo` 由 `cloud.formatDateTime` → `util.getRelativeTime` 二次转换；`unreadCount` 在前端数。`readMessage` 先按 `dataService markMessageRead` 标记已读，再按 `type`/`bizId` 前缀路由：`supplier` 角色跳 `supplier-orders`；`abnormal` 跳异常列表；`receive` 或 `bizId` 以 `RCP` 开头跳收货列表；其余跳 `purchase-detail?id=bizId`（注释记录了旧消息缺 `type` 时用前缀兜底）。`markAllRead` 走服务端 `markAllMessagesRead` 后前端全量置已读。

问题：① 无 `loading` 字段 → 加载失败显示"暂无消息"（**失败伪装空态**）；② `:14,37,74` 三处 `const app = getApp()` 未使用；③ 会话过期不跳登录页（P0-2）；④ `timeAgo` 由 `formatDateTime` 丢掉秒后再回解，相对时间偏差最多 59 秒，>7 天丢年份；⑤ `getMessages` 的 `limit(100)` 是滑动窗口，未读超 100 条时红点数错、"全部已读"永久漏标（P0-5）。

### 2.5 `pages/store-switch/`（44+16+71+2 行）

门店切换。`onLoad` 守卫 → 供应商 `reLaunch supplier-home` → `authService getStores` → 灌列表与当前门店 id。`selectStore` 写 `globalData.currentStore` + `storage` + toast + 800ms 后 `navigateBack`。

**语义注意**：服务端 `getStores` 对 `chef`/`store_manager` 强制 `store_id = default_store_id`，所以门店角色**只能看到自己那一家**；`store-switch` 对店长/下单人员几乎无用，只有 `purchaser`/`super_admin` 能真正切换。这与"服务端一律按 `default_store_id` 强制作用域、不信任前端 `currentStore`"的设计一致（`deep-01` 已排除的疑点，本次复核仍然成立）。

问题：`stores` 为空时 wxml 无空态分支（仅 `wx:for`，空列表 = 白屏）；失败时只 toast 不留错误态；`wxss` 有约 28 行死样式（`.page-desc`、`.store-card-header`、`.store-icon`、`.store-content`、`.store-card-info`、`.info-row`、`.info-label` 均无引用）。

### 2.6 `pages/supplier-home/`（134+82+168+4 行）

供应商门户首页。`onShow` 守卫 → `wx.hideHomeButton()`（注释：跳登录页后仍需重登，避免"返回首页"误导）→ **反向守卫**（非供应商 `reLaunch index`）→ 灌 `supplierInfo`/`userInfo` → 并发 `loadStats`（`getSupplierOrders {page:1,pageSize:1}` 只为拿 `statusCounts`）+ `loadNotice`（`dataService getMessages`）+ `requestNewOrderSubscribe`（模板 ID 为空则直接 return）。

异常处理：`loadNotice` 与 `loadStats` 失败均**静默 `return`**（`:54`、`:86`）——首页表现为红点消失 + 统计恒为 0，无任何提示。退出登录清了 `supplierInfo`（与 `index.js` 的漏清形成对照）。

问题：① 两个失败分支静默；② `:57 latest = messages[0]` 假定服务端已倒序（`getMessages` 确实 `orderBy('created_at','desc')`，成立）；③ `NEW_ORDER_TEMPLATE_ID = ''` 与 `dataService` 的 `SUBSCRIBE_TEMPLATE_ID = ''` 两端均为空 → 供应商订阅消息链路整条是死代码，供应商只能主动打开小程序才看得到新订单（R9 P2-5 仍然成立）；④ `:85` 用 `pageSize:1` 只为拿计数，服务端仍全量拉 1000 行明细 + 全量查订单。

### 2.7 `pages/supplier-messages/`（66+27+78+3 行）

供应商消息页（非 tabBar）。守卫后 **非供应商一律 `reLaunch login`**（其余三个供应商页是 `reLaunch index`）——会话有效的内部账号误入本页会被强制登出（R9 P2-1 仍然成立）。数据源同内部消息页：`dataService getMessages`，服务端按 `scope_type='supplier'` + `scope_id=default_supplier_id` 收敛。`readMessage` 一律跳 `supplier-orders`（不分 `type`）。

问题：会话过期不跳登录页（P0-2）；无 `loading`/错误态；服务端 `markMessageRead` 不校验 `scope_type/scope_id`（P0-9）。

### 2.8 `pages/supplier-orders/`（131+49+70+5 行）

供应商订单列表。5 个 tab（`pending`/`confirmed`/`shipped`/`done`/`all`）。`onLoad` 读 `options.status`；`onShow` 反向守卫后 `reload`；`onReachBottom` 分页（`loading || orders.length >= total` 双条件拦截）；`onReachBottomDistance: 50`。

数据源：`getSupplierOrders {confirmStatus, page, pageSize}`——**不传 `supplierId`**，服务端从 `user.default_supplier_id` 派生，并按 `supplier_id + is_manual !== true` 查明细、只嵌入本供应商的明细、按 `HIDDEN_ORDER_STATUS` 隐藏审批前订单。`decorateOrder` 把 `my_confirm_status` 映射成 `canConfirm`/`canShip`。**操作**：`confirmOrder`/`shipOrder` 均二次确认弹窗 → `doAction` 带 `_submitting` 防抖 → `confirmSupplierOrder {orderId, action}`。

问题：① 切 tab 时 `if (this.data.loading) return` 丢弃新请求 → 新标签下短暂显示旧数据与旧计数（R9 P1-3 仍然成立）；② `canConfirm` 只看 `my_confirm_status==='pending'`，与服务端 `CONFIRMABLE_ORDER_STATUS=['approved','report_generated','to_receive']` 不完全对齐（`partial_received` 下单会显示按钮但必被拒）；③ 请求失败时 `length===0 && !loading` 显示"暂无相关订单"（失败伪装空态）；④ 未开 `enablePullDownRefresh`；⑤ `cancelled` 状态不在 TABS 里，只有"全部"能看到已作废单。

### 2.9 `pages/supplier-receipts/`（82+31+16+5 行）

供应商收货记录（对账）。`getSupplierReceipts {page, pageSize}`，服务端按 `supplier_id + is_manual !== true` 过滤 + `count()` 出总数 + `orderBy('created_at','desc')` 数据库级分页 + 批量 join `receipt` 主表与 `abnormal_record`。前端渲染单价快照、金额、实收/订货、异常进度与裁决结果（只读）。

前端自算异常：`abnormal = !is_manual && (receivedQty !== orderQty || payable_flag === false)`，注释说明手动商品 0 价是预期行为（金额走凭证核销回填）不标异常。

问题：① 前端自算异常与服务端 `abnormal_record` 两套口径可能互相打脸——同一行可能同时显示绿色"正常"标签与异常记录文本（R9 P2-6 仍然成立）；② 失败伪装空态；③ `wxml:21` 用 `wx:key="index"`（10 页 12 个 `wx:for` 中唯一的非稳定 key）。

### 2.10 `pages/supplier-prices/`（42+19+17+4 行）

供应商价格页。`getProductPrices {onlyCurrent: true}`，服务端对供应商强制 `query.supplier_id = default_supplier_id` 并**忽略前端传入的 `supplierId`**，非全局角色直接 403。前端只做 `priceText` 格式化。

问题：服务端 `limit(200)`，前端无 `onReachBottom`、无"已加载全部 N 条"提示 → 超 200 条静默截断；无错误态。

### 2.11 供应商端 4 页重点核对结论

| 核对项 | 结论 |
|---|---|
| 是否按 `supplierId`/`openId` 过滤 | **按 `supplierId`，不用 `openId`**。全部由服务端从会话派生 `user.default_supplier_id`；前端 4 页 7 处调用 **0 处** 传 `supplierId`。`getSupplierOrders`/`getSupplierReceipts` 还额外排除手动商品行（`is_manual: _.neq(true)`，注释标为"清单 #24 双保险"） |
| 内部审批通过前不可见 | **已落实**：`HIDDEN_ORDER_STATUS = ['draft','submitted','pending_approval','rejected']`（`getSupplierOrders:12,100`）+ 操作白名单 `CONFIRMABLE_ORDER_STATUS`/`SHIPPABLE_ORDER_STATUS`（`confirmSupplierOrder:12-13`，注释标"S1 拍板"），双重闸门 |
| 内部审批通过前不可操作 | **已落实**：`where({purchase_order_id, order_status: _.in(allowedStatus)}).update()` 条件更新实现原子"检查状态+写入"，防并发作废/收货后仍写入确认 |
| 越权确认他人订单 | **已封**：`confirmSupplierOrder:65-69` 用 `purchase_order_item` 证明"该单确含本供应商商品"，否则 -403 |
| 消息中心通知与已读 | 站内通知在**审核通过后**按供应商分组下推（`notifySuppliersNewOrder`，`scope_type='supplier'`+`scope_id`），发货时向订单所属门店广播；微信订阅消息因两端模板 ID 为空**永不执行**。已读状态用 `read` 全局布尔 + `read_by` 按用户数组双写，`getMessages` 合并后返回，`markMessageRead` 去重 push |

---

## 3. 资源与配置

### 3.1 `assets/`（9 个文件，共 96KB）

| 文件 | 大小 | 引用位置 |
|---|---|---|
| `icons/home.png` / `home-active.png` | 193 B / 210 B | `app.json:46-47` tabBar 首页 |
| `icons/cart.png` / `cart-active.png` | 186 B / 198 B | `app.json:52-53` tabBar 采购 |
| `icons/report.png` / `report-active.png` | 166 B / 187 B | `app.json:58-59` tabBar 报表 |
| `icons/bell.png` / `bell-active.png` | 292 B / 295 B | `app.json:64-65` tabBar 消息；另被 `index.wxml:14` 按 `unreadMsg>0` 动态切换 |
| `icons/login-logo.jpg` | **83,376 B** | `pages/login/login.wxml:4` |

**9 个文件全部被引用，无未使用的死资源，无"引用了但文件不存在"的缺失引用。** tabBar 图标 166–295 B，远低于微信 40KB 上限。

唯一体积问题：`login-logo.jpg` **83,376 B** 是包内唯一图片资产、上传包最大单文件，占整个 455KB 上传包的 **18%**，对一张登录页 logo 严重偏重。`full-scan-08` 与 `deep-07`（R9）两次建议压到 10KB 内，**至今未处理**。

### 3.2 打包体积实测

按 `project.config.json` 的 `packOptions.ignore`（排除 `_tmp_test/`、`seed-data/`、`scripts/`、`cloudfunctions/`、`.md`、`.html` 后缀及 5 个根目录文档）实际计算：**126 个文件、465,733 B（≈455KB）**，远低于 2MB 主包上限，`bigPackageSizeSupport: false` 无需放开。体积前四：`login-logo.jpg` 83,376 B、`styles/icons.wxss` 50,482 B（其中 22,001 B 是无人引用的图标变体）、`purchase-create.js` 19,035 B、`purchase-detail.js` 16,777 B。`docs/` 因全为 `.md` 未被打包。

### 3.3 `.gitignore`（16 行）

内容：`node_modules/`、`_tmp_test/`（注释"含硬编码测试口令，严禁入库"）、`seed-data/`、`.claude/`、`.DS_Store`、`Thumbs.db`。

- **`cloudfunctions/*/node_modules` 已被覆盖**：`node_modules/` 无路径锚点，匹配任意深度（`git check-ignore -v` 实测命中）。
- **未忽略 `.env`**：项目当前**不存在**任何 `.env*` 文件（无实际泄露），但 `.gitignore` 缺 `.env*`、`*.key`、`*.pem`、`*.p12`、`*.pfx` 规则。历史上确实发生过口令入库（`_tmp_test/` 的存在本身即证据），说明缺少这类规则的代价是真实存在的。
- **`seed-data/` 写了 ignore 但 15 个文件仍在 git 追踪**（`git ls-files seed-data` 实测 15 个）——ignore 对已追踪文件无效。`seed-data/README.md` 已移除明文口令、改为安全提示（"新初始口令不再写入仓库"），但 git 历史仍可查到旧口令。
- `project.private.config.json` 未忽略（微信官方建议机器级偏好配置不入库）。
- `.claude/settings.local.json` 与 `seed-data/product-import-template.md` 处于"被忽略且未追踪"状态（`git ls-files -i -o` 实测），行为正确。

---

## 4. 问题清单

级别定义：**高** = 越权/数据泄露/流程中断；**中** = 明确的功能错误或授权缺口，需特定条件触发；**低** = 体验/契约/卫生问题。

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| **高** | `cloudfunctions/dataService/index.js:45-52,644-646` ＋ `utils/cloud.js:67-70` | `requireUser` 返回 `{error:{code:-401,...}}` 嵌套结构，`getMessages`/`markMessageRead`/`markAllMessagesRead` 原样透出；前端只判顶层 `result.code`（嵌套时为 `undefined`）→ `handleSessionExpired` 永不触发 | token 过期后进入 `message`、`supplier-messages`（两页只调 dataService）：不跳登录页，只反复弹"消息加载失败"，用户卡在假登录态 |
| **高** | `cloudfunctions/getSupplierOrders/index.js:127-130` | `{...order, items}` 全量展开 `purchase_order` 主表，无字段白名单 → 供应商拿到 `supplier_confirmations`（**同单所有供应商的确认/发货状态，横向比价**）、`audit_remark`、`audited_by`、`created_by`、`request_id`、`missing_reports` | 任一供应商打开采购订单页；前端只渲染 10 个字段，但原始报文已到设备端 |
| **中** | `cloudfunctions/getSupplierOrders/index.js:117` | `String(b.created_at||'').localeCompare(...)` 内存排序；`created_at` 由 `db.serverDate()` 写入、SDK 回读为 Date 对象，`String(Date)` 得到以星期几开头的本地化字符串 → **按星期几字母序分组**，非按时间倒序 | 供应商订单量 > 1 时顺序错乱；> 20 条时 `onReachBottom` 分页取到错的一页 |
| **中** | `cloudfunctions/getSuppliers/index.js:54,58` | `includeInactive` 有角色闸门，但 `status` 参数**无角色判定**，直接 `query.status = status` | `chef`/`store_manager` 传 `status:0` 即可枚举已停用供应商的 `contact_name`/`contact_phone`/`address`；叠加 `:61` 未校验长度的 `keyword` 正则可精确搜出目标 |
| **中** | `cloudfunctions/authService/index.js:499-504`（注释在 `:470-472`） | `setUserStatus` 停用只清 `session_token_hash`/`session_expires_at`，**不清 `sessions` 数组**；而 `getSessionUser` 只按 `status:1` 前置过滤。注释自称"防止将来重新启用时旧会话复活"，实际没防 | 管理员停用账号 → 7 天内再启用 → 该账号所有旧设备会话立即复活，无需重新登录。`changePassword`/`updateUser`/`resetPassword` 三处都清了 `sessions: []`，唯独此处漏了 |
| **中** | `cloudfunctions/dataService/index.js:649-672`、`697-713` ＋ `pages/message/message.js:27` | `getMessages` `.limit(100)` 是**滑动窗口**：`unreadCount` 只在这 100 条里数，`markAllMessagesRead` 也只遍历同一份 100 条 | 未读累积超 100 条后：红点数字错误、"全部已读"永久漏标、老消息永远残留为未读 |
| **中** | `cloudfunctions/dataService/index.js:729-736` | `getAbnormalRecords` 用 `requireUser(event)` **不传角色白名单**（仅特判 chef 返回空），随后 `if (!GLOBAL_ROLES.includes(role)) query.store_id = auth.user.default_store_id`——供应商的 `default_store_id` 为 `undefined`，`where({store_id: undefined})` 退化为无过滤 | 供应商持有效 token 直调该 action：可读到跨门店的异常记录（含 `description`、`resolution`、`supplierName`、`statusName`，limit 100）。供应商端 4 个页面均未调用此 action，攻击面只在直调 |
| **中** | `utils/cloud.js:243-268` | 前端直调 `wx.cloud.getTempFileURL({fileList})`，无 fileID 路径/前缀校验；fileID 字符串本身即授权 | 任何登录用户（含供应商）只要拿到 fileID 就能换临时链接下载。当前 fileID 基本不泄漏给供应商（手动单不含供应商明细 → 不进 `getSupplierOrders`），属潜在面而非现实面 |
| **中** | `pages/supplier-orders/supplier-orders.js:54-67` | `switchTab` 先 `setData({activeTab})` 再 `reload()`，而 `loadOrders` 顶部 `if (this.data.loading) return` | 请求在途时切 tab：新请求被丢弃，新标签下显示旧数据与旧计数，直到手动再切一次 |
| **低** | `cloudfunctions/confirmSupplierOrder/index.js:12,62` ＋ `pages/supplier-orders/supplier-orders.js:98` | 服务端 `CONFIRMABLE_ORDER_STATUS = ['approved','report_generated','to_receive']` 不含 `partial_received`，前端 `canConfirm` 只看 `my_confirm_status === 'pending'` | 部分收货中的订单若供应商尚未确认，按钮仍显示，点击必被 `:82` 拒（返回"订单不存在或当前状态不可操作"），用户误判为系统故障 |
| **低** | `cloudfunctions/dataService/index.js:675-695` | `markMessageRead` 只做 `belongsToUser`/`belongsToStore` 字面归属判定，不校验 `scope_type`/`scope_id` | 供货商拿到消息 `_id` 即可越权标记内部广播已读（反之亦然）。影响限于读状态，无内容泄露 |
| **低** | `cloudfunctions/authService/index.js:314-331` | `getStores` 只对 `STORE_ROLES` 收敛到 `default_store_id`；supplier 角色不收敛；`includeInactive` 无角色校验 | 供应商持 token 直调可枚举全部门店名与编号（含停用门店）。当前无供应商页面调用 |
| **低** | `pages/message/message.js:12-13`；`pages/supplier-messages/supplier-messages.js:16-18` | `message` 页无角色守卫；`supplier-messages` 非供应商一律 `reLaunch login`，其余三个供应商页是 `reLaunch index` | 会话有效的内部账号误入 `supplier-messages` 会被强制登出；供应商误入 `message` 后点进 `purchase-list`/`report-list` 满屏错误态 |
| **低** | `pages/supplier-orders/supplier-orders.wxml:43`、`supplier-receipts.wxml:25`、`message.wxml:26`、`supplier-messages.wxml:23`、`index.wxml:87,104` | 失败态伪装成空态：`length === 0 && !loading` 在请求失败时同样命中 | 云函数超时/不可用时用户看到"暂无相关订单/收货记录/消息/采购单/报表"，无重试入口，只能退出重进 |
| **低** | 10 个目标页面的 `.json` | 全部未开 `enablePullDownRefresh`（对照 `approval-list`/`purchase-list`/`receive-list`/`report-list`/`report-history` 5 页都开了） | 数据变更（如管理员改量、供应商确认）后只能退出重进才刷新；`supplier-orders`/`supplier-receipts` 只有 `onReachBottom` |
| **低** | `styles/icons.wxss`（94 条规则） | 94 组图标变体中 **44 条（22,001 B，占该文件 44%）无任何页面引用**，全部随主包下发 | 构建期即可检出；`build-icons.js` 的 `VARIANTS` 未做引用收敛 |
| **低** | `pages/index/index.wxss:119-176`；`pages/login/login.wxss:120-196`；`pages/store-switch/store-switch.wxss:3-7,23-36,58-71` | 死样式合计约 163 行：index 的 `.modal-*`（门店新增弹窗已迁至 store-manage）、login 的 `.history-*`（账号切换历史已下线）、store-switch 的 `.store-card-header`/`.store-icon`/`.info-row` 等 | 纯冗余，随包下发 |
| **低** | `assets/icons/login-logo.jpg` ＋ `pages/login/login.wxml:4` | 83,376 B 占上传包 18%，是包内唯一图片资产 | 两次前序审计建议压到 10KB 内，未处理 |
| **低** | `app.js:121`；`pages/index/index.js:150`、`pages/login/login.js:86`、`pages/supplier-home/supplier-home.js:131` | `globalData.companyInfo` 声明后全项目 0 处读写（死字段）；`account_history` 3 处 `removeStorageSync`、0 处写入（死键） | 纯冗余 |
| **低** | `pages/index/index.js:45` | 传 `createdBy` 但 `getPurchaseOrders` 对 chef 强制用服务端 `user_id`、对管理员客户端恒传 `''` → 参数永不生效；且兜底用 `user.name` 冒充 id 属契约错位 | 纯误导代码，无功能影响 |
| **低** | `pages/index/index.js:160-161` | `status === 'abnormal'` 死分支（`stats` 从未生成该 key） | 纯冗余 |
| **低** | `pages/index/index.js:139-150` | 退出登录手工清 5 个 storage 键，漏清 `supplierInfo` 与 `globalData.supplierInfo`（`supplier-home.js:124,128` 都清了）；三处清理逻辑三套实现，`app.clearSession` 已存在却未被复用 | 跨角色切换设备后残留旧供应商档案（影响面极小） |
| **低** | `utils/util.js:91-93,111-113` | `showModal` 的 `fail` 一律 `resolve(false/null)` → 弹窗 API 本身失败被当作用户取消 | 退出登录、确认接单等流程在弹窗失败时静默视为取消，无任何提示 |
| **低** | `utils/util.js:10-16` vs `utils/cloud.js:78-110` | 两套日期解析器并存且能力不对等：`util.parseDate` 只认毫秒数字与字符串，`cloud.parseDateValue` 还认秒级/`{$date}`/`{$timestamp}`/`{seconds,nanoseconds}` | 传秒级时间戳给 `util.formatDate` 会得到 1970 年的日期 |
| **低** | `utils/util.js:27-38` | `formatDate` 未知格式串静默回退 `YYYY-MM-DD`，不告警；`parseDate` 对 `date === 0` 误判为无效 | 传错格式串时静默输出错误格式，难排查 |
| **低** | `utils/meta.js:4,7` | `pending_approval`、`report_generated` 两个状态留在字典里但业务流程中已不使用；`meta.js` 在后端 0 次引用，状态白名单硬编码 ≥6 处后端 + 3 处前端 | 状态机改动极易漏改（枚举双写） |
| **低** | `utils/meta.js:52` | `categoryIconMap` 含 `🍽️`（带变体选择符 U+FE0F），若后端存 `🍽` 则匹配不上 | 商品分类图标空白，静默降级 |
| **低** | `pages/supplier-receipts/supplier-receipts.js:53` vs 服务端 `abnormal_record` | 前端自算异常只判 `receivedQty !== orderQty || payable_flag === false`，服务端数量收齐时也可能因缺价写异常 | 同一行同时显示绿色"正常"标签与异常记录文本，对账时互相打脸 |
| **低** | `pages/supplier-prices/supplier-prices.js:30` | 服务端 `limit(200)`，前端无 `onReachBottom`、无"已加载全部 N 条"提示 | 协议价超 200 条时静默截断 |
| **低** | `pages/supplier-home/supplier-home.js:54,86` | `loadNotice`/`loadStats` 失败静默 `return` | 首页表现为红点消失 + 统计恒为 0，无任何提示 |
| **低** | `pages/supplier-messages/supplier-messages.js:52-55` | 所有带 `bizId` 的消息一律跳 `supplier-orders`，不分 `type` | 与内部消息页按 `type` 精确路由不一致 |
| **低** | `pages/message/message.js:24-25` | `timeAgo` 由 `formatDateTime`（丢秒）再回解 | 相对时间偏差最多 59 秒；>7 天回退 `MM-DD HH:mm` 丢年份 |
| **低** | `pages/store-switch/store-switch.wxml` | `stores` 为空时无空态分支（仅 `wx:for`），失败时只 toast 不留错误态 | 云函数失败或账号无门店时页面白屏 |
| **低** | `scripts/build-icons.js:9-23` | `COLORS` 是 `app.wxss` CSS 变量的硬编码副本，注释自称一致，实为双源 | 改主题需两处同步，极易漂移 |
| **低** | `assets/icons/*.png`（8 个） | 166–295 B，分辨率疑似低于微信建议的 81×81px（未读二进制，无法确认） | 高分屏 tabBar 图标可能发虚 |
| **低** | `.gitignore`（全文件） | 缺 `.env*`/`*.key`/`*.pem`/`*.p12` 规则；`seed-data/` 已 ignore 但 15 个文件仍在追踪；`project.private.config.json` 未忽略 | 下次敏感文件入库将无拦截；历史口令残留 git 历史 |

---

## 5. 与旧报告对比（以当前代码为准独立验证）

### 5.1 仍然成立

| 旧结论 | 出处 | 本次验证 |
|---|---|---|
| P0-1 `getSupplierOrders` 全量展开主表泄漏内部字段 | R9 §0-1、§9 | **仍然成立**（`index.js:127-130` 的 `{...order, items}` 未变） |
| P0-2 `-401` 嵌套结构导致会话过期静默退化 | R9 §0-2、§9 | **仍然成立**，且本次收窄了真实影响面：`supplier-home`/`index` 因同时调用 `getSupplierOrders`/`getPurchaseOrders`（扁平 `-401`）仍能跳登录页，**真正静默的只有 `message` 与 `supplier-messages` 两页**（它们只调 dataService） |
| P1-1 `getSuppliers` 的 `status` 参数绕过角色闸门 | R9 §9 | **仍然成立**（`:54` 只挡 `includeInactive`，`:58` 无条件应用 `status`） |
| P1-2 消息 `limit(100)` 使老消息永远清不掉 | R9 §9 | **仍然成立**（`:666` 仍是 `.limit(100)`，`markAllMessagesRead` 仍遍历同一份） |
| P1-3 `supplier-orders` 切 tab 丢请求 | R9 §9 | **仍然成立**（`:54-67` 逻辑未变） |
| P2-1/P2-2/P2-3/P2-4/P2-5/P2-6/P2-8/P2-9 全部 8 项 | R9 §9 | **仍然成立**，逐项复核无变化 |
| P3-1 `account_history` 死键 + `.history-*` 死样式 | R9 §9 | **仍然成立**（3 处删、0 处写；77 行死样式） |
| P3-4 `index.js` 退出登录漏清 `supplierInfo` | R9 §9 | **仍然成立** |
| P3-7 `supplier-receipts.wxml:21` `wx:key="index"` | R9 §9 | **仍然成立**（10 页 12 个 `wx:for` 中唯一非稳定 key） |
| P3-8 `showConfirm` 失败被当"取消" | R9 §9 | **仍然成立**（`util.js:91-93`） |
| R2 枚举双写 / R3 两个死状态 / R4 图标色板双源 | deep-07 §9 | **仍然成立** |
| R7 `.gitignore` 无 `.env`/密钥规则 | deep-07 §9 | **仍然成立**（但需补充：`node_modules/` 无锚点已覆盖 `cloudfunctions/*/node_modules`，该子项无需修复） |
| R9 `login-logo.jpg` 偏重 | deep-07 §9 | **仍然成立**，实测 83,376 B，占上传包 18%，两次建议未处理 |
| R11 单包 26 页无分包 | deep-07 §9 | **仍然成立**（本次实测上传包 455KB，仍安全） |
| R16 生成物被 git 跟踪无校验 | deep-07 §9 | **仍然成立** |
| 26 页注册 ↔ 实际目录双向一致、tabBar 8 图标全存在、`assets/` 无死资源无缺失引用 | deep-07 §2、full-scan-08 §6.1 | **仍然成立**（脚本比对零差异） |
| 前端 `requireLogin` 强度为 0、真正强度在云函数 `getSessionUser` | deep-01 §1 | **仍然成立** |
| 服务端一律按 `default_store_id` 强制作用域、不信任前端 `currentStore` | deep-01 附 | **仍然成立** |

### 5.2 代码已变化

| 旧结论 | 变化 |
|---|---|
| **P0-3 5 个生产口令明文入库** | **README 侧已修复**：`seed-data/README.md:23` 已改为安全提示（"本文件历史上曾包含明文初始口令…已全部轮换作废…新初始口令不再写入仓库"），`grep "@2026"` 已无命中。**残留风险只剩 git 历史**（README 自己也承认"git 历史中仍可查到旧口令"）。建议级别从"高"下调为"低-中"，实际处置项是 `git rm -r --cached seed-data/` + 评估是否需要重写历史 |
| **P1-4 `canConfirm` 与服务端白名单不一致** | **服务端白名单已扩大**：R9 记载的是 `['submitted','approved']`，当前 `confirmSupplierOrder:12` 为 `['approved','report_generated','to_receive']`、`SHIPPABLE` 追加 `partial_received`（注释标"S1 拍板""S8 追加"）。**结论方向仍成立但触发面收窄**：现在只有 `partial_received` 状态下未确认的订单会出现"按钮显示但必被拒" |
| **R9 待核实 #1：`created_at` 回读形态** | **已可判定为 Date 对象**：`createPurchaseOrder` 用 `db.serverDate()` 写入，`authService` 的 `new Date(session.expires_at).getTime()` 反证 SDK 回读 Date 类型 → `String(Date)` 排序 bug **成立**（本文 §4 第 3 行）。无需再去控制台打印 |
| **R9 待核实 #2：`getTempFileURL` 越权** | 本次确认前端 `cloud.js:243-268` 确实无路径校验，**但现实攻击链不成立**：手动单不含供应商明细 → 不进 `getSupplierOrders` → 供应商拿不到 `verify_voucher_file_ids`。从"潜在高风险"下调为"潜在面" |

### 5.3 旧报告判断有误 / 覆盖不足

| 旧结论 | 修正 |
|---|---|
| deep-01 §1 称"`utils/meta.js` 是角色/门店元数据模块" | **实体不符**：`utils/meta.js` 是纯状态/报表/图标字典，**无缓存无失效逻辑**；角色与门店元数据实际存在 `app.globalData` + `wx.storage`（`userInfo`/`currentStore`/`supplierInfo`），三者**唯一刷新点是登录**，`supplierInfo` 登录后从不刷新。任务书本身沿用了这个错误描述 |
| deep-01 §1 称"`utils/cloud.js` 是元数据归一化" | 方向对但不完整：它同时是**唯一的云函数调用封装**（含 token 自动注入、401 统一拦截、批量取链），文件命名与职责完全错位（`cloud.js`=调用封装、`auth-guard.js`=云函数封装名下的登录守卫、`meta.js`=状态字典） |
| R9 P0-2 把 `supplier-home`、`index` 也列为会话过期静默页 | **判断有误**：这两页同时调用 `getSupplierOrders`/`getPurchaseOrders`/`getOrderStats`，其中 `getSupplierOrders`/`getPurchaseOrders` 返回**扁平** `-401`，`handleSessionExpired` 会触发跳登录页。真正静默的只有 `message` 与 `supplier-messages`（纯 dataService 页面） |
| deep-07 与 full-scan-08 均未覆盖 | **`getAbnormalRecords` 的角色闸门缺失**（本文 §4 第 7 行，新发现 N1）：`requireUser(event)` 不传角色白名单，供应商走 `default_store_id === undefined` 分支退化为无过滤 |
| deep-01 §2 提到"停用→再启用会话复活"为待确认 | **已确认为真实缺陷且更明确**（N2）：`setUserStatus:499-504` 只清旧单会话字段、不清 `sessions` 数组，而 `:470-472` 的注释**明确声称已防复活**——代码与注释自相矛盾。`changePassword`/`updateUser`/`resetPassword` 三处都清了 `sessions: []`，唯独此处漏了 |

---

## 6. 附：本次实测数据

- 上传包（按 `packOptions.ignore` 计算）：**126 文件 / 465,733 B**
- 页面注册 vs 实际：**26 ↔ 26，零差异**
- `styles/icons.wxss`：94 条规则 / 50,020 B，其中 **44 条 / 22,001 B（44%）无人引用**
- `assets/`：9 文件 / 96KB，**引用率 100%**
- 目标 10 页 40 文件合计 **2365 行**，全部完整读取
- 交叉核对云函数 8 个（`authService` 674 行、`dataService` 1681 行、`getSupplierOrders` 137 行、`getSupplierReceipts` 119 行、`confirmSupplierOrder` 124 行、`getPurchaseOrders` 148 行、`getProductPrices` 89 行、`getSuppliers` 96 行）
- `git ls-files seed-data` = **15 个文件仍被追踪**；`git check-ignore` 验证 `node_modules/` 与 `_tmp_test/` 规则生效
- 本仓库无 `.env*` 文件
