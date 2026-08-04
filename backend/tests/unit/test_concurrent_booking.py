"""T080：並行訂房（SC-020、research R9）。

⚠️ **本測試 MUST 實際觸發資料庫約束。** 僅測前端檢查、或以 mock 模擬衝突，
都不算覆蓋——那樣測的是「我們記得檢查」，而真正要驗的是「檢查漏掉時資料庫
會擋下來」。憲章原則 IV：「後端的檢查是授權與訊息品質，資料庫的約束才是保證。」

兩個各自獨立的連線同時送出同一房源、同一區間的訂房。成立筆數 MUST 恰為 1。

為什麼**必須是兩個獨立的 session**：同一個 session 的兩次寫入在同一個交易裡，
第二次會立刻看到第一次的未提交資料，衝突在應用層就顯現了——那條路徑不會經過
`orders_no_overlap`，測試會通過而約束其實可以是壞的。

## 本檔的測試資料**真的會提交**，因此自行清理

其餘測試靠 conftest 的外層交易回滾來隔離（見 `tests/conftest.py`），但那條路
在這裡不能走：未提交的房源與帳號，另外兩條連線看不見，訂單會以外鍵違反收場，
而外鍵違反與「排除約束有沒有生效」毫無關係——測試會紅，卻紅在錯的地方。

因此 `committed` fixture 以自己的連線建立資料並提交，測試結束後刪掉。
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from sunny.errors import CONSTRAINT_ORDERS_NO_OVERLAP, constraint_name_of, translate_integrity_error
from sunny.models.order import OCCUPYING_STATUSES, Order
from sunny.models.profile import ROLE_MEMBER, Profile
from sunny.models.room import Room
from sunny.repositories.orders import OrderRepository
from sunny.services.auth import hash_password
from sunny.services.booking import BookingDraft
from sunny.utils import dates
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def committed(engine) -> AsyncIterator[SimpleNamespace]:
    """兩位會員與一個建房函式，**資料真的寫進資料庫**，測試結束後刪除。

    ⚠️ 清理順序 MUST 是訂單 → 房源 → 帳號。反過來會撞上外鍵，而清理失敗只會
    在**下一次**執行時以「訂單編號碰撞」之類的莫名其妙形式出現。
    """
    factory = async_sessionmaker(engine, expire_on_commit=False)
    room_ids: list[uuid.UUID] = []

    async with factory() as s:

        def _profile(suffix: str) -> Profile:
            return Profile(
                email=f"concurrent-{suffix}-{uuid.uuid4().hex[:8]}@example.com",
                password_hash=hash_password("test-password"),
                role=ROLE_MEMBER,
                display_name=f"並行測試{suffix}",
            )

        member, other_member = _profile("a"), _profile("b")
        s.add_all([member, other_member])
        await s.commit()

        async def make_room(*, nightly_price: int = 2500, max_guests: int = 4) -> Room:
            room = Room(
                name=f"並行測試房 {uuid.uuid4().hex[:6]}",
                type="標準雙人房",
                max_guests=max_guests,
                nightly_price=nightly_price,
                description="",
            )
            s.add(room)
            await s.commit()
            room_ids.append(room.id)
            return room

        try:
            yield SimpleNamespace(
                member=member, other_member=other_member, make_room=make_room, session=s
            )
        finally:
            await s.rollback()
            if room_ids:
                await s.execute(delete(Order).where(Order.room_id.in_(room_ids)))
                await s.execute(delete(Room).where(Room.id.in_(room_ids)))
            await s.execute(delete(Profile).where(Profile.id.in_([member.id, other_member.id])))
            await s.commit()


def _draft(check_in, nights: int, price: int) -> BookingDraft:
    return BookingDraft(
        check_in=check_in,
        check_out=check_in + timedelta(days=nights),
        nights=nights,
        guest_count=2,
        total_amount=price * nights,
        payment_method="LINE Pay",
    )


async def _book(factory, *, user_id, room_id, draft) -> Exception | None:
    """在自己的 session／自己的交易裡訂一筆房。回傳失敗的例外，成功回 None。"""
    async with factory() as s:
        try:
            await OrderRepository(s).create(
                user_id=user_id,
                room_id=room_id,
                draft=draft,
                contact_name="王小明",
                phone="0912345678",
                email="guest@example.com",
            )
            await s.commit()
            return None
        except IntegrityError as exc:
            await s.rollback()
            return exc


async def test_only_one_of_two_simultaneous_bookings_survives(engine, session, committed) -> None:
    """⚠️ **本專案最關鍵的一條測試。**

    失守時不會有任何錯誤訊息——兩位客人各自收到確認信，直到入住當天櫃檯發現
    同一間房賣了兩次。
    """
    room = await committed.make_room(nightly_price=2500)
    check_in = dates.tomorrow()
    draft = _draft(check_in, 2, room.nightly_price)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    results = await asyncio.gather(
        _book(factory, user_id=committed.member.id, room_id=room.id, draft=draft),
        _book(factory, user_id=committed.other_member.id, room_id=room.id, draft=draft),
    )

    succeeded = [r for r in results if r is None]
    failed = [r for r in results if r is not None]

    assert len(succeeded) == 1, f"成立筆數 MUST 恰為 1，實際 {len(succeeded)}"
    assert len(failed) == 1

    # 資料庫裡也 MUST 只有一筆佔用該區間的訂單
    count = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.room_id == room.id, Order.status.in_(OCCUPYING_STATUSES))
    )
    assert count == 1


async def test_the_loser_is_told_the_room_is_full_not_something_generic(
    engine, session, committed
) -> None:
    """失敗的那一筆 MUST 收到「已無空房」，且 MUST 是**排除約束**造成的。

    這一條分開驗有其必要：只要「恰有一筆成功」，另一筆因為任何理由失敗都會讓
    上一個測試通過——包含約束根本不存在、而是別的地方出錯。這裡確認擋下它的
    確實是 `orders_no_overlap`。
    """
    room = await committed.make_room(nightly_price=1800)
    draft = _draft(dates.tomorrow(), 3, room.nightly_price)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    results = await asyncio.gather(
        _book(factory, user_id=committed.member.id, room_id=room.id, draft=draft),
        _book(factory, user_id=committed.other_member.id, room_id=room.id, draft=draft),
    )

    exc = next(r for r in results if r is not None)
    assert constraint_name_of(exc) == CONSTRAINT_ORDERS_NO_OVERLAP

    domain = translate_integrity_error(exc)
    assert domain.status_code == 409, "競態失敗是 409，不是 400——請求本身合法"
    assert domain.code == "ROOM_UNAVAILABLE"
    assert domain.detail == "此房源於所選日期已無空房。"


async def test_adjacent_bookings_both_succeed(engine, session, committed) -> None:
    """⚠️ 相鄰**不算重疊**：8/01–8/03 與 8/03–8/05 兩筆皆 MUST 成立（SC-003）。

    這是排除約束最容易寫錯的方向。判成衝突不會有人抱怨——沒訂到的人只會以為
    房滿了——但平台會平白損失一半的可售天數。
    """
    room = await committed.make_room()
    day1 = dates.tomorrow()

    factory = async_sessionmaker(engine, expire_on_commit=False)
    results = await asyncio.gather(
        _book(factory, user_id=committed.member.id, room_id=room.id, draft=_draft(day1, 2, 2500)),
        _book(
            factory,
            user_id=committed.other_member.id,
            room_id=room.id,
            draft=_draft(day1 + timedelta(days=2), 2, 2500),
        ),
    )
    assert results == [None, None], "前一筆的退房日等於後一筆的入住日 MUST NOT 判為衝突"


async def test_different_rooms_do_not_block_each_other(engine, session, committed) -> None:
    """不同房源的同一區間互不影響——約束的第一個維度是 `room_id with =`。"""
    room_a = await committed.make_room()
    room_b = await committed.make_room()
    draft = _draft(dates.tomorrow(), 2, 2500)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    results = await asyncio.gather(
        _book(factory, user_id=committed.member.id, room_id=room_a.id, draft=draft),
        _book(factory, user_id=committed.other_member.id, room_id=room_b.id, draft=draft),
    )
    assert results == [None, None]


async def test_pending_payment_also_occupies(engine, session, committed) -> None:
    """待付款**同樣佔用房況**（FR-097）。

    `create()` 產生的訂單狀態就是 `pending-payment`，上面的測試已經隱含驗到；
    此處明確斷言那筆成功的訂單確實還沒付款——若哪天預設狀態被改成別的，
    上面的測試仍會通過，而房況的佔用範圍已經悄悄變了。
    """
    room = await committed.make_room()
    draft = _draft(dates.tomorrow(), 1, room.nightly_price)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    await _book(factory, user_id=committed.member.id, room_id=room.id, draft=draft)

    order = await session.scalar(select(Order).where(Order.room_id == room.id))
    assert order is not None
    assert order.status == "pending-payment"
    assert order.status in OCCUPYING_STATUSES

    # 同一區間的第二筆 MUST 仍被擋下
    second = await _book(factory, user_id=committed.other_member.id, room_id=room.id, draft=draft)
    assert second is not None
    assert constraint_name_of(second) == CONSTRAINT_ORDERS_NO_OVERLAP


async def test_order_no_is_unique_across_concurrent_bookings(engine, session, committed) -> None:
    """並行取號 MUST NOT 碰撞（FR-030）。

    取號來自資料庫序列而非「查最大值 +1」，因此兩個並行交易拿不到同一個號。
    這裡以不同房源讓兩筆都成立，才能真的比較兩個編號。
    """
    room_a = await committed.make_room()
    room_b = await committed.make_room()
    draft = _draft(dates.tomorrow(), 1, 2500)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    await asyncio.gather(
        _book(factory, user_id=committed.member.id, room_id=room_a.id, draft=draft),
        _book(factory, user_id=committed.other_member.id, room_id=room_b.id, draft=draft),
    )

    # 只看這個測試自己的兩個房源。不設條件的話，資料庫裡任何殘留的訂單都會
    # 讓筆數對不上，而那與「編號會不會碰撞」無關。
    numbers = list(
        (
            await session.scalars(
                select(Order.order_no).where(Order.room_id.in_([room_a.id, room_b.id]))
            )
        ).all()
    )
    assert len(numbers) == 2
    assert len(set(numbers)) == 2, f"訂單編號碰撞：{numbers}"
    assert all(n.startswith("SN") for n in numbers)
