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

// L24（2026-11-10）：审批列表/详情两页「仅管理员可审核」拦截原逐字重复，收敛到此处。
// 非全局角色（超管/采购主管）toast + 返回，返回 false；放行返回 true。
function requireGlobalRole() {
  const role = (getApp().globalData.userInfo || {}).role
  if (['super_admin', 'purchaser'].includes(role)) return true
  require('./util').showToast('仅管理员可审核采购申请')
  setTimeout(() => wx.navigateBack(), 800)
  return false
}

module.exports = { isLoggedIn, requireLogin, requireGlobalRole }
