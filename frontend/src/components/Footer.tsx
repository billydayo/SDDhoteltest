/**
 * T041：頁尾。
 *
 * ⚠️ **服務條款連結 MUST 在此**（FR-121、FR-122）：本站為展示用專案，
 * 不提供真實住宿服務、不產生真實交易。這句話必須在每一頁都找得到——
 * 只放在條款頁裡，等於只有已經知道的人才看得到。
 */
import { Link } from 'react-router-dom'

import { shellClass } from '../lib/surfaces'

export function Footer() {
  return (
    <footer className="mt-gap-8 border-t border-line-soft bg-surface-alt">
      <div
        className={`flex flex-col gap-gap-3 py-gap-6 text-small text-ink-muted sm:flex-row sm:items-center sm:justify-between ${shellClass}`}
      >
        <div className="flex items-center gap-gap-3">
          <img src="/logo.png" alt="Sunny 訂房平台" className="h-6 w-auto" />
        </div>

        <p className="max-w-prose">
          本站為展示用專案，<strong className="font-semibold text-ink">不提供真實住宿服務</strong>
          ，所有付款與退款皆為模擬，<strong className="font-semibold text-ink">不會產生任何實際交易</strong>。
        </p>

        <nav aria-label="頁尾導覽" className="flex items-center gap-gap-4">
          <Link to="/terms" className="underline underline-offset-4 hover:text-brand-strong">
            服務條款與隱私聲明
          </Link>
        </nav>
      </div>
    </footer>
  )
}
