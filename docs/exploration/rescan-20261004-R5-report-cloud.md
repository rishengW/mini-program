# R5 重扫：报表云函数（2026-10-04）

> **范围**：`cloudfunctions/{generateSummaryReport,getReports,getReportDetail,getReportFileUrl}`（4 × index.js + 4 × package.json）+ 报表落库交叉核对（`createPurchaseOrder` / `createReceipt` / `dataService` / `getPurchaseOrderDetail` / `getSupplierOrders` / `getSupplierReceipts`）+ 前端消费方（`pages/report-list|report-detail|report-history|receive-list`）+ `utils/cloud.js`、`utils/meta.js`、`seed-data/report_file.json`
> **方法**：逐行读代码，不采信注释/README/log.md。每条结论带 `文件:行号`。拿不准标【待核实】。
> **前置文档（增量，非抄写）**：`full-scan-03-cloud-report.md`（347 行）、`full-scan-06-pages-report.md`（514 行）、`full-scan-08-infra-and-data-contract.md`（702 行）
> **版本基线**：HEAD `5268379`（fix(pages): navigation, permissions, loading states and guard rails）。工作区未提交改动：`pages/report-list/report-list.js`（+4/−4）、`project.config.json`（+9/−1）。旧文档行号在本轮 **全部命中**，未发生漂移（仅 `getReports` 的 `getSessionUser` 由旧文档记作 7-37，实际 11-37，属旧文档笔误）。
> **与 02/04 批边界**：报表**生成侧**内部逻辑（事务、超收校验、异常登记）仍属 02 批；本文只核对「落库口径 / 类型全集 / 读取侧一致性 / 越权」四类问题。

---

## 0. 增量摘要

1. **report type 全集闭合，无差集。** 全代码出现 **8 个** report type 字面量；`utils/meta.js:33-40`、`getReports:68-72`、`getReportDetail:84-249` 三处映射**完全对齐**，不存在「定义了不生成 / 生成了不认识」。但 **2 个汇总类类型对门店角色不可达**（`getReports:79-86` 强制覆盖），且 `report-list.js:45-62` 的 tab 只有 6 种，汇总报表在报表中心无法按类型筛（只落「全部」）。
2. **「6 类报表落库」结论需修正为「6 种单据类 + 2 种汇总类 = 8 种，14 处 `report_file.add`」**。逐点核对见 §2.2。旧文档 L6/L-27 的「14 处」计数成立。
3. **`generateSummaryReport` 的两步（`uploadFile` :232-235 → `report_file.add` :237-255）不原子、无回滚**，且与 `createPurchaseOrder`（有 `missing_reports` 补偿 :437-462）不同，**没有任何补偿机制**：上传成功但落库失败 → 云存储孤儿文件 + 版本号白烧 + 用户只收到一句「汇总报表生成失败」。
4. **`getReportFileUrl` 越权不成立**（三道防线叠加，见 §4），但存在一个**当前不可达的潜在缺口**：`scope_id !== default_store_id` 是非严格比较，两侧同为假值时放行（:50）；今日数据下无 `scope_id` 为空的 report_file，故仅为潜隐风险。
5. **新发现 P1：归档与实时是两套实现，且第三套。** 归档 CSV（`createReceipt:583/664`，仅可付款行）／归档详情（`getReportDetail:159-198`，全行 + 按日聚合）／供应商实时视图（`getSupplierReceipts:54/99-112`，全行、无 payable 过滤、无单级聚合）三者口径互不相同。供应商实时看到金额 = 归档账单 + 应被剔除的异常行。
6. **新发现 P1：`superseded` 报表的「详情页表格」与「下载文件」数字不同源。** `auditOrder` 就地覆写 `purchase_order_item.order_qty`（`dataService:544-547`），归档 CSV 冻结的是覆写前的量，而 `getReportDetail` 现读的是覆写后的量 → 同一份报表（已作废的 v1）页面与文件不一致。
7. **`report-list.js` 未提交改动判定：纯语法归一化，零行为差异，不修任何缺陷、不引入新风险。** 详见 §6。
8. **回收旧【待核实】：清单 19 项，18 项闭环、1 项转真机**（03 批 11 项 + 06 批 11 项 + 08 批 12 项中与报表相关者，去重后 19 项），逐条给出定论见 §7.2。遗留【待核实】5 项见 §9（其中 2 项为旧文档结转，净新增 3 项）。

---

## 1. 文件清单与全读确认

**必读（全读，8 个文件 / 775 行）**

| # | 路径 | 行数 | 关键结构 |
|---|---|---|---|
| 1 | `cloudfunctions/generateSummaryReport/index.js` | 270 | `csvField:41-46` · `safePathPart:48-50` · `getNextVersion:53-70` · `isDate:72-76` · `getStoreReceipts:79-100` · `loadReceiptItems:103-120` · `loadProductCategoryMap:123-138` · `loadSupplierNameMap:141-154` · `main:156-270` |
| 2 | `cloudfunctions/generateSummaryReport/package.json` | 10 | 仅 `wx-server-sdk: ~2.6.3` |
| 3 | `cloudfunctions/getReports/index.js` | 103 | `getSessionUser:11-37` · `main:39-103` |
| 4 | `cloudfunctions/getReports/package.json` | 10 | 同上 |
| 5 | `cloudfunctions/getReportDetail/index.js` | 257 | `ABNORMAL_TYPE_NAMES:12-16` · `getAbnormalTypeNames:18-24` · `getSessionUser:26-52` · `main:54-257` |
| 6 | `cloudfunctions/getReportDetail/package.json` | 10 | 同上 |
| 7 | `cloudfunctions/getReportFileUrl/index.js` | 64 | `getSessionUser:11-37` · `main:39-64` |
| 8 | `cloudfunctions/getReportFileUrl/package.json` | 10 | 同上 |

**四个 `package.json` 完全同构**：`version 1.0.0`、唯一依赖 `wx-server-sdk: ~2.6.3`（波浪号，浮动到 2.6.x 最新 patch）、无 `config.json`、无 `layers`。含义：① 部署时依赖版本随环境漂移；② 无并发/内存/超时配置，走控制台默认值 —— **`generateSummaryReport` 拉全店明细 + 全量内存聚合，默认 60s 超时 + 512MB 是硬约束**，月汇总大店有超时风险（见 N4）。

**交叉参照（全读，16 个文件 / 4485 行）**

| 路径 | 行数 | 用途 |
|---|---|---|
| `cloudfunctions/createPurchaseOrder/index.js` | 471 | ① ② 报表首生（:361-372、:403-422） |
| `cloudfunctions/createReceipt/index.js` | 752 | ③ ④ ⑤ ⑥ 报表首生（:565-575、:598-609、:647-658、:682-693） |
| `cloudfunctions/dataService/index.js` | 1559 | 重算/补结算/补生成 7 处落库（:429、:470、:969、:1160、:1187、:1220、:1247）+ 2 处 superseded（:415-416、:1316-1318） |
| `cloudfunctions/getPurchaseOrderDetail/index.js` | 129 | 订单详情内嵌报表列表（:107-113） |
| `cloudfunctions/getSupplierOrders/index.js` | 136 | 供应商实时订单（不落库） |
| `cloudfunctions/getSupplierReceipts/index.js` | 119 | 供应商实时账单（不落库） |
| `pages/report-list/report-list.js` / `.wxml` | 163 / 63 | 报表中心 |
| `pages/report-detail/report-detail.js` / `.wxml` | 119 / 156 | 报表详情 |
| `pages/report-history/report-history.js` / `.wxml` | 115 / 43 | 历史报表 |
| `pages/receive-list/receive-list.js` | 185 | 补生成/补结算/补价入口 |
| `utils/cloud.js` | 282 | `normalizeReport:212-225`、`getFileUrl:243-252`、`getFileUrls:255-268` |
| `utils/meta.js` | 67 | `reportTypeMap:32-41`、`getReportTypeInfo:59-61` |
| `seed-data/report_file.json` | 167 | 11 条样本 |

**前置文档（部分全读）**：`full-scan-03` 全读 347 行；`full-scan-06` 读 270-430、460-514；`full-scan-08` 读 105-264、640-702。

**合计全读 24 个文件、约 5260 行代码**（不含 3 份旧文档）。

---

## 2. 报表类型全集对齐表

### 2.1 8 类 type 字面量全量分布

| report_type | 中文名 | 生成侧落库 | 读取侧分支 | 前端映射 | 种子样本 |
|---|---|---|---|---|---|
| `store_order_report` | 门店下单报表 | `createPurchaseOrder:365` · `dataService:431`（`_A` 审核后重发） | `getReportDetail:84-97` | `meta:33` | 2 条（`RPT_SO_PO20260806001`、`RPT_SO_PO20260805001`） |
| `supplier_order_report` | 供应商订货汇总 | `createPurchaseOrder:414` · `dataService:472`（`_A`） | `getReportDetail:128-158` | `meta:36` | 1 条（`RPT_SUO_SUP001_PO20260806001`） |
| `store_receipt_report` | 门店收货报表 | `createReceipt:567` · `dataService:1162`（`_RG`） | `getReportDetail:98-127` | `meta:34` | 1 条 |
| `store_receipt_price_report` | 门店带价格收货报表 | `createReceipt:600` · `dataService:1189`（`_RG`） | `getReportDetail:98-127`（**与上行共用分支**） | `meta:35` | 1 条 |
| `supplier_receipt_report` | 供应商到货汇总 | `createReceipt:649` · `dataService:1222`（`_RG`） | `getReportDetail:159-198` | `meta:37` | 3 条（SUP001/002/005） |
| `supplier_receipt_price_report` | 供应商带价格账单 | `createReceipt:684` · `dataService:971`（`_S` 补结算）· `dataService:1247`（`_RG`） | `getReportDetail:159-198`（**与上行共用分支**） | `meta:38` | 3 条 |
| `store_daily_summary_report` | 门店日汇总 | `generateSummaryReport:226→240` | `getReportDetail:199-249`（下载 CSV 反解析） | `meta:39` | **0 条** |
| `store_monthly_summary_report` | 门店月汇总 | `generateSummaryReport:226→240` | `getReportDetail:199-249` | `meta:40` | **0 条** |

**其他出现处**：
- `getReports:68-72` 白名单 8 项 —— **与上表完全一致**。
- `utils/meta.js:32-41` 8 项 —— **完全一致**。
- `report-list.js:46/49/50/51/56/57/58/59/60/61` 只出现 **6 种**（缺两个汇总类）。
- `report-history.js:31` 从 `Object.keys(meta.reportTypeMap)` 派生 → 8 种全暴露。
- `getPurchaseOrderDetail:111-112` 用 `report_scope === 'store'` 过滤，不涉 type。
- `report-detail.js:53/56` 用 `includes('price')` / `includes('summary')` 子串判断合计；`report-detail.wxml:27/43/60/77/101/117` 六分支。

### 2.2 落库点核对：「6 类」是否成立

`report_file.add` 调用点全量：**14 处**（`createPurchaseOrder` 2 + `createReceipt` 4 + `dataService` 7 + `generateSummaryReport` 1），覆盖 **8 种** type。

| 类型 | 落库点数 | 结论 |
|---|---|---|
| 单据链路 6 种（下单 2 + 收货 4） | 11 处（2+4+5） | 「6 类报表落库」**作为单据链路成立** |
| 汇总链路 2 种 | 1 处（daily/monthly 共用一个分支，:226 三元判定） | 旧文档未计入 → 全集实为 **8 类** |

读取/更新点（非 add）：`getReports:90-96`、`getReportDetail:62-65`、`getReportFileUrl:46`、`getPurchaseOrderDetail:107-110`；更新 `dataService:415-416`（改量）、`:1316-1318`（作废）；只读判定 `dataService:889-892`（settleReceipt 查重）。

### 2.3 差集（三向对齐结果）

| 差集方向 | 是否存在 | 证据 |
|---|---|---|
| 前端映射了但云端无对应 | **无** | meta 8 项 ⊆ 白名单 8 项 ⊆ 落库 8 种 |
| 生成了但前端不认识 | **无** | 落库 8 种 ⊆ meta 8 项 |
| 定义了但没人生成 | **无** | 白名单 8 项均有落库点 |
| **云端可达但前端不可筛** | **有（2 项）** | 汇总类在 `report-list.js:45-62` 无 tab，只能落在「全部」（见 N1） |
| **白名单可达但门店角色读不到** | **有（2 项）** | `getReports:79-86` 对 chef/store_manager 强制覆盖 `report_type` → 汇总类对门店角色永不可达 |
| **种子缺失类型** | **有（2 项）** | 汇总类无样本；且全 11 条无 `superseded`、`file_url` 全为 `""`（`seed-data/report_file.json:11/26/41/56/71/85/100/119/134/149/165`） |

---

## 3. 四个函数逐一体解

### 3.1 `generateSummaryReport`（270 行）

**时间范围口径（逐项回答）**

| 维度 | 结论 | 证据 |
|---|---|---|
| daily 区间 | `receipt_date === date`，**精确等值**（既非开也非闭的单点匹配） | :82 |
| monthly 区间 | `_.gte('YYYY-MM-01').and(_.lte('YYYY-MM-31'))`，**闭区间**（两端含）；上界用字符串 `'31'`，对 30 天/28 天月份大于任何合法日期，等价于「整月」 | :84 |
| 时区 | **无时区换算风险**：`receipt_date` 是裸字符串 `'YYYY-MM-DD'`（`createReceipt:311-318`），非 Date 对象，字符串比较不涉及 UTC+8 偏移 | :82/:84 与 `createReceipt:311-318` |
| 含不含当天 | **含当天**，不含次日；但「当天」由调用方决定 —— 前端固定传 `new Date()` 本地日期（`report-list.js:136-138`），服务端**无「date 不得晚于今天」校验**（:165-166 只验格式），故可传未来日期，生成一份当前必然为空的报表 | :165-166 |
| 日期合法性 | `isDate`（:72-76）用 `toISOString()` 回写比对，**拒绝 `2026-02-30`** 等非法日历日 | :72-76 |

**筛选条件**：仅 `store_id` + `receipt_date`，**无任何 status / receipt_status / payable 过滤**（:80-85）→ 作废单、异常单、不可付款行全部进入（异常单排除靠「取消单无收货单」的传递性，见 03 批 §1.4，本轮复核仍成立：`createReceipt:228` 白名单不含 `cancelled`，`dataService:1294-1296` 禁止作废有收货单的订单）。

**聚合算法**

| 维度 | 结论 | 证据 |
|---|---|---|
| 单据拉取 | `count()` 先算总量 → `skip/limit(100)` 循环取 `receipt_id` | :90-98 |
| 明细拉取 | `_.in(20 个 id)` + `skip/limit(100)` 翻页，`< 100` 即停 | :103-120 |
| **是否单次全量** | **否，双分页**，无 100/1000 静默截断 | :90-98、:110-117 |
| **是否分页聚合** | **是**（先全量取回，再在内存 `Object` 聚合）—— 非数据库 `aggregate` | :188-214 |
| limit 截断风险 | 聚合入口**无上限**：`items` 可任意大；`loadProductCategoryMap`/`loadSupplierNameMap` 各 `limit(100)` 且 20 个 id 一坨，若去重后 id 数 > 20×⌈N/20⌉ 的 100 上限……实际每次循环取 20 个 id 对应 `limit(100)` ≥ 20，**不截断** | :105-119、:126-132、:144-150 |
| 分组键 | `supplier_id + '|' + product_id`（同商品多供应商分行） | :194 |
| 剔除项 | 仅 `is_manual`（:191）；**未剔除 `payable_flag === false`**（沿用 03 批 M3） | :191 |
| 舍入 | 数量 3 位小数（:208-209）、金额逐行 2 位再累加（:211-212）、`totalAmount` 二次舍入（:215） | :208-215 |

**输出格式**：**CSV**（非 Excel/PDF），UTF-8 BOM + RFC 4180 双引号包裹 + 公式注入防御（`^[=+\-@]` 前缀 `'`）（:41-46、:234）。

**`cloud.uploadFile` 路径与唯一性**

```
reports/summary/<period>/<storeId>/<pathDate>-summary-v<version>-<base36(Date.now())><6 hex 随机>.csv
```
- :231；月汇总 `pathDate = date.slice(0,7)`（:229）
- 唯一性三重：`version`（计数器）+ 毫秒 base36 + 24bit 随机。**文件名不含单号**（:230 注释自述原因）。
- **未用 `safePathPart`**：`:48-50` 定义了但全文 0 调用，`storeId` 直拼路径（沿用 03 批 L1）。`purchaser/super_admin` 可传任意存在于 `store` 集合的 `storeId`（:178-179），若档案含 `/ \ 空格` 将被解释为目录。

**失败回滚（本项是任务重点）**

| 步骤 | 行号 | 失败后果 |
|---|---|---|
| ① `getNextVersion` 自增 | :228 | 版本计数器已 +1 |
| ② `cloud.uploadFile` | :232-235 | **文件已上云，无 record 指向它** |
| ③ `report_file.add` | :237-255 | 若此步失败 → ②产生孤儿文件 + ①版本白烧 |

- **两步不原子、无回滚、无补偿**：`catch`（:266-269）只返回 `-1 汇总报表生成失败，请稍后重试`，**不写 `missing_reports` 标记、不发通知、不清理孤儿文件**。
- 对比：`createPurchaseOrder:437-462`（写 `missing_reports` + 定向通知超管 + `dataService.regenerateOrderReports` 补生成入口）、`createReceipt:700-726`（写 `missing_reports` 到订单和收货单 + 通知 + `regenerateReceiptReports`）。**汇总报表是三条生成链路里唯一没有补偿机制的**。
- 反向风险不存在：`add` 在 `upload` 之后，不会出现「有 record 无文件」的幽灵记录。
- 版本号白烧：`:228` 在 `:232` 之前，失败后版本号跳号（无实际危害，但下次生成的 `v` 不连续）。

### 3.2 `getReports`（103 行）

- 权限收敛（唯一安全语义）：chef → `store` + `store_order_report` + 自身门店（:50-55）；store_manager → `store` + 自身门店（:56-60）；purchaser/super_admin → 全量 + 可选 `reportScope`（:61-63）；其余 → `-403`（:64-66）。
- **防扩张**：:79-86 在 client 参数处理**之后**再次覆盖 chef/store_manager 的三项字段。逻辑等价性复核成立，权限收敛无漏洞。
- 死参（沿用 M5）：`role`/`storeId` 于 :43 解构后**全文 0 使用**，管理员无法按门店收窄。
- 校验：`reportScope ∈ ['store','supplier']`（:46）、`relatedDate` 仅正则（:47，**放行 `2026-02-31`**，与 `generateSummaryReport:72-76` 严格度不一致）。
- 分页：`count()` + `orderBy('generated_at','desc')` + `skip/limit`（:88-96），`page` 上限 1000、`pageSize` 上限 50。**无 aggregate，无截断**；**排序无次要键**，同毫秒批量落库的多张报表在翻页边界可能抖动。
- **不按 `status` 过滤**（沿用结论）：`superseded` 与 `generated` 同列表返回，前端 `report-list.wxml:41` / `report-history.wxml:31` 打「已作废」标签。
- **无 `field()` 投影**：整条 `report_file` 文档下发，含 `file_url`（fileID）、`total_amount`、`excluded_rows`。

### 3.3 `getReportDetail`（257 行）

- 元数据查询：`where({report_id}).limit(1)` **无 `orderBy`**（:62-65）→ 同 `report_id` 双记录时命中不确定（承接 03 批 H5 的并发撞号）。
- 权限：:71-77，chef/store_manager 需 `report_scope === 'store' && scope_id === default_store_id`，chef 追加 `report_type === 'store_order_report'`。
- **不校验 `report.status`**：superseded 报表照常可看可取（承接结论，但见 §5 的失配后果）。
- 5 条重建分支（8 种 type）：**均为「从原始集合重建行数据」**，不读归档文件（除汇总类）：

| 分支 | 行号 | 粒度 | limit |
|---|---|---|---|
| `store_order_report` | :84-97 | 单单 | `purchase_order_item` :88 `limit(1000)` **无分页** |
| `store_receipt_report` / `store_receipt_price_report`（共用） | :98-127 | `receipt.where({purchase_order_id}).limit(1)` → `receipt_item` | :102 `limit(1)` **无 orderBy**；:108 `limit(1000)` 无分页 |
| `supplier_order_report` | :128-158 | **按日聚合多单** | :135 `limit(200)` 无分页；:144 `_.in(20)` + `limit(1000)` |
| `supplier_receipt_report` / `supplier_receipt_price_report`（共用） | :159-198 | **按日聚合多单** | :166 `limit(200)`；:175 `_.in(20)` + `limit(1000)` |
| 日/月汇总 | :199-249 | 下载 CSV → RFC4180 手工解析 | 无（受云存储文件大小限制） |

- 汇总类解析器（:208-228）是**正确的 RFC 4180 解析**：双引号包裹、`""` 转义、行内逗号/换行处理；去 BOM（:206）、跳末行「合计」（:233）、解析失败 `throw` 不静默成空表（:244-248）。**解析器本身无 bug**。
- **新发现**：`csvField:44` 的公式注入防御会前缀 `'`，解析侧 `Number(f[i]) || 0` 不受影响（数量/金额不触发），但 `productName`/`supplierName` 若以 `= + - @` 开头（商品名如 `-白菜`）会在详情表里显示为 `' 白菜`（带撇号）。仅展示层失真（N8）。
- 异常字典：:12-16 只有 `shortage/quality/wrong_item`，**缺 `missing_price`**（对照 `createReceipt:52-57`、`dataService:688`）→ 见 §7 回收。

### 3.4 `getReportFileUrl`（64 行）

见 §4 专章。

---

## 4. `getReportFileUrl` 越权分析（重点）

### 4.1 调用链与校验顺序

```
event.authToken → getSessionUser(:11-37)
  → user 为空 → -401 (:41-42)
  → fileId 为空 → -1 (:43-44)
  → report_file.where({file_url: fileId}).limit(1) (:46)      ← ① 先反查记录
      → 无记录 → -1 报表文件不存在 (:47)                        ← ② 不存在即终止，不触达云存储
  → 角色/作用域校验 (:49-54)                                     ← ③ 后判权限
      → 不通过 → -403
  → cloud.getTempFileURL({fileList:[fileId]}) (:55)            ← ④ 最后才换链接
```

**校验顺序正确**：fileID 必须在 `report_file.file_url` 中存在才会走到 `getTempFileURL`，无法用它当通用 fileID 换取器。

### 4.2 越权矩阵

| 调用者 | 可下载范围 | 证据 |
|---|---|---|
| `super_admin` / `purchaser` | 全库任意报表 | :49 直接放行 |
| `store_manager` | `report_scope === 'store' && scope_id === 自身门店`，**不限 type**（可含 `store_receipt_price_report` 单价表、`store_daily_summary_report`） | :50 |
| `chef` | 上述 + 强制 `report_type === 'store_order_report'` | :50/:53 |
| `supplier` | **一律 -403** | :50 第一个条件为真 |
| 未登录/过期 | -401 | :41-42 |

### 4.3 枚举攻击可行性

| 攻击路径 | 可行性 | 理由 |
|---|---|---|
| 猜 fileID 直接下载他人报表 | **不可行** | ① 必须先命中 `report_file.file_url`（:46）；② 即使猜中路径（`reports/store/<date>/store-order-<店名>-<date>-<单号>-v<n>.csv`，`createPurchaseOrder:361`），单号含 `Date.now().toString(36)` + 4 hex（:271），不可枚举；③ 命中后仍受 :49-54 作用域约束 |
| 跨门店越权 | **不成立** | `report.scope_id !== user.default_store_id`（:50） |
| 跨供应商越权 | **不成立** | 供应商类报表 `report_scope === 'supplier'`，:50 直接拒绝 |
| chef 借 `store_receipt_price_report` 拿单价 | **不成立** | :53 type 硬拦截 |
| 借 `report_file` 记录不存在绕过 | 不适用 | :47 直接终止 |

### 4.4 缺口（本轮新增）

**G1｜`scope_id !== default_store_id` 是非严格比较，两侧同为假值时放行（潜在，当前不可达）**
`getReportFileUrl:50`：`if (!['chef','store_manager'].includes(user.role) || report.report_scope !== 'store' || report.scope_id !== user.default_store_id)`。
- 若 `user.default_store_id === undefined` 且 `report.scope_id === undefined` → `undefined !== undefined` 为 **false** → 放行。
- **当前不可达**：全 14 处 `report_file.add` 均显式写 `scope_id`（`createPurchaseOrder:366/415`、`createReceipt:568/601/650/685`、`dataService:432/473/972/1163/1190/1223/1250`、`generateSummaryReport:242`），且门店/供应商 id 均经非空校验。
- 但对比 `getPurchaseOrderDetail:61`（`!user.default_store_id || order.store_id !== ...`）和 `getReports:54/59`（显式 `if (!user.default_store_id) return -403`）——**同项目三处门店归属判定严格度不一致**，:50 是唯一没有前置 `!default_store_id` 兜底的。任何未来新增的无 `scope_id` 报表记录都会把它变成真越权。
- **`getReportDetail:75` 存在完全相同的问题**（且没有 `getReports` 的 403 前置拦截）。

**G2｜`supplier` 角色 403 文案与「报表本身面向供应商」的语义矛盾**
`supplier_order_report`/`supplier_receipt_report`/`supplier_receipt_price_report` 是为供应商生成的（`createPurchaseOrder:404` CSV 含供应商名+联系人，`createReceipt:676` 含门店名），但 :50 让供应商账号一律拿不到自己的账单文件。承接 03 批 M1。

**G3｜`getTempFileURL` 无错误细分、无频率/数量保护**
:55 只传 1 个 fileID（单次上限 50，远未触及），返回无 `tempFileURL` → `-1 获取链接失败`（:59）。文件被删/云存储抖动/环境权限变更**共用同一文案**，调用方（`report-detail.js:113`）只能弹「文件链接获取失败」。函数内无本地限流，也无 `getTempFileURL` 的调用频率防护 —— 但**越权面为 0**，故仅为可用性/可诊断性问题，非安全问题。

**G4｜返回体缺元信息**（承接结论）
`{ url }` 不含 `expireTime`/`fileType`/`fileName`（:57）。云开发临时链接有效期约 30 分钟（默认值），前端无从得知，`wx.downloadFile` 过期后只能落到「下载失败」（`report-detail.js:110`）。

**结论一句话**：**`getReportFileUrl` 的越权不成立** —— 「必须先命中 `report_file.file_url`（:46）+ 按调用者作用域与角色二次校验（:49-54）+ fileID 含 24bit 随机后缀不可枚举（:231）」三道防线叠加；唯一缺口是 `scope_id` 非严格比较在两侧同为假值时放行（:50），今日数据下不可达，属潜隐风险而非现行漏洞。

---

## 5. 归档 vs 实时一致性

### 5.1 前提修正

任务背景称「实时报表：前端在 `pages/report-list` 调 `dataService` 现算」—— **该前提与代码不符**。`pages/report-list/report-list.js` 全程只调 `getReports`（:73）与 `generateSummaryReport`（:142），**没有任何 `dataService` 调用，也没有任何现算逻辑**。全项目 `grep "callFunction('dataService'"` 的 30+ 处调用点中**无一处属于报表页面**。

实际的「实时（不落库）」路径在**供应商门户**：

| 路径 | 类型 | 证据 |
|---|---|---|
| `getSupplierOrders` | 实时：直读 `purchase_order` + `purchase_order_item`，不写任何集合 | `getSupplierOrders:72-131` |
| `getSupplierReceipts` | 实时：直读 `receipt_item` + join `receipt` + join `abnormal_record`，现算 `amount` | `getSupplierReceipts:56-114` |
| 归档 CSV（6 类单据 + 2 类汇总） | 落库：`report_file` + 云存储文件 | §2.2 |

### 5.2 两套（实为三套）实现，必然漂移 —— 逐条证据

**证据 1｜金额口径：归档账单剔除不可付款行，实时视图不剔除**

| 实现 | 过滤条件 | 行号 |
|---|---|---|
| 归档④ 门店带价 | `items.filter(i => i.payableFlag && !i.isManual)` | `createReceipt:583` |
| 归档⑥ 供应商带价 | `sup.items.filter(i => i.payableFlag && !i.isManual)` | `createReceipt:664` |
| 归档补生成④⑥ | 同款 `payable_flag !== false && Number(price_snapshot) > 0` | `dataService:1173`、`:1233` |
| 归档补结算 `_S` | 同款 `!item.is_manual && item.payable_flag !== false && Number(item.price_snapshot) > 0` | `dataService:925` |
| 归档③⑤ 不含价 | **全量行**（异常只作标记） | `createReceipt:559`、`:640` |
| **实时（供应商门户）** | 仅 `is_manual: _.neq(true)`，**无 `payable_flag` 过滤** | `getSupplierReceipts:54` |
| 归档详情重建④⑥ | **无 `payable_flag` 过滤**，仅把 `payable` 挂到行上 | `getReportDetail:159-198`（:190 `payable: item.payable_flag`） |

后果：质量/错货异常行、缺价行在**实时视图里带金额显示**（`getSupplierReceipts:102-109` `amount = Math.round(receivedQty * price * 100) / 100`），而**归档账单 CSV 里没有这些行**。供应商按实时视图对账会算出大于账单的金额。`payable_flag` 的判定源是 `createReceipt:356-369`（`hardAbnormal = 非少货异常` → false；`priceSnapshot <= 0` → false），两类行在实时视图都无标识区分。

**证据 2｜粒度口径：归档「每单一份」，归档详情「按日聚合」**

- 归档：`createPurchaseOrder:414` / `createReceipt:684` 的 `report_id` 与 `source_order_id` 都绑定**单一**单据（`RPT_SURP_<sid>_<receiptId>`）。
- 归档详情重建：`getReportDetail:131-132` 用 `report.scope_id`（供应商）+ `report.related_date`（日期）**完全忽略 `report.source_order_id`**（:82 取了 `orderId` 但 :128-158、:159-198 两条分支从未使用它）。
- 实时：`getSupplierReceipts` **逐行平铺**，无单级聚合，无日聚合。

→ 同一份 `supplier_receipt_price_report` 记录：CSV 只有 1 单的账单、详情页表格是当日所有单的合并、实时视图是全量行。**三方数字互不等**（承接 03 批 H1、06 批 H3，本轮补上「实时视图」第三方证据）。

**证据 3｜数据源时效：归档文件冻结，实时视图随 `repriceReceipt` 漂移**

- `repriceReceipt`（`dataService:1064-1070`）**就地更新** `receipt_item.price_snapshot` 与 `payable_flag`。
- 归档 CSV 已在云存储，**不会自动重出**（需管理员另走 `regenerateReceiptReports`，产出 `_RG` 后缀新版本）。
- `getSupplierReceipts:102` 每次现读 `price_snapshot` → 补价瞬间实时金额跳变，而归档账单仍是 0/缺行。
- `getReportDetail:118/189` 同样现算 `subtotal` → 归档详情页与归档 CSV 在补价后也会分叉（CSV 冻结旧价、详情显示新价）。**这是「归档详情」与「归档文件」自身的失配，不只是实时 vs 归档。**

**证据 4｜下单侧同源失配（本轮新增，P1）**

`auditOrder` 改量后就地覆写 `purchase_order_item.order_qty`（`dataService:544-547`：`order_qty: approvedQty, approved_qty: approvedQty`），**原始申请量被销毁**。随后：
- `dataService:415-416` 把原 `store_order_report` / `supplier_order_report` 标 `superseded`（v1，CSV 里是**改量前**的数字）；
- `dataService:419-479` 生成 `_A` 新版（CSV 里是**改量后**数字）。

但 `getReportDetail:84-97` 读的是 `purchase_order_item.order_qty`（**改量后**），且**不区分 `report_id` 的 `_A` 后缀**。→ **打开已作废的 v1 报表，页面表格显示改量后数量，点「导出报表文件」下载到改量前 CSV**。两者数字不同源，且界面没有任何提示（只有 `report-list.wxml:41` 一个「已作废」灰标）。

**证据 5｜异常识别能力不对称**

- 实时视图 `getSupplierReceipts:78-97` **join `abnormal_record`** 并回带 `status`/`resolution`/`payment_decision`。
- 归档详情 `getReportDetail:18-24` 只读 `receipt_item` 的三个布尔位（`is_shortage/is_quality_issue/is_wrong_item`），**不 join `abnormal_record`，且 `receipt_item` 根本没有 `is_missing_price` 字段**（`createReceipt:462-464` 只写三个）。
- → 缺价行在归档详情里显示「正常」+ `payable:false`，在实时视图里显示为带金额的正常行 + 一条 `missing_price` 异常记录。**两侧对「缺价」的表达能力完全不同**（呼应 08 批【待核实】#6）。

### 5.3 结论

**不是两套，是三套实现，且三者互不同源**：归档 CSV（冻结快照，剔除不可付款行，每单一份）／归档详情（现算重建，全行，按日聚合）／供应商实时视图（现算，全行，逐行平铺）。任务背景设想的「前端在 report-list 现算」这条路径**不存在**。金额口径不一致由证据 1 直接坐实，且已具备业务影响（供应商按实时视图对账会与账单不符）。

---

## 6. `report-list.js` 未提交改动 diff 分析

`git diff` 共 3 个 hunk、4 行 +4/−4，全部是 `?.` → `&&`：

| hunk | 改前 | 改后 | 行号 |
|---|---|---|---|
| 1 | `app.globalData.userInfo?.role \|\| 'purchaser'` | `(app.globalData.userInfo && app.globalData.userInfo.role) \|\| 'purchaser'` | :42 |
| 2 | `app.globalData.userInfo?.role \|\| 'purchaser'` | 同上 | :69 |
| 2 | `app.globalData.currentStore?.storeId` | `app.globalData.currentStore && app.globalData.currentStore.storeId` | :70 |
| 3 | `storeId: app.globalData.currentStore?.storeId \|\| ''` | `storeId: (app.globalData.currentStore && app.globalData.currentStore.storeId) \|\| ''` | :145 |

**改前是什么问题？** 没有逻辑问题。可选链 `?.` 在 WeChat 基础库 2.10+ 受支持，`project.private.config.json:2` 的 `libVersion: 3.17.1` 远高于该门槛，`?.` 完全可运行。
**逐值等价性核对**：`userInfo` 为 `null`/`undefined` → 两者都得到 `'purchaser'`；`userInfo.role` 为 `''` → 两者都因 `\|\|` 得到 `'purchaser'`；`currentStore` 存在而 `storeId` 为 `undefined` → 两者都得 `undefined`（:70 无 `\|\| ''` 兜底，传参为 `undefined`，`getReports` 本就不读该参数）；`currentStore` 为 falsy → 两者都得 `''`。**四个分支值完全一致。**
**改后是否闭合？** 闭合的不是缺陷，而是**编译链兼容面**：本轮改动后，全代码 `pages/`、`utils/`、`app.js` 已无可选链（唯一残留 `utils/cloud.js:234` 的 `(?:\?.*)?$` 是正则字符类，非语法）。这与 `report-history.js:56-57` 已使用的三元风格一致。
**有没有新问题？** 没有。无逻辑变化、无副作用、不引入风险。
**与已定论结论是否冲突？** 不冲突。`full-scan-06` 的 L10 已记录同一 diff（`:42`、`:69-70`、`:145`，+4/−4），本轮结论一致并补充了「四分支逐值等价」的核对过程。
**判定**：**纯语法归一化（compatibility-only），可安全保留或丢弃；它既不修复任何缺陷，也未引入任何风险，不改变本报告中任何一条结论。**

附带未提交改动 `project.config.json`（+9/−1）：新增 `packOptions.ignore` 排除 `采购流程图.png`，属包体积优化，与报表域无关；注意该文件缺末尾换行符。

---

## 7. 旧结论复核表 + 旧【待核实】回收表

### 7.1 旧结论复核（抽查高风险项，行号均重新命中）

| 旧结论 | 出处 | 本轮复核 |
|---|---|---|
| H1 供应商类按日重建 + `limit(200)` 截断 | 03 §H1 | **成立**：`getReportDetail:133-136`、`:164-167`、`:144`、`:175` 逐行命中；:131-132/:162-163 确未使用 `source_order_id` |
| H2 带价报表读取侧未过滤 `payable_flag` | 03 §H2 | **成立**：`:98-127`、`:159-198` 均无过滤，:119/:190 仅挂载 `payable` 字段 |
| H3 分批收货 `limit(1)` 无 `orderBy` | 03 §H3 | **成立**：`:100-103`；`createReceipt:421-427` 确认批次号由「已提交收货单数+1」生成，同一 `purchase_order_id` 可多张 `store_receipt_report` 共享 `source_order_id` |
| H5 `getNextVersion` 自增后回读撞号 | 03 §H5 | **成立**：`generateSummaryReport:57-63`、`createPurchaseOrder:81-87`、`createReceipt:77-83`、`dataService:364-370` **四处逐字复制**；仅汇总类的 `report_id` 会因此撞（:239 由 version 派生），订单/收货类因含单号不撞 |
| H4 全 CSV + `openDocument` 未传 `fileType` | 03 §H4 / 06 §H2 | **成立**：14 处产出全 `.csv`；`report-detail.js:103-104` `wx.openDocument({ filePath, showMenu: true })` 无 `fileType` |
| M2 月汇总 `related_date` 存点击日 | 03 §M2 | **成立**：:227 注释自述、:244 落库、:228 计数器 key 用 `date` 而非月份 |
| M3 汇总金额含不可付款行 | 03 §M3 | **成立**：:191 只剔 `is_manual` |
| M6 店长生成权限前后端不一致 | 03 §M6 / 06 §H1 | **成立**：`generateSummaryReport:160` 含 `store_manager`，`report-list.js:128` 只放 `['super_admin','purchaser']`；`report-list.wxml:6` 无条件显示「生成汇总 ▸」 |
| M5 `getReports` 死参 | 03 §M5 / 06 §L4 | **成立**：:43 解构后 0 使用 |
| M8 `total_amount`/`item_count` 无人消费 | 03 §M8 | **成立**：`normalizeReport:212-225` 未映射二者；`report-detail.js:54-58` 另算 |
| M9 `receipt_abnormal` 卡死 + 仍计入汇总 | 03 §M9 | **成立**：`createReceipt:386` 注释「receipt_abnormal 允许继续补收」与 :392 白名单（不含该状态）**直接矛盾**；`dataService:1294-1296` 禁作废 |
| L1 `safePathPart` 定义了未调用 | 03 §L1 | **成立**：`generateSummaryReport:48-50` 定义，全文 0 调用；:231 直拼 `storeId`（对照 `createPurchaseOrder:361`、`createReceipt:563` 均用 `safePathPart(storeName)`） |
| L6 `status` 仅 2 值 | 03 §L6 | **成立**：写 `generated` 11 处 + 写 `superseded` 2 处（`dataService:415-416`、`:1316-1318`） |
| L-22 chef/store_manager 报表可见面不对称 | 08 §L-22 | **成立并扩展**：除 `getReports` 外，`getPurchaseOrderDetail:111-113` 对 chef 按 `report_scope` 过滤、对 store_manager **不过滤**（供应商类报表元数据含 `scope_name` 供应商名也下发给店长） |
| L-25 作废只标下单侧报表 | 08 §L-25 | **成立**：`dataService:1316-1318` 的 `_.in(['store_order_report','supplier_order_report'])`，收货侧 4 类不标 |
| L-27 14 处落库 / 14 次 `basis_date_type` | 08 §L-27 | **成立**：本轮逐点计数同为 14（§2.2） |
| 06 §M8 `supplier_receipt_price_report` 无 `has_abnormal` | 06 §M8 | **成立**：`createReceipt:682-691` 只有 `excluded_rows`；`dataService:1247-1255` 同样无 `has_abnormal` |
| 03 §L155 / 08 §2.2 `file_url` 全空串 | 08 §2.2 | **成立**：11 条全 `""`；`getReportFileUrl:46` 按 `file_url` 反查 → 传空 `fileId` 会命中首条种子记录再走 `getTempFileURL([''])` 失败（非越权，语义混乱） |

**旧文档错误 1 处**：03 §1.3.7 称汇总类 `report_id = 'RPT_DSRPT_<storeId>_<date>_v<version>'`，实际 `generateSummaryReport:239` 为 `` `RPT_${period === 'daily' ? 'DS' : 'MS'}_${storeId}_${date}_v${version}` `` → 真实值 `RPT_DS_S001_2026-10-04_v1` / `RPT_MS_S001_2026-10-04_v1`。**旧文档此处有误，本轮更正。**

### 7.2 旧【待核实】回收表（清单 19 项，18 项闭环）

| # | 来源 | 原问题 | 本轮定论 |
|---|---|---|---|
| 1 | 03 §7-1 | 报表链是否受 F1（嵌套 error 吞 401）影响 | **已解决**：4 个函数全顶层扁平 `{code,msg}`，`utils/cloud.js:68` 命中 `-401` |
| 2 | 03 §7-2 | 报表粒度每单还是每日聚合 | **已解决**：生成侧一律每单（带 `source_order_id`），读取侧按日聚合 → 读取侧错（§5 证据 2） |
| 3 | 03 §7-3 | 带价读取侧是否漏过滤 | **已解决**：漏了（§5 证据 1） |
| 4 | 03 §7-4 | 文件格式 | **已解决**：14 处全 `.csv`；`report-detail.js:103` 无 `fileType` |
| 5 | 03 §7-5 | `receipt_abnormal` 是否影响报表统计 | **已解决**：报表不漏（无 status 过滤），卡死问题在 02 批 |
| 6 | 03 §7-6 | `report_version_counter` 创建方式 | **已解决**：运行时 upsert（:56-67）；环境禁自动建集合时首次生成会失败且报错无法定位（:69 抛错 → :266-269 统一 `-1`） |
| 7 | 03 §7-7 | `report_file.status` 实际取值 | **已解决**：`generated`/`superseded` 两值 |
| 8 | 03 §7-8 | 06 批是否记录 `fileType` 缺失 | **已解决**：06 §H2 已记 |
| 9 | 03 §7-9 | 分批收货下单几张收货报表 | **已解决**：每张 receipt 一份（`createReceipt:567`），共享 `source_order_id` → 触发 H3 |
| 10 | 03 §7-10 | 前端 `role` 兜底 `'purchaser'` 与死参叠加 | **已解决**：不越权（服务端按会话 user 收敛） |
| 11 | 03 §7-11 | `total_amount`/`item_count` 是否被消费 | **已解决**：无人消费，`normalizeReport` 也未映射 |
| 12 | 06 §7-1 | `openDocument` 对 `.csv` 的真实行为 | **仍待核实**（需真机实测，§9-1） |
| 13 | 06 §7-2 | 供应商报表正确粒度 | **已解决**：产品口径应为「每单一份」= 生成侧；读取侧需改（§5 证据 2） |
| 14 | 06 §7-3 | `receipt_item` 是否已落 `is_manual` | **已解决**：**已落**（`createReceipt:461`），但 `getReportDetail:177-196` 仍不按它过滤 |
| 15 | 06 §7-5 | `report_file` 是否有删除逻辑导致 count 与分页不一致 | **已解决**：**全项目无任何 `report_file` 删除调用**（`grep remove()` 于 4 个函数 + dataService 均为 0）→ 06 §M1 的「空页死循环」触发条件只剩 count 与分页查询之间的**并发窗口**（期间新生成/superseded 不改变总数，故实际上**不会**因删除触发） |
| 16 | 06 §7-9 | 月汇总 `related_date` 该存哪天 | **已解决（工程侧）**：存「点击日」是注释自述的设计选择（:227），与文件路径用月份（:229）不一致属设计缺陷而非待确认 |
| 17 | 08 §待核实-4 | `priceReportsSkipped` 是否被前端消费 | **已解决**：`grep priceReportsSkipped` 全项目仅 `createReceipt:736` 一处写入，**前端 0 消费**，属死字段 |
| 18 | 08 §待核实-6 | `getReportDetail:12-16` 字典缺 `missing_price` 是否影响 #11 补价补账展示 | **已解决，且比原设想更严重**：字典确实缺（对照 `createReceipt:56`、`dataService:688`），但**真正的缺口不是字典** —— `getReportDetail:18-24` 的 `getAbnormalTypeNames` 只读 `is_shortage/is_quality_issue/is_wrong_item`，而 `receipt_item` **根本没有 `is_missing_price` 字段**（`createReceipt:462-464` 不写）。故缺价行在归档详情里恒显示「正常」，补字典也无法修复；必须改为 join `abnormal_record`（像 `getSupplierReceipts:83-87` 那样） |
| 19 | 08 §待核实-7 | 是否有前端以空 fileId 调 `getReportFileUrl` | **已解决**：`report-detail.js:91` 有 `if (report.fileUrl \|\| report.file_url)` 前置守卫，正常路径不会传空；但种子 `file_url` 全为 `""` 时该守卫为假 → 走 `:116` 「该报表尚未生成可下载文件」，**不会误传空串** |

**回收统计：18 项已闭环（含 3 项旧文档结论被本轮修正/加重），1 项仍需真机（§9-1）。**

---

## 8. 新问题清单

### P0

**（无新增 P0）** —— 本轮未发现比 03/06 已记 P0 更严重的问题；已记的最高危项（`openDocument` 不支持 CSV 导致导出必然失败、读取侧口径与文件不符）本轮复核仍成立。

### P1

**N1｜`report-list` 的 tab 缺 2 个汇总类类型，刚生成的汇总报表只能靠「全部」翻找；而 `report-history` 又能精确筛 —— 两页能力互补且互相看不到**
`pages/report-list/report-list.js:45-62`（chef 1 种、store_manager 3 种、admin 6 种，均无 `store_daily_summary_report`/`store_monthly_summary_report`）；对照 `report-history.js:29-34`（从 `meta.reportTypeMap` 派生 8 种）。
复现：管理员点「生成汇总 ▸」→ `reload()`（:153）→ 列表刷新，但汇总卡片只出现在「全部」tab，无任何类型 tab 可选中。
影响：功能闭环断档（生成入口在 A 页、精确检索在 B 页，且 B 页非 tabBar，需从 A 页跳转）。
建议：`report-list.js:55-62` 的 admin 分支补两个汇总类 tab。

**N2｜`generateSummaryReport` 两步不原子、无回滚、无补偿 —— 三条报表生成链路里唯一没有补偿机制的**
`generateSummaryReport:232-255`（upload → add，中间任何一步失败即孤儿）；`catch:266-269` 只回通用 `-1`。对照 `createPurchaseOrder:437-462`、`createReceipt:700-726` 均有 `missing_reports` + 通知 + 补生成入口。
复现：`report_file.add` 超时/失败 → 云存储留一份孤儿 CSV、`report_version_counter` 已 +1、用户只见「汇总报表生成失败」，无标记无通知，管理员无从知晓有文件悬空。
影响：孤儿文件持续堆积（云存储成本）；同区间重试得到 v2 但用户不知 v1 文件已在云上。
建议：`add` 失败时 `try { cloud.deleteFile({fileList:[uploadRes.fileID]}) } catch {}`；或仿照另两条链路打 `missing_reports` 并走同一补生成入口。

**N3｜`superseded` 报表的详情页表格与下载文件数字不同源（审核改量场景）**
`dataService:544-547`（就地覆写 `order_qty`）→ `getReportDetail:86-97`（现读覆写后的量）vs `createPurchaseOrder:356-360`（v1 CSV 冻结覆写前的量）；`dataService:415-416` 已把 v1 标 `superseded` 但 `getReportDetail` 不校验 status（:61-77）。
复现：管理员审核改量 → 原报表标「已作废」→ 点开详情看表格（新量）→ 点「导出报表文件」下载到旧量 CSV。
影响：审计留痕场景下的核心矛盾 —— 作废版本本应可复核旧数字，现在页面看的是新数字、文件里是旧数字，两者都对不上任何单一真相。
建议：`getReportDetail` 对 `report.status === 'superseded'` 或非 `_A` 版本改读 `approved_qty` 的原始申请量，或归档时把申请量与批准量各存一份快照字段。

**N4｜`getReportDetail` 汇总类每次打开都全量下载 CSV 并手工解析，且云函数超时/内存无配置**
`getReportDetail:203-206`（`cloud.downloadFile` 全量拉取）+ :208-228（全文字符串解析）；4 个 `package.json` 均无超时/内存配置，走控制台默认。
复现：反复打开同一张月汇总详情；或大店月汇总（`generateSummaryReport:188-214` 全量内存聚合）。
影响：每次一次云存储下载 + 全文解析，无缓存；`generateSummaryReport` 在明细量大时有超时风险（默认 60s）。
建议：生成时把结构化 `rows` 落库（或独立集合），CSV 仅供导出；`package.json` 补超时与内存声明。

**N5｜供应商实时视图不剔除不可付款行，金额与归档账单不符**
`getSupplierReceipts:54`（仅 `is_manual: _.neq(true)`）+ :102-109（现算 `amount`）；对照归档账单 `createReceipt:583/664`、`dataService:925/1173/1233` 均剔除 `payable_flag === false`。
复现：某收货行勾选质量问题（→ `payableFlag=false`，`createReceipt:356-363`）→ 供应商门户该行仍显示金额，归档账单里无该行。
影响：供应商按实时视图对账得出大于账单的金额；`payment_decision` 已在 `abnormal_record` 里（:94），实时视图也没把它换算成「是否计入可付」。
建议：实时视图加 `payable_flag` 展示列并按 `payment_decision === 'pay_received'` 修正可付判定，与归档账单口径对齐。

### P2

**N6｜`getReportDetail` 与 `getReportFileUrl` 的门店归属判定缺 `!default_store_id` 前置兜底（潜在越权）**
`getReportDetail:75`、`getReportFileUrl:50`（`report.scope_id !== user.default_store_id`，两侧同为假值时放行）；对照 `getReports:54/59`、`getPurchaseOrderDetail:61` 均有前置校验。当前数据下不可达（14 处落库均写 `scope_id`），属潜隐风险。
建议：两处补 `if (!user.default_store_id) return { code:-403, ... }`。

**N7｜`createReceipt` 不校验 `receiptDate` 不得晚于今天 → 未来日期收货会静默污染未来月份汇总**
`createReceipt:311-318` 只验格式；:435 的 `backfilled` 只标记**过去**日期。
复现：传 `receiptDate: '2026-11-01'` → 落库成功，10 月汇总不含、11 月汇总提前包含。
建议：加 `receiptDate > today → -1`，或复用 `isBackfilled` 打「未来日期」标记。

**N8｜`csvField` 的公式注入防御前缀 `'` 会污染详情表的商品名显示**
`generateSummaryReport:44`（`if (/^[=+\-@]/.test(s)) s = "'" + s`）→ `getReportDetail:208-228` 解析后 :235 `productName: f[0]` 保留撇号。
复现：商品名以 `-`/`+` 开头（如 `-白菜`）→ CSV 单元格为 `'"' + "-白菜"` → 详情页显示 `' 白菜`。
影响：仅展示层失真（数量/金额不受影响，因为注入防御只在字符串开头触发且数字列不会以这些符号开头，除非负数）。
建议：解析侧对 `productName`/`supplierName` 去前导 `'`，或在 CSV 用 `='` 之外的转义方式。

**N9｜`getReportDetail` 汇总类 `wx:key="productName"` 撞 key**
`report-detail.wxml:125`；而 `generateSummaryReport:194` 的分组键是 `supplier|product` → 同商品多供应商会产生同名行。
影响：小程序列表渲染异常（丢行/闪烁）。
建议：改 `wx:key="index"` 或下发唯一行 id。

**N10｜`getPurchaseOrderDetail:111-113` 对 store_manager 不过滤供应商类报表元数据，供应商身份与 fileID 下发给店长**
`:107-110` 取全部 `report_file`（含 `scope_name` 供应商名、`file_url`）；chef 按 `report_scope` 过滤，store_manager 不过滤。
影响：店长可看到本店订单关联的供应商名称与报表 fileID；fileID 无法用于下载（`getReportFileUrl:50` 拦截供应商作用域），故非数据泄露级，属信息边界不一致。
建议：店长场景同样过滤 `report_scope === 'store'`，或明确文档化「店长可见供应商身份」为设计。

**N11｜`report-list.js` 的 `generateSummary` 入口对店长可见但必被拦（承接 06 §H1，本轮补充后端证据）**
`report-list.js:127-131` 前端拦 `['super_admin','purchaser']`，而 `generateSummaryReport:160` 允许 `store_manager` 且 :170-175 为其写了专属分支。
影响：店长点「生成汇总 ▸」必得「仅管理员可生成汇总报表」，且该入口在 `report-list.wxml:6` 无条件渲染。
建议：两者取一（放开前端或收紧后端）。

---

## 9. 遗留【待核实】

1. **`wx.openDocument` 对 `.csv` 的真实行为**（基础库 3.17.1）：是否报错码、是否静默失败、`fileType:'csv'` / `fileType:'xls'` 是否可绕过。决定 H4 修复方向是「服务端转 xlsx」还是「前端分流 + 文案兜底」。需真机实测。
2. **云存储权限模型**：`getReportFileUrl` 的三道防线建立在「客户端无法直调 `getTempFileURL` 越权」之上，但 `utils/cloud.js:243-252` / `:255-268` 确实存在客户端 `wx.cloud.getTempFileURL`（当前仅用于收货照片 `receive-list.js:99` 与凭证图 `purchase-detail.js:102`）。需确认控制台存储安全规则是否允许「任意 fileID 换取」。若允许，则任何知道报表 fileID 的用户可绕过 `getReportFileUrl` 直接下载 —— 而 fileID 会通过 `getReports:91-96` 与 `getReportDetail:252` 下发给合法查看者，**跨门店仍受限于「拿不到他人 fileID」**，但同门店内 `chef` 可绕过 `:53` 的 type 拦截下载 `store_receipt_price_report`。需控制台实测确认。
3. **`report_version_counter` 是否已在目标环境预建**：决定 `generateSummaryReport:56-67` 首次调用是否抛 `getNextVersion: 计数器更新失败` → 被 `:266-269` 吞成通用 `-1`（无定位信息）。README:111 已自知但需实测。
4. **归档「每单一份」vs 读取「按日聚合」的产品拍板**：决定 N3/H1 改读取侧还是改生成侧（若业务本意是「供应商看当日汇总」，则应新建聚合类 type 而非让读取侧偷换粒度）。
5. **`order_qty` 就地覆写是否为预期**：`dataService:544-547` 同时写 `order_qty` 与 `approved_qty`，两者恒等 → `order_qty` 语义从「申请量」漂移为「批准量」。需业务确认是否应保留原始申请量字段（影响 N3 的可修复性）。

---

**本轮工作量**：全读 24 个文件约 5260 行代码 + 3 份旧文档共 1563 行（03 全读、06/08 读报表相关章节）；新发现 P1 五项（N1-N5）、P2 六项（N6-N11）；旧【待核实】清单 19 项 → 18 项闭环、1 项转真机；更正旧文档 1 处事实错误（汇总类 `report_id` 前缀 `RPT_DSRPT_` → `RPT_DS_`/`RPT_MS_`）；遗留【待核实】5 项（净新增 3 项）。落库点独立复核：`collection('report_file').add` 全项目精确 14 处（`createPurchaseOrder` 2 + `createReceipt` 4 + `dataService` 7 + `generateSummaryReport` 1），覆盖 8 种 `report_type`。
