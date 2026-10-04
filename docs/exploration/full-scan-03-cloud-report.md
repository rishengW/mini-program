# 全量扫描 03：报表云函数（generateSummaryReport / getReports / getReportDetail / getReportFileUrl）

> 范围：`cloudfunctions/{generateSummaryReport,getReports,getReportDetail,getReportFileUrl}`（4 个 index.js + 4 个 package.json，全读 694 行）
> 只读参照：`createReceipt/index.js`、`createPurchaseOrder/index.js`、`dataService/index.js`（报表生成与状态口径对账）、`pages/report-list|report-history|report-detail/*`、`utils/cloud.js`、`utils/meta.js`
> 方法：逐行读代码，不采信注释。结论均带 `文件:行号`。拿不准标【待核实】。
> 与 02 / 06 的边界：报表**生成侧**（createPurchaseOrder / createReceipt / dataService 的 6 类报表落库）由 full-scan-02 负责；报表**页面消费**由 full-scan-06 负责。本文只定论 4 个报表云函数本身，并在需要处引用 02/06 的产物做口径对账。

---

## 0. 文件覆盖清单

| # | 路径 | 行数 | 一句话职责 |
|---|---|---|---|
| 1 | `cloudfunctions/generateSummaryReport/index.js` | 270 | 门店日/月汇总：拉全店收货单据 → 内存按「供应商×商品」聚合 → 生成 UTF-8-BOM CSV 上传云存储 → 写 `report_file` |
| 2 | `cloudfunctions/generateSummaryReport/package.json` | — | 仅依赖 `wx-server-sdk: ~2.6.3` |
| 3 | `cloudfunctions/getReports/index.js` | 103 | 报表列表：按角色收敛 `report_file` 查询范围（client 参数只能收窄不能扩张）+ count + 分页 |
| 4 | `cloudfunctions/getReports/package.json` | — | 仅依赖 `wx-server-sdk: ~2.6.3` |
| 5 | `cloudfunctions/getReportDetail/index.js` | 257 | 报表详情：按 6 种 report_type 分 5 条分支从原始集合**重建行数据**（汇总类则下载 CSV 反解析） |
| 6 | `cloudfunctions/getReportDetail/package.json` | — | 仅依赖 `wx-server-sdk: ~2.6.3` |
| 7 | `cloudfunctions/getReportFileUrl/index.js` | 64 | 报表文件换取临时下载链接，附带作用域/角色校验 |
| 8 | `cloudfunctions/getReportFileUrl/package.json` | — | 仅依赖 `wx-server-sdk: ~2.6.3` |

**鉴权底座**：4 个函数各自复制一份 `hashToken` + `getSessionUser`（多设备 `sessions` 数组优先，回退 `session_token_hash` 单会话字段），实现完全一致（`generateSummaryReport:8-38`、`getReports:7-37`、`getReportDetail:8-52`、`getReportFileUrl:7-37`）。全部 `cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})`，无固定环境 ID。

**返回体风格（核实项 1 结论）**：4 个函数**全部为顶层扁平 `{code, msg}`**，无任何嵌套 `{error:{...}}`。逐条计数：

| 函数 | 错误返回 | 成功返回 | 嵌套 `{error}` |
|---|---|---|---|
| generateSummaryReport | 9 处（L159,161,164,166,172,173,176,179,268） | L257 | **0** |
| getReports | 8 处（L42,46,47,54,60,65,74,101） | L98 | **0** |
| getReportDetail | 7 处（L57,59,68,74,75,76,255） | L252 | **0** |
| getReportFileUrl | 7 处（L42,44,47,51,53,59,62） | L57 | **0** |

→ **报表链路完全不受 controller-horizontal-scan F1（嵌套 error 吞掉 -401、会话过期不跳登录）影响。** 401/403 均为顶层 `code`，`utils/cloud.js:68` 的 `result.code === -401` 能正常命中并跳登录。此项确认完毕。

---

## 1. generateSummaryReport（270 行）

### 1.1 入参 / 出参契约

| 入参 | 必填 | 校验 | 行号 |
|---|---|---|---|
| `authToken` | 是 | `getSessionUser` 未命中 → `-401` | 158-159 |
| — | — | 角色不在 `['store_manager','purchaser','super_admin']` → `-403` | 160-161 |
| `period` | 是 | 必须 `'daily'` 或 `'monthly'`，否则 `-1 汇总类型无效` | 163-164 |
| `date` | 是 | 严格 `YYYY-MM-DD` 且必须是真实日历日（`isDate` 回写比对，拒 `2026-02-30`） | 165-166, 72-76 |
| `storeId` | 店长可选/管理员必填 | 店长：非空且 ≠ 自身 `default_store_id` → `-403`；最终强制取 `user.default_store_id`；空 → `-1 请指定门店` | 168-176 |
| — | — | `store` 集合查不到该 `store_id` → `-1 门店不存在` | 178-179 |

成功返回（L257-265）：`{ code:0, data:{ fileID, fileName, totalAmount, itemCount } }`
失败返回：`{ code:-401|-403|-1, msg }`（catch 统一 `-1 汇总报表生成失败，请稍后重试`，L266-269）

### 1.2 读写集合

读：`app_user`（会话）、`store`（名称）、`receipt`（`count` + `skip/limit 100` 分页取 `receipt_id`）、`receipt_item`（20 个 id 一坨 `_.in` + `skip/limit 100` 分页）、`product`（20 一坨取分类/单位）、`supplier`（20 一坨取名称）、`report_version_counter`
写：云存储 `cloud.uploadFile`（L232-235）、`report_file`（`add`，L237-255）

### 1.3 统计口径还原（逐行）

1. **单据选择**（L79-100）：只按 `store_id` + `receipt_date` 过滤，**无任何 status 过滤**。
   - daily：`receipt_date === date`（精确等值，L82）
   - monthly：`receipt_date >= 'YYYY-MM-01' && <= 'YYYY-MM-31'`（字符串比较闭区间，L84）
   - **时区**：`receipt_date` 是裸字符串日期（`createReceipt:433` 写 `receiptDate` 字符串，来自 `isReceiptDate(event.receiptDate)` 的 `YYYY-MM-DD`），非 Date 对象 → **本函数不涉及时区换算，跨时区无漂移**。是否含当天取决于前端传入（前端固定传「今天」，`report-list.js:136-139`）。
2. **明细拉取**（L103-120）：`receipt_id ∈ _.in(20)` 后 `skip/limit(100)` 翻页，`res.data.length < 100` 即停 → **无静默截断**。`getStoreReceipts` 用 `count()` 先算总量再分页（L90-98）→ 分页期间新增单据可能被跳过或被重复计入（竞态窗口，低危）。
3. **分组维度**（L187-206）：`key = supplier_id + '|' + product_id`（同一商品多供应商分行）。
4. **剔除项**（L191）：`if (item.is_manual) return` — 手动商品行**数量与金额同时剔除**。
5. **口径字段**：`orderQty += order_qty_snapshot`（L208）、`receivedQty += received_qty`（L209）、`amount += round(received_qty × price_snapshot, 2)` 逐行先舍入到分再累加（L211-212）；`totalAmount` 再对 `amount` 列二次舍入累加（L215）。数量列舍入到 **3 位小数**（L208-209），金额到 **2 位**。
6. **合计行**（L224）：只有金额合计；`下单数量`/`实收数量` 输出空串。
7. **落库**（L237-255）：`report_id = 'RPT_DSRPT_<storeId>_<date>_v<version>'`（L239，daily 前缀 `DS`、monthly 前缀 `MS`），`report_scope:'store'`，`basis_date_type:'summary_date'`，`status:'generated'`，`generated_by_system:false`，`total_amount` / `item_count` 仅本函数写入。
8. **文件**（L231）：`reports/summary/<period>/<storeId>/<pathDate>-summary-v<version>-<base36 时间戳><6 hex 随机>.csv`，月汇总 `pathDate = date.slice(0,7)`（L229）。内容加 UTF-8 BOM（L234）。

### 1.4 与采购单/收货单状态的耦合（核实项 3）

**取消单不会进汇总**，理由是排除法而非显式过滤：
- `createReceipt:228` 与 `createReceipt:392` 只允许 `['approved','report_generated','partial_received','to_receive']` 的订单收货 → 取消单（`order_status:'cancelled'`，`dataService:1303`）不可能有收货单。
- `dataService:1294-1296` 进一步禁止对「已有收货记录」的订单作废（`partial_received/to_receive/received/receipt_abnormal` 一律拒绝）。
- `receipt_status` 只有两个写入值：`'abnormal'` / `'completed'`（`createReceipt:437`），**不存在「取消收货单」**，也没有删除收货单的代码路径。

因此各状态的归属：

| 订单状态 | 是否进日/月汇总 |
|---|---|
| `cancelled` | 否（无收货单可进） |
| `submitted` / `pending_approval` | 否（不允许收货） |
| `approved`（部分收/收齐后推进） | 是 |
| `partial_received` | 是（该店当日已落库的收货行全进） |
| `to_receive` | 是（同上；此状态无写入方，见核实项 5） |
| `received` | 是 |
| `receipt_abnormal` | **是**（`receipt_status:'abnormal'` 的行照常计入金额，见 M3） |

→ 报表统计**没有漏算 `receipt_abnormal`**；漏算它的是 `confirmSupplierOrder` 的 SHIPPABLE 白名单（`confirmSupplierOrder:13`），不在本批范围。

---

## 2. getReports（103 行）

### 2.1 入参 / 出参契约

| 入参 | 是否被使用 | 行号 |
|---|---|---|
| `authToken` | 是 | 41-42 |
| `role` | **否（解构后从未使用，死参）** | 43 |
| `storeId` | **否（死参，管理员无法按门店收窄）** | 43 |
| `reportScope` | 仅 `purchaser/super_admin` 生效；校验 `['store','supplier']` | 46, 61-63 |
| `reportType` | 白名单 8 项（L68-72）；chef/store_manager 会被 L79-86 强制覆盖回自己的口径 | 73-76 |
| `relatedDate` | 只做正则格式校验，不校验真实日历日（`2026-02-31` 可通过） | 47, 77 |
| `page` | `Math.max(1, Math.min(1000, ...))` | 88 |
| `pageSize` | `Math.min(50, Math.max(1, ...))` | 89 |

成功：`{ code:0, data:[report_file 原始文档], total, page, pageSize }`（L98）
失败：`{ code:-401|-403|-1, msg }`（L42,46,47,54,60,65,74,101）

### 2.2 角色收敛（这是本函数唯一的安全语义）

- `chef`：`report_scope='store'` + `report_type='store_order_report'` + `scope_id=user.default_store_id`（L50-55）；未关联门店 → `-403`
- `store_manager`：`report_scope='store'` + 自身门店（L56-60）
- `purchaser` / `super_admin`：全量，可加 `reportScope`（L61-63）
- **其他角色（含 `supplier`）→ `-403 当前账号无权查看报表`（L64-66）**
- 关键设计：L79-86 在 client 传参处理之后**再次覆盖** chef / store_manager 的 `report_scope`、`report_type`、`scope_id` → client 传的 `reportScope:'supplier'` / `reportType:'supplier_receipt_price_report'` 无法扩张范围。已实测逻辑等价，权限收敛成立。

### 2.3 分页与保护

`count()` 取总数 + `orderBy('generated_at','desc')` + `skip/limit`（L90-96）。**无 `aggregate`，无 100/1000 静默截断风险**；`count()` 结果直接回传 `total`。
`orderBy` 只有单一字段 `generated_at`，无次要排序键 → 同毫秒内批量落库的多条报表（一次收货生成 4 类报表，`created` 时间接近）在翻页边界可能抖动/重复（低危）。
**不按 `status` 过滤** → 已作废（`superseded`）报表与有效报表同列表返回，前端用 `report-list.wxml:41` 打「已作废」标签。

---

## 3. getReportDetail（257 行，磁盘当前 257 行，核实项 6 确认）

### 3.1 入参 / 出参契约

| 入参 | 必填 | 行号 |
|---|---|---|
| `authToken` | 是 | 56-57 |
| `reportId` | 是，空 → `-1 缺少reportId` | 58-59 |

权限（L71-77）：`purchaser/super_admin` 不受限；`chef`/`store_manager` 必须 `report.report_scope === 'store'` 且 `report.scope_id === user.default_store_id`；`chef` 追加 `report_type === 'store_order_report'`；其余角色 `-403`。
- `default_store_id` 为空时天然拒绝（`scope_id !== null` 为真）→ 默认拒绝，安全。但错误文案与 getReports 不一致：getReports 给「账号未关联有效门店」（L54/L59），getReportDetail 给通用「无权查看其他门店报表」（L75）。
- **跨门店/跨供应商越权不成立**：传任意 `reportId` 读别人报表会被 L75 拦住（chef/store_manager），管理员不受限属设计。

成功：`{ code:0, data:{ ...report 全部字段（含 file_url 即 fileID、total_amount、item_count）, rows:[...] } }`（L252）
失败：`{ code:-401|-403|-1, msg }`（L57,59,68,74,75,76,255）

### 3.2 5 条重建分支（逐条对照生成侧粒度）

| report_type | 读取路径 | limit | 与生成侧粒度是否一致 |
|---|---|---|---|
| `store_order_report` | `purchase_order_item.where({purchase_order_id: orderId})` | 1000（L88，**无分页**） | 一致：生成侧也是每单一份（`createPurchaseOrder:365` `report_id:'RPT_SO_'+orderNo`） |
| `store_receipt_report` / `store_receipt_price_report` | `receipt.where({purchase_order_id: orderId}).limit(1)` → `receipt_item.where({receipt_id})` | 1（L102）/ 1000（L108，**无分页**） | **不一致**：见 H3、H2 |
| `supplier_order_report` | `purchase_order.where({order_date: date}).limit(200)` → `purchase_order_item.where({purchase_order_id:_.in(20), supplier_id}).limit(1000)` | **200 单 / 1000 行**（L135, L144） | **不一致**：见 H1 |
| `supplier_receipt_report` / `supplier_receipt_price_report` | `receipt.where({receipt_date: date}).limit(200)` → `receipt_item.where({receipt_id:_.in(20), supplier_id}).limit(1000)` | **200 单 / 1000 行**（L166, L175） | **不一致**：见 H1 |
| `store_daily_summary_report` / `store_monthly_summary_report` | 下载 `report.file_url` 反解析 CSV（L203-248），末行「合计」跳过（L233） | 无（受云存储文件大小限制） | 一致（源就是 CSV） |

→ **报告粒度定论（核实项 2b）**：**生成侧一律「每单一份」**——`createPurchaseOrder:365`（`RPT_SO_<orderNo>`）、`:414`（`RPT_SUO_<sid>_<orderNo>`，`source_order_id: orderNo`）、`createReceipt:567`（`RPT_SR_<receiptId>`）、`:600`、`:649`、`:684` 全部带单一 `source_order_id`。**读取侧（getReportDetail）把供应商类报表重建成「按日聚合多单」**。二者冲突时以文件为准 → **错的读取侧是 getReportDetail**：应用内表格会把当天所有订单的行合并展示，而「导出报表文件」下载的是只含一个订单的 CSV。

### 3.3 汇总类分支的额外成本

L203-206：每次打开汇总报表详情都 `cloud.downloadFile` 全量下载 CSV 再按 RFC4180 手工解析（L208-228），**无缓存、无版本判断**。解析失败不再静默成空表，而是 `throw`（L247）由外层转 `-1 报表详情加载失败`（L253-256）。

### 3.4 明细行字段差异（前端消费隐患）

- 收货类行（L110-126）：无 `supplierName`、有 `payable`、`abnormal*`、`subtotal = (received_qty * price_snapshot).toFixed(2) * 1`
- 供应商类行（L177-196）：多 `purchaseOrderId`、`storeName`
- 下单类行（L90-97）：`orderQty: item.order_qty`，无金额
- 汇总类行（L234-242）：`Number(f[i]) || 0` —— **`0` 值被 `|| 0` 兜底为 0 没问题，但任何非数字（如被 `'` 前缀的注入防御值）会被静默吞成 0**

---

## 4. getReportFileUrl（64 行）

### 4.1 契约

入参：`authToken`（L41）、`fileId`（必填，空 → `-1 缺少fileId`，L43-44）。
流程：`report_file.where({file_url: fileId}).limit(1)`（L46）→ 查不到 → `-1 报表文件不存在`（L47）→ 角色校验（L49-54）→ `cloud.getTempFileURL`（L55）→ `{ code:0, data:{ url } }`（L56-57）；无 `tempFileURL` → `-1 获取链接失败`（L59）。

### 4.2 权限与越权（核实项 4 后半）

- 校验顺序**正确**：先用 fileID 反查 `report_file` 记录，再做角色/作用域判断（L46 先于 L49）。不在 `report_file` 里的 fileID 直接「报表文件不存在」，不会走到 `getTempFileURL`。
- `chef`/`store_manager`：必须 `report_scope==='store'` 且 `scope_id===default_store_id`；chef 追加 `report_type==='store_order_report'`（L50-53）
- `supplier` 角色 → 落进 L50 的 `!['chef','store_manager'].includes(...)` 为真 → **`-403`**
- `purchaser`/`super_admin` 不受限（设计如此）
- **临时链接是否可猜别人的 fileID：不可行。** 三条防线叠加：① 文件路径含 `crypto.randomBytes(3).toString('hex')` 24bit 随机后缀（`generateSummaryReport:231`），同门店同日同版本才共享前缀；② fileID 必须是 `report_file.file_url` 中已存在的值才换链接；③ 换链接后再按调用者作用域校验。跨门店/跨供应商越权不成立。
- **未校验 `report.status`**：`superseded` 的报表仍可下载（审计留痕，符合 `dataService:1315` 注释意图）。

### 4.3 返回体缺口（前端连锁）

`{ url }` **不含** `expireTime`、`fileType`、`fileName`（L56-57）。云开发临时链接默认约 30 分钟有效期，但前端无从得知，只能等 `wx.downloadFile` 失败后弹「下载失败」（`report-detail.js:110`）。

---

## 5. 幂等与并发（核实项 5）

**同区间重复点「生成报表」**（`report-list.js:133-155` → `generateSummaryReport`）：
- 每次都走 `getNextVersion` 自增 → **新版本号 + 新文件 + 新 `report_file` 记录**。不覆盖、不去重、不失败（L228, L231, L237-255）。
- 列表因此出现同门店同日多张「门店日汇总 v1/v2/v3」卡片（`report-list.wxml:42` 显示 `v{{fileVersion||1}}`），用户无法区分哪张是最终版。
- **空数据也生成**：当日无收货 → `items=[]` → `rows=[]` → 仍上传一份只有表头+「合计 0.00」的 CSV 并消耗一个版本号（L182-185, L214-224）。
- 对比：生成侧 `createPurchaseOrder`/`createReceipt` 的报表是订单级唯一 ID（`RPT_SO_<orderNo>`），重复提交同一单不会产生多份；**只有手工汇总报表是非幂等的**。

**并发点两次**（同店同日）：`getNextVersion`（L53-70）先 `doc(counterId).update({count: _.inc(1)})` 再 `doc(counterId).get()` 回读：
- A 自增 1→2，B 自增 2→3；若 A 在 B 之后回读，A 读到 3、B 也读到 3 → **两个请求拿到同一版本号 3**。
- 文件名因随机后缀不同（L231）**不会互相覆盖**，但 `report_id` 由版本派生（`RPT_MSRPT_<storeId>_<date>_v3`，L239）→ **两条 `report_file` 记录的 `report_id` 完全相同**。
- 后果：`getReportDetail:62-65` 用 `where({report_id}).limit(1)` 且**无 `orderBy`**，命中哪一条不确定 → 页面展示的元数据（版本、金额、生成时间）与点击「导出」下载的 CSV 可能是两份不同文件。列表侧 `wx:key="reportId"` 也会撞 key。
- 同一实现（逐字复制）存在于 `createPurchaseOrder:77-94`、`createReceipt:76-94`、`dataService:364-...`，即**全项目 4 处版本号生成都有此竞态**；只是订单/收货类 report_id 含单据号所以不撞，只有汇总类真正暴露。
- 另：计数器在「聚合完成之后、上传之前」自增（L228 在 L232 上传之前）→ 上传失败时版本号已被消耗，下次版本号跳号（无害但无回滚）。

---

## 6. 问题清单

### 高级

**H1｜getReportDetail 供应商类报表按「日+供应商」重建明细，与生成侧「每单一份」不符，且 `limit(200)` 静默截断**
`getReportDetail/index.js:133-136`（`purchase_order.where({order_date: date}).limit(200)`）、`:164-167`（`receipt.where({receipt_date: date}).limit(200)`）、`:144`/`:175`（`_.in(20)` + `limit(1000)`）
触发：供应商在一天内下单/到货超过 200 单，或每 20 单的明细合计超 1000 行。
影响：① 页面表格把当天多个订单的行合并展示，而导出文件只含一个订单 → 页面合计 ≠ 文件合计；② 超过 200 单的剩余单据**不报错、不提示**地丢失（无 `count()` 校验、无分页），报表金额静默少算。
建议：读取侧按 `report.source_order_id` 单单取明细（与生成侧粒度对齐），`source_order_id` 为空时再走按日聚合；两处 `limit(200)` 改成 `count()` + `skip/limit` 分页（照抄 `generateSummaryReport:90-98` 的写法），并在超额时返回 `truncated:true` 让前端提示。

**H2｜带价报表读取侧未过滤 `payable_flag`/`is_manual`，前端据此算出的「合计」虚高**
`getReportDetail/index.js:98-127`（`store_receipt_report` 与 `store_receipt_price_report` 共用一个分支，`receipt_item` 全量 map，无过滤）
对照生成侧：`createReceipt:583`（`items.filter(item => item.payableFlag && !item.isManual)`）、`:664`（供应商带价同款）、`dataService:1173`、`:1233`。
触发：任意存在质量/错货异常行、缺价行（`missing_price`）或手动商品行的收货单。
影响：带价账单的 CSV 只有可付款行、合计只含可付款金额，而应用内详情表格把不可付款行也列出来并显示金额；前端 `report-detail.js:53-55` 直接 `rows.reduce(...subtotal)` 求和 → **页面「合计」大于导出文件「合计」**，用于对账的账单金额失真。
建议：`type.includes('price')` 时在读取侧补同一过滤条件（`payable_flag !== false && Number(price_snapshot) > 0 && !is_manual`），并回传 `excluded_rows`（生成侧已存该字段，`createReceipt:606`）。

**H3｜分批收货的门店收货报表，详情页可能展示别的批次的明细**
`getReportDetail/index.js:100-103`：`receipt.where({ purchase_order_id: orderId }).limit(1).get()`，**无 `orderBy`、未按 `batch_no` 定位**。
触发：订单分批收货（`createReceipt:426` `batch_no = 已提交收货单数 + 1`，`:440` `is_final: isFinalBatch`），该订单产生 ≥2 张 `store_receipt_report`（每张 `report_id: 'RPT_SR_'+receiptId`，`createReceipt:567`），它们共享同一个 `source_order_id`。
影响：点第 2 批报表进详情，可能拉到第 1 批的 `receipt_item`；命中哪批取决于数据库返回顺序，结果不稳定、无法复现。
建议：报表记录里加 `source_receipt_id`（生成时已有 `receiptId`），读取侧优先按它取；至少补 `orderBy('batch_no','asc'|'desc')` 使结果确定。

**H4｜报表文件全为 CSV，但前端 `openDocument` 未传 fileType，应用内打开必然失败（跨批次，需前端配合）**
云侧核实：全项目 14 处报表产出**全部是 `.csv`**（`generateSummaryReport:231`、`createReceipt:563,596,645,680`、`createPurchaseOrder:361,410`、`dataService:427,468,967,1158,1185,1218,1245`），无 xlsx/pdf。
前端：`pages/report-detail/report-detail.js:103` `wx.openDocument({ filePath, showMenu: true })` 未传 `fileType`。
影响：小程序 `openDocument` 官方支持 `doc/docx/xls/xlsx/ppt/pptx/pdf`，**csv 不在支持列表** → 点击「导出报表文件」大概率失败并弹「打开失败」，用户只能靠转发链接离线打开。
建议：导出改为 `type:'xlsx'`（需云侧转格式）或在前端 `wx.setClipboardData`/引导下载；至少在云侧把扩展名与内容对齐、并在返回体里回 `fileType`。

**H5｜`getNextVersion` 自增后回读导致版本号碰撞，汇总报表出现重复 `report_id`**
`generateSummaryReport/index.js:57-63`（`update(_.inc(1))` 之后 `get()` 回读）+ `:239`（`report_id` 由 `v<version>` 派生）；同一实现复制于 `createPurchaseOrder:81-87`、`createReceipt:81-87`、`dataService:364-...`。
触发：同一门店同一日期并发点两次「生成汇总」（含双击/两台设备）。
影响：两次拿到相同 `version` → 两条 `report_file` 记录 `report_id` 完全相同；`getReportDetail:62-65` 无 `orderBy` 的 `limit(1)` 命中哪条不确定 → 展示与下载错位；`report-list.wxml:34` `wx:key="reportId"` 撞 key。
建议：把「自增 + 回读」改为 `_.inc(1)` 后直接用 `update` 返回结果，或用 `where({_id}).update({data:{count:_.inc(1)}})` 配合 `transaction`；或在 `report_id` 后追加唯一后缀（如 fileID 尾部随机段，L231 已有）。

### 中级

**M1｜`supplier` 角色无任何报表读取入口，但库里存在 4 类 supplier 报表**
`getReports/index.js:64-66`（else 分支 `-403`）、`getReportFileUrl/index.js:50`（非 chef/store_manager 一律拒绝）。生成侧持续产出 `supplier_order_report`/`supplier_receipt_report`/`supplier_receipt_price_report`（`createPurchaseOrder:414`、`createReceipt:649,684`），`getReports:68-72` 白名单也允许该 type。
影响：供应商账号永远看不到自己的订货/到货/账单报表，只能靠线下；管理员代看时也无法以供应商身份代查。
建议：为 `supplier` 增加 `report_scope:'supplier' && scope_id === user.default_supplier_id` 分支（与 chef 对称）。

**M2｜月汇总的 `related_date` 取「点击日」而非月初，版本号也按点击日计数**
`generateSummaryReport/index.js:227`（`relatedDate = date`）、`:244`（落库 `related_date`）、`:228`（`getNextVersion(reportType, storeId, date)`）。
触发：同一门店 10 月 5 日点一次月汇总、10 月 12 日再点一次。
影响：两条月汇总 `related_date` 分别为 `2026-10-05`/`2026-10-12`，版本号各自从 v1 起算；`getReports` 按日期筛选/排序时两张报表分散在不同日期，详情页 `report-detail.wxml:11` 显示「日期: 2026-10-05」但内容是整月。
建议：月汇总统一 `related_date = date.slice(0,7) + '-01'`（或另设 `period_start/period_end` 字段），计数器 key 同步改为月份。

**M3｜汇总金额口径包含「不可付款但已计价」的异常行，与带价账单之和不等**
`generateSummaryReport/index.js:191` 只剔除 `is_manual`，未剔除 `payable_flag === false`（质量/错货异常、缺价）；`price_snapshot > 0` 的异常行照常进金额（`:211`）。
对照：`createReceipt:360-364`（手动行 `payableFlag=false`；hardAbnormal 或 0 价 `payableFlag=false`）+ 带价报表过滤（`:583`/`:664`）。
触发：门店当月存在被标记为质量问题/错货/缺价的收货行且该行有协议价。
影响：门店月汇总金额 > 同期带价格账单金额之和，对账时两边对不上；CSV 里没有任何口径说明（`:220` 表头无备注）。
建议：汇总金额同样按 `payable_flag` 过滤，或在 CSV 头部加「口径：仅可付款行」一行说明；同时在 `report_file` 落 `excluded_rows`（与 `createReceipt:606` 对齐）。

**M4｜汇总报表非幂等，重复点击累积多份文件与记录**
`generateSummaryReport/index.js:228-255`。触发：用户在 `report-list.js:133-155` 重复点「生成今日日汇总」（无防抖、无已存在检测）。
影响：同店同日堆积 v1/v2/v3…；无「复用已有未变更报表」判断；空数据日也生成空报表（`:182-185` + `:214-224`）。
建议：生成前查 `report_file` 是否已存在同 `(report_type, scope_id, related_date)` 且 `status==='generated'` 的记录，命中则提示复用；`receipts.length === 0` 时直接返回「当日无收货数据」不消耗版本号。

**M5｜getReports 的 `role`/`storeId` 入参是死参，管理员无法按门店收窄**
`getReports/index.js:43` 解构后全文未再使用（已用 grep 确认）。
影响：`report-list.js:70,75` 与 `report-history.js:57,62` 都传了 `storeId`（当前切换门店），但管理员永远拿到全门店报表；用户切了门店筛选后看到的仍是全量，产生「筛选无效」的错觉。chef/store_manager 不受影响（服务端强制自身门店）。
建议：管理员分支支持 `query.scope_id = storeId`（需同时支持 `report_scope:'supplier'` 时用 `supplierId`）。

**M6｜店长可生成汇总的权限被前端隐藏**
云侧允许 `store_manager` 生成汇总（`generateSummaryReport:160`），前端 `report-list.js:127-131` 只放行 `['super_admin','purchaser']` 并 toast「仅管理员可生成汇总报表」。
影响：店长端「生成汇总 ▸」入口点了必然被拦（wxml:6 无条件显示），前后端口径不一致。
建议：二者取一：要么前端按 `store_manager` 放开，要么云侧把 `store_manager` 从 L160 移除。

**M7｜打开汇总报表详情每次全量下载并重新解析 CSV**
`getReportDetail/index.js:203-206`。触发：反复打开同一张汇总报表详情。
影响：每次一次云存储下载 + 全文字符串解析，无缓存、无 ETag/版本复用；列表页反复进入详情时延迟明显，且与「导出文件」重复走一遍下载。
建议：生成时把结构化 `rows` 存进 `report_file`（或独立集合），详情页直接读库；CSV 仅用于导出。

**M8｜`total_amount`/`item_count` 字段全项目无人消费，且 `item_count` 语义易误读**
写入仅 `generateSummaryReport:252-253`；读取：`getReports` 原样回传（`getReports:91-96`）但 `report-list.wxml`/`report-history.wxml` 均未渲染，`report-detail.js:46-59` 重新用 `rows` 求和而忽略 `total_amount`。`item_count` 实为「供应商×商品分组数」（`:214` `rows.length`），不是明细行数；CSV 合计行也不给数量合计（`:224`）。
影响：字段冗余；若后续有人拿 `item_count` 当行数用会算错。
建议：要么前端用上（列表显示金额/行数），要么删字段；`item_count` 改名 `group_count`。

**M9｜`receipt_abnormal` 订单既不能补收也不能作废，但其收货明细仍计入日/月汇总（口径注释与实现矛盾）**
`createReceipt/index.js:386` 注释称「receipt_abnormal 状态允许继续补收」，但 `:392` 的白名单是 `['approved','report_generated','partial_received','to_receive']` —— **不含 `receipt_abnormal`**；同时 `dataService:1294-1296` 拒绝作废有收货记录的订单。
触发：任一批次收货带异常 → 订单推进为 `receipt_abnormal`（`createReceipt:509` `nextStatus = isFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'`）。
影响：该订单卡死在 `receipt_abnormal`——不能再收、不能作废、只能走异常流程；而 `generateSummaryReport` 无状态过滤，这批异常明细仍计入汇总金额（与 M3 叠加）。
建议：注释与实现二选一（要么白名单补 `receipt_abnormal`，要么删注释）；汇总侧至少按 `payable_flag` 对齐带价口径。

### 低级

**L1｜`safePathPart` 在本函数内定义了但从未调用**
`generateSummaryReport/index.js:48-50` 定义，全文 0 处调用；`:231` 把 `storeId` 直接拼进 `cloudPath`。店长侧已被 L174 强制成 `user.default_store_id`，但 `purchaser/super_admin` 可传任意 `storeId`（仅在 L178 校验存在于 `store` 集合）。
影响：若门店档案里存在带 `/ \ 空格` 的 `store_id`，路径段可能被解释为目录（其他生成函数都用 `safePathPart(storeName)`，此处漏用）。
建议：补 `safePathPart(storeId)`。

**L2｜`getReports` 的 `relatedDate` 只校验格式不校验真实日历日，且排序无次要键**
`getReports/index.js:47`（正则放行 `2026-02-31`）；`:93` 仅 `orderBy('generated_at','desc')`。对照 `generateSummaryReport:72-76` 的 `isDate` 有真实日历日校验 → 同项目两种严格度。
影响：非法日期查询返回空列表且无提示；同毫秒落库的多条报表在翻页边界可能重复/漏行。
建议：复用 `isDate`；加 `.orderBy('report_id','asc')` 作为次要键。

**L3｜生成侧与读取侧舍入方式不一致，可差 1 分**
`generateSummaryReport:211` `Math.round(q*p*100)/100` vs `getReportDetail:118,189` `(q*p).toFixed(2) * 1`。
影响：`q*p` 恰好落在 `x.xx5` 的二进制边界时（如 1.005）两种写法结果不同（`Math.round` → 1.01，`toFixed` → 1.00）。
建议：统一为 `Math.round(v*100)/100`。

**L4｜`getReportDetail` 的 `subtotal` 无空值保护**
`getReportDetail/index.js:118,189`：`item.received_qty * item.price_snapshot` 若字段缺失 → `NaN.toFixed(2) * 1` = `NaN`，前端渲染成「¥NaN」。
影响：历史数据或补价前生成的报表可能缺 `price_snapshot`。建议：`Number(...) || 0` 后再算。

**L5｜多处单查询 `limit(1000)` 无分页**
`getReportDetail:88`（`purchase_order_item`）、`:108`（`receipt_item`）、`:144`、`:175`。
影响：单个订单/单批收货明细超 1000 行时静默截断（云函数侧 `limit` 上限即 1000）。当前业务下单量远小于此，属结构性隐患。
建议：与 `generateSummaryReport:110-117` 的分页写法对齐。

**L6｜`report_file.status` 实际只有 `generated` / `superseded` 两个值（核实项 5 定论）**
写入：`status:'generated'` 共 11 处（`createPurchaseOrder:369,418`、`createReceipt:571,604,653,688`、`dataService:435,476,975,1166,1193,1226,1253`、`generateSummaryReport:251`）；`status:'superseded'` 仅 2 处（`dataService:416` 审核改量、`:1318` 订单作废）。`getReports` 不按 status 过滤，已作废报表仍可看可下载（审计留痕，符合设计）。
另：`order_status` 侧的 `pending_approval` / `report_generated` / `to_receive` / `completed` **确认无任何写入方**（grep 全项目仅出现在白名单数组、`statusMap`、`getSupplierOrders:14` 的 DONE 列表、`updateProductPrice:43`、`authService:632` 中）；`order_status` 的实际写入值只有 `submitted`（`dataService:1413`）、`event.status`（`dataService:552`）、`cancelled`（`dataService:1303`）、`nextStatus`（`createReceipt:512` → `received`/`receipt_abnormal`/`partial_received`）。报表相关状态不依赖这些死状态，报表链路不受影响。

**L7｜`report_version_counter` 无种子数据、依赖运行时自动建集合**
`generateSummaryReport:56-67`：先 `doc(counterId).update()`（文档不存在时 `stats.updated === 0`）→ 走 `counters.add({ _id: counterId, count: 1 })`，`add` 失败（并发撞 `_id`）被 `catch` 静默吞掉后重试，3 次全失败抛 `getNextVersion: 计数器更新失败`。`seed-data/` 下无该集合样本（已确认）；`README.md:111` 声明「由云函数首次调用自动创建，无需手工建表；若环境权限禁止自动建集合，请手动创建空集合」。
影响：若目标环境未预先创建该集合且禁止自动建集合，**首次生成任何报表都会抛错并返回通用 `-1 汇总报表生成失败`**，报错信息无法定位。
建议：在部署清单里显式创建 `report_version_counter`，或把 `add` 的异常带出到 `console.error` 并返回更具体的 msg。

---

## 7. 跨批次待核实项

| # | 要确认什么 | 去哪里找 | 本文定论 / 结论 |
|---|---|---|---|
| 1 | 报表链是否受 F1（嵌套 `{error}` 吞 401）影响 | 4 个函数全文 | **不受影响**：全部顶层扁平 `{code,msg}`，0 处嵌套（见 §0 计数表） |
| 2 | 报表粒度到底是「每单」还是「每日聚合」 | `createPurchaseOrder:365,414` / `createReceipt:567,600,649,684` vs `getReportDetail:133-136,164-167` | **生成侧一律每单**（带单一 `source_order_id`）；**读取侧按日聚合多单** → 读取侧错，以文件为准（H1） |
| 3 | 带价报表读取侧是否漏过滤 | `getReportDetail:98-127` vs `createReceipt:583,664` | **确实漏了**（H2） |
| 4 | 报表文件格式 | 14 处 upload 调用 | **全部 `.csv`**，无 xlsx/pdf；`report-detail.js:103` `openDocument` 未传 `fileType` → 应用内打开大概率失败（H4，需 06 侧前端修） |
| 5 | 供应商确认单白名单漏 `receipt_abnormal` 是否也影响报表统计 | `confirmSupplierOrder:13`（属 02 批） | **报表统计不漏**：`generateSummaryReport` 无状态过滤，`receipt_abnormal` 的收货明细照常计入（M9）；白名单问题在 02 批 |
| 6 | `report_version_counter` 创建方式 | `generateSummaryReport:56-67` + `README.md:111` | **运行时自动 upsert**（`doc().update()` 失败回退 `add()`），非假定已存在；但环境禁止自动建集合时首次生成会失败（L7） |
| 7 | 报表状态流转实际用什么值 | 全项目 grep | `report_file.status` 只有 `generated`/`superseded`（L6）；`order_status` 的 4 个死状态不影响报表链路 |
| 8 | `report-detail.js:103-108` 未传 `fileType` 是否已被 06 批记录 | `docs/exploration/full-scan-06-pages-report.md` | 需 06 侧确认；若已记录，请标注**根因在云侧统一产出 CSV**（本文 §H4），前端单独改 `fileType:'csv'` 未必生效 |
| 9 | 分批收货下同一订单有几张收货报表 | `createReceipt:426,440,567`（02 批） | 每张 `receipt` 一份 `store_receipt_report`（`report_id: 'RPT_SR_'+receiptId`），共享 `source_order_id` → 触发 H3 |
| 10 | 前端 `report-list`/`report-history` 的 `role` 兜底 `'purchaser'` | `report-list.js:42,69`、`report-history.js:56,61` | 与 getReports 的死参（M5）叠加：`role`/`storeId` 传了但服务端不用；权限仍由服务端 `user.role` 决定，不构成越权 |
| 11 | `total_amount`/`item_count` 是否被任何页面消费 | `pages/report-*/**` + `utils/cloud.js:212-224`（`normalizeReport` 未映射这两个字段） | **无人消费**（M8）；`normalizeReport` 也未映射，若前端要用需补映射 |
