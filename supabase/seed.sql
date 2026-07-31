-- Sunny 訂房平台 — 示範資料
--
-- 於 schema.sql 執行完畢後執行。本檔案可重複執行（idempotent）：
-- 房源以固定 UUID 建立，重跑時只更新內容，不會產生重複資料。
--
-- 注意：images 欄位指向專案內的相對路徑，對應的圖片檔位於 assets/rooms/。
-- 目前提供的是自製的 SVG 佔位示意圖（每檔約 1 KB），不涉及任何第三方著作權。
-- 若要換成真實照片，需為可自由使用的圖片且單檔不得超過 1 MB（憲章「資源」條），
-- 同時更新此處與 src/state/seed.js 兩邊的路徑。
--
-- 訂單、評論與退款的示範資料需要真實的 auth.users，無法以純 SQL 建立，
-- 請於建立示範帳號後透過應用程式介面產生，或見本檔末的選用區塊。

-- ---------------------------------------------------------------------------
-- 房源
-- amenities 供設施篩選（陽台、浴缸…），features 供房型特色篩選。
-- 兩者皆為 AND 邏輯：勾選多項時須同時具備。
-- ---------------------------------------------------------------------------

insert into public.rooms (id, name, type, max_guests, nightly_price, images, amenities, features, description, status) values
  ('11111111-1111-4111-8111-000000000001', '暖陽單人房 A', 'single', 1, 1800,
   '["assets/rooms/single-a.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌"]'::jsonb,
   '["商務友善","安靜樓層"]'::jsonb,
   '面向內庭的安靜單人房，適合商務短住。採光良好，附書桌與閱讀燈。', 'available'),

  ('11111111-1111-4111-8111-000000000002', '暖陽單人房 B', 'single', 1, 1800,
   '["assets/rooms/single-b.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌"]'::jsonb,
   '["商務友善"]'::jsonb,
   '同層的另一間單人房，格局相同，窗景面向街道。', 'available'),

  ('11111111-1111-4111-8111-000000000003', '日光雙人房 A', 'double', 2, 2600,
   '["assets/rooms/double-a.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組","陽台"]'::jsonb,
   '["採光佳","情侶推薦"]'::jsonb,
   '一張加大雙人床的標準房型，早晨採光充足，附小陽台，適合情侶或夫妻。', 'available'),

  ('11111111-1111-4111-8111-000000000004', '日光雙人房 B', 'double', 2, 2600,
   '["assets/rooms/double-b.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組"]'::jsonb,
   '["安靜樓層","情侶推薦"]'::jsonb,
   '與 A 房同規格，位於安靜的走廊末端。', 'available'),

  ('11111111-1111-4111-8111-000000000005', '日光雙人房 C', 'double', 2, 2800,
   '["assets/rooms/double-c.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組","浴缸","陽台"]'::jsonb,
   '["採光佳","情侶推薦","泡澡放鬆"]'::jsonb,
   '含獨立浴缸與陽台的雙人房，空間略大於標準雙人房。', 'available'),

  ('11111111-1111-4111-8111-000000000006', '雙床房 A', 'twin', 2, 2900,
   '["assets/rooms/twin-a.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃"]'::jsonb,
   '["商務友善","朋友同行"]'::jsonb,
   '兩張單人床的房型，適合朋友同行或商務同事。', 'available'),

  ('11111111-1111-4111-8111-000000000007', '雙床房 B', 'twin', 3, 3200,
   '["assets/rooms/twin-b.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃","加床服務"]'::jsonb,
   '["朋友同行","可加床"]'::jsonb,
   '可加床的雙床房，最多可住三人。', 'available'),

  ('11111111-1111-4111-8111-000000000008', '家庭四人房', 'family', 4, 4200,
   '["assets/rooms/family-a.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","客廳區","嬰兒床可租借","浴缸"]'::jsonb,
   '["親子友善","無障礙","可加床"]'::jsonb,
   '兩大床的家庭房，附小客廳區與無障礙動線，適合親子出遊。', 'available'),

  ('11111111-1111-4111-8111-000000000009', '景觀套房', 'suite', 2, 5600,
   '["assets/rooms/suite-a.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","咖啡機","陽台"]'::jsonb,
   '["採光佳","泡澡放鬆","情侶推薦"]'::jsonb,
   '頂層景觀套房，含起居空間與大面窗景，附膠囊咖啡機。', 'available'),

  ('11111111-1111-4111-8111-000000000010', '景觀套房（整理中）', 'suite', 2, 5600,
   '["assets/rooms/suite-b.svg"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","咖啡機","陽台"]'::jsonb,
   '["採光佳","泡澡放鬆"]'::jsonb,
   '與景觀套房同規格。此房目前設為整理中，用於展示房態排除規則。', 'maintenance')
on conflict (id) do update set
  name          = excluded.name,
  type          = excluded.type,
  max_guests    = excluded.max_guests,
  nightly_price = excluded.nightly_price,
  images        = excluded.images,
  amenities     = excluded.amenities,
  features      = excluded.features,
  description   = excluded.description,
  status        = excluded.status;

-- ---------------------------------------------------------------------------
-- 網站內容
-- ---------------------------------------------------------------------------

update public.site_content set
  hero_title    = 'Sunny 訂房平台',
  hero_subtitle = '舒適住宿，安心入住',
  hero_image    = 'assets/hero.svg',
  updated_at    = now()
where id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 渠道比價（模擬資料）
--
-- ⚠️ 這些價格是手工編寫的示範資料，不是從 Agoda 或 Booking 擷取來的。
--    本專案不爬取任何網站，也不呼叫任何 OTA 的 API（憲章原則 II 與 VI）。
--    刻意安排數筆低於官網價的資料，用於展示「賤賣預警」流程。
-- ---------------------------------------------------------------------------

delete from public.channel_prices;   -- 重跑時重建，避免累積

insert into public.channel_prices (room_id, channel, channel_price, captured_at) values
  -- 正常：與官網同價或略高
  ('11111111-1111-4111-8111-000000000003', 'Agoda',   2600, now() - interval '2 hours'),
  ('11111111-1111-4111-8111-000000000003', 'Booking', 2700, now() - interval '2 hours'),
  ('11111111-1111-4111-8111-000000000006', 'Agoda',   2950, now() - interval '2 hours'),
  ('11111111-1111-4111-8111-000000000008', 'Booking', 4200, now() - interval '2 hours'),
  ('11111111-1111-4111-8111-000000000009', 'Agoda',   5600, now() - interval '2 hours'),
  -- 賤賣：低於官網價，應觸發預警
  ('11111111-1111-4111-8111-000000000001', 'Agoda',   1620, now() - interval '1 hour'),
  ('11111111-1111-4111-8111-000000000005', 'Booking', 2380, now() - interval '1 hour'),
  ('11111111-1111-4111-8111-000000000009', 'Booking', 4980, now() - interval '30 minutes');

-- ---------------------------------------------------------------------------
-- 選用：示範訂單／評論／退款
--
-- 需先於 Dashboard 建立 guest@sunny.com 帳號。取消下列註解後執行即可產生
-- 一筆待付款訂單、一筆未來的已確認訂單、一筆已完成訂單與一則待審核評論，
-- 用於展示各種狀態。日期以執行當下為基準計算，重跑前請先清除舊資料。
-- ---------------------------------------------------------------------------

-- do $$
-- declare
--   guest_id uuid;
--   completed_order uuid;
-- begin
--   select id into guest_id from auth.users where email = 'guest@sunny.com';
--   if guest_id is null then
--     raise notice '找不到 guest@sunny.com，略過示範訂單';
--     return;
--   end if;
--
--   -- 待付款訂單（展示保留倒數與逾期釋出）
--   insert into public.orders
--     (user_id, room_id, check_in, check_out, nights, guest_count,
--      contact_name, phone, email, payment_method, total_amount, status)
--   values
--     (guest_id, '11111111-1111-4111-8111-000000000001',
--      current_date + 21, current_date + 22, 1, 1,
--      '示範會員', '0900-000-000', 'guest@sunny.com', 'bank-transfer', 1800, 'pending-payment');
--
--   -- 已確認的未來訂單（可申請退款）
--   insert into public.orders
--     (user_id, room_id, check_in, check_out, nights, guest_count,
--      contact_name, phone, email, payment_method, total_amount, status)
--   values
--     (guest_id, '11111111-1111-4111-8111-000000000003',
--      current_date + 14, current_date + 16, 2, 2,
--      '示範會員', '0900-000-000', 'guest@sunny.com', 'LINE Pay', 5200, 'confirmed');
--
--   -- 已完成訂單（可撰寫評論）
--   insert into public.orders
--     (user_id, room_id, check_in, check_out, nights, guest_count,
--      contact_name, phone, email, payment_method, total_amount, status)
--   values
--     (guest_id, '11111111-1111-4111-8111-000000000006',
--      current_date - 10, current_date - 8, 2, 2,
--      '示範會員', '0900-000-000', 'guest@sunny.com', 'credit-card', 5800, 'completed')
--   returning id into completed_order;
--
--   insert into public.reviews
--     (order_id, room_id, user_id, rating, comment, category, status, auto_verdict, auto_rules)
--   values
--     (completed_order, '11111111-1111-4111-8111-000000000006', guest_id,
--      5, '房間乾淨、床墊舒服，櫃檯人員也很親切。', 'cleanliness', 'pending',
--      'auto-pass', '[]'::jsonb)
--   on conflict (order_id) do nothing;
-- end $$;
