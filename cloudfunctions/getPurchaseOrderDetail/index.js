// 云函数 getPurchaseOrderDetail - 获取采购单详情
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

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

    // 门店角色只能看本店订单；厨师（下单人员）还只能看自己创建的订单
    if (auth.STORE_ROLES.includes(user.role)) {
      let allowed = !!user.default_store_id && order.store_id === user.default_store_id
      if (allowed && user.role === 'chef') {
        const identities = [user.user_id, user._id, user.name].filter(Boolean)
        allowed = identities.includes(order.created_by)
      }
      if (!allowed) return { code: -403, msg: '无权查看该订单' }
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
      .get()

    // 查关联收货记录
    const receiptRes = await db.collection('receipt')
      .where({ purchase_order_id: orderId })
      .get()

    // 查关联报表
    const reportRes = await db.collection('report_file')
      .where({ source_order_id: orderId })
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
