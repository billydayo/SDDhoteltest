# 自動化測試

三層，各有不同的約束（憲章 2.6.0「關於自動化測試」）。

**自動化測試不取代 [`browser-acceptance.md`](../specs/001-booking-site/checklists/browser-acceptance.md)。**
版面、對比、照片好不好看這類需要人眼判斷的項目，仍以手動驗收把關。

---

## 第一層：單元測試（零依賴）

純函式與判定規則。**開瀏覽器就跑，不需要 Node、不需要 npm install。**

```
python -m http.server 8000      # 或任何靜態伺服器
```

開 <http://127.0.0.1:8000/tests/index.html>。全綠即通過。

檔案：`index.html`、`runner.js`（約 130 行的執行器）、`unit.js`（測試本體）。

這一層**刻意不碰 repository**——那會寫入 localStorage，跑一次測試就把示範資料
重置掉。需要真實資料流的情境交給第二層。

## 第二層：端對端測試（Node + 無頭瀏覽器）

真的開 Chrome、真的點按鈕、真的比對畫面與資料庫。

```
cd tests
npm install        # 只裝 puppeteer-core，不會下載 Chromium
npm run serve      # 另開一個終端機：起靜態伺服器於 :8000
npm test
```

找不到瀏覽器時設環境變數：`CHROME_PATH=/path/to/chrome npm test`。
伺服器不在 8000 時設 `SUNNY_BASE=http://127.0.0.1:5500`。

| 指令 | 內容 |
| --- | --- |
| `npm test` | 全部 |
| `npm run test:unit` | 在無頭瀏覽器裡跑第一層，結果收進同一個出口 |
| `npm run test:search` | 首頁搜尋與篩選（**資料庫模式**） |
| `npm run test:orders` | 會員端訂單、取消（示範模式） |
| `npm run test:admin` | 逐日房態、七模組匯出、設施／特色增刪 |
| `npm run test:photos` | 房源照片管理、上傳邊界、訂單的房源篩選 |
| `npm run test:google` | Google 第三方登入的導向、取消與示範模式停用 |
| `npm run test:messaging` | 私訊、評論回覆、待付款訂單的取消入口 |
| `npm run test:rls` | 第三層：權限邊界（見下） |

### 主控台的錯誤與警告（SC-014 / T118）

harness 除了未捕捉的例外，也收 `console.error` 與 `console.warn`，
每個區段結束時當成一項斷言檢查。這一項原本靠人眼看 DevTools，
「兩模式零錯誤零警告」因此從宣稱變成會失敗的測試。

真正修不掉、又不是本專案造成的訊息（無頭 Chrome 的 favicon 404）
列在 `harness.mjs` 的 `CONSOLE_NOISE`。某一支測試自己刻意製造的雜訊
用 `openPage({ allowConsole: [...] })` 就地放行，並在該處寫清楚原因——
`google-auth` 的中止導覽與 `photos` 的孤兒檔探測都屬於這類。
**來自 `src/` 的錯誤或警告不該進白名單**，那是要修的東西。

---

## 第三層：權限邊界（Node，不開瀏覽器）

```
npm run test:rls
```

`rest/boundaries.rest.mjs`，50 項。直接以真實帳號打 PostgREST 與 Auth，
驗 RLS 政策、守門 trigger 與稽核不可竄改：匿名可讀範圍、未公開評論對匿名
不可見、會員讀不到他人的訂單／收藏／討論串（指名 ID 也不行）、會員無法
自行升權、稽核日誌連管理員都改不動也刪不掉、日誌不含密碼或金鑰、
訊息送出後不可修改不可刪除、評論回覆由伺服器蓋章。

**為什麼不用瀏覽器**：這一層要驗的正是「繞過前端直接打資料庫」。
Puppeteer 測得到畫面上按不到，測不到有人拿 anon key 自己發請求——
而那才是 RLS 要擋的攻擊面。原本這些項目寫在
`supabase/migrate-messages.sql` 末端當人工清單，現在可以重跑。

幾個刻意的設計：

- **PGRST\* 的錯誤不算「被擋下」。** 欄位名打錯會回 400 PGRST204，
  若把它當成權限擋住，日後一次改欄位名就會讓一整批安全斷言默默變成假通過。
- **不能只看狀態碼。** 政策的 `USING` 讓某列對該身分不可見時，PostgREST 回的是
  200／204 加上「影響 0 列」，不是 42501。所以每個寫入嘗試都另外回頭讀一次資料。
- **改動一律還原。** 評論回覆測完就清空；萬一 RLS 真的有洞讓房價被改成 1，
  測試會把原價寫回去——找到漏洞是它的職責，順手破壞資料不是。
- **`SUNNY_RLS_SKIP_APPEND=1`** 會略過「偽造 sender_role 被蓋回 member」那一項。
  該項必須真的插入成功才驗得到 trigger，而 messages 依設計只增不刪
  （沒有 delete 政策，任何身分都刪不掉），所以每跑一次就會在示範會員的
  討論串多留一則標示為 `[自動測試]` 的訊息。

這一層在示範模式下沒有意義（沒有資料庫），`src/config.js` 憑證為空時會直接跳過。

### 哪些跑在哪個模式，為什麼

`search` 跑**資料庫模式**，因為它守的三個 bug 在示範模式下測不出來——
local adapter 是在記憶體裡用 JS 過濾，踩不到 PostgREST 的語法問題：

- 關鍵字含逗號 → `or()` 邏輯樹解析失敗，畫面顯示「操作未能完成」
- 設施篩選傳 JS 陣列 → jsonb 欄位收到 Postgres 陣列語法，400
- 三欄無條件必填 → 只想用設施篩選的人按下搜尋完全沒有反應

`orders` 與詞彙寫入跑**示範模式**：它們會真的取消訂單、真的改詞彙表，
不該在正式資料上留下痕跡。切換方式是攔截 `src/config.js` 回傳空憑證，
不需要改動任何專案檔。

`photos` 兩種模式都用。照片管理與訂單篩選在示範模式做——那些操作會真的改
房源的 `images` 並存檔。但上傳邊界（孤兒檔清除 FR-050f、會員直傳被擋 FR-050e）
在示範模式下根本不存在：那裡把圖存成 data URL，沒有 bucket 也沒有 RLS。
因此那三項跑資料庫模式，並自建一間 `__e2e 臨時房源（可刪）`，做完就刪，
全程不碰正式房源的照片。測試用的圖片由 `e2e/fixtures.mjs` 當場產生
（單色 PNG，顏色不同才分辨得出排序），輸出在 `.tmp/`，不進版本控制。

`google` 兩種模式都用，但**不會真的連到 Google**。主框架一旦要離開本站就攔下來，
記錄網址後以 `abort('aborted')` 取消；因此測得到 client_id、回呼位址與授權範圍，
卻不產生任何真實的授權請求，也不建立帳號。示範模式那半段驗證按鈕停用（FR-089）
與服務層的第二道防線。

完成授權之後的兩件事——登入成功導回原頁、同信箱不產生第二個帳號
（FR-088／SC-025）——**自動化測不到**，需要一組真實 Google 帳密，
留在 `browser-acceptance.md` 由人工把關。

### 三個環境上的坑

**無頭 Chrome 的 dialog 事件不穩定。** 實測會出現「對話框沒觸發、`window.confirm`
直接回 false」，讓測試誤判成功能壞掉。harness 一律把 `window.confirm` 換成樁，
「使用者按確定／按取消」因此變成明確可控的輸入。

**無頭 Chrome 會取消實際下載。** 匯出測試改看 CDP 的 `downloadWillBegin` 事件，
不看檔案系統。

**`HeadlessChrome` 這個 User-Agent 會被圖床擋掉。** 房源照片允許填外部網址，
而有些 CDN 的機器人防護看到 HeadlessChrome 會直接切斷連線——不是回 403，
是連回應都不給，Chrome 報成 `ERR_HTTP2_PROTOCOL_ERROR`。加上主控台檢查之後，
這會把一張真人看得到的好照片誤報成故障（實測 13w.com.tw 的 Winho-CDN：
HeadlessChrome → 斷線，一般 Chrome UA → 200）。因此 harness 把 UA 裡的
`HeadlessChrome` 換成 `Chrome`。這不是為了規避偵測，是為了讓外部資源的
載入結果與真人瀏覽一致，否則主控台檢查會一直產生假警報。

`messaging` 跑**示範模式**：它會真的送出訊息、真的公開一則評論回覆、真的取消訂單。
私訊的權限邊界（會員讀不到他人的討論串、前端無法偽造 sender_role）在資料庫模式
是由 RLS 與 `stamp_message_sender` trigger 執行的，那一層由
`supabase/migrate-messages.sql` 末端的驗證清單以 SQL 驗——瀏覽器測不到
「繞過前端直接寫入」的情形。

---

## 依憲章的界線

- `tests/` 的依賴 **MUST NOT** 被應用程式的任何模組 import
- 刪掉整個 `tests/` 目錄，應用仍須完整可用
- 應用程式本身維持零建置：`index.html` 的載入路徑不經過任何測試工具
