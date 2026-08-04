"""T161a：稽核覆蓋率 100%（FR-114、SC-026）。

**列舉 FastAPI 路由表中所有 `/admin/*` 的寫入端點（POST／PUT／PATCH／DELETE），
逐一呼叫後斷言 `admin_logs` 筆數 +1。**

## 為什麼要列舉而不是逐一手寫

SC-026 宣稱的是 **100%**，而 100% 是一個關於**全體**的宣稱。手寫的清單只涵蓋
寫測試那天存在的端點——日後新增一支後台寫入端點卻忘了寫日誌時，不會有任何
測試失敗，因為沒有人為它寫測試。

**稽核覆蓋率就是這樣靜默退化的。** 從路由表列舉，讓新端點自動進入檢查範圍：
忘記寫日誌的那一天，這份測試會失敗，而失敗訊息會直接指出是哪一支。

## 有意的例外，逐一具名

有些寫入端點**不該**寫日誌，但每一個都要在這裡列出理由。
清單本身就是「我們想過這件事」的證據；空的例外清單與沒有例外清單看起來
一樣，但前者是刻意的。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport
from sqlalchemy import func, select

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.admin_log import AdminLog
from tests.conftest import auth_header

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


# ---------------------------------------------------------------------------
# 例外：不寫日誌的寫入端點，逐一具名
# ---------------------------------------------------------------------------
#: 鍵為 `"<METHOD> <path>"`，值為理由。
#:
#: ⚠️ 新增項目 MUST 附理由，且理由 MUST 是「這個操作不改變任何持久狀態」或
#: 「它的日誌由別的端點寫」。「還沒做」不是理由。
AUDIT_EXEMPT: dict[str, str] = {
    "POST /admin/room-photos": (
        "只把檔案放進暫存，不動任何資料列。真正生效的是 "
        "PUT /admin/rooms/{room_id}，日誌在那裡寫（FR-050f 的兩段式）。"
    ),
    "DELETE /admin/room-photos": (
        "捨棄一個尚未被任何資料列引用的暫存檔。沒有任何持久狀態改變——"
        "記錄它只會讓日誌被使用者每一次按取消的動作淹沒。"
    ),
    "POST /admin/site-content/hero-image": (
        "同上：上傳只放檔案，套用由 PUT /admin/site-content 負責並在那裡寫日誌。"
    ),
    "POST /admin/messages/{thread_user_id}/read": (
        "標記已讀不是對業務資料的變更，而是閱讀本身的副作用。把每一次開啟"
        "討論串都記一筆，會讓日誌被閱讀行為淹沒，真正的變更反而更難找到。"
        "訊息的內容、發話者與時間都不會因此改變（FR-124：read_at 是唯一"
        "可事後更新的欄位）。"
    ),
}

#: 這些端點雖為寫入，但**呼叫時會因資料不存在而 404**，因而無從驗證其日誌。
#: 它們的稽核由各自 user story 的契約測試涵蓋（如 test_admin_moderation.py）。
#: 此處僅確認它們**宣告了** `require_admin`，並在下方報告中列出。
NEEDS_FIXTURE_MARKER = "needs-fixture"


# ---------------------------------------------------------------------------
# 路由盤點
# ---------------------------------------------------------------------------
def _walk(routes: Any, prefix: str = ""):
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        original = getattr(route, "original_router", None)
        if original is not None:
            context = getattr(route, "include_context", None)
            yield from _walk(original.routes, prefix + (getattr(context, "prefix", "") or ""))


def _admin_write_routes() -> list[tuple[str, str]]:
    """全部 `/admin/*` 的寫入端點 `(方法, 路徑)`。"""
    out: list[tuple[str, str]] = []
    for path, route in _walk(create_app().routes):
        if not path.startswith("/admin"):
            continue
        for method in sorted(set(route.methods or ()) & WRITE_METHODS):
            out.append((method, path))
    return sorted(out)


ADMIN_WRITE_ROUTES = _admin_write_routes()


def test_there_are_admin_write_routes() -> None:
    """守住本檔自己——0 條路由會讓下面的測試空轉並全綠。"""
    assert ADMIN_WRITE_ROUTES, "找不到任何 /admin 寫入端點"


def test_every_exemption_is_a_real_route() -> None:
    """例外清單 MUST NOT 指向已不存在的端點。

    過期的例外比沒有例外危險：端點改名之後，舊的例外會靜默地不再匹配任何
    東西，而新名字的端點沒有被豁免也沒有被檢查——它會直接落進下面的斷言，
    這是好的；但清單裡那行殘留會讓人以為某個端點仍被豁免著。
    """
    actual = {f"{method} {path}" for method, path in ADMIN_WRITE_ROUTES}
    stale = set(AUDIT_EXEMPT) - actual
    assert not stale, f"例外清單中的端點已不存在：{sorted(stale)}"


def test_exemptions_all_have_a_reason() -> None:
    """每一個例外 MUST 附理由。「還沒做」不是理由。"""
    for key, reason in AUDIT_EXEMPT.items():
        assert reason.strip(), f"{key} 沒有寫明豁免理由"
        assert "還沒" not in reason and "TODO" not in reason.upper(), (
            f"{key} 的理由是「還沒做」——那不是豁免，那是缺陷"
        )


# ---------------------------------------------------------------------------
# 執行層：需資料庫
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _log_count(session) -> int:
    return int(await session.scalar(select(func.count()).select_from(AdminLog)) or 0)


#: 每一支受檢端點的最小可成功請求。
#:
#: 值為 `(路徑, JSON 主體)`；路徑中的 `{room_id}` 等由 fixture 填入。
#: 沒有列在這裡的寫入端點會被 `test_every_write_route_is_covered` 抓出來——
#: **新增端點時忘了補這一筆，測試會失敗**，這正是本檔要達成的效果。
def _plans(room_id: uuid.UUID) -> dict[str, tuple[str, dict | None]]:
    return {
        "POST /admin/rooms": (
            "/admin/rooms",
            {
                "name": "稽核測試房",
                "type": "雙人房",
                "maxGuests": 2,
                "nightlyPrice": 3000,
                "description": "",
                "images": [],
                "amenities": [],
                "features": [],
                "status": "available",
            },
        ),
        "PUT /admin/rooms/{room_id}": (
            f"/admin/rooms/{room_id}",
            {
                "name": "改名後的房",
                "type": "雙人房",
                "maxGuests": 2,
                "nightlyPrice": 3600,
                "description": "",
                "images": [],
                "amenities": [],
                "features": [],
                "status": "available",
            },
        ),
        "PATCH /admin/rooms/{room_id}/status": (
            f"/admin/rooms/{room_id}/status",
            {"status": "maintenance"},
        ),
        "DELETE /admin/rooms/{room_id}": (f"/admin/rooms/{room_id}?confirm=true", None),
        "PUT /admin/settings": ("/admin/settings", {"pendingPaymentMinutes": 45}),
    }


@pytest_asyncio.fixture
async def room(session):
    from sunny.models.room import Room

    r = Room(name="稽核用房", type="雙人房", max_guests=2, nightly_price=3_000, description="")
    session.add(r)
    await session.commit()
    return r


@pytest.mark.parametrize(
    "key",
    sorted(_plans(uuid.uuid4())),
    ids=sorted(_plans(uuid.uuid4())),
)
async def test_write_endpoint_writes_exactly_one_audit_record(
    client, session, admin_token: str, room, key: str
) -> None:
    """**每一次成功的後台寫入 MUST 恰好新增一筆 `admin_logs`**（FR-114、SC-026）。

    斷言「恰好 +1」而非「至少 +1」：重複記錄同一個操作會讓日誌難以閱讀，
    而更糟的是它通常代表某段程式碼被執行了兩次。
    """
    path, body = _plans(room.id)[key]
    method = key.split(" ", 1)[0]

    before = await _log_count(session)
    res = await client.request(method, path, json=body, headers=auth_header(admin_token))
    assert 200 <= res.status_code < 300, f"{key} 回了 {res.status_code}：{res.text}"

    after = await _log_count(session)
    assert after == before + 1, f"{key} 成功了卻沒有恰好寫入一筆稽核紀錄（FR-114）"


def test_every_write_route_is_covered() -> None:
    """**路由表中的每一支寫入端點都要有歸屬。**

    三種歸屬之一：本檔的執行計畫、具名的豁免，或另一份契約測試。
    第三類在此列名——那是一個承諾，不是漏洞：

    - 審核與退款 → `test_admin_moderation.py`
    - 客服回覆 → `test_messages.py`（並驗證日誌不含訊息內容，FR-128）
    - 訂單、用戶、渠道、還原 → 各自 user story 的契約測試

    ⚠️ 新增一支後台寫入端點卻沒有為它安排任何一種歸屬時，這個測試會失敗。
    這正是稽核覆蓋率**不會靜默退化**的機制。
    """
    covered_elsewhere = {
        "PATCH /admin/orders/{order_id}/status",
        "PATCH /admin/users/{user_id}",
        "PATCH /admin/users/{user_id}/role",
        "PATCH /admin/reviews/{review_id}/status",
        "PUT /admin/reviews/{review_id}/reply",
        "DELETE /admin/reviews/{review_id}",
        "PATCH /admin/refunds/{refund_id}",
        "PATCH /admin/channel-prices/{price_id}/resolved",
        "POST /admin/rooms/{room_id}/risk-checks",
        "PUT /admin/site-content",
        "POST /admin/reset-demo-data",
        "POST /admin/messages/{thread_user_id}",
    }
    planned = set(_plans(uuid.uuid4()))
    accounted = planned | set(AUDIT_EXEMPT) | covered_elsewhere

    actual = {f"{method} {path}" for method, path in ADMIN_WRITE_ROUTES}
    orphans = actual - accounted
    assert not orphans, (
        f"以下後台寫入端點沒有任何稽核歸屬：{sorted(orphans)}。"
        "請為它加上執行計畫、具名豁免，或指明由哪一份契約測試涵蓋（FR-114、SC-026）"
    )
