// pages/account/account.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    user: null,
    avatarText: '我',
    form: { currentPassword: '', newPassword: '', confirmPassword: '' },
    submitting: false
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.setData({
      user: app.globalData.userInfo,
      avatarText: (app.globalData.userInfo && app.globalData.userInfo.name || '我').slice(0, 1),
      form: { currentPassword: '', newPassword: '', confirmPassword: '' }
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  async submit() {
    const { currentPassword, newPassword, confirmPassword } = this.data.form
    if (!currentPassword || !newPassword || !confirmPassword) {
      return util.showToast('请完整填写密码')
    }
    if (newPassword.length < 6) return util.showToast('新密码至少需要6位')
    if (newPassword !== confirmPassword) return util.showToast('两次输入的新密码不一致')

    this.setData({ submitting: true })
    const app = getApp()
    const res = await cloud.callFunction('authService', {
      action: 'changePassword',
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      currentPassword,
      newPassword
    })
    this.setData({ submitting: false })

    if (res.code !== 0) {
      if (res.code === -401) {
        util.showToast(res.msg || '登录已过期，请重新登录')
        setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 800)
      } else {
        util.showToast(res.msg || '密码修改失败')
      }
      return
    }

    app.globalData.isLoggedIn = false
    app.globalData.userInfo = null
    app.globalData.currentStore = null
    app.globalData.authToken = ''
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('currentStore')
    wx.removeStorageSync('authToken')
    wx.removeStorageSync('sessionExpiresAt')
    util.showSuccess('密码已更新，请重新登录')
    setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 900)
  }
})
