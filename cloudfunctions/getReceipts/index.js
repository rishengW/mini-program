// 云函数 getReceipts - 获取收货记录列表（登录态鉴权 + 服务端门店过滤）
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

    // 客户端传的 role 一律忽略；storeId 仅对全局角色作为查询过滤条件
    const { storeId, receiptDate, page = 1, pageSize = 20 } = event || {}

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

    // 查每个收货单的明细
    const receipts = []
    for (const receipt of res.data) {
      const itemsRes = await db.collection('receipt_item')
        .where({ receipt_id: receipt.receipt_id })
        .get()
      receipts.push({ ...receipt, items: itemsRes.data })
    }

    return { code: 0, data: receipts, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getReceipts] 收货记录加载失败:', err)
    return { code: -1, msg: '收货记录加载失败，请稍后重试' }
  }
}
