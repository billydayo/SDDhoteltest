"""T150：收藏的授權契約（US10、FR-091 ~ FR-095）。

**會員 A 讀取會員 B 的收藏清單 MUST 被拒**，三案例授權皆需覆蓋
（未認證／他人身分／正確身分）。

## 「他人身分」這一格在這裡長什麼樣

其他資源的越權測試是「拿 B 的 id 去打 A 的端點」。收藏沒有這種形狀——
端點上**根本沒有 `userId` 參數**（routers/favorites.py）。因此本檔的越權測試
換一個問法：**A 收藏了東西，B 打同一支端點時看不看得到？**

這個問法更接近真正的風險。若哪天有人把 `list_for(user_id=...)` 的收斂拿掉，
沒有任何 URL 會改變，也不會有 404 或 403——B 只是安靜地看到 A 的收藏。

另外斷言「沒有任何收藏端點接受 userId 參數」：那是這道防線的結構面，
一旦有人為了做「管理員檢視某會員收藏」而加了那個參數，這裡會失敗。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.room import ROOM_MAINTENANCE, Room
from tests.conftest import auth_header


# ---------------------------------------------------------------------------
# 結構層：不需資料庫
# ---------------------------------------------------------------------------
def _favorite_routes() -> list[APIRoute]:
    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, APIRoute):
                yield prefix + route.path, route
            original = getattr(route, "original_router", None)
            if original is not None:
                context = getattr(route, "include_context", None)
                yield from walk(original.routes, prefix + (getattr(context, "prefix", "") or ""))

    return [route for path, route in walk(create_app().routes) if path.startswith("/favorites")]


def test_there_are_favorite_routes() -> None:
    """守住下面那個測試——0 條路由會讓它空轉並全綠。"""
    assert _favorite_routes(), "找不到任何 /favorites 路由"


def test_no_favorite_endpoint_accepts_a_user_id() -> None:
    """**沒有任何收藏端點接受 `userId`**（FR-094）。

    對象一律取自 token。這不是「檢查 userId 等於自己」，而是根本沒有那個參數
    可填——越權因而在介面上不可表達。
    """
    for route in _favorite_routes():
        names = {p.name for p in route.dependant.query_params + route.dependant.path_params}
        forbidden = {"user_id", "userId", "member_id", "memberId"}
        assert not (names & forbidden), f"{route.path} 接受了 {names & forbidden}——這是越權的入口"


# ---------------------------------------------------------------------------
# 執行層：需資料庫
# ---------------------------------------------------------------------------
# 刻意**不設**模組層的 `pytestmark = requires_db`：上面兩個結構層測試不需要
# 資料庫，而模組層的標記會連它們一起跳過——那正是最該在沒有資料庫的環境
# （例如 CI 的快速檢查）也要跑的兩個。
#
# 下面的測試會經由 `client` → `session` → `engine` fixture 自動跳過：
# conftest 的 `engine` 在未設定 `SUNNY_TEST_DATABASE_URL` 時呼叫 `pytest.skip()`。


@pytest_asyncio.fixture
async def client(session, clean_tables) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator:
        yield session

    app.dependency_overrides[get_session] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def room(session) -> Room:
    r = Room(name="海景雙人房", type="雙人房", max_guests=2, nightly_price=3_200, description="")
    session.add(r)
    await session.commit()
    return r


_ENDPOINTS = [("GET", ""), ("POST", "/{id}"), ("DELETE", "/{id}")]
_IDS = [f"{m} /favorites{p}" for m, p in _ENDPOINTS]


@pytest.mark.parametrize(("method", "suffix"), _ENDPOINTS, ids=_IDS)
async def test_unauthenticated_gets_401(client, method: str, suffix: str) -> None:
    """案例一：未認證。**MUST 是 401 而非 403**——前端據此導向登入頁（FR-093）。"""
    path = f"/favorites{suffix.replace('{id}', str(uuid.uuid4()))}"
    res = await client.request(method, path)
    assert res.status_code == 401
    assert res.json()["code"] in {"NOT_AUTHENTICATED", "TOKEN_INVALID"}


@pytest.mark.parametrize(("method", "suffix"), _ENDPOINTS, ids=_IDS)
async def test_authenticated_member_is_not_blocked(
    client, member_token: str, room: Room, method: str, suffix: str
) -> None:
    """案例三：正確身分。一般會員 MUST 能使用自己的收藏。"""
    path = f"/favorites{suffix.replace('{id}', str(room.id))}"
    res = await client.request(method, path, headers=auth_header(member_token))
    assert res.status_code not in (401, 403), f"{method} {path} 回了 {res.status_code}"


async def test_a_member_never_sees_another_members_favorites(
    client, member_token: str, other_member_token: str, room: Room
) -> None:
    """案例二：**他人身分。這是本檔存在的理由**（FR-094、SC-008）。

    A 收藏一間房，B 讀取收藏清單時 MUST 什麼也看不到。

    若 `list_for()` 的 `user_id` 收斂被拿掉，沒有任何 URL 會改變，也不會出現
    404 或 403——B 只是安靜地看到 A 的收藏。這個測試是察覺它的唯一方式。
    """
    added = await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))
    assert added.status_code == 204

    mine = await client.get("/favorites", headers=auth_header(member_token))
    assert [r["id"] for r in mine.json()] == [str(room.id)]

    theirs = await client.get("/favorites", headers=auth_header(other_member_token))
    assert theirs.status_code == 200
    assert theirs.json() == [], "會員 MUST NOT 讀取到其他使用者的收藏（FR-094）"


async def test_a_member_cannot_remove_another_members_favorite(
    client, session, member_token: str, other_member_token: str, room: Room
) -> None:
    """B 對同一間房送出取消收藏，**MUST NOT 影響 A 的收藏**。

    刪除是以 `(user_id, room_id)` 複合鍵執行的，B 的請求只會刪到 B 自己那一列
    （不存在），A 的那一列不受影響。回 204 而非 404 是刻意的——回 404 會讓
    「別人有沒有收藏這間房」變得可以用回應碼探測。
    """
    await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))

    res = await client.delete(f"/favorites/{room.id}", headers=auth_header(other_member_token))
    assert res.status_code == 204

    mine = await client.get("/favorites", headers=auth_header(member_token))
    assert [r["id"] for r in mine.json()] == [str(room.id)], "他人的取消不得影響我的收藏"


# ---------------------------------------------------------------------------
# 行為
# ---------------------------------------------------------------------------
async def test_adding_the_same_room_twice_is_idempotent(
    client, member_token: str, room: Room
) -> None:
    """重複收藏視為成功（FR-091）。

    使用者按了一顆看起來沒生效的星號兩次，不該得到 500——複合主鍵的
    `IntegrityError` 是實作細節，不是使用者的錯。
    """
    first = await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))
    second = await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))

    assert first.status_code == 204
    assert second.status_code == 204

    listed = await client.get("/favorites", headers=auth_header(member_token))
    assert len(listed.json()) == 1, "重複收藏 MUST NOT 在清單中出現兩次"


async def test_favorites_are_newest_first(client, session, member_token: str) -> None:
    """依收藏時間**由新到舊**（FR-092）。"""
    rooms = []
    for i in range(3):
        r = Room(name=f"房 {i}", type="雙人房", max_guests=2, nightly_price=3_000, description="")
        session.add(r)
        rooms.append(r)
    await session.commit()

    for r in rooms:
        res = await client.post(f"/favorites/{r.id}", headers=auth_header(member_token))
        assert res.status_code == 204

    listed = await client.get("/favorites", headers=auth_header(member_token))
    ids = [r["id"] for r in listed.json()]
    assert ids == [str(r.id) for r in reversed(rooms)]


async def test_delisted_room_stays_in_the_list_but_is_marked(
    client, session, member_token: str, room: Room
) -> None:
    """**已下架的房源 MUST NOT 造成錯誤或空白項目**（FR-095）。

    仍然回傳，但帶 `listed: false` 讓前端標示為已下架。自動移除會讓使用者的
    收藏在他沒做任何事的情況下憑空少一筆——而下架通常是暫時的。
    """
    await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))

    room.status = ROOM_MAINTENANCE
    await session.commit()

    listed = await client.get("/favorites", headers=auth_header(member_token))
    assert listed.status_code == 200
    (entry,) = listed.json()
    assert entry["id"] == str(room.id)
    assert entry["listed"] is False


async def test_deleted_room_disappears_from_the_list(
    client, session, member_token: str, room: Room
) -> None:
    """被刪除的房源自動消失，**MUST NOT 留下空白卡片**（FR-095）。

    由 `favorites.room_id` 的 `on delete cascade` 保證——不需要任何應用層程式碼，
    因此也不會有人忘記寫。
    """
    await client.post(f"/favorites/{room.id}", headers=auth_header(member_token))

    await session.delete(room)
    await session.commit()

    listed = await client.get("/favorites", headers=auth_header(member_token))
    assert listed.status_code == 200
    assert listed.json() == []


async def test_favoriting_a_nonexistent_room_is_404(client, member_token: str) -> None:
    """收藏一間不存在的房源 MUST 回 404，而非留下一列指向虛空的收藏。"""
    res = await client.post(f"/favorites/{uuid.uuid4()}", headers=auth_header(member_token))
    assert res.status_code == 404
    assert res.json()["code"] == "ROOM_NOT_FOUND"
