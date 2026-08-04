/**
 * T143：風險公式與等級切分（FR-068、SC-016）。
 *
 * ## 為什麼要與後端逐位元一致
 *
 * 同一組指標在前後端算出不同的分數時，畫面上顯示的與資料庫存的會不一樣，
 * 而那種不一致**沒有任何錯誤訊息**——只有管理員某天發現「怎麼跟剛剛看到的
 * 不同」。因此邊界值逐一釘住。
 *
 * ## SC-016 的那一條
 *
 * 「過暗、雜亂、正常三類樣本 MUST NOT 全部落在同一等級」。這是整組公式唯一
 * 真正重要的性質：一個把所有照片都判成「中風險」的評分器，程式碼可以完全
 * 正確而功能完全無用，且不會有任何測試失敗——除了這一條。
 */
import { describe, expect, it } from 'vitest'

import {
  analyzePixels,
  assess,
  LEVEL_HIGH_FROM,
  LEVEL_MEDIUM_FROM,
  levelOf,
  riskScore,
  suggestionsFor,
  type PixelSource,
} from './riskScore'

// ---------------------------------------------------------------------------
// 合成樣本
// ---------------------------------------------------------------------------
/**
 * 產生一張測試用的像素圖。
 *
 * `at(x, y)` 回傳 0–255 的灰階值。用灰階是刻意的：三項指標都只看亮度，
 * 用彩色只會讓測試資料更難讀而不會多測到任何東西。
 */
function grayscale(width: number, height: number, at: (x: number, y: number) => number): PixelSource {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const value = at(x, y)
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
      data[index + 3] = 255
    }
  }
  return { data, width, height }
}

/** 過暗：幾乎全黑，只有極輕微的雜訊。 */
const DARK = grayscale(48, 48, (x, y) => 6 + ((x + y) % 3))

/**
 * 雜亂：亮度正常，但每一格都與鄰居差很多（棋盤格）。
 *
 * 這正是「雜物很多」在像素上的樣子——邊緣密度極高。
 */
const CLUTTERED = grayscale(48, 48, (x, y) => ((x + y) % 2 === 0 ? 60 : 200))

/**
 * 正常：亮度落在理想值附近，有柔和的漸層帶出層次，相鄰像素差異小。
 *
 * 漸層每 8 個像素才變 12 階（約 0.047），低於 `EDGE_THRESHOLD` 的 0.08，
 * 因此不會被算成邊。
 */
const NORMAL = grayscale(48, 48, (x, y) => 110 + Math.floor((x + y) / 8) * 12)

// ---------------------------------------------------------------------------
// 公式
// ---------------------------------------------------------------------------
describe('風險分數 = 100 − (0.4×亮度 + 0.35×雜亂度 + 0.25×對比)', () => {
  it('三項滿分時風險為 0', () => {
    expect(riskScore({ brightness: 100, clutter: 100, contrast: 100 })).toBe(0)
  })

  it('三項皆 0 時風險為 100', () => {
    expect(riskScore({ brightness: 0, clutter: 0, contrast: 0 })).toBe(100)
  })

  it('權重確實是 0.4 / 0.35 / 0.25', () => {
    // 只有亮度滿分 → 100 − 40 = 60
    expect(riskScore({ brightness: 100, clutter: 0, contrast: 0 })).toBe(60)
    // 只有雜亂度滿分 → 100 − 35 = 65
    expect(riskScore({ brightness: 0, clutter: 100, contrast: 0 })).toBe(65)
    // 只有對比滿分 → 100 − 25 = 75
    expect(riskScore({ brightness: 0, clutter: 0, contrast: 100 })).toBe(75)
  })

  it('四捨五入採 ROUND_HALF_UP，與後端的 Decimal 一致', () => {
    // 40×50 + 35×50 + 25×50 = 5000 → 100 − 50 = 50，整數，不涉及進位
    expect(riskScore({ brightness: 50, clutter: 50, contrast: 50 })).toBe(50)
    // 40×81 + 35×60 + 25×40 = 6340 → 100 − 63.4 = 36.6 → 37（往上）
    expect(riskScore({ brightness: 81, clutter: 60, contrast: 40 })).toBe(37)
    // 40×70 + 35×70 + 25×72 = 7050 → 100 − 70.5 = 29.5 → **30**
    // ⚠️ 這一行是重點：`.5` 必須往**上**進（ROUND_HALF_UP），與後端的
    // `Decimal(...).quantize(ROUND_HALF_UP)` 相同。JavaScript 的
    // `Math.round` 對正數恰好也是這個行為，但那是巧合而非保證——
    // 這裡釘住的是行為，不是實作。
    expect(riskScore({ brightness: 70, clutter: 70, contrast: 72 })).toBe(30)
  })

  it('超出 0–100 的輸入被夾住，MUST NOT 產生負分或超過 100', () => {
    expect(riskScore({ brightness: 999, clutter: 999, contrast: 999 })).toBe(0)
    expect(riskScore({ brightness: -50, clutter: -50, contrast: -50 })).toBe(100)
  })
})

describe('等級切分 0–34 低／35–59 中／60–100 高', () => {
  it('切分點落在正確的一側', () => {
    expect(levelOf(0)).toBe('low')
    expect(levelOf(LEVEL_MEDIUM_FROM - 1)).toBe('low') // 34
    expect(levelOf(LEVEL_MEDIUM_FROM)).toBe('medium') // 35
    expect(levelOf(LEVEL_HIGH_FROM - 1)).toBe('medium') // 59
    expect(levelOf(LEVEL_HIGH_FROM)).toBe('high') // 60
    expect(levelOf(100)).toBe('high')
  })

  it('assess 一併回傳夾住後的指標與等級', () => {
    expect(assess({ brightness: 120, clutter: 100, contrast: 100 })).toEqual({
      brightness: 100,
      clutter: 100,
      contrast: 100,
      riskScore: 0,
      riskLevel: 'low',
    })
  })
})

// ---------------------------------------------------------------------------
// SC-016
// ---------------------------------------------------------------------------
describe('三類樣本的區辨力（SC-016）', () => {
  const samples = {
    過暗: analyzePixels(DARK),
    雜亂: analyzePixels(CLUTTERED),
    正常: analyzePixels(NORMAL),
  }

  it('過暗的樣本亮度明顯偏低', () => {
    expect(samples.過暗.brightness).toBeLessThan(20)
    expect(samples.正常.brightness).toBeGreaterThan(samples.過暗.brightness)
  })

  it('雜亂的樣本雜亂度明顯偏低（分數越低代表越雜亂）', () => {
    expect(samples.雜亂.clutter).toBeLessThan(20)
    expect(samples.正常.clutter).toBeGreaterThan(samples.雜亂.clutter)
  })

  it('⚠️ 三類樣本 MUST NOT 全部落在同一等級', () => {
    const levels = Object.values(samples).map((metrics) => assess(metrics).riskLevel)
    expect(new Set(levels).size).toBeGreaterThan(1)
  })

  it('過暗與正常的風險分數拉得開', () => {
    // 只差一兩分的話，「這張比較好」在畫面上等於沒有說出任何事。
    expect(riskScore(samples.過暗) - riskScore(samples.正常)).toBeGreaterThan(15)
  })
})

// ---------------------------------------------------------------------------
// 建議
// ---------------------------------------------------------------------------
describe('改善建議只針對不合格的項目（FR-064）', () => {
  it('三項都好時沒有任何建議', () => {
    expect(suggestionsFor({ brightness: 90, clutter: 90, contrast: 90 })).toEqual([])
  })

  it('只有亮度不足時只給亮度的建議', () => {
    const out = suggestionsFor({ brightness: 20, clutter: 90, contrast: 90 })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('亮度')
  })

  it('每一條建議都說得出要做什麼，而不只是形容照片不好', () => {
    const suggestions = suggestionsFor({ brightness: 10, clutter: 10, contrast: 10 })
    expect(suggestions).toHaveLength(3)
    for (const text of suggestions) {
      // 每一條都是「問題：具體做法」。少了冒號後面那一段，使用者知道照片
      // 不好卻不知道要動哪一件事——而他本來就已經知道照片不好了。
      const [problem, action] = text.split('：')
      expect(problem?.length).toBeGreaterThan(3)
      expect(action?.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// 邊界
// ---------------------------------------------------------------------------
describe('analyzePixels 的邊界', () => {
  it('空圖不會除以零', () => {
    expect(analyzePixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toEqual({
      brightness: 0,
      clutter: 0,
      contrast: 0,
    })
  })

  it('單一像素也能算（沒有任何鄰居可比）', () => {
    const metrics = analyzePixels(grayscale(1, 1, () => 140))
    expect(metrics.clutter).toBe(100) // 沒有邊
    expect(metrics.contrast).toBe(0) // 沒有變化
  })
})
