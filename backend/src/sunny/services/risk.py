"""房源品質檢測的評分（FR-068、FR-104）。

## 為什麼後端要再算一次

三項指標（亮度、雜亂度、對比）**只能在瀏覽器算**——影像分析在 Canvas 上做，
後端沒有解碼圖片的相依，也不該為了這件事引入一個。

但總分與等級是**純算術**，後端因此重算而不採信客戶端送來的值。理由不是防範
惡意（管理員本來就有權新增檢測），而是防範**分歧**：同一組指標在前後端算出
不同的分數時，畫面上顯示的與資料庫存的會不一樣，而那種不一致沒有任何錯誤
訊息，只有「怎麼跟剛剛看到的不同」。

前端的 `riskScore.ts`（T145）與本模組是同一條公式的兩份實作。
兩份實作是必要之惡（一份要即時回饋、一份要當真相），但**只有純算術的那段
被複製**，影像分析沒有。

## 公式

    風險分數 = 100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)

三項指標各 0–100，**100 表示表現較佳**；風險分數則**越高代表風險越高**。
等級切分：0–34 低／35–59 中／60–100 高（FR-068、SC-016）。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from sunny.errors import DomainError
from sunny.models.risk_check import LEVEL_HIGH, LEVEL_LOW, LEVEL_MEDIUM

#: 三項指標的權重。總和為 1.0。
WEIGHT_BRIGHTNESS: Final = Decimal("0.4")
WEIGHT_CLUTTER: Final = Decimal("0.35")
WEIGHT_CONTRAST: Final = Decimal("0.25")

#: 等級切分（FR-068）。**上界含**：34 是低、35 是中、59 是中、60 是高。
LEVEL_MEDIUM_FROM: Final = 35
LEVEL_HIGH_FROM: Final = 60

#: 指標的合法範圍。資料庫的 CHECK 約束是最後一道網（models/risk_check.py）。
METRIC_MIN: Final = 0
METRIC_MAX: Final = 100


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    """一次檢測的評分結果。"""

    brightness: int
    clutter: int
    contrast: int
    risk_score: int
    risk_level: str


def _validate(name: str, label: str, value: int) -> None:
    if not METRIC_MIN <= value <= METRIC_MAX:
        raise DomainError(
            f"{label}需介於 {METRIC_MIN} 至 {METRIC_MAX} 之間。",
            code="INVALID_RISK_METRIC",
            status_code=400,
            field=name,
        )


def level_of(risk_score: int) -> str:
    """由風險分數判定等級（FR-068）。

    切分點寫成常數而非魔術數字：SC-016 要求過暗、雜亂、正常三類樣本
    MUST NOT 全部落在同一等級——若哪天切分需要調整，只有這裡要改，
    而不是散落在後端與前端的四個 if。
    """
    if risk_score >= LEVEL_HIGH_FROM:
        return LEVEL_HIGH
    if risk_score >= LEVEL_MEDIUM_FROM:
        return LEVEL_MEDIUM
    return LEVEL_LOW


def assess(*, brightness: int, clutter: int, contrast: int) -> RiskAssessment:
    """由三項指標算出風險分數與等級。

    以 `Decimal` 而非 float 計算：0.4 + 0.35 + 0.25 在 float 下不精確，
    邊界上的一分之差會讓等級跳格。四捨五入至整數（`ROUND_HALF_UP`），
    與資料庫的 `risk_score between 0 and 100` 相容。
    """
    _validate("brightness", "亮度", brightness)
    _validate("clutter", "雜亂度", clutter)
    _validate("contrast", "對比", contrast)

    weighted = (
        WEIGHT_BRIGHTNESS * brightness + WEIGHT_CLUTTER * clutter + WEIGHT_CONTRAST * contrast
    )
    score = int((Decimal(100) - weighted).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    # 權重總和為 1 且指標皆在 0–100，理論上 score 必落在 0–100。
    # 仍然夾住：若哪天有人改了權重卻忘了改這裡，寧可分數失真也不要讓
    # 資料庫的 CHECK 把一次正常的檢測變成 500。
    score = max(METRIC_MIN, min(METRIC_MAX, score))

    return RiskAssessment(
        brightness=brightness,
        clutter=clutter,
        contrast=contrast,
        risk_score=score,
        risk_level=level_of(score),
    )


__all__ = [
    "LEVEL_HIGH_FROM",
    "LEVEL_MEDIUM_FROM",
    "METRIC_MAX",
    "METRIC_MIN",
    "WEIGHT_BRIGHTNESS",
    "WEIGHT_CLUTTER",
    "WEIGHT_CONTRAST",
    "RiskAssessment",
    "assess",
    "level_of",
]
