"""系統參數與示範資料還原（FR-098、FR-101、FR-119、FR-120、FR-073）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上。

## 參數變更 MUST NOT 回溯

FR-101：「保留分鐘數的變更 MUST NOT 回溯影響既有訂單的 `expires_at`。」

本檔因此**只寫 `system_settings`**，不碰任何一筆 `orders`。訂單的
`expires_at` 由資料庫欄位預設值於建單當下寫入後即固定，而
`guard_order_transition()` trigger 禁止事後變更它——那是最後一道網，
但先不要寫出需要它擋的程式碼（憲章原則 IV）。

回溯的後果不抽象：把 60 分鐘改成 5 分鐘，正在結帳的人會在送出付款的那一刻
發現訂單已經逾期取消，而他什麼也沒做錯。

## 範圍檢查在兩個地方

`settings_valid_range` CHECK 約束是保證；本檔先擋一次是為了**訊息品質**——
被拒絕時 MUST 顯示可接受範圍（FR-119）。約束擋下來只會得到一個 500。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.system_setting import (
    KEY_PENDING_PAYMENT_MINUTES,
    KEY_ROOM_AMENITIES,
    KEY_ROOM_FEATURES,
    PENDING_PAYMENT_MAX,
    PENDING_PAYMENT_MIN,
)
from sunny.repositories.settings import SettingsRepository
from sunny.schemas.settings import ResetDemoDataIn, ResetResultOut, SettingsIn, SettingsOut
from sunny.seed import seed_into
from sunny.services import audit

router = APIRouter(
    prefix="/admin",
    tags=["admin:settings"],
    dependencies=[Depends(require_admin)],
)


def _validate_minutes(value: int) -> None:
    """範圍檢查。**被拒絕時 MUST 說出可接受範圍**（FR-119）。"""
    if not PENDING_PAYMENT_MIN <= value <= PENDING_PAYMENT_MAX:
        raise DomainError(
            f"未付款訂單保留時間需介於 {PENDING_PAYMENT_MIN} 至 "
            f"{PENDING_PAYMENT_MAX} 分鐘之間（目前輸入 {value}）。",
            code="SETTING_OUT_OF_RANGE",
            status_code=400,
            field="pendingPaymentMinutes",
        )


@router.get("/settings", response_model=SettingsOut, summary="系統參數（需管理員）")
async def get_settings(session: SessionDep) -> SettingsOut:
    """需管理員（FR-120）。參數集中於單一來源，MUST NOT 硬編碼散落於程式碼中。"""
    values = await SettingsRepository(session).all_settings()
    return SettingsOut(
        pending_payment_minutes=int(values[KEY_PENDING_PAYMENT_MINUTES]),
        room_amenities=list(values[KEY_ROOM_AMENITIES]),
        room_features=list(values[KEY_ROOM_FEATURES]),
        pending_payment_min=PENDING_PAYMENT_MIN,
        pending_payment_max=PENDING_PAYMENT_MAX,
    )


@router.put("/settings", response_model=SettingsOut, summary="調整系統參數（需管理員）")
async def update_settings(
    payload: SettingsIn, session: SessionDep, admin: AdminUser
) -> SettingsOut:
    """需管理員（FR-098、FR-119）。

    ⚠️ **不觸碰任何既有訂單。** 新的保留分鐘數只影響**之後**成立的訂單
    （FR-101）。這不是疏漏——見模組說明。

    詞彙表的變更同時套用至前台搜尋列與後台房源表單（FR-010a）：
    兩者都讀 `GET /vocabulary`，因此不需要任何同步動作。
    """
    repo = SettingsRepository(session)
    changed: dict[str, object] = {}

    if payload.pending_payment_minutes is not None:
        _validate_minutes(payload.pending_payment_minutes)
        current = await repo.pending_payment_minutes()
        if current != payload.pending_payment_minutes:
            await repo.set(KEY_PENDING_PAYMENT_MINUTES, payload.pending_payment_minutes)
            changed[KEY_PENDING_PAYMENT_MINUTES] = [current, payload.pending_payment_minutes]

    if payload.room_amenities is not None:
        await repo.set(KEY_ROOM_AMENITIES, payload.room_amenities)
        changed[KEY_ROOM_AMENITIES] = {"count": len(payload.room_amenities)}

    if payload.room_features is not None:
        await repo.set(KEY_ROOM_FEATURES, payload.room_features)
        changed[KEY_ROOM_FEATURES] = {"count": len(payload.room_features)}

    if not changed:
        raise DomainError("沒有要變更的參數。", code="NOTHING_TO_UPDATE", status_code=400)

    await audit.record(
        session,
        actor_id=admin.id,
        action="settings.update",
        target_table="system_settings",
        summary={"changed": changed},
    )
    await session.commit()
    return await get_settings(session)


@router.post(
    "/reset-demo-data",
    response_model=ResetResultOut,
    summary="還原示範資料（需管理員）",
)
async def reset_demo_data(
    payload: ResetDemoDataIn, session: SessionDep, admin: AdminUser
) -> ResetResultOut:
    """需管理員（FR-073）。把所有資料還原為初始種子狀態。

    FR-072（可重複執行的種子機制）與 FR-073（**還原入口**）是兩條需求：
    只有 CLI 腳本不構成使用者可及的入口。

    ⚠️ **需二次確認**：`confirm` MUST 為 true。這個操作會刪掉所有訂單、評論與
    退款申請，且不可復原——一個按錯就沒了的按鈕不該只需要按一次。

    ⚠️ **`admin_logs` 不會被清空。** FR-073 說「所有資料」，FR-116 說日誌
    僅可新增；兩者牴觸時取後者——一個按下重置就會被清空的稽核日誌，
    不叫僅可新增（SC-027、seed.py 的 `_reset_business_data`）。
    在正式連線下這也真的刪不掉：`sunny_app` 的 DELETE 權限已被 REVOKE。

    ⚠️ **稽核紀錄先寫、重置後執行，兩者同一個交易。** 順序有意義：重置會刪除
    「沒有留下任何日誌」的帳號，先寫紀錄，執行重置的管理員才會被同一交易內的
    `not exists` 子查詢看見而保留下來（seed.py 的 `seed_into`）。
    """
    if not payload.confirm:
        raise DomainError(
            "此操作會清除所有訂單、評論與退款資料且無法復原，請確認後再執行。",
            code="CONFIRMATION_REQUIRED",
            status_code=400,
            field="confirm",
        )

    await audit.record(
        session,
        actor_id=admin.id,
        action="demo_data.reset",
        target_table="system_settings",
        # 不記任何被刪除的內容——那是整個資料庫。記「做了這件事」就夠了。
        summary={"scope": "business-data", "auditLogPreserved": True},
    )

    await seed_into(session)
    await session.commit()

    return ResetResultOut(
        reset=True,
        audit_log_preserved=True,
        message="已還原為初始示範資料。操作日誌依規定保留，未被清除。",
    )
