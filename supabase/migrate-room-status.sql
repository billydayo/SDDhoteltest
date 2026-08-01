-- 把 rooms.status 的 'booked' 從 CHECK 約束中移除。
--
-- 「已預訂」改為由當日訂單即時推導（FR-015、FR-051a），不再是房源本身的欄位值。
-- 保留這個值只會讓人以為它還能用——手動設了沒有任何機制在退房後改回來，
-- 那間房就永久賣不出去。
--
-- 對既有資料庫執行一次即可；schema.sql 已同步，全新安裝不需要跑這支。
-- 可重複執行。

begin;

-- 先把殘留的 'booked' 收斂成 'available'，否則加約束會失敗。
-- 這樣做是安全的：可訂與否本來就由訂單決定，不看這個欄位。
update public.rooms set status = 'available' where status = 'booked';

alter table public.rooms drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check check (status in ('available', 'maintenance'));

commit;

-- 驗證：應回傳 0 列
-- select id, name, status from public.rooms where status not in ('available', 'maintenance');
