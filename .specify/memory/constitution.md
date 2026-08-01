<!--
Sync Impact Report
- Version change: 2.5.0 → 2.6.0
- Bump rationale: MINOR。解除自動化測試的禁令。原條文以「零建置」為由排除了
  所有測試框架，屬於過度延伸——原則 II 約束的是應用程式如何送到瀏覽器，
  而測試工具不在該路徑上。此為放寬，不使任何既有規則失效。
- Modified sections:
  - 品質標準與技術約束 →「關於自動化測試」條：改為兩層。單元測試 MUST 於
    瀏覽器直接執行、零依賴；端對端測試 MAY 使用 Node 與無頭瀏覽器，但依賴
    MUST 侷限於 tests/ 之下，且刪掉 tests/ 後應用須完整可用。
    自動化測試 MUST NOT 取代手動驗收清單。
- 依據：使用者於 2026-08-01 指示修訂。實務背景：本專案已累積數十條需在兩種
  模式下反覆驗證的規則，純人工重跑的成本高到不會有人做，等同沒有回歸測試。

Sync Impact Report（前一版）
- Version change: 2.4.0 → 2.5.0
- Bump rationale: MINOR。放寬示範模式的網路請求限制、改變卡片形狀語彙、
  改採參考站的原始配色。三者皆為放寬或風格調整，不使既有的資料層、
  安全或訂房規則失效。
- Modified principles:
  - II. 零建置的原生前端 → 移除「示範模式 MUST NOT 發出任何網路請求」。
    改為區分兩件事：**資料**仍 MUST NOT 離開瀏覽器（這是示範模式的本質），
    但靜態資源（webfont、CDN 函式庫）MAY 於需要時載入。
- Modified sections:
  - 品質標準與技術約束 →「視覺基調」條：橫向房源卡片改為**直向拱形卡片**；
    解除 webfont 禁令，允許 Playfair Display 作為拉丁字標題字型。
  - 合規審查 → 新增「已知不合規項目」清單，記錄兩處低於 WCAG AA 的配色。
- 依據：使用者於 2026-07-31 指示「憲章取消零網路請求、改成直向拱形卡片、
  顏色依照參考站」。
- ⚠️ 本次修訂使原則 V 的對比度要求出現兩處已知違反，已依「合規審查」條
  明確記錄而非靜默留存。修復方式僅需調整兩個色值，見該節。

Sync Impact Report（前一版）
- Version change: 2.3.0 → 2.4.0
- Bump rationale: MINOR。視覺基調由「圓體大標」改為「襯線大標」，並明確化
  配色與對比度的要求。此為擴充既有指引與調整風格宣告，不使既有的資料層、
  安全或訂房規則失效，故非 MAJOR。
- Modified sections:
  - 品質標準與技術約束 →「視覺基調」條改寫：明訂暖象牙／深林綠／黃銅三色、
    襯線大標、標題字重 400、禁止 webfont；新增「對比度稽核」條要求所有承載
    文字的顏色都必須在 base.css 標註對比度。
- 依據：使用者於 2026-07-31 指定參考 sunny-booking-prototype2 的視覺設計。
  企劃書「視覺設計」欄原寫「圓體大標」，此次以使用者的明確指示為準；
  「米色系配色」與「橫向房源列表」兩項維持不變。
- Modified principles: 無
- Added principles: 無
- Removed sections: 無

Sync Impact Report（前一版）
- Version change: 2.2.0 → 2.3.0
- Bump rationale: MINOR。依《Sunny 訂房平台產品企劃書》修訂版納入新模組。
  主要為放寬原則 VI 的照片禁令（區分兩種照片來源）並新增「模擬外部整合」條款。
  既有合規做法（照片全程留在瀏覽器）依然合規，故為 MINOR。
- Modified principles:
  - VI. 誠實標示模擬範圍 → 照片規定改為區分來源：前台使用者自行上傳的「安全檢測」
    照片 MUST NOT 離開瀏覽器（不變）；管理員對自家房源所做的品質檢測，其結果與
    圖片 MAY 存入雲端並公開於房源詳情頁。新增「模擬外部整合」規定：渠道比價與
    AI 審核皆為模擬／規則式實作，MUST 明確標示，MUST NOT 宣稱為真實服務。
  - II. 零建置的原生前端 → 明確禁止爬蟲、排程作業與 Edge Function；外部平台價格
    MUST 以種子資料模擬。
  - IV. 訂房邏輯正確性 → 新增「待付款訂單同樣佔用房況，且逾期後 MUST 釋出」規則。
- Modified sections:
  - 品質標準與技術約束 → Supabase 約束新增稽核日誌與系統參數的處理規定
- Added principles: 無
- Removed sections: 無
- 上游文件：《Sunny 訂房平台產品企劃書》v1.0（2026-07，含 supabase／渠道控價／
  操作日誌／系統參數修訂）

Sync Impact Report（前一版）
- Version change: 2.1.0 → 2.2.0
- Bump rationale: MINOR。採用 Supabase 作為預設資料層與認證機制。原則 II 的
  「MUST NOT 需要後端伺服器或資料庫」被放寬為「MUST NOT 依賴後端才能運行」——
  未設定憑證時仍須以 localStorage 完整運作，因此既有的純本機實作依然合規，
  屬放寬而非重新定義，故為 MINOR 而非 MAJOR。
- Modified principles:
  - II. 零建置的原生前端 → 放寬後端禁令：允許 Supabase（託管 Postgres + Auth）
    作為遠端資料層，但 MUST 以 ESM CDN 引入、MUST NOT 引入建置步驟，且
    MUST 保留無憑證時的完整 localStorage 示範模式。新增 `@supabase/supabase-js`
    為預先核可的第三方函式庫例外。
  - III. 資料集中且可抽換 → 由「日後可換成後端」升級為「現在就有兩套 adapter」：
    資料存取函式 MUST 為非同步，MUST 透過 repository facade 依憑證有無切換
    Supabase 與 localStorage，且兩者 MUST 通過同一套驗收案例。
  - VI. 誠實標示模擬範圍 → 區分兩種模式：Supabase 模式的登入為真實認證
    （密碼由 Supabase Auth 雜湊保管），示範模式的登入仍為模擬。付款與退款
    在任何模式下 MUST 維持模擬。新增「示範帳號密碼 MUST 為展示用途專屬」規定。
- Modified sections:
  - 品質標準與技術約束 → 新增 Supabase 約束（RLS 強制啟用、僅可使用 anon key、
    service_role key 禁止出現於前端或版控、憑證設定檔規範、離線與連線失敗行為）
- Added principles: 無
- Removed sections: 無
- Resolved TODOs:
  - TODO(PROJECT_NAME) → 已解決：Sunny 訂房平台
- Deferred TODOs: 無
- 上游文件：《Sunny 訂房平台產品企劃書》v1.0（2026-07）；2026-07-31 資料層決策：改用 Supabase
-->

# Sunny 訂房平台 Constitution

## Core Principles

### I. 規格先行（Spec-First）

任何功能在寫下第一行實作程式碼之前，MUST 先存在一份已核可的規格（`spec.md`）與實作計畫
（`plan.md`）。規格 MUST 描述「做什麼」與「為什麼」，MUST NOT 預先綁定實作細節。
規格中每一項需求 MUST 可被驗收：能寫出一句明確的通過／失敗判準。

規格與程式碼發生歧異時，以規格為準；若實作揭露規格有誤，MUST 先修訂規格再改程式碼。
產品企劃書為規格的上游輸入；企劃書與規格牴觸時 MUST 先更新規格，MUST NOT 讓實作
直接依循企劃書而繞過規格。

**理由**：本專案以 Spec Kit 流程驅動，規格是所有下游產物（tasks、實作、驗收）的唯一
事實來源。允許實作反向定義規格會使流程失效。

### II. 零建置的原生前端（Vanilla-First, No Build Step）

本專案 MUST 只使用 HTML、CSS 與原生 JavaScript。

- MUST NOT 引入前端框架（React、Vue、Angular 等）或打包工具（Webpack、Vite、
  Parcel 等）。
- MUST NOT 需要 `npm install`、編譯或任何前置建置步驟。專案 MUST 能以「直接開啟
  `index.html`」或任何靜態檔案伺服器的方式執行。
- MUST NOT 需要**自行撰寫或部署**的後端伺服器。本專案的遠端資料層 MUST 為
  **Supabase**（託管 Postgres + Auth + Storage），MUST 由瀏覽器直接呼叫，
  MUST NOT 在其上再架設一層自製 API 伺服器或 Node 服務。
- MUST NOT 依賴後端才能運行。未設定 Supabase 憑證時，應用程式 MUST 自動進入
  示範模式：資料存放於瀏覽器 `localStorage`、功能完整、且 **MUST NOT 連線至
  Supabase 或任何資料服務**。「直接開啟 `index.html` 就能用」是不可協商的特性。
- 示範模式 MAY 載入靜態資源（webfont、CDN 函式庫）。這與上一條的差別是刻意的：
  受管制的是**資料**離不離開瀏覽器，不是有沒有網路封包。靜態資源載入失敗時
  MUST 優雅退回（字型退回系統字、SheetJS 退回 CSV），MUST NOT 導致功能中斷。
- MUST NOT 引入 Supabase Edge Functions、Database Webhooks、排程作業（cron）
  或任何形式的爬蟲。需要伺服器端執行的功能 MUST 改以模擬資料呈現，或不做。
  唯一例外是資料庫內部的 trigger 與 function——它們屬於 schema 的一部分，
  隨 `supabase/schema.sql` 進版控，不構成獨立部署的服務。
- 第三方函式庫 MUST 以 `<script>` / `<link>` 或 ESM CDN（`import` 自
  `https://esm.sh/…`）直接引入。預先核可的例外僅有 **SheetJS (xlsx)**（用途限於
  報表匯出）與 **`@supabase/supabase-js` v2**（用途限於資料層與認證）。
  `@supabase/supabase-js` MUST 以動態 `import()` 延後載入，且 MUST 僅在憑證存在時
  載入，以確保示範模式零網路請求。引入任何其他函式庫 MUST 在 `plan.md` 說明
  為何自行實作不划算。預設立場是不引入。
- JavaScript MUST 以 ES modules 組織，或有明確定義的檔案載入順序；
  MUST NOT 依賴隱含的全域變數污染。
- MUST 選擇能滿足當前已知需求的最簡方案。禁止為「未來可能需要」而預先建置（YAGNI）。

**理由**：零建置是本專案刻意選擇的約束，它讓任何人不裝任何工具就能開啟、閱讀與修改，
也是企劃書所定位的「便於教學展示與快速原型驗證」的前提。引入框架或打包步驟會一次性
摧毀這個特性，因此列為不可協商。Supabase 之所以能被納入，正是因為它不需要建置步驟、
不需要自行部署伺服器，且可以在憑證缺席時完全退場。

### III. 雙軌資料層（Dual-Adapter Data Layer）

本專案有兩套資料後端：**Supabase**（有憑證時）與 **`localStorage`**（示範模式）。
兩者 MUST 藏在同一層資料存取介面之後，呼叫端 MUST NOT 知道目前用的是哪一套。

- 所有資料集合（`users`/`profiles`、`rooms`、`orders`、`reviews`、`refunds`、
  `siteContent`）MUST 集中管理，MUST NOT 散落於 HTML 或各功能的 JS 中。
- 畫面 MUST 透過一層資料存取函式（例如 `getRooms()`、`createOrder()`）取用資料，
  MUST NOT 直接呼叫 Supabase client，MUST NOT 直接讀寫 `localStorage`，
  MUST NOT 把資料寫死在 DOM 裡。
- 所有資料存取函式 MUST 為非同步（回傳 Promise）。即使示範模式可同步完成，
  介面 MUST 維持非同步，MUST NOT 讓呼叫端因模式不同而有兩種寫法。
- 兩個 adapter（`supabase` 與 `local`）MUST 實作**完全相同**的函式簽章，並由單一
  repository facade 依 `isSupabaseConfigured` 於啟動時擇一綁定。切換 MUST NOT
  需要修改任何頁面或元件程式碼。
- 每個資料實體 MUST 有明確的欄位定義與型別註記（可用註解或 JSDoc）。前端一律使用
  camelCase，資料庫一律使用 snake_case，兩者間的轉換 MUST 只發生在 Supabase
  adapter 內部。
- 系統 MUST 提供將資料還原為初始種子資料的入口（示範模式重建 `localStorage`；
  Supabase 模式對應可重複執行的 seed SQL）。
- 初次載入且 `localStorage` 為空時，示範模式 MUST 自動寫入種子資料，
  MUST NOT 呈現空站。
- 每一項驗收案例 MUST 在兩種模式下都通過。任一模式獨有的行為差異 MUST 在
  `plan.md` 明確列出並向使用者標示。

**理由**：企劃書已將「串接後端資料庫」列為明確待辦，本專案現在把它實現為 Supabase。
但示範模式是本專案的展示價值所在，不能因此消失。把兩套後端收斂到同一組非同步介面，
是唯一能同時保住「真實資料庫」與「打開就能跑」的方式；若讓 Supabase 呼叫散落各處，
示範模式會在三次改動內腐爛。

### IV. 訂房邏輯正確性（Booking Correctness）

訂房的日期與房況計算 MUST 遵守下列規則。這些是本專案最容易出錯且錯了最嚴重的地方。

- 入住日與退房日 MUST 以「日曆日」處理，格式 `YYYY-MM-DD` 字串；MUST NOT 使用含
  時間的 timestamp 做比較，MUST NOT 使用會受瀏覽器時區影響的 `Date` 轉換。
  時區固定視為 Asia/Taipei。
- 夜數 = 退房日 − 入住日。退房當日 MUST NOT 計為一晚。
- 入住日 MUST 至少為明日（訂房需提前一天）；今日與過去的日期 MUST 被拒絕。
- 退房日 MUST 晚於入住日至少一晚；相同或倒置的日期 MUST 被拒絕並顯示明確錯誤。
- 房況重疊判定 MUST 使用半開區間規則：既有訂單 `[a, b)` 與新訂單 `[c, d)` 重疊
  若且唯若 `a < d` 且 `c < b`。同一房源同一晚 MUST NOT 出現兩筆有效訂單。
- 「同一房源同一晚不得有兩筆有效訂單」在 Supabase 模式 MUST 由資料庫層以排除約束
  （`EXCLUDE USING gist`，半開區間 `[check_in, check_out)`）強制執行，
  MUST NOT 只依賴前端檢查。前端的重疊檢查是 UX，資料庫的約束才是保證。
- 房態為「整理中」的房源 MUST 同樣被排除於可訂清單之外，與「已預訂」等同處理。
- 待付款訂單 MUST 同樣佔用該房源該區間，與已確認訂單等同處理；保留時間到期後
  MUST 自動視為已取消並立即釋出該區間。過期判定 MUST 於每次查詢房況與建立訂單
  之前執行，MUST NOT 依賴外部排程，也 MUST NOT 讓過期訂單持續佔用房況。
- 金額 MUST 以整數（新臺幣元）運算，MUST NOT 以浮點數累加。顯示時才格式化。
- 訂單成立時的總金額 MUST 保存於訂單上；房源價格日後變動 MUST NOT 改變既有訂單金額。
- 每一項規則 MUST 有對應的手動驗收案例（含邊界：跨月、跨年、僅一晚、明日入住、
  退房日等於他人入住日）。

**理由**：即使資料存在瀏覽器，日期算錯一天、或讓同一晚被訂兩次，都會讓整個平台的核心
行為失去可信度。半開區間規則寫明於此，是為了避免每次實作各自發明一套。

### V. 無障礙與響應式基本線（Accessible & Responsive by Default）

- MUST 使用語意化標籤（`header`、`nav`、`main`、`section`、`button` 等）；
  MUST NOT 用 `div` + click 取代 `button` 或 `a`。
- 所有圖片 MUST 有 `alt`；純裝飾圖 MUST 使用 `alt=""`。
- 所有表單控制項 MUST 有關聯的 `<label>`。
- 所有互動元素 MUST 可用鍵盤操作，且 MUST 有可見的 focus 樣式。
- 文字與背景對比 MUST 達 WCAG AA（一般文字 4.5:1，大字 3:1）。米色系配色
  MUST NOT 成為對比不足的藉口。
- 版面 MUST 在 320px 寬度下正常顯示且不產生橫向捲動。橫向房源列表 MUST 在窄螢幕上
  改為可捲動或改為直向堆疊，MUST NOT 造成整頁橫向捲動。
- 介面文字 MUST 使用繁體中文（台灣用語）。日期顯示格式 MUST 全站一致。

**理由**：這些是基本線而非加分項，且全部都能在無建置環境下靠原生 HTML 做到。企劃書
已將「行動裝置 RWD 優化」列為待辦，本原則將其提前為交付條件而非後補項目。

### VI. 誠實標示模擬範圍（No False Security, No False Payment）

本平台的付款與退款在**任何模式下**皆為展示用模擬；登入則依模式而異。何者為真、
何者為假，MUST 明確標示，MUST NOT 讓任何使用者或後續開發者誤認。

- **登入（Supabase 模式）**：使用 Supabase Auth，密碼由 Supabase 雜湊保管，
  前端 MUST NOT 自行儲存、傳遞或比對密碼明文，資料表 MUST NOT 存在任何密碼欄位。
  此為真實認證，MAY 如此描述。即便如此，登入畫面 MUST 仍提醒「本站為展示用專案，
  請勿使用你在其他網站的真實密碼」。
- **登入（示範模式）**：為模擬登入，僅比對 `localStorage` 中的種子帳號，
  MUST 明確標示為模擬，密碼 MUST NOT 被宣稱為加密儲存。
- **示範帳號**：`guest@sunny.com` / `guest123`、`admin@sunny.com` / `admin123`
  MUST 公開標示於登入畫面。這組密碼 MUST 為本專案展示專用，
  MUST NOT 與任何人的真實密碼相同。
- **權限（Supabase 模式）**：後台權限 MUST 同時由前端路由檢查與資料庫 RLS 政策
  執行。前端檢查 MUST NOT 被描述為安全機制；RLS 才是實際的存取邊界。
- **權限（示範模式）**：僅有前端檢查，MUST NOT 被描述為安全機制；它只改變畫面呈現。
- **付款**：MAY 實作模擬的付款流程與付款方式選項（LINE Pay、信用卡、銀行轉帳）。
  但 MUST NOT 串接任何真實金流服務；MUST NOT 要求或儲存真實信用卡號、有效期限、
  CVV 或銀行帳號。付款畫面 MUST 明顯標示「虛擬支付，不會產生任何實際交易」。
  此規定 MUST NOT 因改用 Supabase 而放寬。
- **退款**：退款審核 MUST NOT 產生任何實際金錢移轉，僅變更訂單與退款申請的狀態。
- **個資**：MUST NOT 要求或儲存真實身分證字號、真實金融資訊。示範資料中的姓名與
  聯絡方式 MUST 為虛構。改用 Supabase 後資料離開了使用者本機，此條的重要性提高
  而非降低。
- **照片（前台使用者）**：使用者於「安全檢測」自行上傳的照片 MUST 僅於瀏覽器內以
  Canvas 處理，MUST NOT 被傳送至任何外部服務，MUST NOT 被寫入 Supabase Storage
  或任何資料表，MUST NOT 於分析後殘留。此條不可放寬——那是使用者的私人照片。
- **照片（管理員房源檢測）**：管理員對**自家房源**執行的品質檢測，其分析結果與
  受檢圖片 MAY 存入 Supabase Storage 並公開於房源詳情頁。此類圖片 MUST 為飯店
  自有的房間照片，MUST NOT 包含可辨識的人物，且上傳前 MUST 明確告知管理員該圖
  將公開顯示。兩種來源的程式路徑 MUST 分離，MUST NOT 共用同一個上傳函式。
- **模擬的外部整合**：本專案不連接任何第三方商業平台。以下模組 MUST 以種子資料
  模擬，並 MUST 於畫面上明確標示其為模擬，MUST NOT 宣稱為真實服務：
  - **渠道比價與控價**：外部平台（Agoda／Booking 等）的價格 MUST 來自種子資料。
    MUST NOT 實作爬蟲、MUST NOT 呼叫任何 OTA 的 API。爬取第三方平台可能違反其
    服務條款，這不是本專案要承擔的風險。
  - **AI 評論審核**：MUST 以瀏覽器內的規則式引擎實作，MUST 於介面與後台標示為
    「自動審核（規則式）」而非「AI 審核」。MUST NOT 呼叫任何 LLM 服務，
    MUST NOT 在前端放置任何 AI 服務金鑰。規則式審核的結果 MUST 可被管理員複核
    與覆寫，MUST NOT 成為不可申訴的最終判定。
- 所有模擬性質的模組 MUST 在檔案開頭以註解標示其為模擬，並說明真實系統應如何處理。

**理由**：改用 Supabase 後，登入從假的變成真的、權限從畫面控制變成資料庫政策，
但付款依然是假的。三者混在同一個介面裡而不加區分，比全部都假還危險——使用者會
以「登入是真的」推論「付款也是真的」。因此本原則改為逐項標明真偽，而不再一概稱為模擬。

## 品質標準與技術約束

- **瀏覽器支援**：最新版的 Chrome、Edge、Firefox、Safari。MUST NOT 為舊版 IE 妥協。
- **主控台**：正常操作流程下，瀏覽器 console MUST 零錯誤、零警告。
- **HTML 有效性**：頁面 MUST 通過 W3C validator（或等效檢查）且無錯誤。
- **樣式**：MUST NOT 使用 inline `style` 屬性與 inline `onclick`，除非規格明確要求。
  事件 MUST 以 `addEventListener` 綁定。
- **視覺基調**：暖象牙底色搭配深林綠主墨色與黃銅強調色、**襯線大標**、
  **直向拱形房源卡片**。標題字重 MUST 保持 400——精品調性靠字形與尺寸經營，
  加粗反而顯得廉價。拱形 MUST 以 `border-radius` 的雙值語法實作
  （水平半徑遠大於垂直半徑），否則會變成單純的圓角而非拱。
  基調 MUST 全站一致；配色值與字級 MUST 集中於 `styles/base.css` 的 CSS
  自訂屬性，MUST NOT 於各頁重複硬編碼。
- **字型**：MAY 引入拉丁字 webfont（目前為 Playfair Display）。
  CJK webfont MUST NOT 引入——字型檔動輒數 MB。字型載入失敗時 MUST 優雅退回
  系統襯線體，版面 MUST NOT 因此崩壞（`font-display: swap`）。
- **對比度稽核**：新增或調整任何承載文字的顏色時，MUST 於 `base.css` 的註解
  標註其與背景的對比度。米色與黃銅這類低飽和配色特別容易在不知不覺中掉到
  4.5:1 以下。已知不合規項目見「合規審查」節。
- **命名**：CSS class 使用 kebab-case，JavaScript 變數與函式使用 camelCase，
  常數使用 UPPER_SNAKE_CASE，`localStorage` 鍵名使用企劃書所定義的名稱。
- **編碼**：所有檔案 MUST 為 UTF-8，HTML MUST 宣告 `<meta charset="utf-8">`。
- **錯誤處理**：MUST NOT 靜默吞掉錯誤。失敗的操作 MUST 對使用者顯示可理解的訊息，
  MUST NOT 只留一片空白畫面。
- **入口與結構**：專案 MUST 有單一入口 `index.html`，直接開啟即可操作全站。內部的
  檔案切分方式（單檔或多檔、目錄配置）於 `plan.md` 定案；一旦定案，變更 MUST 走
  修訂程序。
- **影像處理**：照片分析 MUST 完全在瀏覽器內以 Canvas 完成。上傳的照片 MUST NOT 被
  送出瀏覽器，MUST NOT 被寫入 `localStorage` 的長期資料集合（避免容量耗盡）。
- **報表匯出**：匯出功能 MUST 在 SheetJS 無法載入或處於離線狀態時自動退回 CSV，
  MUST NOT 因此中斷或無回應，且 MUST 告知使用者已改用 CSV。
- **儲存容量**：寫入 `localStorage` 失敗（容量已滿）MUST 被攔截並向使用者說明，
  MUST NOT 導致資料靜默遺失。
- **資源**：圖片 SHOULD 經過壓縮；MUST NOT 提交單檔超過 1 MB 的圖片。
- **可重現性**：專案 MUST 不依賴任何本機環境設定。在另一台電腦上取得檔案後
  MUST 能立即開啟執行（未帶憑證時以示範模式執行）。

### Supabase 約束

- **RLS**：所有 `public` schema 下的資料表 MUST 啟用 Row Level Security，且
  MUST 具備明確的政策。「先開放再收斂」是禁止的——沒有政策的資料表視為未完成。
- **金鑰**：前端 MUST 僅使用 **anon（publishable）key**。`service_role` key
  MUST NOT 出現於任何前端程式碼、設定檔或版本控制中，一次都不行。若曾誤植，
  MUST 立即於 Supabase Dashboard 輪替該金鑰。
- **金鑰的性質**：anon key 是設計上可公開的識別碼，其安全性由 RLS 提供而非由保密
  提供。因此它 MAY 存在於前端設定檔中；但這 MUST NOT 被當成「RLS 可以晚點再做」
  的理由。
- **憑證設定**：憑證 MUST 由單一設定檔（`src/config.js`，於 `index.html` 前置載入
  並設定 `window.__SUNNY_CONFIG__`）提供。因為沒有建置步驟，前端 MUST NOT 嘗試
  讀取 `.env`、`process.env` 或 `import.meta.env`——這些在直接開啟的瀏覽器中一律
  不存在，寫了等同於死碼。設定檔 MUST 隨專案提供且預設為空字串（即示範模式），
  MUST NOT 因缺檔而產生 404 或主控台錯誤。
- **Schema 變更**：資料庫結構 MUST 完整記錄於版控中的 `supabase/schema.sql`，
  且 MUST 可重複執行（idempotent）。MUST NOT 只在 Dashboard 手動改動而不回寫。
- **連線失敗**：Supabase 已設定但呼叫失敗（離線、逾時、RLS 拒絕）時，系統 MUST
  向使用者顯示可理解的訊息並保留其已填內容，MUST NOT 靜默失敗，
  MUST NOT 自動改用 `localStorage` 假裝成功——那會造成使用者以為資料已存下。
- **模式標示**：目前處於示範模式時，介面 MUST 有持續可見的標示，讓使用者知道
  資料只存在本機瀏覽器。
- **稽核日誌**：管理員的後台變更操作 MUST 被記錄。日誌 MUST 為僅可新增
  （append-only）：任何角色皆 MUST NOT 能更新或刪除既有紀錄，包含管理員本人。
  日誌 MUST NOT 記錄密碼、金鑰或任何真實個資。
- **系統參數**：可調整的營運參數（如未付款訂單保留時間）MUST 集中存於單一設定
  來源並由管理員維護，MUST NOT 硬編碼散落於程式碼中。參數 MUST 有合理範圍檢查，
  且變更 MUST 進入稽核日誌。
- **Storage**：若使用 Supabase Storage，其 bucket MUST 有明確的存取政策：
  僅管理員可寫入，公開讀取僅限已明示會公開的內容。MUST NOT 建立可任意寫入的
  public bucket。目前有兩個：`room-risk`（房源品質檢測圖）與
  `room-photos`（房源展示照片），兩者皆為公開讀取、僅管理員可寫入。
- **上傳**：任何檔案上傳 MUST 先在瀏覽器內壓縮再送出，MUST NOT 上傳原始檔。
  上傳後若因使用者取消而未被任何資料列引用，該檔案 MUST 被清除；
  反之，移除既有檔案 MUST 於變更真正保存後才實際刪檔——否則使用者按下取消，
  檔案卻已消失。

**關於自動化測試**（2026-08-01 修訂，見版本 2.6.0）：

本專案 MAY 建立自動化測試，分兩層，各有不同的約束：

- **單元測試** MUST 能在無建置步驟的情況下於瀏覽器直接執行（開啟 `tests/index.html`
  即可），MUST NOT 引入任何執行期依賴。這一層測資料層、驗證規則與純函式。
- **端對端測試** MAY 使用 Node 與無頭瀏覽器（目前為 `puppeteer-core`，
  驅動系統既有的 Chrome）。此類依賴 MUST 僅存在於 `tests/` 之下，
  MUST NOT 被應用程式的任何模組 import，且 MUST NOT 成為部署或執行的前置條件——
  刪掉整個 `tests/` 目錄，應用仍須完整可用。

**原則 II 的零建置約束針對的是「應用程式如何被送到瀏覽器」，不是開發工具。**
測試工具不參與 index.html 的載入路徑，因此不構成建置步驟。此界定是必要的：
先前的條文把兩者混為一談，導致唯一可行的測試方式是人工逐項點選，
而本專案已累積數十條需要在兩種模式下反覆驗證的規則，人工重跑的成本高到
實務上不會有人做，等於沒有回歸測試。

自動化測試 MUST NOT 取代 `checklists/browser-acceptance.md`：版面、對比、
照片是否好看這類需要人眼判斷的項目，仍以手動驗收把關。

## 開發流程

1. **規格** — 以 `/speckit-specify` 建立或更新 `spec.md`；不明確處以 `/speckit-clarify`
   澄清。
2. **計畫** — 以 `/speckit-plan` 產出 `plan.md`。計畫 MUST 明確聲明其如何符合本憲章；
   任何偏離 MUST 在計畫中列出理由。
3. **任務** — 以 `/speckit-tasks` 產出依相依順序排列的 `tasks.md`。
4. **驗收清單** — 每項功能 MUST 有手動驗收清單（可用 `/speckit-checklist` 產生），
   且 MUST 在實作前就寫好。清單 MUST 涵蓋 happy path 與錯誤／邊界情境。
5. **一致性檢查** — 實作前 SHOULD 執行 `/speckit-analyze` 檢查規格／計畫／任務的一致性。
6. **實作** — 以 `/speckit-implement` 執行。
7. **驗收** — 功能 MUST 在瀏覽器中實際操作、逐項通過驗收清單後才算完成。
   MUST NOT 僅憑程式碼看起來正確就標記為完成。
8. **審查** — 變更 MUST 經過審查，確認：驗收清單已通過、console 無錯誤、憲章合規。

任何階段發現前一階段的產物有誤時，MUST 回到該階段修正，MUST NOT 在下游用臨時手段補救。

## Governance

**權威性**：本憲章優先於其他所有開發慣例與偏好。當工具預設值、範本、產品企劃書或既有
程式碼與本憲章牴觸時，以本憲章為準；若牴觸源自企劃書的產品決策，MUST 先修訂本憲章
再實作，MUST NOT 直接違反。

**修訂程序**：
1. 修訂提案 MUST 以書面形式說明變更內容、理由與影響範圍。
2. 修訂 MUST 經專案維護者核可後方可生效。
3. 若修訂會使既有程式碼不合規，提案 MUST 附帶遷移計畫或明確的過渡期。
4. 修訂通過後 MUST 更新本檔案的版本號與 Last Amended 日期，並更新頂端的 Sync Impact
   Report。

**版本政策**（適用於本憲章本身，遵循語意化版本）：
- **MAJOR** — 移除或重新定義原則，導致既有合規做法變為不合規。
- **MINOR** — 新增原則或章節、放寬既有限制，或大幅擴充既有指引。
- **PATCH** — 釐清措辭、修正錯字、非語意性調整。

**合規審查**：
- 每次審查 MUST 驗證變更是否符合本憲章。
- 複雜度 MUST 被證成；無法說明理由的複雜度 MUST 被簡化。
- 已知的不合規項目 MUST 被明確記錄並排入修復，MUST NOT 靜默留存。
- 執行期的開發指引以各功能目錄下的 `plan.md` 為準；本憲章僅規範不可協商的邊界。

**已知不合規項目**（2026-07-31 起）：

依使用者指示採用參考站的原始配色後，有一處**實際**低於原則 V 要求的 4.5:1：

| 位置 | 組合 | 實測對比 | 狀態 |
|---|---|---|---|
| 白字於 `--c-brand` `#96793F` 上 | `.btn--primary` 按鈕文字 | **4.1:1** | ⚠️ 實際使用中，未達 AA |
| `--c-text-faint` `#7C8883` 於 `--c-bg` 上 | — | 3.4:1 | 已定義但**目前無任何規則使用**，無實際影響 |

按鈕文字是唯一真正的違反。這是刻意保留的風格決定，非疏漏。
**修復方式為改動一行**：`styles/base.css` 的 `--c-brand` 改為 `#7A6132`
（即參考站的 `--brass-deep`，白字對比 5.9:1）。視覺差異極小，
不影響任何其他設計決定。

`--c-text-faint` 若日後要投入使用，MUST 先改為 `#63706B`（4.8:1）。

在修復之前，`.btn--primary` MUST NOT 被描述為符合 WCAG AA。

**Version**: 2.5.0 | **Ratified**: 2026-07-30 | **Last Amended**: 2026-07-31
