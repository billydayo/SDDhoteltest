// @vitest-environment node
//
// 讀原始碼，不碰 DOM。
/**
 * T187：前台 MUST NOT 向使用者索取任何私人照片（FR-086、SC-034）。
 *
 * ## 這支測試取代了什麼
 *
 * 憲章 v4.0.0 之前，這條保證是由兩支測試守的：`riskCheckIsolation.test.ts`
 * 驗「前台的相依圖裡沒有上傳模組」，`riskCheckNetwork.test.tsx` 驗「執行期
 * 沒有夾帶照片的請求」。兩者都已隨 `pages/RiskCheck.tsx` 一併刪除。
 *
 * **保證的形式變了，不是放寬了。** 舊條文守住一條路徑上的每個出口；新條文
 * （FR-086）讓那條路徑不存在。所以要驗的東西也跟著換：
 *
 * | | 舊 | 新 |
 * |---|---|---|
 * | 要證明的事 | 送出去的東西裡沒有照片 | 沒有地方可以放照片進來 |
 * | 失敗的樣子 | 有請求夾帶了圖片資料 | 前台出現了檔案輸入 |
 *
 * 新的那句好驗得多，而且**更難繞過**：一個 `<input type="file">` 沒辦法只在
 * 執行期才長出來，但一個網路請求可以在很多地方被繞開。
 *
 * ## 為什麼要走相依圖，而不只是掃 pages/
 *
 * 只掃 `pages/` 的話，把上傳表單搬進 `components/PhotoPicker.tsx` 再 import
 * 進來就能通過——而那正是這種功能被加回來時最自然的寫法：沒有人會把
 * `<input type="file">` 直接寫在頁面檔裡。
 *
 * 後台不在檢查範圍內：管理員上傳自家房源照片是**明文允許**的
 * （FR-050b、FR-104），那是這條規定唯一的例外。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const SRC = resolve(dirname(SELF), '..')
const PAGES = resolve(SRC, 'pages')

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function rel(path: string): string {
  return path.replaceAll('\\', '/').split('/src/')[1] ?? path
}

/** 把 `'./Foo'` 這種相對指定解析成真實檔案。找不到就回 null（第三方套件）。 */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    resolve(base, 'index.tsx'),
    resolve(base, 'index.ts'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      // 目錄本身會通過 existsSync，要排除
      try {
        readFileSync(candidate, 'utf8')
        return candidate
      } catch {
        continue
      }
    }
  }
  return null
}

/**
 * 拿掉純型別匯入。
 *
 * ⚠️ **這一步不是最佳化，少了它整支測試就是錯的。**
 *
 * `import type { LoginRedirectState } from '../router'` 在編譯後**完全消失**，
 * 執行期沒有這條邊。但 `router.tsx` 是路由表，它 import 了每一個頁面——
 * 把型別匯入算成相依，等於任何一頁只要借用一個型別，它的「相依圖」就變成
 * 整個應用程式，包含全部後台模組。
 *
 * 初版就是這樣寫的，於是 Login、Register、RoomDetail 三頁被判定為「相依於
 * 後台」。那不是程式碼的問題，是走訪的問題——而這種錯誤特別危險：它會讓人
 * 相信測試抓到了東西，然後去「修好」一段本來就正確的程式碼。
 */
function stripTypeImports(source: string): string {
  return source.replace(/import\s+type\s+[\s\S]*?from\s*['"][^'"]+['"]/g, ' ')
}

/** 自某個進入點出發，收集其相依圖中的全部本專案檔案（含自己）。 */
function dependencyGraph(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = stripTypeImports(stripComments(readFileSync(file, 'utf8')))
    for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec === undefined) continue
      const next = resolveImport(file, spec)
      if (next !== null && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

/** 前台頁面 = `pages/` 底下、不含 `admin/`、不含測試檔。 */
const FRONT_PAGES = readdirSync(PAGES, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(e.name))
  .map((e) => resolve(PAGES, e.name))

describe('掃描範圍', () => {
  it('抓到了前台頁面（防止路徑算錯而空轉通過）', () => {
    expect(FRONT_PAGES.length).toBeGreaterThan(10)
    expect(FRONT_PAGES.map((p) => basename(p))).toContain('Home.tsx')
  })

  it('相依圖真的有走出頁面本身', () => {
    // 少了這一條，`resolveImport` 全部回 null 也會讓下面每一項變綠——
    // 而那正是這支測試最可能壞掉卻沒人發現的方式
    const graph = dependencyGraph(resolve(PAGES, 'Home.tsx'))
    expect(graph.size).toBeGreaterThan(5)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-086：前台的相依圖中不存在任何檔案輸入', () => {
  /**
   * 三種讓使用者交出檔案的方式。第三種（拖放）最容易被漏掉——它不需要
   * `<input>`，只要在任何元素上接 `onDrop` 就成立。
   */
  const PATTERNS: readonly (readonly [string, RegExp])[] = [
    // ⚠️ 結尾的引號**不可省**。寫成 `file['"]?` 的話 `type="filter"`
    // 會一起被抓走——一個永遠說不清楚為什麼會紅的測試，比沒有測試更糟
    ['<input type="file">', /type\s*=\s*(?:"file"|'file'|\{\s*['"]file['"]\s*\})/],
    ['capture（直接開相機）', /\bcapture\s*=/],
    ['拖放接收（onDrop）', /\bonDrop\b/],
  ]

  it.each(FRONT_PAGES.map((p) => [rel(p), p] as const))('%s 的相依圖', (_name, entry) => {
    const offenders: string[] = []

    for (const file of dependencyGraph(entry)) {
      // 後台模組被前台頁面 import 是不預期的，但真的發生時應該由下一個
      // describe 報出來，而不是在這裡被當成「合法的上傳」放過
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const [label, pattern] of PATTERNS) {
        if (pattern.test(source)) offenders.push(`${rel(file)}：${label}`)
      }
    }

    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ 前台頁面 MUST NOT 相依於後台模組', () => {
  /**
   * 這一條是上一條的護欄。管理端的上傳是**明文允許**的，所以
   * `pages/admin/` 底下本來就有檔案輸入；一旦前台頁面（哪怕只是為了共用一個
   * 小元件）把後台模組拉進相依圖，上一條就會突然開始報錯，而人們最可能的
   * 反應是「把 admin 排除掉」——排除之後，前台就真的可以間接取得上傳能力了。
   *
   * 先在這裡擋住，讓那個誘因不會出現。
   */
  it.each(FRONT_PAGES.map((p) => [rel(p), p] as const))('%s', (_name, entry) => {
    const admin = [...dependencyGraph(entry)]
      .map(rel)
      .filter((p) => p.startsWith('pages/admin/'))

    expect(admin).toEqual([])
  })
})
