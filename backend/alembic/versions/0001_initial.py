"""初始 schema：12 張表、約束、索引、gist 排除約束、純 PostgreSQL 函式、應用角色與權限。

Revision ID: 0001
Revises:
Create Date: 2026-08-04

內容折自舊架構的 `supabase/schema.sql`（該檔已於全新專案實跑驗證通過），
但**不是原樣搬運**。憲章 v3.1.1 的遷移計畫逐層標明了何者保留、何者改寫：

| 層 | 處置 |
|---|---|
| 12 張表、CHECK、24 個索引 | 保留（`profiles` 取回身分欄位） |
| `EXCLUDE USING gist` 房況約束 | **原樣保留**，純 PostgreSQL |
| 38 條 RLS 政策 | **全數移除**，授權邊界移至 FastAPI |
| 5 個純 PostgreSQL 函式 | 保留 |
| `is_admin`、`prevent_role_escalation`、`handle_new_user` | **移除** |
| `guard_order_transition` | **拆解**，只留不需身分的部分 |
| `stamp_review_reply`、`stamp_message_sender` | **改寫**，操作者由後端傳入 |

**本檔全部以原生 SQL 撰寫，不倚賴 autogenerate。** autogenerate 偵測不到函式、
觸發器與排除約束，更危險的是它可能因無法辨識而產生**刪除**它們的敘述。
`orders_no_overlap` 一旦被靜默移除，超賣不會報錯，只會安靜地發生
（憲章資料庫約束、research R2）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from sunny.config import get_settings

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


APP_ROLE = "sunny_app"

TABLES = (
    "profiles",
    "rooms",
    "system_settings",
    "orders",
    "reviews",
    "refunds",
    "site_content",
    "favorites",
    "room_risk_checks",
    "channel_prices",
    "admin_logs",
    "messages",
)


def upgrade() -> None:
    # =========================================================================
    # T012 — btree_gist
    # =========================================================================
    # MUST 為整支 revision 的第一個敘述。`room_id with =` 的等值比對需要它，
    # 缺了會在建立 orders_no_overlap 時失敗（research R2）。
    op.execute("create extension if not exists btree_gist")

    # =========================================================================
    # T021a — 應用連線角色（非擁有者）
    # =========================================================================
    # 為什麼一定要有這個角色：`REVOKE UPDATE, DELETE ON admin_logs` **只對
    # 非擁有者生效**——資料表擁有者保有隱含權限。應用若以擁有者（postgres）連線，
    # 那道 REVOKE 是一句不報錯也不生效的 SQL，稽核日誌就悄悄變得可以竄改
    # （憲章資料庫約束、SC-027）。
    #
    # 密碼以 `set_config` 的**繫結參數**傳入，再由 `format(%L)` 安全引號化——
    # 直接把密碼字串拼進 DDL 會在密碼含引號時破壞語法，且會出現在伺服器日誌中。
    app_password = get_settings().db_app_password
    op.execute(
        sa.text("select set_config('sunny.app_password', :pw, true)").bindparams(pw=app_password)
    )
    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = '{APP_ROLE}') then
            execute format('alter role {APP_ROLE} login password %L',
                           current_setting('sunny.app_password'));
          else
            execute format('create role {APP_ROLE} login password %L',
                           current_setting('sunny.app_password'));
          end if;
        end $$;
        """
    )

    # =========================================================================
    # T013 — profiles（取回身分欄位）
    # =========================================================================
    # 前一版的身分資料分居兩處：auth.users（Supabase 管理，含 email 與密碼）與
    # public.profiles（應用資料）。auth.users 隨 Supabase Auth 移除後，
    # profiles MUST 取回這些欄位，成為身分的唯一來源。
    op.execute(
        """
        create table public.profiles (
          id uuid primary key default gen_random_uuid(),
          email text not null unique,
          -- 可為 null：僅以 Google 註冊的帳號沒有密碼。設為 NOT NULL 就得填入某個
          -- 假值，而那個假值遲早會被某段程式碼當成可比對的雜湊。可為 null 讓
          -- 「這個帳號沒有密碼」成為可表達的狀態（data-model.md）。
          password_hash text,
          google_sub text unique,
          role text not null default 'member' check (role in ('member', 'admin')),
          display_name text not null default '',
          phone text,
          created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "comment on column public.profiles.password_hash is "
        "'argon2id 雜湊。null = 僅第三方登入的帳號。MUST NOT 出現於任何 API 回應。'"
    )
    op.execute(
        "comment on column public.profiles.email is "
        "'唯一約束是 FR-088 的承載者：以既有 email 的 Google 帳號登入時進入同一帳號。'"
    )

    # =========================================================================
    # rooms
    # =========================================================================
    op.execute(
        """
        create table public.rooms (
          id uuid primary key default gen_random_uuid(),
          name text not null,
          type text not null,
          max_guests integer not null check (max_guests > 0),
          nightly_price integer not null check (nightly_price > 0),
          images jsonb not null default '[]'::jsonb,
          amenities jsonb not null default '[]'::jsonb,
          features jsonb not null default '[]'::jsonb,
          description text not null default '',
          -- 只保存不分日期的營運狀態。「已預訂」不在此列——它綁定日期，由當日訂單
          -- 即時推導（FR-015、FR-051a）。寫進欄位就得在退房時改回來，漏改一次
          -- 該房源就永久無法販售。
          status text not null default 'available'
            check (status in ('available', 'maintenance')),
          average_rating numeric(3,2),
          created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "comment on column public.rooms.average_rating is "
        "'由通過審核的評論導出。無評論時為 null，前台顯示「尚無評分」而非 0 分。'"
    )

    # =========================================================================
    # system_settings
    # =========================================================================
    op.execute(
        """
        create table public.system_settings (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now(),
          constraint settings_valid_range check (
            key <> 'pending_payment_minutes'
            or ((value)::int between 5 and 1440)
          )
        )
        """
    )

    # 起始參數。這**不是**示範資料——保留分鐘數是 orders.expires_at 預設值的來源，
    # 兩份詞彙表則是前台篩選器與後台房源表單的選項來源（FR-010a）。
    # 示範用的房源、訂單、評論由 seed.py 產生（T036）。
    op.execute(
        """
        insert into public.system_settings (key, value) values
          ('pending_payment_minutes', '60'::jsonb),
          ('room_amenities', '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","陽台","小冰箱","書桌","衣櫃","客廳區","咖啡機","備品組","加床服務","嬰兒床可租借"]'::jsonb),
          ('room_features',  '["採光佳","安靜樓層","商務友善","情侶推薦","親子友善","朋友同行","泡澡放鬆","無障礙","可加床"]'::jsonb)
        """  # noqa: E501
    )

    # 保留：純 PostgreSQL，不依賴身分。
    #
    # SECURITY DEFINER 已移除。舊版加它是為了在 RLS 下讀取 system_settings；
    # RLS 移除後不再需要，而留著等於給應用角色一條以擁有者權限執行的路徑
    # ——那正是 admin_logs 的 REVOKE 想擋住的東西。
    op.execute(
        """
        create function public.pending_payment_minutes()
        returns integer
        language sql
        stable
        set search_path = public, pg_catalog
        as $fn$
          select coalesce((select (value)::int from public.system_settings
                           where key = 'pending_payment_minutes'), 60);
        $fn$
        """
    )

    # =========================================================================
    # orders — 本模型的核心
    # =========================================================================
    op.execute("create sequence public.order_no_seq")
    op.execute(
        """
        create table public.orders (
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
          payment_method text not null
            check (payment_method in ('LINE Pay', 'credit-card', 'bank-transfer')),
          total_amount integer not null check (total_amount >= 0),
          status text not null default 'pending-payment'
            check (status in ('pending-payment', 'confirmed', 'refund-pending',
                              'refunded', 'cancelled', 'completed')),
          expires_at timestamptz not null
            default now() + make_interval(mins => public.pending_payment_minutes()),
          cancel_reason text,
          created_at timestamptz not null default now(),
          constraint valid_date_range check (check_out > check_in),
          constraint nights_matches_dates check (nights = check_out - check_in)
        )
        """
    )

    # -------------------------------------------------------------------------
    # T015 — orders_no_overlap（房況保證的實際承載者）
    # -------------------------------------------------------------------------
    # 憲章原則 IV：「後端的檢查是授權與訊息品質，資料庫的約束才是保證。」
    #
    # 半開區間 '[)' 讓「前一筆退房日 = 後一筆入住日」不算重疊。
    # where 子句列出佔用房況的三種狀態；已取消與已退款因而釋出區間。
    #
    # 以 op.execute() 原生 SQL 建立，**MUST NOT 依賴 autogenerate**——
    # daterange 是函式運算式、where 是部分約束，組合後 autogenerate 的還原
    # 能力不可靠，且失敗模式是產出刪除敘述而非報錯（research R2）。
    op.execute(
        """
        alter table public.orders add constraint orders_no_overlap
          exclude using gist (
            room_id with =,
            daterange(check_in, check_out, '[)') with &&
          ) where (status in ('pending-payment', 'confirmed', 'refund-pending'))
        """
    )

    # -------------------------------------------------------------------------
    # T017 — guard_order_transition（拆解後）
    # -------------------------------------------------------------------------
    # 原函式做兩件事，本次拆開（data-model.md、research R2）：
    #
    #   ① 管理員可自由變更狀態      依賴 is_admin() → auth.uid()  → **移至 FastAPI**
    #   ② 不得對已逾期訂單付款      只需比對 expires_at            → **保留於此**
    #   ③ 不得從任意狀態跳到已確認   只需比對新舊狀態                → **保留於此**
    #
    # ⚠️ 一個必要的行為調整：舊版有個 else 分支，會把所有未列舉的狀態變更一律
    # 拒絕，並靠 ① 讓管理員繞過。移除 ① 之後若保留該 else，管理員也會被擋下，
    # 而 FR-054 明訂管理員 MUST 能變更訂單狀態——資料庫已無從分辨誰是管理員。
    #
    # 因此改為**只禁止具體的危險轉換**，其餘放行。哪些角色可以做哪些轉換
    # 由 FastAPI 判定（憲章原則 VI：後端檢查是唯一的存取邊界）。
    #
    # 金額、日期與保留期限的不可變更則保留：這與身分無關，且是 FR-032
    # 「房源價格日後變動 MUST NOT 改變既有訂單金額」與 FR-101 的資料庫層保證。
    op.execute(
        """
        create function public.guard_order_transition()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
        begin
          if new.status is distinct from old.status and new.status = 'confirmed' then
            if old.status <> 'pending-payment' then
              raise exception '只有待付款的訂單可以完成付款' using errcode = '42501';
            end if;
            if old.expires_at < now() then
              raise exception '訂單已逾期取消，無法付款' using errcode = '42501';
            end if;
          end if;

          if new.total_amount is distinct from old.total_amount
             or new.check_in is distinct from old.check_in
             or new.check_out is distinct from old.check_out
             or new.expires_at is distinct from old.expires_at then
            raise exception '不允許變更訂單的金額、日期或保留期限' using errcode = '42501';
          end if;

          return new;
        end;
        $fn$
        """
    )
    op.execute(
        """
        create trigger orders_guard_transition
          before update on public.orders
          for each row execute function public.guard_order_transition()
        """
    )

    # 保留：純 PostgreSQL。三個呼叫點收在 repository 層內部（T033）。
    op.execute(
        """
        create function public.expire_stale_orders()
        returns integer
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
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
        $fn$
        """
    )

    # =========================================================================
    # reviews
    # =========================================================================
    op.execute(
        """
        create table public.reviews (
          id uuid primary key default gen_random_uuid(),
          order_id uuid not null unique references public.orders(id) on delete cascade,
          room_id uuid not null references public.rooms(id) on delete restrict,
          user_id uuid not null references public.profiles(id) on delete cascade,
          rating integer not null check (rating between 1 and 5),
          comment text not null,
          category text not null,
          status text not null default 'pending'
            check (status in ('pending', 'approved', 'rejected')),
          -- 規則式自動審核的初判。非 AI 服務（憲章原則 VI）。
          auto_verdict text check (auto_verdict in ('auto-pass', 'auto-reject')),
          auto_rules jsonb not null default '[]'::jsonb,
          admin_note text,
          admin_reply text
            check (admin_reply is null or char_length(admin_reply) between 1 and 1000),
          admin_reply_at timestamptz,
          admin_reply_by uuid references public.profiles(id),
          created_at timestamptz not null default now()
        )
        """
    )

    # 保留：純 PostgreSQL。
    op.execute(
        """
        create function public.refresh_room_rating()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
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
        $fn$
        """
    )
    op.execute(
        """
        create trigger reviews_refresh_rating
          after insert or update or delete on public.reviews
          for each row execute function public.refresh_room_rating()
        """
    )

    # -------------------------------------------------------------------------
    # T018 — stamp_review_reply（改寫）
    # -------------------------------------------------------------------------
    # 舊版做兩件事：檢查 is_admin()、以 auth.uid() 蓋章回覆者。兩者都依賴
    # Supabase Auth。改為：**回覆者由後端明確傳入 admin_reply_by**，
    # 本函式只負責與身分無關的時間戳與「清空即收回」語意（FR-103d）。
    #
    # 「僅管理員可回覆」的把關移至 FastAPI 的 require_admin（T032）。
    op.execute(
        """
        create function public.stamp_review_reply()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
        begin
          if new.admin_reply is distinct from old.admin_reply then
            if new.admin_reply is null then
              -- 清空回覆內容 = 收回回覆
              new.admin_reply_at := null;
              new.admin_reply_by := null;
            else
              new.admin_reply_at := now();
            end if;
          end if;
          return new;
        end;
        $fn$
        """
    )
    op.execute(
        """
        create trigger trg_stamp_review_reply
          before update on public.reviews
          for each row execute function public.stamp_review_reply()
        """
    )

    # =========================================================================
    # refunds
    # =========================================================================
    op.execute(
        """
        create table public.refunds (
          id uuid primary key default gen_random_uuid(),
          order_id uuid not null references public.orders(id) on delete cascade,
          user_id uuid not null references public.profiles(id) on delete cascade,
          reason text not null,
          amount integer not null check (amount >= 0),
          status text not null default 'pending'
            check (status in ('pending', 'approved', 'rejected')),
          admin_note text,
          created_at timestamptz not null default now(),
          reviewed_at timestamptz
        )
        """
    )
    # 同一訂單同時僅能有一筆審核中的申請；駁回後可再次提出（FR-036）
    op.execute(
        "create unique index refunds_one_pending_per_order "
        "on public.refunds (order_id) where status = 'pending'"
    )

    # 保留：純 PostgreSQL。以 trigger 而非 CHECK 實作，因為需要跨列聚合。
    #
    # 只計「審核中」與「已核准」，**被駁回的不佔額度**（FR-036b、SC-031）。
    # 這是必要的界定：FR-039 明訂駁回後會員可再次申請，若駁回也計入上限，
    # 被駁回 5 次的人就再也不能申請，兩條規則會直接矛盾。
    op.execute(
        """
        create function public.enforce_refund_limit()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
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
        $fn$
        """
    )
    op.execute(
        """
        create trigger refunds_enforce_limit
          before insert or update on public.refunds
          for each row execute function public.enforce_refund_limit()
        """
    )

    # =========================================================================
    # site_content — 全站單筆
    # =========================================================================
    op.execute(
        """
        create table public.site_content (
          id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
          hero_title text not null default 'Sunny 訂房平台',
          hero_subtitle text not null default '舒適住宿，安心入住',
          hero_image text not null default '',
          updated_at timestamptz not null default now(),
          constraint site_content_singleton
            check (id = '00000000-0000-0000-0000-000000000001'::uuid)
        )
        """
    )
    op.execute(
        "insert into public.site_content (id) values ('00000000-0000-0000-0000-000000000001')"
    )

    # =========================================================================
    # favorites
    # =========================================================================
    op.execute(
        """
        create table public.favorites (
          user_id uuid not null references public.profiles(id) on delete cascade,
          room_id uuid not null references public.rooms(id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (user_id, room_id)
        )
        """
    )

    # =========================================================================
    # room_risk_checks
    # =========================================================================
    # ⚠️ 前台使用者於「安全檢測」自行上傳的照片**絕不**寫入此表，也絕不上傳至
    # 任何儲存空間。那是使用者的私人照片，全程留在瀏覽器內（FR-086、SC-030）。
    # 此表僅存放管理員對飯店自有房間所做的檢測，其圖片會公開於房源詳情頁。
    op.execute(
        """
        create table public.room_risk_checks (
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
        )
        """
    )

    # =========================================================================
    # channel_prices — 模擬資料
    # =========================================================================
    op.execute(
        """
        create table public.channel_prices (
          id uuid primary key default gen_random_uuid(),
          room_id uuid not null references public.rooms(id) on delete cascade,
          channel text not null,
          channel_price integer not null check (channel_price > 0),
          captured_at timestamptz not null default now(),
          resolved boolean not null default false
        )
        """
    )
    op.execute(
        "comment on table public.channel_prices is "
        "'模擬的外部平台售價。非真實爬取結果。系統不爬取任何網站，也不呼叫任何 OTA API——"
        "理由是服務條款，不是技術限制（research B1-a）。'"
    )

    # =========================================================================
    # admin_logs — 僅可新增
    # =========================================================================
    op.execute(
        """
        create table public.admin_logs (
          id uuid primary key default gen_random_uuid(),
          actor_id uuid not null references public.profiles(id) on delete restrict,
          action text not null,
          target_table text not null,
          target_id text,
          summary jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "comment on table public.admin_logs is "
        "'僅可新增。UPDATE 與 DELETE 已自應用角色 REVOKE——任何角色（含管理員）"
        "都不得竄改稽核紀錄（SC-027）。'"
    )

    # =========================================================================
    # messages
    # =========================================================================
    op.execute(
        """
        create table public.messages (
          id uuid primary key default gen_random_uuid(),
          -- 討論串的擁有者永遠是那位會員。不存 recipient——存了就得回答
          -- 「哪一位管理員」，而那正是不想綁定的東西（FR-127）。
          thread_user_id uuid not null references public.profiles(id) on delete cascade,
          sender_id uuid not null references public.profiles(id) on delete cascade,
          sender_role text not null check (sender_role in ('member', 'admin')),
          body text not null check (char_length(body) between 1 and 2000),
          read_at timestamptz,
          created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "comment on table public.messages is "
        "'討論串屬於 thread_user_id 那位會員；任何管理員都看得到、都能回（FR-127）。只增不刪。'"
    )

    # -------------------------------------------------------------------------
    # T018 — stamp_message_sender（改寫）
    # -------------------------------------------------------------------------
    # 舊版以 auth.uid() 決定 sender_id、以 is_admin() 決定 sender_role，
    # 兩者都隨 Supabase Auth 消失。改為**由後端明確傳入**（FR-125 的
    # 「由伺服器判定」在新架構中即為 FastAPI）。
    #
    # 本函式只保留與身分無關的部分：新訊息一律未讀、送出時間以伺服器時鐘為準。
    # 前端送來的 read_at 與 created_at 一律被覆寫，不採信。
    op.execute(
        """
        create function public.stamp_message_sender()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
        begin
          new.read_at := null;
          new.created_at := now();
          return new;
        end;
        $fn$
        """
    )
    op.execute(
        """
        create trigger trg_stamp_message_sender
          before insert on public.messages
          for each row execute function public.stamp_message_sender()
        """
    )

    # 保留：純 PostgreSQL。與操作日誌同精神——一則已送出的訊息若能事後改字，
    # 整份對話在爭議發生時就失去佐證能力（FR-124）。
    op.execute(
        """
        create function public.guard_message_update()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
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
        $fn$
        """
    )
    op.execute(
        """
        create trigger trg_guard_message_update
          before update on public.messages
          for each row execute function public.guard_message_update()
        """
    )

    # =========================================================================
    # T014 — 索引
    # =========================================================================
    for stmt in (
        "create index idx_rooms_type on public.rooms(type)",
        "create index idx_rooms_status on public.rooms(status)",
        "create index idx_orders_user on public.orders(user_id)",
        "create index idx_orders_room on public.orders(room_id)",
        "create index idx_orders_status on public.orders(status)",
        "create index idx_orders_dates on public.orders(check_in, check_out)",
        "create index idx_orders_expiry on public.orders(expires_at) "
        "where status = 'pending-payment'",
        "create index idx_reviews_room on public.reviews(room_id)",
        "create index idx_reviews_status on public.reviews(status)",
        "create index idx_reviews_user on public.reviews(user_id)",
        "create index idx_refunds_status on public.refunds(status)",
        "create index idx_refunds_user on public.refunds(user_id)",
        "create index idx_favorites_room on public.favorites(room_id)",
        "create index idx_risk_checks_room on public.room_risk_checks(room_id, created_at desc)",
        "create index idx_channel_prices_room on public.channel_prices(room_id)",
        "create index idx_channel_prices_unresolved on public.channel_prices(resolved) "
        "where resolved = false",
        "create index idx_admin_logs_time on public.admin_logs(created_at desc)",
        "create index idx_admin_logs_actor on public.admin_logs(actor_id)",
        "create index messages_thread_idx on public.messages(thread_user_id, created_at desc)",
        # 設施與房型特色的 AND 篩選（jsonb 包含運算子 @>）
        "create index idx_rooms_amenities on public.rooms using gin (amenities)",
        "create index idx_rooms_features on public.rooms using gin (features)",
        "create index idx_profiles_role on public.profiles(role)",
    ):
        op.execute(stmt)

    # =========================================================================
    # 應用角色的權限
    # =========================================================================
    op.execute(f"grant usage on schema public to {APP_ROLE}")
    op.execute(f"grant select, insert, update, delete on all tables in schema public to {APP_ROLE}")
    op.execute(f"grant usage, select on all sequences in schema public to {APP_ROLE}")

    # =========================================================================
    # T019 — admin_logs 僅可新增
    # =========================================================================
    # **這是本次遷移最容易漏掉的一項。** 舊架構以「不建立 UPDATE/DELETE 的 RLS
    # 政策」達成；RLS 一併刪除時這個保證會跟著消失，而且不會有任何錯誤訊息，
    # 日誌只是變得可以竄改（data-model.md、SC-027）。
    #
    # REVOKE 只對非擁有者生效——這正是 T021a 存在的理由。
    op.execute(f"revoke update, delete on public.admin_logs from {APP_ROLE}")

    # =========================================================================
    # T019a — 關閉 PostgREST 這條存取路徑
    # =========================================================================
    # 憲章原則 III：「資料庫 MUST 只有一個存取者：FastAPI 後端。」
    #
    # 托管於 Supabase 會有第二扇門：PostgREST 以 anon / authenticated 角色存取
    # public schema，而 anon key 依設計可公開（其防護**只**來自 RLS），
    # 本次遷移又要把 RLS 全數移除。
    #
    # 更糟的是 Supabase 對 public 設有
    #   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated
    # 實測 anon 的預設 ACL 為 `arwdDxtm`——a=INSERT、r=SELECT、w=UPDATE、d=DELETE。
    # 也就是說上面每一張新建的表，anon 都自動獲得完整的增刪改查。
    #
    # service_role 不在撤銷之列：那把 key 是秘密且不在前端，撤掉會讓 Supabase
    # 主控台的 Table Editor 無法檢視資料，而那對除錯有實際價值。此為刻意的取捨。
    for role in ("anon", "authenticated"):
        op.execute(f"revoke all on all tables in schema public from {role}")
        op.execute(f"revoke all on all sequences in schema public from {role}")
        op.execute(f"revoke all on all functions in schema public from {role}")
        op.execute(f"revoke usage on schema public from {role}")
        # 日後新建的表不再自動開放。只影響本連線角色（postgres）所建立的物件，
        # 而遷移正是以該角色執行。
        op.execute(f"alter default privileges in schema public revoke all on tables from {role}")
        op.execute(f"alter default privileges in schema public revoke all on sequences from {role}")


def downgrade() -> None:
    """還原至空的 public schema。

    不移除 btree_gist 擴充與 sunny_app 角色：前者可能被其他物件使用，
    後者可能仍握有其他資料庫的連線。兩者都是冪等的，重跑 upgrade 不會出錯。
    """
    for table in reversed(TABLES):
        op.execute(f"drop table if exists public.{table} cascade")

    for fn in (
        "guard_message_update()",
        "stamp_message_sender()",
        "enforce_refund_limit()",
        "stamp_review_reply()",
        "refresh_room_rating()",
        "expire_stale_orders()",
        "guard_order_transition()",
        "pending_payment_minutes()",
    ):
        op.execute(f"drop function if exists public.{fn} cascade")

    op.execute("drop sequence if exists public.order_no_seq")
