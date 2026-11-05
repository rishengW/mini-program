// 云函数共享代码同步脚本（2026-11-05 解耦第 3 项）。
// 微信云函数只上传各自目录，跨函数共享代码不能直接 require 外部目录——
// 故源头维护在 scripts/cloud-shared/，本脚本把源头复制进每个云函数目录的 shared/ 下。
//
// 用法：
//   node scripts/sync-shared.js          同步（复制）全部副本
//   node scripts/sync-shared.js --check  只校验副本与源头一致（部署前检查），不一致退出码 1
//
// 副本随 git 追踪：部署机 git pull 后无需跑脚本即可直接上传部署；
// 但改动源头后必须跑本脚本并提交副本，否则部署的是旧副本。
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'scripts', 'cloud-shared')
const FUNCTIONS_DIR = path.join(ROOT, 'cloudfunctions')
const TARGET_DIR_NAME = 'shared'
const CHECK_ONLY = process.argv.includes('--check')

const sources = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'))
if (!sources.length) {
  console.error('源头目录无模块文件:', SRC_DIR)
  process.exit(1)
}

const functions = fs.readdirSync(FUNCTIONS_DIR).filter(name => {
  const dir = path.join(FUNCTIONS_DIR, name)
  return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'index.js'))
})

let mismatches = 0
for (const fn of functions) {
  const targetDir = path.join(FUNCTIONS_DIR, fn, TARGET_DIR_NAME)
  for (const file of sources) {
    const src = path.join(SRC_DIR, file)
    const dst = path.join(targetDir, file)
    const srcContent = fs.readFileSync(src)
    if (CHECK_ONLY) {
      if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(srcContent)) {
        console.error(`不一致: ${fn}/${TARGET_DIR_NAME}/${file}`)
        mismatches++
      }
    } else {
      fs.mkdirSync(targetDir, { recursive: true })
      fs.writeFileSync(dst, srcContent)
    }
  }
}

if (CHECK_ONLY) {
  if (mismatches) {
    console.error(`\n${mismatches} 处副本与源头不一致，请运行 node scripts/sync-shared.js 同步`)
    process.exit(1)
  }
  console.log(`校验通过：${functions.length} 个云函数 × ${sources.length} 个模块，副本与源头一致`)
} else {
  console.log(`同步完成：${sources.join(', ')} → ${functions.length} 个云函数的 ${TARGET_DIR_NAME}/`)
  functions.forEach(fn => console.log(`  - ${fn}`))
}
