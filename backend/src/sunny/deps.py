"""FastAPI 相依：身分與角色。

⚠️ **移除 RLS 後，這裡是唯一的存取邊界**（research R1、憲章原則 VI）。
前端的路由守衛只改變畫面呈現，MUST NOT 被描述為安全機制。

## 預設是「需登入」而非「公開」

每個路由 MUST 明確宣告其授權要求。這個方向很重要：新增路由時**忘記標註**
會導致拒絕而非放行。反過來設計的話，漏標的後果是一個無人察覺的公開端點。

公開端點（房源瀏覽、搜尋、已通過審核的評論、服務條款）MUST 以
`Depends(get_optional_user)` 或完全不加相依，並在路由上明確註記其為公開。

## 角色為何每次都重新查資料庫

JWT 的 payload 帶著簽發當下的 role，但**管理員可能在 token 有效期內被降權**
（spec 的 Edge Cases 明列此情境：「權限即時變更」）。若信任 payload 中的
role，被降權的使用者能繼續使用後台直到 token 過期。因此每次請求都重新查。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sunny.db import get_session
from sunny.errors import DomainError
from sunny.models.profile import ROLE_ADMIN, Profile
from sunny.services.auth import user_id_from_token

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _bearer_token(request: Request) -> str | None:
    """自 `Authorization: Bearer <token>` 取出 token。"""
    header = request.headers.get("Authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


async def get_optional_user(request: Request, session: SessionDep) -> Profile | None:
    """取得目前使用者，未登入時回 None。

    供**公開但會因登入而不同**的端點使用（例如房源詳情頁要顯示收藏狀態）。
    MUST NOT 用於受保護的端點——那裡要用 `get_current_user`。
    """
    token = _bearer_token(request)
    if token is None:
        return None
    user_id = user_id_from_token(token)
    return await session.scalar(select(Profile).where(Profile.id == user_id))


async def get_current_user(request: Request, session: SessionDep) -> Profile:
    """要求已登入。未認證回 401。"""
    token = _bearer_token(request)
    if token is None:
        raise DomainError("請先登入。", code="NOT_AUTHENTICATED", status_code=401)

    user_id = user_id_from_token(token)
    profile = await session.scalar(select(Profile).where(Profile.id == user_id))
    if profile is None:
        # token 有效但帳號已不存在（例如被刪除）。回 401 而非 404——
        # 從用戶端的角度，這與「憑證無效」是同一件事。
        raise DomainError("登入憑證無效，請重新登入。", code="TOKEN_INVALID", status_code=401)
    return profile


CurrentUser = Annotated[Profile, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> Profile:
    """要求管理員。

    **未認證回 401、已認證但非管理員回 403**——兩者是不同的事，混為一談會讓
    前端無法決定該導向登入頁還是顯示無權限。

    ⚠️ 這裡讀的是資料庫中的 `role`，不是 token payload 中的。管理員被降權時，
    其下一個操作就會被擋下（spec Edge Cases「權限即時變更」）。
    """
    if user.role != ROLE_ADMIN:
        raise DomainError(
            "此功能僅限管理員使用。",
            code="FORBIDDEN",
            status_code=403,
        )
    return user


AdminUser = Annotated[Profile, Depends(require_admin)]
OptionalUser = Annotated[Profile | None, Depends(get_optional_user)]

__all__ = [
    "AdminUser",
    "CurrentUser",
    "OptionalUser",
    "SessionDep",
    "get_current_user",
    "get_optional_user",
    "require_admin",
]
