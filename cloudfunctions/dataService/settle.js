// 结算与报表补偿域（2026-11-05 拆分自 dataService/index.js）：
// 异常处理后补结算（_S 增量账单）、缺价补账（reprice）、收货报表补生成（_RG）、
// 下单报表补生成。regen_lock 并发锁（F3）：reprice/regenerate 共用一把锁互斥。
const { db, _, cloud, requireUser, GLOBAL_ROLES } = require('./_shared')
const { csvField, safePathPart, getNextVersion, regenerateApprovedOrderReports } = require('./report-utils')
const { buildReceiptReports, adaptReceiptItem } = require('./shared/receipt-reports')

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

  // P1-2 并发锁：条件更新抢占，双管理员同时补结算只有一个能进入生成流程；
  // 锁带时间戳，超过 10 分钟视为上次执行崩溃残留，允许接管自愈
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const lockRes = await db.collection('receipt').where(_.or([
    { _id: receipt._id, settle_lock: _.neq(true) },
    { _id: receipt._id, settle_lock_at: _.lt(staleCutoff) }
  ])).update({
    data: { settle_lock: true, settle_lock_at: Date.now(), updated_at: db.serverDate() }
  })
  if (!lockRes.stats || lockRes.stats.updated === 0) {
    return { code: -1, msg: '补结算正在处理中，请勿重复操作' }
  }

  try {
    // P0-2 核心修复：只结算本次因异常处理（pay_received 裁决）解锁的行。
    // 原 ⑥ 账单已覆盖收货时可付款的行，补充账单只含增量，两者合计 ≡ 应付总额；
    // 不再把全部可付款行重复计入。
    const payReceivedRecords = abnormalRes.data.filter(item => item.status !== 'closed' && item.payment_decision === 'pay_received')
    const itemResForPay = await db.collection('receipt_item')
      .where({ receipt_id: receiptId })
      .limit(1000)
      .get()
    const unlockedIds = new Set()
    for (const rec of payReceivedRecords) {
      // abnormal_id 格式：{receiptId}_{行序号}_{type}，按行序号定位 receipt_item_id
      const parts = String(rec.abnormal_id || '').split('_')
      if (parts.length < 3 || parts[0] !== receiptId) continue
      const itemItemId = receiptId + '_' + parts[1]
      const target = itemResForPay.data.find(it => it.receipt_item_id === itemItemId)
      if (target && !target.is_manual && Number(target.price_snapshot) > 0) {
        unlockedIds.add(target._id)
        await db.collection('receipt_item').doc(target._id).update({
          data: { payable_flag: true, updated_at: db.serverDate() }
        })
      }
    }

    if (unlockedIds.size === 0) {
      return { code: -1, msg: '没有因异常处理解锁的明细行，无需补结算' }
    }

    const itemRes = await db.collection('receipt_item')
      .where({ receipt_id: receiptId })
      .limit(1000)
      .get()
    // 只取本次解锁的行；价格为 0 的行跳过不结算；
    // 清单 #24：手动商品行显式排除（金额走凭证核销回填，不进补结算）
    const payableItems = itemRes.data.filter(item =>
      unlockedIds.has(item._id) && !item.is_manual && Number(item.price_snapshot) > 0)
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

    // 增量账单：只含本次解锁行，原 ⑥ 账单保持有效，不标 superseded
    const infoHead = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('备注'), csvField('异常处理后补结算（增量）')].join(',') + '\n'
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
          settle_for_receipt: receiptId, settle_type: 'increment'
        }
      })
      generatedSuppliers.push(sid)
    }
    return { code: 0, data: { generatedSuppliers, count: generatedSuppliers.length } }
  } finally {
    // 无论成功失败都释放并发锁；失败后可重新发起，成功后由上方 _S 幂等检查兜底
    try {
      await db.collection('receipt').doc(receipt._id).update({
        data: { settle_lock: false, settle_lock_at: null, updated_at: db.serverDate() }
      })
    } catch (e) {
      console.error('[settleReceipt] 释放补结算锁失败:', e)
    }
  }
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
// ===== #11 拍板（2026-09-24）：补价后补账 =====
// 收货时缺价（missing_price 异常）的行，管理员在价格管理页补配协议价后，
// 用本入口按当前 is_current 价刷新 receipt_item 的价格快照并转回可付款，
// 同时关闭对应缺价异常，再重走 ③④⑤⑥ 报表把账单补出来。
// 复用 regenerateReceiptReports 的报表重建逻辑（_RG 后缀，幂等）。
async function repriceReceipt(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  // F3（2026-11-05）并发锁：与 regenerateReceiptReports 共用 regen_lock——
  // 本函数会改 receipt_item 价格快照/付款资格并调 regenerate 重出报表，
  // 两者必须互斥；锁带时间戳，超 10 分钟视为崩溃残留允许接管自愈。
  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const lockRes = await db.collection('receipt').where(_.or([
    { _id: receipt._id, regen_lock: _.neq(true) },
    { _id: receipt._id, regen_lock_at: _.lt(staleCutoff) }
  ])).update({
    data: { regen_lock: true, regen_lock_at: Date.now(), updated_at: db.serverDate() }
  })
  if (!lockRes.stats || lockRes.stats.updated === 0) {
    return { code: -1, msg: '该收货单报表正在补生成/补价中，请勿重复操作' }
  }
  try {
    return await repriceReceiptLocked(event, receiptId, auth)
  } finally {
    try {
      await db.collection('receipt').doc(receipt._id).update({
        data: { regen_lock: false, regen_lock_at: null, updated_at: db.serverDate() }
      })
    } catch (e) {
      console.error('[repriceReceipt] 释放补价锁失败:', e)
    }
  }
}

// F3：repriceReceipt 的持锁主体（锁由入口函数管理）
async function repriceReceiptLocked(event, receiptId, auth) {
  const itemRes = await db.collection('receipt_item')
    .where({ receipt_id: receiptId })
    .limit(1000)
    .get()
  const items = itemRes.data || []
  // 只处理缺价行：档案商品（非手动）、有供应商、快照 0 价
  const missingItems = items.filter(item => !item.is_manual && item.supplier_id && Number(item.price_snapshot || 0) <= 0)
  if (missingItems.length === 0) return { code: -1, msg: '该收货单没有缺价行，无需补账' }

  // 批量取当前协议价
  const priceMap = {}
  const productIds = [...new Set(missingItems.map(item => item.product_id).filter(Boolean))]
  for (let i = 0; i < productIds.length; i += 20) {
    const idChunk = productIds.slice(i, i + 20)
    const priceRes = await db.collection('supplier_product_price')
      .where({ product_id: _.in(idChunk), is_current: 1 })
      .limit(100)
      .get()
    priceRes.data.forEach(p => { priceMap[`${p.supplier_id}|${p.product_id}`] = Number(p.price) || 0 })
  }

  const repriced = []
  const stillMissing = []
  for (const item of missingItems) {
    const price = priceMap[`${item.supplier_id}|${item.product_id}`] || 0
    if (price <= 0) { stillMissing.push(item.product_name); continue }
    await db.collection('receipt_item').doc(item._id).update({
      data: { price_snapshot: price, payable_flag: true, updated_at: db.serverDate() }
    })
    repriced.push(item.product_name)
  }
  if (repriced.length === 0) {
    return { code: -1, msg: `仍未找到协议价：${stillMissing.join('、')}。请先在价格管理页补配价格` }
  }

  // 关闭已补价的 missing_price 异常（标记 resolved，补价即处置完成）
  const abnormalRes = await db.collection('abnormal_record')
    .where({ receipt_id: receiptId, type: 'missing_price', status: _.in(['pending', 'processing']) })
    .limit(100)
    .get()
  for (const rec of abnormalRes.data) {
    await db.collection('abnormal_record').doc(rec._id).update({
      data: {
        status: 'resolved',
        resolution: '已补配协议价并刷新价格快照，账单按补价重出',
        handled_by: auth.user.name,
        updated_at: db.serverDate()
      }
    })
  }

  // 重走 ③④⑤⑥ 报表（复用补生成逻辑，账单按新快照补出）
  // _lockHeld：锁已由本函数入口持有，regenerate 跳过抢锁避免自我死锁
  //（dispatcher 会剔除客户端伪造的该标记，仅内部调用可达此路径）
  const regen = await regenerateReceiptReports({ ...event, _lockHeld: true })
  if (regen.code !== 0) return regen
  return {
    code: 0,
    data: {
      message: `已补价 ${repriced.length} 行${stillMissing.length ? `；仍有 ${stillMissing.length} 行缺价：${stillMissing.join('、')}` : ''}，账单已重新生成`,
      repriced: repriced.length,
      stillMissing
    }
  }
}

async function regenerateReceiptReports(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }

  // F3（2026-11-05）并发锁：与 settleReceipt 同款 CAS 抢占——补生成/补价重出
  // 期间并发触发会产生重复报表版本（report_id 恒 _RG 且不标 superseded，旧版新版
  // 并存计入）。repriceReceipt 内部调用时锁已由调用方持有（_lockHeld），此处跳过
  // 抢锁；dispatcher 会剔除客户端伪造的 _lockHeld，外部直达调用必走抢锁。
  // 锁带时间戳，超 10 分钟视为上次执行崩溃残留，允许接管自愈。
  const lockHeldByCaller = event._lockHeld === true
  if (!lockHeldByCaller) {
    const staleCutoff = Date.now() - 10 * 60 * 1000
    const lockRes = await db.collection('receipt').where(_.or([
      { _id: receipt._id, regen_lock: _.neq(true) },
      { _id: receipt._id, regen_lock_at: _.lt(staleCutoff) }
    ])).update({
      data: { regen_lock: true, regen_lock_at: Date.now(), updated_at: db.serverDate() }
    })
    if (!lockRes.stats || lockRes.stats.updated === 0) {
      return { code: -1, msg: '该收货单报表正在补生成/补价中，请勿重复操作' }
    }
  }

  try {
    return await regenerateReceiptReportsLocked(event, receipt, receiptId)
  } finally {
    if (!lockHeldByCaller) {
      try {
        await db.collection('receipt').doc(receipt._id).update({
          data: { regen_lock: false, regen_lock_at: null, updated_at: db.serverDate() }
        })
      } catch (e) {
        console.error('[regenerateReceiptReports] 释放补生成锁失败:', e)
      }
    }
  }
}

// F3：regenerateReceiptReports 的持锁主体（锁由入口函数管理，不直接暴露）
async function regenerateReceiptReportsLocked(event, receipt, receiptId) {
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

  // ③④⑤⑥ 统一走共享构建器（2026-11-05 解耦第 4 项；源头 scripts/cloud-shared/
  // receipt-reports.js）。_RG 语义保持：report_id 带 _RG 后缀、文件名 -regen-v、
  // report_file 落 regenerated:true、infoHead 备注「报表失败后补生成」。
  // 对齐修复（_RG 旧版漂移）：补回 missing_price 文案（缺价行曾显示"正常"）、
  // infoHead 下单日期/期望到货两列（从 purchase_order 补查）、report_file.abnormal_summary。
  let orderDate = ''
  let deliveryDate = ''
  if (purchaseOrderId) {
    const orderRes = await db.collection('purchase_order').where({ purchase_order_id: purchaseOrderId }).limit(1).get()
    const ord = orderRes.data[0]
    if (ord) { orderDate = ord.order_date || ''; deliveryDate = ord.delivery_date || '' }
  }
  let generated = []
  try {
    const reportResult = await buildReceiptReports({
      receiptId, purchaseOrderId, storeId, storeName, receiptDate,
      orderDate, deliveryDate,
      receivedBy: receipt.received_by || '',
      batchNo: Number(receipt.batch_no) || 1, isFinal: receipt.is_final !== false,
      items: items.map(adaptReceiptItem),
      idSuffix: '_RG', fileTag: 'regen-v', headNote: '报表失败后补生成', regenerated: true
    })
    generated = reportResult.generated
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

module.exports = { settleReceipt, repriceReceipt, regenerateReceiptReports, regenerateOrderReports }
