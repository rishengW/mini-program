// pages/report-history/report-history.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    reports: [],
    filteredReports: [],
    filterScope: 'all',
    filterType: '',
    filterTypeLabel: '全部类型',
    filterDate: '',
    reportTypeOptions: [],
    scopeOptions: [
      { value: 'all', label: '全部' },
      { value: 'store', label: '门店报表' },
      { value: 'supplier', label: '供应商报表' }
    ]
  },

  onShow() {
    const app = getApp()
    const role = app.globalData.userInfo ? app.globalData.userInfo.role : 'purchaser'
    const storeId = app.globalData.currentStore ? app.globalData.currentStore.storeId : ''

    const reportTypeOptions = [
        { value: '', label: '全部类型' },
        ...Object.keys(meta.reportTypeMap).map(k => ({
          value: k, label: meta.reportTypeMap[k].label
        }))
      ]
    const selectedType = reportTypeOptions.find(item => item.value === this.data.filterType)
    this.setData({ reportTypeOptions, filterTypeLabel: selectedType ? selectedType.label : '全部类型' })

    this.loadReports(role, storeId)
  },

  async loadReports(role, storeId) {
    const app = getApp()
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')
    const result = await cloud.callFunction('getReports', {
      authToken,
      role: role || 'purchaser',
      storeId: storeId || '',
      reportScope: this.data.filterScope !== 'all' ? this.data.filterScope : '',
      reportType: this.data.filterType,
      relatedDate: this.data.filterDate
    })

    if (result.code === 0) {
      const reports = (result.data || []).map(r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType || r.report_type)
        return {
          ...r,
          reportType: r.reportType || r.report_type,
          scopeName: r.scopeName || r.scope_name || '',
          relatedDate: r.relatedDate || r.related_date,
          generatedAt: r.generatedAt || r.generated_at || '',
          fileVersion: r.fileVersion || r.file_version || 1,
          typeLabel: typeInfo.label,
          typeIcon: typeInfo.icon,
          typeColor: typeInfo.color
        }
      })
      // 按日期倒序
      reports.sort((a, b) => b.relatedDate.localeCompare(a.relatedDate))
      this.setData({ reports, filteredReports: reports })
    } else {
      util.showToast(result.msg || '报表加载失败')
    }
  },

  onScopeChange(e) {
    const scope = this.data.scopeOptions[e.detail.value].value
    this.setData({ filterScope: scope })
    this.onShow()
  },

  onTypeChange(e) {
    const selected = this.data.reportTypeOptions[e.detail.value]
    this.setData({ filterType: selected.value, filterTypeLabel: selected.label })
    this.onShow()
  },

  onDateChange(e) {
    this.setData({ filterDate: e.detail.value })
    this.onShow()
  },

  clearDate() {
    this.setData({ filterDate: '' })
    this.onShow()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/report-detail/report-detail?id=' + id })
  }
})
