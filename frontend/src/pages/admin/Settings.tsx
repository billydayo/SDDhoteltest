/**
 * T165：系統參數（FR-073、FR-098、FR-101、FR-119、FR-120）。
 *
 * ## 可接受範圍來自後端，**MUST NOT 硬編**
 *
 * `pendingPaymentMin` / `pendingPaymentMax` 隨值一起回傳
 * （`schemas/settings.py`）。前端自己寫一份 5–1440 的話，那份數字遲早會與
 * 資料庫的 `settings_valid_range` CHECK 約束分歧——而分歧時使用者會看到一個
 * 「符合畫面提示卻被拒絕」的錯誤，那是最難自行排除的一種（FR-119、FR-120）。
 *
 * ## 調整保留時間**不影響既有訂單**（FR-101）
 *
 * 這句話必須寫在畫面上。少了它，管理員把 30 分鐘改成 5 分鐘之後會等著現有的
 * 待付款訂單提早釋出，而它們不會。
 *
 * ## 還原示範資料會保留日誌
 *
 * 後端的回應帶著 `auditLogPreserved` 與一句說明，畫面原樣顯示。
 * 管理員按下「還原所有資料」後會預期日誌也被清掉——**不說清楚會被當成 bug
 * 回報，然後有人「修好」它**，而那正是 SC-027 要防的事。
 */
import { useCallback, useEffect, useId, useState } from 'react'

import { api } from '../../api/client'
import type { ResetResult, SystemSettings } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import {
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
} from './ui'

/** 一份以換行分隔的詞彙表。空白行略過、去重，順序保留。 */
function parseVocabulary(text: string): string[] {
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const value = line.trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

export function Settings() {
  const load = useCallback((signal: AbortSignal) => api.admin.settings.get(signal), [])
  const { status, data, error, reload } = useAsync<SystemSettings>(load)

  const [minutes, setMinutes] = useState('')
  const [amenities, setAmenities] = useState('')
  const [features, setFeatures] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [reset, setReset] = useState<ResetResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const ids = useId()

  // 資料抵達後填入表單。**不把後端的值當成受控輸入的唯一來源**——那會讓
  // 使用者打到一半時的重新載入把他的輸入蓋掉。
  useEffect(() => {
    if (!data) return
    setMinutes(String(data.pendingPaymentMinutes))
    setAmenities(data.roomAmenities.join('\n'))
    setFeatures(data.roomFeatures.join('\n'))
  }, [data])

  if (status === 'error') return <ErrorState error={error} onRetry={reload} />
  if (!data) return <LoadingState label="載入系統參數…" />

  const parsedMinutes = Number(minutes)
  const outOfRange =
    !Number.isInteger(parsedMinutes) ||
    parsedMinutes < data.pendingPaymentMin ||
    parsedMinutes > data.pendingPaymentMax

  async function save() {
    setSaving(true)
    setMessage(null)
    setFailure(null)
    try {
      await api.admin.settings.update({
        pendingPaymentMinutes: parsedMinutes,
        roomAmenities: parseVocabulary(amenities),
        roomFeatures: parseVocabulary(features),
      })
      setMessage('已更新系統參數。新的保留時間只影響之後成立的訂單。')
      reload()
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    } finally {
      setSaving(false)
    }
  }

  async function resetDemo() {
    setResetting(true)
    setFailure(null)
    try {
      setReset(await api.admin.settings.resetDemoData())
      setConfirming(false)
      reload()
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      <ModuleHeading title="系統參數" />

      <section className="mt-gap-4 rounded-lg border border-line-soft bg-surface shadow-soft p-gap-4">
        <h3 className="text-md text-ink">未付款訂單保留時間</h3>

        <div className="mt-gap-3 max-w-sm">
          <Field
            label="保留分鐘數"
            htmlFor={`${ids}-minutes`}
            className="w-full"
            // ⚠️ 範圍字串由後端給的上下限組出來，不是寫死的。
            hint={`可接受範圍：${String(data.pendingPaymentMin)} – ${String(data.pendingPaymentMax)} 分鐘`}
          >
            <input
              id={`${ids}-minutes`}
              type="number"
              min={data.pendingPaymentMin}
              max={data.pendingPaymentMax}
              step={1}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value)
              }}
              aria-invalid={outOfRange}
              className={inputClass}
            />
          </Field>
          {outOfRange && (
            <p className="mt-gap-1 text-tiny text-danger">
              請輸入 {data.pendingPaymentMin} 至 {data.pendingPaymentMax} 之間的整數。
            </p>
          )}
        </div>

        {/* FR-101。這一句不是提示，是這個欄位語意的一部分。 */}
        <p className="mt-gap-2 text-small text-ink-muted">
          ⚠️ 這項調整<strong>只影響之後成立的訂單</strong>。目前已在倒數的待付款訂單維持原本的到期時間。
        </p>

        <h3 className="mt-gap-6 text-md text-ink">詞彙表</h3>
        <p className="mt-gap-1 text-small text-ink-muted">
          一行一項。這兩份清單同時決定房源編輯的可選項目與前台的篩選器（FR-010a）。
        </p>
        <div className="mt-gap-3 grid gap-gap-3 sm:grid-cols-2">
          <Field label="設施" htmlFor={`${ids}-amenities`} className="w-full">
            <textarea
              id={`${ids}-amenities`}
              rows={6}
              value={amenities}
              onChange={(e) => {
                setAmenities(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
          <Field label="房型特色" htmlFor={`${ids}-features`} className="w-full">
            <textarea
              id={`${ids}-features`}
              rows={6}
              value={features}
              onChange={(e) => {
                setFeatures(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
        </div>

        {message !== null && <Notice tone="ok">{message}</Notice>}
        {failure !== null && <Notice tone="danger">{failure}</Notice>}

        <button
          type="button"
          disabled={saving || outOfRange}
          onClick={() => {
            void save()
          }}
          className={`mt-gap-4 ${primaryButtonClass}`}
        >
          {saving ? '儲存中…' : '儲存參數'}
        </button>
      </section>

      <section className="mt-gap-6 rounded-base border border-danger/30 bg-surface p-gap-4">
        <h3 className="text-md text-ink">還原示範資料</h3>
        <p className="mt-gap-1 text-small text-ink-muted">
          把房源、訂單、評論與退款全部還原成初始的示範狀態。
          <strong>操作日誌會被保留。</strong>
        </p>

        {reset !== null && <Notice tone="ok">{reset.message}</Notice>}

        {confirming ? (
          <div role="alertdialog" aria-label="還原示範資料" className="mt-gap-3">
            <p className="text-small text-danger">
              這會刪除目前所有的訂單、評論與退款申請，且無法復原。確定要繼續嗎？
            </p>
            <div className="mt-gap-2 flex gap-gap-2">
              <button
                type="button"
                disabled={resetting}
                onClick={() => {
                  void resetDemo()
                }}
                className={dangerButtonClass}
              >
                {resetting ? '還原中…' : '確定還原'}
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => {
                  setConfirming(false)
                }}
                className={buttonClass}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true)
            }}
            className={`mt-gap-3 ${dangerButtonClass}`}
          >
            還原示範資料
          </button>
        )}
      </section>
    </div>
  )
}
