# 深度探索 04 — 采购单生命周期域

> 探索日期：2026-10-04 ｜ 分支：backup ｜ 探索代理：04（采购单生命周期域）
>
> 逐行完整读完的文件：
> - 云函数（index.js 全文 + package.json）：`createPurchaseOrder`(502)、`getPurchaseOrders`(148)、`getPurchaseOrderDetail`(149)、`getSupplierOrders`(136)、`confirmSupplierOrder`(124)
> - 前端 4 件套（.js/.json/.wxml/.wxss）：`purchase-create`(435/2/147/164)、`purchase-detail`(401/2/140/152)、`purchase-list`(154/3/46/122)、`approval-detail`(113/2/70/80)、`approval-list`(105/3/36/70)、`supplier-orders`(131/5/49/70)
> - 契约参考：`seed-data/purchase_order.json`、`seed-data/purchase_order_item.json`、`seed-data/message.json`
> - 为闭环状态机另读（未改动）：`createReceipt/index.js`(220-580)、`dataService/index.js`(296-425, 470-640, 1330-1520)、`updateProductPrice/index.js`(1-139)、`utils/cloud.js`(110-215)、`utils/meta.js`(1-42)、`修复计划-2026-10-03.md`(索引项)
>
> 未读取任何源文件之外内容，未修改任何源文件。

---

## 1. 概览

采购单是本项目的核心业务链路，集合为 `purchase_order`（主表）+ `purchase_order_item`（明细），围绕它的还有 `receipt` / `receipt_item`（收货）、`report_file`（报表）、`message`（站内信）、`abnormal_record`（异常台账）、`supplier_product_price`（协议价）。

**本域最核心的三个结论（详见后续章节）：**

1. **`purchase_order` 没有 `version` 字段，没有乐观锁 CAS。** 历史提交里的 "CAS versioning" 只落在 `report_version_counter` 这一张报表版本计数器表上（`createPurchaseOrder/index.js:77-100`）。订单主表的状态流转靠"事务内重新读一次 + 条件 update"实现，而**创建/编辑草稿这条路径完全没有条件更新**——这是并发双写风险的最大来源。
2. **采购单域完全没有金额。** `purchase_order_item` 的落库字段是 `item_id / purchase_order_id / product_id / product_name_snapshot / category_snapshot / unit_snapshot / supplier_id / order_qty / is_manual / remark / created_at`（`createPurchaseOrder/index.js:352-366`），**没有单价、没有行金额、没有税额、没有合计**。价格快照只发生在收货环节（`createReceipt/index.js:344-374`），采购单报表因此不含任何金额。
3. **状态机存在 4 个"死状态"**：`pending_approval`、`report_generated`、`to_receive`、`completed` 在整个代码库里**只有读取方、没有写入方**。其中 `to_receive` 是陷阱状态——它既不在 `createReceipt` 的可收货集合里，也不在 `cancelOrder` 的可作废集合里，一旦落入就既收不了货也作不了废。

---

## 2. 状态机全图

### 2.1 状态枚举（以代码为准）

**有写入方的状态（真实可达）：**

| 状态 | 唯一写入方 | 写入点 |
|---|---|---|
| `draft` | createPurchaseOrder | `createPurchaseOrder/index.js:291` |
| `submitted` | createPurchaseOrder | `:291` |
| `approved` / `rejected` | dataService.auditOrder | `dataService/index.js:564` |
| `partial_received` / `received` / `receipt_abnormal` | createReceipt | `createReceipt/index.js:551-554` |
| `cancelled` | dataService.cancelOrder | `dataService/index.js:1382` |

**只有读取方、没有写入方的状态（死状态）：**

| 状态 | 读取方 | 影响 |
|---|---|---|
| `pending_approval` | `dataService:504/543`（可审核）、`authService:642`（在途）、`updateProductPrice:43`（在途）、`approval-list.js:36`（列表筛选）、`meta.js:4` | 遗留兼容，无害（auditOrder 允许审核它，但没人能产生它） |
| `report_generated` | `createReceipt:235/413`（可收货）、`dataService:1356/1377`（可作废）、`getPurchaseOrders:74/94`（待收货统计）、`confirmSupplierOrder:13`（可发货） | 死状态；`getPurchaseOrders` 的 `receivable` 统计把它计入 `_.in([...])` 属无效分支 |
| **`to_receive`** | `confirmSupplierOrder:13`（可发货）、`authService:642`、`updateProductPrice:43`、`purchase-detail.js:92`（注释） | **陷阱状态**：`createReceipt:235/413` 拒绝收货、`dataService:1356/1377` 拒绝作废 → 永久卡死 |
| `completed` | `getSupplierOrders:14`（视为 done）、`purchase-detail.js:39`（isDone）、`meta.js:11` | 死状态；`receipt_status='completed'` 是 `receipt` 表的字段（`createReceipt:478`），不是订单状态 |

### 2.2 主状态迁移图（ASCII）

```
                        采购员/店长/厨师/超管
                        createPurchaseOrder(orderStatus)
                     ┌──────────────────────┴──────────────────────┐
                     │                                             │
                     ▼                                             ▼
                 ┌───────┐                                ┌──────────────┐
                 │ draft │ ──编辑保存──┐                  │  submitted   │◄──┐
                 └───────┘            │                  └──────┬───────┘   │
                     │               │                          │          │
        createPurchaseOrder        └──(draft→draft)      dataService      │
        (orderId, 'submitted')                     auditOrder           │
                     │                        ┌──────┴──────┐         │
                     └────────────────────────┤             │         │
                                              ▼             ▼         │
                                     ┌─────────────┐ ┌──────────┐    │
                                     │  approved   │ │ rejected │    │
                                     └──────┬──────┘ └──────────┘    │
                                            │                         │
        ┌───────────────────────────────────┼─────────────────┐      │
        │       createReceipt（分批收货）    │                 │      │
        │   本批未收齐 → partial_received   │                 │      │
        │   收齐无异常 → received           │                 │      │
        │   收齐有异常 → receipt_abnormal   │                 │      │
        ▼                                   ▼                 ▼      │
 ┌────────────────┐                ┌───────────┐   ┌────────────────┐  │
 │partial_received│──继续分批──┐    │ received  │   │receipt_abnormal│  │
 └───────┬────────┘          │    └───────────┘   └───────┬────────┘  │
         │                   │         ▲                   │          │
         │                   └─────────┘        允许补收   │          │
         │              （createReceipt:408 只拦 received） │          │
         │                                                 │          │
         └──────────► partial_received / received /         │          │
                       receipt_abnormal（最终批）───────────┘          │
                                                                       │
  dataService.cancelOrder 可作废集合 = {submitted, approved,           │
  report_generated}；已在 {partial_received, received,                │
  receipt_abnormal} 中则拒绝（走异常流程）────────────────────────────┘
                              │
                              ▼
                       ┌───────────┐
                       │ cancelled │  ← 清 supplier_confirmations={}(1385)、
                       └───────────┘     手动单重置 verify_status='none'(1392)
```

### 2.3 迁移明细表

| # | 迁移 | 触发者（云函数 / action） | 允许角色 | 关键守卫 | 副作用 |
|---|---|---|---|---|---|
| T1 | ∅ → draft | `createPurchaseOrder` orderStatus='draft' | chef / store_manager / super_admin / purchaser（`:107`） | 门店归属（`:174-180`）、100 行上限（`:223`）、手动单 5 个上限（`:272`）、手动/档案禁混单（`:276`） | 仅主表+明细，**无报表、无消息**（`:371-373`） |
| T2 | ∅ → submitted | 同上 orderStatus='submitted' | 同 T1 | 同 T1 | + 提交消息（`:375`）+ 门店下单报表（`:380-399`）+ 每供应商订货汇总（`:425-449`） |
| T3 | draft → draft | `createPurchaseOrder` 带 orderId | 创建者或本店店长（`:195-201`）；全局角色 | 原单必须仍是 draft（`:189`） | 删旧明细+写新明细（`:317-324`） |
| T4 | draft → submitted | 同上 orderStatus='submitted' | 同 T3 | 同 T3 | T2 的全部副作用 |
| T5 | submitted → approved | `dataService` action=auditOrder status=approved | 管理角色（`dataService:488` MANAGEMENT_ROLES），**禁止自审**（`:501`） | 状态白名单（`:504`）；审批数量 0<q≤order_qty（`:529-531`）；事务内复查（`:538-546`） | 明细写 `original_order_qty`/`order_qty`/`approved_qty`（`:549-558`）；主表写 `audit_remark`/`audited_by`/`audited_at`（`:562-570`）；改量则重算报表+**清空全部供应商确认**（`:608-610`, `:405-417`）；批准则推送供应商站内信+订阅消息（`:617-623`, `:296-346`） |
| T6 | submitted → rejected | 同上 status=rejected | 同 T5 | 驳回原因必填（`:507`） | 主表写 `audit_remark`/`audited_by`/`audited_at`；发"采购申请已驳回"消息（`:589-599`）。**不重算报表、不通知供应商** |
| T7 | pending_approval → approved/rejected | 同 T5/T6 | 同 T5 | 同 | 无（该状态无写入方，遗留兼容） |
| T8 | approved → partial_received | `createReceipt` | 非 chef，且订单门店=当前门店（`createReceipt:235-240`） | 事务内复查状态（`:406-417`）；事务内重算超收（`:419-443`） | 写 `receipt`+`receipt_item`+异常台账（`:470-547`）；写消息（`:564-578`）；生成 4 类收货报表（`:613-730`） |
| T9 | approved → received | 同 T8（本批即收齐、无异常） | 同 T8 | 同上 | 同上；**`received` 为终态**（`:408` 拦截后续收货） |
| T10 | approved → receipt_abnormal | 同 T8（收齐但有异常） | 同 T8 | 同上 | 同上；**允许继续补收**（`:407` 注释、`:408` 只拦 received） |
| T11 | partial_received → partial_received | 同 T8（继续分批） | 同 T8 | 同上 | 同上 |
| T12 | partial_received → received / receipt_abnormal | 同 T8（最终批） | 同 T8 | `txIsFinalBatch` 事务内重算（`:449-452`） | 同上 |
| T13 | receipt_abnormal → * | 同 T8（补收） | 同 T8 | 同上 | 同上 |
| T14 | {submitted, approved, report_generated} → cancelled | `dataService` action=cancelOrder | **GLOBAL_ROLES**（`:1339`） | 原因必填（`:1342`）；已有收货记录则拒绝（`:1353`）；事务内复查（`:1364-1380`） | `supplier_confirmations={}`（`:1385`）、`cancel_reason`/`cancelled_by`/`cancelled_at`、报表标记 superseded（`:1397+`）、手动单重置核销（`:1391-1395`） |
| T15 | *（不迁移）→ 仅置位 | `dataService` action=requestCancel | GLOBAL_ROLES（`:1431`） | `cancel_requested != true` 条件更新（`:1452-1465`） | **不改 order_status**，仅写 `cancel_requested/cancel_requested_by/cancel_request_reason/cancel_requested_at` + 通知消息（`:1467-1473`） |
| T16 | rejected → 无出口 | — | — | — | 只能前端 `copyToDraft` 新建一张草稿（`purchase-detail.js:320-354`），原单永久保留 |

**注意 T15 的语义断裂**：`requestCancel` 只置位 `cancel_requested`，但**代码库里没有任何 action 消费这个标记**（`grep cancel_requested` 仅见写入点 `dataService:1453`、读取点 `dataService:1463` 与前端展示 `purchase-detail.js:85`）。即"申请取消"提交后**没有管理员审批入口**，订单不会自动进入作废流程——需要管理员手动点"管理员作废"（`purchase-detail.wxml:124-125`）。这是一个功能闭环缺口。

### 2.4 供应商确认子状态机（`purchase_order.supplier_confirmations[supplier_id]`）

```
                    confirmSupplierOrder action=confirm
                    （order_status ∈ submitted, approved :12）
  (默认 pending) ──────────────────────────────► confirmed ─────ship──────► shipped
        │                                                    │
        └────────────────────ship───────────────────────────┘
                    （order_status ∈ submitted, approved, report_generated, to_receive, partial_received :13）

  回退路径（无单调保护）：shipped ──action=confirm──► confirmed        ← 风险 M-4
  整体清空：cancelled 时 supplier_confirmations={}（dataService:1385）
            审核改量时 supplier_confirmations=_.set({})（dataService:408）
```

`deriveConfirmStatus`（`getSupplierOrders/index.js:49-55`）只用于展示，派生值为 `pending/confirmed/shipped/done/cancelled`，不落库。

### 2.5 核销子状态机（`purchase_order.verify_status`，仅手动商品专用单）

初值：手动单 `'none'`，普通单 `''`（`createPurchaseOrder:297`）。

```
   ''(普通单)  ── 永不迁移，无意义值
   'none' ──verifyManualOrder submit──► 'pending' ──approve──► 'approved'（回填 verify_amount，闭环）
                          ▲                    │
                          └────reject── 'rejected' ┘
   cancelled 时：is_manual 且 verify_status≠'none' → 重置 'none' + 写 verify_cancel_note（dataService:1391-1395）
```

筛选口径：`getPurchaseOrders` 的 `orderStatus='to_verify'` 虚拟筛选映射到 `verify_status='pending'`（`getPurchaseOrders:70-72`）。

---

## 3. 五个云函数逐一分析

### 3.1 createPurchaseOrder（502 行）

**职责**：创建采购单 / 编辑草稿 / 提交审核 + 事务外自动生成 2 类报表 + 提交消息。

**角色门禁**（`:105-109`）：`chef / store_manager / super_admin / purchaser`。`isGlobal = super_admin | purchaser`（`:173`）。非全局角色强制 `storeId = user.default_store_id` 且校验门店有效（`:174-180`）。

**关键实现细节：**

- **订单号生成**（`:281-284`）：`'PO' + dateStr + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')`。注释说明旧版"毫秒低 4 位"周期仅 10 秒、无唯一索引兜底会静默产生同号双单。
- **商品规范化**（`:225-268`）：后端不信任客户端快照——档案商品的 `product_name/unit/default_supplier_id` 一律从 `product` 表重读覆盖；客户端传来的 `productName/category/unit/supplierId` 只作为展示数据。手动商品强制 `supplierId:''`。
- **补录打标**（`:124-128`）：`actualDate < today`（UTC+8）→ `backfilled=true`。
- **草稿权限（#18 拍板）**（`:192-201`）：本店店长可代改/代提交本店任何人的草稿（含离职员工遗留草稿），但 `created_by` 保留原创建人（`:304-309`）。
- **混单拦截（S9 拍板）**（`:275-278`）：手动商品与档案商品不可混单，后端兜底。
- **事务边界**（`:315-368`）：主表 + 全部明细在同一 `runTransaction` 内提交（见 §4.1）。
- **报表在事务外**（`:375-455`）：失败则走 catch 分支打 `missing_reports=true` + 给超管发 abnormal 消息（`:460-493`）。

**忽略的入参**：`event.createdBy`（`:116` 解构后**全文未使用**，`:304-309` 一律取会话用户）；`event.createdByName`（`:117`）**仅**用于报表 CSV 的"经办人"列（`:383`）。

### 3.2 getPurchaseOrders（148 行）

**职责**：采购单列表（分页 + 状态 tab 计数）。

- **角色过滤**（`:50-66`）：chef → 本店+本人创建；store_manager → 本店全部；全局 → 可选门店/创建人筛选；其他角色 403。
- **虚拟状态**（`:68-77`）：`to_verify` → `verify_status='pending'`（仅全局角色，`:71`）；`receivable` → `order_status ∈ [approved, report_generated, partial_received]`。
- **`statusCounts` 独立统计**（`:80-106`）：9 个 `count()` 走 `Promise.all`，基于剥离了状态条件的 `baseQuery`，不受当前 tab 影响。
- **明细批量挂载**（`:116-129`）：按 20 个订单号分块 `_.in` 查询，避免 N+1。
- **`role` 入参完全被忽略**（`:43` 解构后未使用，一律用会话 `user.role`）——这是防越权设计的正确做法，但前端 `purchase-list.js:62`、`approval-list.js:23` 仍在传。

### 3.3 getPurchaseOrderDetail（149 行）

**职责**：单张采购单详情（主表 + 明细 + 收货记录 + 报表元数据）。

- **权限门禁**（`:58-67`）：全局角色放行；`chef` 必须看本店**且自己创建**的单（`:64`）；`store_manager` 必须看本店；其他角色（含 supplier）403。
- **厨师信息边界**（`:83-97`）：chef 不下发供应商名称（不查 `supplier` 表、不注入 `supplier_name`）；`:125-133` 进一步只给 chef 看 `report_scope==='store'` 的报表（供应商级报表元数据含供应商名称）。
- **P1-17 聚合**（`:99-117`）：一次 `receipt_item` 聚合出 `received_total` / `remaining_qty`，避免 N+1。
- **无 status 过滤的 receipt 查询**（`:120-123`）：按 `purchase_order_id` 查全部收货单（含已作废后的），`limit(100)`。
- **明细 `limit(1000)`**（`:78-81`）：配合建单 100 行上限，实际不可达截断。

### 3.4 getSupplierOrders（136 行）

**职责**：供应商视角订单列表。

- **门禁**（`:59-63`）：仅 `role==='supplier'` 且必须有 `default_supplier_id`。
- **隔离主逻辑**（`:69-100`）：先按 `supplier_id` + `is_manual != true` 查该供应商的全部明细（`:71-75`）→ 得到订单号集合 → 批量取主表 → 过滤掉 `draft/rejected`（`:99`）。
- **只嵌入自己的明细**（`:120-129`）：`itemsByOrder` 只由 `myItems` 构建，防止泄漏同单其他供应商的商品。
- **内存分页**（`:115-118`）：先全量取出再 `slice`。

### 3.5 confirmSupplierOrder（124 行）

**职责**：供应商确认接单 / 标记发货。

- **门禁**（`:52-56`）：仅 supplier + 必须有 `default_supplier_id`。
- **越权校验**（`:64-69`）：该订单必须真的含本供应商的商品明细，否则 403。
- **条件更新实现原子"检查+写入"**（`:71-83`）：`where({purchase_order_id, order_status: _.in(allowedStatus)}).update(...)`，`updated===0` 则报"订单不存在或当前状态不可操作"。
- **发货通知**（`:85-117`）：向订单所属门店写站内消息（`recipient_user_id:''` + `store_id`），`scope_type:''/scope_id:''`。

---

## 4. 事务 / 幂等 / CAS 实现细节

### 4.1 createPurchaseOrder 的事务边界

```
runTransaction(async transaction => {
  if (existingOrder) {                       // 编辑草稿分支
    update purchase_order（无状态条件）       // :317
    get 旧明细 limit(1000)                    // :318-321
    逐条 remove                              // :322-324
  } else {                                    // 新建分支
    事务内复查幂等键 (request_id, created_by) // :326-338  ← 仅新建分支有
    add purchase_order                       // :339-347
  }
  逐条 add purchase_order_item               // :350-367
})
persistedOrderNo = orderNo                   // :369 ← 事务提交后
─── 事务外 ──────────────────────────────
createSubmissionMessage                      // :375（内部 try/catch，永不抛）
getStoreVer + 上传 CSV + add report_file     // :380-399
每供应商：getSupplierVer + 上传 + add         // :425-449
```

**事务内写入：purchase_order + purchase_order_item。事务外：message + report_file。** 因此部分失败的后果是确定的：

| 失败点 | 结果 |
|---|---|
| 事务内任一写入失败 | 主表与明细整体回滚，无残留（正确） |
| 事务提交成功、消息写入失败 | 无影响——`createSubmissionMessage` 内部 try/catch（`:56-72`），永不阻断 |
| 事务提交成功、报表生成失败 | catch 分支（`:460-493`）：返回 `code:0` + `reportWarning`，并尽力写 `missing_reports=true` + 给超管发消息；管理员可经 `dataService.regenerateOrderReports` 补生成（`:462-463` 注释） |
| 事务提交成功、进程在写 `missing_reports` 前被杀 | **订单永久缺报表且无标记**——见风险 M-10 |

### 4.2 幂等实现（idempotency hardening）

**键格式**：`request_id`。前端构造（`purchase-create.js:335`）：`this.requestId + ':' + orderStatus + reqSuffix`，拆单时档案单 `:c`（追加采购 `:c2/:c3`）、手动单 `:m`（`purchase-create.js:367-385`, `:403-412`）。子键设计目的：防"存草稿超时后改点提交"命中草稿的幂等记录被静默吞掉。

**后端两层防御：**

1. **事务外预查**（`:143-163`）：按 `(request_id, created_by)` 取最近一条；命中且状态不一致则报错（`:157-159`，例例外：命中的正是本次要编辑的草稿）；命中且一致则直接返回原单号（`:170-172`），带 `idempotent:true`。
2. **事务内复查**（`:326-338`）：收窄并发双击窗口——事务内再查一次，命中则 `transaction.rollback({code:-1, msg:...})`，回滚信息由 catch 透传给前端（`:496-499`）。

**请求重复提交会发生什么：**

| 场景 | 结果 |
|---|---|
| 同 requestId、同操作类型、事务外已查到 | 直接返回原单号，不重复建单（`:170-172`） |
| 同 requestId、同类型、并发双击 | 事务内复查命中，一方回滚并报"检测到重复建单"（`:333-336`, `:497-498`） |
| 同 requestId、不同操作类型（存草稿→提交） | 报错"与本次操作类型不一致"（`:157-159`）——因为前端键中已拼入 orderStatus，此场景实际不会命中 |
| 编辑同一草稿、同 requestId | 走编辑流程（`:157` 例外），变更不被幂等短路 |
| **不同 requestId 提交同一草稿** | **无任何拦截**——见风险 H-1 |
| 前端未传 requestId | 幂等完全失效（`:146` `if (trimmedRequestId)`） |

**关键缺口**：注释自认"check-then-act 仍非严格原子，终极防线是 `(request_id, created_by)` 唯一索引，见修复计划 B6-2"（`:327`）。而 `修复计划-2026-10-03.md:103` 与 `:157` 把该索引列为 B6 批次的待办项——**索引至今未建**。

### 4.3 CAS 与"version"字段的真相

- **`purchase_order` 与 `purchase_order_item` 都没有 `version` 字段。** 全库 `grep version` 只命中 `report_version_counter` 与 `report_file.file_version`。
- **CAS 只用于报表版本号**（`createPurchaseOrder/index.js:77-100`）：`counterId = "${reportType}_${scopeId}_${relatedDate}"`，读旧值 → `where({_id, count: current}).update({count: current+1})` → `updated===1` 才算抢到，最多 5 次重试。这是"读旧值 + 条件更新 + 判 updated"的标准 CAS 写法，正确。
- **订单主表状态流转用的是两种弱化形式**：
  - 条件更新（等价于"以 order_status 为乐观锁"）：`confirmSupplierOrder:79`、`dataService:1453`（cancel_requested）、`dataService:1582`（verify_status）；
  - 事务内重新读取 + 状态白名单校验 + 手动 `rollback`：`dataService:538-546`（审核）、`:1364-1380`（作废）、`createReceipt:406-417`（收货）。
- **`createPurchaseOrder` 自己的写入路径两者都没有**——`:317` 是无条件 `doc(_id).update()`，`:318-324` 的删明细也不带任何条件。

---

## 5. 金额与精度

### 5.1 采购单域：完全没有金额

`purchase_order_item` 落库字段（`createPurchaseOrder:352-366`）与 `seed-data/purchase_order_item.json`（9 条样例）**均无** `unit_price / amount / tax / total` 字段。`purchase_order` 主表同样无合计字段。

因此：
- **行金额、合计、税额：全链路都不存在于采购单环节**（前端 purchase-create 页面连金额展示都没有，只有 `totalCount` 商品种类数，`purchase-create.js:215-220`）。
- **门店下单报表与供应商订货汇总报表均不含金额**（`createPurchaseOrder:384-387` 只报商品/分类/单位/数量/备注；`:431-435` 只报门店/商品/数量/单位/备注）。
- 这**是明确的设计决策而非遗漏**：`dataService:303` 注释写明"下单明细无价格字段（价格快照在收货时才生成），摘要只报项数不报金额"；`updateProductPrice:40-43` 注释写明"结算仍取收货日现价（不锁价）"。

### 5.2 金额的实际产生点：收货环节

价格快照在 `createReceipt` 中生成（`:344-374`）：
- 来源：`supplier_product_price` 表，按 `product_id` 分块查询；
- **取价规则（P1-11）**：取 `effective_date <= 收货日` 的价格行中最新一档，**不看 `is_current` 标志**（`:353-356` 注释：补录历史日期时 `is_current` 指向今天的价，会把历史单据快照写错）；同日多行时优先 `is_current`；收货日之前无任何价格行 → 视为缺价；
- 缺价处理（#11 拍板）：不再静默漏账，标记 `missing_price` 并生成 `abnormal_record`（`:389-391`），补价后可走 `repriceReceipt` 补出账单；
- 手动商品**跳过**协议价查询（`:348-349`），`payableFlag=false`，金额走凭证核销回填（订单 `verify_amount`）；
- 付款资格完全由服务端裁决：`payableFlag = !hardAbnormal && priceSnapshot > 0`（`:386-388`），不信任客户端。

### 5.3 供应商改价对在途单的影响

`updateProductPrice`（1-139 行）**不锁定在途订单价格**：调价只把新行 `is_current=1`、旧行置 0（`:106-131` 事务），并对"含此供应商+商品的在途订单数"做波及面统计（`INFLIGHT_ORDER_STATUS:43`），支持 `dryRun=true` 只校验不落库（`:97-101`）。

**结论**：改价 → 在途订单按**收货日**重取新价 → 供应商与门店的结算金额会因改价而变化，双方均无锁定。这是 #10 拍板的显式决策，但对账风险需业务侧知晓。

### 5.4 四舍五入与尾差

统一采用"分位取整 + 累积取整"模式，无尾差调整行：

```js
const sub = Math.round(qty * price * 100) / 100          // 行小计：四舍五入到分
total = Math.round((total + sub) * 100) / 100            // 合计：逐行累积后再取整
csv += [..., csvField(sub.toFixed(2))]                   // 展示：toFixed(2)
csv += [csvField('合计'), ..., csvField(total.toFixed(2))]
```

见 `createReceipt:634-638`（门店带价收货报表）、`:717-721`（供应商带价账单）、`dataService:1010-1014 / 1239-1243 / 1299-1303`、`generateSummaryReport:214-221`、`getReportDetail:119/192`、`getSupplierReceipts:109`。

- 行小计先四舍五入到分再累加，合计再取一次整 → **合计 = 各行的四舍五入值之和**，不会出现"逐行原值相加再取整"与"取整后相加"不一致的问题，口径自洽。
- **没有独立的尾差/差异调整行**（无 `差异` 行），若供应商按未取整原值开票，会出现分位级差异。低严重度。
- `generateSummaryReport:214-215` 对数量用 `* 1000 / 1000`（3 位小数）聚合，与金额 2 位小数不同——为支持小单位计量。

---

## 6. 审批流

### 6.1 approval-list / approval-detail 对应的数据

**没有独立的 approval 集合。** 审批数据就是 `purchase_order` 主表本身 + 明细：

| 概念 | 落点 |
|---|---|
| 待审批列表 | `getPurchaseOrders` 返回列表中 `order_status ∈ {submitted, pending_approval}` 的前端过滤结果（`approval-list.js:35-37`） |
| 审批结论 | `purchase_order.order_status` → `approved`/`rejected` |
| 审批意见 | `purchase_order.audit_remark`（`dataService:565`） |
| 审批人 | `purchase_order.audited_by`（姓名，非 id）+ `audited_at`（`:566-567`） |
| 审批改量 | `purchase_order_item.approved_qty` / `order_qty`（改后）/ `original_order_qty`（首次改量前的原始量留档，`:554` 注释等式4） |
| 催办 | `purchase_order.audit_reminded_at`（限频 1 小时，`dataService:1497-1502`） |

**即：审批不是"独立集合 + message"，而是"主表字段 + 明细字段 + 一条 message"。** message 只是通知，不是审批记录——审批事实以主表字段为准。

### 6.2 审批通过 / 驳回的副作用

**通过（`dataService.auditOrder status='approved'`）：**
1. 事务内：明细改量（写 `original_order_qty`/`order_qty`/`approved_qty`，`:547-561`）+ 主表状态/意见/审批人（`:562-570`）；
2. 事务后复查状态（`:577-586`）——若已被并发作废则跳过后续动作并返回警告；
3. 写"采购申请已通过"消息（`:588-599`，写失败降级为日志，`:597` P2-16）；
4. 若改量 → `regenerateApprovedOrderReports`：把旧报表标 `superseded`（`:419-421`）→ 按批准数量重算门店下单报表+供应商订货汇总 → **清空全部供应商确认状态**并通知经办人线下重新通知供应商（`:405-417`, S2 拍板）；
5. `notifySuppliersNewOrder`（`:296-346`）：给每个供应商写 `scope_type='supplier'` 的站内信（必写）+ 微信订阅消息（尽力推送）。

**驳回（`status='rejected'`）：**
1. 事务内同 1（但 `event.items=[]`，不改量）；
2. 写"采购申请已驳回"消息；
3. **不重算报表、不通知供应商**（`:601-623` 的 `qtyChanged` 与 `event.status==='approved'` 两个条件均为 false）；
4. 驳回原因必填（`:507`，前端 `approval-list.js:95-98` 同样校验）。

### 6.3 审批的并发与自审防护

- **禁止自单自审**（`dataService:498-503`）：`created_by` 与审批人 id（兼容 `user_id`/`_id` 双值）相等则拒绝。
- **事务内复查防重复审核**（`:536-546`）：两个管理员同时点"通过"，一方事务内复查到状态已变则 rollback，回滚消息由 `.catch` 透传（`:571-575`）。
- **注意**：这里的"复查"是**读**（`transaction.collection().where().get()`），随后是**无条件** `doc(order._id).update()`（`:562`）——仍非严格 CAS，但事务隔离使第二个事务要么读到新值、要么整体重试，实践上可接受。

### 6.4 approval-list 与 approval-detail 的分歧

| | approval-list | approval-detail |
|---|---|---|
| 能否改审批数量 | 否，固定 `items: []`（`approval-list.js:77, 98`） | 能，`approveQty` 可编辑（`approval-detail.js:50-54`） |
| 数据范围 | `pageSize:100`，无分页（`approval-list.js:22-27`） | 单张 |
| 状态闸门 | 有（只渲染 submitted/pending_approval，`:36`） | **无**（`approval-detail.js:22-47` 只按 orderId 加载） |

approval-detail 无状态闸门的具体后果：已审核/已驳回/已作废的单，页面仍显示硬编码的"待审核"标签（`approval-detail.wxml:17`）和"通过/驳回"按钮，用户点击后才被后端 `dataService:504-506` 拒绝。**功能可用但体验误导**——尤其是管理员审核完一个单后返回列表再点进同一单（列表已刷新过滤掉，但直接跳转/分享链接仍可达）。

---

## 7. 供应商侧隔离与越权

### 7.1 隔离设计（正确部分）

- `getSupplierOrders` 以 `user.default_supplier_id` 为唯一锚点，先查明细再反推订单（`:62-87`），**供应商 A 无法通过遍历订单号看到供应商 B 的商品明细**——`itemsByOrder` 只由 `myItems` 构建（`:120-129`）。
- `confirmSupplierOrder` 用明细存在性校验越权（`:64-69`）：订单不含本供应商商品则 403。
- 草稿/已驳回对供应商不可见（`HIDDEN_ORDER_STATUS:11`, `:99`）。
- 供应商消息按 `scope_type='supplier' + scope_id` 定向过滤（`dataService:651-653`）。
- chef 信息边界（厨师不见供应商身份）：`getPurchaseOrderDetail:86-97` 不下发供应商名、`:131-133` 过滤供应商级报表。

### 7.2 隔离缺口

| # | 缺口 | 证据 | 严重度 |
|---|---|---|---|
| S-1 | **`...order` 展开把全部供应商的确认状态下发**：`getSupplierOrders:127` 的 `...order` 包含完整 `supplier_confirmations` map（所有供应商的 status/updated_at/updated_by） | `getSupplierOrders:126-129` | **中**——供应商 B 可看到供应商 A 在同一订单上的"已确认/已发货"状态与操作者 id（不含商品明细，故非核心数据，但属越权信息） |
| S-2 | **`confirmSupplierOrder` 的明细校验不含 `is_manual` 过滤**，与 `getSupplierOrders:71` 的"清单 #24 双保险"不一致 | `confirmSupplierOrder:65-68` | **低**——当前手动单强制 `supplier_id=''`（`createPurchaseOrder:252`），无实际可命中路径；但两个函数口径不一致，未来若手动单允许指定供应商即成越权通道 |
| S-3 | `getSupplierOrders` 把 `created_by`（内部用户 id）、`created_by_name`、`remark` 等内部字段随 `...order` 一并下发 | `getSupplierOrders:126-129` | 低 |
| S-4 | `order_date` 之外的过滤参数（如 `orderDate`）前端 `supplier-orders` 完全未传（`:68-72` 只传 confirmStatus/page/pageSize），后端支持但无人用 | `getSupplierOrders:65`, `supplier-orders.js:68-72` | 低（功能缺失，非漏洞） |
| S-5 | `markMessageRead` 只校验 `recipient_user_id` 与 `store_id`，**不校验 `scope_type/scope_id`** → 供应商账号可把 `store_id` 为空的门店消息标记为已读 | `dataService:671-691` vs `:651-653` | 低（仅已读状态，不能读内容——供应商列表查询仍被 `scope_type` 拦住） |

### 7.3 确认/发货语义

- `action='confirm'` → `supplier_confirmations[sid].status='confirmed'`，允许订单状态 `['submitted','approved']`（`:12`）。注释说明"确认接单仍限审批前"，但白名单含 `approved`（审批后仍可确认）——注释与代码轻微不一致，属放宽。
- `action='ship'` → `status='shipped'`，允许 `['submitted','approved','report_generated','to_receive','partial_received']`（`:13`）。
- **后端不校验"先确认才能发货"，也不禁止状态回退**——`confirmed` 可被 `ship` 覆盖，`shipped` 也可被再次 `confirm` 回退成 `confirmed`（无单调性检查，`:73-80` 是纯覆盖写）。前端 `supplier-orders.js:98-99` 用 `canConfirm = pending` / `canShip = confirmed` 在 UI 层强约束，**但该约束完全依赖客户端**。
- 确认状态**不影响主状态机**（`:2-3` 注释明确"互不影响主状态流转"）——供应商确认/发货只是内部协同信号，收货仍由门店角色发起。
- **每次 ship 都追加一条消息**（`:86-117`，无幂等）→ 供应商反复点"标记已发货"会向门店刷 N 条重复消息。

---

## 8. 取消 / 驳回 / 删除

| 操作 | 谁能做 | 允许的前置状态 | 对已建收货单的联动 |
|---|---|---|---|
| **作废 cancelOrder** | 仅 GLOBAL_ROLES（`dataService:1339`）；前端仅 `purchaser`/`super_admin` 可见按钮（`purchase-detail.js:81, 86`） | `{submitted, approved, report_generated}`（`:1356`） | **已在 `{partial_received, received, receipt_abnormal}` 中则拒绝**（`:1353`）→ 不删除已有收货单，走异常处理流程；报表标 `superseded`；`supplier_confirmations={}`；手动单重置核销 |
| **申请取消 requestCancel** | GLOBAL_ROLES（`:1431`）；前端 `purchaser`/`super_admin` 且 `cancelEligible = {approved, report_generated}`（`purchase-detail.js:84-85`） | `{submitted, approved, report_generated, partial_received}`（`:1443`） | **不改主状态、不动收货单**，仅置 `cancel_requested=true`（条件更新防重复，`:1452-1465`）+ 通知消息。**没有任何 action 消费该标记**（见 §2.3 T15） |
| **驳回 auditOrder rejected** | 管理角色，非自审 | `{submitted, pending_approval}` | 无收货单可联动（驳回发生在收货前）；**不通知供应商、不重算报表** |
| **删除** | — | — | **代码库中没有任何删除采购单的 action**（`grep` 无 `remove` 命中 `purchase_order`）。采购单不可删除，只能作废（cancelled）。收货单/异常台账的删除也不在本域内 |

**注意 `requestCancel` 与 `cancelOrder` 的状态集合不一致**：`requestCancel` 允许 `partial_received`（`:1443`），而 `cancelOrder` 明确拒绝 `partial_received`（`:1353`）→ **门店可对已有收货记录的订单提交"取消申请"，但即使管理员想确认，`cancelOrder` 也会拒绝**。前端 `purchase-detail.js:84` 已把 `partial_received` 排除出 `cancelEligible`，说明前端已知此口径，但后端 `requestCancel` 未同步收紧 → 直接调用云函数即可对已部分收货的单置位 `cancel_requested`，产生一条永远无法被确认的悬空标记。

---

## 9. 前端页面分析

### 9.1 purchase-create（435 行，本域最大）

**防重入**：`data.isSubmitting`（`:31`），`_saveOrder` 首行 `if (this.data.isSubmitting) return`（`:291`）。

**竞态点：**

1. **confirm 弹窗期间双击**（`:30` 注释已明确记录该历史问题）：`util.showConfirm` 之后才 `setData({isSubmitting:true})`（`:338-341`）——**弹窗打开到确认之间，`isSubmitting` 仍为 false**，理论可再次进入 `_saveOrder` 并弹第二个 confirm。触发需极快双击，低概率。
2. **拆单的两段式提交非原子**（`:362-401`）：先提档案单、成功后再提手动单。手动单失败时弹"部分提交成功"（`:386-397`），并把 `catalogOrderNo` 记入 `this.catalogOrderId` 供重试复用（`:377-383`）。**但此时 `this.data.manualItems` 未清空**，用户再次点"提交"时仍走 `hasManual && hasCatalog` 分支——因为 `this._qtyMap` 已被清空（`:383`）所以 `selectedProducts` 为空，实际进入 else 分支只提手动单。逻辑正确但依赖 `_qtyMap` 副作用，脆弱。
3. **追加采购幂等子键递增**（`:42`, `:367-370`）：已提交的档案单后端拒绝再编辑，因此同页新选商品走 `:c2/:c3` 新单。设计周到。
4. **`requestId` 生命周期**（`:43`, `:418-419`）：进入页面生成，整单成功后重置。失败重试保持不变 → 服务端可查重。跨页面实例不共享。

**草稿缓存**：本页**没有本地草稿缓存**（无 `wx.setStorageSync`）——数量存在 `this._qtyMap`（内存）、手动商品在 `this.data.manualItems`（内存）。**页面被小程序回收后未提交的输入全部丢失**。若需跨会话草稿，唯一途径是走"存草稿"（T1）落库。

### 9.2 purchase-detail（401 行）

- **`onShow` 时全量重载**（`:16-18`）——无乐观更新缓存，不存在"乐观更新与后端返回不一致"的问题；但每次从收货页返回都会重新拉全量数据 + 重新申请凭证图片临时链接（`:116-118`）。
- **操作防重入不一致**：`submitVoucher`/`remindAudit`/`verifyDecide`/`requestCancel`/`cancelOrder` 都检查 `this._submitting`（`:140, :193, :212, :257, :285`），**唯独 `submitRequest`（`:356-393`）和 `copyToDraft`（`:320-354`）不检查** → 双击可并发两次。缓解：`_genRequestId('submit'/'copy')` 按页面实例缓存（`:303-312`），服务端幂等可去重。
- **提交成功后无本地刷新**（`:387-392`）：toast 后 `setTimeout(navigateBack, 1000)`，不 `loadData()`。
- **canEdit 判定与后端一致**（`:72-77`）：草稿 +（全局角色 或 创建者 或 本店店长），与 `createPurchaseOrder:195-201` 的 #18 口径逐条对齐。
- **凭证上传分两步**（`:152-167`）：先 `wx.cloud.uploadFile` 到 `vouchers/{orderId}/`，再 `dataService verifyManualOrder submit` 登记 fileID。若上传成功但登记失败，云存储会残留孤儿图片文件。
- **`order.verifyStatus` 的 `['none','rejected']` 可提交、`['approved']` 不可提交**（`:97-113`）；`voucherBlockReason` 给出可解释阻塞原因（P0-7，`:101-111`）——设计良好。

### 9.3 purchase-list（154 行）

- 服务端分页 + `statusCounts` 服务端计数 + 上拉加载（`:55-109`）。
- **tab 计数来自服务端**（`:83-99`），不受分页截断影响。
- `to_verify` tab 仅全局角色可见（`:96-99`），与后端 `:71` 的 403 对齐。
- `createdBy` 仅 chef 时传（`:64`），后端对 chef 强制覆盖为本人 id（`getPurchaseOrders:55`）。
- **未传 `orderDate`**——后端支持按日筛选（`getPurchaseOrders:78`），前端列表页无此入口。

### 9.4 approval-list（105 行）/ approval-detail（113 行）

见 §6.2-6.4。补充：
- 两页都有前端角色闸门（`approval-list.js:12-18`、`approval-detail.js:15-21`），且后端 `dataService:488` 再次校验 MANAGEMENT_ROLES + 禁止自审 → **双重闸门，正确**。
- `approval-list` 的 `pageSize:100` 且无分页控件 → 待审核超过 100 单时，最早的待审核单永远不可见（列表按 `created_at desc`，`:111`）。
- `approval-list.js:74, 95` 的 `const app = getApp()` 取到后未使用（死代码）。

### 9.5 supplier-orders（131 行）

- 前端角色闸门（`:41-44`）+ 后端角色校验（`getSupplierOrders:61`, `confirmSupplierOrder:54`）双重。
- `doAction` 有 `_submitting` 防重入（`:118-123`）。
- `onReachBottom` 用 `orders.length >= total` 判断到底（`:48-52`），与 `wxml:48` 的"已加载全部"一致。
- **UI 层约束"先确认再发货"**（`:98-99`），后端不校验（见 §7.3）。

---

## 10. 契约一致性对照

### 10.1 createPurchaseOrder 入参对照

| 前端字段 | 前端发送点 | 后端读取点 | 结论 |
|---|---|---|---|
| `authToken` | `utils/cloud.js` 统一注入 | `:105` | ✔ |
| `orderId` | `purchase-create:323`、`purchase-detail:373` | `:111`, `:182` | ✔ |
| `storeId` | `:321`, `purchase-detail:374` | `:112` → `:175`/`:209` | ✔ 非全局强制覆盖，全局校验门店有效 |
| `storeName` | `:322`, `purchase-detail:375` | `:113` → `:179`/`:213` | ✔ 服务端总是覆盖（除 `:206` 沿用原草稿） |
| `orderDate` | `:324`, `purchase-detail:376` | `:114` → `:126` | ✔ |
| `deliveryDate` | `:325`, `purchase-detail:377` | `:115` → `:131` | ✔ 缺省回退 orderDate（向后兼容） |
| **`createdBy`** | `:326`, `purchase-detail:378` | `:116` 解构 | **完全忽略**（`:304-309` 取会话用户）→ 前端传值无效，无副作用 |
| **`createdByName`** | `:327`, `purchase-detail:379` | `:117` → **仅 `:383`** | ⚠ **只写进报表 CSV 的"经办人"列**，库内 `created_by_name` 由服务端推导（`:307-309`）→ 报表与单据口径可能不一致；且 `purchase-detail.copyToDraft`（`:336-346`）**不传该字段** → 复制草稿后提交的报表"经办人"列为空 |
| `items[].productId` | `:350` | `:241` | ✔ |
| `items[].productName` | `:351` | `:242` → `:260` 覆盖 | ✔ 档案商品被服务端覆盖（防篡改设计，`:225-226`）；手动单保留 |
| `items[].category` | `:352` | `:261` 覆盖 | ✔ 同上 |
| `items[].unit` | `:353` | `:243`/`:262` | ✔ 同上；手动单必填（`:251`） |
| `items[].supplierId` | `:354` | `:263` 覆盖 | ✔ 档案商品强制取 `product.default_supplier_id`；手动单强制 `''`（`:252`）→ **前端无法指定供应商** |
| `items[].orderQty` | `:355` | `:244` | ✔ 校验 0<q≤1000000 |
| `items[].isManual` | `:356` | `:250` | ✔ |
| `items[].remark` | `:357` | `:363` | ✔ |
| `remark` | `:329`, `purchase-detail:381` | `:119` → `:301` | ✔ |
| `orderStatus` | `:330`, `purchase-detail:382` | `:120` → `:219` | ✔ 白名单 `['draft','submitted']` |
| `requestId` | `:335`, `purchase-detail:345`/`:384` | `:121` → `:145` | ✔ |
| — | — | — | **前端缺失但后端需要：无**。所有必填项前端均已提供 |

### 10.2 getPurchaseOrders 入参对照

| 前端字段 | 前端发送点 | 后端 | 结论 |
|---|---|---|---|
| `role` | `purchase-list:62`、`approval-list:23` | `:43` 解构 | **完全忽略**（用会话角色）→ 正确设计，前端传值冗余 |
| `storeId` | `purchase-list:63`、`approval-list:24` | `:44`, `:62` | 仅全局角色生效；门店角色被强制覆盖 |
| `createdBy` | `purchase-list:64` | `:44`, `:63` | 仅全局角色生效 |
| `orderStatus` | `purchase-list:69` | `:44`, `:70-77` | ✔ 支持虚拟值 `to_verify`/`receivable` |
| `page` / `pageSize` | `:65-66`、`approval-list:26` | `:44-45` | ✔ pageSize 上限 100 |
| `orderDate` | **前端从未传** | `:44`, `:78` | 后端支持、前端无入口 |
| — | — | `statusCounts`（`:96-106`） | ✔ 前端 `purchase-list:84-99` 全部消费 |

### 10.3 getPurchaseOrderDetail / getSupplierOrders / confirmSupplierOrder

| 函数 | 前端发送 | 后端读取 | 结论 |
|---|---|---|---|
| getPurchaseOrderDetail | `{orderId}`（`purchase-detail:23-25`、`purchase-create:57-59`、`approval-detail:24-26`） | `:44` | ✔ 完全对齐 |
| getSupplierOrders | `{confirmStatus, page, pageSize}`（`supplier-orders:68-72`） | `:65-67` | ✔ 对齐；`orderDate` 后端支持但前端未传 |
| confirmSupplierOrder | `{orderId, action}`（`supplier-orders:121`） | `:58-59` | ✔ 完全对齐 |

### 10.4 返回契约

- `getPurchaseOrders` 返回 `{code, data, total, page, pageSize, statusCounts}`——`purchase-list` 全部消费（`:80-107`）。✔
- `getSupplierOrders` 返回 `data[].my_confirm_status`（下划线命名，未 camelCase）——`supplier-orders.js:90, 93, 98-99` 直接按下划线读取，**未走 `normalizePurchaseOrder` 之外的转换**（`:88` 只对 order 主体 normalize，`my_confirm_status` 在 normalize 之外单独取）。命名不统一但可用。
- `getPurchaseOrderDetail` 返回 `supplier_confirmations`（下划线）——`purchase-detail.js:37` 直接读。✔
- `cloud.normalizePurchaseOrder`（`utils/cloud.js:139-169`）覆盖 `purchaseOrderId/orderNo/storeId/.../verifyStatus/verifyVoucherFileIds/cancelRequested/...`；**未映射 `supplier_confirmations`、`missing_reports`、`backfilled`、`verify_cancel_note`**——这些字段若前端要用需自行按 snake_case 读。`missing_reports` 目前**无任何前端消费**（grep 仅云函数写入）。

---

## 11. 风险清单

严重度：高 = 可导致数据错误/重复单据/金额错误/越权；中 = 功能不可达/口径不一致/体验误导；低 = 遗留死代码/命名不统一/边界不可达。

| # | 严重度 | 风险 | 触发条件 | 证据 |
|---|---|---|---|---|
| **H-1** | **高** | **编辑草稿→提交路径无任何条件更新，可并发双写并重复生成报表** | 同一草稿被两个页面实例/两台设备/两个账号（本店店长+创建者）同时提交；或 purchase-detail 与 purchase-create 同时打开同一草稿 | `createPurchaseOrder:317` 无条件 `doc(_id).update()`；`:318-324` 删旧明细无状态条件；`:326-338` 幂等复查**只在 else（新建）分支**，编辑分支没有；`:380-449` 报表在事务外且无幂等 → 两张 `store_order_report`/`supplier_order_report` 并存，`file_version` 各不同且**旧版不标 superseded**，报表中心出现重复单据 |
| **H-2** | **高** | **幂等无唯一索引兜底，check-then-act 非原子** | 两个并发请求的 requestId 相同但都通过了事务外预查（`:147-152`），且都进入事务内复查之前的窗口 | `createPurchaseOrder:327` 注释自认"终极防线是 `(request_id, created_by)` 唯一索引，见修复计划 B6-2"；`修复计划-2026-10-03.md:103, :157` 列为待办未建 |
| **H-3** | **高** | **幂等可被完全绕过**：`requestId` 为空则幂等不生效；前端键按页面实例生成，跨实例/跨设备/下拉刷新后重试均无法去重 | 用户手动清空 requestId（可枚举参数）；或页面被回收后重进再提交 | `createPurchaseOrder:145-146`；`purchase-create.js:43`、`purchase-detail.js:303-312` |
| **H-4** | **高** | **供应商确认状态无单调性、无审计、可被覆盖回退** | 供应商先发货后确认；或供应商 A 看到 B 的状态后误操作 | `confirmSupplierOrder:73-80` 纯覆盖写，无"只能前进"校验、无历史记录（单槽 `updated_by` 被覆盖） |
| **H-5** | **高** | **`getSupplierOrders` 向当前供应商下发全部供应商的确认状态**（信息越权） | 任何供应商查看自己相关的多供应商订单 | `getSupplierOrders:126-129` 的 `...order` 含完整 `supplier_confirmations` map（其他供应商的 status/updated_at/updated_by） |
| **M-1** | **中** | **`to_receive` 是陷阱状态**：无人写入，且既不可收货也不可作废 → 落入即永久卡死 | 目前无写入路径（低概率），但 `confirmSupplierOrder:13`、`authService:642`、`updateProductPrice:43` 都把它当合法状态 | `createReceipt:235/413` 拒绝、`dataService:1356/1377` 拒绝 |
| **M-2** | **中** | **死状态 `pending_approval`/`report_generated`/`completed` 无写入方**，却在多个守卫集合中 | 状态机演进遗留 | `getPurchaseOrders:74/94` 把 `report_generated` 计入"待收货"统计（恒为 0，无害但误导） |
| **M-3** | **中** | **后端不校验"先确认才能发货"**，前端 UI 约束可被绕过 | 直接调云函数 `confirmSupplierOrder action='ship'` | `confirmSupplierOrder:62` 只按 `order_status` 白名单，不看确认状态；`supplier-orders.js:98-99` 仅在 UI 层约束 |
| **M-4** | **中** | **重复发货刷重复消息**：每次 ship 都 add 一条 message，无幂等 | 供应商反复点击"标记已发货"，或网络重试 | `confirmSupplierOrder:85-117` 无 message_id 去重（对比 `createReceipt:566` 用稳定 `MSG_RECEIVE_${receiptId}`） |
| **M-5** | **中** | **`requestCancel` 与 `cancelOrder` 状态集合不一致**：可对已部分收货的单置 `cancel_requested`，但管理员永远无法确认 | 直接调 `dataService action='requestCancel'`，orderStatus='partial_received' | `dataService:1443` 含 `partial_received` vs `:1353` 拒绝之；前端 `purchase-detail.js:84` 已收紧但后端未同步 |
| **M-6** | **中** | **`cancel_requested` 标记无人消费**：申请取消后没有管理员审批入口，订单不会自动作废 | 提交取消申请后等待 | `dataService:1452-1473` 只写标记+发通知；全库无读取该标记并触发作废的 action |
| **M-7** | **中** | **approval-detail 无状态闸门**：已审核/已驳回单仍显示"待审核"+审核按钮 | 直接跳转/刷新已审核单 | `approval-detail.js:22-47` 只按 orderId 加载；`approval-detail.wxml:17` 硬编码"待审核"标签 |
| **M-8** | **中** | **approval-list 无分页，`pageSize:100` 上限**：待审核超 100 单时最早的单永久不可见 | 高并发门店积压审批 | `approval-list.js:22-27`（无 page 参数、无下拉/上拉加载控件，仅下拉刷新） |
| **M-9** | **中** | **报表生成在事务外且无幂等；进程在提交后、标记缺失前被杀 → 订单永久缺报表且无 `missing_reports` 标记** | 云函数超时/被回收发生在 `:369` 之后、`:464-489` 之前 | `createPurchaseOrder:369-455`；对比 `createReceipt:564-578` 把 message 放进同一事务 |
| **M-10** | **中** | **`createdByName` 只进报表不进库**：报表"经办人"列由客户端决定，库内 `created_by_name` 由服务端推导；`copyToDraft` 不传该字段 → 报表经办人列为空 | 从 purchase-detail 复制驳回单为新草稿后提交 | `createPurchaseOrder:117` 解构、`:383` 唯一使用点、`:307-309` 库内取值不同源；`purchase-detail.js:336-346` 未传 |
| **M-11** | **中** | **`verify_status` 三值语义重叠**：普通单 `''`、手动单 `'none'`、待核销 `'pending'`。空串与"未设置"不可区分，未来若有 `IS NULL`/存在性查询会误判 | 未来扩展核销逻辑 | `createPurchaseOrder:297`、`getPurchaseOrders:72` |
| **M-12** | **中** | **`getSupplierOrders` 排序按 `String(Date).localeCompare`，星期名/月份名主导比较，跨月/跨年顺序错乱** | 供应商列表跨月查看 | `getSupplierOrders:116`（Node `String(new Date())` → `"Tue Mar 3 2026 ..."`，字典序比较星期缩写） |
| **M-13** | **中** | **`getSupplierOrders` 明细 `limit(1000)` 静默截断**：供应商累计明细超 1000 条时漏单 | 大供应商长期经营 | `getSupplierOrders:72-75` |
| **M-14** | **中** | **拆单两段式提交非原子**，且成功路径依赖 `_qtyMap` 副作用驱动分支切换 | 档案单提交成功、手动单失败后重试 | `purchase-create.js:362-401`（正确但脆弱，无显式状态标记） |
| **L-1** | 低 | **`event.createdBy` 完全被忽略**（前端仍传） | 无实际影响 | `createPurchaseOrder:116` 解构后未使用 |
| **L-2** | 低 | **`getPurchaseOrders` 的 `role` 入参完全被忽略**（前端仍传） | 无实际影响 | `getPurchaseOrders:43` |
| **L-3** | 低 | **purchase-detail 的 `submitRequest`/`copyToDraft` 无前端防重入**（同文件其他 5 个操作都有 `_submitting`） | 双击 | `purchase-detail.js:356-393`, `:320-354` vs `:140, :193, :212, :257, :285` |
| **L-4** | 低 | **purchase-create 无本地草稿缓存**：页面被小程序回收后未提交的输入全部丢失 | 小程序切后台被杀 | `purchase-create.js` 全文无 `wx.setStorageSync` |
| **L-5** | 低 | **`confirmSupplierOrder` 的明细校验不含 `is_manual` 过滤**，与 `getSupplierOrders:71` 的"清单 #24 双保险"口径不一致 | 当前不可触发（手动单强制 `supplier_id=''`），未来若允许手动指定供应商即成越权通道 | `confirmSupplierOrder:65-68` |
| **L-6** | 低 | **`markMessageRead` 不校验 `scope_type/scope_id`**，供应商可把 `store_id` 为空的门店消息标为已读 | 供应商调用 markMessageRead | `dataService:671-691` vs `:651-653` |
| **L-7** | 低 | **草稿编辑删除旧明细用 `limit(1000)`**，超 1000 行时残留孤儿明细 | 建单已限 100 行/单，实际不可达 | `createPurchaseOrder:318-324` vs `:223` |
| **L-8** | 低 | **purchase-create 的 confirm 弹窗期间 `isSubmitting` 尚未置位**，理论上可弹第二个 confirm | 极快双击 | `purchase-create.js:338-341` |
| **L-9** | 低 | **CSV 无尾差调整行**：行小计先取整再累加，与供应商按未取整原值开票存在分位级差异 | 供应商对账 | `createReceipt:634-638` 等 |
| **L-10** | 低 | **`getPurchaseOrderDetail` 的 receipt 查询不带 status 过滤、`limit(100)`**；`missing_reports`/`backfilled`/`supplier_confirmations` 未被 `normalizePurchaseOrder` 映射 | 长期数据积累 | `getPurchaseOrderDetail:120-123`；`utils/cloud.js:139-169` |
| **L-11** | 低 | **遗留死代码/无用样式**：`approval-list.js:74, 95` 的 `const app = getApp()` 未使用；`purchase-detail.wxss:111-114` 的 `.qty-approved` 无 wxml 使用 | 无功能影响 | 同左 |
| **L-12** | 低 | **`seed-data/purchase_order.json` 与代码不一致**：样例数据含混单手（`PO20260806001` 同单含档案商品与 `MANUAL_001`），违反 S9 混单禁令（`:275-278`）；对这种旧单点"复制为新草稿"会被后端拒绝 | 仅影响种子数据演示 | `seed-data/purchase_order_item.json:1-4` vs `createPurchaseOrder:276-278` |

---

## 12. 待确认清单

1. **`to_receive` 是否为历史遗留**：需确认是否存在数据迁移脚本或已下线的云函数曾写入该状态（本次探索范围内未见写入方）。若有存量数据处于该状态，则无法收货也无法作废，需人工订正。
2. **`pending_approval` 的遗留来源**：`dataService.auditOrder` 明确接受该状态（`:504`, `:543`），推测是"提交即 pending_approval"的旧设计残留。需确认线上是否有该状态的存量单。
3. **`report_generated` 的预期语义**：名字暗示"下单报表已生成"，但 `createPurchaseOrder` 提交时同步生成报表后仍把状态置为 `submitted`（`:291`），报表生成失败才打 `missing_reports`（`:467`）——即**状态与报表生成结果完全解耦**，`report_generated` 从未被用作"报表已生成"的标记。需确认产品口径。
4. **`cancel_requested` 的闭环设计**：是否存在计划中的"管理员确认取消申请"action（当前 `cancelOrder` 不检查该标记，二者互不关联）。
5. **`request_id` 唯一索引（B6-2）**：确认是否已在微信云开发控制台手动创建（代码无法体现，`修复计划-2026-10-03.md:157` 仅列为待办）。
6. **`supplier_confirmations` 是否应加单调性与历史**：需产品确认"发货后可否回退为待确认"是允许行为还是 bug。
7. **供应商订货单是否应含金额**：当前明确不含（`dataService:303` 注释），但供应商侧实际对账依赖 `supplier_receipt_price_report`（收货环节带价账单）。需确认这是刻意的"订货单不含价、账单才含价"两段式设计。
8. **`getSupplierOrders` 的 `my_confirm_status` 命名**：返回体混用 snake_case（`my_confirm_status`、`supplier_confirmations`）与 normalize 后的 camelCase，是否有意为之。
9. **`approveQty` 是否允许大于 `order_qty`**：`dataService:530` 明确 `qty > order_qty` 拒绝。若业务需要"审批加量"，当前不支持（需先改单再审）。
10. **草稿是否有"删除草稿"入口**：本域页面未见删除草稿的操作；`createPurchaseOrder` 也不支持删除。离职员工遗留草稿由店长代提交（#18），但长期不提交的草稿会持续累积。

---

## 附：本域数据模型快照

```
purchase_order
├─ purchase_order_id / order_no     订单号（两者同值）
├─ store_id / store_name            门店（服务端覆盖）
├─ order_date / delivery_date       日期（UTC+8 校验，delivery ≥ order）
├─ order_status                     见 §2.1
├─ backfilled                       补录标记（order_date < 服务端今天）
├─ is_manual                        手动商品专用单
├─ verify_status / verify_amount / verify_note / verify_reject_note
│  verify_voucher_file_ids / verify_cancel_note
├─ supplier_confirmations           { [supplier_id]: {status, updated_at, updated_by} }
├─ cancel_requested / cancel_requested_by / cancel_request_reason / cancel_requested_at
├─ cancel_reason / cancelled_by / cancelled_at
├─ audit_remark / audited_by / audited_at
├─ missing_reports                  报表缺失标记（仅云函数写，无前端读）
├─ created_by / created_by_name / created_at / submitted_at / updated_at
├─ request_id                       幂等键
└─ remark
   └─ 无 version 字段（全链路唯一 CAS 版本号在 report_version_counter）

purchase_order_item
├─ item_id = orderNo + '_' + (i+1)   确定性 id（非唯一索引）
├─ purchase_order_id / product_id
├─ product_name_snapshot / category_snapshot / unit_snapshot
├─ supplier_id / order_qty / is_manual / remark
├─ original_order_qty / approved_qty / updated_at   （审批改量后写入）
└─ created_at
   └─ 无 unit_price / amount / tax（金额只在收货环节的 receipt_item.price_snapshot）
```
