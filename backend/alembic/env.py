"""Alembic 執行環境。

兩個重點：

1. **連線字串來自 pydantic-settings，不是 alembic.ini。**
   憲章禁止把憑證寫進版控中的檔案（FR-085、SC-022）。

2. **遷移以「擁有者」身分連線**（`migration_database_url`），不是應用的
   `sunny_app`。遷移要建立資料表、函式、擴充與 `sunny_app` 角色本身，
   這些都需要擁有者權限；而應用刻意以非擁有者連線，好讓
   `REVOKE UPDATE, DELETE ON admin_logs` 真的生效（見 config.py 的說明）。
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config, create_async_engine

from sunny.config import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# target_metadata
# ---------------------------------------------------------------------------
# 目前為 None：初始 revision 完全以原生 SQL 撰寫（op.execute），不倚賴
# autogenerate。憲章資料庫約束明訂 autogenerate **偵測不到** RLS 政策、trigger、
# 函式與 EXCLUDE USING gist 約束，且**可能產生刪除它們的敘述**——而
# `orders_no_overlap` 一旦被靜默移除，超賣不會報錯，只會安靜地發生。
#
# 待 T023–T027 的 ORM 模型建立後，此處會改指向 Base.metadata 供日後的遷移
# 產生初稿，但輸出仍 MUST 逐行人工審閱（research R2）。
target_metadata = None


def _database_url() -> str:
    return get_settings().migration_database_url


def run_migrations_offline() -> None:
    """離線模式：只產生 SQL，不連線。"""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(_database_url(), poolclass=None)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()


__all__ = ["async_engine_from_config"]  # 保留 import 以符合 alembic 樣板慣例
