"""T095：退款分級金額（FR-041）。

級距：入住前 7 天以上全額、3–6 天 50%、1–2 天 20%、當日起 0%。

## 為什麼每一個邊界都要單獨列出來

級距的錯法幾乎都在邊界上，而且**每一種都不會拋錯**：把 7 寫成 `> 7`，
剛好提前七天取消的人少拿一半；把「當日」寫成 `< 0`，入住當天取消的人拿回
全額。兩者都只表現為金額不對，而金額不對要到有人抱怨或對帳時才會發現。

因此這裡把 0、1、2、3、6、7 六個邊界逐一釘死，而不是抽樣測三個「代表值」。

## 純函式

`refund_amount` 不碰資料庫也不看訂單狀態——它只回答「這個金額、這個距離，
該退多少」。可否申請退款是另一件事（`assert_refundable`），分開才能各自
測到位，也才不必為了測一個算式建一整組訂單。
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from sunny.errors import DomainError
from sunny.models.refund import (
    QUOTA_STATUSES,
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
)
from sunny.services import refunds

TOTAL = 10_000
TODAY = date(2026, 8, 4)


def _at(days_before: int) -> date:
    """入住日在 `days_before` 天之後。0 代表當天。"""
    return TODAY + timedelta(days=days_before)


# ---------------------------------------------------------------------------
# 六個邊界（FR-041）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("days_before", "expected", "tier"),
    [
        (30, 10_000, "遠早於七天：全額"),
        (8, 10_000, "八天：全額"),
        (7, 10_000, "⚠️ 七天整：仍是全額（「7 天以上」含 7）"),
        (6, 5_000, "⚠️ 六天：50% 的上界"),
        (4, 5_000, "五天內：50%"),
        (3, 5_000, "⚠️ 三天整：仍是 50%"),
        (2, 2_000, "⚠️ 兩天：20% 的上界"),
        (1, 2_000, "⚠️ 一天：20%"),
        (0, 0, "⚠️ 入住當日：0%"),
    ],
)
def test_refund_tiers_at_every_boundary(days_before: int, expected: int, tier: str) -> None:
    assert refunds.refund_amount(TOTAL, _at(days_before), today=TODAY) == expected, tier


def test_after_check_in_there_is_no_refund() -> None:
    """入住日已過。**MUST 是 0，MUST NOT 是負數。**

    負數會一路傳到 `refunds.amount`，而那個欄位有 `amount >= 0` 的 CHECK——
    使用者會收到一句與退款毫無關係的資料庫錯誤。
    """
    assert refunds.refund_amount(TOTAL, _at(-1), today=TODAY) == 0
    assert refunds.refund_amount(TOTAL, _at(-30), today=TODAY) == 0


# ---------------------------------------------------------------------------
# 整數（憲章原則 IV、FR-070）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("total", [1, 3, 7, 999, 3_333, 10_001])
@pytest.mark.parametrize("days_before", [0, 1, 3, 7])
def test_the_result_is_always_a_non_negative_int(total: int, days_before: int) -> None:
    """⚠️ **MUST 為整數新臺幣元。**

    50% 與 20% 會在奇數金額上產生小數。回傳 float 的話，`5000.5` 會一路寫進
    訂單，而畫面上顯示的是 `NT$ 5,000.5`——那不是一個可以匯款的金額。
    """
    amount = refunds.refund_amount(total, _at(days_before), today=TODAY)
    assert isinstance(amount, int), f"{amount!r} 不是 int"
    assert not isinstance(amount, bool), "bool 是 int 的子類，這裡不該出現"
    assert amount >= 0


def test_rounding_never_exceeds_the_stated_percentage() -> None:
    """有小數時**無條件捨去**。

    3333 的 50% 是 1666.5。取 1666 而非 1667——退款級距是對外承諾的上限，
    多退一元是拿別人的錢做人情；少一元則在誤差內且方向可解釋。
    這個選擇本身沒有對錯，但**MUST 選定一個並寫下來**，否則兩處各自四捨五入
    的實作會在對帳時差幾元，而沒有人查得出來源。
    """
    assert refunds.refund_amount(3_333, _at(4), today=TODAY) == 1_666
    assert refunds.refund_amount(3_333, _at(1), today=TODAY) == 666


def test_zero_total_stays_zero() -> None:
    assert refunds.refund_amount(0, _at(30), today=TODAY) == 0


# ---------------------------------------------------------------------------
# 可否申請退款是另一件事（FR-035）
# ---------------------------------------------------------------------------
def test_a_past_check_in_cannot_request_a_refund() -> None:
    """FR-035 限定「入住日尚未到來」。

    ⚠️ 這與「退款金額為 0」是**兩件不同的事**。入住當日的金額是 0，但那時
    仍在入住日當天——規則說的是「尚未到來」，而當天已經到來了。分不清楚的
    實作會讓人送出一筆必定為 0 的申請，然後等管理員審核一個沒有意義的請求。
    """
    with pytest.raises(DomainError) as exc:
        refunds.assert_refundable(status="confirmed", check_in=_at(0), today=TODAY)
    assert exc.value.status_code == 409
    assert exc.value.code == "REFUND_WINDOW_CLOSED"


def test_only_a_confirmed_order_can_request_a_refund() -> None:
    """FR-035：僅「已確認」可申請。

    每一種不可申請的狀態都要有自己的訊息——待付款的該去取消（不必審核，
    也不必等），待退款的該去看進度，已退款的則兩者皆非。合併成一句
    「此訂單無法申請退款」會讓人不知道下一步在哪裡。
    """
    for status in ("pending-payment", "refund-pending", "refunded", "cancelled", "completed"):
        with pytest.raises(DomainError) as exc:
            refunds.assert_refundable(status=status, check_in=_at(30), today=TODAY)
        assert exc.value.status_code == 409, status
        assert exc.value.detail, status


def test_a_pending_payment_order_is_told_to_cancel_instead() -> None:
    """待付款要說「請直接取消」——它不需要審核，也不會有任何金錢往返。"""
    with pytest.raises(DomainError) as exc:
        refunds.assert_refundable(status="pending-payment", check_in=_at(30), today=TODAY)
    assert "取消" in exc.value.detail, exc.value.detail


def test_an_order_already_under_review_says_so() -> None:
    with pytest.raises(DomainError) as exc:
        refunds.assert_refundable(status="refund-pending", check_in=_at(30), today=TODAY)
    assert "審核" in exc.value.detail, exc.value.detail


def test_a_confirmed_future_order_passes() -> None:
    refunds.assert_refundable(status="confirmed", check_in=_at(1), today=TODAY)


# ---------------------------------------------------------------------------
# SC-031 在 Python 這一側的表述
# ---------------------------------------------------------------------------
def test_rejected_is_not_a_quota_status() -> None:
    """⚠️ **被駁回的 MUST NOT 佔用額度。**

    `QUOTA_STATUSES` 是應用層計數時唯一該看的集合。這裡釘住它，因為把
    `rejected` 加進去不會讓任何測試變紅——只會讓被駁回 5 次的會員再也不能
    申請，而那要等到有人抱怨才會被發現（與 `test_refund_limit.py` 從資料庫端
    驗證的是同一條規則）。
    """
    assert STATUS_REJECTED not in QUOTA_STATUSES
    assert set(QUOTA_STATUSES) == {STATUS_PENDING, STATUS_APPROVED}
