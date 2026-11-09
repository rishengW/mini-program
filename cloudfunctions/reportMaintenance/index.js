// 云函数 reportMaintenance — 收货报表版本一次性清理（2026-11-09 双计修复配套）
//
// 背景：_S（补结算增量）与 _RG（全量重出）语义重叠，同一笔账可能在多版账单里
// 各出现一次；且历史 _RG 不标 superseded，新旧版本并存计入。
// 拍板口径（2026-11-09）：全量版取代旧版 + 历史数据一次性清理。
//
// 用法（云函数测试面板，super_admin 会话）：
//   { authToken: '<超管登录 token>', action: 'dryRun' }                 —— 只输出计划，不落库
//   { authToken: '<超管登录 token>', action: 'apply' }                  —— 执行清理（幂等，可重复跑）
//   { authToken: '...', action: 'apply', maxReceipts: 200 }             —— 限制单次回填的收货单数
//
// 清理内容：
//   1) 取代：对包含 _RG 的每个 (收货单, report_type, scope_id) 组，保留最新 _RG；
//      保留该 _RG 之后生成的 _S 增量波次；原版、旧 _RG、被全量版覆盖的旧 _S 标 superseded。
//      无 _RG 的组不动（原版 + 增量 _S 本身口径正确，也避免误伤部分失败的历史重出）。
//   2) 回填历史 _S 的 settle_type / settle_for_receipt（仅补结算过的单，量小）。
//      刻意不回填：settle_wave（settle.js 以此判别历史账单）、receipt_id（新数据由构建器
//      直接写入，历史行回填代价大而现有代码都从 report_id 反解、不读该字段）。
//   3) 回填异常记录的 settled 标记与 receipt.settle_wave_completed，
//      让部署后的多波补结算能从历史状态正确续跑（不会把历史已结算行再计入一次）。
//   4) 写入全部走 where({_id: _.in(chunk)}) 分组批量更新，幂等可重复跑。
//
// 注意：清理只动 report_file 元数据，不删除云存储文件；superseded 记录仍可追溯。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { getSessionUser } = require('./shared/session')
const {
  receiptIdFromReportId, RECEIPT_REPORT_TYPES,
  SETTLE_REPORT_TYPE, isFullVersionReport, isSettleVersionReport, settleWaveOfReport, reportTimeMs
} = require('./shared/receipt-reports')

// report_id 文法单源在 shared/receipt-reports.js（与 settle.js 同一份实现），勿再写本地副本。

// 新版本优先：生成时间 → 文件版本号
function compareVersion(a, b) {
  const dt = reportTimeMs(b) - reportTimeMs(a)
  if (dt !== 0) return dt
  return (Number(b.file_version) || 0) - (Number(a.file_version) || 0)
}

// 按补丁分组批量写（2026-11-09 审查）：把同补丁的 doc 用 where({_id: _.in(chunk)}) 一次更新，
// 避免数千次逐 doc 往返在 ~60s 云函数时限内跑不完。extraWhere 可附加幂等守卫条件。
// entries: [{ id, key, data }]，同 key 共享同一补丁。
async function batchUpdate(collection, entries, extraWhere) {
  const groupIds = {}
  entries.forEach(entry => {
    if (!groupIds[entry.key]) groupIds[entry.key] = { patch: entry.data, ids: [] }
    groupIds[entry.key].ids.push(entry.id)
  })
  let updated = 0
  for (const group of Object.values(groupIds)) {
    for (let i = 0; i < group.ids.length; i += 200) {
      const res = await db.collection(collection).where({
        _id: _.in(group.ids.slice(i, i + 200)),
        ...(extraWhere || {})
      }).update({ data: group.patch })
      updated += (res.stats && res.stats.updated) || 0
    }
  }
  return updated
}

async function loadAllReportFiles() {
  const rows = []
  let offset = 0
  while (true) {
    const res = await db.collection('report_file')
      .where({ report_type: _.in(RECEIPT_REPORT_TYPES) })
      .skip(offset)
      .limit(200)
      .get()
    rows.push(...(res.data || []))
    if ((res.data || []).length < 200) break
    offset += 200
  }
  return rows
}

function groupByReceipt(rows) {
  const byReceipt = {}
  const unparsed = []
  rows.forEach(row => {
    const receiptId = receiptIdFromReportId(row.report_id)
    if (!receiptId) { unparsed.push(row.report_id); return }
    if (!byReceipt[receiptId]) byReceipt[receiptId] = []
    byReceipt[receiptId].push(row)
  })
  return { byReceipt, unparsed }
}

// 1) 取代计划：按 (report_type, scope_id) 组保留最新 _RG，保留其后的 _S 波次
function planSupersede(byReceipt) {
  const plans = []
  const receiptsWithFull = new Set()
  for (const receiptId of Object.keys(byReceipt)) {
    const group = byReceipt[receiptId]
    const fulls = group.filter(row => isFullVersionReport(row.report_id))
    if (!fulls.length) continue
    receiptsWithFull.add(receiptId)

    const byTypeScope = {}
    group.forEach(row => {
      const key = row.report_type + '|' + (row.scope_id || '')
      if (!byTypeScope[key]) byTypeScope[key] = []
      byTypeScope[key].push(row)
    })

    for (const key of Object.keys(byTypeScope)) {
      const typeScopeRows = byTypeScope[key]
      const typeScopeFulls = typeScopeRows.filter(row => isFullVersionReport(row.report_id))
      if (!typeScopeFulls.length) continue // 该组无全量版：保留原版+增量，不动

      const newestFull = typeScopeFulls.slice().sort(compareVersion)[0]
      const newestFullTime = reportTimeMs(newestFull)
      typeScopeRows.forEach(row => {
        if (row.status === 'superseded') return
        if (row._id === newestFull._id) return
        if (isSettleVersionReport(row) && reportTimeMs(row) > newestFullTime) return
        plans.push({
          receiptId,
          row,
          keepReportId: newestFull.report_id,
          reason: isSettleVersionReport(row)
            ? 'increment_before_full'
            : (isFullVersionReport(row.report_id) ? 'older_full' : 'original_before_full')
        })
      })
    }
  }
  return { plans, receiptsWithFull }
}

// 3) report_file 字段回填计划（2026-11-09 审查修订）。
// 只回填历史 _S 的 settle_type / settle_for_receipt（信息性字段，量小——只有发生过补结算
// 的收货单才涉及）。刻意【不】回填的字段：
//   - settle_wave：settleWaveOfReport 对无字段的 _S 能从后缀解析出波次，回填无必要；
//     且 settle.js 用「_S 无 settle_wave 字段」判别历史账单，回填会掐掉时间兜底。
//   - receipt_id：新数据由构建器直接写入；历史行回填要更新全部 report_file（数千次写，
//     云函数时限跑不完），而现有代码一律从 report_id 反解、并不读这个字段。
//   - _RG 行的 receipt_id：同上是「新旧 _RG」判别依据，不回填。
// 若异常记录标记回填（第 4 步）尚未覆盖某收货单，这些判别字段必须原样保留。
function planFileBackfill(byReceipt) {
  const plans = []
  for (const receiptId of Object.keys(byReceipt)) {
    byReceipt[receiptId].forEach(row => {
      if (!isSettleVersionReport(row)) return
      const patch = {}
      if (!row.settle_type) patch.settle_type = 'increment'
      if (!row.settle_for_receipt) patch.settle_for_receipt = receiptId
      if (Object.keys(patch).length) plans.push({ row, patch })
    })
  }
  return plans
}

// 4) 异常记录/收货单结算状态回填计划（仅含 _S/_RG 的收货单）
// 2026-11-09 审查修订：收货单批量取（50/批，避免逐单 N+1）；每供应商最新账单一次取好，
// 避免逐记录重复过滤排序。
async function planSettlementBackfill(byReceipt, receiptsWithFull, maxReceipts) {
  const candidates = Object.keys(byReceipt).filter(receiptId => {
    if (receiptsWithFull.has(receiptId)) return true
    return byReceipt[receiptId].some(isSettleVersionReport)
  })
  const plans = []
  const receiptPatches = []
  const notes = []
  const processed = []
  const limited = candidates.slice(0, maxReceipts)

  // 先按内存中的报表行筛出真正需要查库的单据，再批量取收货单
  const workList = []
  for (const receiptId of limited) {
    const rows = byReceipt[receiptId]
    const settlRows = rows.filter(isSettleVersionReport)
    const fullRows = rows.filter(row => isFullVersionReport(row.report_id) && row.report_type === SETTLE_REPORT_TYPE)
    if (!settlRows.length && !fullRows.length) continue
    workList.push({ receiptId, settlRows, fullRows })
  }
  const receiptByReceiptId = {}
  for (let i = 0; i < workList.length; i += 50) {
    const chunk = workList.slice(i, i + 50).map(work => work.receiptId)
    const res = await db.collection('receipt').where({ receipt_id: _.in(chunk) }).limit(50).get()
    ;(res.data || []).forEach(row => { receiptByReceiptId[row.receipt_id] = row })
  }

  for (const work of workList) {
    const { receiptId, settlRows, fullRows } = work
    const receipt = receiptByReceiptId[receiptId]
    if (!receipt) { notes.push({ receiptId, note: '收货单不存在，跳过' }); continue }
    processed.push(receiptId)

    // 收货单已完成波次：只回填历史 _S（无 settle_wave 字段）视为第 1 波。
    // 新数据各波完成后由 settleReceipt 自己维护该字段，清理工具不再越权推进
    // （避免把部分失败的波次误标为已完成）。
    const legacyMaxWave = settlRows
      .filter(row => !(Number(row.settle_wave) > 0))
      .reduce((max, row) => Math.max(max, settleWaveOfReport(row)), 0)
    if (legacyMaxWave > 0 && !(Number(receipt.settle_wave_completed) >= legacyMaxWave)) {
      receiptPatches.push({ receipt, settle_wave_completed: legacyMaxWave })
    }

    const itemRes = await db.collection('receipt_item').where({ receipt_id: receiptId }).limit(1000).get()
    const itemByKey = {}
    ;(itemRes.data || []).forEach(item => { itemByKey[item.receipt_item_id] = item })

    // 每供应商最新补账单/全量账单（只算 ⑥ 带价账单）——一次取好行与时间
    const newestSettleRowBySupplier = {}
    const newestFullRowBySupplier = {}
    settlRows.forEach(row => {
      const sid = row.scope_id || ''
      const best = newestSettleRowBySupplier[sid]
      if (!best || compareVersion(best, row) > 0) newestSettleRowBySupplier[sid] = row
    })
    fullRows.forEach(row => {
      const sid = row.scope_id || ''
      const best = newestFullRowBySupplier[sid]
      if (!best || compareVersion(best, row) > 0) newestFullRowBySupplier[sid] = row
    })

    const abnormalRes = await db.collection('abnormal_record').where({ receipt_id: receiptId }).limit(1000).get()
    for (const rec of abnormalRes.data || []) {
      if (rec.payment_decision !== 'pay_received') continue
      if (rec.status === 'closed') continue
      if (rec.settled_at || Number(rec.settled_wave) > 0) continue
      const parts = String(rec.abnormal_id || '').split('_')
      if (parts.length < 3 || parts[0] !== receiptId) continue
      const item = itemByKey[receiptId + '_' + parts[1]]
      if (!item || item.is_manual || Number(item.price_snapshot || 0) <= 0 || item.payable_flag === false) continue
      const sid = item.supplier_id || ''
      const settleRow = newestSettleRowBySupplier[sid]
      const fullRow = newestFullRowBySupplier[sid]
      if (!settleRow && !fullRow) continue
      const settleTime = settleRow ? reportTimeMs(settleRow) : 0
      const fullTime = fullRow ? reportTimeMs(fullRow) : 0
      const coverTime = Math.max(settleTime, fullTime)
      const resolvedMs = new Date(rec.resolved_at).getTime()
      // 解决时间晚于覆盖账单 → 该记录属于后续波次，保持未结
      if (Number.isFinite(resolvedMs) && resolvedMs > coverTime) continue

      const useSettle = settleTime >= fullTime
      const coverRow = useSettle ? settleRow : fullRow
      plans.push({
        rec,
        patch: {
          settled_at: toServerDate(coverRow.generated_at),
          settled_via: 'legacy',
          settled_in_report_id: coverRow.report_id,
          ...(useSettle ? { settled_wave: settleWaveOfReport(coverRow) } : {})
        }
      })
    }
  }

  return {
    plans,
    receiptPatches,
    notes,
    processedCount: processed.length,
    remainingCount: candidates.length - limited.length
  }
}

function toServerDate(value) {
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? new Date(ts) : db.serverDate()
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (user.role !== 'super_admin') return { code: -403, msg: '仅超级管理员可执行数据清理' }

    const apply = event.action === 'apply'
    if (event.action && event.action !== 'apply' && event.action !== 'dryRun') {
      return { code: -1, msg: 'action 仅支持 dryRun / apply' }
    }
    const maxReceipts = Math.max(1, Math.min(1000, Number(event.maxReceipts) || 200))

    const rows = await loadAllReportFiles()
    const { byReceipt, unparsed } = groupByReceipt(rows)
    const { plans: supersedePlans, receiptsWithFull } = planSupersede(byReceipt)
    const fileBackfillPlans = planFileBackfill(byReceipt)
    const settlement = await planSettlementBackfill(byReceipt, receiptsWithFull, maxReceipts)

    if (apply) {
      // 全部走分组批量写（where({_id: _.in(chunk)})），逐 doc 版本在 ~60s 时限内跑不完
      // 万级历史行；取代批带 status 守卫保持幂等（2026-11-09 审查）。
      const supersededApplied = await batchUpdate('report_file', supersedePlans.map(plan => ({
        id: plan.row._id,
        key: plan.keepReportId,
        data: {
          status: 'superseded',
          superseded_at: db.serverDate(),
          superseded_by_report_id: plan.keepReportId,
          updated_at: db.serverDate()
        }
      })), { status: _.neq('superseded') })

      const fileBackfillApplied = await batchUpdate('report_file', fileBackfillPlans.map(plan => ({
        id: plan.row._id,
        key: JSON.stringify(plan.patch),
        data: { ...plan.patch, updated_at: db.serverDate() }
      })))

      const receiptPatchesApplied = await batchUpdate('receipt', settlement.receiptPatches.map(patch => ({
        id: patch.receipt._id,
        key: String(patch.settle_wave_completed),
        data: { settle_wave_completed: patch.settle_wave_completed, updated_at: db.serverDate() }
      })))

      const abnormalMarksApplied = await batchUpdate('abnormal_record', settlement.plans.map(plan => ({
        id: plan.rec._id,
        key: [plan.patch.settled_via, plan.patch.settled_in_report_id, plan.patch.settled_wave || ''].join('|'),
        data: { ...plan.patch, updated_at: db.serverDate() }
      })))
      return {
        code: 0,
        data: {
          mode: 'apply',
          scannedReportFiles: rows.length,
          receipts: Object.keys(byReceipt).length,
          supersededApplied,
          fileBackfillApplied,
          abnormalMarksApplied,
          receiptPatchesApplied,
          remainingReceiptsForBackfill: settlement.remainingCount,
          unparsedReportIds: unparsed.slice(0, 50)
        }
      }
    }

    // dryRun：输出计划（截断展示，避免响应过大）
    return {
      code: 0,
      data: {
        mode: 'dryRun',
        scannedReportFiles: rows.length,
        receipts: Object.keys(byReceipt).length,
        receiptsWithFullVersion: receiptsWithFull.size,
        supersede: {
          count: supersedePlans.length,
          sample: supersedePlans.slice(0, 100).map(plan => ({
            receiptId: plan.receiptId,
            reportId: plan.row.report_id,
            reason: plan.reason,
            keepReportId: plan.keepReportId
          }))
        },
        fileBackfill: {
          count: fileBackfillPlans.length,
          sample: fileBackfillPlans.slice(0, 50).map(plan => ({
            reportId: plan.row.report_id, patch: plan.patch
          }))
        },
        settlementBackfill: {
          processedReceipts: settlement.processedCount,
          remainingReceipts: settlement.remainingCount,
          abnormalMarks: settlement.plans.length,
          receiptWavePatches: settlement.receiptPatches.length,
          notes: settlement.notes.slice(0, 50)
        },
        unparsedReportIds: unparsed.slice(0, 50)
      }
    }
  } catch (err) {
    console.error('[reportMaintenance] 清理失败:', err)
    return { code: -1, msg: '清理失败：' + (err.message || '未知错误') }
  }
}
