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
    totalCount: 0
  },

  async onLoad() {
    const now = new Date()
    const today = util.formatDate(now)
    const tmr = new Date(now.getTime() + 86400000)
    const tomorrow = util.formatDate(tmr)

    this.setData({ today, tomorrow, orderDate: today, deliveryDate: tomorrow })
    await this.loadReferenceData()
  },

  async loadReferenceData() {
    const app = getApp()
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')
    const categoryResult = await cloud.callFunction('dataService', { action: 'getCategories', authToken })
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
    const result = await cloud.callFunction('getProducts', { includeInactive: false })
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

    const confirmed = await util.showConfirm(orderStatus === 'draft' ? '确认保存采购草稿？' : '确认提交门店采购申请？')
    if (!confirmed) return

    util.showLoading(orderStatus === 'draft' ? '保存中...' : '提交中...')
    const app = getApp()
    const store = app.globalData.currentStore || {}
    const user = app.globalData.userInfo || {}
    if (!store.storeId && !store.id) {
      util.hideLoading()
      util.showToast('当前未选择门店，请先切换门店')
      return
    }

    const items = allItems.map(item => {
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

    const result = await cloud.callFunction('createPurchaseOrder', {
      storeId: store.storeId || store.id,
      storeName: store.storeName || store.name,
      orderDate: this.data.deliveryDate,
      createdBy: user.userId || user.id || user.name || user.username,
      createdByName: user.name || user.username,
      items,
      remark: this.data.remark,
      orderStatus
    })

    util.hideLoading()
    if (result.code === 0) {
      wx.showModal({
        title: orderStatus === 'draft' ? '草稿已保存' : '提交成功',
        content: orderStatus === 'draft' ? '采购草稿已保存到数据库' : '采购申请已提交，下单报表已自动生成',
        showCancel: false,
        success() { wx.navigateBack() }
      })
    } else {
      util.showToast(result.msg || '提交失败')
    }
  }
})
