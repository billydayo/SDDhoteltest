"""T078：半開區間重疊判定（SC-003）。

`[a, b)` 與 `[c, d)` 重疊若且唯若 `a < d` 且 `c < b`。

**這裡驗的是後端的訊息品質，不是房況保證本身。** 真正的保證由資料庫的
`orders_no_overlap` 排除約束承擔，見 T080 的並行測試（憲章原則 IV）。
兩者都要有：這支測邏輯，那支測保證。
"""

from __future__ import annotations

from datetime import date

import pytest

from sunny.utils.dates import ranges_overlap


def d(month: int, day: int) -> date:
    return date(2026, month, day)


# ---------------------------------------------------------------------------
# 不重疊
# ---------------------------------------------------------------------------
def test_adjacent_ranges_do_not_overlap() -> None:
    """**最容易誤判為衝突的案例。**

    A 訂 8/01–8/03、B 訂 8/03–8/05。A 在 8/03 早上退房，B 當天下午入住。
    這必須成功——判錯會讓平台平白損失一半的可售天數。
    """
    assert ranges_overlap(d(8, 1), d(8, 3), d(8, 3), d(8, 5)) is False


def test_adjacent_ranges_do_not_overlap_reversed() -> None:
    assert ranges_overlap(d(8, 3), d(8, 5), d(8, 1), d(8, 3)) is False


def test_disjoint_ranges_do_not_overlap() -> None:
    assert ranges_overlap(d(8, 1), d(8, 3), d(8, 10), d(8, 12)) is False


# ---------------------------------------------------------------------------
# 重疊
# ---------------------------------------------------------------------------
def test_fully_contained_range_overlaps() -> None:
    """既有 8/01–8/10，新訂 8/03–8/05 完全落在其中，必須被拒。"""
    assert ranges_overlap(d(8, 1), d(8, 10), d(8, 3), d(8, 5)) is True


def test_containing_range_overlaps() -> None:
    assert ranges_overlap(d(8, 3), d(8, 5), d(8, 1), d(8, 10)) is True


def test_identical_ranges_overlap() -> None:
    assert ranges_overlap(d(8, 1), d(8, 5), d(8, 1), d(8, 5)) is True


def test_partial_overlap_at_start() -> None:
    assert ranges_overlap(d(8, 1), d(8, 5), d(8, 3), d(8, 8)) is True


def test_partial_overlap_at_end() -> None:
    assert ranges_overlap(d(8, 3), d(8, 8), d(8, 1), d(8, 5)) is True


def test_single_night_inside_longer_stay_overlaps() -> None:
    assert ranges_overlap(d(8, 1), d(8, 10), d(8, 5), d(8, 6)) is True


# ---------------------------------------------------------------------------
# 對稱性：重疊是對稱關係，換邊必須得到相同結果
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("a_in", "a_out", "b_in", "b_out"),
    [
        (d(8, 1), d(8, 3), d(8, 3), d(8, 5)),
        (d(8, 1), d(8, 10), d(8, 3), d(8, 5)),
        (d(8, 1), d(8, 5), d(8, 3), d(8, 8)),
        (d(8, 1), d(8, 3), d(8, 10), d(8, 12)),
    ],
)
def test_overlap_is_symmetric(a_in: date, a_out: date, b_in: date, b_out: date) -> None:
    assert ranges_overlap(a_in, a_out, b_in, b_out) == ranges_overlap(b_in, b_out, a_in, a_out)


# ---------------------------------------------------------------------------
# 跨月與跨年的邊界
# ---------------------------------------------------------------------------
def test_month_boundary_adjacency() -> None:
    """8/30–9/01 與 9/01–9/03 相鄰不重疊。"""
    assert ranges_overlap(d(8, 30), d(9, 1), d(9, 1), d(9, 3)) is False


def test_year_boundary_overlap() -> None:
    assert (
        ranges_overlap(date(2026, 12, 30), date(2027, 1, 3), date(2027, 1, 1), date(2027, 1, 2))
        is True
    )
