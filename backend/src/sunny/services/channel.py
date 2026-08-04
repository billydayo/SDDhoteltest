"""渠道比價的判定與申訴郵件範本（FR-108、FR-110~FR-113）。

⚠️ **本模組不發送任何郵件，也不連線至任何外部平台。**

`compose_complaint()` 只**組出文字**交給前端顯示，供管理員自行複製寄出。
系統 MUST NOT 代為寄送（FR-112），介面上 MUST 明確告知這一點——一個看起來
會寄出的按鈕，按下去卻什麼也沒發生，比沒有這個功能更糟。

比價資料來自 `channel_prices` 種子表，**是模擬資料**（FR-109、FR-110）。
理由是法律與倫理而非技術：爬取 OTA 平台通常違反其服務條款
（research B1-a、憲章原則 VI）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sunny.repositories.admin_channel import ChannelRow

#: 每一筆比價都帶著這個標記離開後端。介面上的常駐提示（FR-110）只存在於畫面，
#: 而資料會被匯出成檔案、被截圖、被轉寄——標記必須跟著資料走。
SIMULATED_NOTICE = "模擬資料：此模組不連線至任何外部平台"


@dataclass(frozen=True, slots=True)
class ChannelComparison:
    """一筆房源 × 平台的價格比較（FR-108）。"""

    id: uuid.UUID
    room_id: uuid.UUID
    room_name: str
    channel: str
    #: 官網價（`rooms.nightly_price`），整數新臺幣元
    official_price: int
    #: 該平台售價，整數新臺幣元
    channel_price: int
    #: 官網價 − 平台售價。**正值代表對方賣得比我們便宜**，即賤賣（FR-111）。
    gap: int
    #: 價差佔官網價的百分比，四捨五入至小數第一位
    gap_percent: Decimal
    resolved: bool
    captured_at: datetime
    #: 每一列都帶——見 `SIMULATED_NOTICE`
    simulated: bool = True

    @property
    def underpriced(self) -> bool:
        """是否觸發賤賣預警（FR-111）。

        **嚴格小於**。等價不是賤賣；把它算成預警只會讓待處理數字永遠不歸零，
        而永遠不歸零的提醒等於沒有提醒。
        """
        return self.channel_price < self.official_price


def _percent(gap: int, official_price: int) -> Decimal:
    """價差百分比。

    官網價為 0 時回 0 而非拋例外：`rooms_nightly_price_check` 已擋住 0 元房價，
    真的出現只可能是資料異常——為此讓整個比價頁面 500，代價不成比例。

    用 `Decimal` 而非 float：這是顯示用的比值，不參與金額累加，但四捨五入的
    位數要能精確控制（`services/stats.py` 同一考量）。
    """
    if official_price <= 0:
        return Decimal("0.0")
    rate = Decimal(gap) * 100 / Decimal(official_price)
    return rate.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def compare(row: ChannelRow) -> ChannelComparison:
    """由一列查詢結果算出價差（FR-108）。"""
    price, room_name, official_price = row
    gap = official_price - price.channel_price
    return ChannelComparison(
        id=price.id,
        room_id=price.room_id,
        room_name=room_name,
        channel=price.channel,
        official_price=official_price,
        channel_price=price.channel_price,
        gap=gap,
        gap_percent=_percent(gap, official_price),
        resolved=price.resolved,
        captured_at=price.captured_at,
    )


def compare_all(rows: list[ChannelRow]) -> list[ChannelComparison]:
    return [compare(row) for row in rows]


def alert_count(comparisons: list[ChannelComparison]) -> int:
    """未處理的賤賣預警筆數，供儀表板顯示（FR-111）。"""
    return sum(1 for c in comparisons if c.underpriced and not c.resolved)


# ---------------------------------------------------------------------------
# 申訴郵件範本（FR-112）
# ---------------------------------------------------------------------------
def compose_complaint(comparison: ChannelComparison) -> dict[str, str]:
    """組出申訴郵件的主旨與內文。**MUST NOT 發送。**

    內容依 FR-112 涵蓋五項：房源、平台、官網價、對方售價、價差。

    回傳 `subject` 與 `body` 兩段純文字，由前端顯示於可複製的區塊，
    並於畫面上明確告知系統不會代為寄送。這裡刻意不回傳收件者信箱——
    一個帶著收件者的範本會讓人以為只差按一下送出。
    """
    subject = f"【價格申訴】{comparison.room_name} 於 {comparison.channel} 的售價低於官方網站"
    body = (
        f"您好，\n\n"
        f"我們注意到本旅宿的房源「{comparison.room_name}」於貴平台"
        f"（{comparison.channel}）的售價低於官方網站公告價格，明細如下：\n\n"
        f"　官方網站售價：新臺幣 {comparison.official_price:,} 元\n"
        f"　貴平台售價　：新臺幣 {comparison.channel_price:,} 元\n"
        f"　價差　　　　：新臺幣 {comparison.gap:,} 元"
        f"（{comparison.gap_percent}%）\n\n"
        f"依雙方合作條款，煩請協助調整售價或說明差異原因。\n\n"
        f"敬祝　商祺\n"
        f"Sunny 訂房平台 敬上\n"
    )
    return {"subject": subject, "body": body}


__all__ = [
    "SIMULATED_NOTICE",
    "ChannelComparison",
    "alert_count",
    "compare",
    "compare_all",
    "compose_complaint",
]
