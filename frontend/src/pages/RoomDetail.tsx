/**
 * T057／T058／T061：房源詳情（FR-014、FR-017、FR-019）。
 *
 * ## 三條具體規則
 *
 * 1. **僅一張照片時 MUST NOT 顯示單格縮圖列**（T057）。一整排只有一格的縮圖
 *    看起來像是其他照片載入失敗。
 *
 * 2. **尚未檢測時顯示「尚未檢測」，MUST NOT 顯示 0 分或空白區塊**（FR-014、T058）。
 *    0 分會被讀成「檢測結果極差」；空白區塊會被讀成壞掉。
 *
 * 3. **未登入點「立即訂房」導向登入頁並提示需先登入**（FR-019、T061）。
 *    MUST 記住原本要去的地方，登入後回得來——否則使用者得自己找回這間房。
 *
 * ## 已公開評論（FR-017 的一部分）尚未實作
 *
 * ⚠️ 需要 **T110** 的公開評論端點（US5 後端），目前後端沒有任何非後台的
 * reviews 路徑。此處刻意留一段明確的說明，**MUST NOT 以假資料或空白區塊
 * 冒充**（FR-084 的同一個原則）。
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { Availability, RiskCheck } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { Rating } from '../components/Rating'
import * as dates from '../lib/dates'
import { formatTWD, previewTotal } from '../lib/money'
import { useAsync } from '../lib/useAsync'
import type { LoginRedirectState } from '../router'
import { useAuth } from '../state/AuthContext'

const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: '可預訂',
  booked: '已預訂',
  maintenance: '整理中',
  unknown: '無法確認',
}

const AVAILABILITY_CLASS: Record<Availability, string> = {
  available: 'bg-ok-soft text-ok',
  booked: 'bg-warn-soft text-warn',
  maintenance: 'bg-warn-soft text-warn',
  unknown: 'bg-surface-alt text-ink-muted',
}

export function RoomDetail() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // 使用者在此頁選的日期。僅用於試算與查詢當日房態，不會送出訂單。
  const [checkIn, setCheckIn] = useState(dates.tomorrow())
  const [checkOut, setCheckOut] = useState(dates.addDays(dates.tomorrow(), 1))
  const [activeImage, setActiveImage] = useState(0)

  const room = useAsync((signal) => api.rooms.get(roomId, checkIn, signal), [roomId, checkIn])

  if (room.error) return <ErrorState error={room.error} onRetry={room.reload} />
  if (!room.data) return <LoadingState label="載入房源…" />

  const data = room.data
  const nights = dates.nightsBetween(checkIn, checkOut)
  const validRange = nights > 0
  const total = previewTotal(data.nightlyPrice, nights)

  function handleBook() {
    if (!user) {
      /*
       * FR-019：導向登入頁**並提示需先登入**。
       *
       * ⚠️ 提示不能寫在這裡。導向的那一刻本頁就卸載了，任何在此
       * `setState` 顯示的一句話都沒有機會被繪製出來——那是看起來有做、
       * 實際上永遠不會出現的死程式碼。理由跟著 location state 送過去，
       * 由登入頁的 `LoginReasonNotice` 渲染。
       *
       * `from` 一併帶上，登入完才回得到這間房（FR-009d）。
       */
      void navigate('/login', {
        state: {
          from: { pathname: `/rooms/${roomId}` },
          reason: 'BOOKING_REQUIRES_LOGIN',
        } satisfies LoginRedirectState,
      })
      return
    }
    void navigate(`/booking/${roomId}?checkIn=${checkIn}&checkOut=${checkOut}`)
  }

  return (
    <article className="flex flex-col gap-gap-6">
      <nav aria-label="麵包屑" className="text-small text-ink-muted">
        <Link to="/" className="underline underline-offset-4 hover:text-brand-strong">
          房源
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{data.name}</span>
      </nav>

      <Gallery images={data.images} name={data.name} active={activeImage} onSelect={setActiveImage} />

      <div className="grid gap-gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-gap-5">
          <header className="flex flex-wrap items-start justify-between gap-gap-3">
            <div>
              <h1 className="font-display text-h1 text-ink">{data.name}</h1>
              <p className="mt-gap-1 text-ink-muted">
                {data.type} · 最多 {data.maxGuests} 人
              </p>
            </div>
            <Rating value={data.averageRating} className="text-md" />
          </header>

          {data.description && (
            <section>
              <h2 className="font-display text-h3 text-ink">房源介紹</h2>
              <p className="mt-gap-2 max-w-(--container-measure) whitespace-pre-line text-ink-muted">
                {data.description}
              </p>
            </section>
          )}

          <TagSection title="設施" items={data.amenities} />
          <TagSection title="房型特色" items={data.features} />

          <RiskSection check={data.latestRiskCheck} />

          <section>
            <h2 className="font-display text-h3 text-ink">住客評論</h2>
            {/*
              ⚠️ 公開評論端點（T110）尚未實作。明講而不是留白或塞假評論——
              空白區塊會被讀成壞掉，假評論則是拿不存在的資訊誤導使用者。
            */}
            <p className="mt-gap-2 text-ink-muted">評論功能即將開放。</p>
          </section>
        </div>

        {/* 訂房側欄 */}
        <aside className="h-fit rounded-lg border border-line-soft bg-surface p-gap-5 shadow-soft lg:sticky lg:top-24">
          <p className="text-ink">
            <span className="font-display text-h2">{formatTWD(data.nightlyPrice)}</span>
            <span className="text-small text-ink-muted"> / 晚</span>
          </p>

          <p className="mt-gap-3">
            <span
              className={`inline-block rounded-pill px-gap-3 py-gap-1 text-small ${AVAILABILITY_CLASS[data.availability]}`}
            >
              {dates.formatDisplayDate(checkIn)}：{AVAILABILITY_LABEL[data.availability]}
            </span>
          </p>

          <div className="mt-gap-4 grid gap-gap-3">
            <div>
              <label htmlFor="detail-checkIn" className="mb-gap-1 block text-small text-ink-muted">
                入住日
              </label>
              <input
                id="detail-checkIn"
                name="checkIn"
                type="date"
                min={dates.tomorrow()}
                value={checkIn}
                onChange={(e) => {
                  setCheckIn(e.target.value)
                }}
                className="w-full rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-body text-ink"
              />
            </div>
            <div>
              <label htmlFor="detail-checkOut" className="mb-gap-1 block text-small text-ink-muted">
                退房日
              </label>
              <input
                id="detail-checkOut"
                name="checkOut"
                type="date"
                min={dates.addDays(checkIn, 1)}
                value={checkOut}
                onChange={(e) => {
                  setCheckOut(e.target.value)
                }}
                className="w-full rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-body text-ink"
              />
            </div>
          </div>

          {/* 依所選日期的夜數與總金額（FR-017）。**這是試算**——實際金額由後端重算 */}
          <dl className="mt-gap-4 space-y-gap-1 border-t border-line-soft pt-gap-3 text-small">
            <div className="flex justify-between">
              <dt className="text-ink-muted">夜數</dt>
              <dd className="text-ink">{validRange ? `${String(nights)} 晚` : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">總金額</dt>
              <dd className="font-display text-md text-ink">{validRange ? formatTWD(total) : '—'}</dd>
            </div>
          </dl>

          {!validRange && (
            <p role="alert" className="mt-gap-2 text-small text-danger">
              退房日必須晚於入住日。
            </p>
          )}

          <button
            type="button"
            onClick={handleBook}
            disabled={!validRange || data.status === 'maintenance'}
            className="mt-gap-4 w-full rounded-pill bg-brand px-gap-5 py-gap-2 text-ink-invert transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line-strong"
          >
            立即訂房
          </button>

          {data.status === 'maintenance' && (
            <p className="mt-gap-2 text-small text-warn">此房源整理中，暫時無法預訂。</p>
          )}

          <p className="mt-gap-3 text-tiny text-ink-muted">
            付款為模擬，不會產生任何實際交易。
          </p>
        </aside>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
function Gallery({
  images,
  name,
  active,
  onSelect,
}: {
  images: string[]
  name: string
  active: number
  onSelect: (index: number) => void
}) {
  if (images.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg bg-surface-alt text-ink-muted">
        尚無照片
      </div>
    )
  }

  const current = images[Math.min(active, images.length - 1)] ?? images[0]

  return (
    <div>
      <img
        src={current}
        alt={name}
        className="arch h-[50vh] min-h-72 w-full bg-surface-alt object-cover"
      />

      {/*
        ⚠️ **僅一張時 MUST NOT 顯示縮圖列**（T057）。
        一整排只有一格的縮圖，看起來像是其他照片載入失敗。
      */}
      {images.length > 1 && (
        <div className="mt-gap-3 flex gap-gap-2 overflow-x-auto pb-gap-1">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`檢視第 ${String(i + 1)} 張照片`}
              aria-current={i === active}
              onClick={() => {
                onSelect(i)
              }}
              className={[
                'size-20 shrink-0 overflow-hidden rounded-xs border-2 transition-colors',
                i === active ? 'border-brand' : 'border-transparent hover:border-line-strong',
              ].join(' ')}
            >
              <img src={src} alt="" aria-hidden="true" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TagSection({ title, items }: { title: string; items: string[] }) {
  // 空清單整段不渲染——留一個標題底下什麼都沒有，看起來就是壞了
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="font-display text-h3 text-ink">{title}</h2>
      <ul className="mt-gap-2 flex flex-wrap gap-gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-pill bg-surface-alt px-gap-3 py-gap-1 text-small text-ink-muted"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * T058：最新一次房源品質檢測（FR-014）。
 *
 * ⚠️ **尚未檢測時 MUST 顯示「尚未檢測」**，MUST NOT 顯示 0 分或空白區塊。
 * 0 分會被讀成「檢測結果極差」——而實際上是還沒檢測過。
 */
function RiskSection({ check }: { check: RiskCheck | null }) {
  return (
    <section>
      <h2 className="font-display text-h3 text-ink">房源品質檢測</h2>
      {check === null ? (
        <p className="mt-gap-2 text-ink-muted">尚未檢測</p>
      ) : (
        <dl className="mt-gap-2 grid grid-cols-2 gap-gap-3 sm:grid-cols-4">
          <Metric label="風險評分" value={String(check.riskScore)} />
          <Metric label="風險等級" value={check.riskLevel} />
          <Metric label="亮度" value={String(check.brightness)} />
          <Metric label="整潔度" value={String(check.clutter)} />
        </dl>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xs bg-surface-alt p-gap-3">
      <dt className="text-tiny text-ink-muted">{label}</dt>
      <dd className="mt-gap-1 font-display text-md text-ink">{value}</dd>
    </div>
  )
}
