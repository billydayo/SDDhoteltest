-- Sunny 訂房平台 — 建立一筆「已入住完畢」的示範訂單
--
-- 於 Supabase Dashboard → SQL Editor 執行。可重複執行（重跑會先清掉舊的測試訂單）。
--
-- 為什麼需要它：
--   訂房規則要求入住日至少是明天（憲章原則 IV），因此透過介面建立的訂單，
--   退房日永遠在後天以後。而撰寫評論的資格是「退房日已過」——
--   兩者夾擊之下，**無法用正常流程產生一筆可評論的訂單**。
--
--   這不是程式缺陷：真實飯店本來就會有過去的住宿紀錄。只是在全新的資料庫上
--   測試評論功能時，需要先手動補一筆歷史訂單。
--
-- 執行後：
--   以 guest@sunny.com 登入 → 我的訂單 → 點該筆訂單 → 「撰寫評論」
--   或直接到該房源的詳情頁，撰寫評論表單會出現在頁面下方。

begin;

do $$
declare
  guest_id uuid;
  room_id  uuid := '11111111-1111-4111-8111-000000000006';  -- 雙床房 A
  new_order uuid;
begin
  select id into guest_id from auth.users where email = 'guest@sunny.com';

  if guest_id is null then
    raise exception '找不到 guest@sunny.com，請先建立示範帳號';
  end if;

  -- 清掉先前用本腳本建立的測試訂單，避免重複累積
  delete from public.orders
  where user_id = guest_id
    and contact_name = '示範會員（歷史住宿）';

  insert into public.orders (
    user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status
  ) values (
    guest_id, room_id,
    current_date - 10, current_date - 8, 2, 2,
    '示範會員（歷史住宿）', '0900-000-000', 'guest@sunny.com',
    'credit-card', 5800, 'completed'
  )
  returning id into new_order;

  raise notice '已建立歷史訂單 %，入住 % 至 %',
    new_order, current_date - 10, current_date - 8;
end $$;

commit;

-- 確認結果
select
  o.order_no,
  r.name          as 房源,
  o.check_in      as 入住,
  o.check_out     as 退房,
  o.status        as 狀態,
  (o.check_out <= current_date) as 可撰寫評論
from public.orders o
join public.rooms r on r.id = o.room_id
where o.contact_name = '示範會員（歷史住宿）';
