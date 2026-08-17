// pages/abnormal-list/abnormal-list.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    activeFilter: 'all',
    filteredList: [],
    records: []
  },

  async onShow() {
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'getAbnormalRecords',
      authToken: app.globalData.authToken || wx.getStorageSync('authToken')
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '异常记录加载失败')
      return
    }
    const records = (result.data || []).map(item => ({
      ...item,
      createdAt: cloud.formatDateTime(item.createdAt)
    }))
    this.setData({ records })
    this.applyFilter()
  },

  switchFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.value })
    this.applyFilter()
  },

  applyFilter() {
    const { activeFilter } = this.data
    let list = this.data.records
    if (activeFilter !== 'all') {
      list = list.filter(r => r.status === activeFilter)
    }
    const statusColorMap = { pending: 'warning', processing: 'primary', resolved: 'success', closed: 'grey' }
    const filteredList = list.map(r => ({ ...r, statusColor: statusColorMap[r.status] || 'grey' }))
    this.setData({ filteredList })
  },

  async handleAbnormal(e) {
    const confirmed = await util.showConfirm('确认开始处理该异常？')
    if (!confirmed) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'startAbnormal',
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      id: e.currentTarget.dataset.id
    })
    if (result.code !== 0) return util.showToast(result.msg || '异常处理状态更新失败')
    util.showSuccess('已标记为处理中')
    await this.onShow()
  }
})
