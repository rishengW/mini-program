// pages/supplier-prices/supplier-prices.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    prices: [],
    loading: false
  },

  onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    if (user.role !== 'supplier') {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    this.loadPrices()
  },

  async loadPrices() {
    this.setData({ loading: true })
    // 云函数会为供货商角色强制限定只能查自己的价格
    const res = await cloud.callFunction('getProductPrices', { onlyCurrent: true })
    this.setData({ loading: false })
    if (!res || res.code !== 0) {
      util.showToast((res && res.msg) || '价格数据加载失败，请稍后重试')
      return
    }
    const prices = (res.data || []).map(item => ({
      ...item,
      priceText: '¥' + (Number(item.price) || 0).toFixed(2)
    }))
    this.setData({ prices })
  }
})
