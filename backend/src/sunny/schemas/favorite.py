"""收藏清單的 API 形狀（FR-092、FR-095）。"""

from __future__ import annotations

from sunny.schemas.room import RoomOut


class FavoriteRoomOut(RoomOut):
    """收藏清單中的一列。

    ⚠️ 多一個 `listed`：**已下架的房源仍會出現在清單中**，由前端標示為
    「已下架」而非顯示錯誤或空白卡片（FR-095）。

    為什麼不直接讓前端看 `status == "maintenance"`：那是**業者視角**的營運狀態
    （「整理中」），對會員沒有意義——他不需要知道那間房是在整理還是在裝修，
    只需要知道現在訂不了。語意轉換發生在後端，前端就不會各自解讀。

    被刪除的房源不需要任何處理：`favorites.room_id` 是 `on delete cascade`，
    房源消失時收藏一併消失。
    """

    #: false = 已下架，前端 MUST 標示且 MUST NOT 提供訂房入口
    listed: bool

    @classmethod
    def of(cls, room: object, *, listed: bool) -> FavoriteRoomOut:
        return cls(**RoomOut.model_validate(room).model_dump(by_alias=False), listed=listed)


__all__ = ["FavoriteRoomOut"]
