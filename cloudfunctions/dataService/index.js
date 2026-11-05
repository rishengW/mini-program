// dataService 入口（2026-11-05 单体拆分）：只做 action 分发，业务逻辑在各域模块。
// 拆分前为 1822 行单体（23 个 action 与全部共享函数缠在一起）；
// 拆后同目录多文件（微信云函数整目录上传，require 相对路径无需改部署方式）：
//   _shared.js      db 连接/角色常量/会话校验/通用工具（cloud.init 唯一收口）
//   messages.js     站内消息写入/查询/已读 + 收件人解析
//   notify.js       审核通过后的供应商下推（站内 + 订阅消息）
//   report-utils.js CSV 转义/路径安全/版本取号 + 审核改量后报表重算
//   catalog.js      分类/商品/供应商档案
//   approval.js     订单审核（改量/驳回）+ 催审
//   abnormal.js     异常记录查询与状态机
//   settle.js       补结算（_S）/补价（reprice）/报表补生成（_RG、①②）+ regen_lock
//   cancel.js       作废/取消申请/驳回取消
//   verify.js       手动单凭证核销
//   stats.js        首页状态统计
const { getCategories, saveProduct, toggleProduct, saveSupplier, toggleSupplier } = require('./catalog')
const { auditOrder, remindAudit } = require('./approval')
const { getMessages, markMessageRead, markAllMessagesRead } = require('./messages')
const { getAbnormalRecords, startAbnormal, resolveAbnormal, closeAbnormal } = require('./abnormal')
const { getOrderStats } = require('./stats')
const { settleReceipt, repriceReceipt, regenerateReceiptReports, regenerateOrderReports } = require('./settle')
const { cancelOrder, requestCancel, rejectCancel } = require('./cancel')
const { verifyManualOrder } = require('./verify')

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'getCategories': return await getCategories(event)
      case 'saveProduct': return await saveProduct(event)
      case 'toggleProduct': return await toggleProduct(event)
      case 'saveSupplier': return await saveSupplier(event)
      case 'toggleSupplier': return await toggleSupplier(event)
      case 'auditOrder': return await auditOrder(event)
      case 'getMessages': return await getMessages(event)
      case 'markMessageRead': return await markMessageRead(event)
      case 'markAllMessagesRead': return await markAllMessagesRead(event)
      case 'getAbnormalRecords': return await getAbnormalRecords(event)
      case 'startAbnormal': return await startAbnormal(event)
      case 'resolveAbnormal': return await resolveAbnormal(event)
      case 'closeAbnormal': return await closeAbnormal(event)
      case 'getOrderStats': return await getOrderStats(event)
      case 'settleReceipt': return await settleReceipt(event)
      case 'repriceReceipt': return await repriceReceipt(event)
      case 'regenerateReceiptReports':
        // F3：剔除客户端伪造的内部持锁标记——外部直达调用必须走抢锁
        delete event._lockHeld
        return await regenerateReceiptReports(event)
      case 'regenerateOrderReports': return await regenerateOrderReports(event)
      case 'cancelOrder': return await cancelOrder(event)
      case 'requestCancel': return await requestCancel(event)
      case 'rejectCancel': return await rejectCancel(event)
      case 'remindAudit': return await remindAudit(event)
      case 'verifyManualOrder': return await verifyManualOrder(event)
      default: return { code: -1, msg: '不支持的数据操作' }
    }
  } catch (err) {
    console.error('[dataService] CloudBase 数据操作失败:', err)
    return { code: -1, msg: 'CloudBase 数据操作失败，请稍后重试' }
  }
}
