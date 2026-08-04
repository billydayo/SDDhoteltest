// @vitest-environment node
//
// 讀原始碼，不碰 DOM。
/**
 * T171：無障礙稽核裡**可以被機器判定**的部分（憲章原則 V、SC-011）。
 *
 * 分成兩支測試是刻意的：
 *
 * - 這一支掃原始碼，涵蓋**每一個檔案**，包含日後新增的頁面。
 * - `pages/__tests__/bookingKeyboard.test.tsx` 真的用鍵盤走完訂房流程，
 *   驗的是 SC-011 那條「MUST 能純以鍵盤完成」。
 *
 * 靜態掃不到的兩件事仍需人眼：色彩以外的狀態標示、以及螢幕閱讀器實際唸出的
 * 順序。前者散落在各元件（`aria-pressed`、`aria-current` 等），後者要真的開
 * 一次 NVDA——那兩項留在 T181 的走訪清單裡。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const SRC = resolve(dirname(SELF), '..')

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, exts))
    else if (exts.test(entry.name)) out.push(full)
  }
  return out
}

/** `[^:]` 是為了不把 `https://…` 的後半段當成行註解吃掉。 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // JSX 註解
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const TSX = walk(SRC, /\.tsx$/).filter(
  (path) => !/\.(test|spec)\.tsx$/.test(path) && basename(path) !== basename(SELF),
)
const STYLES = walk(resolve(SRC, 'styles'), /\.css$/)

function rel(path: string): string {
  return path.replaceAll('\\', '/').split('/src/')[1] ?? path
}

describe('掃描範圍', () => {
  it('掃到了真的檔案（防止路徑算錯而空轉通過）', () => {
    expect(TSX.length).toBeGreaterThan(30)
    expect(STYLES.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ 互動一律用 button／a，MUST NOT 用 div + onClick', () => {
  /**
   * 非互動元素。
   *
   * `div` 上掛 `onClick` 的失效方式很安靜：滑鼠使用者完全正常，鍵盤使用者
   * Tab 不到它、讀屏使用者聽不到它是可以按的。畫面上沒有任何異常。
   */
  const NON_INTERACTIVE = new Set(['div', 'span', 'p', 'li', 'ul', 'ol', 'td', 'tr', 'section'])

  it.each(TSX.map((path) => [rel(path), path] as const))('%s', (_name, path) => {
    const source = stripComments(readFileSync(path, 'utf8'))
    const offenders: string[] = []

    for (const match of source.matchAll(/\bonClick\b/g)) {
      // 往前找最近的一個開標籤。JSX 的屬性值裡幾乎不會出現 `<`，
      // 而註解已經先被拿掉了
      const before = source.slice(0, match.index)
      const open = /<([a-zA-Z][\w.]*)[^<]*$/.exec(before)
      const tag = open?.[1]
      if (tag !== undefined && NON_INTERACTIVE.has(tag)) offenders.push(tag)
    }

    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ 每個 <img> 都有 alt', () => {
  it.each(TSX.map((path) => [rel(path), path] as const))('%s', (_name, path) => {
    const source = stripComments(readFileSync(path, 'utf8'))
    const offenders: string[] = []

    for (const match of source.matchAll(/<img\b/g)) {
      // 自閉合標籤，讀到 `/>` 為止。裝飾性圖片寫 `alt=""` 也算有——
      // 空的 alt 是「請跳過我」的明確指示，與**忘了寫**是兩件事
      const rest = source.slice(match.index, match.index + 600)
      const end = rest.indexOf('/>')
      const tag = end === -1 ? rest : rest.slice(0, end)
      if (!/\balt\s*=/.test(tag)) offenders.push(tag.slice(0, 80))
    }

    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ 焦點環 MUST NOT 被移除', () => {
  it('沒有任何檔案使用 outline-none 或 outline: none', () => {
    // 只用鍵盤的人會就此完全失去「我現在在哪裡」的資訊，而滑鼠使用者
    // 完全察覺不到，因此這件事幾乎不會被回報
    const offenders = [...TSX, ...STYLES]
      .filter((path) => /outline-none|outline:\s*none/.test(stripComments(readFileSync(path, 'utf8'))))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('全站的 :focus-visible 樣式仍然在', () => {
    // 上一條只證明沒有人移除它。這一條證明它一開始就存在——
    // 兩條都需要，少了這一條，把整段樣式刪掉反而會讓測試變綠
    const css = STYLES.map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ 狀態 MUST NOT 只靠顏色', () => {
  it('分頁與切換類元件帶得出 aria 狀態', () => {
    // 抽驗有選取狀態的幾個元件。全站掃描做不到——「這顆按鈕有沒有選取態」
    // 不是靜態看得出來的事，因此這裡只釘住已知會用到的那幾個
    const orders = readFileSync(resolve(SRC, 'pages/Orders.tsx'), 'utf8')
    expect(orders).toMatch(/aria-pressed/)
  })
})
