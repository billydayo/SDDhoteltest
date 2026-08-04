"""後台清單共用的篩選輸入處理。

放在 services 而非某個 router 裡，是因為**匯出端點必須用與清單端點完全相同的
規則解讀同一組參數**——SC-033 要求匯出的列數 100% 等於畫面上的筆數，而「兩端
皆空視為今日」這種預設值只要有一邊不一樣，兩個數字就對不上。

由某個 router 匯入另一個 router 的私有函式也能達成，但那會讓路由之間產生
不該有的相依方向；何況私有名稱本來就沒有承諾穩定。
"""

from __future__ import annotations

from datetime import date

from sunny.errors import DomainError
from sunny.utils import dates


def resolve_inclusive_range(start: str | None, end: str | None) -> tuple[date, date]:
    """把「起、迄」兩個可選欄位化為一個確定的含頭含尾區間（FR-051b）。

    三條規則：

    - 兩端皆空 → 今日單日
    - **只填一端 → 視為單日**，而不是「從那天到永遠」
    - 起始晚於結束 → **明確提示**

    最後一條是重點。回傳空清單看起來很無害，但使用者會讀成「這段期間沒有
    任何房源」，然後開始找不存在的問題。日期填反是輸入錯誤，要說出來。
    """
    parsed_start = dates.parse_calendar_date(start, field="起始日期") if start else None
    parsed_end = dates.parse_calendar_date(end, field="結束日期") if end else None

    if parsed_start is None and parsed_end is None:
        today = dates.today()
        return today, today
    if parsed_start is None:
        return parsed_end, parsed_end  # type: ignore[return-value]
    if parsed_end is None:
        return parsed_start, parsed_start

    if parsed_start > parsed_end:
        raise DomainError(
            "起始日期不可晚於結束日期。",
            code="INVALID_DATE_RANGE",
            status_code=400,
            field="startDate",
        )
    return parsed_start, parsed_end


def parse_optional_date(value: str | None, *, field: str) -> date | None:
    """可選的單一日期。空字串與 None 一律視為未填。"""
    return dates.parse_calendar_date(value, field=field) if value else None


def validate_open_range(start: date | None, end: date | None) -> None:
    """開放式區間（兩端皆可省略）的合理性檢查。

    與 `resolve_inclusive_range` 不同：那裡的空值有預設值（今日），這裡的
    空值就是「不限」。訂單與日誌的查詢屬後者——業者查「全部訂單」是常見需求，
    而「全部房源在今天的房態」才是房源頁的預設。
    """
    if start and end and start > end:
        raise DomainError(
            "起始日期不可晚於結束日期。",
            code="INVALID_DATE_RANGE",
            status_code=400,
            field="startDate",
        )


__all__ = ["parse_optional_date", "resolve_inclusive_range", "validate_open_range"]
