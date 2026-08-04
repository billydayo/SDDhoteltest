/**
 * T091：訂單確認頁（FR-030、FR-031、FR-102）。
 *
 * ## 資料從哪裡來
 *
 * 訂單物件由 `Booking` 在導覽時以 location state 交過來。**目前沒有
 * `GET /orders/{id}`**——那是 T098（US4）。因此這一頁在重新整理或直接貼網址
 * 進來時拿不到內容。
 *
 * ⚠️ 那種情況下 MUST NOT 呈現半殘畫面（FR-021 的同一個道理）：不能顯示一頁
 * 空白的欄位，也不能讓人以為訂單沒建立成功。這裡明講「訂單已成立」並指往
 * 我的訂單——**訂單編號是使用者手上唯一的憑據，畫面上找不到它時，那句
 * 「已成立」必須說得毫不含糊**，否則他會回頭再訂一次，然後撞上房況衝突。
 *
 * ## 為什麼付款按鈕在這裡
 *
 * 建單後的 60 分鐘是使用者最可能立刻付款的時候。把付款入口只放在「我的訂單」
 * 裡，等於要求剛訂完房的人自己去別的頁面找它。列表上的入口是 FR-035b 另外
 * 要求的（T101），兩者不衝突。
 */
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { Order, RoomDetail } from '../api/types'
import { PaymentCountdown } from '../components/PaymentCountdown'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { orderStatusLabel, paymentMethodLabel } from '../lib/labels'
import { formatTWD } from '../lib/money'

/** `Booking` 送過來的內容。房源一併帶著，才不必為了一個名字再查一次。 */
export interface OrderConfirmState {
  order: Order
  room: Pick<RoomDetail, 'id' | 'name' | 'type'>
}

export function OrderConfirm() {
  const { orderId = '' } = useParams()
  const location = useLocation()
  const incoming = location.state as OrderConfirmState | null

  // 付款會換回一筆新的訂單（狀態已變）。放進 state 才能就地更新，
  // 而不必重新導覽一次。
  const [order, setOrder] = useState<Order | null>(incoming?.order ?? null)
  const [error, setError] = useState<unknown>(null)
  const [paying, setPaying] = useState(false)
  const [expiredWhileWatching, setExpiredWhileWatching] = useState(false)

  if (!order) return <MissingState orderId={orderId} />

  const room = incoming?.room ?? null
  const pending = order.status === 'pending-payment'
  /*
   * ⚠️ 兩種到期都要算進來。
   *
   * `onExpire` 只在**倒數跑到 0 的那一刻**觸發；直接打開一個早就過期的訂單時
   * 它永遠不會被呼叫。少了 `secondsUntil` 這一半，畫面會一邊說「付款時間已過」
   * 一邊讓付款按鈕維持可按——按下去只換來一個 409。
   */
  const expired = expiredWhileWatching || dates.secondsUntil(order.expiresAt) <= 0

  async function pay(current: Order) {
    setPaying(true)
    setError(null)
    try {
      setOrder(await api.orders.pay(current.id))
    } catch (cause) {
      /*
       * ⚠️ 失敗 MUST NOT 被吞掉，也 MUST NOT 在前端自行把訂單畫成已付款。
       *
       * 最要緊的一種失敗是 409 `ORDER_EXPIRED`——後端會說「所選日期可能已被
       * 其他人預訂」。那句話必須原樣傳達；自己改寫成「付款失敗請重試」會讓
       * 使用者一直按同一顆按鈕。
       */
      setError(cause)
    } finally {
      setPaying(false)
    }
  }

  const message = error ? messageFor(error) : null

  return (
    <div className="mx-auto max-w-2xl py-gap-6">
      <header className="text-center">
        <p className="text-small text-ok">{pending ? '訂單已成立' : '訂單已確認'}</p>
        <h1 className="mt-gap-2 font-display text-h1 text-ink">
          {pending ? '請於期限內完成付款' : '感謝您的預訂'}
        </h1>
        {/*
          FR-030：訂單編號對使用者可見。放在最顯眼的位置，因為它是他日後
          查詢與聯繫時唯一報得出來的東西。
        */}
        <p className="mt-gap-3 text-small text-ink-muted">訂單編號</p>
        <p className="font-display text-h2 tracking-wide text-ink select-all">{order.orderNo}</p>
      </header>

      {pending && (
        <div className="mt-gap-5 rounded-lg border border-line-soft bg-surface-alt p-gap-5 text-center">
          <PaymentCountdown
            expiresAt={order.expiresAt}
            onExpire={() => {
              // 只記下「已歸零」，**不改訂單狀態**——真正的取消由後端在下一次
              // 查詢時執行（FR-099）。前端擅自改寫，使用者重整後又會看到待付款。
              setExpiredWhileWatching(true)
            }}
          />
          <p className="mt-gap-2 text-tiny text-ink-muted">
            逾期未付款的訂單將自動取消，該日期區間會重新開放給其他人預訂。
          </p>
        </div>
      )}

      {/* FR-031 的七項。⚠️ 少任何一項都是這一條沒做完 */}
      <dl className="mt-gap-5 grid gap-gap-4 rounded-lg border border-line-soft bg-surface p-gap-5 sm:grid-cols-2">
        <Row label="房源" value={room?.name ?? '—'} />
        <Row label="住宿期間" value={dates.formatStay(order.checkIn, order.checkOut)} />
        <Row label="夜數" value={`${String(order.nights)} 晚`} />
        <Row label="入住人數" value={`${String(order.guestCount)} 人`} />
        <Row label="付款方式" value={paymentMethodLabel(order.paymentMethod)} />
        <Row label="訂單狀態" value={orderStatusLabel(order.status)} />
        <Row label="聯絡人" value={`${order.contactName}／${order.phone}`} />
        <Row label="電子郵件" value={order.email} />
      </dl>

      <p className="mt-gap-4 flex items-baseline justify-between rounded-lg bg-brand-soft p-gap-5">
        <span className="text-ink">總金額</span>
        {/*
          ⚠️ 這是後端凍結在訂單上的金額（FR-032），不是前端算的預覽值。
          房價日後調整不會改變它。
        */}
        <span className="font-display text-h2 text-ink">{formatTWD(order.totalAmount)}</span>
      </p>

      {message && (
        <p
          role="alert"
          className="mt-gap-4 rounded-xs bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
        >
          {message.detail}
        </p>
      )}

      <div className="mt-gap-6 flex flex-wrap items-center justify-center gap-gap-4">
        {pending && (
          <button
            type="button"
            disabled={paying || expired}
            onClick={() => {
              void pay(order)
            }}
            className="rounded-pill bg-brand px-gap-6 py-gap-3 text-ink-invert transition-colors hover:bg-brand-strong disabled:bg-line-strong"
          >
            {/*
              ⚠️ FR-028／FR-029：按下去不會要求任何真實支付資料。
              按鈕上就說清楚，使用者才不會擔心自己要掏卡。
            */}
            {paying ? '處理中…' : '完成模擬付款'}
          </button>
        )}
        <Link
          to="/orders"
          className="rounded-pill border border-line-strong px-gap-5 py-gap-3 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          查看我的訂單
        </Link>
      </div>

      {pending && (
        <p className="mt-gap-4 text-center text-tiny text-ink-muted">
          此為模擬支付，不會產生任何實際交易，也不會向您收取任何費用。
        </p>
      )}
    </div>
  )
}

/**
 * 重新整理或直接開網址時的畫面。
 *
 * ⚠️ 這裡**不能**顯示成錯誤。訂單真的建立成功了——顯示一個紅色的失敗畫面
 * 會讓使用者以為要重訂，而重訂會撞上他自己那筆訂單造成的房況衝突。
 */
function MissingState({ orderId }: { orderId: string }) {
  return (
    <div
      role="status"
      className="mx-auto max-w-md rounded-lg border border-line-soft bg-surface-alt p-gap-6 text-center"
    >
      <h1 className="font-display text-h3 text-ink">訂單已成立</h1>
      <p className="mt-gap-3 text-body text-ink-muted">
        重新整理後，這一頁無法再取回剛才的明細。您的訂單並未受影響，請至「我的訂單」查看完整內容與付款期限。
      </p>
      {orderId && <p className="mt-gap-3 text-tiny text-ink-muted">訂單識別碼 {orderId}</p>}
      <Link
        to="/orders"
        className="mt-gap-5 inline-block rounded-pill bg-brand px-gap-6 py-gap-2 text-ink-invert transition-colors hover:bg-brand-strong"
      >
        前往我的訂單
      </Link>
    </div>
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
