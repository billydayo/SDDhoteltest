/**
 * Supabase client 的建立與模式偵測。
 *
 * 憑證只從 `window.__SUNNY_CONFIG__`（由 src/config.js 設定）讀取。
 *
 * 刻意不讀 `.env`、`process.env` 或 `import.meta.env`：本專案沒有建置步驟，
 * 這三者在直接開啟的瀏覽器中一律 undefined，寫了等同死碼，而且會讓
 * 「我填了 .env 卻還是示範模式」變成必然發生的困惑（憲章「憑證設定」條）。
 *
 * client 以動態 import 延後載入，且只在憑證存在時載入——這是示範模式能做到
 * 零網路請求的關鍵（憲章原則 II）。
 */

import { appError } from '../utils/errors.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';

function readConfig() {
  const raw = (typeof window !== 'undefined' && window.__SUNNY_CONFIG__) || {};
  return {
    url: String(raw.SUPABASE_URL ?? '').trim(),
    anonKey: String(raw.SUPABASE_ANON_KEY ?? '').trim()
  };
}

export const supabaseConfig = readConfig();

/** 兩個值都有填才算已設定。只填一個視為未設定，並於啟動時警告。 */
export const isSupabaseConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

/** 只填了一半——這幾乎一定是設定失誤，不該悄悄當成示範模式 */
export const isPartiallyConfigured =
  !isSupabaseConfigured && Boolean(supabaseConfig.url || supabaseConfig.anonKey);

export const demoMode = Object.freeze({
  enabled: !isSupabaseConfigured,
  reason: isPartiallyConfigured
    ? 'src/config.js 只填了一半的憑證，已進入示範模式。請補齊 URL 與 anon key。'
    : '未設定 Supabase 憑證，資料僅保存在此瀏覽器。'
});

let clientPromise = null;

/**
 * 取得 Supabase client。未設定憑證時回傳 null——呼叫端不應該走到這裡，
 * 因為 repository 會在啟動時就綁定 localStorage adapter。
 */
export async function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    let createClient;
    try {
      ({ createClient } = await import(/* @vite-ignore */ SUPABASE_ESM));
    } catch (err) {
      throw appError(
        'NETWORK_ERROR',
        '無法載入資料庫連線元件，請確認網路連線後重新整理頁面。',
        { cause: err }
      );
    }

    return createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,      // FR-003：關閉瀏覽器後仍保持登入
        autoRefreshToken: true,
        detectSessionInUrl: true   // Google OAuth 導回時需要
      }
    });
  })();

  return clientPromise;
}

/**
 * 啟動時驗證憑證是否有效。
 *
 * FR-084：憑證已填但無效時必須顯示明確的設定錯誤，不得表現為一般性當機，
 * 也不得悄悄退回示範模式。
 */
export async function verifyConnection() {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, code: 'DEMO' };

  const { error } = await client.from('rooms').select('id').limit(1);
  if (!error) return { ok: true };

  // 401/403 幾乎都是 URL 或 anon key 打錯
  const status = error.status ?? error.code;
  if (status === 401 || status === 403 || /Invalid API key/i.test(error.message ?? '')) {
    throw appError('CONFIG_ERROR');
  }
  throw appError('NETWORK_ERROR', undefined, { cause: error });
}
