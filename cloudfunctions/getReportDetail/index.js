// 云函数 getReportDetail - 获取报表详情（含行数据）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货'
}

function getAbnormalTypeNames(item = {}) {
  const types = []
  if (item.is_shortage) types.push('shortage')
  if (item.is_quality_issue) types.push('quality')
  if (item.is_wrong_item) types.push('wrong_item')
  return types.map(type => ABNORMAL_TYPE_NAMES[type] || type)
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const result = await db.collection('app_user')
    .where({ session_token_hash: hashToken(authToken), status: 1 })
    .limit(1).get()
  const user = result.data[0]
  if (!user || !user.session_expires_at) return null
  const expiresAt = new Date(user.session_expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
}

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
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!['chef', 'store_manager'].includes(user.role)) return { code: -403, msg: '当前账号无权查看报表' }
      if (report.report_scope !== 'store' || report.scope_id !== user.default_store_id) return { code: -403, msg: '无权查看其他门店报表' }
      if (user.role === 'chef' && report.report_type !== 'store_order_report') return { code: -403, msg: '当前账号无权查看该报表类型' }
    }
    let rows = []

    // 根据报表类型，从原始数据重新构建行数据
    const type = report.report_type
    const orderId = report.source_order_id

    if (type === 'store_order_report' && orderId) {
      // 门店下单报表：从采购单明细中获取
      const itemsRes = await db.collection('purchase_order_item')
        .where({ purchase_order_id: orderId })
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
      // 门店收货报表：从收货明细中获取
      const receiptRes = await db.collection('receipt')
        .where({ purchase_order_id: orderId })
        .limit(1)
        .get()
      if (receiptRes.data.length > 0) {
        const receiptId = receiptRes.data[0].receipt_id
        const itemsRes = await db.collection('receipt_item')
          .where({ receipt_id: receiptId })
          .get()
        rows = itemsRes.data.map(item => {
          const abnormalTypeNames = getAbnormalTypeNames(item)
          return {
            productName: item.product_name,
            orderQty: item.order_qty_snapshot,
            receivedQty: item.received_qty,
            unit: item.unit_snapshot,
            unitPrice: item.price_snapshot,
            subtotal: (item.received_qty * item.price_snapshot).toFixed(2) * 1,
            payable: item.payable_flag,
            abnormal: abnormalTypeNames.length > 0,
            abnormalTypeNames,
            abnormalText: abnormalTypeNames.join('、'),
            abnormalStatus: abnormalTypeNames.length > 0 ? '收货异常' : '正常',
            remark: item.remark || ''
          }
        })
      }
    } else if (type === 'supplier_order_report') {
      // 供应商订货汇总：按供应商scope_id筛选采购单明细
      const supplierId = report.scope_id
      const date = report.related_date
      // 查询当天所有采购单
      const ordersRes = await db.collection('purchase_order')
        .where({ order_date: date })
        .get()
      for (const order of ordersRes.data) {
        const itemsRes = await db.collection('purchase_order_item')
          .where({ purchase_order_id: order.purchase_order_id, supplier_id: supplierId })
          .get()
        itemsRes.data.forEach(item => {
          rows.push({
            storeName: order.store_name,
            productName: item.product_name_snapshot,
            orderQty: item.order_qty,
            unit: item.unit_snapshot,
            remark: item.remark || ''
          })
        })
      }
    } else if (type === 'supplier_receipt_report' || type === 'supplier_receipt_price_report') {
      // 供应商到货/带价格账单：按供应商scope_id筛选收货明细
      const supplierId = report.scope_id
      const date = report.related_date
      const receiptsRes = await db.collection('receipt')
        .where({ receipt_date: date })
        .get()
      for (const receipt of receiptsRes.data) {
        const itemsRes = await db.collection('receipt_item')
          .where({ receipt_id: receipt.receipt_id })
          .get()
        // 需要关联采购明细获取供应商信息
        for (const item of itemsRes.data) {
          // 检查此商品是否属于该供应商
          const orderItemRes = await db.collection('purchase_order_item')
            .where({ item_id: item.purchase_order_item_id, supplier_id: supplierId })
            .limit(1)
            .get()
          if (orderItemRes.data.length > 0) {
            const abnormalTypeNames = getAbnormalTypeNames(item)
            rows.push({
              storeName: receipt.store_name,
              productName: item.product_name,
              receivedQty: item.received_qty,
              orderQty: item.order_qty_snapshot,
              unit: item.unit_snapshot,
              unitPrice: item.price_snapshot,
              subtotal: (item.received_qty * item.price_snapshot).toFixed(2) * 1,
              payable: item.payable_flag,
              abnormal: abnormalTypeNames.length > 0,
              abnormalTypeNames,
              abnormalText: abnormalTypeNames.join('、'),
              abnormalStatus: abnormalTypeNames.length > 0 ? '收货异常' : '正常',
              remark: item.remark || ''
            })
          }
        }
      }
    }

    return { code: 0, data: { ...report, rows } }
  } catch (err) {
    console.error('[getReportDetail] 报表详情查询失败:', err)
    return { code: -1, msg: '报表详情加载失败，请稍后重试' }
  }
}
