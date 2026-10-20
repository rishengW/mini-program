/**
 * 页面登录守卫：管理/业务页 onLoad 首行调用，未登录直接重定向登录页。
 * 用法：onLoad() { if (!requireLogin()) return; ... }
 */

// 只读判断当前是否处于登录态，不产生任何跳转。
// 登录页用它做"已登录就让路"，业务页用 requireLogin()。
function isLoggedIn() {
  try {
    const app = getApp()
    return !!(app && app.globalData && app.globalData.isLoggedIn && app.globalData.authToken)
  } catch (err) {
    return false
  }
}

function requireLogin() {
  if (isLoggedIn()) return true
  wx.reLaunch({ url: '/pages/login/login' })
  return false
}

module.exports = { isLoggedIn, requireLogin }
