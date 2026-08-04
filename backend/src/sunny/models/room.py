"""rooms — 房源。"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

#: rooms.status 的合法值。
#:
#: **刻意沒有 `booked`。** 「已預訂」綁定日期，由當日的有效訂單即時推導
#: （FR-015、FR-051a）。寫成欄位就得在退房時改回來，漏改一次該房源就永久
#: 無法販售。可人工設定的只有這兩種（FR-051）。
ROOM_AVAILABLE = "available"
ROOM_MAINTENANCE = "maintenance"
ROOM_STATUSES = (ROOM_AVAILABLE, ROOM_MAINTENANCE)


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (
        CheckConstraint("max_guests > 0", name="rooms_max_guests_check"),
        CheckConstraint("nightly_price > 0", name="rooms_nightly_price_check"),
        CheckConstraint("status in ('available', 'maintenance')", name="rooms_status_check"),
    )

    id: Mapped[uuid_pk]
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    max_guests: Mapped[int] = mapped_column(nullable=False)

    #: **整數新臺幣元。** MUST NOT 以浮點數承載（憲章原則 IV）。
    nightly_price: Mapped[int] = mapped_column(nullable=False)

    images: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    #: 設施與房型特色。兩者皆有 GIN 索引，供 jsonb 包含運算子做 AND 篩選
    #: （FR-010：須同時具備所選全部設施）。
    amenities: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    features: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )

    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default=ROOM_AVAILABLE)

    #: 由通過審核的評論導出（`refresh_room_rating()` trigger）。
    #:
    #: **null = 尚無評分，MUST NOT 以 0 表示**——0 分會被讀成「評價極差」，
    #: 而實際上是還沒有人評過（FR-047）。
    average_rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)

    created_at: Mapped[created_at]

    def __repr__(self) -> str:  # pragma: no cover - 除錯用
        return f"<Room id={self.id} name={self.name!r} status={self.status}>"


__all__ = ["ROOM_AVAILABLE", "ROOM_MAINTENANCE", "ROOM_STATUSES", "Room"]
