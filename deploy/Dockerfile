# 對外那一層：Caddy + 已建置好的前端靜態檔。
#
# 建置脈絡（context）MUST 為**專案根目錄**，與 backend/Dockerfile 一致：
#
#     docker build -f deploy/Dockerfile .
#
# compose 已經這樣設定。
#
# ## 為什麼前端要烤進映像，而不是掛 volume
#
# 掛 volume 表示 Droplet 上得裝 Node、得在部署時記得跑一次 `npm run build`，
# 而「忘記跑」的症狀是網站看起來正常、只是內容是上一版的——沒有錯誤訊息。
# 烤進映像則讓 `docker compose up -d --build` 這一句同時更新前後端，
# 部署步驟只有一個，也就沒有半新半舊的中間狀態。

# ---------------------------------------------------------------------------
# 建置階段
# ---------------------------------------------------------------------------
# ⚠️ Node MUST ≥ 22.12（Vite 8 的下限）。版本太舊時的失敗訊息是一串 esbuild
# 的語法錯誤，看起來像原始碼壞了，不會提到 Node 版本。
FROM node:22-alpine AS build

WORKDIR /app

# 先只複製依賴宣告再安裝，讓「改了一行 tsx 就重裝整組依賴」不會發生。
#
# 用 `npm ci` 而不是 `npm install`：ci 嚴格照 package-lock.json 安裝，版本對不上
# 就直接失敗，而不是安靜地裝一組跟本機不同的版本再產生一份不同的 dist。
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# ⚠️ VITE_ 變數是**建置時**被字面替換進產物的，不是執行時讀的。因此它必須是
# build arg——寫進 compose 的 `environment:` 對它毫無作用，那是給執行中的容器的。
#
# 這也是為什麼改這個值一定要重新 build（`up -d --build`），單純 restart 沒有用。
#
# 只有這一個。`VITE_API_BASE_URL` 在同源架構下不需要了：不設定時 client.ts
# 退回相對路徑 `/api`，而 Caddy 就在同一個網域上接住它（見 Caddyfile）。
ARG VITE_HIDE_ADMIN_DEMO=""
ENV VITE_HIDE_ADMIN_DEMO=${VITE_HIDE_ADMIN_DEMO}

# ⚠️ 這一步在 1 GB 的 Droplet 上會被 OOM killer 砍掉（exit code 137，訊息只有
# 一個 "Killed"，不會說是記憶體）。解法是在 Droplet 上開一塊 swap，
# 見 docs/deploy.md 步驟 2.5。
RUN npm run build

# ---------------------------------------------------------------------------
# 執行階段
# ---------------------------------------------------------------------------
FROM caddy:2.9-alpine

# 路徑與 Caddyfile 的 `root * /srv/frontend` 綁在一起，改一邊要改兩邊。
COPY --from=build /app/dist /srv/frontend
