"""T065a：個人檔案端點的授權三案例（FR-081）。

憲章明訂「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」。
**移除 RLS 後 FastAPI 是唯一的存取邊界**，這一層漏掉就沒有第二道網。

三個案例：未認證、以他人身分、以正確身分。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

from sunny.db import get_session
from sunny.main import create_app

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 未認證
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("method", ["get", "patch"])
async def test_unauthenticated_is_rejected(client: httpx.AsyncClient, method: str) -> None:
    res = await getattr(client, method)("/me", **({"json": {}} if method == "patch" else {}))
    assert res.status_code == 401


async def test_malformed_bearer_is_rejected(client: httpx.AsyncClient) -> None:
    for header in (
        {"Authorization": "garbage"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic abc"},
    ):
        assert (await client.get("/me", headers=header)).status_code == 401


# ---------------------------------------------------------------------------
# 以他人身分：/me 的身分來自 token，**不來自任何請求參數**
# ---------------------------------------------------------------------------
async def test_each_token_only_ever_sees_its_own_profile(
    client: httpx.AsyncClient, member, other_member, member_token, other_member_token
) -> None:
    """越權在此端點**結構上不可表達**。

    沒有 `/users/{id}`，身分只來自 token，因此不存在「換一個 id 試試看」
    這個動作（FR-081）。本測試確認這個設計確實成立。
    """
    mine = await client.get("/me", headers=_auth(member_token))
    theirs = await client.get("/me", headers=_auth(other_member_token))

    assert mine.json()["id"] == str(member.id)
    assert theirs.json()["id"] == str(other_member.id)
    assert mine.json()["id"] != theirs.json()["id"]


async def test_updating_with_one_token_does_not_touch_another_account(
    client: httpx.AsyncClient, other_member, member_token, other_member_token
) -> None:
    before = (await client.get("/me", headers=_auth(other_member_token))).json()["displayName"]

    await client.patch("/me", headers=_auth(member_token), json={"displayName": "被改到了嗎"})

    after = (await client.get("/me", headers=_auth(other_member_token))).json()["displayName"]
    assert after == before


# ---------------------------------------------------------------------------
# 以正確身分
# ---------------------------------------------------------------------------
async def test_authenticated_can_read_own_profile(client: httpx.AsyncClient, member_token) -> None:
    res = await client.get("/me", headers=_auth(member_token))
    assert res.status_code == 200
    assert set(res.json()) == {"id", "email", "role", "displayName", "phone", "createdAt"}


async def test_response_never_contains_password_or_google_sub(
    client: httpx.AsyncClient, member_token
) -> None:
    """`ProfileOut` 明列欄位，MUST NOT 把 ORM 物件全欄位倒出去。

    前一版靠「資料表根本沒有密碼欄位」保證這件事；那層保護已經沒有了。
    """
    body = (await client.get("/me", headers=_auth(member_token))).text.lower()
    assert "password" not in body
    assert "google_sub" not in body and "googlesub" not in body


async def test_role_cannot_be_escalated_through_this_endpoint(
    client: httpx.AsyncClient, member_token
) -> None:
    """⚠️ 原 `prevent_role_escalation()` trigger 的職責。

    它依賴 `is_admin()` → `auth.uid()`，隨 Supabase Auth 一併移除；
    現在改由「`ProfileUpdateIn` 沒有 `role` 欄位」保證（data-model.md）。
    """
    await client.patch("/me", headers=_auth(member_token), json={"role": "admin"})
    assert (await client.get("/me", headers=_auth(member_token))).json()["role"] == "member"
