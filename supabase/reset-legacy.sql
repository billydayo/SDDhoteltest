-- Sunny 訂房平台 — 清除舊版 schema，為 Alembic 初始 revision 準備乾淨的 public schema
--
-- ⚠️ 這個腳本會刪除資料，且無法復原。
--
-- ============================================================================
-- 2026-08-04 改版說明
-- ============================================================================
-- 本檔原為「舊 schema.sql → 新 schema.sql」的過渡工具。憲章 v3.0.0 更換技術堆疊後，
-- 它的用途改為：**把既有的 Supabase 專案清成乾淨狀態，讓 Alembic 的初始 revision
-- （backend/alembic/versions/0001_initial.py）能在其上從零建立全部結構。**
--
-- 原版寫於 2026-07-31，之後專案又長出東西，因此漏掉：
--   - public.messages 表（2026-08-03 新增的會員訊息模組）
--   - enforce_refund_limit()、guard_message_update()
--   - stamp_review_reply()、stamp_message_sender()
-- 漏掉的表會讓初始 revision 撞上 `relation already exists`；漏掉的函式會以舊定義
-- 殘留，而後兩者引用了隨 Supabase Auth 一併消失的 auth.uid()。本次一併補齊。
--
-- ============================================================================
-- 執行順序（新架構）
-- ============================================================================
--   1. reset-legacy.sql   ← 本檔，於 Supabase SQL Editor 執行
--   2. cd backend && uv run alembic upgrade head
--   3. cd backend && uv run python -m sunny.seed
--
-- schema.sql / migrations.sql / seed*.sql 為舊架構產物，於過渡期保留供比對，
-- 將由 T183 一併移除。**不要**再執行它們——它們會建立 38 條引用 auth.uid()
-- 的 RLS 政策，而新架構的授權邊界在 FastAPI。
--
-- ============================================================================
-- 執行前的確認
-- ============================================================================
-- 確認這些表沒有你要保留的資料：
--   select
--     (select count(*) from public.orders)   as orders,
--     (select count(*) from public.reviews)  as reviews,
--     (select count(*) from public.refunds)  as refunds,
--     (select count(*) from public.rooms)    as rooms,
--     (select count(*) from public.messages) as messages;
--
-- 列出目前 public schema 下的全部資料表，確認沒有本檔未涵蓋的殘留：
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;

begin;

-- ---------------------------------------------------------------------------
-- 資料表：依相依順序刪除。cascade 會一併移除外鍵、索引、觸發器與 RLS 政策。
-- ---------------------------------------------------------------------------
drop table if exists public.messages          cascade;
drop table if exists public.refunds           cascade;
drop table if exists public.reviews           cascade;
drop table if exists public.orders            cascade;
drop table if exists public.room_risk_checks  cascade;
drop table if exists public.channel_prices    cascade;
drop table if exists public.favorites         cascade;
drop table if exists public.rooms             cascade;
drop table if exists public.admin_logs        cascade;
drop table if exists public.site_content      cascade;
drop table if exists public.system_settings   cascade;
drop table if exists public.profiles          cascade;

-- 2026-07-31 之前的版本特有：明文密碼且無 RLS 的使用者表。
drop table if exists public.users             cascade;

-- ---------------------------------------------------------------------------
-- 觸發器：掛在 auth schema 上的那一個必須明確刪除。
-- drop table ... cascade 只會清掉掛在 public 資料表上的觸發器，碰不到這一個。
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

-- ---------------------------------------------------------------------------
-- 函式：全部 11 個。
--
-- 其中 5 個（pending_payment_minutes、expire_stale_orders、refresh_room_rating、
-- enforce_refund_limit、guard_message_update）是純 PostgreSQL、不依賴 auth，
-- 新架構會保留它們——但**仍要在此刪除**，改由初始 revision 重新建立，
-- 這樣結構的唯一事實來源才是 Alembic 的遷移歷程（憲章資料庫約束「事實來源」條）。
-- 留著舊定義等於維持一份沒人維護的平行副本。
-- ---------------------------------------------------------------------------
drop function if exists public.handle_new_user()          cascade;
drop function if exists public.is_admin()                 cascade;
drop function if exists public.prevent_role_escalation()  cascade;
drop function if exists public.guard_order_transition()   cascade;
drop function if exists public.expire_stale_orders()      cascade;
drop function if exists public.pending_payment_minutes()  cascade;
drop function if exists public.refresh_room_rating()      cascade;
drop function if exists public.enforce_refund_limit()     cascade;
drop function if exists public.guard_message_update()     cascade;
drop function if exists public.stamp_review_reply()       cascade;
drop function if exists public.stamp_message_sender()     cascade;

-- ---------------------------------------------------------------------------
-- 序列
-- ---------------------------------------------------------------------------
drop sequence if exists public.order_no_seq;

-- ---------------------------------------------------------------------------
-- Alembic 的版本表（若曾跑過初始 revision 後又要重來）
-- ---------------------------------------------------------------------------
drop table if exists public.alembic_version;

commit;

-- ============================================================================
-- 執行後的檢查
-- ============================================================================
-- 資料表應為 0 列。有殘留就是本檔漏了東西，補上再跑一次。
--
--   select table_name from information_schema.tables
--   where table_schema = 'public';
--
-- ⚠️ 函式**不能**直接數 information_schema.routines——btree_gist 擴充若裝在
-- public schema，它自己就有約 188 個函式與運算子，數出來會嚇一跳但完全正常。
-- 要只看「應用程式的」函式，用下面這個查詢排除擴充所擁有的物件，應為 0 列：
--
--   select p.proname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
--   where n.nspname = 'public' and d.objid is null;
--
-- （2026-08-04 實跑修正：原本寫「兩個查詢都該回傳 0 列」是錯的，會讓正常的
--   btree_gist 安裝被誤判為重置失敗。）

-- ============================================================================
-- 本腳本**不會**處理的兩件事
-- ============================================================================
-- 1. auth.users 底下的帳號與 storage bucket 不受影響。
--    新架構不再使用 Supabase Auth——身分改由 public.profiles 自行保管
--    （email + argon2id 密碼雜湊）。auth.users 中的舊帳號成為無用資料，
--    刪不刪都不影響新系統運作。示範帳號由 seed.py 重新建立並計算雜湊。
--
-- 2. **PostgREST 的存取路徑。** 這一項由初始 revision 的 T019a 處理，見下方說明。
--
-- ⚠️ 為什麼 PostgREST 這件事很重要：
--    Supabase 對 public schema 設有
--      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--    因此 Alembic 建立的新表會**自動**繼承這組授權。舊架構靠 RLS 擋住 anon key
--    （該 key 設計上可公開，其防護來自 RLS 而非保密），而新架構要把 RLS 全數移除。
--    兩者相加的結果是：任何人拿著那把公開的 anon key，就能經由 PostgREST
--    讀寫全部十二張表——包含 profiles 與 admin_logs。
--
--    這違反憲章原則 III「資料庫 MUST 只有一個存取者：FastAPI 後端」。
--    初始 revision 會 REVOKE 掉 anon / authenticated 的權限與預設權限；
--    另請於 Dashboard → Settings → API 將 public 自 Exposed schemas 移除，
--    程式面與設定面兩道一起關上。
