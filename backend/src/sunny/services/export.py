"""七個模組的匯出資料組裝與稽核（FR-058、FR-058a、FR-060、FR-118）。

## 檔案在瀏覽器產生，資料在後端組裝

xlsx 由前端產生（T140），離線或函式庫載入失敗時退回 CSV（T141、FR-059）。
後端只負責**組出要寫進檔案的那幾列**。

這個分工不是為了省事，而是為了讓兩件事變成結構性的：

1. **用戶匯出不含電子郵件與密碼**（FR-058）。欄位不在 `USER_COLUMNS` 裡，
   前端就沒有東西可寫進檔案。若改由前端自行從畫面資料組欄位，這項要求就
   退化成「記得不要選那兩欄」——而那是會被遺忘的。
2. **每一次成功匯出都留下稽核紀錄**（FR-058a）。資料只能從匯出端點取得，
   而該端點在回傳的同時寫日誌。沒有「匯出了但沒記錄」這條路徑可走。

## 0 筆時不產生檔案，也不記錄

FR-060 要求提示無資料且 MUST NOT 產生空檔案；FR-058a 要求零筆時
MUST NOT 記錄。兩者是同一件事的兩端：沒有檔案離開系統，就沒有東西需要稽核。
`record_export()` 因此在 `row_count == 0` 時回 None 且不寫入。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from sunny.models.admin_log import AdminLog
from sunny.services import audit
from sunny.utils import dates

# ---------------------------------------------------------------------------
# 七個模組（FR-058）
# ---------------------------------------------------------------------------
MODULE_ROOMS: Final = "rooms"
MODULE_ORDERS: Final = "orders"
MODULE_USERS: Final = "users"
MODULE_REVIEWS: Final = "reviews"
MODULE_REFUNDS: Final = "refunds"
MODULE_CHANNEL: Final = "channel-prices"
MODULE_LOGS: Final = "admin-logs"

EXPORT_MODULES: Final = (
    MODULE_ROOMS,
    MODULE_ORDERS,
    MODULE_USERS,
    MODULE_REVIEWS,
    MODULE_REFUNDS,
    MODULE_CHANNEL,
    MODULE_LOGS,
)

#: 允許的檔案格式。CSV 是離線退路，不是使用者的選項（FR-059）。
FORMAT_XLSX: Final = "xlsx"
FORMAT_CSV: Final = "csv"
EXPORT_FORMATS: Final = (FORMAT_XLSX, FORMAT_CSV)


@dataclass(frozen=True, slots=True)
class Column:
    """一個欄位：資料鍵與表頭文字。

    表頭為繁體中文（FR-069）。由後端定義而非前端各自翻譯，同一個欄位才不會
    在訂單頁叫「入住日」、在匯出檔叫「checkIn」。
    """

    key: str
    label: str


@dataclass(frozen=True, slots=True)
class ExportSheet:
    """一次匯出的完整內容。"""

    module: str
    columns: tuple[Column, ...]
    rows: list[dict[str, Any]]

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def has_data(self) -> bool:
        """0 筆時前端 MUST 提示無資料且 MUST NOT 產生檔案（FR-060）。"""
        return bool(self.rows)


def _cols(*pairs: tuple[str, str]) -> tuple[Column, ...]:
    return tuple(Column(key=k, label=v) for k, v in pairs)


def _date(value: Any) -> str | None:
    return dates.format_calendar_date(value) if value is not None else None


def _stamp(value: Any) -> str | None:
    """時間戳轉台北時間的可讀字串。

    匯出檔會被人直接打開閱讀，一串 UTC ISO 字串在試算表裡沒有意義。
    全站日期格式一致（FR-070）。
    """
    if value is None:
        return None
    return value.astimezone(dates.TAIPEI).strftime("%Y-%m-%d %H:%M")


# ---------------------------------------------------------------------------
# 房源
# ---------------------------------------------------------------------------
ROOM_COLUMNS = _cols(
    ("name", "房源名稱"),
    ("type", "房型"),
    ("maxGuests", "可住人數"),
    ("nightlyPrice", "每晚房價"),
    ("status", "營運狀態"),
    ("averageRating", "平均評分"),
    ("amenities", "設施"),
    ("features", "房型特色"),
    ("createdAt", "建立時間"),
)


def room_rows(rooms: Sequence[Any]) -> ExportSheet:
    """房源管理的匯出。

    `averageRating` 為 None 時輸出空字串而非 0——匯出檔沒有「尚無評分」的
    呈現層可依賴，寫 0 會讓收到檔案的人以為那間房被評過 0 分（FR-047）。
    """
    return ExportSheet(
        module=MODULE_ROOMS,
        columns=ROOM_COLUMNS,
        rows=[
            {
                "name": room.name,
                "type": room.type,
                "maxGuests": room.max_guests,
                "nightlyPrice": room.nightly_price,
                "status": room.status,
                "averageRating": (
                    float(room.average_rating) if room.average_rating is not None else ""
                ),
                "amenities": "、".join(room.amenities or ()),
                "features": "、".join(room.features or ()),
                "createdAt": _stamp(room.created_at),
            }
            for room in rooms
        ],
    )


# ---------------------------------------------------------------------------
# 訂單
# ---------------------------------------------------------------------------
ORDER_COLUMNS = _cols(
    ("orderNo", "訂單編號"),
    ("roomName", "房源"),
    ("checkIn", "入住日"),
    ("checkOut", "退房日"),
    ("nights", "夜數"),
    ("guestCount", "人數"),
    ("contactName", "聯絡人"),
    ("phone", "聯絡電話"),
    ("paymentMethod", "付款方式"),
    ("totalAmount", "金額"),
    ("status", "狀態"),
    ("createdAt", "成立時間"),
)


def order_rows(rows: Sequence[tuple[Any, str | None]]) -> ExportSheet:
    """訂單管理的匯出。

    含聯絡人與電話：業者匯出訂單的用途就是備份與對帳，拿掉聯絡方式會讓檔案
    失去意義。這與用戶模組不同——那裡匯出的是**帳號清單**，性質是另一回事。

    ⚠️ 不含 `email`。訂單上的電子郵件與帳號的電子郵件通常是同一個，
    匯出它等於繞過 FR-058 對用戶模組的限制。電話已足以聯繫客人。
    """
    return ExportSheet(
        module=MODULE_ORDERS,
        columns=ORDER_COLUMNS,
        rows=[
            {
                "orderNo": order.order_no,
                "roomName": room_name or "",
                "checkIn": _date(order.check_in),
                "checkOut": _date(order.check_out),
                "nights": order.nights,
                "guestCount": order.guest_count,
                "contactName": order.contact_name,
                "phone": order.phone,
                "paymentMethod": order.payment_method,
                "totalAmount": order.total_amount,
                "status": order.status,
                "createdAt": _stamp(order.created_at),
            }
            for order, room_name in rows
        ],
    )


# ---------------------------------------------------------------------------
# 用戶
# ---------------------------------------------------------------------------
#: ⚠️ **沒有 email，沒有任何密碼相關欄位**（FR-058）。
#:
#: 「那些由認證服務保管、頁面上本來就不顯示，匯出檔帶出去等於外洩一份帳號
#: 清單。」認證服務現在是我們自己（`profiles.password_hash`），這條限制因而
#: 更重要而非更寬鬆——雜湊值離開系統就能離線暴力破解。
USER_COLUMNS = _cols(
    ("displayName", "顯示名稱"),
    ("role", "角色"),
    ("phone", "聯絡電話"),
    ("createdAt", "註冊時間"),
)

#: 用戶匯出中一律不得出現的鍵。由 T136 逐一斷言。
FORBIDDEN_USER_KEYS: Final = frozenset(
    {"email", "password", "password_hash", "passwordHash", "google_sub", "googleSub"}
)


def user_rows(profiles: Sequence[Any]) -> ExportSheet:
    """用戶管理的匯出。**欄位明列**，不使用萬用的欄位傾倒。"""
    return ExportSheet(
        module=MODULE_USERS,
        columns=USER_COLUMNS,
        rows=[
            {
                "displayName": p.display_name,
                "role": p.role,
                "phone": p.phone or "",
                "createdAt": _stamp(p.created_at),
            }
            for p in profiles
        ],
    )


# ---------------------------------------------------------------------------
# 評論
# ---------------------------------------------------------------------------
REVIEW_COLUMNS = _cols(
    ("roomName", "房源"),
    ("rating", "評分"),
    ("category", "評論類型"),
    ("comment", "內容"),
    ("status", "審核狀態"),
    ("autoVerdict", "自動審核初判"),
    ("autoRules", "觸發規則"),
    ("adminReply", "業者回覆"),
    ("createdAt", "送出時間"),
)


def review_rows(rows: Sequence[tuple[Any, str | None, str | None]]) -> ExportSheet:
    """評論審核的匯出。

    ⚠️ 不含評論者姓名。評論在前台本就以匿名或暱稱呈現，把它與帳號對應關係
    寫進一份會被轉寄的檔案，等於替每一則負評標上作者。

    `autoVerdict` 是**規則式自動審核**的初判，MUST NOT 於介面或表頭被描述為
    AI（FR-103a、憲章原則 VI）。
    """
    return ExportSheet(
        module=MODULE_REVIEWS,
        columns=REVIEW_COLUMNS,
        rows=[
            {
                "roomName": room_name or "",
                "rating": review.rating,
                "category": review.category,
                "comment": review.comment,
                "status": review.status,
                "autoVerdict": review.auto_verdict or "",
                "autoRules": "、".join(review.auto_rules or ()),
                "adminReply": review.admin_reply or "",
                "createdAt": _stamp(review.created_at),
            }
            for review, room_name, _user_name in rows
        ],
    )


# ---------------------------------------------------------------------------
# 退款
# ---------------------------------------------------------------------------
REFUND_COLUMNS = _cols(
    ("orderNo", "訂單編號"),
    ("amount", "退款金額"),
    ("status", "審核狀態"),
    ("reason", "申請原因"),
    ("adminNote", "審核備註"),
    ("createdAt", "申請時間"),
    ("reviewedAt", "審核時間"),
)


def refund_rows(rows: Sequence[tuple[Any, Any, str | None]]) -> ExportSheet:
    """退款審核的匯出。以訂單編號對應，不含申請人姓名。"""
    return ExportSheet(
        module=MODULE_REFUNDS,
        columns=REFUND_COLUMNS,
        rows=[
            {
                "orderNo": order.order_no,
                "amount": refund.amount,
                "status": refund.status,
                "reason": refund.reason,
                "adminNote": refund.admin_note or "",
                "createdAt": _stamp(refund.created_at),
                "reviewedAt": _stamp(refund.reviewed_at),
            }
            for refund, order, _applicant in rows
        ],
    )


# ---------------------------------------------------------------------------
# 渠道比價
# ---------------------------------------------------------------------------
CHANNEL_COLUMNS = _cols(
    ("roomName", "房源"),
    ("channel", "平台"),
    ("officialPrice", "官網價"),
    ("channelPrice", "平台售價"),
    ("gap", "價差"),
    ("gapPercent", "價差百分比"),
    ("resolved", "已處理"),
    ("simulated", "資料性質"),
    ("capturedAt", "取得時間"),
)


def channel_rows(comparisons: Sequence[Any]) -> ExportSheet:
    """渠道比價的匯出。

    ⚠️ **每一列都帶「模擬資料」標記。** 介面上有常駐提示（FR-110），但檔案
    離開系統之後就沒有那塊提示了——收到檔案的人會把它當成真實的市場價格。
    這一欄是那個提示唯一能跟著走的形式。
    """
    return ExportSheet(
        module=MODULE_CHANNEL,
        columns=CHANNEL_COLUMNS,
        rows=[
            {
                "roomName": c.room_name,
                "channel": c.channel,
                "officialPrice": c.official_price,
                "channelPrice": c.channel_price,
                "gap": c.gap,
                "gapPercent": c.gap_percent,
                "resolved": "是" if c.resolved else "否",
                "simulated": "模擬資料（未連線任何外部平台）",
                "capturedAt": _stamp(c.captured_at),
            }
            for c in comparisons
        ],
    )


# ---------------------------------------------------------------------------
# 操作日誌
# ---------------------------------------------------------------------------
LOG_COLUMNS = _cols(
    ("createdAt", "時間"),
    ("actorName", "操作者"),
    ("action", "動作"),
    ("targetTable", "對象資料表"),
    ("targetId", "對象識別"),
    ("summary", "摘要"),
)


def log_rows(rows: Sequence[tuple[Any, str | None]]) -> ExportSheet:
    """操作日誌的匯出。

    `summary` 由 `audit.record()` 把關，結構上不含密碼、秘鑰或真實個資
    （FR-118、services/audit.py 的 `_FORBIDDEN_KEYS`）。因此可以整段輸出，
    不需要在這裡再過濾一次——過濾兩次的問題是兩份清單會分歧。
    """
    return ExportSheet(
        module=MODULE_LOGS,
        columns=LOG_COLUMNS,
        rows=[
            {
                "createdAt": _stamp(log.created_at),
                "actorName": actor_name or "",
                "action": log.action,
                "targetTable": log.target_table,
                "targetId": log.target_id or "",
                "summary": "；".join(f"{k}={v}" for k, v in sorted((log.summary or {}).items())),
            }
            for log, actor_name in rows
        ],
    )


# ---------------------------------------------------------------------------
# 稽核（T138、FR-058a）
# ---------------------------------------------------------------------------
async def record_export(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    sheet: ExportSheet,
    fmt: str,
) -> AdminLog | None:
    """記錄一次成功的匯出。**0 筆時不記錄且回 None。**

    ⚠️ **摘要只有模組、筆數與格式，MUST NOT 含任何一列的實際內容**
    （FR-058a、FR-118）。匯出的正是會員資料，把它抄進所有管理員都讀得到的
    日誌，等於為了記錄一次外洩風險而製造第二個外洩點。

    ⚠️ **匯出操作日誌本身同樣會被記錄。** 沒有例外分支——稽核紀錄被帶離
    系統是所有匯出裡最敏感的一種，唯一的例外反而應該是它最不該有的。
    這一點靠「這裡沒有 `if module == MODULE_LOGS: return`」保證。

    不提交。呼叫端 MUST 與其他變更一併提交（憲章資料存取規則）。
    """
    if fmt not in EXPORT_FORMATS:
        raise ValueError(f"未知的匯出格式：{fmt}")

    if not sheet.has_data:
        # 沒有檔案離開系統，就沒有東西需要稽核（FR-058a、FR-060）。
        return None

    return await audit.record(
        session,
        actor_id=actor_id,
        action="export",
        target_table=sheet.module,
        summary={"module": sheet.module, "rowCount": sheet.row_count, "format": fmt},
    )


__all__ = [
    "CHANNEL_COLUMNS",
    "EXPORT_FORMATS",
    "EXPORT_MODULES",
    "FORBIDDEN_USER_KEYS",
    "FORMAT_CSV",
    "FORMAT_XLSX",
    "LOG_COLUMNS",
    "MODULE_CHANNEL",
    "MODULE_LOGS",
    "MODULE_ORDERS",
    "MODULE_REFUNDS",
    "MODULE_REVIEWS",
    "MODULE_ROOMS",
    "MODULE_USERS",
    "ORDER_COLUMNS",
    "REFUND_COLUMNS",
    "REVIEW_COLUMNS",
    "ROOM_COLUMNS",
    "USER_COLUMNS",
    "Column",
    "ExportSheet",
    "channel_rows",
    "log_rows",
    "order_rows",
    "record_export",
    "refund_rows",
    "review_rows",
    "room_rows",
    "user_rows",
]
