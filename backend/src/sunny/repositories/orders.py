"""訂單的資料存取。

## expire_stale_orders() 的兩個呼叫點在這裡

`Repository.expire_stale_orders()` MUST 在三處之前執行（data-model.md）：

1. 查詢房況 ....................... `RoomRepository.search` / `availability_*`
2. **建立訂單** ................... `OrderRepository.create`
3. **讀取訂單列表** ............... `OrderRepository.list_for_user`

**MUST 於 repository 層內部呼叫，MUST NOT 交由各路由自行記得**（憲章原則 III）。
漏掉的後果不是報錯：建單前漏掉，逾期的待付款訂單仍佔著排除約束，房間安靜地
賣不出去；列表前漏掉，使用者看到一筆早該取消的訂單還在倒數。

## 交易邊界不在這裡

本模組只 `flush`，不 `commit`。commit 屬於呼叫端——管理員的變更 MUST 與其
稽核紀錄在同一個交易內完成（憲章資料存取規則）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from sunny.models.order import Order
from sunny.repositories.base import Repository
from sunny.services import booking


class OrderRepository(Repository):
    """訂單的唯一資料出口（憲章原則 III）。"""

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        room_id: uuid.UUID,
        draft: booking.BookingDraft,
        contact_name: str,
        phone: str,
        email: str,
    ) -> Order:
        """寫入一筆待付款訂單。

        ⚠️ 呼叫端 MUST 準備好接住 `IntegrityError`：房況重疊在此刻才會被資料庫
        判定，而那是**正常且必然會發生的競態結果**，不是程式錯誤（SC-020）。

        `expires_at` 與 `status` 刻意不設，交由資料庫的欄位預設值求值
        （FR-101）；`flush` 後以 `refresh` 取回。
        """
        # MUST 於建立訂單前執行——逾期的待付款訂單仍佔著排除約束
        await self.expire_stale_orders()

        order = Order(
            order_no=await booking.next_order_no(self.session),
            user_id=user_id,
            room_id=room_id,
            check_in=draft.check_in,
            check_out=draft.check_out,
            nights=draft.nights,
            guest_count=draft.guest_count,
            contact_name=contact_name,
            phone=phone,
            email=email,
            payment_method=draft.payment_method,
            total_amount=draft.total_amount,
        )
        self.session.add(order)
        await self.session.flush()

        # 明確取回資料庫求值的欄位。**不要靠屬性存取觸發延遲載入**——非同步
        # session 下的隱式載入會拋 MissingGreenlet，而那個錯誤與訂房毫無關聯，
        # 排查時完全看不出來源。
        await self.session.refresh(order)
        return order

    async def list_for_user(self, user_id: uuid.UUID) -> list[Order]:
        """某會員的全部訂單，新的在前（FR-033）。

        逾期清理 MUST 在此之前執行，否則列表會顯示一筆早該取消的待付款訂單，
        使用者點進去付款卻被拒——那時他已經看著倒數計時等了一段時間。
        """
        await self.expire_stale_orders()
        stmt = (
            select(Order)
            .where(Order.user_id == user_id)
            .order_by(Order.created_at.desc(), Order.id)
        )
        return list((await self.session.scalars(stmt)).all())

    async def get(self, order_id: uuid.UUID) -> Order | None:
        """依 id 取單。**不篩選擁有者。**

        擁有者判定屬於授權，由路由層做——因為「非本人」與「不存在」要回不同的
        狀態碼（403 / 404），在此處就篩掉會讓兩者無從分辨（contracts/README.md）。
        """
        return await self.session.scalar(select(Order).where(Order.id == order_id))


__all__ = ["OrderRepository"]
