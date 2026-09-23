// pages/purchase-detail/purchase-detail.js
const meta = require('../../utils/meta')
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: { detail: { items: [] }, canReceive: false, canEdit: false, canCancel: false, voucherImages: [] },

  onLoad(options = {}) {
    this.orderId = options.id || options.orderId || ''
    if (!this.orderId) util.showToast('未获取到采购订单，请返回后重试')
  },

  onShow() {
    if (this.orderId) this.loadData()
  },

  async loadData() {
    util.showLoading('加载中...')
    const app = getApp()
    const result = await cloud.callFunction('getPurchaseOrderDetail', {
      orderId: this.orderId,
    })
    util.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '采购订单加载失败，请稍后重试')
      return
    }

    const order = cloud.normalizePurchaseOrder(result.data)
    const statusInfo = meta.getStatusInfo(order.orderStatus)
    const currentUser = app.globalData.userInfo || {}
    // S6：供货商确认状态按供货商分组头展示（待确认/已确认/已发货）。
    // 草稿/驳回/作废单供货商不可见或事已结，不打标签；已完结单与供货商端口径一致记 done。
    const confirmations = result.data.supplier_confirmations || {}
    const showConfirm = !['draft', 'rejected', 'cancelled'].includes(order.orderStatus)
    const isDone = ['received', 'receipt_abnormal', 'completed'].includes(order.orderStatus)
    const confirmTagOf = supplierId => {
      if (!showConfirm || !supplierId) return null
      const status = isDone ? 'done' : ((confirmations[supplierId] || {}).status || 'pending')
      return meta.getSupplierConfirmInfo(status)
    }
    let supplierGroups = null
    if (currentUser.role === 'chef') {
      // chef 不见供应商身份（后端不下发供货商名称）：维持平铺，逐行标签
      order.items = (order.items || []).map(item => {
        const tag = confirmTagOf(item.supplierId)
        if (!tag) return item
        return { ...item, supplierConfirmText: tag.text, supplierConfirmType: tag.type }
      })
    } else {
      const groups = {}
      ;(order.items || []).forEach(item => {
        const sid = item.supplierId || ''
        if (!groups[sid]) {
          const tag = confirmTagOf(sid)
          groups[sid] = {
            supplierId: sid,
            supplierName: item.supplierName || (sid ? sid : '未指定供应商'),
            confirmText: tag ? tag.text : '',
            confirmType: tag ? tag.type : '',
            items: []
          }
        }
        groups[sid].items.push(item)
      })
      supplierGroups = Object.values(groups)
    }
    const canReceive = currentUser.role !== 'chef' && ['approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.orderStatus)
    const canEdit = order.orderStatus === 'draft' && (
      ['super_admin', 'purchaser'].includes(currentUser.role) ||
      order.createdById === (currentUser.userId || currentUser.id)
    )
    // 驳回的单子原样保留，可复制为新草稿改后重提（B7）
    const canCopy = order.orderStatus === 'rejected'
    // B8：已提交待审核的订单，采购员/管理员可作废
    const canCancel = order.orderStatus === 'submitted' && ['purchaser', 'super_admin'].includes(currentUser.role)
    // B8：审批后未收货的订单，非厨师可申请取消（管理员确认后作废）；管理员可直接作废
    const cancelEligible = ['approved', 'report_generated', 'partial_received', 'to_receive'].includes(order.orderStatus)
    const canRequestCancel = cancelEligible && currentUser.role !== 'chef' && !order.cancelRequested
    const canForceCancel = cancelEligible && currentUser.role === 'super_admin'
    // S9（2026-09-22）：手动商品专用单凭证核销
    // 提交凭证：店长/采购员/管理员，收货后可提交；核销裁决：仅管理员
    const isManualOrder = !!order.isManual
    const verifyStatus = order.verifyStatus || ''
    const canSubmitVoucher = isManualOrder &&
      ['store_manager', 'purchaser', 'super_admin'].includes(currentUser.role) &&
      ['received', 'receipt_abnormal', 'partial_received'].includes(order.orderStatus) &&
      ['none', 'rejected'].includes(verifyStatus)
    const canVerify = isManualOrder && verifyStatus === 'pending' &&
      ['purchaser', 'super_admin'].includes(currentUser.role)
    // 凭证图片转临时链接，核销人核对凭证时可见
    let voucherImages = []
    if (order.verifyVoucherFileIds && order.verifyVoucherFileIds.length) {
      voucherImages = await cloud.getFileUrls(order.verifyVoucherFileIds)
    }
    this.setData({
      voucherImages,
      detail: { ...order, statusText: statusInfo.text, statusType: statusInfo.type },
      supplierGroups,
      canReceive,
      canEdit,
      canCopy,
      canCancel,
      canRequestCancel,
      canForceCancel,
      isManualOrder,
      verifyStatus,
      canSubmitVoucher,
      canVerify
    })
  },

  // S9：提交付款凭证（店长/采购员/管理员），上传图片后登记
  async submitVoucher() {
    const that = this
    const res = await new Promise(resolve => {
      wx.chooseMedia({
        count: 3, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: resolve, fail: () => resolve(null)
      })
    })
    if (!res || !res.tempFiles || !res.tempFiles.length) return
    util.showLoading('上传凭证中...')
    try {
      const fileIds = []
      for (let i = 0; i < res.tempFiles.length; i++) {
        const ext = (res.tempFiles[i].tempFilePath.match(/\.\w+$/) || ['jpg'])[0]
        const cloudPath = `vouchers/${this.orderId}/${Date.now()}_${i}${ext}`
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: res.tempFiles[i].tempFilePath })
        fileIds.push(up.fileID)
      }
      const result = await cloud.callFunction('dataService', {
        action: 'verifyManualOrder',
        orderId: this.orderId,
        verifyAction: 'submit',
        voucherFileIds: fileIds
      })
      util.hideLoading()
      if (result && result.code === 0) {
        util.showSuccess('凭证已提交')
        that.loadData()
      } else {
        util.showToast((result && result.msg) || '凭证提交失败')
      }
    } catch (err) {
      util.hideLoading()
      util.showToast('凭证上传失败，请重试')
    }
  },

  // S9：点击放大查看凭证图片
  previewVoucher(e) {
    const idx = e.currentTarget.dataset.index
    wx.previewImage({
      urls: this.data.voucherImages,
      current: this.data.voucherImages[idx]
    })
  },

  // S9：管理员核销——通过回填实付金额 / 驳回重传
  async verifyDecide(e) {
    const approve = e.currentTarget.dataset.approve === true || e.currentTarget.dataset.approve === 'true'
    const d = this.data.detail
    let amount = null
    let note = ''
    if (approve) {
      const input = await util.showPrompt('核销通过将回填实付金额并闭环该单。', '请输入凭证上的实付金额（元）', '确认核销')
      if (input === null) return
      amount = parseFloat(input)
      if (isNaN(amount) || amount <= 0) { util.showToast('请输入有效金额'); return }
    } else {
      const input = await util.showPrompt('确认驳回该凭证？门店需重新提交。', '请填写驳回原因（必填）', '驳回')
      if (input === null) return
      if (!input.trim()) { util.showToast('驳回必须填写原因'); return }
      note = input.trim()
    }
    util.showLoading('处理中...')
    const result = await cloud.callFunction('dataService', {
      action: 'verifyManualOrder',
      orderId: d.purchaseOrderId,
      verifyAction: approve ? 'approve' : 'reject',
      amount: amount || undefined,
      note
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess(approve ? '已核销' : '已驳回')
      this.loadData()
    } else {
      util.showToast((result && result.msg) || '操作失败')
    }
  },

  // B8：审批后订单申请取消（采购员/店长发起，管理员确认后作废），需填写原因
  async requestCancel() {
    const d = this.data.detail
    if (!d.purchaseOrderId) return
    const reason = await util.showPrompt('确认申请取消该采购单？申请将通知管理员确认处理。', '请填写取消原因（必填）', '申请取消')
    if (reason === null) return
    if (!reason.trim()) {
      util.showToast('申请取消必须填写原因')
      return
    }
    util.showLoading('提交申请中...')
    const result = await cloud.callFunction('dataService', {
      action: 'requestCancel',
      orderId: d.purchaseOrderId,
      reason: reason.trim()
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已提交取消申请')
      this.loadData()
    } else {
      util.showToast((result && result.msg) || '申请取消失败')
    }
  },

  // B8：作废已提交订单（仅审批前），需填写原因并线下通知供应商
  async cancelOrder() {
    const d = this.data.detail
    if (!d.purchaseOrderId) return
    const reason = await util.showPrompt('确认作废该采购单？请先线下通知供应商停止备货。', '请填写作废原因（必填）', '管理员作废')
    if (reason === null) return
    if (!reason.trim()) {
      util.showToast('作废必须填写原因')
      return
    }
    util.showLoading('作废中...')
    const result = await cloud.callFunction('dataService', {
      action: 'cancelOrder',
      orderId: d.purchaseOrderId,
      reason: reason.trim()
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已作废')
      this.loadData()
    } else {
      util.showToast((result && result.msg) || '作废失败')
    }
  },

  editRequest() {
    if (!this.data.detail.purchaseOrderId) return
    wx.navigateTo({ url: '/pages/purchase-create/purchase-create?orderId=' + this.data.detail.purchaseOrderId })
  },

  // 驳回单复制为新草稿：原单保留不动，新开一张草稿供修改后重提（B7）
  async copyToDraft() {
    const d = this.data.detail
    if (!d.purchaseOrderId) return
    const confirmed = await util.showConfirm('将按原单内容复制一张新草稿，原驳回单保留不变。继续？')
    if (!confirmed) return
    const items = (d.items || []).map(item => ({
      productId: item.productId,
      productName: item.productNameSnapshot,
      category: item.categorySnapshot,
      unit: item.unitSnapshot,
      supplierId: item.supplierId || null,
      orderQty: item.orderQty,
      isManual: !!item.isManual,
      remark: item.remark || ''
    }))
    util.showLoading('复制中...')
    const result = await cloud.callFunction('createPurchaseOrder', {
      storeId: d.storeId,
      storeName: d.storeName,
      orderDate: util.formatDate(new Date()),
      deliveryDate: d.deliveryDate || util.formatDate(new Date()),
      items,
      remark: d.remark || '',
      orderStatus: 'draft'
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已复制为新草稿')
      setTimeout(() => wx.navigateTo({ url: '/pages/purchase-create/purchase-create?orderId=' + (result.data && result.data.orderId) }), 800)
    } else {
      util.showToast((result && result.msg) || '复制失败')
    }
  },

  async submitRequest() {
    const confirmed = await util.showConfirm('确认提交审核？')
    if (!confirmed) return
    const d = this.data.detail
    const items = (d.items || []).map(item => ({
      productId: item.productId,
      productName: item.productNameSnapshot,
      category: item.categorySnapshot,
      unit: item.unitSnapshot,
      supplierId: item.supplierId || null,
      orderQty: item.orderQty,
      isManual: !!item.isManual,
      remark: item.remark || ''
    }))
    util.showLoading('提交中...')
    const app = getApp()
    const result = await cloud.callFunction('createPurchaseOrder', {
      orderId: d.purchaseOrderId,
      storeId: d.storeId,
      storeName: d.storeName,
      orderDate: d.orderDate,
      deliveryDate: d.deliveryDate,
      createdBy: d.createdById,
      createdByName: d.createdBy,
      items,
      remark: d.remark || '',
      orderStatus: 'submitted'
    })
    util.hideLoading()
    if (result && result.code === 0) {
      util.showSuccess('已提交审核')
      setTimeout(() => wx.navigateBack(), 1000)
    } else {
      util.showToast((result && result.msg) || '提交审核失败')
    }
  },

  goReceive() {
    const d = this.data.detail
    wx.navigateTo({
      url: '/pages/receive-verify/receive-verify?orderId=' + d.purchaseOrderId + '&storeId=' + d.storeId
    })
  }
})
