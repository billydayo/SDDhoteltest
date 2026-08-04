"""資料存取層的共用基底。

憲章原則 III：「後端 MUST 將資料存取集中於明確的資料層，MUST NOT 讓 SQL 或
ORM 查詢散落於路由處理函式中。」

## 逾期判定的三個呼叫點

`expire_stale_orders()` MUST 在以下三處**之前**執行（data-model.md）：

1. 查詢房況（搜尋可訂房源）
2. 建立訂單
3. 讀取訂單列表

**MUST 於 repository 層內部呼叫，MUST NOT 交由各路由自行記得**——新增路由的
人不需要知道它們存在，這正是集中的目的。忘記呼叫的後果不是報錯，而是逾期的
待付款訂單繼續佔著房況，房間安靜地賣不出去。

## 為什麼不用排程

排程只需寫一次，但**排程失效不可見**：它掛了之後房況會安靜地停止釋出，沒有
任何請求會因此報錯。查詢時判定的失效是立即可見的。憲章原則 IV 亦明文禁止
依賴外部排程（research R4）。

取捨已載於 spec 的 Assumptions：「自動取消」的可觀察時點是下一次有人查詢時，
而非到期的那一秒。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class Repository:
    """所有 repository 的基底。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def expire_stale_orders(self) -> int:
        """將逾期的待付款訂單標記為已取消並釋出房況。

        回傳受影響的筆數。呼叫此方法**不會**提交交易——交易邊界屬於呼叫端，
        管理員的變更 MUST 與其稽核紀錄在同一個交易內完成。

        由資料庫函式執行而非在 Python 端逐筆更新：這是一個 UPDATE ... WHERE，
        沒有理由把資料撈回來再寫回去。
        """
        result = await self.session.execute(text("select public.expire_stale_orders()"))
        return int(result.scalar() or 0)


__all__ = ["Repository"]
