"""操作日誌的檢視（FR-114、FR-115、FR-117、FR-118）。

⚠️ **本檔只有 GET。MUST NOT 提供任何 UPDATE 或 DELETE 端點，日後也 MUST NOT 加**
（contracts/README.md 的「不存在的端點」）。

三層互相獨立的防線，缺一層都還撐得住，但三層都要在：

1. **資料表權限**——`REVOKE UPDATE, DELETE ON admin_logs FROM sunny_app`（T019）。
   這是真正的保證，且只對非擁有者生效，因此應用以獨立角色連線（T021a）。
2. **沒有寫入路徑**——`repositories/admin_logs.py` 只有讀取方法。
3. **沒有端點**——本檔。

第 1 層是保證，第 2、3 層讓「有人想加」在**閱讀程式碼時**就看得出來，
而不是等到執行期撞上權限錯誤才發現。

⚠️ **非管理員 MUST 取不到任何紀錄**（FR-117）。授權掛在 router 上。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import SessionDep, require_admin
from sunny.repositories.admin_logs import AdminLogRepository
from sunny.schemas.log import AdminLogOut
from sunny.services import filters

router = APIRouter(
    prefix="/admin/logs",
    tags=["admin:logs"],
    dependencies=[Depends(require_admin)],
)

#: 單次查詢的上限。日誌會長到很大，沒有上限的查詢遲早會把記憶體吃光。
#: 前端以日期區間縮小範圍；達到上限時 MUST 提示可能未顯示全部（FR-115）。
MAX_ROWS = 500


@router.get("", response_model=list[AdminLogOut], summary="操作日誌（需管理員）")
async def list_logs(
    session: SessionDep,
    actor_id: Annotated[uuid.UUID | None, Query(alias="actorId", description="操作者")] = None,
    action: Annotated[str | None, Query(description="動作類型，前綴比對")] = None,
    start_date: Annotated[str | None, Query(alias="startDate", description="YYYY-MM-DD")] = None,
    end_date: Annotated[str | None, Query(alias="endDate", description="YYYY-MM-DD")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_ROWS)] = MAX_ROWS,
) -> list[AdminLogOut]:
    """需管理員（FR-114、FR-115、FR-117）。依時間**由新到舊**。

    日期區間**含頭含尾**且以台北時區切日——以 UTC 切會讓台北早上 8 點前的
    操作被歸到前一天，而業者查「今天做了什麼」時那幾筆會憑空消失
    （repositories/admin_logs.py）。

    ⚠️ 回應中的 `summary` 由 `services/audit.py` 把關，結構上不含密碼、秘鑰
    或真實個資（FR-118）。這裡不再過濾一次——過濾兩次的問題是兩份禁用清單
    會分歧，而分歧時較寬鬆的那一份會生效。
    """
    start = filters.parse_optional_date(start_date, field="起始日期")
    end = filters.parse_optional_date(end_date, field="結束日期")
    filters.validate_open_range(start, end)

    rows = await AdminLogRepository(session).search(
        actor_id=actor_id, action=action, start=start, end=end, limit=limit
    )
    return [AdminLogOut.of(log, actor_name) for log, actor_name in rows]
