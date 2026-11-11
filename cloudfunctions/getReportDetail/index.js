// 云函数 getReportDetail - 获取报表详情（含行数据）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// （hashToken 本地副本已删除——见下方 shared/session require）
// report_id 反解收货单号（shared/receipt-reports 统一副本，2026-11-11 详情口径修复用）
const { receiptIdFromReportId } = require('./shared/receipt-reports')

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货',
  missing_price: '缺价待补'
}

function getAbnormalTypeNames(item = {}) {
  const types = []
  if (item.is_shortage) types.push('shortage')
  if (item.is_quality_issue) types.push('quality')
  if (item.is_wrong_item) types.push('wrong_item')
  // receipt_item 不落 is_missing_price（收货时仅打异常台账），按收货时同条件推导：
  // 非手动 && 快照 0 价 && 有供应商 && 实收>0
  //（与 shared/receipt-reports 的 adaptReceiptItem 同口径；补价后快照刷新即自然消失，
  //  与 CSV 侧构建器口径一致——此前缺此行，缺价行页面显示「正常」而 CSV 显示「缺价待补」）
  if (!item.is_manual && Number(item.price_snapshot || 0) <= 0 && item.supplier_id && Number(item.received_qty) > 0) {
    types.push('missing_price')
  }
  return types.map(type => ABNORMAL_TYPE_NAMES[type] || type)
}

// 会话校验收敛到跨函数共享模块（2026-11-05 解耦第 3 项；源头 scripts/cloud-shared/session.js，
// 由 scripts/sync-shared.js 同步副本，勿再恢复本地副本——F1 就是 19 份副本各自漂移的教训）
const { hashToken, getSessionUser } = require('./shared/session')

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { reportId } = event || {}
    if (!reportId) return { code: -1, msg: '缺少reportId' }

    // 查报表元数据
    const reportRes = await db.collection('report_file')
      .where({ report_id: reportId })
      .limit(1)
      .get()

    if (reportRes.data.length === 0) {
      return { code: -1, msg: '报表不存在' }
    }

    const report = reportRes.data[0]
    // 已替代版本不再展开明细：行数据是按当前原始单据实时重算的，
    // 与旧版 CSV 快照口径不同，展示出来会与下载文件对不上
    if (report.status === 'superseded') {
      return { code: -1, msg: '该报表已被新版本替代，请在报表列表查看最新版本' }
    }
    // 2026-11-10 拍板：chef 不再有报表入口，后端直接拒绝
    if (user.role === 'chef') return { code: -403, msg: '当前账号无权查看报表' }
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (user.role !== 'store_manager') return { code: -403, msg: '当前账号无权查看报表' }
      if (report.report_scope !== 'store' || report.scope_id !== user.default_store_id) return { code: -403, msg: '无权查看其他门店报表' }
    }
    let rows = []

    // 根据报表类型，从原始数据重新构建行数据
    const type = report.report_type
    const orderId = report.source_order_id

    if (type === 'store_order_report' && orderId) {
      // 门店下单报表：从采购单明细中获取
      const itemsRes = await db.collection('purchase_order_item')
        .where({ purchase_order_id: orderId })
        .limit(1000)
        .get()
      rows = itemsRes.data.map(item => ({
        productName: item.product_name_snapshot,
        category: item.category_snapshot,
        unit: item.unit_snapshot,
        orderQty: item.order_qty,
        isManual: item.is_manual,
        remark: item.remark || ''
      }))
    } else if (type === 'store_receipt_report' || type === 'store_receipt_price_report') {
      // 门店收货报表：报表按收货批次生成（report_id = RPT_SR_<receiptId> 或 RPT_SRP_<receiptId>，
      // 补生成版带 _RG 后缀）。分批收货时一张订单有多张 receipt，
      // 必须从 report_id 反解出本批 receiptId 精确查询——
      // 若按 purchase_order_id + limit(1) 取，会取到第一批，导致第 2、3 批的报表页面
      // 显示错误批次、页面合计与下载的 CSV 对不上。
      const reportIdParts = String(report.report_id || '')
      // 剥离 RPT_SR_ / RPT_SRP_ 前缀与 _RG 后缀，得到本批 receiptId
      const receiptId = reportIdParts
        .replace(/^RPT_SRP?_/, '')
        .replace(/_RG$/, '')
      let receiptIdFilter
      if (/^RCP\d+/.test(receiptId)) {
        // 正常解析：RCP + 时间戳 + 随机 hex
        receiptIdFilter = { receipt_id: receiptId }
      } else {
        // 兜底：report_id 格式异常时按订单取，但必须守住来源单号——
        // orderId 为空时 where 条件会退化成宽松查询，可能命中其他门店的收货单
        if (!orderId) return { code: -1, msg: '报表来源单据信息缺失，无法展开明细' }
        receiptIdFilter = { purchase_order_id: orderId }
      }
      const receiptRes = await db.collection('receipt')
        .where(receiptIdFilter)
        .limit(1)
        .get()
      if (receiptRes.data.length > 0) {
        const receiptId = receiptRes.data[0].receipt_id
        const itemsRes = await db.collection('receipt_item')
          .where({ receipt_id: receiptId })
          .limit(1000)
          .get()
        rows = itemsRes.data.map(item => {
          const abnormalTypeNames = getAbnormalTypeNames(item)
          return {
            productName: item.product_name,
            orderQty: item.order_qty_snapshot,
            receivedQty: item.received_qty,
            unit: item.unit_snapshot,
            unitPrice: item.price_snapshot,
            // P2-62/P0-8：与 CSV 生成侧同为"逐行先舍入到分"，保证页面行小计与文件一致
            subtotal: Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100,
            payable: item.payable_flag,
            isManual: !!item.is_manual,
            abnormal: abnormalTypeNames.length > 0,
            abnormalTypeNames,
            abnormalText: abnormalTypeNames.join('、'),
            abnormalStatus: abnormalTypeNames.length > 0 ? '收货异常' : '正常',
            remark: item.remark || ''
          }
        })
      }
    } else if (type === 'supplier_order_report') {
      // 供应商订货汇总：按供应商scope_id筛选采购单明细。
      // 明细按 purchase_order_id 分块批量取回，不再逐单串行查询。
      const supplierId = report.scope_id
      const date = report.related_date
      const ordersRes = await db.collection('purchase_order')
        .where({ order_date: date })
        .limit(200)
        .get()
      const orderMap = {}
      ordersRes.data.forEach(order => { orderMap[order.purchase_order_id] = order })
      const orderIds = ordersRes.data.map(order => order.purchase_order_id)
      for (let i = 0; i < orderIds.length; i += 20) {
        const idChunk = orderIds.slice(i, i + 20)
        const itemsRes = await db.collection('purchase_order_item')
          .where({ purchase_order_id: _.in(idChunk), supplier_id: supplierId })
          .limit(1000)
          .get()
        itemsRes.data.forEach(item => {
          const order = orderMap[item.purchase_order_id]
          if (!order) return
          rows.push({
            purchaseOrderId: item.purchase_order_id,
            storeName: order.store_name,
            productName: item.product_name_snapshot,
            orderQty: item.order_qty,
            unit: item.unit_snapshot,
            remark: item.remark || ''
          })
        })
      }
    } else if (type === 'supplier_receipt_report' || type === 'supplier_receipt_price_report') {
      // 2026-11-11 详情口径修复：优先按 report_id 反解的收货单精确取本批/本波次明细，
      // 不再按「供应商+日期」聚合全部收货单——多波 _S 补结算后页面合计才与 CSV 一致。
      const supplierId = report.scope_id
      const receiptId = receiptIdFromReportId(report.report_id)
      const receiptMap = {}
      let receiptIds = []
      if (receiptId) {
        const one = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
        if (one.data[0]) {
          receiptMap[receiptId] = one.data[0]
          receiptIds = [receiptId]
        }
      }
      if (!receiptIds.length) {
        // 兜底：report_id 无法反解（历史/异常格式）时维持原「供应商+日期」口径
        const receiptsRes = await db.collection('receipt')
          .where({ receipt_date: report.related_date })
          .limit(200)
          .get()
        receiptsRes.data.forEach(r => { receiptMap[r.receipt_id] = r })
        receiptIds = receiptsRes.data.map(r => r.receipt_id)
      }
      for (let i = 0; i < receiptIds.length; i += 20) {
        const idChunk = receiptIds.slice(i, i + 20)
        const query = { receipt_id: _.in(idChunk), supplier_id: supplierId }
        // 多波补结算（_S）若带 settle_item_ids，只展示该波增量行，与补充账单 CSV 一致
        if (Array.isArray(report.settle_item_ids) && report.settle_item_ids.length) {
          query._id = _.in(report.settle_item_ids)
        }
        const itemsRes = await db.collection('receipt_item')
          .where(query)
          .limit(1000)
          .get()
        itemsRes.data.forEach(item => {
          const receipt = receiptMap[item.receipt_id]
          if (!receipt) return
          const abnormalTypeNames = getAbnormalTypeNames(item)
          rows.push({
            purchaseOrderId: receipt.purchase_order_id,
            storeName: receipt.store_name,
            productName: item.product_name,
            receivedQty: item.received_qty,
            orderQty: item.order_qty_snapshot,
            unit: item.unit_snapshot,
            unitPrice: item.price_snapshot,
            // P2-62/P0-8：与 CSV 生成侧同为"逐行先舍入到分"，保证页面行小计与文件一致
            subtotal: Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100,
            payable: item.payable_flag,
            isManual: !!item.is_manual,
            abnormal: abnormalTypeNames.length > 0,
            abnormalTypeNames,
            abnormalText: abnormalTypeNames.join('、'),
            abnormalStatus: abnormalTypeNames.length > 0 ? '收货异常' : '正常',
            remark: item.remark || ''
          })
        })
      }
    } else if (type === 'store_daily_summary_report' || type === 'store_monthly_summary_report') {
      // 日/月汇总：行数据已固化在生成的 CSV 文件里，下载后解析回结构化 rows。
      // CSV 字段由 generateSummaryReport 用双引号包裹（"" 转义），按 RFC 4180 解析。
      // 文件格式：第1行门店头，第2列表头，中间数据行，末行合计。
      if (report.file_url) {
        try {
          const dlRes = await cloud.downloadFile({ fileID: report.file_url })
          const text = dlRes.fileContent.toString('utf-8').replace(/^\uFEFF/, '')
          const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
          const parseLine = (line) => {
            const fields = []
            let cur = ''
            let inQuotes = false
            for (let i = 0; i < line.length; i++) {
              const ch = line[i]
              if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
                else if (ch === '"') inQuotes = false
                else cur += ch
              } else if (ch === '"') {
                inQuotes = true
              } else if (ch === ',') {
                fields.push(cur); cur = ''
              } else {
                cur += ch
              }
            }
            fields.push(cur)
            return fields
          }
          // 数据行从第3行（索引2）开始，末行为合计
          for (let i = 2; i < lines.length; i++) {
            if (!lines[i]) continue
            const f = parseLine(lines[i])
            if (f[0] === '合计') continue
            rows.push({
              productName: f[0],
              supplierName: f[1],
              category: f[2],
              unit: f[3],
              orderQty: Number(f[4]) || 0,
              receivedQty: Number(f[5]) || 0,
              subtotal: Number(f[6]) || 0
            })
          }
        } catch (err) {
          // 解析失败不能静默成"表头齐全的 ¥0.00 空表"，向上抛给外层返回错误
          console.error('[getReportDetail] 汇总报表文件解析失败:', err)
          throw new Error('汇总报表文件解析失败')
        }
      }
    }

    // 不下发 file_url（汇总报表的服务端解析已在上方用完 file_url）；
    // has_file 供前端判断是否展示下载入口，下载走 getReportFileUrl 按 reportId 鉴权
    const { file_url, ...safeReport } = report
    return { code: 0, data: { ...safeReport, rows, has_file: !!file_url } }
  } catch (err) {
    console.error('[getReportDetail] 报表详情查询失败:', err)
    return { code: -1, msg: '报表详情加载失败，请稍后重试' }
  }
}
