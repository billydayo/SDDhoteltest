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

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Create project structure per implementation plan in index.html, styles/, and src/
- [ ] T002 Initialize app shell and entry point in index.html and src/main.js
- [ ] T003 [P] Create src/config.js with empty credential placeholders and src/config.example.js, and load config.js via a plain `<script>` tag before the app module in index.html
- [ ] T004 [P] Add assets/rooms/ placeholder images and assets/hero.jpg (freely usable, each under 1 MB) referenced by supabase/seed.sql
- [ ] T005 [P] Establish CSS custom properties for the beige palette and type scale in styles/base.css
- [ ] T006 [P] Add .gitignore entries and confirm no service_role key exists anywhere in the repository (FR-085, SC-022)
- [ ] T007 [P] Define the shared vocabulary lists for amenities and room features in src/data/vocabulary.js so filters, seed data, and admin forms stay in sync

---

## Phase 2: Supabase 專案與資料庫 (Blocking Prerequisite)

**⚠️ CRITICAL**: 未完成 RLS 政策的資料表視為未完成（憲章 Supabase 約束）

- [ ] T008 Create the Supabase project and disable "Confirm email" under Authentication → Providers → Email
- [ ] T009 Enable the Google provider in Supabase Auth and register the callback URL in Google Cloud's authorized redirect URIs
- [ ] T010 Run supabase/schema.sql in the SQL Editor and verify btree_gist, all eleven tables, triggers, functions, and constraints exist
- [ ] T011 [P] Verify RLS is enabled with explicit policies on all eleven tables, and that anon can read only rooms, approved reviews, site_content, room_risk_checks, and system_settings
- [ ] T012 [P] Verify admin_logs rejects UPDATE and DELETE for every role including admin (SC-027)
- [ ] T013 [P] Verify the room-risk storage bucket exists, is public-read, and rejects writes from a non-admin account
- [ ] T014 [P] Run supabase/seed.sql and confirm 10 rooms with amenities/features, the singleton site_content row, and 8 simulated channel prices appear
- [ ] T015 Create demo accounts guest@sunny.com and admin@sunny.com in the dashboard, then promote admin via the SQL snippet at the end of supabase/schema.sql
- [ ] T016 Manually verify orders_no_overlap: adjacent bookings succeed, overlapping and fully-contained bookings are rejected, and a pending-payment order blocks the same range (T012 of the previous revision, extended)
- [ ] T017 Manually verify expire_stale_orders() releases an expired pending-payment order, and that guard_order_transition rejects paying for it afterwards

---

## Phase 3: Foundational — 雙軌資料層 (Blocking Prerequisites)

**⚠️ CRITICAL**: 在完成此階段前，不得開始任何使用者故事的實裝

- [ ] T018 Rewrite src/lib/supabase.js to read credentials only from window.__SUNNY_CONFIG__, remove the dead import.meta.env / process.env branches, and lazy-load the client via dynamic import only when configured
- [ ] T019 Define the shared async data-access interface and mode-binding facade in src/data/repository.js
- [ ] T020 Enforce the expireStaleOrders() call sites inside the repository layer (before availability queries, order creation, and order list reads) so individual pages cannot forget them
- [ ] T021 [P] Implement the localStorage adapter with seed bootstrap and async signatures in src/data/adapters/local.js, src/state/seed.js, and src/state/persistence.js
- [ ] T022 [P] Implement the Supabase adapter with snake_case⇄camelCase mapping in src/data/adapters/supabase.js
- [ ] T023 Implement the error-translation table from contracts/README.md in src/data/adapters/supabase.js so callers see business errors, never raw database messages
- [ ] T024 Implement centralized state store and mutation helpers in src/state/store.js
- [ ] T025 [P] Implement date, money, validation, and storage utilities in src/utils/dates.js, src/utils/money.js, src/utils/validation.js, and src/utils/storage.js
- [ ] T026 [P] Implement per-entity data modules delegating to the repository in src/data/rooms.js, orders.js, reviews.js, refunds.js, profiles.js, favorites.js, risk-checks.js, channel-prices.js, admin-logs.js, settings.js, and site-content.js
- [ ] T027 Build auth/session flow over Supabase Auth with a simulated fallback for demo mode in src/services/auth.js, and guest/member/admin guards in src/router.js
- [ ] T028 Implement the audit-log writer in src/services/audit.js and wire it into every admin mutation path so a change can never be saved without a log entry (FR-114)
- [ ] T029 Create shared header, layout shell, loading and error states, and app container in src/components/header.js and src/app.js
- [ ] T030 [P] Add the persistent demo-mode indicator in src/components/demo-badge.js and the reusable simulated-data indicator in src/components/simulated-badge.js (FR-079, FR-110)
- [ ] T031 Implement booking and search core logic with half-open overlap rules, room-state checks, and pending-payment occupancy in src/services/search.js and src/services/booking.js
- [ ] T032 [P] Configure role-aware admin access and navigation for all eleven back-office modules in src/pages/admin.js and src/components/admin-panel.js
- [ ] T033 [2M] Verify both modes boot correctly: with credentials the app reads from Supabase; with empty credentials it enters demo mode and issues zero network requests (SC-018)

**Checkpoint**: 基礎設施完成後，所有使用者故事都可以在平行中開始實作

---

## Phase 4: User Story 1 - 訪客瀏覽、搜尋與篩選房源 (Priority: P1) 🎯 MVP

**Independent Test**: 在未登入情境下設定日期、人數、價格上限、設施與特色條件和排序，確認列表更新、房型切換與詳情頁顯示均正確

- [ ] T034 [P] [US1] Build room list rendering and room card layout in src/pages/home.js and src/components/room-card.js
- [ ] T035 [P] [US1] Build the filter bar with multi-select amenities and features in src/components/filter-bar.js
- [ ] T036 [US1] Implement guest search, sort, and AND-logic amenity/feature filtering in src/services/search.js
- [ ] T037 [US1] Display active filters with a one-click clear control in src/components/filter-bar.js (FR-010)
- [ ] T038 [US1] Implement room detail page, rating display (null shows 尚無評分, never 0), and total price calculation in src/pages/room-detail.js and src/utils/dates.js
- [ ] T039 [US1] Add room status UX, loading state, empty state, and no-result messaging in src/pages/home.js and src/components/room-card.js
- [ ] T040 [US1] Wire booking CTA redirect for guests and preserve filter state across navigation in src/pages/room-detail.js and src/router.js
- [ ] T041 [P] [US1] [2M] Validate homepage and detail-page acceptance scenarios against the browser flow in quickstart.md

---

## Phase 5: User Story 2 - 會員註冊、登入與帳戶管理 (Priority: P2)

**Independent Test**: 註冊、登出、重新登入、以 Google 登入、更新顯示名稱後刷新確認資料維持；再於另一瀏覽器以同一帳號登入確認資料一致

- [ ] T042 [P] [US2] Create registration and login forms with the demo-project password warning and public test accounts in src/pages/login.js
- [ ] T043 [US2] Implement signUp/signIn/signOut over Supabase Auth with display_name passed through user metadata in src/services/auth.js
- [ ] T044 [US2] Implement signInWithGoogle and the OAuth return flow, restoring the originally requested route in src/services/auth.js and src/router.js
- [ ] T045 [US2] Disable the Google button in demo mode with an explanation, never faking a consent screen (FR-089)
- [ ] T046 [US2] Handle the user-cancelled OAuth case with a 已取消登入 message and no account creation (FR-090)
- [ ] T047 [US2] Implement session restore via getSession and onAuthStateChange, plus session-expiry handling in src/services/auth.js and src/state/store.js
- [ ] T048 [US2] Add password-length and duplicate-email validation with messages that never reveal whether an email exists in src/pages/login.js and src/services/auth.js
- [ ] T049 [US2] Add account settings page, profile update handling, logout, role-aware routing, and header name sync in src/pages/account.js, src/router.js, and src/components/header.js
- [ ] T050 [P] [US2] [2M] Validate registration, login, Google login, account merging by email, logout, persistence, and cross-browser identity (SC-021, SC-025)

---

## Phase 6: User Story 3 - 三步驟訂房、虛擬支付與保留時效 (Priority: P3)

**Independent Test**: 建立一筆訂單、確認房源在保留期間不可再訂、逾期後確認自動釋出

- [ ] T051 [P] [US3] Build three-step booking form UI with contact name, phone, email, and step persistence in src/components/booking-form.js
- [ ] T052 [US3] Calculate nights, total amount, and validation errors in src/services/booking.js and src/utils/dates.js
- [ ] T053 [US3] Implement payment selection with the 虛擬支付 notice and confirmation summary in src/components/booking-form.js
- [ ] T054 [US3] Persist order creation as pending-payment with expires_at, guest-count checks, availability re-check, and order number generation in src/data/orders.js and src/services/booking.js
- [ ] T055 [US3] Implement payOrder (pending-payment → confirmed) and the order confirmation screen in src/services/booking.js and src/pages/orders.js
- [ ] T056 [US3] Build the remaining-time countdown for pending-payment orders in src/components/payment-countdown.js (FR-102)
- [ ] T057 [US3] Handle ORDER_EXPIRED on late payment with a clear message and a re-book entry point (FR-100)
- [ ] T058 [US3] Handle ROOM_UNAVAILABLE as a friendly 已無空房 message that preserves the filled form, and add reload-safe form behavior in src/components/booking-form.js
- [ ] T059 [P] [US3] [2M] Validate booking, payment, expiry release, and late-payment rejection; in Supabase mode also verify two concurrent conflicting submissions yield exactly one order (SC-020, SC-023, SC-024)

---

## Phase 7: User Story 4 - 我的訂單與退款申請 (Priority: P4)

- [ ] T060 [P] [US4] Implement order list and detail page showing all six statuses in src/pages/orders.js
- [ ] T061 [US4] Create refund request form and reason validation in src/pages/orders.js and src/services/refunds.js
- [ ] T062 [US4] Enforce one-pending-refund rules, date validity checks, and tiered refund amount logic in src/services/refunds.js
- [ ] T063 [US4] Reflect admin approval/rejection updates back to the member order view in src/state/store.js and src/pages/orders.js
- [ ] T064 [P] [US4] [2M] Validate refund flow and status changes; in Supabase mode verify a member cannot read another member's order by ID (SC-019)

---

## Phase 8: User Story 5 - 評論撰寫、自動審核與公開 (Priority: P5)

**⚠️ 標示要求**: 自動審核 MUST 標示為「自動審核（規則式）」，MUST NOT 稱為 AI（FR-103a）

- [ ] T065 [P] [US5] Create review submission form and validation in src/pages/room-detail.js and src/services/reviews.js
- [ ] T066 [US5] Implement the rule-based moderation engine (profanity, too-short, rating/sentiment mismatch, duplicate, gibberish, contact info or external links) returning a verdict plus triggered rule codes in src/services/moderation.js
- [ ] T067 [US5] Persist autoVerdict and autoRules on submission, keeping status pending until an admin confirms (FR-103)
- [ ] T068 [US5] Implement pending/approved/rejected state transitions and one-review-per-order enforcement in src/services/reviews.js
- [ ] T069 [US5] Publish approved reviews and surface the recomputed room average rating in src/data/reviews.js (Supabase 模式由 trigger 重算，示範模式於 adapter 內以相同規則重算)
- [ ] T070 [US5] Add public review filtering, category tabs, and no-review empty-state handling in src/pages/room-detail.js
- [ ] T071 [US5] Label the mechanism as 規則式自動審核 wherever it is surfaced to users or admins (FR-103a)
- [ ] T072 [P] [US5] [2M] Validate moderation outcomes against the five sample reviews and confirm pending reviews are invisible to anon (SC-007, SC-029)

---

## Phase 9: User Story 6 - 後台核心管理與營運指標 (Priority: P6)

- [ ] T073 [P] [US6] Build admin dashboard and room management screens in src/pages/admin.js and src/components/admin-panel.js
- [ ] T074 [US6] Implement the order statistics block: total orders, total placed, paid orders, unpaid-cancelled orders, conversion rate, total revenue, average order value (FR-049 群組)
- [ ] T075 [US6] Render 「—」 instead of 0 or a division error when there are no orders (SC 對應 US6 場景 3)
- [ ] T076 [US6] Implement room CRUD including amenities and features editing, maintenance state changes, and future-order protection with double confirmation in src/data/rooms.js and src/pages/admin.js
- [ ] T077 [US6] Add order search, filter, and status editing in src/pages/admin.js and src/services/booking.js
- [ ] T078 [US6] Implement user management and admin promotion via profiles in src/pages/admin.js and src/services/auth.js
- [ ] T079 [P] [US6] [2M] Validate admin dashboard, statistics, and role-aware access; in Supabase mode verify a member's direct write to rooms is rejected by RLS (SC-008)

---

## Phase 10: User Story 7 - 後台審核：評論審核與退款審核 (Priority: P7)

- [ ] T080 [P] [US7] Implement the review moderation queue showing each item's auto verdict and triggered rules in src/pages/admin.js
- [ ] T081 [US7] Implement admin override of auto verdicts and deletion of published reviews, both writing to the audit log (FR-103b, FR-103c)
- [ ] T082 [US7] Implement refund moderation queue and release the date range on approved refunds in src/pages/admin.js and src/services/refunds.js
- [ ] T083 [P] [US7] [2M] Validate review and refund approval/rejection flows across admin and member views (SC-006)

---

## Phase 11: User Story 8 - 後台輔助：報表匯出與內容編輯 (Priority: P8)

- [ ] T084 [P] [US8] Implement Excel export with CSV fallback and the zero-row guard in src/services/export.js
- [ ] T085 [US8] Add homepage title/subtitle/image editing with live content updates in src/data/site-content.js and src/pages/home.js
- [ ] T086 [P] [US8] [2M] Validate export fallback and content editing UX in browser-based checks (SC-010)

---

## Phase 12: User Story 9 - 拍照風險預測與房源品質檢測 (Priority: P9)

**⚠️ 約束**: 前台使用者上傳的照片 MUST NOT 離開瀏覽器。兩條路徑的程式碼 MUST 分離——
`pages/risk-check.js` MUST NOT import `services/risk-upload.js`（FR-086、憲章原則 VI）

- [ ] T087 [P] [US9] Build the front-of-house risk check page with upload control, preview, and processing state in src/pages/risk-check.js
- [ ] T088 [US9] Implement in-browser Canvas analysis of brightness, clutter, and contrast in src/services/risk-score.js (shared by both paths — computation only, no storage)
- [ ] T089 [US9] Implement the weighted risk score, three risk levels, and per-metric improvement suggestions in src/services/risk-score.js
- [ ] T090 [US9] Add file-type and size validation, and ensure a second upload fully replaces the previous result in src/pages/risk-check.js
- [ ] T091 [US9] Implement the admin-only room check upload in src/services/risk-upload.js, including the explicit 「此圖將公開顯示」 confirmation before saving (FR-105)
- [ ] T092 [US9] Delete the previous image from storage when a room is re-checked so old images stop being publicly readable (FR-107)
- [ ] T093 [US9] Display the latest check (date, level, three metrics, image) on the room detail page, with a 尚未檢測 state when absent (FR-106)
- [ ] T094 [P] [US9] [2M] Validate scoring differentiation, zero outbound requests during front-of-house analysis, and that no visitor photo reaches storage or any table (SC-015, SC-016, SC-030)

---

## Phase 13: User Story 10 - 收藏房源 (Priority: P10)

- [ ] T095 [P] [US10] Add the favorite star control to room cards and the detail page in src/components/room-card.js and src/pages/room-detail.js
- [ ] T096 [US10] Implement addFavorite/removeFavorite with optimistic UI and ALREADY_FAVORITED treated as success in src/data/favorites.js
- [ ] T097 [US10] Build the 我的收藏 page with newest-first ordering and an empty state in src/pages/favorites.js
- [ ] T098 [US10] Redirect unauthenticated users to login and complete the pending favorite after returning (FR-093)
- [ ] T099 [P] [US10] [2M] Validate favorite persistence, deleted-room handling, and that a member cannot read another member's favorites

---

## Phase 14: User Story 11 - 渠道比價與控價預警（模擬） (Priority: P11)

**⚠️ 模擬功能**: 價格來自種子資料。MUST NOT 實作爬蟲，MUST NOT 呼叫任何 OTA API（FR-109）

- [ ] T100 [P] [US11] Build the channel comparison page with the persistent 模擬資料 banner in src/pages/admin-channel.js (FR-110)
- [ ] T101 [US11] Implement price-gap and undercut calculation in src/services/channel.js
- [ ] T102 [US11] Render the per-room comparison table with website price, each channel price, gap amount, and gap percentage
- [ ] T103 [US11] Surface unresolved undercut alerts on the dashboard and implement resolve-with-audit-log in src/pages/admin.js and src/services/channel.js (FR-111, FR-113)
- [ ] T104 [US11] Implement the copyable complaint email template with an explicit 系統不會代為寄送 notice in src/services/channel.js (FR-112)
- [ ] T105 [P] [US11] [2M] Validate alert detection, template generation, empty state, and confirm zero requests to any external booking platform (SC-028)

---

## Phase 15: User Story 12 - 管理員操作日誌與系統參數設定 (Priority: P12)

- [ ] T106 [P] [US12] Build the audit log viewer with actor, time, action, target, and change summary in src/pages/admin-logs.js
- [ ] T107 [US12] Add filtering by actor, action type, and date range in src/pages/admin-logs.js
- [ ] T108 [US12] Build the system settings page for pending_payment_minutes with range validation and the SETTING_OUT_OF_RANGE message in src/pages/admin-settings.js (FR-119)
- [ ] T109 [US12] Verify setting changes apply to new orders only and never alter existing expires_at values (FR-101)
- [ ] T110 [US12] Audit every admin mutation path to confirm a log entry is written, and that no log contains passwords, keys, or real personal data (FR-118, SC-026)
- [ ] T111 [P] [US12] [2M] Validate log immutability from the UI and from a direct database call, including as an admin (SC-027)

---

## Phase 16: 跨切面 — 法律與說明

- [ ] T112 Build the terms of service and privacy notice page, linked from the site footer, stating this is a demo project with no real accommodation, transactions, or personal data collection (FR-121, FR-122)

---

## Phase 17: Polish & Cross-Cutting Concerns

- [ ] T113 [P] Review accessibility, responsive layout, and keyboard-safe controls across index.html, styles/, and src/components/*
- [ ] T114 [P] Audit error handling and edge-case guards across all modules, including offline behavior and session expiry in Supabase mode
- [ ] T115 [P] Verify no page or component calls the Supabase client or localStorage directly — all access goes through src/data/repository.js
- [ ] T116 [P] Verify src/pages/risk-check.js has no import path reaching src/services/risk-upload.js
- [ ] T117 [2M] Run the full quickstart.md validation in both modes and fix any acceptance gaps (SC-017)
- [ ] T118 Confirm zero console errors and warnings during normal flows in both modes (SC-014)
- [ ] T119 Documentation updates and code cleanup in README.md and inline source comments

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
