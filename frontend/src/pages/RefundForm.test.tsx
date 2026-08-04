/**
 * T103 的驗證（FR-035、FR-036、FR-036c、FR-040、FR-041、FR-083）。
 *
 * 最重要的一條：**必定失敗的表單 MUST NOT 出現。** 已有審核中的申請、訂單
 * 不可退、額度已滿——這三種情況給他一個表單，等於請他打完一段字再被拒絕，
 * 而他打的那段字就這樣沒了。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import type { Order } from '../api/types'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeOrder, makeRefund, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { RefundForm } from './RefundForm'

/**
 * 入住日固定在很遠的未來。
 *
 * ⚠️ 級距（FR-041）是依「距入住日還有幾天」算的，而 `dates.today()` 讀的是
 * 真實時鐘。用近期的日期當預設，這些測試會在某一天之後開始失敗，而失敗訊息
 * 會指向金額而不是日期。
 */
const FUTURE = '2099-09-01'

function renderForm(order: Order, options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, orders: [order], refunds: [], ...options })
  render(
    <MemoryRouter initialEntries={[`/orders/${order.id}/refund`]}>
      <AuthProvider>
        <Routes>
          <Route path="/orders/:orderId/refund" element={<RefundForm />} />
          <Route path="/orders/:orderId" element={<div>訂單詳情頁</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

const refundable = makeOrder({ status: 'confirmed', checkIn: FUTURE, checkOut: '2099-09-03' })

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('⚠️ 必定失敗的表單 MUST NOT 出現', () => {
  it('已有審核中的申請時，顯示目前進度而不是表單（FR-036）', async () => {
    renderForm(refundable, {
      refunds: [
        makeRefund({
          status: 'pending',
          orderId: refundable.id,
          reason: '行程有變。',
          amount: 6400,
        }),
      ],
    })

    expect(await screen.findByText(/已有一筆退款申請正在審核中/)).toBeInTheDocument()
    // 他打開這一頁真正想知道的是「審到哪了」
    expect(screen.getByText(/行程有變。/)).toBeInTheDocument()
    expect(screen.getByText(/NT\$ 6,400/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('待付款的訂單直接告知取消即可，不走退款（FR-035）', async () => {
    renderForm(makeOrder({ status: 'pending-payment', checkIn: FUTURE }))

    expect(await screen.findByText(/目前無法申請退款/)).toBeInTheDocument()
    expect(screen.getByText(/直接取消即可/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('入住日已過的訂單不可申請', async () => {
    renderForm(makeOrder({ status: 'confirmed', checkIn: '2020-01-01', checkOut: '2020-01-03' }))

    expect(await screen.findByText(/入住日已到或已過/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('⚠️ 達到 5 筆上限時明確告知，而不是一顆被停用的按鈕（FR-036c）', async () => {
    renderForm(refundable, {
      refunds: Array.from({ length: 5 }, (_, i) =>
        makeRefund({ id: `r${String(i)}`, status: 'pending', orderId: `o${String(i)}` }),
      ),
    })

    expect(await screen.findByText(/已達 5 筆上限/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // 停用的按鈕不會說明原因，也不會說怎麼樣才能再申請
    expect(screen.getByText(/駁回後，該筆額度會釋出/)).toBeInTheDocument()
  })

  it('⚠️ 被駁回 5 次 MUST NOT 被當成已達上限（SC-031）', async () => {
    renderForm(refundable, {
      refunds: Array.from({ length: 5 }, (_, i) =>
        makeRefund({
          id: `r${String(i)}`,
          status: 'rejected',
          orderId: `o${String(i)}`,
          createdAt: '2026-08-01T00:00:00Z',
        }),
      ),
    })

    expect(await screen.findByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText(/已達 5 筆上限/)).not.toBeInTheDocument()
  })
})

describe('預估金額（FR-041）', () => {
  it('入住前 7 天以上退全額，並標明是預估', async () => {
    renderForm(refundable)

    expect(await screen.findByText('預估可退金額')).toBeInTheDocument()
    expect(screen.getByText('NT$ 6,400')).toBeInTheDocument()
    expect(screen.getByText(/入住前 7 天以上/)).toBeInTheDocument()
    // ⚠️ 實際金額以送出當下的伺服器計算為準——不說的話，跨過午夜跳一級時
    // 使用者會覺得金額被偷偷改掉了
    expect(screen.getByText(/以送出當下伺服器計算的結果為準/)).toBeInTheDocument()
  })

  it('⚠️ FR-040：送出前就說明不會產生任何實際金錢移轉', async () => {
    renderForm(refundable)

    expect(await screen.findByRole('note')).toHaveTextContent('不會產生任何實際金錢移轉')
  })
})

describe('送出（FR-035、FR-083）', () => {
  it('未填原因時不能送出', async () => {
    renderForm(refundable)

    await screen.findByRole('textbox')
    expect(screen.getByRole('button', { name: '送出退款申請' })).toBeDisabled()
  })

  it('⚠️ 只打空白也不能送出', async () => {
    const user = userEvent.setup()
    renderForm(refundable)

    await user.type(await screen.findByRole('textbox'), '   ')

    expect(screen.getByRole('button', { name: '送出退款申請' })).toBeDisabled()
  })

  it('⚠️ 送出的內容只有訂單與原因——MUST NOT 夾帶金額或狀態', async () => {
    const user = userEvent.setup()
    const { calls } = renderForm(refundable)

    await user.type(await screen.findByRole('textbox'), '臨時有事無法成行。')
    await user.click(screen.getByRole('button', { name: '送出退款申請' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/refunds'))).toBe(true)
    })
    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/refunds'))
    // 金額由後端依級距算出（FR-041）。送一個數字過去等於讓人自訂要退多少錢
    expect(sent?.body).toEqual({ orderId: refundable.id, reason: '臨時有事無法成行。' })
  })

  it('送出成功後回到訂單詳情頁', async () => {
    const user = userEvent.setup()
    renderForm(refundable)

    await user.type(await screen.findByRole('textbox'), '臨時有事無法成行。')
    await user.click(screen.getByRole('button', { name: '送出退款申請' }))

    expect(await screen.findByText('訂單詳情頁')).toBeInTheDocument()
  })

  it('⚠️ 失敗時 MUST 保留已填的原因（FR-083）', async () => {
    const user = userEvent.setup()
    renderForm(refundable, {
      onRefundCreate: () => ({
        status: 409,
        body: { detail: '這筆訂單已有一筆審核中的退款申請。', code: 'REFUND_ALREADY_PENDING' },
      }),
    })

    const textarea = await screen.findByRole('textbox')
    await user.type(textarea, '臨時有事無法成行。')
    await user.click(screen.getByRole('button', { name: '送出退款申請' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('已有一筆審核中的退款申請')
    // 重打一次很花時間，也不見得寫得出一模一樣的
    expect(textarea).toHaveValue('臨時有事無法成行。')
  })

  it('⚠️ 後端指出 `reason` 時，訊息貼在欄位上且焦點移過去（FR-010）', async () => {
    const user = userEvent.setup()
    renderForm(refundable, {
      onRefundCreate: () => ({
        status: 400,
        body: { detail: '請填寫退款原因。', code: 'INVALID_REASON', field: 'reason' },
      }),
    })

    const textarea = await screen.findByRole('textbox')
    await user.type(textarea, '。')
    await user.click(screen.getByRole('button', { name: '送出退款申請' }))

    await waitFor(() => {
      expect(textarea).toHaveFocus()
    })
    expect(screen.getByText('請填寫退款原因。')).toBeInTheDocument()
  })
})
