"""七個模組的匯出端點（FR-058、FR-058a、FR-060、SC-033）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上。

## 為什麼是一個端點而不是七個

`GET /admin/exports/{module}` 接受與各清單端點**相同的篩選參數**，並轉呼叫
**同一個 repository 方法**。SC-033 要求「檔案內的資料列數 100% 等於畫面上的
筆數」——共用查詢是這件事唯一可靠的達成方式；兩邊各寫一份，遲早有一邊多帶
或少帶一個條件，而症狀是匯出的檔案裡多了幾筆別人的訂單。

同理，匯出**不另設分頁**：入口在各資料頁面內，範圍就是該頁當前的篩選結果
（FR-058、spec 開頭的「移除『報表匯出』」）。獨立分頁取不到其他頁面的篩選
條件，只能匯出全部。

## 稽核不可能被繞過

資料只能從這裡取得，而這裡在回傳的同時寫日誌（FR-058a）。若改由前端拿畫面
上已有的資料自行組檔，「記得呼叫記錄端點」就變成一項紀律，而紀律會被遺忘。

**匯出操作日誌本身同樣被記錄**，沒有例外分支——稽核紀錄被帶離系統是所有匯出
裡最敏感的一種。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.repositories.admin_channel import ChannelPriceRepository
from sunny.repositories.admin_logs import AdminLogRepository
from sunny.repositories.admin_orders import AdminOrderRepository
from sunny.repositories.admin_refunds import AdminRefundRepository
from sunny.repositories.admin_reviews import AdminReviewRepository
from sunny.repositories.admin_rooms import AdminRoomRepository
from sunny.repositories.admin_users import AdminUserRepository
from sunny.schemas.export import ExportOut
from sunny.services import channel, export, filters

router = APIRouter(
    prefix="/admin/exports",
    tags=["admin:exports"],
    dependencies=[Depends(require_admin)],
)

#: 0 筆時給使用者的提示。**MUST NOT 產生空檔案**（FR-060）。
NO_DATA_MESSAGE = "目前的篩選條件沒有可匯出的資料。"


_parse_optional = filters.parse_optional_date


async def _fetch(module: str, session, params: dict) -> export.ExportSheet:
    """依模組取資料。**每一支都轉呼叫清單端點用的同一個 repository 方法。**"""
    if module == export.MODULE_ROOMS:
        start, end = filters.resolve_inclusive_range(
            params.get("start_date"), params.get("end_date")
        )
        rows = await AdminRoomRepository(session).list_with_availability(
            start=start,
            end=end,
            keyword=params.get("keyword"),
            room_type=params.get("room_type"),
            min_price=params.get("min_price"),
            max_price=params.get("max_price"),
            status_filter=params.get("status"),
        )
        return export.room_rows([room for room, _availability in rows])

    if module == export.MODULE_ORDERS:
        return export.order_rows(
            await AdminOrderRepository(session).search(
                order_no=params.get("order_no"),
                status=params.get("status"),
                room_id=params.get("room_id"),
                start=_parse_optional(params.get("start_date"), field="起始日期"),
                end=_parse_optional(params.get("end_date"), field="結束日期"),
            )
        )

    if module == export.MODULE_USERS:
        return export.user_rows(
            await AdminUserRepository(session).search(
                keyword=params.get("keyword"), role=params.get("role")
            )
        )

    if module == export.MODULE_REVIEWS:
        return export.review_rows(
            await AdminReviewRepository(session).search(
                status=params.get("status"), room_id=params.get("room_id")
            )
        )

    if module == export.MODULE_REFUNDS:
        return export.refund_rows(
            await AdminRefundRepository(session).search(status=params.get("status"))
        )

    if module == export.MODULE_CHANNEL:
        rows = await ChannelPriceRepository(session).search(room_id=params.get("room_id"))
        return export.channel_rows(channel.compare_all(rows))

    # export.MODULE_LOGS
    return export.log_rows(
        await AdminLogRepository(session).search(
            actor_id=params.get("actor_id"),
            action=params.get("action"),
            start=_parse_optional(params.get("start_date"), field="起始日期"),
            end=_parse_optional(params.get("end_date"), field="結束日期"),
        )
    )


@router.get("/{module}", response_model=ExportOut, summary="匯出資料（需管理員）")
async def export_module(
    module: str,
    session: SessionDep,
    admin: AdminUser,
    fmt: Annotated[
        str, Query(alias="format", description="xlsx；離線退回時為 csv（FR-059）")
    ] = export.FORMAT_XLSX,
    keyword: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    role: Annotated[str | None, Query()] = None,
    room_id: Annotated[uuid.UUID | None, Query(alias="roomId")] = None,
    order_no: Annotated[str | None, Query(alias="orderNo")] = None,
    room_type: Annotated[str | None, Query(alias="type")] = None,
    min_price: Annotated[int | None, Query(alias="minPrice")] = None,
    max_price: Annotated[int | None, Query(alias="maxPrice")] = None,
    actor_id: Annotated[uuid.UUID | None, Query(alias="actorId")] = None,
    action: Annotated[str | None, Query()] = None,
    start_date: Annotated[str | None, Query(alias="startDate", description="YYYY-MM-DD")] = None,
    end_date: Annotated[str | None, Query(alias="endDate", description="YYYY-MM-DD")] = None,
) -> ExportOut:
    """需管理員。回傳可直接寫入檔案的欄位與資料列（FR-058）。

    篩選參數與各清單端點相同，未用到的模組會忽略不相關的參數——
    這比為七個模組各開一支端點簡單，且保證了「同一組條件、同一份查詢」。

    **0 筆時 `hasData` 為 false，前端 MUST 提示且 MUST NOT 產生檔案**
    （FR-060），後端亦不寫入稽核紀錄（FR-058a）。
    """
    if module not in export.EXPORT_MODULES:
        raise DomainError(
            "未知的匯出模組。",
            code="UNKNOWN_EXPORT_MODULE",
            status_code=404,
        )
    if fmt not in export.EXPORT_FORMATS:
        raise DomainError(
            "匯出格式僅支援 xlsx 與 csv。",
            code="UNKNOWN_EXPORT_FORMAT",
            status_code=400,
            field="format",
        )

    sheet = await _fetch(
        module,
        session,
        {
            "keyword": keyword,
            "status": status,
            "role": role,
            "room_id": room_id,
            "order_no": order_no,
            "room_type": room_type,
            "min_price": min_price,
            "max_price": max_price,
            "actor_id": actor_id,
            "action": action,
            "start_date": start_date,
            "end_date": end_date,
        },
    )

    await export.record_export(session, actor_id=admin.id, sheet=sheet, fmt=fmt)
    await session.commit()

    return ExportOut(
        module=sheet.module,
        format=fmt,
        columns=[{"key": c.key, "label": c.label} for c in sheet.columns],  # type: ignore[list-item]
        rows=sheet.rows,
        row_count=sheet.row_count,
        has_data=sheet.has_data,
        message=None if sheet.has_data else NO_DATA_MESSAGE,
    )
