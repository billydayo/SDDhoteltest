"""領域錯誤型別與資料庫約束的訊息轉譯。

兩件事在此集中：

1. `DomainError` — 帶有 HTTP 狀態碼與機器可讀 `code` 的應用層錯誤。
   全域例外處理器（T029）將其轉為 `{"detail": ..., "code": ...}`。
2. `translate_integrity_error()` — **以約束名稱分派**的 `IntegrityError` 轉譯。

關於第 2 點：`orders` 上有四個會產生 `IntegrityError` 的物件。只看例外型別會把
「夜數對不上」回成「已無空房」，使用者照著訊息改日期永遠改不好。因此 MUST 比對
約束名稱，且每個名稱 MUST 有對應的單元測試（plan.md、research R3、data-model.md）。

（放在 `sunny/errors.py` 而非 tasks.md 原訂的 `sunny/services/errors.py`：
`utils/dates.py` 需要引用 `DomainError`，而 utils 匯入 services 是反向的分層。）
"""

from __future__ import annotations

from typing import Final

from sqlalchemy.exc import IntegrityError


class DomainError(Exception):
    """應用層錯誤。

    `detail` 為給使用者看的繁體中文訊息，`code` 供前端做程式判斷。
    MUST NOT 夾帶堆疊追蹤、SQL 語句或內部檔案路徑（憲章「錯誤處理」條）。

    `field` 標明是哪一個欄位出問題。FR-010 要求「缺漏 MUST **逐欄**顯示訊息
    並將焦點移至第一個有問題的欄位，MUST NOT 只丟一句籠統的錯誤」——
    前端需要這個值才知道該把焦點放到哪裡。
    """

    def __init__(
        self,
        detail: str,
        *,
        code: str,
        status_code: int = 400,
        field: str | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status_code = status_code
        self.field = field


class InternalError(DomainError):
    """後端自身的錯誤，非使用者輸入問題。

    對外一律回覆同一句話——**MUST NOT 洩漏成因**。真正的原因寫進伺服器日誌。
    """

    def __init__(self, internal_reason: str, *, code: str = "INTERNAL_ERROR") -> None:
        super().__init__("系統發生內部錯誤，請稍後再試。", code=code, status_code=500)
        self.internal_reason = internal_reason


# ---------------------------------------------------------------------------
# 約束名稱 → 使用者訊息
# ---------------------------------------------------------------------------
# 這張表是 contracts/README.md 與 data-model.md 明列的行為約定。
# 四者都是 IntegrityError，語意卻完全不同。

#: 房況重疊。請求本身合法，是與其他資料的競態導致失敗，故為 409 而非 400。
CONSTRAINT_ORDERS_NO_OVERLAP: Final = "orders_no_overlap"
CONSTRAINT_VALID_DATE_RANGE: Final = "valid_date_range"
CONSTRAINT_NIGHTS_MATCHES_DATES: Final = "nights_matches_dates"
CONSTRAINT_ORDER_NO_UNIQUE: Final = "orders_order_no_key"
CONSTRAINT_PROFILES_EMAIL_UNIQUE: Final = "profiles_email_key"
CONSTRAINT_REVIEWS_ORDER_UNIQUE: Final = "reviews_order_id_key"


def _overlap() -> DomainError:
    return DomainError(
        "此房源於所選日期已無空房。",
        code="ROOM_UNAVAILABLE",
        status_code=409,
    )


def _invalid_date_range() -> DomainError:
    return DomainError(
        "退房日必須晚於入住日。",
        code="INVALID_DATE_RANGE",
        status_code=400,
    )


def _nights_mismatch() -> DomainError:
    # 後端算錯夜數，不是使用者的問題。對外回 500，成因只寫日誌。
    return InternalError(
        "nights 與 check_out - check_in 不一致，後端計算有誤",
        code="NIGHTS_MISMATCH",
    )


def _order_no_collision() -> DomainError:
    return InternalError("order_no 序號碰撞", code="ORDER_NO_COLLISION")


def _email_taken() -> DomainError:
    return DomainError(
        "此電子郵件已被註冊。",
        code="EMAIL_TAKEN",
        status_code=409,
    )


def _review_exists() -> DomainError:
    return DomainError(
        "此訂單已撰寫過評論。",
        code="REVIEW_EXISTS",
        status_code=409,
    )


_CONSTRAINT_HANDLERS: Final[dict[str, object]] = {
    CONSTRAINT_ORDERS_NO_OVERLAP: _overlap,
    CONSTRAINT_VALID_DATE_RANGE: _invalid_date_range,
    CONSTRAINT_NIGHTS_MATCHES_DATES: _nights_mismatch,
    CONSTRAINT_ORDER_NO_UNIQUE: _order_no_collision,
    CONSTRAINT_PROFILES_EMAIL_UNIQUE: _email_taken,
    CONSTRAINT_REVIEWS_ORDER_UNIQUE: _review_exists,
}


def constraint_name_of(exc: IntegrityError) -> str | None:
    """自 `IntegrityError` 取出違反的約束名稱。

    asyncpg 的原始例外帶有 `constraint_name`；取不到時退回掃描訊息字串。
    """
    orig = getattr(exc, "orig", None)

    name = getattr(orig, "constraint_name", None)
    if name:
        return str(name)

    # asyncpg 將細節放在 __cause__ 或例外的 args 中，視驅動版本而異
    for candidate in (getattr(orig, "__cause__", None), orig):
        name = getattr(candidate, "constraint_name", None)
        if name:
            return str(name)

    text = str(orig or exc)
    for known in _CONSTRAINT_HANDLERS:
        if known in text:
            return known
    return None


def translate_integrity_error(exc: IntegrityError) -> DomainError:
    """將 `IntegrityError` 轉為對應的 `DomainError`。

    **MUST 以約束名稱分派。** 認不出來時回 500 而非猜一個訊息——猜錯會讓使用者
    照著錯誤的指示反覆修改一個根本不是問題的欄位。
    """
    name = constraint_name_of(exc)
    handler = _CONSTRAINT_HANDLERS.get(name) if name else None
    if handler is None:
        return InternalError(f"未預期的資料庫約束違反：{name or exc}")
    return handler()  # type: ignore[operator]
