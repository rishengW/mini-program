# 批 04：数据层 / 商品 / 价格 / 供应商 云函数全量核查

> 范围：`cloudfunctions/dataService`、`getProducts`、`getProductPrices`、`updateProductPrice`、`importProducts`、`getSuppliers`（各 index.js + package.json）
> 方法：逐行读码，不采信注释。结论带 `文件:行号`。拿不准标【待核实】。
> 前置：已读 `batch1-cloudfunctions-data.md`（下称 batch1）与 `controller-horizontal-scan.md`（下称 controller），本文只做**校验与补全**，不重写。
> 版本基线：HEAD = `5268379`。batch1 写于 `3558678` **之前**（文档 mtime 00:57，commit 01:11），故 batch1 的 dataService 行号在 L684 之后**整体偏移 -2**（`3558678` 在 `ABNORMAL_TYPE_NAMES` 加了 `missing_price` 共 +2 行）。本文全部行号以**当前代码**为准。
> 纪律来源：`[[trust-code-not-comments]]`。

---

## 0. 文件覆盖清单

| 路径 | 行数 | 一句话职责 |
|---|---|---|
| `cloudfunctions/dataService/index.js` | 1559 | 项目最大云函数：分类/商品/供应商主数据 + 审核 + 消息中心 + 异常处理链 + 报表补偿 + 作废/催审/凭证核销，**22 个 action 的单入口网关** |
| `cloudfunctions/dataService/package.json` | 6 | 仅 `wx-server-sdk: ~2.6.3` |
| `cloudfunctions/getProducts/index.js` | 66 | 商品列表查询（内存关键词过滤，硬 limit 200） |
| `cloudfunctions/getProducts/package.json` | 6 | 仅 `wx-server-sdk` |
| `cloudfunctions/getProductPrices/index.js` | 89 | 供应商协议价查询（供货商强制收敛自身 + join 商品名） |
| `cloudfunctions/getProductPrices/package.json` | 6 | 仅 `wx-server-sdk` |
| `cloudfunctions/updateProductPrice/index.js` | 138 | 协议价覆盖写（事务内降旧版 + 插新版）+ 在途单波及计数 + dryRun |
| `cloudfunctions/updateProductPrice/package.json` | 6 | 仅 `wx-server-sdk` |
| `cloudfunctions/importProducts/index.js` | 209 | Excel 批量导入商品（SheetJS，固定模板别名映射，逐条串行 add） |
| `cloudfunctions/importProducts/package.json` | 7 | `wx-server-sdk` + **`xlsx: ^0.18.5`**（全项目唯一额外依赖） |
| `cloudfunctions/getSuppliers/index.js` | 96 | 供应商列表（供货商仅见自己 + product_count 反查） |
| `cloudfunctions/getSuppliers/package.json` | 6 | 仅 `wx-server-sdk` |

**合计 6 个 index.js / 2157 行 + 6 个 package.json，全部读完。** 与 batch1 §0 一致：无任何共享模块，`hashToken` / `getSessionUser` 在 6 个文件里各复制一份。

---

## 1. dataService 完整入口 / 内部函数清单

### 1.1 常量

| 常量 | 行 | 值 | 实际使用点 |
|---|---|---|---|
| `GLOBAL_ROLES` | 8 | `['super_admin','purchaser']` | 626, 650, 703, 740, 760, 810, 839, 852, **871/989/1036/1106/1280/1336/1441（requireUser 参数）** |
| `MANAGEMENT_ROLES` | 9 | `['super_admin','purchaser']` | **92, 133, 144, 177, 483**（仅 5 处） |
| `VOUCHER_SUBMIT_ROLES` | 11 | `['super_admin','purchaser','store_manager']` | 1441（仅 1 处） |
| `SUBSCRIBE_TEMPLATE_ID` | 244 | `''` | 270（订阅消息总开关，**默认关闭**） |
| `SUBSCRIBE_TEMPLATE_FIELDS` | 246-251 | 4 个字段 | 276 |
| `ABNORMAL_TYPE_NAMES` | 683-689 | shortage/quality/wrong_item/**missing_price** | 722 |
| `ABNORMAL_STATUS_NAMES` | 690-695 | pending/processing/resolved/closed | 727 |

> ⚠️ **`GLOBAL_ROLES` 与 `MANAGEMENT_ROLES` 同值冗余**（`:8` 与 `:9` 完全相同的数组）。语义完全等价，只是命名不同 → **改名风险**：日后若只改其中一个（例如想让 `purchaser` 失去某权限），会产生静默权限漂移。
> 另注意 `startAbnormal`/`resolveAbnormal`/`closeAbnormal`（`:735, 751, 803`）与 `remindAudit`（`:1384`）**不用任何常量，而是内联字面量数组**：
> - `['store_manager','purchaser','super_admin']`（735/751/803）—— **集合上等于 `VOUCHER_SUBMIT_ROLES`，但没用常量**
> - `['chef','store_manager','purchaser','super_admin']`（1384）
> 即「异常处理权限」与「凭证提交权限」实际是同一组角色，却分别用一处常量、三处字面量表达。**语义混淆点**：`VOUCHER_SUBMIT_ROLES` 这个名字不涵盖异常处理场景。

### 1.2 22 个导出 action（分发表 `:1530-1553`）

> 分发表实测为 **22 个 case**（`:1531-1552`），不是 27 个。

| # | action | 定义行 | 做什么 | 读集合 | 写集合 | 前置权限 | 返回结构 |
|---|---|---|---|---|---|---|---|
| 1 | `getCategories` | 54 | 拉全量启用分类，内存聚合出 level1 + categories | `category` (limit 100, status:1) | — | `requireUser` **无角色参数**（任意已登录，含 supplier） | `{code:0,data:{level1,categories}}` |
| 2 | `saveProduct` | 91 | 新增/编辑商品；服务端重取分类快照；校验默认供应商存在 | `category`, `supplier`, `product` | `product` | `MANAGEMENT_ROLES` | `{code:0,data:{productId}}` |
| 3 | `toggleProduct` | 132 | 商品 status 1↔0 软删/恢复 | `product` | `product` | `MANAGEMENT_ROLES` | `{code:0,data:{status}}` |
| 4 | `saveSupplier` | 143 | 新增/编辑供应商；名称查重（limit 100） | `supplier` | `supplier` | `MANAGEMENT_ROLES` | `{code:0,data:{supplierId}}` |
| 5 | `toggleSupplier` | 176 | 供应商 status 1↔0 | `supplier` | `supplier` | `MANAGEMENT_ROLES` | `{code:0,data:{status}}` |
| 6 | `auditOrder` | 482 | 审核通过/驳回 + 改量（只能减）；事务内状态复查；批准改量后重算 ①② 报表；批准后下推供货商 | `purchase_order`, `purchase_order_item` | 同左 + `report_file` + `message` + 云存储 | `MANAGEMENT_ROLES` + **自单自审拦截** | `{code:0,data:{reportWarning}}` |
| 7 | `getMessages` | 612 | 消息列表，过滤条件下推到 DB（按 recipient/store/scope） | `message` (limit 100) | — | `requireUser` **无角色参数**；函数体内按角色收敛 | `{code:0,data:[…]}` |
| 8 | `markMessageRead` | 643 | 单条标记已读（按用户 `read_by` 去重） | `message` | `message` | `requireUser` 无角色 + **字面归属判定** | `{code:0}` |
| 9 | `markAllMessagesRead` | 665 | 全部已读；**逐条回读原文**（N+1） | `message` ×2 | `message` | 同 7 | `{code:0}` |
| 10 | `getAbnormalRecords` | 697 | 异常列表；chef 返回空数组；非全局按 store_id 收敛；join 供应商名 | `abnormal_record` (limit 100), `supplier` | — | `requireUser` 无角色；体内按角色收敛 | `{code:0,data:[…]}` |
| 11 | `startAbnormal` | 734 | pending→processing | `abnormal_record` | 同左 | 内联 `['store_manager','purchaser','super_admin']` + **门店归属复查** | `{code:0}` |
| 12 | `resolveAbnormal` | 750 | processing→resolved；写 payment_decision + 发 2 条消息 | `abnormal_record`, `app_user`（店长） | `abnormal_record`, `message` | 同上 + 门店归属 | `{code:0}` |
| 13 | `closeAbnormal` | 802 | resolved→closed | `abnormal_record` | 同左 | 同上 + 门店归属 | `{code:0}` |
| 14 | `getOrderStats` | 827 | 首页 4 张卡的服务端 count 聚合（Promise.all 并发） | `purchase_order` ×4 | — | `requireUser` 无角色；体内收敛，**supplier → -403** | `{code:0,data:{submitted,receivable,received,to_verify}}` |
| 15 | `settleReceipt` | 870 | 异常闭环后补结算：pay_received 行转回可付款 + 按供应商重出 ⑥ 账单 | `receipt`, `abnormal_record`, `receipt_item`, `supplier` | `receipt_item`, `report_file` + 云存储 | `GLOBAL_ROLES` | `{code:0,data:{generatedSuppliers,count}}` |
| 16 | `regenerateOrderReports` | 988 | 补生成 ①② 下单报表 + 清 `missing_reports` | `purchase_order`, `purchase_order_item` | 同 6 | `GLOBAL_ROLES` | `{code:0,data:{orderId,regenerated}}` |
| 17 | `repriceReceipt` | 1035 | 补配协议价后刷新价格快照 + 转可付款 + 关闭 missing_price 异常 + 重出 ③④⑤⑥ | `receipt_item`, `supplier_product_price`, `abnormal_record` | `receipt_item`, `abnormal_record`, `report_file` | `GLOBAL_ROLES` | `{code:0,data:{message,repriced,stillMissing}}` |
| 18 | `regenerateReceiptReports` | 1105 | 报表失败后补生成 ③④⑤⑥ + 清 `missing_reports` | `receipt`, `receipt_item`, `supplier` | `report_file`, `purchase_order` | `GLOBAL_ROLES` | `{code:0,data:{generated,count}}` |
| 19 | `cancelOrder` | 1279 | 作废订单 + 报表 superseded + 手动单重置核销状态 | `purchase_order`, `report_file` | 同左 | `GLOBAL_ROLES` | `{code:0}` |
| 20 | `requestCancel` | 1333 | 申请取消（条件更新防重复） | `purchase_order` | `purchase_order`, `message` | `GLOBAL_ROLES`（**门店归属校验恒假**） | `{code:0}` |
| 21 | `remindAudit` | 1383 | 催审；1 小时限频；条件更新兜底 | `purchase_order` | `purchase_order`, `message` | 内联含 chef + 门店归属 | `{code:0}` |
| 22 | `verifyManualOrder` | 1438 | 手动单凭证核销 submit/approve/reject；条件更新防并发；清理旧凭证文件 | `purchase_order` | `purchase_order` + 云存储 delete | submit→`VOUCHER_SUBMIT_ROLES`；其余→`GLOBAL_ROLES` | `{code:0,data:{message}}` |
| — | `default` | 1553 | — | — | — | — | `{code:-1,msg:'不支持的数据操作'}` |

### 1.3 内部函数（不导出）

| 函数 | 行 | 职责 |
|---|---|---|
| `hashToken` | 13-15 | SHA256(token) 十六进制 |
| `getSessionUser` | 17-43 | 会话校验：先查 `sessions` 数组，未命中回退单会话字段；校验过期 |
| `requireUser` | 45-52 | **错误时返回嵌套 `{error:{code,msg}}`**（全文件唯一来源） |
| `findCategory` | 83-89 | 按 category_id 查启用分类 |
| `createMessage` | 187-206 | 写站内消息（稳定字段集 + `read_by:[]` + scope） |
| `getStoreManagerId` | 209-220 | 查门店店长 user_id，失败回退 `''`（门店广播） |
| `resolveActiveRecipient` | 224-239 | 创建人离职则改发店长，避免消息进死信箱 |
| `getSupplierUsers` | 254-266 | 查供货商启用账号（含 openid），limit 20 |
| `sendSubscribeMessage` | 269-293 | 微信订阅消息；`SUBSCRIBE_TEMPLATE_ID=''` 时只记日志 |
| `notifySuppliersNewOrder` | 296-346 | 按供应商分组：站内消息必写 + 微信推送尽力而为；**手动行跳过** |
| `csvField` | 350-355 | CSV 转义 + 公式注入防护 `/^[=+\-@]/` 前置 `'` |
| `safePathPart` | 357-359 | 路径非法字符替换 + 截 80 |
| `getNextVersion` | 361-378 | `report_version_counter` 原子自增取版本号（**报表版本，与价格版本无关**） |
| `regenerateApprovedOrderReports` | 385-480 | 改量后重出 ①② 报表 + 旧版 superseded + 清供货商确认 |
| `publicMessage` | 599-610 | 消息输出字段映射 |
| `exports.main` | 1528-1559 | action 分发 + **全局 catch 吞异常** |

---

## 2. 与 batch1 结论的逐条校验

**总判断：batch1 对 dataService 的功能性结论绝大多数仍然成立；仅 1 条已被 `3558678` 修复、1 条行号区间整体偏移 -2。**

| batch1 结论 | batch1 行号 | 当前状态 |
|---|---|---|
| §5.12 `getOrderStats`：`received = order_status==='received' && verify_status !== 'pending'` → **待核销的手动单不计入已完成** | 844 | **❌ 已过时**。`3558678` 改为 `const receivedQuery = { ...baseQuery, order_status: 'received' }`（当前 **L846**），口径对齐列表「已收货」tab；待核销子集单独出 `to_verify`。batch1 这句必须作废。 |
| §18.9 getReportDetail 字典缺 `missing_price` | getReportDetail:12-16 | ✅ **仍成立**。`3558678` 只补了 **dataService** 的字典（当前 L688），**getReportDetail:12-16 仍未加**。且 getReportDetail 的 `getAbnormalTypeNames` 只读 `is_shortage/is_quality_issue/is_wrong_item`（receipt_item 无 `is_missing_price` 字段），所以缺价异常在**报表详情**中仍完全不可见。字典修复对 dataService 有效、对 getReportDetail 无效。 |
| §1.7 `requireUser` 返回嵌套 `{error:{code,msg}}`（47,49） | 47,49 | ✅ 仍成立（行号未变） |
| §18.1 getProducts `.limit(200)` 硬上限、keyword 内存过滤 | 53, 56-59 | ✅ 仍成立 |
| §18.4 getSuppliers `status` 参数越权 | 58 | ✅ 仍成立（L58-59） |
| §18.4 getSuppliers keyword 正则注入 | 61 | ✅ 仍成立 |
| §18.4 getSuppliers `.limit(100)`、product_count limit 1000 | 67, 76-79 | ✅ 仍成立 |
| §18.4 supplier 分支不做 status 过滤 | 47-50 | ✅ 仍成立 |
| §18.9 getProductPrices limit 200、`product.name` 冗余兜底 | 59-60, 79 | ✅ 仍成立 |
| §14 updateProductPrice 全部结论（priceId 无随机后缀、S5 仅当天、事务正确、波及计数 limit 1000） | 103, 80-85, 106-131, 46-49 | ✅ 全部仍成立（该文件 `3558678` 未改动） |
| §15 importProducts 全部结论（无事务/无行数上限/分类歧义/字段集与 saveProduct 一致/重试幂等） | 各 | ✅ 全部仍成立（该文件最后改动为 `ede7bcb`） |
| §5.7 `settleReceipt` 无事务无条件更新 → 并发重复补结算 | 887-893 | ✅ 仍成立（当前 **L889-895**） |
| §5.8 `repriceReceipt` 关闭异常只写 `handled_by` 缺 `resolved_by/resolved_at`；取价 limit(100) 截断 | 1051-1058, 1075-1088 | ✅ 仍成立（当前 L1055-1058, L1081-1089） |
| §5.9 `requestCancel` 门店归属校验是死代码 | 1350-1352 | ✅ 仍成立（当前 **L1352**） |
| §5.10 `remindAudit` `where({$or:[…]})` 字面量待核实 | 1412-1415 | ✅ 仍成立（当前 **L1414-1417**），**全项目仅此 1 处 `$or` 字面量**（grep 确认），其余 15+ 处均用 `_.or([...])` |
| §5.11 `cancelOrder` 白名单 vs `setStoreStatus` ACTIVE 列表遗漏 `receipt_abnormal` | 1295 | ✅ 仍成立（当前 L1294） |
| §5.5 `verifyManualOrder` approve 无金额上限、`verify_amount` 未舍入、云存储删除面 | 1507-1513, 1480-1488 | ✅ 仍成立（当前 L1509-1515, L1482-1490） |
| §5.1 `auditOrder` 事务内 rollback 携带自定义信息 + `err.errMsg.includes(...)` 依赖 | 539, 561 | ✅ 仍成立（行号未变） |
| §5.4 `markAllMessagesRead` N+1 | 665-681 | ✅ 仍成立 |
| §1.8 `dataService` 全局 catch 吞成通用文案 | 1553-1556 | ✅ 仍成立（当前 **L1555-1558**） |
| §4.11 `receipt.missing_reports` 无清除路径 | createReceipt:706 | ✅ **grep 二次确认**：全项目 `missing_reports` 清除点仅 `dataService:1019-1020` 与 `1267-1269`，**两处都是 `purchase_order`**，`receipt` 侧永不清除 |
| §20.6 `supplier_product_price.expiry_date` / `currency` 孤儿字段 | updateProductPrice:122,124 | ✅ **grep 二次确认**：全项目仅 updateProductPrice 写入，**0 个读取点** |

### 2.1 需要向主控**纠正**的两条跨批次结论

1. **「`dataService:552 order_status: event.status` 原样写库无枚举校验」→ 错误。**
   `auditOrder` 在 L485 已有严格枚举校验：
   ```js
   if (!['approved', 'rejected'].includes(event.status)) return { code: -1, msg: '审核状态无效' }
   ```
   L552 的 `order_status: event.status` 在枚举校验**之后**，且事务内（L538）还按 `order_status` 白名单二次复查。**此处不是缺口。**

2. **「`requestCancel:1348` 与 `cancelOrder:1294` 白名单不一致」→ 成立但性质需说清。**
   两处白名单并非「不一致的笔误」，而是**申请链路与执行链路的能力不对齐**：
   - `requestCancel` L1348 允许申请：`['submitted','approved','report_generated','partial_received','to_receive']`
   - `cancelOrder` L1294 明确拒绝：`['partial_received','to_receive','received','receipt_abnormal']`
   → 管理员可以成功**提交** `partial_received` / `to_receive` 订单的取消申请（拿到 `{code:0}` 和一条站内消息），但之后 `cancelOrder` 一定返回「该订单已有收货记录，不能作废」。**申请后无法执行**，用户侧表现为「申请成功了却没人能处理」。属真实缺陷，但严重度为中低而非数据错乱。

---

## 3. 商品与价格数据模型还原

### 3.1 `product`（写入点 `dataService.saveProduct:107-128`、`importProducts:171-184`）

| 字段 | 说明 |
|---|---|
| `product_id` | `'P' + Date.now() + random{3,4}hex`（saveProduct 3 字节 hex，importProducts 4 字节 hex — **长度不一致**，见 §问题清单） |
| `product_name` | 唯一业务键之一 |
| `category_level_1` | **一级分类编码**（非名称） |
| `category_level_2_id` | 二级分类 id（`Number`） |
| `category_name` | 二级分类名称 |
| `unit` / `spec` | 单位 / 规格 |
| `manufacturer_name` | 默认 `'默认'` |
| `default_supplier_id` | 默认供应商；下单时写入 `purchase_order_item.supplier_id` |
| `status` | 1/0 软删 |
| `created_at` / `updated_at` | `db.serverDate()` |

**`product_name | manufacturer_name` 是事实上的去重键**（仅 `importProducts:155,156` 显式用；`saveProduct` **不做**去重校验 → 手工表单可以创建任意多条同名同厂家商品）。见 §问题清单。

### 3.2 `supplier_product_price`（唯一写入点 `updateProductPrice:116-130`）

| 字段 | 说明 |
|---|---|
| `price_id` | `'PRC_' + Date.now()` — **无随机后缀**（全项目唯一） |
| `supplier_id` / `product_id` | 复合键 |
| `price` | 数值，**未做精度舍入** |
| `currency` | 恒 `'CNY'`（0 读取点） |
| `effective_date` | **强制 = 服务端 UTC+8 今天**（L81-85 拒绝任何其他日期） |
| `expiry_date` | 恒 `null`（0 读取点） |
| `is_current` | 1/0，同一 (supplier, product) 恰 1 条为 1 |
| `updated_by` | `user.user_id || user._id || updatedBy || 'system'` — 客户端值仅末位兜底，**无法伪造** |

### 3.3 关系与版本语义（回答「覆盖还是新增版本」）

- **一个商品可有多个供应商报价**：(product_id, supplier_id) 是价格表的复合粒度。
- **同一 (supplier, product) 有多条历史行，恰 1 条 `is_current=1`**。
- **`updateProductPrice` 既是「覆盖」也是「新增版本」，且只有这一条写入路径**：
  事务内（L106-131）先把所有 `is_current:1` 的旧行置 0（L107-115），再插入一条新行 `is_current:1`（L116-130）。
  → **价格变更 = 追加一行 + 降版旧行**，历史永不删除，天然可追溯。前端「新增价格」与「改价」走**同一个端点**（`price-manage.js:155` 与 `:210`），没有独立的 insert-only 路径。
- **`getNextVersion`（dataService:361-378）与价格版本无关**：它是 `report_version_counter` 集合的报表版本号原子自增（`counterId = reportType_scopeId_relatedDate`）。价格表里**没有任何版本号字段**，价格的时间维度只有 `effective_date` + `created_at`。

### 3.4 `getNextVersion` 边界行为

- 原子 `_.inc(1)` → 读回 count（L366-370）；读回失败/`updated===0` → 尝试 `add` 建行（L372-374）；3 次重试后 `throw`（L377）。
- ✅ 正常并发下不同调用得到不同值。
- ⚠️ **读回竞态**：A inc→1、B inc→2、A 读回 2、B 读回 2 → **A、B 拿到同一个 `file_version=2`，且版本 1 被跳过**。
  影响仅显示层：`report_file.file_version` 在同一 (report_type, scope_id, related_date) 下重复；云存储路径含 orderNo/receiptId 不冲突。**低危**。

### 3.5 `getProductPrices` 聚合方式（getProductPrices:43-61）

无真正聚合，是「条件过滤 + join 补齐」：
1. 供货商 → **强制** `supplier_id = default_supplier_id`，忽略前端传入（L46-49）✅
2. 非全局角色（chef/store_manager）→ **直接 -403**（L51）✅（注意：与 getProducts 完全不同——getProducts 对 chef 放行）
3. `supplierId` / `productId` / `onlyCurrent → is_current:1` 逐个叠加（L52-55）
4. `orderBy('effective_date','desc').limit(200)`（L59-60）
5. 按 `product_id` chunk 20 / `limit(100)` 反查 `product`，补 `product_name`、`unit`（L64-81），**`{...item}` 原样展开** → `price` / `effective_date` / `is_current` / `updated_by` / `currency` / `expiry_date` 全部下发。

⚠️ 由于 `effective_date` 被强制为「写入当天」，**所有 current 行的 effective_date 都是今天** → `orderBy('effective_date','desc')` 在同一日期内是**无序平局**，返回顺序不保证稳定。前端若依赖「最新价在前」需注意。

### 3.6 commit `3558678` 的两个专项核对

| commit 声称 | 核对结果 |
|---|---|
| `dataService` 加 `missing_price` 字典 | ✅ 已实现：`dataService:688` `missing_price: '缺价待补'`，L722 `ABNORMAL_TYPE_NAMES[item.type] || item.type` 生效。**异常列表页不再显示裸英文 `missing_price`。** |
| `authService.getStores` 支持 `includeInactive` | ✅ 已实现（不在本批次文件内）：`authService/index.js:318-321`；调用方 `pages/store-manage/store-manage.js:22` 传 `includeInactive: 1`。停用门店可在 UI 恢复。 |
| （顺带）`getOrderStats` 口径对齐 | ✅ 见 §2，**这条使 batch1 §5.12 结论过时** |

**缺口**：`getReportDetail:12-16` 的字典**同样缺 `missing_price`**，`3558678` 没改到 → 报表详情里缺价异常仍显示裸英文。属**同一缺陷修了一半**。

---

## 4. importProducts 逐段分析

### 4.1 鉴权与输入

- `MANAGEMENT_ROLES = ['super_admin','purchaser']`（L8），`requireUser(event, MANAGEMENT_ROLES)`（L83）✅ — **只有管理员能导入，chef/store_manager/supplier 全部 -403**。
- `event.fileID` 由客户端指定 → `cloud.downloadFile`（L92）。**无路径校验**：管理员可传任意已知 fileID。工号风险受控（与 batch1 §15.1 一致）。
- `.xlsx` 校验只在**前端**（`product-manage.js:133`）；服务端不校验扩展名/MIME。
- **⚠️ 无文件大小上限、无行数上限**（L86-100）。SheetJS 解析超大/畸形文件有 zip-bomb 与内存放大风险；云函数默认 256MB-2GB 内存、20s 超时。

### 4.2 模板与列映射（`HEADER_ALIASES` L11-19 + `mapHeader` L67-80）

| field | 别名 |
|---|---|
| `name` | 商品名称 / 品名 |
| `categoryL1` | 一级分类 |
| `categoryName` | 二级分类 / 分类 |
| `unit` | 单位 |
| `spec` | 规格 |
| `manufacturerName` | 厂家 / 厂家/品牌 / 品牌 |
| `supplierName` | 默认供应商 / 供应商 |

**容错能力实测**：
- ✅ **首尾空白**：`cellText`（L61-64）`String(v).trim()`。
- ✅ **列顺序无关**：按内容匹配列名，不依赖顺序。
- ✅ **同一 field 只取第一个命中列**（L73 `!colMap[field]`）。
- ✅ **空单元格**：`null`/`undefined` → `''`。
- ❌ **内部空白不容错**：`'商品 名称'`、`' 商品名称'` 中间的半角/全角空格不会被剥离 → 该列静默不识别。
- ❌ **全角括号/异体字不容错**：`'二级分类（必填）'` 不匹配 `'二级分类'`。
- ❌ **无大小写/繁简/英文别名**：`'Name'`、`'名称'`、`'Product'` 全部不识别。
- ❌ **首行必须是表头**：L99 取 `rows[0]`，若 Excel 有标题行/说明行则 `mapHeader` 失败 → 整批报错「表头不匹配」（**错误提示正确，但模板说明里没有警告**）。
- ⚠️ 必需列判定（L103）：`name` / `categoryName` / `unit`。注意 `get('categoryName')` 空值时仍会用 `categoryName=''` 去查分类 → L147 报「二级分类「」不存在」，而不是「二级分类为空」，**错误文案不准确**。

### 4.3 错误行处理策略

**逐行跳过 + 收集错误，整批不失败**（L141-168, L189-196）：

| 场景 | 行为 |
|---|---|
| 整行全空（name/unit/categoryName 皆空） | **静默跳过，不计入 errors**（L139 `continue`）—— 但计入 `total`（L201 `rows.length - 1`） |
| 商品名称为空 | `errors.push`，跳过 |
| 单位为空 | `errors.push`，跳过 |
| 二级分类不存在 | `errors.push`，跳过 |
| 一级分类填了但不匹配 | **静默降级**：L149-150 `if (byL1.length) candidates = byL1` — 不匹配时**不报错**，退回二级分类结果 |
| 同名同厂家（已存在或本批内重复） | `errors.push('已存在…跳过')` |
| 供应商名匹配不到 | `errors.push`，**但商品仍插入**（`default_supplier_id: ''`）—— 错误与成功同时发生 |
| 单条 `add` 抛异常 | `errors.push`，不中断（L193-195） |
| **全部行都错** | 返回 `{code:0, data:{total, inserted:0, failed:N, errors}}` — **HTTP 语义上仍是成功** |

- `errors.slice(0, 50)`（L204）截断展示，但 `failed: errors.length`（L203）是全量计数 ✅。
- 前端 `product-manage.js:144-146` 进一步只显示前 10 条 + 「…等共 N 条」✅。
- ⚠️ **错误行号准确**：`rowNo = i + 1`（L133），i 从 1 起（表头是第 1 行）→ 报出的「第 N 行」与 Excel 行号一致 ✅。
- ⚠️ **行号歧义**：`add` 失败时 `errors.push({ row: '-', msg: ... })`（L194）用 `'-'` 占位 → 前端渲染成「第-行」。

### 4.4 去重规则

- 键：`` `${product_name}|${manufacturer_name || '默认'}` ``（L125, L155）。
- **去重不含分类、不含单位、不含规格** → 「黄瓜|默认」已存在时，导入另一分类/另一单位的「黄瓜|默认」会被判为重复并跳过。
- **本批内自去重**：`seenKeys`（L129, L160）✅。
- ⚠️ **停用商品也参与去重**：L120 `db.collection('product').skip(offset).limit(BATCH).get()` **无 status 过滤** → 已停用的「黄瓜|默认」会挡住新导入。（与手工 `saveProduct` 完全不同——`saveProduct` 无任何去重，可以重复建。）**两条写入路径口径不一致。**

### 4.5 大文件 / 空文件 / 全错行表现

| 输入 | 表现 |
|---|---|
| 只有表头 | `rows.length < 2` → `{code:-1, msg:'表格为空…'}` ✅ |
| 空工作表 | L98 → `{code:-1, msg:'Excel 中没有工作表'}` ✅ |
| 非 xlsx / 损坏文件 | L93-96 catch → `{code:-1, msg:'文件下载或解析失败…'}` ✅ |
| **超大文件** | 无上限 → SheetJS 解析 + 逐条串行 `add`（L189-196）→ **必然超时**；**已写入部分不回滚**（无事务） |
| **全错行** | `{code:0, inserted:0, failed:N}` → 前端弹「成功 0 条 / 失败 N 条」，**不视为失败** |
| 重试幂等 | ✅ 已导入的命中 `existingKeys` 被跳过（L156-159），重试安全 |

- 全量商品分页拉取：`skip+limit(100)` 循环（L116-124）→ 商品 1 万条 = 100 次串行查询。
- 分类/供应商一次性 `limit(1000)`（L109-110）→ 超 1000 条会**静默漏匹配**。

### 4.6 导入会不会覆盖供应商已设的价格？

**不会，且不触及价格表。** 实测：
- 写入集合仅 `product`（L191），**全文无 `supplier_product_price` 的读或写**。
- 只 `add` 新行（L191），**从不 `update` 已有商品**（去重命中即 `continue`，L156-159）。
- `default_supplier_id` 只在新建行上设置（L164-168, L180）。
- 供应商已设的价格行**原封不动**；已存在商品**连 `default_supplier_id` 都不会被改写**。
- ⚠️ **间接影响值得记录**：`default_supplier_id` 决定下单时 `purchase_order_item.supplier_id` 取谁（`createPurchaseOrder` 重建快照），进而决定收货时查哪个供应商的协议价。**新增商品时的默认供应商选择会改变后续结算口径**，但这是「新商品定价归属」而非「覆盖已有价格」。

### 4.7 ⚠️ 本批次新发现：`importProducts` 没有外层 try/catch

`main(event)`（L82-207）**没有顶层 try/catch**，是唯一的一个。全文件只有两个局部 catch：L91-96（下载/解析）、L190-195（单条 add）。

后果链：分类集合缺失 / 数据库超时 / `XLSX.utils.sheet_to_json` 抛错之外的任何运行时异常 → 直接抛到 `exports.main` → `wx.cloud.callFunction` reject → 前端 `utils/cloud.js:72-74` catch → 返回
```js
{ code: -1, errorType: 'CLOUD_UNAVAILABLE', msg: 'CloudBase 服务连接失败，请稍后重试' }
```
**用户看到的文案与真实原因完全无关**（例如商品表字段异常会显示「服务连接失败」）。对比其余 19 个云函数均有顶层 catch。

---

## 5. 鉴权与返回风格矩阵

### 5.1 身份校验写法（6 个文件）

| 云函数 | 取会话 | 角色校验 | 顶层 `return {code:` | 嵌套 `return {error:` | 顶层 catch |
|---|---|---|---|---|---|
| `dataService` | `getSessionUser`（L17-43）+ `requireUser` helper（L45-52） | **helper 式**，角色以参数传入 | **106** | **2**（L47 `-401`、L49 `-403`） | ✅ L1555 |
| `importProducts` | 同上 + `requireUser` helper（L52-59） | **helper 式** | **5** | **2**（L54 `-401`、L56 `-403`） | ❌ **无** |
| `getProducts` | 内联（L41-42） | 内联 `isManager`（L44） | 4 | 0 | ✅ L62 |
| `getProductPrices` | 内联（L41-42） | 内联白名单（L46-52） | 5 | 0 | ✅ L85 |
| `updateProductPrice` | 内联（L68-69） | 内联白名单（L70） | 11 | 0 | ✅ L134 |
| `getSuppliers` | 内联（L41-42） | 内联 `isManager` + supplier 分支（L45-54） | 5 | 0 | ✅ L92 |

> 顶层返回计数与主控给的「dataService 81 处 / importProducts 5 处」略有差异（实测 dataService 106 处 `return { code:`）——**根因结论一致，计数口径不同**：嵌套的只有 2+2 = **4 处**，全部来自两个 `requireUser` helper 的 `-401`/`-403`。

**两套鉴权写法并存是根因**：16 个云函数用内联式（顶层返回），`dataService` / `importProducts` 用 helper 式。

### 5.2 嵌套错误如何到达客户端

```
requireUser 返回 { error: { code: -401, msg } }      dataService:47
        ↓
调用点  if (auth.error) return auth.error            dataService:56,84,… 共 22 处
        ↓
前端收到  { error: { code: -401, msg: '登录已过期，请重新登录' } }
        ↓
utils/cloud.js:68   if (result.code === -401) { handleSessionExpired() }
                    → result.code === undefined → undefined === -401 → false
                    → 不跳登录 ❌
        ↓
页面  if (result.code !== 0) return util.showToast(result.msg || '通用文案')
                    → undefined !== 0 → true；result.msg undefined
                    → 显示页面兜底文案，不是「登录已过期」 ❌
```

**影响面实测（`pages/` grep）**：`dataService` 共 22 个 action 全部走 `requireUser`，其中 **7 个 action 无角色参数**（getCategories / getMessages / markMessageRead / markAllMessagesRead / getAbnormalRecords / getOrderStats / markMessageRead），**15 个带角色参数**。前端调用点分布（`action: 'xxx'` 计数）：

| action | 调用次数 |
|---|---|
| getMessages | 4 |
| auditOrder | 4 |
| getCategories | 2 |
| verifyManualOrder / markMessageRead / markAllMessagesRead | 各 2 |
| 其余 15 个 action | 各 1 |

即 **会话过期 + 触碰任一 dataService 页面 = 100% 被 F1 命中**。`importProducts` 同理（`product-manage.js:140`，且它连顶层 catch 都没有）。

**注意 `-403` 同样被吞**：无权限操作（例如 chef 调 `saveProduct`）返回嵌套 `{error:{code:-403}}` → 前端显示「商品保存失败」而非「当前账号无权执行该操作」，用户不知道自己越权。

### 5.3 返回风格与错误码统一性核查

- 错误码：`-1` / `-401` / `-403` / `0`，6 个文件**完全一致** ✅。
- 除 helper 嵌套外，所有返回均为 `{ code, msg }` / `{ code, data }` / `{ code, data, msg }` 三种组合 ✅。
- `getProducts` / `getSuppliers` / `getProductPrices` 的「无权」返回：`getProducts:45` 与 `getSuppliers:54` 用 `-403`（`includeInactive` 越权），`getProductPrices:48,51` 也用 `-403`。✅ 口径一致。
- ⚠️ `dataService` 内部混用两种 -403 语义：
  - `requireUser` 层的 -403：「当前账号无权执行该操作」（helper，**嵌套**）
  - action 体内的 -403：「当前账号无权处理该门店异常」「账号未关联有效门店」「账号未关联供货商」「无权操作其他门店的采购订单」（**顶层**）
  → 同样是「无权限」，两种返回结构。前端对 action 体内的顶层 -403 **能正确识别**，对 helper 层的识别不了。

---

## 6. 软删除与有效性一致性核查

**判定标准**：`product.status` / `supplier.status` / `category.status` / `store.status` / `supplier_product_price.is_current` 在**所有读点**是否一致过滤。

| 读点 | 行 | 过滤口径 | 判定 |
|---|---|---|---|
| `getProducts` 商品列表 | 46-47 | `!includeInactive \|\| !isManager` → `status:1` | ✅ |
| `getProducts` categoryL1 / categoryId 过滤 | 48-51 | 与 status 条件叠加（同一 where） | ✅ |
| `getProducts` keyword | 56-59 | **内存过滤，作用在已截断的 200 条上** | ⚠️ 见问题清单 |
| `dataService.findCategory` | 84-88 | `category_id + status:1` | ✅ |
| `dataService.saveProduct` 默认供应商 | 100-104 | `supplier_id + status:1` | ✅ |
| `dataService.saveSupplier` 查重 | 155-158 | `supplier_name` **无 status 过滤** | ⚠️ 见下 |
| `dataService.saveSupplier` / `toggleSupplier` 取原行 | 163, 179 | `supplier_id` 无 status | ✅ 有意（否则无法恢复停用项） |
| `dataService.toggleProduct` 取原行 | 135 | `product_id` 无 status | ✅ 有意 |
| `dataService.getCategories` | 57-58 | `status:1` | ✅ |
| `getSuppliers` supplier 分支 | 47-50 | **无 status 过滤** | ⚠️ 见下 |
| `getSuppliers` 非 supplier 分支 | 58-59 | `status` 参数优先，否则 `!includeInactive \|\| !isManager` → `status:1` | ⚠️ **越权** 见问题清单 |
| `getSuppliers` product_count 反查 | 76-79 | `default_supplier_id in chunk` **无 status 过滤** | ⚠️ **停用商品也计入** |
| `getProductPrices` 价格查询 | 57-61 | **无 supplier/product status 过滤**，只有 `is_current` | ⚠️ 见下 |
| `updateProductPrice` 前置校验 | 90-95 | `supplier.status:1` + `product.status:1` | ✅ |
| `updateProductPrice` 事务内降版 | 107-110 | 按 (supplier,product,is_current:1)，不查 supplier/product 状态 | ✅（已在事务外校验） |
| `importProducts` 分类/供应商 | 108-111 | 均 `status:1` | ✅ |
| `importProducts` 去重取全量商品 | 120 | **无 status 过滤** | ⚠️ **停用商品挡住新导入**，且与 `saveProduct`（无去重）口径不一致 |
| `importProducts` 分类匹配 | 146-152 | 在已 `status:1` 的分类集合内匹配 | ✅ |
| `dataService.notifySuppliersNewOrder` 供应商名 | 310-313 | `supplier_id in` **无 status** | ⚠️ 停用供应商仍出现在消息里（合理，历史单） |
| `dataService.settleReceipt` / `regenerateReceiptReports` 供应商名 | 941-947, 1134-1138 | 无 status | ⚠️ 同上，可接受 |
| `dataService.getAbnormalRecords` 供应商名 | 713-717 | 无 status | ⚠️ 同上，可接受 |
| `dataService.updateProductPrice 的 expiry_date` | updateProductPrice:124 | **全项目 0 读取点** | ❌ 价格永不过期，见问题清单 |

### 6.1 三处明确的口径不一致

1. **`saveSupplier` 查重不含 status**（`dataService:155-158`）：`where({supplier_name}).limit(100)` 不筛 status → **已停用的供应商名称仍占用名称空间**，无法新建同名供应商。与 `importProducts` 去重不含 status 同理。是否有意属【待核实】，但从「停用=软删除、可恢复」的设计看，名称被停用项占用会导致**恢复一个停用供应商时报「该供应商名称已存在」**——因为查重是 `item.supplier_id !== event.supplierId`，恢复自身不算冲突，但**新建**确实被挡。

2. **`getProductPrices` 不过滤供应商/商品停用状态**（`:57-61`）：管理员可看到停用供应商、停用商品的协议价；但 `updateProductPrice:90-95` **拒绝**为停用供应商/商品新增价格 → **可以看到却改不了，且没有删除价格的端点** → 停用后的价格行永久残留（`is_current` 恒 1）。price-manage 页面传 `includeInactive: true`，所以这是**可见且有意的展示**，属设计取舍而非 bug，但「可读不可写不可删」需记录。

3. **`getProducts` 对 `chef` 放行、对 `supplier` 未做任何限制**（`:41-45`）：`getProducts` **完全没有角色白名单**，任何已登录角色（含 `supplier`）都能拉取全量启用商品目录。对比 `getProductPrices:51` 对 chef/store_manager 显式 -403。前端 `purchase-create`（供应商无法通过 UI 到达）是唯一调用方，但后端本身不设防。**当前 UI 不可达，属潜在面**。

---

## 7. 分页 / 筛选 / 排序保护核查

| 云函数 | 分页 | limit | 筛选字段白名单 | 未知字段处理 | 排序 |
|---|---|---|---|---|---|
| `getProducts` | ❌ **无分页、无 total** | **200** | `categoryL1` / `categoryId` / `keyword` / `includeInactive` | **忽略**（未解构即不生效） | `product_name asc`（L53） |
| `getSuppliers` | ❌ 无分页 | **100** | `status` / `keyword` / `includeInactive` | 忽略 | `supplier_name asc`（L66） |
| `getProductPrices` | ❌ 无分页 | **200** | `supplierId` / `productId` / `onlyCurrent` | 忽略 | `effective_date desc`（L59，同日期内无序） |
| `updateProductPrice` | 不适用 | — | `supplierId` / `productId` / `newPrice` / `effectiveDate` / `updatedBy` / `dryRun` | 忽略 | — |
| `importProducts` | ❌ 无（全量导入） | 无 | `fileID` | 忽略 | — |
| `dataService` | 各 action 内 `limit(100)` / `limit(1000)` 硬编码 | — | 各 action 自定 | 忽略 | 见各 action |

**结论**：
- ✅ **无「前端传什么后端都认」的注入面**：6 个文件全部用显式解构 + 白名单字段映射，未知字段一律被忽略（不报错、不进 where）。这比 batch1 记录的 `getReports`/`getPurchaseOrders` 的透传模式安全。
- ✅ **`status` 参数不做 0/1 白名单**（`getSuppliers:58`）是唯一的例外：`query.status = 任意值`。传 `status:'abc'` → 返回空数组（不报错、不泄露）；传 `status:0` → **绕过 includeInactive 校验并返回停用供应商**（这是真越权，见问题清单）。
- ❌ **三个列表接口全部无分页**：`getProducts` 200 / `getSuppliers` 100 / `getProductPrices` 200，且**都不返回 total** → 前端无法判断是否被截断。
- ⚠️ `getProducts.categoryId` 转 `Number`（`:50`）：传非数字字符串会得到 `NaN` 进 where，CloudBase 行为未定义。当前前端只传 picker 下标（数字），属潜在面。

---

## 问题清单

### 高

**H1 · dataService / importProducts 嵌套错误结构 → 会话过期不跳登录**
- `dataService/index.js:47,49` + `:56,84,…`（22 处 `if (auth.error) return auth.error`）；`importProducts/index.js:54,56,84`；消费端 `utils/cloud.js:68`
- 触发条件：会话过期（或无权限）时调用任意 dataService action 或 importProducts
- 影响：`utils/cloud.js:68` 只判顶层 `result.code`，收到 `{error:{code:-401}}` 时 `result.code === undefined` → **不触发跳登录**；页面显示兜底文案（如「商品保存失败」「异常处理状态更新失败」）而非「登录已过期」/「无权执行」→ 用户无感知地重复点击无效按钮；`-403` 同样被降级为通用文案，越权操作对用户不可见
- 建议：两个 `requireUser` 改为返回扁平 `{code,msg}`；或在 `utils/cloud.js:68` 同时判 `result.error?.code === -401` 并拍平返回

**H2 · getProducts 硬 limit(200) 且是下单选品主入口 → 商品超 200 条时chef无法下单**
- `getProducts/index.js:53`（`.limit(200)`）；`getProducts/index.js:56-59`（keyword 内存过滤）；调用方 `pages/purchase-create/purchase-create.js:129-131`（`includeInactive:false` 全量拉取后内存过滤）
- 触发条件：启用商品数 > 200
- 影响：**主下单流程的数据入口被静默截断**。`purchase-create` 拿不到第 201 条以后的商品 → chef 无法选择、无法下单；且**无 total、无分页、无任何报错**，用户看到的就是「商品找不到」。关键词搜索只在前 200 条里搜（L56-59），第 201 条以后的商品连搜都搜不到
- 建议：加分页 + total；关键词下推到 DB（`db.RegExp`，并注意转义）；至少让下单页支持分页加载

### 中

**M1 · getSuppliers `status` 参数无权限校验 → 越权查看停用供应商联系人**
- `getSuppliers/index.js:58`：`if (status !== undefined && status !== null && status !== '') query.status = status`
- 触发条件：任意非 manager 角色传 `status: 0`（**绕过了 L54 的 `includeInactive` 校验**）
- 影响：chef/store_manager/supplier 可查看**已停用供应商的完整档案（含 contact_name / contact_phone）**。与 `getProducts:45-47` 的正确写法（`includeInactive && !isManager` → -403）不一致
- **当前 UI 不可达**：grep 全部 `getSuppliers` 调用点（product-manage:33、price-manage:34、supplier-manage:22、user-manage:37）**均不传 status**，keyword 也都不传 → 属后端潜在面，但后端是唯一防线
- 建议：`status` 限定 `{0,1}`，且非 manager 强制 `status:1`

**M2 · getSuppliers keyword 正则注入**
- `getSuppliers/index.js:61`：`query.supplier_name = db.RegExp({ regexp: keyword, options: 'i' })`
- 触发条件：传任意字符串作为 keyword（如 `.*`、回溯爆炸型正则）
- 影响：正则由客户端原样进入 DB 查询，可造成慢查询 / DoS。**当前 UI 不可达**（supplier-manage:30-33 在内存过滤，不传 keyword）
- 建议：转义特殊字符或改用 `like`

**M3 · importProducts 无外层 try/catch**
- `importProducts/index.js:82-207`（`main` 函数无顶层 try/catch；全文件仅 L91-96、L190-195 两个局部 catch）
- 触发条件：分类/商品集合异常、DB 超时、`sheet_to_json` 之外的任何运行时错误
- 影响：异常抛到 `callFunction` reject → `utils/cloud.js:72-74` → 用户看到「**CloudBase 服务连接失败，请稍后重试**」，与真实原因无关。是 20 个云函数中**唯一没有顶层 catch 的**
- 建议：补顶层 try/catch 返回具体文案

**M4 · importProducts 无文件大小/行数上限 + 逐条串行 add + 无事务**
- `importProducts/index.js:92-99`（无上限）、`:189-196`（逐条 `add`）、`:116-124`（全量商品 100 条/页串行拉取）
- 触发条件：上传几百行以上的 Excel
- 影响：必然超时；**已写入部分不回滚**（无事务）；超时后前端只显示「导入失败」（product-manage:153）而**实际上已导入一半**，用户重试才能靠幂等补齐。`errors.slice(0,50)`（L204）也会漏报
- 缓解：去重键幂等（L156-159）使重试安全 ✅
- 建议：限制行数上限（如 500）+ 提示分批；或后端批量写入

**M5 · 三个列表接口无分页且 limit 静默截断**
- `getProducts/index.js:53`（200）、`getSuppliers/index.js:67`（100）、`getProductPrices/index.js:60`（200）
- 触发条件：商品 >200 / 供应商 >100 / 当前价 >200
- 影响：全部静默截断、无 total、无报错。getProductPrices 因 `orderBy('effective_date','desc')` 在同日期内无序，**截断后丢的是哪 200 条不确定**
- 建议：统一分页 + total

**M6 · repriceReceipt / createReceipt 取价 limit(100) 截断 → 误报缺价**
- `dataService/index.js:1055-1058`（与 batch1 §4.7 的 createReceipt 同款）
- 触发条件：单次补价涉及的商品里，某 20 个商品 chunk 的全部供应商当前价 > 100 条
- 影响：部分供应商价格被静默漏取 → `priceMap` 缺键 → 该行仍判为「缺价」→ 返回 `stillMissing`，**管理员以为要再补价，实际价格表里已经有了**
- 建议：按 `product_id + supplier_id` 精确过滤，或提 limit

**M7 · settleReceipt 无事务、无条件更新 → 并发重复补结算**
- `dataService/index.js:889-895`（查重）→ `:969-978`（写库），两者之间无事务
- 触发条件：管理员并发点击两次「补结算」
- 影响：两个请求都通过 L893 的 `report_id endsWith(receiptId+'_S')` 检查 → **各生成一份 `_S` 账单 → 供应商被双份计费**
- 建议：条件更新兜底（参照 `verifyManualOrder:1466-1477` 的写法）

**M8 · 价格无精度约束，价格表可存 >2 位小数**
- `updateProductPrice/index.js:76-78`（只校验 `Number.isFinite && > 0`，不舍入）；前端 `price-manage.js:127,200`（`parseFloat`，不限制小数位）
- 触发条件：输入 `9.999`
- 影响：`supplier_product_price.price = 9.999` 落库；`getProductPrices` 原样下发；`normalizePrice` 不格式化；而全项目金额公式统一为 `Math.round(x*100)/100`（元、2 位小数）→ **价格表显示 9.999、结算用 9.99**，前端 `supplier-prices.js:46` 用 `.toFixed(2)` 显示成 10.00，**与库里的 9.999 不一致**
- 建议：服务端 `Math.round(price*100)/100`

**M9 · `expiry_date` 恒 null 且全项目 0 读取点 → 价格永不过期**
- `updateProductPrice/index.js:124`（写 `expiry_date: null`）；grep 全项目 `expiry_date` **仅 1 个写入点、0 个读取点**
- 触发条件：供应商协议价到期但无人手动调价
- 影响：旧价格永久生效，`is_current` 恒 1，收货一直按旧价结算
- 建议：要么删字段，要么在取价处加过期判断

**M10 · updateProductPrice `price_id` 无随机后缀**
- `updateProductPrice/index.js:103`：`'PRC_' + Date.now()`
- 触发条件：同毫秒并发调价
- 影响：事务保证不会出现两条 current，但 **`price_id` 会重复**，破坏全项目 ID 唯一性约定（其余 5 处 ID 生成均带 `crypto.randomBytes`）
- 建议：加 `crypto.randomBytes(3).toString('hex')`

**M11 · importProducts 分类匹配歧义未消除**
- `importProducts/index.js:146-152`
- 触发条件：同名二级分类跨多个一级分类，且导入行未填一级分类
- 影响：`candidates[0]` 取数据库返回顺序第一条 → **商品可能挂到错误的一级分类**，且无任何提示
- 另注：L149-150 一级分类填了但不匹配时**静默降级不报错**
- 建议：歧义时显式报错要求补一级分类

### 低

**L1 · `getNextVersion` 读回竞态 → 同版本号重复**
- `dataService/index.js:361-378`
- 触发条件：两个并发报表生成同时 inc 后读回
- 影响：`report_file.file_version` 在同一 (report_type, scope_id, related_date) 下重复、且跳过某个版本号；云存储路径含单号不冲突，仅影响展示
- 建议：`inc` 后用 `stats` 返回值而非二次 get

**L2 · getReportDetail 字典仍缺 `missing_price`（跨批次，`3558678` 漏改）**
- `getReportDetail/index.js:12-16`（对照 `dataService:683-689` 已补）
- 影响：报表详情里缺价异常仍显示裸英文 `missing_price`
- 建议：同步补上

**L3 · `regenerateOrderReports` 不可达**
- `dataService/index.js:988`（定义）、`:1548`（分发）；全项目 grep 无任何前端调用点，仅 `createPurchaseOrder/index.js:436` 一处**注释**指望它
- 影响：**订货报表 ①② 生成失败后没有补生成入口**，只有收货报表有 `regenerateReceiptReports`（receive-list:146）→ 与文档声称的「已闭环」不符
- 建议：前端补按钮，或删除该 action

**L4 · `requestCancel` 与 `cancelOrder` 能力不对齐**
- `dataService/index.js:1348`（允许 `partial_received`/`to_receive`）vs `:1294`（明确拒绝这两态）
- 触发条件：管理员对已有收货记录的订单申请取消
- 影响：申请成功（返回 `{code:0}` + 站内消息），但**永远无法执行**；`cancel_requested: true` 标记残留，且 L1358 的条件更新会让重试也拿不到「该单已有收货记录」这类明确提示
- 建议：`requestCancel` 的白名单与 `cancelOrder` 对齐

**L5 · 角色常量同值冗余 + 三处内联字面量**
- `dataService/index.js:8` 与 `:9`（`GLOBAL_ROLES` == `MANAGEMENT_ROLES`）；`:735,751,803` 内联 `['store_manager','purchaser','super_admin']`；`:1384` 内联含 chef
- 影响：改名风险 → 静默权限漂移；「异常处理权限」与 `VOUCHER_SUBMIT_ROLES` 实为同一组角色却用不同表达
- 建议：合并为少数几个语义清晰的常量

**L6 · `markMessageRead` 不做可见集复查**
- `dataService/index.js:651-653`
- 触发条件：供货商拿到某条 `store_id:''` 且 `recipient_user_id:''` 消息的 `_id`
- 影响：可越权标记其已读。实际影响极小：`read_by` 是按用户记录，写入只影响自身已读态；且 `getMessages` 对 supplier 已强制 `scope_type='supplier'`。真正的暴露面是**给 supplier 定向的消息被 supplier 标记已读**（本就属于他们）
- 建议：加 scope_type 复查

**L7 · `startAbnormal` 等对不存在的 `_id` 抛异常而非 404**
- `dataService/index.js:738-739, 757-759, 807-809, 647-649`（`doc(id).get()` 在文档不存在时抛错，`if (!result.data)` 永不成立）
- 影响：跨门店探测任意 `_id` 得到「CloudBase 数据操作失败，请稍后重试」而非明确 404/403。权限仍被 L740/760/810 拦住（**无越权**），仅错误文案质量差
- 建议：包 try/catch 返回明确文案

**L8 · `getSuppliers` supplier 分支不做 status 过滤**
- `getSuppliers/index.js:47-50`
- 影响：低。`authService.login` 的 `findSupplier`（status:1）已拦住停用供货商登录，所以正常路径不可达

**L9 · `getSuppliers` 的 `product_count` 计入停用商品**
- `getSuppliers/index.js:76-79`（`product.where({default_supplier_id: in chunk})` 无 status 过滤）
- 影响：与 `getProducts`（默认 `status:1`）口径不一致 → 停用商品仍算在该供应商名下；且 limit 1000 会在 >1000 商品时截断

**L10 · `getProductPrices` 可读不可写不可删**
- `getProductPrices/index.js:57-61`（无 status 过滤）vs `updateProductPrice/index.js:90-95`（要求 status:1）
- 影响：停用供应商/商品的价格可见但无法更新、无删除端点 → `is_current:1` 永久残留

**L11 · `importProducts` 表头行位置不容错 + 二级分类空值文案不准确**
- `importProducts/index.js:99,102`（首行必须是表头）；`:147`（空分类报「二级分类「」不存在」而非「为空」）
- 影响：模板说明（product-manage:162）未提示「第一行必须是列名」；错误文案误导

**L12 · `auditOrder` 的 `qtyChanged` 判定 `>= 0` 宽松**
- `dataService/index.js:577`：`approvedQty >= 0 && approvedQty !== order_qty`，而 L525 的校验要求 `qty > 0`
- 影响：L520-527 已拒绝 `<=0` 与 NaN，所以此处实际不可触发。属冗余但不一致的写法

**L13 ·【待核实】`where({$or: [...]})` 字面量**
- `dataService/index.js:1414-1417`
- **全项目 grep `$or` 仅 1 处命中**（其余 15+ 处全部用 `_.or([...])`）
- 若 SDK 不识别 `$or` 字面量 → 退化为查询文档中真的存在 `$or` 字段 → 匹配 0 条 → `updated===0` → 催审对所有订单静默失效（用户总是收到「已催办过，请 1 小时后再试」）
- 缓解：L1405 的非条件更新预检已能拦住大部分重复催审
- **需实测**：本仓库无 `node_modules`，无法离线验证 SDK 行为

**L14 ·【待核实】`transaction.rollback(data)` 参数语义**
- `dataService/index.js:539`（`rollback({code:-1, msg:'该订单已经审核…'})`）→ `:561`（`err.errMsg.includes('该订单已经审核')` 依赖该参数进入 errMsg）
- 影响：功能不受影响（仍能拦住重复审核），仅影响用户看到的文案
- **需实测**

**L15 · 多处 `limit(1000)` 静默截断**
- `dataService/index.js:508`（审核取明细）、`:903,921`（补结算取明细）、`:1043`（补价取明细）、`:1117`（补生成取明细）
- 影响：单笔订单明细 >1000 行时静默截断。与 `createPurchaseOrder` 的「明细数 ≤ 100」校验（L210）相比**不可能触发**，属防御冗余

**L16 · `verify_amount` 未做 2 位小数舍入、无上限**
- `dataService/index.js:1509-1515`（`Number(event.amount)` 直接落库）
- 影响：传 `123.456` 落库即 123.456；全项目其余金额统一 `Math.round(x*100)/100`。且**不与任何订单金额比较**（手动单本身无价格，属设计内）
- 建议：舍入到 2 位

**L17 · `getProducts.categoryId` 非数字时 `NaN` 进 where**
- `getProducts/index.js:49-51`：`Number(categoryId)` 未校验
- 触发条件：传非数字字符串。当前前端只传 picker 下标，不可达

**L18 · `saveProduct` 不做同名去重，`importProducts` 去重但含停用项 → 两条写入路径口径不一致**
- `dataService/index.js:118-129`（无查重）vs `importProducts/index.js:155-159`（查重且含停用商品）
- 影响：同一商品可经手工表单重复创建；批量导入却会被停用项挡住

**L19 · `product_id` 随机后缀长度不一致**
- `dataService/index.js:125`（`randomBytes(3)` → 6 hex）vs `importProducts/index.js:172`（`randomBytes(4)` → 8 hex）
- 影响：无功能影响（无唯一索引、无解析逻辑），仅 ID 格式不统一

**L20 · `markAllMessagesRead` N+1 查询**
- `dataService/index.js:672-678`：每条消息一次 get + 一次 update，100 条 = 200 次 DB 操作
- 影响：量大时可能触发 20s 超时
- 建议：改为 `where` + 批量 update

---

## 跨批次待核实项

| # | 要确认什么 | 去哪里找 |
|---|---|---|
| 1 | **getProducts 截断的实际影响**：商品目录当前规模是否逼近 200？下单页是否需要分页？ | `pages/purchase-create/purchase-create.js:129-131`（全量拉取 + 内存过滤）；`seed-data/product.json` 当前条数 |
| 2 | **供应商角色能否经 UI 到达 getProducts** | `pages/purchase-create/purchase-create.js:37`（`authGuard.requireLogin()` 只查登录不查角色）；`pages/supplier-home/*` 的跳转列表；`app.json` tabBar |
| 3 | **`where({$or})` 是否被 SDK 识别** | 需真机/云环境实测 `dataService` `remindAudit`（`dataService:1414`）。本仓库无 `node_modules`，无法离线验证 |
| 4 | **`transaction.rollback(data)` 参数是否进入 `err.errMsg`** | 同上，实测 `auditOrder` 并发审核 |
| 5 | **前端是否统一按 `result.code !== 0` 判定**（决定 H1 的实际危害） | 已确认 `utils/cloud.js:68` 只查顶层 `result.code`；需逐页确认是否有页面自己查 `result.error`（controller F1 声称 57 个 callFunction 调用点无一查 `.error`，本批次复核 product-manage:216,243 / supplier-manage:82,109 / price-manage:142,162,217 均为 `result.code !== 0` + `result.msg` 兜底，**一致**） |
| 6 | **`saveSupplier` 名称查重含停用项是否符合预期** | `dataService:155-158`；确认产品口径「停用供应商的名称是否可被复用」 |
| 7 | **价格过期策略**：是否要启用 `expiry_date` | `updateProductPrice:124`（恒 null）；`业务模糊点确认清单.md` 中 #10「收货日价口径」相关条目 |
| 8 | **getReportDetail 字典补 `missing_price`** | `getReportDetail/index.js:12-16`（`3558678` 只补了 dataService，漏了这一处） |
| 9 | **订货报表补生成入口** | `pages/report-list/report-list.js`（当前只挂 `regenerateReceiptReports`）；`dataService:988` 不可达 |
| 10 | **price-manage 的价格精度展示** | `pages/price-manage/price-manage.js:127,200`（`parseFloat` 不限制小数位）；`pages/supplier-prices/supplier-prices.js:46`（`.toFixed(2)` 显示，与库里 9.999 不符） |
| 11 | **importProducts 行数上限** | `pages/product-manage/product-manage.js:132-155`（无大小/行数限制，超时会误导用户） |
| 12 | **`receipt.missing_reports` 是否有 UI 消费点** | `createReceipt:706` 写入、**全项目无清除点**；需确认收货单详情是否展示该标记 |

---

## 附：本批次对 batch1 / controller 的修正与确认汇总

**确认成立（无需改动 batch1）**：§14 updateProductPrice 全部结论、§15 importProducts 全部结论、§18.1 / §18.4 / §18.9 的截断与注入结论、§5.7 / §5.8 / §5.9 / §5.10 / §5.11 / §5.5 / §1.7 / §1.8 全部结论、§4.11 `receipt.missing_reports` 无清除路径、§20.6 `expiry_date`/`currency` 孤儿字段。

**需要作废/更新 batch1**：
1. **§5.12 `getOrderStats` 的 `received` 口径已过时**（batch1 L844 记为 `order_status='received' && verify_status !== 'pending'`）→ `3558678` 已改为仅 `order_status: 'received'`（当前 L846）。
2. **§12.6「getReportDetail 字典缺 missing_price」** 部分作废：`dataService` 侧已修（当前 L688），**getReportDetail 侧未修**。

**需要向主控纠正的跨批次结论**：
1. 「`dataService:552 order_status: event.status` 原样写库无枚举校验」→ **错误**。L485 已有 `['approved','rejected']` 枚举校验，且事务内 L538 二次复查。
2. 「`requestCancel:1348` 与 `cancelOrder:1294` 白名单不一致」→ **成立**，但性质是「申请链路允许的状态在执行链路被拒绝」（L1348 含 `partial_received`/`to_receive`，L1294 明确拒绝这两态）→ **申请成功但永远无法执行**，严重度中低。
3. 主控给出的「dataService 81 处顶层返回」实测为 **106 处** `return { code:`（嵌套 2 处）；`importProducts` 5 处顶层 + 2 处嵌套 ✅ 与主控一致。**根因结论（两套鉴权写法并存）完全成立。**
4. 主控提到 dataService 有「27 个 action」→ 实测分发表现为 **22 个 case**（`dataService:1531-1552`）。
