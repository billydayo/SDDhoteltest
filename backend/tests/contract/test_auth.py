"""T062／T064：註冊與登入的契約（FR-002、FR-004、FR-009b、FR-088、SC-025）。

需要資料庫。未設定 `SUNNY_TEST_DATABASE_URL` 時整檔跳過。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport
from sqlalchemy import func, select

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.profile import Profile

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    """以測試 session 覆寫應用的資料庫相依。"""
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _new_email() -> str:
    return f"contract-{uuid.uuid4().hex[:10]}@example.com"


# ---------------------------------------------------------------------------
# 註冊（FR-002、FR-009b）
# ---------------------------------------------------------------------------
async def test_register_returns_201_and_token(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/auth/register",
        json={"email": _new_email(), "password": "secret123", "displayName": "測試"},
    )
    assert res.status_code == 201
    assert "accessToken" in res.json()


async def test_register_never_returns_password_hash(client: httpx.AsyncClient) -> None:
    """FR-009a：密碼雜湊 MUST NOT 出現在任何 API 回應中。"""
    res = await client.post(
        "/auth/register",
        json={"email": _new_email(), "password": "secret123", "displayName": "測試"},
    )
    assert "password" not in res.text.lower()


async def test_duplicate_email_returns_409(client: httpx.AsyncClient) -> None:
    email = _new_email()
    body = {"email": email, "password": "secret123", "displayName": "測試"}
    assert (await client.post("/auth/register", json=body)).status_code == 201

    res = await client.post("/auth/register", json=body)
    assert res.status_code == 409
    assert res.json()["code"] == "EMAIL_TAKEN"


async def test_short_password_returns_400(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/auth/register",
        json={"email": _new_email(), "password": "12345", "displayName": "測試"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "PASSWORD_TOO_SHORT"


async def test_email_is_case_insensitive_for_duplicates(client: httpx.AsyncClient) -> None:
    """`Foo@x.com` 與 `foo@x.com` 是同一個信箱。

    若區分大小寫，同一個人能註冊兩次，而 FR-088 的「進入既有帳號」會在
    大小寫不同時失效——使用者會發現訂單不見了。
    """
    local = uuid.uuid4().hex[:10]
    await client.post(
        "/auth/register",
        json={"email": f"{local}@example.com", "password": "secret123", "displayName": "A"},
    )
    res = await client.post(
        "/auth/register",
        json={"email": f"{local.upper()}@EXAMPLE.COM", "password": "secret123", "displayName": "B"},
    )
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# 登入（FR-004）
# ---------------------------------------------------------------------------
async def test_login_succeeds_with_correct_credentials(client: httpx.AsyncClient) -> None:
    email = _new_email()
    await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "displayName": "測試"},
    )
    res = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert res.status_code == 200


async def test_both_login_failures_are_indistinguishable(client: httpx.AsyncClient) -> None:
    """⚠️ **FR-004 的核心。**

    「帳號不存在」與「密碼錯誤」的訊息與狀態碼 MUST 完全相同，
    MUST NOT 透露該電子郵件是否已註冊。
    """
    email = _new_email()
    await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "displayName": "測試"},
    )

    wrong_password = await client.post(
        "/auth/login", json={"email": email, "password": "not-the-password"}
    )
    no_such_account = await client.post(
        "/auth/login", json={"email": _new_email(), "password": "not-the-password"}
    )

    assert wrong_password.status_code == no_such_account.status_code == 401
    assert wrong_password.json() == no_such_account.json()


async def test_google_only_account_gets_its_own_message(client: httpx.AsyncClient, session) -> None:
    """`password_hash is null` MUST 走獨立分支。

    落入一般的比對失敗分支會讓使用者反覆嘗試一個從來不存在的密碼
    （data-model.md）。
    """
    email = _new_email()
    session.add(
        Profile(
            email=email, password_hash=None, google_sub=f"g-{uuid.uuid4().hex}", display_name="G"
        )
    )
    await session.commit()

    res = await client.post("/auth/login", json={"email": email, "password": "anything"})
    assert res.status_code == 401
    assert res.json()["code"] == "USE_GOOGLE_LOGIN"


# ---------------------------------------------------------------------------
# Google 登入（FR-088、FR-090、SC-025）
# ---------------------------------------------------------------------------
async def test_cancelling_at_google_creates_no_account(client: httpx.AsyncClient, session) -> None:
    """FR-090：使用者取消時 MUST NOT 建立任何帳號，且 MUST 送回登入頁。

    ⚠️ 回 400 JSON 是不夠的。抵達這裡的是**瀏覽器導覽**——使用者按了 Google
    授權畫面上的「取消」，他的視窗現在停在這個網址上。回一段 JSON 等於把他
    留在一頁原始資料前面，沒有任何路可以回去。
    """
    before = await session.scalar(select(func.count()).select_from(Profile))

    res = await client.get(
        "/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )

    assert res.status_code == 303, res.text
    location = res.headers["location"]
    assert "/login" in location
    assert "GOOGLE_CANCELLED" in location
    assert await session.scalar(select(func.count()).select_from(Profile)) == before


async def test_google_login_with_existing_email_does_not_create_a_second_account(
    client: httpx.AsyncClient, session, monkeypatch
) -> None:
    """⚠️ **FR-088／SC-025——最容易在重構中失守的一條。**

    失守的表現不是錯誤訊息，而是使用者「登入後訂單不見了」，
    因為他進到了一個新建的空帳號。沒有任何日誌會記下這件事。
    """
    email = _new_email()
    await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "displayName": "原帳號"},
    )
    before = await session.scalar(select(func.count()).select_from(Profile))

    # 繞過真實的 Google 往返：這裡驗的是「帳號比對與綁定」，不是 OAuth 協定
    async def fake_exchange(code: str) -> dict[str, str]:
        return {"email": email.upper(), "sub": "google-sub-123", "name": "Google 名稱"}

    monkeypatch.setattr("sunny.routers.auth._exchange_code_for_userinfo", fake_exchange)

    res = await client.get(
        "/auth/google/callback", params={"code": "fake-code"}, follow_redirects=False
    )

    assert res.status_code == 303, res.text
    # **帳號總數不變**——進入既有帳號，而非建立第二筆
    assert await session.scalar(select(func.count()).select_from(Profile)) == before

    profile = await session.scalar(select(Profile).where(func.lower(Profile.email) == email))
    assert profile is not None
    assert profile.google_sub == "google-sub-123"
    assert profile.display_name == "原帳號", "既有的顯示名稱不該被 Google 的覆寫"


async def test_the_token_travels_in_the_fragment_never_the_query(
    client: httpx.AsyncClient, session, monkeypatch
) -> None:
    """⚠️ **access token MUST 放在 URL 片段，MUST NOT 放在查詢字串。**

    片段（`#` 之後）不會被送到任何伺服器：不進 access log、不進 `Referer`
    標頭、不會被反向代理或 CDN 記錄。放在 `?accessToken=` 裡則是把它寫進
    沿途每一台機器的日誌，而日誌的保存期限通常比 token 長得多。

    兩種寫法在畫面上完全一樣——登入都會成功，所以只有測試擋得住。
    """
    email = _new_email()
    await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "displayName": "原帳號"},
    )

    async def fake_exchange(code: str) -> dict[str, str]:
        return {"email": email, "sub": "google-sub-frag", "name": "G"}

    monkeypatch.setattr("sunny.routers.auth._exchange_code_for_userinfo", fake_exchange)

    res = await client.get(
        "/auth/google/callback", params={"code": "fake-code"}, follow_redirects=False
    )

    location = res.headers["location"]
    head, _, fragment = location.partition("#")
    assert "accessToken" in fragment, f"token 不在片段裡：{location}"
    assert "accessToken" not in head, f"token 洩漏到查詢字串：{head}"
    assert "/auth/callback" in head
