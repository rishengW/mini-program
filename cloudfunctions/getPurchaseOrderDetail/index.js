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

    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!['chef', 'store_manager'].includes(user.role)) return { code: -403, msg: '当前账号无权查看采购订单' }
      if (!user.default_store_id || order.store_id !== user.default_store_id) {
        return { code: -403, msg: '无权查看其他门店订单' }
      }
      if (user.role === 'chef') {
        // 历史数据 created_by 可能存 user_id / _id / 姓名，三者兼容
        const identities = [user.user_id, user._id, user.name].filter(Boolean)
        if (!identities.includes(order.created_by)) {
          return { code: -403, msg: '无权查看其他人员创建的订单' }
        }
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

    // 查关联报表。chef 只能看到本店维度的报表记录，
    // 供应商级报表元数据（含供应商名称）不下发
    const reportRes = await db.collection('report_file')
      .where({ source_order_id: orderId })
      .limit(100)
      .get()
    const reports = user.role === 'chef'
      ? reportRes.data.filter(r => r.report_scope === 'store')
      : reportRes.data

    return {
      code: 0,
      data: {
        ...order,
        created_by_name: createdByName,
        items: itemsRes.data,
        receipts: receiptRes.data,
        reports
      }
    }
  } catch (err) {
    console.error('[getPurchaseOrderDetail] 采购订单详情加载失败:', err)
    return { code: -1, msg: '采购订单详情加载失败，请稍后重试' }
  }
}
