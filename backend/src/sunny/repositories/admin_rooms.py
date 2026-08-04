"""後台房源管理的資料存取（FR-050 ~ FR-053a）。

繼承 `RoomRepository` 而非另起一套：房態推導（`_occupied_between`）與半開區間
語意 MUST 與前台**完全一致**。複製一份過來，兩邊哪天分岔了不會有任何錯誤——
只會出現「後台顯示空房、前台訂不到」這種最難查的落差。

本檔只增加前台不該有的能力：新增、編輯、刪除，以及跨日期區間的房態清單。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any, Final

from sqlalchemy import Select, or_, select

from sunny.models.order import OCCUPYING_STATUSES, Order
from sunny.models.room import ROOM_MAINTENANCE, Room
from sunny.repositories.rooms import RoomRepository

_ONE_DAY: Final = timedelta(days=1)

#: 後台房態篩選的可選值。`booked` 是**推導**出來的，不是 `rooms.status` 的值，
#: 因此篩選它 MUST 先選定日期（FR-053a）——沒有日期就沒有「已預訂」可言。
FILTER_AVAILABLE: Final = "available"
FILTER_BOOKED: Final = "booked"
FILTER_MAINTENANCE: Final = "maintenance"
ROOM_FILTERS: Final = (FILTER_AVAILABLE, FILTER_BOOKED, FILTER_MAINTENANCE)


class AdminRoomRepository(RoomRepository):
    """房源的後台出口。**僅供 `require_admin` 的路由使用。**"""

    # -- 清單 ---------------------------------------------------------------
    @staticmethod
    def _apply_admin_filters(
        stmt: Select,
        *,
        keyword: str | None,
        room_type: str | None,
        min_price: int | None,
        max_price: int | None,
    ) -> Select:
        if keyword:
            like = f"%{keyword.strip()}%"
            stmt = stmt.where(or_(Room.name.ilike(like), Room.type.ilike(like)))
        if room_type:
            stmt = stmt.where(Room.type == room_type)
        if min_price is not None:
            stmt = stmt.where(Room.nightly_price >= min_price)
        if max_price is not None:
            stmt = stmt.where(Room.nightly_price <= max_price)
        return stmt

    async def list_with_availability(
        self,
        *,
        start: date,
        end: date,
        keyword: str | None = None,
        room_type: str | None = None,
        min_price: int | None = None,
        max_price: int | None = None,
        status_filter: str | None = None,
    ) -> list[tuple[Room, str]]:
        """房源清單，附上 `[start, end]` **含頭含尾**區間內的房態。

        期間內任一天有有效訂單即視為已預訂（FR-051b）。呼叫端負責處理
        「只填一端 → 視為單日」與「起始晚於結束 → 明確提示」——那是輸入驗證，
        不是查詢邏輯。
        """
        await self.expire_stale_orders()

        # 含頭含尾換算為半開區間 [start, end+1)，與資料庫約束同一套語意
        occupied = self._occupied_between(start, end + _ONE_DAY)

        stmt = self._apply_admin_filters(
            select(Room, occupied),
            keyword=keyword,
            room_type=room_type,
            min_price=min_price,
            max_price=max_price,
        ).order_by(Room.name, Room.id)

        rows = (await self.session.execute(stmt)).all()

        out: list[tuple[Room, str]] = []
        for room, is_occupied in rows:
            if room.status == ROOM_MAINTENANCE:
                # 整理中優先於已預訂：不論當期有沒有訂單都不可販售，
                # 而「整理中」比「已預訂」更貼近業者要處理的事
                derived = FILTER_MAINTENANCE
            else:
                derived = FILTER_BOOKED if is_occupied else FILTER_AVAILABLE
            if status_filter is None or derived == status_filter:
                out.append((room, derived))
        return out

    async def status_counts_on(self, day: date) -> dict[str, int]:
        """某一天的房態計數，供儀表板使用（FR-049）。

        ⚠️ 與 `count_by_status()` 不同：後者分組的是 `rooms.status` 欄位，
        永遠只會回 available 與 maintenance。「今天有幾間被訂走」必須推導。
        """
        counts = {FILTER_AVAILABLE: 0, FILTER_BOOKED: 0, FILTER_MAINTENANCE: 0}
        for _, derived in await self.list_with_availability(start=day, end=day):
            counts[derived] = counts.get(derived, 0) + 1
        return counts

    # -- 刪除保護 -----------------------------------------------------------
    async def future_active_orders(self, room_id: uuid.UUID, *, on_or_after: date) -> list[Order]:
        """該房源尚未結束的有效訂單（FR-052）。

        刪除前 MUST 列出這些訂單並要求二次確認。判定用 `check_out > 今日`
        而非 `check_in >= 今日`——住到一半的客人也是受影響的訂單。
        """
        stmt = (
            select(Order)
            .where(
                Order.room_id == room_id,
                Order.status.in_(OCCUPYING_STATUSES),
                Order.check_out > on_or_after,
            )
            .order_by(Order.check_in)
        )
        return list((await self.session.scalars(stmt)).all())

    async def has_any_order(self, room_id: uuid.UUID) -> bool:
        """該房源是否有**任何**訂單（含已完成與已取消的歷史）。

        `orders.room_id` 是 `on delete restrict`，因此只要有一筆歷史訂單，
        資料庫就會拒絕刪除。先問一次，讓使用者拿到可理解的說明，
        而不是一個 IntegrityError（FR-052）。
        """
        found = await self.session.scalar(select(Order.id).where(Order.room_id == room_id).limit(1))
        return found is not None

    # -- 寫入 ---------------------------------------------------------------
    async def create(self, payload: dict[str, Any]) -> Room:
        room = Room(**payload)
        self.session.add(room)
        await self.session.flush()
        return room

    async def update(self, room: Room, payload: dict[str, Any]) -> Room:
        for key, value in payload.items():
            setattr(room, key, value)
        await self.session.flush()
        return room

    async def delete(self, room: Room) -> None:
        await self.session.delete(room)
        await self.session.flush()

    async def list_by_ids(self, room_ids: Sequence[uuid.UUID]) -> list[Room]:
        if not room_ids:
            return []
        return list((await self.session.scalars(select(Room).where(Room.id.in_(room_ids)))).all())


__all__ = ["ROOM_FILTERS", "AdminRoomRepository"]
