"""後台訂單管理（FR-053、FR-054）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上（見 admin_rooms.py
的同一段說明）。

⚠️ 狀態變更 MUST 與其稽核紀錄在**同一個交易內**提交（FR-114）。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.order import CANCEL_MEMBER, STATUS_CANCELLED
from sunny.repositories.admin_orders import AdminOrderRepository
from sunny.schemas.admin import AdminOrderOut, OrderStatusIn
from sunny.services import audit
from sunny.services.order_transitions import assert_admin_transition
from sunny.utils import dates

router = APIRouter(
    prefix="/admin/orders",
    tags=["admin:orders"],
    dependencies=[Depends(require_admin)],
)

#: 管理員在後台按下取消時的原因標記。
#:
#: 與逾期的 `payment-timeout` 區分（FR-035a）。刻意沿用會員主動取消的
#: `member-cancelled`：兩者都是「有人決定不要這筆訂單」，而非系統逾期回收，
#: 在「未付款取消訂單數」的統計上口徑一致。
_ADMIN_CANCEL_REASON = CANCEL_MEMBER


def _parse_range(start: str | None, end: str | None) -> tuple[date | None, date | None]:
    parsed_start = dates.parse_calendar_date(start, field="起始日期") if start else None
    parsed_end = dates.parse_calendar_date(end, field="結束日期") if end else None

    if parsed_start and parsed_end and parsed_start > parsed_end:
        # 回空清單會被讀成「這段期間沒有訂單」，然後開始找不存在的問題。
        # 日期填反是輸入錯誤，要說出來（同 admin_rooms 的處理）。
        raise DomainError(
            "起始日期不可晚於結束日期。",
            code="INVALID_DATE_RANGE",
            status_code=400,
            field="startDate",
        )
    return parsed_start, parsed_end


@router.get("", response_model=list[AdminOrderOut], summary="搜尋訂單（需管理員）")
async def search_orders(
    session: SessionDep,
    order_no: Annotated[str | None, Query(alias="orderNo")] = None,
    status: Annotated[str | None, Query()] = None,
    room_id: Annotated[uuid.UUID | None, Query(alias="roomId")] = None,
    start_date: Annotated[str | None, Query(alias="startDate", description="YYYY-MM-DD")] = None,
    end_date: Annotated[str | None, Query(alias="endDate", description="YYYY-MM-DD")] = None,
) -> list[AdminOrderOut]:
    """需管理員。日期區間比對**入住日**，含頭含尾（FR-053）。"""
    start, end = _parse_range(start_date, end_date)

    rows = await AdminOrderRepository(session).search(
        order_no=order_no, status=status, room_id=room_id, start=start, end=end
    )
    return [
        AdminOrderOut.model_validate(order).model_copy(update={"room_name": room_name})
        for order, room_name in rows
    ]


@router.patch(
    "/{order_id}/status",
    response_model=AdminOrderOut,
    summary="變更訂單狀態（需管理員）",
)
async def set_order_status(
    order_id: uuid.UUID, payload: OrderStatusIn, session: SessionDep, admin: AdminUser
) -> AdminOrderOut:
    """需管理員（FR-054）。

    轉換的合法性先在 `order_transitions` 判定，**再**送出 UPDATE。
    資料庫的 trigger 仍然存在且仍是最後一道網（憲章原則 IV）——先判定只是
    為了讓被拒絕的轉換得到可理解的說明，而不是一個 500。

    變更後該會員於「我的訂單」即可看到新狀態（FR-054；spec 對「即時反映」的
    定義為下一次載入該畫面時可見）。
    """
    repo = AdminOrderRepository(session)
    order = await repo.get(order_id)
    if order is None:
        raise DomainError("查無此訂單。", code="ORDER_NOT_FOUND", status_code=404)

    previous = order.status
    assert_admin_transition(previous, payload.status)

    cancel_reason = _ADMIN_CANCEL_REASON if payload.status == STATUS_CANCELLED else None
    await repo.set_status(order, payload.status, cancel_reason=cancel_reason)

    await audit.record(
        session,
        actor_id=admin.id,
        action="order.status",
        target_table="orders",
        target_id=order.id,
        # ⚠️ 摘要刻意只記訂單編號與狀態轉換。
        # 訂單上的聯絡姓名、電話與信箱是真實個資，MUST NOT 進入所有管理員都
        # 讀得到的稽核日誌（FR-118）。
        summary={
            "orderNo": order.order_no,
            "from": previous,
            "to": payload.status,
            **({"note": payload.note} if payload.note else {}),
        },
    )
    await session.commit()
    return AdminOrderOut.model_validate(order)
