/**
 * T127 的驗證，聚焦在兩條規格明文禁止、但實作起來很容易「順手做出來」的事：
 *
 * 1. ⚠️ **「已預訂」MUST NOT 出現在可設定的房態裡**（FR-051）。
 *    做一個含三個選項的下拉選單是最直覺的寫法，而它會讓業者能把一間沒有訂單
 *    的房間標成已預訂——之後那個狀態不會隨任何訂單變化，也沒有人記得是誰設的。
 *
 * 2. ⚠️ **篩選「已預訂」MUST 先選定日期**（FR-053a）。已預訂是相對於某一天說的；
 *    不帶日期的查詢沒有意義，而不擋下來的話使用者會拿到一份他無法解釋的清單。
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import type { AdminRoom } from '../../api/types'
import { AppRoutes } from '../../router'
import { AuthProvider } from '../../state/AuthContext'
import { ADMIN, makeRoom, mockApi } from '../../test/mockApi'
import type { MockOptions } from '../../test/mockApi'

const ROOM: AdminRoom = { ...makeRoom(), availability: 'available' }

function renderRooms(options: MockOptions = {}) {
  mockApi({ profile: ADMIN, adminRooms: [ROOM], ...options })
  setToken('fake-token')
  return render(
    <MemoryRouter initialEntries={['/admin/rooms']}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('房態（FR-051）', () => {
  it('⚠️ 可設定的房態只有兩種，MUST NOT 含「已預訂」', async () => {
    renderRooms()

    const select = await screen.findByRole('combobox', { name: '海景雙人房 201 的房態' })
    const options = within(select).getAllByRole('option')

    expect(options.map((o) => o.textContent)).toEqual(['可販售', '整理中'])
  })

  it('房態與所查期間是兩欄，不是同一件事', async () => {
    renderRooms({ adminRooms: [{ ...ROOM, status: 'available', availability: 'booked' }] })

    // 同一列上：業者設定為「可販售」，而所查期間內推導為「已預訂」。
    // 限定在表格內查詢——篩選列的 `<select>` 也有一個「已預訂」選項。
    await screen.findByRole('combobox', { name: '海景雙人房 201 的房態' })
    const table = within(screen.getByRole('region', { name: '房源清單' }))
    expect(table.getByText('已預訂')).toBeInTheDocument()
  })
})

describe('篩選（FR-053a）', () => {
  it('⚠️ 篩「已預訂」而未選日期時，提示先選日期而不送出查詢', async () => {
    const user = userEvent.setup()
    renderRooms()

    await screen.findByRole('combobox', { name: '海景雙人房 201 的房態' })

    await user.selectOptions(screen.getByLabelText('房態'), 'booked')
    await user.click(screen.getByRole('button', { name: '搜尋' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '篩選「已預訂」需要先選定日期或日期區間。',
    )
  })
})
