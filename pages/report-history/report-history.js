// pages/report-history/report-history.js
const meta = require('../../utils/meta')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')
const { listLifecycle, listFetch, withStatus } = require('../../utils/list-page')

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
    if (!authGuard.requireLogin()) return
    // 2026-11-10 拍板：chef 无报表入口
    if ((getApp().globalData.userInfo || {}).role === 'chef') {
      util.showToast('当前账号无权查看报表')
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const role = (getApp().globalData.userInfo || {}).role
    const isGlobal = ['super_admin', 'purchaser'].includes(role)
    // P2-34：筛选项按角色裁剪——非全局角色服务端会强制 report_scope='store'，
    // 若仍提供"供应商报表"选项会造成标签与内容不一致
    const scopeOptions = isGlobal
      ? [
          { value: 'all', label: '全部' },
          { value: 'store', label: '门店报表' },
          { value: 'supplier', label: '供应商报表' }
        ]
      : [{ value: 'store', label: '门店报表' }]
    const reportTypeOptions = [
        { value: '', label: '全部类型' },
        ...Object.keys(meta.reportTypeMap)
          .filter(k => isGlobal || k.indexOf('store_') === 0)
          .map(k => ({
            value: k, label: meta.reportTypeMap[k].label
          }))
      ]
    const selectedType = reportTypeOptions.find(item => item.value === this.data.filterType)
    const patch = {
      scopeOptions,
      reportTypeOptions,
      filterTypeLabel: selectedType ? selectedType.label : '全部类型'
    }
    if (!isGlobal) {
      patch.filterScope = 'store'
      if (this.data.filterType && this.data.filterType.indexOf('store_') !== 0) {
        patch.filterType = ''
        patch.filterTypeLabel = '全部类型'
      }
    }
    this.setData(patch)
    // P2-33：仅首次进入加载；从详情页返回时保留翻页位置，不再无条件复位到第 1 页
    if (this.data.reports.length === 0) this.reload()
  },

  ...listLifecycle('reports'),

  // 分页骨架统一走 listFetch（L17/L27）；装饰收敛用 withStatus（L18）
  async fetchPage(page = 1, append = false) {
    const app = getApp()
    const role = app.globalData.userInfo ? app.globalData.userInfo.role : 'purchaser'
    const storeId = app.globalData.currentStore ? app.globalData.currentStore.storeId : ''
    await listFetch(page, this, append, {
      fetch: () => cloud.callFunction('getReports', {
        role: role || 'purchaser',
        storeId: storeId || '',
        reportScope: this.data.filterScope !== 'all' ? this.data.filterScope : '',
        reportType: this.data.filterType,
        relatedDate: this.data.filterDate,
        page,
        pageSize: PAGE_SIZE
      }),
      decorate: r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType || r.report_type)
        const nr = withStatus(cloud.normalizeReport(r), 'status')
        return {
          ...nr,
          typeLabel: typeInfo.label,
          typeIconClass: typeInfo.iconClass,
          typeColor: typeInfo.color
        }
      },
      listKey: 'reports',
      failMsg: '报表加载失败'
    })
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
