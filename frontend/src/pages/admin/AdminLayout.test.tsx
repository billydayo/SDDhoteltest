/**
 * T125 的驗證：十二個模組的導覽。
 *
 * 透過完整的 `AppRoutes` 以管理員身分渲染，而不是單獨掛 `AdminLayout`——
 * 這裡要驗的其中一件事是「守衛之後才看得到導覽」，單獨掛元件會把守衛跳過去。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import { AppRoutes } from '../../router'
import { AuthProvider } from '../../state/AuthContext'
import { ADMIN, mockApi } from '../../test/mockApi'

function renderAdmin(path = '/admin') {
  mockApi({ profile: ADMIN })
  setToken('fake-token')
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

const MODULES = [
  '儀表板',
  '房源管理',
  '訂單管理',
  '用戶管理',
  '評論審核',
  '退款審核',
  '會員訊息',
  '房源品質檢測',
  '內容編輯',
  '渠道比價與控價',
  '操作日誌',
  '系統與參數設定',
]

describe('後台導覽（T125）', () => {
  it('十二個模組全部列出', async () => {
    renderAdmin()

    const nav = await screen.findByRole('navigation', { name: '後台模組' })
    for (const label of MODULES) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(12)
  })

  /**
   * ⚠️ 匯出 MUST 嵌在各資料頁面內，MUST NOT 另設獨立分頁（FR-058、SC-033）。
   *
   * 這條規則的失效方式是「補齊」：有人看到企劃書列了「報表匯出」，覺得少一項
   * 而把它加回來——而獨立分頁取不到其他頁面的篩選條件，匯出的必然是全表。
   * 看起來更完整，實際上正好違反規格。
   */
  it('⚠️ MUST NOT 出現獨立的「報表匯出」模組', async () => {
    renderAdmin()

    const nav = await screen.findByRole('navigation', { name: '後台模組' })
    expect(within(nav).queryByRole('link', { name: /報表匯出/ })).not.toBeInTheDocument()
  })

  it('進入子模組後仍看得到導覽', async () => {
    renderAdmin('/admin/users')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '用戶管理' })).toBeInTheDocument()
    })
    expect(screen.getByRole('navigation', { name: '後台模組' })).toBeInTheDocument()
  })
})
