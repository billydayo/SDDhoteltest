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
