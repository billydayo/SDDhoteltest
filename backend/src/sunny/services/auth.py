"""密碼雜湊與 JWT 簽發。

## 為什麼是 argon2id（research R5）

- OWASP 現行首選，對 GPU 破解的抵抗力優於 bcrypt。
- **bcrypt 有 72 位元組的輸入截斷特性**：超長密碼會被靜默截斷，導致
  `password[:72]` 與完整密碼驗證結果相同。FR-009b 只定下限 6 字元、未定上限，
  這個特性會造成難以察覺的行為差異。
- `argon2-cffi` 內建 `check_needs_rehash`，日後調高成本參數時可在使用者登入
  當下自動重新雜湊，不必要求全體重設密碼。

## 帳號列舉防護

`POST /auth/login` 的兩種失敗——帳號不存在、密碼錯誤——MUST **無法區分**
（FR-004）。訊息與狀態碼相同還不夠：**回應時間也不能洩漏**。

帳號不存在時若直接回傳，會比「查到帳號 → 執行一次 argon2 驗證」快上兩個
數量級，時間差本身就構成一條帳號列舉管道。因此帳號不存在時 MUST 呼叫
`waste_time_like_a_real_verification()` 對虛設雜湊做一次驗證。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from sunny.config import get_settings
from sunny.errors import DomainError

_hasher = PasswordHasher()

#: 對虛設值做驗證用的雜湊。內容是什麼不重要——重點是驗證它所花的時間與驗證
#: 一個真實雜湊相當，藉此讓「帳號不存在」與「密碼錯誤」的回應時間無法區分。
_DUMMY_HASH: Final = _hasher.hash("sunny-dummy-password-for-timing-parity")

#: 註冊密碼的下限（FR-009b）。**沒有上限**——argon2id 不像 bcrypt 會截斷輸入。
MIN_PASSWORD_LENGTH: Final = 6

JWT_ALGORITHM: Final = "HS256"


# ---------------------------------------------------------------------------
# 密碼
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    """以 argon2id 雜湊。

    呼叫端 MUST 先以 `validate_password_length` 檢查長度。
    """
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """驗證密碼。錯誤一律回 False，不區分成因。"""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def waste_time_like_a_real_verification() -> None:
    """帳號不存在時呼叫，讓回應時間與真實驗證相當。

    **不是可有可無的裝飾。** 少了它，攻擊者只要量測回應時間就能逐一確認
    哪些 email 已註冊，而 FR-004 要求的正是「不透露該帳號是否存在」。
    """
    verify_password(_DUMMY_HASH, "any-password-will-do")


def needs_rehash(password_hash: str) -> bool:
    """成本參數是否已落後於目前設定。

    為 True 時應在使用者登入當下（此時握有明文）重新雜湊並寫回。
    """
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def validate_password_length(password: str) -> None:
    """FR-009b：拒絕長度不足 6 個字元的密碼，並顯示明確原因。

    ⚠️ **MUST 帶 `field`。** 註冊表單有四格，其中兩格是密碼。少了 `field`，
    前端只能把訊息印在表單底部而無法把焦點移過去（FR-010）——使用者讀到
    「密碼至少需 6 個字元」，卻得自己回頭找是哪一格。
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise DomainError(
            f"密碼至少需 {MIN_PASSWORD_LENGTH} 個字元。",
            code="PASSWORD_TOO_SHORT",
            field="password",
        )


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
def create_access_token(user_id: uuid.UUID, role: str) -> str:
    """簽發 token。

    Payload 刻意只放 `sub` 與 `role`，**不放 email 或顯示名稱**——JWT 只經
    base64 編碼而非加密，任何人都能讀出內容。且角色可能在 token 有效期內被
    管理員變更，因此授權 MUST 於每次請求重新自資料庫確認（見 deps.py），
    payload 中的 role 僅供前端調整畫面呈現。
    """
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """解析並驗證 token。

    過期或簽章不符時拋 401——前端的 API client 會統一攔截並導向登入頁，
    且保留原本要前往的位置（FR-009d）。
    """
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise DomainError(
            "登入工作階段已過期，請重新登入。",
            code="TOKEN_EXPIRED",
            status_code=401,
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise DomainError(
            "登入憑證無效，請重新登入。",
            code="TOKEN_INVALID",
            status_code=401,
        ) from exc


def user_id_from_token(token: str) -> uuid.UUID:
    payload = decode_access_token(token)
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise DomainError(
            "登入憑證無效，請重新登入。",
            code="TOKEN_INVALID",
            status_code=401,
        ) from exc


__all__ = [
    "JWT_ALGORITHM",
    "MIN_PASSWORD_LENGTH",
    "create_access_token",
    "decode_access_token",
    "hash_password",
    "needs_rehash",
    "user_id_from_token",
    "validate_password_length",
    "verify_password",
    "waste_time_like_a_real_verification",
]
