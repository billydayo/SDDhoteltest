/**
 * T056／T060 的驗證（FR-010、FR-012、FR-018）。
 *
 * 重點放在三條容易在重構中失守的規則，它們的共同點是**失守時畫面看起來
 * 完全正常**：首次載入偷偷帶了條件、切頁籤把使用者勾好的設施清掉、
 * 無結果時給一片空白。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { makeRoom, mockApi } from '../test/mockApi'
import { Home } from './Home'

function renderHome() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Home />
      </AuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('首次載入', () => {
  it('⚠️ MUST 顯示全部房源——不帶任何篩選參數（US1 的前提）', async () => {
    const { roomQueries } = mockApi({ rooms: [makeRoom(), makeRoom({ id: 'b', name: '山景房' })] })
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('共 2 間房源')).toBeInTheDocument()
    })
    // 訪客不必填任何條件就能瀏覽。查詢字串必須是空的。
    expect(roomQueries.every((q) => q === '')).toBe(true)
  })

  it('MUST NOT 執行條件檢查——沒有任何錯誤訊息', async () => {
    mockApi()
    renderHome()
    await waitFor(() => {
      expect(screen.getByText('共 1 間房源')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('房型頁籤（FR-012）', () => {
  it('⚠️ 切換 MUST NOT 清除其他篩選條件', async () => {
    const user = userEvent.setup()
    const { roomQueries } = mockApi({
      rooms: [makeRoom({ type: '雙人房' }), makeRoom({ id: 'b', name: '家庭房', type: '家庭房' })],
    })
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('共 2 間房源')).toBeInTheDocument()
    })

    // 先設一個條件並送出
    await user.type(screen.getByLabelText('關鍵字'), '海景')
    await user.click(screen.getByRole('button', { name: '搜尋' }))
    await waitFor(() => {
      expect(roomQueries.at(-1)).toContain('keyword=')
    })

    // 再切房型頁籤
    await user.click(screen.getByRole('tab', { name: '家庭房' }))

    await waitFor(() => {
      expect(roomQueries.at(-1)).toContain('type=')
    })
    // **關鍵字必須還在**。切頁籤把使用者勾好的條件清掉，他不會再勾第二次。
    expect(roomQueries.at(-1)).toContain('keyword=')
    expect(screen.getByLabelText('關鍵字')).toHaveValue('海景')
  })

  it('頁籤選項由全部房源推導，不隨篩選結果消失', async () => {
    mockApi({
      rooms: [makeRoom({ type: '雙人房' }), makeRoom({ id: 'b', type: '家庭房' })],
    })
    renderHome()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '雙人房' })).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: '家庭房' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument()
  })
})

describe('排序', () => {
  it('切換排序送出 sort 參數', async () => {
    const user = userEvent.setup()
    const { roomQueries } = mockApi()
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('共 1 間房源')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('排序'), 'price_asc')
    await waitFor(() => {
      expect(roomQueries.at(-1)).toContain('sort=price_asc')
    })
  })
})

describe('空狀態（FR-018）', () => {
  it('⚠️ 有下條件卻無結果時 MUST 給調整建議，MUST NOT 是空白畫面', async () => {
    const user = userEvent.setup()
    mockApi({ rooms: [] })
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('目前尚無房源')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('關鍵字'), '不存在的房')
    await user.click(screen.getByRole('button', { name: '搜尋' }))

    await waitFor(() => {
      expect(screen.getByText('查無符合條件的房源')).toBeInTheDocument()
    })
    expect(screen.getByText(/放寬價格上限/)).toBeInTheDocument()
  })

  it('沒下條件也無結果時給的是不同的訊息', async () => {
    mockApi({ rooms: [] })
    renderHome()
    await waitFor(() => {
      expect(screen.getByText('目前尚無房源')).toBeInTheDocument()
    })
    // 沒下條件卻沒結果是資料問題，叫使用者「放寬條件」毫無幫助
    expect(screen.queryByText(/放寬價格上限/)).not.toBeInTheDocument()
  })
})

describe('後端不可用（FR-084）', () => {
  it('MUST 顯示可理解訊息，MUST NOT 無限轉圈或退回本機假資料', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    renderHome()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((el) => el.textContent).join(' ')).toContain('無法連線至伺服器')
    // 沒有任何假房源被渲染出來
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('⚠️ 連線錯誤 MUST NOT 同時印在篩選列與結果區', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    renderHome()

    await screen.findByRole('alert')
    // 同一句話出現兩次，使用者會以為是兩個不同的問題
    expect(screen.getAllByText(/無法連線至伺服器/)).toHaveLength(1)
    expect(screen.getByRole('button', { name: '重新載入' })).toBeInTheDocument()
  })
})

describe('條件錯誤的歸屬（FR-010、FR-018）', () => {
  it('⚠️ 400 交給篩選列逐欄指出，MUST NOT 把已顯示的房源換成錯誤畫面', async () => {
    const user = userEvent.setup()
    let reject = false
    mockApi({
      onRooms: () =>
        reject
          ? {
              status: 400,
              body: {
                detail: '填寫入住日時，退房日也需一併填寫。',
                code: 'INCOMPLETE_DATE_FILTER',
                field: 'check_out',
              },
            }
          : null,
    })
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('共 1 間房源')).toBeInTheDocument()
    })

    reject = true
    await user.type(screen.getByLabelText('關鍵字'), '海景')
    await user.click(screen.getByRole('button', { name: '搜尋' }))

    await waitFor(() => {
      expect(screen.getByLabelText('退房日')).toHaveFocus()
    })
    // 少填一欄就把他剛才看到的房源全收走，是最惹人惱的失敗方式
    expect(screen.getByText('共 1 間房源')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新載入' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/退房日也需一併填寫/)).toHaveLength(1)
  })
})

describe('房源卡片（T054）', () => {
  it('顯示房名、房型、人數上限、價格與評分', async () => {
    mockApi({ rooms: [makeRoom({ name: '海景雙人房 201', nightlyPrice: 3200, maxGuests: 2 })] })
    renderHome()

    const card = await screen.findByRole('article')
    expect(within(card).getByRole('link', { name: '海景雙人房 201' })).toBeInTheDocument()
    expect(within(card).getByText('雙人房 · 最多 2 人')).toBeInTheDocument()
    expect(within(card).getByText('NT$ 3,200')).toBeInTheDocument()
    expect(within(card).getByText('4.5')).toBeInTheDocument()
  })

  it('⚠️ 尚無評分顯示「尚無評分」，MUST NOT 顯示 0（FR-047）', async () => {
    mockApi({ rooms: [makeRoom({ averageRating: null })] })
    renderHome()

    const card = await screen.findByRole('article')
    expect(within(card).getByText('尚無評分')).toBeInTheDocument()
    expect(within(card).queryByText('0.0')).not.toBeInTheDocument()
  })

  it('整理中的房源標示原因', async () => {
    mockApi({ rooms: [makeRoom({ status: 'maintenance' })] })
    renderHome()
    expect(await screen.findByText('整理中，暫時無法預訂')).toBeInTheDocument()
  })
})
