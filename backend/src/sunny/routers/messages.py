"""會員端私訊（FR-123 ~ FR-127）。

⚠️ **本檔全部端點需登入，且沒有任何端點接受討論串識別。**

討論串一律是**呼叫者自己那一串**——`thread_user_id` 取自 token，不是參數。
這是 FR-126（會員 MUST NOT 讀寫他人討論串）在結構上的達成方式：不是「檢查
threadId 等於自己」，而是根本沒有那個參數可填（同 routers/favorites.py）。

⚠️ **發話者身分與角色由伺服器判定。** `MessageIn` 只有 `body`；前端送出的
`senderRole` 不是被忽略，而是**根本沒有這個欄位**（FR-125、SC-032）。

否則會員可在自己的討論串中偽造一則「官方回覆」——那一串本就屬於他，
權限規則擋不住這種寫入，只有「角色不由他決定」能擋。
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from sunny.deps import CurrentUser, SessionDep
from sunny.models.message import SENDER_MEMBER
from sunny.repositories.messages import MessageRepository
from sunny.schemas.message import MessageIn, MessageOut

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("", response_model=list[MessageOut], summary="我的訊息（需登入）")
async def list_messages(session: SessionDep, user: CurrentUser) -> list[MessageOut]:
    """需登入（FR-123）。自己的討論串，由舊到新。

    ⚠️ 回應中**沒有管理員姓名**——前台只看得到角色，由介面渲染為「客服人員」
    （FR-127）。這不是前端的責任：`MessageOut` 裡沒有那個欄位。
    """
    rows = await MessageRepository(session).thread_for(user_id=user.id)
    return [MessageOut.of(message, viewer_id=user.id) for message, _name in rows]


@router.post("", response_model=MessageOut, status_code=201, summary="送出訊息（需登入）")
async def send_message(payload: MessageIn, session: SessionDep, user: CurrentUser) -> MessageOut:
    """需登入（FR-123、FR-125）。

    ⚠️ `sender_role` 一律寫入 `member`，`sender_id` 一律是 token 中的使用者。
    **兩者都不來自請求主體。**

    ⚠️ 送出後內容不可修改（FR-124）——沒有對應的 PATCH 端點，
    且 `guard_message_update()` trigger 會擋下任何嘗試。一則能事後改字的訊息，
    在爭議發生時沒有任何佐證能力。
    """
    message = await MessageRepository(session).send(
        thread_user_id=user.id,
        sender_id=user.id,
        sender_role=SENDER_MEMBER,
        body=payload.body,
    )
    await session.commit()
    return MessageOut.of(message, viewer_id=user.id)


@router.post(
    "/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="標記客服訊息為已讀（需登入）",
)
async def mark_read(session: SessionDep, user: CurrentUser) -> Response:
    """需登入。把客服送來的未讀訊息標記為已讀。

    `read_at` 是訊息上**唯一**可事後更新的欄位（FR-124）。只標對方送出的：
    把自己送出的訊息標成已讀沒有意義，而且會讓「對方讀了沒」這個資訊失效。
    """
    await MessageRepository(session).mark_read(thread_user_id=user.id, reader_role=SENDER_MEMBER)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
