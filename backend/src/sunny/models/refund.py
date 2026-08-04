"""refunds — 退款申請。

兩項保證由資料庫承擔，不只靠前端：

- **同一訂單同時僅一筆審核中**：部分唯一索引 `refunds_one_pending_per_order`
  （FR-036）。駁回後可再次提出。
- **每位會員上限 5 筆**：`enforce_refund_limit()` trigger（FR-036d）。
  **被駁回的不佔額度**——若駁回也計入，被駁回 5 次的會員將無法再申請，
  與 FR-039「駁回後可再次申請」直接矛盾（SC-031）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
REFUND_STATUSES = (STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED)

#: 佔用退款額度的狀態。**不含 rejected**（SC-031）。
QUOTA_STATUSES = (STATUS_PENDING, STATUS_APPROVED)

#: 每位會員的退款申請上限（FR-036b）。與資料庫 trigger 中的常數一致。
MAX_REFUNDS_PER_USER = 5


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="refunds_amount_check"),
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="refunds_status_check"
        ),
    )

    id: Mapped[uuid_pk]
    order_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )

    reason: Mapped[str] = mapped_column(Text, nullable=False)

    #: 依距入住日分級後的金額，整數新臺幣元（FR-041）：
    #: 7 天以上全額／3–6 天 50%／1–2 天 20%／當日起 0%。
    amount: Mapped[int] = mapped_column(nullable=False)

    status: Mapped[str] = mapped_column(String, nullable=False, default=STATUS_PENDING)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at]
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - 除錯用
        return f"<Refund id={self.id} amount={self.amount} status={self.status}>"


__all__ = [
    "MAX_REFUNDS_PER_USER",
    "QUOTA_STATUSES",
    "REFUND_STATUSES",
    "STATUS_APPROVED",
    "STATUS_PENDING",
    "STATUS_REJECTED",
    "Refund",
]
