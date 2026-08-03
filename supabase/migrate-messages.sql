-- 評論回覆（FR-103d）與會員／管理員私訊（FR-123 ~ FR-127）。
--
-- 兩件事一起遷移，因為它們共用同一個觀念：**管理員是一個角色，不是一個人**。
-- 評論回覆掛在評論上而非某位管理員名下；私訊的討論串屬於「那位會員」，
-- 任何管理員都看得到、都能回，換人接手不必轉交（FR-127）。
--
-- 對既有資料庫執行一次即可；schema.sql 已同步，全新安裝不需要跑這支。
-- 可重複執行。

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
