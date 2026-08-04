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
  /**
   * 出問題的欄位名。用於把焦點移到正確的輸入框（FR-010）。
   *
   * ⚠️ **後端送出的可能是 snake_case（`check_out`、`guest_count`）。**
   * 其餘欄位一律經 `alias_generator=to_camel` 轉換，但 `field` 是在
   * `DomainError` 裡以字串手寫的，沒有經過那層轉換。
   *
   * 不一致的後果很隱蔽：焦點移動會**安靜地失效**（找不到叫 `check_out` 的
   * 輸入框），畫面看起來只是「沒有跳到出錯的欄位」，沒有任何錯誤。
   * 因此前端一律經 `lib/errors.ts` 的 `fieldOf()` 正規化，不直接使用本欄位。
   */
  field?: string
}

// ---------------------------------------------------------------------------
// 首頁內容（FR-061）
// ---------------------------------------------------------------------------
export interface SiteContent {
  heroTitle: string
  heroSubtitle: string
  /** 上傳路徑或外部網址皆可。**空字串代表不使用主圖**，前台改以純色底渲染。 */
  heroImage: string
  updatedAt: string
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

// ===========================================================================
// 後台（US6）
//
// ⚠️ 本段以下**只 append，不重排**（assignments.md「交界處」）。
// 這個檔案由兩條線共同維護，重排會讓原本可自動合併的 diff 變成整段衝突。
// ===========================================================================

/** `GET /admin/dashboard`（FR-049）。 */
export interface DashboardStats {
  totalOrders: number
  todayCheckIns: number
  todayCheckOuts: number

  /** ⚠️ 房態為**當日推導**，不是 `rooms.status` 的分組計數（FR-015）。 */
  roomsAvailable: number
  roomsBooked: number
  roomsMaintenance: number

  pendingReviews: number
  pendingRefunds: number
  /**
   * 未處理的賤賣預警筆數（FR-111）。
   *
   * ⚠️ 來自**模擬資料**。顯示此數字的地方 MUST 一併標示（FR-110）——
   * 儀表板上一個沒有標示的數字會被當成真實的市場情報。
   */
  pendingChannelAlerts: number

  /** 本月營收，整數新臺幣元 */
  monthRevenue: number
}

/**
 * `GET /admin/orders/stats`（FR-053）。
 *
 * ⚠️ **`conversionRate` 與 `averageOrderValue` 在無訂單時為 `null`，
 * MUST NOT 當成 0 顯示。** 0 會被讀成「一筆都沒成交」，而實際上是還沒有人
 * 下過單——前者是營運警訊，後者是新站台的正常狀態（T117 的驗收條件）。
 */
export interface OrderStats {
  totalOrders: number
  placedOrders: number
  paidOrders: number
  unpaidCancelledOrders: number
  revenue: number
  conversionRate: number | null
  averageOrderValue: number | null
}

/**
 * 後台的房源檢視。
 *
 * `availability` 依**所查日期區間**推導（FR-051b），與 `status` 是兩件事：
 * 後者是不分日期的營運狀態，只有 `available` 與 `maintenance`。
 */
export interface AdminRoom extends Room {
  availability: Availability
}

/**
 * 新增與編輯房源的輸入。
 *
 * ⚠️ **`status` 只接受 `available` 與 `maintenance`**——「已預訂」由當日訂單
 * 推導，MUST NOT 開放人工設定（FR-051）。型別在這裡就擋掉，不必等後端拒絕。
 */
export interface RoomWriteInput {
  name: string
  type: string
  maxGuests: number
  /** 整數新臺幣元 */
  nightlyPrice: number
  description: string
  /** 上限 8 張，第一張為封面（FR-050a） */
  images: string[]
  amenities: string[]
  features: string[]
  status: RoomStatus
}

/** 刪除房源前列出的受影響訂單（FR-052）。 */
export interface AffectedOrder {
  id: string
  orderNo: string
  /** `YYYY-MM-DD` */
  checkIn: string
  /** `YYYY-MM-DD` */
  checkOut: string
  status: OrderStatus
  contactName: string
}

/** 後台的房源查詢條件（FR-051b、FR-053a）。 */
export interface AdminRoomSearchParams {
  keyword?: string
  type?: string
  minPrice?: number
  maxPrice?: number
  /** `YYYY-MM-DD`。只填一端視為單日。 */
  startDate?: string
  endDate?: string
  /** `available` / `booked` / `maintenance`；篩「已預訂」須先選日期 */
  status?: string
}

/**
 * 後台的訂單檢視。含聯絡資訊——業者要有它才能聯繫客人。
 *
 * 這與會員端的越權防護不衝突：此端點在 `require_admin` 之後。
 */
export interface AdminOrder {
  id: string
  orderNo: string
  userId: string
  roomId: string
  roomName: string | null
  /** `YYYY-MM-DD` */
  checkIn: string
  /** `YYYY-MM-DD` */
  checkOut: string
  nights: number
  guestCount: number
  contactName: string
  phone: string
  email: string
  paymentMethod: string
  /** 整數新臺幣元 */
  totalAmount: number
  status: OrderStatus
  expiresAt: string
  cancelReason: CancelReason | null
  createdAt: string
}

export interface AdminOrderSearchParams {
  orderNo?: string
  status?: string
  roomId?: string
  /** `YYYY-MM-DD` */
  startDate?: string
  endDate?: string
}

/** 變更訂單狀態（FR-054）。變更由後端寫入 `admin_logs`。 */
export interface OrderStatusInput {
  status: OrderStatus
  note?: string
}

/**
 * 後台的會員檢視。
 *
 * ⚠️ **沒有密碼雜湊，也沒有 `googleSub`**——後端明列欄位而非把 ORM 物件
 * 全欄位倒出去。前端的型別跟著明列，多出來的欄位會在編譯期就被發現。
 */
export interface AdminUser {
  id: string
  email: string
  role: Role
  displayName: string
  phone: string | null
  createdAt: string
}

/**
 * 編輯會員資料。
 *
 * ⚠️ **刻意沒有 `role`。** 角色變更走 `setRole` 的獨立端點，才能保證每一次
 * 變更都留下稽核紀錄（FR-055）。混進這裡就會有一條不留紀錄的升權路徑。
 */
export interface UserUpdateInput {
  displayName?: string
  phone?: string
}

export interface UserRoleInput {
  role: Role
}

/**
 * 照片上傳的結果（FR-050b）。
 *
 * 回傳的是**尚未掛到房源上**的檔案路徑。要真正生效必須由儲存房源時把它寫進
 * `images`——這個兩段式是 FR-050f 的前提：按下取消時，本次上傳但未保存的
 * 檔案才有辦法被清掉。
 */
export interface PhotoUpload {
  path: string
  bytes: number
  contentType: string
}
