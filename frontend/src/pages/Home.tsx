/**
 * T056：首頁——滿版主視覺、房型頁籤、排序切換、房源列表（FR-010、FR-012、FR-018）。
 *
 * ## 三條容易寫錯的規則
 *
 * 1. **首次載入 MUST 顯示全部房源。** 訪客不必填任何條件就能瀏覽（US1 的整個
 *    前提）。因此初始查詢不帶任何參數，也不做條件檢查。
 *
 * 2. **房型頁籤切換 MUST NOT 清除其他篩選條件**（FR-012）。使用者好不容易勾完
 *    設施、切一下房型就全沒了——他不會再勾第二次，只會離開。頁籤與排序是
 *    **獨立於表單的即時條件**，切換就直接查；`filters` 那份狀態完全不動。
 *
 * 3. **條件檢查只在按下「搜尋」時執行。** 因此頁籤與排序切換用的是**上一次
 *    成功送出**的條件（`applied`），而不是使用者正在編輯中的 `filters`——
 *    否則切個排序就會把他填到一半的日期送出去而被拒絕。
 */
import { useCallback, useMemo, useState } from 'react'

import { ApiError, api } from '../api/client'
import type { RoomSearchParams, RoomSort, SiteContent } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FilterBar } from '../components/FilterBar'
import { HomeHero } from '../components/HomeHero'
import { LoadingState, SkeletonCard } from '../components/LoadingState'
import { RoomCard } from '../components/RoomCard'
import { EMPTY_FILTERS, toSearchParams, type FilterValues } from '../lib/filters'
import { useAsync } from '../lib/useAsync'
import { primaryButtonClass } from '../lib/surfaces'

const SORT_OPTIONS: { value: RoomSort | ''; label: string }[] = [
  { value: '', label: '預設' },
  { value: 'price_asc', label: '價格低到高' },
  { value: 'price_desc', label: '價格高到低' },
  { value: 'rating_desc', label: '評分高到低' },
  { value: 'rating_asc', label: '評分低到高' },
]

const ALL_TYPES = '__all__'

export function Home() {
  /** 使用者正在編輯的表單值。改動它**不會**觸發查詢。 */
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS)
  /** 上一次成功送出的條件。查詢只看這個。初始為空 → 顯示全部房源。 */
  const [applied, setApplied] = useState<RoomSearchParams>({})
  const [roomType, setRoomType] = useState<string>(ALL_TYPES)
  const [sort, setSort] = useState<RoomSort | ''>('')

  const content = useAsync((signal) => api.siteContent.get(signal), [])
  const vocabulary = useAsync((signal) => api.vocabulary.get(signal), [])

  /**
   * 主視覺內容。尚未載入時用預設值，**不留白也不顯示載入骨架**——主視覺是
   * 首屏最大的一塊，骨架閃一下比直接顯示預設標題更像壞掉。
   *
   * ⚠️ 這裡組出完整的 `SiteContent` 而非傳三個欄位，是為了讓首頁與後台預覽
   * （`pages/admin/Content.tsx`）吃同一個元件與同一份型別。兩邊各做一個「長得
   * 差不多」的主視覺，遲早會不一樣，而發現的方式是管理員存檔後回到前台發現不對。
   */
  const heroContent = useMemo<SiteContent>(
    () => ({
      heroTitle: content.data?.heroTitle ?? 'Sunny 訂房平台',
      heroSubtitle: content.data?.heroSubtitle ?? '舒適住宿，安心入住',
      heroImage: content.data?.heroImage ?? '',
      updatedAt: content.data?.updatedAt ?? '',
    }),
    [content.data],
  )

  const query = useMemo<RoomSearchParams>(
    () => ({
      ...applied,
      ...(roomType === ALL_TYPES ? {} : { type: roomType }),
      ...(sort === '' ? {} : { sort }),
    }),
    [applied, roomType, sort],
  )

  const rooms = useAsync(
    (signal) => api.rooms.list(query, signal),
    // 序列化後比較，避免每次繪製產生的新物件觸發重查
    [JSON.stringify(query)],
  )

  /**
   * ⚠️ **同一個錯誤 MUST NOT 同時出現在篩選列與結果區。**
   *
   * 兩處都印，使用者會看到同一句話出現兩次，並且以為是兩個不同的問題。
   * 依「這個錯誤是不是他填的東西造成的」分流：
   *
   * - 400 → 條件有問題 → 交給篩選列逐欄指出，結果區**保留上一次的房源**
   *   （`useAsync` 出錯時不清空 `data`）。把畫面清成一片錯誤，等於因為
   *   日期少填一欄就把他剛才看到的房源全收走。
   * - 其餘（連不上、500、401）→ 不是他能修的 → 結果區顯示可重試的錯誤畫面。
   */
  const isFormError = rooms.error instanceof ApiError && rooms.error.status === 400

  const handleSearch = useCallback(() => {
    setApplied(toSearchParams(filters))
  }, [filters])

  const handleClear = useCallback(() => {
    setFilters(EMPTY_FILTERS)
    setApplied({})
    // 房型與排序也一併回到預設——使用者按的是「清除全部條件」
    setRoomType(ALL_TYPES)
    setSort('')
  }, [])

  // 房型頁籤的選項由目前結果推導，而非寫死。管理員新增房型後不必改前端。
  // ⚠️ 用 `rooms.data` 推導會讓頁籤隨篩選結果消失——因此另外查一次不帶篩選的
  // 全部房源作為頁籤來源。
  const allRooms = useAsync((signal) => api.rooms.list({}, signal), [])
  const types = useMemo(() => {
    const set = new Set((allRooms.data ?? []).map((r) => r.type))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [allRooms.data])

  return (
    <div className="flex flex-col gap-gap-6">
      <HomeHero content={heroContent} />

      <FilterBar
        values={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        onClear={handleClear}
        amenityOptions={vocabulary.data?.amenities ?? []}
        featureOptions={vocabulary.data?.features ?? []}
        error={isFormError ? rooms.error : null}
      />

      <div className="flex flex-wrap items-center justify-between gap-gap-3">
        {/* 房型頁籤。⚠️ 切換 MUST NOT 清除其他條件（FR-012）——這裡只改 roomType */}
        <div role="tablist" aria-label="房型" className="flex flex-wrap gap-gap-2">
          <TypeTab
            label="全部"
            active={roomType === ALL_TYPES}
            onClick={() => {
              setRoomType(ALL_TYPES)
            }}
          />
          {types.map((t) => (
            <TypeTab
              key={t}
              label={t}
              active={roomType === t}
              onClick={() => {
                setRoomType(t)
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-gap-2">
          <label htmlFor="sort" className="text-small text-ink-muted">
            排序
          </label>
          <select
            id="sort"
            name="sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as RoomSort | '')
            }}
            className="rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-1 text-small text-ink"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <RoomResults
        rooms={rooms.data}
        loading={rooms.loading}
        error={isFormError ? null : rooms.error}
        onRetry={rooms.reload}
        onClear={handleClear}
        hasConditions={Object.keys(query).length > 0}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
function TypeTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-pill border px-gap-4 py-gap-1 text-small transition-colors',
        active
          ? 'border-brand bg-brand text-ink-invert'
          : 'border-line-strong text-ink-muted hover:border-brand hover:text-brand-strong',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

/**
 * T060：結果區。
 *
 * ⚠️ **FR-018：無結果 MUST 顯示訊息與調整建議，而非空白畫面。**
 * 建議的內容依「有沒有下條件」而不同——沒下條件卻沒結果是資料問題，
 * 叫使用者「放寬條件」毫無幫助。
 */
function RoomResults({
  rooms,
  loading,
  error,
  onRetry,
  onClear,
  hasConditions,
}: {
  rooms: readonly import('../api/types').Room[] | null
  loading: boolean
  error: unknown
  onRetry: () => void
  onClear: () => void
  hasConditions: boolean
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />

  if (loading && !rooms) {
    return (
      <>
        <LoadingState label="載入房源…" />
        <div className="grid gap-gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </>
    )
  }

  if (rooms?.length === 0) {
    return hasConditions ? (
      <EmptyState
        title="查無符合條件的房源"
        hint="試著放寬價格上限、減少勾選的設施，或改選其他日期。"
        action={
          <button
            type="button"
            onClick={onClear}
            className={primaryButtonClass}
          >
            清除全部條件
          </button>
        }
      />
    ) : (
      <EmptyState title="目前尚無房源" hint="房源上架後會顯示在這裡。" />
    )
  }

  return (
    <>
      {/* 結果筆數對讀屏使用者特別重要——他們看不到卡片有幾張 */}
      <p aria-live="polite" className="text-small text-ink-muted">
        共 {rooms?.length ?? 0} 間房源
      </p>
      <div className="grid gap-gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {rooms?.map((room) => <RoomCard key={room.id} room={room} />)}
      </div>
    </>
  )
}
