/**
 * T041：頁首。
 *
 * 語意化 `header` + `nav`（憲章原則 V）。導覽連結用 `NavLink` 而非
 * `div` + `onClick`——後者對鍵盤與讀屏使用者等同於不存在，而這是全站的
 * 主要導覽（T171 的稽核項目）。
 *
 * ⚠️ 後台入口只在管理員登入時顯示，但**這只是畫面呈現**。
 * 真正的存取邊界在 FastAPI（憲章原則 VI）。
 */
import { NavLink, useNavigate } from 'react-router-dom'

import { useAuth } from '../state/AuthContext'
import { primaryButtonClass } from '../lib/surfaces'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-xs px-gap-2 py-gap-1 text-small transition-colors',
    isActive ? 'text-brand-strong underline underline-offset-4' : 'text-ink-muted hover:text-ink',
  ].join(' ')

export function Header() {
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    void navigate('/')
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line-soft bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-gap-4 px-gap-5 py-gap-3">
        <NavLink to="/" className="flex items-center gap-gap-2" aria-label="Sunny 訂房平台首頁">
          <img src="/logo-mark.png" alt="" aria-hidden="true" className="size-8" />
          <span className="font-display text-md text-ink">Sunny</span>
        </NavLink>

        <nav aria-label="主要導覽" className="flex flex-1 flex-wrap items-center gap-gap-1">
          <NavLink to="/" className={linkClass} end>
            房源
          </NavLink>
          {/* T146：照片安全檢測。公開——照片全程留在瀏覽器內，不需要登入。 */}
          <NavLink to="/risk-check" className={linkClass}>
            安全檢測
          </NavLink>
          {user && (
            <NavLink to="/orders" className={linkClass}>
              我的訂單
            </NavLink>
          )}
          {/* T153：我的收藏。收藏綁定身分，未登入時沒有東西可看。 */}
          {user && (
            <NavLink to="/favorites" className={linkClass}>
              我的收藏
            </NavLink>
          )}
          {/* T169：客服訊息的入口。⚠️ 只在登入後出現——未登入的人沒有討論串，
              給他一個點了會被導去登入的連結只是多一次挫折。 */}
          {user && (
            <NavLink to="/messages" className={linkClass}>
              聯絡客服
            </NavLink>
          )}
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={linkClass}>
              後台
            </NavLink>
          )}
        </nav>

        {/* 判定完成前不顯示登入／登出——先顯示「登入」再跳成使用者名稱，
            會讓已登入的人以為自己被登出了 */}
        {status === 'loading' ? null : user ? (
          <div className="flex items-center gap-gap-3">
            <NavLink to="/account" className={linkClass}>
              {user.displayName || user.email}
            </NavLink>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-pill border border-line-strong px-gap-3 py-gap-1 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
            >
              登出
            </button>
          </div>
        ) : (
          <NavLink
            to="/login"
            className={primaryButtonClass}
          >
            登入
          </NavLink>
        )}
      </div>
    </header>
  )
}
