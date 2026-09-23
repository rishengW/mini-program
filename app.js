// app.js
const CLOUD_ENV = 'cloud1-d3gezx51aca79d9bb'

App({
  onLaunch() {
    this.initCloud()
    this.initPrivacyListener()

    // 检查登录状态
    const userInfo = wx.getStorageSync('userInfo')
    const authToken = wx.getStorageSync('authToken')
    const sessionExpiresAt = wx.getStorageSync('sessionExpiresAt')
    const sessionValid = authToken && sessionExpiresAt && new Date(sessionExpiresAt).getTime() > Date.now()
    if (userInfo && sessionValid) {
      this.globalData.userInfo = userInfo
      this.globalData.authToken = authToken
      this.globalData.isLoggedIn = true
      // 供货商角色恢复其供货商档案信息
      if (userInfo.role === 'supplier') {
        this.globalData.supplierInfo = wx.getStorageSync('supplierInfo') || null
      }
    } else if (userInfo || authToken) {
      wx.removeStorageSync('userInfo')
      wx.removeStorageSync('currentStore')
      wx.removeStorageSync('supplierInfo')
      wx.removeStorageSync('authToken')
      wx.removeStorageSync('sessionExpiresAt')
    }
    const currentStore = wx.getStorageSync('currentStore')
    if (currentStore) {
      this.globalData.currentStore = currentStore
    }
  },

  // 隐私授权：基础库触发隐私弹窗时，由系统弹出官方授权框，用户同意后继续调用
  initPrivacyListener() {
    if (wx.onNeedPrivacyAuthorization && wx.requirePrivacyAuthorize) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        wx.requirePrivacyAuthorize({
          success: () => resolve({ buttonId: '', event: 'agree' }),
          fail: () => resolve({ event: 'disagree' })
        })
      })
    }
  },

  // Keep a small readiness flag so a page opened immediately after launch
  // can repair initialization before its first cloud request.
  initCloud() {
    if (!wx.cloud) {
      this.globalData.cloudReady = false
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return false
    }
    try {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
      this.globalData.cloudReady = true
      return true
    } catch (err) {
      this.globalData.cloudReady = false
      console.error('[app] CloudBase 初始化失败:', err)
      return false
    }
  },

  globalData: {
    isLoggedIn: false,
    userInfo: null,
    authToken: '',
    currentStore: null,
    supplierInfo: null,
    companyInfo: null,
    cloudReady: false
  }
})
