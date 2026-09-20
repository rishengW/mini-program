// 云函数 getProducts - 查询商品列表
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
    const { categoryL1, categoryId, keyword, includeInactive } = event
    const isManager = ['super_admin', 'purchaser'].includes(user.role)
    if (includeInactive && !isManager) return { code: -403, msg: '当前账号无权查看停用商品' }
    const where = {}
    if (!includeInactive || !isManager) where.status = 1
    if (categoryL1) where.category_level_1 = categoryL1
    if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
      where.category_level_2_id = Number(categoryId)
    }

    const res = await db.collection('product').where(where).orderBy('product_name', 'asc').limit(200).get()
    let list = res.data

    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter(p => String(p.product_name || '').toLowerCase().includes(kw))
    }

    return { code: 0, data: list }
  } catch (err) {
    console.error('[getProducts] 商品查询失败:', err)
    return { code: -1, msg: '商品数据加载失败，请稍后重试' }
  }
}
