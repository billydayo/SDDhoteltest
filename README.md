# Sunny 訂房平台

一個飯店訂房展示型專案，由 **React 前端 + FastAPI 後端 + PostgreSQL** 三層構成。
專案模擬會員註冊／登入、房源瀏覽與搜尋、訂房流程、退款審核、評論審核、後台管理，
以及照片風險評估等功能。

## 架構

```
瀏覽器
  │  HTTP + JSON（唯一介面，完整描述於 OpenAPI）
  ▼
React SPA（Vite + TypeScript + Tailwind）        frontend/  :5173
  │
  ▼
FastAPI（SQLAlchemy 2.0 + asyncpg + Alembic）    backend/   :8000
  │  以非擁有者角色 sunny_app 連線
  ▼
PostgreSQL（託管於 Supabase）
```

**資料庫只有一個存取者：FastAPI 後端**（憲章原則 III）。這條路徑沒有替代方案，
也沒有降級模式——瀏覽器不持有任何資料庫憑證，也不會直接連線資料庫。

## 專案特點

- **前後端分離**：兩層各自獨立建置、啟動與測試，之間只以 HTTP JSON API 溝通
- **真實認證**：密碼以 argon2id 雜湊保管於 `profiles`，登入後發 JWT；含 Google 第三方登入
- **伺服器端授權**：權限判定在後端，前端的畫面隱藏只是體驗，不是防線
- **訂房正確性由資料庫保證**：`orders_no_overlap` 排除約束（`EXCLUDE USING gist`）
  讓同房同日重複成立的訂單在資料庫層就寫不進去，而不是靠應用層先查再寫
- **稽核日誌不可竄改**：`admin_logs` 已對應用角色 `REVOKE UPDATE, DELETE`
- **模擬交易**：付款與退款是展示用模擬，不涉及真實金流
- **雙平台體驗**：支援桌機與行動裝置瀏覽

## 功能範圍

**前台**

- 房源搜尋與篩選（關鍵字、日期、人數、價格上限、設施條件、房型特色）
- 房源詳情頁，含設施、特色、評論與房源品質檢測結果
- 會員註冊、登入（含 Google 第三方登入）、帳戶設定
- 收藏房源
- 三步驟訂房流程，訂單保留 1 小時，逾期自動釋出
- 虛擬付款選項（LINE Pay / 信用卡 / 銀行轉帳）
- 我的訂單與退款申請
- 評論撰寫（送出後經規則式自動審核 + 管理員複核），並可看到業者的公開回覆
- 客服訊息：與客服團隊的一對一私訊，訊息送出後不可竄改
- 前台安全檢測：照片僅於瀏覽器內分析，不會上傳
- 服務條款與隱私聲明

**後台（十二個模組）**

儀表板、房源管理、訂單管理（含營運指標）、用戶管理、評論審核、會員訊息、
退款審核、內容編輯、房源品質檢測、渠道比價與控價、操作日誌、系統與參數設定。

報表匯出（Excel／CSV fallback）刻意**不是**獨立模組——匯出按鈕嵌在各資料頁面內，
範圍是該頁當前的篩選結果。獨立分頁取不到別頁的篩選條件，只能匯出全部。

## 模擬功能的誠實聲明

本專案是展示型原型。以下三項在介面上都有明確標示，請勿誤認為真實服務：

| 功能 | 實際做法 | 為什麼 |
|---|---|---|
| 付款與退款 | 純模擬，不涉及任何金流 | 展示專案不應處理真實交易 |
| 渠道比價與控價 | 外部平台價格為種子資料 | 定時跨站爬取可能違反對方服務條款 |
| 評論「AI 審核」 | 規則式引擎，標示為「自動審核（規則式）」 | 呼叫 AI 服務需要金鑰與外部相依 |

反之，**登入與權限是真實的**：密碼以 argon2id 雜湊，存取邊界由後端強制執行。

## 專案結構

```text
SDDhoteltest/
├── README.md
├── backend/                     # FastAPI 應用（uv 管理）
│   ├── .env                     # ⚠️ 憑證只存在於此。不進版控
│   ├── .env.example             # 範本，列出所有必要變數
│   ├── pyproject.toml uv.lock
│   ├── alembic/
│   │   ├── env.py               # autogenerate 刻意停用（見下方「資料庫遷移」）
│   │   └── versions/            # 0001_initial.py、0002_...py
│   └── src/sunny/
│       ├── config.py            # 設定；連線資訊為元件而非整條 URL
│       ├── db.py deps.py errors.py main.py
│       ├── models/              # SQLAlchemy 宣告式模型（12 張表）
│       ├── schemas/             # Pydantic 進出 API 的形狀
│       ├── repositories/        # 資料存取集中於此，SQL 不散落於路由
│       ├── services/            # 業務規則：booking、search、risk、audit、export…
│       ├── routers/             # 前台 8 支 + 後台 12 支
│       └── seed.py              # 可重複執行的種子資料
├── frontend/                    # React SPA（Vite + TS + Tailwind）
│   ├── vite.config.ts           # /api proxy → 127.0.0.1:8000
│   └── src/
│       ├── api/client.ts        # ⚠️ 唯一的網路出口，元件不得自行 fetch
│       ├── pages/               # 前台各頁 + admin/ 十二模組
│       ├── components/ hooks/ state/ lib/
│       └── router.tsx           # 路由與守衛
├── supabase/reset-legacy.sql    # ⚠️ 會刪資料。把 Supabase 專案清成乾淨狀態
├── specs/001-booking-site/      # spec / plan / research / data-model / tasks / contracts
└── .specify/memory/constitution.md
```

## 啟動方式

### 1. 資料庫

需要一個 PostgreSQL。本專案使用 Supabase 託管，也可用本機 Postgres。

**用 Supabase 時有三個會卡住的細節**（都不會給出指向真正原因的錯誤訊息）：

- **用 Session pooler（5432），不要用直連。** 直連位址 `db.<ref>.supabase.co`
  現在只有 IPv6 記錄，本機若無 IPv6 連通性會直接 `getaddrinfo failed`
- **不要用 Transaction pooler（6543）。** 它不支援 prepared statements，
  asyncpg 會在執行查詢時出錯，而不是在連線時
- **pooler 的使用者名稱必須帶專案 ref**（`postgres.<專案ref>`），
  否則 pooler 不知道要路由到哪個租戶，回 `tenant/user not found`

⚠️ **Dashboard → Settings → API 的 Exposed schemas MUST NOT 包含 `public`。**
這不是疏漏，是刻意的第二道門：程式面由初始 revision 對 `anon` / `authenticated`
執行 REVOKE，設定面由這裡關上。兩道一起，才真的只有後端能碰資料庫。

### 2. 後端

```bash
cd backend
cp .env.example .env      # 填入資料庫連線與 JWT_SECRET
uv sync                   # 依 uv.lock 建立環境
uv run alembic upgrade head
uv run python -m sunny.seed          # 種子資料（可重複執行）
uv run uvicorn sunny.main:app --reload --port 8000
```

驗證：開啟 <http://localhost:8000/docs>，應看到互動式 OpenAPI 文件。

**環境變數 MUST 齊全才會啟動。** 缺少必要變數時應用會在啟動時明確失敗，
不會以預設值靜默啟動。`JWT_SECRET` 尤其沒有 fallback——「沒設就用預設值」
等同於公開秘鑰。

### 3. 前端

```bash
cd frontend
npm ci
npm run dev
```

開啟 <http://localhost:5173/>。`/api` 由 Vite proxy 轉發至後端，
因此開發時不需要處理 CORS。

## 資料庫遷移

由 **Alembic** 管理，位於 `backend/alembic/versions/`。

```bash
cd backend
uv run alembic current        # 目前版本
uv run alembic upgrade head   # 升到最新
```

**Alembic 的 autogenerate 在本專案是刻意停用的**（`alembic/env.py` 的
`target_metadata = None`）。它偵測不到 RLS 政策、trigger、函式與
`EXCLUDE USING gist` 約束，**且可能產生刪除它們的敘述**——而 `orders_no_overlap`
一旦被靜默移除，超賣不會報錯，只會安靜地發生。所有 revision 以原生 SQL 撰寫。

> `alembic current` 若報 `Can't locate revision identified by 'XXXX'`，
> 先確認你所在的分支有沒有那支 revision 檔案，再懷疑資料庫。
> `git log -- <path>` 預設只走當前分支，查「這個檔案存在過嗎」要加 `--all`。

## 測試帳號

- 會員：`guest@sunny.com` / `guest123`
- 管理員：`admin@sunny.com` / `admin123`

由 `backend/src/sunny/seed.py` 建立。應用程式內沒有任何路徑能自我升權為管理員。

> 這些帳號僅為展示用途。本站為展示專案，請勿使用你在其他網站的真實密碼，
> 也請勿輸入真實金融資訊。

## 測試

兩層各自獨立，對應兩層架構：

```bash
cd backend  && uv run pytest      # 單元測試 + 契約測試
cd frontend && npm test           # Vitest + Testing Library
```

後端需要資料庫的測試會讀 `SUNNY_TEST_DATABASE_URL`；**未設定時那些測試會跳過**，
而不是連上開發資料庫就地清空。⚠️ 該變數指向的資料庫會被 `truncate ... cascade`，
多台機器同時開發時每台 MUST 指向不同的資料庫。

**自動化不取代人工驗收。** 版面、對比、照片好不好看這類需要人眼判斷的項目，
以及需要真實 Google 帳密的登入往返，仍以
[瀏覽器驗收清單](specs/001-booking-site/checklists/browser-acceptance.md) 把關。

## 開發限制

摘自憲章（v3.1.1），完整條文見 [`.specify/memory/constitution.md`](.specify/memory/constitution.md)：

- 前端 MUST 為 React SPA，樣式 MUST 用 Tailwind，建置工具 MUST 為 Vite
- 後端 MUST 為 FastAPI；Python 套件管理 MUST 用 **uv**，MUST NOT 用 pip／Poetry／
  requirements.txt
- 兩層之間 MUST 只以 HTTP + JSON 溝通，且 MUST 完整描述於 OpenAPI
- 前端 MUST NOT 直接連線資料庫、物件儲存或任何第三方資料服務
- 後端 MUST NOT 產生 HTML；伺服器端渲染、Jinja、HTMX 皆不在範圍內
- 後端所有設定 MUST 由環境變數讀取；憑證只存在於 `backend/.env`，一次都不得進版控
- 前端 MUST 透過單一 API client 呼叫後端，MUST NOT 於元件內直接 `fetch` 拼網址
- **MUST NOT 存在 localStorage 示範模式**——已於憲章 v3.0.0 移除。API 不可用時
  前端 MUST 顯示可理解的錯誤並保留使用者已填內容，MUST NOT 退回本機假資料假裝成功
- 不使用 Edge Function、Database Webhook、排程作業或爬蟲
- 操作日誌僅可新增，任何角色（含管理員）都不得修改或刪除
- 不串接真實付款、真實金流，也不呼叫任何 OTA 平台或 AI 服務
- 前台使用者上傳的檢測照片只在瀏覽器內處理，不上傳至任何服務或資料表；
  僅管理員對自家房源的檢測圖會存入雲端並公開顯示

## 舊架構已移除

改版前是**零建置架構**：瀏覽器以 anon key 直連 Supabase，靠 RLS 防護。
憲章 v3.0.0 換成現行三層架構後，舊實作已於 T183 全數刪除——
根目錄的 `index.html`、`src/`、`styles/`、`assets/`、`tests/`（puppeteer），
以及 `supabase/` 下的 `schema.sql`、`migrations.sql` 與三個 `seed*.sql`。

若要查閱舊實作，用 git 歷史，不要把檔案復原到工作目錄：

```bash
git log --oneline -- src/ styles/ index.html   # 找到刪除前的那個 commit
git show <commit>:src/config.js                 # 只看內容，不落地
```

`supabase/` 只剩一個檔案，且它服務的是**現行**架構：

| 檔案 | 用途 |
|---|---|
| `supabase/reset-legacy.sql` | ⚠️ **會刪資料且無法復原。** 把既有 Supabase 專案清成乾淨的 `public` schema，讓 Alembic 的 `0001_initial.py` 能從零建起。只在初始化或重建環境時用 |

⚠️ 已建好的資料庫**不要**再跑它——那會連現行資料一起清掉。

## 部署

正式環境為 **Cloudflare Pages（前端靜態檔）+ DigitalOcean Droplet（FastAPI）
+ DigitalOcean Managed Postgres**。完整步驟見 [`docs/deploy.md`](docs/deploy.md)。

⚠️ 部署前務必讀該文件的「步驟 0(b) 後台要不要公開」。下方測試帳號一節列出的
管理員帳密印在登入頁上、也寫在這裡，而本專案**沒有修改密碼的端點**——
站台一旦公開，那組帳密就是十二個後台模組的公開入口。要關掉它需要同時設定
後端的 `SEED_ADMIN_PASSWORD` 與前端的 `VITE_HIDE_ADMIN_DEMO`，只設一邊沒有意義。

## 參考文件

- 部署指南：[`docs/deploy.md`](docs/deploy.md)
- 專案憲章：[`.specify/memory/constitution.md`](.specify/memory/constitution.md)（v3.1.1）
- 規格文件：[`specs/001-booking-site/spec.md`](specs/001-booking-site/spec.md)
- 實作計畫：[`specs/001-booking-site/plan.md`](specs/001-booking-site/plan.md)
- 研究紀錄：[`specs/001-booking-site/research.md`](specs/001-booking-site/research.md)
- 資料模型：[`specs/001-booking-site/data-model.md`](specs/001-booking-site/data-model.md)
- 介面契約：[`specs/001-booking-site/contracts/README.md`](specs/001-booking-site/contracts/README.md)
- 任務清單：[`specs/001-booking-site/tasks.md`](specs/001-booking-site/tasks.md)
- 快速上手：[`specs/001-booking-site/quickstart.md`](specs/001-booking-site/quickstart.md)
- 瀏覽器驗收清單：[`specs/001-booking-site/checklists/browser-acceptance.md`](specs/001-booking-site/checklists/browser-acceptance.md)

## 三條不可跨越的界線

這三件事在程式碼結構上被強制隔離，不是靠註解或旗標約束：

1. **瀏覽器沒有通往資料庫的路。** 前端的網路存取全數走
   `frontend/src/api/client.ts` 這個唯一出口，元件內不得自行 `fetch` 拼網址。
   前端不持有任何資料庫憑證——不是「不該用」，是根本沒有。
2. **前台安全檢測的照片沒有上傳路徑。** `frontend/src/pages/RiskCheck.tsx`
   只 import `lib/riskScore.ts` 與 React，不引用 API client——那是使用者的私人照片，
   程式碼裡根本沒有能上傳它的函式。只有管理員的房源檢測會存圖，且該圖明示會公開。
3. **操作日誌只能新增。** `backend/src/sunny/repositories/admin_logs.py` 沒有
   update 或 delete 函式，資料庫端也已對應用角色 `REVOKE UPDATE, DELETE`。
   應用連線 MUST 為非擁有者（`sunny_app`）——REVOKE 只對非擁有者生效，
   若以擁有者連線，那道 REVOKE 是一句不報錯也不生效的 SQL。

## 注意事項

此專案屬於展示型原型，主要目標是驗證使用者流程、互動邏輯與 RWD 體驗，而不是正式商業
系統部署方案。登入與權限是真實的，但付款與退款始終是模擬的。
