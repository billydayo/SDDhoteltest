"""房源的 API 形狀。

## 命名轉換

資料庫一律 snake_case，API 的 JSON 一律 **camelCase**。轉換 MUST 只發生在
Pydantic 模型的序列化設定中（憲章原則 III），MUST NOT 逐端點各自決定，
更 MUST NOT 散落於各路由。此處以 `alias_generator=to_camel` 一次設定。

## average_rating 為什麼是 `Decimal | None` 而不是 `float`

`null` 代表**尚無評分**，MUST NOT 以 0 表示（FR-047）——0 分會被讀成
「評價極差」，而實際上是還沒有人評過。前端據此顯示「尚無評分」。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """全站共用的基底：輸出 camelCase，同時接受 snake_case 輸入。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class RoomOut(CamelModel):
    """房源列表與詳情的輸出。

    **欄位明列**，不使用萬用的欄位傾倒——這樣新增資料庫欄位時不會意外外洩。
    """

    id: uuid.UUID
    name: str
    type: str
    max_guests: int
    #: 整數新臺幣元，MUST NOT 出現小數（FR-070）
    nightly_price: int
    images: list[str]
    amenities: list[str]
    features: list[str]
    description: str
    #: `available` / `maintenance`——不分日期的營運狀態
    status: str
    #: **null = 尚無評分**（FR-047）
    average_rating: Decimal | None
    created_at: datetime


class RoomDetailOut(RoomOut):
    """詳情頁：多帶當日房態與最新一次品質檢測。

    ⚠️ **不要用 `model_validate(room)` 建構**——`availability` 是推導值，
    ORM 物件上沒有這個屬性，驗證會失敗。用 `from_room()`。
    """

    #: `available` / `booked` / `maintenance`——**依所查日期推導**（FR-015）
    availability: str
    #: 尚未檢測時為 None，前端顯示「尚未檢測」而非 0 分或空白（FR-014）
    latest_risk_check: RiskCheckOut | None = None

    @classmethod
    def from_room(
        cls,
        room: object,
        *,
        availability: str,
        latest_risk_check: RiskCheckOut | None = None,
    ) -> RoomDetailOut:
        """由 ORM 房源加上兩個推導值組成詳情。

        房態刻意不是 Room 的屬性：它綁定日期，同一間房在不同日期有不同答案
        （FR-015）。做成屬性就得選一個日期，而那個選擇一定是錯的。
        """
        return cls(
            **RoomOut.model_validate(room).model_dump(by_alias=False),
            availability=availability,
            latest_risk_check=latest_risk_check,
        )


class RiskCheckOut(CamelModel):
    """房源品質檢測結果（FR-106）。"""

    brightness: int
    clutter: int
    contrast: int
    risk_score: int
    risk_level: str
    image_path: str
    created_at: datetime


class VocabularyOut(CamelModel):
    """設施與房型特色的可選項目（FR-010a）。

    **對未登入的訪客可讀**，否則前台的篩選器會是空的。
    """

    amenities: list[str]
    features: list[str]


RoomDetailOut.model_rebuild()

__all__ = ["CamelModel", "RiskCheckOut", "RoomDetailOut", "RoomOut", "VocabularyOut"]
