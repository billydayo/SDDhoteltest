"""匯出端點的 API 形狀（FR-058、FR-058a、FR-060）。"""

from __future__ import annotations

from typing import Any

from sunny.schemas.room import CamelModel


class ColumnOut(CamelModel):
    """一個欄位的資料鍵與**繁體中文表頭**（FR-069）。"""

    key: str
    label: str


class ExportOut(CamelModel):
    """一次匯出的內容。

    ⚠️ `rows` 為空時 `hasData` 為 false，前端 MUST 顯示 `message` 且
    **MUST NOT 產生空檔案**（FR-060）。後端同時也不會寫入稽核紀錄——
    沒有檔案離開系統，就沒有東西需要稽核（FR-058a）。

    `format` 回傳的是**實際被記錄的格式**。前端在 xlsx 函式庫載入失敗時會退回
    CSV（FR-059），那次退回也要如實記錄，因此格式由前端於請求時聲明，
    而非由後端假設。
    """

    module: str
    format: str
    columns: list[ColumnOut]
    rows: list[dict[str, Any]]
    row_count: int
    has_data: bool
    #: 0 筆時的提示文字；有資料時為 None
    message: str | None = None


__all__ = ["ColumnOut", "ExportOut"]
