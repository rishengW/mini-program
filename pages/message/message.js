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
        // 异常类跳异常处理列表；收货类 bizId 是收货单号(RCP...)，跳收货列表。
        // 旧消息可能缺 type，用 bizId 前缀兜底。
        if (message.bizId) {
            const role = (getApp().globalData.userInfo || {}).role
            if (role === 'supplier') {
                // 供应商定向消息目前只有「新订单通知」一类，落到待确认 tab 而非默认列表
                wx.navigateTo({ url: '/pages/supplier-orders/supplier-orders?status=pending' })
                return
            }
            // 报表补生成类消息虽打 type:'abnormal'，但落点是补生成入口，不是异常列表：
            // 订单侧（MSG_ORDER_REPORT_MISSING_，bizId 为采购单号）→ 采购单详情页（有补生成按钮）；
            // 收货侧（MSG_REPORT_MISSING_，bizId 为收货单号）→ 收货列表（有补生成按钮）
            const msgId = String(message.messageId || '')
            if (msgId.indexOf('MSG_ORDER_REPORT_MISSING_') === 0) {
                wx.navigateTo({ url: '/pages/purchase-detail/purchase-detail?id=' + message.bizId })
                return
            }
            if (msgId.indexOf('MSG_REPORT_MISSING_') === 0) {
                wx.navigateTo({ url: '/pages/receive-list/receive-list' })
                return
            }
            if (message.type === 'abnormal') {
                wx.navigateTo({ url: '/pages/abnormal-list/abnormal-list' })
                return
            }
            const isReceiptMsg = message.type === 'receive'
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
        // L28：与 readMessage 同款的 path 局部更新，不再 map 全量重建长列表
        const update = { unreadCount: 0 }
        this.data.messages.forEach((m, i) => {
            if (!m.read) update[`messages[${i}].read`] = true
        })
        this.setData(update)
        util.showSuccess('全部已读')
    }
})
