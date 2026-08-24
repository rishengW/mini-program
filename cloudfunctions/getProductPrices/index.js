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
