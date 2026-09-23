// pages/supplier-orders/supplier-orders.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

const TABS = [
  { key: 'pending', label: '待确认' },
  { key: 'confirmed', label: '已确认' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' }
]

Page({
  data: {
    tabs: TABS,
    activeTab: 'pending',
    statusCounts: {},
    orders: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false
  },

  onLoad(options = {}) {
    if (options.status && TABS.some(t => t.key === options.status)) {
      this.setData({ activeTab: options.status })
    }
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
    this.reload()
  },

  onReachBottom() {
    const { orders, total, loading } = this.data
    if (loading || orders.length >= total) return
    this.loadOrders(this.data.page + 1, true)
  },

  switchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key })
    this.reload()
  },

  reload() {
    this.loadOrders(1, false)
  },

  async loadOrders(page, append) {
    if (this.data.loading) return
    this.setData({ loading: true })
    const res = await cloud.callFunction('getSupplierOrders', {
      confirmStatus: this.data.activeTab,
      page,
      pageSize: this.data.pageSize
    })
    this.setData({ loading: false })
    if (!res || res.code !== 0) {
      util.showToast((res && res.msg) || '订单加载失败，请稍后重试')
      return
    }
    const orders = (res.data || []).map(order => this.decorateOrder(order))
    this.setData({
      orders: append ? this.data.orders.concat(orders) : orders,
      page,
      total: res.total || 0,
      statusCounts: res.statusCounts || {}
    })
  },

  decorateOrder(order) {
    const o = cloud.normalizePurchaseOrder(order)
    const statusInfo = meta.getStatusInfo(o.orderStatus)
    const confirmInfo = meta.getSupplierConfirmInfo(order.my_confirm_status)
    return {
      ...o,
      myConfirmStatus: order.my_confirm_status || 'pending',
      statusText: statusInfo.text,
      statusType: statusInfo.type,
      confirmText: confirmInfo.text,
      confirmType: confirmInfo.type,
      canConfirm: order.my_confirm_status === 'pending',
      canShip: order.my_confirm_status === 'confirmed'
    }
  },

  async confirmOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const confirmed = await util.showConfirm('确认接收该订单并开始备货？')
    if (!confirmed) return
    this.doAction(orderId, 'confirm', '已确认接单')
  },

  async shipOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const confirmed = await util.showConfirm('确认商品已发出配送？')
    if (!confirmed) return
    this.doAction(orderId, 'ship', '已标记发货')
  },

  async doAction(orderId, action, successText) {
    util.showLoading('提交中...')
    const res = await cloud.callFunction('confirmSupplierOrder', { orderId, action })
    util.hideLoading()
    if (res && res.code === 0) {
      util.showSuccess(successText)
      this.reload()
    } else {
      util.showToast((res && res.msg) || '操作失败，请稍后重试')
    }
  }
})
