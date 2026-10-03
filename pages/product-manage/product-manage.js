// pages/product-manage/product-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')
const meta = require('../../utils/meta')

// 用户主动取消的标准返回形如 `chooseMessageFile:fail cancel`（部分基础库带
// "by user" 后缀）。必须严格匹配结尾：宽松的 includes('cancel') 会把"环境不支持"
// 之类的失败也当成取消，从而一个提示都不弹，表现就是点击完全没反应。
function isUserCancel(errMsg) {
  return /fail\s+cancel(\s+by\s+user)?$/i.test(String(errMsg || '').trim())
}

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
    suppliers: [],
    importResult: { show: false, summary: '', lines: [] }
  },

  onShow() {
    if (!authGuard.requireLogin()) return
    this.loadData()
  },

  async loadData() {
    const [productResult, categoryResult, supplierResult] = await Promise.all([
      cloud.callFunction('getProducts', { includeInactive: true }),
      cloud.callFunction('dataService', { action: 'getCategories' }),
      cloud.callFunction('getSuppliers', { includeInactive: true })
    ])
    if (productResult.code !== 0 || categoryResult.code !== 0 || supplierResult.code !== 0) {
      util.showToast((productResult.code !== 0 ? productResult : categoryResult.code !== 0 ? categoryResult : supplierResult).msg || '商品数据加载失败')
      return
    }
    const decorate = c => {
      const base = meta.getCategoryIconBase(c.icon || '')
      return { ...c, iconClass: base ? `icon-${base}-grey` : '', iconClassActive: base ? `icon-${base}-white` : '' }
    }
    const categories = (categoryResult.data && categoryResult.data.categories || []).map(decorate)
    const categoryL1List = (categoryResult.data && categoryResult.data.level1 || []).map(decorate)
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

  // ===== Excel 批量导入 =====
  // wx.chooseMessageFile 只能从微信聊天记录里选文件，开发者工具与 PC 端微信都
  // 不支持：调用下去不会有任何界面反馈（fail 甚至可能带 cancel 字样）。所以在
  // 这里先拦下来主动说清楚去哪里用，而不是把点击交给一个注定静默的 API。
  importEnvBlocker() {
    if (typeof wx.chooseMessageFile !== 'function') return 'unsupported'
    let platform = ''
    try {
      platform = String((wx.getSystemInfoSync() || {}).platform || '').toLowerCase()
    } catch (e) {
      // 取不到平台就按支持处理，交给 fail 分支兜底
    }
    if (platform === 'devtools') return 'devtools'
    if (platform === 'windows' || platform === 'mac') return 'desktop'
    return ''
  },

  chooseImportFile() {
    const blocker = this.importEnvBlocker()
    if (blocker) {
      const where = blocker === 'desktop' ? 'PC 端微信' : '微信开发者工具'
      const how = blocker === 'devtools' ? '（真机预览或体验版均可）' : ''
      wx.showModal({
        title: '当前环境不支持',
        content: `${where}不支持从微信聊天记录选择文件，Excel 导入需在手机上打开小程序使用${how}。可先把 .xlsx 文件发送到任意聊天（如文件传输助手），再在手机上操作。`,
        showCancel: false
      })
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        this.uploadImportFile(file)
      },
      fail: err => {
        // 只有用户主动取消才静默返回；其余任何失败都要给出提示
        if (isUserCancel(err && err.errMsg)) return
        wx.showModal({
          title: '无法选择文件',
          content: `${(err && err.errMsg) || '未知错误'}\n\nExcel 导入需从微信聊天记录中选择文件，请确认在手机上打开小程序后操作。`,
          showCancel: false
        })
      }
    })
  },

  async uploadImportFile(file) {
    if (!/\.xlsx$/i.test(file.name)) return util.showToast('请选择 .xlsx 文件')
    wx.showLoading({ title: '导入中...', mask: true })
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: `imports/products/${Date.now()}_${Math.floor(Math.random() * 1e6)}.xlsx`,
        filePath: file.path
      })
      const result = await cloud.callFunction('importProducts', { fileID: up.fileID })
      wx.hideLoading()
      if (result.code !== 0) return util.showToast(result.msg || '导入失败')
      const d = result.data || {}
      const lines = [`共 ${d.total} 行，成功 ${d.inserted} 条，失败 ${d.failed} 条`]
        .concat((d.errors || []).map(e => `第${e.row}行：${e.msg}`))
      if ((d.warnings || []).length) {
        lines.push('')
        lines.push('以下提示不影响导入：')
        lines.push(...d.warnings.map(e => `第${e.row}行：${e.msg}`))
      }
      this.setData({
        importResult: { show: true, summary: `成功 ${d.inserted} 条 / 失败 ${d.failed} 条`, lines }
      })
      await this.loadData()
    } catch (e) {
      wx.hideLoading()
      util.showToast('导入失败：' + (e.message || '未知错误'))
    }
  },

  closeImportResult() { this.setData({ 'importResult.show': false }) },

  showTemplateInfo() {
    wx.showModal({
      title: '导入模板说明',
      content: '首行列名：商品名称、一级分类、二级分类、单位、规格、厂家/品牌、默认供应商（顺序不限，名称/分类/单位必填）。分类和供应商按名称匹配系统已有数据。',
      showCancel: false
    })
  },

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
    if (this._submitting) return
    const { form, editItem } = this.data
    if (!form.name.trim()) return util.showToast('请输入商品名称')
    if (!form.categoryId) return util.showToast('请选择分类')
    if (!form.unit.trim()) return util.showToast('请输入单位')

    this._submitting = true
    try {
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
    } finally {
      this._submitting = false
    }
  },

  async toggleStatus(e) {
    if (this._submitting) return
    const id = e.currentTarget.dataset.id
    const product = this.data.products.find(p => p.productId === id)
    if (!product) return
    // 启停影响下单可选范围，二次确认防误触
    const disabling = product.status === 1
    const confirmed = await util.showConfirm(disabling
      ? `确认停用商品「${product.name || product.productName}」吗？\n停用后下单不可再选择，历史单据保留`
      : `确认启用商品「${product.name || product.productName}」吗？`)
    if (!confirmed) return
    this._submitting = true
    try {
      const result = await cloud.callFunction('dataService', {
        action: 'toggleProduct',
        productId: id
      })
      if (result.code !== 0) return util.showToast(result.msg || '商品状态更新失败')
      util.showSuccess(result.data && result.data.status === 1 ? '已启用' : '已停用')
      await this.loadData()
    } finally {
      this._submitting = false
    }
  }
})
