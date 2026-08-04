/**
 * T101／T104 的驗證（FR-033、FR-035b、FR-036c、FR-039）。
 *
 * 兩支最重要的：
 *
 * 1. **FR-035b**：待付款訂單的付款與取消入口 MUST 出現在列表上。這一條是
 *    驗收時被直接判定為「取消功能缺失」的那一條——列表顯示著倒數，動作卻
 *    只在詳情頁。
 * 2. **FR-036c**：未達上限時 MUST NOT 顯示剩餘次數。掃描整個畫面確認沒有
 *    任何「剩餘 N 次」的字樣。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeOrder, makeRefund, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { Orders } from './Orders'

function renderOrders(options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, ...options })
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <AuthProvider>
        <Routes>
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:orderId" element={<div>訂單詳情頁</div>} />
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

/**
 * 訂單列表本身。
 *
 * ⚠️ 狀態字樣的斷言 MUST 限定在這裡：每一個狀態名同時是分頁按鈕的文字，
 * 而分頁列**永遠**存在。不限定範圍的話，斷言會落在分頁上——包括那些
 * 應該失敗的。
 */
const list = () => within(screen.getByRole('list'))

describe('列表（FR-033）', () => {
  it('顯示訂單編號、日期與狀態', async () => {
    renderOrders({ orders: [makeOrder({ status: 'confirmed' })] })

    expect(await screen.findByText('SN20260804001')).toBeInTheDocument()
    expect(screen.getByText(/2026\/09\/01 – 2026\/09\/03/)).toBeInTheDocument()
    expect(list().getByText('已確認')).toBeInTheDocument()
    expect(screen.getByText('NT$ 6,400')).toBeInTheDocument()
  })

  it('沒有訂單時給引導，而不是一片空白', async () => {
    renderOrders({ orders: [] })

    expect(await screen.findByText('還沒有任何訂單')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去找房源' })).toHaveAttribute('href', '/')
  })

  it('⚠️ 排序由後端決定，前端 MUST NOT 自己重排', async () => {
    // 後端已依入住日排序（FR-033）。前端再排一次的話，兩邊的規則遲早會不一致，
    // 而不一致時使用者看到的是前端那個
    const early = makeOrder({ id: 'a', orderNo: 'SN-A', checkIn: '2026-09-01' })
    const late = makeOrder({ id: 'b', orderNo: 'SN-B', checkIn: '2026-12-01' })
    renderOrders({ orders: [early, late] })

    await screen.findByText('SN-A')
    const shown = screen.getAllByText(/^SN-[AB]$/).map((el) => el.textContent)
    expect(shown).toEqual(['SN-A', 'SN-B'])
  })
})

describe('⚠️ FR-035b：付款與取消入口 MUST 在列表上', () => {
  it('待付款訂單在列表上同時有付款與取消入口', async () => {
    renderOrders({ orders: [makeOrder({ status: 'pending-payment' })] })

    const row = (await screen.findByText('SN20260804001')).closest('li')
    expect(row).not.toBeNull()
    const inRow = within(row!)

    expect(inRow.getByRole('button', { name: /模擬付款/ })).toBeInTheDocument()
    expect(inRow.getByRole('link', { name: '取消訂單' })).toBeInTheDocument()
    // 倒數也在同一個地方——看得到時效卻按不到動作正是這一條要防的
    expect(inRow.getByRole('timer')).toBeInTheDocument()
  })

  it('⚠️ 列表上的取消是導向詳情頁的連結，不是第二套確認流程（FR-035a）', async () => {
    const user = userEvent.setup()
    renderOrders({ orders: [makeOrder({ status: 'pending-payment' })] })

    await user.click(await screen.findByRole('link', { name: '取消訂單' }))

    expect(await screen.findByText('訂單詳情頁')).toBeInTheDocument()
    // 二次確認只實作一份——列表上 MUST NOT 出現另一個確認對話框
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('已確認的訂單在列表上沒有取消入口（FR-035a）', async () => {
    renderOrders({ orders: [makeOrder({ status: 'confirmed' })] })

    await screen.findByText('SN20260804001')
    expect(screen.queryByRole('link', { name: '取消訂單' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /模擬付款/ })).not.toBeInTheDocument()
  })

  it('列表上的付款按鈕真的會呼叫付款端點', async () => {
    const user = userEvent.setup()
    const { calls } = renderOrders({ orders: [makeOrder({ status: 'pending-payment' })] })

    await user.click(await screen.findByRole('button', { name: /模擬付款/ }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/pay'))).toBe(true)
    })
  })

  it('付款失敗時原樣轉達後端的理由，MUST NOT 靜默失敗（FR-083）', async () => {
    const user = userEvent.setup()
    renderOrders({
      orders: [makeOrder({ status: 'pending-payment' })],
      onOrderPay: () => ({
        status: 409,
        body: {
          detail: '此訂單的付款時間已過並已自動取消，所選日期可能已被其他人預訂，請重新查詢。',
          code: 'ORDER_EXPIRED',
        },
      }),
    })

    await user.click(await screen.findByRole('button', { name: /模擬付款/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('所選日期可能已被其他人預訂')
  })
})

describe('⚠️ FR-039：「退款已駁回」標籤', () => {
  const confirmed = makeOrder({ status: 'confirmed' })

  it('最新一次遭駁回時顯示「退款已駁回」而非「已確認」', async () => {
    renderOrders({
      orders: [confirmed],
      refunds: [makeRefund({ status: 'rejected', orderId: confirmed.id })],
    })

    await screen.findByText('SN20260804001')
    expect(list().getByText('退款已駁回')).toBeInTheDocument()
    expect(list().queryByText('已確認')).not.toBeInTheDocument()
  })

  it('⚠️ 標籤寫「退款已駁回」而非「已駁回」', async () => {
    // 「已駁回」單獨出現在列表卡片上會被讀成訂房遭駁回
    renderOrders({
      orders: [confirmed],
      refunds: [makeRefund({ status: 'rejected', orderId: confirmed.id })],
    })

    await screen.findByText('SN20260804001')
    expect(list().queryByText('已駁回')).not.toBeInTheDocument()
  })

  it('於狀態分頁獨立成一類', async () => {
    const user = userEvent.setup()
    renderOrders({
      orders: [confirmed, makeOrder({ id: 'other', orderNo: 'SN-OTHER', status: 'confirmed' })],
      refunds: [makeRefund({ status: 'rejected', orderId: confirmed.id })],
    })

    await user.click(await screen.findByRole('button', { name: /退款已駁回/ }))

    expect(screen.getByText('SN20260804001')).toBeInTheDocument()
    expect(screen.queryByText('SN-OTHER')).not.toBeInTheDocument()
  })

  it('選「已確認」分頁時，被駁回的那一筆不在裡面', async () => {
    const user = userEvent.setup()
    renderOrders({
      orders: [confirmed, makeOrder({ id: 'other', orderNo: 'SN-OTHER', status: 'confirmed' })],
      refunds: [makeRefund({ status: 'rejected', orderId: confirmed.id })],
    })

    await user.click(await screen.findByRole('button', { name: /^已確認/ }))

    expect(screen.getByText('SN-OTHER')).toBeInTheDocument()
    expect(screen.queryByText('SN20260804001')).not.toBeInTheDocument()
  })

  it('最新一次是審核中時 MUST NOT 顯示駁回標籤', async () => {
    renderOrders({
      orders: [makeOrder({ status: 'refund-pending' })],
      refunds: [
        makeRefund({ id: 'old', status: 'rejected', createdAt: '2026-08-01T00:00:00Z' }),
        makeRefund({ id: 'new', status: 'pending', createdAt: '2026-08-09T00:00:00Z' }),
      ],
    })

    await screen.findByText('SN20260804001')
    expect(list().queryByText('退款已駁回')).not.toBeInTheDocument()
    expect(list().getByText('退款待審核')).toBeInTheDocument()
  })
})

describe('⚠️ FR-036c：未達上限時 MUST NOT 顯示次數', () => {
  it('沒有任何申請時，畫面上找不到任何次數字樣', async () => {
    renderOrders({ orders: [makeOrder({ status: 'confirmed' })], refunds: [] })

    await screen.findByText('SN20260804001')
    expect(document.body.textContent).not.toMatch(/剩餘|已使用|還可以申請|次上限|\d\s*\/\s*5/)
  })

  it('用掉 4 筆（未達上限）仍然不提次數', async () => {
    renderOrders({
      orders: [makeOrder({ status: 'confirmed' })],
      refunds: Array.from({ length: 4 }, (_, i) =>
        makeRefund({ id: `r${String(i)}`, status: 'pending', orderId: `o${String(i)}` }),
      ),
    })

    await screen.findByText('SN20260804001')
    expect(document.body.textContent).not.toMatch(/剩餘|已使用/)
    expect(screen.queryByText(/已達.*上限/)).not.toBeInTheDocument()
  })

  it('達到 5 筆時明確告知已達上限', async () => {
    renderOrders({
      orders: [makeOrder({ status: 'confirmed' })],
      refunds: Array.from({ length: 5 }, (_, i) =>
        makeRefund({ id: `r${String(i)}`, status: 'pending', orderId: `o${String(i)}` }),
      ),
    })

    expect(await screen.findByText(/已達 5 筆上限/)).toBeInTheDocument()
  })

  it('⚠️ 被駁回 5 次不算達到上限（SC-031）', async () => {
    renderOrders({
      orders: [makeOrder({ status: 'confirmed' })],
      refunds: Array.from({ length: 5 }, (_, i) =>
        makeRefund({ id: `r${String(i)}`, status: 'rejected', orderId: `o${String(i)}` }),
      ),
    })

    await screen.findByText('SN20260804001')
    expect(screen.queryByText(/已達 5 筆上限/)).not.toBeInTheDocument()
  })
})
