// verifyManualOrder 状态机测试（B6 最小测试集第 5 项，2026-11-11）
// 用法：node scripts/_tmp_test/test-verify-manual-order.js
const { makeMock, installModuleMock, makeUser } = require('./mock-cloud')

const mock = makeMock()
installModuleMock(mock)
const { verifyManualOrder } = require('../cloudfunctions/dataService/verify.js')

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name)
  else { failures++; console.error('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')) }
}

function seedOrder(verifyStatus = 'none') {
  mock.state.purchase_order = [{
    _id: 'po1', purchase_order_id: 'PO_M1', is_manual: true, store_id: 'S1',
    order_status: 'received', verify_status: verifyStatus, verify_voucher_file_ids: []
  }]
}
function order() { return mock.state.purchase_order[0] }
const VID = 'cloud://env.bucket/vouchers/PO_M1/a.jpg'

;(async () => {
  mock.state.app_user = [
    makeUser('mgr', 'store_manager', 'tok-mgr', { default_store_id: 'S1' }),
    makeUser('adm', 'super_admin', 'tok-adm')
  ]

  // 1. 店长提交凭证 → pending
  seedOrder('none')
  const s1 = await verifyManualOrder({
    authToken: 'tok-mgr', verifyAction: 'submit', orderId: 'PO_M1', voucherFileIds: [VID], note: '微信转账'
  })
  check('店长提交凭证成功', s1.code === 0, s1)
  check('提交后 verify_status=pending', order().verify_status === 'pending', order().verify_status)

  // 2. 凭证 fileID 前缀校验（非本订单目录拒绝）
  seedOrder('none')
  const s2 = await verifyManualOrder({
    authToken: 'tok-mgr', verifyAction: 'submit', orderId: 'PO_M1',
    voucherFileIds: ['cloud://env.bucket/vouchers/OTHER/x.jpg']
  })
  check('非本订单目录凭证被拒', s2.code === -1 && /无效/.test(s2.msg), s2)

  // 3. 驳回必须留原因
  seedOrder('pending')
  const r1 = await verifyManualOrder({ authToken: 'tok-adm', verifyAction: 'reject', orderId: 'PO_M1', note: '' })
  check('驳回无原因被拒', r1.code === -1 && /驳回原因/.test(r1.msg), r1)

  // 4. 驳回留原因 → rejected + verify_reject_note
  seedOrder('pending')
  const r2 = await verifyManualOrder({ authToken: 'tok-adm', verifyAction: 'reject', orderId: 'PO_M1', note: '凭证模糊' })
  check('驳回成功', r2.code === 0, r2)
  check('驳回状态 rejected + 原因留存', order().verify_status === 'rejected' && order().verify_reject_note === '凭证模糊', order())

  // 5. 核销通过 → approved + verify_amount 回填
  seedOrder('pending')
  const a1 = await verifyManualOrder({ authToken: 'tok-adm', verifyAction: 'approve', orderId: 'PO_M1', amount: 88.5 })
  check('核销通过', a1.code === 0, a1)
  check('approved + verify_amount=88.5', order().verify_status === 'approved' && order().verify_amount === 88.5, order())

  // 6. 已核销单不允许重传盖回待核销（条件更新幂等）
  const s3 = await verifyManualOrder({ authToken: 'tok-mgr', verifyAction: 'submit', orderId: 'PO_M1', voucherFileIds: [VID] })
  check('已核销单重传被拒', s3.code === -1, s3)
  check('已核销状态不被重传覆盖', order().verify_status === 'approved', order().verify_status)

  // 7. 已核销单再 approve → 无待核销凭证
  const a2 = await verifyManualOrder({ authToken: 'tok-adm', verifyAction: 'approve', orderId: 'PO_M1', amount: 99 })
  check('重复核销被拒', a2.code === -1 && /没有待核销/.test(a2.msg), a2)

  // 8. approve 金额必须 > 0
  seedOrder('pending')
  const a3 = await verifyManualOrder({ authToken: 'tok-adm', verifyAction: 'approve', orderId: 'PO_M1', amount: 0 })
  check('金额 0 核销被拒', a3.code === -1 && /大于0/.test(a3.msg), a3)

  // 9. 店长不能裁决（VOUCHER_SUBMIT_ROLES vs GLOBAL_ROLES 分段）
  seedOrder('pending')
  const a4 = await verifyManualOrder({ authToken: 'tok-mgr', verifyAction: 'approve', orderId: 'PO_M1', amount: 10 })
  check('店长裁决被 -403', a4.code === -403, a4)

  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
})().catch(err => { console.error('测试执行异常:', err); process.exit(1) })
