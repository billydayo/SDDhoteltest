// @vitest-environment node
//
// 讀原始碼，不碰 DOM。jsdom 之下 `import.meta.url` 是 http URL，
// `fileURLToPath` 會直接拋。
/**
 * T172a：語言與格式稽核（FR-069、FR-070）。
 *
 * 三條可以被機器判定的規則：
 *
 * 1. 介面文字為**繁體中文**——掃簡體字形。
 * 2. 金額格式化只有一個出口（`lib/money.ts`），且**不出現小數**。
 * 3. 日期格式化只有一個出口（`lib/dates.ts`），全站同一種寫法。
 *
 * ## 為什麼「全站一致」需要一支測試
 *
 * 不一致不會壞掉任何東西。它的症狀是：訂單列表寫 `2026/09/01`，詳情頁寫
 * `2026年9月1日`，匯出的 CSV 又是 `09/01/2026`——每一頁單獨看都沒問題，
 * 只有把它們排在一起才看得出來，而沒有人會把它們排在一起。
 *
 * 同一條適用於金額：某一頁用 `toLocaleString()` 而其他頁用 `formatTWD()`，
 * 差別要到某個數字剛好帶小數時才會現形。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as dates from '../dates'
import { formatAmount, formatTWD } from '../money'

const SELF = fileURLToPath(import.meta.url)
const SRC = resolve(dirname(SELF), '../..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * ⚠️ **排除本檔自己。** 下面那份簡體字表就寫在這個檔案裡，不排除的話這支
 * 測試永遠會指著自己失敗，然後被關掉。
 */
const FILES = walk(SRC).filter((path) => basename(path) !== basename(SELF))

function rel(path: string): string {
  return path.replaceAll('\\', '/').split('/src/')[1] ?? path
}

// ---------------------------------------------------------------------------
/**
 * 簡體字形。
 *
 * ⚠️ 只列**繁體正字法裡不存在**的字形。`台`／`臺` 兩者在台灣都通行、
 * `遇`／`逃`／`部` 本來就是繁體字——把它們列進來，這支測試會在正確的文字上
 * 失敗，而那種測試最後一定被刪掉。
 */
const SIMPLIFIED_SOURCE =
  '们个这么对开关说认请确显单订间数员录时户页网载应试验详价项类' +
  '图银钱买卖车长门问马鸟龙东书见观觉学会体医术华汉讯语谢议论设' +
  '计记访评该读谁课调边过还进远连运达迟选适递邮阳阴陆队险难双发' +
  '变济营销费质检测归绝纪级红约结给统绿维绍经继续缩纸练组织终' +
  '现规视证识译谈诉词诚让训讨讲许转轮软输较辆违遗邻郑释'

// ⚠️ 用 `for...of` 逐字取而不是展開運算子：後者對代理對（surrogate pair）
// 的處理不安全，而 ESLint 的 `no-misused-spread` 正是為此而設。
const SIMPLIFIED: string[] = []
for (const ch of SIMPLIFIED_SOURCE) SIMPLIFIED.push(ch)

describe('繁體中文（FR-069）', () => {
  it('簡體字表本身是有效的（防止空表空轉通過）', () => {
    expect(SIMPLIFIED.length).toBeGreaterThan(100)
    expect(FILES.length).toBeGreaterThan(50)
  })

  it('⚠️ src/ 裡沒有任何簡體字', () => {
    const offenders: string[] = []
    for (const path of FILES) {
      const text = readFileSync(path, 'utf8')
      const found = SIMPLIFIED.filter((ch) => text.includes(ch))
      if (found.length > 0) offenders.push(`${rel(path)} → ${found.join('')}`)
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('金額只有一個出口且不出現小數（FR-070）', () => {
  it('⚠️ `NT$` 字面值只出現在 lib/money.ts', () => {
    const offenders = FILES.filter(
      (path) => !path.replaceAll('\\', '/').endsWith('/lib/money.ts'),
    )
      .filter((path) => readFileSync(path, 'utf8').includes('NT$'))
      .map(rel)
      // 測試檔會斷言畫面上的 `NT$ 6,400`，那是在驗結果而不是在自己排版
      .filter((path) => !/\.(test|spec)\.tsx?$/.test(path) && !path.startsWith('test/'))

    expect(offenders).toEqual([])
  })

  it('⚠️ `Intl.` 只出現在 lib/money.ts', () => {
    // 各頁自己 `new Intl.NumberFormat(...)` 的話，選項（小數位、千分位）
    // 會逐頁漂移，而差異只在某些數字上現形
    const offenders = FILES.filter(
      (path) => !path.replaceAll('\\', '/').endsWith('/lib/money.ts'),
    )
      .filter((path) => /\bIntl\s*\./.test(readFileSync(path, 'utf8')))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('整數金額帶千分位，且小數一律捨去', () => {
    expect(formatTWD(6400)).toBe('NT$ 6,400')
    expect(formatTWD(1234567)).toBe('NT$ 1,234,567')
    expect(formatTWD(3200.4)).not.toMatch(/\./)
    expect(formatAmount(3200.6)).not.toMatch(/\./)
  })

  it('非法金額顯示 `—` 而不是 NaN', () => {
    // `NT$ NaN` 會讓使用者以為網站壞了；`—` 至少說明這裡沒有資料
    expect(formatTWD(Number.NaN)).toBe('—')
    expect(formatTWD(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

// ---------------------------------------------------------------------------
describe('日期格式全站一致（FR-069）', () => {
  it('⚠️ 沒有任何檔案自己呼叫 toLocale*Date/Time/String', () => {
    const offenders = FILES.filter((path) =>
      /\btoLocale(Date|Time)?String\s*\(/.test(readFileSync(path, 'utf8')),
    ).map(rel)

    expect(offenders).toEqual([])
  })

  it('顯示格式是 YYYY/MM/DD，含補零', () => {
    expect(dates.formatDisplayDate('2026-09-01')).toBe('2026/09/01')
    expect(dates.formatDisplayDate('2026-12-25')).toBe('2026/12/25')
  })

  it('住宿區間與時間戳都建立在同一個顯示格式上', () => {
    expect(dates.formatStay('2026-09-01', '2026-09-03')).toBe('2026/09/01 – 2026/09/03（2 晚）')
    expect(dates.formatTimestamp('2026-08-04T09:05:00+08:00')).toMatch(
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
    )
  })

  it('⚠️ 認不出來的值原樣回傳，MUST NOT 顯示 Invalid Date', () => {
    expect(dates.formatDisplayDate('not-a-date')).toBe('not-a-date')
    expect(dates.formatTimestamp('not-a-date')).toBe('not-a-date')
  })
})
