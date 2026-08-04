"""後台儀表板（FR-049、US6 驗收情境 1–3）。

⚠️ **本檔全部端點需管理員。** `dependencies=[Depends(require_admin)]` 掛在
router 上而非逐一標註：漏標一個函式就是一個公開的後台端點，而那不會有任何
測試失敗（contracts/README.md：預設不是「公開」而是「需登入」）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from sunny.deps import SessionDep, require_admin
from sunny.repositories.admin_channel import ChannelPriceRepository
from sunny.repositories.admin_rooms import AdminRoomRepository
from sunny.repositories.admin_stats import AdminStatsRepository
from sunny.schemas.admin import DashboardOut, OrderStatsOut
from sunny.utils import dates

router = APIRouter(
    prefix="/admin",
    tags=["admin:dashboard"],
    dependencies=[Depends(require_admin)],
)


@router.get("/dashboard", response_model=DashboardOut, summary="營運總覽（需管理員）")
async def get_dashboard(session: SessionDep) -> DashboardOut:
    """需管理員。

    房態計數走**當日推導**（`status_counts_on`），不是 `rooms.status` 的分組。
    分組計數永遠只會回 available 與 maintenance，看不到「今天有幾間被訂走」，
    而那正是業者早上第一眼要看的數字（FR-015）。

    `pendingChannelAlerts` 為未處理的賤賣預警筆數（FR-111）。⚠️ 它來自
    **模擬資料**——渠道比價模組不連線任何外部平台（FR-109、FR-110），
    前端在儀表板上顯示此數字時 MUST 一併標示。
    """
    room_counts = await AdminRoomRepository(session).status_counts_on(dates.today())
    channel_alerts = await ChannelPriceRepository(session).unresolved_alert_count()
    summary = await AdminStatsRepository(session).dashboard(
        room_status_counts=room_counts, channel_alerts=channel_alerts
    )
    return DashboardOut.model_validate(summary, from_attributes=True)


@router.get("/orders/stats", response_model=OrderStatsOut, summary="訂單統計（需管理員）")
async def get_order_stats(session: SessionDep) -> OrderStatsOut:
    """需管理員。

    ⚠️ 無任何訂單時 `conversionRate` 與 `averageOrderValue` 為 **null**，
    前端據此顯示「—」。MUST NOT 回 0 或讓除法拋錯（US6 驗收情境 3）。

    路徑刻意放在 `/admin/orders/stats` 而非 `/admin/stats/orders`：它屬於訂單
    管理頁，與該頁的清單端點同一個前綴，前端不必記兩個位置。
    """
    stats = await AdminStatsRepository(session).order_stats()
    return OrderStatsOut(
        total_orders=stats.total_orders,
        placed_orders=stats.placed_orders,
        paid_orders=stats.paid_orders,
        unpaid_cancelled_orders=stats.unpaid_cancelled_orders,
        revenue=stats.revenue,
        # Decimal → float：Pydantic 的 JSON 模式會把 Decimal 序列化成字串，
        # 前端拿到就得先 Number() 才能比大小。比率不參與累加，float 無誤差風險。
        conversion_rate=(
            float(stats.conversion_rate) if stats.conversion_rate is not None else None
        ),
        average_order_value=stats.average_order_value,
    )
