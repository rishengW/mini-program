// app.js
App({
  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloud1-d3gezx51aca79d9bb', // TODO: 替换为真实云环境ID
        traceUser: true
      })
    }

    // 检查登录状态
    const userInfo = wx.getStorageSync('userInfo')
    const authToken = wx.getStorageSync('authToken')
    const sessionExpiresAt = wx.getStorageSync('sessionExpiresAt')
    const sessionValid = authToken && sessionExpiresAt && new Date(sessionExpiresAt).getTime() > Date.now()
    if (userInfo && sessionValid) {
      this.globalData.userInfo = userInfo
      this.globalData.authToken = authToken
      this.globalData.isLoggedIn = true
    } else if (userInfo || authToken) {
      wx.removeStorageSync('userInfo')
      wx.removeStorageSync('currentStore')
      wx.removeStorageSync('authToken')
      wx.removeStorageSync('sessionExpiresAt')
    }
    const currentStore = wx.getStorageSync('currentStore')
    if (currentStore) {
      this.globalData.currentStore = currentStore
    }
  },

  globalData: {
    isLoggedIn: false,
    userInfo: null,
    authToken: '',
    currentStore: null,
    companyInfo: null,
    cloudReady: false
  }
})
