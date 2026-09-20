// 云函数 getReportFileUrl - 获取报表文件临时下载链接
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { fileId } = event || {}
    if (!fileId) return { code: -1, msg: '缺少fileId' }

    const reportRes = await db.collection('report_file').where({ file_url: fileId }).limit(1).get()
    if (!reportRes.data.length) return { code: -1, msg: '报表文件不存在' }
    const report = reportRes.data[0]
    if (!['super_admin', 'purchaser'].includes(user.role)) {
      if (!['chef', 'store_manager'].includes(user.role) || report.report_scope !== 'store' || report.scope_id !== user.default_store_id) {
        return { code: -403, msg: '无权下载该报表文件' }
      }
      if (user.role === 'chef' && report.report_type !== 'store_order_report') return { code: -403, msg: '当前账号无权下载该报表文件' }
    }
    const res = await cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList.length > 0 && res.fileList[0].tempFileURL) {
      return { code: 0, data: { url: res.fileList[0].tempFileURL } }
    }
    return { code: -1, msg: '获取链接失败' }
  } catch (err) {
    console.error('[getReportFileUrl] 文件链接获取失败:', err)
    return { code: -1, msg: '报表文件链接获取失败，请稍后重试' }
  }
}
