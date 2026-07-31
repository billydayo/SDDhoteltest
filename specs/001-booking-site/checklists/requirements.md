# Specification Quality Checklist: Sunny 訂房平台

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-30
**Updated**: 2026-07-31（依產品企劃書修訂版更新規格後重新驗證）
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### 第 5 輪驗證（2026-07-31，企劃書修訂版）

16 項中 16 項通過。新增 US10–US12 與 FR-087 ~ FR-122，並擴充 US1、US2、US3、US5、
US6、US9 的驗收場景。

**三項企劃書需求以模擬方式交付，已明確記錄而非默默縮減範圍**：

| 企劃書所述 | 實際交付 | 記錄於 |
|---|---|---|
| 渠道控價：定時爬蟲 / API 對接 | 模組完整實作，價格為種子資料 | FR-109、FR-110、research.md |
| 評論「AI 送審」 | 規則式引擎，標示為「自動審核（規則式）」 | FR-103a、research.md |
| 未付款訂單逾期「自動取消」 | 查詢時判定，非背景排程 | Assumptions、research.md |

三者皆非能力不足，而是與憲章原則 II（無自建後端、無排程、無爬蟲）與原則 VI
（誠實標示）的必然結果。每一項都在 research.md 附有替代方案評估與否決理由，
並在介面上向使用者標示。

**企劃書自身的內部矛盾與本規格的處理**：

- 第四節稱「純前端單一檔案，無需後端伺服器」，但同節指定資料存於 supabase，
  且第四節後半又列出「定時爬蟲 / API 對接」。→ 本規格以雙軌資料層解決前兩者
  （Supabase 為主、未設定憑證時退回本機），並以模擬資料處理第三者。
- 第八節稱「資料存於本機瀏覽器」，與第六節「以 supabase 作為資料層」牴觸。
  → 兩者分別對應示範模式與資料庫模式，已於規格開頭明確定義。
- 第四節稱後台為「九大模組」，實際列出十一項。→ 本規格以十一項為準。
- 第六節列出 `users` 含「密碼」欄位。→ 本規格改由 Supabase Auth 保管密碼，
  應用資料表不存在密碼欄位（FR-009a）。這是對企劃書的**修正**而非遺漏：
  資料上雲後，明文密碼是實質風險。

**關於「無實作細節」一項**：新增的 FR 一律以能力描述表達（「雲端資料庫」「認證服務」
「外部訂房平台」「規則式自動審核」），未寫入產品名稱。規格開頭的決策區塊點名
Supabase 與 Google，屬 Input／決策紀錄而非需求條文。

### 第 4 輪驗證（2026-07-31，資料層改為 Supabase）

16 項中 16 項通過。本輪變更與對應處理：

- **新增需求群組「資料儲存與運作模式」（FR-077 ~ FR-086）** — 涵蓋雲端資料庫為主、
  示範模式備援、模式標示、兩模式行為一致、資料庫端權限、資料庫端不重複預訂、
  連線失敗與憑證錯誤處理、管理金鑰禁令。
- **新增 FR-009a ~ FR-009d** — 密碼不得存於應用資料、密碼長度下限、跨裝置一致性、
  工作階段過期處理。
- **新增 SC-017 ~ SC-022** — 皆為可量測的驗收指標（兩模式通過率、示範模式網路請求數、
  越權讀取結果數、並行訂房成立筆數、跨裝置可見性、版控中的管理金鑰數）。
- **Key Entities 拆分** — 原「使用者」拆為「使用者（認證身分）」與「個人檔案」，
  移除密碼屬性。
- **Edge Cases 新增** — 並行競搶、連線失敗、工作階段過期、憑證缺席或錯誤。
- **Assumptions 修訂** — 「資料存於瀏覽器」改為「資料存於雲端資料庫（示範模式除外）」；
  「單一使用者操作」改為「多人並行，由資料庫保證不重複預訂」；並定義「即時反映」
  為下次查詢可見，不含推播。

**關於「無實作細節」一項**：FR-077 ~ FR-086 一律以「雲端資料庫」「本機儲存」
「認證服務」等能力描述表達，未寫入產品名稱。規格開頭的「資料層決策」區塊確實點名
Supabase——該區塊屬於 Input／決策紀錄而非需求條文，技術選型的理由與替代方案評估
記錄於 [research.md](../research.md)，約束記錄於憲章。此為刻意保留，非缺陷。

### 第 3 輪驗證（決策已落定）

16 項中 16 項通過。兩個原先保留的 [NEEDS CLARIFICATION] 標記已被明確決策取代：

- **FR-041** — 退款金額規則已定義為依距入住日期長短分級：7 天以上全額退款；3–6 天 50%；1–2 天 20%；入住當日或已入住不退款。
- **FR-068** — 拍照風險評分規則已定義為亮度、雜亂度、對比三項指標加權計算，總風險分數 0–100，並分為低／中／高三個等級。

### 企劃書已解答的前一輪問題

- 訂房前需先註冊／登入（企劃書二、系統角色與權限）→ 已寫入 FR-019。
- 需提供自助註冊（企劃書三、1. 會員系統）→ 已寫入 FR-001。
- 資料以 localStorage 持久保留（企劃書四、系統架構）→ 已寫入 FR-071。

### 已保留於「無實作細節」的處理

企劃書明確指定了技術（localStorage、Canvas API、SheetJS）。這些屬於憲章與 `plan.md`
的範疇，本規格僅以使用者可觀察的行為描述（資料跨工作階段保留、照片不離開瀏覽器、
離線時退回 CSV），未將技術名稱寫入需求。

### 待實作階段釐清（非規格問題）

- 專案內部檔案切分方式：企劃書稱「純前端單一檔案」，但同時規劃九大後台模組。
  單檔 SPA 或多檔切分屬架構決策，已於憲章「入口與結構」條授權由 `plan.md` 定案。

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
