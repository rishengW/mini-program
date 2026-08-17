// pages/receive-verify/receive-verify.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    order: {},
    items: [],
    photos: [],
    overallRemark: '',
    isSubmitting: false
  },

  async onLoad(options = {}) {
    const id = options.orderId || options.id
    if (!id) {
      util.showToast('未获取到采购订单，请返回后重试')
      return
    }

    util.showLoading('加载中...')
    const result = await cloud.callFunction('getPurchaseOrderDetail', { orderId: id })
    util.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }
    const order = cloud.normalizePurchaseOrder(result.data)
    if (!Array.isArray(order.items) || order.items.length === 0) {
      util.showToast('订单中没有可验收的商品，请返回后重试')
      return
    }

    const items = order.items.map(item => {
      return {
        ...item,
        productName: item.productNameSnapshot,
        unit: item.unitSnapshot,
        orderQty: item.orderQty,
        receivedQty: item.orderQty,
        priceSnapshot: 0,
        payableFlag: true,
        isShortage: false,
        isQualityIssue: false,
        isWrongItem: false,
        remark: ''
      }
    })
    this.setData({ order, items })
  },

  onReceivedQtyInput(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ [`items[${index}].receivedQty`]: parseFloat(e.detail.value) || 0 })
  },

  toggleCheck(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`items[${index}].${field}`]: !this.data.items[index][field] })
  },

  onItemRemarkInput(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ [`items[${index}].remark`]: e.detail.value })
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 9 - this.data.photos.length,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const newPhotos = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ photos: [...this.data.photos, ...newPhotos] })
      }
    })
  },

  deletePhoto(e) {
    const photos = [...this.data.photos]
    photos.splice(e.currentTarget.dataset.index, 1)
    this.setData({ photos })
  },

  onOverallRemarkInput(e) { this.setData({ overallRemark: e.detail.value }) },

  async submitReceipt() {
    const { order, items, photos, overallRemark, isSubmitting } = this.data
    if (isSubmitting) return
    if (!order.purchaseOrderId) {
      util.showToast('订单信息加载失败，请返回后重试')
      return
    }
    if (!items.length) {
      util.showToast('订单中没有可验收的商品，请返回后重试')
      return
    }

    const app = getApp()
    const currentStore = app.globalData.currentStore || {}
    const user = app.globalData.userInfo || {}
    const storeId = order.storeId || currentStore.storeId || currentStore.id
    const storeName = order.storeName || currentStore.storeName || currentStore.name
    if (!storeId || !storeName) {
      util.showToast('门店信息缺失，请重新登录或切换门店')
      return
    }

    const hasAbnormal = items.some(i => i.isShortage || i.isQualityIssue || i.isWrongItem)
    const msg = hasAbnormal ? '本次验收有异常标记，确认提交？' : '确认提交验收？'
    const confirmed = await util.showConfirm(msg)
    if (!confirmed) return

    this.setData({ isSubmitting: true })
    util.showLoading('提交中...')

    let result
    try {
      const photoFileIds = await cloud.uploadReceiptPhotos(photos, order.purchaseOrderId)
      result = await cloud.callFunction('createReceipt', {
        purchaseOrderId: order.purchaseOrderId,
        storeId,
        storeName,
        receivedBy: user.name || user.username || '',
        overallRemark,
        photoFileIds,
        items: items.map(item => ({
          orderItemId: item.itemId,
          productId: item.productId,
          productName: item.productName || item.productNameSnapshot,
          supplierId: item.supplierId,
          receivedQty: item.receivedQty,
          orderQty: item.orderQty,
          unit: item.unit || item.unitSnapshot,
          priceSnapshot: item.priceSnapshot,
          payableFlag: item.payableFlag,
          isShortage: item.isShortage,
          isQualityIssue: item.isQualityIssue,
          isWrongItem: item.isWrongItem,
          remark: item.remark
        }))
      })
    } catch (err) {
      console.error('[receive-verify] 提交收货验收失败:', err)
      result = { code: -1, msg: '照片上传失败，请检查网络后重试' }
    } finally {
      util.hideLoading()
      this.setData({ isSubmitting: false })
    }

    if (result && result.code === 0) {
      const reportsGenerated = result.data.reportsGenerated || 0
      const hasReportWarning = !!result.data.reportWarning
      const content = hasReportWarning
        ? `收货已保存。${result.data.reportWarning}`
        : `收货已提交，${reportsGenerated}份报表已自动生成。可在报表中心查看。`
      wx.showModal({
        title: '验收完成',
        content,
        confirmText: hasReportWarning ? '返回' : '查看报表',
        cancelText: '返回',
        showCancel: !hasReportWarning,
        success(res) {
          if (res.confirm && !hasReportWarning) {
            wx.switchTab({ url: '/pages/report-list/report-list' })
          } else {
            wx.navigateBack()
          }
        }
      })
    } else {
      util.showToast((result && result.msg) || '收货验收提交失败，请稍后重试')
    }
  }
})
