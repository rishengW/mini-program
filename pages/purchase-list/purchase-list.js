// pages/purchase-list/purchase-list.js
// 分页版：服务端状态筛选 + statusCounts 服务端计数 + 上拉加载 + 下拉刷新
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

const PAGE_SIZE = 20

Page({
  data: {
    activeFilter: 'all',
    filterTabs: [],
    filteredList: [],
    orders: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: true,
    page: 1
  },

  onLoad(options) {
    // 支持从首页带状态参数跳转
    if (options.status) {
      this.setData({ activeFilter: options.status })
    }
  },

  onShow() { this.reload() },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.isLoading || this.data.isLoadingMore || !this.data.hasMore) return
    this.loadData(this.data.page + 1, true)
  },

  reload() {
    this.setData({ page: 1, hasMore: true })
    return this.loadData(1, false)
  },

  async loadData(page, append) {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    this.setData(page === 1 ? { isLoading: true } : { isLoadingMore: true })

    const params = {
      role: user.role || 'purchaser',
      storeId: store.storeId || store.id || '',
      createdBy: user.role === 'chef' ? (user.userId || user.id || user.name || '') : '',
      page,
      pageSize: PAGE_SIZE
    }
    // 状态过滤下推到服务端，翻页时口径一致
    if (this.data.activeFilter !== 'all') params.orderStatus = this.data.activeFilter

    const result = await cloud.callFunction('getPurchaseOrders', params)
    if (!result || result.code !== 0) {
      this.setData({ isLoading: false, isLoadingMore: false })
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const newOrders = (result.data || []).map(cloud.normalizePurchaseOrder)
    const orders = append ? this.data.orders.concat(newOrders) : newOrders
    const total = Number(result.total) || 0
    // tab 计数来自服务端 statusCounts，不受分页截断影响
    const counts = result.statusCounts || {}
    const isGlobal = ['super_admin', 'purchaser'].includes((getApp().globalData.userInfo || {}).role)
    const filterTabs = [
      { label: '全部', value: 'all', count: counts.all || 0 },
      { label: '草稿', value: 'draft', count: counts.draft || 0 },
      { label: '已提交', value: 'submitted', count: counts.submitted || 0 },
      { label: '部分收货', value: 'partial_received', count: counts.partialReceived || 0 },
      { label: '已收货', value: 'received', count: counts.received || 0 },
      { label: '收货异常', value: 'receipt_abnormal', count: counts.receiptAbnormal || 0 },
      { label: '已作废', value: 'cancelled', count: counts.cancelled || 0 }
    ]
    // 待核销 tab 仅管理员可见（清单 #20 催办入口）
    if (isGlobal) {
      filterTabs.push({ label: '待核销', value: 'to_verify', count: counts.toVerify || 0 })
    }
    this.setData({
      filterTabs,
      orders,
      page,
      hasMore: orders.length < total,
      isLoading: false,
      isLoadingMore: false
    })
    this.renderList()
  },

  switchFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.value })
    this.reload()
  },

  renderList() {
    const currentUser = getApp().globalData.userInfo || {}
    const canReceiveRole = currentUser.role !== 'chef'
    const filteredList = this.data.orders.map(o => {
      const statusInfo = meta.getStatusInfo(o.orderStatus)
      const manualCount = o.items.filter(i => i.isManual).length
      // 判断是否可直接收货
      const canReceive = canReceiveRole && ['approved', 'report_generated', 'partial_received', 'to_receive'].includes(o.orderStatus)
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
