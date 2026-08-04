"""渠道比價的 API 形狀（FR-108、FR-110、FR-112）。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from sunny.schemas.room import CamelModel
from sunny.services.channel import SIMULATED_NOTICE, ChannelComparison


class ChannelComparisonOut(CamelModel):
    """一筆房源 × 平台的價格比較（FR-108）。

    ⚠️ **`simulated` 與 `simulatedNotice` 是每一列的一部分，不是頁面層的裝飾。**

    介面頂端的常駐提示（FR-110）只存在於畫面。這份資料會被匯出成檔案、
    被截圖、被轉寄給沒看過那塊提示的人——標記必須跟著資料走，否則收到的人
    會把這些數字當成真實的市場價格。

    `gapPercent` 為 `float` 而非 `Decimal`：後者在 Pydantic 的 JSON 模式下會
    序列化成**字串**（`"10.0"`），前端得先 `Number()` 才能比大小
    （schemas/admin.py 的同一段說明）。它是顯示用的比值，不參與金額累加。
    """

    id: uuid.UUID
    room_id: uuid.UUID
    room_name: str
    channel: str
    #: 整數新臺幣元
    official_price: int
    channel_price: int
    #: 官網價 − 平台售價。**正值代表對方賣得比我們便宜**（FR-111）
    gap: int
    gap_percent: float
    #: 是否觸發賤賣預警——嚴格小於才算
    underpriced: bool
    resolved: bool
    captured_at: datetime

    simulated: bool = True
    simulated_notice: str = SIMULATED_NOTICE

    @classmethod
    def of(cls, comparison: ChannelComparison) -> ChannelComparisonOut:
        return cls(
            id=comparison.id,
            room_id=comparison.room_id,
            room_name=comparison.room_name,
            channel=comparison.channel,
            official_price=comparison.official_price,
            channel_price=comparison.channel_price,
            gap=comparison.gap,
            gap_percent=float(comparison.gap_percent),
            underpriced=comparison.underpriced,
            resolved=comparison.resolved,
            captured_at=comparison.captured_at,
        )


class ComplaintOut(CamelModel):
    """申訴郵件範本（FR-112）。

    ⚠️ `willSend` 恆為 **false**，且帶一句給使用者看的 `notice`。

    做成回應的一部分而非只寫在前端文案裡：這個承諾屬於系統行為，
    而系統行為的定義在後端。前端的文案可以被改掉，這個欄位改掉就得改後端。

    刻意**不含收件者信箱**——帶著收件者的範本會讓人以為只差按一下送出。
    """

    subject: str
    body: str
    #: 恆為 false。系統 MUST NOT 代為寄送任何郵件。
    will_send: bool = False
    notice: str


class ResolveIn(CamelModel):
    """標記或取消標記已處理（FR-113）。"""

    resolved: bool = True
    note: str | None = Field(default=None, max_length=500)


__all__ = ["ChannelComparisonOut", "ComplaintOut", "ResolveIn"]
