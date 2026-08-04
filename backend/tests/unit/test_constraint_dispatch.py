"""T079：`IntegrityError` 以**約束名稱**分派（research R3、contracts/README.md）。

`orders` 上有四個會產生 `IntegrityError` 的物件，語意完全不同：

| 約束 | 使用者訊息 | HTTP |
|---|---|---|
| `orders_no_overlap` | 此房源於所選日期已無空房 | 409 |
| `valid_date_range` | 退房日必須晚於入住日 | 400 |
| `nights_matches_dates` | 內部錯誤（後端算錯） | 500 |
| `order_no` 唯一 | 內部錯誤（序號碰撞） | 500 |

**只看例外型別會把「夜數對不上」回成「已無空房」**，使用者照著訊息改日期永遠改不好。
憲章要求每個約束名稱 MUST 有各自的案例，本檔逐一覆蓋。
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from sunny import errors


class FakeAsyncpgError(Exception):
    """模擬 asyncpg 的原始例外：帶 `constraint_name` 屬性。"""

    def __init__(self, message: str, constraint_name: str | None = None) -> None:
        super().__init__(message)
        self.constraint_name = constraint_name


def make_integrity_error(constraint_name: str | None, message: str = "") -> IntegrityError:
    orig = FakeAsyncpgError(message or f"violates constraint {constraint_name}", constraint_name)
    return IntegrityError("INSERT INTO orders ...", {}, orig)


# ---------------------------------------------------------------------------
# 四個 orders 約束，逐一驗證
# ---------------------------------------------------------------------------
def test_overlap_maps_to_409_with_no_vacancy_message() -> None:
    result = errors.translate_integrity_error(make_integrity_error("orders_no_overlap"))
    assert result.status_code == 409
    assert result.code == "ROOM_UNAVAILABLE"
    assert "已無空房" in result.detail


def test_invalid_date_range_maps_to_400_with_date_message() -> None:
    result = errors.translate_integrity_error(make_integrity_error("valid_date_range"))
    assert result.status_code == 400
    assert result.code == "INVALID_DATE_RANGE"
    assert "退房日" in result.detail


def test_nights_mismatch_maps_to_500_not_a_vacancy_message() -> None:
    """後端算錯夜數不是使用者的問題，**MUST NOT** 回成「已無空房」。"""
    result = errors.translate_integrity_error(make_integrity_error("nights_matches_dates"))
    assert result.status_code == 500
    assert "已無空房" not in result.detail
    assert "退房日" not in result.detail


def test_order_no_collision_maps_to_500() -> None:
    result = errors.translate_integrity_error(make_integrity_error("orders_order_no_key"))
    assert result.status_code == 500


# ---------------------------------------------------------------------------
# 四者互不混淆——這是本檔存在的理由
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("constraint", "expected_status"),
    [
        ("orders_no_overlap", 409),
        ("valid_date_range", 400),
        ("nights_matches_dates", 500),
        ("orders_order_no_key", 500),
    ],
)
def test_each_orders_constraint_gets_its_own_status(constraint: str, expected_status: int) -> None:
    assert (
        errors.translate_integrity_error(make_integrity_error(constraint)).status_code
        == expected_status
    )


def test_four_orders_constraints_produce_distinct_codes() -> None:
    codes = {
        errors.translate_integrity_error(make_integrity_error(name)).code
        for name in (
            "orders_no_overlap",
            "valid_date_range",
            "nights_matches_dates",
            "orders_order_no_key",
        )
    }
    assert len(codes) == 4, f"四個約束必須產生四個不同的 code，實得 {codes}"


# ---------------------------------------------------------------------------
# 其他資料表的約束
# ---------------------------------------------------------------------------
def test_duplicate_email_maps_to_409() -> None:
    """FR-002：email 已存在回 409「此電子郵件已被註冊」。"""
    result = errors.translate_integrity_error(make_integrity_error("profiles_email_key"))
    assert result.status_code == 409
    assert result.code == "EMAIL_TAKEN"


def test_duplicate_review_per_order_maps_to_409() -> None:
    """FR-043：一筆訂單只能評論一次。"""
    result = errors.translate_integrity_error(make_integrity_error("reviews_order_id_key"))
    assert result.status_code == 409


# ---------------------------------------------------------------------------
# 取不到 constraint_name 時的退路
# ---------------------------------------------------------------------------
def test_falls_back_to_scanning_the_message() -> None:
    """驅動版本不同時 `constraint_name` 可能為 None，需自訊息字串認出來。"""
    exc = make_integrity_error(
        None, 'duplicate key value violates exclusion constraint "orders_no_overlap"'
    )
    result = errors.translate_integrity_error(exc)
    assert result.status_code == 409


def test_unknown_constraint_becomes_internal_error_not_a_guess() -> None:
    """認不出來時回 500，**MUST NOT 猜一個訊息**。

    猜錯會讓使用者反覆修改一個根本不是問題的欄位。
    """
    result = errors.translate_integrity_error(make_integrity_error("some_future_constraint"))
    assert result.status_code == 500
    assert isinstance(result, errors.InternalError)


def test_internal_error_does_not_leak_the_cause_to_the_user() -> None:
    """憲章「錯誤處理」：MUST NOT 將 SQL、堆疊或內部細節回傳給用戶端。"""
    result = errors.translate_integrity_error(
        make_integrity_error("some_future_constraint", "INSERT INTO orders (secret_col) ...")
    )
    assert "INSERT" not in result.detail
    assert "orders" not in result.detail
    assert "some_future_constraint" not in result.detail
    # 真正的成因保留在伺服器端供除錯
    assert "some_future_constraint" in result.internal_reason  # type: ignore[attr-defined]
