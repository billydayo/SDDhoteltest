/**
 * Google 登入回程的原因代碼 → 給人看的話（FR-090）。
 *
 * 這些失敗都發生在使用者**不在本站**的時候（他在 Google 的授權畫面上，或在
 * 後端與 Google 的往返之間），所以無法用元件狀態傳遞。後端把代碼放在 URL
 * 片段裡送回登入頁——片段不會進 access log 或 `Referer`。
 */

/** 後端可能送回的原因。與 `routers/auth.py` 的 `DomainError.code` 一致。 */
export const GOOGLE_ERROR_MESSAGE: Record<string, string> = {
  GOOGLE_CANCELLED: '已取消 Google 登入，沒有建立任何帳號。',
  GOOGLE_NOT_CONFIGURED: '本站尚未啟用 Google 登入，請以電子郵件與密碼登入。',
  GOOGLE_NO_EMAIL: 'Google 未提供電子郵件，無法完成登入。',
  GOOGLE_EXCHANGE_FAILED: 'Google 登入失敗，請再試一次。',
  GOOGLE_USERINFO_FAILED: '無法取得 Google 帳號資訊，請再試一次。',
  GOOGLE_TOKEN_REJECTED: '登入憑證無效，請再試一次。',
}

/**
 * 從網址片段取出要顯示的一句話。沒有 `error` 時回 `null`。
 *
 * ⚠️ **未知代碼 MUST NOT 原樣顯示。** `GOOGLE_EXCHANGE_FAILED` 對使用者不是
 * 一句話，是一串他看不懂也幫不上忙的英文。日後後端新增代碼時，這裡退回一句
 * 通用但可行動的建議，而不是把內部字串攤在畫面上。
 */
export function googleNoticeFor(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/, '')).get('error')
  if (!code) return null
  return GOOGLE_ERROR_MESSAGE[code] ?? '無法完成 Google 登入，請改用電子郵件與密碼。'
}
