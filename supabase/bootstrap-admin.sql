-- Sunny 訂房平台 — 建立第一個管理員
--
-- 於 Supabase Dashboard → SQL Editor 貼上執行。可重複執行。
--
-- 為什麼需要獨立的一步：
--   應用程式內沒有任何路徑能讓使用者把自己升為管理員——那是
--   prevent_role_escalation trigger 刻意造成的。因此第一個管理員只能在
--   SQL Editor 這種特權情境下產生。這不是不便，是設計。
--
-- 前提：guest@sunny.com 與 admin@sunny.com 兩個帳號已存在
--       （可由應用程式的註冊頁建立，或於 Authentication → Users 手動新增）。

begin;

-- ---------------------------------------------------------------------------
-- 1. 修正 prevent_role_escalation trigger
--
--    若你的專案是在 2026-07-31 修正前執行 schema.sql 的，這個 trigger 會連
--    SQL Editor 的升權也一併擋下（因為此處 auth.uid() 為 null，is_admin()
--    因而回傳 false），導致下方的 UPDATE 失敗並回報「僅管理員可變更角色」。
--
--    加上 `auth.uid() is not null` 條件即可解除死結。放行特權情境是安全的：
--    anon 角色對 profiles 沒有 UPDATE 權限，在觸發此 trigger 之前就已被擋下。
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. 為既有帳號補上 profiles 資料列
--
--    handle_new_user trigger 只在「新註冊」時觸發。若帳號是在 schema.sql
--    執行之前就建立的，就不會有對應的 profile。這段補齊它們。
-- ---------------------------------------------------------------------------

insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. 升權並設定顯示名稱
-- ---------------------------------------------------------------------------

update public.profiles
set role = 'admin', display_name = '系統管理員'
where id = (select id from auth.users where email = 'admin@sunny.com');

update public.profiles
set display_name = '示範會員'
where id = (select id from auth.users where email = 'guest@sunny.com');

commit;

-- ---------------------------------------------------------------------------
-- 4. 確認結果
--
--    預期看到兩筆：admin@sunny.com 為 admin、guest@sunny.com 為 member。
-- ---------------------------------------------------------------------------

select u.email, p.role, p.display_name, p.phone
from public.profiles p
join auth.users u on u.id = p.id
order by p.role, u.email;
