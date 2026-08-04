/**
 * T159 的驗證，兩條各自防著一種不會有人回報的失敗。
 *
 * ## 一、打對端點
 *
 * 「標記已處理」曾經打在 `PATCH /admin/channel-prices/{id}`，而後端把它做成
 * 子資源 `PATCH /admin/channel-prices/{id}/resolved`。少了結尾那一段就是 404，
 * 而**沒有任何測試會失敗**——頁面測試普遍用「未列出的路徑一律回空陣列」的
 * 假後端，一個打錯的路徑在那種假後端底下看起來與成功無異。
 *
 * 因此這裡刻意斷言**實際送出的方法與網址**，而不是只斷言畫面出現成功訊息。
 * 假後端也改成「不認得的路徑一律 404」，讓打錯的那一次直接失敗。
 *
 * ## 二、模擬標示常駐（FR-110）
 *
 * 這一頁的數字看起來就是市場行情，而它們全部來自種子資料。標示若被當成
 * 裝飾而移除，畫面不會有任何異狀——但管理員可能據此調價。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import type { ChannelComparison } from '../../api/types'
import { Channel } from './Channel'

const ROW: ChannelComparison = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  roomId: 'aaaaaaaa-0000-0000-0000-000000000001',
  roomName: '海景雙人房 201',
  channel: 'Booking.com',
  officialPrice: 3200,
  channelPrice: 2880,
  gap: 320,
  gapPercent: 10,
  underpriced: true,
  resolved: false,
  capturedAt: '2026-08-04T02:00:00Z',
  simulated: true,
  simulatedNotice: '模擬資料：此模組不連線至任何外部平台。',
}

/** 送出過的請求，供斷言「打了哪一支端點」。 */
let calls: { method: string; pathname: string }[] = []

function mockApi() {
  calls = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const { pathname } = new URL(raw, 'http://localhost')
    const method = init?.method ?? 'GET'
    calls.push({ method, pathname })

    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    if (method === 'GET' && pathname === '/api/admin/channel-prices') return json([ROW])
    if (method === 'PATCH' && pathname === `/api/admin/channel-prices/${ROW.id}/resolved`) {
      return json({ ...ROW, resolved: true })
    }

    // ⚠️ 不認得的路徑一律 404。回空物件的假後端會讓「打錯端點」看起來像
    // 「端點回了空資料」，而那正是這個檔案要防的那一種錯。
    return json({ detail: `測試未預期的呼叫：${method} ${pathname}`, code: 'NOT_MOCKED' }, 404)
  })
}

function renderChannel() {
  return render(
    <MemoryRouter>
      <Channel />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setToken('fake-token')
  mockApi()
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('標記已處理（FR-113）', () => {
  it('⚠️ 送出的是 PATCH /admin/channel-prices/{id}/resolved', async () => {
    const user = userEvent.setup()
    renderChannel()

    await user.click(await screen.findByRole('button', { name: '標記已處理' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        pathname: `/api/admin/channel-prices/${ROW.id}/resolved`,
      })
    })
    // 成功訊息只是附帶確認：真正的斷言是上面那個網址
    expect(await screen.findByText(/已將「海景雙人房 201．Booking.com」標記為已處理/)).toBeInTheDocument()
  })
})

describe('模擬資料標示（FR-110）', () => {
  it('常駐於資料之前，且用的是後端給的文案', async () => {
    renderChannel()

    expect(await screen.findByText(/模擬資料：此模組不連線至任何外部平台/)).toBeInTheDocument()
  })
})
