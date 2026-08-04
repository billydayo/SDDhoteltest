"""操作日誌的 API 形狀（FR-114、FR-115、FR-118）。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sunny.schemas.room import CamelModel


class AdminLogOut(CamelModel):
    """一筆操作紀錄。

    ⚠️ **唯讀。** 沒有對應的 `AdminLogIn`——寫入的唯一入口是
    `services/audit.py` 的 `record()`，而它由各業務端點在同一個交易內呼叫
    （FR-114）。一個可以由 API 直接構造的日誌，不叫稽核紀錄。

    `summary` 的內容由 `audit.record()` 把關，MUST NOT 含密碼、秘鑰或真實個資
    （FR-118）。此處原樣輸出，不再過濾——過濾兩次的問題是兩份禁用清單會分歧。
    """

    id: uuid.UUID
    actor_id: uuid.UUID
    #: 操作者顯示名稱。**不含其電子郵件**——那是個資，而日誌是所有管理員
    #: 都讀得到的（FR-118）。
    #:
    #: 預設值 MUST 保留。這個欄位不在 `AdminLog` 模型上（它來自 join 出來的
    #: `profiles.display_name`），而 `of()` 是先 `model_validate(log)` 再
    #: `model_copy` 補上——沒有預設值時驗證會在補值**之前**就以
    #: 「Field required」失敗，`GET /admin/logs` 因而整個 500。
    actor_name: str | None = None
    action: str
    target_table: str
    target_id: str | None
    summary: dict[str, Any]
    created_at: datetime

    @classmethod
    def of(cls, log: object, actor_name: str | None) -> AdminLogOut:
        return cls.model_validate(log).model_copy(update={"actor_name": actor_name})


__all__ = ["AdminLogOut"]
