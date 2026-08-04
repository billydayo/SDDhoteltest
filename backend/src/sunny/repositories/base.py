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

from sunny.errors import InternalError


class Repository:
    """所有 repository 的基底。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def expire_stale_orders(self) -> int:
        """將逾期的待付款訂單標記為已取消並釋出房況。回傳受影響的筆數。

        ⚠️ **有取消到東西時會自行提交。這是刻意的，且是 FR-099 的必要條件。**

        三個呼叫點裡有兩個是唯讀路徑（搜尋房源、查房態），而唯讀路徑的請求
        session 從頭到尾不會 commit。不在此處提交的話，這次取消會隨請求結束
        一併回滾：**該次請求看到的房況是對的，資料庫裡的訂單卻永遠停在
        `pending-payment`**。使用者的訂單列表會顯示一筆倒數早已歸零、卻仍標示
        待付款的訂單，而「未付款取消訂單數」（FR-035a）會少算。

        這個失效模式不會拋任何錯誤，也不會讓房況出錯——只有直接查資料庫才看
        得出來。實際跑過一次 US3 才發現。

        提交在此處是安全的，因為 `expire_stale_orders()` **MUST 是其交易中的第
        一個敘述**（見模組說明的三個呼叫點）——此刻交易裡還沒有別人的工作。
        違反這個順序會踩到下面的 `InternalError`，而不是被靜默提交一半。

        由資料庫函式執行而非在 Python 端逐筆更新：這是一個 UPDATE ... WHERE，
        沒有理由把資料撈回來再寫回去。
        """
        result = await self.session.execute(text("select public.expire_stale_orders()"))
        affected = int(result.scalar() or 0)
        if not affected:
            # 沒有東西過期是絕大多數情況。不動交易狀態。
            return 0

        if self.session.new or self.session.dirty or self.session.deleted:
            # 呼叫順序被違反了：交易裡已經有尚未提交的變更，此時提交會把別人
            # 做到一半的工作一併寫進去——管理員的變更與其稽核紀錄可能因此被
            # 拆開。**寧可大聲失敗，也不要靜默提交一半。**
            raise InternalError(
                "expire_stale_orders() MUST 為其交易中的第一個敘述，但此 session 已有未提交的變更",
                code="EXPIRY_CALLED_MID_TRANSACTION",
            )

        await self.session.commit()
        return affected


__all__ = ["Repository"]
