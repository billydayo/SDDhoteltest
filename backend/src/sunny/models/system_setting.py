"""system_settings — 可由管理員調整的營運參數。

參數 MUST 集中於單一設定來源，MUST NOT 硬編碼散落於程式碼中（FR-120）。
變更 MUST 有範圍檢查且 MUST 進稽核日誌（FR-119）。

⚠️ **保留分鐘數的變更 MUST NOT 回溯影響既有訂單**（FR-101）。
`orders.expires_at` 於建單時就寫入，之後不再重算——這由 orders 的
`guard_order_transition()` trigger 把關（它禁止變更 `expires_at`）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base

#: 未付款訂單的保留分鐘數。預設 60，允許 5–1440（由 CHECK 約束把關）。
KEY_PENDING_PAYMENT_MINUTES = "pending_payment_minutes"
PENDING_PAYMENT_MIN = 5
PENDING_PAYMENT_MAX = 1440

#: 設施與房型特色的詞彙表（FR-010a）。可由管理員增刪，變更後同時套用至
#: 前台搜尋列與後台房源表單。**MUST 對未登入的訪客可讀**，否則前台篩選器
#: 會是空的。尚未設定過時 MUST 退回程式內建預設值。
KEY_ROOM_AMENITIES = "room_amenities"
KEY_ROOM_FEATURES = "room_features"


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = (
        CheckConstraint(
            "key <> 'pending_payment_minutes' or ((value)::int between 5 and 1440)",
            name="settings_valid_range",
        ),
    )

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[object] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


__all__ = [
    "KEY_PENDING_PAYMENT_MINUTES",
    "KEY_ROOM_AMENITIES",
    "KEY_ROOM_FEATURES",
    "PENDING_PAYMENT_MAX",
    "PENDING_PAYMENT_MIN",
    "SystemSetting",
]
