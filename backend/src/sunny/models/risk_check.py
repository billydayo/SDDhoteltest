"""room_risk_checks — 管理員對自家房源的品質檢測。

⚠️ **只有管理員路徑會寫入此表。**

前台「安全檢測」由使用者自行上傳的照片 MUST NOT 產生任何此表資料列，也
MUST NOT 被寫入任何儲存空間——那是使用者的私人照片，全程留在瀏覽器內
（FR-086、SC-030、憲章原則 VI）。

保證的方式不是靠紀律，而是靠結構：前端根本沒有能上傳它的函式可呼叫
（research R8）。T144 有一項測試斷言前台模組的相依圖不含任何上傳模組。
"""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

LEVEL_LOW = "low"
LEVEL_MEDIUM = "medium"
LEVEL_HIGH = "high"
RISK_LEVELS = (LEVEL_LOW, LEVEL_MEDIUM, LEVEL_HIGH)


class RoomRiskCheck(Base):
    __tablename__ = "room_risk_checks"
    __table_args__ = (
        CheckConstraint("brightness between 0 and 100", name="risk_brightness_check"),
        CheckConstraint("clutter between 0 and 100", name="risk_clutter_check"),
        CheckConstraint("contrast between 0 and 100", name="risk_contrast_check"),
        CheckConstraint("risk_score between 0 and 100", name="risk_score_check"),
        CheckConstraint("risk_level in ('low', 'medium', 'high')", name="risk_level_check"),
    )

    id: Mapped[uuid_pk]
    room_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )

    #: 三項指標各 0–100，**100 表示表現較佳**。
    brightness: Mapped[int] = mapped_column(nullable=False)
    clutter: Mapped[int] = mapped_column(nullable=False)
    contrast: Mapped[int] = mapped_column(nullable=False)

    #: 100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)。**分數越高代表風險越高**
    #: （FR-068）。等級切分：0–34 低／35–59 中／60–100 高。
    risk_score: Mapped[int] = mapped_column(nullable=False)
    risk_level: Mapped[str] = mapped_column(String, nullable=False)

    #: 受檢圖片。此圖**會公開於房源詳情頁**，上傳前 MUST 明確告知管理員（FR-105）。
    image_path: Mapped[str] = mapped_column(Text, nullable=False)

    checked_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[created_at]


__all__ = ["LEVEL_HIGH", "LEVEL_LOW", "LEVEL_MEDIUM", "RISK_LEVELS", "RoomRiskCheck"]
