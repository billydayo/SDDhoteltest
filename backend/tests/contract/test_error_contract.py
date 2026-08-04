"""T177：錯誤回應的契約（FR-074、FR-075、FR-083、憲章「錯誤處理」條）。

**後端 MUST NOT 將堆疊追蹤、SQL 語句或內部檔案路徑回傳給用戶端。**
**所有錯誤回應 MUST 為 `{"detail": ..., "code": ...}`**（contracts/README.md）。
**訊息 MUST 為繁體中文**（FR-069）。

## 為什麼連 404 都要管

框架自己產生的 404 預設回 `{"detail": "Not Found"}`——英文，且**沒有 `code`**。

少了 `code`，前端只能比對 detail 字串來判斷錯誤種類，而那會在任何一次文案
修改時無聲壞掉。英文訊息則會直接出現在使用者面前。兩者都不會有任何測試
失敗，因為那條路徑「本來就是錯誤」，沒有人會特別去看它長什麼樣。

## 錯誤訊息是攻擊者最省力的偵察管道

一則帶著 SQL 或檔案路徑的錯誤，比任何掃描工具都更快告訴對方系統的結構。
真正的成因寫進伺服器日誌，不送給用戶端（main.py）。

不需要資料庫：這些路徑都在觸及資料層之前就返回。
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

from sunny.main import create_app

#: 一則錯誤訊息中絕不該出現的東西。
_LEAK_PATTERNS = [
    (re.compile(r"Traceback", re.IGNORECASE), "堆疊追蹤"),
    (re.compile(r"\bselect\b.+\bfrom\b", re.IGNORECASE), "SQL 語句"),
    (re.compile(r"\binsert into\b|\bupdate .+ set\b", re.IGNORECASE), "SQL 語句"),
    (re.compile(r"[A-Za-z]:\\\\|/usr/|/home/|site-packages"), "內部檔案路徑"),
    (re.compile(r"\.py\b"), "原始碼檔名"),
    (re.compile(r"sqlalchemy|asyncpg|psycopg", re.IGNORECASE), "資料庫函式庫名稱"),
    (re.compile(r"sunny_app|DB_OWNER|JWT_SECRET"), "連線角色或秘鑰名稱"),
]


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """**不覆寫 `get_session`。**

    本檔測的路徑都在觸及資料層之前返回。刻意不接資料庫，才能確定這些回應
    真的與資料無關——若哪天有一支開始需要連線，它會逾時而不是靜默通過。
    """
    app = create_app()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


#: (方法, 路徑, 主體, 預期狀態碼)
_CASES = [
    ("GET", "/no-such-endpoint", None, 404),
    ("POST", "/rooms", None, 405),
    ("GET", "/rooms/not-a-uuid", None, 422),
    ("GET", "/rooms?checkIn=2026-13-45", None, 400),
    ("GET", "/admin/dashboard", None, 401),
    ("POST", "/messages", {"body": ""}, 401),
]
_IDS = [f"{m} {p} → {s}" for m, p, _, s in _CASES]


@pytest.mark.parametrize(("method", "path", "body", "expected"), _CASES, ids=_IDS)
async def test_error_shape_is_always_detail_and_code(
    client: httpx.AsyncClient, method: str, path: str, body, expected: int
) -> None:
    """**每一則錯誤都是 `{"detail": ..., "code": ...}`**（contracts/README.md）。

    含框架自己產生的 404 與 405——那兩條路徑最容易被漏掉，因為沒有人會
    特別去看「找不到頁面」長什麼樣。
    """
    res = await client.request(method, path, json=body)
    assert res.status_code == expected, f"{method} {path} 回了 {res.status_code}：{res.text}"

    payload = res.json()
    assert set(payload) >= {"detail", "code"}, f"錯誤格式不符：{payload}"
    assert isinstance(payload["detail"], str) and payload["detail"]
    assert isinstance(payload["code"], str) and payload["code"]


@pytest.mark.parametrize(("method", "path", "body", "expected"), _CASES, ids=_IDS)
async def test_error_messages_never_leak_internals(
    client: httpx.AsyncClient, method: str, path: str, body, expected: int
) -> None:
    """**MUST NOT 回傳堆疊追蹤、SQL 語句或內部檔案路徑**（憲章「錯誤處理」條）。

    整個回應本體都掃——不只 `detail`。有人在 `code` 或某個附加欄位裡放進
    例外文字時，只看 `detail` 的檢查會通過。
    """
    res = await client.request(method, path, json=body)
    text = res.text

    for pattern, label in _LEAK_PATTERNS:
        assert not pattern.search(text), f"{method} {path} 的錯誤回應洩漏了{label}：{text[:300]}"


@pytest.mark.parametrize(("method", "path", "body", "expected"), _CASES, ids=_IDS)
async def test_error_messages_are_traditional_chinese(
    client: httpx.AsyncClient, method: str, path: str, body, expected: int
) -> None:
    """**訊息 MUST 為繁體中文**（FR-069）。

    框架預設的 `"Not Found"` 與 `"Method Not Allowed"` 是英文，且會直接
    出現在使用者面前。
    """
    detail = (await client.request(method, path, json=body)).json()["detail"]
    assert re.search(r"[一-鿿]", detail), f"錯誤訊息不是中文：{detail!r}"


async def test_an_unhandled_exception_reveals_nothing(client: httpx.AsyncClient) -> None:
    """未預期的例外 MUST 回一句固定的話，**成因只寫日誌**。

    以一個真的會炸開的端點驗證，而不是相信 `_unhandled` 處理器長得對——
    處理器可能因為 `raise_server_exceptions` 這類設定而根本沒被呼叫到。
    """
    app = create_app()

    @app.get("/__boom")
    async def _boom() -> None:
        raise RuntimeError("select password_hash from profiles -- /home/app/secret.py")

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        res = await c.get("/__boom")

    assert res.status_code == 500
    assert res.json() == {"detail": "系統發生內部錯誤，請稍後再試。", "code": "INTERNAL_ERROR"}

    for pattern, label in _LEAK_PATTERNS:
        assert not pattern.search(res.text), f"500 回應洩漏了{label}"
