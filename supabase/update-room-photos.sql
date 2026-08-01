-- 補上仍是 SVG 佔位圖（或完全沒圖）的房源照片。
--
-- 已經手動設過真實照片的房源不在此檔內，主視覺也維持現狀。
-- 每條 update 都帶 images 的條件，因此可重複執行，
-- 且日後在後台換過圖的房源不會被這支 SQL 蓋掉。
--
-- 產生時的線上狀態：21 間房源，其中 15 間待補、6 間跳過。
--   跳過：和風雙人房（已有真實照片）
--   跳過：庭園景觀房（已有真實照片）
--   跳過：日光雙人房 B（已有真實照片）
--   跳過：景觀套房（整理中）（已有真實照片）
--   跳過：經典和風客房（非種子房源）
--   跳過：雙床房 B（已有真實照片）

update public.rooms set images = '["https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000012'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 和風雙床房

update public.rooms set images = '["https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1592229505726-ca121723b8ef?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000015'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 商務單人房

update public.rooms set images = '["https://images.unsplash.com/photo-1631049552057-403cdb8f0658?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000016'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 商務雙人房

update public.rooms set images = '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1540518614846-7eded433c457?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000008'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 家庭四人房

update public.rooms set images = '["https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000003'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 日光雙人房 A

update public.rooms set images = '["https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1615529182904-14819c35db37?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000005'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 日光雙人房 C

update public.rooms set images = '["https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000013'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 星空景觀房

update public.rooms set images = '["https://images.unsplash.com/photo-1602002418082-a4443e081dd1?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1568495248636-6432b97bd949?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000009'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 景觀套房

update public.rooms set images = '["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1590073844006-33379778ae09?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000001'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 暖陽單人房 A

update public.rooms set images = '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000002'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 暖陽單人房 B

update public.rooms set images = '["https://images.unsplash.com/photo-1587985064135-0366536eab42?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000018'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 無障礙友善房

update public.rooms set images = '["https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000020'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 蜜月套房

update public.rooms set images = '["https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1594563703937-fdc640497dcd?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000017'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 親子主題房

update public.rooms set images = '["https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1541971875076-8f970d573be6?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000006'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 雙床房 A

update public.rooms set images = '["https://images.unsplash.com/photo-1611048267451-e6ed903d4a38?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=80","https://images.unsplash.com/photo-1554009975-d74653b879f1?auto=format&fit=crop&w=1200&q=80"]'::jsonb
  where id = '11111111-1111-4111-8111-000000000019'
    and (images = '[]'::jsonb or images::text like '%assets/rooms/%');  -- 頂樓行政套房

