# 部署：Cloudflare Pages + DigitalOcean

把 Sunny 訂房平台放上公網的完整步驟。照著做一次大約 60–90 分鐘，
其中等待 DigitalOcean 建立資料庫叢集約佔 10 分鐘。

## 架構

```
                       瀏覽器
                          │
        ┌─────────────────┴──────────────────┐
        │ HTTPS                              │ HTTPS
        ▼                                    ▼
  Cloudflare Pages                    DigitalOcean Droplet
  <專案>.pages.dev                     Caddy :443（自動簽憑證）
  frontend/dist 靜態檔                        │ 反向代理
  （React SPA）                         uvicorn :8000（FastAPI）
                                              │ 加密連線（ssl=require）
                                              ▼
                                    DigitalOcean Managed Postgres
                                    <叢集>.b.db.ondigitalocean.com:25060
```

前端是純靜態檔，放 CDN 最省事也最快；後端要跑 Python、要接資料庫、
還要留住管理員上傳的照片，需要一台真的機器。

## 為什麼後端用 Droplet 而不是 App Platform

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
| Managed Postgres | Basic 1 vCPU / 1 GB / 10 GB | 15 |
| Reserved IP | 綁在執行中的 Droplet 上 | 0 |
| Cloudflare Pages | 靜態網站，免費方案 | 0 |

若只是短期展示，Managed Postgres 可以改成在同一台 Droplet 上跑 Postgres 容器，
省下 15 美元；但那樣就沒有自動備份與版本升級，且本文不涵蓋。

---

## 步驟 0：先決定兩件事

### (a) Cloudflare Pages 的專案名稱

它直接決定前端網址：專案叫 `sunny-hotel`，網址就是 `https://sunny-hotel.pages.dev`。
後端的 `CORS_ORIGINS` 與 `FRONTEND_BASE_URL` 都要填這個值，先決定好可以少繞一圈。

以下都以 `sunny-hotel` 為例。

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
- Cloudflare Pages 環境變數：`VITE_HIDE_ADMIN_DEMO=true`

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

## 步驟 1：建立 Managed Postgres

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

## 步驟 2：建立 Droplet

### 2.1 建立機器

控制台 → **Droplets** → Create。

| 欄位 | 值 |
|---|---|
| Region | ⚠️ **與資料庫同一區域** |
| Image | Ubuntu 24.04 LTS |
| Size | Basic / Regular / 1 GB RAM |
| Authentication | **SSH Key**（不要用密碼） |
| Hostname | `sunny-api` |

### 2.2 配一個 Reserved IP

Droplet 建好後 → 該 Droplet 的 **Networking** → Reserved IP → Assign。

⚠️ **這一步不要跳過。** 步驟 3 的主機名稱會把 IP 編進去，Droplet 重建或搬移後
若換了 IP，網站會以「憑證主機名稱不符」的方式壞掉，而且要重新申請憑證。
Reserved IP 綁在執行中的 Droplet 上是免費的。

記下這個 IP，以下以 `203.0.113.5` 為例。

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

回到 **Databases** → 你的叢集 → **Settings** → **Trusted sources** → Edit，
把剛才那台 Droplet 加進去。

⚠️ 這一步漏掉，步驟 4 的 `alembic upgrade head` 會在連線階段就卡住，
錯誤訊息是逾時，看起來像網路不通或密碼錯誤，不會提到 trusted sources。

---

## 步驟 3：主機名稱與 HTTPS

後端需要一個公開可解析的主機名稱，Let's Encrypt 才簽得出憑證，
瀏覽器才不會因為 mixed content 擋掉從 HTTPS 頁面發往 HTTP 的請求。

你還沒有網域，所以用 **sslip.io**：它把 IP 編進主機名稱裡，
免費、免註冊，而且是真實可解析的公開 DNS。把 IP 的點換成減號，前面接一個名字：

```
Reserved IP 203.0.113.5  →  api.203-0-113-5.sslip.io
```

驗證一下（在你自己的電腦上）：

```powershell
Resolve-DnsName api.203-0-113-5.sslip.io
```

應該回傳 `203.0.113.5`。

> **之後買了網域怎麼辦**
>
> 把網域加進 Cloudflare，新增一筆 A 記錄 `api → 203.0.113.5`，
> **並把該筆記錄的 proxy 狀態設為 DNS only（灰雲）**——橘雲會讓 Cloudflare 代收
> 連線，Let's Encrypt 的 HTTP-01 挑戰就打不到你的 Caddy 了。
> 然後改 `./.env` 的 `API_HOSTNAME`、`docker compose up -d`，
> 再更新 Pages 的 `VITE_API_BASE_URL` 與後端的 `CORS_ORIGINS`。其餘不動。

---

## 步驟 4：部署後端

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

填兩個值：

```ini
API_HOSTNAME=api.203-0-113-5.sslip.io
ACME_EMAIL=你會看的信箱@example.com
```

接著是憑證：

```bash
cp backend/.env.production.example backend/.env
nano backend/.env
```

範本裡每一欄都有說明，重點只有五個：

- `DB_PORT=25060`、`DB_NAME=defaultdb`（不是 5432 / postgres）
- `DB_SSLMODE=require` — ⚠️ 留空的話 asyncpg 會嘗試加密、失敗則**靜默退回明文**，
  沒有任何警告，只是密碼與訂單資料在網路上是明文的
- `DB_APP_PASSWORD` 自己產一組，**且 MUST 在跑 alembic 之前填好**——
  `sunny_app` 這個角色的密碼是由初始 revision 從這裡讀出來設定的
- `JWT_SECRET` 至少 32 字元，且不要跟開發環境同一組
- `CORS_ORIGINS` 與 `FRONTEND_BASE_URL` 填 `https://sunny-hotel.pages.dev`

產生隨機值：

```bash
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 4.4 建置、遷移、種子

```bash
docker compose build

# 建表、建 gist 排除約束、建 sunny_app 角色。以 doadmin（擁有者）身分連線。
docker compose run --rm api alembic upgrade head

# 種子資料（可重複執行）
docker compose run --rm api python -m sunny.seed
```

⚠️ 順序不能顛倒：seed 需要表已經存在。

`alembic upgrade head` 的第一件事是 `create extension if not exists btree_gist`
——`orders_no_overlap` 那條「同房同日不得重複成立」的排除約束需要它。
`btree_gist` 在 DigitalOcean 的支援清單內，以 `doadmin` 身分執行不需要額外授權。

### 4.5 啟動

```bash
docker compose up -d
docker compose logs -f caddy
```

第一次啟動時 Caddy 會去申請憑證。看到 `certificate obtained successfully`
就成功了。`Ctrl-C` 離開日誌（不會停掉容器）。

驗證：

```bash
curl -I https://api.203-0-113-5.sslip.io/openapi.json
```

應該回 `HTTP/2 200`。在瀏覽器打開
`https://api.203-0-113-5.sslip.io/docs` 也應該看到互動式 API 文件。

---

## 步驟 5：部署前端到 Cloudflare Pages

Cloudflare 控制台 → **Workers & Pages** → Create → **Pages** → Connect to Git，
授權 GitHub 並選擇 `DA260526/SDDhoteltest`。

設定：

| 欄位 | 值 |
|---|---|
| Project name | `sunny-hotel` |
| Production branch | `python-impl` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory (advanced) | `frontend` |

環境變數（Settings → Environment variables → **Production**）：

| 變數 | 值 |
|---|---|
| `VITE_API_BASE_URL` | `https://api.203-0-113-5.sslip.io` |
| `NODE_VERSION` | `22` |
| `VITE_HIDE_ADMIN_DEMO` | `true`（只有選了步驟 0(B) 才設） |

⚠️ `NODE_VERSION` 要設。Pages 的預設 Node 版本可能低於 Vite 8 的要求，
而失敗訊息是一串 esbuild 的語法錯誤，看起來像程式碼壞了。

⚠️ `VITE_API_BASE_URL` MUST 是 `https://`、結尾不加斜線、不帶路徑。
從 HTTPS 頁面對 `http://` 發請求會被瀏覽器當成 mixed content 直接擋掉，
而**後端日誌上會一片空白**，因為那些請求根本沒送出去。

按 Save and Deploy。

### 這一步順帶修好的兩個問題

`npm run build` 之後會自動執行 `scripts/build-redirects.mjs`，
用 `VITE_API_BASE_URL` 產生 `dist/_redirects`：

```
/uploads/*  https://api.203-0-113-5.sslip.io/uploads/:splat  302
/*  /index.html  200
```

第一條解決房源照片。後端存進 `rooms.images` 的是 `/uploads/<uuid>.jpg`，
一個**同源的絕對路徑**——開發時 Vite proxy 轉給 FastAPI 所以看不出問題，
但正式環境它會指向 Pages。Pages 上沒有這個檔案，catch-all 會回一份 `index.html`，
瀏覽器拿到 `text/html` 卻要當圖片畫，結果是破圖。

第二條解決重新整理。React Router 是前端路由，`/rooms/123` 在 Pages 上沒有對應檔案；
從首頁點過去沒事，但重新整理或直接貼網址會落到伺服器上而得到 404。

---

## 步驟 6：回填與收尾

如果步驟 4 填 `CORS_ORIGINS` 時還不確定 Pages 的網址，現在補上：

```bash
cd /opt/sunny
nano backend/.env      # CORS_ORIGINS 與 FRONTEND_BASE_URL
docker compose up -d   # 重新載入環境變數
```

⚠️ `docker compose restart` **不會**重新讀取 `env_file`，要用 `up -d`。
這個差別很容易踩：restart 之後容器是新的、日誌是新的，但環境變數還是舊的，
於是 CORS 錯誤一模一樣地繼續出現。

---

## 步驟 7：上線驗收

依序做完，任何一項不過就往下一節找原因。

| # | 動作 | 預期 |
|---|---|---|
| 1 | 開 `https://sunny-hotel.pages.dev` | 首頁載入，房源列表有內容（不是空的） |
| 2 | 直接貼 `https://sunny-hotel.pages.dev/rooms`，按 F5 | 正常顯示，不是 404 |
| 3 | 用 `guest@sunny.com` / `guest123` 登入 | 成功進入 |
| 4 | 走完一次訂房流程到付款頁 | 成功建立訂單 |
| 5 | 用管理員登入 → 房源管理 → 上傳一張照片並儲存 | 上傳成功 |
| 6 | 回前台看該房源詳情頁 | ⚠️ **照片看得到，不是破圖** |
| 7 | `docker compose restart api` 後重看該頁 | 照片還在（volume 有生效） |
| 8 | 開發者工具 → Console | 沒有 CORS 或 mixed content 紅字 |

第 6 項是最容易漏掉又最容易在正式環境才發現的一項。

---

## 日後更新

### 後端

```bash
cd /opt/sunny
git pull
docker compose up -d --build
# 若這次有新的 migration：
docker compose run --rm api alembic upgrade head
```

### 前端

推上 `python-impl` 分支，Cloudflare Pages 會自動建置部署。

### 資料庫備份

DO Managed Postgres 預設每日自動備份、保留 7 天，在叢集的 **Backups** 頁。
不需要額外設定，但值得進去確認它真的開著。

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
2. `API_HOSTNAME` 解析到的 IP 是不是這台機器？`Resolve-DnsName` 確認
3. 若之後接了自己的網域：Cloudflare 那筆 A 記錄是不是設成了橘雲（Proxied）？
   MUST 改成 **DNS only**，否則挑戰打不到 Caddy
4. sslip.io 整個網域偶爾會撞到 Let's Encrypt 的週配額。若日誌明確寫 rate limit，
   那不是你的設定問題，等一段時間或改用自己的網域

### 前端一片空白或 API 全部失敗

打開開發者工具 Console：

- **CORS 紅字** → `CORS_ORIGINS` 填錯。它要填**前端**的網址，不是後端自己的；
  而且改完要 `docker compose up -d`，不是 `restart`
- **Mixed content** → `VITE_API_BASE_URL` 是 `http://` 開頭，改成 `https://` 重新部署
- **404 on /api/...** → `VITE_API_BASE_URL` 結尾多了斜線或帶了路徑

### 房源照片全是破圖

1. `dist/_redirects` 有沒有產生？Pages 的建置日誌裡應該有一行
   `[build-redirects] 已寫入 dist/_redirects，/uploads → https://...`
2. 沒有的話，`VITE_API_BASE_URL` 在 Pages 的環境變數裡是不是設在 **Production**
   而不是只設了 Preview
3. 直接開 `https://api.<你的主機名稱>/uploads/<檔名>` 看得到嗎？看不到的話問題在後端
   （volume 沒掛上或檔案真的不存在）

### 照片上傳成功但一重新部署就消失

`docker-compose.yml` 的 `uploads:/app/uploads` volume 沒生效，
或 `backend/.env` 裡覆寫了 `UPLOAD_DIR` 指到別的路徑。檢查：

```bash
docker compose exec api sh -c 'echo $UPLOAD_DIR; ls -la /app/uploads'
docker volume ls | grep uploads
```

### alembic 連不上資料庫

- 資料庫的 **Trusted sources** 有沒有加這台 Droplet？
- `DB_PORT` 是 25060 嗎？`DB_NAME` 是 `defaultdb` 嗎？
- `DB_SSLMODE=require` 有填嗎？DO 只接受加密連線

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
| [`docker-compose.yml`](../docker-compose.yml) | Caddy + uvicorn + uploads volume |
| [`deploy/Caddyfile`](../deploy/Caddyfile) | TLS 終結與反向代理 |
| [`.env.example`](../.env.example) | compose 用的非機密參數範本 |
| [`backend/.env.production.example`](../backend/.env.production.example) | 後端憑證範本 |
| [`frontend/.env.production.example`](../frontend/.env.production.example) | Pages 環境變數範本 |
| [`frontend/scripts/build-redirects.mjs`](../frontend/scripts/build-redirects.mjs) | 產生 Pages 的 `_redirects` |
