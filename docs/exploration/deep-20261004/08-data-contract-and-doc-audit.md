# 08 · 种子数据契约 + 历史文档校验（2026-10-04 第 8 号代理）

> **范围**：`seed-data/`（16 文件）逐行全读 + 项目根 6 份文档 + `docs/exploration/` 历史报告抽样 + 当前代码定点复验（`dataService` / `createReceipt` / `authService` / `getReports` / `getReportDetail` / `utils/meta.js` / `utils/cloud.js` / `project.config.json` / `采购流程图.html`）。
> **基线**：分支 `backup` @ `a1f7944`；工作区含未提交改动 `pages/report-list/report-list.js`、`project.config.json`（本报告已读到 `project.config.json` 的当前内容，其余按 HEAD 复验）。
> **方法**：不做业务代码全量分析。价值在于「文档说的那样」对上「代码实际那样」。每条结论带 `文件:行号`。
> **只读声明**：仅写本文件，未修改任何业务代码，未执行 git 操作。
> **抽样说明**：`batch1-cloudfunctions-data.md`(1258 行)、`batch2-purchase-flow.md`(750)、`controller-horizontal-scan*.md`(187/407/1031)、`full-scan-01..08`、`rescan-R3..R10` 未逐行全读，仅读取其目录结构、结论表与本轮需复验的定点引用；`rescan-20261004-R2-data-contract.md` 与 `审查报告-2026-09-30.md` 的结论清单已完整提取。

---

## 1. 概览

### 1.1 本次最关键的三条结论

1. **2026-09-30 审查报告的 8 项 P0，当前代码已修复 7 项**（P0-1 / P0-2 / P0-3 / P0-5 / P0-6 / P0-7 / P0-8 均有明确修复证据行号；P0-4「report_version_counter 自增后回读」仅换了 CAS 写法，**未完全复验为已修复**）。修复集中在 4 个提交：`01f53fe`、`200cb63`、`dca5e6e`、`a346020`(B1)、`33ce694`(B2)。
2. **`rescan-20261004-R2` 的 36 项新增问题中，复验仍有 8 项存活**，全部是「低烈度但结构性」的：`getReports` 不过滤 `status`、异常类型字典 3 份拷贝缺 `missing_price`、4 处在途状态字面量不同步、内部用户可读供货商定向消息、`basis_date_type` 写 10 读 0、seed 三种格式并存、`category` 集合无写入路径、幽灵/死状态未清。
3. **seed-data 已与 10-04 的代码契约漂移约 12 处**：最严重的是 `purchase_order_item` 仍把手动商品与档案商品混在一单（`PO20260806001` 含 `MANUAL_001`），与当前「提交时前端自动拆为两单」的 S9 设计直接冲突——导入后会造出服务端已禁止的数据形态。

### 1.2 工具与行数

- 全读：seed-data 16 个文件（含 3 份 .md）、`README.md`、`log.md`、`review.md`、`审查报告-2026-09-30.md`（章节+P0/P1 全量条目）、`业务模糊点确认清单.md`（27 个章节标题+状态标记全量）。
- 定点读：`dataService`（52 段）、`createReceipt`（18 段）、`authService`（8 段）、`getReports`（1 段）、`getReportDetail`（1 段）、`report-detail.js`（1 段）、`utils/meta.js`（全文）、`utils/cloud.js`（1 段）、`project.config.json`（全文）、`采购流程图.html`（状态词频抽样）。
- 未读完（明确标注）：`full-scan-01..08` 正文、`rescan-R3..R10` 正文、`batch1/2`、`controller-horizontal-scan*` 正文、`采购流程图.html` 全文结构。

---

## 2. 全部集合数据契约表

### 2.1 集合清单

| # | 集合 | seed 文件 | 格式 | 记录数 | 运行时独有集合 |
|---|---|---|---|---|---|
| 1 | `store` | store.json | NDJSON | 3 | — |
| 2 | `app_user` | app_user.json | NDJSON | 5 | — |
| 3 | `category` | category.json | NDJSON | 12 | — |
| 4 | `supplier` | supplier.json | NDJSON | 6 | — |
| 5 | `product` | product.json | NDJSON | 12 | — |
| 6 | `supplier_product_price` | supplier_product_price.json | NDJSON | 12 | — |
| 7 | `purchase_order` | purchase_order.json | NDJSON | 3 | — |
| 8 | `purchase_order_item` | purchase_order_item.json | NDJSON | 9 | — |
| 9 | `receipt` | receipt.json | **缩进单对象** | 1 | — |
| 10 | `receipt_item` | receipt_item.json | NDJSON | 3 | — |
| 11 | `report_file` | report_file.json | **JSON 数组** | 11 | — |
| 12 | `message` | message.json | NDJSON | 3 | — |
| 13 | `abnormal_record` | abnormal_record.json | NDJSON 单行 | 1 | — |
| 14 | — | supplier_test_user.jsonl | **JSONL** | 1 | 未被 README 导入清单收录 |
| 15 | — | — | — | — | `report_version_counter`（运行时自建，README 已说明） |

三种文件格式并存（NDJSON / JSON 数组 / 缩进单对象）已复验成立（见 §4.3）。

### 2.2 字段契约（`←` 表示外键，`(RT)` 表示仅运行时写入、seed 缺失）

**store**
| 字段 | 类型 | 必填 | 取值 |
|---|---|---|---|
| store_id | string(唯一索引) | ✅ | `S001..S003` |
| store_name | string | ✅ | — |
| store_code | string | ✅ | 与 store_id 同值（冗余） |
| status | int | ✅ | `1`=启用 / `0`=停用 |

**app_user**
| 字段 | 类型 | 必填 | 取值 |
|---|---|---|---|
| user_id | string | ✅ | `U000..U004` |
| username | string(唯一索引) | ✅ | 登录名 |
| name / mobile | string | ✅ | 手机号为 `138/139xxxx` 测试号 |
| role | enum | ✅ | `chef` / `store_manager` / `purchaser` / `super_admin` / `supplier` |
| role_label | string | ✅ | 中文镜像（与 `authService:18` 的 ROLE_LABELS 可能不同步） |
| default_store_id | string | 条件 | ← `store.store_id`；`supplier`/`purchaser`/`super_admin` 恒为空串 |
| default_supplier_id | string | 条件 | ← `supplier.supplier_id`；仅 `supplier` 角色有 |
| status | int | ✅ | `1`=在岗 / `0`=停用（停用即离职） |
| password_salt / password_hash / password_iterations | string/hex/int | ✅ | PBKDF2，iterations 固定 120000 |
| openid / sessions[] / session_token_hash / session_expires_at / 失败计数 | — | (RT) | seed 全缺；`authService:213-223` 建会话、`:305` 停用时清 `sessions:[]` |

**category**
| 字段 | 类型 | 取值 |
|---|---|---|
| category_id | **int** | 自增 1..12（**唯一用数字主键的集合**，其余均为字符串） |
| category_level_1 | enum | `kitchen` / `front` |
| category_level_1_name | string | 后厨 / 前厅 |
| category_level_1_icon / icon | string | emoji，可为空串；`utils/meta.js categoryIconMap` 做 emoji→iconClass 映射 |
| category_name / sort_no / status | string/int/int | status `1`/`0` |

**supplier**
| 字段 | 类型 | 取值 |
|---|---|---|
| supplier_id | string | `SUP001..SUP006` |
| supplier_name / contact_name / contact_phone / address | string | — |
| status | int | `1`/`0`（`SUP006` 为 `0` 暂停合作，被 `product.json P099` 引用以覆盖停用商品场景） |

**product**
| 字段 | 类型 | 取值 |
|---|---|---|
| product_id | string | `P001..P025` 跳号 + `P099` |
| product_name | string | 与 `manufacturer_name` 组合判重（`importProducts`） |
| category_level_1 | enum | `kitchen`/`front` |
| category_level_2_id | **int** | ← `category.category_id`（**跨集合 int 外键**） |
| category_name | string | 冗余快照 |
| unit / spec / manufacturer_name | string | manufacturer_name 默认「默认」 |
| default_supplier_id | string | ← `supplier.supplier_id`，可空 |
| status | int | `1`/`0` |

**supplier_product_price**
| 字段 | 类型 | 取值 |
|---|---|---|
| price_id | string | seed 为 `PRC001..PRC012`；**运行期为 `PRC_` + `Date.now()`**（`updateProductPrice`），同毫秒可冲突 |
| supplier_id / product_id | string | ← 双外键 |
| price | float | 含税；运费另算 |
| currency | string | 恒 `CNY` |
| effective_date | string `YYYY-MM-DD` | 价格有效期起点 |
| expiry_date | string\|null | **null 表示永久有效**（唯一用 null 表达语义的字段） |
| is_current | int | `1`/`0`；`PRC001` 是 `is_current:0` 的历史档，`PRC002` 为当前档 → **同一 (supplier,product) 允许多行历史** |
| updated_by | string | seed 恒 `system` |

**purchase_order**
| 字段 | 类型 | 取值 |
|---|---|---|
| purchase_order_id / order_no | string | 两者恒等（seed 双写）；运行为 `PO` + 日期 + 序号 + 随机后缀 |
| store_id / store_name | string | ← `store.store_id` + 冗余快照 |
| order_date | string `YYYY-MM-DD` | 业务日期（可补录过去） |
| created_by | string | ← `app_user.user_id` |
| order_status | **enum** | 见 §2.3 |
| remark | string | 可空 |
| is_manual / created_by_name / supplier_confirmations[] / missing_reports / verify_status / verify_amount / verify_voucher_file_ids[] / cancel_* / backfilled / original 审计字段 | — | **(RT) seed 全缺**；`is_manual` 是 #24 的显式隔离标记，seed 的 3 单全部缺该字段 |

**purchase_order_item**
| 字段 | 类型 | 取值 |
|---|---|---|
| item_id | string | `{order_no}_{行号}`（`PO20260806001_1`） |
| purchase_order_id | string | ← 主表 |
| product_id | string | ← `product.product_id`；**手动行为 `MANUAL_001`，在 product 集合中不存在**（设计如此） |
| product_name_snapshot / category_snapshot / unit_snapshot | string | 快照，`category_snapshot` 为「一级名-二级名」拼接（`后厨-蔬菜`） |
| supplier_id | string | ← `supplier.supplier_id`；**手动行为空串** |
| order_qty | number | 当前代码**不校验整数与上限**（R2 N26 存活） |
| is_manual | bool | `true`/`false`（#24 显式标记） |
| original_order_qty | number | **(RT)** `dataService:554` 首次改量时留档 |

**receipt**
| 字段 | 类型 | 取值 |
|---|---|---|
| receipt_id | string | `RCP` + 日期 + 序号 |
| purchase_order_id / store_id / store_name | string | ← + 快照 |
| receipt_date | string `YYYY-MM-DD` | 结算取价的日期依据 |
| received_by | string | ← `app_user.user_id` |
| receipt_status | enum | `completed`（seed）；`utils/meta.js` 含 `completed` 但**收货异常时订单侧写 `receipt_abnormal`**，二者不在同一字段 |
| batch_no / is_final / missing_reports / photo_file_ids[] | — | **(RT)** `createReceipt:480-481` 事务内写入；`photo_file_ids` **无删除路径**（R2 N34） |

**receipt_item**
| 字段 | 类型 | 取值 |
|---|---|---|
| receipt_item_id | string | `{receipt_id}_{行号}` |
| receipt_id / purchase_order_item_id | string | ← **双外键**（种子已验证全对得上） |
| product_id / product_name / supplier_id / unit_snapshot | string | 冗余快照 |
| received_qty / order_qty_snapshot | number | 累加 ≤ order_qty（超收硬拒） |
| price_snapshot | number | **收货日现价**（`createReceipt:353-367` 按 `effective_date <= 收货日` 取最新档）；无价为 0 |
| payable_flag | bool | `true`=计入账单；异常行可为 false |
| is_shortage / is_quality / is_wrong_item / is_missing_price / abnormal_id / abnormal_types[] | — | **(RT)** `createReceipt:503` 等 |

**report_file**
| 字段 | 类型 | 取值 |
|---|---|---|
| report_id | string | `RPT_SO_` / `RPT_SUO_` / `RPT_SR_` / `RPT_SRP_` / `RPT_SUR_` / `RPT_SURP_` + 单据号；补结算追加 `_S`，重生成追加 `_RG` |
| report_type | enum | `store_order_report` / `supplier_order_report` / `store_receipt_report` / `store_receipt_price_report` / `supplier_receipt_report` / `supplier_receipt_price_report` / `store_daily_summary_report` / `store_monthly_summary_report`（共 8 种，`utils/meta.js reportTypeMap` 全覆盖） |
| report_scope | enum | `store` / `supplier` |
| scope_id / scope_name | string | ← `store.store_id` 或 `supplier.supplier_id` |
| related_date | string | 语义随 `basis_date_type` 变：`order_date` / `receipt_date` |
| source_order_id | string | ← `purchase_order.order_no` |
| basis_date_type | string | **(RT 写 10 处 / 读 0 处)** — 契约死字段，见 §4.2 |
| file_name / file_url / file_version | string/number | seed `file_url` 恒空串（样例未真上传）；`file_version` 来自 `report_version_counter` |
| generated_by_system | bool | 恒 `true` |
| status | enum | `generated` / `superseded`（`dataService:421,1404` 标记旧版） |

**message**
| 字段 | 类型 | 取值 |
|---|---|---|
| message_id | string | `MSG` + 日期 + 序号 |
| type | enum | `order` / `receive` / `abnormal`（运行期更多：改量、催办、补结算提醒、缺价提醒等） |
| title / content | string | — |
| biz_id | string | ← 关联单据号（`PO...` / `RCP...` / `ABN...`） |
| recipient_user_id | string | ← `app_user.user_id`；**空串或缺失 = 广播**（`dataService getMessages` 用 `_.exists(false)` 兼容旧数据） |
| store_id | string | ← `store.store_id`；空串=全局 |
| read | bool | **全局已读（旧语义，仍被 `publicMessage` 读出）** |
| scope_type / scope_id / read_by[] | string/str/str[] | **(RT)** 供货商定向用 `scope_type:'supplier'` + `scope_id`；按人已读用 `read_by[]` |

**abnormal_record**
| 字段 | 类型 | 取值 |
|---|---|---|
| abnormal_id | string | `ABN` + 日期 + 序号 |
| receipt_id / purchase_order_id | string | ← 双外键 |
| product_id / supplier_id / store_id / store_name | string | ← + 快照 |
| type | enum | `shortage` / `quality` / `wrong_item` / `missing_price`（字典见 §4.4，**有 3 份拷贝且 1 份缺 `missing_price`**） |
| status | enum | `pending` → `processing` → `resolved` → `closed` |
| description / resolution | string | resolution 可空 |
| payment_decision | enum | **(RT)** `pay_received` / `reject`（`dataService:794`） |
| closed_by / closed_at | string/Date | **(RT)** |

### 2.3 `order_status` 全量枚举与「实际可达性」

`utils/meta.js statusMap` 列了 18 个键，但其中多个在云函数中**没有任何写入点**：

| 状态 | 有写入路径 | 证据 |
|---|---|---|
| `draft` | ✅ | `createPurchaseOrder` |
| `submitted` | ✅ | `createPurchaseOrder`（`dataService:504,543` 读） |
| `approved` | ✅ | `dataService:564` 审核通过 |
| `rejected` | ✅ | 审核驳回 |
| `report_generated` | ⚠️ **无写入点**，只在白名单里 | `createReceipt:235,413` / `dataService:872,1356,1443` / `getPurchaseOrders:74,94` |
| `partial_received` | ✅ | `createReceipt` 本批未收齐 |
| `received` | ✅ | `createReceipt` 收齐 |
| `receipt_abnormal` | ✅ | `createReceipt` 收齐但带异常 |
| `to_receive` | ⚠️ **死状态**：`meta.js` 有、`authService:642` / `updateProductPrice:43` / `confirmSupplierOrder:13` 白名单有，但**无任何写入点**，且已从 `createReceipt:235` 白名单移除 | 同左 |
| `pending_approval` | ⚠️ **死状态**：`authService:642` / `updateProductPrice:43` 有，无写入点 | `dataService:504,543` 仍在白名单里 |
| `cancelled` | ✅ | `cancelOrder` |
| `completed` | ⚠️ 只用于 `receipt.receipt_status`，`meta.js` 与 order 混表 → 语义混淆 | — |

R2 的 N32（`pending_approval` 与 `completed` 为死状态）**复验仍成立**。

---

## 3. 种子数据内部一致性校验

### 3.1 外键全对（无悬空引用）

| 检查项 | 结果 |
|---|---|
| `receipt_item.purchase_order_item_id` → `purchase_order_item.item_id` | ✅ `PO20260805001_1/2/3` 三行全命中 |
| `receipt_item.receipt_id` → `receipt.receipt_id` | ✅ 全部 `RCP20260805001` |
| `abnormal_record.receipt_id` / `purchase_order_id` | ✅ 双向命中 |
| `product.category_level_2_id` → `category.category_id` | ✅ 1/2/3/4/5/9/10/11 全命中，且 `category_name` 与 `category.json` 一致 |
| `product.default_supplier_id` → `supplier.supplier_id` | ✅ 含 `SUP006`(status 0)，与「停用商品 P099」场景自洽 |
| `supplier_product_price.supplier_id/product_id` | ✅ 12 行全部命中（`P001` 两行构成历史档） |
| `message.biz_id` → 单据 | ✅ `PO20260806001` / `RCP20260805001` / `ABN20260805001` 全命中 |
| `report_file.source_order_id` → 订单 | ✅ 3 单全部命中 |
| `purchase_order.created_by` → `app_user.user_id` | ✅ `U001`/`U002` |

### 3.2 数值链完全自洽（这是 seed 最扎实的部分）

- 土豆：`PO20260805001_1.order_qty=30` → `RCP20260805001_1.received_qty=28` → `abnormal_record` 文案「下单30斤，实收28斤：少到2斤」→ 三者互证。
- 价格快照 vs 当前有效价：P003 `PRC004`=2.8 ↔ `price_snapshot`=2.8；P007 `PRC006`=23 ↔ 23；P023 `PRC011`=8.5 ↔ 8.5。**全部一致**，可用作「价格快照按收货日现价」的回归基准。
- 报表：`RCP20260805001` 三条收货行分属 SUP001/SUP002/SUP005 → seed 恰有 `RPT_SUR_SUP001/002/005` 三对账单，供应商侧覆盖完整。

### 3.3 与当前代码契约冲突的 3 处（导入后会造出非法数据）

1. **混单未拆**：`purchase_order_item` 的 `PO20260806001` 同时含档案行（`P001/P006/P013`，`is_manual:false`）与手动行（`MANUAL_001`，`is_manual:true`，`supplier_id:""`）。当前设计是**提交时前端自动拆为两单**，后端保留「禁混单」兜底校验。导入该 seed 会造出后端已禁止的单据形态，且手动行的供应商侧报表应不存在（seed 也确实没有 `MANUAL_001` 的账单，但订单本身不合法）。
2. **`purchase_order` 缺 `is_manual`**：#24 拍板后关键链路显式过滤 `is_manual`；seed 三单全无该字段，依赖「`supplier_id` 为空」的旧隐式前提。
3. **`receipt` 缺 `batch_no` / `is_final`**：seed 的 `RCP20260805001` 被三条收货行全部收齐（28+10+3 对应 30+10+3，其中土豆为短收），按当前逻辑应为 `is_final:true, batch_no:1`。缺字段时按批收货报表与「最后一批」判定行为未定义。

### 3.4 时间字段格式

- 日期型（`order_date` / `receipt_date` / `related_date` / `effective_date` / `expiry_date`）统一 `YYYY-MM-DD` ✅
- 时间戳型（`created_at` / `updated_at` / `generated_at` / `closed_at`）统一 `YYYY-MM-DD HH:mm:ss` 空格分隔 ✅
- **风险点**：seed 是字符串，运行时是 `db.serverDate()` 的 Date 对象。`createReceipt:366` 用 `String(p.effective_date).localeCompare(...)` 比价档——若历史价格行的 `effective_date` 被写成 Date 对象，`String()` 会变 ISO 串导致比较错。当前仅字符串路径，**成立但脆弱**，建议统一归一化。
- `expiry_date: null` 是唯一的 null 语义字段（永久有效），`product.json` / `category.json` 中无 null，格式上不算问题。

---

## 4. 文档漂移发现（seed-data 文档 vs 10-04 代码）

### 4.1 `seed-data/README.md` — 3 处漂移

| # | 文档说法 | 10-04 实际 |
|---|---|---|
| 1 | 导入清单列 13 个文件 | `supplier_test_user.jsonl` 不在清单内，是**孤儿文件**（见 §5） |
| 2 | 「`created_at`…正式写入时云函数会使用 `db.serverDate()`」 | ✅ 成立 |
| 3 | 「供货商账号需关联 `default_supplier_id`（如 `supplier_test` 关联 `SUP001`）」 | ✅ 成立，且 `seed-data/README.md:45` 已加 2026-10-03 P0-1 安全提示（明文口令已轮换、不再入库）——**这条已从「缺陷」变成正确留痕** |

**结论：README 已同步到 10-03/10-04 状态，是本仓库维护得最好的一份文档。**

### 4.2 `product-import-template.md` — 1 处实质漂移

模板列 7 列（商品名称/一级分类/二级分类/单位/规格/厂家品牌/默认供应商），说明「分类、供应商均按名称精确匹配系统中已启用的数据，不会自动创建」。

- ✅ 与 `importProducts` 的「按名称精确匹配、不自动创建」一致。
- ✅ `dca5e6e` 之后的 `e2b364b`（supplier-miss 行计为 warning、显示完整错误清单、清理上传 xlsx）与模板第 5 条「最多显示前 10 条」**不一致**——模板说要截断到 10 条，代码已改为展示全部错误明细。
- ⚠️ 模板**未提及** `manufacturer_name` 默认「默认」之外的任何新字段，也未提及 Excel 只取第一个工作表以外的行为。
- ⚠️ R2 遗留【待核实 #7】仍未回收：`importProducts:60-209` 的必填校验是否与模板逐行一致，**本次未逐行复核**，标注未验。

### 4.3 seed-data 文档与代码的字段级漂移（共 12 处，按烈度排序）

| # | 漂移 | 烈度 |
|---|---|---|
| 1 | `purchase_order` 缺 `is_manual`（#24 显式隔离标记） | 高 |
| 2 | 混单未拆（§3.3-1） | 高 |
| 3 | `receipt` 缺 `batch_no` / `is_final` | 中 |
| 4 | `purchase_order_item` 缺 `original_order_qty`（`dataService:554`） | 中 |
| 5 | `app_user` 缺 `sessions[]` / `session_token_hash` / `session_expires_at` / `openid` | 中 |
| 6 | `message` 缺 `scope_type` / `scope_id` / `read_by[]`；`read` 仍是全局布尔语义 | 中 |
| 7 | `receipt_item` 缺 `is_shortage`/`is_quality`/`is_wrong_item`/`is_missing_price`/`abnormal_id` | 中 |
| 8 | `report_file` 缺 `basis_date_type` | 低 |
| 9 | `abnormal_record` 缺 `payment_decision` / `closed_by` / `closed_at` | 低 |
| 10 | `purchase_order` 缺 `created_by_name`（N23：`created_by` 的 `_id` 兜底永不生效，创建人显示裸 `_id`） | 低 |
| 11 | `supplier_product_price.price_id` 格式：seed `PRC001` vs 运行期 `PRC_` + `Date.now()` | 低 |
| 12 | `category` 集合**全仓 0 处写入**（`dataService:57,84` 与 `importProducts:111` 只读）→ 分类只能靠 seed 导入，无管理界面 | 高（能力缺口，非漂移） |

### 4.4 `ABNORMAL_TYPE_NAMES` 三份拷贝（复验：R2 N15 仍存活）

- `createReceipt:52`、`dataService:711`、`getReportDetail:12`。
- `getReportDetail:12-16` 复验内容：`{ shortage:'少货/缺货', quality:'质量问题', wrong_item:'错货' }` —— **确实缺 `missing_price`**。
- 后果：#11 缺价补账上线后，缺价异常在**报表详情页**显示裸英文 `missing_price`。

---

## 5. `supplier_test_user.jsonl` 专项

**内容**：1 行，即 `U004 / supplier_test` 供货商测试账号，含 PBKDF2 salt + hash + iterations=120000，手机号 `13800010001`。

1. **用途**：仓库内无任何脚本引用它（`scripts/` 已被 packOptions 排除、`.gitignore` 排除 `seed-data/`）。它是供货商账号的**样例导入/人工建号模板**，不是压测数据（只有 1 行，无法构成压测）。
2. **JSONL 与 JSON 混用原因**：NDJSON/JSONL（每行一个对象、无外层数组）是微信云开发控制台与批量导入脚本都吃的格式，也是仓库里 app_user/category/product 等 12 个文件的统一风格；**只有 `report_file.json` 用了 JSON 数组、`receipt.json` 用了缩进单对象**——即混用的不是「JSONL vs JSON」，而是「多数派 NDJSON vs 两个异类」。`supplier_test_user.jsonl` 用 `.jsonl` 后缀反而是全仓库唯一标注清楚格式意图的文件。
3. **安全提示（本轮新发现）**：`supplier_test_user.jsonl` 的 salt/hash（`62fd5e6a…` / `d9d2c549…`）**与 `app_user.json` 的 U004（`63d7ee55…` / `f1dc2eb1…`）已不一致**——`01f53fe`（rotate initial passwords）只轮换了 `app_user.json`，**漏掉了这个孤儿文件**。
   - R2 §10 曾离线复算出 `supplier_test_user.jsonl` 的哈希命中 `app_user.json` U004（当时的密码是 `Supplier@2026` 模板），那是「事实上的公开凭证」。
   - 现在两者已脱钩：**该文件里的凭据在仓库中已无任何对应用户，成为死凭据**，但它仍随 `seed-data/` 一起存在于 git 历史中。
   - 仍存在的风险：5 个种子账号的 hash 均为 PBKDF2-120000，离线字典攻击可行；且所有 `mobile` 为 `138/139xxxx` 连续测试号，**非真实凭据**，实际暴露面低。
   - 建议：从 `seed-data/` 删除 `supplier_test_user.jsonl` 或在 `seed-data/README.md` 明确标注其已废弃。

---

## 6. 历史结论逐条复验

### 6.1 `审查报告-2026-09-30.md`（8 项 P0 + 20 项 P1）

**已修复（7/8 P0，9/20 P1 已复验）**

| 结论 | 修复证据 |
|---|---|
| **P0-1** 明文口令入库 + 超管不可收回 | `seed-data/README.md:45` 已加轮换留痕；seed 内无任何明文口令（仅哈希）；`authService:481-488` 现允许停用 `admin`，并加「必须另有在岗超管」护栏 |
| **P0-2** `settleReceipt` 重复计入已结算行 | `dataService:997` 注释「增量账单：只含本次解锁行，原 ⑥ 账单保持有效，不标 superseded」；`:917-921` 按 `_S` 后缀去重；`:1038` 补结算锁释放 |
| **P0-3** `is_final` / 订单终态用事务外过期快照 | `createReceipt:397,420-456` 事务内用新鲜 `txHistoryQty` 重算；`:480-481` 在事务内写 `batch_no`/`is_final`；`:428-432` 覆盖全部订单行历史 |
| **P0-5** 凭证 fileID 无校验 + 删除他人文件 | `dataService:1553-1556` 前缀 `vouchers/{orderId}/` 校验 + `:1555` 最多 9 张 + `:1597-1599` 只删通过前缀校验的本订单文件 |
| **P0-6** packOptions 缺失 | `project.config.json` 已含完整 `packOptions.ignore`（`_tmp_test`/`seed-data`/`scripts`/`cloudfunctions` + 4 个后缀/文件规则） |
| **P0-7** 手动单凭证核销永久不可达 | `dataService:1575` 门槛放宽为 `['received','receipt_abnormal','partial_received']`，`:1571` 注释说明了少货常态停在 `partial_received`、最终批带异常为 `receipt_abnormal` 的现实 |
| **P0-8** 带价报表页面合计 ≠ Excel 合计 | `pages/report-detail/report-detail.js:55-64`：`counted = rows.filter(r => r.payable !== false && !r.isManual)`，并生成 `excludedNote`「另有 N 行异常/不可付款行未计入合计（与下载文件口径一致）」 |
| **P1-3** `cancelOrder` 无条件覆盖 | `dataService:1353-1373` 事务内复查，`['partial_received','received','receipt_abnormal']` 拒作废；`:1363` 注释「无条件覆盖会把货已到钱应付的已收货订单作废」 |
| **P1-5 / P1-16** `is_shortage` 事务外 + 分批必然产生假短收 | `createReceipt:445-456` 事务内重算，非最终批 `items.forEach(item => { item.isShortage = false })` |
| **P1-7** 停用时未清 sessions | `authService:305` `sessions: []`；`:465` 注释「停用即可断会话…防止将来重新启用时旧会话复活」 |
| **P1-11** 结算取现价而非收货日现价 | `createReceipt:353-367` 按 `effective_date <= 收货日` 取最新档，同日多行优先 `is_current`，早于收货日无任何价档则走 `missing_price` |
| **P1-12** `auditOrder` 覆盖 order_qty，原下单量永久丢失 | `dataService:552-555` 首次改量留档 `original_order_qty`（仅首次，不随重复审核覆盖） |
| **N06** `missing_reports` 永不重置 | `dataService:1078-1079,1327-1328` 补生成成功后置 `false` |
| **N13(部分)** | 见下 |

**仍存在（复验存活）**

| 结论 | 当前证据 |
|---|---|
| **P0-4** `report_version_counter` 自增后回读是伪唯一版本号 | 4 处仍用同一模式（`createPurchaseOrder:82`、`createReceipt:77`、`dataService:365`、`generateSummaryReport:58`）。`33ce694` 提交名为 "CAS versioning"，但**未逐行复验是否已改为条件更新**——标注「部分修复，未完全复验」 |
| **P1-10** 服务端信任客户端 `payableFlag` | 未复验（`createReceipt` 的 payable 计算路径本轮未逐行读） |
| **P1-14 / P1-15 / P1-17 / P1-18 / P1-19 / P1-20** | 前端项，本轮未复验 |
| **P1-13** 门店停用后无法再启用 | `3558678` 提交名含 "inactive store support"，`:465` 附近的超管护栏已修；门店侧未逐行复验 |

### 6.2 `rescan-20261004-R2-data-contract.md`（P0×2 / P1×12 / P2×22）

**已修复**：N06（见上）。

**复验仍存活（8 项）**

| # | 结论 | 当前证据 |
|---|---|---|
| N02 | 供应商测试账号凭证 | 已「降烈度」：`supplier_test_user.jsonl` 与 `app_user.json` 已脱钩（§5），但死凭据仍在仓库 |
| **N13** | `getReports` 不过滤 `report_file.status` | `getReports/index.js:87-96` 复验：`where(query).count()` + `where(query).orderBy('generated_at').skip.limit.get()`，**query 中确实无 `status` 字段** → superseded 旧报表仍与 generated 混列、`total` 虚高、可下载已作废报表 |
| N15 | 异常类型字典 3 份拷贝，`getReportDetail` 缺 `missing_price` | `getReportDetail:12-16` 仅 3 键（§4.4） |
| N16 | 四处「在途状态」字面量不同步，均漏 `receipt_abnormal` | `authService:642` = `['draft','submitted','pending_approval','approved','report_generated','partial_received','to_receive']`；`updateProductPrice:43` 同；`confirmSupplierOrder:13` SHIPPABLE 另含 `to_receive`；`dataService:872` receivableStatuses 三态。**四份互不相同，且都含死状态 `to_receive`/`pending_approval`** |
| N17 | 内部用户可读供应商定向消息 | `dataService getMessages`：非 GLOBAL 角色走 `storeCondition = _.or([{store_id:''},{store_id:default_store_id},{store_id:_.exists(false)}])` —— `store_id:''` 仍命中供应商定向消息；且该分支不过滤 `scope_type` |
| N20 | seed 三种文件格式并存 | 复验成立（§2.1） |
| N21 | `basis_date_type` 写 10 读 0 | 复验：10 处写入（`createPurchaseOrder:394,443`、`createReceipt:612,645,694,729`、`dataService:438,479,1022,1223`），**全仓 0 处读取**；seed 全无该字段 |
| N31 | `category` 集合全仓 0 处写入 | 复验：仅 `dataService:57,84`、`importProducts:111` 三处**读**；无写入 → 分类无管理界面，只能靠 seed 导入 |
| N32 | `pending_approval` / `completed` 死状态 | 复验成立（§2.3），且 `to_receive` 也是死状态 |
| N30 | 10 个幽灵字段 | 未逐条复验，但 §2.3 的死状态已部分证实 |

**未复验（标注）**：N01（`dataService` 嵌套错误 → 会话过期不跳登录）、N03/N04/N05/N07/N08/N09/N10/N11/N12/N14/N18-N29/N33-N36。其中 N05 有间接观察：`_RG` 幂等 report_id 仍在使用（`dataService:1221,1248,1281,1308`），说明改成了「按 report_id 幂等」而非「标 superseded」。

### 6.3 三个时间点的演进

| 时间点 | 文档 | 性质 | 本轮判定 |
|---|---|---|---|
| 2026-09-30 | `审查报告-2026-09-30.md`（153 项缺陷，评级 B−「必须先修 P0」） | 静态审查，全部带 `文件:行号` | **高度可信且已被执行**：8 项 P0 修 7 项，修复提交的注释直接引用 P0 编号（`createReceipt:335` 写「P0-3/P1-5/P1-16」、`dataService:1553` 写「P0-5」、`createReceipt:353` 写「P1-11」）——说明修复是按这份报告逐条对照做的 |
| 2026-10-03 | `修复计划-2026-10-03.md` | 修复路线图 | 已落地为 6 个提交（`dca5e6e`→`01f53fe`→`200cb63`→`a346020`→`33ce694`→`a1f7944`）；`seed-data/README.md:45` 的回引也证明它被消费了 |
| 2026-10-04 | `rescan-20261004-R2..R10`（R2 新增 36 项） | 复扫 + 增量 | **仍有 8 项存活**，全部是「低烈度但结构性」的口径/字典/过滤问题，无一涉及资金闭环 —— 与 B1/B2 已完成的资金修复形成对照 |

---

## 7. 业务模糊点确认清单状态（27 章，`业务模糊点确认清单.md`）

**结论：24 条已拍板 + S9 全部 `[已定]`，仅剩 2 条明确 `[待确认]`、1 条需业务方重新确认。**

### 7.1 代码里已有答案（`[已定]`，本轮抽检均与代码一致）

| # | 拍板口径 | 代码证据 |
|---|---|---|
| 1 | chef 无验收资格 | `createReceipt:102` 角色白名单；`getReceipts` 对 chef 返空 |
| 2 | B2 先审批后收货 | `createReceipt:235,413` 白名单无 `submitted` |
| 3 | B3 分批收货 | `createReceipt:420-481` 事务内 `batch_no`/`is_final` |
| 4 | B4/B6 行级异常隔离 | `createReceipt:445-456` |
| 5 | 消息跨门店隔离 + 异常定向店长 | `dataService getMessages` 门店条件；`resolveAbnormal:809` 定向提醒 |
| 6 | 验收人取登录账号 | `createReceipt` 不信任前端传参 |
| 7 | 报表失败有补偿 | `dataService:1078-1079` 重置 `missing_reports` + 补生成入口 |
| 9 | 报表字段已补，`related_date` 语义不统一 | `basis_date_type` 正是为此而生的字段——**但它写 10 读 0（N21）**，即语义治理「立了字段没用起来」 |
| 10 | #10 收货日现价 | `createReceipt:353-367` |
| 11 | #11 缺价标异常 + 补价补账 | `createReceipt` `missing_price` 流程 + `dataService repriceReceipt` |
| 12 | #12 禁止自单自审 / 禁填 0 / 催办 | `dataService:504,543` 白名单 + `remindAudit` |
| 14 | #14 绝不超收 | `createReceipt:438` 事务内累加校验 |
| 17 | #17 软删除 | `authService:467-500` 停用即离职 |
| 18 | #18 草稿属门店资产 | `createPurchaseOrder` 同店店长代改 + `resolveActiveRecipient` |
| 20-24 | #20/#21/#23/#24 | `dataService:1391`（#23 作废重置 `verify_status` 为 none 留痕）、`is_manual` 显式过滤 |
| S1-S9 | 供货商链路 | `confirmSupplierOrder:12-13` 动作级白名单 |

### 7.2 仍然悬空（3 条）

| # | 条目 | 状态 |
|---|---|---|
| 15 | 异常处理的责任人与时效没定义 | `[待确认]` —— 且与 N08（`resolveAbnormal` 允许 store_manager 写 `payment_decision='pay_received'`，而 `settleReceipt` 限 GLOBAL_ROLES）叠加：付款裁决权已下放到店长，业务方尚未确认这是否符合预期 |
| 16 | 单据日期可回填任意过去日期 | `[待确认]` —— 代码已实现 `backfilled:true` 打标，但「是否应有回填上限」未拍板 |
| S3 | 供货商系统内消息触达 | ⚠️ `[待确认]`：文档自述「代码已超出 2026-09-20 拍板口径，需业务方重新确认」（三层触达已上线：订阅消息 + 首页通知条 + 消息中心） |

---

## 8. 采购流程图.html 对照

**状态词频抽样结果**：驳回 8、作废 7、凭证核销 6、部分收货 4、待核销 4、已收货 3、收货异常 1。

- ✅ **流程图与当前状态机基本一致**：含「部分收货」「收货异常」「凭证核销」「待核销」，说明它跟到了 S9 手动单凭证核销支线（`log.md` 17-14 记载提交 `a16218b`/`9b63dd6`/`e4b3c8e` 同步至 S9 最终版）。
- ✅ 无 `status` 英文代码字面量（图是给人看的，用中文标签而非状态码），这不算漂移。
- ⚠️ **未复验到**的节点（本次仅做词频抽样，未逐节点比对）：
  1. 缺价补账（#11）支线 —— 未在流程图文本中检出 `missing_price` / 「缺价」相关 token；
  2. 催办提醒（`remindAudit`）—— 未检出；
  3. 订阅消息三层触达 —— 未检出；
  4. 草稿店长代改（#18）—— 未检出。
  → 以上四项均为 2026-09-22 之后的新增业务，**流程图可能未同步**，建议对照第 8 节遗留项人工核对一次。
- 标注：`采购流程图.html` 全文结构未逐节点读完，本节结论仅基于词频抽样 + 状态枚举交叉。

---

## 9. 文档覆盖缺口

### 9.1 云函数覆盖度

19 个云函数均被至少一份历史文档覆盖。**覆盖最薄的三个**：

| 云函数 | 缺口 |
|---|---|
| `getSuppliers` | 仅被 R6/full-scan-04 一带而过，无独立扫描 |
| `getReportFileUrl` | 无独立扫描；`P0-5` 修的是写侧，**读侧的 fileID→URL 换取是否有路径校验未复验** |
| `importProducts` | R2 遗留【待核实 #7】未回收：必填校验与 `product-import-template.md` 是否逐行一致 |

### 9.2 从未被任何文档讨论过的东西

1. **`category` 集合无管理界面**（N31 复验成立）：`dataService:57,84`、`importProducts:111` 三处只读，全仓 0 处写入 → 分类只能靠 seed 导入，**没有任何文档把「新增分类」当作一个业务流程讨论过**。这是一个能力缺口，不是文档缺口。
2. **云存储生命周期**：除 `P0-5` 修掉了凭证越权删除外，`receipt.photo_file_ids`（N34）无删除路径、`reports/` 下的历史 CSV 无清理机制、`report_version_counter` 自动建集合的权限前置（README 第 6 条已提）——三者均无文档讨论。
3. **`supplier_product_price.expiry_date` 的清理**：`expiry_date:null` 表示永久有效，但代码从不主动把过期的 `is_current:1` 行翻成 0，也无过期提示。
4. **PBKDF2 参数强度**：iterations=120000 对 2026 年的离线攻击是否够用，无文档讨论。

---

## 10. 待确认清单

### 10.1 需要业务方拍板（3 条，§7.2）
1. #15 异常处理责任人与时效（叠加 N08 付款裁决权下放到店长）
2. #16 回填日期是否设上限
3. S3 供货商触达已超出原拍板口径，需重新确认

### 10.2 需要工程修复（按烈度）
1. `getReports` 补 `status:'generated'` 过滤（N13，一行改动，消除报表口径虚高与作废报表可下载）
2. `getReportDetail:12-16` 补 `missing_price` 键，并把 3 份 `ABNORMAL_TYPE_NAMES` 收敛到 `utils/meta.js`（N15）
3. 4 处在途状态字面量收敛为单一常量，并清掉死状态 `to_receive`/`pending_approval`（N16 + N32）
4. `getMessages` 内部用户分支补 `scope_type != 'supplier'` 或排除 `store_id:''` 的供应商消息（N17）
5. seed-data 按 §4.3 的 12 处漂移补齐（重点是 `purchase_order.is_manual`、拆掉混单、补 `batch_no`/`is_final`）
6. 删除或标注废弃 `supplier_test_user.jsonl`（§5）
7. `basis_date_type` 要么接进 `getReports` 的日期语义，要么删掉 10 处写入（N21）

### 10.3 本次明确未验（诚实标注）
- P0-4（`report_version_counter` 是否已改 CAS 条件更新）
- R2 的 N01/N03/N04/N07/N08/N09/N10/N11/N12/N14/N18-N29/N33-N36
- 审查报告 20 项 P1 中的 P1-4/P1-6/P1-9/P1-10/P1-13/P1-14/P1-15/P1-17/P1-18/P1-19/P1-20
- 全部 P2（85 项）与 P3（40 项）
- `full-scan-01..08`、`rescan-R3..R10`、`batch1/2`、`controller-horizontal-scan*` 正文
- `采购流程图.html` 逐节点比对（仅词频抽样）
- `importProducts` 校验与模板的逐行一致性（R2 遗留 #7）
