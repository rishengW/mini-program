// pages/approval-list/approval-list.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const meta = require('../../utils/meta')

Page({
  data: { list: [] },

  async onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    const result = await cloud.callFunction('getPurchaseOrders', {
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      role: user.role || 'purchaser',
      storeId: store.storeId || '',
      createdBy: '',
      pageSize: 100
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '审核列表加载失败')
      return
    }
    const list = (result.data || []).map(cloud.normalizePurchaseOrder)
      .filter(o => o.orderStatus === 'submitted' || o.orderStatus === 'pending_approval')
      .map(o => {
        const statusInfo = meta.getStatusInfo(o.orderStatus)
        return {
          ...o,
          id: o.purchaseOrderId,
          requesterName: o.createdBy,
          expectedDeliveryDate: o.deliveryDate || o.orderDate,
          submittedAt: o.submittedAt,
          statusText: statusInfo.text
        }
      })
    this.setData({ list })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/approval-detail/approval-detail?id=' + e.currentTarget.dataset.id })
  },

  async approveRequest(e) {
    const confirmed = await util.showConfirm('确认通过该采购申请？')
    if (!confirmed) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'auditOrder', authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      orderId: e.currentTarget.dataset.id, status: 'approved', items: []
    })
    if (result.code === 0) { util.showSuccess('已通过'); this.onShow() } else util.showToast(result.msg || '审核失败')
  },

  async rejectRequest(e) {
    const confirmed = await util.showConfirm('确认驳回该采购申请？')
    if (!confirmed) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'auditOrder', authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      orderId: e.currentTarget.dataset.id, status: 'rejected', auditRemark: '审核驳回', items: []
    })
    if (result.code === 0) { util.showToast('已驳回'); this.onShow() } else util.showToast(result.msg || '审核失败')
  }
})
