# 自動化測試

兩層，各有不同的約束（憲章 2.6.0「關於自動化測試」）。

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

### 兩個環境上的坑

**無頭 Chrome 的 dialog 事件不穩定。** 實測會出現「對話框沒觸發、`window.confirm`
直接回 false」，讓測試誤判成功能壞掉。harness 一律把 `window.confirm` 換成樁，
「使用者按確定／按取消」因此變成明確可控的輸入。

**無頭 Chrome 會取消實際下載。** 匯出測試改看 CDP 的 `downloadWillBegin` 事件，
不看檔案系統。

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
