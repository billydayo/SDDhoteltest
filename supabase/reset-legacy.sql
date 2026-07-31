-- Sunny 訂房平台 — 清除舊版 schema
--
-- ⚠️ 這個腳本會刪除資料，且無法復原。
--
-- 什麼時候需要它：
--   專案曾執行過 2026-07-31 改版**之前**的 schema.sql（那一版有 public.users
--   明文密碼欄位、沒有 RLS，且 orders/reviews/refunds 的結構較舊）。
--
-- 為什麼不能只重跑新的 schema.sql：
--   新 schema 用的是 `create table if not exists`，遇到已存在的舊表會靜默跳過，
--   於是 orders 會缺少 email、expires_at、cancel_reason、order_no 等欄位，
--   外鍵也仍指向舊的 public.users。結果是「看起來跑成功了，實際上結構是錯的」。
--
-- 怎麼確認自己需不需要跑：
--   在 SQL Editor 執行
--     select table_name from information_schema.tables
--     where table_schema = 'public' order by table_name;
--   若看到 `users`，或看不到 `profiles`，就需要跑這個腳本。
--
-- 執行順序：
--   1. reset-legacy.sql  ← 本檔
--   2. schema.sql
--   3. seed.sql
--
-- 執行前請先確認這些表沒有你要保留的資料：
--   select
--     (select count(*) from public.orders)  as orders,
--     (select count(*) from public.reviews) as reviews,
--     (select count(*) from public.refunds) as refunds,
--     (select count(*) from public.rooms)   as rooms;

begin;

-- 依相依順序刪除。cascade 會一併移除外鍵、索引與政策。
drop table if exists public.refunds       cascade;
drop table if exists public.reviews       cascade;
drop table if exists public.orders        cascade;
drop table if exists public.rooms         cascade;
drop table if exists public.site_content  cascade;

-- 舊版特有：明文密碼且無 RLS 的使用者表。
-- 新版改由 Supabase Auth 保管密碼，應用 schema 不存在任何密碼欄位。
drop table if exists public.users         cascade;

-- 新版的表（若曾部分執行過新 schema，一併清掉以免半新半舊）
drop table if exists public.admin_logs        cascade;
drop table if exists public.channel_prices    cascade;
drop table if exists public.room_risk_checks  cascade;
drop table if exists public.favorites         cascade;
drop table if exists public.profiles          cascade;
drop table if exists public.system_settings   cascade;

-- 相依的函式與觸發器
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user()          cascade;
drop function if exists public.is_admin()                 cascade;
drop function if exists public.prevent_role_escalation()  cascade;
drop function if exists public.guard_order_transition()   cascade;
drop function if exists public.expire_stale_orders()      cascade;
drop function if exists public.pending_payment_minutes()  cascade;
drop function if exists public.refresh_room_rating()      cascade;

drop sequence if exists public.order_no_seq;

commit;

-- 注意：本腳本不會刪除 Authentication → Users 底下的帳號，也不會刪除
-- storage bucket。auth.users 中的既有帳號在重跑 schema.sql 後，
-- 不會自動獲得 profiles 資料列（trigger 只在「新註冊」時觸發）。
-- 若要保留既有帳號，請於 schema.sql 執行後補上：
--
--   insert into public.profiles (id, display_name)
--   select id, coalesce(raw_user_meta_data ->> 'display_name', split_part(email, '@', 1))
--   from auth.users
--   on conflict (id) do nothing;
--
-- 接著依 schema.sql 末端的說明把 admin@sunny.com 升為管理員。
