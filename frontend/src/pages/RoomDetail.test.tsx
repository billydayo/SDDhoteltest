/**
 * T057／T058／T061 的驗證（FR-014、FR-017、FR-019）。
 *
 * 透過完整的 `AppRoutes` 渲染而非單獨掛 `RoomDetail`：T061 要驗的「導向登入頁
 * **並提示需先登入**」橫跨兩個頁面，只掛單一元件的話後半段驗不到——而後半段
 * 正是最容易寫成死程式碼的那一半。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { addDays } from '../lib/dates'
import { AppRoutes } from '../router'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, RISK_CHECK, makeRoomDetail, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'

const ROOM_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function renderDetail(options: MockOptions = {}) {
  mockApi(options)
  return render(
    <MemoryRouter initialEntries={[`/rooms/${ROOM_ID}`]}>
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

describe('照片（T057）', () => {
  it('⚠️ 僅一張照片時 MUST NOT 顯示單格縮圖列', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ images: ['https://example.test/a.jpg'] }) })

    await screen.findByRole('heading', { level: 1, name: '海景雙人房 201' })
    // 一整排只有一格的縮圖，看起來像是其他照片載入失敗
    expect(screen.queryByRole('button', { name: /檢視第 1 張照片/ })).not.toBeInTheDocument()
  })

  it('多張照片時縮圖可切換', async () => {
    const user = userEvent.setup()
    renderDetail({
      roomDetail: makeRoomDetail({
        images: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
      }),
    })

    const second = await screen.findByRole('button', { name: '檢視第 2 張照片' })
    await user.click(second)
    expect(second).toHaveAttribute('aria-current', 'true')
  })

  it('完全沒有照片時給替代區塊，不是破圖', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ images: [] }) })
    expect(await screen.findByText('尚無照片')).toBeInTheDocument()
  })
})

describe('房源品質檢測（T058、FR-014）', () => {
  it('⚠️ 尚未檢測 MUST 顯示「尚未檢測」，MUST NOT 顯示 0 分', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ latestRiskCheck: null }) })

    const section = (await screen.findByRole('heading', { name: '房源品質檢測' })).closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('尚未檢測')
    // 0 分會被讀成「檢測結果極差」，而實際上是還沒檢測過
    expect(section).not.toHaveTextContent('0')
  })

  it('已檢測時顯示四項指標', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ latestRiskCheck: RISK_CHECK }) })

    await screen.findByText('風險評分')
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('低')).toBeInTheDocument()
    expect(screen.queryByText('尚未檢測')).not.toBeInTheDocument()
  })
})

describe('夜數與總金額試算（FR-017）', () => {
  /** 讀出試算表格裡某一列的值。頁面上另有「每晚價格」，不能只靠金額字串找。 */
  function summaryValue(label: string): string {
    const row = screen.getByText(label).closest('div')
    return row?.querySelector('dd')?.textContent ?? ''
  }

  it('依所選日期算出夜數與總金額', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ nightlyPrice: 3200 }) })

    // 預設為明天起住一晚
    await screen.findByRole('heading', { level: 1, name: '海景雙人房 201' })
    expect(summaryValue('夜數')).toBe('1 晚')
    expect(summaryValue('總金額')).toBe('NT$ 3,200')

    // 改成兩晚 → 金額 MUST 跟著動。只驗一晚的話，把總金額寫成每晚價格
    // 也會通過——而那正是最容易犯的錯。
    const checkIn = screen.getByLabelText<HTMLInputElement>('入住日')
    fireEvent.change(screen.getByLabelText('退房日'), {
      target: { value: addDays(checkIn.value, 2) },
    })

    await waitFor(() => {
      expect(summaryValue('夜數')).toBe('2 晚')
    })
    expect(summaryValue('總金額')).toBe('NT$ 6,400')
  })

  it('⚠️ 退房日不晚於入住日時 MUST 說明，MUST NOT 顯示 0 元總金額', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ nightlyPrice: 3200 }) })

    const checkIn = await screen.findByLabelText<HTMLInputElement>('入住日')
    fireEvent.change(screen.getByLabelText('退房日'), { target: { value: checkIn.value } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('退房日必須晚於入住日')
    })
    // 0 元看起來像免費入住
    expect(summaryValue('總金額')).toBe('—')
    expect(screen.getByRole('button', { name: '立即訂房' })).toBeDisabled()
  })
})

describe('評論（FR-017 待 T110）', () => {
  it('⚠️ MUST NOT 以假評論或空白區塊冒充尚未實作的功能', async () => {
    renderDetail()
    expect(await screen.findByText('評論功能即將開放。')).toBeInTheDocument()
  })
})

describe('立即訂房（T061、FR-019）', () => {
  it('⚠️ 未登入時導向登入頁**並說明原因**，且記住要回到這間房', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: '立即訂房' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
    // 少了這一句，畫面直接變成登入表單，看起來像誤觸或網站出錯
    expect(screen.getByRole('status')).toHaveTextContent('預訂房間需要先登入')
    expect(screen.getByRole('status')).toHaveTextContent('回到你剛才看的房源')
  })

  it('已登入時進入訂房流程，MUST NOT 被要求再登入一次', async () => {
    const user = userEvent.setup()
    setToken('fake-token')
    renderDetail({ profile: MEMBER })

    await user.click(await screen.findByRole('button', { name: '立即訂房' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '訂房' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { level: 1, name: '登入' })).not.toBeInTheDocument()
  })

  it('整理中的房源無法點選訂房，並說明理由', async () => {
    renderDetail({ roomDetail: makeRoomDetail({ status: 'maintenance' }) })

    expect(await screen.findByRole('button', { name: '立即訂房' })).toBeDisabled()
    // 只把按鈕變灰而不說為什麼，使用者會以為是自己哪裡沒填對
    expect(screen.getByText('此房源整理中，暫時無法預訂。')).toBeInTheDocument()
  })
})

describe('模擬性質（FR-121）', () => {
  it('訂房側欄載明付款為模擬', async () => {
    renderDetail()
    expect(await screen.findByText('付款為模擬，不會產生任何實際交易。')).toBeInTheDocument()
  })
})
