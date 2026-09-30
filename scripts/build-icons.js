// scripts/build-icons.js
// 生成 styles/icons.wxss：统一的线性图标系统（SVG data-URI，跨端渲染一致）
// 用法：node scripts/build-icons.js
// 新增图标：在 ICONS 里加路径、在 VARIANTS 里加 {图标, 颜色} 组合，重新运行即可

const fs = require('fs')
const path = require('path')

// ========== 色板（与 app.wxss CSS 变量保持一致） ==========
const COLORS = {
  white: '#FFFFFF',
  primary: '#00873E',
  success: '#52C41A',
  warning: '#FAAD14',
  danger: '#FF4D4F',
  orange: '#FA8C16',
  purple: '#722ED1',
  teal: '#13C2C2',
  magenta: '#EB2F96',
  blue: '#5B8FF9',
  mint: '#5AD8A6',
  grey: '#999999'
}

// ========== 图标路径（24x24 viewBox，stroke 线性风格） ==========
const ICONS = {
  pin: `<path d='M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z'/><circle cx='12' cy='10' r='3'/>`,
  lock: `<rect x='3' y='11' width='18' height='11' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/>`,
  approval: `<rect x='8' y='2' width='8' height='4' rx='1'/><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><path d='m9 14 2 2 4-4'/>`,
  clipboard: `<rect x='8' y='2' width='8' height='4' rx='1'/><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><path d='M12 11h4'/><path d='M12 16h4'/><path d='M8 11h.01'/><path d='M8 16h.01'/>`,
  leaf: `<path d='M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z'/><path d='M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'/>`,
  factory: `<path d='M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z'/><path d='M17 18h1'/><path d='M12 18h1'/><path d='M7 18h1'/>`,
  tag: `<path d='M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42Z'/><circle cx='7.5' cy='7.5' r='1.5'/>`,
  users: `<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>`,
  store: `<path d='m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7'/><path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><path d='M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4'/><path d='M2 7h20'/><path d='M22 7v3a2 2 0 0 1-2 2 3 3 0 0 1-2-1 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-2 1 2 2 0 0 1-2-2V7'/>`,
  package: `<path d='M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73Z'/><path d='M12 22V12'/><path d='m3.3 7 7.7 4.42a2 2 0 0 0 2 0L20.7 7'/><path d='m7.5 4.27 9 5.15'/>`,
  check: `<circle cx='12' cy='12' r='10'/><path d='m9 12 2 2 4-4'/>`,
  alert: `<path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z'/><path d='M12 9v4'/><path d='M12 17h.01'/>`,
  receipt: `<path d='M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z'/><path d='M8 7h8'/><path d='M8 11h8'/><path d='M8 15h5'/>`,
  chef: `<path d='M17 21a1 1 0 0 0 1-1v-5.35c0-.46.35-.79.81-.9a4 4 0 1 0-1.24-7.72 5 5 0 0 0-11.14 0A4 4 0 1 0 5.19 13.8c.46.11.81.44.81.9V20a1 1 0 0 0 1 1Z'/><path d='M6 17h12'/>`,
  briefcase: `<rect x='2' y='7' width='20' height='14' rx='2'/><path d='M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'/>`,
  chart: `<path d='M3 3v16a2 2 0 0 0 2 2h16'/><path d='M8 17v-6'/><path d='M13 17V7'/><path d='M18 17v-3'/>`,
  truck: `<path d='M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2'/><path d='M15 18h-5'/><path d='M14 8h5.99a2 2 0 0 1 1.72 1l1.9 3.8a1 1 0 0 1 .14.51V17a1 1 0 0 1-1 1h-2'/><circle cx='7' cy='18' r='2'/><circle cx='18' cy='18' r='2'/>`,
  calendar: `<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4'/><path d='M8 2v4'/><path d='M3 10h18'/>`,
  calendarDays: `<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4'/><path d='M8 2v4'/><path d='M3 10h18'/><path d='M8 14h.01'/><path d='M12 14h.01'/><path d='M16 14h.01'/><path d='M8 18h.01'/><path d='M12 18h.01'/>`,
  file: `<path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/><path d='M14 2v4a1 1 0 0 0 1 1h4'/><path d='M10 12h4'/><path d='M10 16h4'/>`,
  edit: `<path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/>`,
  key: `<circle cx='7.5' cy='15.5' r='5.5'/><path d='m21 2-9.6 9.6'/><path d='m15.5 7.5 3 3L22 7l-3-3'/>`,
  ban: `<circle cx='12' cy='12' r='10'/><path d='m4.9 4.9 14.2 14.2'/>`,
  play: `<polygon points='6 3 20 12 6 21 6 3'/>`,
  pause: `<rect x='14' y='4' width='4' height='16' rx='1'/><rect x='6' y='4' width='4' height='16' rx='1'/>`,
  folder: `<path d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/>`,
  bulb: `<path d='M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'/><path d='M9 18h6'/><path d='M10 22h4'/>`,
  upload: `<path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><path d='m16 6-4-4-4 4'/><path d='M12 2v13'/>`,
  chat: `<path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/>`,
  camera: `<path d='M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'/><circle cx='12' cy='13' r='3'/>`,
  clock: `<circle cx='12' cy='12' r='10'/><path d='M12 6v6l4 2'/>`,
  bell: `<path d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'/><path d='M10.3 21a1.94 1.94 0 0 0 3.4 0'/>`,
  armchair: `<path d='M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3'/><path d='M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z'/><path d='M5 18v2'/><path d='M19 18v2'/>`,
  drumstick: `<path d='M15.4 15.63a7.875 6 135 1 1 1.23-1.23'/><path d='m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59'/>`,
  fish: `<path d='M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z'/><path d='M18 12v.5'/><path d='M16 17.93a9.77 9.77 0 0 1 0-11.86'/><path d='M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33'/>`,
  shaker: `<path d='M8 2h8'/><path d='M9 2v2.34c0 .53-.21 1.04-.59 1.41C7.17 6.99 6 9.03 6 11.24V20a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8.76c0-2.21-1.17-4.25-2.41-5.49A2 2 0 0 1 15 4.34V2'/><path d='M10 13h.01'/><path d='M14 13h.01'/><path d='M12 17h.01'/>`,
  bowl: `<path d='M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z'/><path d='M12 3v3'/><path d='M8 5v2'/><path d='M16 5v2'/>`,
  beer: `<path d='M17 11h1a3 3 0 0 1 0 6h-1'/><path d='M9 12v6'/><path d='M13 12v6'/><path d='M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-1-1.44-.5-3-.5'/><path d='M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8'/>`,
  snowflake: `<path d='M2 12h20'/><path d='M12 2v20'/><path d='m20 16-4-4 4-4'/><path d='m4 8 4 4-4 4'/><path d='m16 4-4 4-4-4'/><path d='m8 20 4-4 4 4'/>`,
  utensils: `<path d='M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2'/><path d='M7 2v20'/><path d='M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z'/><path d='M21 15v7'/>`,
  brush: `<path d='m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08'/><path d='M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z'/>`
}

// ========== 需要的「图标-颜色」组合 → 生成 .icon-{name}-{color} ==========
const VARIANTS = [
  ['pin', 'white'],
  ['lock', 'white'],
  ['lock', 'primary'],
  ['approval', 'primary'],
  ['clipboard', 'primary'],
  ['clipboard', 'warning'],
  ['clipboard', 'grey'],
  ['leaf', 'primary'],
  ['factory', 'primary'],
  ['factory', 'purple'],
  ['factory', 'grey'],
  ['tag', 'primary'],
  ['tag', 'warning'],
  ['tag', 'grey'],
  ['users', 'primary'],
  ['users', 'grey'],
  ['store', 'primary'],
  ['store', 'grey'],
  ['package', 'primary'],
  ['package', 'success'],
  ['package', 'grey'],
  ['package', 'white'],
  ['check', 'success'],
  ['check', 'grey'],
  ['alert', 'danger'],
  ['receipt', 'orange'],
  ['receipt', 'white'],
  ['chef', 'primary'],
  ['chef', 'grey'],
  ['briefcase', 'primary'],
  ['chart', 'primary'],
  ['chart', 'magenta'],
  ['chart', 'grey'],
  ['chart', 'white'],
  ['tag', 'white'],
  ['factory', 'white'],
  ['truck', 'primary'],
  ['truck', 'teal'],
  ['truck', 'white'],
  ['calendar', 'blue'],
  ['calendar', 'grey'],
  ['calendarDays', 'mint'],
  ['file', 'grey'],
  ['file', 'primary'],
  ['edit', 'grey'],
  ['edit', 'primary'],
  ['edit', 'white'],
  ['key', 'grey'],
  ['ban', 'danger'],
  ['ban', 'grey'],
  ['play', 'success'],
  ['pause', 'grey'],
  ['folder', 'grey'],
  ['bulb', 'grey'],
  ['upload', 'white'],
  ['upload', 'primary'],
  ['chat', 'grey'],
  ['chat', 'primary'],
  ['camera', 'grey'],
  ['clock', 'warning'],
  ['bell', 'primary'],
  ['bell', 'white'],
  ['bell', 'warning'],
  ['armchair', 'primary'],
  ['armchair', 'grey'],
  ['clipboard', 'white'],
  ['check', 'white'],
  // 商品分类图标：未选中灰 / 选中白 两态
  ['chef', 'white'],
  ['armchair', 'white'],
  ['leaf', 'grey'],
  ['leaf', 'white'],
  ['drumstick', 'grey'],
  ['drumstick', 'white'],
  ['fish', 'grey'],
  ['fish', 'white'],
  ['shaker', 'grey'],
  ['shaker', 'white'],
  ['bowl', 'grey'],
  ['bowl', 'white'],
  ['beer', 'grey'],
  ['beer', 'white'],
  ['snowflake', 'grey'],
  ['snowflake', 'white'],
  ['utensils', 'grey'],
  ['utensils', 'white'],
  ['brush', 'grey'],
  ['brush', 'white']
]

function kebab(name) {
  return name.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
}

function buildSvg(paths, color) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`
}

function toDataUri(svg) {
  // 单引号也编码掉，保证 data-URI 放进 url('...') 或 url("...") 都不会截断
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27')
}

// ========== 生成 WXSS ==========
const lines = [
  '/* styles/icons.wxss - 由 scripts/build-icons.js 生成，请勿手改 */',
  '/* 用法：<view class="icon icon-lg icon-approval-primary"></view> */',
  '',
  '.icon {',
  '  display: inline-block;',
  '  width: 40rpx;',
  '  height: 40rpx;',
  '  background-repeat: no-repeat;',
  '  background-position: center;',
  '  background-size: contain;',
  '  vertical-align: middle;',
  '  flex-shrink: 0;',
  '}',
  '',
  '.icon-xs { width: 26rpx; height: 26rpx; }',
  '.icon-sm { width: 32rpx; height: 32rpx; }',
  '.icon-lg { width: 48rpx; height: 48rpx; }',
  '.icon-xl { width: 56rpx; height: 56rpx; }',
  '.icon-xxl { width: 100rpx; height: 100rpx; }',
  '.icon-inline { margin-right: 8rpx; vertical-align: -6rpx; }',
  ''
]

for (const [icon, color] of VARIANTS) {
  const uri = toDataUri(buildSvg(ICONS[icon], COLORS[color]))
  lines.push(`.icon-${kebab(icon)}-${color} { background-image: url("${uri}"); }`)
}

const outPath = path.join(__dirname, '..', 'styles', 'icons.wxss')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')
console.log(`已生成 ${outPath}（${VARIANTS.length} 个图标变体）`)

// ========== 顺手生成浏览器预览页，方便核对图标 ==========
const preview = [
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>图标预览</title>',
  '<style>body{font-family:sans-serif;padding:24px;background:#F5F7FA}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}',
  '.cell{background:#fff;border-radius:8px;padding:16px;text-align:center;font-size:12px;color:#595959}',
  '.cell i{display:block;width:32px;height:32px;margin:0 auto 8px;background-repeat:no-repeat;background-position:center;background-size:contain}',
  '.dark{background:#00873E}</style></head><body><h3>icons.wxss 预览</h3><div class="grid">',
  ...VARIANTS.map(([icon, color]) => {
    const uri = toDataUri(buildSvg(ICONS[icon], COLORS[color]))
    const cls = `icon-${kebab(icon)}-${color}`
    const dark = color === 'white' ? ' dark' : ''
    return `<div class="cell${dark}"><i style="background-image:url('${uri}')"></i>${cls}</div>`
  }),
  '</div></body></html>'
].join('\n')
fs.writeFileSync(path.join(__dirname, 'icons-preview.html'), preview, 'utf8')
console.log('预览页：scripts/icons-preview.html')
