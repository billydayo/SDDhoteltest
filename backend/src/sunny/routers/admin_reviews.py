"""後台評論審核與業者回覆（FR-056、FR-103b、FR-103c、FR-103d）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上（見 admin_rooms.py
的同一段說明）。

⚠️ **四種操作皆 MUST 寫入 `admin_logs`**：通過、駁回、覆寫自動審核結果、
刪除已公開評論。且 MUST 與變更在同一個交易內提交（FR-114、憲章資料存取規則）。

## 「覆寫自動審核」不是第五個端點

自動審核只產出 `auto_verdict` 初判，**評論一律先進 `pending`**，公開與否從頭
到尾都由人決定（FR-103）。因此「覆寫」在資料上與一般審核完全相同——差別只在
管理員的決定與初判相反。

做成獨立端點的話，前端就得先比對 `auto_verdict` 才知道該打哪一支，而比對錯了
就會漏掉那筆稽核紀錄。改為由後端在寫日誌時判定並標記 `overrodeAutoVerdict`：
覆寫這件事因而**不可能漏記**（FR-103b）。

## 自動審核 MUST NOT 被描述為 AI

規則式引擎。介面文案 MUST 標示為「自動審核（規則式）」（FR-103a、憲章原則 VI）。
本檔的 `auto_rules` 回傳觸發的規則代碼，正是為了讓這個宣稱可被檢驗。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.review import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    VERDICT_PASS,
    VERDICT_REJECT,
    Review,
)
from sunny.repositories.admin_reviews import AdminReviewRepository, ReviewRow
from sunny.schemas.moderation import ReviewDecisionIn, ReviewOut, ReviewReplyIn
from sunny.services import audit

router = APIRouter(
    prefix="/admin/reviews",
    tags=["admin:reviews"],
    dependencies=[Depends(require_admin)],
)

#: 自動審核的初判 → 若人工採信該初判，評論會落到哪個狀態。
#: 管理員的決定與此表不符時即為「覆寫」（FR-103b）。
_VERDICT_IMPLIES = {VERDICT_PASS: STATUS_APPROVED, VERDICT_REJECT: STATUS_REJECTED}


def _to_out(row: ReviewRow) -> ReviewOut:
    review, room_name, user_name = row
    return ReviewOut.model_validate(review).model_copy(
        update={"room_name": room_name, "user_name": user_name}
    )


async def _get_or_404(repo: AdminReviewRepository, review_id: uuid.UUID) -> ReviewRow:
    row = await repo.get(review_id)
    if row is None:
        raise DomainError("查無此評論。", code="REVIEW_NOT_FOUND", status_code=404)
    return row


def _overrode_auto_verdict(review: Review, target: str) -> bool:
    """管理員的決定是否推翻了自動審核的初判。

    尚無初判時回 False——沒有被推翻的東西。這不是「覆寫」，只是一般審核。
    """
    implied = _VERDICT_IMPLIES.get(review.auto_verdict or "")
    return implied is not None and implied != target


@router.get("", response_model=list[ReviewOut], summary="評論清單（需管理員）")
async def list_reviews(
    session: SessionDep,
    review_status: Annotated[
        str | None, Query(alias="status", description="pending／approved／rejected")
    ] = None,
    room_id: Annotated[uuid.UUID | None, Query(alias="roomId")] = None,
) -> list[ReviewOut]:
    """需管理員（FR-056）。預設回全部，由前端各分頁自行帶入 `status`。"""
    rows = await AdminReviewRepository(session).search(status=review_status, room_id=room_id)
    return [_to_out(row) for row in rows]


@router.patch("/{review_id}/status", response_model=ReviewOut, summary="審核評論（需管理員）")
async def decide_review(
    review_id: uuid.UUID, payload: ReviewDecisionIn, session: SessionDep, admin: AdminUser
) -> ReviewOut:
    """通過、駁回或退回待審（FR-056、FR-103b）。

    通過後該評論即計入房源平均評分——由 `reviews_refresh_rating` trigger
    重算，本函式不碰 `rooms.average_rating`。
    """
    repo = AdminReviewRepository(session)
    review, room_name, user_name = await _get_or_404(repo, review_id)

    previous = review.status
    if previous == payload.status:
        raise DomainError(
            "該評論已是此狀態，未做任何變更。",
            code="REVIEW_STATUS_UNCHANGED",
            status_code=400,
            field="status",
        )

    overrode = _overrode_auto_verdict(review, payload.status)
    await repo.set_status(review, payload.status, note=payload.note)

    await audit.record(
        session,
        actor_id=admin.id,
        action="review.override" if overrode else f"review.{payload.status}",
        target_table="reviews",
        target_id=review.id,
        # ⚠️ 摘要不含評論內文。那是會員寫的字，且可能提及自身行程——
        # 屬個資，MUST NOT 進入所有管理員都讀得到的日誌（FR-118）。
        summary={
            "from": previous,
            "to": payload.status,
            "autoVerdict": review.auto_verdict,
            "overrodeAutoVerdict": overrode,
            **({"note": payload.note} if payload.note else {}),
        },
    )
    await session.commit()
    return _to_out((review, room_name, user_name))


@router.put("/{review_id}/reply", response_model=ReviewOut, summary="業者回覆（需管理員）")
async def set_reply(
    review_id: uuid.UUID, payload: ReviewReplyIn, session: SessionDep, admin: AdminUser
) -> ReviewOut:
    """撰寫、修改或收回業者公開回覆（FR-103d）。**清空內容等同收回。**

    ⚠️ **待審核與已駁回的評論不提供回覆入口。** 前台看不到那些評論，替一則
    不存在於公開頁面的評論寫回覆，寫的人會以為已經回應了客訴，而客人一個字
    也沒看到。

    前台顯示回覆時 MUST NOT 顯示回覆者姓名——回覆代表店家而非個人（FR-103d）。
    `admin_reply_by` 只存在於後台與稽核，`ReviewOut` 不含此欄位。
    """
    repo = AdminReviewRepository(session)
    review, room_name, user_name = await _get_or_404(repo, review_id)

    if review.status != STATUS_APPROVED:
        raise DomainError(
            "僅通過審核的評論可撰寫回覆。請先審核該評論。",
            code="REVIEW_NOT_PUBLISHED",
            status_code=409,
        )

    reply = payload.normalized()
    had_reply = review.admin_reply is not None
    if reply is None and not had_reply:
        raise DomainError(
            "此評論目前沒有回覆可收回。",
            code="REPLY_NOT_FOUND",
            status_code=400,
            field="reply",
        )

    await repo.set_reply(review, reply, admin_id=admin.id)

    if reply is None:
        action = "review.reply.withdraw"
    elif had_reply:
        action = "review.reply.update"
    else:
        action = "review.reply.create"

    await audit.record(
        session,
        actor_id=admin.id,
        action=action,
        target_table="reviews",
        target_id=review.id,
        # 只記長度不記內文：回覆是公開文字，但日誌的用途是「誰在何時動了什麼」，
        # 全文照抄只是把公開頁面的內容再複製一份。
        summary={"replyLength": len(reply) if reply else 0},
    )
    await session.commit()
    return _to_out((review, room_name, user_name))


@router.delete(
    "/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除已公開評論（需管理員）",
)
async def delete_review(review_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> Response:
    """刪除（FR-103c）。房源平均評分於刪除後由 trigger 重算。

    ⚠️ **稽核紀錄先寫、後刪除。** `admin_logs.target_id` 是純文字而非外鍵，
    因此紀錄能在對象消失後留存——這正是刪除類操作最需要稽核的地方。
    """
    repo = AdminReviewRepository(session)
    review, _room_name, _user_name = await _get_or_404(repo, review_id)

    await audit.record(
        session,
        actor_id=admin.id,
        action="review.delete",
        target_table="reviews",
        target_id=review.id,
        # 記房源與評分：刪掉之後平均評分會變，而這兩個值是日後回推
        # 「為什麼那天平均分跳了」的唯一線索。仍不含內文與會員身分。
        summary={
            "roomId": str(review.room_id),
            "rating": review.rating,
            "status": review.status,
        },
    )
    await repo.delete(review)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
