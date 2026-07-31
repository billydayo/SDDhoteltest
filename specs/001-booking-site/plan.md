# Implementation Plan: Sunny 訂房平台

**Branch**: `001-booking-site` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-booking-site/spec.md`

## Summary

This feature delivers a single-page hotel booking demo in pure browser JavaScript, with guest browsing/search, member registration and login, three-step booking with simulated payments, order/refund flows, review moderation, admin management screens, and a browser-only photo risk scoring feature. The app stores all data in `localStorage`, uses no build tooling, and keeps the user experience fully testable by opening the app directly in a browser.

## Technical Context

**Language/Version**: HTML5, CSS3, ES modules / modern browser JavaScript (no framework)

**Primary Dependencies**: Native browser APIs; optional SheetJS via `<script>` tag for CSV/XLSX export fallback; `localStorage` persistence

**Storage**: Browser `localStorage` with seed data initialization and a centralized data-access layer

**Testing**: Manual browser validation against the acceptance scenarios and edge-case checklist; no automated test framework required by the constitution

**Target Platform**: Latest Chrome, Edge, Firefox, Safari on desktop and mobile browsers

**Project Type**: Single-page web application

**Performance Goals**: Room list/search updates feel instant (< 200 ms for local in-browser operations), initial page load under 2 seconds on modern hardware, no build step

**Constraints**: No framework, no build pipeline, no backend, no real payment or identity services, local-only data persistence, static file serving only

**Scale/Scope**: One hotel, roughly 8–12 rooms, 3–4 room types, demo bookings, reviews, refunds, and admin workflows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- ✅ Spec-first: this feature has a validated specification and acceptance criteria in [spec.md](./spec.md)
- ✅ Vanilla-first: no build step, framework, or backend is required; implementation uses static HTML/CSS/JS
- ✅ Data-as-swappable-layer: all data access is centralized and planned to live behind data-access functions rather than direct DOM writes
- ✅ Booking correctness: the plan will enforce Asia/Taipei date handling, `YYYY-MM-DD` strings, half-open interval rules, one-night logic, and room-state blocking
- ✅ Accessibility/responsive baseline: keyboard-safe controls, semantic HTML, focus styles, responsive layout, and Chinese copy are required
- ✅ Honest simulation: login, payment, and refund flows are explicitly demo-only and labeled as simulated
- ✅ No constitution violations requiring complex exceptions

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
└── tasks.md (generated later by /speckit-tasks)
```

### Source Code (repository root)

```text
index.html
styles/
├── base.css
├── layout.css
├── components.css
├── admin.css
└── responsive.css
src/
├── app.js
├── router.js
├── state/
│   ├── store.js
│   ├── seed.js
│   └── persistence.js
├── data/
│   ├── users.js
│   ├── rooms.js
│   ├── orders.js
│   ├── reviews.js
│   ├── refunds.js
│   └── site-content.js
├── services/
│   ├── auth.js
│   ├── booking.js
│   ├── search.js
│   ├── reviews.js
│   ├── refunds.js
│   ├── risk-score.js
│   └── export.js
├── components/
│   ├── header.js
│   ├── room-card.js
│   ├── booking-form.js
│   ├── admin-panel.js
│   └── modal.js
├── pages/
│   ├── home.js
│   ├── room-detail.js
│   ├── login.js
│   ├── account.js
│   ├── orders.js
│   ├── admin.js
│   └── risk-check.js
├── utils/
│   ├── dates.js
│   ├── money.js
│   ├── validation.js
│   └── storage.js
└── main.js
```

**Structure Decision**: The app will use a single-page, multi-section front-end with a centralized state layer and modular JS files. The structure is intentionally static and dependency-light to satisfy the no-build-step constitution while keeping data concerns clean and replaceable.

## Complexity Tracking

No constitution violations were identified; no explicit complexity justification is required.
