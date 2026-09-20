// 云函数 generateSummaryReport - 门店日汇总 / 月汇总报表（B11）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const tokenHash = hashToken(authToken)
  // B12 多设备会话：先查 sessions 数组（每设备一条），兼容旧单会话字段
  const result = await db.collection('app_user')
    .where({ status: 1, sessions: { token_hash: tokenHash } })
    .limit(1)
    .get()
  let user = result.data[0]
  if (!user) {
    const legacy = await db.collection('app_user')
      .where({ session_token_hash: tokenHash, status: 1 })
      .limit(1)
      .get()
    user = legacy.data[0]
  }
  if (!user) return null
  if (Array.isArray(user.sessions) && user.sessions.length) {
    const session = user.sessions.find(s => s && s.token_hash === tokenHash)
    if (!session || !session.expires_at) return null
    const expiresAt = new Date(session.expires_at).getTime()
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
  }
  if (!user.session_expires_at) return null
  const legacyExpires = new Date(user.session_expires_at).getTime()
  return Number.isFinite(legacyExpires) && legacyExpires > Date.now() ? user : null
}

// 辅助：用双引号包裹CSV字段，防止逗号问题
function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

// 辅助：查询同类报表最高版本号。查询失败必须向上抛出，不能静默回落 v1 加剧版本号竞争。
async function getNextVersion(reportType, scopeId, relatedDate) {
  const res = await db.collection('report_file')
    .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
    .orderBy('file_version', 'desc')
    .limit(1)
    .get()
  return res.data.length > 0 ? (Number(res.data[0].file_version) || 0) + 1 : 1
}

const isDate = value => {
  const text = String(value || '')
  const date = new Date(`${text}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

// 分页拉取门店在指定日期（或当月）的全部 receipt 单据 id
async function getStoreReceipts(storeId, period, date) {
  const baseWhere = { store_id: storeId }
  if (period === 'daily') {
    baseWhere.receipt_date = date
  } else {
    baseWhere.receipt_date = _.gte(`${date.slice(0, 7)}-01`).and(_.lte(`${date.slice(0, 7)}-31`))
  }
  const receipts = []
  const pageSize = 100
  let skip = 0
  // 先按 count 分页取，再流式追加，避免云函数单次 limit(100) 截断
  const { total } = await db.collection('receipt').where(baseWhere).count()
  while (skip < total) {
    const res = await db.collection('receipt').where(baseWhere)
      .field({ receipt_id: true })
      .skip(skip).limit(pageSize).get()
    res.data.forEach(r => receipts.push(r.receipt_id))
    skip += pageSize
    if (res.data.length === 0) break
  }
  return receipts
}

// 分页拉取全部 receipt_item，按商品聚合
async function loadReceiptItems(receiptIds) {
  const items = []
  for (let i = 0; i < receiptIds.length; i += 20) {
    const chunk = receiptIds.slice(i, i + 20)
    if (!chunk.length) continue
    let skip = 0
    // receipt_item 单块最多可能超 100 条，也做分页
    for (;;) {
      const res = await db.collection('receipt_item')
        .where({ receipt_id: _.in(chunk) })
        .skip(skip).limit(100).get()
      items.push(...res.data)
      if (res.data.length < 100) break
      skip += 100
    }
  }
  return items
}

// 查询商品分类
async function loadProductCategoryMap(productIds) {
  const map = {}
  const ids = [...new Set(productIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const res = await db.collection('product')
      .where({ product_id: _.in(chunk) })
      .field({ product_id: true, category_name: true, category_level_1: true, unit: true })
      .limit(100)
      .get()
    res.data.forEach(p => {
      map[p.product_id] = { category: p.category_name || p.category_level_1 || '', unit: p.unit || '' }
    })
  }
  return map
}

// 批量查供应商名称
async function loadSupplierNameMap(supplierIds) {
  const map = {}
  const ids = [...new Set(supplierIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const res = await db.collection('supplier')
      .where({ supplier_id: _.in(chunk) })
      .field({ supplier_id: true, supplier_name: true })
      .limit(100)
      .get()
    res.data.forEach(s => { map[s.supplier_id] = s.supplier_name })
  }
  return map
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (!['store_manager', 'purchaser', 'super_admin'].includes(user.role)) {
      return { code: -403, msg: '当前账号无权生成汇总报表' }
    }
    const period = event.period
    if (!['daily', 'monthly'].includes(period)) return { code: -1, msg: '汇总类型无效' }
    const date = String(event.date || '')
    if (!isDate(date)) return { code: -1, msg: '日期格式无效，应为 YYYY-MM-DD' }

    const isGlobal = ['purchaser', 'super_admin'].includes(user.role)
    let storeId = event.storeId
    if (!isGlobal) {
      // 店长强制限定自己的门店
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      if (storeId && storeId !== user.default_store_id) return { code: -403, msg: '无权查询其他门店数据' }
      storeId = user.default_store_id
    }
    if (!storeId) return { code: -1, msg: '请指定门店' }

    const storeRes = await db.collection('store').where({ store_id: storeId }).limit(1).get()
    if (!storeRes.data.length) return { code: -1, msg: '门店不存在' }
    const storeName = storeRes.data[0].store_name || storeId

    const receipts = await getStoreReceipts(storeId, period, date)
    const items = receipts.length ? await loadReceiptItems(receipts) : []
    const categoryMap = await loadProductCategoryMap(items.map(it => it.product_id))
    const supplierNameMap = await loadSupplierNameMap(items.map(it => it.supplier_id))

    // 按供应商+商品聚合（同一商品多供应商时分行体现）
    const productMap = {}
    items.forEach(item => {
      const pid = item.product_id || 'unknown'
      const sid = item.supplier_id || ''
      const key = sid + '|' + pid
      if (!productMap[key]) {
        const meta = categoryMap[pid] || {}
        productMap[key] = {
          productName: item.product_name || '',
          supplierName: supplierNameMap[sid] || sid || '未指定供应商',
          category: meta.category || '',
          unit: item.unit_snapshot || meta.unit || '',
          orderQty: 0,
          receivedQty: 0,
          amount: 0
        }
      }
      const agg = productMap[key]
      agg.orderQty = Math.round((agg.orderQty + (Number(item.order_qty_snapshot) || 0)) * 1000) / 1000
      agg.receivedQty = Math.round((agg.receivedQty + (Number(item.received_qty) || 0)) * 1000) / 1000
      // 逐行舍入到分再累加
      const subtotal = Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100
      agg.amount = Math.round((agg.amount + subtotal) * 100) / 100
    })
    const rows = Object.values(productMap)
    const totalAmount = Math.round(rows.reduce((s, r) => Math.round((s + r.amount) * 100) / 100, 0) * 100) / 100

    // CSV 组装
    const summaryType = period === 'daily' ? '日汇总' : '月汇总'
    let csv = [csvField('门店'), csvField(storeName), csvField('汇总类型'), csvField(summaryType), csvField('汇总日期'), csvField(date)].join(',') + '\n'
    csv += [csvField('商品名称'), csvField('供应商'), csvField('分类'), csvField('单位'), csvField('下单数量'), csvField('实收数量'), csvField('金额小计')].join(',') + '\n'
    rows.forEach(r => {
      csv += [csvField(r.productName), csvField(r.supplierName), csvField(r.category), csvField(r.unit), csvField(r.orderQty), csvField(r.receivedQty), csvField(r.amount.toFixed(2))].join(',') + '\n'
    })
    csv += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(''), csvField(totalAmount.toFixed(2))].join(',') + '\n'

    const reportType = period === 'daily' ? 'store_daily_summary_report' : 'store_monthly_summary_report'
    const relatedDate = date // 月汇总也存传入日期
    const version = await getNextVersion(reportType, storeId, relatedDate)
    const pathDate = period === 'daily' ? date : date.slice(0, 7)
    const fileName = `reports/summary/${period}/${storeId}/${pathDate}-summary-v${version}.csv`
    const uploadRes = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv, 'utf-8')
    })

    await db.collection('report_file').add({
      data: {
        report_id: `RPT_${period === 'daily' ? 'DS' : 'MS'}_${storeId}_${date}_v${version}`,
        report_type: reportType,
        report_scope: 'store',
        scope_id: storeId,
        scope_name: storeName,
        related_date: relatedDate,
        basis_date_type: 'summary_date',
        file_name: fileName,
        file_url: uploadRes.fileID,
        file_version: version,
        generated_at: db.serverDate(),
        generated_by_system: false,
        status: 'generated',
        total_amount: totalAmount,
        item_count: rows.length
      }
    })

    return {
      code: 0,
      data: {
        fileID: uploadRes.fileID,
        fileName,
        totalAmount,
        itemCount: rows.length
      }
    }
  } catch (err) {
    console.error('[generateSummaryReport] 汇总报表生成失败:', err)
    return { code: -1, msg: '汇总报表生成失败，请稍后重试' }
  }
}
