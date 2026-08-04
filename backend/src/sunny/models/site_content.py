"""site_content — 前台可由後台編輯的首頁內容。**全站僅一筆。**

單列由 `site_content_singleton` CHECK 約束強制：主鍵固定為
`00000000-0000-0000-0000-000000000001`，因此不可能出現第二筆。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base

#: 全站唯一那一筆的主鍵。
SITE_CONTENT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class SiteContent(Base):
    __tablename__ = "site_content"
    __table_args__ = (
        CheckConstraint(
            "id = '00000000-0000-0000-0000-000000000001'::uuid",
            name="site_content_singleton",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        server_default=text("'00000000-0000-0000-0000-000000000001'::uuid"),
    )
    hero_title: Mapped[str] = mapped_column(Text, nullable=False, default="Sunny 訂房平台")
    hero_subtitle: Mapped[str] = mapped_column(Text, nullable=False, default="舒適住宿，安心入住")
    #: 主圖。可由本機上傳（上傳前於瀏覽器內壓縮）或填入網址（FR-061）。
    #: 前台 MUST 為其提供有意義的替代文字。
    hero_image: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


__all__ = ["SITE_CONTENT_ID", "SiteContent"]
