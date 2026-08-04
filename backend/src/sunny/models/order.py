"""orders — 訂單。本模型的核心。

⚠️ **模型裡的 `ExcludeConstraint` 不是房況保證的來源。** 真正的約束由
`alembic/versions/0001_initial.py` 以原生 SQL 建立；此處宣告是為了讓模型完整
描述資料庫，避免日後有人看著模型以為那條約束不存在而把它 autogenerate 掉。

憲章原則 IV：「後端的檢查是授權與訊息品質，資料庫的約束才是保證。」
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from sunny.models.base import Base, created_at, uuid_pk

# ---------------------------------------------------------------------------
# 狀態機（data-model.md）
#
#   pending-payment ──付款──→ confirmed ──退房日過──→ completed
#         │                        │
#         │逾期                     │申請退款
#         ↓                        ↓
#     cancelled              refund-pending ──核准──→ refunded
#                                    │駁回
#                                    ↓
#                               confirmed
# ---------------------------------------------------------------------------
STATUS_PENDING_PAYMENT = "pending-payment"
STATUS_CONFIRMED = "confirmed"
STATUS_REFUND_PENDING = "refund-pending"
STATUS_REFUNDED = "refunded"
STATUS_CANCELLED = "cancelled"
STATUS_COMPLETED = "completed"

ORDER_STATUSES = (
    STATUS_PENDING_PAYMENT,
    STATUS_CONFIRMED,
    STATUS_REFUND_PENDING,
    STATUS_REFUNDED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
)

#: 佔用房況的狀態——即排除約束 `where` 子句所列。
#:
#: 待付款**同樣佔用**（FR-097）：它與已確認訂單一樣擋住其他人預訂，
#: 直到保留時間到期才釋出。`cancelled` 與 `refunded` 釋出區間；
#: `completed` 不在此列——退房日已過，該區間本就不會與新訂單重疊。
OCCUPYING_STATUSES = (STATUS_PENDING_PAYMENT, STATUS_CONFIRMED, STATUS_REFUND_PENDING)

#: 取消原因。兩者都計入「未付款取消訂單數」，但必須可區分（FR-035a）。
CANCEL_PAYMENT_TIMEOUT = "payment-timeout"
CANCEL_MEMBER = "member-cancelled"

PAYMENT_METHODS = ("LINE Pay", "credit-card", "bank-transfer")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("check_out > check_in", name="valid_date_range"),
        CheckConstraint("nights = check_out - check_in", name="nights_matches_dates"),
        CheckConstraint("nights > 0", name="orders_nights_check"),
        CheckConstraint("guest_count > 0", name="orders_guest_count_check"),
        CheckConstraint("total_amount >= 0", name="orders_total_amount_check"),
        # 同一房源同一晚不得有兩筆有效訂單。
        #
        # 半開區間 '[)' 讓「前一筆退房日 = 後一筆入住日」**不算重疊**——這是最
        # 容易誤判為衝突的案例，判錯會讓平台平白損失一半的可售天數。
        #
        # 實際建立由遷移負責（research R2）：daterange 是函式運算式、where 是
        # 部分約束，組合後 autogenerate 的還原能力不可靠，且失敗模式是產出
        # **刪除**敘述而非報錯。這條約束一旦被靜默移除，超賣不會報錯。
        ExcludeConstraint(
            (text("room_id"), "="),
            (text("daterange(check_in, check_out, '[)')"), "&&"),
            name="orders_no_overlap",
            where=text("status in ('pending-payment', 'confirmed', 'refund-pending')"),
        ),
    )

    id: Mapped[uuid_pk]

    #: `SN` + 台北日期 + 序號。對使用者可見且唯一（FR-030）。
    #:
    #: 正常路徑由 `services.booking.next_order_no()` 產生；此處的 server_default
    #: 是**直接以 SQL 插入時**（種子資料、資料修補）的後備。兩者取號自同一個
    #: `order_no_seq`，因此不會互相碰撞。
    order_no: Mapped[str] = mapped_column(
        Text,
        unique=True,
        nullable=False,
        server_default=text(
            "'SN' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD')"
            " || lpad(nextval('public.order_no_seq')::text, 4, '0')"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    #: `on delete restrict`——有訂單的房源不可刪除（FR-052）。
    room_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False
    )

    #: **日曆日，無時區成分。** MUST 為 `datetime.date`，MUST NOT 用帶時間的
    #: `datetime`（憲章原則 IV）。asyncpg 亦會拒絕字串形式的日期。
    check_in: Mapped[date] = mapped_column(nullable=False)
    check_out: Mapped[date] = mapped_column(nullable=False)

    #: 夜數 = 退房 − 入住。資料庫的 `nights_matches_dates` CHECK 是最後一道網；
    #: 它被觸發代表後端算錯，因此對外回 500 而非使用者錯誤。
    nights: Mapped[int] = mapped_column(nullable=False)
    guest_count: Mapped[int] = mapped_column(nullable=False)

    contact_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)

    payment_method: Mapped[str] = mapped_column(String, nullable=False)

    #: **整數新臺幣元。MUST NOT 用 float。**
    #: 建單時依當下房價寫入並凍結——房源價格日後變動不改變既有訂單（FR-032）。
    total_amount: Mapped[int] = mapped_column(nullable=False)

    status: Mapped[str] = mapped_column(String, nullable=False, default=STATUS_PENDING_PAYMENT)

    #: 保留到期時間。預設由資料庫的 `pending_payment_minutes()` 決定。
    #: 建單時寫入後即固定——參數變更 MUST NOT 回溯影響既有訂單（FR-101）。
    #:
    #: ⚠️ **應用層 MUST NOT 自行計算此值。** 建單時刻意不設定這個屬性，讓資料庫
    #: 的 server_default 求值；`guard_order_transition` 另外禁止事後變更它。
    #: 若在 Python 端算，管理員調整參數後就會出現「應用算的」與「資料庫算的」
    #: 兩套到期時間，而差異只會在使用者的倒數計時器上顯現（FR-098、FR-101）。
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now() + make_interval(mins => public.pending_payment_minutes())"),
    )

    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at]

    def __repr__(self) -> str:  # pragma: no cover - 除錯用
        return f"<Order {self.order_no} {self.check_in}~{self.check_out} {self.status}>"


__all__ = [
    "CANCEL_MEMBER",
    "CANCEL_PAYMENT_TIMEOUT",
    "OCCUPYING_STATUSES",
    "ORDER_STATUSES",
    "PAYMENT_METHODS",
    "STATUS_CANCELLED",
    "STATUS_COMPLETED",
    "STATUS_CONFIRMED",
    "STATUS_PENDING_PAYMENT",
    "STATUS_REFUNDED",
    "STATUS_REFUND_PENDING",
    "Order",
]
