/**
 * 把任意 `unknown` 轉成可以顯示給使用者的話。
 *
 * ⚠️ **MUST NOT 直接顯示 `String(error)`**（憲章「錯誤處理」條）——
 * 那可能夾帶堆疊追蹤或內部檔案路徑。後端的 `ApiError.detail` 已是寫好的
 * 繁體中文訊息，可以直接用；其餘一律退回一句通用訊息，細節留在 console。
 *
 * 「連不上後端」與「後端回了錯誤」**MUST 分開**（FR-084）：把兩者混為一談，
 * 使用者會在伺服器根本沒開的時候讀到一句莫名其妙的業務錯誤。
 */
import { ApiError, NetworkError } from '../api/client'

export interface DisplayableError {
  title: string
  detail: string
}

export function messageFor(error: unknown): DisplayableError {
  if (error instanceof NetworkError) {
    return {
      title: '無法連線至伺服器',
      detail: '請確認後端服務已啟動，並檢查網路連線後再試一次。',
    }
  }
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return { title: '伺服器發生錯誤', detail: error.message }
    }
    return { title: '無法完成操作', detail: error.message }
  }
  return {
    title: '發生未預期的錯誤',
    detail: '請稍後再試一次。若問題持續發生，請重新整理頁面。',
  }
}

/**
 * 出問題的欄位名（camelCase），供把焦點移到正確的輸入框（FR-010）。
 *
 * FR-010 要求「缺漏 MUST **逐欄**顯示訊息並將焦點移至第一個有問題的欄位，
 * MUST NOT 只丟一句籠統的錯誤」。後端已在錯誤裡帶上 `field`，前端只要用它。
 */
export function fieldOf(error: unknown): string | null {
  return error instanceof ApiError ? (error.field ?? null) : null
}
