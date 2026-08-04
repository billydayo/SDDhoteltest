/**
 * T102：訂單詳情與取消的二次確認（FR-033、FR-035a、FR-039）。
 *
 * ## ⚠️ 二次確認只實作這一份
 *
 * 列表上的「取消訂單」是一個導向這裡的連結，不是第二套流程（FR-035b）。
 * 兩份確認遲早會分歧，而分歧的那一份會少講一句「此操作不可復原」——
 * 那正是這個確認存在的唯一理由。
 *
 * 確認裡 MUST 講清楚兩件事：**不可復原**，以及**房間會立刻開放給其他人**。
 * 只說「確定要取消嗎？」的話，使用者按下去之後才發現自己回不去了。
 *
 * ## ⚠️ 這個確認不是安全機制
 *
 * 它擋不住任何人——直接對 API 送一個 POST 就繞過去了。真正拒絕「取消已確認
 * 訂單」的是後端（FR-081）。這裡的作用只有一個：讓誤觸的人有機會反悔。
 *
 * ## FR-039：「退款已駁回」在詳情頁要說得更完整
 *
 * 列表上只有一個標籤，位置不夠。詳情頁 MUST 另以文字說明**訂房仍然有效**
 * 且**可以再次申請**——否則使用者看到「退款已駁回」會以為訂房也一併沒了。
 */
import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { MyRefund, Order } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PaymentCountdown } from '../components/PaymentCountdown'
import { useAsync } from '../hooks/useAsync'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import {
  TONE_CLASS,
  cancelReasonLabel,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  refundStatusLabel,
} from '../lib/labels'
import { formatTWD } from '../lib/money'
import { insetClass } from '../lib/surfaces'
import {
  MAX_REFUNDS_PER_USER,
  REFUND_REJECTED_TAB,
  canRequestRefund,
  displayStatusOf,
  isRefundQuotaFull,
  latestRefundByOrder,
} from '../lib/orderView'

export function OrderDetail() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()

  const loadOrder = useCallback(
    (signal: AbortSignal) => api.orders.get(orderId, signal),
    [orderId],
  )
  const loadRefunds = useCallback((signal: AbortSignal) => api.refunds.list(signal), [])

  const order = useAsync<Order>(loadOrder)
  const refunds = useAsync<MyRefund[]>(loadRefunds)

  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<unknown>(null)

  if (order.status === 'error') return <ErrorState error={order.error} onRetry={order.reload} />
  if (order.data === null) return <LoadingState label="載入訂單…" />

  const data = order.data
  const myRefunds = (refunds.data ?? []).filter((r) => r.orderId === data.id)
  const latest = latestRefundByOrder(refunds.data ?? []).get(data.id) ?? null
  const display = displayStatusOf(data, latest)
  const rejected = display === REFUND_REJECTED_TAB

  const pending = data.status === 'pending-payment'
  const expired = dates.secondsUntil(data.expiresAt) <= 0
  const refundable = canRequestRefund(data, dates.today())
  const quotaFull = isRefundQuotaFull(refunds.data ?? [])

  async function cancel() {
    setCancelling(true)
    setError(null)
    try {
      await api.orders.cancel(data.id)
      setConfirming(false)
      order.reload()
    } catch (cause) {
      // ⚠️ MUST NOT 靜默失敗。最常見的是 409——訂單在他猶豫的這段時間裡
      // 已經逾期並自動取消了，而後端那句話說得比「取消失敗」清楚。
      setError(cause)
      setConfirming(false)
    } finally {
      setCancelling(false)
    }
  }

  const message = error === null ? null : messageFor(error)

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/orders" className="text-small text-brand-strong underline underline-offset-4">
        ← 回到我的訂單
      </Link>

      <div className="mt-gap-3 flex flex-wrap items-start justify-between gap-gap-3">
        <div>
          <h1 className="font-display text-h1 text-ink">{data.orderNo}</h1>
          <p className="mt-gap-1 text-small text-ink-muted">
            建立於 {dates.formatTimestamp(data.createdAt)}
          </p>
        </div>
        <span
          className={`inline-block rounded-pill border px-gap-3 py-px text-tiny whitespace-nowrap ${
            TONE_CLASS[rejected ? 'danger' : orderStatusTone(data.status)]
          }`}
        >
          {rejected ? '退款已駁回' : orderStatusLabel(data.status)}
        </span>
      </div>

      {/*
        ⚠️ FR-039：訂房仍然有效。列表上的標籤位置不夠，這句話 MUST 出現在
        這裡——否則使用者看到「退款已駁回」會以為訂房也一併沒了。
      */}
      {rejected && (
        <p
          role="status"
          className="mt-gap-4 rounded-base border border-line-strong bg-surface-alt px-gap-4 py-gap-3 text-small text-ink"
        >
          您的退款申請未通過審核，但<strong className="font-semibold">這筆訂房仍然有效</strong>
          ，住宿權益不受影響。若情況有變，您可以再次提出退款申請。
        </p>
      )}

      {pending && !expired && (
        <div className={`mt-gap-4 ${insetClass} p-gap-4`}>
          <PaymentCountdown expiresAt={data.expiresAt} onExpire={order.reload} />
        </div>
      )}

      <dl className="mt-gap-5 grid gap-gap-4 rounded-lg border border-line-soft bg-surface shadow-soft p-gap-5 sm:grid-cols-2">
        <Row label="住宿期間" value={dates.formatStay(data.checkIn, data.checkOut)} />
        <Row label="夜數" value={`${String(data.nights)} 晚`} />
        <Row label="入住人數" value={`${String(data.guestCount)} 人`} />
        <Row label="付款方式" value={paymentMethodLabel(data.paymentMethod)} />
        <Row label="聯絡人" value={`${data.contactName}／${data.phone}`} />
        <Row label="電子郵件" value={data.email} />
        {data.cancelReason && (
          <Row label="取消原因" value={cancelReasonLabel(data.cancelReason)} />
        )}
      </dl>

      <p className="mt-gap-4 flex items-baseline justify-between rounded-lg bg-brand-soft p-gap-5">
        <span className="text-ink">總金額</span>
        <span className="font-display text-h2 text-ink">{formatTWD(data.totalAmount)}</span>
      </p>

      {message && (
        <p
          role="alert"
          className="mt-gap-4 rounded-xs bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
        >
          {message.detail}
        </p>
      )}

      {/* -- 動作 -------------------------------------------------------- */}
      <div className="mt-gap-6 flex flex-wrap gap-gap-3">
        {pending && !expired && !confirming && (
          <button
            type="button"
            onClick={() => {
              setConfirming(true)
            }}
            className="rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-danger hover:text-danger"
          >
            取消訂單
          </button>
        )}

        {/*
          ⚠️ 已確認的訂單**沒有取消按鈕**——不是藏起來，是這條路徑不存在
          （FR-035a）。要退款就走退款申請，由管理員依級距審核。
        */}
        {refundable && !quotaFull && (
          <Link
            to={`/orders/${data.id}/refund`}
            className="rounded-pill bg-brand px-gap-6 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
          >
            申請退款
          </Link>
        )}

        {/*
          ⚠️ FR-036c：達到上限時 MUST 明確告知且 MUST NOT 顯示一個必定失敗的
          申請表單。因此這裡是一句話，不是一顆被停用的按鈕——停用的按鈕不會
          說明原因。
        */}
        {/*
          T112：已完成入住才出現撰寫評論的入口（FR-042）。
          ⚠️ **無論評論過沒有都顯示這個連結**，文案不變。要改文案就得先知道
          他評過了沒，而那要為了一顆按鈕多打一次 `GET /reviews`——那一頁進去
          本來就會查，且會直接顯示既有的那一則（`ReviewForm.tsx`）。
          在這裡藏起來的話，他反而找不到自己寫過什麼。
        */}
        {data.status === 'completed' && (
          <Link
            to={`/orders/${data.id}/review`}
            className="rounded-pill bg-brand px-gap-6 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
          >
            撰寫評論
          </Link>
        )}

        {refundable && quotaFull && (
          <p
            role="status"
            className="rounded-base border border-warn/30 bg-warn-soft px-gap-4 py-gap-2 text-small text-ink"
          >
            您的退款申請已達 {MAX_REFUNDS_PER_USER} 筆上限，目前無法再提出新的申請。
          </p>
        )}
      </div>

      {confirming && (
        <CancelConfirm
          busy={cancelling}
          onCancel={() => {
            setConfirming(false)
          }}
          onConfirm={() => {
            void cancel()
          }}
        />
      )}

      {myRefunds.length > 0 && <RefundHistory rows={myRefunds} />}

      {/* 取消成功後回到列表比停在一張已取消的訂單上有用 */}
      {data.status === 'cancelled' && (
        <button
          type="button"
          onClick={() => {
            void navigate('/orders')
          }}
          className="mt-gap-6 rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          回到我的訂單
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
/**
 * 二次確認（FR-035a）。
 *
 * ⚠️ **兩件事 MUST 講出來**：此操作不可復原，房間會立刻開放給其他人預訂。
 * 少了第二句，使用者會以為自己「等一下再訂回來」就好。
 *
 * 用行內區塊而不是 `window.confirm`：後者無法寫兩段說明，也不能標示哪一個
 * 才是危險的選項——而它的預設按鈕正好是「確定」。
 */
function CancelConfirm({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <section
      role="alertdialog"
      aria-labelledby="cancel-confirm-title"
      className="mt-gap-5 rounded-lg border border-danger/30 bg-danger-soft p-gap-5"
    >
      <h2 id="cancel-confirm-title" className="font-display text-h3 text-danger">
        確定要取消這筆訂單嗎？
      </h2>
      <ul className="mt-gap-3 grid gap-gap-2 text-small text-ink">
        <li>此操作<strong className="font-semibold">不可復原</strong>，取消後無法回復這筆訂單。</li>
        <li>該日期區間會<strong className="font-semibold">立刻開放</strong>給其他人預訂，可能很快被訂走。</li>
        <li>尚未付款，因此不會有任何款項往返。</li>
      </ul>
      <div className="mt-gap-5 flex flex-wrap gap-gap-3">
        {/* 危險的那一個不是預設焦點，也不放在慣性點擊的位置 */}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-pill bg-brand px-gap-6 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
        >
          保留訂單
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-pill border border-danger px-gap-5 py-gap-2 text-small text-danger transition-colors hover:bg-danger hover:text-ink-invert disabled:opacity-50"
        >
          {busy ? '取消中…' : '確定取消訂單'}
        </button>
      </div>
    </section>
  )
}

function RefundHistory({ rows }: { rows: MyRefund[] }) {
  return (
    <section className="mt-gap-6">
      <h2 className="font-display text-h3 text-ink">退款申請紀錄</h2>
      <ul className="mt-gap-3 grid gap-gap-3">
        {rows.map((refund) => (
          <li key={refund.id} className="rounded-lg border border-line-soft bg-surface shadow-soft p-gap-4">
            <div className="flex flex-wrap items-center justify-between gap-gap-2">
              <span className="text-small text-ink">
                {dates.formatTimestamp(refund.createdAt)} 申請
              </span>
              <span className="text-small text-ink">{refundStatusLabel(refund.status)}</span>
            </div>
            <p className="mt-gap-2 text-small text-ink-muted">原因：{refund.reason}</p>
            <p className="mt-gap-1 text-small text-ink">
              退款金額 {formatTWD(refund.amount)}
            </p>
            {/*
              ⚠️ `adminNote` 為 `null` 代表「還沒審」或「審過但沒留言」，
              兩者都不該印出一行空的「管理員備註：」。
            */}
            {refund.adminNote && (
              <p className="mt-gap-2 rounded-xs bg-surface-alt px-gap-3 py-gap-2 text-small text-ink-muted">
                管理員備註：{refund.adminNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tiny text-ink-muted">{label}</dt>
      <dd className="mt-gap-1 text-body text-ink">{value}</dd>
    </div>
  )
}
