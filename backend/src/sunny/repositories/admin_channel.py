"""渠道比價的資料存取（FR-108、FR-111、FR-113）。

⚠️ **本檔只讀 `channel_prices` 這張表，不發出任何對外網路請求。**

系統不爬取任何網站，也不呼叫任何 OTA 的 API（FR-109、憲章原則 VI）。
限制的理由不是技術做不到——現在有後端了——而是**爬取 OTA 平台通常違反其
服務條款**。「後端的存在 MUST NOT 被當成『現在可以寫爬蟲了』的理由」
（research B1-a、models/channel_price.py）。

T154 有一項測試斷言本模組運作期間對外請求數為 0。
"""

from __future__ import annotations

import uuid

from sqlalchemy import Select, func, select

from sunny.models.channel_price import ChannelPrice
from sunny.models.room import Room
from sunny.repositories.base import Repository

#: 一列比價：外部售價紀錄 + 該房源的名稱與官網價。
ChannelRow = tuple[ChannelPrice, str, int]


class ChannelPriceRepository(Repository):
    """種子資料的查詢。**僅供 `require_admin` 的路由使用。**"""

    def _base_query(self) -> Select:
        return select(ChannelPrice, Room.name, Room.nightly_price).join(
            Room, Room.id == ChannelPrice.room_id
        )

    async def search(
        self,
        *,
        room_id: uuid.UUID | None = None,
        resolved: bool | None = None,
    ) -> list[ChannelRow]:
        """依房源與處理狀態列出比價紀錄。

        排序：**未處理在前**，其次房源名稱。這個模組的用途是找出賤賣並處理它，
        已標記處理過的往下排才不會把待辦淹掉。
        """
        stmt = self._base_query()
        if room_id is not None:
            stmt = stmt.where(ChannelPrice.room_id == room_id)
        if resolved is not None:
            stmt = stmt.where(ChannelPrice.resolved.is_(resolved))

        stmt = stmt.order_by(ChannelPrice.resolved, Room.name, ChannelPrice.channel)
        result = await self.session.execute(stmt)
        return [(price, name, official) for price, name, official in result.all()]

    async def get(self, price_id: uuid.UUID) -> ChannelRow | None:
        result = await self.session.execute(self._base_query().where(ChannelPrice.id == price_id))
        row = result.first()
        if row is None:
            return None
        price, name, official = row
        return price, name, official

    async def unresolved_alert_count(self) -> int:
        """未處理的賤賣預警筆數，供儀表板顯示（FR-111）。

        判定條件與 `services/channel.py` 的 `is_underpriced()` 一致：
        外部售價**低於**官網價。等價不算——同價不是賤賣，把它算成預警只會
        讓那個數字永遠不歸零，而永遠不歸零的提醒等於沒有提醒。
        """
        stmt = (
            select(func.count())
            .select_from(ChannelPrice)
            .join(Room, Room.id == ChannelPrice.room_id)
            .where(
                ChannelPrice.resolved.is_(False),
                ChannelPrice.channel_price < Room.nightly_price,
            )
        )
        return int(await self.session.scalar(stmt) or 0)

    async def mark_resolved(self, price: ChannelPrice, *, resolved: bool = True) -> ChannelPrice:
        """標記已處理（FR-113）。**不提交**——由呼叫端與稽核紀錄一併提交。"""
        price.resolved = resolved
        await self.session.flush()
        return price


__all__ = ["ChannelPriceRepository", "ChannelRow"]
