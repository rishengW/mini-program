# R9 重扫：供应商端 4 页 + 登录/账号/消息 4 页（2026-10-04）

> **范围**：`pages/{supplier-home,supplier-orders,supplier-prices,supplier-receipts,supplier-messages,login,account,message}/`（8 页 × 4 文件 = 32 文件）；交叉参照 `authService`、`getSupplierOrders`、`getSupplierReceipts`、`confirmSupplierOrder`、`getSuppliers`、`getProductPrices`、`updateProductPrice`、`dataService`（消息域切片）、`utils/{auth-guard,cloud,meta,util}.js`、`app.js/json`、`pages/index/index.js`（导航闭环）、`seed-data/*`。
> **方法**：逐文件从头到尾读；js 与 wxml 逐行；每条结论带 `文件:行号`；不采信注释/README/log.md 的自述，只采信代码。
> **前置文档**：`full-scan-01-identity-session.md`（主前置，登录/账号/消息 + authService + utils + app.js 已 422 行覆盖）、`full-scan-02-cloud-purchase-receipt.md` §6–8（三个供应商云函数已覆盖）、`batch1-cloudfunctions-data.md` §1（鉴权复制/角色表/防爆破）、`controller-horizontal-scan.md` F1 与 `-20261003.md` H10（嵌套结构问题）。
> **本批的定位**：`docs/exploration/` 下**不存在 `full-scan-07`**（`full-scan-01` 的待核实项 #9 明确指向"供应商批次"）。本文件补的就是这个缺口：**供应商端 4 页前端从未被逐页解剖过**，云函数侧的信息边界也只在 §7.3 用一句话带过。
> **版本基线**：HEAD = `5268379`（`fix(pages): navigation, permissions, loading states and guard rails`）。工作区另有未提交改动 `pages/report-list/report-list.js`（`?.` 降级为 ES5 写法，8 行）与 `project.config.json`（新增 `packOptions.ignore` 排除 `采购流程图.png`），均不在本批范围。
> **改动历史**：`git log --oneline -8 -- <8 页>` → `5268379` / `0c535ba style(ui)` / `cab6d8a style(icons)` / `05dadc4 fix(login)` / `7288de3 feat(login) logo` / `b700bcc style(home)` / `d48b17c fix(security) 幂等` / `9350b9d fix(security)`。即：本批页面在 HEAD 前最后 3 个提交只做了样式与登录 logo，**没有一次安全/契约修复落到本批的供应商页**。

---

## 0. 增量摘要

1. **【P0 新发现】`getSupplierOrders` 把整张 `purchase_order` 主表文档原样发给供货商**（`getSupplierOrders/index.js:126-129` 的 `{...order, items}`）。前作 `full-scan-02` §7.3 只验证了 `items` 是按 `supplier_id` 过滤的，**没有审主表头部的展开**。落地的泄漏字段：`audit_remark`（采购方驳回理由，写入点 `dataService/index.js:553`）、`audited_by`（内部审批人姓名，`dataService:554`）、`supplier_confirmations`（**整张订单上所有供货商的确认状态，横向比价泄露**）、`verify_note`/`verify_reject_note`/`verify_amount`/`verify_voucher_file_ids`（凭证核销内部意见）、`created_by`（内部用户号）、`request_id`、`missing_reports`。前端只渲染其中一小部分，但原始报文到达设备端，用开发者工具网络面板即可读取。
2. **【P0 复核仍成立】F1/H1 嵌套结构问题在本域三个页面全部命中**：`dataService/index.js:47,49` 返回 `{error:{code:-401}}` → `getMessages:613-614` / `markMessageRead:643-644` / `markAllMessagesRead:665-666` 原样透出 → `utils/cloud.js:68` 只判 `result.code === -401`（为 `undefined`）→ **`message`、`supplier-messages`、`supplier-home` 三页会话过期时不会跳登录页，只反复弹兜底文案**。
3. **【P0 复核仍成立】供应商越权入口全部封死**：三个供应商读接口与 `confirmSupplierOrder` 的 `supplierId` **全部由服务端从会话派生**（`getSupplierOrders:62`、`getSupplierReceipts:46`、`confirmSupplierOrder:55`、`getProductPrices:49`），前端 4 页共 7 个 `callFunction` **没有任何一处传 `supplierId`**；`confirmSupplierOrder:65-69` 还额外用 `purchase_order_item` 证明"该单确含本供应商商品"。**前端传参不可信这个攻击面在本项目里根本不存在**。
4. **【P1 新发现】`getSuppliers` 的 `status` 参数绕过角色闸门**（`getSuppliers/index.js:54` 只挡 `includeInactive`，`:58-59` 对 `status` 值不做角色判定）→ `chef`/`store_manager` 传 `status: 0` 即可枚举已停用供应商的联系人姓名与手机号。
5. **【P1 新发现】`message` 的 limit-100 截断使老消息永远清不掉**：`dataService:634` 取最新 100 条 → `message.js:27` 的 `unreadCount` 只在这 100 条里数 → `markAllMessagesRead:669-679` 也只遍历同一份 100 条 → 未读超过 100 条后，超出部分**既不计入红点也无法被标记已读**。
6. **【P1】`supplier-orders` 切 tab 时丢请求显示脏数据**（`supplier-orders.js:66` `if (this.data.loading) return` + `:56-58` 先 `setData` 再 `reload`）。
7. **【P2 新发现】前端 `canConfirm` 与服务端白名单不一致**：`supplier-orders.js:98` 只看 `my_confirm_status === 'pending'`，忽略 `order_status`；而服务端 `confirm` 仅允许 `['submitted','approved']`（`confirmSupplierOrder:12`）。订单进入 `report_generated`/`to_receive`/`partial_received` 后仍显示"确认接单"按钮，点了必然被拒。
8. **【P1 复核】明文口令入库**：`seed-data/README.md:23-29` 五个初始口令（`Admin@2026` 等）已被 git 追踪，而 `.gitignore:9` 虽写了 `seed-data/` 但**未取消追踪**（`git ls-files seed-data` 返回 14 个文件）。前作 `controller-horizontal-scan-20261003.md:392` 给出的修复（`git rm -r --cached` + 轮换）未执行。前端代码 0 处硬编码口令。

---

## 1. 文件清单与全读确认

### 1.1 本批 32 个页面文件（全读，无抽样）

| 页面 | js | json | wxml | wxss | 合计 | 全读 |
|---|---|---|---|---|---|---|
| `pages/supplier-home/` | 134 | 4 | 82 | 168 | 388 | ✔ |
| `pages/supplier-orders/` | 131 | 5 | 49 | 70 | 255 | ✔ |
| `pages/supplier-prices/` | 42 | 4 | 19 | 17 | 82 | ✔ |
| `pages/supplier-receipts/` | 82 | 5 | 31 | 16 | 134 | ✔ |
| `pages/login/` | 104 | 3 | 66 | 202 | 375 | ✔ |
| `pages/account/` | 71 | 5 | 28 | 58 | 162 | ✔ |
| `pages/message/` | 83 | 2 | 30 | 78 | 193 | ✔ |
| `pages/supplier-messages/` | 66 | 3 | 27 | 78 | 174 | ✔ |
| **合计** | | | | | **1763** | 32/32 |

`.json` 全部只有导航标题与 `onReachBottomDistance`（`supplier-orders:5`、`supplier-receipts:5`）；**8 页全部未开 `enablePullDownRefresh`**，无下拉刷新。`.wxss` 全部为纯样式，`grep @import\|binding\|script` 0 命中。

### 1.2 交叉参照（只读）

| 文件 | 行数 | 本次读取 |
|---|---|---|
| `cloudfunctions/authService/index.js` | 674 | 全文 |
| `cloudfunctions/getSupplierOrders/index.js` | 136 | 全文 |
| `cloudfunctions/getSupplierReceipts/index.js` | 119 | 全文 |
| `cloudfunctions/confirmSupplierOrder/index.js` | 124 | 全文 |
| `cloudfunctions/getSuppliers/index.js` | 96 | 全文 |
| `cloudfunctions/updateProductPrice/index.js` | 138 | 全文 |
| `cloudfunctions/getProductPrices/index.js` | 89 | 全文（**任务未列，但 `supplier-prices.js:30` 实际调它，故补读**） |
| `cloudfunctions/dataService/index.js` | 1559 | 切片 254 行（`1-75` requireUser、`185-255` createMessage、`296-375` notifySuppliersNewOrder、`495-564` auditOrder 写入侧、`590-681` 消息三 action） |
| `utils/auth-guard.js` | 16 | 全文 |
| `utils/cloud.js` | 282 | 全文 |
| `utils/meta.js` | 67 | 全文 |
| `utils/util.js` | 127 | 全文 |
| `app.js` | 124 | 全文 |
| `app.json` | 74 | 全文 |
| `pages/index/index.js` | 182 | 全文（导航闭环必需） |
| `seed-data/{app_user.json,supplier.json,supplier_product_price.json,message.json,supplier_test_user.jsonl,README.md,purchase_order.json,purchase_order_item.json,receipt.json,receipt_item.json,abnormal_record.json}` | ~120 | 全文/前 3 条 |

**本会话合计读码约 4156 行**（32 页 1763 + 交叉参照全文 1891 + 切片与 seed 约 502）。

---

## 2. 供应商数据隔离端到端验证（逐请求）

### 2.1 前端 7 个 `callFunction` 的隔离条件全景

| # | 页面:行 | 云函数 + 入参 | 前端是否传 `supplierId` | 服务端隔离依据 | 判定 |
|---|---|---|---|---|---|
| 1 | `supplier-home.js:85` | `getSupplierOrders {page:1,pageSize:1}` | **否** | `getSupplierOrders:62` `supplierId = user.default_supplier_id` | ✔ |
| 2 | `supplier-home.js:53` | `dataService {action:'getMessages'}` | 否 | `dataService:623-625` `scope_type:'supplier'` + `scope_id` | ✔ |
| 3 | `supplier-home.js:120` | `authService {action:'logout'}` | 否 | 仅移除当前设备会话 | ✔ |
| 4 | `supplier-orders.js:68` | `getSupplierOrders {confirmStatus,page,pageSize}` | **否** | 同上 | ✔ |
| 5 | `supplier-orders.js:121` | `confirmSupplierOrder {orderId,action}` | **否** | `:55` 派生 + `:65-69` 明细归属证明 | ✔ |
| 6 | `supplier-receipts.js:39` | `getSupplierReceipts {page,pageSize}` | **否** | `getSupplierReceipts:46` + 查询 `:54` | ✔ |
| 7 | `supplier-prices.js:30` | `getProductPrices {onlyCurrent:true}` | **否** | `getProductPrices:49` 强制覆盖客户端 `supplierId` | ✔ |
| 8 | `supplier-messages.js:24` | `dataService getMessages` | 否 | 同 #2 | ✔ |
| 9 | `supplier-messages.js:44,60` | `markMessageRead` / `markAllMessagesRead` `{id}` | 否 | `:650-653` 字面归属判定 | ⚠ 见 §4.3 |
| 10 | `message.js:15,38,75` | 同上三个 | 否 | 同上 | ⚠ |
| 11 | `account.js:43` | `authService changePassword` | 否 | 旧密码双重校验 | ✔ |
| 12 | `login.js:52` | `authService login` | 否 | 密码 + `expectedRole` 服务端裁决 | ✔ |

**结论：供应商数据隔离在前端传参层面无可信性问题——因为前端从不传 `supplierId`。** 这与任务书假设的攻击面（"如果由前端传参而非云端从会话推导就是越权漏洞"）相反：本项目在 4 个供应商云函数里**统一采用会话派生**。

### 2.2 `confirmSupplierOrder` 越权确认

`cloudfunctions/confirmSupplierOrder/index.js`：
- `:52-56` 四重前置：会话 → 角色 `supplier` → `supplierId` 派生 → `supplierId` 非空。
- `:64-69` **归属证明**：`db.collection('purchase_order_item').where({purchase_order_id: orderId, supplier_id: supplierId}).limit(1)`，无命中返回 `{code:-403, msg:'该订单不包含贵司供货的商品'}`。
- `:78-83` **条件更新**：`where({purchase_order_id, order_status: _.in(allowed)})` 后 `updated === 0` 即拒 → 并发的作废/收货不会把确认写进去。
- `:73-77` 写入键 `supplier_confirmations.${supplierId}`，只碰自己的键。

**能否确认别人的订单：不能。** 传入不属于自己的 `orderId` 会被 `:69` 的 `-403` 拦下。这是全项目防护最扎实的写接口（`full-scan-02` §6.1 同结论，本批独立复核通过）。

**残留（非越权）**：`confirmed` 与 `shipped` 的 `order_status` 白名单在 `approved` 上重叠（`:12` 与 `:13` 都含 `approved`），写入目标是同一个键 → 供应商可把 `shipped` 自降回 `confirmed`，无审计（`full-scan-02` L5 已记）。

### 2.3 信息边界（本批核心新发现）

**`getSupplierOrders/index.js:126-129`：**
```js
const data = pageOrders.map(order => ({
  ...order,
  items: itemsByOrder[order.purchase_order_id] || []
}))
```
`items` 是按 `supplier_id` 过滤的（`:71`），✔。**但 `...order` 是主表文档原样展开**，未做任何字段白名单。该供应商拿到手的主表字段包含：

| 字段 | 写入点 | 敏感性 |
|---|---|---|
| `audit_remark` | `dataService/index.js:553`（驳回理由，驳回时强制必填 `:502-503`） | **内部审批意见泄露** |
| `audited_by` | `dataService:554`（审批人姓名） | 内部员工身份泄露 |
| `audited_at` | `dataService:555` | 内部流程时点 |
| `supplier_confirmations` | `dataService:403`、`confirmSupplierOrder:73` | **横向比价：同单其他供货商的确认/发货状态** |
| `verify_note` / `verify_reject_note` | `cloud.js:159-160` 归一化器证明确实落库 | **凭证核销内部意见泄露** |
| `verify_amount` / `verify_voucher_file_ids` | `cloud.js:158,161` | 核销金额与凭证文件 ID（**文件 ID 可能间接指向可读取的文件**）【待核实：`verify_voucher_file_ids` 是否可被供货商用 `getTempFileURL` 换出真链接】 |
| `created_by` | `seed-data/purchase_order.json:1`（`"U001"`） | 内部用户号枚举 |
| `request_id` | `createPurchaseOrder:139-150` | 内部幂等键 |
| `missing_reports` | `createPurchaseOrder:438-440` | 内部故障标记 |
| `order_no` / `store_id` / `store_name` / `remark` / `items[].remark` | — | 设计内（对账必需） |

前端 `supplier-orders.wxml:17-40` 只渲染了 `storeName`/`orderNo`/`orderDate`/`deliveryDate`/`statusText`/`remark`/`items[].productNameSnapshot`/`orderQty`/`unitSnapshot`/`remark`——**显示面是收敛的，报文面不是**。攻击者无需任何越权接口，打开自己的订单列表即可读到别家供货商的确认状态与采购方的驳回理由。

**为什么前作没抓到**：`full-scan-02` §7.3 的表述是"只嵌本供应商自己的明细（L120-129），注释与实现相符"——它审的是 `items` 那一行的来源，跳过了同一对象字面量里的 `...order`。

**对照做得对的邻居**：`getSupplierReceipts/index.js:103-111` 同样 `{...item}` 全量展开 `receipt_item`，但 `receipt_item` 本身不含审批意见与跨供应商数据，且 `:84` 的异常记录查询带了 `supplier_id: supplierId`，`:90-95` 只取 4 个字段（`type/status/resolution/payment_decision`）而非展开原文档。同一位作者在同一批文件里两种写法并存——**说明这是漏，不是口径**。

**修复方向**：把 `:126-129` 的展开换成显式字段白名单（与前端 wxml 实际用的 10 个字段对齐），成本约 15 行。

### 2.4 跨供应商价格/报价可见性

`getProductPrices/index.js:46-53`：
```js
if (user.role === 'supplier') {
  if (!user.default_supplier_id) return { code: -403, ... }
  query.supplier_id = user.default_supplier_id   // 忽略客户端 supplierId
} else {
  if (!['super_admin', 'purchaser'].includes(user.role)) return { code: -403, ... }
  if (supplierId) query.supplier_id = supplierId
}
```
`supplier-prices.js:30` 只传 `onlyCurrent: true`；即使前端被篡改传 `supplierId: 'SUP002'`，服务端也强制覆盖。**供应商看不到其他供应商的价格，横向比价泄露不成立。**

`updateProductPrice/index.js:70` 把写价权限锁死在 `super_admin`/`purchaser`，且 `:80-89` 只允许当天生效——**供应商端价格页是纯只读**，与 `supplier-prices.wxml:4` 的文案"如需调整请联系采购方"一致。

### 2.5 `getSuppliers` 返回给内部用户的内容

`getSuppliers/index.js:87-90`：`data: suppliers.map(item => ({...item, product_count}))` —— 全量展开 `supplier` 文档。实测 `seed-data/supplier.json` 字段为 `supplier_id / supplier_name / contact_name / contact_phone / address / status / created_at / updated_at`。

**结论：不含登录凭据。** 供应商的登录凭据（`password_hash`/`password_salt`/`password_iterations`）在 `app_user` 集合，`getSuppliers` 只查 `supplier` 集合。任务书问的"是否包含不该暴露的供应商登录凭据字段"——**否**。

**但存在两个越权缺口：**
- **`:54` 只挡 `includeInactive`，不挡 `status`**：`:58-59` 是 `if (status !== undefined && status !== null && status !== '') query.status = status` —— **任何角色传 `status: 0` 都能拿到停用供应商**。`chef`/`store_manager`（非 `isManager`）本应在 `:59` 被收敛到 `status: 1`，但只有没传 `status` 时才走那一支。影响：联系人姓名 + 手机号 + 地址泄露（`contact_name`/`contact_phone`/`address`）。
- **`:61` 的 `keyword` 直通 `db.RegExp`**：`query.supplier_name = db.RegExp({regexp: keyword, options: 'i'})`，客户端原文正则无长度/字符校验 → 恶意正则可打爆云函数（ReDoS），且与 `status: 0` 叠加可精确搜出停用供应商。
- 对照 `:45-52` 的供应商分支做得很干净（只返回自己那一条），同一个函数两个分支的严谨度差一个量级。

---

## 3. 登录与会话安全

### 3.1 凭据传输与明文存储

- 传输：`login.js:52-57` 明文账号 + 明文密码走 `wx.cloud.callFunction`。小程序云开发通道全程 HTTPS，且 `authService:161-164` 只按 `{username}` 查一次、`:174` 用 `crypto.timingSafeEqual` 比对（先比长度 `authService:42`）——**没有二次哈希、没有加盐客户端**。
- 存储：`authService:28-35` 用 `pbkdf2Sync(password, salt, 120000, 32, 'sha256')`，盐每账号独立（`:299,369,429,455` 各 `randomBytes(16)`），`password_iterations` 落库可回放。`seed-data/app_user.json` 与 `supplier_test_user.jsonl` 里**只有哈希、盐与迭代数，无明文**。
- 会话令牌：`authService:210` `crypto.randomBytes(32).toString('hex')`（256 bit 熵，无结构、不可预测）；落库只存 SHA256（`:45-47` 哈希，`:215,221` 写入）；明文令牌只在 `login` 响应里出现一次。
- 客户端持久化：`login.js:83-85,91,98` 存 `userInfo`/`authToken`/`sessionExpiresAt`/`supplierInfo`/`currentStore`。**令牌是明文 hex 存 `wx.setStorageSync`**——这是小程序的通用弱点（越狱/真机调试可 dump 本地存储），无本地加密。项目内无 `wx.setEncryptedStorage` 用法。

### 3.2 枚举风险与防爆破（batch1 提及项复核）

`authService/index.js:156-197` 的 `login`：

| 分支 | 返回文案 | 行号 |
|---|---|---|
| 账号不存在 或 密码错 | `账号或密码错误` | `:192` |
| 账号存在但已锁定 | `账号已锁定，请N分钟后重试` | `:171` |
| 账号已停用 | `账号已停用，请联系管理员` | `:194` |
| 角色不匹配 | `账号与所选登录角色不匹配` | `:196` |
| 档案不存在/停用 | `账号关联的供货商档案不存在或已停用…` | `:204` |
| 未关联门店 | `账号未关联有效门店…` | `:207` |

- **存在/密码错两条不区分** ✔（`:192` 合并），`full-scan-01` L9 记录的三条文案差异确实让攻击者能区分"锁定中/已停用"，但**无法区分"账号不存在 vs 密码错"**。
- **锁定实现**：`:167-173` 查 `login_locked_until` → 命中即拒；`:176-190` 失败时用 `_.inc(1)` 原子自增，再用 `where({_id, login_fail_count: _.gte(5)})` **条件更新**写锁并归零——`d48b17c fix(security): harden concurrency guards and idempotency` 留下的成果，并发下不会重复顺延锁定期，实现正确。
- **关键缺口仍在**：`:167` 的 `if (user)` 包住了整个锁定逻辑 → **对不存在的用户名没有任何限速**。爆破未知用户名（字典遍历）不受任何约束。`full-scan-01` L9 的判断在本 HEAD 下**完全成立**。
- **无验证码、无 IP/设备级速率限制、无登录尝试留痕表**。5 次/10 分钟是唯一的屏障，且是账号级。

### 3.3 记住登录态

- 存储：`login.js:83-85`（token + 过期时间戳），TTL 由服务端定 `SESSION_TTL_MS = 7 天`（`authService:13,211`）。
- 过期判断分三层：
  1. **本地粗判** `app.js:15-22`：`parseExpires` 处理数字与 `YYYY-MM-DD HH:mm`（`-`→`/` 兼容 iOS JSCore），解析失败视为无效 → 直接登出。
  2. **冷启动服务端复检** `app.js:48-70` `validateSessionOnLaunch`：调 `authService validate`，用服务端返回的 user 刷新本地缓存；失败 `clearSession()`；**网络异常时保持本地登录态**（`:67-69`）。
  3. **请求期裁决** 各云函数 `getSessionUser`：全部用服务端 `Date.now()` 判过期，客户端时间无法伪造。
- **缺口**：`app.js` 无 `onShow`，**温启动（后台切回）不触发复检**，只能靠首个云请求的 401 兜底——而该兜底对 §3.4 的嵌套返回无效（`full-scan-01` L2 仍成立）。

### 3.4 会话过期处理一致性（F1 在本域的精确命中面）

| 页面 | 触发的云函数 | 过期时的实际返回 | 前端行为 |
|---|---|---|---|
| `login` | `login` | 顶层 `{code:-1}` | 弹 toast「账号或密码错误」 ✔ |
| `account` | `changePassword` | **顶层** `{code:-401}`（`authService:290`） | `cloud.js:68` 命中 → 清会话 + 600ms 后 reLaunch 登录 ✔ |
| `message` | `getMessages` / `markMessageRead` / `markAllMessagesRead` | **嵌套** `{error:{code:-401}}`（`dataService:47` → `:614/:644/:666`） | `cloud.js:68` 不命中 → 弹兜底文案「消息加载失败」，**不跳登录** ✘ |
| `supplier-messages` | 同上三个 | 同上 | 同上 ✘ |
| `supplier-home` | `getMessages` + `getSupplierOrders` | `getMessages` 嵌套；`getSupplierOrders:60` 是**顶层** `{code:-401}` | 一半命中一半不命中：`getSupplierOrders` 会踢回登录，`getMessages` 不会；`:54/:86` 两处都是 `if (!res \|\| res.code !== 0) return` **静默 return**，连 toast 都不弹 ✘ |
| `supplier-orders` / `-receipts` / `-prices` | `getSupplierOrders` / `getSupplierReceipts` / `getProductPrices` | **顶层**（`:60/:44/:42`） | ✔ 正确跳登录 |

**即：本批 8 页里 4 页过期时会正确踢回登录（3 个纯供应商页 + `account`），3 页（`message`/`supplier-messages`/`supplier-home` 的消息链路）会静默退化。** 与 `controller-horizontal-scan-20261003.md:177` 的判断一致——全项目 `grep \.error\b` 只有 6 处且全是 `console.error`，没有任何一处读 `result.error`。**F1 在 HEAD 5268379 下未修复。**

`supplier-home` 的额外问题：`:54` 与 `:86` 两处失败分支都是裸 `return`，**没有任何用户可见反馈**——会话过期、云函数未部署、网络失败全部表现为"红点消失、统计归零"。

### 3.5 `account` 页能力边界

- **能改的**：只有登录密码（`account.wxml:11-27`，三个输入框 + 一个按钮）。**不能改头像、昵称、手机号**——页面上根本没有这些字段。`avatarText`（`account.js:23`）是从 `user.name` 截首字的本地派生，不是可编辑项。任务书问的"能否修改头像/昵称"——**不能**。
- **前端校验**：`account.js:35-39` 三栏非空、新密码 ≥6、两次一致。服务端另有"新旧不能相同"（`authService:297`），前端未做——用户会先看到服务端文案，可接受。
- **改密后旧会话**：`authService:305` 写 `sessions: []` → **该用户在所有设备上的会话全部失效**，`:306-307` 同时清 legacy 字段。比 `account.wxml:26` 的文案"更新后当前登录会话会失效"强，`full-scan-01` L4 的文案失真问题**仍成立**（应为"所有设备"）。
- **退出登录清什么**：`account` 页**没有退出登录按钮**（只有改密）。退出登录分散在两处：`index.js:135-152`（内部用户）与 `supplier-home.js:116-133`（供应商）。两者对比：

| 清理项 | `index.js:146-150` | `supplier-home.js:126-131` | `app.clearSession`（`app.js:73-82`） |
|---|---|---|---|
| `userInfo` | ✔ | ✔ | ✔ |
| `currentStore` | ✔ | ✔ | ✔ |
| `authToken` | ✔ | ✔ | ✔ |
| `sessionExpiresAt` | ✔ | ✔ | ✔ |
| `supplierInfo` | **✘ 漏** | ✔ | ✔ |
| `account_history` | ✔（**死键**） | ✔（**死键**） | **✘** |
| `globalData.supplierInfo` | **✘ 漏** | ✔（`:124`） | ✔ |

  **`index.js` 的退出登录漏清 `supplierInfo`**（`:142-145` 与 `:146-150` 都没有）。内部用户正常情况下不该有 `supplierInfo`，所以当前不产生真实危害，但三处清理逻辑不一致，属于同一功能三套实现。
- **`account_history` 是彻底的死键**：全项目 `grep account_history` 只有 3 处 `removeStorageSync`（`index.js:150`、`login.js:86`、`supplier-home.js:131`），**0 处写入**。配套的死样式是 `login.wxss:120-196`（77 行 `.history-*`）。这是"最近登录账号"功能下线后的残留。
- **`account.js:17-20` 死代码**：`requireLogin()` 返回 `true` 已保证 `globalData.isLoggedIn === true`（`auth-guard.js:8`），紧随的 `if (!app.globalData.isLoggedIn)` 永假；且它用 `wx.redirectTo` 而 `requireLogin` 用 `wx.reLaunch`，两条路径永不汇合（`full-scan-01` L5 仍成立）。

### 3.6 供应商账号 vs 内部账号的同一登录入口

`login.js` 是**唯一登录入口**，通过"角色四选一"分流：
- 角色选择器 `login.js:10-15` 含 4 个角色（chef/store_manager/purchaser/supplier），**不含 super_admin**——超管走 `isSuperAdminLogin` 开关（`:38-45`，wxml `:43-61` 是独立 `block`）。
- 分流条件：`expectedRole: isSuperAdminLogin ? 'super_admin' : selectedRole`（`:56`），服务端裁决 `user.role !== event.expectedRole` → `-1`（`authService:195-197`）。**伪造无效**（角色取自库中账号）。
- 落地分流：`handleLoginSuccess` 里 `if (user.role === 'supplier')` → 清 `currentStore`、存 `supplierInfo`、`reLaunch('/pages/supplier-home/supplier-home')`（`:90-97`）；否则存 `currentStore`、清 `supplierInfo`、`switchTab('/pages/index/index')`（`:98-102`）。
- **不串号**：供应商走 `findSupplier`（`authService:203,204`），内部走 `getDefaultStore`（`:206,207`），两条分支互斥。`getDefaultStore:96-103` 对 `STORE_ROLES` 之外的角色才会走"默认门店兜底"，但供应商在上游已被拦进 supplier 分支，兜底不可达。
- **测试凭据是否在前端出现**：`login.js:20-21` 每次 `onShow` 清空两栏，注释明确"避免向使用者公示测试账号"；全 `pages/` + `utils/` + `app.js` + `app.json` 里 `grep -iE "password|openid|admin|test"` 的命中全部是字段名或角色字符串，**0 处硬编码口令、0 处硬编码 `supplier_test` 账号名**。`supplier_test_user.jsonl` 的账号名只出现在 seed-data 与 docs 里。

---

## 4. 消息域分析

### 4.1 `message` 与 `supplier-messages` 的差异

| 维度 | `pages/message` | `pages/supplier-messages` |
|---|---|---|
| tabBar | **是**（`app.json:62-66` 第 4 项） | 否（只能 `navigateTo`） |
| 进入方式 | `switchTab`（`index.js:130,159`） | `navigateTo`（`supplier-home.js:66,70`） |
| 角色守卫 | **无**（`message.js:12-13` 只 `requireLogin`） | **有**（`:16-18` 非 supplier → reLaunch） |
| 图标口径 | 5 种 type（approval/order/receive/abnormal/默认）`wxml:11-15` | 2 种（order/默认）`wxml:11-12` |
| 点击路由 | 按 type + bizId 前缀分流 4 路（`:51-69`） | 一律跳 `supplier-orders`（`:52-54`） |
| 云函数 | `dataService getMessages/markMessageRead/markAllMessagesRead` | **完全相同** |
| 数据隔离 | 靠服务端 scope 过滤 | 靠服务端 scope 过滤 |

**两个页面是同一份数据的两种视图**，前端代码约 90% 重复（`loadMessages`/`readMessage`/`markAllRead` 三函数逐行同构）。差异只在图标字典与路由。

**供应商误入 `message` 页不会泄露数据**：`getMessages:623-625` 对 supplier 角色强制 `scope_type: 'supplier'` + `scope_id`，拿到的还是自己那批消息；`message.js:53-56` 甚至专门给 supplier 写了路由分支跳 `supplier-orders`——说明作者知道这个页面可能被供应商触达。

### 4.2 消息生成点（写 `message` 集合的全部位置）

`dataService/index.js` 内 `collection('message').add` 的调用点：
- `:187-206` `createMessage(data)` —— 唯一写入助手，`message_id` 为 `MSG+时间戳+4 字节随机`。
- `:296-346` `notifySuppliersNewOrder` —— 审核通过后给每个供货商写**定向**站内消息（`scopeType:'supplier'`, `scopeId:supplierId`，`:324-331`）。**这是供货商唯一能收到的消息类型。**
- `:583-594` 报表生成失败 → 定向通知管理员。
- `confirmSupplierOrder:98-113` —— 供应商发货后给订单所属门店写内部消息（`scope_type:''`, `store_id: order.store_id`）。
- 其余：`dataService:708-722`（收货报表失败）、`:792-798`（待补结算提醒）、`:1321-1328`（订单已作废）、`:1372-1378`（收到取消申请）。

**供应商收到的消息会不会泄露采购内部信息**——逐条看供货商能收到的两种：
1. `notifySuppliersNewOrder:320-321`：`您有新的采购订单` / `${store_name}的采购单 ${order_no} 已审核通过，共 ${itemCount} 项商品，请确认接单。` —— 含**门店名 + 采购单号 + 项数**，**不含金额**（`:303` 注释明确"摘要只报项数不报金额"）、不含明细、不含审批意见。✔
2. 没有任何其他写点带 `scope_type:'supplier'`。**作废/改量/取消申请类消息一律走门店广播或内部定向**（`:1321-1328` 的作废通知 `recipient_user_id` 为空 → 门店广播），供应商完全无感知。`业务模糊点确认清单.md:383` 记录的"S3 供货商无系统内消息触达"在本 HEAD 下**部分缓解**（新订单已有站内触达），**作废/改量仍未触达**。

**供应商消息触达的实际有效性问题**：
- `supplier-home.js:7` `NEW_ORDER_TEMPLATE_ID = ''` —— 注释写明"为空时不拉起授权弹窗"，`:76` 直接 `return`。
- `dataService:244` `SUBSCRIBE_TEMPLATE_ID = ''` —— 同款。
- 即：**微信订阅消息推送链路两端都是空常量，整条链路是死代码**。供应商必须主动打开小程序才能看到新订单。`dataService:335-344` 的 `sendSubscribeMessage` 循环因此永不执行。

### 4.3 已读同步方式、红点来源、以及 `markMessageRead` 的越权口子

- **同步方式：纯拉取，无实时、无轮询、无 WebSocket。** 两个页面都只在 `onShow` 拉一次（`message.js:12`、`supplier-messages.js:12`）；8 页均未开 `enablePullDownRefresh`；全项目 `grep setInterval|setTimeout` 无消息轮询。
- **红点计算来源**：`message.js:27` 与 `supplier-messages.js:34` 都是 `messages.filter(m => !m.read).length`，**完全本地计算**。`supplier-home.js:56` 同款。已读判定在服务端 `dataService:638`：`!!message.read || readBy.includes(userId)`。
- **TabBar 红点：全项目 0 处 `setTabBarBadge` / `showTabBarRedDot`**（`full-scan-01` L13 复核：`grep -rn "setTabBarBadge\|showTabBarRedDot\|hideTabBarRedDot" pages/ utils/ app.js` → 0 命中）。**消息 tab 永远是灰色**，"消息中心"的未读提示完全依赖用户主动进入。
- **`markMessageRead` 的越权口子（batch1 §1.6 复核仍成立）**：`dataService:650-653`
  ```js
  const belongsToUser = !message.recipient_user_id || message.recipient_user_id === userId
  const belongsToStore = isGlobal || !message.store_id || message.store_id === auth.user.default_store_id
  ```
  供货商 `default_store_id` 为空字符串 → `message.store_id === ''` 恒真；而 `getMessages` 对 supplier 强制 `scope_type` 过滤，但 **`markMessageRead` 只接受客户端传的 message `_id`，不做"该消息是否在当前用户可见集内"的复查**。因此供货商若能拿到某条 `recipient_user_id:''` + `store_id:''` 的消息 `_id`，可越权标记其已读。
  **实际影响限于读状态**：`read` 是按 `read_by` 数组逐用户记录的，供货商写自己的 `read_by` 不影响内部用户的已读态；但会把 `read_at`（`:659`）写到文档上。低危。
  另：`markMessageRead` 的越权返回 `:653` 是**顶层** `{code:-403}`，而会话过期走 `:644` 的嵌套 `-401`——**同一个函数两种返回结构**，正是 F1 的样本。
- **`markAllMessagesRead` 的两处性能与正确性问题**：
  - `:669-679` 先 `getMessages` 拿列表，再对每条未读做 `doc(id).get()` + `doc(id).update()` → **N+1，100 条未读 = 200 次 DB 操作**（`batch1:354` 已记，本 HEAD 下未改）。
  - **更严重的是正确性**：`:669` 拿到的就是 `:634` 那份 `limit(100)` 的最新 100 条。若某账号有 >100 条消息且其中未读的分布在 100 条之外，**"全部已读"永远清不掉老消息**，且 `message.js:27` 的红点数字也是错的（只数了最新 100 条）。这是本批新发现的 P1。

---

## 5. 逐页解剖

### 5.1 `pages/supplier-home`（388 行）

- **`data`（`js:10-21`）**：`supplierName/contactName/contactPhone/userName/unreadCount/latestMessage/stats[3]`。`stats` 三个静态卡片（pending/confirmed/shipped），初始 `value:0`。
- **`onShow`（`:24-49`）** 7 步：`requireLogin` → `wx.hideHomeButton`（`:27`，隐藏微信原生"返回首页"，防止跳登录页后被误导回原页面）→ 二次判 `isLoggedIn` → **角色守卫**（`:35-38` 非 supplier → `reLaunch('/pages/index/index')`）→ 读 `supplierInfo`（globalData 优先，storage 兜底 `:39`）→ `setData` 4 个字段 → 并发触发 `loadStats`/`loadNotice`/`requestNewOrderSubscribe`。
- **两个数据请求**：`loadNotice`（`:52-62`）拉 `getMessages` 只取 `messages[0]` 与未读数；`loadStats`（`:83-93`）拉 `getSupplierOrders {page:1,pageSize:1}` **只为拿 `statusCounts`**——服务端仍会全量拉 1000 行明细 + 全量查订单，前端压 pageSize 并不能省服务端成本。
- **事件处理器 8 个**：`goMessages`/`goMessageCenter`（均跳 `supplier-messages`）、`goOrders`/`goStatPage`（跳 `supplier-orders`，后者带 `?status=`）、`goReceipts`、`goPrices`、`goAccount`、`switchAccount`。
- **`switchAccount`（`:116-133`）**：`showConfirm` → `callFunction('authService',{action:'logout'})` → 清 5 个 globalData → 清 6 个 storage key → `reLaunch` 登录。**`await` 了 logout 但不检查返回值**——网络失败时服务端会话未吊销（仍活 7 天），本地已清。best-effort，可接受。
- **`requestNewOrderSubscribe`（`:75-81`）**：死代码（模板 ID 为空，`:76` 直接 return）。
- **问题**：`loadStats:86` 与 `loadNotice:54` 失败分支都是裸 `return`，无 toast、无空态区分；无 `loading` 字段，首页骨架屏期间统计恒为 0。

### 5.2 `pages/supplier-orders`（255 行）

- **`data`（`js:16-24`）**：`tabs[5]`/`activeTab:'pending'`/`statusCounts:{}`/`orders:[]`/`page:1`/`pageSize:20`/`total:0`/`loading:false`。
- **`onLoad(options)`（`:27-32`）**：只解析 `options.status` 并校验在 `TABS` 内（`:29` `TABS.some(...)`）——**非法 status 值静默忽略**。
- **`onShow`（`:34-46`）**：角色守卫（非 supplier → `reLaunch('/pages/index/index')`）→ `reload()`。
- **`onReachBottom`（`:48-52`）**：`loading || orders.length >= total` 双守卫 → 下一页 append。
- **`loadOrders`（`:65-85`）**：`:66` `if (this.data.loading) return` → 展示 loading → `callFunction` → 关闭 loading → 校验 → `decorateOrder` 装饰 → `setData`（append 或替换）。
- **`decorateOrder`（`:87-101`）**：`cloud.normalizePurchaseOrder` → `meta.getStatusInfo` + `meta.getSupplierConfirmInfo` → 派生 `canConfirm`/`canShip`。
- **写操作**：`confirmOrder`/`shipOrder`（`:103-115`）各自 `showConfirm` 二次确认 → `doAction`（`:117-130`）。`doAction` 用 `this._submitting` 做**实例级防重**（`:118-119`，非 data 字段），`showLoading('提交中...')` 与 `hideLoading()` 严格配对（`:120/:122`），成功 `reload()`。
- **`catchtap`**（wxml `:38-39`）：按钮用 `catchtap` 而非 `bindtap`，防止冒泡到外层（虽然外层无 bindtap）——正确写法。
- **问题**：
  - **`:66` 的 loading 早退导致切 tab 丢请求**：`switchTab:56-58` 先 `setData({activeTab})` 再 `reload()`；若上一请求未结束，`loadOrders:66` 直接 return，页面呈现"新 tab 标签 + 旧 tab 数据 + 旧 `statusCounts`"。这是本批最明确的交互缺陷（P1）。修法是把 `activeTab` 与 `loading` 合并进请求，或用一个递增的 `reqSeq` 丢弃过期响应。
  - **`:98-99` 的 `canConfirm`/`canShip` 只看自己的确认状态，不看 `order_status`**，与服务端 `confirmSupplierOrder:12-13` 的白名单不一致（详见 §7 问题清单 P2-2）。
  - `:90` 读 `order.my_confirm_status`（snake_case，服务端 `getSupplierOrders:104` 写入），`:93` 再读一次做兜底 `'pending'`——同名字段在 `...o` 展开后其实已经存在，`:93` 是冗余但无害。
  - **无 `onPullDownRefresh`、无空态图标区分错误**：`:43` 的 `orders.length === 0 && !loading` 在加载失败时也会显示"暂无相关订单"，把错误态伪装成空态（P2）。

### 5.3 `pages/supplier-prices`（82 行）

- **`data`（`js:7-10`）**：`prices:[]`/`loading:false`。
- **`onShow`（`:12-25`）**：`requireLogin` → 角色守卫 → `loadPrices()`。
- **`loadPrices`（`:27-41`）**：`setData loading` → `callFunction('getProductPrices',{onlyCurrent:true})` → 关闭 → 校验 → map 出 `priceText` → `setData`。
- **`callFunction` 仅 1 个，跳转 0 个**——纯只读页。
- **问题**：`:29` 的注释"云函数会为供货商角色强制限定只能查自己的价格"经 `getProductPrices:46-53` 验证**属实**。但 `getProductPrices:54` 仍接受客户端 `productId` 做二次过滤——对供应商而言无害（`supplier_id` 已被强制覆盖），对 purchaser 而言意味着可以按商品维度筛。无分页：`:60` 服务端 `limit(200)`，前端无 `onReachBottom`——协议价超过 200 条会静默截断，且**页面上没有"已加载全部 N 条"的提示**（对照 `supplier-receipts.wxml:30` 有 `list-footer`）。P3。

### 5.4 `pages/supplier-receipts`（134 行）

- **`data`（`js:7-12`）**：`items:[]`/`page:1`/`pageSize:20`/`total:0`/`loading:false`。
- **`onShow`（`:15-28`）**：同 `supplier-orders` 的守卫模式 → `loadReceipts(1,false)`。
- **`onReachBottom`（`:30-34`）**：同型双守卫。
- **`loadReceipts`（`:36-81`）**：拉取 → map 时**前端自行派生 `abnormal` 判定**（`:53`：`!is_manual && (receivedQty !== orderQty || payable_flag === false)`，`is_manual` 的 0 价例外来自 S9 拍板）与 `abnormals` 文本拼装（`:55-65`，含 `payment_decision` → "裁决：按实收补款/维持不付款"）。
- **`callFunction` 1 个，跳转 0 个**（纯只读对账页）。
- **问题**：
  - **前端自己算"异常"**，与服务端的异常记录（`abnormal_record`）是两套口径。`:53` 的判定只看数量差与 `payable_flag`，而服务端可能在数量完全收齐时也写异常（缺价，见 `full-scan-02` H1）→ **同一行既可能显示"正常"绿标又列出异常记录**，对账时会互相打脸。P2。
  - 与 `supplier-orders` 同款问题：无下拉刷新、失败态伪装成空态（`:25` `items.length === 0 && !loading`）。
  - `wxml:21` 的 `wx:key="index"` 是数组索引——列表内元素不会重排，可接受，但这是 8 页里唯一的非稳定 key。

### 5.5 `pages/login`（375 行）

- **`data`（`js:6-16`）**：`username/password/isSuperAdminLogin/roles[4]/selectedRole:'chef'`。
- **`onShow`（`:19-22`）**：每次进页清空两栏（防公示测试账号）。
- **事件处理器 5 个**：`onInput`（`data-field` 动态字段，`:25-26` 用计算属性名 `setData`）、`selectRole`（换角色清空两栏 `:33-34`）、`toggleSuperAdmin`（`:38-45` 清空两栏）、`login`、`handleLoginSuccess`。
- **`login()`（`:47-71`）**：非空校验 → `showLoading('登录中')` → `callFunction` → `hideLoading`（异常路径也一定执行，因 `callFunction` 永不抛）→ 三分支：`code===0` 成功 / `res.errorType` 弹模态「登录服务不可用」（云函数未部署或云环境不可用）/ 否则 toast `res.msg || '账号或密码错误'`。
- **`handleLoginSuccess`（`:73-103`）**：写 5 项 globalData + 5 项 storage → `showSuccess` → **按 `user.role === 'supplier'` 分流**：供应商 `reLaunch` 到 `supplier-home`（清 `currentStore`），内部 `switchTab` 到 `index`（清 `supplierInfo`）；两者都用 `setTimeout 1000ms` 等 toast 消失。
- **问题**：
  - **无 `submitting` 防重**（`:47-71` 按钮无 `disabled`，wxml `:36`/`:56` 只有 `bindtap`）。连点会并发多次 `login`：每次都在 `authService:213-216` 读-改-写 `sessions[]` 造成丢失更新（`full-scan-01` M4），并可能在 `:177-190` 自锁账号（L8）。**这是"用户自己能把自己锁 10 分钟"的唯一路径**。
  - **无验证码、无失败计数展示**：锁定后服务端返回"账号已锁定，请N分钟后重试"（`:171`），前端原样 toast，体验尚可，但攻击者无法被客户端侧拦住。
  - `login.wxss:120-196` 共 **77 行 `.history-*` 死样式**，对应的 wxml 与 js 逻辑已全部删除。

### 5.6 `pages/account`（162 行）

见 §3.5。补充：**无 `callFunction` 失败的空态**——页面永远渲染三段输入框，失败只靠 toast。`:41-48` 的 `submitting` 用 `disabled` + `loading` 双重禁用按钮（wxml `:25`），**是本批 8 页里唯一做了防重的提交按钮**。

### 5.7 `pages/message`（193 行）

见 §4。补充：
- `readMessage`（`js:31-71`）：本地 `findIndex(m => m.id === id)` → 未读才调 `markMessageRead` → 乐观更新本地 `read` 与 `unreadCount` → **然后才按 `bizId` 路由**。即"点未读消息会先发一次网络请求，回来后才跳转"，有可感知的延迟。
- **路由兜底逻辑有陷阱**（`:51-69`）：优先 `type`，`abnormal` 跳异常列表；`isReceiptMsg` 用 `type === 'receive' || String(bizId).indexOf('RCP') === 0`；否则跳 `purchase-detail?id=bizId`。**`purchase-detail` 的 `id` 参数在收货消息场景下是收货单号**（`seed-data/message.json:2` `biz_id: "RCP20260805001"`）——靠 `indexOf('RCP')` 兜底。一旦某天收货单号前缀改名，兜底即失效，会把收货单号当采购单号传进详情页。
- **`supplier` 分支的语义反转**（`:53-56`）：supplier 角色一律跳 `supplier-orders`，不看 `type`——即使 `type: 'abnormal'` 也跳订单列表。这是"供应商不该有异常列表页"的合理降级。
- 死代码 3 处：`:14`（`onShow` 内）、`:37`（`readMessage` 内）、`:74`（`markAllRead` 内）的 `const app = getApp()` 全部未使用。

### 5.8 `pages/supplier-messages`（174 行）

与 `message` 同构（见 §4.1）。差异点：
- **角色守卫的落地方式与其他三页相反**（`:16-18`）：`supplier-home:35-38`、`supplier-orders:41-44`、`supplier-receipts:23-26` 都是"非 supplier → `reLaunch('/pages/index/index')`"，只有本页是 → `reLaunch('/pages/login/login')`。
  **后果**：一个内部账号（`chef`/`purchaser`）如果通过任何途径进入 `supplier-messages`，会被踢到**登录页**，而他的会话其实还有效——用户会以为自己"被登出了"，被迫重新输密码。其他三页的正确做法是直接送回门店首页。P2（一致性缺陷 + 误导性登出）。
- **`:13` 的 `requireLogin` 与 `:16` 的角色判定存在冗余**：`requireLogin` 失败已 `reLaunch` 到登录页并 return，`:16` 的 `!app.globalData.isLoggedIn` 永假。同款死分支在 `supplier-home:29-32`、`supplier-orders:37-40`、`supplier-receipts:19-22`、`account:17-20` 共 5 处。

---

## 6. 前后端契约比对 + 导航闭环核对

### 6.1 逐个 `callFunction` 的解构路径比对

| 页面调用 | 前端解构路径 | 云函数实际返回 | 匹配 |
|---|---|---|---|
| `login.js:52` authService login | `res.code` / `res.data.{user,store,supplier,sessionToken,sessionExpiresAt}` / `res.errorType` / `res.msg` | `authService:232-246` 完全对应 | ✔ |
| `account.js:43` changePassword | `res.code` / `res.msg` | `authService:311` `{code:0}`（无 `msg`） | ✔（失败时 `:294-297` 有 `msg`） |
| `supplier-home:85` getSupplierOrders | `res.code` / `res.statusCounts` / （忽略 `data`） | `:131` `{code,data,total,page,pageSize,statusCounts}` | ✔ |
| `supplier-home:53` getMessages | `res.code` / `res.data` | `dataService:640` `{code,data}` | ✔ 但失败为嵌套 |
| `supplier-orders:68` getSupplierOrders | `res.code`/`res.data`/`res.total`/`res.statusCounts`/`res.msg` | 同上 | ✔ |
| `supplier-orders:121` confirmSupplierOrder | `res.code` / `res.msg` | `:119` `{code:0,data:{...}}` | ✔ |
| `supplier-receipts:39` getSupplierReceipts | `res.code`/`res.data`/`res.total`/`res.msg` | `:114` | ✔ |
| `supplier-prices:30` getProductPrices | `res.code`/`res.data`/`res.msg` | `:84` | ✔ |
| `message:15,38,75` / `supplier-messages:24,44,60` dataService 三 action | `result.code`/`result.data`/`result.msg` | 成功顶层 ✔；失败**嵌套** | ✘ 失败路径 |

**契约结论：本批 8 页全部是单层 `res.data` / `res.statusCounts` / `res.total`，不存在 `result.data.data` 双层嵌套风险。** 任务书点名的三个高风险点逐一排除：
- **双层嵌套**：0 处。
- **`_id`**：`dataService:601` 显式映射 `id: message._id`，前端 `wx:key="id"` / `data-id="{{item.id}}"` / `findIndex(m => m.id === id)` 三处一致 ✔；其余供应商页全部用业务 ID（`purchaseOrderId`/`receipt_item_id`/`price_id`），无 `_id` 依赖。
- **批量查询默认 limit 100**：**命中 2 处**——`dataService:634` 的 `getMessages` `.limit(100)` 与 `getSuppliers:67` 的 `.limit(100)`。前者导致 §4.3 的 P1，后者导致超管供应商列表静默截断。另 `getSupplierOrders:74` 是 `.limit(1000)`（`full-scan-02` H3 的截断点）。

### 6.2 字段级比对（wxml 引用 vs 云函数返回）

| wxml 引用 | 来源 | 判定 |
|---|---|---|
| `supplier-orders.wxml:17` `wx:key="purchaseOrderId"` | `cloud.js:146` 归一化生成 | ✔ |
| `:27` `wx:key="itemId"` / `:29-30` `productNameSnapshot`/`orderQty`/`unitSnapshot` | `cloud.js:126,128,133,130` | ✔ |
| `:38,39` `data-id="{{item.purchaseOrderId}}"` → `confirmOrder:104` `dataset.id` | 同上 | ✔ 名称一致 |
| `:20` `tag-{{item.confirmType}}` | `meta.js:23-29` 返回 `{text,type}` | ✔ |
| `:10-11` `statusCounts[item.key]` | `getSupplierOrders:106` 6 键全覆盖 5 个 tab | ✔ |
| `supplier-receipts.wxml:3` `wx:key="receipt_item_id"` | `seed-data/receipt_item.json` 确认存在 | ✔ |
| `:9` `receipt_id`/`purchase_order_id`/`store_name` | `getSupplierReceipts:105-108` 显式补 | ✔ |
| `:19` `item.remark` | `receipt_item.remark` 原样（`...item` 展开） | ✔ |
| `supplier-prices.wxml:7` `wx:key="price_id"` | `supplier_product_price.price_id` 原样 | ✔ |
| `:9` `product_name` / `:10` `unit` | `getProductPrices:79-80` 显式补 | ✔ |
| `:12` `effective_date` | 原样 | ✔ |
| `message.wxml:8`/`supplier-messages.wxml:8` `item.id` | `dataService:601` | ✔ |
| `supplier-home.wxml:28` `wx:key="key"` → `data-status="{{item.key}}"` | `js:17-20` stats 三项 | ✔ |

**8 页共 12 个 `wx:for`，全部带 `wx:key`**（`supplier-receipts.wxml:21` 用 `index`，是唯一非稳定 key）。**8 页共 25 个 `data-*` 属性与 25 个 handler 读取名逐一比对，0 处不一致**。

### 6.3 导航闭环

**`app.json` 注册 26 页，tabBar 4 项：`index` / `purchase-list` / `report-list` / `message`。** `supplier-home` 及另外 4 个供应商页**都不在 tabBar**。

供应商登录落点验证：
```
login.js:90  user.role === 'supplier'
  → :91-92  存 supplierInfo、清 currentStore
  → :94     wx.reLaunch('/pages/supplier-home/supplier-home')   ← 非 tab 页，tabBar 不显示 ✔
  → supplier 的可达集 = supplier-home（根）+ navigateTo 4 页 + account
login.js:98  非 supplier
  → :99     存 currentStore、清 supplierInfo
  → :101    wx.switchTab('/pages/index/index')                   ← tab 页 ✔
```

**闭环成立的 4 道闸门**：
1. `login.js:90` 按角色分流，供应商永不 `switchTab` 到内部 tab。
2. `index.js:31-34`：内部首页对 supplier 角色 `reLaunch` 回 `supplier-home`。
3. `supplier-home:35-38` / `supplier-orders:41-44` / `supplier-receipts:23-26`：供应商页对非 supplier 角色 `reLaunch` 回 `index`。
4. `supplier-messages:16-18`：同上（但落点是**登录页**，见 §5.8）。

**`switchTab` 到不存在于自己 role 的页面会怎样**：不存在这种路径——`switchTab` 只在 `login.js:101`、`index.js:130,159,165`、`purchase-list` 内部使用，且 4 个 tab 页都在 tabBar 配置里。若强行 `switchTab('/pages/supplier-home/supplier-home')`（不在 tabBar），微信会直接失败回调、无降级；但代码里**没有任何一处这样做**。

**真正的缺口**：`message` 是 tabBar 页却**没有角色守卫**（`message.js:12-13` 只 `requireLogin`）。供应商若通过外链/分享卡/开发工具直接打开 `pages/message/message`，会看到 4 个 tab 且能点进 `purchase-list`/`report-list`。数据层仍被服务端挡住（`getPurchaseOrders` 对 supplier 直接 `-403`，`getReports` 同理），所以**不产生越权**，但会产生"供应商在采购列表页看到满屏'加载失败'"的错误态体验。建议给 `message` 补角色守卫，或至少给 `purchase-list`/`report-list` 加与 `supplier-home:35-38` 同款的重定向。

---

## 7. 凭据泄露专项

### 7.1 grep 覆盖

搜索模式：`Admin@2026|Chef@2026|Manager@2026|Purchaser@2026|Supplier@2026`、`123456`、`password`、`openid`、`admin`、`test`。

| 位置 | 内容 | 判定 |
|---|---|---|
| **`seed-data/README.md:23-29`** | 表格列出 5 个初始明文口令 `Admin@2026` / `Chef@2026` / `Manager@2026` / `Purchaser@2026` / `Supplier@2026` | **明文口令入库** |
| `seed-data/README.md:21` | 声称"app_user 中只保存 PBKDF2 密码哈希，不保存明文密码" | **该文件内部自相矛盾**：数据层面确实干净（`:21` 正确），但同文件 `:23-29` 就是明文 |
| `seed-data/app_user.json:1-5` | 仅 `password_salt`/`password_hash`/`password_iterations:120000` | ✔ 无明文 |
| `seed-data/supplier_test_user.jsonl:1` | 同上，`username: "supplier_test"`，哈希 `d9d2c549…` | ✔ 无明文 |
| `pages/**/*.js`、`utils/**`、`app.js`、`app.json` | `grep -i "password\|openid\|admin\|test"` 全部命中均为**字段名或角色字符串**（`currentPassword`/`isSuperAdminLogin`/`role: 'super_admin'`/`latestMessage`） | **0 处硬编码口令、0 处硬编码测试账号名** |
| `README.md:68,93` | 提及 `app_user.openid` 字段用途 | ✔ 文档描述 |
| `业务模糊点确认清单.md` | 无口令 | ✔ |
| `log.md` / `review.md` / `采购流程图.html` | 无口令 | ✔ |
| `docs/exploration/*.md` | `batch1:1046-1050`、`full-scan-08:419` 复述了这 5 个口令 | 二次扩散（分析文档内） |

### 7.2 入库状态（关键）

```
$ git ls-files seed-data
seed-data/README.md          ← 含明文口令
seed-data/app_user.json
seed-data/supplier_test_user.jsonl
…共 14 个文件，全部已追踪
```
而 `.gitignore:9` 写了 `seed-data/`。**`.gitignore` 对已追踪文件无效**——所以这些口令**已经在 git 历史里**，即使现在删掉工作区文件，历史提交里仍可取回。

`controller-horizontal-scan-20261003.md:392` 给出的修复方案是 `git rm -r --cached seed-data/` + 提交 + **轮换那 5 个口令**。**在 HEAD 5268379 下两项都未执行**：文件仍在追踪，口令未轮换。这是全项目**改动成本最低、收益最高**的一项（配合 F1 的 6 行修复）。

### 7.3 口令强度评估

5 个初始口令均为「角色名首字母大写 + @2026」模式（`Admin@2026`/`Chef@2026`/…），**结构高度可预测，可用字典秒破**。PBKDF2 12 万次迭代（`authService:11`）对单机离线暴力有一定抗性，但对「已知结构 + 已知账号名」的猜测毫无意义。加上 §3.2 的「不存在用户名不限速」，**这 5 个口令等于把生产系统的入门凭据公开在仓库里**。

---

## 8. 旧结论复核表 + 【待核实】回收表

### 8.1 与本批相关的旧结论复核

| 旧结论 | 出处 | HEAD 5268379 下判定 | 依据 |
|---|---|---|---|
| **F1**：dataService/importProducts 鉴权失败嵌套结构 → 会话过期不跳登录 | `controller-horizontal-scan.md:10-16` | **仍成立，且本批新命中 3 页** | `dataService:47,49` 未改；`cloud.js:68` 未改；`getMessages:614`/`markMessageRead:644`/`markAllMessagesRead:666` 原样透出 |
| **H10**：F1 精确化为 3 个 helper、6 处嵌套 | `controller-horizontal-scan-20261003.md:147-179` | **仍成立，行号全部准确** | `authService:336,337`；`dataService:47,49`；`importProducts:54,56` 三处 helper 未动 |
| H10「没有一处检查 `result.error`」 | 同上 `:177` | **仍成立** | 全项目 `grep \.error\b` 依旧只有 6 处 `console.error` |
| **full-scan-01 H1**：authService 9 个超管 action 嵌套，波及 8 个调用点 | `full-scan-01:309-313` | **仍成立** | 调用点 `:342-343/:352-353/:394-395/:443-444/:474-475/:507-508/:581-582/:613-614` 行号准确 |
| **full-scan-01 M2**：停用再启用后旧 token 复活 | `:317-321` | **仍成立** | `authService:490-493` 的 `if (status === 0)` 分支仍只清 legacy 字段、未清 `sessions` |
| **M4**：并发登录丢失更新 | `:329-333` | **仍成立** | `:213-216` 读-改-整体写回未改 |
| **M5**：角色清单 7 处独立来源 | `:335-338` | **仍成立** | `dataService:9` 的 `MANAGEMENT_ROLES` 与 `:8` 同值冗余仍在 |
| **M6**：管理面单点依赖魔法字符串 `'admin'` | `:340-343` | **仍成立** | `authService:417,419,484` |
| **L4**：改密文案「当前会话」vs 实际「所有设备」 | `:356-357` | **仍成立** | `account.wxml:26` 与 `authService:305` |
| **L5**：`account.js:16-20` 死代码 | `:359-360` | **仍成立** | 行号准确 |
| **L6**：`message.js` 3 处未使用 `getApp()` | `:362-363` | **仍成立** | `:14`/`:37`/`:74` |
| **L7**：`getStores` 对 supplier 不收敛 | `:365-367` | **仍成立** | `authService:319-331` |
| **L8**：登录按钮无防重 → 用户可自锁 | `:369-371` | **仍成立** | `login.js:47-71` 与 wxml `:36`/`:56` 无 `disabled` |
| **L9**：登录文案泄露账号状态；不存在用户名不限速 | `:373-375` | **仍成立** | `authService:167` 的 `if (user)` 包住全部锁定逻辑；`：171/:192/:194` 三条文案 |
| **L13**：消息中心无 TabBar 角标 | `:386-387` | **仍成立** | 全项目 0 处 `setTabBarBadge`/`showTabBarRedDot` |
| **L14**：消息图标口径 vs 路由口径不一致 | `:389-390` | **仍成立** | `message.wxml:11-15` 只认 4 种 type，`message.js:61-62` 认 `bizId` 前缀 |
| **L18**：`login.wxss:120-196` 77 行死样式 + `account_history` 死键 | `:404-305` | **仍成立** | 全项目 0 处写入 `account_history` |
| **full-scan-01 待核实 #4**：`getSuppliers` 是否鉴权/收敛 | `:416` | **已解答（本批）** | `getSuppliers:41-42` 有鉴权；`:45-52` 对 supplier 收敛正确；但 **`:58-59` 的 `status` 参数绕过角色闸门**（见 §2.5） |
| **full-scan-01 待核实 #9**：supplier 角色能否触达其他数据面 | `:421` | **已解答（本批）** | 4 个供应商读接口 + `confirmSupplierOrder` 的 `supplierId` 全部服务端派生，前端 0 处传参；但 `getSupplierOrders:126-129` 主表全量展开造成**信息面越界**（见 §2.3） |
| **batch1 §1.6**：`markMessageRead` 供货商可越权标记全局广播已读 | `batch1:88-101` | **仍成立** | `dataService:650-653` 未加 `scope_type` 复查 |
| **batch1 §1.5**：`requireUser` 无角色参数的 6 个 action 是弱鉴权 | `batch1:86` | **仍成立** | `dataService:612/643/665` 仍 `requireUser(event)` 无角色参数 |
| **full-scan-02 §7.3**：`getSupplierOrders` 不泄漏其他供应商商品 | `full-scan-02:252-254` | **部分成立，需修正** | `items` 确实按 `supplier_id` 过滤 ✔；但**主表 `...order` 未过滤**，导致 `supplier_confirmations`（含其他供应商状态）与 `audit_remark` 泄露（见 §2.3） |
| **full-scan-02 H3**：供应商订单全量 1000 行截断 + `created_at` 排序失效 | `:305-309` | **仍成立** | `getSupplierOrders:71-75,116,118` 未改 |
| **full-scan-02 L5**：`approved` 下 confirm/ship 可互相覆盖 | `:391` | **仍成立** | `confirmSupplierOrder:12-13,73-77` |
| **S3 供货商无系统内消息触达** | `业务模糊点确认清单.md:383,747` | **部分缓解** | 新订单已有 `scope_type:'supplier'` 站内消息（`dataService:324-331`）；作废/改量/取消仍只发内部（`:1321-1328` 无 `scopeType`）；**且订阅消息推送链路两端模板 ID 均为空字符串，实际等于完全无触达** |
| `full-scan-08` L-11：`supplier_test_user.jsonl` 是孤儿文件 | `full-scan-08:645` | **仍成立** | 全项目 0 处 `collection('supplier_test_user')` |

**没有任何一条旧结论在 HEAD 5268379 下被修复。** HEAD 提交信息 `fix(pages): navigation, permissions, loading states and guard rails` 的成果落点在其他批次页面（如 `report-list.js:128` 的守卫），本批 8 页的最后一次实质改动是 `05dadc4`/`7288de3`（登录页 logo 与居中）。

### 8.2 【待核实】回收

| # | 原问题 | 本次判定 |
|---|---|---|
| 1 | `getSuppliers` 是否鉴权、是否按角色收敛 | **已解决**：鉴权 ✔、supplier 收敛 ✔、但 `status` 参数可绕过（§2.5 新增 P1） |
| 2 | `getSupplierOrders` 信息边界 | **已解决**：主表未过滤，`audit_remark`/`supplier_confirmations`/`verify_*` 泄露（§2.3 新增 P0） |
| 3 | `created_at` 回读形态（Date 还是 ISO 字符串） | **仍待核实**：需云函数控制台实测一次。代码侧证据是 `cloud.js:81-83` 专门处理 `instanceof Date`，说明回读可能为 Date |
| 4 | `supplier_test_user.jsonl` 是否参与运行时 | **已解决**：不参与，0 处引用，孤儿文件 |
| 5 | 供应商能否看到采购单编号/内部备注/审批意见 | **已解决**：采购单号 ✔（设计内）、订单/商品备注 ✔（设计内）、**审批意见 `audit_remark` ✘ 泄露**、**跨供应商确认状态 ✘ 泄露** |
| 6 | `verify_voucher_file_ids` 能否被供应商换取文件真链接 | **待核实**：需确认 `getTempFileURL` 是否为公开云函数。若供应商持有 fileID 即可调用，则凭证照片可被下载 |

---

## 9. 新问题清单

### P0（本批新增或本批首次定位）

**P0-1｜`getSupplierOrders` 把 `purchase_order` 主表全量展开发给供货商**
`cloudfunctions/getSupplierOrders/index.js:126-129`。`{...order, items}` 中的 `...order` 未做字段白名单，落地泄露 `audit_remark`（内部驳回理由，写入点 `dataService:553`）、`audited_by`（内部审批人姓名，`:554`）、`supplier_confirmations`（**同单所有供货商的确认/发货状态，横向比价**）、`verify_note`/`verify_reject_note`/`verify_amount`/`verify_voucher_file_ids`、`created_by`、`request_id`、`missing_reports`。前端只渲染 10 个字段，但报文到达设备端。
**修复**：改为显式字段白名单展开，约 15 行。对照同批 `getSupplierReceipts:90-95` 只取 4 字段的正确写法。

**P0-2｜F1/H1 嵌套结构问题，本批 3 个页面命中会话过期静默退化**
`dataService/index.js:47,49` → `getMessages:614` / `markMessageRead:644` / `markAllMessagesRead:666` → `utils/cloud.js:68` 只判 `result.code === -401`（嵌套时为 `undefined`）。`message`、`supplier-messages`、`supplier-home` 三页会话过期不跳登录页，只弹兜底文案或静默归零。
**修复**：把 3 个 helper 的 `{error:{...}}` 拍平（`dataService:47,49`、`importProducts:54,56`、`authService:336,337`），共 6 行，前端零改动。

**P0-3｜5 个生产口令明文入库且已在 git 历史**
`seed-data/README.md:23-29`；`.gitignore:9` 写了 `seed-data/` 但未 `git rm -r --cached`，14 个文件仍在追踪。口令结构 `Xxx@2026` 高度可预测。
**修复**：`git rm -r --cached seed-data/` + 轮换 5 个口令 + 从 README 移除明文列（改为"首次部署由云函数生成随机口令"）。

### P1

**P1-1｜`getSuppliers` 的 `status` 参数绕过角色闸门**
`getSuppliers/index.js:54` 只挡 `includeInactive`，`:58-59` 对 `status` 值不做角色判定 → `chef`/`store_manager` 传 `status: 0` 可枚举已停用供应商的 `contact_name`/`contact_phone`/`address`。`:61` 的 `keyword` 直通 `db.RegExp` 无长度/字符校验，与 `status: 0` 叠加可精确搜出目标。
**修复**：`:58` 改为 `if (isManager && status !== undefined ...) query.status = status`。

**P1-2｜消息 limit-100 截断使老消息永远清不掉**
`dataService:634` `.limit(100)` → `message.js:27` 的 `unreadCount` 只数最新 100 条 → `markAllMessagesRead:669-679` 也只遍历同一份 100 条。未读超过 100 条后：红点数字错误、"全部已读"失效、老消息永久残留为未读。
**修复**：`getMessages` 增加 `countUnread` 服务端聚合返回，或 `markAllMessagesRead` 改为条件更新 `db.collection('message').where(<与 getMessages 同源的查询>).update({data:{read_by: _.push(userId)}})` 一次完成。

**P1-3｜`supplier-orders` 切 tab 丢请求显示脏数据**
`supplier-orders.js:56-58`（先 `setData({activeTab})` 再 `reload()`）+ `:66`（`if (this.data.loading) return`）→ 请求在途时切 tab，新 tab 标签下显示旧数据与旧计数。
**修复**：用递增 `reqSeq` 丢弃过期响应，或在 `reload` 时先取消在途请求。

**P1-4｜`supplier-orders` 的 `canConfirm` 与服务端白名单不一致**
`supplier-orders.js:98` `canConfirm: order.my_confirm_status === 'pending'`，忽略 `order_status`；服务端 `confirmSupplierOrder:12` 仅允许 `['submitted','approved']`。订单进入 `report_generated`/`to_receive`/`partial_received` 后仍显示"确认接单"，点击必被 `:82` 拒（返回「订单不存在或当前状态不可操作」）。用户会误以为系统故障。
**修复**：前端 `canConfirm` 增加 `order.orderStatus` 白名单判定，或与 §2.3 的字段白名单一并收敛（服务端不下发 `order_status` 的可操作性子集时，前端无法自行判定）。

### P2

**P2-1｜`supplier-messages` 角色守卫把内部用户踢到登录页**
`supplier-messages.js:16-18` → `reLaunch('/pages/login/login')`；其余三页（`supplier-home:35-38`、`supplier-orders:41-44`、`supplier-receipts:23-26`）都是 → `reLaunch('/pages/index/index')`。会话有效的内部账号误入本页会被迫重新登录。

**P2-2｜`message` 页无角色守卫，供应商可触达内部 tabBar**
`message.js:12-13` 只 `requireLogin`。数据层仍被服务端挡住（无越权），但供应商会看到 4 个内部 tab 且点进 `purchase-list`/`report-list` 后满屏错误态。

**P2-3｜失败态伪装成空态（4 页）**
`supplier-orders.wxml:43`、`supplier-receipts.wxml:25` 的 `length === 0 && !loading` 在**请求失败**时也显示「暂无相关订单/收货记录」；`message.wxml:26`、`supplier-messages.wxml:23` 无 loading 字段与错误态，加载失败时显示「暂无消息」。四页均无 `enablePullDownRefresh`，用户唯一恢复手段是退出重进。

**P2-4｜`supplier-home` 两个失败分支静默 return**
`supplier-home.js:54`（`loadNotice`）与 `:86`（`loadStats`）失败时无 toast、无降级文案，首页表现为红点消失 + 统计恒为 0。

**P2-5｜供应商订阅消息链路两端模板 ID 为空，整条链路是死代码**
`supplier-home.js:7` `NEW_ORDER_TEMPLATE_ID = ''`（`:76` 直接 return）、`dataService:244` `SUBSCRIBE_TEMPLATE_ID = ''`（`:335-344` 的推送循环永不执行）。供应商**只能主动打开小程序**才能看到新订单，"触达"能力实际为零。`业务模糊点确认清单.md:383` 记录的 S3 缺口因此**并未真正缓解**。

**P2-6｜`supplier-receipts` 前端自算异常与服务端异常记录两套口径**
`supplier-receipts.js:53` 只判 `receivedQty !== orderQty || payable_flag === false`；服务端在数量收齐时也可能因缺价写异常（`full-scan-02` H1）→ 同一行可能同时显示绿色「正常」标签与异常记录文本，对账时互相打脸。

**P2-7｜`getSuppliers` 对 `chef`/`store_manager` 返回全量供应商**
`getSuppliers:53` `isManager` 只认 super_admin/purchaser，但未对门店角色做任何收敛——`chef` 调用会拿到所有启用供应商（含联系方式）。若这是有意设计（门店下单需选供应商）则应加注释；否则属范围过宽。

**P2-8｜`getStores` 对 supplier 不收敛**（`full-scan-01` L7，本批复核仍成立）
`authService:319-331` 仅 `STORE_ROLES` 收敛到 `default_store_id`，supplier 调用可枚举全部门店名与编号。当前无 supplier 页面调用，但持 token 直接调用即可枚举。

**P2-9｜`markMessageRead` 不做可见集复查**（batch1 §1.6，本批复核仍成立）
`dataService:650-653` 只做字面归属判定，不校验 `scope_type` → 供货商拿到消息 `_id` 即可越权标记全局广播已读。影响限于读状态。

### P3（清理项）

- **P3-1** `account_history` 死键：`index.js:150`、`login.js:86`、`supplier-home.js:131` 三处 `removeStorageSync` 无任何写入方；配套 `login.wxss:120-196` 共 77 行 `.history-*` 死样式。
- **P3-2** 5 处永假死分支：`account.js:17-20`、`supplier-home.js:29-32`、`supplier-orders.js:37-40`、`supplier-receipts.js:19-22`、`supplier-messages.js:16`（`requireLogin` 已保证 `isLoggedIn`）。
- **P3-3** `message.js:14,37,74` 三处未使用的 `const app = getApp()`。
- **P3-4** `index.js:146-150` 的退出登录漏清 `supplierInfo` 与 `globalData.supplierInfo`（`supplier-home.js:124,128` 都清了）。三处清理逻辑三套实现。
- **P3-5** `supplier-prices` 无分页提示：服务端 `getProductPrices:60` `limit(200)`，前端无 `onReachBottom` 且无「已加载全部 N 条」footer（对照 `supplier-receipts.wxml:30` 有）。
- **P3-6** `supplier-home.js:85` 用 `pageSize:1` 只为拿 `statusCounts`，服务端仍全量拉 1000 行明细 + 全量查订单；`:52-62` 的 `loadNotice` 与 `:83-93` 的 `loadStats` 重复调用 `getMessages`/`getSupplierOrders`，与 `index.js:41-56` 的 `Promise.all` 并发模式不同步。
- **P3-7** `supplier-receipts.wxml:21` 用 `wx:key="index"`（8 页 12 个 `wx:for` 中唯一的非稳定 key）。
- **P3-8** `supplier-home.js:117` `showConfirm` 的弹窗失败被 `utils/util.js:91-93` 当作"取消"，退出登录流程在弹窗失败时静默视为取消。

---

## 10. 遗留【待核实】

| # | 待核实项 | 需要什么 |
|---|---|---|
| 1 | `getSupplierOrders` 返回的 `created_at` 回读形态（Date 对象 vs ISO 字符串）——决定 `full-scan-02` H3 的排序问题是否成立 | 云函数控制台跑一次 `getSupplierOrders`，打印 `typeof data[0].created_at` |
| 2 | `purchase_order.verify_voucher_file_ids` 里的 fileID 能否被供应商用 `getTempFileURL` 换出真链接（若 `getTempFileURL` 是无鉴权云函数，则凭证照片可被下载） | 查 `cloudfunctions/` 是否有公开可访问的取链接函数；本批范围内只有 `cloud.js:243-268` 的**前端** `getFileUrl`，前端直调 `wx.cloud.getTempFileURL` 意味着**任何登录用户（含供应商）都能解析任意 fileID** |
| 3 | `getSuppliers` 对 `chef`/`store_manager` 返回全量供应商是否为产品设计（P2-7） | 产品确认 |
| 4 | 供应商端「确认接单」按钮在 `report_generated` 等状态下展示，是否为业务方期望（P1-4） | 产品确认；若期望"审批后仍可补确认"则应改服务端白名单而非前端 |
| 5 | 5 个初始口令的轮换责任人（P0-3） | 运维执行，非代码问题 |
| 6 | `getMessages` 的 `limit(100)` 是否已知的业务上限（P1-2）——若确认 100 条是设计上限，则 `unreadCount` 的红点错误是必然结果，需要产品接受或改为服务端聚合 | 产品确认 |
