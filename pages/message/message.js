// pages/message/message.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const authGuard = require('../../utils/auth-guard')

Page({
    data: {
        messages: [],
        unreadCount: 0
    },

    async onShow() {
        if (!authGuard.requireLogin()) return
        const app = getApp()
        const result = await cloud.callFunction('dataService', {
            action: 'getMessages',
        })
        if (!result || result.code !== 0) {
            util.showToast((result && result.msg) || '消息加载失败')
            return
        }
        const messages = (result.data || []).map(m => ({
            ...m,
            time: cloud.formatDateTime(m.time),
            timeAgo: util.getRelativeTime(cloud.formatDateTime(m.time))
        }))
        const unreadCount = messages.filter(m => !m.read).length
        this.setData({ messages, unreadCount })
    },

    async readMessage(e) {
        const id = e.currentTarget.dataset.id
        const idx = this.data.messages.findIndex(m => m.id === id)
        if (idx < 0) return
        const message = this.data.messages[idx]
        if (!message.read) {
            const app = getApp()
            const result = await cloud.callFunction('dataService', {
                action: 'markMessageRead',
                id
            })
            if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
            this.setData({
                [`messages[${idx}].read`]: true,
                unreadCount: Math.max(0, this.data.unreadCount - 1)
            })
        }
        // 按消息类型路由：订单类 bizId 是采购单号，跳采购单详情；
        // 收货/异常类 bizId 是收货单号(RCP...)或异常编号，跳收货列表。
        // 旧消息可能缺 type，用 bizId 前缀兜底。
        if (message.bizId) {
            const role = (getApp().globalData.userInfo || {}).role
            if (role === 'supplier') {
                wx.navigateTo({ url: '/pages/supplier-orders/supplier-orders' })
                return
            }
            const isReceiptMsg = ['receive', 'abnormal'].includes(message.type)
                || String(message.bizId).indexOf('RCP') === 0
            if (isReceiptMsg) {
                wx.navigateTo({ url: '/pages/receive-list/receive-list' })
            } else {
                wx.navigateTo({ url: '/pages/purchase-detail/purchase-detail?id=' + message.bizId })
            }
            return
        }
        util.showToast('已读')
    },

    async markAllRead() {
        const app = getApp()
        const result = await cloud.callFunction('dataService', {
            action: 'markAllMessagesRead',
        })
        if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
        const messages = this.data.messages.map(m => ({ ...m, read: true }))
        this.setData({ messages, unreadCount: 0 })
        util.showSuccess('全部已读')
    }
})
