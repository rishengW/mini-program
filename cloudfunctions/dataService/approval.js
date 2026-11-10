// 审批域（2026-11-05 拆分自 dataService/index.js）：订单审核（改量/驳回）+ 催审。
const { db, _, requireUser, MANAGEMENT_ROLES, GLOBAL_ROLES } = require('./_shared')
const { createMessage } = require('./messages')
const { regenerateApprovedOrderReports } = require('./report-utils')
const { notifySuppliersNewOrder } = require('./notify')

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
  // 清单 #12：禁止自单自审——下单人（含采购员/超管本人）不能审核自己的单，
  // 由其他管理员审核；created_by 双值兼容（user_id 或 _id）
  const auditorId = auth.user.user_id || auth.user._id
  if (order.created_by && [order.created_by, auth.user._id].includes(auditorId)) {
    return { code: -1, msg: '不能审核自己下的单，请由其他管理员审核' }
  }
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
      // qty <= 0 拒绝：0 通过会把该行静默改成 0 量，审批数量必须为正数
      if (!item || !validIds.has(item.itemId) || !Number.isFinite(qty) || qty <= 0 || qty > Number(sourceItem && sourceItem.order_qty)) {
        // P2-51：审批数量错误带上商品名，不再整单级提示
        return { code: -1, msg: `商品「${(sourceItem && sourceItem.product_name_snapshot) || (item && item.itemId) || '未知'}」审批数量必须大于 0 且不超过下单数量，请检查后重试` }
      }
    }
  }

  await db.runTransaction(async transaction => {
    // 事务内复查订单状态，防止并发审核重复执行改量/通知
    const recheck = await transaction.collection('purchase_order')
      .where({ purchase_order_id: event.orderId })
      .limit(1)
      .get()
    const currentOrder = recheck.data[0]
    if (!currentOrder || !['submitted', 'pending_approval'].includes(currentOrder.order_status)) {
      await transaction.rollback({ code: -1, msg: '该订单已经审核，请勿重复操作' })
      return
    }
    for (const item of itemResult.data) {
      const approvedQty = qtyMap[item.item_id]
      if (event.status === 'approved' && Number.isFinite(approvedQty) && approvedQty > 0) {
        await transaction.collection('purchase_order_item').doc(item._id).update({
          data: {
            // P1-12：首次改量时把审核前的下单量留档到 original_order_qty（仅首次，
            // 不随重复审核覆盖），order_qty 被改后对账仍可还原原始量（等式4）
            original_order_qty: item.original_order_qty === undefined ? item.order_qty : item.original_order_qty,
            order_qty: approvedQty,
            approved_qty: approvedQty,
            updated_at: db.serverDate()
          }
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
  }).catch(err => {
    // rollback 携带的自定义信息
    if (err && err.errMsg && err.errMsg.includes('该订单已经审核')) return { code: -1, msg: '该订单已经审核，请勿重复操作' }
    throw err
  })

  // P2-10：事务提交到后续动作之间存在窗口，另一管理员可能已作废订单——
  // 复查状态，已非本次目标状态则跳过报表重算与供应商通知（不向已作废单刷报表/花钱群发）
  const postAuditRes = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const postOrder = postAuditRes.data[0]
  if (!postOrder || postOrder.order_status !== event.status) {
    return { code: 0, data: { reportWarning: '订单状态已变化（可能已被作废），已跳过报表重算与供应商通知' } }
  }

  try {
    await createMessage({
      type: 'approval',
      title: event.status === 'approved' ? '采购申请已通过' : '采购申请已驳回',
      content: `${order.order_no || event.orderId}${event.status === 'approved' ? '审核通过' : '被驳回'}`,
      bizId: event.orderId,
      storeId: order.store_id
    })
  } catch (err) {
    // P2-16：审核事务已提交，消息写失败不能把整个操作报成失败——降级为警告
    console.error('[dataService] 审核结果消息写入失败:', err)
  }

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

// ===== #12-③ 审核催办：下单人/店长可对 submitted 单发催办消息提醒管理员 =====
async function remindAudit(event) {
  const auth = await requireUser(event, ['chef', 'store_manager', 'purchaser', 'super_admin'])
  if (auth.error) return auth.error
  if (!event.orderId) return { code: -1, msg: '缺少订单号' }

  const orderResult = await db.collection('purchase_order')
    .where({ purchase_order_id: event.orderId })
    .limit(1)
    .get()
  const order = orderResult.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (order.order_status !== 'submitted') {
    return { code: -1, msg: '该订单当前无需催审' }
  }
  // 门店归属校验：全局角色可跨门店，门店角色仅可催办本门店订单
  if (!GLOBAL_ROLES.includes(auth.user.role) && order.store_id !== (auth.user.default_store_id || '')) {
    return { code: -403, msg: '当前账号无权催办该门店订单' }
  }

  // 限频：同一单两次催审间隔至少 1 小时，防止刷屏
  const ONE_HOUR = 60 * 60 * 1000
  const lastRemindAt = order.audit_reminded_at
  if (lastRemindAt && Date.now() - new Date(lastRemindAt).getTime() < ONE_HOUR) {
    return { code: -1, msg: '已催办过，请 1 小时后再试' }
  }

  // 条件更新兜底防并发重复催办（逻辑运算符统一走 _.and/_.or——裸 $or 字面量依赖 SDK
  // 对 MongoDB 原语的支持，识别与否不可控，全仓其余处均已收敛为 command 形式）
  const remindRes = await db.collection('purchase_order')
    .where(_.and([
      { _id: order._id, order_status: 'submitted' },
      _.or([
        { audit_reminded_at: _.exists(false) },
        { audit_reminded_at: _.lt(new Date(Date.now() - ONE_HOUR)) }
      ])
    ]))
    .update({ data: { audit_reminded_at: db.serverDate(), updated_at: db.serverDate() } })
  if (!remindRes.stats || remindRes.stats.updated === 0) {
    return { code: -1, msg: '已催办过，请 1 小时后再试' }
  }

  await createMessage({
    type: 'approval',
    title: '采购单催审提醒',
    content: `${auth.user.name} 催促审核采购单 ${order.order_no || event.orderId}（${order.store_name || ''}，已等待审核），请尽快处理`,
    bizId: event.orderId,
    storeId: order.store_id
  }).catch(async err => {
    // P2-17：限频标记已推进但消息写失败时，催办会永久丢失且 1 小时内无法重试——
    // 回退标记到原值（无旧值则清除），让用户可以立即重试
    console.error('[dataService] 催审消息写入失败，回退限频标记:', err)
    try {
      await db.collection('purchase_order').doc(order._id).update({
        data: { audit_reminded_at: order.audit_reminded_at || null, updated_at: db.serverDate() }
      })
    } catch (resetErr) {
      console.error('[dataService] 限频标记回退失败:', resetErr)
    }
    return { code: -1, msg: '催办消息发送失败，请稍后重试' }
  })
  return { code: 0 }
}

module.exports = { auditOrder, remindAudit }
