"""T161：操作日誌的讀取契約（FR-117、FR-118）。

1. **非管理員讀取操作日誌 MUST 取不到任何紀錄。**
2. **日誌內容 MUST NOT 含密碼、金鑰或真實個資。**

## 第 1 點為什麼是「取不到」而非「回空陣列」

回 403。空陣列會讓前端無法分辨「沒有權限」與「還沒有任何操作」，而後者在
全新的系統裡是正常狀態——一般會員看到空清單會以為自己有權限只是沒資料。

## 第 2 點測的是 `audit.record()` 的守門，不是巡邏

`services/audit.py` 在寫入時就拒絕含敏感鍵的 summary，且是**拋例外而非靜默
過濾**。靜默過濾會讓呼叫端以為自己記錄了那個欄位，而下次有人換個鍵名就漏
過去。本檔驗證那道守門真的會擋，以及既有的稽核紀錄中確實沒有那些東西。
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
from sunny.services import audit
from sunny.services.audit import AuditError
from tests.conftest import auth_header


# ---------------------------------------------------------------------------
# 結構層：不需資料庫
# ---------------------------------------------------------------------------
def _log_routes() -> list[tuple[str, APIRoute]]:
    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, APIRoute):
                yield prefix + route.path, route
            original = getattr(route, "original_router", None)
            if original is not None:
                context = getattr(route, "include_context", None)
                yield from walk(original.routes, prefix + (getattr(context, "prefix", "") or ""))

    return [(p, r) for p, r in walk(create_app().routes) if p.startswith("/admin/logs")]


def test_log_routes_exist() -> None:
    assert _log_routes(), "找不到 /admin/logs 路由"


def test_no_write_endpoint_exists_for_logs() -> None:
    """**MUST NOT 提供任何 UPDATE 或 DELETE 端點**（FR-114、contracts/README.md）。

    資料表權限（T019）才是保證，但那道保證在**執行期**才會顯現。這個測試讓
    「有人加了一支寫入端點」在 CI 就被擋下來，而不是等到某位管理員按下按鈕
    收到 500 才發現。
    """
    for path, route in _log_routes():
        methods = set(route.methods or ()) - {"HEAD", "OPTIONS"}
        assert methods <= {"GET"}, f"{path} 提供了 {methods - {'GET'}}——操作日誌僅可新增"


def test_audit_module_exposes_no_mutation_helpers() -> None:
    """`services/audit.py` **只有 `record()`**，沒有更新或刪除的函式。

    第二層防線（routers/admin_logs.py 的模組說明）。沒有寫入路徑，
    就沒有人能不小心用到它。
    """
    exported = set(audit.__all__)
    assert "record" in exported
    for forbidden in ("update", "delete", "remove", "purge", "clear"):
        assert not any(forbidden in name.lower() for name in exported), (
            f"audit 模組匯出了含 '{forbidden}' 的名稱——日誌僅可新增"
        )


# ---------------------------------------------------------------------------
# FR-118：敏感內容的守門
# ---------------------------------------------------------------------------
class _ExplodingSession:
    """任何寫入嘗試都會失敗。含敏感欄位的紀錄 MUST 在碰到資料庫之前就被擋下。"""

    def add(self, *_: object) -> None:  # pragma: no cover - 不該走到
        raise AssertionError("含敏感欄位的稽核紀錄 MUST NOT 被寫入")

    async def flush(self) -> None:  # pragma: no cover - 不該走到
        raise AssertionError("含敏感欄位的稽核紀錄 MUST NOT 被寫入")


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "password_hash",
        "new_password",
        "token",
        "secret",
        "api_key",
        "card_number",
        # 大小寫是最省力的繞過方式，而它在程式碼審查時看起來完全正常
        "Password",
        "PASSWORD",
        "Api_Key",
    ],
)
async def test_audit_rejects_sensitive_keys(key: str) -> None:
    """**MUST NOT 記錄密碼、金鑰或真實個資**（FR-118）。

    不需要資料庫：守門在 `_assert_no_sensitive_keys()`，於任何 I/O 之前。
    **拋例外而非靜默過濾**——靜默過濾會讓呼叫端以為自己記錄了那個欄位，
    而下次有人換個鍵名就漏過去（services/audit.py）。
    """
    with pytest.raises(AuditError):
        await audit.record(
            _ExplodingSession(),  # type: ignore[arg-type]
            actor_id=uuid.uuid4(),
            action="test",
            target_table="test",
            summary={key: "值"},
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


async def test_unauthenticated_gets_401(client) -> None:
    res = await client.get("/admin/logs")
    assert res.status_code == 401


async def test_member_gets_403_not_an_empty_list(client, member_token: str) -> None:
    """**非管理員 MUST 取不到任何紀錄**（FR-117）。

    ⚠️ MUST 是 403，**MUST NOT 是空陣列**。空陣列讓前端無法分辨「沒有權限」
    與「還沒有任何操作」，而後者在全新的系統裡是正常狀態——一般會員會以為
    自己有權限，只是碰巧沒資料。
    """
    res = await client.get("/admin/logs", headers=auth_header(member_token))
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    assert not isinstance(res.json().get("detail"), list)


async def test_admin_can_read_logs(client, session, admin, admin_token: str) -> None:
    """管理員讀得到，且**由新到舊**（FR-115）。"""
    for i in range(3):
        await audit.record(
            session,
            actor_id=admin.id,
            action=f"test.action{i}",
            target_table="rooms",
            summary={"index": i},
        )
        # ⚠️ 每一筆各自提交。`created_at` 的預設是 `now()`，而 `now()` 是**交易
        # 開始的時間**——三筆寫在同一個交易裡會拿到完全相同的時間戳，「由新到舊」
        # 於是無序可言，排序結果隨執行計畫變動。真實情況本來就是一次請求一筆。
        await session.commit()

    res = await client.get("/admin/logs", headers=auth_header(admin_token))
    assert res.status_code == 200
    actions = [row["action"] for row in res.json()]
    assert actions == ["test.action2", "test.action1", "test.action0"]


async def test_logs_can_be_filtered_by_action_prefix(
    client, session, admin, admin_token: str
) -> None:
    """動作以**前綴**比對——日誌的動作命名是分層的（`review.reply.create`）。

    只能精確比對的話，使用者得先知道有哪些子動作才查得到東西。
    """
    for action in ("review.approve", "review.reply.create", "room.update"):
        await audit.record(session, actor_id=admin.id, action=action, target_table="t", summary={})
    await session.commit()

    res = await client.get("/admin/logs?action=review", headers=auth_header(admin_token))
    assert {row["action"] for row in res.json()} == {"review.approve", "review.reply.create"}


async def test_log_output_never_contains_the_actor_email(
    client, session, admin, admin_token: str
) -> None:
    """輸出中 MUST 有操作者姓名，**MUST NOT 有其電子郵件**（FR-118）。

    日誌是所有管理員都讀得到的。姓名足以辨識是誰，電子郵件則是可用來登入
    或聯繫的個資——多帶它沒有增加任何稽核價值。
    """
    await audit.record(session, actor_id=admin.id, action="test.x", target_table="t", summary={})
    await session.commit()

    res = await client.get("/admin/logs", headers=auth_header(admin_token))
    (row,) = res.json()

    assert row["actorName"] == admin.display_name
    assert admin.email not in str(row)
    assert "email" not in row


async def test_no_stored_log_contains_a_password_hash(
    client, session, admin, admin_token: str
) -> None:
    """既有紀錄中不得出現密碼雜湊的特徵字串（FR-118）。

    `_assert_no_sensitive_keys` 擋的是**鍵名**；這裡掃的是**值**——
    有人把整個 profile 物件序列化進 summary 時，鍵名可能叫 `user`。
    """
    await audit.record(
        session,
        actor_id=admin.id,
        action="user.update",
        target_table="profiles",
        target_id=admin.id,
        summary={"fields": ["displayName"]},
    )
    await session.commit()

    res = await client.get("/admin/logs", headers=auth_header(admin_token))
    body = str(res.json())

    assert "argon2" not in body, "日誌中出現了密碼雜湊的演算法標記"
    assert admin.password_hash not in body
    assert admin.email not in body
