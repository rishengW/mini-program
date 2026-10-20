// app.js
const { parseTimestamp } = require('./utils/date')

const CLOUD_ENV = 'cloud1-d3gezx51aca79d9bb'

App({
  onLaunch() {
    this.initCloud()
    this.initPrivacyListener()

    // 检查登录状态
    const userInfo = wx.getStorageSync('userInfo')
    const authToken = wx.getStorageSync('authToken')
    const sessionExpiresAt = wx.getStorageSync('sessionExpiresAt')
    // 服务端返回的是 ISO 8601，统一按 utils/date 的口径解析（先原生 ISO，失败退回斜杠格式）
    const expiresAt = parseTimestamp(sessionExpiresAt)
    const sessionValid = !!(authToken && sessionExpiresAt && expiresAt > Date.now())
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

  // 温启动（后台切回）时复检会话：
  // 会话在后台期间可能已被服务端作废（改密/停用/被挤下线），
  // onLaunch 不会再次触发，需在 onShow 补一次校验。
  onShow() {
    if (!this.globalData.isLoggedIn) return
    const authToken = this.globalData.authToken
    if (!authToken) return
    this.validateSessionOnLaunch(authToken)
  },

  // 启动/切回前台时向服务端校验会话（异步，不阻塞首屏）。
  // 失败/401 时清除本地会话并重置 globalData，强制用户重新登录。
  // 返回 Promise：会话是否仍然有效。登录页据此等待校验落定再决定去留，
  // 避免"本地存储说有效、服务端说无效"时先闪一下首页再被踢回登录页。
  validateSessionOnLaunch(authToken) {
    if (!wx.cloud) return Promise.resolve(false)
    // 冷启动时 onLaunch 与 onShow 紧邻触发，会连发两次校验；此处复用同一个 Promise
    if (this._sessionValidation) return this._sessionValidation
    this._validatingSession = true
    this._sessionValidation = wx.cloud.callFunction({
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
        return true
      }
      // 服务端已判定会话失效（改密/停用/被挤下线）：清本地态并立刻回登录页，
      // 否则用户会停在首页看到一片空数据（业务请求的 401 兜底要等下一次请求才触发）
      this.clearSession()
      this.redirectToLogin('登录已过期，请重新登录')
      return false
    }, () => {
      // 网络异常时保持本地登录态，由具体请求的 401 处理兜底
      return true
    }).then(result => {
      this._validatingSession = false
      this._sessionValidation = null
      return result
    })
    return this._sessionValidation
  },

  // 踢回登录页（带提示）。防止重复跳转。
  redirectToLogin(message) {
    if (this._redirectingToLogin) return
    this._redirectingToLogin = true
    if (message) wx.showToast({ title: message, icon: 'none' })
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/login' })
      this._redirectingToLogin = false
    }, 600)
  },

  // 清除本地登录态（供会话失效时复用；P2-67：键位单源维护，各登出入口统一调这里）
  clearSession() {
    ;['userInfo', 'authToken', 'sessionExpiresAt', 'currentStore', 'supplierInfo', 'account_history'].forEach(key => {
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
