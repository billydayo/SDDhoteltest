#!/usr/bin/env bash
#
# 自動部署：比對 origin 有沒有新 commit，有的話就跑一次跟手動完全相同的部署。
#
# 由 `deploy/sunny-update.timer` 每兩分鐘叫一次（安裝方式見 docs/deploy.md
# 「日後更新 → 自動部署」）。也可以隨時自己跑一次：
#
#     /opt/sunny/deploy/auto-update.sh
#
# ## 為什麼是輪詢，而不是 GitHub Actions 或 webhook
#
# 三種都做得到，差別在要交出什麼。Actions 得把 Droplet 的 SSH 私鑰放進 GitHub
# Secrets 並讓 SSH port 對 runner 開放；webhook 得多跑一個常駐服務、多開一條
# 對外路徑。輪詢是 Droplet **主動出去拉**：沒有金鑰外流、沒有新的 inbound 表面，
# 代價只有最多兩分鐘的延遲——對一個訂房網站的內容更新，那個延遲不值得用上面
# 任何一項去換。
#
# ## 這支腳本會自己更新自己
#
# 它就在 repo 裡，所以 `git pull` 會蓋掉正在執行的這個檔案。bash 是**邊讀邊執行**
# 的，檔案中途被換掉可能讓它從新內容的某個位元組繼續讀下去——執行出來的東西
# 兩個版本都不是。因此底下所有邏輯都包在 `main()` 裡：函式在 pull 發生**之前**
# 就已經整段解析進記憶體，之後檔案怎麼變都影響不到這一輪。
#
# ⚠️ 新增邏輯 MUST 放進 `main()`，MUST NOT 直接寫在檔案頂層的執行流程裡。

set -Eeuo pipefail

# 專案位置。docs/deploy.md 全篇用 /opt/sunny，這裡跟著它。
REPO_DIR="${SUNNY_REPO_DIR:-/opt/sunny}"

# 同一時間只跑一輪。timer 每兩分鐘敲一次，而 1 GB Droplet 上建置前端要好幾分鐘
# ——沒有這道鎖，手動執行與 timer 就可能同時對著同一個 git 工作區動手。
LOCK_FILE="/var/lock/sunny-update.lock"

# 有新 commit 時要不要順便把 migration 跑掉。
#
# 預設開著，因為關掉的後果更糟：程式碼更新了、schema 沒有，網站會在使用者面前
# 噴 500，而「等人記得手動跑一次」正是自動部署要消滅的那件事。`alembic upgrade
# head` 本身是冪等的，已經在 head 時什麼都不做。
AUTO_MIGRATE="${SUNNY_AUTO_MIGRATE:-1}"

log() {
  # 輸出交給 journald 收（見 .service）。自己寫檔案只會多一份要輪替的東西。
  printf '[sunny-update] %s\n' "$*"
}

main() {
  cd "$REPO_DIR"

  # --- 先確認工作區乾淨 ---------------------------------------------------
  #
  # ⚠️ 這裡**刻意在有本機修改時整輪放棄**，而不是想辦法蓋過去。
  #
  # 會走到這一步，代表有人直接在正式機上改了進版控的檔案（十之八九是為了救火
  # 改 Caddyfile 或 compose）。自動把它丟掉等於在無人看著的時候消滅唯一一份
  # 修改；硬 merge 則會生出一個只存在於這台機器的 commit，下一次 pull 再爆一次。
  # 停下來並在 journal 裡說清楚，是唯一不會弄丟東西的選項。
  #
  # `.env` 與 `backend/.env` 不在此列——它們被 .gitignore 忽略，不會出現在
  # `--porcelain` 的輸出裡。
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    log "錯誤：工作區有未提交的本機修改，這一輪不動它。"
    log "      請自行處理後再讓自動部署接手："
    git status --short --untracked-files=no | sed 's/^/      /'
    return 1
  fi

  # --- 有沒有新東西 -------------------------------------------------------
  #
  # 用當前分支的 upstream，而不是寫死 main 或 python-impl。寫死的話，哪天在
  # Droplet 上切了分支，自動部署會安靜地繼續部署另一條線的內容。
  local branch upstream local_sha remote_sha
  branch="$(git symbolic-ref --short HEAD)"
  if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
    log "錯誤：分支 ${branch} 沒有設定 upstream，不知道要跟誰比對。"
    log "      修法：git branch --set-upstream-to=origin/${branch} ${branch}"
    return 1
  fi

  git fetch --quiet --prune origin

  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$upstream")"

  # 絕大多數的執行會停在這裡。⚠️ 這條 early return 就是整支腳本能每兩分鐘跑
  # 一次的原因——沒有它，每兩分鐘就會重建一次映像，Droplet 不會有閒著的時候。
  if [[ "$local_sha" == "$remote_sha" ]]; then
    return 0
  fi

  log "偵測到更新：${local_sha:0:7} → ${remote_sha:0:7}（${upstream}）"
  git --no-pager log --oneline "${local_sha}..${remote_sha}" | sed 's/^/          /'

  # `--ff-only`：只快轉，不 merge。正式機上的 git 工作區只該是遠端的一面鏡子，
  # 需要 merge 就表示這面鏡子被人動過了，那要人來看，不是這裡自己決定。
  git pull --ff-only --quiet

  # --- 部署 ---------------------------------------------------------------
  #
  # 拆成 build → migrate → up 三步，而不是文件裡那句 `up -d --build`。
  #
  # ⚠️ 順序是有意義的：migration MUST 在新版 API 開始接請求**之前**跑完。
  # 若照 `up -d --build` 的走法，新容器起來的瞬間就開始服務，而 schema 還是舊的
  # ——那個空窗期裡進來的請求會拿到 500。先 build 讓新映像就位，用它跑完
  # migration，最後才把流量換過去。
  log "建置映像…"
  docker compose build

  if [[ "$AUTO_MIGRATE" == "1" ]]; then
    log "套用 migration…"
    # `run --rm` 起一個用完即丟的容器，不動到正在服務的那個。
    docker compose run --rm api alembic upgrade head
  fi

  log "切換到新版本…"
  docker compose up -d

  # 舊映像不會自己消失。每次建置都留下一個沒有標籤的前一版，Droplet 的磁碟
  # 撐不了幾十輪——而磁碟滿了的症狀是建置失敗，訊息不會提到磁碟。
  # `prune -f` 只清沒有標籤且沒有容器在用的，動不到現役映像。
  docker image prune -f >/dev/null

  # --- 確認網站真的還活著 -------------------------------------------------
  #
  # 部署「成功」與網站「能開」是兩件事：compose 回報成功只代表容器起來了。
  local hostname=""
  if [[ -f .env ]]; then
    # `tail -n 1`：同一個鍵重複出現時，compose 取的是最後一個，這裡跟著它。
    # `tr`：去掉引號與空白——.env 裡寫 `APP_HOSTNAME="sunny.example.org"` 也讀得對。
    hostname="$(grep -E '^APP_HOSTNAME=' .env | tail -n 1 | cut -d= -f2- | tr -d "\"' " || true)"
  fi

  if [[ -z "$hostname" ]]; then
    log "完成 ${remote_sha:0:7}（.env 裡讀不到 APP_HOSTNAME，略過健康檢查）"
    return 0
  fi

  # 給 Caddy 一點時間接手。重試而不是睡一次長的：正常情況下第一次就過了。
  local attempt
  for attempt in 1 2 3 4 5; do
    if curl -fsS -o /dev/null --max-time 10 "https://${hostname}/"; then
      log "完成 ${remote_sha:0:7}，https://${hostname}/ 回應正常"
      return 0
    fi
    sleep 5
  done

  # ⚠️ 這裡回非零，讓 systemd 把這個 unit 標成 failed——`systemctl --failed`
  # 因此看得到。安靜地成功結束會讓一次壞掉的部署完全沒有痕跡。
  log "警告：已部署 ${remote_sha:0:7}，但 https://${hostname}/ 連續五次沒有正常回應"
  return 1
}

# ⚠️ 先確認 flock 真的在。少了這一步，`flock` 不存在時 `if ! flock -n 9` 會因為
# 「找不到指令」而成立，於是每一輪都印「前一輪還在執行」然後 exit 0——自動部署
# 就此永遠不做事，而 systemd 看到的是一次又一次的成功。Debian／Ubuntu 上它屬於
# util-linux、必定存在，但這個失敗模式安靜到不值得賭。
if ! command -v flock >/dev/null 2>&1; then
  log "錯誤：找不到 flock（Debian／Ubuntu 上由 util-linux 提供）。"
  exit 2
fi

# 取鎖後執行。`-n` 是拿不到就立刻走人（前一輪還在跑），不是排隊等——排隊的話
# timer 每兩分鐘就疊一個上去，一次慢的建置會換來一整排等著做同一件事的行程。
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "前一輪還在執行，跳過這一次。"
  exit 0
fi

main "$@"
