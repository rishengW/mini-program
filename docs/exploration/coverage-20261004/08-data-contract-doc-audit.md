# 08 · seed-data 数据契约 + 文档审计（coverage-20261004 第 08 号代理）

> **范围**：`seed-data/` 16 文件逐行全读 · 根目录 7 份文档（README / log / review / 业务模糊点确认清单 / 修复计划-2026-10-03 / 审查报告-2026-09-30 / 采购流程图.html）全读 · `docs/exploration/` 31 份历史勘探报告（15,982 行）扫读统计 · 云函数↔seed 字段与枚举交叉核对 · 文档声明抽查验证 · 敏感信息暴露清单。
> **代码基线**：分支 `backup` @ `07b6461`（最近提交 `fix(supplier): restrict order visibility and actions until internal approval`）。
> **方法**：字段名逐个用 Grep 在 `cloudfunctions/`（20 个云函数）与 `utils/` 查证引用次数；文档声明逐条落到具体 `文件:行号` 验证代码真实状态。
> **只读声明**：仅写入本文件；未修改任何业务代码、未执行任何 git 写操作（仅 `git ls-files` 只读查询）。
> **与既有报告的关系**：与 `deep-20261004/08-data-contract-and-doc-audit.md`（475 行，基线 `a1f7944`）、`rescan-20261004-R2-data-contract.md`（805 行）主题重叠。本报告不重复其字段差集长表，只做**独立复验 + 增量发现**：D3 抽查验证 18 条、D4 流程图 3 处状态窗口不符、D5 敏感信息逐条行号、以及「代码写了但 seed 缺」的运行期字段全景计数。凡与既有结论一致处标注「复验一致」。

---

## 结论摘要

1. **seed-data 是一份「静态演示切片」，不是「可运行态快照」**：13 个集合 + 1 个孤儿 jsonl，82 条记录、136 个字段名。代码在运行期实际写入的字段约 **70 处是 seed 完全没有的**（`purchase_order` 单集合就缺 27 个：`verify_*`/`cancel_*`/`audited_*`/`supplier_confirmations`/`missing_reports`…）。seed 导入后**无法演示**凭证核销、补结算、改量重发、供应商确认、驳回重传这五条链路。
2. **枚举覆盖是最严重的测试盲区**：`order_status` 代码判定 11 个值，seed 只造了 3 个（`submitted`/`approved`/`received`）；`receipt_status` 只造 `completed` 无 `abnormal`；`abnormal_record.status` 4 态只造 `pending`；`abnormal_record.type` 4 型只造 `shortage`；`report_file.status` 3 值只造 `generated`。**任何拿 seed 跑的回归都无法命中异常链路。**
3. **代码里存在 3 个「判定了但从未被写入」的死状态**：`report_generated`、`to_receive`、`pending_approval` 在 7 处白名单/查询条件里被判定，但全库**无任何写入点**。这既是 P2-19/L19 未落实的证据，也意味着 `getPurchaseOrders` 的「待收货」虚拟筛选、`confirmSupplierOrder` 的确认/发货窗口、`authService` 的在途订单统计都建立在一个永不出现的值上。
4. **文档声明抽查 18 条：13 条属实，3 条未落实，1 条已回退/未同步，1 条表述与实现不符**。未落实的三条集中在「清会话」「PRC 随机后缀」「供应商停用校验」——都是安全项；已回退的一条（业务清单 #22「必须收齐才能核销」）是**拍板口径在代码里被放宽了但文档没跟上**，属于业务风险。
5. **敏感信息 13 项，其中 2 项是硬伤**：`seed-data/app_user.json:1-5` 与 `seed-data/supplier_test_user.jsonl:1` 共 6 条 PBKDF2 凭据材料（salt+hash+120000 次迭代）仍在版本库，且 `.gitignore:8` 声明忽略 `seed-data/` 但 `git ls-files seed-data/` 实际返回 **15 个文件**——声明与追踪状态矛盾，`seed-data/README.md:23` 声称的「新初始口令不再写入仓库」只做到了「不再写明文」，哈希仍在库。另：U004 存在**两份互相冲突的 salt/hash**（app_user.json:5 vs supplier_test_user.jsonl:1），导入顺序决定供货商测试账号能否登录。
6. **历史勘探盲区**：31 份报告（15,982 行）覆盖了 19 个云函数、26 个页面、14 个集合，但**从未有报告完整走过 `采购流程图.html` 的逐泳道节点核对**（最接近的一次只做了「状态词频抽样」，见 deep-20261004/08 §8）——本报告 D4 由此补出 3 处状态窗口不符。此外 `utils/meta.js` 的状态字典与 `styles/`、`assets/` 的实际消费关系、以及 `scripts/` 目录的内容，在任何一份报告中都没有被展开。

**级别约定**：P0 资金/凭据 · P1 链路不可达或权限 · P2 契约漂移/测试盲区 · P3 卫生。

---

## A. seed-data 数据契约

### A.1 集合清单与规模

| # | 集合 | 文件 | 格式 | 记录数 | 字段数 | 主键假设 |
|---|---|---|---|---|---|---|
| 1 | `store` | store.json | NDJSON | 3 | 6 | `store_id`（建议唯一索引） |
| 2 | `app_user` | app_user.json | NDJSON | 5 | 13(+1) | `user_id`；`username`（建议唯一索引） |
| 3 | `category` | category.json | NDJSON | 12 | 8 | `category_id`（number） |
| 4 | `supplier` | supplier.json | NDJSON | 6 | 8 | `supplier_id` |
| 5 | `product` | product.json | NDJSON | 12 | 12 | `product_id` |
| 6 | `supplier_product_price` | supplier_product_price.json | NDJSON | 12 | 11 | `price_id` |
| 7 | `purchase_order` | purchase_order.json | NDJSON | 3 | 10 | `purchase_order_id`（`order_no` 同值冗余） |
| 8 | `purchase_order_item` | purchase_order_item.json | NDJSON | 9 | 11 | `item_id` = `{单号}_{行序}` |
| 9 | `receipt` | receipt.json | **缩进单对象** | 1 | 8 | `receipt_id` |
| 10 | `receipt_item` | receipt_item.json | NDJSON | 3 | 13 | `receipt_item_id` = `{收货单号}_{行序}` |
| 11 | `report_file` | report_file.json | **JSON 数组** | 11 | 13 | `report_id` |
| 12 | `message` | message.json | NDJSON | 3 | 9 | `message_id` |
| 13 | `abnormal_record` | abnormal_record.json | NDJSON 单行 | 1 | 13 | `abnormal_id` |
| 14 | —（无集合） | supplier_test_user.jsonl | JSONL | 1 | 14 | `user_id`（与 #2 的 U004 冲突） |
| | | README.md / product-import-template.md | — | — | — | 说明文档 |

**合计 82 条记录、136 个字段名（去重）。** 三种文件格式并存（NDJSON / JSON 数组 / 缩进单对象）—— 复验一致（R2 §5.1、deep-20261004/08 §2.1）。运行时另有 `report_version_counter` 集合无 seed（README 已说明由云函数自建）。

### A.2 逐集合字段契约（类型 · 示例 · 枚举值域）

**`store`**（6）
`store_id`(S,`S001`) · `store_name`(S,`中关村旗舰店`) · `store_code`(S,`S001`，恒等于 store_id) · `status`(I,`1`/`0`) · `created_at` · `updated_at`(datetime 字符串)
枚举：`status` ∈ {1 启用, 0 停用}。

**`app_user`**（13 + `default_supplier_id` 仅 U004）
`user_id`(S,`U000`) · `username`(S,`admin`) · `name`(S,`超级管理员`) · `mobile`(S,`13900000000`) · `role`(S) · `role_label`(S) · `default_store_id`(S,可为`""`) · `default_supplier_id`(S,仅 supplier 角色) · `status`(I) · `password_salt`(hex32) · `password_hash`(hex64, PBKDF2-SHA256) · `password_iterations`(I,`120000`) · `created_at` · `updated_at`
枚举：`role` ∈ {`super_admin`, `chef`, `store_manager`, `purchaser`, `supplier`}（5/5 全覆盖）；`role_label` 对应 `超级管理员`/`门店下单人员`/`店长`/`管理员`/`供货商`；`status` ∈ {1,0}（**只造 1，无停用样本**）。

**`category`**（8）
`category_id`(I,`1`) · `category_level_1`(S) · `category_level_1_name` · `category_level_1_icon` · `category_name` · `sort_no`(I) · `icon`(S,可为`""`) · `status`(I)
枚举：`category_level_1` ∈ {`kitchen` 后厨, `front` 前厅}（2/2）；12 个二级分类。

**`supplier`**（8）
`supplier_id`(`SUP001`) · `supplier_name` · `contact_name`(`刘师傅`) · `contact_phone`(`13800010001`) · `address`(S,`北京市朝阳区农产品批发市场 A 区 12 号`) · `status`(I,`1`/`0`) · `created_at` · `updated_at`

**`product`**（12）
`product_id`(`P001`) · `product_name` · `category_level_1` · `category_level_2_id`(I,→`category.category_id`) · `category_name` · `unit`(`棵`/`斤`/`瓶`) · `spec`(S) · `default_supplier_id`(→`supplier`) · `manufacturer_name`(`默认`/`海天`/`金龙鱼`) · `status`(I) · `created_at` · `updated_at`
注：`P099`/`SUP006` 是唯一的停用样本对（`status:0`）。

**`supplier_product_price`**（11）
`price_id`(`PRC001`) · `supplier_id` · `product_id` · `price`(F,`3.5`) · `currency`(S,恒`CNY`) · `effective_date`(`2026-07-01`) · `expiry_date`(S 或 `null`) · `is_current`(I,`0`/`1`) · `updated_by`(`system`) · `created_at` · `updated_at`
`P001` 两行（`PRC001` 历史价 + `PRC002` 现价）构成唯一的历史档样本。

**`purchase_order`**（10）
`purchase_order_id`(`PO20260806001`) · `order_no`（同值） · `store_id` · `store_name` · `order_date`(`2026-08-06`) · `created_by`(`U001`) · `order_status`(S) · `remark` · `created_at` · `updated_at`
枚举：`order_status` 实际只出现 3 值 —— `submitted`/`received`/`approved`。**代码判定 11 值，覆盖率 27%。**

**`purchase_order_item`**（11）
`item_id`(`PO20260806001_1`) · `purchase_order_id` · `product_id`(可为 `MANUAL_001`) · `product_name_snapshot` · `category_snapshot`(`后厨-蔬菜`) · `unit_snapshot` · `supplier_id`(可`""`) · `order_qty`(I) · `is_manual`(B) · `remark` · `created_at`
`PO20260806001_4` 是唯一手动行样本（`is_manual:true, supplier_id:""`）。

**`receipt`**（8）
`receipt_id`(`RCP20260805001`) · `purchase_order_id` · `store_id` · `store_name` · `receipt_date` · `received_by`(`U002`) · `receipt_status`(`completed`) · `created_at`
枚举：`receipt_status` 代码值域 {`completed`, `abnormal`}，seed 只造 `completed`（**1/2**）。

**`receipt_item`**（13）
`receipt_item_id` · `receipt_id` · `purchase_order_item_id` · `product_id` · `product_name` · `supplier_id` · `received_qty`(I) · `order_qty_snapshot`(I) · `unit_snapshot` · `price_snapshot`(F) · `payable_flag`(B) · `remark` · `created_at`

**`report_file`**（13）
`report_id`(`RPT_SO_PO20260806001`) · `report_type` · `report_scope` · `scope_id` · `scope_name` · `related_date` · `source_order_id` · `file_name` · `file_url`(全`""`) · `file_version`(I,`1`) · `generated_at` · `generated_by_system`(B,`true`) · `status`(S)
枚举：`report_type` 出现 6 值（store_order_report / supplier_order_report / store_receipt_report / store_receipt_price_report / supplier_receipt_report / supplier_receipt_price_report）—— **6/6 全覆盖，是 seed 枚举覆盖最好的一处**；`report_scope` ∈ {`store`,`supplier`}（2/2）；`status` 只造 `generated`（代码 3 值：`generated`/`pending`/`superseded`，**1/3**）。

**`message`**（9）
`message_id`(`MSG20260806001`) · `type` · `title` · `content` · `biz_id` · `recipient_user_id`(可`""`，空=广播) · `store_id` · `read`(B) · `created_at`
枚举：`type` ∈ {`order`, `receive`, `abnormal`}（seed 3/3，但代码写 `type` 的位置另有 `cancel` 等值）。

**`abnormal_record`**（13）
`abnormal_id`(`ABN20260805001`) · `receipt_id` · `purchase_order_id` · `product_id` · `supplier_id` · `store_id` · `store_name` · `type` · `description` · `status` · `resolution`(`""`) · `created_at` · `updated_at`
枚举：`type` 代码值域 {`shortage`, `quality`, `wrong_item`, `missing_price`}，seed 只造 `shortage`（**1/4**）；`status` 代码值域 {`pending`→`processing`→`resolved`→`closed`}（4 态），seed 只造 `pending`（**1/4**）。

**外键关系（全部有向，无悬空）**

```
store ─┬─< purchase_order.store_id / receipt.store_id / app_user.default_store_id / message.store_id / abnormal_record.store_id
       └─< report_file.scope_id(report_scope='store')
supplier ─┬─< product.default_supplier_id / purchase_order_item.supplier_id / receipt_item.supplier_id
          ├─< supplier_product_price.supplier_id / app_user.default_supplier_id
          └─< report_file.scope_id(report_scope='supplier')
category ──< product.category_level_2_id
product ───< purchase_order_item.product_id / receipt_item.product_id / supplier_product_price.product_id
purchase_order ─< purchase_order_item.purchase_order_id / receipt.purchase_order_id /
                 abnormal_record.purchase_order_id / report_file.source_order_id / message.biz_id
receipt ────< receipt_item.receipt_id / abnormal_record.receipt_id / report_file.source_order_id / message.biz_id
purchase_order_item ─< receipt_item.purchase_order_item_id
app_user ──< purchase_order.created_by / receipt.received_by
abnormal_record ──< message.biz_id
```

**外键完整性复验（与 deep-20261004/08 §3.1 一致）**：13 个方向的引用全部命中，无悬空。`report_file.source_order_id` 同时指向订单与收货单，靠 `report_type` 区分（这本身是类型不安全的设计，seed 与代码同病）。

---

## B. 根目录文档

| 文档 | 行数 | 定位 | 时效性结论 |
|---|---|---|---|
| README.md | 120 | 角色/权限/业务口径/部署清单 | **维护最好**，2026-09-28 安全加固、S9 口径、#10–#24 拍板均已同步 |
| log.md | 121 | 版本日志 17-12 → 17-15（2026-03-21 → 09-24） | **过期**：停在 17-15，缺 09-28 安全加固与 10-03/10-04 的 B1–B6 批次 |
| review.md | 90 | 17-12 UX 审查记录 | **严重过期**：`canReceive` 白名单已失效（见 D3-18） |
| 业务模糊点确认清单.md | 796 | B1–B12 / S1–S9 / #1–#24 决策留痕 | 27 章 + 索引表；索引表已更新，**3 处章节正文未同步**（见 D3-11/12/13） |
| 修复计划-2026-10-03.md | 196 | 6 批次 × 139 项修复路线 | 编制基线 `e2b364b`；含 5 条待拍板疑问点 |
| 审查报告-2026-09-30.md | 856 | 153 项缺陷 + §6 声明核查 + §8 验收清单 | 基线 `0c535ba`；§8.2 给 7 条对账等式、§8.4 云端核对表（唯一无法代码侧验证的部分） |
| 采购流程图.html | 311 | 四泳道流程图（门店/管理员/供货商/系统） | 2026-09-28 版；**3 处状态窗口与代码不符**（见 D4） |

**合计 7 份、2,490 行**（另有 `seed-data/README.md` 41 行）。

### B.1 业务模糊点确认清单：结构、未决、已决

- **结构**：第一部分通用（B1–B12 对应 #1–#24，共 24 章）+ 第二部分供货商（S1–S9，9 章）+ 待办索引 + 尾部变更注记。全文 796 行，73.5KB。
- **`[已定]` 标记 87 处**（含行内注记），**`[待确认]` 7 处**，`[阻塞]` 0 处。
- **仍悬空的 3 条**（其余 4 处 `[待确认]` 是索引表历史注记与格式说明）：
  1. `:369` **S3 供货商系统内消息触达** —— 2026-09-20 拍板「维持线下」，但代码已建站内通道（`getMessages` supplier 分支 + `notifySuppliersNewOrder` + `supplier-messages` 页），**代码超出拍板口径**，需业务方决定保留还是收窄。
  2. `:539` **#15 异常处理责任人与时效** —— 责任分工（店长/采购）、closed 语义、时效、是否强制拍照均未定。**注意：索引表 `:788` 已标「[部分拍板]（补结算提醒已实施）」，但章节正文 `:551` 仍写「不会提醒管理员去补」，与代码 `dataService:822-829` 矛盾。**
  3. `:555` **#16 单据日期补录** —— 章节标 `[待确认]`、正文 `:559` 写「无"补录"标记」，但索引表 `:789` 已标 `[已定]（2026-09-28 拍板：允许补录但打标）`，且代码已写 `backfilled`（`createPurchaseOrder:331`、`createReceipt:480`）。
- **索引与章节状态直接矛盾 1 处**：`:786` 索引表把 #13「手动商品结算口径」标为 `[待确认]`，而章节标题（`:525`）标 `[已定]（已被 S9 拍板覆盖）`。
- **修复计划 §2.2 的 5 条待拍板疑问点**：P1-6（chef 报表入口）、P2-4（supplier 报表下载 -403）、P2-45/#16（补录日期）、P2-20（无默认供应商商品）、#15（异常时效）。其中 #16 已在 2026-09-28 拍板落地，该疑问点条目**未回填**。

### B.2 审查报告-2026-09-30：结论清单与状态

- 分级：**P0×8 / P1×20 / P2×85 / P3×40 = 153 项**，另有 §10 列 20 项「经核查确认无问题」的亮点。
- §6「README 声明核查表」列出 8 条 README 声明与代码的漂移；§8 给 8.1 业务流回归 16 条、8.2 财务对账等式 10 条、8.3 并发专项 7 条、8.4 云端核对 8 条（唯一需人工的部分）。
- **本报告独立复验其 P0 状态**（与 deep-20261004/08 §1.1「8 项 P0 已修 7 项」基本一致，但有 2 处修正）：

| P0 | 缺陷 | 本报告复验结论 |
|---|---|---|
| P0-1 | 明文口令入库 + 超管不可收回 | **部分落实**：超管可停用已实现（`authService:484-493` 需另一名在岗超管），但凭据材料仍在库（见 D5） |
| P0-2 | settleReceipt 重复出账 | **属实已修**（`dataService:933-936` 锁 + `:971-976` 只结算解锁行） |
| P0-3 | is_final 事务外快照 | **属实已修**（`createReceipt:401-405`、`:485`） |
| P0-4 | 版本号自增后回读 | **属实已修**：`getNextVersion` 改 CAS 条件更新，4 副本同改 |
| P0-5 | 凭证 fileID 越权删 | **属实已修**（`dataService:1560` 前缀校验 + `:1603` 只删本单文件） |
| P0-6 | 打包忽略缺失 | **属实已修**（`project.config.json` `packOptions.ignore` 13 条） |
| P0-7 | 手动单核销不可达 | **属实已修**，且**口径变了**：门槛从「仅 received」放宽为三态（见 D3-13） |
| P0-8 | 页面合计 ≠ Excel | **属实已修**（`report-detail.js:53-62`） |

> 与 deep-20261004/08 的差异：该报告认为 P0-4「仅换了 CAS 写法，未完全复验为已修复」；本报告读到 4 份副本全部是条件更新写法（`createPurchaseOrder:109-135` / `createReceipt:73-98` / `dataService:107-135` / `generateSummaryReport`），判为**已修**，但保留其质疑的合理性——并发行为未做真机验证。

---

## C. docs/exploration 覆盖扫描

### C.1 规模与时间线

**31 份报告，15,982 行**（30 份正文 + 1 份 INDEX）。5 个批次：

| 批次 | 文件数 | 行数 | 主题 |
|---|---|---|---|
| 早期双批 | 2 | 2,008 | `batch1-cloudfunctions-data` 1258 + `batch2-purchase-flow` 750 |
| 主控横向扫描 ×3 | 3 | 1,625 | 跨批交叉发现（187 / 407 / 1031，10-03 与 10-04 两轮） |
| full-scan ×7 | 7 | 3,522 | 01 身份 / 02 采购收货云函数 / 03 报表云函数 / 04 数据层商品 / 05 管理页 / 06 报表页 / 08 基建与数据契约 |
| deep-20261004 ×9 | 9 | 3,369 | 01–08 分域深挖 + INDEX |
| rescan-20261004 ×9 | 9 | 5,446 | R2 数据契约 805 / R3 采购云 511 / R4 收货异常 598 / R5 报表云 483 / R6 商品价格 590 / R7 采购收货页 598 / R8 管理页 592 / R9 供应商页 619 / R10 报表页与文档 749 |

> **注意**：`full-scan` 序列缺 07（只有 01–06、08），`deep-20261004` 与 `rescan` 均编号到 08/10 而 full-scan 缺位——批次间编号不对齐，读报告会踩空。

### C.2 反复勘探的主题（重复度排序）

| 主题 | 出现份数 | 说明 |
|---|---|---|
| 数据契约 / seed-data | 6+ | `batch1`、`full-scan-08`、`deep-08`、`rescan-R2`、`controller-horizontal-scan*`、本报告 |
| 财务链路（settleReceipt / reprice / 账单） | 6+ | `batch1`、`full-scan-02/03`、`deep-02/05/06`、`rescan-R2/R4/R5` |
| 状态机 / 死状态 | 5+ | `deep-04/05`、`rescan-R2/R3/R4` |
| 报表生成与版本 | 5 | `full-scan-03`、`deep-06`、`rescan-R5/R10`、`full-scan-06` |
| 供货商侧可见性与消息 | 4 | `deep-02/04`、`rescan-R9`、`deep-INDEX` M1 |
| 会话 / 鉴权副本 | 4 | `full-scan-01`、`deep-01`、`rescan-R9`、`deep-INDEX` M5 |

### C.3 结论互相矛盾或漂移的地方

1. **`report_version_counter` 是否已修（P0-4）**：`deep-20261004/08` §1.1 判「未完全复验为已修复」；本报告判「已修」。差异来源是复核粒度，非结论冲突，但**两处结论都被写进了报告**，读 INDEX 时会得到矛盾印象。
2. **供货商确认接单窗口**：`rescan-R2` / `deep-04` 记录代码为「审批后」；`业务模糊点确认清单` S1 拍板与 `采购流程图` 都写「已提交/已通过」。三方口径不一致，且没有任何一份报告把它作为漂移项单独列出（本报告显示 D4-1 补上）。
3. **`abnormal_record` 运行期额外字段**：`rescan-R2 §5.1` 列为 `payment_decision, handled_by, resolved_by, resolved_at, closed_by, closed_at`；本报告读到 `dataService` 另有 `:1147-1149` 在 `settleReceipt` 内写 `status:'resolved'` + `handled_by`——即**补结算会把未关闭的异常静默置为 resolved**，这是 R2 未记录的行为，与 #15「责任分工未定」直接相关。
4. **幂等/CAS 提交信息的可信度**：`deep-INDEX` M6 指出 git 提交信息声称的机制与实际不符（"CAS versioning" 只落在计数器、"idempotency hardening" 收货无幂等键）。本报告显示 `07b6461` 之后的 `33ce694`（B2）确实把 `is_final` 事务化了，**M6 的判断在 B2 合入后部分失效**，但 INDEX 未标注失效时间。

### C.4 从未被任何历史报告覆盖的代码区域（覆盖盲区）

| 盲区 | 证据 | 风险 |
|---|---|---|
| `采购流程图.html` 逐节点核对 | `deep-20261004/08` §8 自述只做「状态词频抽样」；`rescan-R10` 只做文档卫生 | 本报告 D4 补出 3 处状态窗口不符 |
| `utils/meta.js` 状态字典的完整消费面 | 各报告只引用其某几个键 | 18 个键中 3 个是死状态、1 个（`completed`）与 order 混表 |
| `scripts/` 目录内容 | 31 份报告无任何一份提及 | 打包/构建脚本可能含硬编码凭据或影响部署一致性 |
| `styles/` 与 `assets/` 的实际消费映射 | `full-scan-08`/`deep-07` 只谈 token 定义与图标生成 | 审查报告称「259 处硬编码 hex」，但**没有报告验证哪些页面实际未采用设计令牌** |
| `importProducts` 与 `product-import-template.md` 的逐列比对 | `deep-20261004/08` §4.2 明确标「R2 遗留【待核实 #7】本次未验」 | 必填校验口径可能漂移（本报告亦未展开，诚实标注） |
| `getReportDetail` / `getReportFileUrl` 的完整分支 | 仅 `rescan-R5/R10` 触及片段 | P2-4（supplier 报表下载 -403）至今是未拍板项 |
| `generateSummaryReport` 的日/月汇总口径等式 | `deep-06`/`rescan-R5` 只谈生成，未验 §8.2 等式 2 | 审查报告 §8.2 等式 2 明确写「当前不等」，无报告复验是否已修 |
| 前端 26 页中 `approval-list` / `approval-detail` / `store-switch` | `rescan-R7/R8/R9` 覆盖 19 页 | 审批页与门店切换页未见专项报告 |

---

## D. 交叉一致性核对

### D.1 seed 字段 vs 代码实际读写

**统计口径**：`grep -rE` 在 `cloudfunctions/` 20 个云函数 + `utils/` 计数；`(RT)` = 仅运行期写入、seed 缺失。

**「代码写了但 seed 没定义」全景（约 70 处）**

| 集合 | seed 字段数 | 代码额外写入字段 | 数量 |
|---|---|---|---|
| `purchase_order` | 10 | `delivery_date` `backfilled` `is_manual` `verify_status` `verify_amount` `verify_voucher_file_ids` `verify_note` `verify_submitted_by` `verify_submitted_at` `verify_reject_note` `verify_cancel_note` `verified_by` `verified_at` `request_id` `created_by_name` `submitted_at` `supplier_confirmations`（嵌套 map）`audited_by` `audited_at` `audit_remark` `cancel_reason` `cancelled_by` `cancelled_at` `cancel_requested_by` `cancel_requested_at` `missing_reports` | **27** |
| `report_file` | 13 | `basis_date_type`（写 10 处、**读 0 处**）`has_abnormal` `abnormal_summary` `excluded_rows` `regenerated` `settle_for_receipt` `total_amount` `item_count` `updated_at` | 9 |
| `app_user` | 13(+1) | `openid` `sessions`（数组，B12 多设备）`session_token_hash` `session_expires_at` `login_fail_count` `locked_until` `last_login_at` | 7 |
| `receipt` | 8 | `overall_remark` `photo_file_ids` `batch_no` `is_final` `backfilled` `missing_reports` `updated_at` | 7 |
| `abnormal_record` | 13 | `payment_decision` `handled_by` `resolved_by` `resolved_at` `closed_by` `closed_at` | 6 |
| `receipt_item` | 13 | `is_manual` `is_shortage` `is_quality_issue` `is_wrong_item` `updated_at` | 5 |
| `message` | 9 | `scope_type` `scope_id` `read_by` `read_at` | 4 |
| `purchase_order_item` | 11 | `approved_qty` `original_order_qty` `updated_at` | 3 |
| `supplier` | 8 | `remark` | 1 |
| `store` / `category` / `product` / `supplier_product_price` | — | 无（`product` 是唯一天然对齐的集合，复验一致） | 0 |

**「seed 定义了但代码从不写入」——真正的单向字段**

| 字段 | 位置 | 性质 |
|---|---|---|
| `message.read` | seed 3 条全有 | **代码写 0 次**。`getMessages` 只读（`!!message.read \|\| readBy.includes(userId)`），`markMessageRead` 只 push `read_by`。seed 的 `read:true` 是**全局已读**语义，会让该消息对所有用户显示已读 |
| `supplier.address` | seed 6 条全有 | **云函数写 0 次**（`saveSupplier:dataService:148-153` 不含 address），仅 `utils/cloud.js:194` 读 → 新建供应商恒为 `''`，演示数据与真实数据形态不一致 |
| `report_file.file_url` | seed 11 条全 `""` | 运行时写云 fileID；seed 留空是有意为之（README 已解释），但 `getReportFileUrl` 对空串的行为未在任何报告中验证 |
| `supplier_product_price.currency` / `expiry_date` | seed 全有 | 代码恒写 `currency:'CNY'`、`expiry_date:null` → 常量字段，无判别力；seed `PRC001` 的 `expiry_date:'2026-07-31'` 演示的历史过期机制**代码里不存在** |
| `category.icon` / `category_level_1_icon` | seed 有 | 只读展示（`dataService:69,77`），无写入路径 → 新建分类时图标只能靠前端传 |

**「代码引用但 seed 无字段导致的行为」**（导入后会静默走兜底）

| 字段 | 缺失后果 |
|---|---|
| `receipt.batch_no` / `is_final` | `regenerateReceiptReports:1189-1190` 有 `Number(x)||1` / `!==false` 兜底 → 不崩，但「最后一批」判定语义未定义 |
| `receipt_item.is_manual` / `is_shortage` | `!undefined === true` → 土豆行被当「正常全额可付款」渲染（与 seed 自己的 `abnormal_record` 矛盾，见 D2-4） |
| `report_file.basis_date_type` | 只写不读，无后果（纯死字段） |
| `abnormal_record.abnormal_id` 格式 | seed 用 `ABN20260805001`，运行期是 `RCP20260805001_1_shortage`；`settleReceipt:960-962` 按 `{receiptId}_{行序}_{type}` split 解析，seed 记录 `parts.length===1 < 3` → `continue` → **这条异常单永远无法被转回可付款**，回归会误判「pay_received 裁决失效」 |
| `price_id` 格式 | seed `PRC001` vs 代码 `'PRC_' + Date.now()`（`updateProductPrice:103`）；同毫秒两次调价 → 同 id，事务内不校验唯一 |

### D.2 枚举覆盖与测试盲区

| 枚举 | 代码值域 | seed 覆盖 | 盲区 |
|---|---|---|---|
| `purchase_order.order_status` | 11 值：`draft` `submitted` `pending_approval` `approved` `rejected` `report_generated` `to_receive` `partial_received` `received` `receipt_abnormal` `cancelled` | 3 值：`submitted` `approved` `received` | **8 值未造**：草稿、驳回、部分收货、收货异常、作废、报表已生成、待收货、待审批 |
| `order_status` 死状态 | `report_generated`（12 处判定）、`to_receive`（4 处）、`pending_approval`（5 处） | 未造 | **全库无写入点**——只在白名单/查询条件里出现。`createReceipt:239,417` 白名单含 `report_generated` 但无人能把它写进去 |
| `receipt.receipt_status` | `completed` / `abnormal` | 只 `completed` | 异常收货单链路无样本 |
| `abnormal_record.status` | `pending`→`processing`→`resolved`→`closed`（`dataService:777,802,849,1147`） | 只 `pending` | 3 态未造；`resolveAbnormal` 要求 `status==='processing'` 才能解决，而 `startAbnormal` 是唯一次态转移入口 |
| `abnormal_record.type` | `shortage` / `quality` / `wrong_item` / `missing_price`（`createReceipt:537-544`） | 只 `shortage` | 质量、错货、缺价三类未造；`missing_price` 是 #11 拍板的核心场景，seed 无样本 |
| `abnormal_record.payment_decision` | `pay_received` / `reject` / `""` | 未造 | 补结算的唯一触发依据 |
| `purchase_order.verify_status` | `''` / `none` / `pending` / `approved` / `rejected` | 未造 | S9 主链路（README 主打功能）零样本；且同一字段两种「无状态」表达（手动单 `'none'`、非手动单 `''`） |
| `report_file.status` | `generated` / `pending` / `superseded` | 只 `generated` | 补生成（`missing_reports`）与改量重发（`superseded`）无样本 |
| `report_file.report_type` | 6 值 | **6/6 全造** | 覆盖最好的枚举 |
| `message.type` | `order` `receive` `abnormal`（另有 `cancel` 等） | 3 值 | `cancel` 类未造 |
| `app_user.status` / `supplier.status` / `product.status` / `category.status` / `store.status` | 1/0 | 供应商/商品有 0 样本（`SUP006`/`P099`），用户/门店/分类无 | **无停用账号样本** → P1-7（停用不清会话）无法用 seed 复现 |
| `confirmSupplierOrder` 动作状态 | `CONFIRMABLE_ORDER_STATUS=['approved','report_generated','to_receive']`；`SHIPPABLE_ORDER_STATUS=[...,'partial_received']` | 无 `supplier_confirmations` 样本 | 供货商确认状态（`confirmed`/`shipped`）是嵌套 map，seed 完全无法预置 |

### D.3 文档声明 vs 代码真实状态（抽查 18 条）

| # | 声明来源 | 声明内容 | 代码证据 | 结论 |
|---|---|---|---|---|
| 1 | 修复计划 B1-3（P1-10） | 删除 `item.payableFlag !== false`，服务端按档案价裁决付款资格 | `createReceipt:392-396` `item.payableFlag = !hardAbnormal && priceSnapshot > 0` | **属实** |
| 2 | 修复计划 B2-1（P0-3） | `is_final` 移入事务，用 `txHistoryQty` 重算 | `createReceipt:401-405`（`txIsFinalBatch`）、`:485`（`is_final: txIsFinalBatch`） | **属实** |
| 3 | 修复计划 B1-1（P0-2） | settleReceipt 事务内加锁 + 只结算本次解锁行 | `dataService:933-936`（`settle_lock` 条件更新）、`:971-976`（`unlockedIds.has && !is_manual && price>0`） | **属实** |
| 4 | 修复计划 B3-2（P0-6） | 补 `packOptions.ignore` | `project.config.json` 13 条 ignore（`_tmp_test`/`seed-data`/`scripts`/`cloudfunctions`/5 份 md/`.md`/`.html`） | **属实**（额外把 `cloudfunctions/` 目录也排除了） |
| 5 | 修复计划 B3-1（P0-1） | 轮换 5 个初始口令，新初始口令不再写入仓库 | `seed-data/app_user.json:1-5` 仍含 salt+hash+iterations；`.gitignore:8` 声明忽略但 `git ls-files seed-data/` 返回 15 文件 | **未落实**（仅做到「无明文」，凭据材料仍在库） |
| 6 | 审查报告阶段一#4（P1-12） | 审核改量保留 `original_order_qty` | `dataService:558` 仅首次写入 | **属实** |
| 7 | 审查报告阶段一#12（P1-7） | `setUserStatus` 停用分支补 `updateData.sessions = []` | `authService:497-500` 只清 `session_token_hash` 与 `session_expires_at`，**未清 `sessions[]`** | **未落实**（重新启用后旧多设备会话复活） |
| 8 | 审查报告阶段一#17（P1-19） | `getPurchaseOrders` 补 `delete baseQuery.verify_status` | `getPurchaseOrders:83-84` | **属实** |
| 9 | 修复计划 B2-10（P0-4） | 版本号改 CAS 循环 | `dataService:107-135`、`createPurchaseOrder:109-135`、`createReceipt:73-98`、`generateSummaryReport` 四副本均为条件更新 `count===current` | **属实** |
| 10 | 修复计划 B4-5（L4） | `PRC_` 加随机后缀 | `updateProductPrice:103` 仍为 `'PRC_' + Date.now()` | **未落实** |
| 11 | README「#15 异常解决后自动发待补结算提醒（2026-09-28 拍板）」 | 异常解决后发提醒 | `dataService:822-829` `createMessage({title:'待补结算提醒'})` | **属实**（但业务清单 `:539/:551` 仍标 `[待确认]` 且正文称「不会提醒」） |
| 12 | README「#16 补录日期打 backfilled 标」 | 业务日期早于服务端今天写 `backfilled:true` | `createPurchaseOrder:331`、`createReceipt:480` | **属实**（但业务清单 `:555/:559` 仍标 `[待确认]` 且称「无补录标记」） |
| 13 | 业务清单 #22（`:653`） | 「必须收齐（received）后才能上传凭证核销，已实施」 | `dataService:1578-1580` 门槛为 `['received','receipt_abnormal','partial_received']`，注释明写「P0-7（2026-10-03 修订口径，替代原 #22『须收齐』门槛）」 | **已回退/未同步**（代码放宽了口径，拍板记录与流程图文案均未更新） |
| 14 | 审查报告阶段二（P2-24） | `verifyManualOrder` reject 强制填 note | `dataService:1617-1619` | **属实** |
| 15 | 修复计划 B3-6（P2-3） | 三个云函数补 `supplier.status` 校验 | `confirmSupplierOrder:55-79` 只用 `user.default_supplier_id` 与 `purchase_order_item.supplier_id` 匹配，**从不读 `supplier.status`** | **未落实**（停用的 `SUP006` 旧会话仍可确认接单/发货） |
| 16 | 流程图 S1「确认窗口：已提交/已通过」+ 业务清单 S1 拍板「确认接单仍限 submitted/approved」 | 确认接单含 submitted | `confirmSupplierOrder:12` `CONFIRMABLE_ORDER_STATUS=['approved','report_generated','to_receive']` —— **不含 `submitted`** | **表述与实现不符**（代码是「审批后」口径，与 S1 拍板字面相反） |
| 17 | 流程图「发货窗口：已提交/已通过/已生成报表/部分收货」 | 发货含 submitted | `confirmSupplierOrder:13` `SHIPPABLE_ORDER_STATUS=['approved','report_generated','to_receive','partial_received']` —— 不含 `submitted`，含 `to_receive` | **不符**（双向偏差） |
| 18 | review.md「收货按钮 `canReceive: ['submitted','report_generated','partial_received','to_receive']`」 | 收货白名单 | `createReceipt:239,417` = `['approved','report_generated','partial_received']` —— 不含 `submitted`（B2 禁止）、不含 `to_receive`（死状态） | **已过期/错误**（review.md 停在 17-12，两处值都错） |

**附：文档内部三处未同步（章节正文 vs 自身索引表）**：`业务模糊点确认清单.md:539-551`（#15）、`:555-559`（#16）、`:786` vs `:525`（#13）。另：修复计划 §2.2 把 #16 列为待拍板，与已落地事实不符。

### D.4 采购流程图 vs 实际实现

流程图是四泳道（门店 / 管理员 / 供货商 / 系统），311 行，副标题标「2026-09-28 · 含 S1–S9 及 #1–#24 全部拍板」。

**逐节点核对结果：7 处一致，3 处状态窗口不符，2 处表述过松。**

| 流程图文案 | 代码实际 | 判定 |
|---|---|---|
| 「手动商品每单限 5 个」 | `createPurchaseOrder` `manualCount > 5` 拒绝 | 一致 |
| 「混单自动拆为两单」+「服务端保留禁混单校验兜底」 | `createPurchaseOrder` `manualCount > 0 && manualCount < items.length` → 「手动商品需单独下单」 | 一致 |
| 「审批只能改量不能删行；审批数量必须为正」 | `dataService:533-536` `qty <= 0 || qty > order_qty` 拒绝 | 一致 |
| 「驳回必须填写原因」 | `dataService:511` `status==='rejected' && !auditRemark` 拒绝 | 一致 |
| 「已收货不可作废」 | `cancelOrder:1357,1377` 拒 `partial_received/received/receipt_abnormal` | 一致 |
| 「异常解决后自动发待补结算提醒（#15）」 | `dataService:822-829` | 一致 |
| 「#16 补录日期打 backfilled 标」 | `createPurchaseOrder:331`、`createReceipt:480` | 一致 |
| 「#24 带价报表/供应商门户显式过滤 is_manual」 | `settleReceipt:971-976` 等 | 一致 |
| 「改量→旧版 superseded，按批准数量重发，清空供货商确认（S2）」 | `dataService:409-412` `supplier_confirmations: _.set({})`（仅 `qtyChanged`） | 一致 |
| **「确认窗口：已提交 / 已通过（S1）」** | `CONFIRMABLE_ORDER_STATUS=['approved','report_generated','to_receive']` | **不符**：不含 `submitted`，多 `report_generated`/`to_receive` |
| **「发货窗口：已提交 / 已通过 / 已生成报表 / 部分收货」** | `SHIPPABLE_ORDER_STATUS=['approved','report_generated','to_receive','partial_received']` | **不符**：不含 `submitted`，多 `to_receive` |
| **「草稿 / 已驳回不可见」（供货商）** | `getSupplierOrders:12` `HIDDEN_ORDER_STATUS=['draft','submitted','pending_approval','rejected']` | **表述过松**：实际连 `submitted` 也不可见（这正是 `07b6461` 那次提交收紧的），流程图只写了草稿与驳回 |
| **「审批后：采购员申请取消，管理员确认」** | `cancelOrder` 与 `requestCancel` 都要求 `GLOBAL_ROLES`（`purchaser`/`super_admin`），且 `cancelOrder` 对 `approved`/`report_generated` 单据**可直接作废** | **表述过松**：未体现「审批后管理员仍可直接作废，取消申请只是另一条路」 |

**流程图与代码的口径分歧根源**：S1 拍板（2026-09-20）写「确认接单仍限 submitted/approved」，但实际实施为「审批后」口径。业务清单 S1 章节正文、流程图、代码三方各说一套，且 `07b6461`（`fix(supplier): restrict order visibility and actions until internal approval`）又把可见性收紧了一档，流程图未跟进。

### D.5 敏感信息暴露清单（审计项，只标记不处理）

| # | 文件:行号 | 内容 | 风险 |
|---|---|---|---|
| 1 | `seed-data/app_user.json:1` | 超管 `U000`/`admin` 的 `password_salt` + `password_hash` + `password_iterations:120000` | 高：可离线爆破（PBKDF2 12 万次，弱口令仍可尝试） |
| 2 | `seed-data/app_user.json:2` | `U001`/`chef` 同上 | 高 |
| 3 | `seed-data/app_user.json:3` | `U002`/`manager` 同上 | 高 |
| 4 | `seed-data/app_user.json:4` | `U003`/`admin_user` 同上 | 高 |
| 5 | `seed-data/app_user.json:5` | `U004`/`supplier_test` 同上 | 高 |
| 6 | `seed-data/supplier_test_user.jsonl:1` | **U004 的第二份凭据，salt/hash 与 `:5` 不同**（`62fd5e6a…` vs `63d7ee55…`） | 高：**冲突**。两份都导入会使后者覆盖前者，供货商测试账号能登哪个取决于导入顺序；且该文件不在 `seed-data/README.md` 的 13 步导入清单内，是孤儿文件 |
| 7 | `.gitignore:8` vs `git ls-files seed-data/` = **15 文件** | `.gitignore` 声明忽略 `seed-data/`（注释「本地种子/敏感数据」），但 15 个文件实际被追踪 | 高：**声明与状态矛盾**。读者会误以为凭据不在版本库；`seed-data/README.md:23` 的「不再写入仓库」只做到无明文 |
| 8 | `seed-data/README.md:23` | 明文提 `Admin@2026`（历史留痕） | 中：文本留痕本身可被搜到；且确认 git 历史仍可查旧口令 |
| 9 | `审查报告-2026-09-30.md:91` | 明文口令表 `admin / Admin@2026` | 中：审查报告随包外发即泄 |
| 10 | `审查报告-2026-09-30.md:98` | `_tmp_test/` 中 `Admin@2026`、`Test@123456` | 中 |
| 11 | `审查报告-2026-09-30.md:186` | `_tmp_test/` 中 `Admin@2026`、`Test@123456`、`Supplier@2026` | 中 |
| 12 | `seed-data/app_user.json:1-5`、`supplier.json:1-6` | 手机号 10 个（`13900000000`、`13900001111`、`13900002222`、`13900003333`、`13800010001`–`13800010006`）+ 供应商联系人姓名与详细地址（`北京市朝阳区农产品批发市场 A 区 12 号` 等） | 低：号码是测试号段，地址疑似虚构但格式真实 |
| 13 | `scripts/` 目录（未被任何勘探报告核查） | 打包/构建脚本内容未审计 | 未知：**盲区**，建议下一轮补查 |

**已确认无泄漏的项**（正面结论，复验一致）：

- 云环境 ID：全库 20 个云函数均为 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`，无硬编码 envId。
- `appId` / `secret` / `apiKey` / `accessKey`：全库 0 命中（含 `.json`/`.js`）。
- `project.config.json` 无 `appid` 字段；`project.private.config.json` 只有编译设置。
- `SUBSCRIBE_TEMPLATE_ID = ''`（`dataService:244`）、`NEW_ORDER_TEMPLATE_ID = ''`（`supplier-home:7`）为**空占位**，非泄漏但阻塞验收（README 已列为上线前必配）。
- `packOptions.ignore` 已排除 `seed-data/`、`_tmp_test/`、`scripts/`、`*.md`、`*.html` → **小程序上传包不含凭据**（审查报告 P0-6 已修，这是当前最关键的正向结论）。

### D.6 问题汇总表

| 级别 | 文件:行号 | 问题 | 触发场景或影响 |
|---|---|---|---|
| **P0** | `seed-data/app_user.json:1-5`、`supplier_test_user.jsonl:1` | 6 条 PBKDF2 凭据材料（salt+hash+120000 次迭代）在版本库；U004 两份冲突 | 拿到仓库即可离线尝试登录全部 5 个角色账号；导入顺序不确定导致供货商测试账号无法登录 |
| **P0** | `.gitignore:8` vs 实际 15 文件被追踪 | `.gitignore` 声称忽略 `seed-data/`，声明失效 | 团队误判「凭据已出库」；与 README `:23`「不再写入仓库」构成对外可引用的错误陈述 |
| **P1** | `authService:497-500` | 停用账号只清 `session_token_hash`/`session_expires_at`，未清 `sessions[]` | 停用→重新启用后，旧设备 B12 多设备会话全部复活（审查报告 P1-7、修复计划 B3-9 均未落实） |
| **P1** | `confirmSupplierOrder:55-79` | 不校验 `supplier.status`，停用的 `SUP006` 旧会话仍可确认接单/发货 | 修复计划 B3-6（P2-3）未落实；供应商停合作但既有登录态可继续操作订单 |
| **P1** | `createPurchaseOrder` 无 `(request_id, created_by)` 唯一约束 | 幂等仍是 check-then-act，并发双击可重复建单 | 审查报告 P1-9、修复计划 B2-4/B6-2 均未落实；云数据库无唯一索引能力，需改幂等表 |
| **P1** | 业务清单 `:653` vs `dataService:1578-1580` | 拍板「必须收齐才能核销」已被代码放宽为三态，文档未同步 | 业务方以为存在「收齐才闭环」的资金闸门，实际 `partial_received` 即可回填实付金额 |
| **P1** | `createReceipt:239,417` 判定 `report_generated`/`to_receive` | 这两个状态**全库无写入点**，是死状态 | 收货白名单、供货商确认/发货窗口、在途订单统计都引用永不出场的值；流程图把它当正常节点 |
| **P2** | `purchase_order`（seed 缺 27 字段） | seed 无法演示凭证核销、补结算、改量重发、供应商确认、驳回重传 | 任何基于 seed 的回归都测不到 README 主打的 S9 链路 |
| **P2** | seed 枚举覆盖：`order_status` 3/11、`receipt_status` 1/2、`abnormal.status` 1/4、`abnormal.type` 1/4、`report_file.status` 1/3、`verify_status` 0/5 | 枚举盲区 | 异常链路、分批收货、作废链路在 seed 上完全不可测 |
| **P2** | `abnormal_record.abnormal_id`（seed `ABN20260805001`） | 与运行期格式 `RCP…_1_shortage` 不符 | `settleReceipt:960-962` split 解析 `parts.length<3` 直接 `continue` → seed 异常单永远无法转回可付款，回归会误判 `pay_received` 裁决失效 |
| **P2** | `receipt_item`（土豆行） | `received_qty:28 < order_qty_snapshot:30` 且有 shortage 异常，但**无 `is_shortage:true` 且 `payable_flag:true`** | seed 自身表达「全额可付款」+「已登记短收异常」两个矛盾事实；`regenerateReceiptReports` 会渲染成正常行 |
| **P2** | `updateProductPrice:103` | `'PRC_' + Date.now()` 无随机后缀 | 同毫秒两次调价产生相同 `price_id`；L4 未落实 |
| **P2** | `dataService:1147-1149` | `settleReceipt` 内把异常记录写为 `status:'resolved'` + `handled_by` | 补结算会静默「解决」未关闭的异常，与 #15「责任分工未定」冲突；既有报告未记录此行为 |
| **P2** | `report_file.basis_date_type` | 代码写 10 处、读 0 处；seed 全无 | 纯死字段，白付 10 次写入 |
| **P2** | 采购流程图 vs `confirmSupplierOrder:12-13` | 确认/发货窗口文案与白名单双向不符 | 供货商按流程图操作会在 `submitted` 阶段点确认却被拒 |
| **P2** | 业务清单 `:539-551`、`:555-559`、`:786` vs `:525` | 三处章节正文与自身索引表状态不一致（#15/#16/#13） | 读者按章节读会得到「未拍板」的错误结论，与 README、流程图、代码均冲突 |
| **P2** | review.md 全文（17-12） | `canReceive` 白名单含 `submitted` 与死状态 `to_receive` | 两份文档同时存在会误导新成员实现收货入口 |
| **P2** | `message.read`（seed 有、代码写 0 次） | seed 的全局已读布尔会让该消息对所有用户显示已读 | 演示环境的消息中心已读状态不可信 |
| **P3** | `supplier.address`（seed 有、云函数写 0 次） | 新建供应商恒为 `''`，与演示数据形态不一致 | 列表页地址列空白，用户以为字段丢失 |
| **P3** | `category.icon` / `category_level_1_icon` | 无写入路径，纯展示 | 新建分类时图标依赖前端传值 |
| **P3** | seed-data 三种文件格式并存（NDJSON / JSON 数组 / 缩进单对象） | 无统一解析策略 | 任何单一导入脚本必在某个文件上失败 |
| **P3** | `log.md`（停在 17-15，09-24） | 缺 09-28 安全加固与 10-03/10-04 的 B1–B6 批次 | 版本日志无法作为变更追踪依据 |
| **P3** | `scripts/` 目录 | 31 份勘探报告 + 本报告均未审计其内容 | 盲区；可能含构建期硬编码 |

---

## 附：本次明确未验（诚实标注）

1. `importProducts` 必填校验与 `product-import-template.md` 的**逐列**比对（R2 遗留【待核实 #7】，本轮沿用未验状态）。
2. `generateSummaryReport` 日/月汇总金额口径是否已满足审查报告 §8.2 等式 2（只验了生成端 `basis_date_type`，未验汇总求和）。
3. `scripts/` 目录内容、`styles/`/`assets/` 的实际页面消费映射。
4. `getReportDetail` / `getReportFileUrl` / `getReportFileUrl` 对 supplier 的 -403 分支（P2-4 未拍板）。
5. 并发类结论（P0-4 CAS、P1-3 事务复查、P0-2 补结算锁）只验了**代码写法**，未做真机双设备验证——与审查报告 §8.3 的口径一致，属代码侧无法验证的部分。
6. `docs/exploration` 的 `batch1/2`、`full-scan-01..06/08`、`rescan-R3..R10` 正文未逐字全读，只提取了标题结构、结论表与本轮需复验的定点引用（与 `deep-20261004/08` §1.2 相同的抽样范围）。
