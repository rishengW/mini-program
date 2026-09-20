// 云函数 getSupplierOrders - 供货商视角的采购订单列表
// 只返回包含该供货商商品的订单，且每个订单只嵌入该供货商自己的明细，
// 防止泄漏同一张订单中其他供货商的商品信息。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 对供货商不可见的订单状态
const HIDDEN_ORDER_STATUS = ['draft', 'rejected']
// 已完结（含收货中异常），供货商视角统一视为"已完成"；
// partial_received 按 S8 拍板不算完成——分批收货中剩余批次可能未到，保留供货商已有确认状态
const DONE_ORDER_STATUS = ['received', 'receipt_abnormal', 'completed']

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

// 供货商视角的订单状态：pending 待确认 / confirmed 已确认 / shipped 已发货 / done 已收货 / cancelled 已作废
function deriveConfirmStatus(order, supplierId) {
  if (DONE_ORDER_STATUS.includes(order.order_status)) return 'done'
  if (order.order_status === 'cancelled') return 'cancelled'
  const confirmations = order.supplier_confirmations || {}
  const mine = confirmations[supplierId]
  return (mine && mine.status) || 'pending'
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (user.role !== 'supplier') return { code: -403, msg: '当前账号无权查看供货商订单' }
    const supplierId = user.default_supplier_id
    if (!supplierId) return { code: -403, msg: '账号未关联供货商，请联系管理员' }

    const { confirmStatus, orderDate } = event || {}
    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 20)))

    // 1. 查出该供货商的所有订单明细，得到关联订单号集合
    const itemQuery = { supplier_id: supplierId }
    const itemsRes = await db.collection('purchase_order_item')
      .where(itemQuery)
      .limit(1000)
      .get()
    const myItems = itemsRes.data
    if (!myItems.length) {
      return {
        code: 0,
        data: [],
        total: 0,
        page,
        pageSize,
        statusCounts: { all: 0, pending: 0, confirmed: 0, shipped: 0, done: 0, cancelled: 0 }
      }
    }
    const orderIds = [...new Set(myItems.map(item => item.purchase_order_id))]

    // 2. 批量取订单主表（in 查询每次最多 20 个），排除草稿/已驳回
    const orders = []
    for (let i = 0; i < orderIds.length; i += 20) {
      const idChunk = orderIds.slice(i, i + 20)
      const ordersRes = await db.collection('purchase_order')
        .where({ purchase_order_id: _.in(idChunk) })
        .limit(100)
        .get()
      orders.push(...ordersRes.data)
    }
    let visible = orders.filter(order => !HIDDEN_ORDER_STATUS.includes(order.order_status))
    if (orderDate) visible = visible.filter(order => order.order_date === orderDate)

    // 3. 计算供货商视角状态并按需过滤；统计在全量可见订单上做，不受当前 tab 过滤影响
    visible.forEach(order => {
      order.my_confirm_status = deriveConfirmStatus(order, supplierId)
    })
    const statusCounts = { all: visible.length, pending: 0, confirmed: 0, shipped: 0, done: 0, cancelled: 0 }
    visible.forEach(order => {
      if (statusCounts[order.my_confirm_status] !== undefined) statusCounts[order.my_confirm_status] += 1
    })
    let filtered = visible
    if (confirmStatus && confirmStatus !== 'all') {
      filtered = visible.filter(order => order.my_confirm_status === confirmStatus)
    }

    // 4. 排序 + 内存分页（单个供货商的订单量级可控）
    filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    const total = filtered.length
    const pageOrders = filtered.slice((page - 1) * pageSize, page * pageSize)

    // 5. 只嵌入该供货商自己的明细
    const itemsByOrder = {}
    myItems.forEach(item => {
      if (!itemsByOrder[item.purchase_order_id]) itemsByOrder[item.purchase_order_id] = []
      itemsByOrder[item.purchase_order_id].push(item)
    })
    const data = pageOrders.map(order => ({
      ...order,
      items: itemsByOrder[order.purchase_order_id] || []
    }))

    return { code: 0, data, total, page, pageSize, statusCounts }
  } catch (err) {
    console.error('[getSupplierOrders] 供货商订单加载失败:', err)
    return { code: -1, msg: '订单数据加载失败，请稍后重试' }
  }
}
