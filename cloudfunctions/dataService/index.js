const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GLOBAL_ROLES = ['super_admin', 'purchaser']
const MANAGEMENT_ROLES = ['super_admin', 'purchaser']

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
  return new Date(user.session_expires_at).getTime() > Date.now() ? user : null
}

async function requireUser(event, roles) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { error: { code: -401, msg: '登录已过期，请重新登录' } }
  if (roles && !roles.includes(user.role)) {
    return { error: { code: -403, msg: '当前账号无权执行该操作' } }
  }
  return { user }
}

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

  const data = {
    product_name: name,
    category_level_1: category.category_level_1,
    category_level_2_id: category.category_id,
    category_name: category.category_name,
    unit,
    spec: String(event.spec || '').trim(),
    default_supplier_id: defaultSupplierId,
    manufacturer_name: String(event.manufacturerName || '默认').trim() || '默认',
    updated_at: db.serverDate()
  }
  if (event.productId) {
    const existing = await db.collection('product').where({ product_id: event.productId }).limit(1).get()
    if (existing.data.length === 0) return { code: -1, msg: '商品不存在' }
    await db.collection('product').doc(existing.data[0]._id).update({ data })
    return { code: 0, data: { productId: event.productId } }
  }

  const productId = 'P' + String(Date.now()).slice(-9)
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

  const supplierId = 'SUP' + String(Date.now()).slice(-9)
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

async function createMessage(data) {
  const messageId = 'MSG' + Date.now() + Math.floor(Math.random() * 1000)
  await db.collection('message').add({
    data: {
      message_id: messageId,
      type: data.type,
      title: data.title,
      content: data.content,
      biz_id: data.bizId || '',
      recipient_user_id: data.recipientUserId || '',
      store_id: data.storeId || '',
      read: false,
      created_at: db.serverDate()
    }
  })
}

// ===== 报表重算（审核改量后调用） =====
// 以下三个辅助函数与 createPurchaseOrder 中的实现保持一致（云函数各自独立部署，无法共享模块）。
function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

async function getNextVersion(reportType, scopeId, relatedDate) {
  // 版本号仅用于展示，报表路径含单号+audit标记保证唯一；查询失败必须抛出。
  const res = await db.collection('report_file')
    .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
    .orderBy('file_version', 'desc')
    .limit(1)
    .get()
  return res.data.length > 0 ? (Number(res.data[0].file_version) || 0) + 1 : 1
}

// 审核改量后，按批准数量重新生成下单类报表：旧版本标记 superseded（保留审计痕迹），
// 新版本按审核后数量生成。尽力而为：审核事务已提交，报表失败只记日志并返回警告。
async function regenerateApprovedOrderReports(order, orderItems, qtyMap) {
  const items = orderItems.map(item => ({
    productName: item.product_name_snapshot,
    category: item.category_snapshot || '',
    unit: item.unit_snapshot || '',
    supplierId: item.supplier_id || '',
    remark: item.remark || '',
    orderQty: Number.isFinite(qtyMap[item.item_id]) ? qtyMap[item.item_id] : item.order_qty
  }))
  const storeId = order.store_id
  const storeName = order.store_name
  const orderDate = order.order_date
  const orderNo = order.purchase_order_id

  await db.collection('report_file')
    .where({ source_order_id: orderNo, report_type: _.in(['store_order_report', 'supplier_order_report']) })
    .update({ data: { status: 'superseded', updated_at: db.serverDate() } })

  // 门店下单报表（审核后数量）
  const storeVer = await getNextVersion('store_order_report', storeId, orderDate)
  let csv1 = [csvField('商品名称'), csvField('分类'), csvField('单位'), csvField('下单数量'), csvField('备注')].join(',') + '\n'
  items.forEach(item => {
    csv1 += [csvField(item.productName), csvField(item.category), csvField(item.unit), csvField(item.orderQty), csvField(item.remark)].join(',') + '\n'
  })
  const f1 = `reports/store/${orderDate}/store-order-${safePathPart(storeName)}-${orderDate}-${orderNo}-audit-v${storeVer}.csv`
  const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
  await db.collection('report_file').add({
    data: {
      report_id: 'RPT_SO_' + orderNo + '_A', report_type: 'store_order_report',
      report_scope: 'store', scope_id: storeId, scope_name: storeName,
      related_date: orderDate, source_order_id: orderNo,
      file_name: f1, file_url: u1.fileID, file_version: storeVer,
      generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
    }
  })

  // 供应商订货汇总（审核后数量，按供应商分组）
  const supplierMap = {}
  items.forEach(item => {
    const sid = item.supplierId || 'unknown'
    if (!supplierMap[sid]) supplierMap[sid] = []
    supplierMap[sid].push(item)
  })
  const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
  const supplierNames = {}
  for (let i = 0; i < supplierIds.length; i += 20) {
    const idChunk = supplierIds.slice(i, i + 20)
    const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    supRes.data.forEach(s => { supplierNames[s.supplier_id] = s.supplier_name })
  }
  for (const sid of supplierIds) {
    const supItems = supplierMap[sid]
    const supName = supplierNames[sid] || sid
    const supVer = await getNextVersion('supplier_order_report', sid, orderDate)
    let csvSup = [csvField('门店'), csvField('商品名称'), csvField('订货数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
    supItems.forEach(item => {
      csvSup += [csvField(storeName), csvField(item.productName), csvField(item.orderQty), csvField(item.unit), csvField(item.remark)].join(',') + '\n'
    })
    const fSup = `reports/supplier/${orderDate}/supplier-order-${safePathPart(supName)}-${orderDate}-${orderNo}-audit-v${supVer}.csv`
    const uSup = await cloud.uploadFile({ cloudPath: fSup, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csvSup, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SUO_' + sid + '_' + orderNo + '_A', report_type: 'supplier_order_report',
        report_scope: 'supplier', scope_id: sid, scope_name: supName,
        related_date: orderDate, source_order_id: orderNo,
        file_name: fSup, file_url: uSup.fileID, file_version: supVer,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
      }
    })
  }
}

async function auditOrder(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error
  if (!['approved', 'rejected'].includes(event.status)) return { code: -1, msg: '审核状态无效' }

  const orderResult = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const order = orderResult.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (!['submitted', 'pending_approval'].includes(order.order_status)) {
    return { code: -1, msg: '该订单已经审核，请勿重复操作' }
  }
  if (event.status === 'rejected' && !String(event.auditRemark || '').trim()) {
    return { code: -1, msg: '驳回时必须填写原因' }
  }

  const itemResult = await db.collection('purchase_order_item')
    .where({ purchase_order_id: event.orderId })
    .limit(1000)
    .get()
  const qtyMap = {}
  if (event.status === 'approved' && event.items !== undefined && !Array.isArray(event.items)) {
    return { code: -1, msg: '审核明细格式无效' }
  }
  ;(event.items || []).forEach(item => {
    if (item && item.itemId) qtyMap[item.itemId] = Number(item.approveQty)
  })
  if (event.status === 'approved' && Array.isArray(event.items)) {
    const validIds = new Set(itemResult.data.map(item => item.item_id))
    for (const item of event.items) {
      const qty = Number(item && item.approveQty)
      const sourceItem = item && item.itemId
        ? itemResult.data.find(source => source.item_id === item.itemId)
        : null
      if (!item || !validIds.has(item.itemId) || !Number.isFinite(qty) || qty < 0 || qty > Number(sourceItem && sourceItem.order_qty)) {
        return { code: -1, msg: '审核数量无效，请检查后重试' }
      }
    }
  }

  await db.runTransaction(async transaction => {
    for (const item of itemResult.data) {
      const approvedQty = qtyMap[item.item_id]
      if (event.status === 'approved' && Number.isFinite(approvedQty) && approvedQty >= 0) {
        await transaction.collection('purchase_order_item').doc(item._id).update({
          data: { order_qty: approvedQty, approved_qty: approvedQty, updated_at: db.serverDate() }
        })
      }
    }
    await transaction.collection('purchase_order').doc(order._id).update({
      data: {
        order_status: event.status,
        audit_remark: String(event.auditRemark || '').trim(),
        audited_by: auth.user.name,
        audited_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  })

  await createMessage({
    type: 'approval',
    title: event.status === 'approved' ? '采购申请已通过' : '采购申请已驳回',
    content: `${order.order_no || event.orderId}${event.status === 'approved' ? '审核通过' : '被驳回'}`,
    bizId: event.orderId,
    storeId: order.store_id
  })

  // 批准且审核数量与申请数量不一致时，下单类报表必须按批准数量重算，
  // 否则发往供应商的报表仍是审核前的数字。
  const qtyChanged = event.status === 'approved' && itemResult.data.some(item => {
    const approvedQty = qtyMap[item.item_id]
    return Number.isFinite(approvedQty) && approvedQty >= 0 && approvedQty !== Number(item.order_qty)
  })
  let reportWarning = ''
  if (qtyChanged) {
    try {
      await regenerateApprovedOrderReports(order, itemResult.data, qtyMap)
    } catch (err) {
      console.error('[dataService] 审核后报表重算失败:', err)
      reportWarning = '审核已通过，但下单报表重算失败，请联系管理员处理。'
    }
  }
  return { code: 0, data: { reportWarning } }
}

function publicMessage(message) {
  return {
    id: message._id,
    messageId: message.message_id,
    type: message.type,
    title: message.title,
    content: message.content,
    bizId: message.biz_id || '',
    read: !!message.read,
    time: message.created_at
  }
}

async function getMessages(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const userId = auth.user.user_id || auth.user._id
  // 过滤条件下推到数据库，避免"先取全局最新100条再内存过滤"导致门店消息静默丢失
  const recipientCondition = _.or([
    { recipient_user_id: '' },
    { recipient_user_id: userId },
    { recipient_user_id: _.exists(false) }
  ])
  let query = recipientCondition
  if (!GLOBAL_ROLES.includes(auth.user.role)) {
    const storeCondition = _.or([
      { store_id: '' },
      { store_id: auth.user.default_store_id || '' },
      { store_id: _.exists(false) }
    ])
    query = _.and([recipientCondition, storeCondition])
  }
  const result = await db.collection('message').where(query).orderBy('created_at', 'desc').limit(100).get()
  const list = result.data.map(message => {
    const readBy = Array.isArray(message.read_by) ? message.read_by : []
    // 兼容旧数据：read 布尔是全局已读；read_by 数组是按用户已读
    return { ...publicMessage(message), read: !!message.read || readBy.includes(userId) }
  })
  return { code: 0, data: list }
}

async function markMessageRead(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '消息信息缺失' }
  const messageResult = await db.collection('message').doc(event.id).get()
  const message = messageResult.data
  if (!message) return { code: -1, msg: '消息不存在' }
  const isGlobal = GLOBAL_ROLES.includes(auth.user.role)
  const belongsToUser = !message.recipient_user_id || message.recipient_user_id === (auth.user.user_id || auth.user._id)
  const belongsToStore = isGlobal || !message.store_id || message.store_id === auth.user.default_store_id
  if (!belongsToUser || !belongsToStore) return { code: -403, msg: '无权操作该消息' }
  // 按用户记录已读：同一门店的其他成员的未读状态不受影响
  const userId = auth.user.user_id || auth.user._id
  await db.collection('message').doc(event.id).update({
    data: { read_by: _.push(userId), read_at: db.serverDate() }
  })
  return { code: 0 }
}

async function markAllMessagesRead(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const userId = auth.user.user_id || auth.user._id
  const result = await getMessages(event)
  if (result.code !== 0) return result
  for (const message of result.data.filter(item => !item.read)) {
    await db.collection('message').doc(message.id).update({
      data: { read_by: _.push(userId), read_at: db.serverDate() }
    })
  }
  return { code: 0 }
}

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货'
}
const ABNORMAL_STATUS_NAMES = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭'
}

async function getAbnormalRecords(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  if (auth.user.role === 'chef') return { code: 0, data: [] }

  const query = {}
  if (!GLOBAL_ROLES.includes(auth.user.role)) query.store_id = auth.user.default_store_id
  if (event.status) query.status = event.status
  const result = await db.collection('abnormal_record')
    .where(query)
    .orderBy('created_at', 'desc')
    .limit(100)
    .get()

  const supplierIds = [...new Set(result.data.map(item => item.supplier_id).filter(Boolean))]
  const supplierMap = {}
  for (let i = 0; i < supplierIds.length; i += 20) {
    const idChunk = supplierIds.slice(i, i + 20)
    const suppliers = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    suppliers.data.forEach(item => { supplierMap[item.supplier_id] = item.supplier_name })
  }
  const list = result.data.map(item => ({
    id: item._id,
    abnormalId: item.abnormal_id,
    type: item.type,
    typeName: ABNORMAL_TYPE_NAMES[item.type] || item.type,
    description: item.description,
    supplierName: supplierMap[item.supplier_id] || item.supplier_id || '未指定供应商',
    storeName: item.store_name,
    status: item.status,
    statusName: ABNORMAL_STATUS_NAMES[item.status] || item.status,
    createdAt: item.created_at,
    resolution: item.resolution || ''
  }))
  return { code: 0, data: list }
}

async function startAbnormal(event) {
  const auth = await requireUser(event, ['store_manager', 'purchaser', 'super_admin'])
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '异常记录信息缺失' }
  const result = await db.collection('abnormal_record').doc(event.id).get()
  if (!result.data) return { code: -1, msg: '异常记录不存在' }
  if (!GLOBAL_ROLES.includes(auth.user.role) && result.data.store_id !== auth.user.default_store_id) {
    return { code: -403, msg: '当前账号无权处理该门店异常' }
  }
  if (result.data.status !== 'pending') return { code: -1, msg: '该异常已进入处理流程' }
  await db.collection('abnormal_record').doc(event.id).update({
    data: { status: 'processing', handled_by: auth.user.name, updated_at: db.serverDate() }
  })
  return { code: 0 }
}

async function resolveAbnormal(event) {
  const auth = await requireUser(event, ['store_manager', 'purchaser', 'super_admin'])
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '异常记录信息缺失' }
  const resolution = String(event.resolution || '').trim()
  if (!resolution) return { code: -1, msg: '请填写处理结果' }

  const result = await db.collection('abnormal_record').doc(event.id).get()
  const record = result.data
  if (!record) return { code: -1, msg: '异常记录不存在' }
  if (!GLOBAL_ROLES.includes(auth.user.role) && record.store_id !== auth.user.default_store_id) {
    return { code: -403, msg: '当前账号无权处理该门店异常' }
  }
  if (record.status !== 'processing') return { code: -1, msg: '只有处理中异常才能标记为已解决' }

  await db.collection('abnormal_record').doc(event.id).update({
    data: {
      status: 'resolved',
      resolution,
      resolved_by: auth.user.name,
      resolved_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  await createMessage({
    type: 'abnormal',
    title: '异常已解决',
    content: `${record.abnormal_id || event.id} 已记录处理结果`,
    bizId: record.abnormal_id || event.id,
    storeId: record.store_id
  })
  return { code: 0 }
}

async function closeAbnormal(event) {
  const auth = await requireUser(event, ['store_manager', 'purchaser', 'super_admin'])
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '异常记录信息缺失' }

  const result = await db.collection('abnormal_record').doc(event.id).get()
  const record = result.data
  if (!record) return { code: -1, msg: '异常记录不存在' }
  if (!GLOBAL_ROLES.includes(auth.user.role) && record.store_id !== auth.user.default_store_id) {
    return { code: -403, msg: '当前账号无权处理该门店异常' }
  }
  if (record.status !== 'resolved') return { code: -1, msg: '只有已解决异常才能关闭' }

  await db.collection('abnormal_record').doc(event.id).update({
    data: {
      status: 'closed',
      closed_by: auth.user.name,
      closed_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  return { code: 0 }
}

// 首页统计：按状态做服务端聚合计数，避免前端拉全量订单再 filter（超 100 条即失真）
async function getOrderStats(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const baseQuery = {}
  // 角色口径与 getPurchaseOrders 保持一致
  if (auth.user.role === 'chef') {
    if (!auth.user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
    baseQuery.store_id = auth.user.default_store_id
    baseQuery.created_by = auth.user.user_id || auth.user._id
  } else if (auth.user.role === 'store_manager') {
    if (!auth.user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
    baseQuery.store_id = auth.user.default_store_id
  } else if (GLOBAL_ROLES.includes(auth.user.role)) {
    if (event.storeId) baseQuery.store_id = event.storeId
  } else {
    return { code: -403, msg: '当前账号无权查看采购订单' }
  }
  const receivableStatuses = ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive']
  const [submittedRes, receivableRes, receivedRes] = await Promise.all([
    db.collection('purchase_order').where({ ...baseQuery, order_status: 'submitted' }).count(),
    db.collection('purchase_order').where({ ...baseQuery, order_status: _.in(receivableStatuses) }).count(),
    db.collection('purchase_order').where({ ...baseQuery, order_status: 'received' }).count()
  ])
  return {
    code: 0,
    data: {
      submitted: submittedRes.total,
      receivable: receivableRes.total,
      received: receivedRes.total
    }
  }
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'getCategories': return await getCategories(event)
      case 'saveProduct': return await saveProduct(event)
      case 'toggleProduct': return await toggleProduct(event)
      case 'saveSupplier': return await saveSupplier(event)
      case 'toggleSupplier': return await toggleSupplier(event)
      case 'auditOrder': return await auditOrder(event)
      case 'getMessages': return await getMessages(event)
      case 'markMessageRead': return await markMessageRead(event)
      case 'markAllMessagesRead': return await markAllMessagesRead(event)
      case 'getAbnormalRecords': return await getAbnormalRecords(event)
      case 'startAbnormal': return await startAbnormal(event)
      case 'resolveAbnormal': return await resolveAbnormal(event)
      case 'closeAbnormal': return await closeAbnormal(event)
      case 'getOrderStats': return await getOrderStats(event)
      default: return { code: -1, msg: '不支持的数据操作' }
    }
  } catch (err) {
    console.error('[dataService] CloudBase 数据操作失败:', err)
    return { code: -1, msg: 'CloudBase 数据操作失败，请稍后重试' }
  }
}
