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
