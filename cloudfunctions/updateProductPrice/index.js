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

  try {
    const { supplierId, productId, newPrice, effectiveDate } = event
    const updatedBy = auth.user.name || auth.user.username || 'system'

    if (!supplierId || !productId || newPrice === undefined) {
      return { code: -1, msg: '缺少必要参数(supplierId, productId, newPrice)' }
    }

    // 将旧价格标记为非当前
    await db.collection('supplier_product_price')
      .where({ supplier_id: supplierId, product_id: productId, is_current: 1 })
      .update({ data: { is_current: 0, updated_at: db.serverDate() } })

    // 写入新价格
    const priceId = 'PRC_' + Date.now()
    await db.collection('supplier_product_price').add({
      data: {
        price_id: priceId,
        supplier_id: supplierId,
        product_id: productId,
        price: newPrice,
        currency: 'CNY',
        // 东八区当天，避免 UTC 日期差一天
        effective_date: effectiveDate || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
        expiry_date: null,
        is_current: 1,
        updated_by: updatedBy || 'system',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    return { code: 0, data: { priceId, message: '价格已更新' } }
  } catch (err) {
    console.error('[updateProductPrice] 价格更新失败:', err)
    return { code: -1, msg: '价格更新失败，请稍后重试' }
  }
}
