# R4 重扫：收货与异常链路云函数（2026-10-04）

> **范围**：`cloudfunctions/createReceipt`（752 行）、`cloudfunctions/getReceipts`（92 行）、`cloudfunctions/getSupplierReceipts`（119 行）+ 各自 `package.json`；交叉参照 `dataService`（三个补账 action + 异常状态流转）、`createPurchaseOrder`、`confirmSupplierOrder`、`getReportDetail`、`authService`、`generateSummaryReport`、收货/异常 4 组前端页面、3 份 seed-data、`utils/meta.js`。
> **方法**：只信代码，不采信注释/README/log.md；每条结论带 `文件:行号`；拿不准标【待核实】。
> **前置文档**：`full-scan-02-cloud-purchase-receipt.md`（H1/H2 与跨批次待核实 8 项）、`full-scan-04-cloud-data-product.md`、`full-scan-06-pages-report.md`、`full-scan-08-infra-and-data-contract.md`、`batch2-purchase-flow.md`、`controller-horizontal-scan-20261004.md`。
> **版本基线**：HEAD = `5268379`，工作区未提交改动 `pages/report-list/report-list.js`、`project.config.json`（未纳入本次结论）。
> **与上一轮的关键差异**：本轮不是补写，而是**验证 3558678 / 5268379 两个 commit 是否真的闭合了收货域的问题**。结论：**两处新改动都只闭合了半个面**，且 `createReceipt` 本体在 3558678 中**完全未被触碰**（见 §0.3）。

---

## 0. 增量摘要

### 0.1 最严重的 5 个问题（详见 §11）

| # | 等级 | 一句话 | 位置 |
|---|---|---|---|
| 1 | **P0** | `receipt_abnormal` 是**永久死角**：不能继续收货，也不能作废，全库无任何状态写出口 | `createReceipt:228,392` + `dataService:1294` |
| 2 | **P0** | `settleReceipt` **无条件重复出账**：不过滤「异常已被 reject 裁决」、不去重「原带价账单已含的行」→ 供应商同一批货收到两张同额账单 | `dataService:898-926,951-978` |
| 3 | **P1** | `repriceReceipt` 一旦补价成功但报表重建失败，**没有任何 UI 恢复入口**，且补价记录已不可重入 | `dataService:1047-1048,1072-1094` + `receive-list.wxml:50` |
| 4 | **P1** | **无供应商的档案商品静默漏账**：`missing_price` 触发条件要求 `supplierId` 非空，无供应商行既不进带价账单、也不生成任何异常记录 | `createReceipt:350,366` |
| 5 | **P1** | **门店日/月汇总金额把不可付款行算进应付总额**：只排 `is_manual`，不查 `payable_flag` | `generateSummaryReport:193` |

### 0.2 两个新改动的闭合判定

| 改动 | 声称 | 实际闭合度 |
|---|---|---|
| `3558678` "add missing_price dict" | 给异常字典补 `missing_price` | **只补了 1/3**。仅 `dataService:688` 加了；`getReportDetail:12-16`（报表详情侧，3 键）**没加**，`supplier-receipts.js:56`（供应商端本地 map，3 键）**没加**，`abnormal-list.wxss` 无 `.type-dot-missing_price`。生成侧**本来就通**（`createReceipt:366-368,474`），不是这次加的 |
| `3558678` "inactive store support" | 门店停用支持 | **只改了列表读取侧**（`authService.getStores` 加 `includeInactive`，diff 确认）。**收货侧 0 行改动**——`createReceipt:178,188` 的 `status: 1` 过滤原样保留。拒绝停用门店收货本身是对的，但 `authService:632` 的在途单白名单**漏了 `receipt_abnormal`**，于是"停一家有异常收货物在途的门店"可以成功执行，随后该店全部采购单**既不能收货也不能作废** |
| `5268379` "guard rails" | 收货页权限与守卫 | **仅 4 行改动**：`receive-list.js:87` 新增 `canSettle` 角色标志（闭合 batch2 §5.4「补结算无角色条件」）+ `wxml:52` 加 `canSettle`。batch2 §5.5 的 3 条交互缺陷（防抖置位在 confirm 之后、`_submitting`/`hideLoading` 不在 `finally`、三 action 共用一把锁）**全部原样未修** |

### 0.3 一行决定性事实

```
git show 3558678 -- cloudfunctions/createReceipt/index.js   → 空输出
```

声称"对齐状态过滤"的 commit **没有改 `createReceipt` 一个字符**。因此 full-scan-02 的 **H1（`receipt_abnormal` 死锁）在两个 commit 后依然原样存在**，注释 `:386` 与白名单 `:392` 的自相矛盾也原样保留。

---

## 1. 文件清单与全读确认

### 1.1 必读全读（6 文件，990 行，逐行读完）

| 路径 | 行数 | 全读 |
|---|---|---|
| `cloudfunctions/createReceipt/index.js` | 752 | ✅ |
| `cloudfunctions/getReceipts/index.js` | 92 | ✅ |
| `cloudfunctions/getSupplierReceipts/index.js` | 119 | ✅ |
| `cloudfunctions/createReceipt/package.json` | 9 | ✅ |
| `cloudfunctions/getReceipts/package.json` | 9 | ✅ |
| `cloudfunctions/getSupplierReceipts/package.json` | 9 | ✅ |

三个 `package.json` 结构完全一致：`version 1.0.0`、`main: index.js`、唯一依赖 `wx-server-sdk: ~2.6.3`。**无共享模块**——`getSessionUser`/`hashToken`/`csvField`/`safePathPart`/`getNextVersion` 在各函数内重复实现（与主控已确认的 19 份 `getSessionUser` 复制一致；本轮实测 `createReceipt:13-39` 与 `getReceipts:12-38`、`getSupplierReceipts:13-39` 三份**逐字相同**）。

### 1.2 交叉参照全读（15 文件，≈2,133 行）

`createPurchaseOrder/index.js`(471)、`confirmSupplierOrder/index.js`(124)、`utils/meta.js`(67)、`seed-data/abnormal_record.json`(1)、`seed-data/receipt.json`(12)、`seed-data/receipt_item.json`(2)、`pages/receive-list/{js,wxml}`(185+57)、`pages/receive-verify/receive-verify.js`(269)、`pages/abnormal-list/{js,wxml}`(110+57)、`pages/purchase-detail/purchase-detail.js`(385)、`pages/supplier-receipts/{js,wxml}`(82+31)、`generateSummaryReport/index.js`(≈280)。

### 1.3 交叉参照部分读取（4 文件，共 2,766 行，实读 ≈1,300 行）

- `cloudfunctions/dataService/index.js`(1559)：读完 `1-140`、`183-302`、`355-429`、`480-575`、`650-1290`、`1309-1559`；未逐字读 `140-183`（供应商增删改）、`302-355`（供应商通知辅助）、`429-480`（下单报表生成）。**§5 三个补账 action 与 §3/§4 相关段落全部读完。**
- `cloudfunctions/authService/index.js`(~665)：读 `315-324`（getStores diff 段）、`612-645`（setStoreStatus）。
- `cloudfunctions/getReportDetail/index.js`(~260)：读 `1-40`（异常字典与派生函数）。
- `utils/cloud.js`(~282)：读 `133-137`、`227-262`（照片上传路径与归一化契约）。

### 1.4 前置文档读取

`full-scan-02`(427 行，全读)、`batch2-purchase-flow.md`(750 行，读 §5.3-5.8、§6.7-6.10、§7、§9、§10)、`full-scan-06`(514 行，异常口径相关段)、`controller-horizontal-scan-20261004.md`(373 行，异常/时区相关段)。

---

## 2. 异常生成规则全量表

**核心事实**：`createReceipt` 中异常判定只有 4 个布尔位，全部在事务内 `:470-504` 落库。**没有任何"应收-实收"差值字段、没有容差、没有等值容错**——全是严格 `<` / `>`。

### 2.1 四个标志位的来源与判定

| 标志 | 设置位置 | 判定条件 | 判型 | 谁可控 |
|---|---|---|---|---|
| `isShortage` | `:325-328` | `(historyQtyMap[oi] \|\| 0) + item.receivedQty < item.orderQty` | **严格小于**，无容差；`historyQtyMap` 在**事务外**读（`:252-262`） | 服务端强制置 true（单向），客户端也可预先置 true，**服务端从不反向强制 false** |
| `isQualityIssue` | 透传 `:281`（`...inputItem`） | 无判定 | — | **完全客户端可控**，服务端零校验 |
| `isWrongItem` | 透传 `:281` | 无判定 | — | **完全客户端可控**，服务端零校验 |
| `isMissingPrice` | `:366-368` | `!isManual && priceSnapshot <= 0 && item.supplierId && item.receivedQty > 0` | 严格 `<= 0` | 服务端派生 |

价格来源 `:342-347`：`supplier_product_price` where `{product_id: _.in(20条chunk), is_current: 1}` + `.limit(100)`，按 `` `${supplier_id}|${product_id}` `` 建 map。**收货时现取，不是下单快照**；`supplierId` 为空时 `:350` 直接给 0。

### 2.2 异常记录写入矩阵（`:470-504`，同一行商品可产生最多 4 条）

| type | 触发 | `description` 模板 | `payableFlag` 结果（`:356-369`） |
|---|---|---|---|
| `shortage` | `isShortage` | `` `${productName}下单${orderQty}${unit}，实收${receivedQty}${unit}` `` | `hardAbnormal=false` → **仍为可付款**（按实收计价，B4 拍板） |
| `quality` | `isQualityIssue` | `` `${productName}存在质量问题` `` | `hardAbnormal=true` → **不可付款** |
| `wrong_item` | `isWrongItem` | `` `${productName}存在错货问题` `` | `hardAbnormal=true` → **不可付款** |
| `missing_price` | `isMissingPrice` | `` `${productName}未配置供应商协议价，实收${receivedQty}${unit}未进结算，请补价后补账` `` | `priceSnapshot<=0` → **不可付款** |

`payableFlag = !hardAbnormal && item.payableFlag !== false && priceSnapshot > 0`（`:363`），手动行恒 `false`（`:360-361`）。落库 `:459` 写 `payable_flag: item.payableFlag !== false`（缺失视为可付款）。

`abnormal_record` 写入字段（`:488-503`）：`abnormal_id = ${receiptId}_${i+1}_${type}`、`receipt_id`、`purchase_order_id`、`product_id`、`supplier_id`、`store_id`、`store_name`、`type`、`description`、`status:'pending'`、`resolution:''`、`created_at`、`updated_at`。

> **数据契约缺口**：**不落数量、不落单价、不落金额、不落 `receipt_item_id`、不落单位**。因此 `abnormal_record` 无法独立对账到"差多少货、差多少钱"，只能靠 `receipt_id` 反查 `receipt_item`（这正是 full-scan-06 §5.2 说"两条异常链无法关联"的根因，本轮确认**未修**——`dataService:718-730` 返回体仍丢弃 `receipt_id/purchase_order_id/product_id`）。

### 2.3 零值 / 空值分支走查

| 场景 | isShortage | isMissingPrice | payableFlag | 结果 |
|---|---|---|---|---|
| 应收10 实收0，有价有供应商 | true | false（`receivedQty>0` 不成立） | **true** | 生成 shortage 异常 + **以 0.00 计入带价账单**（`:583` 只滤 `payableFlag && !isManual`，不滤数量）→ 账单出现 0.00 行 |
| 应收10 实收0，无价 | true | false | false | 仅 shortage 异常，不进账单，**无 missing_price 提示补价** |
| 应收10 实收10，**商品无默认供应商** | false | **false**（`supplierId` 空） | **false** | ⚠️ **静默漏账**：不进带价账单，**不生成任何异常记录**，无消息、无标签。见 §11-N4 |
| 应收10 实收10，有价，客户端谎报 isQualityIssue | false | false | **false** | ⚠️ 全额到货被人为剔出账单，无审批闸（见 §11-N5，即 full-scan-02 M1） |
| 手动商品，应收3 实收3 | false（若收齐） | false | false | 预期行为，金额走 `verify_amount` 凭证核销 |
| `priceSnapshot` 恰为 0 但有价（历史价 0 元） | — | true | false | 与"未配价"不可区分，异常描述会误导为"未配置供应商协议价" |

### 2.4 两处与"应收"比较的口径不一致

- **判定少货**用累计（`:326`）：`(historyQtyMap[oi]||0) + item.receivedQty < item.orderQty`
- **描述文本**只写本批（`:479`）：`下单${orderQty}，实收${item.receivedQty}`

分批收货下第 2 批的描述会是"下单10，实收3"，而实际累计已到 8。异常列表读到的文案系统性偏悲观。

---

## 3. 异常类型字典四边对齐

### 3.1 全集对照

`createReceipt` 实际会写出的 `type` 全集（`:471-474`）= `{shortage, quality, wrong_item, missing_price}`，共 4 个。

| 侧 | 位置 | 键数 | 含 `missing_price` | 缺口后果 |
|---|---|---|---|---|
| 生成侧（云端 A） | `createReceipt:52-57` | 4 | ✅ | — |
| 异常列表读取侧（云端 B） | `dataService:683-689` | 4 | ✅（3558678 新加） | — |
| **报表详情读取侧（云端 C）** | `getReportDetail:12-16` | **3** | ❌ | 报表详情反推异常时缺价行显示裸英文 |
| **供应商端本地 map（前端 D）** | `supplier-receipts.js:56` | **3** | ❌ | 供应商看到 `missing_price` 原文（`:56` 的 `\|\| rec.type` 兜底把英文原样拼进文案） |
| 前端公共映射 | `utils/meta.js` 全文 | **0** | ❌ **无此映射** | meta.js 只有 `statusMap`/`supplierConfirmMap`/`reportTypeMap`，**异常类型从未进公共字典** |
| 类型圆点样式 | `abnormal-list.wxss:39-42` | 4 | ❌ 无 `.type-dot-missing_price` | 缺价异常走基色 `.type-dot`（灰），与其他类型视觉无区分 |
| 死样式 | `abnormal-list.wxss:41` | — | — | `.type-dot-delay` 对应 `delay` 类型，**全库无任何写入点** |

### 3.2 `missing_price` 生成侧是否真的会写出？——**会，已闭合**

`:366-368` 设置 `isMissingPrice` → `:65` 纳入 `getItemAbnormalTypes` → `:474` 推入 `abnormalTypes` → `:488-504` 落库。链路完整，且 `:437` 的 `receipt_status='abnormal'`、`:572/:605` 的 `has_abnormal=true`、`:524-528` 的定向店长消息都会随之触发。**最容易"只加字典没接上游"的坑在本仓库不成立。**

### 3.3 真正的漏口在**持久化**与**读取侧**

| # | 缺口 | 位置 | 后果 |
|---|---|---|---|
| a | **`receipt_item` 不落 `is_missing_price` 标志** | `:445-468` 只落 `is_shortage/is_quality_issue/is_wrong_item` | 缺价信息只存在于 `abnormal_record`，明细表查不到 |
| b | `regenerateReceiptReports` 的派生函数只读 3 个持久化标志 | `dataService:1142-1148` | **补生成/补账后的报表 CSV「异常类型」列永久丢失"缺价待补"**；与 `:1167` 从 `receipt_status` 取的 `has_abnormal=true` 自相矛盾（标记有异常但列出无任何异常） |
| c | `getReportDetail` 派生只读 3 个标志且字典无该键 | `getReportDetail:12-24` | 报表详情页缺价行无异常横幅、无异常摘要 |
| d | 报表侧统计**根本不算它** | `generateSummaryReport:193` 只 `if (item.is_manual) return` | 汇总报表完全无异常维度（见 §7） |
| e | `repriceReceipt` 关异常但不校验是否真补上价 | `dataService:1076-1090` | 见 §11-N6，审计痕迹被污染 |

### 3.4 seed-data 与数据契约

`seed-data/abnormal_record.json` 只有 1 条样本，`type: "shortage"`，**无 `missing_price` 样本**、**无数量/金额字段**。`seed-data/receipt_item.json`（2 行样本）**无 `is_manual`、无 `is_shortage`、无 `payable_flag` 的缺省形态**——即 seed 数据与真实写入结构（`:445-468` 共 19 字段）不对齐，任何基于 seed 的口径验证都会漏掉手动行与异常行分支。

---

## 4. 收货状态机

### 4.1 `purchase_order.order_status` 全部写入点（全库穷举）

| 写入点 | 目标值 | 前置约束 |
|---|---|---|
| `createPurchaseOrder:278` | `draft` / `submitted` | 仅 `['draft','submitted']`（`:206`） |
| `dataService:552`（auditOrder） | `approved` / `rejected` | 前置仅 `['submitted','pending_approval']`（`:500`），事务内复查（`:528-534`） |
| `createReceipt:512` | `received` / `receipt_abnormal` / `partial_received` | 前置仅 `['approved','report_generated','partial_received','to_receive']`（`:228` 事务外 + `:392` 事务内） |
| `dataService:1303`（cancelOrder） | `cancelled` | 前置仅 `['submitted','approved','report_generated']`（`:1297`） |

> **修正 full-scan-02 M9**：`approved` 由 `dataService:552` 写入，**不是死状态**。真正的死状态是 `{pending_approval, report_generated, to_receive, completed}` 4 个，M9 的集合本身正确，但"写入点只有 4 处"的归因漏了 `dataService:552`。

### 4.2 状态流转图

```
                        ┌───────────── cancelOrder:1303 ─────────────┐
                        │                                            ▼
  draft ──submit──▶ submitted ──auditOrder──▶ rejected (终态, 复制为新草稿)
     │                 │                        cancelled (终态)
     │                 ▼
     │              approved ──createReceipt──▶ partial_received ─┐
     │                                │            ▲              │
     │                                ▼            │ (每批未收齐)  │
     │                         receipt_abnormal ◀──┘  isFinalBatch │
     │                          ↑           或                     │
     │                          │                                  │
     └─── 死角：无任何写出口 ─────┘          received (终态) ◀────────┘
```

### 4.3 非法跳转与死角

| # | 结论 | 位置 | 严重度 |
|---|---|---|---|
| **D1** | **`receipt_abnormal` 是永久死角**：`createReceipt:228,392` 两个白名单都不含它 → 不能补收；`dataService:1294` 明确拒绝 `receipt_abnormal` 作废 → 不能作废。**全库 4 个 `order_status` 写入点没有任何一个能从它走出去。** 异常记录的处理（`resolveAbnormal`）**只改 `abnormal_record.status`，不回滚 `order_status`**。该单永久卡在"收货异常"，货收不齐、钱算不了、单也作不了废 | P0 |
| D2 | `:386` 注释声称"receipt_abnormal 状态允许继续补收"，与 `:392` 白名单**直接矛盾**，两个 commit 后原样未修 | P0（同 D1） |
| D3 | `receipt.receipt_status` 只有 `:437` 一个写入点（`completed`/`abnormal`），**事后永不变更** → 补结算/补账/补生成都不更新它，`receive-list` 的 `hasAbnormal` 标签会永久显示 | P2 |
| D4 | `receipt_item` 无状态字段，`payable_flag` 只能由 `settleReceipt:913`/`repriceReceipt:1068` 单向翻 true，**无任何入口能翻回 false**（无"撤销补结算"） | P2 |
| D5 | `abnormal_record.status` 是严格线性链 `pending→processing→resolved→closed`（`:745,763,813`），**但 `repriceReceipt:1084` 存在一条旁路**：`pending/processing` 直接跳到 `resolved`，跳过 `processing` 与人工填写的 `resolution` 校验（`resolveAbnormal:754-755` 要求非空处理结果，旁路写的是固定文案） | P2 |
| D6 | 不可达状态：`pending_approval`（`auditOrder:500` 允许但无写入点）、`report_generated`/`to_receive`/`completed`（全无写入点）——保留在 `createReceipt:228,392`、`meta.js:6-12`、`dataService:844,1297` 等 8+ 处白名单中 | P2 |

### 4.4 上游状态源（预期收货从哪来）

- **下单**：`createPurchaseOrder:232` 只校验 `qty>0 && qty<=1000000`，**不校验整数**；`:334` 落 `order_qty`；**无任何价格字段**（价格在收货时现取）。
- **审核改量**：`dataService:521-524` 校验 `qty>0 && qty<=源 order_qty` → **审批量不能超出申请量**（batch2 §9.6 的"无上限"结论已由后端拦住）。改量后 `:552` 写 `order_qty/approved_qty`，并调 `regenerateApprovedOrderReports` 重出报表（`:414-416` 把旧下单报表打 `superseded`）。
- **供应商承诺数**：`confirmSupplierOrder` 只写 `supplier_confirmations[supplierId].status`（`confirmed`/`shipped`），**不写任何数量**——**系统里不存在"供应商承诺数"这个字段**。所谓"预期收货"实际就是 `purchase_order_item.order_qty`。这也意味着**供应商确认数量与门店收货数量之间没有任何对账维度**。

---

## 5. 三个补账 action 深度审查

三者均为 `dataService` 内函数，由 `pages/receive-list` 触发，**全部要求 `GLOBAL_ROLES = ['super_admin','purchaser']`**（`:871,1036,1106`）——**店长完全无权**，与前端 `canSettle/canReprice/canRegenerate`（`receive-list.js:84-87`）一致。

### 5.1 `settleReceipt`（`:870-982`）—— 🔴 本域最危险的入口

| 检查项 | 现状 | 判定 |
|---|---|---|
| 越权 | `:871` GLOBAL_ROLES；`:876-878` 仅按 `receipt_id` 查，**不校验门店归属** | 全局角色本就可跨店，可接受 |
| 前置异常 | `:881-886` 要求无 `pending/processing` 异常 | ✅ |
| 幂等 | `:889-895` 查 `report_file` 是否已有 `_S` 后缀 | ✅ **唯一真正的幂等闸** |
| **是否要求该单真发生过异常** | ❌ **不要求** `abnormalRes.data.length > 0` | ⚠️ 可对正常单调用 |
| **是否去重已出账行** | ❌ `:925` 的 `payableItems` = 全部 `!is_manual && payable_flag!==false && price>0`，**包含原始 ⑥ 账单已含的每一行** | 🔴 **重复出账** |
| 与 `createReceipt` 一致性 | ❌ `:911` 翻 `payable_flag` 时**不校验 `is_manual`**（对照 `:925` 自己排了 `!item.is_manual`） | ⚠️ 手动行可被翻成可付款 |
| 事务性 | ❌ **无 `runTransaction`、无 try/catch**。`:912-914` 先翻 `payable_flag`，`:968-978` 后出账单；上传失败则**标志已翻、账单未出** | 🔴 部分提交 |
| 浮点 | ✅ `:961-962` 逐行 `Math.round(qty*price*100)/100` 再累加 | 一致 |

**复现路径（P0-N2）**：某收货单有 1 条 `quality` 异常 → 管理员在异常列表把它解决并选"维持不付款"（`paymentDecision:'reject'`）→ 回收货记录页点「补结算」（`receive-list.wxml:52`，条件 `hasAbnormal && canSettle`）→ `:898` 的 `payReceivedRecords` 为空（裁决是 reject）→ `:925` 取到全部可付款行 → `:971` 写出 `RPT_SURP_{sid}_{receiptId}_S`。**供应商侧同批货收到两张金额完全相同的带价账单**，且 `:1214-1254` 从不把原账单打 `superseded`，报表历史里两份都是 `status:'generated'`。绕过 UI 直接调云函数则连 `hasAbnormal` 都不需要。

### 5.2 `repriceReceipt`（`:1035-1103`）—— 补价补账

- `:1036` GLOBAL_ROLES；`:1041-1048` 只处理 `!is_manual && supplier_id && price_snapshot<=0` 的行，**天然只碰缺价行，无法改写任何非零历史价** → **不能用来篡改已出账金额**（这一点是安全的，回答了任务的核心担忧）。
- `:1055-1059` 取 `is_current:1` 的**当前价**，`:1068` 覆盖 `price_snapshot` 并置 `payable_flag:true`。**注意：写的是"今天的价"，不是收货日的价**——协议价在期间调过就失真，且无留痕区分原价/补价。
- 🔴 **P1-N6**：`:1076-1090` 关闭异常的范围是**整个收货单的所有 `pending/processing` `missing_price` 异常**，与"实际补上价的行"无关。若 5 行缺价只补上 3 行（`:1066` 进 `stillMissing`），剩余 2 行仍是 0 价、`payable_flag` 仍是 false，但它们的异常已被 `:1084` 标为 `resolved`、`resolution` 写死为"已补配协议价并刷新价格快照，账单按补价重出"——**与事实不符**，且不再有任何待处理入口提醒补价。
- 🔴 **P1-N3**：`:1072-1074` 若全部没补上价则直接返回 -1（此时未关异常，安全）；但**部分成功时继续执行** `:1093` 调 `regenerateReceiptReports`，若重建抛错则 `:1094` 原样返回错误——**价格已改、异常已关、账单未出**。重试时 `:1047` 的 `price_snapshot<=0` 已不成立 → `missingItems.length===0` → 返回"该收货单没有缺价行，无需补账"，**死路**。而唯一备用入口「补生成」（`receive-list.wxml:50`）要求 `item.missingReports` 为 true，而 `repriceReceipt` **从不设置 `missing_reports` 标记** → **UI 上不存在任何恢复路径**。

### 5.3 `regenerateReceiptReports`（`:1105-1272`）—— 报表补生成

- `:1106` GLOBAL_ROLES；`:1111-1113` 按 `receipt_id` 查；`:1120` 无明细则拒绝。
- **无幂等去重**：`:1162/1189/1222/1249` 的 `report_id` 都带 `_RG` 后缀，看似唯一，但 `:1152` 的 `getNextVersion` 每次递增 → **每次调用都追加一份新报表，原报表不打 `superseded`**。对照下单侧 `regenerateApprovedOrderReports:414-416` 是显式打 `superseded` 的——**同一仓库两套补生成语义相反**。
- `:1173`、`:1233` 的 `payableItems`/`supPayable` **缺 `!item.is_manual`**（对照 `:925` 有）。当前因手动行 `payable_flag` 恒 false 而"恰好安全"，但一旦 §5.1 的 `:911` 把手动行翻成 true，手动行就会带价进账单——**两处防御不对称，形成潜在双重故障**。
- `:1142-1148` 派生异常类型只有 3 个标志 → **丢 `missing_price`**（见 §3.3-b）。
- `:1127` `isFinal = receipt.is_final !== false` → 旧数据缺字段时按终批处理，会误打"（收齐）"标签。
- ✅ `:1260-1263` 有 try/catch，失败返回已生成部分清单；`:1265-1270` 补成功后清 `missing_reports`。

### 5.4 三个 action 横向对比

| | settleReceipt | repriceReceipt | regenerateReceiptReports |
|---|---|---|---|
| 幂等闸 | ✅ `_S` 后缀查重 | ❌ 依赖 `price<=0` 隐式条件（部分成功后失效） | ❌ 无 |
| 事务 | ❌ | ❌ | ❌ |
| try/catch | ❌ | ❌ | ✅ |
| 与 createReceipt 口径一致 | ❌（少 `is_manual` 校验 + 不去重已出账行） | ⚠️（用当前价而非收货日价） | ❌（少 `is_manual` + 丢 `missing_price`） |
| 可否篡改历史金额 | 间接（配合 `:911`） | **不可**（只碰 0 价行） | 否 |

---

## 6. 幂等与重复收货

### 6.1 结论：**可以重复收货，且会重复计费**

`createReceipt` **全程无 `request_id` 幂等键**，`receipt` 表也无幂等字段；`receipt_id = 'RCP' + Date.now() + 6 位随机 hex`（`:320`）。唯一的数量防护是**上限校验**，不是幂等校验：

- 事务外预检 `:277-279`：`historyQty + receivedQty > orderQty` 才拒绝
- 事务内复查 `:410-418`：同规则，防并发超收 ✅

**上限校验拦不住重放**：应收 10，第 1 批实收 3（`partial_received`）→ 客户端超时重试同批 3 件 → 累计 6 ≤ 10 → **合法通过，多收 3 件、多计 3 件的钱**。这不是"应收被重复扣减"（应收不会被扣减，它只是上限），而是**实收被重复累加**。

`getReceipts`/`getPurchaseOrderDetail` 侧没有任何按 `(purchase_order_id, request_id)` 的查重。

### 6.2 客户端补偿是唯一的防重放手段，且语义有漏洞

`receive-verify.js:6-37` 的 `recoverCommittedReceipt`：仅在 `errorType==='CLOUD_UNAVAILABLE'` **或** `/已完成收货|不可收货|连接失败|Not connected/i.test(msg)` 时触发（`:8-11`）。

- ⚠️ 正则把**业务拒绝**（`:306` 的"该订单已全部收货完成，请勿重复提交"、`:229` 的"订单尚未审批通过，不可收货"）也纳入补偿触发。若服务端因状态非法拒绝、而该单恰好已是 `received`，`:21` 判定 `detail.orderStatus==='received'` → `:26-36` **向用户合成一个 `code:0` 的成功弹窗**，文案却是"连接中断导致报表状态未返回"。用户被误导为提交成功，实际是重复提交被拒。
- ⚠️ `:23` 取 `receipts[0]` 当本次单，而 `getPurchaseOrderDetail` 的 receipts **无 `orderBy`** → 分批场景可能取到旧批次。
- ✅ `receive-verify.js:181` 把 `setData({isSubmitting:true})` 放在 `showConfirm` **之前**——这是全仓正确的写法（对比 batch2 §8.5 指出 `purchase-create` 的同类缺陷）。

### 6.3 `batch_no` 重号（事务内读不隔离）

`:421-427` 注释称"批次号在事务内按已提交收货单数生成，避免并发重号"。**不成立**：`txHistoryReceiptRes` 读的是事务快照，两笔并发事务各读到同一 count → **同 `batch_no`**。`receipt_id` 因带随机字节仍唯一，但 `:543` 的 CSV「批次」列与 `getReceipts:66` 的 `orderBy('created_at','desc')` 都会让批次语义在并发下不可信。（注：`createPurchaseOrder` 的 `request_id` 幂等查重 `:141-150` 同样在事务外，可对照。）

### 6.4 请求重放会产生重复异常吗？——会

同一订单同一行的 `quality`/`wrong_item` 异常无去重：`abnormal_id` 含 `receiptId`（每次新生成），因此重放或第 2 批重复勾选会**再写一条同商品同类型的 `abnormal_record`**。`settleReceipt` 按 receipt 聚合所以不受影响，但异常列表条数与"异常发生次数"永远对不上账。

---

## 7. 金额、数量与精度

### 7.1 金额计算口径分叉（5 处实现，3 套规则）

| 位置 | 公式 | 舍入时机 |
|---|---|---|
| `createReceipt:592`（门店带价） | `Math.round(receivedQty*price*100)/100` | 逐行先舍入再累加，累加也再舍入 |
| `createReceipt:675`（供应商带价） | 同上 | 同上 |
| `getSupplierReceipts:109`（供应商端展示） | 同上 | 单次，不累加 |
| `dataService:961` / `:1180` / `:1240`（三个补账） | 同上 | 同上 |
| **`generateSummaryReport:212`** | `Math.round(qty*price*100)/100` | 同上，但 `orderQty` 额外 `Math.round(x*1000)/1000`（3 位小数） |
| **`getReportDetail`**（页面展示） | `(qty*price).toFixed(2)*1` | 不逐行舍入，只在渲染时 `toFixed(2)` |

`Math.round` 与 `toFixed(2)` 在半分位不一致（如 `1.005`：前者 1.01，后者 "1.00"）→ **同一行在 CSV 账单里是 1.01，在报表详情页显示 1.00**。这是 full-scan-06 H3 的根因，本轮确认**未修**。

### 7.2 异常单的金额归属

- **少货**：按实收计价（`:354-355` 注释 + `:363` 不排除 shortage）→ 未到部分自然不出账单。**口径正确**，但描述文本用本批数量（§2.4）。
- **质量/错货/缺价**：整行剔出带价报表（`:583,664`），**金额归零**——不是"按实收打折"，是**完全不付**。异常单本身不带金额字段（§2.2），因此**系统内不存在"异常差额"这个数**，无法算出"该扣供应商多少钱"。
- `report_file.excluded_rows`（`:606,689`）只记**行数**，不记**金额**。

### 7.3 汇总报表口径漂移（P1-N5）

`generateSummaryReport:193` 聚合时**只** `if (item.is_manual) return`，**不查 `payable_flag`**。于是：

- `quality`/`wrong_item` 行（`payable_flag=false`、`price_snapshot>0`、`received_qty>0`）**被算进日/月汇总的应付金额**；
- 而这些行在供应商带价账单里被完全剔除。

→ **门店日汇总的"金额"恒 ≥ 供应商带价账单合计**，且差值随异常增多而扩大。这是收货域与报表域之间最实质的对账缺口。（另：`:179` 查门店不带 `status:1`，停用门店仍可出汇总，与 `createReceipt:188` 的拦截口径不一致。）

### 7.4 浮点与小数

- 数量允许小数（`createPurchaseOrder:232` 不校验整数），`:326` 的累计比较与 `:378` 的 `>= orderQty` 均为裸浮点比较，无 `Math.round` 保护。分批累加 0.1+0.2 类场景可能判定不出"收齐"→ 订单停在 `partial_received`。
- `:346` 取价 `Number(p.price) || 0`：`supplier_product_price` 若存在多条 `is_current:1`，后写覆盖前写**无告警**（full-scan-02 §11.3 的待核实项，本轮**无法确认**——需查 `updateProductPrice` 的唯一性约束，不在本域）。
- `:340-347` 每 20 个 product_id 一批查价但 `.limit(100)`：若单批内 (供应商,商品) 组合数 >100，**尾部静默截断 → 价格取成 0 → 误报 missing_price**。当前商品库规模下不可达，但结构上是隐患。

---

## 8. 权限与门店停用隔离

### 8.1 两个收货列表接口的可见范围

| | `getReceipts` | `getSupplierReceipts` |
|---|---|---|
| 角色 | `chef`→空数组（`:50-52`）；`store_manager`→强制本店（`:53-55`）；`super_admin`/`purchaser`→不限（`:56-59`）；其余 -403 | 仅 `supplier`（`:45`），必须有 `default_supplier_id`（`:46-47`） |
| 供应商越权 | — | `:54` 按会话 `supplier_id` 过滤，**无跨供应商泄漏** ✅；异常 join 也带 `supplier_id`（`:84`）✅ |
| 手动行 | 全量返回 | `is_manual: _.neq(true)` 显式排除（`:54`）✅ |
| 门店停用过滤 | ❌ **不查门店状态**（`:63-69`）→ 停用门店的历史收货仍可见（**这是对的**） | ❌ 同（`:56-62`），历史可见是预期 |
| 分页 | ✅ `count`+`skip/limit`，`pageSize≤100` | ✅ 同 |
| 返回粒度 | 收货单 + 全部明细（含 `price_snapshot`） | 平铺明细，**后端算金额**（`:109`，前端无法伪造）✅ |

### 8.2 供应商能看到收货差异明细吗？——**能看到，且比账单口径宽**

`:104` 的 `...item` 全量展开，供应商端实际拿到：`price_snapshot`、`payable_flag`、`is_shortage`、`is_quality_issue`、`is_wrong_item`、`order_qty_snapshot`、`remark`、`created_at`，外加 `:110` 的 `abnormals`（含 `type`/`status`/`resolution`/`payment_decision`）。

三处值得注意：

1. ⚠️ **`amount` 对所有行都算**（`:109`），包括 `payable_flag===false` 的行。`supplier-receipts.wxml:16-17` 无条件渲染单价与金额 → **供应商按自己的列表对账时，会把注定不付的钱算进应收**，而实际带价账单里没有这行。
2. ⚠️ **内部处理意见外泄**：`resolution` 是店长在 `abnormal-list.js:60-69` 用**自由文本输入框**写的（无模板、无脱敏），`payment_decision` 是内部付款裁决。S7 拍板说是"供对账"，但自由文本可写入任意内部信息（如"这批不要付，走线下谈"）。
3. 🔴 **`supplier-receipts.js:53` 的异常判定在分批收货下系统性误报**：
   ```js
   const abnormal = !item.is_manual && (receivedQty !== orderQty || item.payable_flag === false)
   ```
   `receivedQty !== orderQty` 对**每一批未收齐的分批收货都成立**（第 1 批收 3/10 不是短收）。B3 分批收货上线后，供应商端列表会出现大量"异常"红标，而实际上只是分批在途。**无历史累计维度可判**——`receipt_item` 不落累计量。
4. ⚠️ `supplier-receipts.js:56` 的 type map 缺 `missing_price` → 供应商看到裸英文（见 §3.1）。

### 8.3 门店停用（inactive store）闭环判定

**3558678 对收货侧 0 改动**（`git show 3558678 -- cloudfunctions/createReceipt/index.js` 为空）。收货侧的 `status:1` 过滤原样保留在：

- `createReceipt:178`（非全局角色自店校验）、`:188`（订单门店校验）
- `createPurchaseOrder:164`、`:198`（下单侧）

**收货侧本身是正确的**：停用门店不应再收货。真正的缺口在停用入口：

```js
// authService:632
const ACTIVE_ORDER_STATUS = ['draft','submitted','pending_approval','approved',
                             'report_generated','partial_received','to_receive']
```

**漏了 `receipt_abnormal`**。于是：

1. 门店有 1 张 `receipt_abnormal` 的采购单（D1 死角状态）；
2. 超管在门店管理页停用该店 → `authService:633-635` 计数为 0（该状态不在白名单）→ **停用成功**；
3. 该店所有 chef/store_manager 因 `login` 找不到 `status:1` 的门店而**登录失败**（R8 已记录）；
4. 那张 `receipt_abnormal` 单**既不能收货（店已停用 + D1）也不能作废（`dataService:1294`）**，永久滞留。

而 `partial_received` 在白名单里 → 有普通在途单的店**能被拦住**。也就是说：**只有 `receipt_abnormal` 这一个收货侧状态漏了停用闸**，而这恰好是 D1 的死角状态，两个缺陷叠加成一个不可恢复的死锁。

### 8.4 权限矩阵一致性

| 角色 | 提交收货 | 看待收货 | 看异常 | 处理异常 | 补结算/补价/补生成 |
|---|---|---|---|---|---|
| chef | ❌ `:164` | ❌ `getReceipts:50` | ❌ 空数组 `dataService:700` | ❌ | ❌ |
| store_manager | ✅ `:164`（仅本店 `:176,233`） | ✅ 本店 `:55` | ✅ 本店 `:703` | ✅ `:735,751,803` | ❌ |
| purchaser/super_admin | ✅ 全店 | ✅ 全店 | ✅ 全店 | ✅ | ✅ |
| supplier | ❌ | ❌ `:56` | ❌ | ❌ | ❌ |

**越权面收敛良好**：`createReceipt:176-177` 与 `:233` 双重校验门店归属；`receivedBy` 被服务端覆盖（`:232`），客户端无法伪造收货人；`storeId/storeName` 非全局角色被强制覆盖（`:178-180`）。

⚠️ **一处职责不分**：`resolveAbnormal:751` 允许 `store_manager` 做**付款裁决**（`paymentDecision`，`:766`），而付款裁决直接决定供应商能否拿到钱（§5.1 `:898-917`）。门店店长既是验收人又是付款放行决策人，**无第二方审批**。

⚠️ **`getReceipts` 的 `storeId` 仍是死参数**（`:44` 解构、`:61` 只用 `receiptDate`）——full-scan-02 M7 **原样未修**。purchaser 在 `receive-list.js:28` 传了 `storeId`，服务端忽略，管理员侧无门店过滤能力。

⚠️ **`getReceipts` 无 `receipt_status`/`purchase_order_id` 筛选**，`receive-list.js:30` 只取 5 条最近记录，无分页。

---

## 9. 照片校验

**现状未变**（`createReceipt:212-215`）：

```js
const photoPrefix = `receipts/${purchaseOrderId}/`
if (photoFileIds.some(id => typeof id !== 'string' || !id.includes(photoPrefix))) {
  return { code: -1, msg: '验收照片信息无效，请重新上传' }
}
```

对照上传侧 `utils/cloud.js:231-239`：`cloudPath = receipts/${safeOrderId}/${ts}-${index}.${ext}`，`safeOrderId` 只保留 `[a-zA-Z0-9_-]`，返回的 `fileID` 形如 `cloud://env.xxx/path/to/receipts/POxxx/123-0.jpg`。

| 校验点 | 现状 | 判定 |
|---|---|---|
| 数组类型 | ✅ `:205-207` | 通过 |
| 数量上限 | ✅ `:208-210`（≤9），与 `chooseMedia count` 一致 | 通过 |
| 非空过滤 | ⚠️ `:438` 落库前 `photoFileIds.filter(Boolean)`，但**校验阶段不排除空串**——空串会被 `:213` 的 `typeof id !== 'string'` 之外的分支放过吗？空串是 string 且不含前缀 → **会被拒**。行为正确但报错文案是"格式无效"而非"含空项" | 可用 |
| `cloud://` 形态 | ❌ **不校验**，只查子串包含 | 见下 |
| 前缀防串单 | ✅ 前缀带尾随 `/`，`receipts/PO123/` 不匹配 `receipts/PO1234/` | 通过 |
| 后缀/路径穿越 | ⚠️ 不限制后缀，`receipts/PO123/../../other` 类构造可通过子串校验 | 低危 |

**结论**：full-scan-02 L3 **原样成立**。风险实质有限——因为 `fileID` 由 `cloud.uploadFile` 生成，客户端要构造出含 `receipts/<订单号>/` 子串的合法 `cloud://` ID 需要知道目标存储桶路径且该文件真实存在；但**服务端无法验证该文件确实由本客户端上传、也无法验证它属于本订单的本次上传**（同一订单的历史照片可被重复提交，因为前缀是订单级而非批次级）。建议至少补一条 `startsWith('cloud://')` 与"必须以 `receipts/<订单号>/` 开头"（改用 `indexOf(photoPrefix) === 8` 之类的位置校验）。

---

## 10. 旧结论复核表 + 旧【待核实】回收表

### 10.1 full-scan-02 的 H1/H2/H3/H4 复核

| 旧编号 | 旧结论 | 本轮判定 | 证据 |
|---|---|---|---|
| **H1** | `receipt_abnormal` 终态死锁，注释与实现矛盾 | 🔴 **仍成立，且比原判更严重** | `createReceipt:228,392` 白名单仍不含它；`:386` 注释原样；**新增**：`dataService:1294` 也拒绝它作废 → 全库无写出口（D1）。3558678 声称"align status filters"但 `createReceipt` **0 行改动** |
| **H2** | 报表失败通知 `ReferenceError: orderData is not defined` | 🔴 **仍成立** | `createPurchaseOrder:454` 在 `catch` 中仍引用 `try` 块内的 `const orderData`（`:273` 声明）→ `message` 永不写入，被 `:460` 静默吞掉。（属下单域，非本批主范围，但同属"异常补偿链路"，一并记录） |
| **H3** | 供应商订单列表 1000 行截断 + 排序键失效 | 🟡 **行号漂移，结论需实测** | `getSupplierOrders` 不在本批 3 文件内，未复核实现；`created_at` 回读形态仍是【待核实】（见 10.3-6） |
| **H4** | 收货无幂等键，并发双击重复收货、批次号重号 | 🔴 **仍成立** | §6.1 上限校验不防重放；`:421-427` 注释声称防重号但事务快照不隔离（§6.3）。`receipt` 表仍无 `request_id` |

### 10.2 旧 M 级条目抽验（与收货/异常直接相关的）

| 旧编号 | 判定 | 证据 |
|---|---|---|
| M1（`payableFlag` 客户端可单方压低 + 异常标记可绕过付款） | 🔴 **仍成立** | `:363` 的 `item.payableFlag !== false` 原样；`isQualityIssue/isWrongItem` 仍纯客户端可控（§2.1） |
| M2（严格判型 + 要求上送随后被覆盖的字段） | 🟡 **仍成立** | `:197-201` 仍 `typeof item.receivedQty !== 'number'`；`orderQty/productName/unit` 仍在 `:283-289` 被 DB 值覆盖 |
| M5（`isFinalBatch` 在事务外算） | 🔴 **仍成立且升级为 P1** | `:373-379` 仍用事务外的 `historyQtyMap`；并发下可能"已收齐却停在 `partial_received`"，而 `partial_received` 是唯一能继续收货的中间态 → 见 §11-N7 |
| M6（receipts/items 无 orderBy） | 🟡 **仍成立** | `getReceipts:66` 仍 `orderBy('created_at','desc')` 而非 `batch_no` |
| M7（`getReceipts.storeId` 死参数） | 🔴 **仍成立** | `:44` 解构、`:61` 只用 `receiptDate` |
| M9（4 个死状态散落 8+ 处） | 🟡 **部分修正** | 死状态集合 `{pending_approval, report_generated, to_receive, completed}` 正确；但旧文档把 `approved` 也算作"写入点存疑"——实际 `dataService:552` 写入 `approved`，**它不是死状态** |
| M10（客户端可把全额行标 isShortage） | 🔴 **仍成立** | `:325-328` 仍只单向强制 true，从不强制 false |
| M11（`report_id` 无去重） | 🔴 **仍成立且恶化** | `regenerateReceiptReports` 追加不删旧、不打 `superseded`（§5.3），与下单侧 `:414-416` 语义相反 |
| L3（照片只校验子串） | 🔴 **仍成立** | §9 |
| L8（`store` 集合被查 3 次） | 🟡 **仍成立** | `:178`、`:188`、`:231`（第三次 `storeName = order.store_name \|\| storeName`，实为读 order，可忽略）→ 实为 2 次冗余 |
| L9（`receipt` 主表不落金额） | 🔴 **仍成立** | 金额只能在 `getSupplierReceipts:109` 现算，无持久化权威副本 |

### 10.3 跨批次【待核实】回收（full-scan-02 §11，8 项）

| # | 待核实内容 | 回收结论 | 需要什么才能确认 |
|---|---|---|---|
| 1 | `dataService:552` `event.status` 无枚举校验 → 可构造 `status:'received'` 跳过收货 | ✅ **已修复** | `dataService:486` 新增 `!['approved','rejected'].includes(event.status)` → -1。白名单闭合 |
| 2 | `requestCancel` 允许 `partial_received` 但 `cancelOrder` 拒绝 → 无效操作路径 | 🔴 **仍成立** | `:1348` 含 `partial_received`/`to_receive`，`:1294` 两者都拒 → 采购员可提交必然被拒的申请。无需实测，代码即结论 |
| 3 | `supplier_product_price (supplier_id,product_id,is_current)` 唯一性 | ⚪ **无法确认**（本域外） | 需读 `updateProductPrice` 的写入与索引约束；影响 `createReceipt:346` 后者覆盖前者且无告警。**本轮未读该函数** |
| 4 | `missing_reports` / `photo_file_ids` 只读 snake → 可能静默不显示 | 🟡 **降级：可用但脆弱** | `getReceipts:85` 用 `...receipt` 原样返回 snake_case → `receive-list.js:74,79` 读取**实际有值**，不会静默消失。风险仅在将来改 camelCase 时。旧结论"静默不显示"在当前代码下**不成立** |
| 5 | `product.category_name` vs `category_level_1` | 🟡 **仍成立（防御式双读）** | `createPurchaseOrder:248` 仍 `product.category_name \|\| product.category_level_1 \|\| item.category`。`seed-data/product.json` 确认 `category_name` 存在（如 `"蔬菜"`），**主路径可用** |
| 6 | `created_at` 回读形态（决定 H3 排序是否成立） | ⚪ **无法确认** | 需真机/云函数实测一次返回值是 `Date` 实例还是 ISO 字符串。本轮只读代码，无法判定 |
| 7 | `receipt_item`/`purchase_order_item` 的 `limit(1000)` 假设 | ✅ **已闭合** | `createPurchaseOrder:210` 硬上限 100 行；`createReceipt:239/255/402/423`、`getReceipts:78` 的 `limit(1000)` 均安全 |
| 8 | `report_file` 补生成唯一性：删后建还是追加 | 🔴 **仍成立，且比原判更严重** | `regenerateReceiptReports:1162/1189/1222/1249` **纯追加**，`_RG` 后缀每次递增版本；**不像** `regenerateApprovedOrderReports:414-416` 打 `superseded` → 收货类补生成无作废标记，报表历史永久重复 |

### 10.4 batch2 末尾【待核实】回收（9 处）

| 位置 | 内容 | 回收结论 |
|---|---|---|
| `batch2:53` | 前端 `canReceive` 与后端状态校验是否一致 | ✅ 已闭合（full-scan-02 §10-1）：前端 3 处硬编码集与 `createReceipt:228,392` 逐字相同 |
| `batch2:99` | `getPurchaseOrders.items` 返回形状 | ✅ 已闭合（前端已调 `normalizePurchaseOrder`） |
| `batch2:105,199` | `auditOrder` 对空 `items` 的处理 | ✅ 已闭合：空 items = 按申请量全批，且有上限 `:521-524` |
| `batch2:204` | 已批/驳回单是否二次校验 | ✅ 已闭合：`:500` 前置 + `:528-534` 事务内复查 |
| `batch2:335` | `priceSnapshot`/`payableFlag` 是否被服务端覆盖 | ✅ 已闭合（结论见 §2.1：`priceSnapshot` 恒覆盖；`payableFlag` 只可压低不可抬高） |
| `batch2:463` | 服务端是否为空 `createdBy` 兜底 | ✅ 已闭合：`createPurchaseOrder:291-296` 一律取会话值 |
| `batch2:579` | 服务端是否校验 `orderStatus` | ✅ 已闭合：`createPurchaseOrder:206` 白名单 |
| `batch2:344` | `openDocument` 对 `.csv` 的实际返回 | ⚪ **无法确认**，需真机测 |
| `batch2:506` | `getCategories` 返回的 id 类型（决定 `activeCategoryId:1` 是否死值） | ✅ **已闭合，且旧结论错误**：`seed-data/category.json` 的 `category_id` 是**数字**（1,2,3…），`dataService:85` 用 `Number(categoryId)` 查 → 初始值 `1` 类型匹配、不是死值（除非分类 1 被停用/删除） |

### 10.5 full-scan-06 异常口径相关回收

| 旧结论 | 判定 |
|---|---|
| 「报表里的收货异常」与「abnormal_record」是并列两套数据、无关联键（§5.2） | 🔴 **仍成立**：`dataService:718-730` 返回体仍丢弃 `receipt_id/purchase_order_id/product_id`；`abnormal_record` 仍无数量/金额字段（§2.2） |
| `getReportDetail:18-24` 从持久化标志反推异常，覆盖收货类报表 ✅ | 🟡 **仍成立但不完整**：本轮发现它**同时漏了 `missing_price`**（字典与派生函数都只有 3 键） |
| `supplier_receipt_price_report` 只写 `excluded_rows` 无 `has_abnormal` → 报表中心无异常标签（M8） | 🔴 **仍成立**：`createReceipt:684-689` 仍无 `has_abnormal`（对照 `:572`、`:654` 都有） |
| 汇总报表行不含 `abnormal` 字段 → 永远无异常横幅 | 🔴 **仍成立**，且 `generateSummaryReport:193` 连 `payable_flag` 都不查（§7.3） |
| 三层舍入口径不一致（H3） | 🔴 **仍成立**（§7.1） |

### 10.6 汇总

| 类别 | 数 |
|---|---|
| 复核条目总数 | **38**（H 级 4 + M/L 级 13 + 跨批次待核实 8 + batch2 待核实 9 + full-scan-06 异常口径 4） |
| 🔴 仍成立 | **20** |
| ✅ 已修复 / 已闭合 | **10** |
| 🟡 部分修正 / 降级 / 行号漂移 | **5** |
| ⚪ 无法确认（需真机或本域外代码） | **3** |

---

## 11. 新问题清单（P0/P1/P2）

### P0

**N1｜`receipt_abnormal` 是永久死角，且与门店停用闸叠加成不可恢复死锁**
- 位置：`createReceipt/index.js:228`、`:392`；`dataService/index.js:1294`；`authService/index.js:632`
- 复现：某批收货带 `quality`/`wrong_item`/`missing_price` 异常且本批已收齐 → `:509` 置 `order_status='receipt_abnormal'` → 再点「去收货」被 `:229` 拒（"订单尚未审批通过，不可收货"，文案与事实不符）→ 点「作废」被 `dataService:1294` 拒（"已有收货记录，不能作废"）→ **该单永久滞留**，货收不齐、账单算不完、单作不了废。叠加：`authService:632` 的在途单白名单不含 `receipt_abnormal` → 该门店可被停用 → 门店全员登录失败（R8 已记）。
- 影响：终态不可恢复；B3 分批收货能力在异常后彻底失效；`receive-list.js:46` 的「待收货」过滤也看不见它（`partial_received` 之外的中间态全丢）。
- 建议：① 把 `receipt_abnormal` 加入 `:228`/`:392` 白名单（允许补收），并把 `:386` 注释与实现对齐；② 在异常全部 `resolved/closed` 后提供状态回退（回 `partial_received` 或 `received`）；③ `authService:632` 的白名单补 `receipt_abnormal`；④ 把 `:229` 的错误文案按状态区分。

**N2｜`settleReceipt` 无条件重复出账——供应商同批货收到两张同额带价账单**
- 位置：`dataService/index.js:898-926`（不过滤已出账行）、`:951-978`（写 `_S` 账单）、`:1162/1189/1222/1249`（补生成从不打 `superseded`）
- 复现：收货单有 1 条 `quality` 异常 → 异常列表解决它并选「维持不付款」（`paymentDecision:'reject'`）→ `receive-list` 点「补结算」（`wxml:52`，条件 `hasAbnormal && canSettle`）→ `:898` 的 `payReceivedRecords` 为空 → `:925` 取全部可付款行 → `:971` 写出 `RPT_SURP_{sid}_{receiptId}_S`，金额与 `createReceipt:664-690` 的原账单完全相同。**绕过 UI 直接调云函数则连 `hasAbnormal` 都不需要**（`:885` 只要求"无未处理异常"，不要求"曾有过异常"）。
- 影响：重复应付、对账不平；两份账单 `status` 都是 `generated`，报表历史无法区分哪份有效。
- 建议：① 补结算只出**新转为可付款的行**（`payment_decision==='pay_received'` 的那几行），而非全量可付款行；② 或至少在 `_S` 账单里显式标 `settle_for_receipt` + 把原账单打 `superseded`（现只有 `:976` 的 `settle_for_receipt`，无作废标记）；③ 增加"该单必须至少有一条 `pay_received` 裁决"的前置条件。

### P1

**N3｜`repriceReceipt` 部分成功后进入无恢复入口的死路**
- 位置：`dataService/index.js:1047-1048`（`price_snapshot<=0` 过滤）、`:1072-1094`（部分成功仍继续）、`receive-list.wxml:50`（补生成按钮需 `missingReports`）
- 复现：一张单有 5 行缺价，只补上 3 行 → `:1093` 调 `regenerateReceiptReports` 若上传失败 → `:1094` 返回 -1。**此时价格已改（`:1068`）、异常已关（`:1084`）、账单未出**。重试「补价补账」→ `:1047` 的 `<=0` 不再命中 → 返回"该收货单没有缺价行，无需补账"。备用入口「补生成」要求 `item.missingReports===true`，而 `repriceReceipt` **从不设置该标记** → UI 上无路径可走。
- 建议：`repriceReceipt` 失败时打 `missing_reports:true`（与 `createReceipt:701-707` 同口径）；或把「补生成」按钮条件放宽为"有缺价行 或 有 missing_reports"。

**N4｜无供应商的档案商品静默漏账——`missing_price` 的覆盖缺口**
- 位置：`createReceipt/index.js:350`（`supplierId` 空则价 0）、`:366`（`missing_price` 要求 `item.supplierId` 非空）
- 复现：商品建档时不填默认供应商（`createPurchaseOrder` 允许，`saveProduct:97-98` 的 `defaultSupplierId` 可选）→ 下单 → 收货 → `:350` 价格取 0 → `:363` `payableFlag=false` → `:366` 因 `supplierId` 为空**不设** `isMissingPrice` → **不进带价账单，不生成异常记录，不发消息，前端无标签**。
- 影响：这正是 #11 拍板要消灭的"静默漏账"，但**只在"有供应商但没配价"这一半场景闭合了**；"没供应商"这一半完全静默。
- 建议：`:366` 去掉 `item.supplierId` 条件（或改为"档案商品且 `priceSnapshot<=0` 且 `receivedQty>0`"），并新增一个更贴切的类型如 `no_supplier`，或复用 `missing_price` 但改描述文案区分两种成因。

**N5｜门店日/月汇总把不可付款行算进应付金额**
- 位置：`generateSummaryReport/index.js:193`（只 `if (item.is_manual) return`，不查 `payable_flag`）
- 复现：任意含 `quality`/`wrong_item` 异常的收货 → 该行走带价账单时被剔除（`createReceipt:664`），但在日汇总里 `:212` 仍按 `received_qty × price_snapshot` 计入金额 → **日汇总金额 > 供应商带价账单合计**，差值随异常增多而扩大。
- 影响：门店侧"应付总额"与供应商侧"账单合计"系统性对不上，是收货域与报表域之间最实质的对账缺口。
- 建议：`:193` 增加 `item.payable_flag === false → skip`（或单独出一列"已剔除金额"），与 `createReceipt:664`、`dataService:925,1233` 口径对齐。

**N6｜`repriceReceipt` 关闭异常的范围与实际补价范围不符，审计痕迹失真**
- 位置：`dataService/index.js:1076-1090`
- 复现：见 N3。5 行缺价只补上 3 行时，`:1078` 的查询取到**全部** 5 条 `missing_price` 异常，`:1082-1088` 逐条标 `resolved`、`resolution` 写死"已补配协议价并刷新价格快照，账单按补价重出"——对那 2 行仍为 0 价的记录，这句话是假的。
- 影响：① 那 2 行永久留在 `payable_flag:false`、`price_snapshot:0`，且**不再有任何待处理异常提醒补价**（`:1078` 下次查询会因 `status` 已 `resolved` 而漏掉）→ 与 N4 同型的静默漏账，但由补账流程自己制造；② 审计日志记录的是未发生的事实。
- 建议：按 `product_id` 把"已补价"与"未补价"的异常分开处理——只关已补价的；未补价的保持 `pending` 并把 `resolution` 追加为"仍未配价，待补"。

**N7｜并发分批收货可能让已收齐的订单永久停在 `partial_received`**
- 位置：`createReceipt/index.js:373-379`（`isFinalBatch` 用事务外的 `historyQtyMap`）、`:509`（据它写终态）
- 复现：应收 10。两笔并发：T1 收 3、T2 收 7。T2 在 `:253-262` 读历史时 T1 尚未提交 → T2 算出 `historyQty=0`，`0+7 < 10` → `isFinalBatch=false` 且 `:327` 误置 `isShortage=true`。T2 通过 `:414` 的事务内校验（`3+7=10 ≤ 10`）后提交 → 订单被写成 `partial_received` + 一条**虚假短收异常**。**此后无法再收**（任何补收都会超 `:277` 上限被拒）→ 订单永久停在 `partial_received`，但货其实已收齐。
- 影响：订单状态与实际库存不符；产生一条不可能对应的短收异常；`settleReceipt` 也不会被触发（无 `pay_received` 裁决路径）。
- 建议：把 `isFinalBatch` 与 `isShortage` 的计算移入事务、基于 `:404-409` 的 `txHistoryQty` 重算。

**N8｜供应商端把分批在途行系统性标成"异常"**
- 位置：`pages/supplier-receipts/supplier-receipts.js:53`
- 复现：任何分批收货的第 1 批（实收 3 / 订 10）→ `receivedQty !== orderQty` 成立 → 该行标红"异常"。B3 分批收货上线后供应商列表会被大量假异常淹没。
- 影响：供应商端"异常"标签失去信号价值；与内部 `abnormal_record`（按累计判定，`:326`）口径不一致，对账时双方数字对不上。
- 建议：后端在 `getSupplierReceipts` 里下发累计量（或按 `purchase_order_id` 聚合后再比较），前端只与累计量比较。

### P2

| # | 问题 | 位置 |
|---|---|---|
| N9 | 供应商端 type map 缺 `missing_price`，显示裸英文 | `supplier-receipts.js:56` |
| N10 | `getReportDetail` 异常字典与派生函数都只有 3 键，报表详情侧丢 `missing_price` | `getReportDetail/index.js:12-24` |
| N11 | 异常描述用本批数量而非累计，分批场景文案系统性偏悲观 | `createReceipt/index.js:479` |
| N12 | `abnormal_record` 不落数量/金额/单价/`receipt_item_id` → 无法独立对账差额 | `createReceipt/index.js:488-503` |
| N13 | `ensureReceiptMessage`（34 行）定义后**从未被调用**，纯死代码 | `createReceipt/index.js:125-158` |
| N14 | 实收为 0 的短收行 `payableFlag=true`，以 0.00 计入带价账单 | `createReceipt/index.js:363,583` |
| N15 | `settleReceipt:911` 翻 `payable_flag` 时不校验 `is_manual`，与 `:925` 自身口径不一致，形成潜在双重故障 | `dataService/index.js:911` |
| N16 | `regenerateReceiptReports:1173,1233` 缺 `!item.is_manual`（与 `:925` 不对称） | `dataService/index.js:1173,1233` |
| N17 | `repriceReceipt` 写入的是"当前协议价"而非"收货日价格"，期间调价即失真，无留痕 | `dataService/index.js:1055-1068` |
| N18 | `repriceReceipt`/`settleReceipt` 无 try/catch 且无事务，先翻标志后出账单 → 部分提交 | `dataService/index.js:912-914,1067-1069` |
| N19 | `batch_no` 并发重号，注释声称防重号但事务快照不隔离 | `createReceipt/index.js:421-427` |
| N20 | `requestCancel:1348` 允许 `partial_received`/`to_receive`，`cancelOrder:1294` 两者都拒 → 必然被拒的申请 | `dataService/index.js:1294,1348` |
| N21 | `resolveAbnormal` 允许店长做付款裁决，验收人与付款放行人为同一角色，无二方审批 | `dataService/index.js:751,766` |
| N22 | `resolveAbnormal` 对 `missing_price` 也弹付款裁决，但 `settleReceipt:911` 因 `price_snapshot>0` 条件恒不生效 → 用户以为裁决有效 | `abnormal-list.js:78` + `dataService/index.js:911` |
| N23 | `getReceipts` 返回体 `chef` 分支缺 `page/pageSize`，契约不一致 | `getReceipts/index.js:52` |
| N24 | `supplier-receipts` 对 `payable_flag===false` 的行仍展示单价与金额 → 供应商按列表对账会高估应收 | `getSupplierReceipts/index.js:109` + `supplier-receipts.wxml:16-17` |
| N25 | 异常 `resolution` 是店长自由文本，经 `getSupplierReceipts:93` 原样下发给供应商，可能包含内部信息 | `abnormal-list.js:60-69` + `getSupplierReceipts/index.js:93` |
| N26 | `generateSummaryReport:179` 查门店不带 `status:1`，停用门店仍可出汇总（与 `createReceipt:188` 拦截口径不一致） | `generateSummaryReport/index.js:179` |
| N27 | `abnormal-list.wxss` 有死样式 `.type-dot-delay`（`delay` 类型全库无写入点），且无 `.type-dot-missing_price` | `abnormal-list.wxss:39-42` |
| N28 | `supplier_product_price` 每 20 product_id 一批查但 `.limit(100)`，组合数超 100 时尾部截断 → 价格取 0 → 误报 `missing_price` | `createReceipt/index.js:340-347` |
| N29 | `getReceipts` 无 `receipt_status`/`purchase_order_id` 筛选；`storeId` 仍是死参数（M7 未修） | `getReceipts/index.js:44,61` |
| N30 | `receive-list` 三个 handler 的防抖置位在 confirm 之后、`_submitting`/`hideLoading` 不在 `finally`、三 action 共用一把锁（batch2 §5.5 三条，5268379 未修） | `receive-list.js:121-131,143-153,166-176` |

---

## 12. 遗留【待核实】

1. **`created_at` 回读形态**（决定 full-scan-02 H3 的排序问题是否成立）——需真机或云函数实测一次返回值是 `Date` 实例还是 ISO 字符串。**本轮只读代码无法判定。**
2. **`supplier_product_price` 的 `(supplier_id, product_id, is_current)` 唯一性**——需读 `updateProductPrice` 的写入逻辑与索引约束（不在本域）。影响 `createReceipt:346` 后者覆盖前者且无告警、以及 §7.4 的误报 `missing_price`。
3. **`openDocument` 对 `.csv` 的实际返回**（batch2:344）——需真机确认基础库行为。
4. **`receipt.receipt_status` 是否应随补结算/补价更新**——`repriceReceipt` 补价后该行已可付款，但 `:437` 写的 `receipt_status:'abnormal'` 永不变更，`receive-list.js:70-71` 的"收货异常"标签与 `hasAbnormal` 会永久显示。**需业务拍板**：`abnormal` 应表示"曾经有异常"还是"当前仍有未处理异常"。当前代码按前者实现但从未声明。
5. **`missing_price` 与"零元历史价"不可区分**——`supplier_product_price` 若真存在合法的 0 元价，`:366` 会把它当成"未配价"上报异常，描述文案（":485"）会误导处理人。**需业务确认 0 元价是否是合法业务值**，若是，应在 `supplier_product_price` 上区分"无记录"与"记录为 0"。
6. **`receipt_abnormal` 状态下是否允许作废**——若业务认为"已部分到货且异常未清"的单据不应作废（N1 建议①的路子），则 `dataService:1294` 的拒绝是正确的，死角要靠补收与状态回退解决；若业务认为应允许作废，则需补 `cancelOrder` 的白名单与线下通知逻辑。两条路都需要业务拍板，**代码层面无法自行决定**。

---

### 附：全读统计

| 类别 | 文件数 | 行数 |
|---|---|---|
| 必读全读（3 云函数 + 3 package.json） | 6 | 990 |
| 交叉参照全读 | 15 | ≈2,133 |
| 交叉参照部分读取 | 4 | 2,766（实读 ≈1,300） |
| **代码合计** | **25** | **≈4,420 行实读** |
| 前置文档（4 份，含 2 份全读） | 4 | ≈2,064（实读 ≈1,500） |
