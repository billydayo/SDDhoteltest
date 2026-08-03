/**
 * 應用程式進入點。
 *
 * 啟動順序刻意如此：
 *   1. 綁定 adapter（決定示範模式或資料庫模式）
 *   2. 資料庫模式下驗證憑證是否有效
 *   3. 還原登入狀態
 *   4. 建立外殼與路由
 *
 * 第 2 步不可省略：FR-084 要求憑證填了但無效時顯示明確的設定錯誤，
 * 不得表現為一般性當機，也不得悄悄退回示範模式。
 */

import { initRepository, getSystemSettings, sweepExpiredOrders } from './data/repository.js';
import { verifyConnection, isSupabaseConfigured, isPartiallyConfigured } from './lib/supabase.js';
import { initAuth, consumeOAuthResult, takePostAuthRedirect } from './services/auth.js';
import { initShell, renderError, refreshHeader, toast } from './app.js';
import * as store from './state/store.js';
import * as router from './router.js';
import { renderHome } from './pages/home.js';
import { renderRoomDetail } from './pages/room-detail.js';
import { renderLogin } from './pages/login.js';
import { renderAccount } from './pages/account.js';
import { renderBooking } from './pages/booking.js';
import { renderOrders, renderOrderDetail } from './pages/orders.js';
import { renderFavorites } from './pages/favorites.js';
import { renderMessages } from './pages/messages.js';
import { renderRiskCheck } from './pages/risk-check.js';
import { renderTerms } from './pages/terms.js';
import { renderAdmin } from './pages/admin.js';
import { renderNotFound } from './pages/not-found.js';
import { ADMIN_MODULES } from './components/admin-panel.js';
import { renderModeBanner } from './components/demo-badge.js';

async function boot() {
  try {
    const info = await initRepository();
    store.setMode(info.mode);

    if (isSupabaseConfigured) {
      // 憑證無效時這裡會丟出 CONFIG_ERROR，並停在錯誤畫面而非繼續跑
      await verifyConnection();
    } else if (isPartiallyConfigured) {
      toast('src/config.js 只填了一半的憑證，已進入示範模式。', 'error');
    }

    // Google 授權被取消時，導回的網址帶有 error 參數。必須在路由啟動前處理掉，
    // 否則 hash 路由會把它當成不存在的路徑（FR-090）。
    const oauth = consumeOAuthResult();

    await initAuth();

    try {
      store.setSettings(await getSystemSettings());
    } catch {
      // 設定讀取失敗不應該擋住整個應用程式；相關頁面會各自處理
    }

    initShell();
    registerRoutes();

    // OAuth 成功導回：回到使用者原本要去的地方（T044）
    const postAuth = store.isSignedIn() ? takePostAuthRedirect() : null;
    if (postAuth) window.location.hash = postAuth;

    await router.startRouter();
    startExpirySweep();

    if (oauth.cancelled) {
      toast(oauth.message, 'error');
      router.navigate('#/login', { replace: true });
    }
  } catch (err) {
    // 啟動失敗必須說清楚，不能只留空白畫面（憲章「錯誤處理」條）
    initShellSafely();
    renderError(err, { retry: () => window.location.reload() });
  }
}

/** 啟動失敗時仍要把模式橫幅與頁首畫出來，讓使用者知道自己在哪 */
function initShellSafely() {
  try {
    renderModeBanner(document.getElementById('mode-banner'));
    initShell();
  } catch {
    // 外殼都畫不出來就只剩錯誤畫面，那是 renderError 的責任
  }
}

/**
 * 逾期訂單的定期清理（FR-099）。
 *
 * 「查詢時判定」保證了正確性——沒有人看得到過期訂單仍佔著房。但如果使用者
 * 就停在訂單頁不動，畫面不會自己更新，房源也要等下一次有人查詢才釋出。
 * 這支定時器補上那段：每分鐘掃一次，真的有訂單過期時才更新畫面。
 *
 * 這不是背景排程作業（憲章原則 II 禁止的是伺服器端 cron）——
 * 它只是應用程式在開著的時候自己發的查詢，關掉分頁就停止。
 *
 * 只在分頁可見時執行：背景分頁沒有人在看，掃描沒有意義，徒增請求。
 */
const SWEEP_INTERVAL_MS = 60_000;

/** 過期後值得自動重繪的頁面。表單頁刻意排除，避免把使用者填到一半的內容清掉。 */
const REFRESHABLE = ['#/orders', '#/'];

function startExpirySweep() {
  window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;

    const expired = await sweepExpiredOrders();
    if (!expired) return;

    toast(`${expired} 筆訂單因逾期未付款已自動取消，房源已釋出。`);

    const path = router.currentHash().split('?')[0];
    const safe = REFRESHABLE.includes(path) || /^#\/orders\/[^/]+$/.test(path);
    if (safe) router.resolve();
  }, SWEEP_INTERVAL_MS);
}

/*
 * 後台路由直接由 ADMIN_MODULES 推導，不另外手抄一份。
 *
 * 這裡原本是一份寫死的清單，於是同一組路由在專案裡有三份：導覽（ADMIN_MODULES）、
 * 路由註冊（這裡）、分派表（pages/admin.js）。新增模組時漏改任何一份都不會報錯，
 * 只會表現成「導覽點了沒反應」或「網址進得去但選單看不到」——最難查的那種。
 * 分派表必須留著（它要對應到各自的 render 函式），但這一份是純粹的重複。
 */
const ADMIN_ROUTES = ADMIN_MODULES.map((mod) => mod.route);

function registerRoutes() {
  router.register('#/', renderHome);

  router.register('#/rooms/:id', renderRoomDetail);

  router.register('#/login', renderLogin);
  router.register('#/account', renderAccount);

  router.register('#/booking/:id', renderBooking);
  router.register('#/orders', renderOrders);
  router.register('#/orders/:id', renderOrderDetail);

  router.register('#/favorites', renderFavorites);
  router.register('#/messages', renderMessages);
  router.register('#/risk-check', renderRiskCheck);
  router.register('#/terms', renderTerms);

  // 後台：十二個模組共用同一個守衛與版面，由 pages/admin.js 分派
  ADMIN_ROUTES.forEach((route) => router.register(route, renderAdmin));

  router.setNotFound(renderNotFound);

  router.onAfterNavigate(({ blocked, message }) => {
    refreshHeader();
    if (blocked && message) toast(message, 'error');
  });
}

boot();
