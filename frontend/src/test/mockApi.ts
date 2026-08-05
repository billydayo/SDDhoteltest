/**
 * 測試用的假後端。
 *
 * 攔在 `fetch` 這一層而不是 mock `api` 物件：`api/client.ts` 本身的行為
 * （附加 Authorization、401 處理、查詢字串組裝）也是要驗的東西之一，
 * mock 掉它等於把那些行為從測試裡拿掉。
 *
 * ⚠️ **未列出的路徑一律回 404 而非空物件。** 回 `{}` 會讓「呼叫了錯誤的
 * 端點」看起來像「端點回了空資料」——元件安靜地渲染出空列表，測試通過，
 * 而實際上路徑打錯了。
 */
import { vi } from 'vitest'

import type {
  AdminOrder,
  AdminRoom,
  AdminUser,
  DashboardStats,
  FavoriteRoom,
  MyRefund,
  MyReview,
  Order,
  OrderStats,
  Profile,
  PublicReview,
  RiskCheck,
  Room,
  RoomDetail,
  SiteContent,
  Vocabulary,
} from '../api/types'

export const MEMBER: Profile = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'member@example.com',
  role: 'member',
  displayName: '測試會員',
  phone: null,
  createdAt: '2026-08-01T00:00:00Z',
}

export const ADMIN: Profile = {
  ...MEMBER,
  id: '22222222-2222-2222-2222-222222222222',
  email: 'admin@example.com',
  role: 'admin',
  displayName: '測試管理員',
}

export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: '海景雙人房 201',
    type: '雙人房',
    maxGuests: 2,
    nightlyPrice: 3200,
    images: ['https://example.test/a.jpg'],
    amenities: ['免費 Wi-Fi', '浴缸'],
    features: ['採光佳'],
    description: '面海的安靜房間。',
    status: 'available',
    averageRating: 4.5,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

export function makeRoomDetail(overrides: Partial<RoomDetail> = {}): RoomDetail {
  return {
    ...makeRoom(),
    availability: 'available',
    latestRiskCheck: null,
    ...overrides,
  }
}

export const RISK_CHECK: RiskCheck = {
  brightness: 72,
  clutter: 18,
  contrast: 65,
  riskScore: 24,
  riskLevel: '低',
  imagePath: '/uploads/x.jpg',
  createdAt: '2026-07-20T00:00:00Z',
}

export const VOCABULARY: Vocabulary = {
  amenities: ['免費 Wi-Fi', '浴缸', '陽台'],
  features: ['採光佳', '安靜樓層'],
}

export const SITE_CONTENT: SiteContent = {
  heroTitle: 'Sunny 訂房平台',
  heroSubtitle: '舒適住宿，安心入住',
  heroImage: '',
  updatedAt: '2026-08-01T00:00:00Z',
}

export const DASHBOARD: DashboardStats = {
  totalOrders: 12,
  todayCheckIns: 2,
  todayCheckOuts: 1,
  roomsAvailable: 6,
  roomsBooked: 3,
  roomsMaintenance: 1,
  pendingReviews: 2,
  pendingRefunds: 1,
  pendingChannelAlerts: 4,
  monthRevenue: 96000,
}

/**
 * 有訂單時的指標。
 *
 * ⚠️ 「**無**訂單」的那一組（兩個比值為 `null`）刻意不在這裡放預設值——
 * 那是每個相關測試都該自己明確寫出來的前提，而不是可以順手繼承的背景設定。
 */
export const ORDER_STATS: OrderStats = {
  totalOrders: 12,
  placedOrders: 12,
  paidOrders: 9,
  unpaidCancelledOrders: 3,
  revenue: 96000,
  conversionRate: 0.75,
  averageOrderValue: 10667,
}

/**
 * 一筆訂單。
 *
 * ⚠️ `expiresAt` 預設在**很遠的未來**：`PaymentCountdown` 會依它決定顯示倒數
 * 還是「付款時間已過」。用一個接近現在的時間當預設，測試會在跑得慢的機器上
 * 隨機失敗，而失敗訊息會指向一個與時間毫無關係的斷言。
 */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'bbbbbbbb-0000-0000-0000-000000000001',
    orderNo: 'SN20260804001',
    roomId: 'aaaaaaaa-0000-0000-0000-000000000001',
    checkIn: '2026-09-01',
    checkOut: '2026-09-03',
    nights: 2,
    guestCount: 2,
    contactName: '王小明',
    phone: '0912345678',
    email: 'member@example.com',
    paymentMethod: 'LINE Pay',
    totalAmount: 6400,
    status: 'pending-payment',
    expiresAt: '2099-01-01T00:00:00Z',
    cancelReason: null,
    createdAt: '2026-08-04T00:00:00Z',
    ...overrides,
  }
}

/** 一筆退款申請（會員端）。 */
export function makeRefund(overrides: Partial<MyRefund> = {}): MyRefund {
  return {
    id: 'cccccccc-0000-0000-0000-000000000001',
    orderId: 'bbbbbbbb-0000-0000-0000-000000000001',
    orderNo: 'SN20260804001',
    checkIn: '2026-09-01',
    checkOut: '2026-09-03',
    reason: '行程有變。',
    amount: 6400,
    status: 'pending',
    adminNote: null,
    createdAt: '2026-08-05T00:00:00Z',
    reviewedAt: null,
    ...overrides,
  }
}

/**
 * 本人寫的一則評論（`GET /reviews`、`POST /reviews`）。
 *
 * ⚠️ 預設 `status: 'pending'`——那是剛送出時**唯一**可能的狀態（FR-045）。
 * 預設成 `approved` 的話，「送出後要說明還沒公開」那條就永遠測不到。
 */
export function makeMyReview(overrides: Partial<MyReview> = {}): MyReview {
  return {
    id: 'dddddddd-0000-0000-0000-000000000001',
    orderId: 'bbbbbbbb-0000-0000-0000-000000000001',
    roomId: 'aaaaaaaa-0000-0000-0000-000000000001',
    rating: 5,
    comment: '房間比想像中寬敞，早餐的選擇也多，下次來這一帶還會再訂一次。',
    category: '住宿體驗',
    status: 'pending',
    createdAt: '2026-08-05T00:00:00Z',
    ...overrides,
  }
}

/** 房源詳情頁上的一則已公開評論。⚠️ 沒有 `status` 欄位——這裡只會有 approved 的。 */
export function makePublicReview(overrides: Partial<PublicReview> = {}): PublicReview {
  return {
    id: 'eeeeeeee-0000-0000-0000-000000000001',
    rating: 5,
    comment: '房間乾淨，陽台的海景比照片還好。',
    category: '住宿體驗',
    authorName: '王小明',
    createdAt: '2026-08-01T00:00:00Z',
    adminReply: null,
    adminReplyAt: null,
    ...overrides,
  }
}

/** 一則要回給前端的錯誤。`body` 的形狀與後端的 `DomainError` 一致。 */
export interface MockError {
  status: number
  body: { detail: string; code: string; field?: string }
}

/**
 * 這個回傳值是「錯誤」還是「資料」。
 *
 * ⚠️ **MUST NOT 用 `'status' in result` 判斷。** `Order` 自己就有一個 `status`
 * 欄位（`pending-payment` 等），那樣寫會把每一筆正常的訂單都當成錯誤回應，
 * 而 `status` 是字串，`new Response(..., {status: 'pending-payment'})` 會拋一個
 * 與訂單毫無關係的例外。`body` 才是 `MockError` 獨有的。
 */
function isMockError(result: object): result is MockError {
  return 'body' in result
}

export interface MockOptions {
  profile?: Profile | null
  /**
   * `GET /me` 直接回這個錯誤，**優先於 `profile`**。
   *
   * 用來模擬「token 還好好的，但後端暫時不在」——部署、重啟、資料庫斷線。
   * 這個情境與 401 在畫面上長得很像，但要告訴使用者的話完全相反，
   * 因此 `AuthContext` 必須分得出來（FR-084、FR-009d）。
   */
  meError?: MockError
  /** `GET /favorites`。預設空清單——未登入或還沒收藏過都是這個狀態。 */
  favorites?: FavoriteRoom[]
  rooms?: Room[]
  roomDetail?: RoomDetail
  vocabulary?: Vocabulary
  siteContent?: SiteContent
  /** 後台儀表板（`GET /admin/dashboard`）。 */
  dashboard?: DashboardStats
  /** 後台訂單指標。⚠️ 兩個比值可為 `null`，那是要驗的行為之一。 */
  orderStats?: OrderStats
  adminOrders?: AdminOrder[]
  adminRooms?: AdminRoom[]
  adminUsers?: AdminUser[]
  /** 每次 `/rooms` 查詢的完整網址，供斷言「送出了哪些參數」。 */
  roomQueries?: string[]
  /** `POST /auth/login`。回 `MockError` 代表拒絕；預設成功並回 `profile`。 */
  onLogin?: (body: unknown) => MockError | null
  /** `POST /auth/register`。 */
  onRegister?: (body: unknown) => MockError | null
  /** `PATCH /me`。回傳更新後的 profile，或 `MockError`。 */
  onProfileUpdate?: (body: unknown) => MockError | Profile
  /** 送出過的請求，供斷言「送了什麼、送了幾次」。 */
  calls?: { method: string; path: string; body: unknown }[]
  /**
   * 依查詢字串決定這一次 `/rooms` 要不要改回錯誤；回 `null` 走正常結果。
   *
   * 需要它是因為「第一次成功、第二次被拒」這個序列本身就是要驗的東西：
   * 條件出錯時，前一次的結果 MUST 留在畫面上。
   */
  onRooms?: (query: string) => MockError | null
  /** `POST /orders`。回傳建立好的訂單，或 `MockError`。 */
  onOrderCreate?: (body: unknown) => MockError | Order
  /** `POST /orders/{id}/pay`。 */
  onOrderPay?: (orderId: string) => MockError | Order
  /** `GET /orders`。後端已依入住日排序，這裡原樣回傳。 */
  orders?: Order[]
  /** `GET /orders/{id}`。未指定時取 `orders` 裡 id 相符的那一筆。 */
  onOrderGet?: (orderId: string) => MockError | Order
  /** `POST /orders/{id}/cancel`。 */
  onOrderCancel?: (orderId: string) => MockError | Order
  /** `GET /refunds`。 */
  refunds?: MyRefund[]
  /** `POST /refunds`。 */
  onRefundCreate?: (body: unknown) => MockError | MyRefund
  /**
   * `GET /rooms/{id}/reviews`。**預設空陣列**——那是一間新房源的真實樣子，
   * 而畫面上要顯示的是「尚無評論」，不是一塊空白（FR-047 的同一個原則）。
   *
   * 假後端會依 `?category=` 自行篩選，因此測 FR-048 時給一份混合類型的資料
   * 即可，不必為每個頁籤各準備一組。
   */
  roomReviews?: PublicReview[]
  /** `GET /reviews`（我的評論，含待審核）。 */
  myReviews?: MyReview[]
  /** `POST /reviews`。 */
  onReviewCreate?: (body: unknown) => MockError | MyReview
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 安裝假後端。回傳的物件會累積被呼叫過的 `/rooms` 查詢字串與所有請求。 */
export function mockApi(options: MockOptions = {}) {
  const roomQueries: string[] = options.roomQueries ?? []
  const calls: { method: string; path: string; body: unknown }[] = options.calls ?? []

  /** 登入成功後回的身分。未指定 `profile` 時給一個一般會員。 */
  const loggedIn = () => options.profile ?? MEMBER

  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const [path = '', query = ''] = raw.split('?')
    const method = init?.method ?? 'GET'
    const body: unknown =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    calls.push({ method, path, body })

    if (path.endsWith('/auth/login') || path.endsWith('/auth/register')) {
      const reject = path.endsWith('/auth/login')
        ? options.onLogin?.(body)
        : options.onRegister?.(body)
      if (reject) return Promise.resolve(json(reject.body, reject.status))
      return Promise.resolve(
        json(
          { accessToken: 'fake-token', tokenType: 'bearer', profile: loggedIn() },
          path.endsWith('/register') ? 201 : 200,
        ),
      )
    }

    if (path.endsWith('/me') && method === 'PATCH') {
      const result = options.onProfileUpdate?.(body)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(json(result ?? loggedIn()))
    }

    if (path.endsWith('/me')) {
      // ⚠️ `meError` MUST 先於 `profile` 判斷：要模擬的正是「token 有效、
      // 但伺服器回不了話」，那個情境下兩者會同時存在
      if (options.meError) {
        return Promise.resolve(json(options.meError.body, options.meError.status))
      }
      return Promise.resolve(
        options.profile
          ? json(options.profile)
          : json({ detail: '請先登入。', code: 'NOT_AUTHENTICATED' }, 401),
      )
    }
    /*
     * ⚠️ 後台路徑 MUST 在前台之前判斷。
     *
     * `/api/admin/rooms` 的結尾**就是** `/rooms`——順序反過來的話，後台的
     * 房源查詢會安靜地拿到前台那份假資料，測試照樣通過，而斷言驗的其實是
     * 另一個端點的回應。
     */
    if (path.endsWith('/admin/dashboard')) {
      return Promise.resolve(json(options.dashboard ?? DASHBOARD))
    }
    if (path.endsWith('/admin/orders/stats')) {
      return Promise.resolve(json(options.orderStats ?? ORDER_STATS))
    }
    if (path.endsWith('/admin/orders')) {
      return Promise.resolve(json(options.adminOrders ?? []))
    }
    if (path.endsWith('/admin/rooms')) {
      return Promise.resolve(json(options.adminRooms ?? []))
    }
    if (path.endsWith('/admin/users')) {
      return Promise.resolve(json(options.adminUsers ?? []))
    }

    // 訂單。⚠️ `/pay` 要在 `/orders` 之前判斷——後者用的是 `endsWith`，
    // 而 `/api/orders/xxx/pay` 並不以 `/orders` 結尾，但先寫先贏的習慣值得保持。
    const payMatch = /\/orders\/([^/]+)\/pay$/.exec(path)
    if (payMatch && method === 'POST') {
      const result = options.onOrderPay?.(payMatch[1] ?? '')
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(json(result ?? makeOrder({ status: 'confirmed' })))
    }
    const cancelMatch = /\/orders\/([^/]+)\/cancel$/.exec(path)
    if (cancelMatch && method === 'POST') {
      const id = cancelMatch[1] ?? ''
      const result = options.onOrderCancel?.(id)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(
        json(result ?? makeOrder({ id, status: 'cancelled', cancelReason: 'member-cancelled' })),
      )
    }
    if (path.endsWith('/orders') && method === 'POST') {
      const result = options.onOrderCreate?.(body)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(json(result ?? makeOrder(), 201))
    }
    if (path.endsWith('/orders') && method === 'GET') {
      return Promise.resolve(json(options.orders ?? []))
    }
    if (path.endsWith('/refunds') && method === 'POST') {
      const result = options.onRefundCreate?.(body)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(json(result ?? makeRefund(), 201))
    }
    if (path.endsWith('/refunds') && method === 'GET') {
      return Promise.resolve(json(options.refunds ?? []))
    }
    // ⚠️ 這一條 MUST 排在 `/orders`、`/orders/{id}/pay` 與 `/orders/{id}/cancel`
    // 之後：`/api/orders/xxx/pay` 也符合「/orders/ 加一段」的形狀。
    const orderMatch = /\/orders\/([^/]+)$/.exec(path)
    if (orderMatch && method === 'GET') {
      const id = orderMatch[1] ?? ''
      const result = options.onOrderGet?.(id)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      const found = result ?? options.orders?.find((o) => o.id === id)
      return Promise.resolve(
        found
          ? json(found)
          : json({ detail: '查無此訂單。', code: 'ORDER_NOT_FOUND' }, 404),
      )
    }

    /*
     * 評論。⚠️ 這兩條 MUST 排在 `/rooms` 與 `/rooms/{id}` 之前。
     * `/api/rooms/xxx/reviews` 不符合那兩條的形狀，但順序寫錯一次就會很難查，
     * 而錯誤的樣子是「房源詳情回了一份評論陣列」。
     */
    if (path.endsWith('/reviews') && method === 'POST') {
      const result = options.onReviewCreate?.(body)
      if (result && isMockError(result)) return Promise.resolve(json(result.body, result.status))
      return Promise.resolve(json(result ?? makeMyReview(), 201))
    }
    const roomReviewsMatch = /\/rooms\/[^/]+\/reviews$/.test(path)
    if (roomReviewsMatch) {
      const category = new URLSearchParams(query).get('category')
      const all = options.roomReviews ?? []
      // 與後端一致：不帶 category 回全部，帶了就精確比對（FR-048）
      return Promise.resolve(
        json(category === null ? all : all.filter((r) => r.category === category)),
      )
    }
    if (path.endsWith('/reviews') && method === 'GET') {
      return Promise.resolve(json(options.myReviews ?? []))
    }

    if (path.endsWith('/vocabulary')) {
      return Promise.resolve(json(options.vocabulary ?? VOCABULARY))
    }
    if (path.endsWith('/site-content')) {
      return Promise.resolve(json(options.siteContent ?? SITE_CONTENT))
    }
    /*
     * ⚠️ 收藏 MUST 在 `/rooms` 之前判斷。
     *
     * `POST /favorites/{roomId}` 不會撞到下面那條（它比對的是結尾的 `/rooms`），
     * 但 `GET /favorites` 若落到最後的 fallthrough 就會回 404 NOT_MOCKED，
     * 而症狀會出現在一個看起來與收藏無關的房源列表測試裡。
     */
    if (/\/favorites(\/|$)/.test(path)) {
      if (method === 'POST' || method === 'DELETE') {
        // 後端是冪等的：已收藏時再按一次不是錯誤
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(json(options.favorites ?? []))
    }

    if (path.endsWith('/rooms')) {
      roomQueries.push(query)
      const failure = options.onRooms?.(query)
      if (failure) return Promise.resolve(json(failure.body, failure.status))
      return Promise.resolve(json(options.rooms ?? [makeRoom()]))
    }
    if (/\/rooms\/[^/]+$/.test(path)) {
      return Promise.resolve(json(options.roomDetail ?? makeRoomDetail()))
    }

    // ⚠️ 未預期的呼叫必須大聲失敗，不能回空物件蒙混過去
    return Promise.resolve(json({ detail: `測試未預期的呼叫：${raw}`, code: 'NOT_MOCKED' }, 404))
  })

  return { roomQueries, calls }
}
