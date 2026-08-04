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

from sunny.models.order import CANCEL_MEMBER, STATUS_CANCELLED, Order
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
        """某會員的全部訂單，**依入住日由近而遠**（FR-033）。

        ⚠️ 排序依據是 `check_in`，不是 `created_at`。兩者在多數情況下順序相同，
        直到有人補訂一個比較早的日期——那時他的下一趟行程會排在列表最下面，
        而他正是為了確認那一趟才打開這一頁。

        `created_at` 作為第二鍵：同一天入住的兩筆訂單要有穩定的順序，否則
        每次重新整理的排列都可能不同。

        逾期清理 MUST 在此之前執行，否則列表會顯示一筆早該取消的待付款訂單，
        使用者點進去付款卻被拒——那時他已經看著倒數計時等了一段時間。
        """
        await self.expire_stale_orders()
        stmt = (
            select(Order)
            .where(Order.user_id == user_id)
            .order_by(Order.check_in.asc(), Order.created_at.asc(), Order.id)
        )
        return list((await self.session.scalars(stmt)).all())

    async def get(self, order_id: uuid.UUID) -> Order | None:
        """依 id 取單。**不篩選擁有者。**

        擁有者判定屬於授權，由路由層做——因為「非本人」與「不存在」要回不同的
        狀態碼（403 / 404），在此處就篩掉會讓兩者無從分辨（contracts/README.md）。
        """
        return await self.session.scalar(select(Order).where(Order.id == order_id))

    async def get_fresh(self, order_id: uuid.UUID) -> Order | None:
        """依 id 取單，**先清理逾期訂單**。

        與 `get` 分開而不是直接加進去：`get` 也被「付款」與「取消」用到，而那兩處
        各自有更精細的順序要求。這一支是給唯讀路徑用的——讀一筆訂單詳情時，
        使用者看到的 MUST 是逾期清理**之後**的狀態，否則列表說已取消、
        點進去卻還在倒數。
        """
        await self.expire_stale_orders()
        return await self.get(order_id)

    async def cancel_by_member(self, order: Order) -> Order:
        """會員主動取消一筆待付款訂單（FR-035a）。**不提交。**

        ⚠️ **`cancel_reason` MUST 與逾期取消區分。** 兩者都計入「未付款取消
        訂單數」，但「客人改變主意」與「付款流程有問題」是完全不同的營運訊號
        ——合併成同一個值之後，後台再也分不出來，而那個數字正是用來判斷付款
        流程是否需要改善的依據。

        取消後該區間**立即**釋出：`cancelled` 不在排除約束的
        `where status in ('pending-payment', 'confirmed', 'refund-pending')`
        之內，因此下一筆訂單馬上訂得到。沒有「釋放房況」這個動作可寫，
        也不該有——房況若另以欄位維護，「改了狀態卻忘了同步」就會成為可能，
        而它的徵狀是房間安靜地賣不出去。
        """
        order.status = STATUS_CANCELLED
        order.cancel_reason = CANCEL_MEMBER
        await self.session.flush()
        return order


__all__ = ["OrderRepository"]
