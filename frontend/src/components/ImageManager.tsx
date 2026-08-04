/**
 * T127：房源照片管理（FR-050a ~ FR-050f）。
 *
 * - 上限 **8** 張，**第一張為封面**（FR-050a）
 * - 順序調整與逐張移除（FR-050d）
 * - 本地上傳與圖片網址**可混用**（FR-050b）
 * - ⚠️ **上傳前於瀏覽器內以 Canvas 縮圖轉檔，MUST NOT 上傳原始檔**（FR-050c）
 *
 * ## 為什麼順序調整是按鈕而不是拖曳
 *
 * 拖曳排序對只用鍵盤的人等同於不存在，對讀屏使用者則完全沒有回饋
 * （憲章原則 V）。「上一個／下一個」兩顆按鈕能做到同一件事，而且每一次移動
 * 都能被宣讀。真正需要拖曳時再加上去，但**MUST NOT 只有拖曳**。
 *
 * ## 上傳與掛載是兩件事
 *
 * 上傳只回傳一個路徑，**沒有寫進任何房源**（`services/room_photos.py`）。
 * 要生效必須由父層送出表單。因此本元件把每一次上傳的路徑回報給父層
 * （`onUploaded`），父層才有辦法在使用者按取消時清掉那些檔案（FR-050f）。
 *
 * 反過來做（上傳即掛載）會讓「按取消」變成不可逆——照片已經上去了。
 */
import { useId, useRef, useState } from 'react'

import { api } from '../api/client'
import { ACCEPT_ATTRIBUTE, shrinkForUpload, validateImageFile } from '../lib/image'
import { messageFor } from '../lib/errors'

/** FR-050a。⚠️ 與後端 `RoomWriteIn.images` 的 `max_length=8` 一致。 */
export const MAX_IMAGES = 8

interface ImageManagerProps {
  images: string[]
  onChange: (next: string[]) => void
  /** 每上傳成功一張就回報一次，供父層在取消時清除未保存的檔案（FR-050f）。 */
  onUploaded?: (path: string) => void
  /** 表單送出中時停用，避免一邊儲存一邊改動清單。 */
  disabled?: boolean
}

function move(images: string[], from: number, to: number): string[] {
  if (to < 0 || to >= images.length) return images
  const next = [...images]
  const [item] = next.splice(from, 1)
  if (item === undefined) return images
  next.splice(to, 0, item)
  return next
}

export function ImageManager({ images, onChange, onUploaded, disabled = false }: ImageManagerProps) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const urlFieldId = useId()

  const full = images.length >= MAX_IMAGES
  const remaining = MAX_IMAGES - images.length

  function addUrl() {
    const value = url.trim()
    if (!value) return
    if (full) {
      setNotice(`最多 ${String(MAX_IMAGES)} 張，請先移除一張再新增。`)
      return
    }
    if (images.includes(value)) {
      setNotice('這張圖片已經在清單中了。')
      return
    }
    setNotice(null)
    onChange([...images, value])
    setUrl('')
  }

  async function addFiles(files: FileList) {
    // 超過上限的部分**不靜默丟掉**。使用者一次挑了十張而只進來三張時，
    // 沒有訊息的話他會以為系統壞了（FR-084）。
    const picked = Array.from(files)
    const accepted = picked.slice(0, remaining)
    const messages: string[] = []
    if (picked.length > accepted.length) {
      messages.push(`最多 ${String(MAX_IMAGES)} 張，已略過後面 ${String(picked.length - accepted.length)} 張。`)
    }

    setBusy(true)
    const added: string[] = []
    for (const file of accepted) {
      const invalid = validateImageFile(file)
      if (invalid) {
        messages.push(invalid)
        continue
      }
      try {
        // ⚠️ 先縮圖再上傳。送出去的是 `shrunk`，不是 `file`。
        const shrunk = await shrinkForUpload(file)
        const uploaded = await api.admin.roomPhotos.upload(shrunk)
        added.push(uploaded.path)
        onUploaded?.(uploaded.path)
      } catch (error) {
        messages.push(
          error instanceof Error && !('status' in error)
            ? error.message
            : `「${file.name}」上傳失敗：${messageFor(error).detail}`,
        )
      }
    }
    setBusy(false)
    setNotice(messages.length > 0 ? messages.join('\n') : null)
    if (added.length > 0) onChange([...images, ...added])
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-gap-2">
        <p className="text-small font-medium text-ink">
          房源照片
          <span className="ml-gap-2 font-normal text-ink-muted">
            {images.length} / {MAX_IMAGES} 張
          </span>
        </p>
        <p className="text-tiny text-ink-muted">第一張為封面；上傳前會自動縮圖，不會送出原始檔。</p>
      </div>

      {images.length === 0 ? (
        <p className="mt-gap-3 rounded-base border border-dashed border-line-strong px-gap-4 py-gap-5 text-center text-small text-ink-muted">
          尚未加入任何照片。可以上傳本機圖片，也可以直接貼上圖片網址，兩者能混用。
        </p>
      ) : (
        <ul className="mt-gap-3 grid grid-cols-2 gap-gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <li
              key={image}
              className="overflow-hidden rounded-base border border-line-soft bg-surface"
            >
              <div className="relative">
                {/*
                  `alt` 描述用途而非「圖片」。這些圖之後會出現在房源詳情頁，
                  而編輯畫面是唯一有人會注意到 alt 的地方（憲章原則 V）。
                */}
                <img
                  src={image}
                  alt={index === 0 ? '封面照片預覽' : `第 ${String(index + 1)} 張照片預覽`}
                  className="aspect-4/3 w-full object-cover"
                  loading="lazy"
                />
                {index === 0 && (
                  <span className="absolute top-gap-1 left-gap-1 rounded-pill bg-brand px-gap-2 py-px text-tiny text-ink-invert">
                    封面
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-gap-1 px-gap-2 py-gap-1">
                <div className="flex gap-gap-1">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    onClick={() => {
                      onChange(move(images, index, index - 1))
                    }}
                    className="rounded-xs px-gap-2 py-gap-1 text-tiny text-ink-muted hover:bg-surface-alt disabled:opacity-40"
                    aria-label={`把第 ${String(index + 1)} 張往前移`}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === images.length - 1}
                    onClick={() => {
                      onChange(move(images, index, index + 1))
                    }}
                    className="rounded-xs px-gap-2 py-gap-1 text-tiny text-ink-muted hover:bg-surface-alt disabled:opacity-40"
                    aria-label={`把第 ${String(index + 1)} 張往後移`}
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    // ⚠️ 只從清單移除，**不刪檔**。實際刪除要等表單送出
                    // （FR-050f）——這裡就刪的話，使用者按取消也救不回來。
                    onChange(images.filter((_, i) => i !== index))
                  }}
                  className="rounded-xs px-gap-2 py-gap-1 text-tiny text-danger hover:bg-danger-soft disabled:opacity-40"
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-gap-4 flex flex-wrap items-end gap-gap-3">
        <div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            disabled={disabled || full || busy}
            className="sr-only"
            onChange={(event) => {
              const files = event.target.files
              if (files && files.length > 0) void addFiles(files)
              // 同一個檔案連續挑兩次時 `change` 不會再觸發，除非清空。
              event.target.value = ''
            }}
            id={`${urlFieldId}-file`}
          />
          <label
            htmlFor={`${urlFieldId}-file`}
            aria-disabled={disabled || full || busy}
            className={[
              'inline-block rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small',
              disabled || full || busy
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer text-ink-muted hover:border-brand hover:text-brand-strong',
            ].join(' ')}
          >
            {busy ? '處理中…' : '上傳圖片'}
          </label>
        </div>

        <div className="min-w-56 flex-1">
          <label htmlFor={urlFieldId} className="block text-tiny text-ink-muted">
            或貼上圖片網址
          </label>
          <div className="mt-gap-1 flex gap-gap-2">
            <input
              id={urlFieldId}
              type="url"
              value={url}
              disabled={disabled || full}
              placeholder="https://…"
              onChange={(event) => {
                setUrl(event.target.value)
              }}
              onKeyDown={(event) => {
                // 表單裡按 Enter 預設會送出整張表單。這裡只該加一張圖。
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addUrl()
                }
              }}
              className="min-w-0 flex-1 rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-small"
            />
            <button
              type="button"
              onClick={addUrl}
              disabled={disabled || full || url.trim() === ''}
              className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted hover:border-brand hover:text-brand-strong disabled:opacity-50"
            >
              加入
            </button>
          </div>
        </div>
      </div>

      {full && (
        <p className="mt-gap-2 text-tiny text-ink-muted">
          已達 {MAX_IMAGES} 張上限。要換一張的話請先移除其中一張。
        </p>
      )}

      {/* `role="status"`：訊息在使用者操作之後才出現，讀屏要能知道發生了什麼。 */}
      {notice && (
        <p role="status" className="mt-gap-2 whitespace-pre-line text-small text-danger">
          {notice}
        </p>
      )}
    </div>
  )
}
