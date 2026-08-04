import type { ReactNode } from 'react'

/**
 * T060：空狀態。
 *
 * ⚠️ **FR-018：無結果時 MUST 顯示訊息與調整建議，而非空白畫面。**
 *
 * 空白畫面會被讀成「壞了」，而實際上系統運作完全正常——使用者只是把篩選
 * 條件收得太緊。差別在於前者讓他離開，後者讓他放寬條件再找一次。
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-md py-gap-8 text-center">
      <p className="text-h3 font-display text-ink">{title}</p>
      {hint && <p className="mt-gap-2 text-body text-ink-muted">{hint}</p>}
      {action && <div className="mt-gap-4">{action}</div>}
    </div>
  )
}
