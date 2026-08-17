// 云函数 createPurchaseOrder - 创建采购申请 + 自动生成报表
// 修复：增加供应商订货汇总报表生成 + CSV双引号包裹 + 版本号自动递增
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
      .orderBy('file_version', 'desc')
      .limit(1)
      .get()
    return res.data.length > 0 ? res.data[0].file_version + 1 : 1
  } catch (e) { return 1 }
}

exports.main = async (event = {}) => {
  try {
    const { storeId, storeName, orderDate, createdBy, createdByName, items, remark, orderStatus = 'submitted' } = event
    if (!storeId || !storeName || !Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '门店和采购商品不能为空' }
    }
    if (!['draft', 'submitted'].includes(orderStatus)) {
      return { code: -1, msg: '采购单状态无效' }
    }

    // 校验手动商品数量
    const manualCount = items.filter(i => i.isManual).length
    if (manualCount > 5) {
      return { code: -1, msg: '手动商品每单最多5个' }
    }

    // 生成订单号
    const dateStr = (orderDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '')
    const orderNo = 'PO' + dateStr + String(Date.now()).slice(-4)
    const actualDate = orderDate || new Date().toISOString().slice(0, 10)

    // 写入采购主表
    await db.collection('purchase_order').add({
      data: {
        purchase_order_id: orderNo, order_no: orderNo,
        store_id: storeId, store_name: storeName,
        order_date: actualDate, created_by: createdBy,
        created_by_name: createdByName || createdBy,
        order_status: orderStatus, remark: remark || '',
        created_at: db.serverDate(), updated_at: db.serverDate()
      }
    })

    // 写入明细表
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      await db.collection('purchase_order_item').add({
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

    if (orderStatus === 'draft') {
      return { code: 0, data: { orderId: orderNo, reportGenerated: false, reportsGenerated: 0 } }
    }

    const reportsGenerated = []

    // ===== 报表1: 门店下单报表 =====
    const storeVer = await getNextVersion('store_order_report', storeId, actualDate)
    let csv1 = csvField('商品名称') + ',' + csvField('分类') + ',' + csvField('单位') + ',' + csvField('下单数量') + ',' + csvField('备注') + '\n'
    items.forEach(item => {
      csv1 += [csvField(item.productName), csvField(item.category), csvField(item.unit), csvField(item.orderQty), csvField(item.remark || '')].join(',') + '\n'
    })
    const f1 = `reports/store/${actualDate}/store-order-${storeName}-${actualDate}-v${storeVer}.csv`
    const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(csv1, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SO_' + orderNo, report_type: 'store_order_report',
        report_scope: 'store', scope_id: storeId, scope_name: storeName,
        related_date: actualDate, source_order_id: orderNo,
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

    // 查供应商名称
    for (const sid of Object.keys(supplierMap)) {
      if (sid !== 'unknown') {
        try {
          const supRes = await db.collection('supplier')
            .where({ supplier_id: sid }).limit(1).get()
          if (supRes.data.length > 0) {
            supplierMap[sid].name = supRes.data[0].supplier_name
          }
        } catch (e) {}
      }
    }

    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue // 手动商品无供应商
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const supVer = await getNextVersion('supplier_order_report', sid, actualDate)

      let csvSup = [csvField('门店'), csvField('商品名称'), csvField('订货数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        csvSup += [csvField(storeName), csvField(item.productName), csvField(item.orderQty), csvField(item.unit), csvField(item.remark || '')].join(',') + '\n'
      })

      const fSup = `reports/supplier/${actualDate}/supplier-order-${supName}-${actualDate}-v${supVer}.csv`
      const uSup = await cloud.uploadFile({ cloudPath: fSup, fileContent: Buffer.from(csvSup, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUO_' + sid + '_' + orderNo, report_type: 'supplier_order_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: actualDate, source_order_id: orderNo,
          file_name: fSup, file_url: uSup.fileID, file_version: supVer,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
    }
    reportsGenerated.push('supplier_order_report')

    return {
      code: 0,
      data: { orderId: orderNo, reportGenerated: true, reportsGenerated: reportsGenerated.length }
    }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
