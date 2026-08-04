"""退款的領域規則：分級金額與可否申請（FR-035、FR-036b、FR-041）。

## ⚠️ 這裡的檢查不是保證

上限 5 筆由資料庫的 `enforce_refund_limit()` trigger 強制，「同一訂單同時只有
一筆審核中」由部分唯一索引 `refunds_one_pending_per_order` 強制
（models/refund.py）。本模組**只負責訊息品質**——資料庫拒絕時給的是
`P0001` 與一句英文，那對使用者毫無意義（憲章原則 IV）。

因此這裡的函式不查資料庫、不做最終判定，只把使用者能理解的問題用他能理解的
話講清楚。真正擋下越權與超額的仍然是路由層的授權與資料庫的約束。

## 金額為什麼是 int

整數新臺幣元，**MUST NOT 用 float**（憲章原則 IV、FR-070）。50% 與 20% 會在
奇數金額上產生小數，而 `refunds.amount` 是 integer 欄位——float 會在寫入時
被靜默截斷，截斷的方向還取決於驅動版本。
"""

from __future__ import annotations

from datetime import date
from typing import Final

from sunny.errors import DomainError
from sunny.models.order import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_PENDING_PAYMENT,
    STATUS_REFUND_PENDING,
    STATUS_REFUNDED,
)
from sunny.utils import dates

#: 分級退款（FR-041）：`(距入住日至少幾天, 退款百分比)`，由寬到嚴。
#:
#: ⚠️ **邊界是「以上」**：剛好提前 7 天 → 全額，剛好 3 天 → 50%。
#: 寫成嚴格大於的話，卡在邊界那天取消的人會少拿一半，而他完全看不出原因。
_TIERS: Final[tuple[tuple[int, int], ...]] = (
    (7, 100),
    (3, 50),
    (1, 20),
)


def refund_amount(total_amount: int, check_in: date, *, today: date | None = None) -> int:
    """依距入住日的天數算出退款金額。**整數元。**

    7 天以上全額、3–6 天 50%、1–2 天 20%、當日起 0%（FR-041）。

    ⚠️ 有小數時**無條件捨去**。退款級距是對外承諾的比例上限，捨去保證實付
    金額不會超過該比例；四捨五入則可能多退一元。差額本身微不足道，但**選定
    一個並寫下來**才不會出現兩處各自取捨、對帳差幾元而查不出來源的情況。

    Args:
        total_amount: 訂單上凍結的總金額（FR-032）。
        check_in: 入住日。
        today: 判定基準日，預設為台北時區的今天。測試以此固定時間。
    """
    reference = today or dates.today()
    days_ahead = (check_in - reference).days

    for threshold, percent in _TIERS:
        if days_ahead >= threshold:
            # ⚠️ 先乘後除。先除會在整數運算下把比例吃掉：
            # `10000 * (50 // 100)` 是 0，而那是一筆「核准了卻退 0 元」的申請。
            return total_amount * percent // 100

    # 入住當日與之後：0%。**MUST NOT 回負數**——`refunds.amount` 上有
    # `amount >= 0` 的 CHECK，負數會變成一句與退款無關的資料庫錯誤。
    return 0


#: 每種不可申請的狀態各自的說法。
#:
#: ⚠️ **MUST NOT 合併成一句「此訂單無法申請退款」。** 待付款的該去取消
#: （不必審核也不必等），待退款的該去看進度，已退款與已取消的則兩者皆非。
#: 合併之後使用者知道不能做，但不知道該做什麼。
_STATUS_REASONS: Final[dict[str, tuple[str, str]]] = {
    STATUS_PENDING_PAYMENT: (
        "此訂單尚未付款，請直接取消即可，不需要申請退款。",
        "ORDER_NOT_PAID",
    ),
    STATUS_REFUND_PENDING: (
        "此訂單已有一筆退款申請正在審核中，請等待審核結果。",
        "REFUND_ALREADY_PENDING",
    ),
    STATUS_REFUNDED: ("此訂單已完成退款。", "ORDER_ALREADY_REFUNDED"),
    STATUS_CANCELLED: ("此訂單已取消，沒有可退款的款項。", "ORDER_CANCELLED"),
    STATUS_COMPLETED: ("此訂單的住宿已結束，無法申請退款。", "ORDER_COMPLETED"),
}


def assert_refundable(*, status: str, check_in: date, today: date | None = None) -> None:
    """訂單是否處於可提出退款申請的狀態（FR-035）。

    兩個條件：狀態為「已確認」，且**入住日尚未到來**。

    ⚠️ 「入住日尚未到來」與「退款金額為 0」是兩件事。入住當日的金額是 0，
    但那一天已經到來——規則說的是尚未到來。分不清楚的實作會讓人送出一筆
    必定為 0 的申請，然後等管理員審核一個沒有意義的請求。

    Raises:
        DomainError: 狀態不對，或入住日已到。
    """
    if status != STATUS_CONFIRMED:
        detail, code = _STATUS_REASONS.get(
            status, ("此訂單目前的狀態無法申請退款。", "ORDER_NOT_REFUNDABLE")
        )
        raise DomainError(detail, code=code, status_code=409)

    reference = today or dates.today()
    if check_in <= reference:
        raise DomainError(
            "入住日已到或已過，無法再申請退款。",
            code="REFUND_WINDOW_CLOSED",
            status_code=409,
        )


def validate_reason(reason: str) -> str:
    """退款原因 MUST 填寫（FR-035）。

    以 `strip()` 後判空，而不是只看長度：一串空白通過長度檢查卻對管理員毫無
    用處，而他要據此決定核准與否。回傳去除頭尾空白後的字串。
    """
    cleaned = reason.strip()
    if not cleaned:
        raise DomainError(
            "請填寫退款原因。",
            code="REFUND_REASON_REQUIRED",
            status_code=400,
            field="reason",
        )
    return cleaned


__all__ = ["assert_refundable", "refund_amount", "validate_reason"]
