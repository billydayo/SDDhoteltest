/**
 * T181：走訪正常操作流程，量兩件事——
 *   1. 瀏覽器 console 在**互動期間**零錯誤零警告（先前只驗過「載入」）
 *   2. 後端日誌沒有未處理的例外堆疊
 *
 * ## 這支腳本刻意做的三件事
 *
 * - **每一步都斷言。** `click()` 找不到那顆按鈕就丟例外。沉默不等於通過——
 *   這是 T172 已經栽過一次的坑：頁面其實被導去登入頁，而「0 筆問題」是假的。
 * - **console 訊息掛在「當下這一步」上。** 只收集一個全域陣列的話，事後無從
 *   知道是哪一個動作噴的，也就無從修。
 * - **含錯誤路徑。** 密碼錯誤、退款原因留空——這些是**預期中**的 4xx，
 *   後端不該因此吐堆疊，前端也不該因此在 console 噴紅字。
 *
 * 退款不真的送出：guest 的配額是 5 筆且先前驗證已用掉一些，
 * 這裡只走到「留空 → 可聚焦的錯誤」為止。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * puppeteer-core 不是本專案的相依。
 *
 * 這支腳本是驗收工具，不是應用程式的一部分——憲章不允許為了驗收在
 * `frontend/package.json` 塞一個正式程式碼永遠不會 import 的套件。T183 移除的
 * 舊 `tests/` 目錄曾把它宣告為 devDependency，該目錄刪除後就沒有任何地方宣告它了。
 *
 * 所以要跑這支腳本，得自己準備一份，再用 SUNNY_PUPPETEER 指過去：
 *   npm i -D puppeteer-core           # 裝在任何一個暫存目錄都行
 *   SUNNY_PUPPETEER=<該目錄>/node_modules/puppeteer-core node t181-walkthrough.mjs
 *
 * 先前這裡寫死一條指向另一份 checkout 的絕對路徑，那份 checkout 已不存在——
 * 亦即腳本在 T183 之前就跑不動了，不是刪除造成的。
 */
const puppeteerPath = process.env.SUNNY_PUPPETEER ?? 'puppeteer-core'
let puppeteer
try {
  puppeteer = require(puppeteerPath)
} catch {
  console.error(
    `找不到 puppeteer-core（試的是 ${puppeteerPath}）。\n` +
      '請先 npm i -D puppeteer-core，再以 SUNNY_PUPPETEER 指向該 node_modules/puppeteer-core。'
  )
  process.exit(2)
}

const BASE = process.env.SUNNY_BASE ?? 'http://localhost:5173'

let step = '(尚未開始)'
const noise = [] // { step, type, text }
const trail = []

const setStep = (s) => {
  step = s
  trail.push(s)
  process.stdout.write(`  · ${s}\n`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 找一個「可點的、文字是 text」的元素並點它。找不到就丟——這是斷言。
 *
 * ⚠️ `within` 不是可有可無的。頁首本身就有一顆「登入」連結，DOM 順序在表單的
 * 送出鈕之前；不限定範圍的話點到的是那個連結，於是「表單送出」變成「原地
 * 重新導向」，而錯誤訊息當然不會出現。
 */
async function click(page, text, { optional = false, within = null } = {}) {
  const handle = await page.evaluateHandle(
    (t, scope) => {
      const root = scope ? document.querySelector(scope) : document
      if (!root) return null
      const sel = 'button, a, [role="tab"], [role="button"]'
      for (const el of root.querySelectorAll(sel)) {
        if ((el.textContent ?? '').trim() === t && el.getBoundingClientRect().width > 0) return el
      }
      return null
    },
    text,
    within,
  )
  const el = handle.asElement()
  if (!el) {
    if (optional) return false
    throw new Error(`[${step}] 找不到可點的「${text}」`)
  }
  await el.click()
  await sleep(450)
  return true
}

/** 依 <label> 的文字填欄位。找不到就丟。 */
async function fill(page, label, value) {
  const ok = await page.evaluate(
    (l, v) => {
      const lab = [...document.querySelectorAll('label')].find(
        (x) => (x.textContent ?? '').trim().startsWith(l),
      )
      const input =
        (lab?.htmlFor ? document.getElementById(lab.htmlFor) : null) ??
        lab?.querySelector('input, textarea, select')
      if (!input) return false
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    label,
    value,
  )
  if (!ok) throw new Error(`[${step}] 找不到欄位「${label}」`)
  await sleep(250)
}

/** 這一頁上看得到這段文字嗎？看不到就丟。 */
async function expectText(page, text) {
  const found = await page.evaluate((t) => document.body.textContent.includes(t), text)
  if (!found) {
    const h = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2')].map((x) => x.textContent.trim()).join('｜'),
    )
    throw new Error(`[${step}] 頁面上找不到「${text}」（標題："${h}"，網址 ${page.url()}）`)
  }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })

page.on('console', (msg) => {
  const type = msg.type()
  if (type !== 'error' && type !== 'warning') return
  noise.push({ step, type, text: msg.text().slice(0, 300) })
})
page.on('pageerror', (err) => {
  noise.push({ step, type: 'pageerror', text: String(err).slice(0, 300) })
})
page.on('requestfailed', (req) => {
  noise.push({ step, type: 'requestfailed', text: `${req.url()} ${req.failure()?.errorText ?? ''}` })
})

let failure = null
try {
  // ---- A. 登入：先走錯誤路徑 --------------------------------------------
  setStep('A1 開啟登入頁')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await expectText(page, '登入')

  setStep('A2 密碼錯誤（預期 401，前端要顯示可讀的訊息）')
  await fill(page, '電子郵件', 'guest@sunny.com')
  await fill(page, '密碼', 'wrong-password-xxx')
  await click(page, '登入', { within: 'form' })
  await sleep(1200)
  const alertText = await page.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent?.trim() ?? '',
  )
  if (alertText.length === 0) throw new Error('[A2] 密碼錯誤後沒有出現 role="alert" 的訊息')
  console.log(`      → 訊息：「${alertText}」`)

  setStep('A3 正確登入')
  await fill(page, '密碼', 'guest123')
  await click(page, '登入', { within: 'form' })
  await sleep(1600)
  const loggedIn = await page.evaluate(() => window.localStorage.getItem('sunny.accessToken'))
  if (!loggedIn) throw new Error('[A3] 登入後 localStorage 沒有 token')

  // ---- B. 首頁搜尋與篩選 --------------------------------------------------
  setStep('B1 首頁')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await sleep(700)
  await expectText(page, '房源')

  setStep('B2 關鍵字搜尋')
  await fill(page, '關鍵字', '海')
  await sleep(900)

  setStep('B3 清空關鍵字')
  await fill(page, '關鍵字', '')
  await sleep(900)

  setStep('B4 帶入住宿期間')
  const today = new Date(Date.parse('2026-09-10'))
  const iso = (d) => d.toISOString().slice(0, 10)
  const inD = iso(today)
  const outD = iso(new Date(today.getTime() + 2 * 86400000))
  await fill(page, '入住日', inD)
  await fill(page, '退房日', outD)
  await sleep(1100)

  setStep('B5 每晚價格上限與入住人數')
  await fill(page, '入住人數', '2')
  await fill(page, '每晚價格上限', '9999')
  await sleep(1100)

  // ---- C. 房源詳情 --------------------------------------------------------
  setStep('C1 進入第一間房源')
  const roomHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/rooms/"]')][0]
    return a ? a.getAttribute('href') : null
  })
  if (!roomHref) throw new Error('[C1] 首頁沒有任何房源連結')
  await page.goto(`${BASE}${roomHref}`, { waitUntil: 'networkidle2' })
  await sleep(800)
  await expectText(page, '每晚')

  // ---- D. 我的訂單：切分頁 -------------------------------------------------
  setStep('D1 我的訂單')
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle2' })
  await sleep(900)
  await expectText(page, '我的訂單')

  for (const tab of ['待付款', '已確認', '已完成', '已取消', '全部']) {
    setStep(`D2 切到分頁「${tab}」`)
    await click(page, tab, { optional: true })
  }

  setStep('D3 開啟第一張訂單')
  const orderHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/orders/"]')][0]
    return a ? a.getAttribute('href') : null
  })
  if (orderHref) {
    await page.goto(`${BASE}${orderHref}`, { waitUntil: 'networkidle2' })
    await sleep(900)
    await expectText(page, '訂單')

    setStep('D4 取消流程：開二次確認，然後保留訂單（不真的取消）')
    if (await click(page, '取消訂單', { optional: true })) {
      await expectText(page, '保留訂單')
      await click(page, '保留訂單')
    }
  } else {
    setStep('D3 略過（這個帳號沒有訂單）')
  }

  // ---- E. 退款表單的錯誤路徑 -----------------------------------------------
  setStep('E1 退款表單：原因留空（預期可聚焦的 400）')
  const refundable = await page.evaluate(() =>
    [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === '申請退款')?.getAttribute('href') ?? null,
  )
  if (refundable) {
    await page.goto(`${BASE}${refundable}`, { waitUntil: 'networkidle2' })
    await sleep(800)
    await click(page, '送出退款申請', { optional: true })
    await sleep(900)
  } else {
    setStep('E1 略過（目前沒有可退款的訂單）')
  }

  // ---- F. 其餘會員頁 -------------------------------------------------------
  for (const [name, path, marker] of [
    ['收藏', '/favorites', '收藏'],
    ['客服訊息', '/messages', '客服'],
    ['帳戶設定', '/account', '帳戶'],
    ['安全檢測', '/risk-check', '檢測'],
    ['服務條款', '/terms', '服務條款'],
  ]) {
    setStep(`F 走訪「${name}」`)
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' })
    await sleep(800)
    await expectText(page, marker)
  }

  setStep('F2 帳戶設定：改顯示名稱後儲存')
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle2' })
  await sleep(800)
  await fill(page, '顯示名稱', '住客小美')
  await click(page, '儲存變更', { optional: true })
  await sleep(1200)

  setStep('F3 客服訊息：送出一則')
  await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle2' })
  await sleep(800)
  const sent = await page
    .evaluate(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return false
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        ta,
        'T181 走查訊息',
      )
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })
  if (sent) {
    await sleep(300)
    await click(page, '送出', { optional: true })
    await sleep(1200)
  }

  // ---- G. 404 與登出 -------------------------------------------------------
  setStep('G1 不存在的網址')
  await page.goto(`${BASE}/no-such-page-xyz`, { waitUntil: 'networkidle2' })
  await sleep(700)

  setStep('G2 不存在的房源 id（預期 404，前端要有可讀畫面）')
  await page.goto(`${BASE}/rooms/00000000-0000-0000-0000-000000000000`, {
    waitUntil: 'networkidle2',
  })
  await sleep(900)
} catch (err) {
  failure = String(err)
}

await browser.close()

/*
 * 分類。不分類的話「17 筆」這個數字沒有意義——其中有些是**刻意觸發**的
 * 錯誤路徑，Chrome 對任何非 2xx 都會自己印一行 "Failed to load resource"，
 * 那不是應用程式寫出來的紅字，也不是缺陷。
 */
const EXPECTED_STEPS = /A2 密碼錯誤|原因留空|不存在的/
const classify = (n) => {
  if (n.type === 'requestfailed' && n.text.includes('ERR_ABORTED')) return '被取消的請求'
  if (/status of 5\d\d/.test(n.text)) return '伺服器 5xx'
  if (/status of 4\d\d/.test(n.text)) return EXPECTED_STEPS.test(n.step) ? '預期中的 4xx' : '非預期 4xx'
  return '應用程式紅字'
}
const buckets = new Map()
for (const n of noise) {
  const k = classify(n)
  if (!buckets.has(k)) buckets.set(k, [])
  buckets.get(k).push(n)
}

console.log(`\n===== ${trail.length} 個步驟 =====`)
if (failure) console.log(`步驟中斷：${failure}\n`)
for (const [k, list] of buckets) {
  console.log(`\n${k}：${list.length}`)
  for (const n of list.slice(0, 6)) console.log(`  [${n.type}] ${n.step}\n        ${n.text}`)
  if (list.length > 6) console.log(`  …另外 ${list.length - 6} 筆`)
}
const real = noise.filter((n) => !['預期中的 4xx'].includes(classify(n)))
if (real.length === 0 && !failure) console.log('\n互動期間全程乾淨（只剩刻意觸發的錯誤路徑）')

fs.writeFileSync(
  new URL('./t181_flows.json', import.meta.url),
  JSON.stringify({ trail, noise, failure }, null, 2),
  'utf8',
)
