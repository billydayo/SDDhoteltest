/**
 * Google 第三方登入（FR-087、FR-089、FR-090、T009、T044）。
 *
 * 這一支測得到「按下去之後真的往正確的地方走」與「取消之後回得來」，
 * 測不到的是授權畫面本身——那需要一組真實的 Google 帳密。
 * 完成授權後的兩件事（同信箱不產生第二個帳號 FR-088／SC-025、
 * 登入後回到原本要去的頁面）仍留在 browser-acceptance.md 由人工把關。
 *
 * 全程不會真的連到 accounts.google.com：主框架一旦要離開本站，
 * 就攔下來記錄網址並中止，因此不產生任何真實的授權請求，也不建立帳號。
 */

import { openPage, goto, sleep, createReporter, BASE } from './harness.mjs';

const r = createReporter('Google 第三方登入');

// ---------------------------------------------------------------------------
// 示範模式：按鈕停用並說明原因（FR-089）
// ---------------------------------------------------------------------------

{
  const { browser, page, problems } = await openPage({ demo: true });
  await goto(page, '#/login', 2000);

  const btn = await googleButton(page);
  r.ok('示範模式：有 Google 登入按鈕', btn.found);
  r.check('示範模式：按鈕為停用', btn.disabled, true);
  r.ok('示範模式：說明了為什麼不能用',
    (btn.note ?? '').includes('示範模式不支援'), btn.note);
  r.ok('示範模式：停用狀態有 aria 描述',
    btn.describedBy === 'google-unavailable', btn.describedBy);

  // 按鈕被停用只是第一道防線，服務層必須自己也擋得住
  r.check('示範模式：服務層擋下 Google 登入',
    await page.evaluate(async () => {
      const m = await import('/src/services/auth.js');
      try { await m.loginWithGoogle('#/'); return '沒有被擋'; }
      catch (e) { return e.code ?? e.message; }
    }),
    'DEMO_UNSUPPORTED');

  r.ok('示範模式：Google 登入不發出任何網路請求',
    !problems.length, problems.join(' / '));

  await browser.close();
}

// ---------------------------------------------------------------------------
// 資料庫模式：真的導向 Google（FR-087、T009）
// ---------------------------------------------------------------------------

{
  const { browser, page, problems } = await openPage();

  /*
   * 主框架要離開本站時攔下來：記錄網址、中止導覽。
   * 這樣既驗證得到參數，又不會真的打到 Google。
   *
   * 一定要用 abort('aborted')。預設的 abort() 是 ERR_FAILED，Chrome 會
   * commit 一個錯誤頁，文件因此落到不透明的 origin——sessionStorage 讀不到
   * （直接丟 SecurityError），`.toast` 也一律查成空陣列，讓「沒有錯誤提示」
   * 變成永遠會過的假斷言。ERR_ABORTED 則是單純取消，頁面留在原地。
   */
  const leaving = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()
        && url.startsWith('https://accounts.google.com/')) {
      leaving.push(url);
      req.abort('aborted');
      return;
    }
    req.continue();
  });

  await goto(page, '#/login', 2500);

  const btn = await googleButton(page);
  r.ok('資料庫模式：按鈕可用', btn.found && btn.disabled === false, JSON.stringify(btn));
  r.ok('資料庫模式：說明會回到原本的頁面',
    (btn.note ?? '').includes('回到你原本要前往的頁面'), btn.note);

  // 先製造一個「本來想去的地方」，等一下驗證它有被保存下來（T044）
  await page.evaluate(async () => {
    const router = await import('/src/router.js');
    router.setPendingRedirect('#/favorites');
  });

  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === '以 Google 帳號登入')?.click());
  await sleep(6000);

  r.ok('點擊後真的往 Google 走', leaving.length > 0,
    `攔到 ${leaving.length} 次離站導覽`);

  // 導覽被取消後頁面應該還在原地。先確認這件事，否則下面的 toast 查詢
  // 會在一個空文件上跑，「沒有錯誤提示」就成了永遠會過的假斷言。
  r.ok('取消導覽後仍停在登入頁',
    await page.evaluate(() => Boolean(document.querySelector('#main'))));

  // T009 沒做完時，signInWithGoogle 會丟 CONFIG_ERROR 並把訊息顯示成提示。
  // 這一項是這支測試最重要的迴歸防線。
  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()));
  r.ok('沒有「Google 登入尚未啟用」的錯誤',
    !toasts.some((t) => t.includes('尚未啟用')), toasts.join(' / '));
  r.check('完全沒有錯誤提示', toasts.filter(Boolean), []);

  const authorize = leaving[0] ?? '';
  const params = new URLSearchParams(authorize.split('?')[1] ?? '');
  r.ok('導向的是 Google 的授權端點',
    authorize.startsWith('https://accounts.google.com/o/oauth2/'), authorize.slice(0, 60));
  r.ok('帶了 client_id', Boolean(params.get('client_id')), params.get('client_id') ?? '(無)');
  r.check('回呼位址指向本專案的 Supabase',
    params.get('redirect_uri'),
    'https://ggdwzqvimdflecpgaoml.supabase.co/auth/v1/callback');
  r.check('授權範圍只要 email 與 profile', params.get('scope'), 'email profile');
  r.ok('授權後導回本站',
    (params.get('redirect_to') ?? '').startsWith(BASE), params.get('redirect_to') ?? '(無)');

  // OAuth 會整頁離開再回來，待導向目標必須活過這趟往返（T044）
  r.check('待導向目標已存進 sessionStorage',
    await page.evaluate(() => window.sessionStorage.getItem('sunny.postAuthRedirect')),
    '#/favorites');

  r.ok('資料庫模式：過程中沒有頁面錯誤', !problems.length, problems.join(' / '));

  await browser.close();
}

// ---------------------------------------------------------------------------
// 在 Google 的授權畫面按取消（FR-090）
// ---------------------------------------------------------------------------

{
  const { browser, page, problems } = await openPage();

  // Supabase 取消授權時導回的形狀
  await page.goto(
    `${BASE}/?error=access_denied&error_description=The+user+denied+the+request`,
    { waitUntil: 'networkidle2' }
  );
  await sleep(3500);

  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()));
  r.ok('取消後有告知已取消',
    toasts.some((t) => t.includes('已取消登入')), toasts.join(' / '));
  r.check('取消後回到登入頁',
    await page.evaluate(() => window.location.hash), '#/login');
  r.check('網址上的 error 參數已清掉',
    await page.evaluate(() => window.location.search), '');
  r.check('取消不建立任何工作階段',
    await page.evaluate(async () => {
      const store = await import('/src/state/store.js');
      return store.isSignedIn();
    }),
    false);

  // 重新整理不該再跳一次提示——參數已經從網址上清掉了
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(3000);
  r.check('重新整理不再重複提示',
    await page.evaluate(() =>
      [...document.querySelectorAll('.toast')]
        .filter((t) => t.textContent.includes('已取消登入')).length),
    0);

  r.ok('取消流程沒有頁面錯誤', !problems.length, problems.join(' / '));

  await browser.close();
}

function googleButton(page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === '以 Google 帳號登入');
    if (!btn) return { found: false, disabled: null, note: null, describedBy: null };
    return {
      found: true,
      disabled: btn.disabled,
      note: btn.parentElement?.querySelector('#google-unavailable')?.textContent?.trim() ?? null,
      describedBy: btn.getAttribute('aria-describedby')
    };
  });
}

const summary = r.done();
process.exit(summary.failed ? 1 : 0);
