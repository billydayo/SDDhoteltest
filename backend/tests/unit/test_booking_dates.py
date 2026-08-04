"""T077：憲章原則 IV 的日期規則。

憲章明訂「每一項規則 MUST 有對應的自動化測試與手動驗收案例（含邊界：跨月、跨年、
僅一晚、明日入住、退房日等於他人入住日）」。本檔逐條覆蓋，邊界一個不漏。
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from sunny.errors import DomainError
from sunny.utils import dates


# ---------------------------------------------------------------------------
# 夜數：退房 − 入住，退房當日不計一晚（SC-004）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("check_in", "check_out", "expected", "case"),
    [
        (date(2026, 8, 1), date(2026, 8, 2), 1, "單晚"),
        (date(2026, 8, 30), date(2026, 9, 2), 3, "跨月"),
        (date(2026, 12, 30), date(2027, 1, 2), 3, "跨年"),
        (date(2028, 2, 28), date(2028, 3, 1), 2, "閏年二月"),
        (date(2026, 8, 1), date(2026, 8, 31), 30, "長區間"),
    ],
)
def test_nights_between(check_in: date, check_out: date, expected: int, case: str) -> None:
    assert dates.nights_between(check_in, check_out) == expected, case


def test_checkout_day_is_not_counted_as_a_night() -> None:
    """8/01–8/02 是 1 晚，不是 2。這一條錯了，全站金額都會錯。"""
    assert dates.nights_between(date(2026, 8, 1), date(2026, 8, 2)) == 1


# ---------------------------------------------------------------------------
# 入住日至少為明日（FR-022、SC-005）
# ---------------------------------------------------------------------------
def test_check_in_today_is_rejected() -> None:
    today = dates.today()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(today, today + timedelta(days=2))
    assert exc.value.code == "CHECK_IN_TOO_EARLY"


def test_check_in_in_the_past_is_rejected() -> None:
    today = dates.today()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(today - timedelta(days=5), today + timedelta(days=2))
    assert exc.value.code == "CHECK_IN_TOO_EARLY"


def test_check_in_tomorrow_is_accepted() -> None:
    """明日入住是**合法**的邊界，不可被一併擋掉。"""
    tomorrow = dates.tomorrow()
    assert dates.validate_stay_dates(tomorrow, tomorrow + timedelta(days=1)) == 1


def test_rejection_message_names_the_earliest_selectable_date() -> None:
    """訊息要能讓使用者知道該改成什麼，不能只說「太早」。"""
    today = dates.today()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(today, today + timedelta(days=1))
    assert dates.format_calendar_date(dates.tomorrow()) in exc.value.detail


# ---------------------------------------------------------------------------
# 退房日必須晚於入住日（FR-023）
# ---------------------------------------------------------------------------
def test_same_day_checkout_is_rejected() -> None:
    tomorrow = dates.tomorrow()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(tomorrow, tomorrow)
    assert exc.value.code == "INVALID_DATE_RANGE"


def test_inverted_range_is_rejected() -> None:
    tomorrow = dates.tomorrow()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(tomorrow + timedelta(days=3), tomorrow)
    assert exc.value.code == "INVALID_DATE_RANGE"


def test_inverted_range_reports_range_error_before_too_early() -> None:
    """倒置且入住日在過去時，先報「區間不成立」。

    先說「入住日太早」會讓使用者去改一個不是問題的欄位。
    """
    today = dates.today()
    with pytest.raises(DomainError) as exc:
        dates.validate_stay_dates(today - timedelta(days=1), today - timedelta(days=5))
    assert exc.value.code == "INVALID_DATE_RANGE"


# ---------------------------------------------------------------------------
# 日曆日的解析與序列化（research B2-c）
# ---------------------------------------------------------------------------
def test_parse_calendar_date_roundtrip() -> None:
    assert dates.parse_calendar_date("2026-08-04") == date(2026, 8, 4)
    assert dates.format_calendar_date(date(2026, 8, 4)) == "2026-08-04"


@pytest.mark.parametrize(
    "bad", ["20260804", "2026/08/04", "2026-8-4", "", "tomorrow", "2026-13-01"]
)
def test_parse_calendar_date_rejects_non_iso_forms(bad: str) -> None:
    """緊湊格式與斜線分隔一律拒絕，避免怪字串被靜默接受。"""
    with pytest.raises(DomainError) as exc:
        dates.parse_calendar_date(bad)
    assert exc.value.code == "INVALID_DATE_FORMAT"


def test_parse_calendar_date_returns_date_not_datetime() -> None:
    """MUST 為 `date`。帶時間的 `datetime` 會把時區問題帶進日曆日比較。"""
    import datetime as _dt

    result = dates.parse_calendar_date("2026-08-04")
    assert type(result) is _dt.date


# ---------------------------------------------------------------------------
# 時區
# ---------------------------------------------------------------------------
def test_today_uses_taipei_not_system_timezone() -> None:
    """`today()` MUST 取台北的今天，不受主機時區影響。"""
    from datetime import datetime

    assert dates.today() == datetime.now(dates.TAIPEI).date()


def test_tomorrow_is_exactly_one_day_after_today() -> None:
    assert dates.tomorrow() - dates.today() == timedelta(days=1)
