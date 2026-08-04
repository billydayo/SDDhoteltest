import { describe, expect, it } from 'vitest'

import { formatAmount, formatTWD, isValidAmount, previewTotal } from './money'

describe('formatTWD', () => {
  it('千分位與幣別前綴', () => {
    expect(formatTWD(12000)).toBe('NT$ 12,000')
    expect(formatTWD(0)).toBe('NT$ 0')
  })

  it('⚠️ MUST NOT 出現小數（FR-070）', () => {
    expect(formatTWD(2999.6)).toBe('NT$ 3,000')
    expect(formatTWD(2999.4)).not.toContain('.')
  })

  it('壞掉的值顯示破折號，MUST NOT 顯示 NaN', () => {
    expect(formatTWD(Number.NaN)).toBe('—')
    expect(formatTWD(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('不帶前綴的版本供表格使用', () => {
    expect(formatAmount(1234567)).toBe('1,234,567')
  })
})

describe('previewTotal', () => {
  it('每晚價格 × 夜數', () => {
    expect(previewTotal(2500, 3)).toBe(7500)
  })

  it('⚠️ 結果必為整數', () => {
    expect(Number.isInteger(previewTotal(3333, 3))).toBe(true)
    expect(previewTotal(3333, 3)).toBe(9999)
  })

  it('夜數為 0 或負數時回 0', () => {
    expect(previewTotal(2500, 0)).toBe(0)
    expect(previewTotal(2500, -2)).toBe(0)
  })

  it('壞掉的輸入回 0，MUST NOT 回 NaN', () => {
    expect(previewTotal(Number.NaN, 3)).toBe(0)
    expect(previewTotal(2500, Number.NaN)).toBe(0)
  })
})

describe('isValidAmount', () => {
  it('只接受非負整數', () => {
    expect(isValidAmount(0)).toBe(true)
    expect(isValidAmount(2500)).toBe(true)
    expect(isValidAmount(2500.5)).toBe(false)
    expect(isValidAmount(-1)).toBe(false)
    expect(isValidAmount('2500')).toBe(false)
    expect(isValidAmount(null)).toBe(false)
  })
})
