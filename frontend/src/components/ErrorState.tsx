/**
 * T042：錯誤狀態。
 *
 * ⚠️ **FR-084：API 不可用時 MUST 顯示可理解訊息。**
 * MUST NOT 靜默失敗、**MUST NOT 退回本機假資料**。
 *
 * 後者是最需要提防的一種「貼心」：拿一份寫死的房源頂上去，畫面看起來正常，
 * 使用者會照著不存在的房價去訂房。錯誤畫面難看，但至少是誠實的。
 *
 * 訊息的轉換在 `lib/errors.ts`——它是純函式，分開放才能被單獨測試，
 * 也才不會為了測一句文案而去渲染一個元件。
 */
import { messageFor } from '../lib/errors'
import { primaryButtonClass } from '../lib/surfaces'

interface ErrorStateProps {
  error: unknown
  /** 重試。省略時不顯示按鈕——沒有重試手段時放一顆沒用的按鈕更糟。 */
  onRetry?: () => void
  /** 覆寫標題。預設依錯誤種類決定。 */
  title?: string
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const message = messageFor(error)

  return (
    <div
      // `alert` 會被讀屏立即宣讀。錯誤是使用者需要馬上知道的事，
      // 用 `status`（polite）會排在他正在讀的內容之後才播報。
      role="alert"
      className="mx-auto max-w-md rounded-lg border border-danger/20 bg-danger-soft p-gap-5 text-center"
    >
      <h2 className="font-display text-h3 text-danger">{title ?? message.title}</h2>
      <p className="mt-gap-2 text-body text-ink-muted">{message.detail}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`mt-gap-4 ${primaryButtonClass}`}
        >
          重新載入
        </button>
      )}
    </div>
  )
}
