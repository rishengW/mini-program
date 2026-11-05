// 共享模块：报表版本取号（CAS，2026-11-05 解耦第 3 项收敛）。
// 源头：scripts/cloud-shared/report-version.js —— 由 scripts/sync-shared.js 复制到
// 各云函数目录 shared/ 下；请勿直接改副本，改源头后重新跑同步脚本。
// 使用方：createReceipt / createPurchaseOrder / generateSummaryReport / dataService。
// 四处原副本逻辑逐字一致（仅日志前缀不同），本文件原样收敛，日志前缀统一为 [getNextVersion]。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getNextVersion(reportType, scopeId, relatedDate) {
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
      if (attempt === 4) console.error('[getNextVersion] 计数器创建失败:', counterId, err)
    }
  }
  throw new Error('getNextVersion: 计数器更新失败')
}

module.exports = { getNextVersion }
