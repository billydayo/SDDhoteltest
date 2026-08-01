-- Sunny 訂房平台 — 示範資料
--
-- 於 schema.sql 執行完畢後執行。本檔案可重複執行（idempotent）：
-- 房源以固定 UUID 建立，重跑時只更新內容，不會產生重複資料。
--
-- 注意：images 欄位為 Unsplash 的實拍照片網址，需與 src/state/seed.js 的 photos() 一致，
-- 兩種模式才會呈現相同的畫面。Unsplash License 允許免費商用且免署名。
-- 網址帶 w=1200&q=80，單張約 150–250 KB，符合憲章「資源」條的單檔 1 MB 上限。
-- 圖片載入失敗時前端會退回 assets/rooms/room-fallback.svg，不會出現破圖。
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
   '["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1590073844006-33379778ae09?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌"]'::jsonb,
   '["商務友善","安靜樓層"]'::jsonb,
   '面向內庭的安靜單人房，適合商務短住。採光良好，附書桌與閱讀燈。', 'available'),

  ('11111111-1111-4111-8111-000000000002', '暖陽單人房 B', 'single', 1, 1800,
   '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","書桌"]'::jsonb,
   '["商務友善"]'::jsonb,
   '同層的另一間單人房，格局相同，窗景面向街道。', 'available'),

  ('11111111-1111-4111-8111-000000000003', '日光雙人房 A', 'double', 2, 2600,
   '["https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組","陽台"]'::jsonb,
   '["採光佳","情侶推薦"]'::jsonb,
   '一張加大雙人床的標準房型，早晨採光充足，附小陽台，適合情侶或夫妻。', 'available'),

  ('11111111-1111-4111-8111-000000000004', '日光雙人房 B', 'double', 2, 2600,
   '["https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1611967164521-abae8fba4668?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組"]'::jsonb,
   '["安靜樓層","情侶推薦"]'::jsonb,
   '與 A 房同規格，位於安靜的走廊末端。', 'available'),

  ('11111111-1111-4111-8111-000000000005', '日光雙人房 C', 'double', 2, 2800,
   '["https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1615529182904-14819c35db37?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","備品組","浴缸","陽台"]'::jsonb,
   '["採光佳","情侶推薦","泡澡放鬆"]'::jsonb,
   '含獨立浴缸與陽台的雙人房，空間略大於標準雙人房。', 'available'),

  ('11111111-1111-4111-8111-000000000006', '雙床房 A', 'twin', 2, 2900,
   '["https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1541971875076-8f970d573be6?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃"]'::jsonb,
   '["商務友善","朋友同行"]'::jsonb,
   '兩張單人床的房型，適合朋友同行或商務同事。', 'available'),

  ('11111111-1111-4111-8111-000000000007', '雙床房 B', 'twin', 3, 3200,
   '["https://images.unsplash.com/photo-1596436889106-be35e843f974?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","衣櫃","加床服務"]'::jsonb,
   '["朋友同行","可加床"]'::jsonb,
   '可加床的雙床房，最多可住三人。', 'available'),

  ('11111111-1111-4111-8111-000000000008', '家庭四人房', 'family', 4, 4200,
   '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1540518614846-7eded433c457?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","小冰箱","客廳區","嬰兒床可租借","浴缸"]'::jsonb,
   '["親子友善","無障礙","可加床"]'::jsonb,
   '兩大床的家庭房，附小客廳區與無障礙動線，適合親子出遊。', 'available'),

  ('11111111-1111-4111-8111-000000000009', '景觀套房', 'suite', 2, 5600,
   '["https://images.unsplash.com/photo-1602002418082-a4443e081dd1?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1568495248636-6432b97bd949?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
   '["免費 Wi-Fi","冷氣","獨立衛浴","浴缸","小冰箱","客廳區","咖啡機","陽台"]'::jsonb,
   '["採光佳","泡澡放鬆","情侶推薦"]'::jsonb,
   '頂層景觀套房，含起居空間與大面窗景，附膠囊咖啡機。', 'available'),

  ('11111111-1111-4111-8111-000000000010', '景觀套房（整理中）', 'suite', 2, 5600,
   '["https://images.unsplash.com/photo-1566195992011-5f6b21e539aa?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
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
  hero_image    = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80',
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
