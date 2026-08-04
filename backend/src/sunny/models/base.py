"""ORM 基底與共用欄位型別。

SQLAlchemy 2.0 宣告式風格，全部欄位以 `Mapped[...]` 註記（憲章後端約束：
MUST NOT 使用 1.x 的舊式 `Query` API）。

**模型不是資料庫結構的事實來源。** 事實來源是 Alembic 的遷移歷程
（憲章資料庫約束「事實來源」條）。模型 MUST 與之一致，但 PostgreSQL 特有的
結構——`EXCLUDE USING gist`、trigger、函式——無法由模型完整表達，
它們由遷移腳本以原生 SQL 維護。模型裡看不見不代表它們不存在。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from sqlalchemy import DateTime, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, mapped_column


class Base(DeclarativeBase):
    """全部模型的宣告式基底。"""


#: uuid 主鍵，預設值由資料庫的 `gen_random_uuid()` 產生
uuid_pk = Annotated[
    uuid.UUID,
    mapped_column(PgUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
]

#: uuid 外鍵欄位型別
uuid_fk = Annotated[uuid.UUID, mapped_column(PgUUID(as_uuid=True))]

#: 建立時間，由資料庫的 now() 產生
created_at = Annotated[
    datetime,
    mapped_column(DateTime(timezone=True), server_default=text("now()"), nullable=False),
]
