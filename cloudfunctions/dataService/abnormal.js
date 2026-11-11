// 异常域（2026-11-05 拆分自 dataService/index.js）：异常记录查询与状态机
//（pending → processing → resolved → closed）。
const { db, _, requireUser, GLOBAL_ROLES } = require('./_shared')
const { createMessage, getStoreManagerId } = require('./messages')

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货',
  // 缺价待补（createReceipt 同名字典）：缺失时异常列表该行显示裸英文 type
  missing_price: '缺价待补'
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
  // L1（2026-11-11）：chef 与 supplier 显式无异常查看权限——不再靠 store_id 恒非空「侥幸安全」
  if (['chef', 'supplier'].includes(auth.user.role)) return { code: 0, data: [] }

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
  // L6（2026-11-10）：check-then-act 改条件更新——并发双击只有一条能推进状态，
  // 后写者 updated=0 不再覆盖 handled_by，也不会重复发起
  const upd = await db.collection('abnormal_record')
    .where({ _id: event.id, status: 'pending' })
    .update({
      data: { status: 'processing', handled_by: auth.user.name, updated_at: db.serverDate() }
    })
  if (!upd.stats || upd.stats.updated === 0) return { code: -1, msg: '该异常已进入处理流程' }
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

  // L6（2026-11-10）：check-then-act 改条件更新——并发双击只有一条能推进 resolved，
  // 后写者 updated=0 直接返回，resolved_by/resolved_at 不被覆盖、消息不重复发
  const resolveUpd = await db.collection('abnormal_record')
    .where({ _id: event.id, status: 'processing' })
    .update({
      data: {
        status: 'resolved',
        resolution,
        payment_decision: paymentDecision,
        resolved_by: auth.user.name,
        resolved_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!resolveUpd.stats || resolveUpd.stats.updated === 0) {
    return { code: -1, msg: '该异常已被处理，请刷新后查看' }
  }
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

  // 清单 #15 拍板（2026-09-28）：异常解决后补结算仍由管理员手动触发，
  // 但发「待补结算」提醒，防止管理员忘记导致供应商账单缺一笔
  await createMessage({
    type: 'abnormal',
    title: '待补结算提醒',
    content: `收货单 ${record.receipt_id || ''} 关联异常已解决，请管理员尽快执行补结算（settleReceipt），避免供应商账单缺漏`,
    bizId: record.receipt_id || record.abnormal_id || event.id,
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

  // L6（2026-11-10）：关闭同样改条件更新，并发双击只有一条推进 closed
  const closeUpd = await db.collection('abnormal_record')
    .where({ _id: event.id, status: 'resolved' })
    .update({
      data: {
        status: 'closed',
        closed_by: auth.user.name,
        closed_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!closeUpd.stats || closeUpd.stats.updated === 0) {
    return { code: -1, msg: '该异常已被关闭，请刷新后查看' }
  }
  return { code: 0 }
}

module.exports = { getAbnormalRecords, startAbnormal, resolveAbnormal, closeAbnormal }
