# Implementation Plan: Sunny 訂房平台

**Branch**: `python-impl` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-booking-site/spec.md`

**Revision 2026-08-03**: 技術堆疊全面更換，對應憲章 **v3.1.1**。前端由原生 JS 改為
React + TypeScript + Tailwind + Vite；後端由「瀏覽器直連 Supabase」改為自建的
Python FastAPI；資料存取改用 SQLAlchemy 2.0 ORM + Alembic；示範模式移除；
RLS 全數移除，授權邊界移至 FastAPI。前一版計畫（v2.3.0 對應）已完全作廢。

**Revision 2026-08-05**: 同步至憲章 **v4.0.1**（此前停在 v3.1.1，落後兩個版本）。
本次不變更技術堆疊，只讓計畫追上兩件已經發生的事：

- **v3.2.0（版面寬度）**：外殼 MUST NOT 以固定像素封頂。實作已完成
  （`frontend/src/lib/surfaces.ts` 的 `shellClass`），但規格側自始沒有對應需求
  ——本次補為 FR-132／SC-036。
- **v4.0.0（前台照片檢測移除）**：`pages/RiskCheck.tsx` 與其兩支守門測試已刪除，
  前台改嵌外部無障礙檢測元件（`components/WithinReachFab.tsx` + `public/wr-widget.js`，
  同日由獨立頁面改為掛在 Layout 的浮球）。
  本計畫原有的「兩條照片路徑」設計要點與 Complexity Tracking 第 2 項因此失效，
  已於下方改寫。
- **v4.1.0（嵌入形式改為跨來源 iframe）**：上一條的 `public/wr-widget.js` 已移除。
  該元件改為 `<iframe src="https://within-reach-phi.vercel.app">`，外部程式因此跑在
  對方的 origin 上而非我們的 document 裡——原則 VI 拆成形式 A／形式 B，形式 A
  一字未改。⚠️ **同時放棄了一項保障**：內容隨對方部署即時改變，我們無從得知也
  無法回退。另需注意 `deploy/Caddyfile` 的 CSP MUST 有對應的 `frame-src`，
  否則正式站上浮窗會是空白而本機完全正常。見 FR-129a 與 T190。

## Summary

單一飯店的線上訂房平台，含訪客瀏覽與搜尋、會員註冊登入、三步驟訂房與模擬付款、
退款申請、評論審核、十二個後台模組，以及瀏覽器內的拍照風險預測。

**架構**：前後端分離。React SPA 只與 FastAPI 溝通，FastAPI 獨佔資料庫存取。
系統只有一種運作模式——無示範模式、無本機儲存降級路徑。

**本次交付的性質**：這不是新功能，是**同一組需求的重新實作**。需求在前一版堆疊上
已完整驗收通過。計畫的重心因此不是「要做什麼」，而是「哪些保證必須在換堆疊後依然
成立」，以及「哪些既有資產能安全帶過去」。

**需求規模**（2026-08-05 更正，實際點算）：spec.md 共定義 **159 條 FR**，其中 5 條為
墓碑（FR-066、FR-078、FR-079、FR-080、FR-089），**154 條有效**；共 **36 條 SC**，
其中 4 條為墓碑（SC-015、SC-017、SC-018、SC-030），**32 條有效**。
（原文誤植為「89 條 FR、31 條 SC」。這個數字從來沒有對過，而 tasks.md 是以它為
上游寫的——所幸 tasks 自己重數過一次，兩邊才沒有一起錯下去。）

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

Checked against constitution **v4.0.1**（2026-08-05 重跑）。

⚠️ 前一版此表是對 **v3.1.1** 做的稽核，而憲章當時已走到 v4.0.0——那張「9 列全 ✅、
Deviations: 無」的表在被讀到的時候已經失效兩個版本。以下為重新逐列判定的結果。

| 原則 | 狀態 | 說明 |
|---|---|---|
| I. 規格先行 | ✅ | Within Reach 元件於 2026-08-05 嵌入，規格同日補齊（FR-129 ~ FR-131）。補正紀錄見下 |
| II. 前後端分離的分層架構 | ✅ | React SPA + FastAPI，介面為 HTTP JSON 並完整描述於 OpenAPI；後端不產生 HTML。嵌入式元件依 v4.0.0 的具名例外處理，其自身行為不算我們的資料存取路徑 |
| III. 資料存取的單一路徑 | ✅ | 前端只呼叫 FastAPI；無 localStorage 業務資料；API client 集中於單一模組 |
| IV. 訂房邏輯正確性 | ✅ | 日曆日字串、半開區間、gist 排除約束原樣保留、整數金額、查詢時判定逾期 |
| V. 無障礙與響應式基本線 | ✅ | 語意化 JSX、鍵盤可操作、focus 樣式不得被全域移除、320px 無橫向捲動。**v3.2.0 的版面寬度上界**已由 `lib/surfaces.ts` 的單一 `shellClass` 落實（FR-132、SC-036） |
| VI. 誠實標示模擬範圍 | ✅ | 認證為真並自行雜湊；付款為假並標示。**前台照片路徑已整條移除**（不再是「兩條路徑分離」，而是只剩管理端一條）；嵌入元件五項條件見下 |
| 前端約束 | ✅ | npm + package-lock.json；TypeScript；函式元件；Tailwind 為唯一樣式方案（v4 設定在 `styles/index.css` 的 `@theme`，**無 `tailwind.config.ts`**） |
| 後端約束 | ✅ | uv + uv.lock；Pydantic 模型；SQLAlchemy 2.0 + asyncpg；ruff |
| 資料庫約束 | ✅ | Alembic 版本追蹤；autogenerate 須人工審閱；不維護平行的全量 schema SQL |

**Deviations**: 無未結項目。

### 補正紀錄（2026-08-05）

兩項於同日完成的流程補正。記在這裡不是為了記過，而是因為**那幾條規定為什麼存在，
線索只在這裡**——把補正過程刪掉，下一個人會讀到幾條莫名嚴格的條文卻不知其來由，
然後很合理地把它們當成過度設計而放寬。

1. **Within Reach 嵌入：實作在前，規格同日補齊。** 元件先落地，spec/plan/tasks
   三份文件當時對它零記載；同日補為 FR-129 ~ FR-131 與 T184、T185。規格漂移的
   窗口是數小時，補齊後無殘留。**那三條 FR 的嚴格程度（自行 host、每次更新重查
   相依圖）正是為了應付「已經跑在正式站上的外部程式」而訂的**，不是憑空加碼。
2. **`seed*.sql` 的移除：執行在前，修憲同日跟上。** T183 依「`seed.py` 已完整取代」
   的事實移除該批檔案，憲章遷移計畫表於同日的 v4.0.1 更新對應列。兩邊現已一致。

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
├── index.html
├── public/                   # ⚠️ 2026-08-05 起不再有 wr-widget.js：嵌入式第三方
│                             # 元件改為跨來源 iframe，不再自行 host（FR-129 形式 B）
└── src/
    ├── main.tsx  App.tsx  router.tsx
    ├── api/
    │   ├── client.ts         # 唯一的 fetch 出口；附加 Bearer；401 統一攔截
    │   └── types.ts          # 對應後端 Pydantic 模型
    ├── components/           # 含 SimulatedBadge（模擬模組常駐標示）
    │   └── WithinReachFab.tsx  # 嵌入外部無障礙檢測的浮球與浮窗，掛在 Layout
    │                           # 外殼是我們的、內容在對方的 origin 上（跨來源 iframe）
    │                           # 來源、sandbox 與放棄的保障記於檔頭（FR-129 ~ FR-131）
    ├── pages/
    │   ├── Home  RoomDetail  Login  Account  Favorites  Orders  Terms
    │   └── admin/            # 十二個後台模組（含 RoomRisk.tsx）
    ├── lib/
    │   ├── riskScore.ts      # 純函式；現僅由管理端 RoomRisk 使用
    │   ├── surfaces.ts       # 外殼量測線的唯一定義（FR-132）
    │   ├── dates.ts          # MUST NOT 用 new Date(str) 解析日曆日
    │   └── money.ts          # 整數運算
    └── styles/index.css      # Tailwind v4 的 @theme 設計 token + 少數 utility 外樣式
```

**2026-08-05 更正**：本結構圖原列有三項與現況不符者，一併修正——
`tailwind.config.ts`（**從未建立**；Tailwind v4 把設定移進 CSS，T006 已明確決定
只留一份）、`RiskCheck.tsx`（v4.0.0 已刪除）、以及整個 `supabase/` 區塊
（`schema.sql`、`seed*.sql`、`migrations.sql` 均已由 T183 移除，內容折入
`alembic/versions/0001_initial.py` 與 `backend/src/sunny/seed.py`；
僅 `reset-legacy.sql` 保留，用途已改為清空專案以便從零建起）。

**Structure Decision**：`backend/` 與 `frontend/` 各自獨立，能分別建置、測試與部署。
承重的設計點有三處：

1. **`api/client.ts` 是前端唯一的網路出口。** 憲章原則 III 禁止元件內直接 `fetch`。
   集中的實際收益是 401 處理——token 過期在任何頁面都會發生，分散處理必然漏。
2. **`repositories/` 是後端唯一的資料出口。** `expire_stale_orders()` 的三個呼叫點
   收在這裡，新增路由時不必記得呼叫。
3. **前台沒有任何照片輸入路徑。**（2026-08-05 改寫）原文為「`RiskCheck.tsx` 與
   `room_photos.py` 沒有任何共用路徑」——那描述的是兩條路徑刻意不共用程式碼的設計，
   而前台那條已於憲章 v4.0.0 整條移除。現在只剩管理端一條，見下方複雜度追蹤。

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

### 2. 照片路徑：現在只有一條（FR-086、FR-104~107）

```
管理端 RoomRisk ──→ lib/riskScore.ts（純函式，Canvas 指標）
        └────────→ api/client.ts → POST /admin/rooms/{id}/risk-checks
                                       ↑ require_admin
前台 ─────────────→ （不存在任何照片輸入路徑）
```

**2026-08-05 改寫（憲章 v4.0.0）**。本節原本描述「兩條刻意分離、MUST NOT 共用上傳
函式」的設計，並要求一項相依圖測試（T144）與一項執行期流量測試（T144a）守住前台
那條。三者現在都不存在了——前台的照片入口整條移除。

**這不是放寬，是把被保護的對象拿掉了。** 舊設計的價值在於「讓錯誤在結構上無法發生」
（沒有上傳函式可呼叫，就不可能誤傳使用者的私人照片）。新安排把同一個目標推得更遠：
沒有照片可以進來，就沒有東西需要被保護。原本用來守門的兩支測試因此失去對象，
留著只會在某天被人「修好」成守著別的東西。

**替代的自動檢查**：SC-034——前台全部頁面中可接受檔案輸入的元素數為 0。
比舊指標好驗：舊的要證明「送出去的東西裡沒有照片」，新的只要證明「沒有地方能放進來」。

**新的風險在別處**：前台那個位置改嵌外部元件。2026-08-05 之前該元件跑在同一個
document 裡，而本專案的 JWT 就在那個 `localStorage` 中；同日改為跨來源 iframe 之後，
那項風險由同源政策接手，換來的新風險是**內容隨對方部署即時改變、無從得知也無法
回退**。約束見 FR-129 ~ FR-131，任務見 T184、T185。

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

**2. ~~兩條照片路徑不共用上傳程式碼。~~ 已於 2026-08-05 解除。**
前台的照片路徑整條移除後，只剩管理端一條，「不共用」這個複雜度自動消失，
連同它的兩支守門測試一起。**記為「已解除」而非刪掉**：這是本專案少數幾個
「複雜度因為需求改變而自然消失」的案例，而多數複雜度不會這樣消失——留著這一列，
下次評估要不要付出類似代價時才有得比。

新增的複雜度是另一種：一段外部程式碼跑在我們的頁面上，而 JWT 在同一個
`localStorage` 裡。它的代價不是多一個模組，是**一項每次更新都要重做的人工查核**
（FR-130）。這種代價比程式碼複雜度更容易在時間中流失，因為沒有任何東西會在漏做時報錯。

**2026-08-05 更新**：改為跨來源 iframe 之後，上面那項人工查核消失了——不是被自動化，
是**量測對象不在版控裡了**。取而代之的代價是一項不會報錯的持續性事實：那塊畫面
顯示什麼由對方決定。前者會在漏做時流失，後者是每天都成立的既定條件，兩者
MUST NOT 被當成同一件事看待。

**3. 逾期判定散在三個呼叫點，而非一個排程。**
背景排程只需寫一次。但排程失效不可見——它掛了之後房況會安靜地停止釋出，
沒有任何請求會因此報錯。三個呼叫點集中在 repository 層內部，
新增路由的人不需要知道它們存在。

## 已知的不合規項目（沿自憲章）

**✅ 已於移植時修復（T006）。** 主要按鈕的白字於舊品牌色 `#96793F` 上對比為
**4.1:1**，低於原則 V 要求的 4.5:1。品牌色已改為 `#7A6132`（白字對比 5.9:1），
token 定義於 `frontend/src/styles/index.css` 的 `@theme` 區塊。舊的淡色文字
`#7C8883`（3.4:1）刻意未移植。

⚠️ 憲章的「已知不合規項目」表仍記載此項為「實際使用中，未達 AA」——
那張表描述的是移植**前**的狀態，待下次修憲時一併標記為已解決。
在那之前，以本節為準：程式碼裡已經沒有 `#96793F`。
