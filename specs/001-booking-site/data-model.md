# Data Model: Sunny 訂房平台

**Date**: 2026-08-03 | **Plan**: [plan.md](./plan.md) | **憲章**: v3.1.1

## Overview

系統只有一個資料後端：PostgreSQL，且只有一個存取者：FastAPI。
前一版的「Supabase 模式／示範模式」雙軌結構已隨憲章 v3.0.0 移除。

命名規則：**資料庫一律 snake_case，前端一律 camelCase**。轉換 MUST 只發生在
Pydantic 模型的序列化設定中（憲章原則 III），MUST NOT 散落於各路由。

---

## 本次架構變更對資料模型的影響

### 唯一的結構性變更：`profiles` 取回身分欄位

前一版的身分資料分居兩處——`auth.users`（Supabase 管理，含 email 與密碼）與
`public.profiles`（應用資料）。`auth.users` 隨 Supabase 移除後，`profiles` MUST 取回這些欄位。

```diff
  create table profiles (
-   id uuid primary key references auth.users(id) on delete cascade,
+   id uuid primary key default gen_random_uuid(),
+   email text not null unique,
+   password_hash text,
+   google_sub text unique,
    role text not null default 'member' check (role in ('member','admin')),
    display_name text not null default '',
    phone text,
    created_at timestamptz not null default now()
  );
```

**`password_hash` 為什麼可為 null**：僅以 Google 註冊的使用者沒有密碼。
設為 NOT NULL 就得為這類帳號填入某個假值，而那個假值遲早會被某段程式碼當成可比對的
雜湊。可為 null 讓「這個帳號沒有密碼」成為可表達的狀態。登入流程 MUST 明確處理
`password_hash is null`（回覆「此帳號請以 Google 登入」），
MUST NOT 讓它落入一般的密碼比對失敗分支。

**`email` 的唯一約束是 FR-088 的承載者**：以既有電子郵件的 Google 帳號登入時必須
進入同一帳號。實作以 email 查既有 profile 並補上 `google_sub`，唯一約束確保不會
出現第二筆。

**`password_hash` MUST NOT 出現在任何 Pydantic 回應模型中。** MUST 以獨立的
`ProfileOut` 明列輸出欄位，MUST NOT 用 `from_attributes` 把 ORM 物件全欄位倒出去。
前一版靠「資料表根本沒有密碼欄位」來保證這件事，那層保護已經沒有了。

### 其餘 11 張表：欄位、型別、CHECK、索引全部不變

變更只在認證與授權層：

- 移除 38 條 RLS 政策（授權移至 FastAPI）
- 移除 `is_admin()`、`handle_new_user()`、`on_auth_user_created`
- 改寫 `stamp_review_reply()`、`stamp_message_sender()`：原以 `auth.uid()` 取得操作者，
  改為由後端明確傳入
- 拆解 `guard_order_transition()`：見下方 orders 一節

---

## 實體

### profiles（會員）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | 自有主鍵 |
| `email` | text NOT NULL UNIQUE | 登入識別；FR-088 的關鍵 |
| `password_hash` | text NULL | argon2id；Google-only 帳號為 null |
| `google_sub` | text NULL UNIQUE | Google subject id |
| `role` | text | `member` / `admin` |
| `display_name` | text | |
| `phone` | text NULL | |
| `created_at` | timestamptz | |

**角色升級**：`role` MUST 只能由管理員端點變更，且 MUST 進 `admin_logs`。
原 `prevent_role_escalation()` trigger 依賴 `is_admin()`，其職責移至 FastAPI。

### rooms（房源）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `name` / `type` / `description` | text | |
| `max_guests` | integer > 0 | |
| `nightly_price` | integer > 0 | **整數新臺幣元** |
| `images` / `amenities` / `features` | jsonb 陣列 | 後兩者有 GIN 索引供篩選 |
| `status` | text | `available` / `maintenance` |
| `average_rating` | numeric(3,2) NULL | **null = 尚無評分，不可用 0 表示** |

**`status` 沒有 `booked`**：「已預訂」綁定日期，由當日訂單即時推導（FR-015、FR-051a）。
寫成欄位就得在退房時改回來，漏改一次該房源就永久無法販售。

**設施篩選採 AND 邏輯**（須同時具備所選全部設施），以 jsonb 包含運算子搭配 GIN 索引。

### orders（訂單）— 本模型的核心

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `order_no` | text UNIQUE | `SN` + 台北日期 + 序號 |
| `user_id` / `room_id` | uuid FK | |
| `check_in` / `check_out` | **date** | 日曆日，無時區成分 |
| `nights` | integer > 0 | |
| `guest_count` | integer > 0 | |
| `contact_name` / `phone` / `email` | text | |
| `payment_method` | text | `LINE Pay` / `credit-card` / `bank-transfer` |
| `total_amount` | integer ≥ 0 | **整數；MUST NOT 用 float** |
| `status` | text | 見下方狀態機 |
| `expires_at` | timestamptz | 預設 `now() + pending_payment_minutes()` |
| `cancel_reason` | text NULL | |

**排除約束（MUST 原樣保留）**：

```sql
exclude using gist (
  room_id with =,
  daterange(check_in, check_out, '[)') with &&
) where (status in ('pending-payment', 'confirmed', 'refund-pending'))
```

需 `btree_gist` 擴充（供 `room_id with =` 的等值比對），MUST 於初始 revision 最先建立。

**四個會產生 `IntegrityError` 的物件**：

| 名稱 | 內容 | 使用者訊息 | HTTP |
|---|---|---|---|
| `orders_no_overlap` | gist 排除約束 | 「此房源於所選日期已無空房」 | **409** |
| `valid_date_range` | `check_out > check_in` | 「退房日必須晚於入住日」 | 400 |
| `nights_matches_dates` | `nights = check_out - check_in` | 內部錯誤（後端算錯） | 500 |
| `order_no` 唯一 | 序號碰撞 | 內部錯誤 | 500 |

**MUST 以約束名稱分派，不可只看例外型別。** 否則「夜數對不上」會被回成
「已無空房」，使用者照著訊息改日期永遠改不好。每個名稱 MUST 有對應單元測試。

**狀態機**：

```
pending-payment ──付款──→ confirmed ──退房日過──→ completed
      │                        │
      │逾期                     │申請退款
      ↓                        ↓
  cancelled              refund-pending ──核准──→ refunded
                                  │駁回
                                  ↓
                             confirmed
```

**佔用房況的狀態**：`pending-payment`、`confirmed`、`refund-pending`
（即約束 `where` 子句所列）。`cancelled`、`refunded` 釋出區間。
`completed` 不在約束內——退房日已過，該區間本就不會與新訂單重疊。

**狀態轉換守門的拆解**：原 `guard_order_transition()` 做兩件事，本次拆開：

| 職責 | 依賴 | 新位置 |
|---|---|---|
| 管理員可自由變更狀態 | `is_admin()` → `auth.uid()` | **移至 FastAPI** |
| 不得對已逾期訂單付款 | 只需比對 `expires_at` | **保留於資料庫 trigger** |
| 不得從任意狀態跳到已確認 | 只需比對新舊狀態 | **保留於資料庫 trigger** |

後兩者不需要知道「誰」在操作，因此不受認證變更影響，MUST 留在資料庫。

### reviews（評論）

`order_id` 為 UNIQUE FK——一筆訂單只能評論一次。`rating` 1–5。
`status`：`pending` / `approved` / `rejected`。

**自動審核欄位**：`auto_verdict`（`auto-pass` / `auto-reject`）與 `auto_rules`
（觸發的規則代碼陣列，供管理員複核）。**這是規則式引擎，不是 AI**——
介面 MUST 標示為「自動審核（規則式）」（憲章原則 VI）。

**本次變更**：規則式引擎由瀏覽器**移至後端**。審核結果決定評論是否公開，屬授權範圍
內的決定；留在前端等於讓使用者自行決定自己的評論過不過審。

**業者回覆**：`admin_reply`（1–1000 字）、`admin_reply_at`、`admin_reply_by`。
掛在評論上而非某位管理員名下——回覆代表店家，換人接手不必轉交。
原由 `stamp_review_reply()` 以 `auth.uid()` 蓋章，改為後端明確傳入。

**評分連動**：`refresh_room_rating()` trigger 保留（純 PostgreSQL），
於評論狀態變更時重算 `rooms.average_rating`。

### refunds（退款申請）

`amount` 整數。`status`：`pending` / `approved` / `rejected`。
退款金額依距入住日分級（7 天以上全額／3–6 天 50%／1–2 天 20%／當日起 0%）。

**額度限制**：`enforce_refund_limit()` trigger 保留（純 PostgreSQL）。每位會員上限 5 筆；
**被駁回的申請不佔用額度**（SC-031）。未達上限時介面 MUST NOT 顯示
「已使用／剩餘次數」（SC-032）。

### favorites（收藏）

複合主鍵 `(user_id, room_id)`，依 `created_at` 由新到舊排序。

### room_risk_checks（房源品質檢測）

`brightness` / `clutter` / `contrast` / `risk_score` 皆 0–100，
`risk_level` 為 `low` / `medium` / `high`，`image_path` 指向已上傳的檢測圖，
`checked_by` 為執行檢測的管理員。

**只有管理員路徑會寫入此表。** 前台「安全檢測」MUST NOT 產生任何此表資料列
（FR-086、SC-030）——前端根本沒有對應的上傳函式可呼叫（見 [research R8](./research.md)）。

### channel_prices（渠道比價・模擬資料）

`channel`、`channel_price`、`captured_at`、`resolved`。
**資料來自種子，非真實爬取。** 介面 MUST 常駐標示為模擬。

限制的理由已於本次更新：**不是技術做不到（現在有後端了），而是爬取 OTA 平台
通常違反其服務條款**。見 [research B1-a](./research.md)。

### admin_logs（稽核日誌）

`actor_id`、`action`、`target_table`、`target_id`、`summary`(jsonb)。

**僅可新增**：任何角色皆 MUST NOT 能更新或刪除，含管理員本人。
原以「不建立 UPDATE/DELETE 政策」的 RLS 方式實作。**RLS 移除後 MUST 改以資料表權限**：

```sql
REVOKE UPDATE, DELETE ON public.admin_logs FROM <app_role>;
```

⚠️ **這是本次遷移最容易漏掉的一項**——RLS 一併刪除時，這個保證會跟著消失，
而且不會有任何錯誤訊息，日誌只是變得可以竄改。憲章 v3.1.1 已將其列入
「不依賴身分的資料庫保證 MUST 保留」。SC-027 MUST 有對應測試。

日誌 MUST NOT 記錄密碼、秘鑰或真實個資。

### messages（會員訊息）

`thread_user_id` 永遠是那位會員，`sender_id` + `sender_role` 標示發話方。
不存 recipient——存了就得回答「哪一位管理員」，而那正是不想綁定的東西。
`body` 1–2000 字。`guard_message_update()` 保留（純 PostgreSQL）；
`stamp_message_sender()` 改為後端明確傳入寄件者。

### site_content（網站內容）

單列表，主鍵固定為 `00000000-0000-0000-0000-000000000001`，
由 `site_content_singleton` CHECK 強制。

### system_settings（系統參數）

`key` / `value`(jsonb) / `updated_at`。目前的參數為未付款訂單保留分鐘數，
由 `pending_payment_minutes()` 讀取（純 PostgreSQL，保留）。

參數變更 MUST 有範圍檢查且 MUST 進稽核日誌。
**MUST NOT 回溯影響既有訂單**——`expires_at` 於建單時已寫入。

---

## 逾期判定的呼叫點

`expire_stale_orders()`（純 PostgreSQL，保留）MUST 在以下三處之前執行：

1. 查詢房況（搜尋可訂房源）
2. 建立訂單
3. 讀取訂單列表

**MUST 於 repository 層內部呼叫**，MUST NOT 交由各路由自行記得——
新增路由的人不需要知道它們存在，這正是集中的目的。

不使用排程作業（憲章原則 IV）。取捨：「自動取消」的可觀察時點是下一次有人查詢時，
而非到期的那一秒。已載於 spec.md 的 Assumptions。

---

## 關聯

```
profiles ─┬─< orders >─── rooms
          ├─< reviews ──── orders (1:1)
          ├─< refunds ──── orders
          ├─< favorites >─ rooms
          ├─< messages（thread_user_id 與 sender_id 皆指向 profiles）
          ├─< admin_logs (actor_id)
          └─< room_risk_checks (checked_by) >─ rooms

rooms ─< channel_prices
site_content / system_settings：獨立
```

- `orders` 1:1 `reviews`；`orders` 1:N `refunds`（但同時僅一筆 `pending`）
- `profiles` N:M `rooms`（透過 `favorites`）
- **`profiles` 不再與任何外部認證表關聯**——它自己就是身分來源

刪除行為：`rooms` 被 `orders` 以 `on delete restrict` 保護——有訂單的房源不可刪除。

---

## 資料存取規則

所有存取集中於 `backend/src/sunny/repositories/`（憲章原則 III）。

- 前端 MUST 透過 `frontend/src/api/client.ts` 呼叫，MUST NOT 於元件內直接 `fetch`
- 後端 MUST NOT 讓 SQL 或 ORM 查詢散落於路由處理函式中
- 資料庫錯誤 MUST 轉譯為具業務意義的訊息，MUST NOT 讓原始錯誤字串、SQL 或內部路徑
  外洩到用戶端
- **管理員的每一次寫入 MUST 一併寫入 `admin_logs`**，且 MUST 與變更在同一個交易內
  完成，MUST NOT 出現「改了但沒記錄」
- 上傳圖片的能力**只存在於管理端路徑**。前台安全檢測沒有對應端點可呼叫
- 申訴郵件僅組裝文字，MUST NOT 發送任何郵件

---

## 型別對應

| PostgreSQL | SQLAlchemy | Pydantic | TypeScript | JSON |
|---|---|---|---|---|
| `uuid` | `Mapped[UUID]` | `UUID` | `string` | 字串 |
| `date` | `Mapped[date]` | `datetime.date` | `string` | `"YYYY-MM-DD"` |
| `timestamptz` | `Mapped[datetime]` | `datetime` | `string` | ISO 8601 |
| `integer`（金額） | `Mapped[int]` | `int` | `number` | 整數 |
| `numeric(3,2)` | `Mapped[Decimal \| None]` | `Decimal \| None` | `number \| null` | 數值或 null |
| `jsonb` | `Mapped[list \| dict]` | `list[...]` / `dict` | 對應型別 | 陣列或物件 |
| `text` | `Mapped[str]` | `str` | `string` | 字串 |

**日期與金額是最容易出錯的兩列**：

- 後端 MUST 使用 `datetime.date` 承載日曆日，MUST NOT 用 `datetime.datetime`
- 前端 MUST NOT 用 `new Date("2026-08-03")` 解析日曆日——該建構式視字串為 UTC，
  在台北時區顯示時會退成前一天
- 金額全程 `integer` → `int` → JSON 整數，**MUST NOT 經過 `float`**
