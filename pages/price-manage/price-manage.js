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
    newPrice: ''
  },

  onLoad(options) {
    this._initialSupplierId = options.supplierId || ''
  },

  onShow() { this.loadData() },

  async loadData() {
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
  }
})
