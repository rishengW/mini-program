// 云函数 updateProductPrice - 更新供应商商品价格
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
    if (!['super_admin', 'purchaser'].includes(user.role)) return { code: -403, msg: '当前账号无权修改供应商价格' }
    const { supplierId, productId, newPrice, effectiveDate, updatedBy } = event

    if (!supplierId || !productId || newPrice === undefined) {
      return { code: -1, msg: '缺少必要参数(supplierId, productId, newPrice)' }
    }
    const numericPrice = Number(newPrice)
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return { code: -1, msg: '价格必须是大于0的数字' }
    }
    const priceDate = effectiveDate || new Date().toISOString().slice(0, 10)
    const parsedDate = new Date(`${priceDate}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(priceDate)) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== String(priceDate)) {
      return { code: -1, msg: '生效日期格式无效' }
    }
    const [supplierRes, productRes] = await Promise.all([
      db.collection('supplier').where({ supplier_id: supplierId }).limit(1).get(),
      db.collection('product').where({ product_id: productId }).limit(1).get()
    ])
    if (!supplierRes.data.length) return { code: -1, msg: '供应商不存在' }
    if (!productRes.data.length) return { code: -1, msg: '商品不存在' }

    const priceId = 'PRC_' + Date.now()
    // Switching the current price and inserting the replacement must be one
    // transaction, otherwise concurrent updates can leave two current rows.
    await db.runTransaction(async transaction => {
      const currentRes = await transaction.collection('supplier_product_price')
        .where({ supplier_id: supplierId, product_id: productId, is_current: 1 })
        .limit(100)
        .get()
      for (const current of currentRes.data) {
        await transaction.collection('supplier_product_price').doc(current._id).update({
          data: { is_current: 0, updated_at: db.serverDate() }
        })
      }
      await transaction.collection('supplier_product_price').add({
        data: {
          price_id: priceId,
          supplier_id: supplierId,
          product_id: productId,
          price: numericPrice,
          currency: 'CNY',
          effective_date: priceDate,
          expiry_date: null,
          is_current: 1,
          updated_by: user.user_id || user._id || updatedBy || 'system',
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
    })

    return { code: 0, data: { priceId, message: '价格已更新' } }
  } catch (err) {
    console.error('[updateProductPrice] 价格更新失败:', err)
    return { code: -1, msg: '价格更新失败，请稍后重试' }
  }
}
