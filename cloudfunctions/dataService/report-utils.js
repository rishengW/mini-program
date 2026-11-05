// 报表工具域（2026-11-05 拆分自 dataService/index.js）：
// CSV 转义/路径安全/版本取号（CAS），以及审核改量后的下单类报表重算。
// csvField/safePathPart/getNextVersion 已收敛到跨函数共享模块（源头 scripts/cloud-shared/，
// sync-shared.js 同步副本），此处 re-export，本目录模块仍统一从 ./report-utils 取（导出名不变）。
const { db, _, cloud } = require('./_shared')
const { createMessage, resolveActiveRecipient } = require('./messages')
const { csvField, safePathPart } = require('./shared/csv-utils')
const { getNextVersion } = require('./shared/report-version')

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
      // bizId 必须带上：message.js 对无 bizId 的消息只 toast「已读」，点击无任何反应
      bizId: orderNo,
      storeId,
      recipientUserId: await resolveActiveRecipient(order.created_by, storeId)
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

module.exports = { csvField, safePathPart, getNextVersion, regenerateApprovedOrderReports }
