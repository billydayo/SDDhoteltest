"""非同步 engine 與 session。

憲章後端約束：所有資料庫存取 MUST 走非同步 session，**MUST NOT 在同一應用中
混用同步 engine**。本模組是全應用唯一建立 engine 的地方。

連線以 `sunny_app` 身分建立（非擁有者）——見 config.py 對雙角色的說明。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from sunny.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """取得全應用共用的 engine（惰性建立）。"""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            # 托管於 Supabase 的 Session pooler：連線數有限，池子不宜過大
            pool_size=5,
            max_overflow=5,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 相依：每個請求一個 session，結束時關閉。

    **交易邊界屬於 repository 與 service 層**，不在此處自動提交——管理員的變更
    MUST 與其稽核紀錄在同一個交易內完成（憲章資料存取規則），把 commit 藏在
    這裡會讓那個保證難以維持。
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """關閉連線池。供應用關閉時與測試清理使用。"""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
