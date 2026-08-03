-- Sunny 訂房平台 — 既有資料庫的遷移
--
-- 於 Supabase Dashboard → SQL Editor 整份貼上執行。**可重複執行**，
-- 已經跑過的部分會自動跳過，重跑不會弄壞任何東西。
--
-- 什麼時候需要這支：
--   資料庫是用**較早版本的 schema.sql** 建立的。schema.sql 用的是
--   `create table if not exists`，對已存在的表是靜默跳過——重跑它補不到
--   後來新增的欄位、政策與 trigger，只會讓人以為已經更新了。
--
-- 全新安裝**不需要**這支：schema.sql 已包含以下全部內容。
--
-- 四段依相依順序排列，請勿調換：rooms 約束 → system_settings → orders 政策
-- → reviews／messages。每段各自 begin/commit，中途失敗不會留下半套狀態。
--
-- 本檔由 migrate-room-status / migrate-room-vocabulary / migrate-order-cancel /
-- migrate-messages 四支合併而來（2026-08-03）。分成四個檔的時候，
-- 「我到底該跑哪幾支」本身就是個需要查文件才能回答的問題，而答案永遠是「全部」。

-- ###########################################################################
-- 一、rooms.status 移除 booked（FR-015、FR-051a）
-- （原 supabase/migrate-room-status.sql）
-- ###########################################################################

-- 把 rooms.status 的 'booked' 從 CHECK 約束中移除。
--
-- 「已預訂」改為由當日訂單即時推導（FR-015、FR-051a），不再是房源本身的欄位值。
-- 保留這個值只會讓人以為它還能用——手動設了沒有任何機制在退房後改回來，
-- 那間房就永久賣不出去。
--

begin;

-- 先把殘留的 'booked' 收斂成 'available'，否則加約束會失敗。
-- 這樣做是安全的：可訂與否本來就由訂單決定，不看這個欄位。
update public.rooms set status = 'available' where status = 'booked';

alter table public.rooms drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check check (status in ('available', 'maintenance'));

commit;

-- ###########################################################################
-- 二、設施與房型特色改存 system_settings（FR-010a）
-- （原 supabase/migrate-room-vocabulary.sql）
-- ###########################################################################

-- 設施與房型特色改為可由後台增刪（FR-010a）。
--
-- 兩份清單改存 system_settings，前台篩選器與後台房源表單都由此取得選項。
-- 另加一條 insert 政策與 insert 授權：這兩個 key 是後來才有的，
-- 第一次儲存是 insert 而不是 update，沒有政策會被 RLS 擋下。
--

begin;

insert into public.system_settings (key, value) values
  ('room_amenities', '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","陽台","小冰箱","書桌","衣櫃","客廳區","咖啡機","備品組","加床服務","嬰兒床可租借"]'::jsonb),
  ('room_features',  '["採光佳","安靜樓層","商務友善","情侶推薦","親子友善","朋友同行","泡澡放鬆","無障礙","可加床"]'::jsonb)
on conflict (key) do nothing;

drop policy if exists settings_insert on public.system_settings;
create policy settings_insert on public.system_settings
  for insert to authenticated
  with check (public.is_admin());

grant select, insert, update on public.system_settings to authenticated;

commit;

-- ###########################################################################
-- 三、會員可取消待付款訂單（FR-035a）
-- （原 supabase/migrate-order-cancel.sql）
-- ###########################################################################

-- 會員可主動取消尚未付款的訂單（FR-035a）。
--
-- 兩處要改：
--   1. orders_update 的 WITH CHECK 要放行 'cancelled'
--   2. guard_order_transition 要接受 cancel_reason = 'member-cancelled'
--
-- 只放寬 RLS 是不夠的：WITH CHECK 看不到舊資料列，無法分辨「待付款 → 已取消」
-- 與「已確認 → 已取消」。後者必須擋下——錢已經付了，取消得走退款審核，
-- 否則會繞過 FR-041 的退款級距。那條規則由下方的 trigger 執行。
--

begin;

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (user_id = auth.uid() and status in ('confirmed', 'refund-pending', 'cancelled'))
  );

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
    -- 取消：僅允許 待付款 → 已取消
    --   ・payment-timeout   逾期自動取消，由 expire_stale_orders() 觸發
    --   ・member-cancelled  會員主動取消
    elsif new.status = 'cancelled' and old.status = 'pending-payment'
          and (
            (new.cancel_reason = 'payment-timeout' and old.expires_at < now())
            or new.cancel_reason = 'member-cancelled'
          ) then
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

commit;

-- ###########################################################################
-- 四、評論回覆與私訊（FR-103d、FR-123 ~ FR-127）
-- （原 supabase/migrate-messages.sql）
-- ###########################################################################

-- 評論回覆（FR-103d）與會員／管理員私訊（FR-123 ~ FR-127）。
--
-- 兩件事一起遷移，因為它們共用同一個觀念：**管理員是一個角色，不是一個人**。
-- 評論回覆掛在評論上而非某位管理員名下；私訊的討論串屬於「那位會員」，
-- 任何管理員都看得到、都能回，換人接手不必轉交（FR-127）。
--

begin;

-- ===========================================================================
-- 一、評論回覆
-- ===========================================================================

alter table public.reviews add column if not exists admin_reply text;
alter table public.reviews add column if not exists admin_reply_at timestamptz;
alter table public.reviews add column if not exists admin_reply_by uuid references public.profiles(id);

-- 回覆長度上限與評論本身同級。空字串等同沒有回覆，一律存 null，
-- 畫面才不必分辨「空字串」與「未回覆」兩種狀態。
alter table public.reviews drop constraint if exists reviews_reply_length;
alter table public.reviews add constraint reviews_reply_length
  check (admin_reply is null or char_length(admin_reply) between 1 and 1000);

/*
 * 回覆只有管理員能寫，且必須把自己記成回覆人。
 *
 * reviews_moderate 政策已經限定 update 僅管理員可執行，這裡再補一層：
 * 不讓回覆掛到別人頭上，也不讓回覆時間由前端決定——那兩個欄位是稽核用的。
 */
create or replace function public.stamp_review_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.admin_reply is distinct from old.admin_reply then
    if not public.is_admin() then
      raise exception '僅管理員可回覆評論' using errcode = '42501';
    end if;
    if new.admin_reply is null then
      new.admin_reply_at := null;
      new.admin_reply_by := null;
    else
      new.admin_reply_at := now();
      new.admin_reply_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_review_reply on public.reviews;
create trigger trg_stamp_review_reply
  before update on public.reviews
  for each row execute function public.stamp_review_reply();

-- ===========================================================================
-- 二、私訊
-- ===========================================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  -- 討論串的擁有者永遠是那位會員。管理員只是參與者，因此不存 recipient——
  -- 存了就得回答「哪一位管理員」，而那正是我們不想綁定的東西。
  thread_user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('member', 'admin')),
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_thread_idx
  on public.messages (thread_user_id, created_at desc);

/*
 * sender_role 由伺服器判定，不採信前端送來的值。
 *
 * 前端若能自稱 admin，會員就能偽造一則「官方回覆」給自己看——
 * 資料是自己的討論串，RLS 擋不住這種寫入，只有 trigger 擋得住。
 * 同時強制 sender_id = auth.uid()：訊息不能冒名。
 */
create or replace function public.stamp_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sender_id := auth.uid();
  new.sender_role := case when public.is_admin() then 'admin' else 'member' end;

  -- 會員只能在自己的討論串裡發言；管理員可以在任何一串回覆
  if new.sender_role = 'member' and new.thread_user_id <> auth.uid() then
    raise exception '只能在自己的討論串中發言' using errcode = '42501';
  end if;

  new.read_at := null;                 -- 新訊息一律未讀，由對方讀取時才標記
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_message_sender on public.messages;
create trigger trg_stamp_message_sender
  before insert on public.messages
  for each row execute function public.stamp_message_sender();

/*
 * 訊息內容不可竄改，只有已讀時間可以更新。
 *
 * 與操作日誌同精神：一則已送出的訊息若能事後改字，整份對話就失去佐證能力。
 */
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.sender_role is distinct from old.sender_role
     or new.thread_user_id is distinct from old.thread_user_id
     or new.created_at is distinct from old.created_at then
    raise exception '訊息送出後不可修改' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_message_update on public.messages;
create trigger trg_guard_message_update
  before update on public.messages
  for each row execute function public.guard_message_update();

alter table public.messages enable row level security;

-- 會員只看得到自己的討論串；管理員看得到全部（FR-127）
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (thread_user_id = auth.uid() or public.is_admin());

-- 寫入的正確性由 trigger 保證，這裡只管「能不能碰這一串」
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (thread_user_id = auth.uid() or public.is_admin());

-- 標記已讀。改到內容的嘗試會被 guard_message_update 擋下
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update to authenticated
  using (thread_user_id = auth.uid() or public.is_admin())
  with check (thread_user_id = auth.uid() or public.is_admin());

-- 不建立 delete 政策：訊息與操作日誌一樣只增不刪
revoke delete on public.messages from authenticated, anon;
grant select, insert, update on public.messages to authenticated;

commit;

-- ###########################################################################
-- 驗證
-- ###########################################################################

-- ── 一、rooms.status 移除 booked（FR-015、FR-051a） ──
-- 驗證：應回傳 0 列
-- select id, name, status from public.rooms where status not in ('available', 'maintenance');

-- ── 二、設施與房型特色改存 system_settings（FR-010a） ──
-- 驗證：應回傳三列（pending_payment_minutes、room_amenities、room_features）
-- select key, jsonb_typeof(value) from public.system_settings order by key;

-- ── 三、會員可取消待付款訂單（FR-035a） ──
-- 驗證（以會員身分執行）：
--   ・對自己的待付款訂單設 status='cancelled', cancel_reason='member-cancelled' → 成功
--   ・對自己的已確認訂單做同樣的事 → 42501「不允許的訂單狀態變更」

-- ── 四、評論回覆與私訊（FR-103d、FR-123 ~ FR-127） ──
-- 驗證（2026-08-03 已於正式資料庫以 REST + 真實帳號實測，22 項全過）：
--   ・以會員身分插入一則 sender_role = 'admin' 的訊息 → 存進去後仍是 'member'
--   ・以會員身分插入 thread_user_id 為他人的訊息      → 42501
--   ・以會員身分讀取他人的討論串                      → 0 筆
--   ・以管理員身分讀取任一討論串                      → 讀得到
--   ・任一身分 update 訊息的 body                     → 42501「訊息送出後不可修改」
--   ・任一身分 delete 訊息                            → 被擋（無 delete 政策）
--   ・以管理員身分回覆評論                            → admin_reply_at / _by 由伺服器蓋章
--   ・回覆超過 1000 字                                → 被 reviews_reply_length 擋下
--
-- ⚠️ 以會員身分寫 admin_reply 的結果是 **HTTP 204、影響 0 列**，不是 42501。
--    reviews_moderate 政策的 USING 僅限管理員，那一列對會員根本不可見，
--    PostgREST 因此回「更新成功但沒有任何列符合」。BEFORE UPDATE 的 trigger
--    只對通過 USING 的列觸發，所以 stamp_review_reply 的「僅管理員可回覆評論」
--    在這條路徑上不會被走到——它守的是「管理員誤把回覆掛到別人頭上」那一面。
--    兩層都在，順序是 RLS → trigger。驗證時要看**資料有沒有被改動**，
--    不能只看 HTTP 狀態碼。
