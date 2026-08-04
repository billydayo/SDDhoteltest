"""guard_order_transition：允許退款駁回把訂單送回已確認（FR-039）。

## 這支遷移修的是什麼

`0001` 的 `guard_order_transition()` 對「轉為 confirmed」只認一種來路：

    if new.status = 'confirmed' and old.status <> 'pending-payment' then
        raise exception '只有待付款的訂單可以完成付款'

但 FR-039 明訂「退款遭駁回後，訂單狀態 MUST 回到『已確認』」。駁回時
`admin_refunds` 正是把 `refund-pending` 寫回 `confirmed`——那道 raise 於是擋下
一個**規格要求的**轉換，`PATCH /admin/refunds/{id}` 以 500 收場：客人的退款
申請被駁回了，訂單卻永遠卡在「退款審核中」，房況也一直被佔著。

同一段裡的逾期檢查有相同的問題：`old.expires_at` 是**付款期限**，退款審核中的
訂單早就過了那個時間點，因此即使放行狀態來源，逾期檢查仍會攔下它。逾期檢查
MUST 只在「完成付款」這條路徑上生效。

## 為什麼不放寬成「任何狀態都能轉 confirmed」

因為那道檢查擋的是真正的危險：已取消／已退款／已完成的訂單被改回已確認，
會讓一個沒有付款的區間重新佔住房況，而 `orders_no_overlap` 此時才會以一句
資料庫錯誤浮現——如果剛好沒人訂走那幾晚，就連錯誤都不會有。
因此改為**列舉兩個合法來源**，其餘照舊拒絕。

由 T130 的 `test_rejecting_a_refund_keeps_the_interval_occupied` 抓出——那個
測試在測試資料庫建起來之前一直是 skip 的狀態。
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 金額／日期／保留期限不可變更的部分兩版相同，逐字保留（FR-032、FR-101）。
_IMMUTABLE_FIELDS = """
          if new.total_amount is distinct from old.total_amount
             or new.check_in is distinct from old.check_in
             or new.check_out is distinct from old.check_out
             or new.expires_at is distinct from old.expires_at then
            raise exception '不允許變更訂單的金額、日期或保留期限' using errcode = '42501';
          end if;
"""


def upgrade() -> None:
    op.execute(
        f"""
        create or replace function public.guard_order_transition()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
        begin
          if new.status is distinct from old.status and new.status = 'confirmed' then
            if old.status = 'pending-payment' then
              -- 完成付款。逾期的訂單不得付款（FR-100、SC-024）。
              if old.expires_at < now() then
                raise exception '訂單已逾期取消，無法付款' using errcode = '42501';
              end if;
            elsif old.status <> 'refund-pending' then
              -- 退款駁回是唯一的另一條合法來路（FR-039）。已取消、已退款、
              -- 已完成的訂單 MUST NOT 被改回已確認。
              raise exception '只有待付款或退款審核中的訂單可以轉為已確認'
                using errcode = '42501';
            end if;
          end if;
{_IMMUTABLE_FIELDS}
          return new;
        end;
        $fn$
        """
    )


def downgrade() -> None:
    """還原為 0001 的版本。

    ⚠️ 還原後退款駁回會再次失敗——這不是可以放著不管的舊行為，只是為了讓
    遷移鏈可逆。真的要退版時，`admin_refunds` 的駁回路徑也得一起退。
    """
    op.execute(
        f"""
        create or replace function public.guard_order_transition()
        returns trigger
        language plpgsql
        set search_path = public, pg_catalog
        as $fn$
        begin
          if new.status is distinct from old.status and new.status = 'confirmed' then
            if old.status <> 'pending-payment' then
              raise exception '只有待付款的訂單可以完成付款' using errcode = '42501';
            end if;
            if old.expires_at < now() then
              raise exception '訂單已逾期取消，無法付款' using errcode = '42501';
            end if;
          end if;
{_IMMUTABLE_FIELDS}
          return new;
        end;
        $fn$
        """
    )
