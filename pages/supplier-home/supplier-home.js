// pages/supplier-home/supplier-home.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const meta = require('../../utils/meta')
const authGuard = require('../../utils/auth-guard')

// 微信订阅消息模板 ID：小程序后台申请通过后填入；为空时不拉起授权弹窗
const NEW_ORDER_TEMPLATE_ID = ''

Page({
  data: {
    supplierName: '',
    contactName: '',
    contactPhone: '',
    userName: '',
    unreadCount: 0,
    latestMessage: null,
    // L23：文案收敛到 meta.supplierConfirmMap 单源
    stats: ['pending', 'confirmed', 'shipped'].map(key => ({
      key,
      label: meta.getSupplierConfirmInfo(key).text,
      iconClass: { pending: 'icon-clock-warning', confirmed: 'icon-check-success', shipped: 'icon-truck-primary' }[key],
      value: 0
    }))
  },

  onShow() {
    if (!authGuard.requireLogin()) return
    // 隐藏微信原生"返回首页"按钮：跳到登录页后仍需重新输账号密码，容易误导
    if (wx.hideHomeButton) wx.hideHomeButton()
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
    this.loadNotice()
    this.requestNewOrderSubscribe()
  },

  // 首页通知条：拉取站内消息（新订单下推通知等），显示未读数与最新一条
  async loadNotice() {
    const res = await cloud.callFunction('dataService', { action: 'getMessages' })
    if (!res || res.code !== 0) return
    const messages = res.data || []
    const unreadCount = messages.filter(m => !m.read).length
    const latest = messages[0] || null
    this.setData({
      unreadCount,
      latestMessage: latest ? { title: latest.title, content: latest.content } : null
    })
  },

  goMessages() {
    // 供应商专用消息页（非 tabBar），可正常 navigateTo
    wx.navigateTo({ url: '/pages/supplier-messages/supplier-messages' })
  },

  // L21：与 goMessages 同目标，保留入口兼容（通知条 bindtap 的是这个名字），实现收敛一处
  goMessageCenter() {
    this.goMessages()
  },

  // 新订单微信服务通知：一次性订阅（授权一次可推一条），进门户时静默拉起；
  // 模板 ID 未配置或用户拒绝都不影响页面功能
  requestNewOrderSubscribe() {
    if (!NEW_ORDER_TEMPLATE_ID || !wx.requestSubscribeMessage) return
    wx.requestSubscribeMessage({
      tmplIds: [NEW_ORDER_TEMPLATE_ID],
      complete: () => {} // 拒绝/成功均静默，不打扰操作
    })
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
    // P2-67：登出清理统一走 app.clearSession()，键位新增不再漏清
    app.clearSession()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
