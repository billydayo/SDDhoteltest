"""日曆日處理。憲章原則 IV 的日期規則都在這裡。

三條不可妥協的規則：

1. **日曆日以 `datetime.date` 承載**，MUST NOT 用帶時間的 `datetime`。
   `YYYY-MM-DD` 與 PostgreSQL 的 `date` 一對一對應，沒有時區成分可以出錯。
2. **時區固定 Asia/Taipei 且於程式內明確指定**，MUST NOT 依賴伺服器的本機時區設定。
   部署到 UTC 主機時，「今天」會差一整天。
3. **重疊判定採半開區間**：`[a, b)` 與 `[c, d)` 重疊若且唯若 `a < d` 且 `c < b`。
   前一筆的退房日等於後一筆的入住日**不算重疊**——這是最容易誤判為衝突的案例。

本模組是**純函式**，不碰資料庫。真正的房況保證由 `orders_no_overlap` 排除約束
承擔（憲章原則 IV：後端的檢查是授權與訊息品質，資料庫的約束才是保證）。
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sunny.errors import DomainError

#: 全站唯一時區。MUST 明確指定，MUST NOT 依賴 `datetime.now()` 的本機時區。
TAIPEI = ZoneInfo("Asia/Taipei")

#: 日曆日的線上格式（contracts/README.md）
CALENDAR_DATE_FORMAT = "%Y-%m-%d"


def now_taipei() -> datetime:
    """帶時區的此刻。

    **一定要帶時區。** `datetime.now()` 產出的無時區值與資料庫回來的
    `timestamptz` 相比會直接拋 TypeError；更糟的是若兩邊都無時區，比較會靜默
    地用錯的基準，逾期判定就會差八小時。
    """
    return datetime.now(TAIPEI)


def today() -> date:
    """台北時區的今天。"""
    return now_taipei().date()


def tomorrow() -> date:
    """台北時區的明天——訂房的最早可選日期（FR-022）。"""
    return today() + timedelta(days=1)


#: 嚴格的 `YYYY-MM-DD`：四位年、兩位月、兩位日，**必須補零**。
_CALENDAR_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_calendar_date(value: str, *, field: str = "日期") -> date:
    """嚴格解析 `YYYY-MM-DD`。

    兩層檢查，缺一不可：

    - `date.fromisoformat` 在 Python 3.11+ 接受 `20260804` 這種緊湊格式，
      `strptime("%Y-%m-%d")` 則接受 `2026-8-4` 這種未補零的形式。兩者都不是
      contracts/README.md 所定的線上格式。
    - **未補零特別危險**：日期字串在本專案會被排序與比較，而 `"2026-8-4"`
      在字典序下大於 `"2026-08-05"`。這種錯不會拋例外，只會讓順序悄悄錯掉。

    因此先以正規式鎖住形狀，再交給 `strptime` 驗證該日期真的存在（擋掉 2026-02-30）。
    """
    if not isinstance(value, str) or not _CALENDAR_DATE_RE.match(value):
        raise DomainError(
            f"{field}格式錯誤，需為 YYYY-MM-DD（月與日需補零）。",
            code="INVALID_DATE_FORMAT",
        )
    try:
        return datetime.strptime(value, CALENDAR_DATE_FORMAT).date()
    except ValueError as exc:
        raise DomainError(
            f"{field}不是有效的日期。",
            code="INVALID_DATE_FORMAT",
        ) from exc


def format_calendar_date(value: date) -> str:
    """序列化為 `YYYY-MM-DD`。"""
    return value.strftime(CALENDAR_DATE_FORMAT)


def nights_between(check_in: date, check_out: date) -> int:
    """夜數 = 退房日 − 入住日。**退房當日不計為一晚。**

    8/01–8/02 為 1 晚，不是 0 也不是 2。
    """
    return (check_out - check_in).days


def ranges_overlap(a_in: date, a_out: date, b_in: date, b_out: date) -> bool:
    """半開區間 `[a_in, a_out)` 與 `[b_in, b_out)` 是否重疊。

    重疊若且唯若 `a_in < b_out` 且 `b_in < a_out`。

    相鄰不重疊：A 為 8/01–8/03、B 為 8/03–8/05 → `False`（B 必須訂得成）。
    完全包含：A 為 8/01–8/10、B 為 8/03–8/05 → `True`。
    """
    return a_in < b_out and b_in < a_out


def validate_stay_dates(check_in: date, check_out: date) -> int:
    """驗證入住區間並回傳夜數。

    規則（FR-022、FR-023、憲章原則 IV）：

    - 入住日 MUST 至少為明日；今日與過去的日期 MUST 被拒絕
    - 退房日 MUST 晚於入住日至少一晚；相同或倒置 MUST 被拒絕

    **順序有意義**：先檢查區間本身是否成立，再檢查是否夠早。使用者送出
    8/10–8/08 這種倒置區間時，先告訴他「退房日必須晚於入住日」比先說
    「入住日太早」有用——後者會讓他去改一個不是問題的欄位。
    """
    if check_out <= check_in:
        raise DomainError("退房日必須晚於入住日。", code="INVALID_DATE_RANGE")

    earliest = tomorrow()
    if check_in < earliest:
        raise DomainError(
            f"訂房需提前一天，最早可選日期為 {format_calendar_date(earliest)}。",
            code="CHECK_IN_TOO_EARLY",
        )

    return nights_between(check_in, check_out)
