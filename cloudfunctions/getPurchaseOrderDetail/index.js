// 云函数 getPurchaseOrderDetail - 获取采购单详情
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// （hashToken 本地副本已删除——见下方 shared/session require）

// 会话校验收敛到跨函数共享模块（2026-11-05 解耦第 3 项；源头 scripts/cloud-shared/session.js，
// 由 scripts/sync-shared.js 同步副本，勿再恢复本地副本——F1 就是 19 份副本各自漂移的教训）
const { hashToken, getSessionUser } = require('./shared/session')

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    const { orderId } = event || {}
    if (!orderId) return { code: -1, msg: '订单信息缺失，请返回后重试' }

    // 查主表
    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: orderId })
      .limit(1)
      .get()

    if (orderRes.data.length === 0) {
      return { code: -1, msg: '订单不存在' }
    }

    const order = orderRes.data[0]
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!['chef', 'store_manager'].includes(user.role)) return { code: -403, msg: '当前账号无权查看采购订单' }
      if (!user.default_store_id || order.store_id !== user.default_store_id) {
        return { code: -403, msg: '无权查看其他门店订单' }
      }
      if (user.role === 'chef' && order.created_by !== (user.user_id || user._id)) {
        return { code: -403, msg: '无权查看其他人员创建的订单' }
      }
    }
    let createdByName = order.created_by_name || order.created_by || ''
    if (!order.created_by_name && order.created_by) {
      const userRes = await db.collection('app_user')
        .where({ user_id: order.created_by })
        .limit(1)
        .get()
      if (userRes.data.length) createdByName = userRes.data[0].name || createdByName
    }

    // 查明细
    const itemsRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: orderId })
      .limit(1000)
      .get()

    // S6：明细补充供货商名称，供详情页按供货商分组展示确认状态。
    // chef 不下发（与下方报表过滤同一信息边界：chef 不见供应商身份）
    let items = itemsRes.data
    if (user.role !== 'chef' && items.length) {
      const supplierIds = [...new Set(items.map(item => item.supplier_id).filter(Boolean))]
      const supplierNames = {}
      for (let i = 0; i < supplierIds.length; i += 20) {
        const supRes = await db.collection('supplier')
          .where({ supplier_id: _.in(supplierIds.slice(i, i + 20)) })
          .limit(100)
          .get()
        supRes.data.forEach(s => { supplierNames[s.supplier_id] = s.supplier_name })
      }
      items = items.map(item => ({ ...item, supplier_name: supplierNames[item.supplier_id] || '' }))
    }

    // P1-17：聚合每行已收累计（分批收货时前端展示"已收 X / 剩余 Y"），
    // 一次查询 receipt_item 按 purchase_order_item_id 汇总，避免 N+1
    if (items.length) {
      const itemIds = items.map(it => it.item_id || it._id).filter(Boolean)
      const receivedRes = await db.collection('receipt_item')
        .where({ purchase_order_item_id: _.in(itemIds) })
        .limit(1000)
        .get()
      const receivedMap = {}
      ;(receivedRes.data || []).forEach(ri => {
        const key = ri.purchase_order_item_id
        if (!key) return
        receivedMap[key] = (receivedMap[key] || 0) + (Number(ri.received_qty) || 0)
      })
      items = items.map(item => {
        const received = receivedMap[item.item_id || item._id] || 0
        return { ...item, received_total: received, remaining_qty: Math.max(0, (Number(item.order_qty) || 0) - received) }
      })
    }

    // 查关联收货记录
    const receiptRes = await db.collection('receipt')
      .where({ purchase_order_id: orderId })
      .limit(100)
      .get()

    // 查关联报表。chef 只能看到本店维度的报表记录，
    // 供应商级报表元数据（含供应商名称）不下发
    const reportRes = await db.collection('report_file')
      .where({ source_order_id: orderId })
      .limit(100)
      .get()
    // 不下发 file_url/file_name（2026-11-05 旁路修复）：下载一律走 getReportFileUrl
    // 按 reportId 鉴权取临时链接，与 getReports 列表口径一致——此处原为漏网旁路：
    // chef 可从订单详情拿到门店收货报表的 fileID，绕过 getReportFileUrl 的
    // 「chef 仅 store_order_report」限制直换临时链接下载
    const reports = (user.role === 'chef'
      ? reportRes.data.filter(r => r.report_scope === 'store')
      : reportRes.data
    ).map(r => {
      const { file_url, file_name, ...rest } = r
      return { ...rest, has_file: !!file_url }
    })

    return {
      code: 0,
      data: {
        ...order,
        created_by_name: createdByName,
        items,
        receipts: receiptRes.data,
        reports
      }
    }
  } catch (err) {
    console.error('[getPurchaseOrderDetail] 采购订单详情加载失败:', err)
    return { code: -1, msg: '采购订单详情加载失败，请稍后重试' }
  }
}
