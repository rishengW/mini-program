// pages/approval-detail/approval-detail.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    detail: {},
    auditRemark: ''
  },

  async onLoad(options = {}) {
    this.orderId = options.id || options.orderId || ''
    const result = await cloud.callFunction('getPurchaseOrderDetail', { orderId: this.orderId })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '采购申请加载失败')
      return
    }
    const order = cloud.normalizePurchaseOrder(result.data)
    const detail = {
        ...order,
        requesterName: order.createdBy,
        expectedDeliveryDate: order.orderDate,
        submittedAt: order.createdAt,
        items: order.items.map(item => ({
          ...item,
          productName: item.productNameSnapshot,
          spec: item.categorySnapshot,
          unit: item.unitSnapshot,
          requestedQty: item.orderQty,
          approveQty: item.orderQty
        }))
      }
    this.setData({ detail })
  },

  onApproveQtyInput(e) {
    const index = e.currentTarget.dataset.index
    const val = parseFloat(e.detail.value) || 0
    this.setData({ [`detail.items[${index}].approveQty`]: val })
  },

  onAuditRemarkInput(e) {
    this.setData({ auditRemark: e.detail.value })
  },

  async approveRequest() {
    const confirmed = await util.showConfirm('确认通过该采购申请？')
    if (!confirmed) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'auditOrder', authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      orderId: this.orderId, status: 'approved', items: this.data.detail.items.map(item => ({ itemId: item.itemId, approveQty: item.approveQty }))
    })
    if (result.code === 0) { util.showSuccess('审核通过'); setTimeout(() => wx.navigateBack(), 800) } else util.showToast(result.msg || '审核失败')
  },

  async rejectRequest() {
    if (!this.data.auditRemark) {
      util.showToast('请填写驳回原因')
      return
    }
    const confirmed = await util.showConfirm('确认驳回该采购申请？')
    if (!confirmed) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'auditOrder', authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      orderId: this.orderId, status: 'rejected', auditRemark: this.data.auditRemark, items: []
    })
    if (result.code === 0) { util.showToast('已驳回'); setTimeout(() => wx.navigateBack(), 800) } else util.showToast(result.msg || '审核失败')
  }
})
