# 主控横向扫描记录（跨批交叉发现）

> 目的：子代理各自被限定在批次边界内，看不到"云函数返回结构 × 前端消费方式"这类横跨
> 批次的缺陷。本文件记录主控自己跑的横向正则扫描与实测结论。
> 时间：2026-10-02 · 方法：全项目 Grep + node 实测
> 纪律来源：`[[trust-code-not-comments]]` —— 结论必须实测或读码体，不接受注释与字面 grep 结论。

---

## F1. dataService / importProducts 鉴权失败结构不一致 → 会话过期不跳登录（高）

**服务端**（嵌套结构，`error` 包一层）：
- `cloudfunctions/dataService/index.js:47` → `return { error: { code: -401, msg: '登录已过期，请重新登录' } }`
- `cloudfunctions/dataService/index.js:49` → `{ error: { code: -403, msg: '当前账号无权执行该操作' } }`
- `cloudfunctions/dataService/index.js:56` → `if (auth.error) return auth.error`（原样返回嵌套结构）
- `cloudfunctions/importProducts/index.js:54,56,84` → 同上

**前端**（只查顶层）：
- `utils/cloud.js:68` → `if (result.code === -401) { handleSessionExpired() }`
- 全项目 57 个 `callFunction` 调用点，**没有任何一处检查 `result.error`**
  （Grep `\.error\b|result\.code|res\.code` 覆盖全部 pages，命中 57 行，无一含 `.error`）

**后果链**：
1. 会话过期 + 用户调任意 dataService action（共 22 个：auditOrder / cancelOrder / requestCancel /
   remindAudit / verifyManualOrder / settleReceipt / repriceReceipt / regenerateReceiptReports /
   regenerateOrderReports / startAbnormal / resolveAbnormal / closeAbnormal / getAbnormalRecords /
   getMessages / markMessageRead / markAllMessagesRead / getOrderStats / getCategories /
   saveProduct / toggleProduct / saveSupplier / toggleSupplier）
2. 服务端返回 `{ error: { code: -401, msg } }`
3. `utils/cloud.js:68`：`result.code` 为 `undefined`，`undefined === -401` 为 false → **不触发跳登录**
4. 页面判定 `result.code !== 0`（`undefined !== 0` 为 true）→ 走失败分支
5. `util.showToast(result.msg || '通用文案')`：`result.msg` 为 `undefined` → **显示页面的兜底文案**
   （如 abnormal-list 显示"异常处理状态更新失败"），而不是"登录已过期，请重新登录"
6. 用户不被踢回登录页，可无限重复点击无效按钮

**影响面**：dataService 全部 22 个 action + importProducts 导入。
同一故障也吞掉 dataService 的 `-403`（无权限）→ 越权操作被降级成页面通用文案，用户不知道是权限问题。

**对照**：`authService` / 其余 18 个云函数返回扁平 `{ code, msg }`，工作正常。
`pages/account/account.js:50-54` 明确写了 `if (res.code !== -401)` 的注释"已由 utils/cloud.js 统一拦截"——
该假设对 authService 成立，对 dataService 不成立。

**修复方向**（两处择一即可，前者更彻底）：
- `dataService` 与 `importProducts` 的 `requireUser` 改为返回扁平 `{ code, msg }` 并由调用点直接 `return`
- 或 `utils/cloud.js:68` 同时判 `result.code === -401 || (result.error && result.error.code === -401)`，
  并在返回前拍平 `result.error`

---

## F2. app.js 的 parseExpires 比 utils/cloud.js 的 parseDateValue 弱（中，部分待核实）

两处都是为绕 iOS JSCore 无法解析 `"2026-10-09 12:00:00"` 而做 `-`→`/` 变换，但实现质量不同。

**`app.js:15-20`（弱）**：
```js
const parseExpires = value => {
  if (!value) return NaN
  if (typeof value === 'number') return value
  const date = new Date(String(value).replace(/-/g, '/').replace('T', ' '))
  return date.getTime()
}
```

**`utils/cloud.js:78-110`（强）**：处理数字、数字字符串、ISO、`$date`/`$timestamp`/`timestamp`/`value`/
`$numberLong`、BSON `{$date}`、`{seconds, nanoseconds}`、`toDate()`/`getTime()`。
且数字分支有量级判断：`Math.abs(value) < 1e12 ? value * 1000 : value`（秒/毫秒自适应）。

**app.js 缺失的能力（node 实测确认）**：
| 输入 | app.js 结果 | cloud.js 结果 |
|---|---|---|
| `'2026-10-09T00:57:00.123Z'`（服务端实际格式） | 正确（V8 兼容 trailing Z） | 正确 |
| `1760000000`（秒级数字） | **当作毫秒 → 1970-01-21 → 会话判无效 → 强制登出** | 正确（×1000） |
| `'1760000000000'`（数字字符串） | **`new Date('1760000000000')` → Invalid → 强制登出** | 正确 |
| `'2026-10-09 00:57:00'` | 正确 | 正确 |

**待核实**：JSCore（iOS）对 `new Date('2026/10/09 00:57:00.123Z')` 是否尊重尾部 `Z`。
V8 尊重（node 实测 getTime 与原文完全一致，偏移 0 小时）；JSCore 若忽略 Z 会按本地时间解析，
在中国时区（UTC+8）会让会话**提前 8 小时过期**（7 天 TTL 变 6 天 16 小时）。需真机验证。
建议直接把 app.js:15-20 换成 `cloud.parseDateValue`（需 export）以消除分叉。

**注意**：`app.js:18` 的 `.replace('T', ' ')` 无 `/g`，只替换首个 `T`。ISO 串只有一个 `T` 所以当前无害，
但属隐性脆弱写法。

---

## F3. `companyInfo` 是死字段（低）

`app.js:121` 声明 `companyInfo: null`，**全项目 grep 仅此 1 处命中**，从未被赋值或读取。

---

## F4. index 页登出漏清 supplierInfo（低）

`pages/index/index.js:142-150` 登出手动逐字段清理，**漏了 `supplierInfo`**（既不设 `globalData` 为 null，
也不 `removeStorageSync`）。

对照：
- `pages/supplier-home/supplier-home.js:124,128` → 清 `globalData.supplierInfo` + storage ✅
- `app.js:74` `clearSession()` → 5 个 key 全清（含 supplierInfo）✅
- `pages/account/account.js:59-60` → 直接调 `app.clearSession()` ✅（最干净）

**实际影响**：低。`app.js:27-29` 仅在 `userInfo.role === 'supplier'` 时恢复 supplierInfo，
而登出已清 userInfo；`login.js:80` 每次登录都会覆写 `globalData.supplierInfo = supplier || null`。
但这是**防御缺口**：index 的登出是手写的三份拷贝之一，与 `clearSession()` 语义漂移。
建议 index/supplier-home 两处统一改调 `app.clearSession()`。

---

## F5. 两个不可达端点（中）

**服务端有、全项目无任何调用方**（云函数之间也不存在 `callFunction` 互调 ——
Grep `callFunction` in `cloudfunctions/` **0 命中**）：

1. `authService.deleteUser`（`authService/index.js:497,660`）
   —— 有意的软删除别名。`业务模糊点确认清单.md:584-585` 记录：2026-09-28 收成纯软删除，
   内部直接落 `setUserStatus(status: 0)`，无物理删除出口。前端已无入口。属设计决策，非缺陷。

2. `dataService.regenerateOrderReports`（`dataService/index.js:986,1546`）
   —— **这个是真缺口**。`业务模糊点确认清单.md:367` 明确把 `regenerateOrderReports`
   记为"缺报表补生成入口"（并对比 `regenerateApprovedOrderReports`），
   `cloudfunctions/createPurchaseOrder/index.js:436` 的注释也指望它兜底。
   但全项目无任何调用点 → **订货报表 ①② 生成失败后没有补生成入口**，
   只有收货报表有 `regenerateReceiptReports`（receive-list.js:146 有按钮）。
   与清单 L779 声称的"已闭环"不符。

---

## F6. 纠正批 1 的两条字面结论

**批 1 称"supplier.address 全项目 grep 0 命中"** —— 字面错误：
`utils/cloud.js:194` `address: supplier.address || ''`。

**但更深的真相（补充实测）**：全项目 `pages/` 下 grep `address|地址` **0 命中**。
即 `normalizeSupplier` 归一化出的 address 字段**无人消费**，是死代码；
seed-data 的 6 条 address 也不被展示。

**结论修正**：批 1 的功能判断（"新建供应商永远无 address"）成立，但机制写错了——
不是"代码不读"，而是"前端读到一个后端从不写值的字段"。
若日后给 supplier-manage 加地址录入，会踩到"前端有字段、后端 saveSupplier 不写"的坑
（`dataService.saveSupplier` 写 `{supplier_name, contact_name, contact_phone, remark, updated_at}`）。

---

## F7. `pending_approval` 是死状态，但前端仍在引用（低）

批 1 已确认 `pending_approval` 与 `report_generated` 全项目无任何写入点。
补充：`pages/approval-list/approval-list.js:33` 仍在 filter 里引用它：
```js
.filter(o => o.orderStatus === 'submitted' || o.orderStatus === 'pending_approval')
```
无害（永不匹配），但属陈旧状态模型的残留信号。

---

## F8. tabBar 无供货商入口（设计观察）

`app.json:37-67` tabBar 仅 4 个管理侧 tab：index / purchase-list / report-list / message。
供货商 5 个页面（supplier-home / supplier-orders / supplier-receipts / supplier-prices /
supplier-messages）**全部不在 tabBar**，靠 supplier-home 内手动跳转导航。
`login.js:94` 供货商登录后 `reLaunch` 到非 tab 页 supplier-home → tab 栏不显示。
这是"供货商独立门户"的刻意设计，但意味着供货商侧没有常驻导航，
且供货商若误入 index（tab 页）会看到管理侧首页。

---

## F9. 前端金额 toFixed 分布（供批次 2/3 参照）

全项目 `toFixed` 命中：
- 服务端 CSV 生成：`createReceipt:593,595,676,678`、`dataService:961,963,1180,1182,1240,1242`、
  `generateSummaryReport:222,224` —— 统一 `.toFixed(2)` ✅
- **口径分叉**：`getReportDetail:118,189` 用 `(qty*price).toFixed(2) * 1`
  （与 CSV 的 `Math.round(x*100)/100` 不同，且无 NaN 保护 —— 批 1 已记）
- 前端：`report-detail.js:55`（`sum.toFixed(2)`）、`supplier-receipts.js:70-71`、`supplier-prices.js:38`
- **前端仅 3 处格式化金额**，其余页面金额显示依赖服务端已格式化值或原始 Number

---

## 附：状态机全景（横向 grep 结果）

`order_status` 实际取值（写入点）：`draft` / `submitted` / `received` / `partial_received` /
`receipt_abnormal` / `cancelled` / `rejected`
- 写入：`createPurchaseOrder:114,344`；`createReceipt:305,387`；
  `dataService:1301`（cancelled）等
- `getPurchaseOrders` 的 `status` 入参取值：`to_verify`（L70）/ `receivable`（L73）
  —— 这两个**不是** order_status 值，是查询分组别名，映射到内部状态过滤
- 死状态（有读白名单、无写入点）：`pending_approval`、`report_generated`
- 独立状态机：`verify_status`（`pending` / `approved` / 相关）、`audit_reminded_at`
