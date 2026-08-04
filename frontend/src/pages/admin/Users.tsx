/**
 * T129：用戶管理——會員資料維護與權限升降（FR-055）。
 *
 * ## 兩個入口，不是一個表單
 *
 * ⚠️ **角色變更與資料編輯是兩個端點，介面上也 MUST 分開。**
 *
 * 後端的 `UserUpdateIn` 刻意沒有 `role` 欄位：角色走獨立端點，才能保證每一次
 * 升降權都留下稽核紀錄。前端若把兩者併成同一個表單再各自送兩個請求，畫面上
 * 看起來是一次儲存，實際上可能一半成功一半失敗——而失敗的那一半剛好是權限。
 *
 * 分成兩個明確的操作，也讓「升權」在介面上是一件需要刻意去做的事，
 * 而不是編輯電話時順手改到的一個下拉選單。
 *
 * ## 降權立即生效
 *
 * `require_admin` 每次都重新查資料庫的 `role`，不信任 token payload。因此被
 * 降權的人**下一個操作**就會被擋下，不必等他重新登入（spec Edge Cases）。
 * 介面上要講清楚這件事——否則管理員會以為降權要等對方登出才生效，
 * 而在處理盜用帳號時那個誤解會讓他多等好幾個小時。
 */
import { useState } from 'react'

import { api } from '../../api/client'
import type { AdminUser, Role } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Field } from '../../components/Field'
import { LoadingState } from '../../components/LoadingState'
import { TD, TH, TableScroll } from '../../components/TableScroll'
import { formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { inputClass } from '../../lib/form'
import { ROLE_LABELS, labelOf } from '../../lib/labels'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../state/AuthContext'
import { AdminPageHeader } from './AdminLayout'

export function AdminUsers() {
  const [keyword, setKeyword] = useState('')
  const [role, setRole] = useState('')
  const [applied, setApplied] = useState({ keyword: '', role: '' })

  const users = useAsync(
    (signal) => {
      // 空字串 MUST NOT 被送出：`?role=` 在後端是「角色等於空字串」，
      // 結果是零筆，而使用者只是沒有選那一欄（同 `lib/filters.ts` 的作法）。
      const query: { keyword?: string; role?: string } = {}
      if (applied.keyword.trim()) query.keyword = applied.keyword.trim()
      if (applied.role) query.role = applied.role
      return api.admin.users.list(query, signal)
    },
    [applied.keyword, applied.role],
  )

  return (
    <div>
      <AdminPageHeader
        title="用戶管理"
        description="維護會員資料與角色。角色變更會立即生效並寫入操作日誌。"
      />

      <form
        className="mb-gap-5 grid gap-gap-3 rounded-lg border border-line-soft bg-surface p-gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied({ keyword, role })
        }}
      >
        <Field label="關鍵字" htmlFor="keyword" hint="比對顯示名稱與電子郵件">
          <input
            id="keyword"
            name="keyword"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="角色" htmlFor="role">
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value)
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            <option value="member">會員</option>
            <option value="admin">管理員</option>
          </select>
        </Field>

        <div className="flex items-end gap-gap-2">
          <button
            type="submit"
            className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
          >
            搜尋
          </button>
          <button
            type="button"
            onClick={() => {
              setKeyword('')
              setRole('')
              setApplied({ keyword: '', role: '' })
            }}
            className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            清除
          </button>
        </div>
      </form>

      {users.error ? (
        <ErrorState error={users.error} onRetry={users.reload} />
      ) : users.loading && !users.data ? (
        <LoadingState label="載入會員…" />
      ) : users.data?.length === 0 ? (
        <EmptyState title="沒有符合條件的會員" hint="試著清除關鍵字或改選其他角色。" />
      ) : (
        <>
          <p aria-live="polite" className="mb-gap-2 text-small text-ink-muted">
            共 {users.data?.length ?? 0} 位會員
          </p>
          <TableScroll label="會員清單">
            <table className="w-full border-collapse">
              <thead className="border-b border-line-soft bg-surface-alt">
                <tr>
                  <th className={TH}>顯示名稱</th>
                  <th className={TH}>電子郵件</th>
                  <th className={TH}>聯絡電話</th>
                  <th className={TH}>角色</th>
                  <th className={TH}>註冊時間</th>
                  <th className={TH}>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((user) => (
                  <UserRow key={user.id} user={user} onChanged={users.reload} />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </div>
  )
}

type Panel = 'none' | 'profile' | 'role'

function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const { user: me } = useAuth()
  const [panel, setPanel] = useState<Panel>('none')
  const isSelf = me?.id === user.id

  function toggle(next: Panel) {
    setPanel((current) => (current === next ? 'none' : next))
  }

  return (
    <>
      <tr className="border-b border-line-soft last:border-0">
        <td className={TD}>
          {user.displayName}
          {isSelf && <span className="ml-gap-1 text-tiny text-ink-muted">（你自己）</span>}
        </td>
        <td className={TD}>{user.email}</td>
        <td className={TD}>{user.phone ?? '—'}</td>
        <td className={TD}>
          <span
            className={[
              'rounded-pill px-gap-2 py-gap-1 text-tiny',
              user.role === 'admin' ? 'bg-brand-soft text-brand-strong' : 'bg-surface-alt text-ink-muted',
            ].join(' ')}
          >
            {labelOf(ROLE_LABELS, user.role)}
          </span>
        </td>
        <td className={`${TD} whitespace-nowrap`}>{formatTimestamp(user.createdAt)}</td>
        <td className={TD}>
          <div className="flex gap-gap-2">
            <RowButton
              active={panel === 'profile'}
              onClick={() => {
                toggle('profile')
              }}
            >
              編輯資料
            </RowButton>
            <RowButton
              active={panel === 'role'}
              onClick={() => {
                toggle('role')
              }}
            >
              變更角色
            </RowButton>
          </div>
        </td>
      </tr>

      {panel !== 'none' && (
        <tr className="border-b border-line-soft bg-surface-alt">
          <td colSpan={6} className="px-gap-3 py-gap-3">
            {panel === 'profile' ? (
              <ProfileForm
                user={user}
                onDone={() => {
                  setPanel('none')
                  onChanged()
                }}
              />
            ) : (
              <RoleForm
                user={user}
                isSelf={isSelf}
                onDone={() => {
                  setPanel('none')
                  onChanged()
                }}
              />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function RowButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className="rounded-xs border border-line-strong px-gap-2 py-gap-1 text-tiny whitespace-nowrap text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
    >
      {children}
    </button>
  )
}

/** 顯示名稱與聯絡電話。**沒有角色欄位**——見本檔開頭。 */
function ProfileForm({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.admin.users.update(user.id, { displayName, phone })
      onDone()
    } catch (cause) {
      setError(cause)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-wrap items-end gap-gap-3"
    >
      <div className="min-w-48">
        <label htmlFor={`name-${user.id}`} className="mb-gap-1 block text-tiny text-ink-muted">
          顯示名稱
        </label>
        <input
          id={`name-${user.id}`}
          name="displayName"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
          maxLength={60}
          className={inputClass}
        />
      </div>
      <div className="min-w-48">
        <label htmlFor={`phone-${user.id}`} className="mb-gap-1 block text-tiny text-ink-muted">
          聯絡電話
        </label>
        <input
          id={`phone-${user.id}`}
          name="phone"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
          }}
          maxLength={30}
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong disabled:opacity-50"
      >
        {saving ? '儲存中…' : '儲存'}
      </button>
      {error != null && (
        <p role="alert" className="w-full text-small text-danger">
          {messageFor(error).detail}
        </p>
      )}
    </form>
  )
}

/**
 * 角色升降。
 *
 * ⚠️ **不可將自己降權**，後端會以 409 拒絕（`CANNOT_DEMOTE_SELF`）。這裡在
 * 送出前就擋下並說明理由——讓使用者按下按鈕才被拒絕，他會以為是系統故障，
 * 而真正的原因（系統可能因此失去所有管理員）他完全看不到。
 */
function RoleForm({
  user,
  isSelf,
  onDone,
}: {
  user: AdminUser
  isSelf: boolean
  onDone: () => void
}) {
  const [role, setRole] = useState<Role>(user.role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const demotingSelf = isSelf && role !== 'admin'
  const unchanged = role === user.role

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.admin.users.setRole(user.id, role)
      onDone()
    } catch (cause) {
      setError(cause)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-wrap items-end gap-gap-3"
    >
      <div className="min-w-40">
        <label htmlFor={`role-${user.id}`} className="mb-gap-1 block text-tiny text-ink-muted">
          角色
        </label>
        <select
          id={`role-${user.id}`}
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role)
          }}
          className={inputClass}
        >
          <option value="member">會員</option>
          <option value="admin">管理員</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={saving || unchanged || demotingSelf}
        className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? '變更中…' : '確認變更'}
      </button>

      <p className="w-full text-tiny text-ink-muted">
        {demotingSelf
          ? '不可將自己降權。請由另一位管理員執行，以免系統失去所有管理員。'
          : unchanged
            ? '角色未變更。'
            : '變更會立即生效——對方的下一個操作就會依新角色判定，不需要等他重新登入。'}
      </p>

      {error != null && (
        <p role="alert" className="w-full text-small text-danger">
          {messageFor(error).detail}
        </p>
      )}
    </form>
  )
}
