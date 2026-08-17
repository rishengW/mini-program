// pages/login/login.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    username: '',
    password: '',
    isSuperAdminLogin: false,
    roles: [
      { key: 'chef', label: '下单人员', icon: '🍳', defaultUser: 'chef' },
      { key: 'store_manager', label: '店长', icon: '👨‍💼', defaultUser: 'manager' },
      { key: 'purchaser', label: '管理员', icon: '📊', defaultUser: 'admin_user' }
    ],
    selectedRole: 'chef'
  },

  onShow() {
    // 初始化默认填入第一项
    this.selectRole({ currentTarget: { dataset: { role: 'chef' } } })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  selectRole(e) {
    const roleKey = e.currentTarget.dataset.role
    const role = this.data.roles.find(item => item.key === roleKey)
    this.setData({
      selectedRole: roleKey,
      username: role ? role.defaultUser : '',
      password: ''
    })
  },

  toggleSuperAdmin() {
    const isSuper = !this.data.isSuperAdminLogin
    this.setData({ 
      isSuperAdminLogin: isSuper, 
      username: isSuper ? 'admin' : '', 
      password: ''
    })
    if (!isSuper) {
      this.selectRole({ currentTarget: { dataset: { role: this.data.selectedRole } } })
    }
  },

  async login() {
    const { username, password, selectedRole, isSuperAdminLogin } = this.data
    if (!username || !password) return util.showToast('请输入账号和密码')

    util.showLoading('登录中')
    const res = await cloud.callFunction('authService', {
      action: 'login',
      username,
      password,
      expectedRole: isSuperAdminLogin ? 'super_admin' : selectedRole
    })
    util.hideLoading()

    if (res.code === 0) {
      this.handleLoginSuccess(res.data)
    } else if (res.errorType) {
      wx.showModal({
        title: '登录服务不可用',
        content: res.msg,
        showCancel: false
      })
    } else {
      util.showToast(res.msg || '账号或密码错误')
    }
  },

  handleLoginSuccess(data) {
    const { user, store, sessionToken, sessionExpiresAt } = data

    const app = getApp()
    app.globalData.isLoggedIn = true
    app.globalData.userInfo = user
    app.globalData.currentStore = store
    app.globalData.authToken = sessionToken

    wx.setStorageSync('userInfo', user)
    wx.setStorageSync('currentStore', store)
    wx.setStorageSync('authToken', sessionToken)
    wx.setStorageSync('sessionExpiresAt', sessionExpiresAt)
    wx.removeStorageSync('account_history')

    util.showSuccess('登录成功')
    setTimeout(() => {
      wx.switchTab({ url: '/pages/index/index' })
    }, 1000)
  }
})
