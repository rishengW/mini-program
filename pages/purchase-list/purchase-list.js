// pages/purchase-list/purchase-list.js
// 分页版：服务端状态筛选 + 上拉加载 + 下拉刷新
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const authGuard = require('../../utils/auth-guard')
// B5：分页骨架/竞态/setData 追加收敛到公共列表工具（L17/L27）
const { listLifecycle, listFetch } = require('../../utils/list-page')

const PAGE_SIZE = 20

Page({
  data: {
    activeFilter: 'all',
    filterTabs: [],
    orders: [],
    isLoading: false,
    isLoadingMore: false,
    loadFailed: false,
    hasMore: true,
    page: 1
  },

  onLoad(options) {
    if (!authGuard.requireLogin()) return
    // 支持从首页带状态参数跳转
    if (options.status) {
      this.setData({ activeFilter: options.status })
    }
  },

  onShow() {
    // 首页状态卡经全局暂存传入筛选状态（switchTab 不支持 URL 传参）
    const app = getApp()
    if (app.globalData.pendingListFilter) {
      this.setData({ activeFilter: app.globalData.pendingListFilter })
      app.globalData.pendingListFilter = ''
      this.reload()
      return
    }
    // M3（2026-11-13）：与 report-history 同口径——仅空列表时加载，
    // 从详情返回保留翻页位置，不再每次 onShow 全量重拉
    if (this.data.orders.length === 0) this.reload()
  },

  ...listLifecycle('orders'),

  // 分页骨架（竞态/加载态/失败态/hasMore/setData 追加）统一走 listFetch（L17/L27）
  async fetchPage(page, append) {
    const app = getApp()
    const user = app.globalData.userInfo || {}
    const store = app.globalData.currentStore || {}
    const params = {
      role: user.role || 'purchaser',
      storeId: store.storeId || store.id || '',
      createdBy: user.role === 'chef' ? (user.userId || user.id || user.name || '') : '',
      page,
      pageSize: PAGE_SIZE
    }
    // 状态过滤下推到服务端，翻页时口径一致
    if (this.data.activeFilter !== 'all') params.orderStatus = this.data.activeFilter

    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    const filterTabs = [
      { label: '全部', value: 'all' },
      { label: '草稿', value: 'draft' },
      { label: '已提交', value: 'submitted' },
      { label: '待收货', value: 'receivable' },
      { label: '部分收货', value: 'partial_received' },
      { label: '已收货', value: 'received' },
      { label: '收货异常', value: 'receipt_abnormal' },
      { label: '已作废', value: 'cancelled' }
    ]
    // 待核销 tab 仅管理员可见（清单 #20 催办入口）
    if (isGlobal) {
      filterTabs.push({ label: '待核销', value: 'to_verify' })
    }
    await listFetch(page, this, append, {
      fetch: () => cloud.callFunction('getPurchaseOrders', params),
      // M9（2026-11-13）：列表装饰并入 decorate——翻页走 listFetch 路径追加，
      // 不再 renderList 全量重传 filteredList（orders 单份数据，L27 优化生效）
      decorate: o => {
        const order = cloud.normalizePurchaseOrder(o)
        const statusInfo = meta.getStatusInfo(order.orderStatus)
        return {
          ...order,
          statusText: statusInfo.text,
          statusType: statusInfo.type,
          itemCount: order.items.length,
          manualCount: order.items.filter(i => i.isManual).length,
          canReceive: user.role !== 'chef' && ['approved', 'report_generated', 'partial_received'].includes(order.orderStatus),
          timeAgo: util.getRelativeTime(order.createdAt)
        }
      },
      listKey: 'orders',
      failMsg: '采购订单加载失败，请稍后重试',
      extraSetData: () => ({ filterTabs })
    })
  },

  switchFilter(e) {
    const value = e.currentTarget.dataset.value
    if (value === this.data.activeFilter) return  // 重复点击当前 tab 不重置翻页不重拉
    this.setData({ activeFilter: value })
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
