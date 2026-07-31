/**
 * Sunny 訂房平台 — 執行期設定
 *
 * 本專案沒有建置步驟，因此瀏覽器讀不到 .env、process.env 或 import.meta.env。
 * 憑證一律由此檔提供（憲章「Supabase 約束・憑證設定」）。
 *
 * 兩個值留空 = 示範模式：資料存於瀏覽器 localStorage，功能完整，且不發出任何網路請求。
 * 填入值 = 資料庫模式：資料存於 Supabase，可跨裝置共用。
 *
 * 取得方式：Supabase Dashboard → Project Settings → API
 *   SUPABASE_URL      ← Project URL
 *   SUPABASE_ANON_KEY ← anon / public key
 *
 * ⚠️ 只能填 anon key。anon key 是設計上可公開的識別碼，其防護來自資料庫的
 *    Row Level Security 而非保密，因此放在前端是安全的——前提是 RLS 政策完整。
 *    service_role key 可繞過所有 RLS，絕對不可填入此檔或提交至版本控制。
 */
window.__SUNNY_CONFIG__ = {
  SUPABASE_URL: 'https://ggdwzqvimdflecpgaoml.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZHd6cXZpbWRmbGVjcGdhb21sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Mzg4NTYsImV4cCI6MjEwMTAxNDg1Nn0.5VvqsKv8hlaf6qIwLhYLgLmi-T38lzlMiUOr7Nubqls'
};
