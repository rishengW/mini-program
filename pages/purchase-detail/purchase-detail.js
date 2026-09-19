// pages/purchase-detail/purchase-detail.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
    data: { detail: { items: [] }, canReceive: false, canEdit: false, canWithdraw: false },

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
    // 撤回（#8）：仅未审核（submitted）可撤；创建者本人或全局角色，店长不代撤他人订单
    const canWithdraw = order.orderStatus === 'submitted' && (
      ['super_admin', 'purchaser'].includes(currentUser.role) ||
      order.createdById === (currentUser.userId || currentUser.id)
    )
    this.setData({
      detail: { ...order, statusText: statusInfo.text, statusType: statusInfo.type },
      canReceive,
      canEdit,
      canWithdraw
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
  },

  async withdrawRequest() {
    if (this._submitting) return
    this._submitting = true
    try {
      // 系统作废 ≠ 供应商撤单：CSV 可能已线下发出，确认文案强制提醒
      const confirmed = await util.showConfirm('确认撤回该采购申请？撤回后回到草稿，可重新编辑再提交。若订货单已发给供应商，请同步线下通知作废。')
      if (!confirmed) return

      util.showLoading('撤回中...')
      const result = await cloud.callFunction('dataService', {
        action: 'withdrawOrder',
        orderId: this.orderId
      })
      util.hideLoading()

      if (result.code === 0) {
        const warning = result.data && result.data.reportWarning
        util.showToast(warning || '已撤回，订单回到草稿')
        this.loadData()
      } else {
        util.showToast(result.msg || '撤回失败')
      }
    } finally {
      this._submitting = false
    }
  }
})
