"""管理員變更訂單狀態的允許矩陣（FR-054）。

## 為什麼需要這一層

原 `guard_order_transition()` trigger 有一個「管理員可自由變更狀態」的分支，
依賴 `is_admin()` → `auth.uid()`，隨 Supabase Auth 一併移除。資料庫因此**再也
無從分辨誰是管理員**，那個分支只能刪掉（data-model.md、research R2）。

留在資料庫的是兩條與身分無關的禁令：

1. 只有 `pending-payment` 且未逾期的訂單能轉為 `confirmed`
2. 金額、入住／退房日與保留期限一律不可變更

它們**擋得住管理員**——這是刻意的。但被擋下時 PostgreSQL 拋的是 `42501`，
不處理就會變成一個 500，畫面上只有「系統發生內部錯誤」。

本模組在送出 UPDATE 之前先判定，讓被拒絕的轉換得到可理解的說明。
**這不是把保證搬回應用層**：資料庫的禁令仍然存在且仍是最後一道網
（憲章原則 IV），此處只負責訊息品質。

## 純函式

不碰 session，因此「哪些轉換合法」可以單獨測試，不需要建一整組訂單。
"""

from __future__ import annotations

from typing import Final

from sunny.errors import DomainError
from sunny.models.order import (
    ORDER_STATUSES,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_PENDING_PAYMENT,
    STATUS_REFUND_PENDING,
    STATUS_REFUNDED,
)

#: 管理員可執行的狀態轉換。
#:
#: 「取消」自任何狀態皆可達——業者總得有辦法把一筆錯誤的訂單收掉，
#: 而取消會釋出該區間，不會造成超賣。
_ALLOWED: Final[dict[str, frozenset[str]]] = {
    STATUS_PENDING_PAYMENT: frozenset({STATUS_CONFIRMED, STATUS_CANCELLED}),
    STATUS_CONFIRMED: frozenset(
        {STATUS_COMPLETED, STATUS_REFUND_PENDING, STATUS_REFUNDED, STATUS_CANCELLED}
    ),
    STATUS_REFUND_PENDING: frozenset({STATUS_CONFIRMED, STATUS_REFUNDED, STATUS_CANCELLED}),
    STATUS_REFUNDED: frozenset({STATUS_CANCELLED}),
    STATUS_CANCELLED: frozenset(),
    STATUS_COMPLETED: frozenset({STATUS_CANCELLED}),
}

#: 為什麼某些目標到不了。訊息要能讓人知道**下一步該做什麼**，
#: 而不只是「不允許」。
_REASONS: Final[dict[tuple[str, str], str]] = {
    (STATUS_CANCELLED, STATUS_CONFIRMED): (
        "已取消的訂單無法直接改為已確認——該日期區間可能已被其他人訂走。請改為建立一筆新訂單。"
    ),
    (STATUS_REFUNDED, STATUS_CONFIRMED): ("已退款的訂單無法改回已確認。請改為建立一筆新訂單。"),
    (STATUS_COMPLETED, STATUS_CONFIRMED): "已完成的訂單無法改回已確認。",
}


def assert_admin_transition(current: str, target: str) -> None:
    """檢查管理員是否可將訂單自 `current` 改為 `target`。

    Raises:
        DomainError: 目標狀態不存在，或該轉換不被允許。
    """
    if target not in ORDER_STATUSES:
        raise DomainError(
            f"訂單狀態僅接受 {ORDER_STATUSES}。",
            code="INVALID_ORDER_STATUS",
            status_code=400,
            field="status",
        )

    if current == target:
        raise DomainError(
            "訂單已是該狀態，未做任何變更。",
            code="ORDER_STATUS_UNCHANGED",
            status_code=400,
            field="status",
        )

    if target in _ALLOWED.get(current, frozenset()):
        return

    detail = _REASONS.get(
        (current, target),
        f"訂單無法自「{current}」變更為「{target}」。",
    )
    raise DomainError(detail, code="INVALID_STATUS_TRANSITION", status_code=409, field="status")


def allowed_targets(current: str) -> list[str]:
    """`current` 可以轉往哪些狀態。供前端只顯示做得到的選項。"""
    return sorted(_ALLOWED.get(current, frozenset()))


__all__ = ["allowed_targets", "assert_admin_transition"]
