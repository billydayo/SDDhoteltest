"""私訊的資料存取（FR-123 ~ FR-128）。

## 討論串以會員為單位，不存收件者

存了就得回答「哪一位管理員」，而那正是不該綁定的東西——被指派者休假時整串
無人回覆，而這項功能要解決的正是不漏接（FR-127、models/message.py）。

## 兩種讀取，兩個方法

`thread_for()` 給會員讀自己的討論串，`user_id` 是**必填**的關鍵字參數；
`thread_of()` 給管理員讀任何一串。分開命名而非用一個帶 optional 參數的方法：
一個 `user_id=None 代表不限` 的介面，忘記帶參數的後果是讀到全部人的訊息，
而那不會報錯（同 repositories/favorites.py 的考量）。

## 送出後不可修改

`guard_message_update()` trigger 禁止變更 `body`、`sender_id`、`sender_role`、
`thread_user_id` 與 `created_at`。**只有 `read_at` 可以更新**（FR-124）。
本檔因此沒有任何「編輯訊息」的方法——寫了也只會拿到 42501。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import aliased

from sunny.models.message import SENDER_ADMIN, SENDER_MEMBER, Message
from sunny.models.profile import Profile
from sunny.repositories.base import Repository

#: 一列訊息：訊息本身 + 發話者顯示名稱。
#:
#: ⚠️ 發話者姓名**只給管理員端用**（FR-127：管理員端 MUST 看得出每則回覆出自
#: 哪一位管理員）。前台 MUST 只看到「客服人員」，因此會員端的 schema 不含此欄。
MessageRow = tuple[Message, str | None]


class MessageRepository(Repository):
    """討論串的讀寫。"""

    def _base_query(self) -> Select:
        sender = aliased(Profile)
        return select(Message, sender.display_name).join(sender, sender.id == Message.sender_id)

    async def thread_for(self, *, user_id: uuid.UUID) -> list[MessageRow]:
        """會員自己的討論串，由舊到新。

        對話由舊到新——這是一段對話，不是一份清單。由新到舊會讓人從結論
        往回讀。
        """
        return await self._thread(user_id)

    async def thread_of(self, thread_user_id: uuid.UUID) -> list[MessageRow]:
        """任一討論串（管理員用，FR-127）。"""
        return await self._thread(thread_user_id)

    async def _thread(self, thread_user_id: uuid.UUID) -> list[MessageRow]:
        stmt = (
            self._base_query()
            .where(Message.thread_user_id == thread_user_id)
            .order_by(Message.created_at, Message.id)
        )
        result = await self.session.execute(stmt)
        return [(message, name) for message, name in result.all()]

    async def send(
        self,
        *,
        thread_user_id: uuid.UUID,
        sender_id: uuid.UUID,
        sender_role: str,
        body: str,
    ) -> Message:
        """送出一則訊息。**不提交。**

        ⚠️ `sender_id` 與 `sender_role` 由呼叫端（路由層）依 token 決定，
        **MUST NOT 採信請求主體中的值**（FR-125）。否則會員可在自己的討論串
        中偽造一則「官方回覆」——那一串本就屬於他，權限規則擋不住這種寫入。

        `read_at` 與 `created_at` 由 `stamp_message_sender()` trigger 覆寫，
        前端送來的值不採信。
        """
        message = Message(
            thread_user_id=thread_user_id,
            sender_id=sender_id,
            sender_role=sender_role,
            body=body,
        )
        self.session.add(message)
        await self.session.flush()
        return message

    async def mark_read(self, *, thread_user_id: uuid.UUID, reader_role: str) -> int:
        """把**對方**送出的未讀訊息標記為已讀。回傳筆數。**不提交。**

        只標對方的：把自己送出的訊息標成已讀沒有意義，而且會讓「對方讀了沒」
        這個資訊失效——那是這個欄位唯一的用途。

        `read_at` 是**唯一**可事後更新的欄位（FR-124）。
        """
        counterpart = SENDER_ADMIN if reader_role == SENDER_MEMBER else SENDER_MEMBER

        rows = await self.session.scalars(
            select(Message).where(
                Message.thread_user_id == thread_user_id,
                Message.sender_role == counterpart,
                Message.read_at.is_(None),
            )
        )
        now = datetime.now(UTC)
        count = 0
        for message in rows.all():
            message.read_at = now
            count += 1
        if count:
            await self.session.flush()
        return count

    async def threads(self) -> list[tuple[uuid.UUID, str | None, int, datetime | None]]:
        """全部討論串的摘要（管理員用）：`(會員 id, 顯示名稱, 未讀數, 最後時間)`。

        未讀數只算**會員送出而尚未被讀**的——那是客服的待辦。把管理員自己
        送出的未讀也算進去，這個數字就永遠不會歸零（同渠道預警的考量）。

        依最後訊息時間由新到舊：最近有動靜的討論串排在前面。
        """
        stmt = (
            select(
                Message.thread_user_id,
                Profile.display_name,
                func.count()
                .filter(Message.sender_role == SENDER_MEMBER, Message.read_at.is_(None))
                .label("unread"),
                func.max(Message.created_at).label("last_at"),
            )
            .join(Profile, Profile.id == Message.thread_user_id)
            .group_by(Message.thread_user_id, Profile.display_name)
            .order_by(func.max(Message.created_at).desc())
        )
        result = await self.session.execute(stmt)
        return [(uid, name, int(unread or 0), last) for uid, name, unread, last in result.all()]


__all__ = ["MessageRepository", "MessageRow"]
