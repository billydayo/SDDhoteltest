"""應用設定。所有設定由環境變數讀取（憲章後端約束）。

**缺少必要變數時，應用於啟動時明確失敗，MUST NOT 以預設值靜默啟動。**
`jwt_secret` 尤其沒有 fallback——「沒設就用預設值」等同於公開秘鑰（憲章原則 VI）。

## 為什麼連線資訊是「元件」而不是一整條 URL

因為密碼裡的 `@`、`/`、`:`、`#`、空白會在 URL 裡改變語意。連線字串
`postgresql://user:p@ss@host/db` 的第一個 `@` 會被當成「密碼結束」，於是
主機變成 `ss@host`——**這不會報錯，只會連到一個不存在的主機**，錯誤訊息是
DNS 失敗，跟密碼看起來毫無關係。

把密碼當成獨立欄位、由 `quote_plus()` 統一編碼，讓這類錯誤在結構上不會發生。
使用者不需要知道什麼字元要編碼，也不會編錯。

## 兩組連線的差異

`migration_database_url` 以**擁有者**身分連線（建表、建函式、建角色），
`database_url` 以**非擁有者**的 `sunny_app` 連線。

這不是潔癖：`REVOKE UPDATE, DELETE ON admin_logs` **只對非擁有者生效**——
擁有者保有隱含權限。應用若以擁有者連線，那道 REVOKE 是一句不報錯也不生效的
SQL，稽核日誌就悄悄變得可以竄改（憲章資料庫約束、SC-027）。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: `backend/`。`env_file` MUST 為絕對路徑：相對的 `".env"` 由 pydantic 對**當前工作
#: 目錄**解析，於是從專案根目錄啟動時會讀到根目錄那個同名檔（若存在），而不是
#: `backend/.env`。而佔位值不見得會被驗證器擋下——應用照常啟動，直到第一次查詢
#: 才因連到錯的主機而失敗，錯誤訊息看起來與設定檔毫無關係。
#: 憑證一律只存在於 `backend/.env`（憲章後端約束、FR-085、SC-022）。
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -- 資料庫 ---------------------------------------------------------------
    db_host: str
    db_port: int = 5432
    db_name: str = "postgres"

    #: 擁有者角色，供 Alembic 遷移使用
    db_owner_user: str = "postgres"
    db_owner_password: str

    #: 應用角色。MUST 為非擁有者，由初始 revision（T021a）建立
    db_app_user: str = "sunny_app"
    db_app_password: str

    # -- 認證 -----------------------------------------------------------------
    #: **無預設值。** 缺少時應用於啟動時失敗
    jwt_secret: str
    jwt_expire_minutes: int = 720

    # -- Google 第三方登入（US2 才需要） ---------------------------------------
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # -- 前端 -----------------------------------------------------------------
    #: 前端站台根位址。Google 回呼結束後把瀏覽器送回這裡（見 routers/auth.py）。
    #:
    #: OAuth 回呼是**瀏覽器的導覽**，不是前端發出的 fetch。因此那條路徑不能像
    #: 其他端點一樣回 JSON——使用者會看到一頁 `{"accessToken": ...}`。後端必須
    #: 知道要把他送回哪裡。
    frontend_base_url: str = "http://localhost:5173"

    # -- CORS -----------------------------------------------------------------
    #: 允許來源 MUST 明確列出，MUST NOT 為 ["*"] 搭配 allow_credentials
    cors_origins: str = "http://localhost:5173"

    # -- 檔案上傳 --------------------------------------------------------------
    upload_dir: str = "./uploads"
    max_upload_bytes: int = 2 * 1024 * 1024

    # -- 測試（選填） ----------------------------------------------------------
    sunny_test_database_url: str = Field(default="", alias="SUNNY_TEST_DATABASE_URL")

    # ------------------------------------------------------------------------
    @field_validator("jwt_secret")
    @classmethod
    def _reject_placeholder_secret(cls, value: str) -> str:
        """擋掉 `.env.example` 的佔位值被原樣搬過來的情況。

        `CHANGE_ME` 這種值能讓應用順利啟動，於是沒有人會發現秘鑰其實是公開的。
        """
        if not value or value.strip().upper() in {"CHANGE_ME", "CHANGEME", "SECRET", "TODO"}:
            raise ValueError("JWT_SECRET 必須設為實際的隨機值，不可留空或使用佔位字串")
        if len(value) < 32:
            raise ValueError("JWT_SECRET 至少需 32 個字元")
        return value

    @field_validator("db_owner_password", "db_app_password")
    @classmethod
    def _reject_placeholder_password(cls, value: str) -> str:
        if not value or "<" in value or ">" in value or value.strip().upper() == "CHANGE_ME":
            raise ValueError(
                "資料庫密碼未填寫。請在 backend/.env 填入實際密碼（不需 URL 編碼，"
                "角括號 < > 是佔位標記，不是密碼的一部分）"
            )
        return value

    # ------------------------------------------------------------------------
    def _dsn(self, user: str, password: str) -> str:
        """組裝連線字串。**使用者名稱與密碼一律經 `quote_plus` 編碼。**

        Supabase 的 Session pooler 使用者名稱形如 `postgres.<專案ref>`，含點號；
        密碼則可能含 `@`、`/`、空白。兩者都必須編碼。
        """
        return (
            f"postgresql+asyncpg://{quote_plus(user)}:{quote_plus(password)}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def database_url(self) -> str:
        """應用連線（非擁有者）。"""
        return self._dsn(self.db_app_user, self.db_app_password)

    @property
    def migration_database_url(self) -> str:
        """遷移連線（擁有者）。"""
        return self._dsn(self.db_owner_user, self.db_owner_password)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """讀取設定，全程只解析一次。

    缺少必要變數時 pydantic 會拋 `ValidationError`，應用因而在啟動時失敗——
    這是刻意的行為，不要在此處補 try/except 讓它繼續跑。
    """
    return Settings()  # type: ignore[call-arg]
