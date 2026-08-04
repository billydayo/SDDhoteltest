/**
 * T076 的驗證（FR-007、FR-083）。
 *
 * 重點是 FR-007 的「變更 MUST 即時反映於介面各處」。只更新本頁表單的版本
 * 看起來完全正常——直到使用者瞄一眼頁首，發現那裡還是舊名字，於是再按一次
 * 儲存。因此這裡把頁首一起渲染出來檢查。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getToken, setToken } from '../api/client'
import { Header } from '../components/Header'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { Account } from './Account'

function renderAccount(options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, ...options })
  render(
    <MemoryRouter>
      <AuthProvider>
        <Header />
        <Account />
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

describe('唯讀資訊', () => {
  it('顯示 email 與身分，但不做成可編輯的輸入框', async () => {
    renderAccount()

    expect(await screen.findByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('會員')).toBeInTheDocument()
    // 做成輸入框更糟：他改了、按了存檔、什麼都沒發生
    expect(screen.queryByLabelText('電子郵件')).not.toBeInTheDocument()
    expect(screen.getByText(/電子郵件與身分無法自行變更/)).toBeInTheDocument()
  })

  it('表單以目前的個人資料帶入', async () => {
    renderAccount()
    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('測試會員')
    })
  })
})

describe('儲存（FR-007）', () => {
  it('⚠️ 存檔後頁首的顯示名稱 MUST 同步更新', async () => {
    const user = userEvent.setup()
    renderAccount({
      onProfileUpdate: () => ({ ...MEMBER, displayName: '改過的名字', phone: '0912345678' }),
    })

    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('測試會員')
    })

    await user.clear(screen.getByLabelText('顯示名稱'))
    await user.type(screen.getByLabelText('顯示名稱'), '改過的名字')
    await user.type(screen.getByLabelText('聯絡電話'), '0912345678')
    await user.click(screen.getByRole('button', { name: '儲存變更' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已儲存')
    })
    // 頁首還是舊名字的話，使用者會以為存檔沒成功而再按一次
    expect(screen.getByRole('banner')).toHaveTextContent('改過的名字')
  })

  it('⚠️ 灌回畫面的是**後端回傳的**值，不是送出的值', async () => {
    const user = userEvent.setup()
    // 後端修剪了前後空白。以送出的值為準的話，畫面會顯示一份資料庫裡
    // 並不存在的內容。
    renderAccount({ onProfileUpdate: () => ({ ...MEMBER, displayName: '修剪後' }) })

    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('測試會員')
    })
    await user.clear(screen.getByLabelText('顯示名稱'))
    await user.type(screen.getByLabelText('顯示名稱'), '  有空白  ')
    await user.click(screen.getByRole('button', { name: '儲存變更' }))

    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('修剪後')
    })
  })

  it('清空電話送出的是空字串，不是省略欄位', async () => {
    const user = userEvent.setup()
    const { calls } = renderAccount({
      profile: { ...MEMBER, phone: '0900000000' },
      onProfileUpdate: () => ({ ...MEMBER, phone: null }),
    })

    await waitFor(() => {
      expect(screen.getByLabelText('聯絡電話')).toHaveValue('0900000000')
    })
    await user.clear(screen.getByLabelText('聯絡電話'))
    await user.click(screen.getByRole('button', { name: '儲存變更' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已儲存')
    })
    // 省略欄位在後端是「不要動」，與「清空」意思相反
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toEqual({ displayName: '測試會員', phone: '' })
  })
})

describe('失敗（FR-083）', () => {
  it('MUST 保留已填內容並說明原因', async () => {
    const user = userEvent.setup()
    renderAccount({
      onProfileUpdate: () => ({
        status: 400,
        body: { detail: '顯示名稱不可為空白。', code: 'INVALID_DISPLAY_NAME', field: 'display_name' },
      }),
    })

    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('測試會員')
    })
    await user.clear(screen.getByLabelText('顯示名稱'))
    await user.type(screen.getByLabelText('顯示名稱'), '新名字')
    await user.click(screen.getByRole('button', { name: '儲存變更' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('顯示名稱不可為空白')
    })
    // 後端送的是 snake_case，能定位到 camelCase 的輸入框才算做到 FR-010
    expect(screen.getByLabelText('顯示名稱')).toHaveFocus()
    expect(screen.getByLabelText('顯示名稱')).toHaveValue('新名字')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('登出', () => {
  it('清除 token 並回到未登入狀態', async () => {
    const user = userEvent.setup()
    renderAccount()

    await waitFor(() => {
      expect(screen.getByLabelText('顯示名稱')).toHaveValue('測試會員')
    })
    // 頁首也有一個登出。這裡要按的是帳戶設定表單裡的那一個。
    const form = screen.getByLabelText('顯示名稱').closest('form')
    expect(form).not.toBeNull()
    await user.click(within(form!).getByRole('button', { name: '登出' }))

    expect(getToken()).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole('banner')).toHaveTextContent('登入')
    })
  })
})
