/**
 * T101／T104：我的訂單（FR-033、FR-035b、FR-039、FR-036c）。
 *
 * ## ⚠️ FR-035b：付款與取消的入口 MUST 出現在**列表**上
 *
 * 不是只在詳情頁。列表上已經顯示保留時效的倒數，讓使用者看得到時效卻按不到
 * 動作，在驗收中被直接判定為「取消功能缺失」——他不會想到要先點進詳情頁。
 *
 * 取消的二次確認**仍然只實作一份**（`OrderDetail`）。列表上的取消是一個
 * 導向詳情頁的連結，不是第二套確認流程。兩份確認遲早會分歧，而分歧的那一份
 * 會少講一句「此操作不可復原」。
 *
 * ## ⚠️ FR-039：「退款已駁回」是**顯示層**的標籤
 *
 * 訂單在資料上仍是 `confirmed`——住宿權益不受影響，可訂性與能否再次申請一律
 * 以資料值為準。**MUST NOT 新增資料庫狀態值**：加進 `OrderStatus` 會讓後台
 * 把它列為可指派的狀態，而管理員一旦選了它，那筆訂單就會停在一個沒有任何
 * 程式碼處理的狀態上。
 *
 * 判定依據是**最新一次**申請遭駁回。以「曾被駁回」判定的話，那張訂單會永久
 * 帶著駁回標籤——即使他後來重新申請並獲准。
 *
 * ## ⚠️ FR-036c：未達上限時 MUST NOT 顯示剩餘次數
 *
 * 「你還剩 2 次」會讓正常使用的人開始節省，而退款申請本來就該按需提出。
 * 只有真的達到 5 筆上限時才說，且那時要明確告知不可再申請。
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { MyRefund, Order } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PaymentCountdown } from '../components/PaymentCountdown'
import { useAsync } from '../hooks/useAsync'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { TONE_CLASS, cancelReasonLabel, orderStatusLabel, orderStatusTone } from '../lib/labels'
import { formatTWD } from '../lib/money'
import {
  MAX_REFUNDS_PER_USER,
  REFUND_REJECTED_TAB,
  displayStatusOf,
  isRefundQuotaFull,
  latestRefundByOrder,
  type DisplayStatus,
} from '../lib/orderView'
import { useStaleOrderSweep } from '../state/useStaleOrderSweep'
import { panelClass, primaryButtonClass } from '../lib/surfaces'

/** 分頁。⚠️ 「退款已駁回」與其他七個不同——它不是資料庫裡的狀態值。 */
const TABS: { key: DisplayStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending-payment', label: orderStatusLabel('pending-payment') },
  { key: 'confirmed', label: orderStatusLabel('confirmed') },
  { key: 'refund-pending', label: orderStatusLabel('refund-pending') },
  { key: REFUND_REJECTED_TAB, label: '退款已駁回' },
  { key: 'refunded', label: orderStatusLabel('refunded') },
  { key: 'completed', label: orderStatusLabel('completed') },
  { key: 'cancelled', label: orderStatusLabel('cancelled') },
]

export function Orders() {
  const loadOrders = useCallback((signal: AbortSignal) => api.orders.list(signal), [])
  const loadRefunds = useCallback((signal: AbortSignal) => api.refunds.list(signal), [])

  const orders = useAsync<Order[]>(loadOrders)
  const refunds = useAsync<MyRefund[]>(loadRefunds)

  const [tab, setTab] = useState<DisplayStatus | 'all'>('all')

  /*
   * 列表是唯讀畫面，逾期清理可以照常跑（T093a）。清理完重新查一次——
   * 使用者盯著倒數看到 0 的時候，狀態就該自己變成「已取消」，而不是要他
   * 手動重新整理才發現。
   */
  useStaleOrderSweep({ enabled: true, onSwept: orders.reload })

  const latestRefund = useMemo(
    () => latestRefundByOrder(refunds.data ?? []),
    [refunds.data],
  )

  if (orders.status === 'error') return <ErrorState error={orders.error} onRetry={orders.reload} />
  if (orders.data === null) return <LoadingState label="載入訂單…" />

  const rows = orders.data.map((order) => ({
    order,
    display: displayStatusOf(order, latestRefund.get(order.id) ?? null),
  }))
  const shown = tab === 'all' ? rows : rows.filter((row) => row.display === tab)

  /*
   * ⚠️ 只有**達到上限**時才提。未達上限時連提都不提（FR-036c）。
   *
   * 退款清單載入失敗時一律當成「未達上限」——寧可讓他按下去被後端拒絕，
   * 也不要在資料不確定的情況下先擋住他。
   */
  const quotaFull = isRefundQuotaFull(refunds.data ?? [])

  return (
    <div>
      <h1 className="font-display text-h1 text-ink">我的訂單</h1>
      <p className="mt-gap-1 text-small text-ink-muted">依入住日由近而遠排列。</p>

      {quotaFull && (
        <p
          role="status"
          className="mt-gap-4 rounded-base border border-warn/30 bg-warn-soft px-gap-4 py-gap-3 text-small text-ink"
        >
          您的退款申請已達 {MAX_REFUNDS_PER_USER} 筆上限，目前無法再提出新的申請。
          已送出的申請經管理員駁回後，該筆額度會釋出。
        </p>
      )}

      <nav aria-label="訂單狀態" className="mt-gap-5 flex flex-wrap gap-gap-2">
        {TABS.map((item) => {
          const count = item.key === 'all' ? rows.length : rows.filter((r) => r.display === item.key).length
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              // 目前選了哪一個，MUST NOT 只靠顏色（憲章原則 V）
              aria-pressed={active}
              onClick={() => {
                setTab(item.key)
              }}
              className={[
                'rounded-pill border px-gap-4 py-gap-1 text-small transition-colors',
                active
                  ? 'border-brand bg-brand text-ink-invert'
                  : 'border-line-strong text-ink-muted hover:border-brand hover:text-brand-strong',
              ].join(' ')}
            >
              {item.label}
              <span className="ml-gap-2 tabular-nums">{count}</span>
            </button>
          )
        })}
      </nav>

      {shown.length === 0 ? (
        <EmptyState
          title={tab === 'all' ? '還沒有任何訂單' : '這個分類目前沒有訂單'}
          hint={
            tab === 'all'
              ? '挑一間喜歡的房間，訂房完成後就會出現在這裡。'
              : '換一個分類看看，或選「全部」。'
          }
          action={
            tab === 'all' ? (
              <Link
                to="/"
                className={primaryButtonClass}
              >
                去找房源
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="mt-gap-5 grid gap-gap-4">
          {shown.map(({ order, display }) => (
            <OrderRow key={order.id} order={order} display={display} onChanged={orders.reload} />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function OrderRow({
  order,
  display,
  onChanged,
}: {
  order: Order
  display: DisplayStatus
  onChanged: () => void
}) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const pending = order.status === 'pending-payment'
  const expired = dates.secondsUntil(order.expiresAt) <= 0

  async function pay() {
    setPaying(true)
    setError(null)
    try {
      await api.orders.pay(order.id)
      onChanged()
    } catch (cause) {
      // ⚠️ MUST NOT 靜默失敗。最常見的是 409「付款時間已過」——那句話要
      // 原樣傳達，它已經說了該去重新查詢（FR-083、FR-100）。
      setError(cause)
    } finally {
      setPaying(false)
    }
  }

  return (
    <li className={`${panelClass} p-gap-5`}>
      <div className="flex flex-wrap items-start justify-between gap-gap-3">
        <div>
          <p className="font-display text-md text-ink">{order.orderNo}</p>
          <p className="mt-gap-1 text-small text-ink-muted">
            {dates.formatStay(order.checkIn, order.checkOut)}／{order.guestCount} 人
          </p>
        </div>
        <StatusBadge order={order} display={display} />
      </div>

      {pending && !expired && (
        // FR-102：列表上就看得到剩餘時效——而 FR-035b 要求動作也在同一個地方
        <div className="mt-gap-3">
          <PaymentCountdown expiresAt={order.expiresAt} onExpire={onChanged} />
        </div>
      )}

      <div className="mt-gap-4 flex flex-wrap items-center justify-between gap-gap-3">
        <span className="font-display text-h3 text-ink">{formatTWD(order.totalAmount)}</span>

        <div className="flex flex-wrap items-center gap-gap-3">
          {/*
            ⚠️ FR-035b：待付款訂單的**付款與取消入口 MUST 同時在這裡**。
            取消是一個導向詳情頁的連結——二次確認只實作一份（FR-035a）。
          */}
          {pending && !expired && (
            <>
              <button
                type="button"
                disabled={paying}
                onClick={() => {
                  void pay()
                }}
                className={primaryButtonClass}
              >
                {paying ? '處理中…' : '完成模擬付款'}
              </button>
              <Link
                to={`/orders/${order.id}`}
                className="rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-danger hover:text-danger"
              >
                取消訂單
              </Link>
            </>
          )}

          <Link to={`/orders/${order.id}`} className="text-small text-brand-strong underline underline-offset-4">
            訂單詳情
          </Link>
        </div>
      </div>

      {order.cancelReason && (
        <p className="mt-gap-3 text-tiny text-ink-muted">
          取消原因：{cancelReasonLabel(order.cancelReason)}
        </p>
      )}

      {error !== null && <RowError error={error} />}
    </li>
  )
}

function StatusBadge({ order, display }: { order: Order; display: DisplayStatus }) {
  // ⚠️ 「退款已駁回」不是 `order.status`——它是顯示層算出來的（FR-039）。
  const isRejected = display === REFUND_REJECTED_TAB
  const label = isRejected ? '退款已駁回' : orderStatusLabel(order.status)
  const tone = isRejected ? 'danger' : orderStatusTone(order.status)

  return (
    <span
      className={`inline-block rounded-pill border px-gap-3 py-px text-tiny whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  )
}

function RowError({ error }: { error: unknown }) {
  return (
    <p
      role="alert"
      className="mt-gap-3 rounded-xs bg-danger-soft px-gap-3 py-gap-2 text-small text-danger"
    >
      {messageFor(error).detail}
    </p>
  )
}
