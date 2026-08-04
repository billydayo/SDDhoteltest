/**
 * T148：後台的房源品質檢測（FR-062、FR-104 ~ FR-107、SC-030）。
 *
 * ## 與前台的安全檢測共用「計算」，不共用「上傳」
 *
 * 兩邊都 import `lib/riskScore.ts`，但**只有這一邊有上傳**——因為只有這一邊
 * 的圖片是業者自己的房源照片，本來就要公開顯示。前台的私人照片全程留在瀏覽器
 * （FR-066、SC-030），那條路徑連 API 都碰不到（`pages/RiskCheck.tsx`）。
 *
 * 因此本檔的結果區塊與前台長得像卻是各自寫的。合成一個共用元件會讓前台的
 * 相依圖多一個節點，而那個節點遲早會有人在裡面加一個「順便存起來」。
 *
 * ## 儲存前的二次確認（FR-105）
 *
 * ⚠️ **MUST 明確告知「此圖將公開顯示於房源詳情頁」。** 業者在挑照片時想的是
 * 「哪張最能看出問題」，那和「哪張適合給客人看」是兩個不同的標準——沒有這句
 * 提醒，一張拍到雜物的對照圖就會出現在公開頁面上。
 *
 * 後端無從驗證這件事，只能在稽核日誌裡記下「誰在何時把哪張圖放上公開頁面」
 * （`routers/admin_rooms.py`）。
 *
 * ## 分數由後端重算
 *
 * 前端算出的三項指標會送上去，但**總分與等級以後端回傳的為準**
 * （`services/risk.py`）。同一組指標在兩邊算出不同分數時，畫面與資料庫會
 * 不一致而沒有任何錯誤訊息。
 */
import { useCallback, useId, useRef, useState } from 'react'

import { api } from '../../api/client'
import type { AdminRoom, RiskCheck } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import { shrinkForUpload } from '../../lib/image'
import {
  analyzeImageFile,
  assess,
  LEVEL_LABEL,
  suggestionsFor,
  validateSource,
  type RiskAssessment,
} from '../../lib/riskScore'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
} from './ui'

const LEVEL_TONE = { low: 'ok', medium: 'warn', high: 'danger' } as const

/**
 * 後端回傳的 `riskLevel` 是字串。認不得時原樣顯示——
 * 空白會讓那一格看起來像資料掉了（`lib/labels.ts` 的同一個道理）。
 */
function riskLevelLabel(value: string): string {
  return (LEVEL_LABEL as Record<string, string | undefined>)[value] ?? value
}

export function RoomRisk() {
  const loadRooms = useCallback((signal: AbortSignal) => api.admin.rooms.list({}, signal), [])
  const rooms = useAsync<AdminRoom[]>(loadRooms)

  const [roomId, setRoomId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [local, setLocal] = useState<RiskAssessment | null>(null)
  const [saved, setSaved] = useState<RiskCheck | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)
  const ids = useId()

  function release() {
    if (objectUrl.current !== null) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }

  async function analyze(picked: File) {
    setLocal(null)
    setSaved(null)
    setConfirming(false)
    setFailure(null)

    const invalid = validateSource(picked)
    if (invalid) {
      setFailure(invalid)
      return
    }

    release()
    const url = URL.createObjectURL(picked)
    objectUrl.current = url
    setPreview(url)
    setFile(picked)

    setAnalyzing(true)
    try {
      setLocal(assess(await analyzeImageFile(picked)))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : '分析失敗，請換一張照片再試一次。')
    } finally {
      setAnalyzing(false)
    }
  }

  async function save() {
    if (!file || !local || roomId === '') return
    setSaving(true)
    setFailure(null)
    try {
      // 縮圖後再送。後端的 2 MB 上限是最後一道網，不是壓縮的替代品
      // （憲章「上傳」條）。
      const shrunk = await shrinkForUpload(file)
      setSaved(
        await api.admin.rooms.createRiskCheck(roomId, shrunk, {
          brightness: local.brightness,
          clutter: local.clutter,
          contrast: local.contrast,
        }),
      )
      setConfirming(false)
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    } finally {
      setSaving(false)
    }
  }

  if (rooms.status === 'error') return <ErrorState error={rooms.error} onRetry={rooms.reload} />
  if (!rooms.data) return <LoadingState label="載入房源…" />

  const selectedRoom = rooms.data.find((room) => room.id === roomId)
  const suggestions = local ? suggestionsFor(local) : []

  return (
    <div>
      <ModuleHeading title="房源品質檢測" />

      {rooms.data.length === 0 ? (
        <EmptyState title="還沒有任何房源" hint="請先到「房源管理」新增一間房源，再回來檢測。" />
      ) : (
        <>
          <section className="mt-gap-4 rounded-base border border-line-soft bg-surface p-gap-4">
            <div className="flex flex-wrap items-end gap-gap-3">
              <Field label="要檢測的房源" htmlFor={`${ids}-room`} className="min-w-56 flex-1">
                <select
                  id={`${ids}-room`}
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value)
                    setSaved(null)
                    setConfirming(false)
                  }}
                  className={inputClass}
                >
                  <option value="">請選擇…</option>
                  {rooms.data.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div>
                <input
                  id={`${ids}-file`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={analyzing || roomId === ''}
                  className="sr-only"
                  onChange={(e) => {
                    const picked = e.target.files?.[0]
                    if (picked) void analyze(picked)
                    e.target.value = ''
                  }}
                />
                <label
                  htmlFor={`${ids}-file`}
                  className={[
                    'inline-block rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small',
                    analyzing || roomId === ''
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer text-ink-muted hover:border-brand hover:text-brand-strong',
                  ].join(' ')}
                >
                  {analyzing ? '分析中…' : '選擇照片'}
                </label>
              </div>
            </div>
            {roomId === '' && (
              <p className="mt-gap-2 text-tiny text-ink-muted">請先選擇房源才能上傳照片。</p>
            )}
          </section>

          {failure !== null && <Notice tone="danger">{failure}</Notice>}

          {preview !== null && (
            <section className="mt-gap-4 grid gap-gap-4 sm:grid-cols-2">
              <img
                src={preview}
                alt="待檢測的房源照片預覽"
                className="w-full rounded-base border border-line-soft object-cover"
              />

              <div>
                {analyzing && (
                  <p role="status" aria-live="polite" className="text-small text-ink-muted">
                    分析中，請稍候…
                  </p>
                )}

                {local && (
                  <>
                    <p className="text-small text-ink-muted">瀏覽器分析結果（送出前的預覽）</p>
                    <p className="mt-gap-1 font-display text-h1 tabular-nums text-ink">
                      {local.riskScore}
                      <span className="ml-gap-2 align-middle">
                        <Badge tone={LEVEL_TONE[local.riskLevel]}>
                          {LEVEL_LABEL[local.riskLevel]}
                        </Badge>
                      </span>
                    </p>
                    <dl className="mt-gap-3 grid grid-cols-3 gap-gap-2 text-center">
                      {(
                        [
                          ['亮度', local.brightness],
                          ['整潔度', local.clutter],
                          ['對比', local.contrast],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="rounded-base bg-surface-alt py-gap-2">
                          <dt className="text-tiny text-ink-muted">{label}</dt>
                          <dd className="font-display text-h3 tabular-nums text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    {suggestions.length > 0 && (
                      <ul className="mt-gap-3 grid gap-gap-2 text-small text-ink">
                        {suggestions.map((text) => (
                          <li key={text} className="rounded-base bg-surface-alt px-gap-3 py-gap-2">
                            {text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </section>
          )}

          {local && saved === null && (
            <section className="mt-gap-4">
              {confirming ? (
                <div
                  role="alertdialog"
                  aria-label="確認公開這張照片"
                  className="rounded-base border border-warn/40 bg-warn-soft p-gap-4"
                >
                  {/* ⚠️ FR-105：MUST 明確告知此圖將公開顯示於房源詳情頁。 */}
                  <h3 className="text-md text-ink">這張照片將公開顯示於房源詳情頁</h3>
                  <p className="mt-gap-2 text-small text-ink">
                    儲存後，「{selectedRoom?.name ?? '該房源'}」的詳情頁上會出現這張照片與檢測結果，
                    任何訪客都看得到。請確認照片中沒有個人物品、證件或其他不宜公開的內容。
                  </p>
                  <div className="mt-gap-3 flex flex-wrap gap-gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void save()
                      }}
                      className={primaryButtonClass}
                    >
                      {saving ? '儲存中…' : '我確認，公開並儲存'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setConfirming(false)
                      }}
                      className={buttonClass}
                    >
                      再看一下
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(true)
                  }}
                  className={primaryButtonClass}
                >
                  儲存檢測結果
                </button>
              )}
            </section>
          )}

          {saved && (
            <Notice tone="ok">
              {/* ⚠️ 顯示的是**後端重算後**的分數，不是上面那個瀏覽器算出來的。
                  兩者理應相同（同一條公式），不同時這裡就會看得出來。 */}
              已儲存。後端重算後的分數為 {saved.riskScore}（{riskLevelLabel(saved.riskLevel)}
              ），已顯示於「{selectedRoom?.name ?? '該房源'}」的詳情頁。
            </Notice>
          )}
        </>
      )}
    </div>
  )
}
