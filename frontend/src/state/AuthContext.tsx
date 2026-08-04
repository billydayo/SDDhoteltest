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

import { api, getToken, setToken } from '../api/client'
import type { LoginInput, Profile, RegisterInput } from '../api/types'

interface AuthState {
  /** `null` = 未登入。`status` 為 `loading` 時尚未判定，MUST NOT 據此導向。 */
  user: Profile | null
  /** `loading` 期間畫面 MUST 顯示載入中，MUST NOT 閃一下登入頁再跳回來。 */
  status: 'loading' | 'authenticated' | 'anonymous'
  login: (input: LoginInput) => Promise<Profile>
  register: (input: RegisterInput) => Promise<Profile>
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
        // token 失效（client.ts 已清掉），或後端沒開。兩者都當成未登入處理：
        // 未登入時整站仍可瀏覽，比卡在載入中好。
        setUser(null)
        setStatus('anonymous')
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

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  const applyProfile = useCallback((profile: Profile) => {
    setUser(profile)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, status, login, register, logout, applyProfile }),
    [user, status, login, register, logout, applyProfile],
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
