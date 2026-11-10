// 云函数 getSupplierReceipts - 供货商视角的收货明细列表
// 平铺返回该供货商每条收货明细（含单价快照与金额），供对账使用。
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
    if (user.role !== 'supplier') return { code: -403, msg: '当前账号无权查看收货记录' }
    const supplierId = user.default_supplier_id
    if (!supplierId) return { code: -403, msg: '账号未关联供货商，请联系管理员' }
    // P2-3（2026-11-10）：供应商档案停用后，存量登录会话立即失效——停用即不可见
    const supRes = await db.collection('supplier').where({ supplier_id: supplierId }).limit(1).get()
    if (!supRes.data[0] || supRes.data[0].status !== 1) return { code: -403, msg: '该供货商已停用，请联系管理员' }

    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 20)))

    // receipt_item 上没有 receipt_date 字段（日期在 receipt 主表），这里只按供货商过滤
    // 清单 #24 双保险：显式排除手动商品行，不依赖 supplier_id 为空的隐式前提
    const query = { supplier_id: supplierId, is_manual: _.neq(true) }

    const countRes = await db.collection('receipt_item').where(query).count()
    const itemsRes = await db.collection('receipt_item')
      .where(query)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const items = itemsRes.data
    if (!items.length) return { code: 0, data: [], total: countRes.total, page, pageSize }

    // 批量 join 收货单主表，拿到收货日期、门店与关联订单号
    const receiptIds = [...new Set(items.map(item => item.receipt_id).filter(Boolean))]
    const receiptMap = {}
    for (let i = 0; i < receiptIds.length; i += 20) {
      const idChunk = receiptIds.slice(i, i + 20)
      const receiptsRes = await db.collection('receipt')
        .where({ receipt_id: _.in(idChunk) })
        .limit(100)
        .get()
      receiptsRes.data.forEach(receipt => { receiptMap[receipt.receipt_id] = receipt })
    }

    // S7 拍板：join 该供货商的异常记录，把处理状态与裁决结果带回，供供货商对账
    const receiptIdsAll = [...new Set(items.map(item => item.receipt_id).filter(Boolean))]
    const abnormalMap = {}
    for (let i = 0; i < receiptIdsAll.length; i += 20) {
      const idChunk = receiptIdsAll.slice(i, i + 20)
      const abnRes = await db.collection('abnormal_record')
        .where({ receipt_id: _.in(idChunk), supplier_id: supplierId })
        .limit(1000)
        .get()
      abnRes.data.forEach(rec => {
        const key = `${rec.receipt_id}_${rec.product_id}`
        if (!abnormalMap[key]) abnormalMap[key] = []
        abnormalMap[key].push({
          type: rec.type || '',
          status: rec.status || '',
          resolution: rec.resolution || '',
          payment_decision: rec.payment_decision || ''
        })
      })
    }

    const data = items.map(item => {
      const receipt = receiptMap[item.receipt_id] || {}
      const receivedQty = Number(item.received_qty) || 0
      const price = Number(item.price_snapshot) || 0
      return {
        ...item,
        receipt_date: receipt.receipt_date || '',
        store_id: receipt.store_id || '',
        store_name: receipt.store_name || '',
        purchase_order_id: receipt.purchase_order_id || '',
        amount: Math.round(receivedQty * price * 100) / 100,
        abnormals: abnormalMap[`${item.receipt_id}_${item.product_id}`] || []
      }
    })

    return { code: 0, data, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getSupplierReceipts] 供货商收货记录加载失败:', err)
    return { code: -1, msg: '收货记录加载失败，请稍后重试' }
  }
}
