// 云函数 getSuppliers - 获取供应商列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { status, keyword, includeInactive } = event
    const _ = db.command
    let query = {}

    if (status !== undefined && status !== null && status !== '') query.status = status
    else if (!includeInactive) query.status = 1
    if (keyword) {
      query.supplier_name = db.RegExp({ regexp: keyword, options: 'i' })
    }

    const res = await db.collection('supplier')
      .where(query)
      .orderBy('supplier_name', 'asc')
      .limit(100)
      .get()

    const suppliers = res.data
    const ids = suppliers.map(item => item.supplier_id).filter(Boolean)
    const productCountMap = {}
    if (ids.length) {
      const products = await db.collection('product')
        .where({ default_supplier_id: _.in(ids) })
        .limit(1000)
        .get()
      products.data.forEach(product => {
        productCountMap[product.default_supplier_id] = (productCountMap[product.default_supplier_id] || 0) + 1
      })
    }
    return {
      code: 0,
      data: suppliers.map(item => ({
        ...item,
        product_count: productCountMap[item.supplier_id] || 0
      }))
    }
  } catch (err) {
    console.error('[getSuppliers] 供应商查询失败:', err)
    return { code: -1, msg: '供应商数据加载失败，请稍后重试' }
  }
}
