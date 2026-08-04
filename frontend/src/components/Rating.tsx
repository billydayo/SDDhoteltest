/**
 * 平均評分。
 *
 * ⚠️ **`null` 代表尚無評分，MUST NOT 顯示為 0**（FR-047）。
 *
 * 0 分會被讀成「評價極差」，而實際上是還沒有人評過——對一間新上架的房源，
 * 那個誤讀直接把它從使用者的考慮清單裡刪掉。後端刻意讓這個欄位可為 null
 * 就是為了讓前端能區分這兩件事；在此把它折成 0 等於把那份用心丟掉。
 */
export function Rating({
  value,
  className = '',
}: {
  value: number | string | null
  className?: string
}) {
  if (value === null || value === '') {
    return <span className={`text-small text-ink-muted ${className}`}>尚無評分</span>
  }

  // 後端以 Decimal 序列化，JSON 上可能是字串。
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return <span className={`text-small text-ink-muted ${className}`}>尚無評分</span>
  }

  const formatted = numeric.toFixed(1)
  return (
    <span className={`inline-flex items-center gap-gap-1 text-small ${className}`}>
      {/* 星號是裝飾，資訊在數字裡。讀屏使用者聽到的是下面的 aria-label。 */}
      <span aria-hidden="true" className="text-brand-accent">
        ★
      </span>
      <span aria-label={`平均評分 ${formatted} 分，滿分 5 分`}>{formatted}</span>
    </span>
  )
}
