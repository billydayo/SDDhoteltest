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

import { getToken, setToken } from './api/client'
import { AppRoutes } from './router'
import { AuthProvider } from './state/AuthContext'
import { ADMIN, MEMBER, mockApi } from './test/mockApi'
import type { Profile } from './api/types'

/**
 * 換上帶指定身分的假後端。
 *
 * ⚠️ 用共用的 `mockApi` 而不是就地寫一個只認得 `/me`、其餘一律回 `{}` 的
 * 版本：`/` 現在是真的首頁，它會去要 `/rooms`。回 `{}` 的話 `rooms.map`
 * 會炸，而症狀會出現在一個看起來與房源無關的路由測試裡。
 */
function mockMe(profile: Profile | null) {
  mockApi(profile ? { profile } : {})
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
  // 預設：未登入的訪客 + 一間房源。需要其他身分的測試再呼叫 mockMe 覆蓋。
  mockApi()
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('公開路由', () => {
  it('未登入也能看房源列表', async () => {
    renderAt('/')
    // 主視覺標題即 h1。房源卡片本身要真的出現——只驗標題的話，
    // 一個永遠在載入中的列表也會通過。
    expect(screen.getByRole('heading', { level: 1, name: 'Sunny 訂房平台' })).toBeInTheDocument()
    expect(await screen.findByRole('article')).toBeInTheDocument()
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

  it('管理員正常進入，落在營運總覽', async () => {
    setToken('fake-token')
    mockMe(ADMIN)
    renderAt('/admin')
    // 標題層級是「後台（h1）＞ 模組（h2）」——後台是一個主控台的十二個區塊，
    // 不是十二份彼此無關的文件（`pages/admin/AdminLayout.tsx`）。
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '後台' })).toBeInTheDocument()
    })
    expect(await screen.findByRole('heading', { level: 2, name: '營運總覽' })).toBeInTheDocument()
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

describe('⚠️ 後端不可用 MUST NOT 被表現為「你沒登入」（FR-084、FR-009d）', () => {
  /**
   * 這一組來自一次**正式站的實測**。2026-08-05 部署期間 Caddy 對 `/api/me` 回了
   * 四個 502，稽核腳本裡的管理員工作階段當場被判定為未登入、丟到登入頁。
   *
   * 當時 `AuthContext` 把 `/me` 的所有失敗都收斂成 `anonymous`，註解還寫著
   * 「後端沒開⋯⋯都當成未登入處理」。那個決定在「整站仍可瀏覽」這件事上是對的，
   * 在「告訴使用者發生什麼事」這件事上是錯的——而後者才是 FR-084 要的。
   *
   * **失敗的樣子**：使用者的 token 完全有效，卻被要求重新登入；他輸入正確的
   * 密碼，那次登入同樣失敗（後端還是沒回應）。兩次挫折，零個有用的資訊。
   */
  const GATEWAY_DOWN = {
    status: 502,
    body: { detail: '上游無回應。', code: 'BAD_GATEWAY' },
  }

  it('502 時顯示可理解的訊息，MUST NOT 導向登入頁', async () => {
    setToken('fake-token')
    mockApi({ profile: ADMIN, meError: GATEWAY_DOWN })
    renderAt('/admin')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('目前無法確認登入狀態')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('你並沒有被登出')
    expect(screen.queryByRole('heading', { level: 1, name: '登入' })).not.toBeInTheDocument()
  })

  it('⚠️ token MUST NOT 被清掉——它多半還是好的', async () => {
    setToken('fake-token')
    mockApi({ profile: MEMBER, meError: GATEWAY_DOWN })
    renderAt('/orders')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    // 清掉它，等於把一次幾秒鐘的伺服器抖動變成一次真正的登出
    expect(getToken()).toBe('fake-token')
  })

  it('需登入的一般頁面同樣不被導向登入頁', async () => {
    setToken('fake-token')
    mockApi({ profile: MEMBER, meError: GATEWAY_DOWN })
    renderAt('/favorites')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('目前無法確認登入狀態')
    })
    expect(screen.queryByRole('heading', { level: 1, name: '登入' })).not.toBeInTheDocument()
  })

  it('⚠️ 401 仍然導向登入頁（迴歸保護）', async () => {
    /**
     * 上面三條容易被「修」成「任何錯誤都顯示錯誤畫面」，那會走到另一個極端：
     * token 真的過期時，使用者看到的是「伺服器沒有回應」，然後永遠等不到
     * 它回應——因為問題根本不在伺服器。401 是唯一表示「你確實沒登入」的訊號。
     */
    setToken('expired-token')
    mockApi({ profile: null })
    renderAt('/orders')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('版面地標', () => {
  it('有 banner／main／contentinfo 三個地標與跳至主要內容連結', async () => {
    renderAt('/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '跳至主要內容' })).toBeInTheDocument()
    await screen.findByRole('article')
  })

  it('頁尾載明本站不提供真實住宿服務（FR-121）', async () => {
    renderAt('/')
    expect(screen.getByRole('contentinfo')).toHaveTextContent('不提供真實住宿服務')
    expect(screen.getByRole('link', { name: '服務條款與隱私聲明' })).toBeInTheDocument()
    await screen.findByRole('article')
  })
})
