# 07 基础设施 / 全局配置 / 样式 / 图标资产 / 构建脚本

- 分支：`backup`（只读排查，未修改任何源码）
- 范围：`app.json`、`project.config.json`、`project.private.config.json`、`.gitignore`、`sitemap.json`、`app.wxss`、`styles/icons.wxss`、`scripts/build-icons.js`、`utils/meta.js`、`assets/`、`cloudfunctions/*/package.json`（19 个）、`pages/**` 四件套存在性
- 方法说明：Bash/PowerShell 两次被限流，改为 `Glob`+`Grep` 完成批量核对；`assets/icons/*.png` 未读二进制（改用文件体积判断）；页面 wxss 未逐个阅读。

---

## 1. 概览

| 项 | 结论 |
|---|---|
| 注册页面 | `app.json:2-29` 共 26 页，`pages/**` 下 26 个 `.js`、26 个 `.wxml`、26 个 `.json`、26 个 `.wxss`，**四件套全齐、无未注册孤儿页** |
| tabBar | 4 项（首页/采购/报表/消息），8 个图标路径全部存在 |
| 主包 | 无分包（`subpackages` 未配置），26 页单包 |
| 云函数 | 19 个目录 19 个 `package.json`，`wx-server-sdk` 版本 100% 统一 |
| 样式 | 有 CSS 变量层，但令牌覆盖不完整；存在 2 处完全重复定义 |
| 图标 | SVG data-URI 生成链闭环，无死图标、无孤儿文件；`login-logo.jpg` 偏重 |
| 最大隐患 | `utils/meta.js` 枚举与业务代码双写 + 2 个死状态；`importProducts` 的 `xlsx@0.18.5` 依赖 |

---

## 2. app.json 注册表 vs 实际文件对照表

`app.json:2-29` 26 条注册，逐一核对 `.js` / `.wxml` / `.json` / `.wxss`：

| # | 注册路径 | .js | .wxml | .json | .wxss | tabBar |
|---|---|---|---|---|---|---|
| 1 | pages/login/login | ✓ | ✓ | ✓ | ✓ | |
| 2 | pages/account/account | ✓ | ✓ | ✓ | ✓ | |
| 3 | pages/index/index | ✓ | ✓ | ✓ | ✓ | 首页 |
| 4 | pages/store-switch/store-switch | ✓ | ✓ | ✓ | ✓ | |
| 5 | pages/purchase-create/purchase-create | ✓ | ✓ | ✓ | ✓ | |
| 6 | pages/purchase-detail/purchase-detail | ✓ | ✓ | ✓ | ✓ | |
| 7 | pages/purchase-list/purchase-list | ✓ | ✓ | ✓ | ✓ | 采购 |
| 8 | pages/approval-list/approval-list | ✓ | ✓ | ✓ | ✓ | |
| 9 | pages/approval-detail/approval-detail | ✓ | ✓ | ✓ | ✓ | |
| 10 | pages/receive-list/receive-list | ✓ | ✓ | ✓ | ✓ | |
| 11 | pages/receive-verify/receive-verify | ✓ | ✓ | ✓ | ✓ | |
| 12 | pages/abnormal-list/abnormal-list | ✓ | ✓ | ✓ | ✓ | |
| 13 | pages/message/message | ✓ | ✓ | ✓ | ✓ | 消息 |
| 14 | pages/report-list/report-list | ✓ | ✓ | ✓ | ✓ | 报表 |
| 15 | pages/report-detail/report-detail | ✓ | ✓ | ✓ | ✓ | |
| 16 | pages/product-manage/product-manage | ✓ | ✓ | ✓ | ✓ | |
| 17 | pages/supplier-manage/supplier-manage | ✓ | ✓ | ✓ | ✓ | |
| 18 | pages/price-manage/price-manage | ✓ | ✓ | ✓ | ✓ | |
| 19 | pages/report-history/report-history | ✓ | ✓ | ✓ | ✓ | |
| 20 | pages/user-manage/user-manage | ✓ | ✓ | ✓ | ✓ | |
| 21 | pages/store-manage/store-manage | ✓ | ✓ | ✓ | ✓ | |
| 22 | pages/supplier-home/supplier-home | ✓ | ✓ | ✓ | ✓ | |
| 23 | pages/supplier-orders/supplier-orders | ✓ | ✓ | ✓ | ✓ | |
| 24 | pages/supplier-receipts/supplier-receipts | ✓ | ✓ | ✓ | ✓ | |
| 25 | pages/supplier-prices/supplier-prices | ✓ | ✓ | ✓ | ✓ | |
| 26 | pages/supplier-messages/supplier-messages | ✓ | ✓ | ✓ | ✓ | |

**双向零差异**：注册集 == 磁盘集（26 = 26），无「存在但未注册」路径，无「注册但缺文件」路径。tabBar 的 4 个 `pagePath` 均在注册表内（微信硬性要求）。

其他 `app.json` 字段：

| 字段 | 位置 | 备注 |
|---|---|---|
| `window` | 30-36 | 导航栏 `#00873E`，与 `--color-primary` 一致 ✓ |
| `tabBar.color` | 38 | `#999999` 与 icons 脚本的 `COLORS.grey` 一致 ✓ |
| `style: "v2"` | 69 | 正常 |
| `sitemapLocation` | 70 | 指向存在的 `sitemap.json` ✓ |
| `cloud: true` | 71 | 云能力总开关 ✓ |
| `lazyCodeLoading: "requiredComponents"` | 72 | 组件懒加载，利于冷启动 ✓ |
| `__usePrivacyCheck__: true` | 73 | ⚠️ 见风险 R6（隐私合规链路未见闭环证据） |
| 未配置 | — | 无 `permission`、无 `networkTimeout`、无 `subpackages`、无 `darkmode`、无 `tabBar.custom` |

---

## 3. 配置与敏感信息检查

### 3.1 `project.config.json`（有未提交改动）

`git diff` 全文如下，仅两处新增：

```diff
   "compileType": "miniprogram",
+  "cloudfunctionRoot": "cloudfunctions/",
   "packOptions": { ...
       { "type": "file", "value": "采购流程图.html" },
+      { "type": "file", "value": "采购流程图.png" },
```

判定：**两处都是正确且必要的改动，不含任何环境信息或密钥泄露，建议直接提交。**
- `cloudfunctionRoot`：缺失时 DevTools 无法定位云函数根目录，无法右键上传/部署。当前值 `cloudfunctions/` 与磁盘实际一致（`project.config.json:4`）。
- `采购流程图.png`：该图是设计草图，`.png` 不在 `packOptions` 的后缀忽略规则内（只忽略了 `.md`/`.html`），不显式排除就会被打进小程序包。

其余设置（`project.config.json:5-22` packOptions，`project.private.config.json:5-22` setting）：

| 项 | 值 | 评价 |
|---|---|---|
| `packOptions.ignore` folder | `_tmp_test` / `seed-data` / `scripts` / `cloudfunctions` | ✓ 敏感与工具目录全部排除；`scripts/build-icons.js` 被排除正确（产物 `styles/icons.wxss` 在包内） |
| `packOptions.ignore` suffix | `.md` / `.html` | ✓ 顺带把 `docs/` 下所有审计文档挡在包外 |
| `urlCheck: false` | 私配 6 | 仅放宽本地调试域名校验，不影响线上（低） |
| `showES6CompileOption: false` | 私配 16 | 只是隐藏开关 UI，**并非关闭 ES6 编译**（低） |
| `checkInvalidKey: true` | 私配 18 | ✓ 保留 wxml key 合法性校验，好事 |
| `useIsolateContext: true` | 私配 21 | ✓ 组件隔离，好 |
| `ignoreDevUnusedFiles: true` | 私配 19 | ✓ 减小开发包 |
| `bigPackageSizeSupport: false` | 私配 20 | 单包无分包，需留意 2MB 上限（见 R6）（低） |
| `autoAudits: false` | 私配 11 | 关闭自动代码质量扫描，仅影响开发体验（低） |
| `libVersion: "3.17.1"` | 私配 2 | 本地基座版本偏好，属机器级配置（低） |

### 3.2 敏感信息

- **两个配置文件都没有 `appid` 字段**，也没有云环境 ID（`env`）。云环境应由 `app.js` 里 `wx.cloud.init({ env })` 运行时注入 —— `app.js` 不在本次范围，列为待确认。含义：他人 clone 仓库后需自行在 DevTools 里关联 AppID 才能跑通。
- **未发现**任何密钥、token、口令、云环境 ID 写入上述配置。
- `.gitignore:4-5` 注释明确写了「临时测试脚本（含硬编码测试口令，严禁入库）」——说明历史上发生过口令泄漏，`_tmp_test/` 被忽略是正确补救。
- `docs/` 目录（本批次审计报告所在）未被 `.gitignore` 忽略，会随仓库扩散；因 `.md` 后缀规则不会进小程序包，仅属信息暴露面（低）。

---

## 4. 样式设计系统盘点

### 4.1 设计令牌（`app.wxss:5-40`）

| 类别 | 令牌 | 值 |
|---|---|---|
| 主色 | `--color-primary` / `-light` / `-dark` | `#00873E` / `#33A862` / `#006B33` |
| 语义色 | `--color-success` / `-warning` / `-danger` / `-info` | `#52C41A` / `#FAAD14` / `#FF4D4F` / `#00873E` |
| 文本 | `--color-text-primary/-secondary/-tertiary/-placeholder` | `#262626` / `#595959` / `#8C8C8C` / `#BFBFBF` |
| 背景 | `--color-bg-page/-card/-grey` | `#F5F7FA` / `#FFFFFF` / `#F0F2F5` |
| 线 | `--color-border` / `--color-divider` | `#E8E8E8` / `#F0F0F0` |
| 圆角 | `--radius-sm/-md/-lg/-xl` | 8 / 12 / 16 / 24 rpx |
| 阴影 | `--shadow-card` / `--shadow-float` | 2 级 |
| 排版 | — | 基础 28rpx，字体链完整（苹方 → 雅黑 → sans-serif） |

### 4.2 组件层（`app.wxss`）

`.container` 43-47、`.flex-*` 49-74、`.card` 77-83、`.card-title` 85-90、`.tag*` 93-129、`.btn*` 132-187、`.list-item` 190-200、`.form-*` 203-233、`.empty-state*` 236-252、`.divider` 255-259、`.text-*` 262-300。另有 `@import "./styles/icons.wxss"`（第 2 行）。

### 4.3 重复与冲突

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| S1 | `.tag-primary` 与 `.tag-info` **规则完全相同**（背景 `rgba(0,135,62,0.1)`、文字 `var(--color-primary)`），且 `--color-info` 与 `--color-primary` 同值 | `app.wxss:12`、`101-104` vs `116-119` | 低 |
| S2 | `.card` 与 `.list-item` 视觉完全同构（白底、`radius-lg`、`padding:28rpx`、`shadow-card`），仅 `margin-bottom` 20rpx vs 16rpx 之差 | `app.wxss:77-83` vs `190-196` | 低 |
| S3 | 令牌覆盖不完整：状态标签用裸 `rgba(...)`（102/106/112/117/122）、按钮渐变用裸 `#FF7875`、`#73D13D`、`#ffffff` | `app.wxss:101-124`、`148-171` | 低 |
| S4 | **无间距令牌、无字号阶梯令牌**：`padding 24/28rpx`、`margin 16/20/28rpx`、字号 `24/28/30/32/36rpx` 全部散落硬编码 | `app.wxss:44,80,89,95,97,138,179,193,204,208,288-300` | 中 |
| S5 | **双源色板**：`scripts/build-icons.js:10-23` 的 `COLORS` 有 6 个颜色（`orange #FA8C16`、`purple #722ED1`、`teal #13C2C2`、`magenta #EB2F96`、`blue #5B8FF9`、`mint #5AD8A6`）**不存在于 `app.wxss` 变量中**。改主色需同时改两处，且脚本注释自称「与 app.wxss CSS 变量保持一致」但实际并未完全一致 | `build-icons.js:9-23` vs `app.wxss:6-13` | 中 |
| S6 | 无 `safe-area-inset-bottom` 适配，tabBar 页底部留白需各页自理（未抽查页面 wxss） | — | 低（待确认） |

---

## 5. 图标体系闭环检查

### 5.1 `scripts/build-icons.js` 流水线

| 环节 | 位置 | 内容 |
|---|---|---|
| 色板 | 10-23 | 12 色（white/primary/success/warning/danger/orange/purple/teal/magenta/blue/mint/grey） |
| 图标源 | 26-68 | 41 个 SVG path 片段，统一 `24×24` viewBox、`stroke-width:2` 线性风格 |
| 组合表 | 71-160 | `VARIANTS` 88 组「图标 + 颜色」 |
| 命名 | 162-164 | `kebab()` 把 camelCase 转 kebab（`calendarDays` → `calendar-days`） |
| SVG 组装 | 166-168 | `fill='none'` + `stroke=${color}` + 圆头线帽 |
| data-URI | 170-173 | `encodeURIComponent` 后**手动把单引号替换为 `%27`**（`encodeURIComponent` 不编码单引号，注释与实现自洽 ✓），确保 `url('...')` / `url("...")` 都不截断 |
| 产物 1 | 176-208 | `styles/icons.wxss`：`.icon` 基类 40rpx + 5 档尺寸（xs 26 / sm 32 / lg 48 / xl 56 / xxl 100）+ `.icon-inline` + 88 条 `.icon-{name}-{color}` |
| 产物 2 | 210-226 | `scripts/icons-preview.html`：浏览器预览页，白色图标自动套 `#00873E` 深底便于肉眼核对 |

### 5.2 闭环验证结果（全部通过）

- **meta.js → icons.wxss**：`reportTypeMap` 的 8 个 `iconClass` + 兜底 `icon-file-grey`，逐一命中 `VARIANTS`（`clipboard-primary` `build-icons.js:76`、`package-success:91`、`tag-warning:84`、`factory-purple:81`、`truck-teal:109`、`chart-magenta:103`、`calendar-blue:111`、`calendar-days-mint:113`、`file-grey:114`）✓
- **categoryIconMap → icons.wxss**：12 个分类 base 的 `-grey` / `-white` 两态全部存在（`chef 99/140`、`armchair 135/141`、`leaf 142/143`、`drumstick 144/145`、`fish 146/147`、`shaker 148/149`、`bowl 150/151`、`beer 152/153`、`snowflake 154/155`、`utensils 156/157`、`brush 158/159`、`package 92/93`）✓
- **死图标**：41 个 `ICONS` 定义全部被 `VARIANTS` 引用，无死代码 ✓
- **生成物与脚本同步**：`styles/icons.wxss` 已包含 `icon-calendar-days-mint`（生成物第 64 行附近），说明上次运行脚本是在加月汇总报表之后，未漂移 ✓

### 5.3 `assets/icons/` 实物 vs app.json 引用

| 文件 | 体积 | app.json 是否引用 | 判定 |
|---|---|---|---|
| `home.png` | 193 B | `tabBar.list[0].iconPath` | ✓ |
| `home-active.png` | 210 B | `tabBar.list[0].selectedIconPath` | ✓ |
| `cart.png` | 186 B | `tabBar.list[1].iconPath` | ✓ |
| `cart-active.png` | 198 B | `tabBar.list[1].selectedIconPath` | ✓ |
| `report.png` | 166 B | `tabBar.list[2].iconPath` | ✓ |
| `report-active.png` | 187 B | `tabBar.list[2].selectedIconPath` | ✓ |
| `bell.png` | 292 B | `tabBar.list[3].iconPath` | ✓ |
| `bell-active.png` | 295 B | `tabBar.list[3].selectedIconPath` | ✓ |
| `login-logo.jpg` | **83,376 B** | `pages/login/login.wxml:4`（`/assets/icons/login-logo.jpg`） | ⚠️ 偏重 |

- **孤儿文件：0**；**引用了但不存在的图标：0**。tabBar 8 个路径 100% 存在。
- tabBar 图标 166–295 B，远低于微信 40KB 上限（好），但体积极小，**像素分辨率疑似偏低**（微信建议 81×81px），高分屏可能发虚 —— 未读二进制，列为待确认。
- `login-logo.jpg` 是包内唯一图片资产（`assets/` 根目录无其他文件），81.4KB 对登录页单张 logo 偏重，前序审计已提（P2-82 建议压到 10KB 内），**至今未处理**。
- 路径风格不统一：logo 用绝对路径 `/assets/icons/login-logo.jpg`，`login.wxss:17` 只定义 `.login-logo` 类，未见图标类混用问题。

---

## 6. 19 个云函数 package.json 对照表

| # | 云函数 | wx-server-sdk | 额外依赖 |
|---|---|---|---|
| 1 | authService | `~2.6.3` | — |
| 2 | confirmSupplierOrder | `~2.6.3` | — |
| 3 | createPurchaseOrder | `~2.6.3` | — |
| 4 | createReceipt | `~2.6.3` | — |
| 5 | dataService | `~2.6.3` | — |
| 6 | generateSummaryReport | `~2.6.3` | — |
| 7 | getProductPrices | `~2.6.3` | — |
| 8 | getProducts | `~2.6.3` | — |
| 9 | getPurchaseOrderDetail | `~2.6.3` | — |
| 10 | getPurchaseOrders | `~2.6.3` | — |
| 11 | getReceipts | `~2.6.3` | — |
| 12 | getReportDetail | `~2.6.3` | — |
| 13 | getReportFileUrl | `~2.6.3` | — |
| 14 | getReports | `~2.6.3` | — |
| 15 | getSupplierOrders | `~2.6.3` | — |
| 16 | getSupplierReceipts | `~2.6.3` | — |
| 17 | getSuppliers | `~2.6.3` | — |
| 18 | importProducts | `~2.6.3` | **`xlsx: ^0.18.5`** |
| 19 | updateProductPrice | `~2.6.3` | — |

- 19/19 均有 `package.json`，`wx-server-sdk` 版本 100% 统一（`~2.6.3`），无残留旧版/不同大版本。
- 唯一额外依赖集中在 `importProducts`（Excel 导入），职责单一，未扩散。
- 无 `devDependencies`、无 `scripts` —— 云函数是纯入口，合理。

**三个依赖风险：**

1. **`xlsx@0.18.5`（高）** —— 这是 SheetJS 在 npm 上的**最后一个**版本（2022 年后官方仓库迁移到 cdn.sheetjs.com，npm 上的 xlsx 停更）；0.18.5 已知存在多个公开漏洞（含 ReDoS / 原型污染类），而该函数**解析用户上传的 Excel 文件**，正好是攻击面。叠加包体积（xlsx 约 8–9MB）会显著放大该云函数的部署包与冷启动时间。建议：钉死可信来源 + 限制导入行数/单元格上限 + 评估换用只读轻量解析。
2. **`~2.6.3` 波浪号漂移（低）** —— 允许 2.6.x 补丁版本在重新部署时静默升级；19 个函数未见到 lockfile（待确认）。云函数部署时会重新 `npm install`，版本可复现性弱。
3. **19 份 `package.json` 内容几乎逐字相同（低，可下沉）** —— 可用根级模板 + 构建脚本生成，避免某天改了 17 个漏 2 个。

---

## 7. `utils/meta.js` 枚举一致性

### 7.1 定义的枚举（`meta.js:1-67`）

| 表 | 行数 | 值数 | 说明 |
|---|---|---|---|
| `statusMap` | 1-20 | 18 | **混装 4 个领域**：订单（draft/submitted/pending_approval/approved/rejected/received/receipt_abnormal/partial_received/to_receive/cancelled）、收货单（completed）、消息（pending/processing/resolved/closed/generated/confirmed）、供应商确认（confirmed） |
| `supplierConfirmMap` | 23-29 | 5 | pending/confirmed/shipped/done/cancelled |
| `reportTypeMap` | 32-41 | 8 | label + iconClass + color |
| `categoryIconMap` | 49-53 | 12 | emoji → 图标 base |

导出 7 个成员（`meta.js:67`），含 3 个 `getStatusInfo` / `getReportTypeInfo` / `getSupplierConfirmInfo` 兜底函数与 `getCategoryIconBase`。

### 7.2 抽查结果

| 抽查项 | 结论 | 严重度 |
|---|---|---|
| `pending_approval`（meta.js:4）/ `report_generated`（meta.js:7） | **死状态**：全项目无任何写入点，但被 8 处读取接受（`createReceipt:228,392`、`dataService:842,1295,1346`、`authService:642`、`updateProductPrice:43`、`confirmSupplierOrder:13`、`getPurchaseOrders:74`）；前端 `approval-list` 仍在客户端筛 `orderStatus === 'pending_approval'`。字典保留 2 个永不可达的值，会让读字典的人误以为存在「审批中」状态 | 中 |
| `receipt_abnormal`（meta.js:9） | 字典有；但收货单自身的 `receipt_status` 用的是 `abnormal`（无 `receipt_` 前缀），`getStatusInfo('abnormal')` 会走兜底返回英文原值。两套命名不对应 | 中 |
| `completed`（meta.js:11） | 属收货单域，却被混进订单状态白名单（`getSupplierOrders` 的 DONE 集），跨域误用 | 低 |
| `meta.js` 在 `cloudfunctions/` 下被引用次数 | **0 次**：状态白名单数组被复制 6 份以上。可收货集 `['approved','report_generated','partial_received','to_receive']` 独立硬编码于 `createReceipt:228,392`、`dataService:842`、`getPurchaseOrders:74`、`receive-list:46`、`purchase-list:111`、`purchase-detail:71,83` | 中高 |

**核心结论**：`meta.js` 只是**前端展示层字典**，并非单一事实来源。任何状态机改动必须同时改「前端字典 + 后端 ≥6 处白名单 + 前端 ≥3 处筛选」，这是本仓库状态类 bug 的结构性来源（前序审计已 4 次独立命中 `receipt_abnormal` 死角）。

---

## 8. 可下沉的重复代码

1. **状态白名单常量**（收益最大）：把「可收货 / 可作废 / 可发货 / 在途 / 完结」等集合下沉为命名常量，前端放 `utils/meta.js`，云函数侧复制一份 `shared/meta.js`（云函数无法直接 require 小程序端文件，需拷贝），杜绝 6+ 处复制漂移。
2. **`statusMap` 按域拆分**：`orderStatusMap` / `receiptStatusMap` / `messageStatusMap`，消除 `completed`、`confirmed`、`pending`、`cancelled` 的跨域歧义。
3. **`.card` 与 `.list-item`** 合并（仅 `margin-bottom` 差 4rpx，用变量区分即可）。
4. **`.tag-primary` / `.tag-info` 与 `--color-primary` / `--color-info`** 去重（4 处）。
5. **图标色板单一来源**：`build-icons.js` 的 `COLORS` 应从 `app.wxss` 变量派生（或反过来生成 JS 常量），消除 S5 双源。
6. **间距 / 字号阶梯令牌化**：补 `--space-xs/sm/md/lg` 与 `--fs-xs/sm/base/lg/xl`，替换 4.3-S4 的散落硬编码。
7. **云函数 `package.json` 模板化**（第 6 节第 3 点）。
8. **状态字典 → 校验**：加一个轻量脚本，把 `meta.js` 的值与后端白名单做交叉检查（当前 0 自动化保障）。

---

## 9. 风险清单

| # | 严重度 | 问题 | 证据 |
|---|---|---|---|
| R1 | **高** | `importProducts` 依赖 `xlsx@0.18.5`（npm 上已停更的最后版本，已知漏洞），且该函数解析用户上传的 Excel；同时约 8–9MB 体积拖累部署包与冷启动 | `cloudfunctions/importProducts/package.json:8` |
| R2 | **中** | 枚举双写：`meta.js` 在后端引用 0 次，状态白名单硬编码 ≥6 处（前端 3 处），状态机改动极易漏改 | `utils/meta.js:1-20`；见 §7.2 |
| R3 | **中** | 2 个死状态（`pending_approval` / `report_generated`）留在字典与 8 处后端白名单中，且前端仍在按死状态筛选 | `utils/meta.js:4,7` |
| R4 | **中** | 图标色板双源，`build-icons.js` 6 色不在 `app.wxss` 变量内，脚本注释自称「与 app.wxss 一致」实则不一致 | `build-icons.js:9-23` vs `app.wxss:6-13` |
| R5 | **中** | 无间距/字号令牌，硬编码遍布全局样式 | `app.wxss:44,80,89,95,138,179,193,204,288-300` |
| R6 | **中** | `__usePrivacyCheck__: true` 已开，但未见隐私链路闭环（无 `permission` 配置，凭证上传依赖 `chooseImage` 类隐私接口）；若 mp 后台未配隐私指引，上传类接口可能直接失败 | `app.json:73` |
| R7 | **中** | 缺白名单式 `.gitignore`：无 `.env` / `*.key` / `*.pem` / `*.p12` 规则；历史上确实发生过口令入库（现靠 `_tmp_test/` 兜底）。建议改为白名单 ignore + 预提交扫描 | `.gitignore:1-15` |
| R8 | **中** | `receipt_status`（`abnormal`）与 `order_status`（`receipt_abnormal`）两套命名不对应，字典缺 `abnormal`，走兜底会渲染英文原值 | `utils/meta.js:1-20` |
| R9 | **低** | `login-logo.jpg` 81.4KB（包内唯一图片），前序审计建议压到 10KB 内，未处理；建议改 PNG/webp 或压缩 | `assets/icons/login-logo.jpg`；`pages/login/login.wxml:4` |
| R10 | **低** | tabBar 图标 166–295 B，分辨率疑似低于建议的 81×81px，高分屏可能发虚（未读二进制，待确认） | `assets/icons/*.png` |
| R11 | **低** | 单包 26 页无分包，`bigPackageSizeSupport: false`；当前资产仅 ~85KB 尚安全，但增长后需规划分包 | `app.json:2-29`、`project.private.config.json:20` |
| R12 | **低** | `.card`/`.list-item` 同构、`.tag-primary`/`.tag-info` 完全重复、`--color-info` 与 `--color-primary` 同值 | `app.wxss:77-83,101-104,116-119,12` |
| R13 | **低** | `project.private.config.json` 未被 `.gitignore` 忽略（微信官方建议不入库，属机器级偏好） | `.gitignore:1-15` |
| R14 | **低** | 无 `.gitattributes`：本次 diff 已出现 `LF will be replaced by CRLF` 警告，换行不统一 | git diff 警告 |
| R15 | **低** | 未提交改动 `cloudfunctionRoot` + `采购流程图.png` 排除：**两处均正确且必要，无信息泄露，建议尽快提交**（不提交则他人 clone 后 DevTools 找不到云函数根目录） | `git diff -- project.config.json` |
| R16 | **低** | `styles/icons.wxss` 与 `scripts/icons-preview.html` 是生成物却被 git 跟踪，无 CI/脚本校验，存在漂移风险（当前已同步） | `build-icons.js:205-226` |

---

## 10. 待确认清单

1. **tabBar 图标实际像素分辨率**（未读二进制，仅由 166–295 B 推测）—— R10。
2. **AppID 与云环境 ID 的存放位置**：`project.config.json` 与 `project.private.config.json` 均无 `appid`，需在 `app.js` 里确认 `wx.cloud.init({ env })`（`app.js` 不在本次范围）。
3. **`__usePrivacyCheck__: true` 的实际生效状态**：mp 后台是否已配《用户隐私保护指引》，以及上传凭证走的是 `chooseImage` 还是 `chooseMedia`（影响隐私风险的定级）。
4. **是否存在 lockfile**：`cloudfunctions/*/package-lock.json` 未在本次 Grep 命中中出现，需确认以判断 `~2.6.3` 漂移的实际影响面。
5. **`xlsx` 的实际解析边界**：是否限制导入行数、单元格数量、文件类型；是否做共享公式/外部链接防护（影响 R1 定级）。
6. **页面 wxss 未逐个阅读**：`.card`/`.list-item` 之外的重复样式、`safe-area` 适配情况未能覆盖。
7. **`docs/` 与 `.claude/` 是否应进 `packOptions.ignore`**：`.md` 后缀规则已挡住文档，但 `docs/` 内若有非 md 文件仍会进包（本次未见）。
8. **`sitemap.json` 全量 `disallow`**（`sitemap.json:3-8`）是否符合业务预期：所有页面禁止微信索引，对该类内部采购工具属正确选择，但若将来要开放搜索入口需改。
