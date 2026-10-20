/**
 * 时间戳解析：全项目统一的"日期字符串 → 毫秒数"口径。
 *
 * 背景：云函数返回的日期多为 ISO 8601（new Date().toISOString()），
 * 但历史数据里也混有 "2026-09-24 12:00:00" 这类非 ISO 格式。
 * iOS 的 JSCore 只认标准 ISO 8601，遇到非 ISO 字符串返回 Invalid Date；
 * 而把 ISO 里的 "-" 换成 "/" 又会破坏其时区语义（"…000Z" 退化为本地时间解析）。
 *
 * 口径：先按原生 ISO 解析（iOS/Android 均支持），失败才退回斜杠格式兜底。
 */

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return NaN
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? NaN : value.getTime()
  }
  if (typeof value === 'number') {
    // 与数据层口径一致：小于 1e12 视为秒级时间戳
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value
    return Number.isFinite(ms) ? ms : NaN
  }
  const text = String(value).trim()
  if (!text) return NaN
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return parseTimestamp(Number(text))
  // 首选原生解析：标准 ISO 8601 在各基础库上都能正确处理时区
  const native = new Date(text)
  if (!Number.isNaN(native.getTime())) return native.getTime()
  // 兜底："2026-09-24 12:00:00" 这类非 ISO 格式，转成 JSCore 可解析的斜杠格式
  const fallback = new Date(text.replace(/-/g, '/').replace('T', ' '))
  return Number.isNaN(fallback.getTime()) ? NaN : fallback.getTime()
}

module.exports = { parseTimestamp }
