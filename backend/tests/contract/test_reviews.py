"""T106：評論的權限契約（FR-042、FR-043、FR-045、FR-048、SC-007）。

三條，每一條失守的方式都不會拋錯：

1. **沒有該房源已完成訂單的人不可評論**（FR-042）——失守的樣子是有人替沒住過
   的房源打分，而那筆評分會計入房源平均（FR-046）。
2. **同一訂單重複評論回 409**（FR-043）——失守的樣子是同一個人洗出十則五星。
3. **未通過審核的評論在公開端點的出現次數為 0**（FR-045、SC-007）——失守的
   樣子最安靜：前台多出幾則沒有人看過的評價，畫面完全正常。

授權三案例（憲章：「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」）：
未認證、以他人身分、以正確身分。移除 RLS 後 FastAPI 是唯一的存取邊界。

## 為什麼直接以 ORM 插入「已完成」訂單

沒有任何 API 能把訂單推到 `completed`（那是住宿結束後的狀態）。經由
`POST /orders` 再改狀態也不行——`orders_guard_transition` 是 before **update**
觸發器，而我們要的是一筆一開始就已完成的訂單。直接插入是最接近真實資料的做法，
且不繞過任何被測邏輯：評論端點讀的就是 `orders.status`。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.order import STATUS_COMPLETED, STATUS_CONFIRMED, Order
from sunny.models.review import STATUS_APPROVED, Review
from sunny.utils import dates
from tests.conftest import auth_header, requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

#: 一段夠長、不觸發任何退件規則的內文（見 `services/moderation.py`）。
#: 刻意不用「很棒」這類詞——那些是矛盾偵測的標記，換一個評分就會意外觸發。
GOOD_COMMENT = "房間比想像中寬敞，早餐的選擇也多，下次來這一帶還會再訂一次。"


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def order_factory(session):
    """建立一筆訂單，預設為**已完成入住**。

    日期一律取過去的區間並隨機錯開：`orders_no_overlap` 不管 `completed`，
    但同一份測試裡若有 `confirmed` 的樣本落在同一段日期就會撞上，而那個錯誤
    （409 ROOM_UNAVAILABLE）看起來會像被測的評論邏輯出了問題。
    """
    offset = 0

    async def _make(*, user, room, status: str = STATUS_COMPLETED, nights: int = 2) -> Order:
        nonlocal offset
        offset += nights + 1
        check_in = dates.today() - timedelta(days=offset + 30)
        order = Order(
            user_id=user.id,
            room_id=room.id,
            check_in=check_in,
            check_out=check_in + timedelta(days=nights),
            nights=nights,
            guest_count=2,
            contact_name="王小明",
            phone="0912345678",
            email="guest@example.com",
            payment_method="LINE Pay",
            total_amount=room.nightly_price * nights,
            status=status,
        )
        session.add(order)
        await session.commit()
        return order

    return _make


def _body(order: Order, **overrides) -> dict:
    payload = {
        "orderId": str(order.id),
        "rating": 5,
        "comment": GOOD_COMMENT,
        "category": "住宿體驗",
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# 案例一：未認證
# ---------------------------------------------------------------------------
async def test_writing_a_review_requires_login(client, member, room_factory, order_factory) -> None:
    """**MUST 是 401 而非 403**——前端據此導向登入頁。"""
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    res = await client.post("/reviews", json=_body(order))
    assert res.status_code == 401
    assert res.json()["code"] in {"NOT_AUTHENTICATED", "TOKEN_INVALID"}


# ---------------------------------------------------------------------------
# 案例二：他人身分 —— ⚠️ 本檔的核心（FR-042）
# ---------------------------------------------------------------------------
async def test_a_member_cannot_review_another_members_order(
    client, member, other_member_token, room_factory, order_factory
) -> None:
    """拿別人的已完成訂單去評論 MUST 被拒（FR-042）。

    **403 而非 404**（contracts/README.md）。這確實透露該 id 的訂單存在，
    但訂單 id 是 uuid4、猜不到；而偽裝成「不存在」會讓真正遇到問題的人
    收到誤導的訊息。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    res = await client.post("/reviews", json=_body(order), headers=auth_header(other_member_token))
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"


async def test_a_member_without_any_order_cannot_review(client, member_token) -> None:
    """沒有訂單就沒有評論的入口——訂單 id 不存在時回 404（FR-042）。"""
    res = await client.post(
        "/reviews",
        json={
            "orderId": str(uuid.uuid4()),
            "rating": 5,
            "comment": GOOD_COMMENT,
            "category": "住宿體驗",
        },
        headers=auth_header(member_token),
    )
    assert res.status_code == 404
    assert res.json()["code"] == "ORDER_NOT_FOUND"


async def test_an_unfinished_stay_cannot_be_reviewed_yet(
    client, member, member_token, room_factory, order_factory
) -> None:
    """已付款但還沒入住完成 → **409，且訊息 MUST 說明何時才能寫**（FR-042）。

    與前兩種拒絕分開回答是刻意的：這一種只要等到退房之後就會變成可以，
    另外兩種等到天荒地老都不會變。合併成一句「無法評論」會讓一位下週才入住
    的房客以為自己的帳號有問題。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room, status=STATUS_CONFIRMED)

    res = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))
    assert res.status_code == 409
    assert res.json()["code"] == "ORDER_NOT_COMPLETED"
    assert "退房" in res.json()["detail"], "訊息 MUST 指出何時才能撰寫評論"


# ---------------------------------------------------------------------------
# 案例三：正確身分
# ---------------------------------------------------------------------------
async def test_the_guest_who_stayed_can_review(
    client, member, member_token, room_factory, order_factory
) -> None:
    """住過的人寫得出評論，且**送出後一律為待審核**（FR-045、FR-103）。"""
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    res = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))
    assert res.status_code == 201

    body = res.json()
    assert body["status"] == "pending", "評論 MUST NOT 因自動審核通過而直接公開"
    assert body["roomId"] == str(room.id), "房源 MUST 由訂單推導"


async def test_the_author_is_not_told_which_rules_fired(
    client, member, member_token, room_factory, order_factory
) -> None:
    """⚠️ 回應 MUST NOT 含 `autoVerdict` 或 `autoRules`（FR-103a 的實務面）。

    告訴作者「你觸發了 banned-word」等於附上一份規避指南——換掉那個詞就能
    通過，而審核要擋的不是用詞不巧的人。初判只出現在後台（FR-103b）。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    res = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))
    body = res.json()

    assert "autoVerdict" not in body
    assert "autoRules" not in body


# ---------------------------------------------------------------------------
# 一筆訂單一則評論（FR-043）
# ---------------------------------------------------------------------------
async def test_reviewing_the_same_order_twice_is_409(
    client, member, member_token, room_factory, order_factory
) -> None:
    """第二次送出 MUST 回 409（FR-043）。

    保證來自資料庫的 `reviews_order_id_key`，不是應用層的預先檢查——查了再寫
    仍有競態，同一個人連按兩次送出就能塞進兩則（憲章原則 IV）。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    first = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))
    assert first.status_code == 201

    second = await client.post(
        "/reviews",
        json=_body(order, comment="換一段完全不同的內容，避免被重複規則擋下來。"),
        headers=auth_header(member_token),
    )
    assert second.status_code == 409
    assert second.json()["code"] == "REVIEW_EXISTS"


# ---------------------------------------------------------------------------
# ⚠️ 未通過審核的評論在前台的出現次數為 0（SC-007）
# ---------------------------------------------------------------------------
async def test_a_pending_review_never_appears_on_the_public_endpoint(
    client, member, member_token, room_factory, order_factory
) -> None:
    """**本檔第二個核心。**

    剛送出的評論處於 `pending`。公開端點回它的次數 MUST 為 0——失守時前台
    只是多出一則評價，沒有任何錯誤，也沒有任何人會回報。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room)

    created = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))
    assert created.status_code == 201

    public = await client.get(f"/rooms/{room.id}/reviews")
    assert public.status_code == 200
    assert public.json() == [], "未通過審核的評論 MUST NOT 出現於公開端點（SC-007）"


async def test_an_approved_review_appears_without_logging_in(
    client, session, member, member_token, room_factory, order_factory
) -> None:
    """通過審核後即公開，**訪客不需登入也看得到**（US1、FR-046）。

    同時釘住兩件公開回應的界線：`PublicReviewOut` 不含 `userId`，也不含
    自動審核的初判——那些只存在於後台。
    """
    room = await room_factory()
    order = await order_factory(user=member, room=room)
    created = await client.post("/reviews", json=_body(order), headers=auth_header(member_token))

    review = await session.get(Review, uuid.UUID(created.json()["id"]))
    assert review is not None
    review.status = STATUS_APPROVED
    await session.commit()

    public = await client.get(f"/rooms/{room.id}/reviews")  # 無 Authorization 標頭
    assert public.status_code == 200
    (entry,) = public.json()
    assert entry["comment"] == GOOD_COMMENT
    assert "userId" not in entry
    assert "autoVerdict" not in entry
    assert "status" not in entry


# ---------------------------------------------------------------------------
# 依評論類型篩選（FR-048）
# ---------------------------------------------------------------------------
async def test_filtering_by_category(
    client, session, member, member_token, room_factory, order_factory
) -> None:
    """僅顯示符合該類型的評論（FR-048、spec 驗收情境 7）。"""
    room = await room_factory()
    for category in ("住宿體驗", "清潔與衛生"):
        order = await order_factory(user=member, room=room)
        created = await client.post(
            "/reviews",
            json=_body(order, category=category, comment=f"{category}：{GOOD_COMMENT}"),
            headers=auth_header(member_token),
        )
        review = await session.get(Review, uuid.UUID(created.json()["id"]))
        assert review is not None
        review.status = STATUS_APPROVED
    await session.commit()

    both = await client.get(f"/rooms/{room.id}/reviews")
    assert len(both.json()) == 2

    filtered = await client.get(f"/rooms/{room.id}/reviews", params={"category": "清潔與衛生"})
    assert [r["category"] for r in filtered.json()] == ["清潔與衛生"]


async def test_an_unknown_category_is_rejected_not_silently_empty(client, room_factory) -> None:
    """⚠️ 拼錯的類型 MUST 回 400，MUST NOT 回空陣列。

    空陣列與「這個類型還沒有人評論」在畫面上完全一樣——前端拼錯一個字會變成
    一個沒有人回報的 bug。
    """
    room = await room_factory()

    res = await client.get(f"/rooms/{room.id}/reviews", params={"category": "清潔"})
    assert res.status_code == 400
    assert res.json()["code"] == "UNKNOWN_REVIEW_CATEGORY"


async def test_reviews_of_a_nonexistent_room_is_404(client) -> None:
    """不存在的房源回 404，而非空陣列——那與「還沒有評論」是不同的事。"""
    res = await client.get(f"/rooms/{uuid.uuid4()}/reviews")
    assert res.status_code == 404
    assert res.json()["code"] == "ROOM_NOT_FOUND"
