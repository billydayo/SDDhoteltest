/**
 * T128 的驗證，聚焦在**最容易被「修好」成錯誤行為**的那一條：
 *
 * ⚠️ **無訂單時成交率與平均客單價 MUST 顯示為「—」，MUST NOT 顯示 0**
 * （T117、FR-053）。
 *
 * 後端已經把它回成 `null`，但前端只要一個 `?? 0` 就會把那個區分抹掉——
 * 而畫面上會出現一個看起來完全正常的「0%」。這是一種不會有人回報的錯：
 * 它不當機、不報錯，只是把「還沒有人下單」講成「一筆都沒成交」。
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import type { AdminOrder } from '../../api/types'
import { AppRoutes } from '../../router'
import { AuthProvider } from '../../state/AuthContext'
import { ADMIN, mockApi } from '../../test/mockApi'
import type { MockOptions } from '../../test/mockApi'

function renderOrders(options: MockOptions = {}) {
  mockApi({ profile: ADMIN, ...options })
  setToken('fake-token')
  return render(
    <MemoryRouter initialEntries={['/admin/orders']}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  )
}

const ORDER: AdminOrder = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  orderNo: 'SN20260804001',
  userId: '11111111-1111-1111-1111-111111111111',
  roomId: 'aaaaaaaa-0000-0000-0000-000000000001',
  roomName: '海景雙人房 201',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  nights: 2,
  guestCount: 2,
  contactName: '陳小明',
  phone: '0912345678',
  email: 'member@example.com',
  paymentMethod: 'credit-card',
  totalAmount: 6400,
  status: 'pending-payment',
  expiresAt: '2026-08-04T12:00:00Z',
  cancelReason: null,
  createdAt: '2026-08-04T11:00:00Z',
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('營運指標（T128）', () => {
  it('⚠️ 尚無訂單時，成交率與平均客單價顯示「—」而非 0', async () => {
    renderOrders({
      orderStats: {
        totalOrders: 0,
        placedOrders: 0,
        paidOrders: 0,
        unpaidCancelledOrders: 0,
        revenue: 0,
        conversionRate: null,
        averageOrderValue: null,
      },
    })

    // 兩張磚各有一個「—」，而且都附上了「尚無訂單，無法計算」的說明
    expect(await screen.findAllByText('—')).toHaveLength(2)
    expect(screen.getAllByText('尚無訂單，無法計算')).toHaveLength(2)
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })

  it('有訂單時照常顯示比值', async () => {
    renderOrders({ adminOrders: [ORDER] })

    expect(await screen.findByText('75.0%')).toBeInTheDocument()
  })

  /**
   * 指標取的是全站分母，與篩選條件無關。這件事在畫面上看不出來，因此標題
   * 必須明講——否則管理員會拿一個他以為是篩選結果的數字去做決策。
   */
  it('指標區塊標明「全站累計，不受篩選影響」', async () => {
    renderOrders({ adminOrders: [ORDER] })

    expect(
      await screen.findByText('營運指標（全站累計，不受下方篩選條件影響）'),
    ).toBeInTheDocument()
  })
})

describe('訂單列表（T128）', () => {
  it('顯示訂單編號、房源與狀態', async () => {
    renderOrders({ adminOrders: [ORDER] })

    expect(await screen.findByText('SN20260804001')).toBeInTheDocument()
    // 查詢限定在表格內：篩選列的 `<select>` 也含同樣的狀態文字，
    // 全域查會同時命中那個選項，斷言就驗不到「表格裡顯示了什麼」
    const table = within(screen.getByRole('region', { name: '訂單清單' }))
    expect(table.getByText('海景雙人房 201')).toBeInTheDocument()
    // 狀態 MUST 為繁體中文，MUST NOT 顯示 `pending-payment`（T172a）
    expect(table.getByText('待付款')).toBeInTheDocument()
    expect(screen.queryByText('pending-payment')).not.toBeInTheDocument()
  })

  it('沒有符合條件的訂單時顯示引導性空狀態', async () => {
    renderOrders({ adminOrders: [] })

    expect(await screen.findByText('沒有符合條件的訂單')).toBeInTheDocument()
  })
})
