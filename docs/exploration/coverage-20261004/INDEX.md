# 全面覆盖勘探 · 2026-10-04 · 总览索引

> 基线：`backup` @ `07b6461`（fix(supplier): restrict order visibility and actions until internal approval）
> 方式：8 个子代理并行，全程只读，唯一写入为 `docs/exploration/coverage-20261004/`。
> 未修改任何业务代码，未 commit / push / 切分支。

## 一、覆盖范围

| 报告 | 领域 | 规模 |
|---|---|---|
| [01-identity-dataservice.md](01-identity-dataservice.md) | authService + dataService | 2365 行全读 |
| [02-create-purchase-receipt.md](02-create-purchase-receipt.md) | createPurchaseOrder + createReceipt | 1333 行全读，43 条问题 |
| [03-purchase-read-report.md](03-purchase-read-report.md) | 采购读侧 + 报表 7 函数 | 1129 行全读，40 条问题 |
| [04-product-supplier-cloud.md](04-product-supplier-cloud.md) | 商品/价格/供应商 8 函数 | 940 行全读 |
| [05-pages-purchase-receipt.md](05-pages-purchase-receipt.md) | 采购/收货/审批/异常 8 页 | 32 文件 3295 行全读 |
| [06-pages-admin-report.md](06-pages-admin-report.md) | 后台管理 + 报表 9 页 | 36 文件 3042 行全读 |
| [07-infra-auth-supplier-pages.md](07-infra-auth-supplier-pages.md) | 基础框架 + 供应商端 | 71 文件全读 |
| [08-data-contract-doc-audit.md](08-data-contract-doc-audit.md) | seed-data + 文档契约审计 | 13 集合 136 字段 / 2490 行文档 |

**结构清点结论**：19 个云函数目录**均只有 `index.js` + `package.json`**，全仓 `cloudfunctions/**/*.json` 仅 19 个 package.json → 无 config.json、无公共模块、无被遗漏的配置层。页面注册 26 页 ↔ 磁盘 26 目录**双向全闭合**，无死页面、无未注册页面，无死图片资源。上传包实测 455KB。

---

## 二、最高优先级（功能已坏 / 金额错 / 可锁死）

### P0-1 收货附件校验回归 — 功能 100% 阻断
`createReceipt:224` 附件校验写成 `id.startsWith('receipts/{单号}/')`，但 `wx.cloud.uploadFile` 返回的 fileID 以 `cloud://` 开头（`utils/cloud.js:239` 直接透传，前端未剥离）。
→ **带照片提交收货、手动单付款凭证核销两个功能完全跑不通**（不带照片仍可）。同型：`dataService:1560`。
来源：02。**这是最近的改动引入的回归，不是历史遗留。**

### P0-2 `createReceipt:224` 之外，`getReportDetail` 重建逻辑取错数据
- `getReportDetail:100-103` 收货报表重建 `receipt.limit(1)` **无 orderBy** → 分批收货取到哪张 receipt 不确定，**第 2 批及以后的详情显示错批次**。
- `getReportDetail:135-169` 供应商类重建按日取 `limit(200)` **无分页**且**忽略 `report.source_order_id`** → 详情页是「当日全门店并集」，而 CSV 里只有 1 单 1 批，**两边对不上**。
- `getReportDetail:130-160` 两条供应商类分支**无 `order_status` 过滤** → 草稿/待审批订单行进入重建，与最新 commit 收紧的口径不一致。
来源：03。

### P0-3 汇总「下单数量」成倍放大
`generateSummaryReport:218` 按 `receipt_item` 逐行累加 `order_qty_snapshot`，而该字段是**整行订单量**、不是本批量 → 分批收货时成倍放大（实收数量与金额仍正确，所以更容易被忽略）。
来源：03。

### P0-4 停用门店会让该店账号集体登录失败
`authService:642` 的 `ACTIVE_ORDER_STATUS` **漏 `receipt_abnormal`**（`createReceipt:555` 的真实终态）→ 停用门店的在途单检查失效；且停用前不检查该店是否还有活跃账号 → 该店 chef/store_manager 集体登录失败。
来源：06。

### P0-5 最后一名超管保护被写死在用户名上
`authService:479-494` + `:393-440`：「最后一名超管保护」限定 `username === 'admin'`，非 admin 超管停用/降权不校验在岗超管数，`updateUser` 无任何保护。
→ **可把在岗超管数清零，管理入口永久锁死。** 旧报告只看到两个子问题，漏了这个根因。
来源：01。

---

## 三、安全与越权

| # | 级别 | 位置 | 问题 |
|---|---|---|---|
| S1 | 高 | `dataService:729-736` | `getAbnormalRecords` **无角色闸门**（`requireUser` 未传白名单），供应商走 `default_store_id === undefined` 分支退化为无过滤 → 跨门店读异常记录（含裁决、供应商名） |
| S2 | 高 | `getSupplierOrders:127-130` | `{...order, items}` 全量展开主表 → 供应商拿到 `supplier_confirmations`（**同单所有供应商的确认状态，可横向比价**）、`audit_remark`、`audited_by` |
| S3 | 中 | `getSuppliers:58-59` | `status` 参数直写 `query.status`，而 `includeInactive` 的 -403 守卫只在 `else if` 分支 → chef/store_manager 传 `status:0` 即可读出**全部停用供应商档案及联系方式** |
| S4 | 中 | `getStores:310-331` | **无角色门禁** → supplier 可枚举全部门店名+编号；purchaser 传 `includeInactive:1` 可取含停用门店的全量 |
| S5 | 中 | `getProducts:43-45` | 唯一漏网的无角色白名单云函数 |
| S6 | 高 | `createReceipt:320-329`+`:362` | `receiptDate` 完全客户端可控且无上下界，直接决定取价区间 `_.lte(receiptDate)` → **传更早日期可让同一批货按任意历史价结算** |
| S7 | 中 | `createReceipt:62-63` | `isQualityIssue`/`isWrongItem` 零校验零二次确认 → 可把全额到货行标成质量问题，**整行剔出供应商带价账单**，无痕迹区分真异常与人为压价 |
| S8 | 低 | `getSuppliers:61` | `db.RegExp({regexp: keyword})` 未转义客户端输入（前端实际走本地过滤，仅直调可触达） |

**正面结论**：供应商端 4 页 7 处调用，`supplierId` **全部由服务端从会话派生，前端 0 处传参**。采购读侧 + 报表 7 函数**未发现跨门店/跨供应商的现行越权**，也没有「先查全量再内存过滤」型风险，`getReportFileUrl` 三道防线越权不成立。

---

## 四、系统性缺陷（横切多文件，修一处收益最大）

### X1 嵌套 -401 导致会话过期不跳登录 ★四份报告独立命中
`dataService:46-49`、`dataService:644-646`、`authService:334-338` 把 `-401/-403` 包成 `{error:{code,msg}}` 嵌套结构，而 `utils/cloud.js:68` **只判顶层 `code`**。
→ 会话过期后不跳登录页，而是反复弹「加载失败」，且 toast 拿到 undefined 的 msg。
影响面：`message`、`supplier-messages`（纯 dataService 页面）、`importProducts:52-59`、后台管理 10 个写操作全部中招。
来源：01 / 04 / 06 / 07 四份独立命中。

> **注**：这纠正了旧报告的一个误判——旧报告说「17 个 dataService 调用点会话过期静默」，05 验证发现 `requireUser` 的 25 处调用点返回的是**内层** `-401`（即顶层），能正常跳登录。**真正静默的只有上面这几处手写嵌套的地方。**

### X2 停用用户不清 `sessions` 数组 ★三份报告独立命中
`authService:499-504`：停用只清 `session_token_hash`（legacy 字段），**不清 `sessions` 数组**，而校验查的正是 `sessions` → 停用→再启用后旧设备会话在 7 天 TTL 内复活。
`:470-472` 的注释自称已防复活，实际未防；`changePassword`/`updateUser`/`resetPassword` 三处都清了，**唯独这里漏了**。
来源：01 / 07 / 08 三份独立命中（08 同时确认「修复计划 P1-7」标记已完成但代码未落实）。

### X3 `limit` 无分页导致数据静默消失
- `getSupplierOrders:72-76`：`purchase_order_item` 一次 `limit(1000)` 无分页无 orderBy，**订单集合/total/statusCounts/内存分页全部建立在这份截断集合上** → 按每单 5 行、每天 3 单约 2 个月触顶，**老订单整体消失且无任何提示**。
- `getPurchaseOrders:119-124`：明细按 20 单分块但 `limit(1000)`；20 单 ×100 行 = 2000 → 静默截断明细。
- `getSupplierOrders:117`：`String(Date).localeCompare` 字典序由星期名主导 → 跨月错乱 + 内存分页 → 顺序错乱、翻页重复/遗漏。
- `getProducts:56-59`：keyword 过滤发生在 `limit(200)` **之后** → 超 200 条搜索漏项。
- `getReports:43`：解构 `storeId` 但 `:49-66` 从未引用 → 管理员切门店后报表仍全量。
- 5 个后台管理列表页全部单次全量拉取 + 服务端硬 limit（100/200/100），超量静默丢失。

### X4 CSV / 报表导出链路
- `report-detail.js:96-125`：`wx.openDocument` 打开 `.csv` **未传 `fileType`**；已补证全部 8 类报表落库均为 csv → **导出必然失败**，showMenu 转发另存一并失效。
- `generateSummaryReport:199-223`：汇总只剔 `is_manual`，**未剔 `payable_flag===false`** → 汇总总额恒大于同日带价报表/账单合计。
- `createReceipt:45`、`createPurchaseOrder:43`：`csvField` 防公式注入正则 `/^[=+\-@]/` 漏 `\t`/`\r`/`\n`；`items[].remark` 零校验 → chef 可把公式注入报表。
- `getReportDetail:211`：先 `split('\n')` 再 parseLine，而 `csvField` 不转义字段内换行 → 商品名含换行时**字段错位**。
- `getReports`/`getReportDetail`/`getReportFileUrl` **三处都不过滤 `report_file.status`** → 改量后旧版仅标 superseded，内部人员仍可下载审核前版本。

---

## 五、最新 commit（`07b6461`）修复的覆盖验证

**结论：in-app 供应商入口已闭合，但报表导出通道未覆盖，且存量数据不生效。**

已闭合 3 项：
1. `getSupplierOrders:12` HIDDEN 集合追加 `submitted`/`pending_approval`，且与 `confirmSupplierOrder:12-13` 写入侧白名单口径一致。
2. `confirmSupplierOrder` 两个白名单去掉 `submitted`（条件更新原子拦截）。
3. 4 个报表函数对 supplier 一律 `-403`。

未覆盖 3 项：
1. `createPurchaseOrder:440-490` 在 `submitted`（**审核前**）即生成上传供应商订货 CSV，而三个报表读取函数都不过滤 `report_file.status` → 内部人员可下载审核前版本线下转发。
2. `auditOrder` 的 rejected 分支**不标 superseded** → 被驳回单的供应商订货单永久停在 `status:'generated'`。
3. `dataService:406-410` 确认状态只在**改量**时清空 → 修复前写入的「审核前确认」若该单后续没改量则残留。**修复增量有效、存量不生效。**

规则不对称：`getSupplierReceipts` 本函数无校验，屏障唯一地在 `createReceipt:239/417`；`getProductPrices`/`getProducts`/`importProducts` **完全没有闸门**——因为 `supplier_product_price` 与 `product` 集合根本没有审批字段，导入即 `status:1`、调价即时可见。

---

## 六、「假成功」问题（用户看到成功、实际失败）

| 位置 | 问题 |
|---|---|
| `abnormal-list.js:78-79` | `paymentDecision = payConfirmed ? 'pay_received' : 'reject'`，而 `util.showConfirm` 在弹窗**调用失败时 resolve(false)** → 弹窗失败或用户随手取消都被当成业务裁决「维持不可付款」提交，**同时把异常标记 resolved 并弹成功 toast** |
| `receive-verify.js:23-25` | 补偿逻辑 `receipts[0]` 假定首元素即本次单 → 分批收货后已有历史收货单时，**一次真实失败的提交被判成「验收完成」并引导去报表中心** |
| `report-detail.js:77-79`+`wxml:146` | 云函数失败只 toast，页面走 `wx:else` 显示「报表数据加载中...」→ **失败伪装成加载中**，无限等待无重试 |
| `dataService:1523-1541` | `.catch` 里 `return {code:-1}` 只作为 Promise 结果被 `await` 丢弃 → `remindAudit` 消息写失败**仍返回 `code:0`**，前端显示「已催办」但消息未写入 |
| `report-history.wxml:5`+`js:81` | 副标题「共 N 份」读已加载条数，`result.total` 从未入 data → 超 20 条**永远显示「共 20 份」** |

---

## 七、需要你拍板的事项

1. **凭据材料在版本库**：`seed-data/app_user.json` + `supplier_test_user.jsonl` 含 **6 条 PBKDF2 凭据材料**（salt+hash+120000 次迭代），其中 **U004 有两份互相冲突的 salt/hash**。且 **`.gitignore:8` 声明忽略 `seed-data/`，但 `git ls-files seed-data/` 实际返回 15 个文件**——声明与追踪状态矛盾。
   正面：云环境 ID 全是 `DYNAMIC_CURRENT_ENV`，appId/secret/apiKey 全库 0 命中，packOptions 已排除 seed-data → **上传包不含凭据**，风险限于仓库本身。
   **是否 `git rm --cached seed-data/` 属于工作流决策，本轮未执行。**

2. **`transaction.rollback({code,msg})` 的 SDK 语义未验证**：全库 5 处 `rollback` 后紧接 `return`，依赖「rollback 传参会使 `runTransaction` reject」这个未验证假设（`createReceipt` 用的是 `throw`）。若假设不成立，`createPurchaseOrder:373-374` 会把 `persistedOrderNo` 设为**从未落库**的订单号 → **幻影订单 + 为不存在的订单生成报表**。建议统一改为 `throw`。目录无 node_modules、网络不可达，本轮无法实测。

3. **`_.set({})` vs 裸 `{}`**：`dataService:412` 用 `supplier_confirmations: _.set({})`，而 `cancelOrder:1389` 用裸 `{}`。若 `_.set` 语义是「已存在则不变」，则改量审核**永远不重置供应商确认状态**（`:409` 前置条件已保证字段存在非空）。建议统一为裸 `{}`。

4. **`dataService:1513-1516`** 是全仓唯一一处 `$or` 对象键写法（其余 4 处用 `_.or()`）。若 SDK 不支持则 `remindAudit` 完全不可用。

5. **补结算会「解决」异常**：`dataService:1147-1149` `settleReceipt` 把异常记录静默写为 `status:'resolved'`，与业务清单 #15（异常责任人与时效）**尚未拍板**直接冲突。历史报告均未记录。

6. **seed 数据会让回归测试误判**：seed 的 `abnormal_id` 是 `ABN20260805001`，运行期是 `RCP…_1_shortage`，`settleReceipt:960-962` split 后 `parts.length<3` 直接 `continue` → **seed 这条异常单永远无法转回可付款**。

7. **官方导入模板 100% 失败**：`importProducts:149` + `seed-data/product-import-template.md` —— 模板示例的二级分类「叶菜类」「禽类」系统中不存在，一级分类「蔬菜」「肉禽」与代码要求的 `category_level_1_name`（仅后厨/前厅）不符 → **照抄唯一官方示例必然导入失败**。

---

## 八、旧报告勘误汇总

本轮以当前代码为准复核，**推翻或大幅修正**的旧结论：

| 旧结论 | 实际情况 |
|---|---|
| `pending_approval`/`report_generated`/`to_receive` 是「死状态」，`to_receive` 是「陷阱态」 | **误判**。三者均有活跃读取方（`auditOrder`、`cancelOrder`、`getOrderStats`、`getPurchaseOrders`、`confirmSupplierOrder`、`updateProductPrice`）。事实是**有读无写**，按旧结论清理读取侧会引入新缺陷 |
| 「17 个 dataService 调用点会话过期静默」 | **误判**，缺陷不存在。`requireUser` 的 25 处返回内层 `-401` 即顶层，`cloud.js:68` 能正常跳登录。真正静默的只有手写嵌套的那几处（见 X1） |
| 「汇总类报表对门店角色不可达」 | **误判**。`store_manager` 可达本店汇总，仅 chef 不可达 |
| 「传空 fileId 会命中首条种子记录」 | **误判**。`getReportFileUrl:44` 已前置拦截空串 |
| 「CSV 解析器正确处理行内换行」 | **误判**。见 X4 |
| 「`supplier-home`/`index` 会话过期静默」 | **误判**。这两页同时调扁平 `-401` 的函数，仍会跳登录 |
| 「`createPurchaseOrder` catch 引用 try 内 `const orderData` 必然 ReferenceError」 | **已修复**：补偿逻辑抽为模块级 `markOrderReportsMissing` |
| 建议把 `includes`「✅通过」改为 `indexOf===8` | **改坏了**：现改为 `startsWith`，从「子串可穿越」变成「合法值也全部拒绝」 |
| deep-04 迁移图把 `receipt_abnormal` 画成「可继续补收」 | **与代码矛盾**：两个白名单都不含它，实际拒绝补收且无作废出口 → **永久死角** |
| 修复计划 P1-7「停用清 sessions」标为已完成 | **未落实** |
| 修复计划 L4「单据号随机后缀」标为已完成 | **未落实**，`updateProductPrice:103` 仍是 `Date.now()` |
| 业务清单 #22「必须收齐才能核销，已实施」 | **已回退**：`dataService:1578-1580` 已按 10-03 P0-7 放宽到三态，拍板记录与流程图文案都没跟上 |
| 流程图与业务清单 S1「确认接单含 `submitted`」 | **与代码不符**：`CONFIRMABLE=['approved','report_generated','to_receive']` 不含 `submitted` |

**文档自检问题**：业务清单存在三处「章节正文 vs 自身索引表」状态矛盾（`:539-551` #15、`:555-559` #16、`:786` #13 与 `:525`），按章节读会得到「未拍板」的错误结论。

---

## 九、跨报告交叉证实清单（可信度最高）

| 缺陷 | 独立命中 |
|---|---|
| `authService:499-504` 停用不清 `sessions` | 01 / 07 / 08 |
| 嵌套 `-401` 会话过期不跳登录 | 01 / 04 / 06 / 07 |
| `getSupplierOrders:127` 订单层 `supplier_confirmations` 泄漏 | 02 / 04 / 07 |
| `getSuppliers` status 绕过守卫 + RegExp 注入 | 04 / 06 / 07 |
| `updateProductPrice:43` 波及计数漏 `receipt_abnormal` | 02 / 04 |
| `getStores` 无角色门禁 | 01 / 06 |
| 死状态「有读无写」 | 01 / 08 |
| `getReports:43` storeId 死参数 | 03 / 06 |

---

## 十、历史勘探的覆盖盲区（本轮已补）

31 份历史报告共 15,982 行、5 个批次。编号不对齐（full-scan 缺 07，跨批次会踩空）。本轮补上此前**从未被任何报告覆盖**的区域：

1. `采购流程图.html` 逐节点核对（最接近的一次只做「状态词频抽样」）→ 补出 3 处状态窗口不符 + 2 处表述过松
2. `scripts/` 目录内容（连敏感信息审计也未覆盖）
3. `utils/meta.js` 状态字典完整消费面（18 键中 3 死状态、1 与 order 混表）
4. `styles/`/`assets/` 的实际页面消费映射 → 查出 44 条零引用图标规则 + 163 行死样式
5. `getReportDetail`/`getReportFileUrl` 的 supplier -403 分支
6. `generateSummaryReport` 金额是否满足审查报告 §8.2 等式 2
7. `approval-list`/`approval-detail`/`store-switch` 三页专项报告
8. 「内部审批」维度整体（旧报告从未审视过这个维度）

**另注**：`importProducts` 与导入模板的逐列比对，本轮只确认了分类维度 100% 不匹配，未做全列比对，仍属未验证项。

---

## 十一、工程质量观察（非缺陷）

- `utils/` 三个文件名与职责**全部错位**：`cloud.js`=云函数调用封装、`auth-guard.js`=登录守卫、`meta.js`=状态字典。旧报告长期把 `meta.js` 当「角色/门店元数据」描述，实体不符。
- `getSessionUser` 在全库有 **19 份完全一致的复制副本**；约 72 行鉴权/工具代码被复制两份。
- 8 份云函数 package.json 均为 `wx-server-sdk ~2.6.3` 波浪号浮动，**无超时/内存配置声明**（`createReceipt` 最坏 30+ 次串行调用）。
- 上传包 126 文件 455KB；`login-logo.jpg` 83KB **占 18%**，两次前序审计建议压缩未处理。
- `styles/icons.wxss` 94 条规则中 **44 条零引用**仍随主包下发。
- 全组页面几乎无加载态：grep 实测后台 9 页 wxml 对 `isLoading|hasMore|loading` **0 处绑定**；`purchase-list` 与 `report-list`/`report-history` 均定义了加载标志但从未绑定 → 全页无加载指示。
- `enablePullDownRefresh` 仅 report-list / report-history 开启，10 个目标页未开。
- `enablePullDownRefresh` 与分页缺失叠加：5 个后台列表页单次全量拉取 + 服务端硬 limit。
- `report_file.total_amount` 全项目 0 处读取（前端 report-detail 自己重算）。
- 金额格式化双口径：后端 `updateProductPrice:104` 存 `Number(newPrice)` 不截位，前端只校验 >0 → 可存 `12.345`，与报表侧逐行舍入到分不一致。
