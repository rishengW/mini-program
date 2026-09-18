// pages/receive-list/receive-list.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { orders: [], receipts: [] },

  async onShow() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    const role = user.role || 'store_manager'
    const storeId = store.storeId || store.id || ''
    const [result, receiptResult] = await Promise.all([
      cloud.callFunction('getPurchaseOrders', {
        role,
        storeId,
        createdBy: role === 'chef' ? (user.userId || user.id || user.name || '') : '',
        pageSize: 100
      }),
      cloud.callFunction('getReceipts', {
        role,
        storeId,
        page: 1,
        pageSize: 5
      })
    ])
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '待收货订单加载失败，请稍后重试')
      return
    }

    // 显示已提交但未收货的采购单
    const orders = (result.data || [])
      .map(cloud.normalizePurchaseOrder)
      .filter(o => ['approved', 'report_generated', 'partial_received', 'to_receive'].includes(o.orderStatus))
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
    if (!receiptResult || receiptResult.code !== 0) {
      // 收货记录加载失败时保留旧数据并提示，不渲染成"没有记录"的假空态
      util.showToast((receiptResult && receiptResult.msg) || '收货记录加载失败')
      this.setData({ orders })
      return
    }
    const receipts = (receiptResult.data || []).map(receipt => ({
      ...receipt,
      receiptId: receipt.receiptId || receipt.receipt_id || '',
      receiptDate: receipt.receiptDate || receipt.receipt_date || '',
      storeName: receipt.storeName || receipt.store_name || '',
      receivedBy: receipt.receivedBy || receipt.received_by || '',
      receiptStatus: receipt.receiptStatus || receipt.receipt_status || '',
      statusText: (receipt.receiptStatus || receipt.receipt_status) === 'abnormal' ? '收货异常' : '已收货',
      statusType: (receipt.receiptStatus || receipt.receipt_status) === 'abnormal' ? 'danger' : 'success',
      items: receipt.items || []
    }))
    this.setData({ orders, receipts })
  },

  async onPullDownRefresh() {
    await this.onShow()
    wx.stopPullDownRefresh()
  },

  goVerify(e) {
    wx.navigateTo({ url: '/pages/receive-verify/receive-verify?orderId=' + e.currentTarget.dataset.id })
  }
})
