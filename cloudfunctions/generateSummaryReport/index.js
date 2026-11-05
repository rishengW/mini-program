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
  // 数组元素字段必须点路径匹配：{sessions:{token_hash:x}} 整对象相等永远不中（2026-11-05 修复）
  const result = await db.collection('app_user')
    .where({ status: 1, 'sessions.token_hash': tokenHash })
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

// 辅助：原子计数器取下一版本号，避免并发"查最大+1"取得相同版本。查询/更新失败必须向上抛出。
async function getNextVersion(reportType, scopeId, relatedDate) {
  const _ = db.command
  // P0-4：CAS 取号——读旧值 → 条件更新（count 仍等于旧值才写旧值+1）→ updated===1 才算抢到。
  // 原「_.inc 后回读」是两步操作，并发双方会回读到同一个最终值 → 版本号跳号、report_id 碰撞。
  const counterId = `${reportType}_${scopeId}_${relatedDate}`
  const counters = db.collection('report_version_counter')
  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await counters.doc(counterId).get().catch(() => null)
    const current = doc && doc.data ? Number(doc.data.count) : null
    if (current !== null && Number.isFinite(current) && current >= 0) {
      // 条件更新独占版本号：并发方抢先写入后 where 不再命中（updated===0），重读重试
      const casRes = await counters.where({ _id: counterId, count: current })
        .update({ data: { count: current + 1, updated_at: db.serverDate() } })
      if (casRes.stats && casRes.stats.updated === 1) return current + 1
      continue
    }
    try {
      // 计数器不存在：创建 count=1；_id 撞车说明并发方已建，重试走 CAS 路径
      await counters.add({ data: { _id: counterId, count: 1, updated_at: db.serverDate() } })
      return 1
    } catch (err) {
      // 空 catch 会把「集合不存在/无权限」和「并发撞 _id」压成同一张脸，排查时
      // 只剩一句无信息量的「计数器更新失败」。仅在最后一次重试时带出真实原因。
      if (attempt === 4) console.error('[generateSummaryReport][getNextVersion] 计数器创建失败:', counterId, err)
    }
  }
  throw new Error('getNextVersion: 计数器更新失败')
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
    // 日期上界：不允许生成未来日期/未来月份的汇总（UTC+8 口径，与 createReceipt 一致）。
    // 原实现无入参上界，可被构造任意日期反复生成刷量。
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    if (period === 'daily' && date > today) return { code: -1, msg: '不能生成未来日期的汇总报表' }
    if (period === 'monthly' && date.slice(0, 7) > today.slice(0, 7)) return { code: -1, msg: '不能生成未来月份的汇总报表' }

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

    const reportType = period === 'daily' ? 'store_daily_summary_report' : 'store_monthly_summary_report'
    const relatedDate = date // 月汇总也存传入日期

    // 幂等 + 防刷：同门店同类型同日期已有有效报表时默认直接复用，
    // 不再重复上传 CSV、重复写 report_file（原实现每次调用都新增文件，可被刷量耗尽配额）。
    // 收货数据变化后确需重出时传 force=true；force 路径带 60 秒限频，防连点/脚本刷写。
    const existingRes = await db.collection('report_file')
      .where({
        report_type: reportType,
        report_scope: 'store',
        scope_id: storeId,
        related_date: relatedDate,
        status: _.neq('superseded')
      })
      .orderBy('generated_at', 'desc')
      .limit(1)
      .get()
    const existing = existingRes.data[0]
    if (existing) {
      if (event.force !== true) {
        return {
          code: 0,
          data: {
            reportId: existing.report_id,
            fileName: existing.file_name,
            totalAmount: existing.total_amount,
            itemCount: existing.item_count,
            existed: true
          }
        }
      }
      const lastTs = new Date(existing.generated_at).getTime()
      if (Number.isFinite(lastTs) && Date.now() - lastTs < 60 * 1000) {
        return { code: -1, msg: '该汇总刚刚已生成过，请 1 分钟后再重新生成' }
      }
    }

    const receipts = await getStoreReceipts(storeId, period, date)
    const items = receipts.length ? await loadReceiptItems(receipts) : []
    const categoryMap = await loadProductCategoryMap(items.map(it => it.product_id))
    const supplierNameMap = await loadSupplierNameMap(items.map(it => it.supplier_id))

    // 按供应商+商品聚合（同一商品多供应商时分行体现）
    const productMap = {}
    items.forEach(item => {
      // S9：手动行无协议价（金额走凭证核销），不计入汇总金额口径
      if (item.is_manual) return
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
      // 逐行舍入到分再累加。
      // 金额口径与结算对齐：质量/错货等不可付款行（payable_flag=false）不产生应付金额，
      // 与 dataService 出账过滤（payable_flag !== false && price_snapshot > 0）保持一致，
      // 否则汇总合计会大于实际应付、对账对不平。
      // 注意：数量列不受此影响——实收数量反映物流事实，金额才反映结算口径。
      const subtotal = item.payable_flag === false
        ? 0
        : Math.round((Number(item.received_qty) || 0) * (Number(item.price_snapshot) || 0) * 100) / 100
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

    const version = await getNextVersion(reportType, storeId, relatedDate)
    const pathDate = period === 'daily' ? date : date.slice(0, 7)
    // 文件名不含单号，并发生成同门店同日汇总会取到相同版本号，加随机后缀避免同路径互相覆盖
    const fileName = `reports/summary/${period}/${storeId}/${pathDate}-summary-v${version}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.csv`
    const uploadRes = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv, 'utf-8')
    })

    const addRes = await db.collection('report_file').add({
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

    // 重出后把同 key 的旧版本标为已替代：列表/详情/下载三处统一过滤 superseded，
    // 避免新旧两版汇总同时可见、被重复对账。历史无 status 字段的记录不受影响。
    await db.collection('report_file').where({
      report_type: reportType,
      report_scope: 'store',
      scope_id: storeId,
      related_date: relatedDate,
      _id: _.neq(addRes._id)
    }).update({ data: { status: 'superseded', superseded_at: db.serverDate() } })

    return {
      code: 0,
      data: {
        reportId: `RPT_${period === 'daily' ? 'DS' : 'MS'}_${storeId}_${date}_v${version}`,
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
