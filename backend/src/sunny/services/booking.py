"""訂房的領域規則：日期、人數、金額與訂單編號。

⚠️ **本模組的檢查不是房況保證。** 房況保證由 `orders_no_overlap` 排除約束承擔
（憲章原則 IV：「後端的檢查是授權與訊息品質，資料庫的約束才是保證。」）。
這裡做的是「在送進資料庫之前，把使用者能理解的問題用他能理解的話講清楚」——
資料庫拒絕時只會給一個約束名稱，那對使用者毫無意義。

## 為什麼金額在後端重算而不採信前端送來的值

前端顯示的金額只是預覽。**送進來的 `nights` 與 `totalAmount` 一律忽略**——
不是驗證後採用，是根本不接收（`OrderCreateIn` 沒有這兩個欄位）。這比「收下來
再比對」可靠：比對邏輯本身可能寫錯，而不存在的欄位不會被偽造（FR-024）。

## 金額為什麼是 int

整數新臺幣元，**MUST NOT 用 float**（憲章原則 IV、FR-070）。房價 × 夜數在
浮點數下會出現 `2999.9999999999995` 這種值，四捨五入後多數時候剛好對，
偶爾差一元——而那一元會出現在使用者的帳單上。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sunny.errors import DomainError
from sunny.models.order import PAYMENT_METHODS
from sunny.models.room import ROOM_MAINTENANCE, Room
from sunny.utils import dates

#: 訂單編號前綴。對使用者可見（FR-030）。
ORDER_NO_PREFIX = "SN"

#: 序號來源。**取號 MUST 由資料庫序列負責**——序列是非交易性的，兩個並行的
#: 交易不會拿到同一個號碼。在 Python 端用「查最大值 +1」會在並行下碰撞，
#: 而碰撞的表現是 `orders_order_no_key` 違反，對使用者是一句莫名的 500。
_ORDER_NO_SEQUENCE = "public.order_no_seq"

#: 序號補零位數。超過 9999 號時自然變成五位，仍然唯一。
_ORDER_NO_SEQ_WIDTH = 4


@dataclass(frozen=True)
class BookingDraft:
    """通過全部規則檢查後、尚未寫入的訂房內容。

    `total_amount` 於此時定案並隨訂單凍結——房源價格日後變動 MUST NOT 改變
    既有訂單的金額（FR-032）。
    """

    check_in: date
    check_out: date
    nights: int
    guest_count: int
    total_amount: int
    payment_method: str


# ---------------------------------------------------------------------------
# 個別規則
# ---------------------------------------------------------------------------
def validate_payment_method(method: str) -> str:
    """付款方式 MUST 為三種模擬方式之一（FR-027）。

    ⚠️ 三者皆為**虛擬支付**，不涉及任何真實金流。後端 MUST NOT 接收、MUST NOT
    儲存卡號、有效期限、CVV 或銀行帳號——訂單上根本沒有這些欄位（FR-028）。
    """
    if method not in PAYMENT_METHODS:
        raise DomainError(
            "請選擇有效的付款方式。",
            code="INVALID_PAYMENT_METHOD",
            field="paymentMethod",
        )
    return method


def validate_guest_count(guest_count: int, room: Room) -> int:
    """人數 MUST 為正整數且不超過該房源的上限（FR-024）。"""
    if guest_count < 1:
        raise DomainError("入住人數至少為 1 人。", code="INVALID_GUEST_COUNT", field="guestCount")
    if guest_count > room.max_guests:
        raise DomainError(
            f"此房源最多可入住 {room.max_guests} 人。",
            code="GUEST_COUNT_EXCEEDED",
            field="guestCount",
        )
    return guest_count


def ensure_room_is_bookable(room: Room) -> None:
    """整理中的房源不可預訂（FR-016）。

    這與「已被預訂」是不同的原因，訊息也 MUST 不同——使用者換個日期就能訂到
    已被預訂的房，但整理中的房換日期也沒用。
    """
    if room.status == ROOM_MAINTENANCE:
        raise DomainError(
            "此房源整理中，暫時無法預訂。",
            code="ROOM_UNDER_MAINTENANCE",
            status_code=409,
        )


def total_amount_for(room: Room, nights: int) -> int:
    """總金額 = 當下房價 × 夜數。**整數元。**

    以 `int()` 明確收斂：`nightly_price` 在模型上是 `int`，但這個函式是金額的
    唯一產生點，在此擋住 float 比在下游各處檢查便宜。
    """
    price = int(room.nightly_price)
    return price * int(nights)


def format_order_no(day: date, seq: int) -> str:
    """`SN` + 台北日期 + 序號（FR-030）。

    日期取**台北時區**的日曆日，MUST NOT 用伺服器本機時區——部署到 UTC 主機時，
    台北時間晚上八點之後建立的訂單會標成前一天。
    """
    return (
        f"{ORDER_NO_PREFIX}{dates.format_calendar_date(day).replace('-', '')}"
        f"{seq:0{_ORDER_NO_SEQ_WIDTH}d}"
    )


async def next_order_no(session: AsyncSession) -> str:
    """自資料庫序列取號並組成訂單編號。

    序列是非交易性的：交易回滾時號碼不會退回，因此編號可能有跳號。**這是刻意
    接受的**——唯一性才是需求（FR-030），連續性不是。想要連續就得序列化建單，
    那會讓並行訂房互相等待。
    """
    seq = await session.scalar(text(f"select nextval('{_ORDER_NO_SEQUENCE}')"))
    return format_order_no(dates.today(), int(seq or 0))


# ---------------------------------------------------------------------------
# 組合
# ---------------------------------------------------------------------------
def prepare_booking(
    *,
    room: Room,
    check_in: str,
    check_out: str,
    guest_count: int,
    payment_method: str,
) -> BookingDraft:
    """把使用者送來的原始輸入化為一筆可寫入的訂房內容。

    **檢查順序有意義。** 先房源狀態、再日期、再人數、最後付款方式——依「使用者
    改得動的成本」由高到低排。房源整理中就換房，日期不對就改日期；先報付款
    方式錯誤會讓他改完才發現房根本訂不了（FR-010 的逐欄提示精神）。
    """
    ensure_room_is_bookable(room)

    # `field` 是訊息裡的中文標籤，`field_name` 是前端拿來找輸入框的欄位名。
    # 兩者都要給——只給前者的話，畫面會顯示訊息但游標不動（FR-010）。
    parsed_in = dates.parse_calendar_date(check_in, field="入住日", field_name="check_in")
    parsed_out = dates.parse_calendar_date(check_out, field="退房日", field_name="check_out")
    nights = dates.validate_stay_dates(parsed_in, parsed_out)

    guests = validate_guest_count(guest_count, room)
    method = validate_payment_method(payment_method)

    return BookingDraft(
        check_in=parsed_in,
        check_out=parsed_out,
        nights=nights,
        guest_count=guests,
        total_amount=total_amount_for(room, nights),
        payment_method=method,
    )


__all__ = [
    "ORDER_NO_PREFIX",
    "BookingDraft",
    "ensure_room_is_bookable",
    "format_order_no",
    "next_order_no",
    "prepare_booking",
    "total_amount_for",
    "validate_guest_count",
    "validate_payment_method",
]
