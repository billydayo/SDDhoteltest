/**
 * T127：房源照片管理（FR-050a ~ FR-050f）。
 *
 * ## 五條規則
 *
 * 1. **上限 8 張**（FR-050a）。達上限時新增入口停用並說明，而不是讓他選完
 *    八張以外的第九張、上傳完才被拒絕。
 * 2. **第一張是封面**（FR-050a）。因此順序不是排版偏好，是有語意的——
 *    調整順序的按鈕不可省。
 * 3. **本地上傳與圖片網址可混用**（FR-050b）。同一間房源裡兩種來源並存是
 *    正常狀態，不是要被正規化掉的東西。
 * 4. **上傳前於瀏覽器內縮圖轉檔**（FR-050c），見 `lib/image.ts`。
 * 5. **取消編輯時，本次已上傳但未保存的檔案 MUST 被清除**（FR-050f）。
 *    因此本元件回報 `uploadedPaths`——呼叫端在使用者按取消時據此呼叫
 *    `api.admin.photos.discard`。反過來，**移除既有照片不在這裡刪檔**：
 *    那要等表單真的送出後由後端執行，否則使用者按下取消、照片卻已經沒了。
 *
 * ## 為什麼順序調整是按鈕而不是拖曳
 *
 * 拖曳排序對只用鍵盤的人等同於不存在，對讀屏使用者也沒有可操作的對應
 * （憲章原則 V、T171）。「上移／下移」兩顆按鈕看起來土，但每個人都用得了。
 */
import { useId, useState } from 'react'

import { api } from '../api/client'
import { messageFor } from '../lib/errors'
import { inputClass } from '../lib/form'
import { resizeImageFile } from '../lib/image'

/** FR-050a。與後端 `RoomWriteIn.images` 的 `max_length=8` 對齊。 */
export const MAX_IMAGES = 8

interface ImageManagerProps {
  images: string[]
  onChange: (next: string[]) => void
  /**
   * 本次編輯期間上傳到伺服器的路徑。
   *
   * ⚠️ 呼叫端 MUST 在「取消」時把這些路徑交給 `api.admin.photos.discard`，
   * 否則每一次「上傳完又反悔」都會在儲存空間留下一個沒有人引用的檔案，
   * 而那種垃圾不會有任何症狀——直到磁碟滿了為止（FR-050f）。
   */
  onUploaded: (path: string) => void
}

export function ImageManager({ images, onChange, onUploaded }: ImageManagerProps) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputId = useId()
  const urlInputId = useId()

  const full = images.length >= MAX_IMAGES
  const remaining = MAX_IMAGES - images.length

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= images.length) return
    const next = [...images]
    const [item] = next.splice(index, 1)
    // `splice` 的回傳一定有一個元素（index 已檢查過），但型別是 `T | undefined`
    if (item !== undefined) next.splice(target, 0, item)
    onChange(next)
  }

  function remove(index: number) {
    onChange(images.filter((_, i) => i !== index))
  }

  function addUrl() {
    const trimmed = url.trim()
    if (!trimmed) return
    if (full) return
    if (images.includes(trimmed)) {
      setError('這張圖片已經在清單中了。')
      return
    }
    setError(null)
    onChange([...images, trimmed])
    setUrl('')
  }

  /**
   * 逐張處理選取的檔案。
   *
   * 刻意**序列**而非 `Promise.all`：八張手機照片同時解碼會讓低階裝置的分頁
   * 直接失去回應。逐張處理慢一點，但每一張完成就立刻出現在清單上，
   * 使用者看得到進度。
   */
  async function addFiles(files: FileList) {
    setBusy(true)
    setError(null)
    const accepted: string[] = []

    try {
      for (const file of Array.from(files)) {
        if (images.length + accepted.length >= MAX_IMAGES) {
          setError(`最多 ${String(MAX_IMAGES)} 張，其餘檔案未加入。`)
          break
        }
        // ⚠️ MUST NOT 上傳原始檔（FR-050c）
        const resized = await resizeImageFile(file)
        const uploaded = await api.admin.photos.upload(resized)
        accepted.push(uploaded.path)
        onUploaded(uploaded.path)
      }
    } catch (cause) {
      // 已經成功的那幾張留著——把它們一起丟掉，使用者得重選一次全部
      setError(cause instanceof Error ? cause.message : messageFor(cause).detail)
    } finally {
      if (accepted.length > 0) onChange([...images, ...accepted])
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-gap-2 flex flex-wrap items-baseline justify-between gap-gap-2">
        <span className="text-small text-ink-muted">
          照片（{images.length}/{MAX_IMAGES}）
        </span>
        <span className="text-tiny text-ink-muted">第一張為封面，會用於房源列表與卡片。</span>
      </div>

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-gap-4 text-center text-small text-ink-muted">
          尚未加入照片。可上傳本機檔案或填入圖片網址，兩種來源可以混用。
        </p>
      ) : (
        <ul className="grid gap-gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {images.map((src, index) => (
            <li
              key={src}
              className="overflow-hidden rounded-lg border border-line-soft bg-surface"
            >
              <div className="relative">
                <img
                  src={src}
                  // 照片本身是裝飾以外的內容，但它沒有可靠的描述來源。
                  // 以位置命名至少讓讀屏使用者知道自己在操作第幾張。
                  alt={`房源照片 ${String(index + 1)}`}
                  className="h-32 w-full bg-surface-alt object-cover"
                />
                {index === 0 && (
                  <span className="absolute top-gap-1 left-gap-1 rounded-pill bg-brand px-gap-2 py-gap-1 text-tiny text-ink-invert">
                    封面
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-gap-1 p-gap-2">
                <div className="flex gap-gap-1">
                  <IconButton
                    label={`將第 ${String(index + 1)} 張往前移`}
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1)
                    }}
                  >
                    ←
                  </IconButton>
                  <IconButton
                    label={`將第 ${String(index + 1)} 張往後移`}
                    disabled={index === images.length - 1}
                    onClick={() => {
                      move(index, 1)
                    }}
                  >
                    →
                  </IconButton>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    remove(index)
                  }}
                  className="rounded-xs px-gap-2 py-gap-1 text-tiny text-danger transition-colors hover:bg-danger-soft"
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-gap-4 grid gap-gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fileInputId} className="mb-gap-1 block text-tiny text-ink-muted">
            從本機上傳
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={full || busy}
            onChange={(e) => {
              const files = e.target.files
              if (files && files.length > 0) void addFiles(files)
              // 清空 value：不清的話，移除照片後再選同一個檔案不會觸發 change
              e.target.value = ''
            }}
            className="w-full text-small text-ink-muted file:mr-gap-3 file:rounded-pill file:border-0 file:bg-surface-alt file:px-gap-3 file:py-gap-1 file:text-small file:text-ink"
          />
          <p className="mt-gap-1 text-tiny text-ink-muted">
            {busy
              ? '處理中…上傳前會先在瀏覽器內縮圖。'
              : full
                ? `已達 ${String(MAX_IMAGES)} 張上限。`
                : `還可加入 ${String(remaining)} 張。上傳前會先在瀏覽器內縮圖。`}
          </p>
        </div>

        <div>
          <label htmlFor={urlInputId} className="mb-gap-1 block text-tiny text-ink-muted">
            或填入圖片網址
          </label>
          <div className="flex gap-gap-2">
            <input
              id={urlInputId}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
              }}
              disabled={full}
              placeholder="https://example.com/room.jpg"
              className={inputClass}
            />
            <button
              type="button"
              onClick={addUrl}
              disabled={full || url.trim() === ''}
              className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small whitespace-nowrap text-ink-muted transition-colors hover:border-brand hover:text-brand-strong disabled:opacity-50"
            >
              加入
            </button>
          </div>
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="mt-gap-2 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      // 箭頭符號對讀屏使用者念不出意義，實際的說明放在 aria-label
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-xs border border-line-strong px-gap-2 py-gap-1 text-tiny text-ink-muted transition-colors hover:border-brand hover:text-brand-strong disabled:opacity-30"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}
