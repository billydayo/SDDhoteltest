/**
 * T073 的驗證（FR-004、FR-005、FR-006、FR-083、FR-090）。
 *
 * 這一頁的規則有一半是「**不要做某件事**」——不要洩漏帳號是否存在、不要清掉
 * 已填內容、不要把錯誤標到某一欄。不做某件事不會有任何東西提醒你漏了，
 * 只有測試擋得住。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getToken, setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { Login } from './Login'

function renderLogin(options: MockOptions = {}, entry = '/login') {
  const handles = mockApi(options)
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<h1>房源</h1>} />
          <Route path="/orders" element={<h1>我的訂單</h1>} />
          <Route path="/register" element={<h1>註冊</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

const WRONG_PASSWORD = {
  status: 401,
  body: { detail: '電子郵件或密碼錯誤。', code: 'LOGIN_FAILED' },
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('測試帳號（FR-005）', () => {
  it('⚠️ MUST 公開列出兩組測試帳密', () => {
    renderLogin()
    expect(screen.getByText('guest@sunny.com')).toBeInTheDocument()
    expect(screen.getByText('密碼：guest123')).toBeInTheDocument()
    expect(screen.getByText('admin@sunny.com')).toBeInTheDocument()
    expect(screen.getByText('密碼：admin123')).toBeInTheDocument()
  })

  it('「填入」把帳密帶進表單', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getAllByRole('button', { name: '填入' })[0]!)
    expect(screen.getByLabelText('電子郵件')).toHaveValue('guest@sunny.com')
    expect(screen.getByLabelText('密碼')).toHaveValue('guest123')
  })
})

describe('展示用專案警語（FR-006）', () => {
  it('⚠️ MUST 提醒勿使用其他網站的真實密碼', () => {
    renderLogin()
    const warning = screen.getByRole('heading', { name: '請勿使用你的真實密碼' }).closest('section')
    expect(warning).not.toBeNull()
    expect(warning).toHaveTextContent('不要沿用你在其他網站的真實密碼')
    expect(warning).toHaveTextContent('展示用專案')
    expect(warning).toHaveTextContent('不會產生任何實際交易')
  })
})

describe('登入', () => {
  it('成功後帶回原目的地並存下 token', async () => {
    const user = userEvent.setup()
    renderLogin({}, '/login')

    await user.type(screen.getByLabelText('電子郵件'), 'guest@sunny.com')
    await user.type(screen.getByLabelText('密碼'), 'guest123')
    await user.click(screen.getByRole('button', { name: '登入' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
    })
    expect(getToken()).toBe('fake-token')
  })

  it('⚠️ 失敗訊息 MUST NOT 標到 email 或密碼任一欄（FR-004）', async () => {
    const user = userEvent.setup()
    renderLogin({ onLogin: () => WRONG_PASSWORD })

    await user.type(screen.getByLabelText('電子郵件'), 'nobody@example.com')
    await user.type(screen.getByLabelText('密碼'), 'whatever')
    await user.click(screen.getByRole('button', { name: '登入' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('電子郵件或密碼錯誤')

    // 標到哪一欄，就等於告訴對方另一欄是對的——那正是帳號列舉。
    // 逐欄訊息會出現在 <label> 所屬的那個 <div> 裡。
    const emailField = screen.getByLabelText('電子郵件').closest('div')
    const passwordField = screen.getByLabelText('密碼').closest('div')
    expect(emailField).not.toContainElement(alert)
    expect(passwordField).not.toContainElement(alert)
  })

  it('⚠️ 失敗時 MUST 保留已填的 email（FR-083）', async () => {
    const user = userEvent.setup()
    renderLogin({ onLogin: () => WRONG_PASSWORD })

    await user.type(screen.getByLabelText('電子郵件'), 'guest@sunny.com')
    await user.type(screen.getByLabelText('密碼'), 'wrong')
    await user.click(screen.getByRole('button', { name: '登入' }))

    await screen.findByRole('alert')
    // 清掉的話使用者得重打一次——他要改的只有密碼
    expect(screen.getByLabelText('電子郵件')).toHaveValue('guest@sunny.com')
  })

  it('連不上後端時說的是連線問題，不是業務錯誤（FR-084）', async () => {
    const user = userEvent.setup()
    renderLogin()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await user.type(screen.getByLabelText('電子郵件'), 'guest@sunny.com')
    await user.type(screen.getByLabelText('密碼'), 'guest123')
    await user.click(screen.getByRole('button', { name: '登入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('請確認後端服務已啟動')
  })
})

describe('導向理由（FR-019、FR-009d）', () => {
  it('從訂房被送來時說明原因', () => {
    mockApi()
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { reason: 'BOOKING_REQUIRES_LOGIN' } },
        ]}
      >
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('預訂房間需要先登入')
  })
})

describe('Google 回程（FR-090）', () => {
  it('⚠️ 取消時 MUST 告知已取消，且說明沒有建立帳號', () => {
    renderLogin({}, '/login#error=GOOGLE_CANCELLED')
    expect(screen.getByRole('status')).toHaveTextContent('已取消 Google 登入')
    expect(screen.getByRole('status')).toHaveTextContent('沒有建立任何帳號')
  })

  it('尚未設定 Google 時給的是可行的替代方案，不是錯誤代碼', () => {
    renderLogin({}, '/login#error=GOOGLE_NOT_CONFIGURED')
    expect(screen.getByRole('status')).toHaveTextContent('請以電子郵件與密碼登入')
  })

  it('⚠️ 未知代碼 MUST NOT 原樣顯示——那是給機器看的字串', () => {
    renderLogin({}, '/login#error=SOMETHING_NEW')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('無法完成 Google 登入')
    expect(status).not.toHaveTextContent('SOMETHING_NEW')
  })

  it('沒有錯誤時不顯示任何提示', () => {
    renderLogin()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
