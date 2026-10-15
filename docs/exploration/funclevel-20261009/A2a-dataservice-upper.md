# A2a · dataService 上半段（1–637 行）· 函数级清单

## 0. 范围与方法

- 逐行读完 `cloudfunctions/dataService/index.js` **第 1 行至第 637 行**（分 3 段：1–220、221–440、441–637）。第 637 行是 `auditOrder` 的闭合大括号；第 638 行起为 `function publicMessage(message)`，**已越界，属下半段，本报告不覆盖**。
- 额外只读：`utils/cloud.js`（1–283 行全文）、`pages/` 下本段 action 的调用点原文、`createPurchaseOrder/index.js` 418–487 行与 orderNo 定义（用于跨段契约验证）、`dataService/index.js` 的 switch（1661–1687）与 `regenerateOrderReports`（1055–1093）。
- 本段共 **21 个函数** + 6 项模块常量。
- 所有结论标注 `文件:行号`。检索方式见各条证据。

## 1. 本段 action 分发表

switch 在 `dataService/index.js:1661-1687`，本段 6 个可路由 action 的挂载已确认：

| event.action | 处理函数 | 函数行号 | switch 行 | requireUser 白名单**原文** | 前端调用点 |
|---|---|---|---|---|---|
| `getCategories` | getCategories | 61 | :1664 | **无白名单**（`requireUser(event)`，:62） | `purchase-create.js:104`、`product-manage.js:38` |
| `saveProduct` | saveProduct | 98 | :1665 | `MANAGEMENT_ROLES`（:99） | `product-manage.js:245` |
| `toggleProduct` | toggleProduct | 139 | :1666 | `MANAGEMENT_ROLES`（:140） | `product-manage.js:274` |
| `saveSupplier` | saveSupplier | 150 | :1667 | `MANAGEMENT_ROLES`（:151） | `supplier-manage.js:77` |
| `toggleSupplier` | toggleSupplier | 183 | :1668 | `MANAGEMENT_ROLES`（:184） | `supplier-manage.js:106` |
| `auditOrder` | auditOrder | 498 | :1669 | `MANAGEMENT_ROLES`（:499） | `approval-detail.js:80`(approved)、`:105`(rejected)、`approval-list.js:76`(approved)、`:97`(rejected) |

**未挂载 switch 的内部函数（15 个，无 action 名）**：hashToken、cloudPathOfFileId、getSessionUser、requireUser、findCategory、createMessage、getStoreManagerId、resolveActiveRecipient、getSupplierUsers、sendSubscribeMessage、notifySuppliersNewOrder、csvField、safePathPart、getNextVersion、regenerateApprovedOrderReports。
检索证据：对全文 grep 这 15 个函数名，命中仅为「定义行 + 内部调用行」，`dataService/index.js:1663-1686` 的 switch 分支列表中不含任何一个。

## 2. 集合与字段写入矩阵（本段范围）

### `product`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| product_name, category_level_1, category_level_2_id, category_name, unit, spec, default_supplier_id, manufacturer_name, updated_at | 114–124 | saveProduct（update :128） |
| + product_id, status, created_at | 132–135 | saveProduct（add :133） |
| status, updated_at | 146 | toggleProduct |

### `supplier`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| supplier_name, contact_name, contact_phone, remark, updated_at | 155–161 | saveSupplier（update :172） |
| + supplier_id, status, created_at | 176–179 | saveSupplier（add :177） |
| status, updated_at | 190 | toggleSupplier |

### `message`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| message_id, type, title, content, biz_id, recipient_user_id, store_id, scope_type, scope_id, read(false), read_by([]), created_at | 195–212 | createMessage（唯一写入口） |

### `purchase_order`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| supplier_confirmations（`_.set({})` 清空）、updated_at | 418–420 | regenerateApprovedOrderReports（条件：qtyChanged 且原 confirmations 非空） |
| order_status, audit_remark, audited_by, audited_at, updated_at | 573–581 | auditOrder（事务内） |

### `purchase_order_item`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| original_order_qty（仅首次）、order_qty, approved_qty, updated_at | 561–570 | auditOrder（事务内，仅 approved 且该 item 在 qtyMap 中） |

### `report_file`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| status='superseded', updated_at | 430–432 | regenerateApprovedOrderReports（`where(source_order_id, report_type in ['store_order_report','supplier_order_report'])` 批量更新） |
| report_id, report_type, report_scope, scope_id, scope_name, related_date, source_order_id, basis_date_type, file_name, file_url, file_version, generated_at, generated_by_system, status='generated' | 445–453（门店）、486–494（供应商） | regenerateApprovedOrderReports |

### `report_version_counter`
| 字段 | 行号 | 触发函数 |
|---|---|---|
| count, updated_at（CAS 条件更新） | 378–380 | getNextVersion |
| _id, count=1, updated_at（add） | 385 | getNextVersion |

### 云存储（非集合）
- `reports/store/{orderDate}/store-order-{storeName}-{orderDate}-{orderNo}-audit-v{ver}.csv`（:443–444）
- `reports/supplier/{orderDate}/supplier-order-{supplierName}-{orderDate}-{orderNo}-audit-v{ver}.csv`（:484–485）

### 只读集合（本段不写）
`app_user`（:28/:34/:218/:234/:264）、`category`（:64/:91）、`supplier`（:107/:162/:170/:317/:469）、`purchase_order`（:503/:549/:590）、`purchase_order_item`（:522）。

## 3. 函数清单

### `hashToken()` (行 13-15)
- **职责**：把明文 authToken 做 SHA-256 摘要（hex），用于在库里比对而非存储明文。
- **入参**：`token`，任意类型，非必填；`String(token || '')` 归一（:14）。
- **返回**：hex 字符串，无错误路径。
- **副作用**：无。
- **权限**：不涉及鉴权，纯工具函数。
- **幂等**：纯函数，天然幂等。
- **调用点**：仅 `getSessionUser` :26。全文 grep `hashToken(` 仅命中 :13 定义与 :26。无前端调用点。
- **契约风险**：无 salt，会话凭据仅靠 token 熵。`String(token||'')` 意味着未登录与传空串得到同一哈希（`getSessionUser` 已在 :25 提前 return null，不构成实际影响）。

### `cloudPathOfFileId()` (行 19-22)
- **职责**：把 `cloud://{env}.{bucket}/{cloudPath}` 的 fileID 还原成 cloudPath；非法格式返回 `''`。
- **入参**：`fileId`，任意类型；`typeof fileId === 'string'` 才匹配，否则按 `''` 正则匹配（:20）。非必填。
- **返回**：`match[1]` 或 `''`。字符串类型，无 code 结构。
- **副作用**：无。
- **权限**：无。
- **幂等**：纯函数。
- **调用点**：**本段无调用点**。全文 grep 命中 :19 定义、:1568、:1612（均在 `verifyManualOrder`，下半段）。无前端调用点。
- **契约风险**：正则 `^cloud:\/\/[^/]+\/(.+)$` 对 `bucket` 段只排除 `/`，若 fileID 含 query 后缀不会剥离；`match[1]` 是贪婪 `(.+)`，cloudPath 中的字符不做二次校验。:1568 的调用方用 `startsWith(voucherPrefix)` 做归属校验，本函数只做格式还原，不承担越权防护。

### `getSessionUser()` (行 24-50)
- **职责**：由 authToken 反查 `app_user`，同时校验账号在岗与会话未过期，返回用户文档或 null。
- **入参**：`authToken`，字符串，必填性由 :25 强制（空/缺 → 返回 null）。
- **返回**：`app_user` 文档对象或 `null`。**不返回 `{code,msg}`**，鉴权失败语义由调用方 `requireUser` 翻译成 `-401`。
- **副作用**：只读。
- **权限**：自身不做角色判断；会话查询固定 `status: 1`（:29、:35）——停用账号一律视为未登录。
- **幂等**：只读幂等。
- **调用点**：仅 `requireUser` :53。grep `getSessionUser(` 仅 :24/:53。无前端调用点。
- **契约风险**：
  - **双轨会话兼容存在短路陷阱**：:41–46 只要 `user.sessions` 是非空数组，就**只认数组路径**并 return（可能返回 null）；:47–49 的 legacy 字段（`session_token_hash`/`session_expires_at`）仅在新会话为空数组时才被读取。:33–39 的 fallback 查询先按 `sessions` 数组查、再按 legacy 字段查，但 legacy 查到的用户若自身带有非空 `sessions` 数组，:42 的 `find` 找不到匹配会话 → **返回 null**，即"legacy 登录令牌在已迁移用户上必然失效"。
  - `Number.isFinite(expiresAt)`（:45、:49）能挡住 `new Date(undefined)` 的 NaN，但 `expires_at` 为 ISO 字符串时依赖 `Date` 解析，格式错时静默返回 null。
  - **只读查询无 store_id 限定**，凭 token 全局可解析身份，跨门店可见范围由各业务函数自行限制。

### `requireUser()` (行 52-59)
- **职责**：鉴权底座——解析会话并按可选角色白名单拦截。
- **入参**：`event`（需含 `authToken`）；`roles` 可选字符串数组。
- **返回**：
  - 未登录 → **嵌套形状** `{ error: { code: -401, msg: '登录已过期，请重新登录' } }`（:54）
  - 角色不符 → **嵌套形状** `{ error: { code: -403, msg: '当前账号无权执行该操作' } }`（:56）
  - 成功 → `{ user }`（:58），**无 `code` 字段**
- **副作用**：无。
- **权限**：白名单**逐调用点原文**如下（本段 6 处）：
  - `getCategories` :62 → `requireUser(event)` —— **无白名单**（任何已登录角色可取分类）
  - `saveProduct` :99 → `requireUser(event, MANAGEMENT_ROLES)`
  - `toggleProduct` :140 → `requireUser(event, MANAGEMENT_ROLES)`
  - `saveSupplier` :151 → `requireUser(event, MANAGEMENT_ROLES)`
  - `toggleSupplier` :184 → `requireUser(event, MANAGEMENT_ROLES)`
  - `auditOrder` :499 → `requireUser(event, MANAGEMENT_ROLES)`
  - 身份来源：**服务端从会话派生**（`auth.user`），不信任前端传入的任何 userId/role 字段。
- **幂等**：只读幂等。
- **调用点**：上述 6 处 + 下半段 15 处（:652、:683、:705、:737、:774、:790、:842、:867、:910、:1059、:1106、:1176、:1350、:1442、:1490、:1559）。
- **契约风险**：**嵌套返回 `{error:{code,msg}}` 与业务层的顶层 `{code,msg}` 是两种形状**。`utils/cloud.js:68` 只判 `result.code === -401`；:54/:56 返回的 `-401`/`-403` 藏在 `.error` 下，`result.code` 为 `undefined` → **前端 401 自动登出逻辑（`cloud.js:68-70`）在本服务的所有鉴权失败时都不会触发**。这是已知系统性缺陷，如实记录形状。

### `getCategories()` (行 61-88)
- **职责**：读启用分类，把一级分类去重成 `level1` 列表 + 明细 `categories` 列表。
- **入参**：`event`（仅用于取 `authToken`），无其他字段被使用。
- **返回**：成功 `{ code: 0, data: { level1: [...], categories: [...] } }`（:87，**顶层**）。失败继承 `requireUser` 的嵌套形状。
- **副作用**：只读 `category`（`.where({status:1}).orderBy('sort_no','asc').limit(100)`，:64–68）。
- **权限**：无白名单（:62）；不按 `store_id` 限制——分类是全公司字典。
- **幂等**：只读。
- **调用点**：
  - `purchase-create.js:104` → `cloud.callFunction('dataService', { action: 'getCategories' })`，无额外参数。
  - `product-manage.js:37-39` → 与 `getProducts`/`getSuppliers` 并发拉取，无额外参数。
  - 两处的使用字段（grep `dataService` action 全文，见 `product-manage.js:225`）：`cats[i].id` / `cats[i].name`，即返回体 `categories[].id`（映射自 `category_id`，:80）与 `categories[].name`（:82）。`level1` 未被消费。
- **契约风险**：`limit(100)` 硬上限，分类超 100 条会被静默截断且无总数回传，前端无法感知。`level1Map[item.category_level_1]`（:72）假设该字段恒非空，缺失时会产生键为 `undefined` 的伪一级分类。

### `findCategory()` (行 90-96)
- **职责**：按分类业务 ID 查一条启用分类。
- **入参**：`categoryId`，**被强制 `Number(categoryId)`**（:92）。字符串、undefined、null 均会转换为数字参与查询（`Number(undefined)`=NaN，`Number(null)`=0，NaN 不会命中）。
- **返回**：分类文档或 `null`。无 code 结构。
- **副作用**：只读。
- **权限**：无独立鉴权，仅被已鉴权的 `saveProduct` 间接调用。
- **幂等**：只读。
- **调用点**：仅 `saveProduct` :103，传参为前端 `event.categoryId`。grep `findCategory(` 全文仅 :90/:103。**无前端调用点**。
- **契约风险**：`Number()` 强制转换意味着 `categoryId` 必须是数字型的 category_id。前端 `product-manage.js:225` 传的 `form.categoryId` 来自 `getCategories` 返回的 `id: item.category_id`（:80），类型一致；但若历史数据中 `category_id` 存的是字符串，此函数会永久查不到 → 表现为 `saveProduct` 返回"商品名称、分类和单位不能为空"（:104），**报错文案与实际缺失字段不符**（可能只是分类 ID 类型不匹配）。

### `saveProduct()` (行 98-137)
- **职责**：新增或更新商品主数据（含分类/默认供应商归属快照）。
- **入参**与校验：
  - `event.name` → trim 后必须非空，否则 :104 失败
  - `event.unit` → trim 后必须非空，否则 :104 失败
  - `event.categoryId` → 经 `findCategory` 解析，解析不到则 :104 失败
  - `event.defaultSupplierId` → trim；非空时校验 `supplier` 中 `{supplier_id, status:1}` 存在（:107–111），否则 `{code:-1, msg:'默认供应商不存在或已停用'}`
  - `event.productId` → **决定新建还是更新**（:125）；更新时校验 `{product_id: event.productId}` 存在（:126），否则 `{code:-1, msg:'商品不存在'}`
  - `event.spec` / `event.manufacturerName` → trim，manufacturerName 空值回填 `'默认'`（:122）
- **返回**：`{code:0, data:{productId}}`（新建 :136 / 更新 :129，**顶层**）；失败均为**顶层** `{code:-1, msg:...}`。
- **副作用**：写 `product`（字段见 §2）。分类、供应商均为**只读引用校验**，不改动被引用方。
- **权限**：`MANAGEMENT_ROLES`（:99）；不按 `store_id` 限制（商品主数据全局）。
- **幂等 / 并发**：**无事务、无幂等键**。新建路径 :132 用 `'P' + Date.now() + randomBytes(3).toString('hex')` 生成 ID，碰撞概率极低但无唯一约束兜底。更新路径 :126→:128 是「查后写」两步，并发两次保存互相覆盖，无 CAS。
- **调用点**：`product-manage.js:244-250`：
  ```js
  { action: 'saveProduct', productId: editItem && editItem.productId, ...form, name: form.name.trim(), unit: form.unit.trim() }
  ```
  实际展开字段：`productId`（可 undefined）、`form` 的 spread（含 `name`/`unit`/`categoryId`/`categoryName`/`defaultSupplierId`/`manufacturerName`/`spec`，`categoryName` 被服务端忽略——用 `category.category_name` 覆盖，:118）、`name`、`unit`。调用方只读 `result.code` 与 `result.msg`（:251–252），**不消费 `data.productId`**，靠 `this.loadData()` 刷新（:254）。
- **契约风险**：
  - **无唯一性约束**：同名商品可重复创建（与 `saveSupplier` 的显式查重 :162–168 形成对比），依赖 `product_id` 随机。
  - **更新路径不做默认供应商有效性重校验之外的业务校验**：`spec`/`manufacturerName` 允许空串（manufacturerName 有默认值，spec 没有）。
  - 前端 `form` spread 可能带入未识别字段，但服务端用显式白名单构造 `data`（:114–124），**不会写入库**——这一点是安全的。
  - `saveProduct` 未在任何地方校验调用者对该分类/供应商的门店权限。

### `toggleProduct()` (行 139-148)
- **职责**：切换商品启停状态。
- **入参**：`event.productId`，必填（缺失时 :142 查询 `product_id: undefined` → 查不到 → :144 返回"商品不存在"，**不报错但语义正确**）。
- **返回**：`{code:0, data:{status}}`（:147，**顶层**，`status` 为切换后的值 0/1）；失败顶层 `{code:-1, msg:'商品不存在'}`（:144）。
- **副作用**：写 `product.status`、`product.updated_at`（:146）。
- **权限**：`MANAGEMENT_ROLES`（:140）；不按 `store_id` 限制。
- **幂等 / 并发**：**非幂等**——状态是读后翻转（`product.status === 1 ? 0 : 1`，:145）。「查后写」两步无 CAS：两个并发点击会各自读旧值再写，最终状态不确定（可能抵消为原值），且 :145 返回的 `status` 与数据库实际最终值可能不一致。
- **调用点**：`product-manage.js:273-276`：`{ action: 'toggleProduct', productId: id }`，`id` 来自 `e.currentTarget.dataset.id`（:262）。消费 `result.data.status` 决定提示「已启用/已停用」（:278）。
- **契约风险**：翻转语义 + 无并发保护；前端靠 `_submitting` 防抖（:271）只挡住单机双击，挡不住多端并发。

### `saveSupplier()` (行 150-181)
- **职责**：新增或更新供应商档案。
- **入参**与校验：
  - `event.supplierName` → trim 后必须非空（:154，`{code:-1, msg:'供应商名称不能为空'}`）
  - **重名校验**：`where({supplier_name}).limit(100)` 中若存在 `item.supplier_id !== event.supplierId` 的记录 → `{code:-1, msg:'该供应商名称已存在'}`（:162–168）
  - `event.supplierId` → 更新路径校验存在性（:170–171）
  - `event.contactName` / `event.contactPhone` / `event.remark` → trim，可空
- **返回**：`{code:0, data:{supplierId}}`（新建 :180 / 更新 :173，顶层）；失败顶层 `{code:-1}`。
- **副作用**：写 `supplier`（见 §2）。
- **权限**：`MANAGEMENT_ROLES`（:151）；不按 `store_id` 限制。
- **幂等 / 并发**：**查重与写入非原子**——:162 查重与 :177 add 之间无锁，两个并发新建同名供应商都可通过查重（`event.supplierId` 均为 undefined，:166 的 `!== event.supplierId` 两侧都非空仍成立），产生重复档案。无事务。
- **调用点**：`supplier-manage.js:76-81`：`{ action:'saveSupplier', supplierId: editItem && editItem.supplierId, ...form, supplierName: form.supplierName.trim() }`。消费 `result.code` / `result.msg`（:82）。
- **契约风险**：
  - **`limit(100)` 查重上限**：同一名称供应商超过 100 条时查重可能漏判。
  - `contactPhone` **无格式校验**（对比供应商联系人电话是业务必填项），可写入任意字符串。
  - 重名校验是**精确匹配**，不含大小写/空白归一（虽已 trim，但中英文空白、全角空格不归一）。

### `toggleSupplier()` (行 183-192)
- **职责**：切换供应商启停状态。
- **入参**：`event.supplierId`，缺失 → :186 查不到 → :188 `{code:-1, msg:'供应商不存在'}`。
- **返回**：`{code:0, data:{status}}`（:191，顶层）。
- **副作用**：写 `supplier.status`、`supplier.updated_at`（:190）。
- **权限**：`MANAGEMENT_ROLES`（:184）；不按 `store_id` 限制。
- **幂等 / 并发**：同 `toggleProduct`，读后翻转无 CAS（:189），并发不安全。
- **调用点**：`supplier-manage.js:105-108`：`{ action:'toggleSupplier', supplierId: id }`。消费 `result.data.status`（:110）。
- **契约风险**：停用供应商不校验是否仍被在途订单/商品价格引用；`saveProduct:111` 会因停用而拒绝新建商品挂到该供应商，但**存量挂载不会清理**。

### `createMessage()` (行 194-213)
- **职责**：写入一条站内消息（供应商定向消息 + 门店广播 + 定向个人三种形态共用）。
- **入参**（单一对象 `data`，**全部可选，无校验**）：`type`、`title`、`content`、`bizId`→`biz_id`、`recipientUserId`→`recipient_user_id`、`storeId`→`store_id`、`scopeType`→`scope_type`、`scopeId`→`scope_id`。缺省一律写入 `''`（:202–:207）。
- **返回**：无 return，函数返回 `Promise<undefined>`。**不返回 message_id**。
- **副作用**：写 `message` 全部 11 个字段（:195–212）；`read:false`、`read_by:[]` 为写死的初始态。
- **权限**：**自身无鉴权**，鉴权完全依赖调用链上游。
- **幂等**：**无幂等键**，每次调用都新增一条，无去重。
- **调用点**（本段 3 处）：
  1. `notifySuppliersNewOrder` :331–338 → `{type:'order', title, content, bizId: order.purchase_order_id, scopeType:'supplier', scopeId: supplierId}`。**未传 `storeId` 与 `recipientUserId`** → 落库 `store_id=''`、`recipient_user_id=''`。
  2. `regenerateApprovedOrderReports` :421–427 → `{title:'订单改量，供货商需重新确认', content, type:'order', storeId, recipientUserId: await resolveActiveRecipient(order.created_by, storeId)}`。**未传 `bizId`、`scopeType`、`scopeId`** → `biz_id=''`。
  3. `auditOrder` :600–606 → `{type:'approval', title, content, bizId: event.orderId, storeId: order.store_id}`。**未传 `recipientUserId`、`scopeType`、`scopeId`** → `recipient_user_id=''`。
  - 下半段另有 5 处（:817、:831、:1427、:1478、:1530）。
- **契约风险**：
  - **调用点参数残缺不成体系**：3 个调用点各缺一组关键字段（①缺 store_id/recipient、②缺 biz_id、③缺 recipient_user_id）。消息的可见范围因此完全依赖读取侧（下半段 `getMessages`）如何组合 `store_id` / `recipient_user_id` / `scope_type` 判定——**本函数不做任何完整性断言**。
  - **无 try/catch**：抛错会直接冒泡，调用方各自决定是否降级（:339 与 :607 都包了 try/catch；:421 那处**没有**包 try/catch，会向 `regenerateApprovedOrderReports` 的调用方冒泡，最终被 `auditOrder:622` 的 catch 降级为 reportWarning）。
  - 无鉴权且无 message_id 回传，无法用于事后撤回/审计对账。

### `getStoreManagerId()` (行 216-227)
- **职责**：查某门店在岗店长的 `user_id`（清单 #5 消息定向口径），查不到返回 `''`。
- **入参**：`storeId`，字符串，无校验。
- **返回**：`(res.data[0] && (res.data[0].user_id || res.data[0]._id)) || ''`（:222），字符串；异常时 `''`（:225）。
- **副作用**：只读 `app_user`（`{role:'store_manager', default_store_id: storeId, status:1}` limit 1，:218–221）。
- **权限**：只读，无需鉴权。
- **幂等**：只读幂等。
- **调用点**：本段仅 `resolveActiveRecipient` :245。下半段另有 :825。grep 全文 `getStoreManagerId(` 命中 :216、:245、:825。无前端调用点。
- **契约风险**：`limit(1)` 无 `orderBy`——门店有多个在岗店长时取哪条由存储顺序决定，**非确定**。catch 吞错返回 `''`（:224–225）会把"数据库故障"降级为"门店广播"，属有意的兜底设计。

### `resolveActiveRecipient()` (行 231-246)
- **职责**：把定向收件人解析为「可用的 user_id」——创建人在岗则用其 ID，否则回退本店店长，再失败回退 `''`（门店广播），避免消息进死信箱。
- **入参**：`userId`（可空）、`storeId`（字符串）。
- **返回**：字符串 user_id 或 `''`。
- **副作用**：只读 `app_user`（`.where(_.or([{user_id:userId},{_id:userId}])).limit(1)`，:234–237）。
- **权限**：无。
- **幂等**：只读幂等。
- **调用点**：本段仅 `regenerateApprovedOrderReports` :426，传参 `(order.created_by, storeId)`。grep 全文仅 :231/:246 与 :426。无其他调用点。
- **契约风险**：
  - `userId` 为 `undefined`/`''` 时直接跳过校验（:232 假值短路），落到 :245 走店长兜底——**语义上把"没有创建人"与"创建人离职"合并处理**。
  - `target.status === undefined ? 1 : target.status`（:239）：**status 字段缺失视为在岗**，与 `getSessionUser:29` 的 `status:1` 硬过滤口径不一致（后者缺失即不可登录）。
  - catch 返回 `userId`（:242）——查询失败时"按在岗处理"，会把消息发给已离职账号，与函数注释"避免消息落进死信箱"的目标相反方向（此处选择了触达优先）。

### `getSupplierUsers()` (行 261-273)
- **职责**：查某供应商全部启用且有 openid 的账号，供订阅消息推送。
- **入参**：`supplierId`，空值短路返回 `[]`（:262）。
- **返回**：用户文档数组（已 filter 掉无 openid 的），失败返回 `[]`（:271）。
- **副作用**：只读 `app_user`（`{role:'supplier', default_supplier_id: supplierId, status:1}` limit 20，:264–267）。
- **权限**：无。
- **幂等**：只读幂等。
- **调用点**：仅 `notifySuppliersNewOrder` :343。grep 全文仅 :261/:343。无前端调用点。
- **契约风险**：`limit(20)` 硬上限，供应商账号超 20 个时静默只推前 20 个。无 `orderBy`，超出后选哪 20 个不确定。

### `sendSubscribeMessage()` (行 276-300)
- **职责**：发微信订阅消息（设计为尽力而为，失败不阻断主流程）。
- **入参**：`user`（需 `.openid`、`.username`）、`payload`（需 `orderNo`/`storeName`/`items`/`amount` 对应 `SUBSCRIBE_TEMPLATE_FIELDS` 的 key）。
- **返回**：`undefined`（无返回值，无错误码）。
- **副作用**：调用 `cloud.openapi.subscribeMessage.send`（:285–291，`touser: user.openid`，`page: 'pages/supplier-orders/supplier-orders'`，`miniprogramState: 'formal'`）。
- **权限**：无。
- **幂等**：**无幂等键、无重试抑制**——重复调用即重复发微信消息（消耗供应商的订阅次数）。
- **调用点**：仅 `notifySuppliersNewOrder` :345。
- **契约风险**：
  - **实际为死代码**：`SUBSCRIBE_TEMPLATE_ID = ''`（:251）恒定为空 → :277–280 必然早退 return，**只写一条日志**。:281–299 的整个构造与发送逻辑不可达，:253–258 的 `SUBSCRIBE_TEMPLATE_FIELDS` 仅被 :283 使用，同为不可达。
  - 由于早退，`payload.amount`（:349 恒传 `''`，对应注释 :310"摘要只报项数不报金额"）**永远不会被使用**。
  - 未校验 `user.openid` 非空（依赖上游 :268 的 filter）。

### `notifySuppliersNewOrder()` (行 303-353)
- **职责**：审核通过后按供应商分组下推通知——站内消息（必写兜底）+ 微信订阅消息（尽力而为）。
- **入参**：`order`（需 `purchase_order_id`/`order_no`/`store_name`）、`orderItems`（**原始**明细数组，需 `is_manual`/`supplier_id`）。无校验。
- **返回**：`undefined`（无返回值；异常向上冒泡）。
- **副作用**：
  - 写 `message`（每个供应商一条，:330–338）
  - 只读 `supplier`（`_.in(supplierIds)` limit 100，:317–320，补名称）
  - 只读 `app_user`（经 `getSupplierUsers`）
  - 触发 `cloud.openapi.subscribeMessage.send`（经 `sendSubscribeMessage`）
- **权限**：无独立鉴权，由 `auditOrder:499` 的 `MANAGEMENT_ROLES` 覆盖。
- **幂等**：**无幂等键**。同一订单每次审核通过都会发一轮；但上游 `auditOrder:515` 的状态检查保证正常路径只触发一次。
- **调用点**：仅 `auditOrder` :630，传参 `(order, itemResult.data)`。
- **契约风险**：
  - **is_manual 过滤有效**（与 `regenerateApprovedOrderReports` 不同）：:305–312 直接遍历**原始** `orderItems`，:307 `if (item.is_manual) return` 命中真实字段，:308–309 还额外检查 `supplier_id` 为空则跳过。这是正确的双重防线。
  - `content` 文案用 `order.store_name || ''` 拼接（:328），供应商名称缺失时回退为 supplierId 字符串（:326）。
  - 循环内对每个供应商 `await createMessage`（:330）+ `await getSupplierUsers`（:343），**串行 N+2 次数据库往返**，订单供应商多时延迟线性放大；:330 有 try/catch，:343/:345 无（`sendSubscribeMessage` 内部自己 catch，:292）。
  - 供应商消息**不带 `storeId`/`recipientUserId`**（:331–338），门店维度不可追溯，只能靠 `scope_type='supplier'` + `biz_id` 反查订单。

### `csvField()` (行 357-362)
- **职责**：CSV 单元格转义——防公式注入 + 双引号转义 + 强制加引号。
- **入参**：`val`，任意；`String(val == null ? '' : val)`（:358）。
- **返回**：带引号的字符串。
- **副作用**：无。
- **权限**：无。
- **幂等**：**不幂等**——对已转义的值再次调用会重复加引号与单引号前缀（本仓调用链均为单次调用，不构成问题）。
- **调用点**：本段 :437/:438/:439/:441（门店下单报表）与 :479/:480/:482（供应商订货汇总）；下半段 :1009、:1016、:1023、:1025、:1210、:1223、:1226、:1246、:1252、:1254、:1283、:1286、:1306、:1312、:1314（收货类报表）。
- **契约风险**：正则 `/^[=+\-@]/`（:360）只拦 ASCII 前导字符，**不拦制表符/回车/CRLF 公式注入变体**（Excel 对 `\t`、`\r` 开头的公式同样执行）。以 `'` 前缀中和是标准做法但依赖表格软件的实现。

### `safePathPart()` (行 364-366)
- **职责**：把值转成可安全用于云存储路径的片段（过滤路径非法字符 + 截断 80 + 空值兜底）。
- **入参**：`value`，任意；`String(value || '')`。
- **返回**：`_.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)`，空则 `'未命名'`（:365）。
- **副作用**：无。
- **权限**：无。
- **幂等**：幂等（替换后无残留非法字符）。
- **调用点**：本段 :443（storeName）、:484（supName）；下半段 :1027、:1228、:1255、:1288、:1315。
- **契约风险**：仅过滤 Windows/云存储非法字符，**不过滤空格、全角字符、`.` 尾随**；`slice(0,80)` 可能在多字节字符中间截断产生代理对残留。路径中同时拼接 `orderNo`（未过 `safePathPart`，:443/:484），若 `orderNo` 含 `/` 会产生嵌套目录——但 `orderNo` 由 `createPurchaseOrder:322` 生成为 `PO + dateStr + base36 + hex`，实际安全。

### `getNextVersion()` (行 368-394)
- **职责**：按 `reportType_scopeId_relatedDate` 生成单调递增的报表版本号，用 CAS 保证并发不重号。
- **入参**：`reportType`、`scopeId`、`relatedDate`，均字符串，无校验；三者拼接成计数器 `_id`（:371）。
- **返回**：版本号数字（从 1 起）；5 次重试全败抛 `Error('getNextVersion: 计数器更新失败')`（:393）。
- **副作用**：读/写 `report_version_counter`（`.doc(counterId).get()` :374 → `.where({_id, count:current}).update` :378–379 → `.add({_id, count:1})` :385）。
- **权限**：无（被上游已鉴权函数调用）。
- **幂等 / 并发**：**这是本段并发控制最完整的地方**。注释 :369–370 明确说明原「`_.inc` 后回读」的两步缺陷（并发双方回读同一最终值 → 版本跳号/report_id 碰撞）。现实现：条件更新 `count === current` 才自增，`stats.updated === 1` 才算抢到（:380）；否则重读重试；文档不存在则走 add，add 撞 `_id` 说明并发方已建，重试转 CAS（:385–390）。5 次上限（:373）。
- **调用点**：本段 :435（`store_order_report`/storeId/orderDate）、:478（`supplier_order_report`/sid/orderDate）；下半段 :1014（`supplier_receipt_price_report`）、:1222、:1245、:1282、:1305。
- **契约风险**：
  - `.doc(counterId).get().catch(() => null)`（:374）——把"文档不存在"与"权限/集合错误"合并成 `null`，走 add 分支；:387–390 的注释正是针对这一点，只在 `attempt === 4` 打日志。
  - **版本号永不回收**：一旦自增成功即使后续报表生成失败也不回滚，下次同号段会跳号。业务上可接受（宁可跳号不可重号）。
  - `scopeId` 为空串时 counterId 为 `supplier_order_report__${relatedDate}`（双下划线），与真实供应商维度混在同一集合里——本段 :460 的 `|| 'unknown'` 哨兵把空供应商归到 `'unknown'`，但 :464 已过滤 `'unknown'`，所以**本路径下不会生成空 scopeId 的计数器**。
  - `count` 非数字或负数时（:376 `current !== null && Number.isFinite(current) && current >= 0` 不满足）会反复走 add 分支，最终第 5 次抛错——即**脏数据无法自愈**。

### `regenerateApprovedOrderReports()` (行 401-496)
- **职责**：审核后按批准数量重生成下单类报表——旧版标记 superseded、新版按审核后数量生成，并在改量时清空供应商确认状态。
- **入参**：`order`（需 `_id`/`store_id`/`store_name`/`order_date`/`purchase_order_id`/`delivery_date`/`created_by`/`created_by_name`/`is_manual`/`supplier_confirmations`）、`orderItems`（原始明细）、`qtyMap`（`{item_id: approvedQty}`）、`qtyChanged`（默认 `true`，:401）。无校验。
- **返回**：无 return（`Promise<undefined>`）；异常向上冒泡。
- **副作用**（完整）：
  1. 写 `purchase_order.supplier_confirmations`（`_.set({})`）+ `updated_at`（:418–420），**条件**：`qtyChanged && order.supplier_confirmations && Object.keys(...).length`（:416）
  2. 写 `message`（:421–427，改量提醒采购经办人，`recipientUserId: resolveActiveRecipient(order.created_by, storeId)`）
  3. 批量写 `report_file.status='superseded'`（:430–432，`where(source_order_id: orderNo, report_type in ['store_order_report','supplier_order_report'])`）
  4. 调 `getNextVersion`（:435 门店、:478 供应商）
  5. 云存储上传 2 类文件（:444、:485）
  6. 写 `report_file`（add）2 类记录（:445–453、:486–494）
  7. 只读 `supplier`（批量 20 个一组，:467–474）
- **权限**：无独立鉴权，由调用方覆盖。
- **幂等 / 并发**：
  - **`superseded` 标记已跨段验证可命中**：`createPurchaseOrder:431–433` 与 `:480–482` 写入的 `source_order_id` 均等于 `orderNo`，而 `createPurchaseOrder:322` 定义 `const orderNo = orderId || ('PO' + ...)` 且 `:379 purchase_order_id: orderNo` → 即 `source_order_id === purchase_order_id`，与 :413 `const orderNo = order.purchase_order_id` 一致。**superseded 查询能正确命中原始报表**。
  - 但 `report_id` 设计为 `_A` 后缀（:447、:488），与原始记录（`RPT_SO_${orderNo}`）不同，因此**重复调用不会主键碰撞，而是每次新增一批**——本函数**不是幂等的**，会不断累积 `report_file` 记录与云存储文件（版本号递增，旧文件不删）。
  - 无事务包裹整个流程；`:430` superseded 与 `:445` add 之间存在窗口，中途抛错会出现"旧报表已标 superseded、新报表缺失"。
- **调用点**：
  - `auditOrder:621` → `regenerateApprovedOrderReports(order, itemResult.data, qtyMap)` —— **未传第 4 参数**，`qtyChanged` 取默认 `true`。
  - 下半段 `regenerateOrderReports:1085` → `(..., qtyMap, false)` —— 明确传 `false`（缺报表补生成，避免误清确认、误发改量消息，对应 :400 注释）。
- **契约风险**：
  - **`qtyChanged` 默认值 + `auditOrder` 双重判断**：`auditOrder:619` 先判 `if (qtyChanged)` 才调用，所以本段路径下 `qtyChanged` 恒为 `true`，:416 的"仅改量才清确认"分支实际生效。:400 注释描述的"qtyChanged=false（缺报表补生成）"场景**只存在于下半段**，本报告不覆盖其鉴权（`GLOBAL_ROLES`，:1059）。
  - **is_manual 过滤是死代码**：:402–409 的 `orderItems.map(...)` 生成的新对象**只含** `productName`/`category`/`unit`/`supplierId`/`remark`/`orderQty` 六个字段，**不含 `is_manual`**。因此 :459 `if (item.is_manual) return` 恒为 `false`，永不触发。手动商品实际上是因为 :460 `item.supplierId || 'unknown'`（`supplier_id` 为空 → `'unknown'`）+ :464 `filter(sid => sid !== 'unknown')` 才被排除。与 `createPurchaseOrder:443–444`（遍历原始 items，`if (item.isManual || item.is_manual) return`）的正确写法形成对比。**行为结果正确，但 :458 的注释与实际机制不符，且该分支不可达**。
  - **报表头字段口径与原始报表不一致**：:438 的门店报表头比 `createPurchaseOrder:422` 多了一组 `csvField('备注'), csvField('审核后重发')`，且 manualTag 判定从 `manualCount > 0`（下单时按明细统计）改成 `order.is_manual`（重发时按订单标记）。若历史订单 `is_manual` 缺失但含手动商品明细，重发的门店报表头不会打"手动商品专用单"标。
  - `:443`/`:484` 文件名中的 `orderNo` 未过 `safePathPart`（仅 `storeName`/`supName` 过），依赖 `orderNo` 本身无非法字符。
  - `:478` 供应商维度版本号 `getNextVersion('supplier_order_report', sid, orderDate)` 中 `sid` 可能为任意字符串（来自明细 `supplier_id`，未经存在性校验），拼出的 counterId 与 `createPurchaseOrder` 用真实 `supplier_id` 查的编号共享同一序列。

### `auditOrder()` (行 498-635)
- **职责**：采购订单审批的**唯一状态机入口**——批准/驳回，批准时可逐行改量，改量后重算报表并重置供应商确认，批准则下推供应商通知。
- **入参**：
  - `event.orderId` → 映射 `purchase_order_id`，:504 查询；缺失会导致查询命中空 → :508 失败
  - `event.status` → **必须为 `'approved'` 或 `'rejected'`**，:501 `if (!['approved','rejected'].includes(event.status)) return {code:-1, msg:'审核状态无效'}`
  - `event.auditRemark` → 驳回时必填（:518–520），批准时可选，:576 trim 后写入
  - `event.items` → 可选数组，元素 `{itemId, approveQty}`；**approved 时若传非数组** → :528 `{code:-1, msg:'审核状态无效'→'审核明细格式无效'}`
- **返回**：
  - `{code:0, data:{reportWarning: '订单状态已变化（可能已被作废），已跳过报表重算与供应商通知'}}`（:596，事务提交后复查发现状态已被他人改动）
  - `{code:0, data:{reportWarning: ''}}`（:635，正常完成；`reportWarning` 为空串或改量报表失败文案）
  - `{code:0, data:{reportWarning: '审核已通过，但下单报表重算失败，请联系管理员处理。'}}`（:624，报表重算抛错被 :622 catch 降级）
  - 顶层 `{code:-1, msg:...}` 共 7 种：`审核状态无效`(:501)、`采购订单不存在`(:508)、`不能审核自己下的单，请由其他管理员审核`(:513)、`该订单已经审核，请勿重复操作`(:516、:584)、`驳回时必须填写原因`(:519)、`审核明细格式无效`(:528)、`审批数量必须大于 0 且不超过下单数量，请检查后重试`(:542)
  - 鉴权失败为**嵌套** `{error:{code:-401/-403, msg}}`（:500 直接 return `auth.error`）
  - 事务外异常兜底：`:1688–1690` 顶层 catch → `{code:-1, msg:'CloudBase 数据操作失败，请稍后重试'}`
- **副作用**：见下方分支分解。
- **权限**：`requireUser(event, MANAGEMENT_ROLES)`（:499）→ 仅 `super_admin` / `purchaser`。
  - **身份来源**：`auth.user` 完全由服务端从会话派生（:511 `auth.user.user_id || auth.user._id`）。
  - **不按 `store_id` 限制可见范围**：任何超管/采购员可审核**任意门店**的订单。这是与下半段 :1458、:1504（`if (!GLOBAL_ROLES.includes(...) && order.store_id !== (auth.user.default_store_id||''))`）不同口径——`auditOrder` **没有**这条限制。
- **幂等 / 并发控制**：**本段最严密**。
  1. 事务外预检：状态检查（:515）、自审检查（:512）、驳回原因检查（:518）
  2. `db.runTransaction`（:547）+ 事务内**复查**状态（:549–557），非 `submitted`/`pending_approval` 则 `rollback({code:-1, msg:'该订单已经审核，请勿重复操作'})`
  3. rollback 自定义信息在 catch 里用 `err.errMsg.includes('该订单已经审核')` 识别（:584）→ 转成业务返回
  4. 事务提交后再复查一次（:590–597），拦截"事务提交 → 后续动作"窗口内被 `cancelOrder` 作废的场景
  5. **无幂等键**，靠状态机本身防重入
- **分支分解（关键状态机）**：

**A. `rejected` 分支**
- `purchase_order_item`：**完全不改**（:560 `if (event.status === 'approved' && ...)` 短路，明细循环内 0 次 update）
- `purchase_order`（事务内，:573–581）：`order_status='rejected'`、`audit_remark`（trim 后）、`audited_by = auth.user.name`、`audited_at = db.serverDate()`、`updated_at`
- 报表：**不动**（不 superseded、不重生成；:614 `qtyChanged` 为 `false` 因 status 非 approved）
- `message`：`type='approval'`，title `'采购申请已驳回'`，content `'{order_no||orderId}被驳回'`，`bizId`、`storeId`（:600–606，:608 catch 吞错降级为日志）
- 供应商通知：**不发**（:628 条件为 approved）
- **未清空 `supplier_confirmations`**（驳回后供应商可能仍持有"已确认"状态，但订单已不可收货——本段无清理动作）

**B. `approved` 且 `items: []`（列表页批量通过路径）**
- 前端证据：`approval-list.js:75–78` 固定传 `items: []`
- `:530–532` 得到空 `qtyMap`；`:533–545` 校验循环空转
- `purchase_order_item`：`:558–572` 循环中 `qtyMap[item.item_id]` 为 `undefined` → `Number.isFinite(undefined)` 为 `false` → **0 次 update**，明细保持原下单量
- `purchase_order`：`order_status='approved'` + 审计字段
- `qtyChanged = false`（:614–617，`Number.isFinite(undefined)` 短路）→ **不重算报表、不清 `supplier_confirmations`**
- **仍发供应商通知**（:628 仅判 status）
- 结论：该路径语义正确（按原量全量批准，报表口径不变），且与"改量才重发"的设计自洽

**C. `approved` 且 `items` 完整（详情页路径）**
- 前端证据：`approval-detail.js:79–82` 传 `items: detail.items.map(i => ({itemId, approveQty}))`，且前端已前置校验 `approveQty > 0`（:73–77）
- 服务端校验（:533–545）：`itemId` 必须在 `itemResult.data` 的 `item_id` 集合内（:534、:541 `validIds.has`）；`approveQty` 必须 `Number.isFinite` 且 `> 0` 且 `<= sourceItem.order_qty`（:541）——**服务端独立复查，不信任前端**
- `purchase_order_item`（事务内，逐行）：`original_order_qty`（**仅首次**：`item.original_order_qty === undefined ? item.order_qty : item.original_order_qty`，:565）、`order_qty = approvedQty`、`approved_qty = approvedQty`、`updated_at`（:561–570）
- `purchase_order`：同 B
- `qtyChanged = true`（:614–617，只要有一行 `approvedQty !== order_qty`）→ 调 `regenerateApprovedOrderReports(order, itemResult.data, qtyMap)`（:621）→ 触发 §"regenerateApprovedOrderReports" 的全部副作用（含清空 `supplier_confirmations`、superseded、重生成 2 类报表）
- `reportWarning` 传播：`:622–625` catch 降级为文案，**订单状态已是 approved，不重试**
- 供应商通知：`:628–634`，catch 降级为日志

**D. 状态已被并发改动**
- 事务内 rollback（:554–556）→ catch 识别（:584）→ 返回 `该订单已经审核`
- 事务外 :590–597 复查 → 返回 `code:0` + `reportWarning`（**注意：此处仍视为成功，前端会 showSuccess，只是不打 warning 之外的提示——实际 :84 会 showToast(reportWarning)**）

- **调用点**：4 处（见 §1）。所有调用方都只消费 `result.code`、`result.msg`、`result.data.reportWarning`（`approval-detail.js:83–87`、`approval-list.js:79–83`），**不消费任何明细/报表数据**。
- **契约风险**：
  1. **`items` 完整性未校验（最重要）**：服务端**没有**校验 `event.items` 是否覆盖 `itemResult.data` 的全部明细。若前端漏传某些行，这些行在 `:558–572` 中因 `qtyMap` 无对应项而被**静默按原下单量批准**，且 `:614` 的 `qtyChanged` 也会漏判。后果：审批人以为改了全部行，实际部分行按下单量通过；若被漏行的原下单量本身有误，会直接进生产流程。
  2. **`rollback({code,msg})` 传的是对象，`:584` 却用 `err.errMsg.includes('该订单已经审核')` 匹配**（字符串 includes）。cloud.database 的 `rollback` 期望字符串参数，传对象后 errMsg 内容**未实测**——若被序列化为 `[object Object]`，该判定失效，会落到 `:585 throw err` → 顶层 catch 返回通用的"CloudBase 数据操作失败"，用户看到的错误文案与真实原因（重复审核）不符。**未验证**，需实测确认 `rollback` 对对象参数的处理方式。
  3. **事务内复查用的是 `purchase_order_id` 查询，事务内更新用的是事务外读到的 `order._id`**（:573 `transaction.collection('purchase_order').doc(order._id)`，而 :549–552 的 recheck 拿到的是 `currentOrder`，其 `_id` 未被使用）。若 `purchase_order_id` 无唯一索引且数据中存在重复值，`:limit(1)` 可能取到与 `order` 不同的文档，导致状态被更新到"错误"的订单上。**未验证**：`purchase_order_id` 是否存在唯一索引。
  4. **`audited_by` 存的是 `auth.user.name`（姓名），不是 user_id**（:577），无法用于审计链上的账号追溯（停用/改名后会丢失可追溯性）；对比下半段 :1650 `verified_by` 用的是 `auth.user.user_id || auth.user._id`。
  5. **`event.items` 在 `rejected` 时不做类型校验**：:527 的条件含 `event.status === 'approved'`，rejected 传 `items: "string"` 会在 :530 `(event.items || []).forEach` 处抛 `TypeError` → 顶层 catch 返回"CloudBase 数据操作失败"（前端实测两路都传数组，未触发）。
  6. **`order_status` 初始集合只含 `['submitted','pending_approval']`**（:515、:554），说明"待审"有两种入口态，但本段不负责产生这两个值。
  7. **`qtyChanged` 判定用 `approvedQty >= 0`**（:616），而 :541 已保证 `> 0`，`>= 0` 是宽松写法，不影响结果但语义不一致。
  8. **无 `store_id` 归属校验**（见权限），跨门店审批能力需产品侧确认是否为预期。
  9. **报表重算失败无补偿标记**：`:622–625` 仅 console.error + reportWarning 文案，**没有**给订单打 `missing_reports` 标记。而下半段的补救入口 `regenerateOrderReports`（:1058–1093）虽然存在且已挂载 switch（:1681），但 grep `pages/**` 全文**无 `regenerateOrderReports` 调用点**（本仓旧报告 `docs/exploration/controller-horizontal-scan-20261004.md:75`、`rescan-20261004-R3-purchase-cloud.md:354` 亦已确认为无前端入口）。即：**审核改量后报表重算失败的兜底链路目前不可达**。

## 4. 状态机转移（本段范围）

```
purchase_order.order_status
  submitted          --(auditOrder approved, :575)--> approved
  pending_approval   --(auditOrder approved, :575)--> approved
  submitted          --(auditOrder rejected, :575)--> rejected
  pending_approval   --(auditOrder rejected, :575)--> rejected
  approved|rejected  --(auditOrder, :515/:554 拒绝)--> 无转移（终态，本段无出口）

purchase_order.supplier_confirmations
  非空对象           --(regenerateApprovedOrderReports, :418-420, 仅 qtyChanged)--> {}
  空对象/缺失        --(同函数 :416 条件不满足)--> 无写操作（避免无谓写）
  {}                --(本段无出口)--> 本段内无人重新填充（供应商确认由 confirmSupplierOrder 云函数负责，不在本文件）

product.status
  1 --(toggleProduct :145/:146)--> 0
  0 --(toggleProduct :145/:146)--> 1     （同函数三元翻转，双向）

supplier.status
  1 --(toggleSupplier :189/:190)--> 0
  0 --(toggleSupplier :189/:190)--> 1

report_file.status
  generated         --(regenerateApprovedOrderReports :430-432 批量)--> superseded
  superseded        --(本段无出口)--> 终态
  'generated'       --(:451/:492 新 add)--> generated（新版本，与旧版本并存）

report_version_counter.count
  缺失              --(add :385)--> 1
  n                 --(CAS update :378-380, where count===n)--> n+1
```

**无出口的终态**：`purchase_order.order_status = rejected`、`report_file.status = superseded`。
**注意**：`approved` 在本段也无出口（收货/作废/改量在下半段 `cancelOrder`/`requestCancel`/`settleReceipt` 处理），但本段负责写入 `approved`。

## 5. 调用图（本段内的边）

**同步函数调用：**
- `requireUser()` → `getSessionUser()`（:53）
- `getSessionUser()` → `hashToken()`（:26）
- `saveProduct()` → `findCategory()`（:103）
- `resolveActiveRecipient()` → `getStoreManagerId()`（:245，回退路径）
- `notifySuppliersNewOrder()` → `createMessage()`（:331）
- `notifySuppliersNewOrder()` → `getSupplierUsers()`（:343）
- `notifySuppliersNewOrder()` → `sendSubscribeMessage()`（:345）
- `regenerateApprovedOrderReports()` → `resolveActiveRecipient()`（:426）
- `regenerateApprovedOrderReports()` → `createMessage()`（:421）
- `regenerateApprovedOrderReports()` → `getNextVersion()`（:435、:478）
- `regenerateApprovedOrderReports()` → `csvField()`（:437–441、:479–482）
- `regenerateApprovedOrderReports()` → `safePathPart()`（:443、:484）
- `auditOrder()` → `requireUser()`（:499）
- `auditOrder()` → `createMessage()`（:600）
- `auditOrder()` → `regenerateApprovedOrderReports()`（:621，仅 approved 且 qtyChanged）
- `auditOrder()` → `notifySuppliersNewOrder()`（:630，仅 approved）

**数据库间接影响（非函数调用）：**
- `auditOrder` 改 `purchase_order_item.order_qty` → 影响 `regenerateApprovedOrderReports` 生成的报表数字（通过 `qtyMap` 参数传递，:408）
- `auditOrder` 改 `purchase_order.order_status='approved'` → 使下游（收货/供应商接单）可行；同时 `:515` 阻断二次审核
- `regenerateApprovedOrderReports` 改 `report_file.status='superseded'` → 影响报表列表页的版本筛选
- `toggleSupplier` 改 `supplier.status=0` → 影响 `saveProduct:107-111` 的默认供应商校验结果

**消息通知（外部系统）：**
- `notifySuppliersNewOrder` → `cloud.openapi.subscribeMessage.send`（:285，当前因 `SUBSCRIBE_TEMPLATE_ID=''` 恒早退，实际不发）
- `regenerateApprovedOrderReports` → `cloud.uploadFile`（:444、:485）
- `createMessage` → 站内消息表（间接被下半段 `getMessages` 消费）

**外部调用方（跨云函数）：**
- 无。云函数各自独立部署，`csvField`/`safePathPart`/`getNextVersion` 在 `createPurchaseOrder/index.js` 里是**复制的独立副本**（:421、:427、:468 可见同名函数被使用），无法跨函数 require。

## 6. 死代码与未闭合点

1. **`sendSubscribeMessage` 的整个推送体不可达**（:281–299）：`SUBSCRIBE_TEMPLATE_ID = ''`（:251）恒定 → :277 `if (!SUBSCRIBE_TEMPLATE_ID)` 必然成立 → :279 return。连带 :253–258 的 `SUBSCRIBE_TEMPLATE_FIELDS` 仅被 :283 使用，同样不可达。:283 使用的 `payload.amount` 在 :349 恒传 `''`。
2. **`regenerateApprovedOrderReports:459` `if (item.is_manual) return` 不可达**：`item` 来自 :402–409 的 `.map()`，新对象无 `is_manual` 字段 → `undefined` → 恒 false。实际过滤靠 :460 `item.supplierId || 'unknown'` + :464 `filter(sid => sid !== 'unknown')`。:458 的注释"显式 is_manual 过滤"与实际机制不符（对比 `createPurchaseOrder:443–444` 是对原始 items 遍历，那里的 `is_manual` 过滤有效）。
3. **`notifySuppliersNewOrder:309` `if (!sid) return` 是冗余但有效的兜底**：:307 的 `is_manual` 过滤已覆盖手动商品（手动商品 `supplier_id` 为空），:309 只拦"非手动但 supplier_id 缺失"的脏数据。
4. **`GLOBAL_ROLES`（:8）在本段 1–637 行内零引用**：本段 6 个入口全部用 `MANAGEMENT_ROLES` 或不传白名单。首次引用在 :665（下半段）。
5. **`VOUCHER_SUBMIT_ROLES`（:11）在本段零引用**：首次引用在 :1559（下半段 `verifyManualOrder`）。
6. **`case 'regenerateOrderReports'`（:1681）无前端调用点**：switch 已挂载、函数已实现（:1058–1093）、鉴权为 `GLOBAL_ROLES`，但 `pages/**` 下 grep 全文无 `regenerateOrderReports` 字符串（命中全部落在 `docs/` 与 `cloudfunctions/`）。这是 `auditOrder` 报表重算失败（:622）唯一的理论补救入口，形成未闭合链路。
7. **`rollback({code, msg})` 传对象 vs `err.errMsg.includes()` 匹配字符串**（:555 vs :584）：接口形状不一致，**可能**导致 :584 判定失效（判定失效时用户拿到的是 :1690 的通用文案而非 :584 的友好文案）。未实测，列入未验证。
8. **`cloudPathOfFileId` 在本段零调用**：定义在 :19–22（新增的副本），首次调用在 :1568/:1612（下半段）。本段范围内它是"已定义未使用"。
9. **`createMessage` 的 `read_by: []`（:209）字段**：本段无任何写入 `read_by` 的代码（已读回写在下半段 `markMessageRead`/`markAllMessagesRead`），仅初始化。
10. **`saveSupplier` 的 `contactPhone` 无格式校验**（:158）：非死代码，属校验缺失。

## 7. 未验证清单

| # | 事项 | 建议验证方式 |
|---|---|---|
| 1 | `db.runTransaction` 的 `transaction.rollback({code, msg})` 传对象后，`err.errMsg` 的实际字符串内容是否为 `transactionError: [object Object]`（决定 `auditOrder:584` 判定是否失效） | 在本地/dev 环境对同一订单连点两次审批，观察第二次返回的 msg 是"该订单已经审核"还是"CloudBase 数据操作失败" |
| 2 | `purchase_order.purchase_order_id` 是否有唯一索引（决定 `auditOrder:573` 用事务外 `order._id` 与事务内 `currentOrder._id` 是否可能分叉） | 查云开发控制台索引配置，或对 `purchase_order` 执行 `where(purchase_order_id).limit(1000)` 统计重复值 |
| 3 | 嵌套 `{error:{code:-401}}` 是否**确实**绕过了 `utils/cloud.js:68` 的自动登出 | 用过期 token 请求 `getCategories`，观察是否弹出"登录已过期"toast 并跳登录页（预期：不触发） |
| 4 | `regenerateOrderReports` 是否"有意不提供前端入口"还是漏做（影响 `auditOrder` 报表失败的可恢复性） | 产品侧确认；旧报告 `controller-horizontal-scan-20261004.md:75`、`rescan-20261004-R3-purchase-cloud.md:354` 已两次记录为缺口 |
| 5 | `purchase_order.supplier_confirmations` 的填充/消费逻辑在 `confirmSupplierOrder` 云函数中，本段只负责清空，**未读该函数** | 读 `cloudfunctions/confirmSupplierOrder/index.js` 确认清空后的确认态如何重建 |
| 6 | `getSessionUser:41-46` 对"带 sessions 数组的 legacy 用户"返回 null 是否为预期（登录迁移期的行为） | 构造一条带 `sessions` 数组但仅有 `session_token_hash` 的测试账号，调 `getSessionUser` 观察返回值 |
| 7 | `category.category_id` 实际存储类型（数字 vs 字符串）——决定 `findCategory:92` 的 `Number()` 转换是否恒可命中 | 查 `category` 集合实际数据 / schema 定义 |
| 8 | `SUBSCRIBE_TEMPLATE_ID` 是否计划配置（决定 :277–299 是否长期为死代码） | 产品侧确认是否已申请订阅消息模板 |
| 9 | `auditOrder` 无 `store_id` 归属校验是否符合产品预期（跨门店审批能力） | 产品侧确认；对比下半段 :1458/:1504 的门店归属校验口径 |
| 10 | `csvField` 的公式注入防护是否覆盖 `\t`/`\r` 开头的值 | 用 `\t=cmd|...` 构造一个商品名，导出报表后在 Excel 中验证是否执行 |

## 8. 行数对账

| 项 | 数值 |
|---|---|
| 读取区间 | `dataService/index.js` **第 1 行至第 637 行**（3 段：1–220、221–440、441–637，无跳读） |
| 第 637 行内容 | `}` —— `auditOrder` 的闭合大括号 |
| 第 638 行（已越界，属下半段） | `function publicMessage(message) {` |
| 本段函数数 | **21**（hashToken、cloudPathOfFileId、getSessionUser、requireUser、getCategories、findCategory、saveProduct、toggleProduct、saveSupplier、toggleSupplier、createMessage、getStoreManagerId、resolveActiveRecipient、getSupplierUsers、sendSubscribeMessage、notifySuppliersNewOrder、csvField、safePathPart、getNextVersion、regenerateApprovedOrderReports、auditOrder） |
| 其中可路由 action | **6**（getCategories、saveProduct、toggleProduct、saveSupplier、toggleSupplier、auditOrder，switch 已确认 :1664–1669） |
| 纯内部函数 | **15**（无 action 名） |
| 模块常量 | **6**（`db`:5、`_`:6、`GLOBAL_ROLES`:8、`MANAGEMENT_ROLES`:9、`VOUCHER_SUBMIT_ROLES`:11、`SUBSCRIBE_TEMPLATE_ID`:251 + `SUBSCRIBE_TEMPLATE_FIELDS`:253–258） |
| 额外只读文件 | `utils/cloud.js`（1–283 全文）、`createPurchaseOrder/index.js`（418–487、:322/:379 定义）、`dataService/index.js`（1055–1093、1661–1692） |
| 本段涉及的集合 | 写 6 个（product、supplier、message、purchase_order、purchase_order_item、report_file、report_version_counter —— 实为 **7**）、只读 5 个（app_user、category、supplier、purchase_order、purchase_order_item） |
| 前端调用点 | 4 个文件 8 处（purchase-create、product-manage、supplier-manage、approval-detail、approval-list） |
| 无前端调用点的内部函数 | 15 个（全部纯内部）；额外 1 个**有 switch 挂载但无前端入口**：`regenerateOrderReports` |

---
**关键结论摘要**：`auditOrder` 是本段唯一状态机入口，事务 + 三重状态复查是设计最严密处；主要契约风险是 ① `event.items` 未校验是否覆盖全部明细（漏传行被静默按原量批准）、② `rollback` 传对象而用字符串 `includes` 匹配（可能失效，未验证）、③ 事务外 `order._id` 与事务内 `currentOrder._id` 未对齐（依赖唯一索引，未验证）、④ 无 `store_id` 归属限制。`regenerateApprovedOrderReports:459` 的 `is_manual` 过滤为不可达死代码（行为靠 `'unknown'` 哨兵兜住）；`sendSubscribeMessage` 因模板 ID 恒空整体不可达；`auditOrder` 报表重算失败无 `missing_reports` 标记，且唯一补救入口 `regenerateOrderReports` 无前端调用点。
