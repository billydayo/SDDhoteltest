"""channel_prices — 渠道比價。**模擬資料。**

⚠️ 此表的內容來自種子腳本，**不是真實爬取結果**。系統不爬取任何網站，
也不呼叫任何 OTA 的 API（FR-109、憲章原則 VI）。

限制的理由已於 2026-08-03 更新：**不是技術做不到**（現在有後端了），
**而是爬取 OTA 平台通常違反其服務條款**。這是法律與倫理的限制。
憲章明訂「後端的存在 MUST NOT 被當成『現在可以寫爬蟲了』的理由」
（research B1-a）。

介面 MUST 常駐標示其為模擬（FR-110）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, uuid_pk


class ChannelPrice(Base):
    __tablename__ = "channel_prices"
    __table_args__ = (CheckConstraint("channel_price > 0", name="channel_price_check"),)

    id: Mapped[uuid_pk]
    room_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    #: 外部平台名稱（Agoda、Booking 等）。
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    #: 該平台的售價，整數新臺幣元。低於官網價時觸發「賤賣預警」（FR-111）。
    channel_price: Mapped[int] = mapped_column(nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    #: 管理員可將預警標記為已處理（FR-113），該動作寫入操作日誌。
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))


__all__ = ["ChannelPrice"]
