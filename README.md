# 酒店采购管理小程序

酒店多门店采购管理微信小程序：门店下单 → 管理员审核 → 供货商确认接单/发货 → 门店收货验收 → 报表对账。基于微信云开发（云函数 + 云数据库 + 云存储），无需自建后端。

## 角色与权限

| 角色 key | 界面名称 | 绑定 | 主要能力 |
|---|---|---|---|
| `chef` | 下单人员 | 门店 | 创建采购单、查看自己创建的订单（无验收资格） |
| `store_manager` | 店长 | 门店 | 审核本店订单、收货验收、异常处理、报表 |
| `purchaser` | 管理员 | 否（跨店） | 全局管理：商品/供应商/价格/用户、审核、作废 |
| `super_admin` | 超级管理员 | 否 | 唯一 `admin` 账号，不可删除不可改角色 |
| `supplier` | 供货商 | 供货商档案 | 门户：确认接单、标记发货、收货对账、协议价 |

代码位置：`cloudfunctions/authService/index.js`（角色白名单、会话管理、B12 多设备登录）。

> **账号管理（#17 软删除）**：离职账号走「停用」而非物理删除（`setUserStatus`），停用即离职——登录会话即时失效、历史单据关联保留；`deleteUser` 仅对无未完结单据的账号放行，且不可删除 `admin` 与当前登录账号。用户管理入口仅 `super_admin` 可见。

## 核心业务流（已拍板口径）

- **B2 先审批后收货**：订单必须审核通过才能收货（`createReceipt` 状态白名单无 `submitted`）。
- **B3 分批收货**：同一订单可多张收货单（`batch_no`/`is_final`），本批未收齐订单为 `partial_received`，收齐才 `received`。
- **B4/B6 行级异常隔离**：短收只标记异常行，正常行照常结算；异常处理完由管理员 `settleReceipt` 补结算。
- **B8 作废/取消**：审批前可作废（`cancelOrder`）；店长/采购员可提交取消申请（`requestCancel`）；驳回单可复制为新草稿（B7）。
- **供货商链路（S1–S8）**：动作级白名单（确认接单限审批前、标记发货放宽到审批后含 `partial_received`）；审核改量重置供货商确认；`partial_received` 不算已完成；详情页按供货商分组展示确认标签。
- **S9 手动商品专用单（2026-09-22 拍板，同日升级为自动拆单）**：手动商品可与档案商品同单填写，提交时前端**自动拆为两单**——档案商品单 + 手动商品专用单（幂等键拆 `:c`/`:m` 子键，部分失败保留已建单号，重试不重复建单；`createPurchaseOrder` 后端保留禁混单兜底校验）。两单各自走审批与报表：手动单只出门店下单报表并打标「线下采购，凭证核销」，不进供应商订货汇总。手动单走**特殊审批**（不核协议价）；收货无价为预期行为（跳过协议价查询、不标异常、不进带价报表与补结算）；收货后**上传付款凭证**（云存储 `vouchers/`），管理员**核销回填实付金额**（`dataService.verifyManualOrder`，状态 `none → pending → approved/rejected`，条件更新防并发重复核销）后单据闭环；待核销单留在管理员待办催办。供货商端全程不可见。协议价体系只服务档案商品（价格管理页支持首次定价）。

- **#18 草稿属门店资产（2026-09-24 拍板）**：本店店长可代改/代提交本店任何人的草稿（解决离职员工停用后草稿卡死），`created_by` 保留原创建人、追溯链不变；审核改量的站内通知在创建人已停用/不存在时改发本店店长（查不到回退门店广播），不再落死信箱。

完整决策留痕见 [业务模糊点确认清单.md](业务模糊点确认清单.md)。

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
utils/                 cloud.js（调用封装/数据规整）、meta.js（状态字典）、util.js
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
2. 上传 `cloudfunctions/` 下全部云函数（改动过的需重新部署：如 `dataService`、`authService`、`confirmSupplierOrder`）。
3. 按 `seed-data/README.md` 导入初始数据（含初始账号与建议索引：`app_user.username` 唯一索引等）。
4. 小程序后台申请**订阅消息模板**，模板 ID 填入上表两处占位符。
5. 云数据库需建集合：`store`、`app_user`、`category`、`supplier`、`product`、`supplier_product_price`、`purchase_order`、`purchase_order_item`、`receipt`、`receipt_item`、`report_file`、`message`、`abnormal_record`。

## 相关文档

- [采购流程图.html](采购流程图.html)：全流程泳道图（含 S9 手动单凭证核销支线，浏览器打开查看）
- [业务模糊点确认清单.md](业务模糊点确认清单.md)：业务口径拍板与实现留痕（通用 B1–B12 / 供货商 S1–S9）
- [log.md](log.md)：开发日志
- [review.md](review.md)：代码审查记录
- [seed-data/README.md](seed-data/README.md)：初始数据导入说明
