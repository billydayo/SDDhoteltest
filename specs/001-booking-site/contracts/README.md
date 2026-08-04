# Interface Contracts

**Date**: 2026-08-03 | **Plan**: [../plan.md](../plan.md) | **憲章**: v3.1.1

> **Revision 2026-08-03**: 邊界由「瀏覽器 ↔ Supabase PostgREST/Auth」改為
> 「React SPA ↔ FastAPI」。前一版契約（Supabase Auth、PostgREST、Storage、RLS）
> 已全部作廢。

## 邊界總覽

```text
React SPA
  └── src/api/client.ts              ← 唯一的網路出口
        └── HTTP + JSON              ← 本文件所描述的邊界
              └── FastAPI
                    └── repositories/  ← 唯一的資料庫出口
                          └── PostgreSQL
```

**兩條規則**：
- 前端 MUST NOT 於元件內直接 `fetch`；所有請求經 `api/client.ts`
- 前端 MUST NOT 連線資料庫或任何資料服務——它連 PostgreSQL 的位址都不知道

## 契約的權威來源

**本文件不是契約本身。** 契約是 FastAPI 依 Pydantic 模型自動產生的 **OpenAPI 文件**
（`/openapi.json`，互動式介面於 `/docs`）。本文件記錄的是那份契約必須遵守的**約定**。

前端 MUST NOT 依賴任何未出現於 OpenAPI 的隱含行為（憲章原則 II）。

---

## 通用約定

### 認證

| 項目 | 約定 |
|---|---|
| 形式 | JWT Bearer token |
| 標頭 | `Authorization: Bearer <token>` |
| 存放 | 前端 `localStorage`（憲章原則 III 允許 token，禁止業務資料） |
| 附加 | 由 `api/client.ts` 統一附加，MUST NOT 由各元件自行處理 |
| 過期 | API 回 401 → client 統一攔截 → 導向登入頁並保留原目的地（FR-009d） |

### 授權

**每個路由 MUST 明確宣告其授權要求。** 預設不是「公開」而是「需登入」——
新增路由時忘記標註 MUST 導致拒絕而非放行。

| 層級 | 相依 | 適用 |
|---|---|---|
| 公開 | 無（須明確標註） | 房源瀏覽、搜尋、已通過審核的評論、服務條款 |
| 需登入 | `get_current_user` | 訂單、收藏、評論送出、退款、個人檔案、訊息 |
| 需管理員 | `require_admin` | 全部後台端點 |

移除 RLS 後**這是唯一的存取邊界**（[research R1](../research.md)）。

### 錯誤格式

所有錯誤回應 MUST 為結構化 JSON：

```json
{ "detail": "使用者可理解的繁體中文訊息", "code": "ROOM_UNAVAILABLE" }
```

**逐欄的輸入錯誤 MUST 另帶 `field`**，前端據此把焦點移至第一個有問題的欄位
（FR-010）：

```json
{ "detail": "填寫入住日時，退房日也需一併填寫。", "code": "INCOMPLETE_DATE_FILTER", "field": "checkOut" }
```

⚠️ **`field` MUST 為請求上的名稱，即 camelCase。** 領域層內部寫的是
`check_out`（Python／資料庫命名），由例外處理器在邊界轉換。回一個 `check_out`
等於指向請求裡不存在的欄位——前端拿它找輸入框會找不到，**焦點安靜地不動**，
而畫面上只是「錯誤訊息出現了但游標沒動」，沒有人會把它當成 bug 回報。

無法對應到單一欄位的錯誤（`ROOM_UNAVAILABLE`、`INVALID_SORT` 以外的一般失敗）
省略 `field`，由前端顯示為整體訊息。

MUST NOT 回傳堆疊追蹤、SQL 語句或內部檔案路徑（憲章後端約束）。

| 狀態碼 | 用途 |
|---|---|
| 400 | 輸入驗證失敗 |
| 401 | 未認證或 token 過期 |
| 403 | 已認證但權限不足 |
| 404 | 資源不存在 |
| **409** | **與其他資料的競態衝突（房況重疊、email 已註冊）** |
| 422 | Pydantic 驗證失敗（FastAPI 預設） |
| 500 | 內部錯誤；MUST NOT 洩漏細節 |

### 資料型別

| 概念 | 線上格式 | 說明 |
|---|---|---|
| 日曆日 | `"YYYY-MM-DD"` | 無時區成分。前端 MUST NOT 用 `new Date(str)` 解析 |
| 時間點 | ISO 8601 | `expires_at`、`created_at` 等 |
| 金額 | JSON 整數 | 新臺幣元。**MUST NOT 出現小數** |
| 識別碼 | UUID 字串 | |

### CORS

允許來源 MUST 明確列出。**MUST NOT 使用 `allow_origins=["*"]` 搭配
`allow_credentials=True`**（憲章後端約束）。

---

## 關鍵端點的行為約定

以下不是完整端點清單（那是 OpenAPI 的職責），而是**容易做錯、必須寫死的行為**。

### `POST /auth/register`

| 情境 | 回應 |
|---|---|
| 成功 | 201 + token |
| email 已存在 | **409**，訊息「此電子郵件已被註冊」（FR-002） |
| 密碼少於 6 字元 | 400，明確說明長度不足（FR-009b） |

密碼 MUST 以 argon2id 雜湊後存入。回應 MUST NOT 包含 `password_hash`。

### `POST /auth/login`

| 情境 | 回應 |
|---|---|
| 成功 | 200 + token |
| 帳號不存在 **或** 密碼錯誤 | 401，訊息**一律相同**：「電子郵件或密碼錯誤」 |
| 該帳號 `password_hash` 為 null | 401，訊息「此帳號請以 Google 登入」 |

⚠️ **兩種失敗必須無法區分**（FR-004）：訊息、狀態碼與**回應時間**都不得洩漏該 email
是否已註冊。帳號不存在時 MUST 仍執行一次雜湊比對（對虛設值），否則回應時間差
會構成帳號列舉管道。

### `GET /auth/google` → `GET /auth/google/callback`

Authorization Code Flow。**client secret MUST 只存在於後端環境變數。**

| 情境 | 行為 |
|---|---|
| 該 email 已有帳號 | **進入既有帳號**，補上 `google_sub`。MUST NOT 建立第二筆（FR-088） |
| 全新 email | 建立帳號，`password_hash` 為 null |
| 使用者於 Google 取消 | 導回登入頁並顯示「已取消登入」，MUST NOT 建立任何帳號（FR-090） |

### `GET /rooms`（搜尋）

公開。查詢參數：關鍵字、`check_in`、`check_out`、`guest_count`、價格上限、
`amenities[]`、`features[]`、排序。

**條件式必填**（FR-010）：
- 三者（入住日／退房日／人數）皆空 → 正常搜尋
- 填了入住日或退房日任一 → 另一個與人數 MUST 一併填寫
- 未填日期但填了人數 → 正常搜尋
- 人數只要有填 MUST 為大於 0 的整數

**MUST 於查詢前呼叫 `expire_stale_orders()`**，否則已逾期的訂單仍會佔用房況。

`status = 'maintenance'` 的房源 MUST 與「已預訂」等同排除。

### `POST /orders`（建立訂單）

需登入。**這是全系統最需要小心的端點。**

後端 MUST 重新計算並驗證，MUST NOT 信任用戶端送來的任何結論：

| 項目 | 規則 |
|---|---|
| 入住日 | MUST ≥ 明日（Asia/Taipei） |
| 退房日 | MUST > 入住日 |
| 夜數 | 後端計算，MUST NOT 採用用戶端值 |
| 總金額 | 後端依當下房價計算，MUST NOT 採用用戶端值 |
| 房況 | 資料庫約束裁決 |

**約束例外的分派（MUST 以約束名稱比對）**：

| 約束 | 回應 |
|---|---|
| `orders_no_overlap` | **409**「此房源於所選日期已無空房」 |
| `valid_date_range` | 400「退房日必須晚於入住日」 |
| `nights_matches_dates` | 500（後端算錯，非使用者問題） |
| `order_no` 唯一 | 500（序號碰撞） |

⚠️ 四者都是 `IntegrityError`。只看例外型別會把「夜數對不上」回成「已無空房」，
使用者照著訊息改日期永遠改不好。

回應含 `expires_at`，供前端顯示付款倒數。

### `POST /orders/{id}/pay`

需登入且 MUST 為訂單擁有者。

| 情境 | 回應 |
|---|---|
| 成功 | 200，狀態轉為 `confirmed` |
| 已逾期 | 409，說明保留時間已過且該區間可能已被他人預訂 |
| 非本人訂單 | **403**（不是 404——擁有者檢查失敗與資源不存在是不同的事） |

「不得對已逾期訂單付款」由資料庫 trigger 守門（[data-model](../data-model.md)）。

**MUST NOT 串接任何真實金流。** MUST NOT 接收或儲存真實卡號、有效期限、CVV
或銀行帳號（憲章原則 VI）。

### `POST /reviews`

需登入。訂單 MUST 屬於該使用者且 MUST 為 `completed`。一筆訂單只能評論一次
（`order_id` UNIQUE → 重複時回 409）。

**規則式自動審核於後端執行**，寫入 `auto_verdict` 與 `auto_rules`。
回應 MUST 標示為「自動審核（規則式）」，**MUST NOT 稱為 AI**（憲章原則 VI）。
判定 MUST 可被管理員複核與覆寫。

### `POST /admin/rooms/{id}/risk-checks`

**需管理員。這是系統中唯一接收圖片的端點。**

MUST 檢查檔案大小與 MIME 類型。圖片 MUST 已於瀏覽器內壓縮後才送出。

⚠️ **前台的「安全檢測」沒有對應端點。** 使用者自行上傳的照片 MUST 全程留在瀏覽器
（FR-086、SC-030）。前端亦 MUST NOT 存在任何能呼叫此端點的前台程式路徑
（[research R8](../research.md)）。

### 後台寫入端點（通則）

所有管理員的變更 MUST 於**同一個交易內**寫入 `admin_logs`，
MUST NOT 出現「改了但沒記錄」。

`admin_logs` MUST NOT 有任何 UPDATE 或 DELETE 端點——連管理員也不行（SC-027）。
資料庫層以 `REVOKE UPDATE, DELETE` 強制。

### `GET /admin/channel-prices`

需管理員。資料來自 `channel_prices` 種子表。

**MUST NOT 實作爬蟲，MUST NOT 呼叫任何 OTA API。** 回應 MUST 帶有標示其為模擬資料的
欄位，供前端常駐顯示。理由是**服務條款，不是技術限制**——後端的存在不改變這一點
（[research B1-a](../research.md)）。

---

## 不存在的端點

以下刻意不提供，列出以免日後被當成遺漏：

| 端點 | 原因 |
|---|---|
| 前台照片上傳 | FR-086：使用者照片不得離開瀏覽器 |
| `admin_logs` 的 UPDATE / DELETE | 僅可新增，連管理員也不行 |
| 任何回傳 `password_hash` 的端點 | 憲章原則 VI |
| 真實金流、簡訊、寄信 | 皆為模擬或不在範圍 |
| OTA 價格擷取 | 服務條款風險 |
| LLM 審核 | 規則式引擎替代 |
| 排程觸發 | 逾期改以查詢時判定（憲章原則 IV） |
