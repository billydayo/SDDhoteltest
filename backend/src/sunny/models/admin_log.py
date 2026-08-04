"""admin_logs — 管理員操作稽核日誌。**僅可新增。**

⚠️ **此模型刻意沒有任何更新或刪除的用法，且資料庫端已把權限收回。**

任何角色（含管理員本人）都 MUST NOT 能修改或刪除既有紀錄（FR-116、SC-027）。
舊架構以「不建立 UPDATE/DELETE 的 RLS 政策」達成；RLS 移除後改以資料表權限：

    REVOKE UPDATE, DELETE ON public.admin_logs FROM sunny_app

而 REVOKE **只對非擁有者生效**——這正是應用以獨立的 `sunny_app` 角色連線、
而非以資料表擁有者連線的理由（T019、T021a）。若應用以擁有者連線，那道
REVOKE 是一句不報錯也不生效的 SQL，日誌只是安靜地變得可以竄改。

日誌 MUST NOT 記錄密碼、秘鑰或任何真實個資（FR-118）。匯出功能寫入日誌時
MUST 只記模組、筆數與格式，**MUST NOT 含任何一列的實際內容**（FR-058a）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk


class AdminLog(Base):
    __tablename__ = "admin_logs"

    id: Mapped[uuid_pk]
    #: `on delete restrict`：留有日誌的管理員帳號不可被刪除，否則稽核紀錄
    #: 會失去操作者。
    actor_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_table: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 變更摘要。MUST NOT 含密碼、秘鑰或真實個資（FR-118）。
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[created_at]


__all__ = ["AdminLog"]
