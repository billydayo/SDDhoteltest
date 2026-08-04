"""房源查詢與房態推導。

## 房態為什麼要推導而不是存欄位（FR-015、FR-051a）

`rooms.status` **刻意只有 `available` 與 `maintenance`**，沒有 `booked`。
「已預訂」綁定日期——同一房源在 8/1 已預訂，MUST NOT 因此在 8/2 也顯示已預訂。

若寫成欄位，就得在每次退房時改回來；漏改一次，那間房從此永久無法販售，
而且不會有任何錯誤訊息。推導則不可能漏——沒有訂單就是沒有訂單。

## expire_stale_orders() 的呼叫點

**查詢房況前 MUST 先執行**（data-model.md、contracts/README.md）。
逾期的待付款訂單仍佔著排除約束，不清理就會擋住本該可訂的房間。
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any, Final

from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB

from sunny.models.order import OCCUPYING_STATUSES, Order
from sunny.models.room import ROOM_MAINTENANCE, Room
from sunny.repositories.base import Repository
from sunny.services import search

_ONE_DAY: Final = timedelta(days=1)


class RoomRepository(Repository):
    """房源的唯一資料出口（憲章原則 III）。"""

    # -- 房態推導 ----------------------------------------------------------
    @staticmethod
    def _occupied_between(check_in: date, check_out: date) -> Any:
        """該房源在 `[check_in, check_out)` 內是否已有佔用房況的訂單。

        重疊判定與資料庫的 `orders_no_overlap` **使用同一套半開區間語意**：
        `a < d and c < b`。兩處若不一致，前端會顯示可訂但送出時被資料庫拒絕，
        使用者看到的是「明明有空房卻訂不到」。
        """
        return exists(
            select(Order.id).where(
                Order.room_id == Room.id,
                Order.status.in_(OCCUPYING_STATUSES),
                Order.check_in < check_out,
                check_in < Order.check_out,
            )
        )

    @staticmethod
    def _occupied_on(day: date) -> Any:
        """該房源在**某一天**是否已被預訂。

        單日視為 `[day, day+1)`：入住日當天算佔用，退房日當天不算——
        退房的客人早上就走了，當天下午可以再賣一次。
        """
        return exists(
            select(Order.id).where(
                Order.room_id == Room.id,
                Order.status.in_(OCCUPYING_STATUSES),
                Order.check_in <= day,
                Order.check_out > day,
            )
        )

    # -- 搜尋 --------------------------------------------------------------
    def _apply_filters(
        self,
        stmt: Select,
        *,
        keyword: str | None,
        max_price: int | None,
        guest_count: int | None,
        amenities: list[str],
        features: list[str],
        room_type: str | None,
    ) -> Select:
        if keyword:
            like = f"%{keyword.strip()}%"
            stmt = stmt.where(
                or_(Room.name.ilike(like), Room.description.ilike(like), Room.type.ilike(like))
            )
        if max_price is not None:
            stmt = stmt.where(Room.nightly_price <= max_price)
        if guest_count is not None:
            stmt = stmt.where(Room.max_guests >= guest_count)
        if room_type:
            stmt = stmt.where(Room.type == room_type)

        # 設施與房型特色採 **AND**：須同時具備所選全部項目（FR-010）。
        # 以 jsonb 包含運算子 `@>` 執行，走 GIN 索引——把全部房源撈回 Python
        # 端再過濾在房源多了之後會很慢，而且分頁會算錯。
        if amenities:
            stmt = stmt.where(Room.amenities.cast(JSONB).contains(amenities))
        if features:
            stmt = stmt.where(Room.features.cast(JSONB).contains(features))
        return stmt

    @staticmethod
    def _apply_sort(stmt: Select, sort: str | None) -> Select:
        """排序。

        一律附加 `Room.id` 作為最終鍵：價格或評分相同時若不定序，
        兩次查詢可能回傳不同順序，分頁就會漏掉或重複房源。
        """
        match sort:
            case search.SORT_PRICE_ASC:
                return stmt.order_by(Room.nightly_price.asc(), Room.id)
            case search.SORT_PRICE_DESC:
                return stmt.order_by(Room.nightly_price.desc(), Room.id)
            case search.SORT_RATING_ASC:
                # nulls last：尚無評分的房源排在最後，而非被當成 0 分排在最前
                return stmt.order_by(Room.average_rating.asc().nullslast(), Room.id)
            case search.SORT_RATING_DESC:
                return stmt.order_by(Room.average_rating.desc().nullslast(), Room.id)
            case _:
                return stmt.order_by(Room.name, Room.id)

    async def search(
        self,
        *,
        keyword: str | None = None,
        check_in: date | None = None,
        check_out: date | None = None,
        guest_count: int | None = None,
        max_price: int | None = None,
        amenities: list[str] | None = None,
        features: list[str] | None = None,
        room_type: str | None = None,
        sort: str | None = None,
    ) -> list[Room]:
        """搜尋房源。

        **未指定日期時不做可訂性篩選**——首頁初次載入會走這條路，訪客不必填
        任何條件就能瀏覽全部房源（FR-010、US1）。
        """
        # MUST 於查詢房況前執行（contracts/README.md）
        await self.expire_stale_orders()

        stmt = self._apply_filters(
            select(Room),
            keyword=keyword,
            max_price=max_price,
            guest_count=guest_count,
            amenities=search.normalize_filter_list(amenities),
            features=search.normalize_filter_list(features),
            room_type=room_type,
        )

        if check_in is not None and check_out is not None:
            # 「整理中」MUST 與「已預訂」等同排除於可訂結果之外（FR-016）
            stmt = stmt.where(
                Room.status != ROOM_MAINTENANCE,
                ~self._occupied_between(check_in, check_out),
            )

        stmt = self._apply_sort(stmt, sort)
        return list((await self.session.scalars(stmt)).all())

    # -- 單筆 --------------------------------------------------------------
    async def get(self, room_id: uuid.UUID) -> Room | None:
        return await self.session.scalar(select(Room).where(Room.id == room_id))

    async def availability_on(self, room_id: uuid.UUID, day: date) -> str:
        """某房源在**某一天**的房態（FR-015）。

        回傳 `available` / `booked` / `maintenance`。

        `maintenance` 優先於 `booked`：整理中的房間不論當天有沒有訂單都不可訂，
        而顯示「整理中」比顯示「已預訂」更貼近實際狀況。
        """
        await self.expire_stale_orders()
        row = await self.session.execute(
            select(Room.status, self._occupied_on(day)).where(Room.id == room_id)
        )
        result = row.one_or_none()
        if result is None:
            return "unknown"
        status, occupied = result
        if status == ROOM_MAINTENANCE:
            return ROOM_MAINTENANCE
        return "booked" if occupied else "available"

    async def availability_over_range(
        self, start: date, end: date, *, room_type: str | None = None
    ) -> list[tuple[Room, str]]:
        """房態的日期**區間**查詢，供後台使用（FR-051b、FR-053a）。

        區間為**含頭含尾**：期間內任一天有有效訂單即視為已預訂。
        呼叫端負責處理「只填一端 → 視為單日」與「起始晚於結束 → 明確提示」。
        """
        await self.expire_stale_orders()

        # 含頭含尾的日期區間，換算為半開區間 [start, end+1)
        occupied = self._occupied_between(start, end + _ONE_DAY)

        stmt = select(Room, occupied)
        if room_type:
            stmt = stmt.where(Room.type == room_type)
        stmt = stmt.order_by(Room.name, Room.id)

        rows = await self.session.execute(stmt)
        out: list[tuple[Room, str]] = []
        for room, is_occupied in rows.all():
            if room.status == ROOM_MAINTENANCE:
                out.append((room, ROOM_MAINTENANCE))
            else:
                out.append((room, "booked" if is_occupied else "available"))
        return out

    async def count_by_status(self) -> dict[str, int]:
        """各房態的房源數，供儀表板使用（FR-049）。"""
        rows = await self.session.execute(select(Room.status, func.count()).group_by(Room.status))
        return {status: count for status, count in rows.all()}


__all__ = ["RoomRepository"]
