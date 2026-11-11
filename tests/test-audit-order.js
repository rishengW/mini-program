// auditOrder 改量对账测试（B6 最小测试集第 4 项，2026-11-11）
// 用法：node scripts/_tmp_test/test-audit-order.js
// 等式：改量后 original_order_qty 保留原始下单量、order_qty/approved_qty 为审批量；
//       数量变化触发下单类报表按批准数量重算（_A 版）。
const { makeMock, installModuleMock, makeUser } = require('./mock-cloud')

const mock = makeMock()
installModuleMock(mock)
const { auditOrder } = require('../cloudfunctions/dataService/approval.js')

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name)
  else { failures++; console.error('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')) }
}
function order() { return mock.state.purchase_order[0] }
function item(id) { return mock.state.purchase_order_item.find(i => i.item_id === id) }

function seed() {
  mock.state.purchase_order = [{
    _id: 'po1', purchase_order_id: 'PO1', order_no: 'PO1', store_id: 'S1',
    order_status: 'submitted', created_by: 'chef1', is_manual: false
  }]
  mock.state.purchase_order_item = [
    { _id: 'oi1', item_id: 'PO1_1', purchase_order_id: 'PO1', product_id: 'P1',
      product_name_snapshot: '白菜', supplier_id: 'SUP1', order_qty: 10, unit_snapshot: '斤', is_manual: false },
    { _id: 'oi2', item_id: 'PO1_2', purchase_order_id: 'PO1', product_id: 'P2',
      product_name_snapshot: '土豆', supplier_id: 'SUP1', order_qty: 5, unit_snapshot: '斤', is_manual: false }
  ]
  mock.state.supplier = [{ supplier_id: 'SUP1', supplier_name: '供应商甲', contact_name: '张三', contact_phone: '138' }]
}

;(async () => {
  mock.state.app_user = [makeUser('adm', 'super_admin', 'tok-adm')]

  // 1. 改量审核通过：白菜 10 → 8，土豆不变
  seed()
  const r1 = await auditOrder({
    authToken: 'tok-adm', orderId: 'PO1', status: 'approved',
    items: [{ itemId: 'PO1_1', approveQty: 8 }]
  })
  check('改量审核通过', r1.code === 0, r1)
  check('订单状态 approved', order().order_status === 'approved', order().order_status)
  check('order_qty 改为审批量 8', item('PO1_1').order_qty === 8, item('PO1_1'))
  check('original_order_qty 保留原始 10（等式4）', item('PO1_1').original_order_qty === 10, item('PO1_1'))
  check('approved_qty=8', item('PO1_1').approved_qty === 8, item('PO1_1'))
  check('未改量行土豆 order_qty 保持 5', item('PO1_2').order_qty === 5, item('PO1_2'))

  const auditReports = mock.state.report_file.filter(r => String(r.report_id).endsWith('_A'))
  check('数量变化触发下单类报表重算（_A 版）', auditReports.length >= 1, auditReports.map(r => r.report_id))

  // 2. 超量审批被拒（带商品名）
  seed()
  const r2 = await auditOrder({
    authToken: 'tok-adm', orderId: 'PO1', status: 'approved',
    items: [{ itemId: 'PO1_1', approveQty: 20 }]
  })
  check('超量审批被拒', r2.code === -1 && /白菜/.test(r2.msg), r2)

  // 3. 审批数量 0 被拒
  seed()
  const r3 = await auditOrder({
    authToken: 'tok-adm', orderId: 'PO1', status: 'approved',
    items: [{ itemId: 'PO1_1', approveQty: 0 }]
  })
  check('审批数量 0 被拒', r3.code === -1 && /大于 0/.test(r3.msg), r3)

  // 4. 自单自审被拒
  mock.state.app_user = [makeUser('chef1', 'super_admin', 'tok-self')]
  seed()
  const r4 = await auditOrder({ authToken: 'tok-self', orderId: 'PO1', status: 'approved', items: [] })
  check('自单自审被拒', r4.code === -1 && /自己下的单/.test(r4.msg), r4)

  // 5. 已审核单重复审核被拒
  mock.state.app_user = [makeUser('adm', 'super_admin', 'tok-adm')]
  seed()
  order().order_status = 'approved'
  const r5 = await auditOrder({ authToken: 'tok-adm', orderId: 'PO1', status: 'approved', items: [] })
  check('重复审核被拒', r5.code === -1 && /已经审核/.test(r5.msg), r5)

  // 6. 驳回必须填原因；填原因 → rejected
  seed()
  const r6 = await auditOrder({ authToken: 'tok-adm', orderId: 'PO1', status: 'rejected', auditRemark: '' })
  check('驳回无原因被拒', r6.code === -1 && /原因/.test(r6.msg), r6)
  const r7 = await auditOrder({ authToken: 'tok-adm', orderId: 'PO1', status: 'rejected', auditRemark: '临时取消' })
  check('驳回成功 rejected', r7.code === 0 && order().order_status === 'rejected', r7)

  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
})().catch(err => { console.error('测试执行异常:', err); process.exit(1) })
