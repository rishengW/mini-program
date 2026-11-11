// createReceipt 并发/分批终态测试（B6 最小测试集第 2 项，2026-11-11）
// 用法：node scripts/_tmp_test/test-receipt-final.js
// 场景：A 收第一批（部分，非最终批）→ partial_received；B 补收第二批（收齐）→ received。
const { makeMock, installModuleMock, makeUser } = require('./mock-cloud')

const mock = makeMock()
installModuleMock(mock)
const { main } = require('../cloudfunctions/createReceipt/index.js')

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name)
  else { failures++; console.error('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')) }
}
function order() { return mock.state.purchase_order[0] }
function abnormalShortage() {
  return (mock.state.abnormal_record || []).filter(r => r.type === 'shortage')
}

;(async () => {
  mock.state.app_user = [makeUser('mgr', 'store_manager', 'tok', { default_store_id: 'S1' })]
  mock.state.store = [{ _id: 'st1', store_id: 'S1', store_name: '一店', status: 1 }]
  mock.state.purchase_order = [{
    _id: 'po1', purchase_order_id: 'PO1', store_id: 'S1', store_name: '一店',
    order_status: 'approved', order_no: 'PO1',
    supplier_confirmations: { SUP1: { status: 'confirmed' } },
    created_by: 'chef1', created_by_name: '厨师'
  }]
  mock.state.purchase_order_item = [
    { _id: 'oi1', item_id: 'PO1_1', purchase_order_id: 'PO1', product_id: 'P1',
      product_name_snapshot: '白菜', supplier_id: 'SUP1', order_qty: 10, unit_snapshot: '斤', is_manual: false },
    { _id: 'oi2', item_id: 'PO1_2', purchase_order_id: 'PO1', product_id: 'P2',
      product_name_snapshot: '土豆', supplier_id: 'SUP1', order_qty: 5, unit_snapshot: '斤', is_manual: false }
  ]
  mock.state.supplier = [{ supplier_id: 'SUP1', supplier_name: '供应商甲', status: 1 }]
  mock.state.supplier_product_price = [
    { supplier_id: 'SUP1', product_id: 'P1', price: 5.5, effective_date: '2026-01-01', is_current: 1 },
    { supplier_id: 'SUP1', product_id: 'P2', price: 2, effective_date: '2026-01-01', is_current: 1 }
  ]

  // ===== 第一批：白菜收 4/10（部分）、土豆收 5/5（收齐）→ 非最终批，partial_received =====
  const r1 = await main({
    authToken: 'tok', purchaseOrderId: 'PO1',
    items: [
      { orderItemId: 'PO1_1', receivedQty: 4, orderQty: 10, productId: 'P1', productName: '白菜', unit: '斤' },
      { orderItemId: 'PO1_2', receivedQty: 5, orderQty: 5, productId: 'P2', productName: '土豆', unit: '斤' }
    ]
  })
  check('第一批提交成功', r1.code === 0, r1)
  check('第一批后订单为部分收货', order().order_status === 'partial_received', order().order_status)
  check('非最终批 shortage 清零（不记少货异常）', abnormalShortage().length === 0, abnormalShortage())
  const receiptsAfter1 = mock.state.receipt || []
  check('生成第 1 张收货单', receiptsAfter1.length === 1, receiptsAfter1.length)
  check('第 1 张收货单 is_final=false', receiptsAfter1[0] && receiptsAfter1[0].is_final === false, receiptsAfter1[0])
  check('③④⑤⑥ 报表已上传', mock.uploads.length >= 2, mock.uploads.length)

  // ===== 第二批：白菜补收 6（累计 10 收齐）→ 最终批，received =====
  const r2 = await main({
    authToken: 'tok', purchaseOrderId: 'PO1',
    items: [{ orderItemId: 'PO1_1', receivedQty: 6, orderQty: 10, productId: 'P1', productName: '白菜', unit: '斤' }]
  })
  check('第二批提交成功', r2.code === 0, r2)
  check('最终批收齐后订单为已收货', order().order_status === 'received', order().order_status)
  const receiptsAfter2 = mock.state.receipt || []
  check('生成第 2 张收货单', receiptsAfter2.length === 2, receiptsAfter2.length)
  const second = receiptsAfter2[1] || {}
  check('第 2 张收货单 is_final=true', second.is_final === true, second)
  check('第 2 张收货单 batch_no=2', second.batch_no === 2, second)

  // ===== 收齐后重复提交被拒 =====
  const r3 = await main({
    authToken: 'tok', purchaseOrderId: 'PO1',
    items: [{ orderItemId: 'PO1_1', receivedQty: 1, orderQty: 10, productId: 'P1', productName: '白菜', unit: '斤' }]
  })
  check('收齐后重复收货被拒', r3.code === -1, r3)

  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
})().catch(err => { console.error('测试执行异常:', err); process.exit(1) })
