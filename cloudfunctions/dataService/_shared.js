// dataService 共享层（2026-11-05 单体拆分）：db 连接、角色常量、会话校验、通用工具。
// 本目录全部模块从这里取依赖，cloud.init 只执行一次（require 缓存单例）。
const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GLOBAL_ROLES = ['super_admin', 'purchaser']
const MANAGEMENT_ROLES = ['super_admin', 'purchaser']
// S9 凭证提交：店长是线下持凭证的人，可提交；核销裁决仍限管理员/采购员
const VOUCHER_SUBMIT_ROLES = ['super_admin', 'purchaser', 'store_manager']

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

// fileID（cloud://{env}.{bucket}/{cloudPath}）→ cloudPath；非法格式返回空串。
// 200cb63 引入的凭证归属校验曾直接对完整 fileID 做 startsWith，导致带凭证提交必然被拒。
function cloudPathOfFileId(fileId) {
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(typeof fileId === 'string' ? fileId : '')
  return match ? match[1] : ''
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

async function requireUser(event, roles) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { error: { code: -401, msg: '登录已过期，请重新登录' } }
  if (roles && !roles.includes(user.role)) {
    return { error: { code: -403, msg: '当前账号无权执行该操作' } }
  }
  return { user }
}

module.exports = {
  crypto, cloud, db, _,
  GLOBAL_ROLES, MANAGEMENT_ROLES, VOUCHER_SUBMIT_ROLES,
  hashToken, cloudPathOfFileId, getSessionUser, requireUser
}
