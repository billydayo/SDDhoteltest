/**
 * 上傳前的瀏覽器端縮圖與轉檔（FR-050c）。
 *
 * ⚠️ **MUST NOT 上傳原始檔。** 手機拍的照片動輒 4000×3000、5 MB 以上，而房源
 * 詳情頁最寬也只用到 1600px。直接送原始檔的代價不只是頻寬：後端有大小上限
 * （`max_upload_bytes`），使用者會在選好照片、等了十幾秒之後收到一句「圖片
 * 太大」——而他手上根本沒有縮圖工具。
 *
 * ## ⚠️ 這個模組 MUST NOT 被 `pages/RiskCheck.tsx` 匯入
 *
 * 前台的「安全檢測」是**照片不離開瀏覽器**的功能（FR-086、SC-030），
 * T144 會檢查 `RiskCheck.tsx` 的相依圖中不存在任何上傳模組。本檔雖然自己
 * 不發任何請求，但它存在的目的就是「為上傳做準備」——留在那張相依圖裡，
 * 下一個維護者只要順手接上 `api.admin.photos.upload` 就完成了一次外洩，
 * 而每一步看起來都很合理。
 *
 * 兩條路徑共用的是「以 Canvas 讀像素」這個手法，不是這個模組。
 */

/** 縮圖後的最長邊。房源詳情頁最寬用到約 1600px，再大只是浪費。 */
const MAX_EDGE = 1600

/**
 * JPEG 品質。0.82 是肉眼幾乎看不出差別、檔案卻小上數倍的常見折衷點。
 * 再往下調，房間照片的漸層牆面會開始出現色塊。
 */
const QUALITY = 0.82

/** 轉出的格式。後端只收 jpeg／png／webp，三者中 jpeg 的相容性最好。 */
const OUTPUT_TYPE = 'image/jpeg'

/**
 * 讀進一個圖片檔並取得其像素來源。
 *
 * 優先用 `createImageBitmap`——它在 worker 之外也不阻塞主執行緒解碼。
 * 舊瀏覽器退回 `HTMLImageElement`，並且**一定要 `revokeObjectURL`**：
 * 每張沒有釋放的 object URL 都會讓那份檔案內容留在記憶體裡，
 * 而管理員一次挑八張照片是常態。
 */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file)
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve(img)
      }
      img.onerror = () => {
        reject(new Error('這個檔案不是可讀取的圖片。'))
      }
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 縮圖並轉成 JPEG。回傳一個可直接送出的 `File`。
 *
 * 小於上限的圖片**也會重新編碼**，不是浪費：手機照片帶著 EXIF，裡面可能含
 * 拍攝時的 GPS 座標。這些照片會被公開顯示在房源詳情頁上，而 Canvas 重繪的
 * 產物只有像素，沒有任何原始中繼資料——順手解決了一個沒有人會想到要檢查的
 * 隱私問題。
 *
 * @throws Error 檔案不是圖片，或瀏覽器無法編碼。訊息可直接顯示給使用者。
 */
export async function resizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('請選擇圖片檔（JPG、PNG 或 WebP）。')
  }

  const source = await decode(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('瀏覽器無法處理這張圖片，請改用其他圖片或瀏覽器。')

  // 先鋪白底：JPEG 沒有透明色，PNG 的透明區域直接畫上去會變成黑色。
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, OUTPUT_TYPE, QUALITY)
  })
  if (!blob) throw new Error('圖片轉檔失敗，請再試一次。')

  // 檔名只是給人看的——伺服器會另外產生自己的檔名，不使用客戶端送來的值。
  const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${name}.jpg`, { type: OUTPUT_TYPE })
}
