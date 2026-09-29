// 云函数 getReportDetail - 获取报表详情（含行数据）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  const tokenHash = hashToken(authToken)
  // B12 多设备会话：先查 sessions 数组（每设备一条），兼容旧单会话字段
  const result = await db.collection('app_user')
    .where({ status: 1, sessions: { token_hash: tokenHash } })
    .limit(1)
    .get()
  let user = result.data[0]
  if (!user) {
    const legacy = await db.collection('app_user')
      .where({ session_token_hash: tokenHash, status: 1 })
      .limit(1)
      .get()
    user = legacy.data[0]
  }
  if (!user) return null
  if (Array.isArray(user.sessions) && user.sessions.length) {
    const session = user.sessions.find(s => s && s.token_hash === tokenHash)
    if (!session || !session.expires_at) return null
    const expiresAt = new Date(session.expires_at).getTime()
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
  }
  if (!user.session_expires_at) return null
  const legacyExpires = new Date(user.session_expires_at).getTime()
  return Number.isFinite(legacyExpires) && legacyExpires > Date.now() ? user : null
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
      // 门店收货报表：从收货明细中获取
      const receiptRes = await db.collection('receipt')
        .where({ purchase_order_id: orderId })
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
      // 供应商到货/带价格账单：收货明细本身已存 supplier_id（createReceipt 写入时从订单明细带过来），
      // 直接按供应商过滤，不再逐行回查 purchase_order_item（原来是 收货单数×明细数 级别的串行查询）。
      const supplierId = report.scope_id
      const date = report.related_date
      const receiptsRes = await db.collection('receipt')
        .where({ receipt_date: date })
        .limit(200)
        .get()
      const receiptMap = {}
      receiptsRes.data.forEach(receipt => { receiptMap[receipt.receipt_id] = receipt })
      const receiptIds = receiptsRes.data.map(receipt => receipt.receipt_id)
      for (let i = 0; i < receiptIds.length; i += 20) {
        const idChunk = receiptIds.slice(i, i + 20)
        const itemsRes = await db.collection('receipt_item')
          .where({ receipt_id: _.in(idChunk), supplier_id: supplierId })
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
            subtotal: (item.received_qty * item.price_snapshot).toFixed(2) * 1,
            payable: item.payable_flag,
            abnormal: abnormalTypeNames.length > 0,
            abnormalTypeNames,
            abnormalText: abnormalTypeNames.join('、'),
            abnormalStatus: abnormalTypeNames.length > 0 ? '收货异常' : '正常',
            remark: item.remark || ''
          })
        })
      }
    }

    return { code: 0, data: { ...report, rows } }
  } catch (err) {
    console.error('[getReportDetail] 报表详情查询失败:', err)
    return { code: -1, msg: '报表详情加载失败，请稍后重试' }
  }
}
