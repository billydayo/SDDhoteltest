"""房源搜尋的規則層：條件式必填、AND 篩選、排序。

純函式，不碰資料庫——實際查詢在 `repositories/rooms.py`。
"""

from __future__ import annotations

from datetime import date
from typing import Final

from sunny.errors import DomainError
from sunny.utils import dates

# ---------------------------------------------------------------------------
# 排序（FR-011）
# ---------------------------------------------------------------------------
SORT_PRICE_ASC: Final = "price_asc"
SORT_PRICE_DESC: Final = "price_desc"
SORT_RATING_ASC: Final = "rating_asc"
SORT_RATING_DESC: Final = "rating_desc"

VALID_SORTS: Final = frozenset({SORT_PRICE_ASC, SORT_PRICE_DESC, SORT_RATING_ASC, SORT_RATING_DESC})


def validate_sort(sort: str | None) -> str | None:
    """排序參數。未指定時由 repository 使用穩定的預設排序。"""
    if sort is None or sort in VALID_SORTS:
        return sort
    raise DomainError(
        "不支援的排序方式。",
        code="INVALID_SORT",
        field="sort",
    )


# ---------------------------------------------------------------------------
# 條件式必填（FR-010）
# ---------------------------------------------------------------------------
def validate_conditional_filters(
    check_in: str | None,
    check_out: str | None,
    guest_count: int | None,
) -> tuple[date | None, date | None, int | None]:
    """驗證入住日／退房日／人數三者的連動關係，回傳解析後的值。

    規則（FR-010，2026-08-01 修訂）：

    - 三者皆空 → **放行**。只以設施、房型特色、關鍵字或價格篩選是合法用法，
      MUST NOT 因為沒填日期就拒絕搜尋。
    - 填了入住日或退房日任一 → 另一個與人數 MUST 一併填寫。日期只填一半
      無法判定可訂性，放行只會讓使用者以為日期沒有作用。
    - 未填日期但填了人數 → **放行**。那是一個獨立可用的條件。
    - 人數只要有填就 MUST 為大於 0 的整數，**與是否填日期無關**。

    ⚠️ 此檢查 MUST 只在使用者按下「搜尋」時執行。首頁初次載入 MUST 仍顯示
    全部房源，訪客不必填任何條件就能瀏覽（FR-010、US1）。呼叫端因而只在
    帶有查詢參數時才呼叫本函式。

    ⚠️ 錯誤 MUST 逐欄指出，**MUST NOT 只丟一句籠統的訊息**——`field` 供前端
    把焦點移至第一個有問題的欄位。
    """
    # 人數的獨立檢查優先：它與日期無關，先報比較不會誤導。
    if guest_count is not None and guest_count <= 0:
        raise DomainError(
            "入住人數需為大於 0 的整數。",
            code="INVALID_GUEST_COUNT",
            field="guest_count",
        )

    has_in, has_out = check_in is not None, check_out is not None

    if not has_in and not has_out:
        # 三者皆空，或只填了人數——兩種都放行
        return None, None, guest_count

    if has_in and not has_out:
        raise DomainError(
            "填寫入住日時，退房日也需一併填寫。",
            code="INCOMPLETE_DATE_FILTER",
            field="check_out",
        )
    if has_out and not has_in:
        raise DomainError(
            "填寫退房日時，入住日也需一併填寫。",
            code="INCOMPLETE_DATE_FILTER",
            field="check_in",
        )

    if guest_count is None:
        raise DomainError(
            "填寫日期時，入住人數也需一併填寫。",
            code="GUEST_COUNT_REQUIRED",
            field="guest_count",
        )

    parsed_in = dates.parse_calendar_date(check_in, field="入住日")  # type: ignore[arg-type]
    parsed_out = dates.parse_calendar_date(check_out, field="退房日")  # type: ignore[arg-type]

    if parsed_out <= parsed_in:
        raise DomainError(
            "退房日必須晚於入住日。",
            code="INVALID_DATE_RANGE",
            field="check_out",
        )

    return parsed_in, parsed_out, guest_count


# ---------------------------------------------------------------------------
# 設施／房型特色的 AND 篩選（FR-010）
# ---------------------------------------------------------------------------
def matches_all(room_values: list[str], required: list[str]) -> bool:
    """房源是否**同時具備**所選的全部項目。

    ⚠️ **AND 而非 OR。** 用 OR 的話勾選越多結果越多，使用者會覺得篩選器壞了。

    此函式供測試與後備比對使用；正式查詢由 repository 以 jsonb 包含運算子
    `@>` 搭配 GIN 索引執行，避免把全部房源撈回 Python 端再過濾。
    """
    return set(required).issubset(set(room_values))


def normalize_filter_list(values: list[str] | None) -> list[str]:
    """整理多選條件：去除空白與重複，保持穩定順序。

    空清單與 None 一律視為「不篩選」（`matches_all` 對空清單回 True）。
    """
    if not values:
        return []
    seen: dict[str, None] = {}
    for value in values:
        cleaned = value.strip()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


__all__ = [
    "SORT_PRICE_ASC",
    "SORT_PRICE_DESC",
    "SORT_RATING_ASC",
    "SORT_RATING_DESC",
    "VALID_SORTS",
    "matches_all",
    "normalize_filter_list",
    "validate_conditional_filters",
    "validate_sort",
]
