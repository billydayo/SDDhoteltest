/**
 * T144：`pages/RiskCheck.tsx` 的**靜態相依圖**裡不存在任何上傳模組或圖片端點
 * 呼叫（SC-030、research R8、plan.md）。
 *
 * ## 這支測試失敗代表什麼
 *
 * 使用者在安全檢測頁上傳的是自己的私人照片。SC-030 要求那些照片不出現在任何
 * 儲存或資料表中。**本測試失敗即代表這條保證已經失守**，而失守的方式通常是
 * 一次無害的重構：有人把 `ErrorState` 拿來用，而它經 `lib/errors.ts` 連到
 * `api/client.ts`——從此那個頁面的相依圖裡就有了一個出口。
 *
 * 出口存在不等於照片會被送出去，但「不會被送出去」從此只剩下人的自律在守，
 * 而那不是一條可以被驗證的保證。
 *
 * ## 為什麼是逐檔讀原始碼而不是跑起來看
 *
 * 執行期只看得到「這一次沒有送出去」。相依圖看得到「送不出去」。
 * 兩者是不同的問題，因此有兩支測試——T144a 從執行期流量那一面驗
 * （`pages/__tests__/riskCheckNetwork.test.tsx`）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRY = resolve(SRC, 'pages/RiskCheck.tsx')

/**
 * 相對匯入。第三方套件（react 等）不在相依圖的追蹤範圍內。
 *
 * ⚠️ 只比對 `from '...'` 而不去解析整段 import 敘述：具名匯入常常跨好幾行，
 * 而一個「`import` 到 `from` 之間不能有換行」的樣式會在那種寫法上默默漏掉
 * 整個模組——漏掉的相依看起來就跟不存在一樣。
 */
const IMPORT_PATTERN = /\bfrom\s*['"](\.[^'"]+)['"]/g
/** `await import('...')` 也算——動態載入同樣是一條相依。 */
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/**
 * 去掉註解再掃。
 *
 * 不去掉的話，一句「這裡沒有 `fetch`、沒有 `XMLHttpRequest`」的說明會讓
 * 這支測試失敗——而那句話正是本測試想要保護的事。一支會因為「有人寫下正確
 * 的註解」而失敗的測試，最後會被改成不檢查。
 *
 * `[^:]` 是為了不把 `https://…` 的後半段當成行註解吃掉。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)
  for (const suffix of ['', ...EXTENSIONS]) {
    const candidate = `${base}${suffix}`
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      // 換下一個副檔名。TypeScript 的匯入不帶副檔名，因此一定要試。
      continue
    }
  }
  return null
}

/** 從進入點展開整個相依圖，回傳「檔案路徑 → 原始碼」。 */
function dependencyGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue

    const source = readFileSync(file, 'utf8')
    seen.set(file, source)

    for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1]
        if (specifier === undefined) continue
        const resolved = resolveModule(file, specifier)
        // 解不到的相對匯入是一個真的錯誤（打錯路徑），但那會由 `tsc` 抓到；
        // 這裡略過即可，不必為此再失敗一次。
        if (resolved !== null) queue.push(resolved)
      }
    }
  }

  return seen
}

const GRAPH = dependencyGraph(ENTRY)
const FILES = [...GRAPH.keys()].map((path) => path.replaceAll('\\', '/'))

describe('安全檢測頁的相依圖', () => {
  it('進入點確實被讀到了（防止整支測試因為路徑錯誤而空轉通過）', () => {
    // ⚠️ 沒有這一條的話，`SRC` 一旦算錯，下面每一項都會在空集合上通過。
    expect(FILES.some((path) => path.endsWith('/pages/RiskCheck.tsx'))).toBe(true)
    expect(FILES.some((path) => path.endsWith('/lib/riskScore.ts'))).toBe(true)
  })

  it('⚠️ 不含 api/client.ts——那是整個前端唯一的網路出口', () => {
    expect(FILES.filter((path) => path.endsWith('/api/client.ts'))).toEqual([])
  })

  it('⚠️ 不含任何上傳相關模組', () => {
    const uploadish = FILES.filter((path) => /image\.ts$|upload/i.test(path))
    expect(uploadish).toEqual([])
  })

  it('⚠️ 圖裡沒有任何一行發出網路請求', () => {
    const offenders: string[] = []
    for (const [file, source] of GRAPH) {
      // 逐檔掃原始碼而不只看模組名稱：直接寫 `fetch(...)` 的頁面不會出現在
      // 任何一條 import 上，而那正是最該被擋下的情況。
      if (
        /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket/.test(stripComments(source))
      ) {
        offenders.push(file.replaceAll('\\', '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('相依圖小到可以一眼看完', () => {
    // 這不是效能測試。相依圖只要開始長大，上面那幾條就會變成「目前剛好還
    // 沒踩到」而不是「結構上不可能」。四個檔案以內是一個可以人工複核的規模。
    expect(FILES.length).toBeLessThanOrEqual(4)
  })
})
