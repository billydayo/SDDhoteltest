/**
 * T038：**前端唯一的網路出口。**
 *
 * 憲章原則 III 禁止元件內直接 `fetch`。集中的實際收益是 **401 處理**——
 * token 過期在任何頁面都會發生，分散處理必然會漏掉幾個頁面，而漏掉的症狀是
 * 使用者看到一個空白列表，以為自己的資料不見了（plan.md）。
 *
 * ## 401 什麼時候該導向登入頁
 *
 * **只有「原本帶著 token」的請求收到 401 才導向。** 這條規則很重要：
 *
 * - 帶 token 收到 401 → 憑證過期或被撤銷 → 清除 token、導向登入頁並記住原目的地
 * - 沒帶 token 收到 401 → 例如登入表單密碼錯誤 → **MUST NOT 導向**，
 *   否則使用者會在登入頁上被反覆「導向登入頁」，而永遠看不到錯誤訊息
 *
 * 用「有沒有帶 token」判斷比替每個呼叫加一個 `skipRedirect` 旗標可靠：
 * 旗標會忘記加，而忘記的那一次剛好就是出問題的那一次。
 *
 * ## 秘鑰
 *
 * ⚠️ **前端 MUST NOT 持有任何秘鑰**（憲章前端約束、FR-085）。
 * `VITE_` 前綴的變數會被寫進建置產物，只能承載公開資訊。本檔唯一讀取的
 * `VITE_API_BASE_URL` 是一個 URL 路徑，不是憑證。
 */
import type {
  AdminLog,
  AdminLogFilters,
  AdminMessage,
  AdminOrder,
  AdminOrderFilters,
  AdminReview,
  AdminReviewFilters,
  AdminRoom,
  AdminRoomFilters,
  AdminUser,
  AdminUserFilters,
  AdminUserUpdateInput,
  AffectedOrder,
  ApiErrorBody,
  ChannelComparison,
  ChannelFilters,
  ComplaintTemplate,
  DashboardStats,
  ExportFormat,
  ExportModule,
  ExportQuery,
  ExportSheet,
  FavoriteRoom,
  LoginInput,
  Message,
  MessageInput,
  MyRefund,
  MyReview,
  Order,
  OrderCreateInput,
  OrderStats,
  OrderStatus,
  PhotoUpload,
  Profile,
  ProfileUpdateInput,
  PublicReview,
  Refund,
  RefundCreateInput,
  RefundDecisionInput,
  RefundFilters,
  RegisterInput,
  ResetResult,
  ReviewCreateInput,
  ReviewDecisionInput,
  ReviewReplyInput,
  RiskCheck,
  Role,
  Room,
  RoomDetail,
  RoomSearchParams,
  RoomStatus,
  RoomWriteInput,
  SiteContent,
  SiteContentInput,
  SystemSettings,
  SystemSettingsInput,
  ThreadSummary,
  TokenResponse,
  Vocabulary,
} from './types'

/**
 * API 根路徑。預設 `/api`，由 Vite 的開發代理轉給 FastAPI。
 *
 * 走同源相對路徑而非絕對 URL，是為了不必為了開發方便去放寬後端的 CORS——
 * 憲章禁止 `allow_origins=["*"]` 搭配 `allow_credentials=True`，而「開發時
 * 先開寬一點」正是那個組合最常見的來源。
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

const TOKEN_STORAGE_KEY = 'sunny.accessToken'

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------
/**
 * 後端回傳的領域錯誤。
 *
 * `detail` 已是可直接顯示給使用者的繁體中文，**MUST NOT 再包一層
 * 「發生錯誤：」之類的前綴**——後端已經把話講好了，再包一層只會變得囉嗦。
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | undefined

  constructor(status: number, body: ApiErrorBody) {
    super(body.detail)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.field = body.field
  }
}

/**
 * 連不上後端。**與「後端回了錯誤」是不同的事**（FR-084）。
 *
 * 分開才能給出不同的訊息：後端拒絕時要顯示它給的理由，連不上時要說
 * 「無法連線至伺服器」——把兩者混為一談，使用者會在伺服器根本沒開的時候
 * 讀到一句莫名其妙的業務錯誤。
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('無法連線至伺服器，請確認網路連線後再試一次。')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------
// token
// ---------------------------------------------------------------------------
/**
 * 憲章原則 III 允許 token 存於 `localStorage`，**禁止業務資料**。
 * 房源、訂單、評論一律每次向後端取得——存本機的副本會與伺服器不同步，
 * 而不同步的症狀是使用者看到早該消失的資料。
 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    // 隱私模式或停用儲存空間。功能降級為「關掉分頁就要重新登入」，
    // 不該讓整個應用崩掉。
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // 同上：存不進去就算了，這一個分頁仍然可以正常使用。
  }
}

// ---------------------------------------------------------------------------
// 401 處理
// ---------------------------------------------------------------------------
type UnauthorizedHandler = () => void

let onUnauthorized: UnauthorizedHandler | null = null

/**
 * 註冊「憑證失效」的處理器。由 `App.tsx` 在掛載時以 router 的 navigate 註冊。
 *
 * 不直接在此處呼叫 `window.location` 是為了保留 SPA 導覽——整頁重載會丟掉
 * 使用者已填的表單內容，而 FR-083 明訂失敗時 MUST 保留已填內容。
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

// ---------------------------------------------------------------------------
// 請求
// ---------------------------------------------------------------------------
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | string[] | undefined>
  signal?: AbortSignal
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) {
      // 多值篩選（設施、特色）重複同一個鍵，對應 FastAPI 的 `list[str]` 查詢參數
      for (const item of value) params.append(key, item)
    } else {
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const parsed: unknown = await res.json()
    if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
      const { detail, code, field } = parsed as Record<string, unknown>
      if (typeof detail === 'string') {
        return {
          detail,
          code: typeof code === 'string' ? code : 'UNKNOWN',
          ...(typeof field === 'string' ? { field } : {}),
        }
      }
    }
  } catch {
    // 回應不是 JSON（例如代理送回一頁 HTML）。往下走預設訊息。
  }
  // ⚠️ MUST NOT 把原始回應內容當成訊息顯示——那可能是一整頁 HTML，
  // 也可能夾帶內部路徑。給一句可理解的話，細節留在 console。
  return { detail: '系統發生錯誤，請稍後再試。', code: 'UNEXPECTED_RESPONSE' }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options
  const token = getToken()

  // `FormData` 走 multipart，**MUST NOT 自己設 `Content-Type`**——那個標頭裡
  // 帶著一段隨機的 boundary，只有瀏覽器知道它是什麼。手動蓋掉之後後端會收到
  // 一個沒有 boundary 的 multipart 請求，症狀是所有欄位都變成缺漏。
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData

  const headers: Record<string, string> = {}
  if (body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}${buildQuery(query)}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: isMultipart ? body : JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    })
  } catch (cause) {
    // 使用者主動取消（切換頁面、改了搜尋條件）不是錯誤，原樣往上拋，
    // 讓呼叫端的 `AbortError` 判斷照常運作。
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError(cause)
  }

  if (res.status === 401 && token) {
    // 帶著 token 卻被拒 → 憑證過期或被撤銷。清掉並交給處理器導向登入頁。
    setToken(null)
    onUnauthorized?.()
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorBody(res))
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * 只在意「成功與否」的請求（204 或不需要回應內容者）。
 *
 * 存在的理由是型別而非行為：`request<void>` 會被 lint 擋下
 * （`void` 只能當回傳型別），而 `request<undefined>` 則會讓呼叫端拿到一個
 * 名為 `undefined` 的值——那看起來像是「有東西但沒拿到」。
 */
async function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  await request<unknown>(path, options)
}

// ---------------------------------------------------------------------------
// 端點
// ---------------------------------------------------------------------------
/**
 * ⚠️ **API 路徑 MUST 全部收在這裡**（憲章原則 III）。
 * 元件呼叫 `api.rooms.list(...)`，不拼字串——路徑散落到各元件之後，
 * 改一個端點就得靠全域搜尋，而搜尋一定會漏。
 */
export const api = {
  auth: {
    register: (input: RegisterInput) =>
      request<TokenResponse>('/auth/register', { method: 'POST', body: input }),
    login: (input: LoginInput) =>
      request<TokenResponse>('/auth/login', { method: 'POST', body: input }),
    /** Google 授權頁的完整網址。導向由呼叫端負責。 */
    googleStartUrl: () => `${BASE_URL}/auth/google`,
  },

  profile: {
    me: (signal?: AbortSignal) => request<Profile>('/me', signal ? { signal } : {}),
    update: (input: ProfileUpdateInput) =>
      request<Profile>('/me', { method: 'PATCH', body: input }),
  },

  rooms: {
    list: (params: RoomSearchParams = {}, signal?: AbortSignal) =>
      request<Room[]>('/rooms', {
        query: {
          keyword: params.keyword,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guestCount: params.guestCount,
          maxPrice: params.maxPrice,
          amenities: params.amenities,
          features: params.features,
          type: params.type,
          sort: params.sort,
        },
        ...(signal ? { signal } : {}),
      }),
    /** `on` 為查詢房態的日期（`YYYY-MM-DD`），未給時後端以今日計。 */
    get: (roomId: string, on?: string, signal?: AbortSignal) =>
      request<RoomDetail>(`/rooms/${roomId}`, {
        ...(on ? { query: { on } } : {}),
        ...(signal ? { signal } : {}),
      }),
    /**
     * 該房源已公開的評論（FR-046、FR-048）。**公開，不需登入。**
     *
     * ⚠️ 後端只回 `approved` 的評論，且沒有可以放寬它的參數（SC-007）。
     * 這裡也刻意不提供 `status` 參數——加了只會回 400，而那個 400 會被
     * 誤讀成「這一頁壞了」。
     */
    reviews: (roomId: string, category?: string, signal?: AbortSignal) =>
      request<PublicReview[]>(`/rooms/${roomId}/reviews`, {
        ...(category ? { query: { category } } : {}),
        ...(signal ? { signal } : {}),
      }),
  },

  /**
   * 評論（FR-042 ~ FR-045）。
   *
   * ⚠️ **`create` 的輸入沒有 `roomId`，也沒有 `status`。** 房源由訂單推導
   * （送 roomId 就能拿 A 房的訂單去評 B 房），狀態一律由後端設為待審核
   * ——自動審核只是初判，MUST NOT 因它通過就直接公開（FR-103）。
   */
  reviews: {
    /** 本人寫過的全部評論，**含尚未通過審核的**——前端據此判斷該筆訂單評過了沒。 */
    list: (signal?: AbortSignal) => request<MyReview[]>('/reviews', signal ? { signal } : {}),
    create: (input: ReviewCreateInput) =>
      request<MyReview>('/reviews', { method: 'POST', body: input }),
  },

  vocabulary: {
    get: (signal?: AbortSignal) => request<Vocabulary>('/vocabulary', signal ? { signal } : {}),
  },

  /**
   * 訂單（FR-020 ~ FR-035b）。
   *
   * ⚠️ **`list` 與 `get` 上都沒有 `userId`。** 擁有者由 token 判定——留一個
   * 查詢參數就等於把整站的訂單開放給任何登入者，而回來的資料看起來完全正常
   * （FR-034、SC-019）。
   */
  orders: {
    create: (input: OrderCreateInput) =>
      request<Order>('/orders', { method: 'POST', body: input }),
    /** 本人的全部訂單，後端已依入住日排序（FR-033）。 */
    list: (signal?: AbortSignal) => request<Order[]>('/orders', signal ? { signal } : {}),
    get: (orderId: string, signal?: AbortSignal) =>
      request<Order>(`/orders/${orderId}`, signal ? { signal } : {}),
    /** 模擬付款。**沒有任何請求內容**——不接收卡號、有效期限、CVV（FR-028）。 */
    pay: (orderId: string) => request<Order>(`/orders/${orderId}/pay`, { method: 'POST' }),
    /**
     * 取消待付款訂單（FR-035a）。
     *
     * ⚠️ **已確認的訂單會被後端拒絕**，且那是刻意的：款項已付，取消必須走
     * 退款申請，否則就繞過了 FR-041 的退款級距。前端把按鈕藏起來只是畫面
     * 呈現，擋住它的是後端（憲章原則 VI）。
     */
    cancel: (orderId: string) => request<Order>(`/orders/${orderId}/cancel`, { method: 'POST' }),
  },

  /**
   * 退款申請（FR-035 ~ FR-041）。
   *
   * ⚠️ **`RefundCreateInput` 沒有 `amount`。** 金額由後端依距入住日的天數
   * 算出（FR-041）——送一個數字過去等於讓人自訂要退多少錢。
   */
  refunds: {
    list: (signal?: AbortSignal) => request<MyRefund[]>('/refunds', signal ? { signal } : {}),
    create: (input: RefundCreateInput) =>
      request<MyRefund>('/refunds', { method: 'POST', body: input }),
  },

  /** 首頁的可編輯內容。**公開**——訪客要看得到主視覺（FR-061）。 */
  siteContent: {
    get: (signal?: AbortSignal) =>
      request<SiteContent>('/site-content', signal ? { signal } : {}),
  },

  /**
   * 收藏（FR-092 ~ FR-095）。
   *
   * ⚠️ **端點上沒有 `userId`。** 收藏的擁有者由 token 判定——沒有那個參數，
   * 「看別人的收藏」在介面上就不可表達，而不只是會被拒絕。
   */
  favorites: {
    list: (signal?: AbortSignal) =>
      request<FavoriteRoom[]>('/favorites', signal ? { signal } : {}),
    /** 冪等：已收藏時再按一次不是錯誤。 */
    add: (roomId: string) => requestNoContent(`/favorites/${roomId}`, { method: 'POST' }),
    remove: (roomId: string) => requestNoContent(`/favorites/${roomId}`, { method: 'DELETE' }),
  },

  /**
   * 會員端私訊（FR-123 ~ FR-128）。
   *
   * ⚠️ **端點上沒有 `threadId`。** 每位會員只有一串，由 token 決定是哪一串。
   */
  messages: {
    list: (signal?: AbortSignal) => request<Message[]>('/messages', signal ? { signal } : {}),
    send: (input: MessageInput) => request<Message>('/messages', { method: 'POST', body: input }),
    markRead: () => requestNoContent('/messages/read', { method: 'POST' }),
  },

  // -------------------------------------------------------------------------
  // 後台
  // -------------------------------------------------------------------------
  /**
   * ⚠️ **這些路徑會被 `require_admin` 擋下，而擋下它的是後端不是這裡。**
   * 前端把入口藏起來只是畫面呈現（憲章原則 VI）。
   */
  admin: {
    dashboard: (signal?: AbortSignal) =>
      request<DashboardStats>('/admin/dashboard', signal ? { signal } : {}),

    rooms: {
      list: (filters: AdminRoomFilters = {}, signal?: AbortSignal) =>
        request<AdminRoom[]>('/admin/rooms', {
          query: {
            keyword: filters.keyword,
            type: filters.type,
            minPrice: filters.minPrice,
            maxPrice: filters.maxPrice,
            startDate: filters.startDate,
            endDate: filters.endDate,
            status: filters.status,
          },
          ...(signal ? { signal } : {}),
        }),
      get: (roomId: string, signal?: AbortSignal) =>
        request<AdminRoom>(`/admin/rooms/${roomId}`, signal ? { signal } : {}),
      create: (input: RoomWriteInput) =>
        request<AdminRoom>('/admin/rooms', { method: 'POST', body: input }),
      update: (roomId: string, input: RoomWriteInput) =>
        request<AdminRoom>(`/admin/rooms/${roomId}`, { method: 'PUT', body: input }),
      setStatus: (roomId: string, status: RoomStatus) =>
        request<AdminRoom>(`/admin/rooms/${roomId}/status`, { method: 'PATCH', body: { status } }),
      remove: (roomId: string) => requestNoContent(`/admin/rooms/${roomId}`, { method: 'DELETE' }),
      /** 刪除前先問清楚有哪些訂單會受影響（FR-052）。 */
      affectedOrders: (roomId: string, signal?: AbortSignal) =>
        request<AffectedOrder[]>(
          `/admin/rooms/${roomId}/affected-orders`,
          signal ? { signal } : {},
        ),
      /**
       * 房源品質檢測（FR-104 ~ FR-107）。
       *
       * ⚠️ **這是系統中唯一接收「檢測圖片」的端點，且它是後台的。** 前台的
       * 安全檢測沒有對應端點——使用者的私人照片 MUST 全程留在瀏覽器內
       * （FR-066、SC-030）。兩條路徑共用「計算」，不共用「上傳」。
       *
       * 三項指標由瀏覽器的 Canvas 算出，**總分與等級由後端重算**。
       */
      createRiskCheck: (
        roomId: string,
        file: Blob,
        metrics: { brightness: number; clutter: number; contrast: number },
      ) => {
        const form = new FormData()
        form.append('file', file, 'risk-check.jpg')
        form.append('brightness', String(metrics.brightness))
        form.append('clutter', String(metrics.clutter))
        form.append('contrast', String(metrics.contrast))
        return request<RiskCheck>(`/admin/rooms/${roomId}/risk-checks`, {
          method: 'POST',
          body: form,
        })
      },
    },

    /**
     * 房源照片的兩段式上傳（FR-050b、FR-050f）。
     *
     * ⚠️ 上傳前 MUST 於瀏覽器內以 Canvas 縮圖轉檔，**MUST NOT 上傳原始檔**
     * （憲章「上傳」條）。後端的大小上限是最後一道網，不是壓縮的替代品。
     */
    roomPhotos: {
      upload: (file: Blob, filename = 'photo.jpg') => {
        const form = new FormData()
        form.append('file', file, filename)
        return request<PhotoUpload>('/admin/room-photos', { method: 'POST', body: form })
      },
      /** 使用者按取消時清掉本次上傳但未保存的檔案。找不到不算錯誤。 */
      discard: (path: string) =>
        requestNoContent('/admin/room-photos', { method: 'DELETE', query: { path } }),
    },

    orders: {
      search: (filters: AdminOrderFilters = {}, signal?: AbortSignal) =>
        request<AdminOrder[]>('/admin/orders', {
          query: {
            orderNo: filters.orderNo,
            status: filters.status,
            roomId: filters.roomId,
            startDate: filters.startDate,
            endDate: filters.endDate,
          },
          ...(signal ? { signal } : {}),
        }),
      stats: (signal?: AbortSignal) =>
        request<OrderStats>('/admin/orders/stats', signal ? { signal } : {}),
      setStatus: (orderId: string, status: OrderStatus, note?: string) =>
        request<AdminOrder>(`/admin/orders/${orderId}/status`, {
          method: 'PATCH',
          body: { status, note },
        }),
    },

    users: {
      list: (filters: AdminUserFilters = {}, signal?: AbortSignal) =>
        request<AdminUser[]>('/admin/users', {
          query: { keyword: filters.keyword, role: filters.role },
          ...(signal ? { signal } : {}),
        }),
      update: (userId: string, input: AdminUserUpdateInput) =>
        request<AdminUser>(`/admin/users/${userId}`, { method: 'PATCH', body: input }),
      /** 角色升降是**獨立端點**，才能保證每一次變更都留下稽核紀錄（FR-055）。 */
      setRole: (userId: string, role: Role) =>
        request<AdminUser>(`/admin/users/${userId}/role`, { method: 'PATCH', body: { role } }),
    },

    reviews: {
      list: (filters: AdminReviewFilters = {}, signal?: AbortSignal) =>
        request<AdminReview[]>('/admin/reviews', {
          query: { status: filters.status, roomId: filters.roomId },
          ...(signal ? { signal } : {}),
        }),
      decide: (reviewId: string, input: ReviewDecisionInput) =>
        request<AdminReview>(`/admin/reviews/${reviewId}/status`, {
          method: 'PATCH',
          body: input,
        }),
      /** 撰寫、修改與收回是同一個端點——`reply` 為空即為收回（FR-103d）。 */
      setReply: (reviewId: string, input: ReviewReplyInput) =>
        request<AdminReview>(`/admin/reviews/${reviewId}/reply`, { method: 'PUT', body: input }),
      /** ⚠️ 刪除不可逆，且會重算房源平均評分（FR-103c）。 */
      remove: (reviewId: string) =>
        requestNoContent(`/admin/reviews/${reviewId}`, { method: 'DELETE' }),
    },

    refunds: {
      list: (filters: RefundFilters = {}, signal?: AbortSignal) =>
        request<Refund[]>('/admin/refunds', {
          query: { status: filters.status },
          ...(signal ? { signal } : {}),
        }),
      decide: (refundId: string, input: RefundDecisionInput) =>
        request<Refund>(`/admin/refunds/${refundId}`, { method: 'PATCH', body: input }),
    },

    /**
     * 匯出（FR-058 ~ FR-060）。
     *
     * ⚠️ **匯出範圍 MUST 為呼叫端當前的篩選結果**，因此條件由呼叫端原樣傳入。
     * `format` 是**實際被記錄的格式**——xlsx 函式庫載入失敗而退回 CSV 時
     * （FR-059），那次退回也要如實記錄。
     */
    exports: {
      get: (module: ExportModule, format: ExportFormat, params: ExportQuery = {}) =>
        request<ExportSheet>(`/admin/exports/${module}`, { query: { format, ...params } }),
    },

    siteContent: {
      get: (signal?: AbortSignal) =>
        request<SiteContent>('/admin/site-content', signal ? { signal } : {}),
      update: (input: SiteContentInput) =>
        request<SiteContent>('/admin/site-content', { method: 'PUT', body: input }),
      uploadHeroImage: (file: Blob, filename = 'hero.jpg') => {
        const form = new FormData()
        form.append('file', file, filename)
        return request<PhotoUpload>('/admin/site-content/hero-image', {
          method: 'POST',
          body: form,
        })
      },
    },

    /**
     * 渠道比價（FR-108 ~ FR-113）。
     *
     * ⚠️ **本模組不連線任何外部平台。** 每一列都帶 `simulated` 與
     * `simulatedNotice`，畫面 MUST 常駐標示（FR-110）。
     */
    channelPrices: {
      list: (filters: ChannelFilters = {}, signal?: AbortSignal) =>
        request<ChannelComparison[]>('/admin/channel-prices', {
          query: { roomId: filters.roomId, resolved: filters.resolved },
          ...(signal ? { signal } : {}),
        }),
      /** 申訴郵件範本。⚠️ 系統 MUST NOT 代為寄送（FR-112）。 */
      complaint: (priceId: string, signal?: AbortSignal) =>
        request<ComplaintTemplate>(
          `/admin/channel-prices/${priceId}/complaint`,
          signal ? { signal } : {},
        ),
      /**
       * 標記／取消標記已處理（FR-113）。
       *
       * ⚠️ 路徑結尾的 `/resolved` **不可省**。後端把它做成子資源
       * （`admin_channel.py` 的 `PATCH /{price_id}/resolved`），而不是對整筆
       * 紀錄的部分更新——因為這支端點只改得動一個欄位，且每一次都要寫稽核。
       * 打到 `/admin/channel-prices/{id}` 會落在「沒有這條路由」而回 404。
       */
      setResolved: (priceId: string, resolved: boolean, note?: string) =>
        request<ChannelComparison>(`/admin/channel-prices/${priceId}/resolved`, {
          method: 'PATCH',
          body: { resolved, note },
        }),
    },

    /** ⚠️ **只有 `list`。** 日誌沒有編輯或刪除端點，畫面上也 MUST NOT 有入口（FR-115）。 */
    logs: {
      list: (filters: AdminLogFilters = {}, signal?: AbortSignal) =>
        request<AdminLog[]>('/admin/logs', {
          query: {
            actorId: filters.actorId,
            action: filters.action,
            startDate: filters.startDate,
            endDate: filters.endDate,
            limit: filters.limit,
          },
          ...(signal ? { signal } : {}),
        }),
    },

    settings: {
      get: (signal?: AbortSignal) =>
        request<SystemSettings>('/admin/settings', signal ? { signal } : {}),
      update: (input: SystemSettingsInput) =>
        request<SystemSettings>('/admin/settings', { method: 'PUT', body: input }),
      /** ⚠️ 還原示範資料需二次確認（FR-073）。`confirm` 是必要的請求內容，不是 query 參數。 */
      resetDemoData: () =>
        request<ResetResult>('/admin/reset-demo-data', {
          method: 'POST',
          body: { confirm: true },
        }),
    },

    messages: {
      threads: (signal?: AbortSignal) =>
        request<ThreadSummary[]>('/admin/messages', signal ? { signal } : {}),
      thread: (threadUserId: string, signal?: AbortSignal) =>
        request<AdminMessage[]>(`/admin/messages/${threadUserId}`, signal ? { signal } : {}),
      reply: (threadUserId: string, input: MessageInput) =>
        request<AdminMessage>(`/admin/messages/${threadUserId}`, { method: 'POST', body: input }),
      markRead: (threadUserId: string) =>
        requestNoContent(`/admin/messages/${threadUserId}/read`, { method: 'POST' }),
    },
  },
}

/** 供測試與少數需要自訂路徑的情境使用。一般程式碼請用上面的 `api`。 */
export { request as rawRequest }
