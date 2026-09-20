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
      hasAbnormal: (receipt.receiptStatus || receipt.receipt_status) === 'abnormal',
      statusText: (receipt.receiptStatus || receipt.receipt_status) === 'abnormal' ? '收货异常' : '已收货',
      statusType: (receipt.receiptStatus || receipt.receipt_status) === 'abnormal' ? 'danger' : 'success',
      // 清单 #7：报表生成失败的收货单带缺报表标记
      missingReports: !!receipt.missing_reports,
      photoCount: (receipt.photo_file_ids || []).length,
      items: receipt.items || []
    }))
    this.setData({ orders, receipts, canRegenerate: ['purchaser', 'super_admin'].includes(user.role) })
  },

  // 照片回显：按 fileID 换临时链接后全屏预览（临时链接约 2 小时有效，每次现取不缓存）
  async previewReceiptPhotos(e) {
    const index = e.currentTarget.dataset.index
    const receipt = this.data.receipts[index]
    if (!receipt) return
    const fileIds = receipt.photo_file_ids || []
    if (!fileIds.length) return
    util.showLoading('加载照片...')
    const urls = await cloud.getFileUrls(fileIds)
    wx.hideLoading()
    if (!urls.length) {
      util.showToast('照片加载失败，请稍后重试')
      return
    }
    wx.previewImage({ current: urls[0], urls })
  },

  async onPullDownRefresh() {
    await this.onShow()
    wx.stopPullDownRefresh()
  },

  goVerify(e) {
    wx.navigateTo({ url: '/pages/receive-verify/receive-verify?orderId=' + e.currentTarget.dataset.id })
  },

  // B5 异常处理完成后的补结算入口（仅管理员/采购员后端校验）
  async settleReceipt(e) {
    const receiptId = e.currentTarget.dataset.id
    if (!receiptId) return
    const confirmed = await util.showConfirm('确认对该收货单执行补结算？将按当前可付款明细生成补充账单。')
    if (!confirmed) return
    util.showLoading('补结算中...')
    const result = await cloud.callFunction('dataService', {
      action: 'settleReceipt',
      receiptId
    })
    wx.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '补结算失败')
      return
    }
    util.showSuccess('补结算完成，已生成补充账单')
  },

  // 清单 #7：报表生成失败后，管理员手动补生成（后端仅 purchaser/super_admin）
  async regenerateReports(e) {
    const receiptId = e.currentTarget.dataset.id
    if (!receiptId) return
    const confirmed = await util.showConfirm('确认补生成该收货单的全部报表？将按收货明细重新生成四类报表。')
    if (!confirmed) return
    util.showLoading('补生成中...')
    const result = await cloud.callFunction('dataService', {
      action: 'regenerateReceiptReports',
      receiptId
    })
    wx.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '补生成失败')
      return
    }
    util.showSuccess('补生成完成')
    await this.onShow()
  }
})
