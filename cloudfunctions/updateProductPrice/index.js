// 云函数 updateProductPrice - 更新供应商商品价格
// 修复：接入服务端鉴权（仅采购员/超管）+ effective_date 兜底改用东八区日期
const cloud = require('wx-server-sdk')
const { requireUser } = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  // 入口先鉴权：仅采购员/超管可改价
  const auth = await requireUser(event, ['purchaser', 'super_admin'])
  if (auth.error) return auth.error
  const user = auth.user

  try {
    const { supplierId, productId, newPrice, effectiveDate } = event
    const updatedBy = user.name || user.username || 'system'

    if (!supplierId || !productId || newPrice === undefined) {
      return { code: -1, msg: '缺少必要参数(supplierId, productId, newPrice)' }
    }
    const numericPrice = Number(newPrice)
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return { code: -1, msg: '价格必须是大于0的数字' }
    }
    // 生效日期缺省值按 UTC+8 取，避免凌晨 0-8 点落到前一天
    const priceDate = effectiveDate || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const parsedDate = new Date(`${priceDate}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(priceDate)) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== String(priceDate)) {
      return { code: -1, msg: '生效日期格式无效' }
    }
    const [supplierRes, productRes] = await Promise.all([
      db.collection('supplier').where({ supplier_id: supplierId, status: 1 }).limit(1).get(),
      db.collection('product').where({ product_id: productId, status: 1 }).limit(1).get()
    ])
    if (!supplierRes.data.length) return { code: -1, msg: '供应商不存在或已停用' }
    if (!productRes.data.length) return { code: -1, msg: '商品不存在或已停用' }

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
