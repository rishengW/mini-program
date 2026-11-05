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

// 会话校验收敛到跨函数共享模块（源头 scripts/cloud-shared/session.js，sync-shared.js 同步）；
// 此处 re-export，本目录各模块仍统一从 ./_shared 取依赖
const { hashToken, getSessionUser } = require('./shared/session')

// fileID（cloud://{env}.{bucket}/{cloudPath}）→ cloudPath；非法格式返回空串。
// 200cb63 引入的凭证归属校验曾直接对完整 fileID 做 startsWith，导致带凭证提交必然被拒。
function cloudPathOfFileId(fileId) {
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(typeof fileId === 'string' ? fileId : '')
  return match ? match[1] : ''
}

// （getSessionUser 本地副本已删除——见上方 require）

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
