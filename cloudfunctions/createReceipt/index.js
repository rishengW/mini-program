// 云函数 createReceipt - 收货确认 + 按验收结果生成收货报表
// 正常收货生成含价格报表；异常收货只生成不含价格报表并登记异常。
const cloud = require('wx-server-sdk')
const { requireUser } = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货'
}

function getItemAbnormalTypes(item) {
  const types = []
  if (item && item.isShortage) types.push('shortage')
  if (item && item.isQualityIssue) types.push('quality')
  if (item && item.isWrongItem) types.push('wrong_item')
  return types
}

function getItemAbnormalNames(item) {
  return getItemAbnormalTypes(item).map(type => ABNORMAL_TYPE_NAMES[type] || type)
}

async function getNextVersion(reportType, scopeId, relatedDate) {
  // 版本号仅用于展示，报表路径已含收货单号保证唯一；
  // 查询失败必须向上抛出，不能静默回落 v1 加剧版本号竞争。
  const res = await db.collection('report_file')
    .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
    .orderBy('file_version', 'desc').limit(1).get()
  return res.data.length > 0 ? (Number(res.data[0].file_version) || 0) + 1 : 1
}

// Backfill the notification for receipts created by an older deployment.
// This is intentionally best-effort on the duplicate path: an existing
// receipt must remain reportable even if the message collection is unavailable.
async function ensureReceiptMessage(receipt, fallbackStoreId, fallbackStoreName) {
  const receiptId = receipt && (receipt.receipt_id || receipt.receiptId)
  if (!receiptId) return
  try {
    const existing = await db.collection('message')
      .where({ biz_id: receiptId })
      .limit(1)
      .get()
    if (existing.data.length > 0) return
    const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
    const storeId = receipt.store_id || fallbackStoreId || ''
    const storeName = receipt.store_name || fallbackStoreName || ''
    const isAbnormal = receipt.receipt_status === 'abnormal'
    await db.collection('message').add({
      data: {
        message_id: `MSG_RECEIVE_${receiptId}`,
        type: isAbnormal ? 'abnormal' : 'receive',
        title: isAbnormal ? '收货异常待处理' : '收货验收完成',
        content: isAbnormal
          ? `${receiptDate} ${storeName}收货存在异常，请及时处理`
          : `${receiptDate} ${storeName}采购单已完成收货验收`,
        biz_id: receiptId,
        recipient_user_id: '',
        store_id: storeId,
        read: false,
        created_at: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[createReceipt] 收货消息补写失败:', err)
  }
}

exports.main = async (event = {}) => {
  try {
    const auth = await requireUser(event, ['store_manager', 'super_admin', 'purchaser'])
    if (auth.error) return auth.error
    const user = auth.user
    let {
      purchaseOrderId,
      storeId,
      storeName,
      receivedBy = '',
      overallRemark = '',
      photoFileIds = [],
      items
    } = event || {}
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!user.default_store_id || (storeId && storeId !== user.default_store_id)) return { code: -403, msg: '无权为其他门店提交收货' }
      storeId = user.default_store_id
      const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
      if (!storeRes.data.length) return { code: -403, msg: '账号未关联有效门店' }
      storeName = storeRes.data[0].store_name
    }
    if (!purchaseOrderId) {
      return { code: -1, msg: '订单信息缺失，请返回订单列表后重新进入验收' }
    }
    if (!storeId || !storeName) {
      return { code: -1, msg: '门店信息缺失，请重新登录或切换门店后再试' }
    }
    const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
    if (!storeRes.data.length) return { code: -403, msg: '门店不存在或已停用' }
    storeName = storeRes.data[0].store_name
    if (!Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '验收商品信息为空，请返回订单后重试' }
    }
    if (items.length > 100) {
      return { code: -1, msg: '每单验收商品最多100种' }
    }
    const hasInvalidItem = items.some(item => (
      !item || !item.productId || !item.productName || !item.unit ||
      typeof item.receivedQty !== 'number' || !Number.isFinite(item.receivedQty) || item.receivedQty < 0 ||
      typeof item.orderQty !== 'number' || !Number.isFinite(item.orderQty)
    ))
    if (hasInvalidItem) {
      return { code: -1, msg: '部分商品的验收信息不完整，请检查后重试' }
    }
    if (!Array.isArray(photoFileIds)) {
      return { code: -1, msg: '验收照片信息格式不正确，请重新选择照片' }
    }
    if (photoFileIds.length > 9) {
      return { code: -1, msg: '验收照片最多9张' }
    }
    // 照片 fileID 必须位于本订单的上传目录下（路径规则见 utils/cloud.js 的 uploadReceiptPhotos）
    const photoPrefix = `receipts/${purchaseOrderId}/`
    if (photoFileIds.some(id => typeof id !== 'string' || !id.includes(photoPrefix))) {
      return { code: -1, msg: '验收照片信息无效，请重新上传' }
    }

    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1)
      .get()
    if (orderRes.data.length === 0) {
      return { code: -1, msg: '采购订单不存在或已失效，请刷新订单后重试' }
    }
    const order = orderRes.data[0]
    if (order.store_id && order.store_id !== storeId) {
      return { code: -1, msg: '订单门店与当前门店不一致，请切换门店后重试' }
    }
    if (!['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.order_status)) {
      return { code: -1, msg: '当前订单状态不可收货' }
    }
    storeName = order.store_name || storeName
    receivedBy = user.name || user.username || receivedBy
    if (!isGlobal && order.store_id !== user.default_store_id) return { code: -403, msg: '无权验收其他门店订单' }

    // The order lines in the database are authoritative. Do not trust the
    // client to identify products, suppliers, units, or ordered quantities.
    const orderItemsRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1000)
      .get()
    const orderItems = orderItemsRes.data || []
    if (orderItems.length === 0) return { code: -1, msg: '订单明细不存在，无法提交收货' }
    const orderItemMap = {}
    orderItems.forEach(orderItem => {
      const key = orderItem.item_id || orderItem._id
      if (key) orderItemMap[key] = orderItem
    })
    const seenOrderItems = {}
    const canonicalItems = []
    for (let i = 0; i < items.length; i++) {
      const inputItem = items[i]
      const orderItemId = inputItem.orderItemId
      const orderItem = orderItemMap[orderItemId]
      if (!orderItem || seenOrderItems[orderItemId]) {
        return { code: -1, msg: '验收明细与采购订单不匹配，请刷新订单后重试' }
      }
      seenOrderItems[orderItemId] = true
      const orderQty = Number(orderItem.order_qty)
      const receivedQty = Number(inputItem.receivedQty)
      if (!Number.isFinite(orderQty) || orderQty < 0 || !Number.isFinite(receivedQty) || receivedQty < 0 || receivedQty > orderQty) {
        return { code: -1, msg: '实收数量不能超过订单数量，请检查后重试' }
      }
      canonicalItems.push({
        ...inputItem,
        orderItemId,
        productId: orderItem.product_id,
        productName: orderItem.product_name_snapshot,
        supplierId: orderItem.supplier_id || '',
        orderQty,
        unit: orderItem.unit_snapshot,
        receivedQty
      })
    }
    if (canonicalItems.length !== orderItems.length) {
      return { code: -1, msg: '验收明细不完整，请确认所有商品后重试' }
    }
    items = canonicalItems
    const existingReceiptRes = await db.collection('receipt')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1)
      .get()
    if (existingReceiptRes.data.length > 0 || order.order_status === 'received') {
      await ensureReceiptMessage(existingReceiptRes.data[0], storeId, storeName)
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }

    // 收货日期：优先用客户端传入的本地日期（校验格式），否则按 UTC+8 取服务端日期，
    // 避免凌晨 0-8 点收货被归档到前一天。
    const isReceiptDate = value => {
      const text = String(value || '')
      const date = new Date(`${text}T00:00:00Z`)
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    }
    const receiptDate = isReceiptDate(event.receiptDate)
      ? event.receiptDate
      : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const receiptId = 'RCP' + Date.now()

    // 实收少于下单即为少货，即使用户未手动勾选也按异常处理：
    // 避免短收被静默记为"已收货"，少货行不进入付款结算，走异常流程跟进。
    items.forEach(item => {
      if (item.receivedQty < item.orderQty) item.isShortage = true
    })

    const hasAbnormal = items.some(item => getItemAbnormalTypes(item).length > 0)
    const abnormalTypeNames = [...new Set(items.reduce((all, item) => all.concat(getItemAbnormalNames(item)), []))]

    // 价格以数据库中的当前供应商价格为准，避免客户端旧价格进入结算报表。
    // 批量取价：按 product_id 分块一次查回，再在内存中按 (供应商, 商品) 匹配，
    // 避免每条明细一次数据库请求。
    const priceMap = {}
    const priceProductIds = [...new Set(items.filter(item => item.supplierId).map(item => item.productId))]
    for (let i = 0; i < priceProductIds.length; i += 20) {
      const idChunk = priceProductIds.slice(i, i + 20)
      const priceRes = await db.collection('supplier_product_price')
        .where({ product_id: _.in(idChunk), is_current: 1 })
        .limit(100)
        .get()
      priceRes.data.forEach(p => { priceMap[`${p.supplier_id}|${p.product_id}`] = Number(p.price) || 0 })
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const priceSnapshot = item.supplierId ? (priceMap[`${item.supplierId}|${item.productId}`] || 0) : 0
      item.priceSnapshot = priceSnapshot
      // Never present a zero-priced line as payable. A missing current price
      // requires price setup before it can enter the payable total.
      // 异常商品不得进入付款结算，即使客户端传入了可付款标记。
      item.payableFlag = getItemAbnormalTypes(item).length === 0 && item.payableFlag !== false && priceSnapshot > 0
    }

    // 收货主表、明细和订单状态必须同时成功或同时回滚。
    await db.runTransaction(async transaction => {
      const latestOrderRes = await transaction.collection('purchase_order').doc(order._id).get()
      if (!latestOrderRes.data || ['received', 'receipt_abnormal'].includes(latestOrderRes.data.order_status)) {
        const duplicateError = new Error('RECEIPT_EXISTS')
        duplicateError.code = 'RECEIPT_EXISTS'
        throw duplicateError
      }
      if (!['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(latestOrderRes.data.order_status)) {
        const statusError = new Error('ORDER_NOT_RECEIVABLE')
        statusError.code = 'ORDER_NOT_RECEIVABLE'
        throw statusError
      }

      await transaction.collection('receipt').add({
        data: {
          receipt_id: receiptId, purchase_order_id: purchaseOrderId,
          store_id: storeId, store_name: storeName,
          receipt_date: receiptDate, received_by: receivedBy,
          receipt_status: hasAbnormal ? 'abnormal' : 'completed', overall_remark: overallRemark,
          photo_file_ids: photoFileIds.filter(Boolean),
          created_at: db.serverDate()
        }
      })

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        await transaction.collection('receipt_item').add({
          data: {
            receipt_item_id: receiptId + '_' + (i + 1),
            receipt_id: receiptId,
            purchase_order_item_id: item.orderItemId || '',
            product_id: item.productId,
            product_name: item.productName,
            supplier_id: item.supplierId || '',
            received_qty: item.receivedQty,
            order_qty_snapshot: item.orderQty,
            unit_snapshot: item.unit,
            price_snapshot: item.priceSnapshot,
            payable_flag: item.payableFlag !== false,
            is_shortage: !!item.isShortage,
            is_quality_issue: !!item.isQualityIssue,
            is_wrong_item: !!item.isWrongItem,
            remark: item.remark || '',
            created_at: db.serverDate()
          }
        })

        const abnormalTypes = []
        if (item.isShortage) abnormalTypes.push('shortage')
        if (item.isQualityIssue) abnormalTypes.push('quality')
        if (item.isWrongItem) abnormalTypes.push('wrong_item')
        for (let j = 0; j < abnormalTypes.length; j++) {
          const type = abnormalTypes[j]
          let description = `${item.productName}验收异常`
          if (type === 'shortage') {
            description = `${item.productName}下单${item.orderQty}${item.unit}，实收${item.receivedQty}${item.unit}`
          } else if (type === 'quality') {
            description = `${item.productName}存在质量问题`
          } else if (type === 'wrong_item') {
            description = `${item.productName}存在错货问题`
          }
          if (item.remark) description += `：${item.remark}`
          await transaction.collection('abnormal_record').add({
            data: {
              abnormal_id: `${receiptId}_${i + 1}_${type}`,
              receipt_id: receiptId,
              purchase_order_id: purchaseOrderId,
              product_id: item.productId,
              supplier_id: item.supplierId || '',
              store_id: storeId,
              store_name: storeName,
              type,
              description,
              status: 'pending',
              resolution: '',
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          })
        }
      }

      await transaction.collection('purchase_order')
        .doc(order._id)
        .update({ data: { order_status: hasAbnormal ? 'receipt_abnormal' : 'received', updated_at: db.serverDate() } })

      // The message is part of the same transaction as the receipt, so a
      // committed receipt always appears in the message center.  A stable id
      // also makes the record easy to identify if the client retries after a
      // lost response.
      await transaction.collection('message').add({
        data: {
          message_id: `MSG_RECEIVE_${receiptId}`,
          type: hasAbnormal ? 'abnormal' : 'receive',
          title: hasAbnormal ? '收货异常待处理' : '收货验收完成',
          content: hasAbnormal
            ? `${receiptDate} ${storeName}收货存在${abnormalTypeNames.join('、')}，请及时处理`
            : `${receiptDate} ${storeName}采购单已完成收货验收`,
          biz_id: receiptId,
          recipient_user_id: '',
          store_id: storeId,
          read: false,
          created_at: db.serverDate()
        }
      })
    })

    const reportsGenerated = []
    let reportWarning = ''

    try {
      // ===== 报表1: 门店收货报表 =====
      const v1 = await getNextVersion('store_receipt_report', storeId, receiptDate)
      let csv1 = [csvField('商品名称'), csvField('下单数量'), csvField('实收数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注'), csvField('是否可付款')].join(',') + '\n'
      items.forEach(item => {
        const abnormalNames = getItemAbnormalNames(item)
        csv1 += [csvField(item.productName), csvField(item.orderQty), csvField(item.receivedQty), csvField(item.unit), csvField(abnormalNames.length ? '收货异常' : '正常'), csvField(abnormalNames.join('、')), csvField(item.remark || ''), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      const f1 = `reports/store/${receiptDate}/store-receipt-${safePathPart(storeName)}-${receiptDate}-${receiptId}-v${v1}.csv`
      const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SR_' + receiptId, report_type: 'store_receipt_report',
          report_scope: 'store', scope_id: storeId, scope_name: storeName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f1, file_url: u1.fileID, file_version: v1,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          has_abnormal: hasAbnormal, abnormal_summary: abnormalTypeNames.join('、')
        }
      })
      reportsGenerated.push('store_receipt_report')

    // 异常验收不生成任何带价格报表，避免异常商品进入付款结算。
    if (!hasAbnormal) {
      // ===== 报表2: 门店带价格收货报表 =====
      const v2 = await getNextVersion('store_receipt_price_report', storeId, receiptDate)
      let csv2 = [csvField('商品名称'), csvField('实收数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('是否可付款')].join(',') + '\n'
      let totalAmount = 0
      items.forEach(item => {
        const price = item.priceSnapshot || 0
        // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
        const subtotal = Math.round(item.receivedQty * price * 100) / 100
        totalAmount = Math.round((totalAmount + subtotal) * 100) / 100
        csv2 += [csvField(item.productName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(subtotal.toFixed(2)), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      csv2 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(totalAmount.toFixed(2)), csvField('')].join(',') + '\n'
      const f2 = `reports/store/${receiptDate}/store-receipt-price-${safePathPart(storeName)}-${receiptDate}-${receiptId}-v${v2}.csv`
      const u2 = await cloud.uploadFile({ cloudPath: f2, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv2, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SRP_' + receiptId, report_type: 'store_receipt_price_report',
          report_scope: 'store', scope_id: storeId, scope_name: storeName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f2, file_url: u2.fileID, file_version: v2,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
      reportsGenerated.push('store_receipt_price_report')
    }

    // ===== 按供应商分组 =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplierId || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
      supplierMap[sid].items.push(item)
    })
    // 批量查供应商名称，避免每个供应商一次数据库请求
    const receiptSupplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
    for (let i = 0; i < receiptSupplierIds.length; i += 20) {
      const idChunk = receiptSupplierIds.slice(i, i + 20)
      const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
      supRes.data.forEach(s => {
        if (supplierMap[s.supplier_id]) supplierMap[s.supplier_id].name = s.supplier_name
      })
    }

    // ===== 报表3: 供应商到货汇总（不含价格） =====
    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const supplierHasAbnormal = supItems.some(item => getItemAbnormalTypes(item).length > 0)
      const supplierAbnormalSummary = [...new Set(supItems.reduce((all, item) => all.concat(getItemAbnormalNames(item)), []))].join('、')
      const v3 = await getNextVersion('supplier_receipt_report', sid, receiptDate)

      let csv3 = [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('下单数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        const abnormalNames = getItemAbnormalNames(item)
        csv3 += [csvField(item.productName), csvField(storeName), csvField(item.receivedQty), csvField(item.orderQty), csvField(item.unit), csvField(abnormalNames.length ? '收货异常' : '正常'), csvField(abnormalNames.join('、')), csvField(item.remark || '')].join(',') + '\n'
      })

      const f3 = `reports/supplier/${receiptDate}/supplier-receipt-${safePathPart(supName)}-${receiptDate}-${receiptId}-v${v3}.csv`
      const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv3, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUR_' + sid + '_' + receiptId, report_type: 'supplier_receipt_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f3, file_url: u3.fileID, file_version: v3,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          has_abnormal: supplierHasAbnormal, abnormal_summary: supplierAbnormalSummary
        }
      })
      reportsGenerated.push('supplier_receipt_report:' + sid)
    }

    // ===== 报表4: 供应商带价格账单 =====
    if (!hasAbnormal) for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const v4 = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)

      let csv4 = [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('可付款')].join(',') + '\n'
      let sTotal = 0
      supItems.forEach(item => {
        const price = item.priceSnapshot || 0
        // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
        const sub = Math.round(item.receivedQty * price * 100) / 100
        sTotal = Math.round((sTotal + sub) * 100) / 100
        csv4 += [csvField(item.productName), csvField(storeName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(sub.toFixed(2)), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      csv4 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(sTotal.toFixed(2)), csvField('')].join(',') + '\n'

      const f4 = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(supName)}-${receiptDate}-${receiptId}-v${v4}.csv`
      const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv4, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SURP_' + sid + '_' + receiptId, report_type: 'supplier_receipt_price_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f4, file_url: u4.fileID, file_version: v4,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
      reportsGenerated.push('supplier_receipt_price_report:' + sid)
    }
    } catch (reportErr) {
      console.error('[createReceipt] 收货已保存，但报表生成失败:', reportErr)
      reportWarning = '报表生成失败，请联系管理员处理。'
    }

    return {
      code: 0,
      data: {
        receiptId,
        reportsGenerated: reportsGenerated.length,
        reportWarning,
        hasAbnormal,
        abnormalTypeNames,
        priceReportsSkipped: hasAbnormal
      }
    }
  } catch (err) {
    if (err && (err.code === 'RECEIPT_EXISTS' || err.message === 'RECEIPT_EXISTS')) {
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }
    if (err && (err.code === 'ORDER_NOT_RECEIVABLE' || err.message === 'ORDER_NOT_RECEIVABLE')) {
      return { code: -1, msg: '当前订单状态不可收货，请刷新订单后重试' }
    }
    console.error('[createReceipt] 收货验收提交失败:', err)
    return { code: -1, msg: '收货验收提交失败，请稍后重试' }
  }
}
