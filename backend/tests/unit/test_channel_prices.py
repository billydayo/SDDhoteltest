"""T154：渠道比價**不連線任何外部平台**（FR-109、FR-110、SC-028）。

兩件事在此驗證：

1. **模組運作期間連向外部訂房平台的網路請求數為 0。**
2. **回應帶有標示其為模擬資料的欄位。**

## 為什麼這需要一個測試

「我們沒有寫爬蟲」是一個關於**沒有發生什麼**的宣稱，而那種宣稱不會因為
程式碼正確就自動成立——它會因為某天有人加了一行 `httpx.get(...)` 而失效，
且不會有任何既有測試失敗。

限制的理由不是技術做不到（現在有後端了），而是**爬取 OTA 平台通常違反其
服務條款**。憲章明訂「後端的存在 MUST NOT 被當成『現在可以寫爬蟲了』的理由」
（research B1-a、憲章原則 VI）。這是法律與倫理的界線，因此值得一道自動化的
防線而不只是一段註解。

## 驗證方式

把 socket 層的連線動作換掉。攔 `httpx` 或 `requests` 這種特定函式庫是不夠的
——換一個函式庫就繞過去了；socket 是所有函式庫的共同出口。
"""

from __future__ import annotations

import socket
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from sunny.services import channel
from sunny.services.channel import SIMULATED_NOTICE

NOW = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)


@dataclass
class FakeChannelPrice:
    id: uuid.UUID
    room_id: uuid.UUID
    channel: str = "Agoda"
    channel_price: int = 2_880
    resolved: bool = False
    captured_at: datetime = NOW


def _row(**kwargs) -> tuple:
    """一列 `ChannelRow`：(ChannelPrice, 房源名稱, 官網價)。"""
    official = kwargs.pop("official_price", 3_200)
    room_name = kwargs.pop("room_name", "海景雙人房")
    price = FakeChannelPrice(id=uuid.uuid4(), room_id=uuid.uuid4(), **kwargs)
    return price, room_name, official


# ---------------------------------------------------------------------------
# 1. 零對外請求
# ---------------------------------------------------------------------------
@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    """任何對外連線都會被記錄並拒絕。

    攔在 `socket.socket.connect` 而非某個 HTTP 函式庫：換一個函式庫就能繞過
    後者，而 socket 是所有函式庫的共同出口。
    """
    attempts: list[object] = []
    original = socket.socket.connect

    def _blocked(self, address, *args, **kwargs):  # noqa: ANN001, ANN202
        attempts.append(address)
        raise AssertionError(f"渠道比價模組 MUST NOT 連向外部（嘗試連往 {address}）")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    yield attempts
    monkeypatch.setattr(socket.socket, "connect", original)


def test_comparison_makes_no_outbound_connections(no_network: list[object]) -> None:
    """比價計算期間的對外請求數為 **0**（FR-109、SC-028）。"""
    rows = [_row(channel="Agoda"), _row(channel="Booking", channel_price=3_500)]
    comparisons = channel.compare_all(rows)

    assert len(comparisons) == 2
    assert no_network == [], f"偵測到對外連線：{no_network}"


def test_complaint_template_makes_no_outbound_connections(no_network: list[object]) -> None:
    """**組出郵件範本 MUST NOT 寄出任何東西**（FR-112）。

    「組文字」與「寄郵件」在程式碼裡差一個 SMTP 連線；這個測試就是那個差別的
    自動化形式。介面上亦 MUST 明確告知系統不會代為寄送。
    """
    template = channel.compose_complaint(channel.compare(_row()))

    assert template["subject"]
    assert template["body"]
    assert no_network == [], f"組郵件範本時偵測到對外連線：{no_network}"


def test_alert_count_makes_no_outbound_connections(no_network: list[object]) -> None:
    comparisons = channel.compare_all([_row(), _row(channel_price=4_000)])
    assert channel.alert_count(comparisons) == 1
    assert no_network == []


# ---------------------------------------------------------------------------
# 2. 模擬資料的標示
# ---------------------------------------------------------------------------
def test_every_comparison_is_marked_as_simulated() -> None:
    """**每一筆**都帶模擬標記（FR-110）。

    做成每一列的欄位而非頁面層的裝飾：介面頂端的常駐提示只存在於畫面，
    而資料會被匯出、截圖、轉寄給沒看過那塊提示的人。
    """
    for comparison in channel.compare_all([_row(), _row(channel="Booking")]):
        assert comparison.simulated is True

    assert "不連線" in SIMULATED_NOTICE
    assert "模擬" in SIMULATED_NOTICE


def test_the_notice_does_not_claim_to_be_real_market_data() -> None:
    """提示文字 MUST 說清楚這不是真實資料。

    「資料僅供參考」這種說法不夠——它讀起來像是「真的但可能過時」。
    """
    assert "模擬資料" in SIMULATED_NOTICE


# ---------------------------------------------------------------------------
# 價差計算
# ---------------------------------------------------------------------------
def test_gap_is_official_minus_channel() -> None:
    """價差 = 官網價 − 平台售價。**正值代表對方賣得比我們便宜**（FR-111）。"""
    comparison = channel.compare(_row(official_price=3_200, channel_price=2_880))
    assert comparison.gap == 320
    assert comparison.gap_percent == Decimal("10.0")
    assert comparison.underpriced is True


def test_higher_channel_price_is_not_an_alert() -> None:
    """對方賣得比較貴不是賤賣，價差為負值且不觸發預警。"""
    comparison = channel.compare(_row(official_price=3_200, channel_price=3_500))
    assert comparison.gap == -300
    assert comparison.underpriced is False


def test_equal_price_is_not_an_alert() -> None:
    """**等價不算賤賣。**

    嚴格小於才算。把等價也算成預警，那個待處理數字就永遠不會歸零，
    而永遠不歸零的提醒等於沒有提醒。
    """
    comparison = channel.compare(_row(official_price=3_200, channel_price=3_200))
    assert comparison.gap == 0
    assert comparison.underpriced is False


def test_resolved_alerts_do_not_count() -> None:
    """已標記處理的不計入待處理數（FR-113）。"""
    comparisons = channel.compare_all(
        [_row(channel_price=2_000), _row(channel="Booking", channel_price=2_000, resolved=True)]
    )
    assert channel.alert_count(comparisons) == 1


def test_zero_official_price_does_not_raise() -> None:
    """官網價為 0 時回 0% 而非拋例外。

    `rooms` 的 CHECK 約束已擋住 0 元房價，真的出現只可能是資料異常——
    為此讓整個比價頁面 500，代價不成比例。
    """
    comparison = channel.compare(_row(official_price=0, channel_price=100))
    assert comparison.gap_percent == Decimal("0.0")


def test_complaint_template_covers_the_five_required_items() -> None:
    """範本 MUST 含房源、平台、官網價、對方售價、價差（FR-112）。"""
    comparison = channel.compare(
        _row(room_name="海景雙人房", channel="Agoda", official_price=3_200, channel_price=2_880)
    )
    template = channel.compose_complaint(comparison)
    body = template["body"]

    assert "海景雙人房" in body
    assert "Agoda" in template["subject"]
    assert "3,200" in body
    assert "2,880" in body
    assert "320" in body
