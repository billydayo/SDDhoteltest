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
import { Booking } from './pages/Booking'
import { Favorites } from './pages/Favorites'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Messages } from './pages/Messages'
import { Forbidden, NotFound } from './pages/NotFound'
import { OrderConfirm } from './pages/OrderConfirm'
import { Placeholder } from './pages/Placeholder'
import { Register } from './pages/Register'
import { RiskCheck } from './pages/RiskCheck'
import { RoomDetail } from './pages/RoomDetail'
import { Terms } from './pages/Terms'
import { AdminLayout } from './pages/admin/AdminLayout'
import { ADMIN_MODULES } from './pages/admin/modules'
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
        {/* T146：照片安全檢測。**公開**——照片全程留在瀏覽器內，沒有任何
            資料會被送到後端，因此不需要身分（FR-062、FR-066、SC-030）。 */}
        <Route path="/risk-check" element={<RiskCheck />} />
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
              <Booking />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <Placeholder title="我的訂單" task="T101" />
            </RequireAuth>
          }
        />
        {/*
          訂單確認頁（FR-031）。獨立於日後的 `/orders/:orderId`（T102）之外，
          因為兩者的資料來源不同：這一頁的內容由 `Booking` 以 location state
          交過來，而訂單詳情頁會自己去查 `GET /orders/{id}`（T098）。
        */}
        <Route
          path="/orders/:orderId/confirmed"
          element={
            <RequireAuth>
              <OrderConfirm />
            </RequireAuth>
          }
        />
        {/* T153：我的收藏。⚠️ 網址上沒有 `userId`——收藏的擁有者由 token 判定，
            「看別人的收藏」在介面上不可表達（`routers/favorites.py`）。 */}
        <Route
          path="/favorites"
          element={
            <RequireAuth>
              <Favorites />
            </RequireAuth>
          }
        />
        {/* T169：會員的客服訊息。⚠️ 網址上沒有討論串 id——每位會員只有一串，
            由 token 決定是哪一串（`routers/messages.py`）。 */}
        <Route
          path="/messages"
          element={
            <RequireAuth>
              <Messages />
            </RequireAuth>
          }
        />

        {/* -- 僅管理員 ---------------------------------------------------
            T125：十二個模組掛在同一個 `AdminLayout` 之下，路由由
            `pages/admin/modules.tsx` 的同一份陣列展開——導覽與路由因而
            不可能分歧（見該檔說明）。

            ⚠️ 守衛包在外層一次，而非逐個模組包一次。逐個包的問題是新增模組時
            會忘記包，而忘記的那一個不會有任何測試失敗。

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
          {ADMIN_MODULES.map((module) =>
            module.path === '' ? (
              <Route key="index" index element={module.element} />
            ) : (
              <Route key={module.path} path={module.path} element={module.element} />
            ),
          )}
          {/* 後台底下打錯的網址仍留在後台，導覽還在手邊。 */}
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
