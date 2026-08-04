"""首頁內容的資料存取（FR-061）。

單列的表也走 repository：憲章原則 III 沒有「只有一列就不算」的例外。
一支路由裡的 `select()` 看起來無害，但它是下一支路由照著抄的範本。
"""

from __future__ import annotations

from sqlalchemy import select

from sunny.models.site_content import SITE_CONTENT_ID, SiteContent
from sunny.repositories.base import Repository


class SiteContentRepository(Repository):
    async def get_or_create(self) -> SiteContent:
        """取得那唯一一列，不存在時建立預設值。**不提交。**

        不回 404：`site_content` 是單例（`site_content_singleton` CHECK 約束），
        全新的資料庫尚未跑過種子時它會是空的，而首頁不該因此壞掉。
        """
        content = await self.session.scalar(
            select(SiteContent).where(SiteContent.id == SITE_CONTENT_ID)
        )
        if content is None:
            content = SiteContent(id=SITE_CONTENT_ID)
            self.session.add(content)
            await self.session.flush()
        return content


__all__ = ["SiteContentRepository"]
