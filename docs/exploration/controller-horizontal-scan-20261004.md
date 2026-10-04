# 主控横向扫描记录 3（2026-10-04）

> 目的：子代理被限定在批次边界内，看不到跨目录的机械事实。本文件记录主控自己跑的
> 全项目正则扫描与实测结论。文件级深度分析见同目录 `rescan-20261004-R*.md`。
> 前两份横向记录：`controller-horizontal-scan.md`（2026-10-02，F1 会话过期嵌套结构）、
> `controller-horizontal-scan-20261003.md`（2026-10-03）。
> 方法：全项目 Grep / Read 实测。纪律：只信代码与实测，不接受注释与字面 grep 结论。

- 版本基线：HEAD = `5268379`（`fix(pages): navigation, permissions, loading states and guard rails`）
- 工作区未提交改动：`pages/report-list/report-list.js`、`project.config.json`
- 仓库规模：199 文件 / 20 云函数（约 4800 行 index.js）/ 26 页面 / 16 seed 文件
- 并发说明：本轮共发 10 个子代理，**rpm 上限被打爆导致 5 个中断**（R1/R2/R4/R6/R10），
  后续改为小批量错峰重启。这本身是一条运维结论：**本仓库的全量勘探不宜一次并发超过 4 个子代理。**

---

## 0. 结论速览

| # | 事实 | 判定 |
|---|---|---|
| 1 | 页面注册 vs 磁盘 | ✅ 26 = 26，无差集 |
| 2 | 云函数调用面 vs 部署面 | ✅ 19 = 19，无死函数、无幽灵调用 |
| 3 | dataService action 契约 | ⚠️ 22 case / 前端用 21 → 1 个死 action |
| 4 | authService action 契约 | ⚠️ 14 case / 前端用 13 → 1 个死 action |
| 5 | 幽灵 action（前端传了云端无 case） | ✅ 0 个 |
| 6 | `getSessionUser` 复制规模 | ⚠️ 19 份副本；正本与 18 副本控制流分歧，但经代码验证**正常流程不可触发**（P2） |
| 7 | 前端鉴权注入 | ✅ 已集中化（`utils/cloud.js:57-63`） |
| 8 | 导航闭环 | ✅ 32 处跳转全部命中注册页，无死链 |
| 9 | 跨角色导航守卫 | ✅ 存在且正确 |
| 10 | 裸 `where().get()`（默认 limit 100 截断） | ✅ 0 处显式化；但 🔴 `getPurchaseOrders` 聚合上限算错 |
| 11 | 时区处理一致性 | ✅ 5 处一致，算法与服务器时区无关 |
| 12 | 静态资源引用完整性 | ✅ 9 文件全被引用，无死资源无缺引用 |
| 13 | 明文凭据 | 🔴 **P0**：`seed-data/README.md:25-29` 5 个明文口令（含超管），已 git 追踪，`.gitignore` 未生效 |
| 14 | 种子数据凭据材料 | 🔴 `supplier_test_user.jsonl` 含 salt/hash/迭代次数（同一 git 追踪问题） |
| 15 | 目录级 limit 上限 | ⚠️ `getProducts` / `getProductPrices` `.limit(200)` |

---

## 1. 页面注册完整性

`app.json:3-29` 注册 26 个页面；`pages/` 下 26 个目录。差集为空，无「注册了但文件不存在」
也无「文件存在但未注册」。

tabBar 4 项：`pages/index/index`、`pages/purchase-list/purchase-list`、
`pages/report-list/report-list`、`pages/message/message`。

供应商端 4 页（`supplier-home` / `supplier-orders` / `supplier-receipts` / `supplier-prices` /
`supplier-messages`，共 5 个）不在 tabBar，全部走 `navigateTo`，与 `index` 的 tabBar 并存
——这是**单 tabBar 服务双角色**的设计，代价是供应商用户进入 app 时 tabBar 仍显示内部用户入口。
`index.js:31-32` 会立刻把 supplier 角色 `reLaunch` 走，属于运行时补偿而非配置层隔离。

## 2. 云函数调用面闭合

前端 `callFunction` 调用的函数名全集 = 已部署云函数全集 = 19 个，双向差集均为空。

调用频次（前端侧，含重试路径）：

```
dataService 31   authService 15   getPurchaseOrderDetail 5   createPurchaseOrder 5
getSuppliers 4   getPurchaseOrders 4   updateProductPrice 3   getReports 3
getProducts 3   getSupplierOrders 2   getProductPrices 2
createReceipt / createReceipt / confirmSupplierOrder / getReceipts / getReports /
getReportDetail / getReportFileUrl / generateSummaryReport / importProducts /
getSupplierReceipts  各 1
```

`dataService` 与 `authService` 两个「胖函数」合计承担 46 次调用，是全站数据入口的绝对重心。

## 3. action 契约双边核对

### 3.1 dataService（`cloudfunctions/dataService/index.js:1531-1552`，22 个 case）

| 死 action | 位置 | 说明 |
|---|---|---|
| `regenerateOrderReports` | `dataService/index.js:1548` | 云端实现了订单类报表重算，**前端无任何入口调用** |

对照：`regenerateReceiptReports`（`:1547`）**有**入口，`pages/receive-list/receive-list.js:149`。
即「收货类报表可补生成，订单类报表不可」。这是有意设计还是漏接入口，需业务确认——
收货类之所以可重算，是因为收货是事后操作、原始数据可能被补价/补结算修正；
订单类报表若在下单时一次性落库且不可修正，则确实无需重算入口。

### 3.2 authService（`cloudfunctions/authService/index.js:650-663`，14 个 case）

| 死 action | 位置 | 说明 |
|---|---|---|
| `deleteUser` | `authService/index.js:663` | 云端实现了用户删除，**`user-manage` 页无任何删除入口** |

`pages/user-manage/user-manage.js` 只有 `createUser` / `updateUser` / `resetPassword` /
`setUserStatus`（`:210` `:212` `:132` `:238`）。这意味着**离职账号只能被停用不能删除**，
`app_user` 集合会单调增长。这大概率是有意设计（保留审计痕迹、避免误删），但云端留着一个
前端不可达的 `deleteUser` 等于**留了一个只能靠控制台直调触发的越权面**——任何绕过前端
直调云函数的人都能删用户。建议：要么补前端入口，要么删掉云端 case。

### 3.3 幽灵 action

前端所有 `action: 'xxx'` 传参均能在云端找到对应 case，**0 个幽灵 action**。
这是正向事实——action 拼写漂移（这类系统最常见的静默失败）已被消除。

## 4. 鉴权复制规模 🔴

`getSessionUser(authToken)` 在 20 个云函数目录中被定义 **19 次**：

```
authService:106      dataService:17      createPurchaseOrder:13   createReceipt:13
getPurchaseOrders:11 getPurchaseOrderDetail:12   getReceipts:12   getReports:11
getReportDetail:26   getReportFileUrl:11  getProductPrices:11     getProducts:11
getSuppliers:11      updateProductPrice:12        importProducts:25   generateSummaryReport:12
getSupplierOrders:20 getSupplierReceipts:13      confirmSupplierOrder:22
```

20 个云函数里 19 个各自持有一份鉴权入口副本（`authService` 自身是正本，其余 18 个是副本）。

### 4.1 逐字节一致性实测（本轮新增，主控亲自做掉）

用规范化（去空白、去分号）+ md5 比对全部 19 份函数体：

```
md5              字节   云函数
cc64ceb70d4d     1037   ×17  业务云函数（getProducts / getPurchaseOrders / dataService /
                            createPurchaseOrder / createReceipt / ...）
407a0a3e7f27      941   ×1   importProducts
d06f17dbdbfa      967   ×1   authService（正本）
```

结论：

1. **17 份业务副本完全一致**（同一 md5）。
2. **`importProducts` 与那 17 份只差一行注释**：

   ```diff
   -   const result = await db.collection('app_user')
   +   const result = await db.collection('app_user')
   +   // B12 多设备会话：先查 sessions 数组（每设备一条），兼容旧单会话字段
   ```

   96 字节的 md5 差异**全部来自这行中文注释**（UTF-8 中文 3 字节/字）。
   → `importProducts` 的**鉴权逻辑与其余 17 份完全相同**，B12 多设备改造已正确同步到它，
   只是当时漏贴了注释。这是**注释漂移，不是逻辑漂移**，严重度从「🔴」降为「🟢 可忽略」。
   （`importProducts` 由 `ede7bcb feat(product): add Excel bulk import` 引入，是该注释改造的
   边界参与者，漏贴注释符合"最后一份被改造"的时间特征。）
3. **`authService` 正本与 18 份副本的控制流实质不同** —— 见 4.2。

### 4.2 P1：正本与副本的会话判定分歧（本轮核心发现）

排除干扰后确认 `USER_COLLECTION = 'app_user'`（`authService:8`），与副本硬编码的
`'app_user'` **一致**，不涉及集合名分歧。真正的分歧在**控制流顺序**：

**`authService` 正本（`index.js:113-130`）**：

```js
let user = result.data[0]                       // ① 多设备数组命中
if (!user) {                                    // ② 未命中 → legacy 单字段分支
  user = legacy.data[0]
  if (!user || !user.session_expires_at) return null
  ...                                          // 校验 session_expires_at
  return user                                  // ★ legacy 分支在此直接返回
}
const session = (user.sessions || []).find(...) // ③ 仅多设备命中路径会走到这里
```

**18 份业务副本**：

```js
let user = result.data[0]                       // ① 多设备数组命中
if (!user) {
  user = legacy.data[0]                         // ② legacy 分支，但不返回
}
if (!user) return null
if (Array.isArray(user.sessions) && user.sessions.length) {  // ★ 不分 user 从哪来
  const session = user.sessions.find(...)
  if (!session || ...) return null              // find 失败即拒绝
  return ...
}
// sessions 为空才继续校验 session_expires_at
```

**理论分歧场景**：`session_token_hash` 命中（②），且该 user 的 `sessions` 数组**非空**。

| | 判定 | 依据 |
|---|---|---|
| 正本 | **接受** | ② 分支内只校验 `session_expires_at`，**完全不看 `sessions`** |
| 18 副本 | **拒绝** | 进入 `sessions.length` 分支 → `find(token_hash)` **必然失败**（① 已证明该 token 不在数组里）→ `return null` |

副本比正本**更严格**。

### 4.2.1 该场景经代码验证为**正常流程不可触发**（对上文假设的修正）

初判为 P1，但读完 `authService` 的 login 主体（`:210-230`）后被代码否证，**降级为 P2**：

```js
// :219-228 登录写入是双写
const loginUpdate = {
  // session_token_hash 兼容保留（指向最新会话），旧版云函数未重部署时仍可用
  session_token_hash: hashToken(sessionToken),
  session_expires_at: sessionExpiresAt,
  sessions,                                     // 数组里同样含 sessionToken
  ...
}
```

login **每次同时更新** `session_token_hash` 与 `sessions`（`:215` push 新 token，
`:216` 挤出最旧的保持 ≤5 条）。因此：

- `session_token_hash` 指向的 token **必然存在于** `sessions` 数组中 → 场景①会命中，
  根本走不到分歧点
- `sessions` 中的过期会话在 login 时被 `:214` 的 filter 清除，不会残留为「非空但不含当前 token」
- R8 确认 `updateUser:428-435` 清会话时 `sessions` / `session_token_hash` /
  `session_expires_at` **三个一起清**，不会产生半清状态

**唯一可触发路径**：手工改库或数据迁移脚本写出「`session_token_hash` 与 `sessions` 不同步」
的记录。属数据完整性问题，不是代码缺陷。

**结论修正**：4.2 是**防御性缺陷**而非实际可触发的可用性缺陷。正本与副本的分歧是
「副本更严格」，即使触发也不会造成越权。保留记录的价值在于：一旦未来有人改了
login 的写入逻辑（比如只维护 `sessions`、废弃 `session_token_hash`），
这个分歧会立刻变成真实缺陷——**它是 4.3 结构性风险的活样本**。

**严重度 P2**（原 P1，经代码验证降级）。修复建议不变：对齐副本控制流，成本极低，
且能消除"改动 login 写入逻辑时意外触发"的隐患。

### 4.2.2 login 实现的正面评价（与 4.2 的分歧并存）

`authService:160-230` 的 login 实现质量很高，几处细节值得点名：

- **用户名枚举防护**：`:192` 用户不存在与密码错误返回**同一文案**「账号或密码错误」
- **防爆破并发安全**：`:177-179` 用 `_.inc(1)` 原子自增（避免并发读旧值绕过），
  `:182-190` 用 `where({ login_fail_count: _.gte(5) })` 条件更新锁定——
  **第一个请求清零后其余请求的 where 不再匹配**，不会重复顺延锁定期。注释 `:180-181`
  对此有清晰说明
- **角色混淆防护**：`:195-197` `expectedRole` 不匹配即拒绝，供应商账号无法用内部角色登录
- **会话强度**：`:210` `crypto.randomBytes(32).toString('hex')` = 256 bit 随机
- **停用检查顺序**：`:194` 在密码验证**之后**，不会用「是否停用」泄露账号存在性
- **失败计数与锁定归零**：`:224-225` 登录成功即清零，`login_locked_until: null`

局限（非缺陷，是架构取舍）：防爆破**按用户**而非按 IP/设备——云函数侧没有用调用方 IP。
攻击者可分散到多个用户名做字典爆破（每用户 5 次即锁，N 个用户 = 5N 次尝试）。
无验证码。以当前账号规模可接受，规模上来后需引入 IP 维度限速。

**哈希方案评估**：`:11` `PASSWORD_ITERATIONS = 120000`，SHA-256 + 固定迭代，
与 `seed-data/supplier_test_user.jsonl` 暴露的方案一致（见 §11）。
这是「可行但不现代」——bcrypt/argon2 会自适应内存成本，SHA-256 迭代在 GPU 上仍便宜。
迁移需同时改 `hashPassword`/`verifyPassword` 与 `login`/`changePassword`/`resetPassword`
三处调用点，并处理存量哈希的渐进替换。

**修复建议**：
- 短期：把 18 份副本的控制流对齐正本——legacy 分支命中后立即校验 `session_expires_at` 并
  返回，**不要**再进入 `sessions.length` 分支做二次 `find`。
- 长期：鉴权收敛为单点实现。腾讯云 SCF 支持共享层（Layer），或让业务云函数统一调用
  `authService` 的 `validate` action（该 action 已存在且被 `app.js:52` 使用）。
  收敛后 4.1 的 md5 表应变成**一行**。

### 4.3 结构性风险（不随本次修复消失）

- 鉴权规则任何一处修正都必须同步 19 处，本轮实测证明**漂移已经发生过**（importProducts 注释、
  正本 vs 副本控制流），不是理论风险
- 各副本行号 11~106 不等，无法靠统一 diff 审计，只能靠 md5 规范化比对（即本轮方法）

### 4.4 P0：会话失效返回结构双风格并存（R8 发现，主控已逐条核实）

`utils/cloud.js:68` 的会话过期判定是：

```js
if (result.code === -401) { handleSessionExpired() }
```

它只认**顶层** `code`。但全项目云函数的 -401/-403 返回存在**两种风格并存**：

| 风格 | 云函数 | 位置 | 前端能否识别 |
|---|---|---|---|
| 顶层 `{ code: -401 }` | 17 个独立业务函数 | `getProducts:42` `getSuppliers:42` `getProductPrices:42` `getPurchaseOrders:42` `getPurchaseOrderDetail:43` `getReceipts:43` `getReports:42` `getReportDetail:57` `getReportFileUrl:42` `getSupplierOrders:60` `getSupplierReceipts:44` `confirmSupplierOrder:53` `createPurchaseOrder:100` `createReceipt:163` `updateProductPrice:69` `generateSummaryReport:159` `authService:253,290,316` | ✅ 能跳登录 |
| 嵌套 `{ error: { code: -401 } }` | **`dataService` 全部 22 个 action**（`:47,49` 统一出口） | 商品/供应商/审批/收货/异常/消息/结算等全部写入口 | ❌ **不跳登录** |
| 嵌套 | **`authService` 部分**（`:336,337` 账号管理分支） | `listUsers`/`createUser`/`updateUser`/`resetPassword`/`setUserStatus` | ❌ **不跳登录** |
| 嵌套 | **`importProducts:54,56`** | Excel 导入 | ❌ **不跳登录** |

后果：

1. **`dataService` 的 22 个 action 会话过期时前端毫无感知**——不跳登录，`result.code` 为 `undefined`，
   页面落入各自的失败分支，弹「商品保存失败」「审批提交失败」等业务文案，**真实原因被完全吞掉**。
2. 症状与 4.2 叠加后**按入口分化**：同一个过期会话，点「采购列表」跳登录（顶层），
   点「保存商品」弹业务失败（嵌套）。用户无法理解两者差异，排查者更无法从表象反推根因。
3. `importProducts` 再次出现：它既缺 B12 注释（4.1），又用嵌套返回（4.4），
   **两个维度都是"落后版本"**。这与它由 `ede7bcb` 单独引入的时间点吻合——
   该文件是后续两轮改造（多设备会话、返回结构扁平化）的**漏改点**。
   这是本轮最有力的"漂移已实际发生"证据。

**严重度 P0**：R8 判定它为本轮横向最严重缺陷。理由成立——它同时摧毁
① 会话失效的兜底机制、② 错误文案的真实性、③ 可诊断性。影响面是全部 15 个写入口 +
首页 2 个 dataService 调用。

**修复建议**（三选一，按成本升序）：
- ① 改前端一行：`utils/cloud.js:68` 改为
  `if (result.code === -401 || (result.error && result.error.code === -401))`。
  成本最低，立刻恢复兜底，但前端需同时兼容两种风格。
- ② 改云端统一为顶层：`dataService:47,49` 与 `authService:336,337`、`importProducts:54,56`
  共 5 处改为 `{ code, msg }` 顶层风格，与其余 17 个函数对齐。改动最小且消除根因。
- ③ 抽统一的错误包装器供 20 个云函数共用（需配合 4.3 的鉴权收敛一起做）。

推荐 **②**：5 处改动，根因消除，且与既有多数派风格一致。

## 5. 前端鉴权已集中化 ✅

`utils/cloud.js:57-63`：

```js
if (! requestData.authToken) {
  const app = getApp()
  requestData.authToken = app.globalData.authToken || wx.getStorageSync('authToken') || ''
}
```

每个业务请求统一注入 token，登录是唯一不带 token 的调用，天然符合。
401 处理集中在 `:68-70` → `handleSessionExpired()`（`:35-47`），
带 1.5s 防抖避免并发请求重复跳转。**一处拦截覆盖所有页面**，这是正面设计。

`utils/auth-guard.js:12` 提供页面级 `requireLogin()` 守卫，与云端 401 形成双层。

## 6. 导航闭环

全项目 32 处 `navigateTo` / `redirectTo` / `reLaunch` / `switchTab` 目标**全部命中**
`app.json` 注册页面，无死链。

### 6.1 双角色分流互斥性

`pages/index/index.js:31-32`：

```js
if (user && user.role === 'supplier') {
  wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
```

`pages/supplier-home/supplier-home.js:36`：`wx.reLaunch({ url: '/pages/index/index' })`

两者以 `role === 'supplier'` 为判断轴，条件互补，**不会无限 reLaunch 循环**。
分流正确性依赖 `globalData.userInfo.role` 这个字段在所有入口一致可用。

### 6.2 跨角色导航守卫存在 ✅

`pages/message/message.js:51-56`：内部消息页点击消息时，
**先判 `role === 'supplier'` 才跳 `/pages/supplier-orders/`**，内部用户走
`abnormal-list` / `receive-list` / `purchase-detail` 分支。守卫存在且顺序正确
（先判角色，再判消息类型）。

### 6.3 落点正确性

`pages/login/login.js:94` 供应商登录 → `reLaunch supplier-home`；
`:101` 内部用户登录 → `switchTab index`。分流正确。
`pages/store-switch/store-switch.js:15` 对 supplier 角色跳 supplier-home。

## 7. limit 防御：显式化已到位，但聚合上限算错 ⚠️

全项目 **0 处裸 `where().get()`**。所有集合查询显式带 `.limit()`：
`.limit(1)` 用于单取，`.limit(1000)` 用于聚合分页（大量出现于 dataService / createReceipt /
getReportDetail 的分块聚合），`.limit(100)` 用于批量 join（`_.in(idChunk)` 模式）。
`importProducts:120` 用 `skip(offset).limit(BATCH)` 做批量读取，是正确姿势。

这说明前两轮探索发现的「腾讯云默认 limit 100 导致静默截断」问题已被**系统性修复**——
防御意识到位。但**R3 发现上限本身算错了**，防御是形式正确、数值不足：

### 🔴 P0：`getPurchaseOrders` 明细聚合上限溢出（R3 发现）

`getPurchaseOrders:119-124`：每块取 20 个订单，明细查询 `.limit(1000)`。
而单个采购单明细上限是 100 行（`createPurchaseOrder:210`）。

```
20 单/块 × 100 行/单 = 2000 > 1000（实际上限）
```

**门槛极低**：默认 `pageSize` 就是 20，只要平均 **≥51 行/单**就会静默截断——
不需要极端数据，正常大宗采购单就能触发。

症状：采购列表页商品数显示 0，审批页商品 tag 整行消失，但订单本身存在、金额正常。
比旧文档 H3 记录的同类问题**门槛低一个量级**。

修复方向：明细聚合应按块内订单数动态计算（`Math.min(1000, 剩余)`），或按订单逐个查明细，
或把 `.limit(1000)` 提高到上限并校验实际取回条数是否等于预期总数。

### ⚠️ 剩余截断风险

| 位置 | limit | 风险 |
|---|---|---|
| `getPurchaseOrders:119-124` | `.limit(1000)` | 🔴 **P0**，20×100 溢出，见上 |
| `getProducts/index.js:53` | `.limit(200)` | 商品目录 > 200 条时静默截断，且 `includeInactive: true` 会放大结果集 |
| `getProductPrices/index.js:60` | `.limit(200)` | 供应商报价 > 200 条时截断；这是「供应商×商品」笛卡尔积，增长最快 |

`getProductPrices` 的 200 上限值得警惕：一条报价 = 一个供应商 × 一个商品，
10 家供应商 × 20 个商品就会顶破。

## 8. 时区一致性 ✅

5 处统一写法：

```js
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
```

| 位置 | 用途 |
|---|---|
| `createPurchaseOrder/index.js:119` | 下单日 |
| `createReceipt/index.js:318` | 收货日默认值 |
| `createReceipt/index.js:435` | 补录判定（`receiptDate < today`） |
| `updateProductPrice/index.js:81` | 调价生效日（S5 拍板：只允许当天生效） |

算法正确性：`Date.now()` 与 `toISOString()` 均以 UTC 表示，**与服务器本地时区无关**，
`+8h` 得到的是北京时间日期。即使 SCF 实例时区变化也不受影响。

风险：东八区被硬编码。若业务扩展到非 UTC+8 门店（当前无此场景），5 处需同步修改。
前端侧 `purchase-create:47` 用 `+86400000` 算「明天」，不涉及时区，无冲突。

## 9. 静态资源引用完整性 ✅

`assets/icons/` 下 9 个文件，**全部被引用，无死资源、无缺失引用**：

- `app.json:46-65` tabBar 8 个（home / home-active / cart / cart-active /
  report / report-active / bell / bell-active）
- `pages/login/login.wxml:4` → `login-logo.jpg`

唯一动态引用：`pages/index/index.wxml:14`
`src="/assets/icons/{{unreadMsg > 0 ? 'bell-active' : 'bell'}}.png"` —— 未读红点态切换。

`full-scan-08` §6.1 的结论在本轮复测后仍然成立（行号 `:351`）。

## 10. 凭据扫描：发现 P0 明文口令，且本轮主控扫描漏掉了它 🔴

### 10.1 🔴 P0：`seed-data/README.md` 内含 5 个明文初始口令，且已被 git 追踪

`seed-data/README.md:23-29`：

| 角色 | 账号 | 初始密码 |
|---|---|---|
| 超级管理员 | `admin` | `Admin@2026` |
| 下单人员 | `chef` | `Chef@2026` |
| 店长 | `manager` | `Manager@2026` |
| 管理员 | `admin_user` | `Purchaser@2026` |
| 供货商 | `supplier_test` | `Supplier@2026` |

实测确认三件事：

1. **口令明文**：`README.md:25-29` 直接写在 Markdown 表格里，无脱敏
2. **已被 git 追踪**：`git ls-files seed-data/` 返回 **15 个文件全部在追踪列表**
   （含 `README.md` 与 `supplier_test_user.jsonl`）
3. **`.gitignore` 规则从未生效**：`.gitignore:9` 确实写了 `seed-data/`（注释
   「本地种子/敏感数据」），但 `git check-ignore -v seed-data/README.md` 返回
   **NOT IGNORED**

原因是一个经典 git 陷阱：**`.gitignore` 对已追踪文件无效**。这 15 个文件在
`seed-data/` 这条 ignore 规则被添加**之前**就已入库，规则添加后对它们不起作用，
只对新增文件生效。结果就是仓库呈现出"看起来已经把种子数据忽略了，实际上一个都没忽略"
的假象——维护者大概率以为它被忽略了。

**风险实质**：

- `admin / Admin@2026` 是**超级管理员**。README 明确建议把这批种子「导入到已经创建好的集合」，
  若任一次导入发生在生产或类生产环境，这些账号即成为**已知凭据的常驻后门**
- 口令模式可预测（`Xxx@2026`，Xxx = 角色英文名首字母大写），
  攻击者知道 `admin` 是超管后，字典空间极小
- git 历史中永久存在。删除文件、重加 ignore 都不够，需 `git filter-repo` 重写历史
  （这会改写全部 commit hash，属破坏性操作，需团队决策）

**严重度 P0**。R9 报告指出前作（10-02 横向记录）已提出过修复方案但**未执行**——
这意味着这是**已知的、被记录的、跨三轮勘探仍未处理**的问题。

### 10.2 本轮主控扫描的方法论缺陷（自我记录）

本轮主控初次的凭据扫描用的是：

```
grep `password\s*[:=]\s*['"]` / `123456` / `admin123` / `test123`
```

结论是"业务代码与前端页面 0 处明文密码"——**这个结论是错的，扫描漏掉了全部 5 个口令**。

漏掉的原因有两层，都值得记入方法论：

1. **扫描面太窄**：只扫了代码语法模式（`password: 'xxx'`），
   而真实凭据藏在 **Markdown 文档的表格里**，是自然语言而非代码
2. **字典太窄**：`123456`/`admin123`/`test123` 是"最烂的弱口令"，
   而实际口令是 `Admin@2026` 这种"带大小写+符号+年份"的格式——
   **看起来是强口令，实际是文档里公开的固定值**

**结论**：凭据扫描必须同时扫 ① 代码字面量 ② 文档/配置里的自然语言表格 ③ 文件名本身，
且不能只靠"烂口令字典"——**凡是出现在仓库里的、格式规整的、可枚举的口令模式，
都应视为已泄露**，无论它强度看起来如何。

本轮是 R9 子代理发现这个 P0、主控核实的，不是主控自己扫出来的。
记录在这里以免下一轮重复同样的漏扫。

### 10.3 正向事实（保留）

**业务代码与前端页面确实 0 处明文密码**——这部分结论成立。
唯一误命中是旧文档里举的 `PO123456` 订单号示例。

## 11. 种子数据凭据材料 🔴

`seed-data/supplier_test_user.jsonl` 全文 1 行，内容：

```json
{"user_id":"U004","username":"supplier_test","name":"绿源蔬菜批发-刘师傅",
 "mobile":"13800010001","role":"supplier","default_supplier_id":"SUP001",
 "password_salt":"62fd5e6ac754c5d7f1652b4fbfa62129",
 "password_hash":"d9d2c5499b7cd16db4364e466c15c8ad45d529b46abaa853e7aa633c4b446de3",
 "password_iterations":120000, "created_at":"2026-08-14 09:00:00"}
```

判定：存的是**哈希而非明文**（正向）。但三项材料齐全使威胁模型恶化：

1. `password_hash` 为 64 位 hex = SHA-256，**非加盐自适应算法**（bcrypt/argon2 会直接带
   参数并把 salt 编进输出）
2. `password_salt` **明文可见** → 攻击者无需猜测盐，只需为这一个盐生成一张字典/彩虹表
3. `password_iterations: 120000` 参数公开 → 攻击者可精确复现哈希链

`120000` 次 SHA-256 单次尝试约毫秒级，GPU 上可做到每秒千万次。对一个测试账号
（大概率是弱密码如 `123456` / `supplier123` / `password`），离线爆破成本是分钟级。

**风险实质**：这不是「哈希被破解」，而是「测试账号一旦导入生产即成为常驻后门」。
`username: supplier_test` + `role: supplier` + `status: 1` + `default_supplier_id: SUP001`
构成一个完整可用的供应商身份。攻击路径：爆破 → 登录 → 进入供应商端 → 读取
`SUP001` 的订单/报价/收货数据。

建议：① 种子文件里的凭据材料改为占位符或移出仓库；② 生产环境禁止导入该文件；
③ 中期把哈希方案从 SHA-256+固定迭代 迁移到 bcrypt/argon2（这会影响
`authService` 的 `login` / `changePassword` / `resetPassword` 三处，需整体评估）。

**与 §10.1 的叠加效应**：该 `.jsonl` 同样在 §10.1 确认的 git 追踪问题范围内
（`git ls-files seed-data/` 的 15 个文件之一）。更关键的是，`supplier_test` 的
**明文口令 `Supplier@2026` 就写在同一目录的 `README.md:29`**——攻击者根本不需要爆破，
直接拿明文口令就能验证这里的哈希。

两节的问题叠加后，`supplier_test_user.jsonl` 的哈希保护**完全失效**：
salt 公开 + 迭代次数公开 + 明文明文口令公开 = 三重材料齐备。
这也意味着 §10.1 的 5 个明文口令不只是「文档泄露」，它们**同时把整个种子数据的
哈希方案变成了可验证的已知答案**。

---

## 12. 本轮方法论与限制

- 本文件只记录**跨批次机械事实**（正则可判定的），不做单文件业务推理
- 单文件深度分析由 `rescan-20261004-R*.md` 承担，两者互补不重叠
- 未做：19 份 `getSessionUser` 的逐字节一致性比对（留给 R1）；
  22 个 dataService action 的权限矩阵（留给 R2）；
  各页面前端解构路径 vs 云函数返回路径的逐条契约比对（留给 R3/R7/R8/R9）
- 未做：任何写操作、任何云函数调用、任何语法检查（本轮全部为只读扫描）

## 13. 与历史横向记录的差异

| 条目 | 10-02 记录 | 10-03 记录 | 本轮（10-04） |
|---|---|---|---|
| F1 会话过期嵌套结构 | 提出 | 持续跟踪 | `utils/cloud.js:68-70` 已收敛为单一 401 拦截 |
| 默认 limit 100 截断 | 风险提出 | 多处命中 | **已系统性修复，0 处裸 `where().get()`** |
| 幽灵 action | 未查 | 未查 | **0 个**（本轮首次双边核对） |
| 死 action | 未查 | 未查 | **2 个**（`regenerateOrderReports` / `deleteUser`） |
| 明文凭据 | 未查 | 未查 | 业务代码 0 处；种子 1 处含完整凭据材料 |

## 14. 跨批次更正与确认（本轮子代理回收的横向事实）

### 14.1 🔴 更正旧文档事实错误：报表类型全集是 8 类，不是 6 类

R5 独立复核 `collection('report_file').add`，精确 **14 处落库点**（2+4+7+1 分布于
`createPurchaseOrder` / `createReceipt` / `dataService` / `generateSummaryReport`），
覆盖 **8 种 `report_type`**。

旧文档（batch1 / full-scan-03）所称"6 类报表落库"**仅作为单据链路成立**，全集实为 8 类。
另：汇总类 `report_id` 前缀实为 `RPT_DS_` / `RPT_MS_`，旧文档误记 `RPT_DSRPT_`。

### 14.2 ✅ 全项目无任何 `report_file` 删除调用

这终结了 full-scan-06 §M1 提出的"删除死循环"担忧——**删除的触发条件在代码里根本不存在**。
`report_file` 是只增集合，长期增长但无孤儿回收机制（见 14.3）。

### 14.3 ⚠️ `missing_price` 异常无法靠补字典修复

full-scan-08 §待核实-6 比原设想更严重：**`receipt_item` 集合根本没有 `is_missing_price` 字段**。
commit `3558678` 加的 `missing_price` 字典是"加字典但无上游字段"，
修复必须 `join abnormal_record` 而非在 `receipt_item` 上补字段。

### 14.4 ✅ 两处未提交改动定性与结案

- **`pages/report-list/report-list.js`**：3 hunk / 4 行，纯语法归一化（`?.` → `&&`），
  四分支逐值等价。**不修复任何缺陷、不引入任何风险**。改动后全前端已无可选链语法。
  → 结论：安全的清理，可直接提交。
- **`project.config.json`**：包体积优化，与报表域无关。

### 14.5 ⚠️ 报表域两个死标识

- `priceReportsSkipped`：前端 0 消费，**死字段**
- `getReportDetail:82` 取了 `source_order_id` 但 `:131-132` / `:162-163` 的聚合完全不用它
  → 读取侧粒度与生成侧冲突，详情页当日多单合并而 CSV 只有 1 单

### 14.6 ✅ `getReportFileUrl` 越权不成立

三道防线叠加：`:46` 必须命中 `report_file.file_url` → `:49-54` 按角色/作用域二次校验 →
`:231` fileID 含 24bit 随机不可枚举。

唯一缺口：`:50` `scope_id !== default_store_id` 为**非严格比较**，两侧同为假值时会放行。
今日 14 处落库均写 `scope_id`，故**当前不可达**，属潜隐风险。`getReportDetail:75` 同款写法。

### 14.7 更正本轮任务背景的一处描述错误

本轮派单时描述"前端在 report-list 调 dataService 现算实时报表"——**与代码不符**。
`report-list` 全程只调 `getReports` / `generateSummaryReport`，
实时报表路径实际在供应商门户。以代码为准。

## 15. 多子代理独立收敛的缺陷（本轮最强证据）

本轮把 20 个云函数与 26 个页面切成 10 个互不重叠的批次，各子代理**只在边界内工作、
看不到彼此的发现**。有 3 个缺陷被 **≥3 个子代理独立发现**，且各自给的是不同侧的证据。
这种独立收敛的强度远高于单点报告——它意味着该缺陷在代码里有多条互不相干的可观察路径。

### 15.1 🔴 `receipt_abnormal` 永久死角（4 次独立发现）

| 子代理 | 视角 | 发现的证据 |
|---|---|---|
| R3 采购链路 | 采购单状态机 | `createReceipt:392` 作废白名单不含 `receipt_abnormal`、`dataService:1294` 拒绝作废；`:386` 注释仍写「允许继续补收」；S8 引入 `partial_received` 后该路径成为常规 |
| R8 管理后台 | 停用门店 | `authService:630-638` 在途单白名单漏 `receipt_abnormal`（对比 `dataService:1294` 包含它） |
| R4 收货异常 | 异常生成与闭环 | `createReceipt:228,392` 不能补收 + `dataService:1294` 不能作废 → **全库无写出口** |
| R7 前端 8 页 | 异常动作回写 | 三个异常动作 `ds:744/768/815` **都不回写 `purchase_order`**，`settleReceipt` 也只改 `receipt_item` → 最后一批带异常的收货把订单打成 `receipt_abnormal` 后**永久卡死**，异常全关闭了订单状态也毫无变化 |

三方合起来构成完整判定：**`receipt_abnormal` 是一个没有任何出口的状态**。
进了这个状态，既不能补收、也不能作废，只能永久挂起。
叠加停用门店路径后，后果是**门店可以被停用后彻底锁死**（在途单永远在途）。

**严重度 P0**。修复必须三处同时改（补收白名单、作废白名单、停用门店在途单白名单），
改一处只解决一条路径。

### 15.2 🔴 `settleReceipt` 重复出账（资金风险，R4 独立发现）

`dataService:898-926`：**不过滤"已出账行"**、**不要求该单曾真有过 `pay_received` 裁决**、
不打 `superseded` 标记。

后果是**供应商同一批货能收到两张同额账单**。这是本轮唯一直接指向资金重复支出的缺陷。
结合 §15.4 的 `repriceReceipt` 死锁，补账链路的幂等性整体缺失。

**严重度 P0**。

### 15.3 ⚠️ 停用门店断链（3 次发现，各断一处）

| 子代理 | 断点 |
|---|---|
| R8 | `authService:630-638` 漏 `receipt_abnormal`；停用后该店 chef/manager 因 `login:206-207` 找不到 `status:1` 门店**集体登录失败且无预告** |
| R4 | `git show 3558678 -- createReceipt` 为**空** —— commit `3558678` 声称支持 inactive store，但**收货侧 0 行改动**，只改了读取侧（`authService.getStores` 加 `includeInactive`） |
| R3 | 写侧要求 `store.status:1`（`createPurchaseOrder:164,198`、`createReceipt:178,188`），**读侧全不检查** → 门店停用后在途订单永久卡死 |

结论：commit `3558678` 的 "inactive store support" **只改了读取侧一半**，
写侧拦截与在途单收敛都没做。三个子代理各自从不同角度撞到了同一处半完成的功能。

### 15.4 ⚠️ `dataService` 嵌套返回（2 次发现 + 主控核实）

R8 从管理后台写入口角度发现（22 处），R9 从供应商消息页角度发现
（`getMessages`/`markMessageRead`/`markAllMessagesRead` 三处导致会话过期不跳登录、
`supplier-home:54,86` 连 toast 都没有），主控逐条 grep 核实并画出全量矩阵（见 §4.4）。

### 15.5 方法论结论

10 个批次中 5 个被 rate limit 打断，实际交付 6 份深度报告 + 主控横向扫描 +
主控亲自做的 R1 核心。**在这种不完整覆盖下仍能出现 3 次独立收敛**，
说明这些缺陷的密度很高——**不是勘探方法找出来的，是代码里本来就有多条可观察路径**。

反向教训：本轮的 3 次收敛全部集中在**跨模块的状态机与白名单**（`receipt_abnormal`、
停用门店、嵌套返回），说明**单批次勘探看不到"某状态在 A 处写入、在 B 处无人消费"**这类问题。
下一轮若要继续，价值最高的做法不是再切批次，而是**沿状态机做纵向追踪**——
从每个状态的写入点追到所有应该消费它的读取点，逐状态核对闭环。

## 16. 前端契约与交互质量（R7 的量化结果）

### 16.1 ✅ 前后端契约 0 处致命（修正 F1/H10 的历史预期）

R7 对采购/收货 8 页的 **33 个 `callFunction` 点逐一比对**前端解构路径 vs 云函数返回路径：

- **0 处**"前端取到 undefined 导致字段缺失"
- **3 处误导**、**6 处无用负载**
- `getPurchaseOrders` / `getPurchaseOrderDetail` / `getReceipts` / `createReceipt` /
  `createPurchaseOrder` **全部单层 `data`，未发现 F1/H10 型双层包裹**

这对历史文档是个重要修正：10-02 横向记录提出的 **F1「会话过期嵌套结构问题」** 与
H10 双层包裹，在采购/收货链路的 5 个核心云函数里**并不存在**。嵌套问题**只存在于
`dataService` 与 `authService` 的部分分支**（见 §4.4 的全量矩阵），不是全项目通病。
把 F1 描述成普遍现象是过度概括——本轮的矩阵给出了精确边界。

### 16.2 ✅ 两例旧结论被代码降级（batch2 头号 🔴 是假警报）

| 旧结论 | 复核结果 |
|---|---|
| `receive-verify:211-212` 硬编码 `priceSnapshot:0`/`payableFlag:true` 会写入脏数据（batch2 头号 🔴） | **降级**：`createReceipt:350-351`、`:361-368` **恒覆盖**这两个入参 → 不产生脏数据，只是无用负载 |
| `createdBy` 三处把显示名当 ID 下推（`purchase-list:64`、`receive-list:23`、`purchase-create:329`） | **降级**：`createPurchaseOrder:291-296` 完全忽略入参、`getPurchaseOrders:51-55` 忽略 `event.createdBy` → 全是无害死参数 |

同型还有一个：`&storeId=` 在 `purchase-detail:381`、`purchase-list:145` 传，
`receive-list:114` 不传，而 `receive-verify:58` 从不读它 → 死查询参数，不一致但无害。

**方法论价值**：这两例说明「前端传了看起来可疑的参数」≠「产生数据错误」。
必须追到云端是否真的消费该入参才能定级。前几轮把它们记为 🔴 属于**证据不足就升级**。

### 16.3 ⚠️ 隐蔽 bug：弹窗调用失败 = 静默提交业务裁决

`util.js:91-94` 的 `showConfirm` 在 `wx.showModal` **fail 时 `resolve(false)`**。
`abnormal-list.js:78-79` 把「取消」当作业务裁决 `paymentDecision:'reject'` 提交。

后果链：弹窗调用失败（用户关掉、系统异常）→ `resolve(false)` → 被当成「用户选了不可付款」
→ **静默提交「维持不可付款」的业务裁决**，用户还想反悔时收到「已标记为已解决」。

同页 `promptResolution:60-69` **无 `fail` 回调** → Promise 永挂起、无 toast、无 UI 复位。
全页 3 个写操作**零防抖**。

这是一个「库函数默认值 × 业务语义」耦合产生的缺陷——`showConfirm` 的 `resolve(false)`
对「确认/取消」二值语义是对的，但 `abnormal-list` 把 `false` 解释成了**第三种业务含义**。

### 16.4 ⚠️ 防抖与错误态：13 个写操作只有 1 个达标

R7 对采购/收货 8 页的 13 个写操作做了实测矩阵，标准是三条：
**置位早 + `finally` 复位 + UI 锁**。

- **仅 `receive-verify.submitReceipt` 一个满足全部三条**
- **8 处**存在「抛错后 `_submitting` 永久为 `true`」风险 → 按钮永久置灰
- **9 处 `showLoading` 未配对** `hideLoading` → 全屏遮罩卡住

这与 §4.4 叠加后更糟：抛错后如果是 `dataService` 的嵌套返回，前端既不跳登录、
也不弹真实文案，按钮还永久置灰——用户只能杀进程重进。

### 16.5 导航闭环：与主控 §6 独立一致

R7 在其边界内独立核对 10 个跳转目标 + 参数名，结论是**完全闭合**：
10 个目标全部在 `app.json` 注册，参数名逐对一致（`options.orderId||options.id` /
`options.id||options.orderId` 双向兼容），tab 页正确用 `switchTab`（`receive-verify:259`），
0 处 `navigateTo` 指向 tab 页。

这与主控 §6 的全项目 32 处扫描结论独立一致——**两边各自核对、结论相同**。

### 16.6 两个 commit 的修复兑现度

| commit | 声明 | 实测 |
|---|---|---|
| `5268379` | navigation / permissions / loading states / guard rails 8 项 | **8/8 落地、0 回归**（R7 边界内）；但**完全没碰**防抖/`finally`、按钮 UI 锁、角色门禁、自审前端提示（`a83f605` 新增的云端限制未同步到前端）、门店切换误伤 |
| `3558678` | 见 §15.3 | inactive store **只改读取侧**，收货侧 0 行改动 |

commit `5268379` 的兑现度很高，但它的边界外（防抖、角色门禁同步）**是本轮 P1 的主要来源**——
说明"修了声明里的事"和"修了该修的同类问题"是两回事。

### 16.7 门店切换的角色盲区

`createPurchaseOrder:160-164`、`getPurchaseOrders:52-59` **强制用 `default_store_id`**，
而 `purchase-create.js:324` 下推的是**切换后的值** → 结果对 `chef`/`store_manager` 是
「顶栏门店变了、实际数据还是默认店」，切过店再建单**必 403 且前端无任何预告**。

这与 §16.5 的"导航完全闭合"并存：**页面能跳过去，但操作会失败**。
UI 层正确、数据层错位，是最难自证的一类缺陷——用户只看到报错，看不到自己做了什么。

## 17. 零价漏账的完整根因链（R6 与 R4 交叉验证）

这是本轮唯一被**逐环节追通**的资金问题，值得单列。

### 17.1 🔴 P0：无供应商商品 → 0 价 → 完全不追踪

环节逐条给出：

1. `importProducts:164-168`：供应商未填或未匹配时**仍插入** `default_supplier_id:''`
   → 这是静默路径的主要来源
2. `createPurchaseOrder:250`：取 `product.default_supplier_id` 下单，**全程不查 supplier 状态**
   → 停用供应商仍可下单收货进报表
3. `createReceipt:350`：`supplierId` 为空则**不查价**，取价结果 0
4. `createReceipt:366`：`missing_price` 条件**要求 `supplierId` 非空** → 空供应商时**不标异常**

后果：该行**不进带价账单、不生成 abnormal_record、不发任何消息**，
仅在报表里留一行「验收状态正常 / 异常类型空 / 是否可付款否」，
且日/月汇总**按 0.00 计入 `item_count`**。

**对照**：有供应商但缺价时路径是通的——生成 `abnormal_record` + 可 `repriceReceipt` 补账。
**同一种"没价"，有无 `supplierId` 就走两条完全不同的可见性路径。**

R4 与 R6 独立发现，证据链互补。

### 17.2 🔴 P0：取价查询的两个独立缺陷

| 位置 | 缺陷 |
|---|---|
| `createReceipt:342-346` | 取价 `where` **不含 `supplier_id`**，且 `limit(100)` |
| `dataService:1053-1059` | 同款 |

多供应商报价超 100 行即截断 → 落 **0 价**被误标缺价，同时**从带价账单剔除真实应付**。

这一条比 §7 记录的 `getProductPrices:60` `.limit(200)` 更严重——
那处截断只影响列表展示，这处截断**直接影响应付金额**。
`supplier_product_price` 是「供应商 × 商品」笛卡尔积，正是全库增长最快的集合。

### 17.3 `getProductPrices:84` 的空结果歧义

空结果返回 `{ code:0, data:[] }`，**不区分「无价 / 请求失败 / 无权限」**。
调用方无法据此判断是数据不存在还是权限问题，只能一律按 0 处理。
这是 §17.1 静默漏账得以成立的上游条件。

## 18. 公式注入：路径 A 可利用，路径 B 当前不可利用

### 18.1 🔴 路径 A 可利用，且影响全部 8 种报表

`createPurchaseOrder:42-47` 的 `csvField` 只拦 `^[=+\-@]`，**不拦 `\t\r\n`**；
`items[].remark`（`:232-254`）**零校验**，经 `:336` 落库、`:359`/`:407` 写报表。

R6 穷举确认：**全仓库仅 4 处 CSV sink**，路径 A 与路径 B **汇入同一批 8 种 `report_type`**，
全经同一份 `csvField`。任意 `chef` 可注入公式到门店下单报表与供应商订货汇总。

### 18.2 ✅ 路径 B 当前不可利用（但防线是隐式的）

`importProducts:63` 的 `cellText` 用 `String(v).trim()`，**在源头闭合了 `\t\r\n` 前导空白绕过**。

R6 诚实指出：这条防线是 `trim()` 的**隐式副作用**，**没有注释声明意图**。
若未来有人重构掉 `trim()`（比如为了保留前导空白的 Excel 语义），注入立即打开。

依赖侧：`xlsx@^0.18.5`（SheetJS），仓库唯一第三方解析依赖（`package.json:8`）。
**解析侧零公式拦截**，另无行数/体积上限、目录无 `config.json`、
逐行串行 `add`、**无事务、部分失败不回滚**、超时残留无提示。

### 18.3 判定

- 路径 A：**P0**，需修 `csvField`（补拦 `\t\r\n`）+ `remark` 入口校验，两处都在
- 路径 B：**当前不可利用**，但应把 `trim()` 的拦截意图写成显式校验 + 注释，
  避免隐式防线被无意重构
- 中期：4 处 CSV sink 应收敛为一个统一导出器，公式拦截只写一次

## 19. 停用「商品」vs 停用「供应商」（必须区分）

R6 的正面结论与 P1 缺陷指向相反对象，容易混淆，单列澄清：

| | 结论 | 证据 |
|---|---|---|
| 停用**商品** | ✅ 不能下单（正面） | R6 正面结论：停用商品下单路径不存在 |
| 停用**供应商** | 🔴 仍可下单收货进报表（P1） | `createPurchaseOrder:250` 全程不查 supplier 状态 |

P1 的直接后果：`supplier-manage.js:99` 前端提示「停用后下单不可再选择」是**假承诺**。
用户停用了供应商，以为已切断，实际历史商品的 `default_supplier_id` 仍指向它，
新单照样走它、照样进报表。

配合 §15.3 的停用门店断链，「停用」这个动作在系统里有三种不同的实际效果
（门店、商品、供应商各一套），且**没有一套是完整闭环的**。

## 20. `importProducts` 的运维缺陷

除公式注入外的独立问题（R6）：

- **无事务**：逐行串行 `add`，部分失败**不回滚**
- **无上限**：行数与文件体积均无限制
- **无 `config.json`**：目录缺失，与其余 19 个云函数不一致
- **超时残留无提示**：SCF 超时后已写入的部分数据无清理机制、无用户提示

结合 §4.4 的嵌套返回（`importProducts:54,56`），导入失败时前端只弹「导入失败」不跳登录，
用户无从判断是会话过期还是文件解析失败——**失败不可诊断 + 数据半写入**是比失败本身更糟的组合。

## 21. 🔴 `project.config.json` 缺 `cloudfunctionRoot`：主包超限，一行可修

R10 实测：`project.config.json` 只有 **4 个键**，缺 `appid` / `miniprogramRoot` / `cloudfunctionRoot`。

后果链：

1. 没有 `cloudfunctionRoot`，`cloudfunctions/`（**359KB、19 个 `index.js`**）**不会被识别为
   云函数根**，因而**随主包打入**
2. 加上 `docs/` ~1052KB、`seed-data/` 60KB、`scripts/` 68KB、
   `业务模糊点确认清单.md` 73.5KB 等约 **1620KB 非运行时文件**
3. 与运行时 ~749KB 合计约 **2.4MB**，**超过 `bigPackageSizeSupport:false` 的 2MB 主包上限**

`packOptions.ignore` 只排除了 **1 个前端 0 引用的 298KB PNG**——**排除策略严重不对称**：
最大的 1052KB `docs/` 完全没排。

**修复一行**：`"cloudfunctionRoot": "cloudfunctions/"`

这是本轮唯一**可立即修复且修复成本为一行**的阻塞性问题。工作区里 `project.config.json`
恰好是未提交改动之一（本轮派单时它是两处未提交改动之二），改动后仍未补齐该键。

## 22. 🔴 `README.md:49` 的假承诺是 §10.1 P0 的根因

R10 找到了 §10.1（明文口令在 git 历史里）**为什么跨三轮勘探仍未修复**的原因：

`README.md:49` **声称 `.gitignore` 生效**，但**未告知它对 14 个已追踪的 seed 文件完全无效**
（`git check-ignore` 对它们全部返回 NOT IGNORED）。

这就解释了维护者的心理模型：文档说"忽略了"，而 `.gitignore:9` 也确实写着 `seed-data/`，
于是合理地认为种子数据已隔离——**实际一个都没隔离**。这不是疏忽，是**文档给出了错误的安全感**。

这也是 §10.1 中"前作已提修复方案但未执行"的合理解释：执行者大概认为 ignore 已生效、
不必做 `git rm --cached`。

**修复需要三件事**（缺一不可）：
① `git rm --cached seed-data/` 从索引移除
② 删除或改写 `README.md:49` 的假承诺，明确说明"对已追踪文件无效，需手动移除"
③ 5 个初始口令从 `README.md` 表格中移除或改为占位符

其中 ② 最容易被漏掉——只删文件不改文档，下一个人还会得出同样的错误结论。

## 23. 文档自相矛盾：一个全新的审计维度

R10 发现 `业务模糊点确认清单.md` **正文与自己的索引表给出相反结论**，共 **4 处**：

| 条目 | 正文 | 索引表 |
|---|---|---|
| #13 | `:525 [已定]` | `:786 [待确认]` |
| #15 | `:539 [待确认]` | `:788 [部分拍板]` |
| #8 | `:261` 已更新为「仅管理员」 | `:738` 仍写「店长/采购员可申请取消」 |
| B11 | `:301` 说两个 summary 类型「未纳入白名单与 reportTypeMap」 | `:774` 标「已修复（2026-09-19）」 |

其中 B11 的正文是**错的**：`getReports:68-72` 与 `meta.js:39-40` **均已纳入**。
索引表对了，正文没同步。

其他文档 vs 代码的脱节：

- `:546` 说异常处理完成「系统不会主动补账，也不会提醒管理员去补」→ 实际
  `dataService:791-794` 在 `resolveAbnormal` 内**已发**「待补结算提醒」消息
  （`采购流程图.html:155`、`README:36` 都正确，**只有清单正文错了**）
- `:63` 说 `pages/receive-list/` 是「无入口死页面」→ 实际
  `message.js:64` 是唯一入口、`app.json:12` 已注册
- `log.md:87` / `review.md:69` 引用的 `mock.js` **已从 `utils/` 删除**

**方法论新增维度**：full-scan-08 只做「文档 vs 代码」比对，**从未做「文档 vs 文档自己」**。
一份 73KB 的清单里正文与索引表互相矛盾 4 处，说明它的索引表是后补的、从未与正文同步校验。
下一轮若继续，这个维度值得单独一遍——它比"文档 vs 代码"更容易漏，也更容易被当成"文档只是参考"而放过。

**业务模糊点清单盘点**：33 条目 → ① 代码已有明确实现 25 · ② 与清单陈述不一致 7 · ③ 至今悬空 2
（#15 后半的责任人分工/SLA 时效/拍照强制、S3 供货商消息通道保留还是收窄）。

## 24. 潜伏的构建即毁伤：图标源失同步

R10 用 node 双向 diff 精确证明：`styles/icons.wxss` 实际有 **88 个变体类**，
`scripts/build-icons.js` 的 VARIANTS 只有 **87 项**，**唯一差异是 `.icon-truck-grey`**。

- wxss `:61` 定义了 `.icon-truck-grey`
- 但 `build-icons.js:108-110` 的 truck 只有 `primary/teal/white`
- 引用点：`report-list.wxml:16` 动态拼接 + `report-list.js:60` `iconBase:'truck'`

**当前运行时正常**（因为 wxss 是手写的、不受脚本控制）。
但 `build-icons.js` 头部注释写着「重新运行即可」——**一旦有人照做执行
`node scripts/build-icons.js`，该 CSS 类会被删掉**，「供应商到货」tab 未选中态
变成 32×32 空白方块。

这类"当前正常、构建即毁伤"的问题最难被发现，因为它**在任何一次正常运行中都不可观测**。
R10 的 node diff 方法（而不是目视比对）是唯一能定位它的手段。

顺带修正旧结论：full-scan-06 §1.5 称「图标类名全部存在」，实际是「**86/87 项有源码支撑**」。

## 25. CSV 导出：不只是修不修，而是正解已经在仓库里

R10 把 §14/§5 的 CSV 问题推到了可执行层面：

**必然失败的原因**：`wx.downloadFile` 的 `tempFilePath` **不带原扩展名**，
而 `openDocument` 官方支持列表（doc/docx/ppt/pptx/pdf/xls/xlsx）**不含 csv** →
基础库 3.17.1 下推断必然落 `fail`「打开失败」，`showMenu:true` 的转发/另存能力一并失效。

**为什么不能用 `fileType:'xls'` 冒充**：CSV 按 XLS **二进制格式解析会乱码或报错**，
**比"打开失败"更糟**——前者至少告诉用户失败了，后者给出一个打不开/乱码的文件。

**正解**：服务端把 CSV 转成 xlsx 再上传。**依赖现成**——`xlsx ^0.18.5` 已随
`cloudfunctions/importProducts` 引入，`generateSummaryReport` 复用同一能力即可，
不需要新增依赖。

这与 §18 的 4 处 CSV sink 收敛是同一件事：既修公式注入，又修导出格式，
收敛成一个统一导出器后两处都解决。

## 26. 报表空报表永久累积

`generateSummaryReport:183-224` **无 `rows.length === 0` 守卫**：门店当期无收货
（或全为手动行，`:191` `if (item.is_manual) return` 全跳过）时仍
bump 版本计数器（`:228`）、组装仅 3 行 CSV（`:219-224`）、上传、落 `report_file`
（`:237-255`）、返回 `code:0 itemCount:0`。

前端 `report-list.js:148-153` **只看 `code`** 就 toast「汇总报表已生成」并 reload。

叠加 §14.2（全项目 0 处 `report_file` 删除）→ **空报表永久累积、版本号白烧**。
用户每次点「生成汇总」都得到一个"成功"，实际是空文件。

R5 从云函数侧发现"孤儿文件 + 版本号白烧"，R10 从前端侧补上了"只看 code 就报成功"这半。

## 27. 报表类型的产品路径断档（数据层零差集，UI 层断裂）

R10 确认**数据层三向零差集**：`getReports:68-72` 白名单 8 项 = `meta.js:32-40` 映射 8 项
= 落库 8 种。这修正了 §14.1 的"8 类"结论——数据层是完整一致的。

**断档全在产品路径层**：

| 页面 | 实际暴露 | 应有 |
|---|---|---|
| `report-list.js:55-62` 管理员 tab | **6 个** | 缺 2 个汇总类 |
| `report-history.js:29-34` | 从 `Object.keys(meta.reportTypeMap)` 派生 **8 种全暴露** | **无角色收敛** |

同一个角色（管理员）在两个页面看到的报表类型集合**不一致**——一个少 2 个、一个 8 个全给。
更值得注意的是 `report-history` **完全没有角色收敛**：所有角色都能看到全部 8 类入口。
（入口可见不等于数据越权，`getReports` 侧仍有校验，但 UX 与预期不符。）

**种子数据同样有缺陷**：`seed-data/report_file.json` 11 条样本只有 6 种类型且
`file_url` 全为空串 → 用种子演示时**导出按钮 100% 走「该报表尚未生成可下载文件」**。
这解释了为什么 CSV 导出问题可能在演示阶段从未被发现——演示数据根本走不到导出成功路径。

## 28. 契约层再确认：报表 3 页不受 §4.4 影响

R10 逐一核对：4 个报表云函数**全部扁平 `{code, data}`**（`getReports:98`、
`getReportDetail:252`、`getReportFileUrl:56`、`generateSummaryReport:257-265`），
**不存在 `result.data.data` 双层嵌套**。

`normalizeReport`（`cloud.js:212-225`）映射 9 字段，**未映射**
`has_abnormal` / `abnormal_summary` / `source_order_id` / `file_name`，
但前 3 个**前端各自显式双写兼容** → **无 undefined 缺口**。

因此**报表 3 页不受 §4.4 的嵌套返回缺陷影响**（4 个云函数全顶层扁平，
`cloud.js:68` 能命中）。这条对 R8 划定的"影响面"是一个精确收窄：
嵌套问题影响 `dataService` 与 `authService` 的部分分支、**不影响报表链路**。

另：`report-detail.js:91` 有 `fileUrl` 前置守卫，不会以空 `fileId` 调 `getReportFileUrl`。

## 29. 采购流程图 vs 代码：三处需修正

R10 推翻了 full-scan-08 §8.2.5「唯一同步文档」的结论，三处：

1. `:273`「⑥ 异常补结算」与 `:269`「⑤ 汇总」的**编号与代码 ①–⑥ 六类单据报表错位**——
   补结算实际是 `dataService.settleReceipt` **复用 ③④⑤⑥ 带 `_S` 后缀重出**，不是新类型
2. `:99`「逆错」是错别字（代码字典为 `wrong_item: '错货'`）
3. **整段未画报表读取侧**（`report-list` / `report-history` / `report-detail` /
   `getReports` / `getReportDetail` / `getReportFileUrl`）→ 本轮 §26–§28 发现的
   **全部报表问题在图上无对应节点**

图内拍板引用密度与准确度**比清单更可信**——清单正文有 4 处自相矛盾（§23），
流程图只有编号错位和一处错别字。

## 30. 全轮小结：勘探覆盖面

- **P0**：7 项（§10.1 明文口令、§4.4 嵌套返回、§7 `getPurchaseOrders` 截断、
  §17.1 无供应商漏账、§17.2 取价 where 缺陷、§18.1 公式注入路径 A、
  §15.1 `receipt_abnormal` 死角）
  - §15.2 `settleReceipt` 重复出账亦为 P0，共 **8 项**
- **独立收敛**：`receipt_abnormal` 被 4 个子代理独立发现（§15.1），
  停用门店断链 3 次（§15.3），嵌套返回 4 次（§4.4 + R6/R7/R10）
- **被否证的假设**：§4.2 控制流分歧（经代码验证不可触发，P1→P2）、
  §16.1 F1/H10 双层嵌套（报表与采购链路均不存在）
- **被降级的旧结论**：§16.2 两例（`priceSnapshot` 无用负载、`createdBy` 死参数）、
  §14.1 报表类型 6 类→8 类、§24 图标类名 87→86/87、§29 流程图"唯一同步"
- **方法论教训**：§10.2 凭据扫描面太窄、§15.5 单批次看不到跨模块状态机、
  §23 缺"文档 vs 文档自己"维度、§24 需 node diff 而非目视比对
- **一行可修**：§21 `cloudfunctionRoot`

