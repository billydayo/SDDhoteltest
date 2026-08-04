"""profiles — 會員。**同時是身分來源。**

前一版的身分資料分居兩處：`auth.users`（Supabase 管理）與 `public.profiles`
（應用資料）。託管認證移除後，profiles 取回 email 與密碼雜湊，兩者合而為一。

⚠️ `password_hash` **MUST NOT 出現在任何 Pydantic 回應模型中**。
前一版靠「資料表根本沒有密碼欄位」來保證這件事，那層保護已經沒有了——
現在只剩 `ProfileOut` 明列輸出欄位這一道（data-model.md、憲章原則 VI）。
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

#: profiles.role 的合法值。與資料庫的 CHECK 約束一致。
ROLE_MEMBER = "member"
ROLE_ADMIN = "admin"
ROLES = (ROLE_MEMBER, ROLE_ADMIN)


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (CheckConstraint("role in ('member', 'admin')", name="profiles_role_check"),)

    id: Mapped[uuid_pk]

    #: 登入識別。**唯一約束是 FR-088 的承載者**——以既有 email 的 Google 帳號
    #: 登入時必須進入同一帳號，而非建立第二筆。
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    #: argon2id 雜湊。
    #:
    #: **可為 null**：僅以 Google 註冊的帳號沒有密碼。設為 NOT NULL 就得填入某個
    #: 假值，而那個假值遲早會被某段程式碼當成可比對的雜湊。可為 null 讓
    #: 「這個帳號沒有密碼」成為可表達的狀態，登入流程因而能明確處理它
    #: （回覆「此帳號請以 Google 登入」）而非落入一般的比對失敗分支。
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)

    google_sub: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)

    role: Mapped[str] = mapped_column(String, nullable=False, default=ROLE_MEMBER)
    display_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at]

    @property
    def is_admin(self) -> bool:
        """便利屬性。

        ⚠️ 這**不是**授權檢查。授權 MUST 由 `require_admin` 相依在路由層執行
        （憲章原則 VI：後端檢查是唯一的存取邊界）。
        """
        return self.role == ROLE_ADMIN

    def __repr__(self) -> str:  # pragma: no cover - 除錯用
        # 刻意不輸出 email 與 password_hash：repr 會出現在錯誤訊息與日誌中。
        return f"<Profile id={self.id} role={self.role}>"


__all__ = ["ROLE_ADMIN", "ROLE_MEMBER", "ROLES", "Profile"]
