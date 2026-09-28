// pages/account/account.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')

Page({
  data: {
    user: null,
    avatarText: '我',
    form: { currentPassword: '', newPassword: '', confirmPassword: '' },
    submitting: false
  },

  onShow() {
    if (!authGuard.requireLogin()) return
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
      currentPassword,
      newPassword
    })
    this.setData({ submitting: false })

    if (res.code !== 0) {
      // -401 已由 utils/cloud.js 统一拦截（清会话+跳登录），此处只提示其他错误
      if (res.code !== -401) {
        util.showToast(res.msg || '密码修改失败')
      }
      return
    }

    // 改密成功后清空本地登录态并重新登录
    if (typeof app.clearSession === 'function') {
      app.clearSession()
    } else {
      app.globalData.isLoggedIn = false
      app.globalData.userInfo = null
      app.globalData.currentStore = null
      app.globalData.authToken = ''
      ;['userInfo', 'currentStore', 'supplierInfo', 'authToken', 'sessionExpiresAt'].forEach(key => wx.removeStorageSync(key))
    }
    util.showSuccess('密码已更新，请重新登录')
    setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 900)
  }
})
