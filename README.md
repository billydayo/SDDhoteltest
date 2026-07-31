# Sunny 訂房平台

一個以原生 HTML／CSS／JavaScript 打造、不使用框架與建置工具的飯店訂房展示型專案。
資料層採用 **Supabase**（託管 Postgres + Auth）；未設定憑證時自動退回瀏覽器
`localStorage` 示範模式。專案模擬會員註冊／登入、房源瀏覽與搜尋、訂房流程、退款審核、
評論審核、後台管理，以及照片風險評估等功能。

## 專案特點

- **零建置**：不使用框架與打包工具，不需要 `npm install`，直接開啟 `index.html` 即可
- **雲端資料**：預設以 Supabase 保存資料，同一帳號可跨裝置取得相同的訂單與個人資料
- **真實權限**：存取控制由 Postgres Row Level Security 強制執行，而非只靠前端隱藏畫面
- **示範模式**：未填寫 Supabase 憑證時自動進入示範模式，資料保存在瀏覽器
  `localStorage`，功能完整且**不發出任何網路請求**
- **模擬交易**：付款與退款在任何模式下都是展示用模擬，不涉及真實金流
- **雙平台體驗**：支援桌機與行動裝置瀏覽

## 兩種執行模式

| 模式 | 條件 | 資料位置 | 認證 | 權限 |
|---|---|---|---|---|
| **資料庫模式**（預設） | `src/config.js` 已填憑證 | Supabase Postgres | Supabase Auth（真實） | RLS + 前端 |
| **示範模式** | `src/config.js` 留空 | 瀏覽器 `localStorage` | 模擬登入 | 僅前端 |

兩種模式的使用者可見行為一致，差異僅在跨裝置同步、認證真偽與連線失敗處理。

## 功能範圍

**前台**

- 房源搜尋與篩選（關鍵字、日期、人數、價格上限、設施條件、房型特色）
- 房源詳情頁，含設施、特色、評論與房源品質檢測結果
- 會員註冊、登入（含 Google 第三方登入）、帳戶設定
- 收藏房源
- 三步驟訂房流程，訂單保留 1 小時，逾期自動釋出
- 虛擬付款選項（LINE Pay / 信用卡 / 銀行轉帳）
- 我的訂單與退款申請
- 評論撰寫（送出後經規則式自動審核 + 管理員複核）
- 前台安全檢測：照片僅於瀏覽器內分析，不會上傳
- 服務條款與隱私聲明

**後台（十一個模組）**

儀表板、房源管理、訂單管理（含營運指標）、用戶管理、評論審核、退款審核、
報表匯出（Excel / CSV fallback）、內容編輯、管理員操作日誌、
渠道比價與控價、系統與參數設定。

## 模擬功能的誠實聲明

本專案是展示型原型。以下三項在介面上都有明確標示，請勿誤認為真實服務：

| 功能 | 實際做法 | 為什麼 |
|---|---|---|
| 付款與退款 | 純模擬，不涉及任何金流 | 展示專案不應處理真實交易 |
| 渠道比價與控價 | 外部平台價格為種子資料 | 瀏覽器無法定時跨網域爬取；伺服器端爬取需自建後端，且可能違反對方服務條款 |
| 評論「AI 審核」 | 瀏覽器內的規則式引擎，標示為「自動審核（規則式）」 | 呼叫 AI 服務需要金鑰，前端無處可安全存放 |

反之，**登入與權限在資料庫模式下是真實的**：密碼由 Supabase Auth 雜湊保管，
存取邊界由 Postgres Row Level Security 強制執行。

## 專案結構

```text
SDDhoteltest/
├── README.md
├── index.html
├── styles/
├── src/
│   ├── config.js            # 憑證設定，預設留空 = 示範模式
│   ├── lib/supabase.js
│   ├── data/
│   │   ├── repository.js    # 唯一的資料存取入口
│   │   └── adapters/        # supabase.js / local.js
│   ├── services/ pages/ components/ state/ utils/
│   └── main.js
├── supabase/
│   ├── schema.sql           # 十一張表、約束、trigger、RLS 政策、Storage
│   └── seed.sql             # 示範房源、網站內容與模擬渠道價格
├── specs/
│   └── 001-booking-site/
│       ├── spec.md
│       ├── plan.md
│       ├── research.md
│       ├── data-model.md
│       ├── quickstart.md
│       ├── tasks.md
│       ├── contracts/
│       └── checklists/
├── .specify/
└── .claude/
```

## 啟動方式

### 示範模式（零設定）

直接雙擊開啟 `index.html`，或在專案根目錄執行：

```bash
python -m http.server 8000
```

然後開啟 `http://localhost:8000/`。介面會顯示「示範模式」標示。

### 資料庫模式（Supabase）

1. 建立 Supabase 專案，並於 Authentication → Providers → Email 關閉 "Confirm email"
2. （選用）於 Authentication → Providers → Google 啟用第三方登入
3. 於 SQL Editor 依序執行 `supabase/schema.sql` 與 `supabase/seed.sql`
4. 於 Authentication → Users 建立示範帳號，並執行 `schema.sql` 末端的 UPDATE 指定管理員
5. 將 Project URL 與 **anon** key 填入 `src/config.js`
6. 以上述任一方式開啟 `index.html`

完整步驟見 [快速上手指南](specs/001-booking-site/quickstart.md)。

## 測試帳號

- 會員：`guest@sunny.com` / `guest123`
- 管理員：`admin@sunny.com` / `admin123`

> 這些帳號僅為展示用途。本站為展示專案，請勿使用你在其他網站的真實密碼，
> 也請勿輸入真實金融資訊。

## 開發限制

- 不使用 React、Vue、Angular 等前端框架
- 不使用 npm install 或任何打包／建置工具
- 不自建後端伺服器；Supabase 由瀏覽器直接呼叫
- 不使用 Edge Function、Database Webhook、排程作業或爬蟲
- 前端只使用 anon key；`service_role` key 不得出現於程式碼或版本控制
- `public` schema 下每張資料表都必須啟用 RLS 並具備明確政策
- 操作日誌僅可新增，任何角色（含管理員）都不得修改或刪除
- 憑證只從 `src/config.js` 讀取，不讀 `.env`（無建置步驟的瀏覽器讀不到環境變數）
- 未配置憑證時自動進入示範模式，不連接任何伺服器
- 不串接真實付款、真實金流，也不呼叫任何 OTA 平台或 AI 服務
- 前台使用者上傳的檢測照片只在瀏覽器內處理，不上傳至任何服務或資料表；
  僅管理員對自家房源的檢測圖會存入雲端並公開顯示

## 參考文件

- 專案憲章：[`.specify/memory/constitution.md`](.specify/memory/constitution.md)（v2.3.0）
- 規格文件：[`specs/001-booking-site/spec.md`](specs/001-booking-site/spec.md)
- 實作計畫：[`specs/001-booking-site/plan.md`](specs/001-booking-site/plan.md)
- 研究紀錄：[`specs/001-booking-site/research.md`](specs/001-booking-site/research.md)
- 資料模型：[`specs/001-booking-site/data-model.md`](specs/001-booking-site/data-model.md)
- 介面契約：[`specs/001-booking-site/contracts/README.md`](specs/001-booking-site/contracts/README.md)
- 任務清單：[`specs/001-booking-site/tasks.md`](specs/001-booking-site/tasks.md)
- 快速驗收：[`specs/001-booking-site/quickstart.md`](specs/001-booking-site/quickstart.md)

## 注意事項

此專案屬於展示型原型，主要目標是驗證使用者流程、互動邏輯與 RWD 體驗，而不是正式商業
系統部署方案。登入與權限在資料庫模式下是真實的，但付款與退款始終是模擬的。
