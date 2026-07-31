# Tasks: Sunny 訂房平台

**Input**: 設計文件來自 `/specs/001-booking-site/`

**Prerequisites**: `plan.md`（必要）、`spec.md`（必要）、`data-model.md`、`quickstart.md`、`contracts/`

**Organization**: 任務依使用者故事分組，讓每個故事都能獨立執行、測試與交付。

**修訂 2026-07-31（第二次）**：依產品企劃書修訂版重寫。新增 US10（收藏）、
US11（渠道控價・模擬）、US12（操作日誌與系統參數），並擴充 US1（設施／特色篩選）、
US2（Google 登入）、US3（待付款時效）、US5（規則式自動審核）、US6（營運指標）、
US9（房源檢測與詳情頁展示）。

**修訂 2026-07-31（第一次）**：依「改用 Supabase」決策重寫，補上遺漏的 US9，
修正 T004 編號重複。

## Summary

- 總任務數：119（Setup 7、資料庫 10、雙軌資料層 16、使用者故事 78、法律頁 1、Polish 7）
- 依故事分佈：US1 8、US2 9、US3 9、US4 5、US5 8、US6 7、US7 4、US8 3、US9 8、US10 5、US11 6、US12 6
- 平行機會：Setup / 資料庫 / 兩個 adapter / 各故事的資料層與頁面層
- MVP 建議：Phase 1–3 + US1 作為最小可行版本，再依序補齊 US2 → US12
- **雙模式要求**：標註 `[2M]` 的驗證任務 MUST 在 Supabase 模式與示範模式下各執行一次（FR-080、SC-017）
- **模擬標示要求**：US11（渠道控價）與 US5 的自動審核 MUST 於畫面標示為模擬／規則式（FR-110、FR-103a）

### 目前進度（2026-07-31）

**106 / 119 完成。程式碼與資料庫層均已完成；瀏覽器實測進行中（第 0–2 關已通過）。**

| 階段 | 狀態 |
|---|---|
| Phase 1 Setup（T001–T007） | ✅ |
| Phase 2 Supabase 專案與資料庫（T008、T010–T017） | ✅ 已以 REST 實測驗證 |
| Phase 3 雙軌資料層（T018–T032） | ✅ |
| Phase 4 US1 訪客瀏覽與搜尋（T034–T040） | ✅ |
| Phase 5 US2 會員與 Google 登入（T042–T049） | ✅ |
| Phase 6 US3 訂房與保留時效（T051–T058） | ✅ |
| Phase 7 US4 訂單與退款申請（T060–T063） | ✅ |
| Phase 8 US5 評論與自動審核（T065–T071） | ✅ |
| Phase 9 US6 後台核心與營運指標（T073–T078） | ✅ |
| Phase 10 US7 評論與退款審核（T080–T082） | ✅ |
| Phase 11 US8 匯出與內容編輯（T084–T085） | ✅ |
| Phase 12 US9 風險檢測（T087–T093） | ✅ |
| Phase 13 US10 收藏（T095–T098） | ✅ |
| Phase 14 US11 渠道控價・模擬（T100–T104） | ✅ |
| Phase 15 US12 日誌與參數（T106–T110） | ✅ |
| Phase 16 服務條款（T112） | ✅ |
| Phase 17 Polish（T113–T116、T119） | ✅ |

**剩餘 13 項**：

- **T009 Google provider** — 選用功能，尚未於 Dashboard 啟用。目前點擊
  Google 登入會顯示「請於 Authentication → Providers → Google 完成設定」，
  不影響其他功能。
- **瀏覽器實測（12 項）**：T059、T064、T072、T079、T083、T086、T094、T099、
  T105、T111、T117、T118

### 瀏覽器實測進度

驗收清單見 [checklists/browser-acceptance.md](./checklists/browser-acceptance.md)
（225 項，分 14 關）。

| 關卡 | 對應任務 | 狀態 |
|---|---|---|
| 第 0 關 啟動與模式切換 | T033 | ✅ 通過 |
| 第 1 關 訪客瀏覽與搜尋 | T041 | ✅ 通過 |
| 第 2 關 會員與登入 | T050 | ✅ 通過 |
| 第 3 關 訂房與付款 | T059 | ⬜ |
| 第 4 關 訂單與退款 | T064 | ⬜ |
| 第 5 關 評論與自動審核 | T072 | ⬜ |
| 第 6 關 後台核心 | T079 | ⬜ |
| 第 7 關 審核閉環 | T083 | ⬜ |
| 第 8 關 匯出與內容 | T086 | ⬜ |
| 第 9 關 風險檢測 | T094 | ⬜ |
| 第 10 關 收藏 | T099 | ⬜ |
| 第 11 關 渠道比價 | T105 | ⬜ |
| 第 12 關 日誌與參數 | T111 | ⬜ |
| 第 13 關 跨切面與雙模式 | T117、T118 | ⬜ |

前三關共 64 項全數通過，且未回報任何問題——包含視覺改版後的直向拱形卡片、
Playfair Display 字型退回行為，以及憑證錯誤與半填的處理。

本開發環境沒有 node，python 為 Windows Store 殼程式，無法執行 JavaScript 或
啟動伺服器，因此凡是需要在瀏覽器中操作介面的驗收都必須人工執行。

### 已完成的驗證（2026-07-31）

**靜態分析**：72 個模組的 import 全數解析、頁面與元件皆未直接呼叫 localStorage
或 Supabase client、前台安全檢測的傳遞相依中不含任何上傳模組、14 條後台變更
路徑全部包在 withAudit 內、使用者可見文字中無「AI」字樣。

**資料庫層（以 REST + 真實帳號實測）**：

| 項目 | 結果 |
|---|---|
| schema 與 seed | 11 張表齊備、10 筆房源含 features、8 筆模擬渠道價格 |
| `handle_new_user` trigger | 註冊即自動建立 profile，預設 role = member |
| Confirm email | 已關閉，註冊立即回傳 session |
| 自行升權防護 | 以會員身分改自己的 role → 被 trigger 擋下 |
| `admin_logs` 不可竄改 | 管理員的 UPDATE 與 DELETE 皆回 403（SC-027） |
| anon 可讀範圍 | 僅 rooms／site_content／system_settings／room_risk_checks／已公開評論 |
| 排除約束・相鄰不重疊 | 03/01–03/03 與 03/03–03/05 兩筆皆成立 |
| 排除約束・部分重疊 | 03/02–03/04 被擋（23P01） |
| 排除約束・完全包含 | 03/01–03/05 被擋 |
| 待付款佔房 | pending-payment 訂單確實阻擋他人預訂（FR-097） |
| `expires_at` | 依 system_settings 計算為 60 分鐘 |
| `expire_stale_orders()` | 逾期訂單轉為 cancelled／payment-timeout |
| 逾期後釋出 | 同區間可重新預訂（SC-023） |
| 逾期付款防護 | 無法對已取消訂單付款（SC-024） |
| 狀態轉換守門 | 會員無法自行標記已完成、無法竄改金額 |
| storage bucket | 會員上傳被擋、管理員可寫、匿名可公開讀 |

測試資料已全數清除（訂單 0 筆、storage 測試檔已刪）。唯一殘留是稽核日誌中一筆
`test.probe` 紀錄——那是驗證「日誌不可刪除」時寫入的，依設計無法移除。

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Create project structure per implementation plan in index.html, styles/, and src/
- [X] T002 Initialize app shell and entry point in index.html and src/main.js
- [X] T003 [P] Create src/config.js with empty credential placeholders and src/config.example.js, and load config.js via a plain `<script>` tag before the app module in index.html
- [X] T004 [P] Add assets/rooms/ placeholder images and assets/hero.svg (self-made SVG, ~1 KB each) referenced by supabase/seed.sql and src/state/seed.js
- [X] T005 [P] Establish CSS custom properties for the beige palette and type scale in styles/base.css
- [X] T006 [P] Add .gitignore entries and confirm no service_role key exists anywhere in the repository (FR-085, SC-022)
- [X] T007 [P] Define the shared vocabulary lists for amenities and room features in src/data/vocabulary.js so filters, seed data, and admin forms stay in sync

---

## Phase 2: Supabase 專案與資料庫 (Blocking Prerequisite)

**⚠️ CRITICAL**: 未完成 RLS 政策的資料表視為未完成（憲章 Supabase 約束）

**⚠️ 需人工操作**: 本階段全部需要在 Supabase Dashboard 與 SQL Editor 中執行，
無法由開發工具代勞。SQL 腳本已備妥於 `supabase/schema.sql` 與 `supabase/seed.sql`。
未完成此階段前，應用程式會以示範模式運作，功能完整。

- [X] T008 Create the Supabase project and disable "Confirm email" under Authentication → Providers → Email
- [ ] T009 Enable the Google provider in Supabase Auth and register the callback URL in Google Cloud's authorized redirect URIs
- [X] T010 Run supabase/schema.sql in the SQL Editor and verify btree_gist, all eleven tables, triggers, functions, and constraints exist
- [X] T011 [P] Verify RLS is enabled with explicit policies on all eleven tables, and that anon can read only rooms, approved reviews, site_content, room_risk_checks, and system_settings
- [X] T012 [P] Verify admin_logs rejects UPDATE and DELETE for every role including admin (SC-027)
- [X] T013 [P] Verify the room-risk storage bucket exists, is public-read, and rejects writes from a non-admin account
- [X] T014 [P] Run supabase/seed.sql and confirm 10 rooms with amenities/features, the singleton site_content row, and 8 simulated channel prices appear
- [X] T015 Create demo accounts guest@sunny.com and admin@sunny.com in the dashboard, then promote admin via the SQL snippet at the end of supabase/schema.sql
- [X] T016 Manually verify orders_no_overlap: adjacent bookings succeed, overlapping and fully-contained bookings are rejected, and a pending-payment order blocks the same range
- [X] T017 Manually verify expire_stale_orders() releases an expired pending-payment order, and that guard_order_transition rejects paying for it afterwards

---

## Phase 3: Foundational — 雙軌資料層 (Blocking Prerequisites)

**⚠️ CRITICAL**: 在完成此階段前，不得開始任何使用者故事的實裝

- [X] T018 Rewrite src/lib/supabase.js to read credentials only from window.__SUNNY_CONFIG__, remove the dead import.meta.env / process.env branches, and lazy-load the client via dynamic import only when configured
- [X] T019 Define the shared async data-access interface and mode-binding facade in src/data/repository.js
- [X] T020 Enforce the expireStaleOrders() call sites inside the repository layer (before availability queries, order creation, and order list reads) so individual pages cannot forget them, plus a once-a-minute sweep in main.js that only repaints when something actually expired and never on form pages (FR-099a)
- [X] T021 [P] Implement the localStorage adapter with seed bootstrap and async signatures in src/data/adapters/local.js, src/state/seed.js, and src/state/persistence.js
- [X] T022 [P] Implement the Supabase adapter with snake_case⇄camelCase mapping in src/data/adapters/supabase.js
- [X] T023 Implement the error-translation table from contracts/README.md in src/data/adapters/supabase.js so callers see business errors, never raw database messages
- [X] T024 Implement centralized state store and mutation helpers in src/state/store.js
- [X] T025 [P] Implement date, money, validation, and storage utilities in src/utils/dates.js, src/utils/money.js, src/utils/validation.js, src/utils/storage.js, and src/utils/errors.js
- [X] T026 [P] Implement per-entity data modules delegating to the repository in src/data/rooms.js, orders.js, reviews.js, refunds.js, profiles.js, favorites.js, risk-checks.js, channel-prices.js, admin-logs.js, settings.js, and site-content.js
- [X] T027 Build auth/session flow over Supabase Auth with a simulated fallback for demo mode in src/services/auth.js, and guest/member/admin guards in src/router.js
- [X] T028 Implement the audit-log writer in src/services/audit.js and wire it into every admin mutation path so a change can never be saved without a log entry (FR-114)
- [X] T029 Create shared header, layout shell, loading and error states, and app container in src/components/header.js and src/app.js
- [X] T030 [P] Add the persistent demo-mode indicator in src/components/demo-badge.js and the reusable simulated-data indicator in src/components/simulated-badge.js (FR-079, FR-110)
- [X] T031 Implement booking and search core logic with half-open overlap rules, room-state checks, and pending-payment occupancy in src/services/search.js and src/services/booking.js
- [X] T032 [P] Configure role-aware admin access and navigation for all eleven back-office modules in src/components/admin-panel.js and the admin shell in src/main.js
- [X] T033 [2M] Verify both modes boot correctly: with credentials the app reads from Supabase; with empty credentials it enters demo mode and issues zero network requests (SC-018) — **待瀏覽器實測**。已完成靜態驗證（39 個模組的 import 全數解析、index.html 引用的檔案全數存在），但本機無 node 與可用的 python，無法啟動伺服器實際執行。請開啟 index.html 並檢查 Network 面板確認。

**Checkpoint**: 基礎設施完成後，所有使用者故事都可以在平行中開始實作

---

## Phase 4: User Story 1 - 訪客瀏覽、搜尋與篩選房源 (Priority: P1) 🎯 MVP

**Independent Test**: 在未登入情境下設定日期、人數、價格上限、設施與特色條件和排序，確認列表更新、房型切換與詳情頁顯示均正確

- [X] T034 [P] [US1] Build room list rendering and room card layout in src/pages/home.js and src/components/room-card.js
- [X] T035 [P] [US1] Build the filter bar with multi-select amenities and features in src/components/filter-bar.js
- [X] T036 [US1] Implement guest search, sort, and AND-logic amenity/feature filtering in src/services/search.js
- [X] T037 [US1] Display active filters with a one-click clear control in src/components/filter-bar.js (FR-010)
- [X] T038 [US1] Implement room detail page, rating display (null shows 尚無評分, never 0), and total price calculation in src/pages/room-detail.js and src/utils/dates.js
- [X] T039 [US1] Add room status UX, loading state, empty state, and no-result messaging in src/pages/home.js and src/components/room-card.js
- [X] T040 [US1] Wire booking CTA redirect for guests and preserve filter state across navigation in src/pages/room-detail.js and src/router.js
- [X] T041 [P] [US1] [2M] Validate homepage and detail-page acceptance scenarios against the browser flow in quickstart.md — **待瀏覽器實測**（開發環境無法執行 JS）

---

## Phase 5: User Story 2 - 會員註冊、登入與帳戶管理 (Priority: P2)

**Independent Test**: 註冊、登出、重新登入、以 Google 登入、更新顯示名稱後刷新確認資料維持；再於另一瀏覽器以同一帳號登入確認資料一致

- [X] T042 [P] [US2] Create registration and login forms with the demo-project password warning and public test accounts in src/pages/login.js
- [X] T043 [US2] Implement signUp/signIn/signOut over Supabase Auth with display_name passed through user metadata in src/services/auth.js
- [X] T044 [US2] Implement signInWithGoogle and the OAuth return flow, restoring the originally requested route in src/services/auth.js and src/main.js
- [X] T045 [US2] Disable the Google button in demo mode with an explanation, never faking a consent screen (FR-089)
- [X] T046 [US2] Handle the user-cancelled OAuth case with a 已取消登入 message and no account creation (FR-090)
- [X] T047 [US2] Implement session restore via getSession and onAuthStateChange, plus session-expiry handling in src/services/auth.js and src/state/store.js
- [X] T048 [US2] Add password-length and duplicate-email validation with messages that never reveal whether an email exists in src/pages/login.js and src/services/auth.js
- [X] T049 [US2] Add account settings page, profile update handling, logout, role-aware routing, and header name sync in src/pages/account.js, src/router.js, and src/components/header.js
- [X] T050 [P] [US2] [2M] Validate registration, login, Google login, account merging by email, logout, persistence, and cross-browser identity (SC-021, SC-025) — **待瀏覽器實測**

---

## Phase 6: User Story 3 - 三步驟訂房、虛擬支付與保留時效 (Priority: P3)

**Independent Test**: 建立一筆訂單、確認房源在保留期間不可再訂、逾期後確認自動釋出

- [X] T051 [P] [US3] Build three-step booking form UI with contact name, phone, email, and step persistence in src/components/booking-form.js
- [X] T052 [US3] Calculate nights, total amount, and validation errors in src/services/booking.js and src/utils/dates.js
- [X] T053 [US3] Implement payment selection with the 虛擬支付 notice and confirmation summary in src/components/booking-form.js
- [X] T054 [US3] Persist order creation as pending-payment with expires_at, guest-count checks, availability re-check, and order number generation in src/data/orders.js and src/services/booking.js
- [X] T055 [US3] Implement payOrder (pending-payment → confirmed) and the order confirmation screen in src/services/booking.js and src/pages/orders.js
- [X] T056 [US3] Build the remaining-time countdown for pending-payment orders in src/components/payment-countdown.js (FR-102)
- [X] T057 [US3] Handle ORDER_EXPIRED on late payment with a clear message and a re-book entry point (FR-100)
- [X] T058 [US3] Handle ROOM_UNAVAILABLE as a friendly 已無空房 message that preserves the filled form, and add reload-safe form behavior in src/components/booking-form.js
- [ ] T059 [P] [US3] [2M] Validate booking, payment, expiry release, and late-payment rejection; in Supabase mode also verify two concurrent conflicting submissions yield exactly one order (SC-020, SC-023, SC-024) — **待瀏覽器實測**

---

## Phase 7: User Story 4 - 我的訂單與退款申請 (Priority: P4)

- [X] T060 [P] [US4] Implement order list and detail page showing all six statuses in src/pages/orders.js
- [X] T061 [US4] Create refund request form and reason validation in src/pages/orders.js and src/services/refunds.js
- [X] T062 [US4] Enforce one-pending-refund rules, the 5-per-member cap (pending + approved only; rejected must not consume quota), date validity checks, and tiered refund amount logic in src/services/refunds.js and the enforce_refund_limit trigger
- [X] T063 [US4] Reflect admin approval/rejection updates back to the member order view in src/pages/orders.js（審核結果與管理員說明於下次載入訂單時呈現，見 spec「資料更新的即時性」）
- [ ] T064 [P] [US4] [2M] Validate refund flow and status changes; in Supabase mode verify a member cannot read another member's order by ID (SC-019) — **待瀏覽器實測**

---

## Phase 8: User Story 5 - 評論撰寫、自動審核與公開 (Priority: P5)

**⚠️ 標示要求**: 自動審核 MUST 標示為「自動審核（規則式）」，MUST NOT 稱為 AI（FR-103a）

- [X] T065 [P] [US5] Create review submission form and validation in src/pages/room-detail.js and src/services/reviews.js
- [X] T066 [US5] Implement the rule-based moderation engine (profanity, too-short, rating/sentiment mismatch, duplicate, gibberish, contact info or external links) returning a verdict plus triggered rule codes in src/services/moderation.js
- [X] T067 [US5] Persist autoVerdict and autoRules on submission, keeping status pending until an admin confirms (FR-103)
- [X] T068 [US5] Implement pending/approved/rejected state transitions and one-review-per-order enforcement in src/services/reviews.js
- [X] T069 [US5] Publish approved reviews and surface the recomputed room average rating in src/data/reviews.js (Supabase 模式由 trigger 重算，示範模式於 adapter 內以相同規則重算)
- [X] T070 [US5] Add public review filtering, category tabs, and no-review empty-state handling in src/pages/room-detail.js
- [X] T071 [US5] Label the mechanism as 規則式自動審核 wherever it is surfaced to users or admins (FR-103a)
- [ ] T072 [P] [US5] [2M] Validate moderation outcomes against the five sample reviews and confirm pending reviews are invisible to anon (SC-007, SC-029) — **待瀏覽器實測**

---

## Phase 9: User Story 6 - 後台核心管理與營運指標 (Priority: P6)

- [X] T073 [P] [US6] Build admin dashboard and room management screens in src/pages/admin.js and src/components/admin-panel.js
- [X] T074 [US6] Implement the order statistics block: total orders, total placed, paid orders, unpaid-cancelled orders, conversion rate, total revenue, average order value
- [X] T075 [US6] Render 「—」 instead of 0 or a division error when there are no orders
- [X] T076 [US6] Implement room CRUD including amenities and features editing, maintenance state changes, and future-order protection with double confirmation in src/data/rooms.js and src/pages/admin.js
- [X] T077 [US6] Add order search, filter, and status editing in src/pages/admin.js and src/services/booking.js
- [X] T078 [US6] Implement user management and admin promotion via profiles in src/pages/admin.js and src/services/auth.js
- [ ] T079 [P] [US6] [2M] Validate admin dashboard, statistics, and role-aware access; in Supabase mode verify a member's direct write to rooms is rejected by RLS (SC-008)

---

## Phase 10: User Story 7 - 後台審核：評論審核與退款審核 (Priority: P7)

- [X] T080 [P] [US7] Implement the review moderation queue showing each item's auto verdict and triggered rules in src/pages/admin.js
- [X] T081 [US7] Implement admin override of auto verdicts and deletion of published reviews, both writing to the audit log (FR-103b, FR-103c)
- [X] T082 [US7] Implement refund moderation queue and release the date range on approved refunds in src/pages/admin.js and src/services/refunds.js
- [ ] T083 [P] [US7] [2M] Validate review and refund approval/rejection flows across admin and member views (SC-006)

---

## Phase 11: User Story 8 - 後台輔助：報表匯出與內容編輯 (Priority: P8)

- [X] T084 [P] [US8] Implement Excel export with CSV fallback and the zero-row guard in src/services/export.js, surfaced as a reusable export button embedded in each admin data page (訂單管理／房源管理) rather than a standalone 報表匯出 module — the export scope must be the page's current filter result (FR-058)
- [X] T085 [US8] Add homepage title/subtitle/image editing with live content updates in src/data/site-content.js and src/pages/home.js
- [ ] T086 [P] [US8] [2M] Validate export fallback and content editing UX in browser-based checks (SC-010)

---

## Phase 12: User Story 9 - 拍照風險預測與房源品質檢測 (Priority: P9)

**⚠️ 約束**: 前台使用者上傳的照片 MUST NOT 離開瀏覽器。兩條路徑的程式碼 MUST 分離——
`pages/risk-check.js` MUST NOT import `services/risk-upload.js` 或 `data/risk-checks.js`（FR-086、憲章原則 VI）

- [X] T087 [P] [US9] Build the front-of-house risk check page with upload control, preview, and processing state in src/pages/risk-check.js
- [X] T088 [US9] Implement in-browser Canvas analysis of brightness, clutter, and contrast in src/services/risk-score.js (shared by both paths — computation only, no storage)
- [X] T089 [US9] Implement the weighted risk score, three risk levels, and per-metric improvement suggestions in src/services/risk-score.js
- [X] T090 [US9] Add file-type and size validation, and ensure a second upload fully replaces the previous result in src/pages/risk-check.js
- [X] T091 [US9] Implement the admin-only room check upload in src/services/risk-upload.js, including the explicit 「此圖將公開顯示」 confirmation before saving (FR-105)
- [X] T092 [US9] Delete the previous image from storage when a room is re-checked so old images stop being publicly readable (FR-107)
- [X] T093 [US9] Display the latest check (date, level, three metrics, image) on the room detail page, with a 尚未檢測 state when absent (FR-106)
- [ ] T094 [P] [US9] [2M] Validate scoring differentiation, zero outbound requests during front-of-house analysis, and that no visitor photo reaches storage or any table (SC-015, SC-016, SC-030)

---

## Phase 13: User Story 10 - 收藏房源 (Priority: P10)

- [X] T095 [P] [US10] Add the favorite star control to room cards and the detail page in src/components/room-card.js and src/pages/room-detail.js
- [X] T096 [US10] Implement addFavorite/removeFavorite with optimistic UI and ALREADY_FAVORITED treated as success in src/data/favorites.js
- [X] T097 [US10] Build the 我的收藏 page with newest-first ordering and an empty state in src/pages/favorites.js
- [X] T098 [US10] Redirect unauthenticated users to login and complete the pending favorite after returning (FR-093)
- [ ] T099 [P] [US10] [2M] Validate favorite persistence, deleted-room handling, and that a member cannot read another member's favorites

---

## Phase 14: User Story 11 - 渠道比價與控價預警（模擬） (Priority: P11)

**⚠️ 模擬功能**: 價格來自種子資料。MUST NOT 實作爬蟲，MUST NOT 呼叫任何 OTA API（FR-109）

- [X] T100 [P] [US11] Build the channel comparison page with the persistent 模擬資料 banner in src/pages/admin-channel.js (FR-110)
- [X] T101 [US11] Implement price-gap and undercut calculation in src/services/channel.js
- [X] T102 [US11] Render the per-room comparison table with website price, each channel price, gap amount, and gap percentage
- [X] T103 [US11] Surface unresolved undercut alerts on the dashboard and implement resolve-with-audit-log in src/pages/admin.js and src/services/channel.js (FR-111, FR-113)
- [X] T104 [US11] Implement the copyable complaint email template with an explicit 系統不會代為寄送 notice in src/services/channel.js (FR-112)
- [ ] T105 [P] [US11] [2M] Validate alert detection, template generation, empty state, and confirm zero requests to any external booking platform (SC-028)

---

## Phase 15: User Story 12 - 管理員操作日誌與系統參數設定 (Priority: P12)

- [X] T106 [P] [US12] Build the audit log viewer with actor, time, action, target, and change summary in src/pages/admin-logs.js
- [X] T107 [US12] Add filtering by actor, action type, and date range in src/pages/admin-logs.js
- [X] T108 [US12] Build the system settings page for pending_payment_minutes with range validation and the SETTING_OUT_OF_RANGE message in src/pages/admin-settings.js (FR-119)
- [X] T109 [US12] Verify setting changes apply to new orders only and never alter existing expires_at values (FR-101)
- [X] T110 [US12] Audit every admin mutation path to confirm a log entry is written, and that no log contains passwords, keys, or real personal data (FR-118, SC-026)
- [ ] T111 [P] [US12] [2M] Validate log immutability from the UI and from a direct database call, including as an admin (SC-027)

---

## Phase 16: 跨切面 — 法律與說明

- [X] T112 Build the terms of service and privacy notice page, linked from the site footer, stating this is a demo project with no real accommodation, transactions, or personal data collection (FR-121, FR-122)

---

## Phase 17: Polish & Cross-Cutting Concerns

- [X] T113 [P] Review accessibility, responsive layout, and keyboard-safe controls across index.html, styles/, and src/components/*
- [X] T114 [P] Audit error handling and edge-case guards across all modules, including offline behavior and session expiry in Supabase mode
- [X] T115 [P] Verify no page or component calls the Supabase client or localStorage directly — all access goes through src/data/repository.js
- [X] T116 [P] Verify src/pages/risk-check.js has no import path reaching src/services/risk-upload.js
- [ ] T117 [2M] Run the full quickstart.md validation in both modes and fix any acceptance gaps (SC-017)
- [ ] T118 Confirm zero console errors and warnings during normal flows in both modes (SC-014)
- [X] T119 Documentation updates and code cleanup in README.md and inline source comments

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Setup，無依賴
- **Phase 2**: Supabase 專案與資料庫，依賴 Setup；可與 Phase 3 的示範模式部分並行
- **Phase 3**: Foundational 雙軌資料層，依賴 Phase 1，且阻擋所有故事
- **Phase 4–15**: User Story 1–12，皆依賴 Phase 3
- **Phase 16–17**: 依賴所有目標故事完成

### User Story Dependencies

- **US1 (P1)**: 可在 Phase 3 完成後開始，不依賴其他故事
- **US2 (P2)**: 可在 Phase 3 完成後開始；Google 登入另需 T009
- **US3 (P3)**: 依賴 US1 與 US2
- **US4 (P4)**: 依賴 US3 的訂單資料結構
- **US5 (P5)**: 依賴 US3 與 US4 的已完成訂單
- **US6 (P6)**: 依賴管理員角色與後台基礎
- **US7 (P7)**: 依賴 US4–US6
- **US8 (P8)**: 依賴 US6
- **US9 (P9)**: 前台部分僅依賴 Phase 3；房源檢測部分依賴 US6 的後台骨架
- **US10 (P10)**: 依賴 US1（房源卡片）與 US2（登入）
- **US11 (P11)**: 依賴 US6 的後台骨架與 T014 的模擬價格種子資料
- **US12 (P12)**: 依賴 T028 的稽核寫入層，以及所有會產生日誌的模組

### Parallel Opportunities

- Phase 1 與 Phase 2 的多數任務可同時處理
- T021（local adapter）與 T022（supabase adapter）可平行開發，只要先確定 T019 的介面
- US1、US2、US9 前台部分可在 Phase 3 完成後平行開發
- US10、US11、US12 彼此獨立，可平行進行
- 各故事內的資料層、服務層、頁面層可並行建立

## Implementation Strategy

### MVP First

1. Phase 1 Setup → 2. Phase 2 資料庫 → 3. Phase 3 雙軌資料層（關鍵阻塞）
4. Phase 4 User Story 1 → 5. 在兩種模式下驗證未登入的瀏覽、搜尋、篩選與詳情頁
6. 達標後依序交付 US2 ~ US12

### Incremental Delivery

- 第一階段：房源瀏覽與預訂入口（US1 → US2 → US3）
- 第二階段：會員資料生命週期與訂單退款（US4 → US5）
- 第三階段：後台管理與審核（US6 → US7 → US8）
- 第四階段：差異化與營運輔助（US9 → US10 → US11 → US12）
- 最後完成法律頁面、跨功能驗證與可用性優化
