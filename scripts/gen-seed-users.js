// 一键生成简易版账号的种子数据与口令表
// 用法：node scripts/gen-seed-users.js
// 产出三个文件：
//   seed-data/app_user.json            （5 个账号，NDJSON）
//   seed-data/supplier_test_user.jsonl （U004 供货商账号，单独一行）
//   .atomcode-tmp/newpw.txt            （口令对照表，明文，注意保密）
//
// 哈希算法必须与 cloudfunctions/authService/index.js 完全一致：
//   PBKDF2-SHA256，120000 迭代，32 字节密钥，hex 输出，16 字节随机盐
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PASSWORD = '123456' // 统一简易初始密码；首次登录后可在"密码设置"中修改
const ITERATIONS = 120000
const KEY_LENGTH = 32

// user_id / 新用户名 / 姓名 / 手机 / 角色 / 默认门店 / 默认供货商
const USERS = [
  { user_id: 'U000', username: 'admin', name: '超级管理员', mobile: '13900000000', role: 'super_admin', role_label: '超级管理员', default_store_id: '' },
  { user_id: 'U001', username: 'xd', name: '王大厨', mobile: '13900001111', role: 'chef', role_label: '门店下单人员', default_store_id: 'S001' },
  { user_id: 'U002', username: 'dz', name: '陈店长', mobile: '13900002222', role: 'store_manager', role_label: '店长', default_store_id: 'S001' },
  { user_id: 'U003', username: 'cg', name: '赵采购', mobile: '13900003333', role: 'purchaser', role_label: '采购主管', default_store_id: '' },
  { user_id: 'U004', username: 'ghs', name: '绿源蔬菜批发-刘师傅', mobile: '13800010001', role: 'supplier', role_label: '供货商', default_store_id: '', default_supplier_id: 'SUP001' }
]

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEY_LENGTH, 'sha256').toString('hex')
}

const root = path.join(__dirname, '..')
const created = '2026-08-14 09:00:00'

const lines = []
const pwLines = []
for (const u of USERS) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(PASSWORD, salt)
  const rec = {
    user_id: u.user_id,
    username: u.username,
    name: u.name,
    mobile: u.mobile,
    role: u.role,
    role_label: u.role_label,
    default_store_id: u.default_store_id
  }
  if (u.default_supplier_id) rec.default_supplier_id = u.default_supplier_id
  rec.status = 1
  rec.password_salt = salt
  rec.password_hash = hash
  rec.password_iterations = ITERATIONS
  rec.created_at = created
  rec.updated_at = created
  lines.push(JSON.stringify(rec))
  pwLines.push([
    u.username,
    PASSWORD,
    crypto.createHash('md5').update(PASSWORD).digest('hex'),
    crypto.createHash('sha256').update(PASSWORD).digest('hex')
  ].join('|'))
}

fs.writeFileSync(path.join(root, 'seed-data', 'app_user.json'), lines.join('\n') + '\n', 'utf8')
// supplier_test_user.jsonl 是 U004 的单行副本，保持同步
fs.writeFileSync(path.join(root, 'seed-data', 'supplier_test_user.jsonl'), lines[4] + '\n', 'utf8')

const tmpDir = path.join(root, '.atomcode-tmp')
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
fs.writeFileSync(
  path.join(tmpDir, 'newpw.txt'),
  '# 简易版账号口令表（' + new Date().toISOString().slice(0, 10) + ' 生成）\n' +
  '# 格式：账号|密码|md5(密码)|sha256(密码)\n' +
  '# 注意：本文件含明文口令，勿提交版本库、勿随包下发\n' +
  pwLines.join('\n') + '\n',
  'utf8'
)

console.log('已生成：')
console.log('  seed-data/app_user.json')
console.log('  seed-data/supplier_test_user.jsonl')
console.log('  .atomcode-tmp/newpw.txt')
console.log('\n账号对照（登录时不区分大小写）：')
for (const u of USERS) console.log('  ' + u.role_label + ' ' + u.name + ' -> 账号 ' + u.username.toUpperCase() + ' / 密码 ' + PASSWORD)
