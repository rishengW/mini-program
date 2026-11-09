// 结算与报表补偿域（2026-11-05 拆分自 dataService/index.js）：
// 异常处理后补结算（_S 增量账单，支持多波）、缺价补账（reprice）、收货报表补生成（_RG）、
// 下单报表补生成。regen_lock 并发锁（F3）：reprice/regenerate 共用一把锁互斥。
//
// 2026-11-09 双计修复（拍板口径：全量取代 + 多波补结算）：
//   - _RG 全量重出成功后，该收货单（批次）的原版 / 之前各波 _S / 旧 _RG 统一标 superseded，
//     全量版成为唯一有效账单；取代按 report_id 反解的 receiptId 限定本批次，不波及同单其他批次。
//   - 全量重出会把当前可付款行上的 pay_received 异常记录标记为「已被全量账单覆盖」，
//     之后的补结算只纳入新解锁的行，避免 _S 增量与 _RG 全量叠加双计。
//   - 补结算按波次（_S / _S2 / _S3…）累计：同一收货单的异常可分批处理、分批补结算，
//     每波只结算「尚未被补结算/全量账单覆盖」的解锁行。
const { db, _, cloud, requireUser, GLOBAL_ROLES } = require('./_shared')
const { csvField, safePathPart, getNextVersion, regenerateApprovedOrderReports } = require('./report-utils')
const {
  buildReceiptReports, adaptReceiptItem, receiptIdFromReportId, RECEIPT_REPORT_TYPES,
  SETTLE_REPORT_TYPE, isFullVersionReport, isSettleVersionReport, settleWaveOfReport, reportTimeMs
} = require('./shared/receipt-reports')

// ===== 多波补结算/全量取代共用工具（2026-11-09） =====
// report_id 文法（_S 波次解析 / _RG 判定 / 时间比较）单源在 shared/receipt-reports.js，
// 与 reportMaintenance 共用同一份实现，勿在此再写本地副本。

// abnormal_id 格式：{receiptId}_{行序号}_{type}，按行序号定位 receipt_item_id
function itemKeyFromAbnormalId(receiptId, abnormalId) {
  const parts = String(abnormalId || '').split('_')
  if (parts.length < 3 || parts[0] !== receiptId) return ''
  return receiptId + '_' + parts[1]
}

// 取本收货单的四类报表。按 source_order_id 粗查（同一订单可能有多批收货），
// 再按 report_id 反解的 receiptId 精确过滤——历史数据没有 receipt_id 字段也能命中。
async function loadReceiptReportFiles(receipt) {
  const res = await db.collection('report_file')
    .where({ report_type: _.in(RECEIPT_REPORT_TYPES), source_order_id: receipt.purchase_order_id || '' })
    .limit(1000)
    .get()
  return (res.data || []).filter(row => receiptIdFromReportId(row.report_id) === receipt.receipt_id)
}

// 全量重出成功后的取代（2026-11-09 拍板）：旧版（原版 / 之前各波 _S / 旧 _RG）全部标
// superseded，只保留本次新生成的文件（列表/详情/下载统一过滤 superseded）。
// 未在本次重出中生成的文件（如无可付款行时的 ④⑥）同样作废——全量版是权威口径。
async function supersedeReceiptReports(receipt, newFiles) {
  // _RG 的 report_id 每次重出都相同（RPT_SR_<receiptId>_RG），不能用 report_id 区分
  // 新旧版本——必须按数据库 _id 保留本次新写入的行；旧 _RG 行才会被正确取代。
  // ③ 一定生成且 db.add 成功必然返回 _id，keepDbIds 保证非空；
  // 不做 report_id 兜底——按 report_id 保留反而会把同名旧 _RG 留下（同名陷阱本身）。
  const keepDbIds = new Set((newFiles || []).map(file => file._id).filter(Boolean))
  const keptByTypeScope = {}
  ;(newFiles || []).forEach(file => {
    keptByTypeScope[file.report_type + '|' + (file.scope_id || '')] = file.report_id
  })

  const rows = await loadReceiptReportFiles(receipt)
  // 按取代来源分组批量更新（补丁只差 superseded_by_report_id），
  // 每批 200 个 _id 一次写，避免逐 doc 往返打满云函数时限（2026-11-09 审查）。
  const groupIds = {}
  for (const row of rows) {
    if (row.status === 'superseded') continue
    if (keepDbIds.has(row._id)) continue
    const byReportId = keptByTypeScope[row.report_type + '|' + (row.scope_id || '')] || ''
    if (!groupIds[byReportId]) groupIds[byReportId] = []
    groupIds[byReportId].push(row._id)
  }
  let superseded = 0
  for (const byReportId of Object.keys(groupIds)) {
    const ids = groupIds[byReportId]
    for (let i = 0; i < ids.length; i += 200) {
      const res = await db.collection('report_file').where({
        _id: _.in(ids.slice(i, i + 200)),
        status: _.neq('superseded')
      }).update({
        data: {
          status: 'superseded',
          superseded_at: db.serverDate(),
          superseded_by_report_id: byReportId,
          updated_at: db.serverDate()
        }
      })
      superseded += (res.stats && res.stats.updated) || 0
    }
  }
  return superseded
}

// 全量重出成功后：可付款行上的 pay_received 异常记录已被全量账单覆盖，
// 打上结算标记，避免后续补结算把同一行再计入一次（_S 增量 + _RG 全量双计根因）。
// 只标记本次 _RG 生成了 ⑥ 的供应商（无可付款行的供应商本就没有账单覆盖）。
// items 由调用方（regenerateReceiptReportsLocked）传入，不再重复查询。
async function markRecordsCoveredByFullReports(receipt, newFiles, items) {
  const reportIdBySupplier = {}
  ;(newFiles || []).forEach(file => {
    if (file.report_type === SETTLE_REPORT_TYPE) reportIdBySupplier[file.scope_id || ''] = file.report_id
  })

  const itemByKey = {}
  ;(items || []).forEach(item => { itemByKey[item.receipt_item_id] = item })

  const abnormalRes = await db.collection('abnormal_record')
    .where({ receipt_id: receipt.receipt_id })
    .limit(1000)
    .get()
  // 按目标账单分组批量写（补丁只差 settled_in_report_id，2026-11-09 审查）
  const groupIds = {}
  for (const rec of abnormalRes.data || []) {
    if (rec.payment_decision !== 'pay_received') continue
    if (rec.status === 'closed') continue
    if (rec.settled_at || Number(rec.settled_wave) > 0) continue
    const key = itemKeyFromAbnormalId(receipt.receipt_id, rec.abnormal_id)
    const item = itemByKey[key]
    if (!item || item.is_manual || Number(item.price_snapshot || 0) <= 0 || item.payable_flag === false) continue
    const reportId = reportIdBySupplier[item.supplier_id || '']
    if (!reportId) continue
    if (!groupIds[reportId]) groupIds[reportId] = []
    groupIds[reportId].push(rec._id)
  }
  let marked = 0
  for (const reportId of Object.keys(groupIds)) {
    const ids = groupIds[reportId]
    for (let i = 0; i < ids.length; i += 200) {
      const res = await db.collection('abnormal_record').where({
        _id: _.in(ids.slice(i, i + 200))
      }).update({
        data: {
          settled_at: db.serverDate(),
          settled_via: 'full',
          settled_in_report_id: reportId,
          updated_at: db.serverDate()
        }
      })
      marked += (res.stats && res.stats.updated) || 0
    }
  }
  return marked
}

// ===== B5 异常处理后补结算（_S 增量账单，支持多波） =====
// 收货单存在异常行被剔除后，按当前 receipt_item 的 payable_flag / price_snapshot
// 生成补充带价账单（每供应商一份）；行上仍有未处理完的异常时，该行等后续波次。
// 多波：每波只结算「尚未被补结算或全量账单覆盖」的解锁行，report_id 以 _S / _S2 / _S3 区分。
async function settleReceipt(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  let receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }

  // P1-2 并发锁：条件更新抢占，双管理员同时补结算只有一个能进入生成流程；
  // 锁带时间戳，超过 10 分钟视为上次执行崩溃残留，允许接管自愈
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const lockRes = await db.collection('receipt').where(_.or([
    { _id: receipt._id, settle_lock: _.neq(true) },
    { _id: receipt._id, settle_lock_at: _.lt(staleCutoff) }
  ])).update({
    data: { settle_lock: true, settle_lock_at: Date.now(), updated_at: db.serverDate() }
  })
  if (!lockRes.stats || !lockRes.stats.updated) {
    return { code: -1, msg: '补结算正在处理中，请勿重复操作' }
  }

  // 持锁后重读收货单：若上一轮补结算在本次取数之后、抢锁之前刚完成，
  // 旧 settle_wave_completed 会把波次算回上一波，导致新解锁行被误标为已结算却未出账单。
  try {
    const freshRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
    if (freshRes.data[0]) receipt = freshRes.data[0]
  } catch (e) {
    console.error('[settleReceipt] 持锁后重读收货单失败:', e)
  }

  // 与补价/补生成（regen_lock）互斥：两者都改写同一收货单的报表口径，
  // 并发跑会让 _RG 取代与 _S 增量的覆盖判断互相踩踏，留下双计窗口。
  let regenLockAcquired = false
  try {
    // 抢 regen_lock（与 repriceReceipt / regenerateReceiptReports 同一把 CAS 锁）
    const regenStaleCutoff = Date.now() - 10 * 60 * 1000
    const regenLockRes = await db.collection('receipt').where(_.or([
      { _id: receipt._id, regen_lock: _.neq(true) },
      { _id: receipt._id, regen_lock_at: _.lt(regenStaleCutoff) }
    ])).update({
      data: { regen_lock: true, regen_lock_at: Date.now(), updated_at: db.serverDate() }
    })
    if (!regenLockRes.stats || !regenLockRes.stats.updated) {
      return { code: -1, msg: '该收货单正在补价/补生成报表，请稍后重试补结算' }
    }
    regenLockAcquired = true

    const itemRes = await db.collection('receipt_item')
      .where({ receipt_id: receiptId })
      .limit(1000)
      .get()
    const items = itemRes.data || []
    const abnormalRes = await db.collection('abnormal_record')
      .where({ receipt_id: receiptId })
      .limit(1000)
      .get()
    const abnormals = abnormalRes.data || []

    const reportRows = await loadReceiptReportFiles(receipt)
    const settleReports = reportRows.filter(isSettleVersionReport)
    const fullReports = reportRows.filter(row => isFullVersionReport(row.report_id))

    // 已完成波次：新数据看 receipt.settle_wave_completed；历史只有一份 _S（无 settle_wave
    // 字段、receipt 上也无 settle_wave_completed）时按第 1 波已完成处理，避免把历史解锁行重复计入。
    const legacySettleReports = settleReports.filter(row => !(Number(row.settle_wave) > 0))
    const completedWave = Math.max(
      Number(receipt.settle_wave_completed) || 0,
      legacySettleReports.length > 0 ? 1 : 0
    )
    const wave = completedWave + 1

    // 历史数据兜底：新数据靠 settled_at / settled_wave 标记判断已结，不能按时间猜——
    // 新 _S 波次可能因行级门禁跳过了某行（之后该行仍应进后续波次），按时间比较会误判。
    // 只有没有新标记字段的历史账单才参与时间兜底：
    //   历史 _S = 无 settle_wave 字段；历史 _RG = 无 receipt_id 字段（新 _RG 由构建器回填）。
    const legacyFullReports = fullReports.filter(row => !row.receipt_id)
    const latestLegacySettleBySupplier = {}
    legacySettleReports.forEach(row => {
      const ts = reportTimeMs(row)
      const sid = row.scope_id || ''
      if (ts > (latestLegacySettleBySupplier[sid] || 0)) latestLegacySettleBySupplier[sid] = ts
    })
    const latestLegacyFullTime = legacyFullReports.reduce((max, row) => Math.max(max, reportTimeMs(row)), 0)

    // 行级门禁：某行只要还有未处理完（pending/processing）的异常，本波不结算该行，
    // 等异常处理完的后续波次再补（多波口径 2026-11-09）。
    const openItemKeys = new Set()
    abnormals.forEach(rec => {
      if (!['pending', 'processing'].includes(rec.status)) return
      const key = itemKeyFromAbnormalId(receiptId, rec.abnormal_id)
      if (key) openItemKeys.add(key)
    })

    const itemByKey = {}
    items.forEach(item => { itemByKey[item.receipt_item_id] = item })

    // 本波可纳入的解锁记录：pay_received 且未关闭、未被补结算/全量账单覆盖
    const unsettledRecords = abnormals.filter(rec => {
      if (rec.payment_decision !== 'pay_received') return false
      if (rec.status === 'closed') return false
      if (rec.settled_at || Number(rec.settled_wave) > 0) return false
      const key = itemKeyFromAbnormalId(receiptId, rec.abnormal_id)
      const item = itemByKey[key]
      if (!item || item.is_manual || Number(item.price_snapshot || 0) <= 0) return false

      const resolvedMs = new Date(rec.resolved_at).getTime()
      if (!Number.isFinite(resolvedMs)) {
        // 无解决时间：若该供应商已有历史补账单/本单已有历史全量账单，保守视为已覆盖
        return !(latestLegacySettleBySupplier[item.supplier_id || ''] || latestLegacyFullTime)
      }
      const supplierCoveredAt = latestLegacySettleBySupplier[item.supplier_id || ''] || 0
      if (supplierCoveredAt && resolvedMs <= supplierCoveredAt) return false
      if (latestLegacyFullTime && resolvedMs <= latestLegacyFullTime) return false
      return true
    })

    // 按行聚合 + 分类（2026-11-09 审查修复：增量只出「尚未被任何账单计价」的行）：
    //   解锁行 payable_flag=false（质量/错货等收货时被剔除带价账单）→ 本波出增量账单；
    //   已计价行 payable_flag=true → 只补结算标记，绝不再出账单。已计价的三种来源：
    //     ① 纯少货/正常行收货即进原版 ⑥（createReceipt：纯少货不剔除）；
    //     ② 全量重出 _RG 按当前可付款行重出，覆盖该行；
    //     ③ 覆盖该行的补结算报告（settle_item_ids 明确含该行）。
    //   否则（历史部分失败「只翻转 payable 未出账」的遗留行）仍按解锁行出账，防漏账。
    //   不做这个区分的话，少货行被裁为 pay_received 会出现 ⑥原 + _S 双计。
    const recordsByItemKey = {}
    unsettledRecords.forEach(rec => {
      const key = itemKeyFromAbnormalId(receiptId, rec.abnormal_id)
      if (!key) return
      if (!recordsByItemKey[key]) recordsByItemKey[key] = []
      recordsByItemKey[key].push(rec)
    })
    const targets = []
    const alreadyPricedTargets = []
    items.forEach(item => {
      const key = item.receipt_item_id
      if (item.is_manual || Number(item.price_snapshot || 0) <= 0) return
      const records = recordsByItemKey[key]
      if (!records || !records.length) return
      if (item.payable_flag === true) {
        const billedAtReceipt = !item.is_quality_issue && !item.is_wrong_item
        const coveredBySettle = settleReports.some(row =>
          (row.scope_id || '') === (item.supplier_id || '') &&
          Array.isArray(row.settle_item_ids) && row.settle_item_ids.includes(item._id))
        if (billedAtReceipt || fullReports.length > 0 || coveredBySettle) {
          alreadyPricedTargets.push({ item, records })
          return
        }
        // 历史遗留：已翻转可付款但没有任何账单覆盖 → 仍按解锁行出账
      }
      // 行级门禁：行上仍有未处理完的异常时，本波不结算该行，等后续波次
      if (openItemKeys.has(key)) return
      targets.push({ item, records })
    })

    // 已计价行：只补结算标记（无论本波有没有解锁行都先处理掉，否则每次补结算都重复审视）。
    // 补丁完全相同，按 _id 批量写（2026-11-09 审查：避免逐 doc 往返）
    const alreadyPricedRecIds = []
    alreadyPricedTargets.forEach(target => {
      target.records.forEach(rec => alreadyPricedRecIds.push(rec._id))
    })
    for (let i = 0; i < alreadyPricedRecIds.length; i += 200) {
      await db.collection('abnormal_record').where({
        _id: _.in(alreadyPricedRecIds.slice(i, i + 200))
      }).update({
        data: {
          settled_at: db.serverDate(),
          settled_via: 'already_priced',
          settled_in_report_id: '',
          updated_at: db.serverDate()
        }
      })
    }

    if (targets.length === 0) {
      if (alreadyPricedTargets.length > 0) {
        return {
          code: 0,
          data: {
            generatedSuppliers: [], count: 0, wave: completedWave,
            settledRows: 0, deferredRows: 0, coveredRows: alreadyPricedTargets.length
          }
        }
      }
      // recordsByItemKey 的键就是未结记录的行键，与上面的过滤同一趟解析结果
      const hasGated = Object.keys(recordsByItemKey).some(key => openItemKeys.has(key))
      return {
        code: -1,
        msg: hasGated
          ? '相关行仍有未处理完成的异常，暂无可补结算行'
          : '没有因异常处理解锁的明细行，无需补结算'
      }
    }

    // 按供应商分组
    const supplierMap = {}
    targets.forEach(target => {
      const sid = target.item.supplier_id || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], records: [], name: '' }
      supplierMap[sid].items.push(target.item)
      supplierMap[sid].records.push(...target.records)
    })
    const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
    for (let i = 0; i < supplierIds.length; i += 20) {
      const idChunk = supplierIds.slice(i, i + 20)
      const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
      supRes.data.forEach(s => {
        if (supplierMap[s.supplier_id]) supplierMap[s.supplier_id].name = s.supplier_name
      })
    }

    const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
    const storeName = receipt.store_name || ''
    const purchaseOrderId = receipt.purchase_order_id || ''
    const waveSuffix = wave === 1 ? '_S' : '_S' + wave
    const settleReportIdOf = sid => 'RPT_SURP_' + sid + '_' + receiptId + waveSuffix
    const existingReportIds = new Set(reportRows.map(row => row.report_id))

    const generatedSuppliers = []
    for (const sid of supplierIds) {
      const reportId = settleReportIdOf(sid)
      if (existingReportIds.has(reportId)) continue

      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const ver = await getNextVersion(SETTLE_REPORT_TYPE, sid, receiptDate)

      const waveNote = wave === 1 ? '异常处理后补结算（增量）' : `异常处理后补结算（增量第${wave}波）`
      const infoHead = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('备注'), csvField(waveNote)].join(',') + '\n'
      let csv = infoHead + [csvField('商品名称'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计')].join(',') + '\n'
      let total = 0
      supItems.forEach(item => {
        const price = Number(item.price_snapshot) || 0
        const qty = Number(item.received_qty) || 0
        const sub = Math.round(qty * price * 100) / 100
        total = Math.round((total + sub) * 100) / 100
        csv += [csvField(item.product_name), csvField(storeName), csvField(qty), csvField(item.unit_snapshot || ''), csvField(price), csvField(sub.toFixed(2))].join(',') + '\n'
      })
      csv += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(total.toFixed(2))].join(',') + '\n'

      const filePath = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(supName)}-${receiptDate}-${receiptId}-settle-v${ver}.csv`
      const uploadRes = await cloud.uploadFile({ cloudPath: filePath, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: reportId, report_type: SETTLE_REPORT_TYPE,
          receipt_id: receiptId,
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: filePath, file_url: uploadRes.fileID, file_version: ver,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          settle_for_receipt: receiptId, settle_type: 'increment',
          settle_wave: wave,
          settle_item_ids: supItems.map(item => item._id),
          settle_abnormal_ids: supplierMap[sid].records.map(rec => rec._id)
        }
      })
      generatedSuppliers.push(sid)
    }

    // 收尾（2026-11-09 审查修复：按「报告实际覆盖范围」标记，翻转后置）：
    // 续跑时已有报告的供应商按其报告的覆盖范围计——报告未覆盖的行（续跑间隙新解锁的）
    // 不标记、留给下一波，否则会出现「标记已结算但没进任何账单」的漏账。
    const coveredItemIds = new Set()
    const coveredRecordIds = new Set()
    supplierIds.forEach(sid => {
      const existing = settleReports.find(row => row.report_id === settleReportIdOf(sid))
      if (existing) {
        ;(existing.settle_item_ids || []).forEach(id => coveredItemIds.add(id))
        ;(existing.settle_abnormal_ids || []).forEach(id => coveredRecordIds.add(id))
      }
      if (generatedSuppliers.includes(sid)) {
        supplierMap[sid].items.forEach(item => coveredItemIds.add(item._id))
        supplierMap[sid].records.forEach(rec => coveredRecordIds.add(rec._id))
      }
    })

    let settledRows = 0
    let deferredRows = 0
    const coveredTargets = []
    for (const target of targets) {
      const isCovered = coveredItemIds.has(target.item._id) ||
        target.records.some(rec => coveredRecordIds.has(rec._id))
      if (!isCovered) { deferredRows++; continue }
      coveredTargets.push(target)
    }

    // 出账确认后才把解锁行转回可付款：先翻转后出账的话，中途崩溃会让该行变成
    // 「已付款但没进任何账单」，重试也会因 payable=true 被当成已计价行跳过（漏账）。
    // 补丁相同，where 里带 payable_flag 守卫批量一次写（2026-11-09 审查）。
    const flipIds = coveredTargets.filter(target => target.item.payable_flag !== true)
      .map(target => target.item._id)
    for (let i = 0; i < flipIds.length; i += 200) {
      await db.collection('receipt_item').where({
        _id: _.in(flipIds.slice(i, i + 200)),
        payable_flag: _.neq(true)
      }).update({ data: { payable_flag: true, updated_at: db.serverDate() } })
    }

    // 按账单分组批量打结算标记（补丁只差 settled_in_report_id）
    const markGroups = {}
    coveredTargets.forEach(target => {
      const reportId = settleReportIdOf(target.item.supplier_id || '')
      if (!markGroups[reportId]) markGroups[reportId] = []
      target.records.forEach(rec => markGroups[reportId].push(rec._id))
      settledRows++
    })
    for (const reportId of Object.keys(markGroups)) {
      const ids = markGroups[reportId]
      for (let i = 0; i < ids.length; i += 200) {
        await db.collection('abnormal_record').where({
          _id: _.in(ids.slice(i, i + 200))
        }).update({
          data: {
            settled_at: db.serverDate(),
            settled_wave: wave,
            settled_via: 'increment',
            settled_in_report_id: reportId,
            updated_at: db.serverDate()
          }
        })
      }
    }
    await db.collection('receipt').doc(receipt._id).update({
      data: { settle_wave_completed: wave, updated_at: db.serverDate() }
    })

    return {
      code: 0,
      data: {
        generatedSuppliers, count: generatedSuppliers.length, wave,
        settledRows, deferredRows, coveredRows: alreadyPricedTargets.length
      }
    }
  } finally {
    // 无论成功失败都释放并发锁；失败后可重新发起，成功后由波次/标记兜底防重复
    try {
      await db.collection('receipt').doc(receipt._id).update({
        data: { settle_lock: false, settle_lock_at: null, updated_at: db.serverDate() }
      })
    } catch (e) {
      console.error('[settleReceipt] 释放补结算锁失败:', e)
    }
    if (regenLockAcquired) {
      try {
        await db.collection('receipt').doc(receipt._id).update({
          data: { regen_lock: false, regen_lock_at: null, updated_at: db.serverDate() }
        })
      } catch (e) {
        console.error('[settleReceipt] 释放报表锁失败:', e)
      }
    }
  }
}

// ===== 清单 #7：下单报表失败后补生成 ① ② 报表 =====
// createPurchaseOrder 报表生成失败时在订单上打 missing_reports 标记，
// 本入口按订单重读 purchase_order_item，重走 ① 门店下单 / ② 供应商订货汇总。
// 复用 regenerateApprovedOrderReports 的生成逻辑（内部已含 superseded 标记）。
async function regenerateOrderReports(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const orderId = String(event.orderId || '').trim()
  if (!orderId) return { code: -1, msg: '缺少订单号' }

  const orderRes = await db.collection('purchase_order')
    .where({ purchase_order_id: orderId })
    .limit(1)
    .get()
  const order = orderRes.data[0]
  if (!order) return { code: -1, msg: '采购订单不存在' }

  const itemRes = await db.collection('purchase_order_item')
    .where({ purchase_order_id: orderId })
    .limit(1000)
    .get()
  const orderItems = itemRes.data || []
  if (orderItems.length === 0) return { code: -1, msg: '订单明细不存在，无法补生成' }

  // qtyMap 用数据库中的当前下单量（未发生审核改量时与快照一致）
  const qtyMap = {}
  orderItems.forEach(item => {
    const key = item.item_id || item._id
    if (key) qtyMap[key] = Number(item.order_qty) || 0
  })

  await regenerateApprovedOrderReports(order, orderItems, qtyMap, false)

  // 补生成成功后清除缺报表标记
  await db.collection('purchase_order')
    .where({ purchase_order_id: orderId, missing_reports: true })
    .update({ data: { missing_reports: false, updated_at: db.serverDate() } })

  return { code: 0, data: { orderId, regenerated: true } }
}

// ===== 清单 #7 报表失败补偿：管理员手动补生成收货报表 =====
// 报表生成失败（非异常场景）时，createReceipt 会在订单上打 missing_reports 标记。
// 本入口按 receipt_id 重读 receipt_item（价格快照都在库里），重走
// ③ 门店收货 / ④ 门店带价 / ⑤ 供应商到货 / ⑥ 供应商带价账单 四类报表。
// 不自动重试的原因：失败多为云存储/网络问题，人工触发天然幂等、量极少。
// ===== #11 拍板（2026-09-24）：补价后补账 =====
// 收货时缺价（missing_price 异常）的行，管理员在价格管理页补配协议价后，
// 用本入口按当前 is_current 价刷新 receipt_item 的价格快照并转回可付款，
// 同时关闭对应缺价异常，再重走 ③④⑤⑥ 报表把账单补出来。
// 复用 regenerateReceiptReports 的报表重建逻辑（_RG 后缀，幂等）。
async function repriceReceipt(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  // F3（2026-11-05）并发锁：与 regenerateReceiptReports 共用 regen_lock——
  // 本函数会改 receipt_item 价格快照/付款资格并调 regenerate 重出报表，
  // 两者必须互斥；锁带时间戳，超 10 分钟视为崩溃残留允许接管自愈。
  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const lockRes = await db.collection('receipt').where(_.or([
    { _id: receipt._id, regen_lock: _.neq(true) },
    { _id: receipt._id, regen_lock_at: _.lt(staleCutoff) }
  ])).update({
    data: { regen_lock: true, regen_lock_at: Date.now(), updated_at: db.serverDate() }
  })
  if (!lockRes.stats || lockRes.stats.updated === 0) {
    return { code: -1, msg: '该收货单报表正在补生成/补价中，请勿重复操作' }
  }
  try {
    return await repriceReceiptLocked(event, receiptId, auth)
  } finally {
    try {
      await db.collection('receipt').doc(receipt._id).update({
        data: { regen_lock: false, regen_lock_at: null, updated_at: db.serverDate() }
      })
    } catch (e) {
      console.error('[repriceReceipt] 释放补价锁失败:', e)
    }
  }
}

// F3：repriceReceipt 的持锁主体（锁由入口函数管理）
async function repriceReceiptLocked(event, receiptId, auth) {
  const itemRes = await db.collection('receipt_item')
    .where({ receipt_id: receiptId })
    .limit(1000)
    .get()
  const items = itemRes.data || []
  // 只处理缺价行：档案商品（非手动）、有供应商、快照 0 价
  const missingItems = items.filter(item => !item.is_manual && item.supplier_id && Number(item.price_snapshot || 0) <= 0)
  if (missingItems.length === 0) return { code: -1, msg: '该收货单没有缺价行，无需补账' }

  // 批量取当前协议价
  const priceMap = {}
  const productIds = [...new Set(missingItems.map(item => item.product_id).filter(Boolean))]
  for (let i = 0; i < productIds.length; i += 20) {
    const idChunk = productIds.slice(i, i + 20)
    const priceRes = await db.collection('supplier_product_price')
      .where({ product_id: _.in(idChunk), is_current: 1 })
      .limit(100)
      .get()
    priceRes.data.forEach(p => { priceMap[`${p.supplier_id}|${p.product_id}`] = Number(p.price) || 0 })
  }

  const repriced = []
  const stillMissing = []
  for (const item of missingItems) {
    const price = priceMap[`${item.supplier_id}|${item.product_id}`] || 0
    if (price <= 0) { stillMissing.push(item.product_name); continue }
    await db.collection('receipt_item').doc(item._id).update({
      data: { price_snapshot: price, payable_flag: true, updated_at: db.serverDate() }
    })
    repriced.push(item.product_name)
  }
  if (repriced.length === 0) {
    return { code: -1, msg: `仍未找到协议价：${stillMissing.join('、')}。请先在价格管理页补配价格` }
  }

  // 关闭已补价的 missing_price 异常（标记 resolved，补价即处置完成）
  const abnormalRes = await db.collection('abnormal_record')
    .where({ receipt_id: receiptId, type: 'missing_price', status: _.in(['pending', 'processing']) })
    .limit(100)
    .get()
  for (const rec of abnormalRes.data) {
    await db.collection('abnormal_record').doc(rec._id).update({
      data: {
        status: 'resolved',
        resolution: '已补配协议价并刷新价格快照，账单按补价重出',
        handled_by: auth.user.name,
        updated_at: db.serverDate()
      }
    })
  }

  // 重走 ③④⑤⑥ 报表（复用补生成逻辑，账单按新快照补出）
  // _lockHeld：锁已由本函数入口持有，regenerate 跳过抢锁避免自我死锁
  //（dispatcher 会剔除客户端伪造的该标记，仅内部调用可达此路径）
  const regen = await regenerateReceiptReports({ ...event, _lockHeld: true })
  if (regen.code !== 0) return regen
  return {
    code: 0,
    data: {
      message: `已补价 ${repriced.length} 行${stillMissing.length ? `；仍有 ${stillMissing.length} 行缺价：${stillMissing.join('、')}` : ''}，账单已重新生成`,
      repriced: repriced.length,
      stillMissing
    }
  }
}

async function regenerateReceiptReports(event) {
  const auth = await requireUser(event, GLOBAL_ROLES)
  if (auth.error) return auth.error
  const receiptId = String(event.receiptId || '').trim()
  if (!receiptId) return { code: -1, msg: '缺少收货单号' }

  const receiptRes = await db.collection('receipt').where({ receipt_id: receiptId }).limit(1).get()
  const receipt = receiptRes.data[0]
  if (!receipt) return { code: -1, msg: '收货单不存在' }

  // F3（2026-11-05）并发锁：与 settleReceipt 同款 CAS 抢占——补生成/补价重出
  // 期间并发触发会产生重复报表版本（report_id 恒 _RG 且不标 superseded，旧版新版
  // 并存计入）。repriceReceipt 内部调用时锁已由调用方持有（_lockHeld），此处跳过
  // 抢锁；dispatcher 会剔除客户端伪造的 _lockHeld，外部直达调用必走抢锁。
  // 锁带时间戳，超 10 分钟视为上次执行崩溃残留，允许接管自愈。
  const lockHeldByCaller = event._lockHeld === true
  if (!lockHeldByCaller) {
    const staleCutoff = Date.now() - 10 * 60 * 1000
    const lockRes = await db.collection('receipt').where(_.or([
      { _id: receipt._id, regen_lock: _.neq(true) },
      { _id: receipt._id, regen_lock_at: _.lt(staleCutoff) }
    ])).update({
      data: { regen_lock: true, regen_lock_at: Date.now(), updated_at: db.serverDate() }
    })
    if (!lockRes.stats || lockRes.stats.updated === 0) {
      return { code: -1, msg: '该收货单报表正在补生成/补价中，请勿重复操作' }
    }
  }

  try {
    return await regenerateReceiptReportsLocked(event, receipt, receiptId)
  } finally {
    if (!lockHeldByCaller) {
      try {
        await db.collection('receipt').doc(receipt._id).update({
          data: { regen_lock: false, regen_lock_at: null, updated_at: db.serverDate() }
        })
      } catch (e) {
        console.error('[regenerateReceiptReports] 释放补生成锁失败:', e)
      }
    }
  }
}

// F3：regenerateReceiptReports 的持锁主体（锁由入口函数管理，不直接暴露）
async function regenerateReceiptReportsLocked(event, receipt, receiptId) {
  const itemRes = await db.collection('receipt_item')
    .where({ receipt_id: receiptId })
    .limit(1000)
    .get()
  const items = itemRes.data || []
  if (items.length === 0) return { code: -1, msg: '收货明细不存在，无法补生成' }

  const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
  const storeId = receipt.store_id || ''
  const storeName = receipt.store_name || ''
  const purchaseOrderId = receipt.purchase_order_id || ''

  // ③④⑤⑥ 统一走共享构建器（2026-11-05 解耦第 4 项；源头 scripts/cloud-shared/
  // receipt-reports.js）。_RG 语义保持：report_id 带 _RG 后缀、文件名 -regen-v、
  // report_file 落 regenerated:true、infoHead 备注「报表失败后补生成」。
  // 对齐修复（_RG 旧版漂移）：补回 missing_price 文案（缺价行曾显示"正常"）、
  // infoHead 下单日期/期望到货两列（从 purchase_order 补查）、report_file.abnormal_summary。
  let orderDate = ''
  let deliveryDate = ''
  if (purchaseOrderId) {
    const orderRes = await db.collection('purchase_order').where({ purchase_order_id: purchaseOrderId }).limit(1).get()
    const ord = orderRes.data[0]
    if (ord) { orderDate = ord.order_date || ''; deliveryDate = ord.delivery_date || '' }
  }
  let generated = []
  let superseded = 0
  try {
    const reportResult = await buildReceiptReports({
      receiptId, purchaseOrderId, storeId, storeName, receiptDate,
      orderDate, deliveryDate,
      receivedBy: receipt.received_by || '',
      batchNo: Number(receipt.batch_no) || 1, isFinal: receipt.is_final !== false,
      items: items.map(adaptReceiptItem),
      idSuffix: '_RG', fileTag: 'regen-v', headNote: '报表失败后补生成', regenerated: true
    })
    generated = reportResult.generated

    // 2026-11-09 双计修复：全量版取代本批次旧版（原版/各波 _S/旧 _RG），
    // 并标记已被全量账单覆盖的 pay_received 异常记录。
    superseded = await supersedeReceiptReports(receipt, reportResult.files)
    await markRecordsCoveredByFullReports(receipt, reportResult.files, items)
  } catch (err) {
    console.error('[dataService] 补生成收货报表失败:', err)
    return { code: -1, msg: '补生成失败，请稍后重试（已生成的报表不受影响）', data: { generated } }
  }

  // 补生成成功后清除订单上的缺报表标记
  if (purchaseOrderId) {
    await db.collection('purchase_order')
      .where({ purchase_order_id: purchaseOrderId, missing_reports: true })
      .update({ data: { missing_reports: false, updated_at: db.serverDate() } })
  }
  return { code: 0, data: { generated, count: generated.length, superseded } }
}

module.exports = { settleReceipt, repriceReceipt, regenerateReceiptReports, regenerateOrderReports }
