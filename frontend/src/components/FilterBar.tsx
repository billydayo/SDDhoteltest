/**
 * T055：篩選列（FR-010、FR-010a）。
 *
 * 這個元件的規則比它看起來多，而且每一條都有具體的失效樣態：
 *
 * ## 1. 欄位標籤 MUST NOT 標示「必填」
 *
 * 入住日／退房日／人數三者**沒有一個是無條件必填的**——三者皆空是合法搜尋。
 * 它們只在彼此之間連動。標成「必填」會讓只想按設施篩選的訪客以為非填不可，
 * 於是隨便填一組日期，得到一份被日期縮限過的結果卻不知道。
 * 因此改以一句說明文字交代連動關係。
 *
 * ## 2. 條件檢查 MUST 只在按下「搜尋」時執行
 *
 * 邊打字邊驗證會在使用者填完入住日、還沒填退房日時就跳出錯誤。他什麼都
 * 還沒做錯，只是還沒填完。
 *
 * ## 3. 缺漏 MUST 逐欄顯示訊息，並將焦點移至第一個有問題的欄位
 *
 * 後端已在錯誤裡帶上 `field`，前端據此定位。⚠️ 後端送的是 snake_case，
 * 必須經 `fieldOf()` 正規化——不轉換的話焦點會**安靜地不動**。
 *
 * ## 4. 清單為空時 MUST 隱藏該組篩選
 *
 * 管理員可以把設施詞彙表清空（那是合法狀態）。留一個標題底下什麼都沒有的
 * 區塊，看起來就是壞了。
 */
import { useEffect, useId, useRef, useState } from 'react'

import * as dates from '../lib/dates'
import { fieldOf } from '../lib/errors'
import { inputClass } from '../lib/form'
import { activeSummary, type FilterValues } from '../lib/filters'
import { panelClass, primaryButtonClass } from '../lib/surfaces'

interface FilterBarProps {
  values: FilterValues
  onChange: (values: FilterValues) => void
  onSearch: () => void
  onClear: () => void
  /** 詞彙表。**空陣列時該組篩選整組隱藏**（FR-010a）。 */
  amenityOptions: string[]
  featureOptions: string[]
  /** 上一次搜尋的錯誤。用於逐欄顯示訊息與移動焦點。 */
  error?: unknown
}

export function FilterBar({
  values,
  onChange,
  onSearch,
  onClear,
  amenityOptions,
  featureOptions,
  error,
}: FilterBarProps) {
  const formId = useId()
  const [expanded, setExpanded] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const badField = fieldOf(error)
  const errorMessage = error instanceof Error ? error.message : null

  // 焦點移至第一個有問題的欄位（FR-010）。
  useEffect(() => {
    if (!badField || !formRef.current) return
    const target = formRef.current.querySelector<HTMLElement>(`[name="${badField}"]`)
    target?.focus()
  }, [badField, error])

  function set<K extends keyof FilterValues>(key: K, value: FilterValues[K]) {
    onChange({ ...values, [key]: value })
  }

  function toggleIn(key: 'amenities' | 'features', option: string) {
    const current = values[key]
    set(key, current.includes(option) ? current.filter((v) => v !== option) : [...current, option])
  }

  const summary = activeSummary(values)

  const fieldError = (name: string) => (badField === name ? errorMessage : null)

  return (
    <form
      ref={formRef}
      aria-label="房源篩選"
      className={`${panelClass} p-gap-4`}
      onSubmit={(e) => {
        e.preventDefault()
        onSearch()
      }}
    >
      {/*
        ⚠️ 三者連動的說明。**MUST NOT 在標籤上寫「必填」**——三者皆空是合法的。
      */}
      <p className="mb-gap-3 text-small text-ink-muted">
        不填任何條件即可瀏覽全部房源。若要查詢特定日期的空房，
        <strong className="font-semibold text-ink">入住日、退房日與入住人數需一併填寫</strong>。
      </p>

      <div className="grid gap-gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="關鍵字" htmlFor={`${formId}-keyword`}>
          <input
            id={`${formId}-keyword`}
            name="keyword"
            type="search"
            value={values.keyword}
            onChange={(e) => {
              set('keyword', e.target.value)
            }}
            placeholder="房名、房型或描述"
            className={inputClass}
          />
        </Field>

        <Field label="入住日" htmlFor={`${formId}-checkIn`} error={fieldError('checkIn')}>
          <input
            id={`${formId}-checkIn`}
            name="checkIn"
            type="date"
            // 訂房需提前一天（FR-022）。這裡只是輸入輔助，實際判定在後端。
            min={dates.tomorrow()}
            value={values.checkIn}
            onChange={(e) => {
              set('checkIn', e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="退房日" htmlFor={`${formId}-checkOut`} error={fieldError('checkOut')}>
          <input
            id={`${formId}-checkOut`}
            name="checkOut"
            type="date"
            min={values.checkIn ? dates.addDays(values.checkIn, 1) : dates.addDays(dates.today(), 2)}
            value={values.checkOut}
            onChange={(e) => {
              set('checkOut', e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="入住人數" htmlFor={`${formId}-guestCount`} error={fieldError('guestCount')}>
          <input
            id={`${formId}-guestCount`}
            name="guestCount"
            type="number"
            min={1}
            inputMode="numeric"
            value={values.guestCount}
            onChange={(e) => {
              set('guestCount', e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="每晚價格上限" htmlFor={`${formId}-maxPrice`} error={fieldError('maxPrice')}>
          <input
            id={`${formId}-maxPrice`}
            name="maxPrice"
            type="number"
            min={0}
            step={100}
            inputMode="numeric"
            value={values.maxPrice}
            onChange={(e) => {
              set('maxPrice', e.target.value)
            }}
            placeholder="新臺幣元"
            className={inputClass}
          />
        </Field>
      </div>

      {/* 設施與特色收在可展開區。它們項目多，攤開會把日期與人數擠到摺線以下 */}
      {(amenityOptions.length > 0 || featureOptions.length > 0) && (
        <div className="mt-gap-3">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((v) => !v)
            }}
            className="text-small text-brand-strong underline underline-offset-4"
          >
            {expanded ? '收合設施與特色' : '展開設施與特色'}
          </button>

          {expanded && (
            <div className="mt-gap-3 grid gap-gap-4 sm:grid-cols-2">
              {/* ⚠️ 清單為空時整組隱藏（FR-010a）——留一個空區塊看起來就是壞了 */}
              <CheckboxGroup
                legend="設施（需同時具備）"
                options={amenityOptions}
                selected={values.amenities}
                onToggle={(o) => {
                  toggleIn('amenities', o)
                }}
              />
              <CheckboxGroup
                legend="房型特色（需同時具備）"
                options={featureOptions}
                selected={values.features}
                onToggle={(o) => {
                  toggleIn('features', o)
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 生效條件摘要與一鍵清除 */}
      {summary.length > 0 && (
        <div className="mt-gap-4 flex flex-wrap items-center gap-gap-2 border-t border-line-soft pt-gap-3">
          <span className="text-small text-ink-muted">目前條件：</span>
          {summary.map((item, i) => (
            <span
              key={`${item.key}-${String(i)}`}
              className="rounded-pill bg-brand-soft px-gap-3 py-gap-1 text-small text-ink"
            >
              {item.label}
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto rounded-pill border border-line-strong px-gap-3 py-gap-1 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            清除全部條件
          </button>
        </div>
      )}

      {/* 沒有對應欄位的錯誤（例如排序無效）也要說出來，MUST NOT 靜默 */}
      {errorMessage && !badField && (
        <p role="alert" className="mt-gap-3 text-small text-danger">
          {errorMessage}
        </p>
      )}

      <div className="mt-gap-4 flex justify-end">
        <button
          type="submit"
          className={primaryButtonClass}
        >
          搜尋
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
      {/* 每個控制項都有關聯的 <label>（憲章原則 V、T171） */}
      <label htmlFor={htmlFor} className="mb-gap-1 block text-small text-ink-muted">
        {label}
      </label>
      {children}
      {/* 逐欄訊息（FR-010）。`role="alert"` 讓讀屏立即得知。 */}
      {error && (
        <p role="alert" className="mt-gap-1 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function CheckboxGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: string[]
  selected: string[]
  onToggle: (option: string) => void
}) {
  // ⚠️ 空清單整組不渲染（FR-010a）
  if (options.length === 0) return null

  return (
    <fieldset>
      <legend className="mb-gap-2 text-small text-ink-muted">{legend}</legend>
      <div className="flex flex-wrap gap-gap-2">
        {options.map((option) => {
          const checked = selected.includes(option)
          return (
            <label
              key={option}
              className={[
                'cursor-pointer rounded-pill border px-gap-3 py-gap-1 text-small transition-colors',
                checked
                  ? 'border-brand bg-brand-soft text-ink'
                  : 'border-line-strong text-ink-muted hover:border-brand',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  onToggle(option)
                }}
                className="sr-only"
              />
              {option}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
