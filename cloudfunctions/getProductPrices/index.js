// 云函数 getProductPrices - 获取供应商商品价格
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event, ['super_admin', 'purchaser'])
    if (check.error) return check.error

    const { supplierId, productId, onlyCurrent } = event
    let query = {}

    if (user.role === 'supplier') {
      // 供货商只能看自己名下的协议价，忽略前端传入的 supplierId
      if (!user.default_supplier_id) return { code: -403, msg: '账号未关联供货商，请联系管理员' }
      query.supplier_id = user.default_supplier_id
    } else {
      if (!['super_admin', 'purchaser'].includes(user.role)) return { code: -403, msg: '当前账号无权查看供应商价格' }
      if (supplierId) query.supplier_id = supplierId
    }
    if (productId) query.product_id = productId
    if (onlyCurrent) query.is_current = 1

    const res = await db.collection('supplier_product_price')
      .where(query)
      .orderBy('effective_date', 'desc')
      .limit(200)
      .get()

    // 价格表只有 product_id，补商品名称和单位，便于前端直接展示
    const productIds = [...new Set(res.data.map(item => item.product_id).filter(Boolean))]
    const productMap = {}
    const _ = db.command
    for (let i = 0; i < productIds.length; i += 20) {
      const idChunk = productIds.slice(i, i + 20)
      const productsRes = await db.collection('product')
        .where({ product_id: _.in(idChunk) })
        .limit(100)
        .get()
      productsRes.data.forEach(product => { productMap[product.product_id] = product })
    }
    const data = res.data.map(item => {
      const product = productMap[item.product_id] || {}
      return {
        ...item,
        product_name: product.product_name || product.name || item.product_id,
        unit: product.unit || ''
      }
    })

    return { code: 0, data }
  } catch (err) {
    console.error('[getProductPrices] 价格查询失败:', err)
    return { code: -1, msg: '价格数据加载失败，请稍后重试' }
  }
}
