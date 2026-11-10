// 生成商品导入模板 xlsx（L37，2026-11-09）
// 用法：node scripts/make-import-template.js
// 输出：assets/templates/商品导入模板.xlsx（随小程序包分发，前端「下载模板」读取）
//
// 本机无 xlsx 依赖，手工构造最小 SpreadsheetML 包：两个工作表
//   ① 导入模板（仅列头，列名严格对齐 importProducts 的 HEADER_ALIASES）
//   ② 填写说明（导入只读第一张表，第二张说明页不会被误解析）
// 无示例数据行——任何非空示例行都会被当作真实商品导入，故模板只给表头。
const fs = require('fs')
const path = require('path')

// ===== CRC32（zip 必需校验） =====
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()
function crc32(buf) {
  let c = 0 ^ (-1)
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]
  return (c ^ (-1)) >>> 0
}

// ===== 最小 ZIP（STORE 不压缩；Excel/WPS 与 SheetJS 均兼容） =====
function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  entries.forEach(entry => {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const localOffset = offset

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)      // local file header signature
    local.writeUInt16LE(20, 4)              // version needed
    local.writeUInt16LE(0, 6)               // general purpose flags
    local.writeUInt16LE(0, 8)               // method: STORE
    local.writeUInt16LE(0, 10)              // mod time (0)
    local.writeUInt16LE(0x21, 12)           // mod date: 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18) // compressed size (= raw for STORE)
    local.writeUInt32LE(entry.data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)              // extra field len
    nameBuf.copy(local, 30)
    locals.push(local, entry.data)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)    // central directory signature
    central.writeUInt16LE(20, 4)            // version made by
    central.writeUInt16LE(20, 6)            // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)            // extra len
    central.writeUInt16LE(0, 32)            // comment len
    central.writeUInt16LE(0, 34)            // disk number
    central.writeUInt16LE(0, 36)            // internal attrs
    central.writeUInt32LE(0, 38)            // external attrs
    central.writeUInt32LE(localOffset, 42)  // local header offset
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + entry.data.length
  })

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)         // end of central directory
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, eocd])
}

// ===== SpreadsheetML 组装 =====
function sheetXml(rows, colWidths) {
  const cols = colWidths
    ? '<cols>' + colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    : ''
  const body = rows.map((cells, r) => {
    const cs = cells.map((text, c) => {
      const ref = String.fromCharCode(65 + c) + (r + 1) // A1/B1/... 本模板仅单字符列
      return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cs}</row>`
  }).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols + '<sheetData>' + body + '</sheetData></worksheet>'
}

// 列头与 importProducts/index.js 的 HEADER_ALIASES 严格对齐（改这里前先核对那边）
const HEADERS = ['商品名称', '一级分类', '二级分类', '单位', '规格', '厂家/品牌', '默认供应商']

const TIPS = [
  ['商品导入模板 · 填写说明'],
  [''],
  ['1. 第一张表「导入模板」按列头逐行填写；列顺序不限，多余列会被忽略。'],
  ['2. 必填列：商品名称、二级分类、单位；其余可选。'],
  ['3. 二级分类须与系统已有分类名称完全一致（可另填一级分类辅助定位同名分类）。'],
  ['4. 厂家/品牌留空默认为「默认」；默认供应商按名称匹配，匹配不到会留空并给出提示。'],
  ['5. 同名同厂家的商品会被判重跳过，不会重复建档。'],
  ['6. 模板不含示例数据行——请勿在模板里直接留示例，示例会被当成真实商品导入。'],
  ['7. 导入入口：商品管理页 → Excel 导入。需先把本文件发送到微信聊天（如文件传输助手），'],
  ['   在手机上打开小程序，从该聊天中选择填写好的文件导入（电脑端微信/开发者工具不支持选文件）。'],
  ['8. 建议单次不超过 500 行；行数较多请拆分多个文件分批导入。'],
  ['9. 支持 .xlsx 格式；不支持 .xls / .csv。']
]

const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>'

const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets>' +
  '<sheet name="导入模板" sheetId="1" r:id="rId1"/>' +
  '<sheet name="填写说明" sheetId="2" r:id="rId2"/>' +
  '</sheets></workbook>'

const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
  '</Relationships>'

const zip = makeZip([
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
  { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
  { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
  { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml([HEADERS], [20, 14, 16, 10, 14, 18, 20]), 'utf8') },
  { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheetXml(TIPS, [100]), 'utf8') }
])

const outDir = path.join(__dirname, '..', 'assets', 'templates')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, '商品导入模板.xlsx')
fs.writeFileSync(outFile, zip)
console.log('已生成:', outFile, `(${zip.length} bytes, ${HEADERS.length} 列)`)
