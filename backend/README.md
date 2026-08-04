# Sunny 訂房平台 — 後端

FastAPI + SQLAlchemy 2.0 + Alembic。啟動方式與環境變數見專案根目錄的 `README.md`
與 [`specs/001-booking-site/quickstart.md`](../specs/001-booking-site/quickstart.md)。

所有指令 MUST 透過 `uv run` 執行，以確保使用 `uv.lock` 鎖定的環境（憲章後端約束）。

## 測試

```bash
cd backend
uv run pytest            # 全部
uv run pytest -q tests/unit/test_overlap.py
```

Windows 主控台預設不是 UTF-8，失敗訊息（多為中文）會是亂碼。加上
`PYTHONIOENCODING=utf-8` 即可正常顯示。

### 需要資料庫的測試

近半數測試需要一個**真正的 PostgreSQL**——房況保證依賴 `EXCLUDE USING gist`
與 `daterange`，換成 SQLite 等於在測試裡拿掉那條保證而測試仍全綠。

位置由 `SUNNY_TEST_DATABASE_URL` 指定（`backend/.env` 或環境變數皆可）。
**未設定時那些測試會被跳過**，而跳過在輸出裡是綠的——看到 `241 passed,
224 skipped` 時，被驗證的其實只有不碰資料庫的那一半。

建立測試資料庫（只需一次）：

```bash
# 1. 以擁有者連上既有資料庫執行
create database sunny_test;

# 2. 把 schema 建起來（DB_NAME 覆寫 .env 的值，只影響這一次）
cd backend && DB_NAME=sunny_test uv run alembic upgrade head

# 3. 在 backend/.env 填入（密碼要 URL 編碼，@ → %40）
SUNNY_TEST_DATABASE_URL=postgresql+asyncpg://<user>:<pw>@<host>:5432/sunny_test
```

⚠️ 若資料庫在 Supabase 的 Session pooler 後面，啟用前 MUST 確認 pooler 真的把
連線路由到 `sunny_test`：

```sql
select current_database();  -- MUST 回 sunny_test
```

回 `postgres` 代表 pooler 忽略了連線字串裡的資料庫名稱，那時測試會動到開發資料。

### 測試之間如何隔離

每個測試在自己的連線上開一個**永不提交的交易**，session 以
`join_transaction_mode="create_savepoint"` 併入，測試結束一律回滾。被測程式碼裡的
`session.commit()` 因此變成「釋放 savepoint」——沒有任何一筆測試資料會落地，
測試之間也就無從互相污染。細節與當初為什麼不用 `truncate` 見
[`tests/conftest.py`](tests/conftest.py) 的模組說明。

兩份測試不走這條路，因為它們需要資料**真的存在**於資料庫，好讓另一條連線看得到：

- `tests/unit/test_concurrent_booking.py`（兩條連線競爭同一個排除約束）
- `tests/unit/test_admin_logs_append_only.py`（以 `sunny_app` 角色驗證 REVOKE）

這兩份各自建立會提交的資料，並在 fixture 結束時刪除。新增測試時若也需要如此，
照著它們的 `committed` / `actor_id` fixture 寫，**MUST 自行清理**。
