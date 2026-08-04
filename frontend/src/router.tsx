/**
 * T040：路由表與角色守衛。
 *
 * ⚠️ **守衛 MUST NOT 被描述為安全機制。**
 *
 * 它只改變畫面呈現：讓不該看到的入口不出現、讓沒登入的人先去登入。
 * 真正的存取邊界在 FastAPI（憲章原則 VI）——移除 RLS 之後那是唯一的一道。
 * 任何人打開開發者工具改掉前端狀態，或直接對 API 送請求，都繞得過這裡；
 * 擋住他的是後端的 `get_current_user` 與 `require_admin`。
 *
 * ## 為什麼要記住原目的地
 *
 * FR-009d：憑證過期後導向登入頁，**登入完成 MUST 回到原本要去的地方**。
 * 少了這一步，使用者從書籤點進一筆訂單、被要求登入、然後被丟回首頁——
 * 他得自己找回剛才那筆訂單。這在 token 過期時每次都會發生。
 */
import { useEffect } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom'

import { setUnauthorizedHandler } from './api/client'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { LoadingState } from './components/LoadingState'
import { Account } from './pages/Account'
import { AuthCallback } from './pages/AuthCallback'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Forbidden, NotFound } from './pages/NotFound'
import { Placeholder } from './pages/Placeholder'
import { Register } from './pages/Register'
import { RoomDetail } from './pages/RoomDetail'
import { Terms } from './pages/Terms'
import { AdminLayout } from './pages/admin/AdminLayout'
import { Dashboard } from './pages/admin/Dashboard'
import { AdminOrders } from './pages/admin/Orders'
import { AdminRooms } from './pages/admin/Rooms'
import { AdminUsers } from './pages/admin/Users'
import { useAuth } from './state/AuthContext'

/**
 * 登入頁用來記住「登入完要回哪裡」與「為什麼被送來這裡」的 location state。
 *
 * `reason` 由 `LoginReasonNotice` 轉成給人看的句子。缺了它，使用者按下
 * 「立即訂房」後畫面直接變成登入表單，看起來像誤觸或網站出錯。
 */
export interface LoginRedirectState {
  from?: Location | { pathname: string }
  reason?: string
}

// ---------------------------------------------------------------------------
// 守衛
// ---------------------------------------------------------------------------
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  // ⚠️ 判定完成前 MUST NOT 導向。直接把 loading 當成未登入，重新整理任何一個
  // 需登入的頁面都會先閃一下登入頁再跳回來——使用者會以為自己被登出了。
  if (status === 'loading') return <LoadingState label="確認登入狀態…" />

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location } satisfies LoginRedirectState} />
  }
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <LoadingState label="確認登入狀態…" />

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location } satisfies LoginRedirectState} />
  }

  // 已登入但不是管理員 → **403 而非導向登入頁**。他已經登入了，
  // 再叫他登入一次只會困惑（與後端的 401／403 之分同一個道理）。
  if (user?.role !== 'admin') return <Forbidden />

  return <>{children}</>
}

// ---------------------------------------------------------------------------
// 版面
// ---------------------------------------------------------------------------
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        跳至主要內容。鍵盤使用者不必逐一 tab 過整排導覽才能進到內容
        （憲章原則 V）。平時以 `sr-only` 隱藏，取得焦點時才顯現。
      */}
      <a
        href="#main"
        className="sr-only rounded-xs bg-brand px-gap-3 py-gap-2 text-ink-invert focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        跳至主要內容
      </a>
      <Header />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-gap-5 py-gap-6">
        {children}
      </main>
      <Footer />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 路由表
// ---------------------------------------------------------------------------
export function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()

  // 把「憑證失效」接到 router 的導覽上。
  //
  // 用 `navigate` 而非 `window.location`：整頁重載會丟掉使用者已填的表單內容，
  // 而 FR-083 明訂失敗時 MUST 保留已填內容。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void navigate('/login', {
        replace: true,
        // 憑證過期與「本來就沒登入」對使用者是不同的事。不說清楚，
        // 他會以為自己被登出了或站壞了（FR-009d）。
        state: { from: location, reason: 'SESSION_EXPIRED' } satisfies LoginRedirectState,
      })
    })
    return () => {
      setUnauthorizedHandler(null)
    }
  }, [navigate, location])

  return (
    <Layout>
      <Routes>
        {/* -- 公開 ------------------------------------------------------- */}
        <Route path="/" element={<Home />} />
        <Route path="/rooms/:roomId" element={<RoomDetail />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/*
          Google 回程的落點。**公開**——抵達這裡的人正是還沒有身分的那個人，
          掛上 RequireAuth 會把他導去登入頁，而他手上的 token 就這樣掉了。
        */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* -- 需登入 ----------------------------------------------------- */}
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route
          path="/booking/:roomId"
          element={
            <RequireAuth>
              <Placeholder title="訂房" task="T089" />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <Placeholder title="我的訂單" task="T094" />
            </RequireAuth>
          }
        />

        {/* -- 僅管理員 ---------------------------------------------------
            十二個模組共用 `AdminLayout` 的側欄與版面（T125）。守衛掛在父路由
            上，子路由因此不必各自重複——**漏掉一個子路由就是一個沒有守衛的
            後台頁面**，而那不會有任何測試失敗。

            ⚠️ 守衛只決定畫面呈現。真正的存取邊界在 FastAPI 的 `require_admin`
            （見本檔開頭）。 */}
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="rooms" element={<AdminRooms />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="users" element={<AdminUsers />} />
          {/* 以下模組分屬 US7–US12，導覽從第一天就完整列出（AdminLayout 的說明） */}
          <Route path="reviews" element={<Placeholder title="評論審核" task="T134" />} />
          <Route path="refunds" element={<Placeholder title="退款審核" task="T135" />} />
          <Route path="messages" element={<Placeholder title="會員訊息" task="T170" />} />
          <Route path="room-risk" element={<Placeholder title="房源品質檢測" task="T148" />} />
          <Route path="content" element={<Placeholder title="內容編輯" task="T142" />} />
          <Route path="channel" element={<Placeholder title="渠道比價與控價" task="T159" />} />
          <Route path="logs" element={<Placeholder title="操作日誌" task="T164" />} />
          <Route path="settings" element={<Placeholder title="系統與參數設定" task="T165" />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
