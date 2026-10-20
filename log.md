# 版本日志 — 17-15 (#10/#11/#18 拍板落地：调价波及提示 + 缺价补账 + 草稿店长接管 2026-09-24)

## 📅 版本信息
- **版本目录**: 17-15
- **更新时间**: 2026-09-24
- **类型**: 口径拍板落地（4项）

---

## 本轮修改清单

| # | 范围 | 修改内容 |
|---|------|----------|
| 1 | `createPurchaseOrder` / `purchase-detail` | ✅ **#18 草稿属门店资产**：本店店长可代改/代提交本店任何人的草稿（服务端放开同店店长校验 + 详情页「编辑」按钮开放），解决离职员工停用后草稿卡死（此前仅超管/采购员 `isGlobal` 兜底）；`created_by`/`created_by_name` 保留原创建人快照，追溯链不变 |
| 2 | `dataService` | ✅ **改量通知死信修复**：新增 `resolveActiveRecipient`——审核改量站内消息创建人在岗发本人，已停用/不存在改发本店店长，查不到店长回退门店广播 |
| 3 | `updateProductPrice` / `price-manage` | ✅ **#10 锁价口径拍板落地**：结算维持收货日现价（不锁价、差价落门店），配套「调价波及提示」——新增 `countInflightOrders` 统计含该供应商+商品的在途订单（submitted→to_receive），`updateProductPrice` 支持 `dryRun` 只校验不落库；改价先计数、波及 >0 弹「调价波及提醒」确认框，首次定价成功提示 N 张在途单将按此价结算 |
| 4 | `createReceipt` / `dataService` / `receive-list`（补记，提交 `be5c600`） | ✅ **#11 缺价不静默**：档案商品缺价标 `missing_price` 异常 + 定向店长消息；管理员补价后「补价补账」（`repriceReceipt`）刷新快照、关闭异常、重出 ③④⑤⑥ 账单；收货记录页「缺价待补」标签 + 补账按钮 |

---

# 版本日志 — 17-14 (S9 手动单闭环 + 自动拆单 + 供货商消息中心 2026-09-23)

## 📅 版本信息
- **版本目录**: 17-14
- **更新时间**: 2026-09-23
- **类型**: 功能上线 + 加固（5项）

---

## 本轮修改清单

| # | 范围 | 修改内容 |
|---|------|----------|
| 1 | `createPurchaseOrder` / `dataService` / `createReceipt` / `purchase-detail` | ✅ **S9 手动商品专用单**：强制单独成单 + 凭证核销闭环（`verifyManualOrder`：店长/采购员/管理员提交凭证 → 采购员/管理员核销回填实付金额或驳回）；收货无价不标异常、不进带价报表与补结算；日/月汇总报表金额口径排除手动行。提交 `71c7c99` `2c61742` |
| 2 | `purchase-create` | ✅ **混单自动拆单**：手动商品与档案商品可同单填写，提交时自动拆为两单（档案单沿用草稿单号，手动单新建）；幂等键拆 `:c`/`:m` 子键防互判重复；部分失败保留已建单号并保留手动商品在本页，重试不重复建单。提交 `ad489bd` |
| 3 | `dataService` | ✅ **核销加固**：核销裁决条件更新防并发重复核销；驳回原因独立字段（重传不覆盖）；替换下来的旧凭证图自动从云存储清理。提交 `2c61742` |
| 4 | `supplier-home` / `supplier-messages`（新增页） | ✅ **供货商消息中心**：门户通知条点击进入独立消息列表页（`scope_type='supplier'` 定向消息，支持标记已读/全部已读）；首页退出登录增加确认弹窗。提交 `9c20711` |
| 5 | 流程图文档 | ✅ 采购流程图 HTML + PNG 同步至 S9 最终版（自动拆单 + 凭证核销支线）。提交 `a16218b` `9b63dd6` `e4b3c8e` |
| 6 | `createPurchaseOrder` / `purchase-create` | ✅ **拆单边缘修复**：已提交的档案单不再被当草稿复用（手动单失败后追加档案商品会自动新建单，幂等子键递增 `:c2`/`:c3`）；服务端幂等短路放行"编辑同一草稿"的请求，同页修改后再保存不再被误判重复导致内容丢失 |

---

# 版本日志 — 17-13 (价格首次定价入口 + 首页文案 2026-09-22)

## 📅 版本信息
- **版本目录**: 17-13
- **更新时间**: 2026-09-22
- **类型**: 功能补充 + 文案修复（2项）

---

## 本轮修改清单

| # | 页面 | 修改内容 |
|---|------|----------|
| 1 | `price-manage` | ✅ **新增「+ 新增价格」入口**：解决新商品（如手动维护的档案商品）首次定价无通路的问题。此前价格列表只能改已有记录，新商品查不到价导致收货 `price_snapshot=0`、`payable_flag=false`，供货商端标红「异常」。弹窗选供应商+商品+填价格，复用 `updateProductPrice`（自带权限/当天生效校验/事务写入）；已有当前价的组合提示走列表改价，防重复建行。**注意：纯手填商品（无 product_id）仍无解，待 S9 拍板**。提交 `8699583` |
| 2 | `index` | ✅ 首页「切换账号」按钮文案改为「退出登录」（行为不变，仍调 authService.logout）。提交 `19280f8` |

---

# 版本日志 — 17-12 (UX修复冲刺 2026-03-21)

## 📅 版本信息
- **版本目录**: 17-12
- **更新时间**: 2026-03-21 12:34
- **类型**: UX修复冲刺（13项）

---

## 本轮修改清单

### 📄 修改页面（6个）

| 页面 | 修改内容 |
|------|----------|
| `purchase-create` | ✅ **完全重写**：去掉picker弹窗流程，商品直接内联显示+数量输入 −/input/+；到货日期默认明天；日期和备注移到商品列表下方；备注栏缩小；底部140rpx padding修复滚动 |
| `purchase-list` | ✅ 增加"去收货"按钮（当状态为submitted/report_generated/partial_received时显示）；支持首页带status参数跳转 |
| `purchase-detail` | ✅ 增加"去收货"按钮，跳转收货页并传orderId+storeId |
| `index` | ✅ 状态卡片全部可点击（跳转采购列表带状态筛选/异常页）；**删除快捷操作区域** |
| `product-manage` | ✅ 商品列表显示厂家字段；新增/编辑弹窗增加"厂家/品牌"输入框（默认值"默认"） |
| _(未改)_ `receive-verify` | 已有接收orderId参数的能力，无需修改 |

### 📊 修改数据（1个）

| 文件 | 修改 |
|------|------|
| `mock.js` | 全部27个商品增加 `manufacturerName` 字段 |

### 🏷️ 厂家初始化

| 厂家 | 适用商品 |
|------|----------|
| 海天 | 生抽、老抽 |
| 李锦记 | 蚝油 |
| 金龙鱼 | 食用油 |
| 青岛 | 青岛啤酒 |
| 安井 | 速冻水饺 |
| 默认 | 蔬菜、肉类、海鲜、豆腐、大米、前厅用品（共22个） |

---

## ✅ 验收回报

| # | 项目 | 状态 |
|---|------|------|
| 1 | 采购页直接输入数量 | ✅ 完成 |
| 2 | 保留原数量调整能力 | ✅ 保留（−/input/+） |
| 3 | 采购页可滚动到底 | ✅ 完成（140rpx底部占位） |
| 4 | 到货日期默认第二天 | ✅ 完成 |
| 5 | 采购日期和备注移到商品列表下方 | ✅ 完成 |
| 6 | 备注栏缩小 | ✅ 完成（min 60rpx max 160rpx） |
| 7 | 我的采购里直接收货 | ✅ 完成 |
| 8 | 采购详情里直接收货 | ✅ 完成 |
| 9 | 首页状态卡片可点击 | ✅ 完成 |
| 10 | 首页删除快捷操作 | ✅ 完成 |
| 11 | 商品增加厂家字段 | ✅ 完成 |
| 12 | 旧商品补默认厂家 | ✅ 完成（27个全补） |
| 13 | 常见商品完成一轮厂家初始化 | ✅ 完成（5个品牌） |

### 不足项
无。13项全部完成。

---

## 2026-10-19 B5 前端体验批次修复

按《修复计划-2026-10-03》B5 执行，约 30 项中完成 25 项，余项见文末。

### 配置/资源（刀 1）
- P2-72：`app.json` 加 `"darkmode": false`
- P2-81：`.git/info/exclude` 的 `采购流程图-2026-09-20.html` 迁回 `.gitignore`
- P2-82：`login-logo.jpg` 859×859/81.4KB → 330×330/12.4KB

### 字典/工具单源（刀 2）
- `meta.js` 新增 `verifyStatusMap`（P2-53 核销态不再混用 statusMap.pending）、`abnormalTypeMap`（P2-54 补 missing_price）、`statusMap.superseded`（P2-55）
- `util.js` 新增 `formatMoney`（L34，supplier-receipts/supplier-prices/report-detail 三处内联收敛）
- L23 六页面自建状态字典收敛到 meta：supplier-receipts、supplier-orders、supplier-home、abnormal-list、receive-list
- P2-52：`cloud.js` createdById 兜底链剔除"姓名误当 ID"的旧数据；purchase-detail 本人草稿回退按姓名快照比对
- P2-73：store-manage.wxss 删除对全局 .form-input 等四个类的静默覆盖
- L26：`wx:key="index"` 无效引用 4 处改真实字段/*this（report-detail、receive-verify、product-manage、supplier-receipts）
- L21：supplier-home 重复方法收敛；L28：message markAllRead 改 path 局部更新；L35：user-manage stores 失败降级不再整页丢弃；L38：8 个文件缩进统一；L36：首页开下拉刷新；L12：index 死分支/空 stopBubble 清理

### 防重入/状态/提示（刀 3）
- purchase-create 一次性覆盖 P2-37/38/39/40/64/65：isSubmitting 置位提前到确认弹窗前、全段 try/finally、手动数量 0.5 被改写的 bug、成功后清拆单残留单号、拆单成功提示带两个单号、档案单失败提示对称
- P2-41：product-manage 保存/启停/导入防重入（后端查重属 B4 范畴，未动）
- P2-29：purchase-list 首屏 loading 态与空态互斥、空筛选条不渲染
- P2-30：report-detail 加载失败渲染失败态而非永久"加载中"
- P2-31：purchase-list/report-list/report-history 分页加请求序号防竞态
- P2-33：report-history 从详情返回保留翻页位置；P2-34：筛选按角色裁剪
- P2-63：receive-verify 手动单加口径提示条；P2-66：商品/价格管理加前端角色门禁；P2-67：三处登出清理统一 app.clearSession()；P2-68：supplier 端跳转目标统一回首页；P2-69：supplier-orders 首页加载失败清旧数据
- P2-74：主操作按钮升 88rpx、qty 控件 56→64/44→56rpx、btn-sm 60→68rpx

### 验证
- 26 个改动 JS 文件 `node --check` 全过；app.json/project.config.json/index.json 解析正常

### 本次未做（留待后续）
- P2-32：首页 onShow 4 次云调用合并优化（需设计缓存/合并口径，属性能项）
- L17/L18/L27：分页骨架与列表装饰逻辑去重、setData 裁剪（重构类，建议单独批次）
- L37：Excel 导入模板文件（需制作资源）
- P2-41 后半：`saveProduct` 后端查重（归 B4 校验批次）

---

## 2026-10-20 登录页角色按钮改两行两列并整体放大

面向供货商等年龄偏大的使用者，把登录页四个角色按钮由「一行四个」改为「两行两个」并放大，
同时保证输入账号时密码输入框仍不被键盘遮挡。

### 改动
- `login.wxml`：`.role-list` 由 flex 一行改为两列网格；`role-icon` 去掉 `icon-lg` 改由样式控制尺寸；内联 style 抽为 `.role-caption` / `.login-alt` / `.login-alt-green` / `.login-alt-grey` 四个类
- `login.wxss`：角色按钮文字 24→36rpx、图标 48→64rpx、卡片内边距与页头间距整体收紧（页头 120→24rpx、logo 220→124rpx），输入框 88→92rpx、字号 30→32rpx，主按钮字号 32→34rpx
- `login.wxss`（二轮）：角色按钮列宽由 `1fr` 满宽改为固定 `240rpx` + `justify-content:center`——满宽会把按钮拉成 145×81px 的扁长条（宽高比 1.78），"采购主管"四字只占 50%，两侧大片留白；改后为 120×81px（比例 1.47），文字饱满、整体居中
- `login.js`：新增 `computeCursorSpacing()`——`cursor-spacing` 只认 px 而页面按 rpx 自适应，固定写死 120px 会在宽屏上把「账号框→密码框」可用间距吃光（768px 平板上实测占比 142%），改为按 `240rpx` 等效值随 `windowWidth` 折算；四个输入框（普通/超管 × 账号/密码）统一绑定 `cursor-spacing="{{cursorSpacing}}"`

### 键盘遮挡口径
微信 `cursor-spacing` 实际生效值 = min(input 距底部距离, cursor-spacing)。要让密码框在账号框聚焦时不被键盘压住，需满足
「账号框底边→密码框底边 ≤ cursor-spacing」。改造后该间距占预算约 64%~65%（改造前 69%~80%）。

### 验证
- 以真实 wxss 数值驱动 headless Chrome 做几何回归（320/360/375/390/414/430/480 px 宽 × 键盘 220/260/300px，共 27 组）：
  密码框在账号聚焦与密码聚焦两种情形下**均完整可见**、角色文字无裁切、按钮列不溢出卡片、登录按钮首屏可见
- `login.js` `node --check` 通过；wxml 结构检查全过（wx:for / bindtap / data-role 未受影响）

### 首页门店行「切换」间距（2026-10-20）
- `index.wxml`：门店名与「切换 ▸」拆成两个节点——门店名包 `.store-name-text`（可收缩+省略号），「切换」改用 `.store-switch` 类，去掉内联 style
- `index.wxss`：`.store-info` 加 `flex:1; min-width:0`；`.store-name-text` 加 `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`；`.store-switch` 加 `margin-left:12rpx; flex-shrink:0; white-space:nowrap`；`.user-info` 同样加省略号
- 起因：门店名与「切换」之间原本无任何间距（贴在一起）；且门店名上限 30 字（`authService:548`），长名会把「切换 ▸」挤成竖排的「切/换/▸」——只加间距不够，必须同时允许门店名截断
- 验证：320/360/375/390/414/430 px × 门店名 8/13/21 字共 18 组——「切换」始终单行不换行、间距稳定 5~7px、门店名溢出时正确省略、用户名行同样不换行

### 未做
- 真机验证：本机未安装微信开发者工具，以上为几何推算 + DOM 实测；上线前建议在目标机型（尤其安卓安全键盘机型）实测一次
- `type="password"` 在部分安卓机型触发安全键盘、行为与普通键盘不同，属既有隐患，本次未改动
