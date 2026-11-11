// pages/supplier-receipts/supplier-receipts.js
const util = require('../../utils/util')
const cloud = require('../../utils/cloud')
const meta = require('../../utils/meta')
const authGuard = require('../../utils/auth-guard')
const { listLifecycle, listFetch } = require('../../utils/list-page')

Page({
  data: {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false
  },

  onShow() {
    if (!authGuard.requireLogin()) return
    const app = getApp()
    const user = app.globalData.userInfo || {}
    // L13：requireLogin 已保证登录态，原 if(!isLoggedIn) 死分支删除
    if (user.role !== 'supplier') {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    this.fetchPage(1, false)
  },

  ...listLifecycle('items'),

  // 分页骨架统一走 listFetch（L17/L27），装饰抽为 decorateReceipt
  async fetchPage(page, append) {
    await listFetch(page, this, append, {
      fetch: () => cloud.callFunction('getSupplierReceipts', {
        page,
        pageSize: this.data.pageSize
      }),
      decorate: item => this.decorateReceipt(item),
      listKey: 'items',
      failMsg: '收货记录加载失败，请稍后重试',
      skipIfLoading: true
    })
  },

  decorateReceipt(item) {
    const receivedQty = Number(item.received_qty) || 0
    const orderQty = Number(item.order_qty_snapshot) || 0
    // 实收与订货不一致或未计价（应付标记关闭）视为异常，红色提示
    // S9：手动商品行（is_manual）0 价为预期行为（金额走凭证核销回填），不标异常
    const abnormal = !item.is_manual && (receivedQty !== orderQty || item.payable_flag === false)
    // S7 拍板：展示异常处理进度与裁决结果，供供货商对账（只读）
    const abnormals = (item.abnormals || []).map((rec, i) => {
      // P2-54：类型/状态文案走 meta 单源（补 missing_price，不再自建重复字典）
      const typeText = meta.getAbnormalTypeInfo(rec.type).text
      const statusText = meta.getStatusInfo(rec.status).text
      const decisionText = rec.payment_decision === 'pay_received'
        ? '裁决：按实收补款'
        : rec.payment_decision === 'reject' ? '裁决：维持不付款' : ''
      return {
        // L26：wxml wx:key 需真实存在的字段
        akey: rec.type + '-' + i,
        text: `${typeText}（${statusText}）${rec.resolution || ''}${decisionText ? ' ' + decisionText : ''}`,
        done: rec.status === 'resolved' || rec.status === 'closed'
      }
    })
    return {
      ...item,
      receivedQty,
      orderQty,
      priceText: util.formatMoney(item.price_snapshot),
      amountText: util.formatMoney(item.amount),
      abnormal,
      abnormals
    }
  }
})
