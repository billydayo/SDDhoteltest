/**
 * 響應式稽核：20 頁 × 6 個寬度 = 120 次量測，量兩件事——
 *   1. 有沒有內容超出視窗**而且拿不回來**（SC-012、T172）
 *   2. 每一次載入的 console 是否零錯誤零警告（SC-014、T181）
 *
 * 對應 `browser-acceptance.md` 的 B1 與 C1。這支只走「載入」；
 * **互動**期間的 console 由 `t181-walkthrough.mjs` 負責，兩支不重疊。
 *
 * ## 用法
 *
 * ```bash
 * # 前後端都要先起來（見 quickstart.md）
 * node specs/001-booking-site/checklists/responsive-audit.mjs
 *
 * SUNNY_BASE=http://localhost:5173 \
 * SUNNY_ADMIN=admin@sunny.com SUNNY_ADMIN_PW=admin123 \
 * SUNNY_HEADFUL=1 node specs/001-booking-site/checklists/responsive-audit.mjs
 * ```
 *
 * 零 npm 相依（見 `lib/cdp.mjs`）。全部通過時結束碼 0，否則 1。
 * 完整結果寫到同目錄的 `responsive-audit.json`。
 *
 * ## 為什麼不量 scrollWidth（這是本檔的重點）
 *
 * 兩種直覺的量法都會說謊，而且方向相反：
 *
 * - `scrollWidth > clientWidth` → **假陽性**。表格待在自己的 `overflow-x-auto`
 *   裡橫捲是設計如此，`documentElement.scrollWidth` 照樣算進去。實測後台
 *   十二個模組全被誤報。
 * - `window.scrollX > 0` → **假陰性**。`body` 的 `overflow-x: clip` 會傳播到
 *   視窗層，頁面根本捲不動，於是「內容被裁掉且拿不回來」看起來跟沒事一樣。
 *
 * 正確的問法是**「有沒有內容拿不到」**：某個元素超出視窗了嗎？若是，往上找
 * 有沒有一個**本身在視窗內**的可橫向捲動祖先。有 → 使用者捲得到，不算問題；
 * 沒有 → 那段內容就是不見了。
 *
 * 這個差別不是理論。後台導覽列在 `AdminLayout` 補上 `min-w-0` 之前，320px 下
 * 超出的七個模組既沒有捲軸也捲不到——使用者點不到它們，而 `window.scrollX`
 * 從頭到尾都是 0。
 *
 * ## 每一頁都先確認渲染成功才計數
 *
 * T172 栽過一次：頁面其實被導去登入頁，而「0 筆問題」是假的——空白頁當然
 * 不會超出視窗。所以每一次載入都先斷言網址沒被改寫、頁面不是 404／403、
 * 且真的有標題文字。斷言失敗記成 `render` 類的問題，不是靜靜跳過。
 */
import fs from 'node:fs'

import { launch } from './lib/cdp.mjs'

const BASE = (process.env.SUNNY_BASE ?? 'http://localhost:5173').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.SUNNY_ADMIN ?? 'admin@sunny.com'
const ADMIN_PW = process.env.SUNNY_ADMIN_PW ?? 'admin123'

const WIDTHS = [320, 375, 768, 1024, 1440, 1920]

/**
 * 20 頁。
 *
 * 帶動態 id 的頁面（`/rooms/:id`、`/booking/:id`、`/orders/:id`…）不在這裡：
 * 它們要有資料才進得去，而「有沒有那筆資料」會讓次數浮動、讓 120 這個數字
 * 不再可重現。那些頁面由 `t181-walkthrough.mjs` 走。
 */
const PAGES = [
  { path: '/', title: '房源列表' },
  // `anonymous` 的兩頁 MUST 在登入前量。已登入時它們會正確地把人導回首頁，
  // 於是「網址被改寫」的斷言會成立——那不是缺陷，是這兩頁該有的行為。
  // 2026-08-05 第一次跑就是這樣誤報了 12 筆。
  { path: '/login', title: '登入', anonymous: true },
  { path: '/register', title: '註冊', anonymous: true },
  { path: '/terms', title: '服務條款' },
  // 無障礙檢測沒有自己的頁面：它是每一頁都在的浮球與浮窗
  // （`components/WithinReachFab.tsx`），因此由這份清單的**每一頁**順帶量到。
  { path: '/account', title: '帳戶設定' },
  { path: '/favorites', title: '我的收藏' },
  { path: '/messages', title: '客服訊息' },
  { path: '/orders', title: '我的訂單' },
  // 後台十二個模組，與 `frontend/src/pages/admin/modules.tsx` 同序。
  { path: '/admin', title: '營運總覽', adminLabel: '營運總覽' },
  { path: '/admin/rooms', title: '房源管理', adminLabel: '房源管理' },
  { path: '/admin/orders', title: '訂單管理', adminLabel: '訂單管理' },
  { path: '/admin/users', title: '會員管理', adminLabel: '會員管理' },
  { path: '/admin/reviews', title: '評論審核', adminLabel: '評論審核' },
  { path: '/admin/refunds', title: '退款審核', adminLabel: '退款審核' },
  { path: '/admin/content', title: '內容編輯', adminLabel: '內容編輯' },
  { path: '/admin/room-risk', title: '房源品質檢測', adminLabel: '房源品質檢測' },
  { path: '/admin/channel-prices', title: '渠道比價', adminLabel: '渠道比價' },
  { path: '/admin/logs', title: '操作日誌', adminLabel: '操作日誌' },
  { path: '/admin/settings', title: '系統參數', adminLabel: '系統參數' },
  { path: '/admin/messages', title: '會員訊息', adminLabel: '會員訊息' },
]

// ---------------------------------------------------------------------------
// 在頁面裡跑的兩支函式
//
// ⚠️ 兩支都會被字串化送進瀏覽器，**取用不到這個檔案裡的任何東西**。
// ---------------------------------------------------------------------------

/** 找出「超出視窗且沒有可捲祖先」的元素。 */
function findUnreachableOverflow() {
  const vw = document.documentElement.clientWidth
  const TOLERANCE = 1 // 次像素捨入

  const scrollsHorizontally = (el) => {
    const ov = getComputedStyle(el).overflowX
    return (ov === 'auto' || ov === 'scroll') && el.scrollWidth > el.clientWidth + TOLERANCE
  }

  const offenders = []
  const flagged = new Set()

  // querySelectorAll 是文件順序，所以祖先一定先於後代被看到。
  for (const el of document.body.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const overflowBy = Math.max(rect.right - vw, -rect.left)
    if (overflowBy <= TOLERANCE) continue

    // 已經回報過的祖先會把整棵子樹一起推出去，不必逐一列出。
    let ancestor = el.parentElement
    let hasFlaggedAncestor = false
    while (ancestor) {
      if (flagged.has(ancestor)) {
        hasFlaggedAncestor = true
        break
      }
      ancestor = ancestor.parentElement
    }
    if (hasFlaggedAncestor) continue

    // 往上找一個「本身在視窗內」的可橫捲祖先。找到 → 使用者捲得到。
    let reachable = false
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ar = a.getBoundingClientRect()
      if (scrollsHorizontally(a) && ar.right <= vw + TOLERANCE && ar.left >= -TOLERANCE) {
        reachable = true
        break
      }
    }
    if (reachable) continue

    flagged.add(el)
    offenders.push({
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      overflowBy: Math.round(overflowBy),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    })
    if (offenders.length >= 8) break
  }
  return offenders
}

/** 這一頁真的渲染出來了嗎？回傳診斷用的事實，判斷留給呼叫端。 */
function collectRenderFacts() {
  const heading = document.querySelector('main h1, main h2, h1, h2')
  return {
    pathname: location.pathname,
    title: document.title,
    heading: (heading?.textContent ?? '').trim().slice(0, 80),
    bodyLength: (document.body.textContent ?? '').trim().length,
    isNotFound: document.body.textContent.includes('找不到這個頁面'),
    isForbidden: document.body.textContent.includes('沒有存取權限'),
  }
}

// ---------------------------------------------------------------------------
// console 噪音的分類
// ---------------------------------------------------------------------------
/**
 * 只有一種噪音是良性的：`useAsync` 與 `AuthContext` 在元件卸載時
 * `controller.abort()` 掉還在飛的請求，Chrome 會記一筆 `ERR_ABORTED`。
 * 那是正常行為，不是缺陷。（這個專案沒有用 React Query。）
 *
 * 其餘一律算問題。這支只走「載入」，沒有任何刻意觸發的錯誤路徑——
 * 因此不像 `t181-walkthrough.mjs` 需要「預期中的 4xx」這一類。
 */
const classify = (n) => {
  if (n.type === 'requestfailed' && n.text.includes('ERR_ABORTED')) return null
  if (/status of 5\d\d/.test(n.text)) return '伺服器 5xx'
  if (/status of 4\d\d/.test(n.text)) return '4xx'
  if (n.type === 'requestfailed') return '請求失敗'
  if (n.type === 'pageerror') return '未捕捉例外'
  return n.type === 'warning' ? '黃字' : '紅字'
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const browser = await launch({ headless: !process.env.SUNNY_HEADFUL })
const findings = []
const measurements = []
let bucket = [] // 當下這一次載入收到的噪音

/** 掃一批頁面。結果累積到 `findings` 與 `measurements`。 */
async function sweep(page, specs) {
  for (const spec of specs) {
    const marks = []
    for (const width of WIDTHS) {
      const where = `${spec.path} @ ${width}px`
      bucket = []
      await page.setViewport(width)

      let facts
      try {
        await page.goto(`${BASE}${spec.path}`)
        // 資料取回來之後才是最終版面；沒有這段會量到骨架屏。
        await new Promise((r) => setTimeout(r, 600))
        facts = await page.evaluate(collectRenderFacts)
      } catch (err) {
        findings.push({ kind: 'render', where, detail: String(err).slice(0, 200) })
        marks.push('✗')
        continue
      }

      // --- 渲染斷言。不通過就不量，也不算通過。
      const why = (() => {
        if (facts.isNotFound) return '掉到 404 頁'
        if (facts.isForbidden) return '掉到 403 頁'
        if (facts.pathname !== spec.path) return `網址被改寫成 ${facts.pathname}（多半是被導去登入）`
        if (spec.adminLabel && !facts.title.includes(spec.adminLabel)) {
          return `分頁標題是「${facts.title}」，不含「${spec.adminLabel}」`
        }
        if (facts.bodyLength < 40) return `頁面幾乎沒有內容（${facts.bodyLength} 字）`
        if (!facts.heading) return '找不到任何 h1／h2'
        return null
      })()
      if (why) {
        findings.push({ kind: 'render', where, detail: why, facts })
        marks.push('✗')
        continue
      }

      // --- 超出視窗且拿不回來
      const overflow = await page.evaluate(findUnreachableOverflow)
      for (const o of overflow) {
        findings.push({
          kind: 'overflow',
          where,
          detail: `<${o.tag} class="${o.className}"> 向右超出約 ${o.overflowBy}px，且沒有可捲的祖先｜「${o.text}」`,
        })
      }

      // --- console
      const noise = bucket
        .map((n) => ({ ...n, category: classify(n) }))
        .filter((n) => n.category !== null)
      for (const n of noise) {
        findings.push({ kind: 'console', where, detail: `[${n.category}] ${n.text}` })
      }

      measurements.push({ where, overflow: overflow.length, noise: noise.length })
      marks.push(overflow.length === 0 && noise.length === 0 ? '·' : '!')
    }
    process.stdout.write(`  ${marks.join(' ')}  ${spec.path}  ${spec.title}\n`)
  }
}

try {
  const page = await browser.newPage()
  page.onNoise((n) => bucket.push(n))
  await page.setViewport(1280, 900)

  // ---- 先掃「必須未登入」的那幾頁 -----------------------------------------
  await sweep(
    page,
    PAGES.filter((p) => p.anonymous),
  )

  // ---- 登入 -------------------------------------------------------------
  //
  // 管理員一個帳號就涵蓋全部 20 頁：`RequireAuth` 只問有沒有登入，
  // `RequireAdmin` 另外問角色。用會員帳號的話後台十二頁會全部變成 403，
  // 而 403 頁當然不會超出視窗——那就是 T172 踩過的假陰性。
  await page.goto(`${BASE}/login`)
  const auth = await page.evaluate(
    async (email, password) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!res.ok) return { ok: false, why: `HTTP ${res.status}：${(await res.text()).slice(0, 160)}` }
        const data = await res.json()
        const token = data.accessToken ?? data.access_token
        if (!token) return { ok: false, why: '登入回應裡沒有 accessToken' }
        localStorage.setItem('sunny.accessToken', token)
        return { ok: true, role: data.profile?.role ?? null }
      } catch (err) {
        return { ok: false, why: `連不上後端：${String(err).slice(0, 160)}` }
      }
    },
    ADMIN_EMAIL,
    ADMIN_PW,
  )
  if (!auth.ok) throw new Error(`以 ${ADMIN_EMAIL} 登入失敗：${auth.why}`)
  if (auth.role !== 'admin') {
    throw new Error(`${ADMIN_EMAIL} 的角色是 ${auth.role}，不是 admin——後台十二頁量不到`)
  }
  process.stdout.write(`已以 ${ADMIN_EMAIL}（${auth.role}）登入\n`)

  // ---- 其餘 19 頁 --------------------------------------------------------
  await sweep(
    page,
    PAGES.filter((p) => !p.anonymous),
  )
} finally {
  await browser.close()
}

// ---------------------------------------------------------------------------
// 報告
// ---------------------------------------------------------------------------
const byKind = new Map()
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, [])
  byKind.get(f.kind).push(f)
}

const LABEL = { render: '渲染失敗', overflow: '內容超出視窗且拿不回來', console: 'console 噪音' }
console.log(`\n===== ${measurements.length}／${PAGES.length * WIDTHS.length} 次量測完成 =====`)
for (const [kind, list] of byKind) {
  console.log(`\n${LABEL[kind] ?? kind}：${list.length}`)
  for (const f of list.slice(0, 12)) console.log(`  ${f.where}\n      ${f.detail}`)
  if (list.length > 12) console.log(`  …另外 ${list.length - 12} 筆`)
}

fs.writeFileSync(
  new URL('./responsive-audit.json', import.meta.url),
  JSON.stringify({ base: BASE, widths: WIDTHS, measurements, findings }, null, 2),
  'utf8',
)

if (findings.length === 0 && measurements.length === PAGES.length * WIDTHS.length) {
  console.log('\n全部乾淨。')
  process.exit(0)
}
console.log(`\n共 ${findings.length} 筆問題，詳見 responsive-audit.json`)
process.exit(1)
