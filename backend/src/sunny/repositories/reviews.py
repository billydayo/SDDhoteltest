"""評論的資料存取——**會員端與前台**（FR-042 ~ FR-048、FR-103）。

與 `repositories/admin_reviews.py` 分開。那裡的每一個方法都是跨會員的、只由
`require_admin` 的路由呼叫；這裡的每一個方法要嘛收斂在單一會員身上，要嘛
**只看得到 `approved` 的評論**。

分開的實際收益是這個檔案可以有一條貫穿全檔的規則：

⚠️ **本檔的公開查詢 MUST 只回傳 `status == 'approved'` 的評論**（FR-045、
SC-007）。若哪天有人為了做「我的評論」而在 `list_public()` 上加一個
`status` 參數，未通過審核的評論就會出現在房源詳情頁——而那不會有任何錯誤，
只會多出幾則本來不該被看見的評價。

## 平均評分不在這裡算

`rooms.average_rating` 由資料庫的 `reviews_refresh_rating` trigger 在
insert／update／delete 之後重算（0001_initial.py）。此處 MUST NOT 另外算一次
再寫回去——兩份算法遲早會分歧，而分歧的徵狀是「新評論通過後平均沒變」，
沒有任何錯誤訊息（憲章原則 IV）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from sunny.models.profile import Profile
from sunny.models.review import STATUS_APPROVED, STATUS_PENDING, Review
from sunny.repositories.base import Repository

#: 前台的一列：評論本身，加上作者的顯示名稱。
#:
#: ⚠️ 只帶 `display_name`，**不帶 email 或 id**。前台的評論區塊不需要辨識
#: 是誰，而 email 一旦進了公開回應就等於把會員名單開放給爬蟲。
PublicReviewRow = tuple[Review, str | None]


class ReviewRepository(Repository):
    """會員撰寫與前台閱讀。**跨會員的後台查詢請用 `AdminReviewRepository`。**"""

    async def create(
        self,
        *,
        order_id: uuid.UUID,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        rating: int,
        comment: str,
        category: str,
        auto_verdict: str,
        auto_rules: list[str],
    ) -> Review:
        """新增一則評論。**不提交**——由路由與其錯誤處理一併決定。

        ⚠️ **`status` 一律為 `pending`，且不接受參數。**

        自動審核只產出 `auto_verdict` 初判，公開與否由人決定（FR-045、FR-103）。
        開一個 `status` 參數出來，遲早會有人為了「自動通過的就直接放行」而傳
        `approved` 進來——那正是 FR-103 明文禁止的那一件事，而且做出來之後
        前台會多出一批沒有人看過的評論，沒有任何錯誤訊息。

        重複評論（`reviews_order_id_key`）在此處**不預先檢查**：查了再寫仍有
        競態，真正的保證是資料庫的 UNIQUE 約束（憲章原則 IV）。`IntegrityError`
        由 `errors.translate_integrity_error` 轉為 409 REVIEW_EXISTS。
        """
        review = Review(
            order_id=order_id,
            room_id=room_id,
            user_id=user_id,
            rating=rating,
            comment=comment,
            category=category,
            status=STATUS_PENDING,
            auto_verdict=auto_verdict,
            auto_rules=auto_rules,
        )
        self.session.add(review)
        await self.session.flush()
        return review

    async def comments_by(self, user_id: uuid.UUID) -> list[str]:
        """該會員先前所有評論的內文，供重複送件的規則比對（`services/moderation.py`）。

        ⚠️ **只取本人的。** 拿全站的評論來比，兩個人碰巧寫了同一句「房間乾淨、
        交通方便」就會被判成重複送件——那不是重複，只是短句撞在一起。

        含各種狀態（待審、已通過、已駁回）是刻意的：把同一段話再送一次，
        不會因為上一則被駁回就變成新的內容。
        """
        result = await self.session.scalars(select(Review.comment).where(Review.user_id == user_id))
        return list(result.all())

    async def list_for_user(self, user_id: uuid.UUID) -> list[Review]:
        """本人寫過的全部評論，含尚未通過審核的（FR-043、FR-045）。

        ⚠️ **含 `pending` 與 `rejected` 是刻意的，與 `list_public()` 相反。**
        作者要看得到自己送出的那一則還在審核中——只回 `approved` 的話，他會
        以為評論送丟了而再寫一次，然後撞上 409。

        依 `created_at` 由新到舊：最近寫的那一則是他最可能要找的。
        """
        result = await self.session.scalars(
            select(Review).where(Review.user_id == user_id).order_by(Review.created_at.desc())
        )
        return list(result.all())

    async def list_public(
        self,
        room_id: uuid.UUID,
        *,
        category: str | None = None,
    ) -> list[PublicReviewRow]:
        """房源詳情頁的評論（FR-046、FR-048）。

        ⚠️ **只回 `approved`，且這個條件沒有開關**（FR-045、SC-007）。

        排序為 `created_at` **由新到舊**——讀者要先看到最近的住宿體驗。
        這與後台的待審清單（由舊到新，那是一個工作佇列）方向相反，是刻意的。

        `category` 為 None 時回全部類型，對應前端「全部」那個頁籤（FR-048）。
        """
        stmt = (
            select(Review, Profile.display_name)
            .join(Profile, Profile.id == Review.user_id)
            .where(Review.room_id == room_id, Review.status == STATUS_APPROVED)
        )
        if category is not None:
            stmt = stmt.where(Review.category == category)

        result = await self.session.execute(stmt.order_by(Review.created_at.desc()))
        return [(review, display_name) for review, display_name in result.all()]


__all__ = ["PublicReviewRow", "ReviewRepository"]
