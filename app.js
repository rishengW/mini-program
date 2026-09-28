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
    // 兼容 iOS 对 "2026-09-24 12:00:00" 等非 ISO 格式解析为 Invalid Date 的问题：
    // 数字直接用，字符串把 "-" 换成 "/"（JSCore 可解析），解析失败视为会话无效
    const parseExpires = value => {
      if (!value) return NaN
      if (typeof value === 'number') return value
      const date = new Date(String(value).replace(/-/g, '/').replace('T', ' '))
      return date.getTime()
    }
    const sessionValid = authToken && sessionExpiresAt && parseExpires(sessionExpiresAt) > Date.now()
    if (userInfo && sessionValid) {
      this.globalData.userInfo = userInfo
      this.globalData.authToken = authToken
      this.globalData.isLoggedIn = true
      // 供货商角色恢复其供货商档案信息
      if (userInfo.role === 'supplier') {
        this.globalData.supplierInfo = wx.getStorageSync('supplierInfo') || null
      }
      // 服务端异步校验会话有效性（不阻塞首屏）：
      // 防止本地存储伪造 sessionExpiresAt 维持"永久登录"、服务端已踢下线/停用账号的情况
      this.validateSessionOnLaunch(authToken)
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

  // 启动时向服务端校验会话（异步，不阻塞首屏）。
  // 失败/401 时清除本地会话并重置 globalData，等待用户重新登录。
  validateSessionOnLaunch(authToken) {
    if (!wx.cloud) return
    wx.cloud.callFunction({
      name: 'authService',
      data: { action: 'validate', authToken }
    }).then(res => {
      const r = (res && res.result) || {}
      if (r.code === 0) {
        // 服务端会话有效，用服务端返回的用户信息刷新本地缓存
        if (r.data && r.data.user) {
          this.globalData.userInfo = r.data.user
          wx.setStorageSync('userInfo', r.data.user)
          if (r.data.sessionExpiresAt) {
            wx.setStorageSync('sessionExpiresAt', r.data.sessionExpiresAt)
          }
        }
      } else {
        this.clearSession()
      }
    }).catch(() => {
      // 网络异常时保持本地登录态，由具体请求的 401 处理兜底
    })
  },

  // 清除本地登录态（供会话失效时复用）
  clearSession() {
    ;['userInfo', 'authToken', 'sessionExpiresAt', 'currentStore', 'supplierInfo'].forEach(key => {
      try { wx.removeStorageSync(key) } catch (e) { /* ignore */ }
    })
    this.globalData.isLoggedIn = false
    this.globalData.userInfo = null
    this.globalData.authToken = ''
    this.globalData.currentStore = null
    this.globalData.supplierInfo = null
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
