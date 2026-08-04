"""T094：訂單的越權存取（FR-033、FR-034、FR-035a、SC-019）。

⚠️ **SC-019：會員 A 以訂單編號存取會員 B 的訂單 MUST 取不到任何資料。**

移除 RLS 之後，FastAPI 是唯一的一道存取邊界（憲章原則 VI）。這一份測的就是
那一道——它失守的表現不是錯誤畫面，是**一個人看到另一個人的姓名、電話與
電子郵件**，而畫面完全正常。

三案例皆需覆蓋（憲章：「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」）：
未認證、以他人身分、以正確身分。少了中間那一個，一個「登入即放行」的錯誤
會完整通過測試。

## 為什麼非本人回 403 而不是 404

contracts/README.md 明訂。這確實透露了「該 id 的訂單存在」，但訂單 id 是
uuid4，猜不到；而把越權偽裝成「不存在」會讓真正遇到問題的使用者收到誤導的
訊息，前端也無從分辨該導向登入頁還是顯示無權限。

**關鍵是回應主體裡沒有任何訂單資料**——狀態碼是給程式看的，資料外洩才是
真正要防的事。因此每一支越權測試都額外斷言：回應內容裡找不到擁有者的
姓名、電話與電子郵件。
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

#: 訂單上屬於**擁有者**的個資。任何一則越權回應裡都不該出現。
OWNER_NAME = "王小明"
OWNER_PHONE = "0912345678"
OWNER_EMAIL = "owner@example.com"


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


def _body(room, *, days_ahead: int = 1, nights: int = 2) -> dict:
    check_in = dates.today() + timedelta(days=days_ahead)
    return {
        "roomId": str(room.id),
        "checkIn": dates.format_calendar_date(check_in),
        "checkOut": dates.format_calendar_date(check_in + timedelta(days=nights)),
        "guestCount": 2,
        "contactName": OWNER_NAME,
        "phone": OWNER_PHONE,
        "email": OWNER_EMAIL,
        "paymentMethod": "LINE Pay",
    }


@pytest_asyncio.fixture
async def owned_order(client, room_factory, member_token) -> dict:
    """一筆屬於 `member` 的待付款訂單。"""
    room = await room_factory()
    res = await client.post("/orders", json=_body(room), headers=_auth(member_token))
    assert res.status_code == 201, res.text
    return res.json()


def assert_no_owner_data_leaked(res: httpx.Response) -> None:
    """⚠️ 回應裡 MUST NOT 出現擁有者的任何個資。

    只斷言狀態碼是不夠的：一支回 403 卻仍在錯誤訊息裡附上聯絡人姓名的端點，
    照樣洩漏了資料，而狀態碼看起來完全正確。
    """
    body = res.text
    for secret in (OWNER_NAME, OWNER_PHONE, OWNER_EMAIL):
        assert secret not in body, f"越權回應洩漏了擁有者資料：{secret!r} 出現在 {body!r}"


# ---------------------------------------------------------------------------
# GET /orders —— 列表（FR-033）
# ---------------------------------------------------------------------------
async def test_listing_orders_requires_login(client) -> None:
    assert (await client.get("/orders")).status_code == 401


async def test_another_member_sees_an_empty_list_not_someone_elses_orders(
    client, owned_order, other_member_token
) -> None:
    """⚠️ **SC-019 的核心。**

    另一個人的列表 MUST 是空的。這裡若漏掉 `where user_id = ...`，回來的是
    全站所有訂單——而畫面上那看起來只是「訂單很多」。
    """
    res = await client.get("/orders", headers=_auth(other_member_token))
    assert res.status_code == 200, res.text
    assert res.json() == []
    assert_no_owner_data_leaked(res)


async def test_the_owner_sees_their_own_order(client, owned_order, member_token) -> None:
    res = await client.get("/orders", headers=_auth(member_token))
    assert res.status_code == 200, res.text
    orders = res.json()
    assert [o["id"] for o in orders] == [owned_order["id"]]


async def test_the_list_is_sorted_by_check_in_date(client, room_factory, member_token) -> None:
    """FR-033：**依入住日排序。**

    以建立時間排序看起來很像對的——多數情況下兩者順序相同，直到有人補訂一個
    比較早的日期。那時他的下一趟行程會排在列表最下面，而他正是為了確認那一趟
    才打開這一頁。
    """
    room_a = await room_factory()
    room_b = await room_factory()

    # 先建立比較晚的那一筆，讓「建立時間排序」與「入住日排序」給出不同答案
    later = await client.post(
        "/orders", json=_body(room_a, days_ahead=30), headers=_auth(member_token)
    )
    earlier = await client.post(
        "/orders", json=_body(room_b, days_ahead=3), headers=_auth(member_token)
    )
    assert later.status_code == 201 and earlier.status_code == 201, (later.text, earlier.text)

    res = await client.get("/orders", headers=_auth(member_token))
    ids = [o["id"] for o in res.json()]
    assert ids == [earlier.json()["id"], later.json()["id"]], "MUST 依入住日由近而遠"


# ---------------------------------------------------------------------------
# GET /orders/{id} —— 單筆（FR-034、SC-019）
# ---------------------------------------------------------------------------
async def test_reading_one_order_requires_login(client, owned_order) -> None:
    res = await client.get(f"/orders/{owned_order['id']}")
    assert res.status_code == 401
    assert_no_owner_data_leaked(res)


async def test_another_member_cannot_read_the_order_by_its_id(
    client, owned_order, other_member_token
) -> None:
    """⚠️ 拿著訂單 id 直接查——這是最直接的越權嘗試。"""
    res = await client.get(f"/orders/{owned_order['id']}", headers=_auth(other_member_token))
    assert res.status_code == 403, res.text
    assert_no_owner_data_leaked(res)


async def test_the_owner_can_read_their_own_order(client, owned_order, member_token) -> None:
    res = await client.get(f"/orders/{owned_order['id']}", headers=_auth(member_token))
    assert res.status_code == 200, res.text
    assert res.json()["id"] == owned_order["id"]
    assert res.json()["contactName"] == OWNER_NAME


async def test_an_unknown_order_id_is_404_not_403(client, member_token) -> None:
    """不存在與無權限 MUST 分得開，否則前端無從決定要顯示什麼。"""
    missing = "00000000-0000-4000-8000-000000000000"
    res = await client.get(f"/orders/{missing}", headers=_auth(member_token))
    assert res.status_code == 404, res.text


# ---------------------------------------------------------------------------
# POST /orders/{id}/cancel —— 取消（FR-035a）
# ---------------------------------------------------------------------------
async def test_cancelling_requires_login(client, owned_order) -> None:
    assert (await client.post(f"/orders/{owned_order['id']}/cancel")).status_code == 401


async def test_another_member_cannot_cancel_the_order(
    client, owned_order, other_member_token, member_token
) -> None:
    """⚠️ 越權取消比越權讀取更嚴重：他把別人的房間放掉了，而那個人不會收到通知。"""
    res = await client.post(
        f"/orders/{owned_order['id']}/cancel", headers=_auth(other_member_token)
    )
    assert res.status_code == 403, res.text
    assert_no_owner_data_leaked(res)

    # ⚠️ 光看狀態碼不夠：回 403 卻仍然把訂單取消掉的實作，測試照樣會通過。
    check = await client.get(f"/orders/{owned_order['id']}", headers=_auth(member_token))
    assert check.json()["status"] == "pending-payment", "被拒絕的請求 MUST NOT 產生任何副作用"


async def test_the_owner_can_cancel_a_pending_payment_order(
    client, owned_order, member_token
) -> None:
    res = await client.post(f"/orders/{owned_order['id']}/cancel", headers=_auth(member_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelled"
    # ⚠️ MUST 與逾時取消分得開——兩者都計入「未付款取消訂單數」，
    # 但「客人自己改變主意」與「付款流程有問題」是完全不同的營運訊號。
    assert body["cancelReason"] == "member-cancelled"


async def test_a_confirmed_order_cannot_be_cancelled_directly(
    client, owned_order, member_token
) -> None:
    """⚠️ **FR-035a：已確認的訂單 MUST NOT 提供直接取消。**

    款項已付，取消必須走退款申請與管理員審核——否則就繞過了 FR-041 的退款
    級距，入住前一天取消也能全額拿回。

    這一條由**伺服器端**強制，MUST NOT 只靠前端把按鈕藏起來（FR-081）。
    """
    paid = await client.post(f"/orders/{owned_order['id']}/pay", headers=_auth(member_token))
    assert paid.status_code == 200, paid.text

    res = await client.post(f"/orders/{owned_order['id']}/cancel", headers=_auth(member_token))
    assert res.status_code == 409, res.text
    payload = res.json()
    # 訊息 MUST 指出下一步，而不只是「不允許」
    assert "退款" in payload["detail"], payload

    still = await client.get(f"/orders/{owned_order['id']}", headers=_auth(member_token))
    assert still.json()["status"] == "confirmed"


async def test_cancelling_twice_is_rejected(client, owned_order, member_token) -> None:
    first = await client.post(f"/orders/{owned_order['id']}/cancel", headers=_auth(member_token))
    assert first.status_code == 200, first.text

    second = await client.post(f"/orders/{owned_order['id']}/cancel", headers=_auth(member_token))
    assert second.status_code == 409, second.text


async def test_cancelling_releases_the_dates_immediately(
    client, room_factory, member_token, other_member_token
) -> None:
    """FR-035a：取消後該日期區間 MUST **立即**釋出。

    「立即」不是修辭：房間放著沒人能訂，直到某個排程跑過，是這一條最常見的
    失敗方式，而它沒有任何錯誤訊息。這裡以「另一個人馬上訂得到」來驗證。
    """
    room = await room_factory()
    body = _body(room, days_ahead=5)

    first = await client.post("/orders", json=body, headers=_auth(member_token))
    assert first.status_code == 201, first.text

    blocked = await client.post("/orders", json=body, headers=_auth(other_member_token))
    assert blocked.status_code == 409, "同區間本來就該訂不到"

    cancelled = await client.post(
        f"/orders/{first.json()['id']}/cancel", headers=_auth(member_token)
    )
    assert cancelled.status_code == 200, cancelled.text

    now_free = await client.post("/orders", json=body, headers=_auth(other_member_token))
    assert now_free.status_code == 201, f"取消後該區間 MUST 立即可訂：{now_free.text}"
