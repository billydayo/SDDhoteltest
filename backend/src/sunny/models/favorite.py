"""favorites — 會員收藏房源。複合主鍵，同一會員對同一房源至多一筆。"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    #: `on delete cascade`：房源被刪除時收藏自動消失，收藏清單因而不會出現
    #: 錯誤或空白卡片（FR-095）。
    room_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("rooms.id", ondelete="CASCADE"),
        primary_key=True,
    )
    #: 收藏清單依此由新到舊排序（FR-092）。
    created_at: Mapped[created_at]


__all__ = ["Favorite"]
