/**
 * 列舉值 → 繁體中文顯示文字。
 *
 * ⚠️ **T172a：所有介面文字 MUST 為繁體中文（台灣用語）。** 而後端回的是
 * `pending-payment`、`member-cancelled` 這類機器可讀的代碼——它們是**資料**，
 * 不是文案，MUST NOT 直接顯示。
 *
 * ## 為什麼集中在一個檔案
 *
 * 訂單狀態會同時出現在會員的訂單列表、訂單詳情、後台訂單管理與匯出的表頭。
 * 各頁面自己寫一份的話，同一個 `refund-pending` 會在四個地方變成四種說法
 * （「退款中」「退款審核中」「申請退款」「處理中」），而使用者會以為那是四種
 * 不同的狀態。
 *
 * ## 為什麼是 `Record<..., string>` 而不是函式加 `default`
 *
 * 型別寫成完整的 `Record<OrderStatus, string>`，漏掉一個狀態會在**編譯期**
 * 就報錯。用 `switch` 加 `default: return value` 的話，新增一個狀態時畫面上
 * 會直接顯示英文代碼，而沒有任何東西會失敗。
 *
 * ⚠️ 本檔只 append、不重排（assignments.md「交界處」的同一條約定）。
 */
import type { Availability, CancelReason, OrderStatus, PaymentMethod, Role, RoomStatus } from '../api/types'

/** 訂單狀態（FR-030 ~ FR-042）。 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  'pending-payment': '待付款',
  confirmed: '已確認',
  'refund-pending': '退款審核中',
  refunded: '已退款',
  cancelled: '已取消',
  completed: '已完成',
}

/**
 * 訂單狀態的語意色。
 *
 * 顏色**只是輔助**：每一處都同時顯示文字。只用顏色區分狀態，對色覺辨識障礙者
 * 等於沒有區分（憲章原則 V）。
 */
export const ORDER_STATUS_TONES: Record<OrderStatus, string> = {
  'pending-payment': 'bg-warn-soft text-warn',
  confirmed: 'bg-ok-soft text-ok',
  'refund-pending': 'bg-info-soft text-info',
  refunded: 'bg-surface-alt text-ink-muted',
  cancelled: 'bg-surface-alt text-ink-muted',
  completed: 'bg-forest-soft text-forest',
}

/**
 * 取消原因（FR-035a）。
 *
 * ⚠️ 兩者都計入「未付款取消訂單數」，但 MUST 可區分——逾時未付與客人主動
 * 取消是兩種完全不同的營運訊號，前者多半代表付款流程有問題。
 */
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  'payment-timeout': '逾時未付款',
  'member-cancelled': '會員自行取消',
}

/** ⚠️ 三者皆為**模擬支付**，不涉及任何真實金流（FR-028）。 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  'LINE Pay': 'LINE Pay',
  'credit-card': '信用卡',
  'bank-transfer': '銀行轉帳',
}

/** 房源的營運狀態。**刻意沒有「已預訂」**——那由訂單推導（FR-051）。 */
export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  available: '可販售',
  maintenance: '整理中',
}

/** 某一天的房態（FR-015）。這才是含「已預訂」的那一組。 */
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: '空房',
  booked: '已預訂',
  maintenance: '整理中',
  unknown: '未知',
}

export const ROLE_LABELS: Record<Role, string> = {
  member: '會員',
  admin: '管理員',
}

/**
 * 顯示一個可能不在對照表裡的值。
 *
 * 後端新增了一個狀態而前端還沒跟上時，這裡回傳原始代碼而不是空白——
 * 空白會被讀成「沒有狀態」，而原始代碼至少讓人看得出發生了什麼事。
 */
export function labelOf<T extends string>(labels: Record<T, string>, value: string): string {
  return (labels as Record<string, string | undefined>)[value] ?? value
}
