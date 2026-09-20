// 云函数 getPurchaseOrders - 获取采购单列表（按角色+门店过滤）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    const { role, storeId, orderStatus, orderDate, createdBy } = event || {}
    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 20)))
    const _ = db.command
    let query = {}

    // 角色权限过滤
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (user.role === 'chef') {
      // 下单人员：只看本店+自己创建的
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      query.store_id = user.default_store_id
      query.created_by = user.user_id || user._id
    } else if (user.role === 'store_manager') {
      // 店长：看本店全部
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      query.store_id = user.default_store_id
    } else if (isGlobal) {
      // 管理员/采购员可按门店、创建人筛选
      if (storeId) query.store_id = storeId
      if (createdBy) query.created_by = createdBy
    } else {
      return { code: -403, msg: '当前账号无权查看采购订单' }
    }

    if (orderStatus) query.order_status = orderStatus
    if (orderDate) query.order_date = orderDate

    // 各状态数量用于前端筛选 tab：在角色约束的基准条件上统计，不受当前 orderStatus 过滤影响
    const baseQuery = { ...query }
    delete baseQuery.order_status
    const [allRes, draftRes, submittedRes, receivedRes, abnormalRes, cancelledRes, partialRes] = await Promise.all([
      db.collection('purchase_order').where(baseQuery).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'draft' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'submitted' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'received' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'receipt_abnormal' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'cancelled' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'partial_received' }).count()
    ])
    const statusCounts = {
      all: allRes.total,
      draft: draftRes.total,
      submitted: submittedRes.total,
      received: receivedRes.total,
      receiptAbnormal: abnormalRes.total,
      cancelled: cancelledRes.total,
      partialReceived: partialRes.total
    }

    const countRes = await db.collection('purchase_order').where(query).count()
    const res = await db.collection('purchase_order')
      .where(query)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    // 批量查询订单明细，避免订单越多时产生逐单数据库请求。
    const orderIds = res.data.map(order => order.purchase_order_id)
    const itemGroups = {}
    for (let i = 0; i < orderIds.length; i += 20) {
      const idChunk = orderIds.slice(i, i + 20)
      const itemsRes = await db.collection('purchase_order_item')
        .where({ purchase_order_id: _.in(idChunk) })
        .limit(1000)
        .get()
      itemsRes.data.forEach(item => {
        if (!itemGroups[item.purchase_order_id]) itemGroups[item.purchase_order_id] = []
        itemGroups[item.purchase_order_id].push(item)
      })
    }
    const creatorMap = {}
    const creatorIds = [...new Set(res.data.map(order => order.created_by).filter(Boolean))]
    for (let i = 0; i < creatorIds.length; i += 20) {
      const idChunk = creatorIds.slice(i, i + 20)
      const creators = await db.collection('app_user').where({ user_id: _.in(idChunk) }).limit(100).get()
      creators.data.forEach(user => { creatorMap[user.user_id] = user.name })
    }
    const orders = res.data.map(order => ({
      ...order,
      created_by_name: order.created_by_name || creatorMap[order.created_by] || order.created_by,
      items: itemGroups[order.purchase_order_id] || []
    }))

    return { code: 0, data: orders, total: countRes.total, page, pageSize, statusCounts }
  } catch (err) {
    console.error('[getPurchaseOrders] 采购订单加载失败:', err)
    return { code: -1, msg: '采购订单加载失败，请稍后重试' }
  }
}
