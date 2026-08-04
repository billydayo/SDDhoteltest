"""T096：退款額度（FR-036a、FR-036b、FR-036d、SC-031）。

⚠️ **上限由資料庫端的 `enforce_refund_limit()` trigger 強制，
MUST NOT 僅依賴前端或應用層檢查**（FR-036d）。

因此這一份**真的連資料庫**。用 mock 或純函式測「數到 5 就擋」證明不了任何
事——要驗的正是「繞過應用層直接寫入也會被擋下來」，而那只有真的送進
PostgreSQL 才看得出來。

## SC-031：被駁回的申請 MUST NOT 佔用額度

這是本檔最重要的一條，也是最容易寫錯的一條。若駁回也計入上限，被駁回 5 次
的會員將再也無法提出任何申請——與 FR-039「駁回後會員可再次申請」直接矛盾。

而這個錯**不會有任何錯誤訊息**：使用者送出第六次申請，收到「已達上限」，
他看不出那五次都被駁回了不該算數。他只會覺得系統壞了，或自己被封鎖了。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from sunny.models.order import STATUS_CONFIRMED, Order
from sunny.models.refund import (
    MAX_REFUNDS_PER_USER,
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    Refund,
)
from sunny.services import booking
from sunny.utils import dates
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _order(session, member, room, *, days_ahead: int) -> Order:
    """一筆已確認的訂單。退款申請一律掛在這種訂單上（FR-035）。"""
    check_in = dates.today() + timedelta(days=days_ahead)
    order = Order(
        order_no=await booking.next_order_no(session),
        user_id=member.id,
        room_id=room.id,
        check_in=check_in,
        check_out=check_in + timedelta(days=1),
        nights=1,
        guest_count=1,
        contact_name="王小明",
        phone="0912345678",
        email="guest@example.com",
        payment_method="LINE Pay",
        total_amount=3000,
        status=STATUS_CONFIRMED,
    )
    session.add(order)
    await session.flush()
    return order


async def _refund(session, member, order, *, status: str = STATUS_PENDING) -> Refund:
    refund = Refund(
        order_id=order.id,
        user_id=member.id,
        reason="行程有變。",
        amount=3000,
        status=status,
    )
    session.add(refund)
    await session.flush()
    return refund


# ---------------------------------------------------------------------------
# FR-036a：不同訂單可分別申請，不限一筆
# ---------------------------------------------------------------------------
async def test_one_member_may_hold_several_refunds_on_different_orders(
    session, clean_tables, member, room_factory
) -> None:
    room = await room_factory()
    for i in range(3):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        await _refund(session, member, order)

    total = await session.scalar(
        select(func.count()).select_from(Refund).where(Refund.user_id == member.id)
    )
    assert total == 3, "同一會員 MUST 能對不同訂單分別申請（FR-036a）"


# ---------------------------------------------------------------------------
# FR-036：同一訂單同時只有一筆審核中
# ---------------------------------------------------------------------------
async def test_two_pending_refunds_on_the_same_order_are_rejected(
    session, clean_tables, member, room_factory
) -> None:
    """由部分唯一索引 `refunds_one_pending_per_order` 擋下。

    只在應用層查一次「有沒有審核中的」擋不住：兩個並行的請求會同時查到「沒有」，
    然後兩筆都寫進去，而管理員會看到同一張訂單有兩筆待審。
    """
    room = await room_factory()
    order = await _order(session, member, room, days_ahead=20)
    await _refund(session, member, order)

    with pytest.raises(DBAPIError):
        await _refund(session, member, order)
    await session.rollback()


async def test_a_rejected_refund_does_not_block_a_new_one_on_the_same_order(
    session, clean_tables, member, room_factory
) -> None:
    """FR-039：駁回後 MUST 能再次申請。

    部分唯一索引的 `where status = 'pending'` 正是為此——擋的是「同時兩筆
    審核中」，不是「這張訂單申請過」。
    """
    room = await room_factory()
    order = await _order(session, member, room, days_ahead=20)
    await _refund(session, member, order, status=STATUS_REJECTED)

    again = await _refund(session, member, order, status=STATUS_PENDING)
    assert again.id is not None


# ---------------------------------------------------------------------------
# FR-036b／FR-036d：上限 5 筆，由資料庫強制
# ---------------------------------------------------------------------------
async def test_the_sixth_refund_is_rejected_by_the_database(
    session, clean_tables, member, room_factory
) -> None:
    """⚠️ **繞過應用層直接寫入，仍然 MUST 被擋下**（FR-036d）。

    這裡刻意不經任何 service，直接 `session.add(Refund(...))`。擋下它的是
    trigger，不是任何 Python 程式碼。
    """
    room = await room_factory()
    for i in range(MAX_REFUNDS_PER_USER):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        await _refund(session, member, order)

    over = await _order(session, member, room, days_ahead=200)
    with pytest.raises(DBAPIError) as exc:
        await _refund(session, member, over)
    assert "上限" in str(exc.value) or "P0001" in str(exc.value), str(exc.value)
    await session.rollback()


async def test_approved_refunds_count_towards_the_limit(
    session, clean_tables, member, room_factory
) -> None:
    """已核准佔用額度——錢已經退出去了，那一筆確實用掉了一次機會。"""
    room = await room_factory()
    for i in range(MAX_REFUNDS_PER_USER):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        await _refund(session, member, order, status=STATUS_APPROVED)

    over = await _order(session, member, room, days_ahead=300)
    with pytest.raises(DBAPIError):
        await _refund(session, member, over)
    await session.rollback()


# ---------------------------------------------------------------------------
# ⚠️ SC-031：被駁回的 MUST NOT 佔用額度
# ---------------------------------------------------------------------------
async def test_a_member_rejected_five_times_can_still_apply(
    session, clean_tables, member, room_factory
) -> None:
    """⚠️ **本檔最重要的一條。**

    被駁回 5 次之後，第 6 次申請 MUST 成功。若駁回也計入上限，這個人就再也
    不能申請任何退款——而他做錯的事只是「被管理員駁回過」。

    這個錯不會拋例外，只會回一句「已達上限」，而使用者看不出那五筆都不該算。
    """
    room = await room_factory()
    for i in range(MAX_REFUNDS_PER_USER):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        await _refund(session, member, order, status=STATUS_REJECTED)

    order = await _order(session, member, room, days_ahead=400)
    survivor = await _refund(session, member, order, status=STATUS_PENDING)
    assert survivor.id is not None, "被駁回 5 次的會員 MUST 仍能提出申請（SC-031）"


async def test_rejecting_a_pending_refund_frees_the_quota(
    session, clean_tables, member, room_factory
) -> None:
    """額度是**當下**的計數，不是歷史累計。

    佔滿之後駁回其中一筆，那一格就該空出來。以歷史累計實作的話，一位長期
    使用的會員遲早會永久用完額度，而他每一次都是正常申請、正常核准。
    """
    room = await room_factory()
    made: list[Refund] = []
    for i in range(MAX_REFUNDS_PER_USER):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        made.append(await _refund(session, member, order))

    made[0].status = STATUS_REJECTED
    await session.flush()

    order = await _order(session, member, room, days_ahead=500)
    freed = await _refund(session, member, order)
    assert freed.id is not None


async def test_the_quota_is_per_member_not_global(
    session, clean_tables, member, other_member, room_factory
) -> None:
    """⚠️ 上限是**每位會員** 5 筆。

    寫成全站 5 筆的話，第六位提出申請的客人會被擋下來，而他一次都還沒申請過。
    trigger 裡少一個 `where user_id = new.user_id` 就是這個結果。
    """
    room = await room_factory()
    for i in range(MAX_REFUNDS_PER_USER):
        order = await _order(session, member, room, days_ahead=10 + i * 10)
        await _refund(session, member, order)

    others_order = await _order(session, other_member, room, days_ahead=600)
    theirs = await _refund(session, other_member, others_order)
    assert theirs.id is not None, "另一位會員的額度 MUST 獨立計算"


# ---------------------------------------------------------------------------
# 常數與 trigger MUST 一致
# ---------------------------------------------------------------------------
async def test_the_python_constant_matches_the_database_trigger(session, clean_tables) -> None:
    """⚠️ 兩處各寫一個 5，改了其中一個就會不一致。

    不一致的表現很難察覺：應用層說還能申請、資料庫拒絕，使用者收到的是一句
    來自 trigger 的原始訊息。這裡把 trigger 的原始碼撈出來比對。
    """
    source = await session.scalar(
        text("select prosrc from pg_proc where proname = 'enforce_refund_limit'")
    )
    assert source is not None, "找不到 enforce_refund_limit()——migration 沒跑？"
    assert f"= {MAX_REFUNDS_PER_USER};" in source, (
        f"trigger 裡的上限與 MAX_REFUNDS_PER_USER（{MAX_REFUNDS_PER_USER}）不一致：{source}"
    )
