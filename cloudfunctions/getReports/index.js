// 云函数 getReports - 按角色查询报表列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const { role, storeId, reportScope, reportType, relatedDate } = event || {}
    const _ = db.command
    let query = {}

    // 按角色过滤
    if (role === 'chef') {
      // 厨师/下单人员：只看门店下单报表
      query.report_scope = 'store'
      query.report_type = 'store_order_report'
      if (storeId) query.scope_id = storeId
    } else if (role === 'store_manager') {
      // 店长：看门店所有报表
      query.report_scope = 'store'
      if (storeId) query.scope_id = storeId
    } else if (role === 'purchaser' || role === 'admin') {
      // 管理员：看全部
      if (reportScope) query.report_scope = reportScope
    }

    if (reportType) query.report_type = reportType
    if (relatedDate) query.related_date = relatedDate

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
