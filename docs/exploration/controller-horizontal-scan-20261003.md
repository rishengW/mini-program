# 主控横向扫描记录 2（2026-10-03）

> 目的：子代理被限定在批次边界内，看不到跨目录的机械事实。本文件记录主控自己跑的
> 全项目正则扫描与实测结论。文件级深度分析见 `full-scan-01` ~ `full-scan-08`。
> 前一份横向记录：`controller-horizontal-scan.md`（2026-10-02，F1 会话过期嵌套结构问题）。
> 方法：全项目 Grep / git diff 实测。纪律：只信代码与实测，不接受注释。

---

## H1. 前端可选链已清零 —— 项目存在「不使用 ES2020 语法」的隐含约束（需确认根因）

**实测**（工作区当前状态，已含未提交改动）：
- 全项目前端 JS（`pages/*.js`、`utils/*.js`、`app.js`）真正的可选链 `?.`：**0 处**。
- 唯一被 grep 命中的是 `utils/cloud.js:234` 的正则字面量 `/\.([a-zA-Z0-9]+)(?:\?.*)?$/`，是**正则里的字面量**，不是可选链语法。
- 空值合并 `??`：全项目 0 处。
- 云函数侧 `cloudfunctions/**`：0 处可选链。

**git 证据**（`git grep -c '\?\.' HEAD -- 'pages/*.js' 'utils/*.js' 'app.js'`）：
- HEAD 版本仅 2 个文件含可选链：`utils/cloud.js:1`（正则假阳性）、`pages/report-list/report-list.js:4`。
- 工作区未提交 diff 恰好把这 4 处改成显式判断：
  - `pages/report-list/report-list.js:42` `app.globalData.userInfo?.role || 'purchaser'` → `(app.globalData.userInfo && app.globalData.userInfo.role) || 'purchaser'`
  - `:69` 同上
  - `:70` `app.globalData.currentStore?.storeId` → `app.globalData.currentStore && app.globalData.currentStore.storeId`
  - `:145` 同 70，再 `|| ''`

**结论**：开发者在做一次**有意的、系统性的可选链清除**，且这次改动已把它清完。其他 25 个前端 JS 文件从来就没用过可选链。这不是笔误，是约束。

**推断（待核实）**：根因大概率是构建/基础库不支持 ES2020 可选链——`project.config.json` 里**没有** `"es6"` 转译开关，也没有 `miniprogramRoot`/`libVersion` 之类的显式配置。若转译关闭且基础库过低，`?.` 会直接语法错误。

**影响**：后续任何人在本项目写 `?.` 或 `??` 都可能引入构建失败。这是本项目最容易踩、且**完全不会在代码审查中暴露**的坑（本地基础库高就跑得好好的）。

**建议**：在 `project.config.json` 显式固定 `libVersion`，并在 CLAUDE.md / README 写明「本项目不使用 `?.` / `??`，统一用 `a && a.b`」。

---

## H2. 云函数调用矩阵 —— 20 个云函数全部被前端消费，无幽灵、无孤儿

`grep -rho "callFunction('[^']*'"` 全项目统计：

| 云函数 | 调用次数 | | 云函数 | 调用次数 |
|---|---|---|---|---|
| dataService | 31 | | getReportDetail | 1 |
| authService | 15 | | getReportFileUrl | 1 |
| getPurchaseOrderDetail | 5 | | createReceipt | 1 |
| createPurchaseOrder | 5 | | confirmSupplierOrder | 1 |
| getSuppliers | 4 | | generateSummaryReport | 1 |
| getPurchaseOrders | 4 | | getProducts | 3 |
| updateProductPrice | 3 | | getProductPrices | 2 |
| getReports | 3 | | importProducts | 1 |
| getReceipts | 1 | | getSupplierReceipts | 1 |

- 20 个云函数目录 ↔ 20 个被调用的云函数名：**一一对应，无缺失、无多余**。不存在「部署了但没人调」或「调了但没部署」的云函数。
- `dataService` 31 次 + `authService` 15 次 = 合计 46 次，占总调用点的大头。这两个是热点，也是鉴权改动的风险集中点。
- `getReportDetail` / `getReportFileUrl` / `createReceipt` / `generateSummaryReport` 各仅 1 个调用点 —— 报表链路是**单点调用**，任何一处前端改动都会让整条链路失效，且测试覆盖天然最薄。

---

## H3. app.json 注册表校验 —— 26 个页面全部注册，无错配

- `app.json` `pages` 数组 26 项，与实际 `pages/*/` 目录 **26 个一一对应**，无「注册了但目录不存在」、无「目录存在但未注册」。
- 首项 `pages/login/login` = 默认入口；`tabBar` 4 项（index / purchase-list / report-list / message）全部在注册表内。
- `tabBar.list[].pagePath` 均与 `pages` 数组内路径完全一致。
- `sitemap.json` 与 `"cloud": true`、`"lazyCodeLoading": "requiredComponents"`、`"__usePrivacyCheck__": true` 均在位。（sitemap 对供应商/报表页的收录策略交给 full-scan-08 核。）

---

## H4. 潜在孤儿页 5 个 —— 静态 grep 抓不到跳转，需子代理确认（很可能是动态拼路径的假阳性）

`app.json` 注册 26 页，静态可追到跳转目标的 21 页。以下 5 页**在静态字符串里搜不到任何 `navigateTo/redirectTo/reLaunch` 目标**：

- `pages/approval-list/approval-list`
- `pages/product-manage/product-manage`
- `pages/supplier-manage/supplier-manage`
- `pages/supplier-home/supplier-home`
- `pages/user-manage/user-manage`

**不能据此判定为孤儿页**。我的 grep 只匹配「`url` 与路径同一行」的写法，多行写法（`wx.navigateTo({\n url: ...`）与变量拼接（`'/pages/' + page + '/' + page`）都会漏掉。管理后台/审批/供应商入口页恰恰最可能按角色动态拼路径。
→ **已分派**：由 full-scan-05（管理后台）与 full-scan-07（供应商侧）逐一确认这 5 页的真实入口。

---

## H5. 未提交工作区改动解读

`git diff --stat`：仅 2 个文件，13 插入 / 5 删除。

1. `pages/report-list/report-list.js`（-4/+4）：即 H1 的可选链清除，**已完成、可直接提交**。
2. `project.config.json`（+10/-1）：新增 `packOptions.ignore` 忽略 `采购流程图.png` —— 该 PNG 是流程图文档产物，混在小程序根目录会进包体。改动正确且必要，但**只忽略了 PNG**，根目录同时还有 `采购流程图.html`，需确认是否也需要忽略（交给 full-scan-08）。
   - 附带发现：该文件**末尾无换行符**（diff 显示 `\ No newline at end of file`）。

---

## H6. 两次修复性 commit 触及范围 → batch2 结论的过期风险点

- `5268379` `fix(pages): navigation, permissions, loading states and guard rails`，18 文件 +229/-88，触及：
  `approval-detail(js,wxml)`、`approval-list(js,wxml)`、`index.js`、`message.js`、`product-manage.js`(+58)、`purchase-detail.js`、`purchase-list(js,wxml)`、`receive-list(js,wxml)`、`report-detail(js,wxml)`(+29)、`report-list.js`、`store-manage.js`(+81)、`supplier-manage.js`(+56)、`styles/icons.wxss`
- `3558678` `fix(cloud): align status filters, add missing_price dict and inactive store support`，4 文件 +67/-7，触及：
  `authService/index.js`、`dataService/index.js`、`getPurchaseOrders/index.js`、`getReportDetail/index.js`(+51)

**影响**：`batch2-purchase-flow.md`（2026-10-02）记录的是 `5268379` **之前**的代码，其中涉及 navigation / permissions / loading 的结论**大概率已部分失效**。
→ **已分派**：由 full-scan-07 逐条复核 batch2 中带行号的结论，产出「仍成立 / 已修复 / 结论有误」三态表。

---

## H7. 集合名对照 —— 1 个集合无种子样本，1 个种子集合无代码引用

`grep -rhoE "collection\(['\"]([a-zA-Z_]+)['\"]\)" cloudfunctions/`，云函数实际使用 14 个集合：

| 集合 | 引用次数 | 集合 | 引用次数 |
|---|---|---|---|
| purchase_order | 48 | receipt_item | 15 |
| app_user | 44 | receipt | 14 |
| supplier | 22 | purchase_order_item | 14 |
| report_file | 22 | product | 13 |
| **report_version_counter** | **4** | message | 13 |
| | | abnormal_record | 12 |
| | | supplier_product_price | 6 |
| | | store | 5 |
| | | category | 3 |

对照 `seed-data/*.json*`（14 个 + 1 个 .jsonl）：

1. **`report_version_counter` 无种子样本**（云函数引用 4 次，seed-data 无此文件）。若是 `generateSummaryReport` 运行时自动 upsert 创建的则无碍；若是假定已存在则首次生成报表可能异常。→ **待 full-scan-03 确认创建方式**。
2. **`supplier_test_user` 有种子样本但代码 0 处 `collection('supplier_test_user')`**（全项目 grep 确认 0 处）。该文件是供货商测试账号导入源（内容与 `app_user` 同构，`role: "supplier"` / `role_label: "供货商"`），不参与运行时逻辑。属正常，但注意它带**明文 password_hash + password_salt + password_iterations:120000**，与 `app_user.json` 同格式——若 `app_user.json` 也这样存，则「测试账号与生产账号同集合、密码哈希同算法」的假设成立，值得 full-scan-01 在认证部分一并核。

---

## H8. 状态/类型字典盘点（utils/meta.js）

- `statusMap`：**18 个**状态值（draft / submitted / pending_approval / approved / rejected / report_generated / received / receipt_abnormal / partial_received / completed / to_receive / confirmed / pending / processing / resolved / closed / cancelled / generated）
- `supplierConfirmMap`：**5 个**（pending / confirmed / shipped / done / cancelled），写在 `purchase_order.supplier_confirmations` 上
- `reportTypeMap`：**8 种**报表类型（store_order_report / store_receipt_report / store_receipt_price_report / supplier_order_report / supplier_receipt_report / supplier_receipt_price_report / store_daily_summary_report / store_monthly_summary_report）
- `categoryIconMap`：**14 个** emoji → icon base 映射

**待核对照**（已分派）：上述 18 个状态值是否都能在 `purchase_order` / `receipt` / `abnormal_record` 的 seed-data 与云函数写入路径中找到对应值；8 种报表类型是否与 `generateSummaryReport` 的 period/type 入参组合完整对应。

---

## H9. seed-data 编码格式不一致 —— `category.json` 是 JSONL 却用 `.json` 扩展名

实测 `seed-data/category.json`：**12 行，每行一个独立 JSON 对象，无外层数组**（JSONL 格式），但扩展名是 `.json`。任何按 `JSON.parse(整个文件)` 处理 seed-data 的脚本在此文件上都会抛错；必须按行 parse。→ **待 full-scan-08 核查其余 13 个 seed 文件的真实格式**，确认是全部 JSONL 还是混用。

**附带发现（分类图标缺失）**：`category.json` 中 3 条 `icon: ""`（category_id 8 豆制品、9 纸品、11 清洁用品），另有 4 条 `category_level_1_icon: ""`（前厅系）。`getCategoryIconBase("")` 返回空串 → 页面渲染空图标。这是数据缺口而非代码缺陷。
**反向核查已确认无失配**：`category.json` 出现的全部 11 个非空 emoji（🍳🥬🥩🦐🧂🍚🍺🧊🍽️🧹📦）**均命中** `categoryIconMap`，无「emoji 有数据但映射缺失」导致的图标空白。

---

## H10. F1 精确化：不是"函数级嵌套"，是 3 个复制的鉴权 helper —— 且 F1 仍完全成立

**F1 原描述**（2026-10-02）：`dataService` / `importProducts` 鉴权失败返回嵌套 `{error:{code}}`，前端只查顶层。该结论**成立但描述过宽**，本次实测给出精确边界。

**全项目返回结构矩阵**（`return {code: -xxx}` vs `return {error: {code: -xxx}}`）：

| 云函数 | 顶层 | 嵌套 | 调用次数 |
|---|---|---|---|
| dataService | 81 | **2** | **31** |
| authService | 53 | **2** | 15 |
| importProducts | 5 | **2** | 1 |
| 其余 16 个云函数 | 合计 177 | **0** | — |

合计：顶层 316 处，嵌套仅 6 处。

**6 处嵌套全部来自 3 个复制的鉴权 helper**：
- `cloudfunctions/authService/index.js:334` `requireSuperAdmin(event)` → `:336` (-401)、`:337` (-403)
- `cloudfunctions/dataService/index.js:45` `requireUser(event, roles)` → `:47` (-401)、`:49` (-403)
- `cloudfunctions/importProducts/index.js:52` `requireUser(event, roles)` → `:54` (-401)、`:56` (-403)

**精确化的意义**：不是"整个 dataService 都嵌套"。dataService 81 处顶层 + 仅 2 处嵌套 —— 所以**业务错误路径完全正常**（前端能看到错误码并显示具体文案），只有**鉴权失败路径**（-401 会话过期 / -403 越权）返回嵌套。用户症状因此很隐蔽：功能失败时提示正常，唯独**会话过期静默退化**——不跳登录页，只反复弹通用错误。

**根因**：项目里并存**两套鉴权写法**，且没有共享模块（batch1 已记录"云函数各自独立部署，无法共享模块"）：
1. **内联式**（16 个云函数用）：`if (!user) return { code: -401, msg: ... }` → 顶层
2. **Helper 式**（3 个云函数用）：`requireUser` / `requireSuperAdmin` → 嵌套

两套写法在演进中分叉，谁也没发现对方长得不一样。

**影响面排序**：`dataService`（31 次调用，全项目调用量第一）> `authService` 账号管理分支（15 次调用中的部分）> `importProducts`（1 次）。即 **dataService 是最大受害面**。

**F1 是否已被修复 —— 未修复**：全项目 grep `\.error\b` 命中 6 处，**全部是 `console.error`**（`index.js:58`、`receive-list.js:34`、`receive-verify.js:220`、`utils/cloud.js:73`、`app.js:101`、`app.js:110`），**没有一处检查 `result.error`**。F1 结论仍然完全成立。

**修复成本**：6 行改动，把 3 个 helper 的 `return { error: { ... } }` 改为 `return { ... }` 即可，无需动前端。这是全项目**改动最小、收益最大**的一处修复。

**代码卫生侧证**：全项目 `pages/` `utils/` `app.js` `cloudfunctions/` 共 **0 处** TODO / FIXME / XXX / HACK；`console.*` 仅 6 处且全部是 `console.error`（无 `console.log` / `console.warn` 遗留）。这说明作者是有意保持干净的——也意味着上述 6 行分叉是漏改，不是"先这样以后再说"的注记。

---

## H11. 字段命名双轨制：云函数全 snake_case，前端经 6 个归一化函数转 camelCase

**写入侧**（云函数）：`created_at` 27 处、`createdAt` **仅 1 处**（`dataService` 1 处）。全项目写入侧统一 snake_case，风格自洽。

**归一化侧**（`utils/cloud.js` 导出 6 个）：
`normalizePurchaseItem`(:123)、`normalizePurchaseOrder`(:139)、`normalizeProduct`(:171)、`normalizeSupplier`(:187)、`normalizePrice`(:201)、`normalizeReport`(:212)。**无** `normalizeReceipt` / `normalizeAbnormalRecord` / `normalizeMessage` / `normalizeStore` / `normalizeCategory`。

**读取侧实测双轨**：
- 内部管理页读 camel（经归一化）：`purchase-detail.wxml:34` `{{detail.createdAt}}`、`purchase-list.js:131` `util.getRelativeTime(o.createdAt)`、`approval-list.js:44` `o.submittedAt`
- **供应商侧页面直接读 snake**（未归一化）：`supplier-receipts.wxml:5` `{{item.receipt_date}}`、`supplier-prices.wxml:12` `{{item.effective_date}}`、`{{item.store_name}}`
- `abnormal-list.js:23-26` 走第三轨：`dataService` 返回体是显式白名单映射（`dataService:718-730`，10 个字段，非 `{...item}` 展开），`createdAt: item.created_at` 在 `:728` 已转换，前端再 `formatDateTime`

**已排除的怀疑（如实记录）**：疑似 `abnormal-list` 时间列恒空（前端读 `createdAt`、写入侧是 `created_at` 且无归一化函数）。实测**不成立**——`dataService:728` 显式映射了 `createdAt: item.created_at`，且 `parseDateValue`（`utils/cloud.js:78-96`）健壮处理了 Date 对象 / 秒毫秒自适应 / `toDate()`，时间显示正常。`parseDateValue` 是这个项目写得最讲究的一段代码。

**但相邻的真实隐患成立**（子代理 02 报）：云函数**内存排序**处若 `created_at` 回读为 Date 对象，`String(date)` 会变成 `"Wed Oct 03 2026 22:00:00 GMT+0800"`，`localeCompare` 按**星期名**排 → 跨月全乱。`getSupplierOrders:116` 命中此模式。而数据库端 `.orderBy('created_at','desc')`（如 `dataService:707`）不受影响。区分标准：**数据库端排序安全，JS 端字符串排序危险**。

---

## H12. `getAbnormalRecords` 服务端能力存在但前端未用（确认 full-scan-06 M11）

- `dataService:704` `if (event.status) query.status = event.status` —— **服务端支持状态过滤**
- `dataService:708` `.limit(100)` —— 硬编码 100 条，超量静默截断
- `dataService:700` `if (auth.user.role === 'chef') return { code: 0, data: [] }` —— chef 静默返空（有意设计，非报错）
- 权限自洽：`:703` 列表按 `GLOBAL_ROLES` 判断是否加 store_id 过滤；`startAbnormal:740` 逐条校验 `store_id !== default_store_id` 返回 -403。**越权面在这几个 action 上是闭合的。**
- 前端 `abnormal-list.js:16-18` 调 `getAbnormalRecords` 时**不传 status**，改为 `applyFilter()` 客户端过滤（`:36-45`）→ 每次筛状态都要先拉 100 条再本地过筛。服务端能力闲置。

**白名单丢字段（确认 full-scan-06 M10）**：`dataService:718-730` 返回的 10 个字段中**没有** `receipt_id` / `purchase_order_id` / `product_id`，而写入侧 `createReceipt:491-493` 这三个字段都已落库。结果：库里有对账外键，接口却丢弃 → 异常记录无法跳回对应收货单/采购单/商品，两侧无法互跳对账。

---

## H13. 角色清单在项目里重复硬编码 14 处 —— 权限漂移的结构性根源

`GLOBAL_ROLES` **只有一份副本**：`cloudfunctions/dataService/index.js:8` = `['super_admin', 'purchaser']`。其余角色清单全部各自复制：

**云函数侧 5 处定义**
| 位置 | 常量 | 值 |
|---|---|---|
| `dataService:8` | GLOBAL_ROLES | `['super_admin','purchaser']` |
| `dataService:9` | MANAGEMENT_ROLES | `['super_admin','purchaser']` ← **与上一行同值** |
| `dataService:11` | VOUCHER_SUBMIT_ROLES | `['super_admin','purchaser','store_manager']` |
| `importProducts:8` | MANAGEMENT_ROLES | `['super_admin','purchaser']` ← 独立复制 |
| `authService:21` | STORE_ROLES | `['chef','store_manager']` |

**前端侧 11 处内联硬编码**（不引用任何常量，字面量散落）：
`purchase-list:85`、`report-list:128`、`purchase-detail:74,81,85,86,88,98`、`receive-list:84,85,87`、`approval-list:14`、`index:86,113`、`approval-detail:17`

**两个直接后果**

1. **`GLOBAL_ROLES` 与 `MANAGEMENT_ROLES` 同值冗余**（`dataService:8-9`）。两个名字、同一份数组，语义边界靠命名硬撑。加人角色时必须同时改两处，改一处就出现"名字叫 GLOBAL 但行为是 MANAGEMENT"的错乱。
2. **注释制造的"已对齐"错觉**（修正 full-scan-06 的 H1 表述）：`report-list.js:128` 的 `['super_admin','purchaser']` 与 `GLOBAL_ROLES` **确实逐字一致**，其注释"与 GLOBAL_ROLES 一致"在字面上正确。真正的不一致在于 —— **`generateSummaryReport` 根本不用 GLOBAL_ROLES，它有自己更宽的角色判断**（允许 `store_manager` 且专为店长写了分支）。所以注释对齐的是**错误的参照物**：作者以为跟它对齐的常量，根本不是决定他权限的那个东西。店长因此被前端误拦，而他能通过的云函数路径在他看不到的地方。

**严重度定性**：安全边界仍在云函数（前端漂移最坏也只是按钮显示/隐藏与报错文案问题，不会真越权）——**但报告链路的店长误拦是功能阻断**，不是纯 UX 问题。

**建议方向**（不写代码，仅记录）：把角色清单收敛为单一来源（云函数侧可抽成公共模块，前端可放 `utils/meta.js`），前端 11 处改为引用；或至少在每处硬编码旁标注"与哪个云函数哪个 action 对齐"，让漂移可被发现。`业务模糊点确认清单.md:198` 已记录过 GLOBAL_ROLES 的定义位置，说明作者知道这个点，但尚未收敛。

---

## H14. 【主控独立复核】`createPurchaseOrder:454` ReferenceError —— 复核通过，且实际后果比子代理 02 报的更严重

子代理 02 报告：catch 块引用 try 块内 `const orderData` → 必然 ReferenceError。主控逐行复核**通过**，并补出它没写的两处后果。

**作用域铁证**：
- `:273` `const orderData = { store_id: storeId, ... }` —— 声明在**外层 try 块内**
- `:429` `} catch (err) {` —— 外层 try 的 catch
- `:454` `store_id: orderData && orderData.store_id || ''` —— 在 catch 内的**内层 try**（`:437` 起）中引用

`const` 是块级作用域，内层 try 是外层 try 的**兄弟块之外**，`orderData` 在那里根本不可解析。所以 `:454` 的 `orderData &&` **不是有效防御**——执行到该标识符就抛 `ReferenceError`，`&&` 短路永远轮不到。

**这处 `&&` 恰是作者意图的化石**：作者显然担心 `orderData` 可能未定义，特意加了短路保护。但防御写在了错误的作用域上——**意图与效果完全背离**。这是比"漏写防御"更隐蔽的一类 bug：代码看起来已经防御过了。

**实际后果（比子代理 02 报的更严重，两点增量）**：

1. **静默的双重失败**。`:440` `missing_reports: true` 在 `:454` **之前**执行，已落库成功；`:446` 的 message 写入在 `:454` 抛错后**永不执行**。结果库里留下「有 `missing_reports` 标记、但没有对应告警消息」的孤儿状态。管理员在消息中心看不到任何东西。
2. **错误被吞到只剩一行日志**。`:460-462` 内层 catch 捕获后仅 `console.error('缺报表标记/通知写入失败')`，然后 `:463-466` **照样返回 `code: 0`** + `reportWarning: '订单已保存，但报表生成失败，请联系管理员处理。'`。于是链路上出现了自相矛盾的信息：客户端被告知"请联系管理员"，而管理员侧没有任何入口能发现这件事。

**净效果**：报表丢了，有标记，但**唯一设计来兜底的告警机制（消息通知）自身失效，且失效得无声无息**。整条兜底链路里只有 `:461` 那一行 `console.error` 留痕。

**修复成本**：1 行。`:454` 改用 `persistedOrderNo` 回查订单取 `store_id`，或在外层 try 之前把 `storeId` 提为闭包变量。

**同类排查价值**：`batch2` 已记录一个同型缺陷（`that.loadData()` 在错误作用域被调用）。加上这处，项目里已确认 **2 处"块级作用域 + catch/回调跨块引用"型缺陷**，值得全项目扫一遍 `catch` 块与异步回调中引用的块级变量。

---

## H16. 【主控独立复核】禁用账号的 token 失效 —— 结论成立，但机制与严重度需精确化

子代理 01 报告：`setUserStatus(0)` 只清 legacy 字段、未清 `sessions[]`，重新启用后旧 token 复活。主控复核**结论成立**，但机制要精确化，严重度需下调一级。

**`setUserStatus` 实际做了哪些清理**（`:489-493`）：
```
const updateData = { status, updated_at: db.serverDate() }
if (status === 0) {
  updateData.session_token_hash = ''     // ← 清的是 legacy 单会话字段
  updateData.session_expires_at = null   // ← 同上
}
```

**关键在于 `getSessionUser:106-131` 有两道 status 闸门**：
- `:110` `.where({ status: 1, sessions: { token_hash: tokenHash } })` —— 新多 token 方案
- `:117` `.where({ session_token_hash: tokenHash, status: 1 })` —— legacy 单会话兼容分支

**两者都带 `status: 1`**。所以：

| 阶段 | token 是否有效 | 原因 |
|---|---|---|
| 停用后、重启用前 | **无效** | `status: 0`，两道闸门都查不到 |
| 重新启用后（token 未过期） | **有效（缺陷所在）** | `sessions[]` 从未被清，token 直接复活 |

**所以子代理 01 的表述是准确的**——不是"停用完全不生效"，而是"重新启用后旧 token 复活"。严重度定级：不是"停用期间仍能访问"（那是高危越权），而是**权限回收不彻底**（账号被停用期间用户确实被踢下线，但一旦管理员放行，用户在停用期间从未重新登录的 token 立即复活，无需重新输密码）。定级 **中**。

**真正值得记的是作者的认知偏差**：`:491-492` 这两行说明作者**明确意图做 token 失效**（不是漏写），但清理落在了**已经废弃一半的 legacy 字段**上。巧合的是这反而让 legacy 老设备失效了——**新路径缺陷、旧路径意外正确**，这种"半对半错"的清理比单纯漏写更难被发现，因为它看起来做过了。

**与另外两处对比**：`changePassword:305`、`resetPassword:461` 都正确清了 `sessions: []`。即项目里**密码变更类操作迁移到了新方案，账号状态变更类操作没跟上**。这是迁移做了一半的典型残留。

**修复**：`setUserStatus` 的 `status === 0` 分支加一行 `updateData.sessions = []`（或 `updateData.sessions = _.remove(...)` 视云开发能力），并同步 `:491-492` 那两行是否还需要保留（status 闸门已足够，它们对新方案是死代码，只对 legacy 有效）。`deleteUser:500-502` 委托此函数，改一处即覆盖软删除。

**顺带确认的良好设计**（避免只报问题）：`:479` 禁止操作当前登录账号状态（防自锁）、`:484` 保护默认超管 `admin` 不可停用、`:485-486` 幂等（重复设同状态直接返回明确文案）。这三处都写对了。

---

## H17. 【主控独立复核 + 全项目最重要发现】门店切换对门店角色是纯装饰，且制造一个下单坑

子代理 05 报告：门店切换是纯前端本地状态，后端对门店角色把门店钉死在 `default_store_id`。主控逐行复核**完全通过**，确认为全项目最高价值发现。

**前端侧**（`store-switch.js:32-43`）切换只做 3 件事：写 `globalData.currentStore`、写 storage、`navigateBack`。**不调用任何云函数，不写 `app_user.default_store_id`**。冷启动从 storage 恢复（`app.js:40-42`），退出登录清除（`index.js:144-147`）。

**后端侧铁证**：

`createPurchaseOrder:160-164`
```
const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
if (!isGlobal) {
  if (!user.default_store_id || (storeId && storeId !== user.default_store_id))
    return { code: -403, msg: '无权为其他门店创建采购订单' }
  storeId = user.default_store_id        // ← 强制覆盖
```

`getPurchaseOrders:52-66`
- chef（`:53-55`）：强制 `query.store_id = user.default_store_id` + `created_by = user.user_id`（**只看自己创建的**）
- store_manager（`:58-59`）：强制 `query.store_id = user.default_store_id`，**忽略**前端 storeId
- isGlobal（`:62-63`）：`if (storeId) query.store_id = storeId` ← **只有全局角色才吃前端传的 storeId**

`getReports:59-63` 同构（门店角色强制 `scope_id = default_store_id`，全局角色走 reportScope）。

**完整真相表**

| 角色 | 切换门店后 | 效果 |
|---|---|---|
| super_admin / purchaser | 后端按新 storeId 过滤 | **正常生效** |
| chef / store_manager | 后端忽略 storeId，永远返回 default_store_id 数据 | **顶栏显示新门店，数据全是旧门店** |
| chef / store_manager 下单 | 传入非 default 的 storeId | **-403「无权为其他门店创建采购订单」** |

**即：门店切换对一半角色是纯装饰 + 一个坑**。唯一有实际数据后果的地方是"下单直接报错"，且前端下单前无任何预告。用户视角的困惑——"我明明切了门店，为什么数据没变？"——根因在此。

**产品与架构的错位**：架构假设"一个账号绑定一个门店"（门店角色单店），但 UI 给了所有角色同一个门店切换入口，没做角色区分。**最小修复**是对门店角色隐藏切换入口；**架构修复**是允许门店角色绑定多店。

**附带确认的良好设计**（避免只报问题）：
- `getPurchaseOrders:53,58` 两处都先检查 `!user.default_store_id` 并返回明确文案"账号未关联有效门店"，而不是裸 500
- `:65` 兜底 else 返回 -403 而不是静默返回空列表
- `:68-69` 有 `to_verify` / `receivable` 两个**虚拟筛选**（非状态枚举），注释说明与首页"待收货"卡片、`getOrderStats` 口径对齐 —— 这是设计良好的复合查询
- chef 只看自己创建的、店长看本店全部 —— 角色区分合理

---

## H18. 【主控独立复核】`updateUser` 缺当前账号保护 —— 三个高危操作的防护不对称

子代理 05 报告 M4：`updateUser:393-440` 无 `event.id === auth.user._id` 拦截，而 `resetPassword:446` 有。主控复核**通过**。

三个"管理员作用于目标账号"的操作，防护完整性对比：

| 操作 | 当前账号保护 | 行号 |
|---|---|---|
| `setUserStatus` | ✅ `event.id === auth.user._id` → "不能操作当前登录账号的状态" | `:479` |
| `resetPassword` | ✅ `event.id === auth.user._id` → "请在安全设置中修改当前账号密码" | `:446` |
| `updateUser` | ❌ **无任何保护** | `:393-402`（`if (!event.id)` → `doc.get()` → `validateUserInput`，无 `_id` 比对） |

`resetPassword:446` 的文案"请在安全设置中修改当前账号密码"说明作者**设计了独立的账号自助修改路径**，并有意把"管理员代改"与"本人自改"分开。`setUserStatus` 也遵守了这个约定。**唯独 `updateUser` 破例**——超管编辑自己会走到 `:433-435` 清空 `sessions`，结果是被踢下线，而界面还停在账号管理页，直到下一次操作才报错。

**同类排查价值**：这是**防护不对称**型缺陷，特征是"同一组接口里 N-1 个有护栏、1 个没有"。这类缺陷不靠通读代码发现，得靠**横向对比同组接口**。项目里已确认的同型案例：`saveProduct` 双端无重名检测（`dataService:91-130` 无 duplicate 查询），而 `saveSupplier:155-161`、`createStore:516-522,596-602`、`createUser:357-361`、`updateUser:404-409` **四个创建函数全部有查重**，唯独商品没有。两例都是"N-1 有、1 没有"。

---

## H19. 孤儿页疑点的机制答案（H4 的闭环）

主控 H4 曾列出 5 个静态 grep 搜不到跳转入口的页面（approval-list / product-manage / supplier-manage / supplier-home / user-manage），并当时判定"不能据此定论，可能是动态拼路径的假阳性"。**子代理 05 给出了机制**：

这些入口全在 `index.wxml` 的 **`data-url` 属性 + `bindtap` 读 `dataset`** 模式里：
- product-manage ← `index.wxml:34`；supplier-manage ← `:38`；user-manage ← `:46`；approval-list ← `:30`
- store-manage ← `:50`；store-switch ← `index.js:119`；price-manage 有 2 个入口（`index.wxml:42` + `supplier-manage.js:119` 深链）

**不是孤儿页，5 个全部有入口**。主控当时的 grep 模式只匹配 `wx.navigateTo({ url: 'pages/...' })` 的内联字面量，抓不到 `data-url` 属性里的路径——这是静态扫描的**系统性盲区**，值得记住：**本项目页面跳转主要靠 `data-url` + dataset，不靠内联字面量**，下次做跳转图分析必须同时 grep `data-url`。

---

## H20. 【主控验证通过】工程配置两处硬事实

**① `cloudfunctionRoot` 缺失** —— `project.config.json` 与 `project.private.config.json` **均未配置** `cloudfunctionRoot`。
后果：20 个云函数目录不会被微信开发者工具识别为云函数根，既无法在工具内一键上传部署，其代码还会被打进小程序包（增加包体积，且 `cloudfunctions/*/package.json` 里的 `wx-server-sdk` 会被打进包里）。
**注意**：`project.private.config.json` 有 `libVersion: "3.17.1"` 与 `setting.showES6CompileOption: false`，后者只是"是否显示 ES6 编译选项"的 UI 开关，不是转译开关——所以它不能用来解释 H1 的可选链清零，H1 的根因仍需另查（可能确实是 babel 配置不覆盖 ES2020 可选链）。

**② `.gitignore` 声明与 git 追踪状态矛盾** —— `.gitignore` 第 7-8 行：
```
# 本地种子/敏感数据
seed-data/
```
但 `git ls-files seed-data/` 返回 **15 个文件全部被追踪**。
`.gitignore` 的注释本身就是证据——作者**明确知道** seed-data 是"敏感数据"、不该入库（同文件还写着"临时测试脚本（含硬编码测试口令，严禁入库）"），但 `seed-data/` 被加进了版本库。
结合 full-scan-08 的 M-8：`seed-data/README.md` 明文列出 5 个初始口令且已入库 → **明文口令已进版本历史**（即使现在加 ignore 也改不了历史）。
**修复方向**：`git rm -r --cached seed-data/` + 提交 + 轮换那 5 个口令。注：`supplier_test_user.jsonl` 里的 `password_hash` 是 PBKDF2 哈希（`password_iterations:120000`），相对安全；真正裸奔的是 README 里的明文初始口令。

---

## H15. 主控对子代理结论的交叉验证记录（已验证 / 已排除）

| 项 | 来源 | 主控结论 |
|---|---|---|
| `report-list.js:128` 前端拦截与云侧口径矛盾 | full-scan-06 H1 / full-scan-03 M6 | **双向确认**。`generateSummaryReport:160` 允许 `store_manager`，`report-list.js:128` 只放行 `['super_admin','purchaser']`。见 H13 的"注释对齐了错误参照物"分析 |
| `getAbnormalRecords` 服务端支持 status 过滤但前端未用 | full-scan-06 M11 | **确认**。`dataService:704` `if (event.status) query.status = event.status`；前端 `abnormal-list.js:16-18` 不传 status，改 `applyFilter()` 客户端过滤。另确认 `:708` 硬编码 `.limit(100)` |
| 异常记录丢对账外键 | full-scan-06 M10 | **确认**。`dataService:718-730` 白名单 10 字段无 `receipt_id`/`purchase_order_id`/`product_id`，而 `createReceipt:491-493` 三者均已落库 |
| `report_version_counter` 无种子样本是否影响首次生成 | 主控 H7 待核实 | **已解答**（full-scan-03）：运行时自动 upsert，环境禁自动建集合时首次生成报通用 -1 |
| `createPurchaseOrder:454` ReferenceError | full-scan-02 | **复核通过并加重**，见 H14 |
| `abnormal-list` 时间列恒空（主控自行怀疑） | 主控自查 | **已排除**。`dataService:728` 显式映射 `createdAt: item.created_at`，`parseDateValue`(`cloud.js:78-96`) 健壮处理 Date 对象/秒毫秒自适应/`toDate()`。如实记为误报 |
| 报表链路受 F1（会话过期不跳登录）影响 | 主控 H10 预测 | **已排除**。full-scan-03 确认 4 个报表云函数纯顶层、0 处嵌套 |

