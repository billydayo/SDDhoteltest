"""會員的退款申請端點（FR-035 ~ FR-037、FR-040、FR-041、FR-081）。**全部需登入。**

## ⚠️ FR-040：不產生任何實際金錢移轉

這裡沒有任何金流串接，也不會有。`amount` 只是一個記錄下來的數字，核准之後
由業者在系統外處理。這一點在畫面上 MUST 說清楚（FR-029 的同一個理由）。

## 兩道資料庫保證，兩種必須接住的例外

| 保證 | 由誰擋 | 例外形態 |
|---|---|---|
| 同一訂單同時只有一筆審核中（FR-036） | 部分唯一索引 | `IntegrityError` |
| 每位會員上限 5 筆（FR-036b、FR-036d） | `enforce_refund_limit()` trigger | `P0001` |

⚠️ **兩者都是正常結果，不是程式錯誤。** 應用層事先查過一次擋不住並行送出的
第二筆——那正是把保證放在資料庫的理由（憲章原則 IV）。事先查的那一次只為了
給出可理解的訊息：資料庫拒絕時給的是一句英文與一個 SQLSTATE。

## 為什麼上限的訊息不能提早顯示筆數

FR-036c：**未達上限時 MUST NOT 顯示已使用或剩餘的申請次數。** 把「你還剩
2 次」放到畫面上，會讓正常使用的人開始節省——而退款申請本來就該按需提出。
只有真的達到上限時才說，且那時 MUST 明確告知不可再申請。
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy.exc import DBAPIError, IntegrityError

from sunny.deps import CurrentUser, SessionDep
from sunny.errors import DomainError, InternalError
from sunny.models.order import Order
from sunny.models.refund import MAX_REFUNDS_PER_USER, Refund
from sunny.repositories.orders import OrderRepository
from sunny.repositories.refunds import RefundRepository
from sunny.schemas.refund import RefundCreateIn, RefundOut
from sunny.services import refunds as refund_rules

router = APIRouter(prefix="/refunds", tags=["refunds"])

#: 部分唯一索引的名稱（0001_initial.py）。
_ONE_PENDING_INDEX = "refunds_one_pending_per_order"

#: `enforce_refund_limit()` 以 `raise exception ... using errcode = 'P0001'`
#: 拒絕。P0001 是 PL/pgSQL 的 `raise_exception`，**不是** IntegrityError——
#: 只接 `IntegrityError` 的話這條路徑會變成一個 500。
_RAISE_EXCEPTION = "P0001"


def _row(refund: Refund, order: Order) -> RefundOut:
    """組出輸出。訂單編號與日期一起帶，會員才認得出是哪一趟行程。"""
    return RefundOut(
        id=refund.id,
        order_id=refund.order_id,
        order_no=order.order_no,
        check_in=order.check_in,
        check_out=order.check_out,
        reason=refund.reason,
        amount=refund.amount,
        status=refund.status,
        admin_note=refund.admin_note,
        created_at=refund.created_at,
        reviewed_at=refund.reviewed_at,
    )


@router.post("", response_model=RefundOut, status_code=201, summary="提出退款申請（需登入）")
async def request_refund(
    payload: RefundCreateIn,
    user: CurrentUser,
    session: SessionDep,
) -> RefundOut:
    """對一筆已確認且尚未入住的訂單提出退款申請（FR-035）。

    ⚠️ **金額由後端依級距算出。** `RefundCreateIn` 沒有 `amount` 欄位，
    送出偽造值不會被採信（FR-041）。
    """
    orders = OrderRepository(session)
    # 先清理逾期訂單：一筆早已逾期的待付款訂單不該收到「請直接取消」的指引，
    # 它已經被取消了，訊息要說得出這一點。
    order = await orders.get_fresh(payload.order_id)

    if order is None:
        raise DomainError(
            "查無此訂單。", code="ORDER_NOT_FOUND", status_code=404, field="orderId"
        )
    # ⚠️ 越權申請比越權讀取更嚴重：核准之後那個人的住宿就沒了，
    # 而他從頭到尾不會知道發生什麼事。
    if order.user_id != user.id:
        raise DomainError("無權對此訂單申請退款。", code="FORBIDDEN", status_code=403)

    reason = refund_rules.validate_reason(payload.reason)
    refund_rules.assert_refundable(status=order.status, check_in=order.check_in)

    repo = RefundRepository(session)

    # 事先查一次額度，只為了訊息品質（FR-036c）。真正擋下第六筆的是 trigger。
    if await repo.quota_used(user.id) >= MAX_REFUNDS_PER_USER:
        raise DomainError(
            f"您的退款申請已達 {MAX_REFUNDS_PER_USER} 筆上限，無法再提出新的申請。",
            code="REFUND_LIMIT_REACHED",
            status_code=409,
        )

    amount = refund_rules.refund_amount(order.total_amount, order.check_in)

    try:
        refund = await repo.create(
            order=order, user_id=user.id, reason=reason, amount=amount
        )
        await session.commit()
    except (IntegrityError, DBAPIError) as exc:
        # ⚠️ MUST 先 rollback。PostgreSQL 的交易在錯誤後進入 aborted 狀態，
        # 不回滾的話後續每一句都會失敗，而錯誤訊息會變成一句與退款無關的
        # InFailedSqlTransaction。
        await session.rollback()
        raise _translate(exc) from exc

    await session.refresh(order)
    return _row(refund, order)


@router.get("", response_model=list[RefundOut], summary="我的退款申請（需登入）")
async def list_my_refunds(user: CurrentUser, session: SessionDep) -> list[RefundOut]:
    """本人的全部申請與審核進度（FR-037）。

    ⚠️ **只回本人的。** 漏掉 `where user_id = ...` 的話，每個人都看得到全站的
    退款原因——而退款原因往往寫著私事（FR-081、SC-019）。
    """
    rows = await RefundRepository(session).list_for_user(user.id)
    return [_row(refund, order) for refund, order in rows]


def _translate(exc: Exception) -> DomainError:
    """把資料庫的拒絕轉成使用者看得懂的話。

    ⚠️ **認不出來的一律回 500，MUST NOT 猜一個訊息。** 猜錯會讓使用者照著
    錯誤的指示反覆修改一個根本不是問題的地方。
    """
    text = str(getattr(exc, "orig", exc))

    if _ONE_PENDING_INDEX in text:
        return DomainError(
            "此訂單已有一筆退款申請正在審核中，請等待審核結果。",
            code="REFUND_ALREADY_PENDING",
            status_code=409,
        )

    sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
    if sqlstate == _RAISE_EXCEPTION or "上限" in text:
        return DomainError(
            f"您的退款申請已達 {MAX_REFUNDS_PER_USER} 筆上限，無法再提出新的申請。",
            code="REFUND_LIMIT_REACHED",
            status_code=409,
        )

    return InternalError(f"未預期的退款寫入失敗：{text}")


__all__ = ["router"]
