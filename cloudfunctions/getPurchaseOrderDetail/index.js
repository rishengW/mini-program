// 云函数 getPurchaseOrderDetail - 获取采购单详情
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const result = await db.collection('app_user')
    .where({ session_token_hash: hashToken(authToken), status: 1 })
    .limit(1)
    .get()
  const user = result.data[0]
  if (!user || !user.session_expires_at) return null
  const expiresAt = new Date(user.session_expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { orderId } = event || {}
    if (!orderId) return { code: -1, msg: '订单信息缺失，请返回后重试' }

    // 查主表
    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: orderId })
      .limit(1)
      .get()

    if (orderRes.data.length === 0) {
      return { code: -1, msg: '订单不存在' }
    }

    const order = orderRes.data[0]
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!['chef', 'store_manager'].includes(user.role)) return { code: -403, msg: '当前账号无权查看采购订单' }
      if (!user.default_store_id || order.store_id !== user.default_store_id) {
        return { code: -403, msg: '无权查看其他门店订单' }
      }
      if (user.role === 'chef' && order.created_by !== (user.user_id || user._id)) {
        return { code: -403, msg: '无权查看其他人员创建的订单' }
      }
    }
    let createdByName = order.created_by_name || order.created_by || ''
    if (!order.created_by_name && order.created_by) {
      const userRes = await db.collection('app_user')
        .where({ user_id: order.created_by })
        .limit(1)
        .get()
      if (userRes.data.length) createdByName = userRes.data[0].name || createdByName
    }

    // 查明细
    const itemsRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: orderId })
      .limit(1000)
      .get()

    // 查关联收货记录
    const receiptRes = await db.collection('receipt')
      .where({ purchase_order_id: orderId })
      .limit(100)
      .get()

    // 查关联报表
    const reportRes = await db.collection('report_file')
      .where({ source_order_id: orderId })
      .limit(100)
      .get()

    return {
      code: 0,
      data: {
        ...order,
        created_by_name: createdByName,
        items: itemsRes.data,
        receipts: receiptRes.data,
        reports: reportRes.data
      }
    }
  } catch (err) {
    console.error('[getPurchaseOrderDetail] 采购订单详情加载失败:', err)
    return { code: -1, msg: '采购订单详情加载失败，请稍后重试' }
  }
}
