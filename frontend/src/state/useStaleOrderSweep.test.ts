/**
 * T093a 的驗證（FR-099a）。
 *
 * 三條約束各對應一種擾民，而三者的症狀都很安靜：打太密只是後端多花錢，
 * 背景分頁不停就是使用者的電池慢慢少，表單頁被觸發則是他打到一半的字消失。
 * 沒有一項會拋錯，所以只能靠測試盯著。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockApi } from '../test/mockApi'
import { SWEEP_INTERVAL_MS, useStaleOrderSweep } from './useStaleOrderSweep'

/** 改寫 `document.hidden`——jsdom 預設是 `false` 且唯讀。 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

let calls: { method: string; path: string; body: unknown }[]

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  mockApi({ calls })
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const sweeps = () => calls.filter((c) => c.method === 'GET' && c.path.endsWith('/rooms')).length

describe('節流', () => {
  it('每分鐘至多一次', async () => {
    renderHook(() => {
      useStaleOrderSweep({ enabled: true })
    })

    // 掛載當下不打——使用者剛進頁面，資料本來就是新的
    expect(sweeps()).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    })
    expect(sweeps()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3)
    })
    expect(sweeps()).toBe(4)
  })

  it('切回分頁時會補一次，但不會在剛跑完之後又多跑一次', async () => {
    renderHook(() => {
      useStaleOrderSweep({ enabled: true })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    })
    expect(sweeps()).toBe(1)

    // 剛跑完就切走再切回——⚠️ 節流依**實際經過的時間**，所以這裡不該再打一次
    await act(async () => {
      setHidden(true)
      setHidden(false)
      await Promise.resolve()
    })
    expect(sweeps()).toBe(1)
  })
})

describe('分頁不可見時暫停', () => {
  it('隱藏期間完全不打 API', async () => {
    renderHook(() => {
      useStaleOrderSweep({ enabled: true })
    })

    act(() => {
      setHidden(true)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 5)
    })
    expect(sweeps()).toBe(0)

    // 回到前景就該補上——離開期間逾期的訂單，回來要看到已釋出
    await act(async () => {
      setHidden(false)
      await Promise.resolve()
    })
    expect(sweeps()).toBe(1)
  })
})

describe('表單頁 MUST 抑制', () => {
  it('`enabled: false` 時一次都不打', async () => {
    renderHook(() => {
      useStaleOrderSweep({ enabled: false })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 10)
    })
    expect(sweeps()).toBe(0)
  })

  it('卸載後不再打——換頁時計時器 MUST 被清掉', async () => {
    const { unmount } = renderHook(() => {
      useStaleOrderSweep({ enabled: true })
    })

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 5)
    })
    expect(sweeps()).toBe(0)
  })
})

describe('回呼', () => {
  it('清理完成後通知呼叫端', async () => {
    const onSwept = vi.fn()
    renderHook(() => {
      useStaleOrderSweep({ enabled: true, onSwept })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    })
    expect(onSwept).toHaveBeenCalledTimes(1)
  })

  it('每次繪製給一個新的回呼實體，MUST NOT 因此重設計時器', async () => {
    // 重設的症狀是「輪詢再也不會觸發」——不會報錯，只是那個功能安靜地沒了
    const { rerender } = renderHook(() => {
      useStaleOrderSweep({
        enabled: true,
        onSwept: () => {
          /* 每次都是新的函式實體 */
        },
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS / 2)
    })
    rerender()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS / 2)
    })

    expect(sweeps()).toBe(1)
  })

  it('清理失敗時不拋出，也不打擾使用者', async () => {
    calls.length = 0
    mockApi({ calls, onRooms: () => ({ status: 500, body: { detail: '壞了。', code: 'X' } }) })
    const onSwept = vi.fn()
    renderHook(() => {
      useStaleOrderSweep({ enabled: true, onSwept })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    })
    expect(sweeps()).toBe(1)
    expect(onSwept).not.toHaveBeenCalled()
  })
})
