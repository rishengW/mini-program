// pages/product-manage/product-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    products: [],
    filteredProducts: [],
    activeL1: 'all',
    keyword: '',
    showAdd: false,
    editItem: null,
    form: { name: '', categoryL1: '', categoryL1Name: '', categoryId: '', categoryName: '', unit: '', spec: '', defaultSupplierId: '', supplierName: '', manufacturerName: '默认' },
    categoryL1List: [],
    categories: [],
    filteredCategories: [],
    suppliers: []
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    const app = getApp()
    const [productResult, categoryResult, supplierResult] = await Promise.all([
      cloud.callFunction('getProducts', { includeInactive: true }),
      cloud.callFunction('dataService', { action: 'getCategories' }),
      cloud.callFunction('getSuppliers', { includeInactive: true })
    ])
    if (productResult.code !== 0 || categoryResult.code !== 0 || supplierResult.code !== 0) {
      util.showToast((productResult.code !== 0 ? productResult : categoryResult.code !== 0 ? categoryResult : supplierResult).msg || '商品数据加载失败')
      return
    }
    const categories = categoryResult.data && categoryResult.data.categories || []
    const categoryL1List = categoryResult.data && categoryResult.data.level1 || []
    const suppliers = (supplierResult.data || []).map(cloud.normalizeSupplier)
    const products = (productResult.data || []).map(cloud.normalizeProduct).map(p => {
      const cat = categories.find(c => c.id === p.categoryId)
      const sup = suppliers.find(s => s.supplierId === p.defaultSupplierId)
      return {
        ...p,
        categoryName: cat ? cat.name : '',
        l1Name: (categoryL1List.find(item => item.id === p.categoryL1) || {}).name || p.categoryL1,
        supplierName: sup ? sup.supplierName : '未指定'
      }
    })
    this.setData({
      products,
      categoryL1List,
      categories,
      suppliers
    })
    this.applyFilter()
  },

  switchL1(e) {
    this.setData({ activeL1: e.currentTarget.dataset.value })
    this.applyFilter()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  applyFilter() {
    let list = this.data.products
    if (this.data.activeL1 !== 'all') {
      list = list.filter(p => p.categoryL1 === this.data.activeL1)
    }
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(kw))
    }
    this.setData({ filteredProducts: list })
  },

  showAddForm() {
    const firstL1 = this.data.categoryL1List[0] || {}
    this.setData({
      showAdd: true, editItem: null,
      form: { name: '', categoryL1: firstL1.id || '', categoryL1Name: firstL1.name || '', categoryId: '', categoryName: '', unit: '', spec: '', defaultSupplierId: '', supplierName: '', manufacturerName: '默认' },
      filteredCategories: this.data.categories.filter(c => c.categoryL1 === firstL1.id)
    })
  },

  showEditForm(e) {
    const p = this.data.products.find(x => x.productId === e.currentTarget.dataset.id)
    if (p) {
      this.setData({
        showAdd: true, editItem: p,
        form: { name: p.name, categoryL1: p.categoryL1, categoryL1Name: p.l1Name || '', categoryId: p.categoryId, categoryName: p.categoryName || '', unit: p.unit, spec: p.spec || '', defaultSupplierId: p.defaultSupplierId || '', supplierName: p.defaultSupplierId ? p.supplierName : '', manufacturerName: p.manufacturerName || '默认' },
        filteredCategories: this.data.categories.filter(c => c.categoryL1 === p.categoryL1)
      })
    }
  },

  closeForm() { this.setData({ showAdd: false }) },

  // Prevent clicks inside the modal (including picker controls) from closing it.
  stopBubble() {},

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onL1Change(e) {
    const selected = this.data.categoryL1List[e.detail.value] || {}
    this.setData({
      'form.categoryL1': selected.id || '',
      'form.categoryL1Name': selected.name || '',
      'form.categoryId': '',
      'form.categoryName': '',
      filteredCategories: this.data.categories.filter(c => c.categoryL1 === selected.id)
    })
  },

  onCategoryChange(e) {
    const cats = this.data.filteredCategories
    this.setData({
      'form.categoryId': cats[e.detail.value].id,
      'form.categoryName': cats[e.detail.value].name
    })
  },

  onSupplierChange(e) {
      const supplier = this.data.suppliers[e.detail.value]
      if (supplier) this.setData({ 'form.defaultSupplierId': supplier.supplierId, 'form.supplierName': supplier.supplierName })
  },

  async saveProduct() {
    const { form, editItem } = this.data
    if (!form.name.trim()) return util.showToast('请输入商品名称')
    if (!form.categoryId) return util.showToast('请选择分类')
    if (!form.unit.trim()) return util.showToast('请输入单位')

    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'saveProduct',
      productId: editItem && editItem.productId,
      ...form,
      name: form.name.trim(),
      unit: form.unit.trim()
    })
    if (result.code !== 0) return util.showToast(result.msg || '商品保存失败')
    util.showSuccess(editItem ? '商品已更新' : '商品已添加')
    this.setData({ showAdd: false })
    await this.loadData()
  },

  async toggleStatus(e) {
    const id = e.currentTarget.dataset.id
    const product = this.data.products.find(p => p.productId === id)
    if (!product) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'toggleProduct',
      productId: id
    })
    if (result.code !== 0) return util.showToast(result.msg || '商品状态更新失败')
    util.showSuccess(result.data && result.data.status === 1 ? '已启用' : '已停用')
    await this.loadData()
  }
})
