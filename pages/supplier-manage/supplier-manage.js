// pages/supplier-manage/supplier-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')

Page({
  data: {
    suppliers: [],
    keyword: '',
    showAdd: false,
    editItem: null,
    form: { supplierName: '', contactName: '', contactPhone: '', remark: '' }
  },

  onShow() {
  if (!authGuard.requireLogin()) return
    this.loadData()
  },

  async loadData() {
    const app = getApp()
    const result = await cloud.callFunction('getSuppliers', {
      includeInactive: true,
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

  // Prevent clicks inside the modal (including picker controls) from closing it.
  stopBubble() {},

  onFormInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  async saveSupplier() {
    if (this._submitting) return
    const { form, editItem } = this.data
    if (!form.supplierName.trim()) return util.showToast('请输入供应商名称')

    this._submitting = true
    try {
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'saveSupplier',
        supplierId: editItem && editItem.supplierId,
        ...form,
        supplierName: form.supplierName.trim()
      })
      if (result.code !== 0) return util.showToast(result.msg || '供应商保存失败')
      util.showSuccess(editItem ? '供应商已更新' : '供应商已添加')
      this.setData({ showAdd: false })
      await this.loadData()
    } finally {
      this._submitting = false
    }
  },

  async toggleStatus(e) {
    if (this._submitting) return
    const id = e.currentTarget.dataset.id
    const supplier = this.data.suppliers.find(s => s.supplierId === id)
    if (!supplier) return
    // 启停影响下单可选范围，二次确认防误触
    const disabling = supplier.status === 1
    const confirmed = await util.showConfirm(disabling
      ? `确认停用供应商「${supplier.supplierName}」吗？\n停用后下单不可再选择，历史单据保留`
      : `确认启用供应商「${supplier.supplierName}」吗？`)
    if (!confirmed) return
    this._submitting = true
    try {
      const app = getApp()
      const result = await cloud.callFunction('dataService', {
        action: 'toggleSupplier',
        supplierId: id
      })
      if (result.code !== 0) return util.showToast(result.msg || '供应商状态更新失败')
      util.showSuccess(result.data && result.data.status === 1 ? '已启用' : '已停用')
      await this.loadData()
    } finally {
      this._submitting = false
    }
  },

  goProducts(e) {
    // 跳转到该供应商的商品
    wx.navigateTo({ url: '/pages/price-manage/price-manage?supplierId=' + e.currentTarget.dataset.id })
  }
})
