/**
 * 「以 Google 登入」按鈕與它的回程訊息（FR-087、FR-090）。
 *
 * ## 為什麼是整頁導覽而不是 fetch
 *
 * ⚠️ **MUST 用 `window.location.assign`，MUST NOT 用 react-router 的 navigate。**
 * 目的地是 Google 的網域；navigate 只會把它當成本站的一條路徑，然後顯示
 * 「找不到這個頁面」——按鈕看起來有反應，卻永遠到不了 Google。
 *
 * 使用者因此會離開這個分頁：去 Google、授權（或取消）、由 Google 導回後端的
 * `/auth/google/callback`，後端再把他送回前端。整個往返中前端不持有任何
 * client secret（research R7、FR-085）。
 *
 * ## 回程的失敗訊息從片段來
 *
 * 取消、尚未設定、交換失敗——這些都發生在使用者不在本頁的時候，所以無法用
 * 元件狀態傳遞。後端把原因放在 URL 片段（`#error=...`）裡送回登入頁。
 * 用片段而非查詢字串，是因為片段不會進 access log 或 `Referer`。
 */
import { useLocation } from 'react-router-dom'

import { api } from '../api/client'
import { googleNoticeFor } from '../lib/googleErrors'

export function GoogleButton() {
  const location = useLocation()

  // ⚠️ 直接從網址推導，**不放進 state 也不經過 effect**。
  // 用 effect 把它抄進 state 只是多繞一圈：網址一改，這裡自然就重算了，
  // 而抄一份的版本會在使用者按上一頁時顯示上一次的訊息。
  const notice = googleNoticeFor(location.hash)

  return (
    <div className="grid gap-gap-2">
      {notice && (
        // FR-090：取消時 MUST 告知已取消。用 `status` 而非 `alert`——
        // 使用者自己按的取消不是錯誤，用警示語氣念會讓他以為出了問題。
        <p
          role="status"
          className="rounded-xs bg-surface-alt px-gap-3 py-gap-2 text-small text-ink-muted"
        >
          {notice}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          window.location.assign(api.auth.googleStartUrl())
        }}
        className="flex w-full items-center justify-center gap-gap-2 rounded-pill border border-line-strong bg-surface px-gap-5 py-gap-2 text-ink transition-colors hover:border-brand"
      >
        <GoogleMark />
        以 Google 登入
      </button>
    </div>
  )
}

/** Google 的四色 G。內嵌而非外連——外部圖檔載入失敗時按鈕會變成空白。 */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6c1.9-5.7 7.2-10.2 13.6-10.2z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.3z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.3a14.4 14.4 0 0 1 0-8.6l-7.8-6a23.5 23.5 0 0 0 0 20.6l7.8-6z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.2 0 11.5-2 15.3-5.6l-7.5-5.8c-2.1 1.4-4.8 2.2-7.8 2.2-6.4 0-11.7-4.5-13.6-10.2l-7.8 6C6.5 42.1 14.6 47.5 24 47.5z"
      />
    </svg>
  )
}
