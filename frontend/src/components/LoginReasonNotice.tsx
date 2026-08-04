/**
 * T061 的一半：**告訴使用者他為什麼會來到登入頁**（FR-019）。
 *
 * ⚠️ 「導向登入頁」與「提示需先登入」是兩件事，而第二件只能在登入頁上做。
 *
 * 導向的那一刻來源頁就卸載了——在來源頁 `setState` 顯示一句「請先登入」是
 * 寫不出效果的死程式碼：那行字從來沒有機會被繪製出來。因此理由跟著
 * `navigate` 的 location state 一起送過來，由這裡渲染。
 *
 * 少了它，使用者按下「立即訂房」之後畫面直接變成登入表單，看起來像是誤觸或
 * 網站出錯——他不知道自己只要登入就能繼續，也不知道登入後會回到那間房。
 *
 * 本元件由 `/login` 路由掛載，T073 的真實登入頁沿用同一個。
 */
import { useLocation } from 'react-router-dom'

import type { LoginRedirectState } from '../router'

/** 已知的導向理由。未知值一律不顯示，MUST NOT 把原始字串印到畫面上。 */
const REASON_MESSAGE: Record<string, string> = {
  BOOKING_REQUIRES_LOGIN: '預訂房間需要先登入。登入後會回到你剛才看的房源。',
  SESSION_EXPIRED: '登入狀態已過期，請重新登入。登入後會回到你原本的頁面。',
}

export function LoginReasonNotice() {
  const location = useLocation()
  const state = location.state as LoginRedirectState | null
  const reason = state?.reason

  const message = reason === undefined ? undefined : REASON_MESSAGE[reason]
  if (message === undefined) return null

  return (
    // `role="status"` 而非 `alert`：這不是錯誤，是說明。用 alert 會被讀屏
    // 以警示語氣打斷，讓一件正常的事聽起來像出了問題。
    <p
      role="status"
      className="mx-auto mb-gap-4 max-w-md rounded-xs bg-brand-soft px-gap-4 py-gap-3 text-center text-small text-ink"
    >
      {message}
    </p>
  )
}
