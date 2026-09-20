// pages/supplier-home/supplier-home.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    supplierName: '',
    contactName: '',
    contactPhone: '',
    userName: '',
    stats: [
      { key: 'pending', label: '待确认', icon: '⏰', color: '#FAAD14', value: 0 },
      { key: 'confirmed', label: '已确认', icon: '✅', color: '#52C41A', value: 0 },
      { key: 'shipped', label: '已发货', icon: '🚚', color: '#1890FF', value: 0 }
    ]
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    const user = app.globalData.userInfo || {}
    // 非供货商角色误入时回到门店首页
    if (user.role !== 'supplier') {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    const supplier = app.globalData.supplierInfo || wx.getStorageSync('supplierInfo') || {}
    this.setData({
      supplierName: supplier.supplierName || '供货商',
      contactName: supplier.contactName || '',
      contactPhone: supplier.contactPhone || '',
      userName: user.name || ''
    })
    this.loadStats()
  },

  async loadStats() {
    // 只取 statusCounts，pageSize 压到最小减少传输
    const res = await cloud.callFunction('getSupplierOrders', { page: 1, pageSize: 1 })
    if (!res || res.code !== 0 || !res.statusCounts) return
    const counts = res.statusCounts
    const stats = this.data.stats.map(item => ({
      ...item,
      value: counts[item.key] || 0
    }))
    this.setData({ stats })
  },

  goStatPage(e) {
    const status = e.currentTarget.dataset.status
    wx.navigateTo({ url: '/pages/supplier-orders/supplier-orders?status=' + status })
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/supplier-orders/supplier-orders' })
  },

  goReceipts() {
    wx.navigateTo({ url: '/pages/supplier-receipts/supplier-receipts' })
  },

  goPrices() {
    wx.navigateTo({ url: '/pages/supplier-prices/supplier-prices' })
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },

  async switchAccount() {
    const confirmed = await util.showConfirm('退出当前供货商账号？')
    if (!confirmed) return
    const app = getApp()
    await cloud.callFunction('authService', { action: 'logout' })
    app.globalData.isLoggedIn = false
    app.globalData.userInfo = null
    app.globalData.currentStore = null
    app.globalData.supplierInfo = null
    app.globalData.authToken = ''
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('currentStore')
    wx.removeStorageSync('supplierInfo')
    wx.removeStorageSync('authToken')
    wx.removeStorageSync('sessionExpiresAt')
    wx.removeStorageSync('account_history')
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
