import { describe, expect, it } from 'vitest'

import { EMPTY_FILTERS, activeSummary, toSearchParams } from './filters'

describe('toSearchParams', () => {
  it('⚠️ 空字串一律省略，MUST NOT 送出 keyword=', () => {
    // 空字串在 `ILIKE '%%'` 下是「全部符合」——結果看起來正常，
    // 卻是靠巧合正常的。哪天後端改成精確比對就會突然查不到東西。
    expect(toSearchParams(EMPTY_FILTERS)).toEqual({})
  })

  it('數字欄位轉為 number', () => {
    const params = toSearchParams({ ...EMPTY_FILTERS, guestCount: '2', maxPrice: '3000' })
    expect(params).toEqual({ guestCount: 2, maxPrice: 3000 })
  })

  it('關鍵字去除前後空白', () => {
    expect(toSearchParams({ ...EMPTY_FILTERS, keyword: '  海景  ' })).toEqual({ keyword: '海景' })
  })

  it('只有空白的關鍵字等同沒填', () => {
    expect(toSearchParams({ ...EMPTY_FILTERS, keyword: '   ' })).toEqual({})
  })

  it('多值條件原樣帶過，供 client 展開成重複鍵', () => {
    const params = toSearchParams({ ...EMPTY_FILTERS, amenities: ['浴缸', '陽台'] })
    expect(params).toEqual({ amenities: ['浴缸', '陽台'] })
  })
})

describe('activeSummary', () => {
  it('無條件時為空——摘要列與「清除全部條件」都不該出現', () => {
    expect(activeSummary(EMPTY_FILTERS)).toEqual([])
  })

  it('完整日期區間合併為一則，含夜數', () => {
    const summary = activeSummary({
      ...EMPTY_FILTERS,
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
    })
    expect(summary.map((s) => s.label)).toEqual(['2026/12/01 – 2026/12/03（2 晚）'])
  })

  it('⚠️ 只填一半的日期也要列出——那正是他需要被提醒的狀態', () => {
    expect(activeSummary({ ...EMPTY_FILTERS, checkIn: '2026-12-01' }).map((s) => s.label)).toEqual([
      '入住 2026/12/01',
    ])
    expect(activeSummary({ ...EMPTY_FILTERS, checkOut: '2026-12-03' }).map((s) => s.label)).toEqual([
      '退房 2026/12/03',
    ])
  })

  it('勾選的設施與特色逐項列出', () => {
    const summary = activeSummary({
      ...EMPTY_FILTERS,
      amenities: ['浴缸'],
      features: ['採光佳'],
    })
    expect(summary.map((s) => s.label)).toEqual(['浴缸', '採光佳'])
  })
})
