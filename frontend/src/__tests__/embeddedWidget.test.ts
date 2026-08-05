// @vitest-environment node
//
// 讀檔案，不碰 DOM。
/**
 * T184／T185：嵌入式第三方元件的相依圖查核（FR-129 ~ FR-131、SC-035）。
 *
 * ## 這支測試存在的理由，跟它檢查的內容一樣重要
 *
 * `components/WithinReachFab.tsx` 的檔頭已經寫著一份查核結果，而且是對的。
 * 問題在於**那份紀錄是靜態的**：換掉 `public/wr-widget.js` 之後，它不會自己
 * 變假。憲章原則 VI 明訂「查核 MUST NOT 因為『上一版是乾淨的』而省略」，
 * 但人工查核在第三次更新時一定會被跳過——沒有任何東西會提醒你該做。
 *
 * 所以這支測試的價值不在「現在是乾淨的」（現在確實是），而在**下一次不乾淨時
 * 會有東西變紅**。
 *
 * ## 為什麼 localStorage 是這裡最要緊的一項
 *
 * 本專案的 JWT 存在 `localStorage`（`api/client.ts`）。第三方元件跑在**同一個
 * document** 裡，讀得到那個值。它不需要「攻擊」我們——上游哪天加一行無害的
 * 偏好設定記憶，就順手取得了讀取 token 的能力，而那次改版的 release note
 * 只會寫「記住使用者的主題選擇」。
 *
 * ## 這支測試證明不了什麼
 *
 * 它掃的是打包後的字面文字。刻意規避（`window["fet"+"ch"]`、
 * `globalThis[atob("ZmV0Y2g=")]`）掃不到。**這不是防惡意的機制**——上游是已知
 * 的合作對象，威脅模型是「無意間引入」而不是「蓄意夾帶」。要防後者得換成
 * sandboxed iframe，那是憲章「升級路徑」那一條講的事。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const FRONTEND = resolve(dirname(SELF), '../..')

const WIDGET_PATH = resolve(FRONTEND, 'public/wr-widget.js')
const HOST_PATH = resolve(FRONTEND, 'src/components/WithinReachFab.tsx')

const widget = readFileSync(WIDGET_PATH, 'utf8')
const host = readFileSync(HOST_PATH, 'utf8')

/**
 * 去掉註解，只留程式碼本體。
 *
 * ⚠️ 必要，因為本檔的檔頭註解裡就有 `https://github.com/...` 與
 * `https://images.unsplash.com`——那是**紀錄**，不是這段程式會連去的地方。
 * 不先剝掉的話，「程式碼不得出現外部網址」那條會被自己的說明文字擋下來，
 * 而修法多半會是把註解刪掉，剛好刪掉最該留的東西。
 */
function codeOf(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // JSX 註解
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // 區塊註解
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // 行註解，`[^:]` 避開 https://
}

describe('掃描範圍', () => {
  it('真的讀到了打包產物（防止路徑算錯而空轉通過）', () => {
    // 少了這一條，把 wr-widget.js 刪掉會讓下面每一項都變綠——
    // 空字串裡當然找不到 fetch
    expect(widget.length).toBeGreaterThan(50_000)
    expect(host).toContain('WithinReachFab')
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-130：元件 MUST NOT 送出資料', () => {
  /**
   * 送出資料的四種方式。`sendBeacon` 特別容易漏——它是設計來在頁面卸載時
   * 偷偷送出分析資料的，不會有任何畫面回饋，也不會出現在多數人的心智模型裡。
   */
  const EXFIL = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon'] as const

  it.each(EXFIL)('打包產物不含 %s', (api) => {
    expect(widget).not.toContain(api)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-130：元件 MUST NOT 觸及瀏覽器儲存', () => {
  /**
   * 這三項不是「怕它偷 token」，是「一旦它開始用瀏覽器儲存，我們就再也無法
   * 主張 JWT 沒有被同頁的外部程式讀到」。差別在於前者需要惡意，後者只需要
   * 一次無心的改版。
   */
  const STORAGE = ['localStorage', 'sessionStorage', 'document.cookie'] as const

  it.each(STORAGE)('打包產物不含 %s', (api) => {
    expect(widget).not.toContain(api)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-130：外部主機以具名白名單管理', () => {
  /**
   * **這一條抓的是上面兩組抓不到的東西。**
   *
   * 一個 `<img src="https://收集站/?t=" + token>` 不含 `fetch`、不含
   * `localStorage`，卻已經把資料送出去了。用白名單盯住「出現過哪些網域」，
   * 比逐一列舉 API 更貼近我們真正在意的事：**這段程式會讓瀏覽器連到哪裡去**。
   */
  const ALLOWED = new Set([
    // SVG／XML 命名空間。不是網路請求，瀏覽器不會去抓它
    'http://www.w3.org',
    // ⚠️ 已知例外，憲章 v4.0.0 的 Sync Impact Report 有記：示範房源照片。
    // 它**不送出資料**，但會把訪客 IP 與 referrer 暴露給 Unsplash——
    // 兩者不一樣，MUST NOT 因為「沒有外部請求」就把它描述成不存在。
    // 上游改為打包本機資產後，這一列就該刪掉
    'https://images.unsplash.com',
    // 上游示範資料裡的假訂房連結與文件連結，不會被自動抓取
    'https://booking.example.com',
    'https://tailwindcss.com',
    'https://reactjs.org',
  ])

  it('沒有出現白名單以外的主機', () => {
    const hosts = new Set(
      [...widget.matchAll(/https?:\/\/[a-zA-Z0-9._-]+/g)].map((m) => m[0]),
    )
    expect([...hosts].filter((h) => !ALLOWED.has(h))).toEqual([])
  })

  it('白名單本身沒有失效（每一項都還真的出現在產物裡）', () => {
    // 少了這一條，白名單會隨著上游演進而變成一份無人清理的許可清單，
    // 而清單越長，下一個真正該被攔下的網域就越容易被順手加進去
    const stale = [...ALLOWED].filter((h) => !widget.includes(h))
    expect(stale).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-129：自行 host 與來源可追溯', () => {
  it('元件檔頭記錄了上游 repo、建置指令與來源 commit', () => {
    expect(host).toMatch(/github\.com\/[\w-]+\/[\w-]+/)
    expect(host).toMatch(/build:widget/)
    // 40 碼的 commit hash。寫「最新版」或「2026-08 版」都無法回退到確切的那一份
    expect(host).toMatch(/\b[0-9a-f]{40}\b/)
  })

  it('MUST NOT 以 script src 指向外部主機', () => {
    /**
     * 指向外部等於把「這頁跑什麼程式」的決定權長期讓出去：對方任何一次改版
     * 都會直接生效在正式站上，而我們無從得知。
     *
     * ⚠️ **這裡刻意檢查「整個程式碼本體有沒有外部網址」，而不是只比對
     * `.src = "http..."`。** 現行寫法是 `script.src = WIDGET_SRC`，比對字面量
     * 會因為找不到東西而通過——**通過的理由是錯的**，那種測試在 `WIDGET_SRC`
     * 哪天被改成外部網址時同樣會通過。
     */
    expect(codeOf(host)).not.toMatch(/https?:\/\//)
  })

  it('widget 由本站台同源提供', () => {
    // 對應上一條的正面說法：不只是「沒有外部網址」，而是「確實指向自己」
    expect(host).toMatch(/=\s*['"`]\/wr-widget\.js['"`]/)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-131：畫面標明由外部服務提供', () => {
  it('浮窗內有指出這是外部服務的文字', () => {
    /**
     * ⚠️ 這一條刻意寫得寬鬆（只要求出現「外部」或上游名稱），因為文案會改。
     * 它擋的不是措辭不好，是**整段標示被刪掉**——浮窗只有幾百像素高，
     * 那行字在下一次調版面時很容易被當成佔空間的雜訊拿掉，而拿掉之後
     * 使用者會以為那份無障礙評估是 Sunny 自己做的判定。
     */
    expect(codeOf(host)).toMatch(/外部|Within Reach/)
  })
})
