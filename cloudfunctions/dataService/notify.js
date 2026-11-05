// 供应商通知域（2026-11-05 拆分自 dataService/index.js）：
// 审核通过后按供货商分组下推——站内消息（必写，兜底触达）+ 微信订阅消息（尽力而为）。
const { db, _, cloud } = require('./_shared')
const { createMessage } = require('./messages')

// ===== 审核通过 → 通知供货商（新订单下推） =====
// 订阅消息模板配置：小程序后台申请通过后填入 TEMPLATE_ID 即可真实下发；
// TEMPLATE_ID 为空时只记日志、不发送（站内通知不受影响，作为兜底触达）。
const SUBSCRIBE_TEMPLATE_ID = ''
// 模板字段（一次订阅一条）：按申请到的模板 keywords 配置，值从 payload 取
const SUBSCRIBE_TEMPLATE_FIELDS = [
  { key: 'orderNo', index: 1 },
  { key: 'storeName', index: 2 },
  { key: 'items', index: 3 },
  { key: 'amount', index: 4 }
]

// 查询某供货商所有启用账号（含 openid），用于订阅消息推送
async function getSupplierUsers(supplierId) {
  if (!supplierId) return []
  try {
    const res = await db.collection('app_user')
      .where({ role: 'supplier', default_supplier_id: supplierId, status: 1 })
      .limit(20)
      .get()
    return res.data.filter(u => u.openid)
  } catch (err) {
    console.warn('[dataService] 查询供货商账号失败，跳过微信推送:', err)
    return []
  }
}

// 发送微信订阅消息（尽力而为：无模板/无授权/发送失败都只记日志，不阻断主流程）
async function sendSubscribeMessage(user, payload) {
  if (!SUBSCRIBE_TEMPLATE_ID) {
    console.log('[dataService] 订阅消息模板未配置，跳过推送（站内通知已写）', payload.orderNo)
    return
  }
  const dataValue = value => ({ value: String(value || '') })
  const data = {}
  SUBSCRIBE_TEMPLATE_FIELDS.forEach(f => { data['thing' + f.index] = dataValue(payload[f.key]) })
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: user.openid,
      templateId: SUBSCRIBE_TEMPLATE_ID,
      page: 'pages/supplier-orders/supplier-orders',
      data,
      miniprogramState: 'formal'
    })
  } catch (err) {
    // 43101 = 用户未订阅/订阅次数用尽，属预期情况，降级为 debug 日志
    if (err && err.errCode === 43101) {
      console.log('[dataService] 用户未订阅订阅消息，跳过推送:', user.username)
    } else {
      console.error('[dataService] 订阅消息推送失败:', user.username, err)
    }
  }
}

// 审核通过后按供货商分组下推通知：站内消息（scope_type=supplier）+ 微信订阅消息
async function notifySuppliersNewOrder(order, orderItems) {
  const supplierMap = {}
  orderItems.forEach(item => {
    // 清单 #24：手动商品不推送（显式 is_manual 过滤，不依赖 supplier_id 为空的隐式前提）
    if (item.is_manual) return
    const sid = item.supplier_id || ''
    if (!sid) return
    // 下单明细无价格字段（价格快照在收货时才生成），摘要只报项数不报金额
    supplierMap[sid] = (supplierMap[sid] || 0) + 1
  })
  const supplierIds = Object.keys(supplierMap)
  if (!supplierIds.length) return

  // 补齐供应商名称（消息里展示）
  const nameRes = await db.collection('supplier')
    .where({ supplier_id: _.in(supplierIds) })
    .limit(100)
    .get()
  const nameById = {}
  nameRes.data.forEach(s => { nameById[s.supplier_id] = s.supplier_name })

  for (const supplierId of supplierIds) {
    const itemCount = supplierMap[supplierId]
    const supplierName = nameById[supplierId] || supplierId
    const title = '您有新的采购订单'
    const content = `${order.store_name || ''}的采购单 ${order.order_no || order.purchase_order_id} 已审核通过，共 ${itemCount} 项商品，请确认接单。`
    // 站内通知：供货商门户消息中心可见（兜底触达，必写）
    try {
      await createMessage({
        type: 'order',
        title,
        content,
        bizId: order.purchase_order_id,
        scopeType: 'supplier',
        scopeId: supplierId
      })
    } catch (err) {
      console.error('[dataService] 供货商站内通知写入失败:', supplierId, err)
    }
    // 微信服务通知：订阅授权次数内推送
    const users = await getSupplierUsers(supplierId)
    for (const user of users) {
      await sendSubscribeMessage(user, {
        orderNo: order.order_no || order.purchase_order_id,
        storeName: order.store_name || '',
        items: `${itemCount} 项商品`,
        amount: ''
      })
    }
  }
}

module.exports = { notifySuppliersNewOrder }
