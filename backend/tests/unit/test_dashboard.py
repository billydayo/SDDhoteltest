"""T117：儀表板與訂單統計的除零（US6 驗收情境 3）。

**系統中無任何訂單時，成交率與平均客單價 MUST 顯示為「—」而非 0 或除以零錯誤。**

後端的責任是回 `None`（JSON 的 `null`），由前端渲染成「—」。因此本檔驗的是
「未定義時是 None，不是 0，也不是字串」——把破折號放進 API 等於替前端決定
呈現方式，同一份資料在圖表上可能要畫成空白而不是破折號。

不需要資料庫：指標是純函式，除零是算術問題不是查詢問題。
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from sunny.services.stats import OrderStats, average_order_value, conversion_rate

# ---------------------------------------------------------------------------
# 除零：這是本檔存在的理由
# ---------------------------------------------------------------------------


def test_conversion_rate_is_none_when_there_are_no_orders() -> None:
    assert conversion_rate(paid_orders=0, total_orders=0) is None


def test_average_order_value_is_none_when_nothing_is_paid() -> None:
    assert average_order_value(revenue=0, paid_orders=0) is None


def test_none_is_not_zero() -> None:
    """`None` 與 `0` MUST 可區分。

    這條看起來多餘，但 `0 == False`、`None == False` 在鬆散比較下都成立；
    若哪天有人把回傳改成 `or 0`，上面兩個測試仍會過而這個會掛。
    """
    assert conversion_rate(paid_orders=0, total_orders=0) != 0
    assert average_order_value(revenue=0, paid_orders=0) != 0


def test_zero_paid_out_of_some_orders_is_a_real_zero_not_none() -> None:
    """有人下單但無人付款——成交率是**真的 0%**，不是未定義。

    分母存在時就有值。把這種情況也回成 None 會讓「沒生意」與「還沒開張」
    看起來一樣。
    """
    assert conversion_rate(paid_orders=0, total_orders=8) == Decimal("0.0")


def test_no_paid_orders_still_leaves_average_undefined() -> None:
    """相對地，平均客單價的分母是「已付款訂單數」，它是 0 就真的沒有平均。"""
    assert average_order_value(revenue=0, paid_orders=0) is None


# ---------------------------------------------------------------------------
# 一般計算
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("paid", "total", "expected"),
    [
        (1, 1, "100.0"),
        (1, 2, "50.0"),
        (1, 3, "33.3"),  # 33.333… → 四捨五入至小數第一位
        (2, 3, "66.7"),
        (7, 9, "77.8"),
    ],
)
def test_conversion_rate_rounds_to_one_decimal(paid: int, total: int, expected: str) -> None:
    assert conversion_rate(paid_orders=paid, total_orders=total) == Decimal(expected)


@pytest.mark.parametrize(
    ("revenue", "paid", "expected"),
    [
        (10_000, 1, 10_000),
        (10_000, 4, 2_500),
        (10_000, 3, 3_333),  # 3333.33… → 3333
        (10_001, 3, 3_334),  # 3333.67 → 3334，四捨五入而非無條件捨去
    ],
)
def test_average_order_value_is_a_rounded_integer(revenue: int, paid: int, expected: int) -> None:
    value = average_order_value(revenue=revenue, paid_orders=paid)
    assert value == expected
    assert isinstance(value, int)


def test_amounts_never_pass_through_float() -> None:
    """金額 MUST NOT 經過 float（憲章原則 IV）。

    以一個浮點會失準的數字驗證：0.1 + 0.2 在 float 下不等於 0.3，
    而累加型的金額誤差正是這樣來的。此處確認回傳型別是 int 而非 float——
    只要中途轉過 float，型別就會洩漏出來。
    """
    value = average_order_value(revenue=1, paid_orders=3)
    assert isinstance(value, int)
    assert not isinstance(value, float)


# ---------------------------------------------------------------------------
# 整組統計
# ---------------------------------------------------------------------------


def test_empty_system_yields_two_undefined_metrics_and_five_zeros() -> None:
    """全新系統：五個計數為 0，兩個比率為 None。"""
    stats = OrderStats.build(total_orders=0, paid_orders=0, unpaid_cancelled_orders=0, revenue=0)

    assert stats.total_orders == 0
    assert stats.placed_orders == 0
    assert stats.paid_orders == 0
    assert stats.unpaid_cancelled_orders == 0
    assert stats.revenue == 0

    assert stats.conversion_rate is None
    assert stats.average_order_value is None


def test_typical_system() -> None:
    stats = OrderStats.build(
        total_orders=10, paid_orders=6, unpaid_cancelled_orders=3, revenue=54_000
    )

    assert stats.conversion_rate == Decimal("60.0")
    assert stats.average_order_value == 9_000
