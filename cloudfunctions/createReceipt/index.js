// 云函数 createReceipt - 收货确认 + 自动生成4种报表
// 修复：服务端鉴权与门店归属 + 东八区收货日期 + 价格快照批量查询（消灭N+1）
//      + 报表供应商批量查询 + CSV 加 UTF-8 BOM + 门店/收货人信息不信任客户端
const cloud = require('wx-server-sdk')
const { requireUser, STORE_ROLES } = require('./auth')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 辅助：用双引号包裹CSV字段，防止逗号问题
function csvField(val) {
  const s = String(val == null ? '' : val)
  return '"' + s.replace(/"/g, '""') + '"'
}

// 辅助：查询同类报表最高版本号
async function getNextVersion(reportType, scopeId, relatedDate) {
  try {
    const res = await db.collection('report_file')
      .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
      .orderBy('file_version', 'desc').limit(1).get()
    return res.data.length > 0 ? res.data[0].file_version + 1 : 1
  } catch (e) { return 1 }
}

// 辅助：东八区当天日期 YYYY-MM-DD（避免 UTC 日期把北京时间8点前的收货记到昨天）
function localDateStr(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000)
  return t.toISOString().slice(0, 10)
}

exports.main = async (event = {}) => {
  // 入口先鉴权：未登录直接返回
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const user = auth.user

  try {
    const {
      purchaseOrderId,
      overallRemark = '',
      photoFileIds = [],
      items
    } = event || {}
    if (!purchaseOrderId) {
      return { code: -1, msg: '订单信息缺失，请返回订单列表后重新进入验收' }
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

    // 门店归属：门店角色（厨师/店长）只能验收本店订单，厨师还须是订单创建人；
    // 客户端传入的 storeId/storeName/receivedBy 一律忽略
    if (STORE_ROLES.includes(user.role)) {
      if (!user.default_store_id || order.store_id !== user.default_store_id) {
        return { code: -403, msg: '当前账号无权验收其他门店的订单' }
      }
      if (user.role === 'chef') {
        const creators = [user.user_id, user._id, user.name].filter(Boolean)
        if (!creators.includes(order.created_by)) {
          return { code: -403, msg: '当前账号无权验收他人创建的订单' }
        }
      }
    }

    const existingReceiptRes = await db.collection('receipt')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1)
      .get()
    if (existingReceiptRes.data.length > 0 || order.order_status === 'received') {
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }

    // 门店与收货人以服务端数据为准：门店取订单记录，收货人取登录用户
    const storeId = order.store_id || ''
    const storeName = order.store_name || ''
    const receivedBy = user.name || ''
    if (!storeId || !storeName) {
      return { code: -1, msg: '订单门店信息缺失，无法完成收货，请联系管理员处理' }
    }

    // 收货日期用东八区日期，报表路径与 related_date 同源
    const receiptDate = localDateStr()
    const receiptId = 'RCP' + Date.now()

    // 价格以数据库中的当前供应商价格为准，避免客户端旧价格进入结算报表。
    // 按供应商分组批量查询（每个供应商一次 _.in 查询），查不到的价格记 0。
    const itemsBySupplier = {}
    items.forEach(item => {
      if (!item.supplierId) return
      if (!itemsBySupplier[item.supplierId]) itemsBySupplier[item.supplierId] = []
      itemsBySupplier[item.supplierId].push(item)
    })
    const priceMapBySupplier = {}
    for (const sid of Object.keys(itemsBySupplier)) {
      const productIds = [...new Set(itemsBySupplier[sid].map(item => item.productId))]
      const priceRes = await db.collection('supplier_product_price')
        .where({ supplier_id: sid, is_current: 1, product_id: _.in(productIds) })
        .limit(1000).get()
      const priceMap = {}
      priceRes.data.forEach(row => {
        if (priceMap[row.product_id] === undefined) {
          priceMap[row.product_id] = Number(row.price) || 0
        }
      })
      priceMapBySupplier[sid] = priceMap
    }
    items.forEach(item => {
      const priceMap = item.supplierId ? priceMapBySupplier[item.supplierId] : null
      item.priceSnapshot = (priceMap && priceMap[item.productId]) || 0
    })

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
      // CSV 加 UTF-8 BOM，避免 Windows Excel 打开中文乱码
      const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from('\ufeff' + csv1, 'utf-8') })
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
      const u2 = await cloud.uploadFile({ cloudPath: f2, fileContent: Buffer.from('\ufeff' + csv2, 'utf-8') })
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

      // 批量查供应商名称（一次 _.in 查询，不再逐个查）
      const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
      if (supplierIds.length > 0) {
        try {
          const supRes = await db.collection('supplier')
            .where({ supplier_id: _.in(supplierIds) })
            .get()
          supRes.data.forEach(sup => {
            if (supplierMap[sup.supplier_id]) {
              supplierMap[sup.supplier_id].name = sup.supplier_name
            }
          })
        } catch (e) {}
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
        const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from('\ufeff' + csv3, 'utf-8') })
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
        const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from('\ufeff' + csv4, 'utf-8') })
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
