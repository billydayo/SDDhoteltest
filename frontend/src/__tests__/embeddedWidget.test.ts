// @vitest-environment node
//
// 讀檔案，不碰 DOM。
/**
 * T184／T185：嵌入式第三方元件的邊界查核（FR-129 ~ FR-131、SC-035）。
 *
 * ## 這支測試守的東西在 2026-08-05 換了
 *
 * 舊版守的是「自行 host 的 bundle 裡沒有 `fetch`／`localStorage`」——因為那段
 * 程式跑在**我們的 document** 裡，跟 JWT 同一個 `localStorage`，唯一的保護就是
 * 我們讀完它的相依圖。
 *
 * 現在改嵌對方的線上部署（憲章 v4.1.0 原則 VI 形式 B），程式跑在對方的 origin
 * 上，同源政策接手了那道邊界。相依圖查核因此**失去意義而不是被放寬**：那份
 * bundle 已經不在我們的版控裡，掃它掃不到對方今天部署了什麼。
 *
 * 換來的邊界只剩三件事，而這三件事全都寫在同一個 JSX 屬性裡、沒有任何執行期
 * 錯誤會提醒你寫錯：
 *
 * 1. **來源是不是那一個**。`src` 改成別的網域，畫面看起來一樣正常
 * 2. **`sandbox` 有沒有破**。少一個 `sandbox` 屬性，或多一個
 *    `allow-top-navigation`，畫面也看起來一樣正常——直到對方（或對方被入侵後
 *    的某人）把我們的整頁導走，而使用者網址列上顯示的是我們的網域
 * 3. **外部程式有沒有偷偷跑回我們的 document 裡**。舊的 `<script>` 注入路徑
 *    要是被留下來或加回來，前面兩件事就都白做了
 *
 * ## 這支測試證明不了什麼
 *
 * 它證明不了對方站台上跑的是什麼——那正是本次變更放棄的東西（檔頭有記）。
 * 它只證明**瀏覽器被要求把那段內容關在哪裡**。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const FRONTEND = resolve(dirname(SELF), '../..')

const HOST_PATH = resolve(FRONTEND, 'src/components/WithinReachFab.tsx')
const LEGACY_BUNDLE_PATH = resolve(FRONTEND, 'public/wr-widget.js')
const CADDYFILE_PATH = resolve(FRONTEND, '../deploy/Caddyfile')

const host = readFileSync(HOST_PATH, 'utf8')
const caddyfile = readFileSync(CADDYFILE_PATH, 'utf8')

/** 唯一允許的嵌入來源（憲章原則 VI 形式 B 的具名白名單）。 */
const ALLOWED_ORIGIN = 'https://within-reach-phi.vercel.app'

/**
 * 去掉註解，只留程式碼本體。
 *
 * ⚠️ 必要，因為本檔與受測檔的註解裡就有 `https://github.com/...` 與
 * `https://images.unsplash.com`——那是**紀錄**，不是這段程式會連去的地方。
 * 不先剝掉的話，「程式碼只能出現白名單那一個來源」會被自己的說明文字擋下來，
 * 而修法多半會是把註解刪掉，剛好刪掉最該留的東西。
 */
function codeOf(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // JSX 註解
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // 區塊註解
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // 行註解，`[^:]` 避開 https://
}

const code = codeOf(host)

describe('掃描範圍', () => {
  it('真的讀到了受測檔（防止路徑算錯而空轉通過）', () => {
    // 少了這一條，把檔案改名會讓下面每一項都變綠——空字串裡當然找不到
    // allow-top-navigation
    expect(host).toContain('WithinReachFab')
    expect(code).toContain('<iframe')
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-129：嵌入來源限於具名白名單', () => {
  it('iframe 指向白名單上的那一個 origin', () => {
    expect(code).toContain(`'${ALLOWED_ORIGIN}'`)
    expect(code).toMatch(/src=\{WIDGET_ORIGIN\}/)
  })

  it('程式碼本體沒有出現白名單以外的來源', () => {
    /**
     * 逐一比對 `src=` 抓不到這件事：一個 `<img src="https://收集站/?u=" + …>`
     * 或一行 `new Image().src=…` 同樣會讓瀏覽器連出去。盯住「這段程式會讓
     * 瀏覽器連到哪裡」比列舉屬性名更貼近我們在意的事。
     */
    const origins = new Set(
      [...code.matchAll(/https?:\/\/[a-zA-Z0-9._-]+/g)].map((m) => m[0]),
    )
    expect([...origins]).toEqual([ALLOWED_ORIGIN])
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-130：外部程式 MUST NOT 在我們的 document 裡執行', () => {
  /**
   * **這一組是整支測試最要緊的部分。**
   *
   * 跨來源 iframe 之所以能取代逐檔查核相依圖，靠的是「那段程式拿不到我們的
   * `window`」。只要有任何一條路徑把外部程式載回本頁——舊的 `<script>` 注入被
   * 留著、或哪天為了「這樣比較快」加回來——這個前提就消失了，而上面那些
   * `sandbox` 屬性一項都幫不上忙。
   */
  it('沒有殘留動態插入 script 的路徑', () => {
    expect(code).not.toMatch(/createElement\(\s*['"`]script['"`]\s*\)/)
    expect(code).not.toMatch(/<script/i)
  })

  it('沒有殘留對舊 bundle 的引用', () => {
    expect(code).not.toContain('wr-widget')
  })

  it('舊的自行 host bundle 已從版控移除', () => {
    // 留著會變成第二個事實來源：一份沒有人在載、也沒有人在更新的 224KB 檔案，
    // 而下一個讀到它的人會以為那才是正在跑的東西
    expect(existsSync(LEGACY_BUNDLE_PATH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('⚠️ FR-129a：sandbox 是這個安排唯一的隔離手段', () => {
  const sandbox = /sandbox="([^"]*)"/.exec(code)?.[1] ?? ''

  it('iframe 有 sandbox 屬性', () => {
    // 沒有 sandbox 的 iframe 不是「限制比較少」，是完全沒有限制
    expect(sandbox).not.toBe('')
  })

  it.each(['allow-scripts', 'allow-same-origin'])('保留 %s（少了畫面是空的）', (flag) => {
    expect(sandbox).toContain(flag)
  })

  /**
   * `allow-top-navigation` 是這裡唯一會傷到**我們的使用者**的旗標：有了它，
   * frame 內的程式可以把我們的整頁導去任何地方，而網址列在導走之前顯示的
   * 一直是我們的網域。三個變體（含 `-by-user-activation`、
   * `-to-custom-protocols`）都被下面的子字串比對涵蓋。
   *
   * 其餘三項不是同一個等級的風險，列在這裡是因為它們都屬於「加上去很方便、
   * 加上去之後沒有人會發現」——`allow-downloads` 尤其：一個第三方 frame
   * 能讓檔案自己下載下來，使用者只會以為是我們的站給的。
   */
  it.each(['allow-top-navigation', 'allow-modals', 'allow-downloads', 'allow-pointer-lock'])(
    'MUST NOT 含 %s',
    (flag) => {
      expect(sandbox).not.toContain(flag)
    },
  )
})

// ---------------------------------------------------------------------------
describe('⚠️ 正式站的 CSP 允許這個來源被嵌入', () => {
  /**
   * **這一組抓的是本次變更裡唯一「本機完全正常、正式站壞掉」的失敗模式。**
   *
   * `deploy/Caddyfile` 的 CSP 是 `default-src 'self'`。CSP 的 `frame-src` 在
   * 未指定時會回退到 `child-src`、再回退到 `default-src`——也就是 `'self'`，
   * 於是這個 iframe 在正式站上直接被擋成空白。而 `vite dev` 不送 CSP，本機
   * 怎麼看都是好的。
   *
   * 兩個檔案各寫一份同樣的網域，是本專案裡最典型的「只改了一邊」——所以這裡
   * 不比對「有沒有 frame-src」，而是比對**兩邊是不是同一個 origin**。
   */
  /**
   * ⚠️ 先取出**帶引號的 CSP 字串**再從裡面找 `frame-src`，不要直接對整個檔案
   * 掃。Caddyfile 的註解裡就寫著 `frame-src`（說明為什麼需要它），直接掃會抓到
   * 那一段註解——測試於是在驗「註解寫對了嗎」，而 header 被刪掉照樣通過。
   */
  const csp = /Content-Security-Policy "([^"]*)"/.exec(caddyfile)?.[1] ?? ''
  const frameSrc = /frame-src ([^;]+)/.exec(csp)?.[1].trim() ?? ''

  it('Caddyfile 的 CSP 有 frame-src，且與元件的來源常數一致', () => {
    expect(csp).not.toBe('')
    expect(frameSrc).toBe(ALLOWED_ORIGIN)
  })

  it('frame-src MUST NOT 放寬成通配', () => {
    // `frame-src https:` 會通過上一條以外的任何寬鬆寫法檢查，卻等於把這條刪掉
    expect(frameSrc).not.toMatch(/^https?:$/)
    expect(frameSrc).not.toContain('*')
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
    expect(code).toMatch(/外部|Within Reach/)
  })

  it('iframe 有 title（讀屏使用者要知道跳進去的是什麼）', () => {
    // 沒有 title 的 frame，讀屏唸出來的是網址或「框架」
    expect(code).toMatch(/<iframe[\s\S]{0,400}?title="[^"]+"/)
  })
})
