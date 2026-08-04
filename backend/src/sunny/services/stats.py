"""營運指標的計算（FR-049、US6 驗收情境 2 與 3）。

## 為什麼是純函式

指標本身沒有 I/O——它們只是幾個計數之間的除法。抽出來的好處是除零這件事
能以單元測試涵蓋，不需要一個裝著零筆訂單的資料庫（T117）。

## 未定義時回 `None`，不是 0，也不是「—」

系統中尚無任何訂單時，成交率與平均客單價**沒有值**，這與「值為 0」是兩件事：

- 回 `0` 會被讀成「一筆都沒成交」，但實際上是還沒有人下單過。
  US6 的驗收情境 3 明文要求此時顯示「—」而非 0 或除以零的錯誤。
- 回字串 `"—"` 則是把呈現決定塞進 API。那是前端的事——同一份資料在圖表上
  可能要畫成空白而不是破折號，後端不該替它決定。

因此後端回 `null`，由前端渲染為「—」。這條界線在 `rooms.average_rating`
（FR-047「尚無評分」）已經走過一次，此處保持一致。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


def conversion_rate(*, paid_orders: int, total_orders: int) -> Decimal | None:
    """成交率 = 已付款訂單數 ÷ 總下單數。

    回傳 0–100 的百分比，四捨五入至小數第一位。
    **總下單數為 0 時回 `None`**——沒有分母，不是分子為 0。
    """
    if total_orders <= 0:
        return None
    rate = Decimal(paid_orders) * 100 / Decimal(total_orders)
    return rate.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def average_order_value(*, revenue: int, paid_orders: int) -> int | None:
    """平均客單價 = 總營業額 ÷ 已付款訂單數。

    **整數新臺幣元**（FR-070：金額 MUST NOT 出現小數）。
    已付款訂單數為 0 時回 `None`。

    ⚠️ 以 `Decimal` 相除後再四捨五入，不用 `revenue / paid_orders`——
    後者是浮點除法，而金額 MUST NOT 經過 float（憲章原則 IV）。
    """
    if paid_orders <= 0:
        return None
    avg = Decimal(revenue) / Decimal(paid_orders)
    return int(avg.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass(frozen=True, slots=True)
class OrderStats:
    """訂單管理的統計區塊（US6 驗收情境 2）。

    七個數字：訂單總數、總下單數、已付款訂單數、未付款取消訂單數、
    成交率、總營業額、平均客單價。

    「訂單總數」與「總下單數」在本系統中相同——每一筆訂單都是一次下單。
    兩者皆列出是因為企劃書分開列，且日後若加入草稿或詢價，兩者就會分岔。
    """

    total_orders: int
    placed_orders: int
    paid_orders: int
    unpaid_cancelled_orders: int
    revenue: int
    conversion_rate: Decimal | None
    average_order_value: int | None

    @classmethod
    def build(
        cls,
        *,
        total_orders: int,
        paid_orders: int,
        unpaid_cancelled_orders: int,
        revenue: int,
    ) -> OrderStats:
        return cls(
            total_orders=total_orders,
            placed_orders=total_orders,
            paid_orders=paid_orders,
            unpaid_cancelled_orders=unpaid_cancelled_orders,
            revenue=revenue,
            conversion_rate=conversion_rate(paid_orders=paid_orders, total_orders=total_orders),
            average_order_value=average_order_value(revenue=revenue, paid_orders=paid_orders),
        )


__all__ = ["OrderStats", "average_order_value", "conversion_rate"]
