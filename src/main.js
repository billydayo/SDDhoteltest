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

import { initRepository, getMode, getSystemSettings } from './data/repository.js';
import { verifyConnection, isSupabaseConfigured, isPartiallyConfigured } from './lib/supabase.js';
import { initAuth, consumeOAuthResult, takePostAuthRedirect } from './services/auth.js';
import { initShell, render, renderError, refreshHeader, toast } from './app.js';
import * as store from './state/store.js';
import * as router from './router.js';
import { renderHome } from './pages/home.js';
import { renderRoomDetail } from './pages/room-detail.js';
import { renderLogin } from './pages/login.js';
import { renderAccount } from './pages/account.js';
import { placeholderPage } from './pages/placeholder.js';
import { createAdminLayout, guardAdminAccess } from './components/admin-panel.js';
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

function registerRoutes() {
  router.register('#/', renderHome);

  router.register('#/rooms/:id', renderRoomDetail);

  router.register('#/login', renderLogin);
  router.register('#/account', renderAccount);

  router.register('#/orders', placeholderPage({
    title: '我的訂單',
    story: 'User Story 3 與 4（含待付款倒數與退款申請）',
    taskRange: 'Phase 6 與 Phase 7'
  }));

  router.register('#/favorites', placeholderPage({
    title: '我的收藏',
    story: 'User Story 10',
    taskRange: 'Phase 13 的 T095–T099'
  }));

  router.register('#/risk-check', placeholderPage({
    title: '安全檢測',
    story: 'User Story 9（前台路徑：照片全程留在瀏覽器內，不會上傳）',
    taskRange: 'Phase 12 的 T087–T090'
  }));

  router.register('#/terms', placeholderPage({
    title: '服務條款與隱私聲明',
    story: '跨切面需求 FR-121 與 FR-122',
    taskRange: 'Phase 16 的 T112',
    description: '本站為展示用專案，不提供真實住宿服務，不進行真實交易，也不蒐集真實個人資料。'
  }));

  // 後台：所有模組共用同一個守衛與版面
  const adminModuleRoutes = [
    '#/admin', '#/admin/rooms', '#/admin/orders', '#/admin/users',
    '#/admin/reviews', '#/admin/refunds', '#/admin/export', '#/admin/content',
    '#/admin/risk', '#/admin/channel', '#/admin/logs', '#/admin/settings'
  ];
  adminModuleRoutes.forEach((route) => router.register(route, renderAdminShell));

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

/** 後台外殼：導覽 + 尚未實作的模組內容 */
function renderAdminShell(context) {
  const guard = guardAdminAccess();
  if (!guard.allowed) {
    toast(guard.message, 'error');
    router.navigate(guard.redirect, { replace: true });
    return;
  }

  const { layout, panel } = createAdminLayout(context.path);

  const h1 = document.createElement('h1');
  h1.textContent = '後台管理';
  const note = document.createElement('div');
  note.className = 'empty-state';
  note.style.textAlign = 'left';

  const h2 = document.createElement('h2');
  h2.textContent = '模組尚未實作';
  const p = document.createElement('p');
  p.textContent = '十一個後台模組屬 User Story 6–12（Phase 9 之後）。目前已完成的是角色守衛、'
    + '模組導覽與稽核寫入層 src/services/audit.js。';
  const p2 = document.createElement('p');
  p2.textContent = `目前登入身分：${store.currentProfile()?.displayName ?? '—'}（管理員）。`
    + `資料來源：${getMode() === 'demo' ? '瀏覽器 localStorage' : 'Supabase'}。`;

  note.append(h2, p, p2);
  panel.append(h1, note);
  render(layout);
}

boot();
