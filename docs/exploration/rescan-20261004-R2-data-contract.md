# R2 重扫：数据基座与数据契约（2026-10-04）

> **范围**：`cloudfunctions/dataService/`（1559 行，仓库最大文件）+ `seed-data/`（16 文件 1890 行）为主；交叉反查 19 个云函数、26 个页面、4 个 utils 文件的集合读写点。
> **方法**：dataService 与全部 16 个 seed 文件**逐行全读**（无抽样）；其余文件按关键字定点读 + 全仓 grep 交叉反查。每条结论带 `文件:行号`。**不信注释、README、log.md**，凡注释与实现矛盾处均已标注。
> **前置文档**：`full-scan-04-cloud-data-product.md`、`full-scan-08-infra-and-data-contract.md`、`batch1-cloudfunctions-data.md`、`controller-horizontal-scan-20261004.md`、`rescan-20261004-R3-purchase-cloud.md`、`rescan-20261004-R8-pages-admin.md`。
> **版本基线**：分支 `backup`，HEAD `5268379`（2026-10-02）；工作区有未提交改动 `pages/report-list/report-list.js`、`project.config.json`，本扫未使用它们。
> **只读声明**：本次仅写本文件，未修改任何业务代码，未执行 git 操作。

---

## 0. 增量摘要

相对 R3/R8/horizontal-scan 的**新增确认**（旧文档未覆盖或结论错误）：

| # | 增量结论 | 严重度 |
|---|---|---|
| 1 | `supplier_test_user.jsonl` 哈希**已离线复算命中**：`Supplier@2026` + 该 salt → 与 `app_user.json` U004 的 hash 逐字节相同。5 个种子账号密码全是 `Xxx@2026` 模板，属**事实上的公开凭证** | P0 |
| 2 | `settleReceipt` 去重粒度错：去重按**收货单**判（`:889-895`），账单按**供应商**逐份生成（`:951`）→ 多供应商中途失败后**剩余供应商永久拿不到补充账单**；并发双击产出**同 `report_id` 双份账单** | P1 |
| 3 | `repriceReceipt` 直接覆写 `receipt_item.price_snapshot`（`:1068`），用**当前**协议价回填**收货时**快照，无原价留痕 → 历史金额可事后任意调整 | P1 |
| 4 | `receipt_abnormal` 死锁**已确证为双向**：`purchase_order.order_status` 与 `receipt.receipt_status` **同时**永久卡死，且**叠加卡死手动单凭证核销**（`verifyManualOrder:1460` 要求 `received`）→ 手动采购金额永久无法回填 | P1 |
| 5 | `resolveAbnormal` 允许 **store_manager 写 `payment_decision='pay_received'`**（`:766-772`），而 `settleReceipt:871` 限 GLOBAL_ROLES → 付款裁决权下放到店长，**店长对自己门店可单方解锁付款** | P1 |
| 6 | `getReports:90-96` **不过滤 `report_file.status`** → superseded 旧报表与 generated 一起进列表与 `total`，报表口径虚高 | P1 |
| 7 | `getOrderStats` 4 张卡**无一张统计 `receipt_abnormal`**（`:844-855`）→ 叠加死锁 = 异常单在首页**永久不可见** | P1 |
| 8 | `getPurchaseOrders:119-124` / `getReceipts:74-79` 分块查询 `20 单 × 100 行 = 2000 > limit(1000)` → **明细静默截断**（每单上限 100 行，`createPurchaseOrder:210`） | P1 |
| 9 | `ABNORMAL_TYPE_NAMES` **3 份拷贝**，`getReportDetail:12-16` 缺 `missing_price` 键 → 缺价异常在报表详情页显示裸英文 | P2 |
| 10 | **3 处不同步的"在途状态"字面量**：`updateProductPrice:43` / `authService:632` / `dataService:1294` / `dataService:844`，均漏 `receipt_abnormal` | P2 |
| 11 | `getMessages:623-633` 内部用户可读**供应商定向消息**（`store_id:''` 命中内部门店条件）；`markMessageRead:650-653` 不校验 `scope_type` | P2 |
| 12 | seed-data **三种文件格式并存**（NDJSON / JSON 数组 / 单对象缩进），`report_file.json` 独为数组 | P2 |
| 13 | `basis_date_type` **写 10 处、读 0 处**，且 seed 完全缺失 → 契约里的纯死字段 | P2 |
| 14 | 旧【待核实】回收 **8/15 条**（含"价格唯一性风险""importProducts 不写 category_name"两条已被证伪） | — |

---

## 1. 文件清单与全读确认

**必读全读（17 个文件，2058 行）— 全部逐行读完，无抽样：**

| 文件 | 行数 | 全读 |
|---|---|---|
| `cloudfunctions/dataService/index.js` | 1559 | ✅ 1-1559 |
| `cloudfunctions/dataService/package.json` | 9 | ✅ |
| `seed-data/README.md` | 47 | ✅ |
| `seed-data/abnormal_record.json` | 1 | ✅ |
| `seed-data/app_user.json` | 5 | ✅ |
| `seed-data/category.json` | 12 | ✅ |
| `seed-data/message.json` | 3 | ✅ |
| `seed-data/product-import-template.md` | 31 | ✅ |
| `seed-data/product.json` | 12 | ✅ |
| `seed-data/purchase_order.json` | 2 | ✅ |
| `seed-data/purchase_order_item.json` | 8 | ✅ |
| `seed-data/receipt.json` | 12 | ✅ |
| `seed-data/receipt_item.json` | 2 | ✅ |
| `seed-data/report_file.json` | 167 | ✅ |
| `seed-data/store.json` | 3 | ✅ |
| `seed-data/supplier.json` | 5 | ✅ |
| `seed-data/supplier_product_price.json` | 11 | ✅ |
| `seed-data/supplier_test_user.jsonl` | 1 | ✅ |
| **合计** | **2058** | — |

**交叉反查（定点读/全仓 grep）：** `createReceipt`(752 行，读 330-752)、`createPurchaseOrder`(471)、`getPurchaseOrders`(148 全读)、`authService`(674，读 20-70/600-674)、`confirmSupplierOrder`(124)、`getReceipts`(92)、`getReports`(104)、`getReportDetail`(定点)、`getSupplierOrders`(136)、`getSupplierReceipts`、`getProductPrices`、`updateProductPrice`(138)、`getProducts`、`importProducts`(209)、`generateSummaryReport`、`getReportFileUrl`、`getReportDetail`；`utils/cloud.js`(282 全读)、`utils/meta.js`、`utils/util.js`、`utils/auth-guard.js`；`pages/index`、`pages/message`、`pages/receive-list`、`pages/purchase-detail`、`pages/purchase-list` 等 26 页。

**dataService 22 个 action 函数边界（本轮实测，纠正 R8 表格中 5 个未命名项）：**

| # | action | 函数行号 | 路由 case | 守卫行 |
|---|---|---|---|---|
| 1 | `getCategories` | 54-81 | 1531 | 56 |
| 2 | `saveProduct` | 91-130 | 1532 | 93 |
| 3 | `toggleProduct` | 132-141 | 1533 | 134 |
| 4 | `saveSupplier` | 143-174 | 1534 | 145 |
| 5 | `toggleSupplier` | 176-185 | 1535 | 178 |
| 6 | `auditOrder` | 482-597 | 1536 | 484 |
| 7 | `getMessages` | 612-641 | 1537 | 614 |
| 8 | `markMessageRead` | 643-663 | 1538 | 645 |
| 9 | `markAllMessagesRead` | 665-681 | 1539 | 667 |
| 10 | `getAbnormalRecords` | 697-732 | 1540 | 699 |
| 11 | `startAbnormal` | 734-748 | 1541 | 736 |
| 12 | `resolveAbnormal` | 750-800 | 1542 | 752 |
| 13 | `closeAbnormal` | 802-824 | 1543 | 804 |
| 14 | `getOrderStats` | 827-865 | 1544 | 829 |
| 15 | `settleReceipt` | 870-982 | 1545 | 872 |
| 16 | `repriceReceipt` | 1035-1103 | 1546 | 1037 |
| 17 | `regenerateReceiptReports` | 1105-1272 | 1547 | 1107 |
| 18 | `regenerateOrderReports` | 988-1023 | 1548 | 990 |
| 19 | `cancelOrder` | 1279-1330 | 1549 | 1281 |
| 20 | `requestCancel` | 1333-1380 | 1550 | 1337 |
| 21 | `remindAudit` | 1383-1432 | 1551 | 1385 |
| 22 | `verifyManualOrder` | 1438-1526 | 1552 | 1442 |

（22 个 case 位于 `:1531-1552`，与已知事实一致；`default` 在 `:1553`。）

---

## 2. 22 个 action 权限矩阵

角色守卫常量（`dataService:8-11`）：
- `GLOBAL_ROLES = ['super_admin','purchaser']`（:8）
- `MANAGEMENT_ROLES = ['super_admin','purchaser']`（:9）— **与 GLOBAL_ROLES 值完全相同**，纯重复
- `VOUCHER_SUBMIT_ROLES = ['super_admin','purchaser','store_manager']`（:11）

| action | 云端守卫 | super_admin | purchaser | store_manager | chef | supplier |
|---|---|---|---|---|---|---|
| getCategories (54) | 仅登录 | ✅ | ✅ | ✅ | ✅ | ✅ |
| saveProduct (91) | MANAGEMENT | ✅ | ✅ | ❌ | ❌ | ❌ |
| toggleProduct (132) | MANAGEMENT | ✅ | ✅ | ❌ | ❌ | ❌ |
| saveSupplier (143) | MANAGEMENT | ✅ | ✅ | ❌ | ❌ | ❌ |
| toggleSupplier (176) | MANAGEMENT | ✅ | ✅ | ❌ | ❌ | ❌ |
| auditOrder (482) | MANAGEMENT | ✅ | ✅ | ❌ | ❌ | ❌ |
| getMessages (612) | 仅登录 | ✅ | ✅ | ✅ | ✅ | ✅(scope 过滤) |
| markMessageRead (643) | 仅登录 | ✅ | ✅ | ✅ | ✅ | ✅(归属校验) |
| markAllMessagesRead (665) | 仅登录 | ✅ | ✅ | ✅ | ✅ | ✅ |
| getAbnormalRecords (697) | 仅登录 | ✅ | ✅ | ✅(本店) | **空数组** | **空数组** |
| startAbnormal (734) | 店长+全局 | ✅ | ✅ | ✅ | ❌ | ❌ |
| resolveAbnormal (750) | 店长+全局 | ✅ | ✅ | ✅ | ❌ | ❌ |
| closeAbnormal (802) | 店长+全局 | ✅ | ✅ | ✅ | ❌ | ❌ |
| getOrderStats (827) | 仅登录 | ✅ | ✅ | ✅(本店) | ✅(本店自创) | ❌(-403) |
| settleReceipt (870) | GLOBAL | ✅ | ✅ | ❌ | ❌ | ❌ |
| repriceReceipt (1035) | GLOBAL | ✅ | ✅ | ❌ | ❌ | ❌ |
| regenerateReceiptReports (1105) | GLOBAL | ✅ | ✅ | ❌ | ❌ | ❌ |
| **regenerateOrderReports (988)** | GLOBAL | ✅(**零前端调用**) | ✅ | ❌ | ❌ | ❌ |
| cancelOrder (1279) | GLOBAL | ✅ | ✅ | ❌ | ❌ | ❌ |
| requestCancel (1333) | GLOBAL | ✅ | ✅ | ❌ | ❌ | ❌ |
| remindAudit (1383) | chef+店长+全局 | ✅ | ✅ | ✅ | ✅ | ❌ |
| verifyManualOrder (1438) | submit→VOUCHER / 裁决→GLOBAL | ✅ | ✅ | **仅 submit** | ❌ | ❌ |

### 2.1 过度授权

- **OA-A 🔴 付款裁决下放到店长**：`resolveAbnormal:766` 接受 `event.paymentDecision` 且**无角色分支**（751 的守卫含 `store_manager`），`payment_decision='pay_received'` 由店长写入；`settleReceipt:898` 直接信任该标记把 `payable_flag` 翻回 `true`。而 `createReceipt:164` 允许 `store_manager` 提交收货验收 → **店长可自报异常 → 自处理 → 自裁付款 → 无人复核**。`settleReceipt:871` 限 GLOBAL 只挡住了"生成账单"这一步，没有挡住"解锁付款"这一步。
- **OA-B 店长可走完异常全生命周期**：`startAbnormal:735` / `resolveAbnormal:751` / `closeAbnormal:803` 三处守卫均为 `['store_manager','purchaser','super_admin']`，`pending→processing→resolved→closed` 全程无管理员环节（对比 `getOrderStats` 对门店角色做了收敛）。
- **OA-C purchaser 与 super_admin 完全等价**：`GLOBAL_ROLES === MANAGEMENT_ROLES`（:8/:9），purchaser 一人即可覆盖 审批(`auditOrder`) + 作废(`cancelOrder`) + 补结算(`settleReceipt`) + 补价(`repriceReceipt`) + 补生成(`regenerateReceiptReports`) + 凭证核销(`verifyManualOrder` approve)。**无四眼原则**。`verifyManualOrder:1510-1520` approve 只校验 `verify_status==='pending'`，不校验"核销人 ≠ 提交人"。
- **OA-D `getOrderStats` 无角色守卫**（:829 `requireUser(event)`）但 supplier 走 `:841-842` 返回 -403 → 正确但**返回的是嵌套错误**（见 §14-N01）。

### 2.2 授权缺口

- **GAP-A 🔴 无任何 action 能移出 `receipt_abnormal`**（详见 §4）— 全系统最严重缺口。
- **GAP-B 无 action 清除 `cancel_requested`**：`requestCancel:1357-1367` 写入后永久挂起，`cancelOrder:1301-1319` 事务内**不清理**该标记；`purchase-detail.js:85` 用 `!order.cancelRequested` 控制按钮 → 申请取消后**按钮永久消失**。
- **GAP-C 无 action 删除 `report_file`**：全项目 `.remove()` 于 `report_file` 集合 = 0 处；`regenerateReceiptReports` 重复生成的同 `_RG` 账单无清理入口。
- **GAP-D 无 action 修改 `supplier.address`**（R8 GAP-1 仍成立）：seed 有 `address`（`supplier.json` 6 条全有），`dataService:148-153` 不写，`supplier-manage.wxml` 无该字段 → **新建供应商 address 恒为空串**。
- **GAP-E supplier 角色无任何订单干预能力**：无 `requestCancel`/`remindAudit`，对已确认订单无法申请变更。
- **GAP-F `verifyManualOrder` approve/reject 不发通知**：`:1497-1525` 两条路径均无 `createMessage`，店长提交凭证后无"已核销/已驳回"回执，只能轮询（对比 `resolveAbnormal:778,792` 发两条、`requestCancel:1372` 发一条）。

### 2.3 死代码守卫

- **`requestCancel:1352-1354` 门店归属校验永假**：`:1336` 已把角色限到 `GLOBAL_ROLES`，`if (!GLOBAL_ROLES.includes(auth.user.role) ...)` 恒为 false → 该分支永不执行。
- **`createMessage` 调用方 `scopeType` 默认空串**（`:199-200`）导致内部消息 `scope_type=''`，是 §6 跨域泄漏的根因。

---

## 3. 改钱 / 改状态 action 事务与幂等

dataService 全文件 `db.runTransaction` 仅 **2 处**（`:531` auditOrder、`:1301` cancelOrder）。**三个补账入口全部无事务**。

| action | 事务 | 原子性机制 | 重复提交/重放 | 失败残留（半成品） |
|---|---|---|---|---|
| `auditOrder` (482) | ✅ 531-563 | 事务内复查 `order_status`(533-541) + `rollback` | 第二个并发审核必失败 ✅ | 无 |
| `cancelOrder` (1279) | ✅ 1301-1319 | 事务 + 状态白名单(1297) | 第二次必拒 ✅ | 无 |
| `requestCancel` (1333) | ❌ | 条件更新 `cancel_requested: _.neq(true)`(1357-1359) | 原子 ✅（仅一个成功） | **有**：flag 落库后 `createMessage`(1372) 失败 → 已挂起且无人知 |
| `verifyManualOrder` submit (1459) | ❌ | 条件更新 `verify_status: _.neq('approved')`(1466-1477) | 原子 ✅ | **有**：DB 已更新后 `cloud.deleteFile`(1486) 失败 → 旧凭证图残留云存储 |
| `verifyManualOrder` approve/reject | ❌ | 条件更新 `verify_status: 'pending'`(1499,1511) | 原子 ✅ | 无 |
| `remindAudit` (1383) | ❌ | 条件更新 + `$or`(1410-1419) | 原子 ✅ | 无 |
| `startAbnormal`/`resolveAbnormal`/`closeAbnormal` | ❌ | 先读后判（`:743`,`:763`,`:813`）**非原子** | 并发双击可重复推进 | **有**：`resolveAbnormal:768-777` 落库后两条 `createMessage`(778,792) 失败 → 无告警 |
| **`settleReceipt` (870)** | ❌ | **无** | **去重粒度错**（见下） | 🔴 **多供应商中途失败 → 剩余供应商永久缺账单** |
| **`repriceReceipt` (1035)** | ❌ | **无** | 重跑 → `missingItems` 空 → 返回错误 ✅ | 🔴 **部分行已改价无法回滚** |
| **`regenerateReceiptReports` (1105)** | ❌ | 仅 `getNextVersion` 原子计数(361-378) | **`report_id` 固定 `_RG` → 重复行** | 🔴 **四类报表逐个 add，中途失败只生成部分** |
| `regenerateOrderReports` (988) | ❌ | 无 | ① 先 `superseded` 旧版(414-416) ✅ 部分缓解 | **有**：① 成功 ② 失败 → 无标记 |
| `saveProduct`/`saveSupplier` | ❌ | 无（随机 ID） | 重复保存生成重复商品 | 无 |

### 3.1 `settleReceipt` 去重粒度错（P1，本轮新增）

- 去重检查 `:889-895`：`report_file.where({report_type:'supplier_receipt_price_report', source_order_id: purchaseOrderId}).limit(100)` → `some(r => r.report_id.endsWith(receiptId + '_S'))`。**判定粒度 = 收货单**。
- 账单生成 `:951-980`：`for (const sid of supplierIds)` 逐供应商 uploadFile + add，`report_id = 'RPT_SURP_' + sid + '_' + receiptId + '_S'`（:971）。**生成粒度 = 供应商**。
- **后果 A（不可恢复的缺口）**：收货单含 3 家供应商，第 1 家 add 成功后第 2 家 `uploadFile` 失败 → 抛错，事务无、补偿无。管理员重试时 `:893` 命中第 1 家的 `_S` 记录 → 返回"该收货单已补结算，请勿重复操作"（:894）→ **第 2、3 家的补充账单永久无法生成**。
- **后果 B（重复付款凭证）**：两个管理员同时点补结算，两个请求都通过 `:889-895`（此时都还没落库）→ 相同 `report_id` 双份账单（`getNextVersion` 保证文件名不同，但 `report_id` 相同）。`report_file.report_id` 无唯一索引。
- **后果 C（顺序错）**：`payable_flag` 翻转在 `:912-914`（**先改数据**），CSV 上传在 `:968`（**后出账单**）→ 上传失败时明细已"转回可付款"但无账单留档。

### 3.2 `repriceReceipt` 事后篡改历史金额（P1，本轮新增）

- `:1047` 筛"缺价行"：`!is_manual && supplier_id && price_snapshot <= 0`。
- `:1055-1059` 取价：`supplier_product_price.where({product_id: _.in(chunk), is_current: 1})` → **当前价**。
- `:1067-1069` 直接 `update({ price_snapshot: price, payable_flag: true })` → **覆写收货时快照**。
- 问题：① `price_snapshot` 语义是"收货当时价格"（`createReceipt:458` 写入），被替换为"补账当日价格"，**快照语义被破坏**；② 无原价留痕、无审批链、无金额变动日志；③ `:1086` 把 `handled_by` 覆写为当前操作人，冲掉原处理人；④ `:1082-1089` 直接置 `status:'resolved'`，跳过 `processing` 中间态与 `closeAbnormal` 的裁决记录；⑤ 价格本身可被 `updateProductPrice` 任意改后再补账 → **金额链完全可由管理员单方改写**。

### 3.3 `regenerateReceiptReports` 无 supersede（P1，本轮新增）

- `report_id` 固定后缀 `_RG`（`:1162,1189,1222,1249`），重复执行**不置旧版 `superseded`**（对比 `regenerateApprovedOrderReports:414-416` 会先标旧版）→ 每次点击都插入同 `report_id` 的重复账单行。
- 叠加 `receipt.missing_reports` 永不重置（§5）→ UI 上"补生成"按钮**永久可见** → 用户可无限次点出重复账单。
- 四类报表在 `:1160 / :1187 / :1220 / :1247` 顺序 add，`:1260-1263` catch 后仅返回"已生成的报表不受影响"，**无部分成功标记**（`reportWarning` 只在 `auditOrder` 用）。

---

## 4. `receipt_abnormal` 死锁完整状态机 + 最小修复

### 4.1 状态机（全部写入点均已定位）

```
                          createPurchaseOrder:316  order_status
                                │
                          ┌─────▼──────┐
                          │   draft    │  getPurchaseOrders:86 统计 / purchase-list:88 tab
                          └─────┬──────┘  cancelOrder:1297 允许作废
                                │ createPurchaseOrder 提交
                          ┌─────▼──────┐
                          │ submitted ├─┬─► auditOrder:552 'approved'
                          └─────┬──────┘ │      dataService:499/538 白名单含
                    auditOrder:552       │
                    'rejected'  ┌────────▼────────┐
              ┌───────────────►│    approved     ├─► cancelled (cancelOrder:1303)
              │   (终态,        └────────┬────────┘   cancel_requested (requestCancel:1361)
              │   canCopy→草稿           │ createReceipt:512 未收齐
              │   purchase-detail:79) ┌──▼───────────────┐
              │                        │ report_generated ├─► cancelled / cancel_requested
              │                        └──┬───────────────┘
              │        createReceipt:512  │  createReceipt:392 白名单【含】→ 可继续补收
              │                        ┌──▼───────────────┐
              │                        │  partial_received├─► 继续补收（循环）
              │                        └──┬───────────────┘   cancelOrder:1294 拒作废
              │                             │ createReceipt:512 收齐
              │            isFinalBatch 判定 createReceipt:373-379 + :509
              │                    ┌───────┴────────┐
              │              hasAbnormal=false   hasAbnormal=true
              │                    │                │
              │             ┌──────▼──────┐   ┌─────▼──────────────┐
              │             │  received   │   │ receipt_abnormal   │ ★ 死锁
              │             └──────┬──────┘   └────────────────────┘
              │                    │  (仅 is_manual)
              │           verifyManualOrder:1470/1502/1514
              │      verify_status: none→pending→approved|rejected
              │
              └──► cancelled (dataService:1303, 终态)
```

### 4.2 死锁确证：零条出路

| 入口 | 白名单/条件 | 是否覆盖 `receipt_abnormal` |
|---|---|---|
| `createReceipt:392` | `['approved','report_generated','partial_received','to_receive']` | ❌ **不含** |
| `dataService:1294` cancelOrder 拒绝列表 | `['partial_received','to_receive','received','receipt_abnormal']` | ❌ **明确拒绝** |
| `dataService:1297` cancelOrder 允许列表 | `['submitted','approved','report_generated']` | ❌ 不含 |
| `dataService:1348` requestCancel | `['submitted','approved','report_generated','partial_received','to_receive']` | ❌ 不含 |
| `dataService:499/538` auditOrder | `['submitted','pending_approval']` | ❌ 不含 |
| `resolveAbnormal:768-777` | 只写 `abnormal_record` | ❌ **不触碰 `purchase_order`** |
| `settleReceipt:870-982` | 只写 `receipt_item.payable_flag` + `report_file` | ❌ **不触碰 `purchase_order`** |
| `repriceReceipt:1035-1103` | 只写 `receipt_item.price_snapshot` + `abnormal_record` | ❌ **不触碰 `purchase_order`** |

**结论：全项目不存在任何把 `order_status` 从 `receipt_abnormal` 写回 `received` 的代码路径。** 且 `receipt.receipt_status`（`createReceipt:437` 写 `'abnormal'`）同样无人回写 → **两个字段同时永久卡死**。

### 4.3 注释与实现直接矛盾

`createReceipt:386` 注释：「`receipt_abnormal` 状态允许继续补收」；`:392` 实现：白名单**不含** `receipt_abnormal`。**注释误导后续维护者**（R3 §5 H1 已标，本轮二次确证）。

### 4.4 死锁的三重后果（本轮新增第三重）

1. **首页永久不可见**：`getOrderStats:844-855` 四张卡的口径不含 `receipt_abnormal` → 该单在首页"待收货/已完成/待处理/需关注"全部为 0。`getPurchaseOrders:89` 有 `receiptAbnormal` tab，`purchase-list.js:93` 有该 tab → **只有列表能看到，首页驾驶舱看不到**。
2. **收货记录永久标红**：`receipt.receipt_status='abnormal'` 无人回写 → `getReceipts:70-72` / `receive-list.js:70-72` 恒显示"收货异常"，即使所有异常单都已 resolved 且已补结算。
3. 🔴 **手动单凭证核销永久卡死**：手动单（`is_manual`）若收货时有任何异常（少收/质量/错货/缺价）→ `createReceipt:509` 进 `receipt_abnormal` → `verifyManualOrder:1460` 要求 `order_status==='received'` 才允许提交凭证 → **线下采购的实付金额永久无法回填、无凭证留档、无审计链**。`purchase-detail.js:93-96` 的 `canSubmitVoucher` 同样要求 `received`，前后端一致地卡死。

### 4.5 最小修复（推荐方案 A，约 20 行）

在 `resolveAbnormal` 的 `:798` 之后追加（并把 `:768` 的 update 与新增两段包进同一个 `db.runTransaction`）：

```js
// 该收货单所有异常均已终结（resolved 或 closed）时，解除订单与收货单的异常终态
const openRes = await db.collection('abnormal_record')
  .where({ receipt_id: record.receipt_id, status: _.in(['pending', 'processing']) })
  .limit(100).get()
if (openRes.data.length === 0 && record.receipt_id) {
  await db.collection('purchase_order').where({
    purchase_order_id: record.purchase_order_id,
    order_status: 'receipt_abnormal'
  }).update({ data: { order_status: 'received', updated_at: db.serverDate() } })
  await db.collection('receipt').where({
    receipt_id: record.receipt_id,
    receipt_status: 'abnormal'
  }).update({ data: { receipt_status: 'completed', updated_at: db.serverDate() } })
  // 通知店长：手动单可继续提交凭证核销
  await createMessage({ type: 'abnormal', title: '收货异常已全部处理',
    content: `收货单 ${record.receipt_id} 关联异常均已处理完成，订单已恢复为已收货状态。`,
    bizId: record.receipt_id, storeId: record.store_id,
    recipientUserId: record.store_id })
}
```

**四点设计要点**：
1. **条件更新**（`order_status === 'receipt_abnormal'`）保证幂等 + 防并发双写，与 `requestCancel:1357` / `verifyManualOrder:1511` 的既有模式一致。
2. **`closed` 也算终结**，与 `settleReceipt:885` 的 `openAbnormal` 判定口径一致（否则"已关闭未解决"的异常会把订单永远锁住）。
3. 必须**同时**修 `receipt.receipt_status`，否则后果 2 仍在。
4. 一个修复**同时解开 §4.4 的三重后果**，包括手动单凭证核销。

**备选方案 B**：新增独立 action `clearReceiptAbnormal`（`GLOBAL_ROLES`），在 `:1553` 前加 case。代价是多一个 action + 前端改动，且把"何时解除"的决策权从流程内挪到人工，不推荐。

**不建议**在 `createReceipt:392` 白名单里加入 `receipt_abnormal` 允许继续补收：`createReceipt:414` 的超收校验 `txHistoryQty + receivedQty > orderQty` 会拦截所有超收，而"补收"的语义在收齐后不成立；真正需要的是"解除异常态"而非"继续收货"。

---

## 5. 字段契约三边比对（seed-data × 云函数 × 页面）

### 5.1 逐集合字段差集

**`category`（seed 12 条）** — ✅ **完全一致**
seed 10 字段：`category_id, category_level_1, category_level_1_name, category_level_1_icon, category_name, sort_no, icon, status`（+`_id`）。`getCategories:63-79` 读取字段全匹配；`saveProduct:109-111` 写 `category_level_1 / category_level_2_id / category_name` 均来自 `category.category_*` ✅。
- ⚠️ **不一致 1**：`dataService:85` `where({ category_id: Number(categoryId) })` 强制转 number；seed 的 `category_id` 是 number ✅，但若前端传空串 → `Number('')=0` → 查不到 → 返回误导性文案 `商品名称、分类和单位不能为空`（`:97`）。

**`product`（seed 12 条）** — ✅ **完全一致**
seed 11 字段与 `dataService:107-117` / `importProducts:191` 写入字段逐一对应（含 `manufacturer_name`）。**唯一 100% 对齐的集合**。

**`supplier`（seed 6 条）** — 🔴 双向不一致
| 字段 | seed | `saveSupplier:148-153` | 判定 |
|---|---|---|---|
| `address` | ✅ 6 条全有 | ❌ 不写 | 🔴 **新建供应商 address 恒为 `''`**；`normalizeSupplier:194` 会读 |
| `remark` | ❌ | ✅ 写 | ⚠️ seed 未演示 |
| `contact_name/contact_phone/supplier_name/status` | ✅ | ✅ | 一致 |

**`store`（seed 3 条）** — ✅ 一致
`store_id, store_name, store_code, status, created_at, updated_at` = `authService:554-562` 写入字段。

**`app_user`（seed 5 条）** — ⚠️ seed 缺会话字段（设计使然）
seed 12 字段无 `openid / sessions[] / session_token_hash / session_expires_at`。`getSessionUser:21-31` 优先查 `sessions`，回退 `session_token_hash`，**两者皆无则返回 null**。seed 用户**必须先在登录页登录后才能被任何云函数识别**（首次登录时 `authService:229-230` 写入 session）。`password_iterations: 120000` 与 `authService:18` 常量一致 ✅。
- ⚠️ **不一致**：`created_by` 在订单里写的是 `user_id`（如 `U001`），seed 一致 ✅；但 `dataService:495` `auditorId = user_id || _id` 与 `order.created_by` 比对时，**`_id` 兜底情形永不命中**（见 §11）。

**`purchase_order`（seed 3 条）** — ⚠️ seed 缺 15+ 个运行期字段
seed 10 字段；代码写入（`createPurchaseOrder:312-320` 等）另有 `delivery_date, is_manual, verify_status, verify_amount, verify_voucher_file_ids, verify_submitted_by/at, verify_reject_note, verify_note, verified_by/at, cancel_requested, cancel_requested_by/reason/at, cancel_reason, cancelled_by/at, audit_remark, audited_by/at, backfilled, request_id, created_by_name, supplier_confirmations, missing_reports, verify_cancel_note`。`normalizePurchaseOrder:146-167` 对 `verify_*`/`cancel_requested`/`created_by` 均有兜底 ✅。
- 🔴 **不一致 1**：seed `PO20260804001` 是 `order_status:'approved'` 但**无任何 `audited_by/audited_at/audit_remark`** → 演示了"未经审核就 approved"，与 `auditOrder:552-557` 的真实流程矛盾（会误导排查）。
- 🔴 **不一致 2**：seed `PO20260805001` 是 `received` 且 `updated_at` 等于收货时间，但**无 `receipt_id` 反查字段**；seed `PO20260806001` 的 `order_no` 与 `purchase_order_id` 完全相同，而代码 `order_no` 也是同值（`createPurchaseOrder` 用同一 id）→ 一致但**冗余字段**。
- ⚠️ **不一致 3**：`verify_status` 两种空值：手动单 `'none'`（`createPurchaseOrder:284`），非手动单 `''`（同行为 `manualCount > 0 ? 'none' : ''`）。**同一字段两种"无状态"表达**，页面须同时兼容（`purchase-detail.js:92` `verifyStatus || ''` 已兼容）。

**`purchase_order_item`（seed 9 条）** — ⚠️ 缺审核字段
seed 11 字段；代码额外写 `approved_qty`（唯一写入点 `dataService:546`）、`updated_at`（同）。
- 🔴 **不一致**：seed 的 `PO20260804001_*` 对应 approved 订单，但明细**无 `approved_qty`** → 下游若按 `approved_qty` 取量会拿到 `undefined`。
- ✅ seed `PO20260806001_4` 的 `product_id:'MANUAL_001'` + `supplier_id:''` + `is_manual:true` 与 `createPurchaseOrder:335` 一致 ✅。

**`receipt`（seed 1 条）** — ⚠️ seed 缺 6 个运行期字段
seed 8 字段；代码（`createReceipt:429-443`）额外写 `overall_remark, photo_file_ids, batch_no, is_final, backfilled, missing_reports`。
- ✅ `receipt_status:'completed'` 与 `createReceipt:437` 的 `'abnormal'|'completed'` 值域一致 ✅。
- ✅ 读取端有兜底：`regenerateReceiptReports:1126` `Number(receipt.batch_no)||1`、`:1127` `receipt.is_final !== false`、`:1122` `receipt.receipt_date || today` → seed 缺字段**不会崩**。

**`receipt_item`（seed 3 条）** — 🔴 内部自相矛盾
seed 13 字段；代码（`createReceipt:447-468`）额外写 `is_manual, is_shortage, is_quality_issue, is_wrong_item, updated_at`。
- 🔴 **不一致 1（seed 自相矛盾）**：`RCP20260805001_1`（土豆）`received_qty:28 < order_qty_snapshot:30`，且 `abnormal_record.json` 存在 `type:'shortage'` 的 `ABN20260805001`，但该明细**既无 `is_shortage:true` 又是 `payable_flag:true`** → seed 同时表达了"少收 2 斤已登记异常"和"全额可付款"，且 `regenerateReceiptReports:1144-1147` 会把它渲染成"正常"。**seed 无法正确演示异常链路**。
- ✅ `regenerateReceiptReports:1156` `item.payable_flag !== false`、`:925` `!item.is_manual` 对缺失字段均有兜底（`!undefined===true`）。

**`report_file`（seed 11 条，167 行）** — 🔴 唯一格式异类 + 缺关键字段
- 🔴 **格式异类**：`report_file.json` 是 **JSON 数组**（`[` 开头，11 元素），而其余 12 个 `.json` 全是 **NDJSON**（每行一条），`receipt.json` 又是**单对象多行缩进** → **seed-data 三种格式并存**，任何单一解析策略都会在某一个文件上失败。
- 🔴 **不一致**：seed 13 字段**完全缺失 `basis_date_type`**，而代码在 **10 处**无条件写入（`createPurchaseOrder:367,416`；`createReceipt:569,602,651,686`；`dataService:433,474,973,1164`）。见 §5.3。
- ⚠️ seed 缺 `has_abnormal, abnormal_summary, excluded_rows, regenerated, settle_for_receipt, total_amount, item_count, updated_at`（均为可选扩展字段）。

**`message`（seed 3 条）** — ⚠️ 缺 4 个运行期字段
seed 9 字段；代码（`dataService:189-205`）额外写 `scope_type, scope_id, read_by`。
- ⚠️ **不一致 1**：seed 的 `read:true`（`MSG20260805001`）是**全局已读**语义，而 `getMessages:635-639` `read = !!message.read || readBy.includes(userId)` → 该消息**对所有用户显示为已读**；且 `markMessageRead:658-660` **从不写 `read`**（只 push `read_by`）→ `read` 布尔在运行期是**只读兼容字段**，仅存在于 seed。
- ⚠️ **不一致 2**：seed 无 `scope_type/scope_id` → `getMessages:623-625` 对 supplier 的 `{scope_type:'supplier', scope_id:...}` 过滤会让 supplier **看不到全部 seed 消息**（预期行为，但 seed 的"供货商消息"演示不了）。

**`abnormal_record`（seed 1 条）** — 🔴 ID 格式与运行期不符
seed 13 字段；代码额外写 `payment_decision, handled_by, resolved_by, resolved_at, closed_by, closed_at`（均为可选）。
- 🔴 **不一致**：seed `abnormal_id:'ABN20260805001'`，运行期格式是 `` `${receiptId}_${i+1}_${type}` ``（`createReceipt:490`，如 `RCP20260805001_1_shortage`）。**后果**：`settleReceipt:907-909` 按 `{receiptId}_{行序号}_{type}` 解析，seed 记录的 `split('_')` 长度为 1 → `parts.length < 3` → `continue` → **seed 的这条异常单永远无法被转回可付款**。任何拿 seed 做的回归测试都会误判"pay_received 裁决失效"。

**`supplier_product_price`（seed 12 条）** — ✅ 一致 + 一处潜在冲突
seed 10 字段与 `updateProductPrice:117-129` 写入字段逐一对应 ✅（含 `currency:'CNY'`、`expiry_date:null`、`updated_by`）。
- ⚠️ **不一致 1**：`price_id` 格式不同——seed 是 `PRC001`，代码是 `'PRC_' + Date.now()`（`updateProductPrice:103`）。同毫秒内两次调价 → **相同 `price_id`**，且事务内不校验唯一。
- ⚠️ **不一致 2**：seed `PRC001` 的 `expiry_date:'2026-07-31'` + `is_current:0` 演示了历史价，但代码**从不写非空 `expiry_date`**（恒 `null`）→ 历史价的过期机制在代码里不存在，靠 `is_current` 单字段表达。

### 5.2 只读/写死字段盘点（跨三边）

| 字段 | 代码写入次数 | 代码读取次数 | seed 有无 | 判定 |
|---|---|---|---|---|
| `basis_date_type` | **10** | **0** | ❌ 全无 | 🔴 **纯死字段** |
| `audit_status` | 0 | 0 | ❌ | 契约文档中的幽灵字段（实际用 `order_status:'rejected'`） |
| `is_abnormal` | 0 | 0 | ❌ | 幽灵字段（实际用 `receipt.receipt_status`） |
| `abnormal_type` | 0 | 0 | ❌ | 幽灵字段（实际用 `abnormal_record.type`） |
| `order_type` | 0 | 0 | ❌ | 幽灵字段（实际用 `order_status`） |
| `order_id` | 0 | 0 | ❌ | 幽灵字段（实际用 `purchase_order_id`） |
| `total_quantity` | 0 | 0 | ❌ | 幽灵字段（实际用 `item_count`） |
| `quantity` | 0 | 0 | ❌ | 幽灵字段（实际用 `order_qty/received_qty`） |
| `settle_status/settle_amount` | 0 | 0 | ❌ | 幽灵字段（只有 `settle_for_receipt`） |
| `actual_amount/actual_price` | 0 | 0 | ❌ | 幽灵字段（实际用 `verify_amount/price_snapshot`） |

**含义**：任务下发清单中的 `audit_status / is_abnormal / abnormal_type / total_quantity / order_type / order_id / actual_*` **在本仓库全部不存在**。任何以这些字段为准的验收或迁移脚本都会 100% 落空。

### 5.3 `basis_date_type` — 写 10 处、读 0 处（P2，本轮新增）

写入点：`createPurchaseOrder:367,416`；`createReceipt:569,602,651,686`；`dataService:433,474,973,1164`。
读取点：**全仓 grep 0 处**（`getReports`、`getReportDetail`、`getReportFileUrl`、页面、utils 均不读）。
seed：`report_file.json` 11 条**无一包含**。
**结论**：该字段是契约中的纯累赘——占存储、无消费。若未来要按"下单日/收货日"区分报表，需先补读取端。

---

## 6. 消息域分析

### 6.1 消息生成点全集（`message` 集合 add）

| # | 位置 | 触发 | `type` | `scope_type` | 收件人 |
|---|---|---|---|---|---|
| 1 | `createPurchaseOrder:57` | 下单成功 | `order` | 无 | 门店广播 |
| 2 | `createPurchaseOrder:446-457` | 报表失败 | — | — | 超管 |
| 3 | `createReceipt:140` | 收货通知 | `order` | 无 | — |
| 4 | `createReceipt:521-535` **事务内** | 收货/异常 | `order`/`abnormal` | 无 | 异常→店长 |
| 5 | `createReceipt:710-722` | 报表失败 | `abnormal` | 无 | 超管 |
| 6 | `confirmSupplierOrder:98-113` | 发货 | `order` | 显式 `''` | 门店广播 |
| 7 | `dataService:324`（`notifySuppliersNewOrder`） | 供货单通知 | `order` | **`supplier`** | 供应商 |
| 8 | `dataService:405` | 改量通知 | — | — | — |
| 9 | `dataService:565` | 审批结果 | `approval` | — | 门店广播 |
| 10 | `dataService:778,792` | 异常解决（2 条） | `abnormal` | — | 门店广播 |
| 11 | `dataService:1321` | 作废通知 | `cancel` | — | 门店广播 |
| 12 | `dataService:1372` | 收到取消申请 | `cancel` | — | 门店广播 |
| 13 | `dataService:1424` | 催审 | `approval` | — | 门店广播 |

**13 处生成点，其中 12 处 `scope_type` 为空或缺失；只有 `notifySuppliersNewOrder` 一处显式写 `'supplier'`。**

### 6.2 已读隔离：按用户，但混有全局残留

- `getMessages:635-639`：`read = !!message.read || readBy.includes(userId)` → **双轨**：全局 `read` 布尔 OR 个人 `read_by` 数组。
- `markMessageRead:654-660`：注释明写"按用户记录已读：同一门店的其他成员的未读状态不受影响"，实现是 `read_by: _.push(userId)` + `read_at`，**从不写 `read`**。
- **矛盾**：`markAllMessagesRead:676` 同样只 push `read_by`。→ 代码路径产生的已读**永远是个人的**，但 seed 的 `read:true` 会让所有用户看到已读（§5.1）。**同一字段两套语义，seed 与代码不一致**。
- `markMessageRead:656-657` 有 `readBy.includes` 去重 ✅。
- `markAllMessagesRead:672-679` 先跑 `getMessages` 再逐条 read → 逻辑正确。

### 6.3 未读数：口径失真（P2，本轮新增）

- `getMessages:634` `orderBy('created_at','desc').limit(100)` → **最多返回最近 100 条**。
- 未读数在**前端算**：`index.js:78` / `message.js:27` 都是 `messages.filter(m => !m.read).length`。
- 云函数端**没有未读计数字段**。
- **后果**：用户有 >100 条消息时，未读数上限被截断在 100；`markAllMessagesRead:672` 也只遍历最近 100 条 → **更早的未读永远标不掉**。
- `message_id` 无未读索引；无 `unread_count` 缓存 → 每次进首页都全量拉 100 条再算。

### 6.4 🔴 供应商消息跨域可见（P2，本轮新增）

`getMessages:617-633` 的过滤逻辑：
```
recipientCondition = _.or([ {recipient_user_id:''}, {recipient_user_id:userId}, {recipient_user_id:_.exists(false)} ])
if (role === 'supplier')        query = _.and([recipientCondition, {scope_type:'supplier', scope_id:default_supplier_id||''}])
else if (!GLOBAL_ROLES)         query = _.and([recipientCondition, _.or([{store_id:''},{store_id:default_store_id||''},{store_id:_.exists(false)}])])
```
**缺陷**：`notifySuppliersNewOrder` 生成的供应商消息 `store_id` 为空串（`createMessage:197` `data.storeId || ''`）。对**内部门店角色**（chef / store_manager），store 条件是 `_.or([{store_id:''}, ...])` → **`store_id:''` 直接命中** → **供应商定向消息对全店所有内部用户可见**。

反向（内部消息给 supplier）：supplier 的过滤含 `scope_type:'supplier'`，内部消息 `scope_type:''` → **不会泄漏** ✅。

**因此泄漏方向是"内部看供应商消息"，不是"供应商看内部消息"**——与任务下发里"供应商消息是否可能泄露采购内部信息"的担忧方向相反，实际影响较轻（供应商消息内容是"贵司有 N 条供货单"级别的广播，且内容已含在门店广播里）。但仍属**消息域隔离缺陷**：
- `markMessageRead:650-653` 归属校验只判 `recipient_user_id` 和 `store_id`，**不判 `scope_type`** → 内部用户可把供应商消息标为已读，污染供应商侧的已读状态（`read_by` 数组被推入内部 user_id；`:638` 对 supplier 侧判定用 `readBy.includes(supplierUserId)` 不受影响，但 `read` 布尔若被误设则影响全局）。
- `getMessages:625` 的 `scope_id: auth.user.default_supplier_id || ''` → 若某 supplier 账号 `default_supplier_id` 为空，会匹配**所有** `scope_id:''` 的供应商消息（含跨供应商）。

### 6.5 `markAllMessagesRead` 的 N+1 与放大（P2）

`:671-679` 对 `result.data`（最多 100 条）逐条 `db.collection('message').doc(id).get()` + `update()` → **最多 200 次数据库往返**，云函数单次调用（`package.json` 无超时配置，`dataService` 依赖仅 `wx-server-sdk`）可能触发 20s 超时。且每次进入消息页都会跑一遍。

### 6.6 与事实 5（供应商侧订单头泄漏）的关系

`getSupplierOrders:126-128` 的 `...order` 全量展开（含 `supplier_confirmations` 其他供应商条目、`cancel_requested`、`audit_remark`、`remark` 等）与消息域泄漏是**两条独立的通道**：前者是数据接口层，后者是通知层。本轮确认**通知层不构成供应商→内部的泄漏**（§6.4），主风险仍在接口层（R3 已定级 P1-4）。

---

## 7. `getOrderStats` 口径对账

### 7.1 三处口径逐项对比

| 指标 | `getOrderStats:844-855`（首页） | `getPurchaseOrders:84-106`（列表 tab） | 页面消费 | 一致？ |
|---|---|---|---|---|
| 待处理 | `order_status:'submitted'`（:848） | `draft`(:86) + `submitted`(:87) | `index.js:73` | ❌ **首页无 draft 卡** |
| 待收货 | `_.in(['approved','report_generated','partial_received','to_receive'])`（:849） | 同名 `receivable`(:94) 同集合 | `index.js:74` / `purchase-list.js:90` | ✅ |
| 已完成 | `order_status:'received'`（:850） | `received`(:88) | `index.js:75` | ✅ |
| 收货异常 | **无** | `receiptAbnormal`(:89) | `purchase-list.js:93` | 🔴 **首页缺** |
| 部分收货 | 计入 `receivable`（:849） | 独立 `partialReceived`(:91) | `purchase-list.js:91` | ⚠️ **列表拆开、首页合并** |
| 已作废 | 无 | `cancelled`(:90) | `purchase-list.js:94` | ✅（首页本就不该有） |
| 待核销 | `verify_status:'pending'`，**仅 GLOBAL 才有值**（:852-854，门店角色 `Promise.resolve({total:0})`） | `toVerify`(:92) 无角色限制 | `index.js:77,87` 仅 GLOBAL 渲染 | ✅（但见 7.2） |
| 未读消息 | 不返回 | 不涉及 | `index.js:78` 前端算 | — |

### 7.2 三处口径差异

1. 🔴 **`receipt_abnormal` 在首页四张卡里完全不存在**（`:844-855` 四个 count 无一带它）→ 叠加 §4 死锁 = **异常单在首页永久不可见**。这是最严重的口径缺口。
2. **`draft` 有 tab 无卡片**：`getPurchaseOrders:86` 统计 draft、`purchase-list.js:88` 有"草稿"tab，但 `getOrderStats` 不返回 draft → chef 的草稿在首页驾驶舱不可见。
3. **`to_verify` 无 `order_status` 约束**（`:853`）：`verify_status:'pending'` 不限状态。实际上只有手动单会被置 `pending`（`verifyManualOrder:1460` 要求 `order.is_manual`），所以口径"碰巧正确"，但**语义上是脆弱的巧合**——若将来放开非手动单核销，这里会立即失真。
4. **`to_verify` 对门店角色硬编码 0**（`:854` `Promise.resolve({total:0})`）：`index.js:86-88` 只在 GLOBAL 时 push 该卡 → 一致；但 chef/store_manager 若要催核销，前端无法取数。
5. **`getOrderStats:832-843` 对 chef 加 `created_by` 约束**（:835），`getPurchaseOrders:55` 同样加 → ✅ 一致。但 `:838` store_manager 不加 `created_by`（看全店）→ 与 `getPurchaseOrders:57-59` 一致 ✅。

### 7.3 报表侧口径（`generateSummaryReport`）

`generateSummaryReport` 走 `receipt_item` + `supplier_product_price` 汇总（`report_file` 落 `total_amount`/`item_count`），**不读 `purchase_order.order_status`** → 汇总报表包含已作废订单的收货记录（`cancelOrder:1316-1318` 只把 `report_file` 标 `superseded`，不回滚 `receipt_item`）。**汇总口径 = 收货口径 ≠ 订单口径**。

---

## 8. 金额精度

### 8.1 全仓 26 处金额计算点（已逐处核对）

**主流写法（逐行舍入到分再累加，20 处）**：
```js
sub = Math.round(qty * price * 100) / 100        // 行小计
total = Math.round((total + sub) * 100) / 100    // 累加时再舍一次
```
位置：`createReceipt:591-595`、`createReceipt:674-678`、`dataService:961-965`（settleReceipt）、`dataService:1180-1184`、`dataService:1240-1244`（regenerateReceiptReports）、`getSupplierReceipts:109`。
**这是正确的做法**：先舍后加可避免浮点尾差累积（如 `0.1+0.2`）。

**异类 1**：`getReportDetail:118,189` → `subtotal: (item.received_qty * item.price_snapshot).toFixed(2) * 1`
`toFixed(2)` 先格式化字符串再乘 1 转 number。对绝大多数值与主流写法等价，但**在恰好处在中点时二者可能差 1 分**（`toFixed` 与 `Math.round` 在 IEEE754 下对同一浮点值的处理路径不同）。建议统一为 `Math.round(x*100)/100`。

**异类 2**：`generateSummaryReport:208-209` → `Math.round(x * 1000) / 1000`（**数量**用 3 位精度）
数量保留 3 位、金额保留 2 位，本身合理（重量商品有小数），但**全仓唯一的 3 位精度点**，无第二处对照，无文档说明。

**异类 3**：`getSupplierReceipts:109` 是全仓**唯一未 `.toFixed(2)` 输出**的金额点 → 前端展示可能是 `71.4` 而非 `71.40`。

### 8.2 落库金额字段

| 字段 | 写入点 | 精度 |
|---|---|---|
| `receipt_item.price_snapshot` | `createReceipt:458`（收货时）、`dataService:1068`（**补价时覆写**） | 不校验，原样入库 |
| `receipt_item.received_qty` | `createReceipt:455` | 不校验 |
| `purchase_order_item.order_qty` | `createPurchaseOrder:334`、`dataService:546`（审核改量覆写） | `createPurchaseOrder:232` 仅校验 `>0 && <=1000000`，**无整数校验** |
| `purchase_order.verify_amount` | `dataService:1515` | `:1509` 仅 `Number.isFinite(amount) && amount > 0` → **`12.345` 可入库** |
| `report_file.total_amount` | `generateSummaryReport:252` | `:215` 2 位精度 |

**问题**：
- 🔴 **`verify_amount` 可经 reject→submit 循环静默篡改**（P1）：`verifyManualOrder:1509` 只校验有限且 >0；`:1514-1515` approve 时覆写 `verify_amount`；`:1498-1503` reject 不清除旧 `verify_amount`。流程 `submit(pending) → approve(写入金额 A) → ` 若再走 `submit → approve(写入金额 B)`，**A 被 B 静默覆盖，无历史、无审计**。且 `cancelOrder:1311-1312` 作废时把 `verify_status` 重置为 `'none'` 并写 `verify_cancel_note`，**但不清 `verify_amount`** → 作废单的 `verify_amount` 残留，可被后续复用订单读取。
- 🔴 **事后改价可篡改历史金额**（P1）：见 §3.2。`repriceReceipt:1055-1059` 取**当前** `is_current:1` 价格回填**收货时** `price_snapshot`；配合 `updateProductPrice` 可先把价格调到任意值再补账。
- ⚠️ **`order_qty` 无整数约束**：`createPurchaseOrder:232` → `3.5` 件可下单；`dataService:525` 审核改量同样无整数约束 → 报表出现 3.5 件。
- ⚠️ **无金额上限校验**：`verify_amount` 无上限（`amount <= 1e9` 之类），一个手滑可写入亿级金额，且 `:1514` 直接覆写。

### 8.3 结论

**浮点处理本身是全仓一致的、正确的**（20/26 处同一模式，先舍后加）；**风险不在精度，而在"哪些金额字段可被事后改写"**：`price_snapshot`（补价覆写）、`order_qty`（审核覆写）、`verify_amount`（循环覆写）三个字段都是"写入后仍可无留痕改写"，构成完整的历史金额篡改链。

---

## 9. 枚举与状态机清单

### 9.1 `order_status`（`purchase_order`）

| 值 | 写入点 | 消费者 | 判定 |
|---|---|---|---|
| `draft` | `createPurchaseOrder` | `getPurchaseOrders:86`、`purchase-list.js:88` | ✅ |
| `submitted` | 同上 | 10+ 处 | ✅ |
| `pending_approval` | **无写入点** | `dataService:499,538` 白名单含 | ⚠️ **死状态**（防御性保留） |
| `approved` | `auditOrder:552` | — | ✅ |
| `rejected` | 同上 | `purchase-detail.js:79` canCopy | ✅ |
| `report_generated` | `createReceipt`/报表生成 | 多处白名单 | ✅ |
| `partial_received` | `createReceipt:512` | 多处 | ✅ |
| `to_receive` | 同上 | 多处 | ✅ |
| `received` | 同上 | — | ✅ |
| `receipt_abnormal` | 同上 | 见 §4 | 🔴 **终态死锁** |
| `cancelled` | `dataService:1303` | — | ✅ |
| `completed` | **无 order_status 写入点** | `meta.js:11`、`getSupplierOrders:14` DONE、`purchase-detail.js:39` isDone | ⚠️ **死状态**（`completed` 是 `receipt_status` 的值，被误混入 order_status 枚举） |

### 9.2 `ABNORMAL_TYPE_NAMES` — 3 份拷贝，缺键（P2，本轮新增）

| 拷贝 | 位置 | 键 |
|---|---|---|
| A | `createReceipt:52-57` | `shortage, quality, wrong_item, missing_price` |
| B | `dataService:683-689` | `shortage, quality, wrong_item, missing_price` |
| C | `getReportDetail:12-16` | `shortage, quality, wrong_item` — 🔴 **缺 `missing_price`** |

**后果**：`getReportDetail:23` `ABNORMAL_TYPE_NAMES[type] || type` → 缺价异常在报表详情页显示**裸英文 `missing_price`**。
`dataService:688` 的注释自己承认了这个风险："缺失时异常列表该行显示裸英文 type"——**注释即债务**。
**修复方向**：抽成单一 `utils/abnormal-meta.js`，三处引用同一份。

### 9.3 `missing_price` 全链路

- 定义：`dataService:688`、`createReceipt:56` 字典键；`createReceipt:65` 判定；`createReceipt:474` 加入 `abnormalTypes`。
- 写入：`createReceipt:488-503` `type:'missing_price'`。
- 过滤：`dataService:1078` `where({type:'missing_price', status:_.in(['pending','processing'])})`。
- **消费缺口**：`getReportDetail:20-24` `getAbnormalTypeNames` **不判 `is_missing_price`**（只判 `is_shortage/is_quality_issue/is_wrong_item`）→ 缺价行在报表详情页**不显示为异常**。
- **契约缺口**：`receipt_item` **没有 `is_missing_price` 字段**（R3 §14.3 结论成立）——缺价信息只存在于 `abnormal_record`，要展示必须 join。

### 9.4 三处不同步的"在途状态"字面量（P2）

| 位置 | 内容 | 缺 |
|---|---|---|
| `updateProductPrice:43` `INFLIGHT_ORDER_STATUS` | `['submitted','pending_approval','approved','report_generated','partial_received','to_receive']` | ❌ `draft`、❌ `receipt_abnormal` |
| `authService:632` `ACTIVE_ORDER_STATUS` | `['draft','submitted','pending_approval','approved','report_generated','partial_received','to_receive']` | ❌ **`receipt_abnormal`** |
| `dataService:844` `receivableStatuses` | `['approved','report_generated','partial_received','to_receive']` | ❌ `submitted`（合理）、❌ `receipt_abnormal` |
| `dataService:1294` cancelOrder 拒绝列表 | `['partial_received','to_receive','received','receipt_abnormal']` | ✅ 含 receipt_abnormal |

**关键后果（R8 N-4 的根因）**：`authService:632` 漏 `receipt_abnormal` → 门店存在 `receipt_abnormal` 状态订单时**仍可通过停用校验** → 结合 `login:206-207` 找不到 `status:1` 门店 → 该店 chef/manager 集体登录失败 → 而这单正处于 §4 死锁中 → **无人能处理**。
**修复**：三处统一抽常量，且把 `receipt_abnormal` 加入 `ACTIVE_ORDER_STATUS`。

### 9.5 其他枚举

- `role`：`authService:14-20` `ROLE_LABELS` = `{super_admin, purchaser, store_manager, chef, supplier}` 五值 ✅。前端 `meta.js` 无 role 映射，页面硬编码 `['super_admin','purchaser']` 等数组散落（`index.js:86`、`purchase-detail.js:81,85,86,97`、`receive-list.js:84-87`）。
- `verify_status`：`none`/`''`/`pending`/`rejected`/`approved` — **两种空值并存**（§5.1）。
- `report_file.status`：`generated`→`superseded`，**无删除**；`getReports:90-96` **不过滤** → superseded 与 generated 混在一起（§14-N07）。
- `receipt_status`：`abnormal`/`completed` — 无回写路径（§4.4）。
- `supplier_confirmations.<sid>.status`：`pending/confirmed/shipped/done/cancelled`（`meta.js:23-29`）；写入点 `confirmSupplierOrder:73-80`；清空 `dataService:403`。
- `ABNORMAL_STATUS`：`pending/processing/resolved/closed`，链式守卫 `:743`(pending→processing)、`:763`(processing→resolved)、`:813`(resolved→closed) ✅，但 `repriceReceipt:1082-1089` **跳过 processing 直接置 resolved**。
- **`category` 集合：全仓 0 处 add/update/remove**（仅 seed 初始化）→ 分类只能靠导入，无管理界面。

---

## 10. `supplier_test_user.jsonl` 安全评估

### 10.1 离线复算结果（本轮新做，非推断）

用 `crypto.pbkdf2Sync('Supplier@2026', '62fd5e6ac754c5d7f1652b4fbfa62129', 120000, 32, 'sha256')` 实测：

```
computed: d9d2c5499b7cd16db4364e466c15c8ad45d529b46abaa853e7aa633c4b446de3
expected: d9d2c5499b7cd16db4364e466c15c8ad45d529b46abaa853e7aa633c4b446de3
match  : true
one-try ms: 14.4012   →  单线程约 69,400 次/秒
```

**与 `app_user.json` 的 `U004`（`supplier_test`）逐字节相同。** 哈希方案、salt、迭代次数、密钥长度与 `authService:28-35` 完全一致（`PASSWORD_KEY_LENGTH=32` → 256 bit → 64 hex ✅，`PASSWORD_ITERATIONS=120000` ✅），**因此这些哈希可直接用于登录，无需任何转换**。

### 10.2 五账号密码全为同一模板

`seed-data/README.md` 明文给出 5 个初始密码：`Admin@2026` / `Chef@2026` / `Manager@2026` / `Purchaser@2026` / `Supplier@2026`。`Word@YYYY` 模板空间极小 → **一次字典攻击即可批量破解全部 5 个账号**（含 `super_admin`）。

### 10.3 风险评估

| 项 | 评估 |
|---|---|
| **离线爆破可行性** | 单 Node 线程 69,400 次/秒；PBKDF2-SHA256 在 GPU/多核上高度并行，现代工具对 12 万迭代的实际吞吐可达 1e8+ 次/秒。`Word@2026` 模板（常见词 ~1e4 × 4 位年份 1e2）≈ 1e6 候选 → **工作站级别数小时内可穷尽** |
| **迭代次数** | 120,000 次对 PBKDF2-HMAC-SHA256 **明显偏低**（当前 OWASP 建议 600,000+，且那是针对单 SHA-256；GPU 场景更低）。单核 14.4ms 仅能挡慢速脚本 |
| **算法选择** | PBKDF2-SHA256 是**可用但已过时**的选择；无内存硬化（对比 Argon2id/bcrypt），GPU/ASIC 友好。且**未加 pepper**，salt 只 16 字节，跨环境可复用 |
| **常驻后门风险** | 🔴 `supplier_test_user.jsonl` 与 `app_user.json` 内容完全相同，`status:1`、无过期时间、`default_supplier_id:'SUP001'` 指向**真实供应商档案** → **只要导入 seed 就等于在库里植入了一个永久有效、永不过期、无法通过界面发现的外部账号** |
| **权限影响面** | 供应商角色**无管理写权限**（§2 矩阵全 ❌），可做的事：读供应商域数据、`confirmSupplierOrder` 标记已发货（`confirmSupplierOrder:73-80` 写入 `supplier_confirmations`，进而影响门店侧收货与报表口径） |
| **与 `authService` 的关系** | 方案完全一致（同 `hashPassword`/`verifyPassword`/`timingSafeEqual`），**无需适配即可登录**；`getSessionUser` 的 19 份副本都认这套哈希 |
| **凭证暴露面** | 密码明文在 `seed-data/README.md` 与 git 历史中 → **事实上的公开凭证**；`supplier_test_user.jsonl` 作为独立文件的存在暗示"专门用于测试/后门"的意图 |

### 10.4 结论与建议

**严重度：P0**（不是因为它权限高，而是因为**凭证公开 + 账号永久有效 + 与生产哈希方案零差异**三者叠加）。

1. **立即**：生产库中若已导入 `supplier_test`，**停用或重置密码**（`authService:489` setUserStatus 置 0），并从 git 历史清理 `seed-data/README.md` 的明文密码段与 `supplier_test_user.jsonl`。
2. **迭代次数**提升到 ≥ 300,000（PBKDF2-SHA256 现状下的最低可接受值）。
3. **哈希升级**：迁移到 Argon2id（`memoryCost 64MiB, iterations 3, parallelism 4`）或至少 bcrypt（cost ≥ 12）；`authService:28-35` 是唯一哈希入口，改造面集中。
4. **首次登录强制改密**：`login` 时若命中 seed 初始密码（可加 `password_changed_at` 字段）则强制跳转改密。
5. **seed 文件加保护**：`supplier_test_user.jsonl` 从 seed-data 移出到本地未跟踪目录，或改为运行时生成随机密码。

---

## 11. 集合引用完整性（外键孤儿）

**全项目无数据库外键**（CloudBase 无约束），一致性全靠应用层。写入端校验情况：

| 关系 | 写入端校验 | 结论 |
|---|---|---|
| `purchase_order.store_id` → `store` | `createPurchaseOrder:164,198` `where({store_id, status:1})` | ✅ 有校验 |
| `purchase_order_item.product_id` → `product` | `createPurchaseOrder:219` `where({product_id:_.in(...), status:1})` | ✅ 有校验 |
| `purchase_order_item.supplier_id` → `supplier` | **无**（`createPurchaseOrder:389` 只批量取名用于报表） | 🔴 **可指向停用供应商** |
| `supplier_product_price.supplier_id/product_id` → | `updateProductPrice:91-92` 双查 `status:1` | ✅ 有校验 |
| `receipt_item.purchase_order_item_id` → | `createReceipt:451` `item.orderItemId \|\| ''` | ⚠️ **允许空串**（手动行绕过） |
| `abnormal_record.*` → | 无校验 | ⚠️ |
| `report_file.source_order_id` → | 无校验 | ⚠️ |

### 11.1 实际孤儿路径

1. 🔴 **`toggleSupplier` 无在途校验**（`dataService:176-185`）：只翻转 `status`，**不检查该供应商是否有在途订单/未结账单/有效价格**。对比 `authService:630-638` `setStoreStatus` 有在途单检查 → **门店停用有保护、供应商停用毫无保护，不对称**。后果：
   - 在途单的报表供应商名回退成裸 ID（`createReceipt:553` `supplierNameMap[sid] || supplierId || ''`）；
   - 已生成的带价账单指向一个"已停用"供应商，**账单照出但供应商已不可再下单**；
   - `supplier_product_price` 的有效价格（`is_current:1`）随供应商停用**不失效**，`createReceipt:342-346` 仍会取到价 → **停用供应商仍可被定价与结算**。
2. 🔴 **`toggleProduct` 同样无在途校验**（`dataService:132-141`）：停用后 `createPurchaseOrder:219` 拒绝新单 ✅，但**在途订单与已收货明细仍指向已停用商品**，报表商品名回退。
3. **`deleteUser` 孤儿 `created_by`**：`authService:489-494` setUserStatus 只置 `status:0`（软删除）→ `created_by` 仍可解析 ✅；但 `deleteUser`（真删）会让 `getPurchaseOrders:134-135` 的 `creatorMap` 查不到 → 列表显示裸 user_id。
4. **`created_by` 的 `_id` 兜底永不生效**（P2，本轮新增）：`createPurchaseOrder:293` 写 `user.user_id || user._id`；`getPurchaseOrders:134` 用 `where({user_id: _.in(idChunk)})` 反查，`:135` `creatorMap[user.user_id] = user.name` → **若 `created_by` 是 `_id`（无 `user_id` 的老账号），`user_id` 匹配不上 → 创建人显示裸 `_id`**。`dataService:495` 的 `auditorId = user_id || _id` 有双向兜底，这里没有。
5. **`report_file.source_order_id` 永久残留**：作废单只把 report 标 `superseded`（`dataService:1316-1318`），不删行；`regenerateReceiptReports` 重复生成同 `_RG` 行（§3.3）→ **`report_file` 是单调增长的、只增不删的集合**。
6. **`receipt.photo_file_ids` / `verify_voucher_file_ids` 云存储残留**：`verifyManualOrder:1486` 会 `cloud.deleteFile` 清理被替换的旧凭证 ✅（有意为之）；`receipt.photo_file_ids` **无任何删除路径**（全仓无 receipt 删除功能）→ 云存储永久累积。
7. **`report_version_counter` 无 seed 样本**（旧文档 H7 已在 full-scan-03 确认为运行时 upsert，**回收：不构成问题**）。

---

## 12. `regenerateOrderReports` 死 action 判定

**证据链（本轮实测）**：

1. **云端实现完整**：`dataService:988-1023`，56 行，含参数校验、订单查询、明细查询、`qtyMap` 构建、`regenerateApprovedOrderReports(order, orderItems, qtyMap, false)` 调用、清 `missing_reports` 标记。
2. **路由已接**：`:1548` `case 'regenerateOrderReports': return await regenerateOrderReports(event)`。
3. **前端零调用**：全仓 grep `regenerateOrderReports` 在 `pages/`、`utils/`、`app.js` **0 命中**（26 页 + 4 utils 全部遍历）。
4. **补偿触发点存在且明确**：`createPurchaseOrder:435-462` 报表生成失败时写 `missing_reports:true`（`:440`）+ 发站内消息给超管（`:446-457`），**消息正文明确写了"请管理员补生成"**。
5. **前端无入口**：`pages/report-list/report-list.js` 只提供 `getReports` 与 `generateSummaryReport`，**无 regenerateOrderReports 按钮**。
6. **对照存在**：收货侧的 `regenerateReceiptReports`（`:1105`）**有入口**（`receive-list.js:148-149`），同文件、同风格、同权限（GLOBAL_ROLES）。

**判定：漏接入口，不是设计如此。** 理由：
- 若为有意不提供，`createPurchaseOrder:446-457` 就不会写"请管理员补生成"——**这条消息是一个永远不会被兑现的承诺**；
- 同文件已存在对称的 `regenerateReceiptReports` 且有前端入口，说明团队**有意提供补偿入口**，只是订货侧漏接；
- `regenerateApprovedOrderReports`（`:385-480`）是**只被 `auditOrder` 和 `regenerateOrderReports` 两处调用的公共函数**，其完整实现的存在本身证明这个入口是被预期使用的。

**影响**：订货类报表（① 门店下单 / ② 供应商订货汇总）生成失败后，**唯一补偿路径断裂**。叠加 `dataService:1019-1020` 会清 `missing_reports` → 若有人通过控制台手工调用，标记会被清掉但前端**永远不会提示**。

**修复**：在 `pages/report-list/report-list.js` 或 `pages/purchase-detail/purchase-detail.js` 加一个 `missing_reports === true` 时显示的"补生成订货报表"按钮，调用 `dataService.regenerateOrderReports(orderId)`，仅 `['super_admin','purchaser']` 可见（与 `receive-list.js:84` 的 `canRegenerate` 同模式）。

---

## 13. 旧结论复核表 + 旧【待核实】回收表

### 13.1 旧结论逐条判定

| # | 旧结论 | 出处 | 本轮判定 | 依据 |
|---|---|---|---|---|
| 1 | `dataService` 22 个 action 嵌套 `{error:{code,msg}}` | R8 N-1 / 主控事实 2 | ✅ **仍成立** | `dataService:47,49` 原文 `return { error: { code: -401, msg: ... } }`；`utils/cloud.js:68` 只判顶层 |
| 2 | `getSessionUser` 19 份副本 | 主控事实 3 | ✅ **仍成立** | 19 个云函数各 1 份，`dataService:17` 是其一 |
| 3 | 全项目 0 处裸 `where().get()` | 主控事实 4 | ✅ **仍成立** | 所有 `where().get()` 均带 `.limit()` |
| 4 | `getPurchaseOrders:119-124` 聚合上限算错 | 主控事实 4 | ✅ **仍成立，且定级上调** | `:121-124` 每 20 单 chunk `.limit(1000)`；每单上限 100 行（`createPurchaseOrder:210`）→ 2000 > 1000 → **静默截断**。`getReceipts:74-79` 同样 |
| 5 | 供应商侧订单头泄漏 | 主控事实 5 | ✅ **仍成立** | `getSupplierOrders:126-128` `...order` 全展开 |
| 6 | `setStoreStatus` 漏 `receipt_abnormal` | R8 N-4 / 主控事实 6 | ✅ **仍成立，根因已定位** | `authService:632` 字面量缺该值；见 §9.4 |
| 7 | `receipt.missing_reports` 永不重置 | R3 P1-7 / 主控事实 7 | ✅ **仍成立，且后果更严重** | `createReceipt:705-707` 写入；全仓无清除点 → UI 按钮永久可见 → 叠加 §3.3 重复账单 |
| 8 | `authService:630-638` 停用门店后集体登录失败 | 主控事实 8 | ✅ **仍成立** | 与 6 叠加构成"异常单无人处理"的完整闭环 |
| 9 | `receipt_abnormal` 终态死锁 | R3 S-1 | ✅ **仍成立，本轮确证为双向死锁 + 三重后果** | §4 全表 |
| 10 | `createReceipt:386` 注释与 `:392` 实现矛盾 | R3 H1 | ✅ **仍成立** | 注释"允许继续补收"，白名单不含 |
| 11 | `requestCancel` 状态集与 `cancelOrder` 不一致（S-2） | R3 S-2 | ⚠️ **前端已缓解，后端契约仍错** | 前端 `purchase-detail.js:84` `cancelEligible` 已排除 `partial_received` → **UI 不可达**；但 `dataService:1348` 后端仍允许 → 仅直调可达。R3 称"用户永久失去申请取消入口"部分正确，但触发条件比 R3 描述的窄 |
| 12 | `supplier.address` 无入口（GAP-1） | R8 | ✅ **仍成立** | `dataService:148-153` 不写 address |
| 13 | `app_user.mobile` 前端从不传 | R8 | ✅ **仍成立**（未逐项复核前端表单，按 R8 结论继承） | — |
| 14 | `report_version_counter` 无 seed 样本 | batch1 H7 | ✅ **已解答**（full-scan-03）：运行时 `getNextVersion` upsert，**不构成问题** | `dataService:364-376` 先 update 后 add 兜底 |
| 15 | `deleteUser` 无前端入口 | horizontal-scan | ✅ **仍成立**（继承） | — |
| 16 | `verify_status='pending'` 是否本应由收货驱动 | R8 D-2 | 🔴 **本轮给出确定答案：是** | 手动单收货带异常 → `receipt_abnormal` → `verifyManualOrder:1460` 要求 `received` → **永久卡死**。见 §4.4-3 |
| 17 | `receipt_item` 无 `is_missing_price` 字段 | horizontal-scan §14.3 | ✅ **仍成立** | grep 0 处 |
| 18 | `regenerateOrderReports` 无前端入口 | horizontal-scan / 主控事实 1 | ✅ **仍成立，本轮给出性质判定**：漏接入口 | §12 |
| 19 | `ABNORMAL_TYPE_NAMES` 字典漂移 | （旧文档未识别） | 🔴 **本轮新增**：3 份拷贝，`getReportDetail:12-16` 缺 `missing_price` | §9.2 |
| 20 | `getReports` 不过滤 `report_file.status` | （旧文档未识别） | 🔴 **本轮新增**：superseded 与 generated 混列 | `getReports:90-96` |
| 21 | `settleReceipt` 去重粒度错 | （旧文档未识别） | 🔴 **本轮新增** | §3.1 |
| 22 | `repriceReceipt` 篡改历史金额 | （旧文档未识别） | 🔴 **本轮新增** | §3.2 |
| 23 | `receipt_status` 与 `order_status` 双向死锁 | （旧文档只说了一半） | 🔴 **本轮补全** | §4.4 |
| 24 | `basis_date_type` 纯死字段 | （旧文档未识别） | 🔴 **本轮新增** | §5.3 |
| 25 | seed-data 三种文件格式并存 | （旧文档未识别） | 🔴 **本轮新增** | §5.1 |
| 26 | `getMessages` 内部用户可读供应商消息 | （旧文档未识别） | 🔴 **本轮新增** | §6.4 |

### 13.2 旧【待核实】回收表

| # | 原【待核实】内容 | 出处 | 本轮判定 | 依据 |
|---|---|---|---|---|
| 1 | `transaction.rollback({code,msg})` 参数是否进入 `err.errMsg` | R3 #1 | ✅ **回收：不影响功能，仅影响文案** | `dataService:539` `rollback({...})` + `:561` `err.errMsg.includes('该订单已经审核')`。第二个审核必失败（`:533-541` 复查）→ 功能安全；文案可能退化为通用错误 |
| 2 | `.where({$or:[...]})` 字面量是否被 SDK 识别 | R3 #2 | ⚠️ **仍待核实，但已定位为低危** | `dataService:1410-1419` 用 `$or` 字面量；同文件 `:617,702,849` 用 `_.or()`。**若不支持，`remindAudit` 会误返回"已催办过"**（`:1421`），属误拒而非越权 |
| 3 | `created_at` 在云函数内的回读形态 | R3 #3 | ⚠️ **仍待核实** | 决定 `getSupplierOrders:116` `String(b.created_at).localeCompare(...)` 是否按星期名排序。若为 Date 对象则排序完全错乱 |
| 4 | `supplier_product_price` 唯一性 | R3 #4 | 🔴 **回收：已确认唯一性有保障，风险不成立** | `updateProductPrice:106-131` 是事务：先 `where({supplier_id,product_id,is_current:1}).limit(100)` 全部置 0，再 add 一条 `is_current:1` → **单条唯一性由事务保证** |
| 5 | `importProducts` 是否写 `category_name` | R3 #5 | 🔴 **回收：已确认写入，P2-22 不成立** | `importProducts:122-126` 写 `category_level_1, category_level_2_id, category_name, manufacturer_name` 四字段齐全 |
| 6 | 前端 `parseFloat` 是否已限制两位小数 | R3 #6 | 🔴 **回收：无限制** | `dataService:1509` 仅 `Number.isFinite && >0`；`updateProductPrice` 同 → **三位小数可入库** |
| 7 | `regenerateOrderReports` 是否有入口计划 | R3 #7 | 🔴 **回收：判定为漏接** | §12 证据链 |
| 8 | `receipt_item/purchase_order_item` 的 `limit(1000)` 假设 | R3 #8 | 🔴 **回收：确认是分块维度而非单文档维度，风险真实** | §7 / §11；`getPurchaseOrders:119-124` 与 `getReceipts:74-79` |
| 9 | `getReports.storeId` 对 GLOBAL 角色失效 | R8 N-2 | ⚠️ **仍待核实**（产品决策） | `getReports:77-86` 对 GLOBAL 未设 scope |
| 10 | `store-switch` 对门店角色是否保留入口 | R8 N-3 | ⚠️ **仍待核实**（产品决策） | — |
| 11 | 停用门店是否需阻断"门店下仍有活跃账号" | R8 N-4 | 🔴 **回收：需要** | 与 §9.4 合并为同一修复项 |
| 12 | `verify_status='pending'` 是否应由收货驱动 | R8 D-2 | 🔴 **回收：是**，见 §4.4-3 | — |
| 13 | `authService.getStores` 是否应对非超管拒绝停用门店 | R8 OA-1 | ⚠️ **仍待核实**（产品 + 安全） | — |
| 14 | `app_user.mobile` 字段无入口 | R8 #7 | ⚠️ **仍待核实**（未逐项复核前端表单） | — |
| 15 | `importProducts` 必填校验与模板说明是否一致 | R8 #1 / P3-1 | ⚠️ **仍待核实** | `importProducts:11-19` HEADER_ALIASES 列名映射已核，错误行生成逻辑未逐行核 |

**回收率：15 条中 8 条已回收（53%），其中 2 条为"旧文档担心的风险不成立"（#4 价格唯一性、#5 importProducts 字段）。**

---

## 14. 新问题清单（P0 / P1 / P2）

### P0

- **N01 `dataService` 22 个 action 全部返回嵌套错误**（`dataService:47,49`）。影响面：`utils/cloud.js:68` 只读顶层 `result.code` → 会话过期**不跳登录页**；`index.js:62` `statsResult.code !== 0` 因 `undefined !== 0` 恒真 → **首页整页失败提示并 return，数据全空**；`message.js:42,78` 吞掉真实文案只显示兜底。**这是 P0 而非 P1 的理由：它让会话过期时用户被永久困在首页，且无任何提示指向"重新登录"。**
- **N02 `supplier_test_user.jsonl` 公开凭证 + 永久有效供应商账号**。§10 已离线复算验证哈希命中。凭证在 git 历史中，账号 `status:1` 永不过期。

### P1

- **N03 `settleReceipt` 去重粒度错** → 多供应商中途失败后剩余供应商**永久缺补充账单**；并发双击产出同 `report_id` 双份账单。`dataService:889-895` vs `:951-980`。
- **N04 `repriceReceipt` 覆写历史价格快照**，无原价留痕，`handled_by` 被覆盖。`dataService:1055-1069,1086`。
- **N05 `regenerateReceiptReports` 不置旧版 superseded** → 每次点击插入同 `_RG` 重复账单行。`dataService:1160-1258`。
- **N06 `receipt.missing_reports` 永不重置** → 补生成按钮永久可见，与 N05 构成"点一次多一笔"的完整链路。`createReceipt:705-707`。
- **N07 `receipt_abnormal` 双向终态死锁**（`order_status` + `receipt_status`），且**顺带卡死手动单凭证核销**。§4。
- **N08 `resolveAbnormal` 允许 store_manager 写 `payment_decision='pay_received'`**，与 `settleReceipt:871` 的 GLOBAL_ROLES 形成"店长解锁、管理员出账"的错配，**付款裁决无管理员复核**。`dataService:751,766-772`。
- **N09 `verify_amount` 可经 reject→submit 循环静默覆盖**，无历史留痕；`cancelOrder:1311-1312` 重置 `verify_status` 但不清 `verify_amount`。`dataService:1509-1515`。
- **N10 `getOrderStats` 四张卡不含 `receipt_abnormal`** → 异常单在首页驾驶舱永久不可见。`dataService:844-855`。
- **N11 分块查询静默截断**：`getPurchaseOrders:119-124`、`getReceipts:74-79` 均为 20 × 1000 = 20000 名义容量但单 chunk 20 单 × 100 行 = 2000 > `limit(1000)` → **明细丢失**。
- **N12 `authService:632` `ACTIVE_ORDER_STATUS` 漏 `receipt_abnormal`** → 有异常单的门店可被停用 → 叠加 `login:206-207` 登录失败 → **该店的异常单永久无人可处理**。
- **N13 `getReports:90-96` 不过滤 `report_file.status`** → superseded 旧报表与 generated 混列、`total` 虚高、可下载已作废报表。
- **N14 `toggleSupplier`/`toggleProduct` 无在途校验** → 停用后在途报表名回退裸 ID、已生成账单指向已停用对象、停用供应商的有效价格仍可用于结算。`dataService:132-141,176-185`。

### P2

- **N15 `ABNORMAL_TYPE_NAMES` 3 份拷贝**，`getReportDetail:12-16` 缺 `missing_price` → 报表详情页显示裸英文。
- **N16 四处"在途状态"字面量不同步**（§9.4）。
- **N17 `getMessages:623-633` 内部用户可读供应商定向消息**；`markMessageRead:650-653` 不校验 `scope_type`。
- **N18 未读数口径失真**：`getMessages:634` `limit(100)` + 前端 `filter(!read).length` → >100 条时未读数被截断，`markAllMessagesRead:672-679` 也只能标最近 100 条。
- **N19 `markAllMessagesRead` N+1**：最多 200 次 DB 往返，可能触发云函数超时。
- **N20 seed-data 三种文件格式并存**（NDJSON / JSON 数组 / 单对象缩进）→ 任一解析策略必在一个文件上失败。
- **N21 `basis_date_type` 写 10 读 0**，且 seed 全无 → 契约死字段。
- **N22 seed 与运行期契约不一致 7 处**：`abnormal_record.abnormal_id` 格式、`receipt_item` 缺 `is_*`、`report_file` 缺 `basis_date_type`、`supplier.address` 只有 seed 有、`message.read` 全局语义、`app_user` 缺 session 字段、`price_id` 格式不同。
- **N23 `created_by` 的 `_id` 兜底永不生效** → `getPurchaseOrders:134-135` 反查失败，创建人显示裸 `_id`。
- **N24 `requestCancel:1352-1354` 死代码守卫**（`GLOBAL_ROLES` 已限定，分支永假）。
- **N25 `verifyManualOrder` approve/reject 不发通知** → 店长无核销回执。
- **N26 `order_qty`/`verify_amount` 无整数与上限校验**，`3.5` 件与 `12.345` 元均可入库。
- **N27 金额异类写法 3 处**：`getReportDetail:118,189` 用 `.toFixed(2)*1`、`generateSummaryReport:208-209` 用 3 位精度、`getSupplierReceipts:109` 未 `toFixed`。
- **N28 `price_id = 'PRC_' + Date.now()`** 同毫秒冲突且事务内不校验唯一。
- **N29 `getSuperAdminId:112-116` 用 `limit(1)` 无 orderBy** → 多超管时随机选一个发"报表失败"通知。
- **N30 10 个幽灵字段**（`audit_status`/`is_abnormal`/`abnormal_type`/`order_type`/`order_id`/`total_quantity`/`quantity`/`settle_status`/`settle_amount`/`actual_*`）在仓库中完全不存在，但出现在任务下发的契约清单里。
- **N31 `category` 集合全仓 0 处写入** → 分类只能靠 seed 导入，无管理界面。
- **N32 `pending_approval` 与 `completed`(order_status) 为死状态**，仍在多处白名单中出现。
- **N33 `verify_status` 两种空值**（`'none'` 与 `''`）并存。
- **N34 `receipt.photo_file_ids` 无删除路径** → 云存储永久累积。
- **N35 `remindAudit:1410-1419` 用 `$or` 字面量**而非常规 `_.or()`，与同文件其他 3 处不一致。
- **N36 `getReports:81` 对 chef 强制 `report_type:'store_order_report'`**，chef 无法看到收货类报表（可能是设计，但与 `store_manager` 不限类型不对称）。

---

## 15. 遗留【待核实】

| # | 内容 | 需要什么才能确认 |
|---|---|---|
| 1 | `.where({$or:[...]})` 字面量是否被 CloudBase SDK 识别（`dataService:1410-1419`） | 在测试环境用 `remindAudit` 触发一次催办，观察 `updated` 计数；或查 SDK 文档 `where` 对 `$or` 的支持 |
| 2 | `created_at` 在云函数内的回读形态是 Date 对象还是 ISO 字符串（影响 `getSupplierOrders:116` 排序） | 云函数内打一次 `typeof created_at` + `String(created_at)` 日志 |
| 3 | `getReports.storeId` 对 GLOBAL 角色失效（R8 N-2）是漏实现还是设计 | 产品确认 |
| 4 | `store-switch` 对门店角色是否应保留入口（R8 N-3） | 产品确认 |
| 5 | `authService.getStores` 是否应对非超管拒绝返回停用门店（R8 OA-1） | 产品 + 安全确认 |
| 6 | `app_user.mobile` 前端表单是否真的从不传（R8 #7） | 复核 `pages/user-manage/*.js` 的表单字段 |
| 7 | `importProducts` 的必填校验与 `product-import-template.md` 说明是否完全一致（R8 #1） | 逐行核对 `importProducts:60-209` 的错误行生成逻辑 |
| 8 | `dataService` 云函数超时配置（影响 N19 的 200 次往返是否真的会超时） | `project.config.json` / 云函数控制台配置 |
| 9 | `transaction.rollback({code,msg})` 的参数是否被序列化进 `err.errMsg` | 触发一次并发审核看实际错误文案 |
| 10 | 生产库是否已导入 `supplier_test`（决定 N02 的实际暴露面） | 查生产 `app_user` 集合是否有 `username:'supplier_test'` 且 `status:1` |

---

## 附：本次全读文件数与行数

- **全读文件 18 个，合计 2058 行**（17 个必读文件 + `seed-data/report_file.json` 已计入；另加 `cloudfunctions/dataService/package.json`）
- **定点读/交叉反查文件 32 个**（19 云函数 + 4 utils + 9 页面）
- **新增确认的问题 36 项**（P0 × 2、P1 × 12、P2 × 22）
- **旧【待核实】回收 8/15**
