/**
 * T153：我的收藏（FR-092、FR-095）。
 *
 * ## 已下架的房源 MUST 留在清單裡，只是標示出來（FR-095）
 *
 * **MUST NOT 顯示錯誤或空白卡片。** 使用者收藏過的東西突然消失，他會以為是
 * 系統把他的資料弄丟了——而實際上只是那間房暫時不開放。留著卡片並寫上
 * 「目前未開放預訂」，他就知道發生了什麼事，也還記得自己收藏過什麼。
 *
 * 判斷依據是後端給的 `listed`，**不是** `status === 'maintenance'`：後者是
 * 業者視角的營運狀態（「整理中」），對會員沒有意義。語意轉換發生在後端，
 * 前端就不會各自解讀（`schemas/favorite.py`）。
 *
 * 被刪除的房源不需要任何處理——`favorites.room_id` 是 `on delete cascade`，
 * 房源消失時收藏一併消失。
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { FavoriteRoom } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FavoriteButton } from '../components/FavoriteButton'
import { LoadingState } from '../components/LoadingState'
import { useAsync } from '../hooks/useAsync'
import { formatTWD } from '../lib/money'

/** ⚠️ `null` 代表尚無評分，MUST NOT 當成 0 顯示（FR-047）。 */
function ratingText(value: number | string | null): string {
  if (value === null) return '尚無評分'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `★ ${numeric.toFixed(1)}` : '尚無評分'
}

export function Favorites() {
  const load = useCallback((signal: AbortSignal) => api.favorites.list(signal), [])
  const { status, data, error, reload } = useAsync<FavoriteRoom[]>(load)

  /** 剛被取消收藏的房源。先從畫面上拿掉，不必等重新載入。 */
  const [removed, setRemoved] = useState<string[]>([])

  if (status === 'error') return <ErrorState error={error} onRetry={reload} />
  if (data === null) return <LoadingState label="載入收藏…" />

  const rooms = data.filter((room) => !removed.includes(room.id))

  return (
    <div>
      <h1 className="font-display text-h1 text-ink">我的收藏</h1>

      {rooms.length === 0 ? (
        // 引導性空狀態：說出下一步在哪裡，而不是只說「沒有資料」（FR-095）。
        <EmptyState
          title="還沒有收藏任何房源"
          hint="在房源列表或詳情頁按下愛心，就會出現在這裡。"
          action={
            <Link
              to="/"
              className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
            >
              去看看房源
            </Link>
          }
        />
      ) : (
        <ul className="mt-gap-5 grid gap-gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <li
              key={room.id}
              className="overflow-hidden rounded-lg border border-line-soft bg-surface shadow-soft"
            >
              <div className="relative">
                <img
                  src={room.images[0] ?? '/logo-mark.png'}
                  alt={`${room.name}的照片`}
                  className="arch aspect-4/3 w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute top-gap-2 right-gap-2">
                  <FavoriteButton
                    roomId={room.id}
                    favorited
                    variant="icon"
                    onChange={(favorited) => {
                      if (!favorited) setRemoved((prev) => [...prev, room.id])
                    }}
                  />
                </span>
              </div>

              <div className="p-gap-4">
                <h2 className="font-display text-md text-ink">{room.name}</h2>
                <p className="mt-gap-1 text-small text-ink-muted">
                  {room.type}．可住 {room.maxGuests} 人．{ratingText(room.averageRating)}
                </p>
                <p className="mt-gap-2 text-body text-ink">
                  {formatTWD(room.nightlyPrice)}
                  <span className="text-tiny text-ink-muted"> / 晚</span>
                </p>

                {/* ⚠️ FR-095：已下架 MUST 標示，且 MUST NOT 提供訂房入口。 */}
                {room.listed ? (
                  <Link
                    to={`/rooms/${room.id}`}
                    className="mt-gap-3 inline-block rounded-pill bg-brand px-gap-4 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
                  >
                    查看詳情
                  </Link>
                ) : (
                  <p className="mt-gap-3 rounded-base border border-line-strong bg-surface-alt px-gap-3 py-gap-2 text-small text-ink-muted">
                    此房源目前未開放預訂。您的收藏仍會保留，開放後即可再次預訂。
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
