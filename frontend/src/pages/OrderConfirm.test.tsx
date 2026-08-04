/**
 * T091／T092 的驗證（FR-030、FR-031、FR-032、FR-099、FR-100、FR-102）。
 *
 * FR-031 列了七項必須出現的內容。這裡逐項斷言而不是抓一個容器看它「有東西」——
 * 少列一項不會讓畫面壞掉，只會讓使用者查不到自己訂了幾晚。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import type { Order } from '../api/types'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeOrder, makeRoomDetail, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { OrderConfirm } from './OrderConfirm'
import type { OrderConfirmState } from './OrderConfirm'

function renderConfirm(order: Order | null, options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, ...options })
  const room = makeRoomDetail()
  const id = order?.id ?? 'bbbbbbbb-0000-0000-0000-000000000001'
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: `/orders/${id}/confirmed`,
          state: order ? ({ order, room } satisfies OrderConfirmState) : null,
        },
      ]}
    >
      <AuthProvider>
        <Routes>
          <Route path="/orders/:orderId/confirmed" element={<OrderConfirm />} />
          <Route path="/orders" element={<div>我的訂單</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('FR-031 的七項內容', () => {
  it('顯示訂單編號、房源、日期、夜數、人數、付款方式與總金額', async () => {
    renderConfirm(makeOrder())

    expect(await screen.findByText('SN20260804001')).toBeInTheDocument()
    expect(screen.getByText('海景雙人房 201')).toBeInTheDocument()
    expect(screen.getByText('2026/09/01 – 2026/09/03（2 晚）')).toBeInTheDocument()
    expect(screen.getByText('2 晚')).toBeInTheDocument()
    expect(screen.getByText('2 人')).toBeInTheDocument()
    expect(screen.getByText('LINE Pay')).toBeInTheDocument()
    expect(screen.getByText('NT$ 6,400')).toBeInTheDocument()
  })

  it('金額取自訂單上凍結的值，不是房價乘夜數（FR-032）', async () => {
    // 訂單成立後房價漲到 5000，但這一筆仍是當初的 6400
    renderConfirm(makeOrder(), { roomDetail: makeRoomDetail({ nightlyPrice: 5000 }) })

    expect(await screen.findByText('NT$ 6,400')).toBeInTheDocument()
    expect(screen.queryByText('NT$ 10,000')).not.toBeInTheDocument()
  })
})

describe('剩餘付款時間（FR-102）', () => {
  it('待付款訂單顯示倒數', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    renderConfirm(makeOrder({ expiresAt }))

    const timer = await screen.findByRole('timer')
    expect(timer.textContent).toMatch(/^(29|30):\d{2}$/)
  })

  it('已到期時說「付款時間已過」，且 MUST NOT 自行把訂單改寫成已取消', async () => {
    renderConfirm(makeOrder({ expiresAt: '2020-01-01T00:00:00Z' }))

    expect(await screen.findByText(/付款時間已過/)).toBeInTheDocument()
    // 狀態仍是後端給的那個。前端改寫的話，使用者重整後又會看到待付款
    expect(screen.getByText('待付款')).toBeInTheDocument()
    expect(screen.queryByText('已取消')).not.toBeInTheDocument()
    // 逾期後不該還能按付款——按下去只會拿到一個 409
    expect(screen.getByRole('button', { name: /模擬付款/ })).toBeDisabled()
  })

  it('已確認的訂單不顯示倒數', async () => {
    renderConfirm(makeOrder({ status: 'confirmed' }))

    expect(await screen.findByText('已確認')).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /模擬付款/ })).not.toBeInTheDocument()
  })
})

describe('模擬付款（FR-028、FR-029、FR-100）', () => {
  it('付款成功後狀態轉為已確認', async () => {
    const user = userEvent.setup()
    renderConfirm(makeOrder(), {
      onOrderPay: () => makeOrder({ status: 'confirmed' }),
    })

    await user.click(await screen.findByRole('button', { name: '完成模擬付款' }))

    expect(await screen.findByText('已確認')).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('付款畫面上沒有任何要求真實支付資料的欄位（FR-028）', async () => {
    renderConfirm(makeOrder())
    await screen.findByText('SN20260804001')

    expect(document.body.querySelectorAll('input, textarea, select')).toHaveLength(0)
    expect(screen.getByText(/不會產生任何實際交易/)).toBeInTheDocument()
  })

  it('逾期付款被拒時，原樣轉達後端的理由（FR-100）', async () => {
    const user = userEvent.setup()
    renderConfirm(makeOrder(), {
      onOrderPay: () => ({
        status: 409,
        body: {
          detail: '此訂單的付款時間已過並已自動取消，所選日期可能已被其他人預訂，請重新查詢。',
          code: 'ORDER_EXPIRED',
        },
      }),
    })

    await user.click(await screen.findByRole('button', { name: '完成模擬付款' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '所選日期可能已被其他人預訂',
    )
    // ⚠️ 失敗後 MUST NOT 自行把訂單畫成已確認
    expect(screen.getByText('待付款')).toBeInTheDocument()
  })

  it('付款失敗後仍停在這一頁，訂單編號不會消失', async () => {
    const user = userEvent.setup()
    renderConfirm(makeOrder(), {
      onOrderPay: () => ({ status: 500, body: { detail: '系統忙碌中。', code: 'INTERNAL' } }),
    })

    await user.click(await screen.findByRole('button', { name: '完成模擬付款' }))
    await screen.findByRole('alert')

    expect(screen.getByText('SN20260804001')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '完成模擬付款' })).toBeEnabled()
    })
  })
})

describe('重新整理（沒有 location state）', () => {
  /**
   * ⚠️ 這一支測的是「不要嚇到使用者」。
   *
   * 訂單其實建立成功了，只是這一頁沒有 `GET /orders/{id}` 可以再查一次
   * （T098 尚未實作）。顯示成錯誤會讓他回頭再訂一次，然後撞上自己剛佔走的
   * 房況——那時他會以為系統壞了兩次。
   */
  it('明確說明訂單已成立，並指向我的訂單，MUST NOT 呈現空白或錯誤', async () => {
    renderConfirm(null)

    expect(await screen.findByText('訂單已成立')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往我的訂單' })).toHaveAttribute('href', '/orders')
    // 不是錯誤畫面
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/無法連線至伺服器/)).not.toBeInTheDocument()
    // 也不是一頁空欄位
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
