// pages/receive-list/receive-list.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { orders: [] },

  async onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    const result = await cloud.callFunction('getPurchaseOrders', {
      role: user.role || 'store_manager',
      storeId: store.storeId || store.id || '',
      createdBy: user.role === 'chef' ? (user.userId || user.id || user.name || '') : '',
      pageSize: 100
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '待收货订单加载失败，请稍后重试')
      return
    }

    // 显示已提交但未收货的采购单
    const orders = (result.data || [])
      .map(cloud.normalizePurchaseOrder)
      .filter(o => ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(o.orderStatus))
      .map(o => {
        const statusInfo = meta.getStatusInfo(o.orderStatus)
        return {
          ...o,
          statusText: statusInfo.text,
          statusType: statusInfo.type,
          itemCount: o.items.length,
          manualCount: o.items.filter(i => i.isManual).length
        }
      })
    this.setData({ orders })
  },

  goVerify(e) {
    wx.navigateTo({ url: '/pages/receive-verify/receive-verify?orderId=' + e.currentTarget.dataset.id })
  }
})
