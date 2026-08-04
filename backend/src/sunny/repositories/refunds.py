"""會員自己的退款申請（FR-036、FR-037）。

與 `admin_refunds.py` 分開，因為兩者的**授權前提完全不同**：這裡的每一個查詢
都綁著 `user_id`，後台那邊則刻意跨會員。合併成一個 repository 之後，「這個
方法要不要帶 user_id」就變成每次呼叫都得記得的事，而漏掉的那一次就是一個
越權讀取——回來的資料看起來完全正常。

## 交易邊界不在這裡

只 `flush`，不 `commit`。建立退款申請會同時改動 `orders.status`，兩者 MUST 在
同一個交易內完成——分開提交的話，中途失敗會留下一張沒有申請的
`refund-pending` 訂單，而那個狀態永遠不會結束。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from sunny.models.order import STATUS_REFUND_PENDING, Order
from sunny.models.refund import QUOTA_STATUSES, STATUS_PENDING, Refund
from sunny.repositories.base import Repository

#: 一列：退款申請與它所屬的訂單。訂單編號要一起顯示——只有 uuid 的話，
#: 會員在畫面上認不出那是哪一趟行程。
RefundRow = tuple[Refund, Order]


class RefundRepository(Repository):
    """**只回傳指定會員自己的資料。** 每個方法都帶 `user_id`，沒有例外。"""

    async def create(
        self,
        *,
        order: Order,
        user_id: uuid.UUID,
        reason: str,
        amount: int,
    ) -> Refund:
        """寫入一筆審核中的申請，並把訂單轉為 `refund-pending`。**不提交。**

        ⚠️ 呼叫端 MUST 準備好接住資料庫的拒絕：

        - `refunds_one_pending_per_order`（部分唯一索引）→ 同一訂單已有審核中
        - `enforce_refund_limit()`（trigger，P0001）→ 該會員已達 5 筆上限

        兩者都是**正常的結果**，不是程式錯誤。應用層事先查過一次也擋不住並行
        送出的第二筆——那正是把保證放在資料庫的理由（憲章原則 IV）。
        """
        refund = Refund(
            order_id=order.id,
            user_id=user_id,
            reason=reason,
            amount=amount,
            status=STATUS_PENDING,
        )
        self.session.add(refund)

        # 與申請同一個交易。訂單停在 `confirmed` 而申請已寫入的話，
        # 會員在「我的訂單」看不出自己申請過，於是再送一次。
        order.status = STATUS_REFUND_PENDING

        await self.session.flush()
        await self.session.refresh(refund)
        return refund

    async def list_for_user(self, user_id: uuid.UUID) -> list[RefundRow]:
        """某會員的全部申請，新的在前（FR-037）。

        與訂單列表相反的排序是刻意的：訂單依入住日排（他在查行程），
        退款依申請時間排（他在追最近送出的那一筆的進度）。
        """
        stmt = (
            select(Refund, Order)
            .join(Order, Order.id == Refund.order_id)
            .where(Refund.user_id == user_id)
            .order_by(Refund.created_at.desc(), Refund.id)
        )
        return [(refund, order) for refund, order in (await self.session.execute(stmt)).all()]

    async def latest_for_order(self, order_id: uuid.UUID, user_id: uuid.UUID) -> Refund | None:
        """某訂單最近一次的申請。

        FR-039 的「退款已駁回」標籤只看**最新一次**。以「曾被駁回」判定的話，
        那張訂單會永久帶著駁回標籤——即使他後來重新申請並獲准。
        """
        stmt = (
            select(Refund)
            .where(Refund.order_id == order_id, Refund.user_id == user_id)
            .order_by(Refund.created_at.desc(), Refund.id.desc())
            .limit(1)
        )
        return await self.session.scalar(stmt)

    async def quota_used(self, user_id: uuid.UUID) -> int:
        """已佔用的額度筆數（FR-036b）。

        ⚠️ **只算「審核中」與「已核准」，被駁回的不算**（SC-031）。這個計數
        只用來事先給出「已達上限」的訊息；真正擋下第六筆的是資料庫的 trigger
        （FR-036d）。兩者都要有：少了 trigger 就擋不住並行，少了這裡則使用者
        會看到一句來自 PostgreSQL 的原始訊息。
        """
        stmt = (
            select(func.count())
            .select_from(Refund)
            .where(Refund.user_id == user_id, Refund.status.in_(QUOTA_STATUSES))
        )
        return await self.session.scalar(stmt) or 0


__all__ = ["RefundRepository", "RefundRow"]
