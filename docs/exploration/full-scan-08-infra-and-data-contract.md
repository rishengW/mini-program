# full-scan-08 · 基础设施 / 静态资源 / 种子数据 / 项目文档 — 数据契约交叉验证

- 扫描时间：2026-10-03
- 分支：`backup`（工作区未提交改动：`pages/report-list/report-list.js`、`project.config.json`）
- 定位：本批次负责**数据契约交叉验证**，不做业务流程重述（流程见 batch1/batch2）。
- 方法：逐个全读 15 个 seed 文件 + 配置/样式/脚本；再用 grep 在 19 个云函数里反查每个字段名的**读/写点**；最后用脚本做引用完整性与状态机一致性核对。
- 判读规则：只信代码与数据。凡文档/注释与实现不符，单独点出。

---

## 0. 文件覆盖清单

### A. 种子数据（15 个，全部全读）

| 文件 | 行/条 | 格式 | 一句话职责 |
|---|---|---|---|
| `seed-data/README.md` | 47 行 | md | 导入顺序（13 项）+ 5 个初始账号明文口令 + 3 条索引建议 + 4 条关联说明 |
| `seed-data/abnormal_record.json` | 1 条 | 单文档 JSON | 1 条 `shortage/pending` 收货短收异常 |
| `seed-data/app_user.json` | 5 条 | JSONL | 5 个账号（超管/厨师/店长/采购员/供货商）+ PBKDF2 哈希 |
| `seed-data/category.json` | 12 条 | JSONL | 后厨 8 类 + 前厅 4 类 |
| `seed-data/message.json` | 3 条 | JSONL | 提交/收货/异常 3 条门店消息 |
| `seed-data/product-import-template.md` | 31 行 | md | Excel 导入模板（列名/别名/必填/5 条规则） |
| `seed-data/product.json` | 12 条 | JSONL | P001–P025 跳号抽样 + P099 停用 |
| `seed-data/purchase_order.json` | 3 条 | JSONL | submitted / received / approved 各 1 |
| `seed-data/purchase_order_item.json` | 9 条 | JSONL | 3 单共 9 行，含 1 行手动商品 |
| `seed-data/receipt.json` | 1 条 | 单文档 JSON | 1 张 `completed` 收货单 |
| `seed-data/receipt_item.json` | 3 条 | JSONL | 1 张单 3 行明细（含 1 行短收） |
| `seed-data/report_file.json` | 11 条 | JSON 数组 | 唯一用数组格式的文件 |
| `seed-data/store.json` | 3 条 | JSONL | S001/S002/S003，全启用 |
| `seed-data/supplier.json` | 6 条 | JSONL | SUP001–SUP005 启用 + SUP006 暂停合作 |
| `seed-data/supplier_product_price.json` | 12 条 | JSONL | 11 条当前价 + 1 条历史价（is_current=0） |
| `seed-data/supplier_test_user.jsonl` | 1 条 | 单文档 JSON | **孤儿文件**：内容与 app_user.json 第 5 条逐字相同，代码 0 处引用，README 未登记 |

> 格式混用是事实：`.json` 后缀里既有 JSONL（10 个）、单文档对象（3 个）、JSON 数组（1 个）；唯一的 `.jsonl` 文件里装的却是单文档对象。逐个用 `json.loads` 校验过，**均无语法错误**（JSONL 逐行 0 失败）。

### B. 脚本与样式

| 文件 | 行/字节 | 一句话职责 |
|---|---|---|
| `scripts/build-icons.js` | 227 行 | 源：41 个内联 SVG path + 88 个「图标×颜色」变体 → 生成 icons.wxss 与预览页 |
| `scripts/icons-preview.html` | 52KB | build-icons.js 的浏览器预览产物 |
| `styles/icons.wxss` | 110 行 / 50KB | 生成的线性图标类表（88 个 `.icon-xxx-yyy` + 尺寸修饰类） |
| `app.wxss` | 301 行 | 全局变量/工具类；第 2 行 `@import "./styles/icons.wxss"` |

### C. 图标资源（9 个，逐个用 Read 看过图片本体 + System.Drawing 采样像素）

| 文件 | 尺寸 | 主色 | 风格 |
|---|---|---|---|
| `home.png` / `home-active.png` | 32×32 | `#999999` / `#00873E` | 线框房子 |
| `cart.png` / `cart-active.png` | 32×32 | `#999999` / `#00873E` | 线框购物车 |
| `report.png` / `report-active.png` | 32×32 | `#999999` / `#00873E` | **填充式柱状图 + 矩形边框**（与上两对风格不同） |
| `bell.png` / `bell-active.png` | **64×64** | `#999999` / `#00873E` | 线框铃铛（**尺寸与其余 6 个不一致**） |
| `login-logo.jpg` | 83KB | 绿色字 | 「新蓝湾慢生活」品牌 logo |

### D. 工程配置

| 文件 | 内容要点 |
|---|---|
| `project.config.json` | 仅 3 键：`simulatorPluginLibVersion` / `compileType:"miniprogram"` / `packOptions.ignore:[采购流程图.png]`（工作区未提交） |
| `project.private.config.json` | `libVersion 3.17.1`、`urlCheck:false`、`compileHotReLoad:true`、`showES6CompileOption:false`、`bigPackageSizeSupport:false` |
| `sitemap.json` | `disallow *`（全页禁收录） |
| `.gitignore` | 15 行，声明忽略 `node_modules/`、`_tmp_test/`、`seed-data/`、`.claude/` |
| `.claude/settings.local.json` | 6 行，allow 了 `PowerShell(git *)` |

### E. 项目文档（只读，用于漂移对照）

`README.md`(121 行) · `review.md`(91 行) · `log.md`(122 行) · `业务模糊点确认清单.md`(796 行) · `采购流程图.html`(312 行) · `采购流程图.png`(298KB，已被 git 追踪)

> **规模纠正**：任务背景说「20 云函数」，实际 `cloudfunctions/` 下 **19 个**目录（各含 `index.js` + `package.json`，无其他文件）。README 云函数一览表只列了 16 个，漏 `getProducts`、`getSuppliers`、`importProducts`。

---

## 1. 各集合实际字段集合表

类型记号：`s`=string、`n`=number、`b`=boolean、`nul`=null、`arr`=array、`obj`=object。

### store（3 条，字段全量一致）
`store_id s` · `store_name s` · `store_code s` · `status n` · `created_at s` · `updated_at s`

### app_user（5 条）
`user_id s` · `username s` · `name s` · `mobile s` · `role s` · `role_label s` · `default_store_id s` · `default_supplier_id s`（**仅 supplier 那 1 条有**） · `status n` · `password_salt s` · `password_hash s` · `password_iterations n` · `created_at s` · `updated_at s`

### category（12 条）
`category_id n` · `category_level_1 s` · `category_level_1_name s` · `category_level_1_icon s(emoji)` · `category_name s` · `sort_no n` · `icon s(emoji，可为 "")` · `status n`

### supplier（6 条）
`supplier_id s` · `supplier_name s` · `contact_name s` · `contact_phone s` · `address s` · `status n` · `created_at s` · `updated_at s`

### product（12 条）
`product_id s` · `product_name s` · `category_level_1 s` · `category_level_2_id n` · `category_name s` · `unit s` · `spec s` · `default_supplier_id s` · `manufacturer_name s` · `status n` · `created_at s` · `updated_at s`

### supplier_product_price（12 条）
`price_id s` · `supplier_id s` · `product_id s` · `price n` · `currency s` · `effective_date s` · `expiry_date s|nul` · `is_current n` · `updated_by s` · `created_at s` · `updated_at s`

### purchase_order（3 条）
`purchase_order_id s` · `order_no s` · `store_id s` · `store_name s` · `order_date s` · `created_by s` · `order_status s` · `remark s` · `created_at s` · `updated_at s`

### purchase_order_item（9 条）
`item_id s` · `purchase_order_id s` · `product_id s` · `product_name_snapshot s` · `category_snapshot s` · `unit_snapshot s` · `supplier_id s` · `order_qty n` · `is_manual b` · `remark s` · `created_at s`

### receipt（1 条）
`receipt_id s` · `purchase_order_id s` · `store_id s` · `store_name s` · `receipt_date s` · `received_by s` · `receipt_status s` · `created_at s`

### receipt_item（3 条）
`receipt_item_id s` · `receipt_id s` · `purchase_order_item_id s` · `product_id s` · `product_name s` · `supplier_id s` · `received_qty n` · `order_qty_snapshot n` · `unit_snapshot s` · `price_snapshot n` · `payable_flag b` · `remark s` · `created_at s`

### report_file（11 条，唯一 JSON 数组）
`report_id s` · `report_type s` · `report_scope s` · `scope_id s` · `scope_name s` · `related_date s` · `source_order_id s` · `file_name s` · `file_url s(全为 "")` · `file_version n` · `generated_at s` · `generated_by_system b` · `status s`

### message（3 条）
`message_id s` · `type s` · `title s` · `content s` · `biz_id s` · `recipient_user_id s` · `store_id s` · `read b` · `created_at s`

### abnormal_record（1 条）
`abnormal_id s` · `receipt_id s` · `purchase_order_id s` · `product_id s` · `supplier_id s` · `store_id s` · `store_name s` · `type s` · `description s` · `status s` · `resolution s("")` · `created_at s` · `updated_at s`

### 类型一致性抽查（任务重点）
| 项 | 结果 |
|---|---|
| 价格类 `price` / `price_snapshot` | 全部 `n`，无字符串价格 ✓（PRC006=23、PRC007=46、PRC009=59 为整数但仍是 number） |
| 数量类 `order_qty` / `received_qty` / `order_qty_snapshot` | 全部 `n` ✓ |
| id 类 | `category_id`/`category_level_2_id`/`sort_no` 是 `n`；其余所有业务 id 是 `s` ✓ |
| 状态开关 `status` / `is_current` | 全部用 `n`(1/0)，全库无 `b` 版 ✓ |
| 布尔 `is_manual` / `payable_flag` / `read` / `generated_by_system` | 全部 `b` ✓ |
| 日期 | 全部 `s`（`"YYYY-MM-DD HH:mm:ss"` 或 `"YYYY-MM-DD"`），全库无 Date 对象 ✓ |
| `expiry_date` | 11 条 `nul` + 1 条 `s` ✓（历史价 PRC001 带到期日） |

→ **类型层面无不一致**，这一点种子数据是干净的。

---

## 2. 数据契约不匹配清单（按集合）

### 2.1 `message` — 缺 3 个字段（其中 1 个是功能性缺口）

代码写入（`dataService/index.js:191-204`）：`message_id, type, title, content, biz_id, recipient_user_id, store_id, scope_type, scope_id, read, read_by, created_at`

| 种子缺的字段 | 代码位置 | 影响 |
|---|---|---|
| `scope_type` | 读：`dataService:625` `{ scope_type:'supplier', scope_id: default_supplier_id }` | **供货商消息查询条件字段缺失 → 永远查不到**。种子本就无 `scope_type='supplier'` 消息，所以**用种子数据完全无法演示供货商消息中心** |
| `scope_id` | 同上 | 同上 |
| `read_by` | 读：`dataService:636,656,674` | 有 `Array.isArray(...) ? : []` 兜底，**不炸**；但已读语义从「全局布尔」退化成「全员未读」，与种子里 `read:true` 的意图相反 |

反向：种子 `read` 布尔字段代码仍兼容读（`dataService:638` `!!message.read || readBy.includes(userId)`），不算冗余。

**ID 格式漂移**：种子 `MSG20260806001`，代码生成 `'MSG' + Date.now() + 8位hex`（`dataService:189`）。不影响功能（只做等值查询），但**种子 ID 不具备代码的抗碰撞性质**。

### 2.2 `report_file` — 缺 3 个字段 + 2 类样本缺失

代码写入（`createReceipt:567-569`、`createReceipt:650-651`、`dataService:431-433`、`dataService:1163-1166`、`generateSummaryReport:237-254`）比种子多出：`basis_date_type`、`total_amount`、`item_count`。

- `basis_date_type`：种子全缺。**但代码从不读它**（只写），因此缺失无功能影响 —— 属写读不对称字段。
- `total_amount` / `item_count`：只有日/月汇总（`generateSummaryReport:252-253`）才写，种子无 ⑤ 样本，故缺得「合理」。
- **样本缺失**：无 `status:'superseded'`（改量重发会把旧版置 superseded，`dataService:416`），无 `store_daily_summary_report` / `store_monthly_summary_report`。
- `file_url` 全为空串，`getReportFileUrl:46` 是**按 `file_url` 反查**：传空 `fileId` 会命中第一条种子记录再走 `getTempFileURL([''])` 失败。非越权（权限校验仍在），但语义混乱。

**report_id 前缀与代码完全吻合**（`RPT_SO_` / `RPT_SUO_<sid>_` / `RPT_SR_` / `RPT_SRP_` / `RPT_SUR_<sid>_` / `RPT_SURP_<sid>_`，对应 `createPurchaseOrder:365,414`、`createReceipt:567,600,649,684`）✓

### 2.3 `receipt` — 缺 5 个字段，且 1 条记录违反代码不变式

代码写入（`createReceipt:431-441`）：`receipt_id, purchase_order_id, store_id, store_name, receipt_date, backfilled, received_by, receipt_status, overall_remark, photo_file_ids, batch_no, is_final, created_at`

种子缺：`backfilled`、`overall_remark`、`photo_file_ids`、`batch_no`、`is_final`。
前三个有 `|| ''` / 空数组兜底；**`batch_no` 与 `is_final` 是 B3 分批收货的核心字段，缺失意味着这张种子收货单无法参与「批次号续接」逻辑**（`createReceipt` 生成批次号时会重新数）。

### 2.4 `receipt_item` — 缺 4 个字段，其中 1 个直接改变业务结论

代码写入（`createReceipt:449-467`）比种子多：`is_manual`、`is_shortage`、`is_quality_issue`、`is_wrong_item`。

- `is_manual`：缺 → `!item.is_manual` 为 true → 视为非手动 ✓ 兜底正确。
- **`is_shortage` / `is_quality_issue` / `is_wrong_item`：缺 → `getReportDetail:18-24` 的 `getAbnormalTypeNames()` 返回空数组 → 报表详情里该行 `abnormal:false`、`abnormalStatus:'正常'`**。
  → **这是本批次最重要的契约缺口**：种子里 `RCP20260805001_1`（土豆 28 < 30）明明是一条短收异常行，`abnormal_record` 也建了 `ABN20260805001`，但**在收货报表详情页它会被显示为「正常」**，因为判定源是 receipt_item 的三个布尔字段而不是 abnormal_record 表。

### 2.5 `purchase_order` — 缺 23 个字段（全部有兜底，但整条链路不可演示）

代码会写入/读取而种子缺失的字段：

`delivery_date`、`backfilled`、`is_manual`、`verify_status`、`verify_amount`、`verify_voucher_file_ids`、`request_id`、`created_by_name`、`submitted_at`、`audit_remark`、`audited_by`、`audited_at`、`approved_qty`(在 item 上)、`supplier_confirmations`、`missing_reports`、`cancel_reason`、`cancelled_by`、`cancel_requested`、`cancel_requested_by`、`cancel_request_reason`、`cancel_requested_at`、`verify_note`、`verify_submitted_at`、`verify_reject_note`、`verify_cancel_note`

读点抽样：`delivery_date`（`dataService:422,463` 有 `|| ''`）、`created_by_name`（`dataService:422`、`getPurchaseOrderDetail:68` 回查兜底）、`supplier_confirmations`（`getSupplierOrders:52` `|| {}`）、`verify_status`（`dataService:1309` `&&` 短路保护）、`missing_reports`（`dataService:1019` 条件更新，非读）。

→ **结论：无一会导致 undefined 崩溃**，代码的兜底纪律很好。但**代价是**：种子无法演示凭证核销、取消申请、供货商确认、改量重发、缺报表补生成这五条链路的任何一环。

### 2.6 同名不同义 / 语义冲突

| 字段名 | 出现位置 | 语义 |
|---|---|---|
| `category_snapshot` | `purchase_order_item` | `"后厨-蔬菜"`（一级名-二级名拼接串） |
| `category_name` | `product`、`category` | 只有二级名（`"蔬菜"`） |
| `status` | store/supplier/product/category/app_user | `1/0` 启用开关 |
| `status` | purchase_order | 订单状态字符串（`submitted` 等） |
| `status` | receipt | 收货状态（`completed`/`abnormal`） |
| `status` | abnormal_record | 异常处理状态（`pending`…） |
| `status` | report_file | `generated`/`superseded` |
| `created_at` / `updated_at` | 所有集合 | 可排序字符串，非 Date |

→ `status` 在 6 个集合里语义完全不同，这是本系统最大的**跨集合字段名复用风险**：任何 `where({status:1})` 与 `where({status:'pending'})` 的混写都可能静默错查。当前代码逐集合手写条件，未踩坑。

### 2.7 冗余字段（种子有 / 代码只写不读）

| 字段 | 位置 | 说明 |
|---|---|---|
| `currency` | supplier_product_price | `updateProductPrice:122` 写死 `'CNY'`，全库无读点 |
| `expiry_date` | supplier_product_price | `updateProductPrice:124` 恒写 `null`（S5 只允许当天生效），全库无读点 |
| `updated_by` | supplier_product_price | 只写 |
| `store_code` | store | 与 `store_id` 值恒等，仅写入 |
| `order_no` | purchase_order | 与 `purchase_order_id` 恒等 |

→ 无害，但 `expiry_date` 值得注意：**S5「不支持预约调价」拍板后，协议价表永久退化成「一商品一供应商一条当前价」**，`effective_date` 变成写入痕迹而非查询维度。`getProductPrices:59` 按 `effective_date desc` 排序仍成立。

---

## 3. 状态值覆盖度对照表

「代码有」= 在云函数或 `utils/meta.js` 里出现过的字面量。「种子有」= 出现在 seed 文件里。

### purchase_order.order_status（11 值）

| 代码有 | 种子有 | 说明 |
|---|---|---|
| `draft` | ✗ | createPurchaseOrder 草稿 |
| `submitted` | ✓ | PO20260806001 |
| `pending_approval` | ✗ | **幽灵状态：全库无写入点** |
| `approved` | ✓ | PO20260804001 |
| `rejected` | ✗ | auditOrder 通过参数写入 |
| `report_generated` | ✗ | **幽灵状态：全库无写入点** |
| `to_receive` | ✗ | **幽灵状态：全库无写入点** |
| `partial_received` | ✗ | createReceipt:509 动态写 |
| `received` | ✓ | PO20260805001 |
| `receipt_abnormal` | ✗ | createReceipt:509 动态写 |
| `cancelled` | ✗ | dataService:1303 写 |
| `completed` | ✗ | **幽灵状态：只出现在 `getSupplierOrders:14` 的 DONE 集合** |

→ 12 个值里种子覆盖 3 个（25%）。**且 4 个幽灵状态（`pending_approval`/`report_generated`/`to_receive`/`completed`）被 6 个云函数 + 3 处前端当成合法状态参与判断，却没有任何一处会写出它们** —— 详见问题清单 H-3。

### receipt.receipt_status（2 值）
`completed` ✓（唯一样本）｜`abnormal` ✗（`createReceipt:437` 有异常时写）

### abnormal_record.status（4 值）
`pending` ✓｜`processing` ✗（`dataService:745`）｜`resolved` ✗（`:770`）｜`closed` ✗（`:817`）

### abnormal_record.type（4 值）
`shortage` ✓｜`quality` ✗｜`wrong_item` ✗｜`missing_price` ✗（缺价补账 `dataService:1078` 依赖该类型做 `_.in(['pending','processing'])` 过滤）

### message.type（7 值，种子 3 值）
✓ `order` / `receive` / `abnormal`｜✗ `approval`（`dataService:566`）、`cancel`（`:1322,1373`）、`verify`、`price`

### report_file.status（2 值）
`generated` ✓｜`superseded` ✗

### report_file.report_type（8 值，meta.js:32-41）
✓ `store_order_report`、`supplier_order_report`、`store_receipt_report`、`store_receipt_price_report`、`supplier_receipt_report`、`supplier_receipt_price_report`｜✗ `store_daily_summary_report`、`store_monthly_summary_report`

### 启用开关类
`store.status` 全 1（**无停用门店样本**）｜`supplier.status` 5×1 + 1×0 ✓｜`product.status` 11×1 + 1×0 ✓｜`category.status` 全 1｜`app_user.status` 全 1（**无停用账号样本**，而 #17 软删除口径依赖 status=0）｜`supplier_product_price.is_current` 11×1 + 1×0 ✓

→ **样本量本身也偏小**：13 个集合共 66 条记录，其中 `receipt` 只有 1 条、`abnormal_record` 只有 1 条、`purchase_order` 只有 3 条。状态机 40 多个分支里，**种子数据实际只能触达约 1/3**。

---

## 4. 角色 / 账号关系还原

### 4.1 五种角色的实际绑定（全量）

| user_id | username | role | role_label | default_store_id | default_supplier_id |
|---|---|---|---|---|---|
| U000 | `admin` | `super_admin` | 超级管理员 | `""` | （无字段） |
| U001 | `chef` | `chef` | 门店下单人员 | `S001` | （无字段） |
| U002 | `manager` | `store_manager` | 店长 | `S001` | （无字段） |
| U003 | `admin_user` | `purchaser` | 管理员 | `""` | （无字段） |
| U004 | `supplier_test` | `supplier` | 供货商 | `""` | `SUP001` |

### 4.2 角色字符串逐一对照（大小写敏感）

代码里出现的全部角色字面量：`super_admin`、`purchaser`、`store_manager`、`chef`、`supplier` —— 与种子 5 个值**逐个精确匹配，无大小写或拼写偏差**。

分组常量：
- `authService:21` `STORE_ROLES = ['chef', 'store_manager']`
- `authService:22` `SUPPLIER_ROLE = 'supplier'`
- `dataService:8` `GLOBAL_ROLES = ['super_admin', 'purchaser']`
- `dataService:9` `MANAGEMENT_ROLES = ['super_admin', 'purchaser']`（与 GLOBAL_ROLES 完全同值，重复定义）
- `dataService:11` `VOUCHER_SUBMIT_ROLES = ['super_admin', 'purchaser', 'store_manager']`
- `importProducts:8` `MANAGEMENT_ROLES = ['super_admin', 'purchaser']`（第三处重复定义）

→ **`MANAGEMENT_ROLES` 在两个文件各定义一次、`GLOBAL_ROLES` 与 `MANAGEMENT_ROLES` 在同文件内定义两次**，共 4 份同值常量散布在 3 个云函数里。因为云函数是独立部署的目录，没有共享模块，改一处不会自动改其他处 —— 这是**角色白名单漂移的结构性风险**（例如未来加 `supervisor` 角色，需同步 4+ 处）。

### 4.3 role_label 一致性
`authService:14-20` 的 `ROLE_LABELS` 与种子 `role_label` 逐字一致（`门店下单人员`/`店长`/`管理员`/`超级管理员`/`供货商`）✓；且 `authService:57` 用 `user.role_label || ROLE_LABELS[user.role] || user.role` 三级兜底，种子缺失也不会崩。

### 4.4 账号 ↔ 门店/供货商 归属（**发现 2 处不自洽**）

- **S002 与 S003 是无主门店**：5 个账号里 chef/manager 都绑 S001，没有任何账号 `default_store_id = S002/S003`。跨店账号（purchaser/super_admin）虽能查询，但**无法登录为 S002 视角下单/收货**。
- **`PO20260804001` 无法由任何现存账号合法创建**：它属于 S002、`created_by: "U002"`，而 U002（陈店长）的 `default_store_id` 是 **S001**。`createPurchaseOrder:162-163` 明确拦截 `storeId !== user.default_store_id` 的非全局角色。
  → 即种子把一张 S002 订单挂在 S001 店长名下，**这条记录在当前代码下不可能产生**。
- `supplier_test` → `SUP001` 绿源蔬菜批发 ✓ 与 `seed-data/README.md:31` 描述一致。

### 4.5 会话字段全缺（预期，但需写明）

所有 19 个云函数的 `getSessionUser` 都是同一套：先查 `{ status:1, sessions:{token_hash} }`，兜底查 `session_token_hash`，再要求 `sessions[].expires_at` 或 `session_expires_at`（`dataService:21-43` 等 19 处完全同构）。

种子 app_user **一个会话字段都没有**：无 `sessions`、`session_token_hash`、`session_expires_at`、`login_fail_count`、`login_locked_until`、`last_login_at`、`openid`。

→ 导入后**第一次调任何业务接口必然 401**，必须先走 `authService.login`。这是正常设计（首次登录建会话），但意味着：**种子数据不能用来做接口级联调**，只能做「登录后看数据」的演示。附带影响：`openid` 缺失 → 供货商订阅消息（`dataService:279` `touser: user.openid`）对种子供货商不可用，README:68 已自知说明。

---

## 5. Excel 导入模板对照

`seed-data/product-import-template.md` ↔ `cloudfunctions/importProducts/index.js`

### 5.1 列名与别名（`importProducts:11-19` HEADER_ALIASES）

| 模板列名 | 模板别名 | 代码 aliases | 一致 |
|---|---|---|---|
| 商品名称 | 品名 | `['商品名称','品名']` | ✓ |
| 一级分类 | （无） | `['一级分类']` | ✓ |
| 二级分类 | 分类 | `['二级分类','分类']` | ✓ |
| 单位 | — | `['单位']` | ✓ |
| 规格 | — | `['规格']` | ✓ |
| 厂家/品牌 | 厂家、品牌 | `['厂家','厂家/品牌','品牌']` | ✓ |
| 默认供应商 | 供应商 | `['默认供应商','供应商']` | ✓ |

→ **7 列 × 全部别名逐字吻合，无空格/全角/顺序问题**（`mapHeader:72-79` 用 `aliases.includes(text)` 全等匹配，列顺序无关，与模板「顺序不限」承诺一致 ✓）。

### 5.2 必填列

- 模板声明必填：商品名称、二级分类、单位（3 个 ✅）。
- 代码校验（`importProducts:103-104`）：`!('name' in colMap) || !('categoryName' in colMap) || !('unit' in colMap)` → **完全一致** ✓。
- 逐行必填（`:141-142`）只查 `name` 与 `unit`，**不查 categoryName 的逐行值**，而是靠 `:146-147` 「二级分类不存在则该行失败」兜住。行为等价，表述略有差异。

### 5.3 规则对照
| 模板 | 代码 | 一致 |
|---|---|---|
| 只支持 .xlsx，第一个工作表 | `:93` `XLSX.read(buffer)` + `:97` `Sheets[SheetNames[0]]` | ✓ |
| 全空行跳过 | `:139` `if(!name && !unit && !categoryName) continue` | ✓ |
| 分类/供应商按名称精确匹配，不自动创建 | `:146` `c.category_name === categoryName`；`:166` `s.supplier_name === supplierName` | ✓ |
| 名称+厂家判重，跳过不覆盖 | `:125,155-159` `name\|manufacturer` | ✓ |
| 一级分类仅作重名辅助 | `:148-151` | ✓ |
| 厂家留空默认「默认」 | `:154` | ✓ |
| 供应商匹配不到留空不阻断 | `:165-169` | ✓ |
| 失败明细最多显示前 10 条 | `:204` `errors.slice(0, 50)` | **✗ 代码取 50 条** |

### 5.4 文档漂移（2 处）
1. **错误条数上限**：模板第 31 行说「最多显示前 10 条」，代码 `importProducts:204` 实际返回前 **50** 条。
2. **示例数据在种子分类里不存在**：模板示例行用了「叶菜类」「禽类」两个二级分类，但 `category.json` 的 12 个二级分类里没有这两个（蔬菜/肉类/海鲜水产/调料干货/粮油/酒水饮料/冻品/豆制品/纸品/餐具/清洁用品/包装材料）。且示例把「蔬菜」写在**一级分类**列，而种子里「蔬菜」是二级分类（一级是「后厨」）。
   → **模板示例行会 100% 导入失败**（`二级分类「叶菜类」不存在`），且一级分类列的取值与种子口径错位。这是会直接把用户劝退的文档缺陷。

---

## 6. 图标链路三方对照

### 6.1 PNG 图标（assets/icons/ ↔ app.json ↔ wxml）

| 文件 | app.json tabBar | wxml 引用 | 结论 |
|---|---|---|---|
| `home.png` / `home-active.png` | ✓ `app.json:46-47` | — | 双向一致 |
| `cart.png` / `cart-active.png` | ✓ `:52-53` | — | 双向一致 |
| `report.png` / `report-active.png` | ✓ `:58-59` | — | 双向一致 |
| `bell.png` / `bell-active.png` | ✓ `:64-65` | `pages/index/index.wxml:14` 动态 `{{unreadMsg>0 ? 'bell-active' : 'bell'}}.png` | 双向一致 |
| `login-logo.jpg` | — | `pages/login/login.wxml:4` | 双向一致 |

→ **9 个文件全部被引用，无任何「引用了但不存在」，也无「存在但无人引用」**。链路完整。

### 6.2 SVG 图标类（wxml ↔ styles/icons.wxss）

- 页面实际用到 **50 个不同** `icon-{name}-{color}` 类，`icons.wxss` 定义了 **88 个**。
- 双向 grep 校验：**使用的 50 个全部已定义；定义的 88 个全部被页面用到**（无孤儿类、无悬空引用）。
- 变体由 `scripts/build-icons.js:71-160` 的 `VARIANTS` 数组驱动，`icons.wxss` 首行标注「由脚本生成，请勿手改」✓，生成逻辑与实际文件头一致（`.icon` 基础类 + `.icon-xs/sm/lg/xl/xxl/inline` + 88 变体）。

### 6.3 状态/报表图标映射（utils/meta.js）

- `meta.js:32-41` `reportTypeMap` 8 类报表各配一个 `iconClass`：`icon-clipboard-primary`、`icon-package-success`、`icon-tag-warning`、`icon-factory-purple`、`icon-truck-teal`、`icon-chart-magenta`、`icon-calendar-blue`、`icon-calendar-days-mint` —— 全部在 `icons.wxss` 中存在 ✓。
- `meta.js:49-53` `categoryIconMap` 13 个 emoji → 图标名。种子 `category.icon` 用到的 🥬🥩🦐🧂🍚🍺🧊🍽️🧹📦 全部在映射表内 ✓；`🍳` 也映射了（用作一级分类图）；空串 → `''`（无图标）✓。

### 6.4 发现

1. **一级/二级分类图标体系不一致**：二级分类走「emoji 存库 → `getCategoryIconBase` 映射成 SVG」（`purchase-create.js:114`、`product-manage.js:40`），一级分类也走同一条映射（`category_level_1_icon = '🍳'` → `chef`）。但种子 front（前厅）的 `category_level_1_icon` 是**空串** → 「前厅」一级 Tab **没有图标**，「后厨」有 → 两个一级 Tab 视觉不对称。
2. **手动商品的一级 Tab 图标硬编码**：`purchase-create.wxml:127-128` 写死 `icon-chef-*`（后厨）与 `icon-armchair-*`（前厅），与数据驱动的 `category_level_1_icon`（front 为空）口径不一致 —— 同一处页面上「档案商品的前厅」无图标、「手动商品的前厅」有扶手椅图标。
3. **注释与实现不符**：`meta.js:31` 注释「emoji 图标已全面下线」，但 emoji 仍作为 `category.icon` / `category_level_1_icon` 的**存储值**留在数据库里当图标键用，只是展示时翻译成 SVG。下线的是展示层，不是存储层。
4. **两套图标体系并存**：tabBar/登录页用 9 个真实 PNG（位图，32×32 与 64×64 混排），页面内用 88 个 SVG data-URI。风格上 PNG 是「线框 + 1 组填充」，SVG 是纯线性 —— **report 那组 PNG 是填充式，与 home/cart/bell 三组线框不一致**；`bell` 是 64×64，其余 6 个是 32×32，tabBar 里会看到铃铛笔画偏细。

---

## 7. 样式与工程配置

### 7.1 app.wxss

- `@import "./styles/icons.wxss"`（`app.wxss:2`）唯一一处全局引入，无重复引入 ✓。
- 结构：CSS 变量（`--color-*` / `--radius-*` / `--shadow-*`）→ 通用布局（`.container`/`.flex-*`）→ 卡片 → 标签 → 按钮 → 列表 → 表单 → 空状态 → 分割线 → 文本修饰。无重复类名定义。
- **无全局 reset**（没有 `* {}`、没有 `view/text` 通配），**无 z-index 覆盖**，**无 position 全局规则**（`.submit-bar` 等定位类在各页面 wxss 内定义，未污染全局）。→ 全局样式层很干净，不会影响业务的可疑规则。
- `page {}` 只设字体/字号/颜色/背景/`box-sizing`（`app.wxss:5-40`），合理。

### 7.2 project.config.json（工作区有未提交修改）

当前内容只有 3 个键。`git diff` 显示本次改动是**新增了 `packOptions.ignore` 排除 `采购流程图.png`**（9 行新增 1 行修改）。

风险项：
1. **缺 `cloudfunctionRoot`**：全库 grep `cloudfunctionRoot` 命中 0 处。微信开发者工具靠这个字段识别云函数根目录；缺失时 `cloudfunctions/` 下的 19 个目录不会被识别为可右键部署的云函数，而会被当作普通代码打进小程序包（20 个目录 × index.js 全部进包）。README:107 的部署步骤依赖它。
2. **无 es6 / minified 开关**：这两个键默认在 `project.private.config.json`（开发者工具本地化配置）里，当前 private 配置里有 `showES6CompileOption: false`，但没显式写 `es6` / `minified` → 依赖默认值（均为 true）。**建议显式写出**，避免不同机器的默认值差异。
3. `urlCheck: false`（private 配置）：开发期关闭域名校验，**上线前必须打开**，否则请求非白名单域名会失败。当前无提醒。
4. `bigPackageSizeSupport: false`：主包 2MB 限制不放开。当前 `assets/` + `cloudfunctions/`（若误打进包）有超限风险 —— 这也是第 1 项的实际后果。
5. `simulatorPluginLibVersion: {}`：空对象，无害。

### 7.3 sitemap.json
`{action:'disallow', page:'*'}` 全页禁收录 ✓。
→ **这是最保守也最正确的配置**。供应商后台、报表页、登录页都不会被微信搜索收录，符合 B2B 采购系统「不希望被外部索引」的诉求，无放开风险。
→ 副作用：**小程序无法通过搜索被搜到**，只能靠转发/扫码/入口。README 未提及这一点是刻意为之。

### 7.4 .gitignore（15 行）与实际仓库状态矛盾

声明忽略：`node_modules/`、`_tmp_test/`、`seed-data/`、`.claude/`、`.DS_Store`、`Thumbs.db`。

实际：
- `git ls-files seed-data` 返回 **15 个文件全部已被追踪**。→ **`.gitignore` 第 7-8 行「本地种子/敏感数据」的声明对这批文件完全无效**（说明是先入库后被 `-f` 强加，或先 add 后写 ignore）。
- `采购流程图.png`（298KB）**已被 git 追踪**，且**不在** `.gitignore` 里；`project.config.json` 的 `packOptions.ignore` 只影响小程序打包，**不影响 git**。
- `.claude/` 被 ignore ✓（`settings.local.json` 确实未入库）。

### 7.5 明文口令入库

`seed-data/README.md:23-29` 以表格形式列出 5 个初始明文口令（`Admin@2026`、`Chef@2026`、`Manager@2026`、`Purchaser@2026`、`Supplier@2026`），该文件被 git 追踪且不受 `.gitignore` 约束。README:21 强调「app_user 只保存 PBKDF2 哈希」指的是数据文件层面确实干净（app_user.json 里只有 `password_salt`/`password_hash`/`password_iterations`），**但文档层面的明文口令与数据同处一个被追踪目录**。

### 7.6 .claude/settings.local.json
6 行，`permissions.allow` 里有一条 `PowerShell(git *)` —— **通配放行全部 git 子命令**，比另两条精确到具体 `node --check` 命令的写法宽得多。低风险但值得收紧。

### 7.7 云环境 ID 硬编码
`app.js:2` `const CLOUD_ENV = 'cloud1-d3gezx51aca79d9bb'` 硬编码在被打进包的前端代码里并被 git 追踪。`project.config.json` / `project.private.config.json` 里**均无 env 声明**，所以这是唯一的环境来源。开发/生产环境切换需要改代码重新打包，无配置化路径。

### 7.8 工作区未提交改动评估

| 文件 | 改动 | 评估 |
|---|---|---|
| `project.config.json` | 新增 `packOptions.ignore` 排除 `采购流程图.png`（9 行） | 合理。文件末尾缺换行符（`\ No newline at end of file`），建议补 |
| `pages/report-list/report-list.js` | 3 处 `?.` → 显式 `&&`（`:42`、`:69-70`、`:145`） | 合理，兼容性修复。**已全量核查**：改完后前端再无真正的可选链 —— `utils/cloud.js:234` 的 `?` 只出现在正则字面量 `/\.[a-zA-Z0-9]+(?:\?.*)?$/` 里，是正则量词，不受影响 |

---

## 8. 业务模糊点确认清单逐条对照表

> 全文 796 行、26 个条目（0–9、B11、B12、S1–S9、14–24）。本节的判定只认代码：凡文档给的行号与当前代码不符，标「行号漂移」；凡文档说的结论被代码推翻，标「已漂移」；凡文档说「未定」而代码里其实已经有实现的，标「文档过期」。

### 8.1 逐条对照

| # | 模糊点 | 代码里现在的实际答案 | 文件:行号 | 判定 |
|---|---|---|---|---|
| 0 | 角色对照表 | 5 角色 `ROLE_LABELS`；`STORE_ROLES`/`SUPPLIER_ROLE`/`GLOBAL_ROLES`/`MANAGEMENT_ROLES`/`VOUCHER_SUBMIT_ROLES` 5 组常量 | `authService:14-22`、`dataService:8-11`、`importProducts:8` | 一致（行号漂移约 2 行） |
| 1 | 厨师无验收资格 | `createReceipt:164` 白名单 `store_manager/super_admin/purchaser`；门店归属 `:174-180`/`:225-227`/`:233`；`getReceipts:50-52` chef 返回空；`getPurchaseOrderDetail:64-66`、`:85-97`（不下发供应商名）、`:111-113` | 见左 | 一致；**新边界未记**：`getReports:50-55`/`:79-82` 对 chef 硬锁 `report_type='store_order_report'`，chef 看不到日/月汇总，与 #1 表格「查看门店范围报表 ✅」口径不同 |
| 2 | 必须先审批后收货 | `createReceipt:228-230` 事务外、`:392-396` 事务内复查 | 见左 | 一致 |
| 3 | 支持部分收货 | `historyQtyMap :252-262`、累计校验 `:277-279` + 事务内复查 `:398-419`、空批次拦截 `:293-298`、`batch_no :300-304`/`:421-427`/`:439`、`is_final :372-379`/`:440`、`partial_received :508-512` | 见左 | 一致；口径略偏：received 拦截在 `:305-307` 与 `:387-391` **两处**，非仅事务内 |
| 4 | 短收行级隔离 | 短收按累计判定 `:322-328`；`payableFlag :348-370`；补结算 `dataService.settleReceipt:870-982` | 见左 | **已漂移**：④`:583-584`、⑥`:664-665` 在本批「无任何可付款行」时**整表不生成**，且该路径**不打 `missing_reports`**（只有 catch 分支 `:694-726` 打）→ 分批复货若某供应商本批全为短收行，则该供应商无 ⑥ 账单且管理员看不到缺报表提示。另有残留字段 `:736` `priceReportsSkipped: hasAbnormal` 与现行口径矛盾 |
| 5 | 消息中心按门店/角色过滤 | `getMessages:612-641`（recipient `:617-621`、supplier `:623-625`、门店 `:626-633`）；`createMessage:187-206`；`markMessageRead:643-663`；`markAllMessagesRead:665-681` | 见左 | 一致；**未全覆盖**：`createReceipt:708-722`「收货报表生成失败」、`dataService:1321-1328`「采购单已作废」、`:1372-1378`「收到取消申请」、`:792-798`「待补结算提醒」**均无 `recipientUserId`** → 门店广播（cancel 类会广播给厨师）。「异常类定向店长」口径只覆盖了异常本身 |
| 6 | 验收人以登录账号为准 | `createReceipt:232` `user.name \|\| user.username`，落库 `:436` | 见左 | 一致 |
| 7 | 报表失败有补偿 | 打标记 `createReceipt:694-726`；补生成入口实为 **5 条**：`regenerateReceiptReports:1105-1272`、`regenerateOrderReports:988-1023`、`repriceReceipt:1035-1103`、`settleReceipt:870-982`、`repriceReceipt` 复用补生成 | 见左 | 一致 + **两个缺口**：① `dataService` 只清 `purchase_order.missing_reports`（`:1019-1020`、`:1268-1269`），**全项目无代码清 `receipt.missing_reports`**（已 grep 确认）→ 补生成后「缺报表」标签不消失；② `:709` 用 `getSuperAdminId` 只发超管，purchaser 收不到（`createPurchaseOrder:441-451` 同） |
| 8 | 撤回/作废 | `cancelOrder:1279-1330`（有收货拒废 `:1293-1296`、允许状态 `:1297-1299`、tx `:1301-1319`、①② superseded `:1315-1318`）；`requestCancel:1333-1378`（条件更新 `:1357-1370`） | 见左 | 一致 + **执行死路**：`requestCancel` 允许 `partial_received/to_receive`（`:1348`），但 `cancelOrder` 对这两状态硬拒（`:1293-1296`）→ 管理员确认后必然报错，申请与执行不闭环。另 `cancel_requested` 无清除路径，一单只能申请一次 |
| 9 | 报表字段与 related_date | ①`createPurchaseOrder:356`、②`:404`、③④⑤⑥信息头 `createReceipt:540-543`；`basis_date_type` 全库 14 处写入 | 见左 | 一致；**描述不准 2 处**：② 不含门店与经办人（门店为行内列 `:405`）；补结算账单信息头 `dataService:949` 只有单号/门店/收货日期/备注，**无下单日期/期望到货/验收人/批次** |
| B11 | 日/月汇总 | 角色 `generateSummaryReport:160-162`、周期 `:163-164`、店长强制本店 `:168-176`、类型 `:226-227`、写入 `:237-255` | 见左 | 一致；**文档过期**：文档第 301 行称「getReports 白名单、meta.js reportTypeMap 均未纳入 summary 类型」——实际 `getReports:68-72`、`utils/meta.js:39-40` **均已纳入**，该缺口已关闭。另汇总 `report_id :239` 无随机后缀（仅文件名 `:231` 有），同店同日并发生成会撞 id |
| B12 | 多设备登录 | 登录 `authService:210-230`（过期过滤 `:213-214`、push `:215`、上限 5 挤出 `:216`）；旧字段兼容 `:220-223`、openid `:217-229`；登出仅删当前设备 `:269-286`；改密清空全部会话 `:300-310`/`:428-435`/`:455-465`；停用断会话 `:473-496` | 见左 | 一致；**残留**：`setUserStatus` 停用只清 `session_token_hash`/`session_expires_at`（`:490-493`），**不清 `sessions` 数组** → 重启用后旧会话记录仍在库（靠 `status:1` 与过期时间兜底，实际不可用但数据脏） |
| S1 | 供货商"已发货"窗口 | `CONFIRMABLE:['submitted','approved']`、`SHIPPABLE` 多含 `partial_received`；`:62` 按 action 二选一、`:78-80` 条件更新、`:64-69` 要求明细里确有该供货商 | `confirmSupplierOrder:12-14` | 一致 |
| S2 | 改量后确认状态重置 | `regenerateApprovedOrderReports:385`，仅 `qtyChanged && 已有确认` 时 `supplier_confirmations:_.set({})`（`:400-411`）；缺报表补生成传 `false`（`:1015`）；**`cancelOrder:1301-1319` 完全未动 supplier_confirmations** | 见左 | 一致（行号漂移） |
| S3 | 供货商消息触达 | `notifySuppliersNewOrder:296-346` 写站内（`:323-331`）+ 订阅消息（`:269-293`，模板 ID 空 `:244`）；`supplier-home.js:51-61` 未读数 | 见左 | 已实施（订阅休眠）+ **跨角色泄漏见 H-5** |
| S5 | 协议价当天生效 | `:80-85` `priceDate !== today` 直接拒绝；`:106-131` 事务内旧价 `is_current:0` 新价 `:1` 且仍写 `effective_date` | `updateProductPrice` | 一致（`effective_date` 空壳仍在） |
| S6/S7/S8 | 确认标签 / 拒收进度 / partial_received 归类 | `getPurchaseOrderDetail:83-97` 非 chef 补 `supplier_name`、`:96` 写入；`getSupplierReceipts:78-97` join 异常表、`:90-95` 回带裁决、`:110` 挂 abnormals；`getSupplierOrders:14` DONE 已排除 `partial_received` | 见左 | 一致；小瑕疵 2 处见 L-21/L-22 |
| S9 | 手动商品双断链 | 强制拆单 `createPurchaseOrder:262-265` + 前端自动拆两单 `purchase-create.js:342,356-375`；订单级 `is_manual :282`、`verify_status :284`；手动行 ≤5 `:258-261`、supplier 强制空 `:239`；报表头打标 `:354-356`/`dataService:420-422`；日/月汇总排除 `generateSummaryReport:189-191` | 见左 | 拆单/定价/供货商不可见 ✅；**「待核销状态自动进入」❌ 见 H-4**；「特殊审批」仅 UI 标签，`auditOrder:482-597` 无 `is_manual` 分支 |
| 14 | 超收 | `:277-279` 事务外预检、`:410-418` 事务内复查抛 OVER_RECEIVE、`:746-747` 映射；前端 `receive-verify.js:152-158` | 见左 | 一致（口径是**跨批次累计** ≤ 下单量，非本批） |
| 15 | 异常责任人与时效 | 三动作权限完全一致 `:735`/`:751`/`:803`；裁决 `:766` `pay_received/reject`、`:768-777` 落库；`settleReceipt:897-917` 转回可付款 | 见左 | 权限/裁决一致；**无 SLA/超时/handler≠closer 校验**；文档正文「系统不会提醒」已过时（`:790-798` 发提醒），但**该提醒是门店广播非定向管理员** |
| 16 | 单据日期可回填 | `createPurchaseOrder:121-122` 判定、`:280` 写；`createReceipt:434-435` 收货单同标；下单页采购日期 picker 无 start（`purchase-create.wxml:80-83`） | 见左 | 一致 |
| 17 | 离职账号软删除 | `setUserStatus:473-496`（禁本人 `:479`、禁默认 admin `:484`、停用清 session `:489-493`）；`deleteUser:500-502` 纯转发 | 见左 | 一致（另见 L-20 sessions 数组不清） |
| 18 | 草稿属门店资产 | `:179-188` 本店店长代改/代提交、`:189-191` 禁换门店、`:291-296` `created_by` 沿用原值；`dataService:224-239` `resolveActiveRecipient` | 见左 | 一致 |
| 19 | 供应商报表按单生成 | `createPurchaseOrder:374-422` 每供应商每单一份、`:402` 版本号按 sid+date 递增、`:404` 文件名含 orderNo；改量重发 `dataService:459-479` 同粒度 | 见左 | 一致 |
| 20 | 待核销统计与催办 | ✅ 入口：`getPurchaseOrders:68-77` to_verify 虚拟筛选、`:91-92`/`:103-104` 计数、`purchase-list.js:88-91` tab、`index.js:76-88` 首页卡、`:155-166` 跳转；❌ **「不计入已完成」未落地** | `dataService:844-854` | **半条未实施，见 H-4** |
| 21 | 手动单特殊审批标识 | `approval-list.wxml:13`、`approval-list.js:53`、`approval-detail.wxml:16` 有标签；后端 `auditOrder` 无 `is_manual` 分支 | 见左 | 一致（隐式成立 + UI 标识） |
| 22 | 必须收齐才能核销 | `dataService:1459-1462` submit 仅放行 `order_status==='received'`；前端 `purchase-detail.js:91-95` 同步 | 见左 | 一致，但**存在死锁见 H-6** |
| 23 | 作废后核销状态 | `:1310-1312` 手动单 `verify_status→'none'` + `verify_cancel_note` 留痕；`:1301-1319` 事务不删云文件；`:1293-1296` received 类拒绝作废 | 见左 | 一致；留痕文案前端不可见见 L-23 |
| 24 | is_manual 显式过滤 | 已具备 9 处：`getSupplierOrders:71`、`getSupplierReceipts:54`、`createReceipt:583`/`:664`、`createPurchaseOrder:378`、`dataService:300`/`:443`/`:925`/`:1047`、`generateSummaryReport:191` | 见左 | **补生成收货报表路径遗漏，见 M-13** |

### 8.2 文档漂移汇总（共 4 类）

1. **行号整体漂移（最普遍）**：`createReceipt` 全线偏后约 40–70 行，`authService` 偏后约 60 行，`dataService` 大段漂移（小段如 `:8`/`:187-206`/`:627-633`/`:656-661` 仍准确）。原因是 S9 手动商品、`missing_price`、`backfilled` 等后加特性撑大了文件。**结论本身没有一条被推翻**，是引用失效。
2. **2 处须整段重写**：
   - #8「供应商仍不是系统用户（authService 仅四角色、无推送代码）」—— 供货商角色 `authService:19`、供货商登录 `:202-204`、定向消息、订阅消息、5 个独立云函数（`confirmSupplierOrder`/`getSupplierOrders`/`getSupplierReceipts`/`getProductPrices`/`updateProductPrice`）全部已实装。
   - B11「getReports/meta.js 未纳入 summary 类型」—— 已纳入（`getReports:68-72`、`meta.js:39-40`）。
3. **6 个真实缺口文档完全没记**：④/⑥ 在无可付款行时整表不出且不标 `missing_reports`；`receipt.missing_reports` 无清除路径；报表失败/作废/取消/待补结算 4 类内部消息未定向（广播给厨师）；`requestCancel`→`cancelOrder` 死路；`priceReportsSkipped: hasAbnormal` 残留字段；停用不清 `sessions` 数组。
4. **`业务模糊点确认清单.md` 与本报告交叉发现的种子数据问题**：清单里 S9 条目断言「混单不可产生」，但 `purchase_order_item.json` 的 PO20260806001 正是混单 —— 代码与种子数据冲突，而文档两边都当成「一致」。

### 8.2.5 例外：`采购流程图.html` 是当前最准的文档

与上面 4 类漂移相反，`采购流程图.html`（312 行）没有漂移：它引用了 `#12`(×6)、`#14`、`#15`(×2)、`#16`(×6)、`#21`、`#24`(×3)、`S1`(×3)、时间戳 `2026-09-28`(×3)，且「手动商品」出现 11 次、「凭证核销」6 次、「部分收货」4 次、「补结算」4 次，中文状态词（草稿/已提交/待审核/已通过/已驳回/待收货/部分收货/已收货/收货异常/已作废/已发货/待核销/已核销）全部能对应到代码状态字面量。**它是本次扫描中唯一保持与代码同步的文档** —— 建议以它为基准重写 `业务模糊点确认清单.md` 的状态与行号章节。

### 8.3 仍为真空白（代码里查无实现）

| 空白 | 依据 |
|---|---|
| 异常处理 SLA / 超时提醒 / 责任人分配 | 全文 grep 无 `sla`/`timeout`/`deadline` 相关字段 |
| 供货商端「拒收」独立动作 | 拒收是在门店侧收货时标 `wrong_item`，供货商只有 confirm/ship 两个动作（`confirmSupplierOrder:14`） |
| 审批时限（#12-③ 已拍板不做） | `approval_list` 无超时逻辑，只有催办消息 |
| 报表文件过期清理 / 云存储生命周期 | 无定时任务、无 `deleteFile` 路径（除凭证替换 `dataService:1482-1495`） |
| 供货商协议价批量导入 | 只有商品 Excel 导入（`importProducts`），价格只能逐条改 |

---

## 问题清单

### 高

**H-1 · 种子数据 PO20260806001 是当前代码不可能产生的混单**
- `seed-data/purchase_order_item.json:4`（`MANUAL_001` 与 P001/P006/P013 同单）↔ `createPurchaseOrder/index.js:263-264`
- 触发条件：任何人按 README 导入种子数据后查看这张单
- 影响：S9 拆单口径被种子数据直接证伪；该单订单级 `is_manual` 缺失，行级 `is_manual=true` 的手动行进不了凭证核销、也进不了带价报表，同时又不产生「手动商品专用单」的报表头标签 —— 三条链路口径全部错位
- 建议：把 PO20260806001 拆成两单（档案单 P001/P006/P013 + 手动单 MANUAL_001），手动单补 `is_manual:true`/`verify_status:'none'`

**H-2 · 短收异常在收货报表详情里显示为「正常」**
- `cloudfunctions/getReportDetail/index.js:18-24` 判异常只看 receipt_item 的三个布尔字段 ↔ `seed-data/receipt_item.json`（3 行全部缺 `is_shortage`/`is_quality_issue`/`is_wrong_item`）
- 触发条件：打开 RCP20260805001 的 ③/④ 报表详情
- 影响：种子里 28 < 30 的土豆短收行，`abnormal_record.ABN20260805001` 也确实建了，但报表详情会显示「正常」，`abnormalStatus` 不会是「收货异常」——**演示异常隔离能力时直接失败**
- 建议：种子 receipt_item 补三个布尔字段（第 1 行 `is_shortage:true`）

**H-3 · 状态机存在 4 个幽灵状态**
- `pending_approval`、`report_generated`、`to_receive`、`completed` —— 全库 grep 无任何 `order_status: 'xxx'` 写入点，却被 6 个云函数 + 3 处前端当合法状态参与判断（`createReceipt:228,392`、`confirmSupplierOrder:13`、`dataService:844,1297,1348`、`getPurchaseOrders:74,94`、`authService:632`、`updateProductPrice:43`、`getSupplierOrders:14`、`purchase-list.js:123`、`purchase-detail.js:71`、`receive-list.js:46`）
- 触发条件：无（永不产生），但会让「可收货」「可作废」「待办」等判断永久包含死分支
- 影响：状态字典 `utils/meta.js:1-19` 列出 18 个状态，实际可达约 8 个；`to_receive` 在 `getPurchaseOrders` 的 tab 列表里没有对应项，`partial_received`/`to_receive` 的单只能靠「全部」翻到
- 建议：要么补写入点，要么从全部白名单里删掉这 4 个值，并同步 `meta.js`

**H-4 · 手动单「待核销待办催办」在当前代码里等于不存在（S9 第 4 点 + #20 半条未落地）**
- `createReceipt/index.js:508-512`（事务内只写 `order_status`，从不写 `verify_status`）；`verify_status='pending'` 全项目唯一写入点是 `dataService:1466-1477`（人工提交凭证时）；`dataService:844-854` 首页统计 `receivedQuery` 无任何 `verify_status` 过滤，且 `:845` 注释明写「已完成与列表『已收货』tab 同口径」
- 触发条件：手动单全部批次收货完成
- 影响：手动单停在 `order_status='received'` + `verify_status='none'`，于是**同时计入「已完成」，又不进「待核销」tab**（`getPurchaseOrders:72` 只查 `verify_status='pending'`）——管理员在统计卡与列表上都看不到「已收齐但未交凭证」的手动单，S9 拍板的催办机制完全落空
- 建议：`createReceipt` 在 `isFinalBatch && order.is_manual` 时同事务写 `verify_status:'pending'`；或把 `received` 计数加上 `verify_status: _.neq('pending')`

**H-5 · 供货商定向站内消息泄漏给门店厨师/店长**
- `dataService/index.js:323-331`（`notifySuppliersNewOrder` 的 `createMessage` 只传 `scopeType/scopeId`，未传 `storeId`）→ `createMessage:197` 默认写 `store_id:''` → `getMessages:627-632` 对门店角色的 `storeCondition` 恒含 `{store_id:''}`
- 触发条件：任一订单审核通过后自动触发
- 影响：「您有新的采购订单…请确认接单」这条**写给供货商**的消息，门店厨师与店长在自家消息中心同样能看到（含下单门店名与商品项数）。`scope_type` 只挡住了供货商侧，没有反向屏蔽门店侧
- 建议：给 `getMessages` 的门店分支追加 `{ scope_type: _.neq('supplier') }`，或写供货商消息时不写空 `store_id` 而是显式排除

**H-6 · 带异常标记的手动单没有任何核销出口（#22 死锁）**
- `createReceipt:325-328`（自动判短收）→ `:470-474` 建异常记录 → `:509` `hasAbnormal=true` → 收齐时 `order_status='receipt_abnormal'` 而非 `received` → `dataService:1460` `verifyManualOrder` 拒绝提交凭证；而 `createReceipt:392` 虽允许 `receipt_abnormal` 继续收货，但此时累计实收已达下单量，任何 `receivedQty>0` 触发 `OVER_RECEIVE`（`:414`），纯标记批次又保持 `hasAbnormal` → 永远停在 `receipt_abnormal`；`cancelOrder:1293-1296` 又拒绝该状态
- 触发条件：手动单任一批次被标 shortage/quality/wrong_item
- 影响：该单**核销不行、作废不行、继续收货也不行**，金额永久无法回填，管理员无出口
- 建议：`verifyManualOrder` 的 submit 放行 `receipt_abnormal`（异常处理完再核销），或为手动单异常单独定义处理路径

**H-7 · requestCancel → cancelOrder 执行死路**
- `dataService/index.js:1348`（申请允许 `partial_received/to_receive`）↔ `:1293-1296`（执行硬拒这两个状态）
- 触发条件：对 `partial_received`/`to_receive` 的订单点「申请取消」，管理员再点「确认作废」
- 影响：必然报「该订单已有收货记录，不能作废」，申请流程白跑；且 `cancel_requested` 无清除路径（`:1361` 写，无对应清除），同一单无法二次申请
- 建议：`requestCancel` 的状态白名单对齐 `cancelOrder`，或为「部分收货后取消」设计独立路径

### 中

**M-1 · `receipt.missing_reports` 只写不清**
- `createReceipt:706` 写 true；`dataService:1019-1020`/`:1268-1269` 只清 `purchase_order`
- 影响：补生成成功后收货单上的「缺报表」标签永久存在，`getReceipts:85` 原样透传
- 建议：补生成成功后同步清 `receipt.missing_reports`

**M-2 · ④/⑥ 报表在无可付款行时静默不出且不打缺报表标记**
- `createReceipt:583-584`、`:664-665`
- 触发条件：分批复货，某供应商本批全部为短收/异常行
- 影响：该供应商拿不到带价账单，而 `missing_reports` 只在 catch 分支（`:694-726`）打 → 管理员「缺报表」提示看不到，缺口完全静默
- 建议：`payableItems.length === 0` 时也写一条 `missing_reports` 或产出空账单并标注「本批无可结算行」

**M-3 · 种子 PO20260804001 归属不自洽**
- `seed-data/purchase_order.json`（S002 单，`created_by: U002`）↔ `seed-data/app_user.json`（U002 的 `default_store_id` 是 S001）↔ `createPurchaseOrder:162-163`
- 影响：S002/S003 是无主门店，任何 S002 视角演示都无账号可用；这条订单在当前代码下不可能产生
- 建议：给 S002 加一个店长账号，或把该单改为跨店账号创建

**M-4 · 种子 4 处状态机不变式被破坏**
- `receipt.receipt_status='completed'` 但其下存在 pending 短收异常（应为 `abnormal`，`createReceipt:437`）；`purchase_order.order_status='received'`（应为 `receipt_abnormal`，`:509`）；`receipt` 缺 `batch_no`/`is_final`；`supplier_product_price` 无缺价样本（#11 `missing_price` 链路零覆盖）
- 影响：用种子数据无法演示异常处理、补结算、补价补账三条链路
- 建议：修正状态 + 补一批异常/缺价样本

**M-5 · 种子供货商消息与 ⑤ 汇总报表完全缺失**
- `seed-data/message.json` 3 条全缺 `scope_type`/`scope_id`（供货商查询条件 `dataService:625`）；`seed-data/report_file.json` 无 `store_daily_summary_report`/`store_monthly_summary_report`、无 `status:'superseded'`、`file_url` 全空
- 影响：供货商消息中心、日/月汇总报表、改量重发审计痕迹三条链路无法演示；⑤ 类报表 `file_url` 为空时 `getReportDetail:203-249` 静默返回空 rows（不抛错），与 `:244-247`「解析失败不能静默成空表」的注释意图相反
- 建议：补 1 条 `scope_type:'supplier'` 消息 + 1 条汇总报表样本（含 file_url）

**M-6 · 角色白名单常量 4 份重复定义**
- `dataService:8` `GLOBAL_ROLES`、`dataService:9` `MANAGEMENT_ROLES`、`dataService:11` `VOUCHER_SUBMIT_ROLES`、`importProducts:8` `MANAGEMENT_ROLES`，另加 `authService:21-22`
- 影响：云函数独立部署、无共享模块，加/改角色需同步 5 处，漏一处即静默越权或静默无权限
- 建议：抽成可复用的角色配置，或至少在同文件内合并 `GLOBAL_ROLES`/`MANAGEMENT_ROLES`

**M-7 · project.config.json 缺 `cloudfunctionRoot`**
- `project.config.json`（全文 3 键）
- 影响：19 个云函数目录不会被识别为可部署云函数，而是被当普通代码打进小程序包；`bigPackageSizeSupport:false` 使超限风险变实际
- 建议：补 `"cloudfunctionRoot": "cloudfunctions/"`

**M-8 · .gitignore 声明与实际追踪状态矛盾 + 明文口令入库**
- `.gitignore:7-8` 声明忽略 `seed-data/`，但 15 个文件全部已被追踪；`seed-data/README.md:23-29` 明文列出 5 个初始口令且被追踪；`采购流程图.png`(298KB) 被追踪且未被 ignore（`packOptions.ignore` 只影响打包）
- 影响：`git status` 上这批文件不会显示，维护者会误以为它们没入库；口令可被任何拿到仓库的人直接登录
- 建议：口径二选一 —— 要么把 `seed-data/README.md` 的口令移出仓库并轮换，要么删掉 `.gitignore` 里那行并明确「种子数据就是版本化资产」；`采购流程图.png` 建议移出或转外链

**M-9 · Excel 导入模板示例行必然失败**
- `seed-data/product-import-template.md:20-23`（示例用「叶菜类」「禽类」，且把「蔬菜」写在一级分类列）↔ `seed-data/category.json`（12 个二级分类里没有叶菜类/禽类；蔬菜是二级分类，一级是「后厨」）
- 触发条件：用户照模板示例导入
- 影响：100% 失败于「二级分类不存在」，且一级分类取值口径错位，直接把新用户劝退
- 建议：示例行换成种子分类里真实存在的组合

**M-10 · 报表失败通知只发超管**
- `dataService:709`（`getSuperAdminId`）、`createPurchaseOrder:441-451`（同）↔ 文档声称「发管理员定向消息」
- 影响：`purchaser`（赵采购）收不到缺报表/待补结算提醒，补生成职责落空
- 建议：改为 `MANAGEMENT_ROLES` 全量收件

**M-11 · 4 类内部消息未定向**
- `createReceipt:708-722`、`dataService:1321-1328`、`:1372-1378`、`:792-798`
- 影响：作废/取消/待补结算消息会广播给厨师，「异常类定向店长」口径未覆盖这些
- 建议：统一补 `recipientUserId`

**M-12 · seed-data/README.md 索引建议过期**
- `seed-data/README.md:35-37` 建议建 `app_user.session_token_hash` 索引 ↔ 实际主查询已是 `sessions.token_hash` 数组元素查询（19 处 `getSessionUser` 统一）
- 影响：真热点字段 `sessions.token_hash`、`purchase_order.purchase_order_id`、`purchase_order_item.purchase_order_id`、`receipt_item.receipt_id`、`report_file.source_order_id`、`report_file.file_url`、`supplier_product_price.(supplier_id,product_id)` 全部无索引
- 建议：刷新索引清单

**M-13 · #24「is_manual 双保险」在补生成收货报表路径上遗漏**
- `dataService/index.js:1173`（④ `payable_flag!==false && price_snapshot>0`）、`:1201-1207`（⑤⑥ 按 `supplier_id` 分组）、`:1233`（⑥ `supPayable`）**均无 `is_manual` 显式过滤**，与首发路径 `createReceipt:583`/`:664` 不对称
- 触发条件：管理员对一张含手动行的收货单执行「补生成收货报表」
- 影响：仍靠「`supplier_id` 为空 + 0 价」两条隐式前提排除。S9 升级路径（散货商建档后手动行携带 `supplier_id`）一旦启用，`dataService:1205` 的分组键 `item.supplier_id || 'unknown'` 会把手动行归到真实供应商名下，**手动商品重新泄漏进供应商账单**
- 建议：补生成路径与首发路径对齐，统一加 `is_manual: _.neq(true)` / `!item.is_manual`

**M-14 · 付款凭证上传无归属校验**
- `dataService/index.js:1445`（只 `filter(Boolean)`）、`:1464`（只要求非空）；前端 `purchase-detail.js:132` 限 3 张
- 对照：验收照片有 `createReceipt:211-215` 的 `receipts/{orderId}/` 前缀校验
- 影响：已登录的店长/采购员/管理员可把**任意 fileID**（包括自己上传到别处、或别的门店的）登记到（本门店的）任何手动单上，凭证链不可信
- 建议：补 `vouchers/{orderId}/` 前缀校验，与验收照片对称

**M-15 · 改量重发不再次通知供货商，门户数量口径变旧**
- `dataService/index.js:400-411`（改量只清 `supplier_confirmations` 并发内部消息给 `resolveActiveRecipient(created_by)`，未调 `notifySuppliersNewOrder`）
- 触发条件：管理员审核改量
- 影响：S3 的「新订单下推供货商门户」通道只在首次审核时走一次；改量后供货商门户看到的仍是旧数量，而内部已按新数量出报表
- 建议：`qtyChanged` 时同步刷新供货商侧数据可见性（至少发一条 scope_type='supplier' 消息）

**M-16 · 供货商侧异常类型文案缺 missing_price**
- `pages/supplier-receipts/supplier-receipts.js:56` 映射只有 `shortage/quality/wrong_item`
- 对照：`dataService:687` 有 `missing_price: '缺价待补'`、`createReceipt:52` 同名字典有 4 项
- 影响：缺价异常在供货商收货页显示裸英文 `missing_price`（`getSupplierReceipts:90-95` 会回带该 type）
- 建议：补齐第 4 项映射

### 低

**L-1** `getReportFileUrl:46` 按 `file_url` 反查，传空 `fileId` 会命中第一条 `file_url:''` 的记录（权限校验仍在，非越权，但语义混乱）。
**L-2** `business 汇总 report_id` 无随机后缀（`generateSummaryReport:239`，仅文件名 `:231` 有），同店同日并发生成会撞 id。
**L-3** `getReportDetail:12-16` 的 `ABNORMAL_TYPE_NAMES` 缺 `missing_price`（`dataService:683-689` 有）；当前该函数只从三个布尔派生不会产出 `missing_price`，但字典不对称。
**L-4** `expiry_date`/`currency`/`updated_by` 只写不读（`updateProductPrice:122-126`）；S5 拍板后协议价表退化成单条当前价。
**L-5** `seed-data/README.md:43` 称 PO20260806001 是「待收货订单」，实际 `order_status='submitted'`（待审核），不在 `getPurchaseOrders:74` 的 receivable 集合里。
**L-6** `seed-data/product-import-template.md:31` 说失败明细最多 10 条，代码 `importProducts:204` 取 50 条。
**L-7** `utils/meta.js:31` 注释「emoji 图标已全面下线」，但 emoji 仍作 `category.icon`/`category_level_1_icon` 的存储值。
**L-8** 一级分类图标不对称：kitchen 有 `🍳`，front 为空串 → 「前厅」Tab 无图标；`purchase-create.wxml:127-128` 又硬编码了 `icon-chef`/`icon-armchair`。
**L-9** tabBar 图标风格/尺寸不一致：`report` 组是填充式（其余 3 组线框），`bell` 是 64×64（其余 6 个 32×32）。
**L-10** `project.private.config.json` 无显式 `es6`/`minified`（依赖默认），`urlCheck:false` 上线前必须打开，无提醒。
**L-11** `seed-data/supplier_test_user.jsonl` 是 app_user 第 5 条的逐字副本，代码 0 处引用，README 未登记 → 孤儿文件。
**L-12** `.json` 后缀混装 JSONL/单文档/数组三种格式，唯一的 `.jsonl` 里装的却是单文档；逐个校验均无语法错误，但导入工具行为不确定。
**L-13** 种子 abnormal/message 的 id（`ABN20260805001`/`MSG20260806001`）与代码生成规则（拼接式 + 随机后缀）不一致，不影响等值查询。
**L-14** `.claude/settings.local.json:4` 通配放行 `PowerShell(git *)`，比同文件另两条精确命令宽得多。
**L-15** `README.md` 云函数一览表漏 `getProducts`/`getSuppliers`/`importProducts`（16/19）；任务背景的「20 云函数」实为 19 个。
**L-16** `utils/mock.js` 已不存在，但 `review.md:68-87` 与 `log.md:87-99` 仍在描述它对 27 个商品的操作（当前 `product.json` 只有 12 条）。
**L-17** `review.md:42` 与 `log.md:77` 写 canReceive 含 `submitted`，实际前后端都是 `['approved','report_generated','partial_received','to_receive']`。
**L-18** `采购流程图.html:99` 写「标记异常行（少货 / 质量 / 逆错）」——「逆错」应为「错货」，且漏了 `missing_price`（4 种异常只列了 3 种）。
**L-19** `app.js:122` `companyInfo: null` 从未使用。
**L-20** `authService` 停用不清 `sessions` 数组（`:490-493`），重启用后数据脏（靠 `status` 与过期时间兜底，实际不可用）。
**L-21** `purchase-detail.js:61` 供应商档案被删时，分组名兜底显示内部 `supplierId`（`item.supplierName || (sid ? sid : '未指定供应商')`），把内部 ID 泄露到界面。
**L-22** `getReports:50-55`+`:79-82` 把 chef 硬锁 `report_type='store_order_report'`，而 `:56-60` 的 store_manager 可看全部门店报表（含日/月汇总）——两个门店角色的报表可见面不对称，且 `getPurchaseOrderDetail:111-113` 是按 `report_scope` 放行的，同一页两种口径。
**L-23** `utils/cloud.js:139-169` `normalizePurchaseOrder` 未映射 `verify_cancel_note`，作废时的核销留痕文案前端看不到（数据在库里）。
**L-24** `confirmSupplierOrder:85-117` 供货商「标记发货」会向门店写一条站内消息（`type:'order'`、`store_id=订单门店`、`scope_type:''`），S1/S3 两条拍板记录都没提这条触达。
**L-25** `cancelOrder:1316-1318` 作废时只把 `store_order_report`/`supplier_order_report` 标 `superseded`，收货侧 4 类报表不标 —— 作废单的收货报表仍显示 `generated`。
**L-26** `业务模糊点确认清单.md` 内部矛盾：S9 正文保留 `:345`「推荐口径（待业务方确认）：允许混合下单」，与 `:321` 拍板的「强制拆单」及代码 `createPurchaseOrder:262-265` 直接冲突；`:333-345` 三段「现状/待确认」已被拍板取代但未标作废。另索引第 13 行仍标 `[待确认]`「无供应商无价格…纯线下」，但正文 `:525-527` 已自述被 S9 覆盖。
**L-27** `业务模糊点确认清单.md` 计数口径过时：写「12 处写入点补 `basis_date_type`」，实际 `report_file.add` 共 **14** 处、`basis_date_type` 出现 **14** 次（全覆盖）。
**L-28** `getSupplierOrders`/`getSupplierReceipts`/`getReportDetail` 对 supplier 角色返回 `-403` 的三处判定（`getReports:64-66`、`getReportFileUrl:49-54`、`getReportDetail:72-76`）分散且无共享函数，S4「补结算账单供货商不可见」靠三处各自实现。

---

## 跨批次待核实项

1. **`report_generated` / `pending_approval` / `to_receive` / `completed` 的历史写入点**：可能是早期版本的状态，后来被重构掉但白名单没清。需 `git log -p` 追。
2. **`receipt.missing_reports` 是否曾有过清除逻辑**：同上，需查历史。
3. **种子数据里 PO20260806001 混单是有意保留的旧样本还是漏改**：需与 batch2 的 S9 结论合并判断。
4. **`priceReportsSkipped: hasAbnormal`（`createReceipt:736`）是否被前端消费**：若前端还在读它，则 H-4 之外还有一个展示层残留。需查 `pages/report-detail` 与 `report-list`。
5. **`setUserStatus` 不清 `sessions` 是否为有意设计**：需确认「停用期间不登录」的隐含假设是否被运维接受。
6. **`missing_price` 在 `getReportDetail:12-16` 字典缺失是否影响 #11 补价补账展示**：需 batch2 的 `repriceReceipt` 结论配合。
7. **`report_file.file_url` 反查语义**：是否有前端会以空 fileId 调用 `getReportFileUrl`，需查 `pages/report-detail`。
8. **云开发环境是否允许 `add` 自动建集合**：决定 `report_version_counter`（`dataService:361-378`）在空环境下首次生成报表是否会失败。README:111 已自知说明，但需实测。
9. **`receipt_abnormal` 的完整出/入边**：本批次只查了手动单路径（H-6 死锁）。档案商品单进入 `receipt_abnormal` 后是否有同样问题，需确认 `cancelOrder:1293-1296` 对档案单的处理意图（文档说「货已到，走异常处理流程」，但 `createReceipt:392` 不允许该状态继续收货，异常处理完也没有自动改回 `received` 的代码）。
10. **S9 手动单「升级路径」是否要落地**：清单里是口径而非实体，代码无任何校验阻止手动行携带 `supplier_id`；一旦业务方决定允许散货商建档，M-13 的隐式前提全部失效。
11. **`verify_status` 是否本就该由收货驱动**：若产品意图是「手动单收齐即进入待核销」，则 H-4 是纯漏实现；若意图是「必须人工先交凭证」，则 `dataService:845` 的注释与文档 #20 结论都需要改。需业务方拍板。
12. **`supplier_confirmations` 在 `cancelOrder` 后是否应清除**：S2 只覆盖「改量」路径，作废路径未清（`dataService:1301-1319`），供货商侧会看到已作废订单的旧确认记录。

---

## 附：种子数据样本量与状态覆盖一览

| 集合 | 条数 | 覆盖的状态/分支 | 未覆盖 |
|---|---|---|---|
| store | 3 | 启用 | 停用 |
| app_user | 5 | 5 角色全 | 停用账号、多设备会话、登录锁定 |
| category | 12 | 后厨 8 + 前厅 4 | 停用分类 |
| supplier | 6 | 启用 + 暂停合作 | — |
| product | 12 | 启用 + 停用 | 缺价商品、无供应商商品 |
| supplier_product_price | 12 | 当前价 + 历史价 | 缺价（#11 零覆盖）、多供应商同商品 |
| purchase_order | 3 | submitted / received / approved | 草稿、驳回、部分收货、收货异常、作废、待核销、手动单 |
| purchase_order_item | 9 | 档案行 + 手动行 | 改量后 `approved_qty` |
| receipt | 1 | completed | abnormal、分批（batch_no>1） |
| receipt_item | 3 | 正常行 + 短收行 | quality、wrong_item、missing_price、手动行 |
| report_file | 11 | 6 类下单/收货报表、generated | 日/月汇总、superseded |
| message | 3 | order/receive/abnormal、已读/未读 | approval/cancel/verify/price、供货商定向、read_by |
| abnormal_record | 1 | shortage / pending | quality、wrong_item、missing_price、processing、resolved、closed |

→ 合计 66 条记录覆盖约 1/3 的状态分支。**用种子数据做端到端演示是够的，做回归测试不够**。

