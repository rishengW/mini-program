// generateSummaryReport 金额等式测试（B6 最小测试集第 3 项，2026-11-11）
// 用法：node scripts/_tmp_test/test-summary-report.js
// 等式：汇总金额 = Σ(可付款行 received_qty × price_snapshot，逐行舍入到分)，手动行/不可付款行不计入
const { makeMock, installModuleMock, makeUser } = require('./mock-cloud')

const mock = makeMock()
installModuleMock(mock)
const { main } = require('../cloudfunctions/generateSummaryReport/index.js')

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name)
  else { failures++; console.error('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')) }
}

const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

;(async () => {
  mock.state.app_user = [makeUser('mgr', 'store_manager', 'tok', { default_store_id: 'S1' })]
  mock.state.store = [{ _id: 'st1', store_id: 'S1', store_name: '一店' }]
  mock.state.receipt = [{
    _id: 'rc1', receipt_id: 'RCP1', purchase_order_id: 'PO1',
    store_id: 'S1', store_name: '一店', receipt_date: today, is_final: true
  }]
  mock.state.receipt_item = [
    // 正常可付款行：10 × 5.5 = 55.00
    { _id: 'i1', receipt_item_id: 'RCP1_1', receipt_id: 'RCP1', product_id: 'P1', product_name: '白菜',
      supplier_id: 'SUP1', received_qty: 10, order_qty_snapshot: 10, unit_snapshot: '斤',
      price_snapshot: 5.5, payable_flag: true, is_manual: false },
    // 不可付款行（质量异常）：不进金额，但作为数量行保留（amount=0）
    { _id: 'i2', receipt_item_id: 'RCP1_2', receipt_id: 'RCP1', product_id: 'P2', product_name: '牛肉',
      supplier_id: 'SUP1', received_qty: 3, order_qty_snapshot: 3, unit_snapshot: '斤',
      price_snapshot: 2, payable_flag: false, is_manual: false },
    // 手动行：不进汇总金额口径
    { _id: 'i3', receipt_item_id: 'RCP1_3', receipt_id: 'RCP1', product_id: '', product_name: '临时调料',
      supplier_id: '', received_qty: 2, order_qty_snapshot: 2, unit_snapshot: '包',
      price_snapshot: 0, payable_flag: false, is_manual: true }
  ]
  mock.state.product = [
    { product_id: 'P1', category: '叶菜' },
    { product_id: 'P2', category: '肉类' }
  ]
  mock.state.supplier = [{ supplier_id: 'SUP1', supplier_name: '供应商甲' }]

  const r = await main({ authToken: 'tok', period: 'daily', date: today, storeId: 'S1' })
  check('汇总返回成功', r.code === 0, r)
  const d = r.data || {}
  check('金额等式：totalAmount = 10×5.5 = 55（仅可付款行）', d.totalAmount === 55, d)
  check('手动行不计入金额与行数（行数=2：白菜+牛肉，牛肉 amount=0）', d.itemCount === 2, d)

  const csvFile = mock.uploads[0]
  check('CSV 已上传', !!csvFile, mock.uploads.length)
  const csv = csvFile ? csvFile.content : ''
  check('CSV 合计行 = 55.00', csv.includes('55.00'), csv.slice(-200))
  check('CSV 不含手动行', !csv.includes('临时调料'), '')
  check('CSV 含白菜行与牛肉行', csv.includes('白菜') && csv.includes('牛肉'), '')

  // 幂等复用：同店同日再生成直接复用（existed=true，不重复上传）
  const before = mock.uploads.length
  const r2 = await main({ authToken: 'tok', period: 'daily', date: today, storeId: 'S1' })
  check('同店同日幂等复用（existed）', r2.code === 0 && r2.data.existed === true, r2)
  check('幂等复用不重复上传 CSV', mock.uploads.length === before, mock.uploads.length)

  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
})().catch(err => { console.error('测试执行异常:', err); process.exit(1) })
