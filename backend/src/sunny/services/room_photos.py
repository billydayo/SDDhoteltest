"""房源照片的儲存（FR-050b、FR-050e、FR-050f）。

⚠️ **這是系統中唯二會接收圖片的地方之一，另一個是房源品質檢測（T147）。
前台的「安全檢測」沒有對應端點**——使用者自行上傳的照片 MUST 全程留在
瀏覽器（FR-086、SC-030）。本模組 MUST NOT 被任何前台程式路徑觸及。

## 檔名一律由伺服器產生

上傳的原始檔名**完全不使用**。客戶端送來的 `filename` 可能是
`../../etc/passwd` 或 `photo.jpg.php`；逐一過濾這些花樣是打地鼠，
改用 `uuid4() + 由內容判定的副檔名`，路徑穿越在結構上就不可能發生。

## MIME 不只看宣告值

`Content-Type` 由客戶端提供，可以隨便寫。因此除了比對宣告值，也讀檔頭的
魔術位元組（magic bytes）確認它真的是圖片。兩者都要通過。

## 兩段式：上傳與掛載分開

上傳只把檔案放好並回傳路徑，**不動 `rooms.images`**。要真正生效必須由
`PATCH /admin/rooms/{id}` 把路徑寫進 `images`。這個分離是 FR-050f 的前提：

- 使用者按**取消** → 本次上傳但未寫進任何資料列的檔案 MUST 被清除
- 使用者**移除既有照片** → MUST 於表單送出後才實際刪檔

反過來做（上傳即掛載、移除即刪檔）會讓「按取消」變成不可逆——照片已經沒了。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Final

from sunny.config import get_settings
from sunny.errors import DomainError

#: 允許的圖片類型。宣告值與魔術位元組**都**要對得上。
#:
#: 不含 SVG：它是 XML，可以內嵌 <script>，而這些圖片會被公開顯示於房源詳情頁。
_ALLOWED: Final[dict[str, tuple[bytes, ...]]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),  # RIFF....WEBP，第 8–12 位元組另行確認
}

_EXTENSIONS: Final[dict[str, str]] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

#: 對外的 URL 前綴。`images` 中同時可能存在外部圖片網址（FR-050b 允許兩者
#: 混用），因此需要一個明確的標記來判斷「這是我們管的檔案」。
PUBLIC_PREFIX: Final = "/uploads/"


def _upload_root() -> Path:
    root = Path(get_settings().upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def upload_root() -> Path:
    """上傳檔的實際目錄。供 `main.py` 掛載靜態路由使用。

    ⚠️ **存檔與供檔必須指向同一個目錄，因此兩邊都經過這裡。**
    `main.py` 若自己讀一次 `settings.upload_dir` 並解析路徑，兩份解析邏輯就會
    分歧——而分歧的症狀是上傳成功、回應 200、房源詳情頁一張破圖，
    沒有任何錯誤訊息。
    """
    return _upload_root()


def is_managed(path: str) -> bool:
    """該路徑是否為本系統管理的上傳檔。

    外部圖片網址（`https://images.unsplash.com/...`）不歸我們管，
    從 `images` 移除時 MUST NOT 嘗試刪除——那不是我們的檔案。
    """
    return path.startswith(PUBLIC_PREFIX)


def _sniff(content: bytes, declared: str) -> None:
    """比對魔術位元組。宣告值與實際內容不符即拒絕。"""
    signatures = _ALLOWED.get(declared)
    if signatures is None:
        raise DomainError(
            f"僅接受 {'、'.join(sorted(_ALLOWED))} 格式的圖片。",
            code="UNSUPPORTED_MEDIA_TYPE",
            status_code=400,
            field="file",
        )
    if not any(content.startswith(sig) for sig in signatures):
        raise DomainError(
            "檔案內容與其宣告的圖片格式不符。",
            code="CONTENT_TYPE_MISMATCH",
            status_code=400,
            field="file",
        )
    if declared == "image/webp" and content[8:12] != b"WEBP":
        raise DomainError(
            "檔案內容與其宣告的圖片格式不符。",
            code="CONTENT_TYPE_MISMATCH",
            status_code=400,
            field="file",
        )


def save(*, content: bytes, content_type: str | None) -> tuple[str, int, str]:
    """存下一張圖片，回傳 `(公開路徑, 位元組數, 類型)`。

    **不掛到任何房源上**——掛載由 `PATCH /admin/rooms/{id}` 負責（見模組說明）。

    Raises:
        DomainError: 檔案為空、超過大小上限、類型不受支援，或內容與宣告不符。
    """
    settings = get_settings()

    if not content:
        raise DomainError("檔案是空的。", code="EMPTY_UPLOAD", status_code=400, field="file")

    if len(content) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes / 1024 / 1024
        raise DomainError(
            f"圖片大小不可超過 {limit_mb:.1f} MB。請先在瀏覽器內壓縮後再上傳。",
            code="FILE_TOO_LARGE",
            status_code=400,
            field="file",
        )

    declared = (content_type or "").split(";")[0].strip().lower()
    _sniff(content, declared)

    # 檔名由伺服器產生，客戶端送來的原始檔名完全不使用
    name = f"{uuid.uuid4().hex}{_EXTENSIONS[declared]}"
    (_upload_root() / name).write_bytes(content)

    return f"{PUBLIC_PREFIX}{name}", len(content), declared


def discard(path: str) -> bool:
    """刪除一個尚未被任何資料列引用的上傳檔（FR-050f 的「取消」路徑）。

    回傳是否真的刪到檔案。找不到檔案**不是錯誤**——使用者可能重複按了取消，
    或檔案早已被清掉，兩者都不需要打斷他。
    """
    if not is_managed(path):
        return False

    name = Path(path).name
    target = (_upload_root() / name).resolve()

    # 再確認一次解析後的路徑仍在上傳目錄內。檔名是我們自己產生的，
    # 這裡理論上不會失手，但這道檢查的成本是一個比較，而漏掉的代價是
    # 任意檔案刪除。
    if target.parent != _upload_root():
        return False

    if not target.is_file():
        return False
    target.unlink()
    return True


def reconcile(*, old_images: list[str], new_images: list[str]) -> list[str]:
    """房源儲存後，刪除被移除的本系統檔案（FR-050f 的「移除」路徑）。

    **MUST 於變更真正保存之後才呼叫**——否則使用者按下取消，照片卻已消失。
    回傳實際刪除的路徑，供稽核紀錄使用。

    外部圖片網址不在處理範圍內：那不是我們的檔案（`is_managed`）。
    """
    removed = [p for p in old_images if p not in set(new_images) and is_managed(p)]
    return [p for p in removed if discard(p)]


def retire(paths: list[str]) -> list[str]:
    """重新檢測後讓舊圖片**不再對外可讀取**（FR-106、FR-107）。

    與 `reconcile()` 的差別在於「新的那一組」是什麼：`reconcile` 比對前後兩份
    清單並刪除差集，這裡則是無條件汰除傳入的整組——房源品質檢測**只保留最新
    一筆**，舊的沒有任何畫面會引用它。

    「不再對外可讀取」以刪檔達成，而非僅僅不顯示。上傳目錄是靜態託管的，
    只要檔案還在，知道網址的人就打得開；一批沒有任何畫面引用、卻仍可直接
    開啟的圖片，正是 FR-107 要避免的。

    **MUST 於新紀錄真正保存之後才呼叫。** 順序相反的話，儲存失敗會留下一筆
    指向已刪除檔案的舊紀錄——房源詳情頁上就是一張破圖。

    回傳實際刪除的路徑，供稽核紀錄使用。找不到檔案不是錯誤（見 `discard`）。
    """
    return [p for p in paths if is_managed(p) and discard(p)]


__all__ = ["PUBLIC_PREFIX", "discard", "is_managed", "reconcile", "retire", "save"]
