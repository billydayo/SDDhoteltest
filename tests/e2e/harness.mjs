/**
 * E2E 共用工具：啟動瀏覽器、登入、切換模式、斷言。
 *
 * 用 puppeteer-core 而非 puppeteer：後者會自己下載一份 Chromium（約 150 MB），
 * 而這台機器上本來就有 Chrome。依憲章，這些依賴只存在於 tests/ 之下，
 * 應用程式不 import 任何一支，刪掉整個 tests/ 也不影響執行。
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

export const BASE = process.env.SUNNY_BASE ?? 'http://127.0.0.1:8000';

/** 常見的 Chrome 安裝位置。找不到時請設 CHROME_PATH。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function chromePath() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      '找不到 Chrome。請設環境變數 CHROME_PATH 指向瀏覽器執行檔。\n'
      + `已嘗試：\n  ${CHROME_CANDIDATES.join('\n  ')}`
    );
  }
  return found;
}

/**
 * 開一個受控的頁面。
 *
 * demo=true 時攔截 src/config.js 回傳空憑證，強制進入示範模式——
 * 這樣測試不會碰到線上資料庫，也就不會在別人的正式資料上留下痕跡。
 */
/**
 * 主控台雜訊的白名單。
 *
 * 這裡只放「不是本專案造成、也修不掉」的訊息。任何來自 src/ 的錯誤或警告
 * 都不該加進來——那是要修的東西，不是要藏的東西。
 */
const CONSOLE_NOISE = [
  // 無頭 Chrome 沒有 favicon 的處理器，每頁都會叫一次
  /favicon\.ico/,
  // DevTools 在無頭模式下對自己發的提示
  /DevTools listening on/
];

export async function openPage({
  demo = false, width = 1400, height = 1100, allowConsole = []
} = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  /*
   * 把 User-Agent 裡的 HeadlessChrome 改回 Chrome。
   *
   * 不是為了「假裝不是自動化」，而是因為房源照片允許填外部網址（FR-050），
   * 而有些圖床的機器人防護看到 HeadlessChrome 會**直接切斷連線**——不是回 403，
   * 是連回應都不給。Chrome 把它報成 ERR_HTTP2_PROTOCOL_ERROR，看起來就像
   * 「這張照片壞了」，實際上真人開同一頁完全正常。
   *
   * 實測：13w.com.tw 的 Winho-CDN 對 HeadlessChrome 斷線、對一般 Chrome UA 回
   * 200。不改的話，主控台檢查會把一張好照片誤報成故障。
   */
  await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));

  const problems = [];
  page.on('pageerror', (e) => problems.push(`JS 例外：${e.message}`));
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.url().includes('/rest/v1/')) {
      let body = '';
      try { body = (await r.text()).slice(0, 160); } catch { /* 讀不到就算了 */ }
      problems.push(`HTTP ${r.status()} ${r.url().split('/rest/v1/')[1]?.slice(0, 40)} :: ${body}`);
    }
  });

  /*
   * 主控台的錯誤與警告（SC-014／T118）。
   *
   * 與 problems 分開收：pageerror 抓的是「未捕捉的例外」，而 console.error
   * 多半是被 catch 起來、畫面上看不出異狀、卻代表某處出了事的訊息。
   * 兩者的意義不同，混在一起會讓既有的 !problems.length 斷言變得說不清楚。
   *
   * 同一則訊息可能在一次流程裡重複幾十次（例如每張卡片各噴一次），
   * 因此以內容為鍵計數，回報時只列一行並附上次數。
   */
  const consoleCounts = new Map();
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const body = msg.text();
    const loc = msg.location();
    const where = loc?.url
      ? ` @ ${loc.url.replace(BASE, '')}:${(loc.lineNumber ?? 0) + 1}`
      : '';
    const key = `console.${type}：${body}${where}`;
    // 比對包含出處的完整字串——載入失敗的訊息本身不含網址，
    // 只比對 msg.text() 會讓 /favicon\.ico/ 這類過濾永遠比不中。
    if ([...CONSOLE_NOISE, ...allowConsole].some((re) => re.test(key))) return;
    consoleCounts.set(key, (consoleCounts.get(key) ?? 0) + 1);
  });
  const consoleIssues = {
    get length() { return consoleCounts.size; },
    list() {
      return [...consoleCounts].map(([k, n]) => (n > 1 ? `${k}  ×${n}` : k));
    }
  };

  if (demo) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().endsWith('/src/config.js')) {
        req.respond({
          status: 200,
          contentType: 'application/javascript',
          body: 'window.__SUNNY_CONFIG__ = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };'
        });
      } else req.continue();
    });
  }

  /*
   * window.confirm 一律換成可控的樁。
   *
   * 無頭 Chrome 的原生 dialog 事件不穩定，實測會出現「對話框沒觸發、
   * confirm 直接回 false」而讓測試誤判成功能壞掉。換成樁之後，
   * 「使用者按確定／按取消」變成明確可控的輸入。
   */
  await page.evaluateOnNewDocument(() => {
    window.__confirmMessage = null;
    window.__confirmAnswer = true;
    window.confirm = (message) => {
      window.__confirmMessage = message;
      return window.__confirmAnswer;
    };
  });

  return { browser, page, problems, consoleIssues };
}

export async function goto(page, hash, settle = 2500) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !document.querySelector('.loading-state'), { timeout: 15000 })
    .catch(() => { /* 有些頁面沒有 loading 狀態，等固定時間即可 */ });
  await sleep(settle);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(page, email, password) {
  await goto(page, '#/login', 2000);
  await page.type('#login-email', email);
  await page.type('#login-password', password);
  await page.click('#main button[type="submit"]');
  await sleep(3500);
}

/** 依按鈕文字點擊。回傳是否找到。 */
export function clickByText(page, text, scope = '') {
  return page.evaluate((t, s) => {
    const root = s ? document.querySelector(s) : document;
    const btn = [...(root?.querySelectorAll('button, a') ?? [])]
      .find((b) => b.textContent.trim() === t);
    if (!btn) return false;
    btn.click();
    return true;
  }, text, scope);
}

export const setValue = (page, selector, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) throw new Error(`找不到 ${s}`);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, selector, value);

export const text = (page, selector) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, selector);

export const count = (page, selector) =>
  page.evaluate((s) => document.querySelectorAll(s).length, selector);

// ---------------------------------------------------------------------------
// 迷你斷言
// ---------------------------------------------------------------------------

export function createReporter(suiteName) {
  const results = { passed: 0, failed: 0 };
  console.log(`\n=== ${suiteName} ===`);

  return {
    check(label, actual, expected) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      results[ok ? 'passed' : 'failed'] += 1;
      console.log(`${ok ? '✅' : '❌'} ${label}`
        + (ok ? '' : `\n     預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`));
    },
    ok(label, condition, detail = '') {
      results[condition ? 'passed' : 'failed'] += 1;
      console.log(`${condition ? '✅' : '❌'} ${label}${condition ? '' : `  ${detail}`}`);
    },
    /**
     * @param problems      openPage 回傳的頁面錯誤（未捕捉例外、REST 4xx）
     * @param consoleIssues openPage 回傳的主控台錯誤與警告。傳入才會檢查——
     *                      沒傳的區段不會憑空多一項通過，數字才對得起來。
     */
    done(problems = [], consoleIssues = null) {
      if (problems.length) {
        results.failed += problems.length;
        console.log(`❌ 頁面錯誤 ${problems.length} 筆：\n     ${problems.join('\n     ')}`);
      }
      if (consoleIssues) {
        if (consoleIssues.length) {
          results.failed += consoleIssues.length;
          console.log(`❌ 主控台錯誤／警告 ${consoleIssues.length} 種（SC-014）：`
            + `\n     ${consoleIssues.list().join('\n     ')}`);
        } else {
          results.passed += 1;
          console.log('✅ 主控台零錯誤零警告（SC-014）');
        }
      }
      console.log(`--- 通過 ${results.passed} / 失敗 ${results.failed} ---`);
      return results;
    }
  };
}
