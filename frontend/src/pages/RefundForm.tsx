/**
 * T103：退款申請表單（FR-035、FR-036、FR-036c、FR-040、FR-041）。
 *
 * ## ⚠️ 已有審核中的申請時，這個表單 MUST NOT 出現
 *
 * FR-036 禁止同一訂單同時存在兩筆審核中的申請。給他一個必定失敗的表單，
 * 等於請他打完一段字再被拒絕——而他打的那段字就這樣沒了。改為直接顯示
 * 目前的進度，那才是他打開這一頁真正想知道的事。
 *
 * 同一條也適用於 FR-036c 的額度上限：達到 5 筆時 MUST 明確告知不可再申請，
 * 且 **MUST NOT 顯示一個必定失敗的申請表單**。
 *
 * ## ⚠️ 金額由後端算，這裡只是預告
 *
 * 畫面上那個數字是依 FR-041 的級距**預估**的。真正寫進申請的是後端在收到
 * 請求當下算出的值——兩者理論上相同，但若使用者把這一頁開著過了午夜，
 * 距入住日就少了一天，級距可能因此跳一級。所以這裡明說是「預估」。
 *
 * ## ⚠️ FR-040：不產生任何實際金錢移轉
 *
 * 沒有金流串接，也不會有。這一點要在送出前就說清楚，否則使用者會以為
 * 按下去錢就會回到他的帳戶。
 */
import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { MyRefund, Order } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingState } from '../components/LoadingState'
import { useAsync } from '../hooks/useAsync'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { inputClass, useFieldFocus } from '../lib/form'
import { refundStatusLabel } from '../lib/labels'
import { formatTWD } from '../lib/money'
import { insetClass, primaryButtonClass } from '../lib/surfaces'
import {
  MAX_REFUNDS_PER_USER,
  canRequestRefund,
  isRefundQuotaFull,
  latestRefundByOrder,
} from '../lib/orderView'

/**
 * FR-041 的級距，用於**預估**顯示。
 *
 * ⚠️ 與後端的 `_TIERS` 是同一份規則寫在兩個地方。這在此處是可接受的：
 * 前端算錯只會讓預估數字不對，實際金額仍以後端為準——而完全不顯示預估
 * 更糟，使用者會在不知道能拿回多少的情況下送出申請。
 */
const TIERS: { minDays: number; percent: number; label: string }[] = [
  { minDays: 7, percent: 100, label: '入住前 7 天以上' },
  { minDays: 3, percent: 50, label: '入住前 3–6 天' },
  { minDays: 1, percent: 20, label: '入住前 1–2 天' },
]

function estimate(totalAmount: number, checkIn: string, today: string) {
  const daysAhead = dates.nightsBetween(today, checkIn)
  const tier = TIERS.find((t) => daysAhead >= t.minDays)
  if (!tier) return { amount: 0, percent: 0, label: '入住當日起', daysAhead }
  // 與後端一致：先乘後除、無條件捨去
  return {
    amount: Math.floor((totalAmount * tier.percent) / 100),
    percent: tier.percent,
    label: tier.label,
    daysAhead,
  }
}

export function RefundForm() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()

  const loadOrder = useCallback(
    (signal: AbortSignal) => api.orders.get(orderId, signal),
    [orderId],
  )
  const loadRefunds = useCallback((signal: AbortSignal) => api.refunds.list(signal), [])

  const order = useAsync<Order>(loadOrder)
  const refunds = useAsync<MyRefund[]>(loadRefunds)

  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const badField = useFieldFocus(formRef, error)

  if (order.status === 'error') return <ErrorState error={order.error} onRetry={order.reload} />
  if (order.data === null || refunds.data === null) return <LoadingState label="載入訂單…" />

  const data = order.data
  const latest = latestRefundByOrder(refunds.data).get(data.id) ?? null
  const today = dates.today()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.refunds.create({ orderId: data.id, reason })
      // 送出後回到詳情頁——進度與紀錄都在那裡，他接下來要看的是那個
      await navigate(`/orders/${data.id}`, { replace: true })
    } catch (cause) {
      /*
       * FR-083：**MUST 保留已填內容。** `reason` 完全不動——最常見的失敗是
       * 409（別的分頁剛送出過、或額度剛好滿了），而他寫的那段理由重打一次
       * 很花時間，也不見得寫得出一模一樣的。
       */
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const message = error === null ? null : messageFor(error)

  // -- 不該顯示表單的三種情況 ------------------------------------------
  if (latest?.status === 'pending') {
    return (
      <Blocked
        orderId={data.id}
        title="這筆訂單已有一筆退款申請正在審核中"
        body={
          <>
            <p className="text-body text-ink-muted">
              送出時間 {dates.formatTimestamp(latest.createdAt)}，目前狀態
              「{refundStatusLabel(latest.status)}」。
            </p>
            <p className="mt-gap-2 text-body text-ink-muted">申請原因：{latest.reason}</p>
            <p className="mt-gap-2 text-body text-ink-muted">
              預計退款金額 {formatTWD(latest.amount)}。審核完成後，結果會顯示在訂單詳情頁。
            </p>
          </>
        }
      />
    )
  }

  if (!canRequestRefund(data, today)) {
    return (
      <Blocked
        orderId={data.id}
        title="這筆訂單目前無法申請退款"
        body={
          <p className="text-body text-ink-muted">
            {data.status === 'pending-payment'
              ? '此訂單尚未付款，直接取消即可，不需要申請退款。'
              : data.checkIn <= today
                ? '入住日已到或已過，無法再申請退款。'
                : '只有已完成付款且尚未入住的訂單可以申請退款。'}
          </p>
        }
      />
    )
  }

  // ⚠️ FR-036c：達到上限時明確告知，**不顯示一個必定失敗的表單**
  if (isRefundQuotaFull(refunds.data)) {
    return (
      <Blocked
        orderId={data.id}
        title={`您的退款申請已達 ${String(MAX_REFUNDS_PER_USER)} 筆上限`}
        body={
          <p className="text-body text-ink-muted">
            目前無法再提出新的申請。已送出的申請經管理員駁回後，該筆額度會釋出。
          </p>
        }
      />
    )
  }

  const preview = estimate(data.totalAmount, data.checkIn, today)

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to={`/orders/${data.id}`}
        className="text-small text-brand-strong underline underline-offset-4"
      >
        ← 回到訂單詳情
      </Link>

      <h1 className="mt-gap-3 font-display text-h1 text-ink">申請退款</h1>
      <p className="mt-gap-1 text-small text-ink-muted">
        訂單 {data.orderNo}／{dates.formatStay(data.checkIn, data.checkOut)}
      </p>

      {/* 級距與預估金額。⚠️ 送出前就要知道能拿回多少（FR-041） */}
      <section className={`mt-gap-5 ${insetClass} p-gap-5`}>
        <h2 className="text-small text-ink-muted">預估可退金額</h2>
        <p className="mt-gap-1 font-display text-h2 text-ink">{formatTWD(preview.amount)}</p>
        <p className="mt-gap-2 text-small text-ink-muted">
          距入住日 {preview.daysAhead} 天（{preview.label}），依級距退還訂單金額的{' '}
          {preview.percent}%。
        </p>
        <p className="mt-gap-2 text-tiny text-ink-muted">
          {/*
            ⚠️ 說明白是「預估」。使用者把這一頁開著過了午夜，距入住日就少一天，
            級距可能跳一級——不說的話他會覺得金額被偷偷改掉了。
          */}
          實際金額以送出當下伺服器計算的結果為準，並於申請成立時凍結。
        </p>
      </section>

      <p
        role="note"
        className="mt-gap-4 rounded-base border border-warn/30 bg-warn-soft px-gap-4 py-gap-3 text-small text-ink"
      >
        {/* FR-040：MUST NOT 產生任何實際金錢移轉 */}
        本平台為展示用專案，退款流程<strong className="font-semibold">不會產生任何實際金錢移轉</strong>
        。送出後由管理員審核，結果會顯示在訂單詳情頁。
      </p>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="mt-gap-5"
      >
        <Field
          label="退款原因"
          htmlFor="refund-reason"
          error={badField === 'reason' ? (message?.detail ?? null) : null}
          hint="管理員會依這段說明決定是否核准，請具體描述。"
        >
          <textarea
            id="refund-reason"
            name="reason"
            required
            rows={5}
            maxLength={1000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        {/* 對不上欄位的錯誤（額度、重複申請、連線失敗）也 MUST 說出來 */}
        {message && badField !== 'reason' && (
          <p
            role="alert"
            className="mt-gap-4 rounded-xs bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
          >
            {message.detail}
          </p>
        )}

        <div className="mt-gap-6 flex flex-wrap items-center gap-gap-3">
          <button
            type="submit"
            // ⚠️ 只擋「完全沒填」。是否只有空白由後端判定並回 `field: reason`，
            // 前端再多做一次判斷，兩邊的規則遲早會不一致。
            disabled={busy || reason.trim() === ''}
            className={primaryButtonClass}
          >
            {busy ? '送出中…' : '送出退款申請'}
          </button>
          <Link
            to={`/orders/${data.id}`}
            className="text-small text-ink-muted underline underline-offset-4"
          >
            先不申請
          </Link>
        </div>
      </form>
    </div>
  )
}

/**
 * 不能申請時顯示的畫面。
 *
 * ⚠️ 用 `role="status"` 而非 `alert`：這不是錯誤，是一個他還不知道的事實。
 * 用錯誤的樣式呈現會讓人以為自己做錯了什麼。
 */
function Blocked({
  orderId,
  title,
  body,
}: {
  orderId: string
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-xl">
      <Link
        to={`/orders/${orderId}`}
        className="text-small text-brand-strong underline underline-offset-4"
      >
        ← 回到訂單詳情
      </Link>
      <section
        role="status"
        className={`mt-gap-4 ${insetClass} p-gap-6`}
      >
        <h1 className="font-display text-h3 text-ink">{title}</h1>
        <div className="mt-gap-3">{body}</div>
        <Link
          to={`/orders/${orderId}`}
          className={`mt-gap-5 inline-block ${primaryButtonClass}`}
        >
          查看訂單詳情
        </Link>
      </section>
    </div>
  )
}
