# 函数级勘探 · 2026-10-09 · 总索引

> 基线：`backup` @ `73b0730`（2026-10-05，audit）
> 方式：8 个子代理并行勘探 + 主代理独立取证，全程只读业务代码，唯一写入为 `docs/exploration/funclevel-20261009/`。
> 未修改任何业务代码，未 commit / push / 切分支。
> 与旧批次的区别：`docs/exploration/` 下 33 份报告是**缺陷审计**；本批是**函数级调用契约清单**——每个函数的签名、返回形状、写入字段、调用点、可见范围。

---

## 一、覆盖核对

仓库实测 **170 文件 / 16,295 行**（明细 `_file-manifest.csv`）。

| 域 | 行数 | 覆盖 | 报告 |
|---|---|---|---|
| cloudfunctions | 5,950 | **100%** | A1(684) A2a/A2b(1,692) A3(1,727) A4(1,615) |
| pages | 8,582 | **26/26 页** | A1(3页) A5(3) A6(7) A7(8) A8(6) |
| utils | 492 | **100%** | A1 |
| 外壳 app.* | 530 | **100%** | A1 |
| scripts + styles | 428 | 生成物，只读生成器 | A1 |
| seed-data | 290 | 数据契约，见旧批次 | — |

`styles/icons.wxss` 49KB 仅 109 行、`scripts/icons-preview.html` 同理 → 确认是 `scripts/build-icons.js` 的压缩生成物，未通读。

**交付物：12 个文件，约 680 KB，约 7,100 行**（8 份函数级报告合计 6,787 行）。

---

## 二、主代理独立取证（可信度最高，逐条可复现）

以下结论**不依赖任何子代理**，均由主代理直接 Read/Grep 得出。

### P0-1 `importProducts:86-94` 越权读取 + 销毁云文件
```js
const fileID = event.fileID                                    // 客户端原样传入
if (!fileID) return { code: -1, msg: '缺少文件' }
const res = await cloud.downloadFile({ fileID })              // :92 下载任意文件
try { await cloud.deleteFile({ fileList: [fileID] }) } ...    // :94 立刻删掉
```
**零前缀校验。** 门禁 `MANAGEMENT_ROLES = ['super_admin','purchaser']`（`:8`）。
`73b0730` 这个提交**恰好**是给 `createReceipt:232`、`dataService:1568/1612` 加 `receipts/{单号}/`、`vouchers/{单号}/` 前缀校验的——**同一类校验漏了 importProducts。**
读取与删除**耦合**：传入别店 fileID 即可**读取并永久销毁**其付款凭证/收货照片/报表 CSV，而凭证正是核销审计证据。销毁无日志，失败才 `console.error`。
*限定*：攻击者需持有效内部会话，属内部滥用。

附带：`:94` 删除在 `:95` 解析**之前**——解析失败时用户已上传的导入文件已被删，只提示"确认 .xlsx 格式"，必须重传。

### P0-2 报表下载鉴权形同虚设（两条解析路径并存）
`getReports:98` 返回**原始集合文档**：`return { code: 0, data: res.data, ... }`，而 `report_file` 文档含 `file_url`（云 fileID，14 处写入见 `createPurchaseOrder:434/483`、`dataService:450/491/1034/1235/1262/1295/1322`、`createReceipt:625/658/707/742`、`generateSummaryReport:257`）。**该字段是被整包透传，不是被"引用"——所以 grep `file_url` 在 getReports 里零命中，这是假阴性。**

| 路径 | 位置 | 鉴权 |
|---|---|---|
| 授权 | `getReportFileUrl:46-49` | 查库 + 角色/scope |
| **绕过** | `utils/cloud.js:255 getFileUrls` | **无，客户端直调 `wx.cloud.getTempFileURL`** |

绕过路径**是活的**：`purchase-detail.js:117`、`receive-list.js:99` 两处真实调用。
fileID 路径**可预测**（`reports/{scope}/{date}/{type}-{scope名}-{date}-{单号}-v{版本}.csv`），不是秘密。
→ `getReportFileUrl` 不是报表下载的关键防线；真正边界**完全落在** `getReports`/`getReportDetail` 的 `where` 上，而 A4 恰好查出这两处 `where` 有缺口。
*限定*：客户端 `getTempFileURL` 服务端是否还有 ACL 属 SDK 语义，无法从源码确认。**定性为"授权设计形同虚设 + 边界单点依赖"，不说"任意登录用户可下载任意报表"。**

### P1-1 `missing_reports` 补救路径全 UI 不可达
| 动作 | 位置 |
|---|---|
| 置 `true` | `createPurchaseOrder:82`、`createReceipt:757/761` |
| 清 `false` | `dataService:1090`（`regenerateOrderReports` 内）、`:1339`（`regenerateReceiptReports` 内） |

1. `createPurchaseOrder:88-100` 给超管发消息：`content: '…订货报表生成失败，请管理员补生成。'`，`type:'abnormal'`
2. **唯一能补订单侧报表的 `regenerateOrderReports`（`dataService:1058`）前端调用点为 0**（31 个前端 js 带引号精确匹配 0 命中）
3. `regenerateReceiptReports` 只重建收货侧 ③④⑤⑥（`:1097-1098` 注释），**不含下单侧**
4. 该消息 `type:'abnormal'`，而 `message.js:57-59` 对 `type==='abnormal'` 一律跳 `/pages/abnormal-list/` → **跳到错误页面**
5. `MSG_ORDER_REPORT_MISSING` 前缀在 `pages/` 下 0 命中，无特殊处理

→ **系统通知管理员执行一件事，没有任何页面能执行它，还把他送到不相关的页面。** 33 份旧报告均未记录此闭环缺口。

### P1-2 取消申请是死信，逃生路线本身也被锁
```
dataService:1454  requestCancel 允许：['submitted','approved','report_generated','partial_received']
dataService:1364  cancelOrder   拒绝：['partial_received','received','receipt_abnormal']
                     → "该订单已有收货记录，不能作废，请走异常处理流程"
```
`partial_received` 订单**能申请取消**、管理员**无法批准**。而拒绝语指引的"异常处理流程"对应的 `receipt_abnormal` 状态**本身就是死锁**（见 P1-3）——**建议的逃生路线也被锁着。**

配套：
- `cancel_requested` 全仓**只写不清**（Grep 仅 `:1464` 读、`:1467` 写、`utils/cloud.js:162` 展示）→ 系统**没有实现"驳回取消申请"**，只能改库
- 门禁**装反**：`requestCancel:1458` **有**门店归属校验，而做销毁动作的 `cancelOrder:1356-1360` **无**（仅 `where({purchase_order_id})`）。因门禁是 `GLOBAL_ROLES`（跨店角色），定性为口径不一致而非越权

### P1-3 `receipt_abnormal` 永久死锁
`createReceipt:419` 注释："receipt_abnormal 状态**允许继续补收**"
`createReceipt:425` 白名单：`['approved','report_generated','partial_received']` —— **不含它**
`:420` 只拦 `received`，故 `:425` 抛 `ORDER_NOT_RECEIVABLE`。
→ 订单既收不齐、（旧报告）也无法作废，**永久死角**。旧审计 §八已记录，**至今未修**。

### P1-4 账号锁死链（两步可达成）
| 函数 | 自操作守卫 | 末位超管守卫 |
|---|---|---|
| `resetPassword:446` | ✅ | — |
| `setUserStatus:479` | ✅ | ⚠️ 有，但仅当 `username==='admin'`（`:484`） |
| **`updateUser`** | ❌ **无** | ❌ **无** |

`setUserStatus:484` 的末位超管检查包在 `if (target.username === 'admin')` 内，**用户名非 admin 整段跳过**（与旧报告 P0-5 一致，未修）。
但 `updateUser:417` 有钉子：`const effectiveRole = target.username === 'admin' ? 'super_admin' : input.role` —— **admin 账号角色被钉死**（`:419` 连用户名也钉死）。

→ **单步锁不死**，两步可以：①停用 `admin`（`:487` 数出另一名在岗超管，放行）②该超管对自己调 `updateUser` 改 `role:'chef'`（`:417` 不钉）→ **在岗超管清零，管理入口永久锁死。**
附带：`updateUser` 只在改密码时清会话（`:433-435`），只改角色**不清** → 降级用户带旧会话持有新角色。

### 已排除项（防重报）
- `pages/message/message.js` 读 `m.id`/`m.bizId`/`m.time` **不是** snake_case 契约错位 —— `dataService:638 publicMessage()` 已映射
- `getReports:43` 从 event 解构的 `role`/`storeId` 是**死参数**，`:50-66`/`:79-86` 全用会话值，**客户端传了没用**
- `confirmSupplierOrder` **已闭合**：`:55` supplierId 取会话、`:65-69` 订单商品归属校验、`:78-80` CAS + `:81-83` 判 `updated===0`
- `SUBSCRIBE_TEMPLATE_ID = ''`（`dataService:251`）是**有注释的功能开关**，不是缺陷（注释明写站内通知为兜底）

---

## 三、★ 校准记录（本批最重要的产出）

勘探过程中 5 次"查完发现自己/别人没说对"，全部留下：

| # | 主张 | 结论 | 如何查出 |
|---|---|---|---|
| 1 | 旧审计 **X1**：嵌套 -401 致会话过期不跳登录，"四份报告独立命中"，列为头号系统性缺陷 | **整条撤回** | 嵌套产出点全仓仅 6 处，但 **33 处消费点全是 `if (x.error) return x.error`**，返回内层对象即扁平 `{code,msg}`；`Grep 'return auth\b'`（排除 `.error`）**零命中** |
| 2 | 订阅消息整体不可达，定性"死代码" | **事实对、定级过重** | 注释 `:249-250` 明写"申请通过后填入 TEMPLATE_ID 即可下发"，是功能开关 |
| 3 | `purchase-create.js:403-412` 会重复建单 | **主张不成立** | 那几行正是**防重复**机制，含 P1-14 注释说明分流逻辑 |
| 4 | "唯一超管可把自己改成 chef，前后端均无拦截" | **需修正** | `updateUser:417` 对 admin 有钉死；须两步才能锁死 |
| 5 | 自己 grep `file_url` 发现 getReports 不返回 → 险些得出"不可利用" | **假阴性** | 读文件才发现是 `res.data` 整包透传 |
| 6 | A8 根因"三个跳转目标页全无 `onLoad`" | **结论对、机制错一半** | `supplier-orders.js:27` **有** onLoad 且消费 `options`。三个目标页无法深链的成因各不相同：两页无 onLoad，第三页是 `message.js:54` 跳转时**根本没传参** |

第 5 条的方法论价值最高：**grep 抓不住"字段没被点名、但被整包带出去"的情况**，只能靠读返回值形状。

另有两个子代理在过程中**自行撤回**了假结论（A5 的 json 文件"错换"、A2b 的 `settleReceipt` 绕过异常状态机），均未写入报告。

---

## 四、子代理报告要点（未逐条亲验，行号可直接核对）

### 系统性主题（跨域复现，修一处收益最大）

1. **`limit` 无分页 → 数据静默消失**（A4 最高 3 项）
   - `getSupplierOrders:73-76` 明细硬 `limit(1000)` 无分页无 orderBy → 超量整单消失，`total`/`statusCounts` 同源错误
   - `getProducts:56-59` `limit(200)` 在 keyword 内存过滤**之前** → 超 200 条商品永远搜不到
   - `getSuppliers:67` `limit(100)` 无 total 无分页
2. **无角色门禁**（A4）：`getProducts`、`getSuppliers` —— 后者可遍历全量供应商档案含 `contact_name`/`contact_phone`/`address`
3. **排序键用错**（A4，旧报告 X3 已记仍未修）：`getSupplierOrders:117` 用 `String(Date).localeCompare`，`created_at` 是 `db.serverDate()`，`String()` 非 ISO → **按星期名排序，跨月错乱**
4. **失败伪装成加载中/空态**（A5、A7 各一处实证，同 INDEX 旧报告）：`purchase-detail.js:27-30` toast 后 return 不置失败态 → 渲染「商品清单 (0)」；`report-detail.js:77-79` 同理停在「加载中」
5. **报表导出链断裂**（A7）：`report-detail.js:110-115` `wx.openDocument` **未传 `fileType`**，产物若 `.csv` 则打开必失败、转发另存一并失效；全程无 loading、无防连点
6. **`getSessionUser` 19 份完全独立的副本**（A1，43 处出现）

7. **★ 消息跳转闭环全断**（A8 最重要发现，根因已由主代理复核后修正）
   9 个消息生产者中 **6 个**点击后达不到能处理该事项的位置。
   - `createReceipt:767-769` `MSG_REPORT_MISSING` 写 `type:'abnormal'`，而 `message.js:57-59` 对 `type==='abnormal'` 一律跳 `/pages/abnormal-list/` → 与 P1-1 的 `MSG_ORDER_REPORT_MISSING` **同款落错域**
   - 最讽刺的一条：该消息 content 写"请管理员在**收货记录**中补生成"，而补生成按钮只在 `receive-list.wxml:50` —— **文案指路 A，路由送 B**
   - `dataService:421`「订单改量，供货商需重新确认」**未传 bizId** → 落到 `message.js:70` `showToast('已读')`，点了无任何反应
   - `dataService:331`「您有新的采购订单」供应商消息 `store_id:''` + 无 bizId → `getMessages:662-671` 对非 supplier 不加 scope 过滤，**店长/采购员也会看到**
   - 根因（复核后修正）：`receive-list`、`abnormal-list` **无 onLoad**（Grep 实证）；`supplier-orders.js:27` 有 onLoad 但只消费 `options.status`，而 `message.js:54` 跳它时**根本没传参**
   → 与 P1-1 同源：**系统发出可操作通知，但 App 内没有可操作的落点**

8. **补偿逻辑依赖错误假设**（A8）：`receive-verify.js:23 recoverCommittedReceipt` 取 `receipts[0]`，而 `getPurchaseOrderDetail:120-123` 查 receipt **无 orderBy** → 分批场景下网络中断会把**历史最早批次**的异常状态报给本次提交，可能在本批真有异常时误报"已保存"并直接返回；`recovered:true` 前端从不消费。
   另：`uploadReceiptPhotos` 用 `Promise.all` 逐张上传，第 5/9 张失败时前 4 张已落云存储但永不引用，**无清理无提示**。

### 幂等与并发
- `regenerateReceiptReports` **无 `_RG` 去重守卫**（对比 `settleReceipt` 有 `_S`）→ 重复调用追加多条 `report_id` 相同、`file_version` 递增、状态均 `generated`，与 `:1098` 自称"天然幂等"**矛盾**
- `confirmSupplierOrder` 发货**无幂等** → 重复点击重复写站内消息（CAS 不拦，因 `ship` 不改 `order_status`）
- `cancelOrder:1407` 事务内主单更新是**无条件 `doc(_id).update()`**，不带状态条件，与 `:1384` 复查间存在窗口（依赖事务隔离级别，未验证）

### 前后端契约
- `auditOrder` 对 `event.items` **不校验覆盖度**（A2a）→ 漏传行静默按原量批准，且 `qtyChanged` 漏判为 false，报表不重算
- `getOrderStats:883` `receivableStatuses` **不含 `receipt_abnormal`** → 该状态订单在首页既不进待收货也不进已完成，凭空消失
- `repriceReceipt:1148` 绕过异常状态机把 pending 直接改 resolved，只写 `handled_by` 不写 `resolved_by`/`resolved_at`
- `saveProduct` **后端完全无重名校验**；`saveSupplier` 重名查重 `.limit(100)` 漏检，而 `createStore` 已修未同步
- `updatedBy` 被后端忽略 → 调价审计记 ID 而非姓名
- `setStoreStatus` 停用带账号门店 → 静默锁死该店全部 chef 登录（旧 P0-4 同源）

### 页面级 WXML↔JS 双向对账（合计）
| 方向 | A 点了没反应 | B 死代码 | C 键无来源 | D 写而不读 |
|---|---|---|---|---|
| A5 采购 3 页 | **0** | 0 | 2 | 7 |
| A6 管理 7 页 | **0** | 2 | 3 | 0 |
| A7 报表+供应商 8 页 | **0** | 1 | 5 | 13 |

**A 类全 0**（累计 141 处绑定全命中）——没有"点了没反应"，这是干净的正向结论。
最刺眼的 C 类：`purchase-detail.wxml:3` 首帧 `status-bg-undefined` 状态卡白字；`product-manage.wxml:84/91/115` 三个 picker 无 `value`，编辑态显示值与高亮背离；`user-manage.wxml:93` 门店 picker 缺停用门店 → `storeIndex=0` 而 `defaultStoreId` 仍指停用门店，**保存能通过 `:188` 校验**。
最刺眼的 B 类：`index.js:160-161` `goStatPage` 的 `abnormal` 分支**不可达**（`stats` 取值域不含它）→ 首页根本没有入口能跳到异常列表。
最刺眼的 D 类：`supplier-orders.js:95` `statusType` 算出色标却从未映射任何 CSS 类 → 订单状态整列退化为灰色。

---

## 五、未验证项汇总（需运行时/控制台确认）

- 客户端 `wx.cloud.getTempFileURL` 服务端是否还有 ACL（决定 P0-2 的实际危害面）
- `cloudPathOfFileId` 正则不 normalize → `receipts/PO_A/../../vouchers/PO_B/x.jpg` 能否穿过（需确认云存储是否 normalize）
- `transaction.rollback({code,msg})` 的 `errMsg` 是否原样携带对象内容（`cancelOrder:1418-1424` 子串匹配依赖它）
- CloudBase 事务隔离级别是否消除 `cancelOrder:1407` 的 TOCTOU
- `remindAudit:1520` 的 `$or` 字面量是否被 TCB 识别（全仓其余复合条件均用 `_.or`）
- `uploadFile` 对 `..` 路径的行为、fileID 真实格式
- 各 `limit(100)/limit(1000)` 的实际截断量级
- `wx.openDocument` 未传 `fileType` 时 `.csv` 的真机行为

---

## 六、交付物

| 文件 | 内容 |
|---|---|
| `INDEX.md` | 本文件 |
| `_file-manifest.csv` | 170 文件行数基线（覆盖核对用） |
| `00-crosscutting-verified.md` | 主代理独立取证的全量证据链 |
| `A1-framework-identity.md` | 应用外壳 + utils + authService + 身份页（810 行） |
| `A2a-dataservice-upper.md` | dataService 1–637 行，21 函数（541 行） |
| `A2b-dataservice-lower.md` | dataService 638–1692 行，17 函数（537 行） |
| `A3-write-domain.md` | createReceipt/createPurchaseOrder/generateSummaryReport/confirmSupplierOrder（571 行） |
| `A4-read-report-domain.md` | 13 个读取与报表云函数（446 行） |
| `A5-pages-purchase.md` | 下单/详情/列表 3 页（748 行） |
| `A6-pages-admin.md` | 首页+账号/商品/价格/供应商/门店 7 页（1,112 行） |
| `A7-pages-report-supplier.md` | 报表 3 页 + 供应商端 5 页（1,147 行） |
| `A8-pages-receipt-approval.md` | 收货/审批/异常/消息 6 页（875 行，含消息跳转闭环 6 处缺口） |
