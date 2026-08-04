"""會員撰寫評論。**需登入。**

前台閱讀評論的端點不在這裡，而在 `routers/rooms.py` 的
`GET /rooms/{id}/reviews`——那一支是**公開**的（訪客要看得到評價，US1），
與本檔的授權層級不同。兩種授權層級 MUST NOT 混在同一個檔案裡，否則新增端點
的人會從鄰居身上抄到錯誤的預設值（contracts/README.md）。

## 三道關卡，三種狀態碼

`POST /reviews` 對「不能評論」有三個不同的原因，MUST 分開回答（FR-042）：

- 訂單不存在 → **404**
- 訂單不是本人的 → **403**（contracts/README.md：非本人回 403 而非 404）
- 訂單存在且是本人的，但還沒入住完成 → **409**

合併成一句「無法評論」會讓使用者不知道下一步：第三種只要等到退房之後就能寫，
前兩種等到天荒地老都不會變。

## 送出後一律待審核

自動審核只產出初判（`services/moderation.py`），**MUST NOT 因為初判通過就直接
公開**（FR-045、FR-103）。回應中的 `status` 因此恆為 `pending`。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy.exc import IntegrityError

from sunny.deps import CurrentUser, SessionDep
from sunny.errors import DomainError, translate_integrity_error
from sunny.models.order import STATUS_COMPLETED, Order
from sunny.repositories.orders import OrderRepository
from sunny.repositories.reviews import ReviewRepository
from sunny.schemas.review import MyReviewOut, ReviewCreateIn
from sunny.services import moderation

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post(
    "",
    response_model=MyReviewOut,
    status_code=status.HTTP_201_CREATED,
    summary="撰寫評論（需登入）",
)
async def create_review(
    payload: ReviewCreateIn,
    user: CurrentUser,
    session: SessionDep,
) -> MyReviewOut:
    """對自己已完成入住的訂單留下一則評論（FR-042 ~ FR-045）。

    ⚠️ **房源由訂單推導，不由用戶端指定。** `ReviewCreateIn` 沒有 `roomId`——
    有的話就能拿 A 房的訂單去評 B 房，而那則評論會計入 B 房的平均評分
    （FR-046），過程中不會有任何異常。

    ⚠️ **一筆訂單一則評論由資料庫的 `reviews_order_id_key` 保證**（FR-043）。
    這裡不預先查一次「是否已評論」再寫入：查了再寫仍有競態，同一個人連按兩次
    送出就能塞進兩則。真正的保證是 UNIQUE 約束，違反時轉為 409 REVIEW_EXISTS
    （憲章原則 IV）。
    """
    order = _reviewable(await OrderRepository(session).get(payload.order_id), user.id)

    repo = ReviewRepository(session)

    # 自動審核（規則式，**非 AI**）。初判只寫進 `auto_verdict` 與 `auto_rules`，
    # 不決定 `status`——公開與否由管理員複核（FR-103、FR-103a）。
    verdict = moderation.review(
        rating=payload.rating,
        comment=payload.comment,
        previous_comments=await repo.comments_by(user.id),
    )

    try:
        review = await repo.create(
            order_id=order.id,
            room_id=order.room_id,
            user_id=user.id,
            rating=payload.rating,
            comment=payload.comment,
            category=payload.category,
            auto_verdict=verdict.verdict,
            auto_rules=verdict.rules,
        )
        await session.commit()
    except IntegrityError as exc:
        # 同一筆訂單第二次送出。**MUST 先 rollback**——PostgreSQL 的交易在錯誤後
        # 進入 aborted 狀態，不回滾的話後續每一句都會失敗，而使用者收到的會是
        # 一句與評論無關的 InFailedSqlTransaction。
        await session.rollback()
        raise translate_integrity_error(exc) from exc

    await session.refresh(review)
    return MyReviewOut.model_validate(review)


@router.get("", response_model=list[MyReviewOut], summary="我的評論（需登入）")
async def list_my_reviews(user: CurrentUser, session: SessionDep) -> list[MyReviewOut]:
    """本人寫過的評論，含尚未通過審核的（FR-043、FR-045）。

    ⚠️ **只回本人的。`user_id` 來自 token，不接受任何查詢參數指定會員**——
    留一個 `?userId=` 就等於把全站的評論（含被駁回的）開放給任何登入者，
    而回來的資料看起來完全正常（同 `routers/orders.py` 的同一條）。

    前端用它回答「這筆訂單我評過了嗎」（FR-043）：已評論過的訂單 MUST NOT
    再提供撰寫入口，而要導向既有的那一則。用 `orderId` 比對即可——一筆訂單
    最多一則評論。
    """
    reviews = await ReviewRepository(session).list_for_user(user.id)
    return [MyReviewOut.model_validate(review) for review in reviews]


def _reviewable(order: Order | None, user_id: uuid.UUID) -> Order:
    """存在、屬於本人、且已完成入住，回傳該訂單（FR-042）。

    回傳而非只做檢查，是為了讓型別檢查器知道之後的 `order` 不是 `None`——
    否則呼叫點得補一個 `assert`，而 `assert` 在 `-O` 下會被整個移除。
    """
    if order is None:
        raise DomainError("查無此訂單。", code="ORDER_NOT_FOUND", status_code=404, field="orderId")
    if order.user_id != user_id:
        raise DomainError("無權對此訂單撰寫評論。", code="FORBIDDEN", status_code=403)
    if order.status != STATUS_COMPLETED:
        # ⚠️ 訊息 MUST 說明「何時才能寫」。只說「無法評論」的話，一位下週才入住
        # 的房客會以為自己的帳號有問題，而他其實只需要等到退房之後。
        raise DomainError(
            "此訂單尚未完成入住，退房後即可撰寫評論。",
            code="ORDER_NOT_COMPLETED",
            status_code=409,
            field="orderId",
        )
    return order
