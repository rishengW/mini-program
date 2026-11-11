// B6 行为测试集统一入口：node tests/run-tests.js
// 运行 tests/ 下全部 test-*.js（内存 mock 云环境，不依赖真实微信云）。
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('test-') && f.endsWith('.js'))
if (!files.length) {
  console.error('tests/ 下没有测试文件')
  process.exit(1)
}

let failed = 0
for (const f of files) {
  console.log('\n===== ' + f + ' =====')
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' })
  } catch (e) {
    failed++
  }
}
console.log(failed === 0 ? '\n全部测试文件通过' : `\n${failed} 个测试文件失败`)
process.exit(failed === 0 ? 0 : 1)
