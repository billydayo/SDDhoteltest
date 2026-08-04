"""訂單端點。**全部需登入。**

## 房況競態不是錯誤

`POST /orders` 的 `IntegrityError` 是**正常結果**：兩個人同時搶同一間房的同一
晚，資料庫讓其中一個成功、另一個失敗，這正是 `orders_no_overlap` 該做的事
（SC-020）。因此在此明確接住並轉譯，而不是讓它冒到全域處理器——本地接住才能
在同一個地方 `rollback`，讓 session 回到可用狀態。

⚠️ **轉譯 MUST 以約束名稱分派。** 只看例外型別會把「夜數對不上」回成
「已無空房」，使用者照著訊息改日期永遠改不好（research R3）。

## 非本人回 403 而非 404

contracts/README.md 明訂。這確實會透露「該 id 的訂單存在」，但訂單 id 是
uuid4，猜不到；而把越權偽裝成「不存在」會讓真正遇到問題的使用者收到一個
誤導的訊息，也讓前端無從分辨該導向登入頁還是顯示無權限。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from sqlalchemy.exc import IntegrityError

from sunny.deps import CurrentUser, SessionDep
from sunny.errors import DomainError, translate_integrity_error
from sunny.models.order import (
    CANCEL_PAYMENT_TIMEOUT,
    STATUS_CANCELLED,
    STATUS_CONFIRMED,
    STATUS_PENDING_PAYMENT,
    STATUS_REFUND_PENDING,
    Order,
)
from sunny.repositories.orders import OrderRepository
from sunny.repositories.rooms import RoomRepository
from sunny.schemas.order import OrderCreateIn, OrderOut
from sunny.services import booking
from sunny.utils import dates

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderOut, status_code=201, summary="建立訂單（需登入）")
async def create_order(
    payload: OrderCreateIn,
    user: CurrentUser,
    session: SessionDep,
) -> OrderOut:
    """建立一筆待付款訂單（FR-020–FR-032）。

    ⚠️ **夜數與總金額由後端依當下房價重算。** `OrderCreateIn` 沒有這兩個欄位，
    送出偽造值不會被採信（FR-024、FR-032）。

    訂單建立後即**佔用房況**——待付款與已確認在排除約束前一視同仁（FR-097），
    直到 `expiresAt` 過後被下一次查詢清理掉才釋出。
    """
    room = await RoomRepository(session).get(payload.room_id)
    if room is None:
        raise DomainError("查無此房源。", code="ROOM_NOT_FOUND", status_code=404, field="roomId")

    draft = booking.prepare_booking(
        room=room,
        check_in=payload.check_in,
        check_out=payload.check_out,
        guest_count=payload.guest_count,
        payment_method=payload.payment_method,
    )

    try:
        order = await OrderRepository(session).create(
            user_id=user.id,
            room_id=room.id,
            draft=draft,
            contact_name=payload.contact_name.strip(),
            phone=payload.phone.strip(),
            email=payload.email,
        )
        await session.commit()
    except IntegrityError as exc:
        # 競態的正常結果。**MUST 先 rollback**——PostgreSQL 的交易在錯誤後
        # 進入 aborted 狀態，不回滾的話後續每一句都會失敗，而錯誤訊息會變成
        # 一句與訂房無關的 InFailedSqlTransaction。
        await session.rollback()
        raise translate_integrity_error(exc) from exc

    return OrderOut.model_validate(order)


@router.get("", response_model=list[OrderOut], summary="我的訂單（需登入）")
async def list_my_orders(user: CurrentUser, session: SessionDep) -> list[OrderOut]:
    """本人的全部訂單，依入住日由近而遠（FR-033）。

    ⚠️ **只回本人的。** `user_id` 來自 token，**不接受任何查詢參數指定會員**
    ——留一個 `?userId=` 就等於把整站的訂單開放給任何登入者，而回來的資料
    看起來完全正常（FR-034、SC-019）。
    """
    orders = await OrderRepository(session).list_for_user(user.id)
    return [OrderOut.model_validate(order) for order in orders]


@router.get("/{order_id}", response_model=OrderOut, summary="訂單詳情（需登入、僅本人）")
async def get_my_order(
    order_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> OrderOut:
    """單筆訂單（FR-033、FR-034）。

    非本人回 **403 而非 404**（contracts/README.md）。這確實透露該 id 的訂單
    存在，但訂單 id 是 uuid4、猜不到；而把越權偽裝成「不存在」會讓真正遇到
    問題的人收到誤導的訊息，前端也無從分辨該導向登入頁還是顯示無權限。
    """
    order = _owned(await OrderRepository(session).get_fresh(order_id), user.id)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/cancel", response_model=OrderOut, summary="取消待付款訂單（需登入）")
async def cancel_my_order(
    order_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> OrderOut:
    """會員主動取消（FR-035a）。

    ⚠️ **僅 `pending-payment` 可取消。已確認的訂單 MUST 走退款申請。**

    款項已付之後還開放直接取消，就繞過了 FR-041 的退款級距——入住前一天
    取消也能全額拿回。這一條由**伺服器端**強制，MUST NOT 只靠前端把按鈕
    藏起來（FR-081）。

    取消後該日期區間**立即**釋出，不需要任何額外動作（見 repository）。
    """
    repo = OrderRepository(session)

    # 先清理逾期訂單再讀狀態。順序顛倒會讓一筆早已逾期的訂單被「取消」成
    # `member-cancelled`，而它實際上是 `payment-timeout`——那個數字正是用來
    # 判斷付款流程是否有問題的依據（FR-035a）。
    await repo.expire_stale_orders()

    order = _owned(await repo.get(order_id), user.id)
    _ensure_cancellable(order)

    await repo.cancel_by_member(order)
    await session.commit()
    await session.refresh(order)
    return OrderOut.model_validate(order)


def _owned(order: Order | None, user_id: uuid.UUID) -> Order:
    """存在且屬於本人，回傳該訂單。

    ⚠️ **「不存在」與「非本人」的狀態碼不同（404 / 403），MUST 分開判斷。**
    合併成一個 404 會讓真正遇到問題的使用者收到誤導的訊息，前端也無從分辨
    該顯示「查無此訂單」還是「無權存取」。

    回傳而非只做檢查，是為了讓型別檢查器知道之後的 `order` 不是 `None`——
    否則每個呼叫點都得補一個 `assert`，而 `assert` 在 `-O` 下會被整個移除。
    """
    if order is None:
        raise DomainError("查無此訂單。", code="ORDER_NOT_FOUND", status_code=404)
    if order.user_id != user_id:
        raise DomainError("無權存取此訂單。", code="FORBIDDEN", status_code=403)
    return order


def _ensure_cancellable(order: Order) -> None:
    """可否取消的檢查（FR-035a）。

    每種不可取消的原因 MUST 有各自的訊息，尤其是「已確認」那一條——它要
    **指出下一步在哪裡**（退款申請），否則使用者只知道按鈕沒用，不知道
    該去哪裡辦。
    """
    if order.status == STATUS_PENDING_PAYMENT:
        return

    if order.status == STATUS_CONFIRMED:
        raise DomainError(
            "此訂單已完成付款，無法直接取消。請改為提出退款申請，由管理員審核後辦理。",
            code="ORDER_ALREADY_PAID",
            status_code=409,
        )

    if order.status == STATUS_CANCELLED:
        raise DomainError("此訂單已取消。", code="ORDER_CANCELLED", status_code=409)

    if order.status == STATUS_REFUND_PENDING:
        raise DomainError(
            "此訂單的退款申請正在審核中，請等待審核結果。",
            code="REFUND_ALREADY_PENDING",
            status_code=409,
        )

    # refunded / completed
    raise DomainError("此訂單目前的狀態無法取消。", code="ORDER_NOT_CANCELLABLE", status_code=409)


@router.post("/{order_id}/pay", response_model=OrderOut, summary="模擬付款（需登入）")
async def pay_order(
    order_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> OrderOut:
    """完成模擬付款，訂單轉為已確認（FR-026、FR-027、FR-099、FR-100）。

    ⚠️ **這是模擬支付，不產生任何實際交易。** 沒有任何請求內容——不接收卡號、
    有效期限、CVV 或銀行帳號（FR-028）。付款方式在建單時就已選定。
    """
    repo = OrderRepository(session)

    # MUST 先清理逾期訂單，再讀取狀態。順序顛倒的話會讀到一筆「看起來還在
    # 待付款」的逾期訂單並讓它付款成功——房間就這樣賣了兩次（FR-100）。
    await repo.expire_stale_orders()

    order = await repo.get(order_id)
    if order is None:
        raise DomainError("查無此訂單。", code="ORDER_NOT_FOUND", status_code=404)

    # 授權：**非本人回 403**，與「不存在」是不同的事（contracts/README.md）
    if order.user_id != user.id:
        raise DomainError("無權操作此訂單。", code="FORBIDDEN", status_code=403)

    _ensure_payable(order)

    order.status = STATUS_CONFIRMED
    await session.commit()
    await session.refresh(order)
    return OrderOut.model_validate(order)


#: 逾期的訊息。⚠️ **MUST 說明該區間可能已被他人預訂**（contracts/README.md）。
#: 只說「訂單已逾期」會讓使用者以為重訂一次就好，而實際上房可能已經沒了——
#: 他會在下一頁再撞一次牆。
_EXPIRED_DETAIL = "此訂單的付款時間已過並已自動取消，所選日期可能已被其他人預訂，請重新查詢。"


def _ensure_payable(order: Order) -> None:
    """付款前的狀態檢查。

    每種不可付款的原因 MUST 有各自的訊息——把它們合併成一句「無法付款」會讓
    使用者不知道下一步該做什麼：已付款的該去看訂單，逾期的該重新訂房，
    自己取消的則兩者皆非。

    資料庫的 `guard_order_transition` trigger 擋著同樣的轉換，那是最後一道網；
    這裡的目的是給出使用者看得懂的話（憲章原則 IV）。
    """
    if order.status == STATUS_PENDING_PAYMENT:
        # 逾期清理已在呼叫端執行過，狀態理應已變。這裡再比一次時間是為了接住
        # 「清理與讀取之間剛好跨過期限」這條窄縫——不擋的話 trigger 會擋，
        # 但那會變成一句與訂房無關的資料庫錯誤。
        if order.expires_at >= dates.now_taipei():
            return
        raise DomainError(_EXPIRED_DETAIL, code="ORDER_EXPIRED", status_code=409)

    if order.status == STATUS_CONFIRMED:
        raise DomainError("此訂單已完成付款。", code="ORDER_ALREADY_PAID", status_code=409)

    if order.status == STATUS_CANCELLED:
        if order.cancel_reason == CANCEL_PAYMENT_TIMEOUT:
            raise DomainError(_EXPIRED_DETAIL, code="ORDER_EXPIRED", status_code=409)
        raise DomainError("此訂單已取消，無法付款。", code="ORDER_CANCELLED", status_code=409)

    # refund-pending / refunded / completed
    raise DomainError("此訂單目前的狀態無法付款。", code="ORDER_NOT_PAYABLE", status_code=409)
