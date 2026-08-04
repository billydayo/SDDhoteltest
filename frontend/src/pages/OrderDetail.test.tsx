/**
 * T102 的驗證（FR-033、FR-035a、FR-039、FR-083）。
 *
 * 最重要的兩條：
 *
 * 1. **FR-035a**：二次確認 MUST 講出「不可復原」與「房間會立刻開放」。少了
 *    第二句，使用者會以為自己「等一下再訂回來」就好。
 * 2. **FR-039**：詳情頁 MUST 說明訂房仍然有效。只有一個「退款已駁回」標籤時，
 *    使用者的第一反應是「我的訂房沒了嗎」。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import type { Order } from '../api/types'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeOrder, makeRefund, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { OrderDetail } from './OrderDetail'

/** 入住日固定在很遠的未來，判斷才不會隨著真實日期走過去而改變。 */
const FUTURE = '2099-09-01'

function renderDetail(order: Order, options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, orders: [order], ...options })
  render(
    <MemoryRouter initialEntries={[`/orders/${order.id}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetail />} />
          <Route path="/orders" element={<div>我的訂單頁</div>} />
          <Route path="/orders/:orderId/refund" element={<div>退款申請頁</div>} />
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

describe('內容（FR-033）', () => {
  it('顯示訂單的完整內容', async () => {
    renderDetail(makeOrder({ status: 'confirmed', checkIn: FUTURE, checkOut: '2099-09-03' }))

    expect(await screen.findByRole('heading', { name: 'SN20260804001' })).toBeInTheDocument()
    expect(screen.getByText('2 晚')).toBeInTheDocument()
    expect(screen.getByText('2 人')).toBeInTheDocument()
    expect(screen.getByText('王小明／0912345678')).toBeInTheDocument()
    expect(screen.getByText('NT$ 6,400')).toBeInTheDocument()
  })

  it('取消原因為空時 MUST NOT 印出一列空的「取消原因」', async () => {
    renderDetail(makeOrder({ status: 'confirmed', cancelReason: null, checkIn: FUTURE }))

    await screen.findByRole('heading', { name: 'SN20260804001' })
    expect(screen.queryByText('取消原因')).not.toBeInTheDocument()
  })

  it('查無此訂單時給錯誤畫面，而不是一片空白', async () => {
    setToken('fake-token')
    mockApi({ profile: MEMBER, orders: [] })
    render(
      <MemoryRouter initialEntries={['/orders/does-not-exist']}>
        <AuthProvider>
          <Routes>
            <Route path="/orders/:orderId" element={<OrderDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('查無此訂單。')).toBeInTheDocument()
  })
})

describe('⚠️ FR-035a：取消的二次確認', () => {
  const pendingOrder = makeOrder({ status: 'pending-payment', checkIn: FUTURE })

  it('確認裡 MUST 同時講出「不可復原」與「房間立刻開放」', async () => {
    const user = userEvent.setup()
    renderDetail(pendingOrder)

    await user.click(await screen.findByRole('button', { name: '取消訂單' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('不可復原')
    expect(dialog).toHaveTextContent('立刻開放')
  })

  it('⚠️ 危險的那一個不是唯一的出路——「保留訂單」關掉確認且不送出任何請求', async () => {
    const user = userEvent.setup()
    const { calls } = renderDetail(pendingOrder)

    await user.click(await screen.findByRole('button', { name: '取消訂單' }))
    await user.click(await screen.findByRole('button', { name: '保留訂單' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(false)
  })

  it('⚠️ 只按「取消訂單」不會送出取消——確認前 MUST NOT 呼叫端點', async () => {
    const user = userEvent.setup()
    const { calls } = renderDetail(pendingOrder)

    await user.click(await screen.findByRole('button', { name: '取消訂單' }))

    expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(false)
  })

  it('確定取消後才呼叫取消端點', async () => {
    const user = userEvent.setup()
    const { calls } = renderDetail(pendingOrder)

    await user.click(await screen.findByRole('button', { name: '取消訂單' }))
    await user.click(screen.getByRole('button', { name: '確定取消訂單' }))

    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'POST' && c.path.endsWith(`/orders/${pendingOrder.id}/cancel`)),
      ).toBe(true)
    })
  })

  it('取消失敗時原樣轉達後端的理由，MUST NOT 靜默失敗（FR-083）', async () => {
    const user = userEvent.setup()
    renderDetail(pendingOrder, {
      onOrderCancel: () => ({
        status: 409,
        body: {
          detail: '此訂單的付款時間已過並已自動取消，無需再次取消。',
          code: 'ORDER_EXPIRED',
        },
      }),
    })

    await user.click(await screen.findByRole('button', { name: '取消訂單' }))
    await user.click(screen.getByRole('button', { name: '確定取消訂單' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('付款時間已過並已自動取消')
  })

  it('⚠️ 已確認的訂單沒有取消按鈕——那條路徑不存在，不是被藏起來', async () => {
    renderDetail(makeOrder({ status: 'confirmed', checkIn: FUTURE }))

    await screen.findByRole('heading', { name: 'SN20260804001' })
    expect(screen.queryByRole('button', { name: '取消訂單' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('已取消的訂單顯示取消原因並給回列表的路', async () => {
    renderDetail(
      makeOrder({ status: 'cancelled', cancelReason: 'member-cancelled', checkIn: FUTURE }),
    )

    await screen.findByRole('heading', { name: 'SN20260804001' })
    expect(screen.getByText('取消原因')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到我的訂單' })).toBeInTheDocument()
  })
})

describe('⚠️ FR-039：被駁回時 MUST 說明訂房仍然有效', () => {
  const confirmed = makeOrder({ status: 'confirmed', checkIn: FUTURE })

  function renderRejected(options: MockOptions = {}) {
    return renderDetail(confirmed, {
      refunds: [makeRefund({ status: 'rejected', orderId: confirmed.id })],
      ...options,
    })
  }

  it('說明訂房仍然有效且可以再次申請', async () => {
    renderRejected()

    // ⚠️ 先等訂單載入完。`LoadingState` 自己也是 `role="status"`，
    // 直接 findByRole 會拿到「載入訂單…」而不是這裡要驗的那一則。
    await screen.findByRole('heading', { name: 'SN20260804001' })

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('這筆訂房仍然有效')
    expect(notice).toHaveTextContent('再次提出退款申請')
  })

  it('⚠️ 被駁回之後「申請退款」仍然可用——駁回釋出額度（SC-031）', async () => {
    renderRejected()

    expect(await screen.findByRole('link', { name: '申請退款' })).toHaveAttribute(
      'href',
      `/orders/${confirmed.id}/refund`,
    )
  })

  it('最新一次是審核中時 MUST NOT 出現駁回說明', async () => {
    renderDetail(makeOrder({ status: 'refund-pending', checkIn: FUTURE }), {
      refunds: [
        makeRefund({ id: 'old', status: 'rejected', createdAt: '2026-08-01T00:00:00Z' }),
        makeRefund({ id: 'new', status: 'pending', createdAt: '2026-08-09T00:00:00Z' }),
      ],
    })

    await screen.findByRole('heading', { name: 'SN20260804001' })
    expect(screen.queryByText(/這筆訂房仍然有效/)).not.toBeInTheDocument()
  })
})

describe('退款申請紀錄', () => {
  const confirmed = makeOrder({ status: 'confirmed', checkIn: FUTURE })

  it('列出這筆訂單的申請與管理員備註', async () => {
    renderDetail(confirmed, {
      refunds: [
        makeRefund({
          status: 'rejected',
          orderId: confirmed.id,
          reason: '臨時有事。',
          adminNote: '距入住日過近，恕難受理。',
        }),
      ],
    })

    const history = (await screen.findByText('退款申請紀錄')).closest('section')
    expect(history).not.toBeNull()
    const inHistory = within(history!)
    expect(inHistory.getByText('原因：臨時有事。')).toBeInTheDocument()
    expect(inHistory.getByText(/距入住日過近/)).toBeInTheDocument()
  })

  it('⚠️ 沒有備註時 MUST NOT 印出一行空的「管理員備註：」', async () => {
    renderDetail(confirmed, {
      refunds: [makeRefund({ status: 'pending', orderId: confirmed.id, adminNote: null })],
    })

    await screen.findByText('退款申請紀錄')
    expect(screen.queryByText(/管理員備註/)).not.toBeInTheDocument()
  })

  it('⚠️ 別筆訂單的申請 MUST NOT 出現在這裡', async () => {
    renderDetail(confirmed, {
      refunds: [makeRefund({ id: 'other', orderId: 'another-order', reason: '別人的理由。' })],
    })

    await screen.findByRole('heading', { name: 'SN20260804001' })
    expect(screen.queryByText('退款申請紀錄')).not.toBeInTheDocument()
  })
})

describe('⚠️ FR-036c：未達上限時 MUST NOT 提次數', () => {
  const confirmed = makeOrder({ status: 'confirmed', checkIn: FUTURE })

  it('沒有申請時畫面上找不到任何次數字樣', async () => {
    renderDetail(confirmed, { refunds: [] })

    await screen.findByRole('link', { name: '申請退款' })
    expect(document.body.textContent).not.toMatch(/剩餘|已使用|\d\s*\/\s*5/)
  })

  it('達到上限時改為說明，且 MUST NOT 再提供申請入口', async () => {
    renderDetail(confirmed, {
      refunds: Array.from({ length: 5 }, (_, i) =>
        makeRefund({ id: `r${String(i)}`, status: 'pending', orderId: `o${String(i)}` }),
      ),
    })

    expect(await screen.findByText(/已達 5 筆上限/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '申請退款' })).not.toBeInTheDocument()
  })
})
