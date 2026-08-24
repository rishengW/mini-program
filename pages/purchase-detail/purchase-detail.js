// pages/purchase-detail/purchase-detail.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { detail: { items: [] }, canReceive: false, canEdit: false },

  onLoad(options = {}) {
    this.orderId = options.id || options.orderId || ''
    if (!this.orderId) util.showToast('未获取到采购订单，请返回后重试')
  },

  onShow() {
    if (this.orderId) this.loadData()
  },

  async loadData() {
    util.showLoading('加载中...')
    const app = getApp()
    const result = await cloud.callFunction('getPurchaseOrderDetail', {
      orderId: this.orderId,
      authToken: app.globalData.authToken || wx.getStorageSync('authToken')
    })
    util.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const order = cloud.normalizePurchaseOrder(result.data)
    const statusInfo = meta.getStatusInfo(order.orderStatus)
    const currentUser = app.globalData.userInfo || {}
    const canReceive = currentUser.role !== 'chef' && ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.orderStatus)
    const canEdit = order.orderStatus === 'draft' && (
      ['super_admin', 'purchaser'].includes(currentUser.role) ||
      order.createdById === (currentUser.userId || currentUser.id)
    )
    this.setData({
      detail: { ...order, statusText: statusInfo.text, statusType: statusInfo.type },
      canReceive,
      canEdit
    })
  },

  editRequest() {
    if (!this.data.detail.purchaseOrderId) return
    wx.navigateTo({ url: '/pages/purchase-create/purchase-create?orderId=' + this.data.detail.purchaseOrderId })
  },

  async submitRequest() {
    const confirmed = await util.showConfirm('确认提交审核？')
    if (!confirmed) return
    const d = this.data.detail
    const items = (d.items || []).map(item => ({
      productId: item.productId,
      productName: item.productNameSnapshot,
      category: item.categorySnapshot,
      unit: item.unitSnapshot,
      supplierId: item.supplierId || null,
      orderQty: item.orderQty,
      isManual: !!item.isManual,
      remark: item.remark || ''
    }))
    util.showLoading('提交中...')
    const app = getApp()
    const result = await cloud.callFunction('createPurchaseOrder', {
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      orderId: d.purchaseOrderId,
      storeId: d.storeId,
      storeName: d.storeName,
      orderDate: d.orderDate,
      deliveryDate: d.deliveryDate,
      createdBy: d.createdById,
      createdByName: d.createdBy,
      items,
      remark: d.remark || '',
      orderStatus: 'submitted'
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已提交审核')
      setTimeout(() => wx.navigateBack(), 1000)
    } else {
      util.showToast((result && result.msg) || '提交审核失败')
    }
  },

  goReceive() {
    const d = this.data.detail
    wx.navigateTo({
      url: '/pages/receive-verify/receive-verify?orderId=' + d.purchaseOrderId + '&storeId=' + d.storeId
    })
  }
})
