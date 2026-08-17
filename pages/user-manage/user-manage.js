// pages/user-manage/user-manage.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    users: [],
    showAdd: false,
    editItem: null,
    form: { username: '', name: '', password: '', role: 'chef', roleLabel: '门店下单人员', defaultStoreId: '', storeName: '' },
    roles: [
      { key: 'chef', label: '门店下单人员' },
      { key: 'store_manager', label: '店长' },
      { key: 'purchaser', label: '管理员' },
      { key: 'super_admin', label: '超级管理员' }  
    ],
    stores: []
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    util.showLoading()
    const app = getApp()
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')
    const [usersResult, storesResult] = await Promise.all([
      cloud.callFunction('authService', { action: 'listUsers', authToken }),
      cloud.callFunction('authService', { action: 'getStores', authToken })
    ])
    if (usersResult.code === 0 && storesResult.code === 0) {
      const stores = storesResult.data || []
      const usersData = usersResult.data.map(u => {
        const store = stores.find(s => s.storeId === u.defaultStoreId)
        return { ...u, displayStoreName: store ? store.storeName : '全部/无' }
      })
      this.setData({ users: usersData, stores })
    } else {
      util.showToast(usersResult.msg || storesResult.msg || '账号数据加载失败')
    }
    util.hideLoading()
  },

  showAddForm() {
    this.setData({
      showAdd: true, editItem: null,
      form: { username: '', name: '', password: '', role: 'chef', roleLabel: '门店下单人员', defaultStoreId: '', storeName: '' }
    })
  },

  showEditForm(e) {
    const item = e.currentTarget.dataset.item
    const store = this.data.stores.find(s => s.storeId === item.defaultStoreId)
    
    // Find pre-selected indices for pickers
    const rIdx = this.data.roles.findIndex(r => r.key === item.role)
    const sIdx = this.data.stores.findIndex(s => s.storeId === item.defaultStoreId)

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
        storeIndex: sIdx > -1 ? sIdx : 0
      }
    })
  },

  closeForm() {
    this.setData({ showAdd: false })
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

    util.showLoading()
    const roleObj = this.data.roles.find(r => r.key === form.role)
    const payload = {
      username: form.username.trim(),
      name: form.name.trim(),
      password: form.password.trim(),
      role: form.role,
      roleLabel: roleObj ? roleObj.label : form.role,
      defaultStoreId: ['super_admin', 'purchaser'].includes(form.role) ? null : form.defaultStoreId
    }

    const app = getApp()
    const authToken = app.globalData.authToken || wx.getStorageSync('authToken')
    let res
    if (editItem) {
      res = await cloud.callFunction('authService', { action: 'updateUser', authToken, id: editItem.id, ...payload })
    } else {
      res = await cloud.callFunction('authService', { action: 'createUser', authToken, ...payload })
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
      authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
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
