-- 設施與房型特色改為可由後台增刪（FR-010a）。
--
-- 兩份清單改存 system_settings，前台篩選器與後台房源表單都由此取得選項。
-- 另加一條 insert 政策與 insert 授權：這兩個 key 是後來才有的，
-- 第一次儲存是 insert 而不是 update，沒有政策會被 RLS 擋下。
--
-- 對既有資料庫執行一次即可；schema.sql 已同步，全新安裝不需要跑這支。
-- 可重複執行。

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

-- 驗證：應回傳三列（pending_payment_minutes、room_amenities、room_features）
-- select key, jsonb_typeof(value) from public.system_settings order by key;
