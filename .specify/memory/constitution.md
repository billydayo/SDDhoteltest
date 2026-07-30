<!--
Sync Impact Report
- Version change: 2.0.0 → 2.1.0
- Bump rationale: MINOR。依《Sunny 訂房平台產品企劃書 v1.0》調整。主要為放寬原則 VI
  的絕對禁令（改為允許明確標示的模擬支付）並補充新功能所需的約束。放寬不會使既有
  合規做法變為不合規，故非 MAJOR。
- Modified principles:
  - VI. 不假裝有安全性 → VI. 誠實標示模擬範圍（No False Security, No False Payment）
    原條文「MUST NOT 引入任何金流或付款流程」改為：允許模擬付款流程，但禁止串接
    真實金流、禁止蒐集真實卡號，且必須明顯標示為虛擬支付。新增照片僅限瀏覽器內
    處理的規定。
  - IV. 訂房邏輯正確性 → 新增「訂房需提前一天」與「整理中房態同樣阻擋訂房」兩條規則。
  - II. 零建置的原生前端 → 新增 SheetJS 為預先核可的第三方函式庫例外。
- Modified sections:
  - 品質標準與技術約束 → 新增影像處理、報表匯出離線備援、視覺基調、單一入口檔規定
- Added principles: 無
- Removed sections: 無
- Resolved TODOs:
  - TODO(PROJECT_NAME) → 已解決：Sunny 訂房平台
- Deferred TODOs: 無
- 上游文件：《Sunny 訂房平台產品企劃書》v1.0（2026-07）
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
- MUST NOT 需要後端伺服器或資料庫。所有狀態存放於瀏覽器 `localStorage`。
- 第三方函式庫 MUST 以 `<script>` / `<link>` 直接引入。預先核可的例外僅有
  **SheetJS (xlsx)**，用途限於報表匯出。引入任何其他函式庫 MUST 在 `plan.md` 說明
  為何自行實作不划算。預設立場是不引入。
- JavaScript MUST 以 ES modules 組織，或有明確定義的檔案載入順序；
  MUST NOT 依賴隱含的全域變數污染。
- MUST 選擇能滿足當前已知需求的最簡方案。禁止為「未來可能需要」而預先建置（YAGNI）。

**理由**：零建置是本專案刻意選擇的約束，它讓任何人不裝任何工具就能開啟、閱讀與修改，
也是企劃書所定位的「便於教學展示與快速原型驗證」的前提。引入框架或打包步驟會一次性
摧毀這個特性，因此列為不可協商。

### III. 資料集中且可抽換（Data as a Swappable Layer）

本專案以 `localStorage` 作為資料層，但 MUST 以「日後可換成真實後端 API」的方式組織它。

- 所有資料集合（`users`、`rooms`、`orders`、`reviews`、`refunds`、`siteContent`）
  MUST 集中管理，MUST NOT 散落於 HTML 或各功能的 JS 中。
- 畫面 MUST 透過一層資料存取函式（例如 `getRooms()`、`createOrder()`）取用資料，
  MUST NOT 直接讀寫 `localStorage` 或直接把資料寫死在 DOM 裡。
- 每個資料實體 MUST 有明確的欄位定義與型別註記（可用註解或 JSDoc）。
- 資料存取函式的介面 MUST 設計成可改為非同步而不影響呼叫端。
- 系統 MUST 提供將所有資料集合還原為初始種子資料的入口。
- 初次載入且 `localStorage` 為空時，系統 MUST 自動寫入種子資料，MUST NOT 呈現空站。

**理由**：`localStorage` 是原型階段的暫時選擇，資料存取層是永久的。企劃書已將「串接
後端資料庫」列為明確待辦；把兩者分開，未來只需替換一層檔案，混在一起則等同全部重寫。

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
- 房態為「整理中」的房源 MUST 同樣被排除於可訂清單之外，與「已預訂」等同處理。
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

本平台的登入、付款與退款皆為展示用模擬。MUST 明確標示，MUST NOT 讓任何使用者或後續
開發者誤認為真實機制。

- **登入**：MUST NOT 要求使用者輸入自己的真實密碼。示範帳號的帳密
  （`guest@sunny.com` / `guest123`、`admin@sunny.com` / `admin123`）MUST 公開標示
  於登入畫面。密碼 MUST NOT 被宣稱為加密儲存。
- **付款**：MAY 實作模擬的付款流程與付款方式選項（LINE Pay、信用卡、銀行轉帳）。
  但 MUST NOT 串接任何真實金流服務；MUST NOT 要求或儲存真實信用卡號、有效期限、
  CVV 或銀行帳號。付款畫面 MUST 明顯標示「虛擬支付，不會產生任何實際交易」。
- **退款**：退款審核 MUST NOT 產生任何實際金錢移轉，僅變更訂單與退款申請的狀態。
- **個資**：MUST NOT 要求或儲存真實身分證字號、真實金融資訊。示範資料中的姓名與
  聯絡方式 MUST 為虛構。
- **權限**：角色與後台權限檢查 MUST NOT 被描述為安全機制；它只改變畫面呈現。
- **照片**：使用者上傳的照片 MUST 僅於瀏覽器內處理，MUST NOT 被傳送至任何外部服務。
- 所有模擬性質的模組 MUST 在檔案開頭以註解標示其為模擬，並說明真實系統應如何處理。

**理由**：前端的「登入」與「付款」在技術上不提供任何保護。若不明確標示，使用者可能
填入真實密碼或真實卡號，或後續開發者誤以為已有金流驗證。誠實標示成本為零，誤解成本
極高。企劃書亦已將此列為明確風險。

## 品質標準與技術約束

- **瀏覽器支援**：最新版的 Chrome、Edge、Firefox、Safari。MUST NOT 為舊版 IE 妥協。
- **主控台**：正常操作流程下，瀏覽器 console MUST 零錯誤、零警告。
- **HTML 有效性**：頁面 MUST 通過 W3C validator（或等效檢查）且無錯誤。
- **樣式**：MUST NOT 使用 inline `style` 屬性與 inline `onclick`，除非規格明確要求。
  事件 MUST 以 `addEventListener` 綁定。
- **視覺基調**：米色系配色、圓體大標、橫向房源卡片。基調 MUST 全站一致；
  配色值與字級 MUST 集中於單一樣式來源（CSS 自訂屬性或單一變數區塊），
  MUST NOT 於各頁重複硬編碼。
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
  MUST 能立即開啟執行。

**關於自動化測試**：本專案不強制建立自動化測試框架——那會違反原則 II 的零建置約束。
品質改以「開發流程」中的手動驗收清單把關。若日後引入測試，該測試 MUST 能在無建置
步驟的情況下於瀏覽器直接執行。

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

**Version**: 2.1.0 | **Ratified**: 2026-07-30 | **Last Amended**: 2026-07-30
