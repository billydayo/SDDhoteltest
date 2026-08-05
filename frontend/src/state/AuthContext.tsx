/**
 * T075（提前至 Phase 2）：登入狀態。
 *
 * ⚠️ **原訂於 US2 建立，但 T040 的路由守衛沒有它就無法存在**——守衛要判斷
 * 「目前是誰」。與其在 T040 造一個暫時的替身、到 US2 再換掉，不如一次做對。
 *
 * ## 這裡不是安全機制
 *
 * 守衛只改變**畫面呈現**。真正的存取邊界在 FastAPI（憲章原則 VI）——
 * 移除 RLS 之後那是唯一的一道。把角色藏在前端只能讓按鈕不出現，
 * 攔不住任何一個直接打 API 的人。
 *
 * ## token 存 localStorage，業務資料不存
 *
 * 憲章原則 III 允許前者、禁止後者。因此本模組**只快取 `Profile`
 * 於記憶體**，重新整理後一律回頭向 `/me` 取——存本機的副本會與伺服器
 * 不同步，而不同步的症狀是使用者被降權之後畫面上仍有後台入口。
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

import { ApiError, api, getToken, setToken } from '../api/client'
import type { LoginInput, Profile, RegisterInput } from '../api/types'

interface AuthState {
  /** `null` = 未登入。`status` 為 `loading` 時尚未判定，MUST NOT 據此導向。 */
  user: Profile | null
  /**
   * `loading` 期間畫面 MUST 顯示載入中，MUST NOT 閃一下登入頁再跳回來。
   *
   * ⚠️ **`unavailable` 與 `anonymous` MUST 分開**（FR-084、FR-009d）。
   *
   * 兩者在畫面上長得很像（都不能進需登入的頁面），但**告訴使用者的事情完全
   * 相反**：`anonymous` 是「你沒登入」，`unavailable` 是「我們連不到伺服器」。
   * 混為一談的代價是一個 token 還完全有效的人被丟到登入頁，而他會去嘗試自己
   * 明明正確的密碼——然後那次登入也會失敗，因為後端根本沒回應。
   *
   * 2026-08-05 實測到這個情境：正式站部署期間 Caddy 對 `/api/me` 回了四個 502，
   * 稽核腳本裡的管理員工作階段當場被判定為未登入。當時的程式碼把 `/me` 的
   * **所有**失敗都收斂成 `anonymous`，註解還寫著「後端沒開⋯⋯都當成未登入處理」。
   */
  status: 'loading' | 'authenticated' | 'anonymous' | 'unavailable'
  login: (input: LoginInput) => Promise<Profile>
  register: (input: RegisterInput) => Promise<Profile>
  /**
   * 採用一個由後端交付、而非由本頁登入取得的 token（Google 回呼，FR-087）。
   *
   * 與 `login` 分開：那條路徑上前端從未見過帳密，也拿不到 `TokenOut.profile`
   * ——後端是用一次 302 把瀏覽器送回來的。因此這裡 MUST 自己去問一次 `/me`，
   * **MUST NOT 解碼 token 的 payload 來湊出使用者資料**：那份 payload 沒有經過
   * 任何驗證，而且使用者可能在簽發後已被降權。
   */
  adoptToken: (token: string) => Promise<Profile>
  logout: () => void
  /** 帳戶設定存檔後同步頁首的顯示名稱（FR-007）。 */
  applyProfile: (profile: Profile) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [status, setStatus] = useState<AuthState['status']>(() =>
    getToken() ? 'loading' : 'anonymous',
  )

  // 開啟頁面時若手上有 token，先向後端確認它還有效。
  //
  // ⚠️ **不能直接信任 token 裡的內容。** 使用者可能已被降權或刪除，而 token
  // 在到期前都還「看起來有效」。後端每次請求都重查資料庫（deps.py），
  // 這裡做的是同一件事的前端版本：一開始就問清楚現在到底是誰。
  useEffect(() => {
    // 沒有 token 時 `status` 的初始值已經是 `anonymous`（見上方 useState 的
    // 惰性初始化），這裡直接結束。刻意不再 setState 一次——在 effect 內同步
    // 設定狀態會多觸發一輪繪製，而這一輪什麼也沒改變。
    if (!getToken()) return

    const controller = new AbortController()
    api.profile
      .me(controller.signal)
      .then((profile) => {
        setUser(profile)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setUser(null)

        /**
         * ⚠️ **401 才是「你沒登入」；其餘一律是「我們連不到伺服器」。**
         *
         * `client.ts` 當初刻意把 `NetworkError` 與 `ApiError` 分開（見 T038 的
         * 註記：「否則伺服器沒開時使用者會讀到一句莫名的業務錯誤」），而這裡
         * 曾經把那個區分整個丟掉——偏偏這是它最要緊的一處。
         *
         * 只有 401 表示 token 真的不管用了（`client.ts` 也已在該情形清掉它）。
         * 502／503 是後端暫時不在（部署、重啟、資料庫斷線），`NetworkError`
         * 是根本沒連上。這兩種情況下 token **MUST NOT 被清掉**：它多半還是好的，
         * 清掉等於把一次幾秒鐘的伺服器抖動變成一次真正的登出。
         */
        const unauthorized = error instanceof ApiError && error.status === 401
        setStatus(unauthorized ? 'anonymous' : 'unavailable')
      })
    return () => {
      controller.abort()
    }
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.auth.login(input)
    setToken(res.accessToken)
    setUser(res.profile)
    setStatus('authenticated')
    return res.profile
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const res = await api.auth.register(input)
    setToken(res.accessToken)
    setUser(res.profile)
    setStatus('authenticated')
    return res.profile
  }, [])

  const adoptToken = useCallback(async (token: string) => {
    setToken(token)
    try {
      const profile = await api.profile.me()
      setUser(profile)
      setStatus('authenticated')
      return profile
    } catch (error) {
      // token 拿到了卻換不到身分，代表它其實不管用。**MUST 清掉**——
      // 留著它會讓整站表現得像已登入，然後每一次請求各自失敗一次。
      setToken(null)
      setUser(null)
      setStatus('anonymous')
      throw error
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  const applyProfile = useCallback((profile: Profile) => {
    setUser(profile)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, status, login, register, adoptToken, logout, applyProfile }),
    [user, status, login, register, adoptToken, logout, applyProfile],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    // 忘記包 AuthProvider 時，讓錯誤講清楚是哪裡少了。預設回一個「未登入」
    // 反而會讓整站安靜地表現得像沒人登入過，排查時完全看不出來。
    throw new Error('useAuth 必須在 <AuthProvider> 之內使用。')
  }
  return ctx
}

/** 目前使用者是否為管理員。⚠️ 僅用於決定畫面呈現，**不是授權判斷**。 */
export function useIsAdmin(): boolean {
  return useAuth().user?.role === 'admin'
}
