/**
 * T173：對比度稽核，寫成會失敗的測試而不是一次性的檢查。
 *
 * ## 為什麼是測試而不是註解
 *
 * `index.css` 的每個色都標了對比度，但那是人手填的，而人手填的數字沒有人會
 * 再算一次。有人為了「看起來淡一點」把 `--color-ink-muted` 調亮兩階，註解裡
 * 的 `7.3:1` 會原封不動地留在那裡繼續背書。這支測試直接讀那份 CSS、重算、
 * 對不上就紅。
 *
 * ## ⚠️ 4.5:1 是文字，3:1 是圖形
 *
 * 兩個門檻不同（WCAG 1.4.3 與 1.4.11）。`--color-brand-accent` 只有 3.88:1，
 * 它**只能**用在 `aria-hidden` 的星號那種裝飾字符上——那是圖形，資訊在旁邊的
 * 數字裡。拿它寫真正的文字就是不合格，因此下面明確地把它排除在文字色之外。
 */
// @vitest-environment node
//
// ⚠️ 這一支不需要 DOM，而 jsdom 之下 `import.meta.url` 是 http URL，
// `fileURLToPath` 會直接拋「The URL must be of scheme file」。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CSS = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf-8')

/** 從 `@theme` 讀出 `--color-*`。⚠️ 讀檔而不是抄一份——抄的那份會漂移。 */
function tokens(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of CSS.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (name && value) out[name] = value.toLowerCase()
  }
  return out
}

const COLORS = tokens()

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function ratio(fgToken: string, bgToken: string): number {
  const fg = COLORS[fgToken]
  const bg = COLORS[bgToken]
  if (!fg || !bg) throw new Error(`index.css 裡沒有 --color-${fg ? bgToken : fgToken}`)
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * 畫面上真的存在的「文字色／背景色」配對。
 *
 * ⚠️ 新增一組 `text-X` 配 `bg-Y` 的組合時 MUST 一併加進這裡。漏加不會有任何
 * 徵兆——那組配色就只是沒有被算過而已。
 */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'surface-alt'],
  ['ink', 'brand-soft'],
  ['ink', 'warn-soft'],
  ['ink-muted', 'bg'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'surface-alt'],
  // 反白文字：按鈕與徽章的填色
  ['ink-invert', 'brand'],
  ['ink-invert', 'brand-strong'],
  ['ink-invert', 'forest'],
  ['ink-invert', 'danger'],
  // 連結與強調
  ['brand', 'bg'],
  ['brand', 'surface'],
  ['brand-strong', 'bg'],
  ['brand-strong', 'surface'],
  ['brand-strong', 'surface-alt'],
  ['brand-strong', 'brand-soft'],
  ['forest', 'bg'],
  ['forest', 'forest-soft'],
  // 語意色徽章（`lib/labels.ts` 的 TONE_CLASS）與行內訊息
  ['ok', 'ok-soft'],
  ['ok', 'bg'],
  ['ok', 'surface'],
  ['warn', 'warn-soft'],
  ['warn', 'bg'],
  ['warn', 'surface'],
  ['danger', 'danger-soft'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['info', 'info-soft'],
  ['info', 'bg'],
  ['info', 'surface'],
]

describe('WCAG AA：文字對比 MUST 至少 4.5:1（憲章原則 V）', () => {
  it.each(TEXT_PAIRS)('text-%s on bg-%s', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('憲章「已知不合規項目」', () => {
  it('⚠️ 品牌色是 #7a6132，不是舊的 #96793f', () => {
    // 舊值配白字只有 4.11:1。它承載「立即訂房」——全站最需要看得清楚的元件
    expect(COLORS.brand).toBe('#7a6132')
    expect(COLORS.brand).not.toBe('#96793f')
    expect(ratio('ink-invert', 'brand')).toBeGreaterThanOrEqual(4.5)
  })

  it('⚠️ 舊的 #7c8883 淡色文字 MUST NOT 被移植過來', () => {
    // 3.4:1，低於 AA。真正次要到可以更淡的內容，多半是不該顯示的內容。
    //
    // ⚠️ 驗的是 **token**，不是整份檔案：那個色碼**應該**出現在說明它為什麼
    // 沒被移植的註解裡。連註解都一起禁掉，等於逼下一個人刪掉那段理由。
    expect(Object.values(COLORS)).not.toContain('#7c8883')
  })

  it('⚠️ brand-accent 達不到文字門檻，因此只能當裝飾', () => {
    // 這一條不是為了通過，是為了**釘住那個事實**：有人日後拿它寫文字時，
    // 這裡的 3.88 會提醒他為什麼 index.css 說它 MUST NOT 承載文字
    const r = ratio('brand-accent', 'surface')
    expect(r).toBeLessThan(4.5)
    // 但它仍要看得見——圖形的門檻是 3:1（WCAG 1.4.11）
    expect(r).toBeGreaterThanOrEqual(3)
  })
})

describe('註解裡的數字 MUST 與實際相符', () => {
  /**
   * ⚠️ 這一段驗的是**文件本身**。
   *
   * 註解寫 `7.3:1` 而實際是 `4.2:1` 的時候，程式不會壞——壞的是下一個人的
   * 判斷依據，而他不會去重算。
   */
  const ANNOTATED: [fg: string, bg: string, claimed: number][] = [
    ['ink', 'bg', 14.1],
    ['ink-muted', 'bg', 7.0],
    ['ink-invert', 'brand', 5.9],
    ['ink-invert', 'brand-strong', 7.9],
    ['ink-invert', 'forest', 9.8],
    ['brand-accent', 'surface', 4.1],
    ['brand-accent', 'bg', 3.9],
    ['ok', 'ok-soft', 5.4],
    ['ok', 'bg', 5.9],
    ['warn', 'warn-soft', 4.7],
    ['warn', 'bg', 5.0],
    ['danger', 'danger-soft', 6.2],
    ['danger', 'bg', 6.9],
    ['info', 'info-soft', 6.1],
    ['info', 'bg', 6.7],
  ]

  it.each(ANNOTATED)('--color-%s 對 %s 註記的 %s:1', (fg, bg, claimed) => {
    // 容差 0.05：註解取到一位小數，所以只容得下捨入。再寬就會放過真正的漂移
    expect(Math.abs(ratio(fg, bg) - claimed)).toBeLessThan(0.05)
  })
})
