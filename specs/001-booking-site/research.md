# Research: Sunny 訂房平台（FastAPI + React 架構）

**Date**: 2026-08-03 | **Plan**: [plan.md](./plan.md) | **憲章**: v3.1.1

> **本次修訂（2026-08-03）**：技術堆疊由「原生 JS + 瀏覽器直連 Supabase + 雙軌
> localStorage adapter」改為「React + FastAPI + SQLAlchemy + Alembic」。
> 技術**選型**已於憲章 v3.1.0 定案，本文件不重新評估選型，而是回答落實過程中
> 必須先解決的問題（Part A），並重新檢視沿用的產品決策（Part B）。
>
> 已作廢的決策：Supabase 為主資料層、雙 adapter repository、Supabase Auth、
> `src/config.js` 憑證載入、RLS 作為存取邊界。

---

# Part A：架構變更的調查

## R1. 既有 schema.sql 有多少能折進 Alembic？

**問題**：憲章 v3.0.0 的遷移計畫聲稱 `supabase/schema.sql`「內容 MUST 完整保留」。
該檔剛於全新專案實跑驗證通過（commit `2bc38ac`），假設它整份可搬是合理的直覺。
但它是為「瀏覽器直連 Supabase」而寫的，需逐層查核。

**調查方法**：對 `supabase/schema.sql`（972 行）逐類統計對 `auth` schema 的參照。

**發現**：全檔 **36 處**參照 Supabase 的 `auth` schema，集中在認證與授權層。

| 層 | 數量 | 依賴 `auth`？ | 處置 |
|---|---|---|---|
| 資料表定義 | 12 張 | 僅 `profiles.id` 外鍵 | 保留，改寫該外鍵 |
| CHECK 約束 | 多條 | 否 | 原樣保留 |
| 索引 | 24 個 | 否 | 原樣保留 |
| `EXCLUDE USING gist` | 1 條 | 否 | **原樣保留** |
| RLS 政策 | 38 條 | 30 條直接用 `auth.uid()` | **全數移除** |
| 函式 | 11 個 | 6 個 | 5 個保留、6 個改寫或移除 |
| 觸發器 | 7 個 | `on_auth_user_created` 掛在 `auth.users` | 該觸發器移除，其餘視函式而定 |

函式逐一判定：

| 函式 | 依賴 | 處置 |
|---|---|---|
| `pending_payment_minutes()` | 無 | ✅ 原樣保留 |
| `expire_stale_orders()` | 無 | ✅ 原樣保留 |
| `refresh_room_rating()` | 無 | ✅ 原樣保留 |
| `enforce_refund_limit()` | 無 | ✅ 原樣保留 |
| `guard_message_update()` | 無 | ✅ 原樣保留 |
| `is_admin()` | `auth.uid()` | ❌ 移除，授權移至 FastAPI |
| `prevent_role_escalation()` | `is_admin()` | ❌ 改為 FastAPI 層檢查 |
| `guard_order_transition()` | `is_admin()` | ⚠️ 拆解，見 R2 |
| `stamp_review_reply()` | `auth.uid()` | ❌ 改寫：回覆者由後端傳入 |
| `stamp_message_sender()` | `auth.uid()` | ❌ 改寫：寄件者由後端傳入 |
| `handle_new_user()` | 掛在 `auth.users`，讀 `raw_user_meta_data` | ❌ 移除，註冊改由 FastAPI 建立 profile |

**Decision**：憲章 v3.1.1 的遷移計畫表已依此拆為四列，不再宣稱「完整保留」。

**Rationale**：`auth.uid()` 是 Supabase 依 JWT 注入的 session 變數。FastAPI 以固定的
資料庫帳號連線，該函式不存在，引用它的政策不是全擋就是報錯。留著不是縱深防禦，
是留下一層壞掉的程式碼。

**Alternatives considered**：
- *改寫 RLS 用 `current_setting('app.user_id')` + 每交易 `SET LOCAL`* —— 真正可行的
  縱深防禦，但要改寫 38 條政策，且應用連線角色不得為表擁有者（否則 RLS 預設被繞過，
  需 `FORCE ROW LEVEL SECURITY`）。最大風險是漏設 GUC 的路徑會靜默失效——政策看到
  NULL 而拒絕全部，或在 `FORCE` 未開時放行全部。這是一整類新的失效模式，
  換來的防護在「授權已完整實作於 FastAPI」的前提下重複。**已記錄為日後可選的強化項**，
  需以修訂程序引入。
- *保留 Supabase 只當認證服務* —— 憲章 v3.1.0 已定案排除。

---

## R2. `EXCLUDE USING gist` 在 SQLAlchemy 與 Alembic 中如何表達？

**問題**：憲章原則 IV 把「同一房源同一晚不得有兩筆有效訂單」押在資料庫層。
這是全專案最不能出錯的一條，而它正好是 ORM 抽象最薄弱的地方。

現況約束：

```sql
exclude using gist (
  room_id with =,
  daterange(check_in, check_out, '[)') with &&
) where (status in ('pending-payment', 'confirmed', 'refund-pending'))
```

三個特性疊加：GiST 索引、`daterange` 半開區間、`where` 子句（部分排除約束，
讓已取消與已退款的訂單釋出區間）。

**Decision**：模型端以 `sqlalchemy.dialects.postgresql.ExcludeConstraint` 宣告於
`__table_args__`，運算式以 `text()` 承載；Alembic 遷移端以 `op.execute()` 寫原生 SQL，
**不依賴 autogenerate**。

**Rationale**：
- `ExcludeConstraint` 能表達 `room_id with =`，但 `daterange(a, b, '[)')` 是函式運算式，
  `where` 是部分約束——組合後 autogenerate 的還原能力不可靠。
- 更關鍵的風險不是「產不出來」而是**產出刪除敘述**：autogenerate 比對模型與資料庫時，
  對無法解析的物件可能判定為多餘而產生 `op.drop_constraint`。這條約束一旦被靜默移除，
  超賣不會報錯，只會安靜地發生，且要等到兩位客人同時抵達櫃台才會被發現。
- 憲章 v3.1.0 已明訂 autogenerate 輸出 MUST 逐行審閱、MUST 確認不含非預期的 drop。
  本專案將此列為遷移審查的固定檢查項。

**必要前置**：`create extension if not exists btree_gist;` MUST 位於初始 revision 最前面——
`room_id with =` 的等值比對需要它，缺了會在建立約束時失敗。

**`guard_order_transition()` 的拆解**：該 trigger 原本做兩件事——(a) 管理員可自由改狀態、
(b) 一般會員不得對已逾期訂單付款、不得從任意狀態跳到已確認。(a) 依賴 `is_admin()`，
移至 FastAPI；(b) 不需知道「誰」，只需比對新舊狀態與 `expires_at`，MUST 保留於資料庫。

**Alternatives considered**：
- *應用層鎖（`SELECT ... FOR UPDATE` 房源列）* —— ORM 友善，但把保證移回應用層，
  違反原則 IV 明文「後端的檢查是授權與訊息品質，資料庫的約束才是保證」。
- *唯一索引* —— 無法表達區間重疊，只能表達完全相同的區間。

---

## R3. 約束觸發時如何轉為使用者訊息而非 500？

**問題**：FR-082 要求衝突訂房被拒時使用者看到「此房源於所選日期已無空房」。
排除約束在資料庫層觸發時 asyncpg 會拋例外，不攔截就是 500。

**Decision**：於建立訂單的 service 層攔截 SQLAlchemy 的 `IntegrityError`，
自 `.orig` 取出 asyncpg 原始例外，**比對約束名稱 `orders_no_overlap`**，
轉為 HTTP 409 與該訊息。

**Rationale**：
- **必須比對約束名稱，不能只看例外型別**。`orders` 上還有 `valid_date_range`、
  `nights_matches_dates` 兩條 CHECK 與 `order_no` 的唯一約束，全都產生 `IntegrityError`。
  不分辨就會把「夜數對不上」也回成「已無空房」，使用者照著訊息改日期永遠改不好。
- 選 409 而非 400：請求本身合法，是與其他資料的競態導致失敗。

**前端檢查的定位**：前端仍會先查可用性並即時提示，但那是 UX。兩位使用者同時送出時
前端兩邊都會顯示可訂——真正的裁決在資料庫，這是設計預期而非缺陷。

---

## R4. 逾期待付款訂單的「查詢時判定」

**問題**：有了真正的後端後，排程作業變得技術可行，需確認是否改變原決策。

**Decision**：**維持查詢時判定**。保留 `expire_stale_orders()`，由資料存取層在三個時機
呼叫：查詢房況前、建立訂單前、讀取訂單列表前。

**Rationale**：
- 憲章原則 IV 的「MUST NOT 依賴外部排程」在 v3.0.0 更換堆疊後**未被移除**，仍然有效。
- 排程會引入與請求週期無關的失效模式：排程掛了沒人會立刻發現，房況會安靜地停止釋出。
  查詢時判定的失效是立即可見的。
- 取捨已明載於 spec.md 的 Assumptions：「自動取消」的可觀察時點是下一次有人查詢時。

**實作位置**：MUST 在資料存取層內部呼叫，MUST NOT 交由各路由自行記得——
三個呼叫點集中於一處，新增路由時才不會漏掉。

---

## R5. 密碼雜湊演算法

**Decision**：**argon2id**，透過 `argon2-cffi`。

**Rationale**：
- OWASP 現行首選，對 GPU 破解的抵抗力優於 bcrypt。
- bcrypt 有 72 位元組的輸入截斷特性，超長密碼會被靜默截斷。FR-009b 只定下限 6 字元、
  未定上限，這個特性會造成難以察覺的行為差異。
- `argon2-cffi` 內建 `check_needs_rehash`，日後調高成本參數時可在使用者登入當下
  自動重新雜湊，不需要求全體重設密碼。

**種子帳號**：`guest123` / `admin123` MUST 在種子腳本執行時**計算**雜湊後寫入，
MUST NOT 走特例路徑（FR-009a 已明訂無例外），也 MUST NOT 硬編碼雜湊值——
硬編碼會讓日後調整參數時種子資料悄悄落後於正式路徑。

---

## R6. 認證的 token 形式

**Decision**：JWT 存於 `localStorage`，由前端 API client 統一附加
`Authorization: Bearer` 標頭。

**Rationale**：
- 憲章原則 III 允許 `localStorage` 保存「UI 偏好與認證 token」，明文排除業務資料。
- 選 `localStorage` 而非 httpOnly cookie：前後端分離部署時 cookie 需處理跨站設定
  （`SameSite=None; Secure`）與 CSRF 防護，複雜度高於本專案需要。
- **代價必須誠實記錄**：`localStorage` 中的 token 可被 XSS 讀取。緩解措施是 React 預設的
  JSX 逸出（不使用 `dangerouslySetInnerHTML`）與較短的 token 有效期。
  這是刻意取捨，不是疏漏。

**FR-009d 的對應**：token 過期時 API 回 401，前端 API client MUST 統一攔截、導向登入頁
並保留原本要前往的位置，MUST NOT 由各元件各自處理。

---

## R7. Google 登入

**問題**：原以 Supabase Auth 的 `signInWithOAuth` 實作，該能力隨 Supabase 移除。

**Decision**：以 Authorization Code Flow 自行實作，**code 交換由 FastAPI 執行**。
前端只負責導向 Google 與接回 code；client secret MUST 只存在於後端環境變數。

**FR-088 的關鍵**：以既有電子郵件的 Google 帳號登入時必須進入同一帳號。實作 MUST 以
電子郵件比對既有 profile 並綁定，MUST NOT 建立第二筆。此處 MUST 有測試覆蓋——
這是最容易在重構中失守的一條，而失守的表現是使用者「登入後訂單不見了」，
不是任何錯誤訊息。

---

## R8. 兩條照片路徑如何在新架構下維持分離

**Decision**：維持結構性隔離，分三層：

1. **共用**：`riskScore.ts`（純函式，Canvas 指標計算），兩條路徑都用。
2. **前台**：安全檢測頁面只 import `riskScore.ts`。整個前台不存在任何能上傳圖片的函式。
3. **管理端**：上傳能力只存在於管理端模組，且後端上傳端點 MUST 驗證管理員身分。

**Rationale**：以旗標控制（`shouldUpload: boolean`）看似簡單，但失效模式是上傳使用者的
私人照片——那不是能靠測試補救的錯誤類型。讓前台**沒有**上傳函式可呼叫，
使該錯誤在結構上無法發生。

**新架構下這條更重要**：舊架構沒有後端可以接收照片，禁令某種程度上由架構代為保證；
現在有了，禁令才真正需要被執行。

**驗證**：SC-030 要求「前台安全檢測照片出現在儲存或資料表中的次數為 0」。除人工驗收外，
MUST 有一項自動檢查：前台模組的相依圖中不得出現上傳模組。

---

## R9. 測試策略

| 層 | 工具 | 覆蓋範圍 |
|---|---|---|
| 後端單元 | pytest | 原則 IV 的**每一條**日期與房況規則，含所列邊界 |
| API 契約 | pytest + httpx | 每個需授權端點的未認證與越權存取皆被拒 |
| 前端單元 | Vitest + React Testing Library | 表單驗證、日期呈現 |
| 端對端 | 現有 puppeteer 測試改寫 | 主要流程 |

**授權測試的具體要求**：憲章明訂「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」。
**移除 RLS 後這一層是唯一的存取邊界**，因此每個受保護端點 MUST 有三個案例：
未認證、以他人身分認證、以正確身分認證。

**gist 約束的測試**：MUST 有一項並行測試實際觸發 `orders_no_overlap`，驗證恰有一筆成立
且另一筆收到正確訊息（SC-020）。僅測試前端檢查不算覆蓋——前端檢查在並行情境下
兩邊都會放行。

---

## R10. 遷移順序

**Decision**：資料庫 → 後端 → 前端，且新舊不同時部署。

**Rationale**：資料庫是唯一在新舊架構間共用的資產。先把 schema 折進 Alembic 並確認
gist 約束與各項 CHECK 在新環境下行為一致，後端才有可信的基礎；後端的 OpenAPI 契約
穩定後，前端才有可對接的目標。反向進行會讓前端對著會變動的契約重寫兩次。

**舊碼處置**：憲章遷移計畫已訂——舊實作 MAY 保留至新實作通過全部驗收清單為止，
保留期間 MUST NOT 加入新功能，通過後 MUST 移除。本專案將舊前端保留為**行為比對來源**，
特別是那些寫在 JS 裡但沒寫進 spec 的細節（錯誤訊息措辭、排序穩定性、空狀態文案）。

---

# Part B：沿用的產品決策

## B1. 理由已改變，結論不變 ⚠️

以下三項決策的結論維持不變，但**原本的理由已經失效**。誠實記錄這件事很重要：
原理由都是「架構上做不到」，現在架構做得到了，禁令因此變成一項**選擇**。
若不更新，日後會有人正確地指出「我們現在有後端了」，而找不到任何反對的記錄。

### B1-a. 渠道比價以種子資料模擬，不實作爬蟲

**結論不變**：外部平台售價來自 `channel_prices` 種子資料。不爬取任何網站，
不呼叫任何 OTA API。模組頂端常駐「模擬資料」標示。

| | 舊理由（已失效） | 新理由（現行） |
|---|---|---|
| 主要 | 瀏覽器無法定時作業，跨網域被 CORS 擋死 | — 後端可以，此理由不再成立 |
| 次要 | 伺服器端排程等同自建後端，違反憲章原則 II | — 已自建後端，此理由不再成立 |
| **現行** | — | **爬取 OTA 平台通常違反其服務條款。這是法律與倫理的限制，不是技術限制。** |

憲章 v3.0.0 已預先寫入這一點：「**後端的存在 MUST NOT 被當成『現在可以寫爬蟲了』的
理由——限制的理由是法律與倫理，不是技術可行性。**」

### B1-b. 評論的「AI 審核」以規則式引擎實作

**結論不變**：以規則式引擎實作，介面標示為「自動審核（規則式）」而非「AI 審核」。
判定 MUST 可被管理員複核與覆寫。

| | 舊理由（已失效） | 新理由（現行） |
|---|---|---|
| 主要 | 無建置步驟的前端沒有地方安全存放 API 金鑰 | — 後端環境變數可以安全存放，此理由不再成立 |
| **現行** | — | **刻意的範圍決定**：本專案為展示用，不引入外部 LLM 的成本、延遲與不確定性；且規則式判定可解釋、可覆寫，符合「MUST NOT 成為不可申訴的最終判定」 |

**實作位置變更**：規則式引擎由瀏覽器移至後端。審核結果會影響評論是否公開，
屬授權範圍內的決定，MUST 在後端執行——留在前端等於讓使用者自行決定自己的評論過不過審。

### B1-c. 待付款訂單以「查詢時判定」處理逾期

見 R4。舊理由含「憲章原則 II 禁止排程」，該原則已改寫；現行理由為原則 IV 的明文禁令
與「排程失效不可見」的運維考量。

---

## B2. 理由不變，原文沿用 ✅

以下決策與技術堆疊無關，維持原判：

### B2-a. 退款政策依距入住日分級

- 入住前 7 天以上：全額退款
- 入住前 3–6 天：50%
- 入住前 1–2 天：20%
- 入住當日或已入住：不退款

**Rationale**：規則明確、易於計算與驗收，且支援後台審核流程而不留模糊地帶。

### B2-b. 照片風險評分公式

三項指標（亮度、雜亂度、對比）各 0–100，總風險：

`100 - (0.4 × 亮度 + 0.35 × 雜亂度 + 0.25 × 對比)`

等級：0–34 低風險／35–59 中風險／60–100 高風險。

**Rationale**：簡單、確定性、可完全在瀏覽器內以 Canvas 實作。
**前台使用者的受檢照片仍 MUST NOT 離開瀏覽器**（見 R8）。

### B2-c. 日期正確性模型

`YYYY-MM-DD` 字串、Asia/Taipei、日曆日比較、半開區間重疊判定。

**Rationale**：憲章原則 IV 的明文要求。

**新架構補充**：PostgreSQL 的 `date` 型別無時區成分，與 `YYYY-MM-DD` 一對一對應。
後端 MUST 使用 `datetime.date`，MUST NOT 經過 `datetime.datetime` 或帶時區的轉換；
序列化為 JSON 時 MUST 輸出 `YYYY-MM-DD` 字串。前端 MUST NOT 用 `new Date(str)` 解析
日曆日——該建構式會依瀏覽器時區位移一天。

### B2-d. 模擬付款與退款

介面呈現付款方式，但明確標示為虛擬，絕不儲存或索取真實金融資訊。

**Rationale**：憲章原則 VI。**認證為真、付款為假，兩者 MUST 分別標示**，
避免使用者由「登入是真的」推論「付款也是真的」。此規定 MUST NOT 因改用真實後端而放寬——
反而因為現在真的有伺服器會收到這些欄位而更重要。
