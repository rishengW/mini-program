/**
 * 云函数共享鉴权模块（唯一源文件）。
 * 由 scripts/sync-shared.js 复制到各云函数目录（cloudfunctions/<fn>/auth.js），
 * 修改本文件后需重新执行：node scripts/sync-shared.js
 */
const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GLOBAL_ROLES = ['super_admin', 'purchaser']
const STORE_ROLES = ['chef', 'store_manager']

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const result = await db.collection('app_user')
    .where({ session_token_hash: hashToken(authToken), status: 1 })
    .limit(1)
    .get()
  const user = result.data[0]
  if (!user || !user.session_expires_at) return null
  const expiresAt = new Date(user.session_expires_at).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  return user
}

/**
 * 统一鉴权入口。
 * @param {object} event 云函数 event，需包含 authToken
 * @param {string[]} [roles] 允许的角色列表，缺省仅要求登录
 * @returns {Promise<{user: object}|{error: {code: number, msg: string}}>}
 */
async function requireUser(event, roles) {
  const user = await getSessionUser(event && event.authToken)
  if (!user) return { error: { code: -401, msg: '登录已过期，请重新登录' } }
  if (Array.isArray(roles) && roles.length > 0 && !roles.includes(user.role)) {
    return { error: { code: -403, msg: '当前账号无权执行该操作' } }
  }
  return { user }
}

/**
 * 按角色推导采购单查询条件。客户端传入的 role/storeId/createdBy 一律不作为权限依据。
 * - chef：本店 + 本人创建（历史数据 created_by 可能存 user_id / _id / 姓名，三者兼容）
 * - store_manager：本店全部
 * - purchaser / super_admin：不限
 * 返回 { _no_access: true } 表示该角色缺少门店关联，调用方应返回空列表。
 */
function buildOrderScope(user) {
  if (user.role === 'chef') {
    if (!user.default_store_id) return { _no_access: true }
    const creators = [user.user_id, user._id, user.name].filter(Boolean)
    return {
      store_id: user.default_store_id,
      created_by: creators.length > 1 ? _.in(creators) : creators[0]
    }
  }
  if (user.role === 'store_manager') {
    if (!user.default_store_id) return { _no_access: true }
    return { store_id: user.default_store_id }
  }
  return {}
}

/**
 * 按角色推导门店维度数据（收货单、门店报表等）的查询条件。
 * 返回 { _no_access: true } 表示该角色缺少门店关联，调用方应返回空列表。
 */
function buildStoreScope(user) {
  if (STORE_ROLES.includes(user.role)) {
    if (!user.default_store_id) return { _no_access: true }
    return { store_id: user.default_store_id }
  }
  return {}
}

module.exports = {
  GLOBAL_ROLES,
  STORE_ROLES,
  getSessionUser,
  requireUser,
  buildOrderScope,
  buildStoreScope
}
