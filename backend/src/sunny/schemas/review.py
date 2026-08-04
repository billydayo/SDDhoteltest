"""評論的會員端與前台形狀（FR-042 ~ FR-048）。

與 `schemas/moderation.py` 分開：那裡是**後台做判定**的形狀，帶著
`autoVerdict`、`autoRules`、`adminNote`。這裡的兩個輸出模型刻意都沒有那些欄位。

## ⚠️ 自動審核的結果 MUST NOT 回給評論作者

`MyReviewOut` 不含 `autoVerdict` 與 `autoRules`。告訴作者「你觸發了
banned-word」等於附上一份規避指南——換掉那個詞就能通過，而審核要擋的不是
用詞不巧的人。作者需要知道的只有一件事：這則評論還在審核中（FR-045）。

## 前台的評論不帶身分

`PublicReviewOut` 只帶 `authorName`（會員自選的顯示名稱），沒有 `userId`、
沒有 email。評論區塊不需要辨識是誰，而 id 一旦出現在公開回應裡就成了
串接其他端點的線索。

業者回覆亦然：帶 `adminReply` 與 `adminReplyAt`，**不帶回覆者姓名**——
回覆代表店家而非某位管理員個人（FR-103d）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Final

from pydantic import Field, field_validator

from sunny.schemas.room import CamelModel

#: 評論類型（FR-048）。
#:
#: ⚠️ **這是一個封閉的集合，不是自由文字。** FR-048 要求使用者能「依評論類型
#: 篩選」，而自由文字的篩選器等於沒有篩選器：一百則評論會長出九十種類型，
#: 每一種各一則。封閉集合讓頁籤數量可預期，也讓 `category` 的相等比對有意義。
#:
#: 「住宿體驗」列在第一個且 MUST 保留——`seed.py` 的既有評論用的是它，
#: 移除會讓種子資料在驗證時被判為非法類型。
REVIEW_CATEGORIES: Final[tuple[str, ...]] = (
    "住宿體驗",
    "清潔與衛生",
    "服務態度",
    "設施與設備",
    "地點與交通",
    "性價比",
)

#: 評分範圍（FR-044）。資料庫的 `reviews_rating_check` 是最後一道網。
RATING_MIN: Final = 1
RATING_MAX: Final = 5

#: 內文長度上限。**沒有下限**——「過短」由自動審核判為退件並交人複核
#: （`services/moderation.py`），而不是在這裡回 422。
#:
#: 兩者的差別對使用者很大：422 是「你不能送出」，退件是「送出了，待複核」。
#: 一則簡短但真實的評價不該連送都送不出去，那會讓人以為系統壞了。
COMMENT_MAX_LENGTH: Final = 2000


class ReviewCreateIn(CamelModel):
    """撰寫評論（FR-042 ~ FR-045）。

    ⚠️ **沒有 `roomId`，也沒有 `status`。**

    房源由 `orderId` 推導——讓用戶端指定房源等於允許「拿 A 房的訂單去評 B 房」，
    而那筆評論會計入 B 房的平均評分（FR-046），看起來完全正常。

    `status` 不存在於此模型：評論一律進待審核，MUST NOT 由送出者決定（FR-103）。
    """

    order_id: uuid.UUID
    rating: int = Field(ge=RATING_MIN, le=RATING_MAX)
    comment: str = Field(min_length=1, max_length=COMMENT_MAX_LENGTH)
    category: str

    @field_validator("comment")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        # `min_length=1` 擋不掉一串空白。存進去之後前台會渲染出一塊空的評論。
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("評論內容不可為空白")
        return cleaned

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str) -> str:
        if value not in REVIEW_CATEGORIES:
            raise ValueError(f"評論類型僅接受 {REVIEW_CATEGORIES}")
        return value


class MyReviewOut(CamelModel):
    """送出後回給作者的形狀。

    ⚠️ **不含 `autoVerdict` 與 `autoRules`**（見模組說明）。`status` 送出當下
    必為 `pending`——前端據此顯示「已送出，待審核後公開」（FR-045）。
    """

    id: uuid.UUID
    order_id: uuid.UUID
    room_id: uuid.UUID
    rating: int
    comment: str
    category: str
    #: 送出當下恆為 `pending`。**MUST NOT 因自動審核通過而直接是 `approved`。**
    status: str
    created_at: datetime


class PublicReviewOut(CamelModel):
    """房源詳情頁的一則評論（FR-046、FR-048、FR-103d）。

    ⚠️ 只有 `approved` 的評論會被組成這個形狀（`repositories/reviews.py`
    的 `list_public()`）。本模型**沒有 `status` 欄位**——前台不需要它，
    而留一個欄位在這裡會讓人以為這裡也可能出現待審核的評論。
    """

    id: uuid.UUID
    rating: int
    comment: str
    category: str
    #: 會員自選的顯示名稱。未設定時為 None，前端顯示「訪客」之類的預設稱謂。
    #:
    #: 預設值是必要的：它來自另一張表，`model_validate(review)` 取不到——
    #: 沒有預設會讓 `from_row()` 在填入之前就先驗證失敗。同 `ReviewOut.room_name`。
    author_name: str | None = None
    created_at: datetime

    #: 業者公開回覆。**MUST NOT 附回覆者姓名**——代表店家而非個人（FR-103d）。
    admin_reply: str | None
    admin_reply_at: datetime | None

    @classmethod
    def from_row(cls, review: object, author_name: str | None) -> PublicReviewOut:
        """由 `(Review, display_name)` 組成。

        `author_name` 來自另一張表，`model_validate(review)` 拿不到它。
        """
        return cls.model_validate(review).model_copy(update={"author_name": author_name})


__all__ = [
    "COMMENT_MAX_LENGTH",
    "RATING_MAX",
    "RATING_MIN",
    "REVIEW_CATEGORIES",
    "MyReviewOut",
    "PublicReviewOut",
    "ReviewCreateIn",
]
