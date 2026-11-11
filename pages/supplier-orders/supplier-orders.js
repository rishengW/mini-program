// pages/supplier-orders/supplier-orders.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const authGuard = require('../../utils/auth-guard')
const { listLifecycle, listFetch } = require('../../utils/list-page')

// L23：tab 文案收敛到 meta.supplierConfirmMap 单源，不再本地硬编码
const TABS = ['pending', 'confirmed', 'shipped', 'done', 'all'].map(key => ({
  key,
  label: key === 'all' ? '全部' : meta.getSupplierConfirmInfo(key).text
}))

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
    if (!authGuard.requireLogin()) return
    if (options.status && TABS.some(t => t.key === options.status)) {
      this.setData({ activeTab: options.status })
    }
  },

  onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    // L13：requireLogin 已保证登录态，原 if(!isLoggedIn) 死分支删除
    if (user.role !== 'supplier') {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    this.reload()
  },

  ...listLifecycle('orders'),

  switchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key })
    this.reload()
  },

  // 分页骨架统一走 listFetch（L17/L27），保留 loading 重入守卫与 P2-69 首屏失败清空
  async fetchPage(page, append) {
    await listFetch(page, this, append, {
      fetch: () => cloud.callFunction('getSupplierOrders', {
        confirmStatus: this.data.activeTab,
        page,
        pageSize: this.data.pageSize
      }),
      decorate: order => this.decorateOrder(order),
      listKey: 'orders',
      failMsg: '订单加载失败，请稍后重试',
      skipIfLoading: true,
      clearOnFail: true,
      extraSetData: res => ({ statusCounts: res.statusCounts || {} })
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
    if (this._submitting) return
    this._submitting = true
    util.showLoading('提交中...')
    const res = await cloud.callFunction('confirmSupplierOrder', { orderId, action })
    util.hideLoading()
    this._submitting = false
    if (res && res.code === 0) {
      util.showSuccess(successText)
      this.reload()
    } else {
      util.showToast((res && res.msg) || '操作失败，请稍后重试')
    }
  }
})
