# 00 · 跨域已核实事实（主代理亲验，非子代理转述）

> 基线：`backup` @ `73b0730`（2026-10-05，audit）
> 方法：每条结论均由主代理直接用 Read / Grep / PowerShell 独立取证，**不依赖任何子代理的报告**。
> 目的：给其余 6 份函数级报告提供已锁定的事实，避免重复劳动与相互矛盾。

---

## 一、仓库规模（实测）

170 个代码文件 / 16,295 行。明细见同目录 `_file-manifest.csv`。

| 域 | 文件 | 行数 |
|---|---|---|
| pages | 104 | 8,582 |
| cloudfunctions | 38 | 5,950 |
| utils | 4 | 492 |
| 外壳 app.* | 5 | 530 |
| scripts + styles | 3 | 428 |
| seed-data | 15 | 290 |

云函数单文件行数前三：`dataService` 1692、`createReceipt` 807、`authService` 684。
`styles/icons.wxss` 49KB 仅 109 行、`scripts/icons-preview.html` 同理 → 确认是 `scripts/build-icons.js` 的压缩生成物，无需通读。

## 二、旧报告行号偏移（实测 diff hunk）

`73b0730` 相对 `07b6461` 只改两个云函数（+24/-5），新增 `cloudPathOfFileId()`：

| 文件 | diff hunk | 结论 |
|---|---|---|
| `dataService/index.js` | `@@ -1554,10 +1561,11 @@` | 第 21 行起 **+7** |
| `createReceipt/index.js` | `@@ -219,9 +226,10 @@` | 第 52 行起 **+7** |

→ `docs/exploration/coverage-20261004/INDEX.md` 中所有 `dataService:1560`、`createReceipt:224` 之类引用须平移后才能对上当前代码。

## 三、★ 撤回：coverage-20261004 INDEX §X1 不成立

INDEX 把「嵌套 `-401` 导致会话过期不跳登录」列为**最高优先级系统性缺陷**，并标「四份报告独立命中」，影响面写成"`message`、`supplier-messages`、`importProducts`、后台管理 10 个写操作全部中招"。

**实测该缺陷不存在。** 完整证据链：

**1. 嵌套形状的产出点全仓只有 6 处（`Grep '[^.\w]error[ \t]*:'`）：**

| 位置 | 形状 | 所在函数 |
|---|---|---|
| `authService:336` | `{ error: { code:-401, msg } }` | `requireSuperAdmin` |
| `authService:337` | `{ error: { code:-403, msg } }` | `requireSuperAdmin` |
| `dataService:54` | `{ error: { code:-401, msg } }` | `requireUser` |
| `dataService:56` | `{ error: { code:-403, msg } }` | `requireUser` |
| `importProducts:54` | 同上 -401 | 其私有 `requireUser` 副本 |
| `importProducts:56` | 同上 -403 | 同上 |

（另 6 处 `authService:140/142/143/145/148/151` 是 `validateUserInput` 的 `{ error: '<字符串>' }` 契约，与本缺陷无关。）

**2. 全部 33 个消费点都是 `if (x.error) return x.error`：**

- `dataService` 22 处：63, 100, 141, 152, 185, 500, 653, 684, 706, 738, 775, 791, 843, 868, 911, 1060, 1107, 1177, 1351, 1443, 1491, 1560
- `authService` 7 处：343, 395, 444, 475, 518, 592, 624（`:355`、`:402` 是 `input.error` 字符串，另计）
- `importProducts` 1 处：84

**3. 关键点：`return auth.error` 返回的是内层对象，即扁平的 `{ code, msg }`。**

`Grep 'return (auth|requireUser|requireSuperAdmin|authResult)\b'`（排除 `.error`）**零命中**；`return auth.user` / `return auth;` 亦零命中。→ **没有任何一处把外层嵌套对象原样返回给客户端。**

**4. 结论：** 线上返回形状恒为扁平 `{ code, msg }`，`utils/cloud.js:68` 的 `if (result.code === -401)` 能正确命中并触发 `handleSessionExpired()` 跳登录。所谓「真正静默」的影响面**为空**。

> 值得注意：INDEX 自己的勘误注释其实**说对了**——「`requireUser` 的调用点返回的是内层 `-401`（即顶层），能正常跳登录」。但 INDEX 仍把 X1 保留为有效缺陷并列出影响面，与该注释自相矛盾。本报告以完整证据链为准：**X1 撤回。**

## 四、★ 新增 P1：`missing_reports` 补救路径全 UI 不可达

完整生命周期（`Grep 'missing_reports'` 全云函数）：

| 动作 | 位置 |
|---|---|
| 置 `true` | `createPurchaseOrder:82`、`createReceipt:757`、`createReceipt:761` |
| 清 `false` | `dataService:1090`（在 `regenerateOrderReports` 内）、`dataService:1339`（在 `regenerateReceiptReports` 内） |

1. `createPurchaseOrder:82` 打标记，随后 `:88-100` 给超管发消息：`message_id: MSG_ORDER_REPORT_MISSING_${orderNo}`、`type:'abnormal'`、`content: '采购单 X 已保存，但订货报表生成失败，请管理员补生成。'`
2. **唯一能补订单侧报表的 `regenerateOrderReports`（`dataService:1058`）前端调用点为 0** —— 在 31 个前端 js 文件中用带引号精确匹配 `'"regenerateOrderReports"'` 得 **0 命中**。
3. `regenerateReceiptReports` 只重建收货侧 ③④⑤⑥ 四类（见 `:1097-1098` 注释），**不含下单侧报表**。
4. 更糟：该消息 `type:'abnormal'`，而 `pages/message/message.js:57-59` 对 `type==='abnormal'` 一律 `navigateTo('/pages/abnormal-list/abnormal-list')` → **把管理员送到异常记录列表，与报表补生成毫无关系。**
5. `MSG_ORDER_REPORT_MISSING` 这个 message_id 前缀在 `pages/` 下 **0 命中**，无任何特殊处理。

**净效果：系统通知管理员执行一件事，而没有任何页面能执行这件事，且跳转目标是错误页面。订单永久卡在 `missing_reports: true`。** 33 份旧报告均未记录此闭环缺口。

## 五、`dataService` action 数与调用点（纠正子代理结论）

- 实际 `switch` 分支 **22 个**（非 23）。
- **`regenerateOrderReports` 无前端调用点**；其余 21 个均有 1–4 处调用，逐点见本目录 `A2a`/`A2b` 报告。
- 角色常量：`GLOBAL_ROLES = MANAGEMENT_ROLES = ['super_admin','purchaser']`（`:8-9`）。

## 六、`deleteUser` 是全系统唯一的"删除"入口，且是别名

`authService:510-512`：`deleteUser(event) { return await setUserStatus({ ...event, status: 0 }) }`
分发在 `:673`，前端 **0 调用**。→ 全系统**无任何硬删除**，只有软删（`status:0`）；`deleteUser` 与 `setUserStatus` 是同一行为的两个入口。

## 七、已排除的疑似缺陷（防重报）

- `pages/message/message.js:22-27, 32-51` 读取 `m.id` / `m.bizId` / `m.time`，而库里存的是 `message_id` / `biz_id` / `created_at` → **看似 snake_case 契约错位，实际不是**。`dataService:638-649 publicMessage()` 已做映射：`id: message._id`、`bizId: message.biz_id`、`time: message.created_at`。前端消费正确。
