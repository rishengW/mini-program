// pages/store-switch/store-switch.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const authGuard = require('../../utils/auth-guard')

Page({
  data: { stores: [], currentStoreId: '' },

  async onLoad() {
    if (!authGuard.requireLogin()) return
    const app = getApp()
    // 供货商账号没有门店概念，误入时送回供货商门户
    const user = app.globalData.userInfo || {}
    if (user.role === 'supplier') {
      wx.reLaunch({ url: '/pages/supplier-home/supplier-home' })
      return
    }
    const currentStore = app.globalData.currentStore
    const result = await cloud.callFunction('authService', {
      action: 'getStores',
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '门店加载失败，请稍后重试')
      return
    }
    // M4（2026-11-13）：非全局角色只允许切到本人所属门店——此前 chef/店长可切到
    // 任意门店，与 user-manage 的所属门店约束矛盾（服务端另有归属校验兜底）
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    const stores = isGlobal
      ? (result.data || [])
      : (result.data || []).filter(s => s.storeId === user.defaultStoreId)
    if (!stores.length) {
      util.showToast(isGlobal ? '暂无门店' : '当前账号未关联门店，请联系管理员')
      return
    }
    this.setData({
      stores,
      currentStoreId: currentStore ? (currentStore.storeId || currentStore.id) : ''
    })
  },

  selectStore(e) {
    const storeId = e.currentTarget.dataset.id
    const store = this.data.stores.find(s => s.storeId === storeId)
    if (store) {
      const app = getApp()
      app.globalData.currentStore = store
      wx.setStorageSync('currentStore', store)
      this.setData({ currentStoreId: storeId })
      util.showSuccess('已切换到 ' + store.storeName)
      setTimeout(() => wx.navigateBack(), 800)
    }
  }
})
