# Quickstart: Sunny 訂房平台

## Prerequisites

- A modern browser (Chrome, Edge, Firefox, or Safari)
- No install step, no `npm install`, no build tool
- Optional: a simple static server such as `python -m http.server 8000`
- Optional: a free Supabase project (only needed for database mode)

## 兩種執行模式

| 模式 | 條件 | 資料位置 | 認證 |
|---|---|---|---|
| **示範模式** | `src/config.js` 留空（預設） | 瀏覽器 `localStorage` | 模擬登入，零網路請求 |
| **資料庫模式** | `src/config.js` 已填憑證 | Supabase 雲端 Postgres | Supabase Auth，可跨裝置 |

## Option A：示範模式（零設定）

1. 開啟專案資料夾。
2. 直接以瀏覽器開啟 `index.html`，或執行 `python -m http.server 8000` 後開啟
   `http://localhost:8000/`。
3. 介面右上角會持續顯示「示範模式」標示，代表資料僅存於此瀏覽器。

不需要帳號、不需要網路。此模式下應用程式不會發出任何網路請求。

## Option B：資料庫模式（Supabase）

### 1. 建立專案

1. 於 [supabase.com](https://supabase.com) 建立一個免費專案。
2. 進入 **Authentication → Providers → Email**，**關閉 "Confirm email"**。
   本專案不寄送任何郵件，註冊後帳號必須立即可用。
3. 進入 **Authentication → Providers → Google**，啟用並填入 Google Cloud 的
   OAuth Client ID 與 Secret，同時把 Supabase 顯示的 callback URL 加入 Google
   的 Authorized redirect URIs。若暫時不需要 Google 登入，可略過此步——
   應用程式會將該按鈕停用並說明原因。

### 2. 建立資料表與儲存空間

**若專案曾執行過舊版 schema，先清乾淨。** 在 SQL Editor 執行：

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

看到 `users`、或看不到 `profiles`，代表裝的是 2026-07-31 改版前的舊 schema。
此時**必須**先執行 [`supabase/reset-legacy.sql`](../../supabase/reset-legacy.sql) 再繼續——
直接重跑新的 schema.sql 沒有用，`create table if not exists` 會靜默跳過既有的舊表，
留下缺欄位、外鍵指向錯誤的結構。該腳本會刪除資料，執行前請確認沒有要保留的內容。

1. 進入 **SQL Editor**，貼上並執行 [`supabase/schema.sql`](../../supabase/schema.sql)。
   它會一併建立 `room-risk` storage bucket 與其存取政策。
2. 接著執行 [`supabase/seed.sql`](../../supabase/seed.sql) 建立 10 筆示範房源與
   8 筆模擬渠道價格。
3. 於 **Table Editor** 確認十一張表都存在，且每張表的 RLS 顯示為已啟用。
4. 於 **Storage** 確認 `room-risk` bucket 存在且為 public。

### 3. 建立示範帳號

1. 建立兩個帳號，任一方式皆可：
   - 於應用程式的註冊頁自行註冊（`handle_new_user` trigger 會自動建立 profile）
   - 或 **Authentication → Users → Add user**，勾選 *Auto Confirm User*
   ```
   guest@sunny.com / guest123
   admin@sunny.com / admin123
   ```
2. 於 SQL Editor 執行 [`supabase/bootstrap-admin.sql`](../../supabase/bootstrap-admin.sql)，
   把 `admin@sunny.com` 升為管理員。

**為什麼升權需要獨立一步**：應用程式內沒有任何路徑能讓使用者把自己升為管理員，
那是 `prevent_role_escalation` trigger 刻意造成的。第一個管理員只能在 SQL Editor
這種特權情境下產生。

> ⚠️ 若你的專案是在 2026-07-31 修正前執行 schema.sql 的，該 trigger 會連 SQL Editor
> 的升權也一併擋下（此處 `auth.uid()` 為 null，`is_admin()` 因而回傳 false）。
> `bootstrap-admin.sql` 的第一段會一併修好這個問題。

### 4. 填入憑證

於 **Project Settings → API** 取得 Project URL 與 **anon public** key，填入
`src/config.js`：

```js
window.__SUNNY_CONFIG__ = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'
};
```

- anon key 是設計上可公開的識別碼，其防護來自 RLS 而非保密，因此可以放在前端。
- **`service_role` key 絕對不可填入此檔或提交至版控**。若曾誤植，請立即於
  Dashboard 輪替該金鑰。
- 專案不讀取 `.env`——沒有建置步驟的瀏覽器讀不到環境變數。

### 5. 啟動

同 Option A 開啟 `index.html`。示範模式標示應消失，房源資料改由 Supabase 載入。

## End-to-end validation flow

標註 **[2M]** 的項目需在兩種模式下各驗一次（FR-080、SC-017）。
比對的是**功能**，不是畫面內容——兩種模式的房源筆數、照片與訂單資料各自獨立，
不必一致（2026-08-01 修訂）。

### 0. 模式切換 [2M]
- 清空 `src/config.js` 的憑證 → 重新載入 → 確認顯示示範模式標示，且開發者工具的
  Network 面板中沒有任何對外請求
- 填回憑證 → 重新載入 → 確認標示消失且資料來自 Supabase
- 故意填入錯誤的 URL → 確認顯示明確的設定錯誤訊息，而不是悄悄退回示範模式

### 1. Guest browsing [2M]
- Open the home page and verify the room cards appear
- Try keyword search, date filters, guest count, and price cap
- Tick 浴缸 + 陽台 → only rooms with **both** appear (AND logic); 日光雙人房 C
  and 景觀套房 should qualify, 暖陽單人房 should not
- Pick a room feature (e.g. 親子友善) and confirm filtering, then use the
  one-click clear control and confirm all filters reset
- Switch room type tabs and confirm the list updates without resetting unrelated filters
- Open a room detail page and confirm the rating, comments, room status, total price,
  amenities, and features are visible
- Confirm a room with no approved reviews shows 「尚無評分」rather than 0 分
- Confirm a room with no quality check shows 「尚未檢測」rather than a blank block
- Open the terms of service link in the footer and confirm the demo-project disclaimer

### 2. Member login and account management [2M]
- Sign up with a new email address and a password shorter than 6 characters → confirm the error message
- Sign up properly and confirm auto-login plus the display name in the header
- Log out and log back in with `guest@sunny.com / guest123`
- Update the display name in account settings and verify it reflects across the app
- **資料庫模式加驗**：於無痕視窗以同一帳號登入，確認顯示名稱與訂單一致（SC-021）
- **資料庫模式加驗**：以 Google 登入，確認回到原本要前往的頁面；在授權畫面按取消，
  確認回到登入頁顯示「已取消登入」且未建立帳號
  - 取消那一段已由 `npm run test:google` 自動涵蓋；**完成授權那一段需人工**
- **資料庫模式加驗**：以某信箱先用密碼註冊，再用同一信箱的 Google 帳號登入，
  確認進入同一帳號而非新帳號（SC-025）
  - **需人工**：要一組真實 Google 帳密，且完成授權會真的建立帳號
- **示範模式加驗**：確認 Google 按鈕為停用狀態並顯示原因，而非點了沒反應
  - 已由 `npm run test:google` 自動涵蓋（含服務層的第二道防線）

### 3. Booking flow [2M]
- Open a room detail page with valid dates
- Proceed through the three-step booking form (name, phone, email); go back one step
  and confirm entered data is preserved
- Confirm the 虛擬支付 notice is visible and no real card fields exist
- Submit and verify the order is created as **待付款** with a visible countdown
- Complete the simulated payment and verify the confirmation page and order number
- Try booking today's date → confirm it is rejected with 需提前一天 messaging
- Book 8/01–8/03, then book 8/03–8/05 on the same room → the second must succeed (相鄰不重疊)
- Book 8/02–8/04 on that room → must be rejected with 已無空房
- **資料庫模式加驗**：兩個瀏覽器視窗同時送出同一房源同一區間 → 恰好一筆成立（SC-020）

### 3b. Payment hold and expiry [2M]
- 先於後台把 `pending_payment_minutes` 改為最小值 5 分鐘，方便測試
- 建立一筆訂單後**不要付款**，以另一個帳號嘗試訂同一房源同一區間
  → 必須被拒（待付款同樣佔房，FR-097）
- 等待保留時間過去後再次搜尋 → 該區間必須重新可訂（SC-023）
- 回到原訂單嘗試付款 → 必須被拒並說明已逾期取消，且不產生重疊訂單（SC-024）
- 把參數改回 60 分鐘，確認既有訂單的到期時間**沒有**被改動（FR-101）

### 4. Refund flow [2M]
- Create an upcoming order and submit a refund request with a reason
- Confirm the order moves to 退款審核中 and cannot be resubmitted
- Verify admin approval and rejection states update the member view correctly
- After approval, confirm the date range becomes bookable again (SC-006)
- **資料庫模式加驗**：以會員 A 登入，嘗試以會員 B 的訂單 ID 讀取訂單 → 必須查無資料（SC-019）

### 5. Review moderation [2M]
- Submit a review on a completed stay
- Confirm the auto verdict and triggered rules are recorded, and that the review
  stays hidden on the public detail page regardless of that verdict (FR-103)
- Submit five sample reviews — 含不當字詞、過短、評分與內容矛盾、重複送件、正常 —
  and confirm each gets an explainable verdict with rule codes (SC-029)
- Confirm the UI calls this 「自動審核（規則式）」 and never says AI (FR-103a)
- Approve one from the admin panel and confirm it appears and the average rating updates
- Override an auto-rejected review and confirm it publishes, and that the override
  appears in the audit log (FR-103b)
- Delete a published review and confirm the average rating recomputes (FR-103c)
- **資料庫模式加驗**：登出後直接查詢評論資料 → 只能取得 approved 的評論（SC-007）

### 6. Admin workspace [2M]
- Sign in as `admin@sunny.com / admin123`
- Check the dashboard statistics
- Add or edit a room, change maintenance status, and ensure the frontend updates
- Try deleting a room that has future orders → confirm the warning and double confirmation
- Search orders, change an order status, and confirm the member view updates
- Sign in as a member and try to open an admin page → confirm it is blocked (SC-008)
- **資料庫模式加驗**：以會員身分直接嘗試寫入房源資料 → 必須被 RLS 拒絕

### 7. Export and content editing [2M]
- Export a report and verify the columns
- Simulate offline and export again → confirm the CSV fallback and the notice
- Export an empty filter result → confirm the no-data message and that no file downloads
- Edit the homepage title and image, then confirm the frontend updates

### 8. Risk score flow [2M]
- Open the **front-of-house** risk check page and upload a dark, a cluttered, and a
  normal photo
- Confirm the three risk levels are distinguishable (SC-016)
- Upload an invalid file type and an oversized file → confirm clear errors
- Confirm zero outbound network requests during analysis, in **both** modes (SC-015)
- **確認前台照片完全沒有進入 Supabase Storage 或任何資料表**（SC-030、FR-086）——
  這是不可放寬的底線，兩種模式都要驗

### 8b. Admin room quality check [2M]
- As admin, run a check on a specific room and confirm the 「此圖將公開顯示」
  confirmation appears **before** saving (FR-105)
- Open that room's detail page as a logged-out visitor → the date, level, three
  metrics, and image must be visible (FR-106)
- Re-check the same room and confirm the detail page shows the new result, and that
  the old image URL is no longer readable (FR-107)
- As a normal member, attempt to write a room check → must be rejected

### 9. Favorites [2M]
- As a guest, click a star → redirected to login, and after logging in the favorite
  completes on the original room (FR-093)
- Favorite two rooms, check 我的收藏 ordering (newest first), unfavorite one
- Reload and confirm the state persists
- **資料庫模式加驗**：以會員 A 嘗試讀取會員 B 的收藏 → 取不到任何資料
- Delete a favorited room as admin → the entry must disappear or show 已下架,
  never a broken card (FR-095)

### 10. Channel pricing (simulated) [2M]
- Open the channel comparison module and confirm the 模擬資料 banner is present (FR-110)
- Confirm rooms priced below the website rate are flagged as 賤賣預警, and the
  dashboard shows the unresolved count (FR-111)
- Confirm rooms priced at or above the website rate are **not** flagged
- Generate a complaint email template and confirm it contains room, channel, website
  price, channel price, and gap — plus the 系統不會代為寄送 notice (FR-112)
- Mark an alert as resolved and confirm it leaves the unresolved list and appears in
  the audit log (FR-113)
- **開啟開發者工具的 Network 面板，確認整個過程沒有任何連向 Agoda、Booking 或其他
  訂房平台的請求**（SC-028）

### 11. Audit log and system settings [2M]
- Make one room change and one settings change as admin, then open the audit log and
  confirm both appear with actor, time, action, target, and summary (SC-026)
- Filter by actor, action type, and date range
- Attempt to edit or delete a log entry from the UI → must be impossible
- **資料庫模式加驗**：以管理員身分直接對 `admin_logs` 送出 UPDATE 與 DELETE →
  兩者都必須失敗（SC-027）
- Confirm no log entry contains passwords, keys, or real personal data (FR-118)
- Set `pending_payment_minutes` to 0 and to 3000 → both must be rejected with the
  acceptable range shown (FR-119)
- As a normal member, attempt to read the audit log → must return nothing (FR-117)

### 12. Resilience [資料庫模式]
- Go offline mid-booking → confirm a clear message and that the filled form is preserved
- Leave the tab idle until the session expires, then act → confirm a re-login prompt rather than a blank screen

## Expected results

- Search and booking logic behaves correctly for overlapping dates, room state, and
  pending-payment holds
- The app remains fully functional without any build step, in both modes
- The interface clearly marks payment as simulated in both modes, clearly marks demo
  mode when active, and clearly marks the channel pricing module as simulated data
- Review moderation is presented as rule-based, never as AI
- Visitor-uploaded photos never leave the browser; only admin room-check images are stored
- Database mode enforces access rules at the database, not just in the UI
- The audit log cannot be modified by anyone, including admins
- Console shows zero errors and warnings throughout (SC-014)
