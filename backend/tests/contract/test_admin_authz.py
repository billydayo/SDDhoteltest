"""T116：後台授權（FR-009、FR-081、SC-008）。

**每個 `/admin/*` 端點皆需三案例：未認證 401、一般會員 403、管理員放行。**
憲章明訂「僅測試 happy path 的授權測試 MUST NOT 被視為已覆蓋」，
而移除 RLS 後 FastAPI 是唯一的存取邊界——這一層漏掉就沒有第二道網。

## 兩層檢查，刻意分開

**結構層**（不需資料庫）：走訪路由樹，斷言每一條 `/admin/*` 路由的相依樹中
都有 `require_admin`。這一層抓的是「新增路由時忘記標註授權」——那種漏洞不會
讓任何既有測試失敗，因為漏標的端點本來就沒有人測它。

**執行層**（需資料庫）：實際打三種身分，確認狀態碼。

只有結構層不夠：`require_admin` 掛著但實作壞掉，結構層仍會過。
只有執行層也不夠：它只涵蓋測試作者想得到的端點，而漏標的那個正是想不到的。
兩層合起來才是「每個端點都測過」。

## 401 與 403 MUST 可區分

未認證是 401，已認證但權限不足是 403。混為一談會讓前端無法決定該導向登入頁
還是顯示無權限——前者對已登入的會員是個無限迴圈（deps.py）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport

from sunny.db import get_session
from sunny.deps import require_admin
from sunny.main import create_app

# 不設模組層的 `pytestmark = pytest.mark.asyncio`：pyproject 已是
# `asyncio_mode = "auto"`，再加會把 asyncio mark 套到本檔的**同步**測試上
# （結構層那兩個不需要事件迴圈），pytest 會逐一發出警告。

#: 這些方法不帶語意，FastAPI 會自動附加，不必逐一驗證。
_IGNORED_METHODS = {"HEAD", "OPTIONS"}


# ---------------------------------------------------------------------------
# 路由盤點
# ---------------------------------------------------------------------------
def _walk(routes: Any, prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    """遞迴走訪路由樹，回傳 `(完整路徑, APIRoute)`。

    ⚠️ 本版 FastAPI 的 `include_router()` **不會把子路由攤平進 `app.routes`**，
    而是包成一個持有 `original_router` 的節點。只看 `app.routes` 會得到零條
    APIRoute——那正是本檔第一次執行時發生的事，被下方的
    `test_there_is_at_least_one_admin_route` 當場抓到。
    """
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        original = getattr(route, "original_router", None)
        if original is not None:
            context = getattr(route, "include_context", None)
            yield from _walk(original.routes, prefix + (getattr(context, "prefix", "") or ""))


def _admin_routes() -> list[tuple[str, APIRoute, str]]:
    """列出全部 `/admin/*` 路由與其方法。

    直接讀應用本身，而不是手寫一份清單——手寫的清單永遠會落後於程式碼，
    而落後的那一條正是沒有人測到的那一條。
    """
    out: list[tuple[str, APIRoute, str]] = []
    for path, route in _walk(create_app().routes):
        if not path.startswith("/admin"):
            continue
        for method in sorted(set(route.methods or ()) - _IGNORED_METHODS):
            out.append((path, route, method))
    return out


def _dependency_callables(dependant: Any) -> Iterator[Any]:
    """遞迴取出相依樹中的全部 callable。

    router 層的 `dependencies=[...]` 會被併進每條路由的 dependant，
    因此掛在 router 上與逐一標註在函式上，在這裡看起來是一樣的。
    """
    if dependant.call is not None:
        yield dependant.call
    for sub in dependant.dependencies:
        yield from _dependency_callables(sub)


ADMIN_ROUTES = _admin_routes()
ROUTE_IDS = [f"{method} {path}" for path, _, method in ADMIN_ROUTES]


def test_there_is_at_least_one_admin_route() -> None:
    """守住這份測試自己。

    若路由註冊或走訪方式被改壞，`_admin_routes()` 會回空清單，下面所有
    parametrize 的測試就**全部消失而不是失敗**——一份 0 個案例的授權測試
    看起來跟全綠一模一樣。
    """
    assert ADMIN_ROUTES, "找不到任何 /admin 路由——路由是否忘了註冊？"


# ---------------------------------------------------------------------------
# 結構層：不需資料庫
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(("path", "route", "method"), ADMIN_ROUTES, ids=ROUTE_IDS)
def test_every_admin_route_declares_require_admin(path: str, route: APIRoute, method: str) -> None:
    """每條 `/admin/*` 路由 MUST 宣告 `require_admin`。

    contracts/README.md：「預設不是『公開』而是『需登入』——新增路由時忘記
    標註 MUST 導致拒絕而非放行。」本測試是那句話的執行版本。
    """
    assert require_admin in set(_dependency_callables(route.dependant)), (
        f"{method} {path} 沒有宣告 require_admin——這是一個公開的後台端點"
    )


# ---------------------------------------------------------------------------
# 執行層：需資料庫
# ---------------------------------------------------------------------------
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


def _concrete(path: str, route: APIRoute) -> str:
    """把 `{room_id}` 這類路徑參數換成一個合法但不存在的 UUID。

    用不存在的 id 是刻意的：授權 MUST 在「資源存不存在」之前判定。
    反過來的話，未授權者可以用回應碼探測哪些 id 存在——404 與 403 的差別
    本身就是一個資源列舉管道。
    """
    for name in route.param_convertors:
        path = path.replace(f"{{{name}}}", str(uuid.uuid4()))
    return path


async def _call(
    client: httpx.AsyncClient, path: str, route: APIRoute, method: str, **kwargs: Any
) -> httpx.Response:
    return await client.request(method, _concrete(path, route), **kwargs)


@pytest.mark.parametrize(("path", "route", "method"), ADMIN_ROUTES, ids=ROUTE_IDS)
async def test_unauthenticated_gets_401(
    client: httpx.AsyncClient, path: str, route: APIRoute, method: str
) -> None:
    """案例一：未認證。"""
    res = await _call(client, path, route, method, json={})
    assert res.status_code == 401, f"{method} {path} 回了 {res.status_code}"
    assert res.json()["code"] in {"NOT_AUTHENTICATED", "TOKEN_INVALID"}


@pytest.mark.parametrize(("path", "route", "method"), ADMIN_ROUTES, ids=ROUTE_IDS)
async def test_member_gets_403(
    client: httpx.AsyncClient, member_token: str, path: str, route: APIRoute, method: str
) -> None:
    """案例二：以他人身分——一般會員。**SC-008 的直接對應。**"""
    res = await _call(client, path, route, method, json={}, headers=_auth(member_token))
    # 訊息帶上回應主體：只印狀態碼的話，401 與 403 之外的意外（例如 500）
    # 得再跑一次才知道原因，而這份測試跑一次要一分多鐘。
    assert res.status_code == 403, f"{method} {path} 回了 {res.status_code}：{res.text}"
    assert res.json()["code"] == "FORBIDDEN"


@pytest.mark.parametrize(("path", "route", "method"), ADMIN_ROUTES, ids=ROUTE_IDS)
async def test_admin_is_not_blocked_by_authorization(
    client: httpx.AsyncClient, admin_token: str, path: str, route: APIRoute, method: str
) -> None:
    """案例三：以正確身分。

    只斷言**不是** 401／403。管理員打一個不存在的 id 本來就該拿到 404，
    送空 body 本來就該拿到 422——那些是別的測試的事。這裡驗的是
    「授權沒有把管理員擋下來」。
    """
    res = await _call(client, path, route, method, json={}, headers=_auth(admin_token))
    assert res.status_code not in (401, 403), (
        f"{method} {path} 把管理員擋下來了（{res.status_code}）"
    )


# ---------------------------------------------------------------------------
# 越權的變體：token 本身有問題
# ---------------------------------------------------------------------------
async def test_malformed_bearer_is_rejected(client: httpx.AsyncClient) -> None:
    for header in (
        {"Authorization": "garbage"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic abc"},
        {"Authorization": "Bearer not.a.jwt"},
    ):
        res = await client.get("/admin/dashboard", headers=header)
        assert res.status_code == 401, f"{header} 回了 {res.status_code}"


async def test_demoted_admin_is_blocked_on_the_next_request(
    client: httpx.AsyncClient, session, admin, admin_token: str
) -> None:
    """降權後**下一個操作**就被擋下（spec Edge Cases「權限即時變更」）。

    `require_admin` 每次都重新查資料庫的 `role`，不信任 token payload 裡簽發
    當下的角色。否則被降權的人能繼續用後台直到 token 過期——而 token 有效期
    是 12 小時。
    """
    assert (await client.get("/admin/dashboard", headers=_auth(admin_token))).status_code == 200

    admin.role = "member"
    await session.flush()

    res = await client.get("/admin/dashboard", headers=_auth(admin_token))
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
