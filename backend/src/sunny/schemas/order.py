"""訂單的 API 形狀。

⚠️ **`OrderCreateIn` 刻意沒有 `nights` 與 `totalAmount` 欄位。**

不是「收下來再驗證」，是根本不接收——夜數與金額**一律由後端依當下房價重算**
（FR-024、FR-032）。驗證邏輯本身可能寫錯，而一個不存在的欄位不會被偽造。
送出偽造值的請求會通過（那些鍵被忽略），但寫進資料庫的是後端算的數字。

⚠️ **同樣沒有任何真實支付欄位。** 卡號、有效期限、CVV、銀行帳號 MUST NOT 出現
在此（FR-028）——付款為模擬，後端不接收也不儲存這些資料。訂單資料表上根本
沒有對應的欄位，這是結構上的保證而非檢查。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import EmailStr, Field

from sunny.schemas.room import CamelModel


class OrderCreateIn(CamelModel):
    """建立訂單（FR-020–FR-032）。"""

    room_id: uuid.UUID
    #: `YYYY-MM-DD` 字串而非 `date`：pydantic 的 `date` 會接受 `2026-8-4` 這種
    #: 未補零的形式，而日期字串在本專案會被排序——`"2026-8-4"` 在字典序下大於
    #: `"2026-08-05"`。改由 `utils.dates.parse_calendar_date` 嚴格解析。
    check_in: str
    check_out: str
    guest_count: int = Field(ge=1)

    contact_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=50)
    email: EmailStr

    #: `LINE Pay` / `credit-card` / `bank-transfer`。**皆為模擬支付。**
    payment_method: str


class OrderOut(CamelModel):
    """訂單輸出。**欄位明列。**

    `expiresAt` 供前端顯示付款倒數（FR-102）。它是資料庫在建單當下求值並凍結
    的時間，參數日後變更 MUST NOT 使既有訂單的倒數改變（FR-101）。
    """

    id: uuid.UUID
    order_no: str
    room_id: uuid.UUID
    check_in: date
    check_out: date
    nights: int
    guest_count: int

    contact_name: str
    phone: str
    email: str

    payment_method: str
    #: 整數新臺幣元（FR-070）
    total_amount: int
    status: str

    expires_at: datetime
    #: `payment-timeout`（逾期自動取消）或 `member-cancelled`（會員主動取消）。
    #: 兩者都計入「未付款取消訂單數」，但 MUST 可區分（FR-035a）。
    cancel_reason: str | None
    created_at: datetime


__all__ = ["OrderCreateIn", "OrderOut"]
