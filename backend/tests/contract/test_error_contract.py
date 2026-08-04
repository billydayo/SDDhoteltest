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


# ---------------------------------------------------------------------------
# 逐欄錯誤的 `field`（FR-010）
# ---------------------------------------------------------------------------
#: (查詢字串, 預期 code, 預期 field)
_FIELD_CASES = [
    ("?checkIn=2026-12-01", "INCOMPLETE_DATE_FILTER", "checkOut"),
    ("?checkOut=2026-12-03", "INCOMPLETE_DATE_FILTER", "checkIn"),
    ("?checkIn=2026-12-01&checkOut=2026-12-03", "GUEST_COUNT_REQUIRED", "guestCount"),
    ("?guestCount=0", "INVALID_GUEST_COUNT", "guestCount"),
    ("?sort=nonsense", "INVALID_SORT", "sort"),
]


@pytest.mark.parametrize(("query", "code", "field"), _FIELD_CASES, ids=[c[1] for c in _FIELD_CASES])
async def test_field_errors_name_the_field_as_the_request_spells_it(
    client: httpx.AsyncClient, query: str, code: str, field: str
) -> None:
    """**逐欄錯誤 MUST 帶 `field`，且 MUST 為 camelCase**（FR-010）。

    這兩項曾經各壞過一次，而症狀完全一樣、都不會有任何東西報錯：

    1. 例外處理器根本沒把 `field` 放進回應——領域層設得再仔細也到不了前端。
    2. 放進去了但是 snake_case（`check_out`）——用戶端送的是 `checkOut`，
       它的輸入框也叫 `checkOut`，拿 `check_out` 去查 DOM 找不到東西。

    兩種情況下畫面都是「錯誤訊息出現了，但游標沒有移到那一欄」。FR-010 要求
    的正是移動焦點，而沒有人會把「游標沒動」當成 bug 回報。
    """
    res = await client.get(f"/rooms{query}")
    assert res.status_code == 400, res.text

    payload = res.json()
    assert payload["code"] == code, payload
    assert "field" in payload, f"逐欄錯誤沒有帶 field：{payload}"
    assert payload["field"] == field, f"field 應為請求上的名稱（camelCase）：{payload}"


async def test_a_human_label_never_escapes_as_a_field_name() -> None:
    """⚠️ **`field` MUST 為 ASCII 識別字，中文標籤 MUST 在邊界被擋掉。**

    `utils.dates.parse_calendar_date` 也有一個叫 `field` 的參數，但它是給人看的
    中文標籤（「入住日」），只被插進訊息裡。哪天有人把兩者接起來，前端就會拿
    「入住日」去組 `[name="入住日"]`，找不到、焦點不動、沒有任何錯誤。
    """
    from sunny.errors import DomainError

    app = create_app()

    @app.get("/__mislabelled")
    async def _mislabelled() -> None:
        raise DomainError("入住日格式錯誤。", code="INVALID_DATE_FORMAT", field="入住日")

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        res = await c.get("/__mislabelled")

    assert res.status_code == 400
    # 寧可沒有 field（前端顯示為整體訊息），也不要一個永遠對不上的選擇器
    assert "field" not in res.json(), res.json()


async def test_a_short_password_names_the_password_field(client: httpx.AsyncClient) -> None:
    """FR-009b + FR-010：密碼太短 MUST 帶 `field="password"`。

    註冊表單有四格，其中兩格是密碼。少了 `field`，訊息只能印在表單底部而焦點
    不動——使用者讀到「密碼至少需 6 個字元」，卻得自己回頭找是哪一格。

    這條在觸及資料庫之前就返回（長度檢查是註冊的第一步），因此不需要測試庫。
    """
    res = await client.post(
        "/auth/register",
        json={"email": "someone@example.com", "password": "abc", "displayName": "短"},
    )

    assert res.status_code == 400, res.text
    payload = res.json()
    assert payload["code"] == "PASSWORD_TOO_SHORT"
    assert payload.get("field") == "password", payload


async def test_a_browser_navigation_never_lands_on_json(client: httpx.AsyncClient) -> None:
    """⚠️ **瀏覽器導覽的端點 MUST 回導向，MUST NOT 回 JSON。**

    `GET /auth/google` 是使用者按下「以 Google 登入」後的**頁面導覽**。尚未
    設定 Google client 時（T066 未完成即是此狀態），回 503 JSON 會讓他的視窗
    停在一頁 `{"detail": ...}` 上——沒有錯誤、沒有例外、沒有路可以回去。

    這條規則只適用於導覽端點。其餘端點是前端發出的 fetch，JSON 才是對的。
    """
    res = await client.get("/auth/google", follow_redirects=False)

    assert res.status_code == 303, f"應為導向而非 {res.status_code}：{res.text[:200]}"
    location = res.headers["location"]
    assert "/login" in location
    assert "GOOGLE_NOT_CONFIGURED" in location


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
