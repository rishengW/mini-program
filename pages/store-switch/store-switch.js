// pages/store-switch/store-switch.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { stores: [], currentStoreId: '' },

  async onLoad() {
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
    this.setData({
      stores: result.data || [],
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
