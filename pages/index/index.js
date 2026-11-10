// pages/index/index.js
// 重写：状态卡片可点击跳转 + 删除快捷操作
const cloud = require('../../utils/cloud')
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')

// P2-32（2026-11-09 修复）：首页防请求风暴。
// 原实现每次 onShow 固定发 4 个云调用（最近订单/最近报表/消息/状态统计），
// 快速切 tab 或页面往返会成套叠加。两道闸：
//   ① 在途去重——上一套请求未返回时，新的 onShow 直接让路（在途请求刚发出，数据足够新）；
//   ② 新鲜度缓存——同账号同门店 10 秒内的重复 onShow 复用上次结果不发请求。
//      下拉刷新（force）、换门店/换账号（缓存键变化）绕过缓存；
//      加载失败不记缓存，下次进页即重试。
// 不做后端聚合接口：订单/报表的角色过滤各自单源在 getPurchaseOrders / getReports，
// 复制进 dataService 会重演共享模块漂移（F1 教训）。
const HOME_CACHE_MS = 10 * 1000

Page({
  data: {
    storeName: '',
    userName: '',
    roleLabel: '',
    stats: [],
    recentOrders: [],
    recentReports: [],
    isSuperAdmin: false,
    isManager: false,
    unreadMsg: 0,
    // 2026-11-10 拍板：chef 无报表入口，首页最近报表区块不渲染
    showReports: true
  },

  // P2-32：页面实例级缓存状态（非渲染数据，不进 data）
  _loading: false,
  _loadedKey: '',
  _loadedAt: 0,

  async onShow() {
    await this.refreshHome(false)
  },

  // L36：下拉刷新是用户显式意图，绕过新鲜度缓存强制重拉
  async onPullDownRefresh() {
    try { await this.refreshHome(true) } finally { wx.stopPullDownRefresh() }
  },

  async refreshHome(force) {
    // L12：requireLogin 已保证登录态（未登录会跳登录页），原 isLoggedIn 二重判断恒假，已删
    if (!authGuard.requireLogin()) return
    const app = getApp()

    const user = app.globalData.userInfo
    // 供货商有独立门户，误入门店首页时直接转走
    if (user && user.role === 'supplier') {
      wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
      return
    }
    const store = app.globalData.currentStore || {}

    // 2026-11-10 拍板：chef 隐藏「报表」tab（tabBar 第 3 项，index 2）；其他角色恢复显示。
    // hideTabBarItem/showTabBarItem 需较新基础库（实测开发者工具 3.17.1 无此 API，
    // 直接调用抛 TypeError 炸断 onShow）——特性检测降级：无 API 时 tab 保留
    // （report 三页面有守卫兜底），仅影响视觉入口，不阻断首页渲染。
    if (typeof wx.hideTabBarItem === 'function' && typeof wx.showTabBarItem === 'function') {
      const tabApi = user.role === 'chef' ? wx.hideTabBarItem : wx.showTabBarItem
      try { tabApi.call(wx, { index: 2, fail: () => {} }) } catch (e) { console.warn('[index] tabBar 显隐切换失败:', e) }
    }

    const storeId = store.storeId || store.id || ''
    const cacheKey = [user.userId || user.id || user.name, user.role, storeId].join('|')
    if (this._loading) return
    if (!force && this._loadedKey === cacheKey && Date.now() - this._loadedAt < HOME_CACHE_MS) return

    this._loading = true
    try {
      // 统计走服务端聚合计数；最近订单/报表只取前 3 条，不再为统计拉全量
      const [ordersResult, reportsResult, messagesResult, statsResult] = await Promise.all([
        cloud.callFunction('getPurchaseOrders', {
          role: user.role,
          storeId,
          createdBy: user.role === 'chef' ? (user.userId || user.id || user.name) : '',
          pageSize: 3
        }),
        // 2026-11-10 拍板：chef 无报表入口——不再请求报表接口（也少一次云调用）
        user.role === 'chef'
          ? Promise.resolve({ code: 0, data: [] })
          : cloud.callFunction('getReports', {
            role: user.role,
            storeId,
            reportType: '',
            relatedDate: '',
            page: 1,
            pageSize: 3
          }),
        cloud.callFunction('dataService', { action: 'getMessages' }),
        cloud.callFunction('dataService', { action: 'getOrderStats', storeId })
      ])

      if (ordersResult.code !== 0 || reportsResult.code !== 0 || messagesResult.code !== 0 || statsResult.code !== 0) {
        util.showToast('首页数据加载失败，请稍后重试')
        return
      }

      const myOrders = (ordersResult.data || []).map(cloud.normalizePurchaseOrder)
      const myReports = (reportsResult.data || []).map(cloud.normalizeReport)
      const messages = messagesResult.data || []

      // 统计（全部可点击）：来自服务端聚合，不受分页截断影响
      const statsData = statsResult.data || {}
      const pendingOrders = statsData.submitted || 0
      const pendingReceive = statsData.receivable || 0
      const completedOrders = statsData.received || 0
      // 待核销：已收货待核销的手动单，仅管理员可见可点击（清单 #20 催办）
      const toVerify = statsData.to_verify || 0
      const unreadMsg = messages.filter(m => !m.read).length

      const stats = [
        { label: '待处理', value: pendingOrders, iconClass: 'icon-clipboard-warning', status: 'submitted' },
        { label: '待收货', value: pendingReceive, iconClass: 'icon-package-primary', status: 'receivable' },
        { label: '已完成', value: completedOrders, iconClass: 'icon-check-success', status: 'received' },
        { label: '需关注', value: unreadMsg, iconClass: 'icon-alert-danger', status: 'message' }
      ]
      if (['super_admin', 'purchaser'].includes(user.role)) {
        stats.push({ label: '待核销', value: toVerify, iconClass: 'icon-receipt-orange', status: 'to_verify' })
      }

      // 最近采购单
      const recentOrders = myOrders.slice(0, 3).map(o => {
        const statusInfo = meta.getStatusInfo(o.orderStatus)
        return {
          ...o,
          statusText: statusInfo.text,
          statusType: statusInfo.type,
          itemCount: o.items.length,
          manualCount: o.items.filter(i => i.isManual).length
        }
      })

      // 最近报表
      const recentReports = myReports.slice(0, 3).map(r => {
        const typeInfo = meta.getReportTypeInfo(r.reportType)
        return { ...r, typeLabel: typeInfo.label, typeIconClass: typeInfo.iconClass }
      })

      this.setData({
        storeName: store.storeName || store.name || '未选择门店',
        userName: user.name,
        roleLabel: user.roleLabel || user.role,
        isSuperAdmin: user.role === 'super_admin',
        isManager: ['super_admin', 'purchaser'].includes(user.role),
        unreadMsg,
        showReports: user.role !== 'chef',
        stats, recentOrders, recentReports
      })

      // 成功才记缓存；失败保持旧值，下次进页重试
      this._loadedKey = cacheKey
      this._loadedAt = Date.now()
    } catch (err) {
      console.error('[index] 首页数据加载异常:', err)
      util.showToast('首页数据加载失败，请稍后重试')
    } finally {
      this._loading = false
    }
  },

  goStore() { wx.navigateTo({ url: '/pages/store-switch/store-switch' }) },

  // 门店管理（仅超管可见入口，后端各 store 操作同样校验超管身份）
  openStoreManage() {
    wx.navigateTo({ url: '/pages/store-manage/store-manage' })
  },

  // 顶部铃铛入口：进消息中心（tabBar 页面需用 switchTab）
  goMessages() {
    wx.switchTab({ url: '/pages/message/message' })
  },

  goAccount() { wx.navigateTo({ url: '/pages/account/account' }) },

  async switchAccount() {
    const confirmed = await util.showConfirm('退出当前账号？')
    if (!confirmed) return
    const app = getApp()
    await cloud.callFunction('authService', {
      action: 'logout',
    })
    // P2-67：登出清理统一走 app.clearSession()，键位新增不再漏清
    app.clearSession()
    wx.reLaunch({ url: '/pages/login/login' })
  },

  // 状态卡片点击
  goStatPage(e) {
    const status = e.currentTarget.dataset.status
    if (status === 'message') {
      // "需关注"显示的是未读消息数，跳消息页（tabBar 页面需用 switchTab）
      wx.switchTab({ url: '/pages/message/message' })
    } else if (status === 'abnormal') {
      wx.navigateTo({ url: '/pages/abnormal-list/abnormal-list' })
    } else {
      // purchase-list 是 tabBar 页面，switchTab 不支持 URL 传参，改经全局暂存传递筛选状态
      getApp().globalData.pendingListFilter = status
      wx.switchTab({ url: '/pages/purchase-list/purchase-list' })
    }
  },

  goOrderDetail(e) {
    wx.navigateTo({ url: '/pages/purchase-detail/purchase-detail?id=' + e.currentTarget.dataset.id })
  },

  goReportDetail(e) {
    wx.navigateTo({ url: '/pages/report-detail/report-detail?id=' + e.currentTarget.dataset.id })
  },

  goAction(e) {
    const { url, taburl } = e.currentTarget.dataset
    if (taburl) { wx.switchTab({ url: taburl }) }
    else if (url) { wx.navigateTo({ url }) }
  }
})
