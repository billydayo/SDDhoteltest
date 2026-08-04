"""T111：`refresh_room_rating()` trigger（FR-046、FR-047）。

`rooms.average_rating` **不由 Python 計算**。它由資料庫的
`reviews_refresh_rating` 在 insert／update／delete 之後重算（0001_initial.py）。

## 為什麼這件事需要一份測試

這是整個系統裡少數「沒有任何應用層程式碼負責」的欄位。沒有人會在 code review
時發現它壞了，因為沒有程式碼可以看。而它壞掉的樣子完全無聲：

- trigger 被遷移意外刪掉 → 平均評分永遠停在舊值
- 有人為了「效能」在 repository 裡加了一份 Python 算法 → 兩份算法分歧，
  徵狀是「刪掉一則差評後平均沒變」

因此這裡不測 Python，測的是**資料庫真的會算**。

## ⚠️ 0 則評論時 MUST 為 null，MUST NOT 為 0

FR-047：「房源無任何通過審核的評論時，MUST 顯示『尚無評分』而非 0 分。」
0 分會被讀成「評價極差」，而實際上是還沒有人評過——那是一間新上架的房源
最不需要的誤解。這個區別只有 null 表達得出來。
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from sunny.models.order import STATUS_COMPLETED, Order
from sunny.models.profile import Profile
from sunny.models.review import STATUS_APPROVED, STATUS_PENDING, STATUS_REJECTED, Review
from sunny.models.room import Room
from sunny.utils import dates
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _rating_of(session, room: Room) -> Decimal | None:
    """自資料庫重讀平均評分。

    ⚠️ **MUST 直接查，MUST NOT 讀 ORM 物件上的屬性。** 那個值是 trigger 在
    資料庫端寫的，session 的 identity map 對它一無所知——讀屬性會拿到載入當下
    的舊值，而測試會在 trigger 根本沒跑的情況下通過。
    """
    return await session.scalar(select(Room.average_rating).where(Room.id == room.id))


async def _add_review(
    session, *, member: Profile, room: Room, rating: int, status: str, offset: int
) -> Review:
    """一則評論，連同它必須存在的已完成訂單。

    `reviews.order_id` 是 UNIQUE 外鍵，因此每一則評論都得配一筆自己的訂單
    （FR-043）。`offset` 用來錯開日期，避免同一間房的多筆訂單互相重疊。
    """
    check_in = dates.today() - timedelta(days=30 + offset * 3)
    order = Order(
        user_id=member.id,
        room_id=room.id,
        check_in=check_in,
        check_out=check_in + timedelta(days=2),
        nights=2,
        guest_count=2,
        contact_name="王小明",
        phone="0912345678",
        email="guest@example.com",
        payment_method="LINE Pay",
        total_amount=room.nightly_price * 2,
        status=STATUS_COMPLETED,
    )
    session.add(order)
    await session.flush()

    review = Review(
        order_id=order.id,
        room_id=room.id,
        user_id=member.id,
        rating=rating,
        comment=f"第 {offset + 1} 則測試評論，內容長度足夠通過檢查。",
        category="住宿體驗",
        status=status,
    )
    session.add(review)
    await session.commit()
    return review


async def test_a_room_with_no_reviews_has_a_null_rating(session, room_factory) -> None:
    """⚠️ **0 則評論時為 null，MUST NOT 為 0**（FR-047）。"""
    room = await room_factory()
    assert await _rating_of(session, room) is None


async def test_a_single_review_makes_the_average_equal_to_it(session, member, room_factory) -> None:
    """1 則評論時，平均等於該則的評分（FR-046）。"""
    room = await room_factory()
    await _add_review(session, member=member, room=room, rating=4, status=STATUS_APPROVED, offset=0)

    assert await _rating_of(session, room) == Decimal("4.0")


async def test_only_approved_reviews_count(session, member, room_factory) -> None:
    """⚠️ **待審核與已駁回的評論 MUST NOT 計入平均**（FR-046、SC-007）。

    這是最容易寫錯的一條：`avg(rating)` 忘了加 `where status = 'approved'`
    仍然算得出一個數字，而那個數字看起來完全合理——只是它包含了尚未有人
    看過、甚至已經被駁回的評分。
    """
    room = await room_factory()
    await _add_review(session, member=member, room=room, rating=5, status=STATUS_APPROVED, offset=0)
    await _add_review(session, member=member, room=room, rating=1, status=STATUS_PENDING, offset=1)
    await _add_review(session, member=member, room=room, rating=1, status=STATUS_REJECTED, offset=2)

    assert await _rating_of(session, room) == Decimal("5.0"), "只有 approved 的那一則該被計入"


async def test_approving_a_review_recalculates_immediately(session, member, room_factory) -> None:
    """狀態變更即重算——不需要任何應用層程式碼觸發（FR-046）。

    管理員在後台按下「通過」之後，房源列表上的評分就該是新的。若靠 Python
    重算，`routers/admin_reviews.py` 就得記得呼叫它，而忘記的徵狀是評分
    延遲到下一次有人動這則評論才更新。
    """
    room = await room_factory()
    review = await _add_review(
        session, member=member, room=room, rating=2, status=STATUS_PENDING, offset=0
    )
    assert await _rating_of(session, room) is None

    review.status = STATUS_APPROVED
    await session.commit()

    assert await _rating_of(session, room) == Decimal("2.0")


async def test_deleting_the_last_review_returns_the_rating_to_null(
    session, member, room_factory
) -> None:
    """刪除最後一則已公開評論後回到 null，**而非 0**（FR-047、FR-103c）。

    管理員刪掉一則不當評論之後，該房源應顯示「尚無評分」。若變成 0 分，
    一次善意的清理會讓房源看起來像是評價極差。
    """
    room = await room_factory()
    review = await _add_review(
        session, member=member, room=room, rating=5, status=STATUS_APPROVED, offset=0
    )
    assert await _rating_of(session, room) == Decimal("5.0")

    await session.delete(review)
    await session.commit()

    assert await _rating_of(session, room) is None


async def test_the_average_is_rounded_to_one_decimal(session, member, room_factory) -> None:
    """多則評論取平均，四捨五入至小數一位。

    5 與 4 → 4.5；再加一則 4 → (5+4+4)/3 = 4.333… → 4.3。這個位數釘住的是
    `rooms.average_rating` 的 `numeric(3,2)` 欄位與 trigger 裡的 `round(…, 1)`
    一致——欄位放得下兩位小數，實際只寫一位。
    """
    room = await room_factory()
    for index, rating in enumerate((5, 4)):
        await _add_review(
            session, member=member, room=room, rating=rating, status=STATUS_APPROVED, offset=index
        )
    assert await _rating_of(session, room) == Decimal("4.5")

    await _add_review(session, member=member, room=room, rating=4, status=STATUS_APPROVED, offset=2)
    assert await _rating_of(session, room) == Decimal("4.3")
