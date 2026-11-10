// pages/approval-detail/approval-detail.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const authGuard = require('../../utils/auth-guard')

Page({
  data: {
    detail: {},
    auditRemark: '',
    loadFailed: false
  },

  async onLoad(options = {}) {
    if (!authGuard.requireLogin()) return
    // 清单 #12：审核仅管理员（超管/采购员），其他角色直达页面时拦截
    const me = (getApp().globalData.userInfo || {}).role
    if (!['super_admin', 'purchaser'].includes(me)) {
      util.showToast('仅管理员可审核采购申请')
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.orderId = options.id || options.orderId || ''
    const app = getApp()
    const result = await cloud.callFunction('getPurchaseOrderDetail', {
      orderId: this.orderId,
    })
    if (!result || result.code !== 0) {
      this.setData({ loadFailed: true })
      util.showToast((result && result.msg) || '采购申请加载失败')
      return
    }
    const order = cloud.normalizePurchaseOrder(result.data)
    const detail = {
        ...order,
        requesterName: order.createdBy,
        expectedDeliveryDate: order.deliveryDate || order.orderDate,
        submittedAt: order.submittedAt,
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

  // 加载失败后重试
  async retryLoad() {
    this.setData({ loadFailed: false })
    await this.onLoad({ id: this.orderId, orderId: this.orderId })
  },

  onAuditRemarkInput(e) {
    this.setData({ auditRemark: e.detail.value })
  },

  async approveRequest() {
    if (this._submitting) return
    this._submitting = true
    try {
      // P2-56（2026-11-10 修复）：数量校验前移到确认弹窗之前——
      // 原实现先「确认通过」再提示数量非法，交互顺序错误
      const invalidItem = (this.data.detail.items || []).find(item => !(Number(item.approveQty) > 0))
      if (invalidItem) {
        util.showToast(`「${invalidItem.productName || '商品'}」审批数量必须大于 0`)
        return
      }
      const confirmed = await util.showConfirm('确认通过该采购申请？')
      if (!confirmed) return
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'auditOrder',
        orderId: this.orderId, status: 'approved', items: (this.data.detail.items || []).map(item => ({ itemId: item.itemId, approveQty: item.approveQty }))
      })
      if (result.code === 0) {
        const warning = result.data && result.data.reportWarning
        if (warning) util.showToast(warning); else util.showSuccess('审核通过')
        setTimeout(() => wx.navigateBack(), 800)
      } else util.showToast(result.msg || '审核失败')
    } finally {
      this._submitting = false
    }
  },

  async rejectRequest() {
    if (this._submitting) return
    // P2-58（2026-11-10 修复）：驳回原因先 trim 再判空——纯空格原来被前端放行、后端拒绝
    if (!String(this.data.auditRemark || '').trim()) {
      util.showToast('请填写驳回原因')
      return
    }
    this._submitting = true
    try {
      const confirmed = await util.showConfirm('确认驳回该采购申请？')
      if (!confirmed) return
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'auditOrder',
        orderId: this.orderId, status: 'rejected', auditRemark: this.data.auditRemark, items: []
      })
      if (result.code === 0) { util.showToast('已驳回'); setTimeout(() => wx.navigateBack(), 800) } else util.showToast(result.msg || '审核失败')
    } finally {
      this._submitting = false
    }
  }
})
