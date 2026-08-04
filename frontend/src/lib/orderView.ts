/**
 * T104：訂單列表的**顯示層**衍生狀態（FR-039、FR-036b、FR-036c）。
 *
 * ## 為什麼獨立成一個純函式模組
 *
 * 「退款已駁回」這條規則的每一種錯法都不會拋錯，只會讓標籤在錯誤的訂單上
 * 出現或不出現。放在元件裡就得渲染整個列表才測得到一個判斷；抽出來之後，
 * 「最新一次被駁回」與「曾經被駁回」的差別可以直接用兩筆資料釘死。
 *
 * ## ⚠️ 這裡算出來的東西 MUST NOT 回寫成訂單狀態
 *
 * FR-039 明訂：訂單在資料上仍是 `confirmed`，住宿權益不受影響。加一個
 * `refund-rejected` 進 `OrderStatus` 會讓後台把它列為可指派的狀態，而管理員
 * 一旦選了它，那筆訂單就停在一個沒有任何程式碼處理的狀態上。
 *
 * 因此這裡用一個**刻意不像狀態值**的字串當分頁鍵，型別上也與 `OrderStatus`
 * 分開——把它傳給任何接受 `OrderStatus` 的東西都會在編譯期被擋下。
 */
import type { MyRefund, Order, OrderStatus } from '../api/types'

/**
 * 「退款已駁回」分頁的鍵。
 *
 * ⚠️ 前綴 `display:` 是刻意的：它讓這個值在任何地方被誤當成資料庫狀態時
 * 都一眼看得出來，而不是安靜地寫進 `orders.status`。
 */
export const REFUND_REJECTED_TAB = 'display:refund-rejected'

/** 列表上呈現的狀態：資料庫的七種，加上一個顯示層算出來的。 */
export type DisplayStatus = OrderStatus | typeof REFUND_REJECTED_TAB

/** 每位會員的退款申請上限（FR-036b）。與後端的 `MAX_REFUNDS_PER_USER` 一致。 */
export const MAX_REFUNDS_PER_USER = 5

/**
 * 每張訂單**最新一次**的退款申請。
 *
 * ⚠️ 「最新一次」是必要條件，不是效能考量。以「曾被駁回」判定的話，一張
 * 被駁回後重新申請並獲准的訂單會永久帶著駁回標籤——而使用者看著那個標籤，
 * 完全不知道自己的退款其實已經核准了。
 *
 * 後端已依 `createdAt` 由新到舊排序，但這裡**不依賴那個順序**：排序是後端
 * 的實作細節，哪天改成由舊到新，這個判斷就會安靜地反過來。
 */
export function latestRefundByOrder(refunds: readonly MyRefund[]): Map<string, MyRefund> {
  const latest = new Map<string, MyRefund>()
  for (const refund of refunds) {
    const current = latest.get(refund.orderId)
    if (!current || refund.createdAt > current.createdAt) {
      latest.set(refund.orderId, refund)
    }
  }
  return latest
}

/**
 * 這張訂單在列表上該顯示成哪一類。
 *
 * ⚠️ 只有「訂單為 `confirmed`」且「最新一次申請遭駁回」才是「退款已駁回」。
 *
 * 兩個條件缺一不可：訂單若已變成 `refunded`（後來重新申請並獲准），
 * 那筆舊的駁回紀錄不該再影響顯示；而不是 `confirmed` 的訂單顯示「退款已駁回」
 * 會與它自己的狀態互相矛盾。
 */
export function displayStatusOf(order: Order, latest: MyRefund | null): DisplayStatus {
  if (order.status === 'confirmed' && latest?.status === 'rejected') {
    return REFUND_REJECTED_TAB
  }
  return order.status
}

/**
 * 已佔用的退款額度筆數。
 *
 * ⚠️ **被駁回的不算**（FR-036b、SC-031）。若駁回也計入，被駁回 5 次的會員
 * 會在畫面上看到「已達上限」，而後端其實還讓他申請——兩邊說法不一致時，
 * 使用者相信的是畫面。
 */
export function refundQuotaUsed(refunds: readonly MyRefund[]): number {
  return refunds.filter((r) => r.status === 'pending' || r.status === 'approved').length
}

/**
 * 是否已達上限。
 *
 * ⚠️ **這個函式只用來決定「要不要說已達上限」，MUST NOT 用來顯示剩餘次數**
 * （FR-036c）。把「你還剩 2 次」放到畫面上，會讓正常使用的人開始節省，
 * 而退款申請本來就該按需提出。
 */
export function isRefundQuotaFull(refunds: readonly MyRefund[]): boolean {
  return refundQuotaUsed(refunds) >= MAX_REFUNDS_PER_USER
}

/**
 * 這張訂單現在能不能提出退款申請（FR-035）。
 *
 * ⚠️ 這是**畫面呈現**的判斷，不是存取邊界。真正拒絕的是後端
 * （`services/refunds.assert_refundable`）——前端算錯只會讓按鈕多出現或少
 * 出現一次，不會讓任何人退到不該退的錢（憲章原則 VI）。
 *
 * 「入住日尚未到來」與「退款金額為 0」是兩件事：入住當日的金額是 0，
 * 但那一天已經到來，規則說的是尚未到來。
 */
export function canRequestRefund(order: Order, today: string): boolean {
  return order.status === 'confirmed' && order.checkIn > today
}
