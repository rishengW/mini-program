// pages/login/login.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const authGuard = require('../../utils/auth-guard')

// 光标与键盘的间距（单位 px）。微信 input 的 cursor-spacing 只认 px，
// 但页面是按 rpx 自适应的：固定写死 120 会让宽屏（大字体/平板）下
// "账号框到密码框"的可用间距被吃掉，密码框会被键盘遮住。
// 因此按屏幕宽度折算成等效 rpx 数值，基准为 375px 宽时的 120px。
const CURSOR_SPACING_RPX = 240
const BASE_WINDOW_WIDTH = 375

Page({
  data: {
    username: '',
    password: '',
    isSuperAdminLogin: false,
    cursorSpacing: 120,
    // 底部落款版本号：与云函数 package.json 的 1.0.0 对齐，发版时改这一处
    appVersion: 'v1.0.0',
    roles: [
      { key: 'chef', label: '下单人员', iconClass: 'icon-chef-primary' },
      { key: 'store_manager', label: '店长', iconClass: 'icon-store-primary' },
      { key: 'purchaser', label: '采购主管', iconClass: 'icon-chart-primary' },
      { key: 'supplier', label: '供货商', iconClass: 'icon-truck-primary' }
    ],
    selectedRole: '',
    selectedRoleLabel: '',
    // 是否已展开账号密码输入栏：初始只显示角色按钮，点击角色后滑动闪现
    formExpanded: false
  },

  onLoad() {
    this.setData({ cursorSpacing: this.computeCursorSpacing() })
  },

  onShow() {
    // 不预填任何账号，避免向使用者公示测试账号。
    // 初始态（输入栏/超管层收起、角色未选中、账号密码为空）由 data 默认值保证：
    // 离开登录页的路径（switchTab/reLaunch）都会销毁页面实例，再次进入必是全新实例。
    // 这里不做表单重置 —— onShow 在应用从后台切回前台时也会触发，
    // 重置会把用户输到一半的账号密码清掉（如切去密码管理器复制密码回来）。
    //
    // 会话仍有效时不显示登录页，直接进入对应门户。
    // 冷启动入口是 pages[0]=login（app.json），这里负责"让路"，
    // 否则有效会话也会停在登录页要求重新登录。
    this.redirectIfLoggedIn()
  },

  // 已登录则跳转到对应首页；供货商走独立门户，其余走门店首页。
  // 与 handleLoginSuccess 的落点保持一致，避免两条路径分叉。
  //
  // 先等服务端会话校验落定再决定去留：本地存储显示有效、但服务端已作废时，
  // 若直接跳首页，用户会先看到首页空数据，再被 401 兜底踢回登录页（闪屏）。
  async redirectIfLoggedIn() {
    if (!authGuard.isLoggedIn()) return
    // 重入守卫：onShow 在切回前台时会再触发，校验在途时多次调用会叠在
    // 同一个 Promise 上，落定后各发一次跳转（重复导航）
    if (this._redirecting) return
    this._redirecting = true
    const app = getApp()
    // 记下进入时的 token：校验在途期间用户可能已用另一账号手动登录，
    // token 变了说明会话已换人，跳转由新登录的 handleLoginSuccess 负责，这里不再插手
    const tokenAtStart = app.globalData.authToken
    try {
      if (typeof app.validateSessionOnLaunch === 'function') {
        const valid = await app.validateSessionOnLaunch(tokenAtStart)
        if (valid === false) return
      }
      if (app.globalData.authToken !== tokenAtStart) return
      // 校验期间会话可能已被清掉，再确认一次登录态
      if (!authGuard.isLoggedIn()) return
      const user = app.globalData.userInfo || {}
      if (user.role === 'supplier') {
        wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
      } else {
        wx.switchTab({ url: '/pages/index/index' })
      }
    } finally {
      // 跳转成功后页面即被销毁，复位无副作用；
      // 提前 return（校验失败/会话换人）时复位，让后续 onShow 能再次尝试
      this._redirecting = false
    }
  },

  // 按屏幕宽度折算 cursor-spacing（px）
  computeCursorSpacing() {
    let windowWidth = BASE_WINDOW_WIDTH
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      windowWidth = (info && info.windowWidth) || BASE_WINDOW_WIDTH
    } catch (e) {
      windowWidth = BASE_WINDOW_WIDTH
    }
    return Math.round(CURSOR_SPACING_RPX * windowWidth / 750)
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  // 点击角色入口：选中该角色并滑动展开账号密码输入栏
  selectRole(e) {
    const roleKey = e.currentTarget.dataset.role
    const role = this.data.roles.find(r => r.key === roleKey)
    this.setData({
      selectedRole: roleKey,
      selectedRoleLabel: role ? role.label : '',
      formExpanded: true,
      username: '',
      password: ''
    })
  },

  // 从账号密码输入栏滑回角色按钮面板（清选中态，回到干净初始）
  backToRoles() {
    this.setData({ formExpanded: false, username: '', password: '', selectedRole: '', selectedRoleLabel: '' })
  },

  toggleSuperAdmin() {
    const isSuper = !this.data.isSuperAdminLogin
    this.setData({
      isSuperAdminLogin: isSuper,
      formExpanded: false,
      username: '',
      password: '',
      selectedRole: '',
      selectedRoleLabel: ''
    })
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
    const { user, store, supplier, sessionToken, sessionExpiresAt } = data

    const app = getApp()
    app.globalData.isLoggedIn = true
    app.globalData.userInfo = user
    app.globalData.currentStore = store
    app.globalData.supplierInfo = supplier || null
    app.globalData.authToken = sessionToken

    wx.setStorageSync('userInfo', user)
    wx.setStorageSync('authToken', sessionToken)
    wx.setStorageSync('sessionExpiresAt', sessionExpiresAt)
    wx.removeStorageSync('account_history')

    util.showSuccess('登录成功')
    // 供货商没有门店概念，进入独立的供货商门户首页
    if (user.role === 'supplier') {
      wx.setStorageSync('supplierInfo', supplier || null)
      wx.removeStorageSync('currentStore')
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
      }, 1000)
      return
    }
    wx.setStorageSync('currentStore', store)
    wx.removeStorageSync('supplierInfo')
    setTimeout(() => {
      wx.switchTab({ url: '/pages/index/index' })
    }, 1000)
  }
})
