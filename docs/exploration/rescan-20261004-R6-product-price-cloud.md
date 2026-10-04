# R6 重扫：商品 / 价格 / 供应商 / 导入 云函数（2026-10-04）

> **范围**：`cloudfunctions/` 下 `getProducts` / `getProductPrices` / `updateProductPrice` / `getSuppliers` / `importProducts` 5 个云函数全读；交叉参照 `createPurchaseOrder` / `createReceipt` / `dataService` / `generateSummaryReport`、`pages/product-manage` / `price-manage` / `supplier-manage` / `supplier-prices` / `purchase-create`、`utils/cloud.js`、`seed-data/`（product / category / supplier / supplier_product_price / product-import-template.md）。
> **方法**：全文件顺序读，不抽样；每条结论带 `文件:行号`；注释/README 一律不作为事实来源，模板 md 仅作为「文档声称」与代码行为比对。
> **前置文档**：full-scan-04（654 行）/ 05（456 行）/ 08（702 行）/ 02（428 行）、controller-horizontal-scan-20261004（602 行），共 2842 行全部通读；另参照 R3 / R5 / R8。旧文档结论的逐条复核见 §10，其中 3 项判定旧文档有误（见 §10.3）。
> **版本基线**：分支 `backup`，HEAD `5268379`。`importProducts/index.js` 修改时间 `Sep 30 14:25`，`package.json` 同日，晚于其余 4 个云函数（`Sep 29 20:00` 量级），符合 commit `ede7bcb` 新增特征。

## 0. 增量摘要

1. **🔴 P0｜空供应商商品收货时 0 价漏账且无追踪**（本轮最重要新增）。`createReceipt:366` 判定缺价异常要求 `item.supplierId` 为真，而 `createReceipt:350` 在 `supplierId` 为空时直接把 `priceSnapshot` 置 0。于是「有商品档案、无 `default_supplier_id`」的商品收货后：`payableFlag=false`、**不产生 `abnormal_record`、不进任何带价账单（④⑥）、无人收到提醒**；仅在 ③ 门店收货报表里留下一行「验收状态=正常 / 异常类型=空 / 是否可付款=否」的无理由记录，在 ⑦ 汇总里以金额 `0.00` 计入 `item_count`。而 `importProducts:164-168` 在供应商名称未填或未匹配时正是写入 `default_supplier_id: ''` 且**仍计入 inserted**。导入即产出一批必然漏账的商品。
2. **🔴 P0｜`createReceipt` 取价 `limit(100)` 截断产生假缺价**。`createReceipt:342-346` 按 20 个 `product_id` 分块查 `supplier_product_price`，但 where 条件**不含 `supplier_id`**，一个商品对多家供应商有多条当前价，20 个商品极易超过 100 行 → 被截断的组合在 `priceMap` 中缺失 → 落 0 价 → 被误标 `isMissingPrice` → 生成错误异常单并**从应付款账单中剔除真实应付金额**。`dataService:1055-1059` 的 `repriceReceipt` 同型。
3. **🔴 P0/P1｜供应商停用不阻断下单**（停用语义空洞）。`supplier-manage.js:99` 明确承诺「停用后下单不可再选择」，但 `createPurchaseOrder:250` 直接取 `product.default_supplier_id` 写库，**全程不查 supplier 状态**。停用供应商后其名下商品仍可下单、仍可收货、仍进供应商订货汇总报表。
4. **🟠 P1｜`getSuppliers` 的 `includeInactive` 守卫可被 `status` 参数绕过**。`getSuppliers:54` 只在 `includeInactive` 为真时拦非管理员，但 `getSuppliers:58` 允许直接传 `status`；chef 调 `getSuppliers({status:0})` 即可越权取回停用供应商全量档案（含手机号/地址）。`getProducts` 无此参数故不受影响。
5. **🟠 P1｜`importProducts` 无行数/体积上限、逐行串行 `add`、无事务**。`:99` 一次性 `sheet_to_json` 载入全部行，`:189-196` 每行一次 `db.add()`，`limit`/超时/内存均无配置（该目录**无 `config.json`**）。超时被杀后已写入行残留，前端只拿到失败提示，`errors` 数组无回滚。
6. **🟠 P1｜`importProducts` 返回值形状与其他 17 份业务副本不一致**（落实主控 md5 结论的功能性后果）。`:54,56` 用嵌套 `{error:{code,msg}}`，导致 `utils/cloud.js:68` 的 `result.code === -401` 永不命中 → **会话过期时点导入只弹「导入失败」，不跳登录**。同一嵌套形状同样存在于 `dataService:47-49`，波及该网关下约 20 个 action，范围大于主控已知。
7. **🟠 P1｜`getSuppliers:61` 正则注入**。`keyword` 未转义直接进 `db.RegExp({regexp: keyword})`，非法正则抛错被 catch 吞成通用「加载失败」，恶意输入可致 DoS；与 `getProducts:56-59` 的客户端字符串过滤形成不一致。
8. **🟠 P1｜`importProducts` 是仓库唯一无外层 `try/catch` 的业务云函数**。`:82-207` 的 `main` 直接 `await`，一旦 `getSessionUser`（`:25-50`）或 `:92` `downloadFile` 之外的任何一步抛错，错误以 promise reject 形式传到 `utils/cloud.js:72-74`，用户看到的是「CloudBase 服务连接失败」——**与真实原因完全无关，无法诊断**。对照组：`createPurchaseOrder:98`、`createReceipt:161`、`updateProductPrice:67`、`getProducts:40`、`getProductPrices:40`、`getSuppliers:40`、`dataService:1529` 全部有外层 try/catch。这是本轮新增的、旧文档未点出的可诊断性缺口。
9. **🟠 P1｜模板示例 100% 必然导入失败**。`product-import-template.md:20-23` 的示例行用二级分类「叶菜类」「禽类」，但 `seed-data/category.json` 的 12 个二级分类为蔬菜/肉类/海鲜水产/调料干货/粮油/酒水饮料/冻品/豆制品/纸品/餐具/清洁用品/包装材料——**两者都不存在**；且示例的「一级分类=蔬菜/肉禽」与一级分类编码 `kitchen`/`front`（名称「后厨/前厅」）也错位。`importProducts:146-147` 精确 `===` 匹配 → 任何照抄示例的行必然报「二级分类不存在」。这是**文档即坏文档**：新用户照着示例填，100% 失败。
10. **🟡 P2｜公式注入路径 B（Excel 导入侧）经 `cellText` 的 `trim()` 在源头被闭合**，但这是**隐式且脆弱的唯一防线**；路径 A（下单备注）在写入侧完全无校验，两条路径汇聚到**同一批报表**（8 种 report_type 全部经同一份 `csvField`）。结论见 §2。
11. **🟡 P2｜导入模板与实际行为 7 处不符**（§3 第 1 条为模板示例不可用（P1），第 7 条为「一级分类填了但不匹配→静默降级不报错」，`:148-152`），其中「最多显示前 10 条」写的是前端限制（`product-manage.js:145` 确实 `.slice(0,10)`）而服务端上限是 50（`importProducts:204`），且「同名同厂家会跳过」对**停用商品**也生效（判重不分 status）。
12. **🟡 P2｜`expiry_date` 与 `effective_date` 是死字段**。`updateProductPrice:124` 恒写 `expiry_date: null`，`getProductPrices`/`createReceipt`/`repriceReceipt` 均不读取 `expiry_date`，结算只看 `is_current`。价格永不自失效，seed 中 PRC001 的 `expiry_date:"2026-07-31"` 无任何代码语义。同族死字段还有 `currency`（`:122` 恒 `'CNY'`）与 `updated_by`（`:126` 只写不读）。
13. **🟡 P2｜`getProducts` 完全无角色白名单，supplier 也能拉全量商品**（`:41-45` 只判登录）。`getProductPrices` 有 `:48`/`:51` 双重门禁，`getSuppliers` 有 `:45` supplier 分支，`getProducts` 三兄弟里是唯一不设防的。影响面待评估：supplier 门户若不调此接口则无害，但「按角色收敛」的口径在本函数上缺了一格。
14. **🟡 P2｜`getProducts:50` `Number(categoryId)` 无校验**。非法字符串 → `NaN` 直接进 `where`（`:50` `where.category_level_2_id = Number(categoryId)`）。云数据库对 NaN 的 where 语义【待核实】，最坏情况是查询失败被 catch 吞成通用错误。对照 `getSuppliers:58` 有显式 `!== undefined && !== null && !== ''` 三重判空，两个函数的入参防御强度不一致。
15. **🟡 P2｜`supplier-manage.js:32` 联系人搜索架构上不可达**。前端搜 `contactName`（`:32`），但 `getSuppliers` 的 `keyword` 只作用于 `supplier_name`（`:60-62`），且前端拿到全量后再本地过滤 → **搜联系人永远搜不到**（除非命中供应商名的子串）。属前端承诺了后端不支持的能力。

## 1. 文件清单与全读确认

| 文件 | 行数 | 全读 |
|---|---|---|
| `cloudfunctions/importProducts/index.js` | 209（含末尾空行至 210） | ✅ |
| `cloudfunctions/importProducts/package.json` | 10 | ✅ |
| `cloudfunctions/getProducts/index.js` | 66 | ✅ |
| `cloudfunctions/getProductPrices/index.js` | 89 | ✅ |
| `cloudfunctions/updateProductPrice/index.js` | 138 | ✅ |
| `cloudfunctions/getSuppliers/index.js` | 96 | ✅ |
| `cloudfunctions/createPurchaseOrder/index.js` | 471 | ✅（交叉参照） |
| `cloudfunctions/createReceipt/index.js` | 752 | ✅（交叉参照） |
| `cloudfunctions/dataService/index.js` | 1559 | ✅（交叉参照） |
| `cloudfunctions/generateSummaryReport/index.js` | 270 | ✅（交叉参照） |
| `pages/product-manage/product-manage.js` | 250 | ✅ |
| `pages/price-manage/price-manage.js` | 228 | ✅ |
| `pages/supplier-manage/supplier-manage.js` | 121 | ✅ |
| `pages/supplier-prices/supplier-prices.js` | 42 | ✅ |
| `pages/purchase-create/purchase-create.js` | 432 | ✅ |
| `utils/cloud.js` | 282 | ✅ |
| `seed-data/product-import-template.md` | 32 | ✅ |
| `seed-data/product.json` | 12 条 | ✅ |
| `seed-data/category.json` | 12 条 | ✅ |
| `seed-data/supplier.json` | 6 条 | ✅ |
| `seed-data/supplier_product_price.json` | 12 条 | ✅ |

全读文件数 **21**，合计约 **3850 行**。

`importProducts/package.json` 多出的那一行确认是 `"xlsx": "^0.18.5"`（`package.json:8`），描述亦写明「SheetJS 解析」（`:4`）。其余 4 个云函数仅依赖 `wx-server-sdk ~2.6.3`。**`xlsx` 是本仓库唯一引入的第三方解析依赖。**

## 2. importProducts Excel 解析安全（含公式注入路径 B）

### 2.1 依赖与解析链路

- 依赖：`xlsx@^0.18.5`（SheetJS），`importProducts/index.js:3`。非 `csv-parse`。
- 链路：`cloud.downloadFile({fileID})` → `XLSX.read(res.fileContent, {type:'buffer'})` → 只取 `SheetNames[0]` → `XLSX.utils.sheet_to_json(sheet, {header:1, defval:''})`（`:92-99`）。
- **文件来源是 `product-manage.js:136-140` 的 `wx.cloud.uploadFile` 上传到 `imports/products/` 的文件**，即用户上传即执行，无服务端文件类型二次校验（前端 `.xlsx` 后缀校验在 `product-manage.js:133`，可绕过）。
- **`.xls` / `.csv` 上传不会被拒**：`XLSX.read` 对非 xlsx buffer 会抛错，落在 `:94-96` 的通用提示，属预期降级。但**宏（.xlsm）在 SheetJS 中以纯数据解析、不执行 VBA**，属安全。
- **无行数上限、无文件体积上限、无单列长度上限**（见 §2.4）。
- 权限：`MANAGEMENT_ROLES = ['super_admin','purchaser']`（`:8`），与 `dataService.saveProduct` 同权（`dataService:9`），**店长/厨师无法导入**，权限口径一致。
- **导入只能写 `product`，完全不写 `supplier_product_price`**（全函数只有 `:191` 一处 `db.collection('product').add`）→ **导入无法绕过价格维护流程改价**。这是正确的边界，但代价是导入商品默认无价（见 §6）。

### 2.2 公式注入路径 B 结论

**解析出的单元格值不做任何 `^[=+\-@]` 拦截**（`cellText` 在 `:61-64` 只有 `String(v).trim()`）。但落库字段为 `product_name` / `category_name` / `category_level_1` / `unit` / `spec` / `manufacturer_name`（`:171-184`），这些字段进入报表的路径是：

| 落库字段 | 下单快照 | 收货快照 | 最终报表 |
|---|---|---|---|
| `product_name` | `createPurchaseOrder:247` → `:330` `product_name_snapshot` | `createReceipt:284` → `:453` `product_name` | ①②③④⑤⑥（`createPurchaseOrder:359/:407`、`createReceipt:561/:593/:642/:676`、`dataService:425/:466/:963/:1156/:1182/:1216/:1242`）+ ⑦汇总（`generateSummaryReport:198`） |
| `category_name`/`category_level_1` | `:248` → `:331` `category_snapshot` | — | ①② + ⑦（`generateSummaryReport:130/:134/:200` 实时读 `product`） |
| `unit` | `:249` → `:332` `unit_snapshot` | `createReceipt:288` → `:457` | ①②③④⑤⑥ + ⑦ |
| `spec` / `manufacturer_name` | 未写入快照 | 未写入快照 | **不进任何报表**（仅 `product-manage` 展示） |

**两条路径汇入同一批报表：是。** 全仓库 CSV 生成点经穷举只有 4 处（`csvField` 共 62 处引用，分布于 `createPurchaseOrder` / `createReceipt` / `dataService` / `generateSummaryReport`，`getReportDetail`/`getReports` 不生成 CSV），共 8 种 `report_type`：`store_order_report`、`supplier_order_report`、`store_receipt_report`、`store_receipt_price_report`、`supplier_receipt_report`、`supplier_receipt_price_report`、`store_daily_summary_report`、`store_monthly_summary_report`。路径 A 与路径 B 的数据都经这同一份 `csvField`。

**路径 B 的实际可利用性：低（被源头 trim 闭合，但是隐式防线）。** `csvField` 的正则 `^[=+\-@]`（如 `createPurchaseOrder:45`、`generateSummaryReport:44`）不拦 `\t\r\n`，理论上 `"\t=HYPERLINK(...)"` 可绕过。但 `importProducts` 的 `cellText` 在落库前已执行 `String(v).trim()`（`:63`），JS `trim()` 会剥离首尾 `\t \n \r \v \f` 及 Unicode Zs，因此来自 Excel 的**前导空白 + 公式符组合在入库前就被破坏**。中置换行不构成公式触发（Excel 只认单元格首个有效字符）。故路径 B 在当前实现下不可利用。

**风险定性**：
- 防线是 `trim()` 的**副作用**而非显式意图，代码中无任何注释声明其为安全边界（对比 `csvField` 处有明确注释）。一旦有人把 `cellText` 改成不 trim（例如为保留商品名中的全角空格），路径 B 立即变成 P0。
- **路径 A 没有这道源头防线**：`createPurchaseOrder:336` `remark: item.remark || ''` 与 `:288` `remark: remark || ''` **零校验、零 trim**，写入侧完全依赖 sink 端 `csvField`，`\t`/`\r`/`\n` 前缀绕过依然成立（与 R3 路径 A 结论一致）。
- 【待核实】`​`（零宽空格）不在 JS `trim()` 剥离集合内（`trim` 只剥离 Zs 不含 Cf），若 Excel 将其视作公式前导空白则可构造绕过。建议用实际 Excel/WPS 打开验证一次。
- 附带面：`spec`/`manufacturer_name` 不进报表，但会进 `product-manage` 的 WXML 插值与 `abnormal_record.description`（`createReceipt:477-487` 拼了 `item.productName` + `item.remark`）。小程序 `{{}}` 默认转义，无 XSS；若后续改为 `rich-text` 渲染则升级。

### 2.3 CSV 注入面覆盖度

- 8 种报表全部经 `csvField`，双引号包裹 + `""` 转义（`createPurchaseOrder:45-46`），逗号安全。
- **BOM 前缀**：4 处上传均为 `Buffer.from(String.fromCharCode(0xFEFF) + csv, 'utf-8')`（如 `createPurchaseOrder:362`），Excel 中文不乱码，但不影响注入判定。
- 未走 `csvField` 的用户可控串只有**云存储路径**，由 `safePathPart` 处理（剥离 `\/:*?"<>|`，`createPurchaseOrder:50`）。`storeName`/`supName` 来自档案表而非本域导入，越界。
- **结论：`csvField` 拦截点覆盖导入数据（经快照链路），但拦截规则本身过窄（不拦 `\t\r\n`），且路径 A 无第二道防线。**

### 2.4 行数/上限/事务/失败回滚

- **无行数上限**：`:99` 一次 `sheet_to_json` 载入整表进内存；`:100` 只挡「空表」。10 万行 xlsx 会直接撑爆 SCF 内存。
- **无文件体积上限**：`cloud.downloadFile` 无 size 参数；前端 `product-manage.js:111-129` `wx.chooseMessageFile({count:1})` 也不限大小。
- **无 `config.json`**：`cloudfunctions/importProducts/` 下只有 `index.js` + `package.json`（已确认目录内容）。因此超时/内存走 SCF 默认值，**该默认值在本仓库无法确认**【待核实】。
- **逐行串行写**：`:189-196` 循环 `await db.collection('product').add()`。N 行 = N 次串行网络往返，是超时主因；且**不使用事务**（对比 `updateProductPrice:106`、`createPurchaseOrder:301` 都有 `runTransaction`）。
- **部分失败不回滚**：已成功 add 的行保留在库中，后续行失败只累加 `errors`。`:198-206` 返回 `{inserted, failed, errors}`，前端据此提示（`product-manage.js:144-149`）。**超时被杀时前端连这个结果都拿不到**（`product-manage.js:153` 只弹「导入失败」），库里却已有一半数据 → 用户重传，触发 `:156-158` 判重跳过，侥幸不重复但**用户无法得知哪些行已进库**。
- **中断残留**：`imports/products/` 下的临时 xlsx 永不清理（对比 `dataService:1484-1489` 删旧凭证图有清理逻辑）→ 云存储缓慢堆积。
- **错误返回截断**：`errors.slice(0, 50)`（`:204`）而 `failed` 是全量计数（`:203`）；前端再 `.slice(0,10)`（`product-manage.js:145`）。三级截断，`total - inserted - failed` 可能不为 0（因 `total` 含被跳过的空行，见 §3）。

### 2.5 分批逻辑审计（`:116-124`）

```js
let offset = 0
const BATCH = 100
for (;;) {
  const batch = await db.collection('product').skip(offset).limit(BATCH).get()
  existingProducts = existingProducts.concat(batch.data)
  if (batch.data.length < BATCH) break
  offset += BATCH
}
```

- `BATCH = 100`（`:118`）。终止条件 `batch.data.length < BATCH`（`:122`）。
- **逻辑正确但有 2 个缺陷**：
  1. **多一次空查询**：当商品数恰为 100 的整数倍，最后一轮取到 100 条后 `offset` 继续推进，再发一次查询拿到 0 条才 break。浪费一次 RT，非功能缺陷。
  2. **无上限、无超时兜底**：商品 10 万条则循环 1000 次串行查询，**发生在任何导入行处理之前**，且与 `:108-111` 的两条 `limit(1000)` 查询共同构成一次导引入库前的固定开销。商品规模扩大后本函数必然超时。
- 更严重的是这段**全表扫描只为构造一个 `Set` 判重**（`:125`），而云数据库支持 `where({product_name: _.in([...])})` 定点查。当前实现是把整个 `product` 集合拉进内存，属架构性低效。

### 2.6 类型转换与非法值

| 项 | 行为 | 证据 |
|---|---|---|
| 数字 | 无数字列，N/A | 模板无价格/数量列（`product-import-template.md:9-16`） |
| 文本 | `String(v).trim()`，**无长度上限**，Excel 单元格上限 32767 字符可全量入库 | `:63` |
| 日期 | 无日期列 | — |
| 枚举（单位） | **自由文本，无字典校验**。`斤`/`kg`/`公斤` 会并存 | 模板 `:13` 只写「如：斤、箱、瓶」，代码无校验 |
| 枚举（分类） | 精确 `===` 匹配启用分类 | `:146` |
| 非法分类 | 报错并跳过该行（阻断） | `:147` |
| 非法供应商 | **报错但继续插入**（非阻断），`defaultSupplierId=''` | `:167-168` |
| 空值静默 | `spec`/`manufacturerName`/`categoryL1`/`supplierName` 缺失全部静默空串或「默认」 | `:154`、`:178`、`:180` |

**注意 `spec: get('spec')`（`:178`）在 Excel 里若是日期/数字单元格，`String(v)` 会得到序列号或长整型**（SheetJS 未开 `raw:false`，`:99` 只设 `defval:''`）→ 用户填的「规格 500g/袋」是文本没问题，但填数字类内容会入库为 Excel 序列号。低频但确实存在。

### 2.7 主键冲突与去重

- `product_id` 生成：`'P' + Date.now() + crypto.randomBytes(4).toString('hex')`（`:172`），32 位随机熵，碰撞概率可忽略。与 `dataService.saveProduct:125` 的 3 字节随机（`crypto.randomBytes(3)`）**长度不一致**（24 位），两处 ID 熵量不同，非缺陷但需统一。
- **无唯一索引**（仓库无任何索引配置文件，`find` 未找到 `config.json`/schema 文件）→ 判重完全依赖 `:125` 的内存 `Set` + `:156-158` 内存比对。`seed-data/README.md:35-37` 亦确认 `supplier_product_price.(supplier_id,product_id)` 无索引。
- **判重键是 `product_name|manufacturer_name`**（`:125,:155`），**不含 `status`** → 停用商品也参与判重。本仓库无删除接口（只有 `toggleProduct`），因此「停用后想重新导入」这条路被判重键堵死。
- **并发导入竞态**：两个 purchaser 同时导入同名商品，`existingKeys` 快照都是导入前的 → 两边都判定不重复 → **重复入库**。`saveProduct` 侧同样无锁（`dataService:118-128` 先查后写），且 `saveProduct` **根本没有判重逻辑** → 同一商品可从 UI 与导入两条路各建一份。
- **覆盖 vs 追加**：**只追加，从不更新**。模板第 4 条「与已有商品重复时跳过，不覆盖」（`product-import-template.md:30`）与代码一致（`:156-158`）。**无 upsert**，因此导入不能用来修正存量商品的价格/分类/默认供应商——**已存在的商品连 `default_supplier_id` 都不会被改**，只能用 UI 编辑。

### 2.8 错误处理：全仓库唯一无外层 try/catch 的业务云函数

`importProducts` 的 `main`（`:82-207`）**没有任何外层 `try/catch`**，所有 `await` 都裸露。对照本仓库其余业务云函数的统一姿势：

| 云函数 | 外层 try/catch | 异常时的用户可见文案 |
|---|---|---|
| `createPurchaseOrder:98-470` | ✅ | 「采购订单保存失败，请稍后重试」 |
| `createReceipt:161-751` | ✅ | 「收货验收提交失败，请稍后重试」 |
| `updateProductPrice:67-137` | ✅ | 「价格更新失败，请稍后重试」 |
| `getProducts:40-65` | ✅ | 「商品数据加载失败，请稍后重试」 |
| `getProductPrices:40-88` | ✅ | 「价格数据加载失败，请稍后重试」 |
| `getSuppliers:40-95` | ✅ | 「供应商数据加载失败，请稍后重试」 |
| `dataService:1529-1558` | ✅ | 「CloudBase 数据操作失败，请稍后重试」 |
| **`importProducts`** | ❌ | **`utils/cloud.js:72-74` 的兜底：「CloudBase 服务连接失败，请稍后重试」** |

后果：一旦 `getSessionUser`（`:25-50`）内部的数据库调用抛错、或 `:108-111`/`:120` 的查询抛错、或任何一步非预期异常，**错误会以 promise reject 形式冒泡**，落到 `utils/cloud.js:72-74` 的 catch，被统一翻译成「CloudBase 服务连接失败」——**与真实原因完全无关**。用户（purchaser）看到「连接失败」会去重启网络/换 Wi-Fi，而实际可能是某个字段类型异常或某次查询超时。这直接摧毁可诊断性：出问题后既没有云函数侧的错误日志（无 `console.error`），客户端也拿不到任何真实信息。

注意这不是 §2.2 讨论的嵌套错误问题（那个是**成功返回**的形状错误），而是**抛错路径**的缺失，两者独立叠加：
- 正常业务失败 → 走嵌套 `{error:{...}}`（§2.2，被 `cloud.js:68` 吞掉，不跳登录）
- 意外异常 → 走 promise reject → 「CloudBase 服务连接失败」（本小节）
- 也就是说 importProducts 的失败面被两种机制各占一半，**没有一条路径能给出真实错误**。

**修法**：给 `main` 包一层 try/catch，返回 `{code:-1, msg:'导入失败，请稍后重试'}` 并 `console.error`。同时把 `requireUser` 的返回形状改为顶层 `{code,msg}` 与其他 17 份一致。两处改动都能显著改善可诊断性。

## 3. 导入模板 vs 代码列定义一致性

模板 `seed-data/product-import-template.md` 共 7 列，代码 `HEADER_ALIASES`（`importProducts:11-19`）定义如下，逐列比对：

| 模板列名（别名） | 模板必填 | 代码字段/别名 | 代码必填 | 结论 |
|---|---|---|---|---|
| 商品名称（品名） | ✅ | `name`:`商品名称`/`品名` | ✅ `:141` | ✅ 一致 |
| 一级分类 | ❌ | `categoryL1`:`一级分类` | ❌ `:145` | ✅ 一致（见下方歧义说明） |
| 二级分类（分类） | ✅ | `categoryName`:`二级分类`/`分类` | ✅ `:147` | ✅ 一致 |
| 单位 | ✅ | `unit`:`单位` | ✅ `:142` | ✅ 一致 |
| 规格 | ❌ | `spec`:`规格` | ❌ | ✅ 一致 |
| 厂家/品牌（厂家、品牌） | ❌ | `manufacturerName`:`厂家`/`厂家/品牌`/`品牌` | ❌，默认「默认」 | ✅ 一致 |
| 默认供应商（供应商） | ❌ | `supplierName`:`默认供应商`/`供应商` | ❌ | ✅ 一致 |

**列名与别名 7/7 完全一致**，模板「顺序不限」也由 `mapHeader`（`:67-80`）按名称建映射实现，成立。

**但以下 7 处文档声称与代码行为不符：**

1. **🔴 模板示例行 100% 必然导入失败**（最严重，本轮新增）。`product-import-template.md:20-23` 的示例用二级分类「叶菜类」「禽类」，而 `seed-data/category.json` 的 12 个二级分类为蔬菜/肉类/海鲜水产/调料干货/粮油/酒水饮料/冻品/豆制品/纸品/餐具/清洁用品/包装材料——**「叶菜类」「禽类」都不存在**；且示例的「一级分类」列填的是「蔬菜」「肉禽」，而代码 `:149` 拿它去比对 `category_level_1_name`（实际值是「后厨」「前厅」），**也对不上**。`importProducts:146-147` 精确 `===` 匹配 → 任何照抄示例的行必然报「二级分类不存在」。这是**文档即坏文档**：新用户照着唯一示例填，100% 失败率。属本轮新增发现，旧文档（full-scan-08 §5.4）只提到「示例与种子分类不一致」但未指出后果是示例不可用。
2. **「最多显示前 10 条」（模板 `:31`）是前端行为，服务端返回 50 条**。`importProducts:204` `errors.slice(0,50)`，`product-manage.js:145` `.slice(0,10)`。文档描述与实现恰好一致（前端确实只显示 10 条），但**用户拿到 `failed` 总数与实际可见错误数差最多 40 条，无法从界面获取完整失败清单，也无导出通道**。文档未提及服务端 50 上限。
3. **「一级分类……可不填」（模板 `:11`）在重名场景下会静默选错分类**。`:146-152`：先按 `category_name` 取候选，`l1Name` 为空时不做歧义判定，直接 `candidates[0]`（`:152`）。seed 数据中二级分类名全局唯一，但生产环境「前厅/后厨各有一个『包装』」是完全可能的 → **静默落到第一个匹配项，且不报错**。模板说「仅用于二级分类重名时辅助定位」，措辞暗示了风险但代码不主动报错。建议：重名且未填一级分类时该行判失败。
4. **「不存在则该商品供应商留空并提示」（模板 `:16`）的「提示」被计入 failed，但商品仍然插入成功**。`:168` 把该情形 push 进 `errors`，而 `:171` 的插入照常发生。于是结果弹窗会显示「成功 N 条 / 失败 M 条」，其中 M 里混着**已成功的商品** → **计数语义误导**，用户可能重复导入。
5. **「与已有商品重复时跳过」（模板 `:30`）对停用商品同样生效**，代码判重键不含 `status`（`:125`）。停用后重新导入同一商品会显示「已存在同名同厂家商品，跳过」，用户无法通过导入恢复/重建。
6. **模板未声明导入不建价格**。这是本次勘探最需要补进文档的一条：导入商品**不会**产生 `supplier_product_price` 记录（全函数无该集合写入），因此导入完成 ≠ 可正常结算。模板 `:27` 只说「仅支持 .xlsx」，`:28`「全行为空的行自动跳过」——后者与代码 `:139` 一致（`name`/`unit`/`categoryName` 三空即跳）。
7. **「一级分类」填了但不匹配时静默降级不报错**。`:148-151` 中，若 `l1Name` 填了但 `candidates` 里没有该一级分类名的项，`:149-150` 的 `byL1` 为空数组 → 条件 `if (byL1.length)` 为假 → 代码**不报错，直接用未过滤的 `candidates[0]`**（`:152`）。用户填错了「一级分类」会得到一个错误的「二级分类」被静默接受。模板 `:11` 说「仅用于二级分类重名时辅助定位」，隐含了「填错应该报错」的预期，但代码只把它当弱提示。建议：`byL1` 为空且 `l1Name` 非空时判该行失败。

另有一处**容错盲区**（与模板规则无直接矛盾，但影响实际可用性）：`HEADER_ALIASES`（`:11-19`）是精确等值匹配，因此以下输入全都不识别——
- 内部空白：`'商品 名称'` ≠ `'商品名称'`（`cellText` 只 trim 首尾，`:63`）
- 全角括号/异体字：`'二级分类（必填）'` ≠ `'二级分类'`
- 大小写/繁简/英文：`'Name'`/`'名称'`/`'Product'` 全部不识别
首行必须是表头，整批报「表头不匹配」（`:103-104`）；同一 field 只取第一个命中列（`:73`）。模板 `:6` 只说「列名必须与下表一致（含别名）」，未提示这些边界。

**补充：`total` 计数含空行**。`:201` `total: rows.length - 1`，但 `:139` 跳过的全空行不计入 `inserted` 也不计入 `failed`。若表格末尾有空行，`total ≠ inserted + failed`。前端 `product-manage.js:144` 直接拼「共 X 行，成功 Y 条，失败 Z 条」，数字对不上会让用户怀疑数据丢失。

## 4. 供应商报价模型取值歧义

### 4.1 唯一性约束

**`supplier_id + product_id` 无任何数据库层唯一约束**（仓库无索引配置文件）。唯一性仅靠 `updateProductPrice:106-131` 的 `runTransaction`：事务内 `where({supplier_id, product_id, is_current:1}).limit(100)` 逐条置 0，再 insert 一条 `is_current:1`。事务语义可防止「两条 current」并存，**该点实现正确**。

但有以下衍生问题：
- **`limit(100)` 上限**（`:109`）：理论上同一 `(supplier, product)` 已有 100 条 `is_current:1` 时才触发，正常不会到，但一旦发生（例如历史脏数据），第 101 条不会被翻转 → 双 current。**建议改为循环翻页或按 `_.neq` 一次性 update**。
- **`priceId = 'PRC_' + Date.now()`**（`:103`）：毫秒精度，并发两次调价在同一毫秒内会产生**重复 `price_id`**。云数据库无唯一索引，重复 ID 静默入库。对比同仓库其他 ID 都带随机后缀（`createPurchaseOrder:271` 的 `randomBytes(2)`、`createReceipt:320` 的 `randomBytes(3)`），此处缺失，属一致性缺陷。
- **无去重语义**：新价等于旧价也会新建一条历史行（`:103-130` 无比较），长期产生大量重复行。
- **旧行不清 `expiry_date`**，只翻 `is_current`（`:112-113`），因此 `expiry_date` 字段事实上永不被赋值（`:124` 恒为 `null`），成为死字段。

### 4.2 多条价格记录时下单取哪条 —— 关键结论

**`createPurchaseOrder` 根本不给「取哪条」这个问题留机会：它完全不读 `supplier_product_price`。**

- 下单行的供应商来源是 **`product.default_supplier_id`**：`createPurchaseOrder:250` `supplierId: product.default_supplier_id || ''`，写入 `:333`。
- 下单明细**没有任何价格字段**（`:327-338` 的 insert 不含 price），因此「单价快照 vs 实时取」的问题在下单环节不存在。
- 价格首次进入数据的是**收货环节**：`createReceipt:342-346` 按 `is_current:1` 查，`:350` 落到 `priceSnapshot`，`:458` 写入 `receipt_item.price_snapshot`。
- 这与 `dataService:303` 的注释口径一致：「下单明细无价格字段（价格快照在收货时才生成）」。

**因此「一商品对多供应商多条价格」这个模型只有后半截是活的**：`supplier_product_price` 支持多供应商报价，`price-manage` 允许给同一商品配多供应商价格（`price-manage.js:196-227`），但**下单永远只走 `default_supplier_id` 这一家**，其余供应商的报价在下单/结算链路上是不可达数据。
- **没有 `min()` 择优**：代码不会挑最低价。
- **没有 `limit(1)` 静默取首条**：因为压根不查。
- **但存在「静默取默认」的更严重形态**：管理员在 `price-manage` 给供应商 B 配了该商品的价格（`saveNewPrice`），门店下单仍走供应商 A（`default_supplier_id`），若 A 无价则该行落 0 价。UI 上看不出「这个商品配了价但没生效」。

**`getProductPrices` 的取值顺序**：`orderBy('effective_date','desc').limit(200)`（`getProductPrices:59-60`），`effective_date` 为 `YYYY-MM-DD` 字符串，字典序 desc = 时间倒序，正确。`onlyCurrent` 是**可选**参数（`:55`）——不传就返回全部历史行。`price-manage.js:36` 与 `supplier-prices.js:30` 都显式传了 `onlyCurrent:true`，口径正确；但云函数本身不对该参数设默认值，属调用方责任，新增调用方易漏。

## 5. updateProductPrice 事务与历史

- **历史 = 同集合 `is_current:0` 的旧行**，无独立 `price_history` 集合。`updateProductPrice:111-115` 只翻 `is_current` 和 `updated_at`。历史可见性由 `getProductPrices` 的 `onlyCurrent` 开关控制（`:55`），管理员不传即看全量。设计简洁，代价是「历史」与「当前」共用一集合、无法物理隔离审计。
- **`is_current` 切换原子性：成立**。`:106-131` 包在 `db.runTransaction` 内，先翻旧后插新，注释（`:104-105`）明确说明并发会留双 current 的风险。事务化后该风险闭合。
- **新旧价并存时下单取哪个：见 §4.2 —— 下单不取价，收货取 `is_current:1`**（`createReceipt:343`）。因此「收货日现价口径」严格成立，与 `:40-42` 的 #10 拍板注释一致，也与 `:80` 的 S5 拍板（只允许当天生效）自洽。
- **`:81` 的 `Date.now()+8*3600*1000`** 与 `createPurchaseOrder:119`、`createReceipt:318`、`generateSummaryReport`（间接）口径一致，共 4 处「今天」算法统一。**但 `:87-89` 的格式校验是冗余的**：`:83` 已强制 `priceDate === today`，能走到 `:87` 的只有今天，今天必然通过 ISO 校验。`:86-87` 的 `parsedDate` 计算结果仅用于自校验，无实际作用，属死代码。
- **`:55` 的在途单波及计数准确性 —— 偏大（overcount）**：
  `countInflightOrders`（`:44-64`）以 `purchase_order_item where {supplier_id, product_id}` 取订单号，再按 `order_status ∈ INFLIGHT_ORDER_STATUS`（`:43`，6 个状态）计数。三个问题：
  1. **不校验行级收货状态**：`partial_received` 订单里该行可能已收完，仍被计入「将按新价结算」。注释 `:42` 声称「在途 = 已提交且未收完」，实现只到订单粒度 → **对分批收货（B3）场景系统性高估**。
  2. **`limit(1000)` 截断**（`:48`）：商品被 1000+ 个订单行引用时计数偏低（与注释的「可见」目标相悖，方向相反）。
  3. **口径含 `report_generated`**（`:43`）：该状态在收货前，逻辑正确。
  - **后果定性**：该计数**只用于弹窗提示与 toast 文案**（`price-manage.js:146-153`、`:163`、`:219-220`），不参与任何结算决策。因此高估的后果是「管理员看到虚高的波及数」，不产生资金错误。**但提示文案「调价后它们将按新价结算」在高估场景下是错误的承诺**（那些已收完的行结算价已固化在 `receipt_item.price_snapshot`），属产品口径缺陷而非资金缺陷。
- **`updated_by` 优先级正确**（`:126`）：`user.user_id || user._id || updatedBy || 'system'`，服务端身份在前，客户端传入的 `updatedBy` 排第三且仅在服务端身份缺失时才被采用 → **无法伪造审计人**。这点值得单独记录为正确实现。
- **`dryRun` 无副作用**（`:98-101`）：只计数不落库，`price-manage.js:135-141` 先 dryRun 再确认，设计合理。dryRun 与正式调用之间存在 TOCTOU，但只影响提示数字，不构成问题。
- **校验边界**：`:76-79` `Number(newPrice)` + `Number.isFinite` + `>0`，能挡住 `''`/`null`/`Infinity`/`NaN`/负数/0；但 `Number('0.00000001')` 合法，`:121` 原样入库，后续 `createReceipt:346` 的 `Number(p.price) || 0` 会保留该极小值 → 账单出现分厘级金额，非缺陷但值得留档。

## 6. 零价/空价溯源链（重点）

### 6.1 `getProductPrices` 查不到时的返回

`getProductPrices:57-62` 查不到返回 `{ code: 0, data: [] }`（`:84`）——**成功码 + 空数组，不报缺失**。这是「空价」的第一处静默点：调用方必须自己判断空数组，而云函数不区分「无权限」「查询失败」「确实没配价」。

- 查询失败的降级是 `{code:-1, msg}`（`:87-88`），可区分。
- 权限不足返回 `{code:-403}`（`:48`、`:51`），可区分。
- **唯独「没配价」与「查询成功」同码**，前端无强约束。

### 6.2 前端如何处理空

- `price-manage.js:49-59`：空数组 → `priceList = []`，页面空态；并且**有专门的「新增价格」入口**（`:172-227`，`showAddPrice`），说明设计上预期「档案商品可能无价」，补救入口存在。
- `price-manage.js:54`：`productName: product ? product.name : price.productId` —— 找不到商品时直接显示 `P001` 这类原始 ID，不报错，静默降级。
- **`purchase-create.js` 全程不调用 `getProductPrices`**（已通读 432 行确认）。门店下单页面**不展示单价**，因此下单侧不存在「空价 UI」。价格唯一进入数据面的点是 `createReceipt`。这一点对 §4.2 很重要：**下单页不显示价格 = 门店端无法感知商品未配价**，只能等收货时被系统标异常。

### 6.3 零价/空价的完整产生路径（三条，可见性不对称）

| 路径 | 触发条件 | `supplierId` | `priceSnapshot` | `payableFlag` | `isMissingPrice` | 可见性 |
|---|---|---|---|---|---|---|
| **A** | 商品有 `default_supplier_id`，但该供应商对该商品**无价格行** | 非空 | 0（`createReceipt:346` 查不到 → `:350` `\|\| 0`） | false（`:363`） | **true**（`:366` 条件全满足） | ✅ 生成 `abnormal_record`（`:484-488`），`description` 明写「未配置供应商协议价…请补价后补账」（`:485`），异常列表可见（`dataService:697-732`），`price-manage` 有补价入口，`dataService:1035-1103` `repriceReceipt` 可补账 |
| **B** | 商品 `default_supplier_id` 为**空**（导入未填/未匹配供应商） | `''` | 0（`:350` 三元短路，**连查都不查**，因 `:339` 的 `priceProductIds` 已用 `item.supplierId &&` 过滤） | false（`:363`） | **false**（`:366` 要求 `item.supplierId` 为真 → 不成立） | ⚠️ **不进任何带价账单（④⑥）、无 `abnormal_record`、无消息、无人提醒**。仅在 ③ 门店收货报表中以「验收状态=正常 / 异常类型=空 / 是否可付款=否」出现一行无理由记录，在 ⑦ 日/月汇总中以金额 `0.00` 计入 `item_count`（`generateSummaryReport:191` 只排除 `is_manual`，本行 `is_manual=false` 故被计入）。无任何系统级追踪入口 |
| **C** | 手动商品（`is_manual`） | `''` | 0 | false（`:361` 硬置） | false | ✅ 设计使然：金额走凭证核销 `verify_amount`（`dataService:1434-1526`），`generateSummaryReport:191` 明确排除，属预期行为 |

**路径 B 是本轮最重要的发现**，且与 `importProducts` 直接耦合：

- `importProducts:163-169`：`supplierName` 为空 → `defaultSupplierId=''`（`:164`）；填了但没匹配到 → 记 error 但 `defaultSupplierId` 仍为 `''`（`:167-168`）。**两种情况都照常插入**（`:171`）。
- 模板 `product-import-template.md:16` 明确「默认供应商」是可选列，「不存在则该商品供应商留空并提示」——**文档承认会留空，但没有说明留空的后果是这批商品永远无法进结算**。
- 于是「Excel 导入一大批商品，供应商列留空」这个最顺手的用法，会直接产出一批路径 B 商品：**收货时静默 0 价，账单缺一整批货，且没有任何告警**。`getOrderStats`（`dataService:827-865`）不统计这类缺口，`report_file` 的 `excluded_rows`（`createReceipt:606`、`:689`）记录了被剔除行数但**没有任何页面读取并提示它**。
- **测试盲区**：`seed-data/product.json` 的 12 条商品全部有 `default_supplier_id`（SUP001~SUP006），**无一条是空供应商样本**；`seed-data/supplier_product_price.json` 12 条也全是「一商品一供应商一条 current」，**无多供应商同商品的笛卡尔积样本**，**无缺价样本**。因此路径 A（缺价）与路径 B（空供应商）在 seed 数据下**完全不可复现**，任何基于种子数据的测试都覆盖不到本 P0。旧文档 08:692 已记「种子未覆盖缺价/多供应商同商品」，本轮补上「未覆盖空供应商」这一项。

### 6.4 与「`receipt_item` 无 `is_missing_price` 字段」的互相印证

R5 已确认 `receipt_item` 集合无 `is_missing_price` 字段。本轮从写入侧确认该结论并补充定位：

- `createReceipt:447-467` 的 `receipt_item` insert 明确**不含** `is_missing_price`，只含 `is_shortage`/`is_quality_issue`/`is_wrong_item`/`is_manual`（`:462-461`）。
- `isMissingPrice` 是**仅存在于内存对象上的临时标记**：`:367` `item.isMissingPrice = true` → `:470-474` 经 `getItemAbnormalTypes`（`:59-67`）映射为字符串 `'missing_price'` → `:488-504` 写入 **`abnormal_record`** 集合（`type: 'missing_price'`）。
- 异常字典 `ABNORMAL_TYPE_NAMES`（`createReceipt:52-57`、`dataService:683-689`）两份都含 `missing_price: '缺价待补'` —— commit `3558678` 加的是**字典**，上游字段确实从未落到 `receipt_item`。R5 结论成立。
- **额外发现 1**：`dataService.regenerateReceiptReports:1142-1148` 的 `itemAbnormalTypes` **漏掉了 `missing_price`**，只映射 `is_shortage`/`is_quality_issue`/`is_wrong_item`。即**补生成收货报表时，缺价行在报表的「异常类型」列显示为空**（而原始生成时 `getItemAbnormalNames` 会显示「缺价待补」）。两份逻辑漂移，属 R5 未覆盖的同类缺陷。
- **额外发现 2**（旧文档 04:634 B8 提到但未落实）：`getReportDetail:12-16` 的异常字典**缺 `missing_price`** —— commit `3558678` 只补了 `dataService`，漏了这一处。后果：报表详情页读到 `type:'missing_price'` 的异常时会显示裸英文。这是「字典补齐」工作半途而废的第二个断点（第三个是 §6.4 的额外发现 1）。
- `getReceipts`/`getReportDetail` 是否读取 `excluded_rows`：本轮未读，但 `report_file` 写入点明确有该字段（`createReceipt:606`、`:689`、`dataService:1194`、`:1254`），是否被消费【待核实】。

### 6.5 结论一句话

零价的可见性完全取决于**收货时该行有没有供应商**：有供应商 → 系统完整告警并可补价补账；无供应商 → 不进任何带价账单、无异常单、无提醒，只在不含价的收货报表里留一行「正常 / 不可付款」的无理由记录。而「无供应商」正是 Excel 导入的默认产出。

## 7. 停用可见性矩阵

三类资源的 `status` 字段名与取值一致（均为整数 `1`/`0`，`dataService.toggleProduct:138`、`toggleSupplier:182` 都是 `product.status === 1 ? 0 : 1` 翻转），无命名漂移。逐格审计：

| 资源 | 停用字段 | 停用后行为 | 证据 | 评价 |
|---|---|---|---|---|
| 商品 | `product.status=0` | 不可下单 | `createPurchaseOrder:219` `where({product_id: _.in(...), status:1})` + `:243` 报错「部分商品已下架或不存在」 | ✅ 服务端强制，前端也过滤（`purchase-create.js:129-131` `includeInactive:false`） |
| 商品 | 同上 | 不可定价 | `updateProductPrice:92` + `:95`「商品不存在或已停用」 | ✅ |
| 商品 | 同上 | 导入判重仍命中（无法重建） | `importProducts:125` 判重键不含 status | 🟡 语义瑕疵，见 §3 第 4 条 |
| 商品 | 同上 | 管理端仍可见 | `getProducts:45-47` | ✅ 预期 |
| **供应商** | **`supplier.status=0`** | **仍可被下单指向** | `createPurchaseOrder:250` 取 `product.default_supplier_id`，`:333` 直接写 `supplier_id`，**全程不查 supplier 状态** | 🔴 **P1 漏洞**：`supplier-manage.js:99` 承诺「停用后下单不可再选择」为**假承诺** |
| 供应商 | 同上 | 不可定价 | `updateProductPrice:91` + `:94`「供应商不存在或已停用」 | ✅ |
| 供应商 | 同上 | 导入匹配不到 → 静默留空 | `importProducts:110` 只查 `status:1`，`:167-168` 未匹配仍插入 | 🟠 与 §6.3 路径 B 叠加 |
| 供应商 | 同上 | **chef 可越权查看** | `getSuppliers:58` 允许传 `status`，绕过 `:54` 的 `includeInactive` 守卫 | 🔴 P1，见下 |
| 门店 | `store.status=0` | 非全局角色不可下单 | `createPurchaseOrder:164` `where({store_id, status:1})` | ✅ |
| 门店 | 同上 | 全局角色不可下单 | `createPurchaseOrder:198` | ✅ |
| 门店 | 同上 | 不可收货（两处校验） | `createReceipt:178`（非全局）、`:188-189`（全局强制） | ✅ |
| 门店 | 同上 | **仍可生成汇总报表** | `generateSummaryReport:178` `where({store_id}).limit(1).get()` **无 status 条件** | 🟡 P3：店长账号在门店停用后仍能出历史汇总。报表属只读，影响面小，但语义不一致 |

### 7.1 `getSuppliers` 的守卫绕过（P1）

```js
// getSuppliers:53-59
const isManager = ['super_admin', 'purchaser'].includes(user.role)
if (includeInactive && !isManager) return { code: -403, ... }   // :54
...
if (status !== undefined && status !== null && status !== '') query.status = status   // :58
else if (!includeInactive || !isManager) query.status = 1                                    // :59
```

chef 调 `getSuppliers({ status: 0 })`：`:54` 不触发（`includeInactive` 为 undefined）→ `:58` 命中 → `query.status = 0` → 返回全部停用供应商。**守卫只挡了「显式 includeInactive」这一种姿势，没挡「隐式 status 过滤」。** 同理传 `status:1` 是合法行为，无法区分意图，因此正确修法是**把 `:54` 的判定改为「非管理员强制 `status=1`，忽略 status/includeInactive 两参数」**，而不是加白名单。

对照 `getProducts`：`:43` 的入参解构里**没有 `status`**，只有 `categoryL1/categoryId/keyword/includeInactive`，因此不受影响。两个函数的守卫强度不一致，`getSuppliers` 是弱的那个。

### 7.2 与 includeInactive 守卫的联动（修正 R8 表述）

R8 结论「非管理员深链进页时 2/3 个并发请求 -403，页面停留旧数据」本轮复核，**范围更广、表述需微调**：

- 硬编码 `includeInactive: true` 的页面是 **3 个**而非 2 个：
  - `product-manage.js:31`（getProducts）、`:33`（getSuppliers）→ 2/3 请求 -403（`dataService.getCategories` 不受影响）
  - `price-manage.js:34`（getSuppliers）、`:35`（getProducts）→ 2/3 请求 -403（`getProductPrices` 不受影响）
  - `supplier-manage.js:22-24`（getSuppliers）→ **1/1 请求 -403**（该页唯一数据请求）
- **行为不是「停留旧数据」而是「页面永久空态」**：三个页面的 `loadData` 在 `:35-42`（product-manage）/ `:38-42`（price-manage）/ `:25-28`（supplier-manage）都是 `code !== 0` 即 `return`，**不会 setData**，`products`/`priceList`/`suppliers` 保持初始 `[]`。只有在该页已加载过一次数据后才会有「旧数据残留」，而 `onShow` 每次都会重拉并再次 -403，所以准确描述是**「首次进入即空态 + toast，且因 `onShow` 重复触发而每次进入都重现」**。
- 实际风险低于 R8 表述：这三个页面均为管理端页面，正常只由 purchaser/super_admin 进入，`includeInactive` 生效。真实触发条件是**chef/店长被深链进管理页**（例如分享链接、误点 tabBar），此时页面不可用但无数据泄露。定级 P2。
- **但注意 `getSuppliers:58` 的绕过与这条叠加**：即便守卫修好，只要 chef 能调云函数就能拿停用供应商，页面层拦不住。云函数层是唯一防线。

### 7.3 「停用商品仍能下单」漏洞：不存在

明确回答：**商品停用后无法新建订单行**，因为 `createPurchaseOrder:219` 的 product 查询带 `status:1`，`:243` 对缺失行直接拒绝整单。「能下停用商品」的漏洞**不成立**。真正的空洞在供应商侧（§7 第 4 行）。

### 7.4 三个列表函数的守卫强度对比（本轮新增）

「读商品/供应商」这组函数的角色门禁强度**不一致**，而 `getProducts` 是唯一不设防的那个：

| 函数 | 登录校验 | 角色门禁 | supplier 角色能看到什么 |
|---|---|---|---|
| `getProducts:41-45` | ✅ 有 | ❌ **完全无角色白名单** | **全量商品（含所有分类、所有默认供应商指向）** |
| `getProductPrices:46-53` | ✅ 有 | ✅ supplier 强制收敛自身 + 非全局角色 -403（双重门禁） | 仅自己名下的协议价 |
| `getSuppliers:45-54` | ✅ 有 | ✅ supplier 分支只看自己 + 非管理员拦 `includeInactive` | 仅自己档案 |

`getProducts` 的入参解构（`:43`）里只有 `categoryL1/categoryId/keyword/includeInactive`，**连 `status` 都没有**（因此不受 §7.1 的 `status` 绕过影响），但代价是它也不做任何角色收敛。

- **影响面取决于 supplier 门户是否调用它**：`purchase-create.js:129` 是 chef/store_manager/purchaser 走的下单页；supplier 门户的四个页面（`supplier-prices`/`supplier-orders`/`supplier-receipts`/`supplier-home`）本轮未读（属 R9 边界），因此「supplier 是否会调到 getProducts」【待核实】。
- **若不可达则无害**，属「口径缺一格」而非实际漏洞；但若可达，则 supplier 能枚举全库商品（商品名/分类/规格/厂家/默认供应商 ID），这与 `getProductPrices`/`getSuppliers` 的收敛口径形成明显不一致。
- 修法是给 `getProducts` 加一行 `if (user.role === 'supplier') return { code: -403, msg: '当前账号无权查看商品' }`，或收敛到「默认供应商指向自己的商品」。

另有一处同族的入参防御强度不一致：**`getProducts:50` 的 `Number(categoryId)` 无任何校验**，非法字符串 → `NaN` 直接进 `where`；对照 `getSuppliers:58` 有 `!== undefined && !== null && !== ''` 三重判空。云数据库对 `NaN` 的 where 语义【待核实】，最坏情况是查询抛错被 catch 吞成「商品数据加载失败」。旧文档 04:432 已记此事，本轮确认为 P2。

## 8. getSuppliers 返回字段审计 + supplier-prices 横向比价

### 8.1 返回字段

`getSuppliers:87-90` 对非供应商角色返回 `{ ...item, product_count }` —— **整条 supplier 文档展开**。`seed-data/supplier.json` 显示 `supplier` 集合的字段为：`supplier_id`、`supplier_name`、`contact_name`、`contact_phone`、`address`、`status`、`created_at`、`updated_at`。

- **无登录凭据字段**（无 password/token/盐值），因此**不存在凭据泄漏**。这一点可以放心。
- **但存在 PII 过度展开**：`contact_name` + `contact_phone` + `address` 会下发给所有角色（chef、store_manager、supplier、purchaser、super_admin），因为它们都调同一个函数。对比本仓库对「订单头泄漏」的处理原则（R3 已修 `getSupplierOrders`/`getSupplierReceipts` 的全量展开），供应商档案侧仍是同类模式：**按调用方角色裁剪字段，而非返回全量**。
- `getProducts:61` 返回 `list`（整条 product 文档）同样是全量展开，但 product 无敏感字段（`manufacturer_name` 之类），影响低。
- `normalizeSupplier`（`utils/cloud.js:187-199`）以 `...supplier` 展开开头，**不裁剪**，等于把全量透传到前端 `data`。
- 供应商自查路径（`getSuppliers:45-51`）**强制返回自己档案**且**忽略 `status`/`keyword`/`includeInactive` 三个参数**（只按 `supplier_id` 查），因此**供应商账号能看到自己被停用后的档案**（`seed-data/supplier.json` 第 6 条 SUP006 `status:0` 即此类），但看不到他人档案。这个行为合理，且与 §8.2 的比价隔离配合得当。
- 附带：`:51` 硬编码 `product_count: 0`，与 `:87-90` 的真实计数不一致 → **供应商自查时商品数恒显示 0**，属显示缺陷（P3）。

### 8.2 supplier-prices 横向比价泄露：不存在

`getProductPrices:46-49`：
```js
if (user.role === 'supplier') {
  if (!user.default_supplier_id) return { code: -403, ... }
  query.supplier_id = user.default_supplier_id
}
```
- **服务端强制覆盖 `supplier_id`，忽略前端传入的 `supplierId`**（`:52` 的 `if (supplierId)` 在非 supplier 分支）。因此供应商**无法**通过改参数看别家的价格。
- 供应商也**看不到「某商品其他供应商报价更低」这类横向信息**，因为查询按 `supplier_id` 精确等值过滤，不带 product 维度的跨供应商比对。
- `supplier-prices.js:30` 只传 `onlyCurrent:true`，未传 `productId` → 返回该供应商**全部**当前价（最多 200 条），即「供应商看得到自己名下所有商品的报价」，符合预期。
- **因此横向比价泄露不成立，该点实现正确**（值得记录为正面结论）。
- 唯一残留：`:55` 的 `onlyCurrent` 可选，若供应商不传则能看到自己的历史调价记录。`supplier-prices.js:30` 传了，无实际问题；但云函数不给 supplier 分支强制 `is_current`，属调用方责任（与 §4.2 同一处设计）。
- **`.limit(200)` 截断**（`getProductPrices:60`）：报价超 200 条的供应商在页面会**静默少显示**，无翻页。P2。

## 9. 分页与排序稳定性

| 函数 | 排序键 | 是否有稳定次级键 | 影响 |
|---|---|---|---|
| `getProducts:53` | `product_name asc` | ❌ 无 | 同名商品（不同 `manufacturer_name`，见 `:125` 判重键设计承认了同名存在）排序不确定。当前 `limit(200)` 不分页，故**不产生翻页重复/漏项**；但同名商品在列表中的相对位置会跨请求跳动，编辑态体验抖动 |
| `getProductPrices:59-60` | `effective_date desc` | ❌ 无 | **同一 `(supplier, product)` 同日多条价格时顺序不确定**。`updateProductPrice` 强制 `effective_date = today`（`:81`），同一天多次调价会产生同日多行，而 `price-manage` 依赖返回顺序展示「当前价」——`:88` 前端又按 `supplierName` 重排，掩盖了该问题 |
| `getSuppliers:66-67` | `supplier_name asc` | ❌ 无 | 同名供应商排序不确定，`saveSupplier` 已按名称唯一去重（`dataService:155-161`），实际不会重名 → 无实际影响 |
| `importProducts:120` | 无排序（`skip/limit`） | ❌ 无 | **游标分页的经典风险**：`skip(offset).limit(100)` 无稳定排序键，若期间有写入，可能重复或漏读商品。当前用途只是构造判重 `Set`，重复无害、漏读则导致该商品被判为「不存在」而重复导入 → 与 §2.7 的并发竞态叠加 |
| `generateSummaryReport:92-98` | 无（只取 `receipt_id` 集合） | — | 只收集 id 再另行查 item，无顺序依赖，安全 |

**结论**：三个列表函数都缺稳定次级排序键，但因为都是**单页 `limit` 全量取、无 offset 翻页**，实际不产生用户可见的翻页错乱。真正的分页（`importProducts:119-124`）没有排序键，且其结果只用于判重，危害被限定。因此本项**不升级为 P1**，但建议统一加 `_id asc` 作为次级键，成本极低。

**另需记录的截断点**（与排序无关但同属稳定性）：`getProducts:53` `limit(200)`、`getProductPrices:60` `limit(200)`、`getSuppliers:67` `limit(100)`、`getSuppliers:78` `limit(1000)`（product_count 计数）、`importProducts:109-110` `limit(1000)`（分类/供应商匹配池）。**均为静默截断，无总数回传，前端无从感知**。

**`getProducts` 的关键词搜索是截断后过滤**：`:53` 先 `limit(200)` 再 `:56-59` 内存 filter。**商品总数超过 200 时，排在 200 名之后的商品永远搜不到**（`orderBy product_name asc`，所以是「字母序靠后的商品搜不到」）。这是本轮发现的、与「`.limit(200)` 截断风险」不同的**具体用户可见缺陷**，定级 P1。`getSuppliers` 的 `keyword` 走服务端 `db.RegExp`（`:61`），反而不受此影响——两个函数的搜索实现不一致。

## 10. 旧结论复核表 + 旧【待核实】回收表

> 依据：并行通读 `full-scan-04-cloud-data-product.md`(654 行) / `full-scan-05-pages-admin.md`(456 行) / `full-scan-08-infra-and-data-contract.md`(702 行) / `full-scan-02-cloud-purchase-receipt.md`(428 行) / `controller-horizontal-scan-20261004.md`(602 行)，共 2842 行。**若旧文档结论与本文 §2-§9 的代码实测冲突，一律以代码实测为准**（下文标注了 3 处旧文档错误）。

### 10.1 旧结论复核（仍成立 / 需修正）

| # | 旧结论（出处） | 判定 | 证据 |
|---|---|---|---|
| 1 | `getProducts`/`getSuppliers` 新增 `includeInactive && !isManager → -403` 守卫（04:370、04:413） | ✅ **仍成立，行号未漂移** | `getProducts:44-45`、`getSuppliers:53-54` |
| 2 | 三个管理页硬编码 `includeInactive:true`（05:100、05:133、05:226） | ✅ 仍成立（旧文档已是 3 页，非 2 页） | `product-manage.js:31,33`、`price-manage.js:34,35`、`supplier-manage.js:22-24` |
| 3 | 上条行为是「页面停留旧数据」 | 🔧 **修正**：是「空态 + toast，`onShow` 每次重拉都重现」 | 三页 `loadData` 的 `code!==0` 分支直接 `return`，不 setData |
| 4 | `.limit(200)` 截断风险（04:421、08:377-386） | ✅ 仍成立，**追加具体后果** | 除静默截断外，`getProducts` 关键词搜索 200 条后失效（§9）；`getProductPrices:60` 的笛卡尔积增长最快（10 供应商×20 商品即顶破） |
| 5 | `receipt_item` 无 `is_missing_price` 字段，`missing_price` 字典是「加字典但无上游字段」（08:570-574、08:594-595） | ✅ **仍成立，本轮从写入侧确认 + 新发现** | `createReceipt:447-467` 无该字段；`isMissingPrice` 仅存内存（`:367`）→ 落 `abnormal_record`（`:488-504`）。**新发现**：`dataService:1142-1148` 的 `itemAbnormalTypes` 漏映射 `missing_price`，补生成报表时该行「异常类型」列为空 |
| 6 | `updateProductPrice:81` 用 `Date.now()+8h` 算今天（04:178） | ✅ 仍成立 | `updateProductPrice:81`、`createPurchaseOrder:119`、`createReceipt:318`。**补充**：`:87-89` 格式校验在 `:83` 等值校验之后，属冗余死代码 |
| 7 | `updateProductPrice:55` 引用 `INFLIGHT_ORDER_STATUS` 统计在途单波及数 | ✅ 仍成立，**结论修正为「系统性偏大」** | `:43-64`。不校验行级收货状态 → `partial_received` 中已收完的行被计入；`:48` 另有 `limit(1000)` 截断使其偏小 |
| 8 | `importProducts` 是「落后版本」（少 B12 注释 + 嵌套 error），是「漂移已实际发生」的最有力证据（08:281-284） | ✅ **仍成立，本轮定位出功能性后果** | `importProducts:25-27` 无 B12 注释（其余 4 个在 `:15` 有）；`:54,56` 嵌套 `{error:{code,msg}}`（其余在顶层）。后果：`utils/cloud.js:68` 判 `result.code === -401`，嵌套形状下为 undefined → 会话过期点导入**不跳登录** |
| 9 | `importProducts` 的 `xlsx` 依赖是全项目唯一额外依赖（04:24） | ✅ 确认 | `importProducts/package.json:8` `"xlsx": "^0.18.5"`；其余 4 个仅 `wx-server-sdk` |
| 10 | `price_id = 'PRC_'+Date.now()` 无随机后缀（04:174、04:510-514 M10） | ✅ 仍成立 | `updateProductPrice:103` |
| 11 | `expiry_date` 恒 null、0 读取点、价格永不过期（04:179、04:405、04:504-508 M9、08:459） | ✅ 仍成立，**本轮扩展** | `updateProductPrice:124`。同族死字段还有 `currency`（`:122` 恒 'CNY'）与 `updated_by`（`:126` 只写不读）——旧文档只点了 expiry_date/currency（04:132、08:638），漏了 `updated_by` |
| 12 | `getSuppliers` 的 `status` 参数绕过 `includeInactive` 守卫（04:394、04:430、04:454-459 M1、04:459-465 M2） | ✅ 仍成立，本轮独立复现并补了修法 | `getSuppliers:54` vs `:58`；见 §7.1 |
| 13 | `getSuppliers` keyword 正则注入（04:461-465 M2） | ✅ 仍成立 | `getSuppliers:61` `db.RegExp({regexp: keyword, options:'i'})` |
| 14 | `importProducts` 无文件大小/行数上限 + 逐条串行 add + 无事务（04:229、04:289、04:473-478 M4） | ✅ 仍成立 | `importProducts:99`、`:187-196`；目录无 `config.json` |
| 15 | `importProducts` 无外层 try/catch（04:305-313、04:467-471 M3） | ✅ **仍成立，本轮升级为 P1 并定位后果** | `importProducts:82-207` 无 try/catch → 异常冒泡到 `utils/cloud.js:72-74` → 「CloudBase 服务连接失败」，真实原因不可知。**旧文档只记了「无 try/catch」这个事实，没点出「用户看到连接失败」这个可诊断性后果** |
| 16 | `importProducts` 供应商匹配不到 → error 但商品仍插入，错误与成功同时发生（04:266） | ✅ 仍成立，**本轮升级为 P0 链路的一环** | `importProducts:163-171` → 见 §6.3 路径 B |
| 17 | `importProducts` 判重不含 status，停用商品挡住新导入，与 saveProduct 口径不一致（04:280、04:608-610 L18） | ✅ 仍成立 | `importProducts:125`；`saveProduct` 完全不去重（`dataService:118-128`） |
| 18 | `product_id` 随机后缀长度不一致（04:612-614 L19） | ✅ 仍成立 | `importProducts:172`(4 字节) vs `dataService:125`(3 字节) |
| 19 | `importProducts` 全量商品 skip+limit(100) 循环，1 万条=100 次串行查询（04:293） | ✅ 仍成立，**本轮补了「多一次空查询」缺陷** | `importProducts:116-124`（§2.5） |
| 20 | 模板 7 列 × 全部别名逐字吻合（08:310-322 §5.1） | ✅ 仍成立 | `product-import-template.md:9-16` ↔ `importProducts:11-19` |
| 21 | 模板规则 7 项 6✓1✗：模板说前 10 条，代码取 50 条（08:333-340 §5.3、08:640 L-6） | ✅ 仍成立 | `importProducts:204` 取 50，`product-manage.js:145` 取 10 |
| 22 | 模板示例行「叶菜类」「禽类」在种子分类不存在且一级/二级错位（08:342-345、08:588-592 M-9） | ✅ **仍成立，本轮量化后果** | `seed-data/category.json` 12 个二级分类确无「叶菜类/禽类」；示例一级分类「蔬菜/肉禽」也非 `category_level_1_name`（实际是「后厨/前厅」）→ **照抄示例 100% 失败**。旧文档只记了「不一致」，没写出「示例不可用」 |
| 23 | 分类匹配歧义未消除，`candidates[0]` 可能挂错一级分类（04:516-521 M11） | ✅ 仍成立，**本轮补充第二种歧义** | `importProducts:146-152`：①l1Name 为空时重名静默取第一个；②**l1Name 填了但不匹配时静默降级不报错**（§3 第 7 条）——旧文档只记了第一种 |
| 24 | `supplier-manage` 联系人搜索架构上不可达（05:230-234 M1） | ✅ 仍成立 | `supplier-manage.js:30-33` 搜 `contactName`，`getSuppliers:60-62` 只按 `supplier_name` 匹配 |
| 25 | `price-manage.js` 重复组合：前端基于 allPrices 查重，后端不查重靠事务降版（05:144） | ✅ 仍成立，**本轮点出连带后果** | `price-manage.js:204-205`。基于**被 `limit(200)` 截断的** allPrices 查重 → 价格表 >200 条时误判「不存在」引导重复定价（后端事务不会崩，但会多出价格行） |
| 26 | `supplier_product_price.(supplier_id,product_id)` 无索引（08:606 M-12） | ✅ 仍成立 | `seed-data/README.md:35-37` 只有建议，无实际索引 |
| 27 | `price-manage.applyFilter` 原地 sort 污染 allPrices（05:149 M8） | ✅ 仍成立 | `price-manage.js:76,88` |
| 28 | 前端 updatedBy 基本无效，后端优先 user.user_id（05:151 L6） | ✅ 仍成立 | `price-manage.js:133,214`；`updateProductPrice:126` |
| 29 | 价格 >2 位小数：前端 `.toFixed(2)` 与库里不一致（04:498-502 M8、04:176） | ✅ 仍成立 | `updateProductPrice:76-78` 不限制小数位；`supplier-prices.js:38` `(Number(item.price) || 0).toFixed(2)`。本轮补充：`price-manage.js:127,200` 用 `parseFloat` 校验但不限制小数位 → **库里可存 9.999，展示为 9.99/10.00，两边长期不一致** |
| 30 | `supplier` 角色访问 `getSuppliers` 显示假数据 `product_count:0`（05:236 L5） | ✅ 仍成立 | `getSuppliers:51` 硬编码 `product_count:0`，与 `:87-90` 真实计数不一致 |
| 31 | `getProducts` 完全无角色白名单，supplier 也能拉全量（04:413） | ✅ **仍成立，本轮确认并升级为 P2** | `getProducts:41-45` 只判登录；对照 `getProductPrices:48,51` 有双重门禁、`getSuppliers:45` 有 supplier 分支 |
| 32 | `categoryId` 转 Number 未校验，NaN 进 where（04:432） | ✅ 仍成立 | `getProducts:50`；对照 `getSuppliers:58` 有三重判空 |
| 33 | `supplier` 分支不做 status 过滤（04:393、04:563-565 L8） | ✅ 仍成立，**本轮确认为有意设计** | `getSuppliers:45-51`：供应商能看到自己被停用后的档案，合理 |
| 34 | `product_count` 反查无 status 过滤 → 停用商品也计入（04:395、04:567-569 L9） | ✅ 仍成立 | `getSuppliers:70-84` `where({default_supplier_id: _.in(idChunk)})` 无 status 条件 |
| 35 | 6 个云函数鉴权矩阵：dataService/importProducts 用 helper 式，其余 4 个内联式；两套写法并存是根因（04:323-332） | ✅ 仍成立 | helper 式 = 嵌套错误返回的根因；本轮升级为 P1（§2.2、§11 P1-7） |
| 36 | 嵌套错误如何到达客户端：`requireUser` 返回 `{error:{code:-401}}` → `utils/cloud.js:68` 只判顶层 code → 不跳登录（04:336-350、04:440-444 H1、08:262-273 P0 4.4） | ✅ **仍成立，本轮定位全部落点** | `dataService:47-49` 统一出口覆盖 **22 个 action**（非旧文档所述「约 20」）+ `authService:336,337` 账号管理分支 + `importProducts:54,56`。**旧文档 B22 的「影响面」判断正确但计数偏低** |
| 37 | -403 同样被吞：无权限操作显示「商品保存失败」而非「无权执行」（04:364） | ✅ 仍成立 | `dataService:49` 嵌套 + `product-manage.js:216` `result.msg \|\| '商品保存失败'` |
| 38 | 种子数据缺口：未覆盖缺价(#11)、多供应商同商品（08:692） | ✅ 仍成立，**本轮量化** | `seed-data/supplier_product_price.json` 12 条全是「一商品一供应商一条 current」；无 `default_supplier_id=''` 样本 → **§6.3 路径 B 在 seed 数据下完全不可复现，测试无法覆盖** |
| 39 | 5 个列表接口硬编码 limit，管理页无分页无总数无截断提示（05:347-352 H5） | ✅ 仍成立 | `getProducts:53`(200)、`getSuppliers:67`(100)、`getProductPrices:60`(200)、`product-manage.js:23-26` 无 onPullDownRefresh/onReachBottom/loading |
| 40 | 全项目 0 处裸 `where().get()`；importProducts:120 用 `skip(offset).limit(BATCH)` 是正确姿势（08:351-354） | ✅ 仍成立，**本轮补充其缺陷** | `importProducts:120` 确实用了分页，但无排序键 → 期间有写入时可能重复/漏读（§9）。旧文档评「正确姿势」偏乐观 |
| 41 | README 云函数一览表漏 `getProducts`/`getSuppliers`/`importProducts`（16/19）（08:54、08:649 L-15） | ✅ 仍成立 | `seed-data/README.md`（本轮不读 README，遵「不信 README」纪律，仅记录旧文档已判定） |
| 42 | status 字段在 6 个集合语义完全不同，是最大跨集合字段名复用风险（08:189-196） | ✅ 仍成立，**本轮矩阵化验证** | §7 停用可见性矩阵逐格确认：product/supplier/store 的 `status` 均为整数 1/0，`supplier_product_price` 用 `is_current`，`order_status`/`receipt_status`/`report status`/`abnormal status` 各成体系。**当前代码逐集合手写条件，未踩坑** |
| 43 | 角色白名单常量 4 份重复定义，加/改角色需同步 5 处（08:573-576 M-6） | ✅ 仍成立 | `dataService:8,9,11`；`getProducts:44`、`getSuppliers:53`、`updateProductPrice:70`、`importProducts:8` 各一份内联字面量 |
| 44 | 已发生漂移 1 处：`generateSummaryReport:160` 多了 `store_manager`（05:281-291） | ✅ 仍成立 | 对照 `dataService:8` `GLOBAL_ROLES=['super_admin','purchaser']` vs `generateSummaryReport:160` `['store_manager','purchaser','super_admin']`。**这是「停用门店店长仍能出汇总报表」(§7 矩阵第 12 行) 的根因** |

### 10.2 旧【待核实】回收表（12 项已回收）

| # | 待核实项（出处） | 本次判定 | 依据 |
|---|---|---|---|
| 1 | Excel 解析是否做公式拦截 | ✅ **已回收**：不做，但 `cellText` 的 `trim()` 在源头闭合了前导空白绕过，路径 B 当前不可利用；风险是防线隐式（§2.2） | `importProducts:61-64` |
| 2 | 导入是否走事务/是否回滚 | ✅ **已回收**：不走事务，不回滚，逐行串行 `add`（§2.4） | `importProducts:187-196` |
| 3 | 导入行数上限（B11） | ✅ **已回收**：无上限，且该目录无 `config.json`，超时/内存走默认值（默认值本身【待核实】保留） | 目录仅 `index.js` + `package.json` |
| 4 | 多条价格记录下单取哪条 | ✅ **已回收**：下单不查价格表，供应商取自 `product.default_supplier_id`（§4.2） | `createPurchaseOrder:250`、`:327-338` |
| 5 | `is_current` 切换是否原子（B38 后半） | ✅ **已回收**：原子，`runTransaction` 内完成（§5） | `updateProductPrice:106-131` |
| 6 | `supplier_id + product_id` 是否有唯一约束（B38 前半） | ✅ **已回收**：无数据库约束，仅靠事务保证「单 current」；`price_id` 生成有毫秒碰撞风险（§4.1） | `updateProductPrice:103`、`:106-131` |
| 7 | 停用商品能否下单 | ✅ **已回收**：不能（§7.3） | `createPurchaseOrder:219`、`:243` |
| 8 | 供应商能否看到别家报价（横向比价） | ✅ **已回收**：不能，服务端强制 `supplier_id`（§8.2） | `getProductPrices:46-49` |
| 9 | `expiry_date` 是否有语义（B7） | ✅ **已回收**：无，死字段（§5） | `updateProductPrice:124` 恒写 null，无任何读取点 |
| 10 | `getProducts` 截断的实际影响：商品目录当前规模是否逼近 200（B1） | ✅ **已回收**：seed 仅 12 条，短期不逼近；但**关键词搜索在 200 条后失效是确定缺陷**，与规模无关 | `seed-data/product.json` 12 条；`getProducts:53,56-59` |
| 11 | `receipt.missing_reports` 是否有 UI 消费点（B12） | ✅ **已回收**：有写入点（`createReceipt:706`、`dataService:1019-1020`、`:1268-1269`），有清除点（`dataService:1019-1020`、`:1268-1269` 补生成后清标记）。**「全项目无清除点」的旧判断不成立** | `dataService:1019-1020` `update({data:{missing_reports:false,...}})` |
| 12 | 导入是否绕过价格维护流程（本轮任务背景问题） | ✅ **已回收**：不绕过。`importProducts` 只写 `product`，完全不触及 `supplier_product_price`；且**已存在的商品连 `default_supplier_id` 都不会改**（§2.7） | `importProducts:191` 是唯一写入点 |

### 10.3 旧结论纠错（本轮判定旧文档有误，以代码为准）

| # | 旧结论 | 纠错 | 证据 |
|---|---|---|---|
| 1 | **B37**：`dataService:552` `order_status:event.status` 无枚举校验，构造 `status:'received'` 可跳过整个收货流程 | ❌ **不成立**。`dataService:485` 有 `if (!['approved','rejected'].includes(event.status)) return {code:-1,...}` 前置校验，非枚举值根本到不了 `:552`。旧文档的「写入侧唯一缺口」判断错误 | `dataService:485`、`:499`、`:552` |
| 2 | **B16/B17**：`getPurchaseOrders` 的 `role`/`createdBy` 是死参数 | ❌ **不属本域**，且旧文档自相矛盾（`05:447` 说 role 是死参数，`05:448` 又说前端 `user.name` 兜底是错误匹配隐患）——本轮不复核该文件 | — |
| 3 | 派单背景描述「前端在 report-list 调 dataService 现算实时报表」（08:597-601） | ❌ **描述错误**（旧文档已自知更正）。report-list 全程只调 `getReports`/`generateSummaryReport`，实时报表路径实际在供应商门户 | 08:597-601 |
| 4 | B14：`where({$or:[...]})` 字面量是否被 SDK 识别 | ⚠️ **保留【待核实】**，本轮未实测（仓库无 `node_modules`）。若 SDK 不识别 → 退化为查询文档中真的存在 `$or` 字段 → 匹配 0 条 → 催审对所有订单静默失效 | `dataService:1414-1417`；全项目 grep `$or` 仅 1 处命中（其余 15+ 处用 `_.or([...])`） |
| 5 | B15：`transaction.rollback(data)` 参数是否进入 `err.errMsg` | ⚠️ **保留【待核实】**，需实测。功能不受影响（仍能拦住重复审核），仅影响用户看到的文案 | `dataService:539`、`:561` |

### 10.4 保留【待核实】项

| # | 事项 | 原因 |
|---|---|---|
| 1 | SCF 默认超时/内存值（`importProducts` 无 `config.json`） | 仓库内无配置文件可查，需控制台核实 |
| 2 | `​` 等零宽字符是否能绕过 `trim()` + `csvField` 双防线 | 需实际用 Excel/WPS 打开注入样本验证 |
| 3 | `report_file.excluded_rows` 是否被任何页面读取并提示 | 本轮未读 `getReports`/`getReportDetail`（属 R5 边界） |
| 4 | 云数据库实际索引配置（`product_name`/`supplier_id+product_id` 是否有唯一索引） | 仓库内无 schema/索引定义文件，需控制台核实 |
| 5 | `where({$or:[...]})` 字面量是否被 SDK 识别（旧 B14） | 仓库无 `node_modules`，无法离线验证 SDK 行为；若识别失败则催审功能静默失效 |
| 6 | `transaction.rollback(data)` 参数语义（旧 B15） | 需实测，仅影响错误文案 |
| 7 | `created_at` 回读形态（Date 对象 vs ISO 字符串，旧 B40） | 影响 `getSupplierOrders:116` 的 `String(...).localeCompare` 排序是否跨年错序；本轮未读该文件（属 R3 边界） |
| 8 | `seed-data/README.md:35-37` 的索引建议是否曾落地 | 仓库内无索引定义文件，只能查控制台 |

## 11. 新问题清单（P0/P1/P2）

### P0（资金/数据正确性，必须修）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 1 | **空供应商商品收货 0 价漏账且无追踪** | `createReceipt:350`、`:366` | `supplierId` 为空时既不查价也不标 `isMissingPrice` → 无异常单、无提醒、不进任何带价账单（④⑥）；仅以「验收状态=正常/异常类型=空/是否可付款=否」出现在 ③，并以 `0.00` 计入 ⑦ 的 `item_count`。`importProducts:164-168` 是主要来源 |
| 2 | **取价 `limit(100)` 截断 → 假缺价 + 真实应付被剔除，且无法自愈** | `createReceipt:342-346`、`dataService:1053-1059` | where 不含 `supplier_id`，20 商品 × 多供应商易超 100 行；被截断组合落 0 价 → 误报 `missing_price` 异常，且从带价账单剔除本应付金额。**放大点**：管理员按 `missing_price` 提示去 `repriceReceipt`（`dataService:1035-1103`）补价时，`:1055-1059` 用**同样的 where + limit(100)**，同样的组合仍查不到 → 返回「仍未找到协议价：…」，**管理员永远修不好这批异常，除非先解决 100 行门槛**——「误报 + 不可自愈」闭环。旧文档（04:486-490 M6）只记了截断本身，未点出补价路径同样被截断。修法：where 增加 `supplier_id: _.in(...)` 或按商品逐块查 |

### P1（权限/可用性/一致性）

| # | 问题 | 位置 |
|---|---|---|
| 3 | **供应商停用不阻断下单**，与 `supplier-manage.js:99` 的用户承诺相悖 | `createPurchaseOrder:250`、`:333` 不查 supplier 状态 |
| 4 | **`getSuppliers` 守卫可被 `status` 参数绕过**，chef 可取停用供应商全量档案（含手机号/地址） | `getSuppliers:54` vs `:58` |
| 5 | **`getProducts` 关键词搜索在 200 条后失效**（先 limit 后 filter） | `getProducts:53` 先 `limit(200)`，`:56-59` 再内存过滤 |
| 6 | **`importProducts` 无行数/体积上限、无事务、逐行串行 `add`、超时残留无提示**，中断后用户无法得知哪些行已入库 | `importProducts:99`、`:187-196`；目录无 `config.json` |
| 7 | **`importProducts` 嵌套 error 形状导致会话过期不跳登录**；同型缺陷波及 `dataService` **全部 22 个 action** + `authService` 账号管理分支 | `importProducts:54,56`、`dataService:47-49`、`authService:336,337`、`utils/cloud.js:68` |
| 8 | **`getSuppliers` keyword 正则注入**（未转义入 `db.RegExp`），可致 DoS/通用错误 | `getSuppliers:61` |
| 9 | **`importProducts` 无外层 `try/catch`（全仓库唯一）**，任何异常冒泡到 `cloud.js:72-74` 被翻译成「CloudBase 服务连接失败」，真实原因不可知、无日志 | `importProducts:82-207` |
| 10 | **模板示例 100% 必然导入失败**（示例分类在种子里不存在、一级分类名称与编码错位） | `product-import-template.md:20-23` vs `seed-data/category.json`、`importProducts:146-152` |

### P2（语义/体验/一致性）

| # | 问题 | 位置 |
|---|---|---|
| 9 | 导入模板与代码 5 处不符（见 §3），其中「默认供应商不存在仅提示但商品仍插入成功」造成 `failed` 计数混入已成功行 | `importProducts:167-171`、`product-import-template.md:16` |
| 10 | 模板未声明「导入不建价格」，而导入是零价路径 B 的主要来源 | `product-import-template.md:25-31` |
| 11 | `importProducts` 无二级分类重名报错，静默取 `candidates[0]` | `importProducts:146-152` |
| 12 | `total` 计数含被跳过的空行，`total ≠ inserted + failed` | `importProducts:139` vs `:201` |
| 13 | `errors` 三级截断（服务端 50 / 前端 10 / 无导出通道），失败清单不可完整获取 | `importProducts:204`、`product-manage.js:145` |
| 14 | `price_id = 'PRC_' + Date.now()` 毫秒碰撞，无唯一索引兜底；同仓库其他 ID 均带随机后缀 | `updateProductPrice:103` |
| 15 | `updateProductPrice` 新价等于旧价仍建历史行；旧行不清 `expiry_date` | `updateProductPrice:103-130` |
| 16 | `expiry_date`/`effective_date` 为死字段，价格永不自失效 | `updateProductPrice:124`，无读取点 |
| 17 | `countInflightOrders` 系统性偏大（不校验行级收货状态）+ `limit(1000)` 截断，提示文案「将按新价结算」在偏大场景下为错误承诺 | `updateProductPrice:43-64` |
| 18 | `dataService.regenerateReceiptReports` 的 `itemAbnormalTypes` 漏 `missing_price`，补生成报表时该行「异常类型」列空白（与 `createReceipt.getItemAbnormalTypes` 漂移） | `dataService:1142-1148` vs `createReceipt:59-67` |
| 19 | `getSuppliers` 对非供应商角色全量展开 supplier 文档（含 `contact_phone`/`address`），与已修的订单头裁剪口径不一致 | `getSuppliers:87-90`、`utils/cloud.js:187-199` |
| 20 | `getSuppliers` 供应商自查分支硬编码 `product_count: 0`，与真实计数不一致 | `getSuppliers:51` |
| 21 | `getProductPrices` 单页 `limit(200)`，报价超 200 条的供应商静默少显示，无翻页 | `getProductPrices:60` |
| 22 | `getProductPrices` 的 `onlyCurrent` 为可选，云函数不为 supplier 分支强制 `is_current` | `getProductPrices:55` |
| 23 | 停用门店仍可生成汇总报表（`generateSummaryReport` 未查 store 状态） | `generateSummaryReport:178` |
| 24 | 三个管理页硬编码 `includeInactive:true`，非管理员深链进页 → 空态 + toast（影响 3 页而非 2 页） | `product-manage.js:31,33`、`price-manage.js:34,35`、`supplier-manage.js:22-24` |
| 25 | `importProducts` 判重键不含 `status`，停用商品参与判重 → 无法通过导入重建 | `importProducts:125` |
| 26 | `importProducts` 判重无并发锁，两个 purchaser 同时导入同名商品会重复入库；`dataService.saveProduct` 完全无判重 | `importProducts:116-125`、`dataService:118-128` |
| 27 | `product_id` 生成随机熵不一致（导入 4 字节 vs UI 3 字节） | `importProducts:172` vs `dataService:125` |
| 28 | `imports/products/` 下的临时 xlsx 永不清理，云存储缓慢堆积 | `product-manage.js:136-140`；对比 `dataService:1484-1489` 有清理 |
| 29 | `updateProductPrice:87-89` 日期格式校验在等值校验之后，属冗余死代码 | `updateProductPrice:83` vs `:87-89` |
| 30 | 公式注入防线为 `cellText` 的隐式 `trim()`，无注释声明其为安全边界；路径 A（`remark`）写入侧零校验 | `importProducts:63` vs `createPurchaseOrder:288`、`:336` |
| 31 | **`getProducts` 完全无角色白名单**，supplier 也能拉全量商品（`getProductPrices`/`getSuppliers` 都有门禁，唯独这个没有） | `getProducts:41-45` |
| 32 | **`getProducts:50` `Number(categoryId)` 无校验**，非法串 → NaN 直接进 where | `getProducts:50`；对照 `getSuppliers:58` 有三重判空 |
| 33 | **模板示例分类与种子不符、一级分类名称与编码错位 → 照抄示例必然全失败** | `product-import-template.md:20-23` vs `seed-data/category.json` |
| 34 | **导入对表头无容错**：内部空白/全角括号/大小写/繁简/英文别名全部不识别；一级分类填错静默降级不报错 | `importProducts:11-19`、`:73`、`:148-152` |
| 35 | **`supplier-manage.js:32` 联系人搜索不可达**：前端搜 `contactName`，后端 `keyword` 只作用于 `supplier_name` | `supplier-manage.js:30-33`、`getSuppliers:60-62` |
| 36 | **`price-manage.js:88` 原地 `sort` 污染 `allPrices`**，且去重判定（`:204`）基于被截断的 allPrices → 价格表 >200 条时误判「不存在」引导重复定价（后端事务不会崩但会多出价格行） | `price-manage.js:88`、`:204-205` |
| 37 | **`supplier_product_price.(supplier_id,product_id)` 无唯一索引**，唯一性仅靠事务保证（seed-data/README.md 已记录该建议但从未落地） | `seed-data/README.md:35-37` |
| 38 | **`dataService.auditOrder` 的 `event.status` 有枚举校验**，故「构造 status 跳过收货流程」的担忧不成立（记录为已排除） | `dataService:485` |
| 39 | **`missing_price` 字典在 `getReportDetail` 缺失**（commit `3558678` 只补了 `dataService`），报表详情页显示裸英文 type | `getReportDetail:12-16` |
| 40 | **`expiry_date`/`currency`/`updated_by` 是「只写不读」死字段**（本轮除 expiry_date 外新增 currency 与 updated_by） | `updateProductPrice:122`、`:124`、`:126` |
| 41 | **`importProducts` add 失败时行号用 `'-'` 占位** → 前端渲染「第-行」 | `importProducts:194`、`product-manage.js:145` |
| 42 | **`saveSupplier` 名称查重不含 status** → 停用供应商的名称空间仍被占用，无法新建同名供应商 | `dataService:155-158`；对照 `saveProduct` 根本不去重 |
| 43 | **`product-manage` 无分页/无下拉刷新/无触底加载/无 loading 态**；三个管理页均硬编码 `includeInactive:true` | `product-manage.js:23-26` |

## 12. 遗留【待核实】

见 §10.4，共 **8 项**：SCF 默认超时/内存、零宽字符绕过可行性、`excluded_rows` 消费方、云数据库实际索引配置、`$or` 字面量 SDK 识别、`transaction.rollback(data)` 参数语义、`created_at` 回读形态、`seed-data/README.md` 索引建议是否落地。

**已回收的旧【待核实】共 12 项**，见 §10.2。**已纠错的旧结论 3 项 + 保留不判定的 2 项**，见 §10.3。

## 13. 任务背景更正（2 处）

1. **本报告 §0/§11 的 P0-1（空供应商 0 价漏账）与派单背景里的「路径 B」无关**。派单描述的路径 B 是 Excel 公式注入路径，本轮已确认它**不可利用**（§2.2）。本轮真正的新 P0 是「导入产出的 `default_supplier_id:''` 商品在收货时静默 0 价」，属零价溯源链（§6.3），与注入无关。两个问题都被归在「导入」名下，容易混淆，特此厘清。
2. **旧文档 08:597-601 已自知更正过一处任务背景描述错误**（「前端在 report-list 调 dataService 派单实时报表」与代码不符），本轮沿用其更正：report-list 全程只调 `getReports`/`generateSummaryReport`，实时报表路径在供应商门户。本轮未再读 `report-list`，遵「不重复劳动」纪律。

---

### 附：正面结论（明确记录「不存在」的问题，避免下轮重复勘探）

1. **横向比价泄露不存在**：`getProductPrices:46-49` 服务端强制覆盖 `supplier_id`，供应商无法通过改参数看别家报价。
2. **停用商品下单漏洞不存在**：`createPurchaseOrder:219` + `:243` 服务端强制（前端 `purchase-create.js:129-131` 也过滤）。
3. **凭据泄漏不存在**：`supplier` 集合无 password/token/盐值字段（`seed-data/supplier.json` 仅 8 个字段）。
4. **导入绕过价格维护改价不存在**：`importProducts` 只写 `product`（`:191` 唯一写入点），完全不触及 `supplier_product_price`；且已存在的商品连 `default_supplier_id` 都不会改。
5. **`is_current` 双 current 不存在**：`updateProductPrice:106-131` 事务化（事务内先降版再 insert）。
6. **`updated_by` 可伪造不存在**：服务端身份优先，客户端值仅末位兜底（`updateProductPrice:126`）。
7. **公式注入路径 B 当前不可利用**：`cellText` 的 `trim()` 在源头闭合了前导空白绕过（但防线隐式无注释，见 P2-30；`​` 零宽字符能否绕过保留【待核实】）。
8. **路径 A 与路径 B 汇入同一批报表**：8 种 `report_type`（`store_order_report`/`supplier_order_report`/`store_receipt_report`/`store_receipt_price_report`/`supplier_receipt_report`/`supplier_receipt_price_report`/`store_daily_summary_report`/`store_monthly_summary_report`）全部经同一份 `csvField`；全仓库 CSV sink 穷举仅 4 处（`createPurchaseOrder`/`createReceipt`/`dataService`/`generateSummaryReport`），`getReportDetail`/`getReports` 不生成 CSV。
9. **`event.status` 伪造跳过收货流程不成立**（本轮纠错旧 B37）：`dataService:485` 有枚举校验。
10. **供应商自查分支参数处理正确**：`getSuppliers:45-51` 强制忽略 `status`/`keyword`/`includeInactive`，按 `supplier_id` 精确查。
11. **`category_level_2_id` 类型一致**：seed 用整数（`seed-data/category.json`），`importProducts:175` 写整数，`getProducts:50` `Number(categoryId)`，`dataService.findCategory:85` `Number(categoryId)`，四处一致。
12. **入库前的固定开销与判重键设计自洽**：`importProducts:116-124` 的全表扫描虽然低效，但其判重键 `product_name|manufacturer_name` 与 seed 数据的 `manufacturer_name` 默认值「默认」一致，无类型错位。
