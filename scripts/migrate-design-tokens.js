// UI 设计令牌治理（2026-11-11）：把 pages/*/*.wxss 里的硬编码 hex 全部迁移到 app.wxss 的
// CSS 变量（设计令牌单源）。每个 hex 一对一映射到携带相同色值的变量，**零视觉变化**。
// 用法：node scripts/migrate-design-tokens.js
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const APP_WXSS = path.join(ROOT, 'app.wxss')

// 已有变量（app.wxss 现行）→ hex 精确匹配映射
const EXISTING = {
  '#00873e': '--color-primary',
  '#33a862': '--color-primary-light',
  '#006b33': '--color-primary-dark',
  '#52c41a': '--color-success',
  '#faad14': '--color-warning',
  '#ff4d4f': '--color-danger',
  '#262626': '--color-text-primary',
  '#595959': '--color-text-secondary',
  '#8c8c8c': '--color-text-tertiary',
  '#bfbfbf': '--color-text-placeholder',
  '#f5f7fa': '--color-bg-page',
  '#f0f2f5': '--color-bg-grey',
  '#e8e8e8': '--color-border',
  '#f0f0f0': '--color-divider'
}

// 新增变量（语义命名，色值与原硬编码完全一致 → 迁移后外观不变）
const NEW_VARS = {
  '#ffffff': '--color-white',
  '#fff': '--color-white',
  '#e0e2e5': '--color-border-muted',
  '#fa8c16': '--color-accent-orange',
  '#e9f7ef': '--color-success-bg',
  '#f6ffed': '--color-success-bg-alt',
  '#fff7e6': '--color-warning-bg',
  '#fff2f0': '--color-danger-bg',
  '#fff1f0': '--color-danger-bg-alt',
  '#cf1322': '--color-danger-dark',
  '#ff7875': '--color-danger-light',
  '#ffa39e': '--color-danger-lighter',
  '#ffd591': '--color-warning-light',
  '#ffc53d': '--color-warning-light-2',
  '#ffe58f': '--color-warning-lighter',
  '#fffbe6': '--color-warning-bg-alt',
  '#ffe7ba': '--color-warning-bg-2',
  '#73d13d': '--color-success-light',
  '#5b8ff9': '--color-info-blue',
  '#d9d9d9': '--color-border-strong',
  '#eee': '--color-border-light',
  '#999999': '--color-text-grey',
  '#f5f5f5': '--color-bg-light'
}
// #fff 与 #ffffff 共用 --color-white；#eee 与 #eeeeee 共用 --color-border-light
const HEX_VALUE = {
  '--color-white': '#FFFFFF',
  '--color-border-muted': '#E0E2E5',
  '--color-accent-orange': '#FA8C16',
  '--color-success-bg': '#E9F7EF',
  '--color-success-bg-alt': '#F6FFED',
  '--color-warning-bg': '#FFF7E6',
  '--color-danger-bg': '#FFF2F0',
  '--color-danger-bg-alt': '#FFF1F0',
  '--color-danger-dark': '#CF1322',
  '--color-danger-light': '#FF7875',
  '--color-danger-lighter': '#FFA39E',
  '--color-warning-light': '#FFD591',
  '--color-warning-light-2': '#FFC53D',
  '--color-warning-lighter': '#FFE58F',
  '--color-warning-bg-alt': '#FFFBE6',
  '--color-warning-bg-2': '#FFE7BA',
  '--color-success-light': '#73D13D',
  '--color-info-blue': '#5B8FF9',
  '--color-border-strong': '#D9D9D9',
  '--color-border-light': '#EEEEEE',
  '--color-text-grey': '#999999',
  '--color-bg-light': '#F5F5F5'
}

const VAR_OF = { ...EXISTING, ...NEW_VARS }

function listWxss(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listWxss(p, out)
    else if (e.name.endsWith('.wxss')) out.push(p)
  }
  return out
}

const files = listWxss(path.join(ROOT, 'pages'))
let totalReplaced = 0
const perFile = []
for (const file of files) {
  let css = fs.readFileSync(file, 'utf8')
  let n = 0
  css = css.replace(/#([0-9a-fA-F]{3,8})\b/g, (match) => {
    const varName = VAR_OF[match.toLowerCase()]
    if (varName) { n++; return `var(${varName})` }
    return match
  })
  if (n > 0) {
    fs.writeFileSync(file, css)
    perFile.push(`${path.basename(file)}: ${n}`)
    totalReplaced += n
  }
}

// 把新增变量声明逐个注入 app.wxss 的 page{} 变量区（幂等：已存在的跳过）
let app = fs.readFileSync(APP_WXSS, 'utf8')
const missing = Object.entries(HEX_VALUE).filter(([name]) => !app.includes(name + ':'))
if (missing.length) {
  const decl = missing.map(([name, val]) => `  ${name}: ${val};`).join('\n')
  app = app.replace(
    /(\s*font-family:\s*-apple-system)/,
    `\n  /* ===== 设计令牌扩展（UI 治理 2026-11-11，色值与原硬编码一致） ===== */\n${decl}\n$1`
  )
  fs.writeFileSync(APP_WXSS, app)
}

console.log('替换完成：')
perFile.forEach(l => console.log('  ' + l))
console.log(`共替换 ${totalReplaced} 处硬编码 hex → var()，新增变量 ${Object.keys(HEX_VALUE).length} 个已注入 app.wxss`)

// 校验：pages 下不应再有未映射的硬编码 hex
let remaining = 0
for (const file of files) {
  const css = fs.readFileSync(file, 'utf8')
  const left = css.match(/#([0-9a-fA-F]{3,8})\b/g) || []
  if (left.length) { remaining += left.length; console.log('未映射残留', path.basename(file), left.join(',')) }
}
console.log(remaining === 0 ? '校验通过：pages 下已无硬编码 hex' : `仍有 ${remaining} 处未映射`)
