/**
 * T129：會員管理（FR-055）。
 *
 * ## 資料維護與權限升降是兩個動作，不是同一張表單
 *
 * 後端刻意把 `role` 從 `UserUpdateIn` 拿掉，只留一個獨立端點
 * （`schemas/admin.py`）——這樣每一次角色變更都必然留下稽核紀錄。
 * 畫面照著這個形狀走：改名字改電話是一件事，升降權限是另一件，
 * 而且後者要二次確認。
 *
 * 把它們合成一張表單的話，管理員在改電話時順手把下拉選單碰到了，
 * 存檔後對方就成了管理員——而畫面上什麼異狀都沒有。
 *
 * ## 這裡看不到密碼，也看不到 Google 識別碼
 *
 * `AdminUserOut` 明列欄位而非把 ORM 物件整個倒出來（`schemas/admin.py`）。
 * 前端因此連「不小心顯示出來」的機會都沒有。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { AdminUser, AdminUserFilters, Role } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import { roleLabel, ROLES } from '../../lib/labels'
import {
  Badge,
  buttonClass,
  Field,
  FilterBar,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
  TableShell,
  Td,
  Th,
} from './ui'

const EMPTY: AdminUserFilters = {}

// ---------------------------------------------------------------------------
// 編輯一列
// ---------------------------------------------------------------------------
function EditRow({
  user,
  onDone,
  onCancel,
}: {
  user: AdminUser
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const ids = useId()

  async function save() {
    setSaving(true)
    setFailure(null)
    try {
      await api.admin.users.update(user.id, { displayName, phone })
      onDone(`已更新「${displayName}」的資料。`)
    } catch (cause) {
      // ⚠️ 已填內容 MUST 保留（FR-083）。
      setFailure(messageFor(cause).detail)
      setSaving(false)
    }
  }

  return (
    <tr className="bg-brand-soft/40">
      <Td className="align-top">
        <label htmlFor={`${ids}-name`} className="block text-tiny text-ink-muted">
          顯示名稱
        </label>
        <input
          id={`${ids}-name`}
          value={displayName}
          maxLength={60}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
          className={inputClass}
        />
      </Td>
      <Td className="align-top">{user.email}</Td>
      <Td className="align-top">
        <label htmlFor={`${ids}-phone`} className="block text-tiny text-ink-muted">
          聯絡電話
        </label>
        <input
          id={`${ids}-phone`}
          value={phone}
          maxLength={30}
          onChange={(e) => {
            setPhone(e.target.value)
          }}
          className={inputClass}
        />
      </Td>
      <Td className="align-top">{roleLabel(user.role)}</Td>
      <Td className="align-top">
        <div className="flex flex-wrap gap-gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void save()
            }}
            className={primaryButtonClass}
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          <button type="button" disabled={saving} onClick={onCancel} className={buttonClass}>
            取消
          </button>
        </div>
        {failure !== null && <p className="mt-gap-1 text-tiny text-danger">{failure}</p>}
      </Td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// 角色升降的二次確認（FR-055）
// ---------------------------------------------------------------------------
function RoleConfirm({
  user,
  target,
  onDone,
  onCancel,
}: {
  user: AdminUser
  target: Role
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function apply() {
    setBusy(true)
    setFailure(null)
    try {
      await api.admin.users.setRole(user.id, target)
      onDone(`已將「${user.displayName}」設為${roleLabel(target)}。`)
    } catch (cause) {
      setFailure(messageFor(cause).detail)
      setBusy(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label="變更權限"
      className="mt-gap-4 rounded-base border border-warn/40 bg-warn-soft p-gap-4"
    >
      <h3 className="text-md text-ink">
        將「{user.displayName}」從{roleLabel(user.role)}改為{roleLabel(target)}？
      </h3>
      <p className="mt-gap-2 text-small text-ink">
        {target === 'admin'
          ? '管理員能看到所有訂單與會員資料，並可調整系統參數。'
          : '對方將失去後台的所有存取權限。'}
        這項變更會記入操作日誌，且日誌無法修改或刪除。
      </p>
      {failure !== null && <Notice tone="danger">{failure}</Notice>}
      <div className="mt-gap-3 flex gap-gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void apply()
          }}
          className={primaryButtonClass}
        >
          {busy ? '變更中…' : '確定變更'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
          取消
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export function Users() {
  const [draft, setDraft] = useState<AdminUserFilters>(EMPTY)
  const [filters, setFilters] = useState<AdminUserFilters>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [roleChange, setRoleChange] = useState<{ user: AdminUser; target: Role } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const ids = useId()

  const load = useCallback(
    (signal: AbortSignal) => api.admin.users.list(filters, signal),
    [filters],
  )
  const { status, data, error, reload } = useAsync<AdminUser[]>(load)

  function finish(text: string) {
    setMessage(text)
    setEditing(null)
    setRoleChange(null)
    reload()
  }

  return (
    <div>
      {/* ⚠️ 匯出的用戶欄位不含電子郵件與密碼（`services/export.py` 的
          `USER_COLUMNS`）——畫面上看得到 email，檔案裡沒有，這是刻意的
          （FR-118）。 */}
      <ModuleHeading
        title="會員管理"
        actions={
          <ExportButton module="users" params={{ keyword: filters.keyword, role: filters.role }} />
        }
      />

      <FilterBar
        onReset={() => {
          setDraft(EMPTY)
          setFilters(EMPTY)
        }}
      >
        <Field label="關鍵字" htmlFor={`${ids}-kw`} className="min-w-56">
          <input
            id={`${ids}-kw`}
            value={draft.keyword ?? ''}
            placeholder="顯示名稱或電子郵件"
            onChange={(e) => {
              setDraft({ ...draft, keyword: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="身分" htmlFor={`${ids}-role`}>
          <select
            id={`${ids}-role`}
            value={draft.role ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setDraft({ ...draft, role: value === '' ? undefined : (value as Role) })
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setFilters(draft)
          }}
        >
          搜尋
        </button>
      </FilterBar>

      {message !== null && <Notice tone="ok">{message}</Notice>}

      {roleChange !== null && (
        <RoleConfirm
          user={roleChange.user}
          target={roleChange.target}
          onDone={finish}
          onCancel={() => {
            setRoleChange(null)
          }}
        />
      )}

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入會員…" />
      ) : data.length === 0 ? (
        <EmptyState title="沒有符合條件的會員" hint="換一組關鍵字或清除條件後再試一次。" />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>顯示名稱</Th>
              <Th>電子郵件</Th>
              <Th>聯絡電話</Th>
              <Th>身分</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((user) =>
              editing === user.id ? (
                <EditRow
                  key={user.id}
                  user={user}
                  onDone={finish}
                  onCancel={() => {
                    setEditing(null)
                  }}
                />
              ) : (
                <tr key={user.id}>
                  <Td>{user.displayName}</Td>
                  <Td>{user.email}</Td>
                  <Td>{user.phone ?? '—'}</Td>
                  <Td>
                    <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>
                      {roleLabel(user.role)}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-gap-1">
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          setRoleChange(null)
                          setEditing(user.id)
                        }}
                      >
                        編輯資料
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          setEditing(null)
                          setRoleChange({
                            user,
                            target: user.role === 'admin' ? 'member' : 'admin',
                          })
                        }}
                      >
                        {user.role === 'admin' ? '降為會員' : '升為管理員'}
                      </button>
                    </div>
                  </Td>
                </tr>
              ),
            )}
          </tbody>
        </TableShell>
      )}
    </div>
  )
}
