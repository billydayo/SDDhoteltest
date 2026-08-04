"""系統參數與詞彙表的資料存取。"""

from __future__ import annotations

from typing import Any, Final

from sqlalchemy import select

from sunny.models.system_setting import (
    KEY_PENDING_PAYMENT_MINUTES,
    KEY_ROOM_AMENITIES,
    KEY_ROOM_FEATURES,
    SystemSetting,
)
from sunny.repositories.base import Repository

#: 程式內建的預設值。
#:
#: FR-010a：詞彙表「尚未設定過時 MUST 退回程式內建的預設值，MUST NOT 顯示
#: 空白的篩選群組」。資料表被清空或設定被誤刪時，篩選器仍要能用。
#:
#: ⚠️ 這**不是**第二份事實來源——正常情況下永遠讀得到資料庫的值，這裡只是
#: 資料缺失時的後備。清單為空是合法狀態（前端隱藏該組篩選），與「尚未設定過」
#: 不同：前者是管理員刻意清空，後者是資料不存在。
DEFAULT_AMENITIES: Final = [
    "免費 Wi-Fi",
    "冷氣",
    "獨立衛浴",
    "浴缸",
    "陽台",
    "小冰箱",
    "書桌",
    "衣櫃",
    "客廳區",
    "咖啡機",
    "備品組",
    "加床服務",
    "嬰兒床可租借",
]

DEFAULT_FEATURES: Final = [
    "採光佳",
    "安靜樓層",
    "商務友善",
    "情侶推薦",
    "親子友善",
    "朋友同行",
    "泡澡放鬆",
    "無障礙",
    "可加床",
]

DEFAULT_PENDING_PAYMENT_MINUTES: Final = 60


class SettingsRepository(Repository):
    async def _get_raw(self, key: str) -> Any | None:
        return await self.session.scalar(
            select(SystemSetting.value).where(SystemSetting.key == key)
        )

    async def _get_list(self, key: str, fallback: list[str]) -> list[str]:
        value = await self._get_raw(key)
        if value is None:
            # 尚未設定過 → 退回內建預設值（FR-010a）
            return list(fallback)
        if not isinstance(value, list):
            return list(fallback)
        # 空清單是合法狀態：管理員刻意清空，前端隱藏該組篩選
        return [str(v) for v in value]

    async def amenities(self) -> list[str]:
        return await self._get_list(KEY_ROOM_AMENITIES, DEFAULT_AMENITIES)

    async def features(self) -> list[str]:
        return await self._get_list(KEY_ROOM_FEATURES, DEFAULT_FEATURES)

    async def pending_payment_minutes(self) -> int:
        """未付款訂單的保留分鐘數（FR-098）。

        ⚠️ 此值供顯示與驗證使用。**訂單的 `expires_at` 由資料庫的欄位預設值
        決定**，於建單當下寫入後即固定——參數日後變更 MUST NOT 回溯影響既有
        訂單（FR-101）。不要在應用層重算 `expires_at`。
        """
        value = await self._get_raw(KEY_PENDING_PAYMENT_MINUTES)
        try:
            return int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return DEFAULT_PENDING_PAYMENT_MINUTES


__all__ = [
    "DEFAULT_AMENITIES",
    "DEFAULT_FEATURES",
    "DEFAULT_PENDING_PAYMENT_MINUTES",
    "SettingsRepository",
]
