"""後台用戶管理與角色升降（FR-055）。

⚠️ **角色變更只能經由本檔的 `PATCH /admin/users/{id}/role`。**

原 `prevent_role_escalation()` trigger 依賴 `is_admin()` → `auth.uid()`，
隨 Supabase Auth 一併移除。其職責移至此（data-model.md、research R1）。
會員自己的 `PATCH /me` 沒有 `role` 欄位可填，因此提權在該路徑上
**結構上不可表達**；本檔則是唯一開放的入口，且每一次變更都進稽核日誌。

⚠️ 回應一律用 `AdminUserOut`（明列欄位）。MUST NOT 把 ORM 物件全欄位倒出去
——`profiles` 現在有 `password_hash` 與 `google_sub`，前一版靠「資料表根本
沒有密碼欄位」保證這件事，那層保護已經沒有了。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.profile import ROLE_ADMIN, Profile
from sunny.repositories.admin_users import AdminUserRepository
from sunny.schemas.admin import AdminUserOut, UserRoleIn, UserUpdateIn
from sunny.services import audit

router = APIRouter(
    prefix="/admin/users",
    tags=["admin:users"],
    dependencies=[Depends(require_admin)],
)


async def _get_or_404(session, user_id: uuid.UUID) -> Profile:
    profile = await AdminUserRepository(session).get(user_id)
    if profile is None:
        raise DomainError("查無此會員。", code="USER_NOT_FOUND", status_code=404)
    return profile


@router.get("", response_model=list[AdminUserOut], summary="會員清單（需管理員）")
async def list_users(
    session: SessionDep,
    keyword: Annotated[str | None, Query(description="顯示名稱或電子郵件")] = None,
    role: Annotated[str | None, Query()] = None,
) -> list[AdminUserOut]:
    """需管理員（FR-055）。

    與匯出端點共用同一個 `search()`——匯出的筆數 MUST 100% 等於畫面上的
    筆數（SC-033），兩邊各寫一份查詢遲早會有一邊多帶或少帶一個條件。
    """
    profiles = await AdminUserRepository(session).search(keyword=keyword, role=role)
    return [AdminUserOut.model_validate(p) for p in profiles]


@router.patch("/{user_id}", response_model=AdminUserOut, summary="編輯會員資料（需管理員）")
async def update_user(
    user_id: uuid.UUID, payload: UserUpdateIn, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """需管理員（FR-055）。

    ⚠️ `UserUpdateIn` **刻意沒有 `role` 欄位**——角色走下方的獨立端點，
    這樣「每一次角色變更都有稽核紀錄」就不需要靠紀律維持。
    """
    profile = await _get_or_404(session, user_id)

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise DomainError("沒有要變更的欄位。", code="NOTHING_TO_UPDATE", status_code=400)

    for key, value in changes.items():
        setattr(profile, key, value)
    await session.flush()

    await audit.record(
        session,
        actor_id=admin.id,
        action="user.update",
        target_table="profiles",
        target_id=profile.id,
        # 只記「改了哪些欄位」，不記新舊值——顯示名稱與電話是真實個資，
        # 抄進所有管理員都讀得到的日誌等於多開一個外洩點（FR-118）。
        summary={"fields": sorted(changes)},
    )
    await session.commit()
    return AdminUserOut.model_validate(profile)


@router.patch("/{user_id}/role", response_model=AdminUserOut, summary="角色升降（需管理員）")
async def set_user_role(
    user_id: uuid.UUID, payload: UserRoleIn, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """需管理員（FR-055）。**唯一能變更 `profiles.role` 的入口。**

    升權後該帳號下次載入後台即可進入；降權則其下一個操作就會被擋下——
    `require_admin` 每次都重新查資料庫的 `role`，不信任 token payload
    （deps.py、spec Edge Cases「權限即時變更」）。

    ⚠️ **不允許管理員把自己降權。** 系統中若只剩一位管理員而他把自己降成
    會員，就再也沒有人能進後台把任何人升回去——那是一個沒有出口的狀態。
    """
    profile = await _get_or_404(session, user_id)

    if profile.id == admin.id and payload.role != ROLE_ADMIN:
        raise DomainError(
            "不可將自己降權。請由另一位管理員執行，以免系統失去所有管理員。",
            code="CANNOT_DEMOTE_SELF",
            status_code=409,
            field="role",
        )

    previous = profile.role
    if previous == payload.role:
        raise DomainError(
            "該會員已是此角色，未做任何變更。",
            code="ROLE_UNCHANGED",
            status_code=400,
            field="role",
        )

    profile.role = payload.role
    await session.flush()

    await audit.record(
        session,
        actor_id=admin.id,
        action="user.role",
        target_table="profiles",
        target_id=profile.id,
        summary={"from": previous, "to": payload.role},
    )
    await session.commit()
    return AdminUserOut.model_validate(profile)
