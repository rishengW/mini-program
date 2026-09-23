// 云函数 getPurchaseOrders - 获取采购单列表（登录态鉴权 + 服务端角色/门店过滤）
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TO_RECEIVE_STATUS = ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive']
exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

    // 客户端传的 role/createdBy 一律忽略；storeId 仅对全局角色作为查询过滤条件
    const { storeId, orderStatus, orderStatusList, orderDate, page = 1, pageSize = 20 } = event || {}
    const _ = db.command

    const scope = auth.buildOrderScope(user)
    if (scope._no_access) {
      return {
        code: 0,
        data: [],
        total: 0,
        page,
        pageSize,
        statusCounts: { all: 0, draft: 0, submitted: 0, to_receive: 0, received: 0, receiptAbnormal: 0, cancelled: 0, partialReceived: 0 }
      }
    }

    // 基础条件 = 服务端角色范围（+ 全局角色可选门店过滤），统计与列表共用
    const baseQuery = { ...scope }
    if (auth.GLOBAL_ROLES.includes(user.role) && storeId) baseQuery.store_id = storeId

    // 状态筛选：orderStatusList 优先，其次单个 orderStatus
    const query = { ...baseQuery }
    if (Array.isArray(orderStatusList) && orderStatusList.length > 0) {
      query.order_status = _.in(orderStatusList)
    } else if (orderStatus) {
      query.order_status = orderStatus
    }
    if (orderDate) query.order_date = orderDate

    // 各状态数量用于前端筛选 tab：在角色约束的基准条件上统计，不受当前 orderStatus 过滤影响
    const [allRes, draftRes, submittedRes, toReceiveRes, receivedRes, abnormalRes, cancelledRes, partialRes] = await Promise.all([
      db.collection('purchase_order').where(baseQuery).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'draft' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'submitted' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: _.in(TO_RECEIVE_STATUS) }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'received' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'receipt_abnormal' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'cancelled' }).count(),
      db.collection('purchase_order').where({ ...baseQuery, order_status: 'partial_received' }).count()
    ])
    const statusCounts = {
      all: allRes.total,
      draft: draftRes.total,
      submitted: submittedRes.total,
      to_receive: toReceiveRes.total,
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
