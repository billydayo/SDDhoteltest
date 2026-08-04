/**
 * T039：對應後端 Pydantic 模型的 TypeScript 型別。
 *
 * ## 兩條貫穿全檔的約定
 *
 * 1. **日曆日是 `string`（`YYYY-MM-DD`），不是 `Date`。**
 *    型別寫成 `Date` 會誘使人用 `new Date(str)` 去產生它，而那個建構式把
 *    「只有日期」的字串當 UTC 解讀，在台北會退成前一天（見 `lib/dates.ts`）。
 *    保持字串，運算一律經 `lib/dates.ts`。
 *
 * 2. **金額是 `number` 且為整數新臺幣元。**
 *    型別系統擋不住小數，因此 `lib/money.ts` 提供 `isValidAmount` 供必要時
 *    檢查，顯示一律經 `formatTWD`（FR-070）。
 *
 * 欄位為 camelCase——後端以 `alias_generator=to_camel` 統一轉換，
 * 前端 MUST NOT 出現 snake_case 的 API 欄位名。
 */

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------
/** 後端的統一錯誤形狀（contracts/README.md）。 */
export interface ApiErrorBody {
  /** 給使用者看的繁體中文訊息。可直接顯示。 */
  detail: string
  /** 供程式判斷的機器可讀代碼，例如 `ROOM_UNAVAILABLE`。 */
  code: string
  /** 出問題的欄位名（camelCase）。用於把焦點移到正確的輸入框（FR-010）。 */
  field?: string
}

// ---------------------------------------------------------------------------
// 身分
// ---------------------------------------------------------------------------
export type Role = 'member' | 'admin'

export interface Profile {
  id: string
  email: string
  role: Role
  displayName: string
  phone: string | null
  createdAt: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: string
  profile: Profile
}

export interface RegisterInput {
  email: string
  password: string
  displayName: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface ProfileUpdateInput {
  displayName?: string
  phone?: string
}

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------
/** 房源的營運狀態。**刻意沒有 `booked`**——已預訂綁定日期，由後端逐日推導。 */
export type RoomStatus = 'available' | 'maintenance'

/** 某一天的房態（FR-015）。這才是含 `booked` 的那一組。 */
export type Availability = 'available' | 'booked' | 'maintenance' | 'unknown'

export interface Room {
  id: string
  name: string
  type: string
  maxGuests: number
  /** 整數新臺幣元 */
  nightlyPrice: number
  images: string[]
  amenities: string[]
  features: string[]
  description: string
  status: RoomStatus
  /**
   * ⚠️ **`null` 代表尚無評分，MUST NOT 當成 0 顯示**（FR-047）。
   * 0 分會被讀成「評價極差」，而實際上是還沒有人評過。
   *
   * 後端以 `Decimal` 序列化，JSON 上是字串或數字視值而定，因此型別為聯集。
   */
  averageRating: number | string | null
  createdAt: string
}

export interface RiskCheck {
  brightness: number
  clutter: number
  contrast: number
  riskScore: number
  riskLevel: string
  imagePath: string
  createdAt: string
}

export interface RoomDetail extends Room {
  /** 依所查日期推導（FR-015） */
  availability: Availability
  /** `null` 代表尚未檢測——前端顯示「尚未檢測」，MUST NOT 顯示 0 分或空白（FR-014） */
  latestRiskCheck: RiskCheck | null
}

/** 設施與房型特色的可選項目（FR-010a）。清單為空是合法狀態，前端隱藏該組篩選。 */
export interface Vocabulary {
  amenities: string[]
  features: string[]
}

/** 房源搜尋條件。三者連動的條件式必填由後端把關（FR-010）。 */
export interface RoomSearchParams {
  keyword?: string
  /** `YYYY-MM-DD` */
  checkIn?: string
  /** `YYYY-MM-DD` */
  checkOut?: string
  guestCount?: number
  maxPrice?: number
  /** 須**同時**具備所選全部項目（AND） */
  amenities?: string[]
  features?: string[]
  type?: string
  sort?: RoomSort
}

export type RoomSort = 'price_asc' | 'price_desc' | 'rating_asc' | 'rating_desc'

// ---------------------------------------------------------------------------
// 訂單
// ---------------------------------------------------------------------------
export type OrderStatus =
  | 'pending-payment'
  | 'confirmed'
  | 'refund-pending'
  | 'refunded'
  | 'cancelled'
  | 'completed'

/** 兩者都計入「未付款取消訂單數」，但 MUST 可區分（FR-035a）。 */
export type CancelReason = 'payment-timeout' | 'member-cancelled'

/** ⚠️ 三者皆為**模擬支付**，不涉及任何真實金流。 */
export type PaymentMethod = 'LINE Pay' | 'credit-card' | 'bank-transfer'

export interface Order {
  id: string
  /** `SN` + 台北日期 + 序號。對使用者可見（FR-030）。 */
  orderNo: string
  roomId: string
  /** `YYYY-MM-DD` */
  checkIn: string
  /** `YYYY-MM-DD` */
  checkOut: string
  nights: number
  guestCount: number
  contactName: string
  phone: string
  email: string
  paymentMethod: PaymentMethod
  /** 整數新臺幣元。建單當下依房價凍結（FR-032）。 */
  totalAmount: number
  status: OrderStatus
  /** 帶時區的時間戳。供付款倒數（FR-102）。 */
  expiresAt: string
  cancelReason: CancelReason | null
  createdAt: string
}

/**
 * 建立訂單的輸入。
 *
 * ⚠️ **刻意沒有 `nights` 與 `totalAmount`。** 夜數與金額一律由後端依當下房價
 * 重算——這裡若加上去，就等於邀請人把畫面上的預覽值送出去當真（FR-024）。
 *
 * ⚠️ **也沒有任何真實支付欄位。** 卡號、有效期限、CVV、銀行帳號 MUST NOT
 * 出現在此，後端也不接收（FR-028）。
 */
export interface OrderCreateInput {
  roomId: string
  /** `YYYY-MM-DD` */
  checkIn: string
  /** `YYYY-MM-DD` */
  checkOut: string
  guestCount: number
  contactName: string
  phone: string
  email: string
  paymentMethod: PaymentMethod
}
