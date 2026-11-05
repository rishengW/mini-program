// pages/approval-list/approval-list.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const meta = require('../../utils/meta')
const authGuard = require('../../utils/auth-guard')

Page({
  data: { list: [], loadFailed: false },

  async onShow() {
    if (!authGuard.requireLogin()) return
    // 清单 #12：审核仅管理员（超管/采购员），其他角色直达页面时拦截
    const me = (getApp().globalData.userInfo || {}).role
    if (!['super_admin', 'purchaser'].includes(me)) {
      util.showToast('仅管理员可审核采购申请')
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    const result = await cloud.callFunction('getPurchaseOrders', {
      role: user.role || 'purchaser',
      storeId: store.storeId || '',
      createdBy: '',
      pageSize: 100
    })
    if (!result || result.code !== 0) {
      // 失败态置位，避免页面渲染成"暂无待审核申请"误导无数据
      this.setData({ loadFailed: true })
      util.showToast((result && result.msg) || '审核列表加载失败')
      return
    }
    this.setData({ loadFailed: false })
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
          statusText: statusInfo.text,
          // 与 approval-detail 一致：快照字段重命名为列表模板所用字段
          items: (o.items || []).map(item => ({
            ...item,
            productName: item.productNameSnapshot,
            requestedQty: item.orderQty
          })),
          // 清单 #21：手动单显式标识（特殊审批：不核协议价，核销走凭证回填）
          isManual: o.isManual
        }
      })
    this.setData({ list })
  },

  async onPullDownRefresh() {
    await this.onShow()
    wx.stopPullDownRefresh()
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/approval-detail/approval-detail?id=' + e.currentTarget.dataset.id })
  },

  async approveRequest(e) {
    if (this._submitting) return
    this._submitting = true
    try {
      const confirmed = await util.showConfirm('确认通过该采购申请？')
      if (!confirmed) return
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'auditOrder',
        orderId: e.currentTarget.dataset.id, status: 'approved', items: []
      })
      if (result.code === 0) {
        const warning = result.data && result.data.reportWarning
        if (warning) util.showToast(warning); else util.showSuccess('已通过')
        this.onShow()
      } else util.showToast(result.msg || '审核失败')
    } finally {
      this._submitting = false
    }
  },

  // 驳回原因输入（editable modal，与 abnormal-list 的 promptResolution 同模式）。
  // 与服务端 auditOrder「驳回必须填原因」及 approval-detail 的输入框口径一致——
  // 此前快速驳回硬编码「审核驳回」，下单人拿不到真实原因（2026-11-05 修复）
  promptRejectReason() {
    return new Promise(resolve => {
      wx.showModal({
        title: '填写驳回原因',
        editable: true,
        placeholderText: '请输入驳回原因（必填）',
        success: res => resolve(res.confirm ? String(res.content || '').trim() : '')
      })
    })
  },

  async rejectRequest(e) {
    if (this._submitting) return
    const remark = await this.promptRejectReason()
    if (!remark) return  // 取消或未填原因：不驳回
    this._submitting = true
    try {
      const confirmed = await util.showConfirm('确认驳回该采购申请？')
      if (!confirmed) return
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'auditOrder',
        orderId: e.currentTarget.dataset.id, status: 'rejected', auditRemark: remark, items: []
      })
      if (result.code === 0) { util.showToast('已驳回'); this.onShow() } else util.showToast(result.msg || '审核失败')
    } finally {
      this._submitting = false
    }
  }
})
