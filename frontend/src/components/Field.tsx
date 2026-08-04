/**
 * 表單欄位的共用外框：標籤、輸入框、逐欄錯誤訊息。
 *
 * 三個表單（登入、註冊、帳戶設定）各寫一次的話，一定會有一個漏掉
 * `htmlFor`／`id` 的配對——而漏掉的症狀是**點標籤沒有反應、讀屏念不出這一格
 * 是什麼**，畫面上完全看不出來（憲章原則 V、T171）。
 *
 * 樣式常數與焦點行為在 `lib/form.ts`。
 */
import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  htmlFor: string
  error?: string | null
  hint?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-gap-1 block text-small text-ink-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>}
      {error && (
        // `role="alert"` 讓讀屏立即得知，不必等使用者 tab 回這一格
        <p role="alert" className="mt-gap-1 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
