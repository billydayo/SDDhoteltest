"""退款申請的 API 形狀（FR-035 ~ FR-041）。

⚠️ **`RefundCreateIn` 刻意沒有 `amount` 欄位。**

退款金額由 `services/refunds.refund_amount()` 依距入住日的天數算出（FR-041）。
不是「收下來再驗證」，是根本不接收——一個不存在的欄位不會被偽造。收下前端
送來的值等於讓人自訂要退多少錢，而那筆錢會由管理員按下「核准」時放行。

⚠️ **也沒有 `status`。** 新申請一律是 `pending`；讓用戶端指定狀態，等於開了
一條「自己核准自己」的路。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field

from sunny.schemas.room import CamelModel


class RefundCreateIn(CamelModel):
    """提出退款申請（FR-035）。"""

    order_id: uuid.UUID
    #: 原因 MUST 填寫（FR-035）。
    #:
    #: ⚠️ **刻意沒有 `min_length`。** 空字串與全空白都要被拒，但兩者若分由
    #: pydantic 與領域層各擋一半，回應就會不一致：pydantic 給的是 422
    #: `VALIDATION_ERROR` 且**沒有 `field`**，前端的焦點因此不會移到原因欄位
    #: （FR-010）；而 `"   "` 走到 `validate_reason()` 得到的是帶 `field` 的 400。
    #: 同一件事在使用者眼中有兩種行為，取決於他是完全沒填還是打了空白。
    #:
    #: 因此這裡只擋過長，判空一律交給 `services/refunds.validate_reason()`。
    reason: str = Field(max_length=1000)


class RefundOut(CamelModel):
    """退款申請輸出。**欄位明列。**

    帶上訂單編號與住宿日期：只有 `orderId` 這個 uuid 的話，會員在畫面上認不出
    那是哪一趟行程，而他可能同時有好幾筆申請在審核中。
    """

    id: uuid.UUID
    order_id: uuid.UUID
    #: 對使用者可見的訂單編號（FR-030）
    order_no: str
    check_in: date
    check_out: date

    reason: str
    #: 整數新臺幣元。依級距於申請當下算出並凍結（FR-041）。
    amount: int
    #: `pending` / `approved` / `rejected`
    status: str

    #: 管理員的審核備註。⚠️ 尚未審核時為 `null`，MUST NOT 給空字串——
    #: 前端要靠它分辨「還沒審」與「審過但沒留言」。
    admin_note: str | None
    created_at: datetime
    #: 審核時間。尚未審核時為 `null`。
    reviewed_at: datetime | None


__all__ = ["RefundCreateIn", "RefundOut"]
