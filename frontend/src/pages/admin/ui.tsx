/**
 * 後台各頁共用的版面零件。
 *
 * 十二個模組長得像同一個系統，靠的不是每頁各自抄一份 class 字串——那份字串
 * 每被抄一次就多一個會漂移的地方，而漂移的症狀是「這一頁的按鈕怎麼比較矮」。
 *
 * ⚠️ 這裡**只放樣式與版面**。任何與資料或授權有關的判斷都不屬於這一層。
 */
import type { ReactNode } from 'react'

import { inputClass as sharedInputClass } from '../../lib/form'
import { TONE_CLASS, type Tone } from '../../lib/labels'
import {
  dangerButtonClass as sharedDangerButtonClass,
  panelClass,
  primaryButtonClass as sharedPrimaryButtonClass,
  subtleButtonClass,
} from '../../lib/surfaces'

/*
 * ⚠️ **這四個一律轉發 `lib/surfaces.ts`／`lib/form.ts`，不在此處另寫一份。**
 *
 * 後台原本有自己的一套：圓角小一級、內距緊一級、字級小一級、面板沒有陰影。
 * 每一項單獨看都像是「後台本來就該密一點」的合理選擇，合起來的結果是後台
 * 看起來不像同一個網站的一部分。
 *
 * 保留這幾個名字而不是叫十二個模組改 import，是因為它們散在各頁的 className
 * 裡；換來源只要改這一個檔案，而改 import 要動十二個檔案、每個都可能漏。
 */
export const inputClass = sharedInputClass
export const buttonClass = subtleButtonClass
export const primaryButtonClass = sharedPrimaryButtonClass
export const dangerButtonClass = sharedDangerButtonClass

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
    <div className={`mt-gap-5 ${panelClass} p-gap-4`}>
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

/**
 * 帶標籤的欄位。標籤一律是真的 `label`——`placeholder` 不是標籤（憲章原則 V）。
 *
 * ## ⚠️ `hint` 在輸入框**之上**，這是版面的必要條件而非偏好
 *
 * `FilterBar` 是 `flex flex-wrap items-end`：對齊的是每一格的**底邊**。
 * 把 hint 放在輸入框之後，有 hint 的那一格底邊就變成 hint 的底邊，於是它的
 * 輸入框被往上推一整行——同一列的輸入框與按鈕就全部對不齊了（實際發生過，
 * 「入住起日／入住迄日」一高一低）。
 *
 * 放在上方之後，**輸入框是每一格的最後一個子元素**，底邊一致，因而必然對齊。
 *
 * 其他做法都更糟：
 * - hint 絕對定位 → 篩選列換行時會蓋到下一列的標籤（T172 明訂內容不得重疊）
 * - 每一格都保留一行 hint 空位 → 按鈕會比輸入框低一行
 * - 改用 grid subgrid → 需要 grid 容器，而篩選列必須能 `flex-wrap`（320px）
 */
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
      <label htmlFor={htmlFor} className="block text-small text-ink-muted">
        {label}
      </label>
      {hint && <p className="text-tiny text-ink-muted">{hint}</p>}
      <div className="mt-gap-1">{children}</div>
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
    <div className={`mt-gap-5 overflow-x-auto ${panelClass}`}>
      <table className="w-full min-w-3xl border-collapse text-small">{children}</table>
    </div>
  )
}

export function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`border-b border-line-soft px-gap-4 py-gap-3 font-medium text-ink-muted ${
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
      className={`border-b border-line-soft px-gap-4 py-gap-3 align-middle ${
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
      className={`mt-gap-4 rounded-lg border px-gap-4 py-gap-3 text-small ${
        tone === 'ok' ? TONE_CLASS.ok : TONE_CLASS.danger
      }`}
    >
      {children}
    </p>
  )
}
