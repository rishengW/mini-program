// 云函数 getProducts - 查询商品列表
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// （hashToken 本地副本已删除——见下方 shared/session require）

// 会话校验收敛到跨函数共享模块（2026-11-05 解耦第 3 项；源头 scripts/cloud-shared/session.js，
// 由 scripts/sync-shared.js 同步副本，勿再恢复本地副本——F1 就是 19 份副本各自漂移的教训）
const { hashToken, getSessionUser } = require('./shared/session')

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { categoryL1, categoryId, keyword, includeInactive } = event
    const isManager = ['super_admin', 'purchaser'].includes(user.role)
    if (includeInactive && !isManager) return { code: -403, msg: '当前账号无权查看停用商品' }
    const where = {}
    if (!includeInactive || !isManager) where.status = 1
    if (categoryL1) where.category_level_1 = categoryL1
    if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
      where.category_level_2_id = Number(categoryId)
    }
    // 关键词下推到数据库（与 getSuppliers 同款 db.RegExp）：原先 limit(200) 截断后才内存过滤，
    // 商品超 200 种时排在截断线后的商品永远搜不到。正则元字符转义，防止 ( [ 等输入炸查询
    if (keyword) {
      const escaped = String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (escaped) where.product_name = db.RegExp({ regexp: escaped, options: 'i' })
    }

    const res = await db.collection('product').where(where).orderBy('product_name', 'asc').limit(200).get()
    const list = res.data

    return { code: 0, data: list }
  } catch (err) {
    console.error('[getProducts] 商品查询失败:', err)
    return { code: -1, msg: '商品数据加载失败，请稍后重试' }
  }
}
