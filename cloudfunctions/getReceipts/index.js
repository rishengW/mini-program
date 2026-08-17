// 云函数 getReceipts - 获取收货记录列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { role, storeId, receiptDate, page = 1, pageSize = 20 } = event || {}
    let query = {}

    // 角色权限
    if (role === 'chef') {
      // 下单人员不看收货记录
      return { code: 0, data: [], total: 0 }
    } else if (role === 'store_manager') {
      if (storeId) query.store_id = storeId
    }
    // purchaser/admin: 不限

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
