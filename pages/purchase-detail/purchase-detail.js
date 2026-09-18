// pages/purchase-detail/purchase-detail.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { detail: { items: [] }, canReceive: false, canEdit: false, canCancel: false },

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
    const canReceive = currentUser.role !== 'chef' && ['approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.orderStatus)
    const canEdit = order.orderStatus === 'draft' && (
      ['super_admin', 'purchaser'].includes(currentUser.role) ||
      order.createdById === (currentUser.userId || currentUser.id)
    )
    // 驳回的单子原样保留，可复制为新草稿改后重提（B7）
    const canCopy = order.orderStatus === 'rejected'
    // B8：已提交待审核的订单，采购员/管理员可作废
    const canCancel = order.orderStatus === 'submitted' && ['purchaser', 'super_admin'].includes(currentUser.role)
    this.setData({
      detail: { ...order, statusText: statusInfo.text, statusType: statusInfo.type },
      canReceive,
      canEdit,
      canCopy,
      canCancel
    })
  },

  // B8：作废已提交订单（仅审批前），需线下通知供应商
  async cancelOrder() {
    const d = this.data.detail
    if (!d.purchaseOrderId) return
    const confirmed = await util.showConfirm('确认作废该采购单？请先线下通知供应商停止备货。')
    if (!confirmed) return
    util.showLoading('作废中...')
    const result = await cloud.callFunction('dataService', {
      action: 'cancelOrder',
      orderId: d.purchaseOrderId,
      reason: '管理员作废（详情页操作）'
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已作废')
      this.loadData()
    } else {
      util.showToast((result && result.msg) || '作废失败')
    }
  },

  editRequest() {
    if (!this.data.detail.purchaseOrderId) return
    wx.navigateTo({ url: '/pages/purchase-create/purchase-create?orderId=' + this.data.detail.purchaseOrderId })
  },

  // 驳回单复制为新草稿：原单保留不动，新开一张草稿供修改后重提（B7）
  async copyToDraft() {
    const d = this.data.detail
    if (!d.purchaseOrderId) return
    const confirmed = await util.showConfirm('将按原单内容复制一张新草稿，原驳回单保留不变。继续？')
    if (!confirmed) return
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
    util.showLoading('复制中...')
    const result = await cloud.callFunction('createPurchaseOrder', {
      storeId: d.storeId,
      storeName: d.storeName,
      orderDate: util.formatDate(new Date()),
      deliveryDate: d.deliveryDate || util.formatDate(new Date()),
      items,
      remark: d.remark || '',
      orderStatus: 'draft'
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已复制为新草稿')
      setTimeout(() => wx.navigateTo({ url: '/pages/purchase-create/purchase-create?orderId=' + (result.data && result.data.orderId) }), 800)
    } else {
      util.showToast((result && result.msg) || '复制失败')
    }
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
  }
})
