"""pytest 共用設定與 fixtures。

## 測試資料庫

**MUST 為真正的 PostgreSQL。** 不能以 SQLite 替代：房況保證依賴
`EXCLUDE USING gist` 與 `daterange`，這是 PostgreSQL 特有能力（憲章原則 IV）。
換掉資料庫等於在測試裡拿掉那條保證，**而測試仍會全綠**——那比沒有測試更糟。

以 `SUNNY_TEST_DATABASE_URL` 指定，格式同 `DATABASE_URL`。**未設定時跳過**
需要資料庫的測試，而非連上開發資料庫就地清空它。

## 測試之間如何隔離：外層交易 + savepoint，**不是** truncate

每個測試在自己的連線上開一個交易，session 以
`join_transaction_mode="create_savepoint"` 併入該交易，測試結束一律回滾。
被測程式碼裡的 `session.commit()` 於是變成「釋放 savepoint」——程式不必為了
測試改寫，而**沒有任何一筆資料真的落地**。

前一版是每個測試先 `truncate` 全部資料表。那個做法在這個專案上是壞的：

- `truncate` 需要 AccessExclusiveLock。只要有另一條連線正在寫（並行訂房測試
  就是刻意這樣做的），兩邊就互相等待，實測會出現 deadlock。
- 更難查的是另一半：清理與建立測試資料分屬不同時點與不同連線時，偶爾會發生
  「token 對應的 profile 不見了」——徵狀是一批 401 TOKEN_INVALID 與外鍵違反，
  **每次跑失敗的還是不同的一批**。那不是被測程式的問題，是測試環境自己在
  互相破壞。

回滾隔離沒有這些問題，也不需要對資料庫加任何獨佔鎖，整份測試因而快得多。

⚠️ **需要「資料真的存在於資料庫」的測試不能用這條路。** 並行訂房（另外兩條
連線要看得到房源）與 `admin_logs` 僅可新增（另一個角色要看得到紀錄）都是這種
情況——那兩份測試各自建立會真正提交的資料，並自行清理。

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
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from sunny.models import Profile
from sunny.models.profile import ROLE_ADMIN, ROLE_MEMBER
from sunny.models.room import Room
from sunny.services.auth import create_access_token, hash_password


def _test_database_url() -> str | None:
    """測試資料庫位址：環境變數優先，其次 `backend/.env`。

    只讀 `os.environ` 的話，寫在 `.env` 裡的值不會被看到——應用讀得到、測試讀
    不到，於是「明明設了卻整批跳過」，而跳過是**綠的**，沒有人會發現。
    `.env` 已由 pydantic-settings 載入，這裡沿用同一份來源。

    設定不完整（缺 JWT_SECRET 等）時 `get_settings()` 會拋錯，此時退回「未設定」
    ——那些測試本來就需要完整設定才跑得起來。
    """
    if url := os.environ.get("SUNNY_TEST_DATABASE_URL"):
        return url
    try:
        from sunny.config import get_settings

        return get_settings().sunny_test_database_url or None
    except Exception:
        return None


requires_db = pytest.mark.skipif(
    _test_database_url() is None,
    reason="未設定 SUNNY_TEST_DATABASE_URL，跳過需要資料庫的測試",
)


@pytest_asyncio.fixture(scope="session")
async def engine() -> AsyncIterator:
    url = _test_database_url()
    if url is None:
        pytest.skip("未設定 SUNNY_TEST_DATABASE_URL")

    # 連線池保持小而明確。測試資料庫在 Supabase 上，每建立一條連線都是一次
    # 跨網路往返，關掉池化會讓整份測試多花數十秒；而池化在這裡是安全的，因為
    # 每個測試的連線都以回滾收尾，還回池子時不帶任何交易狀態。
    eng = create_async_engine(url, connect_args={"timeout": 20}, pool_size=5, max_overflow=5)

    # gist 排除約束需要 btree_gist 才能建立。缺了會讓所有房況測試以
    # 「約束不存在」的形式靜默通過——那是最糟的失敗方式。
    async with eng.begin() as conn:
        await conn.execute(text("create extension if not exists btree_gist"))

    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def connection(engine) -> AsyncIterator[AsyncConnection]:
    """一條連線 + 一個**永遠不提交**的外層交易。

    測試結束時回滾，該測試寫進去的一切隨之消失——包含被測程式碼自己
    `commit()` 的部分（見下面 `session` 的說明）。
    """
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            yield conn
        finally:
            # 已經因錯誤而失效的交易不必再回滾一次，否則真正的錯誤會被
            # 這裡的第二個例外蓋掉。
            if transaction.is_active:
                await transaction.rollback()


@pytest_asyncio.fixture
async def session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """併入外層交易的 session。

    `join_transaction_mode="create_savepoint"` 是關鍵：被測程式碼裡的
    `session.commit()`（repository 與路由到處都有）會變成「釋放 savepoint」，
    資料因而停在外層交易裡，等著測試結束一併回滾。

    ⚠️ **MUST NOT 改成綁 engine。** 綁 engine 時每個 `commit()` 都是真的提交，
    測試之間就會互相看見對方的資料——而那類污染的徵狀（偶發的 401、外鍵違反、
    數量對不上）看起來全都像被測程式的問題。
    """
    factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with factory() as s:
        yield s


@pytest_asyncio.fixture
async def clean_tables(session: AsyncSession) -> AsyncIterator[None]:
    """「這個測試需要一個乾淨的資料庫」的宣告。

    ⚠️ **已經不再 truncate，而且刻意不再 truncate。** 乾淨是由 `session` 的外層
    交易保證的：測試看不到別人的資料，因為別人的資料從來沒有提交過（見模組
    說明）。

    保留這個 fixture 而不是從十幾份測試裡刪掉它，有兩個理由：一是那些測試
    確實在宣告「我需要空的資料表」這件事，讀起來仍然正確；二是若日後隔離
    方式再變，換掉這一個地方就好。

    前一版在此處 `truncate ... cascade`。那道敘述要 AccessExclusiveLock，與
    並行訂房測試的另外兩條連線互相等待，實測會 deadlock；而清空與建資料的
    時序一旦交錯，失敗會以「token 對應的 profile 不見了」這種與病因無關的
    形式出現。
    """
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


@pytest_asyncio.fixture
async def room_factory(session: AsyncSession):
    """建立測試房源。

    每次都用新的名稱與 id——訂房測試會在同一個房源上製造衝突，共用一間房會讓
    兩個測試互相干擾，而症狀是「單獨跑會過、一起跑會失敗」這種最難查的形態。
    """

    async def _make(*, nightly_price: int = 2500, max_guests: int = 4, **kwargs) -> Room:
        room = Room(
            name=kwargs.pop("name", f"測試房 {uuid.uuid4().hex[:6]}"),
            type=kwargs.pop("type", "標準雙人房"),
            max_guests=max_guests,
            nightly_price=nightly_price,
            **kwargs,
        )
        session.add(room)
        await session.commit()
        return room

    return _make


def auth_header(token: str) -> dict[str, str]:
    """組出 `Authorization: Bearer <token>` 標頭。"""
    return {"Authorization": f"Bearer {token}"}
