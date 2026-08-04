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
  AdminOrder,
  AdminOrderSearchParams,
  AdminRoom,
  AdminRoomSearchParams,
  AdminUser,
  AffectedOrder,
  ApiErrorBody,
  DashboardStats,
  LoginInput,
  Order,
  OrderCreateInput,
  OrderStats,
  OrderStatusInput,
  PhotoUpload,
  Profile,
  ProfileUpdateInput,
  RegisterInput,
  Role,
  Room,
  RoomDetail,
  RoomSearchParams,
  RoomStatus,
  RoomWriteInput,
  SiteContent,
  TokenResponse,
  UserUpdateInput,
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

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}${buildQuery(query)}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
 * 上傳檔案。**與 `request` 分開，因為 header 的處理正好相反。**
 *
 * ⚠️ `multipart/form-data` 的 `Content-Type` **MUST NOT 手動設定**。
 * 它必須帶一段 boundary（`multipart/form-data; boundary=----xyz`），而那串
 * 值只有瀏覽器在序列化 `FormData` 時才知道。自己填一個沒有 boundary 的
 * `multipart/form-data`，後端會解析出零個欄位——回應是「缺少 file 欄位」，
 * 而畫面上檔案明明選好了。
 *
 * 因此這裡刻意不呼叫 `request()`：那裡對 `body !== undefined` 會補上
 * `application/json`，正是不能發生的事。
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: form })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError(cause)
  }

  if (res.status === 401 && token) {
    setToken(null)
    onUnauthorized?.()
  }
  if (!res.ok) throw new ApiError(res.status, await readErrorBody(res))
  return (await res.json()) as T
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
  },

  vocabulary: {
    get: (signal?: AbortSignal) => request<Vocabulary>('/vocabulary', signal ? { signal } : {}),
  },

  /** 首頁主視覺。**公開端點**——首頁不需登入（FR-061）。 */
  siteContent: {
    get: (signal?: AbortSignal) => request<SiteContent>('/site-content', signal ? { signal } : {}),
  },

  orders: {
    create: (input: OrderCreateInput) =>
      request<Order>('/orders', { method: 'POST', body: input }),
    /** 模擬付款。**沒有任何請求內容**——不接收卡號、有效期限、CVV（FR-028）。 */
    pay: (orderId: string) => request<Order>(`/orders/${orderId}/pay`, { method: 'POST' }),
  },

  // =========================================================================
  // 後台（US6）。⚠️ 本段以下只 append、不重排（assignments.md「交界處」）。
  //
  // 全部端點皆在後端的 `require_admin` 之後。前端的 `RequireAdmin` 守衛只
  // 決定畫面呈現，**不是存取邊界**（憲章原則 VI）——這裡列出它們不代表
  // 非管理員呼叫得動。
  // =========================================================================
  admin: {
    /** 營運總覽（FR-049）。 */
    dashboard: (signal?: AbortSignal) =>
      request<DashboardStats>('/admin/dashboard', signal ? { signal } : {}),

    rooms: {
      list: (params: AdminRoomSearchParams = {}, signal?: AbortSignal) =>
        request<AdminRoom[]>('/admin/rooms', {
          query: {
            keyword: params.keyword,
            type: params.type,
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            startDate: params.startDate,
            endDate: params.endDate,
            status: params.status,
          },
          ...(signal ? { signal } : {}),
        }),
      get: (roomId: string, signal?: AbortSignal) =>
        request<AdminRoom>(`/admin/rooms/${roomId}`, signal ? { signal } : {}),
      create: (input: RoomWriteInput) =>
        request<AdminRoom>('/admin/rooms', { method: 'POST', body: input }),
      update: (roomId: string, input: RoomWriteInput) =>
        request<AdminRoom>(`/admin/rooms/${roomId}`, { method: 'PUT', body: input }),
      /** 只接受 `available` 與 `maintenance`——「已預訂」由訂單推導（FR-051）。 */
      setStatus: (roomId: string, status: RoomStatus) =>
        request<AdminRoom>(`/admin/rooms/${roomId}/status`, {
          method: 'PATCH',
          body: { status },
        }),
      /**
       * 刪除。**兩段式**（FR-052）：不帶 `confirm` 時後端回 409 並說明影響範圍，
       * 不執行刪除。二次確認因此由伺服器端落實，而不是只有前端跳個對話框——
       * 那種確認直接呼叫 API 就繞過去了。
       */
      // 204 無內容。型別寫 `undefined` 而非 `void`——`request` 對 204 回的
      // 就是 `undefined`，而 `void` 在型別位置上不表示「沒有值」。
      remove: (roomId: string, confirm = false) =>
        request<undefined>(`/admin/rooms/${roomId}`, {
          method: 'DELETE',
          query: { confirm },
        }),
      /** 刪除前的影響範圍：該房源尚未結束的訂單（FR-052）。 */
      affectedOrders: (roomId: string, signal?: AbortSignal) =>
        request<AffectedOrder[]>(
          `/admin/rooms/${roomId}/affected-orders`,
          signal ? { signal } : {},
        ),
    },

    photos: {
      /**
       * 上傳一張照片，回傳**尚未掛到任何房源上**的路徑。
       *
       * ⚠️ 送進來的 `File` MUST 已在瀏覽器內縮圖轉檔（FR-050c）——
       * 縮圖由 `ImageManager` 負責，這裡只管送。
       */
      upload: (file: File) => {
        const form = new FormData()
        form.append('file', file)
        return upload<PhotoUpload>('/admin/room-photos', form)
      },
      /** 捨棄本次上傳但未保存的檔案（FR-050f 的「取消」路徑）。 */
      discard: (path: string) =>
        request<undefined>('/admin/room-photos', { method: 'DELETE', query: { path } }),
    },

    orders: {
      list: (params: AdminOrderSearchParams = {}, signal?: AbortSignal) =>
        request<AdminOrder[]>('/admin/orders', {
          query: {
            orderNo: params.orderNo,
            status: params.status,
            roomId: params.roomId,
            startDate: params.startDate,
            endDate: params.endDate,
          },
          ...(signal ? { signal } : {}),
        }),
      /** 營運指標（FR-053）。⚠️ 無訂單時兩個比值為 `null`，不是 0。 */
      stats: (signal?: AbortSignal) =>
        request<OrderStats>('/admin/orders/stats', signal ? { signal } : {}),
      setStatus: (orderId: string, input: OrderStatusInput) =>
        request<AdminOrder>(`/admin/orders/${orderId}/status`, { method: 'PATCH', body: input }),
    },

    users: {
      list: (params: { keyword?: string; role?: string } = {}, signal?: AbortSignal) =>
        request<AdminUser[]>('/admin/users', {
          query: { keyword: params.keyword, role: params.role },
          ...(signal ? { signal } : {}),
        }),
      update: (userId: string, input: UserUpdateInput) =>
        request<AdminUser>(`/admin/users/${userId}`, { method: 'PATCH', body: input }),
      /**
       * 角色升降（FR-055）。
       *
       * 與 `update` 分開是後端的設計，前端照著走：合併成一個端點就會出現一條
       * 不留稽核紀錄的升權路徑。
       */
      setRole: (userId: string, role: Role) =>
        request<AdminUser>(`/admin/users/${userId}/role`, { method: 'PATCH', body: { role } }),
    },
  },
}

/** 供測試與少數需要自訂路徑的情境使用。一般程式碼請用上面的 `api`。 */
export { request as rawRequest }
