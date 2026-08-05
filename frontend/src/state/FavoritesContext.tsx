/**
 * 收藏狀態（FR-091、FR-092、FR-094）。
 *
 * ## 為什麼要有這一層
 *
 * 「這間房我收藏了嗎」是**列表上每一張卡片**都要回答的問題。讓每張卡片各自去問
 * 一次後端，20 張卡就是 20 個請求；讓首頁把清單當 prop 傳下去，則要穿過格線、
 * 卡片、圖片三層，而收藏清單頁與詳情頁又各自需要同一份資料。
 *
 * 收在 Context 裡：**整個工作階段只取一次**，任何地方問都是同一個答案。
 * 憲章的狀態管理條文明訂先用內建機制，Context 正是其中之一。
 *
 * ## 只存 id，不存房源
 *
 * 這裡刻意只保留 `Set<roomId>`，不快取房源本身。房價與房態會變，而收藏清單頁
 * 需要的是**當下**的資料——存一份房源副本在這裡，就是憲章原則 III 禁止的
 * 「與伺服器不同步的本機業務資料」。
 *
 * ## 未登入時不發請求
 *
 * 收藏綁定身分，未登入時 `/favorites` 只會回 401。發出去除了在 console 留一筆
 * 紅字之外沒有任何作用——而那筆紅字會讓 T181 的走查誤判。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api } from '../api/client'
import { useAuth } from './AuthContext'

interface FavoritesState {
  /** 這間房目前是否已收藏。尚未載入完成時一律回 `false`。 */
  isFavorited: (roomId: string) => boolean
  /**
   * 就地更新一筆。**由 `FavoriteButton` 在樂觀更新與退回時各呼叫一次**，
   * 因此這裡 MUST NOT 自己發請求——否則按一下會送出兩次。
   */
  setFavorited: (roomId: string, favorited: boolean) => void
  /** 清單是否已取回。用來避免載入完成前把星號畫成「未收藏」再跳成「已收藏」。 */
  ready: boolean
}

const FavoritesContext = createContext<FavoritesState | null>(null)

/**
 * 收藏清單連同**它屬於誰**一起存。
 *
 * ⚠️ 只存 `Set` 的話，登出再以另一個帳號登入時會有一段空窗：新的清單還沒回來，
 * 畫面上卻是上一個人的收藏。那段時間很短，但它顯示的是**別人的資料**。
 * 綁上 `userId` 之後，「這份快照不是這個人的」與「還沒載入」在型別上同一件事，
 * 不必額外記得清空。
 */
interface Snapshot {
  userId: string
  ids: Set<string>
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  const userId = user?.id ?? null
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    // `loading` 時還不知道是誰。`unavailable` 時後端不在，問了也是白問——
    // 兩者都維持「尚未載入」，星號畫成未收藏，而那是誠實的：
    // 我們現在確實不知道他收藏了什麼。
    if (status !== 'authenticated' || userId === null) return

    const controller = new AbortController()
    api.favorites
      .list(controller.signal)
      .then((rooms) => {
        setSnapshot({ userId, ids: new Set(rooms.map((room) => room.id)) })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // 取不到清單不該讓房源列表整頁失敗——那是主要內容，收藏只是點綴。
        // 記一份空的：星號維持未收藏，使用者按下去仍然送得出去（後端冪等）。
        setSnapshot({ userId, ids: new Set() })
      })
    return () => {
      controller.abort()
    }
  }, [status, userId])

  /** 只有「確定屬於現在這個人」的快照才算數。 */
  const ids = snapshot !== null && snapshot.userId === userId ? snapshot.ids : null

  const isFavorited = useCallback((roomId: string) => ids?.has(roomId) ?? false, [ids])

  const setFavorited = useCallback(
    (roomId: string, favorited: boolean) => {
      if (userId === null) return
      setSnapshot((prev) => {
        const base = prev !== null && prev.userId === userId ? prev.ids : new Set<string>()
        // 沒有變化時回原本那筆，避免多一輪不必要的重繪
        if (prev !== null && prev.userId === userId && base.has(roomId) === favorited) return prev
        const next = new Set(base)
        if (favorited) next.add(roomId)
        else next.delete(roomId)
        return { userId, ids: next }
      })
    },
    [userId],
  )

  const ready = status === 'anonymous' || ids !== null

  const value = useMemo<FavoritesState>(
    () => ({ isFavorited, setFavorited, ready }),
    [isFavorited, setFavorited, ready],
  )

  return <FavoritesContext value={value}>{children}</FavoritesContext>
}

/**
 * ⚠️ 沒有 Provider 時回一個**惰性的預設值**，而不是拋例外。
 *
 * 與 `useAuth` 的處理刻意不同：登入狀態拿不到就整站行為錯亂，那必須大聲失敗；
 * 收藏拿不到只是星號畫不出來。既有的元件測試多半不會包這個 Provider，
 * 為了一個點綴功能讓它們全部變紅，只會換來大家在測試裡到處補 Provider。
 */
const FALLBACK: FavoritesState = {
  isFavorited: () => false,
  setFavorited: () => undefined,
  ready: false,
}

export function useFavorites(): FavoritesState {
  return useContext(FavoritesContext) ?? FALLBACK
}
