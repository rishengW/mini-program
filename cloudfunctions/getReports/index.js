// 云函数 getReports - 按角色查询报表列表
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

    // 被新版本替代的报表（superseded）不进列表：补结算/补价/重出汇总后，
    // 新旧两版同时可见会被重复对账。neq 对无 status 字段的历史记录同样命中，不影响旧数据。
    query.status = _.neq('superseded')

    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)))
    const countRes = await db.collection('report_file').where(query).count()
    const res = await db.collection('report_file')
      .where(query)
      .orderBy('generated_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    // 不下发 file_url：下载一律走 getReportFileUrl 按 reportId 鉴权后取临时链接，
    // 防止客户端从列表拿到 fileID 后绕过鉴权直调 wx.cloud.getTempFileURL
    const list = res.data.map(item => {
      const { file_url, ...rest } = item
      return { ...rest, has_file: !!file_url }
    })
    return { code: 0, data: list, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getReports] 报表查询失败:', err)
    return { code: -1, msg: '报表数据加载失败，请稍后重试' }
  }
}
