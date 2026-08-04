"""收藏的資料存取（FR-091、FR-092、FR-094、FR-095）。

⚠️ **每一個方法都以 `user_id` 收斂，且 `user_id` 是必填的關鍵字參數。**

移除 RLS 之後，「只能看到自己的收藏」不再由資料庫保證。做成必填而非可選，
是為了讓「忘記帶」變成呼叫時就失敗，而不是回傳全體會員的收藏
（deps.py：預設 MUST 是拒絕而非放行）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select

from sunny.models.favorite import Favorite
from sunny.models.room import Room
from sunny.repositories.base import Repository

#: 一列收藏：房源本身（收藏時間只用於排序，不對外顯示）。
FavoriteRow = Room


class FavoriteRepository(Repository):
    """會員自己的收藏。"""

    async def list_for(self, *, user_id: uuid.UUID) -> list[Room]:
        """依收藏時間**由新到舊**（FR-092）。

        以 inner join 取房源：`favorites.room_id` 是 `on delete cascade`，
        房源被刪除時收藏會一併消失，因此不會有「指向不存在房源」的列
        （FR-095、models/favorite.py）。

        **已下架（整理中）的房源仍然回傳**，由前端標示為已下架。自動移除會讓
        使用者的收藏在他沒做任何事的情況下憑空少一筆——而下架通常是暫時的。
        """
        stmt = (
            select(Room)
            .join(Favorite, Favorite.room_id == Room.id)
            .where(Favorite.user_id == user_id)
            .order_by(Favorite.created_at.desc(), Room.id)
        )
        return list((await self.session.scalars(stmt)).all())

    async def room_ids_for(self, *, user_id: uuid.UUID) -> set[uuid.UUID]:
        """該會員收藏的房源 id 集合，供房源列表標示星號狀態。"""
        rows = await self.session.scalars(
            select(Favorite.room_id).where(Favorite.user_id == user_id)
        )
        return set(rows.all())

    async def exists(self, *, user_id: uuid.UUID, room_id: uuid.UUID) -> bool:
        return (
            await self.session.scalar(
                select(Favorite.room_id).where(
                    Favorite.user_id == user_id, Favorite.room_id == room_id
                )
            )
        ) is not None

    async def add(self, *, user_id: uuid.UUID, room_id: uuid.UUID) -> None:
        """加入收藏。**重複收藏視為成功**，不提交。

        複合主鍵讓重複插入會拋 `IntegrityError`，但那不是使用者的錯——他按了
        一顆看起來沒生效的星號兩次。先查再寫；競態下真的撞到主鍵時，
        呼叫端會把它當成「已經在收藏裡了」處理，結果相同。
        """
        if await self.exists(user_id=user_id, room_id=room_id):
            return
        self.session.add(Favorite(user_id=user_id, room_id=room_id))
        await self.session.flush()

    async def remove(self, *, user_id: uuid.UUID, room_id: uuid.UUID) -> bool:
        """取消收藏。回傳是否真的刪到一列。**不提交。**"""
        result = await self.session.execute(
            delete(Favorite).where(Favorite.user_id == user_id, Favorite.room_id == room_id)
        )
        return bool(result.rowcount)


__all__ = ["FavoriteRepository", "FavoriteRow"]
