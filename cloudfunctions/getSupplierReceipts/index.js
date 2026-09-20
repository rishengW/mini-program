// 云函数 getSupplierReceipts - 供货商视角的收货明细列表
// 平铺返回该供货商每条收货明细（含单价快照与金额），供对账使用。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const tokenHash = hashToken(authToken)
  // B12 多设备会话：先查 sessions 数组（每设备一条），兼容旧单会话字段
  const result = await db.collection('app_user')
    .where({ status: 1, sessions: { token_hash: tokenHash } })
    .limit(1)
    .get()
  let user = result.data[0]
  if (!user) {
    const legacy = await db.collection('app_user')
      .where({ session_token_hash: tokenHash, status: 1 })
      .limit(1)
      .get()
    user = legacy.data[0]
  }
  if (!user) return null
  if (Array.isArray(user.sessions) && user.sessions.length) {
    const session = user.sessions.find(s => s && s.token_hash === tokenHash)
    if (!session || !session.expires_at) return null
    const expiresAt = new Date(session.expires_at).getTime()
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? user : null
  }
  if (!user.session_expires_at) return null
  const legacyExpires = new Date(user.session_expires_at).getTime()
  return Number.isFinite(legacyExpires) && legacyExpires > Date.now() ? user : null
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (user.role !== 'supplier') return { code: -403, msg: '当前账号无权查看收货记录' }
    const supplierId = user.default_supplier_id
    if (!supplierId) return { code: -403, msg: '账号未关联供货商，请联系管理员' }

    const page = Math.max(1, Math.min(1000, Math.floor(Number(event.page) || 1)))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 20)))

    // receipt_item 上没有 receipt_date 字段（日期在 receipt 主表），这里只按供货商过滤
    const query = { supplier_id: supplierId }

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
        amount: Math.round(receivedQty * price * 100) / 100
      }
    })

    return { code: 0, data, total: countRes.total, page, pageSize }
  } catch (err) {
    console.error('[getSupplierReceipts] 供货商收货记录加载失败:', err)
    return { code: -1, msg: '收货记录加载失败，请稍后重试' }
  }
}
