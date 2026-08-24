// pages/report-detail/report-detail.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    report: {},
    rows: [],
    totalAmount: '0.00',
    typeLabel: '',
    typeIcon: '',
    typeColor: '',
    scopeLabel: ''
  },

  async onLoad(options) {
    const reportId = options.id
    const app = getApp()
    util.showLoading('加载报表...')

    const result = await cloud.callFunction('getReportDetail', {
      reportId,
      authToken: app.globalData.authToken || wx.getStorageSync('authToken')
    })
    util.hideLoading()

    if (result.code === 0 && result.data) {
      const report = result.data
      const typeInfo = meta.getReportTypeInfo(report.reportType || report.report_type)
      const rpt = {
        ...report,
        reportType: report.reportType || report.report_type,
        scopeName: report.scopeName || report.scope_name || '',
        relatedDate: report.relatedDate || report.related_date,
        generatedAt: report.generatedAt || report.generated_at || '',
        fileVersion: report.fileVersion || report.file_version || 1,
        reportScope: report.reportScope || report.report_scope
      }

      let totalAmount = '0.00'
      const rows = report.rows || []
      if (rpt.reportType.includes('price')) {
        const sum = rows.reduce((s, r) => s + (r.subtotal || 0), 0)
        totalAmount = sum.toFixed(2)
      }

      this.setData({
        report: rpt,
        rows,
        totalAmount,
        typeLabel: typeInfo.label,
        typeIcon: typeInfo.icon,
        typeColor: typeInfo.color,
        scopeLabel: rpt.reportScope === 'store' ? '门店' : '供应商'
      })
    } else {
      util.showToast('加载失败')
    }
  },

  async exportReport() {
    const { report } = this.data
    if (report.fileUrl || report.file_url) {
      // 有云存储文件，通过云函数获取临时链接后下载
      const fileResult = await cloud.callFunction('getReportFileUrl', {
        fileId: report.fileUrl || report.file_url,
        authToken: getApp().globalData.authToken || wx.getStorageSync('authToken')
      })
      const fileUrl = fileResult && fileResult.code === 0 && fileResult.data
        ? fileResult.data.url
        : null
      if (fileUrl) {
        wx.downloadFile({
          url: fileUrl,
          success(res) {
            wx.openDocument({
              filePath: res.tempFilePath,
              showMenu: true,
              success() { util.showSuccess('文件已打开') },
              fail() { util.showToast('打开失败') }
            })
          },
          fail() { util.showToast('下载失败') }
        })
      } else {
        util.showToast('文件链接获取失败')
      }
    } else {
      util.showToast('该报表尚未生成可下载文件')
    }
  }
})
