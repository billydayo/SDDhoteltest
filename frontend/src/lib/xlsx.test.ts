/**
 * `lib/xlsx.ts` 的測試（FR-058）。
 *
 * ## 為什麼要自己把 ZIP 拆回來
 *
 * 「有沒有丟例外」證明不了任何事——一份中央目錄偏移量算錯的 ZIP 照樣能被
 * 產生出來，只是 Excel 打不開。而「Excel 打不開」是使用者才會發現的失敗。
 *
 * 因此這裡用一個獨立的小 reader 把檔案拆回來，驗的是**結構**：每一筆中央
 * 目錄項目指到的偏移量上真的有 local header、CRC 與長度對得起來。CRC 用
 * Node 內建的 `zlib.crc32` 重算——刻意不重用被測模組自己的實作，否則實作與
 * 期望值一起錯的時候測試依然是綠的。
 */
import { crc32 as nodeCrc32 } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { buildXlsxBytes, columnName } from './xlsx'

// ---------------------------------------------------------------------------
// 極簡 ZIP reader（只支援 store）
// ---------------------------------------------------------------------------
interface ParsedEntry {
  name: string
  text: string
  crc: number
  size: number
}

function readU16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  )
}

function parseZip(bytes: Uint8Array): ParsedEntry[] {
  // EOCD 沒有註解，所以固定落在最後 22 個位元組。
  const eocd = bytes.length - 22
  expect(readU32(bytes, eocd)).toBe(0x06054b50)

  const count = readU16(bytes, eocd + 10)
  const centralSize = readU32(bytes, eocd + 12)
  const centralOffset = readU32(bytes, eocd + 16)
  expect(centralOffset + centralSize).toBe(eocd)

  const decoder = new TextDecoder()
  const entries: ParsedEntry[] = []
  let cursor = centralOffset

  for (let i = 0; i < count; i += 1) {
    expect(readU32(bytes, cursor)).toBe(0x02014b50)
    const crc = readU32(bytes, cursor + 16)
    const size = readU32(bytes, cursor + 24)
    const nameLength = readU16(bytes, cursor + 28)
    const localOffset = readU32(bytes, cursor + 42)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    // 中央目錄指到的位置上必須真的是一個 local header。偏移量算錯時
    // 這裡就會炸——那正是 Excel 拒絕開啟檔案的原因。
    expect(readU32(bytes, localOffset)).toBe(0x04034b50)
    expect(readU16(bytes, localOffset + 8)).toBe(0) // store
    expect(readU32(bytes, localOffset + 14)).toBe(crc)
    const localNameLength = readU16(bytes, localOffset + 26)
    const extraLength = readU16(bytes, localOffset + 28)
    const dataAt = localOffset + 30 + localNameLength + extraLength
    const data = bytes.subarray(dataAt, dataAt + size)

    expect(nodeCrc32(data)).toBe(crc)

    entries.push({ name, text: decoder.decode(data), crc, size })
    cursor += 46 + nameLength
  }

  return entries
}

function sheetOf(bytes: Uint8Array): string {
  const entry = parseZip(bytes).find((item) => item.name === 'xl/worksheets/sheet1.xml')
  expect(entry).toBeDefined()
  return entry?.text ?? ''
}

const COLUMNS = [
  { key: 'orderNo', label: '訂單編號' },
  { key: 'total', label: '金額' },
]

// ---------------------------------------------------------------------------
describe('columnName', () => {
  it('依 Excel 的欄名規則進位', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    // 26 進位但沒有「零」——A 同時是 1 也是第一個字元，所以不是單純的 26 進位。
    expect(columnName(26)).toBe('AA')
    expect(columnName(51)).toBe('AZ')
    expect(columnName(52)).toBe('BA')
    expect(columnName(701)).toBe('ZZ')
    expect(columnName(702)).toBe('AAA')
  })
})

describe('buildXlsxBytes 的封裝結構', () => {
  const bytes = buildXlsxBytes({
    sheetName: '訂單',
    columns: COLUMNS,
    rows: [{ orderNo: 'SU-20260804-0001', total: 4200 }],
  })

  it('是一份 ZIP，且每一筆項目的 CRC 與偏移量都對得起來', () => {
    const entries = parseZip(bytes)
    expect(entries.length).toBe(5)
  })

  it('含 OOXML 必要的五個部件', () => {
    const names = parseZip(bytes).map((entry) => entry.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ])
  })

  it('workbook 指向 sheet1，關聯 id 對得上', () => {
    const entries = parseZip(bytes)
    const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml')?.text ?? ''
    const rels = entries.find((entry) => entry.name === 'xl/_rels/workbook.xml.rels')?.text ?? ''
    expect(workbook).toContain('r:id="rId1"')
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('Target="worksheets/sheet1.xml"')
  })

  it('相同輸入產生位元組完全相同的檔案', () => {
    const again = buildXlsxBytes({
      sheetName: '訂單',
      columns: COLUMNS,
      rows: [{ orderNo: 'SU-20260804-0001', total: 4200 }],
    })
    expect(Array.from(again)).toEqual(Array.from(bytes))
  })
})

describe('儲存格', () => {
  it('數字寫成 <v>，Excel 才能對金額做加總', () => {
    const xml = sheetOf(
      buildXlsxBytes({ sheetName: '訂單', columns: COLUMNS, rows: [{ orderNo: 'A', total: 4200 }] }),
    )
    expect(xml).toContain('<c r="B2"><v>4200</v></c>')
    // 數字 MUST NOT 被寫成 inlineStr——那樣加總會得到 0。
    expect(xml).not.toContain('<c r="B2" t="inlineStr"')
  })

  it('字串走 inlineStr 並保留前後空白', () => {
    const xml = sheetOf(
      buildXlsxBytes({
        sheetName: '訂單',
        columns: COLUMNS,
        rows: [{ orderNo: ' 前後有空白 ', total: 1 }],
      }),
    )
    expect(xml).toContain('t="inlineStr"')
    expect(xml).toContain('<t xml:space="preserve"> 前後有空白 </t>')
  })

  it('跳脫 XML 的保留字元', () => {
    const xml = sheetOf(
      buildXlsxBytes({
        sheetName: '訂單',
        columns: COLUMNS,
        rows: [{ orderNo: 'A & B <c>', total: 1 }],
      }),
    )
    expect(xml).toContain('A &amp; B &lt;c&gt;')
    expect(xml).not.toContain('A & B <c>')
  })

  it('剔除會讓 Excel 判定檔案毀損的控制字元，但保留換行', () => {
    // 用 fromCharCode 產生，不把看不見的位元組寫進原始碼——那種字元在編輯器裡
    // 沒有痕跡，任何一次自動清理都會把它刪掉，而測試會就這樣悄悄失去意義。
    const bell = String.fromCharCode(0x07)
    const del = String.fromCharCode(0x7f)
    const xml = sheetOf(
      buildXlsxBytes({
        sheetName: '訂單',
        columns: COLUMNS,
        rows: [{ orderNo: `乾淨的值${bell}${del}\n第二行`, total: 1 }],
      }),
    )
    expect(xml).toContain('乾淨的值\n第二行')
    expect(xml).not.toContain(bell)
    expect(xml).not.toContain(del)
  })

  it('空值不產生儲存格，而不是產生一格 "null"', () => {
    const xml = sheetOf(
      buildXlsxBytes({
        sheetName: '訂單',
        columns: COLUMNS,
        rows: [{ orderNo: null, total: undefined }],
      }),
    )
    expect(xml).toContain('<row r="2"></row>')
    expect(xml).not.toContain('null')
    expect(xml).not.toContain('undefined')
  })

  it('欄位順序依 columns，而不是資料物件的鍵順序', () => {
    const xml = sheetOf(
      buildXlsxBytes({
        sheetName: '訂單',
        columns: COLUMNS,
        // 鍵故意倒過來寫。
        rows: [{ total: 4200, orderNo: 'SU-1' }],
      }),
    )
    expect(xml.indexOf('A2')).toBeLessThan(xml.indexOf('B2'))
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">SU-1</t></is></c>')
  })

  it('表頭固定在第 1 列並凍結', () => {
    const xml = sheetOf(buildXlsxBytes({ sheetName: '訂單', columns: COLUMNS, rows: [] }))
    expect(xml).toContain('<row r="1">')
    expect(xml).toContain('訂單編號')
    expect(xml).toContain('state="frozen"')
  })

  it('沒有資料列時仍是一份結構完整的檔案', () => {
    const bytes = buildXlsxBytes({ sheetName: '訂單', columns: COLUMNS, rows: [] })
    expect(parseZip(bytes).length).toBe(5)
  })
})

describe('工作表名稱', () => {
  function nameIn(sheetName: string): string {
    const bytes = buildXlsxBytes({ sheetName, columns: COLUMNS, rows: [] })
    const workbook = parseZip(bytes).find((entry) => entry.name === 'xl/workbook.xml')?.text ?? ''
    return /<sheet name="([^"]*)"/.exec(workbook)?.[1] ?? ''
  }

  it('置換 Excel 禁用的字元', () => {
    // 這幾個字元會讓 Excel 拒絕開啟整份檔案，而不是只忽略那個名稱。
    expect(nameIn('訂單[2026]/一月')).toBe('訂單_2026__一月')
  })

  it('截到 31 個字元', () => {
    expect(nameIn('一'.repeat(40)).length).toBe(31)
  })

  it('全部被清掉時退回預設名稱', () => {
    expect(nameIn('///')).toBe('___')
    expect(nameIn('')).toBe('工作表')
  })
})
