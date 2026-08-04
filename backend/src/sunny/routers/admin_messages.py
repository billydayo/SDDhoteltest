"""客服端私訊（FR-127、FR-128）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上。

⚠️ **任一管理員皆可讀取並回覆所有討論串。MUST NOT 提供「指派給特定客服」
的機制**（FR-127）。

這不是省事，是刻意的：指派會讓被指派者休假時整串無人回覆，而這項功能要
解決的正是不漏接。因此本檔**沒有** `assignee` 參數、沒有 `claim` 端點，
也沒有「我的討論串」篩選。日後有人要加，這段說明就是理由。

⚠️ **每次回覆 MUST 寫入 `admin_logs`，且日誌 MUST NOT 含訊息內容**
（FR-118、FR-128）。訊息是客人寫的字，常含行程、健康狀況或抱怨的對象——
把它抄進所有管理員都讀得到的日誌，等於多開一個外洩點。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.message import SENDER_ADMIN
from sunny.repositories.admin_users import AdminUserRepository
from sunny.repositories.messages import MessageRepository
from sunny.schemas.message import AdminMessageOut, MessageIn, ThreadSummaryOut
from sunny.services import audit

router = APIRouter(
    prefix="/admin/messages",
    tags=["admin:messages"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[ThreadSummaryOut], summary="討論串清單（需管理員）")
async def list_threads(session: SessionDep) -> list[ThreadSummaryOut]:
    """需管理員（FR-127）。**全部**討論串，依最後訊息時間由新到舊。

    未讀數只算會員送出而尚未被讀的——那是客服的待辦。把管理員自己送出的
    未讀也算進去，這個數字就永遠不會歸零。
    """
    rows = await MessageRepository(session).threads()
    return [
        ThreadSummaryOut(user_id=user_id, user_name=name, unread=unread, last_message_at=last_at)
        for user_id, name, unread, last_at in rows
    ]


@router.get(
    "/{thread_user_id}",
    response_model=list[AdminMessageOut],
    summary="討論串內容（需管理員）",
)
async def read_thread(thread_user_id: uuid.UUID, session: SessionDep) -> list[AdminMessageOut]:
    """需管理員（FR-127）。任一管理員都讀得到任一串。

    回應含 `senderName`：**管理員端 MUST 看得出每則回覆出自哪一位管理員**。
    接手的人需要知道前一句是誰說的，否則同一串裡會出現互相矛盾的答覆
    而沒有人察覺。前台的 `MessageOut` 則沒有這個欄位。
    """
    rows = await MessageRepository(session).thread_of(thread_user_id)
    return [
        AdminMessageOut.model_validate(message).model_copy(update={"sender_name": name})
        for message, name in rows
    ]


@router.post(
    "/{thread_user_id}",
    response_model=AdminMessageOut,
    status_code=201,
    summary="回覆討論串（需管理員）",
)
async def reply(
    thread_user_id: uuid.UUID, payload: MessageIn, session: SessionDep, admin: AdminUser
) -> AdminMessageOut:
    """需管理員（FR-127、FR-128）。

    ⚠️ `sender_role` 一律寫入 `admin`，`sender_id` 一律是這位管理員——
    兩者都不來自請求主體（FR-125）。

    ⚠️ 稽核紀錄與訊息在**同一個交易**內提交，且**不含訊息內容**（FR-128）。
    """
    if await AdminUserRepository(session).get(thread_user_id) is None:
        # 討論串以會員為單位，會員不存在就沒有那一串可回。
        raise DomainError("查無此會員的討論串。", code="THREAD_NOT_FOUND", status_code=404)

    repo = MessageRepository(session)
    message = await repo.send(
        thread_user_id=thread_user_id,
        sender_id=admin.id,
        sender_role=SENDER_ADMIN,
        body=payload.body,
    )

    await audit.record(
        session,
        actor_id=admin.id,
        action="message.reply",
        target_table="messages",
        target_id=message.id,
        # ⚠️ **只記長度，不記內容**（FR-128、FR-118）。訊息是客人寫的字，
        # 常含行程、健康狀況或抱怨的對象；日誌的用途是「誰在何時回了哪一串」，
        # 全文照抄只會讓每一位管理員都讀得到本來只有客服看得到的對話。
        summary={"threadUserId": str(thread_user_id), "bodyLength": len(payload.body)},
    )
    await session.commit()

    return AdminMessageOut.model_validate(message).model_copy(
        update={"sender_name": admin.display_name}
    )


@router.post(
    "/{thread_user_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="標記會員訊息為已讀（需管理員）",
)
async def mark_read(thread_user_id: uuid.UUID, session: SessionDep) -> Response:
    """需管理員。把該串中會員送出的未讀訊息標記為已讀。

    **不寫稽核紀錄**：這不是對業務資料的變更，而是閱讀本身的副作用。
    把每一次開啟討論串都記一筆，會讓日誌被閱讀行為淹沒，真正的變更反而
    更難找到（test_audit_completeness.py 的具名豁免）。
    """
    await MessageRepository(session).mark_read(
        thread_user_id=thread_user_id, reader_role=SENDER_ADMIN
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
