/**
 * 把 cloud-shared/auth.js 同步到各云函数目录。
 * 用法：node scripts/sync-shared.js            （同步到全部接入鉴权的云函数）
 *      node scripts/sync-shared.js getProducts （只同步指定目录）
 */
const fs = require('fs')
const path = require('path')

const TARGETS = [
  'getPurchaseOrders',
  'getPurchaseOrderDetail',
  'getProducts',
  'getSuppliers',
  'getProductPrices',
  'getReports',
  'getReportDetail',
  'getReportFileUrl',
  'getReceipts',
  'createPurchaseOrder',
  'createReceipt',
  'updateProductPrice'
]

const args = process.argv.slice(2)
const targets = args.length > 0 ? args : TARGETS
const src = path.resolve(__dirname, '../cloud-shared/auth.js')

if (!fs.existsSync(src)) {
  console.error('源文件不存在:', src)
  process.exit(1)
}

for (const name of targets) {
  const destDir = path.resolve(__dirname, '../cloudfunctions', name)
  if (!fs.existsSync(destDir)) {
    console.warn('跳过（目录不存在）:', destDir)
    continue
  }
  const dest = path.join(destDir, 'auth.js')
  fs.copyFileSync(src, dest)
  console.log('已同步 →', path.relative(path.resolve(__dirname, '..'), dest))
}
