/**
 * T152：收藏按鈕（FR-092、FR-093、FR-094）。
 *
 * ## 未登入時登入完 MUST 回到原本的房源並完成收藏（FR-093）
 *
 * 這是本元件唯一難的地方。單純導向登入頁的話，使用者登入後會落在首頁，
 * 而他剛才想收藏的那間房要自己再找一次——多數人不會找，那次收藏就沒了。
 *
 * 因此導向時帶上兩件事：
 *
 * - `from`：要回到哪裡（`router.tsx` 的 `LoginRedirectState`，登入後照著回去）
 * - `pendingFavoriteRoomId`：回來之後**還有一個動作沒做完**
 *
 * 房源詳情頁在掛載時看到後者就自動補上收藏。做成「回到頁面但沒收藏」的話，
 * 使用者會以為自己已經收藏了——因為他確實按過了。
 *
 * ## 樂觀更新，失敗時退回
 *
 * 按下去要立刻變成已收藏，不能等一趟往返。但失敗時 MUST 退回原狀並說明，
 * **MUST NOT 留著一個假的已收藏狀態**（FR-084 禁止靜默失敗）——那會讓使用者
 * 在收藏清單裡找不到他明明收藏過的房間。
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import { messageFor } from '../lib/errors'
import { useAuth } from '../state/AuthContext'

/** 登入後要補做的收藏。放在 router 的 location state 裡，不進 localStorage。 */
export interface PendingFavoriteState {
  pendingFavoriteRoomId?: string
}

interface FavoriteButtonProps {
  roomId: string
  /** 目前是否已收藏。由呼叫端從收藏清單推導。 */
  favorited: boolean
  /** 狀態改變後通知呼叫端，讓清單或計數跟著更新。 */
  onChange: (favorited: boolean) => void
  /** 卡片上用圖示、詳情頁用完整按鈕。 */
  variant?: 'icon' | 'full'
}

export function FavoriteButton({
  roomId,
  favorited,
  onChange,
  variant = 'full',
}: FavoriteButtonProps) {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (status === 'loading') return

    if (status === 'anonymous') {
      // ⚠️ 不是單純的 `/login`。帶著「回哪裡」與「回來要做什麼」（FR-093）。
      void navigate('/login', {
        state: {
          from: location,
          pendingFavoriteRoomId: roomId,
        } satisfies PendingFavoriteState & { from: typeof location },
      })
      return
    }

    const next = !favorited
    setBusy(true)
    setError(null)
    onChange(next) // 樂觀更新
    try {
      if (next) await api.favorites.add(roomId)
      else await api.favorites.remove(roomId)
    } catch (cause) {
      onChange(!next) // 退回
      setError(messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  const label = favorited ? '取消收藏' : '收藏此房源'

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void toggle()
        }}
        // `aria-pressed` 讓讀屏使用者知道這是一個有開關狀態的按鈕，
        // 而不是每次都在做同一件事（憲章原則 V）。
        aria-pressed={favorited}
        aria-label={label}
        title={label}
        className={
          variant === 'icon'
            ? 'rounded-pill border border-line-strong bg-surface/90 px-gap-2 py-gap-1 text-small transition-colors hover:border-brand disabled:opacity-50'
            : `rounded-pill border px-gap-4 py-gap-2 text-small transition-colors disabled:opacity-50 ${
                favorited
                  ? 'border-brand bg-brand-soft text-brand-strong'
                  : 'border-line-strong text-ink-muted hover:border-brand hover:text-brand-strong'
              }`
        }
      >
        <span aria-hidden="true">{favorited ? '♥' : '♡'}</span>
        {variant === 'full' && <span className="ml-gap-2">{favorited ? '已收藏' : '收藏'}</span>}
      </button>
      {error !== null && (
        <span role="status" className="mt-gap-1 text-tiny text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
