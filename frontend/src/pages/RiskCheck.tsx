/**
 * T146：前台的照片安全檢測（FR-062 ~ FR-067、FR-086、SC-015、SC-030）。
 *
 * ⚠️ **本檔只 import `lib/riskScore.ts`（與 React）。這是規格，不是風格。**
 *
 * 使用者在這裡上傳的是自己的私人照片。它們 MUST 全程留在瀏覽器內、
 * **MUST NOT 送往任何外部服務或長期儲存**（FR-066、FR-086）。保證這件事的
 * 方式不是「小心不要呼叫 API」——而是讓這個檔案的相依圖裡根本沒有出口：
 *
 * - `components/*` 多數會經 `lib/errors.ts` 連到 `api/client.ts`
 * - `lib/image.ts` 是上傳前的縮圖工具，名字與用途都屬於「上傳」那一側
 *
 * 因此本檔的載入中、錯誤、空狀態全部就地寫出來，不共用那些元件。多出來的
 * 幾十行 JSX 換到的是一條可被機器驗證的保證：`lib/__tests__/riskCheckIsolation`
 * （T144，靜態相依）與 `pages/__tests__/riskCheckNetwork`（T144a，執行期流量）
 * 兩面守著。任一支失敗即代表 SC-030／SC-015 已失守。
 *
 * ## 預覽圖也不離開瀏覽器
 *
 * 用 `URL.createObjectURL`，那是一個指向記憶體中 Blob 的本機位址，
 * 不產生任何請求。離開時 `revokeObjectURL`，否則整張圖會一直留在記憶體裡。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  ACCEPTED_IMAGE_TYPES,
  analyzeImageFile,
  assess,
  LEVEL_LABEL,
  suggestionsFor,
  validateSource,
  type RiskAssessment,
} from '../lib/riskScore'

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

/** 指標的顯示名稱與說明（FR-063）。 */
const METRICS: { key: 'brightness' | 'clutter' | 'contrast'; label: string; hint: string }[] = [
  { key: 'brightness', label: '亮度', hint: '過暗或過曝都會扣分' },
  { key: 'clutter', label: '整潔度', hint: '畫面中的雜物越少分數越高' },
  { key: 'contrast', label: '對比', hint: '明暗層次越豐富分數越高' },
]

const LEVEL_CLASS: Record<string, string> = {
  low: 'border-ok/30 bg-ok-soft text-ok',
  medium: 'border-warn/30 bg-warn-soft text-warn',
  high: 'border-danger/30 bg-danger-soft text-danger',
}

function MetricBar({ label, hint, value }: { label: string; hint: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-gap-2">
        <span className="text-small text-ink">{label}</span>
        <span className="font-display text-md tabular-nums text-ink">{value}</span>
      </div>
      {/*
        進度條對讀屏使用者只是一個空的方塊，因此掛上 `progressbar` 的
        完整屬性；數字本身也在畫面上（憲章原則 V）。
      */}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-gap-1 h-2 w-full overflow-hidden rounded-pill bg-surface-alt"
      >
        <div className="h-full rounded-pill bg-brand" style={{ width: `${String(value)}%` }} />
      </div>
      <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>
    </div>
  )
}

export function RiskCheck() {
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<RiskAssessment | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)
  const ids = useId()

  const release = useCallback(() => {
    if (objectUrl.current !== null) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])

  // 離開頁面時釋放。少了它，使用者連續檢測十張照片就有十張留在記憶體裡。
  useEffect(() => release, [release])

  async function analyze(file: File) {
    // ⚠️ **上一次的結果先清掉**，不是等新的算完再蓋上去。連續上傳第二張時，
    // 舊的分數若還留在畫面上，使用者會把它讀成新照片的分數。
    setResult(null)
    setError(null)

    const invalid = validateSource(file)
    if (invalid) {
      // FR-065：拒絕時 MUST 顯示明確錯誤，而不是靜靜地什麼都不做。
      setError(invalid)
      release()
      setPreview(null)
      return
    }

    release()
    const url = URL.createObjectURL(file)
    objectUrl.current = url
    setPreview(url)

    setAnalyzing(true)
    try {
      setResult(assess(await analyzeImageFile(file)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分析失敗，請換一張照片再試一次。')
    } finally {
      setAnalyzing(false)
    }
  }

  const suggestions = result ? suggestionsFor(result) : []

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 text-ink">照片安全檢測</h1>
      <p className="mt-gap-2 text-body text-ink-muted">
        上傳一張房間照片，立刻看到亮度、整潔度與對比三項指標，以及可以怎麼改善。
      </p>

      {/*
        ⚠️ 這句話必須出現在使用者按下「選擇照片」**之前**。上傳完才說「放心，
        我們沒有上傳」是沒有用的——他要的是在交出照片前就知道會發生什麼事。
      */}
      <p
        role="note"
        className="mt-gap-4 rounded-base border border-ok/30 bg-ok-soft px-gap-4 py-gap-3 text-small text-ink"
      >
        <span aria-hidden="true" className="mr-gap-2">
          🔒
        </span>
        您的照片<strong>完全在這個瀏覽器分頁內處理</strong>，不會上傳到我們或任何外部服務，
        也不會被儲存。關閉分頁即消失。
      </p>

      <div className="mt-gap-5">
        <input
          id={`${ids}-file`}
          type="file"
          accept={ACCEPT}
          disabled={analyzing}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void analyze(file)
            // 同一個檔案連續挑兩次時 `change` 不會再觸發，除非清空。
            event.target.value = ''
          }}
        />
        <label
          htmlFor={`${ids}-file`}
          className={[
            'inline-block rounded-pill px-gap-5 py-gap-2 text-small',
            analyzing
              ? 'cursor-not-allowed bg-brand/50 text-ink-invert'
              : 'cursor-pointer bg-brand text-ink-invert hover:bg-brand-strong',
          ].join(' ')}
        >
          {analyzing ? '分析中…' : result ? '換一張照片' : '選擇照片'}
        </label>
        <span className="ml-gap-3 text-tiny text-ink-muted">JPEG、PNG 或 WebP，20 MB 以內</span>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="mt-gap-4 rounded-base border border-danger/30 bg-danger-soft px-gap-4 py-gap-3 text-small text-danger"
        >
          {error}
        </p>
      )}

      {preview !== null && (
        <div className="mt-gap-5 grid gap-gap-5 sm:grid-cols-2">
          <img
            src={preview}
            alt="您上傳的照片預覽"
            className="w-full rounded-base border border-line-soft object-cover"
          />

          <div>
            {/* FR-067：分析期間顯示處理中。`role="status"` 讓讀屏也知道。 */}
            {analyzing && (
              <p role="status" aria-live="polite" className="text-small text-ink-muted">
                分析中，請稍候…
              </p>
            )}

            {result && (
              <>
                <div
                  className={`rounded-base border px-gap-4 py-gap-3 ${LEVEL_CLASS[result.riskLevel] ?? ''}`}
                >
                  <p className="text-small">整體風險評分</p>
                  <p className="font-display text-h1 tabular-nums">
                    {result.riskScore}
                    <span className="ml-gap-2 text-md">{LEVEL_LABEL[result.riskLevel]}</span>
                  </p>
                  <p className="mt-gap-1 text-tiny">分數越高代表越需要改善。</p>
                </div>

                <div className="mt-gap-4 grid gap-gap-3">
                  {METRICS.map((metric) => (
                    <MetricBar
                      key={metric.key}
                      label={metric.label}
                      hint={metric.hint}
                      value={result[metric.key]}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-gap-5">
          <h2 className="font-display text-h3 text-ink">改善建議</h2>
          {suggestions.length === 0 ? (
            <p className="mt-gap-2 text-body text-ink-muted">
              三項指標都不錯，這張照片可以直接使用。
            </p>
          ) : (
            <ul className="mt-gap-2 grid gap-gap-2">
              {suggestions.map((text) => (
                <li
                  key={text}
                  className="rounded-base border border-line-soft bg-surface px-gap-4 py-gap-3 text-body text-ink"
                >
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
