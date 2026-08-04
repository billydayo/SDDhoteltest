"""首頁內容的 API 形狀（FR-061）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from sunny.schemas.room import CamelModel


class SiteContentOut(CamelModel):
    """前台首頁的可編輯內容。

    `heroImage` 可能是本系統的上傳路徑（`/uploads/...`）或外部圖片網址，
    兩者混用是允許的（FR-061）。前台 MUST 為其提供有意義的替代文字——
    主視覺沒有 `alt` 是最常見的無障礙缺失（憲章原則 V）。
    """

    hero_title: str
    hero_subtitle: str
    hero_image: str
    updated_at: datetime


class SiteContentIn(CamelModel):
    """編輯首頁內容（FR-061）。

    三個欄位皆為必填而非部分更新：這個表單一次呈現全部三項，送出的就是使用者
    在畫面上看到的完整狀態。做成部分更新會讓「清空副標」與「不動副標」在
    傳輸層變成同一件事。

    `heroImage` 允許空字串——那是「不使用主圖」，前台改以純色底渲染。
    """

    hero_title: str = Field(min_length=1, max_length=120)
    hero_subtitle: str = Field(default="", max_length=200)
    hero_image: str = Field(default="", max_length=2000)


__all__ = ["SiteContentIn", "SiteContentOut"]
