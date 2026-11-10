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

### 登录页副标题删除（2026-10-20）
- `login.wxml` / `login.wxss`：删除页头 logo 下方「账号密码登录」副标题及其样式
- 理由：卡片内已有「欢迎使用」/「超级管理员登录」标题，副标题属重复信息；删后页头更清爽
- 验证：结构检查 + 几何回归（8 屏宽 × 3 键盘高度 = 24 组）全过——登录按钮仍首屏可见、密码框两种聚焦情形均完整可见、角色文字无裁切

### 未做
- 真机验证：本机未安装微信开发者工具，以上为几何推算 + DOM 实测；上线前建议在目标机型（尤其安卓安全键盘机型）实测一次
- `type="password"` 在部分安卓机型触发安全键盘、行为与普通键盘不同，属既有隐患，本次未改动

---

## 2026-10-20 登录态跨冷启动维持 + 分批收货报表批次修复

两处修复：①小程序登录态在冷启动/划掉重开后被无故清掉；②分批收货时收货报表详情显示错批次。
基线提交 `38e59ed`（固化此前 52 项未提交改动），修复提交 `7b9e39d` / `a4e970d` / `196d52b`。

### 登录态三处缺口

- **缺口1 · 冷启动永远先进登录页**：`app.json` 的 `pages[0]` 是 login，`app.js` 只把会话灌进 `globalData` 而不跳转，有效会话也停在登录页要求重新登录。
  改法：`utils/auth-guard.js` 拆出只读 `isLoggedIn()`（不产生跳转）；`pages/login/login.js` 的 `onShow` 探测到登录态即让路（供货商→`supplier-home`，其余→`index`），落点与 `handleLoginSuccess` 保持一致。
- **缺口2 · `sessionExpiresAt` 解析破坏 ISO 格式（iOS 必现）**：服务端返回 `toISOString()`（`2026-10-27T12:00:00.000Z`），而 `app.js` 原实现无条件把 `-` 换 `/`、去 `T`，改成 `2026/10/27 12:00:00.000Z`——非标准格式且带 `Z`，JSCore 判 `Invalid Date` → `NaN` → `NaN > Date.now()` 为 false → **每次冷启动都被判会话过期**（Android/V8 宽松故不显形）。
  改法：新增 `utils/date.js` 收口为「先按原生 ISO 8601 解析，失败才退回斜杠格式」。
- **缺口3 · 服务端判定失效后不回登录页**：`app.js` 校验失败只 `clearSession()` 不跳转，用户停在首页看到空数据（要等下一次业务请求的 401 兜底才被踢）。
  改法：`app.js` 新增 `redirectToLogin()`，`utils/cloud.js` 的 401 改走同一出口（统一出口，避免两次 toast）；`app.js` 补 `onShow` 温启动复检（原先只有 `onLaunch`）。

### 登录态附带修正（a4e970d）

`validateSessionOnLaunch` 原先把**所有非 0 的 code** 当成「会话失效」一律清会话，但 `code:-1` 只表示服务侧故障：
- 云端 `authService` 未部署 `validate` action → `code:-1`「不支持的认证操作」（该 action 是 2026-09-28 `ffb5bf4` 才加入，之前 `exports.main` 只有 `default` 分支）
- 云函数内部异常 → `code:-1`「登录服务异常，请稍后重试」

两者都会让用户被无故踢回登录页（开发版上尤其易命中：云端未跟着最新代码重新部署时，每次冷启动校验都返回 -1）。改为**只认 `code === -401`** 才清会话，其余保留本地登录态并打 warn 日志。

### 分批收货报表批次错位（196d52b）

`createReceipt` 按批次生成报表（`report_id = RPT_SR_<receiptId>` / `RPT_SRP_<receiptId>`，补生成版带 `_RG` 后缀），每张报表对应一批。
但 `getReportDetail/index.js` 的 `store_receipt_report` 分支按 `purchase_order_id + limit(1)` 取收货单——同一订单有多张 receipt 时**永远取到第一批**，且无 `orderBy` 取到哪批不确定。
后果：跨天分批收货时，第 2、3 批的报表页面显示第 1 批的明细，**页面合计与下载的 CSV 对不上**（账实不符），违反 P2-62/P0-8 的「页面行小计与文件一致」口径。

改法：从 `report_id` 反解本批 `receiptId`（剥 `RPT_SR_`/`RPT_SRP_` 前缀与 `_RG` 后缀）按 `receipt_id` 精确查询；`report_id` 格式异常（旧数据）时兜底回退到原 `purchase_order_id` 逻辑，至少不丢数据。
与已拍板口径一致：《业务模糊点确认清单》B3 定的是「报表按批次生成」。

### 验证

- 登录态：19 场景端到端模拟全过（会话有效进首页 / 供货商进门户 / 已过期停留 / 未登录停留 / 401 回登录页 / 校验不重复发请求 / 退出后台进程重启 / 杀进程重启 / 服务端已作废 / 温启动复检 / 云端未部署 validate / 云函数异常 / 旧格式兜底 / 手动登录竞态等），脚本在仓库外 `E:\酒店采购管理0804\_auth_session_backup_20261020\`
- 报表：**真实云函数代码 + mock 数据库**跑 6 场景——3 张批次报表各显示各的明细（修复前均显示第一批）、`_RG` 补生成版正确解析、旧格式 `report_id` 兜底不崩溃、页面合计与 CSV 一致
- 涉及文件 `node --check` 全过

### 部署提醒（未做）

- 登录态修复**只改前端**（`app.js`/`login.js`/`auth-guard.js`/`cloud.js`/`date.js`），需**重新上传前端小程序包**；云端 `authService` 建议一并重新部署（`validate` action 可能尚未部署）
- 报表修复在 `cloudfunctions/`，需**重新部署 `getReportDetail`**

---

## 2026-11-05 A 线修复：F1 多设备会话 / F2 最终批 shortage / F3 报表补生成锁

基于 2026-11-03 全量复审（commit 7df3c1b）的三项待修发现，当日获批修复并提交
（39d1dd5 / 21880f8 / 8997c47）。修复前已先核实 11-04 拉取的 S10 三 commit
（b8adb97/9a5be21/e337b47），结论全部成立（死锁修复、门禁加固、幂等防降级）。

### F1（39d1dd5）多设备会话查询失效（P1）
- 19 个云函数 `getSessionUser` 的 `.where({status:1, sessions:{token_hash:x}})` 对数组
  内对象做整元素相等匹配，而 session 元素是 `{token_hash,expires_at}` 两字段 → 永远
  匹配不上，静默回退 `session_token_hash`（login 每次覆写为当前设备 token）→ 设备 B
  登录即踢 A，B12 多设备会话整体失效，退化为"最后登录者独占"
- 修复：统一改数组元素字段点路径 `'sessions.token_hash': tokenHash`；17 处补防回退
  注释；各文件内存内 `expires_at` 二次校验逻辑不变
- 验证：node --check 19/19 通过；旧写法 grep 0 残留

### F2（21880f8）最终批 shortage 陈旧快照（P2）
- `createReceipt` 外层预检用旧 `historyQtyMap` 设 `isShortage`，事务内只对非最终批
  清零、最终批不重算 → 并发下 B 先提交填补缺口时，A 最终批沿用陈旧值生成虚假
  shortage 异常、单据误标 `receipt_abnormal`（不影响付款金额，shortage 行按实收计价）
- 修复：事务内对所有行用新鲜 `txHistoryQty + thisQtyMap` 逐行重算（非最终批清零
  逻辑不变）；外层预检保留，注释自述"以事务内为准"自此名副其实
- 顺带（核实 S10 时发现的预存口子）：qty=0 且无异常标记的 craft 行不再落库
  `receipt_item`（正常前端已过滤，仅防 crafted 请求噪音行；qty=0 行在最终批必为
  历史已收齐，重算后不携带 shortage，跳过不影响异常台账完整性）

### F3（8997c47）reprice/regenerate 并发锁（P2）
- `repriceReceipt`/`regenerateReceiptReports` 缺 `settleReceipt` 那套 CAS 锁，并发
  触发产重复报表版本（report_id 恒 `_RG` 且不标 superseded）
- 修复：两函数各拆"入口（管锁）+ 持锁主体"，共用 `regen_lock`（CAS 条件更新抢占 +
  10 分钟 stale 自愈，同 `settle_lock` 模式）；reprice 内部调 regenerate 传
  `_lockHeld` 跳过抢锁避免自我死锁；dispatcher 剔除客户端伪造的 `_lockHeld`
- 未动：`_S` 增量账单与 `_RG` 全量重出的语义重叠（settle 解锁行被 _RG 再次计入致
  双计）是更深一层问题（2026-10-18 记录），锁只防并发不防先后语义重叠

### 部署（已完成，2026-11-06 补记）
- F1/F2/F3 连同 11-04 S10 修复（`confirmSupplierOrder`/`createReceipt`）已于 2026-11-05
  在本机 IDE 全部部署：19 个会话函数 + confirmSupplierOrder + createReceipt + dataService
- 2026-11-06 用户确认云端版本正常，无部署滞后

---

## 2026-11-05 解耦四项（前端防重入 / dataService 拆分 / 云函数共享模块 / 报表构建器）

按用户批准的顺序执行，commit：3d2c0f2 → 6e303f1 → aba7a5d → fdd8375。

### ① 前端防重入（3d2c0f2）
- 新增 `utils/submit-guard.js`：submitGuard(page, task) 重入返回 undefined；try/finally
  释放（旧手写模式异常路径会卡死锁）；锁字段沿用 `_submitting` 与旧模式兼容
- 补 6 处无防护写操作：abnormal-list 3（start/resolve/close）+ user-manage 3
  （resetPassword/saveUser/toggleUserStatus）；重入时不动 loading（由进行中的那次收尾）
- 旧手写模式（9 页 _submitting + 2 页 isSubmitting）保留不动，新代码一律走守卫

### ② dataService 单体拆分（6e303f1）
- 1822 行单体 → 11 个域模块 + 薄 dispatcher（同目录多文件，整目录上传，部署方式不变）：
  _shared（db/会话/角色）/messages/notify/report-utils/catalog/approval/abnormal/settle/
  cancel/verify/stats + index.js（23 case 不变）
- 保真验证：拆分前后全部代码行排序 diff 业务 0 差异（仅 77 行结构行）；函数清单 41/41；
  node --check 12/12
- 保真 diff 抓到并修正一处搬运笔误：settle.js ⑥ 明细/合计行曾误混入 ⑤ 的「下单数量」列，
  已对齐 HEAD/createReceipt 的 8 列口径

### ③ 云函数共享模块（aba7a5d）
- 源头 scripts/cloud-shared/（session/csv-utils/report-version/store-query 四模块，自包含
  cloud.init）+ scripts/sync-shared.js 复制到各函数 shared/ 副本（--check 校验）；
  副本 git 追踪，部署机 pull 即可直接上传
- 19 个函数删 getSessionUser/hashToken 本地副本；4 函数删 csvField/safePathPart/
  getNextVersion 副本；2 处 getStoreManagerId 副本同收；dataService 内部 re-export
- 副本差异留痕：authService 旧版 legacy 脏数据场景放行 → 共享版从严；hashToken
  空值兜底补齐
- 52 份副本 → 4 个源头；node --check 全过；副本一致性校验 19×4 通过

### ④ 报表 CSV 构建器统一（fdd8375）
- scripts/cloud-shared/receipt-reports.js：buildReceiptReports 单源构建 ③④⑤⑥
- createReceipt 报表段 ~150 行 → 构建器调用；settle.js _RG 主体同（DB 行经
  adaptReceiptItem 适配，missing_price 按收货时同条件重新推导）
- 顺带修复 _RG 口径漂移 4 处：缺价行曾显示「正常」、infoHead 少两列、缺
  abnormal_summary、shortage 文案「短收」→「少货/缺货」
- 行为测试 24/24（scripts/_tmp_test/test-receipt-reports.js，mock 云环境锁定关键口径）

### 部署（已完成，2026-11-06 补记）
- 全部 19 个云函数已于 2026-11-05 在本机 IDE 部署完毕（含新增 shared/ 子目录与
  dataService 多文件结构）
- 前端 submit-guard 改动随小程序包上传生效

### #25 拍板收窄（5e56aa4，2026-11-05）
- 补收收齐自动关闭异常从「shortage/quality/wrong_item 一刀切」收窄为**仅 shortage**：
  质量/错货的数量补齐解决不了换货索赔，自动关闭会把未决索赔从待处理列表埋掉；
  missing_price 维持原口径走 repriceReceipt。createReceipt 查询加 type:'shortage' 过滤
- createReceipt 已随当日本机 IDE 全量部署生效（2026-11-05）
- getReportDetail missing_price 修复（cd0bdd3）：缺价行页面曾显示「正常」（字典缺类型 +
  receipt_item 不落 is_missing_price 字段），改按收货时同条件推导，与 CSV 构建器同口径；
  与 createReceipt（#25）同批部署

### 遗留小项清理（7a77b84，2026-11-05）
- getPurchaseOrderDetail 报表下发剥离 file_url/file_name（chef 旁路收口，与 getReports 同口径）
- approval-list 快速驳回改弹框必填原因（对齐服务端必填与 approval-detail）
- user-manage/store-manage 补客户端超管门禁（服务端 requireSuperAdmin 兜底不变）
- F4：verifyManualOrder 孤儿凭证防并发——删旧文件改按写入后重读的最新引用清单计算
- 订阅消息死代码两端加「未启用」标记注释（27008a9，业务方确认暂不需要）
- 部署状态：getPurchaseOrderDetail、dataService 已随 2026-11-05 全量部署生效；前端三页改动
  随小程序包上传生效（2026-11-06 确认云端无滞后）

---

## 2026-11-09 _S/_RG 双计修复：全量版取代 + 多波补结算 + 历史清理

拍板口径（本次确认）：①全量重出（`_RG`）后旧版全部取代（原版 / 之前各波 `_S` / 旧 `_RG`
标 superseded，列表、详情、下载统一隐藏）；②历史并存数据一次性清理；③不做审计查看入口；
④补结算支持多波（异常分多波处理时可多次增量补结算）。

### 问题
- `_RG` 全量重出按当前 `receipt_item` 状态重出 ③④⑤⑥，但不标旧版 superseded；
  `_S` 增量账单据「原版保持有效」设计也不标。同一解锁行会同时出现在 `_S` 与 `_RG`，
  多版并存计入 → 双计（2026-10-18 记录问题；F3 的 regen_lock 只防并发，不防先后语义重叠）。
- 原补结算幂等 `endsWith(receiptId + '_S')` 只允许一张 `_S`，异常分多波处理时后续解锁行无法再结算。

### 改动
- `scripts/cloud-shared/receipt-reports.js`（源头；副本由 sync-shared.js 同步）
  - 四类报表新增 `receipt_id` 字段（历史数据无字段也能从 report_id 反解，新字段便于按批次查询）
  - 新增 `receiptIdFromReportId()` / `RECEIPT_REPORT_TYPES`
  - `buildReceiptReports` 返回新增 `files`（含新报表 `_id`/report_id/type/scope_id）——
    `_RG` 的 report_id 每次重出相同，取代时必须按数据库 `_id` 区分新旧版本
- `cloudfunctions/dataService/settle.js`
  - `_RG` 成功后 `supersedeReceiptReports`：本批次旧版全部 superseded（按 receiptId 限定，
    不波及同一订单其他批次），`superseded_by_report_id` 指向对应新全量版
  - `markRecordsCoveredByFullReports`：`_RG` 覆盖的 pay_received 异常记录打
    `settled_at / settled_via:'full'`，后续补结算不再重复计入（双计根因的直接封堵）
  - `settleReceipt` 多波化：`receipt.settle_wave_completed` 记录完成波次，report_id
    `_S` / `_S2` / `_S3`…；异常记录打 `settled_wave / settled_via:'increment' / settled_in_report_id`
  - 行级门禁：行上仍有 pending/processing 异常时本波跳过该行，等后续波次
    （替代原来「全部异常处理完才允许补结算」的全局阻断）
  - 部分失败断点续跑：同波已生成的供应商报告按 report_id 跳过，收尾按已有报告回读的异常 id 一并标记
  - 历史兼容：无 settled 标记的旧数据按 resolved_at ≤ 历史 `_S`/`_RG` 生成时间判定已覆盖，不重复结算
- 新增 `cloudfunctions/reportMaintenance`（仅超管，默认 dryRun，`action:'apply'` 才落库）：
  - 取代：含 `_RG` 的 (收货单, report_type, scope_id) 组保留最新 `_RG` 及其后 `_S` 波次，
    其余旧版 superseded；无 `_RG` 的组不动（原版+增量口径正确，避免误伤部分失败的历史重出）
  - 回填 `receipt_id`、`_S` 的 `settle_wave / settle_type / settle_for_receipt`
  - 回填异常记录 settled 标记与 `receipt.settle_wave_completed`（只回填历史 `_S` 的第 1 波）
- `pages/receive-list`：补结算成功提示带波次序号

### 验证
- `scripts/_tmp_test/test-settle-versions.js`：55 项全过（波 1/波 2 增量、无新行拒绝、
  行级门禁、`_RG` 取代与批次隔离、连续两次 `_RG`、历史 `_S` 兼容、部分失败断点续跑、
  regen_lock 互斥、清理工具 dryRun/apply/幂等）
- `scripts/_tmp_test/test-receipt-reports.js` 24 项全过（构建器口径回归）
- node --check 相关文件全过；sync-shared --check 20 函数 × 5 模块副本一致

### 部署状态（2026-11-09 用户确认）
- ✅ 云函数已部署：`dataService`、`createReceipt`（构建器副本变更）、新增 `reportMaintenance`
- ✅ 历史清理已核验（2026-11-09 `dryRun`）：59 份报表 / 11 张收货单，
  **无 `_RG`、无 `_S` 并存**（supersede / 回填计划全 0，`unparsedReportIds` 为空）——
  线上无历史双计，`apply` 无需执行。本次修复属预防性质。
- ✅ P2-41 配套云函数已部署（2026-11-10 用户确认）：`dataService`（saveProduct 后端查重）、
  `importProducts`（落库前终查）
- ⏳ 前端包待上传（receive-list 波次提示 + P2-32 首页缓存 + P1-20 三态 + P1-15 剔除提示 +
  L37 模板下载按钮）

---

### 2026-11-09 代码审查与加固（二轮）

对上一节改动做全量自审（外加两份独立审查报告逐条核实），确认并修复 4 个真实问题，
另收编若干结构性加固。

**确认的 bug（已修）**

1. **⑥原 + `_S` 双计**（老代码就有，首版重写时仍在）：纯少货行收货时即 `payable=true`、
   已进原版 ⑥（createReceipt「纯少货不剔除」），而异常解决弹窗对所有类型都问
   「按实收付款」——少货记录选「是」后该行会在 `_S` 再计一次。
   修法：`settleReceipt` 按「是否已被账单计价」分类——已计价行（收货即计价 / 被 `_RG`
   覆盖 / 被含该行的补结算报告覆盖）只补结算标记（`settled_via: already_priced`），
   不再出增量账单；质量/错货等收货被剔除行仍为解锁行。
2. **断点续跑漏账**：部分失败的波次重试时，已有报告未覆盖的新解锁行会被误标已结算
   却没进任何账单。修法：标记按「报告实际覆盖范围」（settle_item_ids / settle_abnormal_ids）
   判定，未覆盖的行留待下一波（`deferredRows` 透出，前端提示）。
3. **清理工具分批回填掐掉时间兜底**：`receipt_id`/`settle_wave` 回填对全部单据生效，
   而异常记录标记回填受 `maxReceipts` 分批——超出的单据会既没标记又失去时间兜底，
   下次补结算双计。修法：`settle_wave` 与 `_RG` 的 `receipt_id` 不再回填（它们是
   settle.js 判别历史账单的依据）；历史行 `receipt_id` 整体不回填（现有代码一律从
   report_id 反解，不读该字段；全量回填也超出云函数时限）。
4. **`receiptIdFromReportId` 首个 `RCP` 匹配**：供应商 id 含 `RCP` 字样会误解析。
   改为剥掉 `_RG`/`_S[n]` 后缀后取最后一段并要求 `RCP` 开头。

**结构性加固**

- **翻转后置**：`payable_flag` 在出账确认后才写——先翻转后出账中途崩溃会留下
  「已付款但没进任何账单」的行，且重试会因 payable=true 被当已计价行跳过（漏账）。
  配合分类逻辑，「已翻转未出账」的历史遗留行会被识别并重新按解锁行出账。
- **report_id 文法单源化**：`settleWaveOf` / `isSettleVersion` / `isFullVersion` /
  `SETTLE_REPORT_TYPE` / `reportTimeMs` 收敛进 `scripts/cloud-shared/receipt-reports.js`，
  settle.js 与 reportMaintenance 共用同一份实现（F1 副本漂移教训）。
- **写放大收敛**：supersede、结算标记、`payable_flag` 翻转、清理工具 apply 全部改
  `where({_id: _.in(chunk)})` 分组批量写（200/批）；清理工具收货单批量取（50/批）。
  避免数千次逐 doc 往返打满 ~60s 云函数时限（历史数据量大时原实现跑不完 apply）。
- 清理工具 `receiptsWithFull` 改 Set；`planSettlementBackfill` 每供应商最新账单一次取好。
- `receipt.js` supersede 死分支（report_id 兜底）与构建器 `_id` 防御性默认值删除
  （db.add 成功必有 _id，防御默认值反而会把新报表从保留集里漏掉）。

**测试**：新增「已计价防护」「续跑延迟」两场景，合计 **65 项全过**；
构建器回归 24 项全过；`sync-shared --check` 20 函数 × 5 模块一致。

**已知边界（未修，评估后接受）**
- `_RG` 标记记录（markRecordsCoveredByFullReports）若中途失败，未标记的记录在后续补结算
  可能重复计入；`_RG` 返回失败后重试会自愈，视为可接受窗口。
- `getReportDetail` 对 ⑥ 供应商带价账单按「供应商+日期」取全部收货明细，不限定本收货单，
  多波 `_S` 后详情页行数/合计会与 CSV 对不上（既有问题，独立批次处理）。
- 历史已发生的「少货 ⑥原+_S 双计」账单内容无法回改（CSV 是快照）；出过一次 `_RG` 后
  有效账单即恢复正确。

---

### 2026-11-09 P2-32 首页请求风暴修复（B5 遗留清一项）

原实现每次 `onShow` 固定发 4 个云调用（最近订单/最近报表/消息/状态统计），
快速切 tab 或页面往返会成套叠加。`pages/index/index.js` 改两道闸 + 载荷瘦身：

- **在途去重**：`_loading` 期间新的 `onShow` 直接让路（在途请求刚发出，数据足够新）
- **新鲜度缓存**：同账号同门店 10 秒内复用上次结果（`_loadedKey`/`_loadedAt`）；
  下拉刷新（force）、换门店/换账号（缓存键变化）绕过；**加载失败不记缓存**，下次进页即重试
- **载荷瘦身**：`getReports` 显式 `pageSize: 3`（原默认拉 20 条只用前 3）
- **刻意不做后端聚合**：订单/报表的角色过滤各自单源在 `getPurchaseOrders`/`getReports`，
  复制进 dataService 会重演共享模块漂移（F1 教训）；本轮只做前端频控

**验证**：`scripts/_tmp_test/test-index-cache.js` 10 项全过（mock `wx`/云调用 + 假时钟驱动
TTL 过期/在途去重/强制刷新/换门店/失败重试/载荷参数）。

B5 遗留四项至此清一项，剩 L17/L18/L27（分页骨架/装饰去重/setData 裁剪，重构类）、
L37（Excel 导入模板）。

---

## 2026-11-09 可动手五项清理（文档同步 / P1-20 / P1-15 / P2-41 / L37）

### 文档同步
- `业务模糊点确认清单`：#4 与 #15 两处「异常全部处理完后才能补结算」旧口径改为
  行级门禁 + 多波增量；页脚汇总表新增 **#26**（补结算多波 + `_RG` 全量取代拍板，
  含 `reportMaintenance` dryRun 核验线上无历史并存），并同步修正正文两处旧口径
- `README`：B5 进度 25/30 → 26/30（P2-32 已修）；云函数一览补 `reportMaintenance`

### P1-20 异常处理「取消」=「拒绝付款」修复
- `abnormal-list.js` 付款裁决由确认框（取消=提交且拒绝付款）改 `wx.showActionSheet`
  三态：按实收付款 / 不付款 / 取消（**取消 = 中止整个提交**，不落任何裁决）

### P1-15 下架商品数量静默丢弃修复（purchase-create）
- `_updateTotal` 页脚只统计真正会随提交生效的行（`products` 中存在的），不再虚高
- `_saveOrder` 检测被剔除行（`_qtyMap>0` 但不在可购列表），弹确认框**列名并让用户确认**
  后才继续（原实现静默丢弃、用户零提示）；`_productNameMap` 在
  `filterProducts`/`loadExistingOrder` 留底商品名，草稿下架行也能报出名字

### P2-41 后半 saveProduct 后端查重
- `catalog.js saveProduct`：新建按**名称+厂家**拒绝重复（与 importProducts 判重同口径）；
  编辑改名/改厂家才查重（排除自己），不改名不查——容忍历史重复数据编辑其他字段
- `importProducts` 落库前终查：对待插入名称分块 `_.in` 再查一遍，把「初次查重 → 逐条写入」
  的并发窗口压到毫秒级
- 测试：`scripts/_tmp_test/test-product-dedup.js` 6 项全过（新建拒重/不同厂家放行/
  编辑自己放行/撞他人名拒/改名通过）

### L37 Excel 导入模板
- 新增 `scripts/make-import-template.js`：无本地 xlsx 依赖，手工构造最小
  SpreadsheetML 包（STORE zip）——**两张表：列头（与 HEADER_ALIASES 严格对齐）+
  填写说明**；不含示例数据行（示例行会被当真实商品导入）
- 产物 `assets/templates/商品导入模板.xlsx`（5.4KB）随小程序包分发；验证：
  PowerShell Expand-Archive 解包 + 全部 XML 良构通过
- `product-manage` 新增「下载模板」按钮：包内资源读出 → 写用户目录 →
  `wx.shareFileMessage` 转发到聊天（导入本就要求从聊天选文件，形成闭环）；
  低版本基础库退化为 `wx.openDocument` 预览（菜单可转发）

### 流程图同步（2026-11-09）
- `采购流程图.html` 四处更新：副标题覆盖至 S1–S10/#1–#26；确认接单补 S10 代确认 +
  部分收货窗口；异常处理改 P1-20 三态 + #25 收窄；⑥ 补结算改 #26 多波增量 +
  已计价防双计 + `_RG` 旧版作废
- `采购流程图.png` 由 headless Chrome 按内容高度重新导出（1500×1640，目检通过）
