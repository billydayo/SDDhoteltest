"""風險評分的後端側（FR-068、SC-016、FR-104）。

T143 以 `frontend/src/lib/riskScore.test.ts` 驗證前端那份實作。本檔驗證後端
這一份——**兩份實作各自需要測試**，因為它們會分開改壞，而分歧的症狀是
「畫面顯示中風險、資料庫存的是高風險」，沒有任何錯誤訊息。

不需要資料庫：這是純算術。
"""

from __future__ import annotations

import pytest

from sunny.errors import DomainError
from sunny.models.risk_check import LEVEL_HIGH, LEVEL_LOW, LEVEL_MEDIUM
from sunny.services.risk import assess, level_of


def test_formula_matches_the_specification() -> None:
    """100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)（FR-068）。"""
    # 0.4×80 + 0.35×60 + 0.25×40 = 32 + 21 + 10 = 63 → 100 − 63 = 37
    assert assess(brightness=80, clutter=60, contrast=40).risk_score == 37


def test_perfect_photo_has_zero_risk() -> None:
    """三項皆滿分 → 風險 0。指標越高越好，風險分數越高越糟——方向相反。"""
    result = assess(brightness=100, clutter=100, contrast=100)
    assert result.risk_score == 0
    assert result.risk_level == LEVEL_LOW


def test_worst_photo_has_maximum_risk() -> None:
    result = assess(brightness=0, clutter=0, contrast=0)
    assert result.risk_score == 100
    assert result.risk_level == LEVEL_HIGH


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0, LEVEL_LOW),
        (34, LEVEL_LOW),
        (35, LEVEL_MEDIUM),  # 切分點
        (59, LEVEL_MEDIUM),
        (60, LEVEL_HIGH),  # 切分點
        (100, LEVEL_HIGH),
    ],
)
def test_level_boundaries(score: int, expected: str) -> None:
    """0–34 低／35–59 中／60–100 高（FR-068）。

    只測邊界值。34/35 與 59/60 這四個數字是唯一會出錯的地方——
    中間的值錯不了，除非整個判斷式寫反。
    """
    assert level_of(score) == expected


def test_three_sample_categories_do_not_all_land_in_one_level() -> None:
    """**過暗、雜亂、正常三類 MUST NOT 全部落在同一等級**（SC-016）。

    這是 SC-016 對公式有效性的定義。若權重調到某個組合讓所有照片都是「中」，
    這個功能就沒有在區分任何東西——而它仍會回傳分數，看起來一切正常。
    """
    dark = assess(brightness=15, clutter=70, contrast=30)
    cluttered = assess(brightness=75, clutter=20, contrast=65)
    normal = assess(brightness=85, clutter=90, contrast=80)

    levels = {dark.risk_level, cluttered.risk_level, normal.risk_level}
    assert len(levels) > 1, f"三類樣本全落在同一等級：{levels}"
    assert normal.risk_score < dark.risk_score, "正常照片的風險 MUST 低於過暗照片"


def test_rounding_is_half_up_not_truncation() -> None:
    """四捨五入而非無條件捨去。

    0.4×83 + 0.35×83 + 0.25×83 = 83 → 17，整數；改用會產生小數的組合：
    0.4×81 + 0.35×82 + 0.25×83 = 32.4 + 28.7 + 20.75 = 81.85 → 100 − 81.85
    = 18.15 → 18。
    """
    assert assess(brightness=81, clutter=82, contrast=83).risk_score == 18


@pytest.mark.parametrize(
    ("brightness", "clutter", "contrast"),
    [(-1, 50, 50), (101, 50, 50), (50, -1, 50), (50, 50, 101)],
)
def test_out_of_range_metrics_are_rejected(brightness: int, clutter: int, contrast: int) -> None:
    """超出 0–100 MUST 被拒絕，且是**使用者錯誤**而非 500。

    資料庫的 CHECK 約束是最後一道網；讓它先在這裡以可讀訊息擋下來，
    是為了訊息品質而非為了正確性（憲章原則 IV）。
    """
    with pytest.raises(DomainError) as exc:
        assess(brightness=brightness, clutter=clutter, contrast=contrast)
    assert exc.value.status_code == 400
    assert exc.value.code == "INVALID_RISK_METRIC"
    assert exc.value.field is not None, "MUST 指出是哪一個欄位有問題（FR-010）"


def test_score_never_leaves_the_valid_range() -> None:
    """任何合法輸入的分數皆落在 0–100，符合資料庫的 CHECK 約束。"""
    for value in (0, 1, 33, 50, 67, 99, 100):
        result = assess(brightness=value, clutter=value, contrast=value)
        assert 0 <= result.risk_score <= 100
