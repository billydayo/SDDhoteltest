/**
 * T171／SC-011：**訂房流程 MUST 能純以鍵盤完成**（憲章原則 V）。
 *
 * ## 這支測試為什麼要用「一路 Tab 過去」而不是點按鈕
 *
 * 其他測試都用 `user.click()`，而 `click` 對不可聚焦的元素照樣有效——一顆
 * `tabIndex={-1}` 的按鈕、一個被 `pointer-events` 撐起來的 `div`，在那些測試裡
 * 全部通過。鍵盤使用者卻永遠到不了它。
 *
 * 因此這裡**完全不用 click**：只用 `Tab` 移動、用 `Space`／`Enter` 觸發。
 * 走不到的那一步會停在 `tabTo()` 的迴圈上並指名是哪一個控制項。
 *
 * ## 為什麼不寫死 Tab 的次數
 *
 * 「按 7 次 Tab 會到達送出鈕」是一條每次改版面都會壞的斷言，而它壞掉時
 * 傳達的訊息是「版面改了」，不是「鍵盤走不到」。這裡改成「一直 Tab 直到
 * 焦點落在目標上，超過上限就失敗」——驗的是**可達**，那才是 SC-011 的內容。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../../api/client'
import { AuthProvider } from '../../state/AuthContext'
import { MEMBER, makeRoomDetail, mockApi } from '../../test/mockApi'
import { Booking } from '../Booking'

const ROOM = makeRoomDetail({ maxGuests: 4 })

function renderBooking() {
  setToken('fake-token')
  const handles = mockApi({ profile: MEMBER, roomDetail: ROOM })
  render(
    <MemoryRouter initialEntries={[`/booking/${ROOM.id}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/booking/:roomId" element={<Booking />} />
          <Route path="/orders/:orderId/confirmed" element={<div>訂單已成立</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return handles
}

/**
 * 一路 Tab 直到焦點落在符合條件的元素上。
 *
 * ⚠️ 上限存在的理由：走不到目標時 `user.tab()` 會在可聚焦元素之間無限繞圈，
 * 而那會表現成測試逾時——逾時的訊息不會告訴任何人是哪一個控制項到不了。
 */
async function tabTo(
  user: UserEvent,
  matches: (el: HTMLElement) => boolean,
  label: string,
): Promise<HTMLElement> {
  const seen: string[] = []
  for (let i = 0; i < 40; i += 1) {
    await user.tab()
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) continue
    seen.push(describeElement(active))
    if (matches(active)) return active
  }
  throw new Error(
    `按了 40 次 Tab 仍到不了「${label}」。焦點依序停在：\n  ${seen.join('\n  ')}`,
  )
}

function describeElement(el: HTMLElement): string {
  const name = el.getAttribute('name') ?? el.getAttribute('id') ?? ''
  return `<${el.tagName.toLowerCase()}${name ? ` ${name}` : ''}> ${(el.textContent ?? '').trim().slice(0, 20)}`
}

const byName = (name: string) => (el: HTMLElement) => el.getAttribute('name') === name
const byText = (text: string) => (el: HTMLElement) => (el.textContent ?? '').trim() === text

beforeEach(() => {
  setToken(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('⚠️ SC-011：純鍵盤完成整段訂房', () => {
  it('從第一步走到送出，全程不使用滑鼠', async () => {
    const user = userEvent.setup()
    const { calls } = renderBooking()

    await screen.findByRole('group', { name: /填寫資訊/ })

    // -- 第一步 ---------------------------------------------------------
    // 日期已由網址／預設帶入，姓名與信箱由個人檔案帶入。要自己填的只有人數
    // 與電話——`MEMBER.phone` 是 `null`，那是註冊時沒留電話的一般情況
    const guests = await tabTo(user, byName('guestCount'), '入住人數')
    await user.keyboard('2')
    expect(guests).toHaveValue(2)

    const phone = await tabTo(user, byName('phone'), '聯絡電話')
    await user.keyboard('0912345678')
    expect(phone).toHaveValue('0912345678')

    /*
     * ⚠️ 這裡才輪到「下一步」變成可聚焦的。
     *
     * 它在必填欄位補齊之前是 `disabled`，因而**不在 Tab 順序裡**——鍵盤使用者
     * 一路 Tab 過去只會繞回第一格。那是刻意的（停用的按鈕不該被聚焦），但也
     * 意味著「為什麼走不下去」全靠欄位本身的 `required` 與 label 說明。
     */
    const next1 = await tabTo(user, byText('下一步'), '第一步的「下一步」')
    expect(next1).toBeEnabled()
    await user.keyboard('{Enter}')

    // -- 第二步：付款方式 ------------------------------------------------
    const fieldset = await screen.findByRole('group', { name: /選擇付款方式/ })
    expect(fieldset).toBeInTheDocument()

    // ⚠️ 用 Space 選取而不是 click。radio 若只靠 label 的點擊區運作，
    // 鍵盤使用者會停在一個選不動的群組上
    await tabTo(user, byName('paymentMethod'), '付款方式選項')
    await user.keyboard(' ')
    await waitFor(() => {
      expect(screen.getByRole('radio', { checked: true })).toBeInTheDocument()
    })

    const next2 = await tabTo(user, byText('下一步'), '第二步的「下一步」')
    expect(next2).toBeEnabled()
    await user.keyboard('{Enter}')

    // -- 第三步：確認送出 ------------------------------------------------
    await screen.findByText('確認訂房內容')
    await tabTo(user, byText('確認送出'), '確認送出')
    await user.keyboard('{Enter}')

    expect(await screen.findByText('訂單已成立')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/orders'))).toBe(true)
  })

  it('⚠️ 「上一步」在第一步是不可聚焦的，而不是聚焦後沒有反應', async () => {
    const user = userEvent.setup()
    renderBooking()

    await screen.findByRole('group', { name: /填寫資訊/ })

    // 停用的按鈕不參與 Tab 順序。若改成「可聚焦但按了沒事」，鍵盤使用者
    // 會以為自己按錯了鍵——他看不到那顆按鈕是灰的
    const back = screen.getByRole('button', { name: '上一步' })
    expect(back).toBeDisabled()

    const guests = await tabTo(user, byName('guestCount'), '入住人數')
    expect(guests).toBeInTheDocument()
    expect(document.activeElement).not.toBe(back)
  })

  it('⚠️ 流程裡沒有任何正值 tabIndex', async () => {
    renderBooking()
    await screen.findByRole('group', { name: /填寫資訊/ })

    // 正值 tabIndex 會把該元素插到所有自然順序之前。混用之後，Tab 的走法
    // 對使用者而言就不再可預測，而那不是任何單一頁面看得出來的問題
    const positive = [...document.querySelectorAll('[tabindex]')].filter(
      (el) => Number(el.getAttribute('tabindex')) > 0,
    )
    expect(positive).toEqual([])
  })
})
