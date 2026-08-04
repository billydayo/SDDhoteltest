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

// ---------------------------------------------------------------------------
// 後台：統計
// ---------------------------------------------------------------------------
/** 營運總覽（FR-049）。 */
export interface DashboardStats {
  totalOrders: number
  todayCheckIns: number
  todayCheckOuts: number
  /** ⚠️ 三個房態為**當日推導**，不是 `rooms.status` 的分組計數（FR-015）。 */
  roomsAvailable: number
  roomsBooked: number
  roomsMaintenance: number
  pendingReviews: number
  pendingRefunds: number
  /**
   * 未處理的賤賣預警筆數（FR-111）。
   *
   * ⚠️ 來自**模擬資料**。顯示這個數字的地方 MUST 一併標示（FR-110）——
   * 一個沒有標示的預警數字會被當成真實的市場情報。
   */
  pendingChannelAlerts: number
  /** 本月營收，整數新臺幣元 */
  monthRevenue: number
}

/**
 * 訂單管理的統計區塊（FR-053）。
 *
 * ⚠️ `conversionRate` 與 `averageOrderValue` 在系統無訂單時為 **`null`**，
 * 畫面 MUST 顯示「—」。**MUST NOT 當成 0 顯示**——0 會被讀成「一筆都沒成交」，
 * 而實際上是還沒有人下單過。
 */
export interface OrderStats {
  totalOrders: number
  placedOrders: number
  paidOrders: number
  unpaidCancelledOrders: number
  /** 整數新臺幣元 */
  revenue: number
  conversionRate: number | null
  averageOrderValue: number | null
}

// ---------------------------------------------------------------------------
// 後台：房源
// ---------------------------------------------------------------------------
/** 房源 + 所查日期**區間**內推導出的房態（FR-051b）。 */
export interface AdminRoom extends Room {
  availability: Availability
}

/**
 * 新增與編輯房源的輸入。
 *
 * ⚠️ **`status` 只有 `available` 與 `maintenance`。**「已預訂」由當日訂單推導，
 * MUST NOT 開放人工設定（FR-051）。
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
  checkIn: string
  checkOut: string
  status: OrderStatus
  contactName: string
}

/**
 * 上傳結果（FR-050b）。
 *
 * ⚠️ 回傳的是**尚未掛到房源上**的檔案路徑。要真正生效必須由編輯房源把它寫進
 * `images`——這個兩段式是 FR-050f 的前提：使用者按取消時，本次上傳但未保存的
 * 檔案要能被清掉。
 */
export interface PhotoUpload {
  path: string
  bytes: number
  contentType: string
}

/**
 * 房源清單的篩選條件。日期區間**含頭含尾**（FR-051b）。
 *
 * ⚠️ 每個欄位都明寫 `| undefined`。專案開啟了 `exactOptionalPropertyTypes`，
 * 少了它就無法把一個欄位「設回未指定」——而篩選器的每個欄位都可以被清空。
 * 清空與從未填過對查詢而言是同一件事（`buildQuery` 一律略過 undefined）。
 */
export interface AdminRoomFilters {
  keyword?: string | undefined
  type?: string | undefined
  minPrice?: number | undefined
  maxPrice?: number | undefined
  /** `YYYY-MM-DD` */
  startDate?: string | undefined
  /** `YYYY-MM-DD` */
  endDate?: string | undefined
  status?: Availability | undefined
}

// ---------------------------------------------------------------------------
// 後台：訂單
// ---------------------------------------------------------------------------
/** 後台的訂單檢視。含聯絡資訊——業者需要它才能聯繫客人。 */
export interface AdminOrder extends Order {
  userId: string
  roomName: string | null
}

/** 訂單搜尋條件。日期區間比對**入住日**，含頭含尾（FR-053）。 */
export interface AdminOrderFilters {
  orderNo?: string | undefined
  status?: OrderStatus | undefined
  roomId?: string | undefined
  /** `YYYY-MM-DD` */
  startDate?: string | undefined
  /** `YYYY-MM-DD` */
  endDate?: string | undefined
}

// ---------------------------------------------------------------------------
// 後台：會員
// ---------------------------------------------------------------------------
/**
 * 後台的會員檢視。
 *
 * ⚠️ **沒有 `passwordHash`，也沒有 `googleSub`**——後端明列欄位而非把 ORM
 * 物件整個倒出來。
 */
export type AdminUser = Profile

/**
 * 編輯會員資料。
 *
 * ⚠️ **刻意沒有 `role`**——角色變更走獨立端點，才能保證每一次變更都留下
 * 稽核紀錄（FR-055）。
 */
export interface AdminUserUpdateInput {
  displayName?: string
  phone?: string
}

export interface AdminUserFilters {
  keyword?: string | undefined
  role?: Role | undefined
}

// ---------------------------------------------------------------------------
// 後台：評論審核
// ---------------------------------------------------------------------------
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

/** 自動審核的判定。⚠️ 介面 MUST 標示為「自動審核（規則式）」，MUST NOT 稱為 AI（FR-103a）。 */
export type AutoVerdict = 'pass' | 'reject' | 'review'

/** 後台的評論檢視（FR-056）。 */
export interface AdminReview {
  id: string
  orderId: string
  roomId: string
  roomName: string | null
  userId: string
  userName: string | null
  rating: number
  comment: string
  category: string
  status: ReviewStatus
  /** 自動審核判了什麼。`null` = 尚未初判。 */
  autoVerdict: AutoVerdict | null
  /** 觸發了哪幾條規則。管理員要看得到依據才可能覆寫它（FR-103b）。 */
  autoRules: string[]
  adminNote: string | null
  /** ⚠️ 待審核與已駁回的評論 MUST NOT 提供回覆入口（FR-103d）。 */
  adminReply: string | null
  adminReplyAt: string | null
  createdAt: string
}

export interface AdminReviewFilters {
  status?: ReviewStatus | undefined
  roomId?: string | undefined
}

export interface ReviewDecisionInput {
  status: ReviewStatus
  note?: string
}

/** ⚠️ `reply` 為 `null` 或空白**即為收回**，不另設刪除端點（FR-103d）。 */
export interface ReviewReplyInput {
  reply: string | null
}

// ---------------------------------------------------------------------------
// 後台：退款審核
// ---------------------------------------------------------------------------
export type RefundStatus = 'pending' | 'approved' | 'rejected'

/** 待審核退款（FR-057）。 */
export interface Refund {
  id: string
  orderId: string
  orderNo: string | null
  userId: string
  applicantName: string | null
  reason: string
  /**
   * **分級後**的實付退款額，整數新臺幣元（FR-041）。
   *
   * 申請當下即已算定並寫入，畫面 MUST NOT 自行重算——距入住日的天數會隨
   * 時間變動，重算會讓管理員看到的金額與申請人當初被告知的不同。
   */
  amount: number
  status: RefundStatus
  adminNote: string | null
  /** `YYYY-MM-DD` */
  checkIn: string | null
  checkOut: string | null
  createdAt: string
  reviewedAt: string | null
}

export interface RefundFilters {
  status?: RefundStatus | undefined
}

export interface RefundDecisionInput {
  decision: 'approve' | 'reject'
  note?: string
}

// ---------------------------------------------------------------------------
// 後台：匯出
// ---------------------------------------------------------------------------
export type ExportModule =
  | 'rooms'
  | 'orders'
  | 'users'
  | 'reviews'
  | 'refunds'
  | 'channel-prices'
  | 'admin-logs'

export type ExportFormat = 'xlsx' | 'csv'

export interface ExportColumn {
  key: string
  /** **繁體中文表頭**（FR-069） */
  label: string
}

/**
 * 一次匯出的內容。
 *
 * ⚠️ `rows` 為空時 `hasData` 為 `false`，前端 MUST 顯示 `message` 且
 * **MUST NOT 產生空檔案**（FR-060）。後端同時也不寫稽核紀錄——沒有檔案離開
 * 系統，就沒有東西需要稽核（FR-058a）。
 */
export interface ExportSheet {
  module: ExportModule
  format: ExportFormat
  columns: ExportColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  hasData: boolean
  /** 0 筆時的提示文字；有資料時為 `null`。 */
  message: string | null
}

/**
 * 匯出時要帶的篩選條件。
 *
 * ⚠️ **MUST 與畫面當下的篩選一致**（FR-058、SC-033）。這是一個型別而非
 * 七個各自的型別，正是為了讓呼叫端能把該頁的篩選狀態原樣傳進來——各頁自己
 * 組一份「匯出用的條件」遲早會與畫面上的條件分歧，而分歧時使用者匯出的筆數
 * 會與他看到的不同，且沒有任何錯誤訊息。
 */
export interface ExportQuery {
  keyword?: string | undefined
  status?: string | undefined
  role?: Role | undefined
  roomId?: string | undefined
  orderNo?: string | undefined
  type?: string | undefined
  minPrice?: number | undefined
  maxPrice?: number | undefined
  actorId?: string | undefined
  action?: string | undefined
  /** `YYYY-MM-DD` */
  startDate?: string | undefined
  /** `YYYY-MM-DD` */
  endDate?: string | undefined
}

// ---------------------------------------------------------------------------
// 後台：首頁內容
// ---------------------------------------------------------------------------
export interface SiteContent {
  heroTitle: string
  heroSubtitle: string
  /** 上傳路徑（`/uploads/...`）或外部網址皆可；空字串代表不使用主圖（FR-061）。 */
  heroImage: string
  updatedAt: string
}

/** 三個欄位皆必填——送出的就是使用者在畫面上看到的完整狀態。 */
export interface SiteContentInput {
  heroTitle: string
  heroSubtitle: string
  heroImage: string
}

// ---------------------------------------------------------------------------
// 後台：操作日誌
// ---------------------------------------------------------------------------
/**
 * 一筆操作紀錄。
 *
 * ⚠️ **唯讀。** 沒有對應的輸入型別，畫面上也 MUST NOT 出現編輯或刪除入口
 * （FR-114、FR-115）。一個可以由 API 直接構造或修改的日誌，不叫稽核紀錄。
 */
export interface AdminLog {
  id: string
  actorId: string
  /** 操作者顯示名稱。**不含其電子郵件**——那是個資（FR-118）。 */
  actorName: string | null
  action: string
  targetTable: string
  targetId: string | null
  summary: Record<string, unknown>
  createdAt: string
}

export interface AdminLogFilters {
  actorId?: string | undefined
  /** 動作類型，前綴比對 */
  action?: string | undefined
  /** `YYYY-MM-DD` */
  startDate?: string | undefined
  /** `YYYY-MM-DD` */
  endDate?: string | undefined
  limit?: number | undefined
}

// ---------------------------------------------------------------------------
// 後台：系統參數
// ---------------------------------------------------------------------------
/**
 * 可調整的營運參數。
 *
 * ⚠️ **可接受範圍隨值一起回傳，前端 MUST NOT 自己硬編一份。** 硬編的那份遲早
 * 會與資料庫的 CHECK 約束分歧，而分歧時使用者會看到一個「符合提示卻被拒絕」
 * 的錯誤（FR-119、FR-120）。
 */
export interface SystemSettings {
  /** 未付款訂單的保留分鐘數（FR-098） */
  pendingPaymentMinutes: number
  roomAmenities: string[]
  roomFeatures: string[]
  pendingPaymentMin: number
  pendingPaymentMax: number
}

/** 全部欄位可選——只送要改的那些。 */
export interface SystemSettingsInput {
  pendingPaymentMinutes?: number
  roomAmenities?: string[]
  roomFeatures?: string[]
}

/**
 * 還原示範資料的結果（FR-073）。
 *
 * ⚠️ `auditLogPreserved` 恆為 `true`。畫面 MUST 顯示 `message`——管理員按下
 * 「還原所有資料」後會預期日誌也被清掉，而它沒有；不說清楚會被當成 bug
 * 回報，然後有人「修好」它（SC-027）。
 */
export interface ResetResult {
  reset: boolean
  auditLogPreserved: boolean
  message: string
}

// ---------------------------------------------------------------------------
// 後台：渠道比價
// ---------------------------------------------------------------------------
/**
 * 一筆房源 × 平台的價格比較（FR-108）。
 *
 * ⚠️ **`simulated` 與 `simulatedNotice` 是每一列的一部分，不是頁面層的裝飾。**
 * 介面頂端的常駐提示（FR-110）只存在於畫面；這份資料會被匯出成檔案、被截圖、
 * 被轉寄給沒看過那塊提示的人。
 */
export interface ChannelComparison {
  id: string
  roomId: string
  roomName: string
  channel: string
  /** 整數新臺幣元 */
  officialPrice: number
  channelPrice: number
  /** 官網價 − 平台售價。**正值代表對方賣得比我們便宜**（FR-111）。 */
  gap: number
  gapPercent: number
  /** 是否觸發賤賣預警 */
  underpriced: boolean
  resolved: boolean
  capturedAt: string
  simulated: boolean
  simulatedNotice: string
}

export interface ChannelFilters {
  roomId?: string | undefined
  /** 只看未處理（`false`）或只看已處理（`true`）。省略為全部。 */
  resolved?: boolean | undefined
}

/**
 * 申訴郵件範本（FR-112）。
 *
 * ⚠️ `willSend` 恆為 `false`。畫面 MUST 顯示 `notice`——系統不會代為寄送任何
 * 郵件。刻意**不含收件者信箱**：帶著收件者的範本會讓人以為只差按一下送出。
 */
export interface ComplaintTemplate {
  subject: string
  body: string
  willSend: boolean
  notice: string
}

// ---------------------------------------------------------------------------
// 收藏
// ---------------------------------------------------------------------------
/**
 * 收藏清單中的一列。
 *
 * ⚠️ `listed` 為 `false` 代表**已下架**：房源仍會出現在清單中，由前端標示，
 * **MUST NOT 顯示錯誤或空白卡片，也 MUST NOT 提供訂房入口**（FR-095）。
 */
export interface FavoriteRoom extends Room {
  listed: boolean
}

// ---------------------------------------------------------------------------
// 訊息
// ---------------------------------------------------------------------------
export type SenderRole = 'member' | 'admin'

/**
 * 會員端的一則訊息。
 *
 * ⚠️ **沒有 `senderName`。** 前台只看得到角色，由介面把 `admin` 渲染為
 * 「客服人員」——會員 MUST NOT 看到管理員姓名（FR-127）。這不是靠介面自律：
 * 前台的型別裡根本沒有那個欄位。
 */
export interface Message {
  id: string
  /** **由伺服器判定**，前端送出的值一律被忽略（FR-125）。 */
  senderRole: SenderRole
  /** 這則是不是我自己送的。由後端判定，前端不必自己比對 id。 */
  mine: boolean
  body: string
  readAt: string | null
  createdAt: string
}

/** 管理員端的一則訊息。⚠️ 多一個 `senderName`——接手的人需要知道前一句是誰說的（FR-127）。 */
export interface AdminMessage {
  id: string
  threadUserId: string
  senderId: string
  senderRole: SenderRole
  senderName: string | null
  body: string
  readAt: string | null
  createdAt: string
}

/** 後台的討論串清單。⚠️ **沒有「指派給誰」，也不會有**（FR-127）。 */
export interface ThreadSummary {
  userId: string
  userName: string | null
  /** 會員送出而尚未被讀的則數——客服的待辦 */
  unread: number
  lastMessageAt: string | null
}

/**
 * 送出一則訊息。
 *
 * ⚠️ **只有 `body`。** 沒有 `senderRole` 也沒有 `senderId`——那兩者由伺服器依
 * token 判定（FR-125、SC-032）。
 */
export interface MessageInput {
  body: string
}

// ---------------------------------------------------------------------------
// 會員端：我的退款申請（US4）
// ---------------------------------------------------------------------------
/**
 * 會員自己的退款申請（FR-037）。
 *
 * ⚠️ **與後台的 `Refund` 是兩個型別，刻意不共用。** 後台那份帶著 `userId` 與
 * `applicantName`——那是跨會員檢視才需要的欄位。會員端的回應裡沒有它們，
 * 而共用一個型別會讓 `refund.applicantName` 在會員頁面上編譯得過、執行時
 * 永遠是 `undefined`，畫面上只是少一行字。
 *
 * `orderNo` 與住宿日期在此**不可為 null**：後端以 join 取得，缺一筆訂單的
 * 退款申請在資料上不成立。
 */
export interface MyRefund {
  id: string
  orderId: string
  /** 對使用者可見的訂單編號（FR-030）。他認得的是這個，不是 uuid。 */
  orderNo: string
  /** `YYYY-MM-DD` */
  checkIn: string
  checkOut: string
  reason: string
  /**
   * 申請當下依級距算定並凍結的金額，整數新臺幣元（FR-041）。
   *
   * ⚠️ 畫面 MUST NOT 自行重算——距入住日的天數會隨時間變動，重算會讓他今天
   * 看到的金額與昨天送出時被告知的不同。
   */
  amount: number
  status: RefundStatus
  /** 管理員的審核備註。⚠️ 尚未審核時為 `null`，不是空字串。 */
  adminNote: string | null
  createdAt: string
  /** 審核時間。尚未審核時為 `null`——前端據此分辨「還在等」與「已有結果」。 */
  reviewedAt: string | null
}

/**
 * 提出退款申請（FR-035）。
 *
 * ⚠️ **刻意沒有 `amount`，也沒有 `status`。** 金額由後端依距入住日的天數算出
 * （FR-041），狀態一律是 `pending`——讓用戶端指定其中任何一個，等於開了一條
 * 「自己決定退多少、自己核准」的路。
 */
export interface RefundCreateInput {
  orderId: string
  /** MUST 填寫。全空白會被後端以 `field: "reason"` 拒絕（FR-035、FR-010）。 */
  reason: string
}
