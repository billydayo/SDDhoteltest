"""評論審核與退款審核的 API 形狀（FR-056、FR-057、FR-103b~d）。

與 `schemas/admin.py` 分開：那裡是「後台看資料」的形狀，這裡是「後台做判定」
的形狀。兩者的輸入模型差別很大——審核端點收的是決定與理由，不是資源欄位。

## 為什麼審核的輸入不叫 `status`

`ReviewDecisionIn` 用 `status`（它真的就是評論的狀態），`RefundDecisionIn`
卻用 `decision`。退款的核准同時改動 `refunds.status` **與** `orders.status`
兩張表——把輸入命名為 `status` 會讓人以為送什麼就寫什麼，而實際上核准會把
訂單推到 `refunded`。名字不同是為了讓這個落差在呼叫端就看得見。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field, field_validator

from sunny.models.review import REVIEW_STATUSES
from sunny.schemas.room import CamelModel

# ---------------------------------------------------------------------------
# 評論審核
# ---------------------------------------------------------------------------

#: 業者回覆的長度上限，與 `reviews_admin_reply_check` 一致。
REPLY_MAX_LENGTH = 1000


class ReviewOut(CamelModel):
    """後台的評論檢視（FR-056）。

    含 `autoVerdict` 與 `autoRules`：管理員要看得到自動審核**判了什麼、依據
    哪一條規則**，才可能覆寫它（FR-103b）。只給結論不給依據的話，覆寫就變成
    憑感覺推翻，那跟沒有初判是一樣的。

    ⚠️ 介面上 MUST 標示為「自動審核（規則式）」，**MUST NOT 描述為 AI**
    （FR-103a、憲章原則 VI）。
    """

    id: uuid.UUID
    order_id: uuid.UUID
    room_id: uuid.UUID
    room_name: str | None = None
    user_id: uuid.UUID
    #: 送出者的顯示名稱。後台需要它才能辨識是誰留的評論。
    user_name: str | None = None

    rating: int
    comment: str
    category: str
    status: str

    auto_verdict: str | None
    auto_rules: list[str]
    admin_note: str | None

    admin_reply: str | None
    admin_reply_at: datetime | None

    created_at: datetime


class ReviewDecisionIn(CamelModel):
    """通過／駁回／改回待審（FR-056、FR-103b）。

    接受 `pending` 是刻意的：管理員誤按之後要能退回待審，否則唯一的還原方式
    是刪掉那則評論——而刪除是不可逆的，還會動到房源平均評分。
    """

    status: str
    note: str | None = Field(default=None, max_length=500)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in REVIEW_STATUSES:
            raise ValueError(f"評論狀態僅接受 {REVIEW_STATUSES}")
        return value


class ReviewReplyIn(CamelModel):
    """業者公開回覆的撰寫、修改與收回（FR-103d）。

    ⚠️ **`reply` 為 null 或空白即為收回**，不另設 DELETE 端點。三種操作在
    資料上是同一件事（改寫 `admin_reply`），拆成兩個端點只會讓「收回」與
    「改成空字串」變成兩條路徑，而其中一條遲早會漏掉稽核紀錄。
    """

    reply: str | None = Field(default=None, max_length=REPLY_MAX_LENGTH)

    def normalized(self) -> str | None:
        """空白視同收回。

        使用者按下 Backspace 清空後送出，與按「收回」是同一個意圖；
        存進一個空字串會讓前台渲染出一塊沒有內容的業者回覆區塊。
        """
        if self.reply is None:
            return None
        cleaned = self.reply.strip()
        return cleaned or None


# ---------------------------------------------------------------------------
# 退款審核
# ---------------------------------------------------------------------------

DECISION_APPROVE = "approve"
DECISION_REJECT = "reject"
REFUND_DECISIONS = (DECISION_APPROVE, DECISION_REJECT)


class RefundOut(CamelModel):
    """待審核退款的檢視（FR-057）。

    金額為**分級後**的實付退款額，整數新臺幣元（FR-041）。申請當下即已算定
    並寫入，此處不重算——距入住日的天數會隨時間變動，重算會讓管理員看到的
    金額與申請人當初被告知的金額不同。
    """

    id: uuid.UUID
    order_id: uuid.UUID
    order_no: str | None = None
    user_id: uuid.UUID
    applicant_name: str | None = None

    reason: str
    #: 整數新臺幣元
    amount: int
    status: str
    admin_note: str | None

    #: 訂單的住宿區間，供管理員判斷
    check_in: date | None = None
    check_out: date | None = None

    created_at: datetime
    reviewed_at: datetime | None


class RefundDecisionIn(CamelModel):
    """核准或駁回（FR-038、FR-039、FR-057）。"""

    decision: str
    note: str | None = Field(default=None, max_length=500)

    @field_validator("decision")
    @classmethod
    def _known_decision(cls, value: str) -> str:
        if value not in REFUND_DECISIONS:
            raise ValueError(f"退款審核僅接受 {REFUND_DECISIONS}")
        return value


__all__ = [
    "DECISION_APPROVE",
    "DECISION_REJECT",
    "REFUND_DECISIONS",
    "REPLY_MAX_LENGTH",
    "RefundDecisionIn",
    "RefundOut",
    "ReviewDecisionIn",
    "ReviewOut",
    "ReviewReplyIn",
]
