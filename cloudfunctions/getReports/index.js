// 云函数 getReports - 按角色查询报表列表
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { role, storeId, reportScope, reportType, relatedDate } = event || {}
    const _ = db.command
    let query = {}
    if (reportScope && !['store', 'supplier'].includes(reportScope)) return { code: -1, msg: '报表范围无效' }
    if (relatedDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(relatedDate))) return { code: -1, msg: '日期格式无效' }

    // 按角色过滤
    if (user.role === 'chef') {
      // 厨师/下单人员：只看门店下单报表
      query.report_scope = 'store'
      query.report_type = 'store_order_report'
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      query.scope_id = user.default_store_id
    } else if (user.role === 'store_manager') {
      // 店长：看门店所有报表
      query.report_scope = 'store'
      if (!user.default_store_id) return { code: -403, msg: '账号未关联有效门店' }
      query.scope_id = user.default_store_id
    } else if (user.role === 'purchaser' || user.role === 'super_admin') {
      // 管理员：看全部
      if (reportScope) query.report_scope = reportScope
    } else {
      return { code: -403, msg: '当前账号无权查看报表' }
    }

    const allowedReportTypes = [
      'store_order_report', 'store_receipt_report', 'store_receipt_price_report',
      'supplier_order_report', 'supplier_receipt_report', 'supplier_receipt_price_report'
    ]
    if (reportType) {
      if (!allowedReportTypes.includes(reportType)) return { code: -1, msg: '报表类型无效' }
      query.report_type = reportType
    }
    if (relatedDate) query.related_date = relatedDate
    // Client filters can narrow results but cannot expand role scope.
    if (user.role === 'chef') {
      query.report_scope = 'store'
      query.report_type = 'store_order_report'
      query.scope_id = user.default_store_id
    } else if (user.role === 'store_manager') {
      query.report_scope = 'store'
      query.scope_id = user.default_store_id
    }

    const res = await db.collection('report_file')
      .where(query)
      .orderBy('generated_at', 'desc')
      .limit(50)
      .get()

    return { code: 0, data: res.data }
  } catch (err) {
    console.error('[getReports] 报表查询失败:', err)
    return { code: -1, msg: '报表数据加载失败，请稍后重试' }
  }
}
