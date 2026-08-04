"""評論審核的資料存取（FR-056、FR-103b~d）。

與 `repositories/reviews.py`（會員端，甲線 T109）分開，理由同 `admin_stats.py`：
本檔的每一個方法都是**跨會員**的，只由 `require_admin` 的路由呼叫。

## 平均評分不在這裡算

`rooms.average_rating` 由資料庫的 `reviews_refresh_rating` trigger 在
insert／update／delete 之後重算（0001_initial.py）。此處 MUST NOT 另外算一次
再寫回去——兩份算法遲早會分歧，而分歧的徵狀是「刪掉一則差評後平均沒變」，
沒有任何錯誤訊息。

憲章原則 IV：資料庫的約束才是保證。這裡連保證都不必寫。
"""

from __future__ import annotations

import uuid

from sqlalchemy import Select, select
from sqlalchemy.orm import aliased

from sunny.models.profile import Profile
from sunny.models.review import Review
from sunny.models.room import Room
from sunny.repositories.base import Repository

#: 一列審核檢視：評論本身，加上房源名稱與送出者顯示名稱。
ReviewRow = tuple[Review, str | None, str | None]


class AdminReviewRepository(Repository):
    """跨會員的評論查詢與審核。**僅供 `require_admin` 的路由使用。**"""

    def _base_query(self) -> Select:
        author = aliased(Profile)
        return (
            select(Review, Room.name, author.display_name)
            .join(Room, Room.id == Review.room_id)
            .join(author, author.id == Review.user_id)
        )

    async def search(
        self,
        *,
        status: str | None = None,
        room_id: uuid.UUID | None = None,
    ) -> list[ReviewRow]:
        """依狀態與房源列出評論。

        排序為 `created_at` **由舊到新**——待審核清單是一個工作佇列，先送出的
        先處理。這與前台評論列表（由新到舊）方向相反，是刻意的：那裡是給讀者
        看最新評價，這裡是給人消化待辦。
        """
        stmt = self._base_query()
        if status is not None:
            stmt = stmt.where(Review.status == status)
        if room_id is not None:
            stmt = stmt.where(Review.room_id == room_id)

        result = await self.session.execute(stmt.order_by(Review.created_at.asc()))
        return [(review, room_name, user_name) for review, room_name, user_name in result.all()]

    async def get(self, review_id: uuid.UUID) -> ReviewRow | None:
        result = await self.session.execute(self._base_query().where(Review.id == review_id))
        row = result.first()
        if row is None:
            return None
        review, room_name, user_name = row
        return review, room_name, user_name

    async def set_status(self, review: Review, status: str, *, note: str | None) -> Review:
        """變更審核狀態。**不提交**——由呼叫端與稽核紀錄一併提交。"""
        review.status = status
        if note is not None:
            review.admin_note = note
        await self.session.flush()
        return review

    async def set_reply(self, review: Review, reply: str | None, *, admin_id: uuid.UUID) -> Review:
        """撰寫、修改或收回業者回覆（FR-103d）。

        `admin_reply_at` 由 `stamp_review_reply` trigger 蓋章，`admin_reply_by`
        則由這裡明確寫入——改寫後的 trigger 不再有 `auth.uid()` 可用，
        「誰回覆的」只有 FastAPI 知道（0001_initial.py 該段註解）。

        收回時把 `admin_reply_by` 一併清掉是**多餘但無害**的：trigger 在
        `admin_reply` 轉為 null 時也會清。兩邊都做是為了讓這個檔案單獨閱讀時
        語意完整，不必先去讀遷移才知道欄位會不會殘留。
        """
        review.admin_reply = reply
        review.admin_reply_by = admin_id if reply is not None else None
        await self.session.flush()
        return review

    async def delete(self, review: Review) -> None:
        """刪除已公開的評論（FR-103c）。

        刪除後 `rooms.average_rating` 由 trigger 重算，可能因此變回 null
        （該房源已無任何通過審核的評論）——那正是 FR-047 要的「尚無評分」。
        """
        await self.session.delete(review)
        await self.session.flush()


__all__ = ["AdminReviewRepository", "ReviewRow"]
