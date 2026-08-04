"""退款審核的資料存取（FR-038、FR-039、FR-057）。

## 核准為什麼會釋回房況，而這裡看不到任何「釋回」的程式碼

訂單轉為 `refunded` 之後就不再落在排除約束的 `where status in
('pending-payment', 'confirmed', 'refund-pending')` 之內，該區間**自動**對
新訂單開放（models/order.py）。

沒有「釋放房況」這個動作可寫，也不該有。若房況另以一張表或一個欄位維護，
「改了訂單狀態卻忘了同步房況」就會成為可能，而它的徵狀是房間安靜地賣不出去
——沒有任何錯誤。SC-006 要求核准後該區間於下一次搜尋重新出現，這是**推導**
出來的，不是同步出來的。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, select

from sunny.models.order import STATUS_CONFIRMED, STATUS_REFUNDED, Order
from sunny.models.profile import Profile
from sunny.models.refund import STATUS_APPROVED, STATUS_REJECTED, Refund
from sunny.repositories.base import Repository

#: 一列審核檢視：退款申請、對應訂單、申請人顯示名稱。
RefundRow = tuple[Refund, Order, str | None]


class AdminRefundRepository(Repository):
    """跨會員的退款查詢與審核。**僅供 `require_admin` 的路由使用。**"""

    def _base_query(self) -> Select:
        return (
            select(Refund, Order, Profile.display_name)
            .join(Order, Order.id == Refund.order_id)
            .join(Profile, Profile.id == Refund.user_id)
        )

    async def search(self, *, status: str | None = None) -> list[RefundRow]:
        """依狀態列出退款申請。

        排序由舊到新——同 `admin_reviews`，這是工作佇列而非閱讀清單。
        退款尤其如此：申請人正在等錢，先到先審是唯一站得住腳的順序。
        """
        stmt = self._base_query()
        if status is not None:
            stmt = stmt.where(Refund.status == status)

        result = await self.session.execute(stmt.order_by(Refund.created_at.asc()))
        return [(refund, order, name) for refund, order, name in result.all()]

    async def get(self, refund_id: uuid.UUID) -> RefundRow | None:
        result = await self.session.execute(self._base_query().where(Refund.id == refund_id))
        row = result.first()
        if row is None:
            return None
        refund, order, name = row
        return refund, order, name

    async def approve(self, refund: Refund, order: Order, *, note: str | None) -> None:
        """核准（FR-038）。訂單轉 `refunded`，該區間立即釋回。**不提交。**"""
        refund.status = STATUS_APPROVED
        refund.reviewed_at = datetime.now(UTC)
        if note is not None:
            refund.admin_note = note
        order.status = STATUS_REFUNDED
        await self.session.flush()

    async def reject(self, refund: Refund, order: Order, *, note: str | None) -> None:
        """駁回（FR-039）。訂單退回 `confirmed`，該區間仍由這張訂單佔著。**不提交。**

        訂單必須回到 `confirmed` 而不是停在 `refund-pending`：客人的錢還在、
        房間還是他的，停在「退款申請中」會讓他在「我的訂單」看到一個永遠不會
        結束的狀態。且 FR-039 明訂駁回後會員可再次申請——`refunds` 上的部分
        唯一索引只擋「審核中」那一筆，被駁回的不佔位（models/refund.py）。
        """
        refund.status = STATUS_REJECTED
        refund.reviewed_at = datetime.now(UTC)
        if note is not None:
            refund.admin_note = note
        order.status = STATUS_CONFIRMED
        await self.session.flush()


__all__ = ["AdminRefundRepository", "RefundRow"]
