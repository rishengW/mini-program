// pages/report-list/report-list.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const PAGE_SIZE = 20

Page({
  data: {
    activeType: 'all',
    filterDate: '',
    typeTabs: [],
    reports: [],
    page: 1,
    hasMore: true,
    isLoadingMore: false
  },

  onShow() {
    this.initTabs()
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

  initTabs() {
    const app = getApp()
    const role = app.globalData.userInfo?.role || 'purchaser'
    let tabs = [{ value: 'all', label: '全部', icon: '📊' }]

    if (role === 'chef') {
      tabs.push({ value: 'store_order_report', label: '下单报表', icon: '📋' })
    } else if (role === 'store_manager') {
      tabs.push(
        { value: 'store_order_report', label: '下单报表', icon: '📋' },
        { value: 'store_receipt_report', label: '收货报表', icon: '📦' },
        { value: 'store_receipt_price_report', label: '带价格收货', icon: '💰' }
      )
    } else {
      // 管理员看全部
      tabs.push(
        { value: 'store_order_report', label: '下单报表', icon: '📋' },
        { value: 'store_receipt_report', label: '收货报表', icon: '📦' },
        { value: 'store_receipt_price_report', label: '带价格收货', icon: '💰' },
        { value: 'supplier_order_report', label: '供应商订货', icon: '🏭' },
        { value: 'supplier_receipt_report', label: '供应商到货', icon: '🚛' },
        { value: 'supplier_receipt_price_report', label: '供应商账单', icon: '📊' }
      )
    }
    this.setData({ typeTabs: tabs })
  },

  async loadReports(page = 1, append = false) {
    const app = getApp()
    const role = app.globalData.userInfo?.role || 'purchaser'
    const storeId = app.globalData.currentStore?.storeId
    if (append) this.setData({ isLoadingMore: true })

    const result = await cloud.callFunction('getReports', {
      role,
      storeId,
      reportType: this.data.activeType === 'all' ? '' : this.data.activeType,
      relatedDate: this.data.filterDate || '',
      page,
      pageSize: PAGE_SIZE
    })

    if (result.code === 0) {
      const newReports = (result.data || []).map(r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType || r.report_type)
        const abnormalSummary = r.abnormalSummary || r.abnormal_summary || ''
        return {
          ...cloud.normalizeReport(r),
          hasAbnormal: r.hasAbnormal !== undefined ? !!r.hasAbnormal : !!r.has_abnormal,
          abnormalSummary,
          abnormalLabel: `收货异常${abnormalSummary ? ` · ${abnormalSummary}` : ''}`,
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

  switchType(e) {
    this.setData({ activeType: e.currentTarget.dataset.value })
    this.reload()
  },

  onDateFilter(e) {
    this.setData({ filterDate: e.detail.value })
    this.reload()
  },

  clearDateFilter() {
    this.setData({ filterDate: '' })
    this.reload()
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/report-history/report-history' })
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/report-detail/report-detail?id=' + e.currentTarget.dataset.id
    })
  }
})
