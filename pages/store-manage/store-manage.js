// pages/store-manage/store-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')

Page({
  data: {
    stores: [],
    showForm: false,
    editItem: null, // 编辑时传原门店；新增为 null
    form: { storeName: '' }
  },

  onShow() {
  if (!authGuard.requireLogin()) return
    this.loadData()
  },

  async loadData() {
    util.showLoading()
    // 管理页需含停用门店，否则停用后 UI 上无法恢复
    const res = await cloud.callFunction('authService', { action: 'getStores', includeInactive: 1 })
    util.hideLoading()
    if (res && res.code === 0) {
      this.setData({ stores: res.data || [] })
    } else {
      util.showToast((res && res.msg) || '门店加载失败，请稍后重试')
    }
  },

  showAddForm() {
    this.setData({ showForm: true, editItem: null, form: { storeName: '' } })
  },

  showEditForm(e) {
    const item = e.currentTarget.dataset.item
    this.setData({
      showForm: true,
      editItem: item,
      form: { storeName: item.storeName || '' }
    })
  },

  closeForm() {
    this.setData({ showForm: false, editItem: null })
  },

  onStoreNameInput(e) {
    this.setData({ 'form.storeName': e.detail.value })
  },

  stopBubble() {},

  async saveStore() {
    if (this._submitting) return
    const { form, editItem } = this.data
    const storeName = form.storeName.trim()
    if (!storeName) return util.showToast('请输入门店名称')

    this._submitting = true
    try {
      util.showLoading()
      let res
      if (editItem) {
        res = await cloud.callFunction('authService', {
          action: 'updateStore',
          storeId: editItem.storeId,
          storeName
        })
      } else {
        res = await cloud.callFunction('authService', {
          action: 'createStore',
          storeName
        })
      }
      util.hideLoading()

      if (res && res.code === 0) {
        util.showSuccess(editItem ? '保存成功' : '门店已创建')
        this.closeForm()
        this.loadData()
      } else {
        util.showToast((res && res.msg) || '保存失败，请稍后重试')
      }
    } finally {
      this._submitting = false
    }
  },

  // 与账号管理一致：停用=软删除，历史单据与账号关联保留，可再启用
  async toggleStoreStatus(e) {
    if (this._submitting) return
    const item = e.currentTarget.dataset.item
    const disabling = item.status === 1
    const confirmed = await util.showConfirm(disabling
      ? `确认停用门店「${item.storeName}」吗？\n停用后下单时不可再选择该门店，历史单据保留`
      : `确认恢复门店「${item.storeName}」吗？恢复后可正常下单`)
    if (!confirmed) return

    this._submitting = true
    try {
      util.showLoading()
      const res = await cloud.callFunction('authService', {
        action: 'setStoreStatus',
        storeId: item.storeId,
        status: disabling ? 0 : 1
      })
      util.hideLoading()

      if (res && res.code === 0) {
        util.showSuccess(disabling ? '已停用' : '已启用')
        this.loadData()
      } else {
        util.showToast((res && res.msg) || '操作失败')
      }
    } finally {
      this._submitting = false
    }
  }
})
