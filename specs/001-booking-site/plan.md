# Implementation Plan: Sunny 訂房平台

**Branch**: `001-booking-site` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-booking-site/spec.md`

**Revision 2026-07-31 (2)**: 依產品企劃書修訂版納入 Google 登入、設施與房型特色
篩選、收藏房源、待付款保留時效、規則式評論自動審核、房源品質檢測、渠道比價（模擬）、
操作日誌與系統參數設定。對應憲章 **v2.3.0**。

**Revision 2026-07-31 (1)**: 資料層由「僅瀏覽器 `localStorage`」改為
「**Supabase 為主、`localStorage` 為示範模式備援**」。認證改用 Supabase Auth。

## Summary

This feature delivers a single-page hotel booking application in pure browser JavaScript — no framework, no build step — with guest browsing/search, member registration and login, three-step booking with simulated payments, order/refund flows, review moderation, admin management screens, and a browser-only photo risk scoring feature.

**Data layer**: The app stores its data in **Supabase** (hosted Postgres + Supabase Auth), called directly from the browser via the `@supabase/supabase-js` v2 ESM CDN build. Access control is enforced by Postgres Row Level Security, and "no two valid orders for the same room on the same night" is enforced by a Postgres exclusion constraint rather than by front-end checks alone.

**Demo Mode Requirement**: If no Supabase credentials are configured in `src/config.js`, the app must automatically boot into demo mode. In this mode, all data lives in browser `localStorage`, the feature set remains complete, and **no network request is issued at all** — the Supabase client module is never even loaded. This keeps the project openable and fully usable with zero setup.

Both modes sit behind one asynchronous data-access interface, so no page or component knows which backend is active.

## Technical Context

**Language/Version**: HTML5, CSS3, ES modules / modern browser JavaScript (no framework)

**Primary Dependencies**:
- `@supabase/supabase-js` v2 — loaded via dynamic `import('https://esm.sh/@supabase/supabase-js@2')`, only when credentials are present
- SheetJS (xlsx) — optional `<script>` tag for XLSX export, with CSV fallback
- Otherwise native browser APIs only

**Storage**:
- Primary: Supabase hosted Postgres — `profiles`, `rooms`, `orders`, `reviews`, `refunds`, `site_content`, `favorites`, `room_risk_checks`, `channel_prices`, `admin_logs`, `system_settings`; schema in [`supabase/schema.sql`](../../supabase/schema.sql)
- Fallback: browser `localStorage` with seed-data initialization
- Both behind `src/data/repository.js`

**Authentication**: Supabase Auth (`signUp` / `signInWithPassword` / `signInWithOAuth({provider:'google'})` / `signOut` / `onAuthStateChange`). Application-level user data lives in `public.profiles`, keyed by `auth.users.id`. No password column exists anywhere in the application schema. Demo mode uses a simulated login against seeded accounts and disables the Google button with an explanation — it never fakes a third-party consent screen.

**File storage**: One Supabase Storage bucket, `room-risk`, public-read and admin-write. It holds **only** the admin's room quality-check images, which are shown publicly on room detail pages. Front-of-house "安全檢測" photos uploaded by visitors never reach it — that path has no upload function at all.

**Simulated integrations**: Two features named in the planning document are deliberately implemented as simulations, labeled as such in the UI:
- **Channel price monitoring** — prices come from the seeded `channel_prices` table. No crawler, no OTA API. A browser cannot run scheduled cross-origin scraping, and doing it server-side would mean a self-hosted backend plus third-party ToS risk.
- **"AI" review moderation** — a rule-based engine running in the browser, surfaced as 「自動審核（規則式）」. Calling an LLM would require an API key that has nowhere safe to live in a build-free front end.

**Scheduled work**: none. Expiring unpaid orders is handled by `expire_stale_orders()`, invoked before availability queries, order creation, and order list reads. No pg_cron, no Edge Functions, no webhooks.

**Configuration**: `src/config.js`, loaded by a plain `<script>` tag before the app module, sets `window.__SUNNY_CONFIG__ = { SUPABASE_URL, SUPABASE_ANON_KEY }`. Ships with empty strings (= demo mode). The front end does **not** read `.env`, `process.env`, or `import.meta.env` — none of these exist in a browser without a build step.

**Testing**: Manual browser validation against the acceptance scenarios and edge-case checklist, executed **twice — once per mode**; no automated test framework required by the constitution

**Target Platform**: Latest Chrome, Edge, Firefox, Safari on desktop and mobile browsers

**Project Type**: Single-page web application with a hosted backend-as-a-service

**Performance Goals**: Demo-mode search updates feel instant (< 200 ms); Supabase-mode list queries complete under 1 second on a normal connection with a visible loading state; initial page load under 2 seconds; no build step

**Constraints**: No framework, no bundler, no self-hosted backend, no real payment or identity providers, static file serving only, automatic demo mode when credentials are absent, zero network requests in demo mode, anon key only (never `service_role`), RLS mandatory on every table

**Scale/Scope**: One hotel, roughly 8–12 rooms, 3–4 room types, demo bookings, reviews, refunds, and admin workflows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **v2.3.0**.

- ✅ **I. 規格先行** — this feature has a validated specification and acceptance criteria in [spec.md](./spec.md); every planning-document change was written into the spec and constitution before any implementation
- ✅ **II. 零建置的原生前端** — no framework, no bundler, no `npm install`; Supabase is a hosted service reached over an ESM CDN, not a self-hosted backend; no Edge Functions, no cron, no crawler; demo mode preserves "just open `index.html`"
- ✅ **III. 雙軌資料層** — two adapters with identical signatures behind `src/data/repository.js`; every data function is async in both modes
- ✅ **IV. 訂房邏輯正確性** — Asia/Taipei `YYYY-MM-DD` strings, half-open intervals, one-night logic, room-state blocking; pending-payment orders occupy availability and are released on expiry; all enforced at the database via a gist exclusion constraint plus `expire_stale_orders()`
- ✅ **V. 無障礙與響應式基本線** — keyboard-safe controls, semantic HTML, focus styles, responsive layout, Traditional Chinese copy
- ✅ **VI. 誠實標示模擬範圍** — auth is real in Supabase mode and labeled as such; payment and refund remain simulated in both modes; channel pricing is seeded data and labeled 模擬; review moderation is labeled 規則式 not AI; the two photo paths are separated by ownership, not by a flag
- ✅ **Supabase 約束** — RLS on every table including the four new ones, anon key only, `service_role` absent from front end and version control, `admin_logs` has no UPDATE/DELETE policy and has those grants revoked, the `room-risk` bucket is admin-write only, schema kept idempotent
- ✅ No constitution violations requiring complex exceptions

**Deviations**: none. Three planning-document items were delivered as simulations rather than live integrations — channel price crawling, AI moderation, and scheduled order expiry. Each is documented in [research.md](./research.md) with its alternatives; each is labeled in the UI. These are scope decisions confirmed with the project owner, not silent substitutions.

## Project Structure

### Documentation (this feature)

```text
specs/001-booking-site/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── README.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
index.html
src/config.js                 # 憑證設定；預設留空 = 示範模式
src/config.example.js         # 填法範例
styles/
├── base.css
├── layout.css
├── components.css
├── admin.css
└── responsive.css
src/
├── app.js
├── router.js
├── lib/
│   └── supabase.js           # client 建立、憑證偵測、demo mode 判定
├── state/
│   ├── store.js
│   ├── seed.js
│   └── persistence.js
├── data/
│   ├── repository.js         # facade：依憑證擇一綁定 adapter
│   ├── adapters/
│   │   ├── supabase.js       # Postgres 實作 + snake_case⇄camelCase 轉換 + 錯誤轉譯
│   │   └── local.js          # localStorage 實作
│   ├── rooms.js
│   ├── orders.js
│   ├── reviews.js
│   ├── refunds.js
│   ├── profiles.js
│   ├── favorites.js
│   ├── risk-checks.js        # 房源檢測結果（僅管理員寫入）
│   ├── channel-prices.js     # 渠道比價（模擬資料）
│   ├── admin-logs.js         # 稽核日誌（僅可新增）
│   ├── settings.js           # 系統參數
│   └── site-content.js
├── services/
│   ├── auth.js               # 含 signInWithGoogle
│   ├── booking.js            # 含待付款保留與 expireStaleOrders 呼叫時機
│   ├── search.js             # 含設施 / 房型特色的 AND 篩選
│   ├── reviews.js
│   ├── moderation.js         # 規則式自動審核引擎（非 AI）
│   ├── refunds.js
│   ├── risk-score.js         # Canvas 指標計算，兩條路徑共用「計算」但不共用「儲存」
│   ├── risk-upload.js        # 僅管理員路徑會 import；前台頁面不得 import
│   ├── channel.js            # 價差計算、預警判定、申訴郵件範本組裝
│   ├── audit.js              # 寫入操作日誌
│   └── export.js
├── components/
│   ├── header.js
│   ├── room-card.js          # 含收藏星號
│   ├── booking-form.js
│   ├── payment-countdown.js  # 待付款剩餘時間
│   ├── filter-bar.js         # 設施 / 房型特色多選
│   ├── admin-panel.js
│   ├── demo-badge.js         # 示範模式常駐標示
│   ├── simulated-badge.js    # 模擬資料模組的常駐標示
│   └── modal.js
├── pages/
│   ├── home.js
│   ├── room-detail.js        # 含最新檢測結果區塊
│   ├── login.js              # 含 Google 登入按鈕
│   ├── account.js
│   ├── favorites.js
│   ├── orders.js
│   ├── terms.js              # 服務條款與隱私聲明
│   ├── admin.js
│   ├── admin-channel.js      # 渠道比價與控價（模擬）
│   ├── admin-logs.js         # 操作日誌
│   ├── admin-settings.js     # 系統與參數設定
│   └── risk-check.js         # 前台安全檢測：不得 import risk-upload.js
├── utils/
│   ├── dates.js
│   ├── money.js
│   ├── validation.js
│   └── storage.js
└── main.js
supabase/
├── schema.sql                # 資料表、約束、trigger、RLS 政策、Storage（可重複執行）
└── seed.sql                  # 示範房源、網站內容與模擬渠道價格
```

**Structure Decision**: Single-page, multi-section front end with a centralized async data layer. The `data/adapters/` split is the load-bearing part of this design: it is the only place that knows Supabase exists, and the only place that knows `localStorage` exists. Pages and services call `repository.js` and stay identical across modes.

**Migration note**: [`supabase/schema.sql`](../../supabase/schema.sql) and [`supabase/seed.sql`](../../supabase/seed.sql) already match this design (`profiles` instead of a plaintext `users.password` column, RLS on every table, gist exclusion constraint on `orders`). The one piece of existing source still out of step is [`src/lib/supabase.js`](../../src/lib/supabase.js), which reads `import.meta.env` / `process.env` — always `undefined` in a build-free browser, so that branch is dead code and the file must be rewritten onto the `window.__SUNNY_CONFIG__` path (task T013).

## Complexity Tracking

Three pieces of deliberate complexity, each justified below.

**1. Dual-adapter data layer.** Two hard requirements cannot both be met by a single backend:

| Requirement | Source | Only satisfiable by |
|---|---|---|
| 資料跨裝置共用、權限由資料庫強制 | FR-077 / FR-081 | Supabase |
| 未填憑證即完整可用、零網路請求 | Demo Mode Rule、FR-078 | localStorage |

Mitigation: identical function signatures, one binding point, one shared acceptance checklist run twice. Cost stays inside `src/data/`.

**2. Two separate photo paths.** A single upload function with a `shouldStore` flag would be simpler, and would be wrong — flags get set incorrectly during refactors, and the failure mode is uploading a visitor's private photo. Splitting into `risk-score.js` (metrics only, shared) and `risk-upload.js` (storage, admin pages only) makes the mistake structurally impossible: the front-of-house page never imports the upload module. Cost: one extra file.

**3. Expiry-on-read instead of a scheduled job.** `expire_stale_orders()` must be called at three separate points rather than running once a minute in the background. This is more call sites to remember, but a scheduled job would require Edge Functions or pg_cron (constitution II) and would have no equivalent in demo mode. The three call sites are documented in [data-model.md](./data-model.md) and enforced inside the repository layer, not left to individual pages.
