"""認證相關的 API 形狀。

⚠️ **本檔的任何輸出模型都 MUST NOT 含 `password_hash`。**

前一版靠「資料表根本沒有密碼欄位」來保證這件事——密碼由 Supabase Auth 保管，
應用 schema 裡不存在。那層保護已經沒有了：`profiles` 現在自己存雜湊。

現在只剩「輸出模型明列欄位」這一道。因此 `ProfileOut` **MUST NOT** 使用
`from_attributes` 把 ORM 物件全欄位倒出去（data-model.md、憲章原則 VI）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from sunny.schemas.room import CamelModel


class RegisterIn(CamelModel):
    """註冊（FR-001）。"""

    email: EmailStr
    #: 下限 6 字元由 `services.auth.validate_password_length` 把關（FR-009b）。
    #: 此處不設 `max_length`——argon2id 不像 bcrypt 會在 72 位元組截斷輸入。
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=100)


class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ProfileOut(CamelModel):
    """會員資料的輸出。**欄位明列。**

    `password_hash` 與 `google_sub` 皆不在此列：前者是密碼，後者是第三方
    識別碼，兩者對前端都沒有用途，列出去只是多開一個外洩面。
    """

    id: uuid.UUID
    email: EmailStr
    role: str
    display_name: str
    phone: str | None
    created_at: datetime


class TokenOut(CamelModel):
    """登入與註冊成功的回應。"""

    access_token: str
    token_type: str = "bearer"
    #: 便利欄位，讓前端登入後不必再打一次 `/me`
    profile: ProfileOut


class ProfileUpdateIn(CamelModel):
    """帳戶設定可修改的欄位（FR-007）。

    ⚠️ **`role` 刻意不在此列。** 角色升降 MUST 只能由管理員端點變更，且 MUST
    進稽核日誌（data-model.md）。若放進來，任何會員都能把自己升為管理員——
    原 `prevent_role_escalation()` trigger 的職責就是擋這個，它隨 RLS 移除後
    改由「這個模型沒有 role 欄位」來保證。
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=50)


__all__ = ["LoginIn", "ProfileOut", "ProfileUpdateIn", "RegisterIn", "TokenOut"]
