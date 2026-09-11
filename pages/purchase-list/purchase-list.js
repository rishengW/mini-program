// pages/purchase-list/purchase-list.js
// 重写：筛选与统计由服务端完成（getPurchaseOrders），支持真分页与下拉刷新
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

const PAGE_SIZE = 20
const TO_RECEIVE_STATUS = ['submitted', 'approved', 'report_generated', 'partial_received', 'to_receive']

Page({
  data: {
    activeFilter: 'all',
    filterTabs: [
      { label: '全部', value: 'all', count: 0 },
      { label: '草稿', value: 'draft', count: 0 },
      { label: '已提交', value: 'submitted', count: 0 },
      { label: '待收货', value: 'to_receive', count: 0 },
      { label: '已收货', value: 'received', count: 0 }
    ],
    filteredList: [],
    orders: [],
    isLoading: false,
    page: 1,
    hasMore: false
  },

  onLoad() {
    this._requestSeq = 0
  },

  onShow() {
    // 消费首页带过来的筛选状态（switchTab 无法传参，避免与普通展示重复加载）
    const app = getApp()
    const pendingStatus = app.globalData.pendingPurchaseStatus
    if (pendingStatus) {
      app.globalData.pendingPurchaseStatus = ''
      if (pendingStatus !== this.data.activeFilter) {
        this.setData({ activeFilter: pendingStatus })
      }
    }
    this.loadOrders(1)
  },

  buildQueryParams(page) {
    const app = getApp()
    const params = {
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      page,
      pageSize: PAGE_SIZE
    }
    const filter = this.data.activeFilter
    if (filter === 'draft' || filter === 'submitted' || filter === 'received') {
      params.orderStatus = filter
    } else if (filter === 'to_receive') {
      params.orderStatusList = TO_RECEIVE_STATUS
    }
    // 'all'：不传状态条件
    return params
  },

  async loadOrders(page) {
    const requestId = ++this._requestSeq
    this.setData({ isLoading: true })
    const result = await cloud.callFunction('getPurchaseOrders', this.buildQueryParams(page))
    if (requestId !== this._requestSeq) return // 已有更新的请求，丢弃过期响应

    if (!result || result.code !== 0) {
      this.setData({ isLoading: false })
      wx.stopPullDownRefresh()
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const incoming = (result.data || []).map(cloud.normalizePurchaseOrder).map(order => this.decorateOrder(order))
    const orders = page === 1 ? incoming : this.data.orders.concat(incoming)
    // tab 徽标使用服务端统计（契约：{ all, draft, submitted, to_receive, received }）
    const counts = { all: 0, draft: 0, submitted: 0, to_receive: 0, received: 0, ...(result.statusCounts || {}) }
    if (!result.statusCounts && typeof result.total === 'number') counts.all = result.total
    const filterTabs = this.data.filterTabs.map(tab => ({ ...tab, count: counts[tab.value] || 0 }))
    const total = typeof result.total === 'number' ? result.total : orders.length

    this.setData({
      orders,
      filteredList: orders, // 筛选已在服务端完成
      filterTabs,
      page,
      hasMore: orders.length < total,
      isLoading: false
    })
    wx.stopPullDownRefresh()
  },

  decorateOrder(order) {
    const statusInfo = meta.getStatusInfo(order.orderStatus)
    const manualCount = order.items.filter(i => i.isManual).length
    // 判断是否可直接收货
    const canReceive = TO_RECEIVE_STATUS.includes(order.orderStatus)
    return {
      ...order,
      statusText: statusInfo.text,
      statusType: statusInfo.type,
      itemCount: order.items.length,
      manualCount,
      canReceive,
      timeAgo: util.getRelativeTime(order.createdAt)
    }
  },

  switchFilter(e) {
    const value = e.currentTarget.dataset.value
    if (value === this.data.activeFilter) return
    this.setData({ activeFilter: value, orders: [], filteredList: [], page: 1, hasMore: false })
    this.loadOrders(1)
  },

  onPullDownRefresh() {
    this.loadOrders(1)
  },

  onReachBottom() {
    if (this.data.isLoading || !this.data.hasMore) return
    this.loadOrders(this.data.page + 1)
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
