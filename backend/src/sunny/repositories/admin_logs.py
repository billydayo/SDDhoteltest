"""操作日誌的查詢（FR-114、FR-115、FR-117）。

⚠️ **本檔只有讀取。沒有 update，沒有 delete，日後也 MUST NOT 加。**

`admin_logs` 上的 UPDATE 與 DELETE 已自應用角色 REVOKE（T019）。即使有人在
這裡寫了一個 `delete()`，它在正式連線下也只會拋權限錯誤——但那是**執行期**
才發現的事，而這個檔案的空缺是**閱讀時**就看得見的。兩層都要（FR-116、SC-027）。

寫入的唯一入口是 `services/audit.py`。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, select

from sunny.models.admin_log import AdminLog
from sunny.models.profile import Profile
from sunny.repositories.base import Repository
from sunny.utils import dates

#: 一列日誌檢視：紀錄本身，加上操作者顯示名稱。
LogRow = tuple[AdminLog, str | None]


def _day_start(day: date) -> datetime:
    """台北時區當日零時。

    篩選條件是使用者輸入的**日曆日**，而 `created_at` 是帶時區的時間戳。
    以 UTC 切日會讓台北時間早上 8 點前的操作被歸到前一天——業者查「今天做了
    什麼」時，那幾筆會憑空消失。
    """
    return datetime.combine(day, time.min, tzinfo=dates.TAIPEI)


class AdminLogRepository(Repository):
    """跨會員的日誌查詢。**僅供 `require_admin` 的路由使用**（FR-117）。"""

    def _base_query(self) -> Select:
        return select(AdminLog, Profile.display_name).join(Profile, Profile.id == AdminLog.actor_id)

    async def search(
        self,
        *,
        actor_id: uuid.UUID | None = None,
        action: str | None = None,
        start: date | None = None,
        end: date | None = None,
        limit: int = 500,
    ) -> list[LogRow]:
        """依操作者、動作類型與日期區間篩選，**由新到舊**（FR-115）。

        日期區間**含頭含尾**：`end` 那一整天都要納入，因此上界取隔日零時。
        寫成 `<= end 當日零時` 會把當天的每一筆都排除掉，而那正是使用者最常
        查的那一天。

        `action` 用前綴比對：`review` 會涵蓋 `review.approve`、
        `review.reply.create` 等。日誌的動作命名是分層的，只能精確比對的話，
        使用者得先知道有哪些子動作才查得到東西。
        """
        stmt = self._base_query()
        if actor_id is not None:
            stmt = stmt.where(AdminLog.actor_id == actor_id)
        if action:
            stmt = stmt.where(AdminLog.action.startswith(action))
        if start is not None:
            stmt = stmt.where(AdminLog.created_at >= _day_start(start))
        if end is not None:
            stmt = stmt.where(AdminLog.created_at < _day_start(end) + timedelta(days=1))

        stmt = stmt.order_by(AdminLog.created_at.desc(), AdminLog.id).limit(limit)
        result = await self.session.execute(stmt)
        return [(log, actor_name) for log, actor_name in result.all()]


__all__ = ["AdminLogRepository", "LogRow"]
