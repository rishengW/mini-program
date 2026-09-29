/**
 * 页面登录守卫：管理/业务页 onLoad 首行调用，未登录直接重定向登录页。
 * 用法：onLoad() { if (!requireLogin()) return; ... }
 */
function requireLogin() {
  try {
    const app = getApp()
    if (app && app.globalData && app.globalData.isLoggedIn && app.globalData.authToken) {
      return true
    }
  } catch (err) { /* ignore */ }
  wx.reLaunch({ url: '/pages/login/login' })
  return false
}

module.exports = { requireLogin }
