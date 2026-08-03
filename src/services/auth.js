/**
 * 認證服務。
 *
 * 兩種模式的差異在此收斂：
 * - Supabase 模式：真實認證。密碼由 Supabase Auth 雜湊保管，本應用程式不持有明文。
 * - 示範模式：模擬登入，比對種子帳號。介面必須標示為模擬（憲章原則 VI）。
 *
 * 兩者的函式簽章相同，呼叫端不需要知道現在是哪一種。
 */

import * as repo from '../data/repository.js';
import * as store from '../state/store.js';
import { appError, isAppError } from '../utils/errors.js';
import {
  validateEmail, validatePassword, validateDisplayName, collectErrors, hasErrors
} from '../utils/validation.js';
import { favoriteRoomIds } from '../data/favorites.js';

/** 公開的示範帳號，登入畫面必須列出（FR-005） */
export const DEMO_ACCOUNTS = Object.freeze([
  { label: '會員',   email: 'guest@sunny.com', password: 'guest123' },
  { label: '管理員', email: 'admin@sunny.com', password: 'admin123' }
]);

/**
 * 登入畫面的警語（FR-006）。
 * 即使 Supabase 模式的認證是真的，仍要提醒不要重用真實密碼。
 */
export const PASSWORD_WARNING =
  '本站為展示用專案，請勿使用你在其他網站的真實密碼。';

export const DEMO_LOGIN_NOTICE =
  '目前為示範模式，登入為模擬機制，帳號密碼僅比對本機的示範資料。';

// ---------------------------------------------------------------------------
// 啟動與工作階段
// ---------------------------------------------------------------------------

let unsubscribe = null;

/** 啟動時還原既有工作階段，並訂閱狀態變更（FR-003） */
export async function initAuth() {
  const session = await repo.getSession();
  await applySession(session);

  unsubscribe?.();
  unsubscribe = repo.onAuthStateChange(async () => {
    // 工作階段變動（登入、登出、token 更新、逾時）時重新同步
    const next = await repo.getSession();
    await applySession(next);
  });

  return session;
}

async function applySession(session) {
  store.setSession(session);
  if (session) {
    try {
      store.setFavoriteRoomIds(await favoriteRoomIds());
    } catch {
      // 收藏載入失敗不應該擋住登入流程
      store.setFavoriteRoomIds([]);
    }
  }
}

// ---------------------------------------------------------------------------
// 註冊與登入
// ---------------------------------------------------------------------------

export async function register({ email, password, displayName }) {
  const errors = collectErrors({
    email: validateEmail(email),
    password: validatePassword(password),          // FR-009b：至少 6 個字元
    displayName: validateDisplayName(displayName)
  });
  if (hasErrors(errors)) throw appError('UNKNOWN', Object.values(errors)[0], { details: errors });

  await repo.signUp({ email: email.trim(), password, displayName: displayName.trim() });
  const session = await repo.getSession();
  await applySession(session);
  return session;
}

export async function login({ email, password }) {
  const errors = collectErrors({
    email: validateEmail(email),
    password: password ? null : '請填寫密碼。'
  });
  if (hasErrors(errors)) throw appError('UNKNOWN', Object.values(errors)[0], { details: errors });

  await repo.signIn({ email: email.trim(), password });
  const session = await repo.getSession();
  await applySession(session);
  return session;
}

/**
 * Google 登入（FR-087）。
 *
 * 示範模式會丟出 DEMO_UNSUPPORTED——按鈕本來就該是停用狀態，這是最後一道防線。
 * 我們不假造第三方授權畫面：那會誤導使用者（憲章原則 VI）。
 */
export async function loginWithGoogle(returnTo = null) {
  if (!isGoogleLoginAvailable()) throw appError('DEMO_UNSUPPORTED');
  // OAuth 會整頁離開再回來，記憶體中的待導向目標活不過這趟往返，
  // 因此改存 sessionStorage（T044）
  if (returnTo) savePostAuthRedirect(returnTo);
  return repo.signInWithGoogle();
}

export function isGoogleLoginAvailable() {
  return repo.getMode() === 'supabase';
}

// ---------------------------------------------------------------------------
// OAuth 往返（T044、T046）
// ---------------------------------------------------------------------------

const REDIRECT_KEY = 'sunny.postAuthRedirect';

function savePostAuthRedirect(hash) {
  try { window.sessionStorage.setItem(REDIRECT_KEY, hash); } catch { /* 無痕模式可能不可用 */ }
}

export function takePostAuthRedirect() {
  try {
    const value = window.sessionStorage.getItem(REDIRECT_KEY);
    window.sessionStorage.removeItem(REDIRECT_KEY);
    return value;
  } catch {
    return null;
  }
}

/**
 * 解析 OAuth 導回時的結果。
 *
 * 使用者在 Google 授權畫面按取消時，Supabase 會把 error 參數放在 hash 或
 * query 裡導回。若不處理，我們的 hash 路由會把它當成不存在的路徑
 * （FR-090：必須回到登入頁並告知已取消，且不建立任何帳號）。
 *
 * 成功的情況不需要在這裡處理——supabase-js 的 detectSessionInUrl 會讀取
 * access_token 並自行清掉網址。
 *
 * @returns {{ cancelled: boolean, message: string|null }}
 */
export function consumeOAuthResult() {
  const hash = window.location.hash ?? '';
  const search = window.location.search ?? '';
  const source = hash.includes('error') ? hash.replace(/^#/, '') : search.replace(/^\?/, '');
  if (!source.includes('error')) return { cancelled: false, message: null };

  const params = new URLSearchParams(source);
  const error = params.get('error');
  if (!error) return { cancelled: false, message: null };

  // 清掉網址上的錯誤參數，避免重新整理時又跳一次提示
  const clean = window.location.pathname;
  window.history.replaceState(null, '', clean);

  const denied = error === 'access_denied' || /denied|cancel/i.test(params.get('error_description') ?? '');
  return {
    cancelled: true,
    message: denied
      ? '已取消登入。'
      : `第三方登入未能完成：${params.get('error_description') ?? error}`
  };
}

export async function logout() {
  await repo.signOut();
  await applySession(null);
  return true;
}

// ---------------------------------------------------------------------------
// 個人資料
// ---------------------------------------------------------------------------

export async function updateOwnProfile(patch) {
  const profile = store.currentProfile();
  if (!profile) throw appError('SESSION_EXPIRED');
  const updated = await repo.updateProfile(profile.id, patch);
  store.setSession({ user: updated });
  return updated;
}

// ---------------------------------------------------------------------------
// 權限
// ---------------------------------------------------------------------------

export const isSignedIn = () => store.isSignedIn();
export const isAdmin = () => store.isAdmin();

function requireSignedIn() {
  if (!store.isSignedIn()) throw appError('SESSION_EXPIRED', '請先登入後再繼續。');
}

/**
 * 前端的管理員檢查。
 *
 * 這是使用者體驗，不是安全機制——實際的存取邊界由資料庫 RLS 執行
 * （憲章原則 VI）。繞過這個檢查也拿不到別人的資料。
 */
export function requireAdmin() {
  requireSignedIn();
  if (!store.isAdmin()) throw appError('FORBIDDEN', '此頁面僅限管理員存取。');
}
