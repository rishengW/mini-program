// 共享模块：会话校验（19 个云函数共用，2026-11-05 解耦第 3 项收敛）。
// 源头：scripts/cloud-shared/session.js —— 由 scripts/sync-shared.js 复制到
// 各云函数目录 shared/ 下；请勿直接改副本，改源头后重新跑同步脚本。
//
// 自包含设计：自行 init 云环境（wx-server-sdk 同 env 重复 init 幂等无害），
// 复制进任何函数目录即可用，不依赖宿主文件的 db/crypto 变量。
const crypto = require('crypto')
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

module.exports = { hashToken, getSessionUser }
