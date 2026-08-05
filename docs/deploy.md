# 部署：DigitalOcean

把 Sunny 訂房平台放上公網的完整步驟。照著做一次大約 60–90 分鐘。

資料庫在步驟 1 有兩條路：**1A** DigitalOcean Managed Postgres（每月 15 美元，
等叢集建立約佔 10 分鐘）或 **1B** Supabase（免費）。**其餘步驟兩條路完全相同**，
差異只在步驟 1 與步驟 4.3 要填的值。

## 架構

**前端與 API 在同一台機器、同一個主機名稱上**，路徑分流。

```
                              瀏覽器
                                 │ HTTPS
                                 │   自有網域：Cloudflare 只做 DNS（灰雲）
                                 │   sunny.odootpe.org  ── A ──▶ Reserved IP
                                 │
                                 │   沒有網域才需要：Cloudflare Worker 轉發
                                 │   sddhotel.<帳號>.workers.dev    ← 步驟 5
                                 ▼
                        DigitalOcean Droplet
                        Caddy :443（自動簽憑證）
                                 │
        ┌────────────────────────┼────────────────────────┐
        │ /                      │ /api/*                 │ /uploads/*
        ▼                        ▼                        ▼
  /srv/frontend            剝掉 /api 前綴       uvicorn :8000（FastAPI）
  React SPA 靜態檔                └────────────────────────┘
  （烤在映像裡）                              │ 加密連線（ssl=require）
                                              ▼
                                     託管 PostgreSQL（步驟 1 二選一）
                                     1A  DO Managed  …ondigitalocean.com:25060
                                     1B  Supabase    …pooler.supabase.com:5432
```

## 為什麼前端不放 CDN

放 CDN（Cloudflare Pages、Workers、Netlify⋯⋯）確實更快、而且免費，但那表示
前端與 API 是**兩個來源**，而這個專案有三個具體問題是那個前提造出來的：

1. **房源照片會全部變破圖。** 後端寫進 `rooms.images` 的是 `/uploads/<uuid>.jpg`
   ——一個**同源的絕對路徑**（`services/room_photos.py` 的 `PUBLIC_PREFIX`）。
   開發時 Vite 的 proxy 把它轉給 FastAPI 所以看不出問題；放到 CDN 上，那個路徑
   指向 CDN 而不是後端，於是要另外替 CDN 寫一份跨網域轉址規則。
2. **重新整理任何非首頁的網址會得到 404。** React Router 是前端路由，
   `/rooms/123` 在 CDN 上沒有對應檔案，要另外設 SPA fallback，而每一家的設法
   都不一樣。（2026-08-05 實測：Cloudflare Workers 的 Static Assets **不支援**
   `_redirects` 裡 `/*  /index.html  200` 這種 200 rewrite，只吃真正的轉址，
   症狀就是首頁正常但 `/rooms` 回 404。）
3. **CORS。** 多一份 `CORS_ORIGINS` 要跟前端網址保持同步，而填錯的症狀是
   「後端日誌顯示 200，瀏覽器卻說網路錯誤」。

三個都有解，但三個都只在正式環境出現、都不會給出指向真正原因的錯誤訊息，
而且第 1 與第 2 項**首頁看起來完全正常**——要點進內頁或按 F5 才會發現。
同源讓它們結構上不存在：`/uploads` 真的是同源、SPA fallback 由 Caddy 的
`try_files` 處理、瀏覽器根本不會發出跨來源請求。

代價是靜態檔由這台 Droplet 出流量，而且更新前端要重新建置映像（多花一兩分鐘）。
以這個專案的量級都不是問題；日後真的需要 CDN，把網域掛上 Cloudflare 走 proxy
模式即可，這裡的架構不用動。

> **那步驟 5 的 Worker 算不算「放 CDN」？** 不算，差別是關鍵的。那支 Worker
> 只是**轉發**，前端檔案仍然只有 Droplet 上那一份，瀏覽器看到的也仍然只有一個
> 來源。上面三個問題全部來自「前端檔案住在另一個網域、由另一套規則提供」，
> 而那正是它沒有做的事。

## 為什麼用 Droplet 而不是 App Platform

因為上傳的照片。`main.py` 的 `_mount_uploads` 把 `UPLOAD_DIR` 直接掛成靜態目錄，
管理員上傳的房源照片與品質檢測圖存在本機磁碟上。

DigitalOcean 官方文件明訂 App Platform 的檔案系統是**暫時性的、不支援 volume**，
容器每次重新部署都會重建。於是每次部署後：`rooms.images` 裡的
`/uploads/<uuid>.jpg` 還在，磁碟上的檔案沒了。API 全部回 200、資料完全正確、
沒有任何錯誤訊息，只有房源頁上一排破圖。

要用 App Platform 就得改寫 `services/room_photos.py` 去接 DO Spaces——那是另一件事。
Droplet 掛一個 Docker volume 就解決了，而且更便宜。

## 費用（2026-08 的牌價，僅供估算）

| 項目 | 規格 | 月費（USD） |
|---|---|---|
| Droplet | Basic Regular 1 vCPU / 1 GB / 25 GB | 6 |
| 資料庫 — 1A：DO Managed Postgres | Basic 1 vCPU / 1 GB / 10 GB | 15 |
| 資料庫 — 1B：Supabase | 免費方案 | 0 |
| Reserved IP | 綁在執行中的 Droplet 上 | 0 |

資料庫二選一，見步驟 1。選 1B 的話全套是每月 6 美元，代價是沒有自動備份、
且免費專案閒置 7 天會被暫停。

第三條路是在同一台 Droplet 上跑 Postgres 容器（同樣省下 15 美元），
但那樣一樣沒有自動備份與版本升級，而且要跟 uvicorn、Caddy 搶那 1 GB 記憶體，
本文不涵蓋。

---

## 步驟 0：先決定兩件事

### (a) 站台的主機名稱

前後端同源，所以只有**一個**名稱要決定，而它會出現在五個地方：`./.env` 的
`APP_HOSTNAME`、`backend/.env` 的 `FRONTEND_BASE_URL`、`CORS_ORIGINS`、
`GOOGLE_REDIRECT_URI`，以及 Let's Encrypt 的憑證。先決定好可以少繞一圈。

兩條路，詳見步驟 3：

- **有自己的網域**（本專案的情況）→ 掛在 Cloudflare 上加一筆 A 記錄。
- **沒有網域** → 用 sslip.io 這種把 IP 編進名稱裡的免費 DNS 頂著。

以下都以本專案實際使用的 `sunny.odootpe.org` 為例。

⚠️ **要用 Google 登入就 MUST 走第一條路。** Google 對 `sslip.io`、`workers.dev`、
`pages.dev` 這類公共後綴網域的授權有額外限制，可能直接拒絕註冊回呼網址——
那不是設定錯誤，是改設定也繞不過去的限制。

### (b) 後台要不要公開

`seed.py` 建立的管理員帳號是 `admin@sunny.com` / `admin123`。這組帳密：

- 印在登入頁上（**FR-005 的 MUST**）
- 寫在 README 裡
- 存在於這個 GitHub 儲存庫的歷史中
- **而本專案沒有任何修改密碼的端點**——上線後沒有辦法從網站內改掉它

也就是說，站台一放上公網，任何看過的人都能用它登入並取得全部 31 個管理端點。
以下是 2026-08-05 在實際部署上以那組公開帳密從外部驗證過的結果，不是推測：

| 讀 | 寫 |
|---|---|
| 全部用戶（email、電話、姓名） | 改房價、房況、房源內容 |
| 全部訂單與營收數字 | 改訂單狀態 |
| 全部客服訊息討論串 | 核准／駁回退款 |
| 稽核日誌 | 刪除／核准評論、代店家回覆 |
| 各模組資料匯出 | 改首頁內容、上傳照片 |
| | `POST /admin/reset-demo-data`：**清空全部業務資料** |
| | `PATCH /admin/users/{id}/role`：**升降任何人的角色** |

#### 怎麼選

**展示／作業型專案（本專案的預設情境）選 (A) 公開。** 理由不是「風險可以接受」，
而是三件具體的事：

1. **FR-005 是 MUST。** 選 (B) 等於違反自己的規格，要嘛先改規格。
2. **資料庫裡沒有真人資料。** seed 產生的示範帳號、假訂單、假評論，而 FR-006 又
   要求登入頁明示「本站為展示用、勿使用真實密碼」、付款頁標示虛擬支付。隱私
   損害是零——這跟一個真的有客戶的訂房站不是同一件事。
3. **最壞情況五秒內可修復。** 有人按了重置，你也按一次重置，示範資料就回來了
   ——同一支端點既是破壞工具也是修復工具。

**有真實使用者資料就選 (B)，沒有第二種答案。** 屆時 FR-005 與 FR-006 這組
「這是展示站」的前提已經不成立，規格本身就該改。

#### 選 (A) 的話，兩件事要知道

⚠️ **被清空是無聲的。** 沒有通知、沒有錯誤、網站照常運作，只是首頁內容回到預設
值、訂單列表換成另一批。**正式展示或交件前先自己開一次網站看一眼**，那是唯一的
偵測方式。

⚠️ **角色升降是唯一會留下後門的操作。** `PATCH /admin/users/{id}/role` 只擋
「管理員把自己降級」（`routers/admin_users.py`），不擋升級別人。因此有人可以：
註冊自己的帳號 → 用公開的 demo 管理員登入 → 把自己升成 admin。**之後就算改掉
demo 管理員的密碼，那個帳號仍然是管理員。** 偶爾看一下 `/admin/users`，
出現不認識的 admin 就降回 member。

#### 兩個選項的設定

**(A) 公開後台。** `backend/.env` 的 `SEED_ADMIN_*` 留空，前端也不要設
`VITE_HIDE_ADMIN_DEMO`。維持現狀，什麼都不用做。

**(B) 不公開後台。** 兩邊都要設：

- `backend/.env`：`SEED_ADMIN_EMAIL` 與 `SEED_ADMIN_PASSWORD` 填自己的值
- `./.env`：`VITE_HIDE_ADMIN_DEMO=true`

⚠️ 後者是**建置時**才會被讀進去的（compose 把它當 build arg 傳給
`deploy/Dockerfile`）。改完 MUST `docker compose up -d --build`，
單純 `up -d` 或 `restart` 都不會讓它生效，而且不會有任何錯誤訊息——
登入頁上那張卡片只是原封不動地還在。

⚠️ **只做一邊沒有意義。** 只隱藏卡片不改密碼，藏起來的只是提示、不是入口；
只改密碼不隱藏卡片，登入頁會印著一組已經失效的密碼，訪客點下去登入失敗，
看起來像網站壞了。

#### 上線後還能不能改主意

能，但代價是**現在就要付的**，而且方向違反直覺。

`SEED_ADMIN_*` 只在 `seed.py` 執行時被讀取，改了環境變數不會動到資料庫裡既有的
帳號——**必須重跑一次 seed**。而 `seed.py` 的 `_reset_business_data()` 會刪掉
messages／refunds／reviews／favorites／room_risk_checks／channel_prices／
orders／rooms 全部八張表，並把 `site_content` 重設為預設值。

也就是說：**為了防止別人清空資料，你得先自己清空一次。** 站台開得愈久、累積的
訂單與內容編輯愈多，這個代價愈高。要改就趁早。

（`admin_logs` 不會被清除——FR-116 的僅可新增優先於 FR-073 的「還原所有資料」，
見 `seed.py` 的 `_reset_business_data` 說明。）

---

## 步驟 1：資料庫

這一步有兩條路。**其餘所有步驟兩條路完全相同**，差異只在這裡以及步驟 4.3 要填的值。

| | 1A：DO Managed Postgres | 1B：Supabase |
|---|---|---|
| 月費 | 15 USD | 0（免費方案） |
| 自動備份 | 有，保留 7 天 | 免費方案無 |
| 閒置處理 | 無 | **7 天無活動會暫停**，要手動恢復 |
| 與 Droplet 同區域 | 自己選，可以做到 | 專案建好後**不能改區域** |
| 本文驗證程度 | 完整 | 2026-08-05 實際部署驗證過 |

**沒有既有 Supabase 專案、又不在意每月 15 美元 → 選 1A。** 步驟最少，區域可控。

**專案原本就是 Supabase 起家（本專案的情況）、或不想付費 → 選 1B。**
`backend/src/sunny/config.py` 把連線資訊拆成元件，兩者都支援；初始 revision 的
T019a 甚至已經預先處理了 Supabase 的 `anon`／`authenticated` 角色。

---

### 1A：建立 DigitalOcean Managed Postgres

DigitalOcean 控制台 → **Databases** → Create Database Cluster。

| 欄位 | 值 | 說明 |
|---|---|---|
| Engine | PostgreSQL 16 或更新 | `gen_random_uuid()` 內建，不需要 pgcrypto |
| Region | Singapore (sgp1) | ⚠️ MUST 與稍後的 Droplet **同一個區域** |
| Plan | Basic / 1 GB RAM | 展示用足夠 |

同區域不是效能偏好而已：跨區域的流量走公網、要另外計費，而且延遲會讓每一次
頁面載入都變慢。

建好後（約 5–10 分鐘）進入 **Connection details**，把右上角切到 `doadmin` 使用者，
記下這幾個值——步驟 4 要填進 `backend/.env`：

- `host`（形如 `xxx.b.db.ondigitalocean.com`）
- `port` — ⚠️ **是 25060，不是 5432**
- `database` — ⚠️ **是 `defaultdb`，不是 `postgres`**
- `password`

⚠️ **不要用 Connection string 那一欄整條複製。** 本專案刻意把連線資訊拆成元件
（見 `backend/src/sunny/config.py` 的說明）：密碼裡的 `@` `/` `:` `#` 在 URL 裡會
改變語意，而拼錯的症狀是 DNS 失敗，看起來跟密碼毫無關係。逐欄填，密碼填原樣、
不要自己做 URL 編碼。

⚠️ **不要執行 `supabase/reset-legacy.sql`。** 那支腳本的用途是把既有的 Supabase
專案清成乾淨狀態，新建的 DO 資料庫本來就是乾淨的。對已有資料的資料庫執行它會刪光資料。

---

### 1B：使用 Supabase

Supabase 控制台 → 沿用既有專案，或 Create new project。新建時 **Region 盡量與
Droplet 同區域**（專案建好後不能改）；不同區域不會壞掉，只是每次查詢多跨一段公網。

#### ⚠️ MUST 用 Session Pooler，這一項沒有替代方案

Dashboard 右上 **Connect** 有三種連線方式，只有一種可用：

| 方式 | 位址 | 可否使用 |
|---|---|---|
| Direct connection | `db.<ref>.supabase.co:5432` | ❌ 免費方案**只有 IPv6**。DigitalOcean 的 Droplet 預設沒有 global IPv6（2026-08-05 於 sgp1 實測確認），連不上 |
| Transaction pooler | `...pooler.supabase.com:6543` | ❌ 不支援 prepared statements，而 asyncpg 依賴它 |
| **Session pooler** | `...pooler.supabase.com:5432` | ✅ **用這個。** 有 IPv4，行為等同直連 |

兩種錯誤的失敗方式都不會指向真正的原因：

- 直連 → `getaddrinfo failed` 或連線逾時，看起來像網路或防火牆問題
- Transaction pooler → 零星的 `prepared statement "__asyncpg_x__" does not exist`，
  看起來像程式碼 bug。**而且不是每次都失敗**，所以很容易被當成偶發問題放過

先驗證這台 Droplet 連得到（不需要密碼）：

```bash
getent ahostsv4 aws-1-<區域>.pooler.supabase.com    # 要有 IPv4 位址
```

#### ⚠️ 使用者名稱 MUST 帶專案 ref

走 pooler 時，Supavisor 靠使用者名稱裡的後綴決定路由到哪個租戶。
**擁有者與應用角色兩個都要帶**：

```
本機 Postgres    DB_OWNER_USER=postgres          DB_APP_USER=sunny_app
Supabase pooler  DB_OWNER_USER=postgres.<ref>    DB_APP_USER=sunny_app.<ref>
```

資料庫裡的角色名仍然是 `sunny_app`——帶 ref 的只是連線時報上的名字。
少了後綴會回 `tenant/user not found`，那句訊息看起來跟這個設定毫無關係。

#### 步驟 4.3 要填的值

| 欄位 | 1A（DO Managed） | 1B（Supabase Session Pooler） |
|---|---|---|
| `DB_HOST` | `<叢集>.b.db.ondigitalocean.com` | `aws-1-<區域>.pooler.supabase.com` |
| `DB_PORT` | `25060` | **`5432`** |
| `DB_NAME` | `defaultdb` | **`postgres`** |
| `DB_OWNER_USER` | `doadmin` | `postgres.<ref>` |
| `DB_APP_USER` | `sunny_app` | `sunny_app.<ref>` |
| `DB_SSLMODE` | `require` | `require` |

密碼是專案的 **Database Password**（建立專案時設定的那組）。與 1A 相同，
**逐欄填、填原樣**，不要整條複製 Connection string、也不要自己做 URL 編碼。

#### ⚠️ 跑完遷移後要關 PostgREST 那扇門

Supabase 對 `public` schema 設了

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
```

因此 Alembic 建立的新表會**自動繼承**這組授權。舊架構靠 RLS 擋住 anon key
（該 key 設計上可公開，防護來自 RLS 而非保密），而新架構把 RLS 全數移除——
兩者相加的結果是任何人拿著那把公開的 anon key，就能經由 PostgREST 讀寫全部
十二張表，包含 `profiles` 與 `admin_logs`。

初始 revision 的 T019a 會 REVOKE 掉 `anon` / `authenticated` 的權限與預設權限，
這是程式面。設定面還要做一次：**Dashboard → Settings → API，把 `public` 自
Exposed schemas 移除。** 兩道一起關上。

驗證（應為 0）：

```sql
select count(*) from information_schema.role_table_grants
where grantee in ('anon','authenticated') and table_schema = 'public';
```

#### ⚠️ 既有專案才需要注意的兩件事

**先確認資料庫還在不在舊架構上。** 若 `public.profiles` 已經有 `email` /
`password_hash` / `google_sub` 欄位，且 `public.alembic_version` 存在，
表示遷移**早就跑過了**，步驟 4.4 的 `alembic upgrade head` 會是 no-op，
而 `python -m sunny.seed` 會**刪掉現有的業務資料**（見下）。

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='profiles';
select version_num from public.alembic_version;   -- 不存在則是舊架構
```

**`supabase/reset-legacy.sql` 會刪光資料。** 它的用途是把仍在舊架構的專案清成
乾淨狀態。資料要保留就不能跑它——先自行匯出，或把舊表 `alter table ... set
schema` 搬到另一個 schema 保存。

#### 免費方案的兩個限制

- **閒置 7 天會暫停專案**，要到 Dashboard 手動恢復。展示期間有人在用不會觸發，
  但放著一陣子再給人看，會發現整站掛掉而後端日誌只有連線逾時。
- 沒有自動備份。重要資料自行 `pg_dump`。

---

## 步驟 2：建立 Droplet

### 2.1 建立機器

控制台 → **Droplets** → Create。

| 欄位 | 值 |
|---|---|
| Region | ⚠️ **與資料庫同一區域** |
| Image | Ubuntu 24.04 LTS |
| Size | Basic / Regular / 1 GB RAM |
| Authentication | **SSH Key**（不要用密碼） |
| Hostname | `sunny` |

1 GB 跑得動這個站台，但**建置前端時不夠用**——那一步要開 swap，見 2.5。
不想處理 swap 就選 2 GB（每月多 6 美元）。

### 2.2 配一個 Reserved IP

Droplet 建好後 → 該 Droplet 的 **Networking** → Reserved IP → Assign。

⚠️ **這一步不要跳過。** 步驟 3 的主機名稱會把 IP 編進去，Droplet 重建或搬移後
若換了 IP，網站會以「憑證主機名稱不符」的方式壞掉，而且要重新申請憑證。
Reserved IP 綁在執行中的 Droplet 上是免費的。

記下這個 IP，以下以 `203.0.113.5` 為例。

⚠️ **`203.0.113.5` 是 RFC 5737 保留給文件用的位址，不會路由到任何機器。**
它在本文裡純粹是佔位符——每次看到它，都要換成你自己那個 Reserved IP。照抄的
症狀是 DNS 查得到、Caddy 也在跑，但 TLS 交握直接被切斷。

### 2.3 防火牆

控制台 → **Networking** → Firewalls → Create Firewall，套用到這台 Droplet：

| 方向 | Protocol | Port | Sources |
|---|---|---|---|
| Inbound | TCP | 22 | ⚠️ 只填你自己的 IP，不要用 All IPv4 |
| Inbound | TCP | 80 | All IPv4 / All IPv6 |
| Inbound | TCP | 443 | All IPv4 / All IPv6 |
| Inbound | UDP | 443 | All IPv4 / All IPv6 |
| Outbound | 全部 | 全部 | 全部 |

⚠️ **80 port MUST 開放，即使網站只走 443。** Let's Encrypt 的 HTTP-01 挑戰走 80。
擋掉它的話憑證永遠簽不下來，而 Caddy 容器的狀態會是 `running`——
只有日誌裡反覆出現逾時。

UDP 443 是 HTTP/3。不開也能用，只是每個連線都會先試 h3 失敗再退回 h2。

### 2.4 讓資料庫接受這台機器

**選 1A（DO Managed Postgres）才需要這一步。**

回到 **Databases** → 你的叢集 → **Settings** → **Trusted sources** → Edit，
把剛才那台 Droplet 加進去。

⚠️ 這一步漏掉，步驟 4 的 `alembic upgrade head` 會在連線階段就卡住，
錯誤訊息是逾時，看起來像網路不通或密碼錯誤，不會提到 trusted sources。

**選 1B（Supabase）跳過。** Supabase 的 pooler 對外開放，不需要把來源 IP
加入白名單——換句話說，防護完全來自密碼，因此 `DB_OWNER_PASSWORD` 不要用
弱密碼，也不要跟其他地方共用。

### 2.5 開一塊 swap

**選 1 GB 的機器就 MUST 做這一步**，否則步驟 4.4 建置前端時會失敗。

前端的建置（`tsc -b && vite build`）尖峰要一點多 GB 的記憶體。1 GB 的 Droplet
預設**沒有 swap**，於是 Linux 的 OOM killer 會直接砍掉 node，而 docker build
只會印出一個 `Killed`、退出碼 137——**不會提到記憶體**，看起來像建置指令壞了
或是 npm 有問題。

```bash
ssh root@203.0.113.5

fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab    # 重開機後仍生效
free -h                                            # Swap 那列應該是 2.0Gi
```

⚠️ 最後兩件事各有意義：少了 `/etc/fstab` 那行，重開機後 swap 就沒了，
而你要到下一次建置才會發現；`free -h` 是唯一能當場確認的方式。

swap 比記憶體慢很多，但這裡只在建置那幾分鐘用得到，平時服務跑起來不會碰它。

---

## 步驟 3：主機名稱與 HTTPS

站台需要一個公開可解析的主機名稱，Let's Encrypt 才簽得出憑證。**前端與 API
共用這一個名稱**（步驟 0(a)）。

### 3A：自己的網域（掛在 Cloudflare）

先確認網域的 nameserver 已指到 Cloudflare（後台顯示 **Active**）。然後
DNS → Records → **Add record**：

| 欄位 | 值 |
|---|---|
| Type | `A` |
| Name | `sunny`（要用根網域就填 `@`） |
| IPv4 address | 步驟 2.2 那個 **Reserved IP** |
| Proxy status | **DNS only（灰雲）** |
| TTL | Auto |

⚠️ **灰雲不是偏好問題。** 橘雲（Proxied）之後連線由 Cloudflare 代收，
Let's Encrypt 的 HTTP-01 挑戰就打不到你的 Caddy，憑證永遠簽不下來——而日誌上
只會反覆寫 `could not get certificate`，不會提到 proxy 狀態。

⚠️ **MUST NOT 加 AAAA 記錄。** 這台 Droplet 沒有 global IPv6。加了之後，支援
IPv6 的訪客會優先走那條路然後連不上，而你自己（走 IPv4）看到的網站完全正常
——這種「只有一部分人壞掉」的故障最難查。

想日後改走 Cloudflare 的 CDN／WAF，等憑證簽下來、站台跑順之後再開橘雲，
並把 SSL/TLS 加密模式設成 **Full (strict)**（設成 Flexible 會變成 Cloudflare 用
HTTP 回源、Caddy 又把它轉回 HTTPS，瀏覽器看到無窮轉址迴圈）。但續簽同樣走
HTTP-01，六十天後可能悄悄失敗，所以維持灰雲是最省事的選擇。

### 3B：還沒有網域（sslip.io）

**sslip.io** 把 IP 編進主機名稱裡，免費、免註冊，而且是真實可解析的公開 DNS。
把 IP 的點換成減號，前面接一個名字：

```
Reserved IP 203.0.113.5  →  sunny.203-0-113-5.sslip.io
```

⚠️ 這條路**沒辦法用 Google 登入**（步驟 0(a)），而且 sslip.io 整個網域偶爾會撞到
Let's Encrypt 的簽發配額——那時不是你的設定有問題，等一段時間或改用自有網域。

### 驗證（兩條路都要做）

在你自己的電腦上：

```powershell
Resolve-DnsName sunny.odootpe.org -Type A -Server 1.1.1.1
```

⚠️ **回傳的 IP 必須是你的 Reserved IP，否則不要往下做。** Caddy 會對著一個不會
回應的位址反覆挑戰，而 Let's Encrypt 對**同一個主機名稱**有每小時 5 次驗證失敗
的上限，撞到之後連設定改對了也要等。

### 日後換名稱

改 `./.env` 的 `APP_HOSTNAME`、`backend/.env` 的 `FRONTEND_BASE_URL`、
`CORS_ORIGINS`、`GOOGLE_REDIRECT_URI`，再 `docker compose up -d`。有設 Google
登入的話，Google Cloud Console 的「已授權的重新導向 URI」也要同步改。其餘不動。

同源架構下要改的就是這一份清單——不會有「前端網址改了但後端不知道」的中間狀態。

---

## 步驟 4：部署

前端與後端在這一步一起上線——`docker compose build` 會同時建置兩個映像
（`deploy/Dockerfile` 用 Node 建置 `frontend/`，再把 `dist/` 複製進 Caddy 映像）。

SSH 進 Droplet：

```bash
ssh root@203.0.113.5
```

### 4.1 安裝 Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version    # 應印出 v2.x
```

### 4.2 取得程式碼

```bash
git clone -b python-impl https://github.com/DA260526/SDDhoteltest.git /opt/sunny
cd /opt/sunny
```

⚠️ `-b python-impl`：目前的實作在這個分支上，`main` 是舊的。

### 4.3 填設定

```bash
cp .env.example .env
nano .env
```

填兩個值（第三個只有選了步驟 0(B) 才要）：

```ini
APP_HOSTNAME=sunny.odootpe.org
ACME_EMAIL=你會看的信箱@example.com
# VITE_HIDE_ADMIN_DEMO=true
```

接著是憑證：

```bash
cp backend/.env.production.example backend/.env
nano backend/.env
```

範本裡每一欄都有說明，重點只有六個：

- **連線那幾欄依你在步驟 1 選的路徑填**，兩者的值不同（host／port／database／
  使用者名稱），對照表在步驟 1 的「步驟 4.3 要填的值」。1A 是 `25060` /
  `defaultdb` / `doadmin`；1B 是 `5432` / `postgres` / `postgres.<ref>`，
  且應用角色也要帶 ref
- `DB_SSLMODE=require` — ⚠️ 留空的話 asyncpg 會嘗試加密、失敗則**靜默退回明文**，
  沒有任何警告，只是密碼與訂單資料在網路上是明文的
- `DB_APP_PASSWORD` 自己產一組，**且 MUST 在跑 alembic 之前填好**——
  `sunny_app` 這個角色的密碼是由初始 revision 從這裡讀出來設定的
- `JWT_SECRET` 至少 32 字元，且不要跟開發環境同一組
- `FRONTEND_BASE_URL` 與 `CORS_ORIGINS` 都填**瀏覽器看得到的那個來源**。
  沒有做步驟 5 就是 `https://<APP_HOSTNAME>`；做了步驟 5 就是那個
  workers.dev 網址，**不是** Droplet 的主機名稱。同源所以只有一個值
- **Google 登入是全有或全無的：`GOOGLE_CLIENT_ID` 與 `GOOGLE_CLIENT_SECRET`
  留空，那個按鈕就只會把使用者彈回登入頁。** 這是刻意的（`routers/auth.py` 的
  `_require_google_config`），不是故障——但它**不會**寫進任何日誌，站台其餘部分
  也完全正常，所以查起來很容易往網址設定的方向鑽。要開這項功能就三個值一起填：
  ⚠️ `GOOGLE_REDIRECT_URI` 是上面那個來源**加上 `/api`**
  （`https://<那個來源>/api/auth/google/callback`），理由見範本裡的說明

產生隨機值：

```bash
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 4.4 建置、遷移、種子

```bash
docker compose build

# 建表、建 gist 排除約束、建 sunny_app 角色。以擁有者身分連線
# （1A 是 doadmin，1B 是 postgres.<ref>）。
docker compose run --rm api alembic upgrade head

# 種子資料（可重複執行）
docker compose run --rm api python -m sunny.seed
```

⚠️ 順序不能顛倒：seed 需要表已經存在。

⚠️ **`docker compose build` 第一次要跑好幾分鐘**，其中前端那段（`npm ci` 與
`vite build`）佔最久。若它以 `Killed` 或 `exit code 137` 結束，那是記憶體不足，
不是建置設定有問題——回去做步驟 2.5 的 swap。

`alembic upgrade head` 的第一件事是 `create extension if not exists btree_gist`
——`orders_no_overlap` 那條「同房同日不得重複成立」的排除約束需要它。
`btree_gist` 在 DigitalOcean 與 Supabase 的支援清單內都有，以擁有者身分
（1A 是 `doadmin`、1B 是 `postgres`）執行不需要額外授權。

⚠️ **1B 若沿用既有的 Supabase 專案，先確認遷移是不是早就跑過了。** 已在 head 時
`alembic upgrade head` 是 no-op（正常結束、不報錯），而下一行的 `sunny.seed`
會**刪掉現有的業務資料**——見步驟 1B 的「既有專案才需要注意的兩件事」。

### 4.5 啟動

```bash
docker compose up -d
docker compose logs -f caddy
```

第一次啟動時 Caddy 會去申請憑證。看到 `certificate obtained successfully`
就成功了。`Ctrl-C` 離開日誌（不會停掉容器）。

驗證三條路徑各自落在對的地方：

```bash
# 前端（靜態檔）
curl -sI https://sunny.odootpe.org/ | head -1

# API（Caddy 剝掉 /api 後轉給 FastAPI）
curl -sI https://sunny.odootpe.org/api/rooms | head -1

# SPA fallback：這條路徑在磁碟上不存在，但 MUST 回 200 + HTML
curl -sI https://sunny.odootpe.org/rooms | head -1
```

三個都應該是 `HTTP/2 200`。第三個是最容易在正式環境才發現的一項——
它回 404 就表示 `try_files` 沒生效，症狀是使用者一按 F5 網站就壞掉。

有設 Google 登入的話，這一條不必真的登入就能驗完整組設定：

```bash
curl -sI https://sunny.odootpe.org/api/auth/google | grep -i location
```

要看到 `accounts.google.com/o/oauth2/v2/auth?...`，而且裡面的 `redirect_uri`
就是你填的那個（含 `/api`）。若導向的是 `/login#error=GOOGLE_NOT_CONFIGURED`，
表示 client id/secret 是空的，見步驟 4.3。

在瀏覽器打開 `https://sunny.odootpe.org/api/docs` 也應該看到互動式
API 文件（那頁會去抓根目錄的 `/openapi.json`，Caddyfile 有一條規則專門接它）。

---

## 步驟 5：Worker 前門（選用，走了步驟 3A 就跳過）

做完步驟 4，站台已經完整可用了——網址是 `https://<APP_HOSTNAME>`。這一步只解決
一件事：**想用一個好看的網址，而且還不想買網域。**

⚠️ **有自己的網域（步驟 3A）就別做這一步。** 這支 Worker 存在的唯一理由是
`*.workers.dev` 的 DNS 不能指到自己的機器；A 記錄能指了之後，它只是在每個請求
（含每一張房源照片）上多加一跳延遲與一份 Cloudflare 用量。而且 `workers.dev`
是公共後綴網域，掛了它反而讓 Google 登入無法啟用（步驟 0(a)）。

本專案已走 3A，因此**不做這一步**；下面留著給沒有網域的情況。

`*.workers.dev` 的 DNS 由 Cloudflare 掌控，**沒辦法用 A 記錄指到自己的 Droplet**。
唯一的辦法是放一支 Worker，把收到的請求原封不動轉給 Droplet 再回傳。

```
瀏覽器 ──→ sddhotel.<帳號>.workers.dev ──→ api.<ip>.sslip.io
           （Worker，只轉發）              （Caddy，做所有事）
```

### 為什麼這不會把同源架構弄壞

因為 Worker **什麼都不做**。它不處理路由、不做 SPA fallback、不剝 `/api` 前綴、
不加快取標頭——那些全部留在 Caddy。瀏覽器眼中 `/`、`/api/*`、`/uploads/*` 
統統在 `https://sddhotel.<帳號>.workers.dev` 這一個來源底下，所以同源的三個好處
原封不動：沒有 CORS、`/uploads/<uuid>.jpg` 真的是同源路徑、前端不需要
`VITE_API_BASE_URL`。

⚠️ **不要開始在 Worker 裡加邏輯。** 一旦它也處理路由，那份規則就會與
`deploy/Caddyfile` 各自演化，而分歧的症狀只會在正式環境出現。

### 部署

```bash
cd deploy/worker
npx wrangler deploy
```

⚠️ `wrangler.jsonc` 的 `name` 是 `sddhotel`，與現有那個 Worker 同名——
部署會**取代**目前跑在該網址上的舊版靜態站。這是預期行為，但它不可復原，
確認一下那個舊站沒有你還需要的東西。

`ORIGIN` 那個變數填 Droplet 的 `APP_HOSTNAME`，見 `wrangler.jsonc` 的說明。

### 三件要知道的事

⚠️ **`backend/.env` 的網址要填 workers.dev，不是 Droplet 的主機名稱。**
`FRONTEND_BASE_URL`、`CORS_ORIGINS`、`GOOGLE_REDIRECT_URI` 填的都是**瀏覽器
看得到的那個來源**。填成 Droplet 的名稱不會有錯誤訊息——直到有人用 Google 登入，
然後被丟到一個他從沒看過的網域上。

⚠️ **Droplet 仍然直接連得到。** 站台會同時存在於兩個網址。這不會壞掉任何東西
（同源在各自的網域內都成立），但分享連結時要給 workers.dev 那個，因為
`FRONTEND_BASE_URL` 指的是它。真的要擋，就把防火牆的 443 限制到 Cloudflare 的
IP 段——但設錯會把自己鎖在外面，而且 Cloudflare 的 IP 段會變。

⚠️ **每一個請求都算 Worker 的用量**，包含每一張房源照片。免費方案是每天
十萬次請求，展示用綽綽有餘，但它不是「只有 HTML 走 Worker」——是全部。

---

## 步驟 6：回填與收尾

主機名稱在步驟 3 就決定了，所以正常情況下沒有東西要回填。若當初 `backend/.env`
裡的 `FRONTEND_BASE_URL` / `CORS_ORIGINS` / `GOOGLE_REDIRECT_URI` 填錯或還沒填：

```bash
cd /opt/sunny
nano backend/.env      # 三者都要與 APP_HOSTNAME 一致
docker compose up -d   # 重新載入環境變數
```

⚠️ `docker compose restart` **不會**重新讀取 `env_file`，要用 `up -d`。
這個差別很容易踩：restart 之後容器是新的、日誌是新的，但環境變數還是舊的，
於是同一個錯誤一模一樣地繼續出現。

⚠️ 反過來，改到**前端**的東西（原始碼、`VITE_HIDE_ADMIN_DEMO`）時 `up -d`
不夠，要 `up -d --build`——前端是建置時固定下來的靜態檔。

---

## 步驟 7：上線驗收

依序做完，任何一項不過就往下一節找原因。

以下的 `<站台網址>`：沒做步驟 5 就是 `https://<APP_HOSTNAME>`，做了就是 workers.dev
那個網址。**做了步驟 5 就要用 workers.dev 那個測**，否則你驗的是沒人會用的那條路徑。

| # | 動作 | 預期 |
|---|---|---|
| 1 | 開 `<站台網址>` | 首頁載入，房源列表有內容（不是空的） |
| 2 | 直接貼 `<站台網址>/rooms`，按 F5 | 正常顯示，不是 404 |
| 3 | 用 `guest@sunny.com` / `guest123` 登入 | 成功進入 |
| 4 | 走完一次訂房流程到付款頁 | 成功建立訂單 |
| 5 | 用管理員登入 → 房源管理 → 上傳一張照片並儲存 | 上傳成功 |
| 6 | 回前台看該房源詳情頁 | ⚠️ **照片看得到，不是破圖** |
| 7 | `docker compose restart api` 後重看該頁 | 照片還在（volume 有生效） |
| 8 | 開發者工具 → Console | 沒有紅字（尤其是 CSP 擋下來的資源） |
| 9 | 有設 Google 登入才做：登入頁按「以 Google 登入」 | 到 Google 授權頁，授權後回到首頁且已登入 |

第 2 與第 6 項是最容易漏掉、又最容易只在正式環境出現的兩項——**從首頁點進去
都是好的**，要按 F5 或真的去看一張上傳的照片才會發現。

第 8 項現在要看的是 CSP 而不是 CORS（同源已經沒有 CORS 了）。Caddyfile 設了
`Content-Security-Policy`；若哪天畫面缺圖、字型變成系統明體、或整片空白，
Console 會明白寫出是哪一條指令擋的。

---

## 日後更新

### 程式碼（前後端都是同一句）

```bash
cd /opt/sunny
git pull
docker compose up -d --build
# 若這次有新的 migration：
docker compose run --rm api alembic upgrade head
```

⚠️ **`--build` 不能省。** 前端是建置時固定下來的靜態檔，少了它 Caddy 會拿著
上一次的映像繼續跑：網站正常、內容是舊的、沒有任何錯誤訊息。

裝了下一節的自動部署之後，這一段就只剩「想立刻生效、不等那兩分鐘」時才用得到。

### 自動部署（push 到 GitHub 就會更新網站）

Droplet 每兩分鐘問一次 origin 有沒有新 commit，有的話就自己跑一次上面那組指令。

**為什麼是輪詢，而不是 GitHub Actions。** Actions 得把 Droplet 的 SSH 私鑰放進
GitHub Secrets 並讓 SSH port 對 runner 開放；webhook 得多跑一個常駐服務、多開
一條對外路徑。輪詢是 Droplet **主動出去拉**：沒有金鑰外流、沒有新的 inbound
表面，代價只有最多兩分鐘的延遲。

三個檔案都在版控裡，Droplet 上只要把 unit 連過去：

```bash
cd /opt/sunny
git pull

# ⚠️ 這一次 MUST 手動建置一輪，往後才不用。
#
# 原因是上面那句 `git pull` 已經讓工作區跟 origin 一致了，而自動部署的判斷
# 依據正是「兩者不一致」——它接手後只會看到沒有差異，於是什麼都不做。若這台
# 機器目前跑的映像落後於 repo（多半如此，畢竟正是為此才要裝自動部署），
# 那個落差會就這樣留著，直到下一次有人推 commit 才被順手補上。
docker compose up -d --build

# ⚠️ 用 symlink 而不是 cp。複製過去的話，日後改了 repo 裡的 unit 檔，
#    systemd 讀的還是當初那份副本——而且沒有任何跡象顯示兩者已經不同。
sudo ln -sf /opt/sunny/deploy/sunny-update.service /etc/systemd/system/
sudo ln -sf /opt/sunny/deploy/sunny-update.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now sunny-update.timer
```

確認它活著：

```bash
systemctl list-timers sunny-update.timer   # 下次觸發時間
sudo systemctl start sunny-update.service  # 立刻跑一次，不等排程
journalctl -u sunny-update.service -n 50   # 它做了什麼
journalctl -u sunny-update.service -f      # 部署進行中就盯這個
```

沒有更新時它只做一次 `git fetch` 就結束，所以兩分鐘一次並不昂貴；真的有更新
時才會建置。**migration 會自動套用**（`alembic upgrade head`，冪等），因為另一
個選擇更糟：程式碼更新了、schema 沒有，網站會在使用者面前噴 500。不要的話在
`.service` 裡加 `Environment=SUNNY_AUTO_MIGRATE=0`。

⚠️ **正式機上 MUST NOT 直接改進版控的檔案。** 腳本偵測到工作區有未提交的修改
時會整輪放棄並在 journal 裡列出是哪些檔案——這是刻意的，自動把它丟掉等於在無人
看著的時候消滅唯一一份修改。改完記得 commit 或還原，否則自動部署會一直停在
那裡（`systemctl --failed` 看得到）。

要暫停自動部署（例如正在手動除錯）：

```bash
sudo systemctl stop sunny-update.timer     # 這次開機期間停用
sudo systemctl disable sunny-update.timer  # 連開機自啟也取消
```

### 資料庫備份

**1A：** DO Managed Postgres 預設每日自動備份、保留 7 天，在叢集的 **Backups** 頁。
不需要額外設定，但值得進去確認它真的開著。

**1B：** Supabase 免費方案**沒有自動備份**，Dashboard 的 Backups 頁在免費方案
也不提供下載。要備份就自己跑，例如每週一次：

```bash
pg_dump "postgresql://postgres.<ref>:<密碼>@aws-1-<區域>.pooler.supabase.com:5432/postgres" \
  --schema=public --no-owner --no-privileges --file=sunny-$(date +%F).sql
```

⚠️ **上傳的照片不在備份範圍內。** 它們在 Droplet 的 Docker volume 裡。
要備份：

```bash
docker run --rm -v sunny_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 卡住時看這裡

以下每一項都是「不會給出指向真正原因的錯誤訊息」的那種問題。

### 憑證一直簽不下來

`docker compose logs caddy` 反覆出現逾時或 `could not get certificate`。

1. 防火牆的 **80 port** 有沒有開？HTTP-01 挑戰走 80，即使最終服務在 443
2. `APP_HOSTNAME` 解析到的 IP 是不是這台機器？`Resolve-DnsName` 確認。
   ⚠️ 特別確認它不是 `203.0.113.5`——那是本文的範例位址，照抄過的話 DNS 查得到
   但沒有任何機器會回應
3. Cloudflare 那筆 A 記錄是不是設成了橘雲（Proxied）？MUST 改成 **DNS only**，
   否則挑戰打不到 Caddy
4. **容器裡的 `APP_HOSTNAME` 跟檔案裡寫的是不是同一個？**

   ```bash
   docker compose exec caddy printenv APP_HOSTNAME
   ```

   不一致就表示上次是用 `docker compose restart` 套用的——它**不重讀 `env_file`**，
   容器是新的、日誌是新的、環境變數還是舊的。改用 `docker compose up -d`

判斷「Caddy 到底有沒有在嘗試簽這個名字」有一個很快的方法：從外面打挑戰路徑。

```bash
curl -sI http://<你的主機名稱>/.well-known/acme-challenge/probe
```

正在簽的 Caddy 會在 **port 80 直接回答**這個路徑（404 或 200 都算）。若它回
**308 轉去 HTTPS**，表示這個主機名稱根本不在 Caddy 的設定裡——它沒有在簽任何
東西，問題在 `APP_HOSTNAME`，不在 DNS 或防火牆。

### 「以 Google 登入」按了就回到登入頁

畫面上出現「本站尚未啟用 Google 登入，請以電子郵件與密碼登入」。

**這不是故障，是 `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET` 沒填。**
`routers/auth.py` 的 `_require_google_config` 在兩者任一為空時就把使用者導回
登入頁——**不寫日誌、不回錯誤碼**，站台其餘部分完全正常。

```bash
grep -E '^GOOGLE_CLIENT_(ID|SECRET)=' backend/.env | awk -F= '{print $1"= 長度 " length($2)}'
```

長度 0 就是這個原因。填好之後 `docker compose up -d`。

其餘 Google 登入的症狀各自對應不同的地方：

| 症狀 | 原因 |
|---|---|
| Google 顯示 `redirect_uri_mismatch` | Console 的「已授權的重新導向 URI」與 `GOOGLE_REDIRECT_URI` 不是逐字相同（scheme、`/api`、結尾斜線都算） |
| 授權完卡在轉圈，**後端日誌一片空白** | `GOOGLE_REDIRECT_URI` 漏了 `/api`。那條路徑對外是 SPA 路由，Google 把人送回來時拿到的是 `index.html`，請求根本沒進後端 |
| 登入成功卻被丟到另一個網域 | `FRONTEND_BASE_URL` 還是舊值 |
| Console 不讓你存這個回呼網址 | 主機名稱是公共後綴網域（`sslip.io`／`workers.dev`／`pages.dev`）。改設定繞不過去，見步驟 0(a) |
4. sslip.io 整個網域偶爾會撞到 Let's Encrypt 的週配額。若日誌明確寫 rate limit，
   那不是你的設定問題，等一段時間或改用自己的網域

### 網站沒有跟著更新（畫面停在舊版）

症狀是「新功能在本機好好的，線上看不到」，而且**沒有任何錯誤訊息**——舊版本
本身是正常的網站。先確認線上跑的到底是哪一版，不必開瀏覽器：

```bash
# index.html 引用的 bundle 檔名帶內容雜湊，改版必換
curl -s https://<你的主機名稱>/ | grep -o '/assets/index-[^"]*\.js'

# 直接在產物裡找新功能的字串（換成該版新增的文字即可）
curl -s https://<你的主機名稱>/assets/index-<hash>.js | grep -c '某個新字串'
```

抓到 0 就是線上跑著舊建置。往下查：

1. commit 推上去了嗎——`git branch -r --contains <sha>`
2. Droplet 拉到了嗎——`cd /opt/sunny && git log --oneline -1`
3. 自動部署卡住了嗎——`systemctl --failed`、`journalctl -u sunny-update.service -n 50`。
   最常見的是正式機上有未提交的本機修改，腳本因此整輪放棄（見「自動部署」）
4. 手動部署時漏了 `--build`——症狀完全一樣

⚠️ 順帶一提，`public/` 底下的檔案（例如 `wr-widget.js`）沒部署到時**不會回
404**：Caddyfile 的 SPA catch-all 會把 `index.html` 交出去。看到 `200` 別急著
放心，要看 `Content-Type` 是不是 `text/html`。

### 前端一片空白

打開開發者工具 Console：

- **CSP 擋下 script** → 建置產物開始內嵌 `<script>` 了。該處理的是那件事，
  不是把 `deploy/Caddyfile` 的 `script-src` 放寬
- **一批 assets 404** → 拿到的是舊的 `index.html`。Caddyfile 對它設了
  `Cache-Control: no-cache`，所以正常情況不該發生；先強制重新整理
  （Ctrl-F5）確認是不是快取，再看 `docker compose logs caddy`
- **什麼都沒有，連 HTML 都不是** → `docker compose exec caddy ls /srv/frontend`
  有東西嗎？沒有的話是建置階段沒產出 `dist/`（回頭看 `docker compose build` 的輸出）

### API 全部 404 或回傳 HTML

前端呼叫 `/api/...` 卻拿到 `index.html`（Network 分頁看 Content-Type 是
`text/html`），表示請求落到了 SPA 的 catch-all 而不是後端。

1. `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`
2. Caddyfile 裡 `handle_path /api/*` MUST 在最後那個沒有匹配條件的 `handle`
   **之前**——handle 之間照書寫順序比對，catch-all 放前面會把所有東西都吃掉
3. `curl -sI https://<你的主機名稱>/api/rooms` 直接確認

### 房源照片全是破圖

1. 直接開 `https://<你的主機名稱>/uploads/<檔名>` 看得到嗎？
2. 看得到 → 問題在前端拿到的路徑，檢查 `rooms.images` 的值
3. 看不到 → 問題在後端：volume 沒掛上，或檔案真的不存在
   （`docker compose exec api ls -la /app/uploads`）

### 照片上傳成功但一重新部署就消失

`docker-compose.yml` 的 `uploads:/app/uploads` volume 沒生效，
或 `backend/.env` 裡覆寫了 `UPLOAD_DIR` 指到別的路徑。檢查：

```bash
docker compose exec api sh -c 'echo $UPLOAD_DIR; ls -la /app/uploads'
docker volume ls | grep uploads
```

### alembic 連不上資料庫

- `DB_SSLMODE=require` 有填嗎？兩條路徑都只接受加密連線
- **1A：** 資料庫的 **Trusted sources** 有沒有加這台 Droplet？
  `DB_PORT` 是 25060 嗎？`DB_NAME` 是 `defaultdb` 嗎？
- **1B：** `DB_HOST` 是 `...pooler.supabase.com` 而不是 `db.<ref>.supabase.co` 嗎？
  後者只有 IPv6，Droplet 連不上，症狀是逾時或 `getaddrinfo failed`。
  `DB_PORT` 是 **5432**（Session pooler）而不是 6543（Transaction pooler）嗎？
  `DB_OWNER_USER` / `DB_APP_USER` 兩個都帶了 `.<專案ref>` 嗎？少了會回
  `tenant/user not found`

### `password authentication failed for user "sunny_app"`

`DB_APP_PASSWORD` 是在 `alembic upgrade head` **之後**才改的。
那個角色的密碼由初始 revision 從這個變數讀出來設定，事後改變數不會改到資料庫。

⚠️ **「重跑一次 `alembic upgrade head`」只在資料庫還沒到 head 時有效。**
2026-08-05 實際踩到：資料庫已在 `0002`，重跑是 no-op——alembic 不會重新執行
已套用的 revision，於是那句 `alter role ... password` 根本沒有機會執行，
而指令本身正常結束、沒有任何錯誤訊息，看起來像修好了。

先確認版本：

```bash
docker compose run --rm api alembic current
```

- **不在 head** → 重跑 `docker compose run --rm api alembic upgrade head`
- **已在 head** → 以擁有者身分手動補上那一句，也就是該 revision 會做的事：

  ```bash
  psql "$OWNER_DSN" -c "alter role sunny_app login password '<DB_APP_PASSWORD 的值>';"
  ```

  ⚠️ 角色名是 `sunny_app`，**不帶專案 ref**。`.<ref>` 後綴只是連線時向
  Supabase 的 pooler 報上的名字，不是資料庫裡的角色名。

  ⚠️ 若走 Supabase pooler：Supavisor 會快取憑證，改完約十秒後才生效。
  中間那一次仍然失敗是快取，不是設定又錯了——不要在那十秒內再改一次。

### 訂房時出現「已無空房」但明明沒人訂

`btree_gist` 或 `orders_no_overlap` 沒建起來時症狀相反——超賣不會報錯，
只會安靜地發生。若看到的是這個訊息，先確認日期與夜數，再懷疑約束。

```bash
docker compose run --rm api python -c "
import asyncio
from sqlalchemy import text
from sunny.db import get_session_factory
async def main():
    async with get_session_factory()() as s:
        r = await s.execute(text(
            \"select conname from pg_constraint where conname = 'orders_no_overlap'\"))
        print(r.fetchall())
asyncio.run(main())
"
```

---

## 相關檔案

| 檔案 | 用途 |
|---|---|
| [`backend/Dockerfile`](../backend/Dockerfile) | 後端映像。建置脈絡是專案根目錄 |
| [`deploy/Dockerfile`](../deploy/Dockerfile) | 前端建置 + Caddy 映像。脈絡同樣是專案根目錄 |
| [`deploy/Caddyfile`](../deploy/Caddyfile) | TLS 終結、路徑分流、CSP |
| [`docker-compose.yml`](../docker-compose.yml) | 兩個映像 + uploads volume |
| [`deploy/auto-update.sh`](../deploy/auto-update.sh) | 自動部署。比對 origin，有新 commit 才建置 |
| [`deploy/sunny-update.service`](../deploy/sunny-update.service) | 上面那支腳本的 systemd 執行單元 |
| [`deploy/sunny-update.timer`](../deploy/sunny-update.timer) | 每兩分鐘觸發一次 |
| [`deploy/worker/worker.js`](../deploy/worker/worker.js) | 步驟 5 的 Worker 前門。只轉發 |
| [`deploy/worker/wrangler.jsonc`](../deploy/worker/wrangler.jsonc) | Worker 的名稱與 `ORIGIN` |
| [`.env.example`](../.env.example) | compose 用的非機密參數範本 |
| [`backend/.env.production.example`](../backend/.env.production.example) | 後端憑證範本 |
