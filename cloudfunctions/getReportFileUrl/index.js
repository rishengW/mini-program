// 云函数 getReportFileUrl - 获取报表文件临时下载链接
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
    const { reportId, fileId } = event || {}
    if (!reportId && !fileId) return { code: -1, msg: '缺少报表标识' }

    // 报表元数据已不向客户端暴露 file_url，新链路按 reportId 定位报表；
    // fileId 入参仅兼容旧版本客户端，鉴权口径与 reportId 路径一致
    const reportRes = reportId
      ? await db.collection('report_file').where({ report_id: reportId }).limit(1).get()
      : await db.collection('report_file').where({ file_url: fileId }).limit(1).get()
    if (!reportRes.data.length || !reportRes.data[0].file_url) return { code: -1, msg: '报表文件不存在' }
    const report = reportRes.data[0]
    // 已替代版本不再提供下载：旧版金额可能已被补充账单修正，继续下载会造成重复对账
    if (report.status === 'superseded') {
      return { code: -1, msg: '该报表已被新版本替代，请在报表列表查看最新版本' }
    }
    if (!['super_admin', 'purchaser'].includes(user.role)) {
      if (!['chef', 'store_manager'].includes(user.role) || report.report_scope !== 'store' || report.scope_id !== user.default_store_id) {
        return { code: -403, msg: '无权下载该报表文件' }
      }
      if (user.role === 'chef' && report.report_type !== 'store_order_report') return { code: -403, msg: '当前账号无权下载该报表文件' }
    }
    const res = await cloud.getTempFileURL({ fileList: [report.file_url] })
    if (res.fileList && res.fileList.length > 0 && res.fileList[0].tempFileURL) {
      return { code: 0, data: { url: res.fileList[0].tempFileURL } }
    }
    return { code: -1, msg: '获取链接失败' }
  } catch (err) {
    console.error('[getReportFileUrl] 文件链接获取失败:', err)
    return { code: -1, msg: '报表文件链接获取失败，请稍后重试' }
  }
}
