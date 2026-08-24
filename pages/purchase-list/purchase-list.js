// pages/purchase-list/purchase-list.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    activeFilter: 'all',
    filterTabs: [],
    filteredList: [],
    orders: [],
    isLoading: false
  },

  onLoad(options) {
    // 支持从首页带状态参数跳转
    if (options.status) {
      this.setData({ activeFilter: options.status })
    }
  },

  onShow() { this.loadData() },

  async loadData() {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    this.setData({ isLoading: true })

    const result = await cloud.callFunction('getPurchaseOrders', {
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      role: user.role || 'purchaser',
      storeId: store.storeId || store.id || '',
      createdBy: user.role === 'chef' ? (user.userId || user.id || user.name || '') : '',
      pageSize: 100
    })
    if (!result || result.code !== 0) {
      this.setData({ isLoading: false })
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const orders = (result.data || []).map(cloud.normalizePurchaseOrder)
    const counts = {
      all: orders.length,
      draft: orders.filter(o => o.orderStatus === 'draft').length,
      submitted: orders.filter(o => o.orderStatus === 'submitted').length,
      received: orders.filter(o => o.orderStatus === 'received').length,
      receiptAbnormal: orders.filter(o => o.orderStatus === 'receipt_abnormal').length
    }
    const filterTabs = [
      { label: '全部', value: 'all', count: 0 },
      { label: '草稿', value: 'draft', count: counts.draft },
      { label: '已提交', value: 'submitted', count: counts.submitted },
      { label: '已收货', value: 'received', count: 0 },
      { label: '收货异常', value: 'receipt_abnormal', count: counts.receiptAbnormal }
    ]
    this.setData({ filterTabs, orders, isLoading: false })
    this.applyFilter()
  },

  switchFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.value })
    this.applyFilter()
  },

  applyFilter() {
    const { activeFilter } = this.data
    const currentUser = getApp().globalData.userInfo || {}
    const canReceiveRole = currentUser.role !== 'chef'
    let list = this.data.orders
    if (activeFilter !== 'all') {
      list = list.filter(o => o.orderStatus === activeFilter)
    }
    const filteredList = list.map(o => {
      const statusInfo = meta.getStatusInfo(o.orderStatus)
      const manualCount = o.items.filter(i => i.isManual).length
      // 判断是否可直接收货
      const canReceive = canReceiveRole && ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive'].includes(o.orderStatus)
      return {
        ...o,
        statusText: statusInfo.text,
        statusType: statusInfo.type,
        itemCount: o.items.length,
        manualCount,
        canReceive,
        timeAgo: util.getRelativeTime(o.createdAt)
      }
    })
    this.setData({ filteredList })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/purchase-detail/purchase-detail?id=' + e.currentTarget.dataset.id })
  },

  goReceive(e) {
    const id = e.currentTarget.dataset.id
    const order = this.data.orders.find(o => o.purchaseOrderId === id)
    if (order) {
      wx.navigateTo({
        url: '/pages/receive-verify/receive-verify?orderId=' + id + '&storeId=' + order.storeId
      })
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/purchase-create/purchase-create' })
  }
})
