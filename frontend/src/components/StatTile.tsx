/**
 * 後台的單一數值磚。儀表板（T126）與訂單指標（T128）共用。
 *
 * ## 為什麼 `value` 可以是 `null`
 *
 * ⚠️ **「還沒有資料」與「數值為 0」是不同的事，MUST NOT 混為一談。**
 *
 * 成交率與平均客單價在系統無訂單時，後端回的是 `null`（T117 的驗收條件）。
 * 把它顯示成 `0%` 會被讀成「一筆都沒成交」——那是營運警訊；而實際狀況是
 * 還沒有人下過單，那是新站台的正常狀態。兩者會導向完全相反的決策。
 *
 * 因此 `null` 一律渲染為「—」，並在 `hint` 說明原因。
 */
import type { ReactNode } from 'react'

export function StatTile({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string
  /** `null` 代表尚無資料，顯示為「—」。 */
  value: ReactNode | null
  hint?: string
  /** `alert` 用於「待處理」類的數字：有值時需要被看見。 */
  tone?: 'plain' | 'alert'
}) {
  const isEmpty = value === null || value === undefined
  const highlight = tone === 'alert' && !isEmpty && value !== 0

  return (
    <div className="rounded-lg border border-line-soft bg-surface p-gap-4 shadow-soft">
      <p className="text-small text-ink-muted">{label}</p>
      <p
        className={[
          'mt-gap-1 font-display text-h2',
          isEmpty ? 'text-ink-muted' : highlight ? 'text-brand-strong' : 'text-ink',
        ].join(' ')}
      >
        {isEmpty ? '—' : value}
      </p>
      {hint && <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>}
    </div>
  )
}
