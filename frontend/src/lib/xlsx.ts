/**
 * 最小可用的 .xlsx 產生器（FR-058）。
 *
 * ## 為什麼不用 npm 上的 `xlsx`
 *
 * 那個套件目前掛著兩則 high 等級公告（prototype pollution 與 ReDoS），而且
 * **`npm audit` 明白寫著 No fix available**——修好的版本只在 SheetJS 自架的
 * CDN 上，不在 registry。把一個永遠修不掉的 high 公告寫進 `package.json`，
 * 會讓之後每一次 `npm audit` 都是紅的；紅久了就沒有人會再讀它，而下一則真正
 * 該處理的公告會混在同一片紅色裡被略過。
 *
 * 兩則漏洞都在**讀取**未知來源活頁簿的解析路徑上，我們只寫不讀——但這是
 * 「目前用不到那條路徑」，不是「那條路徑不存在」。既然我們只需要寫出一張
 * 沒有樣式的工作表，自己寫比長期扛著那份公告便宜。
 *
 * ## xlsx 就是一個 ZIP
 *
 * 裡面放幾份 XML。這裡用 **store（不壓縮）** 寫入：省掉 deflate 實作，而
 * 匯出的資料量（後端上限 500 筆）不值得為了檔案大小引入壓縮器。Excel、
 * LibreOffice 與 Google 試算表都吃 store 的 ZIP。
 *
 * ## 這個模組 MUST 保持可被動態載入
 *
 * `ExportButton` 用 `import()` 拉它，Vite 因此會切出獨立 chunk——**FR-059 與
 * SC-010 要求離線時退回 CSV**，而那個行為只有在 xlsx 的產生器確實是一份需要
 * 另外抓的資源時才是真的。全部打進主 bundle 的話，「載不到」永遠不會發生，
 * 退回路徑就成了測不到的死碼。
 */

/** 一欄。`key` 對資料列取值，`label` 是表頭文字。 */
export interface SheetColumn {
  key: string
  label: string
}

export interface WorkbookInput {
  sheetName: string
  columns: SheetColumn[]
  rows: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// 位元組緩衝區
// ---------------------------------------------------------------------------
/**
 * 逐步成長的位元組緩衝區。
 *
 * ⚠️ 不要用 `array.push(...bytes)` 代替。展開運算子走的是 `apply` 的參數傳遞
 * 路徑，一份 20 萬位元組的工作表 XML 會直接把呼叫堆疊撐爆——而那個爆炸只在
 * 資料量夠大時才發生，小樣本測試完全看不到。
 */
class ByteWriter {
  // ⚠️ 明寫 `<ArrayBuffer>`。TypeScript 5.7 起 `Uint8Array` 帶泛型參數，
  // 預設推得的 `ArrayBufferLike` 涵蓋 `SharedArrayBuffer`，而 `Blob` 不收它。
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(4096)
  private length = 0

  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
  }

  /** 小端序 16 位元。ZIP 的所有數值欄位都是小端序。 */
  u16(value: number) {
    this.ensure(2)
    this.buffer[this.length] = value & 0xff
    this.buffer[this.length + 1] = (value >>> 8) & 0xff
    this.length += 2
  }

  u32(value: number) {
    this.ensure(4)
    this.buffer[this.length] = value & 0xff
    this.buffer[this.length + 1] = (value >>> 8) & 0xff
    this.buffer[this.length + 2] = (value >>> 16) & 0xff
    this.buffer[this.length + 3] = (value >>> 24) & 0xff
    this.length += 4
  }

  bytes(value: Uint8Array) {
    this.ensure(value.length)
    this.buffer.set(value, this.length)
    this.length += value.length
  }

  get size(): number {
    return this.length
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.length)
  }
}

// ---------------------------------------------------------------------------
// CRC32 —— ZIP 的每一個項目都要
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------
/**
 * 剔除 XML 1.0 不允許的控制字元，保留 tab、換行與歸位。
 *
 * ⚠️ 一定要做。留一個 U+0001 在字串裡，Excel 會判定檔案毀損並拒絕開啟整份
 * 活頁簿——不是那一格顯示亂碼，是整個檔案打不開。而使用者貼進備註欄的內容
 * 帶著控制字元並不罕見。
 *
 * 用逐字元比對而不是正規表達式：把控制字元寫進字面量的 regex 會讓原始碼裡
 * 出現看不見的位元組，任何一次編輯器的自動清理都可能悄悄改掉它。
 */
function stripIllegal(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue
    if (code === 0x7f) continue
    out += char
  }
  return out
}

function xmlText(value: string): string {
  return stripIllegal(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function xmlAttr(value: string): string {
  return xmlText(value).replaceAll('"', '&quot;')
}

/** 0 → A、25 → Z、26 → AA。 */
export function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/**
 * 工作表名稱的硬性限制：最長 31 字，且不得含 `[]:*?/\`。
 * 超過或含禁用字元時 Excel 會拒絕開啟整份檔案，而不是幫忙截短。
 */
function safeSheetName(name: string): string {
  const cleaned = stripIllegal(name)
    .replace(/[[\]:*?/\\]/g, '_')
    .slice(0, 31)
  return cleaned.length > 0 ? cleaned : '工作表'
}

function stringify(value: unknown): string {
  const json: unknown = JSON.stringify(value)
  return typeof json === 'string' ? json : ''
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return stringify(value)
}

/**
 * 一格。
 *
 * 字串一律走 `inlineStr`——不建 sharedStrings 表。共用字串省下來的空間對
 * 幾百列的匯出沒有意義，卻多一份必須與工作表保持同步的索引。
 *
 * 數字寫成 `<v>`，Excel 才會當數字處理（可以排序、加總）。全部寫成字串的話，
 * 業者在 Excel 裡對金額欄位做加總會得到 0。
 */
function cellXml(ref: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${String(value)}</v></c>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? '1' : '0'}</v></c>`
  }
  // `xml:space="preserve"`：不加的話前後空白會被吃掉，而空白有時就是資料。
  const text = xmlText(cellText(value))
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

/** 概略欄寬。全形字元算兩格，否則中文表頭會被截掉。 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += code > 0x1100 ? 2 : 1
  }
  return width
}

function sheetXml(input: WorkbookInput): string {
  const cols = input.columns
    .map((column, index) => {
      let width = displayWidth(column.label)
      for (const row of input.rows) {
        width = Math.max(width, displayWidth(cellText(row[column.key])))
      }
      const clamped = Math.min(Math.max(width + 2, 8), 60)
      const at = String(index + 1)
      return `<col min="${at}" max="${at}" width="${String(clamped)}" customWidth="1"/>`
    })
    .join('')

  const header = input.columns
    .map((column, index) => cellXml(`${columnName(index)}1`, column.label))
    .join('')

  const body = input.rows
    .map((row, rowIndex) => {
      const at = rowIndex + 2
      const cells = input.columns
        .map((column, index) => cellXml(`${columnName(index)}${String(at)}`, row[column.key]))
        .join('')
      return `<row r="${String(at)}">${cells}</row>`
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // 凍結表頭。捲到第 300 列還看得到欄位名稱——沒有它，長報表要靠記憶讀。
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    '</worksheet>'
  )
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>'

function workbookXml(sheetName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlAttr(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  )
}

// ---------------------------------------------------------------------------
// ZIP（store，不壓縮）
// ---------------------------------------------------------------------------
interface ZipEntry {
  name: string
  data: Uint8Array
}

/**
 * 固定用 DOS 紀元（1980-01-01 00:00）當每個項目的修改時間。
 *
 * 刻意不寫入當下時間：同一份資料應該產出位元組完全相同的檔案，測試才有辦法
 * 直接比對。Excel 不會因為時間戳是 1980 年而有任何差別。
 */
const DOS_TIME = 0
/** (1980−1980)<<9 | 1<<5 | 1 —— DOS 日期沒有「第 0 月」與「第 0 日」。 */
const DOS_DATE = 33

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** 旗標 0x0800＝檔名為 UTF-8。省略的話含非 ASCII 的路徑會被當成 CP437。 */
const UTF8_FLAG = 0x0800

function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const local = new ByteWriter()
  const central = new ByteWriter()

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const sum = crc32(entry.data)
    const size = entry.data.length
    const offset = local.size

    local.u32(LOCAL_SIG)
    local.u16(20) // version needed
    local.u16(UTF8_FLAG)
    local.u16(0) // method: store
    local.u16(DOS_TIME)
    local.u16(DOS_DATE)
    local.u32(sum)
    local.u32(size) // compressed
    local.u32(size) // uncompressed
    local.u16(nameBytes.length)
    local.u16(0) // extra length
    local.bytes(nameBytes)
    local.bytes(entry.data)

    central.u32(CENTRAL_SIG)
    central.u16(20) // version made by
    central.u16(20) // version needed
    central.u16(UTF8_FLAG)
    central.u16(0) // method: store
    central.u16(DOS_TIME)
    central.u16(DOS_DATE)
    central.u32(sum)
    central.u32(size)
    central.u32(size)
    central.u16(nameBytes.length)
    central.u16(0) // extra
    central.u16(0) // comment
    central.u16(0) // disk number
    central.u16(0) // internal attrs
    central.u32(0) // external attrs
    central.u32(offset)
    central.bytes(nameBytes)
  }

  const out = new ByteWriter()
  out.bytes(local.toBytes())
  const centralOffset = out.size
  out.bytes(central.toBytes())
  out.u32(EOCD_SIG)
  out.u16(0) // this disk
  out.u16(0) // disk with central directory
  out.u16(entries.length)
  out.u16(entries.length)
  out.u32(central.size)
  out.u32(centralOffset)
  out.u16(0) // comment length
  return out.toBytes()
}

// ---------------------------------------------------------------------------
// 對外入口
// ---------------------------------------------------------------------------
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 產生一份單一工作表的 .xlsx 位元組。 */
export function buildXlsxBytes(input: WorkbookInput): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const name = safeSheetName(input.sheetName)
  return zip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(name)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml(input)) },
  ])
}

/** 產生一份單一工作表的 .xlsx。 */
export function buildXlsx(input: WorkbookInput): Blob {
  return new Blob([buildXlsxBytes(input)], { type: XLSX_MIME })
}
