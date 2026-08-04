/**
 * T112／T114 的驗證（FR-042 ~ FR-045、FR-083、FR-103a）。
 *
 * 四條，每一條擋的都是「使用者會再寫一次」的那種失敗：
 *
 * 1. **已評論過時 MUST NOT 顯示表單**（FR-043）——顯示的話他打完一段字才被
 *    409 拒絕，而那段字就沒了。
 * 2. **送出後 MUST 說明還沒公開**（FR-045）——不說的話他回房源頁找不到，
 *    合理地認為送出失敗，然後再寫一次。
 * 3. **失敗時 MUST 保留已填內容**（FR-083）。
 * 4. **MUST 標示為「自動審核（規則式）」，MUST NOT 出現 AI**（FR-103a）。
 *
 * 透過完整的 `AppRoutes` 渲染：這一頁的入口與返回都是路由，單掛元件的話
 * `useParams` 拿不到 `orderId`。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { AppRoutes } from '../router'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeMyReview, makeOrder, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'

const ORDER_ID = 'bbbbbbbb-0000-0000-0000-000000000001'

const COMPLETED = makeOrder({ id: ORDER_ID, status: 'completed' })

function renderForm(options: MockOptions = {}) {
  mockApi({ profile: MEMBER, orders: [COMPLETED], ...options })
  return render(
    <MemoryRouter initialEntries={[`/orders/${ORDER_ID}/review`]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setToken('fake-token')
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('撰寫評論（T112）', () => {
  it('已完成入住的訂單看得到表單', async () => {
    renderForm()
    expect(await screen.findByRole('heading', { level: 1, name: '撰寫評論' })).toBeInTheDocument()
    expect(screen.getByLabelText('評論內容')).toBeInTheDocument()
  })

  it('送出的內容含評分、類型與訂單 id，且不含 roomId', async () => {
    /*
     * ⚠️ **`roomId` MUST NOT 出現在請求裡。** 能指定房源就能拿 A 房的訂單去評
     * B 房，而那則評分會計入 B 房的平均（FR-046）——後端因此從訂單推導。
     * 這裡斷言的是前端沒有替它加回來。
     */
    const calls: MockOptions['calls'] = []
    const user = userEvent.setup()
    renderForm({ calls })

    await screen.findByLabelText('評論內容')
    await user.type(screen.getByLabelText('評論內容'), '房間寬敞，早餐選擇也多。')
    await user.click(screen.getByRole('radio', { name: '4 分（滿意）' }))
    await user.selectOptions(screen.getByLabelText('評論類型'), '清潔與衛生')
    await user.click(screen.getByRole('button', { name: '送出評論' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/reviews'))).toBe(true)
    })
    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))
    expect(sent?.body).toEqual({
      orderId: ORDER_ID,
      rating: 4,
      comment: '房間寬敞，早餐選擇也多。',
      category: '清潔與衛生',
    })
    expect(sent?.body).not.toHaveProperty('roomId')
  })

  it('⚠️ 送出後 MUST 說明尚未公開（FR-045）', async () => {
    const user = userEvent.setup()
    renderForm()

    await screen.findByLabelText('評論內容')
    await user.type(screen.getByLabelText('評論內容'), '很值得再訪的一間房。')
    await user.click(screen.getByRole('button', { name: '送出評論' }))

    // 只說「送出成功」的話，他回房源頁找不到自己的評論會以為失敗了
    expect(await screen.findByText(/評論已送出，正在等待審核/)).toBeInTheDocument()
  })

  it('⚠️ 失敗時 MUST 保留已填內容（FR-083）', async () => {
    const user = userEvent.setup()
    renderForm({
      onReviewCreate: () => ({
        status: 409,
        body: { detail: '此訂單已撰寫過評論。', code: 'REVIEW_EXISTS' },
      }),
    })

    await screen.findByLabelText('評論內容')
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('評論內容')
    await user.type(textarea, '這段字重打一次很花時間。')
    await user.click(screen.getByRole('button', { name: '送出評論' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('此訂單已撰寫過評論。')
    expect(textarea.value).toBe('這段字重打一次很花時間。')
  })
})

describe('⚠️ 已評論過（FR-043）', () => {
  it('顯示既有那一則，MUST NOT 顯示一個必定失敗的表單', async () => {
    renderForm({
      myReviews: [makeMyReview({ orderId: ORDER_ID, comment: '我上次寫的內容。' })],
    })

    expect(await screen.findByText(/這筆訂單已經評論過了/)).toBeInTheDocument()
    expect(screen.getByText('我上次寫的內容。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '送出評論' })).not.toBeInTheDocument()
  })

  it('⚠️ 待審核與已駁回要分開講', async () => {
    // 統統說成「已送出」的話，被駁回的人會一直等一則永遠不會出現的評論
    renderForm({ myReviews: [makeMyReview({ orderId: ORDER_ID, status: 'rejected' })] })
    expect(await screen.findByText(/未通過審核，因此不會顯示/)).toBeInTheDocument()
  })

  it('別筆訂單的評論不算數', async () => {
    // 用 orderId 比對而不是「有沒有評論過」——後者會讓第二筆訂單也寫不了
    renderForm({ myReviews: [makeMyReview({ orderId: 'another-order' })] })
    expect(await screen.findByRole('heading', { level: 1, name: '撰寫評論' })).toBeInTheDocument()
  })
})

describe('尚未完成入住（FR-042）', () => {
  it('不顯示表單，並說明何時才能寫', async () => {
    renderForm({ orders: [makeOrder({ id: ORDER_ID, status: 'confirmed' })] })

    expect(await screen.findByText(/這筆訂單還不能評論/)).toBeInTheDocument()
    expect(screen.getByText(/入住結束後就可以撰寫評論/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '送出評論' })).not.toBeInTheDocument()
  })
})

describe('⚠️ 自動審核的措辭（T114、FR-103a）', () => {
  it('標示為「自動審核（規則式）」', async () => {
    renderForm()
    expect(await screen.findByText(/自動審核（規則式）/)).toBeInTheDocument()
  })

  it('⚠️ 整頁 MUST NOT 出現「AI」或「人工智慧」', async () => {
    // 這是規則式引擎。稱它為 AI 是對使用者的不實陳述（憲章原則 VI）
    const { container } = renderForm()
    await screen.findByLabelText('評論內容')
    expect(container.textContent).not.toMatch(/AI|人工智慧/i)
  })
})
