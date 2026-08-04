/**
 * T112／T114：撰寫評論（FR-042、FR-043、FR-044、FR-103a）。
 *
 * ## ⚠️ 已評論過時，這個表單 MUST NOT 出現
 *
 * FR-043：一筆訂單只能有一則評論。給他一個必定失敗的表單，等於請他打完一段
 * 字再被 409 拒絕——而他打的那段字就這樣沒了。改為直接顯示既有的那一則
 * （同 `RefundForm.tsx` 的 `Blocked`）。
 *
 * 判斷依據是 `GET /reviews`（我的評論），它**含尚未通過審核的**。只看公開
 * 端點的話，一則還在審核中的評論會看起來像不存在，於是他再寫一次、再撞 409。
 *
 * ## ⚠️ 送出後 MUST 說明「不會立刻出現」
 *
 * FR-045：評論一律先進待審核。不講的話，他會回到房源頁找自己的評論、找不到，
 * 然後合理地認為送出失敗了——接著再寫一次。
 *
 * ## ⚠️ 自動審核 MUST 標示為「自動審核（規則式）」（T114、FR-103a）
 *
 * MUST NOT 被描述為 AI 或人工智慧判讀。這裡只說明「會先經自動檢查，再由人
 * 複核」，**不透露觸發了哪條規則**——後端刻意不回那些代碼給作者
 * （`services/moderation.py`）。
 */
import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../api/client'
import { REVIEW_CATEGORIES, type MyReview, type Order, type ReviewCategory } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingState } from '../components/LoadingState'
import { useAsync } from '../hooks/useAsync'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { inputClass, useFieldFocus } from '../lib/form'
import { primaryButtonClass } from '../lib/surfaces'

/** 1–5（FR-044）。 */
const RATINGS = [1, 2, 3, 4, 5] as const

const RATING_HINT: Record<number, string> = {
  1: '很不滿意',
  2: '不太滿意',
  3: '普通',
  4: '滿意',
  5: '非常滿意',
}

export function ReviewForm() {
  const { orderId = '' } = useParams()

  const loadOrder = useCallback((signal: AbortSignal) => api.orders.get(orderId, signal), [orderId])
  const loadReviews = useCallback((signal: AbortSignal) => api.reviews.list(signal), [])

  const order = useAsync<Order>(loadOrder)
  const reviews = useAsync<MyReview[]>(loadReviews)

  const [rating, setRating] = useState(5)
  const [category, setCategory] = useState<ReviewCategory>(REVIEW_CATEGORIES[0])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [submitted, setSubmitted] = useState<MyReview | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const badField = useFieldFocus(formRef, error)

  if (order.status === 'error') return <ErrorState error={order.error} onRetry={order.reload} />
  if (order.data === null || reviews.data === null) return <LoadingState label="載入訂單…" />

  const data = order.data
  const existing = reviews.data.find((r) => r.orderId === data.id) ?? null

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      setSubmitted(await api.reviews.create({ orderId: data.id, rating, comment, category }))
    } catch (cause) {
      /*
       * FR-083：**MUST 保留已填內容。** `comment` 完全不動——最常見的失敗是
       * 409（另一個分頁剛送出過），而他寫的那段心得重打一次很花時間。
       */
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  // -- 送出成功 -------------------------------------------------------------
  // ⚠️ 不直接導走。導走的話「已送出、待審核」這句話沒有機會被讀到，
  // 而那正是他接下來最需要知道的事（FR-045）。
  if (submitted) return <Submitted review={submitted} orderId={data.id} roomId={data.roomId} />

  // -- 已經評論過（FR-043）-------------------------------------------------
  if (existing) return <AlreadyReviewed review={existing} orderId={data.id} roomId={data.roomId} />

  // -- 還不能評論（FR-042）-------------------------------------------------
  // 後端會擋（409 ORDER_NOT_COMPLETED），但那要等他寫完才會知道。
  if (data.status !== 'completed') {
    return (
      <Notice title="這筆訂單還不能評論" orderId={data.id}>
        <p className="text-body text-ink-muted">
          入住結束後就可以撰寫評論。目前這筆訂單的狀態尚未完成住宿。
        </p>
      </Notice>
    )
  }

  const message = error === null ? null : messageFor(error)

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to={`/orders/${data.id}`}
        className="text-small text-brand-strong underline underline-offset-4"
      >
        ← 回到訂單詳情
      </Link>

      <h1 className="mt-gap-3 font-display text-h1 text-ink">撰寫評論</h1>
      <p className="mt-gap-1 text-small text-ink-muted">
        訂單 {data.orderNo}／{dates.formatStay(data.checkIn, data.checkOut)}
      </p>

      <ModerationNotice />

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="mt-gap-5 grid gap-gap-5"
      >
        <fieldset>
          <legend className="mb-gap-2 text-small text-ink-muted">評分</legend>
          {/*
            ⚠️ 用 radio 而不是一排 `<button>` 的星星。星星按鈕在鍵盤上是五個
            各自獨立的停留點，讀屏也念不出「五選一」這件事；radio group 兩者
            都是天生的（憲章原則 V）。
          */}
          <div className="flex flex-wrap gap-gap-2">
            {RATINGS.map((value) => (
              <label
                key={value}
                className={[
                  'cursor-pointer rounded-pill border px-gap-4 py-gap-2 text-small transition-colors',
                  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
                  rating === value
                    ? 'border-brand bg-brand text-ink-invert'
                    : 'border-line-strong text-ink-muted hover:border-brand',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => {
                    setRating(value)
                  }}
                  className="sr-only"
                />
                <span aria-hidden="true">{'★'.repeat(value)}</span>
                <span className="sr-only">
                  {value} 分（{RATING_HINT[value]}）
                </span>
              </label>
            ))}
          </div>
          <p className="mt-gap-2 text-tiny text-ink-muted">
            目前選擇：{rating} 分（{RATING_HINT[rating]}）
          </p>
        </fieldset>

        <Field
          label="評論類型"
          htmlFor="review-category"
          hint="其他旅客會依這個類型篩選評論。"
          error={badField === 'category' ? (message?.detail ?? null) : null}
        >
          <select
            id="review-category"
            name="category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ReviewCategory)
            }}
            className={inputClass}
          >
            {REVIEW_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="評論內容"
          htmlFor="review-comment"
          hint="請具體描述住宿體驗，這對其他旅客最有幫助。"
          error={badField === 'comment' ? (message?.detail ?? null) : null}
        >
          <textarea
            id="review-comment"
            name="comment"
            required
            rows={6}
            maxLength={2000}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        {/* 對不上欄位的錯誤（重複評論、連線失敗）也 MUST 說出來 */}
        {message && badField !== 'comment' && badField !== 'category' && (
          <p
            role="alert"
            className="rounded-xs bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
          >
            {message.detail}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-gap-3">
          <button
            type="submit"
            // ⚠️ 只擋「完全沒填」。長度是否足夠由後端的自動審核判定——
            // 前端再擋一次的話，兩邊的門檻遲早不一致，而使用者會遇到一顆
            // 按得下去卻被退件、或按不下去卻不知道為什麼的按鈕。
            disabled={busy || comment.trim() === ''}
            className={primaryButtonClass}
          >
            {busy ? '送出中…' : '送出評論'}
          </button>
          <Link
            to={`/orders/${data.id}`}
            className="text-small text-ink-muted underline underline-offset-4"
          >
            先不評論
          </Link>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
/**
 * T114：審核機制的說明（FR-103a、FR-045）。
 *
 * ⚠️ **MUST 標示為「自動審核（規則式）」，MUST NOT 描述為 AI 或人工智慧判讀。**
 * 這是規則式引擎，稱它為 AI 是對使用者的不實陳述（憲章原則 VI）。
 *
 * 也 MUST 講明「不會立刻出現」——否則他回到房源頁找不到自己的評論，
 * 會合理地認為送出失敗而再寫一次。
 */
function ModerationNotice() {
  return (
    <p
      role="note"
      className="mt-gap-4 rounded-base border border-line-strong bg-surface-alt px-gap-4 py-gap-3 text-small text-ink"
    >
      評論送出後會先經<strong className="font-semibold">自動審核（規則式）</strong>
      初步檢查，再由管理員複核，通過後才會顯示在房源頁面上，
      <strong className="font-semibold">不會立即公開</strong>。
    </p>
  )
}

/** 送出成功。⚠️ 重點是「還沒公開」，不是「成功了」。 */
function Submitted({
  review,
  orderId,
  roomId,
}: {
  review: MyReview
  orderId: string
  roomId: string
}) {
  return (
    <Notice title="評論已送出，正在等待審核" orderId={orderId} tone="ok">
      <p className="text-body text-ink-muted">
        您給了 {review.rating} 分（{review.category}）。經審核通過後，這則評論就會出現在房源頁面上。
      </p>
      <p className="mt-gap-2 text-body text-ink-muted">
        {/* ⚠️ 不透露觸發了哪條規則——那等於一份規避指南（services/moderation.py） */}
        審核由管理員完成，自動審核（規則式）只是初步檢查。
      </p>
      <ExtraLinks orderId={orderId} roomId={roomId} />
    </Notice>
  )
}

/** FR-043：已評論過。**顯示既有那一則，而不是一個必定失敗的表單。** */
function AlreadyReviewed({
  review,
  orderId,
  roomId,
}: {
  review: MyReview
  orderId: string
  roomId: string
}) {
  const pending = review.status === 'pending'
  return (
    <Notice title="這筆訂單已經評論過了" orderId={orderId}>
      <p className="text-body text-ink-muted">
        您在 {dates.formatTimestamp(review.createdAt)} 給了 {review.rating} 分（{review.category}）。
      </p>
      <blockquote className="mt-gap-3 border-l-2 border-line-strong pl-gap-4 text-body whitespace-pre-line text-ink">
        {review.comment}
      </blockquote>
      <p className="mt-gap-3 text-small text-ink-muted">
        {/*
          ⚠️ 三種狀態要分開講。統統說成「已送出」的話，被駁回的人會一直等一則
          永遠不會出現的評論。
        */}
        {pending
          ? '目前正在等待審核，通過後就會顯示在房源頁面上。'
          : review.status === 'approved'
            ? '這則評論已通過審核，顯示在房源頁面上。'
            : '這則評論未通過審核，因此不會顯示在房源頁面上。'}
      </p>
      <ExtraLinks orderId={orderId} roomId={roomId} />
    </Notice>
  )
}

function ExtraLinks({ orderId, roomId }: { orderId: string; roomId: string }) {
  return (
    <div className="mt-gap-5 flex flex-wrap gap-gap-3">
      <Link
        to={`/orders/${orderId}`}
        className={primaryButtonClass}
      >
        回到訂單詳情
      </Link>
      <Link
        to={`/rooms/${roomId}`}
        className="rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
      >
        查看房源
      </Link>
    </div>
  )
}

/**
 * 不顯示表單時的畫面。
 *
 * ⚠️ `role="status"` 而非 `alert`：這些都不是錯誤，是他還不知道的事實。
 * 用錯誤的樣式呈現會讓人以為自己做錯了什麼（同 `RefundForm.tsx`）。
 */
function Notice({
  title,
  orderId,
  tone = 'neutral',
  children,
}: {
  title: string
  orderId: string
  tone?: 'neutral' | 'ok'
  children: React.ReactNode
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
        className={[
          'mt-gap-4 rounded-lg border p-gap-6',
          tone === 'ok' ? 'border-ok/30 bg-ok-soft' : 'border-line-soft bg-surface-alt',
        ].join(' ')}
      >
        <h1 className="font-display text-h3 text-ink">{title}</h1>
        <div className="mt-gap-3">{children}</div>
      </section>
    </div>
  )
}
