"""後台訂單管理的資料存取（FR-053、FR-054）。

與會員端的訂單查詢分開的理由同 `admin_stats.py`：會員端的每一條查詢都必須以
`user_id` 收斂，後台則刻意跨全體會員。混在一起，「這個方法有沒有做使用者
收斂」就得逐一記住，而漏掉一次就是越權讀取。

本檔的每個方法都是跨會員的，只由 `require_admin` 的路由呼叫。
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Select, select

from sunny.models.order import Order
from sunny.models.room import Room
from sunny.repositories.base import Repository


class AdminOrderRepository(Repository):
    """訂單的後台出口。**僅供 `require_admin` 的路由使用。**"""

    @staticmethod
    def _apply_filters(
        stmt: Select,
        *,
        order_no: str | None,
        status: str | None,
        room_id: uuid.UUID | None,
        start: date | None,
        end: date | None,
    ) -> Select:
        if order_no:
            stmt = stmt.where(Order.order_no.ilike(f"%{order_no.strip()}%"))
        if status:
            stmt = stmt.where(Order.status == status)
        if room_id is not None:
            stmt = stmt.where(Order.room_id == room_id)

        # 日期區間比對的是**入住日**，含頭含尾。
        #
        # 用 check_in 而非 created_at：業者問「這段期間有哪些訂單」時想的是
        # 客人什麼時候來，不是訂單什麼時候成立的。
        if start is not None:
            stmt = stmt.where(Order.check_in >= start)
        if end is not None:
            stmt = stmt.where(Order.check_in <= end)
        return stmt

    async def search(
        self,
        *,
        order_no: str | None = None,
        status: str | None = None,
        room_id: uuid.UUID | None = None,
        start: date | None = None,
        end: date | None = None,
    ) -> list[tuple[Order, str | None]]:
        """搜尋訂單，一併帶出房名。

        MUST 先清理逾期訂單（`Repository.expire_stale_orders`）：後台的訂單列表
        是「讀取訂單列表」的三個呼叫點之一（data-model.md）。不清理的話，
        列表上會出現一批狀態顯示為待付款、實際上早該取消的訂單。
        """
        await self.expire_stale_orders()

        stmt = self._apply_filters(
            select(Order, Room.name).join(Room, Room.id == Order.room_id),
            order_no=order_no,
            status=status,
            room_id=room_id,
            start=start,
            end=end,
        ).order_by(Order.created_at.desc(), Order.id)

        rows = (await self.session.execute(stmt)).all()
        return [(order, room_name) for order, room_name in rows]

    async def get(self, order_id: uuid.UUID) -> Order | None:
        await self.expire_stale_orders()
        return await self.session.scalar(select(Order).where(Order.id == order_id))

    async def set_status(self, order: Order, status: str, *, cancel_reason: str | None) -> Order:
        """變更狀態。

        ⚠️ **只動 `status` 與 `cancel_reason`。** 金額、日期與 `expires_at` 由
        資料庫 trigger 保護為不可變更（FR-032、FR-101），碰了會被擋下。
        """
        order.status = status
        if cancel_reason is not None:
            order.cancel_reason = cancel_reason
        await self.session.flush()
        return order


__all__ = ["AdminOrderRepository"]
