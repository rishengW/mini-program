// pages/store-switch/store-switch.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { stores: [], currentStoreId: '', canAdd: false, showAddForm: false, storeName: '' },

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
      currentStoreId: currentStore ? (currentStore.storeId || currentStore.id) : '',
      canAdd: user.role === 'super_admin'
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
  },

  openAddForm() {
    this.setData({ showAddForm: true, storeName: '' })
  },

  closeAddForm() {
    this.setData({ showAddForm: false })
  },

  onStoreNameInput(e) {
    this.setData({ storeName: e.detail.value })
  },

  stopBubble() {},

  async saveStore() {
    const storeName = this.data.storeName.trim()
    if (!storeName) return util.showToast('请输入门店名称')

    util.showLoading()
    const res = await cloud.callFunction('authService', {
      action: 'createStore',
      storeName
    })
    util.hideLoading()

    if (res && res.code === 0) {
      util.showSuccess('门店已创建')
      this.setData({ showAddForm: false, storeName: '' })
      this.onLoad()
    } else {
      util.showToast((res && res.msg) || '创建失败，请稍后重试')
    }
  }
})
