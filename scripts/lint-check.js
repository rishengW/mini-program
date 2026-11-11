// 全库 JS 语法检查（node --check），供 pre-commit 与 CI 使用。
// 用法：node scripts/lint-check.js
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const TARGETS = ['pages', 'utils', 'cloudfunctions', 'scripts', 'tests', 'app.js']
const SKIP = /node_modules|_tmp_test|\.atomcode-tmp/

function collect(dirAbs, out = []) {
  if (!fs.existsSync(dirAbs)) return out
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const p = path.join(dirAbs, entry.name)
    if (SKIP.test(p)) continue
    if (entry.isDirectory()) collect(p, out)
    else if (entry.name.endsWith('.js')) out.push(p)
  }
  return out
}

let files = []
TARGETS.forEach(t => {
  const abs = path.join(ROOT, t)
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) collect(abs, files)
  else if (fs.existsSync(abs)) files.push(abs)
})

let failed = 0
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
  } catch (e) {
    failed++
    console.error('语法错误:', path.relative(ROOT, f))
  }
}
console.log(`检查 ${files.length} 个 JS 文件，${failed ? failed + ' 个语法错误' : '全部通过'}`)
process.exit(failed ? 1 : 0)
