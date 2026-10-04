# 子代理 C：采购读取链 + 报表读取/生成链（7 个云函数）全面勘探

> 分支：`backup`（只读，未改动任何业务代码）｜日期：2026-10-04｜HEAD：`07b6461 fix(supplier): restrict order visibility and actions until internal approval`
>
> 方法：7 个 `index.js` 逐个**完整读取**（未跳读），7 个 `package.json` 逐个读取，`Glob` 确认目录结构。以当前代码为准独立验证，参考（不抄）`deep-20261004/04`、`deep-20261004/06`、`rescan-20261004-R5`、`rescan-20261004-R10`。

---

## 0. 结论摘要

1. **行数实测**：`getPurchaseOrders` 148 / `getPurchaseOrderDetail` 149 / `confirmSupplierOrder` 124 / `generateSummaryReport` 280 / `getReportDetail` 261 / `getReports` 103 / `getReportFileUrl` 64，**合计 1129 行**（旧文档记 270/257，与本轮 280/261 差 10/4 行，差异来源见 §6）。
2. **目录结构极简**：7 个目录**每个只有 `index.js` + `package.json` 两个文件**，`Glob` 确认**无 `config.json`**、无 `layers`、无测试文件。7 个 `package.json` 结构完全同构（`version 1.0.0` + 唯一依赖 `wx-server-sdk: ~2.6.3`），**无超时/内存/并发配置声明** → 全部走控制台默认（默认 60s + 512MB），`generateSummaryReport` 全量拉取 + 内存聚合是唯一接近硬约束的一个。
3. **权限过滤总体合格，本组未发现跨门店/跨供应商的现行越权**：7 个函数的角色判定**全部基于服务端会话 `user`**，客户端传入的 `role`/`storeId` 一律被忽略或二次覆盖（`getReports:79-86` 的"只收窄不放宽"双重覆盖是正确的）。**没有一处"先查全量再内存过滤"导致越权**——3 处（`getPurchaseOrderDetail:48-51`、`getReportDetail:62-65`、`getReportFileUrl:46`）是"按主键点查后内存判权限"，判定发生在任何返回之前，不构成泄漏。
4. **两处真正的"先查全量"性能/正确性缺陷在供应商入口**（不在本组 7 文件，但属本组最重点的可见性链，一并报出）：`getSupplierOrders:72-76` 明细 `limit(1000)` **静默截断**、`:117` 按 `String(Date).localeCompare` **字典序排序**（星期名主导，跨月错乱）+ 内存分页。
5. **最新 commit 的覆盖结论：in-app 供应商入口已闭合，报表导出通道未覆盖。** `getSupplierOrders` 的 `HIDDEN_ORDER_STATUS` 追加 `submitted`/`pending_approval`、`confirmSupplierOrder` 的两个白名单去掉 `submitted`，使**供应商门户内**看不到也操作不了未过内部审核的订单——但这只闭合了 3 个入口中的 2 个：**`createPurchaseOrder:440-490` 在 `orderStatus === 'submitted'` 时（审核前）就已生成并上传供应商订货汇总 CSV**，且 `getReports`/`getReportDetail`/`getReportFileUrl` **均不过滤 `report_file.status`** → 审核前版本的订货单仍可被内部人员下载并线下转发给供应商；`auditOrder` 改量后旧版只标 `superseded`（`dataService:415-416`），文件本身不删。**详见 §5。**
6. **报表金额口径确认三处失配**：① 汇总"下单数量"在分批收货时**成倍放大**（`generateSummaryReport:218`，高）；② 汇总金额**未剔除 `payable_flag === false`**，与带价报表/账单口径不一致（`:199-223`，中）；③ 详情页重建的收货报表用 `receipt.limit(1)` **无 orderBy**，分批收货时显示的不是该报表对应的那一批（`getReportDetail:100-103`，高）。时间范围口径本身**无 bug**：日汇总 `receipt_date === date` 等值、月汇总 `_.gte('YYYY-MM-01').and(_.lte('YYYY-MM-31'))` 闭区间（含首含尾），依据**收货日期 `receipt_date`（裸字符串）**，不是 `created_at`。
7. **与旧报告不一致共 3 处**：`getNextVersion` 撞号已修复（4 个文件全部落地 CAS）、汇总类报表对 **store_manager 并非"不可达"**（R5 §0.1 判断有误）、R5 §7.1 关于"传空 fileId 会命中首条种子记录"的后果描述有误（`getReportFileUrl:44` 已前置拦截）。**详见 §6。**

---

## 1. 文件清单与目录结构

### 1.1 Glob 结果（7 个目录全部命中）

```
cloudfunctions/getPurchaseOrders/index.js          cloudfunctions/getPurchaseOrders/package.json
cloudfunctions/getPurchaseOrderDetail/index.js     cloudfunctions/getPurchaseOrderDetail/package.json
cloudfunctions/confirmSupplierOrder/index.js       cloudfunctions/confirmSupplierOrder/package.json
cloudfunctions/generateSummaryReport/index.js      cloudfunctions/generateSummaryReport/package.json
cloudfunctions/getReportDetail/index.js            cloudfunctions/getReportDetail/package.json
cloudfunctions/getReports/index.js                 cloudfunctions/getReports/package.json
cloudfunctions/getReportFileUrl/index.js           cloudfunctions/getReportFileUrl/package.json
```

**14 个文件，无一遗漏；无任何 `config.json`、`layers/`、`node_modules/` 之外的其他文件。**

### 1.2 package.json（7 份，结构完全同构）

| 目录 | name | description | dependencies |
|---|---|---|---|
| getPurchaseOrders | getPurchaseOrders | 获取采购单列表 | `wx-server-sdk: ~2.6.3` |
| getPurchaseOrderDetail | getPurchaseOrderDetail | 获取采购单详情 | 同上 |
| confirmSupplierOrder | confirmSupplierOrder | 供货商确认接单 / 标记发货 | 同上 |
| generateSummaryReport | generateSummaryReport | 门店日汇总/月汇总报表生成 | 同上 |
| getReportDetail | getReportDetail | 获取报表详情含行数据 | 同上 |
| getReports | getReports | 按角色查询报表列表 | 同上 |
| getReportFileUrl | getReportFileUrl | 获取报表文件临时下载链接 | 同上 |

观察：
- **依赖用波浪号 `~2.6.3`**：部署时浮动到 2.6.x 最新 patch，存在供应链版本漂移面（无 lockfile、无 `devDependencies`）。
- **7 份全部没有 `timeout`/`memorySize`/`maxConcurrentRequests` 声明**（这些在微信云开发里由控制台配置，不在 `package.json`）→ 无法从代码判断超时设置。`generateSummaryReport` 是唯一全量拉取 + 内存聚合的函数，默认 60s 是硬约束。
- **依赖声明与代码不完全对齐**：7 个函数都 `require('crypto')`（Node 内置，无需声明，无问题），但 `generateSummaryReport` 用 `cloud.uploadFile`/`getTempFileURL` 也只需 SDK，**依赖声明本身没有缺失**。

---

## 2. 逐文件小节

### 2.1 `getPurchaseOrders/index.js`（148 行）

**职责**：采购单列表（服务端分页 + 9 个状态 tab 计数），按角色 + 门店 + 创建人做行级过滤。

**入参**（`event`）：
| 参数 | 用途 | 处理 |
|---|---|---|
| `authToken` | 会话 | SHA-256 后查 `app_user.sessions`（多设备），失败回退 `session_token_hash`（旧单会话）；`getSessionUser:11-37` |
| `page` | 页码 | `Math.max(1, Math.min(1000, Math.floor(Number(event.page) \|\| 1)))`（`:44`） |
| `pageSize` | 每页条数 | `Math.min(100, Math.max(1, ...))`，默认 20（`:45`） |
| `orderStatus` | 状态筛选 | 虚拟值 `to_verify`→`verify_status='pending'`（仅全局角色，`:70-72`）；`receivable`→`order_status ∈ [approved, report_generated, partial_received]`（`:73-74`）；其他值**原样透传**（`:75-76`，无白名单） |
| `orderDate` | 下单日期等值筛选 | 原样透传（`:78`，无格式校验） |
| `storeId` | 门店筛选 | **仅全局角色生效**（`:62`） |
| `createdBy` | 创建人筛选 | **仅全局角色生效**（`:63`） |
| `role` | — | **解构后全文 0 使用**（`:43`），一律用会话 `user.role` |

**出参**：`{ code, data: [ {...order, created_by_name, items: [...] } ], total, page, pageSize, statusCounts }`。`statusCounts` 含 `all/draft/submitted/received/receiptAbnormal/cancelled/partialReceived/toVerify/receivable` 9 项（`:96-106`）。错误码 `-401`（会话失效）、`-403`（无门店绑定 / 非全局角色请求 `to_verify` / 非授权角色）、`-1`（异常）。

**集合读写与查询条件**：
| 集合 | 读/写 | 查询条件 |
|---|---|---|
| `app_user` | 读（鉴权）×2 次兜底、读（创建人名） | `{status:1, sessions:{token_hash}}` / `{session_token_hash, status:1}` / `{user_id: _.in(chunk)}` |
| `purchase_order` | 读 ×11 | ①9 次 `count()`（`baseQuery` + 各自状态条件，`Promise.all`）②1 次 `count()`（`query`）③1 次 `where(query).orderBy('created_at','desc').skip().limit()` |
| `purchase_order_item` | 读，20 个订单号/块 | `{purchase_order_id: _.in(idChunk)}`，`limit(1000)`（`:121-124`） |

**隐含索引需求**：
- `purchase_order`：复合 `{store_id, created_by, order_status}`（chef 路径 + 状态 count）、`{store_id, created_at}`（店长排序分页）、`{created_by, created_at}`（全局 + 创建人）、`{verify_status}`（`to_verify` count）、`{order_date}`。这是全链路查询最密集的一处——**9 次 `count()` + 1 次分页查询，若上述复合索引缺失，单次列表请求会退化为 10+ 次全集合扫描**。
- `purchase_order_item`：`{purchase_order_id}`。
- `app_user`：`{status, sessions.token_hash}`、`{session_token_hash, status}`、`{user_id}`。

**数据可见性/权限过滤（重点）**：**正确**。角色过滤全部下推到 DB `where`（`:53-59`），不存在"先查全量再内存过滤"。`statusCounts` 是 9 次独立 `count()`（非内存过滤）且用剥离了状态条件的 `baseQuery`，不受当前 tab 影响（`:80-95`）——正确做法。内存中只有 items 分组和创建人名映射，均基于 DB 结果返回的 id，不会越权。chef 被强制 `store_id + created_by` 双条件（`:54-55`），全局角色只能收窄不能放宽。
- 小缺口：`orderStatus` 无白名单（`:75-76`）→ 传任意值返回空列表，无安全风险但有校验缺口；`storeId` 对全局角色不做存在性校验（传不存在的值返回空）。

---

### 2.2 `getPurchaseOrderDetail/index.js`（149 行）

**职责**：单张采购单详情（主表 + 明细 + 已收聚合 + 收货记录 + 报表元数据）。

**入参**：`authToken`、`orderId`（必填，`:44-45`）。**无分页参数、无筛选参数**。

**出参**：`{ code, data: { ...order, created_by_name, items: [...], receipts: [...], reports: [...] } }`。

**集合读写**：
| 集合 | 查询条件 | limit |
|---|---|---|
| `purchase_order` | `{purchase_order_id: orderId}` | 1 |
| `app_user` | `{user_id: order.created_by}` | 1 |
| `purchase_order_item` | `{purchase_order_id: orderId}` | 1000 |
| `supplier` | `{supplier_id: _.in(chunk)}`，**仅非 chef** | 100 |
| `receipt_item` | `{purchase_order_item_id: _.in(itemIds)}` | 1000 |
| `receipt` | `{purchase_order_id: orderId}` | 100 |
| `report_file` | `{source_order_id: orderId}` | 100 |

**隐含索引需求**：`purchase_order{purchase_order_id}`、`purchase_order_item{purchase_order_id}`、`receipt_item{purchase_order_item_id}`、`receipt{purchase_order_id}`、`report_file{source_order_id}`、`supplier{supplier_id}`、`app_user{user_id}`。

**数据可见性/权限过滤（重点）**：
- 权限门禁（`:57-67`）**正确**：先按主键点查单文档，再判权限，**判定在任何返回之前**→不构成泄漏。全局角色放行；chef 必须本店**且本人创建**（`:61-65`）；store_manager 必须本店；supplier 等其他角色 403。
- **chef 信息边界有缺口**：`:84-97` 注释声称"chef 不见供应商身份"，实现上确实**不下发 `supplier_name`**（`:86` 跳过 `supplier` 查询、不注入 `supplier_name`）——但 `:85` 的 `let items = itemsRes.data` 让 **chef 仍收到每行的 `supplier_id` 原值**（如 `SUP001`）。身份边界只挡住了一半。
- **报表元数据边界不对称**：`:131-133` 对 chef 按 `report_scope === 'store'` 过滤（正确，供应商级报表元数据含 `scope_name` 供应商名 + `file_url`），但**对 store_manager 不过滤** → 店长拿到该单关联的**供应商级报表元数据**（供应商名 + 文件 ID）。

---

### 2.3 `confirmSupplierOrder/index.js`（124 行）

**职责**：供货商确认接单（`action='confirm'`）/ 标记发货（`action='ship'`），写 `purchase_order.supplier_confirmations[supplier_id]`，发货时向门店写站内消息。

**入参**：`authToken`、`orderId`、`action`（`'confirm' | 'ship'`，其余返回 `-1 不支持的操作类型`）。**无分页/筛选参数。**

**出参**：`{ code: 0, data: { orderId, supplierId, status } }` 或 `-401/-403/-1`。

**集合读写**：
| 集合 | 操作 | 条件 |
|---|---|---|
| `purchase_order_item` | 读（越权校验） | `{purchase_order_id: orderId, supplier_id: supplierId}`，`limit(1)`（`:65-68`） |
| `purchase_order` | **条件更新** | `where({purchase_order_id, order_status: _.in(allowedStatus)}).update()`（`:78-80`）；`updated===0` → `-1` |
| `purchase_order` / `supplier` | 读（发货文案） | `{purchase_order_id}` / `{supplier_id}`，各 `limit(1)`（`:88-96`） |
| `message` | **新增** | 发货时 `add`（`:98-113`） |

**隐含索引需求**：`purchase_order_item{purchase_order_id, supplier_id}`（越权校验的关键路径）、`purchase_order{purchase_order_id, order_status}`（条件更新的 where）、`supplier{supplier_id}`、`message` 按 `{store_id}` 消费侧索引（不在本函数）。

**状态白名单（最新 commit 的核心改动）**：
```js
// :11-13（当前代码）
const CONFIRMABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive']
const SHIPPABLE_ORDER_STATUS  = ['approved', 'report_generated', 'to_receive', 'partial_received']
```
审核前状态（`draft`/`submitted`/`pending_approval`/`rejected`）**全部不在白名单内** → 供应商无法在内部审核通过前确认或发货。

**数据可见性/权限过滤（重点）**：**越权校验正确且优于普通等值过滤**——用"该订单必须真的含本供应商的商品明细"（`:64-69`）作为归属判定，而非信任客户端。条件更新（`:78-80`）实现了原子"检查状态 + 写入"，避免读-判-写竞态（并发作废/收货后仍写入确认），`:81-83` 对 `updated===0` 有明确兜底文案。**这是本组唯一带条件更新的写路径，实现质量高。**
- **缺口 1（无单调性/无前置约束）**：`:62` 只按 `order_status` 白名单判定，**不看确认状态** → ① 未确认可直接标记发货；② `shipped` 可被再次 `confirm` 回退成 `confirmed`（`:73-80` 纯覆盖写，单槽 `updated_by` 被覆盖，无历史记录）。前端 `supplier-orders` 的 UI 约束可被直接调云函数绕过。
- **缺口 2（口径不一致）**：`:65-68` 的越权校验**不含 `is_manual` 过滤**，与 `getSupplierOrders:72` 的 `is_manual: _.neq(true)`"双保险"不一致。当前手动单强制 `supplier_id=''`，`supplier_id: supplierId` 无法命中 → **今日不可触发**，但未来若允许手动单指定供应商即成越权通道。
- **缺口 3（消息无幂等）**：`:98-113` 每次 `ship` 都 `message.add`，`message_id` 用 `Date.now()+random` 而非稳定键 → 供应商反复点"标记已发货"会向门店刷 N 条重复消息。对比 `createReceipt` 用稳定 `MSG_RECEIVE_${receiptId}`。
- **语义小缺口**：`CONFIRMABLE` 不含 `partial_received` 而 `SHIPPABLE` 含 → 部分收货中可继续发货但不能（重新）确认；且白名单里的 `report_generated`/`to_receive` 是**无人写入的死状态**（`to_receive` 还同时不可收货、不可作废 → 落入即永久卡死）。

---

### 2.4 `generateSummaryReport/index.js`（280 行）

**职责**：门店日汇总 / 月汇总报表生成（拉全店收货明细 → 内存按"供应商|商品"聚合 → 组装 CSV → 上传云存储 → 落 `report_file` 元数据）。

**入参**：
| 参数 | 校验 |
|---|---|
| `authToken` | 同其他函数 |
| `period` | 白名单 `['daily','monthly']`（`:174`） |
| `date` | `isDate`（`:82-86`）严格 `YYYY-MM-DD` 且**回写比对拒绝 `2026-02-30`** 等非法日历日 |
| `storeId` | 非全局角色强制覆盖为 `user.default_store_id`（`:180-185`）；全局角色必须显式传（`:186`），并在 `:188-189` 校验门店存在 |

**出参**：`{ code: 0, data: { fileID, fileName, totalAmount, itemCount } }`。

**集合读写**：
| 集合 | 操作 | 条件 |
|---|---|---|
| `store` | 读 | `{store_id: storeId}`，`limit(1)` |
| `receipt` | `count()` + 分页读 | daily：`{store_id, receipt_date: date}`；monthly：`{store_id, receipt_date: _.gte('YYYY-MM-01').and(_.lte('YYYY-MM-31'))}`；`field({receipt_id:true})` + `skip/limit(100)`（`:89-109`） |
| `receipt_item` | 分页读 | `{receipt_id: _.in(chunk 20个)}` + `skip/limit(100)`（`:113-129`） |
| `product` | 读 | `{product_id: _.in(chunk)}`，投影 `{product_id, category_name, category_level_1, unit}` |
| `supplier` | 读 | `{supplier_id: _.in(chunk)}` |
| `report_version_counter` | 读 + **CAS 条件更新** | `doc(counterId).get()` → `where({_id, count: current}).update({count: current+1})` → `updated===1` 才算抢到，最多 5 次重试（`:53-79`） |
| `report_file` | **新增** | 16 字段（`:247-265`） |

**隐含索引需求**：`receipt{store_id, receipt_date}`（**最关键**：count + 分页都靠它）、`receipt_item{receipt_id}`、`product{product_id}`、`supplier{supplier_id}`、`store{store_id}`、`report_file` 插入无索引需求、`report_version_counter{_id}`（天然唯一）。

**报表金额汇总逻辑（本函数是口径问题的核心）**：
| 维度 | 结论 | 证据 |
|---|---|---|
| 汇总维度 | 门店 × 供应商 × 商品，分组键 `supplier_id + '|' + product_id`（同商品多供应商分行） | `:203-204` |
| 剔除项 | **仅 `is_manual`**（`:201`，注释：手动行金额走凭证核销） | `:200-201` |
| **未剔除项** | **`payable_flag === false`（质量/错货/缺价异常行）全部计入金额** | `:199-223` 无该字段判定 |
| 金额公式 | 逐行 `round(received_qty * price_snapshot * 100)/100` 再累加，合计再舍入一次 | `:221-225`（与带价报表 `:626/:707` 同为逐行舍入 → 舍入口径自洽） |
| **下单数量** | `agg.orderQty += Number(item.order_qty_snapshot)` **按 receipt_item 逐行累加** | `:218` |
| 时间依据 | **收货日期 `receipt_date`（裸字符串 `'YYYY-MM-DD'`），非 `created_at`** | `:92-94` |
| 时间边界 | daily：**精确等值** `receipt_date === date`（单点匹配）；monthly：**闭区间** `gte(01).and(lte(31))`，**含首含尾**；上界用字符串 `'31'`，对 30 天/28 天月份大于任何合法日期 → 等价整月，**不构成 bug**（字符串比较 `'2026-02-31' < '2026-03-01'`） | `:92-94` |
| 时区 | `receipt_date` 是裸字符串非 Date 对象 → **无 UTC+8 偏移风险** | `:92-94` |
| 未来日期 | 只验格式，**不禁止未来日期** → 可生成必然为空的报表 | `:175-176` |

**数据可见性/权限过滤（重点）**：**正确，无跨店越权**。`:170-172` 角色白名单 `['store_manager','purchaser','super_admin']`；`:178-185` 非全局角色（即 store_manager）**强制** `storeId = user.default_store_id`，客户端伪造 `storeId` 无效；`:188-189` 门店存在性校验。chef / supplier → 403。
- **无生成幂等**：`:192` 起直接取数，**生成前不查重、无"生成中"锁**；两次生成同店同日会产生两条报表 + 两个 CSV，版本号各自递增但**不标最新版**。
- **两步不原子且无补偿**：`uploadFile`（`:242-245`）→ `report_file.add`（`:247-265`），`add` 失败留下**云存储孤儿文件 + 版本号白烧**，`catch`（`:276-279`）只返回 `-1`，**不写 `missing_reports` 标记、不发通知、不清理**。对比 `createPurchaseOrder`/`createReceipt` 均有 `missing_reports` + 通知 + 补生成入口——**汇总是三条生成链路里唯一没有补偿机制的**。
- **无空结果守卫**：门店当期无收货（或全为手动行被 `:201` 跳过）时仍 `bump` 版本号、上传 3 行 CSV（表头 + 合计 0.00）、落库、返回 `code:0 itemCount:0`。
- **CSV 安全到位**：`csvField` 双引号包裹 + `""` 转义 + 公式注入防御（`^[=+\-@]` 前缀 `'`）（`:41-46`）。**但 `csvField` 不转义字段内换行** → 见 §2.5 的解析侧问题。
- `safePathPart`（`:48-50`）**定义后全文 0 调用**，`:241` 路径直拼 `storeId`；全局角色可传任意存在门店的 id，若档案含 `/ \ 空格` 将被解释为目录层级。

---

### 2.5 `getReportDetail/index.js`（261 行）

**职责**：按报表元数据的 `report_type` 从**原始集合重新构建行数据**（除汇总类走"下载 CSV 反解析"），返回 `{...report, rows}`。

**入参**：`authToken`、`reportId`（必填）。**无分页/筛选参数**（rows 全量返回）。

**出参**：`{ code: 0, data: { ...report, rows: [...] } }`；汇总类解析失败**向上抛**，外层返回 `-1 报表详情加载失败`（`:248-251`，不静默成空表——正确）。

**5 条重建分支**（覆盖 8 种 `report_type`）：

| 分支 | 行号 | 粒度 | 查询与 limit | 与 CSV 是否同源 |
|---|---|---|---|---|
| `store_order_report` | `:84-97` | 单订单 | `purchase_order_item{purchase_order_id}` `limit(1000)` 无分页 | 一致（同单同源） |
| `store_receipt_report` / `store_receipt_price_report`（共用） | `:98-129` | 单订单 | `receipt{purchase_order_id}` **`.limit(1)` 无 orderBy** → `receipt_item{receipt_id}` `limit(1000)` | **不一致**（分批收货取错批） |
| `supplier_order_report` | `:130-160` | **按日聚合多单** | `purchase_order{order_date: date}` **`.limit(200)` 无分页**；`purchase_order_item{purchase_order_id in 20个, supplier_id}` `limit(1000)` | **不一致**（CSV 是单订单，这里是当日全门店并集） |
| `supplier_receipt_report` / `supplier_receipt_price_report`（共用） | `:161-202` | **按日聚合多单** | `receipt{receipt_date: date}` **`.limit(200)` 无分页**；`receipt_item{receipt_id in 20个, supplier_id}` `limit(1000)` | **不一致** |
| 日/月汇总 | `:203-253` | 下载 CSV → 手工 RFC4180 解析 | `cloud.downloadFile`（无分页，受文件大小限制） | 一致（唯一走文件路径的分支） |

**集合读写**：`report_file{report_id}`（`:62-65`，`limit(1)`）、`purchase_order_item`、`receipt`、`receipt_item`、`purchase_order`。

**隐含索引需求**：`report_file{report_id}`（**应建唯一索引**，全仓无 `database/rules.json` 可查）、`purchase_order_item{purchase_order_id}`、`purchase_order_item{purchase_order_id, supplier_id}`、`receipt{purchase_order_id}`、`receipt{receipt_date}`、`receipt{receipt_id}`、`receipt_item{receipt_id, supplier_id}`、`purchase_order{order_date}`。

**数据可见性/权限过滤（重点）**：
- 权限判定（`:71-77`）**逻辑正确**：chef/store_manager 需 `report_scope === 'store' && scope_id === default_store_id`，chef 追加 `report_type === 'store_order_report'`；supplier → 403。按主键点查后判权限、判定在返回之前 → 不构成泄漏。
- **潜在缺口**：`:75` 未前置校验 `!user.default_store_id` → 若 `report.scope_id` 与 `user.default_store_id` **同为 `undefined`/`''`**，`!==` 判定为 `false` → **放行**。对照 `getReports:54/59` 有显式 `if (!user.default_store_id) return -403`、`getPurchaseOrderDetail:61` 有 `!user.default_store_id ||` 前置。**当前不可达**（14 处 `report_file.add` 均显式写 `scope_id` 且经非空校验），属潜隐风险而非现行漏洞。
- **不校验 `report.status`**：`superseded` 报表照常可看、可重建、可下载。叠加下面两条分支问题 → 打开已作废的 v1 报表，页面表格显示**审核改量后**的数量，点"导出"下载到**改量前**的 CSV，两者数字不同源。
- **chef 边界与订单链不一致**：`:75-76` 对 chef 只查 `scope_id`，**不查 `created_by`** → chef 能打开同店**其他同事**订单的下单报表（含明细行），而 `getPurchaseOrders:55` / `getPurchaseOrderDetail:64` 明确把 chef 限制到本人创建的订单。同一"厨师信息边界"在订单链与报表链口径不一。

---

### 2.6 `getReports/index.js`（103 行）

**职责**：按角色 + 范围 + 类型 + 日期查询报表元数据列表（服务端分页）。

**入参**：
| 参数 | 处理 |
|---|---|
| `authToken` | 同其他 |
| `reportScope` | 白名单 `['store','supplier']`，非法返回 `-1`（`:46`）；**仅全局角色生效**（`:63`） |
| `reportType` | 8 项白名单，非法 `-1`（`:68-76`） |
| `relatedDate` | **仅正则** `/^\d{4}-\d{2}-\d{2}$/`（`:47`），**不校验日历日** → 放行 `2026-02-31` |
| `page` / `pageSize` | `clamp(1,1000)` / `clamp(1,50)`，默认 20（`:88-89`） |
| `role` / `storeId` | **解构后全文 0 使用**（`:43`），前端两个页面都在传 |

**出参**：`{ code, data: [完整 report_file 文档], total, page, pageSize }`。**无 `field()` 投影** → 整条文档下发，含 `file_url`（fileID）、`total_amount`、`excluded_rows`。

**集合读写**：`report_file` —— 1 次 `count()`（`:90`）+ 1 次 `where(query).orderBy('generated_at','desc').skip().limit()`（`:91-96`）。

**隐含索引需求**：`report_file` 需 `{report_scope, report_type, scope_id}`（chef/store_manager 主路径）、`{report_scope, scope_id, related_date}`、以及排序列 `{generated_at}`。最大 `skip = 999 × 50 = 49950`，无分页越界风险。

**数据可见性/权限过滤（重点）**：**本组权限写法最严谨的一个**。`:50-66` 首轮按角色设置，`:73-77` 处理客户端参数，**`:79-86` 在客户端参数处理之后再次覆盖** chef/store_manager 的 `report_scope`/`report_type`/`scope_id` —— "Client filters can narrow results but cannot expand role scope"，**客户端伪造参数无法扩大范围**。chef 被强制到 `store + store_order_report + 本店`；store_manager 被强制到 `store + 本店`；purchaser/super_admin 全量 + 可选 scope；supplier 及其他角色 → `-403`（`:64-66`）。**无任何内存过滤。**
- 缺陷 1：不返回"最新版"标记，也不按 `status` 过滤 → `superseded` 与 `generated` 混列。
- 缺陷 2：`orderBy('generated_at','desc')` **无次要键** → 同毫秒批量落库的多张报表在翻页边界顺序不确定，可能重复或遗漏。
- 缺陷 3：`count()`（`:90`）与 `get()`（`:91-96`）是两次独立调用，**非原子**，翻页期间新增报表会导致 `total` 与已加载条数短暂不一致。
- **注意**：store_manager 未被强制 `report_type`（`:83-85` 只覆盖 `report_scope` + `scope_id`），而汇总类报表的 `report_scope === 'store'` → **store_manager 实际可达日/月汇总报表**（前端 `report-list` 的 tab 只有 6 种、不含汇总类，所以只能落在"全部" tab）。这与 R5 §0.1 的判断不符，见 §6。

---

### 2.7 `getReportFileUrl/index.js`（64 行）

**职责**：把已登记的报表 `fileID` 换成云开发临时下载链接。

**入参**：`authToken`、`fileId`（必填）。

**出参**：`{ code: 0, data: { url } }`（**只有 `url`**）；错误 `-401` / `-1 缺少fileId` / `-1 报表文件不存在` / `-403` / `-1 获取链接失败`。

**集合读写**：`report_file{file_url: fileId}` `limit(1)`（`:46`）——**先反查记录**，不存在直接终止，不触达云存储。

**隐含索引需求**：`report_file{file_url}`（应唯一；全 14 处 `add` 的 `file_url` 均为 `uploadFile` 返回值，天然唯一）。

**数据可见性/权限过滤（重点）**：**越权不成立，三道防线叠加**：
```
fileId 为空 → -1 (:44)
  → report_file.where({file_url: fileId}) 反查 (:46)     ← ① 必须先命中登记记录，无法当通用 fileID 换取器
      → 无记录 → -1 (:47)，不触达云存储
  → 角色/作用域校验 (:49-54)                             ← ② 按调用者收窄
  → cloud.getTempFileURL({fileList:[fileId]}) (:55)      ← ③ 最后才换链接
```
- 越权矩阵：`super_admin`/`purchaser` 全库任意（`:49` 直接放行）；`store_manager` 限 `report_scope==='store' && scope_id===自身门店`、**不限 type**；`chef` 追加 `report_type === 'store_order_report'`（`:53`）；**`supplier` 一律 `-403`**；未登录 `-401`。
- 枚举攻击不可行：fileID 含 `Date.now().toString(36)` + 24bit 随机后缀，且命中后仍受 `:49-54` 约束。
- **缺口 1（潜在，当前不可达）**：`:50` 无 `!user.default_store_id` 前置校验，两侧同为假值时 `undefined !== undefined` 为 `false` → 放行。对照 `getReports:54/59`、`getPurchaseOrderDetail:61` 均有前置；`getReportDetail:75` 同样存在。
- **缺口 2**：不校验 `report.status` → `superseded` 报表文件仍可下载（`getReportDetail:62-65` 同样不校验）。
- **缺口 3**：返回体只有 `{url}`，**不含 `expireTime`/`fileName`/`fileType`** → 前端无从感知链接有效期，过期后 `wx.downloadFile` 失败与网络失败共用"下载失败"文案。
- **【待核实】临时链接是 bearer token**：拿到 URL 的任何人都可下载到过期。合法查看者已从 `getReports:98`/`getReportDetail:256` 拿到 `file_url`。**若云控制台"存储安全规则"允许客户端直接用 fileID 换临时链接（`wx.cloud.getTempFileURL`），则 chef 可绕过 `:53` 的类型限制直接下载带价格报表**——此路径无法从代码判断，需控制台配置确认。

---

## 3. 分页实现与索引专项汇总

| 函数 | 分页方式 | 排序键 | 稳定性 | 问题 |
|---|---|---|---|---|
| `getPurchaseOrders` | DB `skip/limit`（上限 1000×100） | `created_at desc` | 同毫秒同 `created_at` 的多单在翻页边界抖动 | 排序无次要键（低） |
| `getReports` | DB `skip/limit`（上限 1000×50） | `generated_at desc` | 同毫秒批量落库抖动；`count()` 与 `get()` 非原子 | 排序无次要键 + total 漂移（中低） |
| `generateSummaryReport` | 内部双分页（`count()` + `skip/limit(100)`） | **无 `orderBy`** | CloudBase 无序分页顺序不保证 → 跨页重复或漏读 | 汇总金额/数量随机偏差（中） |
| `getReportDetail` | 无分页（rows 全量） | — | — | `limit(200)` 静默截断（高） |
| `getPurchaseOrderDetail` | 无分页（单文档） | — | — | `limit(100)` receipt 无 status 过滤（低） |
| `confirmSupplierOrder` / `getReportFileUrl` | 无分页 | — | — | — |

**越界行为**：`page`/`pageSize` 全部有 `clamp` 下限 1、上限 1000/100/50，`Number(...)||默认值` 兜住 NaN 与非数字字符串，**无越界崩溃风险**。`skip` 超过总数时返回空数组 + 正确 `total`，无死循环。

**全仓无 `database/rules.json` 或任何索引脚本**（`find` 已确认），所有索引需求都是**隐含的、无法从代码验证是否已建**。最关键的是 `receipt{store_id, receipt_date}`（决定日/月汇总查询是否全表扫描）与 `purchase_order{store_id, created_by, order_status}`（决定列表页 10 次查询的性能）。

---

## 4. 报表金额汇总逻辑：口径与明细一致性

**汇总口径全景（以代码为准）**：

| 报表 | 金额是否含 `payable_flag === false` 行 | 金额是否含 `is_manual` 行 | 下单数量口径 |
|---|---|---|---|
| 门店带价格收货 / 供应商带价格账单（归档 CSV） | **不含**（`createReceipt:626/:707` 显式 `filter(payableFlag && !isManual)`） | 不含 | — |
| 门店收货 / 供应商到货（不含价，归档 CSV） | 全量行（异常只作标记） | 全量行 | `order_qty_snapshot` 单行 |
| **日/月汇总（`generateSummaryReport`）** | **含**（`:199-223` 无该过滤） | 不含（`:201` 剔除） | **按 receipt_item 逐行累加 `order_qty_snapshot`** |
| 详情页重建（`getReportDetail`） | **含**（`:118-119`/`:191-192` 仅把 `payable` 挂到行上，不过滤） | 含 | `order_qty_snapshot` |
| 供应商实时视图（`getSupplierReceipts`，不在本组） | **含**（`:54` 只 `is_manual: neq(true)`） | — | 逐行平铺 |

**三条确认不一致**：
1. **汇总下单数量成倍放大（高）**：`order_qty_snapshot` 存的是**整行订单量**（`createReceipt:500-501` 原样写 `item.orderQty`，而 `createReceipt:278-297` 的批次校验允许同一订单行分 ≥2 批收货）→ 同一商品 N 个批次各带一份完整下单量，`:218` 逐行累加 → **下单数量 = 真实下单量 × N**。`实收数量`（`received_qty` 是本批量）与金额（逐行 `received_qty × price`）口径正确，**只有"下单数量"列失真**。
2. **汇总金额含不可付款行（中）**：日/月汇总的 `total_amount` > 同日带价报表/供应商账单合计，**差额 = 质量/错货/缺价异常行金额**。若汇总被当作对账依据则对不上；若仅作运营看板，应在 UI 明示"含不可付款行"（当前无任何提示）。
3. **详情页与归档文件不同源（高）**：`getReportDetail:100-103` 的 `receipt.limit(1)` **无 orderBy** → 订单分批收货时（`createReceipt:567` 每批一份 `store_receipt_report`，共享 `source_order_id`），**取到哪张 receipt 不确定**，第 2 批及以上的报表详情页显示的是另一批的行，点导出下载到的是本批 CSV。

**时间范围口径（无 bug，明确记录）**：依据 **`receipt_date`（收货日期，裸字符串）**，**不是 `created_at`**。daily 为**精确等值**单点匹配；monthly 为 `_.gte('YYYY-MM-01').and(_.lte('YYYY-MM-31'))` **闭区间、含首含尾**，上界字符串 `'31'` 对 30 天/28 天月份大于任何合法日期 → 等价整月，字符串字典序下无歧义。`receipt_date` 为裸字符串 → **无 UTC+8 时区偏移风险**。唯一相关缺陷是 `generateSummaryReport:175-176` 不禁止未来日期，可生成必然为空的报表。

---

## 5. 最新 commit 修复的覆盖验证（供应商 vs 内部审批）

**commit `07b6461` 实际改动（2 文件 / 7 插入 / 6 删除）**：
```js
// confirmSupplierOrder:11-13
- const CONFIRMABLE_ORDER_STATUS = ['submitted', 'approved']
- const SHIPPABLE_ORDER_STATUS  = ['submitted', 'approved', 'report_generated', 'to_receive', 'partial_received']
+ const CONFIRMABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive']
+ const SHIPPABLE_ORDER_STATUS  = ['approved', 'report_generated', 'to_receive', 'partial_received']

// getSupplierOrders:11-13
- const HIDDEN_ORDER_STATUS = ['draft', 'rejected']
+ const HIDDEN_ORDER_STATUS = ['draft', 'submitted', 'pending_approval', 'rejected']
```

**逐入口覆盖矩阵**：

| 供应商可见性/操作入口 | 修复前 | 修复后 | 结论 |
|---|---|---|---|
| `getSupplierOrders`（供应商订单列表） | `submitted`/`pending_approval` 订单**可见** | `HIDDEN` 追加两态，供应商门户只看到 `approved` 及之后 | ✅ **已闭合** |
| `confirmSupplierOrder` 确认接单 | 白名单含 `submitted`（审核前可确认） | 去掉 `submitted`；条件更新按 `order_status` 原子拦截（`:78-83`） | ✅ **已闭合** |
| `confirmSupplierOrder` 标记发货 | 白名单含 `submitted` | 去掉 `submitted` | ✅ **已闭合** |
| `dataService` 供货商新订单通知 | 仅 `auditOrder` 通过后下推（`dataService:620`） | 未改 | ✅ 本已一致 |
| `getSupplierReceipts`（供应商账单实时视图） | 无 `order_status` 过滤 | 未改 | ✅ **无需**：`createReceipt:239/:417` 只允许 `['approved','report_generated','partial_received']`，收货不可能发生在审核前 |
| `getPurchaseOrders` / `getPurchaseOrderDetail` | supplier → `-403`（`:65` / `:60`） | 未改 | ✅ 本就拒绝 |
| `getReports` / `getReportDetail` / `getReportFileUrl` | supplier → `-403` | 未改 | ✅ 本就拒绝（供应商**拿不到自己的报表文件**，见下） |
| ❗`createPurchaseOrder` 供应商订货汇总 CSV | `orderStatus === 'submitted'`（**审核前**）即生成 + 上传 `supplier_order_report`（`:410-411` 只跳过 `draft`，`:440-490`） | **未改** | ❌ **未覆盖** |
| ❗`getReports` / `getReportDetail` / `getReportFileUrl` 的 `status` 过滤 | 三处均不过滤 `report_file.status` | **未改** | ❌ **未覆盖** |
| ❗`getReportDetail:130-160` 供应商订货报表重建 | 无 `order_status` 过滤 | **未改** | ❌ **未覆盖** |

**覆盖结论：修复对"供应商 App 内"的所有入口有效且闭合，但未覆盖"报表导出/线下分发"通道。**
1. **审核前的订货单 CSV 已经存在并可下载**：`createPurchaseOrder:440-490` 在提交时（`submitted`，内部审核尚未发生）就为每个供应商生成并上传 `supplier_order_report`，落 `report_file`（`status:'generated'`）。`auditOrder` 通过且改量后仅把旧版标 `superseded` 并生成 `_A` 新版（`dataService:415-416`）——**但 `getReports`（`:90-96`）、`getReportDetail`（`:62-65`）、`getReportFileUrl`（`:46-55`）三处都不过滤 `status`** → 内部人员（purchaser/super_admin/store_manager）仍可在报表中心看到并下载审核前版本，线下转发给供应商。**这与 commit 自述的"suppliers never act on quantities that audit may change or reject"直接冲突**——供应商不会在 App 里操作，但会拿到那份 CSV。
2. **被驳回的订单同样不标 superseded**：`dataService.auditOrder` 的 `rejected` 分支**不重算报表**（`:607-623` 的 `qtyChanged` 与 `status==='approved'` 两个条件均为假）→ 被驳回订单的供应商订货单 **永久保持 `status:'generated'`**，且 `:1316-1318` 的作废标记也只作用于下单类两类。这是一条独立的、比改量更彻底的泄漏路径。
3. **`getReportDetail:130-160` 的重建结果含未过审核订单**：按 `report.scope_id + related_date` 重建时**无 `order_status` 过滤**，草稿/已提交/待审批订单的行会进入供应商订货报表的详情页表格——与 `getSupplierOrders` 收紧后的 `HIDDEN` 口径不一致（虽然供应商角色打不进这个函数）。
4. **存量数据未被清理**：`regenerateApprovedOrderReports` 只在 **改量**（`qtyChanged`）时清空 `supplier_confirmations`（`dataService:406-410`）。**修复前**写入的"审核前确认"记录，若该单审核通过且**未改量**，会残留 → `deriveConfirmStatus` 对一张审核前确认的订单返回 `'confirmed'`，而那次确认针对的是可能已被审核改动的数量。**本次修复是增量有效的，不对存量生效。**
5. 附带说明：修复后 `CONFIRMABLE` 不含 `partial_received` 而 `SHIPPABLE` 含，是刻意放宽（S8：剩余批次未到前维持发货标记），自洽；白名单中的 `report_generated`/`to_receive` 是无人写入的死状态，属冗余而非缺陷。

---

## 6. 与旧报告不一致之处（以当前代码为准）

### 6.1 代码已变化（旧结论已过时）

| 旧结论 | 出处 | 当前代码 |
|---|---|---|
| **H5「`getNextVersion` 自增后回读撞号，四处逐字复制」** | R5 §7.1；03 批 | **已修复**。4 个文件（`generateSummaryReport:53-79`、`createPurchaseOrder:109-136`、`createReceipt:73-99`、`dataService:361-387`）全部改为 CAS：`where({_id, count: current}).update({count: current+1})` → `updated===1` 才算抢到，最多 5 次重试。这正是 commit `33ce694 fix(workflow): ... CAS versioning` 的成果。**版本号撞号/`report_id` 碰撞的风险已解除**（但 5 次耗尽仍抛错 → 被 `:276-279` 统一吞成 `-1`）。 |
| **`generateSummaryReport` 270 行 / `getReportDetail` 257 行** | R5 §1、§3.1、§3.3 | 实测 **280 / 261** 行，差 10 / 4 行 = CAS 重试循环 + `try/catch` 日志兜底。R5 中所有引用这两文件的行号需整体 **+10 / +4** 偏移（如 R5 记的 `:214` → 现 `:218`，`:100-105` → 现 `:100-103`）。 |
| **`getPurchaseOrderDetail` 129 行** | R5 §1 | 实测 **149** 行（P1-17 已收聚合 `:99-117` + S6 供应商名注入 `:83-97` 是后加的）。R5 记的 `:107-113` → 现 `:125-133`。 |
| **`confirmSupplierOrder:12-13` 白名单含 `submitted`** | 04 §7.3（"确认接单仍限审批前"）、04 §11 H-4/M-3 | **已收紧**（见 §5）。04 §7.3 描述的白名单与"注释与代码轻微不一致"整段已过时。 |
| **`getSupplierOrders:11 HIDDEN=['draft','rejected']`** | 04 §7.1/§3.4 | **已扩展**为 4 态。04 §3.4 "过滤掉 `draft/rejected`"已过时。 |

### 6.2 旧报告判断有误

| 旧判断 | 出处 | 实际 |
|---|---|---|
| **"2 个汇总类类型对门店角色不可达（`getReports:79-86` 强制覆盖）"** | R5 §0.1；R5 §2.3「白名单可达但门店角色读不到」 | **仅对 chef 成立**。`getReports:83-86` 对 store_manager **只覆盖 `report_scope` 与 `scope_id`，不覆盖 `report_type`**，而日/月汇总的 `report_scope === 'store'`、`scope_id = storeId`（`generateSummaryReport:251-252`）→ **store_manager 完全可达本店汇总报表**，只是前端 `report-list:47-52` 的 tab 不含汇总类、只能落在"全部"。"门店角色不可达"应改为"**chef 不可达、store_manager 可达**"。 |
| **"传空 `fileId` 会命中首条种子记录再走 `getTempFileURL([''])` 失败（语义混乱）"** | R5 §7.1（L155/§2.2 条） | **`getReportFileUrl:44` 的 `if (!fileId) return {code:-1, msg:'缺少fileId'}` 已在前置拦截**，空 `fileId` 根本到不了 `:46` 的反查。种子数据 11 条 `file_url` 全为 `""` 确实存在（`seed-data/report_file.json`），但只会让**传空串**的请求在 `:44` 终止，不会产生"命中首条种子记录"的后果。种子数据缺 `file_url` 的真实后果是：这些报表在详情页只能看重建行、无法导出（`report-detail.js:91` 的空 `fileUrl` 分支）。 |
| **R5 §3.3 "汇总类解析器是正确的 RFC 4180：行内逗号/换行处理"** | R5 §3.3 | **逗号处理正确，换行处理不成立**。`:211` 先 `text.split('\n')` 再逐行 `parseLine`，而 `csvField`（`generateSummaryReport:41-46`）**只转义 `"`、不转义字段内换行** → 商品名/供应商名/分类/备注中含换行符时，一条记录被拆成两行、字段整体错位（该行会被解析成错列的行，且 `f[0]` 不为"合计" → 直接进入 rows）。触发条件：商品名或供应商名含换行（从 `product`/`supplier` 档案带过来，`:208-211`）。 |

### 6.3 仍然成立（逐条复核）

以下旧结论在本轮**逐行重新命中、结论不变**：

- **06 R1 / R5（`order_qty_snapshot` 翻倍）** → 仍成立：`createReceipt:500-501` 原样写整行订单量，`generateSummaryReport:218` 逐行累加。
- **06 R2 / R5 证据1（带价读取侧未过滤 `payable_flag`）** → 仍成立：`getReportDetail:106-128`、`:175-200` 无过滤，仅把 `payable` 挂到行上（`:120`、`:193`）。
- **06 R3 / R5 证据2（供应商类按日重建 + `limit(200)` 截断 + 忽略 `source_order_id`）** → 仍成立：`getReportDetail:130-160`、`:161-202`；`:82` 取了 `orderId` 但两条分支从未使用。
- **R5 证据4（`superseded` 详情页与下载文件不同源）** → 仍成立且**未被最新 commit 触及**：`auditOrder` 改量后就地覆写 `purchase_order_item.order_qty`，`:86-97` 现读的是改量后的值，CSV 冻结的是改量前的值。
- **R5 证据5（异常识别不对称）** → 仍成立：`getReportDetail:18-24` 只读三个布尔位，不 join `abnormal_record`，`receipt_item` 无 `is_missing_price` 字段。
- **06 R4 / M3（汇总金额含不可付款行）** → 仍成立：`:199-223` 仅剔 `is_manual`。
- **06 R5（`skip/limit` 无 `orderBy`）** → 仍成立：`:99-108`、`:118-127`。
- **06 R6（汇总无幂等）** → 仍成立：`:192` 起不查重、无锁。
- **06 R8 / R10（店长权限前后端不一致 / 月汇总版本按日计）** → 仍成立：`generateSummaryReport:170` 含 `store_manager` 而 `report-list:127-131` 拦死；`getNextVersion(reportType, storeId, relatedDate)` 的 key 用传入日期而非月份（`:237-238`），同月不同日各从 v1 开始。
- **06 R13 / R5 §3.1（`uploadFile` → `add` 不原子、孤儿文件、版本号白烧）** → 仍成立：`:242-265`，`catch` `:276-279` 无补偿。
- **06 R19 / R5 G1（`getReportDetail`/`getReportFileUrl` 缺 `!default_store_id` 前置）** → 仍成立：`:75`、`:50`。
- **06 R20（`getReportFileUrl` 不校验 `status`）** → 仍成立：`:46-55`。
- **06 R21（chef 在 report-history 可选无权类型）** → 仍成立：`report-history.js:29-34` 从 `meta.reportTypeMap` 派生 8 种全暴露，服务端 `getReports:79-83` 强制回退导致空列表。
- **06 L1 / R5（`safePathPart` 定义未调用）** → 仍成立：`generateSummaryReport:48-50` 定义，全文 0 调用，`:241` 直拼 `storeId`。
- **04 L-22（`getPurchaseOrderDetail` 对 store_manager 不过滤供应商级报表）** → 仍成立并扩展：`:131-133` 只对 chef 按 `report_scope` 过滤。
- **04 H-4 / M-3（确认状态无单调性、无"先确认才能发货"）** → 仍成立：`confirmSupplierOrder:62`、`:73-80` 纯覆盖写。
- **04 M-4（重复发货刷重复消息）** → 仍成立：`:86-117` 无 message_id 去重。
- **04 L-5 / S-2（`confirmSupplierOrder` 明细校验不含 `is_manual`）** → 仍成立：`:65-68`。
- **04 M-1 / M-2（`to_receive` 陷阱状态、死状态在多个守卫集合中）** → 仍成立：`createReceipt:239/:417` 不含 `to_receive`；`getPurchaseOrders:74/94` 把 `report_generated` 计入"待收货"统计。
- **04 L-2（`getPurchaseOrders` 的 `role` 入参被忽略）** → 仍成立：`:43`。
- **06 R11 / 03 M5（`getReports` 死参 `role`/`storeId`）** → 仍成立：`:43`。
- **04 L-10（`getPurchaseOrderDetail` 的 receipt 查询无 status 过滤、`limit(100)`）** → 仍成立：`:120-123`。
- **04 M-13（`getSupplierOrders` 明细 `limit(1000)` 静默截断）** → 仍成立：`getSupplierOrders:72-76`。
- **04 M-12（`getSupplierOrders` `String(Date).localeCompare` 排序错乱）** → 仍成立：`getSupplierOrders:117`。
- **04 H-5 / S-1（`getSupplierOrders` 下发全部供应商的 `supplier_confirmations`）** → 仍成立：`getSupplierOrders:126-129` 的 `...order` 展开含完整 map（其他供应商的 `status/updated_at/updated_by`）。
- **06 R18（金额未格式化 / CSV 解析丢小数位）** → 仍成立：`getReportDetail:243-245` 的 `Number(f[4..6])`。
- **06 R22（`total_amount`/`item_count` 无人消费）** → 仍成立：`generateSummaryReport:262-263` 写入，`getReports:98` 整条下发但 `utils/cloud.js:212-225` 的 `normalizeReport` 未映射，`report-detail.js:54-58` 另算。
- **R5 N8（公式注入前缀 `'` 污染详情表商品名显示）** → 仍成立：`csvField:44` 前缀 `'`，`getReportDetail:239` 的 `productName: f[0]` 保留撇号。
- **06 R12（`report_file` 与云存储报表文件无任何清理机制）** → 仍成立：全仓无 `report_file.remove`；`cloud.deleteFile` 仅见 `dataService:1602`、`importProducts:94`。

---

## 7. 问题清单

严重级别：**高** = 数据错误/金额错误/静默漏数据；**中** = 口径不一致/功能不可达/边界不一致；**低** = 遗留/边界不可达/命名不统一。

| 级别 | 文件:行号 | 问题 | 触发场景 |
|---|---|---|---|
| **高** | `generateSummaryReport/index.js:218` | 汇总"下单数量"按 `receipt_item` 逐行累加 `order_qty_snapshot`，而该字段是**整行订单量**而非本批量（`createReceipt:500-501`） | 同一商品被分 ≥2 批收货（`partial_received` 流程，`createReceipt:239/:417` 显式支持）→ 下单数量 = 真实值 × 批次数；实收数量与金额仍正确，仅该列失真 |
| **高** | `getReportDetail/index.js:100-103` | 收货报表重建 `receipt.where({purchase_order_id}).limit(1)` **无 `orderBy`** | 订单分批收货（每批一份报表，共享 `source_order_id`）→ 取到哪张 receipt 不确定，点第 2 批及以上报表时详情表格显示其他批次的行，与下载的 CSV 不同源 |
| **高** | `getReportDetail/index.js:135-138`、`:166-169` | 供应商类报表重建按 `order_date`/`receipt_date` 取当日单据 `limit(200)` **无分页**，且**忽略 `report.source_order_id`**（`:82` 取值但两条分支从未使用） | 同一供应商当天在多家门店有单 → 详情页是"当日全门店全部单据"并集，CSV 只有 1 单/1 批；当日跨店单据 >200 时**静默截断** |
| **高** | `getReportDetail/index.js:130-160`（叠加最新 commit 口径） | 两条供应商类分支**无 `order_status` 过滤** → 草稿/已提交/待审批（未过内部审核）订单的行进入重建结果 | 审核前已生成 `supplier_order_report`（`createPurchaseOrder:440-490`），打开该报表详情页即含未过审核订单；与 `getSupplierOrders:11-13` 收紧后的 `HIDDEN` 口径不一致 |
| 中 | `generateSummaryReport/index.js:199-223` | 汇总金额仅剔除 `is_manual`（`:201`），**未剔除 `payable_flag === false`**（质量/错货/缺价异常行） | 门店当天有异常收货 → 汇总 `total_amount` > 同日带价报表/供应商账单合计，差额 = 不可付款行金额；无任何 UI 提示 |
| 中 | `createPurchaseOrder/index.js:440-490` ＋ `getReports:90-96` / `getReportDetail:62-65` / `getReportFileUrl:46-55` | **最新 commit 未覆盖的报表通道**：提交时（审核前）即生成供应商订货 CSV，且三处读取/下载入口**均不过滤 `report_file.status`** | 内部审核改量后旧版只标 `superseded`（`dataService:415-416`），内部人员仍可下载审核前版本并线下转发给供应商 |
| 中 | `dataService/index.js` `auditOrder` rejected 分支（`:607-623`） | **被驳回订单不重算、不标 superseded** → 供应商订货单永久保持 `status:'generated'` | 审核驳回后，该单的供应商订货 CSV 继续可下载（比改量更彻底的泄漏路径） |
| 中 | `dataService/index.js:406-410` | 确认状态只在**改量**时清空（`qtyChanged && supplier_confirmations` 非空） | 修复前写入的"审核前确认"，若该单审核通过且**未改量**，残留 → `deriveConfirmStatus` 返回 `confirmed`，而那次确认针对的可能已被审核改动的数量。**修复是增量有效的，存量不生效** |
| 中 | `getPurchaseOrders/index.js:119-124` | 明细按 20 个订单号分块查询但 `limit(1000)`；20 单 × 100 行/单上限 = 2000 > 1000 | 一页 20 单且多数为 50+ 行的大单（建单上限 100 行/单，`createPurchaseOrder:261`）→ 部分明细**静默截断**，列表卡片的 `items` 不完整 |
| 中 | `getSupplierOrders/index.js:72-76` | 明细 `limit(1000)` **静默截断**，超 1000 条后**后续订单整体不可见**（非仅明细缺） | 大供应商长期经营，累计明细超 1000 条 |
| 中 | `getSupplierOrders/index.js:117`（+`:116-119` 内存分页） | `String(new Date()).localeCompare` —— Node 下为 `"Sun Oct 04 2026 ..."` 格式，**字典序由星期缩写/月份名主导**，跨月/跨年顺序错乱；且基于错误顺序做内存 `slice` 分页 | 供应商列表跨月查看 → 顺序错乱；翻页时重复或遗漏 |
| 中 | `confirmSupplierOrder/index.js:62`、`:73-80` | 只按 `order_status` 白名单判定，**不看确认状态**；纯覆盖写、单槽 `updated_by` 被覆盖、无历史 | 直接调云函数：未确认即标记发货；`shipped` 被再次 `confirm` 回退成 `confirmed`（前端 `supplier-orders.js:98-99` 的 UI 约束可被绕过） |
| 中 | `confirmSupplierOrder/index.js:86-117` | 每次 `ship` 都 `message.add`，`message_id` 用 `Date.now()+random` 而非稳定键 | 供应商反复点"标记已发货"或网络重试 → 向门店刷 N 条重复消息 |
| 中 | `generateSummaryReport/index.js:237-238`（＋`:249`） | 月汇总的版本计数器 key 用**传入日期**而非月份，`report_id` 同样含日期 | 同一月份不同日期各生成一次月汇总 → 各自从 v1 开始，前端显示重复 v1 |
| 中 | `generateSummaryReport/index.js:192-193`、`:224-264` | 无空结果守卫 | 门店当期无收货、或全部为手动行（`:201` 剔除）→ 仍 bump 版本号、上传 3 行 CSV（合计 0.00）、落库、返回 `code:0 itemCount:0` |
| 中 | `generateSummaryReport/index.js:99-108`、`:118-127` | 两处 `skip/limit` **无 `orderBy`** | 当日 receipt >100 或单块 receipt_item >100 → CloudBase 无序分页跨页重复/漏读 → 汇总金额与数量随机偏差 |
| 中 | `getReports/index.js:90-96` | `count()` 与 `get()` 两次独立调用非原子；`orderBy('generated_at','desc')` **无次要键** | 翻页期间新增报表 → `total` 与已加载条数短暂不一致；同毫秒批量落库 → 翻页边界顺序抖动、重复或遗漏 |
| 中 | `getPurchaseOrderDetail/index.js:131-133` | 只对 chef 按 `report_scope` 过滤，**store_manager 拿到供应商级报表元数据**（含 `scope_name` 供应商名 + `file_url`） | 店长查看任一订单详情 → 看到该单关联供应商的名称与报表文件 ID |
| 中 | `getReportDetail/index.js:75-76` | 对 chef 只校验 `scope_id`，**不校验 `created_by`** → 与 `getPurchaseOrders:55` / `getPurchaseOrderDetail:64` 的"只看本店+自己创建"口径不一致 | chef 通过 `report-list`/`report-history` 打开同店其他同事订单的下单报表（含明细行） |
| 中 | `generateSummaryReport/index.js:242-265`、`:276-279` | `uploadFile` → `report_file.add` **不原子、无回滚、无补偿**（不写 `missing_reports`、不发通知、不清理孤儿文件）；`getNextVersion` 已取号在上传之前 | `report_file.add` 失败 → 云存储孤儿 CSV + 版本号白烧 + 用户只见"生成失败"；**汇总是三条报表生成链路里唯一没有补偿机制的** |
| 低 | `getReportDetail/index.js:211`、`:208-231` | 先 `text.split('\n')` 再逐行 `parseLine`，而 `csvField` **不转义字段内换行** | 商品名/供应商名/分类/备注含换行符（从 `product`/`supplier` 档案带入）→ 一条记录被拆成两行、字段整体错位 |
| 低 | `getReportDetail/index.js:237` | `if (f[0] === '合计') continue` 按首字段判断 | 商品名恰为"合计" → 该行被当作合计行跳过，静默丢一行 |
| 低 | `getPurchaseOrderDetail/index.js:85-86` | 注释声称"chef 不见供应商身份"，但 chef 的 `items` **仍带 `supplier_id` 原值**（只跳过 `supplier_name` 注入） | chef 查看订单详情 → 能看到供应商 ID（如 `SUP001`），身份边界只挡住一半 |
| 低 | `confirmSupplierOrder/index.js:65-68` | 越权校验**不含 `is_manual` 过滤**，与 `getSupplierOrders:72` 的 `is_manual: _.neq(true)`"双保险"口径不一致 | 当前不可触发（手动单强制 `supplier_id=''`，`createPurchaseOrder:252`）；未来若允许手动单指定供应商即成越权通道 |
| 低 | `getReportDetail/index.js:62-65`、`getReportFileUrl/index.js:46-55` | 均**不校验 `report.status`** → `superseded` 报表可看、可下载 | 下载已作废的旧版报表（叠加 R5 证据4 → 页面与新数字、文件与旧数字） |
| 低 | `getReportDetail/index.js:75`、`getReportFileUrl/index.js:50` | 未前置校验 `!user.default_store_id`，`scope_id !== default_store_id` 在**两侧同为假值时放行** | **当前不可达**（14 处 `report_file.add` 均显式写 `scope_id` 且经非空校验）；对照 `getReports:54/59`、`getPurchaseOrderDetail:61` 均有前置兜底 |
| 低 | `getReportFileUrl/index.js:57` | 返回体只有 `{url}`，不含 `expireTime`/`fileName`/`fileType` | 前端无从感知有效期；链接过期后 `wx.downloadFile` 失败与网络失败共用"下载失败"文案，无区分 |
| 低 | `getReports/index.js:43`、`getPurchaseOrders/index.js:43` | `role`（`getReports` 另有 `storeId`）**解构后全文 0 使用**，前端两个页面仍在传 | 无实际影响（服务端按会话 `user` 收敛，属正确设计的冗余入参）；但"契约与实现不符"，多门店授权的角色无法按门店收窄 |
| 低 | `getReports/index.js:47` | `relatedDate` **仅正则**不校验日历日（与 `generateSummaryReport:82-86` 的 `isDate` 严格度不一致） | 传 `2026-02-31` 被放行 → 返回空列表 |
| 低 | `generateSummaryReport/index.js:48-50`、`:241` | `safePathPart` **定义后全文 0 调用**，`:241` 路径直拼 `storeId` | 全局角色传任意存在门店的 id，若档案名含 `/ \ 空格` 将被解释为目录层级 |
| 低 | `getPurchaseOrders/index.js:75-76` | `orderStatus` **无白名单**，原样透传 | 传任意值 → 空列表（无安全风险，校验缺口） |
| 低 | `getPurchaseOrderDetail/index.js:120-123` | `receipt` 查询**无 status 过滤**、`limit(100)` | 长期数据积累后单订单收货单超 100 张时截断 |
| 低 | `getPurchaseOrderDetail/index.js:101-106` | `receipt_item.where({purchase_order_item_id: _.in(最多100个)}).limit(1000)` | 100 行 × 10 批 = 1000 边界，极端情况下已收聚合被截断（`received_total` 偏小、`remaining_qty` 偏大） |
| 低 | `getPurchaseOrders/index.js:92` | `toVerify` 计数对 chef/store_manager 也计算并下发（`statusCounts` 无条件算 9 项），而该筛选对非全局角色返回 403（`:71`） | 计数被下发但前端 tab 隐藏；仅数字级信息，无越权（仍受 `baseQuery` 门店/创建人约束） |
| 低 | `getSupplierOrders/index.js:126-129` | `...order` 展开把**全部供应商**的 `supplier_confirmations` map（`status/updated_at/updated_by`）下发给当前供应商 | 供应商查看自己相关的多供应商订单 → 可看到其他供应商的确认/发货状态与操作者 id（不含商品明细） |
| 低 | `getReportDetail/index.js:209` | 汇总类每次打开都 `cloud.downloadFile` 全量拉取 + 全文解析，**无缓存**、无本地缓存标记 | 反复打开同一张月汇总详情；大店月汇总叠加默认 60s 超时 |
| 低 | `getReports/index.js:98` | 无 `field()` 投影，整条 `report_file` 文档下发（含 `file_url` fileID、`total_amount`、`excluded_rows`） | 客户端可拿到 fileID；若云存储安全规则允许客户端直接换链，则绕过 `getReportFileUrl:53` 的类型限制 |
| 低 | 7 × `package.json` | 依赖 `wx-server-sdk: ~2.6.3` 波浪号浮动 + **无超时/内存配置声明** | 部署版本漂移；`generateSummaryReport` 全量拉取 + 内存聚合无显式超时保护 |
| 待核实 | `getReportFileUrl/index.js:55`（＋云控制台配置） | 临时链接是 **bearer token**：拿到 URL 的任何人可下载到过期；`file_url` 已随 `getReports:98`/`getReportDetail:256` 下发给合法查看者 | **若控制台"存储安全规则"允许客户端直接 fileID→URL**，chef 可绕过 `:53` 的类型限制下载带价格报表。无法从代码判断，需控制台实测 |
| 待核实 | 全仓（无 `database/rules.json`） | 所有隐含索引**无法确认是否已建** | `receipt{store_id,receipt_date}`、`purchase_order{store_id,created_by,order_status}`、`report_file{report_id}`/`{file_url}` 缺失会直接放大上述性能与分页稳定性问题 |

---

## 8. 遗留【待核实】（需真机/控制台）

1. **云存储安全规则**是否允许客户端直接用 fileID 换临时链接（决定 `getReportFileUrl:53` 的类型限制是否可被绕过）——本组唯一无法从代码定论的越权面。
2. **数据库索引是否已建**：全仓无 `rules.json`/索引脚本，7 个函数共约 20 个隐含索引全部待确认；`getPurchaseOrders` 单次请求 10+ 次查询与 `generateSummaryReport` 的 `count()` 首查对索引依赖最重。
3. **`getTempFileURL` 实际有效期**（平台默认约 2 小时）与是否需要前端按过期时间提前刷新。
4. **月汇总/日汇总的产品定位**（对账依据 vs 运营看板）：决定 06 R4 的 `payable_flag` 口径是必须对齐还是 UI 明示即可。
5. **供应商是否应该拿到自己的对账单 CSV**：当前报表域对 `supplier` 角色完全关闭（`getReports`/`getReportDetail`/`getReportFileUrl` 三处均 `-403`），账单数据只在 `supplier-receipts` 实时页面可见——这是产品分层选择，但**报表域里没有可供供应商下载的对账单**，值得业务确认。

---

## 附：本轮工作量

全读 7 个 `index.js`（1129 行）+ 7 个 `package.json` + 供应商可见性交叉核对 2 个文件（`getSupplierOrders` 137 行、`getSupplierReceipts` 119 行）+ 生成侧交叉核对 3 个文件片段（`createPurchaseOrder`、`createReceipt`、`dataService`）+ 前端消费方 3 页（`report-list`/`report-history`/`purchase-list`）+ 4 份参考旧文档共 2181 行。问题清单 40 条：**高 4 条、中 16 条、低 18 条、待核实 2 条**；旧结论复核 37 条中 **代码已变化 5 条、旧报告判断有误 3 条、仍然成立 29 条**。
