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

import { initRepository, getSystemSettings } from './data/repository.js';
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
import { renderRiskCheck } from './pages/risk-check.js';
import { renderTerms } from './pages/terms.js';
import { renderAdmin } from './pages/admin.js';
import { placeholderPage } from './pages/placeholder.js';
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

const ADMIN_ROUTES = [
  '#/admin', '#/admin/rooms', '#/admin/orders', '#/admin/users',
  '#/admin/reviews', '#/admin/refunds', '#/admin/export', '#/admin/content',
  '#/admin/risk', '#/admin/channel', '#/admin/logs', '#/admin/settings'
];

function registerRoutes() {
  router.register('#/', renderHome);

  router.register('#/rooms/:id', renderRoomDetail);

  router.register('#/login', renderLogin);
  router.register('#/account', renderAccount);

  router.register('#/booking/:id', renderBooking);
  router.register('#/orders', renderOrders);
  router.register('#/orders/:id', renderOrderDetail);

  router.register('#/favorites', renderFavorites);
  router.register('#/risk-check', renderRiskCheck);
  router.register('#/terms', renderTerms);

  // 後台：十一個模組共用同一個守衛與版面，由 pages/admin.js 分派
  ADMIN_ROUTES.forEach((route) => router.register(route, renderAdmin));

  router.setNotFound(placeholderPage({
    title: '找不到頁面',
    story: '這個網址不存在',
    taskRange: '請由上方導覽重新選擇',
    description: '你要找的頁面不存在，或尚未實作。'
  }));

  router.onAfterNavigate(({ blocked, message }) => {
    refreshHeader();
    if (blocked && message) toast(message, 'error');
  });
}

boot();
