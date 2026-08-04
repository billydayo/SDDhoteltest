/**
 * T142：首頁內容編輯（FR-061）。
 *
 * ## 三個欄位一起送，不是部分更新
 *
 * 後端的 `SiteContentIn` 三個欄位皆必填（`schemas/content.py`）。做成部分更新
 * 會讓「清空副標」與「不動副標」在傳輸層變成同一件事——而使用者按下儲存後
 * 副標還在，他會再清一次，再存一次。
 *
 * ## 所見即所得的預覽
 *
 * 下方直接掛真正的 `HomeHero`，不是另外做一個「大概長這樣」的示意圖。
 * 示意圖遲早會與真的不一樣，而發現的方式是使用者存檔後回到前台發現不對。
 *
 * ## 主圖的兩段式上傳（FR-061）
 *
 * 上傳只回傳路徑，尚未生效；要真正套用必須按下儲存。因此離開前未儲存的
 * 上傳檔要清掉——與房源照片同一套機制（`services/room_photos.py`）。
 */
import { useCallback, useEffect, useId, useState } from 'react'

import { api } from '../../api/client'
import type { SiteContent } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { HomeHero } from '../../components/HomeHero'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import { ACCEPT_ATTRIBUTE, shrinkForUpload, validateImageFile } from '../../lib/image'
import { panelClass } from '../../lib/surfaces'
import {
  buttonClass,
  Field,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
} from './ui'

export function Content() {
  const load = useCallback((signal: AbortSignal) => api.admin.siteContent.get(signal), [])
  const { status, data, error, reload } = useAsync<SiteContent>(load)

  const [heroTitle, setHeroTitle] = useState('')
  const [heroSubtitle, setHeroSubtitle] = useState('')
  const [heroImage, setHeroImage] = useState('')
  /** 本次上傳但尚未儲存的路徑。⚠️ 沒有它就無法在離開時清乾淨。 */
  const [uploaded, setUploaded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const ids = useId()

  useEffect(() => {
    if (!data) return
    setHeroTitle(data.heroTitle)
    setHeroSubtitle(data.heroSubtitle)
    setHeroImage(data.heroImage)
  }, [data])

  function discard(paths: string[]) {
    // 清理失敗不擋住使用者。留下一個沒有人引用的檔案是小問題，卡住是大問題。
    for (const path of paths) {
      void api.admin.roomPhotos.discard(path).catch(() => undefined)
    }
  }

  async function upload(file: File) {
    const invalid = validateImageFile(file)
    if (invalid) {
      setFailure(invalid)
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      // ⚠️ 先於瀏覽器內縮圖，MUST NOT 上傳原始檔（憲章「上傳」條）。
      const result = await api.admin.siteContent.uploadHeroImage(await shrinkForUpload(file))
      setUploaded((prev) => [...prev, result.path])
      setHeroImage(result.path)
      setMessage('主圖已上傳，按下「儲存」後才會套用到前台。')
    } catch (cause) {
      setFailure(cause instanceof Error && !('status' in cause) ? cause.message : messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    setFailure(null)
    try {
      await api.admin.siteContent.update({ heroTitle, heroSubtitle, heroImage })
      // 上傳了但最後沒被採用的那些，儲存成功後就沒有人會引用了。
      discard(uploaded.filter((path) => path !== heroImage))
      setUploaded([])
      setMessage('已更新首頁內容。回到前台即可看到。')
      reload()
    } catch (cause) {
      // ⚠️ 已填內容 MUST 保留（FR-083）。
      setFailure(messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'error') return <ErrorState error={error} onRetry={reload} />
  if (!data) return <LoadingState label="載入首頁內容…" />

  const dirty =
    heroTitle !== data.heroTitle ||
    heroSubtitle !== data.heroSubtitle ||
    heroImage !== data.heroImage

  const preview: SiteContent = { ...data, heroTitle, heroSubtitle, heroImage }

  return (
    <div>
      <ModuleHeading title="內容編輯" />

      <section className={`mt-gap-4 ${panelClass} p-gap-4`}>
        <div className="grid gap-gap-3">
          <Field label="主標題" htmlFor={`${ids}-title`} className="w-full">
            <input
              id={`${ids}-title`}
              required
              maxLength={120}
              value={heroTitle}
              onChange={(e) => {
                setHeroTitle(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
          <Field
            label="副標題"
            htmlFor={`${ids}-subtitle`}
            className="w-full"
            hint="留空即為不顯示副標"
          >
            <input
              id={`${ids}-subtitle`}
              maxLength={200}
              value={heroSubtitle}
              onChange={(e) => {
                setHeroSubtitle(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
          <Field
            label="主視覺圖片"
            htmlFor={`${ids}-image`}
            className="w-full"
            hint="可貼上外部圖片網址，或於下方上傳。留空即以純色底呈現。"
          >
            <input
              id={`${ids}-image`}
              type="text"
              maxLength={2000}
              value={heroImage}
              placeholder="https://… 或 /uploads/…"
              onChange={(e) => {
                setHeroImage(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-gap-3 flex flex-wrap items-center gap-gap-3">
          <input
            id={`${ids}-file`}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
          <label
            htmlFor={`${ids}-file`}
            className={[
              'inline-block rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small',
              busy
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer text-ink-muted hover:border-brand hover:text-brand-strong',
            ].join(' ')}
          >
            {busy ? '處理中…' : '上傳主圖'}
          </label>
          {heroImage !== '' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setHeroImage('')
              }}
              className={buttonClass}
            >
              不使用主圖
            </button>
          )}
        </div>

        {message !== null && <Notice tone="ok">{message}</Notice>}
        {failure !== null && <Notice tone="danger">{failure}</Notice>}

        <div className="mt-gap-4 flex gap-gap-2">
          <button
            type="button"
            disabled={busy || !dirty || heroTitle.trim() === ''}
            onClick={() => {
              void save()
            }}
            className={primaryButtonClass}
          >
            {busy ? '儲存中…' : '儲存'}
          </button>
          {dirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                discard(uploaded)
                setUploaded([])
                setHeroTitle(data.heroTitle)
                setHeroSubtitle(data.heroSubtitle)
                setHeroImage(data.heroImage)
                setMessage(null)
                setFailure(null)
              }}
              className={buttonClass}
            >
              放棄變更
            </button>
          )}
        </div>
      </section>

      <h3 className="mt-gap-6 text-md text-ink">預覽</h3>
      <p className="mt-gap-1 text-small text-ink-muted">
        以下是前台實際會渲染的元件，不是示意圖。
      </p>
      {/* `overflow-hidden` 把破出視窗寬度的主視覺收在預覽框內，
          否則這一塊會在後台頁面上真的滿版。 */}
      <div className="mt-gap-3 overflow-hidden rounded-base border border-line-soft">
        <HomeHero content={preview} />
      </div>
    </div>
  )
}
