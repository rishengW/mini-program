// pages/purchase-list/purchase-list.js
// 分页版：服务端状态筛选 + statusCounts 服务端计数 + 上拉加载 + 下拉刷新
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
      { label: '已收货', value: 'received', count: 0 },
      { label: '收货异常', value: 'receipt_abnormal', count: 0 }
    ],
    filteredList: [],
    orders: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    page: 1
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
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.isLoading || this.data.isLoadingMore || !this.data.hasMore) return
    this.loadOrders(this.data.page + 1, true)
  },

  reload() {
    this.setData({ page: 1, hasMore: true })
    return this.loadOrders(1, false)
  },

  buildQueryParams(page) {
    const params = { page, pageSize: PAGE_SIZE }
    const filter = this.data.activeFilter
    if (filter === 'to_receive') {
      params.orderStatusList = TO_RECEIVE_STATUS
    } else if (filter !== 'all') {
      params.orderStatus = filter
    }
    // 'all'：不传状态条件；角色/门店范围由服务端按登录身份推导
    return params
  },

  async loadOrders(page, append = false) {
    const requestId = ++this._requestSeq
    this.setData(page === 1 ? { isLoading: true } : { isLoadingMore: true })
    const result = await cloud.callFunction('getPurchaseOrders', this.buildQueryParams(page))
    if (requestId !== this._requestSeq) return // 已有更新的请求，丢弃过期响应

    if (!result || result.code !== 0) {
      this.setData({ isLoading: false, isLoadingMore: false })
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const currentUser = getApp().globalData.userInfo || {}
    const canReceiveRole = currentUser.role !== "chef"
    const incoming = (result.data || []).map(cloud.normalizePurchaseOrder).map(order => this.decorateOrder(order, canReceiveRole))
    const orders = append ? this.data.orders.concat(incoming) : incoming
    // tab 计数来自服务端 statusCounts，不受分页截断影响（契约含 partial_received/cancelled）
    const counts = { all: 0, draft: 0, submitted: 0, to_receive: 0, received: 0, receiptAbnormal: 0, partialReceived: 0, cancelled: 0, ...(result.statusCounts || {}) }
    if (!result.statusCounts && typeof result.total === "number") counts.all = result.total
    const filterTabs = [
      { label: "全部", value: "all", count: counts.all || 0 },
      { label: "草稿", value: "draft", count: counts.draft || 0 },
      { label: "已提交", value: "submitted", count: counts.submitted || 0 },
      { label: "待收货", value: "to_receive", count: counts.to_receive || 0 },
      { label: "部分收货", value: "partial_received", count: counts.partialReceived || 0 },
      { label: "已收货", value: "received", count: counts.received || 0 },
      { label: "收货异常", value: "receipt_abnormal", count: counts.receiptAbnormal || 0 },
      { label: "已作废", value: "cancelled", count: counts.cancelled || 0 }
    ]
    const total = typeof result.total === "number" ? result.total : orders.length

    this.setData({
      orders,
      filteredList: orders, // 筛选已在服务端完成
      filterTabs,
      page,
      hasMore: orders.length < total,
      isLoading: false,
      isLoadingMore: false
    })
  },

  decorateOrder(order, canReceiveRole) {
    const statusInfo = meta.getStatusInfo(order.orderStatus)
    const manualCount = order.items.filter(i => i.isManual).length
    // 判断是否可直接收货（chef 无收货权限）
    const canReceive = canReceiveRole && TO_RECEIVE_STATUS.includes(order.orderStatus)
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
    this.setData({ activeFilter: value, orders: [], filteredList: [] })
    this.reload()
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
