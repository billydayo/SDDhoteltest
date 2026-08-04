/**
 * T092：待付款訂單的剩餘付款時間（FR-102）。
 *
 * ## ⚠️ 到期時間由後端決定，前端只負責顯示
 *
 * `expiresAt` 是建單當下由資料庫算好、寫死在訂單上的（FR-101：日後調整保留
 * 時間 MUST NOT 影響既有訂單）。前端**MUST NOT** 自己用「建立時間 + 60 分」
 * 推算——那會在管理員改過設定之後與後端不一致，而畫面顯示的倒數與伺服器
 * 實際判定的到期時刻差了多久，沒有任何地方看得出來。
 *
 * ## 歸零不等於已取消
 *
 * 倒數到 0 時這裡只說「付款時間已過」。**MUST NOT 自行把訂單畫成已取消**：
 * 真正的取消由後端的 `expire_stale_orders()` 在下一次查詢時執行，而在那之前
 * 訂單在資料庫裡仍是 `pending-payment`。前端擅自改寫狀態，會在使用者重新
 * 整理後又變回待付款——他會以為系統壞了。
 */
import { useEffect, useState } from 'react'

import { secondsUntil } from '../lib/dates'

function format(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

export function PaymentCountdown({
  expiresAt,
  onExpire,
}: {
  /** 帶時區的 ISO 時間戳，來自訂單的 `expiresAt`。 */
  expiresAt: string
  /** 歸零時通知呼叫端（通常用來重新查一次訂單狀態）。 */
  onExpire?: () => void
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt))

  useEffect(() => {
    setRemaining(secondsUntil(expiresAt))
    if (secondsUntil(expiresAt) <= 0) return

    const timer = setInterval(() => {
      const next = secondsUntil(expiresAt)
      setRemaining(next)
      if (next <= 0) {
        clearInterval(timer)
        onExpire?.()
      }
    }, 1000)
    return () => {
      clearInterval(timer)
    }
    // `onExpire` 刻意不列入相依：呼叫端每次繪製都會給一個新的函式實體，
    // 列進去等於每秒重建一次計時器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])

  if (remaining <= 0) {
    return (
      <p role="status" className="text-small text-danger">
        付款時間已過，此訂單可能已被自動取消。
      </p>
    )
  }

  const urgent = remaining <= 300

  return (
    <p className={`text-small ${urgent ? 'text-danger' : 'text-ink-muted'}`}>
      剩餘付款時間{' '}
      {/*
        `aria-live="polite"` 只包住數字，不包整句話——包整句的話讀屏每秒
        會把「剩餘付款時間 59:59」整句念一遍，使用者根本無法操作頁面。
        再加上 `role="timer"`，讓輔助技術知道這是一個會自己變動的值。
      */}
      <time role="timer" aria-live="off" className="font-display tabular-nums">
        {format(remaining)}
      </time>
      {urgent && <span className="ml-gap-2">請儘快完成付款。</span>}
    </p>
  )
}
