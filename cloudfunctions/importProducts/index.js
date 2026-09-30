const crypto = require('crypto')
const cloud = require('wx-server-sdk')
const XLSX = require('xlsx')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MANAGEMENT_ROLES = ['super_admin', 'purchaser']

// 固定模板列头（首行），顺序不限但列名必须一致
const HEADER_ALIASES = {
  name: ['商品名称', '品名'],
  categoryL1: ['一级分类'],
  categoryName: ['二级分类', '分类'],
  unit: ['单位'],
  spec: ['规格'],
  manufacturerName: ['厂家', '厂家/品牌', '品牌'],
  supplierName: ['默认供应商', '供应商']
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const tokenHash = hashToken(authToken)
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

async function requireUser(event, roles) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { error: { code: -401, msg: '登录已过期，请重新登录' } }
  if (roles && !roles.includes(user.role)) {
    return { error: { code: -403, msg: '当前账号无权执行该操作' } }
  }
  return { user }
}

function cellText(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

// 解析表头：返回 列名 -> 列号 的映射
function mapHeader(headerRow) {
  const colMap = {}
  headerRow.forEach((cell, idx) => {
    const text = cellText(cell)
    if (!text) return
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (!colMap[field] && aliases.includes(text)) {
        colMap[field] = idx
        break
      }
    }
  })
  return colMap
}

async function main(event) {
  const auth = await requireUser(event, MANAGEMENT_ROLES)
  if (auth.error) return auth.error

  const fileID = event.fileID
  if (!fileID) return { code: -1, msg: '缺少文件' }

  // 下载并解析 Excel
  let workbook
  try {
    const res = await cloud.downloadFile({ fileID })
    workbook = XLSX.read(res.fileContent, { type: 'buffer' })
  } catch (e) {
    return { code: -1, msg: '文件下载或解析失败，请确认为 .xlsx 格式' }
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return { code: -1, msg: 'Excel 中没有工作表' }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (rows.length < 2) return { code: -1, msg: '表格为空，请按模板填写后导入' }

  const colMap = mapHeader(rows[0])
  if (!('name' in colMap) || !('categoryName' in colMap) || !('unit' in colMap)) {
    return { code: -1, msg: '表头不匹配：必须包含「商品名称」「二级分类」「单位」列' }
  }

  // 一次性取全部启用分类与供应商用于名称匹配
  const [catRes, supRes] = await Promise.all([
    db.collection('category').where({ status: 1 }).limit(1000).get(),
    db.collection('supplier').where({ status: 1 }).limit(1000).get()
  ])
  const categories = catRes.data
  const suppliers = supRes.data

  // 查全部已有商品名用于去重（按名称 + 厂家判重）
  let existingProducts = []
  let offset = 0
  const BATCH = 100
  for (;;) {
    const batch = await db.collection('product').skip(offset).limit(BATCH).get()
    existingProducts = existingProducts.concat(batch.data)
    if (batch.data.length < BATCH) break
    offset += BATCH
  }
  const existingKeys = new Set(existingProducts.map(p => `${p.product_name}|${p.manufacturer_name || '默认'}`))

  const errors = []       // [{ row, msg }]
  const toInsert = []
  const seenKeys = new Set()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rowNo = i + 1
    const get = field => colMap[field] !== undefined ? cellText(row[colMap[field]]) : ''

    const name = get('name')
    const unit = get('unit')
    const categoryName = get('categoryName')
    if (!name && !unit && !categoryName) continue // 跳过整行为空

    if (!name) { errors.push({ row: rowNo, msg: '商品名称为空' }); continue }
    if (!unit) { errors.push({ row: rowNo, msg: `${name}: 单位为空` }); continue }

    // 二级分类匹配（可选填一级分类帮助定位）
    const l1Name = get('categoryL1')
    let candidates = categories.filter(c => c.category_name === categoryName)
    if (!candidates.length) { errors.push({ row: rowNo, msg: `${name}: 二级分类「${categoryName}」不存在` }); continue }
    if (l1Name) {
      const byL1 = candidates.filter(c => c.category_level_1_name === l1Name)
      if (byL1.length) candidates = byL1
    }
    const category = candidates[0]

    const manufacturerName = get('manufacturerName') || '默认'
    const key = `${name}|${manufacturerName}`
    if (existingKeys.has(key) || seenKeys.has(key)) {
      errors.push({ row: rowNo, msg: `${name}: 已存在同名同厂家商品，跳过` })
      continue
    }
    seenKeys.add(key)

    // 供应商按名称匹配，匹配不到则留空（不阻断）
    const supplierName = get('supplierName')
    let defaultSupplierId = ''
    if (supplierName) {
      const sup = suppliers.find(s => s.supplier_name === supplierName)
      if (sup) defaultSupplierId = sup.supplier_id
      else errors.push({ row: rowNo, msg: `${name}: 供应商「${supplierName}」不存在，已留空` })
    }

    toInsert.push({
      product_id: 'P' + Date.now() + crypto.randomBytes(4).toString('hex'),
      product_name: name,
      category_level_1: category.category_level_1,
      category_level_2_id: category.category_id,
      category_name: category.category_name,
      unit,
      spec: get('spec'),
      manufacturer_name: manufacturerName,
      default_supplier_id: defaultSupplierId,
      status: 1,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    })
  }

  // 逐条写入（量小场景足够；避免单次 add 批量接口限制）
  let inserted = 0
  for (const item of toInsert) {
    try {
      await db.collection('product').add({ data: item })
      inserted++
    } catch (e) {
      errors.push({ row: '-', msg: `${item.product_name}: 写入失败 ${e.message || ''}` })
    }
  }

  return {
    code: 0,
    data: {
      total: rows.length - 1,
      inserted,
      failed: errors.length,
      errors: errors.slice(0, 50)
    }
  }
}

exports.main = main
