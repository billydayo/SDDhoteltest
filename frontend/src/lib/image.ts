/**
 * T127：**上傳前於瀏覽器內縮圖轉檔。MUST NOT 上傳原始檔**（憲章「上傳」條、
 * FR-050c）。
 *
 * ## 為什麼不是「後端會擋，所以前端可以偷懶」
 *
 * 後端的 2 MB 上限（`config.py` 的 `max_upload_bytes`）是**最後一道網**，
 * 不是壓縮的替代品。少了這一步，業者從手機挑一張 8 MB 的原圖會得到一個
 * 「檔案過大」——他能做的只有放棄，或去找一個修圖軟體。而那張圖縮到 1600px
 * 之後只有 200 KB，畫面上完全看不出差別。
 *
 * 附帶的效果是原始檔的 EXIF（含 GPS 座標）不會被送出去：Canvas 重繪只保留
 * 像素。業者用手機拍的房間照片帶著拍攝地點，而那些圖會公開顯示。
 *
 * ## 這裡沒有任何網路呼叫，也不該有
 *
 * 本模組只做「檔案 → 較小的檔案」。上傳由 `api/client.ts` 負責。
 * 前台的安全檢測（US9）會用到同一組 Canvas 操作，但**MUST NOT 觸及上傳**
 * ——照片全程留在瀏覽器內（FR-066、SC-030）。
 */

/** 長邊上限。1600px 在一般螢幕上放大看仍然清楚，而檔案通常落在 200–400 KB。 */
export const MAX_EDGE = 1600

/** JPEG 品質。0.82 是「肉眼看不出差別」與「檔案明顯變小」的常見折衷點。 */
export const JPEG_QUALITY = 0.82

/**
 * 接受的來源類型。
 *
 * ⚠️ **不含 SVG**，與後端 `services/room_photos.py` 一致：它是 XML，
 * 可以內嵌 `<script>`，而這些圖片會被公開顯示於房源詳情頁。
 */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** 來源檔的大小上限。壓縮之後才送出，因此這裡可以比後端寬鬆得多。 */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024

export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',')

/**
 * 檔案能不能處理。**回傳給使用者看的中文訊息，或 `null` 代表通過。**
 *
 * 不丟例外：這是預期中的使用者輸入錯誤，不是程式錯誤。丟例外會誘使呼叫端
 * 用 try/catch 把它和「壓縮失敗」混在一起，而那兩件事該顯示不同的話。
 */
export function validateImageFile(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return `僅接受 JPEG、PNG 或 WebP 圖片，「${file.name}」不是這些格式。`
  }
  if (file.size > MAX_SOURCE_BYTES) {
    const mb = Math.round(MAX_SOURCE_BYTES / 1024 / 1024)
    return `「${file.name}」超過 ${String(mb)} MB，請先縮小後再試。`
  }
  return null
}

/** 等比例縮到長邊不超過 `maxEdge`。已經夠小的圖不放大。 */
function fit(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * 縮圖並轉為 JPEG。回傳可直接上傳的 `Blob`。
 *
 * 失敗時丟出帶有中文訊息的 `Error`——瀏覽器不支援、圖片損毀、記憶體不足都
 * 可能發生，而「什麼都沒發生」是最糟的表現方式（FR-084 禁止靜默失敗）。
 */
export async function shrinkForUpload(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`無法讀取「${file.name}」，檔案可能已損毀。`)
  })

  try {
    const size = fit(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('此瀏覽器不支援圖片處理，請改用其他瀏覽器。')
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('圖片壓縮失敗，請再試一次。'))
        },
        'image/jpeg',
        JPEG_QUALITY,
      )
    })
  } finally {
    // 位圖佔的是解碼後的記憶體（寬 × 高 × 4 位元組）。連續處理八張 4000px
    // 的照片而不釋放，在行動裝置上足以讓分頁被系統回收。
    bitmap.close()
  }
}
