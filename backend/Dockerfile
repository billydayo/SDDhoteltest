# Sunny 後端映像。
#
# 建置脈絡（context）MUST 為**專案根目錄**，不是 backend/：
#
#     docker build -f backend/Dockerfile .
#
# compose 已經這樣設定。從 backend/ 建置會找不到下面的 COPY 來源。
#
# ## 為什麼用 uv 而不是 pip
#
# 憲章後端約束：Python 套件管理 MUST 用 uv，MUST NOT 用 pip／Poetry／
# requirements.txt。`uv sync --frozen` 會嚴格照 uv.lock 安裝——若 lock 與
# pyproject 不一致就直接失敗，而不是安靜地裝一組跟本機不同的版本。
# 正式環境與開發環境版本悄悄分歧，是最難查的一類問題。

FROM python:3.12-slim-bookworm

# uv 由官方映像複製，版本固定。用 `latest` 會讓每次重建都可能換一個 uv，
# 而 uv 的行為變更會表現成建置失敗或依賴解析結果不同。
#
# ⚠️ 這個版本 MUST 跟得上 uv.lock 的格式。本專案的 lock 是 `revision = 3`，
# 舊版 uv 會直接拒讀（訊息是 unsupported lockfile revision，看起來像 lock 壞了，
# 其實是 uv 太舊）。更新 uv.lock 之後若建置突然失敗，先看這一行。
COPY --from=ghcr.io/astral-sh/uv:0.12.1 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# ---------------------------------------------------------------------------
# 依賴層
# ---------------------------------------------------------------------------
# 先只複製依賴宣告再安裝，讓「改了一行 Python 就重裝整組依賴」不會發生。
# `--no-install-project` 表示這一層只裝第三方套件，不裝 sunny 本身——
# 此時原始碼還沒複製進來。
#
# README.md 也在這一層：pyproject 宣告了 `readme = "README.md"`，缺檔時
# hatchling 的中繼資料階段會失敗，而訊息只說「readme file does not exist」，
# 不會提到是 Docker 的建置脈絡少複製了一個檔案。它極少變動，放這裡不影響快取。
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-install-project --no-dev

# ---------------------------------------------------------------------------
# 應用層
# ---------------------------------------------------------------------------
# alembic/ 與 alembic.ini 也要進映像：遷移在同一個容器內執行
#   docker compose run --rm api alembic upgrade head
# 少了它們，`alembic upgrade head` 會回報找不到 script_location，
# 而那個訊息看起來像設定檔寫錯，不像檔案沒進映像。
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY backend/src ./src
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# 非 root 執行
# ---------------------------------------------------------------------------
# ⚠️ `UPLOAD_DIR` 指向的目錄 MUST 可寫，且 MUST 由 volume 掛載。
# `room_photos._upload_root()` 會在第一次上傳時 mkdir，若權限不足會在上傳當下
# 才失敗——那時使用者已經選好檔案按下送出了。這裡先把目錄建好並交給 app。
#
# 沒有掛 volume 的話容器一重建照片就沒了，而且每一步都成功、沒有錯誤訊息，
# 只有房源詳情頁上一排破圖。見 docker-compose.yml 的 `uploads` volume。
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /app/uploads \
 && chown -R app:app /app
USER app

ENV UPLOAD_DIR=/app/uploads

EXPOSE 8000

# `/openapi.json` 是不需要資料庫也不需要登入的端點，適合當存活探針。
# 刻意不用 `/`（沒有註冊這個路由，會回 404）也不用需要 DB 的端點——
# 資料庫短暫不可用時不應該讓容器被反覆重啟。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/openapi.json', timeout=4).status==200 else 1)"

# `--proxy-headers` 與 `--forwarded-allow-ips` 是給前面那層 Caddy 用的。
# 少了它們，uvicorn 看到的 client IP 全是 Caddy 容器的內網位址，scheme 全是
# http——於是後端自己組出來的絕對網址會是 http://，瀏覽器在 HTTPS 頁面上
# 會擋掉那些請求（mixed content）。
#
# ⚠️ 只有在**確實**有反向代理在前面時才可以放行 forwarded headers。
# 直接把 8000 曝露到公網又信任這些標頭，等於讓任何人自稱來自任何 IP。
# compose 沒有把 8000 對外 publish，正是為了讓這個前提成立。
#
# workers 維持 1：DO Managed Postgres 最小方案的連線上限是 22，而 db.py 的
# 連線池是 pool_size=5 + max_overflow=5。每多一個 worker 就多十條連線的上限，
# 兩個 worker 就會在尖峰把配額用光，症狀是隨機的 "too many connections"。
CMD ["uvicorn", "sunny.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
