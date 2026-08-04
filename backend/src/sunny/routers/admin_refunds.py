"""後台退款審核（FR-038、FR-039、FR-057）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上。
⚠️ **核准與駁回皆 MUST 與其稽核紀錄在同一個交易內提交**（FR-114）。

## 核准後區間立即釋回——SC-006

訂單轉 `refunded` 即脫離排除約束的 `where` 子句，該區間於下一次搜尋自動重新
出現。本檔沒有任何「釋放房況」的呼叫，因為沒有那個東西可呼叫
（repositories/admin_refunds.py 的同一段說明）。

## 駁回不是終點

駁回後訂單回到 `confirmed`，且該會員**可再次申請**（FR-039）。
`refunds` 的部分唯一索引只擋「同一訂單同時一筆審核中」，被駁回的那筆不佔位；
每位會員 5 筆的上限亦不計入被駁回者（models/refund.py、SC-031）。

若駁回也佔額度，被駁回 5 次的會員將永遠無法再申請——與 FR-039 直接矛盾。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.order import STATUS_REFUND_PENDING
from sunny.models.refund import STATUS_PENDING
from sunny.repositories.admin_refunds import AdminRefundRepository, RefundRow
from sunny.schemas.moderation import DECISION_APPROVE, RefundDecisionIn, RefundOut
from sunny.services import audit

router = APIRouter(
    prefix="/admin/refunds",
    tags=["admin:refunds"],
    dependencies=[Depends(require_admin)],
)


def _to_out(row: RefundRow) -> RefundOut:
    refund, order, applicant = row
    return RefundOut.model_validate(refund).model_copy(
        update={
            "order_no": order.order_no,
            "applicant_name": applicant,
            "check_in": order.check_in,
            "check_out": order.check_out,
        }
    )


@router.get("", response_model=list[RefundOut], summary="退款申請清單（需管理員）")
async def list_refunds(
    session: SessionDep,
    refund_status: Annotated[
        str | None, Query(alias="status", description="pending／approved／rejected")
    ] = None,
) -> list[RefundOut]:
    """需管理員（FR-057）。

    列出的金額為申請當下**分級後**的實付退款額（FR-041），不重算——
    重算會讓管理員看到的數字與申請人被告知的不同，而爭議正是這樣產生的。
    """
    rows = await AdminRefundRepository(session).search(status=refund_status)
    return [_to_out(row) for row in rows]


@router.patch("/{refund_id}", response_model=RefundOut, summary="核准或駁回退款（需管理員）")
async def decide_refund(
    refund_id: uuid.UUID, payload: RefundDecisionIn, session: SessionDep, admin: AdminUser
) -> RefundOut:
    """核准或駁回（FR-038、FR-039、FR-057）。

    核准：退款轉 `approved`、訂單轉 `refunded`，該區間立即釋回（SC-006）。
    駁回：退款轉 `rejected`、訂單退回 `confirmed`，會員可再次申請。
    """
    repo = AdminRefundRepository(session)
    row = await repo.get(refund_id)
    if row is None:
        raise DomainError("查無此退款申請。", code="REFUND_NOT_FOUND", status_code=404)

    refund, order, applicant = row

    if refund.status != STATUS_PENDING:
        # 兩位管理員同時打開待審清單時會發生。回 409 並說出目前狀態，
        # 比靜默覆蓋前一個人的決定好——後者會讓「誰核准的」對不上稽核紀錄。
        raise DomainError(
            "此退款申請已審核完畢，無法重複審核。",
            code="REFUND_ALREADY_REVIEWED",
            status_code=409,
        )

    if order.status != STATUS_REFUND_PENDING:
        # 資料不一致：退款還在審核中，訂單卻已經不在「退款申請中」。
        # 照著審下去會把訂單推到一個與事實不符的狀態，寧可擋下來。
        raise DomainError(
            "此訂單目前不在退款申請中的狀態，請重新整理後確認。",
            code="ORDER_NOT_REFUND_PENDING",
            status_code=409,
        )

    approving = payload.decision == DECISION_APPROVE
    if approving:
        await repo.approve(refund, order, note=payload.note)
    else:
        await repo.reject(refund, order, note=payload.note)

    await audit.record(
        session,
        actor_id=admin.id,
        action=f"refund.{payload.decision}",
        target_table="refunds",
        target_id=refund.id,
        # ⚠️ 不記申請理由與申請人姓名——理由是會員自己寫的文字，常含行程或
        # 健康狀況等真實個資（FR-118）。金額與訂單編號足以追溯這筆決定。
        summary={
            "orderNo": order.order_no,
            "amount": refund.amount,
            "orderStatus": order.status,
            **({"note": payload.note} if payload.note else {}),
        },
    )
    await session.commit()
    return _to_out((refund, order, applicant))
