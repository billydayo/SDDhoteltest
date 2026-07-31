-- Sunny 訂房平台 — 完整示範資料
--
-- 於 Supabase Dashboard → SQL Editor 執行。**可重複執行**：每次會先清空
-- 訂單、評論、退款與渠道價格再重建，房源則以 UPSERT 更新。
--
-- 執行順序：schema.sql → seed.sql → 本檔
--
-- 產出：
--   ・房源 20 間（原 10 間 + 新增 10 間）
--   ・每間房 1–3 筆訂單，六種狀態齊備
--   ・guest@sunny.com 另有一組「展示用訂單」，六種狀態各一筆
--   ・評論（已公開／待審核／已駁回）與退款（待審核／已核准／已駁回）
--   ・渠道比價資料涵蓋新舊房源
--
-- ⚠️ 兩點限制，請先知道：
--
--   1. 所有訂單只能屬於 guest@sunny.com 與 admin@sunny.com 兩個帳號，
--      因為 orders.user_id 外鍵指向 profiles，而 profiles 只在有人真的註冊時
--      才會產生。以 SQL 直接寫入 auth.users 需要處理密碼雜湊與 auth schema
--      的內部結構，脆弱且不受支援。
--      → 補償做法：contact_name／phone／email 是自由文字，已刻意分散成多個
--        不同的住客姓名，後台訂單列表看起來仍然像有很多客人。
--
--   2. 待付款訂單的 expires_at 刻意設為 3 天後，而非系統參數的 60 分鐘。
--      否則示範資料在一小時內就會被 expire_stale_orders() 全數取消，
--      「六種狀態齊備」的性質活不過一個下午。
--      → 想測試真實的逾期行為，請用介面自己建一筆，或執行：
--        update public.orders set expires_at = now() - interval '1 minute'
--        where status = 'pending-payment';

begin;

-- ---------------------------------------------------------------------------
-- 0. 清空可重建的資料
--
-- 依外鍵相依順序刪除。rooms 不刪——它被 orders 以 on delete restrict 參照，
-- 且下方以 UPSERT 更新即可。
-- ---------------------------------------------------------------------------

delete from public.reviews;
delete from public.refunds;
delete from public.orders;
delete from public.channel_prices;
delete from public.room_risk_checks;
delete from public.favorites;

-- ---------------------------------------------------------------------------
-- 1. 新增房源 11–20（原 10 間由 seed.sql 建立）
-- ---------------------------------------------------------------------------

insert into public.rooms (id, name, type, max_guests, nightly_price, images, amenities, features, description, status) values
  ('11111111-1111-4111-8111-000000000011', '和風雙人房', 'double', 2, 3100,
   '["assets/rooms/wa-double.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組","浴缸"]'::jsonb,
   '["泡澡放鬆","情侶推薦","安靜樓層"]'::jsonb,
   '榻榻米與檜木浴缸的和式房型，適合想放慢步調的旅客。', 'available'),

  ('11111111-1111-4111-8111-000000000012', '和風雙床房', 'twin', 2, 3300,
   '["assets/rooms/wa-twin.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃","備品組"]'::jsonb,
   '["朋友同行","安靜樓層"]'::jsonb,
   '和式雙床房，兩張獨立床墊，附小型茶席空間。', 'available'),

  ('11111111-1111-4111-8111-000000000013', '星空景觀房', 'double', 2, 4100,
   '["assets/rooms/star-view.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","陽台","咖啡機"]'::jsonb,
   '["採光佳","情侶推薦"]'::jsonb,
   '面東的高樓層房型，天氣好時可從陽台看見星空。', 'available'),

  ('11111111-1111-4111-8111-000000000014', '庭園景觀房', 'double', 2, 3600,
   '["assets/rooms/garden-view.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","陽台","備品組"]'::jsonb,
   '["採光佳","安靜樓層","情侶推薦"]'::jsonb,
   '低樓層房型，陽台直接面向內庭花園，清晨有鳥聲。', 'available'),

  ('11111111-1111-4111-8111-000000000015', '商務單人房', 'single', 1, 2100,
   '["assets/rooms/biz-single.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌","衣櫃"]'::jsonb,
   '["商務友善","安靜樓層"]'::jsonb,
   '附大型書桌與人體工學椅，長時間工作也不易疲勞。', 'available'),

  ('11111111-1111-4111-8111-000000000016', '商務雙人房', 'double', 2, 2900,
   '["assets/rooms/biz-double.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌","小冰箱","衣櫃"]'::jsonb,
   '["商務友善"]'::jsonb,
   '雙人商務房，兩側各有獨立插座與閱讀燈。', 'available'),

  ('11111111-1111-4111-8111-000000000017', '親子主題房', 'family', 4, 4800,
   '["assets/rooms/kids-family.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","嬰兒床可租借","加床服務"]'::jsonb,
   '["親子友善","可加床","採光佳"]'::jsonb,
   '含遊戲區與防撞設計的家庭房，備有兒童備品與床欄。', 'available'),

  ('11111111-1111-4111-8111-000000000018', '無障礙友善房', 'double', 2, 3000,
   '["assets/rooms/accessible.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃"]'::jsonb,
   '["無障礙","安靜樓層"]'::jsonb,
   '加寬門框與無門檻淋浴間，走道淨寬足供輪椅迴轉。', 'available'),

  ('11111111-1111-4111-8111-000000000019', '頂樓行政套房', 'suite', 3, 6800,
   '["assets/rooms/exec-suite.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","咖啡機","陽台","加床服務"]'::jsonb,
   '["採光佳","商務友善","可加床","泡澡放鬆"]'::jsonb,
   '頂樓行政套房，含獨立起居室與辦公區，可加床。', 'available'),

  ('11111111-1111-4111-8111-000000000020', '蜜月套房', 'suite', 2, 7500,
   '["assets/rooms/honeymoon.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","咖啡機","陽台","備品組"]'::jsonb,
   '["情侶推薦","泡澡放鬆","採光佳"]'::jsonb,
   '雙人按摩浴缸與景觀陽台，房內備有慶祝布置服務。', 'maintenance')
on conflict (id) do update set
  name = excluded.name, type = excluded.type, max_guests = excluded.max_guests,
  nightly_price = excluded.nightly_price, images = excluded.images,
  amenities = excluded.amenities, features = excluded.features,
  description = excluded.description, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 2. 每間房 1–3 筆訂單
--
-- 排除約束 orders_no_overlap 只作用於 pending-payment／confirmed／refund-pending
-- 這三個「佔房」狀態。因此：
--   ・過去的訂單一律給 completed／cancelled／refunded → 不佔房，可自由安排
--   ・未來的佔房訂單每間房至多一筆，且各房使用不同日期，永不衝突
-- ---------------------------------------------------------------------------

do $$
declare
  guest_id uuid;
  admin_id uuid;
  r        record;
  idx      int := 0;
  n        int;
  owner    uuid;
  guests   int;
  nights1  int;
  ci       date;
  co       date;
  past_status text;
  names  text[] := array['林孟儒','陳品瑄','黃彥廷','張雅筑','吳承恩','劉冠廷',
                         '蔡宜靜','鄭凱文','許雅琪','曾柏翰','周欣怡','葉建宏'];
  phones text[] := array['0912-345-678','0922-111-222','0933-444-555','0955-666-777'];
  pays   text[] := array['LINE Pay','credit-card','bank-transfer'];
begin
  select id into guest_id from auth.users where email = 'guest@sunny.com';
  select id into admin_id from auth.users where email = 'admin@sunny.com';
  if guest_id is null then
    raise exception '找不到 guest@sunny.com，請先建立示範帳號';
  end if;

  for r in select id, nightly_price, max_guests from public.rooms order by id loop
    idx := idx + 1;
    n := 1 + (idx % 3);                       -- 1、2、3 循環
    owner := case when idx % 4 = 0 and admin_id is not null then admin_id else guest_id end;
    guests := least(r.max_guests, 1 + (idx % 2));

    -- ---- 訂單 1：過去的住宿。三種非佔房狀態輪流 ----
    nights1 := 1 + (idx % 3);
    ci := current_date - (20 + idx * 3);
    co := ci + nights1;
    past_status := (array['completed','completed','cancelled','refunded'])[1 + (idx % 4)];

    insert into public.orders (
      user_id, room_id, check_in, check_out, nights, guest_count,
      contact_name, phone, email, payment_method, total_amount, status, cancel_reason
    ) values (
      owner, r.id, ci, co, nights1, guests,
      names[1 + (idx % 12)], phones[1 + (idx % 4)], 'demo@sunny.com',
      pays[1 + (idx % 3)], r.nightly_price * nights1, past_status,
      case when past_status = 'cancelled' then 'payment-timeout' else null end
    );

    -- ---- 訂單 2：未來的已確認訂單（佔房）----
    -- 每間房的日期各自錯開，同房不會有第二筆佔房訂單，故不可能衝突
    if n >= 2 then
      ci := current_date + (7 + idx * 2);
      co := ci + 2;
      insert into public.orders (
        user_id, room_id, check_in, check_out, nights, guest_count,
        contact_name, phone, email, payment_method, total_amount, status
      ) values (
        owner, r.id, ci, co, 2, guests,
        names[1 + ((idx + 5) % 12)], phones[1 + ((idx + 1) % 4)], 'demo@sunny.com',
        pays[1 + ((idx + 1) % 3)], r.nightly_price * 2, 'confirmed'
      );
    end if;

    -- ---- 訂單 3：再一筆過去的已完成訂單，讓部分房源有多則評論可寫 ----
    if n >= 3 then
      ci := current_date - (70 + idx * 2);
      co := ci + 1;
      insert into public.orders (
        user_id, room_id, check_in, check_out, nights, guest_count,
        contact_name, phone, email, payment_method, total_amount, status
      ) values (
        guest_id, r.id, ci, co, 1, guests,
        names[1 + ((idx + 9) % 12)], phones[1 + ((idx + 2) % 4)], 'demo@sunny.com',
        pays[1 + ((idx + 2) % 3)], r.nightly_price, 'completed'
      );
    end if;
  end loop;

  raise notice '已為 % 間房源建立訂單', idx;
end $$;

-- ---------------------------------------------------------------------------
-- 3. guest@sunny.com 的展示用訂單：六種狀態各一筆
--
-- 使用 +200 天之後的日期區間，與上面迴圈產生的資料（-90 至 +60 天）完全隔離，
-- 因此不可能觸發排除約束。
-- ---------------------------------------------------------------------------

do $$
declare
  guest_id uuid;
  o_pending uuid; o_confirmed uuid; o_refund_pending uuid;
  o_refunded uuid; o_cancelled uuid; o_completed uuid;
begin
  select id into guest_id from auth.users where email = 'guest@sunny.com';

  -- 待付款。expires_at 刻意設為 3 天後，否則示範資料一小時內就會被自動取消
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status, expires_at)
  values (guest_id, '11111111-1111-4111-8111-000000000003',
    current_date + 200, current_date + 202, 2, 2,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'LINE Pay', 5200,
    'pending-payment', now() + interval '3 days')
  returning id into o_pending;

  -- 已確認（可申請退款：距入住日超過 7 天，應顯示可退 100%）
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status)
  values (guest_id, '11111111-1111-4111-8111-000000000009',
    current_date + 210, current_date + 213, 3, 2,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'credit-card', 16800, 'confirmed')
  returning id into o_confirmed;

  -- 退款審核中
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status)
  values (guest_id, '11111111-1111-4111-8111-000000000008',
    current_date + 220, current_date + 222, 2, 4,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'bank-transfer', 8400, 'refund-pending')
  returning id into o_refund_pending;

  -- 已退款
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status)
  values (guest_id, '11111111-1111-4111-8111-000000000005',
    current_date + 230, current_date + 232, 2, 2,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'LINE Pay', 5600, 'refunded')
  returning id into o_refunded;

  -- 已取消（逾期未付款）
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status, cancel_reason, expires_at)
  values (guest_id, '11111111-1111-4111-8111-000000000007',
    current_date + 240, current_date + 242, 2, 3,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'credit-card', 6400,
    'cancelled', 'payment-timeout', now() - interval '2 days')
  returning id into o_cancelled;

  -- 已完成（退房日已過，可撰寫評論）
  insert into public.orders (user_id, room_id, check_in, check_out, nights, guest_count,
    contact_name, phone, email, payment_method, total_amount, status)
  values (guest_id, '11111111-1111-4111-8111-000000000006',
    current_date - 12, current_date - 9, 3, 2,
    '示範會員', '0900-000-000', 'guest@sunny.com', 'credit-card', 8700, 'completed')
  returning id into o_completed;

  -- 對應的退款申請：一筆待審核、一筆已核准
  insert into public.refunds (order_id, user_id, reason, amount, status)
  values (o_refund_pending, guest_id,
    '出差行程臨時取消，需要取消這次的訂房。', 8400, 'pending');

  insert into public.refunds (order_id, user_id, reason, amount, status, admin_note, reviewed_at)
  values (o_refunded, guest_id,
    '家中臨時有事無法前往，麻煩協助辦理退款。', 5600, 'approved',
    '已確認符合入住前 7 天以上的全額退款條件。', now() - interval '3 days');

  raise notice '已建立示範帳號的六種狀態訂單';
end $$;

-- ---------------------------------------------------------------------------
-- 4. 評論：已公開、待審核、已駁回三種都有
--
-- 只能掛在 completed 訂單上（一訂單一則）。已公開的評論會觸發
-- refresh_room_rating trigger，讓房源產生平均評分，排序功能才測得出來。
-- ---------------------------------------------------------------------------

do $$
declare
  o record;
  i int := 0;
  comments text[] := array[
    '房間比照片看起來更寬敞，床墊軟硬適中，一夜好眠。櫃檯人員也很親切。',
    '整體乾淨，衛浴的水壓很夠。唯一小可惜是隔壁走廊的聲音稍微聽得到。',
    '性價比很高，早餐選擇雖然不多但都很新鮮。下次還會再訂。',
    '位置安靜，適合想好好休息的人。冷氣有點慢熱，其餘都很滿意。',
    '窗景比想像中好，傍晚的採光很舒服。備品齊全，不用另外帶。',
    '服務人員在我提早抵達時協助寄放行李，這點很加分。',
    '空間規劃合理，行李攤開也不會擋路。浴缸泡起來很放鬆。',
    '整潔度沒話說，床單有陽光的味道。唯一建議是插座可以再多一個。'
  ];
  cats text[] := array['cleanliness','service','value','location','facility'];
  ratings int[] := array[5,4,5,4,3,5,4,5];
begin
  for o in
    select id, room_id, user_id from public.orders
    where status = 'completed' order by check_in desc limit 11
  loop
    i := i + 1;
    insert into public.reviews (order_id, room_id, user_id, rating, comment, category,
      status, auto_verdict, auto_rules, admin_note)
    values (
      o.id, o.room_id, o.user_id,
      ratings[1 + (i % 8)],
      comments[1 + (i % 8)],
      cats[1 + (i % 5)],
      -- 前 8 則已公開，第 9、10 則待審核，第 11 則已駁回
      case when i <= 8 then 'approved' when i <= 10 then 'pending' else 'rejected' end,
      case when i = 11 then 'auto-reject' else 'auto-pass' end,
      case when i = 11 then '["CONTACT_INFO"]'::jsonb else '[]'::jsonb end,
      case when i = 11 then '評論內含聯絡方式，依規定不予公開。' else null end
    );
  end loop;

  raise notice '已建立 % 則評論', i;
end $$;

-- ---------------------------------------------------------------------------
-- 5. 渠道比價（模擬資料）
--
-- ⚠️ 手工編寫，非真實擷取。系統不連線至任何外部訂房平台（FR-109）。
--    刻意讓約三分之一低於官網價，用於展示賤賣預警。
-- ---------------------------------------------------------------------------

insert into public.channel_prices (room_id, channel, channel_price, captured_at, resolved)
select
  r.id,
  c.channel,
  case
    when (row_number() over (order by r.id, c.channel)) % 3 = 0
      then round(r.nightly_price * 0.88)      -- 低於官網 12% → 觸發預警
    else r.nightly_price + (row_number() over (order by r.id, c.channel) % 3) * 50
  end,
  now() - ((row_number() over (order by r.id, c.channel)) || ' hours')::interval,
  false
from public.rooms r
cross join (values ('Agoda'), ('Booking'), ('Expedia')) as c(channel)
where r.status <> 'maintenance';

commit;

-- ---------------------------------------------------------------------------
-- 6. 確認結果
-- ---------------------------------------------------------------------------

select '房源' as 項目, count(*)::text as 數量 from public.rooms
union all select '訂單', count(*)::text from public.orders
union all select '評論', count(*)::text from public.reviews
union all select '退款申請', count(*)::text from public.refunds
union all select '渠道價格', count(*)::text from public.channel_prices;

select status as 訂單狀態, count(*) as 筆數
from public.orders group by status order by count(*) desc;

select '示範帳號的訂單' as 說明, o.status as 狀態, count(*) as 筆數
from public.orders o
join auth.users u on u.id = o.user_id
where u.email = 'guest@sunny.com'
group by o.status order by o.status;
