// 云函数 getReports - 按登录角色查询报表列表（不信任客户端传参）
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

    // 客户端传的 role 一律忽略；storeId 仅对全局角色作为查询过滤条件
    const { storeId, reportScope, reportType, relatedDate } = event || {}
    let query = {}
    if (reportScope && !['store', 'supplier'].includes(reportScope)) return { code: -1, msg: '报表范围无效' }
    if (relatedDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(relatedDate))) return { code: -1, msg: '日期格式无效' }

    if (!auth.GLOBAL_ROLES.includes(user.role)) {
      if (!['chef', 'store_manager'].includes(user.role)) return { code: -403, msg: '当前账号无权查看报表' }
      // 门店角色：强制只看本店报表（厨师仅看门店下单报表）
      if (!user.default_store_id) return { code: 0, data: [] }
      query.report_scope = 'store'
      if (user.role === 'chef') query.report_type = 'store_order_report'
      query.scope_id = user.default_store_id
    } else {
      // 全局角色：看全部，可按报表维度过滤
      if (reportScope) query.report_scope = reportScope
      // 客户端门店过滤仅在明确查看门店维度报表时生效，避免误伤供应商维度报表
      if (storeId && reportScope === 'store') query.scope_id = storeId
    }

    const allowedReportTypes = [
      'store_order_report', 'store_receipt_report', 'store_receipt_price_report',
      'supplier_order_report', 'supplier_receipt_report', 'supplier_receipt_price_report',
      'store_daily_summary_report', 'store_monthly_summary_report'
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

    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)))
    const countRes = await db.collection('report_file').where(query).count()
    const res = await db.collection('report_file')
      .where(query)
      .orderBy('generated_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    return { code: 0, data: res.data, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getReports] 报表查询失败:', err)
    return { code: -1, msg: '报表数据加载失败，请稍后重试' }
  }
}
