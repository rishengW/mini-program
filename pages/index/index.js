// pages/index/index.js
// 重写：状态卡片可点击跳转 + 删除快捷操作
const cloud = require('../../utils/cloud')
const meta = require('../../utils/meta')
const util = require('../../utils/util')

Page({
  data: {
    storeName: '',
    userName: '',
    roleLabel: '',
    stats: [],
    recentOrders: [],
    recentReports: [],
    isSuperAdmin: false,
    isManager: false
  },

  async onShow() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const user = app.globalData.userInfo
    const store = app.globalData.currentStore || {}
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')

    // 一次请求取回首页全部数据（统计 + 最近采购单 + 最近报表）
    const result = await cloud.callFunction('dataService', { action: 'getHomeStats', authToken })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '首页数据加载失败，请稍后重试')
      return
    }

    const statsData = result.data || {}
    // 统计（全部可点击）
    const stats = [
      { label: '待处理', value: statsData.pendingApproval || 0, icon: '📋', color: '#FAAD14', status: 'submitted' },
      { label: '待收货', value: statsData.pendingReceive || 0, icon: '📦', color: '#1890FF', status: 'to_receive' },
      { label: '已完成', value: statsData.completed || 0, icon: '✅', color: '#52C41A', status: 'received' },
      { label: '需关注', value: statsData.attention || 0, icon: '⚠️', color: '#FF4D4F', status: 'abnormal' }
    ]

    // 最近采购单
    const recentOrders = (statsData.recentOrders || []).map(o => {
      const normalized = cloud.normalizePurchaseOrder(o)
      const statusInfo = meta.getStatusInfo(normalized.orderStatus)
      return {
        ...normalized,
        statusText: statusInfo.text,
        statusType: statusInfo.type,
        itemCount: normalized.items.length,
        manualCount: normalized.items.filter(i => i.isManual).length
      }
    })

    // 最近报表
    const recentReports = (statsData.recentReports || []).map(r => {
      const normalized = cloud.normalizeReport(r)
      const typeInfo = meta.getReportTypeInfo(normalized.reportType)
      return { ...normalized, typeLabel: typeInfo.label, typeIcon: typeInfo.icon, typeColor: typeInfo.color }
    })

    this.setData({
      storeName: store.storeName || store.name || '未选择门店',
      userName: user.name,
      roleLabel: user.roleLabel || user.role,
      isSuperAdmin: user.role === 'super_admin',
      isManager: ['super_admin', 'purchaser'].includes(user.role),
      stats, recentOrders, recentReports
    })
  },

  goStore() { wx.navigateTo({ url: '/pages/store-switch/store-switch' }) },

  goAccount() { wx.navigateTo({ url: '/pages/account/account' }) },

  async switchAccount() {
    const app = getApp()
    await cloud.callFunction('authService', {
      action: 'logout',
    })
    app.globalData.isLoggedIn = false
    app.globalData.userInfo = null
    app.globalData.currentStore = null
    app.globalData.authToken = ''
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('currentStore')
    wx.removeStorageSync('authToken')
    wx.removeStorageSync('sessionExpiresAt')
    wx.removeStorageSync('account_history')
    wx.reLaunch({ url: '/pages/login/login' })
  },

  // 状态卡片点击
  goStatPage(e) {
    const status = e.currentTarget.dataset.status
    if (status === 'message') {
      // "需关注"显示的是未读消息数，跳消息页（tabBar 页面需用 switchTab）
      wx.switchTab({ url: '/pages/message/message' })
    } else if (status === 'abnormal') {
      wx.navigateTo({ url: '/pages/abnormal-list/abnormal-list' })
    } else {
      // purchase-list 是 tabBar 页面，switchTab 无法带参，通过 globalData 传递筛选状态
      getApp().globalData.pendingPurchaseStatus = status
      wx.switchTab({ url: '/pages/purchase-list/purchase-list' })
    }
  },

  goOrderDetail(e) {
    wx.navigateTo({ url: '/pages/purchase-detail/purchase-detail?id=' + e.currentTarget.dataset.id })
  },

  goReportDetail(e) {
    wx.navigateTo({ url: '/pages/report-detail/report-detail?id=' + e.currentTarget.dataset.id })
  },

  goAction(e) {
    const { url, taburl } = e.currentTarget.dataset
    if (taburl) { wx.switchTab({ url: taburl }) }
    else if (url) { wx.navigateTo({ url }) }
  }
})
