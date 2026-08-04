"""T065：密碼保管與 JWT（FR-009a、FR-009b、FR-004）。

憲章原則 VI 的密碼規則沒有例外——含公開列出的測試帳號在內。
"""

from __future__ import annotations

import time
import uuid

import pytest

from sunny.errors import DomainError
from sunny.models.profile import ROLE_ADMIN, ROLE_MEMBER
from sunny.services import auth


# ---------------------------------------------------------------------------
# 雜湊（FR-009a）
# ---------------------------------------------------------------------------
def test_hash_is_verifiable() -> None:
    h = auth.hash_password("guest123")
    assert auth.verify_password(h, "guest123") is True


def test_wrong_password_fails() -> None:
    h = auth.hash_password("guest123")
    assert auth.verify_password(h, "guest124") is False


def test_hash_is_argon2id() -> None:
    """MUST 為 argon2id。MD5／SHA-1／裸 SHA-256 一律禁止（憲章原則 VI）。"""
    assert auth.hash_password("x" * 10).startswith("$argon2id$")


def test_hash_is_salted_so_same_password_differs() -> None:
    """未加鹽的雜湊會讓相同密碼產生相同輸出，等於送對方一張彩虹表。"""
    assert auth.hash_password("same-password") != auth.hash_password("same-password")


def test_hash_does_not_contain_the_plaintext() -> None:
    assert "guest123" not in auth.hash_password("guest123")


def test_verify_rejects_malformed_hash_without_raising() -> None:
    """資料庫裡若有損壞的雜湊，登入應失敗而非 500。"""
    assert auth.verify_password("not-a-hash", "anything") is False


def test_long_password_is_not_truncated() -> None:
    """bcrypt 會在 72 位元組截斷，argon2id 不會。

    截斷的後果是 `password[:72]` 與完整密碼都能通過驗證——這種錯不會有人
    察覺，直到有人拿它當漏洞（research R5）。
    """
    long_pw = "a" * 100
    h = auth.hash_password(long_pw)
    assert auth.verify_password(h, long_pw) is True
    assert auth.verify_password(h, "a" * 72) is False


# ---------------------------------------------------------------------------
# 長度下限（FR-009b）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pw", ["", "a", "12345"])
def test_short_password_rejected(pw: str) -> None:
    with pytest.raises(DomainError) as exc:
        auth.validate_password_length(pw)
    assert exc.value.code == "PASSWORD_TOO_SHORT"
    assert "6" in exc.value.detail


def test_exactly_six_characters_is_accepted() -> None:
    """6 是合法的邊界，不可被一併擋掉。"""
    auth.validate_password_length("123456")


# ---------------------------------------------------------------------------
# 帳號列舉防護（FR-004）
# ---------------------------------------------------------------------------
def test_dummy_verification_costs_similar_time_to_a_real_one() -> None:
    """兩種登入失敗的**回應時間**不得有數量級差異。

    帳號不存在時若直接回傳，會比「查到帳號 → 執行一次 argon2 驗證」快上兩個
    數量級，時間差本身就是一條帳號列舉管道。
    """
    real_hash = auth.hash_password("some-password")

    def timed(fn) -> float:
        start = time.perf_counter()
        fn()
        return time.perf_counter() - start

    real = min(timed(lambda: auth.verify_password(real_hash, "wrong")) for _ in range(3))
    dummy = min(timed(auth.waste_time_like_a_real_verification) for _ in range(3))

    assert 0.2 < dummy / real < 5.0, f"時間差過大：真實 {real:.4f}s vs 虛設 {dummy:.4f}s"


# ---------------------------------------------------------------------------
# rehash
# ---------------------------------------------------------------------------
def test_fresh_hash_does_not_need_rehash() -> None:
    assert auth.needs_rehash(auth.hash_password("x" * 10)) is False


def test_unparseable_hash_needs_rehash() -> None:
    assert auth.needs_rehash("garbage") is True


# ---------------------------------------------------------------------------
# JWT（research R6）
# ---------------------------------------------------------------------------
def test_token_roundtrip() -> None:
    uid = uuid.uuid4()
    token = auth.create_access_token(uid, ROLE_MEMBER)
    assert auth.user_id_from_token(token) == uid


def test_token_carries_role() -> None:
    token = auth.create_access_token(uuid.uuid4(), ROLE_ADMIN)
    assert auth.decode_access_token(token)["role"] == ROLE_ADMIN


def test_token_has_an_expiry() -> None:
    """憲章原則 VI：Token MUST 有有效期限。"""
    payload = auth.decode_access_token(auth.create_access_token(uuid.uuid4(), ROLE_MEMBER))
    assert "exp" in payload
    assert payload["exp"] > payload["iat"]


def test_tampered_token_is_rejected() -> None:
    token = auth.create_access_token(uuid.uuid4(), ROLE_MEMBER)
    head, payload, sig = token.split(".")
    forged = f"{head}.{payload}.{'A' * len(sig)}"
    with pytest.raises(DomainError) as exc:
        auth.decode_access_token(forged)
    assert exc.value.status_code == 401


def test_token_payload_carries_no_personal_data() -> None:
    """JWT 只經 base64 編碼、未加密，任何人都能讀出內容。

    因此 payload MUST NOT 含 email、顯示名稱或密碼雜湊。
    """
    payload = auth.decode_access_token(auth.create_access_token(uuid.uuid4(), ROLE_MEMBER))
    assert set(payload) == {"sub", "role", "iat", "exp"}


def test_garbage_token_is_rejected_as_401_not_500() -> None:
    with pytest.raises(DomainError) as exc:
        auth.decode_access_token("this-is-not-a-jwt")
    assert exc.value.status_code == 401
