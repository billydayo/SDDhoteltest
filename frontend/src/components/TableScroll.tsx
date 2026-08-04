/**
 * 表格的橫向捲動容器，與後台表格的共用樣式。
 *
 * ## 為什麼表格一定要包一層
 *
 * ⚠️ **SC-012／T172：320px 至 1920px 之間，頁面 MUST NOT 產生橫向捲動。**
 *
 * 後台的訂單表有十來欄，在手機上必然超出視窗寬度。若不包這一層，超出的部分
 * 會把**整個頁面**撐寬——導覽、頁首、每一段文字都跟著左右移動，而使用者得
 * 先橫向捲回去才找得到剛才在讀的地方。
 *
 * 包起來之後，超出的只有表格自己：頁面本身不動，表格在自己的框裡左右捲。
 *
 * `tabIndex={0}` 不是可有可無的裝飾：一個可捲動但不可聚焦的區塊，只用鍵盤的
 * 人捲不到右半邊的欄位（WCAG 2.1.1）。有了它就能用方向鍵捲動。
 */
import type { ReactNode } from 'react'

/** 表頭儲存格。整個後台共用，避免每張表各自演化出不同的間距。 */
export const TH = 'px-gap-3 py-gap-2 text-left text-tiny font-normal text-ink-muted whitespace-nowrap'

/** 資料儲存格。 */
export const TD = 'px-gap-3 py-gap-2 text-small text-ink align-top'

/** 數字欄：右對齊並用等寬字，位數才對得齊（金額、筆數）。 */
export const TD_NUM = `${TD} text-right font-mono tabular-nums whitespace-nowrap`

export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      // 讀屏使用者需要知道這是一塊可捲動的區域，以及它裝的是什麼
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-line-soft bg-surface"
    >
      {children}
    </div>
  )
}
