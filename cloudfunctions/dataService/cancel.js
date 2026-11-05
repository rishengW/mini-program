// 作废/取消域（2026-11-05 拆分自 dataService/index.js）：
// 两阶段取消（审批前直接作废 / 审批后申请-确认）+ 取消申请驳回出口。
const { db, _, requireUser, GLOBAL_ROLES } = require('./_shared')
const { createMessage } = require('./messages')

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
  if (['partial_received', 'received', 'receipt_abnormal'].includes(order.order_status)) {
    return { code: -1, msg: '该订单已有收货记录，不能作废，请走异常处理流程' }
  }
  if (!['submitted', 'approved', 'report_generated'].includes(order.order_status)) {
    return { code: -1, msg: '当前状态的订单不可作废' }
  }

  await db.runTransaction(async transaction => {
    // P1-3：事务内复查订单状态——事务外的状态检查与真正写入之间存在窗口，
    // 并发收货可能在窗口内把订单推入 partial_received/received，
    // 无条件覆盖会把"货已到、钱应付"的已收货订单作废（账单 superseded → 漏账）
    const recheckRes = await transaction.collection('purchase_order')
      .where({ purchase_order_id: event.orderId })
      .limit(1)
      .get()
    const current = recheckRes.data[0]
    if (!current) {
      await transaction.rollback({ code: -1, msg: '采购订单不存在' })
      return
    }
    if (['partial_received', 'received', 'receipt_abnormal'].includes(current.order_status)) {
      await transaction.rollback({ code: -1, msg: '该订单已有收货记录，不能作废，请走异常处理流程' })
      return
    }
    if (!['submitted', 'approved', 'report_generated'].includes(current.order_status)) {
      await transaction.rollback({ code: -1, msg: '当前状态的订单不可作废' })
      return
    }
    const updateData = {
      order_status: 'cancelled',
      // P2-23：作废时清空供应商确认/发货标记——否则供货商门户仍显示"已确认接单"，
      // 与 cancelled 状态并存误导供应商继续备货
      supplier_confirmations: {},
      cancel_reason: reason,
      cancelled_by: auth.user.name,
      cancelled_at: db.serverDate(),
      updated_at: db.serverDate()
    }
    // 清单 #23：手动单作废时重置核销状态（凭证文件保留在 vouchers/ 留痕，只重置状态）
    if (current.is_manual && current.verify_status && current.verify_status !== 'none') {
      updateData.verify_status = 'none'
      updateData.verify_cancel_note = `订单作废时重置核销状态（原状态 ${current.verify_status}），作废原因：${reason}`
    }
    await transaction.collection('purchase_order').doc(current._id).update({ data: updateData })
    // P1-4：事务内 where().update() 不携带 transactionId（SDK 已证实，不在事务保护内），
    // 改为 where().get() + 逐条 doc().update()
    const rptRes = await transaction.collection('report_file')
      .where({ source_order_id: event.orderId, report_type: _.in(['store_order_report', 'supplier_order_report']) })
      .get()
    for (const rpt of rptRes.data) {
      await transaction.collection('report_file').doc(rpt._id).update({
        data: { status: 'superseded', updated_at: db.serverDate() }
      })
    }
  }).catch(err => {
    // rollback 携带的自定义信息转业务返回（同 auditOrder 的 catch 模式：子串匹配 + 固定文案）
    const msg = (err && err.errMsg) || ''
    if (msg.includes('该订单已有收货记录，不能作废')) return { code: -1, msg: '该订单已有收货记录，不能作废，请走异常处理流程' }
    if (msg.includes('当前状态的订单不可作废')) return { code: -1, msg: '当前状态的订单不可作废' }
    if (msg.includes('采购订单不存在')) return { code: -1, msg: '采购订单不存在' }
    throw err
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
  // 角色限制（2026-09-28 口径更新）：订单一经审核，取消仅管理员（purchaser/super_admin）可发起，
  // 下单人员/店长无取消权限；super_admin 经 cancelOrder 直接作废确认
  const auth = await requireUser(event, GLOBAL_ROLES)
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
  // B8 口径对齐（2026-11-04）：partial_received 移出白名单——已有收货的订单
  // 不可申请取消（cancelOrder 同样拒绝），应走异常处理流程；与前端
  // purchase-detail 的 canRequestCancel 口径（approved/report_generated）对齐，
  // 消除「能申请、必被驳回」的死信路径
  if (!['submitted', 'approved', 'report_generated'].includes(order.order_status)) {
    return { code: -1, msg: '当前状态的订单无法申请取消' }
  }
  // 门店归属校验：全局角色可跨门店，门店角色仅可对本门店订单提交取消申请
  if (!GLOBAL_ROLES.includes(auth.user.role) && order.store_id !== (auth.user.default_store_id || '')) {
    return { code: -403, msg: '当前账号无权对该门店订单申请取消' }
  }

  // 条件更新防重复：已有待确认的取消申请时直接返回，不重复写标记/发通知
  const cancelRes = await db.collection('purchase_order')
    .where({ _id: order._id, cancel_requested: _.neq(true) })
    .update({
      data: {
        cancel_requested: true,
        cancel_requested_by: auth.user.name,
        cancel_request_reason: reason,
        cancel_requested_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!cancelRes.stats || cancelRes.stats.updated === 0) {
    return { code: -1, msg: '该订单已有待确认的取消申请，请勿重复提交' }
  }

  await createMessage({
    type: 'cancel',
    title: '收到取消申请',
    content: `采购单 ${order.order_no || event.orderId} 收到取消申请，原因：${reason}，请管理员确认处理`,
    bizId: event.orderId,
    storeId: order.store_id
  })
  return { code: 0 }
}

// ===== B8 取消申请的驳回出口：cancel_requested 原来只写不清（requestCancel 置 true 后
// 系统没有任何入口能清除），申请被拒后订单永久挂着"待确认取消"标记 =====
async function rejectCancel(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  if (!event.orderId) return { code: -1, msg: '缺少订单号' }
  const reason = String(event.reason || '').trim()

  const orderResult = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const order = orderResult.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (!order.cancel_requested) return { code: -1, msg: '该订单没有待处理的取消申请' }

  // 条件更新防并发：已无待确认申请时 updated===0，说明被并发处理（作废或驳回）
  const rejectRes = await db.collection('purchase_order')
    .where({ _id: order._id, cancel_requested: true })
    .update({
      data: {
        cancel_requested: false,
        cancel_rejected_by: auth.user.name,
        cancel_rejected_reason: reason,
        cancel_rejected_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!rejectRes.stats || rejectRes.stats.updated === 0) {
    return { code: -1, msg: '该订单没有待处理的取消申请' }
  }

  await createMessage({
    type: 'cancel',
    title: '取消申请已驳回',
    content: `采购单 ${order.order_no || event.orderId} 的取消申请已被驳回${reason ? '，原因：' + reason : ''}。订单继续执行。`,
    bizId: event.orderId,
    storeId: order.store_id
  })
  return { code: 0 }
}

module.exports = { cancelOrder, requestCancel, rejectCancel }
