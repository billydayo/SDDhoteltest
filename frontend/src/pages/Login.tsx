/**
 * T073：登入頁（FR-003、FR-004、FR-005、FR-006、FR-087、FR-090）。
 *
 * ## 為什麼把測試帳密印在畫面上
 *
 * FR-005 要求公開列出 `guest@sunny.com` / `guest123` 與 `admin@sunny.com` /
 * `admin123`。這在真實產品裡是嚴重缺失，在這裡是**刻意的**：沒有帳號就看不到
 * 這個站的一半功能，而審閱者不會為了看一眼後台去註冊。
 *
 * ⚠️ 但這不構成 FR-009a 的例外——**那兩組密碼在資料庫裡一樣是 argon2id 雜湊**。
 * 「公開展示的密碼」與「明文保存的密碼」是兩件不同的事。
 *
 * ## MUST NOT 洩漏帳號是否存在（FR-004）
 *
 * 後端對「查無此帳號」與「密碼錯誤」回同一句話、同一個狀態碼，並刻意補一次
 * 虛設雜湊讓兩者耗時相當。前端要做的是**不要把它拆回去**：
 *
 * - MUST NOT 預先檢查 email 是否已註冊
 * - MUST NOT 對兩種失敗給不同措辭
 * - MUST NOT 把錯誤標到 email 或密碼任一欄——標到哪一欄就等於告訴對方
 *   另一欄是對的
 *
 * 這幾條都是「不做某件事」，因此不會有任何東西提醒你漏了；只有測試擋得住。
 */
import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { Field } from '../components/Field'
import { GoogleButton } from '../components/GoogleButton'
import { LoginReasonNotice } from '../components/LoginReasonNotice'
import { PasswordWarning } from '../components/PasswordWarning'
import { messageFor } from '../lib/errors'
import { inputClass } from '../lib/form'
import { redirectTargetOf } from '../lib/redirect'
import type { LoginRedirectState } from '../router'
import { useAuth } from '../state/AuthContext'
import { insetClass, primaryButtonClass } from '../lib/surfaces'

/** FR-005：公開列出的測試帳號。**與 `backend/src/sunny/seed.py` 一致。** */
const DEMO_ACCOUNTS = [
  { email: 'guest@sunny.com', password: 'guest123', role: '會員' },
  { email: 'admin@sunny.com', password: 'admin123', role: '管理員' },
] as const

type DemoAccount = (typeof DEMO_ACCOUNTS)[number]

/**
 * 正式部署時是否隱藏管理員那張示範卡片（預設**否**，維持 FR-005 的行為）。
 *
 * ## 這個開關存在的理由
 *
 * FR-005 要求公開列出兩組帳密，那在本機與內部展示是合理的。但站台一旦放上
 * 公網，這張卡片等於把十二個後台模組的鑰匙印在首頁上——任何人都能改房價、
 * 讀客服訊息、看用戶清單。而本專案**沒有修改密碼的端點**，
 * 所以「先上線再去改密碼」這條路不存在。
 *
 * ⚠️ **這個旗標 MUST 與後端的 `SEED_ADMIN_PASSWORD` 一起設定，只設一邊沒有意義：**
 *
 * - 只隱藏卡片、不改密碼 → 密碼仍是版控與 README 裡的 `admin123`，
 *   隱藏的只是提示，不是入口。這是偽裝成安全措施的裝飾。
 * - 只改密碼、不隱藏卡片 → 卡片上印著一組**已經不能用**的密碼，
 *   點「使用此帳號」會登入失敗，看起來像網站壞了。
 *
 * 見 docs/deploy.md。
 */
const HIDE_ADMIN_DEMO = import.meta.env.VITE_HIDE_ADMIN_DEMO === 'true'

const VISIBLE_DEMO_ACCOUNTS: readonly DemoAccount[] = HIDE_ADMIN_DEMO
  ? DEMO_ACCOUNTS.filter((account) => account.role !== '管理員')
  : DEMO_ACCOUNTS

export function Login() {
  const { user, status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const formRef = useRef<HTMLFormElement>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const back = redirectTargetOf(location.state)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      await login({ email, password })
      // ⚠️ `replace`：登入頁不該留在返回堆疊裡。否則使用者登入後按上一頁
      // 又回到登入畫面，而他明明已經登入了。
      await navigate(back, { replace: true })
    } catch (cause) {
      // FR-083：**MUST 保留已填內容。** 這裡什麼都不清——email 留著，
      // 使用者只要改密碼就好。
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  // 已經登入的人不該再看到登入表單——他會以為自己被登出了。
  // 放在 hooks 之後才 return，順序才不會在兩次繪製之間改變。
  if (status === 'authenticated' && user) return <Navigate to={back} replace />

  const message = error ? messageFor(error) : null

  return (
    <div className="mx-auto grid max-w-5xl gap-gap-6 py-gap-6 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-h1 text-ink">登入</h1>

        <LoginReasonNotice />

        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
          className="mt-gap-5 grid gap-gap-4"
        >
          <Field label="電子郵件" htmlFor="login-email">
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field label="密碼" htmlFor="login-password">
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          {/*
            ⚠️ 登入失敗一律顯示為**整體訊息**，MUST NOT 標到任何一欄（FR-004）。
          */}
          {message && (
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
            {busy ? '登入中…' : '登入'}
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

        <p className="mt-gap-5 text-small text-ink-muted">
          還沒有帳號？
          <Link
            to="/register"
            // 把原目的地一起帶過去，註冊完才回得到他本來要去的地方
            state={location.state as LoginRedirectState | null}
            className="ml-gap-1 text-brand-strong underline underline-offset-4"
          >
            註冊一個
          </Link>
        </p>
      </section>

      <aside className="grid h-fit gap-gap-4">
        <DemoAccounts
          onUse={(account) => {
            setEmail(account.email)
            setPassword(account.password)
            setError(null)
          }}
        />
        <PasswordWarning />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
/** FR-005：公開列出測試帳號。 */
function DemoAccounts({ onUse }: { onUse: (account: DemoAccount) => void }) {
  return (
    <section className={`${insetClass} p-gap-5`}>
      <h2 className="font-display text-h3 text-ink">測試帳號</h2>
      <p className="mt-gap-2 text-small text-ink-muted">
        這是展示用專案，直接使用以下任一組帳號即可，不需要註冊。
      </p>
      <ul className="mt-gap-3 grid gap-gap-3">
        {VISIBLE_DEMO_ACCOUNTS.map((account) => (
          <li
            key={account.email}
            className="flex flex-wrap items-center justify-between gap-gap-2 rounded-xs bg-surface p-gap-3"
          >
            <div className="text-small">
              <p className="text-ink">
                {account.email}
                <span className="ml-gap-2 rounded-pill bg-brand-soft px-gap-2 py-gap-1 text-tiny text-ink">
                  {account.role}
                </span>
              </p>
              <p className="mt-gap-1 text-ink-muted">密碼：{account.password}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onUse(account)
              }}
              className="rounded-pill border border-line-strong px-gap-3 py-gap-1 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
            >
              填入
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

