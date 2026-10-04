// 云函数 createReceipt - 收货确认 + 按验收结果生成收货报表
// 正常收货生成含价格报表；异常收货只生成不含价格报表并登记异常。
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

function csvField(val) {
  let s = String(val == null ? '' : val)
  // 防公式注入：以 = + - @ 开头的值在 Excel/WPS 里会被当作公式执行
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

function safePathPart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名'
}

const ABNORMAL_TYPE_NAMES = {
  shortage: '少货/缺货',
  quality: '质量问题',
  wrong_item: '错货',
  missing_price: '缺价待补'
}

function getItemAbnormalTypes(item) {
  const types = []
  if (item && item.isShortage) types.push('shortage')
  if (item && item.isQualityIssue) types.push('quality')
  if (item && item.isWrongItem) types.push('wrong_item')
  // #11 拍板（2026-09-24）：档案商品缺价视为异常，提醒补价
  if (item && item.isMissingPrice) types.push('missing_price')
  return types
}

function getItemAbnormalNames(item) {
  return getItemAbnormalTypes(item).map(type => ABNORMAL_TYPE_NAMES[type] || type)
}

async function getNextVersion(reportType, scopeId, relatedDate) {
  // P0-4：CAS 取号——读旧值 → 条件更新（count 仍等于旧值才写旧值+1）→ updated===1 才算抢到。
  // 原「_.inc 后回读」是两步操作，并发双方会回读到同一个最终值 → 版本号跳号、report_id 碰撞。
  const counterId = `${reportType}_${scopeId}_${relatedDate}`
  const counters = db.collection('report_version_counter')
  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await counters.doc(counterId).get().catch(() => null)
    const current = doc && doc.data ? Number(doc.data.count) : null
    if (current !== null && Number.isFinite(current) && current >= 0) {
      // 条件更新独占版本号：并发方抢先写入后 where 不再命中（updated===0），重读重试
      const casRes = await counters.where({ _id: counterId, count: current })
        .update({ data: { count: current + 1, updated_at: db.serverDate() } })
      if (casRes.stats && casRes.stats.updated === 1) return current + 1
      continue
    }
    try {
      // 计数器不存在：创建 count=1；_id 撞车说明并发方已建，重试走 CAS 路径
      await counters.add({ data: { _id: counterId, count: 1, updated_at: db.serverDate() } })
      return 1
    } catch (err) {
      // 空 catch 会把「集合不存在/无权限」和「并发撞 _id」压成同一张脸，排查时
      // 只剩一句无信息量的「计数器更新失败」。仅在最后一次重试时带出真实原因。
      if (attempt === 4) console.error('[createReceipt][getNextVersion] 计数器创建失败:', counterId, err)
    }
  }
  throw new Error('getNextVersion: 计数器更新失败')
}

// Backfill the notification for receipts created by an older deployment.
// 门店内消息可见口径（清单 #5）：异常类消息定向给店长（处理责任人），
// 正常类消息保留门店广播。查询门店店长的 user_id，查不到则回退广播（''）。
async function getStoreManagerId(storeId) {
  try {
    const res = await db.collection('app_user')
      .where({ role: 'store_manager', default_store_id: storeId, status: 1 })
      .limit(1)
      .get()
    return (res.data[0] && (res.data[0].user_id || res.data[0]._id)) || ''
  } catch (err) {
    console.warn('[createReceipt] 查询门店店长失败，消息回退门店广播:', err)
    return ''
  }
}

// 查询超级管理员 user_id（全局唯一账号）。报表补生成仅 purchaser/super_admin
// 可执行（清单 #7），失败通知定向给能行动的人；store_id 保留供店长兜底查看。
async function getSuperAdminId() {
  try {
    const res = await db.collection('app_user')
      .where({ role: 'super_admin', status: 1 })
      .limit(1)
      .get()
    return (res.data[0] && (res.data[0].user_id || res.data[0]._id)) || ''
  } catch (err) {
    console.warn('[createReceipt] 查询超级管理员失败，消息回退门店广播:', err)
    return ''
  }
}

// This is intentionally best-effort on the duplicate path: an existing
// receipt must remain reportable even if the message collection is unavailable.
async function ensureReceiptMessage(receipt, fallbackStoreId, fallbackStoreName) {
  const receiptId = receipt && (receipt.receipt_id || receipt.receiptId)
  if (!receiptId) return
  try {
    const existing = await db.collection('message')
      .where({ biz_id: receiptId })
      .limit(1)
      .get()
    if (existing.data.length > 0) return
    const receiptDate = receipt.receipt_date || new Date().toISOString().slice(0, 10)
    const storeId = receipt.store_id || fallbackStoreId || ''
    const storeName = receipt.store_name || fallbackStoreName || ''
    const isAbnormal = receipt.receipt_status === 'abnormal'
    // 清单 #5：异常消息定向给店长，正常消息门店广播（与主流程写入口径一致）
    const recipient = isAbnormal ? await getStoreManagerId(storeId) : ''
    await db.collection('message').add({
      data: {
        message_id: `MSG_RECEIVE_${receiptId}`,
        type: isAbnormal ? 'abnormal' : 'receive',
        title: isAbnormal ? '收货异常待处理' : '收货验收完成',
        content: isAbnormal
          ? `${receiptDate} ${storeName}收货存在异常，请及时处理`
          : `${receiptDate} ${storeName}采购单已完成收货验收`,
        biz_id: receiptId,
        recipient_user_id: recipient,
        store_id: storeId,
        read: false,
        created_at: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[createReceipt] 收货消息补写失败:', err)
  }
}

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    if (!['store_manager', 'super_admin', 'purchaser'].includes(user.role)) return { code: -403, msg: '当前账号无权提交收货验收' }
    let {
      purchaseOrderId,
      storeId,
      storeName,
      receivedBy = '',
      overallRemark = '',
      photoFileIds = [],
      items
    } = event || {}
    const isGlobal = ['super_admin', 'purchaser'].includes(user.role)
    if (!isGlobal) {
      if (!user.default_store_id || (storeId && storeId !== user.default_store_id)) return { code: -403, msg: '无权为其他门店提交收货' }
      storeId = user.default_store_id
      const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
      if (!storeRes.data.length) return { code: -403, msg: '账号未关联有效门店' }
      storeName = storeRes.data[0].store_name
    }
    if (!purchaseOrderId) {
      return { code: -1, msg: '订单信息缺失，请返回订单列表后重新进入验收' }
    }
    if (!storeId || !storeName) {
      return { code: -1, msg: '门店信息缺失，请重新登录或切换门店后再试' }
    }
    const storeRes = await db.collection('store').where({ store_id: storeId, status: 1 }).limit(1).get()
    if (!storeRes.data.length) return { code: -403, msg: '门店不存在或已停用' }
    storeName = storeRes.data[0].store_name
    if (!Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '验收商品信息为空，请返回订单后重试' }
    }
    if (items.length > 50) {
      // P2-15：单事务最坏 ≈ 行数×(1明细+4异常)+单据+订单+消息 ≈ 6×行数。
      // 100 行时 >600 操作，触及平台单事务上限会硬失败（不重试）——压到 50 行保安全
      return { code: -1, msg: '每单验收商品最多50种，请分批提交收货' }
    }
    const hasInvalidItem = items.some(item => (
      !item || !item.productId || !item.productName || !item.unit ||
      typeof item.receivedQty !== 'number' || !Number.isFinite(item.receivedQty) || item.receivedQty < 0 ||
      typeof item.orderQty !== 'number' || !Number.isFinite(item.orderQty)
    ))
    if (hasInvalidItem) {
      return { code: -1, msg: '部分商品的验收信息不完整，请检查后重试' }
    }
    if (!Array.isArray(photoFileIds)) {
      return { code: -1, msg: '验收照片信息格式不正确，请重新选择照片' }
    }
    if (photoFileIds.length > 9) {
      return { code: -1, msg: '验收照片最多9张' }
    }
    // 照片 fileID 必须位于本订单的上传目录下（路径规则见 utils/cloud.js 的 uploadReceiptPhotos）
    const photoPrefix = `receipts/${purchaseOrderId}/`
    if (photoFileIds.some(id => typeof id !== 'string' || !id.startsWith(photoPrefix))) {
      return { code: -1, msg: '验收照片信息无效，请重新上传' }
    }

    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1)
      .get()
    if (orderRes.data.length === 0) {
      return { code: -1, msg: '采购订单不存在或已失效，请刷新订单后重试' }
    }
    const order = orderRes.data[0]
    if (order.store_id && order.store_id !== storeId) {
      return { code: -1, msg: '订单门店与当前门店不一致，请切换门店后重试' }
    }
    if (!['approved', 'report_generated', 'partial_received'].includes(order.order_status)) {
      return { code: -1, msg: '订单尚未审批通过，不可收货' }
    }
    storeName = order.store_name || storeName
    receivedBy = user.name || user.username || receivedBy
    if (!isGlobal && order.store_id !== user.default_store_id) return { code: -403, msg: '无权验收其他门店订单' }

    // The order lines in the database are authoritative. Do not trust the
    // client to identify products, suppliers, units, or ordered quantities.
    const orderItemsRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1000)
      .get()
    const orderItems = orderItemsRes.data || []
    if (orderItems.length === 0) return { code: -1, msg: '订单明细不存在，无法提交收货' }
    const orderItemMap = {}
    orderItems.forEach(orderItem => {
      const key = orderItem.item_id || orderItem._id
      if (key) orderItemMap[key] = orderItem
    })
    const seenOrderItems = {}
    const canonicalItems = []
    // B3 分批收货：只校验本次提交的订单行，并限制「本次实收 + 历史累计实收 ≤ 下单量」。
    // 历史累计按全部订单行聚合，用于判断本批收完后订单是否收齐。
    const allOrderItemIds = orderItems.map(oi => oi.item_id || oi._id).filter(Boolean)
    const historyRes = await db.collection('receipt_item')
      .where({ purchase_order_item_id: _.in(allOrderItemIds) })
      .limit(1000)
      .get()
    const historyQtyMap = {}
    ;(historyRes.data || []).forEach(h => {
      const key = h.purchase_order_item_id
      if (!key) return
      historyQtyMap[key] = (historyQtyMap[key] || 0) + (Number(h.received_qty) || 0)
    })
    for (let i = 0; i < items.length; i++) {
      const inputItem = items[i]
      const orderItemId = inputItem.orderItemId
      const orderItem = orderItemMap[orderItemId]
      if (!orderItem || seenOrderItems[orderItemId]) {
        return { code: -1, msg: '验收明细与采购订单不匹配，请刷新订单后重试' }
      }
      seenOrderItems[orderItemId] = true
      const orderQty = Number(orderItem.order_qty)
      const receivedQty = Number(inputItem.receivedQty)
      const historyQty = historyQtyMap[orderItemId] || 0
      if (!Number.isFinite(orderQty) || orderQty < 0 || !Number.isFinite(receivedQty) || receivedQty < 0) {
        return { code: -1, msg: '实收数量不能超过订单数量，请检查后重试' }
      }
      if (historyQty + receivedQty > orderQty) {
        return { code: -1, msg: `商品${orderItem.product_name_snapshot}累计实收超过下单量，请检查后重试` }
      }
      canonicalItems.push({
        ...inputItem,
        orderItemId,
        productId: orderItem.product_id,
        productName: orderItem.product_name_snapshot,
        supplierId: orderItem.supplier_id || '',
        isManual: !!orderItem.is_manual,
        orderQty,
        unit: orderItem.unit_snapshot,
        receivedQty
      })
    }
    items = canonicalItems
    // 本批至少要收一件商品（或有异常标记），避免空批次
    const hasReceivedAny = items.some(item => item.receivedQty > 0)
    const hasMarkedAny = items.some(item => getItemAbnormalTypes(item).length > 0)
    if (!hasReceivedAny && !hasMarkedAny) {
      return { code: -1, msg: '本批未收任何商品，请填写本次实收数量后重试' }
    }
    // B3 批次号：历史收货单数量 + 1
    const historyReceiptRes = await db.collection('receipt')
      .where({ purchase_order_id: purchaseOrderId })
      .limit(1000)
      .get()
    const batchNo = historyReceiptRes.data.length + 1
    if (order.order_status === 'received') {
      return { code: -1, msg: '该订单已全部收货完成，请勿重复提交' }
    }

    // 收货日期：优先用客户端传入的本地日期（校验格式），否则按 UTC+8 取服务端日期，
    // 避免凌晨 0-8 点收货被归档到前一天。
    const isReceiptDate = value => {
      const text = String(value || '')
      const date = new Date(`${text}T00:00:00Z`)
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    }
    const receiptDate = isReceiptDate(event.receiptDate)
      ? event.receiptDate
      : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    // 加随机后缀防并发碰撞（同毫秒创建多张收货单）
    const receiptId = 'RCP' + Date.now() + crypto.randomBytes(3).toString('hex')

    // P2-14：店长 ID 在事务外预取（普通查询），事务内只消费结果
    const abnormalRecipient = await getStoreManagerId(storeId)

    // 实收少于下单即为少货，即使用户未手动勾选也按异常处理：
    // 避免短收被静默记为"已收货"，少货行不进入付款结算，走异常流程跟进。
    // B3 分批收货：按「历史累计实收 + 本次实收」与下单量比较——此处为预检，
    // P0-3/P1-5/P1-16：事务内会用新鲜 txHistoryQty 重算，并发下以事务内为准。
    items.forEach(item => {
      const cumulativeQty = (historyQtyMap[item.orderItemId] || 0) + item.receivedQty
      if (cumulativeQty < item.orderQty) item.isShortage = true
    })

    let hasAbnormal = items.some(item => getItemAbnormalTypes(item).length > 0)
    let abnormalTypeNames = [...new Set(items.reduce((all, item) => all.concat(getItemAbnormalNames(item)), []))]

    // 价格以数据库中的价格为准，避免客户端旧价格进入结算报表。
    // 批量取价：按 product_id 分块一次查回，再在内存中按 (供应商, 商品) 匹配，
    // 避免每条明细一次数据库请求。
    const priceMap = {}
    // S9 拍板（2026-09-22）：手动商品行跳过协议价查询——价格走凭证核销回填（verify_amount），
    // 不查 supplier_product_price（手动商品无档案/无供应商，查不到是预期行为）。
    const priceProductIds = [...new Set(items.filter(item => item.supplierId && !item.isManual).map(item => item.productId))]
    for (let i = 0; i < priceProductIds.length; i += 20) {
      const idChunk = priceProductIds.slice(i, i + 20)
      // P1-11（#10 口径"结算取收货日现价"）：按 effective_date <= 收货日的价格行中
      // 取最新一档，而非只看 is_current 标志——补录历史日期（#16 允许）时
      // is_current 指向今天的价，会把历史单据的价格快照写错。
      // 同日多行时优先 is_current；收货日之前无任何价格行则视为缺价，走 missing_price 流程。
      const priceRes = await db.collection('supplier_product_price')
        .where({ product_id: _.in(idChunk), effective_date: _.lte(receiptDate) })
        .limit(1000)
        .get()
      const priceCandidates = {}
      priceRes.data.forEach(p => {
        const key = `${p.supplier_id}|${p.product_id}`
        const cur = priceCandidates[key]
        if (!cur) { priceCandidates[key] = p; return }
        const cmp = String(p.effective_date || '').localeCompare(String(cur.effective_date || ''))
        if (cmp > 0 || (cmp === 0 && p.is_current === 1 && cur.is_current !== 1)) priceCandidates[key] = p
      })
      Object.keys(priceCandidates).forEach(key => { priceMap[key] = Number(priceCandidates[key].price) || 0 })
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const priceSnapshot = item.supplierId ? (priceMap[`${item.supplierId}|${item.productId}`] || 0) : 0
      item.priceSnapshot = priceSnapshot
      // Never present a zero-priced line as payable. A missing current price
      // requires price setup before it can enter the payable total.
      // 付款裁决（B4）：少货行按实收数量付款（账单本身以 received_qty 计价，
      // 未到货部分自然不出现在账单中），故纯少货不剔除；质量/错货行不得进入付款结算。
      const abnormalTypes = getItemAbnormalTypes(item)
      const hardAbnormal = abnormalTypes.some(t => t !== 'shortage')
      // S9 拍板（2026-09-22）：手动商品行无协议价为预期行为，0 价不视为异常；
      // 金额在凭证核销时按实付回填（订单 verify_amount），不进带价报表结算。
      if (item.isManual) {
        item.payableFlag = false
      } else {
        // P1-10：付款资格完全由服务端裁决（异常类型 + 协议价），不信任客户端传来的
        // payableFlag——否则改客户端参数即可把正常行挤出（或塞回）结算账单
        item.payableFlag = !hardAbnormal && priceSnapshot > 0
        // #11 拍板（2026-09-24）：档案商品缺价不再是静默漏账——标记 missing_price，
        // 生成 abnormal_record 提醒补价，补价后可走 repriceReceipt 补出账单。
        if (!item.isManual && priceSnapshot <= 0 && item.supplierId && item.receivedQty > 0) {
          item.isMissingPrice = true
        }
      }
    }

    // P0-3：终态判定（is_final）已移入事务内用新鲜 txHistoryQty 重算，
    // 事务外快照在并发（SDK 事务冲突自动重试）下必然过期，会造成订单永久卡 partial_received

    // 收货主表、明细和订单状态必须同时成功或同时回滚。
    // committedBatchNo 由事务内赋值，提交后用于 CSV 批次展示，保证与落库 batch_no 一致
    let committedBatchNo = batchNo
    // P0-3：事务内重算的终态结果回传到事务外，供 CSV 表头「（收齐）」标记使用
    let committedIsFinal = false
    await db.runTransaction(async transaction => {
      const latestOrderRes = await transaction.collection('purchase_order').doc(order._id).get()
      // B3 分批收货：已全部收齐（received）才拦截；receipt_abnormal 状态允许继续补收
      if (!latestOrderRes.data || latestOrderRes.data.order_status === 'received') {
        const duplicateError = new Error('RECEIPT_EXISTS')
        duplicateError.code = 'RECEIPT_EXISTS'
        throw duplicateError
      }
      if (!['approved', 'report_generated', 'partial_received'].includes(latestOrderRes.data.order_status)) {
        const statusError = new Error('ORDER_NOT_RECEIVABLE')
        statusError.code = 'ORDER_NOT_RECEIVABLE'
        throw statusError
      }

      // 事务内复查历史累计实收，防止并发提交超收（事务外的校验只是预检）。
      // P0-3：必须覆盖「全部订单行」的历史（不只本批行），否则 is_final 会把
      // 其他并发批次已收齐的行误判为未收齐
      const txItemIds = [...new Set(orderItems.map(oi => oi.item_id || oi._id).filter(Boolean)
        .concat(items.map(item => item.orderItemId).filter(Boolean)))]
      const txHistoryRes = await transaction.collection('receipt_item')
        .where({ purchase_order_item_id: _.in(txItemIds) })
        .limit(1000)
        .get()
      const txHistoryQty = {}
      ;(txHistoryRes.data || []).forEach(h => {
        const key = h.purchase_order_item_id
        if (!key) return
        txHistoryQty[key] = (txHistoryQty[key] || 0) + (Number(h.received_qty) || 0)
      })
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const orderQty = Number(item.orderQty)
        const txHistoryQtyVal = txHistoryQty[item.orderItemId] || 0
        if (!Number.isFinite(orderQty) || txHistoryQtyVal + item.receivedQty > orderQty) {
          const overError = new Error(`OVER_RECEIVE:${item.productName}`)
          overError.code = 'OVER_RECEIVE'
          throw overError
        }
      }

      // P0-3/P1-5/P1-16：用事务内新鲜的 txHistoryQty 重算终态与短收。
      // 事务外快照在 SDK 事务冲突自动重试整个回调时必然过期。
      const thisQtyMap = {}
      items.forEach(item => { thisQtyMap[item.orderItemId] = (thisQtyMap[item.orderItemId] || 0) + item.receivedQty })
      const txIsFinalBatch = orderItems.every(oi => {
        const key = oi.item_id || oi._id
        return (txHistoryQty[key] || 0) + (thisQtyMap[key] || 0) >= (Number(oi.order_qty) || 0)
      })
      // P1-16：非最终批（还有行未收齐）不生成 shortage 异常——短收只在最终批判定，
      // 避免正常分批收货把异常台账灌满虚假 shortage 记录
      if (!txIsFinalBatch) {
        items.forEach(item => { item.isShortage = false })
      }
      hasAbnormal = items.some(item => getItemAbnormalTypes(item).length > 0)
      abnormalTypeNames = [...new Set(items.reduce((all, item) => all.concat(getItemAbnormalNames(item)), []))]

      // 批次号在事务内按已提交收货单数生成，避免并发重号
      const txHistoryReceiptRes = await transaction.collection('receipt')
        .where({ purchase_order_id: purchaseOrderId })
        .limit(1000)
        .get()
      const txBatchNo = txHistoryReceiptRes.data.length + 1
      committedBatchNo = txBatchNo
      committedIsFinal = txIsFinalBatch

      await transaction.collection('receipt').add({
        data: {
          receipt_id: receiptId, purchase_order_id: purchaseOrderId,
          store_id: storeId, store_name: storeName,
          receipt_date: receiptDate,
          // 清单 #16 拍板（2026-09-28）：补录历史收货日期打 backfilled 标记供对账区分
          backfilled: isReceiptDate(event.receiptDate) && receiptDate < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
          received_by: receivedBy,
          receipt_status: hasAbnormal ? 'abnormal' : 'completed', overall_remark: overallRemark,
          photo_file_ids: photoFileIds.filter(Boolean),
          batch_no: txBatchNo,
          is_final: txIsFinalBatch,
          created_at: db.serverDate()
        }
      })

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        await transaction.collection('receipt_item').add({
          data: {
            receipt_item_id: receiptId + '_' + (i + 1),
            receipt_id: receiptId,
            purchase_order_item_id: item.orderItemId || '',
            product_id: item.productId,
            product_name: item.productName,
            supplier_id: item.supplierId || '',
            received_qty: item.receivedQty,
            order_qty_snapshot: item.orderQty,
            unit_snapshot: item.unit,
            price_snapshot: item.priceSnapshot,
            payable_flag: item.payableFlag !== false,
            // S9：手动商品行标记——金额待凭证核销回填，0 价为预期行为
            is_manual: !!item.isManual,
            is_shortage: !!item.isShortage,
            is_quality_issue: !!item.isQualityIssue,
            is_wrong_item: !!item.isWrongItem,
            remark: item.remark || '',
            created_at: db.serverDate()
          }
        })

        const abnormalTypes = []
        if (item.isShortage) abnormalTypes.push('shortage')
        if (item.isQualityIssue) abnormalTypes.push('quality')
        if (item.isWrongItem) abnormalTypes.push('wrong_item')
        if (item.isMissingPrice) abnormalTypes.push('missing_price')
        for (let j = 0; j < abnormalTypes.length; j++) {
          const type = abnormalTypes[j]
          let description = `${item.productName}验收异常`
          if (type === 'shortage') {
            description = `${item.productName}下单${item.orderQty}${item.unit}，实收${item.receivedQty}${item.unit}`
          } else if (type === 'quality') {
            description = `${item.productName}存在质量问题`
          } else if (type === 'wrong_item') {
            description = `${item.productName}存在错货问题`
          } else if (type === 'missing_price') {
            description = `${item.productName}未配置供应商协议价，实收${item.receivedQty}${item.unit}未进结算，请补价后补账`
          }
          if (item.remark) description += `：${item.remark}`
          await transaction.collection('abnormal_record').add({
            data: {
              abnormal_id: `${receiptId}_${i + 1}_${type}`,
              receipt_id: receiptId,
              purchase_order_id: purchaseOrderId,
              product_id: item.productId,
              supplier_id: item.supplierId || '',
              store_id: storeId,
              store_name: storeName,
              type,
              description,
              status: 'pending',
              resolution: '',
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          })
        }
      }

      // B3 分批收货：本批收齐→received（有异常则 receipt_abnormal），未收齐→partial_received
      // （P0-3：txIsFinalBatch 为事务内新鲜重算值）
      const nextStatus = txIsFinalBatch ? (hasAbnormal ? 'receipt_abnormal' : 'received') : 'partial_received'
      await transaction.collection('purchase_order')
        .doc(order._id)
        .update({ data: { order_status: nextStatus, updated_at: db.serverDate() } })

      // The message is part of the same transaction as the receipt, so a
      // committed receipt always appears in the message center.  A stable id
      // also makes the record easy to identify if the client retries after a
      // lost response.
      // 清单 #5 门店内消息可见口径：异常消息定向给店长（处理责任人），
      // 正常收货完成消息保留门店广播（厨师等全员可见）。
      // P2-14：店长查询已在事务外预取（abnormalRecipient 由外部变量带入）——
      // 事务内跑普通查询不带 transactionId，既不受隔离保护又拉长事务墙钟时间
      await transaction.collection('message').add({
        data: {
          message_id: `MSG_RECEIVE_${receiptId}`,
          type: hasAbnormal ? 'abnormal' : 'receive',
          title: hasAbnormal ? '收货异常待处理' : '收货验收完成',
          content: hasAbnormal
            ? `${receiptDate} ${storeName}收货存在${abnormalTypeNames.join('、')}，请及时处理`
            : `${receiptDate} ${storeName}采购单已完成收货验收`,
          biz_id: receiptId,
          recipient_user_id: hasAbnormal ? abnormalRecipient : '',
          store_id: storeId,
          read: false,
          created_at: db.serverDate()
        }
      })
    })

    const reportsGenerated = []
    let reportWarning = ''
    // 单据信息头共用字段：订单号、门店、收货日期、下单日期、期望到货、经办人
    const orderDateStr = order.order_date || ''
    const deliveryDateStr = order.delivery_date || ''
    const infoHead = [csvField('采购单号'), csvField(purchaseOrderId), csvField('门店'), csvField(storeName), csvField('收货日期'), csvField(receiptDate), csvField('下单日期'), csvField(orderDateStr), csvField('期望到货'), csvField(deliveryDateStr), csvField('验收人'), csvField(receivedBy || ''), csvField('批次'), csvField(`第${committedBatchNo}批${committedIsFinal ? '（收齐）' : ''}`)].join(',') + '\n'

    // 批量查供应商名称（明细行供应商字段供各报表使用）
    const supplierNameMap = {}
    const allSupplierIds = [...new Set(items.map(item => item.supplierId).filter(Boolean))]
    for (let i = 0; i < allSupplierIds.length; i += 20) {
      const idChunk = allSupplierIds.slice(i, i + 20)
      const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
      supRes.data.forEach(s => { supplierNameMap[s.supplier_id] = s.supplier_name })
    }
    items.forEach(item => { item.supplierName = supplierNameMap[item.supplierId] || item.supplierId || '' })

    try {
      // ===== 报表1: 门店收货报表 =====
      const v1 = await getNextVersion('store_receipt_report', storeId, receiptDate)
      let csv1 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('下单数量'), csvField('实收数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注'), csvField('是否可付款')].join(',') + '\n'
      items.forEach(item => {
        const abnormalNames = getItemAbnormalNames(item)
        csv1 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(item.orderQty), csvField(item.receivedQty), csvField(item.unit), csvField(abnormalNames.length ? '收货异常' : '正常'), csvField(abnormalNames.join('、')), csvField(item.remark || ''), csvField(item.payableFlag !== false ? '是' : '否')].join(',') + '\n'
      })
      const f1 = `reports/store/${receiptDate}/store-receipt-${safePathPart(storeName)}-${receiptDate}-${receiptId}-v${v1}.csv`
      const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv1, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SR_' + receiptId, report_type: 'store_receipt_report',
          report_scope: 'store', scope_id: storeId, scope_name: storeName,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: f1, file_url: u1.fileID, file_version: v1,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          has_abnormal: hasAbnormal, abnormal_summary: abnormalTypeNames.join('、')
        }
      })
      reportsGenerated.push('store_receipt_report')

    // 行级结算隔离（B4/B6）：异常只阻塞异常行，不阻塞正常商品。
    // 带价报表始终生成，但只包含可付款（payableFlag=true）的正常行；
    // 异常行的数量与异常类型记录在不含价的收货报表中，走异常流程跟进。
    // ===== 报表2: 门店带价格收货报表（仅可付款行） =====
    {
      // 清单 #24 双保险：手动行不进带价报表（payableFlag 本就为 false，显式过滤防供应商建档后失效）
      const payableItems = items.filter(item => item.payableFlag && !item.isManual)
      if (payableItems.length > 0) {
        const v2 = await getNextVersion('store_receipt_price_report', storeId, receiptDate)
        let csv2 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('实收数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('是否可付款')].join(',') + '\n'
        let totalAmount = 0
        payableItems.forEach(item => {
          const price = item.priceSnapshot || 0
          // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
          const subtotal = Math.round(item.receivedQty * price * 100) / 100
          totalAmount = Math.round((totalAmount + subtotal) * 100) / 100
          csv2 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(subtotal.toFixed(2)), csvField('是')].join(',') + '\n'
        })
        csv2 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(totalAmount.toFixed(2)), csvField('')].join(',') + '\n'
        const f2 = `reports/store/${receiptDate}/store-receipt-price-${safePathPart(storeName)}-${receiptDate}-${receiptId}-v${v2}.csv`
        const u2 = await cloud.uploadFile({ cloudPath: f2, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv2, 'utf-8') })
        await db.collection('report_file').add({
          data: {
            report_id: 'RPT_SRP_' + receiptId, report_type: 'store_receipt_price_report',
            report_scope: 'store', scope_id: storeId, scope_name: storeName,
            related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
            file_name: f2, file_url: u2.fileID, file_version: v2,
            generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
            has_abnormal: hasAbnormal, abnormal_summary: abnormalTypeNames.join('、'),
            excluded_rows: items.length - payableItems.length
          }
        })
        reportsGenerated.push('store_receipt_price_report')
      }
    }

    // ===== 按供应商分组 =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplierId || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
      supplierMap[sid].items.push(item)
    })
    // 批量查供应商名称，避免每个供应商一次数据库请求
    const receiptSupplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
    for (let i = 0; i < receiptSupplierIds.length; i += 20) {
      const idChunk = receiptSupplierIds.slice(i, i + 20)
      const supRes = await db.collection('supplier').where({ supplier_id: _.in(idChunk) }).limit(100).get()
      supRes.data.forEach(s => {
        if (supplierMap[s.supplier_id]) supplierMap[s.supplier_id].name = s.supplier_name
      })
    }

    // ===== 报表3: 供应商到货汇总（不含价格） =====
    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const supplierHasAbnormal = supItems.some(item => getItemAbnormalTypes(item).length > 0)
      const supplierAbnormalSummary = [...new Set(supItems.reduce((all, item) => all.concat(getItemAbnormalNames(item)), []))].join('、')
      const v3 = await getNextVersion('supplier_receipt_report', sid, receiptDate)

      let csv3 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('下单数量'), csvField('单位'), csvField('验收状态'), csvField('异常类型'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        const abnormalNames = getItemAbnormalNames(item)
        csv3 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(storeName), csvField(item.receivedQty), csvField(item.orderQty), csvField(item.unit), csvField(abnormalNames.length ? '收货异常' : '正常'), csvField(abnormalNames.join('、')), csvField(item.remark || '')].join(',') + '\n'
      })

      const f3 = `reports/supplier/${receiptDate}/supplier-receipt-${safePathPart(supName)}-${receiptDate}-${receiptId}-v${v3}.csv`
      const u3 = await cloud.uploadFile({ cloudPath: f3, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv3, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUR_' + sid + '_' + receiptId, report_type: 'supplier_receipt_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: f3, file_url: u3.fileID, file_version: v3,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          has_abnormal: supplierHasAbnormal, abnormal_summary: supplierAbnormalSummary
        }
      })
      reportsGenerated.push('supplier_receipt_report:' + sid)
    }

    // ===== 报表4: 供应商带价格账单（仅可付款行，行级隔离） =====
    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue
      // 清单 #24 双保险：手动行不进供应商带价报表
      const supPayableItems = supplierMap[sid].items.filter(item => item.payableFlag && !item.isManual)
      if (supPayableItems.length === 0) continue
      const supName = supplierMap[sid].name || sid
      const v4 = await getNextVersion('supplier_receipt_price_report', sid, receiptDate)

      let csv4 = infoHead + [csvField('商品名称'), csvField('供应商'), csvField('门店'), csvField('到货数量'), csvField('单位'), csvField('单价'), csvField('小计'), csvField('可付款')].join(',') + '\n'
      let sTotal = 0
      supPayableItems.forEach(item => {
        const price = item.priceSnapshot || 0
        // 逐行先舍入到分再累加，保证"各行小计之和"与"合计"一致
        const sub = Math.round(item.receivedQty * price * 100) / 100
        sTotal = Math.round((sTotal + sub) * 100) / 100
        csv4 += [csvField(item.productName), csvField(item.supplierName || item.supplierId || ''), csvField(storeName), csvField(item.receivedQty), csvField(item.unit), csvField(price), csvField(sub.toFixed(2)), csvField('是')].join(',') + '\n'
      })
      csv4 += [csvField('合计'), csvField(''), csvField(''), csvField(''), csvField(''), csvField(''), csvField(sTotal.toFixed(2)), csvField('')].join(',') + '\n'

      const f4 = `reports/supplier/${receiptDate}/supplier-receipt-price-${safePathPart(supName)}-${receiptDate}-${receiptId}-v${v4}.csv`
      const u4 = await cloud.uploadFile({ cloudPath: f4, fileContent: Buffer.from(String.fromCharCode(0xFEFF) + csv4, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SURP_' + sid + '_' + receiptId, report_type: 'supplier_receipt_price_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: receiptDate, source_order_id: purchaseOrderId, basis_date_type: 'receipt_date',
          file_name: f4, file_url: u4.fileID, file_version: v4,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated',
          excluded_rows: supplierMap[sid].items.length - supPayableItems.length
        }
      })
      reportsGenerated.push('supplier_receipt_price_report:' + sid)
    }
    } catch (reportErr) {
      console.error('[createReceipt] 收货已保存，但报表生成失败:', reportErr)
      reportWarning = '报表生成失败，请联系管理员处理。'
      // 清单 #7 报表失败补偿：缺口从"静默缺失"变为"有标记、有提示"。
      // 订单打 missing_reports 标记（报表/订单详情页据此展示"缺报表"），
      // 并定向通知管理员补生成（dataService.regenerateReceiptReports）。
      try {
        await db.collection('purchase_order').doc(order._id).update({
          data: { missing_reports: true, updated_at: db.serverDate() }
        })
        // 收货单本身也打标记，getReceipts 列表随记录带出，前端据此展示"缺报表"
        await db.collection('receipt').where({ receipt_id: receiptId }).update({
          data: { missing_reports: true }
        })
        // 补生成仅 purchaser/super_admin 可执行（清单 #7），通知定向给能行动的人
        const reportFailRecipient = await getSuperAdminId()
        await db.collection('message').add({
          data: {
            message_id: `MSG_REPORT_MISSING_${receiptId}`,
            type: 'abnormal',
            title: '收货报表生成失败',
            content: `采购单 ${purchaseOrderId} 收货已保存，但报表生成失败，请管理员在收货记录中补生成。`,
            biz_id: receiptId,
            recipient_user_id: reportFailRecipient,
            store_id: storeId,
            read: false,
            created_at: db.serverDate()
          }
        })
      } catch (markErr) {
        console.error('[createReceipt] 缺报表标记/通知写入失败:', markErr)
      }
    }

    return {
      code: 0,
      data: {
        receiptId,
        reportsGenerated: reportsGenerated.length,
        reportWarning,
        hasAbnormal,
        abnormalTypeNames,
        priceReportsSkipped: hasAbnormal
      }
    }
  } catch (err) {
    if (err && (err.code === 'RECEIPT_EXISTS' || err.message === 'RECEIPT_EXISTS')) {
      return { code: -1, msg: '该订单已完成收货，请勿重复提交' }
    }
    if (err && (err.code === 'ORDER_NOT_RECEIVABLE' || err.message === 'ORDER_NOT_RECEIVABLE')) {
      return { code: -1, msg: '当前订单状态不可收货，请刷新订单后重试' }
    }
    if (err && (err.code === 'OVER_RECEIVE' || (err.message || '').startsWith('OVER_RECEIVE:'))) {
      return { code: -1, msg: `商品${String(err.message || '').split(':')[1] || ''}累计实收超过下单量，请检查后重试` }
    }
    console.error('[createReceipt] 收货验收提交失败:', err)
    return { code: -1, msg: '收货验收提交失败，请稍后重试' }
  }
}
