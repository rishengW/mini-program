// 档案域（2026-11-05 拆分自 dataService/index.js）：分类查询、商品/供应商档案维护。
const { crypto, db, _, requireUser, MANAGEMENT_ROLES } = require('./_shared')

async function getCategories(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const result = await db.collection('category')
    .where({ status: 1 })
    .orderBy('sort_no', 'asc')
    .limit(100)
    .get()

  const level1Map = {}
  const categories = result.data.map(item => {
    if (!level1Map[item.category_level_1]) {
      level1Map[item.category_level_1] = {
        id: item.category_level_1,
        name: item.category_level_1_name,
        icon: item.category_level_1_icon || ''
      }
    }
    return {
      id: item.category_id,
      categoryL1: item.category_level_1,
      name: item.category_name,
      sortNo: item.sort_no || 0,
      icon: item.icon || ''
    }
  })
  return { code: 0, data: { level1: Object.values(level1Map), categories } }
}

async function findCategory(categoryId) {
  const result = await db.collection('category')
    .where({ category_id: Number(categoryId), status: 1 })
    .limit(1)
    .get()
  return result.data[0] || null
}

async function saveProduct(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error
  const name = String(event.name || '').trim()
  const unit = String(event.unit || '').trim()
  const category = await findCategory(event.categoryId)
  if (!name || !unit || !category) return { code: -1, msg: '商品名称、分类和单位不能为空' }
  const defaultSupplierId = String(event.defaultSupplierId || '').trim()
  if (defaultSupplierId) {
    const supplierRes = await db.collection('supplier')
      .where({ supplier_id: defaultSupplierId, status: 1 })
      .limit(1)
      .get()
    if (!supplierRes.data.length) return { code: -1, msg: '默认供应商不存在或已停用' }
  }

  const manufacturerName = String(event.manufacturerName || '默认').trim() || '默认'

  const data = {
    product_name: name,
    category_level_1: category.category_level_1,
    category_level_2_id: category.category_id,
    category_name: category.category_name,
    unit,
    spec: String(event.spec || '').trim(),
    default_supplier_id: defaultSupplierId,
    manufacturer_name: manufacturerName,
    updated_at: db.serverDate()
  }

  // P2-41 后半（2026-11-09 修复）：后端查重——名称+厂家，与 importProducts 判重同口径。
  // 前端查重不可信（并发/直连可绕过），CloudBase 无唯一索引，只能应用层拦。
  if (event.productId) {
    const existing = await db.collection('product').where({ product_id: event.productId }).limit(1).get()
    if (existing.data.length === 0) return { code: -1, msg: '商品不存在' }
    const current = existing.data[0]
    // 改名/改厂家才查重（排除自己）；名称厂家没变不查，容忍历史重复数据编辑其他字段
    if (current.product_name !== name || (current.manufacturer_name || '默认') !== manufacturerName) {
      const dupRes = await db.collection('product')
        .where({ product_name: name, manufacturer_name: manufacturerName, product_id: _.neq(event.productId) })
        .limit(1)
        .get()
      if (dupRes.data.length > 0) {
        return { code: -1, msg: `已存在同名同厂家的商品「${name}」（${manufacturerName}），请直接编辑该商品或更换厂家名` }
      }
    }
    await db.collection('product').doc(current._id).update({ data })
    return { code: 0, data: { productId: event.productId } }
  }

  // 新建：同名同厂家直接拒绝，引导去编辑现有商品
  const dupRes = await db.collection('product')
    .where({ product_name: name, manufacturer_name: manufacturerName })
    .limit(1)
    .get()
  if (dupRes.data.length > 0) {
    return { code: -1, msg: `已存在同名同厂家的商品「${name}」（${manufacturerName}），请直接编辑该商品或更换厂家名` }
  }

  const productId = 'P' + Date.now() + crypto.randomBytes(3).toString('hex')
  await db.collection('product').add({
    data: { ...data, product_id: productId, status: 1, created_at: db.serverDate() }
  })
  return { code: 0, data: { productId } }
}

async function toggleProduct(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error
  const result = await db.collection('product').where({ product_id: event.productId }).limit(1).get()
  const product = result.data[0]
  if (!product) return { code: -1, msg: '商品不存在' }
  const status = product.status === 1 ? 0 : 1
  await db.collection('product').doc(product._id).update({ data: { status, updated_at: db.serverDate() } })
  return { code: 0, data: { status } }
}

async function saveSupplier(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error
  const supplierName = String(event.supplierName || '').trim()
  if (!supplierName) return { code: -1, msg: '供应商名称不能为空' }
  const data = {
    supplier_name: supplierName,
    contact_name: String(event.contactName || '').trim(),
    contact_phone: String(event.contactPhone || '').trim(),
    remark: String(event.remark || '').trim(),
    updated_at: db.serverDate()
  }
  const duplicateSupplierRes = await db.collection('supplier')
    .where({ supplier_name: supplierName })
    .limit(100)
    .get()
  if (duplicateSupplierRes.data.some(item => item.supplier_id !== event.supplierId)) {
    return { code: -1, msg: '该供应商名称已存在' }
  }
  if (event.supplierId) {
    const existing = await db.collection('supplier').where({ supplier_id: event.supplierId }).limit(1).get()
    if (existing.data.length === 0) return { code: -1, msg: '供应商不存在' }
    await db.collection('supplier').doc(existing.data[0]._id).update({ data })
    return { code: 0, data: { supplierId: event.supplierId } }
  }

  const supplierId = 'SUP' + Date.now() + crypto.randomBytes(3).toString('hex')
  await db.collection('supplier').add({
    data: { ...data, supplier_id: supplierId, status: 1, created_at: db.serverDate() }
  })
  return { code: 0, data: { supplierId } }
}

async function toggleSupplier(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error
  const result = await db.collection('supplier').where({ supplier_id: event.supplierId }).limit(1).get()
  const supplier = result.data[0]
  if (!supplier) return { code: -1, msg: '供应商不存在' }
  const status = supplier.status === 1 ? 0 : 1
  await db.collection('supplier').doc(supplier._id).update({ data: { status, updated_at: db.serverDate() } })
  return { code: 0, data: { status } }
}

module.exports = { getCategories, saveProduct, toggleProduct, saveSupplier, toggleSupplier }
