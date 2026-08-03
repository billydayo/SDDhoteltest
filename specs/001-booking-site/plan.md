# Implementation Plan: Sunny 訂房平台

**Branch**: `python-impl` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-booking-site/spec.md`

**Revision 2026-08-03**: 技術堆疊全面更換，對應憲章 **v3.1.1**。前端由原生 JS 改為
React + TypeScript + Tailwind + Vite；後端由「瀏覽器直連 Supabase」改為自建的
Python FastAPI；資料存取改用 SQLAlchemy 2.0 ORM + Alembic；示範模式移除；
RLS 全數移除，授權邊界移至 FastAPI。前一版計畫（v2.3.0 對應）已完全作廢。

## Summary

單一飯店的線上訂房平台，含訪客瀏覽與搜尋、會員註冊登入、三步驟訂房與模擬付款、
退款申請、評論審核、十二個後台模組，以及瀏覽器內的拍照風險預測。

**架構**：前後端分離。React SPA 只與 FastAPI 溝通，FastAPI 獨佔資料庫存取。
系統只有一種運作模式——無示範模式、無本機儲存降級路徑。

**本次交付的性質**：這不是新功能，是**同一組需求的重新實作**。需求（89 條 FR、
31 條 SC）在前一版堆疊上已完整驗收通過。計畫的重心因此不是「要做什麼」，
而是「哪些保證必須在換堆疊後依然成立」，以及「哪些既有資產能安全帶過去」。

## Technical Context

**Language/Version**:
- 後端：Python 3.12+
- 前端：TypeScript 5.x / ES2022

**Primary Dependencies**:

| 用途 | 套件 | 憲章依據 |
|---|---|---|
| Web 框架 | FastAPI | 原則 II |
| ASGI 伺服器 | uvicorn | — |
| ORM | SQLAlchemy 2.0（宣告式、`Mapped[...]`） | 後端約束 |
| 資料庫驅動 | asyncpg | 後端約束 |
| 遷移 | Alembic | 資料庫約束 |
| 設定 | pydantic-settings | 後端約束 |
| 密碼雜湊 | argon2-cffi | 原則 VI、[research R5](./research.md) |
| Lint/格式化 | ruff | 後端約束 |
| 前端框架 | React 19 + TypeScript | 原則 II |
| 樣式 | Tailwind CSS | 原則 II |
| 建置 | Vite | 原則 II |
| 測試 | pytest / httpx / Vitest / puppeteer-core | 自動化測試節 |

**套件管理**：後端 uv（`pyproject.toml` + `uv.lock`，指令一律 `uv run`）；
前端 npm（`package-lock.json`）。兩者的 lockfile MUST 進版控。

**Storage**: PostgreSQL。12 張表沿用既有 schema：`profiles`、`rooms`、`orders`、
`reviews`、`refunds`、`favorites`、`site_content`、`room_risk_checks`、
`channel_prices`、`admin_logs`、`messages`、`system_settings`。
託管方式不由憲章規範，但 MUST 支援 `EXCLUDE USING gist`（即需 `btree_gist` 擴充）。

**File storage**: 房源展示照與管理員檢測圖經由 FastAPI 上傳。
底層儲存體（本機磁碟／S3 相容服務）於部署時決定；**前端 MUST NOT 持有可直接寫入的憑證**。

**Authentication**: FastAPI 自行實作。argon2id 雜湊、JWT bearer token、
Google 登入以 Authorization Code Flow 由後端交換 code。
JWT 秘鑰由環境變數提供且**無預設值 fallback**——缺少時應用於啟動時失敗。

**Authorization**: **完全在 FastAPI**。RLS 全數移除（[research R1](./research.md)）。
每個受保護端點 MUST 驗證身分與角色。

**Testing**: pytest（後端單元 + API 契約）、Vitest（前端單元）、puppeteer（端對端）。
原則 IV 的每一條規則 MUST 有對應測試。

**Target Platform**: 最新版 Chrome、Edge、Firefox、Safari（桌機與行動）。

**Project Type**: 前後端分離的 Web 應用（React SPA + Python API）。

**Performance Goals**: 列表查詢於一般連線下 1 秒內完成並有可見的載入狀態；
首次載入 2 秒內；搜尋條件變更的畫面回饋即時。

**Constraints**: 無示範模式、無本機業務資料、無排程作業、無爬蟲、無 LLM 呼叫、
無真實金流、前端不得持有任何秘鑰、資料庫約束為房況保證的最終承載者。

**Scale/Scope**: 一家飯店、8–12 間房、3–4 種房型、十二個後台模組。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **v3.1.1**.

| 原則 | 狀態 | 說明 |
|---|---|---|
| I. 規格先行 | ✅ | spec.md 已於本次變更前更新並通過 16 項品質檢查；本計畫在其後產出 |
| II. 前後端分離的分層架構 | ✅ | React SPA + FastAPI，介面為 HTTP JSON 並完整描述於 OpenAPI；後端不產生 HTML |
| III. 資料存取的單一路徑 | ✅ | 前端只呼叫 FastAPI；無 localStorage 業務資料；API client 集中於單一模組 |
| IV. 訂房邏輯正確性 | ✅ | 日曆日字串、半開區間、gist 排除約束原樣保留、整數金額、查詢時判定逾期 |
| V. 無障礙與響應式基本線 | ✅ | 語意化 JSX、鍵盤可操作、focus 樣式不得被全域移除、320px 無橫向捲動 |
| VI. 誠實標示模擬範圍 | ✅ | 認證為真並自行雜湊；付款為假並標示；兩條照片路徑結構性分離 |
| 前端約束 | ✅ | npm + package-lock.json；TypeScript；函式元件；Tailwind 為唯一樣式方案 |
| 後端約束 | ✅ | uv + uv.lock；Pydantic 模型；SQLAlchemy 2.0 + asyncpg；ruff |
| 資料庫約束 | ✅ | Alembic 版本追蹤；autogenerate 須人工審閱；不維護平行的全量 schema SQL |

**Deviations**: 無。

**本次計畫修正的一項憲章誤述**：憲章 v3.0.0／v3.1.0 的遷移計畫表原稱
`supabase/schema.sql`「內容 MUST 完整保留」。Phase 0 查核發現該檔有 36 處參照
Supabase `auth` schema，無法原樣保留。憲章已於 **v3.1.1** 修正為逐層標示，
並將 RLS 由「MAY 保留」改為「MUST 移除」。詳見 [research R1](./research.md)。

**三項模擬範圍的理由已更新**：渠道比價、AI 審核、逾期判定三項的結論不變，
但原理由「架構上做不到」已隨自建後端失效，現行理由改為法律／範圍／運維考量。
未更新的話，日後會有人正確地指出「我們現在有後端了」而找不到反對記錄。
詳見 [research Part B1](./research.md)。

## Project Structure

### Documentation (this feature)

```text
specs/001-booking-site/
├── spec.md
├── plan.md              # 本檔
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── README.md
├── checklists/
│   ├── requirements.md
│   └── browser-acceptance.md
└── tasks.md             # Phase 2（/speckit-tasks 產出，本指令不建立）
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml            # 相依宣告；requires-python = ">=3.12"
├── uv.lock                   # MUST 進版控
├── alembic.ini
├── .env.example              # MUST 列出所有必要變數
├── alembic/
│   ├── env.py
│   └── versions/
│       └── 0001_initial.py   # schema.sql 折入處，含 btree_gist 與 gist 約束
├── src/sunny/
│   ├── main.py               # FastAPI app、CORS、例外處理器
│   ├── config.py             # pydantic-settings；缺變數即啟動失敗
│   ├── db.py                 # async engine / session
│   ├── models/               # SQLAlchemy 2.0 宣告式模型
│   │   ├── profile.py  room.py  order.py  review.py  refund.py
│   │   ├── favorite.py  risk_check.py  channel_price.py
│   │   └── admin_log.py  message.py  system_setting.py
│   ├── schemas/              # Pydantic 請求／回應模型
│   ├── repositories/         # 資料存取集中處；expire_stale_orders 呼叫點
│   ├── services/
│   │   ├── auth.py           # argon2id、JWT、Google code 交換
│   │   ├── booking.py        # 日期規則、金額、約束例外轉譯
│   │   ├── search.py         # 設施／特色 AND 篩選
│   │   ├── moderation.py     # 規則式審核（移至後端，見 research B1-b）
│   │   ├── refunds.py  channel.py  audit.py  export.py
│   │   └── room_photos.py    # 管理員上傳；前台無對應端點
│   ├── routers/              # 每個路由 MUST 宣告其授權要求
│   └── deps.py               # get_current_user / require_admin
└── tests/
    ├── unit/                 # 原則 IV 的每一條規則
    ├── contract/             # 每端點三案例：未認證／越權／正確
    └── conftest.py

frontend/
├── package.json
├── package-lock.json         # MUST 進版控
├── vite.config.ts
├── tailwind.config.ts        # 設計 token 集中處
├── index.html
└── src/
    ├── main.tsx  App.tsx  router.tsx
    ├── api/
    │   ├── client.ts         # 唯一的 fetch 出口；附加 Bearer；401 統一攔截
    │   └── types.ts          # 對應後端 Pydantic 模型
    ├── components/           # 含 SimulatedBadge（模擬模組常駐標示）
    ├── pages/
    │   ├── Home  RoomDetail  Login  Account  Favorites  Orders  Terms
    │   ├── RiskCheck.tsx     # 前台安全檢測：MUST NOT import 任何上傳模組
    │   └── admin/            # 十二個後台模組
    ├── lib/
    │   ├── riskScore.ts      # 純函式，兩條路徑共用「計算」
    │   ├── dates.ts          # MUST NOT 用 new Date(str) 解析日曆日
    │   └── money.ts          # 整數運算
    └── styles/index.css      # Tailwind 指令與極少數無法以 utility 表達的樣式

supabase/                     # 過渡期保留，折入初始 revision 後移除
├── schema.sql                # 表／約束／索引來源
├── seed.sql  seed-demo-data.sql  seed-past-stay.sql
└── migrations.sql            # 內容已含於 schema.sql，折入後 MUST 移除
```

**Structure Decision**：`backend/` 與 `frontend/` 各自獨立，能分別建置、測試與部署。
承重的設計點有三處：

1. **`api/client.ts` 是前端唯一的網路出口。** 憲章原則 III 禁止元件內直接 `fetch`。
   集中的實際收益是 401 處理——token 過期在任何頁面都會發生，分散處理必然漏。
2. **`repositories/` 是後端唯一的資料出口。** `expire_stale_orders()` 的三個呼叫點
   收在這裡，新增路由時不必記得呼叫。
3. **`RiskCheck.tsx` 與 `room_photos.py` 沒有任何共用路徑。** 見下方複雜度追蹤。

## Phase 1 設計要點

### 1. 訂房正確性（憲章原則 IV）

| 規則 | 落實位置 | 驗證 |
|---|---|---|
| 日曆日 `YYYY-MM-DD` | `datetime.date` + PostgreSQL `date`；JSON 序列化為字串 | 單元測試含跨月、跨年 |
| 前端不得時區位移 | `dates.ts` MUST NOT 用 `new Date(str)` | Vitest |
| 夜數 = 退房 − 入住 | `nights_matches_dates` CHECK + 後端計算 | 單元測試 |
| 入住日至少為明日 | Pydantic validator + 後端重算 | 契約測試（含偽造請求） |
| 半開區間重疊 | **`orders_no_overlap` gist 約束（保證）** + 後端預檢（訊息品質） | 並行測試 |
| 約束觸發轉 409 | 攔 `IntegrityError`，**比對約束名稱** | 單元測試涵蓋四種約束各自的訊息 |
| 待付款佔用房況 | 約束的 `where` 子句已含 `pending-payment` | 單元測試 |
| 逾期釋出 | `expire_stale_orders()`，三個呼叫點在 repository 內 | 單元測試 |
| 金額整數 | `int`；PostgreSQL `integer`；**MUST NOT 用 `float`** | 單元測試 |
| 訂單金額凍結 | 建單時寫入 `total_amount`，後續房價變動不影響 | 單元測試 |

**約束例外轉譯是最容易做錯的一環**：`orders` 上有四個會產生 `IntegrityError` 的物件
（`orders_no_overlap`、`valid_date_range`、`nights_matches_dates`、`order_no` 唯一）。
只看例外型別會把「夜數對不上」回成「已無空房」，使用者照著訊息改日期永遠改不好。
MUST 以約束名稱分派，且每個名稱 MUST 有對應的單元測試。

### 2. 兩條照片路徑（FR-086 vs FR-104~107）

```
                    ┌─ lib/riskScore.ts（純函式，Canvas 指標）
                    │
前台 RiskCheck.tsx ──┤   ← 只 import 上面這個。前端無上傳函式可呼叫。
                    │
管理端 RoomRisk ─────┴─→ api/client.ts → POST /admin/rooms/{id}/risk-checks
                                              ↑ require_admin
```

**MUST NOT 以旗標控制**。單一上傳函式加 `shouldUpload: boolean` 更簡單，
但失效模式是上傳使用者的私人照片——那不是能靠測試補救的錯誤類型。
讓前台**沒有**上傳函式可呼叫，使該錯誤在結構上無法發生。

**新架構下這條更重要**：舊架構沒有後端可以接收照片；現在有了，禁令才真正需要被執行。

**自動檢查**：MUST 有一項測試斷言前台模組的相依圖不含任何上傳模組（SC-030）。

### 3. 資料庫遷移

**初始 revision（`0001_initial.py`）的組成順序**：

1. `create extension if not exists btree_gist;` ← **必須最先**，否則 gist 約束建立失敗
2. 12 張表（`profiles.id` 改為自有主鍵，移除對 `auth.users` 的外鍵）
3. CHECK 約束、24 個索引
4. `orders_no_overlap` 排除約束（`op.execute()` 原生 SQL）
5. 保留的 5 個純 PostgreSQL 函式與其觸發器
6. 改寫後的 `guard_order_transition`（只保留不需身分的狀態轉換守門，見 research R2）
7. `admin_logs` 的僅可新增：`REVOKE UPDATE, DELETE ON public.admin_logs FROM <app_role>`

**不包含**：38 條 RLS 政策、`is_admin()`、`handle_new_user()` 與 `on_auth_user_created`。

**autogenerate 的使用限制**：MAY 產初稿，但輸出 MUST 逐行審閱。它偵測不到函式、
觸發器與排除約束，且**可能產生刪除它們的敘述**。每次遷移提交前 MUST 確認腳本
不含非預期的 `drop`。這條約束一旦被靜默移除，超賣不會報錯，只會安靜地發生。

### 4. 授權

移除 RLS 後，FastAPI 是唯一的存取邊界。因此：

- 每個路由 MUST 明確宣告其授權要求（`Depends(get_current_user)` 或 `require_admin`）。
  預設不是「公開」而是「需登入」——新增路由時忘記標註 MUST 導致拒絕而非放行。
- 每個受保護端點 MUST 有三個契約測試：未認證、以他人身分、以正確身分。
  憲章明訂「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」。
- 角色升級（`profiles.role`）MUST 只能由管理員端點變更，且 MUST 進稽核日誌。
  原 `prevent_role_escalation()` trigger 的職責移至此。

### 5. 遷移順序與過渡

```
① 資料庫：schema.sql → Alembic 初始 revision，驗證 gist 約束與 CHECK 行為一致
② 後端：模型 → repository → service → router，逐模組對照 FR
③ 前端：API client → 共用元件 → 前台頁面 → 後台十二模組
④ 驗收：browser-acceptance.md 全數通過
⑤ 清除：移除 src/、styles/、index.html、supabase/migrations.sql
```

**新舊 MUST NOT 同時部署。** 舊前端於過渡期保留為行為比對來源——它包含許多寫在 JS 裡
但沒寫進 spec 的細節（錯誤訊息措辭、排序穩定性、空狀態文案）。保留期間
MUST NOT 加入新功能。

## Complexity Tracking

三處刻意保留的複雜度。

**1. 排除約束以原生 SQL 維護，脫離 ORM 模型。**
最簡單的做法是讓 SQLAlchemy 模型完整描述資料庫，autogenerate 全自動產遷移。
本專案刻意不這麼做：`daterange(check_in, check_out, '[)')` 加上部分約束的 `where`
超出 autogenerate 的可靠還原範圍，而失敗模式不是報錯而是**產出刪除敘述**。
代價是模型與資料庫之間有一塊 ORM 看不見的區域，必須靠人工審閱與測試把關。
這是憲章原則 IV 的直接要求：資料庫的約束才是保證。

**2. 兩條照片路徑不共用上傳程式碼。**
一個帶旗標的上傳函式更簡單，也更容易在重構中被設錯。代價是多一個模組與一項
相依圖檢查；換到的是「前台不可能上傳照片」這件事由結構保證，而非由紀律保證。

**3. 逾期判定散在三個呼叫點，而非一個排程。**
背景排程只需寫一次。但排程失效不可見——它掛了之後房況會安靜地停止釋出，
沒有任何請求會因此報錯。三個呼叫點集中在 repository 層內部，
新增路由的人不需要知道它們存在。

## 已知的不合規項目（沿自憲章）

主要按鈕的白字於品牌色 `#96793F` 上對比為 **4.1:1**，低於原則 V 要求的 4.5:1。
移植至 Tailwind theme 時 MUST 一併處理，**MUST NOT 把已知的不合規色值原樣搬過去**。
修復為改動一個 token：品牌色改為 `#7A6132`（白字對比 5.9:1）。
