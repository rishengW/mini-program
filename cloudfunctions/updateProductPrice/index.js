// 云函数 updateProductPrice - 更新供应商商品价格
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { supplierId, productId, newPrice, effectiveDate, updatedBy } = event

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
        effective_date: effectiveDate || new Date().toISOString().slice(0, 10),
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
