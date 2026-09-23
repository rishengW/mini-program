const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const USER_COLLECTION = 'app_user'
const STORE_COLLECTION = 'store'
const SUPPLIER_COLLECTION = 'supplier'
const PASSWORD_ITERATIONS = 120000
const PASSWORD_KEY_LENGTH = 32
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ROLE_LABELS = {
  chef: '门店下单人员',
  store_manager: '店长',
  purchaser: '管理员',
  super_admin: '超级管理员',
  supplier: '供货商'
}
const STORE_ROLES = ['chef', 'store_manager']
const SUPPLIER_ROLE = 'supplier'

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function hashPassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  return crypto.pbkdf2Sync(
    String(password),
    salt,
    Number(iterations) || PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    'sha256'
  ).toString('hex')
}

function verifyPassword(password, user) {
  if (!user.password_hash || !user.password_salt) return false
  const actual = Buffer.from(hashPassword(password, user.password_salt, user.password_iterations), 'hex')
  const expected = Buffer.from(user.password_hash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function publicUser(user) {
  return {
    id: user._id,
    userId: user.user_id || user._id,
    username: user.username,
    name: user.name,
    mobile: user.mobile || '',
    role: user.role,
    roleLabel: user.role_label || ROLE_LABELS[user.role] || user.role,
    defaultStoreId: user.default_store_id || null,
    defaultSupplierId: user.default_supplier_id || null,
    status: user.status === undefined ? 1 : user.status
  }
}

function publicStore(store) {
  if (!store) return null
  return {
    id: store._id,
    storeId: store.store_id,
    storeName: store.store_name,
    storeCode: store.store_code || store.store_id,
    status: store.status
  }
}

async function findStore(storeId) {
  if (!storeId) return null
  const result = await db.collection(STORE_COLLECTION)
    .where({ store_id: storeId, status: 1 })
    .limit(1)
    .get()
  return result.data[0] || null
}

async function findSupplier(supplierId) {
  if (!supplierId) return null
  const result = await db.collection(SUPPLIER_COLLECTION)
    .where({ supplier_id: supplierId, status: 1 })
    .limit(1)
    .get()
  return result.data[0] || null
}

async function getDefaultStore(user) {
  const assignedStore = await findStore(user.default_store_id)
  if (assignedStore) return assignedStore
  if (STORE_ROLES.includes(user.role)) return null

  const result = await db.collection(STORE_COLLECTION)
    .where({ status: 1 })
    .orderBy('store_code', 'asc')
    .limit(1)
    .get()
  return result.data[0] || null
}

async function getSessionUser(authToken) {
  if (!authToken) return null
  const tokenHash = hashToken(authToken)
  const result = await db.collection(USER_COLLECTION)
    .where({ status: 1, sessions: { token_hash: tokenHash } })
    .limit(1)
    .get()
  let user = result.data[0]
  if (!user) {
    // 兼容旧单会话字段（未重新登录的历史设备）
    const legacy = await db.collection(USER_COLLECTION)
      .where({ session_token_hash: tokenHash, status: 1 })
      .limit(1)
      .get()
    user = legacy.data[0]
    if (!user || !user.session_expires_at) return null
    const legacyExpires = new Date(user.session_expires_at).getTime()
    if (!Number.isFinite(legacyExpires) || legacyExpires <= Date.now()) return null
    return user
  }
  const session = (user.sessions || []).find(s => s && s.token_hash === tokenHash)
  if (!session || !session.expires_at) return null
  const expiresAt = new Date(session.expires_at).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  return user
}

function validateUserInput(data, requirePassword) {
  const username = normalizeUsername(data.username)
  const name = String(data.name || '').trim()
  const password = String(data.password || '')
  const role = data.role

  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    return { error: '账号只能包含3-32位字母、数字、点、横线或下划线' }
  }
  if (!name) return { error: '请输入用户姓名' }
  if (!ROLE_LABELS[role]) return { error: '用户角色无效' }
  if ((requirePassword || password) && password.length < 6) {
    return { error: '密码至少需要6位' }
  }
  if (STORE_ROLES.includes(role) && !data.defaultStoreId) {
    return { error: '该角色必须关联门店' }
  }
  if (role === SUPPLIER_ROLE && !data.defaultSupplierId) {
    return { error: '该角色必须关联供货商' }
  }
  return { username, name, password, role }
}

async function login(event) {
  const username = normalizeUsername(event.username)
  const password = String(event.password || '')
  if (!username || !password) return { code: -1, msg: '请输入账号和密码' }

  const result = await db.collection(USER_COLLECTION)
    .where({ username })
    .limit(1)
    .get()
  const user = result.data[0]
  // 登录锁定：连续失败 5 次锁定 10 分钟，防凭证爆破
  if (user) {
    const lockedUntil = user.login_locked_until ? new Date(user.login_locked_until).getTime() : 0
    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
      const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000))
      return { code: -1, msg: `账号已锁定，请${minutes}分钟后重试` }
    }
  }
  if (!user || !verifyPassword(password, user)) {
    if (user) {
      const failCount = (Number(user.login_fail_count) || 0) + 1
      const updateData = { login_fail_count: failCount, updated_at: db.serverDate() }
      if (failCount >= 5) {
        updateData.login_locked_until = new Date(Date.now() + 10 * 60 * 1000)
        updateData.login_fail_count = 0
      }
      await db.collection(USER_COLLECTION).doc(user._id).update({ data: updateData })
    }
    return { code: -1, msg: '账号或密码错误' }
  }
  if (user.status !== 1) return { code: -1, msg: '账号已停用，请联系管理员' }
  if (event.expectedRole && user.role !== event.expectedRole) {
    return { code: -1, msg: '账号与所选登录角色不匹配' }
  }

  // 供货商角色不关联门店，改为校验并加载其供货商档案
  let store = null
  let supplier = null
  if (user.role === SUPPLIER_ROLE) {
    supplier = await findSupplier(user.default_supplier_id)
    if (!supplier) return { code: -1, msg: '账号关联的供货商档案不存在或已停用，请联系管理员' }
  } else {
    store = await getDefaultStore(user)
    if (!store) return { code: -1, msg: '账号未关联有效门店，请联系管理员' }
  }

  const sessionToken = crypto.randomBytes(32).toString('hex')
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS)
  // B12 多设备会话：每台设备一条会话记录，最多保留 5 条（挤出最旧的）
  const sessions = (Array.isArray(user.sessions) ? user.sessions : [])
    .filter(s => s && new Date(s.expires_at).getTime() > Date.now())
  sessions.push({ token_hash: hashToken(sessionToken), expires_at: sessionExpiresAt })
  while (sessions.length > 5) sessions.shift()
  // 记录当前设备 openid（微信订阅消息推送的 touser 需要）；同一微信号多账号登录时以后登录者为准
  const wxContext = cloud.getWXContext()
  const loginUpdate = {
    // session_token_hash 兼容保留（指向最新会话），旧版云函数未重部署时仍可用
    session_token_hash: hashToken(sessionToken),
    session_expires_at: sessionExpiresAt,
    sessions,
    login_fail_count: 0,
    login_locked_until: null,
    last_login_at: db.serverDate(),
    updated_at: db.serverDate()
  }
  if (wxContext && wxContext.OPENID) loginUpdate.openid = wxContext.OPENID
  await db.collection(USER_COLLECTION).doc(user._id).update({ data: loginUpdate })

  return {
    code: 0,
    data: {
      user: publicUser(user),
      store: publicStore(store),
      supplier: supplier ? {
        supplierId: supplier.supplier_id,
        supplierName: supplier.supplier_name,
        contactName: supplier.contact_name || '',
        contactPhone: supplier.contact_phone || ''
      } : null,
      sessionToken,
      sessionExpiresAt: sessionExpiresAt.toISOString()
    }
  }
}

async function logout(event) {
  const user = await getSessionUser(event.authToken)
  if (user) {
    // 仅移除当前设备的会话，其他设备不受影响
    const tokenHash = hashToken(event.authToken || '')
    const sessions = (Array.isArray(user.sessions) ? user.sessions : [])
      .filter(s => s && s.token_hash !== tokenHash)
    await db.collection(USER_COLLECTION).doc(user._id).update({
      data: {
        sessions,
        session_token_hash: '',
        session_expires_at: null,
        updated_at: db.serverDate()
      }
    })
  }
  return { code: 0 }
}

async function changePassword(event) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { code: -401, msg: '登录已过期，请重新登录' }

  const currentPassword = String(event.currentPassword || '')
  const newPassword = String(event.newPassword || '')
  if (!currentPassword || !newPassword) return { code: -1, msg: '请输入当前密码和新密码' }
  if (newPassword.length < 6) return { code: -1, msg: '新密码至少需要6位' }
  if (!verifyPassword(currentPassword, user)) return { code: -1, msg: '当前密码不正确' }
  if (currentPassword === newPassword) return { code: -1, msg: '新密码不能与当前密码相同' }

  const salt = crypto.randomBytes(16).toString('hex')
  await db.collection(USER_COLLECTION).doc(user._id).update({
    data: {
      password_salt: salt,
      password_hash: hashPassword(newPassword, salt),
      password_iterations: PASSWORD_ITERATIONS,
      sessions: [],
      session_token_hash: '',
      session_expires_at: null,
      updated_at: db.serverDate()
    }
  })
  return { code: 0 }
}

async function getStores(event) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { code: -401, msg: '登录已过期，请重新登录' }

  const query = { status: 1 }
  if (STORE_ROLES.includes(user.role)) {
    if (!user.default_store_id) return { code: -1, msg: '账号未关联有效门店，请联系管理员' }
    query.store_id = user.default_store_id
  }
  const result = await db.collection(STORE_COLLECTION)
    .where(query)
    .orderBy('store_code', 'asc')
    .limit(100)
    .get()
  return { code: 0, data: result.data.map(publicStore) }
}

async function requireSuperAdmin(event) {
  const user = await getSessionUser(event.authToken)
  if (!user) return { error: { code: -401, msg: '登录已过期，请重新登录' } }
  if (user.role !== 'super_admin') return { error: { code: -403, msg: '仅超级管理员可以管理账号' } }
  return { user }
}

async function listUsers(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  const result = await db.collection(USER_COLLECTION)
    .orderBy('username', 'asc')
    .limit(100)
    .get()
  return { code: 0, data: result.data.map(publicUser) }
}

async function createUser(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  const input = validateUserInput(event, true)
  if (input.error) return { code: -1, msg: input.error }

  const duplicate = await db.collection(USER_COLLECTION)
    .where({ username: input.username })
    .limit(1)
    .get()
  if (duplicate.data.length > 0) return { code: -1, msg: '该登录账号已存在' }
  if (STORE_ROLES.includes(input.role) && !(await findStore(event.defaultStoreId))) {
    return { code: -1, msg: '关联门店不存在或已停用' }
  }
  if (input.role === SUPPLIER_ROLE && !(await findSupplier(event.defaultSupplierId))) {
    return { code: -1, msg: '关联供货商不存在或已停用' }
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const userId = 'U' + Date.now()
  const addResult = await db.collection(USER_COLLECTION).add({
    data: {
      user_id: userId,
      username: input.username,
      name: input.name,
      mobile: String(event.mobile || '').trim(),
      role: input.role,
      role_label: ROLE_LABELS[input.role],
      default_store_id: STORE_ROLES.includes(input.role) ? event.defaultStoreId : '',
      default_supplier_id: input.role === SUPPLIER_ROLE ? event.defaultSupplierId : '',
      status: 1,
      password_salt: salt,
      password_hash: hashPassword(input.password, salt),
      password_iterations: PASSWORD_ITERATIONS,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  const created = await db.collection(USER_COLLECTION).doc(addResult._id).get()
  return { code: 0, data: publicUser(created.data) }
}

async function updateUser(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '用户信息缺失' }

  const targetResult = await db.collection(USER_COLLECTION).doc(event.id).get()
  const target = targetResult.data
  if (!target) return { code: -1, msg: '用户不存在' }
  const input = validateUserInput(event, false)
  if (input.error) return { code: -1, msg: input.error }

  const duplicate = await db.collection(USER_COLLECTION)
    .where({ username: input.username })
    .get()
  if (duplicate.data.some(user => user._id !== target._id)) {
    return { code: -1, msg: '该登录账号已存在' }
  }
  if (STORE_ROLES.includes(input.role) && !(await findStore(event.defaultStoreId))) {
    return { code: -1, msg: '关联门店不存在或已停用' }
  }
  if (input.role === SUPPLIER_ROLE && !(await findSupplier(event.defaultSupplierId))) {
    return { code: -1, msg: '关联供货商不存在或已停用' }
  }

  const effectiveRole = target.username === 'admin' ? 'super_admin' : input.role
  const updateData = {
    username: target.username === 'admin' ? 'admin' : input.username,
    name: input.name,
    mobile: String(event.mobile || '').trim(),
    role: effectiveRole,
    role_label: ROLE_LABELS[effectiveRole],
    default_store_id: STORE_ROLES.includes(effectiveRole) ? event.defaultStoreId : '',
    default_supplier_id: effectiveRole === SUPPLIER_ROLE ? event.defaultSupplierId : '',
    updated_at: db.serverDate()
  }
  if (input.password) {
    const salt = crypto.randomBytes(16).toString('hex')
    updateData.password_salt = salt
    updateData.password_hash = hashPassword(input.password, salt)
    updateData.password_iterations = PASSWORD_ITERATIONS
    updateData.sessions = []
    updateData.session_token_hash = ''
    updateData.session_expires_at = null
  }
  await db.collection(USER_COLLECTION).doc(target._id).update({ data: updateData })
  const updated = await db.collection(USER_COLLECTION).doc(target._id).get()
  return { code: 0, data: publicUser(updated.data) }
}

async function resetPassword(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '用户信息缺失' }
  if (event.id === auth.user._id) return { code: -1, msg: '请在安全设置中修改当前账号密码' }

  const newPassword = String(event.newPassword || '')
  if (newPassword.length < 6) return { code: -1, msg: '新密码至少需要6位' }

  const targetResult = await db.collection(USER_COLLECTION).doc(event.id).get()
  const target = targetResult.data
  if (!target) return { code: -1, msg: '用户不存在' }

  const salt = crypto.randomBytes(16).toString('hex')
  await db.collection(USER_COLLECTION).doc(target._id).update({
    data: {
      password_salt: salt,
      password_hash: hashPassword(newPassword, salt),
      password_iterations: PASSWORD_ITERATIONS,
      sessions: [],
      session_token_hash: '',
      session_expires_at: null,
      updated_at: db.serverDate()
    }
  })
  return { code: 0 }
}

// 离职/停用口径：只改状态不删记录，历史单据的 created_by 追溯链保留。
// 停用即可断会话：getSessionUser 按 status:1 过滤，这里再清 token，
// 防止将来重新启用时旧会话复活。
async function setUserStatus(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '用户信息缺失' }
  const status = Number(event.status)
  if (![0, 1].includes(status)) return { code: -1, msg: '账号状态无效' }
  if (event.id === auth.user._id) return { code: -1, msg: '不能操作当前登录账号的状态' }

  const targetResult = await db.collection(USER_COLLECTION).doc(event.id).get()
  const target = targetResult.data
  if (!target) return { code: -1, msg: '用户不存在' }
  if (target.username === 'admin') return { code: -1, msg: '默认系统超管不可停用' }
  if ((target.status === undefined ? 1 : target.status) === status) {
    return { code: -1, msg: status === 0 ? '该账号已是停用状态' : '该账号已是正常状态' }
  }

  const updateData = { status, updated_at: db.serverDate() }
  if (status === 0) {
    updateData.session_token_hash = ''
    updateData.session_expires_at = null
  }
  await db.collection(USER_COLLECTION).doc(target._id).update({ data: updateData })
  return { code: 0, data: { status } }
}

// 物理删除仅保留给"建错从未使用的账号"。名下还有未完结单据或处理中
// 异常时拒绝删除，引导改用停用（软删除）。
async function deleteUser(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '用户信息缺失' }
  if (event.id === auth.user._id) return { code: -1, msg: '不能删除当前登录账号' }

  const targetResult = await db.collection(USER_COLLECTION).doc(event.id).get()
  const target = targetResult.data
  if (!target) return { code: -1, msg: '用户不存在' }
  if (target.username === 'admin') return { code: -1, msg: '无法删除默认系统超管' }

  const _ = db.command
  const identities = [target.user_id, target._id, target.name].filter(Boolean)
  const ACTIVE_ORDER_STATUS = ['draft', 'submitted', 'pending_approval', 'approved', 'report_generated', 'partial_received', 'to_receive']
  const [orderRes, abnormalRes] = await Promise.all([
    db.collection('purchase_order')
      .where({ created_by: _.in(identities), order_status: _.in(ACTIVE_ORDER_STATUS) })
      .count(),
    db.collection('abnormal_record')
      .where({ handled_by: target.name, status: _.in(['pending', 'processing']) })
      .count()
  ])
  if (orderRes.total > 0) {
    return { code: -1, msg: `该账号名下还有 ${orderRes.total} 张未完结采购单，离职请改用「停用」` }
  }
  if (abnormalRes.total > 0) {
    return { code: -1, msg: `该账号还有 ${abnormalRes.total} 条处理中的异常记录，离职请改用「停用」` }
  }

  await db.collection(USER_COLLECTION).doc(target._id).remove()
  return { code: 0 }
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'login': return await login(event)
      case 'logout': return await logout(event)
      case 'changePassword': return await changePassword(event)
      case 'getStores': return await getStores(event)
      case 'listUsers': return await listUsers(event)
      case 'createUser': return await createUser(event)
      case 'updateUser': return await updateUser(event)
      case 'resetPassword': return await resetPassword(event)
      case 'setUserStatus': return await setUserStatus(event)
      case 'deleteUser': return await deleteUser(event)
      default: return { code: -1, msg: '不支持的认证操作' }
    }
  } catch (err) {
    console.error('[authService] 认证服务处理失败:', err)
    const message = String(err && err.message || '')
    if (message.includes('collection') || message.includes('集合')) {
      return { code: -1, msg: '登录数据尚未初始化，请联系管理员' }
    }
    return { code: -1, msg: '登录服务异常，请稍后重试' }
  }
}
