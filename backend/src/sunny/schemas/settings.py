"""系統參數的 API 形狀（FR-098、FR-119、FR-120、FR-073）。"""

from __future__ import annotations

from pydantic import Field

from sunny.schemas.room import CamelModel


class SettingsOut(CamelModel):
    """可調整的營運參數。

    ⚠️ **可接受範圍隨值一起回傳。** 前端據此顯示提示與輸入限制，
    而不是自己硬編一份 5–1440——那份數字遲早會與資料庫的
    `settings_valid_range` CHECK 約束分歧，而分歧時使用者會看到一個
    「符合提示卻被拒絕」的錯誤（FR-119、FR-120）。
    """

    #: 未付款訂單的保留分鐘數（FR-098）
    pending_payment_minutes: int
    #: 設施與房型特色的詞彙表（FR-010a）
    room_amenities: list[str]
    room_features: list[str]

    #: 可接受範圍，供前端顯示提示
    pending_payment_min: int
    pending_payment_max: int


class SettingsIn(CamelModel):
    """調整參數。全部欄位可選——只送要改的那些。

    ⚠️ 沒有任何欄位能影響**既有**訂單的 `expires_at`（FR-101）。
    保留分鐘數只決定之後成立的訂單，這在介面上也要說清楚，否則管理員會以為
    調短之後現有的待付款訂單會提早釋出。
    """

    pending_payment_minutes: int | None = None
    room_amenities: list[str] | None = Field(default=None, max_length=100)
    room_features: list[str] | None = Field(default=None, max_length=100)


class ResetDemoDataIn(CamelModel):
    """還原示範資料（FR-073）。

    `confirm` MUST 為 true。做成請求主體的必要欄位而非 query 參數：
    一個誤點連結就能觸發的重置，不叫二次確認。
    """

    confirm: bool = False


class ResetResultOut(CamelModel):
    """還原結果。

    `auditLogPreserved` 恆為 true 並附上說明：管理員按下「還原所有資料」後
    會預期日誌也被清掉，而它沒有。**不說清楚會被當成 bug 回報**，
    然後有人「修好」它——那正是 SC-027 要防的事。
    """

    reset: bool
    audit_log_preserved: bool
    message: str


__all__ = ["ResetDemoDataIn", "ResetResultOut", "SettingsIn", "SettingsOut"]
