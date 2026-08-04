/**
 * T125 的驗證：導覽與路由不分歧。
 *
 * `modules.tsx` 宣稱「由同一份陣列展開，因此路由存在而導覽沒有（或反之）在
 * 結構上不可能發生」。那是一句設計上的主張，而主張要有東西守著——有人某天
 * 覺得「這個模組比較特別」而把它的 `<Route>` 手寫在 router.tsx 裡時，
 * 這些測試會失敗。
 *
 * ⚠️ 這裡驗的是**畫面呈現**，不是授權。真正的存取邊界在 FastAPI 的
 * `require_admin`（憲章原則 VI），由 `backend/tests/contract/test_admin_authz.py`
 * 逐一驗證每一支後台端點。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import type { Profile } from '../../api/types'
import { AppRoutes } from '../../router'
import { AuthProvider } from '../../state/AuthContext'
import { ADMIN_MODULES } from './modules'

const ADMIN: Profile = {
  id: 'ffffffff-0000-0000-0000-000000000002',
  email: 'admin@example.com',
  role: 'admin',
  displayName: '測試管理員',
  phone: null,
  createdAt: '2026-08-01T00:00:00Z',
}

/**
 * 各端點的最小回應。
 *
 * ⚠️ **預設是 `[]` 而不是 `{}`。** 後台十二個模組裡多數是清單，而一個回
 * `{}` 的假 API 會讓頁面在 `.map` 上炸開——那是假資料的問題，不是頁面的
 * 問題，卻會讓人以為頁面壞了。
 */
const FIXTURES: Record<string, unknown> = {
  '/api/me': ADMIN,
  '/api/vocabulary': { amenities: [], features: [] },
  '/api/admin/dashboard': {
    totalOrders: 0,
    todayCheckIns: 0,
    todayCheckOuts: 0,
    roomsAvailable: 0,
    roomsBooked: 0,
    roomsMaintenance: 0,
    pendingReviews: 0,
    pendingRefunds: 0,
    pendingChannelAlerts: 0,
    monthRevenue: 0,
  },
  // ⚠️ `conversionRate` 與 `averageOrderValue` 在無訂單時是 **null**，
  // 不是 0（`schemas/admin.py`）。假資料照著真形狀走，畫面才會被測到
  // 「顯示為『—』」的那一條路徑。
  '/api/admin/orders/stats': {
    totalOrders: 0,
    placedOrders: 0,
    paidOrders: 0,
    unpaidCancelledOrders: 0,
    revenue: 0,
    conversionRate: null,
    averageOrderValue: null,
  },
  // ⚠️ 可接受範圍隨值一起回傳，前端 MUST NOT 自己硬編（FR-119、FR-120）。
  '/api/admin/settings': {
    pendingPaymentMinutes: 30,
    roomAmenities: [],
    roomFeatures: [],
    pendingPaymentMin: 5,
    pendingPaymentMax: 1440,
  },
}

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const { pathname } = new URL(url, 'http://localhost')
    return Promise.resolve(
      new Response(JSON.stringify(FIXTURES[pathname] ?? []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
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
  setToken('fake-token')
  mockApi()
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('後台佈局', () => {
  it('十二個模組全部出現在導覽裡（FR-049 ~ FR-062 的後台範圍）', async () => {
    renderAt('/admin')
    const nav = await screen.findByRole('navigation', { name: '後台模組' })

    expect(ADMIN_MODULES).toHaveLength(12)
    for (const module of ADMIN_MODULES) {
      expect(
        within(nav).getByRole('link', { name: module.label }),
        `導覽缺少「${module.label}」`,
      ).toBeInTheDocument()
    }
  })

  it('標題層級為「後台（h1）＞ 模組（h2）」', async () => {
    renderAt('/admin')
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '後台' })).toBeInTheDocument()
    })
    // 索引頁是營運總覽。它是後台之內的一個區塊，不是另一份文件。
    expect(await screen.findByRole('heading', { level: 2, name: '營運總覽' })).toBeInTheDocument()
  })
})

describe('每一個導覽目的地都有對應的路由', () => {
  // ⚠️ 這是本檔的重點。導覽上有一個點了會掉到「找不到頁面」的連結，
  // 不會有任何錯誤，也不會有其他測試失敗。
  for (const module of ADMIN_MODULES) {
    it(`/admin/${module.path} 顯示「${module.label}」而非找不到頁面`, async () => {
      renderAt(module.path ? `/admin/${module.path}` : '/admin')

      // 後台的佈局還在——沒有掉出 `AdminLayout`
      await waitFor(() => {
        expect(screen.getByRole('navigation', { name: '後台模組' })).toBeInTheDocument()
      })
      expect(screen.queryByRole('heading', { name: '找不到這個頁面' })).not.toBeInTheDocument()

      // 且顯示的是這個模組的內容（尚未建立者由 Placeholder 頂著，標題相同）
      expect(
        await screen.findByRole('heading', { level: 2, name: module.label }),
      ).toBeInTheDocument()
    })
  }
})
