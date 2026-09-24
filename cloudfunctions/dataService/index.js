const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GLOBAL_ROLES = ['super_admin', 'purchaser']
const MANAGEMENT_ROLES = ['super_admin', 'purchaser']
// S9 凭证提交：店长是线下持凭证的人，可提交；核销裁决仍限管理员/采购员
const VOUCHER_SUBMIT_ROLES = ['super_admin', 'purchaser', 'store_manager']

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const tokenHash = hashToken(authToken)
  // B12 多设备会话：先查 sessions 数组（每设备一条），兼容旧单会话字段
  const result = await db.collection('app_user')
    .where({ status: 1, sessions: { token_hash: tokenHash } })
    .limit(1)
    .get()
  let user = result.data[0]
  if (!user) {
    const legacy = await db.collection('app_user')
      .where({ session_token_hash: tokenHash, status: 1 })
      .limit(1)
      .get()
    user = legacy.data[0]
  }
  if (!user) return null
  if (Array.isArray(user.sessions) && user.sessions.length) {
    const session = user.sessions.find(s => s && s.token_hash === tokenHash)
    if (!session || !session.expires_at) return null
    const expiresAt = new Date(session.expires_at).getTime()
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
  }
  if (!user.session_expires_at) return null
  const legacyExpires = new Date(user.session_expires_at).getTime()
  return Number.isFinite(legacyExpires) && legacyExpires > Date.now() ? user : null
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
      // 供货商定向消息（S3 补充口径）：scope_type=supplier + scope_id=供应商档案ID
      scope_type: data.scopeType || '',
      scope_id: data.scopeId || '',
      read: false,
      read_by: [],
      created_at: db.serverDate()
    }
  })
}

// 查询门店店长 user_id（清单 #5 消息定向口径）。查不到返回 ''（回退门店广播）。
async function getStoreManagerId(storeId) {
  try {
    const res = await db.collection('app_user')
      .where({ role: 'store_manager', default_store_id: storeId, status: 1 })
      .limit(1)
      .get()
    return (res.data[0] && (res.data[0].user_id || res.data[0]._id)) || ''
  } catch (err) {
    console.warn('[dataService] 查询门店店长失败，消息回退门店广播:', err)
    return ''
  }
}

// ===== 审核通过 → 通知供货商（新订单下推） =====
// 订阅消息模板配置：小程序后台申请通过后填入 TEMPLATE_ID 即可真实下发；
// TEMPLATE_ID 为空时只记日志、不发送（站内通知不受影响，作为兜底触达）。
const SUBSCRIBE_TEMPLATE_ID = ''
// 模板字段（一次订阅一条）：按申请到的模板 keywords 配置，值从 payload 取
const SUBSCRIBE_TEMPLATE_FIELDS = [
  { key: 'orderNo', index: 1 },
  { key: 'storeName', index: 2 },
  { key: 'items', index: 3 },
  { key: 'amount', index: 4 }
]

// 查询某供货商所有启用账号（含 openid），用于订阅消息推送
async function getSupplierUsers(supplierId) {
  if (!supplierId) return []
  try {
    const res = await db.collection('app_user')
      .where({ role: 'supplier', default_supplier_id: supplierId, status: 1 })
      .limit(20)
      .get()
    return res.data.filter(u => u.openid)
  } catch (err) {
    console.warn('[dataService] 查询供货商账号失败，跳过微信推送:', err)
    return []
  }
}

// 发送微信订阅消息（尽力而为：无模板/无授权/发送失败都只记日志，不阻断主流程）
async function sendSubscribeMessage(user, payload) {
  if (!SUBSCRIBE_TEMPLATE_ID) {
    console.log('[dataService] 订阅消息模板未配置，跳过推送（站内通知已写）', payload.orderNo)
    return
  }
  const dataValue = value => ({ value: String(value || '') })
  const data = {}
  SUBSCRIBE_TEMPLATE_FIELDS.forEach(f => { data['thing' + f.index] = dataValue(payload[f.key]) })
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: user.openid,
      templateId: SUBSCRIBE_TEMPLATE_ID,
      page: 'pages/supplier-orders/supplier-orders',
      data,
      miniprogramState: 'formal'
    })
  } catch (err) {
    // 43101 = 用户未订阅/订阅次数用尽，属预期情况，降级为 debug 日志
    if (err && err.errCode === 43101) {
      console.log('[dataService] 用户未订阅订阅消息，跳过推送:', user.username)
    } else {
      console.error('[dataService] 订阅消息推送失败:', user.username, err)
    }
  }
}

// 审核通过后按供货商分组下推通知：站内消息（scope_type=supplier）+ 微信订阅消息
async function notifySuppliersNewOrder(order, orderItems) {
  const supplierMap = {}
  orderItems.forEach(item => {
    // 清单 #24：手动商品不推送（显式 is_manual 过滤，不依赖 supplier_id 为空的隐式前提）
    if (item.is_manual) return
    const sid = item.supplier_id || ''
    if (!sid) return
    // 下单明细无价格字段（价格快照在收货时才生成），摘要只报项数不报金额
    supplierMap[sid] = (supplierMap[sid] || 0) + 1
  })
  const supplierIds = Object.keys(supplierMap)
  if (!supplierIds.length) return

  // 补齐供应商名称（消息里展示）
  const nameRes = await db.collection('supplier')
    .where({ supplier_id: _.in(supplierIds) })
    .limit(100)
    .get()
  const nameById = {}
  nameRes.data.forEach(s => { nameById[s.supplier_id] = s.supplier_name })

  for (const supplierId of supplierIds) {
    const itemCount = supplierMap[supplierId]
    const supplierName = nameById[supplierId] || supplierId
    const title = '您有新的采购订单'
    const content = `${order.store_name || ''}的采购单 ${order.order_no || order.purchase_order_id} 已审核通过，共 ${itemCount} 项商品，请确认接单。`
    // 站内通知：供货商门户消息中心可见（兜底触达，必写）
    try {
      await createMessage({
        type: 'order',
        title,
        content,
        bizId: order.purchase_order_id,
        scopeType: 'supplier',
        scopeId: supplierId
      })
    } catch (err) {
      console.error('[dataService] 供货商站内通知写入失败:', supplierId, err)
    }
    // 微信服务通知：订阅授权次数内推送
    const users = await getSupplierUsers(supplierId)
    for (const user of users) {
      await sendSubscribeMessage(user, {
        orderNo: order.order_no || order.purchase_order_id,
        storeName: order.store_name || '',
        items: `${itemCount} 项商品`,
        amount: ''
      })
    }
  }
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
// S2 拍板：数量已变，旧确认口径作废——清除该单所有供货商的确认状态（打回待确认），
// 并发内部消息提醒采购经办人线下通知供应商重新确认。
// qtyChanged=false（缺报表补生成）时跳过确认重置，避免误发"改量"消息。
async function regenerateApprovedOrderReports(order, orderItems, qtyMap, qtyChanged = true) {
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

  // 重置供货商确认状态（仅改量时；有确认记录才清，避免无谓写操作）
  if (qtyChanged && order.supplier_confirmations && Object.keys(order.supplier_confirmations).length) {
    const confirmedSuppliers = Object.keys(order.supplier_confirmations)
    await db.collection('purchase_order').doc(order._id).update({
      data: { supplier_confirmations: _.set({}), updated_at: db.serverDate() }
    })
    await createMessage({
      title: '订单改量，供货商需重新确认',
      content: `采购单 ${orderNo}（${storeName}）审核改量后已重发订货单，原供货商确认已重置，请线下通知供应商（${confirmedSuppliers.join('、')}）按新数量重新确认接单。`,
      type: 'order',
      storeId,
      recipientUserId: order.created_by || ''
    })
  }

  await db.collection('report_file')
    .where({ source_order_id: orderNo, report_type: _.in(['store_order_report', 'supplier_order_report']) })
    .update({ data: { status: 'superseded', updated_at: db.serverDate() } })

  // 门店下单报表（审核后数量）
  const storeVer = await getNextVersion('store_order_report', storeId, orderDate)
  // S9：手动单重发的报表同样打标，与提交时生成的口径一致
  const manualTag = order.is_manual ? [csvField('单据类型'), csvField('手动商品专用单（线下采购，凭证核销）')].join(',') + '\n' : ''
  const csv1Info = manualTag + [csvField('采购单号'), csvField(orderNo), csvField('门店'), csvField(storeName), csvField('下单日期'), csvField(orderDate), csvField('期望到货'), csvField(order.delivery_date || ''), csvField('经办人'), csvField(order.created_by_name || ''), csvField('备注'), csvField('审核后重发')].join(',') + '\n'
  let csv1 = csv1Info + [csvField('商品名称'), csvField('分类'), csvField('单位'), csvField('下单数量'), csvField('备注')].join(',') + '\n'
  items.forEach(item => {
    csv1 += [csvField(item.productName), csvField(item.category), csvField(item.unit), csvField(item.orderQty), csvField(item.remark)].join(',') + '\n'
  })
  const f1 = `reports/store/${orderDate}/store-order-${safePathPart(storeName)}-${orderDate}-${orderNo}-audit-v${storeVer}.csv`
  const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
  await db.collection('report_file').add({
    data: {
      report_id: 'RPT_SO_' + orderNo + '_A', report_type: 'store_order_report',
      report_scope: 'store', scope_id: storeId, scope_name: storeName,
      related_date: orderDate, source_order_id: orderNo, basis_date_type: 'order_date',
      file_name: f1, file_url: u1.fileID, file_version: storeVer,
      generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
    }
  })

  // 供应商订货汇总（审核后数量，按供应商分组）
  const supplierMap = {}
  items.forEach(item => {
    // 清单 #24：手动商品不进订货汇总（显式 is_manual 过滤）
    if (item.is_manual) return
    const sid = item.supplierId || 'unknown'
    if (!supplierMap[sid]) supplierMap[sid] = []
    supplierMap[sid].push(item)
  })
  const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
  const supplierNames = {}
  const supplierContacts = {}
  for (let i = 0; i < supplierIds.length; i += 20) {
    const idChunk = supplierIds.slice(i, i + 20)
    const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    supRes.data.forEach(s => {
      supplierNames[s.supplier_id] = s.supplier_name
      supplierContacts[s.supplier_id] = [s.contact_name, s.contact_phone].filter(Boolean).join(' ')
    })
  }
  for (const sid of supplierIds) {
    const supItems = supplierMap[sid]
    const supName = supplierNames[sid] || sid
    const supVer = await getNextVersion('supplier_order_report', sid, orderDate)
    let csvSup = [csvField('采购单号'), csvField(orderNo), csvField('供应商'), csvField(supName), csvField('联系人'), csvField(supplierContacts[sid] || ''), csvField('下单日期'), csvField(orderDate), csvField('期望到货'), csvField(order.delivery_date || '')].join(',') + '\n'
    csvSup += [csvField('门店'), csvField('商品名称'), csvField('订货数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
    supItems.forEach(item => {
      csvSup += [csvField(storeName), csvField(item.productName), csvField(item.orderQty), csvField(item.unit), csvField(item.remark)].join(',') + '\n'
    })
    const fSup = `reports/supplier/${orderDate}/supplier-order-${safePathPart(supName)}-${orderDate}-${orderNo}-audit-v${supVer}.csv`
    const uSup = await cloud.uploadFile({ cloudPath: fSup, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csvSup, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SUO_' + sid + '_' + orderNo + '_A', report_type: 'supplier_order_report',
        report_scope: 'supplier', scope_id: sid, scope_name: supName,
        related_date: orderDate, source_order_id: orderNo, basis_date_type: 'order_date',
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
  // 审核通过 → 下推供货商通知（站内必写 + 微信订阅消息尽力推送，失败不阻断）
  if (event.status === 'approved') {
    try {
      await notifySuppliersNewOrder(order, itemResult.data)
    } catch (err) {
      console.error('[dataService] 供货商新订单通知失败:', err)
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
  if (auth.user.role === 'supplier') {
    // 供货商消息按供货商档案定向（不绑门店）：只收 scope_type=supplier 且 scope_id 匹配的消息
    query = _.and([recipientCondition, { scope_type: 'supplier', scope_id: auth.user.default_supplier_id || '' }])
  } else if (!GLOBAL_ROLES.includes(auth.user.role)) {
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
  // 按用户记录已读：同一门店的其他成员的未读状态不受影响；read_by 去重
  const userId = auth.user.user_id || auth.user._id
  const readBy = Array.isArray(message.read_by) ? message.read_by : []
  if (!readBy.includes(userId)) {
    await db.collection('message').doc(event.id).update({
      data: { read_by: _.push(userId), read_at: db.serverDate() }
    })
  }
  return { code: 0 }
}

async function markAllMessagesRead(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const userId = auth.user.user_id || auth.user._id
  const result = await getMessages(event)
  if (result.code !== 0) return result
  // 需要拿原始 read_by 判断去重，逐条读原文（getMessages 返回已合并 read 布尔）
  for (const message of result.data.filter(item => !item.read)) {
    const rawRes = await db.collection('message').doc(message.id).get()
    const readBy = Array.isArray(rawRes.data && rawRes.data.read_by) ? rawRes.data.read_by : []
    if (readBy.includes(userId)) continue
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

  // 付款裁决：pay_received = 异常行转回可付款（补结算时纳入）；reject = 维持不可付款
  const paymentDecision = ['pay_received', 'reject'].includes(event.paymentDecision) ? event.paymentDecision : ''

  await db.collection('abnormal_record').doc(event.id).update({
    data: {
      status: 'resolved',
      resolution,
      payment_decision: paymentDecision,
      resolved_by: auth.user.name,
      resolved_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  await createMessage({
    type: 'abnormal',
    title: '异常已解决',
    content: paymentDecision === 'pay_received'
      ? `${record.abnormal_id || event.id} 已记录处理结果，异常行将转回可付款`
      : `${record.abnormal_id || event.id} 已记录处理结果`,
    bizId: record.abnormal_id || event.id,
    // 清单 #5 口径：异常类消息定向店长（处理责任人），与 createReceipt 一致
    recipientUserId: await getStoreManagerId(record.store_id),
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
  const receivableStatuses = ['approved', 'report_generated', 'partial_received', 'to_receive']
  // 待核销（verify_status=pending）的手动单不计入「已完成」（流程图 S9 口径，清单 #20）
  const receivedQuery = { ...baseQuery, order_status: 'received', verify_status: _.neq('pending') }
  const [submittedRes, receivableRes, receivedRes, toVerifyRes] = await Promise.all([
    db.collection('purchase_order').where({ ...baseQuery, order_status: 'submitted' }).count(),
    db.collection('purchase_order').where({ ...baseQuery, order_status: _.in(receivableStatuses) }).count(),
    db.collection('purchase_order').where(receivedQuery).count(),
    // 管理员待办：已收货待核销的手动单（仅全局角色需要）
    GLOBAL_ROLES.includes(auth.user.role)
      ? db.collection('purchase_order').where({ ...baseQuery, verify_status: 'pending' }).count()
      : Promise.resolve({ total: 0 })
  ])
  return {
    code: 0,
    data: {
      submitted: submittedRes.total,
      receivable: receivableRes.total,
      received: receivedRes.total,
      to_verify: toVerifyRes.total
    }
  }
}

// ===== B5 异常处理后补结算 =====
// 收货单存在异常行被剔除后，异常全部处理完成时，按当前 receipt_item 的
// payable_flag / price_snapshot 重新生成补充带价账单（每供应商一份）。
async function settleReceipt(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }

  // 异常记录必须全部处理完成（resolved/closed）才允许补结算
  const abnormalRes = await db.collection('abnormal_record')
    .where({ receipt_id: receiptId })
    .limit(100)
    .get()
  const openAbnormal = abnormalRes.data.filter(item => ['pending', 'processing'].includes(item.status))
  if (openAbnormal.length > 0) return { code: -1, msg: '尚有未处理完成的异常，无法补结算' }

  // 已补结算过则拒绝重复（补充账单 report_id 带 _S 后缀）
  const settledRes = await db.collection('report_file')
    .where({ report_type: 'supplier_receipt_price_report', source_order_id: receipt.purchase_order_id || '' })
    .limit(100)
    .get()
  if (settledRes.data.some(r => String(r.report_id || '').endsWith(receiptId + '_S'))) {
    return { code: -1, msg: '该收货单已补结算，请勿重复操作' }
  }

  // 已解决且裁决为"按实收付款"的异常行，随补结算一并转回可付款
  const payReceivedRecords = abnormalRes.data.filter(item => item.status !== 'closed' && item.payment_decision === 'pay_received')
  const payReceivedKeys = new Set(payReceivedRecords.map(r => r.abnormal_id))
  if (payReceivedKeys.size > 0) {
    const itemResForPay = await db.collection('receipt_item')
      .where({ receipt_id: receiptId })
      .limit(1000)
      .get()
    for (const rec of payReceivedRecords) {
      // abnormal_id 格式：{receiptId}_{行序号}_{type}，按行序号定位 receipt_item_id
      const parts = String(rec.abnormal_id || '').split('_')
      if (parts.length < 3 || parts[0] !== receiptId) continue
      const itemItemId = receiptId + '_' + parts[1]
      const target = itemResForPay.data.find(it => it.receipt_item_id === itemItemId)
      if (target && Number(target.price_snapshot) > 0) {
        await db.collection('receipt_item').doc(target._id).update({
          data: { payable_flag: true, updated_at: db.serverDate() }
        })
      }
    }
  }

  const itemRes = await db.collection('receipt_item')
    .where({ receipt_id: receiptId })
    .limit(1000)
    .get()
  // payable_flag 缺失（旧数据）视为可付款；价格为 0 的行跳过不结算；
  // 清单 #24：手动商品行显式排除（金额走凭证核销回填，不进补结算）
  const payableItems = itemRes.data.filter(item => !item.is_manual && item.payable_flag !== false && Number(item.price_snapshot) > 0)
  if (payableItems.length === 0) return { code: -1, msg: '无可结算的明细行' }

  const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
  const storeId = receipt.store_id || ''
  const storeName = receipt.store_name || ''
  const purchaseOrderId = receipt.purchase_order_id || ''

  // 按供应商分组
  const supplierMap = {}
  payableItems.forEach(item => {
    const sid = item.supplier_id || 'unknown'
    if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
    supplierMap[sid].items.push(item)
  })
  const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
  for (let i = 0; i < supplierIds.length; i += 20) {
    const idChunk = supplierIds.slice(i, i + 20)
    const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    supRes.data.forEach(s => {
      if (supplierMap[s.supplier_id]) supplierMap[s.supplier_id].name = s.supplier_name
    })
  }

  const infoHead = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('备注'), csvField('异常处理后补结算')].join(',') + '\n'
  const generatedSuppliers = []
  for (const sid of supplierIds) {
    const supItems = supplierMap[sid].items
    const supName = supplierMap[sid].name || sid
    const ver = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)

    let csv = infoHead + [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计')].join(',') + '\n'
    let total = 0
    supItems.forEach(item => {
      const price = Number(item.price_snapshot) || 0
      const qty = Number(item.received_qty) || 0
      const sub = Math.round(qty * price * 100) / 100
      total = Math.round((total + sub) * 100) / 100
      csv += [csvField(item.product_name), csvField(storeName), csvField(qty), csvField(item.unit_snapshot || ''), csvField(price), csvField(sub.toFixed(2))].join(',') + '\n'
    })
    csv += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(total.toFixed(2))].join(',') + '\n'

    const filePath = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(supName)}-${receiptDate}-${receiptId}-settle-v${ver}.csv`
    const uploadRes = await cloud.uploadFile({ cloudPath: filePath, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SURP_' + sid + '_' + receiptId + '_S', report_type: 'supplier_receipt_price_report',
        report_scope: 'supplier', scope_id: sid, scope_name: supName,
        related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
        file_name: filePath, file_url: uploadRes.fileID, file_version: ver,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
        settle_for_receipt: receiptId
      }
    })
    generatedSuppliers.push(sid)
  }
  return { code: 0, data: { generatedSuppliers, count: generatedSuppliers.length } }
}

// ===== 清单 #7：下单报表失败后补生成 ① ② 报表 =====
// createPurchaseOrder 报表生成失败时在订单上打 missing_reports 标记，
// 本入口按订单重读 purchase_order_item，重走 ① 门店下单 / ② 供应商订货汇总。
// 复用 regenerateApprovedOrderReports 的生成逻辑（内部已含 superseded 标记）。
async function regenerateOrderReports(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const orderId = String(event.orderId || '').trim()
  if (!orderId) return { code: -1, msg: '缺少订单号' }

  const orderRes = await db.collection('purchase_order')
    .where({ purchase_order_id: orderId })
    .limit(1)
    .get()
  const order = orderRes.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }

  const itemRes = await db.collection('purchase_order_item')
    .where({ purchase_order_id: orderId })
    .limit(1000)
    .get()
  const orderItems = itemRes.data || []
  if (orderItems.length === 0) return { code: -1, msg: '订单明细不存在，无法补生成' }

  // qtyMap 用数据库中的当前下单量（未发生审核改量时与快照一致）
  const qtyMap = {}
  orderItems.forEach(item => {
    const key = item.item_id || item._id
    if (key) qtyMap[key] = Number(item.order_qty) || 0
  })

  await regenerateApprovedOrderReports(order, orderItems, qtyMap, false)

  // 补生成成功后清除缺报表标记
  await db.collection('purchase_order')
    .where({ purchase_order_id: orderId, missing_reports: true })
    .update({ data: { missing_reports: false, updated_at: db.serverDate() } })

  return { code: 0, data: { orderId, regenerated: true } }
}

// ===== 清单 #7 报表失败补偿：管理员手动补生成收货报表 =====
// 报表生成失败（非异常场景）时，createReceipt 会在订单上打 missing_reports 标记。
// 本入口按 receipt_id 重读 receipt_item（价格快照都在库里），重走
// ③ 门店收货 / ④ 门店带价 / ⑤ 供应商到货 / ⑥ 供应商带价账单 四类报表。
// 不自动重试的原因：失败多为云存储/网络问题，人工触发天然幂等、量极少。
async function regenerateReceiptReports(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }

  const itemRes = await db.collection('receipt_item')
    .where({ receipt_id: receiptId })
    .limit(1000)
    .get()
  const items = itemRes.data || []
  if (items.length === 0) return { code: -1, msg: '收货明细不存在，无法补生成' }

  const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
  const storeId = receipt.store_id || ''
  const storeName = receipt.store_name || ''
  const purchaseOrderId = receipt.purchase_order_id || ''
  const batchNo = Number(receipt.batch_no) || 1
  const isFinal = receipt.is_final !== false
  const receivedBy = receipt.received_by || ''
  const hasAbnormal = receipt.receipt_status === 'abnormal'

  // 供应商名称批量查回
  const supplierNameMap = {}
  const allSupplierIds = [...new Set(items.map(item => item.supplier_id).filter(Boolean))]
  for (let i = 0; i < allSupplierIds.length; i += 20) {
    const idChunk = allSupplierIds.slice(i, i + 20)
    const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
    supRes.data.forEach(s => { supplierNameMap[s.supplier_id] = s.supplier_name })
  }

  const infoHead = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('验收人'), csvField(receivedBy), csvField('批次'), csvField(`第${batchNo}批${isFinal ? '（收齐）' : ''}`), csvField('备注'), csvField('报表失败后补生成')].join(',') + '\n'

  const itemAbnormalTypes = item => {
    const types = []
    if (item.is_shortage) types.push('短收')
    if (item.is_quality_issue) types.push('质量问题')
    if (item.is_wrong_item) types.push('错货')
    return types
  }
  const generated = []
  try {
    // ===== ③ 门店收货报表（不含价，全量行） =====
    const v3 = await getNextVersion('store_receipt_report', storeId, receiptDate)
    let csv3 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('下单数量'), csvField('实收数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注'), csvField('是否可付款')].join(',') + '\n'
    items.forEach(item => {
      const types = itemAbnormalTypes(item)
      csv3 += [csvField(item.product_name), csvField(supplierNameMap[item.supplier_id] || item.supplier_id || ''), csvField(item.order_qty_snapshot), csvField(item.received_qty), csvField(item.unit_snapshot || ''), csvField(types.length ? '收货异常' : '正常'), csvField(types.join('、')), csvField(item.remark || ''), csvField(item.payable_flag !== false ? '是' : '否')].join(',') + '\n'
    })
    const f3 = `reports/store/${receiptDate}/store-receipt-${safePathPart(storeName)}-${receiptDate}-${receiptId}-regen-v${v3}.csv`
    const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv3, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SR_' + receiptId + '_RG', report_type: 'store_receipt_report',
        report_scope: 'store', scope_id: storeId, scope_name: storeName,
        related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
        file_name: f3, file_url: u3.fileID, file_version: v3,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
        has_abnormal: hasAbnormal, regenerated: true
      }
    })
    generated.push('store_receipt_report')

    // ===== ④ 门店带价收货报表（仅可付款行） =====
    const payableItems = items.filter(item => item.payable_flag !== false && Number(item.price_snapshot) > 0)
    if (payableItems.length > 0) {
      const v4 = await getNextVersion('store_receipt_price_report', storeId, receiptDate)
      let csv4 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('实收数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('是否可付款')].join(',') + '\n'
      let total4 = 0
      payableItems.forEach(item => {
        const price = Number(item.price_snapshot) || 0
        const sub = Math.round((Number(item.received_qty) || 0) * price * 100) / 100
        total4 = Math.round((total4 + sub) * 100) / 100
        csv4 += [csvField(item.product_name), csvField(supplierNameMap[item.supplier_id] || item.supplier_id || ''), csvField(item.received_qty), csvField(item.unit_snapshot || ''), csvField(price), csvField(sub.toFixed(2)), csvField('是')].join(',') + '\n'
      })
      csv4 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(total4.toFixed(2)), csvField('')].join(',') + '\n'
      const f4 = `reports/store/${receiptDate}/store-receipt-price-${safePathPart(storeName)}-${receiptDate}-${receiptId}-regen-v${v4}.csv`
      const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv4, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SRP_' + receiptId + '_RG', report_type: 'store_receipt_price_report',
          report_scope: 'store', scope_id: storeId, scope_name: storeName,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: f4, file_url: u4.fileID, file_version: v4,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          excluded_rows: items.length - payableItems.length, regenerated: true
        }
      })
      generated.push('store_receipt_price_report')
    }

    // ===== ⑤ ⑥ 按供应商分组 =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplier_id || 'unknown'
      if (sid === 'unknown') return
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: supplierNameMap[sid] || sid }
      supplierMap[sid].items.push(item)
    })

    for (const sid of Object.keys(supplierMap)) {
      const sup = supplierMap[sid]
      // ⑤ 供应商到货汇总（不含价）
      const v5 = await getNextVersion('supplier_receipt_report', sid, receiptDate)
      let csv5 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('下单数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注')].join(',') + '\n'
      sup.items.forEach(item => {
        const types = itemAbnormalTypes(item)
        csv5 += [csvField(item.product_name), csvField(sup.name), csvField(storeName), csvField(item.received_qty), csvField(item.order_qty_snapshot), csvField(item.unit_snapshot || ''), csvField(types.length ? '收货异常' : '正常'), csvField(types.join('、')), csvField(item.remark || '')].join(',') + '\n'
      })
      const f5 = `reports/supplier/${receiptDate}/supplier-receipt-${safePathPart(sup.name)}-${receiptDate}-${receiptId}-regen-v${v5}.csv`
      const u5 = await cloud.uploadFile({ cloudPath: f5, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv5, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUR_' + sid + '_' + receiptId + '_RG', report_type: 'supplier_receipt_report',
          report_scope: 'supplier', scope_id: sid, scope_name: sup.name,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: f5, file_url: u5.fileID, file_version: v5,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          has_abnormal: sup.items.some(item => itemAbnormalTypes(item).length > 0), regenerated: true
        }
      })
      generated.push('supplier_receipt_report:' + sid)

      // ⑥ 供应商带价账单（仅可付款行）
      const supPayable = sup.items.filter(item => item.payable_flag !== false && Number(item.price_snapshot) > 0)
      if (supPayable.length > 0) {
        const v6 = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)
        let csv6 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('可付款')].join(',') + '\n'
        let total6 = 0
        supPayable.forEach(item => {
          const price = Number(item.price_snapshot) || 0
          const sub = Math.round((Number(item.received_qty) || 0) * price * 100) / 100
          total6 = Math.round((total6 + sub) * 100) / 100
          csv6 += [csvField(item.product_name), csvField(sup.name), csvField(storeName), csvField(item.received_qty), csvField(item.unit_snapshot || ''), csvField(price), csvField(sub.toFixed(2)), csvField('是')].join(',') + '\n'
        })
        csv6 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(''), csvField(total6.toFixed(2)), csvField('')].join(',') + '\n'
        const f6 = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(sup.name)}-${receiptDate}-${receiptId}-regen-v${v6}.csv`
        const u6 = await cloud.uploadFile({ cloudPath: f6, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv6, 'utf-8') })
        await db.collection('report_file').add({
          data: {
            report_id: 'RPT_SURP_' + sid + '_' + receiptId + '_RG', report_type: 'supplier_receipt_price_report',
            report_scope: 'supplier', scope_id: sid, scope_name: sup.name,
            related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
            file_name: f6, file_url: u6.fileID, file_version: v6,
            generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
            excluded_rows: sup.items.length - supPayable.length, regenerated: true
          }
        })
        generated.push('supplier_receipt_price_report:' + sid)
      }
    }
  } catch (err) {
    console.error('[dataService] 补生成收货报表失败:', err)
    return { code: -1, msg: '补生成失败，请稍后重试（已生成的报表不受影响）', data: { generated } }
  }

  // 补生成成功后清除订单上的缺报表标记
  if (purchaseOrderId) {
    await db.collection('purchase_order')
      .where({ purchase_order_id: purchaseOrderId, missing_reports: true })
      .update({ data: { missing_reports: false, updated_at: db.serverDate() } })
  }
  return { code: 0, data: { generated, count: generated.length } }
}

// ===== B8 提交后作废 =====
// 两阶段：
// 1) 审批前（submitted）：采购员/管理员直接作废；
// 2) 审批后：仅管理员可作废，且要求该订单无任何收货记录（已有收货走异常流程，不能作废）。
// 报表标记 superseded，线下通知供应商。
async function cancelOrder(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const reason = String(event.reason || '').trim()
  if (!reason) return { code: -1, msg: '作废必须填写原因' }
  if (!event.orderId) return { code: -1, msg: '缺少订单号' }

  const orderResult = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const order = orderResult.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }

  // 已有收货记录的订单不能作废（货已到，走异常处理流程）
  if (['partial_received', 'to_receive', 'received', 'receipt_abnormal'].includes(order.order_status)) {
    return { code: -1, msg: '该订单已有收货记录，不能作废，请走异常处理流程' }
  }
  if (!['submitted', 'approved', 'report_generated'].includes(order.order_status)) {
    return { code: -1, msg: '当前状态的订单不可作废' }
  }

  await db.runTransaction(async transaction => {
    const updateData = {
      order_status: 'cancelled',
      cancel_reason: reason,
      cancelled_by: auth.user.name,
      cancelled_at: db.serverDate(),
      updated_at: db.serverDate()
    }
    // 清单 #23：手动单作废时重置核销状态（凭证文件保留在 vouchers/ 留痕，只重置状态）
    if (order.is_manual && order.verify_status && order.verify_status !== 'none') {
      updateData.verify_status = 'none'
      updateData.verify_cancel_note = `订单作废时重置核销状态（原状态 ${order.verify_status}），作废原因：${reason}`
    }
    await transaction.collection('purchase_order').doc(order._id).update({ data: updateData })
    // 关联报表标记 superseded（保留审计痕迹）
    await transaction.collection('report_file')
      .where({ source_order_id: event.orderId, report_type: _.in(['store_order_report', 'supplier_order_report']) })
      .update({ data: { status: 'superseded', updated_at: db.serverDate() } })
  })

  await createMessage({
    type: 'cancel',
    title: '采购单已作废',
    // S3 拍板：供应商触达走线下，消息只提醒内部经办人去通知供应商
    content: `采购单 ${order.order_no || event.orderId} 已作废，原因：${reason}。请采购经办人线下告知供应商，避免其继续备货/发货。`,
    bizId: event.orderId,
    storeId: order.store_id
  })
  return { code: 0 }
}

// ===== B8 采购员申请取消（审批后单据，需管理员确认后执行 cancelOrder）=====
async function requestCancel(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const reason = String(event.reason || '').trim()
  if (!reason) return { code: -1, msg: '申请取消必须填写原因' }
  if (!event.orderId) return { code: -1, msg: '缺少订单号' }

  const orderResult = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const order = orderResult.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (!['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.order_status)) {
    return { code: -1, msg: '当前状态的订单无法申请取消' }
  }
  // 门店归属校验：全局角色可跨门店，门店角色仅可对本门店订单提交取消申请
  if (!GLOBAL_ROLES.includes(auth.user.role) && order.store_id !== (auth.user.default_store_id || '')) {
    return { code: -403, msg: '当前账号无权对该门店订单申请取消' }
  }

  await db.collection('purchase_order').doc(order._id).update({
    data: {
      cancel_requested: true,
      cancel_requested_by: auth.user.name,
      cancel_request_reason: reason,
      cancel_requested_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await createMessage({
    type: 'cancel',
    title: '收到取消申请',
    content: `采购单 ${order.order_no || event.orderId} 收到取消申请，原因：${reason}，请管理员确认处理`,
    bizId: event.orderId,
    storeId: order.store_id
  })
  return { code: 0 }
}

// ===== S9 拍板（2026-09-22）：手动商品专用单凭证核销 =====
// 手动单（is_manual）收货后进入待核销（verify_status='pending'），管理员上传/登记
// 付款凭证并回填实付金额（verify_amount）后核销通过，单据闭环。金额唯一可信来源
// 是凭证，不查协议价表（手动商品无档案、无供应商归属）。
async function verifyManualOrder(event) {
  const action = String(event.verifyAction || '') // submit | approve | reject
  // 权限分两段：提交凭证店长/采购员/管理员；核销裁决仅采购员/管理员
  const auth = await requireUser(event, action === 'submit' ? VOUCHER_SUBMIT_ROLES : GLOBAL_ROLES)
  if (auth.error) return auth.error
  const orderId = String(event.orderId || '').trim()
  const amount = Number(event.amount)
  const voucherFileIds = Array.isArray(event.voucherFileIds) ? event.voucherFileIds.filter(Boolean) : []
  const note = String(event.note || '').trim()

  const orderRes = await db.collection('purchase_order').where({ purchase_order_id: orderId }).limit(1).get()
  const order = orderRes.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (!order.is_manual) return { code: -1, msg: '仅手动商品专用单需要凭证核销' }
  // 店长只能操作本门店的单
  if (auth.user.role === 'store_manager' && order.store_id !== auth.user.default_store_id) {
    return { code: -403, msg: '无权操作其他门店的采购订单' }
  }

  // 提交凭证：店长/采购员/管理员均可；#22 拍板（2026-09-24）：必须收齐（received）才能核销，
  // 部分收货/收货异常的单剩余批次未定，不允许提前闭环
  if (action === 'submit') {
    if (order.order_status !== 'received') {
      return { code: -1, msg: '订单尚未收齐，需全部批次收货完成后才能提交付款凭证' }
    }
    if (order.verify_status === 'approved') return { code: -1, msg: '该单已核销通过，无需重复提交' }
    if (voucherFileIds.length === 0) return { code: -1, msg: '请上传付款证明或发票' }
    // 条件更新兜底并发：已核销的单不允许被重传盖回待核销
    const submitRes = await db.collection('purchase_order')
      .where({ _id: order._id, verify_status: _.neq('approved') })
      .update({
        data: {
          verify_status: 'pending',
          verify_voucher_file_ids: voucherFileIds,
          verify_note: note,
          verify_submitted_by: auth.user.user_id || auth.user._id,
          verify_submitted_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
    if (!submitRes.stats || submitRes.stats.updated === 0) {
      return { code: -1, msg: '该单已核销通过，无需重复提交' }
    }
    // 被替换掉的旧凭证图从云存储清掉，避免驳回重传堆积孤儿文件
    const oldFileIds = Array.isArray(order.verify_voucher_file_ids) ? order.verify_voucher_file_ids : []
    const staleFileIds = oldFileIds.filter(id => id && !voucherFileIds.includes(id))
    if (staleFileIds.length) {
      try {
        await cloud.deleteFile({ fileList: staleFileIds })
      } catch (err) {
        console.error('[verifyManualOrder] 清理旧凭证文件失败:', err)
      }
    }
    return { code: 0, data: { message: '凭证已提交，等待管理员核销' } }
  }

  // 核销裁决：仅管理员/采购员；条件更新保证只有 pending 状态可被裁决，防止并发重复核销
  if (!['approve', 'reject'].includes(action)) return { code: -1, msg: '无效的核销动作' }
  if (order.verify_status !== 'pending') return { code: -1, msg: '该单没有待核销的凭证' }
  if (action === 'reject') {
    const rejectRes = await db.collection('purchase_order')
      .where({ _id: order._id, verify_status: 'pending' })
      .update({
        // 驳回原因单独存 verify_reject_note，重传的备注不覆盖核销人写的驳回原因
        data: { verify_status: 'rejected', verify_reject_note: note, updated_at: db.serverDate() }
      })
    if (!rejectRes.stats || rejectRes.stats.updated === 0) {
      return { code: -1, msg: '该单核销状态已变化，请刷新后重试' }
    }
    return { code: 0, data: { message: '已驳回，请门店重新提交凭证' } }
  }
  if (!Number.isFinite(amount) || amount <= 0) return { code: -1, msg: '请填写大于0的实付金额' }
  const approveRes = await db.collection('purchase_order')
    .where({ _id: order._id, verify_status: 'pending' })
    .update({
      data: {
        verify_status: 'approved',
        verify_amount: amount,
        verify_note: note,
        verified_by: auth.user.user_id || auth.user._id,
        verified_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!approveRes.stats || approveRes.stats.updated === 0) {
    return { code: -1, msg: '该单核销状态已变化，请刷新后重试' }
  }
  return { code: 0, data: { message: '核销完成，实付金额已回填' } }
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
      case 'settleReceipt': return await settleReceipt(event)
      case 'regenerateReceiptReports': return await regenerateReceiptReports(event)
      case 'regenerateOrderReports': return await regenerateOrderReports(event)
      case 'cancelOrder': return await cancelOrder(event)
      case 'requestCancel': return await requestCancel(event)
      case 'verifyManualOrder': return await verifyManualOrder(event)
      default: return { code: -1, msg: '不支持的数据操作' }
    }
  } catch (err) {
    console.error('[dataService] CloudBase 数据操作失败:', err)
    return { code: -1, msg: 'CloudBase 数据操作失败，请稍后重试' }
  }
}
