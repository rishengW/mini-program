// pages/report-history/report-history.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const PAGE_SIZE = 20

Page({
  data: {
    reports: [],
    filterScope: 'all',
    filterType: '',
    filterTypeLabel: '全部类型',
    filterDate: '',
    reportTypeOptions: [],
    page: 1,
    hasMore: true,
    isLoadingMore: false,
    scopeOptions: [
      { value: 'all', label: '全部' },
      { value: 'store', label: '门店报表' },
      { value: 'supplier', label: '供应商报表' }
    ]
  },

  onShow() {
    const reportTypeOptions = [
        { value: '', label: '全部类型' },
        ...Object.keys(meta.reportTypeMap).map(k => ({
          value: k, label: meta.reportTypeMap[k].label
        }))
      ]
    const selectedType = reportTypeOptions.find(item => item.value === this.data.filterType)
    this.setData({ reportTypeOptions, filterTypeLabel: selectedType ? selectedType.label : '全部类型' })
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.isLoadingMore || !this.data.hasMore) return
    this.loadReports(this.data.page + 1, true)
  },

  reload() {
    this.setData({ page: 1, hasMore: true })
    return this.loadReports(1, false)
  },

  async loadReports(page = 1, append = false) {
    const app = getApp()
    const role = app.globalData.userInfo ? app.globalData.userInfo.role : 'purchaser'
    const storeId = app.globalData.currentStore ? app.globalData.currentStore.storeId : ''
    if (append) this.setData({ isLoadingMore: true })

    const result = await cloud.callFunction('getReports', {
      role: role || 'purchaser',
      storeId: storeId || '',
      reportScope: this.data.filterScope !== 'all' ? this.data.filterScope : '',
      reportType: this.data.filterType,
      relatedDate: this.data.filterDate,
      page,
      pageSize: PAGE_SIZE
    })

    if (result.code === 0) {
      const newReports = (result.data || []).map(r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType || r.report_type)
        return {
          ...cloud.normalizeReport(r),
          typeLabel: typeInfo.label,
          typeIcon: typeInfo.icon,
          typeColor: typeInfo.color
        }
      })
      const reports = append ? this.data.reports.concat(newReports) : newReports
      const total = Number(result.total) || 0
      this.setData({ reports, page, hasMore: reports.length < total, isLoadingMore: false })
    } else {
      this.setData({ isLoadingMore: false })
      util.showToast(result.msg || '报表加载失败')
    }
  },

  onScopeChange(e) {
    const scope = this.data.scopeOptions[e.detail.value].value
    this.setData({ filterScope: scope })
    this.reload()
  },

  onTypeChange(e) {
    const selected = this.data.reportTypeOptions[e.detail.value]
    this.setData({ filterType: selected.value, filterTypeLabel: selected.label })
    this.reload()
  },

  onDateChange(e) {
    this.setData({ filterDate: e.detail.value })
    this.reload()
  },

  clearDate() {
    this.setData({ filterDate: '' })
    this.reload()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/report-detail/report-detail?id=' + id })
  }
})
