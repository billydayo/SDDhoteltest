/**
 * 表單共用的樣式常數與焦點行為。
 *
 * 與 `components/Field.tsx` 分開，只為了讓那個檔案純粹匯出元件——元件檔一旦
 * 同時匯出非元件，開發時的熱更新就會退化成整頁重載。
 */
import { useEffect } from 'react'

import { fieldOf } from './errors'

export const inputClass =
  'w-full rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-body text-ink' +
  ' aria-[invalid=true]:border-danger'

/**
 * 把焦點移到後端指出的欄位，並回傳那個欄位名（FR-010）。
 *
 * ⚠️ 這件事只在**後端回了 `field`** 時才做得到。後端在例外處理器的邊界把它
 * 轉成 camelCase（contracts/README.md），前端據此查 `[name="..."]`。
 *
 * 找不到對應輸入框時焦點就**安靜地不動**——畫面上沒有任何錯誤，只是「訊息
 * 出現了但游標沒動」。因此 `formRef` 的範圍要涵蓋所有欄位，而每個 `<input>`
 * 的 `name` 要跟後端對得上。
 */
export function useFieldFocus(
  formRef: React.RefObject<HTMLFormElement | null>,
  error: unknown,
): string | null {
  const badField = fieldOf(error)

  useEffect(() => {
    if (!badField || !formRef.current) return
    formRef.current.querySelector<HTMLElement>(`[name="${badField}"]`)?.focus()
  }, [badField, error, formRef])

  return badField
}
