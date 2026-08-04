/**
 * T054：房源卡片。直向拱形卡片（FR-013）。
 *
 * ⚠️ **拱形 MUST 以 `border-radius` 雙值語法實作**——水平半徑遠大於垂直半徑，
 * 才會是「拱」而不是單純的圓角。實作在 `styles/index.css` 的 `@utility arch`，
 * 因為 Tailwind 的 `rounded-*` 只吐得出單一半徑。
 *
 * ## 整張卡片可點，但只有一個連結
 *
 * 用一個 `<a>` 包住標題、再以 `after:absolute inset-0` 把可點區域撐滿整張卡。
 * 常見的替代作法是在外層 `div` 掛 `onClick`——那對鍵盤與讀屏使用者等同於
 * 不存在，而房源卡片是整個前台最主要的導覽元素（憲章原則 V、T171）。
 *
 * 也不要在卡片裡放兩個指向同一處的連結（圖片一個、標題一個）：讀屏使用者
 * 會聽到同一間房被念兩次。
 */
import { Link } from 'react-router-dom'

import type { Room } from '../api/types'
import { formatTWD } from '../lib/money'
import { Rating } from './Rating'
import { panelClass } from '../lib/surfaces'

export function RoomCard({ room }: { room: Room }) {
  const cover = room.images[0]

  return (
    <article className={`group relative flex flex-col overflow-hidden ${panelClass} transition-shadow hover:shadow-card`}>
      <div className="arch overflow-hidden bg-surface-alt">
        {cover ? (
          <img
            src={cover}
            // 房名已是有意義的描述。這裡刻意不寫「房源照片」之類的空話——
            // 讀屏使用者聽到的會是「家庭六人房 302 房源照片，連結，家庭六人房 302」。
            alt={room.name}
            loading="lazy"
            className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          // 沒有照片是合法狀態。給一個明確的替代區塊，而不是破圖或空白。
          <div className="flex h-56 w-full items-center justify-center text-small text-ink-muted">
            尚無照片
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-gap-2 p-gap-4">
        <div className="flex items-start justify-between gap-gap-3">
          <h3 className="font-display text-md text-ink">
            <Link to={`/rooms/${room.id}`} className="after:absolute after:inset-0">
              {room.name}
            </Link>
          </h3>
          <Rating value={room.averageRating} className="shrink-0" />
        </div>

        <p className="text-small text-ink-muted">
          {room.type} · 最多 {room.maxGuests} 人
        </p>

        {room.status === 'maintenance' && (
          // FR-016：整理中與已預訂等同排除於可訂結果之外，但**理由不同**。
          // 換日期訂得到已預訂的房，換日期訂不到整理中的房。
          <p className="text-small text-warn">整理中，暫時無法預訂</p>
        )}

        <p className="mt-auto pt-gap-2 text-ink">
          <span className="font-display text-h3">{formatTWD(room.nightlyPrice)}</span>
          <span className="text-small text-ink-muted"> / 晚</span>
        </p>
      </div>
    </article>
  )
}
