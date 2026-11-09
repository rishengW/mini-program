// 共享模块：收货报表 ③④⑤⑥ 统一构建器（2026-11-05 解耦第 4 项）。
// 源头：scripts/cloud-shared/receipt-reports.js —— sync-shared.js 同步副本，勿直接改副本。
//
// 使用方：createReceipt（收货时生成）与 dataService/settle.js（补生成 _RG）。
// 此前两处各写一份 CSV 拼接并已漂移：_RG 版漏 missing_price 文案（缺价行显示"正常"）、
// infoHead 少「下单日期/期望到货」两列、report_file 缺 abnormal_summary、shortage 文案
// 写成「短收」（原版口径「少货/缺货」）。统一以收货时输出为权威口径，_RG 通过
// idSuffix/fileTag/headNote/regenerated 参数保持其 _RG 后缀与补生成标记语义。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { csvField, safePathPart } = require('./csv-utils')
const { getNextVersion } = require('./report-version')

// 四类收货报表（取代/清理逻辑共用，2026-11-09 双计修复）。
const RECEIPT_REPORT_TYPES = [
  'store_receipt_report', 'store_receipt_price_report',
  'supplier_receipt_report', 'supplier_receipt_price_report'
]

// 从四类收货报表 report_id 反解收货单号：
//   RPT_SR_<receiptId> / RPT_SRP_<receiptId> / RPT_SUR_<sid>_<receiptId> / RPT_SURP_<sid>_<receiptId>
// 可能带 _RG / _S / _S2… 后缀。收货单号为 RCP+时间戳+随机hex（不含下划线），
// 剥掉已知后缀后取最后一段并要求以 RCP 开头——供应商 id 在它之前，
// 即使含 "RCP" 字样也不会被误匹配。无法解析返回空串。
function receiptIdFromReportId(reportId) {
  const stripped = String(reportId || '').replace(/(_RG|_S[0-9]*)$/, '')
  const parts = stripped.split('_')
  const last = parts[parts.length - 1]
  return /^RCP/.test(last) ? last : ''
}

// ===== 补结算报表 report_id 文法（settle.js 与 reportMaintenance 共用的单源，2026-11-09） =====
// 波次/后缀判定是双计修复的核心不变量，两处各写一份正则必然漂移（F1 的教训）。

// _S 波次账单（补结算增量）的报表类型
const SETTLE_REPORT_TYPE = 'supplier_receipt_price_report'

// report_id 是否为全量重出版（_RG 后缀）
function isFullVersionReport(reportId) {
  return /_RG$/.test(String(reportId || ''))
}

// row 是否为 _S 波次账单（⑥ 带价类型 + _S / _S2… 后缀）
function isSettleVersionReport(row) {
  return !!row && row.report_type === SETTLE_REPORT_TYPE && /_S[0-9]*$/.test(String(row.report_id || ''))
}

// 解析补结算波次：settle_wave 字段优先；历史 _S（无字段）从后缀解析，_S 即第 1 波。
// 非 _S 报表返回 0。
function settleWaveOfReport(report) {
  const n = Number(report && report.settle_wave)
  if (Number.isFinite(n) && n > 0) return n
  const match = /_S([0-9]+)?$/.exec(String((report && report.report_id) || ''))
  if (!match) return 0
  return match[1] ? Number(match[1]) : 1
}

// 报表生成时间毫秒数（缺/非法值为 0，参与「最新版本」比较时天然垫底）
function reportTimeMs(report) {
  const ts = new Date(report && report.generated_at).getTime()
  return Number.isFinite(ts) ? ts : 0
}

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货',
  // 缺价待补：_RG 旧版漏此文案导致缺价行显示"正常"（2026-11-05 对齐原版口径修复）
  missing_price: '缺价待补'
}

// 构建器入参 items 统一为驼峰内存格式（createReceipt 事务内的 items 直接可用）：
// { productName, supplierId, orderQty, receivedQty, unit, priceSnapshot, payableFlag,
//   isManual, isShortage, isQualityIssue, isWrongItem, isMissingPrice, remark }
function itemAbnormalNames(item) {
  const names = []
  if (item.isShortage) names.push(ABNORMAL_TYPE_NAMES.shortage)
  if (item.isQualityIssue) names.push(ABNORMAL_TYPE_NAMES.quality)
  if (item.isWrongItem) names.push(ABNORMAL_TYPE_NAMES.wrong_item)
  if (item.isMissingPrice) names.push(ABNORMAL_TYPE_NAMES.missing_price)
  return names
}

// DB receipt_item 行（蛇形）→ 构建器驼峰入参（补生成/reprice 路径用）。
// is_missing_price 不落库（收货时仅打异常台账），按收货时同条件重新推导
// （createReceipt：非手动 && 快照 0 价 && 有供应商 && 实收>0）；
// 补价（reprice）后 price_snapshot 已刷新 >0，推导自然为 false，与异常已关闭口径一致。
function adaptReceiptItem(row) {
  const receivedQty = Number(row.received_qty) || 0
  const priceSnapshot = Number(row.price_snapshot) || 0
  const isManual = !!row.is_manual
  return {
    productName: row.product_name,
    supplierId: row.supplier_id || '',
    orderQty: row.order_qty_snapshot,
    receivedQty,
    unit: row.unit_snapshot || '',
    priceSnapshot,
    payableFlag: row.payable_flag !== false,
    isManual,
    isShortage: !!row.is_shortage,
    isQualityIssue: !!row.is_quality_issue,
    isWrongItem: !!row.is_wrong_item,
    isMissingPrice: !isManual && priceSnapshot <= 0 && !!row.supplier_id && receivedQty > 0,
    remark: row.remark || ''
  }
}

// 生成并落库 ③④⑤⑥ 四类收货报表。
// opts:
//   receiptId/purchaseOrderId/storeId/storeName/receiptDate  单据锚点
//   orderDate/deliveryDate/receivedBy                        infoHead 展示（可为空串）
//   batchNo/isFinal                                          批次表头「第N批（收齐）」
//   items                                                    驼峰格式明细行（见 adaptReceiptItem）
//   idSuffix     '' 原版 | '_RG' 补生成（report_id 后缀）
//   fileTag      'v' 原版 | 'regen-v' 补生成（文件名中版本前缀）
//   headNote     '' 原版 | '报表失败后补生成'（非空时 infoHead 追加「备注」列）
//   regenerated  report_file.regenerated 标记（仅 true 时落该字段，与原版不落字段一致）
// 返回 { generated, hasAbnormal, abnormalTypeNames, files }
//   files: [{ _id, report_id, report_type, scope_id }]——取代逻辑按 _id 保留本次新写入的行
//   （_RG 的 report_id 每次重出相同，不能用 report_id 区分新旧版本）。
// 副作用注意：供应商名以 supplier 表当前名为准并写回入参 items（.supplierName），
// 与原版收货时行为一致（调用方在报表段之后不再使用 items）。
async function buildReceiptReports(opts) {
  const {
    receiptId, purchaseOrderId, storeId, storeName, receiptDate,
    orderDate = '', deliveryDate = '', receivedBy = '',
    batchNo = 1, isFinal = true,
    items,
    idSuffix = '', fileTag = 'v', headNote = '', regenerated = false
  } = opts

  // 批量查供应商名称（明细行供应商字段供各报表使用）
  const supplierNameMap = {}
  const allSupplierIds = [...new Set(items.map(item => item.supplierId).filter(Boolean))]
  for (let i = 0; i < allSupplierIds.length; i += 20) {
    const idChunk = allSupplierIds.slice(i, i + 20)
    const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    supRes.data.forEach(s => { supplierNameMap[s.supplier_id] = s.supplier_name })
  }
  items.forEach(item => { item.supplierName = supplierNameMap[item.supplierId] || item.supplierId || '' })

  // 单据信息头共用字段：订单号、门店、收货日期、下单日期、期望到货、经办人（+ 可选备注）
  const headPairs = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('下单日期'), csvField(orderDate), csvField('期望到货'), csvField(deliveryDate), csvField('验收人'), csvField(receivedBy || ''), csvField('批次'), csvField(`第${batchNo}批${isFinal ? '（收齐）' : ''}`)]
  if (headNote) headPairs.push(csvField('备注'), csvField(headNote))
  const infoHead = headPairs.join(',') + '\n'

  const hasAbnormal = items.some(item => itemAbnormalNames(item).length > 0)
  const abnormalTypeNames = [...new Set(items.reduce((all, item) => all.concat(itemAbnormalNames(item)), []))]

  const generated = []
  const files = []
  const regenField = regenerated ? { regenerated: true } : {}

  // ===== ③ 门店收货报表（不含价，全量行） =====
  const v1 = await getNextVersion('store_receipt_report', storeId, receiptDate)
  let csv1 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('下单数量'), csvField('实收数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注'), csvField('是否可付款')].join(',') + '\n'
  items.forEach(item => {
    const names = itemAbnormalNames(item)
    csv1 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(item.orderQty), csvField(item.receivedQty), csvField(item.unit), csvField(names.length ? '收货异常' : '正常'), csvField(names.join('、')), csvField(item.remark || ''), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
  })
  const f1 = `reports/store/${receiptDate}/store-receipt-${safePathPart(storeName)}-${receiptDate}-${receiptId}-${fileTag}${v1}.csv`
  const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
  const add1 = await db.collection('report_file').add({
    data: {
      report_id: 'RPT_SR_' + receiptId + idSuffix, report_type: 'store_receipt_report',
      receipt_id: receiptId,
      report_scope: 'store', scope_id: storeId, scope_name: storeName,
      related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
      file_name: f1, file_url: u1.fileID, file_version: v1,
      generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
      has_abnormal: hasAbnormal, abnormal_summary: abnormalTypeNames.join('、'),
      ...regenField
    }
  })
  generated.push('store_receipt_report')
  files.push({ _id: add1._id, report_id: 'RPT_SR_' + receiptId + idSuffix, report_type: 'store_receipt_report', scope_id: storeId })

  // 行级结算隔离（B4/B6）：异常只阻塞异常行，不阻塞正常商品。
  // 带价报表始终生成，但只包含可付款（payableFlag=true）的正常行；
  // 异常行的数量与异常类型记录在不含价的收货报表中，走异常流程跟进。
  // ===== ④ 门店带价格收货报表（仅可付款行） =====
  // 清单 #24 双保险：手动行不进带价报表（payableFlag 本就为 false，显式过滤防供应商建档后失效）
  const payableItems = items.filter(item => item.payableFlag && !item.isManual)
  if (payableItems.length > 0) {
    const v2 = await getNextVersion('store_receipt_price_report', storeId, receiptDate)
    let csv2 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('实收数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('是否可付款')].join(',') + '\n'
    let totalAmount = 0
    payableItems.forEach(item => {
      const price = item.priceSnapshot || 0
      // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
      const subtotal = Math.round(item.receivedQty * price * 100) / 100
      totalAmount = Math.round((totalAmount + subtotal) * 100) / 100
      csv2 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(subtotal.toFixed(2)), csvField('是')].join(',') + '\n'
    })
    csv2 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(totalAmount.toFixed(2)), csvField('')].join(',') + '\n'
    const f2 = `reports/store/${receiptDate}/store-receipt-price-${safePathPart(storeName)}-${receiptDate}-${receiptId}-${fileTag}${v2}.csv`
    const u2 = await cloud.uploadFile({ cloudPath: f2, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv2, 'utf-8') })
    const add2 = await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SRP_' + receiptId + idSuffix, report_type: 'store_receipt_price_report',
        receipt_id: receiptId,
        report_scope: 'store', scope_id: storeId, scope_name: storeName,
        related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
        file_name: f2, file_url: u2.fileID, file_version: v2,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
        has_abnormal: hasAbnormal, abnormal_summary: abnormalTypeNames.join('、'),
        excluded_rows: items.length - payableItems.length,
        ...regenField
      }
    })
    generated.push('store_receipt_price_report')
    files.push({ _id: add2._id, report_id: 'RPT_SRP_' + receiptId + idSuffix, report_type: 'store_receipt_price_report', scope_id: storeId })
  }

  // ===== 按供应商分组 =====
  const supplierMap = {}
  items.forEach(item => {
    const sid = item.supplierId || 'unknown'
    if (sid === 'unknown') return
    if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: supplierNameMap[sid] || sid }
    supplierMap[sid].items.push(item)
  })

  for (const sid of Object.keys(supplierMap)) {
    const sup = supplierMap[sid]
    const supName = sup.name || sid
    const supplierHasAbnormal = sup.items.some(item => itemAbnormalNames(item).length > 0)
    const supplierAbnormalSummary = [...new Set(sup.items.reduce((all, item) => all.concat(itemAbnormalNames(item)), []))].join('、')

    // ===== ⑤ 供应商到货汇总（不含价格） =====
    const v3 = await getNextVersion('supplier_receipt_report', sid, receiptDate)
    let csv3 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('下单数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注')].join(',') + '\n'
    sup.items.forEach(item => {
      const names = itemAbnormalNames(item)
      csv3 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(storeName), csvField(item.receivedQty), csvField(item.orderQty), csvField(item.unit), csvField(names.length ? '收货异常' : '正常'), csvField(names.join('、')), csvField(item.remark || '')].join(',') + '\n'
    })
    const f3 = `reports/supplier/${receiptDate}/supplier-receipt-${safePathPart(supName)}-${receiptDate}-${receiptId}-${fileTag}${v3}.csv`
    const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv3, 'utf-8') })
    const add3 = await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SUR_' + sid + '_' + receiptId + idSuffix, report_type: 'supplier_receipt_report',
        receipt_id: receiptId,
        report_scope: 'supplier', scope_id: sid, scope_name: supName,
        related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
        file_name: f3, file_url: u3.fileID, file_version: v3,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
        has_abnormal: supplierHasAbnormal, abnormal_summary: supplierAbnormalSummary,
        ...regenField
      }
    })
    generated.push('supplier_receipt_report:' + sid)
    files.push({ _id: add3._id, report_id: 'RPT_SUR_' + sid + '_' + receiptId + idSuffix, report_type: 'supplier_receipt_report', scope_id: sid })

    // ===== ⑥ 供应商带价格账单（仅可付款行，行级隔离） =====
    const supPayableItems = sup.items.filter(item => item.payableFlag && !item.isManual)
    if (supPayableItems.length === 0) continue
    const v4 = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)
    let csv4 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('可付款')].join(',') + '\n'
    let sTotal = 0
    supPayableItems.forEach(item => {
      const price = item.priceSnapshot || 0
      // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
      const sub = Math.round(item.receivedQty * price * 100) / 100
      sTotal = Math.round((sTotal + sub) * 100) / 100
      csv4 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(storeName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(sub.toFixed(2)), csvField('是')].join(',') + '\n'
    })
    csv4 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(''), csvField(sTotal.toFixed(2)), csvField('')].join(',') + '\n'

    const f4 = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(supName)}-${receiptDate}-${receiptId}-${fileTag}${v4}.csv`
    const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv4, 'utf-8') })
    const add4 = await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SURP_' + sid + '_' + receiptId + idSuffix, report_type: 'supplier_receipt_price_report',
        receipt_id: receiptId,
        report_scope: 'supplier', scope_id: sid, scope_name: supName,
        related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
        file_name: f4, file_url: u4.fileID, file_version: v4,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
        excluded_rows: sup.items.length - supPayableItems.length,
        ...regenField
      }
    })
    generated.push('supplier_receipt_price_report:' + sid)
    files.push({ _id: add4._id, report_id: 'RPT_SURP_' + sid + '_' + receiptId + idSuffix, report_type: 'supplier_receipt_price_report', scope_id: sid })
  }

  return { generated, hasAbnormal, abnormalTypeNames, files }
}

module.exports = {
  buildReceiptReports, adaptReceiptItem, itemAbnormalNames, ABNORMAL_TYPE_NAMES,
  RECEIPT_REPORT_TYPES, receiptIdFromReportId,
  SETTLE_REPORT_TYPE, isFullVersionReport, isSettleVersionReport, settleWaveOfReport, reportTimeMs
}
