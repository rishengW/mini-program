// pages/message/message.js
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
    data: {
        messages: [],
        unreadCount: 0
    },

    async onShow() {
        const app = getApp()
        const result = await cloud.callFunction('dataService', {
            action: 'getMessages',
            authToken: app.globalData.authToken || wx.getStorageSync('authToken')
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
        if (!this.data.messages[idx].read) {
            const app = getApp()
            const result = await cloud.callFunction('dataService', {
                action: 'markMessageRead',
                authToken: app.globalData.authToken || wx.getStorageSync('authToken'),
                id
            })
            if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
            this.setData({
                [`messages[${idx}].read`]: true,
                unreadCount: Math.max(0, this.data.unreadCount - 1)
            })
        }
        util.showToast('已读')
    },

    async markAllRead() {
        const app = getApp()
        const result = await cloud.callFunction('dataService', {
            action: 'markAllMessagesRead',
            authToken: app.globalData.authToken || wx.getStorageSync('authToken')
        })
        if (result.code !== 0) return util.showToast(result.msg || '消息状态更新失败')
        const messages = this.data.messages.map(m => ({ ...m, read: true }))
        this.setData({ messages, unreadCount: 0 })
        util.showSuccess('全部已读')
    }
})
