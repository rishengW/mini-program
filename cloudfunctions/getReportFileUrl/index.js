// 云函数 getReportFileUrl - 获取报表文件临时下载链接（校验报表归属权限）
const cloud = require('wx-server-sdk')
const auth = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  try {
    const check = await auth.requireUser(event)
    if (check.error) return check.error
    const user = check.user

    const { fileId } = event || {}
    if (!fileId) return { code: -1, msg: '缺少fileId' }

    // report_file 的 file_url 字段存储云文件 fileID，先校验该文件归属的报表是否可见
    const fileRes = await db.collection('report_file')
      .where({ file_url: fileId })
      .limit(1)
      .get()

    const report = fileRes.data[0]
    if (!report) return { code: -403, msg: '无权获取该报表文件' }

    // 门店角色只能获取本店报表的文件
    if (!auth.GLOBAL_ROLES.includes(user.role)) {
      if (report.report_scope !== 'store' || report.scope_id !== user.default_store_id) {
        return { code: -403, msg: '无权获取该报表文件' }
      }
    }

    const res = await cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList.length > 0 && res.fileList[0].tempFileURL) {
      return { code: 0, data: { url: res.fileList[0].tempFileURL } }
    }
    return { code: -1, msg: '获取链接失败' }
  } catch (err) {
    console.error('[getReportFileUrl] 文件链接获取失败:', err)
    return { code: -1, msg: '报表文件链接获取失败，请稍后重试' }
  }
}
