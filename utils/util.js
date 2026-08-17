/**
 * util.js - 工具函数模块
 */

/**
 * 格式化日期
 * @param {string|Date} date 日期
 * @param {string} format 格式 'YYYY-MM-DD' | 'YYYY-MM-DD HH:mm' | 'MM-DD HH:mm'
 */
function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date.replace(/-/g, '/')) : date
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')

    switch (format) {
        case 'YYYY-MM-DD':
            return `${year}-${month}-${day}`
        case 'YYYY-MM-DD HH:mm':
            return `${year}-${month}-${day} ${hour}:${minute}`
        case 'MM-DD HH:mm':
            return `${month}-${day} ${hour}:${minute}`
        case 'MM月DD日':
            return `${parseInt(month)}月${parseInt(day)}日`
        default:
            return `${year}-${month}-${day}`
    }
}

/**
 * 获取相对时间
 */
function getRelativeTime(dateStr) {
    if (!dateStr) return ''
    const normalized = typeof dateStr === 'string' ? dateStr.replace(/-/g, '/') : dateStr
    const d = new Date(normalized)
    const now = new Date()
    const diff = now - d
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    return formatDate(dateStr, 'MM-DD HH:mm')
}

/**
 * 生成唯一ID
 */
function generateId() {
    return Date.now() + Math.floor(Math.random() * 1000)
}

/**
 * 提示
 */
function showToast(title, icon = 'none') {
    wx.showToast({ title, icon, duration: 2000 })
}

function showSuccess(title) {
    wx.showToast({ title, icon: 'success', duration: 1500 })
}

function showLoading(title = '加载中...') {
    wx.showLoading({ title, mask: true })
}

function hideLoading() {
    wx.hideLoading()
}

/**
 * 确认对话框
 */
function showConfirm(content, title = '提示') {
    return new Promise((resolve) => {
        wx.showModal({
            title,
            content,
            success(res) {
                resolve(res.confirm)
            }
        })
    })
}

/**
 * 计算总金额
 */
function calcTotal(items, qtyField = 'requestedQty', priceField = 'price') {
    return items.reduce((sum, item) => {
        return sum + (item[qtyField] || 0) * (item[priceField] || 0)
    }, 0).toFixed(2)
}

module.exports = {
    formatDate,
    getRelativeTime,
    generateId,
    showToast,
    showSuccess,
    showLoading,
    hideLoading,
    showConfirm,
    calcTotal
}
