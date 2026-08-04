"""後台儀表板與訂單統計的彙總查詢（FR-049、US6 驗收情境 1–3）。

## 為什麼與 `repositories/orders.py` 分開

會員端的訂單查詢一律以 `user_id` 收斂，後台的彙總則刻意跨全體會員。
兩者的每一條查詢都要帶不同的範圍限定，混在同一個 repository 裡，
「這個方法有沒有做使用者收斂」就得逐一記住——而漏掉一次就是越權讀取。

分開後，本檔的**每一個方法都是跨會員的**，只由 `require_admin` 的路由呼叫，
不需要在方法層再判斷一次。

## 三個口徑的判定

指標的定義比計算難。以下三處刻意選定並記錄，避免日後看到數字對不上時
無從判斷是「算錯」還是「口徑不同」。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select

from sunny.models.order import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_REFUND_PENDING,
    Order,
)
from sunny.models.refund import STATUS_PENDING as REFUND_PENDING
from sunny.models.refund import Refund
from sunny.models.review import STATUS_PENDING as REVIEW_PENDING
from sunny.models.review import Review
from sunny.repositories.base import Repository
from sunny.services.stats import OrderStats
from sunny.utils import dates

#: 已付款：款項已收到（不論後續是否退款申請中）。
#:
#: `refund-pending` **算已付款**——退款還沒核准，錢還在，房間也還佔著。
#: `refunded` 不算——那筆營收已經退回去了。
PAID_STATUSES = (STATUS_CONFIRMED, STATUS_REFUND_PENDING, STATUS_COMPLETED)

#: 營收認列：與「已付款」同口徑。退款核准後自營收扣除，因此排除 `refunded`。
REVENUE_STATUSES = PAID_STATUSES

#: 實際會有客人進出的訂單。未付款的待付款訂單**不算今日入住**——
#: 它隨時可能逾期取消，把它算進去會讓櫃台準備了一間不會有人來的房。
STAY_STATUSES = (STATUS_CONFIRMED, STATUS_REFUND_PENDING, STATUS_COMPLETED)


@dataclass(frozen=True, slots=True)
class DashboardSummary:
    """儀表板的營運總覽（FR-049）。"""

    total_orders: int
    today_check_ins: int
    today_check_outs: int
    rooms_available: int
    rooms_booked: int
    rooms_maintenance: int
    pending_reviews: int
    pending_refunds: int
    #: 未處理的賤賣預警筆數（FR-111）。**模擬資料**——此模組不連線任何外部平台。
    pending_channel_alerts: int
    month_revenue: int


class AdminStatsRepository(Repository):
    """跨會員的彙總查詢。**僅供 `require_admin` 的路由使用。**"""

    async def _count_orders(self, *conditions: object) -> int:
        stmt = select(func.count()).select_from(Order)
        for condition in conditions:
            stmt = stmt.where(condition)
        return int(await self.session.scalar(stmt) or 0)

    async def order_stats(self) -> OrderStats:
        """訂單管理的七項統計（US6 驗收情境 2）。

        MUST 先清理逾期訂單：否則「未付款取消訂單數」會少算掉那些已經過期、
        只是還沒有人查詢過的訂單，而統計頁正是最可能第一個被打開的頁面。
        """
        await self.expire_stale_orders()

        total = await self._count_orders()
        paid = await self._count_orders(Order.status.in_(PAID_STATUSES))

        # 未付款取消：逾期自動取消與會員主動取消**都算**（FR-035a）。
        # 兩者以 cancel_reason 區分，但在這個數字上合併——業者關心的是
        # 「有多少單沒收到錢」，不是它們為什麼沒收到。
        unpaid_cancelled = await self._count_orders(Order.status == STATUS_CANCELLED)

        revenue = int(
            await self.session.scalar(
                select(func.coalesce(func.sum(Order.total_amount), 0)).where(
                    Order.status.in_(REVENUE_STATUSES)
                )
            )
            or 0
        )

        return OrderStats.build(
            total_orders=total,
            paid_orders=paid,
            unpaid_cancelled_orders=unpaid_cancelled,
            revenue=revenue,
        )

    async def _month_revenue(self, today: date) -> int:
        """本月營收。

        以**訂單建立時間**認列，區間為台北時區的當月 `[月初, 次月初)`。

        用 `created_at` 而非 `check_in`：業者問「這個月做了多少生意」時，
        指的是這個月收到的訂單。以入住日認列會讓一筆這個月成立、下個月入住的
        訂單在本月完全看不到，而它的錢已經進來了。
        """
        start_local = datetime(today.year, today.month, 1, tzinfo=dates.TAIPEI)
        # 次月一日：先跳到本月 28 日之後必定落在下個月的某一天，再取其一日
        next_month = (start_local.date() + timedelta(days=32)).replace(day=1)
        end_local = datetime(next_month.year, next_month.month, 1, tzinfo=dates.TAIPEI)

        return int(
            await self.session.scalar(
                select(func.coalesce(func.sum(Order.total_amount), 0)).where(
                    Order.status.in_(REVENUE_STATUSES),
                    Order.created_at >= start_local,
                    Order.created_at < end_local,
                )
            )
            or 0
        )

    async def dashboard(
        self, *, room_status_counts: dict[str, int], channel_alerts: int = 0
    ) -> DashboardSummary:
        """營運總覽。

        `room_status_counts` 由 `AdminRoomRepository.status_counts_on()` 提供——
        房態是**依日期推導**的，不是 `rooms.status` 的分組計數（FR-015）。
        分組計數永遠只會回 available 與 maintenance 兩種，看不到「今天有幾間
        被訂走」，而那正是業者早上第一眼要看的數字。
        """
        await self.expire_stale_orders()
        today = dates.today()

        return DashboardSummary(
            total_orders=await self._count_orders(),
            today_check_ins=await self._count_orders(
                Order.check_in == today, Order.status.in_(STAY_STATUSES)
            ),
            today_check_outs=await self._count_orders(
                Order.check_out == today, Order.status.in_(STAY_STATUSES)
            ),
            rooms_available=room_status_counts.get("available", 0),
            rooms_booked=room_status_counts.get("booked", 0),
            rooms_maintenance=room_status_counts.get("maintenance", 0),
            pending_reviews=int(
                await self.session.scalar(
                    select(func.count()).select_from(Review).where(Review.status == REVIEW_PENDING)
                )
                or 0
            ),
            pending_refunds=int(
                await self.session.scalar(
                    select(func.count()).select_from(Refund).where(Refund.status == REFUND_PENDING)
                )
                or 0
            ),
            pending_channel_alerts=channel_alerts,
            month_revenue=await self._month_revenue(today),
        )


__all__ = [
    "PAID_STATUSES",
    "REVENUE_STATUSES",
    "STAY_STATUSES",
    "AdminStatsRepository",
    "DashboardSummary",
]
