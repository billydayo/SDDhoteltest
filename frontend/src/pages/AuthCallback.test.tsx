/**
 * Google 回程落點的驗證（FR-087、FR-090）。
 *
 * 兩件事在這裡最容易出錯，而兩者的症狀都不是錯誤訊息：
 *
 * 1. token 留在網址列 → 按上一頁就看得到自己的 token
 * 2. 拿 token 的 payload 當身分用 → 已被降權的人還看得到後台入口
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getToken, setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { ADMIN, MEMBER, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { AuthCallback } from './AuthCallback'

function renderCallback(hash: string, options: MockOptions = {}) {
  const handles = mockApi(options)
  render(
    <MemoryRouter initialEntries={[`/auth/callback${hash}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<h1>房源</h1>} />
          <Route path="/login" element={<h1>登入</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

beforeEach(() => {
  setToken(null)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('成功', () => {
  it('收下 token、換到身分、送回首頁', async () => {
    const { calls } = renderCallback('#accessToken=from-google', { profile: MEMBER })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
    })
    expect(getToken()).toBe('from-google')

    // ⚠️ MUST 自己問一次 /me。JWT 的 payload 沒有經過任何驗證，
    // 而且使用者可能在簽發之後被降權。
    expect(calls.some((c) => c.path.endsWith('/me'))).toBe(true)
  })

  it('身分以後端的回覆為準（管理員亦然）', async () => {
    renderCallback('#accessToken=from-google', { profile: ADMIN })
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
    })
    expect(getToken()).toBe('from-google')
  })
})

describe('⚠️ token MUST NOT 留在網址列', () => {
  it('讀完立刻抹掉片段', async () => {
    renderCallback('#accessToken=from-google', { profile: MEMBER })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
    })
    // 留著的話，使用者按上一頁會回到一個網址列上寫著自己 token 的頁面，
    // 而那台電腦可能不是他一個人的。
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('from-google')
  })
})

describe('失敗', () => {
  it('token 換不到身分時清掉它，並退回登入頁', async () => {
    // profile 未給 → mockApi 對 /me 回 401
    renderCallback('#accessToken=stale-token')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
    // 留著一個不管用的 token，整站會表現得像已登入，然後每個請求各自失敗一次
    expect(getToken()).toBeNull()
  })

  it('片段裡帶著錯誤代碼時直接退回登入頁', async () => {
    renderCallback('#error=GOOGLE_CANCELLED')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
    expect(getToken()).toBeNull()
  })

  it('什麼都沒帶時也不會卡在載入中', async () => {
    renderCallback('')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
  })
})
