/**
 * T089／T090／T093 的驗證（FR-020、FR-021、FR-027 ~ FR-029、FR-083）。
 *
 * 這一份裡最重要的一支測試是「畫面上沒有任何真實支付欄位」——它不是斷言某個
 * 元素不存在，而是**掃描整棵 DOM 的每一個輸入框**。前者只擋得住已知的那一個，
 * 後者擋得住日後任何人「順手加個卡號欄位讓畫面完整一點」。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import { AuthProvider } from '../state/AuthContext'
import { MEMBER, makeOrder, makeRoomDetail, mockApi } from '../test/mockApi'
import type { MockOptions } from '../test/mockApi'
import { Booking } from './Booking'

const ROOM_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

/** 導覽到哪裡去了。訂單成立後 MUST 前往確認頁（FR-031）。 */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="here">{location.pathname}</div>
}

function renderBooking(options: MockOptions = {}) {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, roomDetail: makeRoomDetail(), ...options })
  render(
    <MemoryRouter initialEntries={[`/booking/${ROOM_ID}?checkIn=2026-09-01&checkOut=2026-09-03`]}>
      <AuthProvider>
        <Routes>
          <Route path="/booking/:roomId" element={<Booking />} />
          <Route path="*" element={<div>已離開訂房流程</div>} />
        </Routes>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

/**
 * 走完第一步。
 *
 * ⚠️ 姓名與 email 要先 `clear`：它們**已經**帶入了登入者的資料，直接 `type`
 * 會接在後面變成「測試會員王小明」。
 */
async function fillStepOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('入住人數'), '2')
  await user.clear(screen.getByLabelText('聯絡姓名'))
  await user.type(screen.getByLabelText('聯絡姓名'), '王小明')
  await user.type(screen.getByLabelText('聯絡電話'), '0912345678')
  await user.clear(screen.getByLabelText('電子郵件'))
  await user.type(screen.getByLabelText('電子郵件'), 'guest@example.com')
  await user.click(screen.getByRole('button', { name: '下一步' }))
}

async function chooseLinePay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: /LINE Pay/ }))
  await user.click(screen.getByRole('button', { name: '下一步' }))
}

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('三步驟流程（FR-020）', () => {
  it('依序呈現填寫資訊、選擇付款方式、確認送出', async () => {
    const user = userEvent.setup()
    renderBooking()

    expect(await screen.findByLabelText('入住人數')).toBeInTheDocument()
    await fillStepOne(user)

    expect(await screen.findByRole('group', { name: /選擇付款方式/ })).toBeInTheDocument()
    await chooseLinePay(user)

    expect(await screen.findByText('確認訂房內容')).toBeInTheDocument()
  })

  it('第一步未填完時無法前進——但按鈕停用的同時，欄位本身沒有被標成錯誤', async () => {
    const user = userEvent.setup()
    renderBooking()

    await screen.findByLabelText('入住人數')
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    // 使用者還沒填完就先看到一片紅字，是在指責他還沒做的事
    expect(screen.queryAllByRole('alert')).toHaveLength(0)

    await user.type(screen.getByLabelText('入住人數'), '2')
    await user.type(screen.getByLabelText('聯絡姓名'), '王小明')
    await user.type(screen.getByLabelText('聯絡電話'), '0912345678')
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
  })
})

describe('步驟間往返（FR-021）', () => {
  it('回到上一步時，已填內容 MUST 還在', async () => {
    const user = userEvent.setup()
    renderBooking()

    await fillStepOne(user)
    await screen.findByRole('group', { name: /選擇付款方式/ })

    await user.click(screen.getByRole('button', { name: '上一步' }))

    expect(await screen.findByLabelText('聯絡姓名')).toHaveValue('王小明')
    expect(screen.getByLabelText('聯絡電話')).toHaveValue('0912345678')
    expect(screen.getByLabelText('入住人數')).toHaveValue(2)
    expect(screen.getByLabelText('入住日')).toHaveValue('2026-09-01')
  })

  it('第三步往回改付款方式，再前進時第一步的內容仍在', async () => {
    const user = userEvent.setup()
    renderBooking()

    await fillStepOne(user)
    await chooseLinePay(user)
    await screen.findByText('確認訂房內容')

    await user.click(screen.getByRole('button', { name: '修改付款方式' }))
    await user.click(await screen.findByRole('radio', { name: /信用卡/ }))
    await user.click(screen.getByRole('button', { name: '下一步' }))

    const summary = await screen.findByText('確認訂房內容')
    expect(summary).toBeInTheDocument()
    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByText('信用卡')).toBeInTheDocument()
  })

  /**
   * ⚠️ 這一支測的是「預填真的發生了」。
   *
   * 身分是非同步載入的，而預填只能寫在 `useState` 的初始值裡。兩者的時序沒
   * 對好時，三個聯絡欄位會**永遠是空的**——畫面完全正常，只是使用者得自己
   * 再打一次自己的名字。這種漏掉沒有人會回報成 bug。
   */
  it('聯絡資訊以登入者的個人資料預填', async () => {
    renderBooking()
    expect(await screen.findByLabelText('聯絡姓名')).toHaveValue('測試會員')
    expect(screen.getByLabelText('電子郵件')).toHaveValue('member@example.com')
  })

  it('第一步帶入網址上的日期，重整後那兩格因此不會空白', async () => {
    renderBooking()
    expect(await screen.findByLabelText('入住日')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('退房日')).toHaveValue('2026-09-03')
  })
})

describe('付款方式（FR-027 ~ FR-029）', () => {
  it('提供 LINE Pay、信用卡、銀行轉帳三種', async () => {
    const user = userEvent.setup()
    renderBooking()
    await fillStepOne(user)

    const group = await screen.findByRole('group', { name: /選擇付款方式/ })
    expect(within(group).getByRole('radio', { name: /LINE Pay/ })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: /信用卡/ })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: /銀行轉帳/ })).toBeInTheDocument()
  })

  it('明顯標示「虛擬支付，不會產生任何實際交易」（FR-029）', async () => {
    const user = userEvent.setup()
    renderBooking()
    await fillStepOne(user)

    expect(await screen.findByText('虛擬支付，不會產生任何實際交易。')).toBeInTheDocument()
  })

  it('未選付款方式時無法前進', async () => {
    const user = userEvent.setup()
    renderBooking()
    await fillStepOne(user)

    expect(await screen.findByRole('group', { name: /選擇付款方式/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
  })

  /**
   * ⚠️ FR-028 的把關。
   *
   * 掃描**整棵 DOM** 而不是查特定的元素：這一條要擋的是日後任何人加進來的
   * 支付欄位，包括他自己覺得「反正是假的沒關係」的那一個。一個長得像信用卡
   * 表單的東西，會有人把真的卡號打進去。
   */
  it('畫面上沒有任何要求輸入真實卡號、有效期限、CVV 或銀行帳號的欄位', async () => {
    const user = userEvent.setup()
    const container = document.body
    renderBooking()
    await fillStepOne(user)
    await screen.findByRole('group', { name: /選擇付款方式/ })

    const forbidden =
      /卡號|信用卡號|有效期限|到期日|安全碼|驗證碼|cvv|cvc|銀行帳號|帳戶號碼|card ?number|expir|account ?number/i

    const inputs = [...container.querySelectorAll('input, textarea, select')]
    for (const el of inputs) {
      const describedBy = el.getAttribute('aria-label') ?? ''
      const name = el.getAttribute('name') ?? ''
      const placeholder = el.getAttribute('placeholder') ?? ''
      const autoComplete = el.getAttribute('autocomplete') ?? ''
      const id = el.getAttribute('id') ?? ''
      const labelText = id
        ? ([...container.querySelectorAll(`label[for="${id}"]`)].map((l) => l.textContent).join(' '))
        : ''
      const surface = [describedBy, name, placeholder, autoComplete, id, labelText].join(' ')
      expect(surface).not.toMatch(forbidden)
      // 瀏覽器的自動填入提示同樣不能指向支付資料
      expect(autoComplete).not.toMatch(/^cc-/)
    }

    // 走到最後一步再掃一次——確認頁最容易被人加上「補填卡號」
    await chooseLinePay(user)
    await screen.findByText('確認訂房內容')
    for (const el of container.querySelectorAll('input, textarea, select')) {
      const surface = [
        el.getAttribute('aria-label'),
        el.getAttribute('name'),
        el.getAttribute('placeholder'),
        el.getAttribute('autocomplete'),
        el.getAttribute('id'),
      ]
        .filter(Boolean)
        .join(' ')
      expect(surface).not.toMatch(forbidden)
    }
  })
})

describe('確認與送出', () => {
  it('確認頁列出房源、日期、夜數、人數與付款方式', async () => {
    const user = userEvent.setup()
    renderBooking()
    await fillStepOne(user)
    await chooseLinePay(user)
    // 房源名稱在頁首也有一份，所以斷言要限定在摘要區塊裡
    const summary = (await screen.findByText('確認訂房內容')).closest('section')
    expect(summary).not.toBeNull()
    const inSummary = within(summary!)

    expect(inSummary.getByText('海景雙人房 201')).toBeInTheDocument()
    expect(inSummary.getByText('2026/09/01 – 2026/09/03（2 晚）')).toBeInTheDocument()
    expect(inSummary.getByText('2 晚')).toBeInTheDocument()
    expect(inSummary.getByText('2 人')).toBeInTheDocument()
    expect(inSummary.getByText('LINE Pay')).toBeInTheDocument()
    // 預估總金額＝3200 × 2 晚
    expect(inSummary.getByText('NT$ 6,400')).toBeInTheDocument()
  })

  it('送出的內容 MUST NOT 含夜數或總金額——後端自己算（FR-024、FR-032）', async () => {
    const user = userEvent.setup()
    const { calls } = renderBooking()

    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/orders'))).toBe(true)
    })
    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/orders'))?.body
    expect(sent).toMatchObject({
      roomId: ROOM_ID,
      checkIn: '2026-09-01',
      checkOut: '2026-09-03',
      guestCount: 2,
      contactName: '王小明',
      paymentMethod: 'LINE Pay',
    })
    expect(sent).not.toHaveProperty('nights')
    expect(sent).not.toHaveProperty('totalAmount')
  })

  it('成立後前往訂單確認頁', async () => {
    const user = userEvent.setup()
    const order = makeOrder()
    renderBooking({ onOrderCreate: () => order })

    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))

    await waitFor(() => {
      expect(screen.getByTestId('here')).toHaveTextContent(`/orders/${order.id}/confirmed`)
    })
  })
})

describe('送出失敗（FR-083）', () => {
  const CONFLICT = {
    status: 409,
    body: {
      detail: '此房源於所選日期已無空房，請改選其他日期或房源。',
      code: 'ROOM_UNAVAILABLE',
    },
  }

  it('顯示後端給的理由，且已填內容 MUST 全部保留', async () => {
    const user = userEvent.setup()
    renderBooking({ onOrderCreate: () => CONFLICT })

    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '此房源於所選日期已無空房，請改選其他日期或房源。',
    )
    // 退回第一步讓他改日期——而**內容還在**，不必從頭填一次
    expect(await screen.findByLabelText('聯絡姓名')).toHaveValue('王小明')
    expect(screen.getByLabelText('入住人數')).toHaveValue(2)
    expect(screen.getByLabelText('電子郵件')).toHaveValue('guest@example.com')
  })

  it('MUST NOT 假裝成功——失敗時不導覽、也不寫進本機儲存', async () => {
    const user = userEvent.setup()
    /*
     * 監看 `Storage.prototype.setItem` 而不是事後翻 `localStorage` 的鍵：
     * 這樣連 `sessionStorage` 也一起蓋住，而且抓得到「寫進去又刪掉」的情況。
     */
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderBooking({ onOrderCreate: () => CONFLICT })

    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))
    await screen.findByRole('alert')

    expect(screen.getByTestId('here')).toHaveTextContent(`/booking/${ROOM_ID}`)
    // 憲章原則 III：業務資料 MUST NOT 進本機儲存。假裝成功最常見的做法就是
    // 先存起來「之後再送」——那筆訂單永遠不會存在，而使用者以為訂到了。
    expect(setItem.mock.calls.filter(([key]) => key !== 'sunny.accessToken')).toEqual([])
  })

  it('連不上伺服器與被伺服器拒絕，說的是不同的話（FR-084）', async () => {
    const user = userEvent.setup()
    renderBooking({ onOrderCreate: () => CONFLICT })
    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('無法連線至伺服器')
  })

  it('後端指名的欄位會拿到焦點（FR-010）', async () => {
    const user = userEvent.setup()
    renderBooking({
      onOrderCreate: () => ({
        status: 400,
        body: {
          detail: '入住人數超過此房源的上限。',
          code: 'GUEST_COUNT_EXCEEDS_MAX',
          field: 'guestCount',
        },
      }),
    })

    await fillStepOne(user)
    await chooseLinePay(user)
    await user.click(await screen.findByRole('button', { name: '確認送出' }))

    await waitFor(() => {
      expect(screen.getByLabelText('入住人數')).toHaveFocus()
    })
  })
})

describe('逾期清理輪詢（T093a）', () => {
  it('訂房流程 MUST NOT 觸發背景查詢', async () => {
    vi.useFakeTimers()
    try {
      const { calls } = renderBooking()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      // 只該有房源詳情那一次；背景輪詢會多打 `/rooms`
      expect(calls.filter((c) => c.method === 'GET' && c.path.endsWith('/rooms'))).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
