# Tasks: Sunny 訂房平台

**Input**: 設計文件來自 `/specs/001-booking-site/`

**Prerequisites**: `plan.md`（必要）、`spec.md`（必要）、`data-model.md`、`quickstart.md`、`contracts/`

**Organization**: 任務依使用者故事分組，讓每個故事都能獨立執行、測試與交付。

## Summary

- 總任務數：53
- 依故事分佈：US1 6、US2 5、US3 6、US4 5、US5 5、US6 5、US7 4、US8 3
- 平行機會：Setup / Foundational / 內部共享資料模組與 UI 組件可在多個檔案間並行處理
- MVP 建議：僅交付 US1（訪客瀏覽與搜尋）作為最小可行版本，然後依序補齊 US2 → US3 → US4 → US5 → US6 → US7 → US8
- 驗證要求：每個故事都與 `spec.md` 的獨立測試場景對應，且任務格式均採用 checklist 格式

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立專案基礎結構與前端入口，讓版本可直接在瀏覽器中運行

- [ ] T001 [P] Create project structure per implementation plan in index.html, styles/, src/, and spec documentation
- [ ] T002 Initialize browser-only app shell and entry point in index.html and src/main.js
- [ ] T003 [P] Configure localStorage seed data bootstrap and app initialization in src/state/seed.js and src/state/persistence.js
- [ ] T004 [P] Add automatic demo-mode boot logic so the app stays fully functional without Supabase credentials and never connects to any server

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有故事共享的資料層、狀態層與路由基礎，確保後續故事可獨立完成

**⚠️ CRITICAL**: 在完成此階段前，不得開始任何使用者故事的實裝

- [ ] T004 Implement centralized state store and mutation helpers in src/state/store.js
- [ ] T005 [P] Implement date, money, validation, and storage utilities in src/utils/dates.js, src/utils/money.js, src/utils/validation.js, and src/utils/storage.js
- [ ] T006 [P] Implement seeded user, room, order, review, refund, and site-content data models in src/data/users.js, src/data/rooms.js, src/data/orders.js, src/data/reviews.js, src/data/refunds.js, and src/data/site-content.js
- [ ] T007 Build auth/session flow and guest/member/admin guard logic in src/services/auth.js and src/router.js
- [ ] T008 Create shared header, layout shell, and app container in src/components/header.js and src/app.js
- [ ] T009 Implement booking and search core logic with overlap rules and room-state checks in src/services/search.js and src/services/booking.js
- [ ] T010 [P] Configure role-aware admin access and navigation behavior in src/pages/admin.js and src/components/admin-panel.js

**Checkpoint**: 基礎設施完成後，所有使用者故事都可以在平行中開始實作

---

## Phase 3: User Story 1 - 訪客瀏覽、搜尋與篩選房源 (Priority: P1) 🎯 MVP

**Goal**: 讓訪客可在不登入狀態下瀏覽房源、進行搜尋/篩選/排序，並查看房源詳情與房態

**Independent Test**: 在未登入情境下設定日期、人數、價格上限和排序條件，確認列表更新、房型切換與詳情頁顯示均正確

### Implementation for User Story 1

- [ ] T011 [P] [US1] Build room list rendering and room card layout in src/pages/home.js and src/components/room-card.js
- [ ] T012 [P] [US1] Implement guest search, filter, and sort logic in src/services/search.js
- [ ] T013 [US1] Implement room detail page, rating display, and total price calculation in src/pages/room-detail.js and src/utils/dates.js
- [ ] T014 [US1] Add room status UX, empty state, and no-result messaging in src/pages/home.js and src/components/room-card.js
- [ ] T015 [US1] Wire booking CTA redirect for guests and preserve filter state across navigation in src/pages/room-detail.js and src/router.js
- [ ] T016 [P] [US1] Validate homepage and detail-page acceptance scenarios against the browser flow in quickstart.md

**Checkpoint**: 完成後，User Story 1 可獨立運作並供驗收測試

---

## Phase 4: User Story 2 - 會員註冊、登入與帳戶管理 (Priority: P2)

**Goal**: 讓訪客可以註冊/登入，並在帳戶設定中更新個人資料與登入狀態持久化

**Independent Test**: 新增一個會員帳號、登出後再登入、更新顯示名稱後刷新頁面確認資料維持

### Implementation for User Story 2

- [ ] T017 [P] [US2] Create registration and login forms in src/pages/login.js
- [ ] T018 [US2] Implement auth service, credential validation, and localStorage session persistence in src/services/auth.js and src/state/store.js
- [ ] T019 [US2] Add account settings page and profile update handling in src/pages/account.js
- [ ] T020 [US2] Enforce logout, role-aware routing, and header display name sync in src/router.js and src/components/header.js
- [ ] T021 [P] [US2] Validate registration, login, logout, and persistence behaviors in browser scenarios

**Checkpoint**: 至此，User Story 1 與 2 可分別獨立驗收

---

## Phase 5: User Story 3 - 三步驟訂房與虛擬支付 (Priority: P3)

**Goal**: 讓登入會員可以完成帶日期/房源的三步驟訂房流程，並以模擬支付完成訂單建立

**Independent Test**: 使用 `guest@sunny.com` 建立一筆訂單，之後在相同日期搜尋該房源時確認已不可預訂

### Implementation for User Story 3

- [ ] T022 [P] [US3] Build three-step booking form UI and step persistence in src/components/booking-form.js
- [ ] T023 [US3] Calculate nights, total amount, and validation errors in src/services/booking.js and src/utils/dates.js
- [ ] T024 [US3] Implement payment selection, summary review, and order confirmation screen in src/components/booking-form.js and src/pages/orders.js
- [ ] T025 [US3] Persist order creation with guest-count checks, room availability checks, and order ID generation in src/data/orders.js and src/services/booking.js
- [ ] T026 [US3] Add reload-safe form behavior and explicit invalid-date/over-capacity messaging in src/components/booking-form.js
- [ ] T027 [P] [US3] Validate booking flow, room locking, and error handling against acceptance scenarios

**Checkpoint**: User Story 3 可作為核心交易流程獨立交付

---

## Phase 6: User Story 4 - 我的訂單與退款申請 (Priority: P4)

**Goal**: 讓會員查看訂單列表與詳情，並在核准前提交退款申請、追蹤審核狀態

**Independent Test**: 會員建立訂單後在「我的訂單」中見到它，並提交退款申請後狀態轉為「退款審核中」

### Implementation for User Story 4

- [ ] T028 [P] [US4] Implement order list and detail page in src/pages/orders.js
- [ ] T029 [US4] Create refund request form and reason validation in src/pages/orders.js and src/services/refunds.js
- [ ] T030 [US4] Enforce one-pending-refund rules, date validity checks, and refund amount logic in src/services/refunds.js
- [ ] T031 [US4] Reflect admin approval/rejection updates back to the member order view in src/state/store.js and src/pages/orders.js
- [ ] T032 [P] [US4] Validate refund flow, order access control, and status changes in browser checks

**Checkpoint**: US4 可獨立驗收，且不影響 US1–US3 的訂房核心

---

## Phase 7: User Story 5 - 撰寫與瀏覽評論評分 (Priority: P5)

**Goal**: 讓會員能在入住後新增評價，並讓管理員審核後公開至房源詳情頁

**Independent Test**: 會員提交一則評論，管理員審核通過後確認公開顯示且平均評分更新

### Implementation for User Story 5

- [ ] T033 [P] [US5] Create review submission form and validation in src/pages/room-detail.js and src/services/reviews.js
- [ ] T034 [US5] Implement pending/approved/rejected review state transitions and one-review-per-order enforcement in src/services/reviews.js
- [ ] T035 [US5] Publish approved reviews and recompute the room average rating in src/data/reviews.js and src/services/reviews.js
- [ ] T036 [US5] Add public review filtering, category tabs, and no-review empty-state handling in src/pages/room-detail.js
- [ ] T037 [P] [US5] Validate review moderation and public display behavior against acceptance scenarios

**Checkpoint**: 完成後，評價與房源平均分可在前台獨立運作

---

## Phase 8: User Story 6 - 後台核心管理：儀表板、房源、訂單、用戶 (Priority: P6)

**Goal**: 支持管理員維護營運數據、房源狀態、訂單狀態與會員權限

**Independent Test**: 以 `admin@sunny.com` 登入後新增房源、切換房態，並確認前台更新

### Implementation for User Story 6

- [ ] T038 [P] [US6] Build admin dashboard and room management screens in src/pages/admin.js and src/components/admin-panel.js
- [ ] T039 [US6] Implement room CRUD, maintenance state changes, and future-order protection in src/data/rooms.js and src/pages/admin.js
- [ ] T040 [US6] Add order search, filter, and status editing in src/pages/admin.js and src/services/booking.js
- [ ] T041 [US6] Implement user management and admin promotion in src/pages/admin.js and src/services/auth.js
- [ ] T042 [P] [US6] Validate admin dashboard and role-aware access flow in browser checks

**Checkpoint**: 管理端核心功能可獨立交付

---

## Phase 9: User Story 7 - 後台審核：評論審核與退款審核 (Priority: P7)

**Goal**: 讓管理員審核評論與退款申請，並將結果即時同步到前台和會員端

**Independent Test**: 建立待審核評論與退款申請後，以管理員通過與駁回，確認會員端與前台狀態同步更新

### Implementation for User Story 7

- [ ] T043 [P] [US7] Implement review moderation queue in src/pages/admin.js and src/services/reviews.js
- [ ] T044 [US7] Implement refund moderation queue in src/pages/admin.js and src/services/refunds.js
- [ ] T045 [US7] Reflect admin decisions to public listings and member views in src/state/store.js, src/pages/room-detail.js, and src/pages/orders.js
- [ ] T046 [P] [US7] Validate review and refund approval/rejection flows across admin and member views

**Checkpoint**: US7 可獨立驗收，且完成前後台審核閉環

---

## Phase 10: User Story 8 - 後台輔助：報表匯出與內容編輯 (Priority: P8)

**Goal**: 提供匯出報表與首頁內容編輯，提升管理員營運效率與內容自訂能力

**Independent Test**: 匯出訂單資料檔與修改首頁標題後，確認下載格式與前台內容更新正確

### Implementation for User Story 8

- [ ] T047 [P] [US8] Implement Excel/CSV export fallback logic in src/services/export.js
- [ ] T048 [US8] Add homepage title/subtitle/image editing and live content updates in src/data/site-content.js and src/pages/home.js
- [ ] T049 [P] [US8] Validate export fallback and content editing UX in browser-based checks

**Checkpoint**: 所有主要故事均已完成，後續僅追加質量與文檔優化

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: 最後檢查可用性、穩定性、可訪問性與文檔一致性

- [ ] T050 [P] Review accessibility, responsive layout, and keyboard-safe controls across index.html, styles/, and src/components/*
- [ ] T051 [P] Audit localStorage persistence, error handling, and edge-case guards across all modules
- [ ] T052 [P] Run quickstart.md validation and fix any remaining acceptance-gap issues
- [ ] T053 Documentation updates and code cleanup in README.md and inline source comments

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Setup，無依賴，可直接開始
- **Phase 2**: Foundational，依賴 Setup 完成，且阻擋所有故事
- **Phase 3–10**: User Story 1–8，皆依賴 Phase 2 完成後開始
- **Phase 11**: Polish，依賴所有目標故事完成

### User Story Dependencies

- **US1 (P1)**: 可在 Phase 2 完成後開始，且不依賴其他故事
- **US2 (P2)**: 可在 Phase 2 完成後開始，與 US1 共享登入狀態與導覽邏輯
- **US3 (P3)**: 可在 Phase 2 完成後開始，依賴 US1 與 US2 先行建立可預訂與登入情境
- **US4 (P4)**: 可在 US3 完成後開始，依賴訂單資料結構與預訂流程
- **US5 (P5)**: 可在 US3 與 US4 完成後開始，依賴已入住訂單與訂單狀態
- **US6 (P6)**: 可在 US1–US5 完成後開始，依賴管理員角色與後台基礎
- **US7 (P7)**: 可在 US4–US6 完成後開始，依賴審核與退款狀態流轉
- **US8 (P8)**: 可在 US6 完成後開始，與管理員儀表板和內容資料相依

### Parallel Opportunities

- Setup 與 Foundational 內的多個任務可同時處理
- US1、US2、US3 可在完成 Foundation 後由不同人員平行開發
- 各故事內的模組與檔案彼此可並行建立，例如資料層、服務層、頁面層
- 每個故事內的 UI 與狀態邏輯可在同一階段並行執行

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（此為關鍵阻塞階段）
3. 完成 Phase 3: User Story 1
4. 停止並驗證：確認不能登入情境下的房源瀏覽、搜尋、篩選與詳情頁皆可工作
5. 若達標，再依序交付 US2 ~ US8

### Incremental Delivery

- 第一版聚焦在房源瀏覽與預訂入口（US1 → US2 → US3）
- 第二階段補齊會員資料生命週期與訂單退款（US4 → US5）
- 第三階段補齊後台管理與審核（US6 → US7 → US8）
- 最後完成跨功能驗證與可用性優化
