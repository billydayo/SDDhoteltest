# Interface Contracts

**Revision 2026-07-31**: 本功能原先沒有任何外部介面。改用 Supabase 之後，
瀏覽器與託管 Postgres 之間存在真實的服務邊界，因此本文件改為記錄該邊界的契約。

## 邊界總覽

```text
瀏覽器 (index.html)
  └── src/data/repository.js          ← 唯一的資料存取入口
        ├── adapters/local.js         → localStorage（示範模式，無網路）
        └── adapters/supabase.js      → Supabase PostgREST / Auth（HTTPS）
```

只有 `adapters/supabase.js` 會跨越網路邊界。其他任何檔案 MUST NOT 直接呼叫
Supabase client。

## 外部服務契約

### 1. Supabase Auth

| 操作 | 呼叫 | 輸入 | 成功回傳 | 失敗情境 |
|---|---|---|---|---|
| 註冊 | `auth.signUp` | email, password, `options.data.display_name` | session + user | email 已存在、密碼少於 6 字元 |
| 登入 | `auth.signInWithPassword` | email, password | session + user | 帳密錯誤（訊息不得透露 email 是否存在） |
| Google 登入 | `auth.signInWithOAuth` | `{ provider: 'google' }` | 導向 Google 授權頁 | 使用者取消、provider 未啟用 |
| 登出 | `auth.signOut` | — | — | — |
| 取得工作階段 | `auth.getSession` | — | session 或 null | — |
| 監聽狀態 | `auth.onAuthStateChange` | handler | 取消訂閱函式 | — |

**設定前提**：
1. Authentication → Providers → Email 需**關閉** “Confirm email”，使註冊後帳號
   立即可用（本專案不寄送任何郵件）。
2. Authentication → Providers → Google 需啟用並填入 OAuth Client ID / Secret，
   同時把 Supabase 的 callback URL 加入 Google Cloud 的 Authorized redirect URIs。

**帳號合併**：Supabase Auth 以電子郵件識別同一使用者，因此密碼帳號與相同信箱的
Google 帳號會進入同一個 `auth.users`，`profiles` 僅有一筆（FR-088）。

**示範模式**：Google 按鈕 MUST 呈現為停用並說明原因。MUST NOT 假造第三方授權畫面
——那會誤導使用者（憲章原則 VI）。

**Session 儲存**：由 supabase-js 以 `persistSession: true` 存於 `localStorage`，
達成「關閉瀏覽器後仍保持登入」（FR-003）。

### 2. PostgREST 資料表存取

透過 `supabase.from('<table>')`。所有回應都受 RLS 過濾——**權限不足的結果是空集合或
錯誤，不是完整資料**。

| 資料表 | 讀 | 寫 |
|---|---|---|
| `profiles` | 本人 / 管理員全部 | 本人（不含 `role`）、管理員全部 |
| `rooms` | 所有人（含未登入） | 僅管理員 |
| `orders` | 本人 / 管理員全部 | 本人新增；會員限轉 `refund-pending`；管理員全部 |
| `reviews` | `approved` 公開；本人看自己全部；管理員全部 | 本人新增（限 `pending`）；審核僅管理員 |
| `refunds` | 本人 / 管理員全部 | 本人新增（限 `pending`）；審核僅管理員 |
| `site_content` | 所有人 | 僅管理員 |
| `favorites` | 僅本人 | 僅本人新增／刪除（無 UPDATE 政策） |
| `room_risk_checks` | 所有人（含未登入） | 僅管理員 |
| `channel_prices` | 僅管理員 | 僅管理員 |
| `admin_logs` | 僅管理員 | 僅管理員**新增**；UPDATE / DELETE 無政策且已 REVOKE |
| `system_settings` | 所有人（前端需知道保留分鐘數） | 僅管理員 |

完整欄位與政策定義見 [data-model.md](../data-model.md) 與
[`supabase/schema.sql`](../../supabase/schema.sql)。

### 3. 資料庫函式（RPC）

| 函式 | 呼叫時機 | 說明 |
|---|---|---|
| `expire_stale_orders()` | 查詢房況前、建立訂單前、讀取訂單列表前 | 將逾期的待付款訂單改為 `cancelled` 並釋出房況，回傳受影響筆數 |
| `pending_payment_minutes()` | `orders.expires_at` 的預設值 | 讀取目前的保留分鐘數 |

`expire_stale_orders()` 由 repository 層負責呼叫，MUST NOT 交由個別頁面自行決定。
漏呼叫的後果是過期訂單持續擋房，且使用者會看到「已無空房」但實際上房是空的。

### 4. Supabase Storage

| Bucket | 讀取 | 寫入 | 內容 |
|---|---|---|---|
| `room-risk` | 公開 | 僅管理員 | 管理員對自家房源的品質檢測圖，公開顯示於房源詳情頁 |

前台「安全檢測」的照片 **MUST NOT** 進入此 bucket 或任何 bucket。該路徑在程式碼中
完全沒有上傳函式可用（`pages/risk-check.js` 不 import `services/risk-upload.js`）。

### 5. 錯誤轉譯契約

`adapters/supabase.js` MUST 把資料庫層錯誤轉為業務錯誤，MUST NOT 讓原始訊息外洩：

| 資料庫訊號 | 轉譯為 | 使用者可見訊息 |
|---|---|---|
| `23P01` exclusion violation（`orders_no_overlap`） | `ROOM_UNAVAILABLE` | 此房源於所選日期已無空房 |
| `23505` unique violation（`refunds` pending 索引） | `REFUND_ALREADY_PENDING` | 此訂單已有審核中的退款申請 |
| `23505` unique violation（`reviews.order_id`） | `REVIEW_ALREADY_EXISTS` | 此訂單已撰寫過評論 |
| `42501` 且訊息含「無法付款」（`guard_order_transition`） | `ORDER_EXPIRED` | 此訂單已因逾期未付款而取消，請重新訂房 |
| `42501` 且訊息含「僅管理員可變更角色」 | `ROLE_FORBIDDEN` | 你沒有權限變更角色 |
| `42501` / RLS 拒絕、空結果 | `FORBIDDEN` | 你沒有權限執行此操作 |
| `23514` check violation（`settings_valid_range`） | `SETTING_OUT_OF_RANGE` | 保留時間需介於 5 至 1440 分鐘 |
| `23505` unique violation（`favorites` 主鍵） | `ALREADY_FAVORITED` | 已在收藏清單中（前端應視為成功） |
| `PGRST301` / JWT 過期 | `SESSION_EXPIRED` | 登入已逾時，請重新登入 |
| 網路錯誤、逾時 | `NETWORK_ERROR` | 目前無法連線，請稍後再試（已保留你填寫的內容） |
| 憑證無效（401 於啟動時） | `CONFIG_ERROR` | 資料庫設定有誤，請檢查 `src/config.js` |

`CONFIG_ERROR` MUST NOT 靜默退回示範模式（FR-084）。

### 6. 不使用的能力

明確不在本次範圍內，且 MUST NOT 被引入：

- **Realtime** — 「即時反映」定義為下次查詢即可見，不做推播訂閱
- **Edge Functions / Database Webhooks / pg_cron** — 等同自建後端服務，
  違反憲章原則 II。逾期訂單改以 `expire_stale_orders()` 於查詢時判定
- **service_role key** — 任何情況下都不得出現於前端或版控（FR-085）
- **email 相關流程** — 不寄送驗證信、密碼重設信、通知信或申訴信。
  渠道控價的申訴郵件僅產生範本供管理員自行複製寄出（FR-112）
- **Storage（除 `room-risk` 外）** — 房源展示照片以圖片網址提供，不做檔案上傳
- **任何 OTA 平台的爬蟲或 API** — 渠道價格為種子資料（FR-109）。
  跨網域抓取會被 CORS 擋下，伺服器端抓取需自建後端且可能違反對方服務條款
- **任何 LLM / AI 服務** — 評論自動審核為規則式引擎（FR-103a）。
  前端無處可安全存放 AI 服務金鑰

## 本機介面（不跨網路）

- SPA 內的 DOM 事件與路由切換
- 示範模式的 `localStorage` 狀態管理（鍵名前綴 `sunny.`）
- 拍照風險評分的 Canvas 處理，全程在瀏覽器內完成
- 報表匯出的 SheetJS／CSV fallback
