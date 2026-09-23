// pages/supplier-receipts/supplier-receipts.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false
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
    this.loadReceipts(1, false)
  },

  onReachBottom() {
    const { items, total, loading } = this.data
    if (loading || items.length >= total) return
    this.loadReceipts(this.data.page + 1, true)
  },

  async loadReceipts(page, append) {
    if (this.data.loading) return
    this.setData({ loading: true })
    const res = await cloud.callFunction('getSupplierReceipts', {
      page,
      pageSize: this.data.pageSize
    })
    this.setData({ loading: false })
    if (!res || res.code !== 0) {
      util.showToast((res && res.msg) || '收货记录加载失败，请稍后重试')
      return
    }
    const items = (res.data || []).map(item => {
      const receivedQty = Number(item.received_qty) || 0
      const orderQty = Number(item.order_qty_snapshot) || 0
      // 实收与订货不一致或未计价（应付标记关闭）视为异常，红色提示
      // S9：手动商品行（is_manual）0 价为预期行为（金额走凭证核销回填），不标异常
      const abnormal = !item.is_manual && (receivedQty !== orderQty || item.payable_flag === false)
      // S7 拍板：展示异常处理进度与裁决结果，供供货商对账（只读）
      const abnormals = (item.abnormals || []).map(rec => {
        const typeText = { shortage: '短收', quality: '质量问题', wrong_item: '错货' }[rec.type] || rec.type || '异常'
        const statusText = { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' }[rec.status] || rec.status || ''
        const decisionText = rec.payment_decision === 'pay_received'
          ? '裁决：按实收补款'
          : rec.payment_decision === 'reject' ? '裁决：维持不付款' : ''
        return {
          text: `${typeText}（${statusText}）${rec.resolution || ''}${decisionText ? ' ' + decisionText : ''}`,
          done: rec.status === 'resolved' || rec.status === 'closed'
        }
      })
      return {
        ...item,
        receivedQty,
        orderQty,
        priceText: '¥' + (Number(item.price_snapshot) || 0).toFixed(2),
        amountText: '¥' + (Number(item.amount) || 0).toFixed(2),
        abnormal,
        abnormals
      }
    })
    this.setData({
      items: append ? this.data.items.concat(items) : items,
      page,
      total: res.total || 0
    })
  }
})
