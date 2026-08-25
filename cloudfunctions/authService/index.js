const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const USER_COLLECTION = 'app_user'
const STORE_COLLECTION = 'store'
const PASSWORD_ITERATIONS = 120000
const PASSWORD_KEY_LENGTH = 32
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ROLE_LABELS = {
  chef: '门店下单人员',
  store_manager: '店长',
  purchaser: '管理员',
  super_admin: '超级管理员'
}
const STORE_ROLES = ['chef', 'store_manager']

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
  const result = await db.collection(USER_COLLECTION)
    .where({ session_token_hash: hashToken(authToken), status: 1 })
    .limit(1)
    .get()
  const user = result.data[0]
  if (!user || !user.session_expires_at) return null

  const expiresAt = new Date(user.session_expires_at).getTime()
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
  if (!user || !verifyPassword(password, user)) {
    return { code: -1, msg: '账号或密码错误' }
  }
  if (user.status !== 1) return { code: -1, msg: '账号已停用，请联系管理员' }
  if (event.expectedRole && user.role !== event.expectedRole) {
    return { code: -1, msg: '账号与所选登录角色不匹配' }
  }

  const store = await getDefaultStore(user)
  if (!store) return { code: -1, msg: '账号未关联有效门店，请联系管理员' }

  const sessionToken = crypto.randomBytes(32).toString('hex')
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.collection(USER_COLLECTION).doc(user._id).update({
    data: {
      session_token_hash: hashToken(sessionToken),
      session_expires_at: sessionExpiresAt,
      last_login_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return {
    code: 0,
    data: {
      user: publicUser(user),
      store: publicStore(store),
      sessionToken,
      sessionExpiresAt: sessionExpiresAt.toISOString()
    }
  }
}

async function logout(event) {
  const user = await getSessionUser(event.authToken)
  if (user) {
    await db.collection(USER_COLLECTION).doc(user._id).update({
      data: { session_token_hash: '', session_expires_at: null, updated_at: db.serverDate() }
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

  const effectiveRole = target.username === 'admin' ? 'super_admin' : input.role
  const updateData = {
    username: target.username === 'admin' ? 'admin' : input.username,
    name: input.name,
    mobile: String(event.mobile || '').trim(),
    role: effectiveRole,
    role_label: ROLE_LABELS[effectiveRole],
    default_store_id: STORE_ROLES.includes(effectiveRole) ? event.defaultStoreId : '',
    updated_at: db.serverDate()
  }
  if (input.password) {
    const salt = crypto.randomBytes(16).toString('hex')
    updateData.password_salt = salt
    updateData.password_hash = hashPassword(input.password, salt)
    updateData.password_iterations = PASSWORD_ITERATIONS
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
      session_token_hash: '',
      session_expires_at: null,
      updated_at: db.serverDate()
    }
  })
  return { code: 0 }
}

async function deleteUser(event) {
  const auth = await requireSuperAdmin(event)
  if (auth.error) return auth.error
  if (!event.id) return { code: -1, msg: '用户信息缺失' }
  if (event.id === auth.user._id) return { code: -1, msg: '不能删除当前登录账号' }

  const targetResult = await db.collection(USER_COLLECTION).doc(event.id).get()
  const target = targetResult.data
  if (!target) return { code: -1, msg: '用户不存在' }
  if (target.username === 'admin') return { code: -1, msg: '无法删除默认系统超管' }

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
