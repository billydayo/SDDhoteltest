/**
 * T089／T090／T093：三步驟訂房（FR-020、FR-021、FR-027 ~ FR-029、FR-083）。
 *
 * ## 三個步驟，往返不遺失（FR-020、FR-021）
 *
 * 填寫資訊 → 選擇付款方式 → 確認送出。三步的資料放在**同一份 state** 裡，
 * 切換步驟只換要顯示哪一段——因此「往返保留已填內容」不是靠額外的保存邏輯，
 * 而是根本沒有地方可以弄丟它。用三個獨立元件各持一份狀態的話，回上一步就
 * 重新掛載、內容歸零，而那個 bug 不會有任何錯誤訊息。
 *
 * ## ⚠️ 重整的行為必須可預期（FR-021）
 *
 * 規格允許兩種：回到該步驟並保留內容，或**明確回到起點並告知**。這裡選後者。
 *
 * 前者需要把使用者填的東西存到瀏覽器，而憲章原則 III 禁止業務資料進本機
 * 儲存，專案的 ESLint 也把 `localStorage`／`sessionStorage` 擋在 `api/client.ts`
 * 之外。與其為了草稿開一個例外，不如老實回到第一步——**但一定要說**。
 * 不說的話使用者會以為自己按錯了什麼，那正是規格說的「半殘狀態」。
 *
 * 日期從網址帶進來（房源頁導過來時附上），所以重整後至少那兩格還在。
 *
 * ## ⚠️ 畫面上 MUST NOT 有任何真實支付欄位（FR-028）
 *
 * 沒有卡號、沒有有效期限、沒有 CVV、沒有銀行帳號——**連「反正是假的」的
 * 示範欄位都不行**。一個長得像信用卡表單的東西，會有人把真的卡號打進去。
 * 這條由 `Booking.test.tsx` 掃描整棵 DOM 把關，而不是靠記得。
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { OrderCreateInput, PaymentMethod, Profile, RoomDetail } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingState } from '../components/LoadingState'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { inputClass, useFieldFocus } from '../lib/form'
import { paymentMethodLabel } from '../lib/labels'
import { formatTWD, previewTotal } from '../lib/money'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../state/AuthContext'
import { useStaleOrderSweep } from '../state/useStaleOrderSweep'

import type { OrderConfirmState } from './OrderConfirm'

const STEPS = ['填寫資訊', '選擇付款方式', '確認送出'] as const
type StepIndex = 0 | 1 | 2

/**
 * FR-027：三種**模擬**付款方式。⚠️ 三者皆不涉及任何真實金流。
 *
 * 顯示文字取自 `lib/labels.ts` 而非在此重寫——同一個 `credit-card` 在訂房流程
 * 與訂單列表上顯示成兩種說法時，使用者會以為那是兩件事。
 */
const PAYMENT_METHODS: { value: PaymentMethod; note: string }[] = [
  { value: 'LINE Pay', note: '模擬付款，不會開啟 LINE，也不會扣款。' },
  { value: 'credit-card', note: '模擬付款，不會要求卡號，也不會扣款。' },
  { value: 'bank-transfer', note: '模擬付款，不會提供匯款帳號。' },
]

interface Draft {
  checkIn: string
  checkOut: string
  guestCount: string
  contactName: string
  phone: string
  email: string
  paymentMethod: PaymentMethod | ''
}

/** 這一次載入是不是使用者按重新整理造成的。 */
function wasReloaded(): boolean {
  try {
    const [entry] = performance.getEntriesByType('navigation')
    return entry instanceof PerformanceNavigationTiming && entry.type === 'reload'
  } catch {
    // 舊瀏覽器沒有這個 API。判斷不出來就當作不是——寧可少說一句，
    // 也不要在使用者第一次進來時就告訴他「內容已清空」。
    return false
  }
}

/**
 * 外層只負責「把資料準備好」。表單本身在 `BookingFlow` 裡。
 *
 * ⚠️ **分成兩層是必要的，不是為了整齊。**
 *
 * 聯絡資訊要以登入者的資料預填，而預填只能發生在 `useState` 的初始值裡——
 * 用 effect 去同步的話，使用者改過的名字會在下一次重繪時被蓋掉。但初始值只
 * 在第一次繪製時算一次，而那時 `user` 可能還在載入中（`null`）。合成一層的
 * 結果就是三個聯絡欄位**永遠是空的**，而畫面上完全看不出哪裡壞了。
 *
 * 所以：資料齊了才掛載內層，並以 `key` 綁住身分（與 `Account` 同一個手法）。
 */
export function Booking() {
  const { roomId = '' } = useParams()
  const { status, user } = useAuth()

  const room = useAsync((signal) => api.rooms.get(roomId, undefined, signal), [roomId])

  /*
   * ⚠️ T093a 明訂：**訂房流程 MUST 抑制**逾期清理輪詢。
   *
   * 這裡刻意「掛上但關掉」，而不是不掛。日後有人把輪詢改成全域預設開啟時，
   * 這一行是這個頁面說出「我不要」的地方；完全不寫的話，那次改動會安靜地
   * 讓填到一半的表單被背景刷新洗掉。
   */
  useStaleOrderSweep({ enabled: false })

  if (room.error) return <ErrorState error={room.error} onRetry={room.reload} />
  if (!room.data || status === 'loading') return <LoadingState label="載入房源…" />

  return <BookingFlow key={user?.id ?? 'anonymous'} room={room.data} user={user} />
}

function BookingFlow({ room, user }: { room: RoomDetail; user: Profile | null }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const [step, setStep] = useState<StepIndex>(0)
  const [draft, setDraft] = useState<Draft>(() => ({
    // 日期從網址帶進來——重整後至少這兩格還在
    checkIn: params.get('checkIn') ?? dates.tomorrow(),
    checkOut: params.get('checkOut') ?? dates.addDays(dates.tomorrow(), 1),
    guestCount: '',
    contactName: user?.displayName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    paymentMethod: '',
  }))
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const formRef = useRef<HTMLFormElement>(null)
  const badField = useFieldFocus(formRef, error)

  // ⚠️ 只在第一次繪製時判定。之後 setState 造成的重繪不該再算成「剛重整」。
  const [reloadNotice] = useState(wasReloaded)

  const nights = dates.nightsBetween(draft.checkIn, draft.checkOut)
  const total = useMemo(() => previewTotal(room.nightlyPrice, nights), [room.nightlyPrice, nights])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      /*
       * ⚠️ 送出的內容裡**沒有 `nights` 也沒有 `totalAmount`**。
       *
       * 畫面上那兩個數字只是預覽；夜數與金額一律由後端依當下房價重算
       * （FR-024、FR-032）。把預覽值送出去，等於邀請人打開開發者工具改成
       * 一塊錢——後端當然會重算而不採信，但前端主動送過去這件事本身就是
       * 在說「這個值有意義」。
       */
      const input: OrderCreateInput = {
        roomId: room.id,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
        guestCount: Number(draft.guestCount),
        contactName: draft.contactName.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        paymentMethod: draft.paymentMethod as PaymentMethod,
      }
      const order = await api.orders.create(input)
      /*
       * `replace` 而非 push：訂單已經建立了，讓「上一頁」回到訂房表單只會誘使
       * 使用者再送一次，而第二次會撞上他自己剛佔走的房況。
       */
      await navigate(`/orders/${order.id}/confirmed`, {
        replace: true,
        state: { order, room } satisfies OrderConfirmState,
      })
    } catch (cause) {
      /*
       * FR-083：**MUST 保留使用者已填內容，MUST NOT 靜默失敗，
       * MUST NOT 改存本機後假裝成功。**
       *
       * 這裡只設錯誤、只把步驟退回到出問題的那一步。整份 `draft` 原封不動。
       *
       * 最常見的失敗是 409「此房源於所選日期已無空房」——那是在他填表的
       * 這幾分鐘裡被別人訂走了。這種時候把表單清空是最糟的處理：他得從頭
       * 再填一次，才能換一組日期試試看。
       */
      setError(cause)
      const field = (cause as { field?: string } | null)?.field
      // 付款方式以外的欄位問題都在第一步
      setStep(field === 'paymentMethod' ? 1 : 0)
    } finally {
      setBusy(false)
    }
  }

  const message = error ? messageFor(error) : null
  const fieldError = (name: string) => (badField === name ? (message?.detail ?? null) : null)

  const step0Ready =
    nights > 0 &&
    draft.guestCount !== '' &&
    draft.contactName.trim() !== '' &&
    draft.phone.trim() !== '' &&
    draft.email.trim() !== ''

  return (
    <div className="mx-auto max-w-3xl py-gap-6">
      <h1 className="font-display text-h1 text-ink">訂房</h1>
      <p className="mt-gap-1 text-ink-muted">{room.name}</p>

      {reloadNotice && step === 0 && (
        // ⚠️ FR-021：回到起點是允許的，**但一定要說**。不說的話使用者會
        // 以為自己按錯了什麼。
        <p
          role="status"
          className="mt-gap-4 rounded-xs bg-surface-alt px-gap-4 py-gap-3 text-small text-ink-muted"
        >
          重新整理後已回到第一步。除了日期之外，先前填寫的內容需要重新輸入。
        </p>
      )}

      <StepBar current={step} />

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 2) void submit()
        }}
        className="mt-gap-5"
      >
        {step === 0 && (
          <fieldset className="grid gap-gap-4">
            <legend className="sr-only">填寫資訊</legend>

            <div className="grid gap-gap-4 sm:grid-cols-2">
              <Field label="入住日" htmlFor="booking-checkIn" error={fieldError('checkIn')}>
                <input
                  id="booking-checkIn"
                  name="checkIn"
                  type="date"
                  // 訂房需提前一天（FR-022）。這裡只是輸入輔助，判定在後端。
                  min={dates.tomorrow()}
                  required
                  value={draft.checkIn}
                  onChange={(e) => {
                    set('checkIn', e.target.value)
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="退房日" htmlFor="booking-checkOut" error={fieldError('checkOut')}>
                <input
                  id="booking-checkOut"
                  name="checkOut"
                  type="date"
                  min={dates.addDays(draft.checkIn, 1)}
                  required
                  value={draft.checkOut}
                  onChange={(e) => {
                    set('checkOut', e.target.value)
                  }}
                  className={inputClass}
                />
              </Field>
            </div>

            {nights <= 0 && (
              <p role="alert" className="text-small text-danger">
                退房日必須晚於入住日。
              </p>
            )}

            <Field
              label="入住人數"
              htmlFor="booking-guestCount"
              error={fieldError('guestCount')}
              hint={`此房源最多 ${String(room.maxGuests)} 人。`}
            >
              <input
                id="booking-guestCount"
                name="guestCount"
                type="number"
                min={1}
                // ⚠️ `max` 只是輸入輔助。人數上限的**判定在後端**（FR-024）——
                // 這個屬性用開發者工具兩秒就能改掉。
                max={room.maxGuests}
                required
                inputMode="numeric"
                value={draft.guestCount}
                onChange={(e) => {
                  set('guestCount', e.target.value)
                }}
                className={inputClass}
              />
            </Field>

            <Field label="聯絡姓名" htmlFor="booking-contactName" error={fieldError('contactName')}>
              <input
                id="booking-contactName"
                name="contactName"
                type="text"
                autoComplete="name"
                required
                maxLength={100}
                value={draft.contactName}
                onChange={(e) => {
                  set('contactName', e.target.value)
                }}
                className={inputClass}
              />
            </Field>

            <div className="grid gap-gap-4 sm:grid-cols-2">
              <Field label="聯絡電話" htmlFor="booking-phone" error={fieldError('phone')}>
                <input
                  id="booking-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={50}
                  value={draft.phone}
                  onChange={(e) => {
                    set('phone', e.target.value)
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="電子郵件" htmlFor="booking-email" error={fieldError('email')}>
                <input
                  id="booking-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={draft.email}
                  onChange={(e) => {
                    set('email', e.target.value)
                  }}
                  className={inputClass}
                />
              </Field>
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <PaymentStep
            value={draft.paymentMethod}
            onChange={(v) => {
              set('paymentMethod', v)
            }}
            error={fieldError('paymentMethod')}
          />
        )}

        {step === 2 && (
          <ConfirmStep
            room={room}
            draft={draft}
            nights={nights}
            total={total}
            onEdit={(target) => {
              setStep(target)
            }}
          />
        )}

        {/* 對不上任何欄位的錯誤（連線失敗、409 房況衝突）也 MUST 說出來 */}
        {message && !badField && (
          <p
            role="alert"
            className="mt-gap-4 rounded-xs bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
          >
            {message.detail}
          </p>
        )}

        <div className="mt-gap-6 flex items-center justify-between gap-gap-3">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => {
              setError(null)
              setStep((s) => (s - 1) as StepIndex)
            }}
            className="rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong disabled:invisible"
          >
            上一步
          </button>

          {step < 2 ? (
            <button
              type="button"
              disabled={step === 0 ? !step0Ready : draft.paymentMethod === ''}
              onClick={() => {
                setError(null)
                setStep((s) => (s + 1) as StepIndex)
              }}
              className="rounded-pill bg-brand px-gap-6 py-gap-2 text-ink-invert transition-colors hover:bg-brand-strong disabled:bg-line-strong"
            >
              下一步
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy}
              className="rounded-pill bg-brand px-gap-6 py-gap-2 text-ink-invert transition-colors hover:bg-brand-strong disabled:bg-line-strong"
            >
              {busy ? '送出中…' : '確認送出'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
function StepBar({ current }: { current: StepIndex }) {
  return (
    <ol className="mt-gap-5 flex flex-wrap items-center gap-gap-3">
      {STEPS.map((label, i) => {
        const state = i === current ? 'current' : i < current ? 'done' : 'todo'
        return (
          <li key={label} className="flex items-center gap-gap-2">
            <span
              // 目前這一步對讀屏使用者也要說得出來，不能只靠顏色（憲章原則 V）
              aria-current={state === 'current' ? 'step' : undefined}
              className={[
                'flex items-center gap-gap-2 rounded-pill px-gap-3 py-gap-1 text-small',
                state === 'current'
                  ? 'bg-brand text-ink-invert'
                  : state === 'done'
                    ? 'bg-brand-soft text-ink'
                    : 'bg-surface-alt text-ink-muted',
              ].join(' ')}
            >
              <span aria-hidden="true">{i + 1}</span>
              {label}
              {state === 'done' && <span className="sr-only">（已完成）</span>}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="text-ink-muted">
                ›
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * T090：付款方式（FR-027、FR-028、FR-029）。
 *
 * ⚠️ **這一段裡沒有任何輸入框，而且不能有。** 沒有卡號、沒有有效期限、
 * 沒有 CVV、沒有銀行帳號——連「反正是假的」的示範欄位都不行。一個長得像
 * 信用卡表單的東西，會有人把真的卡號打進去。
 */
function PaymentStep({
  value,
  onChange,
  error,
}: {
  value: PaymentMethod | ''
  onChange: (value: PaymentMethod) => void
  error: string | null
}) {
  return (
    <fieldset className="grid gap-gap-3">
      <legend className="font-display text-h3 text-ink">選擇付款方式</legend>

      {/* FR-029：**明顯**標示。放在選項之前，而不是頁尾一行小字 */}
      <p className="rounded-lg border border-warn/30 bg-warn-soft p-gap-4 text-ink">
        <strong className="font-semibold">虛擬支付，不會產生任何實際交易。</strong>
        <span className="mt-gap-1 block text-small">
          本站不會要求、不會接收、也不會儲存任何真實的支付資料——包含信用卡號、有效期限、
          安全碼與銀行帳號。任何要求你輸入這些資料的畫面都不屬於本站。
        </span>
      </p>

      <div className="grid gap-gap-2">
        {PAYMENT_METHODS.map((method) => (
          <label
            key={method.value}
            className={[
              'flex cursor-pointer items-start gap-gap-3 rounded-lg border p-gap-4 transition-colors',
              value === method.value
                ? 'border-brand bg-brand-soft'
                : 'border-line-strong hover:border-brand',
            ].join(' ')}
          >
            <input
              type="radio"
              name="paymentMethod"
              value={method.value}
              checked={value === method.value}
              onChange={() => {
                onChange(method.value)
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-ink">{paymentMethodLabel(method.value)}</span>
              <span className="mt-gap-1 block text-small text-ink-muted">{method.note}</span>
            </span>
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function ConfirmStep({
  room,
  draft,
  nights,
  total,
  onEdit,
}: {
  room: RoomDetail
  draft: Draft
  nights: number
  total: number
  onEdit: (step: StepIndex) => void
}) {
  const methodLabel =
    draft.paymentMethod === '' ? '—' : paymentMethodLabel(draft.paymentMethod)

  return (
    <section className="grid gap-gap-4">
      <h2 className="font-display text-h3 text-ink">確認訂房內容</h2>

      <dl className="grid gap-gap-3 rounded-lg border border-line-soft bg-surface-alt p-gap-5 sm:grid-cols-2">
        <Row label="房源" value={room.name} />
        <Row label="住宿期間" value={dates.formatStay(draft.checkIn, draft.checkOut)} />
        <Row label="夜數" value={`${String(nights)} 晚`} />
        <Row label="入住人數" value={`${draft.guestCount} 人`} />
        <Row label="聯絡姓名" value={draft.contactName} />
        <Row label="聯絡電話" value={draft.phone} />
        <Row label="電子郵件" value={draft.email} />
        <Row label="付款方式" value={methodLabel} />
      </dl>

      <p className="flex items-baseline justify-between rounded-lg bg-brand-soft p-gap-5">
        <span className="text-ink">預估總金額</span>
        <span className="font-display text-h2 text-ink">{formatTWD(total)}</span>
      </p>
      {/*
        ⚠️ 說明白這是**預估**。實際金額由後端依當下房價重算並凍結在訂單上
        （FR-032）。不說的話，萬一房價剛好在這幾分鐘內被調整，使用者會覺得
        自己被多收了錢。
      */}
      <p className="text-small text-ink-muted">
        實際金額於訂單成立時由伺服器依當下房價計算並凍結，日後房價調整不會改變已成立的訂單。
      </p>

      <div className="flex flex-wrap gap-gap-3">
        <button
          type="button"
          onClick={() => {
            onEdit(0)
          }}
          className="text-small text-brand-strong underline underline-offset-4"
        >
          修改訂房資訊
        </button>
        <button
          type="button"
          onClick={() => {
            onEdit(1)
          }}
          className="text-small text-brand-strong underline underline-offset-4"
        >
          修改付款方式
        </button>
      </div>
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
