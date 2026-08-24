// 云函数 getReceipts - 获取收货记录列表
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const result = await db.collection('app_user')
    .where({ session_token_hash: hashToken(authToken), status: 1 })
    .limit(1)
    .get()
  const user = result.data[0]
  if (!user || !user.session_expires_at) return null
  const expiresAt = new Date(user.session_expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { role, storeId, receiptDate } = event || {}
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 20)))
    let query = {}

    // 角色权限
    if (user.role === 'chef') {
      // 下单人员不看收货记录
      return { code: 0, data: [], total: 0 }
    } else if (user.role === 'store_manager') {
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      query.store_id = user.default_store_id
    } else if (!['super_admin', 'purchaser'].includes(user.role)) {
      return { code: -403, msg: '当前账号无权查看收货记录' }
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
        .limit(1000)
        .get()
      receipts.push({ ...receipt, items: itemsRes.data })
    }

    return { code: 0, data: receipts, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getReceipts] 收货记录加载失败:', err)
    return { code: -1, msg: '收货记录加载失败，请稍后重试' }
  }
}
