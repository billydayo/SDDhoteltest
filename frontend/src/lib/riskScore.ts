/**
 * T145：房源照片的品質分析與風險評分（FR-063 ~ FR-068、FR-104）。
 *
 * ⚠️ **現在只剩後台在用。**
 *
 * 原本這支同時服務兩條路徑：前台自建的照片安全檢測，與後台的房源品質檢測。
 * 憲章 4.0.0 決定前台的檢測不自己架構、改嵌外部系統（`pages/WithinReach.tsx`）
 * 之後，`pages/RiskCheck.tsx` 與守著它的 T144／T144a 兩支隔離測試一併移除。
 *
 * 留下來的是**後台**那半（`pages/admin/RoomRisk.tsx`）：管理員對自家房源的
 * 品質檢測，結果會經後端上傳並公開於房源詳情頁。那是憲章原則 VI 明文允許的
 * 路徑，與已經退場的「使用者私人照片」完全是兩回事。
 *
 * 本模組本身仍然不做任何網路存取——上傳程式在 `RoomRisk.tsx` 自己那裡，
 * 兩者共用「計算」，不共用「上傳」。
 *
 * ## 公式
 *
 *     風險分數 = 100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)
 *
 * 三項指標各 0–100，**100 表示表現較佳**；風險分數則**越高代表風險越高**。
 * 等級：0–34 低／35–59 中／60–100 高（FR-068、SC-016）。
 *
 * 與 `backend/src/sunny/services/risk.py` 是同一條公式的兩份實作。兩份是必要
 * 之惡（一份要即時回饋、一份要當真相），因此**只有純算術那一段被複製**，
 * 影像分析沒有——後端根本不解碼圖片。
 */

// ---------------------------------------------------------------------------
// 評分（純算術。⚠️ MUST 與 services/risk.py 逐位元一致）
// ---------------------------------------------------------------------------

/** 三項指標的權重，總和為 1。以「×100 的整數」保存，見 `riskScore` 的說明。 */
export const WEIGHT_BRIGHTNESS = 40
export const WEIGHT_CLUTTER = 35
export const WEIGHT_CONTRAST = 25

/** 等級切分（FR-068）。**下界含**：34 是低、35 是中、59 是中、60 是高。 */
export const LEVEL_MEDIUM_FROM = 35
export const LEVEL_HIGH_FROM = 60

export const METRIC_MIN = 0
export const METRIC_MAX = 100

export type RiskLevel = 'low' | 'medium' | 'high'

export interface RiskMetrics {
  /** 0–100，越高越好 */
  brightness: number
  clutter: number
  contrast: number
}

export interface RiskAssessment extends RiskMetrics {
  /** 0–100，**越高代表風險越高** */
  riskScore: number
  riskLevel: RiskLevel
}

const clampMetric = (value: number) => Math.max(METRIC_MIN, Math.min(METRIC_MAX, Math.round(value)))

/**
 * 風險分數。
 *
 * ⚠️ **全程整數運算。** 後端用 `Decimal` 是因為 `0.4 + 0.35 + 0.25` 在浮點數
 * 下不精確，而邊界上的一分之差會讓等級跳格。JavaScript 沒有 `Decimal`，
 * 因此改用「權重 ×100 的整數」把小數整個消掉：
 *
 *     加權和×100 = 40×亮度 + 35×雜亂度 + 25×對比      （整數）
 *     分數        = round((10000 − 加權和×100) ÷ 100)  （四捨五入，與 ROUND_HALF_UP 同）
 *
 * 被除數恆為非負整數，因此 `Math.floor(x + 0.5)` 就是 ROUND_HALF_UP，
 * 與 Python 端逐位元一致。用 `0.4 * brightness + …` 則不保證。
 */
export function riskScore(metrics: RiskMetrics): number {
  const brightness = clampMetric(metrics.brightness)
  const clutter = clampMetric(metrics.clutter)
  const contrast = clampMetric(metrics.contrast)

  const weightedTimes100 =
    WEIGHT_BRIGHTNESS * brightness + WEIGHT_CLUTTER * clutter + WEIGHT_CONTRAST * contrast

  return Math.max(METRIC_MIN, Math.min(METRIC_MAX, Math.floor((10000 - weightedTimes100) / 100 + 0.5)))
}

export function levelOf(score: number): RiskLevel {
  if (score >= LEVEL_HIGH_FROM) return 'high'
  if (score >= LEVEL_MEDIUM_FROM) return 'medium'
  return 'low'
}

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: '低風險',
  medium: '中風險',
  high: '高風險',
}

export function assess(metrics: RiskMetrics): RiskAssessment {
  const brightness = clampMetric(metrics.brightness)
  const clutter = clampMetric(metrics.clutter)
  const contrast = clampMetric(metrics.contrast)
  const score = riskScore({ brightness, clutter, contrast })
  return { brightness, clutter, contrast, riskScore: score, riskLevel: levelOf(score) }
}

// ---------------------------------------------------------------------------
// 改善建議（FR-064）
// ---------------------------------------------------------------------------

/** 低於此值的指標會給出具體建議。 */
export const SUGGESTION_BELOW = 60

/**
 * 針對**不合格的那幾項**給建議（FR-064）。
 *
 * 刻意不回「請改善照片品質」這種話：使用者已經知道照片不好了，他需要知道的是
 * 要動哪一件事。每一條都對應一個具體動作，而不是一個形容詞。
 */
export function suggestionsFor(metrics: RiskMetrics): string[] {
  const out: string[] = []
  if (metrics.brightness < SUGGESTION_BELOW) {
    out.push('亮度不足或過曝：建議在白天自然光下重拍，或先打開房內主燈與檯燈再拍一次。')
  }
  if (metrics.clutter < SUGGESTION_BELOW) {
    out.push('畫面雜物偏多：收起個人物品、拉整床鋪與窗簾，讓畫面只留下要展示的空間。')
  }
  if (metrics.contrast < SUGGESTION_BELOW) {
    out.push('明暗層次不足，畫面偏灰：避免正對窗戶逆光，讓窗景入鏡並保留一點陰影。')
  }
  return out
}

// ---------------------------------------------------------------------------
// 影像分析
// ---------------------------------------------------------------------------

/** 分析用的取樣邊長。縮到這個尺寸再算，一張 4000px 的照片才不會讓畫面卡住。 */
export const SAMPLE_EDGE = 320

/** 亮度的理想平均值（0–1）。太暗與過曝都扣分，因此是「偏離多少」而非「越亮越好」。 */
const TARGET_LUMA = 0.55

/** 對比的參考標準差。到達這個值即滿分。 */
const TARGET_STDEV = 0.25

/** 相鄰像素亮度差超過此值即視為一條邊。 */
const EDGE_THRESHOLD = 0.08

/** 邊緣佔比到達此值即視為最雜亂。 */
const MAX_EDGE_RATIO = 0.32

export interface PixelSource {
  /** RGBA，每像素四個位元組（與 `ImageData.data` 相同）。 */
  data: Uint8ClampedArray
  width: number
  height: number
}

const lumaAt = (data: Uint8ClampedArray, index: number) =>
  (0.2126 * (data[index] ?? 0) + 0.7152 * (data[index + 1] ?? 0) + 0.0722 * (data[index + 2] ?? 0)) /
  255

/**
 * 由像素算出三項指標。**純函式，沒有 DOM 也沒有網路。**
 *
 * 分成這一層是為了讓 T143 能直接餵合成的像素進來測——透過 Canvas 才測得到的
 * 公式，實際上等於沒有測。
 */
export function analyzePixels(source: PixelSource): RiskMetrics {
  const { data, width, height } = source
  const total = width * height
  if (total === 0) return { brightness: 0, clutter: 0, contrast: 0 }

  let sum = 0
  let sumSquares = 0
  let edges = 0
  let comparisons = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const luma = lumaAt(data, index)
      sum += luma
      sumSquares += luma * luma

      // 與右方及下方鄰居比較。只比兩個方向就夠了——每一對相鄰像素仍然
      // 恰好被算到一次，而算四個方向只是把同一件事做兩遍。
      if (x + 1 < width) {
        comparisons += 1
        if (Math.abs(luma - lumaAt(data, index + 4)) > EDGE_THRESHOLD) edges += 1
      }
      if (y + 1 < height) {
        comparisons += 1
        if (Math.abs(luma - lumaAt(data, index + width * 4)) > EDGE_THRESHOLD) edges += 1
      }
    }
  }

  const mean = sum / total
  const variance = Math.max(0, sumSquares / total - mean * mean)
  const stdev = Math.sqrt(variance)
  const edgeRatio = comparisons === 0 ? 0 : edges / comparisons

  return {
    // 偏離理想亮度越多扣越多。全黑與全白都會落到 0。
    brightness: clampMetric(100 * (1 - Math.abs(mean - TARGET_LUMA) / TARGET_LUMA)),
    // 邊緣越密＝越雜亂＝分數越低。
    clutter: clampMetric(100 * (1 - Math.min(1, edgeRatio / MAX_EDGE_RATIO))),
    contrast: clampMetric(100 * Math.min(1, stdev / TARGET_STDEV)),
  }
}

/** 來源檔的檢查（FR-065）。回傳給使用者看的中文訊息，或 `null` 代表通過。 */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export function validateSource(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return '僅接受 JPEG、PNG 或 WebP 圖片，請換一個檔案。'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `檔案超過 ${String(Math.round(MAX_IMAGE_BYTES / 1024 / 1024))} MB，請先縮小後再試。`
  }
  return null
}

/**
 * 讀取一張圖片並算出三項指標。
 *
 * ⚠️ **全程在瀏覽器內。** 這裡沒有 `fetch`、沒有 `XMLHttpRequest`、沒有任何
 * 對外的位址（FR-066、SC-015、SC-030）。
 *
 * 分析前先 `await` 一次讓出主執行緒，畫面上的「分析中」才來得及畫出來
 * （FR-067：分析期間畫面 MUST NOT 凍結）。真正的耗時來自像素迴圈，而縮到
 * `SAMPLE_EDGE` 之後那是幾毫秒的事。
 */
export async function analyzeImageFile(file: File): Promise<RiskMetrics> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('無法讀取這張圖片，檔案可能已損毀。')
  })

  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('此瀏覽器不支援圖片分析，請改用其他瀏覽器。')

    ctx.drawImage(bitmap, 0, 0, width, height)
    const image = ctx.getImageData(0, 0, width, height)

    // 讓瀏覽器有機會把「分析中」畫上去再開始跑迴圈。
    await new Promise((resolve) => setTimeout(resolve, 0))

    return analyzePixels({ data: image.data, width, height })
  } finally {
    // 解碼後的位圖佔 寬×高×4 位元組。連續分析多張而不釋放，在行動裝置上
    // 足以讓分頁被系統回收。
    bitmap.close()
  }
}
