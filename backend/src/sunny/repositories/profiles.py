"""會員資料存取。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from sunny.models.profile import ROLE_MEMBER, Profile
from sunny.repositories.base import Repository


class ProfileRepository(Repository):
    async def get(self, profile_id: uuid.UUID) -> Profile | None:
        return await self.session.scalar(select(Profile).where(Profile.id == profile_id))

    async def get_by_email(self, email: str) -> Profile | None:
        """以 email 查詢。**大小寫不敏感。**

        `Foo@x.com` 與 `foo@x.com` 是同一個信箱。若區分大小寫，同一個人能註冊
        兩次，而 FR-088 要求「以既有電子郵件的 Google 帳號登入時進入既有帳號」
        會在大小寫不同時失效——使用者會發現訂單不見了。
        """
        return await self.session.scalar(
            select(Profile).where(func.lower(Profile.email) == email.strip().lower())
        )

    async def get_by_google_sub(self, google_sub: str) -> Profile | None:
        return await self.session.scalar(select(Profile).where(Profile.google_sub == google_sub))

    async def create(
        self,
        *,
        email: str,
        password_hash: str | None,
        display_name: str,
        google_sub: str | None = None,
    ) -> Profile:
        """建立會員。

        `role` 固定為 `member`，**不接受呼叫端指定**——角色升降只能經管理員
        端點，且 MUST 進稽核日誌（data-model.md）。
        """
        profile = Profile(
            email=email.strip().lower(),
            password_hash=password_hash,
            google_sub=google_sub,
            display_name=display_name.strip(),
            role=ROLE_MEMBER,
        )
        self.session.add(profile)
        await self.session.flush()
        return profile


__all__ = ["ProfileRepository"]
