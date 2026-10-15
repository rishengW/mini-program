# A4 · 读取域与报表域云函数（13 个）· 函数级清单

## 0. 范围与方法

**已逐行读完（Read 工具，行号与 Read 输出一致）：**

| 文件 | 本次实读行数 | 分配表行数 |
|---|---|---|
| `cloudfunctions/getReportDetail/index.js` | 262（正文 261） | 261 |
| `cloudfunctions/importProducts/index.js` | 214（正文 213） | 213 |
| `cloudfunctions/getPurchaseOrderDetail/index.js` | 150（正文 149） | 149 |
| `cloudfunctions/getPurchaseOrders/index.js` | 149（正文 148） | 148 |
| `cloudfunctions/updateProductPrice/index.js` | 139（正文 138） | 138 |
| `cloudfunctions/getSupplierOrders/index.js` | 138（正文 137） | 137 |
| `cloudfunctions/getSupplierReceipts/index.js` | 120（正文 119） | 119 |
| `cloudfunctions/getReports/index.js` | 104（正文 103） | 103 |
| `cloudfunctions/getSuppliers/index.js` | 97（正文 96） | 96 |
| `cloudfunctions/getReceipts/index.js` | 93（正文 92） | 92 |
| `cloudfunctions/getProductPrices/index.js` | 90（正文 89） | 89 |
| `cloudfunctions/getProducts/index.js` | 67（正文 66） | 66 |
| `cloudfunctions/getReportFileUrl/index.js` | 65（正文 64） | 64 |
| **合计** | **1617（正文 1615）** | **1615** |

行差一律为 1，是文件末尾空行被计入。

**允许范围内额外读（只读）：** `utils/cloud.js` 全 283 行（用于确认统一返回形状与 401 拦截）；`pages/**/*.js` 全部 28 处调用点（Grep 定位 + 定向 Read）；`cloudfunctions/createPurchaseOrder/index.js`（确认 `created_at`/`created_by` 写入方式）；`cloudfunctions/createReceipt/index.js:541-557`（确认 `abnormal_record` 字段）；`cloudfunctions/confirmSupplierOrder/index.js:73-80`（确认 `supplier_confirmations` 结构）。

**未读：** 除上述外的其他云函数（createPurchaseOrder 只读了 4 个 grep 命中片段与 :324-353，不是全文）、`pages/**/*.wxml`（因此"前端渲染哪些 rows 字段"只依据 `.js` 中的 setData 与 `utils/cloud.js` 归一化函数，wxml 侧未逐行核对 —— 见 §8）。

**说明：** 本报告不重做缺陷审计，不做 X1 类结论。所有负结论均附检索方式。

---

## 1. 总表

| 云函数 | 行数 | 角色白名单**原文** | 前端调用方 | 返回顶层字段 |
|---|---|---|---|---|
| `getReportDetail()` | 262 | `const isGlobal = ['super_admin','purchaser'].includes(user.role)`（`:72`）；非全局须 `['chef','store_manager'].includes(user.role)`（`:74`） | `pages/report-detail/report-detail.js:24` | `code, msg, data` |
| `importProducts()` | 214 | `const MANAGEMENT_ROLES = ['super_admin','purchaser']`（`:8`） | `pages/product-manage/product-manage.js:172` | `code, data` |
| `getPurchaseOrderDetail()` | 150 | `['super_admin','purchaser'].includes(user.role)`（`:58`）；非全局须 `['chef','store_manager']`（`:60`） | `purchase-detail:23`、`approval-detail:24`、`purchase-create:57`、`receive-verify:17`、`receive-verify:65` | `code, data` |
| `getPurchaseOrders()` | 149 | `const isGlobal = ['super_admin','purchaser'].includes(user.role)`（`:50`） | `index:42`、`approval-list:22`、`purchase-list:71`、`receive-list:20` | `code, data, total, page, pageSize, statusCounts` |
| `updateProductPrice()` | 139 | `if (!['super_admin','purchaser'].includes(user.role))`（`:70`） | `price-manage:135`（dryRun）、`price-manage:155`、`price-manage:210` | `code, data` |
| `getSupplierOrders()` | 138 | `if (user.role !== 'supplier')`（`:62`） | `supplier-orders:68`、`supplier-home:85` | `code, data, total, page, pageSize, statusCounts` |
| `getSupplierReceipts()` | 120 | `if (user.role !== 'supplier')`（`:45`） | `supplier-receipts:39` | `code, data, total, page, pageSize` |
| `getReports()` | 104 | `user.role === 'chef'` / `'store_manager'` / `('purchaser'或'super_admin')`（`:50-66`） | `index:48`、`report-list:73`、`report-history:60` | `code, data, total, page, pageSize` |
| `getSuppliers()` | 97 | **仅** `if (user.role === 'supplier')`（`:45`）与 `if (includeInactive && !isManager)`（`:54`） | `product-manage:39`、`price-manage:34`、`user-manage:37`、`supplier-manage:22` | `code, data` |
| `getReceipts()` | 93 | `chef → 空集`（`:50-52`）；`store_manager`（`:53`）；`['super_admin','purchaser']`（`:56`） | `receive-list:26` | `code, data, total, page, pageSize` |
| `getProductPrices()` | 90 | `supplier`（`:46`）；`['super_admin','purchaser']`（`:51`） | `price-manage:36`、`supplier-prices:30` | `code, data` |
| `getProducts()` | 67 | **无角色白名单**（唯一门禁 `includeInactive && !isManager`，`:45`） | `product-manage:37`、`price-manage:35`、`purchase-create:126` | `code, data` |
| `getReportFileUrl()` | 65 | `['super_admin','purchaser']`（`:49`）；非全局须 `['chef','store_manager']`（`:50`） | `report-detail:100` | `code, data` |

---

## 2. 函数清单

### `getReportDetail()（index.js）` `(行 1-262)`

- **职责**：按 `reportId` 取报表元数据，并按报表类型从原始业务表重建行数据（或对汇总报表重新解析其 CSV 文件）。
- **入参**：`authToken` string 必填（服务端派生身份）；`reportId` string 必填，缺失返回 `code:-1 msg:'缺少reportId'`（`:59`）。**无其他参数**，无分页参数。
- **返回**：成功 `{ code: 0, data: { ...report, rows } }`（`:256`）。`...report` 即 `report_file` 整文档（`report_id, report_type, report_scope, scope_id, scope_name, related_date, source_order_id, file_url, generated_at, file_version, has_abnormal, abnormal_summary, ...`）。`rows` 是**按报表类型不同而形状不同**的数组：
  - `store_order_report`（`:90-97`）：`{productName, category, unit, orderQty, isManual, remark}`（6 字段）
  - `store_receipt_report` / `store_receipt_price_report`（`:112-127`）：`{productName, orderQty, receivedQty, unit, unitPrice, subtotal, payable, isManual, abnormal, abnormalTypeNames, abnormalText, abnormalStatus, remark}`（13 字段）
  - `supplier_order_report`（`:151-158`）：`{purchaseOrderId, storeName, productName, orderQty, unit, remark}`（6 字段）
  - `supplier_receipt_report` / `supplier_receipt_price_report`（`:183-199`）：`{purchaseOrderId, storeName, productName, receivedQty, orderQty, unit, unitPrice, subtotal, payable, isManual, abnormal, abnormalTypeNames, abnormalText, abnormalStatus, remark}`（15 字段）
  - `store_daily_summary_report` / `store_monthly_summary_report`（`:238-246`）：`{productName, supplierName, category, unit, orderQty, receivedQty, subtotal}`（7 字段，**无 payable/isManual/abnormal**）
  - 前端 `report-detail.js:47-65` 依赖 `row.abnormal`、`row.abnormalTypeNames`、`row.payable`、`row.isManual`、`row.subtotal`。
- **失败**：`-401` 会话失效（`:57`）；`-403` 三类 —— 角色不在 chef/store_manager（`:74`）、跨门店（`:75`）、chef 非 `store_order_report`（`:76`）；`-1` 缺 reportId（`:59`）、报表不存在（`:68`）、汇总文件解析失败（`:248-251` 抛错被外层 `:257-260` 捕获）。
- **读取的集合与过滤条件**：
  - `app_user` where `{ status:1, sessions:{token_hash} }` limit 1（`:30-33`），回落 `{ session_token_hash, status:1 }` limit 1（`:36-40`）
  - `report_file` where `{ report_id }` limit 1（`:62-65`）
  - `purchase_order_item` where `{ purchase_order_id: orderId }` limit **1000**（`:86-89`）
  - `receipt` where `{ purchase_order_id: orderId }` limit **1**（`:100-103`）
  - `receipt_item` where `{ receipt_id }` limit **1000**（`:106-109`）
  - `purchase_order` where `{ order_date: date }` limit **200**（`:135-138`）
  - `purchase_order_item` where `{ purchase_order_id: _.in(chunk20), supplier_id }` limit **1000**（`:144-147`）
  - `receipt` where `{ receipt_date: date }` limit **200**（`:166-169`）
  - `receipt_item` where `{ receipt_id: _.in(chunk20), supplier_id }` limit **1000**（`:175-178`）
  - 汇总报表：`cloud.downloadFile({ fileID: report.file_url })`（`:209`），本地 RFC4180 解析（`:212-232`），数据行从索引 2 起、跳过 `f[0]==='合计'`（`:233-247`）
  - **无 orderBy**（除 `purchase_order_item`/`receipt_item` 本身无排序）
- **权限与数据可见范围**：`supplier_id` / `store_id` 全部来自 `report.scope_id`（服务端读库，`:75`、`:133`、`:164`），**不是前端传入**。chef 被 `:76` 锁死在 `store_order_report`，因此**结构上无法**读到 supplier 级报表（其 scope_id 为供应商 ID，会被 `:75` 的 `report_scope !== 'store'` 拦下）。supplier 角色在 `:74` 直接 -403。
- **调用点**：`pages/report-detail/report-detail.js:24`，实际传入仅 `{ reportId }`；期望 `data.report_type / scope_name / related_date / generated_at / file_version / source_order_id / has_abnormal / abnormal_summary / file_url / rows`（`:31-44`）。
- **契约风险**：
  1. **分批收货只取 1 张收货单**：`store_receipt_report` 用 `.where({ purchase_order_id: orderId }).limit(1)`（`:100-103`）且**无 orderBy**。`createReceipt/index.js:563-566` 支持 `partial_received`（同一订单多张 receipt），故后续批次的收货明细在门店收货报表中**静默丢失**。
  2. **静默空表**：`:207` `if (report.file_url)` 为假时 rows 保持 `[]`，仍返回 `code:0`；且 `:84-254` 的 if/else 链**没有 else 分支**，未匹配的 `report_type` 同样返回 `code:0` + `rows:[]`。
  3. 汇总报表 CSV 解析**按固定列序**假设 `[商品,供应商,分类,单位,订货,收货,金额]`（`:239-245`），生成端列序一变即静默错列（无校验、无报错）。
  4. 汇总报表的 rows **缺 `payable`/`isManual`/`abnormal`**，而前端 `report-detail.js:56` 用 `r.payable !== false && !r.isManual` 过滤 —— 汇总类报表无此需求（前端按 `reportType.includes('price')` 分支），不构成断裂。

### `importProducts()（index.js）` `(行 1-214)`

- **职责**：Excel 批量导入商品（表头别名映射 → 分类/供应商按名匹配 → 逐条写 `product`）。
- **入参**：`authToken` 必填；`fileID` string 必填，缺失 `-1 '缺少文件'`（`:86-87`）。**其余无参数**。
- **返回**：成功 `{ code: 0, data: { total, inserted, failed, errors:[{row,msg}], warnings:[{row,msg}] } }`（`:201-210`）。
- **失败**：`-401`（`:54`）、`-403`（`:56`）、`-1` 缺文件（`:87`）/下载或解析失败（`:97`）/无工作表（`:100`）/行数 <2（`:102`）/表头不匹配（`:106`）。
- **读取的集合**：`app_user`（`:28-40`）；`category` where `{ status:1 }` limit **1000**（`:111`）；`supplier` where `{ status:1 }` limit **1000**（`:112`）；`product` **无 where、skip/limit(100) 无限循环**拉全量用于去重（`:119-126`）；写 `product`（`:194`）；`cloud.downloadFile({ fileID })`（`:92`）+ `cloud.deleteFile({ fileList:[fileID] })`（`:94`）。
- **权限与数据可见范围**：`MANAGEMENT_ROLES`（`:8`）= 全局角色，商品表本身无 `store_id`。
- **调用点**：`pages/product-manage/product-manage.js:168-172`，上传路径 `cloudPath: 'imports/products/${Date.now()}_${随机}.xlsx'`（`:169`），传 `{ fileID: up.fileID }`；期望 `data.total/inserted/failed/errors[].row/errors[].msg/warnings[]`（`:175-184`）。
- **契约风险**：
  1. **`fileID` 零前缀校验**（`:86-94`，已核实）：客户端传入任意 fileID 即可 `downloadFile` + `deleteFile`，无 `imports/products/` 前缀校验、无归属校验。危害 = 读取 + **销毁**任意门店云文件。
  2. 去重循环（`:121-126`）**无 where 全表拉取**，且页与页之间存在竞态删除窗口时可能不前进（`batch.data.length === BATCH` 恒成立则死循环）；商品量增长后云函数超时风险线性上升。
  3. `downloadFile` 成功后**立即 `deleteFile`**（`:94`），删除失败只 `console.error`（`:94`）—— 导入失败时文件已被删，前端无重试手段。
  4. `category`/`supplier` 各 limit 1000（`:111-112`），超过后按名匹配不到 → 全部记为 error，无提示是"超上限"而非"不存在"。
  5. `manufacturerName` 空值时兜底 `'默认'`（`:157`），与去重键 `name|manufacturer`（`:158`）耦合，Excel 里"空厂家"与"厂家=默认"被视为同一商品。

### `getPurchaseOrderDetail()（index.js）` `(行 1-150)`

- **职责**：单张采购单详情（主表 + 明细补供应商名 + 已收累计 + 关联收货单 + 关联报表）。
- **入参**：`authToken` 必填；`orderId` string 必填，缺失 `-1 '订单信息缺失，请返回后重试'`（`:45`）。
- **返回**：`{ code:0, data: { ...order, created_by_name, items, receipts, reports } }`（`:135-143`）。`items[]` 为 `purchase_order_item` 全字段 + `supplier_name`（chef 除外，`:86-96`）+ `received_total` + `remaining_qty`（`:113-116`）；`receipts[]` 为 `receipt` 全字段；`reports[]` 为 `report_file` 全字段（chef 仅 `report_scope==='store'`，`:131-133`）。
- **失败**：`-401`（`:43`）、`-403` 三类（`:60`/`:62`/`:65`）、`-1` 缺 orderId（`:45`）/订单不存在（`:54`）。
- **读取的集合**：`app_user`（`:16-27`）；`purchase_order` where `{ purchase_order_id }` limit 1（`:48-51`）；`app_user` where `{ user_id: order.created_by }` limit 1（`:70-73`，仅当缺 `created_by_name`）；`purchase_order_item` where `{ purchase_order_id }` limit **1000**（`:78-81`）；`supplier` where `{ supplier_id: _.in(chunk20) }` limit **100**（`:90-93`）；`receipt_item` where `{ purchase_order_item_id: _.in(itemIds) }` limit **1000**（`:103-106`）；`receipt` where `{ purchase_order_id }` limit **100**（`:120-123`）；`report_file` where `{ source_order_id }` limit **100**（`:127-130`）。
- **权限与数据可见范围**：全局角色不限；`store_manager` 限 `order.store_id === user.default_store_id`（`:61`）；`chef` 额外限 `order.created_by === (user.user_id || user._id)`（`:64`），与 `createPurchaseOrder/index.js:342-344` 写入口径一致（均为 `user.user_id || user._id`）。
- **调用点**：`purchase-detail.js:23`、`approval-detail.js:24`（purchaser 门禁在前端 `approval-detail.js:17`）、`purchase-create.js:57`、`receive-verify.js:17` 与 `:65`。均只传 `{ orderId }`；期望 `items[].item_id/product_id/product_name_snapshot/category_snapshot/unit_snapshot/supplier_id/supplier_name/order_qty/is_manual/remark/received_total/remaining_qty`、`receipts[]`、`reports[]`。
- **契约风险**：
  1. **chef 拿到跨供应商行与收货单**（见 §3）。
  2. `receipt_item` 聚合 limit 1000（`:106`）：同一订单明细数 >1000 时 `received_total` 少算，无提示。
  3. `created_by` 反查 `app_user` 用 `{ user_id: order.created_by }`（`:71`）—— 若历史订单 `created_by` 存的是 `_id`（`createPurchaseOrder/index.js:344` 的 `user._id` 兜底分支），反查失败，`createdByName` 退化为 id 字符串（`:74`）。**低危、静默**。

### `getPurchaseOrders()（index.js）` `(行 1-149)`

- **职责**：采购单分页列表 + 状态计数。
- **入参**：`authToken`；`role`（**声明但未使用**，`:43`）；`storeId`/`createdBy` 仅对全局角色生效（`:62-63`）；`orderStatus`（`:70-77`，支持虚拟值 `to_verify`、`receivable`）；`orderDate`（`:78`）；`page` clamp `[1,1000]`（`:44`）；`pageSize` clamp `[1,100]`（`:45`）。
- **返回**：`{ code:0, data: orders[], total, page, pageSize, statusCounts }`（`:143`）。`orders[]` = `purchase_order` 全字段 + `created_by_name`（`:139`）+ `items[]`（`:140`）。`statusCounts` 固定 9 键：`all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable`（`:96-106`）。
- **失败**：`-401`（`:42`）、`-403` 门店未绑定（`:53`/`:58`）/角色无权（`:65`）/`to_verify` 非全局（`:71`）。
- **读取的集合**：`app_user`（`:16-27`）；`purchase_order` 9 次 `count()`（`:84-95`，`baseQuery` 剔除 `order_status`/`verify_status`）；`purchase_order` `.where(query).count()`（`:108`）；`purchase_order` `.where(query).orderBy('created_at','desc').skip((page-1)*pageSize).limit(pageSize)`（`:109-114`）；`purchase_order_item` where `{ purchase_order_id: _.in(chunk20) }` limit **1000**（`:121-124`）；`app_user` where `{ user_id: _.in(chunk20) }` limit **100**（`:134`）。
- **权限与数据可见范围**：chef = 本店 + 本人创建（`:54-55`，`created_by` 服务端派生，**忽略前端 `createdBy`**）；store_manager = 本店（`:59`）；全局 = 全量，可叠加 `storeId`/`createdBy` 收窄（只收窄不放大）。
- **调用点**：`purchase-list.js:71`（期望 `data/total/statusCounts`，`:80-84`）；`approval-list.js:22`（`pageSize:100`）；`index.js:42`（`pageSize:3`）；`receive-list.js:20`（`pageSize:100`）。
- **契约风险**：
  1. `orderBy('created_at','desc')` **排序键非唯一**（`created_at` 为 `db.serverDate()`，`createPurchaseOrder/index.js:383`），同秒订单跨页会重复/漏取。
  2. 明细 `limit(1000)` 按 20 单分块（`:123`）：单块明细 >1000 条静默截断。
  3. `page` 上限 1000 × `pageSize` 100 = 理论 10 万，但每页并行 10 次查询 + 分块查，深翻页成本不可控（无提示）。

### `updateProductPrice()（index.js）` `(行 1-139)`

- **职责**：设置某供应商某商品当日现价（事务内翻转 `is_current` + 插入新价），并统计在途波及单数。
- **入参**：`authToken`；`supplierId`/`productId`/`newPrice` 必填（`:73`）；`newPrice` 须为 `Number.isFinite && > 0`（`:76-79`）；`effectiveDate` 可选，**必须等于服务端 UTC+8 当天**（`:81-84`）；`dryRun === true` 只校验+计数（`:99`）；`updatedBy` 可选（`:126`）。
- **返回**：落库 `{ code:0, data: { priceId, affectedOrders, message:'价格已更新' } }`（`:133`）；dryRun `{ code:0, data: { dryRun:true, affectedOrders } }`（`:100`）。
- **失败**：`-401`（`:69`）、`-403`（`:70`）、`-1` 缺参（`:74`）/价非法（`:78`）/非当天（`:84`）/格式无效（`:88`）/供应商不存在或停用（`:94`）/商品不存在或停用（`:95`）。
- **读取的集合**：`app_user`（`:16-27`）；`supplier` where `{ supplier_id, status:1 }` limit 1（`:91`）；`product` where `{ product_id, status:1 }` limit 1（`:92`）；`purchase_order_item` where `{ supplier_id, product_id }` limit **1000**（`:46-49`）；`purchase_order` where `{ purchase_order_id: _.in(chunk20), order_status: _.in(INFLIGHT_ORDER_STATUS) }` `count()`（`:54-56`）；`supplier_product_price` where `{ supplier_id, product_id, is_current:1 }` limit **100**（`:107-110`）。事务：`db.runTransaction`（`:106`）。
- **权限与数据可见范围**：仅 `super_admin`/`purchaser`（`:70`）；全局角色本可跨供应商调价，无归属校验需求。
- **调用点**：`price-manage.js:135-141`（`dryRun:true`，期望 `data.affectedOrders`）；`:155-160`（实际提交，期望 `data.affectedOrders`）；`:210-215`（新增定价，同样期望 `affectedOrders`）。三处均**不校验 `effectiveDate`**（服务端兜底）。
- **契约风险**：
  1. `countInflightOrders` 明细 limit 1000（`:48`）：波及单数可被低估，导致前端"调价前提示"漏报。
  2. `countInflightOrders` catch 后 `return 0`（`:60-63`）：查询失败被静默当作"无波及"，前端会显示"价格已更新"而不是提示风险。
  3. `priceId = 'PRC_' + Date.now()`（`:103`）在事务**外**生成、**无随机后缀**（对比 `importProducts:175` 的 `randomBytes(4)`），并发提交同一商品时 `price_id` 可重复。
  4. 事务内 `limit(100)` 翻转 `is_current`（`:109`）：单商品若已有 >100 条 current 行，会残留双 current。
  5. `updated_by` 兜底链 `user.user_id || user._id || updatedBy || 'system'`（`:126`）—— `user` 必存在，`updatedBy` 分支**不可达**（见 §7）。
  6. `today` 用 `new Date(Date.now() + 8*3600*1000)` 取 UTC+8（`:81`），而订单日期等字段若按其它时区写入会产生口径错位（**未验证**：仓库内其它日期口径 —— 见 §8）。

### `getSupplierOrders()（index.js）` `(行 1-138)`

- **职责**：供应商视角订单列表（仅含自己的明细行）。
- **入参**：`authToken`；`confirmStatus`（`:112-114`，`'all'` 为不过滤）；`orderDate`（`:101`）；`page` clamp `[1,1000]`（`:67`）；`pageSize` clamp `[1,100]`（`:68`）。
- **返回**：`{ code:0, data, total, page, pageSize, statusCounts }`（`:132`）；空数据早退 `{ code:0, data:[], total:0, page, pageSize, statusCounts:{all:0,pending:0,confirmed:0,shipped:0,done:0,cancelled:0} }`（`:79-86`）。`data[]` = `purchase_order` 全字段 + `my_confirm_status`（`:105`）+ `items[]`（只含本供应商行，`:127-130`）。`statusCounts` 固定 6 键 `all/pending/confirmed/shipped/done/cancelled`（`:107`）。
- **失败**：`-401`（`:61`）、`-403` 非 supplier（`:62`）/未关联供应商（`:64`）。
- **读取的集合**：`app_user`（`:25-46`）；`purchase_order_item` where `{ supplier_id, is_manual: _.neq(true) }` limit **1000**（`:72-76`）；`purchase_order` where `{ purchase_order_id: _.in(chunk20) }` limit **100**（`:94-97`）；**内存**过滤 `HIDDEN_ORDER_STATUS`（`:100`）、`orderDate`（`:101`）、`confirmStatus`（`:112-114`）；**内存**排序（`:117`）与**内存**分页（`:119`）。
- **权限与数据可见范围**：`supplier_id` 一律取自 `user.default_supplier_id`（`:63`），**前端无 supplierId 参数**，无法冒充。
- **调用点**：`supplier-orders.js:68`（`{ confirmStatus: this.data.activeTab, page, pageSize }`）；`supplier-home.js:85`（`{ page:1, pageSize:1 }`，只取 `statusCounts`，`:86-91`）。
- **契约风险**：
  1. **硬 limit 1000、无分页**（`:73-76`）：单供应商累计明细 >1000 行时，尾部明细所属订单**整单消失**，且 `total`/`statusCounts` 一起错（因为它们都基于 `myItems`）。
  2. **排序非时间序**：`:117` `filtered.sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||'')))`。`purchase_order.created_at` 是 `db.serverDate()`（`createPurchaseOrder/index.js:383`）→ 反序列化为 JS `Date`，`String(Date)` 形如 `"Tue Oct 06 2026 16:00:00 GMT+0800"`，`localeCompare` 按**星期名/月份名**比较，不是时间先后。
  3. 主表取回后**无 `supplier_confirmations` 之外的供应商信息过滤**：返回整份 `purchase_order` 文档，含 `supplier_confirmations` 全部键（**其它供应商的确认状态**）—— 见 §3。
  4. `orderDate` 过滤在内存（`:101`），但 `total` 基于过滤后集合（`:118`），口径自洽；`statusCounts` 基于 `visible` 而非 `filtered`（`:107`），即 tab 计数不受当前 tab 影响 —— 这是设计。

### `getSupplierReceipts()（index.js）` `(行 1-120)`

- **职责**：供应商视角收货明细（对账用，含单价快照、金额、异常裁决）。
- **入参**：`authToken`；`page` clamp `[1,1000]`（`:49`）；`pageSize` clamp `[1,100]`（`:50`）。**无日期/状态参数**（注释 `:52` 说明 `receipt_item` 无 `receipt_date`）。
- **返回**：`{ code:0, data, total, page, pageSize }`（`:114`）；空集早退 `{ code:0, data:[], total, page, pageSize }`（`:64`）。`data[]` = `receipt_item` 全字段 + `receipt_date/store_id/store_name/purchase_order_id`（来自 `receipt` 主表，`:105-108`）+ `amount`（`:109`）+ `abnormals[]:{type,status,resolution,payment_decision}`（`:90-95`）。
- **失败**：`-401`（`:44`）、`-403` 非 supplier（`:45`）/未关联（`:47`）。
- **读取的集合**：`app_user`（`:13-38`）；`receipt_item` where `{ supplier_id, is_manual: _.neq(true) }` `.count()`（`:56`）；`receipt_item` where 同上 `.orderBy('created_at','desc').skip((page-1)*pageSize).limit(pageSize)`（`:57-62`）；`receipt` where `{ receipt_id: _.in(chunk20) }` limit **100**（`:71-74`）；`abnormal_record` where `{ receipt_id: _.in(chunk20), supplier_id }` limit **1000**（`:83-86`，字段与 `createReceipt/index.js:541-557` 一致：`type/status/resolution/payment_decision` 中 `payment_decision` 由 `dataService` 的 `resolveAbnormal` 后写）。
- **权限与数据可见范围**：`supplier_id` 服务端派生（`:46`），`abnormal_record` 查询同时带 `supplier_id`（`:84`）—— 异常记录不会跨供应商泄漏。
- **调用点**：`supplier-receipts.js:39-42`，传 `{ page, pageSize }`；期望 `received_qty`、`order_qty_snapshot`、`payable_flag`、`is_manual`、`price_snapshot`、`amount`、`receipt_date`、`store_name`、`purchase_order_id`、`abnormals[].payment_decision`（`:48-65`）。
- **契约风险**：
  1. **本页范围内 join，跨页不可见**：`receiptMap`/`abnormalMap` 只覆盖当前页 `receiptIds`（`:67`/`:79`），这是正确做法；但 `abnormal_record` 的 `receipt_id` 只在本页 20 条批次内查，**分页翻页后同一行的异常列表不受影响**（无风险，仅记录）。
  2. `receipt_item` 上 `is_manual` 可能不存在字段 → `_.neq(true)` 在腾讯云开发中**对缺失字段不返回**，故手动行不会被误纳入（依赖此语义，**未验证 SDK 精确行为** —— 见 §8）。
  3. `payment_decision` 直接下发（`:94`）：`reject`/`pay_received` 语义对供应商是黑盒，且异常未关闭时也暴露内部裁决。

### `getReports()（index.js）` `(行 1-104)`

- **职责**：报表列表分页查询。
- **入参**：`authToken`；`role`/`storeId`（**声明未使用**，`:43`）；`reportScope` 枚举 `store|supplier`，非法 `-1`（`:46`）；`reportType` 8 值白名单，非法 `-1`（`:68-76`）；`relatedDate` `^\d{4}-\d{2}-\d{2}$`，非法 `-1`（`:47`）；`page` clamp `[1,1000]`（`:88`）；`pageSize` clamp `[1,50]`（`:89`）。
- **返回**：`{ code:0, data, total, page, pageSize }`（`:98`）。`data[]` = `report_file` 全字段（含 `file_url`、`abnormal_summary`）。
- **失败**：`-401`（`:42`）、`-1` scope 非法（`:46`）/日期非法（`:47`）/类型非法（`:74`）、`-403` 门店未绑定（`:54`/`:59`）/角色无权（`:65`）。
- **读取的集合**：`app_user`（`:11-36`）；`report_file` `.where(query).count()`（`:90`）；`report_file` `.where(query).orderBy('generated_at','desc').skip().limit(pageSize)`（`:91-96`）。
- **权限与数据可见范围**：chef → `report_scope:'store'` + `report_type:'store_order_report'` + `scope_id:default_store_id`（`:52-55`，并在 `:79-83` **二次强制覆盖**，注释 `:78` "Client filters can narrow results but cannot expand role scope"）；store_manager → `report_scope:'store'` + `scope_id`（`:57-60`、`:83-86`）；purchaser/super_admin → 全量，可用 `reportScope` 收窄（`:63`）。**`supplier` 角色无任何入口**（`:65` -403）。
- **调用点**：`index.js:48`（不传 page，取首页）；`report-list.js:73-80`（传 `reportType/relatedDate/page/pageSize`，期望 `data[].report_type/abnormal_summary`，`:83-84`）；`report-history.js:60-68`（额外传 `reportScope`）。
- **契约风险**：`orderBy('generated_at','desc')` 排序键非唯一（报表可按日批量生成），跨页可重复/漏取。

### `getSuppliers()（index.js）` `(行 1-97)`

- **职责**：供应商列表（供应商本人只见自己；管理侧见全量 + 商品计数）。
- **入参**：`authToken`；`status`（`:58`）；`keyword` 对 `supplier_name` 做正则（`:60-62`，`options:'i'`）；`includeInactive`（`:43`/`:54`）。
- **返回**：`{ code:0, data: [...supplier, product_count] }`（`:51` 供应商分支固定 `product_count:0`；`:85-91` 全量分支）。**无 total、无 page/pageSize**。
- **失败**：`-401`（`:42`）、`-403` 供应商未关联（`:46`）、`-403` 非管理看停用（`:54`）。
- **读取的集合**：`app_user`（`:11-36`）；供应商分支 `supplier` where `{ supplier_id: user.default_supplier_id }` limit 1（`:47-50`）；全量 `supplier` where `query` `.orderBy('supplier_name','asc').limit(100)`（`:64-68`）；`product` where `{ default_supplier_id: _.in(chunk20) }` limit **1000**（`:76-79`）。
- **权限与数据可见范围**：**`chef`/`store_manager` 无任何门禁**，直接走 `:64-91` 全量分支（含 `contact_name`/`contact_phone`/`address`）。
- **调用点**：`product-manage.js:39`（`includeInactive:true`）、`price-manage.js:34`（`includeInactive:true`）、`user-manage.js:37`（`{}`，只用 `supplier_id→supplier_name` 映射，`:41-47`）、`supplier-manage.js:22`（`includeInactive:true`，前端再按 `supplierName/contactName` 内存过滤，`:30-33`）。
- **契约风险**：
  1. **无角色门禁**（见 §3）。
  2. `limit(100)`（`:67`）**无分页、无 total**：供应商 >100 家时静默截断，`supplier-manage` 前端会显示"已加载全部"。
  3. `keyword` 未做正则元字符转义（`:61`），前端传入 `*` 之类会放大结果集。
  4. `product_count` 语义是"**默认供应商**为它的商品数"（`:76-81`），不是"该供应商可供货商品数"；供应商本人分支恒为 0（`:51`），同一字段两种含义。
  5. `user-manage.js:37` 传 `{}` → `query.status=1`（`:59`），停用供应商关联的用户显示"未关联"。

### `getReceipts()（index.js）` `(行 1-93)`

- **职责**：收货单列表 + 明细。
- **入参**：`authToken`；`role`/`storeId`（**声明未使用**，`:44`）；`receiptDate`（`:61`）；`page` clamp `[1,1000]`（`:45`）；`pageSize` clamp `[1,100]`（`:46`）。
- **返回**：`{ code:0, data, total, page, pageSize }`（`:87`）；chef 分支 `{ code:0, data:[], total:0 }`（`:52`，**无 page/pageSize**）。`data[]` = `receipt` 全字段 + `items[]`。
- **失败**：`-401`（`:43`）、`-403` 门店未绑定（`:54`）/角色无权（`:57`）。
- **读取的集合**：`app_user`（`:12-37`）；`receipt` `.count()`（`:63`）；`receipt` `.where(query).orderBy('created_at','desc').skip().limit(pageSize)`（`:64-69`）；`receipt_item` where `{ receipt_id: _.in(chunk20) }` limit **1000**（`:76-79`）。
- **权限与数据可见范围**：chef → 空集（`:50-52`，注释"下单人员不看收货记录"）；store_manager → `query.store_id = user.default_store_id`（`:55`）；purchaser/super_admin → `query = {}` 全量（`:59`）；supplier → -403（`:56`）。
- **调用点**：仅 `receive-list.js:26-31`，传 `{ role, storeId, page:1, pageSize:5 }`。
- **契约风险**：chef 分支返回形状与正常分支不一致（`:52` vs `:87`）—— 消费方若解构 `page`/`pageSize` 得 `undefined`。

### `getProductPrices()（index.js）` `(行 1-90)`

- **职责**：供应商商品价格列表（补商品名与单位）。
- **入参**：`authToken`；`supplierId`（仅管理角色生效，`:52`）；`productId`（`:54`）；`onlyCurrent` → `is_current:1`（`:55`）。
- **返回**：`{ code:0, data }`（`:84`）。`data[]` = `supplier_product_price` 全字段 + `product_name` + `unit`（`:75-82`）。**无 total/page/pageSize**。
- **失败**：`-401`（`:42`）、`-403` 供应商未关联（`:48`）/非管理非供应商（`:51`）。
- **读取的集合**：`app_user`（`:11-36`）；`supplier_product_price` `.where(query).orderBy('effective_date','desc').limit(200)`（`:57-61`）；`product` where `{ product_id: _.in(chunk20) }` limit **100**（`:69-72`）。
- **权限与数据可见范围**：supplier → `query.supplier_id = user.default_supplier_id`（`:49`，注释 `:47` 明确"忽略前端传入的 supplierId"）；管理角色 → 可任意 `supplierId` 收窄；chef/store_manager → -403。
- **调用点**：`price-manage.js:36`（`{ onlyCurrent:true }`）；`supplier-prices.js:30`（`{ onlyCurrent:true }`，期望 `price/product_name/unit`，`:36-40`）。
- **契约风险**：`limit(200)` **无分页无 total**：单价记录 >200 条时静默截断（按 `effective_date desc` 取最新 200，历史价消失，但 `is_current` 行通常在最新，故影响可控）。

### `getProducts()（index.js）` `(行 1-67)`

- **职责**：商品列表查询。
- **入参**：`authToken`；`categoryL1`（`:48`）；`categoryId` → `category_level_2_id` 强转 `Number`（`:49-51`）；`keyword`（`:56-59`，**内存**过滤）；`includeInactive`（`:45`/`:47`）。
- **返回**：`{ code:0, data }`（`:61`）。`data[]` = `product` 全字段。**无 total/page/pageSize**。
- **失败**：`-401`（`:42`）、`-403` 非管理看停用（`:45`）。
- **读取的集合**：`app_user`（`:11-36`）；`product` `.where(where).orderBy('product_name','asc').limit(200)`（`:53`）。
- **权限与数据可见范围**：**无角色门禁**（除 `includeInactive`）—— chef/store_manager/supplier 均可取全量商品主数据。
- **调用点**：`purchase-create.js:126-128`（`{ includeInactive:false }`，chef/store_manager 下单用）；`product-manage.js:37`、`price-manage.js:35`（`{ includeInactive:true }`）。
- **契约风险**：
  1. **`keyword` 在 `limit(200)` 之后做内存过滤**（`:53` 先 limit，`:56-59` 再 filter）：商品 >200 时，命中词但不落在前 200 条的商品**永远查不到**，且无提示。
  2. `limit(200)` 无分页无 total：商品 >200 时列表静默截断。
  3. `categoryId` 强转 `Number`（`:50`）：传入非数字得 `NaN`，`where` 匹配不到 → 空列表，无报错。

### `getReportFileUrl()（index.js）` `(行 1-65)`

- **职责**：把 `report_file.file_url` 换临时下载链接（带二次鉴权）。
- **入参**：`authToken`；`fileId` string 必填，缺失 `-1 '缺少fileId'`（`:43-44`）。
- **返回**：`{ code:0, data: { url } }`（`:57`）。
- **失败**：`-401`（`:42`）、`-1` 缺 fileId（`:44`）/报表文件不存在（`:47`）/获取链接失败（`:59`）、`-403` 无权限（`:51`）/chef 类型不符（`:53`）。
- **读取的集合**：`app_user`（`:11-36`）；`report_file` where `{ file_url: fileId }` limit 1（`:46`）；`cloud.getTempFileURL({ fileList:[fileId] })`（`:55`）。
- **权限与数据可见范围**：全局角色不限；chef/store_manager 须 `report.report_scope === 'store' && report.scope_id === user.default_store_id`（`:50`），chef 再限 `report_type === 'store_order_report'`（`:53`）。**supplier → -403**（不落任何允许分支）。
- **调用点**：仅 `pages/report-detail/report-detail.js:100-102`，传 `{ fileId: report.fileUrl || report.file_url }`，期望 `data.url` 供 `wx.downloadFile` + `wx.openDocument`（`:103-112`）。
- **契约风险**：`fileId` 必须先命中 `report_file.file_url` 再鉴权，因此**不能**用它取任意云文件临时链接（有归属约束）—— 这与 `importProducts` 的 `fileID` 形成对比。

---

## 3. ★ 专项一：数据可见性矩阵

判据全部来自 `where`/角色分支原文。角色：`super_admin` / `purchaser` / `store_manager` / `chef` / `supplier`。

| 函数 | super_admin / purchaser | store_manager | chef | supplier |
|---|---|---|---|---|
| `getReportDetail` | 全部报表；scope_id/orderId 来自报表文档 | 本店 `report_scope='store'` 且 `scope_id=本店` 的报表（`:75`） | 仅本店 **`store_order_report`**（`:75`+`:76`） | -403（`:74`） |
| `importProducts` | 全量商品表（写入） | -403（`:56`） | -403 | -403 |
| `getPurchaseOrderDetail` | 全部订单 | `order.store_id = 本店` 的全部订单（`:61`） | 本店 **且** `created_by = 本人`（`:61`+`:64`） | -403（`:60`） |
| `getPurchaseOrders` | 全部（可加 `storeId`/`createdBy` 收窄） | 本店全部（`:59`） | 本店 + 本人创建（`:54-55`） | -403（`:65`） |
| `updateProductPrice` | 任意供应商×商品 | -403（`:70`） | -403 | -403 |
| `getSupplierOrders` | -403（`:62`） | -403 | -403 | `supplier_id` 下所有未隐藏订单；`items` 仅自己行 |
| `getSupplierReceipts` | -403（`:45`） | -403 | -403 | `supplier_id` 下全部收货明细 + 自己的 `abnormal_record` |
| `getReports` | 全部 | 本店报表（`:58-60`） | 本店 `store_order_report`（`:52-55`，`:79-83` 二次强制） | -403（`:65`） |
| `getSuppliers` | 全部（含停用） | **全部启用供应商（含联系方式）** | **全部启用供应商（含联系方式）** | 仅自己档案（`:47-51`） |
| `getReceipts` | 全部收货单 | 本店收货单（`:55`） | 空集（`:52`） | -403（`:56`） |
| `getProductPrices` | 任意供应商价格 | -403（`:51`） | -403 | 自己名下价格（`:49`） |
| `getProducts` | 全部（含停用） | 全部启用商品 | 全部启用商品 | 全部启用商品 |
| `getReportFileUrl` | 任意报表文件 | 本店 store 作用域报表文件（`:50`） | 本店 `store_order_report` 文件（`:50`+`:53`） | -403（不落允许分支） |

**完全没有角色门禁的（登录后任何角色可达）：2 个** —— `getProducts`（`:44-45` 只有 `includeInactive` 校验，无角色分支）、`getSuppliers`（`:53` 起对 chef/store_manager 无分支）。`importProducts` 有 `MANAGEMENT_ROLES` 门禁（`:83`），不在此列。

**角色门禁存在但数据范围未收敛：**
- `getReports` 对 purchaser/super_admin **无 scope 收敛**（`:61-64`）—— 这是设计（全局角色）。
- `getReceipts` 对 purchaser/super_admin `query = {}`（`:59`）—— 同上。
- **真正的问题在 chef/store_manager 侧**：`getSuppliers` 对 chef/store_manager **既无门禁也无 scope 收敛**，可遍历全量供应商档案（上限 100 条）。

**把不该给该角色的字段返回了的（逐个列字段名）：**

1. **`getSupplierOrders` 对 supplier 多返回：**
   - `supplier_confirmations`（`:127-130` 整份 `purchase_order` 展开，含**其它供应商**的 `{status, updated_at, updated_by}`）—— 与文件头注释 `:1-3`"只返回包含该供货商商品的订单，且每个订单只嵌入该供货商自己的明细，**防止泄漏同一张订单中其他供货商的商品信息**"的边界声明不一致（`items` 确实只嵌自己的，但 `supplier_confirmations` 未删）。
   - `store_id`（本店以外的门店 ID，因为一张订单只属一个门店，此条危害低）；`created_by`/`created_by_name`（内部下单人身份）；`audit_remark`、`verify_*`、`cancel_requested` 等全部内部审核/核销字段。
   - `order.supplier_confirmations` 中其它供应商的 `updated_by`（内部用户 ID）。
2. **`getPurchaseOrderDetail` 对 chef 多返回：**
   - `receipts[]`（`:141`）**未按门店过滤**：`receipt` where 仅 `{ purchase_order_id: orderId }` limit 100（`:120-123`）。chef 能读到该订单的收货单字段：`receipt_status`、`receipted_by`、`receipted_by_name`、`receipt_date`、`total_amount`、`remark` 等（**字段名以 `receipt` 实际 schema 为准，未逐字段核实** —— 见 §8）。
   - `items[]` 中**其它供应商的行**（`:78-81` 未按 `supplier_id` 过滤），含 `product_name_snapshot`/`unit_snapshot`/`order_qty`/`remark`/`received_total`/`remaining_qty`。仅 `supplier_name` 被 `:86` 屏蔽，`supplier_id` 仍下发。
   - `reports[]`（`:142`）：chef 仅按 `report_scope==='store'` 过滤（`:131-133`），但报表元数据仍含 `file_url`、`abnormal_summary`、`has_abnormal`。
   - `order.supplier_confirmations`（整份 `...order` 展开）—— 与 `:84` 注释"chef 不见供应商身份"矛盾。
3. **`getPurchaseOrders` 对 chef/store_manager 多返回：** `supplier_confirmations`、`audit_remark`、`verify_voucher_file_ids`（**凭证文件 ID**，`:53` 注释 S9）、`verify_reject_note` 等内部字段；`items[]` 含其它供应商行与 `supplier_id`。
4. **`getReceipts` 对 store_manager 多返回：** 无（本店范围），但 `items[]` 含 `price_snapshot`/`payable_flag`（本属采购侧结算字段）。
5. **`getSupplierReceipts` 对 supplier 多返回：** `abnormals[].resolution`（内部处理结论）与 `abnormals[].payment_decision`（内部付款裁决，`:93-94`）。
6. **`getProducts` 对 chef/store_manager/supplier 多返回：** 商品主数据全字段（`manufacturer_name`、`default_supplier_id`、`status`）。
7. **`getSuppliers` 对 chef/store_manager 多返回：** `contact_name`、`contact_phone`、`address`、`remark`、`product_count`（全量）。

---

## 4. ★ 专项二：分页与截断普查

| 函数 | limit 字面值 | orderBy | 排序键唯一？ | 分页参数 | 返回 total | 静默截断点 |
|---|---|---|---|---|---|---|
| `getReportDetail` | 明细 1000 / receipt 1 / receipt_item 1000 / order 200 / item(chunk) 1000 | **无** | — | 无 | 无 | 单订单明细 >1000；同日期订单 >200；**同订单 receipt >1 只取 1 张** |
| `importProducts` | category 1000 / supplier 1000 / product 100(循环) | 无 | — | 无 | 无 | 分类或供应商 >1000 时匹配不到（误报"不存在"） |
| `getPurchaseOrderDetail` | order 1 / item 1000 / supplier 100(块) / receipt_item 1000 / receipt 100 / report 100 | 无 | — | 无 | 无 | 明细 >1000；关联收货 >100；关联报表 >100 |
| `getPurchaseOrders` | 列表 pageSize≤100 / item(chunk) 1000 / user 100(块) | `created_at desc` | **否**（`serverDate`） | page[1,1000] / pageSize[1,100] | 有 | 单块明细 >1000；跨页同秒订单重复/漏取 |
| `updateProductPrice` | item 1000 / current 100 | 无 | — | 无 | 无 | 在途明细 >1000 → 波及数低估 |
| `getSupplierOrders` | **item 1000（硬顶）** / order 100(块) | **内存 `String(created_at).localeCompare`（错误排序）** | **否且排序键错误** | page[1,1000] / pageSize[1,100]（内存分页） | 有 | **明细 >1000 行 → 整单消失** |
| `getSupplierReceipts` | count + pageSize≤100 / receipt 100(块) / abnormal 1000(块) | `created_at desc` | **否** | page/pageSize | 有 | 跨页同秒重复/漏取 |
| `getReports` | pageSize≤**50** | `generated_at desc` | **否** | page/pageSize | 有 | 跨页同秒重复/漏取 |
| `getSuppliers` | **100（硬顶）** | `supplier_name asc` | 否（同名供应商） | **无** | **无** | **供应商 >100 家即截断，前端无感知** |
| `getReceipts` | count + pageSize≤100 / item 1000(块) | `created_at desc` | 否 | page/pageSize | 有 | 单块明细 >1000；跨页同秒重复/漏取 |
| `getProductPrices` | **200（硬顶）** | `effective_date desc` | 否 | **无** | **无** | **价格记录 >200 条即截断** |
| `getProducts` | **200（硬顶），且在 keyword 过滤之前** | `product_name asc` | 否 | **无** | **无** | **商品 >200 即截断；且 keyword 只能在前 200 内命中** |
| `getReportFileUrl` | 1 | 无 | — | 无 | 无 | 无 |

**数据量到多少会出现静默截断（估算依据）：**

- **最紧：`getSupplierOrders` 的 1000 行明细硬顶。** 假设平均每单 15 行明细，则单供应商约 **67 张订单**即触顶；订单数继续增长时，最早（按内存分页）的订单整单从列表消失，`total` 与 tab 计数同步变少但**不会超过 1000**。判断依据 `:73-76` limit 1000 + `:118` `total = filtered.length` 全部源自被截断的 `myItems`。
- **`getProducts`/`getProductPrices` 200 硬顶**：商品/价格记录到 200+ 即截断。对一个持续运营的门店采购系统，200 条商品是数周内可达的规模。
- **`getSuppliers` 100 硬顶**：供应商 >100 家。
- **跨页重复/漏取（排序键不唯一）**：`created_at` 由 `db.serverDate()` 写入（`createPurchaseOrder/index.js:383`），同一事务/批量写入的多条记录时间戳可相同；一旦 `purchase_order` 出现**任意两单 `created_at` 相同**，`getPurchaseOrders`/`getReceipts`/`getSupplierReceipts`/`getReports` 的 `skip+limit` 分页即可能重复或漏取，且**数据量小时也能复现**（不需要大量数据）。
- **无 total 的三个函数**（`getSuppliers`、`getProductPrices`、`getProducts`）前端**没有任何手段**发现被截断。

---

## 5. ★ 专项三：客户端可控 ID / 文件路径未做归属校验普查

本批 13 个函数中，客户端传入的 ID/路径参数逐个判定：

| 函数 | 客户端可控参数 | 是否校验 | 证据 |
|---|---|---|---|
| `importProducts` | **`event.fileID`** | **否（零校验）** | `:86` 取值 → `:92` `downloadFile({fileID})` → `:94` `deleteFile({fileList:[fileID]})`，中间无任何前缀/归属判断。上传端正路是 `imports/products/…`（`product-manage.js:169`），服务端未要求 |
| `getReportFileUrl` | `event.fileId` | **是** | `:46` 必须先命中 `report_file.file_url`，再 `:49-53` 角色+scope 二次鉴权 |
| `getReportDetail` | `event.reportId` | **是** | `:62` 查库后 `:72-77` 角色+scope+类型三重校验 |
| `getPurchaseOrderDetail` | `event.orderId` | **是** | `:48` 查库后 `:58-67` 校验 |
| `getPurchaseOrders` | `storeId` / `createdBy` / `orderStatus` / `orderDate` | **是** | 仅在 `isGlobal` 分支使用（`:62-63`）；chef/store_manager 分支完全忽略（`:51-60`） |
| `updateProductPrice` | `supplierId` / `productId` / `effectiveDate` / `updatedBy` | **是（部分）** | `:90-95` 校验存在且 `status:1`；`effectiveDate` `:83` 必须等于服务端当天；`updatedBy` 不参与写库主键（`:126` 兜底） |
| `getSupplierOrders` | `confirmStatus` / `orderDate` | **不涉及归属** | 无 supplierId 入参，`:63` 服务端派生 |
| `getSupplierReceipts` | `page` / `pageSize` | **不涉及归属** | `:46` 服务端派生 |
| `getReports` | `reportScope` / `reportType` / `relatedDate` / `storeId` | **是** | `:46`/`:74` 枚举白名单；`:79-86` 对 chef/store_manager **二次强制覆盖** scope |
| `getSuppliers` | `status` / `keyword` / `includeInactive` | **否（门禁缺口）** | `:43-54`：chef/store_manager 无分支，`keyword` 直达 `db.RegExp`（`:61`） |
| `getReceipts` | `receiptDate` / `storeId` | **是** | `storeId` 声明未用（`:44`），`:55` 服务端派生 |
| `getProductPrices` | `supplierId` / `productId` | **是** | `:49` supplier 分支强制覆盖 `user.default_supplier_id`（注释 `:47`）；`:51` 非管理非供应商 -403 |
| `getProducts` | `categoryL1` / `categoryId` / `keyword` | **否（门禁缺口）** | `:43-45` 只有 `includeInactive` 校验，无角色分支 |

**未校验共 3 处**，按可利用性排序：

1. **`importProducts.event.fileID`（高危，唯一涉及销毁）**：任何 `MANAGEMENT_ROLES` 账号传入任意 fileID → `downloadFile` 读任意云文件内容 + `deleteFile` **删除**该文件。合法路径为 `imports/products/`（`product-manage.js:169`），服务端未做前缀断言。可利用方式：遍历/构造 `cloud://<env>.<bucket>/…` 形式的 fileID，可销毁收货凭证（`receipts/…`，见 `utils/cloud.js:237`）、报表文件（`report_file.file_url`）等任意门店数据。
2. **`getSuppliers` 缺角色门禁（中危，只读遍历）**：chef/store_manager 直接调用可取全量启用供应商档案（含 `contact_name`/`contact_phone`/`address`），且 `keyword` 可带正则元字符。前端 4 个调用方（`product-manage`/`price-manage`/`user-manage`/`supplier-manage`）均为管理侧页面，**chef/store_manager 无前端调用点**（检索方式：Grep `getSuppliers` 于 `pages/**/*.js` 命中 4 处，无 chef 侧页面）—— 即缺口是"直接调用即可利用"，而非前端现存路径。
3. **`getProducts` 缺角色门禁（低危，只读遍历）**：所有角色可取商品主数据全字段（含 `manufacturer_name`、`default_supplier_id`）。但 `purchase-create.js:126` 证明 chef/store_manager 本就**需要**下单选商品，故更可能是设计，不是漏；真正的问题是 `limit(200)` 在前 + `keyword` 在后（见 §2）。

**补充（不在本批文件，但由调用链引入）：** `utils/cloud.js:243-252` 的 `getFileUrl` 与 `:254-268` 的 `getFileUrls` 是**客户端直接** `wx.cloud.getTempFileURL`，完全绕过 `getReportFileUrl` 的二次鉴权。任何登录客户端只要拿到某个 fileID 即可换临时链接（`getPurchaseOrderDetail` 对 chef 下发的 `verify_voucher_file_ids`、`getReportDetail` 下发的 `file_url` 都是可得来源）。**未验证**：小程序端 `getTempFileURL` 是否受云环境访问策略限制 —— 见 §8。

---

## 6. 调用图

**前端 → 本批函数（直接调用，28 处）：**

- `index.js:42` → `getPurchaseOrders`；`index.js:48` → `getReports`
- `approval-list.js:22` → `getPurchaseOrders`；`approval-detail.js:24` → `getPurchaseOrderDetail`
- `purchase-list.js:71` → `getPurchaseOrders`；`purchase-detail.js:23` → `getPurchaseOrderDetail`
- `purchase-create.js:57` → `getPurchaseOrderDetail`；`purchase-create.js:126` → `getProducts`
- `receive-list.js:20` → `getPurchaseOrders`；`receive-list.js:26` → `getReceipts`
- `receive-verify.js:17` → `getPurchaseOrderDetail`；`receive-verify.js:65` → `getPurchaseOrderDetail`
- `report-list.js:73` → `getReports`；`report-history.js:60` → `getReports`
- `report-detail.js:24` → `getReportDetail`；`report-detail.js:100` → `getReportFileUrl`
- `price-manage.js:34` → `getSuppliers`；`:35` → `getProducts`；`:36` → `getProductPrices`；`:135` / `:155` / `:210` → `updateProductPrice`
- `supplier-manage.js:22` → `getSuppliers`；`user-manage.js:37` → `getSuppliers`
- `product-manage.js:37` → `getProducts`；`:39` → `getSuppliers`；`:172` → `importProducts`
- `supplier-prices.js:30` → `getProductPrices`；`supplier-orders.js:68` → `getSupplierOrders`；`supplier-home.js:85` → `getSupplierOrders`；`supplier-receipts.js:39` → `getSupplierReceipts`

**云函数 → 数据库（间接影响，跨集合读）：**

- `getPurchaseOrderDetail` → `purchase_order` + `purchase_order_item` + `supplier` + `receipt_item` + `receipt` + `report_file` + `app_user`（7 集合）
- `getPurchaseOrders` → `purchase_order`（11 次查询：1 count × 9 状态 + 1 count + 1 get）+ `purchase_order_item` + `app_user`
- `getReportDetail` → `report_file` + `purchase_order_item`/`receipt`/`receipt_item`/`purchase_order`（按类型分支）+ 云存储 `downloadFile`
- `getSupplierOrders` → `purchase_order_item` + `purchase_order`
- `getSupplierReceipts` → `receipt_item` + `receipt` + `abnormal_record`
- `updateProductPrice` → `supplier` + `product` + `purchase_order_item` + `purchase_order` + `supplier_product_price`（事务翻转）；**被 `createReceipt` 结算口径依赖**（`effective_date` 现价）
- `importProducts` → `category` + `supplier` + `product`（写）+ 云存储 `downloadFile`/`deleteFile`（销毁）
- `getProducts` / `getSuppliers` / `getProductPrices` / `getReports` / `getReceipts` / `getReportFileUrl` → 单/双集合读

**跨函数写读依赖（本批外，仅记录影响面）：** `updateProductPrice` 写入的 `supplier_product_price.is_current` 被收货结算读取；`importProducts` 写入的 `product` 被 `getProducts`/`getProductPrices`/下单链读取；`getSupplierOrders` 读的 `supplier_confirmations` 由 `confirmSupplierOrder/index.js:73` 写、`dataService/index.js:419` 清空。

---

## 7. 死代码与未闭合点

1. **参数解构后从未引用**：
   - `getReports/index.js:43` `const { role, storeId, reportScope, reportType, relatedDate } = event` —— `role` 与 `storeId` 从未使用（全文无引用）。前端 `index.js:49`、`report-list.js:74`、`report-history.js:61` 均在传，**传了没用**。
   - `getReceipts/index.js:44` `const { role, storeId, receiptDate } = event` —— `role` 与 `storeId` 从未使用。前端 `receive-list.js:27-28` 在传。
   - `getPurchaseOrders/index.js:43` `role` 从未使用（`storeId`/`createdBy`/`orderStatus`/`orderDate` 有用）。前端 4 处均在传 `role`。
2. **不可达分支**：
   - `updateProductPrice/index.js:126` `updated_by: user.user_id || user._id || updatedBy || 'system'` —— `user` 经 `:68-69` 保证非空，且 `getSessionUser` 必然返回带 `_id` 的文档，故 `updatedBy` 与 `'system'` 均不可达。
   - `getSuppliers/index.js:51` 供应商分支恒写 `product_count: 0`（`:51`），与全量分支的 `productCountMap` 语义不一致 —— 非死代码，是同名异义。
3. **无 else 兜底的 if 链（未闭合分支）**：
   - `getReportDetail/index.js:84-254`：6 个 `else if` 覆盖 7 种 `report_type`，**没有 else**。未匹配类型 → `rows=[]` + `code:0`。
   - `getReportDetail/index.js:207` `if (report.file_url)`：汇总报表文件缺失 → `rows=[]` + `code:0`（静默空表）。
4. **catch 吞错**：
   - `updateProductPrice/index.js:60-63`：`countInflightOrders` catch → `return 0`，波及单数被静默归零。
   - `importProducts/index.js:94`：`deleteFile` 失败仅 `console.error`，不向调用方暴露。
   - 全 13 个函数的外层 `try/catch` 一律 `return { code:-1, msg:… }`（如 `getReportDetail:257-260`、`getPurchaseOrders:144-147`、`getReports:99-102`、`getSuppliers:92-95`、`getReceipts:88-91`、`getProductPrices:85-88`、`getProducts:62-64`、`getReportFileUrl:60-63`、`getPurchaseOrderDetail:145-148`、`getSupplierOrders:133-136`、`getSupplierReceipts:115-118`）—— `utils/cloud.js:72-75` 另有一层把网络错误归一成 `code:-1` + `errorType`。
5. **可能不前进的循环**：`importProducts/index.js:121-126` `skip(offset).limit(100)` 全表分页，若页边界存在删除竞态，`batch.data.length` 可能恒为 100 → 死循环（未复现，仅从代码结构判断）。
6. **`getReportDetail` 的 `ABNORMAL_TYPE_NAMES` / `getAbnormalTypeNames`**（`:12-24`）被两个分支共用（`:111`、`:182`），非死代码。

---

## 8. 未验证清单

1. **`receipt` 集合字段全集**（`getPurchaseOrderDetail:141` 下发的 `receipts[]` 究竟含哪些字段，如 `receipted_by`/`total_amount`）—— 未读 `createReceipt` 全文。验证方式：读 `cloudfunctions/createReceipt/index.js` 的 receipt 主表 `add({data:{…}})` 处。
2. **`abnormal_record.payment_decision` 的写入方**：`createReceipt/index.js:541-557` 未写该字段，推测由 `dataService` 的 `resolveAbnormal` 写入（grep 命中 `dataService` 含该字段）。验证方式：读 `dataService/index.js` 的 `resolveAbnormal` 实现。
3. **`_.neq(true)` 对缺失字段的行为**（`getSupplierOrders:72`、`getSupplierReceipts:54`）：代码注释 `:71`/`:53` 自称"双保险"，依赖"缺失字段不等于 true"。腾讯云开发文档行为未在本次核实。
4. **`String(Date).localeCompare` 的运行时输出**（`getSupplierOrders:117`）：§2 的"非时间序"结论基于 `String(new Date())` 形如 `"Tue Oct 06 2026 16:00:00 GMT+0800"` 的通用行为；未实际运行 Node 验证 localeCompare 的比较序（可能因 ICU 数据缺失退化为字典序，两种情况都非时间序）。
5. **`updateProductPrice:81` 的 `+8*3600*1000` 时区口径**：仓库内其它日期字段（`order_date`/`receipt_date`/`generated_at`）的写入时区未全量核实，无法确认是否全局统一 UTC+8。
6. **`purchase_order.created_by` 的历史取值**：`createPurchaseOrder/index.js:342-344` 存在 `existingOrder.created_by` 与 `user._id` 兜底，故历史数据中 `created_by` 可能是 `_id` 而非 `user_id`，影响 `getPurchaseOrderDetail:64` 的 chef 归属判断与 `getPurchaseOrders:55` 的 chef 过滤。是否真的存在此类记录需查库。
7. **前端 wxml 侧对 rows 字段的实际引用**：本报告只核对了 `.js` 的 setData 与 `utils/cloud.js` 归一化函数；`pages/report-detail/report-detail.wxml` 未读，故"前端靠这些字段渲染"以 `.js` 层证据为准。
8. **`wx.cloud.getTempFileURL` 客户端直连是否受云环境访问策略限制**（§5 补充项）—— 属平台行为，代码内无法确认。
9. **`report_file.file_url` 的取值集合**：是否恒为云存储 fileID（决定 `getReportDetail:209` 的 `downloadFile` 是否可能拿到非预期路径）—— 需查报表生成函数。

---

## 9. 行数对账

| 文件 | 分配表 | 实际 Read 输出末行 | 正文（末行-1，末尾空行） |
|---|---|---|---|
| getReportDetail | 261 | 262 | 261 |
| importProducts | 213 | 214 | 213 |
| getPurchaseOrderDetail | 149 | 150 | 149 |
| getPurchaseOrders | 148 | 149 | 148 |
| updateProductPrice | 138 | 139 | 138 |
| getSupplierOrders | 137 | 138 | 137 |
| getSupplierReceipts | 119 | 120 | 119 |
| getReports | 103 | 104 | 103 |
| getSuppliers | 96 | 97 | 96 |
| getReceipts | 92 | 93 | 92 |
| getProductPrices | 89 | 90 | 89 |
| getProducts | 66 | 67 | 66 |
| getReportFileUrl | 64 | 65 | 64 |
| **合计** | **1615** | **1617** | **1615** |

差值 2 行 = 2 个文件末尾多出一个空行（`getReportDetail` 与 `importProducts`），其余 11 个文件与分配表**完全一致**。额外读取：`utils/cloud.js` 283 行（全）。

**结论：** 13/13 文件全行覆盖，无跳读、无抽样。
