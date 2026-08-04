"""稽核日誌的統一寫入入口。

⚠️ **管理員的每一次寫入 MUST 一併寫入 `admin_logs`，且 MUST 與變更在同一個
交易內完成**（憲章資料存取規則）。MUST NOT 出現「改了但沒記錄」。

同一交易是關鍵：分開提交的話，變更成功而日誌失敗會產生一筆無紀錄的操作，
而那正是稽核最該抓到的情況。本模組刻意**不提交**——由呼叫端與業務變更一起
提交，讓兩者共存亡。

## 日誌不可竄改

`admin_logs` 上的 UPDATE 與 DELETE 已自應用角色 REVOKE（T019）。本模組因而
只提供 `record()`，**沒有也不會有**更新或刪除的函式（FR-116、SC-027）。

## 不得記錄的內容

密碼、秘鑰與真實個資一律 MUST NOT 進入 `summary`（FR-118）。匯出功能寫入
日誌時 MUST 只記模組、筆數與格式——匯出的是會員資料，把它抄進所有管理員都
讀得到的日誌，等於多開一個外洩點（FR-058a）。
"""

from __future__ import annotations

import uuid
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from sunny.models.admin_log import AdminLog

#: `summary` 中一律不得出現的鍵。命中即代表呼叫端把敏感資料塞進了稽核紀錄。
_FORBIDDEN_KEYS: Final = frozenset(
    {
        "password",
        "password_hash",
        "new_password",
        "old_password",
        "token",
        "access_token",
        "jwt",
        "secret",
        "api_key",
        "client_secret",
        "id_number",
        "card_number",
        "cvv",
    }
)


class AuditError(RuntimeError):
    """稽核紀錄本身有問題——這是程式錯誤，不是使用者錯誤。"""


def _assert_no_sensitive_keys(summary: dict[str, Any]) -> None:
    """擋掉把敏感欄位寫進日誌的呼叫。

    做成**拋例外而非靜默過濾**：靜默過濾會讓呼叫端以為自己記錄了那個欄位，
    而實際上沒有；更糟的是下次有人換個鍵名就漏過去了。讓它在開發時就爆掉。
    """
    offending = {k for k in summary if k.lower() in _FORBIDDEN_KEYS}
    if offending:
        raise AuditError(f"稽核紀錄不得包含敏感欄位：{sorted(offending)}（FR-118）")


async def record(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    action: str,
    target_table: str,
    target_id: str | uuid.UUID | None = None,
    summary: dict[str, Any] | None = None,
) -> AdminLog:
    """寫入一筆稽核紀錄。

    **不提交。** 呼叫端 MUST 在同一個交易中一併提交業務變更與本紀錄。

    Args:
        actor_id: 執行操作的管理員。
        action: 動作類型，例如 `room.update`、`refund.approve`。
        target_table: 對象資料表。
        target_id: 對象識別。
        summary: 變更摘要。MUST NOT 含密碼、秘鑰或真實個資。
    """
    payload = dict(summary or {})
    _assert_no_sensitive_keys(payload)

    entry = AdminLog(
        actor_id=actor_id,
        action=action,
        target_table=target_table,
        target_id=str(target_id) if target_id is not None else None,
        summary=payload,
    )
    session.add(entry)
    # flush 而非 commit：讓紀錄取得 id 與時間戳，但交易仍由呼叫端掌控。
    await session.flush()
    return entry


__all__ = ["AuditError", "record"]
