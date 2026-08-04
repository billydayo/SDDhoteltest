# Tasks: Sunny 訂房平台

**Input**: 設計文件來自 `/specs/001-booking-site/`

**Prerequisites**: `plan.md`（必要）、`spec.md`（必要）、`data-model.md`、`quickstart.md`、
`contracts/README.md`、`research.md`、`.specify/memory/constitution.md`（v3.1.1）

**Organization**: 任務依使用者故事分組，讓每個故事都能獨立執行、測試與交付。

---

**修訂 2026-08-04（本次重寫）**：對應憲章 **v3.1.1** 與 `plan.md` 的 2026-08-03 修訂。
前一版任務清單（119 項，原生 JS + 瀏覽器直連 Supabase + 雙軌 localStorage adapter）
**已完全作廢**——那 119 項雖全部標記完成，但它們交付的是一個依新憲章已不合規的實作。

**本次交付的性質**：這不是新功能，是**同一組需求的重新實作**。需求（155 條 FR、
31 條有效 SC）在前一版堆疊上已完整驗收通過。任務的重心因此不是「要做什麼」，
而是「哪些保證必須在換堆疊後依然成立」。

**關於測試**：本清單**包含測試任務，且非選用**。憲章「自動化測試」節明訂三項強制：
（1）原則 IV 的**每一條**日期與房況規則 MUST 有 pytest 覆蓋；
（2）API 契約測試 MUST 涵蓋所有需授權端點的**未認證與越權**存取；
（3）自動化測試 MUST NOT 取代 `checklists/` 的手動驗收。

## Summary

- 總任務數：**192**（Setup 10、Foundational 37、使用者故事 126、會員訊息 5、Polish 14）
- 依故事分佈：US1 16、US2 16、US3 18、US4 12、US5 11、US6 14、US7 6、US8 7、
  US9 8、US10 4、US11 6、US12 8

**修訂 2026-08-04（`/speckit-analyze` 後）**：依一致性分析補上 8 項任務，
編號採字母後綴（T021a、T065a…）以免重編既有的 183 個 ID 讓引用靜默失準。
補的是三項零覆蓋的需求（FR-099a 前端定期清理、SC-015 執行期網路驗證、
FR-073 還原入口）、兩項缺漏的越權契約測試（`/me`、`/refunds`）、
SC-026 的稽核完整性測試，以及 `<app_role>` 佔位符的定案（T021a）。
- 平行機會：Setup 的前後端兩側、Foundational 的 12 個 ORM 模型、各故事的測試層，
  以及故事間（Foundational 完成後 US1–US12 彼此獨立）
- MVP 建議：Phase 1–3（Setup + Foundational + US1），即一個能搜尋與瀏覽房源的公開站台

### 三項不可在遷移中遺失的保證

這三件事在舊實作中已成立，換堆疊後**最容易靜默消失**，因此在此標明並各自綁定任務：

| 保證 | 任務 | 消失時的表現 |
|---|---|---|
| `EXCLUDE USING gist` 房況約束 | T015、T080 | 超賣不報錯，等到兩位客人同時抵達櫃台才發現 |
| `admin_logs` 僅可新增 | T019、**T021a**、T160 | 無錯誤訊息，日誌只是變得可以竄改 |
| 前台照片不離開瀏覽器 | T144、T144a、T146 | 使用者的私人照片被上傳，且沒有任何測試會失敗 |
| **資料庫只有一個存取者** | **T019a** | RLS 移除後，公開的 anon key 經 PostgREST 讀寫全部資料表 |

**T021a 是第二項保證的前提**：`REVOKE` 只對非擁有者生效。若 FastAPI 以資料表擁有者
身分連線，那道 `REVOKE` 是一句沒有作用的 SQL，而它不會報錯。

### 格式

`- [ ] [TaskID] [P?] [Story?] 描述與檔案路徑`

- **[P]**：可平行執行（不同檔案、不依賴未完成的任務）
- **[Story]**：所屬使用者故事；Setup、Foundational、會員訊息與 Polish 階段不帶此標籤

---

## Phase 1: Setup（共用基礎建設）

**Purpose**: 建立前後端兩個獨立專案的骨架、套件管理與工具鏈

- [X] T001 建立 `backend/` 與 `frontend/` 兩個獨立目錄骨架，依 plan.md 的 Project Structure 建立子目錄與 `.gitkeep`
- [X] T002 建立 `backend/pyproject.toml`：`requires-python = ">=3.12"`，宣告 fastapi、uvicorn、python-multipart、sqlalchemy[asyncio]、asyncpg、alembic、pydantic-settings、argon2-cffi、**pyjwt[crypto]**、httpx、openpyxl；執行 `uv sync` 產生 `backend/uv.lock` 並納入版控
  （2026-08-04 修訂：JWT 函式庫由原訂的 python-jose 改為 **PyJWT**。python-jose 已數年未有實質維護，而 plan.md 的相依表未指定 JWT 函式庫，此處無牴觸。實際鎖定 Python 3.12.13）
- [X] T003 [P] 設定 ruff 於 `backend/pyproject.toml`（lint + format，含 `ASYNC` 規則以攔截 `async def` 中的阻塞式 I/O），確認 `uv run ruff check .` 可執行
- [X] T004 [P] 建立 `backend/.env.example`，列出全部必要變數：`DATABASE_URL`、**`MIGRATION_DATABASE_URL`**、**`APP_DB_PASSWORD`**（後兩者為 T021a 的雙角色連線所需）、`JWT_SECRET`、`JWT_EXPIRE_MINUTES`、`CORS_ORIGINS`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI`、`UPLOAD_DIR`、`MAX_UPLOAD_BYTES`
- [X] T005 建立 `frontend/` 的 Vite + React 19 + TypeScript 專案（`package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`），以 `npm install` 產生 `frontend/package-lock.json` 並納入版控
  （2026-08-04 實作：Vite 8.2 / React 19.2 / TypeScript 5.9。**TypeScript 維持 5.x**——7.0 為 Go 版重寫，typescript-eslint 等週邊支援尚未齊備，而 plan.md 明訂「前端：TypeScript 5.x / ES2022」。`tsconfig.json` 拆為 app／node 兩個 project reference，設定檔與應用碼的 lib 與 globals 本就不同）
- [X] T006 [P] 將舊 `styles/` 的配色、字級與圓角移入 theme 具名 token；**品牌色 MUST 為 `#7A6132`（白字 5.9:1）而非既有的 `#96793F`（4.1:1）**，並於註解標註各色與背景的對比度
  （2026-08-04 修訂：token 落在 `frontend/src/styles/index.css` 的 `@theme` 區塊，**不建 `tailwind.config.ts`**。Tailwind v4 已將設定移入 CSS，JS 設定檔降為相容用途；兩份設定並存必然漂移，因此只留一份。同 T002 改用 PyJWT 的處理方式，plan.md 的相依表未指定 Tailwind 版本，此處無牴觸。
  另：舊 `--c-text-faint`（#7C8883，對底色 3.4:1）**刻意未移植**——plan.md 明訂 MUST NOT 把已知不合規的色值原樣搬過來。拱形以 `@utility arch` 保留雙值 `border-radius` 語法，已驗證編譯結果為 `50% 50% 0 0 / 22% 22% 0 0`）
- [X] T007 [P] 設定 `frontend/eslint.config.js` 與 `frontend/tsconfig.json` 的 `strict: true`，禁止未說明理由的 `any`
  （實作：`no-explicit-any` 設為 **error 而非 warn**——warn 會累積到沒有人讀。另加 `strictTypeChecked` 以取得 `no-floating-promises`（忘記 await 的 fetch 不會報錯，只是資料沒進來），以及禁止 `localStorage` 承載業務資料的 `no-restricted-globals`）
- [X] T008 [P] 更新根目錄 `.gitignore`：加入 `backend/.env`、`backend/.venv`、`__pycache__/`、`frontend/node_modules/`、`frontend/dist/`、`backend/uploads/`；一併移除舊有的「`src/config.js` 刻意不列入忽略」註記（該例外的前提是瀏覽器直連 Supabase 並以 RLS 防護，兩者皆已隨憲章 v3.0.0 移除）
- [X] T009 建立 `backend/tests/conftest.py` 與 pytest 設定於 `backend/pyproject.toml`（`asyncio_mode = "auto"`），確認 `uv run pytest` 可執行。測試資料庫以 `SUNNY_TEST_DATABASE_URL` 指定，未設定時**跳過**而非連上 `DATABASE_URL` 就地破壞開發資料
- [X] T010 [P] 設定 `frontend/vitest.config.ts` 與 React Testing Library，確認 `npm run test` 可執行
  （已驗證：`npm run test` 2 passed、`npm run build` 通過、`npm run lint` 無錯）

---

## Phase 2: Foundational（阻塞所有使用者故事）

**Purpose**: 資料庫遷移、ORM 模型、認證與授權骨架、資料存取層、前端 API client

**⚠️ CRITICAL**: 本階段完成前，任何使用者故事都不能開始

**執行順序**：依 research R10，資料庫 → 後端 → 前端。反向進行會讓前端對著會變動的契約重寫兩次。

### 資料庫遷移（Alembic 初始 revision）

- [X] T011 建立 `backend/alembic.ini` 與 `backend/alembic/env.py`，設定為讀取 `DATABASE_URL` 並支援 async engine
- [X] T012 於 `backend/alembic/versions/0001_initial.py` 最前面寫入 `op.execute("create extension if not exists btree_gist")`；**MUST 為整支 revision 的第一個敘述**，缺了會在建立 gist 約束時失敗（research R2）
- [X] T013 於 `backend/alembic/versions/0001_initial.py` 建立 12 張表，內容自 `supabase/schema.sql` 折入；**`profiles` MUST 取回身分欄位**：`id` 改為 `default gen_random_uuid()` 的自有主鍵、新增 `email text not null unique`、`password_hash text NULL`、`google_sub text unique`，並移除對 `auth.users` 的外鍵（data-model.md）
- [X] T014 於 `backend/alembic/versions/0001_initial.py` 原樣折入全部 CHECK 約束與 24 個索引（含 `amenities`／`features` 的 GIN 索引、`site_content_singleton`）
- [X] T015 於 `backend/alembic/versions/0001_initial.py` 以 `op.execute()` 原生 SQL 建立 `orders_no_overlap` 排除約束：`exclude using gist (room_id with =, daterange(check_in, check_out, '[)') with &&) where (status in ('pending-payment','confirmed','refund-pending'))`；**MUST NOT 依賴 autogenerate**
- [X] T016 於 `backend/alembic/versions/0001_initial.py` 原樣折入 5 個純 PostgreSQL 函式與其觸發器：`pending_payment_minutes()`、`expire_stale_orders()`、`refresh_room_rating()`、`enforce_refund_limit()`、`guard_message_update()`
- [X] T017 於 `backend/alembic/versions/0001_initial.py` 寫入拆解後的 `guard_order_transition()`：**只保留不需身分的兩項守門**——不得對已逾期訂單付款、不得從任意狀態跳至 `confirmed`；「管理員可自由改狀態」的分支 MUST 移除，改由 FastAPI 判定（research R2）
- [X] T018 於 `backend/alembic/versions/0001_initial.py` 寫入改寫後的 `stamp_review_reply()` 與 `stamp_message_sender()`：操作者改由後端明確傳入，MUST NOT 引用 `auth.uid()`
- [X] T019 於 `backend/alembic/versions/0001_initial.py` 末尾寫入 `REVOKE UPDATE, DELETE ON public.admin_logs FROM sunny_app`（角色由 T021a 建立）；**這是本次遷移最容易漏掉的一項**——RLS 一併刪除時此保證會無聲消失（data-model.md、SC-027）
- [X] T019a 於 `backend/alembic/versions/0001_initial.py` 末尾**關閉 PostgREST 的存取路徑**：`REVOKE ALL ON ALL TABLES / SEQUENCES / FUNCTIONS IN SCHEMA public FROM anon, authenticated`、`REVOKE USAGE ON SCHEMA public FROM anon, authenticated`，並以 `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated` 讓日後新建的表不再自動開放。
  **這是托管於 Supabase 才會有的第二扇門**：Supabase 對 `public` 設有 `ALTER DEFAULT PRIVILEGES ... GRANT ALL TO anon, authenticated`，Alembic 建的表會自動繼承；而 anon key 依設計可公開、其防護**只**來自 RLS，RLS 又要被本次遷移全數移除。三者相加的結果是任何人都能經 PostgREST 讀寫全部十二張表。research R1 推導「授權邊界在 FastAPI」時只算了 FastAPI 這條路。違反憲章原則 III「資料庫 MUST 只有一個存取者」。
  另需手動於 Dashboard → Settings → API 將 `public` 自 Exposed schemas 移除——程式面與設定面兩道一起關（2026-08-04 新增）
- [X] T020 逐行審閱 `backend/alembic/versions/0001_initial.py`，確認**不含任何非預期的 `drop`**，且不含 38 條 RLS 政策、`is_admin()`、`handle_new_user()`、`on_auth_user_created`；於 `backend/alembic/versions/README.md` 記錄本次審閱結論（憲章資料庫約束）

### 後端核心

- [X] T021 建立 `backend/src/sunny/config.py`：以 pydantic-settings 讀取全部環境變數；缺少必要變數時 MUST 於啟動時明確失敗，**`JWT_SECRET` MUST NOT 有預設值 fallback**
- [X] T021a 於 `backend/alembic/versions/0001_initial.py` 建立**非擁有者**的應用連線角色 `sunny_app`，授予 12 張表的 `SELECT, INSERT, UPDATE, DELETE`（`admin_logs` 的 UPDATE／DELETE 隨後由 T019 收回）；於 `backend/.env.example` 與 `backend/src/sunny/config.py` 分離兩組連線字串：`DATABASE_URL`（應用，以 `sunny_app` 連線）與 `MIGRATION_DATABASE_URL`（遷移，以擁有者連線）。**應用 MUST NOT 以資料表擁有者身分連線**——擁有者保有隱含權限，`REVOKE` 對它形同無效，`admin_logs` 的僅可新增保證會安靜失效（research R1 對 RLS 提過同一陷阱，此處同樣適用）
- [X] T022 建立 `backend/src/sunny/db.py`：async engine 與 session factory（asyncpg），MUST NOT 混用同步 engine
- [X] T023 [P] 建立 `backend/src/sunny/models/profile.py` 與 `backend/src/sunny/models/room.py`（SQLAlchemy 2.0 `Mapped[...]` 宣告式）
- [X] T024 [P] 建立 `backend/src/sunny/models/order.py`，於 `__table_args__` 以 `ExcludeConstraint` 宣告 `orders_no_overlap`（運算式以 `text()` 承載，供模型完整性；實際建立仍由 T015 負責）
- [X] T025 [P] 建立 `backend/src/sunny/models/review.py` 與 `backend/src/sunny/models/refund.py`
- [X] T026 [P] 建立 `backend/src/sunny/models/favorite.py`、`risk_check.py`、`channel_price.py`
- [X] T027 [P] 建立 `backend/src/sunny/models/admin_log.py`、`message.py`、`system_setting.py`、`site_content.py`
- [X] T028 建立 `backend/src/sunny/main.py`：FastAPI app 與 CORS middleware；允許來源 MUST 自 `CORS_ORIGINS` 明確列出，**MUST NOT 使用 `allow_origins=["*"]` 搭配 `allow_credentials=True`**
- [X] T029 於 `backend/src/sunny/main.py` 註冊全域例外處理器，統一輸出 `{"detail": "繁體中文訊息", "code": "..."}`；MUST NOT 回傳堆疊追蹤、SQL 語句或內部檔案路徑
- [X] T030 建立 `backend/src/sunny/errors.py`：`DomainError`／`InternalError` 型別，以及 `IntegrityError` → **以約束名稱分派**的轉譯層，涵蓋 `orders_no_overlap`(409)、`valid_date_range`(400)、`nights_matches_dates`(500)、`order_no` 唯一(500)、`profiles_email_key`(409)、`reviews_order_id_key`(409)；只看例外型別會把「夜數對不上」回成「已無空房」
  （2026-08-04 修訂：路徑由原訂的 `services/errors.py` 改為 `sunny/errors.py`。`utils/dates.py` 需要引用 `DomainError`，而 utils 匯入 services 是反向的分層）
- [X] T031 建立 `backend/src/sunny/services/auth.py`：argon2id 雜湊與驗證（argon2-cffi，含 `check_needs_rehash`）、JWT 簽發與解析
- [X] T032 建立 `backend/src/sunny/deps.py`：`get_current_user` 與 `require_admin`；**預設不是「公開」而是「需登入」**——新增路由時忘記標註 MUST 導致拒絕而非放行
- [X] T033 建立 `backend/src/sunny/repositories/base.py`：session 取得與 `expire_stale_orders()` 的呼叫封裝；**三個呼叫點（查詢房況前、建立訂單前、讀取訂單列表前）MUST 收於 repository 層內部**，MUST NOT 交由各路由自行記得
- [X] T034 建立 `backend/src/sunny/services/audit.py`：管理員變更寫入 `admin_logs` 的統一入口，**MUST 與變更在同一個交易內**；MUST NOT 記錄密碼、秘鑰或真實個資
- [X] T035 [P] 建立 `backend/src/sunny/utils/dates.py`：Asia/Taipei 時區於程式內明確指定（MUST NOT 依賴伺服器本機時區）、日曆日以 `datetime.date` 承載、夜數計算、明日下限判定、半開區間重疊判定
  （2026-08-04：`tzdata` 已加入執行期相依。Windows 沒有系統時區資料庫，`ZoneInfo("Asia/Taipei")` 會直接拋 `ZoneInfoNotFoundError`；鎖進 `uv.lock` 也讓各環境拿到同一份時區資料，而非碰運氣看主機裝了哪一版。
  另：`parse_calendar_date` 以正規式強制**補零**。`strptime` 會接受 `2026-8-4`，而該字串在字典序下大於 `2026-08-05`——這種錯不會拋例外，只會讓排序悄悄錯掉）
- [X] T036 建立 `backend/src/sunny/seed.py`（可重複執行）：12 張表的示範資料，含 8–12 個房源、示範訂單／評論／退款、`channel_prices` 種子；**`guest123` 與 `admin123` MUST 於執行時計算 argon2id 雜湊，MUST NOT 硬編碼雜湊值**（research R5、FR-072）
- [X] T037 建立 `backend/tests/conftest.py` 的共用 fixtures：測試資料庫（含 `btree_gist`）、`member_token`、`admin_token`、`other_member_token`（供越權測試使用）

### 前端核心

- [X] T038 建立 `frontend/src/api/client.ts`：**前端唯一的網路出口**；統一附加 `Authorization: Bearer`、統一攔截 401 並導向登入頁且保留原目的地（FR-009d）
  （實作要點：**只有「原本帶著 token」的請求收到 401 才導向**。沒帶 token 的 401 是登入表單密碼錯誤，導向會讓使用者在登入頁上被反覆導向登入頁而永遠看不到錯誤訊息。以「有沒有帶 token」判斷比替每個呼叫加 `skipRedirect` 旗標可靠——旗標會忘記加，而忘記的那次剛好就是出問題的那次。
  另：`NetworkError` 與 `ApiError` 刻意分開（FR-084），否則伺服器沒開時使用者會讀到一句莫名的業務錯誤）
- [X] T039 [P] 建立 `frontend/src/api/types.ts`：對應後端 Pydantic 模型的 TypeScript 型別；日曆日為 `string`、金額為 `number`（整數）
  （`OrderCreateInput` 刻意不含 `nights` 與 `totalAmount`，與後端的 `OrderCreateIn` 一致——型別裡加上去等於邀請人把畫面上的預覽值送出去當真）
- [X] T040 建立 `frontend/src/router.tsx` 與 `frontend/src/App.tsx`：路由表與角色守衛；守衛 MUST NOT 被描述為安全機制，它只改變畫面呈現
  （**已登入但非管理員回 403 頁而非導向登入頁**——已登入的人被叫去再登入一次會反覆嘗試自己明明正確的密碼。判定完成前顯示載入中，MUST NOT 閃過登入頁。已由 `router.test.tsx` 的三種身分驗證。
  頁面本身分屬 US1–US12，此處先以 `Placeholder` 接通，各頁面任務只需替換 `element`）
- [X] T041 [P] 建立 `frontend/src/components/Header.tsx` 與 `frontend/src/components/Footer.tsx`：語意化 `header`／`nav`／`footer`，頁尾含服務條款連結
- [X] T042 [P] 建立 `frontend/src/components/ErrorState.tsx` 與 `frontend/src/components/LoadingState.tsx`：API 不可用時顯示可理解訊息，MUST NOT 靜默失敗、MUST NOT 退回本機假資料（FR-084）
  （訊息轉換抽到 `lib/errors.ts` 的純函式 `messageFor`，才能單獨測試而不必渲染元件。`EmptyState` 一併於 `components/EmptyState.tsx` 建立，即 T060 所需）
- [X] T043 [P] 建立 `frontend/src/styles/index.css`：Tailwind 指令與極少數無法以 utility 表達的樣式（拱形 `border-radius` 雙值語法、Playfair Display 的 `font-display: swap`）
  （與 T006 同一份檔案。拱形以 `@utility arch` 實作，已驗證編譯輸出為 `50% 50% 0 0 / 22% 22% 0 0`）
- [X] T044 [P] 建立 `frontend/src/lib/dates.ts`：日曆日處理；**MUST NOT 使用 `new Date("YYYY-MM-DD")` 解析**——該建構式視字串為 UTC，在台北時區會退成前一天
  （以字串為主要表示，運算時轉 `Date.UTC` 時間戳——UTC 沒有日光節約時間，兩個午夜之間永遠是 86400000 的整數倍。測試含跨月、跨年、跨閏日，以及美國與歐洲的 DST 切換點）
- [X] T045 [P] 建立 `frontend/src/lib/money.ts`：整數新臺幣元運算與顯示格式化，MUST NOT 出現小數
  （壞掉的值顯示 `—` 而非 `NaN`——使用者看到 `NaN` 只會以為網站壞了）
- [X] T075（提前）建立 `frontend/src/state/AuthContext.tsx`：原訂於 US2，但 T040 的守衛沒有它就無法存在。token 存 `localStorage`、`Profile` 只快取於記憶體（存本機副本會與伺服器不同步，症狀是使用者被降權後畫面上仍有後台入口）

**Checkpoint**: 資料庫、後端骨架與前端 API client 就緒——使用者故事可開始，且可平行進行

---

## Phase 3: User Story 1 - 訪客瀏覽、搜尋與篩選房源 (Priority: P1) 🎯 MVP

**Goal**: 不需登入即可瀏覽、搜尋、篩選、排序房源並進入詳情頁

**Independent Test**: 完全不登入，調整各項篩選條件與排序確認列表正確變動；切換房型頁籤確認分類正確；進入詳情頁確認評分、評論與房態顯示無誤

### Tests for User Story 1

- [X] T046 [P] [US1] 契約測試 `GET /rooms` 為公開端點且條件式必填規則正確於 `backend/tests/contract/test_rooms_public.py`：三者皆空放行、只填單邊日期被拒、只填人數放行、人數非正整數被拒（FR-010）
- [X] T047 [P] [US1] 單元測試設施 AND 篩選與逐日房態推導於 `backend/tests/unit/test_search.py`：勾選兩項設施僅回傳同時具備者；同一房源 8/1 已預訂 MUST NOT 使 8/2 也顯示已預訂（FR-015）

### Implementation for User Story 1

- [X] T048 [US1] 建立 `backend/src/sunny/repositories/rooms.py`：房源查詢與房態推導；**MUST 於查詢前呼叫 `expire_stale_orders()`**（contracts/README.md）
- [X] T049 [US1] 建立 `backend/src/sunny/services/search.py`：FR-010 的條件式必填檢查、設施／特色以 jsonb 包含運算子做 AND 篩選、價格與評分排序
- [X] T050 [US1] 於 `backend/src/sunny/repositories/rooms.py` 實作逐日房態推導：「已預訂」由該日期的有效訂單即時推導，**MUST NOT 寫入 `rooms.status` 欄位**；`status = 'maintenance'` 與已預訂等同排除（FR-015、FR-016、FR-051a）
- [X] T051 [P] [US1] 建立 `backend/src/sunny/schemas/room.py`：`RoomOut` 明列輸出欄位；`average_rating` 為 null 時 MUST 保持 null，**MUST NOT 以 0 表示**（FR-047）
- [X] T052 [US1] 建立 `backend/src/sunny/routers/rooms.py`：`GET /rooms`、`GET /rooms/{id}`，**MUST 明確標註為公開端點**
- [X] T053 [US1] 建立 `backend/src/sunny/routers/vocabulary.py`：設施與房型特色可選項目的公開讀取端點；尚未設定過時 MUST 退回程式內建預設值（FR-010a）
- [X] T054 [P] [US1] 建立 `frontend/src/components/RoomCard.tsx`：直向拱形卡片，拱形 MUST 以 `border-radius` 雙值語法實作（水平半徑遠大於垂直半徑），顯示照片、房名、房型、每晚價格、人數上限與平均評分（FR-013）
  （拱形實作於 `styles/index.css` 的 `@utility arch`——Tailwind 的 `rounded-*` 只吐得出單一半徑。整張卡片可點但**只有一個連結**：`after:absolute inset-0` 撐滿可點區，避免讀屏把同一間房念兩次。平均評分經 `components/Rating.tsx`，`null` 顯示「尚無評分」而非 0）
- [X] T055 [P] [US1] 建立 `frontend/src/components/FilterBar.tsx`：七項篩選條件、目前生效條件的顯示與一鍵清除；欄位標籤 MUST NOT 標示「必填」，改以說明文字交代三者連動；缺漏 MUST 逐欄顯示訊息並將焦點移至第一個有問題的欄位；清單為空時 MUST 隱藏該組篩選（FR-010、FR-010a）
  （純函式部分抽到 `lib/filters.ts`，不掛 DOM 就能測，也避免元件檔同時匯出非元件而讓熱更新退化成整頁重載。**焦點移動當時是壞的**——見下方 T061a）
- [X] T056 [US1] 建立 `frontend/src/pages/Home.tsx`：房型頁籤（切換 MUST NOT 清除其他篩選條件）、排序切換、滿版主視覺；條件檢查 MUST 只在按下「搜尋」時執行，首次載入 MUST 顯示全部房源（FR-010、FR-012）
  （`filters`（編輯中）與 `applied`（上次送出）分開兩份狀態，頁籤與排序獨立於表單即時生效；房型選項由另一次不帶篩選的查詢推導，否則頁籤會隨篩選結果消失。400 只交給篩選列，其餘錯誤才換成結果區的錯誤畫面——同一句話兩處都印會被當成兩個問題）
- [X] T057 [US1] 建立 `frontend/src/pages/RoomDetail.tsx`：照片縮圖切換（僅一張時 MUST NOT 顯示單格縮圖列）、設施、特色、描述、平均評分、已公開評論、目前房態、依所選日期的夜數與總金額（FR-014、FR-017）
  （「已公開評論」已於 T113／T115 補上，接 T110 的 `GET /rooms/{id}/reviews`。過渡期間此處顯示「評論功能即將開放」而非空白區塊或假評論——那段文案與它的測試已一併移除）
- [X] T058 [US1] 於 `frontend/src/pages/RoomDetail.tsx` 顯示最新一次房源品質檢測結果；尚未檢測 MUST 顯示「尚未檢測」而非 0 分或空白區塊（FR-014）
- [X] T059 [P] [US1] 建立 `frontend/src/pages/Terms.tsx`：服務條款與隱私聲明，明確說明本站為展示用專案、不提供真實住宿服務與真實交易（FR-121、FR-122）
- [X] T060 [P] [US1] 建立 `frontend/src/components/EmptyState.tsx` 並套用於房源列表：無結果時顯示「查無符合條件的房源」與調整建議，而非空白畫面（FR-018）
  （分兩種訊息：有下條件 → 給調整建議與一鍵清除；沒下條件卻沒結果是資料問題，叫使用者「放寬條件」毫無幫助）
- [X] T061 [US1] 於 `frontend/src/pages/RoomDetail.tsx` 實作未登入點選「立即訂房」導向登入頁並提示需先登入（FR-019）
  （⚠️ 提示**不能**寫在來源頁：導向的那一刻它就卸載了，任何在此 `setState` 顯示的話都沒有機會被繪製——那是看起來有做、實際上永遠不會出現的死程式碼。理由隨 location state 送到登入頁，由 `components/LoginReasonNotice.tsx` 渲染，T073 的真實登入頁沿用同一個）
- [X] T061a [US1] 修正 `backend/src/sunny/main.py` 的例外處理器：`DomainError.field` MUST 進入回應本體，且 MUST 以請求上的名稱（camelCase）回覆（FR-010、contracts/README.md）
  （**實跑後端才發現的缺陷**：領域層各處都仔細設了 `field`，但 `_error_response()` 只組 `{"detail", "code"}`，`field` 從來沒到過前端——FR-010 的「將焦點移至第一個有問題的欄位」因此無法實作。同時在邊界轉 camelCase 並擋掉非識別字的值：`utils/dates.parse_calendar_date` 也有一個叫 `field` 的參數，但那是給人看的中文標籤，接錯了前端會拿「入住日」去組 DOM 選擇器而**靜默失敗**。契約與 `tests/contract/test_error_contract.py` 一併補上）

**Checkpoint**: 一個能搜尋、篩選、排序並瀏覽詳情的公開站台已可獨立驗收——MVP 達成

---

## Phase 4: User Story 2 - 會員註冊、登入與帳戶管理 (Priority: P2)

**Goal**: 自建認證：註冊、電子郵件密碼登入、Google 登入、帳戶維護

**Independent Test**: 註冊新帳號、登出、重新登入、修改個人資料、重整後資料仍在；於另一個瀏覽器以同一帳號登入確認資料一致——全程不需建立任何訂單

### Tests for User Story 2

- [X] T062 [P] [US2] 契約測試註冊與登入於 `backend/tests/contract/test_auth.py`：email 已存在回 409、密碼少於 6 字元回 400、**帳號不存在與密碼錯誤的訊息與狀態碼一律相同**（FR-002、FR-004、FR-009b）
- [X] T063 [P] [US2] 單元測試帳號列舉防護於 `backend/tests/unit/test_auth_timing.py`：帳號不存在時 MUST 仍對虛設值執行一次雜湊比對，確認兩種失敗的回應時間無顯著差異
- [X] T064 [P] [US2] 契約測試 Google 登入於 `backend/tests/contract/test_google_auth.py`：以既有電子郵件的 Google 帳號登入時 MUST 進入既有帳號且**帳號總數不變**（FR-088、SC-025）
- [X] T065 [P] [US2] 單元測試密碼保管於 `backend/tests/unit/test_password.py`：argon2id 雜湊可驗證；`password_hash` MUST NOT 出現在任何 Pydantic 回應模型的欄位中（FR-009a）
- [X] T065a [P] [US2] 契約測試個人檔案端點於 `backend/tests/contract/test_profile_authz.py`：`GET`／`PATCH /me` 的三案例（未認證 401／他人 token 只能取得自己的資料／正確身分 200）；會員 MUST NOT 能讀取或修改他人的個人檔案（FR-081）

### Implementation for User Story 2

- [ ] T066 [US2] 於 Google Cloud Console 建立 OAuth 2.0 client，將 client id／secret／redirect URI 填入 `backend/.env` 並更新 `backend/.env.example`；**client secret MUST 只存在於後端環境變數**
- [X] T067 [US2] 建立 `backend/src/sunny/repositories/profiles.py`：以 email 與 `google_sub` 查詢、建立與更新 profile
- [X] T068 [P] [US2] 建立 `backend/src/sunny/schemas/auth.py` 與 `backend/src/sunny/schemas/profile.py`：`ProfileOut` **MUST 明列輸出欄位**，MUST NOT 用 `from_attributes` 把 ORM 物件全欄位倒出去（data-model.md）
- [X] T069 [US2] 於 `backend/src/sunny/routers/auth.py` 實作 `POST /auth/register`：argon2id 雜湊、6 字元下限、email 重複回 409；回應 MUST NOT 包含 `password_hash`
- [X] T070 [US2] 於 `backend/src/sunny/routers/auth.py` 實作 `POST /auth/login`：`password_hash is null` MUST 走獨立分支回覆「此帳號請以 Google 登入」，MUST NOT 落入一般的密碼比對失敗分支（data-model.md）
- [X] T071 [US2] 於 `backend/src/sunny/routers/auth.py` 實作 `GET /auth/google` 與 `GET /auth/google/callback`：Authorization Code Flow，**code 交換由後端執行**；以 email 比對既有 profile 並補上 `google_sub`；使用者取消時導回登入頁且 MUST NOT 建立任何帳號（FR-087、FR-088、FR-090）
- [X] T072 [US2] 於 `backend/src/sunny/routers/profiles.py` 實作 `GET /me` 與 `PATCH /me`（需登入）
- [X] T073 [P] [US2] 建立 `frontend/src/pages/Login.tsx`：公開列出測試帳號與「本站為展示用專案，請勿使用你在其他網站的真實密碼」警語（FR-005、FR-006）
  （⚠️ 登入失敗一律顯示為**整體訊息**，MUST NOT 標到 email 或密碼任一欄——標到哪一欄就等於告訴對方另一欄是對的，那正是 FR-004 要防的帳號列舉。警語抽到 `components/PasswordWarning.tsx`，註冊頁一併使用：那裡才是使用者真的會輸入自己密碼的地方）
- [X] T073a [US2] Google 登入的回程（FR-087、FR-090）：`components/GoogleButton.tsx`、`pages/AuthCallback.tsx`、`lib/googleErrors.ts`，並修正後端把回呼改為導向（見 T071a）
  （按鈕 MUST 用 `window.location.assign` 而非 `navigate`——目的地是 Google 的網域，navigate 只會把它當成本站路徑而顯示「找不到這個頁面」。落點頁讀完片段 MUST 立刻 `history.replaceState` 抹掉：片段不進伺服器日誌，但會留在瀏覽器歷史。**MUST NOT 解 token 的 payload 當身分用**——那份 payload 未經驗證，且使用者可能在簽發後已被降權）
- [X] T074 [P] [US2] 建立 `frontend/src/pages/Register.tsx`：失敗時 MUST 保留其他已填欄位
  （catch 區塊裡**只有 `setError`**，沒有任何 `setX('')`。email 撞號時他唯一要改的是 email，把顯示名稱與兩次密碼一併清掉會讓他直接放棄。「兩次密碼不一致」由前端擋——後端只收一個 `password`，它根本看不到這個問題；6 字元下限則不在前端重寫第二份規則）
- [X] T075 [US2] 建立 `frontend/src/state/AuthContext.tsx`：token 存於 `localStorage`（憲章原則 III 允許 token、禁止業務資料）、登入狀態於關閉重開瀏覽器後保留、登出清除
- [X] T076 [US2] 建立 `frontend/src/pages/Account.tsx`：維護顯示名稱與聯絡電話，儲存後頁首與訂單資料中的顯示名稱同步更新（FR-007）
  （存檔成功後灌回 `AuthContext` 的是**後端回傳的** profile，不是送出的值——後端可能修剪空白，以送出的值為準會讓畫面顯示一份資料庫裡並不存在的內容。表單以 `key={user.id}` 一次性初始化而非用 effect 同步：那個 effect 會在 context 每次更新時重跑，症狀是使用者打字打到一半字被吃掉）
- [X] T071a [US2] 修正 `backend/src/sunny/routers/auth.py`：`GET /auth/google` 與 `/auth/google/callback` MUST 回導向，MUST NOT 回 JSON（FR-087、FR-090）
  （**實跑才發現的缺陷**：兩條路徑都是**瀏覽器導覽**而非前端的 fetch。回 `{"accessToken": ...}` 的話，使用者的視窗裡就是那一行 JSON——沒有錯誤、沒有例外、測試全綠，只是登入流程停在一頁原始資料上，而他的 token 就攤在畫面上。改為 303 導回前端，token 放在 **URL 片段**而非查詢字串：片段不進 access log、不進 `Referer`、不被反向代理記錄。新增 `FRONTEND_BASE_URL` 設定）
- [X] T071b [US2] 補上 `validate_password_length` 的 `field="password"`（FR-009b + FR-010）
  （註冊表單有四格、其中兩格是密碼。少了 `field`，訊息只能印在表單底部而焦點不動，使用者讀到「密碼至少需 6 個字元」卻得自己回頭找是哪一格）

**Checkpoint**: US1 與 US2 皆可獨立運作

---

## Phase 5: User Story 3 - 三步驟訂房與虛擬支付 (Priority: P3)

**Goal**: 核心轉換動作——建立訂單、佔用房況、模擬付款、逾期釋出

**Independent Test**: 以 `guest@sunny.com` 登入完成一筆訂房，再以相同日期搜尋同一房源，確認它已不可訂

**⚠️ 本階段的測試是憲章唯一明訂「必須有測試」的區域**（原則 IV）。T077–T082 MUST 全數通過才可視為完成。

### Tests for User Story 3

- [X] T077 [P] [US3] 單元測試日期規則於 `backend/tests/unit/test_booking_dates.py`：夜數 = 退房 − 入住、退房當日不計一晚、入住日至少為明日、退房日 MUST 晚於入住日；邊界含**單晚（8/01–8/02 = 1）、跨月（8/30–9/02 = 3）、跨年（12/30–01/02 = 3）、明日入住**（FR-022、FR-023、SC-004、SC-005）
- [X] T078 [P] [US3] 單元測試半開區間重疊於 `backend/tests/unit/test_overlap.py`：**相鄰不重疊必須成功**（A 為 8/01–8/03、B 訂 8/03–8/05）、完全包含必須被拒（既有 8/01–8/10、新訂 8/03–8/05）（SC-003）
- [X] T079 [P] [US3] 單元測試四個約束的分派於 `backend/tests/unit/test_constraint_dispatch.py`：`orders_no_overlap`→409「此房源於所選日期已無空房」、`valid_date_range`→400、`nights_matches_dates`→500、`order_no` 唯一→500；**每個約束名稱 MUST 有各自的案例**
- [X] T080 [P] [US3] 並行測試於 `backend/tests/unit/test_concurrent_booking.py`：兩個 session 同時送出同一房源同一區間的訂房，**成立筆數 MUST 恰為 1**，另一筆收到正確訊息；此測試 MUST 實際觸發資料庫約束，僅測前端檢查不算覆蓋（SC-020、research R9）
- [X] T081 [P] [US3] 單元測試逾期釋出於 `backend/tests/unit/test_expiry.py`：`expire_stale_orders()` 於查詢房況前、建立訂單前、讀取訂單列表前皆被呼叫；逾期後該區間立即可重新預訂；對已逾期訂單付款 MUST 被拒（FR-099、FR-100、SC-023、SC-024）
- [X] T082 [P] [US3] 契約測試 `POST /orders` 於 `backend/tests/contract/test_orders.py`：後端 MUST 重新計算夜數與總金額，**送出偽造的 `nights` 與 `total_amount` MUST NOT 被採信**；未認證回 401

### Implementation for User Story 3

- [X] T083 [US3] 建立 `backend/src/sunny/repositories/orders.py`：訂單讀寫；**建立訂單前與讀取訂單列表前 MUST 呼叫 `expire_stale_orders()`**
- [X] T084 [US3] 建立 `backend/src/sunny/services/booking.py`：日期驗證、夜數計算、**總金額以 `int` 依當下房價計算並凍結於訂單上**（MUST NOT 用 `float`）、人數上限檢查（FR-024、FR-032）
- [X] T085 [P] [US3] 於 `backend/src/sunny/services/booking.py` 實作 `order_no` 產生器：`SN` + 台北日期 + 序號，對使用者可見且唯一（FR-030）
- [X] T086 [US3] 於 `backend/src/sunny/routers/orders.py` 實作 `POST /orders`（需登入）：套用 T030 的約束例外分派；回應含 `expires_at` 供前端倒數
- [X] T087 [US3] 於 `backend/src/sunny/routers/orders.py` 實作 `POST /orders/{id}/pay`：MUST 為訂單擁有者（非本人回 **403 而非 404**）；已逾期回 409 並說明該區間可能已被他人預訂（contracts/README.md）
- [X] T088 [US3] 建立 `backend/src/sunny/repositories/settings.py`：讀取 `pending_payment_minutes()` 作為 `expires_at` 預設；**變更 MUST NOT 回溯影響既有訂單**（FR-098、FR-101）
- [X] T089 [US3] 建立 `frontend/src/pages/Booking.tsx`：三步驟流程與步驟間往返，已填內容 MUST 被保留；重整行為 MUST 可預期（回到該步驟保留內容，或明確回到起點並告知），MUST NOT 呈現半殘狀態（FR-020、FR-021）
- [X] T090 [US3] 於 `frontend/src/pages/Booking.tsx` 實作付款方式選擇（LINE Pay／信用卡／銀行轉帳）與「虛擬支付，不會產生任何實際交易」的明顯標示；**畫面上 MUST NOT 有任何要求輸入真實卡號、有效期限、CVV 或銀行帳號的欄位**（FR-027、FR-028、FR-029）
- [X] T091 [US3] 建立 `frontend/src/pages/OrderConfirm.tsx`：訂單確認頁含訂單編號、房源、日期、夜數、人數、付款方式與總金額（FR-031）
- [X] T092 [P] [US3] 建立 `frontend/src/components/PaymentCountdown.tsx`：待付款訂單的剩餘付款時間（FR-102）
- [X] T093 [US3] 於 `frontend/src/pages/Booking.tsx` 實作送出失敗的處理：伺服器逾時或拒絕時顯示可理解訊息並**保留使用者已填內容**，MUST NOT 靜默失敗、MUST NOT 改存本機後假裝成功（FR-083）
- [X] T093a [US3] 建立 `frontend/src/state/useStaleOrderSweep.ts`：應用開啟期間**至多每分鐘一次**主動觸發逾期訂單清理，使房源可訂狀態在使用者未主動操作時也能更新；**分頁不可見時 MUST 暫停**（`visibilitychange`），且 **MUST NOT 在使用者填寫表單的頁面上觸發重繪**（訂房流程與各表單頁 MUST 抑制）。此為前端輪詢，與 T081 的 repository 三個呼叫點是不同層次的機制，兩者皆需（FR-099a）

**Checkpoint**: 平台從型錄變成訂房系統；房況保證已由資料庫實際驗證

---

## Phase 6: User Story 4 - 我的訂單與退款申請 (Priority: P4)

**Goal**: 訂單的完整生命週期——檢視、取消待付款、申請退款、查詢審核進度

**Independent Test**: 以會員身分建立訂單、於「我的訂單」看到它、送出退款申請、確認狀態變為「退款審核中」且無法重複申請

### Tests for User Story 4

- [X] T094 [P] [US4] 契約測試越權存取於 `backend/tests/contract/test_orders_authz.py`：會員 A 以訂單編號存取會員 B 的訂單 MUST 取不到任何資料；三案例（未認證／他人身分／正確身分）皆需覆蓋（FR-034、SC-019）
- [X] T095 [P] [US4] 單元測試退款分級金額於 `backend/tests/unit/test_refund_amount.py`：入住前 7 天以上全額、3–6 天 50%、1–2 天 20%、當日起 0%（FR-041）
- [X] T096 [P] [US4] 單元測試退款額度於 `backend/tests/unit/test_refund_limit.py`：每位會員上限 5 筆（由 `enforce_refund_limit()` 於**資料庫端**強制，非僅前端檢查）；**已駁回的申請 MUST NOT 佔用額度**，被駁回 5 次的會員仍能提出申請；同一會員 MUST 能對**不同訂單**分別申請、不限一筆（FR-036a、FR-036b、FR-036d、SC-031）
- [X] T096a [P] [US4] 契約測試退款端點於 `backend/tests/contract/test_refunds_authz.py`：`POST /refunds` 對他人訂單申請退款 MUST 被拒；`GET /refunds` MUST 只回傳本人的申請；三案例（未認證／他人身分／正確身分）皆需覆蓋（FR-081）

### Implementation for User Story 4

- [X] T097 [US4] 建立 `backend/src/sunny/repositories/refunds.py` 與 `backend/src/sunny/services/refunds.py`：分級金額計算與額度判定
- [X] T098 [US4] 於 `backend/src/sunny/routers/orders.py` 實作 `GET /orders`（僅本人、依入住日排序）與 `GET /orders/{id}`（FR-033）
- [X] T099 [US4] 於 `backend/src/sunny/routers/orders.py` 實作 `POST /orders/{id}/cancel`：**僅 `pending-payment` 可取消**，`cancel_reason` 以 `member-cancelled` 與 `payment-timeout` 區分；已確認的訂單 MUST 走退款申請路徑（FR-035a）
- [X] T100 [US4] 於 `backend/src/sunny/routers/refunds.py` 實作 `POST /refunds` 與 `GET /refunds`：同一訂單 MUST NOT 同時存在兩筆審核中的申請（FR-036、FR-037）
- [X] T101 [US4] 建立 `frontend/src/pages/Orders.tsx`：依入住日排序顯示全部訂單；**待付款訂單的付款與取消入口 MUST 同時出現在列表上**，不只在詳情頁（FR-035b）
- [X] T102 [US4] 建立 `frontend/src/pages/OrderDetail.tsx`：取消的二次確認流程（此操作不可復原、房間會立刻開放）；列表上的入口導向本頁，二次確認 MUST 只實作一份（FR-035a）
- [X] T103 [US4] 建立 `frontend/src/pages/RefundForm.tsx`：必填退款原因；已有審核中申請時該操作不可用並顯示目前進度（FR-035、FR-036）
- [X] T104 [US4] 於 `frontend/src/pages/Orders.tsx` 實作「退款已駁回」顯示層標籤：**訂單資料仍為 `confirmed`**，僅最新一次申請遭駁回時顯示此標籤並於狀態分頁獨立成一類，MUST NOT 新增資料庫狀態值；未達退款上限時 MUST NOT 顯示已使用或剩餘次數（FR-039、FR-036c、SC-032）

**Checkpoint**: 訂單生命週期閉環（除管理員審核端，見 US7）

---

## Phase 7: User Story 5 - 撰寫與瀏覽評論評分 (Priority: P5)

**Goal**: 評論送出 → 規則式自動審核 → 管理員複核 → 前台公開

**Independent Test**: 以會員身分對一筆已入住的訂單撰寫評論，確認前台尚未出現；以管理員審核通過後確認評論出現且平均評分更新

### Tests for User Story 5

- [X] T105 [P] [US5] 單元測試規則式審核於 `backend/tests/unit/test_moderation.py`：5 則樣本（含不當字詞、過短、評分與內容矛盾、重複送件、正常）**100% 產生可解釋且附觸發規則的判定**（SC-029）
- [X] T106 [P] [US5] 契約測試評論權限於 `backend/tests/contract/test_reviews.py`：無該房源已完成訂單者不可評論；同一訂單重複評論回 409；未通過審核的評論在公開端點的出現次數為 0（FR-042、FR-043、SC-007）

### Implementation for User Story 5

- [X] T107 [US5] 建立 `backend/src/sunny/services/moderation.py`：規則式引擎，輸出 `auto_verdict`（`auto-pass`／`auto-reject`）與 `auto_rules`；**MUST 於後端執行**——留在前端等於讓使用者自行決定自己的評論過不過審（research B1-b）
- [X] T108 [US5] 建立 `backend/src/sunny/repositories/reviews.py`
- [X] T109 [US5] 於 `backend/src/sunny/routers/reviews.py` 實作 `POST /reviews`（需登入、訂單 MUST 屬本人且為 `completed`）：送出後 MUST 進入待審核，**MUST NOT 因自動審核結果而直接公開**（FR-045、FR-103）
- [X] T110 [US5] 於 `backend/src/sunny/routers/rooms.py` 實作 `GET /rooms/{id}/reviews`（公開）：僅回傳 `approved` 的評論，支援依評論類型篩選（FR-046、FR-048）
- [X] T111 [P] [US5] 於 `backend/tests/unit/test_rating.py` 驗證 `refresh_room_rating()` trigger：評論狀態變更時重算 `rooms.average_rating`；1 則評論時平均等於該則、0 則時為 null（FR-046、FR-047）
- [X] T112 [US5] 建立 `frontend/src/pages/ReviewForm.tsx`：自訂單進入，1–5 評分與文字內容；已評論過時該操作不可用並導向既有評論（FR-043、FR-044）
- [X] T113 [US5] 於 `frontend/src/pages/RoomDetail.tsx` 實作評論清單與類型篩選；無通過審核的評論時顯示「尚無評論」且平均評分顯示為**「尚無評分」而非 0 分**（FR-047、FR-048）
- [X] T114 [P] [US5] 於 `frontend/src/pages/ReviewForm.tsx` 與後台相關文案將機制標示為「**自動審核（規則式）**」；**MUST NOT 被描述為 AI 或人工智慧判讀**（FR-103a）
- [X] T115 [US5] 於 `frontend/src/pages/RoomDetail.tsx` 顯示業者公開回覆：位於該評論下方且視覺上可區分，標示為業者立場，**MUST NOT 顯示回覆者姓名**（FR-103d）

**Checkpoint**: 前台內容閉環（審核端見 US7）

---

## Phase 8: User Story 6 - 後台核心管理：儀表板、房源、訂單、用戶 (Priority: P6)

**Goal**: 業者可自助維運房源、訂單與會員

**Independent Test**: 以 `admin@sunny.com` 登入，新增一間房源並於前台確認它出現；將某房源房態改為「整理中」，確認前台不再可訂

### Tests for User Story 6

- [X] T116 [P] [US6] 契約測試後台授權於 `backend/tests/contract/test_admin_authz.py`：**每個 `/admin/*` 端點皆需三案例**（未認證 401／一般會員 403／管理員 200）；僅測 happy path MUST NOT 被視為已覆蓋（FR-009、SC-008、憲章自動化測試節）
- [X] T117 [P] [US6] 單元測試儀表板除零於 `backend/tests/unit/test_dashboard.py`：系統中無任何訂單時，成交率與平均客單價 MUST 顯示為「—」而非 0 或除以零錯誤

### Implementation for User Story 6

- [X] T118 [US6] 建立 `backend/src/sunny/routers/admin_dashboard.py`：`GET /admin/dashboard` 回傳總訂單數、今日入住與退房數、各房態房源數、待審核評論與退款筆數、本月營收（FR-049）
- [X] T119 [US6] 建立 `backend/src/sunny/routers/admin_rooms.py`：房源 CRUD；刪除仍有未來有效訂單的房源 MUST 提出警告並列出受影響訂單、需二次確認（`on delete restrict` 保護）（FR-050、FR-052）
- [X] T120 [US6] 於 `backend/src/sunny/routers/admin_rooms.py` 實作房態調整：**可人工設定的僅有 `available` 與 `maintenance`**，「已預訂」MUST NOT 開放人工設定（FR-051）
- [X] T121 [US6] 於 `backend/src/sunny/repositories/rooms.py` 實作房態的日期**區間**查詢（含頭含尾，期間內任一天有有效訂單即視為已預訂）；只填一端視為單日；起始晚於結束 MUST 明確提示而非回傳空清單；篩選「已預訂」MUST 要求先選定日期（FR-051b、FR-053a）
- [X] T122 [US6] 建立 `backend/src/sunny/routers/admin_orders.py`：訂單搜尋與篩選（訂單編號、狀態、日期區間）與狀態變更；狀態變更 MUST 經 T034 寫入 `admin_logs`（FR-053、FR-054）
- [X] T123 [US6] 建立 `backend/src/sunny/routers/admin_users.py`：會員資料檢視編輯與角色升降；**`role` 變更 MUST 只能由此端點執行且 MUST 進稽核日誌**（原 `prevent_role_escalation()` trigger 的職責移至此）（FR-055、data-model.md）
- [X] T124 [US6] 建立 `backend/src/sunny/services/room_photos.py` 與 `POST /admin/rooms/{id}/photos`（需管理員）：MUST 檢查檔案大小與 MIME 類型；取消編輯時本次已上傳但未保存的檔案 MUST 被清除，移除既有照片 MUST 於表單送出後才實際刪檔（FR-050e、FR-050f）
- [X] T125 [US6] 建立 `frontend/src/pages/admin/AdminLayout.tsx`：後台佈局與十二個模組的導覽
- [X] T126 [P] [US6] 建立 `frontend/src/pages/admin/Dashboard.tsx`
- [X] T127 [US6] 建立 `frontend/src/pages/admin/Rooms.tsx` 與 `frontend/src/components/ImageManager.tsx`：上限 8 張、第一張為封面、順序調整與逐張移除、本地上傳與圖片網址可混用；**上傳前 MUST 於瀏覽器內以 Canvas 縮圖轉檔，MUST NOT 上傳原始檔**（FR-050a~FR-050d）
- [X] T128 [P] [US6] 建立 `frontend/src/pages/admin/Orders.tsx`：搜尋、篩選與營運指標（訂單總數、已付款數、未付款取消數、成交率、總營業額、平均客單價）（FR-053）
- [X] T129 [P] [US6] 建立 `frontend/src/pages/admin/Users.tsx`：會員資料維護與權限升降介面（FR-055）

**Checkpoint**: 後台核心可用；前後台資料互相反映

---

## Phase 9: User Story 7 - 後台審核：評論審核與退款審核 (Priority: P7)

**Goal**: 讓 US4 與 US5 的送出端得到處理端，完成閉環

**Independent Test**: 建立一則待審核評論與一筆退款申請，以管理員分別通過與駁回，確認前台與會員端狀態同步變更

### Tests for User Story 7

- [X] T130 [P] [US7] 契約測試審核端點於 `backend/tests/contract/test_admin_moderation.py`：三案例授權；核准退款後該房源該區間 MUST 於下一次搜尋重新出現（SC-006）

### Implementation for User Story 7

- [X] T131 [US7] 建立 `backend/src/sunny/routers/admin_reviews.py`：通過／駁回／**覆寫自動審核結果**／刪除已公開評論；四者皆 MUST 寫入 `admin_logs`；刪除後平均評分 MUST 重新計算（FR-056、FR-103b、FR-103c）
- [X] T132 [US7] 於 `backend/src/sunny/routers/admin_reviews.py` 實作業者回覆的撰寫、修改與收回：清空內容等同收回；**待審核與已駁回的評論 MUST NOT 提供回覆入口**；三種操作皆寫入 `admin_logs`（FR-103d）
- [X] T133 [US7] 建立 `backend/src/sunny/routers/admin_refunds.py`：核准／駁回；核准後訂單轉 `refunded` 並**立即釋回該區間**；駁回後回到 `confirmed` 且會員可再次申請（FR-038、FR-039、FR-057）
- [X] T134 [P] [US7] 建立 `frontend/src/pages/admin/Reviews.tsx`：依送出時間顯示待審核評論，含房源、會員、評分、內容、自動審核判定與觸發規則；無待審核項目時顯示引導性空狀態
- [X] T135 [P] [US7] 建立 `frontend/src/pages/admin/Refunds.tsx`：顯示對應訂單、申請人、退款原因、申請時間與分級後的退款金額；無待審核項目時顯示引導性空狀態

**Checkpoint**: US4、US5、US7 三者構成完整的送出—審核—反映閉環

---

## Phase 10: User Story 8 - 後台輔助：報表匯出與內容編輯 (Priority: P8)

**Goal**: 七個模組的匯出（含 CSV fallback）與首頁內容編輯

**Independent Test**: 於後台匯出訂單報表並開啟確認欄位正確；修改首頁標題後回到前台確認已更新

### Tests for User Story 8

- [X] T136 [P] [US8] 單元測試匯出於 `backend/tests/unit/test_export.py`：0 筆時 MUST NOT 產生檔案且提示無資料；用戶匯出 MUST NOT 包含電子郵件與密碼欄位；匯出日誌 MUST NOT 含任何一列的實際內容（FR-058、FR-058a、FR-060、FR-118）

### Implementation for User Story 8

- [X] T137 [US8] 建立 `backend/src/sunny/services/export.py`：涵蓋七個模組（房源、訂單、用戶、評論、退款、渠道比價、操作日誌）的資料組裝
- [X] T138 [US8] 於 `backend/src/sunny/services/export.py` 實作匯出的稽核紀錄：每次成功匯出寫入模組、筆數與檔案格式；**匯出操作日誌本身同樣 MUST 被記錄**；零筆而未產生檔案時 MUST NOT 記錄（FR-058a）
- [X] T139 [US8] 建立 `backend/src/sunny/routers/admin_content.py`：`GET`／`PUT /admin/site-content` 與主圖上傳；上傳後尚未儲存就離開或改選其他圖片時該檔案 MUST 被清除（FR-061）
- [X] T140 [US8] 建立 `frontend/src/components/ExportButton.tsx` 並嵌入七個資料頁面；**匯出範圍 MUST 為該頁當前的篩選結果**，MUST NOT 另設獨立的「報表匯出」分頁（FR-058、SC-033）
- [X] T141 [US8] 於 `frontend/src/components/ExportButton.tsx` 實作 xlsx 函式庫無法載入或離線時**自動退回 CSV 並顯示「目前離線，已改用 CSV 格式」**，MUST NOT 中斷或無回應（FR-059、SC-010）
- [ ] T142 [US8] 建立 `frontend/src/pages/admin/Content.tsx`，並於 `frontend/src/pages/Home.tsx` 實作滿版主視覺：隨視窗寬度連續縮放、MUST NOT 產生橫向捲動、標題 MUST 與頁面其餘內容對齊同一條量測線（FR-061、FR-061a）

**Checkpoint**: 後台輔助模組完成

---

## Phase 11: User Story 9 - 拍照風險預測 (Priority: P9)

**Goal**: 兩條刻意分離的照片路徑——前台留在瀏覽器，管理端可公開存檔

**Independent Test**: 分別上傳一張過暗、一張雜亂、一張正常的照片，確認三者得到明顯不同的評分與對應建議

**⚠️ 本階段承載憲章原則 VI 不可放寬的一條**：前台使用者的照片 MUST NOT 離開瀏覽器。

### Tests for User Story 9

- [X] T143 [P] [US9] 單元測試風險公式於 `frontend/src/lib/riskScore.test.ts`：`100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)`；等級切分 0–34 低／35–59 中／60–100 高；過暗、雜亂、正常三類樣本 MUST NOT 全部落在同一等級（FR-068、SC-016）
- [X] T144 [P] [US9] 相依圖檢查於 `frontend/src/lib/__tests__/riskCheckIsolation.test.ts`：斷言 `frontend/src/pages/RiskCheck.tsx` 的相依圖中**不存在任何上傳模組或圖片端點呼叫**；此測試失敗即代表 SC-030 已失守（research R8、plan.md）
- [X] T144a [P] [US9] **執行期**網路驗證於 `frontend/src/pages/__tests__/riskCheckNetwork.test.tsx`：以攔截器包住 `fetch` 與 `XMLHttpRequest`，於安全檢測頁完成一次完整分析後斷言**夾帶照片內容的請求數為 0**。與 T144 是不同的驗證面——T144 驗靜態相依（SC-030：不出現在儲存或資料表），本項驗執行期流量（SC-015）

### Implementation for User Story 9

- [X] T145 [US9] 建立 `frontend/src/lib/riskScore.ts`：純函式，以 Canvas 計算亮度、雜亂度、對比三項指標；兩條路徑共用「計算」
- [X] T146 [US9] 建立 `frontend/src/pages/RiskCheck.tsx`：**只 import `riskScore.ts`**；顯示預覽與亮度／雜亂度／對比三項指標（FR-063）、總風險評分與等級（FR-064）、針對不合格指標的具體改善建議（FR-064）；拒絕非圖片檔與超出大小限制者並顯示明確錯誤（FR-065）；照片僅於瀏覽器內處理、MUST NOT 送往任何外部服務或長期儲存（FR-066、FR-086）；分析期間顯示處理中且畫面不凍結（FR-067）；連續上傳第二張時結果完全取代前一次；前台與後台皆提供此功能（FR-062）
- [X] T147 [US9] 於 `backend/src/sunny/routers/admin_rooms.py` 實作 `POST /admin/rooms/{id}/risk-checks`（需管理員）：**這是系統中唯一接收檢測圖片的端點**；MUST 檢查檔案大小與 MIME 類型（FR-104、FR-107）
- [X] T148 [US9] 建立 `frontend/src/pages/admin/RoomRisk.tsx`：儲存前 MUST 明確告知「此圖將公開顯示於房源詳情頁」並需二次確認（FR-105）
- [X] T149 [US9] 於 `backend/src/sunny/services/room_photos.py` 實作重新檢測後**舊圖片不再對外可讀取**；房源詳情頁僅顯示最新一筆（FR-106、FR-107）

**Checkpoint**: 差異化功能完成，且前台照片的禁令由結構而非紀律保證

---

## Phase 12: User Story 10 - 收藏房源 (Priority: P10)

**Goal**: 會員收藏與收藏清單

**Independent Test**: 以會員身分收藏兩個房源、於收藏清單確認、取消其中一個、重新整理後確認狀態維持

### Tests for User Story 10

- [X] T150 [P] [US10] 契約測試於 `backend/tests/contract/test_favorites.py`：會員 A 讀取會員 B 的收藏清單 MUST 被拒；三案例授權皆需覆蓋（FR-094）

### Implementation for User Story 10

- [X] T151 [US10] 建立 `backend/src/sunny/routers/favorites.py`：`GET`／`POST`／`DELETE /favorites`（需登入）；複合主鍵 `(user_id, room_id)`，依 `created_at` 由新到舊排序（FR-091、FR-092）
- [X] T152 [US10] 建立 `frontend/src/components/FavoriteButton.tsx`：未登入時導向登入頁，**登入後 MUST 回到原本的房源並完成收藏**（FR-093）
- [X] T153 [US10] 建立 `frontend/src/pages/Favorites.tsx`：已下架或被刪除的房源 MUST 自動消失或標示為已下架，MUST NOT 顯示錯誤或空白卡片；尚無收藏時顯示引導性空狀態（FR-095）

**Checkpoint**: 收藏可獨立驗收

---

## Phase 13: User Story 11 - 渠道比價與控價預警（模擬） (Priority: P11)

**Goal**: 以種子資料呈現的比價、預警與申訴郵件範本

**Independent Test**: 檢視比價表，確認低於官網的項目被標示為預警，並產生郵件範本

**⚠️ 本模組 MUST NOT 實作爬蟲、MUST NOT 呼叫任何 OTA API。理由是服務條款，不是技術限制**——後端的存在不改變這一點（research B1-a）。

### Tests for User Story 11

- [X] T154 [P] [US11] 測試於 `backend/tests/unit/test_channel_prices.py`：模組運作期間**連向外部訂房平台的網路請求數為 0**；回應 MUST 帶有標示其為模擬資料的欄位（FR-109、FR-110、SC-028）

### Implementation for User Story 11

- [X] T155 [US11] 建立 `backend/src/sunny/routers/admin_channel.py`：`GET /admin/channel-prices`（需管理員）依房源列出官網價與各平台售價、價差金額與價差百分比；資料來自 `channel_prices` 種子表（FR-108）
- [X] T156 [US11] 建立 `backend/src/sunny/services/channel.py`：預警判定（外部售價低於官網價）並將未處理筆數併入儀表板（FR-111）
- [X] T157 [US11] 於 `backend/src/sunny/services/channel.py` 實作申訴郵件範本組裝（房源、平台、官網價、對方售價、價差）；**MUST NOT 發送任何郵件**（FR-112）
- [X] T158 [US11] 於 `backend/src/sunny/routers/admin_channel.py` 實作標記已處理，並寫入 `admin_logs`（FR-113）
- [X] T159 [US11] 建立 `frontend/src/pages/admin/Channel.tsx` 與 `frontend/src/components/SimulatedBadge.tsx`：頁面頂端**常駐**「模擬資料：此模組不連線至任何外部平台」；郵件範本畫面 MUST 明確告知系統不會代為寄送；尚無資料時顯示引導性空狀態（FR-110、FR-112）

**Checkpoint**: 營運輔助模組完成，模擬性質已明確標示

---

## Phase 14: User Story 12 - 管理員操作日誌與系統參數設定 (Priority: P12)

**Goal**: 不可竄改的稽核日誌與集中的營運參數

**Independent Test**: 以管理員修改一項房源與一項系統參數，於操作日誌確認兩筆紀錄皆已產生且無法被竄改

### Tests for User Story 12

- [X] T160 [P] [US12] 測試日誌不可竄改於 `backend/tests/unit/test_admin_logs_append_only.py`：以應用連線角色對 `admin_logs` 執行 UPDATE 與 DELETE **MUST 全數失敗**，含以管理員身分；此測試直接驗證 T019 的 `REVOKE`（FR-116、SC-027）
- [X] T161 [P] [US12] 契約測試於 `backend/tests/contract/test_admin_logs.py`：非管理員讀取操作日誌 MUST 取不到任何紀錄；日誌內容 MUST NOT 含密碼、金鑰或真實個資（FR-117、FR-118）
- [X] T161a [P] [US12] 完整性測試於 `backend/tests/contract/test_audit_completeness.py`：**列舉 FastAPI 路由表中所有 `/admin/*` 的寫入端點**（POST／PUT／PATCH／DELETE），逐一呼叫後斷言 `admin_logs` 筆數 +1。此測試驗證的是 SC-026 的 100% 宣稱，且會在**日後新增後台端點卻忘記寫日誌時失敗**——這正是稽核覆蓋率會靜默退化的方式（FR-114、SC-026）

### Implementation for User Story 12

- [X] T162 [US12] 建立 `backend/src/sunny/routers/admin_logs.py`：`GET /admin/logs` 依時間由新到舊，支援依操作者、動作類型與日期區間篩選；**MUST NOT 提供任何 UPDATE 或 DELETE 端點**（FR-114、FR-115、contracts/README.md）
- [X] T163 [US12] 建立 `backend/src/sunny/routers/admin_settings.py`：系統參數的讀取與更新；MUST 有範圍檢查、超出範圍 MUST 被拒絕並顯示可接受範圍、變更 MUST 進稽核日誌、**MUST NOT 回溯影響既有訂單的 `expires_at`**（FR-098、FR-101、FR-119、FR-120）
- [X] T164 [P] [US12] 建立 `frontend/src/pages/admin/Logs.tsx`：篩選與唯讀呈現，畫面上 MUST NOT 出現編輯或刪除入口
- [X] T165 [P] [US12] 建立 `frontend/src/pages/admin/Settings.tsx`：未付款訂單保留分鐘數的調整與可接受範圍提示
- [X] T165a [US12] 於 `backend/src/sunny/routers/admin_settings.py` 實作 `POST /admin/reset-demo-data`（需管理員）並於 `frontend/src/pages/admin/Settings.tsx` 提供入口：呼叫 `sunny.seed` 將所有資料還原為初始種子狀態，需二次確認且 MUST 寫入 `admin_logs`。FR-072（可重複執行的種子機制，T036）與 FR-073（**還原入口**）是兩條需求——只有 CLI 腳本不構成使用者可及的入口（FR-073）

**Checkpoint**: 十二個使用者故事全數完成

---

## Phase 15: 會員訊息（FR-123–FR-128）

**Purpose**: 後台十二個模組中的「會員訊息」。此模組於 2026-08-03 加入 spec，
**未被任何既有 user story 涵蓋**，故獨立成一個階段而非硬塞進 US6。

- [X] T166 [P] 契約測試於 `backend/tests/contract/test_messages.py`：會員 MUST NOT 能讀寫他人的討論串；**發話者身分與角色 MUST 由伺服器判定**，前端送出的 `sender_role` MUST 被忽略（FR-125、FR-126）
- [X] T167 建立 `backend/src/sunny/repositories/messages.py` 與 `backend/src/sunny/routers/messages.py`：`GET`／`POST /messages`（需登入）；討論串以 `thread_user_id`（會員）為單位、不存收件者；`sender_id` 與 `sender_role` 由後端寫入（改寫後的 `stamp_message_sender()`）；送出後 MUST NOT 可修改內容，僅已讀時間可更新（FR-123、FR-124）
- [X] T168 建立 `backend/src/sunny/routers/admin_messages.py`：**任一管理員皆可讀取並回覆所有討論串**；MUST NOT 提供「指派給特定客服」的機制；每次回覆 MUST 寫入 `admin_logs` 且**日誌 MUST NOT 含訊息內容**（FR-118、FR-127、FR-128）
- [X] T169 [P] 建立 `frontend/src/pages/Messages.tsx` 與 `frontend/src/components/MessageThread.tsx`：前台的會員 MUST 只看到「客服人員」，MUST NOT 顯示管理員姓名（FR-127）
- [X] T170 [P] 建立 `frontend/src/pages/admin/Messages.tsx`：管理員端 MUST 看得出每則回覆出自哪一位管理員（FR-127）

---

## Phase 16: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事的稽核、驗收與舊實作清除

- [X] T171 [P] 無障礙稽核 `frontend/src/` 全部元件與頁面：語意化標籤（MUST NOT 以 `div` + `onClick` 取代 `button`／`a`）、所有圖片有 `alt`、所有表單控制項有關聯 `<label>`、所有互動元素可鍵盤操作且有可見 focus 樣式（`outline-none` MUST NOT 被全域套用而不提供替代）；訂房流程 MUST 能純以鍵盤完成（憲章原則 V、SC-011）
- [ ] T172 [P] 響應式稽核 `frontend/src/pages/` 全部頁面：320px 至 1920px 之間無橫向捲動且內容不重疊；房源列表於窄螢幕改為直向堆疊（SC-012）
- [X] T172a [P] 語言與格式稽核 `frontend/src/`：所有介面文字與錯誤訊息 MUST 為繁體中文（台灣用語），日期顯示格式 MUST 全站一致，金額 MUST 為新臺幣元且不出現小數（FR-069、FR-070）
- [X] T173 [P] 對比度稽核 `frontend/tailwind.config.ts`：確認每個承載文字的顏色皆於註解標註對比度且達 WCAG AA；確認**品牌色為 `#7A6132` 而非 `#96793F`**，淡色文字若投入使用 MUST 改為 `#63706B`（憲章「已知不合規項目」）
- [X] T174 [P] 驗證前端無元件內直接 `fetch`：搜尋 `frontend/src/` 確認除 `api/client.ts` 外無任何 `fetch(` 呼叫，且 API 端點路徑未散落於各元件（憲章原則 III）
- [X] T175 [P] 驗證後端無 SQL 或 ORM 查詢散落於路由：搜尋 `backend/src/sunny/routers/` 確認資料存取一律經 `repositories/`（憲章原則 III）
- [X] T176 [P] 執行 `uv run ruff check .` 與 `uv run ruff format --check .` 至無錯誤；執行 `npm run lint` 與 `tsc --noEmit` 至無錯誤，且所有 `any` 皆有行內註解說明理由；一併確認 `frontend/package.json` 已宣告全部相依（**MUST NOT import 未宣告的間接相依**）、`frontend/src/styles/index.css` 未引入 CJK webfont、版控中無單檔超過 1 MB 的圖片（憲章前後端約束與品質標準）
- [X] T177 錯誤處理稽核 `backend/src/sunny/` 與 `frontend/src/`：後端 MUST NOT 將堆疊追蹤、SQL 語句或內部路徑回傳給用戶端；前端所有失敗操作 MUST 顯示可理解訊息並保留使用者已填內容；後端未啟動時 MUST 顯示可理解訊息而非無限轉圈或空白（FR-074、FR-075、FR-083、FR-084）
- [X] T178 驗證版本控制與前端建置產物中的憑證與秘鑰數為 0：確認 `backend/.env` 未進版控、`frontend/dist/` 不含 `JWT_SECRET`／`DATABASE_URL`／Google client secret，且 `VITE_` 前綴變數僅承載公開資訊（FR-085、SC-022）
- [ ] T179 重寫 `specs/001-booking-site/checklists/browser-acceptance.md`：舊清單的 15 項係為「開啟 index.html／示範模式橫幅」等已作廢的架構而寫；新清單 MUST 覆蓋前後端各自啟動、需人眼判斷的版面與對比，以及**需要真實 Google 帳密的登入往返**（FR-088、SC-025）
- [ ] T180 執行 `specs/001-booking-site/quickstart.md` 的 V1–V8 全部驗證情境並記錄結果；全部 MUST 通過才算環境正常
- [ ] T181 走訪 `frontend/src/pages/` 全部頁面的正常操作流程，確認瀏覽器 console 零錯誤零警告，且 `backend/` 執行日誌無未處理的例外堆疊（SC-014、憲章品質標準）
- [ ] T182 重寫根目錄 `README.md`：前後端各自的啟動指令與必要環境變數；新進者 MUST 能只依 README 完成本機啟動（憲章「啟動說明」條）
- [ ] T183 **通過全部驗收清單後**移除舊實作：刪除根目錄 `src/`、`styles/`、`index.html`、`assets/`、`tests/`（舊 puppeteer 套件）與 `supabase/migrations.sql`；`supabase/schema.sql` 與 `seed*.sql` 於初始 revision 與 `seed.py` 驗證通過後一併移除。**MUST NOT 以「之後可能用得到」為由留存**（憲章 v3.0.0 遷移計畫）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**：無依賴，可立即開始
- **Phase 2（Foundational）**：依賴 Setup，**阻擋所有使用者故事**
  - 內部順序為資料庫（T011–T020）→ 後端核心（T021–T037）→ 前端核心（T038–T045）
  - 依 research R10：資料庫是唯一在新舊架構間共用的資產，先確認 gist 約束與各項 CHECK
    在新環境下行為一致，後端才有可信基礎；OpenAPI 契約穩定後前端才有可對接的目標
- **Phase 3–14（US1–US12）**：皆依賴 Phase 2；彼此可平行
- **Phase 15（會員訊息）**：依賴 Phase 2 與 T034（稽核寫入層）
- **Phase 16（Polish）**：依賴所有目標故事完成；T183 額外依賴 T179 與 T180 通過

### User Story Dependencies

- **US1 (P1)**：Phase 2 完成後即可開始，不依賴其他故事
- **US2 (P2)**：Phase 2 完成後即可開始；Google 登入另需 T066 的 OAuth client
- **US3 (P3)**：依賴 US1（房源與日期）與 US2（登入身分）
- **US4 (P4)**：依賴 US3 的訂單資料
- **US5 (P5)**：依賴 US3 與 US4 的已完成訂單；T110 另需 US1 的 `routers/rooms.py`（T052）
- **US6 (P6)**：依賴 T032 的 `require_admin`；T121 另需 US1 的 `repositories/rooms.py`（T048）
- **US7 (P7)**：依賴 US4（退款申請）、US5（評論送出）與 US6 的後台骨架
- **US8 (P8)**：依賴 US6 的後台骨架（匯出按鈕嵌於各資料頁面內）
- **US9 (P9)**：前台部分僅依賴 Phase 2；房源檢測部分依賴 US6 的後台骨架
- **US10 (P10)**：依賴 US1（房源卡片）與 US2（登入）
- **US11 (P11)**：依賴 US6 的後台骨架與 T036 的種子價格資料
- **US12 (P12)**：依賴 T034 的稽核寫入層，以及所有會產生日誌的模組

### Within Each User Story

- 測試先寫並確認**失敗**後才實作
- 模型 → repository → service → router → 前端頁面
- 後端契約穩定後前端才對接

### Parallel Opportunities

- Phase 1 的前端側（T005–T008、T010）與後端側（T002–T004、T009）可完全平行
- Phase 2 的 12 個 ORM 模型（T023–T027）可平行；前端核心（T039、T041–T045）可平行
- Phase 2 完成後，US1、US2、US9 前台部分可平行開發
- US10、US11、US12 彼此獨立，可平行
- 各故事內標 [P] 的測試可同時撰寫
- Phase 16 的 T171–T176、T178 皆為獨立稽核，可平行

---

## Parallel Example: User Story 3

```bash
# 先平行寫完全部測試（憲章原則 IV 的每一條規則）：
Task: "單元測試日期規則 in backend/tests/unit/test_booking_dates.py"
Task: "單元測試半開區間重疊 in backend/tests/unit/test_overlap.py"
Task: "單元測試四個約束的分派 in backend/tests/unit/test_constraint_dispatch.py"
Task: "並行測試 orders_no_overlap in backend/tests/unit/test_concurrent_booking.py"
Task: "單元測試逾期釋出 in backend/tests/unit/test_expiry.py"
Task: "契約測試 POST /orders in backend/tests/contract/test_orders.py"

# 確認全部失敗後，才進入實作（T083 起）
```

## Parallel Example: Phase 2 的 ORM 模型

```bash
Task: "profile.py 與 room.py in backend/src/sunny/models/"
Task: "order.py（含 ExcludeConstraint 宣告） in backend/src/sunny/models/"
Task: "review.py 與 refund.py in backend/src/sunny/models/"
Task: "favorite.py、risk_check.py、channel_price.py in backend/src/sunny/models/"
Task: "admin_log.py、message.py、system_setting.py、site_content.py in backend/src/sunny/models/"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → 2. Phase 2 Foundational（**關鍵阻塞**）→ 3. Phase 3 US1
4. **STOP and VALIDATE**：不登入即可搜尋、篩選、排序、進詳情頁，且 console 無錯誤
5. 此時已是一個可展示的公開站台

### Incremental Delivery

- 第一階段：可瀏覽的公開站台（Phase 1–2 + US1）
- 第二階段：身分與核心交易（US2 → US3）——完成後房況保證已由資料庫實測驗證
- 第三階段：訂單生命週期與內容（US4 → US5 → US7）
- 第四階段：後台維運（US6 → US8 → US12 → 會員訊息）
- 第五階段：差異化與營運輔助（US9 → US10 → US11）
- 最後：Polish、驗收清單重寫、quickstart 驗證，通過後才移除舊實作（T183）

### Parallel Team Strategy

Phase 2 完成後：

- 開發者 A：US1 → US3（前台交易主線）
- 開發者 B：US2 → US4 → US5（身分與訂單生命週期）
- 開發者 C：US6 → US7 → US8（後台）
- 三線於 US7 交會（審核端需要 US4／US5 產生的資料）

---

## Notes

- [P] 任務 = 不同檔案、無相依
- [Story] 標籤僅用於使用者故事階段；Setup、Foundational、會員訊息與 Polish 不帶此標籤
- 每個故事皆應可獨立完成與驗收
- 實作前先確認測試失敗
- 每完成一項任務或一組邏輯相關任務即提交
- **舊實作於過渡期保留為行為比對來源**（錯誤訊息措辭、排序穩定性、空狀態文案等
  寫在 JS 裡但沒寫進 spec 的細節）。保留期間 MUST NOT 加入任何新功能，
  新舊 MUST NOT 同時部署，通過驗收後 MUST 由 T183 移除
- 自動化測試 MUST NOT 取代 `checklists/browser-acceptance.md` 的手動驗收：
  版面、對比、照片是否好看這類需要人眼判斷的項目，以及需要真實 Google 帳密的
  登入往返，仍以手動驗收把關
