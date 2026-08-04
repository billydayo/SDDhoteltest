/**
 * T076：帳戶設定（FR-007、FR-009c、FR-083）。
 *
 * ## ⚠️ 存檔後 MUST 即時反映於介面各處（FR-007）
 *
 * 最容易寫錯的版本是：`PATCH /me` 成功 → 只更新本頁的表單狀態。
 * 頁首仍顯示舊名字，直到使用者重新整理。他會以為存檔沒成功，於是再按一次。
 *
 * 因此存檔成功後 MUST 把**後端回傳的** profile 灌回 `AuthContext`
 * （`applyProfile`）——而不是把自己送出去的值灌回去。兩者不一定相同：
 * 後端可能修剪空白，或在未來加上其他正規化。以送出的值為準，畫面會顯示一份
 * 資料庫裡並不存在的內容。
 *
 * ## 不可修改的東西要看得見
 *
 * 電子郵件與角色在這裡是唯讀的。**不顯示**它們會讓使用者找半天；
 * 顯示成可編輯的輸入框則更糟——他改了、按了存檔、什麼都沒發生。
 * 角色升降只能由管理員端點變更（`ProfileUpdateIn` 刻意沒有 `role` 欄位）。
 */
import { useRef, useState } from 'react'

import { api } from '../api/client'
import type { Profile } from '../api/types'
import { Field } from '../components/Field'
import { LoadingState } from '../components/LoadingState'
import * as dates from '../lib/dates'
import { messageFor } from '../lib/errors'
import { inputClass, useFieldFocus } from '../lib/form'
import { useAuth } from '../state/AuthContext'
import { insetClass, primaryButtonClass } from '../lib/surfaces'

const ROLE_LABEL: Record<string, string> = { member: '會員', admin: '管理員' }

export function Account() {
  const { user, status } = useAuth()

  if (status === 'loading') return <LoadingState label="載入帳戶資料…" />
  if (!user) return null // RequireAuth 已擋在外面，這裡只是讓型別收斂

  // ⚠️ `key` 綁在 profile id 上，**表單狀態由 props 一次性初始化**。
  //
  // 常見的替代作法是用一個 effect 把 context 的值同步進表單狀態。那個 effect
  // 會在 context 每次更新時重跑，而 context 每次更新都是新的物件實體——
  // 症狀是使用者打字打到一半，輸入框被重設回伺服器的值，字就這樣被吃掉。
  return <ProfileForm key={user.id} profile={user} />
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { applyProfile, logout } = useAuth()

  const formRef = useRef<HTMLFormElement>(null)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const badField = useFieldFocus(formRef, error)
  const user = profile

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api.profile.update({
        displayName,
        // 空字串代表「清空電話」。送 `''` 而非 undefined——後者是「不要動」，
        // 兩者在傳輸層長得一樣但意思相反。
        phone,
      })
      // ⚠️ 灌回**後端回傳的**值，不是送出的值。頁首因此同步更新（FR-007）。
      applyProfile(updated)
      setDisplayName(updated.displayName)
      setPhone(updated.phone ?? '')
      setSaved(true)
    } catch (cause) {
      // FR-083：MUST 保留已填內容
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const message = error ? messageFor(error) : null
  const fieldError = (name: string) => (badField === name ? (message?.detail ?? null) : null)

  return (
    <div className="mx-auto max-w-2xl py-gap-6">
      <h1 className="font-display text-h1 text-ink">帳戶設定</h1>

      <section className={`mt-gap-5 ${insetClass} p-gap-5`}>
        <h2 className="font-display text-h3 text-ink">帳號資訊</h2>
        <dl className="mt-gap-3 grid gap-gap-3 sm:grid-cols-2">
          <ReadOnly label="電子郵件" value={user.email} />
          <ReadOnly label="身分" value={ROLE_LABEL[user.role] ?? user.role} />
          <ReadOnly label="註冊時間" value={dates.formatTimestamp(user.createdAt)} />
        </dl>
        {/* 說明為什麼這幾項不能改，否則使用者會找很久 */}
        <p className="mt-gap-3 text-tiny text-ink-muted">
          電子郵件與身分無法自行變更。身分的調整只能由管理員進行，且會留下稽核紀錄。
        </p>
      </section>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="mt-gap-6 grid gap-gap-4"
      >
        <h2 className="font-display text-h3 text-ink">個人資料</h2>

        <Field label="顯示名稱" htmlFor="account-displayName" error={fieldError('displayName')}>
          <input
            id="account-displayName"
            name="displayName"
            type="text"
            autoComplete="nickname"
            required
            maxLength={100}
            aria-invalid={badField === 'displayName'}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              setSaved(false)
            }}
            className={inputClass}
          />
        </Field>

        <Field
          label="聯絡電話"
          htmlFor="account-phone"
          error={fieldError('phone')}
          hint="訂房時會預先帶入。可以留空。"
        >
          <input
            id="account-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={50}
            aria-invalid={badField === 'phone'}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setSaved(false)
            }}
            className={inputClass}
          />
        </Field>

        {message && !badField && (
          <p
            role="alert"
            className="rounded-xs bg-danger-soft px-gap-3 py-gap-2 text-small text-danger"
          >
            {message.detail}
          </p>
        )}

        {saved && (
          // 存檔成功也要說。沒有回饋的話使用者會反覆按存檔，
          // 因為畫面上沒有任何東西改變（他看不出頁首也更新了）。
          <p
            role="status"
            className="rounded-xs bg-ok-soft px-gap-3 py-gap-2 text-small text-ok"
          >
            已儲存。
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-gap-3">
          <button
            type="submit"
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? '儲存中…' : '儲存變更'}
          </button>

          <button
            type="button"
            onClick={logout}
            className="rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted transition-colors hover:border-danger hover:text-danger"
          >
            登出
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tiny text-ink-muted">{label}</dt>
      <dd className="mt-gap-1 text-body text-ink">{value}</dd>
    </div>
  )
}
