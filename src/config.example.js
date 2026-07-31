/**
 * src/config.js 的填法範例。
 *
 * 此檔僅供參考，應用程式不會載入它。請直接編輯 src/config.js。
 */
window.__SUNNY_CONFIG__ = {
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.anon-key-only'
  // 不要在這裡加入 SUPABASE_SERVICE_ROLE_KEY。它可繞過所有 RLS 政策，
  // 一旦出現在前端就等同於把整個資料庫的寫入權限公開。
};
