# 酒店采购管理小程序

酒店多门店采购管理微信小程序：门店下单 → 管理员审核 → 供货商确认接单/发货 → 门店收货验收 → 报表对账。基于微信云开发（云函数 + 云数据库 + 云存储），无需自建后端。

## 角色与权限

| 角色 key | 界面名称 | 绑定 | 主要能力 |
|---|---|---|---|
| `chef` | 下单人员 | 门店 | 创建采购单、查看自己创建的订单（无验收资格） |
| `store_manager` | 店长 | 门店 | 收货验收、异常处理、报表；**无审核权**（清单 #12：审核仅管理员） |
| `purchaser` | 采购主管 | 否（跨店） | 全局管理：商品/供应商/价格/用户、审核、作废（2026-10-19 起界面名称由「管理员」改为「采购主管」） |
| `super_admin` | 超级管理员 | 否 | 唯一 `admin` 账号，不可删除不可改角色 |
| `supplier` | 供货商 | 供货商档案 | 门户：确认接单、标记发货、收货对账、协议价 |

代码位置：`cloudfunctions/authService/index.js`（角色白名单、会话管理、B12 多设备登录）。

> **账号管理（#17 软删除）**：离职账号走「停用」而非物理删除（`setUserStatus`），停用即离职——登录会话即时失效、历史单据关联保留；`deleteUser` 已不再物理删除，内部直接落到停用（软删除），恢复走 `setUserStatus(status: 1)`。用户管理入口仅 `super_admin` 可见。

## 核心业务流（已拍板口径）

- **B2 先审批后收货**：订单必须审核通过才能收货（`createReceipt` 状态白名单无 `submitted`）。
- **B3 分批收货**：同一订单可多张收货单（`batch_no`/`is_final`），本批未收齐订单为 `partial_received`，收齐才 `received`。
- **B4/B6 行级异常隔离**：短收只标记异常行，正常行照常结算；异常处理完由管理员 `settleReceipt` 补结算。
- **B8 作废/取消（2026-09-28 口径更新）**：审批前管理员可作废（`cancelOrder`）；审批后仅管理员（purchaser/super_admin）可申请取消（`requestCancel`，防重复申请条件更新）或作废，下单人员/店长无取消权限；挂起的取消申请可由管理员驳回清除（`rejectCancel`，条件更新防并发），不再永久挂「待确认取消」标记；驳回单可复制为新草稿（B7）。
- **供货商链路（S1–S8）**：动作级白名单（确认接单限审批前、标记发货放宽到审批后含 `partial_received`）；审核改量重置供货商确认；`partial_received` 不算已完成；详情页按供货商分组展示确认标签。
- **S9 手动商品专用单（2026-09-22 拍板，同日升级为自动拆单）**：手动商品可与档案商品同单填写，提交时前端**自动拆为两单**——档案商品单 + 手动商品专用单（幂等键拆 `:c`/`:m` 子键，部分失败保留已建单号，重试不重复建单；`createPurchaseOrder` 后端保留禁混单兜底校验）。两单各自走审批与报表：手动单只出门店下单报表并打标「线下采购，凭证核销」，不进供应商订货汇总。手动单走**特殊审批**（不核协议价）；收货无价为预期行为（跳过协议价查询、不标异常、不进带价报表与补结算）；收货后**上传付款凭证**（云存储 `vouchers/`），管理员**核销回填实付金额**（`dataService.verifyManualOrder`，状态 `none → pending → approved/rejected`，条件更新防并发重复核销）后单据闭环；待核销单留在管理员待办催办。供货商端全程不可见。协议价体系只服务档案商品（价格管理页支持首次定价）。

- **#10 结算价格口径（2026-09-24 拍板）**：价格含税、运费另算；结算取**收货日现价**（下单不锁价、随行就市），差价落门店；改价限当天生效（S5）；改价/首次定价时提示波及的在途订单数（`updateProductPrice` 支持 dryRun 计数）。
- **#11 缺价不静默（2026-09-24 拍板，已实施）**：收货时档案商品无协议价 → 标 `missing_price` 异常 + 定向店长消息提醒补价；管理员补价后走「补价补账」（`dataService.repriceReceipt`）刷新价格快照、关闭缺价异常、重出 ③④⑤⑥ 账单。
- **#18 草稿属门店资产（2026-09-24 拍板）**：本店店长可代改/代提交本店任何人的草稿（解决离职员工停用后草稿卡死），`created_by` 保留原创建人、追溯链不变；审核改量的站内通知在创建人已停用/不存在时改发本店店长（查不到回退门店广播），不再落死信箱。

### 2026-09-28 批量拍板（清单 #12/#14/#15/#16/#20–#24，全部已定）

- **#12 审批口径**：任意角色下单一律由管理员审核，**禁止自单自审**（`auditOrder` 按 `created_by` 拦截，`dataService`）；审批只能改量**不能删行**（数量必须为正，整单不要走驳回）；不设审核时限，改用**催办消息**——下单人/店长可对 `submitted` 单发催审提醒（`dataService.remindAudit`，同单 1 小时限频），详情页「🔔 催促审核」按钮。
- **#14 超收**：「绝不超收」为业务规则，实收>下单前后端硬性拒绝，多送货线下协商（无代码改动）。
- **#15 异常补结算提醒**：异常解决（`resolveAbnormal`）后自动发「待补结算提醒」，防止管理员忘记 `settleReceipt` 致供应商账单缺漏（补结算仍手动触发）。
- **#16 补录日期打标**：允许补录历史日期，下单/收货业务日期早于服务端今天时写 `backfilled: true`，供对账区分。
- **#24 手动单隔离双保险**：供应商门户订单/收货查询、带价收货报表均显式过滤 `is_manual`，不再仅依赖 `supplier_id` 为空的隐式前提（散货商建档升级安全）。
- **#20/#21/#23**：「待核销」tab 即催办入口；手动单审批标识已上线；作废单凭证留档不删——均维持现状，无代码改动。

## 安全加固（2026-09-28 实施留痕）

并发与安全审查发现的问题已全部修复（修复留痕见提交 `ffb5bf4`/`9350b9d`/`d48b17c`；后续公司级复查见 `审查报告-2026-09-30.md`）：

- **会话安全**：启动时异步调 `authService.validate` 服务端裁决会话（`app.js`），**仅在服务端明确返回 `-401` 时**才清本地登录态并跳登录页；其余错误码（云函数未部署、内部异常、网络故障）保留本地登录态，不误踢用户。`app.js` 补 `onShow` 温启动复检（会话可能在后台期间被作废）；`utils/cloud.js` 统一拦截 `-401`（清会话 + 防抖跳登录）；除登录页外 25 个页面全部接入 `utils/auth-guard.js` 登录守卫。
- **并发竞态**：`createReceipt` 超收校验与批次号生成移入事务内；`confirmSupplierOrder`/`dataService.auditOrder` 改条件更新/事务内复查，拒绝重复确认与重复审核；报表版本号改 `report_version_counter` 原子计数器（4 个云函数）；业务 ID（RCP/U/P/SUP/MSG/storeId）加随机后缀或撞号重试。
- **登录防护**：失败计数 `_.inc` 原子自增，达 5 次条件更新锁定 10 分钟（并发不顺延）；登录页不再预填任何演示账号。
- **操作防重**：详情页/列表页全部写操作加 `_submitting` 防重入；`purchase-detail` 提交/复制带 `requestId` 幂等键（服务端去重）；`requestCancel` 限采购员/店长/管理员且防重复申请刷通知。
- **配置卫生**：`sitemap.json` 全站 disallow；移除无效的 `permission.scope.camera`；新增 `.gitignore`（忽略 `_tmp_test/` 等含测试口令的本地目录，**入库口令需轮换**）。

完整决策留痕见 [业务模糊点确认清单.md](业务模糊点确认清单.md)。

### 2026-10-19 修复批次

- **角色命名**：`purchaser` 界面名称由「管理员」改为「采购主管」（登录页、用户管理、`authService` ROLE_LABELS、种子脚本同步）。存量账号库存 `role_label` 为旧值——`updateUser` 写库取服务端 `ROLE_LABELS`，故需**先部署 `authService`**，再在用户管理页重新保存该账号一次即刷新。
- **报表下载收口**：`getReports`/`getReportDetail` 不再下发 `file_url`（改回 `has_file` 标记），下载一律走 `getReportFileUrl` 按 `reportId` 鉴权（`fileId` 入参仅兼容旧客户端），防止拿到 fileID 绕过鉴权直取临时链接。**三件套须一起部署**，且前端包需同步上传（前端改用 `has_file` 判断下载入口）。
- **消息隔离**：供应商定向消息（写库不带 `store_id`）不再被「store_id 为空」分支漏发给厨师/店长/管理员；消息带 `bizId`，消息中心点击可正常跳转。
- **末位超管守卫**：停用/降级最后一名在岗超管被拦截（对任意超管账号生效，而非仅 `admin`），防管理入口锁死；改角色即清会话。
- **查询修复**：`getProducts` 关键词下推数据库正则（修复超 200 种商品后搜不到）；`getSupplierOrders` 分页取全量（修复超 1000 行旧订单静默消失、计数失真）+ 时间戳比较修复跨月排序错乱。
- **其他**：期望到货时间支持精确到时分（`YYYY-MM-DD HH:mm`）；`receipt_abnormal` 允许继续补收（与事务内白名单口径一致）；`importProducts` fileID → cloudPath 解析修正。
- **采购列表页**：状态 tab 去掉数字徽标（大数字溢出被横向滚动容器裁剪）、加高点击区；补分页底部「正在加载…/没有更多了」提示与底部留白（避开悬浮新建按钮）。
- **B5 前端体验批次（25/30 项）**：按《修复计划-2026-10-03》B5 执行——防重入补齐（purchase-create 全段 try/finally、product-manage 三处）、状态字典单源收敛到 `meta.js`（核销态/异常类型/报表 superseded）、分页竞态防护（3 个列表页）、失败态与空态互斥、命中区域加大等。未做 4 项（首页调用合并、分页骨架重构、setData 裁剪、Excel 模板）详见 `log.md` 2026-10-19 节与《修复计划》§0 进度表。

### 2026-10-20 修复批次（登录态 + 报表批次）

- **登录态跨冷启动维持**：小程序 `app.json` 的 `pages[0]` 是登录页，冷启动时即使会话有效也停在登录页要求重新登录。现改为登录页 `onShow` 探测到登录态即让路（供货商→`supplier-home`，其余→`index`），落点与登录成功路径一致；`utils/auth-guard.js` 拆出只读 `isLoggedIn()` 供其使用。
- **会话有效期解析修正**：服务端返回的是标准 ISO 8601，而客户端原实现把它改写成非标准格式（`2026/10/27 12:00:00.000Z`），**iOS 的 JSCore 判为 Invalid Date**，导致每次冷启动都被误判会话过期。新增 `utils/date.js` 收口为「先原生 ISO 解析、失败才退回斜杠格式」。
- **会话失效处理**：服务端判定会话失效（`-401`）时立即清本地态并跳登录页，不再停在首页看空数据；`app.js` 补 `onShow` 温启动复检（后台期间会话可能已被改密/停用作废）。
- **校验不再误踢用户**：`validate` 返回非 `-401` 的错误（云端未部署 `validate` action、云函数内部异常）时保留本地登录态，只有服务端明确裁决失效才登出。
- **分批收货报表批次错位**：收货报表按批次生成（`report_id` 含 `receiptId`），但详情页原先按 `purchase_order_id + limit(1)` 取收货单，跨天分批收货时第 2、3 批的报表页面显示第 1 批的明细、**页面合计与下载的 CSV 对不上**。现从 `report_id` 反解 `receiptId` 精确查询（旧格式 `report_id` 兜底回退原逻辑）。
- **部署**：登录态修复只改前端，需**重新上传前端小程序包**；报表修复需**重新部署 `getReportDetail` 云函数**。云端 `authService` 建议一并部署（`validate` action 自 2026-09-28 才加入）。

## 供货商新订单通知（三层触达）

采购单**审核通过**后自动下推给相关供货商（`dataService.notifySuppliersNewOrder`）：

1. **微信服务通知**（订阅消息）：`cloud.openapi.subscribeMessage.send`，跳转供货商订单页；一次性订阅，授权额度内推送，失败/未订阅静默降级。
2. **供货商首页通知条**：门户顶部显示未读数 + 最新一条消息，点击进供货商消息中心（`supplier-messages` 独立页）。
3. **消息中心**：站内消息按 `scope_type='supplier'` + `scope_id` 定向，必达兜底；门店侧消息按 `store_id` + `recipient_user_id` 过滤（广播 / 定向 / 本门店），已读按人独立（`read_by`）。

### 上线前需配置（模板 ID 占位符）

| 位置 | 配置项 |
|---|---|
| `cloudfunctions/dataService/index.js` | `SUBSCRIBE_TEMPLATE_ID`（订阅消息模板 ID）、`SUBSCRIBE_TEMPLATE_FIELDS`（按模板 keywords 调整字段映射） |
| `pages/supplier-home/supplier-home.js` | `NEW_ORDER_TEMPLATE_ID`（前端拉起授权用，同一模板 ID） |

注意：订阅消息是**免费**的；供货商账号首次登录后系统自动记录 openid（`app_user.openid`），存量账号需重新登录一次才可接收微信通知。

## 目录结构

```
pages/                 小程序页面（门店端 + 供货商门户）
  supplier-home/       供货商门户（通知条、订阅授权）
  supplier-orders/     供货商订单（确认接单/标记发货）
  supplier-receipts/   供货商收货对账（含异常裁决展示）
  supplier-prices/     协议价查询
  supplier-messages/   供货商消息中心（订单通知，按人 read_by 已读）
  purchase-*           采购单创建/列表/详情
  receive-*            收货验收/收货记录
  report-*             报表列表/详情/历史
  message/             消息中心（tabBar）
  abnormal-list/       异常记录处理
cloudfunctions/        云函数（每目录一个，独立部署）
utils/                 cloud.js（调用封装/数据规整）、meta.js（状态字典）、util.js、auth-guard.js（登录守卫）、date.js（日期解析单源）
seed-data/             初始数据与导入说明（见 seed-data/README.md）
```

## 云函数一览

| 云函数 | 职责 |
|---|---|
| `authService` | 登录/登出/改密，多设备会话，登录时记录 openid |
| `createPurchaseOrder` | 创建采购单，生成 ① 门店下单 ② 供应商订货 CSV |
| `dataService` | 审核（`auditOrder`）、作废/取消、消息、报表补生成、补结算、手动单凭证核销（`verifyManualOrder`）等聚合操作 |
| `confirmSupplierOrder` | 供货商确认接单/标记发货（token 校验 + 动作级状态白名单） |
| `getSupplierOrders` / `getSupplierReceipts` | 供货商视角订单/收货（只含自己供货的明细） |
| `getProductPrices` / `updateProductPrice` | 协议价查询/调整（仅当天生效日期） |
| `createReceipt` | 收货验收（分批、行级异常、价格快照、③④⑤⑥ 报表） |
| `getPurchaseOrders` / `getPurchaseOrderDetail` / `getReceipts` | 门店端查询 |
| `getReports` / `getReportDetail` / `getReportFileUrl` | 报表查询/下载 |
| `generateSummaryReport` | B11 日/月汇总报表 |

## 部署与初始化

1. 微信开发者工具导入项目（`project.config.json`），开通云开发环境。
2. 上传 `cloudfunctions/` 下全部云函数（云端安装依赖），建议一次全部部署，避免新旧版本混跑。2026-10 修复批次涉及 **10 个云函数需重新部署**：`authService`、`createPurchaseOrder`、`createReceipt`、`dataService`、`getProducts`、`getReports`、`getReportDetail`、`getReportFileUrl`、`getSupplierOrders`、`importProducts`。其中 `getReports`/`getReportDetail`/`getReportFileUrl` 为联动改动须一起部署；前端小程序包需同步上传。
   - 2026-10-20 批次追加：`getReportDetail`（分批收货报表批次）需重新部署；`authService` 建议一并部署（`validate` action 自 2026-09-28 起才存在，云端若仍是旧版，冷启动校验会返回 `-1`）。登录态其余改动在前端，**重新上传小程序包**即可。
3. 按 `seed-data/README.md` 导入初始数据（含初始账号与建议索引：`app_user.username` 唯一索引等）。
4. 小程序后台申请**订阅消息模板**，模板 ID 填入上表两处占位符。
5. 云数据库需建集合：`store`、`app_user`、`category`、`supplier`、`product`、`supplier_product_price`、`purchase_order`、`purchase_order_item`、`receipt`、`receipt_item`、`report_file`、`message`、`abnormal_record`。
6. `report_version_counter`（报表版本计数器）由云函数首次调用自动创建，无需手工建表；若环境权限禁止自动建集合，请手动创建空集合。
7. **首次部署后验证**：双设备并发收货验证超收拦截；连续输错 5 次密码验证账号锁定与 10 分钟自动解锁。

## 相关文档

- [采购流程图.html](采购流程图.html)：全流程泳道图（含 S9 手动单凭证核销支线，浏览器打开查看）
- [业务模糊点确认清单.md](业务模糊点确认清单.md)：业务口径拍板与实现留痕（通用 B1–B12 / 供货商 S1–S9）
- [log.md](log.md)：开发日志
- [审查报告-2026-09-30.md](审查报告-2026-09-30.md)：公司级代码审查（153 项缺陷分级清单）
- [修复计划-2026-10-03.md](修复计划-2026-10-03.md)：缺陷分批修复计划（B1–B6，编号锚定审查报告）
- [seed-data/README.md](seed-data/README.md)：初始数据导入说明
