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

import type { Profile, RiskCheck, Room, RoomDetail, SiteContent, Vocabulary } from '../api/types'

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

/** 一則要回給前端的錯誤。`body` 的形狀與後端的 `DomainError` 一致。 */
export interface MockError {
  status: number
  body: { detail: string; code: string; field?: string }
}

export interface MockOptions {
  profile?: Profile | null
  rooms?: Room[]
  roomDetail?: RoomDetail
  vocabulary?: Vocabulary
  siteContent?: SiteContent
  /** 每次 `/rooms` 查詢的完整網址，供斷言「送出了哪些參數」。 */
  roomQueries?: string[]
  /**
   * 依查詢字串決定這一次 `/rooms` 要不要改回錯誤；回 `null` 走正常結果。
   *
   * 需要它是因為「第一次成功、第二次被拒」這個序列本身就是要驗的東西：
   * 條件出錯時，前一次的結果 MUST 留在畫面上。
   */
  onRooms?: (query: string) => MockError | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 安裝假後端。回傳的物件會累積被呼叫過的 `/rooms` 查詢字串。 */
export function mockApi(options: MockOptions = {}) {
  const roomQueries: string[] = options.roomQueries ?? []

  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const [path = '', query = ''] = raw.split('?')

    if (path.endsWith('/me')) {
      return Promise.resolve(
        options.profile
          ? json(options.profile)
          : json({ detail: '請先登入。', code: 'NOT_AUTHENTICATED' }, 401),
      )
    }
    if (path.endsWith('/vocabulary')) {
      return Promise.resolve(json(options.vocabulary ?? VOCABULARY))
    }
    if (path.endsWith('/site-content')) {
      return Promise.resolve(json(options.siteContent ?? SITE_CONTENT))
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

  return { roomQueries }
}
