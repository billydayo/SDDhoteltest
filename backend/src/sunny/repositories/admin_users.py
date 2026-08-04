"""會員資料的後台查詢（FR-055）。

憲章原則 III：資料存取集中於資料層，MUST NOT 讓 ORM 查詢散落於路由。
`routers/admin_users.py` 與匯出端點共用這裡的同一個 `search()`——
共用是 SC-033 的前提：匯出的筆數要 100% 等於畫面上的筆數，兩邊各寫一份
查詢遲早會有一邊多帶或少帶一個條件。
"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select

from sunny.models.profile import Profile
from sunny.repositories.base import Repository


class AdminUserRepository(Repository):
    """跨會員的帳號查詢。**僅供 `require_admin` 的路由使用。**"""

    async def search(
        self,
        *,
        keyword: str | None = None,
        role: str | None = None,
    ) -> list[Profile]:
        """依關鍵字（顯示名稱或電子郵件）與角色篩選，由新到舊。

        ⚠️ 電子郵件可用來**搜尋**，但 MUST NOT 出現在匯出檔中（FR-058）。
        兩者不衝突：搜尋是管理員在畫面上找人，匯出是一份會離開系統的檔案。
        限制的是後者（`services/export.py` 的 `USER_COLUMNS`）。
        """
        stmt = select(Profile)
        if keyword:
            like = f"%{keyword.strip()}%"
            stmt = stmt.where(or_(Profile.display_name.ilike(like), Profile.email.ilike(like)))
        if role:
            stmt = stmt.where(Profile.role == role)

        stmt = stmt.order_by(Profile.created_at.desc(), Profile.id)
        return list((await self.session.scalars(stmt)).all())

    async def get(self, user_id: uuid.UUID) -> Profile | None:
        return await self.session.scalar(select(Profile).where(Profile.id == user_id))


__all__ = ["AdminUserRepository"]
