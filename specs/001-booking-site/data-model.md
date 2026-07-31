# Data Model: Sunny 訂房平台

## Overview

本功能有兩個資料後端，共用同一份實體定義：

| 模式 | 條件 | 儲存位置 | 認證 |
|---|---|---|---|
| **Supabase 模式**（預設） | `src/config.js` 已填入 URL 與 anon key | 託管 Postgres | Supabase Auth |
| **示範模式** | 憑證為空 | 瀏覽器 `localStorage` | 模擬登入（種子帳號） |

命名規則：**資料庫一律 snake_case，前端一律 camelCase**。轉換只發生在
`src/data/adapters/supabase.js` 內部；其餘程式碼只看得到 camelCase。
`localStorage` adapter 直接以 camelCase 儲存，鍵名為 `sunny.users`、`sunny.rooms`、
`sunny.orders`、`sunny.reviews`、`sunny.refunds`、`sunny.siteContent`。

日期欄位（`checkIn`、`checkOut`）在兩種模式下皆為 `YYYY-MM-DD` 字串，對應 Postgres
的 `date` 型別。轉換 MUST NOT 經過 `Date` 物件或 `toISOString()`，以免時區位移。

## Entity: users（認證身分）

由 **Supabase Auth 的 `auth.users` 管理，本專案不建立同名資料表、不持有密碼**。

| Field | Type | Notes |
|---|---|---|
| id | uuid | Supabase Auth 使用者 ID，為所有關聯的外鍵來源 |
| email | string | 唯一登入識別 |
| createdAt | string | ISO date/time string |

**Validation rules**:
- Email 由 Supabase Auth 保證唯一
- 密碼至少 6 個字元（Supabase Auth 預設下限）
- 密碼 MUST NOT 以任何形式存在於 `public` schema、前端狀態或匯出檔案中

**示範模式差異**：以 `sunny.users` 陣列模擬，含 `password` 明文欄位。該欄位
**僅存在於示範模式**，且介面 MUST 標示其登入為模擬。

## Entity: profiles（個人檔案）

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 主鍵，同時是 `auth.users(id)` 的外鍵 |
| role | `role` | enum | `member`, `admin`（`guest` 為未登入狀態，不入庫） |
| displayName | `display_name` | text | 顯示於頁首與訂單 |
| phone | `phone` | text | 選填聯絡電話 |
| createdAt | `created_at` | timestamptz | 建立時間 |

**Validation rules**:
- 每個 `auth.users` 恰有一筆 profile，由 trigger 於註冊時自動建立，預設 `role = 'member'`
- `displayName` 為必填，註冊時由表單帶入
- 使用者 MUST NOT 能自行修改自己的 `role`；僅管理員可變更他人角色

**Relationships**:
- One profile → many orders / reviews / refunds

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 本人；管理員可讀全部 |
| INSERT | 由 trigger 以 security definer 建立 |
| UPDATE | 本人（不含 `role` 欄位）；管理員可更新任何人任何欄位 |
| DELETE | 僅管理員 |

## Entity: rooms

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 房源唯一識別 |
| name | `name` | text | 房名 |
| type | `type` | text | 房型，例如 double / twin / suite |
| maxGuests | `max_guests` | integer | > 0 |
| nightlyPrice | `nightly_price` | integer | 新臺幣整數，> 0 |
| images | `images` | jsonb | 圖片網址字串陣列 |
| amenities | `amenities` | jsonb | 設施字串陣列（陽台、浴缸、免費 Wi-Fi…） |
| features | `features` | jsonb | 房型特色字串陣列（親子友善、寵物友善、無障礙…） |
| description | `description` | text | 文案 |
| status | `status` | enum | `available`, `booked`, `maintenance` |
| averageRating | `average_rating` | numeric(3,2) | 由通過審核的評論導出，無評論時為 `null` |
| createdAt | `created_at` | timestamptz | 建立時間 |

**Validation rules**:
- `nightlyPrice` 必須為新臺幣整數
- `maxGuests` 必須大於 0
- `status` 必須為允許值之一
- `averageRating` 無通過審核的評論時 MUST 為 `null`，前端顯示「尚無評分」而非 0 分

**Relationships**: One room → many orders / reviews

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 所有人（含未登入訪客） |
| INSERT / UPDATE / DELETE | 僅管理員 |

## Entity: orders

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 內部主鍵 |
| orderNo | `order_no` | text | 對使用者可見的唯一訂單編號 |
| userId | `user_id` | uuid | → `profiles(id)` |
| roomId | `room_id` | uuid | → `rooms(id)` |
| checkIn | `check_in` | date | `YYYY-MM-DD` |
| checkOut | `check_out` | date | `YYYY-MM-DD` |
| nights | `nights` | integer | `checkOut - checkIn` |
| guestCount | `guest_count` | integer | 入住人數 |
| contactName | `contact_name` | text | 訂房聯絡人 |
| phone | `phone` | text | 聯絡電話 |
| email | `email` | text | 聯絡電子郵件 |
| paymentMethod | `payment_method` | enum | `LINE Pay`, `credit-card`, `bank-transfer` |
| totalAmount | `total_amount` | integer | 成立時鎖定的新臺幣整數金額 |
| status | `status` | enum | `pending-payment`, `confirmed`, `refund-pending`, `refunded`, `cancelled`, `completed` |
| expiresAt | `expires_at` | timestamptz | 待付款保留到期時間；付款後不再有意義 |
| cancelReason | `cancel_reason` | text | 取消原因，逾期取消時為 `payment-timeout` |
| createdAt | `created_at` | timestamptz | 建立時間 |

**Validation rules**:
- `checkOut > checkIn`（資料庫 CHECK 約束）
- `checkIn` 至少為明日（前端驗證；資料庫不強制，以免既有測試資料失效）
- `guestCount <= room.maxGuests`（前端驗證 + 建立前重新查證）
- `totalAmount` 建立後不可變更
- 建立時 `expiresAt = now() + systemSettings.pendingPaymentMinutes`（預設 60）。
  之後調整系統參數 MUST NOT 改動既有訂單的 `expiresAt`
- **不重複預訂由資料庫保證**：`EXCLUDE USING gist (room_id WITH =,
  daterange(check_in, check_out, '[)') WITH &&) WHERE (status IN
  ('pending-payment', 'confirmed', 'refund-pending'))`。違反時 adapter MUST 轉譯為
  「此房源於所選日期已無空房」，MUST NOT 將原始資料庫錯誤顯示給使用者。
  **待付款也在排除條件內**，因此保留中的訂單同樣擋房。

**State transitions**:
- `pending-payment` → `confirmed`（完成模擬付款）
- `pending-payment` → `cancelled`（逾期，`cancel_reason = 'payment-timeout'`）
- `confirmed` → `refund-pending` → `refunded` 或退回 `confirmed`
- `confirmed` → `completed`（退房日已過）
- `confirmed` → `cancelled`（管理員）

**過期處理（關鍵）**：因為待付款訂單佔用房況，過期的訂單若不清理會永久擋房。
系統提供 `expire_stale_orders()` 函式，將 `status = 'pending-payment' AND
expires_at < now()` 的訂單改為 `cancelled`。此函式 MUST 於下列時機被呼叫：

1. 查詢房況／搜尋可訂房源之前
2. 建立訂單之前（否則排除約束會被殭屍訂單誤觸發）
3. 讀取訂單列表之前

不使用排程作業（憲章原則 II 禁止）。因此「自動取消」的可觀察時點是下一次有人查詢時。

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | `user_id = auth.uid()`；管理員可讀全部 |
| INSERT | 本人（`user_id` 必須等於 `auth.uid()`） |
| UPDATE | 管理員；會員僅能將自己的 `confirmed` 訂單轉為 `refund-pending` |
| DELETE | 僅管理員 |

## Entity: reviews

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 評論 ID |
| orderId | `order_id` | uuid | → `orders(id)`，UNIQUE（一訂單一評論） |
| roomId | `room_id` | uuid | → `rooms(id)` |
| userId | `user_id` | uuid | → `profiles(id)` |
| rating | `rating` | integer | 1–5 |
| comment | `comment` | text | 評論內容 |
| category | `category` | text | 例如 cleanliness / service / value |
| status | `status` | enum | `pending`, `approved`, `rejected` |
| autoVerdict | `auto_verdict` | enum | `auto-pass`, `auto-reject`；規則式自動審核的初判 |
| autoRules | `auto_rules` | jsonb | 觸發的規則代碼陣列，供管理員複核時參考 |
| adminNote | `admin_note` | text | 駁回說明，選填 |
| createdAt | `created_at` | timestamptz | 送出時間 |

**Validation rules**:
- 一筆訂單僅能有一則評論（UNIQUE 約束）
- 僅能對自己且退房日已過的訂單撰寫
- `rating` 介於 1–5
- 僅 `approved` 的評論會於前台公開並計入平均評分

**平均評分維護**：`rooms.average_rating` 由 trigger 於 `reviews` 新增／更新／刪除時
重算為該房源所有 `approved` 評論的平均，四捨五入至小數第一位；無評論時設為 `null`。
示範模式在 adapter 內以相同規則重算。

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 所有人可讀 `status = 'approved'`；本人可讀自己的全部；管理員可讀全部 |
| INSERT | 本人，且 `status` 必須為 `pending` |
| UPDATE | 僅管理員（審核） |
| DELETE | 僅管理員 |

## Entity: refunds

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 退款申請 ID |
| orderId | `order_id` | uuid | → `orders(id)` |
| userId | `user_id` | uuid | → `profiles(id)` |
| reason | `reason` | text | 申請原因 |
| amount | `amount` | integer | 依政策計算的退款金額 |
| status | `status` | enum | `pending`, `approved`, `rejected` |
| adminNote | `admin_note` | text | 審核說明，選填 |
| createdAt | `created_at` | timestamptz | 申請時間 |
| reviewedAt | `reviewed_at` | timestamptz | 審核時間，選填 |

**Validation rules**:
- 同一訂單同時僅能有一筆 `pending` 申請
  （部分唯一索引：`unique (order_id) where status = 'pending'`）
- 入住日已到或訂單已退款時不可申請
- 退款金額依政策計算：入住日前 7 天以上 100%、3–6 天 50%、1–2 天 20%、當日起 0%

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 本人；管理員可讀全部 |
| INSERT | 本人，且對應訂單必須屬於自己、`status` 必須為 `pending` |
| UPDATE | 僅管理員（審核） |
| DELETE | 僅管理員 |

## Entity: siteContent

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 固定為 `00000000-0000-0000-0000-000000000001`，全站僅一筆 |
| heroTitle | `hero_title` | text | 首頁標題 |
| heroSubtitle | `hero_subtitle` | text | 首頁副標 |
| heroImage | `hero_image` | text | 首頁主圖網址 |
| updatedAt | `updated_at` | timestamptz | 更新時間 |

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 所有人 |
| UPDATE | 僅管理員 |
| INSERT / DELETE | 不開放（單筆資料由 schema 初始化建立） |

## Entity: favorites（收藏）

| Field | DB column | Type | Notes |
|---|---|---|---|
| userId | `user_id` | uuid | → `profiles(id)`，複合主鍵之一 |
| roomId | `room_id` | uuid | → `rooms(id)`，複合主鍵之一 |
| createdAt | `created_at` | timestamptz | 收藏時間 |

**Validation rules**: 同一會員對同一房源至多一筆（複合主鍵保證）。
房源被刪除時對應收藏一併移除（`on delete cascade`）。

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT / INSERT / DELETE | 僅本人（`user_id = auth.uid()`） |
| UPDATE | 不開放（收藏無可更新欄位） |

## Entity: roomRiskChecks（房源品質檢測）

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 檢測 ID |
| roomId | `room_id` | uuid | → `rooms(id)` |
| brightness | `brightness` | integer | 0–100 |
| clutter | `clutter` | integer | 0–100 |
| contrast | `contrast` | integer | 0–100 |
| riskScore | `risk_score` | integer | `100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)` |
| riskLevel | `risk_level` | enum | `low`(0–34), `medium`(35–59), `high`(60–100) |
| imagePath | `image_path` | text | Supabase Storage 內的物件路徑 |
| checkedBy | `checked_by` | uuid | → `profiles(id)`，執行檢測的管理員 |
| createdAt | `created_at` | timestamptz | 檢測時間 |

**Validation rules**:
- 僅管理員可新增
- 房源詳情頁僅顯示該房源 `created_at` 最新的一筆
- 重新檢測後，舊紀錄的圖片 MUST 自 Storage 刪除，使其不再對外可讀取

**與前台安全檢測的區別**：前台使用者的檢測**不寫入此表**，也不產生任何 `imagePath`。
兩條程式路徑必須分離（憲章原則 VI）。

**Storage bucket `room-risk`**：公開讀取、僅管理員可寫入。
MUST NOT 允許 `authenticated` 一般會員上傳。

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 所有人（含未登入訪客） |
| INSERT / UPDATE / DELETE | 僅管理員 |

## Entity: channelPrices（渠道價格・模擬資料）

> ⚠️ 此表的資料為示範用種子資料，**非真實爬取**。系統不連線至任何外部訂房平台。

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 主鍵 |
| roomId | `room_id` | uuid | → `rooms(id)` |
| channel | `channel` | text | 平台名稱，例如 Agoda / Booking |
| channelPrice | `channel_price` | integer | 該平台售價（新臺幣整數） |
| capturedAt | `captured_at` | timestamptz | 模擬的擷取時間 |
| resolved | `resolved` | boolean | 管理員是否已處理此筆預警 |

**衍生值（不入庫，由查詢計算）**：
- 價差 = `rooms.nightly_price − channel_price`
- 是否賤賣 = `channel_price < rooms.nightly_price`

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT / INSERT / UPDATE / DELETE | 僅管理員 |

## Entity: adminLogs（操作日誌）

| Field | DB column | Type | Notes |
|---|---|---|---|
| id | `id` | uuid | 主鍵 |
| actorId | `actor_id` | uuid | → `profiles(id)`，操作者 |
| action | `action` | text | 動作類型，例如 `room.update`、`review.override` |
| targetTable | `target_table` | text | 對象資料表 |
| targetId | `target_id` | text | 對象識別 |
| summary | `summary` | jsonb | 變更摘要（欄位 → 新舊值） |
| createdAt | `created_at` | timestamptz | 時間 |

**Validation rules**:
- **僅可新增**：不提供 UPDATE 與 DELETE 政策，任何角色（含管理員）都無法修改或刪除
- `summary` MUST NOT 含密碼、金鑰或真實個資

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 僅管理員 |
| INSERT | 僅管理員 |
| UPDATE / DELETE | **無政策 = 全面禁止**（這是刻意的，不是遺漏） |

## Entity: systemSettings（系統參數）

| Field | DB column | Type | Notes |
|---|---|---|---|
| key | `key` | text | 主鍵，例如 `pending_payment_minutes` |
| value | `value` | jsonb | 參數值 |
| updatedAt | `updated_at` | timestamptz | 更新時間 |

**目前的參數**：

| key | 型別 | 預設 | 允許範圍 |
|---|---|---|---|
| `pending_payment_minutes` | integer | 60 | 5 – 1440 |

**RLS**:
| 動作 | 允許對象 |
|---|---|
| SELECT | 所有人（前端需知道保留時間以顯示倒數） |
| UPDATE | 僅管理員 |
| INSERT / DELETE | 不開放（參數由 schema 初始化建立） |

## Relationships summary

- `auth.users` 1:1 `profiles`
- `profiles` 1:N `orders` / `reviews` / `refunds` / `favorites` / `adminLogs`
- `rooms` 1:N `orders` / `reviews` / `favorites` / `roomRiskChecks` / `channelPrices`
- `orders` 1:1 `reviews`
- `orders` 1:N `refunds`（但同時僅一筆 `pending`）
- `profiles` N:M `rooms`（透過 `favorites`）

## Data access patterns

所有函式皆為**非同步**（回傳 Promise），兩個 adapter 實作相同簽章：

```text
// 讀取
getRooms(filters)              // filters 含 amenities[] 與 features[]（AND 邏輯）
getRoomById(id)
getOrders({ userId }), getOrderById(id)
getReviews({ roomId, status }), getRefunds({ status })
getSiteContent(), getProfile(userId), listProfiles()
getFavorites(userId)
getLatestRiskCheck(roomId), getRiskChecks({ roomId })
getChannelPrices({ unresolvedOnly }), getOrderStats(range)
getAdminLogs({ actorId, action, from, to })
getSystemSettings()

// 寫入
createOrder(input)             // 回傳 { order, expiresAt }
payOrder(id)                   // pending-payment → confirmed
updateOrderStatus(id, status)
submitReview(input)            // 內含規則式自動審核，寫入 autoVerdict / autoRules
moderateReview(id, decision, note), deleteReview(id)
requestRefund(input), moderateRefund(id, decision, note)
createRoom(input), updateRoom(id, patch), deleteRoom(id)
updateProfile(id, patch), setUserRole(id, role)
updateSiteContent(patch)
addFavorite(roomId), removeFavorite(roomId)
saveRoomRiskCheck({ roomId, metrics, imageBlob })   // 僅管理員
resolveChannelAlert(id), buildComplaintEmail(id)    // 後者為純前端字串組裝
updateSystemSetting(key, value)

// 認證
signUp({ email, password, displayName }), signIn({ email, password })
signInWithGoogle(), signOut(), getSession(), onAuthStateChange(handler)

// 維護
expireStaleOrders()   // 房況查詢、建立訂單、讀取訂單列表之前必須先呼叫
resetToSeed()         // 示範模式重建 localStorage；Supabase 模式對應 seed SQL
```

**規則**：
- 所有寫入皆經由這些函式，MUST NOT 有頁面直接呼叫 Supabase client 或
  讀寫 `localStorage`
- 資料庫錯誤 MUST 由 adapter 轉譯為具業務意義的錯誤（例如房況衝突、權限不足、
  離線），MUST NOT 讓原始錯誤字串外洩到介面
- **管理員的寫入函式 MUST 一併寫入 `adminLogs`**。日誌與變更 MUST 在同一次操作中
  完成，MUST NOT 出現「改了但沒記錄」的情況
- `saveRoomRiskCheck()` 是唯一會上傳圖片的函式。前台安全檢測 MUST NOT 呼叫它
- `buildComplaintEmail()` 僅組裝文字，MUST NOT 發送任何郵件
- `resetToSeed()` 在 Supabase 模式下需要管理員權限；一般會員呼叫時回傳權限不足
