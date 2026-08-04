"""個人檔案端點。**全部需登入。**"""

from __future__ import annotations

from fastapi import APIRouter

from sunny.deps import CurrentUser, SessionDep
from sunny.schemas.auth import ProfileOut, ProfileUpdateIn

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=ProfileOut, summary="取得自己的資料（需登入）")
async def get_me(user: CurrentUser) -> ProfileOut:
    """需登入。

    ⚠️ **沒有 `/users/{id}` 這種端點。** 會員只能取得**自己**的資料——
    身分來自 token，不來自路徑參數，因此「讀取他人資料」在結構上不可表達
    （FR-081）。想不出辦法越權，比擋住越權更可靠。
    """
    return ProfileOut.model_validate(user, from_attributes=True)


@router.patch("/me", response_model=ProfileOut, summary="更新自己的資料（需登入）")
async def update_me(
    payload: ProfileUpdateIn,
    user: CurrentUser,
    session: SessionDep,
) -> ProfileOut:
    """更新顯示名稱與聯絡電話（FR-007）。

    ⚠️ `ProfileUpdateIn` **沒有 `role` 欄位**——角色升降只能經管理員端點，
    且 MUST 進稽核日誌。這是原 `prevent_role_escalation()` trigger 的職責，
    它隨 RLS 移除後改由「輸入模型不含該欄位」保證（data-model.md）。
    """
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.phone is not None:
        # 空字串代表清除電話，與「未提供」不同——後者是 None，不動原值。
        user.phone = payload.phone.strip() or None

    await session.commit()
    await session.refresh(user)
    return ProfileOut.model_validate(user, from_attributes=True)
