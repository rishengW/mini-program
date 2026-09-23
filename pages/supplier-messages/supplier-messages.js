// pages/supplier-messages/supplier-messages.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    messages: [],
    unreadCount: 0
  },

  async onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    if (!app.globalData.isLoggedIn || user.role !== 'supplier') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    await this.loadMessages()
  },

  async loadMessages() {
    const result = await cloud.callFunction('dataService', { action: 'getMessages' })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '消息加载失败')
      return
    }
    const messages = (result.data || []).map(m => ({
      ...m,
      time: cloud.formatDateTime(m.time),
      timeAgo: util.getRelativeTime(cloud.formatDateTime(m.time))
    }))
    const unreadCount = messages.filter(m => !m.read).length
    this.setData({ messages, unreadCount })
  },

  async readMessage(e) {
    const id = e.currentTarget.dataset.id
    const idx = this.data.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    const message = this.data.messages[idx]
    if (!message.read) {
      const result = await cloud.callFunction('dataService', { action: 'markMessageRead', id })
      if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
      this.setData({
        [`messages[${idx}].read`]: true,
        unreadCount: Math.max(0, this.data.unreadCount - 1)
      })
    }
    // 订单类消息跳供货商订单列表
    if (message.bizId) {
      wx.navigateTo({ url: '/pages/supplier-orders/supplier-orders' })
      return
    }
    util.showToast('已读')
  },

  async markAllRead() {
    const result = await cloud.callFunction('dataService', { action: 'markAllMessagesRead' })
    if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
    const messages = this.data.messages.map(m => ({ ...m, read: true }))
    this.setData({ messages, unreadCount: 0 })
    util.showSuccess('全部已读')
  }
})
