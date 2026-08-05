/**
 * T074：註冊頁（FR-001、FR-002、FR-009b、FR-083）。
 *
 * ## ⚠️ 失敗時 MUST 保留其他已填欄位（FR-083）
 *
 * 這是本頁最重要的一條，也是最容易在「順手清理一下」時弄壞的一條。
 *
 * 註冊表單有四格。若 email 撞號就把整張表清空，使用者得重打顯示名稱與兩次
 * 密碼——而他唯一要改的只有 email。清空不會報錯、不會有任何測試自然失敗，
 * 它只是讓人放棄註冊。
 *
 * 因此：**catch 區塊裡只有 `setError`。** 沒有任何 `setX('')`。
 *
 * ## 密碼確認由前端負責，長度下限由後端負責
 *
 * 「兩次密碼不一致」後端根本收不到（它只收一個 password），所以必須在這裡擋。
 * 而 6 字元下限**不在前端重寫一份**：規則寫兩次就會有兩份，而兩份一定會在
 * 某次修改後不一致。前端只把後端的訊息顯示出來，並靠 `field` 把焦點移過去。
 */
import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import { Field } from '../components/Field'
import { GoogleButton } from '../components/GoogleButton'
import { PasswordWarning } from '../components/PasswordWarning'
import { messageFor } from '../lib/errors'
import { inputClass, useFieldFocus } from '../lib/form'
import { pendingFavoriteOf, redirectTargetOf } from '../lib/redirect'
import type { LoginRedirectState } from '../router'
import { useAuth } from '../state/AuthContext'
import { primaryButtonClass } from '../lib/surfaces'

/** 兩次密碼不一致——這一項後端收不到，只能在前端擋。 */
const PASSWORD_MISMATCH = new ApiError(400, {
  detail: '兩次輸入的密碼不相同。',
  code: 'PASSWORD_MISMATCH',
  field: 'passwordConfirm',
})

export function Register() {
  const { user, status, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const formRef = useRef<HTMLFormElement>(null)

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const badField = useFieldFocus(formRef, error)
  const back = redirectTargetOf(location.state)
  // FR-093：把「還沒做完的收藏」原樣轉交給目的地。少了它，使用者回到那間房
  // 之後會發現它並沒有被收藏——而他確實按過了。
  const pendingFavorite = pendingFavoriteOf(location.state)
  const forward = pendingFavorite === null ? undefined : { pendingFavoriteRoomId: pendingFavorite }

  async function handleSubmit() {
    setError(null)

    if (password !== passwordConfirm) {
      setError(PASSWORD_MISMATCH)
      return
    }

    setBusy(true)
    try {
      await register({ email, password, displayName })
      await navigate(back, { replace: true, state: forward })
    } catch (cause) {
      // ⚠️ **這裡只設錯誤，什麼都不清**（FR-083）。email 撞號時使用者要改的
      // 只有 email，把顯示名稱與兩次密碼一併清掉會讓他直接放棄。
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'authenticated' && user) return <Navigate to={back} replace state={forward} />

  const message = error ? messageFor(error) : null
  const fieldError = (name: string) => (badField === name ? (message?.detail ?? null) : null)

  return (
    <div className="mx-auto grid max-w-5xl gap-gap-6 py-gap-6 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-h1 text-ink">註冊</h1>
        <p className="mt-gap-2 text-small text-ink-muted">
          已經有帳號了？
          <Link
            to="/login"
            state={location.state as LoginRedirectState | null}
            className="ml-gap-1 text-brand-strong underline underline-offset-4"
          >
            直接登入
          </Link>
        </p>

        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
          className="mt-gap-5 grid gap-gap-4"
        >
          <Field label="電子郵件" htmlFor="register-email" error={fieldError('email')}>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={badField === 'email'}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field label="顯示名稱" htmlFor="register-displayName" error={fieldError('displayName')}>
            <input
              id="register-displayName"
              name="displayName"
              type="text"
              autoComplete="nickname"
              required
              maxLength={100}
              aria-invalid={badField === 'displayName'}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field
            label="密碼"
            htmlFor="register-password"
            error={fieldError('password')}
            // 下限只在這裡以說明呈現；**判定由後端做**，規則不重寫第二份
            hint="至少 6 個字元。請勿使用你在其他網站的真實密碼。"
          >
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={badField === 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field
            label="再次輸入密碼"
            htmlFor="register-passwordConfirm"
            error={fieldError('passwordConfirm')}
          >
            <input
              id="register-passwordConfirm"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={badField === 'passwordConfirm'}
              value={passwordConfirm}
              onChange={(e) => {
                setPasswordConfirm(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          {/* 對不上任何欄位的錯誤（連線失敗、500）也 MUST 說出來 */}
          {message && !badField && (
            <p
              role="alert"
              className="rounded-xs bg-danger-soft px-gap-3 py-gap-2 text-small text-danger"
            >
              {message.detail}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? '註冊中…' : '建立帳號'}
          </button>
        </form>

        <div className="mt-gap-5 flex items-center gap-gap-3">
          <span className="h-px flex-1 bg-line-soft" />
          <span className="text-small text-ink-muted">或</span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>

        <div className="mt-gap-4">
          <GoogleButton />
        </div>
      </section>

      <aside className="grid h-fit gap-gap-4">
        <PasswordWarning />
        <p className="text-small text-ink-muted">
          註冊即表示你已閱讀
          <Link to="/terms" className="mx-gap-1 text-brand-strong underline underline-offset-4">
            服務條款與隱私聲明
          </Link>
          。本站不會要求、接收或儲存任何真實的支付資料。
        </p>
      </aside>
    </div>
  )
}
