"""T046／T047：搜尋的條件式必填與設施 AND 篩選（FR-010、FR-010a、FR-015）。

條件式必填的規則不直覺，值得完整寫出來（FR-010）：

| 入住日 | 退房日 | 人數 | 結果 |
|---|---|---|---|
| 空 | 空 | 空 | **放行**——只用設施或關鍵字篩選是合法用法 |
| 有 | 空 | — | 拒絕：日期只填一半無法判定可訂性 |
| 空 | 有 | — | 拒絕 |
| 有 | 有 | 空 | 拒絕 |
| 空 | 空 | 有 | **放行**——人數是獨立可用的條件 |

這條原先訂為三欄無條件必填，實作後發現只想用設施篩選的使用者按下搜尋完全
沒有反應，等同把篩選器鎖住，因此改為條件式。
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from sunny.errors import DomainError
from sunny.services import search
from sunny.utils import dates


def _tomorrow() -> str:
    return dates.format_calendar_date(dates.tomorrow())


def _later(days: int) -> str:
    return dates.format_calendar_date(dates.tomorrow() + timedelta(days=days))


# ---------------------------------------------------------------------------
# 條件式必填（FR-010）
# ---------------------------------------------------------------------------
def test_all_three_blank_is_allowed() -> None:
    """三者皆空 MUST 正常搜尋。

    **MUST NOT 因為沒填日期就拒絕搜尋**——只以設施、房型特色、關鍵字或
    價格篩選是合法用法。
    """
    assert search.validate_conditional_filters(None, None, None) == (None, None, None)


def test_guest_count_alone_is_allowed() -> None:
    """未填日期但填了人數 MUST 正常搜尋——那是一個獨立可用的條件。"""
    _, _, guests = search.validate_conditional_filters(None, None, 2)
    assert guests == 2


@pytest.mark.parametrize(
    ("check_in", "check_out"),
    [(_tomorrow(), None), (None, _tomorrow())],
    ids=["只填入住日", "只填退房日"],
)
def test_half_a_date_range_is_rejected(check_in: str | None, check_out: str | None) -> None:
    """日期只填一半無法判定可訂性，放行只會讓使用者以為日期沒有作用。"""
    with pytest.raises(DomainError) as exc:
        search.validate_conditional_filters(check_in, check_out, 2)
    assert exc.value.code == "INCOMPLETE_DATE_FILTER"


def test_dates_without_guest_count_is_rejected() -> None:
    with pytest.raises(DomainError) as exc:
        search.validate_conditional_filters(_tomorrow(), _later(2), None)
    assert exc.value.code == "GUEST_COUNT_REQUIRED"


def test_complete_filter_is_accepted() -> None:
    ci, co, guests = search.validate_conditional_filters(_tomorrow(), _later(2), 2)
    assert (ci, co, guests) == (dates.tomorrow(), dates.tomorrow() + timedelta(days=2), 2)


@pytest.mark.parametrize("bad", [0, -1])
def test_non_positive_guest_count_is_rejected_regardless_of_dates(bad: int) -> None:
    """入住人數只要有填就 MUST 為大於 0 的整數，**與是否填日期無關**。"""
    with pytest.raises(DomainError) as exc:
        search.validate_conditional_filters(None, None, bad)
    assert exc.value.code == "INVALID_GUEST_COUNT"


def test_error_names_the_offending_field() -> None:
    """缺漏 MUST 逐欄顯示訊息，MUST NOT 只丟一句籠統的錯誤。"""
    with pytest.raises(DomainError) as exc:
        search.validate_conditional_filters(_tomorrow(), None, 2)
    assert exc.value.field == "check_out"


def test_inverted_range_is_rejected_at_search_too() -> None:
    """搜尋階段就該擋掉倒置的日期，不必等到建立訂單。"""
    with pytest.raises(DomainError):
        search.validate_conditional_filters(_later(5), _later(2), 2)


# ---------------------------------------------------------------------------
# 設施 AND 篩選（FR-010）
# ---------------------------------------------------------------------------
def test_amenity_filter_uses_and_not_or() -> None:
    """勾選兩項設施時，僅**同時具備**兩者的房源符合。

    用 OR 的話勾越多結果越多，使用者會覺得篩選器壞了。
    """
    rooms = [
        {"name": "A", "amenities": ["浴缸", "陽台"]},
        {"name": "B", "amenities": ["浴缸"]},
        {"name": "C", "amenities": ["陽台"]},
        {"name": "D", "amenities": ["浴缸", "陽台", "書桌"]},
    ]
    matched = [r["name"] for r in rooms if search.matches_all(r["amenities"], ["浴缸", "陽台"])]
    assert matched == ["A", "D"]


def test_empty_amenity_filter_matches_everything() -> None:
    assert search.matches_all([], []) is True
    assert search.matches_all(["浴缸"], []) is True


def test_room_without_the_amenity_does_not_match() -> None:
    assert search.matches_all(["浴缸"], ["陽台"]) is False


# ---------------------------------------------------------------------------
# 排序（FR-011）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("sort", ["price_asc", "price_desc", "rating_asc", "rating_desc", None])
def test_known_sort_options_are_accepted(sort: str | None) -> None:
    search.validate_sort(sort)


def test_unknown_sort_is_rejected() -> None:
    with pytest.raises(DomainError) as exc:
        search.validate_sort("popularity")
    assert exc.value.code == "INVALID_SORT"
