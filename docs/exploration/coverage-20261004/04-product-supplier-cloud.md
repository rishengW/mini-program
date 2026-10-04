# 全面覆盖勘探 D：商品 / 供应商 / 供货商视图云函数域

- 日期：2026-10-04　分支：backup（全程只读，未改任何源码、未做任何 git 操作；唯一写入即本文件）
- 逐行完整读取（无 excerpt 跳读，8 个文件合计 940 行）：
  - `cloudfunctions/getProducts/index.js`（66 行）
  - `cloudfunctions/getProductPrices/index.js`（89 行）
  - `cloudfunctions/updateProductPrice/index.js`（138 行）
  - `cloudfunctions/importProducts/index.js`（213 行）
  - `cloudfunctions/getSuppliers/index.js`（96 行）
  - `cloudfunctions/getSupplierOrders/index.js`（137 行）
  - `cloudfunctions/getSupplierReceipts/index.js`（119 行）
  - `cloudfunctions/getReceipts/index.js`（92 行）
  - 上述 8 个目录各自的 `package.json`
- 交叉验证（只读）：`seed-data/{supplier_product_price,purchase_order_item,receipt_item,purchase_order,receipt,category,product}.json`、`seed-data/product-import-template.md`、`cloudfunctions/confirmSupplierOrder/index.js`、`cloudfunctions/createReceipt/index.js`（收货前置状态白名单）、`cloudfunctions/dataService/index.js:1360-1404`（订单作废时清空 confirmations）、`utils/cloud.js`（401 处理出口）、`pages/product-manage`、`pages/receive-list`、`pages/supplier-prices` 调用点、最新 commit `07b6461` 的改动范围。
- 参考但未复制：`docs/exploration/deep-20261004/03-product-price.md`、`docs/exploration/rescan-20261004-R6-product-price-cloud.md`、`docs/exploration/rescan-20261004-R4-receipt-abnormal-cloud.md`。每条旧结论均以当前代码独立复核，标注「仍然成立 / 代码已变化 / 旧报告判断有误」，集中在第 3 节。

---

## 0. 结论摘要

1. **getSupplierOrders 的 1000 行截断会让供货商订单"凭空消失"（本轮最严重发现）**：`getSupplierOrders:72-76` 用 `.limit(1000)` 一次拉完该供货商的**全部** `purchase_order_item`，既无分页也无 `orderBy`。所有后续逻辑（订单号集合、可见列表、`total`、`statusCounts`）都建立在这份被截断的集合上。按"每单 5 行、每天 3 单"估算，供应商约 2 个月即可触顶，且截断到哪 1000 行是不确定的 → 老订单整体消失、待确认数归零，且无任何错误提示。
2. **getSuppliers 的停用供应商守卫可被单个参数绕过**：`:58-59` 的 `includeInactive` 保护只写在 `else if` 分支，而 `status` 参数直接写进 `query.status`。非管理角色（chef / store_manager）传 `status: 0` 且**不**传 `includeInactive`，即可绕过 `-403` 读出全部已停用供应商档案（含联系人、电话）。
3. **「内部审批通过前不可见」这条规则只在订单视图落实了，收货视图是"靠下游约束顺带成立"，价格/商品视图根本没有闸门**：最新 commit `07b6461` 只改了 `getSupplierOrders`（`:12` + `:100` 的 `HIDDEN_ORDER_STATUS`）和 `confirmSupplierOrder`。`getSupplierReceipts` 完全不校验订单状态——虽然 `createReceipt:239,417` 只允许已审批订单收货，使该缺口当前无法被触发，但这是**唯一的、位于本函数之外的**屏障；`getProductPrices` / `getProducts` / `importProducts` 则没有任何审批语义（`supplier_product_price` 无审批字段，导入即 `status: 1`）。
4. **importProducts 的判重是"读时校验、写时不保证"**：`:122-127` 全表拉取构造内存 `Set`，与 `:192-199` 的逐条 `add` 之间无事务、无唯一索引 → 两个管理员并发导入同一份 Excel **必然产生重复商品记录**。判重键 `${product_name}|${manufacturer_name}` **不含 `status`**，停用的同名同厂家商品仍会阻断重新导入。是否覆盖他人价格：**不会**——该函数全程不触碰 `supplier_product_price`。
5. **updateProductPrice 已解决"双 current 行"并发，但审计仍是"可反推、不可陈述"**：`:106-131` 用 `db.runTransaction` 包住"旧价置 `is_current:0` + 插入新价"，竞态已闭合；但**无 `change_reason`、无旧值快照、无独立审计集合**，旧值只能靠历史行反推，且 `price_id = 'PRC_' + Date.now()` 在并发同毫秒下会重名。
6. **importProducts 的鉴权失败被静默吞掉**：`:54/:56` 返回**嵌套** `{ error: { code: -401 } }`，而 `utils/cloud.js:68` 只判顶层 `result.code === -401` → 会话过期时不跳登录页，`pages/product-manage:174` 因 `result.code` 与 `result.msg` 均为 undefined 只弹一句「导入失败」。
7. **模板示例行 100% 必然导入失败**：`seed-data/product-import-template.md` 的示例用二级分类「叶菜类」「禽类」，而种子只有 12 个二级分类（蔬菜/肉类/海鲜水产/调料干货/粮油/酒水饮料/冻品/豆制品/纸品/餐具/清洁用品/包装材料），且「一级分类」列填的「蔬菜」「肉禽」与 `category_level_1_name`（实际值仅「后厨」「前厅」）也不符 → 精确 `===` 匹配（`importProducts:149`）下照抄模板必然全行报「二级分类不存在」。
8. **getSupplierOrders 明细层已清洗，订单层仍在泄漏**：`:127-129` 用 `...order` 原样外发，`purchase_order.supplier_confirmations` 是以**其他供应商 supplier_id 为键**的确认/发货状态表，供货商可据此得知"还有哪些供应商参与本单、对方确认/发货到什么进度"，与文件头注释声明的防泄漏目标不一致。

---

## 1. 逐文件勘探

### 1.1 `cloudfunctions/getProducts/index.js`（66 行）

**职责**：商品主档列表查询（管理端商品管理 / 价格管理 / 下单页的商品数据源）。

**入参**：`authToken`（会话）、`categoryL1`（一级分类码）、`categoryId`（二级分类 id）、`keyword`（商品名模糊）、`includeInactive`（是否含停用）。
**出参**：成功 `{ code: 0, data: Product[] }`；失败 `{ code: -401|-403|-1, msg }`。

**读写的集合 + 查询条件**（只读，无写入）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `product` | `{ status: 1 }`（默认，或管理端看全量）＋可选 `category_level_1`、`category_level_2_id` | `orderBy('product_name','asc')`，`limit(200)`，**无 skip/无 total** |
| `app_user` | `{ status: 1, sessions: { token_hash } }`（B12 多设备会话）／legacy `session_token_hash` | `limit(1)` |

`keyword` **不在数据库层**，而是在取回 200 条之后于内存做 `toLowerCase().includes` 二次过滤（`:56-59`）。

**权限校验**：`:44-45` 仅拦截"非管理角色却请求停用商品"。**没有任何角色白名单**——`chef`、`store_manager`、`supplier` 都能正常调用并取回全量启用商品（当前调用方只有 `product-manage`、`price-manage`、`purchase-create`，供货商端不调用，所以是"未被利用的缺口"而非现存事故）。商品表不含价格字段，因此不构成价格泄露。

**分页与排序**：**无分页**，`limit(200)` 硬上限且**不返回 `total`**，调用方无法感知是否被截断；排序为单键 `product_name`，而 `importProducts:127` 的判重键设计已承认"同名不同厂家"合法存在 → 同名商品相对顺序跨请求不确定。

**发现的问题**：
- `getProducts:53` 中：无分页 + 无 `total`，商品数超 200 即静默截断。
- `getProducts:56-59` 中：`keyword` 在 `limit(200)` **之后**过滤，商品数超 200 时搜索必然漏项（只搜到按名称升序的前 200 条）。
- `getProducts:43-45` 低：无角色白名单，任意已登录角色可拉全量商品主档。
- `getProducts:49-51` 低：`Number(categoryId)` 对非数字输入得到 `NaN` 并直接写入 `where`，行为取决于 SDK（空结果或报错），未做校验。
- `getProducts:53` 低：排序单键，同名商品顺序抖动。

---

### 1.2 `cloudfunctions/getProductPrices/index.js`（89 行）

**职责**：协议价查询（管理端按供应商/商品维度看全量，供货商端只看自己名下的价）。

**入参**：`authToken`、`supplierId`、`productId`、`onlyCurrent`。
**出参**：`{ code: 0, data: [{ ...price_row, product_name, unit }] }`；失败 `{ code: -401|-403|-1, msg }`。

**读写的集合 + 查询条件**（只读）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `supplier_product_price` | 供货商：`{ supplier_id: user.default_supplier_id }`；管理端：`{ supplier_id? , product_id?, is_current: 1? }` | `orderBy('effective_date','desc')`，`limit(200)`，无分页 |
| `product` | `{ product_id: _.in(chunk) }`（每批 20，`limit(100)`）用于补 `product_name`/`unit` | — |
| `app_user` | 同 1.1 | `limit(1)` |

**权限校验（重点）**：**行级过滤成立**。`:46-49` 供货商角色强制 `query.supplier_id = user.default_supplier_id` 且**忽略前端传入的 `supplierId`**；`:51-52` 非供货商必须为 `super_admin`/`purchaser`，其他角色 `-403`。即使供货商同时传 `productId` + 别的 `supplierId`，查询仍以自身 id 为准 → 无法越权读他人价格。
**谁能改价格**：本函数只读；改价入口唯一，见 1.3。

**「内部审批通过前不可见」在本函数**：**不适用/无闸门**。`supplier_product_price` 集合的字段只有 `price_id/supplier_id/product_id/price/currency/effective_date/expiry_date/is_current/updated_by/created_at/updated_at`（见 `seed-data/supplier_product_price.json`），**不存在任何审批字段**；管理员调价即时对供货商可见。这属于业务模型本身不含该语义，而非本函数遗漏。

**分页与排序**：无分页，`limit(200)`；`orderBy('effective_date','desc')` 对 `YYYY-MM-DD` 字符串比较正确。`onlyCurrent` 未传时返回全部历史价（当前两个调用方 `supplier-prices`、`price-manage` 都传了 `onlyCurrent: true`）。

**发现的问题**：
- `getProductPrices:69-72` 低：补商品名时不过滤 `product.status`，已停用商品的价格仍会返回（历史价保留本身合理，但与 `updateProductPrice:92` 只允许启用商品调价形成口径差异）。
- `getProductPrices:55` 低：`onlyCurrent` 默认关闭，管理端一次请求可能混入过期价。
- `getProductPrices:57-61` 低：无分页 + `limit(200)`，单供应商商品数超 200 会静默截断。

---

### 1.3 `cloudfunctions/updateProductPrice/index.js`（138 行）

**职责**：管理员修改供应商协议价——旧现行价置 `is_current:0`、插入新现行价；支持 `dryRun` 只做校验并返回在途波及单数。

**入参**：`authToken`、`supplierId`、`productId`、`newPrice`、`effectiveDate?`、`dryRun?`、`updatedBy?`。
**出参**：`{ code: 0, data: { priceId, affectedOrders, message } }`；dryRun 时 `{ code: 0, data: { dryRun: true, affectedOrders } }`；失败 `{ code: -401|-403|-1, msg }`。

**读写的集合 + 查询条件**：
| 集合 | 操作 | 条件 |
|---|---|---|
| `supplier_product_price` | **写**：事务内先 `where({supplier_id, product_id, is_current:1}).limit(100)` 逐条 `doc().update({ is_current: 0 })`，再 `add` 新行 | 见左 |
| `supplier` | 读 | `{ supplier_id, status: 1 }` |
| `product` | 读 | `{ product_id, status: 1 }` |
| `purchase_order_item` | 读 | `{ supplier_id, product_id }`，`limit(1000)` |
| `purchase_order` | 读 | `{ purchase_order_id: _.in(chunk), order_status: _.in(INFLIGHT_ORDER_STATUS) }`，`.count()` |
| `app_user` | 读 | 同 1.1 |

**权限校验**：`:70` 仅 `super_admin`/`purchaser` 可改价 → **供货商不能改自己名下的价**，价目表完全由采购方管控（符合"甲方定协议价"模型）。

**并发与幂等**：
- ✅ **并发已解决**：`:106-131` 用 `db.runTransaction` 包住"置旧价失效 + 插入新价"，注释明确写了动因（否则并发更新会留下两行 `is_current:1`）。事务内用的是 `where().get()` + `doc().update()` 而非 `where().update()`，与 `dataService:1401-1402` 记录的"事务内 `where().update()` 不携带 transactionId"陷阱一致。
- ⚠️ **无幂等键**：重复调用（哪怕新旧价完全相同）每次都新增一行历史价，无"同价跳过"判断，历史行会无限增长。
- ⚠️ **`price_id` 可重名**：`:103` `'PRC_' + Date.now()`，同毫秒并发两次改价会生成同一个 `price_id`（未见唯一索引约束；因事务只保护 `is_current` 语义，重名不会造成双现行价，但会破坏"按 price_id 追溯"的唯一性）。

**审计留痕（谁、何时、旧值→新值）**：**部分留痕**。
- 谁：新行 `updated_by`（`:126`，取 `user.user_id || user._id || updatedBy || 'system'`）——注意 `updatedBy` 是**客户端可传字段**，虽因角色限死在管理员而实际很少命中，但仍是把身份来源交给请求方。
- 何时：`created_at` / `updated_at` 用 `db.serverDate()`。
- 旧值→新值：**没有**。无 `previous_price`、无 `change_reason`、无独立审计集合；旧值只能靠"该 supplier+product 下 `is_current:0` 的历史行"反推，且旧行的 `updated_at` 被覆盖为失效时刻，无法从单条记录自证"从 A 改到 B"。
- 波及面：`:98` 返回 `affectedOrders` 并在 `:97-101` 支持 dryRun，是"可见性提示"而非阻断（`:40-42` 注释说明结算仍取收货日现价、不锁价，为既定拍板）。

**「内部审批通过前不可见/不可操作」**：本函数为管理端操作，不涉及该规则。需注意 `INFLIGHT_ORDER_STATUS`（`:43`）把 `submitted`/`pending_approval` 也计入在途——这在"波及面"语义上是**故意**的（提醒管理员审核中也会被波及）。

**发现的问题**：
- `updateProductPrice:43` 中：`INFLIGHT_ORDER_STATUS` 缺 `receipt_abnormal`，带异常的未收齐订单仍可补收（补收时才取新价）→ 波及数偏低，前端确认框低估影响。
- `updateProductPrice:60-63` 中：波及计数 `catch` 后静默按 0 处理，仅 `console.warn` → 计数链路故障时前端确认框显示"影响 0 单"，仍允许直接改价。
- `updateProductPrice:106-131` 中：无 `change_reason` / 旧值快照 / 独立审计集合，无法回答"谁在什么时候为什么把 3.5 改成 3.8"。
- `updateProductPrice:48` 中低：`purchase_order_item` 查询 `limit(1000)` 截断，长尾供应商波及数偏小。
- `updateProductPrice:103` 低：`price_id = 'PRC_' + Date.now()` 并发同毫秒重名。
- `updateProductPrice:126` 低：`updatedBy` 接受客户端值作为 `updated_by` 兜底。
- `updateProductPrice:116-130` 低：同价重复调用产生冗余历史行，无幂等/去重判断。

---

### 1.4 `cloudfunctions/importProducts/index.js`（213 行）

**职责**：商品基础资料 Excel 批量导入（固定模板、SheetJS 解析、名称匹配分类/供应商、按"名称+厂家"判重）。

**入参**：`authToken`、`fileID`（云存储文件 id）。
**出参**：`{ code: 0, data: { total, inserted, failed, errors: [{row,msg}], warnings: [{row,msg}] } }`；鉴权失败为**嵌套** `{ error: { code, msg } }`（`:54`、`:56`）；其他失败 `{ code: -1, msg }`。

**读写的集合 + 查询条件**：
| 集合 | 操作 | 条件 |
|---|---|---|
| `product` | 读（全量判重）：`skip(offset).limit(100)` 循环 | **无 orderBy、无 where** |
| `product` | **写**：逐条 `add`（`:192-199`） | — |
| `category` | 读 | `{ status: 1 }`，`limit(1000)` |
| `supplier` | 读 | `{ status: 1 }`，`limit(1000)` |
| `app_user` | 读 | 同 1.1 |

模板列头映射见 `HEADER_ALIASES`（`:11-19`），必填列为「商品名称」「二级分类」「单位」，校验在 `:105-107`。

**权限校验**：`:8` `MANAGEMENT_ROLES = ['super_admin','purchaser']`，`:83` 统一 `requireUser` → **只有超管和采购能导入**，供货商无入口。

**并发 / 幂等（重点）**：
- **重复导入同一商品不会覆盖他人价格**：本函数全程不写 `supplier_product_price`，商品导入与价目表完全解耦 ✅。
- **但会产生重复商品记录**：判重是"读时校验"——`:122-127` 先把全表拉进内存 `Set`，`:159-163` 比对，`:192-199` 才逐条 `add`。校验与写入之间**无事务、无唯一索引、无并发锁** → 两个管理员（或同一人双击、前端重试）同时导入同一份 Excel，双方都能在 `add` 前通过判重 → **同名同厂家商品成对入库**。
- 判重集合本身也不可靠：`:122` 的 `skip/limit` 分页**没有 `orderBy`**，分页期间若有并发写入，可能重复读或漏读记录。
- 判重键**不含 `status`**：`:127` / `:157-158` 用 `${product_name}|${manufacturer_name||'默认'}` 对全表（含 `status:0`）比对 → 停用商品仍会阻断重新导入，且提示语是"已存在同名同厂家商品，跳过"，用户无法自行解除。
- **无审批闸门**：`:184` 导入即 `status: 1` 立即启用 → 新商品当刻即可被下单、被供应商看见。若业务要求"内部审批后生效"，本函数没有任何该语义的落点（`product` 集合也无审批字段）。

**其他健壮性**：无文件大小/行数上限，`cloud.downloadFile` + `XLSX.read` 全量入内存，大文件可打爆云函数内存或超时；`:94` 下载成功后**立即删除源文件**再做 `XLSX.read`（`res.fileContent` 已在内存，逻辑正确），但若解析抛错则文件已删，用户只能重新上传；分类/供应商匹配各 `limit(1000)` 静默截断；`:155` 分类重名且一级分类无法收敛时 `candidates[0]` 任意取值；`:169-171` 供应商名匹配不到**仅记 warning 仍插入**，`default_supplier_id` 留空——该行商品后续下单会落到 0 价（下游 `createReceipt` 对空 `supplierId` 短路），且无人提醒。

**分页与排序**：无分页概念（一次全量导入），返回值只有汇总计数。

**发现的问题**：
- `seed-data/product-import-template.md`（示例表）+ `importProducts:149` 高：示例的二级分类「叶菜类」「禽类」在系统分类中不存在，「一级分类」列填的「蔬菜」「肉禽」与 `category_level_1_name`（仅「后厨」「前厅」）不符，精确匹配下**照抄模板 100% 失败**。
- `importProducts:122-127` + `:159-163` + `:192-199` 中：判重为"读时校验、写时无保证"，并发导入必然产生重复记录（无唯一索引/事务）。
- `importProducts:122` 中：全表分页扫描无 `orderBy`，且仅为构造判重 `Set` 就全量拉表入内存。
- `importProducts:159-162` 中：判重键不含 `status`，停用商品阻断重新导入。
- `importProducts:192-199` 中：逐条 `add` 无事务、无导入批次号，部分成功后中断无法回滚也无法定位"哪些行已入库"；失败项 `row` 记为 `'-'` 丢失行号。
- `importProducts:52-59` + `utils/cloud.js:68` 中：`requireUser` 返回**嵌套** `{error:{code:-401}}`，`utils/cloud.js` 只判顶层 `result.code`，`pages/product-manage:174` 拿到 `code===undefined` 且 `msg===undefined` → 会话过期不跳登录页，只显示「导入失败」。
- `importProducts:82-95` / `:101` 中：无文件大小/行数上限，大 Excel 可致云函数 OOM 或超时。
- `importProducts:169-171` 中：供应商名未匹配仅 warning 仍插入，`default_supplier_id=''` 的商品后续下单落 0 价且无追踪入口。
- `importProducts:111-112` 低：分类/供应商 `limit(1000)` 静默截断，超量后名称匹配静默失败。
- `importProducts:155` 低：分类重名时 `candidates[0]` 任意取值。
- `importProducts:94` 低：先删源文件再解析，解析失败时用户只能重新上传。
- `importProducts:204` 低：`total: rows.length - 1` 把空行也计入，与"总行数"语义含糊（`:142` 空行被静默跳过却仍占 total）。

---

### 1.5 `cloudfunctions/getSuppliers/index.js`（96 行）

**职责**：供应商档案列表查询（含每个供应商名下商品数），供货商端只返回自己一条。

**入参**：`authToken`、`status`、`keyword`、`includeInactive`。
**出参**：`{ code: 0, data: [{ ...supplier, product_count }] }`；失败 `{ code: -401|-403|-1, msg }`。

**读写的集合 + 查询条件**（只读）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `supplier` | 供货商：`{ supplier_id: user.default_supplier_id }`；管理/其他：`{ status }`（显式传入优先，否则非管理端强制 `1`）＋可选 `supplier_name: db.RegExp(...)` | `orderBy('supplier_name','asc')`，`limit(100)` |
| `product` | `{ default_supplier_id: _.in(chunk) }`（每批 20） | `limit(1000)`，用于累加 `product_count` |
| `app_user` | 同 1.1 | `limit(1)` |

**权限校验（重点）**：供货商分支行级过滤成立（`:45-52`，强制只查自己，且**忽略前端 `status`/`keyword`**）；`:53-54` 对 `includeInactive` 做了 `-403` 拦截。
但存在一个绕过：**`:58-59`**

```js
if (status !== undefined && status !== null && status !== '') query.status = status
else if (!includeInactive || !isManager) query.status = 1
```

`includeInactive` 的守卫只挂在 `else if` 分支上。`chef` / `store_manager` 传 `status: 0`（不传 `includeInactive`）时，第一分支命中，`query.status = 0` → **读到全部已停用供应商档案（含联系人、联系电话）**，`-403` 完全不触发。管理端传 `status` 本属其职权，但代码没有按角色区分"谁能用 `status` 覆盖默认过滤"。

**「内部审批通过前不可见」**：供应商档案无审批语义，不适用。

**分页与排序**：无分页，`limit(100)` 硬上限；`orderBy('supplier_name','asc')` 单键。`product_count` 用 `default_supplier_id` 归属计数（`limit(1000)` 截断），因此"非默认供应商"承接的商品不计入该供应商计数——语义上算的是"默认承接商品数"。

**发现的问题**：
- `getSuppliers:58-59` 中：`status` 参数绕过 `includeInactive` 守卫，非管理角色可枚举已停用供应商档案（联系方式）。
- `getSuppliers:61` 中：`keyword` 未经转义直接构造 `db.RegExp({ regexp: keyword, options: 'i' })` → 正则注入（如 `.*` 退化为全表、构造复杂模式触发 ReDoS/扫描放大）。
- `getSuppliers:51` 低：供货商端 `product_count` 硬编码 `0`，与自己真实商品数不符（若前端据此展示会误导）。
- `getSuppliers:67` / `:78` 低：`limit(100)` 供应商数上限、`limit(1000)` 商品计数上限，均无分页、无截断提示。

---

### 1.6 `cloudfunctions/getSupplierOrders/index.js`（137 行）

**职责**：供货商视角的采购订单列表——只返回含该供货商商品的订单，且每个订单只嵌入该供货商自己的明细，附带 tab 计数。

**入参**：`authToken`、`confirmStatus`、`orderDate`、`page`、`pageSize`。
**出参**：`{ code: 0, data: [{ ...order, my_confirm_status, items: [...] }], total, page, pageSize, statusCounts }`。

**读写的集合 + 查询条件**（只读）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `purchase_order_item` | `{ supplier_id, is_manual: _.neq(true) }` | `limit(1000)`，**无 orderBy、无分页** |
| `purchase_order` | `{ purchase_order_id: _.in(chunk) }`（每批 20） | `limit(100)` |
| `app_user` | 同 1.1 | `limit(1)` |

**权限校验（重点）**：`:62` 必须 `role === 'supplier'`，`:64` 必须有 `default_supplier_id`；`:72` 行级过滤 `supplier_id`，并显式排除手动商品行（`:71` 注释说明了动机：不依赖"手动行 `supplier_id` 为空"这一隐式前提）。`confirmSupplierOrder:64-69` 在**写入侧**同样校验"该订单必须真含本供货商商品"，读写两侧一致。

**「内部审批通过前不可见/不可操作」——本函数已落实（最新 commit `07b6461` 的核心改动）**：
- `:12` `HIDDEN_ORDER_STATUS = ['draft', 'submitted', 'pending_approval', 'rejected']`，`:100` `visible = orders.filter(order => !HIDDEN_ORDER_STATUS.includes(order.order_status))`。
- 与写入侧白名单口径一致：`confirmSupplierOrder:12-13` 的 `CONFIRMABLE_ORDER_STATUS = ['approved','report_generated','to_receive']`、`SHIPPABLE_ORDER_STATUS` 仅比其多 `partial_received`，两者都从 `approved` 起算，即"审核通过前既看不到也不能确认/发货"。
- `:13-15` 的 `DONE_ORDER_STATUS = ['received','receipt_abnormal','completed']` 用于把已完结单在供货商视角归为 `done`，避免已作废后仍显示"已确认"（与 `dataService:1387-1389` 作废时清空 `supplier_confirmations` 呼应）。
- 但**该规则的落地范围只有订单视图**：同批的 `getSupplierReceipts` 无此校验（见 1.7）。

**分页与排序**：`:117` 内存排序（`created_at` 字符串降序）+ `:119` 内存 `slice` 分页，`total` 为内存计算结果。本身正确，但**排序和分页的输入集合已被 `:75` 的 `limit(1000)` 截断**，所以第 2 页可能根本没有数据、`statusCounts` 也系统性偏低——这是"正确实现叠加在上游截断之上"的典型形态。

**发现的问题**：
- `getSupplierOrders:72-76` 高：`purchase_order_item` 一次 `limit(1000)`、无分页、无 `orderBy` → 该供货商累计明细超过 1000 行后，超出部分对应的订单**整体从列表中消失**，`total` 与 `statusCounts` 同步失真，且无任何提示。按每单 5 行、每天 3 单估算约 2 个月触顶。
- `getSupplierOrders:127-129` 中：`...order` 原样外发，包含 `supplier_confirmations`（键为**其他**供应商 `supplier_id`，值为其确认/发货状态与时间）、`created_by`、`cancel_reason`、`cancelled_by`、`verify_status` 等订单级字段 → 与文件头注释"防止泄漏同一张订单中其他供货商的商品信息"不一致：明细层已清洗，订单层仍在泄漏"谁也在做这单、对方确认到哪一步"。
- `getSupplierOrders:88` 低：`orderIds` 未 `filter(Boolean)`（对照 `getSupplierReceipts:67` 有做），若存在 `purchase_order_id` 为空的脏明细，`undefined` 会进入 `_.in` 查询。

---

### 1.7 `cloudfunctions/getSupplierReceipts/index.js`（119 行）

**职责**：供货商视角的收货明细平铺列表（对账用），join 收货主表与异常裁决记录。

**入参**：`authToken`、`page`、`pageSize`。
**出参**：`{ code: 0, data: [{ ...receipt_item, receipt_date, store_id, store_name, purchase_order_id, amount, abnormals: [{type,status,resolution,payment_decision}] }], total, page, pageSize }`。

**读写的集合 + 查询条件**（只读）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `receipt_item` | `{ supplier_id, is_manual: _.neq(true) }` | `orderBy('created_at','desc')`，DB 层 `count()` + `skip/limit` ✅ |
| `receipt` | `{ receipt_id: _.in(chunk) }`（每批 20） | `limit(100)` |
| `abnormal_record` | `{ receipt_id: _.in(chunk), supplier_id }` | `limit(1000)` |
| `app_user` | 同 1.1 | `limit(1)` |

**权限校验（重点）**：`:45` 必须 `role === 'supplier'`，`:46-47` 必须有 `default_supplier_id`；`:54` 行级过滤 `supplier_id`。异常记录查询**额外**带 `supplier_id`（`:84`），不存在"通过异常记录反查他人订单"的路径。`store_name` / `purchase_order_id` 会外发，但均属该供货商自己供货的那张单，不构成越权。

**「内部审批通过前不可见」——本函数未做本地校验，当前靠下游约束顺带成立**：全函数无 `purchase_order.order_status` 校验。但由于 `createReceipt:239` 与 `:417` 只允许 `['approved','report_generated','partial_received']` 状态的订单收货，事实上**不存在"未通过内部审批的订单的收货记录"**。因此该缺口当前无法被触发，但屏障唯一且位于本函数之外——一旦将来放宽收货前置状态（例如允许草稿单预收货），此处会立刻出现"供货商先看到审批前数量"的问题。建议在此函数显式补一条订单状态过滤作为双保险（本函数已 join `receipt.purchase_order_id`，代价很低）。

**分页与排序**：`:49-50` 参数钳位（`page` 1~1000、`pageSize` 1~100）正确；`:56` 先 `count()` 再 `skip/limit`，`total` 可信；`:59` 单键 `created_at desc`，而 `created_at` 是**秒级**时间串（见 `seed-data/receipt_item.json` 的 `2026-08-05 14:00:10`），同秒多行顺序不稳定，翻页边界理论上可能抖动（无二级排序键）。

**发现的问题**：
- `getSupplierReceipts:109` 中：`amount = received_qty × price_snapshot` 对 `payable_flag === false` 的行**照常计算并外发** → 供货商按列表直接求和会高估应收（该行虽带 `payable_flag` 字段可自行区分，但汇总口径由前端承担）。
- `getSupplierReceipts:54` 低（待实测）：`is_manual: _.neq(true)` 依赖"缺字段是否被视为不等于 true"的 SDK 语义；若某历史明细缺 `is_manual`，行为取决于 CloudBase 实现。当前 `createReceipt:506` 恒写 `is_manual`，且手动行的 `supplier_id` 为空已有隐式保护，故风险很低。
- `getSupplierReceipts:59` 低：排序无二级键，秒级时间戳下同秒多行顺序不稳定。
- `getSupplierReceipts:54` 低：不校验关联订单状态（依赖 `createReceipt` 的下游约束，见上）。

---

### 1.8 `cloudfunctions/getReceipts/index.js`（92 行）

**职责**：管理端（采购/门店/超管）收货记录列表，join 明细后返回。

**入参**：`authToken`、`role`（**实际未使用**）、`storeId`（**实际未使用**）、`receiptDate`、`page`、`pageSize`。
**出参**：`{ code: 0, data: [{ ...receipt, items: [...] }], total, page, pageSize }`。

**读写的集合 + 查询条件**（只读）：
| 集合 | 条件 | 排序/分页 |
|---|---|---|
| `receipt` | `chef` → 直接空返回；`store_manager` → `{ store_id: user.default_store_id }`；超管/采购 → 不限；可选 `receipt_date` | `orderBy('created_at','desc')`，DB 层 `count()` + `skip/limit` ✅ |
| `receipt_item` | `{ receipt_id: _.in(chunk) }`（每批 20） | `limit(1000)` |
| `app_user` | 同 1.1 | `limit(1)` |

**权限校验（重点）**：`:50-58` 四分支清晰——`chef` 直接返回空数据（不下推查询，符合"下单人员不看收货记录"）、`store_manager` 强制绑定 `default_store_id` 且无门店时 `-403`、非管理角色 `-403`、超管/采购不限。**注意：这里以 `user.role` 为准，完全忽略前端传入的 `role` 参数**，因此前端伪造 `role` 无法提权。

**「内部审批通过前不可见」**：不适用（管理端，且收货只能发生在已审批订单之后）。

**分页与排序**：正确——参数钳位、DB 层 `count` + `skip/limit`、`created_at desc`。

**发现的问题**：
- `getReceipts:44` 低：`storeId` 被解构后**从未使用**；`pages/receive-list:28` 传入后被静默忽略。`store_manager` 场景下结果仍按其 `default_store_id` 过滤（正确但非按页面当前门店），门店切换后展示的"最近收货"仍属默认门店 → 认知错位而非越权。
- `getReceipts:78` 低：`receipt_item` `limit(1000)` 无分页保护，单张收货单超 1000 行会静默截断明细（现实中很难达到）。
- `getReceipts:44` 低：`role` 参数死代码（无害，仅可读性）。
- `getReceipts:61` 低：`receiptDate` 为精确等于匹配，无区间查询能力（前端如需日期范围只能改云函数）。

---

## 2. 云函数目录全量清单（确认无遗漏）

`ls cloudfunctions/` 与 `Glob cloudfunctions/**/*.json` 交叉核对，**共 19 个云函数**：

| # | 云函数 | 本批是否勘探 |
|---|---|---|
| 1 | `authService` | 否（A 组） |
| 2 | `confirmSupplierOrder` | 部分（仅交叉核对审批白名单） |
| 3 | `createPurchaseOrder` | 否（B 组） |
| 4 | `createReceipt` | 部分（仅交叉核对收货前置状态/`is_manual` 写入） |
| 5 | `dataService` | 否（A 组） |
| 6 | `generateSummaryReport` | 否（报表组） |
| 7 | **`getProductPrices`** | **是** |
| 8 | **`getProducts`** | **是** |
| 9 | `getPurchaseOrderDetail` | 否（B 组） |
| 10 | `getPurchaseOrders` | 否（B 组） |
| 11 | **`getReceipts`** | **是** |
| 12 | `getReportDetail` | 否（报表组） |
| 13 | `getReportFileUrl` | 否（报表组） |
| 14 | `getReports` | 否（报表组） |
| 15 | **`getSupplierOrders`** | **是** |
| 16 | **`getSupplierReceipts`** | **是** |
| 17 | **`getSuppliers`** | **是** |
| 18 | **`importProducts`** | **是** |
| 19 | **`updateProductPrice`** | **是** |

本批 8 个目录逐一 Glob 确认：**均只有 `index.js` + `package.json`，没有任何 `config.json` / `config.index.js` / `node_modules` / 公共模块**（全仓 `cloudfunctions/**/*.json` 只返回 19 个 `package.json`）→ 无额外配置层（超时、内存、权限、环境变量）被遗漏勘探。依赖面：7 个函数只有 `wx-server-sdk ~2.6.3`，`importProducts` 额外依赖 `xlsx ^0.18.5`（SheetJS）。8 份 `getSessionUser` 副本实现完全一致（B12 多设备会话 + legacy 兜底），与 A 组报告记录的"19 份副本"结论吻合。

---

## 3. 与旧报告的一致性复核

| 旧结论（出处） | 当前代码复核 | 判定 |
|---|---|---|
| `importProducts` 判重键不含 `status`，停用商品阻断重建（R4 §3 第 4 条，行号 `:125`） | 当前键构造在 `:127`、判重在 `:159-163` | **仍然成立**（行号漂移 2 行） |
| `getSupplierReceipts:109` 对 `payable_flag===false` 仍展示金额（R4 N24） | 当前仍是 `:109`，无变化 | **仍然成立** |
| `updateProductPrice:43` 波及计数漏 `receipt_abnormal`、`:48` `limit(1000)` 截断（deep 第 309 条） | 两处均未变 | **仍然成立** |
| `updateProductPrice:111-115` 改价无 `change_reason`/`previous_price`/独立审计（deep 第 307 条 M-5） | 审计字段**仍缺失**；但改价写入路径已从裸写变为 `:106-131` 的 `db.runTransaction` | **代码已变化**（并发问题已闭合，审计缺口仍在） |
| `importProducts` 无行数/体积上限、无事务、逐行串行 `add`、超时残留无提示（R4 第 6 条） | 均未变 | **仍然成立** |
| `requireUser` 返回嵌套 `error`，`utils/cloud.js:68` 只判顶层 `code` → 不跳登录（R4 第 36 条） | `utils/cloud.js:68` 仍为 `if (result.code === -401)`，`importProducts:54/56` 仍返回嵌套结构 | **仍然成立** |
| `getProducts:53` 排序单键、无稳定次序（R4 §排序表） | `:53` 未变 | **仍然成立** |
| 模板示例与种子分类不一致（R4 第 190 条） | 模板示例仍是「叶菜类」「禽类」+「蔬菜」「肉禽」，`category.json` 仍无此分类 | **仍然成立**（本轮补充了后果量级：照抄 100% 失败） |
| R6 对"内部审批通过前不可见"的覆盖 | 旧报告未从该维度审视本批 8 个函数；且**只覆盖了订单视图**，未指出收货视图依赖下游约束、价格/商品视图无闸门 | **旧报告覆盖不足（本轮新增）** |
| R6 提到的 `limit(1000)` 截断风险 | 旧报告只落在 `updateProductPrice:48`；本轮在 `getSupplierOrders:75` 找到同型但**后果更重**的实例（订单整体消失而非计数偏差） | **本轮新增** |
| 旧报告关于"供货商视图不泄漏其他供货商商品信息"的正面结论 | 明细层确实已清洗，但 `:127-129` 的 `...order` 仍外发 `supplier_confirmations`（含其他供应商 id 与确认状态） | **旧报告判断有遗漏（本轮新增）** |

---

## 4. 问题清单

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| 高 | `getSupplierOrders/index.js:72-76` | `purchase_order_item` 一次 `limit(1000)`、无分页、无 `orderBy`；订单集合/`total`/`statusCounts`/内存分页全部建立在该截断集合上 | 该供货商累计明细超 1000 行（约每单 5 行、每天 3 单跑 2 个月），老订单整体从列表消失、待确认数归零，无提示 |
| 高 | `importProducts/index.js:149` + `seed-data/product-import-template.md` 示例表 | 模板示例的二级分类「叶菜类」「禽类」在系统中不存在，一级分类「蔬菜」「肉禽」与 `category_level_1_name`（后厨/前厅）不符，精确匹配必然失败 | 新管理员按唯一官方示例填写并提交，全表 0 条成功 |
| 中 | `getSuppliers/index.js:58-59` | `status` 参数直写 `query.status`，`includeInactive` 的 `-403` 守卫只在 `else if` 分支，无法拦截 | `chef`/`store_manager` 传 `status:0`（不传 `includeInactive`），读出全部已停用供应商档案及联系方式 |
| 中 | `importProducts/index.js:122-127, 159-163, 192-199` | 判重为"读时校验、写时无保证"，无唯一索引、无事务、无并发锁 | 两管理员（或双击/前端重试）并发导入同一份 Excel，双方都在 `add` 前通过判重 → 同名同厂家商品成对入库 |
| 中 | `importProducts/index.js:159-162` | 判重键不含 `status` | 曾导入后被停用的商品，重新导入永远报"已存在，跳过"，用户无解 |
| 中 | `importProducts/index.js:192-199` | 逐条 `add` 无事务、无导入批次号；失败项 `row` 记为 `'-'` | 导入中途超时/失败，无法回滚，也无法判断哪些行已入库、需重传哪几行 |
| 中 | `importProducts/index.js:52-59` + `utils/cloud.js:68` + `pages/product-manage/product-manage.js:174` | `requireUser` 返回嵌套 `{error:{code:-401}}`，客户端只判顶层 `code`，且 `msg` 也取不到 | 会话过期后点导入：不跳登录页，只显示「导入失败」，用户反复重试 |
| 中 | `importProducts/index.js:82-95, 101` | 无文件大小/行数上限，`downloadFile` + `XLSX.read` 全量入内存 | 上传超大/畸形 xlsx → 云函数 OOM 或超时，且源文件已在 `:94` 被删除 |
| 中 | `importProducts/index.js:169-171` | 供应商名未匹配仅记 warning 仍插入，`default_supplier_id=''` | 该行商品后续下单走空供应商 → 落 0 价，无账单、无异常记录、无人提醒 |
| 中 | `updateProductPrice/index.js:43` | `INFLIGHT_ORDER_STATUS` 缺 `receipt_abnormal` | 带异常的未收齐订单仍可补收（补收取新价），波及数偏低，前端确认框低估影响 |
| 中 | `updateProductPrice/index.js:60-63` | 波及计数异常时静默按 0 返回 | 计数查询链路故障 → 确认框显示"影响 0 单"，仍允许直接改价 |
| 中 | `updateProductPrice/index.js:106-131` | 无 `change_reason`、无旧值快照、无独立审计集合；旧值只能靠 `is_current:0` 的历史行反推 | 需要回答"谁在何时为什么把 3.5 改成 3.8"（对账纠纷、价格异议） |
| 中 | `getSupplierOrders/index.js:127-129` | `...order` 原样外发，含 `supplier_confirmations`（键为其他供应商 id 及其确认/发货状态）、`created_by`、`cancel_reason`、`verify_status` 等订单级字段；与文件头防泄漏声明不一致 | 任一供货商在订单详情/列表中即可看到同单其他供应商的参与情况与其确认进度 |
| 中 | `getSupplierReceipts/index.js:109` | `amount` 对 `payable_flag === false` 的行照常计算并外发 | 供货商按收货明细列表直接求和，把争议/不可付款行计入应收，高估应收 |
| 中 | `getProducts/index.js:53` | 无分页 + `limit(200)` 且**不返回 `total`** | 商品数超 200，调用方无从知晓数据已被截断 |
| 中 | `getProducts/index.js:56-59` | `keyword` 在 `limit(200)` 之后于内存过滤 | 商品数超 200 时，搜索只能命中按名称升序的前 200 条，其余永远搜不到 |
| 低 | `getProducts/index.js:43-45` | 无角色白名单，任意已登录角色可拉全量启用商品主档 | 当前调用方仅管理端页面，缺口未被利用 |
| 低 | `getProducts/index.js:49-51` | `Number(categoryId)` 对非数字输入得到 `NaN` 直接写入 `where` | 前端传入非法分类 id 时查询行为不确定 |
| 低 | `getProductPrices/index.js:57-61` | 无分页 + `limit(200)` | 单供应商商品数超 200 静默截断 |
| 低 | `getProductPrices/index.js:69-72` | 补商品名不过滤 `product.status`，停用商品的价格仍返回 | 与 `updateProductPrice:92` 只允许启用商品调价形成口径差异 |
| 低 | `updateProductPrice/index.js:103` | `price_id = 'PRC_' + Date.now()`，同毫秒并发重名 | 两人同秒改同一供应商同一商品的价格 |
| 低 | `updateProductPrice/index.js:126` | `updatedBy` 为客户端可传字段，作为 `updated_by` 兜底 | 角色虽限死在管理员，但身份来源仍信任请求方 |
| 低 | `updateProductPrice/index.js:116-130` | 无幂等键，同价重复调用也新增历史行 | 重复提交导致历史价无限增长 |
| 低 | `updateProductPrice/index.js:48` | `purchase_order_item` `limit(1000)` 截断使波及数偏小 | 长尾供应商在途明细超 1000 行 |
| 低 | `getSuppliers/index.js:61` | `keyword` 未转义直接构造 `db.RegExp` | 正则注入 / ReDoS / 全表扫描放大 |
| 低 | `getSuppliers/index.js:51` | 供货商端 `product_count` 硬编码 `0` | 前端据此展示会误导 |
| 低 | `getSuppliers/index.js:67, 78` | `limit(100)` / `limit(1000)` 无分页与截断提示 | 供应商或商品数超阈值 |
| 低 | `getSupplierOrders/index.js:88` | `orderIds` 未 `filter(Boolean)`（对照 `getSupplierReceipts:67` 有做） | 存在 `purchase_order_id` 为空的脏明细时 `_.in` 混入 `undefined` |
| 低 | `getSupplierReceipts/index.js:54` | `is_manual: _.neq(true)` 依赖"缺字段是否视为不等于 true"的 SDK 语义（待实测） | 历史明细缺 `is_manual` 字段时可能漏数据或越界 |
| 低 | `getSupplierReceipts/index.js:54` | 不校验关联订单状态，完全依赖 `createReceipt:239/417` 的下游约束 | 若将来放宽收货前置状态，此处会立刻出现"审批前数量泄露" |
| 低 | `getSupplierReceipts/index.js:59` | 排序无二级键，秒级 `created_at` 同秒多行顺序不稳定 | 翻页边界行可能抖动 |
| 低 | `getReceipts/index.js:44` | `storeId` 参数解构后从未使用（`pages/receive-list:28` 传入后被忽略） | 门店切换后"最近收货"仍属账号默认门店 |
| 低 | `getReceipts/index.js:78` | `receipt_item` `limit(1000)` 无分页保护 | 单张收货单明细超 1000 行 |
| 低 | `getProducts/index.js:53` | 排序单键 `product_name`，同名不同厂家商品顺序抖动 | 编辑态翻页/定位体验不稳定 |
| 低 | `importProducts/index.js:111-112` | 分类/供应商各 `limit(1000)` 静默截断 | 启用分类或供应商超 1000 后名称匹配静默失败 |
| 低 | `importProducts/index.js:155` | 分类重名且一级分类无法收敛时取 `candidates[0]` | 存在重名二级分类时归类结果不确定 |
| 低 | `importProducts/index.js:94` | 下载成功后立即删除源文件，再解析；解析失败则文件已删 | 用户需重新上传 |
| 低 | `importProducts/index.js:204` | `total: rows.length - 1` 把空行计入总数，与"总行数"语义含糊 | 结果弹窗数字与预期不符 |
| 低 | `importProducts/index.js:184`、`getProductPrices/index.js` 全文 | 商品/价格视图无"内部审批后生效"语义（`product` 与 `supplier_product_price` 均无审批字段），导入即 `status:1`、调价即时可见 | 与订单视图"审批前不可见"的规则体系不对称 |
