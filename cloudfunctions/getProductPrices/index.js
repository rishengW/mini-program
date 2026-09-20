// 云函数 getProductPrices - 获取供应商商品价格
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    if (!['super_admin', 'purchaser'].includes(user.role)) return { code: -403, msg: '当前账号无权查看供应商价格' }
    const { supplierId, productId, onlyCurrent } = event
    let query = {}

    if (supplierId) query.supplier_id = supplierId
    if (productId) query.product_id = productId
    if (onlyCurrent) query.is_current = 1

    const res = await db.collection('supplier_product_price')
      .where(query)
      .orderBy('effective_date', 'desc')
      .limit(200)
      .get()

    return { code: 0, data: res.data }
  } catch (err) {
    console.error('[getProductPrices] 价格查询失败:', err)
    return { code: -1, msg: '价格数据加载失败，请稍后重试' }
  }
}
