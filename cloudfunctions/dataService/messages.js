// 消息域（2026-11-05 拆分自 dataService/index.js）：站内消息写入/查询/已读，
// 以及消息收件人解析（店长定向、离职回退）。
const { crypto, db, _, requireUser, GLOBAL_ROLES } = require('./_shared')

async function createMessage(data) {
  const messageId = 'MSG' + Date.now() + crypto.randomBytes(4).toString('hex')
  await db.collection('message').add({
    data: {
      message_id: messageId,
      type: data.type,
      title: data.title,
      content: data.content,
      biz_id: data.bizId || '',
      recipient_user_id: data.recipientUserId || '',
      store_id: data.storeId || '',
      // 供货商定向消息（S3 补充口径）：scope_type=supplier + scope_id=供应商档案ID
      scope_type: data.scopeType || '',
      scope_id: data.scopeId || '',
      read: false,
      read_by: [],
      created_at: db.serverDate()
    }
  })
}

// 门店店长查询收敛到共享模块（2026-11-05；源头 scripts/cloud-shared/store-query.js，
// sync-shared.js 同步），此处 re-export 保持本文件导出名不变
const { getStoreManagerId } = require('./shared/store-query')

// 定向给单据创建人的消息：创建人已停用/不存在（离职，#17）时改发本店店长，
// 仍查不到则回退 ''（门店广播），避免消息落进死信箱（2026-09-24 拍板）。
async function resolveActiveRecipient(userId, storeId) {
  if (userId) {
    try {
      const res = await db.collection('app_user')
        .where(_.or([{ user_id: userId }, { _id: userId }]))
        .limit(1)
        .get()
      const target = res.data[0]
      if (target && (target.status === undefined ? 1 : target.status) === 1) return userId
    } catch (err) {
      console.warn('[dataService] 查询消息收件人状态失败，按在岗处理:', err)
      return userId
    }
  }
  return await getStoreManagerId(storeId)
}

function publicMessage(message) {
  return {
    id: message._id,
    messageId: message.message_id,
    type: message.type,
    title: message.title,
    content: message.content,
    bizId: message.biz_id || '',
    read: !!message.read,
    time: message.created_at
  }
}

async function getMessages(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const userId = auth.user.user_id || auth.user._id
  // 过滤条件下推到数据库，避免"先取全局最新100条再内存过滤"导致门店消息静默丢失
  const recipientCondition = _.or([
    { recipient_user_id: '' },
    { recipient_user_id: userId },
    { recipient_user_id: _.exists(false) }
  ])
  let query = recipientCondition
  if (auth.user.role === 'supplier') {
    // 供货商消息按供货商档案定向（不绑门店）：只收 scope_type=supplier 且 scope_id 匹配的消息
    query = _.and([recipientCondition, { scope_type: 'supplier', scope_id: auth.user.default_supplier_id || '' }])
  } else {
    // 供应商定向消息不下发给内部角色：这类消息写库时不带 store_id，
    // 下方 storeCondition 的「store_id 为空」分支会把它们漏给厨师/店长/管理员
    const notSupplierCondition = _.or([{ scope_type: '' }, { scope_type: _.exists(false) }])
    if (!GLOBAL_ROLES.includes(auth.user.role)) {
      const storeCondition = _.or([
        { store_id: '' },
        { store_id: auth.user.default_store_id || '' },
        { store_id: _.exists(false) }
      ])
      query = _.and([recipientCondition, storeCondition, notSupplierCondition])
    } else {
      query = _.and([recipientCondition, notSupplierCondition])
    }
  }
  const result = await db.collection('message').where(query).orderBy('created_at', 'desc').limit(100).get()
  const list = result.data.map(message => {
    const readBy = Array.isArray(message.read_by) ? message.read_by : []
    // 兼容旧数据：read 布尔是全局已读；read_by 数组是按用户已读
    return { ...publicMessage(message), read: !!message.read || readBy.includes(userId) }
  })
  return { code: 0, data: list }
}

async function markMessageRead(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '消息信息缺失' }
  const messageResult = await db.collection('message').doc(event.id).get()
  const message = messageResult.data
  if (!message) return { code: -1, msg: '消息不存在' }
  const isGlobal = GLOBAL_ROLES.includes(auth.user.role)
  const belongsToUser = !message.recipient_user_id || message.recipient_user_id === (auth.user.user_id || auth.user._id)
  const belongsToStore = isGlobal || !message.store_id || message.store_id === auth.user.default_store_id
  if (!belongsToUser || !belongsToStore) return { code: -403, msg: '无权操作该消息' }
  // 按用户记录已读：同一门店的其他成员的未读状态不受影响；read_by 去重
  const userId = auth.user.user_id || auth.user._id
  const readBy = Array.isArray(message.read_by) ? message.read_by : []
  if (!readBy.includes(userId)) {
    await db.collection('message').doc(event.id).update({
      data: { read_by: _.push(userId), read_at: db.serverDate() }
    })
  }
  return { code: 0 }
}

async function markAllMessagesRead(event) {
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const userId = auth.user.user_id || auth.user._id
  const result = await getMessages(event)
  if (result.code !== 0) return result
  // 需要拿原始 read_by 判断去重，逐条读原文（getMessages 返回已合并 read 布尔）
  for (const message of result.data.filter(item => !item.read)) {
    const rawRes = await db.collection('message').doc(message.id).get()
    const readBy = Array.isArray(rawRes.data && rawRes.data.read_by) ? rawRes.data.read_by : []
    if (readBy.includes(userId)) continue
    await db.collection('message').doc(message.id).update({
      data: { read_by: _.push(userId), read_at: db.serverDate() }
    })
  }
  return { code: 0 }
}

module.exports = {
  createMessage, getStoreManagerId, resolveActiveRecipient,
  getMessages, markMessageRead, markAllMessagesRead
}
