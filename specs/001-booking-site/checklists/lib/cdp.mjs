/**
 * 零相依的 Chrome DevTools Protocol 用戶端。
 *
 * ## 為什麼不用 puppeteer
 *
 * `t181-walkthrough.mjs` 原本 `require` 一個寫死的絕對路徑
 * （`C:/Users/user/Desktop/0804/.../node_modules/puppeteer-core`）。那個資料夾
 * 在 2026-08-05 已經不存在，於是那支腳本在任何其他機器上——包含這一台——
 * 都是死的。稽核腳本活得比工作副本久，就不能相依於工作副本裡的東西。
 *
 * 這裡只用 Node 內建的 `WebSocket`（Node 22+）與 `child_process`，
 * **不新增任何 npm 相依**，也不需要 `npm install`。
 *
 * ## 涵蓋範圍
 *
 * 只實作稽核用得到的那一小塊：開瀏覽器、開分頁、設視窗尺寸、導向、
 * 在頁面裡求值、收 console 與網路噪音。不是 puppeteer 的替代品。
 *
 * @see responsive-audit.mjs   320–1920px 的全站掃描
 * @see ../t181-walkthrough.mjs 互動走查
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (typeof WebSocket === 'undefined') {
  throw new Error(
    `需要內建 WebSocket 的 Node（22 以上），目前是 ${process.version}。\n` +
      '這是本檔「零相依」的唯一前提；升級 Node 即可，不需要安裝任何套件。',
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// 找 Chrome
// ---------------------------------------------------------------------------
const CHROME_CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
}

/** 找一個可執行的 Chrome。`SUNNY_CHROME` 可覆寫。 */
export function findChrome() {
  const override = process.env.SUNNY_CHROME
  if (override) {
    if (!fs.existsSync(override)) throw new Error(`SUNNY_CHROME 指向不存在的檔案：${override}`)
    return override
  }
  for (const p of CHROME_CANDIDATES[process.platform] ?? []) {
    if (p && fs.existsSync(p)) return p
  }
  throw new Error(
    '找不到 Chrome。請設 `SUNNY_CHROME` 環境變數指向 chrome 的執行檔路徑。\n' +
      `已找過：\n${(CHROME_CANDIDATES[process.platform] ?? []).map((p) => `  ${p}`).join('\n')}`,
  )
}

// ---------------------------------------------------------------------------
// 連線：一條 WebSocket，以 sessionId 多工
// ---------------------------------------------------------------------------
class Connection {
  #ws
  #nextId = 1
  #pending = new Map()
  #handlers = new Map()
  #closed = null

  static async open(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`CDP 連不上 ${url}`)), { once: true })
    })
    return new Connection(ws)
  }

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (ev) => this.#dispatch(JSON.parse(ev.data)))
    ws.addEventListener('close', () => {
      this.#closed = new Error('CDP 連線已關閉')
      for (const { reject } of this.#pending.values()) reject(this.#closed)
      this.#pending.clear()
    })
  }

  #dispatch(msg) {
    if (msg.id !== undefined) {
      const waiter = this.#pending.get(msg.id)
      if (!waiter) return
      this.#pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`${waiter.method} 失敗：${msg.error.message}`))
      else waiter.resolve(msg.result)
      return
    }
    for (const handler of this.#handlers.get(`${msg.sessionId ?? ''}\u0000${msg.method}`) ?? []) {
      handler(msg.params ?? {})
    }
  }

  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(this.#closed)
    const id = this.#nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }))
  }

  /** 訂閱事件。回傳解除訂閱的函式。 */
  on(method, handler, sessionId) {
    const key = `${sessionId ?? ''}\u0000${method}`
    if (!this.#handlers.has(key)) this.#handlers.set(key, new Set())
    this.#handlers.get(key).add(handler)
    return () => this.#handlers.get(key)?.delete(handler)
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      /* 已經斷了 */
    }
  }
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export class Page {
  #conn
  #sessionId
  #mainFrameId

  constructor(conn, sessionId) {
    this.#conn = conn
    this.#sessionId = sessionId
  }

  #send(method, params) {
    return this.#conn.send(method, params, this.#sessionId)
  }

  async init() {
    await this.#send('Page.enable')
    await this.#send('Runtime.enable')
    await this.#send('Log.enable')
    await this.#send('Network.enable')
    await this.#send('Page.setLifecycleEventsEnabled', { enabled: true })
    const { frameTree } = await this.#send('Page.getFrameTree')
    this.#mainFrameId = frameTree.frame.id
    return this
  }

  /**
   * 收 console 噪音。
   *
   * 四個來源缺一不可：
   * - `Runtime.consoleAPICalled`  → 應用程式自己呼叫的 `console.error/warn`
   * - `Runtime.exceptionThrown`   → 未捕捉的例外（puppeteer 的 `pageerror`）
   * - `Log.entryAdded`            → **Chrome 自己印的** "Failed to load resource"，
   *                                  帶得到 HTTP 狀態碼；分類靠這一條
   * - `Network.loadingFailed`     → `ERR_ABORTED` 之類的傳輸層失敗
   *
   * 少了 `Log.entryAdded`，任何 4xx／5xx 都不會被看見——而那正是最該看見的。
   */
  onNoise(sink) {
    const s = this.#sessionId
    this.#conn.on(
      'Runtime.consoleAPICalled',
      (p) => {
        if (p.type !== 'error' && p.type !== 'warning' && p.type !== 'assert') return
        const text = (p.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ')
          .trim()
        sink({ type: p.type === 'assert' ? 'error' : p.type, text: text.slice(0, 300) })
      },
      s,
    )
    this.#conn.on(
      'Runtime.exceptionThrown',
      (p) => {
        const d = p.exceptionDetails ?? {}
        const text = d.exception?.description ?? d.text ?? '(未知例外)'
        sink({ type: 'pageerror', text: String(text).slice(0, 300) })
      },
      s,
    )
    this.#conn.on(
      'Log.entryAdded',
      (p) => {
        const e = p.entry ?? {}
        if (e.level !== 'error' && e.level !== 'warning') return
        const where = e.url ? ` ${e.url}` : ''
        sink({ type: e.level, text: `${e.text}${where}`.slice(0, 300) })
      },
      s,
    )
    this.#conn.on(
      'Network.loadingFailed',
      (p) => {
        if (p.canceled && p.errorText === 'net::ERR_ABORTED') {
          sink({ type: 'requestfailed', text: `ERR_ABORTED ${p.type ?? ''}`.trim() })
          return
        }
        sink({ type: 'requestfailed', text: `${p.errorText ?? '失敗'} ${p.type ?? ''}`.trim() })
      },
      s,
    )
  }

  /**
   * 設定視窗尺寸。
   *
   * `mobile: false` 是刻意的：響應式靠的是 CSS 的寬度斷點，不是 UA。
   * 開 `mobile: true` 會連帶換掉 UA 與 `devicePixelRatio`，量到的就不再是
   * 「同一個網站在不同寬度下」，而是「兩個不同的網站」。
   */
  async setViewport(width, height = 900) {
    await this.#send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  /**
   * 導向並等到安靜。
   *
   * 以 `loaderId` 配對生命週期事件，而不是「收到第一個 networkIdle 就算數」——
   * 上一頁殘留的事件會讓後者提早放行，量到的是還沒渲染完的畫面。
   */
  async goto(url, { waitUntil = 'networkIdle', timeout = 30_000 } = {}) {
    const seen = []
    let loaderId = null
    let settle = null
    const check = () => {
      if (!loaderId || !settle) return
      if (seen.some((e) => e.loaderId === loaderId && e.name === waitUntil)) settle()
    }
    const off = this.#conn.on(
      'Page.lifecycleEvent',
      (p) => {
        if (p.frameId !== this.#mainFrameId) return
        seen.push(p)
        check()
      },
      this.#sessionId,
    )

    try {
      const settled = new Promise((resolve) => {
        settle = resolve
      })
      const res = await this.#send('Page.navigate', { url })
      if (res.errorText) throw new Error(`導向 ${url} 失敗：${res.errorText}`)
      loaderId = res.loaderId
      check()
      const timedOut = Symbol('timeout')
      const winner = await Promise.race([
        settled.then(() => 'ok'),
        sleep(timeout).then(() => timedOut),
      ])
      if (winner === timedOut) throw new Error(`導向 ${url} 逾時（${timeout}ms 未達 ${waitUntil}）`)
    } finally {
      off()
    }
  }

  /**
   * 在頁面裡跑一個函式。
   *
   * ⚠️ `fn` 會被字串化後送進瀏覽器，**取用不到這裡的變數**。要傳值就走 `args`。
   */
  async evaluate(fn, ...args) {
    const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`
    const { result, exceptionDetails } = await this.#send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (exceptionDetails) {
      const text = exceptionDetails.exception?.description ?? exceptionDetails.text
      throw new Error(`頁面內求值丟出例外：${text}`)
    }
    return result.value
  }

  url() {
    return this.evaluate(() => location.href)
  }
}

// ---------------------------------------------------------------------------
// 瀏覽器
// ---------------------------------------------------------------------------
export class Browser {
  constructor(conn, child, userDataDir) {
    this.conn = conn
    this.child = child
    this.userDataDir = userDataDir
  }

  async newPage() {
    const { targetId } = await this.conn.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true })
    return new Page(this.conn, sessionId).init()
  }

  async close() {
    try {
      await Promise.race([this.conn.send('Browser.close'), sleep(3000)])
    } catch {
      /* 關不掉就硬殺 */
    }
    this.conn.close()
    try {
      this.child.kill()
    } catch {
      /* 已經走了 */
    }
    // Chrome 放開檔案要一點時間；清不掉就留著，那只是暫存目錄。
    for (let i = 0; i < 3; i++) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true })
        break
      } catch {
        await sleep(300)
      }
    }
  }
}

/**
 * 開一個乾淨的 Chrome 並接上 CDP。
 *
 * ## `hideScrollbars` 預設為 false，這是刻意的
 *
 * `--hide-scrollbars` 讓 320px 真的是 320px，看起來比較「乾淨」——但它同時
 * 改掉了受測對象。實測（2026-08-05，首頁主視覺）：開著它的時候
 * `innerWidth`、`clientWidth`、`100vw` 三者都等於視窗寬度，捲軸像是不存在，
 * **然而版面的containing block 仍然少了捲軸那 15px**。於是量到一個
 * 「元素向左偏 7px」的現象，而那個 7 純粹是 15/2。
 *
 * 稽核要量的是使用者真正看到的版面，而使用者的瀏覽器有捲軸。把捲軸藏起來
 * 等於在量一個沒有人會看到的版面——那正是這份清單一再警告的失真來源。
 */
export async function launch({ headless = true, chromePath, hideScrollbars = false } = {}) {
  const exe = chromePath ?? findChrome()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunny-cdp-'))
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    'about:blank',
  ]
  if (hideScrollbars) args.unshift('--hide-scrollbars')
  if (headless) args.unshift('--headless=new')

  const child = spawn(exe, args, { stdio: 'ignore' })
  child.on('error', (err) => {
    throw new Error(`啟動 Chrome 失敗（${exe}）：${err.message}`)
  })

  // Chrome 把實際的埠與 ws 路徑寫在 user-data-dir/DevToolsActivePort，兩行。
  const portFile = path.join(userDataDir, 'DevToolsActivePort')
  let wsUrl = null
  for (let i = 0; i < 100 && wsUrl === null; i++) {
    await sleep(150)
    if (!fs.existsSync(portFile)) continue
    const lines = fs.readFileSync(portFile, 'utf8').split('\n')
    if (lines.length >= 2 && lines[0].trim()) wsUrl = `ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`
  }
  if (!wsUrl) {
    try {
      child.kill()
    } catch {
      /* noop */
    }
    throw new Error(`Chrome 起來了但 15 秒內沒寫出 DevToolsActivePort：${portFile}`)
  }

  return new Browser(await Connection.open(wsUrl), child, userDataDir)
}
