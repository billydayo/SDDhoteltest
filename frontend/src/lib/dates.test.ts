/**
 * T044 的驗證（plan.md「前端不得時區位移 → Vitest」）。
 *
 * ⚠️ 這些測試的期望值一律**寫死字串**，MUST NOT 用 `new Date(str)` 產生。
 * 若期望值也用同一個有問題的建構式算出來，兩邊會一起錯，測試全綠。
 */
import { describe, expect, it } from 'vitest'

import {
  addDays,
  compareCalendarDates,
  formatDisplayDate,
  formatStay,
  isCalendarDate,
  nightsBetween,
  parseCalendarDate,
  secondsUntil,
  today,
  tomorrow,
} from './dates'

describe('parseCalendarDate', () => {
  it('解析補零的合法日期', () => {
    expect(parseCalendarDate('2026-08-04')).toEqual({ year: 2026, month: 8, day: 4 })
  })

  it('⚠️ 不做 UTC 位移——8/04 就是 8/04', () => {
    // `new Date('2026-08-04').getDate()` 在台北是 3。這正是本模組存在的理由。
    expect(parseCalendarDate('2026-08-04')?.day).toBe(4)
  })

  it.each(['2026-8-4', '2026-08-4', '26-08-04', '20260804', '2026/08/04', ''])(
    '拒絕非 YYYY-MM-DD 的形式：%s',
    (bad) => {
      expect(parseCalendarDate(bad)).toBeNull()
    },
  )

  it('拒絕不存在的日期', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull()
    expect(parseCalendarDate('2026-13-01')).toBeNull()
  })

  it('接受閏年的 2/29，拒絕平年的', () => {
    expect(parseCalendarDate('2028-02-29')).not.toBeNull()
    expect(parseCalendarDate('2026-02-29')).toBeNull()
  })

  it('isCalendarDate 與之一致', () => {
    expect(isCalendarDate('2026-08-04')).toBe(true)
    expect(isCalendarDate('2026-8-4')).toBe(false)
  })
})

describe('nightsBetween', () => {
  it('單晚', () => {
    expect(nightsBetween('2026-08-01', '2026-08-02')).toBe(1)
  })

  it('退房當日不計為一晚', () => {
    expect(nightsBetween('2026-08-01', '2026-08-03')).toBe(2)
  })

  it('跨月', () => {
    expect(nightsBetween('2026-08-30', '2026-09-02')).toBe(3)
  })

  it('跨年', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3)
  })

  it('跨閏日', () => {
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('相同日期為 0 晚', () => {
    expect(nightsBetween('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('⚠️ 跨越多數時區的日光節約切換點仍為整數天', () => {
    // 美國 2026 年 3/8 進入 DST、11/1 結束。用本地時間相減會出現 23 或 25
    // 小時的一天，除以 86400000 後就不是整數——夜數會少一晚或多一晚。
    expect(nightsBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(nightsBetween('2026-10-31', '2026-11-02')).toBe(2)
    // 歐洲的切換點在 3/29 與 10/25
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('addDays', () => {
  it('跨月', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('往回', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('輸入非法時原樣回傳，不假裝算出了什麼', () => {
    expect(addDays('2026-8-4', 1)).toBe('2026-8-4')
  })
})

describe('today / tomorrow', () => {
  it('用本地的年月日欄位，不做 UTC 位移', () => {
    // 台北時間 2026-08-04 早上 8 點；UTC 仍是 8/04 的凌晨 0 點。
    const morning = new Date(2026, 7, 4, 8, 0, 0)
    expect(today(morning)).toBe('2026-08-04')
  })

  it('⚠️ 深夜也不會退成前一天', () => {
    // 台北 23:30 時 UTC 已是 15:30 的同一天，但若誤用 toISOString() 取日期，
    // 台北 08:00 之前的時段會退成前一天。這裡固定用本地欄位。
    const lateNight = new Date(2026, 7, 4, 23, 30, 0)
    expect(today(lateNight)).toBe('2026-08-04')
    const earlyMorning = new Date(2026, 7, 4, 0, 30, 0)
    expect(today(earlyMorning)).toBe('2026-08-04')
  })

  it('tomorrow 為今天加一天', () => {
    expect(tomorrow(new Date(2026, 11, 31, 12, 0, 0))).toBe('2027-01-01')
  })
})

describe('compareCalendarDates', () => {
  it('補零之後字典序與日期序一致', () => {
    expect(compareCalendarDates('2026-08-04', '2026-08-05')).toBe(-1)
    expect(compareCalendarDates('2026-09-01', '2026-08-31')).toBe(1)
    expect(compareCalendarDates('2026-08-04', '2026-08-04')).toBe(0)
  })

  it('排序整串日期', () => {
    const sorted = ['2026-08-10', '2026-08-04', '2026-12-01', '2026-08-05'].sort(
      compareCalendarDates,
    )
    expect(sorted).toEqual(['2026-08-04', '2026-08-05', '2026-08-10', '2026-12-01'])
  })
})

describe('顯示格式', () => {
  it('全站一致的日期格式', () => {
    expect(formatDisplayDate('2026-08-04')).toBe('2026/08/04')
  })

  it('非法輸入原樣顯示，MUST NOT 顯示 Invalid Date', () => {
    expect(formatDisplayDate('壞掉的值')).toBe('壞掉的值')
  })

  it('住宿區間含夜數', () => {
    expect(formatStay('2026-08-04', '2026-08-06')).toBe('2026/08/04 – 2026/08/06（2 晚）')
  })
})

describe('secondsUntil', () => {
  it('計算剩餘秒數', () => {
    const now = new Date('2026-08-04T10:00:00Z')
    expect(secondsUntil('2026-08-04T10:01:30Z', now)).toBe(90)
  })

  it('已過期為 0，MUST NOT 為負數', () => {
    const now = new Date('2026-08-04T10:00:00Z')
    expect(secondsUntil('2026-08-04T09:00:00Z', now)).toBe(0)
  })
})
