// @vitest-environment node
//
// 這一支不碰 DOM——它讀的是原始碼。jsdom 之下 `import.meta.url` 是 http URL，
// `fileURLToPath` 會直接拋。
/**
 * T174：整個前端只有**一個**網路出口（憲章原則 III）。
 *
 * ## 這支測試失敗代表什麼
 *
 * 有人在元件裡直接 `fetch`。那件事本身不會壞掉任何畫面，所以它不會被回報——
 * 但從此以後：
 *
 * - 401 不再觸發「憑證過期，請重新登入」的統一處理（`api/client.ts` 的
 *   `setUnauthorizedHandler`），那個呼叫只會安靜地拿到一個錯誤物件；
 * - `Authorization` 標頭要靠呼叫端自己記得附上，而忘記的那一次會表現成
 *   「這個功能對某些人沒作用」；
 * - 端點路徑散落到各元件，後端改路徑時要靠全文搜尋找齊。
 *
 * ## 為什麼 ESLint 規則不夠
 *
 * `eslint.config.js` 的 `no-restricted-globals` 擋得住裸寫的 `fetch(`，但
 * `window.fetch(...)`、`XMLHttpRequest`、`navigator.sendBeacon` 一個都擋不到——
 * 那條規則只認全域**識別字**。這裡改掃原始碼，把整族網路原語一起蓋掉。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 唯一的出口，以及測試自己。
 *
 * ⚠️ 測試檔必須排除：`src/test/mockApi.ts` 的整個作用就是攔 `fetch`，而
 * `pages/__tests__/riskCheckNetwork.test.tsx` 會刻意 stub `XMLHttpRequest`。
 * 把它們算成違規，這支測試第一天就會被關掉。
 */
function isExempt(path: string): boolean {
  const p = path.replaceAll('\\', '/')
  return (
    p.endsWith('/src/api/client.ts') ||
    /\.(test|spec)\.tsx?$/.test(p) ||
    p.includes('/src/test/') ||
    p.includes('/__tests__/')
  )
}

/**
 * 去掉註解再掃。
 *
 * 不去掉的話，`lib/riskScore.ts` 裡那句「這裡沒有 `fetch`、沒有
 * `XMLHttpRequest`」會讓本測試失敗——而那句話正是它想保護的事。
 *
 * `[^:]` 是為了不把 `https://…` 的後半段當成行註解吃掉。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const ALL = walk(SRC)
const AUDITED = ALL.filter((path) => !isExempt(path))

/**
 * 網路原語。
 *
 * ⚠️ `\bfetch\s*\(` 而不是 `fetch` ——後者會把 `fetcher(signal)` 這種變數名
 * 一起抓進來（`lib/useAsync.ts` 就有），而一支會在無辜的命名上失敗的測試
 * 最後會被放寬到什麼都抓不到。
 */
const NETWORK = [
  { name: 'fetch(', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { name: 'EventSource', pattern: /\bnew\s+EventSource\b/ },
  { name: 'navigator.sendBeacon', pattern: /\bnavigator\s*\.\s*sendBeacon\b/ },
]

describe('前端只有一個網路出口（憲章原則 III）', () => {
  it('掃到的檔案數量合理（防止路徑算錯而空轉通過）', () => {
    // ⚠️ 沒有這一條，`SRC` 一旦指錯目錄，下面每一項都會在空集合上通過
    expect(ALL.length).toBeGreaterThan(50)
    expect(AUDITED.length).toBeGreaterThan(30)
    expect(ALL.some((p) => p.replaceAll('\\', '/').endsWith('/src/api/client.ts'))).toBe(true)
  })

  it.each(NETWORK)('⚠️ 除 api/client.ts 外沒有任何 $name', ({ pattern }) => {
    const offenders = AUDITED.filter((path) =>
      pattern.test(stripComments(readFileSync(path, 'utf8'))),
    ).map((path) => path.replaceAll('\\', '/').split('/src/')[1])

    expect(offenders).toEqual([])
  })

  it('⚠️ API 根路徑 `/api` 只有 client.ts 知道', () => {
    // 端點路徑散落到各元件時，後端改路徑要靠全文搜尋找齊，而找漏的那一個
    // 會表現成「某一頁壞了」而不是編譯錯誤
    const offenders = AUDITED.filter((path) =>
      /['"`]\/api(\/|['"`])/.test(stripComments(readFileSync(path, 'utf8'))),
    ).map((path) => path.replaceAll('\\', '/').split('/src/')[1])

    expect(offenders).toEqual([])
  })

  it('client.ts 真的是那個出口（否則上面幾條只是在證明沒有人打網路）', () => {
    const client = readFileSync(resolve(SRC, 'api/client.ts'), 'utf8')
    expect(/\bfetch\s*\(/.test(stripComments(client))).toBe(true)
  })
})
