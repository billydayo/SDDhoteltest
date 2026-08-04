/**
 * T040 的驗證：路由守衛的三種身分。
 *
 * ⚠️ 守衛**不是**安全機制，這些測試也不是安全測試。真正的存取邊界在 FastAPI，
 * 由 `backend/tests/contract/` 的授權三案例把關。這裡驗的是**畫面呈現正確**：
 * 沒登入的人被帶去登入頁、登入了但權限不足的人看到 403 而不是又被叫去登入。
 *
 * 後者最容易寫錯，而錯法很隱蔽：把「非管理員」也導向登入頁。已經登入的人
 * 被要求再登入一次，會反覆嘗試自己明明正確的密碼。
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from './api/client'
import { AppRoutes } from './router'
import { AuthProvider } from './state/AuthContext'
import type { Profile } from './api/types'

const MEMBER: Profile = {
  id: 'ffffffff-0000-0000-0000-000000000001',
  email: 'member@example.com',
  role: 'member',
  displayName: '測試會員',
  phone: null,
  createdAt: '2026-08-01T00:00:00Z',
}

const ADMIN: Profile = { ...MEMBER, id: '...2', email: 'admin@example.com', role: 'admin' }

function mockMe(profile: Profile | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/me')) {
      if (profile === null) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: '請先登入。', code: 'NOT_AUTHENTICATED' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(profile), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

describe('公開路由', () => {
  it('未登入也能看房源列表', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: '房源' })).toBeInTheDocument()
  })

  it('未登入也能看服務條款', () => {
    renderAt('/terms')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('服務條款')
  })

  it('不存在的路徑顯示找不到頁面，且給得出回去的路', () => {
    renderAt('/nowhere-at-all')
    expect(screen.getByRole('heading', { level: 1, name: '找不到這個頁面' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到房源列表' })).toBeInTheDocument()
  })
})

describe('需登入的路由', () => {
  it('未登入時導向登入頁', async () => {
    renderAt('/orders')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
  })

  it('已登入時正常顯示', async () => {
    setToken('fake-token')
    mockMe(MEMBER)
    renderAt('/orders')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '我的訂單' })).toBeInTheDocument()
    })
  })

  it('⚠️ 判定完成前 MUST NOT 閃過登入頁', () => {
    setToken('fake-token')
    mockMe(MEMBER)
    renderAt('/orders')
    // 第一次繪製時 /me 尚未回來。此刻若顯示登入頁，已登入的使用者每次重新
    // 整理都會看到自己「被登出」一瞬間。
    expect(screen.queryByRole('heading', { level: 1, name: '登入' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('僅管理員的路由', () => {
  it('未登入時導向登入頁', async () => {
    renderAt('/admin')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
  })

  it('⚠️ 已登入的一般會員看到「沒有存取權限」，MUST NOT 被叫去再登入一次', async () => {
    setToken('fake-token')
    mockMe(MEMBER)
    renderAt('/admin')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '沒有存取權限' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { level: 1, name: '登入' })).not.toBeInTheDocument()
  })

  it('管理員正常進入', async () => {
    setToken('fake-token')
    mockMe(ADMIN)
    renderAt('/admin')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '後台' })).toBeInTheDocument()
    })
  })
})

describe('頁首導覽', () => {
  it('未登入時 MUST NOT 出現後台與訂單入口', async () => {
    renderAt('/')
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '登入' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: '後台' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '我的訂單' })).not.toBeInTheDocument()
  })

  it('一般會員看得到訂單但看不到後台', async () => {
    setToken('fake-token')
    mockMe(MEMBER)
    renderAt('/')
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '我的訂單' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: '後台' })).not.toBeInTheDocument()
  })

  it('管理員兩者都看得到', async () => {
    setToken('fake-token')
    mockMe(ADMIN)
    renderAt('/')
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '後台' })).toBeInTheDocument()
    })
  })
})

describe('版面地標', () => {
  it('有 banner／main／contentinfo 三個地標與跳至主要內容連結', () => {
    renderAt('/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '跳至主要內容' })).toBeInTheDocument()
  })

  it('頁尾載明本站不提供真實住宿服務（FR-121）', () => {
    renderAt('/')
    expect(screen.getByRole('contentinfo')).toHaveTextContent('不提供真實住宿服務')
    expect(screen.getByRole('link', { name: '服務條款與隱私聲明' })).toBeInTheDocument()
  })
})
