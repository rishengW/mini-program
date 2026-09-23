// pages/price-manage/price-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    priceList: [],
    allPrices: [],
    suppliers: [],
    supplierOptions: [{ supplierId: '', supplierName: '全部供应商' }],
    selectedSupplierId: '',
    selectedSupplierName: '全部供应商',
    keyword: '',
    showEdit: false,
    editItem: null,
    newPrice: '',
    // 新增价格（首次定价：supplier_product_price 无记录的商品）
    showAdd: false,
    products: [],
    addForm: { supplierId: '', supplierName: '', productId: '', productName: '', price: '' }
  },

  onLoad(options) {
    this._initialSupplierId = options.supplierId || ''
  },

  onShow() { this.loadData() },

  async loadData() {
    const app = getApp()
    const [supplierResult, productResult, priceResult] = await Promise.all([
      cloud.callFunction('getSuppliers', { includeInactive: true }),
      cloud.callFunction('getProducts', { includeInactive: true }),
      cloud.callFunction('getProductPrices', { onlyCurrent: true })
    ])
    if (supplierResult.code !== 0 || productResult.code !== 0 || priceResult.code !== 0) {
      const failed = supplierResult.code !== 0 ? supplierResult : productResult.code !== 0 ? productResult : priceResult
      util.showToast(failed.msg || '价格数据加载失败')
      return
    }
    const suppliers = (supplierResult.data || []).map(cloud.normalizeSupplier)
    const products = (productResult.data || []).map(cloud.normalizeProduct)
    const supplierMap = {}
    const productMap = {}
    suppliers.forEach(item => { supplierMap[item.supplierId] = item })
    products.forEach(item => { productMap[item.productId] = item })
    const allPrices = (priceResult.data || []).map(cloud.normalizePrice).map(price => {
      const product = productMap[price.productId]
      const supplier = supplierMap[price.supplierId]
      return {
        ...price,
        productName: product ? product.name : price.productId,
        productUnit: product ? product.unit : '',
        productCategory: product ? ((product.categoryName || product.categoryL1) || '') : '',
        supplierName: supplier ? supplier.supplierName : price.supplierId
      }
    })
    const selectedSupplierId = this._initialSupplierId || this.data.selectedSupplierId
    const selectedSupplier = supplierMap[selectedSupplierId]
    this._initialSupplierId = ''
    this.setData({
      suppliers,
      products,
      supplierOptions: [{ supplierId: '', supplierName: '全部供应商' }, ...suppliers],
      allPrices,
      selectedSupplierId,
      selectedSupplierName: selectedSupplier ? selectedSupplier.supplierName : (selectedSupplierId || '全部供应商')
    })
    this.applyFilter()
  },

  applyFilter() {
    const { selectedSupplierId, keyword } = this.data
    let list = this.data.allPrices

    if (selectedSupplierId) {
      list = list.filter(p => p.supplierId === selectedSupplierId)
    }

    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter(p => p.productName.toLowerCase().includes(kw))
    }

    // 按供应商名分组排序
    list.sort((a, b) => a.supplierName.localeCompare(b.supplierName))

    this.setData({ priceList: list })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  onSupplierFilter(e) {
    const idx = e.detail.value
    if (idx == 0) {
      this.setData({ selectedSupplierId: '', selectedSupplierName: '全部供应商' })
    } else {
      const sup = this.data.supplierOptions[idx]
      this.setData({ selectedSupplierId: sup.supplierId, selectedSupplierName: sup.supplierName })
    }
    this.applyFilter()
  },

  showEditPrice(e) {
    const item = this.data.priceList.find(p => p.priceId === e.currentTarget.dataset.id)
    if (item) {
      this.setData({ showEdit: true, editItem: item, newPrice: String(item.price) })
    }
  },

  closeEdit() { this.setData({ showEdit: false }) },

  // Prevent clicks inside the modal (including picker controls) from closing it.
  stopBubble() {},

  onPriceInput(e) {
    this.setData({ newPrice: e.detail.value })
  },

  async savePrice() {
    const { editItem, newPrice } = this.data
    const price = parseFloat(newPrice)
    if (isNaN(price) || price <= 0) return util.showToast('请输入有效价格')

    const app = getApp()
    const result = await cloud.callFunction('updateProductPrice', {
      supplierId: editItem.supplierId,
      productId: editItem.productId,
      newPrice: price,
      updatedBy: (app.globalData.userInfo && app.globalData.userInfo.name) || ''
    })

    if (result.code === 0) {
      util.showSuccess('价格已更新')
      this.setData({ showEdit: false })
      await this.loadData()
    } else {
      util.showToast(result.msg || '更新失败')
    }
  },

  // ===== 新增价格（首次定价）=====
  showAddPrice() {
    this.setData({
      showAdd: true,
      addForm: { supplierId: '', supplierName: '', productId: '', productName: '', price: '' }
    })
  },

  closeAdd() { this.setData({ showAdd: false }) },

  onAddSupplierPick(e) {
    const sup = this.data.suppliers[e.detail.value]
    if (sup) this.setData({ 'addForm.supplierId': sup.supplierId, 'addForm.supplierName': sup.supplierName })
  },

  onAddProductPick(e) {
    const product = this.data.products[e.detail.value]
    if (product) this.setData({ 'addForm.productId': product.productId, 'addForm.productName': product.name })
  },

  onAddPriceInput(e) {
    this.setData({ 'addForm.price': e.detail.value })
  },

  async saveNewPrice() {
    const { addForm } = this.data
    if (!addForm.supplierId) return util.showToast('请选择供应商')
    if (!addForm.productId) return util.showToast('请选择商品')
    const price = parseFloat(addForm.price)
    if (isNaN(price) || price <= 0) return util.showToast('请输入有效价格')

    // 已有当前价的组合引导走列表改价，避免重复建行
    const existed = this.data.allPrices.some(p => p.supplierId === addForm.supplierId && p.productId === addForm.productId)
    if (existed) return util.showToast('该供应商已有此商品价格，请在列表中修改')

    const app = getApp()
    const result = await cloud.callFunction('updateProductPrice', {
      supplierId: addForm.supplierId,
      productId: addForm.productId,
      newPrice: price,
      updatedBy: (app.globalData.userInfo && app.globalData.userInfo.name) || ''
    })

    if (result.code === 0) {
      util.showSuccess('价格已添加')
      this.setData({ showAdd: false })
      await this.loadData()
    } else {
      util.showToast(result.msg || '添加失败')
    }
  }
})
