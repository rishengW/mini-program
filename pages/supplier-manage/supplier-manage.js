// pages/supplier-manage/supplier-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    suppliers: [],
    keyword: '',
    showAdd: false,
    editItem: null,
    form: { supplierName: '', contactName: '', contactPhone: '', remark: '' }
  },

  onShow() { this.loadData() },

  async loadData() {
    const app = getApp()
    const result = await cloud.callFunction('getSuppliers', {
      includeInactive: true,
      authToken: app.globalData.authToken || wx.getStorageSync('authToken')
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '供应商数据加载失败')
      return
    }
    let list = (result.data || []).map(cloud.normalizeSupplier)
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      list = list.filter(s => s.supplierName.toLowerCase().includes(kw) || (s.contactName || '').toLowerCase().includes(kw))
    }
    this.setData({ suppliers: list })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.loadData()
  },

  showAddForm() {
    this.setData({
      showAdd: true, editItem: null,
      form: { supplierName: '', contactName: '', contactPhone: '', remark: '' }
    })
  },

  showEditForm(e) {
    const s = this.data.suppliers.find(x => x.supplierId === e.currentTarget.dataset.id)
    if (s) {
      this.setData({
        showAdd: true, editItem: s,
        form: { supplierName: s.supplierName, contactName: s.contactName || '', contactPhone: s.contactPhone || '', remark: s.remark || '' }
      })
    }
  },

  closeForm() { this.setData({ showAdd: false }) },

  onFormInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  async saveSupplier() {
    const { form, editItem } = this.data
    if (!form.supplierName.trim()) return util.showToast('请输入供应商名称')

    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'saveSupplier',
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      supplierId: editItem && editItem.supplierId,
      ...form,
      supplierName: form.supplierName.trim()
    })
    if (result.code !== 0) return util.showToast(result.msg || '供应商保存失败')
    util.showSuccess(editItem ? '供应商已更新' : '供应商已添加')
    this.setData({ showAdd: false })
    await this.loadData()
  },

  async toggleStatus(e) {
    const id = e.currentTarget.dataset.id
    const supplier = this.data.suppliers.find(s => s.supplierId === id)
    if (!supplier) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'toggleSupplier',
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
      supplierId: id
    })
    if (result.code !== 0) return util.showToast(result.msg || '供应商状态更新失败')
    util.showSuccess(result.data && result.data.status === 1 ? '已启用' : '已停用')
    await this.loadData()
  },

  goProducts(e) {
    // 跳转到该供应商的商品
    wx.navigateTo({ url: '/pages/price-manage/price-manage?supplierId=' + e.currentTarget.dataset.id })
  }
})
