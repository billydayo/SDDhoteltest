# Sunny 訂房平台

一個以純前端、瀏覽器本地儲存為核心的飯店訂房展示型專案。此專案模擬會員註冊／登入、房源瀏覽與搜尋、訂房流程、退款審核、評論審核、後台管理，以及照片風險評估等功能。

## 專案特點

- 純前端：使用 HTML、CSS、JavaScript，不依賴前端框架與建置工具
- 本地儲存：所有資料使用 `localStorage` 保存，適合展示與原型驗證
- 單一入口：直接開啟 `index.html` 即可使用
- 示範模式：若未填寫 Supabase 憑證，系統會自動進入示範模式，資料保存在瀏覽器 `localStorage`，功能完整且不連接任何伺服器
- 模擬交易：登入、付款、退款均為展示用模擬流程，不涉及真實金流
- 雙平台體驗：支援桌機與行動裝置瀏覽

## 功能範圍

- 訪客首頁與房源搜尋/篩選
- 房源詳情頁
- 會員註冊、登入、帳戶設定
- 三步驟訂房流程
- 虛擬付款選項（LINE Pay / 信用卡 / 銀行轉帳）
- 我的訂單與退款申請
- 評論撰寫與後台審核
- 管理員後台（儀表板、房源、訂單、會員、內容編輯）
- 照片風險評分（僅於瀏覽器內處理）
- 報表匯出（Excel / CSV fallback）

## 專案結構

```text
SDDhoteltest/
├── README.md
├── index.html
├── styles/
├── src/
├── specs/
│   └── 001-booking-site/
│       ├── spec.md
│       ├── plan.md
│       ├── research.md
│       ├── data-model.md
│       ├── quickstart.md
│       ├── contracts/
│       └── checklists/
├── .specify/
└── .claude/
```

## 啟動方式

### 方式 1：直接開啟

1. 進入專案根目錄
2. 雙擊開啟 `index.html`
3. 在瀏覽器中直接使用

### 方式 2：本地靜態伺服器

在專案根目錄執行：

```bash
python -m http.server 8000
```

之後在瀏覽器開啟：

```text
http://localhost:8000/
```

## 測試帳號

- 會員：`guest@sunny.com` / `guest123`
- 管理員：`admin@sunny.com` / `admin123`

> 這些帳號僅為展示用途，請勿輸入真實密碼或真實金融資訊。

## 開發限制

- 不使用 React、Vue、Angular 等前端框架
- 不使用 npm install / build tool
- 若未配置 Supabase 憑證，系統自動進入示範模式，不連接任何伺服器
- 所有資料存放在瀏覽器 `localStorage`
- 不串接真實付款、真實身分驗證或真實外部 API
- 照片分析只在瀏覽器內執行，不上傳任何外部服務

## 參考文件

- 規格文件：`specs/001-booking-site/spec.md`
- 實作計畫：`specs/001-booking-site/plan.md`
- 研究紀錄：`specs/001-booking-site/research.md`
- 快速驗收：`specs/001-booking-site/quickstart.md`

## 注意事項

此專案屬於展示型原型，主要目標是驗證使用者流程、互動邏輯與 RWD 體驗，而不是正式商業系統部署方案。
