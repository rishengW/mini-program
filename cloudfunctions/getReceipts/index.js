// 云函数 getReceipts - 获取收货记录列表
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { role, storeId, receiptDate } = event || {}
    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
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
