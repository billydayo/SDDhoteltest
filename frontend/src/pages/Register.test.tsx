/**
 * T074 的驗證（FR-001、FR-002、FR-009b、FR-083）。
 *
 * 最重要的一條是「失敗時 MUST 保留其他已填欄位」。它不會有任何東西自然失敗——
 * 清空表單的版本一樣通過型別檢查、一樣沒有錯誤訊息，只是讓人放棄註冊。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { Register } from './Register'

function renderRegister(options: MockOptions = {}) {
  const handles = mockApi(options)
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<h1>房源</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

/** 把四格填滿。密碼確認預設與密碼相同。 */
async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { password?: string; confirm?: string } = {},
) {
  await user.type(screen.getByLabelText('電子郵件'), 'new@example.com')
  await user.type(screen.getByLabelText('顯示名稱'), '新來的')
  await user.type(screen.getByLabelText('密碼'), overrides.password ?? 'secret123')
  await user.type(
    screen.getByLabelText('再次輸入密碼'),
    overrides.confirm ?? overrides.password ?? 'secret123',
  )
}

const EMAIL_TAKEN = {
  status: 409,
  body: { detail: '此電子郵件已被註冊。', code: 'EMAIL_TAKEN', field: 'email' },
}

const PASSWORD_TOO_SHORT = {
  status: 400,
  body: { detail: '密碼需至少 6 個字元。', code: 'PASSWORD_TOO_SHORT', field: 'password' },
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('註冊成功', () => {
  it('送出三個欄位並進入站內', async () => {
    const user = userEvent.setup()
    const { calls } = renderRegister()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
    })

    const registerCall = calls.find((c) => c.path.endsWith('/auth/register'))
    expect(registerCall?.body).toEqual({
      email: 'new@example.com',
      displayName: '新來的',
      password: 'secret123',
    })
    // ⚠️ 密碼確認是前端的事，MUST NOT 送給後端——它對後端沒有意義，
    // 送過去只是讓明文密碼多出現一次。
    expect(JSON.stringify(registerCall?.body)).not.toContain('passwordConfirm')
  })
})

describe('⚠️ 失敗時 MUST 保留其他已填欄位（FR-083）', () => {
  it('email 撞號時，顯示名稱與兩次密碼都還在', async () => {
    const user = userEvent.setup()
    renderRegister({ onRegister: () => EMAIL_TAKEN })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    await screen.findByRole('alert')
    // 他唯一要改的是 email。把另外三格清掉會讓他直接放棄。
    expect(screen.getByLabelText('顯示名稱')).toHaveValue('新來的')
    expect(screen.getByLabelText('密碼')).toHaveValue('secret123')
    expect(screen.getByLabelText('再次輸入密碼')).toHaveValue('secret123')
    expect(screen.getByLabelText('電子郵件')).toHaveValue('new@example.com')
  })
})

describe('逐欄錯誤與焦點（FR-002、FR-009b、FR-010）', () => {
  it('email 已被註冊 → 訊息與焦點都在 email 欄', async () => {
    const user = userEvent.setup()
    renderRegister({ onRegister: () => EMAIL_TAKEN })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() => {
      expect(screen.getByLabelText('電子郵件')).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('此電子郵件已被註冊')
    expect(screen.getByLabelText('電子郵件')).toHaveAttribute('aria-invalid', 'true')
  })

  it('密碼太短 → 焦點在密碼欄', async () => {
    const user = userEvent.setup()
    renderRegister({ onRegister: () => PASSWORD_TOO_SHORT })

    await fillForm(user, { password: 'abc' })
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() => {
      expect(screen.getByLabelText('密碼')).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('至少 6 個字元')
  })
})

describe('兩次密碼不一致', () => {
  it('⚠️ 由前端擋下——後端只收一個 password，它根本看不到這個問題', async () => {
    const user = userEvent.setup()
    const { calls } = renderRegister()

    await fillForm(user, { password: 'secret123', confirm: 'secret124' })
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() => {
      expect(screen.getByLabelText('再次輸入密碼')).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('兩次輸入的密碼不相同')
    // 連送都不該送
    expect(calls.some((c) => c.path.endsWith('/auth/register'))).toBe(false)
  })
})

describe('展示用專案警語', () => {
  it('註冊頁也 MUST 提醒勿使用真實密碼（FR-006）', () => {
    renderRegister()
    expect(screen.getByText(/不要沿用你在其他網站的真實密碼/)).toBeInTheDocument()
  })

  it('密碼欄的說明提到 6 字元下限，但判定交給後端', () => {
    renderRegister()
    expect(screen.getByText(/至少 6 個字元/)).toBeInTheDocument()
  })
})
