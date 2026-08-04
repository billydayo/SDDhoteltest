/**
 * T126：營運總覽（FR-049）。
 *
 * ## 三個房態是「今天」的，不是房源的欄位
 *
 * `roomsAvailable` / `roomsBooked` / `roomsMaintenance` 由**當日的訂單推導**，
 * 不是 `rooms.status` 的分組計數（FR-015）。畫面上必須說出「今日」兩個字：
 * 業者看到「已預訂 3」時若以為那是永久狀態，就會去找那三間房為什麼被鎖住。
 *
 * ## 待處理數字是入口，不是裝飾
 *
 * 「待審核評論 5」如果不能點，業者得自己走到評論審核頁再找一次。
 * 每一個待辦數字都連到能處理它的地方。
 *
 * ## 賤賣預警的數字帶著模擬標示
 *
 * `pendingChannelAlerts` 來自不連線任何外部平台的模擬資料（FR-110）。
 * 一個沒有標示的預警數字會被當成真實的市場情報，而那正是 SC-021 要防的事。
 */
import { useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../../api/client'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { SimulatedBadge } from '../../components/SimulatedBadge'
import { useAsync } from '../../hooks/useAsync'
import { formatTWD } from '../../lib/money'
import { panelClass } from '../../lib/surfaces'

interface StatProps {
  label: string
  value: string
  hint?: string
  to?: string
  /** 待處理且不為 0 時強調。0 件不該被畫成需要注意的樣子。 */
  attention?: boolean
  badge?: ReactNode
}

function Stat({ label, value, hint, to, attention = false, badge }: StatProps) {
  const body = (
    <>
      <p className="flex items-center gap-gap-2 text-small text-ink-muted">
        {label}
        {badge}
      </p>
      <p
        className={[
          'mt-gap-1 font-display text-h1 tabular-nums',
          attention ? 'text-warn' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </p>
      {hint && <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>}
    </>
  )

  const shell = `${panelClass} p-gap-4`

  // 可點的卡片做成真的 `a`（`Link`），不是加了 `onClick` 的 `div`——後者對
  // 鍵盤與讀屏使用者等同於不存在（憲章原則 V、T171）。
  return to ? (
    <Link
      to={to}
      className={`${shell} block transition-colors hover:border-brand hover:bg-brand-soft/40`}
    >
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-gap-6 first:mt-0">
      <h3 className="text-md text-ink">{title}</h3>
      <div className="mt-gap-3 grid gap-gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

export function Dashboard() {
  const load = useCallback((signal: AbortSignal) => api.admin.dashboard(signal), [])
  const { status, data, error, reload } = useAsync(load)

  if (status === 'error') return <ErrorState error={error} onRetry={reload} />
  if (!data) return <LoadingState label="載入營運總覽…" />

  return (
    <div>
      <h2 className="font-display text-h2 text-ink">營運總覽</h2>

      <Section title="今日">
        <Stat label="今日入住" value={String(data.todayCheckIns)} hint="以入住日計" />
        <Stat label="今日退房" value={String(data.todayCheckOuts)} hint="以退房日計" />
        <Stat
          label="本月營收"
          value={formatTWD(data.monthRevenue)}
          hint="已付款訂單，整數新臺幣元"
        />
      </Section>

      {/* ⚠️ 三個數字都是**今日**的推導結果（FR-015）。少了「今日」兩個字，
          業者會把「已預訂」讀成房源本身的一種狀態。 */}
      <Section title="今日房態">
        <Stat label="今日可訂" value={String(data.roomsAvailable)} hint="今日無訂單且非維護中" />
        <Stat label="今日已預訂" value={String(data.roomsBooked)} hint="今日有生效中的訂單" />
        <Stat
          label="維護中"
          value={String(data.roomsMaintenance)}
          hint="不分日期的營運狀態，不開放預訂"
        />
      </Section>

      <Section title="待處理">
        <Stat
          label="待審核評論"
          value={String(data.pendingReviews)}
          to="/admin/reviews"
          attention={data.pendingReviews > 0}
          hint="點擊前往評論審核"
        />
        <Stat
          label="待審核退款"
          value={String(data.pendingRefunds)}
          to="/admin/refunds"
          attention={data.pendingRefunds > 0}
          hint="點擊前往退款審核"
        />
        <Stat
          label="未處理賤賣預警"
          value={String(data.pendingChannelAlerts)}
          to="/admin/channel-prices"
          attention={data.pendingChannelAlerts > 0}
          hint="點擊前往渠道比價"
          badge={<SimulatedBadge variant="inline" />}
        />
      </Section>

      <Section title="累計">
        <Stat label="訂單總數" value={String(data.totalOrders)} hint="含各種狀態" />
      </Section>

      <p className="mt-gap-6 text-tiny text-ink-muted">
        ⚠️ 本站為展示用途，付款與退款皆為模擬，不涉及任何真實金流。
      </p>
    </div>
  )
}
