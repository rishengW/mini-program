// 云函数 getProducts - 查询商品列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { categoryL1, categoryId, keyword, includeInactive } = event
    const where = {}
    if (!includeInactive) where.status = 1
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
