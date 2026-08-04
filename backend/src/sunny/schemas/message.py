"""私訊的 API 形狀（FR-123 ~ FR-128）。

## 兩個輸出模型，不是一個帶旗標的模型

`MessageOut`（前台）與 `AdminMessageOut`（後台）刻意是不同的類別。

FR-127：前台的會員 MUST 只看到「客服人員」，**MUST NOT 顯示管理員姓名**；
管理員端則 MUST 看得出每則回覆出自哪一位管理員。

做成同一個模型加一個 `include_sender_name` 開關的話，那個開關遲早會有一次
沒被關掉，而症狀是會員看到客服人員的真實姓名——沒有錯誤訊息，也不會有人
發現，直到有客人記下了名字。**前台的模型裡根本沒有那個欄位。**
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from sunny.models.message import SENDER_ADMIN
from sunny.schemas.room import CamelModel

#: 前台一律以此稱呼管理員（FR-127）。
SUPPORT_DISPLAY_NAME = "客服人員"


class MessageOut(CamelModel):
    """會員端的一則訊息。

    ⚠️ **沒有 `senderName`。** 前台只看得到角色（`member` / `admin`），
    由介面把 `admin` 渲染為「客服人員」。
    """

    id: uuid.UUID
    #: `member` 或 `admin`——**由伺服器判定**，前端送出的值一律被忽略（FR-125）
    sender_role: str
    #: 這則訊息是不是我自己送的。由後端判定，前端不必自己比對 id
    mine: bool
    body: str
    read_at: datetime | None
    created_at: datetime

    @classmethod
    def of(cls, message: object, *, viewer_id: uuid.UUID) -> MessageOut:
        return cls(
            id=message.id,  # type: ignore[attr-defined]
            sender_role=message.sender_role,  # type: ignore[attr-defined]
            mine=message.sender_id == viewer_id,  # type: ignore[attr-defined]
            body=message.body,  # type: ignore[attr-defined]
            read_at=message.read_at,  # type: ignore[attr-defined]
            created_at=message.created_at,  # type: ignore[attr-defined]
        )

    @property
    def display_sender(self) -> str:
        """給前端的預設稱呼。管理員一律是「客服人員」。"""
        return SUPPORT_DISPLAY_NAME if self.sender_role == SENDER_ADMIN else "我"


class AdminMessageOut(CamelModel):
    """管理員端的一則訊息。

    ⚠️ 多一個 `senderName`：**管理員端 MUST 看得出每則回覆出自哪一位管理員**
    （FR-127）。任一管理員都能回覆所有討論串，因此接手的人需要知道前一句是誰
    說的——否則同一串裡會出現互相矛盾的答覆而沒有人察覺。
    """

    id: uuid.UUID
    thread_user_id: uuid.UUID
    sender_id: uuid.UUID
    sender_role: str
    sender_name: str | None
    body: str
    read_at: datetime | None
    created_at: datetime


class ThreadSummaryOut(CamelModel):
    """後台的討論串清單（FR-127）。

    ⚠️ **沒有「指派給誰」的欄位，也不會有。** 指派會讓被指派者休假時整串
    無人回覆，而這項功能要解決的正是不漏接（FR-127、models/message.py）。
    """

    user_id: uuid.UUID
    user_name: str | None
    #: 會員送出而尚未被讀的則數——客服的待辦
    unread: int
    last_message_at: datetime | None


class MessageIn(CamelModel):
    """送出一則訊息（FR-123、FR-125）。

    ⚠️ **只有 `body`。** 沒有 `senderRole`，也沒有 `senderId`——那兩者由伺服器
    依 token 判定。做成「有欄位但會被忽略」是不夠的：那讓前端開發者以為自己
    在控制它，而某天有人會依賴那個假設（FR-125、SC-032）。
    """

    body: str = Field(min_length=1, max_length=2000)


__all__ = [
    "SUPPORT_DISPLAY_NAME",
    "AdminMessageOut",
    "MessageIn",
    "MessageOut",
    "ThreadSummaryOut",
]
