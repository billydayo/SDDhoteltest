-- Sunny 訂房平台 — Supabase schema
--
-- 於 Supabase Dashboard → SQL Editor 貼上執行。本檔案可重複執行（idempotent）。
-- 對應文件：specs/001-booking-site/data-model.md
--
-- 前置設定（Dashboard 手動一次性）：
--   1. Authentication → Providers → Email → 關閉 "Confirm email"
--      （本專案不寄送任何郵件，註冊後帳號需立即可用）
--   2. Authentication → Providers → Google → 啟用，填入 Google Cloud 的
--      OAuth Client ID / Secret，並將 Supabase 的 callback URL 加入 Google 的
--      Authorized redirect URIs
--
-- 重要：本 schema 不存在任何密碼欄位。密碼一律由 Supabase Auth 保管。
--
-- 本 schema 刻意不使用 Edge Function、Database Webhook 或 pg_cron。
-- 逾期訂單改以 expire_stale_orders() 於查詢時判定（憲章原則 II）。

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- btree_gist 讓 uuid 的 `=` 能與 daterange 的 `&&` 併用於排除約束。
-- 若 SQL Editor 回報找不到 operator class，先執行：set search_path = public, extensions;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- profiles — 應用層的使用者資料（1:1 對應 auth.users）
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  display_name text not null default '',
  phone text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  '使用者的應用層資料。認證與密碼由 auth.users 管理，此表不含任何密碼欄位。';

-- 註冊時自動建立 profile（security definer 以繞過 RLS）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 管理員判定。security definer 讓它讀 profiles 時不觸發 RLS，
-- 避免 profiles 的政策引用 profiles 造成無限遞迴。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 一般使用者不得自行升級角色。
--
-- `auth.uid() is null` 代表這不是來自瀏覽器的請求，而是 SQL Editor、migration
-- 或 service_role 等特權情境——第一個管理員只能在這種情境下產生（bootstrap）。
-- 放行它是安全的：匿名的 PostgREST 請求雖然 auth.uid() 也是 null，但 anon 角色
-- 對 profiles 根本沒有 UPDATE 權限（見下方 grants），在觸發本 trigger 之前就已被擋下。
--
-- 少了這個條件，schema 會陷入無解的死結：沒有管理員 → 沒人能升權 → 永遠沒有管理員。
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception '僅管理員可變更角色' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  max_guests integer not null check (max_guests > 0),
  nightly_price integer not null check (nightly_price > 0),
  images jsonb not null default '[]'::jsonb,
  amenities jsonb not null default '[]'::jsonb,   -- 陽台、浴缸、免費 Wi-Fi…（可篩選）
  features jsonb not null default '[]'::jsonb,    -- 房型特色：親子友善、無障礙…（可篩選）
  description text not null default '',
  status text not null default 'available' check (status in ('available', 'booked', 'maintenance')),
  average_rating numeric(3,2),  -- null = 尚無評分（不可用 0 表示）
  created_at timestamptz not null default now()
);

comment on column public.rooms.average_rating is
  '由通過審核的評論導出。無評論時為 null，前台顯示「尚無評分」而非 0 分。';

-- ---------------------------------------------------------------------------
-- system_settings — 可由管理員調整的營運參數
-- ---------------------------------------------------------------------------

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value) values
  ('pending_payment_minutes', '60'::jsonb)
on conflict (key) do nothing;

comment on table public.system_settings is
  '營運參數。pending_payment_minutes 允許範圍 5–1440，於應用層與下方 CHECK 共同把關。';

alter table public.system_settings drop constraint if exists settings_valid_range;
alter table public.system_settings add constraint settings_valid_range check (
  key <> 'pending_payment_minutes'
  or ((value)::int between 5 and 1440)
);

-- 取得目前的保留分鐘數，供 orders.expires_at 預設值使用
create or replace function public.pending_payment_minutes()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value)::int from public.system_settings
                   where key = 'pending_payment_minutes'), 60);
$$;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create sequence if not exists public.order_no_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique
    default 'SN' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD')
            || lpad(nextval('public.order_no_seq')::text, 4, '0'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  check_in date not null,
  check_out date not null,
  nights integer not null check (nights > 0),
  guest_count integer not null check (guest_count > 0),
  contact_name text not null,
  phone text not null,
  email text not null,
  payment_method text not null check (payment_method in ('LINE Pay', 'credit-card', 'bank-transfer')),
  total_amount integer not null check (total_amount >= 0),
  status text not null default 'pending-payment'
    check (status in ('pending-payment', 'confirmed', 'refund-pending', 'refunded', 'cancelled', 'completed')),
  expires_at timestamptz not null
    default now() + make_interval(mins => public.pending_payment_minutes()),
  cancel_reason text,
  created_at timestamptz not null default now(),
  constraint valid_date_range check (check_out > check_in),
  constraint nights_matches_dates check (nights = check_out - check_in)
);

-- 同一房源同一晚不得有兩筆有效訂單。
-- 半開區間 '[)' 讓「前一筆退房日 = 後一筆入住日」不算重疊，與憲章原則 IV 一致。
-- 待付款訂單同樣佔用房況（憲章原則 IV）；已退款／已取消的訂單釋出該區間。
alter table public.orders drop constraint if exists orders_no_overlap;
alter table public.orders add constraint orders_no_overlap
  exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('pending-payment', 'confirmed', 'refund-pending'));

-- 會員的狀態轉換守門。
--
-- RLS 的 WITH CHECK 只看得到新資料列，無法比對舊狀態，因此「不得對已逾期的訂單
-- 付款」「不得從任意狀態跳到已確認」這類規則必須由 trigger 執行。
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;                       -- 管理員可自由變更狀態
  end if;

  if new.status is distinct from old.status then
    -- 付款：僅允許 待付款 → 已確認，且必須尚未逾期
    if new.status = 'confirmed' then
      if old.status <> 'pending-payment' then
        raise exception '只有待付款的訂單可以完成付款' using errcode = '42501';
      end if;
      if old.expires_at < now() then
        raise exception '訂單已逾期取消，無法付款' using errcode = '42501';
      end if;
    -- 申請退款：僅允許 已確認 → 退款審核中
    elsif new.status = 'refund-pending' then
      if old.status <> 'confirmed' then
        raise exception '只有已確認的訂單可以申請退款' using errcode = '42501';
      end if;
    -- 逾期自動取消：expire_stale_orders() 由任何登入者觸發，須放行
    elsif new.status = 'cancelled'
          and old.status = 'pending-payment'
          and old.expires_at < now()
          and new.cancel_reason = 'payment-timeout' then
      return new;
    else
      raise exception '不允許的訂單狀態變更' using errcode = '42501';
    end if;
  end if;

  -- 會員不得改動金額、日期與保留期限
  if new.total_amount is distinct from old.total_amount
     or new.check_in is distinct from old.check_in
     or new.check_out is distinct from old.check_out
     or new.expires_at is distinct from old.expires_at then
    raise exception '不允許變更訂單的金額、日期或保留期限' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard_transition on public.orders;
create trigger orders_guard_transition
  before update on public.orders
  for each row execute function public.guard_order_transition();

-- 逾期未付款的訂單自動取消並釋出房況。
--
-- 因為待付款訂單會佔用排除約束，過期訂單若不清理會永久擋房。本函式必須在
-- (1) 查詢房況 (2) 建立訂單 (3) 讀取訂單列表 之前被呼叫。
-- 憲章原則 II 禁止排程作業，因此改採「查詢時判定」。
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.orders
  set status = 'cancelled',
      cancel_reason = 'payment-timeout'
  where status = 'pending-payment'
    and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  category text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- 規則式自動審核的初判。非 AI 服務——見憲章原則 VI「模擬的外部整合」。
  auto_verdict text check (auto_verdict in ('auto-pass', 'auto-reject')),
  auto_rules jsonb not null default '[]'::jsonb,   -- 觸發的規則代碼，供管理員複核
  admin_note text,
  created_at timestamptz not null default now()
);

-- 通過審核的評論變動時重算房源平均評分
create or replace function public.refresh_room_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room uuid := coalesce(new.room_id, old.room_id);
begin
  update public.rooms r
  set average_rating = (
    select round(avg(rating)::numeric, 1)
    from public.reviews
    where room_id = target_room and status = 'approved'
  )
  where r.id = target_room;
  return null;
end;
$$;

drop trigger if exists reviews_refresh_rating on public.reviews;
create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_room_rating();

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  amount integer not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- 同一訂單同時僅能有一筆審核中的申請；駁回後可再次提出
create unique index if not exists refunds_one_pending_per_order
  on public.refunds (order_id) where status = 'pending';

-- 單一會員的退款申請上限。
--
-- 只計「審核中」與「已核准」，**被駁回的不佔額度**。這是必要的界定：
-- FR-039 明訂駁回後會員可再次申請，若駁回也計入上限，被駁回 5 次的人
-- 就再也不能申請任何退款，兩條規則會互相矛盾。
--
-- 以 trigger 而非 CHECK 實作，因為約束需要跨列聚合，CHECK 做不到。
create or replace function public.enforce_refund_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
  max_allowed constant int := 5;
begin
  if new.status not in ('pending', 'approved') then
    return new;
  end if;

  select count(*) into used
  from public.refunds
  where user_id = new.user_id
    and status in ('pending', 'approved')
    and (tg_op = 'INSERT' or id <> new.id);

  if used >= max_allowed then
    raise exception '退款申請已達上限 % 筆', max_allowed using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists refunds_enforce_limit on public.refunds;
create trigger refunds_enforce_limit
  before insert or update on public.refunds
  for each row execute function public.enforce_refund_limit();

-- ---------------------------------------------------------------------------
-- site_content — 全站單筆
-- ---------------------------------------------------------------------------

create table if not exists public.site_content (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  hero_title text not null default 'Sunny 訂房平台',
  hero_subtitle text not null default '舒適住宿，安心入住',
  hero_image text not null default '',
  updated_at timestamptz not null default now(),
  constraint site_content_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

insert into public.site_content (id) values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- favorites — 會員收藏房源
-- ---------------------------------------------------------------------------

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

-- ---------------------------------------------------------------------------
-- room_risk_checks — 管理員對自家房源的品質檢測
--
-- 注意：前台使用者於「安全檢測」自行上傳的照片絕不寫入此表，也絕不上傳至
-- Storage。那是使用者的私人照片，全程留在瀏覽器內（憲章原則 VI）。
-- 此表僅存放管理員對飯店自有房間所做的檢測，其圖片會公開於房源詳情頁。
-- ---------------------------------------------------------------------------

create table if not exists public.room_risk_checks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  brightness integer not null check (brightness between 0 and 100),
  clutter integer not null check (clutter between 0 and 100),
  contrast integer not null check (contrast between 0 and 100),
  risk_score integer not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  image_path text not null,
  checked_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- channel_prices — 渠道比價（模擬資料）
--
-- ⚠️ 此表的資料為示範用種子資料。系統不爬取任何網站，也不呼叫任何 OTA 的 API
--    （憲章原則 II 與 VI）。
-- ---------------------------------------------------------------------------

create table if not exists public.channel_prices (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  channel text not null,
  channel_price integer not null check (channel_price > 0),
  captured_at timestamptz not null default now(),
  resolved boolean not null default false
);

comment on table public.channel_prices is
  '模擬的外部平台售價。非真實爬取結果，僅供展示賤賣預警流程。';

-- ---------------------------------------------------------------------------
-- admin_logs — 管理員操作稽核日誌（僅可新增）
-- ---------------------------------------------------------------------------

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_table text not null,
  target_id text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_logs is
  '僅可新增。刻意不提供 UPDATE/DELETE 政策——任何角色（含管理員）都不得竄改稽核紀錄。';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_rooms_type on public.rooms(type);
create index if not exists idx_rooms_status on public.rooms(status);
create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_room on public.orders(room_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_dates on public.orders(check_in, check_out);
create index if not exists idx_reviews_room on public.reviews(room_id);
create index if not exists idx_reviews_status on public.reviews(status);
create index if not exists idx_reviews_user on public.reviews(user_id);
create index if not exists idx_refunds_status on public.refunds(status);
create index if not exists idx_refunds_user on public.refunds(user_id);
create index if not exists idx_orders_expiry on public.orders(expires_at)
  where status = 'pending-payment';
create index if not exists idx_favorites_room on public.favorites(room_id);
create index if not exists idx_risk_checks_room on public.room_risk_checks(room_id, created_at desc);
create index if not exists idx_channel_prices_room on public.channel_prices(room_id);
create index if not exists idx_channel_prices_unresolved on public.channel_prices(resolved)
  where resolved = false;
create index if not exists idx_admin_logs_time on public.admin_logs(created_at desc);
create index if not exists idx_admin_logs_actor on public.admin_logs(actor_id);
-- 設施與房型特色的 AND 篩選（jsonb 包含運算子 @>）
create index if not exists idx_rooms_amenities on public.rooms using gin (amenities);
create index if not exists idx_rooms_features on public.rooms using gin (features);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- 憲章 v2.3.0：public schema 下每張表都必須啟用 RLS 並具備明確政策。
-- 沒有政策的資料表視為未完成。
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.rooms            enable row level security;
alter table public.orders           enable row level security;
alter table public.reviews          enable row level security;
alter table public.refunds          enable row level security;
alter table public.site_content     enable row level security;
alter table public.favorites        enable row level security;
alter table public.room_risk_checks enable row level security;
alter table public.channel_prices   enable row level security;
alter table public.admin_logs       enable row level security;
alter table public.system_settings  enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- 註：role 欄位的保護由 profiles_guard_role trigger 負責，RLS 無法限制單一欄位。

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- rooms ---------------------------------------------------------------------
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to anon, authenticated
  using (true);

drop policy if exists rooms_write on public.rooms;
create policy rooms_write on public.rooms
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- orders --------------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending-payment');

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    -- 會員僅能：完成付款（待付款 → 已確認），或申請退款（已確認 → 退款審核中）
    or (user_id = auth.uid() and status in ('confirmed', 'refund-pending'))
  );

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete to authenticated
  using (public.is_admin());

-- reviews -------------------------------------------------------------------
drop policy if exists reviews_select_public on public.reviews;
create policy reviews_select_public on public.reviews
  for select to anon, authenticated
  using (status = 'approved');

drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    -- 只能評論自己的、且退房日已過的訂單
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.check_out <= (now() at time zone 'Asia/Taipei')::date
    )
  );

drop policy if exists reviews_moderate on public.reviews;
create policy reviews_moderate on public.reviews
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete on public.reviews
  for delete to authenticated
  using (public.is_admin());

-- refunds -------------------------------------------------------------------
drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists refunds_insert on public.refunds;
create policy refunds_insert on public.refunds
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.status = 'confirmed'
        and o.check_in > (now() at time zone 'Asia/Taipei')::date
    )
  );

drop policy if exists refunds_moderate on public.refunds;
create policy refunds_moderate on public.refunds
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists refunds_delete on public.refunds;
create policy refunds_delete on public.refunds
  for delete to authenticated
  using (public.is_admin());

-- site_content --------------------------------------------------------------
drop policy if exists site_content_select on public.site_content;
create policy site_content_select on public.site_content
  for select to anon, authenticated
  using (true);

drop policy if exists site_content_update on public.site_content;
create policy site_content_update on public.site_content
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- favorites -----------------------------------------------------------------
drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists favorites_insert on public.favorites;
create policy favorites_insert on public.favorites
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists favorites_delete on public.favorites;
create policy favorites_delete on public.favorites
  for delete to authenticated
  using (user_id = auth.uid());
-- 刻意不提供 UPDATE 政策：收藏沒有可更新的欄位。

-- room_risk_checks ----------------------------------------------------------
drop policy if exists risk_checks_select on public.room_risk_checks;
create policy risk_checks_select on public.room_risk_checks
  for select to anon, authenticated
  using (true);

drop policy if exists risk_checks_write on public.room_risk_checks;
create policy risk_checks_write on public.room_risk_checks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin() and checked_by = auth.uid());

-- channel_prices ------------------------------------------------------------
drop policy if exists channel_prices_admin on public.channel_prices;
create policy channel_prices_admin on public.channel_prices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admin_logs ----------------------------------------------------------------
drop policy if exists admin_logs_select on public.admin_logs;
create policy admin_logs_select on public.admin_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists admin_logs_insert on public.admin_logs;
create policy admin_logs_insert on public.admin_logs
  for insert to authenticated
  with check (public.is_admin() and actor_id = auth.uid());

-- 刻意不提供 UPDATE / DELETE 政策。RLS 預設拒絕，因此任何角色（含管理員）
-- 都無法竄改既有稽核紀錄。這不是遺漏——見憲章「稽核日誌」條。
-- 額外以 REVOKE 收回表層權限，讓意圖更明確。
revoke update, delete on public.admin_logs from authenticated;

-- system_settings -----------------------------------------------------------
drop policy if exists settings_select on public.system_settings;
create policy settings_select on public.system_settings
  for select to anon, authenticated
  using (true);   -- 前端需知道保留分鐘數才能顯示倒數

drop policy if exists settings_update on public.system_settings;
create policy settings_update on public.system_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage：房源品質檢測圖
--
-- 公開讀取（圖片會顯示在房源詳情頁），僅管理員可寫入。
-- 前台使用者的安全檢測照片絕不進入此 bucket。
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('room-risk', 'room-risk', true)
on conflict (id) do update set public = true;

drop policy if exists room_risk_read on storage.objects;
create policy room_risk_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'room-risk');

drop policy if exists room_risk_write on storage.objects;
create policy room_risk_write on storage.objects
  for all to authenticated
  using (bucket_id = 'room-risk' and public.is_admin())
  with check (bucket_id = 'room-risk' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage：房源展示照片
--
-- 公開讀取（照片會顯示在房源列表與詳情頁），僅管理員可寫入。
-- 與 room-risk 分開是因為兩者的生命週期不同：檢測圖每次重測就整批替換，
-- 展示照片則由管理員逐張增刪。混在同一個 bucket 會讓清理邏輯互相干擾。
--
-- ⚠️ 前台使用者的安全檢測照片同樣不得進入此 bucket。
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true)
on conflict (id) do update set public = true;

drop policy if exists room_photos_read on storage.objects;
create policy room_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'room-photos');

drop policy if exists room_photos_write on storage.objects;
create policy room_photos_write on storage.objects
  for all to authenticated
  using (bucket_id = 'room-photos' and public.is_admin())
  with check (bucket_id = 'room-photos' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants（RLS 之上仍需表層權限）
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on
  public.rooms, public.reviews, public.site_content,
  public.room_risk_checks, public.system_settings
  to anon;
grant select, insert, update, delete on
  public.profiles, public.rooms, public.orders, public.reviews,
  public.refunds, public.site_content, public.favorites,
  public.room_risk_checks, public.channel_prices
  to authenticated;
grant select, update on public.system_settings to authenticated;
grant select, insert on public.admin_logs to authenticated;   -- 不給 update/delete
grant usage, select on sequence public.order_no_seq to authenticated;
grant execute on function public.expire_stale_orders() to anon, authenticated;
grant execute on function public.pending_payment_minutes() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 建立示範帳號
--
-- 帳號本身可由應用程式的註冊頁自行建立（handle_new_user trigger 會自動產生
-- 對應的 profiles 資料列，預設角色為 member）。
--
-- 但**第一個管理員只能在此處產生**——應用程式內沒有任何路徑能把自己升權，
-- 那正是 prevent_role_escalation trigger 的用意。
--
-- 完整步驟見 supabase/bootstrap-admin.sql。
-- ---------------------------------------------------------------------------

-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@sunny.com');
