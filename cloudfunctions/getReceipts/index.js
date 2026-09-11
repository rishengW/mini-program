// 云函数 getReceipts - 获取收货记录列表（登录态鉴权 + 服务端门店过滤）
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event, ['super_admin', 'purchaser', 'store_manager', 'chef'])
    if (check.error) return check.error
    const user = check.user

    // 客户端传的 role 一律忽略；storeId 仅对全局角色作为查询过滤条件
    const { storeId, receiptDate, page = 1, pageSize = 20 } = event || {}

    if (user.role === 'chef') {
      // 下单人员不看收货记录
      return { code: 0, data: [], total: 0, page, pageSize }
    }

    const scope = auth.buildStoreScope(user)
    if (scope._no_access) {
      return { code: 0, data: [], total: 0, page, pageSize }
    }

    const query = { ...scope }
    if (auth.GLOBAL_ROLES.includes(user.role) && storeId) query.store_id = storeId
    if (receiptDate) query.receipt_date = receiptDate

    const countRes = await db.collection('receipt').where(query).count()
    const res = await db.collection('receipt')
      .where(query)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    // 明细批量查询，避免每张收货单一次数据库请求
    const receiptIds = res.data.map(r => r.receipt_id)
    const itemGroups = {}
    for (let i = 0; i < receiptIds.length; i += 20) {
      const idChunk = receiptIds.slice(i, i + 20)
      const itemsRes = await db.collection('receipt_item')
        .where({ receipt_id: _.in(idChunk) })
        .limit(1000)
        .get()
      itemsRes.data.forEach(item => {
        if (!itemGroups[item.receipt_id]) itemGroups[item.receipt_id] = []
        itemGroups[item.receipt_id].push(item)
      })
    }
    const receipts = res.data.map(receipt => ({ ...receipt, items: itemGroups[receipt.receipt_id] || [] }))

    return { code: 0, data: receipts, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getReceipts] 收货记录加载失败:', err)
    return { code: -1, msg: '收货记录加载失败，请稍后重试' }
  }
}
