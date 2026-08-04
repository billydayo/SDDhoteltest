"""我的收藏（FR-091 ~ FR-095）。

⚠️ **本檔全部端點需登入。**

⚠️ **沒有任何端點接受 `userId` 參數。** 對象一律取自 token
（`CurrentUser`）——這是 FR-094「會員 MUST NOT 能讀取或修改其他使用者的收藏」
在結構上的達成方式：不是「檢查 userId 等於自己」，而是**根本沒有那個參數可填**。

檢查式的寫法要求每一支端點都記得檢查，而漏掉一支不會有任何測試失敗；
沒有參數則讓越權在介面上不可表達。T150 的契約測試驗證這一點。

## 未登入時的導向由前端負責

FR-093：「未登入者點選收藏 MUST 被導向登入頁，登入後 MUST 回到原房源並完成
收藏。」後端只回 401；記住「原本要收藏哪一間」是前端的狀態（T152）。
後端無從得知使用者當時在哪一頁。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from sunny.deps import CurrentUser, SessionDep
from sunny.errors import DomainError
from sunny.models.room import ROOM_MAINTENANCE
from sunny.repositories.favorites import FavoriteRepository
from sunny.repositories.rooms import RoomRepository
from sunny.schemas.favorite import FavoriteRoomOut

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.get("", response_model=list[FavoriteRoomOut], summary="我的收藏（需登入）")
async def list_favorites(session: SessionDep, user: CurrentUser) -> list[FavoriteRoomOut]:
    """需登入。依收藏時間由新到舊（FR-092）。

    ⚠️ 已下架的房源**仍會回傳**，帶 `listed: false`，由前端標示為「已下架」
    （FR-095）。被刪除的房源則因 `on delete cascade` 而自然消失——
    兩種情況都不會產生錯誤或空白卡片。
    """
    rooms = await FavoriteRepository(session).list_for(user_id=user.id)
    return [FavoriteRoomOut.of(room, listed=room.status != ROOM_MAINTENANCE) for room in rooms]


@router.post(
    "/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="加入收藏（需登入）",
)
async def add_favorite(room_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    """需登入（FR-091）。**重複收藏視為成功。**

    使用者按了一顆看起來沒生效的星號兩次，不該得到一個錯誤。冪等在這裡
    比嚴格更正確——最終狀態就是他要的狀態。
    """
    if await RoomRepository(session).get(room_id) is None:
        raise DomainError("查無此房源。", code="ROOM_NOT_FOUND", status_code=404)

    repo = FavoriteRepository(session)
    await repo.add(user_id=user.id, room_id=room_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="取消收藏（需登入）",
)
async def remove_favorite(room_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    """需登入（FR-091）。**取消一個不在收藏裡的房源同樣視為成功。**

    不回 404：對使用者而言「它不在我的收藏裡」已經是他要的結果。而且回 404
    會讓「別人的收藏裡有沒有這間房」變得可以用回應碼探測——即使刪不掉。
    """
    await FavoriteRepository(session).remove(user_id=user.id, room_id=room_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
