// pages/abnormal-list/abnormal-list.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const meta = require('../../utils/meta')
const authGuard = require('../../utils/auth-guard')
const { submitGuard } = require('../../utils/submit-guard')

Page({
  data: {
    activeFilter: 'all',
    filteredList: [],
    records: []
  },

  async onShow() {
    if (!authGuard.requireLogin()) return
    const app = getApp()
    const result = await cloud.callFunction('dataService', {
      action: 'getAbnormalRecords',
    })
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '异常记录加载失败')
      return
    }
    const records = (result.data || []).map(item => ({
      ...item,
      createdAt: cloud.formatDateTime(item.createdAt)
    }))
    this.setData({ records })
    this.applyFilter()
  },

  switchFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.value })
    this.applyFilter()
  },

  applyFilter() {
    const { activeFilter } = this.data
    let list = this.data.records
    if (activeFilter !== 'all') {
      list = list.filter(r => r.status === activeFilter)
    }
    // L23：状态色收敛到 meta.statusMap 单源，不再本地硬编码
    const filteredList = list.map(r => ({ ...r, statusColor: meta.getStatusInfo(r.status).type }))
    this.setData({ filteredList })
  },

  async handleAbnormal(e) {
    const confirmed = await util.showConfirm('确认开始处理该异常？')
    if (!confirmed) return
    // submitGuard：防连点重复发起（重入返回 undefined 直接忽略）
    const result = await submitGuard(this, () => cloud.callFunction('dataService', {
      action: 'startAbnormal',
      id: e.currentTarget.dataset.id
    }))
    if (result === undefined) return
    if (result.code !== 0) return util.showToast(result.msg || '异常处理状态更新失败')
    util.showSuccess('已标记为处理中')
    await this.onShow()
  },

  promptResolution() {
    return new Promise(resolve => {
      wx.showModal({
        title: '填写处理结果',
        editable: true,
        placeholderText: '请输入处理结果或解决方案',
        success: res => resolve(res.confirm ? String(res.content || '').trim() : '')
      })
    })
  },

  async resolveAbnormal(e) {
    const resolution = await this.promptResolution()
    if (!resolution) {
      util.showToast('请填写处理结果')
      return
    }
    // P1-20（2026-11-09 修复）：付款裁决改三态显式选择。原确认框的「取消」会被
    // 当成「提交且拒绝付款」继续走——想"稍后再说"的用户误点取消即把该行永久标记
    // 不付款，且供货商端会看到「裁决：维持不付款」。现在取消/失败 = 中止整个提交。
    const decision = await new Promise(resolve => {
      wx.showActionSheet({
        itemList: ['按实收付款（纳入补结算账单）', '不付款（按异常核销）'],
        success: res => resolve(res.tapIndex === 0 ? 'pay_received' : 'reject'),
        fail: () => resolve('') // 用户取消或拉起失败：中止，不落任何裁决
      })
    })
    if (!decision) return
    const paymentDecision = decision
    const result = await submitGuard(this, () => cloud.callFunction('dataService', {
      action: 'resolveAbnormal',
      id: e.currentTarget.dataset.id,
      resolution,
      paymentDecision
    }))
    if (result === undefined) return
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '异常解决状态更新失败')
      return
    }
    util.showSuccess('已标记为已解决')
    await this.onShow()
  },

  async closeAbnormal(e) {
    const confirmed = await util.showConfirm('确认关闭该异常记录？关闭后不可继续处理。')
    if (!confirmed) return
    const result = await submitGuard(this, () => cloud.callFunction('dataService', {
      action: 'closeAbnormal',
      id: e.currentTarget.dataset.id
    }))
    if (result === undefined) return
    if (!result || result.code !== 0) {
      util.showToast((result && result.msg) || '异常关闭失败')
      return
    }
    util.showSuccess('异常已关闭')
    await this.onShow()
  }
})
