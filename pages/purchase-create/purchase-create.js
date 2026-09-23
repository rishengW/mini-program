// pages/purchase-create/purchase-create.js
// 重写：商品直接在列表中输入数量，不再先选有/没有
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')

Page({
  data: {
    // 商品列表（全量展示，直接输入数量）
    categoryL1List: [],
    activeL1: 'kitchen',
    filteredCategories: [],
    activeCategoryId: 1,
    products: [],
    displayProducts: [],
    searchKey: '',
    // 手动商品
    manualItems: [],
    showManualPopup: false,
    manualForm: { name: '', categoryL1: 'kitchen', unit: '', qty: '', remark: '' },
    // 采购信息（商品列表下方）
    orderDate: '',
    deliveryDate: '',
    remark: '',
    today: '',
    tomorrow: '',
    // 汇总
    totalCount: 0,
    // 提交防重入：confirm 弹窗期间双击会并发创建两张订单
    isSubmitting: false
  },

  async onLoad(options = {}) {
    this.editingOrderId = options.orderId || options.id || ''
    this.manualOrderId = '' // 拆单时已建的手动商品专用单号，重试/再保存时沿用避免重复建单
    this.catalogOrderId = '' // 拆单时已建的档案商品单号：手动单失败重试时复用，避免档案单重复创建
    // 已建档案单是否已提交：已提交的单后端拒绝再编辑（仅接受 draft），
    // 此后本页新选的档案商品属追加采购，需独立成单
    this.catalogOrderSubmitted = false
    this.catalogSeq = 1 // 档案单幂等子键序号：首单 :c，追加采购递增 :c2/:c3，防命中首单导致本轮商品被静默丢弃
    // 幂等键：整单成功后重置；失败重试保持不变，服务端据此查重防超时重复建单
    this.requestId = 'REQ' + Date.now() + Math.random().toString(36).slice(2, 8)
    const now = new Date()
    const today = util.formatDate(now)
    const tmr = new Date(now.getTime() + 86400000)
    const tomorrow = util.formatDate(tmr)

    this.setData({ today, tomorrow, orderDate: today, deliveryDate: tomorrow })
    await this.loadReferenceData()
    if (this.editingOrderId) await this.loadExistingOrder()
  },

  async loadExistingOrder() {
    util.showLoading('加载草稿...')
    const app = getApp()
    const result = await cloud.callFunction('getPurchaseOrderDetail', {
      orderId: this.editingOrderId,
    })
    util.hideLoading()
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '草稿加载失败')
      return
    }
    const order = cloud.normalizePurchaseOrder(result.data)
    if (order.orderStatus !== 'draft') {
      util.showToast('只有草稿订单可以编辑')
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    // 与服务端 createPurchaseOrder 的草稿编辑口径一致：仅创建者本人
    // （或全局角色）可编辑。店长对他人草稿只读，在这里挡在门外，
    // 而不是等保存时才被后端 403 拒绝。
    const currentUser = app.globalData.userInfo || {}
    const isGlobalRole = ['super_admin', 'purchaser'].includes(currentUser.role)
    if (!isGlobalRole && order.createdById !== (currentUser.userId || currentUser.id)) {
      util.showToast('仅创建者本人可编辑该草稿')
      setTimeout(() => wx.navigateBack(), 600)
      return
    }

    const qtyMap = {}
    const manualItems = []
    const sourceItems = order.items || []
    sourceItems.forEach((item, index) => {
      if (item.isManual) {
        const categoryText = item.categorySnapshot || ''
        const categoryL1 = /前厅|front/i.test(categoryText) ? 'front' : 'kitchen'
        manualItems.push({
          tempId: item.productId || item.itemId || ('MANUAL_' + index),
          name: item.productNameSnapshot || '',
          categoryL1,
          unit: item.unitSnapshot || '',
          qty: Number(item.orderQty) || 1,
          remark: item.remark || '',
          isManual: true
        })
      } else if (item.productId) {
        qtyMap[item.productId] = Number(item.orderQty) || 0
      }
    })
    this._qtyMap = qtyMap
    this.setData({
      orderDate: order.orderDate || this.data.orderDate,
      deliveryDate: order.deliveryDate || order.orderDate || this.data.deliveryDate,
      remark: order.remark || '',
      manualItems
    })
    this.filterProducts()
    this._updateTotal()
  },

  async loadReferenceData() {
    const app = getApp()
    const categoryResult = await cloud.callFunction('dataService', { action: 'getCategories' })
    if (!categoryResult || categoryResult.code !== 0) {
      util.showToast((categoryResult && categoryResult.msg) || '分类数据加载失败')
      return
    }
    const categoryData = categoryResult.data || {}
    const categoryL1List = categoryData.level1 || []
    const categories = categoryData.categories || []
    const activeL1 = categoryL1List.some(item => item.id === this.data.activeL1)
      ? this.data.activeL1
      : (categoryL1List[0] && categoryL1List[0].id) || ''
    this.setData({ categoryL1List, categories, activeL1 })
    this.updateFilteredCategories()
    await this.loadProducts()
  },

  async loadProducts() {
    const app = getApp()
    const result = await cloud.callFunction('getProducts', {
      includeInactive: false,
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '商品数据加载失败')
      this.setData({ displayProducts: [] })
      return
    }
    const products = (result.data || []).map(cloud.normalizeProduct)
    this.setData({ products })
    this.filterProducts()
  },

  // ========== 分类切换 ==========
  switchL1(e) {
    this.setData({ activeL1: e.currentTarget.dataset.id, searchKey: '' })
    this.updateFilteredCategories()
    this.filterProducts()
  },

  updateFilteredCategories() {
    const filtered = this.data.categories.filter(c => c.categoryL1 === this.data.activeL1)
    const firstId = filtered.length > 0 ? filtered[0].id : null
    this.setData({ filteredCategories: filtered, activeCategoryId: firstId })
  },

  selectCategory(e) {
    this.setData({ activeCategoryId: e.currentTarget.dataset.id, searchKey: '' })
    this.filterProducts()
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value })
    this.filterProducts()
  },

  filterProducts() {
    const { activeL1, activeCategoryId, searchKey } = this.data
    let list
    if (searchKey) {
      const key = searchKey.toLowerCase()
      list = (this.data.products || []).filter(p => p.categoryL1 === activeL1 && p.name.toLowerCase().includes(key))
    } else {
      list = (this.data.products || []).filter(p => p.categoryL1 === activeL1 && p.categoryId === activeCategoryId)
    }
    // 保留已输入的数量
    const displayProducts = list.map(p => {
      const existing = this._qtyMap ? this._qtyMap[p.productId] : undefined
      return {
        ...p,
        qty: existing !== undefined ? existing : 0,
        manufacturerName: p.manufacturerName || '默认'
      }
    })
    this.setData({ displayProducts })
    this._updateTotal()
  },

  // ========== 数量操作（直接在列表中） ==========
  onProductQtyInput(e) {
    const idx = e.currentTarget.dataset.index
    const val = parseFloat(e.detail.value) || 0
    if (!this._qtyMap) this._qtyMap = {}
    const pid = this.data.displayProducts[idx].productId
    this._qtyMap[pid] = val
    this.setData({ [`displayProducts[${idx}].qty`]: val })
    this._updateTotal()
  },

  increaseProductQty(e) {
    const idx = e.currentTarget.dataset.index
    const p = this.data.displayProducts[idx]
    const newQty = (p.qty || 0) + 1
    if (!this._qtyMap) this._qtyMap = {}
    this._qtyMap[p.productId] = newQty
    this.setData({ [`displayProducts[${idx}].qty`]: newQty })
    this._updateTotal()
  },

  decreaseProductQty(e) {
    const idx = e.currentTarget.dataset.index
    const p = this.data.displayProducts[idx]
    const newQty = Math.max(0, (p.qty || 0) - 1)
    if (!this._qtyMap) this._qtyMap = {}
    this._qtyMap[p.productId] = newQty
    this.setData({ [`displayProducts[${idx}].qty`]: newQty })
    this._updateTotal()
  },

  _updateTotal() {
    const qtyMap = this._qtyMap || {}
    let count = Object.values(qtyMap).filter(v => v > 0).length
    count += this.data.manualItems.length
    this.setData({ totalCount: count })
  },

  // ========== 手动商品 ==========
  showManualForm() {
    if (this.data.manualItems.length >= 5) {
      util.showToast('手动商品每单最多5个')
      return
    }
    this.setData({
      showManualPopup: true,
      manualForm: { name: '', categoryL1: 'kitchen', unit: '', qty: '', remark: '' }
    })
  },
  hideManualForm() { this.setData({ showManualPopup: false }) },
  preventBubble() {},

  onManualInput(e) {
    this.setData({ [`manualForm.${e.currentTarget.dataset.field}`]: e.detail.value })
  },
  setManualCategory(e) {
    this.setData({ 'manualForm.categoryL1': e.currentTarget.dataset.cat })
  },
  confirmManual() {
    const { name, categoryL1, unit, qty, remark } = this.data.manualForm
    if (!name.trim()) { util.showToast('请输入商品名称'); return }
    if (!unit.trim()) { util.showToast('请输入单位'); return }
    if (!qty || parseFloat(qty) <= 0) { util.showToast('请输入有效数量'); return }
    const item = {
      tempId: 'MANUAL_' + Date.now(),
      name: name.trim(), categoryL1, unit: unit.trim(),
      qty: parseFloat(qty), remark: remark.trim(), isManual: true
    }
    const manualItems = [...this.data.manualItems, item]
    this.setData({ manualItems, showManualPopup: false })
    this._updateTotal()
    util.showSuccess('已添加')
  },

  // 手动商品数量操作
  increaseManualQty(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`manualItems[${idx}].qty`]: this.data.manualItems[idx].qty + 1 })
  },
  decreaseManualQty(e) {
    const idx = e.currentTarget.dataset.index
    if (this.data.manualItems[idx].qty > 1) {
      this.setData({ [`manualItems[${idx}].qty`]: this.data.manualItems[idx].qty - 1 })
    }
  },
  onManualQtyInput(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`manualItems[${idx}].qty`]: parseFloat(e.detail.value) || 1 })
  },
  removeManualItem(e) {
    const items = [...this.data.manualItems]
    items.splice(e.currentTarget.dataset.index, 1)
    this.setData({ manualItems: items })
    this._updateTotal()
  },

  // ========== 表单 ==========
  onOrderDateChange(e) { this.setData({ orderDate: e.detail.value }) },
  onDeliveryDateChange(e) { this.setData({ deliveryDate: e.detail.value }) },
  onRemarkInput(e) { this.setData({ remark: e.detail.value }) },

  // ========== 提交 ==========
  async saveDraft() { return this._saveOrder('draft') },

  async submitRequest() { return this._saveOrder('submitted') },

  async _saveOrder(orderStatus) {
    if (this.data.isSubmitting) return
    if (!this.data.deliveryDate) { util.showToast('请选择到货日期'); return }

    // 收集数量>0的库存商品
    const qtyMap = this._qtyMap || {}
    const selectedProducts = []
    Object.keys(qtyMap).forEach(pid => {
      if (qtyMap[pid] > 0) {
        const p = (this.data.products || []).find(x => x.productId === pid)
        if (p) selectedProducts.push({ ...p, qty: qtyMap[pid] })
      }
    })

    const allItems = [...selectedProducts, ...this.data.manualItems]
    if (allItems.length === 0) { util.showToast('请至少填写一种商品的数量'); return }

    // S9 拍板（2026-09-22 升级）：自动拆单——同时选了档案商品与手动商品时，
    // 自动生成两张采购单（档案单 + 手动单），无需用户分开下单。
    const hasManual = this.data.manualItems.length > 0
    const hasCatalog = selectedProducts.length > 0

    const app = getApp()
    const store = app.globalData.currentStore || {}
    const user = app.globalData.userInfo || {}
    if (!store.storeId && !store.id) {
      util.showToast('当前未选择门店，请先切换门店')
      return
    }

    const buildPayload = (items, orderId, reqSuffix = '') => ({
      storeId: store.storeId || store.id,
      storeName: store.storeName || store.name,
      orderId,
      orderDate: this.data.orderDate,
      deliveryDate: this.data.deliveryDate,
      createdBy: user.userId || user.id || user.name || user.username,
      createdByName: user.name || user.username,
      items,
      remark: this.data.remark,
      orderStatus,
      // 幂等键：本次进入页面的一次「保存/提交」动作内所有请求共用（含失败重试），
      // 服务端按 request_id 查重，请求超时后重试不会重复建单。
      // 拆单时档案单/手动单各带 :c/:m 子键，避免两笔请求在服务端互相误判为重复
      requestId: this.requestId + reqSuffix
    })

    const confirmed = await util.showConfirm(orderStatus === 'draft' ? '确认保存采购草稿？' : '确认提交门店采购申请？')
    if (!confirmed) return

    this.setData({ isSubmitting: true })
    util.showLoading(hasManual && hasCatalog ? '拆单提交中...' : orderStatus === 'draft' ? '保存中...' : '提交中...')

    const toPayloadItems = list => list.map(item => {
      const l1 = (this.data.categoryL1List || []).find(c => c.id === item.categoryL1)
      const catL1Name = l1 ? l1.name : item.categoryL1
      const cat2 = (this.data.categories || []).find(c => c.id === item.categoryId)
      const catName = cat2 ? `${catL1Name}-${cat2.name}` : catL1Name
      return {
        productId: item.productId || item.tempId,
        productName: item.name,
        category: catName,
        unit: item.unit,
        supplierId: item.defaultSupplierId || item.supplierId || null,
        orderQty: item.qty,
        isManual: !!item.isManual,
        remark: item.remark || ''
      }
    })

    let result
    if (hasManual && hasCatalog) {
      // 自动拆单：先提/更新档案商品单（沿用草稿单号），成功后再新建手动商品专用单。
      // catalogOrderId 仅草稿状态可复用：已提交的档案单后端拒绝再编辑，
      // 本轮新选的档案商品按追加采购新建单，幂等子键递增（:c2/:c3）——
      // 沿用 :c 会幂等命中首单，本轮商品被静默丢弃
      const catalogReusable = !this.catalogOrderSubmitted
      const catalogId = this.editingOrderId || (catalogReusable ? this.catalogOrderId || undefined : undefined)
      const catalogSuffix = catalogReusable ? ':c' : ':c' + (++this.catalogSeq)
      const catalogResult = await cloud.callFunction('createPurchaseOrder', buildPayload(toPayloadItems(selectedProducts), catalogId, catalogSuffix))
      if (!catalogResult || catalogResult.code !== 0) {
        util.hideLoading()
        this.setData({ isSubmitting: false })
        util.showToast((catalogResult && catalogResult.msg) || '采购单提交失败')
        return
      }
      // 档案单已落库：记录其单号（手动单失败重试时复用，防止重复建档案单），
      // 清空编辑草稿号与档案商品数量，此后本页重试都只针对手动单
      const catalogOrderNo = (catalogResult.data && catalogResult.data.orderId) || catalogId || ''
      if (catalogOrderNo) this.catalogOrderId = catalogOrderNo
      this.catalogOrderSubmitted = orderStatus === 'submitted'
      this.editingOrderId = ''
      this._qtyMap = {}
      this.filterProducts()
      const manualResult = await cloud.callFunction('createPurchaseOrder', buildPayload(toPayloadItems(this.data.manualItems), this.manualOrderId || undefined, ':m'))
      if (!manualResult || manualResult.code !== 0) {
        util.hideLoading()
        this.setData({ isSubmitting: false })
        const reason = (manualResult && manualResult.msg) || '未知错误'
        wx.showModal({
          title: '部分提交成功',
          content: orderStatus === 'draft'
            ? `商品草稿已保存（${catalogOrderNo}），但手动商品草稿保存失败（${reason}）。手动商品仍保留在本页，直接再次点击「存草稿」即可，不会重复创建商品草稿。`
            : `商品采购单已提交（${catalogOrderNo}），但手动商品单提交失败（${reason}）。手动商品仍保留在本页，直接再次点击「提交」即可，不会重复创建商品采购单。`,
          showCancel: false
        })
        return
      }
      this.manualOrderId = (manualResult.data && manualResult.data.orderId) || ''
      const warnings = [catalogResult.data && catalogResult.data.reportWarning, manualResult.data && manualResult.data.reportWarning].filter(Boolean)
      result = { code: 0, data: { ...(catalogResult.data || {}), splitOrder: true, reportWarning: warnings.join('；') || undefined } }
    } else {
      // 拆单部分失败后的重试 / 纯手动单再次保存：沿用已建手动单号，避免重复建单。
      // 纯手动单沿用 :m 子键，与拆单时的手动请求同一幂等键，超时重试可被服务端查重
      const reuseId = this.editingOrderId || this.manualOrderId || undefined
      const retrySuffix = hasManual && !hasCatalog ? ':m' : ''
      result = await cloud.callFunction('createPurchaseOrder', buildPayload(toPayloadItems(allItems), reuseId, retrySuffix))
    }

    util.hideLoading()
    this.setData({ isSubmitting: false })
    if (result.code === 0) {
      // 整单成功：重置幂等键，用户若在同一页面发起下一笔新订单不会误命中本次记录
      this.requestId = 'REQ' + Date.now() + Math.random().toString(36).slice(2, 8)
      const warning = result.data && result.data.reportWarning
      wx.showModal({
        title: orderStatus === 'draft' ? '草稿已保存' : '提交成功',
        content: warning
          ? warning
          : (result.data && result.data.splitOrder
              ? '已自动拆为两张采购单：商品采购单 + 手动商品专用单（手动单金额待凭证核销）'
              : (orderStatus === 'draft' ? '采购草稿已保存到数据库' : '采购申请已提交，下单报表已自动生成')),
        showCancel: false,
        success() { wx.navigateBack() }
      })
    } else {
      util.showToast(result.msg || '提交失败')
    }
  }
})
