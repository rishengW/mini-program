# A2 云函数读取路径勘察报告（报表 / 商品 / 价格 / 供应商 / 采购单收货单）

勘察日期：2026-10-04 ｜ 分支：backup ｜ 只读勘察，未改动任何代码

---

## 1. 文件清单与职责

| 文件 | 行数 | 职责 |
|---|---|---|
| cloudfunctions/generateSummaryReport/index.js | 280 | 门店日汇总/月汇总报表生成：拉 receipt → receipt_item → 按(供应商,商品)聚合 → 生成 CSV → 上传云存储 → 写 report_file |
| cloudfunctions/generateSummaryReport/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getReportDetail/index.js | 261 | 报表详情：按 report_type 从原始集合重建 rows（5 类分支），汇总类报表从 CSV 反解析 |
| cloudfunctions/getReportDetail/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getReports/index.js | 103 | 报表列表：按角色约束 query + 分页 + count |
| cloudfunctions/getReports/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getReportFileUrl/index.js | 64 | 报表文件临时下载链接：以 file_url 反查 report_file → 角色校验 → getTempFileURL |
| cloudfunctions/getReportFileUrl/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getProducts/index.js | 66 | 商品列表：分类/关键字过滤，停用商品仅管理角色可见 |
| cloudfunctions/getProducts/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getProductPrices/index.js | 89 | 供应商商品价格：供应商只见自己，管理角色可指定供应商，补商品名与单位 |
| cloudfunctions/getProductPrices/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/updateProductPrice/index.js | 138 | 改价：仅管理角色，仅支持当天生效，事务内切换 is_current 并新增价格行，支持 dryRun |
| cloudfunctions/updateProductPrice/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/importProducts/index.js | 213 | Excel 批量导入商品：SheetJS 解析、模板列映射、分类/供应商名称匹配、去重、逐条写入 |
| cloudfunctions/importProducts/package.json | 10 | 依赖 wx-server-sdk ~2.6.3 + xlsx ^0.18.5 |
| cloudfunctions/getSuppliers/index.js | 96 | 供应商列表：供应商角色只看自己，管理角色可查停用，附 product_count |
| cloudfunctions/getSuppliers/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getPurchaseOrders/index.js | 148 | 采购单列表（C 端）：角色+门店过滤、状态 tab 计数、状态筛选、分页、批量带明细 |
| cloudfunctions/getPurchaseOrders/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getPurchaseOrderDetail/index.js | 149 | 采购单详情（C 端）：主表+明细+供应商名+已收累计+关联收货单+关联报表 |
| cloudfunctions/getPurchaseOrderDetail/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getReceipts/index.js | 92 | 收货单列表（C 端）：店长限本店，chef 直接返回空集，批量带明细 |
| cloudfunctions/getReceipts/package.json | 9 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getSupplierOrders/index.js | 137 | 采购单列表（供应商端）：仅含自己供货的明细，隐藏未审核通过状态，内存排序分页 |
| cloudfunctions/getSupplierOrders/package.json | 10 | 依赖 wx-server-sdk ~2.6.3 |
| cloudfunctions/getSupplierReceipts/index.js | 119 | 收货明细（供应商端）：平铺返回自己的 receipt_item，join 收货单主表与异常记录，算 amount |
| cloudfunctions/getSupplierReceipts/package.json | 10 | 依赖 wx-server-sdk ~2.6.3 |

合计 14 个 index.js + 14 个 package.json = 28 个文件，2082 行。

---

## 2. action 路由表

本模块 14 个云函数**全部是单入口、无 action 字段分发**（`exports.main(event)` 直接执行唯一逻辑）。逐个列出：

| 云函数 | 入口行号 | event 参数 | 说明 |
|---|---|---|---|
| generateSummaryReport | 166 | authToken, period(daily\|monthly), date, storeId | 内部辅助：hashToken:8, getSessionUser:12, csvField:41, safePathPart:48, getNextVersion:53, isDate:82, getStoreReceipts:89, loadReceiptItems:113, loadProductCategoryMap:133, loadSupplierNameMap:151 |
| getReportDetail | 54 | authToken, reportId | 无 action；按 `report.report_type` 内部分流 5 类（:84 / :98 / :130 / :161 / :203）。辅助：ABNORMAL_TYPE_NAMES:12, getAbnormalTypeNames:18 |
| getReports | 39 | authToken, role, storeId, reportScope, reportType, relatedDate, page, pageSize | **role / storeId 解构后从未使用**（:43） |
| getReportFileUrl | 39 | authToken, fileId | |
| getProducts | 39 | authToken, categoryL1, categoryId, keyword, includeInactive | |
| getProductPrices | 39 | authToken, supplierId, productId, onlyCurrent | |
| updateProductPrice | 66 | authToken, supplierId, productId, newPrice, effectiveDate, updatedBy, dryRun | 内部辅助：countInflightOrders:44，常量 INFLIGHT_ORDER_STATUS:43 |
| importProducts | 82（`exports.main = main`:213） | authToken, fileID | 内部辅助：cellText:61, requireUser:52, mapHeader:67，常量 MANAGEMENT_ROLES:8, HEADER_ALIASES:11 |
| getSuppliers | 39 | authToken, status, keyword, includeInactive | |
| getPurchaseOrders | 39 | authToken, role, storeId, orderStatus, orderDate, createdBy, page, pageSize | **role 解构后从未使用**（:43） |
| getPurchaseOrderDetail | 40 | authToken, orderId | |
| getReceipts | 40 | authToken, role, storeId, receiptDate, page, pageSize | **role / storeId 解构后从未使用**（:44） |
| getSupplierOrders | 58 | authToken, confirmStatus, orderDate, page, pageSize | 内部辅助：deriveConfirmStatus:50，常量 HIDDEN_ORDER_STATUS:12, DONE_ORDER_STATUS:15 |
| getSupplierReceipts | 41 | authToken, page, pageSize | |

鉴权入口统一：`getSessionUser(event.authToken)` → 先查 `app_user.sessions[]` 数组（B12 多设备会话），未命中回退 `session_token_hash` 单字段，再校验 `status:1` 与 `expires_at`。该函数在 14 个文件中被**逐字复制 14 份**（见问题 L13）。

---

## 3. 数据契约

### 3.1 集合与字段

| 集合 | 关键字段 | 备注 |
|---|---|---|
| `app_user` | `_id`, `user_id`, `name`, `role`, `status`(1 启用), `default_store_id`, `default_supplier_id`, `sessions[].token_hash`, `sessions[].expires_at`, `session_token_hash`, `session_expires_at` | 会话按 `sha256(authToken)` 匹配 |
| `product` | `product_id`, `product_name`, `category_level_1`, `category_level_2_id`, `category_name`, `unit`, `spec`, `manufacturer_name`, `default_supplier_id`, `status` | |
| `category` | `category_id`, `category_name`, `category_level_1`, `category_level_1_name`, `status` | 二级分类存在同名可能 |
| `supplier` | `supplier_id`, `supplier_name`, `contact_name`, `contact_phone`, `status` | |
| `supplier_product_price` | `price_id`, `supplier_id`, `product_id`, `price`, `currency`, `effective_date`, `expiry_date`, `is_current`(0/1), `updated_by`, `created_at`, `updated_at` | **无版本号字段**；同日可存在多行 |
| `purchase_order` | `purchase_order_id`, `order_no`, `store_id`, `store_name`, `order_date`, `delivery_date`, `order_status`, `created_by`, `created_by_name`, `supplier_confirmations{supplierId:{status}}`, `verify_status`, `verify_amount`, `missing_reports`, `is_manual`, `cancel_reason`, `created_at` | `...order` 全量下发（getPurchaseOrderDetail:138） |
| `purchase_order_item` | `item_id`(=订单号_序号), `purchase_order_id`, `product_id`, `product_name_snapshot`, `category_snapshot`, `unit_snapshot`, `supplier_id`, `order_qty`, `is_manual`, `remark`, `created_at` | 手写行 supplier_id 为空串 |
| `receipt` | `receipt_id`, `purchase_order_id`, `store_id`, `store_name`, `receipt_date`, `backfilled`, `received_by`, `receipt_status`, `overall_remark`, `photo_file_ids`, `batch_no`, `is_final`, `missing_reports`, `created_at` | **一单可多张（分批收货）** |
| `receipt_item` | `receipt_item_id`, `receipt_id`, `purchase_order_item_id`, `product_id`, `product_name`, `supplier_id`, `received_qty`, `order_qty_snapshot`, `unit_snapshot`, `price_snapshot`, `payable_flag`, `is_manual`, `is_shortage`, `is_quality_issue`, `is_wrong_item`, `remark`, `created_at` | 无 receipt_date 字段 |
| `abnormal_record` | `abnormal_id`, `receipt_id`, `purchase_order_id`, `product_id`, `supplier_id`, `store_id`, `store_name`, `type`, `description`, `status`, `resolution`, `payment_decision`, `created_at`, `updated_at` | |
| `report_file` | `report_id`, `report_type`, `report_scope`, `scope_id`, `scope_name`, `related_date`, `source_order_id`, `basis_date_type`, `file_name`, `file_url`, `file_version`, `generated_at`, `generated_by_system`, `status`, `total_amount`, `item_count`, `has_abnormal`, `abnormal_summary`, `excluded_rows` | |
| `report_version_counter` | `_id`=`{reportType}_{scopeId}_{relatedDate}`, `count`, `updated_at` | CAS 取号 |
| `store` | `store_id`, `store_name`, `status` | |

### 3.2 状态枚举

- `purchase_order.order_status` 全库出现值：`draft`, `submitted`, `pending_approval`, `rejected`, `approved`, `report_generated`, `partial_received`, `to_receive`, `received`, `receipt_abnormal`, `cancelled`, `completed`。
  - **`to_receive` 在代码库中只出现在白名单数组，无任何写入点**（authService:642 / confirmSupplierOrder:12,13 / updateProductPrice:43）。
  - **`completed` 从未写入 `purchase_order.order_status`**，只作为 `receipt.receipt_status`（createReceipt:482）；但 `DONE_ORDER_STATUS`（getSupplierOrders:15）把它当终态处理 → 死状态。
- `report_file.status`：`generated`（全库唯一写入值）、`superseded`（dataService:425 审核改量后、dataService:1408 作废后批量打标）。
- `report_file.report_type`：`store_order_report`, `store_receipt_report`, `store_receipt_price_report`, `supplier_order_report`, `supplier_receipt_report`, `supplier_receipt_price_report`, `store_daily_summary_report`, `store_monthly_summary_report`（白名单见 getReports:68-72）。
- `report_file.report_scope`：`store` / `supplier`；`scope_id` 对应 `store_id` 或 `supplier_id`。
- `report_file.report_id` 编码规则：`RPT_SO_<orderNo>`、`RPT_SO_<orderNo>_A`（审核后重发）、`RPT_SR_<receiptId>`、`RPT_SRP_<receiptId>`、`RPT_SURP_<sid>_<receiptId>[_S/_RG]`、`RPT_SUR_<sid>_<receiptId>[_RG]`、`RPT_DS|MS_<storeId>_<date>_v<version>`。**receiptId 已编入 report_id，但 getReportDetail 未利用**。
- 供应商视角派生状态（getSupplierOrders:49-56）：`pending` / `confirmed` / `shipped` / `done` / `cancelled`。
- 金额字段：`supplier_product_price.price`、`receipt_item.price_snapshot`、`report_file.total_amount`；统一按「元」存储，两位小数。

### 3.3 索引与排序依赖（代码假设，非声明式索引）

| 查询 | 行号 | 假设的排序/索引 |
|---|---|---|
| `report_file` 列表 | getReports:93 | `orderBy('generated_at','desc')` + skip/limit |
| `purchase_order` 列表 | getPurchaseOrders:111 | `orderBy('created_at','desc')` + skip/limit |
| `receipt` 列表 | getReceipts:66 | `orderBy('created_at','desc')` + skip/limit |
| `receipt_item` 供应商列表 | getSupplierReceipts:59 | `orderBy('created_at','desc')` + skip/limit |
| `product` 列表 | getProducts:53 | `orderBy('product_name','asc')` + limit 200 |
| `supplier` 列表 | getSuppliers:66 | `orderBy('supplier_name','asc')` + limit 100 |
| `supplier_product_price` | getProductPrices:59 | `orderBy('effective_date','desc')` + limit 200 |
| 其余 | 多处 | 无 orderBy 的 `limit(N)` → 返回顺序不确定 |

### 3.4 金额精度与汇总口径

- **行小计**：`Math.round(received_qty * price_snapshot * 100) / 100`（先乘后舍入到分）。四处一致：generateSummaryReport:221、getReportDetail:119、getReportDetail:192、getSupplierReceipts:109，写入侧 createReceipt:638/721 同样口径。
- **累加**：`Math.round((sum + subtotal) * 100) / 100`，即每加一行再舍入一次（generateSummaryReport:222、:225）。
- **数量**：generateSummaryReport:218-219 用 `*1000/1000` 保留 3 位小数，与金额 2 位不一致（有意的，数量可带 3 位）。
- **口径差异**：带价报表（结算口径）只含 `payableFlag && !isManual` 行；汇总报表只排除 `is_manual`（见问题 H4）。

---

## 4. 关键流程与调用链

### 4.1 报表生成 → 明细查询 → 文件下载

```
[生成] createPurchaseOrder / createReceipt / dataService / generateSummaryReport
   └─ getNextVersion(reportType, scopeId, date)   generateSummaryReport:53-80（CAS 取号）
   └─ cloud.uploadFile({cloudPath, fileContent: BOM+CSV})
   └─ report_file.add({status:'generated', ...})   generateSummaryReport:247-265

[列表] getReports:39  → 角色约束 query(:50-66) → allowedReportTypes 校验(:68-76) → 角色二次收敛(:79-86)
        → count(:90) + orderBy('generated_at','desc').skip.limit(:91-96)

[明细] getReportDetail:54
   ├─ report_file 反查(:62) → 角色校验(:72-77)
   ├─ store_order_report     → purchase_order_item where purchase_order_id(:86-89, limit 1000)
   ├─ store_receipt_report   → receipt where purchase_order_id(:100-103, limit 1!) → receipt_item where receipt_id(:106-109, limit 1000)
   ├─ supplier_order_report  → purchase_order where order_date(:135-138, limit 200) → purchase_order_item where in(chunks)+supplier_id(:144-147, limit 1000/块)
   ├─ supplier_receipt_report→ receipt where receipt_date(:166-169, limit 200) → receipt_item where in(chunks)+supplier_id(:175-178, limit 1000/块)
   └─ store_daily/monthly_summary_report → cloud.downloadFile(report.file_url)(:209) → 自写 RFC4180 解析器(:212-232) → 按位置取 f[0..6](:238-246)

[下载] getReportFileUrl:39 → report_file where file_url=fileId(:46) → 角色校验(:49-54) → cloud.getTempFileURL(:55)
```

### 4.2 商品导入 / 改价的写入副作用

**importProducts**（82-210）：
1. 下载文件 → **立即删除云文件**（:94，在解析之前）
2. `XLSX.read` + `sheet_to_json(header:1)` → 首行 `mapHeader` 别名映射（:104，强制要求 商品名称/二级分类/单位 三列）
3. 全量拉取 `category`（limit 1000）与 `supplier`（limit 1000）做名称匹配（:110-115）
4. 全量分页拉取 `product`（无 status 过滤，每批 100）建立 `product_name|manufacturer_name` 去重键（:118-127）
5. 逐行校验 → 二级分类匹配（同名取 `candidates[0]`，一级分类仅在命中时收窄 :149-155）→ 供应商名称匹配（未匹配留空不阻断 :166-172）
6. 逐条 `product.add`（:192-199，无事务，单条失败仅记入 errors）
7. 返回 `{total, inserted, failed, errors, warnings}`

**updateProductPrice**（66-133）：
1. 角色门禁（:70，仅 super_admin/purchaser）→ 价格必须 >0（:76-79）→ **生效日期必须等于服务端当天**（:81-89，硬编码 UTC+8）
2. 校验供应商/商品存在且 status=1（:90-95）
3. `countInflightOrders`（:98，波及面提示）→ `dryRun===true` 时只返回计数不落库（:99-101）
4. `runTransaction`（:106-131）：读出所有 `is_current:1` 行 → 逐条 `.doc(id).update({is_current:0})` → 新增一行 `is_current:1`
5. 副作用：**无审计日志、无原价留存**；仅把旧行标记失效。`price_id = 'PRC_'+Date.now()`（:103）

### 4.3 C 端 vs 供应商端读取路径差异

| 维度 | C 端 | 供应商端 |
|---|---|---|
| 角色门禁 | chef / store_manager / purchaser / super_admin | `user.role === 'supplier'` 严格等值（getSupplierOrders:62、getSupplierReceipts:45） |
| 隔离键来源 | `user.default_store_id` | `user.default_supplier_id`，**忽略客户端传入的任何 id** |
| 订单列表 | getPurchaseOrders：`where` 下推 `store_id`/`created_by`/`order_status`，数据库分页 | getSupplierOrders：先查**全部**自己明细（:73-76）→ 反推 orderIds → 批量取主表 → **内存过滤隐藏状态 + 内存排序 + 内存分页** |
| 明细嵌入 | getPurchaseOrders:121-128 按订单批量带明细（含所有供应商） | getSupplierOrders:121-130 **只嵌入自己 supplier_id 的明细**（防同单跨供应商泄漏） |
| 状态可见性 | 原始 `order_status` 全量 | `deriveConfirmStatus`(:50-56) 派生 5 态，`draft/submitted/pending_approval/rejected` 整单不可见 |
| 收货 | getReceipts：chef 空集、store_manager 本店、purchaser 全量 | getSupplierReceipts：`where {supplier_id, is_manual neq true}` 平铺返回，join 主表补日期/门店，join abnormal_record 补裁决 |
| 供应商名称 | getPurchaseOrderDetail:86-97 补 `supplier_name`（chef 除外） | 不返回其他供应商 |
| 报表 | getReports/getReportDetail/getReportFileUrl 覆盖 store+supplier 两种 scope | **三个报表函数对 supplier 角色一律 -403**（见业务模糊点 2） |

---

## 5. 权限与数据隔离模型

### 5.1 隔离做得对的地方

- `getProductPrices:46-49`、`getSuppliers:45-51`、`getSupplierOrders:62-64`、`getSupplierReceipts:45-47`：供应商端一律以 `user.default_supplier_id` 为唯一隔离键，**完全忽略客户端传入的 supplierId/storeId**，无越权。
- `getPurchaseOrders:51-59`、`getReceipts:50-55`、`getReportDetail:72-77`、`getReportFileUrl:49-54`、`generateSummaryReport:178-186`：门店端以 `user.default_store_id` 强制收敛，客户端 `storeId` 参数在非全局角色下被丢弃或报错。
- `getPurchaseOrderDetail:64-66`：chef 额外限制只能看自己创建的订单（与 getPurchaseOrders:55 的 `created_by` 过滤一致）。
- `getPurchaseOrderDetail:86`：chef 不下发 `supplier_name`，与供应商确认状态的信息边界一致。
- `getPurchaseOrderDetail:131-133`：chef 只返回 `report_scope === 'store'` 的报表元数据。
- `getSupplierOrders:121-130`、`getSupplierReceipts:54`：严格只下发自己的明细，不泄漏同单其他供应商商品。
- 手写行（`is_manual`）在供应商端被 `_.neq(true)` 显式排除（getSupplierOrders:72、getSupplierReceipts:54），不依赖「supplier_id 为空」的隐式前提。

### 5.2 存在的隔离缺口

1. **getSuppliers:58-59 —— 停用供应商越权读取**（详见问题 H2）。
2. **getReports:43 storeId 参数失效**：purchaser/super_admin 无法按门店筛报表（详见问题 M10）。
3. **report_file.status 不参与任何权限/可见性判断**：作废、审核改量后的旧版本（`superseded`）对所有有权角色依然可列出、可看明细、可下载（详见问题 H5）。
4. **getPurchaseOrderDetail:138 `...order` 全量下发**：chef 拿到 `supplier_confirmations`、`verify_status`、`verify_amount`、`cancel_reason`、`missing_reports` 等内部字段，与同函数 :86 特意屏蔽 supplier_name 的策略不一致（详见问题 M6）。
5. **supplier 角色在报表三件套中被完全排除**（详见业务模糊点 2）——不是越权，但可能是功能缺口。

---

## 6. 报表口径正确性

| 口径项 | 明细（写入侧） | 汇总/查询侧 | 一致性 |
|---|---|---|---|
| 行小计舍入 | createReceipt:638/721 逐行先舍到分 | generateSummaryReport:221、getReportDetail:119/192、getSupplierReceipts:109 同口径 | 一致 |
| 可付款行过滤 | 带价报表只含 `payableFlag && !isManual`（createReceipt:630、:711） | generateSummaryReport:201 **只跳过 is_manual** | **不一致（H4）** |
| 异常行 | 质量/错货行 `payableFlag=false`，不进结算 | 汇总表金额仍计入质量/错货行 | **重复计入结算外金额（H4）** |
| 手动行 | 不进订货汇总、不进带价报表 | 汇总表整行跳过（数量+金额都不计） | 注释只说"金额口径"，行为是整行（见 §8） |
| 分批收货 | 一单多张 receipt，报表**按批次**生成（report_id 含 receiptId） | getReportDetail 按 `purchase_order_id` 取 **1 张** receipt | **丢批次（B2）** |
| 跨集合 join | purchase_order_item.item_id → receipt_item.purchase_order_item_id | getPurchaseOrderDetail:102-115 用 `item_id || _id` 关联 | 一致（createReceipt:256/:496 写入侧同规则） |
| 供应商归属 | purchase_order_item.supplier_id / receipt_item.supplier_id 写入时固化 | getReportDetail supplier 分支按 `supplier_id` 过滤，**不回查订单行** | 一致 |
| 汇总去重 | 按 `supplier_id\|product_id` 聚合 | generateSummaryReport:204 同键 | 一致 |
| 税率/折扣 | **全链路无税率、无折扣字段** | 无 | 无口径问题（也无能力） |
| 已确认/未确认 | `purchase_order.supplier_confirmations[sid].status` | getSupplierOrders:53-55 派生 pending/confirmed/shipped | 一致 |
| 状态计数 | — | getPurchaseOrders:96-106 只统计 6 状态 + 2 虚拟态 | **缺 6 个状态（H6）** |

---

## 7. 发现的问题

### 【阻断】

**B1 — getSupplierOrders:73-76 无排序 `limit(1000)` 截断，供应商订单与明细静默丢失**
- 位置：`cloudfunctions/getSupplierOrders/index.js:73-76`
- 描述：`db.collection('purchase_order_item').where({supplier_id, is_manual: _.neq(true)}).limit(1000).get()` 一次性拉取该供应商**全部历史**非手动明细，既无分页也无 orderBy。orderIds（:88）由这份截断后的数据反推，因此任何超出 1000 行窗口的订单会**整单消失**，其明细同样消失。无 orderBy 使返回的 1000 行不确定，**同一供应商每次刷新可能看到不同的订单集合**。
- 触发场景：累计明细数 > 1000 行（约 20 行/单即需 50+ 张单）的老供应商。
- 影响面：供应商门户的订单列表、statusCounts（:107-110）、分页 total（:118）全部失真；供应商可能漏接单/漏发货/漏对账。`:116` 注释「单个供货商的订单量级可控」与实际实现假设冲突。

**B2 — getReportDetail:100-103 按 purchase_order_id `limit(1)` 取收货单，分批收货时报表明细取错批次**
- 位置：`cloudfunctions/getReportDetail/index.js:100-103`
- 描述：`db.collection('receipt').where({purchase_order_id: orderId}).limit(1).get()`。分批收货（createReceipt:310-315 的 `batch_no`）下同一 purchase_order 对应**多张** receipt，而 store_receipt_report / store_receipt_price_report 是**按批次**生成的（report_id 直接编码 receiptId：createReceipt:614、:647）。代码既不解析 `report_id` 中的 receiptId，也不按 batch_no 匹配，`limit(1)` 且无 orderBy 返回哪张批次不确定。
- 触发场景：任一采购单发生第二次及以上收货（B3 分批收货场景）。
- 影响面：门店收货报表、门店带价收货报表的详情页 rows 与它自己的 CSV 文件**不是同一批数据**，金额与行数对不上；`store_receipt_report` 的 CSV 本身含异常行与「是否可付款」列，页面对该批次重建的行同样可能错位。同函数 :137（supplier_order_report）、:168（supplier_receipt_report）的 `limit(200)` 是同类截断问题（见 H7）。

### 【高】

**H1 — getSupplierOrders:117 用 `String(Date)` 字典序排序，时间序错误**
- 位置：`getSupplierOrders/index.js:116-119`
- 描述：`filtered.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))`。云数据库返回的 `created_at` 是 JS `Date` 对象，`String(new Date())` 在 V8 下形如 `"Wed Oct 04 2026 12:34:56 GMT+0800 (China Standard Time)"`，字典序以星期/月份缩写开头（`"Jan" > "Feb" > "Apr"`），与时间先后**完全无关**。
- 触发场景：供应商订单 ≥ 2 条且跨月（几乎必然触发）。
- 影响面：供应商端列表顺序错乱、内存分页 `slice((page-1)*pageSize, page*pageSize)`（:119）基于错误顺序 → 翻页漏单/重复；用户按「最近订单」心智操作时会漏掉待确认订单。

**H2 — getSuppliers:58-59 `status` 参数绕过 includeInactive 守卫，非管理角色可读停用供应商**
- 位置：`getSuppliers/index.js:53-62`
- 描述：
  ```js
  if (includeInactive && !isManager) return { code: -403, msg: '当前账号无权查看停用供应商' }   // :54
  if (status !== undefined && status !== null && status !== '') query.status = status            // :58
  else if (!includeInactive || !isManager) query.status = 1                                       // :59
  ```
  `:54` 只拦 `includeInactive`，而 `:58` 允许客户端直接传 `status`。chef / store_manager / replenisher 传 `{status: 0}` 即得 `query = {status: 0}`，读到全部**已停用**供应商的完整档案（含 `contact_name`、`contact_phone`）。对照 getProducts:44-47 只暴露 `includeInactive` 一个开关，无此旁路 —— 同一模块内两处同类功能的实现不对称。
- 触发场景：任一非管理角色调用 `getSuppliers({status: 0})`。
- 影响面：供应商联系人电话批量外泄；停用状态的可信度下降。

**H3 — updateProductPrice:106-131 事务未解决并发调价，可能产生两行 `is_current:1`**
- 位置：`updateProductPrice/index.js:106-131`
- 描述：事务内先 `where({supplier_id, product_id, is_current:1}).limit(100).get()` 读出当前行，再对每行 `.doc(current._id).update({is_current: 0})`（无条件更新，不带 `where is_current:1` 条件），最后 `add` 一行 `is_current:1`。事务只保证「读改写在同一隔离窗口内」，**不保证并发两个调价事务互斥**：两个事务都读到同一批 current 行、都把它们置 0（幂等）、都新增一行 → 结果留下**两条 `is_current:1`**。注释（:104-105）声称「must be one transaction, otherwise concurrent updates can leave two current rows」，该保证对串行中断成立，对并发不成立。
- 触发场景：管理员 A、B 同时改同一供应商+商品价格，或前端重试与手动点击重叠。
- 影响面：`getProductPrices` 带 `onlyCurrent` 时返回两档价格；`createReceipt:361-373` 取价在「同日多行」时按 `is_current` 优先（:371）—— 两行都标 current 时命中哪条取决于返回顺序 → **结算单价不确定**。同时 `price_id = 'PRC_'+Date.now()`（:103）同毫秒并发会撞 id。

**H4 — generateSummaryReport:199-223 汇总金额口径未排除质量/错货异常行，与结算口径不一致**
- 位置：`generateSummaryReport/index.js:199-223`（关键：`:201`）
- 描述：聚合循环只 `if (item.is_manual) return`，`is_quality_issue` / `is_wrong_item` 的行照常计入 `orderQty`、`receivedQty` 与 `amount`。而写入侧的结算报表明确排除：store_receipt_price_report 取 `items.filter(i => i.payableFlag && !i.isManual)`（createReceipt:630），supplier_receipt_price_report 同（:711），且 `payableFlag` 由服务端裁决 `!hardAbnormal && priceSnapshot > 0`（createReceipt:392）。
- 触发场景：任一批次出现质量问题或错货行。
- 影响面：`report_file.total_amount`（:262）与 CSV「合计」（:234）**系统性大于**供应商/门店带价账单金额；同一天的「汇总报表」与「带价账单」两个数字对不上，无法从汇总表看出差异来源（汇总表无异常列）。

**H5 — 报表三件套均不感知 `report_file.status='superseded'`，旧版本可查可下载且明细取自当前数据**
- 位置：`getReports/index.js:45-47`（未设置 status 条件）、`getReportDetail/index.js:62-65`、`getReportFileUrl/index.js:46`
- 描述：dataService:423-425 在审核改量后、dataService:1403-1409 在作废后把 `report_file.status` 批量置为 `superseded`，但三个读取函数完全不过滤。叠加 getReportDetail:84-89 对 `store_order_report` **从当前 `purchase_order_item` 重建明细**（不是解析快照），于是打开「已改量的旧版本」报表时：页面 rows 显示**改量后的新数量**，而 `file_url` 下载的是**改量前的 CSV**。
- 触发场景：采购单被审核改量或作废后，用户打开旧版本报表。
- 影响面：旧版本可下载 → 对账/审计时可能拿到过期数据；页内明细与文件矛盾 → 用户无法判断哪个是真值。

**H6 — getPurchaseOrders:96-106 statusCounts 缺 6 个真实状态**
- 位置：`getPurchaseOrders/index.js:84-106`
- 描述：并行 count 只覆盖 `draft`、`submitted`、`received`、`receipt_abnormal`、`cancelled`、`partial_received`，加虚拟态 `toVerify`（verify_status='pending'）与 `receivable`。全库实际存在而**未统计**的状态：`pending_approval`、`rejected`、`approved`、`report_generated`、`to_receive`、`completed`。因此 `all`（:85）严格大于各分项之和。
- 触发场景：存在任何待审核/已驳回/已批准未生成报表的订单。
- 影响面：前端状态 tab 计数缺失或不守恒；用户按 tab 切「待审核」可能拿到 0 或 undefined。

**H7 — getReportDetail:135-138 / 166-169 supplier 报表分支 `limit(200)` 无排序无分页，且订单级不做供应商过滤、不做状态过滤**
- 位置：`getReportDetail/index.js:135-138`（purchase_order by order_date）、`:166-169`（receipt by receipt_date）
- 描述：按日期取单据上限 200 条，无 orderBy、无分页；随后按 20 条分块取明细，每块 `limit(1000)`（:146、:177）也不分页。此外 supplier_order_report 分支不按 getSupplierOrders 的 `HIDDEN_ORDER_STATUS` 过滤，也不排除已作废订单 —— 重建出来的行来自**当前**订单数据。
- 触发场景：某日全公司订单/收货单 > 200 张，或某块明细 > 1000 行。
- 影响面：静默丢单/丢行 → 详情页与 CSV 快照不一致（CSV 只含下单当时已提交的订单、只含该单该供应商的行）。

**H8 — getProducts:53 `limit(200)` 无分页 + 关键字在截断后内存过滤**
- 位置：`getProducts/index.js:53`、`:56-59`
- 描述：`where(where).orderBy('product_name','asc').limit(200).get()`，之后才用 `keyword` 对内存中的 list 做 `includes` 过滤（:56-59）。商品超过 200 条时列表被截断，且关键字检索**只能搜到按名称排序前 200 条内的商品**。
- 触发场景：商品主数据 > 200 条。
- 影响面：门店下单选品列表缺商品；搜索"找不到明明存在的商品"。

### 【中】

- **M1 — 单字段 orderBy 无次级排序键导致翻页非确定**：getPurchaseOrders:111（created_at）、getReports:93（generated_at）、getReceipts:66（created_at）、getSupplierReceipts:59（created_at）。`db.serverDate()` 毫秒精度，同批创建（批量导入、批量收货）时同值记录顺序不定 → 翻页重复或漏项。
- **M2 — getPurchaseOrderDetail:103-106 已收累计聚合 `limit(1000)` 无分页**：`where({purchase_order_item_id: _.in(itemIds)}).limit(1000)`。多批次累计收货行 > 1000 时 `received_total` 少计、`remaining_qty` 虚高（:115），前端「已收 X / 剩余 Y」失真。
- **M3 — getPurchaseOrderDetail:120-123 关联收货单 `limit(100)` 无分页无排序**：单订单收货单 > 100 张时被截断。
- **M4 — getPurchaseOrders:121-124 明细每 20 单共享 `limit(1000)`**：单均 > 50 行的大单会被静默截断，列表页 `items` 不完整。
- **M5 — getReceipts:76-79 同上（每 20 张收货单共享 1000 条明细上限）**。
- **M6 — getPurchaseOrderDetail:138 `...order` 全量下发内部字段**：chef 也拿到 `supplier_confirmations`（含各供应商确认状态）、`verify_status`/`verify_amount`（凭证核销）、`cancel_reason`、`missing_reports`。与 :86 对 chef 刻意不下发 `supplier_name` 的信息边界策略不一致，属内部流程信息外泄。
- **M7 — getProductPrices:57-61 `limit(200)` + 全局 `orderBy effective_date desc`**：不带 `onlyCurrent` 时，同一商品的历史价格版本互相挤占 200 条窗口，部分商品可能一条价格都取不到；返回顺序也不代表「该商品各档价格」。
- **M8 — getSuppliers:61 keyword 直接作为正则下发**：`db.RegExp({regexp: keyword, options: 'i'})` 无长度/合法性校验。非法正则使整次查询抛错（被 catch 吞成通用文案），长正则存在 ReDoS 风险。同函数 :64-68 `limit(100)` 无分页。
- **M9 — getSuppliers:51 供应商角色硬编码 `product_count: 0`**：与 :85-91 管理角色路径口径不同，供应商自己的档案永远显示商品数 0。
- **M10 — getReports:43 解构的 `role`、`storeId` 从未使用**：purchaser/super_admin 无法按门店筛报表，与 getPurchaseOrders:62 支持 `storeId` 不一致。getPurchaseOrders:43 的 `role`、getReceipts:44 的 `role`/`storeId` 同样为死参数。
- **M11 — getSuppliers:45-52 供应商角色分支忽略 `status`/`keyword`/`includeInactive`**：参数无效（无害但契约不诚实）。
- **M12 — generateSummaryReport:94 月汇总用字符串区间 `gte('YYYY-MM-01').and(lte('YYYY-MM-31'))`**：依赖日期串零填充且依赖 `receipt_date` 严格为 `YYYY-MM-DD`；若上游写入非标准格式（如 `YYYY/M/D`）会被漏掉。另外 CSV 头「汇总日期」写的是传入的单个日期（:229），而数据实际覆盖整月，标签与内容不符。
- **M13 — updateProductPrice:46-63 波及面计数不可靠**：`purchase_order_item where {supplier_id, product_id} limit(1000)` 无分页（:48-49），且 catch 中把任何异常（含权限/集合缺失）静默归 0（:60-63）。商品历史订单行 > 1000 或查询失败时，前端拿到 `affectedOrders: 0` 会以为调价无影响。
- **M14 — updateProductPrice:103 `priceId = 'PRC_' + Date.now()`**：同毫秒并发调价产生重复 price_id（`_id` 仍唯一，但业务键冲突）。
- **M15 — 「当天」的时区定义在三处不统一**：updateProductPrice:81 与 createReceipt:327-329 用 `Date.now() + 8*3600*1000` 硬编码 UTC+8；generateSummaryReport:82 的 `isDate` 只做纯 UTC 校验、不做时区转换。云函数若部署在非中国大陆区域，两处口径会漂移。
- **M16 — importProducts:94 先删云文件再解析**：`cloud.deleteFile` 在 `XLSX.read` 之前执行。文件解析失败（格式错、无工作表、表头不符）时用户源文件已永久删除且不可恢复。
- **M17 — importProducts:110-113 `category`/`supplier` 各 `limit(1000)` 无分页**：分类或供应商超过 1000 条时，名称匹配命中率下降，导入结果出现大量「分类不存在 / 供应商不存在」提示。
- **M18 — importProducts:149-155 二级分类同名时取 `candidates[0]`**：一级分类仅在 `byL1.length` 命中时收窄，否则在同名二级分类中任意取第一条 → 商品可能挂到错误的一级分类。
- **M19 — importProducts:121-126 去重全量拉取且不过滤 status**：停用商品（`status=0`）同样占去重键 → 用户无法重新导入已停用商品；商品量大时按 100 条一批循环拉取全表，无上限保护。
- **M20 — importProducts:192-199 无整体事务**：逐条 `add`，单条失败仅记入 `errors`（且 `row: '-'`，行号丢失）→ 部分成功状态需人工核对；导入中途失败无回滚、也无导入批次留痕。

### 【低】

- **L1 — importProducts:83-84 鉴权失败返回形状与其余 13 个函数不一致**：`return { error: { code: -401, msg: ... } }`（:84）而非 `{ code, msg }`。前端若按顶层 `code` 判断会把它当作成功响应处理。
- **L2 — getProducts:49-51 `categoryId` 转 `Number`**：非数字入参变 `NaN` 后直接作为查询条件，无提示（结果空集或报错）。
- **L3 — getSupplierReceipts:83-86 `abnormal_record` 每块 `limit(1000)` 无分页**。
- **L4 — getSupplierReceipts:110 abnormals key = `receipt_id_product_id`**：同一收货单内同商品多行（不同订单行）的异常会被合并到一条明细上。
- **L5 — getReceipts:50-52 chef 返回 `{code:0, data:[], total:0}` 而非 -403**：与「无权」语义不一致，但符合"厨师不看收货"的设计。
- **L6 — generateSummaryReport:208 聚合的 `productName` 取首个 item**：同一 (供应商,商品) 跨批次商品名变更时以首条快照为准。
- **L7 — getReportDetail 多处 `limit(1000)` 硬上限无分页**：:88（store_order_report 明细）、:108（store_receipt_report 明细）、:146、:177。
- **L8 — getReportDetail:104-105 收货单缺失时静默返回空 rows**：报表存在但收货单被删时，返回 `code: 0` + 空 `rows`，无任何错误提示。
- **L9 — getReportFileUrl:46-47 以 `file_url` 反查**：非报表文件传入时提示「报表文件不存在」，文案与实际情况（文件存在但不是报表）不符。
- **L10 — getReportDetail:238-246 汇总报表按**位置**取 CSV 列**：`f[0]..f[6]` 无列名校验，未来 CSV 增列/改列会静默错位（解析器本身写得规范，:212-232 是合规 RFC4180）。
- **L11 — getSupplierOrders:15 `DONE_ORDER_STATUS` 含 `'completed'` 死状态**：全库无 `purchase_order.order_status = 'completed'` 写入点。
- **L12 — `'to_receive'` 是纯引用态**：仅在 authService:642、confirmSupplierOrder:12-13、updateProductPrice:43 的白名单里出现，无任何写入点；但 `getPurchaseOrders:74/94` 的 `receivable` 虚拟筛选**不含** `to_receive`（详见业务模糊点 5）。
- **L13 — `getSessionUser`/`hashToken` 在 14 个文件中逐字复制**：B12 多设备会话改造需同步 14 处，任何一处遗漏都会造成该函数对多设备会话失效（或反向兼容断裂）。
- **L14 — package.json description 个别缺尾标点**（getReportDetail「获取报表详情含行数据」），不影响运行。

---

## 8. 代码与注释/日志不一致

1. **generateSummaryReport:200-201** —— 注释「S9：手动行无协议价（金额走凭证核销），不计入汇总**金额口径**」，实际代码 `if (item.is_manual) return` **整行跳过**，连 `orderQty`/`receivedQty` 也不计入。注释说金额，行为是整行。
2. **updateProductPrice:40-42** —— 注释「在途 = **已提交**且未收完（草稿未提交不算…）」，实际 `INFLIGHT_ORDER_STATUS`（:43）包含 `pending_approval`（待内部审核、尚未提交审核通过），与"已提交"表述不完全吻合。
3. **updateProductPrice:104-105** —— 注释「Switching the current price and inserting the replacement must be one transaction, otherwise concurrent updates can leave two current rows」，该保证只对串行中断成立，对并发事务不成立（见 H3）。注释给出的保证强于代码实际能力。
4. **getSupplierOrders:116** —— 注释「排序 + 内存分页（**单个供货商的订单量级可控**）」，与 :73 `limit(1000)` 的前提直接冲突，量级不可控时即触发 B1 的截断。
5. **getSupplierOrders:9-11** —— 注释只解释 `submitted/pending_approval`（未通过内部审核），未提 `HIDDEN_ORDER_STATUS`（:12）还包含 `draft` 与 `rejected`。
6. **getPurchaseOrders:68-69** —— 注释「to_verify / receivable …与首页『待收货』卡片、getOrderStats 口径一致」。但 `receivable = [approved, report_generated, partial_received]`（:74、:94），而 updateProductPrice:43 的 INFLIGHT 与 authService:642 的 ACTIVE 都额外包含 `submitted`/`pending_approval`/`to_receive`。**"在途/可收"在三个函数中口径互不相同**，注释的"一致"不成立。
7. **getReportDetail:162-163** —— 注释「收货明细本身已存 supplier_id…直接按供应商过滤，不再逐行回查 purchase_order_item」属实；但同函数 :144-147 的 supplier_order_report 分支仍需在 purchase_order_item 上过滤 supplier_id，两句注释并排易被误读为「所有集合都自带 supplier_id」。
8. **createReceipt:379-382 相关口径回读** —— 本模块 generateSummaryReport 未读取 `payable_flag`，导致 H4 的口径分裂；代码中无任何注释提示这一差异。

---

## 9. 未确认的业务模糊点

1. **`report_file.status='superseded'` 是否应从列表/详情/下载中隐藏？** 代码只在审核改量（dataService:423-425）与作废（:1403-1409）时打标，但读取侧完全不感知。无法判断这是"有意的可追溯保留"还是"漏了过滤"。直接决定 H5 的定级。
2. **供应商角色的报表读取路径是否存在？** `getReports`（:50-66 的 else 分支）、`getReportDetail`（:74）、`getReportFileUrl`（:50-53）对 `supplier` 角色一律 -403。系统却生成了 3 类 supplier 范围报表（supplier_order_report / supplier_receipt_report / supplier_receipt_price_report）。是"供应商走线下、门户用 getSupplierOrders/getSupplierReceipts"的设计，还是遗漏了供应商侧下载入口？
3. **汇总表金额是否应排除质量/错货异常行？** 带价报表（结算口径）明确排除，汇总报表未排除，且汇总表无异常列、无"是否可付款"列，用户无法定位差异来源。若业务要求"汇总表=全量收货口径"，则需要显式标注；若要求"汇总表=结算口径"，则 H4 应修复。
4. **chef 的可见边界到底到哪里？** getPurchaseOrderDetail:86 对 chef 隐藏 supplier_name、:131 过滤供应商报表，但 :138 `...order` 仍下发 `supplier_confirmations`/`verify_status`/`verify_amount`；getReceipts:50 对 chef 返回空集而非 403。chef 是否应该看到"已确认/已发货"状态与核销进度？
5. **`to_receive` 与 `completed` 状态的真实流转。** 两者都无写入点，但被 4 处白名单引用；且 `getPurchaseOrders` 的 `receivable` 虚拟筛选（:74）不含 `to_receive`，而 createReceipt:239/:417 的可收货集合也不含 `to_receive` → 处于该状态的订单**能否收货**、在列表里能否被「待收货」筛到，均无代码依据。
6. **补录历史收货日期的价格口径。** updateProductPrice:80-84 只允许当天生效（S5 拍板、不支持预约调价），createReceipt:361-362 的取价逻辑支持 `effective_date <= receiptDate` 的历史比价（注释声称"避免历史单据价格快照写错"，#16 允许补录）。当管理员在 A 日改价、又补录 B 日（B<A）的收货时，取到的会是 A 日新价而非 B 日真实价 —— 与注释意图冲突，需业务确认补录场景的价格基准。
7. **importProducts 去重键 `product_name|manufacturer_name`（默认厂家"默认"）** —— 不填厂家的同名商品会被整体阻断（:159-161）。业务上是否允许同名不同规格/不同厂家共存？现有模板无法表达。
8. **`receipt_item.payable_flag` 的语义范围。** 写入侧 `payable_flag = item.payableFlag !== false`（createReceipt:504）默认 true，手动行与异常行/缺价行为 false。getReportDetail:120/:193 直接把它当「是否可付款」展示。"可付款"与"进入结算账单"是否等价（缺价行标记 `is_missing_price` 走 abnormal_record 而非 payable_flag）需确认。
9. **`getSuppliers` 的 `product_count` 语义。** 只统计 `product.default_supplier_id` 等于该供应商的商品数（:76-83），不含"有协议价但非默认供应商"的商品。与 getProductPrices 的协议价维度不是一个口径。

---

## 10. 覆盖率声明

- **应读 28 个文件，实读 28 个文件，遗漏 0**。
  - 14 个 `index.js`（280+261+103+64+66+89+138+213+96+148+149+92+137+119 = 1995 行）
  - 14 个 `package.json`（13 个 × 9 行 + importProducts 10 行 = 127 行）
  - 合计 2082 行，全部逐行读完，未抽样、未跳读。
- **交叉核验（用于确认数据契约，不属于本模块勘察范围，不据以评价其代码质量）**：
  - `createReceipt/index.js:280-400`、`:490-600`、`:600-786` —— 确认分批收货、receipt/receipt_item 字段、payable_flag 裁决、4 类报表生成与 report_id 编码
  - `createPurchaseOrder/index.js:378-448` —— 确认 purchase_order / purchase_order_item 写入字段、store_order_report / supplier_order_report 生成
  - `dataService/index.js:405-475`、`:1385-1418` —— 确认 `report_file.status='superseded'` 的触发时机
  - 全库 grep：`order_status` 枚举取值与 `to_receive`/`completed` 写入点、`report_file` 全部 `status` 取值
- **未做的事**：未读 `docs/exploration/` 下任何既有报告；未引用他人结论；未修改任何文件；未执行 git 命令；未访问外网。报告文件为本任务唯一写入。
