// pages/user-manage/user-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    users: [],
    showAdd: false,
    editItem: null,
    showReset: false,
    resetItem: null,
    resetForm: { newPassword: '', confirmPassword: '' },
    form: { username: '', name: '', password: '', role: 'chef', roleLabel: '门店下单人员', defaultStoreId: '', storeName: '', defaultSupplierId: '', supplierName: '' },
    roles: [
      { key: 'chef', label: '门店下单人员' },
      { key: 'store_manager', label: '店长' },
      { key: 'purchaser', label: '管理员' },
      { key: 'super_admin', label: '超级管理员' },
      { key: 'supplier', label: '供货商' }
    ],
    stores: [],
    suppliers: []
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    util.showLoading()
    const app = getApp()
    const [usersResult, storesResult, suppliersResult] = await Promise.all([
      cloud.callFunction('authService', { action: 'listUsers' }),
      cloud.callFunction('authService', { action: 'getStores' }),
      cloud.callFunction('getSuppliers', {})
    ])
    if (usersResult.code === 0 && storesResult.code === 0) {
      const stores = storesResult.data || []
      const suppliers = (suppliersResult.code === 0 ? suppliersResult.data : []).map(cloud.normalizeSupplier)
      const usersData = usersResult.data.map(u => {
        const store = stores.find(s => s.storeId === u.defaultStoreId)
        const supplier = suppliers.find(s => s.supplierId === u.defaultSupplierId)
        const displayStoreName = u.role === 'supplier'
          ? (supplier ? supplier.supplierName : (u.defaultSupplierId || '未关联'))
          : (store ? store.storeName : '全部/无')
        return { ...u, displayStoreName }
      })
      this.setData({ users: usersData, stores, suppliers })
    } else {
      util.showToast(usersResult.msg || storesResult.msg || '账号数据加载失败')
    }
    util.hideLoading()
  },

  showAddForm() {
    this.setData({
      showAdd: true, editItem: null,
      form: { username: '', name: '', password: '', role: 'chef', roleLabel: '门店下单人员', defaultStoreId: '', storeName: '', defaultSupplierId: '', supplierName: '' }
    })
  },

  showEditForm(e) {
    const item = e.currentTarget.dataset.item
    const store = this.data.stores.find(s => s.storeId === item.defaultStoreId)
    const supplier = this.data.suppliers.find(s => s.supplierId === item.defaultSupplierId)

    // Find pre-selected indices for pickers
    const rIdx = this.data.roles.findIndex(r => r.key === item.role)
    const sIdx = this.data.stores.findIndex(s => s.storeId === item.defaultStoreId)
    const supIdx = this.data.suppliers.findIndex(s => s.supplierId === item.defaultSupplierId)

    this.setData({
      showAdd: true, editItem: item,
      form: {
        username: item.username || '',
        name: item.name || '',
        password: '',
        role: item.role || 'chef',
        roleLabel: item.roleLabel || '门店下单人员',
        roleIndex: rIdx > -1 ? rIdx : 0,
        defaultStoreId: item.defaultStoreId || '',
        storeName: store ? store.storeName : '',
        storeIndex: sIdx > -1 ? sIdx : 0,
        defaultSupplierId: item.defaultSupplierId || '',
        supplierName: supplier ? supplier.supplierName : '',
        supplierIndex: supIdx > -1 ? supIdx : 0
      }
    })
  },

  closeForm() {
    this.setData({ showAdd: false })
  },

  showResetForm(e) {
    const item = e.currentTarget.dataset.item
    this.setData({
      showReset: true,
      resetItem: item,
      resetForm: { newPassword: '', confirmPassword: '' }
    })
  },

  closeResetForm() {
    this.setData({ showReset: false, resetItem: null })
  },

  onResetInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`resetForm.${field}`]: e.detail.value })
  },

  async saveResetPassword() {
    const { resetItem, resetForm } = this.data
    if (!resetItem) return
    if (!resetForm.newPassword || !resetForm.confirmPassword) {
      return util.showToast('请输入并确认新密码')
    }
    if (resetForm.newPassword.length < 6) return util.showToast('新密码至少需要6位')
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      return util.showToast('两次输入的新密码不一致')
    }

    const confirmed = await util.showConfirm(`确认重置 ${resetItem.name} 的登录密码吗？`)
    if (!confirmed) return

    util.showLoading()
    const app = getApp()
    const res = await cloud.callFunction('authService', {
      action: 'resetPassword',
      id: resetItem.id,
      newPassword: resetForm.newPassword
    })
    util.hideLoading()

    if (res.code === 0) {
      this.closeResetForm()
      util.showSuccess('密码已重置')
    } else {
      util.showToast(res.msg || '密码重置失败')
    }
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onRoleChange(e) {
    const role = this.data.roles[e.detail.value]
    this.setData({ 
      'form.role': role.key,
      'form.roleLabel': role.label,
      'form.roleIndex': e.detail.value
    })
  },

  onStoreChange(e) {
    const store = this.data.stores[e.detail.value]
    this.setData({
      'form.defaultStoreId': store.storeId,
      'form.storeName': store.storeName,
      'form.storeIndex': e.detail.value
    })
  },

  onSupplierChange(e) {
    const supplier = this.data.suppliers[e.detail.value]
    this.setData({
      'form.defaultSupplierId': supplier.supplierId,
      'form.supplierName': supplier.supplierName,
      'form.supplierIndex': e.detail.value
    })
  },

  stopBubble() {},

  async saveUser() {
    const { form, editItem } = this.data
    if (!form.username.trim() || !form.name.trim() || (!editItem && !form.password.trim())) {
      return util.showToast(editItem ? '请输入账号和姓名' : '请输入完整账号、姓名和密码')
    }
    if (form.password && form.password.trim().length < 6) {
      return util.showToast('密码至少需要6位')
    }
    if (['chef', 'store_manager'].includes(form.role) && !form.defaultStoreId) {
      return util.showToast('请选择所属门店')
    }
    if (form.role === 'supplier' && !form.defaultSupplierId) {
      return util.showToast('请选择所属供货商')
    }

    util.showLoading()
    const roleObj = this.data.roles.find(r => r.key === form.role)
    const payload = {
      username: form.username.trim(),
      name: form.name.trim(),
      password: form.password.trim(),
      role: form.role,
      roleLabel: roleObj ? roleObj.label : form.role,
      defaultStoreId: ['chef', 'store_manager'].includes(form.role) ? form.defaultStoreId : null,
      defaultSupplierId: form.role === 'supplier' ? form.defaultSupplierId : null
    }

    const app = getApp()
    let res
    if (editItem) {
      res = await cloud.callFunction('authService', { action: 'updateUser', id: editItem.id, ...payload })
    } else {
      res = await cloud.callFunction('authService', { action: 'createUser', ...payload })
    }

    util.hideLoading()
    if (res.code === 0) {
      util.showSuccess('保存成功')
      this.closeForm()
      this.loadData()
    } else {
      util.showToast(res.msg || '保存失败')
    }
  },

  async deleteUser(e) {
    const item = e.currentTarget.dataset.item
    if (item.username === 'admin') return util.showToast('无法删除默认系统超管')
    
    const confirmed = await util.showConfirm(`确认删除账号 ${item.name}(${item.username}) 吗？`)
    if (!confirmed) return

    util.showLoading()
    const app = getApp()
    const res = await cloud.callFunction('authService', {
      action: 'deleteUser',
      id: item.id
    })
    util.hideLoading()

    if (res.code === 0) {
      util.showSuccess('已删除')
      this.loadData()
    } else {
      util.showToast(res.msg || '删除失败')
    }
  }
})
