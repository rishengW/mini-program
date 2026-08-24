// pages/report-list/report-list.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    activeType: 'all',
    filterDate: '',
    typeTabs: [],
    reports: []
  },

  onShow() {
    this.initTabs()
    this.loadReports()
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

  async loadReports() {
    const app = getApp()
    const role = app.globalData.userInfo?.role || 'purchaser'
    const storeId = app.globalData.currentStore?.storeId
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')

    const result = await cloud.callFunction('getReports', {
      authToken,
      role,
      storeId,
      reportType: this.data.activeType === 'all' ? '' : this.data.activeType,
      relatedDate: this.data.filterDate || ''
    })

    if (result.code === 0) {
      const list = result.data || []
      // 附加类型信息
      const reports = list.map(r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType || r.report_type)
        return {
          ...r,
          reportType: r.reportType || r.report_type,
          reportId: r.reportId || r.report_id,
          reportScope: r.reportScope || r.report_scope,
          scopeName: r.scopeName || r.scope_name || '',
          relatedDate: r.relatedDate || r.related_date,
          generatedAt: r.generatedAt || r.generated_at || '',
          fileVersion: r.fileVersion || r.file_version || 1,
          typeLabel: typeInfo.label,
          typeIcon: typeInfo.icon,
          typeColor: typeInfo.color
        }
      })
      this.setData({ reports })
    } else {
      util.showToast(result.msg || '报表加载失败')
    }
  },

  switchType(e) {
    this.setData({ activeType: e.currentTarget.dataset.value })
    this.loadReports()
  },

  onDateFilter(e) {
    this.setData({ filterDate: e.detail.value })
    this.loadReports()
  },

  clearDateFilter() {
    this.setData({ filterDate: '' })
    this.loadReports()
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
