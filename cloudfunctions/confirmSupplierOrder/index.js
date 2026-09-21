// 云函数 confirmSupplierOrder - 供货商确认接单 / 标记发货
// 确认记录写在订单的 supplier_confirmations[supplier_id] 上，
// 一张订单可含多个供货商，各自独立确认，互不影响主状态流转。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 动作级状态白名单（S1 拍板）：确认接单仍限审批前；标记发货放宽到审批后（report_generated/to_receive），
// 因为按 B2"先审批后收货"，发货天然发生在内部审批之后。
// S8 追加：partial_received（部分收货中）也允许补标发货，剩余批次未到前供货商可维持发货标记。
const CONFIRMABLE_ORDER_STATUS = ['submitted', 'approved']
const SHIPPABLE_ORDER_STATUS = ['submitted', 'approved', 'report_generated', 'to_receive', 'partial_received']
const ACTION_STATUS = { confirm: 'confirmed', ship: 'shipped' }

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
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
    if (user.role !== 'supplier') return { code: -403, msg: '当前账号无权操作采购订单' }
    const supplierId = user.default_supplier_id
    if (!supplierId) return { code: -403, msg: '账号未关联供货商，请联系管理员' }

    const { orderId, action } = event || {}
    const status = ACTION_STATUS[action]
    if (!orderId) return { code: -1, msg: '订单信息缺失' }
    if (!status) return { code: -1, msg: '不支持的操作类型' }
    const allowedStatus = action === 'ship' ? SHIPPABLE_ORDER_STATUS : CONFIRMABLE_ORDER_STATUS

    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: orderId })
      .limit(1)
      .get()
    const order = orderRes.data[0]
    if (!order) return { code: -1, msg: '订单不存在' }
    if (!allowedStatus.includes(order.order_status)) {
      return { code: -1, msg: '订单当前状态不可操作（可能已收货或已作废）' }
    }

    // 该订单必须真的包含此供货商的商品，防止越权确认别人的订单
    const itemRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: orderId, supplier_id: supplierId })
      .limit(1)
      .get()
    if (!itemRes.data.length) return { code: -403, msg: '该订单不包含贵司供货的商品' }

    const confirmations = order.supplier_confirmations || {}
    const mine = confirmations[supplierId]
    if (mine && mine.status === status) {
      return { code: 0, data: { orderId, supplierId, status }, msg: '状态未变化' }
    }

    // 用点路径只更新自己的确认记录，避免覆盖同单其他供货商的状态
    const updateData = { updated_at: db.serverDate() }
    updateData[`supplier_confirmations.${supplierId}`] = {
      status,
      updated_at: db.serverDate(),
      updated_by: user.user_id || user._id
    }
    await db.collection('purchase_order').doc(order._id).update({ data: updateData })

    return { code: 0, data: { orderId, supplierId, status } }
  } catch (err) {
    console.error('[confirmSupplierOrder] 供货商确认操作失败:', err)
    return { code: -1, msg: '操作失败，请稍后重试' }
  }
}
