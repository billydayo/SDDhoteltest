// @vitest-environment node
//
// 讀原始碼，不碰 DOM。
/**
 * T186：版面寬度隨視窗調整（FR-132、SC-036、憲章原則 V）。
 *
 * ## 這條規範補的是「上界」
 *
 * 原憲章只規定了下界——320px 不得產生橫向捲動——於是「內容欄最寬 1280px」
 * 從來沒有被任何人決定過，它只是四個檔案裡各自寫下的一行 `max-w-7xl`。
 * 結果是 1920px 螢幕上兩側各留 320px 空白，而使用者要看的房源被擠在中間。
 *
 * ## 為什麼靜態掃描就夠
 *
 * 這件事的失敗模式不是「算出來的寬度不對」，而是**有人在外殼上多寫了一個
 * `max-w-`**。那是原始碼裡看得見的字，不需要渲染。真正需要人眼的是
 * 「這個寬度好不好看」，那留在 T172 的響應式稽核與 T181 的走訪裡。
 *
 * ## 外殼與區塊的差別是本檔的全部重點
 *
 * - **外殼**（頁首、`<main>`、頁尾、主視覺內層）＝「這個網站有多寬」→ 不封頂
 * - **區塊**（長文、單欄表單、標題行長）＝「這段內容適合多寬」→ 應該封頂
 *
 * 所以本檔**不禁止** `max-w-*`：全站現有 26 處都是區塊級的正確用法。
 * 它只禁止外殼被封頂，以及外殼的量測線被抄成第二份。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function rel(path: string): string {
  return path.replaceAll('\\', '/').split('/src/')[1] ?? path
}

const SOURCES = walk(SRC, /\.(tsx|ts)$/).filter((p) => !/\.(test|spec)\.tsx?$/.test(p))
const SURFACES = resolve(SRC, 'lib/surfaces.ts')

/** 頁首、頁尾、主視覺內層、`<main>`——外殼的四個承載點。 */
const SHELL_SITES = [
  'components/Header.tsx',
  'components/Footer.tsx',
  'components/HomeHero.tsx',
  'router.tsx',
]

describe('掃描範圍', () => {
  it('掃到了真的檔案（防止路徑算錯而空轉通過）', () => {
    expect(SOURCES.length).toBeGreaterThan(30)
    expect(readFileSync(SURFACES, 'utf8')).toContain('shellClass')
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-132：外殼的量測線只有一份定義', () => {
  it('`shellClass` 本身不含任何 max-w', () => {
    // 這是唯一的定義點。它一旦被封頂，全站四處同時失守而沒有人會發現，
    // 因為每一處看起來都還「有引用共用常數」
    const def = /export const shellClass\s*=\s*([^\n]+)/.exec(readFileSync(SURFACES, 'utf8'))
    expect(def).not.toBeNull()
    expect(def?.[1]).not.toMatch(/max-w/)
  })

  it.each(SHELL_SITES)('%s 引用 shellClass 而非自己抄一份', (site) => {
    const source = stripComments(readFileSync(resolve(SRC, site), 'utf8'))
    expect(source).toContain('shellClass')
  })

  it('沒有任何檔案抄了舊的外殼字串', () => {
    /**
     * 舊寫法是 `mx-auto max-w-7xl px-gap-5`，四個檔案各一份。
     * 抄一份的成本是零，維護的成本是下一次只有三處被改到——
     * 而症狀是主視覺標題比下方內容偏一兩公分，那種錯位不會有測試發現。
     */
    const offenders = SOURCES.filter((p) => stripComments(readFileSync(p, 'utf8')).includes('max-w-7xl'))
    expect(offenders.map(rel)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-132：外殼 MUST NOT 被就地封頂', () => {
  /**
   * 上一組確保 `shellClass` 自己乾淨。這一組確保它**沒有在使用端被抵銷**——
   * `` className={`max-w-6xl ${shellClass}`} `` 是最容易通過 review 的破壞方式：
   * 共用常數還在，看起來完全合規，實際上外殼又被封頂了。
   */
  it.each(SOURCES.map((p) => [rel(p), p] as const))('%s', (_name, path) => {
    const offenders = stripComments(readFileSync(path, 'utf8'))
      .split('\n')
      .filter((line) => line.includes('shellClass') && line.includes('max-w'))

    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('區塊級的行長上限是正確用法，MUST NOT 被一併移除', () => {
  it('長文與單欄表單仍然有收窄', () => {
    /**
     * ⚠️ 這一條是**反向**的護欄，方向與上面全部相反。
     *
     * 讀到「外殼不得封頂」之後，最自然的過度反應是把全站的 `max-w-*` 一起
     * 刪掉——然後服務條款會變成 1920px 寬的一行文字，每行一百多個字，
     * 眼睛跳回行首時會找不到位置。憲章把這兩件事分開寫，就是為了防這個。
     */
    const measured = SOURCES.filter((p) => stripComments(readFileSync(p, 'utf8')).includes('max-w-'))
    expect(measured.length).toBeGreaterThan(10)

    // 服務條款是最長的一頁純文字，它一定要有
    const terms = stripComments(readFileSync(resolve(SRC, 'pages/Terms.tsx'), 'utf8'))
    expect(terms).toMatch(/max-w-/)
  })

  it('可讀行長的 token 仍然存在', () => {
    const css = readFileSync(resolve(SRC, 'styles/index.css'), 'utf8')
    expect(css).toMatch(/--container-measure:\s*\d+ch/)
  })
})
