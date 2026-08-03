<!--
Sync Impact Report
- Version change: 3.1.0 → 3.1.1
- Bump rationale: PATCH。修正 v3.0.0／v3.1.0 對既有 schema 的一項事實誤述，
  並據此確定 RLS 的處置。不新增、移除或重新定義任何原則，故為 PATCH。
- Corrected:
  - 遷移計畫表原稱 `supabase/schema.sql`「內容 MUST 完整保留」。查核後為誤：
    該檔有 36 處參照 Supabase 的 `auth` schema——`profiles.id` 外鍵指向
    `auth.users`、`on_auth_user_created` 觸發器掛在 `auth.users` 上、
    38 條 RLS 政策中 30 條呼叫 `auth.uid()`、42 處呼叫 `is_admin()`。
    這些隨 Supabase Auth 一併消失，無法原樣保留。該列已拆為四列，
    逐層標明何者原樣保留、何者必須改寫。
  - 資料庫約束的 RLS 條原寫「MAY 保留為縱深防禦」，同屬未查核下的誤判。
    改為 MUST 全數移除，並新增一條要求保留「不依賴身分的資料庫保證」
    （gist 排除約束、CHECK 約束、`admin_logs` 僅可新增），後者改以資料表權限
    （`REVOKE UPDATE, DELETE`）實作。
- 依據：使用者於 2026-08-03 於 `/speckit-plan` 階段確認「完全移除 RLS」。
  查核證據見該次對話與 `specs/001-booking-site/research.md`。

Sync Impact Report（前一版）
- Version change: 3.0.0 → 3.1.0
- Bump rationale: MINOR。解決 v3.0.0 遺留的兩個 TODO，並新增 ORM 與遷移機制的
  規定。原憲章未指定資料存取方式（僅要求「MUST 使用非同步驅動」），亦未指定
  套件管理器與遷移工具；本次將三者定為強制，屬新增規範性內容而非釐清措辭，
  故為 MINOR 而非 PATCH。不使任何既有合規做法失效。
- Resolved TODOs:
  - TODO(FRONTEND_PACKAGE_MANAGER) → 已解決：**npm**。理由：`tests/package-lock.json`
    已是 npm lockfile，改用 pnpm 會在同一 repo 產生兩種套件管理器。
  - TODO(MIGRATION_TOOL) → 已解決：**Alembic**。
- Modified sections:
  - 前端約束 → 套件管理定為 npm，`package-lock.json` MUST 進版控；
    新增禁止 import 未宣告的間接相依。
  - 後端約束 → 新增「ORM 與資料存取」條：MUST 使用 SQLAlchemy 2.0 宣告式 ORM
    搭配 asyncpg；明訂 PostgreSQL 特有結構無法由模型表達，MUST 由遷移腳本
    以原生 SQL 維護。
  - 資料庫約束 → 遷移機制定為 Alembic；新增 autogenerate 的強制人工審閱規定
    （RLS 政策、trigger、函式與 EXCLUDE USING gist 皆偵測不到，盲目套用可能
    產生刪除敘述）；新增「事實來源」條禁止平行維護全量 schema SQL。
  - Governance → v3.0.0 遷移計畫表：`schema.sql` 由「原樣保留」細化為「內容折進
    Alembic 初始 revision」；新增 `migrations.sql` 一列。
- 依據：使用者於 2026-08-03 指定 npm 與 SQLAlchemy ORM。Alembic 為 SQLAlchemy 的
  既定搭配，依前次討論所述理由採用——採用的是其版本追蹤能力，而非 autogenerate。

Sync Impact Report（前一版）
- Version change: 2.6.0 → 3.0.0
- Bump rationale: MAJOR。技術堆疊全面更換，既有的合規做法大規模轉為不合規。
  三項決策同時生效：(1) 後端改為自行撰寫並部署的 Python FastAPI，以 uv 管理套件；
  (2) 前端改為 React + Tailwind，引入建置步驟；(3) 移除示範模式。
  原則 II 被完全取代而非放寬，原則 III 的雙軌 adapter 被移除，故為 MAJOR。
- Modified principles:
  - II. 零建置的原生前端 → **II. 前後端分離的分層架構**（完全取代）。
    移除框架禁令、打包工具禁令、`npm install` 禁令、自建後端禁令、
    「直接開啟 index.html」不可協商條款。改為明確要求 React + Tailwind + Vite
    前端與 FastAPI + uv 後端，兩者以 HTTP JSON API 為唯一介面。
  - III. 雙軌資料層 → **III. 資料存取的單一路徑**（完全取代）。
    移除雙 adapter、`isSupabaseConfigured` 切換、「每項驗收需在兩種模式下通過」。
    改為：瀏覽器 MUST NOT 直接連線資料庫，所有存取 MUST 經 FastAPI。
  - IV. 訂房邏輯正確性 → 判定責任由「前端檢查 + 資料庫約束」改為
    「後端權威判定 + 資料庫約束」；前端檢查降級為純 UX 提示。
    半開區間規則、日曆日規則、整數金額規則全部原文保留。
  - V. 無障礙與響應式基本線 → 條文不變，但落實方式改綁 Tailwind：
    語意化標籤要求改為對 JSX 生效，禁止以 `div + onClick` 取代 `button`。
  - VI. 誠實標示模擬範圍 → 實質改寫。Supabase Auth 消失後，密碼雜湊改為本專案
    自身的責任，新增 argon2id/bcrypt、JWT 秘鑰、禁止明文與禁止入日誌等規定。
    移除全部示範模式條款。**前台使用者上傳照片不得離開瀏覽器**一條保留且強化。
- Added sections:
  - 品質標準與技術約束 → 新增「後端約束（FastAPI + uv）」
  - 品質標準與技術約束 → 新增「前端約束（React + Tailwind + Vite）」
  - Governance → 新增「v3.0.0 遷移計畫」（依修訂程序第 3 條要求）
- Removed sections:
  - 品質標準與技術約束 → 移除整節「Supabase 約束」，由「資料庫約束」取代。
    RLS 不再是安全邊界，anon key／service_role key 相關條文全部失效。
  - 「入口與結構：單一入口 index.html」條
  - 「可重現性：不依賴任何本機環境設定」條（已與需要執行環境的架構矛盾）
- Deferred TODOs:
  - TODO(FRONTEND_PACKAGE_MANAGER)：npm／pnpm 未指定，須於 plan.md 定案。
  - TODO(MIGRATION_TOOL)：schema 遷移工具（Alembic 或延續手寫 idempotent SQL）
    未指定，須於 plan.md 定案。
- Corrected: 前一版（2.6.0）只更新了 Sync Impact Report，底部 Version 行仍停在
  2.5.0。本次一併修正，以 2.6.0 為變更基準。
- 依據：使用者於 2026-08-03 指示「後端改使用 python FastAPI UV 管理套件」，
  並於同日確認前端改用 React + Tailwind、移除示範模式、FastAPI 獨佔資料庫存取。
- ⚠️ 本次修訂使既有的 16,398 行原生 JS/CSS/HTML 前端與 `src/` 下全部資料層
  程式碼轉為不合規。已依「合規審查」條記錄於 Governance 的遷移計畫，非靜默留存。

Sync Impact Report（前一版）
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
  改採參考站的原始配色。
- Modified principles:
  - II. 零建置的原生前端 → 移除「示範模式 MUST NOT 發出任何網路請求」。
- Modified sections:
  - 品質標準與技術約束 →「視覺基調」條：改為直向拱形卡片；允許
    Playfair Display 作為拉丁字標題字型。
  - 合規審查 → 新增「已知不合規項目」清單。
- 依據：使用者於 2026-07-31 指示。

Sync Impact Report（前一版）
- Version change: 2.3.0 → 2.4.0
- Bump rationale: MINOR。視覺基調由「圓體大標」改為「襯線大標」，並明確化
  配色與對比度的要求。
- 依據：使用者於 2026-07-31 指定參考 sunny-booking-prototype2 的視覺設計。

Sync Impact Report（前一版）
- Version change: 2.2.0 → 2.3.0
- Bump rationale: MINOR。依《Sunny 訂房平台產品企劃書》修訂版納入新模組。
  放寬原則 VI 的照片禁令並新增「模擬外部整合」條款。
- 上游文件：《Sunny 訂房平台產品企劃書》v1.0（2026-07）

Sync Impact Report（前一版）
- Version change: 2.1.0 → 2.2.0
- Bump rationale: MINOR。採用 Supabase 作為預設資料層與認證機制。
- Resolved TODOs: TODO(PROJECT_NAME) → 已解決：Sunny 訂房平台
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

### II. 前後端分離的分層架構（Layered, API-First）

本專案由兩個各自獨立建置與部署的層構成，兩層之間 MUST 只以 HTTP JSON API 溝通。

- **前端** MUST 為 React 單頁應用，樣式 MUST 以 Tailwind CSS 撰寫，建置工具 MUST 為
  Vite。前端 MUST NOT 包含任何資料庫憑證、後端秘鑰或伺服器端邏輯。
- **後端** MUST 為 Python 的 FastAPI 應用。Python 套件管理 MUST 使用 **uv**；
  MUST NOT 使用 pip、Poetry、Conda 或 requirements.txt 作為主要相依宣告。
- 兩層之間的介面 MUST 為 HTTP + JSON，且 MUST 完整描述於 FastAPI 自動產生的
  OpenAPI 文件中。前端 MUST NOT 依賴任何未出現於 OpenAPI 的隱含行為。
- 前端 MUST NOT 直接連線資料庫、物件儲存或任何第三方資料服務。所有此類存取
  MUST 經由後端。此為安全邊界，MUST NOT 因開發便利而暫時繞過。
- 後端 MUST NOT 產生 HTML 畫面。伺服器端渲染、Jinja 樣板與 HTMX 皆不在本專案範圍內；
  後端只回傳 JSON。
- 兩層 MUST 能各自獨立啟動與測試。前端 MUST 能在後端未啟動時完成建置
  （執行期會因 API 不可用而顯示錯誤，這是預期行為，見原則 III）。
- MUST 選擇能滿足當前已知需求的最簡方案。禁止為「未來可能需要」而預先建置（YAGNI）。
  引入任何新的執行期相依 MUST 在 `plan.md` 說明為何自行實作不划算。預設立場是不引入。

**理由**：本專案原先以「零建置」為核心約束，換取「打開 `index.html` 就能用」。
在需要真實認證、伺服器端授權與可控的資料存取之後，該約束的成本已高於收益——
安全邊界無法只靠瀏覽器內的程式碼建立。改為分層架構是刻意的取捨：放棄零安裝的展示
便利，換取一條真正可稽核的存取路徑。既然建置步驟已無可避免，前端亦一併改用
React + Tailwind，以免同時承擔建置成本卻不取得其好處。

### III. 資料存取的單一路徑（Single Path to Data）

資料庫 MUST 只有一個存取者：FastAPI 後端。這條路徑沒有替代方案，也沒有降級模式。

- 所有資料集合（`profiles`、`rooms`、`orders`、`reviews`、`refunds`、`favorites`、
  `site_content`、`room_risk_checks`、`channel_prices`、`admin_logs`、`messages`、
  `system_settings`）MUST 只由後端讀寫。
- 後端 MUST 將資料存取集中於明確的資料層（repository 或 service 模組），
  MUST NOT 讓 SQL 或 ORM 查詢散落於路由處理函式中。
- 前端 MUST 透過單一 API client 模組呼叫後端，MUST NOT 於元件內直接使用 `fetch`
  拼接網址。API 端點路徑 MUST NOT 散落於各元件。
- 每個資料實體 MUST 有 Pydantic 模型定義其進出 API 的形狀。前端 TypeScript 型別
  MUST 與之對應。資料庫一律使用 snake_case；API 的 JSON 欄位命名 MUST 全站一致，
  且該慣例 MUST 於 `plan.md` 明訂一次，MUST NOT 逐端點各自決定。
- 系統 MUST 提供可重複執行的種子資料腳本，能將資料庫還原為初始展示狀態。
- API 不可用（後端未啟動、網路失敗、逾時）時，前端 MUST 顯示可理解的錯誤並保留
  使用者已填內容，MUST NOT 靜默失敗，MUST NOT 退回任何本機假資料假裝成功。
  **MUST NOT 存在 localStorage 示範模式**——它已於 v3.0.0 移除，重新引入等同於
  重建一條無人維護的第二實作。
- `localStorage` MAY 僅用於保存 UI 偏好與認證 token，MUST NOT 用於保存業務資料。

**理由**：舊版的雙軌 adapter 是為了在沒有後端時仍能展示。有了後端之後，維持兩套
實作意味著每一條業務規則都要寫兩次、驗收兩次，而第二套永遠不會被真正使用。
移除它是為了讓「資料庫裡的狀態」成為唯一的事實，而不是兩個可能不一致的來源。

### IV. 訂房邏輯正確性（Booking Correctness）

訂房的日期與房況計算 MUST 遵守下列規則。這些是本專案最容易出錯且錯了最嚴重的地方。

- 入住日與退房日 MUST 以「日曆日」處理，格式 `YYYY-MM-DD` 字串；MUST NOT 使用含
  時間的 timestamp 做比較，MUST NOT 使用會受用戶端時區影響的日期轉換。
  時區固定視為 Asia/Taipei，且 MUST 於後端明確指定，MUST NOT 依賴伺服器的本機時區設定。
- 夜數 = 退房日 − 入住日。退房當日 MUST NOT 計為一晚。
- 入住日 MUST 至少為明日（訂房需提前一天）；今日與過去的日期 MUST 被拒絕。
- 退房日 MUST 晚於入住日至少一晚；相同或倒置的日期 MUST 被拒絕並顯示明確錯誤。
- 房況重疊判定 MUST 使用半開區間規則：既有訂單 `[a, b)` 與新訂單 `[c, d)` 重疊
  若且唯若 `a < d` 且 `c < b`。同一房源同一晚 MUST NOT 出現兩筆有效訂單。
- 「同一房源同一晚不得有兩筆有效訂單」MUST 由資料庫層以排除約束
  （`EXCLUDE USING gist`，半開區間 `[check_in, check_out)`）強制執行。
  **後端的檢查是授權與訊息品質，資料庫的約束才是保證。** 後端 MUST 攔截該約束
  觸發時拋出的錯誤並轉為可理解的訊息，MUST NOT 讓它變成 500。
- 前端的日期與房況檢查 MUST 被視為純 UX 提示。所有判定 MUST 於後端重新執行；
  後端 MUST NOT 信任任何來自用戶端的可用性結論、價格或總金額。
- 房態為「整理中」的房源 MUST 同樣被排除於可訂清單之外，與「已預訂」等同處理。
- 待付款訂單 MUST 同樣佔用該房源該區間，與已確認訂單等同處理；保留時間到期後
  MUST 自動視為已取消並立即釋出該區間。過期判定 MUST 於每次查詢房況與建立訂單
  之前執行，MUST NOT 讓過期訂單持續佔用房況。
- 金額 MUST 以整數（新臺幣元）運算，MUST NOT 以浮點數累加。顯示時才格式化。
  後端 MUST NOT 使用 `float` 承載金額。
- 訂單成立時的總金額 MUST 由後端依當下房價計算並保存於訂單上；房源價格日後變動
  MUST NOT 改變既有訂單金額。
- 每一項規則 MUST 有對應的自動化測試與手動驗收案例（含邊界：跨月、跨年、僅一晚、
  明日入住、退房日等於他人入住日）。

**理由**：日期算錯一天、或讓同一晚被訂兩次，會讓整個平台的核心行為失去可信度。
半開區間規則寫明於此，是為了避免每次實作各自發明一套。移到後端之後這些規則更重要
而非更不重要——用戶端送來的任何數字都可能是偽造的。

### V. 無障礙與響應式基本線（Accessible & Responsive by Default）

- MUST 使用語意化標籤（`header`、`nav`、`main`、`section`、`button` 等）；
  MUST NOT 用 `div` + `onClick` 取代 `button` 或 `a`。此條對 JSX 完全適用——
  React 讓寫出不可聚焦的假按鈕變得更容易，因此更需要明文禁止。
- 所有圖片 MUST 有 `alt`；純裝飾圖 MUST 使用 `alt=""`。
- 所有表單控制項 MUST 有關聯的 `<label>`。
- 所有互動元素 MUST 可用鍵盤操作，且 MUST 有可見的 focus 樣式。
  Tailwind 的 focus 樣式 MUST NOT 被 `outline-none` 全域移除而不提供替代。
- 文字與背景對比 MUST 達 WCAG AA（一般文字 4.5:1，大字 3:1）。米色系配色
  MUST NOT 成為對比不足的藉口。
- 版面 MUST 在 320px 寬度下正常顯示且不產生橫向捲動。房源列表 MUST 在窄螢幕上
  改為可捲動或改為直向堆疊，MUST NOT 造成整頁橫向捲動。
- 介面文字 MUST 使用繁體中文（台灣用語）。日期顯示格式 MUST 全站一致。

**理由**：這些是基本線而非加分項。企劃書已將「行動裝置 RWD 優化」列為待辦，
本原則將其提前為交付條件而非後補項目。

### VI. 誠實標示模擬範圍（No False Security, No False Payment）

本平台的付款與退款為展示用模擬；認證與授權則為真實實作。何者為真、何者為假，
MUST 明確標示，MUST NOT 讓任何使用者或後續開發者誤認。

- **認證**：由 FastAPI 自行實作。密碼 MUST 以 **argon2id 或 bcrypt** 雜湊儲存；
  MUST NOT 明文儲存，MUST NOT 使用可逆加密，MUST NOT 使用未加鹽的雜湊
  （MD5／SHA-1／裸 SHA-256 一律禁止）。密碼明文 MUST NOT 出現於日誌、
  錯誤訊息、稽核紀錄或 API 回應中，一次都不行。
- **Token 與秘鑰**：JWT 或 session 秘鑰 MUST 由環境變數提供，MUST NOT 有硬編碼的
  預設值 fallback——「沒設就用預設值」等同於公開秘鑰。Token MUST 有有效期限。
- **授權**：所有需要權限的端點 MUST 於後端驗證身分與角色。前端的路由檢查
  MUST NOT 被描述為安全機制；它只改變畫面呈現。**後端檢查是唯一的存取邊界**，
  MUST NOT 有任何僅靠前端隱藏來保護的端點。
- **展示性質的提醒**：登入畫面 MUST 提醒「本站為展示用專案，請勿使用你在其他
  網站的真實密碼」。
- **示範帳號**：`guest@sunny.com` / `guest123`、`admin@sunny.com` / `admin123`
  MUST 公開標示於登入畫面，且其密碼在資料庫中 MUST 同樣經過雜湊，MUST NOT 因為
  是示範帳號而走特例路徑。這組密碼 MUST 為本專案展示專用，
  MUST NOT 與任何人的真實密碼相同。
- **付款**：MAY 實作模擬的付款流程與付款方式選項（LINE Pay、信用卡、銀行轉帳）。
  但 MUST NOT 串接任何真實金流服務；MUST NOT 要求或儲存真實信用卡號、有效期限、
  CVV 或銀行帳號。付款畫面 MUST 明顯標示「虛擬支付，不會產生任何實際交易」。
  此規定 MUST NOT 因改用真實後端而放寬——反而因為現在真的有伺服器會收到這些欄位，
  它變得更重要。
- **退款**：退款審核 MUST NOT 產生任何實際金錢移轉，僅變更訂單與退款申請的狀態。
- **個資**：MUST NOT 要求或儲存真實身分證字號、真實金融資訊。示範資料中的姓名與
  聯絡方式 MUST 為虛構。
- **照片（前台使用者）**：使用者於「安全檢測」自行上傳的照片 MUST 僅於瀏覽器內以
  Canvas 處理，MUST NOT 被送往後端，MUST NOT 被寫入任何儲存空間或資料表，
  MUST NOT 於分析後殘留。**此條不可放寬，且不因後端存在而改變**——那是使用者的
  私人照片，而現在有了一個真的能收下它們的伺服器，這條禁令的意義才真正成立。
- **照片（管理員房源檢測）**：管理員對**自家房源**執行的品質檢測，其分析結果與
  受檢圖片 MAY 經後端上傳並公開於房源詳情頁。此類圖片 MUST 為飯店自有的房間照片，
  MUST NOT 包含可辨識的人物，且上傳前 MUST 明確告知管理員該圖將公開顯示。
  兩種來源的程式路徑 MUST 分離，MUST NOT 共用同一個上傳函式。
- **模擬的外部整合**：本專案不連接任何第三方商業平台。以下模組 MUST 以種子資料
  模擬，並 MUST 於畫面上明確標示其為模擬，MUST NOT 宣稱為真實服務：
  - **渠道比價與控價**：外部平台（Agoda／Booking 等）的價格 MUST 來自種子資料。
    MUST NOT 實作爬蟲、MUST NOT 呼叫任何 OTA 的 API。爬取第三方平台可能違反其
    服務條款，這不是本專案要承擔的風險。**後端的存在 MUST NOT 被當成「現在可以
    寫爬蟲了」的理由**——限制的理由是法律與倫理，不是技術可行性。
  - **AI 評論審核**：MUST 以規則式引擎實作（現可置於後端），MUST 於介面與後台標示為
    「自動審核（規則式）」而非「AI 審核」。MUST NOT 呼叫任何 LLM 服務。
    規則式審核的結果 MUST 可被管理員複核與覆寫，MUST NOT 成為不可申訴的最終判定。
- 所有模擬性質的模組 MUST 在檔案開頭以註解標示其為模擬，並說明真實系統應如何處理。

**理由**：改為自建後端後，認證與授權從「畫面控制」變成真正的安全機制，但付款依然是假的。
兩者混在同一個介面裡而不加區分，比全部都假還危險——使用者會以「登入是真的」推論
「付款也是真的」。此外，密碼保管的責任從託管服務回到本專案身上，因此雜湊規則從
「不得存在密碼欄位」改為明確的演算法要求，而非留白。

## 品質標準與技術約束

- **主控台**：正常操作流程下，瀏覽器 console MUST 零錯誤、零警告。
- **後端日誌**：正常操作流程下 MUST NOT 出現未處理的例外堆疊。
- **視覺基調**：暖象牙底色搭配深林綠主墨色與黃銅強調色、**襯線大標**、
  **直向拱形房源卡片**。標題字重 MUST 保持 400——精品調性靠字形與尺寸經營，
  加粗反而顯得廉價。拱形 MUST 以 `border-radius` 的雙值語法實作
  （水平半徑遠大於垂直半徑），否則會變成單純的圓角而非拱。
- **設計 token**：配色值、字級與圓角 MUST 集中定義於 Tailwind 設定的 theme 中，
  並以具名 token 使用（例如 `bg-brand`）。MUST NOT 在 JSX 中散佈任意值語法
  （`bg-[#96793F]`、`text-[13px]`）；一旦色值散落，全站換色就不再是改一個地方。
- **字型**：MAY 引入拉丁字 webfont（目前為 Playfair Display）。
  CJK webfont MUST NOT 引入——字型檔動輒數 MB。字型載入失敗時 MUST 優雅退回
  系統襯線體，版面 MUST NOT 因此崩壞（`font-display: swap`）。
- **對比度稽核**：新增或調整任何承載文字的顏色時，MUST 於 Tailwind theme 設定的
  註解標註其與背景的對比度。米色與黃銅這類低飽和配色特別容易在不知不覺中掉到
  4.5:1 以下。已知不合規項目見「合規審查」節。
- **命名**：React 元件使用 PascalCase，函式與變數使用 camelCase，
  常數使用 UPPER_SNAKE_CASE；Python 遵循 PEP 8（模組與函式 snake_case，
  類別 PascalCase）；資料庫識別名一律 snake_case。
- **編碼**：所有檔案 MUST 為 UTF-8。
- **錯誤處理**：MUST NOT 靜默吞掉錯誤。失敗的操作 MUST 對使用者顯示可理解的訊息，
  MUST NOT 只留一片空白畫面。後端 MUST NOT 將堆疊追蹤、SQL 語句或內部路徑
  回傳給用戶端。
- **影像處理**：前台使用者的照片分析 MUST 完全在瀏覽器內以 Canvas 完成（見原則 VI）。
- **報表匯出**：匯出功能 MUST 在函式庫無法載入時自動退回 CSV，MUST NOT 因此中斷
  或無回應，且 MUST 告知使用者已改用 CSV。
- **資源**：圖片 SHOULD 經過壓縮；MUST NOT 提交單檔超過 1 MB 的圖片。
- **啟動說明**：README MUST 記載前後端各自的啟動指令與必要環境變數。
  新進者 MUST 能只依 README 完成本機啟動，MUST NOT 需要口頭補充。

### 前端約束（React + Tailwind + Vite）

- **瀏覽器支援**：最新版的 Chrome、Edge、Firefox、Safari。MUST NOT 為舊版 IE 妥協。
- **套件管理**：MUST 使用 **npm**，且 `package-lock.json` MUST 進版控。
  pnpm、Yarn 或 Bun 的 lockfile MUST NOT 出現於版控中——本 repo 的 `tests/`
  已使用 npm，混入第二種工具會產生兩份互不知情的鎖定紀錄。
  所有相依 MUST 宣告於 `package.json`；MUST NOT import 未宣告的間接相依。
  npm 的扁平化 `node_modules` 會讓這件事靜默成功，直到那個間接相依某天消失為止，
  因此需明文禁止。
- **型別**：MUST 使用 TypeScript。`any` MUST 在 `plan.md` 或行內註解說明理由。
- **元件**：MUST 使用函式元件與 hooks。MUST NOT 引入 class 元件。
- **樣式**：樣式 MUST 以 Tailwind utility class 撰寫。手寫 CSS MUST 侷限於
  Tailwind 無法表達的情形（如複雜的 keyframes），且 MUST 集中於單一全域樣式檔。
  MUST NOT 引入 CSS-in-JS 或 CSS Modules——三套樣式方案並存會讓「改哪裡」
  變成每次都要重新調查的問題。
- **UI 函式庫**：預設不引入。引入任何元件庫 MUST 在 `plan.md` 說明理由。
- **狀態管理**：MUST 先使用 React 內建機制（`useState`、`useReducer`、Context）。
  引入外部狀態管理函式庫 MUST 在 `plan.md` 舉出內建機制無法解決的具體問題。
- **秘鑰**：MUST NOT 有任何秘鑰進入前端。`VITE_` 前綴的環境變數會被寫入建置產物，
  因此 MUST 僅用於公開資訊（如 API base URL）。

### 後端約束（FastAPI + uv）

- **Python 版本**：MUST 固定於 `pyproject.toml` 的 `requires-python`，
  且 MUST 為 3.12 或更新版本。
- **套件管理**：MUST 使用 **uv**。相依 MUST 宣告於 `pyproject.toml`；
  `uv.lock` MUST 進版控。MUST NOT 以 `pip install` 直接安裝至環境而不回寫宣告。
  MUST NOT 同時維護 `requirements.txt` 作為第二份事實來源
  （MAY 由 `uv export` 產生供部署用，但 MUST 標示為衍生產物）。
- **執行**：所有開發與測試指令 MUST 透過 `uv run` 執行，以確保使用鎖定的環境。
- **型別與驗證**：所有 API 的請求與回應 MUST 有 Pydantic 模型。
  MUST NOT 回傳未經模型定義的裸 `dict`。函式簽章 MUST 有型別註記。
- **設定**：所有設定 MUST 由環境變數讀取（SHOULD 以 `pydantic-settings` 集中管理），
  MUST NOT 硬編碼於程式中。缺少必要環境變數時，應用 MUST 於啟動時明確失敗，
  MUST NOT 以預設值靜默啟動。`.env` MUST NOT 進版控；`.env.example` MUST 進版控
  且 MUST 列出所有必要變數。
- **CORS**：允許來源 MUST 明確列出。MUST NOT 使用 `allow_origins=["*"]`
  搭配 `allow_credentials=True`。
- **ORM 與資料存取**：MUST 使用 **SQLAlchemy 2.0 的宣告式 ORM**，資料庫驅動
  MUST 為 **asyncpg**。模型 MUST 採用 2.0 風格的 `Mapped[...]` 型別註記，
  MUST NOT 使用 1.x 的舊式 `Query` API。
  PostgreSQL 特有的結構（`EXCLUDE USING gist` 房況約束、RLS 政策、trigger、函式）
  無法由 ORM 模型完整表達，MUST 由遷移腳本以原生 SQL 維護，
  MUST NOT 因為模型裡看不見就當作它們不存在——原則 IV 的房況保證正是其中之一。
- **非同步**：路由 MUST NOT 在 `async def` 中執行阻塞式 I/O。
  所有資料庫存取 MUST 走非同步 session，MUST NOT 在同一應用中混用同步 engine。
- **輸入驗證**：所有外部輸入 MUST 經 Pydantic 驗證。查詢 MUST 透過 ORM 或參數化
  語句，MUST NOT 以字串拼接組成 SQL。
- **檔案上傳**：上傳 MUST 經後端，且 MUST 檢查檔案大小與 MIME 類型。
  前端 MUST NOT 持有可直接寫入儲存空間的憑證。上傳後若因使用者取消而未被任何
  資料列引用，該檔案 MUST 被清除；反之，移除既有檔案 MUST 於變更真正保存後才
  實際刪檔——否則使用者按下取消，檔案卻已消失。
- **程式碼品質**：MUST 使用 ruff 進行 lint 與格式化，且 MUST 於審查前無錯誤。

### 資料庫約束

- **資料庫**：PostgreSQL。托管方式（Supabase 託管、其他雲端或自架）不在本憲章
  規範範圍，但 MUST 於 `plan.md` 記載，且 MUST 支援 `EXCLUDE USING gist` 約束
  （見原則 IV）。
- **存取者**：資料庫憑證 MUST 只存在於後端環境。MUST NOT 出現於前端程式碼、
  建置產物或版本控制中，一次都不行。若曾誤植，MUST 立即輪替該憑證。
- **Schema 變更**：MUST 使用 **Alembic** 管理。每次結構變更 MUST 為一支有版本編號
  的遷移腳本，且資料庫 MUST 自行記錄其所在版本。MUST NOT 只在管理介面手動改動
  而不回寫；MUST NOT 再以「請依序貼上執行這幾支 SQL」作為升級方式——
  「我該跑哪幾支」MUST 是工具的責任，不是人的記憶。
- **Alembic autogenerate**：MAY 用於產生初稿，但輸出 MUST 逐行人工審閱後才可提交，
  MUST NOT 直接套用。autogenerate **偵測不到** RLS 政策、trigger、函式與
  `EXCLUDE USING gist` 約束；更危險的是，它可能因無法辨識而產生**刪除**這些物件的
  敘述。提交任何遷移前 MUST 確認腳本不含任何非預期的 drop。
- **事實來源**：Alembic 的遷移歷程為資料庫結構的唯一事實來源，SQLAlchemy 模型
  MUST 與之一致。MUST NOT 另外維護一份手寫的全量 schema SQL 作為平行副本——
  兩份事實來源必然分歧，而本專案已經歷過一次（見 Governance 遷移計畫）。
  MAY 由工具產生唯讀快照供閱讀，但 MUST 標示為衍生產物。
- **RLS**：Row Level Security **MUST 全數移除**。授權邊界在 FastAPI（原則 VI）。
  （2026-08-03 修正：原條文寫「MAY 保留為縱深防禦」，是在未查核既有政策的情況下寫的。
  實際上 38 條政策中 30 條直接呼叫 `auth.uid()`、42 處呼叫依賴它的 `is_admin()`——
  該函式隨 Supabase Auth 一併消失，留著的政策不是全擋就是報錯。
  「保留」在此情境下不是縱深防禦，是留下一層壞掉的程式碼。）
- **不依賴身分的資料庫保證 MUST 保留**：`EXCLUDE USING gist` 房況約束、CHECK 約束，
  以及 `admin_logs` 的僅可新增特性。後者 MUST 改以資料表權限實作
  （對應用角色 `REVOKE UPDATE, DELETE`），MUST NOT 因為 RLS 移除就一併失去。
  這些保證不需要知道「誰」在操作，因此不受認證變更影響——它們才是原則 IV
  與稽核日誌條款的實際承載者。
- **稽核日誌**：管理員的後台變更操作 MUST 被記錄。日誌 MUST 為僅可新增
  （append-only）：任何角色皆 MUST NOT 能更新或刪除既有紀錄，包含管理員本人。
  日誌 MUST NOT 記錄密碼、秘鑰或任何真實個資。
- **系統參數**：可調整的營運參數（如未付款訂單保留時間）MUST 集中存於單一設定
  來源並由管理員維護，MUST NOT 硬編碼散落於程式碼中。參數 MUST 有合理範圍檢查，
  且變更 MUST 進入稽核日誌。
- **物件儲存**：公開讀取僅限已明示會公開的內容；寫入 MUST 只能經由後端。
  MUST NOT 建立可任意寫入的公開 bucket。

### 自動化測試

分層架構移除了先前對測試工具的所有顧慮。既然前後端都已有建置與執行環境，
測試依賴不再構成額外成本。

- **後端單元測試** MUST 使用 pytest，並以 `uv run` 執行。原則 IV 的**每一條**
  日期與房況規則 MUST 有對應測試，含所列邊界案例。這是本憲章唯一明訂「必須有測試」
  的區域，因為它是最容易錯且最難靠肉眼發現的部分。
- **API 契約測試** MUST 涵蓋所有需要授權的端點，驗證未認證與越權存取皆被拒絕。
  僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋。
- **前端測試** MAY 使用 Vitest 與 React Testing Library。
- **端對端測試** MAY 使用無頭瀏覽器。
- 自動化測試 MUST NOT 取代 `checklists/` 下的手動驗收清單：版面、對比、
  照片是否好看這類需要人眼判斷的項目，仍以手動驗收把關。

## 開發流程

1. **規格** — 以 `/speckit-specify` 建立或更新 `spec.md`；不明確處以 `/speckit-clarify`
   澄清。
2. **計畫** — 以 `/speckit-plan` 產出 `plan.md`。計畫 MUST 明確聲明其如何符合本憲章；
   任何偏離 MUST 在計畫中列出理由。本憲章遺留的 TODO 項目 MUST 於此階段定案。
3. **任務** — 以 `/speckit-tasks` 產出依相依順序排列的 `tasks.md`。
4. **驗收清單** — 每項功能 MUST 有手動驗收清單（可用 `/speckit-checklist` 產生），
   且 MUST 在實作前就寫好。清單 MUST 涵蓋 happy path 與錯誤／邊界情境。
5. **一致性檢查** — 實作前 SHOULD 執行 `/speckit-analyze` 檢查規格／計畫／任務的一致性。
6. **實作** — 以 `/speckit-implement` 執行。
7. **驗收** — 功能 MUST 在瀏覽器中實際操作、逐項通過驗收清單，且自動化測試
   MUST 全數通過後才算完成。MUST NOT 僅憑程式碼看起來正確就標記為完成。
8. **審查** — 變更 MUST 經過審查，確認：驗收清單已通過、測試通過、console 無錯誤、
   憲章合規。

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

**v3.0.0 遷移計畫**（依修訂程序第 3 條）：

本次修訂使既有實作大規模不合規。以下為已知範圍與過渡安排：

| 項目 | 現況 | 依新憲章的狀態 |
|---|---|---|
| `src/`（原生 JS，約 16,400 行含 CSS/HTML） | 原生 ES modules + 雙 adapter | 不合規，MUST 以 React + TypeScript 重寫 |
| `styles/`（5 個 CSS 檔） | 手寫 CSS 自訂屬性 | 不合規，色值與字級 MUST 移入 Tailwind theme |
| `src/config.js` / `window.__SUNNY_CONFIG__` | 前端持有 Supabase 憑證 | 不合規，MUST 移除，憑證改入後端環境變數 |
| localStorage adapter | 示範模式的資料層 | 不合規，MUST 移除（原則 III） |
| `supabase/schema.sql` → 資料表、CHECK 約束、24 個索引 | 已實跑驗證通過 | **MUST 原樣折進 Alembic 初始 revision**（`profiles.id` 對 `auth.users` 的外鍵除外） |
| `supabase/schema.sql` → `EXCLUDE USING gist` 房況約束 | 原則 IV 的資料庫層保證 | **MUST 原樣保留**，純 PostgreSQL，不受認證變更影響 |
| `supabase/schema.sql` → 38 條 RLS 政策 | 授權機制 | **MUST 移除**（見下方修正說明） |
| `supabase/schema.sql` → 11 個函式 | 業務規則與守門 | 5 個純 PostgreSQL 者 MUST 保留；`is_admin`、`prevent_role_escalation`、`guard_order_transition`、`stamp_review_reply`、`stamp_message_sender` 與掛在 `auth.users` 上的 `handle_new_user` MUST 改寫或移除 |
| `supabase/migrations.sql`（356 行） | 供舊資料庫補上後續變更 | 其內容已完整包含於 `schema.sql`（見該檔標頭）。初始 revision 建立後即無用途，MUST 移除 |
| `supabase/seed*.sql` | 種子資料 | 合規，MUST 保留（帳號密碼改為雜湊值） |
| `tests/`（unit.js、e2e、rest） | 瀏覽器內測試 + puppeteer | 過渡期 MAY 保留供比對；後端測試 MUST 以 pytest 重建 |

過渡期規則：
- 舊實作 MAY 於版控中保留至新實作通過全部驗收清單為止，作為行為比對的參考來源。
- 保留期間 MUST NOT 有任何新功能加入舊實作。
- 新舊兩套 MUST NOT 同時部署。
- 新實作通過驗收後，舊前端程式碼 MUST 被移除，MUST NOT 以「之後可能用得到」為由留存。

**已知不合規項目**（2026-07-31 起，v3.0.0 沿用）：

依使用者指示採用參考站的原始配色後，有一處**實際**低於原則 V 要求的 4.5:1：

| 位置 | 組合 | 實測對比 | 狀態 |
|---|---|---|---|
| 白字於品牌色 `#96793F` 上 | 主要按鈕文字 | **4.1:1** | ⚠️ 實際使用中，未達 AA |
| 淡色文字 `#7C8883` 於底色上 | — | 3.4:1 | 已定義但目前無任何規則使用，無實際影響 |

按鈕文字是唯一真正的違反。這是刻意保留的風格決定，非疏漏。
**修復方式為改動一個 token**：品牌色改為 `#7A6132`（即參考站的 `--brass-deep`，
白字對比 5.9:1）。視覺差異極小，不影響任何其他設計決定。

淡色文字若日後要投入使用，MUST 先改為 `#63706B`（4.8:1）。

在修復之前，主要按鈕 MUST NOT 被描述為符合 WCAG AA。
移植至 Tailwind theme 時 MUST 一併處理此項，MUST NOT 把已知的不合規色值原樣搬過去。

**Version**: 3.1.1 | **Ratified**: 2026-07-30 | **Last Amended**: 2026-08-03
