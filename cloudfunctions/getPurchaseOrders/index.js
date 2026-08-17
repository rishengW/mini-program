// 云函数 getPurchaseOrders - 获取采购单列表（按角色+门店过滤）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { role, storeId, orderStatus, orderDate, createdBy, page = 1, pageSize = 20 } = event || {}
    const _ = db.command
    let query = {}

    // 角色权限过滤
    if (role === 'chef') {
      // 下单人员：只看本店+自己创建的
      if (storeId) query.store_id = storeId
      if (createdBy) query.created_by = createdBy
    } else if (role === 'store_manager') {
      // 店长：看本店全部
      if (storeId) query.store_id = storeId
    }
    // purchaser/admin: 不加门店限制

    if (orderStatus) query.order_status = orderStatus
    if (orderDate) query.order_date = orderDate

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
    const creatorIds = [...new Set(res.data.map(order => order.created_by).filter(Boolean))]
    const creatorMap = {}
    if (creatorIds.length) {
      const creators = await db.collection('app_user').where({ user_id: _.in(creatorIds) }).limit(100).get()
      creators.data.forEach(user => { creatorMap[user.user_id] = user.name })
    }
    const orders = res.data.map(order => ({
      ...order,
      created_by_name: order.created_by_name || creatorMap[order.created_by] || order.created_by,
      items: itemGroups[order.purchase_order_id] || []
    }))

    return { code: 0, data: orders, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getPurchaseOrders] 采购订单加载失败:', err)
    return { code: -1, msg: '采购订单加载失败，请稍后重试' }
  }
}
