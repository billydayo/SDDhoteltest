/**
 * 後台各頁共用的版面零件。
 *
 * 十二個模組長得像同一個系統，靠的不是每頁各自抄一份 class 字串——那份字串
 * 每被抄一次就多一個會漂移的地方，而漂移的症狀是「這一頁的按鈕怎麼比較矮」。
 *
 * ⚠️ 這裡**只放樣式與版面**。任何與資料或授權有關的判斷都不屬於這一層。
 */
import type { ReactNode } from 'react'

import { TONE_CLASS, type Tone } from '../../lib/labels'

export const inputClass =
  'w-full rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-small text-ink'

export const buttonClass =
  'rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-50'

export const primaryButtonClass =
  'rounded-pill bg-brand px-gap-4 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50'

export const dangerButtonClass =
  'rounded-pill border border-danger/40 px-gap-4 py-gap-2 text-small text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50'

/** 模組標題列。⚠️ `h2`——`h1` 是「後台」本身（`AdminLayout`）。 */
export function ModuleHeading({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-gap-3">
      <h2 className="font-display text-h2 text-ink">{title}</h2>
      {actions && <div className="flex flex-wrap items-center gap-gap-2">{actions}</div>}
    </div>
  )
}

/**
 * 篩選列。
 *
 * 用 `form` 包起來並附上 `aria-label`，讓讀屏使用者知道這一組控制項是一件事；
 * 也讓 Enter 直接送出，不必去找那顆按鈕。
 */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="mt-gap-4 rounded-base border border-line-soft bg-surface p-gap-3">
      <div className="flex flex-wrap items-end gap-gap-3">
        {children}
        {onReset && (
          <button type="button" onClick={onReset} className={buttonClass}>
            清除條件
          </button>
        )}
      </div>
    </div>
  )
}

/** 帶標籤的欄位。標籤一律是真的 `label`——`placeholder` 不是標籤（憲章原則 V）。 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = 'min-w-40',
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-tiny text-ink-muted">
        {label}
      </label>
      <div className="mt-gap-1">{children}</div>
      {hint && <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>}
    </div>
  )
}

/**
 * 表格外殼。
 *
 * `overflow-x-auto`：寬表格 MUST 自己捲，**MUST NOT 把整個頁面撐出橫向捲動**
 * （FR-061a、T172a）。手機上一整頁跟著左右晃是最難用的一種版面。
 */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="mt-gap-4 overflow-x-auto rounded-base border border-line-soft bg-surface">
      <table className="w-full min-w-3xl border-collapse text-small">{children}</table>
    </div>
  )
}

export function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`border-b border-line-soft px-gap-3 py-gap-2 font-medium text-ink-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td
      className={`border-b border-line-soft px-gap-3 py-gap-2 align-middle ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-pill border px-gap-2 py-px text-tiny whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * 操作結果的提示。
 *
 * `role="status"`：寫入成功或失敗都發生在使用者按下按鈕之後，而讀屏使用者
 * 看不到畫面上那一行字變了（憲章原則 V）。
 */
export function Notice({ tone, children }: { tone: 'ok' | 'danger'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`mt-gap-3 rounded-base border px-gap-3 py-gap-2 text-small ${
        tone === 'ok' ? TONE_CLASS.ok : TONE_CLASS.danger
      }`}
    >
      {children}
    </p>
  )
}
