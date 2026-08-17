// 云函数 createReceipt - 收货确认 + 自动生成4种报表
// 修复：增加供应商到货汇总报表 + CSV双引号包裹 + 版本号自动递增
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function csvField(val) {
  const s = String(val == null ? '' : val)
  return '"' + s.replace(/"/g, '""') + '"'
}

async function getNextVersion(reportType, scopeId, relatedDate) {
  try {
    const res = await db.collection('report_file')
      .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
      .orderBy('file_version', 'desc').limit(1).get()
    return res.data.length > 0 ? res.data[0].file_version + 1 : 1
  } catch (e) { return 1 }
}

exports.main = async (event = {}) => {
  try {
    const {
      purchaseOrderId,
      storeId,
      storeName,
      receivedBy = '',
      overallRemark = '',
      photoFileIds = [],
      items
    } = event || {}
    if (!purchaseOrderId) {
      return { code: -1, msg: '订单信息缺失，请返回订单列表后重新进入验收' }
    }
    if (!storeId || !storeName) {
      return { code: -1, msg: '门店信息缺失，请重新登录或切换门店后再试' }
    }
    if (!Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '验收商品信息为空，请返回订单后重试' }
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
    const existingReceiptRes = await db.collection('receipt')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1)
      .get()
    if (existingReceiptRes.data.length > 0 || order.order_status === 'received') {
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }

    const receiptDate = new Date().toISOString().slice(0, 10)
    const receiptId = 'RCP' + Date.now()

    // 价格以数据库中的当前供应商价格为准，避免客户端旧价格进入结算报表。
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let priceSnapshot = 0
      if (item.supplierId) {
        const priceQuery = { product_id: item.productId, is_current: 1 }
        priceQuery.supplier_id = item.supplierId
        const priceRes = await db.collection('supplier_product_price')
          .where(priceQuery)
          .limit(1).get()
        if (priceRes.data.length > 0) priceSnapshot = Number(priceRes.data[0].price) || 0
      }
      item.priceSnapshot = priceSnapshot
    }

    // 收货主表、明细和订单状态必须同时成功或同时回滚。
    await db.runTransaction(async transaction => {
      const latestOrderRes = await transaction.collection('purchase_order').doc(order._id).get()
      if (!latestOrderRes.data || latestOrderRes.data.order_status === 'received') {
        const duplicateError = new Error('RECEIPT_EXISTS')
        duplicateError.code = 'RECEIPT_EXISTS'
        throw duplicateError
      }

      await transaction.collection('receipt').add({
        data: {
          receipt_id: receiptId, purchase_order_id: purchaseOrderId,
          store_id: storeId, store_name: storeName,
          receipt_date: receiptDate, received_by: receivedBy,
          receipt_status: 'completed', overall_remark: overallRemark,
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
        .update({ data: { order_status: 'received', updated_at: db.serverDate() } })
    })

    const reportsGenerated = []
    let reportWarning = ''

    try {
      // ===== 报表1: 门店收货报表 =====
      const v1 = await getNextVersion('store_receipt_report', storeId, receiptDate)
      let csv1 = [csvField('商品名称'), csvField('下单数量'), csvField('实收数量'), csvField('单位'), csvField('备注'), csvField('是否可付款')].join(',') + '\n'
      items.forEach(item => {
        csv1 += [csvField(item.productName), csvField(item.orderQty), csvField(item.receivedQty), csvField(item.unit), csvField(item.remark || ''), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      const f1 = `reports/store/${receiptDate}/store-receipt-${storeName}-${receiptDate}-v${v1}.csv`
      const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(csv1, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SR_' + receiptId, report_type: 'store_receipt_report',
          report_scope: 'store', scope_id: storeId, scope_name: storeName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f1, file_url: u1.fileID, file_version: v1,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
      reportsGenerated.push('store_receipt_report')

    // ===== 报表2: 门店带价格收货报表 =====
    const v2 = await getNextVersion('store_receipt_price_report', storeId, receiptDate)
    let csv2 = [csvField('商品名称'), csvField('实收数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('是否可付款')].join(',') + '\n'
    let totalAmount = 0
    items.forEach(item => {
      const price = item.priceSnapshot || 0
      const subtotal = item.receivedQty * price
      totalAmount += subtotal
      csv2 += [csvField(item.productName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(subtotal.toFixed(2)), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
    })
    csv2 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(totalAmount.toFixed(2)), csvField('')].join(',') + '\n'
    const f2 = `reports/store/${receiptDate}/store-receipt-price-${storeName}-${receiptDate}-v${v2}.csv`
    const u2 = await cloud.uploadFile({ cloudPath: f2, fileContent: Buffer.from(csv2, 'utf-8') })
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

    // ===== 按供应商分组 =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplierId || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
      supplierMap[sid].items.push(item)
    })
    for (const sid of Object.keys(supplierMap)) {
      if (sid !== 'unknown') {
        try {
          const supRes = await db.collection('supplier').where({ supplier_id: sid }).limit(1).get()
          if (supRes.data.length > 0) supplierMap[sid].name = supRes.data[0].supplier_name
        } catch (e) {}
      }
    }

    // ===== 报表3: 供应商到货汇总（不含价格） =====
    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const v3 = await getNextVersion('supplier_receipt_report', sid, receiptDate)

      let csv3 = [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('下单数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        csv3 += [csvField(item.productName), csvField(storeName), csvField(item.receivedQty), csvField(item.orderQty), csvField(item.unit), csvField(item.remark || '')].join(',') + '\n'
      })

      const f3 = `reports/supplier/${receiptDate}/supplier-receipt-${supName}-${receiptDate}-v${v3}.csv`
      const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from(csv3, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUR_' + sid + '_' + receiptId, report_type: 'supplier_receipt_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId,
          file_name: f3, file_url: u3.fileID, file_version: v3,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
      reportsGenerated.push('supplier_receipt_report:' + sid)
    }

    // ===== 报表4: 供应商带价格账单 =====
    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const v4 = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)

      let csv4 = [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('可付款')].join(',') + '\n'
      let sTotal = 0
      supItems.forEach(item => {
        const price = item.priceSnapshot || 0
        const sub = item.receivedQty * price
        sTotal += sub
        csv4 += [csvField(item.productName), csvField(storeName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(sub.toFixed(2)), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      csv4 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(sTotal.toFixed(2)), csvField('')].join(',') + '\n'

      const f4 = `reports/supplier/${receiptDate}/supplier-receipt-price-${supName}-${receiptDate}-v${v4}.csv`
      const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from(csv4, 'utf-8') })
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

    return { code: 0, data: { receiptId, reportsGenerated: reportsGenerated.length, reportWarning } }
  } catch (err) {
    if (err && (err.code === 'RECEIPT_EXISTS' || err.message === 'RECEIPT_EXISTS')) {
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }
    console.error('[createReceipt] 收货验收提交失败:', err)
    return { code: -1, msg: '收货验收提交失败，请稍后重试' }
  }
}
