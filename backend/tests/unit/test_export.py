"""T136：匯出的三項不變式（FR-058、FR-058a、FR-060、FR-118）。

1. **0 筆時 MUST NOT 產生檔案**且 MUST 提示無資料。
2. **用戶匯出 MUST NOT 包含電子郵件與密碼欄位。**
3. **匯出日誌 MUST NOT 含任何一列的實際內容。**

不需要資料庫：三者都是資料組裝的性質，不是查詢的性質。用假物件餵進去比接一個
真的 PostgreSQL 更能把「欄位有沒有洩漏」測乾淨——真資料裡剛好沒有電話號碼，
不代表那一欄不會被輸出。

## 第 2 點為什麼要逐鍵斷言而不是比對欄位清單

比對 `USER_COLUMNS` 只證明**宣告**沒有 email。真正離開系統的是 `rows`，
而 rows 是另一段程式碼組出來的。兩者分開驗證，是因為它們會分開改壞。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from sunny.services import export
from sunny.services.export import (
    EXPORT_MODULES,
    FORBIDDEN_USER_KEYS,
    FORMAT_CSV,
    FORMAT_XLSX,
    USER_COLUMNS,
)

NOW = datetime(2026, 8, 4, 10, 30, tzinfo=UTC)


# ---------------------------------------------------------------------------
# 假物件：只帶匯出會讀到的欄位，外加一些**不該**被輸出的欄位
# ---------------------------------------------------------------------------
@dataclass
class FakeProfile:
    display_name: str = "王小明"
    role: str = "member"
    phone: str | None = "0912345678"
    created_at: datetime = NOW
    # ↓ 以下三項刻意存在。若 `user_rows` 改用萬用欄位傾倒，它們就會跑進輸出。
    email: str = "victim@example.com"
    password_hash: str = "$argon2id$v=19$m=65536,t=3,p=4$secret"
    google_sub: str = "1234567890"


@dataclass
class FakeRoom:
    name: str = "海景雙人房"
    type: str = "雙人房"
    max_guests: int = 2
    nightly_price: int = 3_200
    status: str = "available"
    average_rating: Decimal | None = Decimal("4.50")
    amenities: list[str] | None = None
    features: list[str] | None = None
    created_at: datetime = NOW

    def __post_init__(self) -> None:
        self.amenities = self.amenities if self.amenities is not None else ["wifi", "冷氣"]
        self.features = self.features if self.features is not None else ["海景"]


@dataclass
class FakeOrder:
    order_no: str = "SN2026080400001"
    check_in: date = date(2026, 9, 1)
    check_out: date = date(2026, 9, 3)
    nights: int = 2
    guest_count: int = 2
    contact_name: str = "王小明"
    phone: str = "0912345678"
    email: str = "victim@example.com"
    payment_method: str = "LINE Pay"
    total_amount: int = 6_400
    status: str = "confirmed"
    created_at: datetime = NOW


@dataclass
class FakeAdminLog:
    action: str = "order.status"
    target_table: str = "orders"
    target_id: str | None = "abc"
    summary: dict[str, Any] | None = None
    created_at: datetime = NOW

    def __post_init__(self) -> None:
        self.summary = self.summary if self.summary is not None else {"from": "a", "to": "b"}


# ---------------------------------------------------------------------------
# 1. 0 筆
# ---------------------------------------------------------------------------
def test_every_module_reports_no_data_when_empty() -> None:
    """七個模組**都**要在 0 筆時說「沒有資料」（FR-060）。

    逐一驗證而非抽樣：這種缺陷是逐模組發生的，抽驗到的那個正常不代表其他六個。
    """
    builders = [
        export.room_rows,
        export.order_rows,
        export.user_rows,
        export.review_rows,
        export.refund_rows,
        export.channel_rows,
        export.log_rows,
    ]
    assert len(builders) == len(EXPORT_MODULES), "七個模組各需一個組裝函式（FR-058）"

    for build in builders:
        sheet = build([])
        assert sheet.row_count == 0
        assert sheet.has_data is False, f"{build.__name__} 於 0 筆時 hasData MUST 為 false"
        assert sheet.columns, "即使無資料，欄位定義仍要在——前端據此顯示表頭"


def test_zero_rows_are_not_the_same_as_falsy_rows() -> None:
    """`has_data` MUST 反映筆數，不是反映欄位有沒有值。"""
    empty = export.user_rows([])
    one = export.user_rows([FakeProfile()])

    assert empty.has_data is False
    assert one.has_data is True
    assert one.row_count == 1


@pytest.mark.asyncio
async def test_zero_rows_writes_no_audit_record() -> None:
    """**0 筆時 MUST NOT 記錄**（FR-058a）。

    沒有檔案離開系統，就沒有東西需要稽核。若照樣記錄，操作日誌會被一堆
    「匯出了 0 筆」淹沒，而真正的匯出紀錄反而更難找到。

    以一個會在被使用時爆炸的 session 驗證：只要 `record_export` 動了資料庫，
    這個測試就會失敗而不是靜默通過。
    """

    class ExplodingSession:
        def add(self, *_: Any) -> None:  # pragma: no cover - 不該被呼叫
            raise AssertionError("0 筆匯出 MUST NOT 寫入稽核紀錄（FR-058a）")

        async def flush(self) -> None:  # pragma: no cover - 不該被呼叫
            raise AssertionError("0 筆匯出 MUST NOT 寫入稽核紀錄（FR-058a）")

    entry = await export.record_export(
        ExplodingSession(),  # type: ignore[arg-type]
        actor_id=uuid.uuid4(),
        sheet=export.user_rows([]),
        fmt=FORMAT_XLSX,
    )
    assert entry is None


# ---------------------------------------------------------------------------
# 2. 用戶匯出不含電子郵件與密碼
# ---------------------------------------------------------------------------
def test_user_columns_declare_no_email_or_password() -> None:
    """欄位**宣告**層。"""
    declared = {c.key for c in USER_COLUMNS}
    assert not (declared & FORBIDDEN_USER_KEYS), f"用戶匯出的欄位宣告含禁用鍵：{declared}"


def test_user_rows_contain_no_email_or_password() -> None:
    """實際**輸出**層。**這才是離開系統的東西。**

    假物件上刻意帶著 `email`、`password_hash` 與 `google_sub`——若哪天有人把
    `user_rows` 改成 `vars(p)` 或 `model_dump()`，這裡會立刻掛掉。
    """
    sheet = export.user_rows([FakeProfile()])
    (row,) = sheet.rows

    for forbidden in FORBIDDEN_USER_KEYS:
        assert forbidden not in row, f"用戶匯出 MUST NOT 含 {forbidden}（FR-058）"

    # 值層再掃一次：換個鍵名夾帶同一個值同樣是外洩
    serialized = "".join(str(v) for v in row.values())
    assert "victim@example.com" not in serialized
    assert "argon2id" not in serialized
    assert "1234567890" not in serialized


def test_order_rows_carry_phone_but_not_email() -> None:
    """訂單匯出含電話**但不含電子郵件**。

    電話是業者聯繫客人所必需，拿掉會讓匯出的訂單檔失去用途。電子郵件則與
    帳號的電子郵件通常是同一個——匯出它等於繞過 FR-058 對用戶模組的限制。
    """
    sheet = export.order_rows([(FakeOrder(), "海景雙人房")])
    (row,) = sheet.rows

    assert row["phone"] == "0912345678"
    assert "email" not in row
    assert "victim@example.com" not in "".join(str(v) for v in row.values())


# ---------------------------------------------------------------------------
# 3. 匯出日誌不含任何一列的內容
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_export_audit_summary_contains_only_module_count_and_format() -> None:
    """**匯出日誌 MUST 只有模組、筆數與格式**（FR-058a、FR-118）。

    匯出的正是會員資料，把它抄進所有管理員都讀得到的日誌，等於為了記錄
    一次外洩風險而製造第二個外洩點。
    """
    captured: dict[str, Any] = {}

    class CapturingSession:
        def add(self, entry: Any) -> None:
            captured["summary"] = entry.summary
            captured["action"] = entry.action
            captured["target_table"] = entry.target_table

        async def flush(self) -> None:
            return None

    sheet = export.user_rows([FakeProfile(), FakeProfile(display_name="李小華")])
    await export.record_export(
        CapturingSession(),  # type: ignore[arg-type]
        actor_id=uuid.uuid4(),
        sheet=sheet,
        fmt=FORMAT_XLSX,
    )

    assert captured["summary"] == {
        "module": export.MODULE_USERS,
        "rowCount": 2,
        "format": FORMAT_XLSX,
    }

    # 任何一列的內容都不得出現在日誌中——含顯示名稱這種較不敏感的欄位
    serialized = str(captured["summary"])
    assert "王小明" not in serialized
    assert "李小華" not in serialized


@pytest.mark.asyncio
async def test_exporting_the_audit_log_is_itself_audited() -> None:
    """**匯出操作日誌本身同樣 MUST 被記錄**（FR-058a）。

    「稽核紀錄被帶離系統是所有匯出裡最敏感的一種，唯一的例外反而應該是它
    最不該有的。」這裡驗的是 `record_export` 裡沒有 `if module == LOGS: return`。
    """
    recorded: list[Any] = []

    class CapturingSession:
        def add(self, entry: Any) -> None:
            recorded.append(entry)

        async def flush(self) -> None:
            return None

    sheet = export.log_rows([(FakeAdminLog(), "管理員甲")])
    entry = await export.record_export(
        CapturingSession(),  # type: ignore[arg-type]
        actor_id=uuid.uuid4(),
        sheet=sheet,
        fmt=FORMAT_CSV,
    )

    assert entry is not None
    assert len(recorded) == 1
    assert recorded[0].summary["module"] == export.MODULE_LOGS
    assert recorded[0].summary["format"] == FORMAT_CSV


@pytest.mark.asyncio
async def test_unknown_format_is_rejected() -> None:
    """格式只有 xlsx 與 csv。CSV 是離線退路，不是第三種選項（FR-059）。"""
    with pytest.raises(ValueError):
        await export.record_export(
            object(),  # type: ignore[arg-type]
            actor_id=uuid.uuid4(),
            sheet=export.user_rows([FakeProfile()]),
            fmt="pdf",
        )


# ---------------------------------------------------------------------------
# 其他欄位語意
# ---------------------------------------------------------------------------
def test_missing_rating_exports_as_blank_not_zero() -> None:
    """尚無評分 MUST NOT 匯出為 0（FR-047）。

    匯出檔沒有「尚無評分」的呈現層可依賴。寫 0 會讓收到檔案的人以為那間房
    被評過 0 分——而那正是 FR-047 要避免的誤讀。
    """
    (row,) = export.room_rows([FakeRoom(average_rating=None)]).rows
    assert row["averageRating"] == ""

    (rated,) = export.room_rows([FakeRoom(average_rating=Decimal("4.50"))]).rows
    assert rated["averageRating"] == pytest.approx(4.5)


def test_channel_rows_always_carry_the_simulated_marker() -> None:
    """渠道比價的**每一列**都帶「模擬資料」標記（FR-110）。

    介面上的常駐提示只存在於畫面。檔案離開系統之後，收到它的人會把那些數字
    當成真實的市場價格——這一欄是那個提示唯一能跟著走的形式。
    """

    @dataclass
    class FakeComparison:
        room_name: str = "海景雙人房"
        channel: str = "Agoda"
        official_price: int = 3_200
        channel_price: int = 2_880
        gap: int = 320
        gap_percent: Decimal = Decimal("10.0")
        resolved: bool = False
        captured_at: datetime = NOW

    sheet = export.channel_rows([FakeComparison(), FakeComparison(channel="Booking")])
    assert len(sheet.rows) == 2
    for row in sheet.rows:
        assert "模擬" in row["simulated"]
