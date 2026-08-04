/**
 * 篩選條件的資料模型（T055 的純函式部分）。
 *
 * 與 `components/FilterBar.tsx` 分開，是因為這裡全都是**不需要渲染就能測**
 * 的轉換：表單值 → 查詢參數、表單值 → 摘要文字。混在元件檔裡的話，要驗
 * 「空字串有沒有被省略」就得先掛一棵 DOM。
 *
 * 順帶解掉 `react-refresh/only-export-components`：元件檔一旦同時匯出非元件，
 * 開發時的熱更新就會退化成整頁重載。
 */
import type { RoomSearchParams } from '../api/types'
import * as dates from './dates'

export interface FilterValues {
  keyword: string
  checkIn: string
  checkOut: string
  guestCount: string
  maxPrice: string
  amenities: string[]
  features: string[]
}

export const EMPTY_FILTERS: FilterValues = {
  keyword: '',
  checkIn: '',
  checkOut: '',
  guestCount: '',
  maxPrice: '',
  amenities: [],
  features: [],
}

/**
 * 表單值 → API 查詢參數。
 *
 * 空字串一律省略。送出 `keyword=` 會讓後端收到一個空字串條件，而空字串在
 * `ILIKE '%%'` 下是「全部符合」——結果看起來正常，卻是靠巧合正常的。
 */
export function toSearchParams(values: FilterValues): RoomSearchParams {
  const params: RoomSearchParams = {}
  if (values.keyword.trim()) params.keyword = values.keyword.trim()
  if (values.checkIn) params.checkIn = values.checkIn
  if (values.checkOut) params.checkOut = values.checkOut
  if (values.guestCount) params.guestCount = Number(values.guestCount)
  if (values.maxPrice) params.maxPrice = Number(values.maxPrice)
  if (values.amenities.length) params.amenities = values.amenities
  if (values.features.length) params.features = values.features
  return params
}

/**
 * 目前實際生效的條件，供摘要列顯示與「一鍵清除」判斷是否要出現。
 *
 * 只填了一半的日期**也要列出來**：那正是使用者需要被提醒的狀態。
 */
export function activeSummary(values: FilterValues): { key: keyof FilterValues; label: string }[] {
  const out: { key: keyof FilterValues; label: string }[] = []
  if (values.keyword.trim()) out.push({ key: 'keyword', label: `關鍵字：${values.keyword.trim()}` })
  if (values.checkIn && values.checkOut) {
    out.push({ key: 'checkIn', label: dates.formatStay(values.checkIn, values.checkOut) })
  } else if (values.checkIn) {
    out.push({ key: 'checkIn', label: `入住 ${dates.formatDisplayDate(values.checkIn)}` })
  } else if (values.checkOut) {
    out.push({ key: 'checkOut', label: `退房 ${dates.formatDisplayDate(values.checkOut)}` })
  }
  if (values.guestCount) out.push({ key: 'guestCount', label: `${values.guestCount} 人` })
  if (values.maxPrice) out.push({ key: 'maxPrice', label: `每晚不超過 ${values.maxPrice} 元` })
  for (const a of values.amenities) out.push({ key: 'amenities', label: a })
  for (const f of values.features) out.push({ key: 'features', label: f })
  return out
}
