#!/usr/bin/env python3
"""GitHub webhook 接收器：驗簽章，然後把部署交給既有的 sunny-update.service。

安裝方式見 docs/deploy.md「日後更新 → 自動部署」。

## 它刻意不做的事

**不自己判斷該不該部署。** 收到合法的 push 事件就叫 `sunny-update.service`，
由那支腳本比對 HEAD 與 upstream——沒有差異時它 195ms 就結束。因此這裡不需要
知道正在部署哪一條分支，也就不會有「Caddyfile 改了分支、這裡忘了改」那種
只在特定情況下才發作的分歧。推到其他分支同樣會叫醒它，然後它什麼都不做。

**不執行 GitHub 送來的任何東西。** payload 只用於驗簽章與讀 `X-GitHub-Event`,
內容本身從不進入任何指令。要部署什麼由 Droplet 上的 git upstream 決定。

## 為什麼是 Unix socket 而不是 127.0.0.1:9000

Caddy 跑在容器裡，連不到宿主機的 127.0.0.1——那要嘛把接收器綁上 0.0.0.0
（於是 port 9000 對公網開著，安全性只剩下一道沒人驗證過的防火牆規則），要嘛
綁 docker 橋接的閘道位址（那個 IP 會隨網路重建而變）。Unix socket 兩個問題
都沒有：**完全沒有 TCP 監聽**，唯一的入口是 Caddy 以 volume 掛進來的那個檔案。

## 信任邊界

以 root 執行——因為 `systemctl start` 與它啟動的部署本來就是 root 的事。換來
的義務是這支程式必須小：它只讀 Content-Length 以內的位元組、做一次
`hmac.compare_digest`、然後執行一個寫死的指令。`.service` 另外加了
`RestrictAddressFamilies=AF_UNIX`，即使這裡被攻破也開不了對外連線。
"""

import hashlib
import hmac
import os
import socketserver
import subprocess
import sys
from http.server import BaseHTTPRequestHandler

SOCKET_PATH = os.environ.get("SUNNY_WEBHOOK_SOCKET", "/run/sunny/webhook.sock")
UNIT = "sunny-update.service"

# ⚠️ 上限存在的理由不是效能，是不讓對方在**驗簽章之前**決定我們要配置多少
# 記憶體。簽章要算在整個 body 上，所以 body 一定得先讀進來——這是唯一一段
# 在身分未確認前就會做的工作，因此它必須有界。GitHub 的 push payload 遠小於此。
MAX_BODY = 1 << 20  # 1 MiB


def _log(message: str) -> None:
    # 交給 journald（見 .service）。⚠️ MUST NOT 記錄 payload 或簽章。
    print(f"[sunny-webhook] {message}", file=sys.stderr, flush=True)


class Receiver(BaseHTTPRequestHandler):
    # Caddy 會以 HTTP/1.1 keep-alive 連過來。宣告 1.1 就有義務每個回應都帶正確的
    # Content-Length，否則對方會一直等下去——`_reply()` 統一處理這件事。
    protocol_version = "HTTP/1.1"
    server_version = "sunny-webhook"
    sys_version = ""

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        _log(fmt % args)

    def _reply(self, code: int, text: str) -> None:
        body = f"{text}\n".encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        # 這個端點只收 POST。回 404 而不是 405，是為了不對著隨手掃描的人確認
        # 這裡有東西。
        self._reply(404, "not found")

    def do_POST(self) -> None:  # noqa: N802
        secret = os.environb.get(b"GITHUB_WEBHOOK_SECRET", b"")
        if not secret:
            # 啟動時已經擋過一次，這裡是第二道。沒有密鑰就沒有辦法分辨來源，
            # 此時「先部署再說」是最糟的選項。
            _log("錯誤：GITHUB_WEBHOOK_SECRET 是空的，拒絕所有請求")
            self._reply(500, "not configured")
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._reply(400, "bad content-length")
            return

        if length <= 0 or length > MAX_BODY:
            self._reply(400, "bad content-length")
            return

        body = self.rfile.read(length)

        # ⚠️ MUST 用 `compare_digest` 而不是 `==`。字串比較會在第一個不同的位元組
        # 就返回，兩者的耗時差異足以讓對方一個位元組一個位元組地把簽章試出來。
        expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(self.headers.get("X-Hub-Signature-256", ""), expected):
            _log("拒絕：簽章不符")
            self._reply(403, "bad signature")
            return

        event = self.headers.get("X-GitHub-Event", "")

        # 在 GitHub 上新增 webhook 時它會先送一個 ping。回 200 才會顯示綠勾。
        if event == "ping":
            self._reply(200, "pong")
            return

        if event != "push":
            self._reply(202, f"ignored: {event}")
            return

        # ⚠️ `--no-block` 不能省。GitHub 對 webhook 的回應有 10 秒上限，而一次
        # 建置要好幾分鐘。少了它，這裡會等到部署結束才回應，GitHub 早已判定
        # 逾時並把這次投遞標成失敗——實際上部署成功了。那種紅叉最難查，因為
        # 兩邊的紀錄互相矛盾。
        try:
            subprocess.run(
                ["systemctl", "start", "--no-block", UNIT],
                check=True,
                capture_output=True,
                timeout=10,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            _log(f"錯誤：叫不起 {UNIT}：{exc}")
            self._reply(500, "trigger failed")
            return

        _log(f"已觸發 {UNIT}")
        self._reply(202, "deploy queued")


class UnixHTTPServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def server_bind(self) -> None:
        # socket 檔在程式結束時不會自己消失，重啟時原地的舊檔會讓 bind 失敗。
        # ⚠️ 只動 socket 檔本身，MUST NOT 動它所在的目錄——那個目錄被 bind mount
        # 進 caddy 容器，刪掉再建會產生新的 inode，而容器那一側仍指著舊的：
        # 掛載看起來還在，裡面卻永遠是空的。
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
        super().server_bind()
        # caddy 容器以 root 連進來，0660 就夠；不給 other 任何權限。
        os.chmod(SOCKET_PATH, 0o660)

    def get_request(self):
        # AF_UNIX 的 accept() 回傳的位址是空字串，而 BaseHTTPRequestHandler 會
        # 拿 client_address[0] 去組日誌。給它一個形狀正確的替代值。
        request, _ = super().get_request()
        return request, ("unix", 0)


def main() -> int:
    if not os.environb.get(b"GITHUB_WEBHOOK_SECRET", b""):
        _log("錯誤：GITHUB_WEBHOOK_SECRET 未設定，不啟動。")
        _log("      見 docs/deploy.md「日後更新 → 自動部署」。")
        return 2

    os.makedirs(os.path.dirname(SOCKET_PATH), exist_ok=True)

    with UnixHTTPServer(SOCKET_PATH, Receiver) as httpd:
        _log(f"監聽 {SOCKET_PATH}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
