/**
 * Hash 路由與角色守衛。
 *
 * 使用 hash 而非 History API，是因為專案必須能以 file:// 直接開啟
 * （憲章原則 II）——History API 在本機檔案協定下無法運作。
 *
 * 守衛是使用者體驗，不是安全機制。真正的存取邊界由資料庫 RLS 執行
 * （憲章原則 VI）。
 */

import * as store from './state/store.js';

/** 需要登入的路由（FR-019、FR-033） */
const MEMBER_ROUTES = ['#/orders', '#/account', '#/favorites', '#/booking'];

/** 需要管理員的路由（FR-009） */
const ADMIN_ROUTES = ['#/admin'];

const routes = new Map();
let notFoundHandler = null;
let afterNavigate = null;
let pendingRedirect = null;

/**
 * 登入後要回到的地方。
 * FR-093：訪客點收藏 → 導向登入 → 登入後回到原本的房源並完成收藏。
 */
export function setPendingRedirect(hash, action = null) {
  pendingRedirect = { hash, action };
}

export function takePendingRedirect() {
  const value = pendingRedirect;
  pendingRedirect = null;
  return value;
}

export function register(pattern, handler) {
  routes.set(pattern, handler);
}

export function onAfterNavigate(fn) {
  afterNavigate = fn;
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

export function currentHash() {
  return window.location.hash || '#/';
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

/** 解析 `#/rooms/:id` 這類路徑，回傳 { pattern, params } */
function match(hash) {
  const path = hash.split('?')[0];

  if (routes.has(path)) return { pattern: path, params: {} };

  for (const pattern of routes.keys()) {
    if (!pattern.includes(':')) continue;
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i += 1) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { pattern, params };
  }
  return null;
}

/** 查詢字串 `#/rooms?type=suite` → { type: 'suite' } */
function parseQuery(hash) {
  const idx = hash.indexOf('?');
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(idx + 1)));
}

function checkGuards(path) {
  const needsMember = MEMBER_ROUTES.some((r) => path.startsWith(r));
  const needsAdmin = ADMIN_ROUTES.some((r) => path.startsWith(r));

  if ((needsMember || needsAdmin) && !store.isSignedIn()) {
    setPendingRedirect(path);
    return { allowed: false, redirect: '#/login', message: '請先登入後再繼續。' };
  }
  if (needsAdmin && !store.isAdmin()) {
    return { allowed: false, redirect: '#/', message: '你沒有權限存取後台頁面。' };
  }
  return { allowed: true };
}

export async function resolve() {
  const hash = currentHash();
  const path = hash.split('?')[0];

  const guard = checkGuards(path);
  if (!guard.allowed) {
    afterNavigate?.({ blocked: true, message: guard.message });
    navigate(guard.redirect, { replace: true });
    return;
  }

  const matched = match(hash);
  const context = {
    hash,
    path,
    params: matched?.params ?? {},
    query: parseQuery(hash)
  };

  const handler = matched ? routes.get(matched.pattern) : notFoundHandler;
  if (!handler) return;

  await handler(context);
  afterNavigate?.({ blocked: false, path });
}

export function startRouter() {
  window.addEventListener('hashchange', () => { resolve(); });
  if (!window.location.hash) {
    navigate('#/', { replace: true });
  }
  return resolve();
}
