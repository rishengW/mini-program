// pages/purchase-detail/purchase-detail.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { detail: { items: [] }, canReceive: false },

  onLoad(options = {}) {
    this.orderId = options.id || options.orderId || ''
    if (!this.orderId) util.showToast('未获取到采购订单，请返回后重试')
  },

  onShow() {
    if (this.orderId) this.loadData()
  },

  async loadData() {
    util.showLoading('加载中...')
    const result = await cloud.callFunction('getPurchaseOrderDetail', { orderId: this.orderId })
    util.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const order = cloud.normalizePurchaseOrder(result.data)
    const statusInfo = meta.getStatusInfo(order.orderStatus)
    const canReceive = ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.orderStatus)
    this.setData({
      detail: { ...order, statusText: statusInfo.text, statusType: statusInfo.type },
      canReceive
    })
  },

  editRequest() { util.showToast('编辑功能待实现') },

  async submitRequest() {
    const confirmed = await util.showConfirm('确认提交审核？')
    if (confirmed) {
      util.showSuccess('已提交审核')
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  goReceive() {
    const d = this.data.detail
    wx.navigateTo({
      url: '/pages/receive-verify/receive-verify?orderId=' + d.purchaseOrderId + '&storeId=' + d.storeId
    })
  }
})
