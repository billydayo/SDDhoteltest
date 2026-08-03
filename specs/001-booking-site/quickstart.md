# Quickstart: Sunny 訂房平台

**Date**: 2026-08-03 | **Plan**: [plan.md](./plan.md) | **憲章**: v3.1.1

> **Revision 2026-08-03**：前一版有「示範模式（零設定、直接開 `index.html`）」與
> 「資料庫模式」兩種啟動方式。示範模式已隨憲章 v3.0.0 移除——**現在必須啟動
> 資料庫與後端才能使用**。這是換取真實授權邊界所付出的代價，已於憲章記錄。

## Prerequisites

| 項目 | 版本 | 備註 |
|---|---|---|
| PostgreSQL | 14+ | MUST 支援 `btree_gist` 擴充 |
| Python | 3.12+ | |
| uv | 最新 | 後端套件管理；`pip install uv` 或見官方安裝方式 |
| Node.js | 20+ | 隨附 npm |

**為什麼 PostgreSQL 不能換成 SQLite**：房況保證依賴 `EXCLUDE USING gist` 與
`daterange`，這是 PostgreSQL 特有能力（憲章原則 IV）。換掉資料庫等於拿掉那條保證。

---

## 1. 資料庫

```bash
createdb sunny
psql sunny -c "create extension if not exists btree_gist;"
```

`btree_gist` 是 `orders_no_overlap` 約束中 `room_id with =` 等值比對的前提。
Alembic 的初始 revision 會再建立一次（idempotent），此處先建可讓失敗提早出現。

## 2. 後端

```bash
cd backend
cp .env.example .env      # 填入 DATABASE_URL、JWT_SECRET 等
uv sync                   # 依 uv.lock 建立環境
uv run alembic upgrade head
uv run python -m sunny.seed          # 種子資料（可重複執行）
uv run uvicorn sunny.main:app --reload --port 8000
```

**環境變數 MUST 齊全才會啟動。** 缺少必要變數時應用會在啟動時明確失敗，
**不會以預設值靜默啟動**（憲章後端約束）。`JWT_SECRET` 尤其沒有 fallback——
「沒設就用預設值」等同於公開秘鑰。

驗證：開啟 <http://localhost:8000/docs>，應看到互動式 OpenAPI 文件。

## 3. 前端

```bash
cd frontend
npm ci                    # 依 package-lock.json 安裝
npm run dev               # 預設 http://localhost:5173
```

用 `npm ci` 而非 `npm install`：前者嚴格依 lockfile 安裝，後者可能更新它。

`VITE_API_BASE_URL` 指向後端（預設 `http://localhost:8000`）。
**只有公開資訊可用 `VITE_` 前綴**——該前綴的變數會被寫進建置產物。

---

## 4. 驗證情境

以下情境證明關鍵保證確實成立。全部 MUST 通過才算環境正常。

### V1. 登入與角色

```
guest@sunny.com / guest123    → 會員
admin@sunny.com / admin123    → 管理員
```

**預期**：
- 兩者皆能登入
- 會員身分開啟任一後台頁面 → **被擋下**（403，非只是畫面隱藏）
- 登入頁顯示「本站為展示用專案，請勿使用你在其他網站的真實密碼」

**同時驗證**：以 `psql` 查 `select password_hash from profiles limit 1;`
應看到 argon2 雜湊（`$argon2id$...` 開頭），**不是明文**（FR-009a）。

### V2. 房況保證（最重要的一項）

開兩個終端，同時對**同一房源、同一日期區間**送出訂單：

```bash
curl -X POST localhost:8000/orders -H "Authorization: Bearer $T" \
  -d '{"roomId":"...","checkIn":"2026-09-01","checkOut":"2026-09-03",...}' &
curl -X POST localhost:8000/orders -H "Authorization: Bearer $T2" \
  -d '{"roomId":"...","checkIn":"2026-09-02","checkOut":"2026-09-04",...}' &
```

**預期**：恰有一筆 201，另一筆 **409** 且訊息為「此房源於所選日期已無空房」。

若兩筆都成立 → `orders_no_overlap` 約束沒建起來。
若第二筆回 500 → 例外轉譯沒做。兩者都是必須修的環境問題。

### V3. 相鄰不重疊

建立 `2026-09-01` → `2026-09-03`，再建立 `2026-09-03` → `2026-09-05`。

**預期**：兩筆**都成立**。半開區間 `[)` 讓「前一筆退房日 = 後一筆入住日」不算重疊。
若第二筆被拒，代表區間邊界寫成了閉區間。

### V4. 越權存取

以會員 A 的 token 讀取會員 B 的訂單：

```bash
curl localhost:8000/orders/{B的訂單id} -H "Authorization: Bearer $TOKEN_A"
```

**預期**：**403**。移除 RLS 後這是唯一的邊界（[research R1](./research.md)），
必須實測，不能只看程式碼。

再試不帶 token：**預期 401**。

### V5. 逾期釋出

1. 將 `system_settings` 的保留分鐘數暫時調為 1
2. 建立訂單但不付款
3. 等 1 分鐘後重新搜尋該房源該區間

**預期**：該區間重新可訂。訂單狀態轉為 `cancelled`。

**注意**：釋出的可觀察時點是「下一次有人查詢時」，不是到期的那一秒——
本專案不使用排程作業（憲章原則 IV）。若不重新查詢，狀態不會自己變。

### V6. 稽核日誌不可竄改

```sql
update admin_logs set action = 'tampered' where id = (select id from admin_logs limit 1);
delete from admin_logs;
```

**預期**：兩者皆**失敗**（權限不足）。

⚠️ 這一項最容易在遷移中失守。RLS 被移除時，原本靠「沒有 UPDATE/DELETE 政策」
達成的保證會一併消失且**不會有任何錯誤訊息**——日誌只是安靜地變得可以改。
現在改由 `REVOKE UPDATE, DELETE ON admin_logs` 承擔（[data-model](./data-model.md)）。

### V7. 前台照片不離開瀏覽器

1. 開啟前台「安全檢測」頁
2. 開啟瀏覽器開發者工具的 Network 分頁
3. 上傳一張照片並執行分析

**預期**：**沒有任何夾帶該照片內容的請求送出**（FR-086、SC-015、SC-030）。
分析結果直接顯示，全程在 Canvas 內完成。

同時查 `select count(*) from room_risk_checks;` — 數字 MUST 不變。

### V8. 付款為模擬

完成一次訂房並「付款」。

**預期**：付款畫面明顯標示「虛擬支付，不會產生任何實際交易」；
不索取真實卡號、有效期限、CVV 或銀行帳號。

---

## 5. 測試

```bash
# 後端：原則 IV 的每一條規則 + 每個端點的授權三案例
cd backend && uv run pytest

# 前端單元
cd frontend && npm run test

# 端對端
cd tests && npm test
```

**授權測試的判準**：每個受保護端點 MUST 有三個案例——未認證、以他人身分、
以正確身分。憲章明訂「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」。

---

## 疑難排解

| 症狀 | 原因 |
|---|---|
| `alembic upgrade` 於建立排除約束時失敗 | `btree_gist` 未建立。見步驟 1 |
| 兩筆衝突訂單都成立 | `orders_no_overlap` 不存在。檢查初始 revision 是否含該 `op.execute()` |
| 衝突訂房回 500 而非 409 | 例外未轉譯，或比對的是例外型別而非約束名稱 |
| 日期顯示少一天 | 前端用了 `new Date("YYYY-MM-DD")`——該建構式視字串為 UTC |
| 啟動時報缺少環境變數 | 這是預期行為。補齊 `.env`，不要加預設值繞過 |
| 前端 401 後停在空白畫面 | `api/client.ts` 的 401 攔截未實作（FR-009d） |

## 尚不存在

本 quickstart 描述的是**目標狀態**。截至 2026-08-03，`backend/` 與 `frontend/`
尚未建立——技術選型與設計已定案，實作待 `/speckit-tasks` 產出任務後開始。
現行可執行的仍是舊版原生 JS 實作（`index.html` + `src/`），該版本已不符憲章 v3.x，
於新實作通過驗收後移除。
