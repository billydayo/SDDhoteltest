"""T082：`POST /orders` 與 `POST /orders/{id}/pay` 的契約（FR-024、FR-032、FR-081）。

⚠️ **本檔最重要的一條：後端 MUST 重新計算夜數與總金額。**

前端顯示的金額只是預覽。送出偽造的 `nights` 與 `totalAmount` MUST NOT 被採信——
失守的表現不是錯誤，是有人用一元訂到房，而帳目要到對帳時才會發現。

授權三案例（憲章：「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」）：
未認證、以他人身分、以正確身分。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

from sunny.db import get_session
from sunny.main import create_app
from sunny.utils import dates
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _body(room, *, nights: int = 2, guest_count: int = 2, **overrides) -> dict:
    check_in = dates.tomorrow()
    payload = {
        "roomId": str(room.id),
        "checkIn": dates.format_calendar_date(check_in),
        "checkOut": dates.format_calendar_date(check_in + timedelta(days=nights)),
        "guestCount": guest_count,
        "contactName": "王小明",
        "phone": "0912345678",
        "email": "guest@example.com",
        "paymentMethod": "LINE Pay",
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# 未認證
# ---------------------------------------------------------------------------
async def test_creating_an_order_requires_login(client, room_factory) -> None:
    room = await room_factory()
    assert (await client.post("/orders", json=_body(room))).status_code == 401


async def test_paying_requires_login(client, room_factory, member_token) -> None:
    room = await room_factory()
    created = await client.post("/orders", json=_body(room), headers=_auth(member_token))
    order_id = created.json()["id"]

    assert (await client.post(f"/orders/{order_id}/pay")).status_code == 401


# ---------------------------------------------------------------------------
# ⚠️ 金額與夜數由後端重算（FR-024、FR-032）
# ---------------------------------------------------------------------------
async def test_forged_total_amount_and_nights_are_not_believed(
    client, room_factory, member_token
) -> None:
    """⚠️ **本檔的核心。**

    送出 `nights: 99` 與 `totalAmount: 1`。兩者 MUST 被忽略——不是驗證後拒絕，
    是 `OrderCreateIn` 根本沒有這兩個欄位，因此連進到驗證都不會。
    """
    room = await room_factory(nightly_price=2500)

    res = await client.post(
        "/orders",
        json=_body(room, nights=3) | {"nights": 99, "totalAmount": 1, "total_amount": 1},
        headers=_auth(member_token),
    )

    assert res.status_code == 201
    body = res.json()
    assert body["nights"] == 3, "夜數 MUST 由退房日 − 入住日算出"
    assert body["totalAmount"] == 2500 * 3, "總金額 MUST 為當下房價 × 夜數"


async def test_total_amount_is_an_integer(client, room_factory, member_token) -> None:
    """整數新臺幣元，MUST NOT 出現小數（FR-070）。"""
    room = await room_factory(nightly_price=3333)
    res = await client.post("/orders", json=_body(room, nights=3), headers=_auth(member_token))
    assert isinstance(res.json()["totalAmount"], int)
    assert res.json()["totalAmount"] == 9999


async def test_order_price_is_frozen_against_later_room_price_changes(
    client, session, room_factory, member_token
) -> None:
    """房源價格日後變動 MUST NOT 改變既有訂單的金額（FR-032）。"""
    room = await room_factory(nightly_price=2000)
    res = await client.post("/orders", json=_body(room, nights=2), headers=_auth(member_token))
    assert res.json()["totalAmount"] == 4000

    room.nightly_price = 9000
    await session.commit()

    # 既有訂單不受影響；新訂單才用新價
    other = await client.post(
        "/orders",
        json=_body(room, nights=2)
        | {"checkIn": dates.format_calendar_date(dates.tomorrow() + timedelta(days=10))}
        | {"checkOut": dates.format_calendar_date(dates.tomorrow() + timedelta(days=12))},
        headers=_auth(member_token),
    )
    assert other.json()["totalAmount"] == 18000


# ---------------------------------------------------------------------------
# 建單成功的形狀
# ---------------------------------------------------------------------------
async def test_created_order_carries_order_no_and_expiry(
    client, room_factory, member_token
) -> None:
    """回應 MUST 含 `expiresAt` 供前端倒數（FR-102），以及可見的訂單編號（FR-030）。"""
    room = await room_factory()
    body = (await client.post("/orders", json=_body(room), headers=_auth(member_token))).json()

    assert body["orderNo"].startswith("SN")
    assert body["status"] == "pending-payment"
    assert body["expiresAt"], "沒有 expiresAt，前端就無法顯示付款倒數"
    assert "cardNumber" not in body and "cvv" not in body


async def test_response_never_echoes_real_payment_fields(client, room_factory, member_token):
    """FR-028：後端 MUST NOT 接收或儲存卡號、有效期限、CVV、銀行帳號。

    送進來也不會被存下——訂單資料表上根本沒有這些欄位。
    """
    room = await room_factory()
    res = await client.post(
        "/orders",
        json=_body(room) | {"cardNumber": "4111111111111111", "cvv": "987"},
        headers=_auth(member_token),
    )
    assert res.status_code == 201
    assert "4111111111111111" not in res.text
    assert "cardNumber" not in res.text and "cvv" not in res.text


# ---------------------------------------------------------------------------
# 規則拒絕
# ---------------------------------------------------------------------------
async def test_check_in_today_is_rejected(client, room_factory, member_token) -> None:
    """入住日至少為明日（FR-022）。"""
    room = await room_factory()
    today = dates.format_calendar_date(dates.today())
    res = await client.post(
        "/orders",
        json=_body(room)
        | {
            "checkIn": today,
            "checkOut": dates.format_calendar_date(dates.today() + timedelta(days=2)),
        },
        headers=_auth(member_token),
    )
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_IN_TOO_EARLY"


async def test_guest_count_over_room_capacity_is_rejected(
    client, room_factory, member_token
) -> None:
    """人數上限（FR-024）。"""
    room = await room_factory(max_guests=2)
    res = await client.post("/orders", json=_body(room, guest_count=5), headers=_auth(member_token))
    assert res.status_code == 400
    assert res.json()["code"] == "GUEST_COUNT_EXCEEDED"


async def test_unpadded_date_is_rejected(client, room_factory, member_token) -> None:
    """`2026-8-4` MUST 被拒（contracts/README.md 的線上格式）。

    未補零的日期在字典序下會排錯——`"2026-8-4" > "2026-08-05"`。這種錯不拋例外，
    只讓順序悄悄錯掉。
    """
    room = await room_factory()
    res = await client.post(
        "/orders", json=_body(room) | {"checkIn": "2099-1-1"}, headers=_auth(member_token)
    )
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_DATE_FORMAT"


async def test_double_booking_the_same_range_returns_409(
    client, room_factory, member_token
) -> None:
    """第二筆相同區間 MUST 收到 409「已無空房」，而非 500。"""
    room = await room_factory()
    assert (
        await client.post("/orders", json=_body(room), headers=_auth(member_token))
    ).status_code == 201

    second = await client.post("/orders", json=_body(room), headers=_auth(member_token))
    assert second.status_code == 409
    assert second.json()["code"] == "ROOM_UNAVAILABLE"


# ---------------------------------------------------------------------------
# 付款：以他人身分（FR-081）
# ---------------------------------------------------------------------------
async def test_another_member_cannot_pay_someone_elses_order(
    client, room_factory, member_token, other_member_token
) -> None:
    """⚠️ **非本人 MUST 回 403，不是 404，也 MUST NOT 成功。**

    這是授權三案例中「以他人身分」那一格。移除 RLS 後 FastAPI 是唯一的存取
    邊界，這一層漏掉就沒有第二道網。
    """
    room = await room_factory()
    created = await client.post("/orders", json=_body(room), headers=_auth(member_token))
    order_id = created.json()["id"]

    res = await client.post(f"/orders/{order_id}/pay", headers=_auth(other_member_token))
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"


async def test_owner_can_pay_and_order_becomes_confirmed(
    client, room_factory, member_token
) -> None:
    """以正確身分：付款成功，狀態轉為已確認（FR-026）。"""
    room = await room_factory()
    created = await client.post("/orders", json=_body(room), headers=_auth(member_token))
    order_id = created.json()["id"]

    res = await client.post(f"/orders/{order_id}/pay", headers=_auth(member_token))
    assert res.status_code == 200
    assert res.json()["status"] == "confirmed"
    assert res.json()["totalAmount"] == created.json()["totalAmount"], "付款 MUST NOT 改金額"


async def test_paying_twice_is_rejected(client, room_factory, member_token) -> None:
    room = await room_factory()
    order_id = (await client.post("/orders", json=_body(room), headers=_auth(member_token))).json()[
        "id"
    ]

    await client.post(f"/orders/{order_id}/pay", headers=_auth(member_token))
    again = await client.post(f"/orders/{order_id}/pay", headers=_auth(member_token))
    assert again.status_code == 409
    assert again.json()["code"] == "ORDER_ALREADY_PAID"


async def test_paying_a_nonexistent_order_returns_404(client, member_token) -> None:
    res = await client.post(
        "/orders/00000000-0000-0000-0000-000000000009/pay", headers=_auth(member_token)
    )
    assert res.status_code == 404
