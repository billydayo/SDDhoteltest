"""T096a：退款端點的授權（FR-036、FR-037、FR-081）。

三案例皆需覆蓋：未認證、以他人身分、以正確身分。

## 為什麼越權申請退款特別嚴重

它不是唯讀的越權。一筆針對別人訂單的退款申請一旦寫進去：

- 那張訂單會轉為 `refund-pending`，擁有者在「我的訂單」看到一個他沒有做過的
  狀態變更；
- 管理員核准後，那個人的住宿就沒了，而**他從頭到尾不知道發生什麼事**；
- 而且這筆申請佔用的是**申請人**的額度，被害者連額度都沒被動到——
  從資料上看不出異常。

因此每一支越權測試都額外回頭確認：訂單的狀態沒有變、資料庫裡沒有多出一列。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport
from sqlalchemy import func, select

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.refund import Refund
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


async def _confirmed_order(client, room, token: str, *, days_ahead: int = 30) -> dict:
    """一筆已付款的訂單——退款申請只對這種訂單成立（FR-035）。"""
    check_in = dates.today() + timedelta(days=days_ahead)
    created = await client.post(
        "/orders",
        json={
            "roomId": str(room.id),
            "checkIn": dates.format_calendar_date(check_in),
            "checkOut": dates.format_calendar_date(check_in + timedelta(days=2)),
            "guestCount": 2,
            "contactName": "王小明",
            "phone": "0912345678",
            "email": "owner@example.com",
            "paymentMethod": "LINE Pay",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    paid = await client.post(f"/orders/{created.json()['id']}/pay", headers=_auth(token))
    assert paid.status_code == 200, paid.text
    return paid.json()


@pytest_asyncio.fixture
async def owned_order(client, room_factory, member_token) -> dict:
    return await _confirmed_order(client, await room_factory(), member_token)


async def _refund_count(session) -> int:
    return await session.scalar(select(func.count()).select_from(Refund)) or 0


# ---------------------------------------------------------------------------
# POST /refunds —— 未認證
# ---------------------------------------------------------------------------
async def test_requesting_a_refund_requires_login(client, owned_order, session) -> None:
    res = await client.post("/refunds", json={"orderId": owned_order["id"], "reason": "行程有變。"})
    assert res.status_code == 401
    assert await _refund_count(session) == 0


async def test_listing_refunds_requires_login(client) -> None:
    assert (await client.get("/refunds")).status_code == 401


# ---------------------------------------------------------------------------
# POST /refunds —— 以他人身分（FR-081）
# ---------------------------------------------------------------------------
async def test_a_member_cannot_request_a_refund_on_someone_elses_order(
    client, owned_order, other_member_token, member_token, session
) -> None:
    """⚠️ **本檔的核心。**

    另一個人拿著訂單 id 送出退款申請。MUST 被拒，且 MUST NOT 留下任何痕跡。
    """
    res = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "我想退。"},
        headers=_auth(other_member_token),
    )
    assert res.status_code == 403, res.text

    # ⚠️ 只看狀態碼不夠：回 403 卻仍然寫入的實作，測試照樣會通過
    assert await _refund_count(session) == 0, "被拒絕的申請 MUST NOT 留下資料"

    still = await client.get(f"/orders/{owned_order['id']}", headers=_auth(member_token))
    assert still.json()["status"] == "confirmed", "擁有者的訂單狀態 MUST 沒有被動過"


async def test_an_unknown_order_is_404_not_403(client, member_token) -> None:
    missing = "00000000-0000-4000-8000-000000000000"
    res = await client.post(
        "/refunds",
        json={"orderId": missing, "reason": "行程有變。"},
        headers=_auth(member_token),
    )
    assert res.status_code == 404, res.text


# ---------------------------------------------------------------------------
# POST /refunds —— 以正確身分
# ---------------------------------------------------------------------------
async def test_the_owner_can_request_a_refund(client, owned_order, member_token) -> None:
    res = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "臨時有事無法前往。"},
        headers=_auth(member_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "pending"
    assert body["orderId"] == owned_order["id"]
    # 金額由後端依級距算出（FR-041）。⚠️ 請求裡沒有 amount 欄位可以偽造。
    assert isinstance(body["amount"], int)

    order = await client.get(f"/orders/{owned_order['id']}", headers=_auth(member_token))
    assert order.json()["status"] == "refund-pending"


async def test_the_reason_is_required(client, owned_order, member_token) -> None:
    """FR-035：**MUST 填寫退款原因。**

    空白原因對管理員毫無用處——他要據此決定核准與否。允許空白等於讓每一筆
    申請都要回頭問一次。
    """
    for reason in ("", "   "):
        res = await client.post(
            "/refunds",
            json={"orderId": owned_order["id"], "reason": reason},
            headers=_auth(member_token),
        )
        assert res.status_code == 400, f"{reason!r} 應被拒：{res.text}"
        assert res.json().get("field") == "reason", res.json()


async def test_a_forged_amount_is_not_believed(client, owned_order, member_token) -> None:
    """⚠️ 送出 `amount: 999999` MUST 不被採信。

    退款金額由級距算出（FR-041）。收下前端送來的值，等於讓人自訂要退多少錢。
    """
    res = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "行程有變。", "amount": 999_999},
        headers=_auth(member_token),
    )
    assert res.status_code == 201, res.text
    assert res.json()["amount"] == owned_order["totalAmount"], "距入住 30 天 MUST 為全額"


async def test_two_pending_refunds_on_the_same_order_are_rejected(
    client, owned_order, member_token
) -> None:
    """FR-036：同一訂單 MUST NOT 同時存在兩筆審核中的申請。"""
    first = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "行程有變。"},
        headers=_auth(member_token),
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "再申請一次。"},
        headers=_auth(member_token),
    )
    assert second.status_code == 409, second.text
    assert "審核" in second.json()["detail"], second.json()


# ---------------------------------------------------------------------------
# GET /refunds —— 只回本人的（FR-037、FR-081）
# ---------------------------------------------------------------------------
async def test_the_list_contains_only_my_own_refunds(
    client, room_factory, member_token, other_member_token
) -> None:
    """⚠️ 漏掉 `where user_id = ...` 的話，每個人都看得到全站的退款申請——
    含別人的訂單編號與退款原因，而退款原因往往寫著私事。
    """
    mine = await _confirmed_order(client, await room_factory(), member_token, days_ahead=40)
    theirs = await _confirmed_order(client, await room_factory(), other_member_token, days_ahead=50)

    assert (
        await client.post(
            "/refunds",
            json={"orderId": mine["id"], "reason": "我的原因。"},
            headers=_auth(member_token),
        )
    ).status_code == 201
    assert (
        await client.post(
            "/refunds",
            json={"orderId": theirs["id"], "reason": "別人的私事。"},
            headers=_auth(other_member_token),
        )
    ).status_code == 201

    res = await client.get("/refunds", headers=_auth(member_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert [r["orderId"] for r in rows] == [mine["id"]]
    assert "別人的私事。" not in res.text, "MUST NOT 洩漏他人的退款原因"


async def test_the_list_is_empty_for_a_member_who_never_applied(
    client, owned_order, other_member_token
) -> None:
    res = await client.get("/refunds", headers=_auth(other_member_token))
    assert res.status_code == 200
    assert res.json() == []


async def test_the_progress_is_visible_to_the_applicant(client, owned_order, member_token) -> None:
    """FR-037：會員 MUST 能查詢審核進度與結果。"""
    created = await client.post(
        "/refunds",
        json={"orderId": owned_order["id"], "reason": "行程有變。"},
        headers=_auth(member_token),
    )
    assert created.status_code == 201, created.text

    row = (await client.get("/refunds", headers=_auth(member_token))).json()[0]
    assert row["status"] == "pending"
    assert row["reason"] == "行程有變。"
    assert row["createdAt"]
    # 尚未審核時 MUST 是 null，MUST NOT 是空字串或建立時間
    assert row["reviewedAt"] is None
    assert row["adminNote"] is None
