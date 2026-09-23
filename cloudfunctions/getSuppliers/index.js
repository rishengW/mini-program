// 云函数 getSuppliers - 获取供应商列表
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

    const { status, keyword, includeInactive } = event
    // 供货商角色只能看到自己的档案，不能遍历其他供货商的联系方式
    if (user.role === 'supplier') {
      if (!user.default_supplier_id) return { code: -403, msg: '账号未关联供货商，请联系管理员' }
      const mineRes = await db.collection('supplier')
        .where({ supplier_id: user.default_supplier_id })
        .limit(1)
        .get()
      return { code: 0, data: mineRes.data.map(item => ({ ...item, product_count: 0 })) }
    }
    const isManager = ['super_admin', 'purchaser'].includes(user.role)
    if (includeInactive && !isManager) return { code: -403, msg: '当前账号无权查看停用供应商' }
    const _ = db.command
    let query = {}

    if (status !== undefined && status !== null && status !== '') query.status = status
    else if (!includeInactive || !isManager) query.status = 1
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
      for (let i = 0; i < ids.length; i += 20) {
        const idChunk = ids.slice(i, i + 20)
        const products = await db.collection('product')
          .where({ default_supplier_id: _.in(idChunk) })
          .limit(1000)
          .get()
        products.data.forEach(product => {
          productCountMap[product.default_supplier_id] = (productCountMap[product.default_supplier_id] || 0) + 1
        })
      }
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
