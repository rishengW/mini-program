// 共享模块：报表 CSV 转义与云存储路径安全（2026-11-05 解耦第 3 项收敛）。
// 源头：scripts/cloud-shared/csv-utils.js —— 由 scripts/sync-shared.js 复制到
// 各云函数目录 shared/ 下；请勿直接改副本，改源头后重新跑同步脚本。
// 使用方：createReceipt / createPurchaseOrder / generateSummaryReport / dataService。
// 四处原副本逐字一致，本文件即原样收敛，未改任何行为。

function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

module.exports = { csvField, safePathPart }
