"""T166：私訊的授權與身分契約（FR-123 ~ FR-128、SC-032）。

1. **會員 MUST NOT 能讀寫他人的討論串。**
2. **發話者身分與角色 MUST 由伺服器判定；前端送出的 `senderRole` MUST 被忽略。**

## 第 2 點為什麼是這個功能最要緊的一條

會員的討論串**本來就屬於他**——權限規則允許他寫入。若角色由請求主體決定，
他就能在自己那一串裡插入一則 `senderRole: "admin"` 的訊息，看起來像官方回覆。

擋住這件事的不是授權，是「角色不由他決定」。而驗證它的方式必須是**真的送出
那個欄位**再確認它沒有生效——只讀程式碼會看到 `MessageIn` 沒有那個欄位，
但 Pydantic 預設會靜默丟棄未知欄位，那與「拒絕」看起來一樣，實際上不同。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport
from sqlalchemy import select

from sunny.db import get_session
from sunny.main import create_app
from sunny.models.message import SENDER_ADMIN, SENDER_MEMBER, Message
from tests.conftest import auth_header


# ---------------------------------------------------------------------------
# 結構層：不需資料庫
# ---------------------------------------------------------------------------
def _routes(prefix: str) -> list[tuple[str, APIRoute]]:
    def walk(routes, base=""):
        for route in routes:
            if isinstance(route, APIRoute):
                yield base + route.path, route
            original = getattr(route, "original_router", None)
            if original is not None:
                context = getattr(route, "include_context", None)
                yield from walk(original.routes, base + (getattr(context, "prefix", "") or ""))

    return [(p, r) for p, r in walk(create_app().routes) if p.startswith(prefix)]


def test_member_message_routes_exist() -> None:
    assert _routes("/messages"), "找不到 /messages 路由"


def test_no_member_endpoint_accepts_a_thread_identifier() -> None:
    """**會員端沒有任何端點接受討論串識別**（FR-126）。

    討論串一律是呼叫者自己那一串，`thread_user_id` 取自 token。不是「檢查
    threadId 等於自己」，而是根本沒有那個參數可填——越權因而不可表達。
    """
    forbidden = {"thread_user_id", "threadUserId", "user_id", "userId", "thread_id", "threadId"}
    for path, route in _routes("/messages"):
        names = {p.name for p in route.dependant.query_params + route.dependant.path_params}
        assert not (names & forbidden), f"{path} 接受了 {names & forbidden}——這是越權的入口"


def test_message_input_schema_has_no_sender_fields() -> None:
    """**`MessageIn` 只有 `body`**（FR-125、SC-032）。

    做成「有欄位但會被忽略」是不夠的：那讓前端開發者以為自己在控制它，
    而某天有人會依賴那個假設。
    """
    from sunny.schemas.message import MessageIn

    assert set(MessageIn.model_fields) == {"body"}


def test_member_output_schema_never_exposes_admin_names() -> None:
    """**前台的會員 MUST 只看到「客服人員」**（FR-127）。

    驗證的是 schema 而非渲染：`MessageOut` 裡沒有姓名欄位，前端就沒有東西
    可顯示。用一個 `include_sender_name` 開關的話，那個開關遲早會有一次
    沒被關掉，而症狀是會員看到客服的真實姓名——沒有錯誤訊息。
    """
    from sunny.schemas.message import AdminMessageOut, MessageOut

    assert "sender_name" not in MessageOut.model_fields
    assert "sender_id" not in MessageOut.model_fields
    # 管理員端則**必須**有：接手的人要知道前一句是誰說的
    assert "sender_name" in AdminMessageOut.model_fields


def test_no_assignment_mechanism_exists() -> None:
    """**MUST NOT 提供「指派給特定客服」的機制**（FR-127）。

    指派會讓被指派者休假時整串無人回覆，而這項功能要解決的正是不漏接。
    """
    from sunny.schemas.message import ThreadSummaryOut

    banned = {"assignee", "assigned_to", "assignedTo", "owner", "handler"}
    assert not (set(ThreadSummaryOut.model_fields) & banned)

    for path, route in _routes("/admin/messages"):
        names = {p.name for p in route.dependant.query_params}
        assert not (names & banned), f"{path} 提供了指派參數 {names & banned}"


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


# --- 授權三案例 -------------------------------------------------------------
_MEMBER_ENDPOINTS = [("GET", "/messages", None), ("POST", "/messages", {"body": "你好"})]


@pytest.mark.parametrize(
    ("method", "path", "body"), _MEMBER_ENDPOINTS, ids=[f"{m} {p}" for m, p, _ in _MEMBER_ENDPOINTS]
)
async def test_unauthenticated_gets_401(client, method: str, path: str, body) -> None:
    res = await client.request(method, path, json=body)
    assert res.status_code == 401


async def test_member_cannot_reach_the_admin_side(client, member_token: str, member) -> None:
    """會員 MUST NOT 讀取或回覆任何討論串的管理端（FR-126、FR-127）。"""
    for method, path, body in (
        ("GET", "/admin/messages", None),
        ("GET", f"/admin/messages/{member.id}", None),
        ("POST", f"/admin/messages/{member.id}", {"body": "偽造的官方回覆"}),
    ):
        res = await client.request(method, path, json=body, headers=auth_header(member_token))
        assert res.status_code == 403, f"{method} {path} 回了 {res.status_code}"
        assert res.json()["code"] == "FORBIDDEN"


# --- FR-126：讀不到他人的討論串 ---------------------------------------------
async def test_a_member_never_sees_another_members_thread(
    client, member_token: str, other_member_token: str
) -> None:
    """**會員 MUST NOT 能讀取他人的討論串**（FR-126）。

    A 送出一則訊息，B 讀取自己的討論串時 MUST 什麼也看不到。
    """
    sent = await client.post(
        "/messages", json={"body": "我的訂單有問題"}, headers=auth_header(member_token)
    )
    assert sent.status_code == 201

    mine = await client.get("/messages", headers=auth_header(member_token))
    assert [m["body"] for m in mine.json()] == ["我的訂單有問題"]

    theirs = await client.get("/messages", headers=auth_header(other_member_token))
    assert theirs.json() == [], "會員 MUST NOT 讀取到他人的討論串（FR-126）"


async def test_a_member_cannot_write_into_another_thread(
    client, session, member_token: str, other_member
) -> None:
    """**會員 MUST NOT 能寫入他人的討論串**（FR-126）。

    沒有 URL 可以指定討論串——送出的訊息一律落在自己那一串。這裡驗證的是
    那個結果：B 的討論串在 A 送出訊息後仍然是空的。
    """
    await client.post("/messages", json={"body": "A 的訊息"}, headers=auth_header(member_token))

    rows = await session.scalars(select(Message).where(Message.thread_user_id == other_member.id))
    assert rows.all() == [], "訊息落到了別人的討論串"


# --- FR-125：角色由伺服器判定 -----------------------------------------------
async def test_client_supplied_sender_role_is_ignored(
    client, session, member_token: str, member
) -> None:
    """**前端送出的 `senderRole` MUST 被忽略**（FR-125、SC-032）。

    ⚠️ 這是本檔最要緊的一條。會員的討論串本來就屬於他，權限規則允許他寫入；
    若角色由請求主體決定，他就能插入一則看起來像官方回覆的訊息。

    真的送出那個欄位再確認它沒有生效——只讀程式碼會看到 `MessageIn` 沒有
    那個欄位，但 Pydantic 預設靜默丟棄未知欄位，那與「拒絕」看起來一樣。
    """
    res = await client.post(
        "/messages",
        json={"body": "這是官方公告", "senderRole": "admin", "senderId": str(uuid.uuid4())},
        headers=auth_header(member_token),
    )
    assert res.status_code == 201
    assert res.json()["senderRole"] == SENDER_MEMBER

    stored = await session.scalar(select(Message).where(Message.thread_user_id == member.id))
    assert stored is not None
    assert stored.sender_role == SENDER_MEMBER, "前端送出的 senderRole 生效了——會員可偽造官方回覆"
    assert stored.sender_id == member.id, "前端送出的 senderId 生效了"


async def test_admin_reply_is_stamped_as_admin(
    client, session, admin_token: str, admin, member
) -> None:
    """管理員的回覆一律標記為 `admin`，且發話者是那位管理員（FR-125、FR-127）。"""
    res = await client.post(
        f"/admin/messages/{member.id}",
        json={"body": "已為您處理"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["senderRole"] == SENDER_ADMIN
    assert body["senderId"] == str(admin.id)
    assert body["senderName"] == admin.display_name


async def test_the_member_sees_the_reply_without_the_admin_name(
    client, admin_token: str, member_token: str, member
) -> None:
    """**前台 MUST NOT 顯示管理員姓名**（FR-127）。"""
    await client.post(
        f"/admin/messages/{member.id}",
        json={"body": "已為您處理"},
        headers=auth_header(admin_token),
    )

    mine = await client.get("/messages", headers=auth_header(member_token))
    (reply,) = mine.json()

    assert reply["senderRole"] == SENDER_ADMIN
    assert reply["mine"] is False
    assert "senderName" not in reply
    assert "senderId" not in reply


# --- FR-128：回覆進日誌，日誌不含內容 ----------------------------------------
async def test_admin_reply_is_audited_without_the_message_body(
    client, session, admin_token: str, member
) -> None:
    """**每次回覆 MUST 寫入 `admin_logs`，且日誌 MUST NOT 含訊息內容**（FR-128）。"""
    from sunny.models.admin_log import AdminLog

    secret = "客人說他下週要住院所以要取消"
    res = await client.post(
        f"/admin/messages/{member.id}", json={"body": secret}, headers=auth_header(admin_token)
    )
    assert res.status_code == 201

    logs = (await session.scalars(select(AdminLog).where(AdminLog.action == "message.reply"))).all()
    assert len(logs) == 1, "每次回覆 MUST 恰好寫入一筆稽核紀錄"
    assert secret not in str(logs[0].summary), "稽核日誌含有訊息內容（FR-128、FR-118）"


# --- FR-124：送出後不可修改 --------------------------------------------------
async def test_there_is_no_endpoint_to_edit_a_message() -> None:
    """**送出後 MUST NOT 可修改內容**（FR-124）。

    `guard_message_update()` trigger 是保證；沒有端點讓這件事在閱讀程式碼時
    就看得出來。兩層都要——只有 trigger 的話，一支會 500 的端點仍會被寫出來。
    """
    for path, route in _routes("/messages") + _routes("/admin/messages"):
        methods = set(route.methods or ()) - {"HEAD", "OPTIONS"}
        assert "PUT" not in methods and "PATCH" not in methods and "DELETE" not in methods, (
            f"{path} 提供了 {methods}——訊息送出後不可修改也不可刪除"
        )


async def test_read_at_is_the_only_thing_that_changes_after_sending(
    client, session, member_token: str, admin_token: str, member
) -> None:
    """`read_at` 是**唯一**可事後更新的欄位（FR-124）。"""
    await client.post(
        "/messages", json={"body": "請問可以提早入住嗎"}, headers=auth_header(member_token)
    )

    stored = await session.scalar(select(Message).where(Message.thread_user_id == member.id))
    assert stored is not None
    assert stored.read_at is None
    original_body = stored.body
    original_created = stored.created_at

    res = await client.post(f"/admin/messages/{member.id}/read", headers=auth_header(admin_token))
    assert res.status_code == 204

    await session.refresh(stored)
    assert stored.read_at is not None
    assert stored.body == original_body
    assert stored.created_at == original_created


async def test_marking_read_only_touches_the_counterparts_messages(
    client, session, member_token: str, admin_token: str, member
) -> None:
    """只標**對方**送出的訊息。

    把自己送出的訊息標成已讀沒有意義，而且會讓「對方讀了沒」這個資訊失效
    ——那是這個欄位唯一的用途。
    """
    await client.post("/messages", json={"body": "會員的問題"}, headers=auth_header(member_token))
    await client.post(
        f"/admin/messages/{member.id}",
        json={"body": "客服的回覆"},
        headers=auth_header(admin_token),
    )

    # 管理員標記已讀 → 只有會員那則被標
    await client.post(f"/admin/messages/{member.id}/read", headers=auth_header(admin_token))

    rows = (
        await session.scalars(
            select(Message).where(Message.thread_user_id == member.id).order_by(Message.created_at)
        )
    ).all()
    by_role = {m.sender_role: m for m in rows}
    assert by_role[SENDER_MEMBER].read_at is not None
    assert by_role[SENDER_ADMIN].read_at is None, "管理員把自己送出的訊息也標成已讀了"


async def test_any_admin_can_read_and_reply_to_any_thread(
    client, session, admin_token: str, member_token: str, member
) -> None:
    """**任一管理員皆可讀取並回覆所有討論串**（FR-127）。

    這是「不指派」的正面表述：討論串清單裡看得到每一串，且每一串都能回。
    """
    await client.post("/messages", json={"body": "我的問題"}, headers=auth_header(member_token))

    threads = await client.get("/admin/messages", headers=auth_header(admin_token))
    assert threads.status_code == 200
    (summary,) = threads.json()
    assert summary["userId"] == str(member.id)
    assert summary["unread"] == 1

    thread = await client.get(f"/admin/messages/{member.id}", headers=auth_header(admin_token))
    assert [m["body"] for m in thread.json()] == ["我的問題"]
