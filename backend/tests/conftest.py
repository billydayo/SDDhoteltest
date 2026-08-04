"""pytest 共用設定與 fixtures。

## 測試資料庫

**MUST 為真正的 PostgreSQL。** 不能以 SQLite 替代：房況保證依賴
`EXCLUDE USING gist` 與 `daterange`，這是 PostgreSQL 特有能力（憲章原則 IV）。
換掉資料庫等於在測試裡拿掉那條保證，**而測試仍會全綠**——那比沒有測試更糟。

以 `SUNNY_TEST_DATABASE_URL` 指定，格式同 `DATABASE_URL`。**未設定時跳過**
需要資料庫的測試，而非連上開發資料庫就地清空它。

## 三種身分

契約測試 MUST 涵蓋每個受保護端點的三個案例（憲章自動化測試節、research R9）：

- `member_token`      正確身分
- `other_member_token` **他人身分**——越權存取的那一格
- `admin_token`       管理員

「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」。移除 RLS 後，
FastAPI 是唯一的存取邊界，這一層漏掉就沒有第二道網。
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sunny.models import Base, Profile
from sunny.models.profile import ROLE_ADMIN, ROLE_MEMBER
from sunny.services.auth import create_access_token, hash_password


def _test_database_url() -> str | None:
    return os.environ.get("SUNNY_TEST_DATABASE_URL") or None


requires_db = pytest.mark.skipif(
    _test_database_url() is None,
    reason="未設定 SUNNY_TEST_DATABASE_URL，跳過需要資料庫的測試",
)


@pytest_asyncio.fixture(scope="session")
async def engine() -> AsyncIterator:
    url = _test_database_url()
    if url is None:
        pytest.skip("未設定 SUNNY_TEST_DATABASE_URL")

    eng = create_async_engine(url, connect_args={"timeout": 20})

    # gist 排除約束需要 btree_gist 才能建立。缺了會讓所有房況測試以
    # 「約束不存在」的形式靜默通過——那是最糟的失敗方式。
    async with eng.begin() as conn:
        await conn.execute(text("create extension if not exists btree_gist"))

    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    """每個測試一個 session，結束後回滾。

    以外層交易 + 回滾隔離，測試之間不互相污染，也不需要在每個測試裡清資料。
    """
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
        await s.rollback()


@pytest_asyncio.fixture
async def clean_tables(session: AsyncSession) -> AsyncIterator[None]:
    """清空全部業務資料表。

    `admin_logs` 也在此列——測試資料庫**必須**由具備 DELETE 權限的角色連線
    （通常是擁有者）。這與正式路徑刻意不同：正式的應用角色被 REVOKE 掉
    UPDATE/DELETE，而 T160 正是要驗證那道 REVOKE 確實生效。
    """
    tables = [t.name for t in reversed(Base.metadata.sorted_tables)]
    await session.execute(text(f"truncate {', '.join(tables)} restart identity cascade"))
    await session.commit()
    yield


async def _make_profile(session: AsyncSession, *, role: str, suffix: str) -> Profile:
    profile = Profile(
        email=f"test-{suffix}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=hash_password("test-password"),
        role=role,
        display_name=f"測試{suffix}",
    )
    session.add(profile)
    await session.commit()
    return profile


@pytest_asyncio.fixture
async def member(session: AsyncSession) -> Profile:
    return await _make_profile(session, role=ROLE_MEMBER, suffix="member")


@pytest_asyncio.fixture
async def other_member(session: AsyncSession) -> Profile:
    """**另一位**會員。越權測試的關鍵——沒有它就只能測 happy path。"""
    return await _make_profile(session, role=ROLE_MEMBER, suffix="other")


@pytest_asyncio.fixture
async def admin(session: AsyncSession) -> Profile:
    return await _make_profile(session, role=ROLE_ADMIN, suffix="admin")


@pytest.fixture
def member_token(member: Profile) -> str:
    return create_access_token(member.id, member.role)


@pytest.fixture
def other_member_token(other_member: Profile) -> str:
    return create_access_token(other_member.id, other_member.role)


@pytest.fixture
def admin_token(admin: Profile) -> str:
    return create_access_token(admin.id, admin.role)


def auth_header(token: str) -> dict[str, str]:
    """組出 `Authorization: Bearer <token>` 標頭。"""
    return {"Authorization": f"Bearer {token}"}
