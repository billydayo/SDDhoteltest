"""T130：評論與退款審核的契約（US7、FR-056、FR-057、FR-103b~d、SC-006）。

兩件事在此驗證：

1. **三案例授權**——未認證 401、一般會員 403、管理員放行。
2. **核准退款後該房源該區間於下一次搜尋重新出現**（SC-006）。

## 第 2 點為什麼值得一個獨立測試

`test_admin_authz.py` 會列舉全部 `/admin/*` 路由做授權掃描，本檔的第 1 點因而
與它重疊——重疊是刻意的。那份是「每條路由都有守衛」的普查，這份是「這幾條
路由的行為正確」的深查；普查全綠但退款核准後房間放不出來，是完全可能的。

SC-006 是整個退款流程唯一對外可觀察的結果。核准之後若區間沒有釋回，
沒有任何錯誤訊息會出現——房間只是安靜地賣不出去，直到有人手動比對訂單表。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport
from sqlalchemy import select

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.order import STATUS_CONFIRMED, STATUS_REFUND_PENDING, Order
from sunny.models.refund import Refund
from sunny.models.review import STATUS_APPROVED, STATUS_PENDING, VERDICT_PASS, Review
from sunny.models.room import Room
from sunny.utils import dates
from tests.conftest import auth_header, requires_db

pytestmark = requires_db


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# 測試資料
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def room(session) -> Room:
    r = Room(name="測試房", type="雙人房", max_guests=2, nightly_price=3_000, description="")
    session.add(r)
    await session.commit()
    return r


def _stay() -> tuple[date, date]:
    """一段**未來**的住宿區間。

    用未來日期而非今天：`expire_stale_orders()` 只看 `expires_at`，但以過去
    日期建單會讓「已完成」與「進行中」的判定混在一起，日後讀這份測試的人
    得先想清楚今天是第幾天。
    """
    start = dates.today() + timedelta(days=30)
    return start, start + timedelta(days=2)


async def _make_order(session, *, room: Room, user_id: uuid.UUID, status: str) -> Order:
    check_in, check_out = _stay()
    order = Order(
        order_no=f"SN{uuid.uuid4().hex[:12].upper()}",
        user_id=user_id,
        room_id=room.id,
        check_in=check_in,
        check_out=check_out,
        nights=(check_out - check_in).days,
        guest_count=2,
        contact_name="王小明",
        phone="0912345678",
        email="guest@example.com",
        payment_method="LINE Pay",
        total_amount=6_000,
        status=status,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    session.add(order)
    await session.commit()
    return order


@pytest_asyncio.fixture
async def pending_refund(session, room: Room, member) -> Refund:
    """一筆待審核的退款，其訂單處於 `refund-pending`（佔著房況）。"""
    order = await _make_order(session, room=room, user_id=member.id, status=STATUS_REFUND_PENDING)
    refund = Refund(order_id=order.id, user_id=member.id, reason="行程有變", amount=6_000)
    session.add(refund)
    await session.commit()
    return refund


@pytest_asyncio.fixture
async def pending_review(session, room: Room, member) -> Review:
    """一則待審核評論，自動審核初判為通過。"""
    order = await _make_order(session, room=room, user_id=member.id, status=STATUS_CONFIRMED)
    review = Review(
        order_id=order.id,
        room_id=room.id,
        user_id=member.id,
        rating=5,
        comment="房間乾淨，採光很好。",
        category="cleanliness",
        status=STATUS_PENDING,
        auto_verdict=VERDICT_PASS,
        auto_rules=["no-banned-words"],
    )
    session.add(review)
    await session.commit()
    return review


# ---------------------------------------------------------------------------
# 三案例授權
# ---------------------------------------------------------------------------
#: (方法, 路徑樣板, 請求主體)。`{id}` 於呼叫時替換。
_ENDPOINTS = [
    ("GET", "/admin/reviews", None),
    ("PATCH", "/admin/reviews/{id}/status", {"status": "approved"}),
    ("PUT", "/admin/reviews/{id}/reply", {"reply": "謝謝您的回饋。"}),
    ("DELETE", "/admin/reviews/{id}", None),
    ("GET", "/admin/refunds", None),
    ("PATCH", "/admin/refunds/{id}", {"decision": "approve"}),
]
_IDS = [f"{m} {p}" for m, p, _ in _ENDPOINTS]


async def _call(client, method: str, template: str, body, headers=None):
    path = template.replace("{id}", str(uuid.uuid4()))
    return await client.request(method, path, json=body, headers=headers)


@pytest.mark.parametrize(("method", "template", "body"), _ENDPOINTS, ids=_IDS)
async def test_unauthenticated_gets_401(client, method: str, template: str, body) -> None:
    res = await _call(client, method, template, body)
    assert res.status_code == 401
    assert res.json()["code"] in {"NOT_AUTHENTICATED", "TOKEN_INVALID"}


@pytest.mark.parametrize(("method", "template", "body"), _ENDPOINTS, ids=_IDS)
async def test_member_gets_403(client, member_token, method: str, template: str, body) -> None:
    """一般會員 MUST 被擋下。**這一格是 SC-008 的直接對應。**"""
    res = await _call(client, method, template, body, headers=auth_header(member_token))
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"


@pytest.mark.parametrize(("method", "template", "body"), _ENDPOINTS, ids=_IDS)
async def test_admin_is_not_blocked(client, admin_token, method: str, template: str, body) -> None:
    """管理員 MUST 不被授權擋下。

    用的是不存在的 id，因此 404 是預期內的正確回應——這裡只斷言**不是**
    401／403。授權 MUST 在「資源存不存在」之前判定。
    """
    res = await _call(client, method, template, body, headers=auth_header(admin_token))
    assert res.status_code not in (401, 403)


# ---------------------------------------------------------------------------
# SC-006：核准退款後區間釋回
# ---------------------------------------------------------------------------
async def test_approving_a_refund_releases_the_interval(
    client, session, admin_token, pending_refund: Refund, room: Room
) -> None:
    """**核准後該房源該區間 MUST 於下一次搜尋重新出現。**

    先確認核准前搜不到（訂單以 `refund-pending` 佔著房況），核准後搜得到。
    只驗證後半段是不夠的——若搜尋根本沒套用日期條件，兩次都會回傳該房源，
    測試照樣全綠。
    """
    check_in, check_out = _stay()
    # guestCount MUST 一併帶上：FR-010 規定填了日期就要填人數，少了它 `/rooms`
    # 回 400，而「400 的回應裡當然找不到這個房源」會讓下面那句斷言看起來通過。
    params = {
        "checkIn": check_in.isoformat(),
        "checkOut": check_out.isoformat(),
        "guestCount": 2,
    }

    before = await client.get("/rooms", params=params)
    assert before.status_code == 200
    assert str(room.id) not in [r["id"] for r in before.json()], (
        "退款審核中的訂單仍應佔著房況——這段期間該房源不該可訂"
    )

    approved = await client.patch(
        f"/admin/refunds/{pending_refund.id}",
        json={"decision": "approve"},
        headers=auth_header(admin_token),
    )
    assert approved.status_code == 200, approved.text

    after = await client.get("/rooms", params=params)
    assert str(room.id) in [r["id"] for r in after.json()], (
        "核准退款後該區間 MUST 重新可訂（SC-006）"
    )


async def test_rejecting_a_refund_keeps_the_interval_occupied(
    client, session, admin_token, pending_refund: Refund, room: Room
) -> None:
    """駁回後訂單回到 `confirmed`——**區間仍被佔著**（FR-039）。

    駁回不是取消。客人的錢還在、房間還是他的，若此時區間被釋出，
    另一個人就能訂走同一晚，而原訂單依然有效——那是超賣。
    """
    check_in, check_out = _stay()

    res = await client.patch(
        f"/admin/refunds/{pending_refund.id}",
        json={"decision": "reject", "note": "不符退款條件"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text

    order = await session.scalar(select(Order).where(Order.id == pending_refund.order_id))
    assert order is not None
    assert order.status == STATUS_CONFIRMED, "駁回後訂單 MUST 回到已確認，而非停在退款申請中"

    after = await client.get(
        "/rooms",
        params={
            "checkIn": check_in.isoformat(),
            "checkOut": check_out.isoformat(),
            # 同上：沒有 guestCount 會拿到 400，而 400 的 body 裡自然沒有這個
            # 房源，斷言便會以錯誤的理由通過（FR-010）。
            "guestCount": 2,
        },
    )
    assert after.status_code == 200, after.text
    assert str(room.id) not in [r["id"] for r in after.json()]


async def test_a_reviewed_refund_cannot_be_reviewed_again(
    client, admin_token, pending_refund: Refund
) -> None:
    """重複審核 MUST 被擋下（409）。

    兩位管理員同時打開待審清單時會發生。靜默覆蓋前一個人的決定，會讓稽核
    紀錄上的「誰核准的」對不上實際結果。
    """
    first = await client.patch(
        f"/admin/refunds/{pending_refund.id}",
        json={"decision": "approve"},
        headers=auth_header(admin_token),
    )
    assert first.status_code == 200

    second = await client.patch(
        f"/admin/refunds/{pending_refund.id}",
        json={"decision": "reject"},
        headers=auth_header(admin_token),
    )
    assert second.status_code == 409
    assert second.json()["code"] == "REFUND_ALREADY_REVIEWED"


# ---------------------------------------------------------------------------
# 評論審核與業者回覆
# ---------------------------------------------------------------------------
async def test_approving_a_review_publishes_it_and_updates_the_room_rating(
    client, session, admin_token, pending_review: Review, room: Room
) -> None:
    """通過審核後該評論公開，且房源平均評分由 trigger 重算（FR-046）。"""
    assert room.average_rating is None, "尚無通過審核的評論時 MUST 為 null 而非 0（FR-047）"

    res = await client.patch(
        f"/admin/reviews/{pending_review.id}/status",
        json={"status": "approved"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == STATUS_APPROVED

    await session.refresh(room)
    assert room.average_rating is not None
    assert float(room.average_rating) == pytest.approx(5.0)


async def test_pending_review_cannot_be_replied_to(
    client, admin_token, pending_review: Review
) -> None:
    """**待審核的評論 MUST NOT 提供回覆入口**（FR-103d）。

    前台看不到那則評論。替它寫回覆，寫的人會以為已經回應了客訴，
    而客人一個字也沒看到。
    """
    res = await client.put(
        f"/admin/reviews/{pending_review.id}/reply",
        json={"reply": "感謝您的指教，我們會改進。"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 409
    assert res.json()["code"] == "REVIEW_NOT_PUBLISHED"


async def test_reply_can_be_written_updated_and_withdrawn(
    client, admin_token, pending_review: Review
) -> None:
    """撰寫 → 修改 → 收回。**清空內容等同收回**（FR-103d）。"""
    await client.patch(
        f"/admin/reviews/{pending_review.id}/status",
        json={"status": "approved"},
        headers=auth_header(admin_token),
    )
    url = f"/admin/reviews/{pending_review.id}/reply"

    created = await client.put(
        url, json={"reply": "謝謝您的回饋。"}, headers=auth_header(admin_token)
    )
    assert created.status_code == 200, created.text
    assert created.json()["adminReply"] == "謝謝您的回饋。"
    assert created.json()["adminReplyAt"] is not None

    updated = await client.put(
        url, json={"reply": "謝謝您的回饋，期待再次為您服務。"}, headers=auth_header(admin_token)
    )
    assert updated.json()["adminReply"].endswith("再次為您服務。")

    # 空白字串亦視為收回——使用者按 Backspace 清空後送出，與按「收回」同義
    withdrawn = await client.put(url, json={"reply": "   "}, headers=auth_header(admin_token))
    assert withdrawn.status_code == 200
    assert withdrawn.json()["adminReply"] is None
    assert withdrawn.json()["adminReplyAt"] is None, "收回後時間戳 MUST 一併清除"


async def test_review_out_never_exposes_the_replying_admin(
    client, admin_token, pending_review: Review
) -> None:
    """回覆代表店家，**MUST NOT 顯示回覆者姓名**（FR-103d）。

    前台由同一份 schema 渲染。只要 `adminReplyBy` 不在輸出裡，前台就沒有東西
    可顯示——這比要求前端「記得不要顯示」可靠。
    """
    await client.patch(
        f"/admin/reviews/{pending_review.id}/status",
        json={"status": "approved"},
        headers=auth_header(admin_token),
    )
    res = await client.put(
        f"/admin/reviews/{pending_review.id}/reply",
        json={"reply": "謝謝。"},
        headers=auth_header(admin_token),
    )
    body = res.json()
    assert "adminReplyBy" not in body
    assert "admin_reply_by" not in body


async def test_deleting_a_published_review_recomputes_the_rating(
    client, session, admin_token, pending_review: Review, room: Room
) -> None:
    """刪除已公開評論後平均評分回到 **null**（FR-103c、FR-047）。

    回到 null 而非 0：0 分會被讀成「評價極差」，而實際上是已經沒有評價了。
    """
    await client.patch(
        f"/admin/reviews/{pending_review.id}/status",
        json={"status": "approved"},
        headers=auth_header(admin_token),
    )
    await session.refresh(room)
    assert room.average_rating is not None

    res = await client.delete(
        f"/admin/reviews/{pending_review.id}", headers=auth_header(admin_token)
    )
    assert res.status_code == 204

    await session.refresh(room)
    assert room.average_rating is None
