# 深度探索 03：商品与价格域

- 探索日期：2026-10-04
- 分支：backup（只读，未修改任何源文件）
- 覆盖范围：`getProducts` / `getProductPrices` / `updateProductPrice` / `importProducts` 四个云函数，`product-manage` / `price-manage` / `supplier-prices` / `index` 四个页面，`seed-data` 三份商品域种子 + 导入模板文档
- 为取证额外只读参考：`createPurchaseOrder/index.js`、`createReceipt/index.js`（价格快照写入侧）、`dataService/index.js`（商品写入/分类）、`utils/cloud.js`、`utils/util.js`、`seed-data/purchase_order_item.json`、`seed-data/receipt_item.json`

---

## 0. 概览（结论先行）

1. **商品不分门店，价格挂在「供应商 × 商品」维度**。`product` 表无 `store_id`，是全局商品档案；`supplier_product_price` 由 `supplier_id + product_id` 唯一定位价格。`storeId` 从不出现在商品/价格链路的任何一次调用里。
2. **「价格快照」实际落在 `receipt_item.price_snapshot`，不在 `purchase_order_item`**——这与本次任务的预设不符，是本次最重要的发现。下单时（`createPurchaseOrder`）只快照商品名/分类/单位/数量，**不快照价格**；价格快照发生在收货时（`createReceipt`），口径是「收货日及之前最新一档协议价」。
3. 因此 `updateProductPrice` 改价**不影响**：已收货明细的金额（`receipt_item.price_snapshot` 已固化）、已生成的带价报表；**会影响**：尚未收货的在途订单（收货时才取价，必然按新价）。这条链路整体口径自洽。
4. **改价有留痕，但只有"人+时间"，没有"原因"，也没有独立审计表**。旧价不是被删，而是靠 `is_current: 0` 的历史价格行留存（旧 `price` 值仍在旧行里），可反推原值，但没有 `change_reason` / `previous_price` 字段，也没有独立 `audit` 集合。
5. `importProducts` 是**纯商品资料导入，完全不支持价格导入**——价格只能逐条手工录入，这是规模化运营时的最大人工成本瓶颈，且无任何批量入口。
6. 无 SKU 字段（只有"名称+厂家"判重）、无最小起订量、无阶梯价、无税率字段——全项目 grep 均无命中。
7. `supplier` 角色**完全不能改价**：`updateProductPrice` 直接拒绝非 super_admin/purchaser（`updateProductPrice/index.js:70`），`getProductPrices` 强制把 supplier 的查询锁定到自己名下（`getProductPrices/index.js:46-49`），`supplier-prices` 页只读无编辑控件。三处交叉验证，改价权限收敛正确。

---

## 1. 数据模型与关系

### 1.1 三张表字段

**`product`**（来源：`seed-data/product.json` 12 行；写入侧 `dataService/index.js:107-127`、`importProducts/index.js:174-187`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `product_id` | string | `P` + `Date.now()` + 随机 hex（import 用 4 字节=`importProducts/index.js:175`；手工新增用 3 字节=`dataService/index.js:125`） |
| `product_name` | string | |
| `category_level_1` | string | 一级分类编码，`kitchen` / `front`（**不是名称**） |
| `category_level_2_id` | number | 二级分类外键 → `category.category_id` |
| `category_name` | string | 二级分类名称，**冗余存储** |
| `unit` | string | 文本单位（斤/棵/瓶/箱…），无单位主数据 |
| `spec` | string | 规格，自由文本，可为空 |
| `default_supplier_id` | string | **可空**；指向 `supplier.supplier_id`，用于下单时自动归供应商 |
| `manufacturer_name` | string | 厂家/品牌，空则 `"默认"` |
| `status` | 0/1 | 软删标记 |
| `created_at` / `updated_at` | serverDate | |

**无**：`store_id`（商品不分门店）、`sku`、`min_order_qty`、`tax_rate`、`cost`、`barcode`。

**`category`**（`seed-data/category.json` 12 行）：`category_id`(int，全局唯一) / `category_level_1` / `category_level_1_name` / `category_level_1_icon` / `category_name` / `sort_no` / `icon` / `status`。两级结构，一级分类只在编码上区分，名称与图标**冗余写在每个二级分类行上**。注意 `sort_no` 在一级分类内唯一（后厨 1-8、前厅 1-4），**跨一级不唯一**。

**`supplier_product_price`**（`seed-data/supplier_product_price.json` 12 行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `price_id` | string | `'PRC_' + Date.now()`（`updateProductPrice/index.js:103`，**无随机后缀**） |
| `supplier_id` | string | 供应商维度 |
| `product_id` | string | 商品维度 |
| `price` | number | 单价，CNY，**浮点，未限小数位** |
| `currency` | string | 恒为 `'CNY'`（`updateProductPrice/index.js:122`） |
| `effective_date` | **string** `YYYY-MM-DD` | 恒等于改价当天（不支持预约调价） |
| `expiry_date` | null | **新写入恒为 null**（`updateProductPrice/index.js:124`）；仅历史种子行有值（`PRC001` = `2026-07-31`） |
| `is_current` | 0/1 | 当前价标记 |
| `updated_by` | string | 改价人（服务端优先 `user_id`） |
| `created_at` / `updated_at` | serverDate | |

**无**：门店维度、起订量、阶梯/区间价、税率、调价原因。

### 1.2 关系图

```
                category (category_id PK, 两级)
                     ▲  N:1
                     │ category_level_2_id
        ┌────────────┴───────────┐
        │         product         │  （全局商品档案，无 store_id）
        │   product_id PK         │
        └────┬──────────────┬─────┘
             │              │ default_supplier_id (可空)
             │              ▼
             │          supplier ──┐
             │                     │
             └──── 1:N ──► supplier_product_price ── N:1 ─┘
                          (supplier_id + product_id)
                          is_current 指向唯一当前价，
                          历史行 is_current=0 留存原价

  ┌─ store ──┐        purchase_order (store_id, order_status)
  └──────────┘              │ 1:N
                            ▼
                 purchase_order_item            ◄── 下单快照，无价格
                 (product_id, product_name_snapshot,
                  category_snapshot, unit_snapshot,
                  supplier_id, order_qty, is_manual)
                            │ 1:N（可按 purchase_order_item_id 分批收货）
                            ▼
                 receipt_item                   ◄── 价格快照在这里
                 (received_qty, order_qty_snapshot,
                  unit_snapshot, price_snapshot, payable_flag)
```

**关键：价格快照的时间锚点是"收货日"，不是"下单日"。** 依据 `createReceipt/index.js:353-359`：按 `effective_date <= 收货日` 取最新一档，同日多行时优先 `is_current`（`:362-368`）；写入 `receipt_item.price_snapshot`（`:499`）。种子数据可验证：`receipt_item.json` 第 1 行 `price_snapshot: 2.8`（`received_qty: 28`，`order_qty_snapshot: 30`）与 `supplier_product_price.json` 中 `P003/SUP001` 的 `price: 2.8` 一致。

---

## 2. 四个云函数逐一分析

### 2.1 `getProducts`（66 行）

- 会话校验：与其余函数一致的多设备 `sessions` 数组 + 旧单会话字段兼容（`getProducts/index.js:11-37`）。
- 角色：无角色白名单，**只有 `includeInactive` 一条门禁**——非 `super_admin`/`purchaser` 传 `includeInactive` 返回 `-403`（`:44-45`）；普通查询任何已登录角色（含 `supplier`、`chef`）都放行（`:47`）。
- 过滤：`category_level_1`（字符串）、`category_level_2_id`（经 `Number()` 强转，`:49-51`）；`status` 仅在"非管理层"或"未请求含停用"时加（`:47`）。
- 排序 `product_name asc` + `limit(200)`（`:53`），**无任何分页参数**。
- 搜索：`keyword` 在 `limit(200)` **之后**做内存过滤（`:56-59`）。

### 2.2 `getProductPrices`（89 行）

- 供应商隔离是**服务端强制**的：`supplier` 角色忽略前端传入的 `supplierId`，直接用 `user.default_supplier_id` 覆盖查询条件（`getProductPrices/index.js:46-49`）；未关联供应商返回 `-403`。管理层若传 `supplierId` 才用传入值（`:50-53`）。
- `onlyCurrent: 1` → `is_current: 1`（`:55`）。
- 排序 `effective_date desc` + `limit(200)`，**无分页**（`:57-61`）。
- 返回前回填商品名/单位：按 `product_id` 分 20 个一批回查 `product`（`:63-74`），`product_name` 回退顺序 `product.product_name || product.name || item.product_id`（`:79`）。
- **注意**：价格查询**完全不检查 `product.status`**。软删商品的协议价照常返回，但名称回退成 `product_id`。

### 2.3 `updateProductPrice`（138 行）

写路径的完整门禁链：

1. 角色：仅 `super_admin` / `purchaser`（`:70`）——`supplier` 与 `chef`/`store_manager` 均被拒。
2. 必填：`supplierId`、`productId`、`newPrice`（`:73-75`）。
3. 数值：`Number()` 转 + `isFinite` + `> 0`（`:76-79`）。
4. **仅允许当天生效**：`today` 按 UTC+8 计算（`:81`），传入 `effectiveDate !== today` 直接拒绝（`:83-85`）。注释明示"S5 拍板：不支持预约调价"。
   - 附注：`:86-89` 的日期格式正则校验因为 `:83` 已强制等于 `today`（`today` 本身格式合法）而**实际不可达**，是死代码。
5. 关联存在性：`supplier.status=1` 且 `product.status=1`（`:90-95`）。
6. `dryRun: true` 只校验+计数不落库（`:97-101`），供前端先弹"调价波及提醒"。
7. 落库在 `db.runTransaction` 内（`:106-131`）：先把该「供应商+商品」所有 `is_current: 1` 行改为 0（`:107-115`，`limit(100)`），再插入新当前价（`:116-130`）。
8. `updated_by` 优先级：`user.user_id || user._id || updatedBy || 'system'`（`:126`）——**服务端优先用 user_id**，前端传来的显示名只是兜底，抗伪造性正确。

`countInflightOrders`（`:43-64`）：按 `purchase_order_item.{supplier_id, product_id}` 取明细（`limit(1000)`），去重订单号后按 20 个一批 `count` 在途订单；在途定义 `['submitted','pending_approval','approved','report_generated','partial_received','to_receive']`（`:43`）；异常时按 0 处理（`:60-63`）。

### 2.4 `importProducts`（213 行）—— 见第 4 节详述

---

## 3. 价格快照与审计链

### 3.1 快照机制（修正任务预设）

| 时点 | 落库位置 | 快照字段 | 是否含价格 |
|---|---|---|---|
| 下单（`createPurchaseOrder`） | `purchase_order_item` | `product_name_snapshot` / `category_snapshot` / `unit_snapshot` / `supplier_id` / `order_qty` / `is_manual`（`createPurchaseOrder/index.js:352-364`） | **否** |
| 收货（`createReceipt`） | `receipt_item` | `received_qty` / `order_qty_snapshot` / `unit_snapshot` / **`price_snapshot`** / `payable_flag`（`createReceipt/index.js:499`；种子 `receipt_item.json` 3 行） | **是** |
| 报表 | `report_file`（CSV） | 金额现场算：`Math.round(received_qty * price * 100) / 100`（`createReceipt/index.js:632-636`、`:715-719`） | 是（派生） |

**无税率字段、无单位换算系数**。金额一律"数量 × 单价"，两处在报表生成时才做两位小数舍入（`createReceipt/index.js:634`、`:635`）——**存储层不做舍入**，`price_snapshot` 保留原始精度。

### 3.2 改价对历史/在途的影响矩阵

| 对象 | 是否受影响 | 依据 |
|---|---|---|
| 已收货明细金额（`receipt_item.price_snapshot`） | **不受影响** | `updateProductPrice` 只写 `supplier_product_price`（`updateProductPrice/index.js:106-131`），从不触碰 `receipt_item` |
| 已生成的带价报表（`report_file` CSV） | 不受影响 | CSV 为生成时快照（`createReceipt/index.js:612-729`），改价不重算 |
| 在途未收货订单 | **受影响（按新价结算）** | `createReceipt` 收货时才查 `effective_date <= 收货日`（`:357-359`） |
| 已收货但订单整体仍在途（`partial_received`/`receipt_abnormal`） | 已收部分不受影响，**未收部分按新价** | 同上，按行计价 |

代码内注释亦确认该口径：`updateProductPrice/index.js:40-42`"结算仍取收货日现价（不锁价）…已收货单价格快照已固化，不受影响"。前端文案与之对齐：`price-manage.js:148`"调价后它们将按新价结算"、`:218`"收货时将按此价结算"。

### 3.3 审计链现状

- **有的**：`updated_by`（改价人，服务端取值抗伪造，`:126`）、`created_at`/`updated_at`（serverDate，`:127-128`）、旧行 `is_current: 0` 保留原 `price`（`:111-115`）——原值可反推，符合前端文案"旧价格自动标记为历史记录，不会被删除"（`price-manage.wxml:58`）。
- **没有的**：
  - `change_reason` / 调价原因（无字段，前端也无输入框）；
  - 显式 `previous_price` / 变更前后成对记录（需跨行比对）；
  - 独立审计集合（全项目 grep `audit` 仅命中**订单审批** `dataService.auditOrder`（`dataService/index.js:487-567`）与报表文件名里的 `-audit-`（`:432`、`:473`），与价格变更无关）；
  - `expiry_date` 停用侧未填：旧行只写 `is_current: 0` + `updated_at`（`:113`），**不写 `expiry_date`**，因此无法按"有效期"还原价目时段，只能按 `effective_date` + `updated_at` 反推；
  - 导入审计：`importProducts` 无 `imported_by` / 批次号 / 导入日志（`importProducts/index.js:174-187` 只写商品字段），无法追溯"谁在何时导入了哪批商品"。

---

## 4. `importProducts` 解析细节与健壮性

### 4.1 解析方式

- **格式**：仅 `.xlsx`（前端 `product-manage.js:165` 用 `/\.xlsx$/i` 拦截），云函数用 `XLSX.read(buffer, { type: 'buffer' })`（`importProducts/index.js:95`）。**无 CSV 入口**（BOM/编码话题因此只影响 Excel 单元格文本，见风险 L-5）。
- **工作表**：只取第一个（`:99`）。
- **行解析**：`XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })` 拿到二维数组（`:101`），`rows.length < 2` 判空（`:102`）。
- **表头映射**：`HEADER_ALIASES`（`:11-19`）+ `mapHeader` 首行扫描（`:67-80`），**列顺序不限，首个匹配生效**。
- **必填校验**：表头必须含 `商品名称`、`二级分类`、`单位`（`:104-107`）；行级 `商品名称`、`单位` 必填（`:144-145`），整行三要素全空则静跳过（`:142`）。

### 4.2 表头别名与模板文档一致性（逐项核对，结论：一致）

| 字段 | 代码别名（`importProducts/index.js:11-19`） | 模板文档（`product-import-template.md:10-16`） | 前端弹窗（`product-manage.js:198`） |
|---|---|---|---|
| 商品名称 | `商品名称`、`品名` | `商品名称（别名：品名）` | 商品名称 |
| 一级分类 | `一级分类` | `一级分类` | 一级分类 |
| 二级分类 | `二级分类`、`分类` | `二级分类（别名：分类）` | 二级分类 |
| 单位 | `单位` | `单位` | 单位 |
| 规格 | `规格` | `规格` | 规格 |
| 厂家 | `厂家`、`厂家/品牌`、`品牌` | `厂家/品牌（别名：厂家、品牌）` | 厂家/品牌 |
| 默认供应商 | `默认供应商`、`供应商` | `默认供应商（别名：供应商）` | 默认供应商 |

唯一漂移：**模板文档声称"最多显示前 10 条"（`product-import-template.md:31`），但代码与前端均无该上限**（`importProducts/index.js:201-209` 全量返回，`product-manage.js:176-182` 全量渲染）。文档 over-claim，见风险 L-1。

### 4.3 匹配与判重

- 分类：`categories.filter(c => c.category_name === categoryName)` 精确匹配（`:149`）；填了一级分类则再按 `category_level_1_name` 收窄（`:151-154`），最后 `candidates[0]` 取一条（`:155`）。**匹配不到即该行失败**（`:150`），**不自动创建**。
- 供应商：`suppliers.find(s => s.supplier_name === supplierName)`（`:169`），匹配不到**不阻断**，`default_supplier_id` 留空并记 warning（`:167-172`）。
- 判重键：`` `${product_name}|${manufacturer_name || '默认'}` ``（`:127`、`:158`），同时比对"库内已有"（`:118-126` 分页全量拉取，BATCH=100）与"本批已见"（`:132`、`:163`）。重复行记 error 并跳过，**不覆盖**。
- 供应商/分类存在性校验：分类强校验（`:150`）；供应商弱校验（`:168-172`）。**均未校验"该商品是否应属于该供应商"**——因为商品表只有 `default_supplier_id` 一个可空引用，无门店归属。

### 4.4 事务与上限（关键薄弱点）

- **非事务包裹**：`:190-199` 对每条 `toInsert` **串行单独 `add`**，逐条 try/catch。中途失败已插入的行永久留存，且失败行 `row` 记为 `'-'`（`:197`）。
- **无行数上限**：既不限 `rows.length`，也不限 `toInsert.length`；分类/供应商预取各有 `limit(1000)`（`:111-112`），超 1000 类静默截断。大文件会先触发串行 `add` 超时（云函数超时返回前已插入的部分**无日志可查**，因为函数不写任何批次/审计记录）。
- 依赖：`xlsx ^0.18.5`（`importProducts/package.json`）——四个云函数中唯一有额外依赖的，部署时需单独 `npm install`。
- 文件清理：下载成功后**立即删除云存储原文件**（`:92-95`），避免 `imports/` 累积；代价是导入失败后源文件不可回溯取证。
- 写入库的记录：`product_id` 用 4 字节随机后缀（`:175`），碰撞概率可忽略；`created_at`/`updated_at` 为 serverDate（`:185-186`）；**无导入批次号、无导入人**。

---

## 5. 前端页面分析（调用契约）

### 5.1 `pages/product-manage`（284 行 JS）

| 交互 | 云函数 / 参数 | 依据 |
|---|---|---|
| `loadData` | `getProducts({includeInactive:true})` + `dataService({action:'getCategories'})` + `getSuppliers({includeInactive:true})` 三路并行 | `product-manage.js:36-40` |
| L1 Tab 筛选 | **纯客户端** `applyFilter` 按 `categoryL1` | `:71-74`、`:81-85` |
| 搜索 | **纯客户端**（`keyword` 不进 `getProducts`） | `:76-79`、`:86-89` |
| 新增/编辑 | `dataService({action:'saveProduct', productId?, name, unit, categoryId, categoryL1, categoryL1Name, categoryName, spec, defaultSupplierId, supplierName, manufacturerName})` | `:235-258` |
| 启停 | `dataService({action:'toggleProduct', productId})`，带二次确认 | `:260-283` |
| Excel 导入 | `wx.chooseMessageFile` → `wx.cloud.uploadFile` 到 `imports/products/${Date.now()}_${rand6}.xlsx` → `importProducts({fileID})` | `:144-161`、`:164-172` |

- **无分页**：`getProducts` 无分页参数，前端一次性吃 `limit(200)` 的全量再本地过滤。商品数超过 200 会静默丢失。
- 服务端 `keyword` 过滤能力（`getProducts/index.js:56-59`）**前端完全没用到**，属于服务端能力闲置。
- `product-manage` 的写入走 `dataService` 而非独立云函数：`dataService.saveProduct`（`dataService/index.js:91-130`）会 `findCategory` 校验分类存在且启用（`:96`、`:83-89`）、校验默认供应商存在且启用（`:99-105`），并从分类对象派生 `category_level_1`/`category_name`（`:109-111`）——比前端传参可信。**但编辑分支（`:118-122`）不做"名称+厂家"判重**，与 `importProducts` 的判重规则（`:159-162`）不一致。
- 导入环境兜底做得较细：`importEnvBlocker` 主动拦截 `devtools`/`windows`/`mac`（`:119-130`），`isUserCancel` 严格匹配结尾避免把真失败当取消（`:10-12`）。

### 5.2 `pages/price-manage`（228 行 JS）

| 交互 | 云函数 / 参数 | 依据 |
|---|---|---|
| `loadData` | `getSuppliers({includeInactive:true})` + `getProducts({includeInactive:true})` + `getProductPrices({onlyCurrent:true})` 并行 | `price-manage.js:33-37` |
| 筛选 | 客户端按供应商 + 商品名搜索 + `supplierName` localeCompare 排序（`:74-91`） | |
| 改价 | 先 `updateProductPrice({..., dryRun:true})` 取 `affectedOrders` → 有波及则二次确认 → 再真调用 | `:135-160` |
| 首次定价 | 客户端先查 `allPrices.some(supplierId && productId)` 阻止重复建行（`:204`），再调 `updateProductPrice` | `:196-227` |
| `updatedBy` | `app.globalData.userInfo.name`（`:133`、`:214`）——服务端优先用 `user_id` 覆盖 | `updateProductPrice/index.js:126` |

- `wx:key="priceId"`（`price-manage.wxml:22`）与 `find(p => p.priceId === ...)`（`price-manage.js:110`）都依赖 `price_id` 唯一，而 `price_id = 'PRC_' + Date.now()`（`updateProductPrice/index.js:103`）**无随机后缀**，见风险 M-1。
- 入口受首页 `isManager` 控制（`index.wxml:25`，`index.js:113` 只含 `super_admin`/`purchaser`），页面自身无角色校验；真正的收敛点在服务端 `updateProductPrice:70`。
- `type="digit"` 输入 + `parseFloat` + `> 0`（`:127-128`），**不限小数位、不做两位小数规整**。

### 5.3 `pages/supplier-prices`（42 行 JS）

- 双重守卫：`authGuard.requireLogin()` + `globalData.isLoggedIn` + `user.role === 'supplier'` 否则 `reLaunch` 回首页（`:12-24`）。
- 只读：调用 `getProductPrices({onlyCurrent:true})`（`:30`），wxml 文案明示"如需调整请联系采购方"（`supplier-prices.wxml:4`），**无任何改价控件**。
- `priceText` 前端 `toFixed(2)`（`:38`）——供应商侧展示强制两位小数，而 `price-manage` 侧显示原始值（`price-manage.wxml:30`、`:49`），**同一价格在两个页面小数位数不一致**。
- **`loadPrices` 无 try/catch**：`await` 失败直接抛未捕获异常，`loading` 停在 true 且无提示（`:27-41`）。

### 5.4 `pages/index`（182 行 JS）

- **不读任何商品/价格数据**。四个并行调用全是订单/报表/消息/统计：`getPurchaseOrders`、`getReports`、`dataService(getMessages)`、`dataService(getOrderStats)`（`index.js:41-56`）。
- 与商品/价格域仅两点交集：管理工作台给 `isManager` 用户露出「商品管理」「价格管理」入口（`index.wxml:34`、`:42`），`isManager = ['super_admin','purchaser']`（`index.js:113`，`:86` 同判定）；`chef`/`store_manager` 看不到入口。

---

## 6. 数据精度与边界

- **金额用浮点**：`supplier_product_price.price` 存 JS number，无整数分级（如"分"）表示。`updateProductPrice` 只校验 `> 0`（`updateProductPrice/index.js:76-79`），不规整小数位 → 可存入 `3.555`。前端 `type="digit"` 允许任意小数（`price-manage.wxml:54`）。
- **舍入只发生在报表生成**：`Math.round(receivedQty * price * 100) / 100` 逐行 + 合计（`createReceipt/index.js:634-635`、`:717-718`），存储层无舍入 → 0.1+0.2 型误差仅在展示层被掩盖，逐行合计与总计可能差 1 分。
- **无最小起订量、无阶梯价**：全项目 grep `min_qty` / `阶梯` / `tax` / `税率` 零命中；模型中无对应字段。
- **无税率**：结算金额即税前金额，无税率/税额概念。
- **日期类型一致**：`effective_date` 与 `receipt_date` 都是 `YYYY-MM-DD` 字符串（`updateProductPrice/index.js:81-82`、`createReceipt/index.js:318-325`），`_.lte(receiptDate)` 是字符串比较，**无类型不匹配陷阱**。
- **UTC+8 口径**：`today` 与 `receiptDate` 都用 `Date.now() + 8h` 换算（`updateProductPrice/index.js:81`、`createReceipt/index.js:325`），改价当天与收货当天的日期判定一致。
- **ID 生成不一致**：`price_id` 仅 `Date.now()`（无随机后缀），而 `product_id`（`importProducts` 4 字节 hex、`dataService` 3 字节 hex）、`receiptId`（3 字节 hex，注释明示"加随机后缀防并发碰撞"，`createReceipt/index.js:326-327`）都有。

---

## 7. 软删商品的连带影响

| 场景 | 行为 | 依据 |
|---|---|---|
| 停用商品后再建采购单 | **不能选**（`createPurchaseOrder` 按 `status: 1` 批量取商品，`createPurchaseOrder/index.js:232`） | |
| 已建采购单 / 已收货明细 | **完全不受影响**：`createReceipt` 全程不查 `product` 表（grep `collection('product'` 在该文件零命中），下单时已快照商品名/分类/单位 | |
| `getProductPrices` 返回 | **仍返回该商品价格行**，但名称回退成 `product_id`（`getProductPrices/index.js:76`、`:79`），单位为空串（`:80`）→ 价格管理页出现"裸 ID"条目 | |
| `updateProductPrice` 改价 | **被拒**："商品不存在或已停用"（`updateProductPrice/index.js:92-95`） | |
| `price-manage` 页面 | 因带 `includeInactive: true`（`price-manage.js:35`）能显示停用商品的价格，但无法改价、名称显示为 ID | |
| `getProducts` | 默认只返回启用商品（`getProducts/index.js:47`） | |

即：**不会返回空，但会出现"ID 占位"的降级展示**；停用商品处于"可查价、不可改价、不可新下单"的半锁定态。

---

## 8. 风险清单

严重度：高 / 中 / 低。

### 高

| # | 风险 | 触发条件 | 证据 |
|---|---|---|---|
| H-1 | **商品列表无分页 + 搜索在 `limit(200)` 截断之后做**：商品 >200 时，列表静默丢尾部；`getProducts` 的 `keyword` 服务端过滤前端根本没调用 | 商品档案超 200 条 | `getProducts/index.js:53`、`:56-59`；前端 `product-manage.js:81-89`、`:37` |
| H-2 | **`importProducts` 无批量上限且逐条串行写入、无事务**：大文件在云函数超时前部分入库、无审计可查，函数报错而前端只显示"导入失败" | 单次导入行数过多 | `importProducts/index.js:190-199`、`:201-210`；无任何 `limit` 校验 |
| H-3 | **完全没有价格批量导入入口**：价格只能逐条手工录入，`importProducts` 表头无价格列（`HEADER_ALIASES` 7 列全为资料字段） | 商品/供应商规模增长 | `importProducts/index.js:11-19`、`:104-107`；`price-manage.js:196-227` 仅支持单条新增 |

### 中

| # | 风险 | 触发条件 | 证据 |
|---|---|---|---|
| M-1 | **`price_id = 'PRC_' + Date.now()` 无随机后缀**，同毫秒两次改价（双击、快速连续新增价格）产生重复 `price_id`；前端用 `priceId` 做 `wx:key` 与 `find` 定位 → 渲染错乱、点错行改错价 | 同毫秒并发改价 | `updateProductPrice/index.js:103`；`price-manage.wxml:22`、`price-manage.js:110`；对比 `createReceipt/index.js:326-327` 已加后缀 |
| M-2 | **分类重名 + 一级分类填错/漏填时静默选错分类**：`byL1` 为空则回退到全量候选并取 `candidates[0]`；不校验一级分类是否真的存在 | 同名二级分类跨一级，且模板"一级分类"列填错 | `importProducts/index.js:149-155` |
| M-3 | **商品重名无服务端统一拦截**：`dataService.saveProduct` 编辑分支不判重，与 `importProducts` 的"名称+厂家"判重规则不一致，可手工造出与导入规则冲突的重复档案 | 编辑商品改名 | `dataService/index.js:118-122` vs `importProducts/index.js:159-162` |
| M-4 | **无 SKU/条码**，判重与业务身份只靠"名称+厂家"；不同单位/规格的同一商品会被误判为重复 | 同名不同规格 | `importProducts/index.js:127`、`:158`；`product.json` 无 sku 字段 |
| M-5 | **改价无原因记录**：无 `change_reason`/`previous_price` 字段，无独立审计集合；原值只能靠 `is_current:0` 的历史行反推，且停用侧不写 `expiry_date`，无法按有效期还原价目时段 | 需要追溯"为什么从 3.5 改到 3.8" | `updateProductPrice/index.js:111-115`、`:116-130`；全项目 grep `audit` 仅命中订单审批 |
| M-6 | **导入无审计**：无 `imported_by`、无批次号、无导入日志 | 数据问题需追溯来源 | `importProducts/index.js:174-187` |
| M-7 | **调价波及面计数漏 `receipt_abnormal`**：`INFLIGHT_ORDER_STATUS` 缺该状态，而带异常的未收齐订单仍可补收（补收时才取新价）→ 波及数偏低，前端确认框低估影响；`count` 异常时按 0 静默处理，同样偏低 | 有异常订单在途时调价 | `updateProductPrice/index.js:43`、`:60-63`；`createReceipt/index.js:407`、`:551` |
| M-8 | **精度不一致**：价格不限两位小数、存储不舍入、合计层才舍入 → 逐行与总计可差 1 分；两个页面显示位数不同（采购侧原始值、供应商侧 `toFixed(2)`） | 出现 3 位以上小数价格 | `updateProductPrice/index.js:76-79`；`createReceipt/index.js:634-635`；`price-manage.wxml:30` vs `supplier-prices.js:38` |
| M-9 | **`priceId` 无唯一约束，"唯一当前价"依赖 CloudBase 事务重试语义**：`:107-115` 先查后改、无版本号/CAS，若两个事务都读到同一当前行，可能留下两条 `is_current:1` | 并发改同一「供应商+商品」 | `updateProductPrice/index.js:106-131`（注释自承需事务保证）；对比 `createPurchaseOrder/index.js:327` 提到 `(request_id, created_by)` 唯一索引作终极防线 |
| M-10 | **价格列表 `limit(200)` 无分页**：供应商 × 商品组合超 200 时静默截断，且被截断的组合可能在新增价格时被误判"已有"而拒绝 | 单个供应商商品数 >200 | `getProductPrices/index.js:60`；`price-manage.js:204` |
| M-11 | **价格维度错配导致"缺价"假象**：档案商品缺 `default_supplier_id`，或采购方为 A 供应商定价但商品默认供应商是 B，则下单明细 `supplier_id` 与协议价对不上 → 收货时取不到价 → `missing_price` 异常 | 供应商归属设置与协议价不同步 | `createPurchaseOrder/index.js:263`；`createReceipt/index.js:350-357`、`:373-392` |
| M-12 | **`supplier-prices` 加载无错误处理**，`await` 抛错时页面无提示、`loading` 永真 | 云函数超时/网络失败 | `supplier-prices.js:27-41`（无 try/catch，对比 `product-manage.js:35-44` 有 code 校验） |
| M-13 | **停用商品在价格管理页显示为裸 ID**，且该状态下"可查价但不可改价"，运营易困惑 | 停用有协议价的商品 | `getProductPrices/index.js:76`、`:79-80`；`updateProductPrice/index.js:92-95` |

### 低

| # | 风险 | 触发条件 | 证据 |
|---|---|---|---|
| L-1 | 模板文档 over-claim"最多显示前 10 条"，代码/前端均无该上限 | 大量错误行 | `product-import-template.md:31` vs `product-manage.js:176-182` |
| L-2 | 导入失败行显示为"第-行" | 写入阶段失败 | `importProducts/index.js:197`；`product-manage.js:177` |
| L-3 | 汇总口径不自洽：`total = rows.length-1` 含静默跳过的空行，`inserted + failed ≠ total` | 文件含空行 | `importProducts/index.js:142`、`:204` |
| L-4 | 导入/手工的分类 `limit` 不一致（100 vs 1000） | 分类 >100 | `dataService/index.js:60` vs `importProducts/index.js:111` |
| L-5 | 表头匹配对全角空格无容错（`String().trim()` 不剥 `　`） | 用户用全角空格分隔 | `importProducts/index.js:61-64` |
| L-6 | `importProducts` 的 `-401` 返回结构为 `{error:{code,msg}}`，前端 `result.code !== 0` 判不到真错误码，只显示"导入失败"（页面本身已拦登录，实际难触发） | 会话过期时导入 | `importProducts/index.js:83-84`、`:52-59`；`product-manage.js:174` |
| L-7 | `expiry_date` 语义残缺：新写恒 `null`，旧种子行有值 → 新旧数据口径不一；且代码从不按 `expiry_date` 查询 | 报表分析用有效期 | `updateProductPrice/index.js:124`；`seed-data/supplier_product_price.json` 第 1 行 |
| L-8 | `getProductPrices` 的 supplier 分支忽略前端 `supplierId`，但 `productId` 未做隔离（supplier 可传他人 `productId` 联查，因 `supplier_id` 已锁定故只回自己那份，属"无谓暴露查询面"） | supplier 传他人商品 ID | `getProductPrices/index.js:46-55` |
| L-9 | 一级分类 Tab 顺序与新增商品默认一级分类不确定：`getCategories` 仅按 `sort_no` 排序且跨一级有重复值，`categoryL1List[0]` 可能非预期 | 打开新增弹窗 | `dataService/index.js:57-60`、`:63-70`；`product-manage.js:94`、`:98` |
| L-10 | `getProducts` 的 `categoryId` 传非数字字符串 → `Number()` 得 `NaN` → 查询异常 → 通用 `-1` 文案（当前无调用方传该参数） | 外部调用方直调 | `getProducts/index.js:49-51` |
| L-11 | 页面自身无角色校验，依赖服务端兜底与首页入口控制；`chef` 直链访问价格页会得到 -403 提示而非跳转 | 手工改 URL / 从历史进入 | `price-manage.js:29`、`:38-41`；`index.wxml:25` |
| L-12 | `updateProductPrice` 的日期格式校验不可达（`effectiveDate` 必须先等于 `today`）——死代码 | — | `updateProductPrice/index.js:83` vs `:86-89` |

---

## 9. 待确认清单

1. **云函数超时配置**：`importProducts` 逐条串行 `add`，需确认该函数 `timeout` 实际配置（云开发控制台），才能判断大文件是否必然超时。（未读到部署配置）
2. **CloudBase 事务语义**：`updateProductPrice` 是否真能保证"唯一当前价"，取决于平台事务对"同文档并发写"的重试/冲突检测行为；项目内未见到 `supplier_product_price` 的唯一索引定义。（跨域，待确认）
3. **`getSuppliers` 的 `includeInactive` 是否真的存在**：`product-manage.js:39`、`price-manage.js:34` 均传该参数，本任务未分配读取 `getSuppliers/index.js`，其实现与参数兼容性待确认。
4. **`receipt_abnormal` 是否可继续补收**：`createReceipt/index.js:407` 注释称允许，但 `:413` 的状态白名单未包含该状态；若注释正确则存在代码 bug，若代码正确则注释误导。该结论直接影响 M-7 的严重度。
5. **模板文档是否另有正式 xlsx 附件**：`seed-data/product-import-template.md` 只有表头说明与示例表格，无 `.xlsx` 文件，前端"模板说明"是纯弹窗文案（`product-manage.js:195-201`），用户实际靠复制文案手搓表格。
6. **历史价格行是否会被清理**：无任何归档/清理逻辑（grep 未见），价格行会随改价无限增长；是否接受该增长未确认。
7. **`updated_by` 的展示映射**：库里存 `user_id`（`updateProductPrice/index.js:126`），前端从未消费该字段；若要展示改价人姓名需补映射（跨域，待确认）。
8. **`price` 是否需要两位小数硬约束**：涉及财务口径拍板，代码中无该约定。

---

## 10. 附：本域证据索引（速查）

- 权限收敛：`updateProductPrice/index.js:70`、`getProductPrices/index.js:46-53`、`getProducts/index.js:44-45`、`supplier-prices.js:20-23`、`index.js:113`
- 快照锚点：`createPurchaseOrder/index.js:352-364`（无价格）、`createReceipt/index.js:353-359`（收货日取价）、`:499`（写入 `price_snapshot`）、种子 `receipt_item.json:1-3`
- 改价事务：`updateProductPrice/index.js:103-131`；波及计数 `:43-64`；`dryRun` `:97-101`
- 导入解析：`importProducts/index.js:11-19`（别名）、`:67-80`（映射）、`:104-107`（必填）、`:149-155`（分类匹配）、`:159-162`（判重）、`:190-199`（非事务写入）、`:201-210`（返回）
- 前端契约：`product-manage.js:36-40`、`:81-91`、`:164-191`、`:235-283`；`price-manage.js:33-42`、`:125-170`、`:196-227`；`supplier-prices.js:27-41`
- 归一化契约：`utils/cloud.js:171-185`（product）、`:201-210`（price）、`:187-199`（supplier）
- Toast 契约：`utils/util.js:64-66`（`showToast(title, icon='none')`，故 `price-manage.js:163` 传 `'none'` 属正确用法，非缺陷）
