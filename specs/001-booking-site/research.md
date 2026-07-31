# Research: Sunny 訂房平台

## Decision: Use browser-local persistence and a data-access layer

**Decision**: All runtime data will live in `localStorage` under a small set of named collections: `users`, `rooms`, `orders`, `reviews`, `refunds`, and `siteContent`.

**Rationale**: The constitution requires a swappable data layer and rejects build-tool dependencies. Centralizing the storage and mutation logic allows a future switch to a real API without rewriting UI logic.

**Alternatives considered**:
- Direct DOM state only — rejected because it would scatter logic and make resets and admin edits error-prone.
- Inline JSON in script files — rejected because it would prevent realistic seed resets and future backend replacement.

## Decision: Refund policy by days before check-in

**Decision**:
- 7+ days before check-in: 100% refund
- 3–6 days before check-in: 50% refund
- 1–2 days before check-in: 20% refund
- same day / after check-in: 0% refund

**Rationale**: This is explicit, easy to calculate, and easy to validate in the browser. It also supports the review and admin process without leaving ambiguity.

**Alternatives considered**:
- Full refund always — rejected because it does not express the planned business constraint.
- Full refund with admin override only — rejected because it is less testable and less predictable for demo users.

## Decision: Photo risk scoring formula

**Decision**: Score three metrics (brightness, clutter, contrast) on a 0–100 scale, then compute overall risk as:

`100 - (0.4 × brightness + 0.35 × clutter + 0.25 × contrast)`

Risk levels:
- 0–34: low risk
- 35–59: medium risk
- 60–100: high risk

**Rationale**: The rule is simple, deterministic, and can be implemented entirely in-browser with Canvas without external services.

**Alternatives considered**:
- Binary pass/fail only — rejected because it is not expressive enough for the admin and user guidance requirement.
- External AI model — rejected because it violates the browser-only and no-network requirement.

## Decision: Date correctness model

**Decision**: Use `YYYY-MM-DD` strings in Asia/Taipei timezone; compare by calendar dates, not timestamps; use half-open interval logic to detect overlaps.

**Rationale**: The constitution explicitly requires this to prevent booking logic errors. It also matches the user-facing requirements and reduces timezone confusion.

**Alternatives considered**:
- Timestamp comparisons in local timezone — rejected because it can shift around DST or browser timezone differences.
- Simple string comparisons without interval rules — rejected because it fails on adjacent and nested date edge cases.

## Decision: Role gating remains presentation-layer only

**Decision**: Admin and member access control will be enforced through UI gating and route checks, not treated as secure backend enforcement.

**Rationale**: The project is deliberately browser-only and the constitution states this is not a real security mechanism; it is only a UX and permission model.

**Alternatives considered**:
- Real backend auth — rejected because it violates the no-build/no-backend constraints.
- Hidden routes but no checks — rejected because it does not satisfy the UX and access-control requirements.

## Decision: Simulated payment and refund model

**Decision**: Payment methods are present in the interface, but they are clearly labeled as virtual and never store or request real financial data.

**Rationale**: This matches the constitution’s “No False Security, No False Payment” principle and the requirement to show simulation clearly.

**Alternatives considered**:
- Card entry forms with fake fields — rejected because it risks user confusion and does not meet the product disclosure requirement.
- No payment selection UI — rejected because the feature requirement explicitly calls for payment methods.
