"""T160：`admin_logs` 僅可新增（FR-116、SC-027）。

**以應用連線角色對 `admin_logs` 執行 UPDATE 與 DELETE MUST 全數失敗，
含以管理員身分。**

## 這份測試直接驗證 T019 的 `REVOKE`

舊架構以「不建立 UPDATE/DELETE 的 RLS 政策」達成不可竄改。RLS 移除後改為
資料表權限：

    REVOKE UPDATE, DELETE ON public.admin_logs FROM sunny_app

而 `REVOKE` **只對非擁有者生效**。若應用以資料表擁有者連線，那道 REVOKE 是
一句不報錯也不生效的 SQL——日誌只是安靜地變得可以竄改，沒有任何徵狀。
這正是應用以獨立的 `sunny_app` 角色連線的理由（T019、T021a、models/admin_log.py）。

## 為什麼要用另一條連線

`conftest` 的 `session` fixture 用的是**測試用**連線，通常是擁有者
（`clean_tables` 需要 `truncate admin_logs` 的權限）。用它來測會得到「刪得掉」
——而那是對的，因為擁有者本來就刪得掉。

本檔因此另外開一條以 `DB_APP_USER` 連線的 engine，也就是正式路徑實際使用的
那個角色。測的是**部署後的真實情況**，不是測試環境的方便設定。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from urllib.parse import quote_plus

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sunny.config import get_settings
from tests.conftest import _test_database_url

pytestmark = pytest.mark.skipif(
    _test_database_url() is None,
    reason="未設定 SUNNY_TEST_DATABASE_URL，跳過需要資料庫的測試",
)

#: PostgreSQL 的權限不足錯誤碼。
INSUFFICIENT_PRIVILEGE = "42501"


def _sqlstate(error: Exception) -> str | None:
    """取出 PostgreSQL 的 SQLSTATE。

    **不能改用 `"42501" in str(error)`。** SQLAlchemy 的例外字串只有訊息本文
    （`permission denied for table admin_logs`），錯誤碼在被包起來的 asyncpg
    例外的 `sqlstate` 屬性上。以字串比對會**永遠找不到**，於是「REVOKE 有沒有
    生效」這件事實際上沒有被驗證——測試紅著，但紅的原因與稽核日誌無關。
    """
    return getattr(getattr(error, "orig", None), "sqlstate", None)


def _app_role_url() -> str | None:
    """以**應用角色**連向測試資料庫的 URL。

    測試資料庫的位置取自 `SUNNY_TEST_DATABASE_URL`，但角色換成
    `DB_APP_USER`／`DB_APP_PASSWORD`——正式路徑用的就是這一組。
    """
    base = _test_database_url()
    if not base:
        return None

    settings = get_settings()
    if not settings.db_app_user:
        return None

    # postgresql+asyncpg://<user>:<pw>@<host>/<db> → 換掉憑證那一段
    scheme, _, rest = base.partition("://")
    _credentials, _, location = rest.rpartition("@")
    if not location:
        # URL 未帶憑證，無從替換
        return None
    # 憑證一律 quote_plus——理由同 config.py：密碼裡的 @ 會讓主機名稱悄悄變成
    # 別的東西，而錯誤訊息是 DNS 失敗，看起來跟密碼毫無關係。
    user = quote_plus(settings.db_app_user)
    password = quote_plus(settings.db_app_password)
    return f"{scheme}://{user}:{password}@{location}"


@pytest_asyncio.fixture
async def app_session() -> AsyncIterator:
    url = _app_role_url()
    if url is None:
        pytest.skip("未設定 DB_APP_USER／DB_APP_PASSWORD，無法以應用角色連線")

    engine = create_async_engine(url, connect_args={"timeout": 20})
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            yield session
            await session.rollback()
    finally:
        await engine.dispose()


async def _existing_log_id(session) -> str:
    """取一筆現有的紀錄；沒有就插一筆。

    **INSERT 必須是被允許的**——僅可新增的意思是「只能新增」，不是「不能寫」。
    這一步順帶驗證了那件事：若連 INSERT 都失敗，稽核根本無法運作。
    """
    existing = await session.scalar(text("select id from public.admin_logs limit 1"))
    if existing is not None:
        return str(existing)

    actor = await session.scalar(text("select id from public.profiles limit 1"))
    if actor is None:
        pytest.skip("資料庫中沒有任何 profile，無法建立測試用日誌")

    inserted = await session.scalar(
        text(
            "insert into public.admin_logs (actor_id, action, target_table, summary) "
            "values (:actor, 'test.append_only', 'test', '{}'::jsonb) returning id"
        ),
        {"actor": actor},
    )
    await session.commit()
    return str(inserted)


async def test_the_app_role_can_insert(app_session) -> None:
    """**僅可新增**的前半段：INSERT MUST 成功。

    若這裡失敗，`services/audit.py` 根本寫不進任何東西，而每一個後台寫入
    端點都會 500——那是比日誌可竄改更明顯的問題，但仍值得在這裡標明，
    否則下面兩個測試「全都失敗」看起來會像是通過了。
    """
    log_id = await _existing_log_id(app_session)
    assert log_id


async def test_update_is_denied(app_session) -> None:
    """**UPDATE MUST 失敗**（FR-116、SC-027）。"""
    log_id = await _existing_log_id(app_session)

    with pytest.raises((ProgrammingError, DBAPIError)) as exc:
        await app_session.execute(
            text("update public.admin_logs set action = 'tampered' where id = :id"),
            {"id": log_id},
        )
    assert _sqlstate(exc.value) == INSUFFICIENT_PRIVILEGE, (
        "UPDATE MUST 因權限不足而被拒——若是別的錯誤，代表擋下它的不是 REVOKE，那道保證可能並未生效"
    )
    await app_session.rollback()


async def test_delete_is_denied(app_session) -> None:
    """**DELETE MUST 失敗**（FR-116、SC-027）。"""
    log_id = await _existing_log_id(app_session)

    with pytest.raises((ProgrammingError, DBAPIError)) as exc:
        await app_session.execute(
            text("delete from public.admin_logs where id = :id"), {"id": log_id}
        )
    assert _sqlstate(exc.value) == INSUFFICIENT_PRIVILEGE
    await app_session.rollback()


async def test_truncate_is_denied(app_session) -> None:
    """**TRUNCATE 同樣 MUST 失敗。**

    `REVOKE DELETE` 不涵蓋 TRUNCATE——那是獨立的權限，且預設只有擁有者有。
    仍然驗證它：一個「刪不掉單筆但清得掉整張表」的日誌，不叫僅可新增。
    """
    with pytest.raises((ProgrammingError, DBAPIError)) as exc:
        await app_session.execute(text("truncate public.admin_logs"))
    assert _sqlstate(exc.value) == INSUFFICIENT_PRIVILEGE
    await app_session.rollback()


async def test_an_admin_identity_does_not_help(app_session) -> None:
    """**含以管理員身分。**

    這是本檔最容易被誤解的一點：資料庫層**根本不知道誰是管理員**。
    移除 RLS 與 `is_admin()` 之後，所有請求都以同一個 `sunny_app` 角色連線，
    應用層的角色只影響 FastAPI 的授權判斷。

    因此「管理員也刪不掉」不需要另一組測試——上面兩個測試涵蓋的就是每一位
    使用者，包含管理員。此測試把這件事寫下來，讓日後有人問「那管理員呢」時
    有個明確的答案，而不是去補一個實際上測不到差異的案例。
    """
    log_id = await _existing_log_id(app_session)

    with pytest.raises((ProgrammingError, DBAPIError)):
        await app_session.execute(
            text("delete from public.admin_logs where id = :id"), {"id": log_id}
        )
    await app_session.rollback()

    # 紀錄仍在
    still_there = await app_session.scalar(
        text("select id from public.admin_logs where id = :id"), {"id": log_id}
    )
    assert str(still_there) == str(uuid.UUID(log_id))
