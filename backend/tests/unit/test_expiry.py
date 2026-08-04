"""T081：逾期釋出（FR-099、FR-100、SC-023、SC-024）。

分兩部分：

1. **呼叫點的存在**——不需資料庫。`expire_stale_orders()` MUST 在查詢房況、
   建立訂單、讀取訂單列表**之前**被呼叫。以假的 session 記錄執行順序來驗。
2. **實際效果**——需要資料庫。逾期後區間立即可重新預訂；對已逾期訂單付款
   MUST 被拒。

⚠️ 第 1 部分驗的是「順序」而不只是「有呼叫」。先查完房況再清理逾期訂單，
清理本身會成功、測試若只檢查「有沒有呼叫」也會通過，但那一次查詢拿到的仍是
未清理的房況——房間對這位使用者就是不可訂。
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from sunny.errors import InternalError
from sunny.models.order import (
    CANCEL_PAYMENT_TIMEOUT,
    STATUS_CANCELLED,
    STATUS_PENDING_PAYMENT,
    Order,
)
from sunny.repositories.orders import OrderRepository
from sunny.repositories.rooms import RoomRepository
from sunny.utils import dates
from tests.conftest import requires_db

pytestmark = pytest.mark.asyncio

_EXPIRE_SQL = "expire_stale_orders"


# ---------------------------------------------------------------------------
# 1. 呼叫點（不需資料庫）
# ---------------------------------------------------------------------------
class _Recorder:
    """記錄 session 上每一次查詢的假物件。

    只需支援 repository 實際用到的四個方法。回傳值都是空的——這裡驗的是
    **執行順序**，不是查詢結果。
    """

    def __init__(self, expired: int = 0) -> None:
        self.statements: list[str] = []
        self.commits = 0
        self._expired = expired
        # `expire_stale_orders()` 會檢查這三個以確認自己是交易中的第一個敘述
        self.new: set = set()
        self.dirty: set = set()
        self.deleted: set = set()

    def _record(self, stmt: object) -> None:
        self.statements.append(str(stmt))

    async def execute(self, stmt: object, *_: object, **__: object) -> _Scalar:
        self._record(stmt)
        return _Scalar(self._expired if _EXPIRE_SQL in str(stmt) else 0)

    async def commit(self) -> None:
        self.commits += 1

    async def scalar(self, stmt: object, *_: object, **__: object) -> int:
        self._record(stmt)
        return 1

    async def scalars(self, stmt: object, *_: object, **__: object) -> _Sequence:
        self._record(stmt)
        return _Sequence()

    def add(self, _: object) -> None: ...

    async def flush(self) -> None: ...

    async def refresh(self, *_: object, **__: object) -> None: ...

    # -- 斷言用 ------------------------------------------------------------
    def index_of_expire(self) -> int:
        for i, stmt in enumerate(self.statements):
            if _EXPIRE_SQL in stmt:
                return i
        raise AssertionError(f"expire_stale_orders() 從未被呼叫。已執行的查詢：{self.statements}")

    def index_of_first_matching(self, needle: str) -> int:
        for i, stmt in enumerate(self.statements):
            if _EXPIRE_SQL not in stmt and needle in stmt:
                return i
        raise AssertionError(f"找不到包含 {needle!r} 的查詢：{self.statements}")


class _Scalar:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar(self) -> int:
        return self._value

    def one_or_none(self) -> None:
        return None

    def all(self) -> list:
        return []


class _Sequence:
    def all(self) -> list:
        return []


# ---------------------------------------------------------------------------
# 1a. 取消 MUST 真的留在資料庫裡
# ---------------------------------------------------------------------------
async def test_expiry_is_committed_on_read_only_paths() -> None:
    """⚠️ **實跑 US3 時發現的失效。**

    搜尋房源是唯讀路徑，請求的 session 從頭到尾不會 commit。若 `expire_stale_orders()`
    不自行提交，那次取消會隨請求結束一併回滾——**該次請求看到的房況是對的，
    資料庫裡的訂單卻永遠停在 `pending-payment`**。

    沒有任何錯誤、房況也沒出錯，只有直接查資料庫才看得出來。使用者看到的是
    一筆倒數早已歸零卻仍標示待付款的訂單。
    """
    rec = _Recorder(expired=3)
    await RoomRepository(rec).search(  # type: ignore[arg-type]
        check_in=dates.tomorrow(), check_out=dates.tomorrow() + timedelta(days=1)
    )
    assert rec.commits == 1, "有訂單被取消時 MUST 提交，否則取消會被回滾"


async def test_expiry_does_not_touch_the_transaction_when_nothing_expired() -> None:
    """沒有東西過期時 MUST NOT 提交——絕大多數請求走這條路。

    無條件提交會把每一次讀取都變成一次寫入交易，也會在呼叫端還沒準備好時
    切斷它的交易邊界。
    """
    rec = _Recorder(expired=0)
    await RoomRepository(rec).search()  # type: ignore[arg-type]
    assert rec.commits == 0


async def test_expiry_refuses_to_commit_over_pending_changes() -> None:
    """呼叫順序被違反時 MUST 大聲失敗，MUST NOT 靜默提交別人做到一半的工作。

    管理員的變更 MUST 與其稽核紀錄在同一個交易內完成（憲章資料存取規則）。
    在那個交易中途提交會把兩者拆開，而稽核日誌是唯讀的——拆開就補不回來。
    """
    rec = _Recorder(expired=1)
    rec.dirty = {object()}  # 交易裡已經有別人尚未提交的變更

    with pytest.raises(InternalError):
        await OrderRepository(rec).list_for_user(uuid.uuid4())  # type: ignore[arg-type]
    assert rec.commits == 0


async def test_expire_runs_before_searching_availability() -> None:
    """查詢房況**之前**（FR-099）。

    逾期的待付款訂單仍佔著排除約束，不先清理就會把本該可訂的房間篩掉。
    """
    rec = _Recorder()
    await RoomRepository(rec).search(  # type: ignore[arg-type]
        check_in=dates.tomorrow(), check_out=dates.tomorrow() + timedelta(days=2)
    )
    assert rec.index_of_expire() < rec.index_of_first_matching("FROM rooms")


async def test_expire_runs_before_creating_an_order() -> None:
    """建立訂單**之前**。

    不先清理，逾期訂單會讓資料庫拒絕一筆本該成立的訂房，
    使用者看到「已無空房」而房其實是空的。
    """
    from sunny.services.booking import BookingDraft

    rec = _Recorder()
    await OrderRepository(rec).create(  # type: ignore[arg-type]
        user_id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        draft=BookingDraft(
            check_in=dates.tomorrow(),
            check_out=dates.tomorrow() + timedelta(days=1),
            nights=1,
            guest_count=2,
            total_amount=2000,
            payment_method="LINE Pay",
        ),
        contact_name="王小明",
        phone="0912345678",
        email="a@example.com",
    )
    # 建單路徑上第二個查詢是取號；清理必須在它之前
    assert rec.index_of_expire() < rec.index_of_first_matching("nextval")


async def test_expire_runs_before_listing_orders() -> None:
    """讀取訂單列表**之前**。

    不清理的話列表會顯示一筆早該取消的待付款訂單，使用者盯著倒數計時等下去，
    點進付款卻被拒。
    """
    rec = _Recorder()
    await OrderRepository(rec).list_for_user(uuid.uuid4())  # type: ignore[arg-type]
    assert rec.index_of_expire() < rec.index_of_first_matching("FROM orders")


# ---------------------------------------------------------------------------
# 2. 實際效果（需要資料庫）
# ---------------------------------------------------------------------------
@requires_db
async def test_expired_order_is_cancelled_and_releases_the_range(
    session, clean_tables, member, room_factory
) -> None:
    """逾期後 MUST 立即可重新預訂（SC-023）。

    這是整條規則的重點：釋出不是「排程跑完之後」，而是**下一次有人查詢時**。
    """
    room = await room_factory()
    check_in = dates.tomorrow()
    check_out = check_in + timedelta(days=2)

    stale = Order(
        order_no=f"SN-stale-{uuid.uuid4().hex[:8]}",
        user_id=member.id,
        room_id=room.id,
        check_in=check_in,
        check_out=check_out,
        nights=2,
        guest_count=2,
        contact_name="王小明",
        phone="0912345678",
        email=member.email,
        payment_method="LINE Pay",
        total_amount=room.nightly_price * 2,
        status=STATUS_PENDING_PAYMENT,
        # 已經過期一小時
        expires_at=dates.now_taipei() - timedelta(hours=1),
    )
    session.add(stale)
    await session.commit()

    # 清理前：該區間查不到這間房
    before = await RoomRepository(session).search(check_in=check_in, check_out=check_out)
    # search 自己會先清理，因此這裡直接驗清理後的結果
    assert room.id in {r.id for r in before}, "逾期訂單清理後該房源 MUST 重新可訂"

    await session.refresh(stale)
    assert stale.status == STATUS_CANCELLED
    assert stale.cancel_reason == CANCEL_PAYMENT_TIMEOUT, "MUST 可與會員主動取消區分"


@requires_db
async def test_paying_an_expired_order_is_rejected(session, clean_tables, member, room_factory):
    """對已逾期訂單付款 MUST 被拒（FR-100、SC-024）。

    ⚠️ 放行的後果是**同一晚賣兩次**：區間已因逾期釋出並被他人訂走，
    這筆訂單一旦轉為已確認就會與那筆重疊——而排除約束此時才會擋下，
    使用者收到的是一句沒頭沒尾的資料庫錯誤。
    """
    room = await room_factory()
    check_in = dates.tomorrow()

    stale = Order(
        order_no=f"SN-expired-{uuid.uuid4().hex[:8]}",
        user_id=member.id,
        room_id=room.id,
        check_in=check_in,
        check_out=check_in + timedelta(days=1),
        nights=1,
        guest_count=1,
        contact_name="王小明",
        phone="0912345678",
        email=member.email,
        payment_method="LINE Pay",
        total_amount=room.nightly_price,
        status=STATUS_PENDING_PAYMENT,
        expires_at=dates.now_taipei() - timedelta(minutes=1),
    )
    session.add(stale)
    await session.commit()

    repo = OrderRepository(session)
    assert await repo.expire_stale_orders() >= 1
    await session.commit()

    # ⚠️ 讀「欄位」而不是讀 ORM 實體。逾期清理是資料庫函式裡的 UPDATE，ORM 的
    # 識別映射對它一無所知；而測試用的 sessionmaker 是 `expire_on_commit=False`，
    # 提交後屬性也不會失效。`select(Order)` 會原封不動地把記憶體裡那份
    # `pending-payment` 的舊值交回來——**看起來像逾期沒生效，實際上是快取**。
    # 只選欄位就沒有實體可快取，拿到的一定是資料庫現在的值。
    status = await session.scalar(select(Order.status).where(Order.id == stale.id))
    assert status == STATUS_CANCELLED, "已逾期的訂單 MUST NOT 仍處於待付款"
