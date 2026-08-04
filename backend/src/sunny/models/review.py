"""reviews — 評論。

`order_id` 為 **UNIQUE** 外鍵：一筆訂單只能評論一次（FR-043）。重複送出時
資料庫回 `reviews_order_id_key`，由 errors.py 轉為 409。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
REVIEW_STATUSES = (STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED)

#: 自動審核的初判。**這是規則式引擎，不是 AI**——介面 MUST 標示為
#: 「自動審核（規則式）」，MUST NOT 被描述為 AI 判讀（FR-103a、憲章原則 VI）。
VERDICT_PASS = "auto-pass"
VERDICT_REJECT = "auto-reject"
AUTO_VERDICTS = (VERDICT_PASS, VERDICT_REJECT)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating between 1 and 5", name="reviews_rating_check"),
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="reviews_status_check"
        ),
        CheckConstraint(
            "auto_verdict in ('auto-pass', 'auto-reject')", name="reviews_auto_verdict_check"
        ),
        CheckConstraint(
            "admin_reply is null or char_length(admin_reply) between 1 and 1000",
            name="reviews_admin_reply_check",
        ),
    )

    id: Mapped[uuid_pk]

    #: UNIQUE：一筆訂單一則評論。
    order_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )

    rating: Mapped[int] = mapped_column(nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)

    #: 送出後一律進入 pending，**MUST NOT 因自動審核結果而直接公開**（FR-103）。
    status: Mapped[str] = mapped_column(String, nullable=False, default=STATUS_PENDING)

    auto_verdict: Mapped[str | None] = mapped_column(String, nullable=True)
    #: 觸發的規則代碼，供管理員複核。自動審核 MUST NOT 成為不可申訴的最終判定。
    auto_rules: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: 業者公開回覆（FR-103d）。掛在評論上而非某位管理員名下——回覆代表店家，
    #: 換人接手不必轉交。前台 MUST NOT 顯示回覆者姓名。
    #: 清空內容等同收回回覆（由 `stamp_review_reply` trigger 一併清掉時間與人）。
    admin_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_reply_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True
    )

    created_at: Mapped[created_at]

    def __repr__(self) -> str:  # pragma: no cover - 除錯用
        return f"<Review id={self.id} rating={self.rating} status={self.status}>"


__all__ = [
    "AUTO_VERDICTS",
    "REVIEW_STATUSES",
    "STATUS_APPROVED",
    "STATUS_PENDING",
    "STATUS_REJECTED",
    "VERDICT_PASS",
    "VERDICT_REJECT",
    "Review",
]
