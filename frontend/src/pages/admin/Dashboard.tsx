/**
 * T126：後台儀表板——營運總覽（FR-049）。
 *
 * ## 三件在這一頁上很容易做錯的事
 *
 * 1. **房態數字是「今天」的推導值，不是 `rooms.status` 的分組計數**（FR-015）。
 *    因此三個數字相加會等於房源總數，但「已預訂」明天就不一樣了——
 *    標題寫「今日房態」而不是「房態」，否則會被當成庫存表來讀。
 *
 * 2. **待處理的數字要能點過去。** 儀表板告訴管理員「有 3 則評論待審」之後，
 *    他下一步一定是去審它們。不給連結，他得自己在十二個模組裡找到「評論審核」
 *    ——每天都要找一次。
 *
 * 3. ⚠️ **賤賣預警來自模擬資料，MUST 標示**（FR-110）。儀表板上一個沒有標示的
 *    數字會被當成真實的市場情報，而管理員可能據此調價。標示不是免責聲明，
 *    是這個數字的一部分。
 */
import { Link } from 'react-router-dom'

import { api } from '../../api/client'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatTile } from '../../components/StatTile'
import { formatTWD } from '../../lib/money'
import { useAsync } from '../../lib/useAsync'
import { AdminPageHeader } from './AdminLayout'

export function Dashboard() {
  const stats = useAsync((signal) => api.admin.dashboard(signal), [])

  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />
  if (!stats.data) return <LoadingState label="載入營運總覽…" />

  const d = stats.data

  return (
    <div>
      <AdminPageHeader title="儀表板" description="今日營運概況與待處理事項。" />

      <section aria-labelledby="today" className="mb-gap-6">
        <h2 id="today" className="mb-gap-3 text-small text-ink-muted">
          今日
        </h2>
        <div className="grid gap-gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="今日入住" value={d.todayCheckIns} />
          <StatTile label="今日退房" value={d.todayCheckOuts} />
          <StatTile label="訂單總數" value={d.totalOrders} hint="全站累計" />
          <StatTile label="本月營收" value={formatTWD(d.monthRevenue)} hint="已付款訂單合計" />
        </div>
      </section>

      <section aria-labelledby="rooms" className="mb-gap-6">
        {/* 「今日」二字不可省：這三個數字明天就不同（FR-015） */}
        <h2 id="rooms" className="mb-gap-3 text-small text-ink-muted">
          今日房態
        </h2>
        <div className="grid gap-gap-4 sm:grid-cols-3">
          <StatTile label="空房" value={d.roomsAvailable} />
          <StatTile label="已預訂" value={d.roomsBooked} hint="依今日的有效訂單推導" />
          <StatTile label="整理中" value={d.roomsMaintenance} />
        </div>
      </section>

      <section aria-labelledby="pending">
        <h2 id="pending" className="mb-gap-3 text-small text-ink-muted">
          待處理
        </h2>
        <div className="grid gap-gap-4 sm:grid-cols-3">
          <PendingTile label="待審核評論" value={d.pendingReviews} to="/admin/reviews" />
          <PendingTile label="待審核退款" value={d.pendingRefunds} to="/admin/refunds" />
          <PendingTile
            label="未處理賤賣預警"
            value={d.pendingChannelAlerts}
            to="/admin/channel"
            // FR-110：這個數字來自模擬資料，標示與數字必須同時出現
            simulated
          />
        </div>
      </section>
    </div>
  )
}

/**
 * 可點擊的待處理磚。
 *
 * 整塊都是連結而不是只有一個「前往」小字：這是待辦清單的入口，目標區域越大
 * 越好按，在手機上尤其明顯。
 */
function PendingTile({
  label,
  value,
  to,
  simulated = false,
}: {
  label: string
  value: number
  to: string
  simulated?: boolean
}) {
  return (
    <Link
      to={to}
      className="rounded-lg transition-shadow hover:shadow-card focus-visible:shadow-card"
    >
      <StatTile
        label={label}
        value={value}
        tone="alert"
        hint={simulated ? '模擬資料：不連線至任何外部平台' : value === 0 ? '目前沒有待處理項目' : '點擊前往處理'}
      />
    </Link>
  )
}
