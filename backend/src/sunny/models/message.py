"""messages — 會員與客服團隊的一對一私訊（FR-123 ~ FR-128）。

**討論串以會員為單位，刻意不存收件者。** 存了就得回答「哪一位管理員」，
而那正是不該綁定的東西——被指派者休假時整串無人回覆，而這項功能要解決的
正是不漏接（FR-127）。任一管理員都能讀取並回覆所有討論串。

**送出後內容不可修改**，已讀時間是唯一可事後更新的欄位（FR-124）。
理由與操作日誌相同：一則能事後改字的訊息，在爭議發生時沒有任何佐證能力。
由 `guard_message_update()` trigger 強制。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

SENDER_MEMBER = "member"
SENDER_ADMIN = "admin"
SENDER_ROLES = (SENDER_MEMBER, SENDER_ADMIN)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("sender_role in ('member', 'admin')", name="messages_sender_role_check"),
        CheckConstraint("char_length(body) between 1 and 2000", name="messages_body_check"),
    )

    id: Mapped[uuid_pk]

    #: 討論串的擁有者，永遠是那位會員。
    thread_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )

    #: ⚠️ **發話者身分與角色 MUST 由伺服器判定，MUST NOT 採信前端送出的值**
    #: （FR-125）。否則會員可在自己的討論串中偽造一則「官方回覆」——那一串
    #: 本就屬於他，權限規則擋不住這種寫入。
    #:
    #: 舊架構由 `stamp_message_sender()` trigger 以 `auth.uid()` 蓋章；
    #: 新架構中「伺服器」即 FastAPI，由路由層明確填入這兩個欄位。
    sender_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    sender_role: Mapped[str] = mapped_column(String, nullable=False)

    body: Mapped[str] = mapped_column(Text, nullable=False)

    #: 唯一可事後更新的欄位。
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[created_at]


__all__ = ["SENDER_ADMIN", "SENDER_MEMBER", "SENDER_ROLES", "Message"]
