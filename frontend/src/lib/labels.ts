/**
 * 狀態代碼 → **繁體中文**（FR-069）。
 *
 * ## 為什麼集中在一處
 *
 * 同一個 `pending-payment` 會出現在後台訂單列表、會員的我的訂單、匯出的檔案
 * 與稽核日誌上。各處自己寫一份的話，同一個狀態在不同畫面上會有不同的名字
 * ——「待付款」與「未付款」看起來像兩件事，而業者會問哪一個才對。
 *
 * ## 找不到對應時回傳原始代碼
 *
 * **MUST NOT 回空字串或「未知」。** 空白會讓那一格看起來像資料掉了；
 * 而原始代碼雖然不好看，至少說得出實際發生的事，也讓漏掉的那一項在畫面上
 * 就看得見，不必等有人回報。
 */
import type {
  Availability,
  AutoVerdict,
  CancelReason,
  OrderStatus,
  RefundStatus,
  ReviewStatus,
  Role,
  RoomStatus,
} from '../api/types'

/** 徽章的語意色。與 `styles/index.css` 的語意色 token 對應。 */
export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line-strong bg-surface-alt text-ink-muted',
  ok: 'border-ok/30 bg-ok-soft text-ok',
  warn: 'border-warn/30 bg-warn-soft text-warn',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  info: 'border-info/30 bg-info-soft text-info',
}

function lookup<K extends string>(table: Record<K, string>, key: string): string {
  return (table as Record<string, string | undefined>)[key] ?? key
}

// ---------------------------------------------------------------------------
// 訂單
// ---------------------------------------------------------------------------
const ORDER_STATUS: Record<OrderStatus, string> = {
  'pending-payment': '待付款',
  confirmed: '已確認',
  'refund-pending': '退款待審核',
  refunded: '已退款',
  cancelled: '已取消',
  completed: '已完成',
}

const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  'pending-payment': 'warn',
  confirmed: 'ok',
  'refund-pending': 'warn',
  refunded: 'info',
  cancelled: 'neutral',
  completed: 'ok',
}

export const ORDER_STATUSES = Object.keys(ORDER_STATUS) as OrderStatus[]

export const orderStatusLabel = (value: string) => lookup(ORDER_STATUS, value)
export const orderStatusTone = (value: string): Tone =>
  (ORDER_STATUS_TONE as Record<string, Tone | undefined>)[value] ?? 'neutral'

/**
 * 取消原因。
 *
 * ⚠️ 兩者都計入「未付款取消訂單數」，但**MUST 可區分**（FR-035a）：
 * 逾時未付款是系統造成的流失，會員主動取消是需求改變，兩者要分開看。
 */
const CANCEL_REASON: Record<CancelReason, string> = {
  'payment-timeout': '逾時未付款',
  'member-cancelled': '會員取消',
}

export const cancelReasonLabel = (value: string) => lookup(CANCEL_REASON, value)

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------
/**
 * 房源的**營運狀態**（不分日期）。
 *
 * ⚠️ 只有兩種。「已預訂」不在這裡——它綁定日期，由訂單推導（FR-051）。
 */
const ROOM_STATUS: Record<RoomStatus, string> = {
  available: '開放預訂',
  maintenance: '維護中',
}

export const ROOM_STATUSES = Object.keys(ROOM_STATUS) as RoomStatus[]
export const roomStatusLabel = (value: string) => lookup(ROOM_STATUS, value)

/** 某一天（或某個區間）的**推導**房態（FR-015、FR-051b）。 */
const AVAILABILITY: Record<Availability, string> = {
  available: '可訂',
  booked: '已預訂',
  maintenance: '維護中',
  unknown: '未知',
}

const AVAILABILITY_TONE: Record<Availability, Tone> = {
  available: 'ok',
  booked: 'info',
  maintenance: 'warn',
  unknown: 'neutral',
}

export const availabilityLabel = (value: string) => lookup(AVAILABILITY, value)
export const availabilityTone = (value: string): Tone =>
  (AVAILABILITY_TONE as Record<string, Tone | undefined>)[value] ?? 'neutral'

// ---------------------------------------------------------------------------
// 審核
// ---------------------------------------------------------------------------
const REVIEW_STATUS: Record<ReviewStatus, string> = {
  pending: '待審核',
  approved: '已通過',
  rejected: '已駁回',
}

const REFUND_STATUS: Record<RefundStatus, string> = {
  pending: '待審核',
  approved: '已核准',
  rejected: '已駁回',
}

const MODERATION_TONE: Record<string, Tone> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
}

export const reviewStatusLabel = (value: string) => lookup(REVIEW_STATUS, value)
export const refundStatusLabel = (value: string) => lookup(REFUND_STATUS, value)
export const moderationTone = (value: string): Tone => MODERATION_TONE[value] ?? 'neutral'

/**
 * 自動審核的判定。
 *
 * ⚠️ 介面上 MUST 標示為「自動審核（規則式）」，**MUST NOT 描述為 AI**
 * （FR-103a、憲章原則 VI）。這些字串刻意都用「建議」開頭：它是初判，
 * 最終決定在管理員手上（FR-103b）。
 */
const AUTO_VERDICT: Record<AutoVerdict, string> = {
  pass: '建議通過',
  reject: '建議駁回',
  review: '建議人工判斷',
}

export const autoVerdictLabel = (value: string) => lookup(AUTO_VERDICT, value)

// ---------------------------------------------------------------------------
// 身分
// ---------------------------------------------------------------------------
const ROLE: Record<Role, string> = {
  member: '會員',
  admin: '管理員',
}

export const ROLES = Object.keys(ROLE) as Role[]
export const roleLabel = (value: string) => lookup(ROLE, value)
