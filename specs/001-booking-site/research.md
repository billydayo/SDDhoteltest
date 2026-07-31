# Research: Sunny 訂房平台

> **修訂 2026-07-31（第二次）**：依產品企劃書修訂版納入渠道控價、操作日誌、
> 系統參數、收藏、Google 登入、待付款時效與 AI 審核等需求。新增決策見下方
> 「企劃書修訂版的四項技術取捨」。
>
> **修訂 2026-07-31（第一次）**：資料層由「僅瀏覽器 `localStorage`」改為
> 「Supabase 為主、`localStorage` 為示範模式備援」。

## 企劃書修訂版的四項技術取捨

### Decision: 渠道比價以種子資料模擬，不實作爬蟲

**Decision**: 渠道比價與控價模組的畫面、價差計算、賤賣預警與申訴郵件範本全部實作，
但外部平台售價來自 `channel_prices` 表的種子資料。系統不爬取任何網站，不呼叫任何
OTA 的 API。模組頂端常駐「模擬資料」標示。

**Rationale**:
- 企劃書指定「定時爬蟲 / API 對接」。瀏覽器無法執行定時作業，且跨網域抓取
  Agoda／Booking 會被 CORS 擋下——這不是實作難度問題，是瀏覽器安全模型的硬限制。
- 唯一的技術出路是伺服器端排程（Edge Function + pg_cron），但那等同自建後端服務，
  違反憲章原則 II，也會讓示範模式無法運作。
- 更重要的是：自動爬取 OTA 平台通常違反其服務條款。一個教學展示專案不應該把
  法律風險寫進架構裡。
- 以種子資料呈現，使用者仍能完整看到「發現價差 → 預警 → 產生申訴信」的營運流程，
  這正是此模組要展示的價值。

**Alternatives considered**:
- Edge Function + pg_cron 真實拉取 — 否決。見上：違憲、示範模式失效、法律風險。
- 前端直接 `fetch` OTA 頁面 — 否決。CORS 直接擋死，且同樣有 ToS 問題。
- 使用第三方比價 API — 否決。需要付費金鑰，且金鑰無處可藏（前端不能放）。
- 完全不做此模組 — 否決。企劃書明列為後台模組，且流程本身可展示。

### Decision: 評論的「AI 審核」以規則式引擎實作

**Decision**: 評論送出後由瀏覽器內的規則引擎初判為 `auto-pass` 或 `auto-reject`，
並記錄觸發的規則代碼；管理員複核後才決定是否公開。介面一律稱為
「自動審核（規則式）」，不使用「AI」字樣。管理員可覆寫任何自動判定。

規則涵蓋：不當字詞、內容過短、評分與文字情緒明顯矛盾、重複送件、
純符號或亂碼、含疑似聯絡方式或外部連結。

**Rationale**:
- 呼叫 LLM 需要 API 金鑰。前端放金鑰等同公開洩漏；藏在 Edge Function 則違反憲章
  原則 II 並使示範模式失效。
- 規則式引擎在兩種模式下行為完全一致，可離線執行，且判定結果**可解釋**——
  管理員看得到觸發了哪條規則，這在審核場景比黑箱分數更有用。
- 稱它為 AI 會是不誠實的標示，違反憲章原則 VI。稱為「自動審核」既準確又不減損價值。
- 保留管理員覆寫權，避免規則誤判成為不可申訴的最終判定。

**Alternatives considered**:
- Edge Function 代呼叫 LLM — 否決。違憲、示範模式失效、需付費金鑰。
- 前端直接呼叫 LLM API — 否決。金鑰必然外洩。
- 瀏覽器內跑小型 ML 模型（如 transformers.js）— 否決。需下載數十 MB 模型，
  違反「零建置、可離線、直接開啟」的定位，且中文內容審核的效果未必勝過規則。
- 純人工審核 — 否決。企劃書明確要求送出後先經自動判定。

### Decision: 兩條照片路徑，只有管理員的檢測圖會上雲

**Decision**: 拍照風險預測拆為兩條獨立的程式路徑：

| 路徑 | 使用者 | 照片去向 | 儲存 |
|---|---|---|---|
| 前台「安全檢測」 | 任何人 | 只在瀏覽器記憶體 | 不存，離開頁面即消失 |
| 後台「房源檢測」 | 僅管理員 | 上傳至 Storage `room-risk` bucket | 存，公開於房源詳情頁 |

兩條路徑 MUST NOT 共用同一個上傳函式。只有 `saveRoomRiskCheck()` 會碰到 Storage。

**Rationale**:
- 企劃書要求房源詳情頁顯示「實際完成風險檢測圖」，這需要儲存圖片；但憲章原本
  一律禁止照片離開瀏覽器。兩者的衝突其實是**照片的所有權不同**：
  前台是使用者的私人照片，後台是飯店自有的房間照片。
- 以「誰的照片、給誰看」為切分依據，比以「功能名稱」切分更穩固：日後新增任何
  上傳功能，都能用同一個問題判斷該走哪條路。
- 程式路徑分離而非用旗標控制，是因為旗標會在某次重構中被設錯，而分離的函式不會
  被誤呼叫——前台頁面根本不 import 上傳函式。
- Storage bucket 設為公開讀取但僅管理員可寫，符合「已明示會公開的內容」的原則。

**Alternatives considered**:
- 只存分數與建議、不存圖片 — 否決。企劃書明確要求顯示檢測圖，且無圖的檢測結果
  對顧客的說服力大幅下降。
- 兩條路徑共用上傳函式加旗標 — 否決。見上，旗標是未來的資安事故。
- 全部都存 — 否決。使用者的私人照片沒有理由上雲，這是不可放寬的底線。

### Decision: 待付款訂單以「查詢時判定」處理逾期

**Decision**: 訂單建立時狀態為 `pending-payment`，並寫入
`expires_at = now() + system_settings.pending_payment_minutes`（預設 60）。
待付款訂單**納入**排除約束，因此同樣阻擋他人預訂。逾期清理由
`expire_stale_orders()` 函式負責，並於三個時機被強制呼叫：查詢房況前、
建立訂單前、讀取訂單列表前。不使用 pg_cron 或任何排程。

**Rationale**:
- 企劃書要求「未付款訂單保留 1 小時，逾期自動取消」。若待付款訂單不佔房況，
  保留就沒有意義；若佔了房況卻不清理，過期訂單會永久擋房——兩者都必須成立。
- 排程作業是最直覺的解法，但違反憲章原則 II，且示範模式沒有排程可用。
- 「查詢時判定」讓兩種模式的行為一致，且對使用者而言結果相同：下一次有人查詢
  該房源時，過期的保留就已經釋出。唯一的差異是「自動取消」的可觀察時點是
  下一次查詢，而非到期的那一秒——這已寫入 spec 的 Assumptions，不是隱藏行為。
- 「建立訂單前必須先清理」是關鍵細節：否則殭屍訂單會誤觸發排除約束，
  使用者會看到「已無空房」但實際上房是空的。

**Alternatives considered**:
- pg_cron 定期清理 — 否決。違反憲章原則 II，且示範模式無對應機制。
- 待付款訂單不佔房況 — 否決。那樣「保留 1 小時」形同虛設，且會出現
  「我付了款但房間被別人訂走」。
- 前端計時器到期後自動送出取消 — 否決。使用者關掉分頁就失效，且不同裝置各算各的。
- 排除約束不含待付款、改以應用層檢查 — 否決。並行下必然出現重複預訂。

### Decision: Google 登入使用 Supabase Auth 的 OAuth provider

**Decision**: 以 `auth.signInWithOAuth({ provider: 'google' })` 實作，於 Supabase
Dashboard 啟用 Google provider。示範模式下按鈕呈現為停用並說明原因。
Supabase Auth 預設會以電子郵件合併同一使用者，因此既有的密碼帳號與相同信箱的
Google 帳號會進入同一個 `auth.users`，`profiles` 也只會有一筆。

**Rationale**: 這是 Supabase 原生支援的能力，不需要自行處理 OAuth 流程、token 交換
或 callback 伺服器，與零建置約束相容。既有的 `handle_new_user` trigger 對 OAuth
註冊同樣生效，`raw_user_meta_data` 中的 `full_name` 可作為顯示名稱的來源。

**Alternatives considered**:
- 自行實作 Google OAuth 流程 — 否決。需要伺服器端保管 client secret。
- 不做第三方登入 — 否決。企劃書明列。
- 示範模式以假的 Google 流程模擬 — 否決。假造第三方授權畫面會誤導使用者，
  違反憲章原則 VI 的誠實標示要求；停用並說明原因才是正確做法。

## Decision: Supabase as the primary data layer, localStorage as demo fallback

**Decision**: 應用程式以 Supabase（託管 Postgres + Auth）作為預設資料層。
`@supabase/supabase-js` v2 以 ESM CDN（`https://esm.sh/@supabase/supabase-js@2`）
動態載入。若未提供憑證，應用程式自動綁定 `localStorage` adapter，功能完整且不發出
任何網路請求。

**Rationale**:
- Supabase 提供託管的 Postgres、Auth 與 RLS，不需要自行撰寫或部署任何後端程式碼，
  因此不違反憲章原則 II 的「零建置、無自建後端」約束。
- 以 ESM CDN 動態 `import()` 引入，無需 `npm install` 或打包步驟；且因為是動態載入，
  示範模式下這段程式碼根本不會被下載，能真正做到零網路請求。
- 保留 `localStorage` 備援是產品要求（未填憑證即自動示範），也讓專案在沒有網路、
  沒有帳號的教學場合仍可直接開啟使用。

**Alternatives considered**:
- 純 `localStorage`（原方案）— 已被本次決策取代。無法跨裝置、無法多人共用資料，
  且企劃書已將「串接後端資料庫」列為明確待辦。
- 自建 Node/Express + 資料庫 — 否決。需要部署與建置步驟，直接違反憲章原則 II。
- Firebase / Firestore — 否決。文件型資料模型不適合本專案以日期區間為核心的房況查詢；
  Postgres 的 `daterange` 與排除約束正好能在資料庫層保證不重複預訂。
- 只用 Supabase、移除示範模式 — 否決。使用者明確要求保留「未填憑證即自動示範」。

## Decision: Dual-adapter repository with an async-only interface

**Decision**: 建立 `src/data/adapters/supabase.js` 與 `src/data/adapters/local.js`
兩個實作相同簽章的 adapter，由 `src/data/repository.js` 於啟動時依
`isSupabaseConfigured` 擇一綁定。**所有**資料存取函式一律回傳 Promise，包含示範模式。
資料庫使用 snake_case，前端使用 camelCase，欄位轉換只發生在 Supabase adapter 內部。

**Rationale**: 呼叫端若需區分兩種模式，等於要維護兩套 UI 邏輯，示範模式會很快腐爛。
統一為非同步介面後，頁面與元件完全不知道資料從哪裡來；驗收案例也能原封不動地在兩種
模式下各跑一次。

**Alternatives considered**:
- 示範模式維持同步、Supabase 模式非同步 — 否決。呼叫端會被迫寫 `await` 與非 `await`
  兩種分支，是最常見的腐爛來源。
- 在每個頁面用 `if (demoMode)` 分岔 — 否決。分岔點會隨功能數量線性增長。
- 只寫 Supabase adapter，示範模式用本機 Postgres 模擬器 — 否決。需要安裝步驟。

## Decision: Supabase Auth for identity, `profiles` table for application data

**Decision**: 身分驗證使用 Supabase Auth 的 `signUp` / `signInWithPassword` /
`signOut` / `onAuthStateChange`。密碼由 Supabase 雜湊保管，應用程式資料表
**不存在任何密碼欄位**。應用層資料（角色、顯示名稱、聯絡電話）放在 `public.profiles`，
主鍵即 `auth.users.id`，並由 `on auth.users` 的 trigger 於註冊時自動建立，
預設角色為 `member`。示範模式沿用種子帳號的模擬登入。

**Rationale**:
- 原 schema 的 `users.password` 為明文欄位，即使是展示專案也不應該存在——資料一旦
  離開使用者本機，明文密碼就是真實風險（使用者可能重用其他網站的密碼）。
- 角色若存在 `auth.users` 的 metadata，使用者可自行修改（`updateUser` 可寫入
  `user_metadata`），會讓「自我升級為管理員」變成一行程式碼。放在受 RLS 保護的
  `profiles` 表並禁止一般使用者更新 `role` 欄位，才是正確做法。
- 註冊即可用（不寄驗證信）符合展示需求，於 Supabase Dashboard 關閉
  “Confirm email” 即可。

**Alternatives considered**:
- 沿用自建 `users` 表比對明文密碼 — 否決。見上。
- 角色存於 JWT custom claim — 否決。需要額外的 Auth Hook 設定，且本專案的權限查詢
  頻率低，`profiles` 查詢已足夠。
- 使用 Supabase Auth 的 admin API 建立示範帳號 — 否決。需要 service_role key，
  禁止出現於前端。示範帳號改由 Dashboard 手動建立，並以 SQL 指定其管理員角色。

## Decision: Credentials loaded from a committed `src/config.js`, never from `.env`

**Decision**: 憑證由版控中的 `src/config.js` 提供，該檔在 `index.html` 中以一般
`<script>` 前置載入並設定 `window.__SUNNY_CONFIG__`，預設值為空字串（即示範模式）。
前端**不**讀取 `.env`、`process.env` 或 `import.meta.env`。`.env` 僅保留給日後可能的
CI／工具使用，不參與執行期。`service_role` key 一律不得出現於前端或版控。

**Rationale**:
- 專案沒有建置步驟，`import.meta.env` 與 `process.env` 在直接開啟的瀏覽器中一律
  `undefined`。原 `src/lib/supabase.js` 讀取它們的分支是永遠不會執行的死碼，也讓
  「我填了 `.env` 卻還是示範模式」變成必然發生的困惑。
- 若把 `config.js` 加入 `.gitignore`，缺檔時 `<script>` 會產生 404，違反憲章
  「主控台零錯誤」；因此改為隨專案提供、預設留空。
- anon key 是設計上可公開的識別碼（Supabase 官方稱為 publishable key），其防護來自
  RLS 而非保密，因此可以安全地存在於前端設定檔中。這也正是 RLS 必須完整的原因。

**Alternatives considered**:
- `config.js` 加入 `.gitignore` + `<script onerror>` — 否決。404 仍會印在主控台。
- 動態 `import('./config.js')` 包 try/catch — 否決。缺檔的網路錯誤同樣會出現在主控台。
- 要求使用者跑一個產生設定檔的腳本 — 否決。等同引入建置步驟。

## Decision: Database-enforced booking exclusivity

**Decision**: `orders` 表加上 `EXCLUDE USING gist (room_id WITH =,
daterange(check_in, check_out, '[)') WITH &&) WHERE (status IN ('confirmed',
'refund-pending'))`（需 `btree_gist` 擴充）。前端仍保留重疊檢查以提供即時回饋，
但衝突的最終判定以資料庫的約束違反為準，並轉譯為「此房源於所選日期已無空房」。

**Rationale**: 資料改為多人共用後，「查詢後再寫入」之間存在競態窗口，純前端檢查無法
保證唯一性。Postgres 的排除約束正好以半開區間 `[check_in, check_out)` 表達，與憲章
原則 IV 的重疊規則完全一致，且自動處理「相鄰不重疊」的邊界案例。

**Alternatives considered**:
- 僅靠前端檢查 — 否決。兩人同時下訂會同時成立。
- 以 RPC + 交易 + `SELECT ... FOR UPDATE` 實作 — 否決。排除約束更簡短、更難寫錯，
  且不需要維護額外的資料庫函式。
- 唯一索引 — 否決。無法表達區間重疊，只能表達完全相同的日期。

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

**Note (2026-07-31)**: 即使專案已有雲端儲存能力，風險檢測的照片仍 MUST NOT 上傳至
Supabase Storage 或任何資料表。分析全程留在瀏覽器內，這是憲章原則 VI 的明文要求。

**Alternatives considered**:
- Binary pass/fail only — rejected because it is not expressive enough for the admin and user guidance requirement.
- External AI model — rejected because it violates the browser-only and no-network requirement.

## Decision: Date correctness model

**Decision**: Use `YYYY-MM-DD` strings in Asia/Taipei timezone; compare by calendar dates, not timestamps; use half-open interval logic to detect overlaps.

**Rationale**: The constitution explicitly requires this to prevent booking logic errors. It also matches the user-facing requirements and reduces timezone confusion.

**Note (2026-07-31)**: Postgres 的 `date` 型別無時區成分，與 `YYYY-MM-DD` 字串一對一
對應，因此 adapter 於轉換時 MUST NOT 經過 `Date` 物件或 `toISOString()`，避免時區位移。

**Alternatives considered**:
- Timestamp comparisons in local timezone — rejected because it can shift around DST or browser timezone differences.
- Simple string comparisons without interval rules — rejected because it fails on adjacent and nested date edge cases.

## Decision: Access control enforced by RLS, mirrored in the UI

**Decision**: 資料庫模式下，會員／管理員的存取邊界由 Supabase Row Level Security 政策
強制執行；前端的路由檢查與畫面隱藏僅為使用者體驗，不被視為安全機制。示範模式僅有
前端檢查，並明確標示其非安全機制。

**Rationale**: 前端與 anon key 都在使用者可控範圍內，任何只靠畫面隱藏的權限都可被繞過。
RLS 是唯一實際的邊界，因此「會員不得讀取他人訂單」等要求必須在資料庫層表達。

**Alternatives considered**:
- 僅前端檢查（原方案）— 已被取代。資料上雲後，僅前端檢查等於全站資料公開可讀。
- 以 Edge Function 包一層 API — 否決。等同自建後端，且沒有 RLS 做不到的事。

## Decision: Simulated payment and refund model

**Decision**: Payment methods are present in the interface, but they are clearly labeled as virtual and never store or request real financial data.

**Rationale**: This matches the constitution’s “No False Security, No False Payment” principle and the requirement to show simulation clearly.

**Note (2026-07-31)**: 認證改為真實之後，付款仍為模擬。介面 MUST 分別標示，
避免使用者由「登入是真的」推論「付款也是真的」。

**Alternatives considered**:
- Card entry forms with fake fields — rejected because it risks user confusion and does not meet the product disclosure requirement.
- No payment selection UI — rejected because the feature requirement explicitly calls for payment methods.
