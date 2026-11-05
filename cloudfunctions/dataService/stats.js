// 统计域（2026-11-05 拆分自 dataService/index.js）：首页状态计数。
const { db, _, requireUser, GLOBAL_ROLES } = require('./_shared')

// 首页统计：按状态做服务端聚合计数，避免前端拉全量订单再 filter（超 100 条即失真）
async function getOrderStats(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const baseQuery = {}
  // 角色口径与 getPurchaseOrders 保持一致
  if (auth.user.role === 'chef') {
    if (!auth.user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
    baseQuery.store_id = auth.user.default_store_id
    baseQuery.created_by = auth.user.user_id || auth.user._id
  } else if (auth.user.role === 'store_manager') {
    if (!auth.user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
    baseQuery.store_id = auth.user.default_store_id
  } else if (GLOBAL_ROLES.includes(auth.user.role)) {
    if (event.storeId) baseQuery.store_id = event.storeId
  } else {
    return { code: -403, msg: '当前账号无权查看采购订单' }
  }
  const receivableStatuses = ['approved', 'report_generated', 'partial_received']
  // 已完成与列表「已收货」tab 同口径（全部 received）；待核销子集单独出 to_verify 卡片
  const receivedQuery = { ...baseQuery, order_status: 'received' }
  const [submittedRes, receivableRes, receivedRes, toVerifyRes] = await Promise.all([
    db.collection('purchase_order').where({ ...baseQuery, order_status: 'submitted' }).count(),
    db.collection('purchase_order').where({ ...baseQuery, order_status: _.in(receivableStatuses) }).count(),
    db.collection('purchase_order').where(receivedQuery).count(),
    // 管理员待办：已收货待核销的手动单（仅全局角色需要）
    GLOBAL_ROLES.includes(auth.user.role)
      ? db.collection('purchase_order').where({ ...baseQuery, verify_status: 'pending' }).count()
      : Promise.resolve({ total: 0 })
  ])
  return {
    code: 0,
    data: {
      submitted: submittedRes.total,
      receivable: receivableRes.total,
      received: receivedRes.total,
      to_verify: toVerifyRes.total
    }
  }
}

module.exports = { getOrderStats }
