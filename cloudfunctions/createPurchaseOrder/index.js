// 云函数 createPurchaseOrder - 创建采购申请 + 自动生成报表
// 修复：增加供应商订货汇总报表生成 + CSV双引号包裹 + 版本号自动递增
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

// 辅助：用双引号包裹CSV字段，防止逗号问题
function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

// Submission messages are best-effort: a message failure must not turn a
// successfully committed order into a client-visible failure.
async function createSubmissionMessage(orderNo, orderDate, storeId, storeName) {
  try {
    await db.collection('message').add({
      data: {
        message_id: 'MSG' + Date.now() + Math.floor(Math.random() * 1000),
        type: 'order',
        title: '采购申请已提交',
        content: `${orderDate} ${storeName}采购申请已成功提交`,
        biz_id: orderNo,
        recipient_user_id: '',
        store_id: storeId,
        read: false,
        created_at: db.serverDate()
      }
    })
  } catch (err) {
    console.error('[createPurchaseOrder] 提交消息写入失败:', err)
  }
}

// 辅助：查询同类报表最高版本号。版本号仅用于展示，报表路径已含单号保证唯一；
// 查询失败必须向上抛出，不能静默回落 v1 加剧版本号竞争。
async function getNextVersion(reportType, scopeId, relatedDate) {
  const res = await db.collection('report_file')
    .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
    .orderBy('file_version', 'desc')
    .limit(1)
    .get()
  return res.data.length > 0 ? (Number(res.data[0].file_version) || 0) + 1 : 1
}

exports.main = async (event = {}) => {
  let persistedOrderNo = ''
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (!['chef', 'store_manager', 'super_admin', 'purchaser'].includes(user.role)) {
      return { code: -403, msg: '当前账号无权创建采购订单' }
    }
    const {
      orderId,
      storeId: inputStoreId,
      storeName: inputStoreName,
      orderDate,
      deliveryDate,
      createdBy,
      createdByName,
      items: inputItems,
      remark,
      orderStatus = 'submitted',
      requestId = ''
    } = event
    let items = inputItems
    // 业务日期按 UTC+8（项目用户全部在中国时区），避免凌晨 0-8 点落到前一天
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const actualDate = orderDate || today
    // delivery_date was added after the initial schema. Keep orderDate as a
    // backwards-compatible fallback for old callers and old records.
    const actualDeliveryDate = deliveryDate || orderDate || today
    const isDate = value => {
      const text = String(value)
      const date = new Date(`${text}T00:00:00Z`)
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    }
    if (!isDate(actualDate) || !isDate(actualDeliveryDate) || actualDeliveryDate < actualDate) {
      return { code: -1, msg: '采购日期或期望到货日期无效' }
    }

    // 幂等防御：前端请求超时但服务端实际成功时，用户重试会带同一 requestId。
    // 命中同用户已建的单则直接返回该单号，不再重复建单。
    let idempotentOrderNo = ''
    let idempotentIsDraft = false
    const trimmedRequestId = String(requestId || '').trim()
    if (trimmedRequestId) {
      const dupRes = await db.collection('purchase_order')
        .where({ request_id: trimmedRequestId, created_by: user.user_id || user._id })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get()
      if (dupRes.data.length) {
        idempotentOrderNo = dupRes.data[0].purchase_order_id
        idempotentIsDraft = dupRes.data[0].order_status === 'draft'
      }
    }
    let existingOrder = null
    let storeId = inputStoreId
    let storeName = inputStoreName
    // 幂等命中：该请求此前已成功建单，直接返回原单号（不区分草稿/已提交）。
    // 例外：命中的正是本次要编辑的草稿（同单号且仍为草稿）——用户在同页修改内容后
    // 再次保存，必须继续走编辑流程应用变更，否则修改被幂等短路静默丢弃。
    if (idempotentOrderNo && !(orderId && orderId === idempotentOrderNo && idempotentIsDraft)) {
      return { code: 0, data: { orderId: idempotentOrderNo, reportGenerated: false, reportsGenerated: 0, idempotent: true } }
    }
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!user.default_store_id || (storeId && storeId !== user.default_store_id)) return { code: -403, msg: '无权为其他门店创建采购订单' }
      storeId = user.default_store_id
      const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
      if (!storeRes.data.length) return { code: -403, msg: '账号未关联有效门店' }
      storeName = storeRes.data[0].store_name
    }

    if (orderId) {
      const existingRes = await db.collection('purchase_order')
        .where({ purchase_order_id: orderId })
        .limit(1)
        .get()
      if (!existingRes.data.length) return { code: -1, msg: '订单不存在' }
      existingOrder = existingRes.data[0]
      if (existingOrder.order_status !== 'draft') {
        return { code: -1, msg: '只有草稿订单可以编辑或提交' }
      }
      if (!isGlobal && (existingOrder.store_id !== user.default_store_id || existingOrder.created_by !== (user.user_id || user._id))) {
        return { code: -403, msg: '无权编辑该草稿订单' }
      }
      if (isGlobal && inputStoreId && existingOrder.store_id !== inputStoreId) {
        return { code: -403, msg: '编辑草稿时不能更换门店' }
      }
      storeId = storeId || existingOrder.store_id
      storeName = storeName || existingOrder.store_name
    }

    if (isGlobal) {
      if (!storeId) return { code: -1, msg: '门店和采购商品不能为空' }
      const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
      if (!storeRes.data.length) return { code: -403, msg: '门店不存在或已停用' }
      storeName = storeRes.data[0].store_name
    }

    if (!storeId || !storeName || !Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '门店和采购商品不能为空' }
    }
    if (!['draft', 'submitted'].includes(orderStatus)) {
      return { code: -1, msg: '采购单状态无效' }
    }

    if (items.length > 100) return { code: -1, msg: '每单商品最多100种' }

    // Validate and normalize against database records. Client snapshots are
    // only display data and must not become the persisted order truth.
    const productIds = [...new Set(items.filter(item => item && !item.isManual && item.productId).map(item => item.productId))]
    const productMap = {}
    for (let i = 0; i < productIds.length; i += 20) {
      const idChunk = productIds.slice(i, i + 20)
      const productRes = await db.collection('product')
        .where({ product_id: _.in(idChunk), status: 1 })
        .limit(100)
        .get()
      productRes.data.forEach(product => { productMap[product.product_id] = product })
    }
    const seenProductIds = {}
    const normalizedItems = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {}
      const productId = String(item.productId || '').trim()
      const productName = String(item.productName || '').trim()
      const unit = String(item.unit || '').trim()
      const qty = Number(item.orderQty)
      if (!productId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) {
        return { code: -1, msg: '商品信息或采购数量无效，请检查后重试' }
      }
      if (seenProductIds[productId]) return { code: -1, msg: '采购商品不能重复，请检查后重试' }
      seenProductIds[productId] = true
      if (item.isManual) {
        if (!productName || !unit) return { code: -1, msg: '手动商品名称和单位不能为空' }
        normalizedItems.push({ ...item, productId, productName, unit, orderQty: qty, supplierId: '', isManual: true })
        continue
      }
      const product = productMap[productId]
      if (!product) return { code: -1, msg: '部分商品已下架或不存在，请刷新商品列表后重试' }
      normalizedItems.push({
        ...item,
        productId,
        productName: product.product_name,
        category: product.category_name || product.category_level_1 || item.category || '',
        unit: product.unit,
        supplierId: product.default_supplier_id || '',
        orderQty: qty,
        isManual: false
      })
    }
    items = normalizedItems

    // 校验手动商品数量
    const manualCount = items.filter(i => i.isManual).length
    if (manualCount > 5) {
      return { code: -1, msg: '手动商品每单最多5个' }
    }
    // S9 拍板（2026-09-22）：强制拆单——手动商品与档案商品不可混单（后端兜底，防绕过前端）
    if (manualCount > 0 && manualCount < items.length) {
      return { code: -1, msg: '手动商品需单独下单：手动商品与档案商品不能混在同一张采购单' }
    }

    // 编辑草稿时沿用原订单号；新建时生成订单号。
    const dateStr = actualDate.replace(/-/g, '')
    // 订单号：日期 + 毫秒(base36) + 4位随机hex。旧版只有毫秒低4位（周期10秒），
    // 无唯一索引兜底时碰撞会静默产生同号双单。
    const orderNo = orderId || ('PO' + dateStr + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'))

    const orderData = {
      store_id: storeId,
      store_name: storeName,
      order_date: actualDate,
      delivery_date: actualDeliveryDate,
      order_status: orderStatus,
      // S9 拍板（2026-09-22）：手动商品专用单标记（整单只有手动商品才有值，混单已在上方拦截）
      is_manual: manualCount > 0,
      // 凭证核销状态：手动单收货后进入待核销，管理员核销回填实付金额后闭环（B 方案）
      verify_status: manualCount > 0 ? 'none' : '',
      verify_amount: null,
      verify_voucher_file_ids: [],
      request_id: trimmedRequestId,
      remark: remark || '',
      updated_at: db.serverDate()
    }
    orderData.created_by = existingOrder
      ? (existingOrder.created_by || user.user_id || user._id)
      : (user.user_id || user._id)
    orderData.created_by_name = existingOrder
      ? (existingOrder.created_by_name || user.name || user.username || '')
      : (user.name || user.username || '')
    if (orderStatus === 'submitted') orderData.submitted_at = db.serverDate()

    // The order header and all lines must commit together. A failed write
    // must never leave a submitted order without (or with half of) its lines.
    await db.runTransaction(async transaction => {
      if (existingOrder) {
        await transaction.collection('purchase_order').doc(existingOrder._id).update({ data: orderData })
        const oldItems = await transaction.collection('purchase_order_item')
          .where({ purchase_order_id: orderNo })
          .limit(1000)
          .get()
        for (const oldItem of oldItems.data) {
          await transaction.collection('purchase_order_item').doc(oldItem._id).remove()
        }
      } else {
        await transaction.collection('purchase_order').add({
          data: {
            purchase_order_id: orderNo, order_no: orderNo,
            ...orderData,
            created_by: orderData.created_by,
            created_by_name: orderData.created_by_name,
            created_at: db.serverDate()
          }
        })
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        await transaction.collection('purchase_order_item').add({
          data: {
            item_id: orderNo + '_' + (i + 1),
            purchase_order_id: orderNo,
            product_id: item.productId,
            product_name_snapshot: item.productName,
            category_snapshot: item.category,
            unit_snapshot: item.unit,
            supplier_id: item.supplierId || '',
            order_qty: item.orderQty,
            is_manual: item.isManual || false,
            remark: item.remark || '',
            created_at: db.serverDate()
          }
        })
      }
    })
    persistedOrderNo = orderNo

    if (orderStatus === 'draft') {
      return { code: 0, data: { orderId: orderNo, reportGenerated: false, reportsGenerated: 0 } }
    }

    await createSubmissionMessage(orderNo, actualDate, storeId, storeName)

    const reportsGenerated = []

    // ===== 报表1: 门店下单报表 =====
    const storeVer = await getNextVersion('store_order_report', storeId, actualDate)
    // S9：手动商品专用单在报表头打标，区分口径（不推送供应商、金额走凭证核销）
    const manualTag = manualCount > 0 ? [csvField('单据类型'), csvField('手动商品专用单（线下采购，凭证核销）')].join(',') + '\n' : ''
    const csv1Info = manualTag + [csvField('采购单号'), csvField(orderNo), csvField('门店'), csvField(storeName), csvField('下单日期'), csvField(actualDate), csvField('期望到货'), csvField(actualDeliveryDate), csvField('经办人'), csvField(createdByName || '')].join(',') + '\n'
    let csv1 = csv1Info + [csvField('商品名称'), csvField('分类'), csvField('单位'), csvField('下单数量'), csvField('备注')].join(',') + '\n'
    items.forEach(item => {
      csv1 += [csvField(item.productName), csvField(item.category), csvField(item.unit), csvField(item.orderQty), csvField(item.remark || '')].join(',') + '\n'
    })
    const f1 = `reports/store/${actualDate}/store-order-${safePathPart(storeName)}-${actualDate}-${orderNo}-v${storeVer}.csv`
    const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SO_' + orderNo, report_type: 'store_order_report',
        report_scope: 'store', scope_id: storeId, scope_name: storeName,
        related_date: actualDate, source_order_id: orderNo, basis_date_type: 'order_date',
        file_name: f1, file_url: u1.fileID, file_version: storeVer,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
      }
    })
    reportsGenerated.push('store_order_report')

    // ===== 报表2: 供应商订货汇总（按供应商分组） =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplierId || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
      supplierMap[sid].items.push(item)
    })

    // 查供应商名称（批量，避免每个供应商一次数据库请求）
    let supplierReportsGenerated = 0
    const orderSupplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
    for (let i = 0; i < orderSupplierIds.length; i += 20) {
      const idChunk = orderSupplierIds.slice(i, i + 20)
      const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
      supRes.data.forEach(s => {
        if (supplierMap[s.supplier_id]) {
          supplierMap[s.supplier_id].name = s.supplier_name
          supplierMap[s.supplier_id].contact = [s.contact_name, s.contact_phone].filter(Boolean).join(' ')
        }
      })
    }

    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue // 手动商品无供应商
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const supVer = await getNextVersion('supplier_order_report', sid, actualDate)

      let csvSup = [csvField('采购单号'), csvField(orderNo), csvField('供应商'), csvField(supName), csvField('联系人'), csvField(supplierMap[sid].contact || ''), csvField('下单日期'), csvField(actualDate), csvField('期望到货'), csvField(actualDeliveryDate)].join(',') + '\n'
      csvSup += [csvField('门店'), csvField('商品名称'), csvField('订货数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        csvSup += [csvField(storeName), csvField(item.productName), csvField(item.orderQty), csvField(item.unit), csvField(item.remark || '')].join(',') + '\n'
      })

      const fSup = `reports/supplier/${actualDate}/supplier-order-${safePathPart(supName)}-${actualDate}-${orderNo}-v${supVer}.csv`
      const uSup = await cloud.uploadFile({ cloudPath: fSup, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csvSup, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUO_' + sid + '_' + orderNo, report_type: 'supplier_order_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: actualDate, source_order_id: orderNo, basis_date_type: 'order_date',
          file_name: fSup, file_url: uSup.fileID, file_version: supVer,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
      supplierReportsGenerated++
    }
    if (supplierReportsGenerated > 0) reportsGenerated.push('supplier_order_report')

    return {
      code: 0,
      data: { orderId: orderNo, reportGenerated: true, reportsGenerated: reportsGenerated.length }
    }
  } catch (err) {
    // The order is already durable if report generation failed afterwards.
    // Return success with a warning so the client does not retry and create a
    // duplicate order or incorrectly report that the save failed.
    if (persistedOrderNo) {
      console.error('[createPurchaseOrder] 订单已保存，但报表生成失败:', err)
      // 清单 #7：缺口从"静默缺失"变为"有标记、有提示"，管理员可经
      // dataService.regenerateOrderReports 补生成 ① ② 报表。
      try {
        await db.collection('purchase_order')
          .where({ purchase_order_id: persistedOrderNo })
          .update({ data: { missing_reports: true, updated_at: db.serverDate() } })
        const adminRes = await db.collection('app_user')
          .where({ role: 'super_admin', status: 1 })
          .limit(1)
          .get()
        const adminId = (adminRes.data[0] && (adminRes.data[0].user_id || adminRes.data[0]._id)) || ''
        await db.collection('message').add({
          data: {
            message_id: `MSG_ORDER_REPORT_MISSING_${persistedOrderNo}`,
            type: 'abnormal',
            title: '订货报表生成失败',
            content: `采购单 ${persistedOrderNo} 已保存，但订货报表生成失败，请管理员补生成。`,
            biz_id: persistedOrderNo,
            recipient_user_id: adminId,
            store_id: orderData && orderData.store_id || '',
            read: false,
            read_by: [],
            created_at: db.serverDate()
          }
        })
      } catch (markErr) {
        console.error('[createPurchaseOrder] 缺报表标记/通知写入失败:', markErr)
      }
      return {
        code: 0,
        data: { orderId: persistedOrderNo, reportGenerated: false, reportsGenerated: 0, reportWarning: '订单已保存，但报表生成失败，请联系管理员处理。' }
      }
    }
    console.error('[createPurchaseOrder] 采购订单保存失败:', err)
    return { code: -1, msg: '采购订单保存失败，请稍后重试' }
  }
}
