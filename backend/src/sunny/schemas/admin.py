"""後台端點的 API 形狀。

命名轉換沿用 `schemas/room.py` 的 `CamelModel`：資料庫 snake_case、
API camelCase，且轉換只發生在 Pydantic 的序列化設定中（憲章原則 III）。

## 比率為什麼是 `float` 而金額是 `int`

憲章原則 IV 禁止的是**金額**經過浮點數——累加誤差會讓帳目對不上。
成交率是一個顯示用的比值，不參與任何累加，用 float 沒有這個風險。

反過來，`Decimal` 在 Pydantic 的 JSON 模式下會序列化成**字串**（`"60.0"`），
前端拿到就得先 `Number()` 才能比大小。此處明確轉為 float 以符合
data-model.md 的型別對應（JSON 為「數值或 null」）。

金額則全程 `int`：`revenue` 與 `averageOrderValue` 都是整數新臺幣元（FR-070）。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field, field_validator

from sunny.models.order import ORDER_STATUSES, PAYMENT_METHODS
from sunny.models.profile import ROLES
from sunny.models.room import ROOM_STATUSES
from sunny.schemas.room import CamelModel, RoomOut

# ---------------------------------------------------------------------------
# 儀表板與統計
# ---------------------------------------------------------------------------


class DashboardOut(CamelModel):
    """營運總覽（FR-049）。"""

    total_orders: int
    today_check_ins: int
    today_check_outs: int

    #: 房態為**當日推導**，不是 `rooms.status` 的分組計數（FR-015）
    rooms_available: int
    rooms_booked: int
    rooms_maintenance: int

    pending_reviews: int
    pending_refunds: int
    #: 未處理的賤賣預警筆數（FR-111）。⚠️ 來自**模擬資料**——渠道比價模組
    #: 不連線任何外部平台，前端顯示此數字時 MUST 一併標示（FR-110）。
    pending_channel_alerts: int

    #: 本月營收，整數新臺幣元
    month_revenue: int


class OrderStatsOut(CamelModel):
    """訂單管理的統計區塊（US6 驗收情境 2、3）。

    ⚠️ `conversionRate` 與 `averageOrderValue` 在系統無訂單時為 **null**，
    前端據此顯示「—」。MUST NOT 回 0——0 會被讀成「一筆都沒成交」，
    而實際上是還沒有人下單過。
    """

    total_orders: int
    placed_orders: int
    paid_orders: int
    unpaid_cancelled_orders: int
    revenue: int
    conversion_rate: float | None
    average_order_value: int | None


# ---------------------------------------------------------------------------
# 房源管理
# ---------------------------------------------------------------------------


class AdminRoomOut(RoomOut):
    """房源 + 所查日期區間內的推導房態。

    `availability` 為 `available` / `booked` / `maintenance`，
    依查詢的日期區間推導（FR-051b）。與 `status` 欄位不同：後者是不分日期的
    營運狀態，只有 available 與 maintenance 兩種。
    """

    availability: str

    @classmethod
    def of(cls, room: object, availability: str) -> AdminRoomOut:
        return cls(
            **RoomOut.model_validate(room).model_dump(by_alias=False),
            availability=availability,
        )


class RoomWriteIn(CamelModel):
    """新增與編輯房源的共用輸入。

    `status` 刻意只接受 `available` 與 `maintenance`——「已預訂」由當日訂單
    推導，MUST NOT 開放人工設定（FR-051）。
    """

    name: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=60)
    max_guests: int = Field(gt=0, le=20)
    #: 整數新臺幣元，MUST NOT 為浮點數
    nightly_price: int = Field(gt=0, le=1_000_000)
    description: str = Field(default="", max_length=4000)
    images: list[str] = Field(default_factory=list, max_length=8)
    amenities: list[str] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    status: str = "available"

    @field_validator("status")
    @classmethod
    def _only_operational_statuses(cls, value: str) -> str:
        if value not in ROOM_STATUSES:
            raise ValueError(f"房態僅接受 {ROOM_STATUSES}；「已預訂」由訂單推導，不可人工設定")
        return value


class RoomStatusIn(CamelModel):
    """單獨調整房態（FR-051）。"""

    status: str


class AffectedOrderOut(CamelModel):
    """刪除房源時列出的受影響訂單（FR-052）。"""

    id: uuid.UUID
    order_no: str
    check_in: date
    check_out: date
    status: str
    contact_name: str


# ---------------------------------------------------------------------------
# 訂單管理
# ---------------------------------------------------------------------------


class AdminOrderOut(CamelModel):
    """後台的訂單檢視。

    含聯絡資訊——業者需要它才能聯繫客人。這與會員端的越權防護不衝突：
    此端點在 `require_admin` 之後。
    """

    id: uuid.UUID
    order_no: str
    user_id: uuid.UUID
    room_id: uuid.UUID
    room_name: str | None = None
    check_in: date
    check_out: date
    nights: int
    guest_count: int
    contact_name: str
    phone: str
    email: str
    payment_method: str
    #: 整數新臺幣元
    total_amount: int
    status: str
    expires_at: datetime
    cancel_reason: str | None
    created_at: datetime


class OrderStatusIn(CamelModel):
    """變更訂單狀態（FR-054）。變更 MUST 寫入稽核日誌。"""

    status: str
    note: str | None = Field(default=None, max_length=500)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in ORDER_STATUSES:
            raise ValueError(f"訂單狀態僅接受 {ORDER_STATUSES}")
        return value


# ---------------------------------------------------------------------------
# 用戶管理
# ---------------------------------------------------------------------------


class AdminUserOut(CamelModel):
    """後台的會員檢視。

    ⚠️ **沒有 `passwordHash`，也沒有 `googleSub`。** 欄位明列而非把 ORM 物件
    全欄位倒出去——前一版靠「資料表根本沒有密碼欄位」保證這件事，
    那層保護已經沒有了（data-model.md）。
    """

    id: uuid.UUID
    email: str
    role: str
    display_name: str
    phone: str | None
    created_at: datetime


class UserUpdateIn(CamelModel):
    """編輯會員資料。

    **刻意沒有 `role` 欄位**——角色變更走 `UserRoleIn` 的獨立端點，
    才能保證每一次變更都留下稽核紀錄（FR-055、data-model.md）。
    """

    display_name: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=30)


class UserRoleIn(CamelModel):
    """角色升降（FR-055）。

    原 `prevent_role_escalation()` trigger 依賴 `is_admin()` → `auth.uid()`，
    隨 Supabase Auth 一併移除。其職責移至此：`role` MUST 只能由這個
    管理員端點變更，且 MUST 進稽核日誌。
    """

    role: str

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: str) -> str:
        if value not in ROLES:
            raise ValueError(f"角色僅接受 {ROLES}")
        return value


# ---------------------------------------------------------------------------
# 照片上傳
# ---------------------------------------------------------------------------


class PhotoUploadOut(CamelModel):
    """上傳結果（FR-050b）。

    回傳的是**尚未掛到房源上**的檔案路徑。要真正生效必須由 `PATCH
    /admin/rooms/{id}` 把它寫進 `images`——這個兩段式是 FR-050f 的前提：
    使用者按取消時，本次上傳但未保存的檔案要能被清掉。
    """

    path: str
    bytes: int
    content_type: str


__all__ = [
    "AdminOrderOut",
    "AdminRoomOut",
    "AdminUserOut",
    "AffectedOrderOut",
    "DashboardOut",
    "OrderStatsOut",
    "OrderStatusIn",
    "PAYMENT_METHODS",
    "PhotoUploadOut",
    "RoomStatusIn",
    "RoomWriteIn",
    "UserRoleIn",
    "UserUpdateIn",
]
