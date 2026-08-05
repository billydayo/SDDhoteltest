/**
 * T042：載入中。
 *
 * `role="status"` 搭配 `aria-live="polite"` 讓螢幕閱讀器在內容抵達時得到通知。
 * 少了它，只用視覺提示的載入動畫對讀屏使用者等同於「畫面沒有任何反應」
 * （憲章原則 V）。
 *
 * 動畫在 `prefers-reduced-motion` 下由 `styles/index.css` 統一壓成幾乎靜止，
 * 因此這裡不必個別處理。
 */
import { archPanelClass } from '../lib/surfaces'

export function LoadingState({ label = '載入中…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-gap-3 py-gap-8 text-ink-muted"
    >
      <span
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-2 border-line-strong border-t-brand"
      />
      <span className="text-small">{label}</span>
    </div>
  )
}

/**
 * 骨架佔位。用於已知版面形狀的列表，避免內容抵達時整頁跳動。
 *
 * `aria-hidden`：這是純視覺的佔位，讀屏使用者該聽到的是上面 `LoadingState`
 * 的那一句話，而不是一排空白方塊。
 *
 * ⚠️ 外形 MUST 跟著 `components/RoomCard.tsx` 走——同樣的拱頂外殼、同樣的
 * `h-56` 圖片區。骨架矮一截或形狀不同，換成真資料時整排卡片會跳一下，
 * 那正是骨架要避免的事。
 */
export function SkeletonCard() {
  return (
    <div aria-hidden="true" className={`animate-pulse overflow-hidden ${archPanelClass}`}>
      <div className="h-56 w-full bg-surface-alt" />
      <div className="p-gap-4">
        <div className="h-4 w-2/3 rounded-xs bg-surface-alt" />
        <div className="mt-gap-2 h-3 w-1/3 rounded-xs bg-surface-alt" />
      </div>
    </div>
  )
}
