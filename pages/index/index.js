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
    isManager: false,
    unreadMsg: 0
  },

  async onShow() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }

    const user = app.globalData.userInfo
    // 供货商有独立门户，误入门店首页时直接转走
    if (user && user.role === 'supplier') {
      wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
      return
    }
    const store = app.globalData.currentStore || {}

    const storeId = store.storeId || store.id || ''
    // 统计走服务端聚合计数；最近订单只取前 3 条，不再为统计拉全量订单
    const [ordersResult, reportsResult, messagesResult, statsResult] = await Promise.all([
      cloud.callFunction('getPurchaseOrders', {
        role: user.role,
        storeId,
        createdBy: user.role === 'chef' ? (user.userId || user.id || user.name) : '',
        pageSize: 3
      }),
      cloud.callFunction('getReports', {
        role: user.role,
        storeId,
        reportType: '',
        relatedDate: ''
      }),
      cloud.callFunction('dataService', { action: 'getMessages' }),
      cloud.callFunction('dataService', { action: 'getOrderStats', storeId })
    ])
    if (ordersResult.code !== 0 || reportsResult.code !== 0 || messagesResult.code !== 0 || statsResult.code !== 0) {
      util.showToast('首页数据加载失败，请稍后重试')
      return
    }

    const myOrders = (ordersResult.data || []).map(cloud.normalizePurchaseOrder)
    const myReports = (reportsResult.data || []).map(cloud.normalizeReport)
    const messages = messagesResult.data || []

    // 统计（全部可点击）：来自服务端聚合，不受分页截断影响
    const statsData = statsResult.data || {}
    const pendingOrders = statsData.submitted || 0
    const pendingReceive = statsData.receivable || 0
    const completedOrders = statsData.received || 0
    const unreadMsg = messages.filter(m => !m.read).length

    const stats = [
      { label: '待处理', value: pendingOrders, icon: '📋', color: '#FAAD14', status: 'submitted' },
      { label: '待收货', value: pendingReceive, icon: '📦', color: '#1890FF', status: 'submitted' },
      { label: '已完成', value: completedOrders, icon: '✅', color: '#52C41A', status: 'received' },
      { label: '需关注', value: unreadMsg, icon: '⚠️', color: '#FF4D4F', status: 'message' }
    ]

    // 最近采购单
    const recentOrders = myOrders.slice(0, 3).map(o => {
      const statusInfo = meta.getStatusInfo(o.orderStatus)
      return {
        ...o,
        statusText: statusInfo.text,
        statusType: statusInfo.type,
        itemCount: o.items.length,
        manualCount: o.items.filter(i => i.isManual).length
      }
    })

    // 最近报表
    const recentReports = myReports.slice(0, 3).map(r => {
      const typeInfo = meta.getReportTypeInfo(r.reportType)
      return { ...r, typeLabel: typeInfo.label, typeIcon: typeInfo.icon, typeColor: typeInfo.color }
    })

    this.setData({
      storeName: store.storeName || store.name || '未选择门店',
      userName: user.name,
      roleLabel: user.roleLabel || user.role,
      isSuperAdmin: user.role === 'super_admin',
      isManager: ['super_admin', 'purchaser'].includes(user.role),
      unreadMsg,
      stats, recentOrders, recentReports
    })
  },

  goStore() { wx.navigateTo({ url: '/pages/store-switch/store-switch' }) },

  // 顶部铃铛入口：进消息中心（tabBar 页面需用 switchTab）
  goMessages() {
    wx.switchTab({ url: '/pages/message/message' })
  },

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
      wx.navigateTo({ url: '/pages/purchase-list/purchase-list?status=' + status })
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
