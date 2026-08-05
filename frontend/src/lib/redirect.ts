/**
 * 登入／註冊完成後要回哪裡（FR-009d）。
 *
 * `RequireAuth` 與 `RoomDetail` 都會把來源塞進 react-router 的 location state。
 * 少了這一步，使用者從書籤點進一筆訂單、被要求登入、然後被丟回首頁——
 * 他得自己找回剛才那筆訂單。這在 token 過期時每次都會發生。
 */
import type { LoginRedirectState } from '../router'

/**
 * 取出原目的地的路徑。取不到時回首頁。
 *
 * ⚠️ 只接受**站內的絕對路徑**。location state 是使用者可以左右的東西
 * （它跟著網址一起被塞進 history），把它原樣交給 `navigate` 等於開一個
 * 開放導向：`//evil.example` 在瀏覽器眼中是 `https://evil.example`。
 */
export function redirectTargetOf(state: unknown): string {
  const from = (state as LoginRedirectState | null)?.from
  const pathname = from?.pathname
  if (typeof pathname !== 'string') return '/'
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  return pathname
}

/**
 * 登入後還有一個沒做完的收藏（FR-093）。
 *
 * ⚠️ **登入頁 MUST 把它原樣轉交給目的地。** `redirectTargetOf` 只回傳一個路徑
 * 字串，而 `navigate(path)` 不帶 state——沒有這一步，使用者按了星號、被要求
 * 登入、登入後回到那間房，然後發現**它並沒有被收藏**。他確實按過了，所以多數人
 * 不會再按第二次，那次收藏就這樣沒了。
 *
 * 型別刻意收窄成 `string | null`：轉交的是一個 id，不是整包 state。
 * 把原 state 整個丟過去會連 `from` 一起帶走，於是目的地又有一份「要回哪裡」，
 * 而它已經沒有意義了。
 */
export function pendingFavoriteOf(state: unknown): string | null {
  const id = (state as { pendingFavoriteRoomId?: unknown } | null)?.pendingFavoriteRoomId
  return typeof id === 'string' && id !== '' ? id : null
}
