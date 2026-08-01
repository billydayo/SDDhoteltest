-- 會員可主動取消尚未付款的訂單（FR-035a）。
--
-- 兩處要改：
--   1. orders_update 的 WITH CHECK 要放行 'cancelled'
--   2. guard_order_transition 要接受 cancel_reason = 'member-cancelled'
--
-- 只放寬 RLS 是不夠的：WITH CHECK 看不到舊資料列，無法分辨「待付款 → 已取消」
-- 與「已確認 → 已取消」。後者必須擋下——錢已經付了，取消得走退款審核，
-- 否則會繞過 FR-041 的退款級距。那條規則由下方的 trigger 執行。
--
-- 對既有資料庫執行一次即可；schema.sql 已同步，全新安裝不需要跑這支。
-- 可重複執行。

begin;

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (user_id = auth.uid() and status in ('confirmed', 'refund-pending', 'cancelled'))
  );

create or replace function public.guard_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;                       -- 管理員可自由變更狀態
  end if;

  if new.status is distinct from old.status then
    -- 付款：僅允許 待付款 → 已確認，且必須尚未逾期
    if new.status = 'confirmed' then
      if old.status <> 'pending-payment' then
        raise exception '只有待付款的訂單可以完成付款' using errcode = '42501';
      end if;
      if old.expires_at < now() then
        raise exception '訂單已逾期取消，無法付款' using errcode = '42501';
      end if;
    -- 申請退款：僅允許 已確認 → 退款審核中
    elsif new.status = 'refund-pending' then
      if old.status <> 'confirmed' then
        raise exception '只有已確認的訂單可以申請退款' using errcode = '42501';
      end if;
    -- 取消：僅允許 待付款 → 已取消
    --   ・payment-timeout   逾期自動取消，由 expire_stale_orders() 觸發
    --   ・member-cancelled  會員主動取消
    elsif new.status = 'cancelled' and old.status = 'pending-payment'
          and (
            (new.cancel_reason = 'payment-timeout' and old.expires_at < now())
            or new.cancel_reason = 'member-cancelled'
          ) then
      return new;
    else
      raise exception '不允許的訂單狀態變更' using errcode = '42501';
    end if;
  end if;

  -- 會員不得改動金額、日期與保留期限
  if new.total_amount is distinct from old.total_amount
     or new.check_in is distinct from old.check_in
     or new.check_out is distinct from old.check_out
     or new.expires_at is distinct from old.expires_at then
    raise exception '不允許變更訂單的金額、日期或保留期限' using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;

-- 驗證（以會員身分執行）：
--   ・對自己的待付款訂單設 status='cancelled', cancel_reason='member-cancelled' → 成功
--   ・對自己的已確認訂單做同樣的事 → 42501「不允許的訂單狀態變更」
