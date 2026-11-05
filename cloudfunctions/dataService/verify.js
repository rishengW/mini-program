// 凭证核销域（2026-11-05 拆分自 dataService/index.js）：S9 手动商品专用单凭证核销。
const { db, _, cloud, requireUser, GLOBAL_ROLES, VOUCHER_SUBMIT_ROLES, cloudPathOfFileId } = require('./_shared')

// ===== S9 拍板（2026-09-22）：手动商品专用单凭证核销 =====
// 手动单（is_manual）收货后进入待核销（verify_status='pending'），管理员上传/登记
// 付款凭证并回填实付金额（verify_amount）后核销通过，单据闭环。金额唯一可信来源
// 是凭证，不查协议价表（手动商品无档案、无供应商归属）。
async function verifyManualOrder(event) {
  const action = String(event.verifyAction || '') // submit | approve | reject
  // 权限分两段：提交凭证店长/采购员/管理员；核销裁决仅采购员/管理员
  const auth = await requireUser(event, action === 'submit' ? VOUCHER_SUBMIT_ROLES : GLOBAL_ROLES)
  if (auth.error) return auth.error
  const orderId = String(event.orderId || '').trim()
  const amount = Number(event.amount)
  const voucherFileIds = Array.isArray(event.voucherFileIds) ? event.voucherFileIds.filter(Boolean) : []
  // P0-5：凭证数量上限 + fileID 必须位于本订单的凭证目录（路径规则见 purchase-detail 的上传 cloudPath）。
  // fileID 形如 cloud://{env}.{bucket}/vouchers/{订单号}/xx.jpg，须先剥离协议头再按 cloudPath 校验
  const voucherPrefix = `vouchers/${orderId}/`
  if (voucherFileIds.length > 9) return { code: -1, msg: '付款凭证最多9张' }
  if (voucherFileIds.some(id => !cloudPathOfFileId(id).startsWith(voucherPrefix))) {
    return { code: -1, msg: '付款凭证信息无效，请重新上传' }
  }
  const note = String(event.note || '').trim()

  const orderRes = await db.collection('purchase_order').where({ purchase_order_id: orderId }).limit(1).get()
  const order = orderRes.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }
  if (!order.is_manual) return { code: -1, msg: '仅手动商品专用单需要凭证核销' }
  // 店长只能操作本门店的单
  if (auth.user.role === 'store_manager' && order.store_id !== auth.user.default_store_id) {
    return { code: -403, msg: '无权操作其他门店的采购订单' }
  }

  // 提交凭证：店长/采购员/管理员均可；P0-7（2026-10-03 修订口径，替代原 #22"须收齐"门槛）：
  // 手动单少货常态停在 partial_received、最终批带异常为 receipt_abnormal，
  // 仍要求 received 会让 S9 凭证核销主链路在真实场景下永久不可达——
  // 门槛放宽到「收货已定」三态，与前端 purchase-detail 的展示口径一致
  if (action === 'submit') {
    if (!['received', 'receipt_abnormal', 'partial_received'].includes(order.order_status)) {
      return { code: -1, msg: '订单尚在收货中，需全部批次收货完成后才能提交付款凭证' }
    }
    if (order.verify_status === 'approved') return { code: -1, msg: '该单已核销通过，无需重复提交' }
    if (voucherFileIds.length === 0) return { code: -1, msg: '请上传付款证明或发票' }
    // 条件更新兜底并发：已核销的单不允许被重传盖回待核销
    const submitRes = await db.collection('purchase_order')
      .where({ _id: order._id, verify_status: _.neq('approved') })
      .update({
        data: {
          verify_status: 'pending',
          verify_voucher_file_ids: voucherFileIds,
          verify_note: note,
          verify_submitted_by: auth.user.user_id || auth.user._id,
          verify_submitted_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
    if (!submitRes.stats || submitRes.stats.updated === 0) {
      return { code: -1, msg: '该单已核销通过，无需重复提交' }
    }
    // 被替换掉的旧凭证图从云存储清掉，避免驳回重传堆积孤儿文件。
    // P0-5：只删通过前缀校验的本订单文件，防止越权删除他人/他门店的 fileID
    const oldFileIds = Array.isArray(order.verify_voucher_file_ids) ? order.verify_voucher_file_ids : []
    const staleFileIds = oldFileIds.filter(id => {
      const path = cloudPathOfFileId(id)
      return path && path.startsWith(voucherPrefix) && !voucherFileIds.includes(id)
    })
    if (staleFileIds.length) {
      try {
        await cloud.deleteFile({ fileList: staleFileIds })
      } catch (err) {
        console.error('[verifyManualOrder] 清理旧凭证文件失败:', err)
      }
    }
    return { code: 0, data: { message: '凭证已提交，等待管理员核销' } }
  }

  // 核销裁决：仅管理员/采购员；条件更新保证只有 pending 状态可被裁决，防止并发重复核销
  if (!['approve', 'reject'].includes(action)) return { code: -1, msg: '无效的核销动作' }
  if (order.verify_status !== 'pending') return { code: -1, msg: '该单没有待核销的凭证' }
  if (action === 'reject') {
    // P2-24：驳回必须留原因，否则提交人不知道要改什么，审计链也不完整
    if (!note) return { code: -1, msg: '请填写驳回原因' }
    const rejectRes = await db.collection('purchase_order')
      .where({ _id: order._id, verify_status: 'pending' })
      .update({
        // 驳回原因单独存 verify_reject_note，重传的备注不覆盖核销人写的驳回原因
        data: { verify_status: 'rejected', verify_reject_note: note, updated_at: db.serverDate() }
      })
    if (!rejectRes.stats || rejectRes.stats.updated === 0) {
      return { code: -1, msg: '该单核销状态已变化，请刷新后重试' }
    }
    return { code: 0, data: { message: '已驳回，请门店重新提交凭证' } }
  }
  if (!Number.isFinite(amount) || amount <= 0) return { code: -1, msg: '请填写大于0的实付金额' }
  const approveRes = await db.collection('purchase_order')
    .where({ _id: order._id, verify_status: 'pending' })
    .update({
      data: {
        verify_status: 'approved',
        verify_amount: amount,
        verify_note: note,
        verified_by: auth.user.user_id || auth.user._id,
        verified_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  if (!approveRes.stats || approveRes.stats.updated === 0) {
    return { code: -1, msg: '该单核销状态已变化，请刷新后重试' }
  }
  return { code: 0, data: { message: '核销完成，实付金额已回填' } }
}

module.exports = { verifyManualOrder }
