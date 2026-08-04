/**
 * T127：房源管理（FR-050 ~ FR-052、FR-051b）。
 *
 * ## 房態有兩種，畫面上必須分得開
 *
 * - `status`：**營運狀態**，只有「開放預訂」與「維護中」，不分日期，可人工設定
 * - `availability`：**所查區間推導出來的**，含「已預訂」，MUST NOT 人工設定
 *
 * 後端連 `RoomWriteIn.status` 都拒絕 `booked`（`schemas/admin.py`）。畫面上
 * 若把兩者畫成同一個下拉選單，業者會去找「為什麼不能把房間設成已預訂」。
 *
 * ## 刪除前先說清楚會影響誰（FR-052）
 *
 * 直接跳一句「確定刪除？」等於沒問——業者不知道那間房底下還有三筆已付款的
 * 訂單。因此按下刪除後先向後端取受影響的訂單，逐筆列出來再讓他決定。
 *
 * ## 照片：上傳與掛載分開（FR-050f）
 *
 * 上傳只回傳路徑，沒有寫進任何房源。因此本頁記下「這次上傳了哪些」，
 * 在取消時清掉它們，在儲存時清掉「上傳了但最後沒留在清單裡」的那些。
 * 少了這一步，每一次反悔都會在伺服器上留下一個沒有人引用的檔案。
 */
import { useCallback, useId, useMemo, useState, type SyntheticEvent } from 'react'

import { api } from '../../api/client'
import type { AdminRoom, AdminRoomFilters, AffectedOrder, RoomWriteInput } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { ImageManager } from '../../components/ImageManager'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import {
  availabilityLabel,
  availabilityTone,
  ROOM_STATUSES,
  roomStatusLabel,
} from '../../lib/labels'
import { formatTWD } from '../../lib/money'
import {
  Badge,
  buttonClass,
  dangerButtonClass,
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

const EMPTY_FILTERS: AdminRoomFilters = {}

const BLANK_ROOM: RoomWriteInput = {
  name: '',
  type: '',
  maxGuests: 2,
  nightlyPrice: 2000,
  description: '',
  images: [],
  amenities: [],
  features: [],
  status: 'available',
}

function toInput(room: AdminRoom): RoomWriteInput {
  return {
    name: room.name,
    type: room.type,
    maxGuests: room.maxGuests,
    nightlyPrice: room.nightlyPrice,
    description: room.description,
    images: room.images,
    amenities: room.amenities,
    features: room.features,
    status: room.status,
  }
}

// ---------------------------------------------------------------------------
// 表單
// ---------------------------------------------------------------------------
interface RoomFormProps {
  /** `null` 為新增。 */
  room: AdminRoom | null
  onDone: (message: string) => void
  onCancel: () => void
}

function RoomForm({ room, onDone, onCancel }: RoomFormProps) {
  const [draft, setDraft] = useState<RoomWriteInput>(room ? toInput(room) : BLANK_ROOM)
  /** 本次上傳的檔案路徑。⚠️ 沒有這份清單就無法履行 FR-050f。 */
  const [uploaded, setUploaded] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const ids = useId()

  const loadVocabulary = useCallback((signal: AbortSignal) => api.vocabulary.get(signal), [])
  const vocabulary = useAsync(loadVocabulary)

  /** 上傳了但最後不在清單裡的檔案。取消時是全部，儲存時是被移除的那些。 */
  function orphans(keep: string[]): string[] {
    return uploaded.filter((path) => !keep.includes(path))
  }

  function discard(paths: string[]) {
    // 清理失敗不該擋住使用者——他要的是離開這張表單。失敗的檔案留在伺服器上
    // 是個小問題，卡住不讓他走是個大問題。
    for (const path of paths) {
      void api.admin.roomPhotos.discard(path).catch(() => undefined)
    }
  }

  function cancel() {
    discard(orphans([]))
    onCancel()
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (room) {
        await api.admin.rooms.update(room.id, draft)
      } else {
        await api.admin.rooms.create(draft)
      }
      discard(orphans(draft.images))
      onDone(room ? `已更新「${draft.name}」。` : `已新增「${draft.name}」。`)
    } catch (cause) {
      // ⚠️ **表單內容保留**（FR-083）。清空重來會讓使用者失去剛剛打的一切，
      // 而失敗的原因常常只是一個欄位。
      setError(cause)
      setSaving(false)
    }
  }

  function toggle(key: 'amenities' | 'features', value: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
      className="mt-gap-4 rounded-base border border-brand/30 bg-surface p-gap-4"
      aria-label={room ? '編輯房源' : '新增房源'}
    >
      <h3 className="text-md text-ink">{room ? `編輯「${room.name}」` : '新增房源'}</h3>

      <div className="mt-gap-3 flex flex-wrap gap-gap-3">
        <Field label="房名" htmlFor={`${ids}-name`} className="min-w-56 flex-1">
          <input
            id={`${ids}-name`}
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="房型" htmlFor={`${ids}-type`} className="min-w-40 flex-1">
          <input
            id={`${ids}-type`}
            required
            maxLength={60}
            value={draft.type}
            onChange={(e) => {
              setDraft({ ...draft, type: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="可住人數" htmlFor={`${ids}-guests`} className="w-32">
          <input
            id={`${ids}-guests`}
            type="number"
            min={1}
            max={20}
            required
            value={draft.maxGuests}
            onChange={(e) => {
              setDraft({ ...draft, maxGuests: Number(e.target.value) })
            }}
            className={inputClass}
          />
        </Field>
        <Field
          label="每晚房價"
          htmlFor={`${ids}-price`}
          className="w-44"
          hint="整數新臺幣元，不接受小數"
        >
          <input
            id={`${ids}-price`}
            type="number"
            min={1}
            step={1}
            required
            value={draft.nightlyPrice}
            onChange={(e) => {
              setDraft({ ...draft, nightlyPrice: Math.trunc(Number(e.target.value)) })
            }}
            className={inputClass}
          />
        </Field>
        {/* ⚠️ 只有兩種。「已預訂」由訂單推導，不在這裡（FR-051）。 */}
        <Field
          label="營運狀態"
          htmlFor={`${ids}-status`}
          className="w-44"
          hint="「已預訂」由訂單推導，無法人工設定"
        >
          <select
            id={`${ids}-status`}
            value={draft.status}
            onChange={(e) => {
              setDraft({ ...draft, status: e.target.value === 'maintenance' ? 'maintenance' : 'available' })
            }}
            className={inputClass}
          >
            {ROOM_STATUSES.map((value) => (
              <option key={value} value={value}>
                {roomStatusLabel(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-gap-3">
        <Field label="房源描述" htmlFor={`${ids}-desc`} className="w-full">
          <textarea
            id={`${ids}-desc`}
            rows={3}
            maxLength={4000}
            value={draft.description}
            onChange={(e) => {
              setDraft({ ...draft, description: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
      </div>

      {/* 設施與特色來自系統參數的詞彙表（FR-010a）。清單為空時整組隱藏，
          而不是顯示一個沒有選項的空方框。 */}
      {vocabulary.data &&
        (
          [
            ['amenities', '設施', vocabulary.data.amenities],
            ['features', '房型特色', vocabulary.data.features],
          ] as const
        ).map(([key, label, options]) =>
          options.length === 0 ? null : (
            <fieldset key={key} className="mt-gap-3">
              <legend className="text-tiny text-ink-muted">{label}</legend>
              <div className="mt-gap-1 flex flex-wrap gap-gap-2">
                {options.map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-gap-1 rounded-pill border border-line-strong px-gap-3 py-gap-1 text-small"
                  >
                    <input
                      type="checkbox"
                      checked={draft[key].includes(option)}
                      onChange={() => {
                        toggle(key, option)
                      }}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          ),
        )}

      <div className="mt-gap-4">
        <ImageManager
          images={draft.images}
          disabled={saving}
          onChange={(images) => {
            setDraft((prev) => ({ ...prev, images }))
          }}
          onUploaded={(path) => {
            setUploaded((prev) => [...prev, path])
          }}
        />
      </div>

      {error !== null && <Notice tone="danger">{messageFor(error).detail}</Notice>}

      <div className="mt-gap-4 flex gap-gap-2">
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button type="button" onClick={cancel} disabled={saving} className={buttonClass}>
          取消
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 刪除確認（FR-052）
// ---------------------------------------------------------------------------
function DeletePanel({
  room,
  onDone,
  onCancel,
}: {
  room: AdminRoom
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const load = useCallback(
    (signal: AbortSignal) => api.admin.rooms.affectedOrders(room.id, signal),
    [room.id],
  )
  const { status, data, error, reload } = useAsync<AffectedOrder[]>(load)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  async function remove() {
    setBusy(true)
    setFailure(null)
    try {
      await api.admin.rooms.remove(room.id)
      onDone(`已刪除「${room.name}」。`)
    } catch (cause) {
      setFailure(cause)
      setBusy(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label={`刪除「${room.name}」`}
      className="mt-gap-4 rounded-base border border-danger/40 bg-danger-soft p-gap-4"
    >
      <h3 className="text-md text-danger">刪除「{room.name}」</h3>

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} title="無法確認受影響的訂單" />
      ) : !data ? (
        <LoadingState label="確認受影響的訂單…" />
      ) : data.length === 0 ? (
        <p className="mt-gap-2 text-small text-ink">
          目前沒有任何訂單使用這間房源。刪除後將無法復原。
        </p>
      ) : (
        <>
          {/* ⚠️ FR-052：MUST 列出受影響的訂單。只問「確定嗎」等於沒問。 */}
          <p className="mt-gap-2 text-small text-ink">
            以下 {data.length} 筆訂單使用這間房源，刪除後將一併受影響：
          </p>
          <ul className="mt-gap-2 max-h-56 overflow-y-auto text-small text-ink">
            {data.map((order) => (
              <li key={order.id} className="border-b border-line-soft py-gap-1">
                {order.orderNo}｜{order.contactName}｜{order.checkIn} → {order.checkOut}
              </li>
            ))}
          </ul>
        </>
      )}

      {failure !== null && <Notice tone="danger">{messageFor(failure).detail}</Notice>}

      <div className="mt-gap-4 flex gap-gap-2">
        <button
          type="button"
          disabled={busy || status === 'loading'}
          onClick={() => {
            void remove()
          }}
          className={dangerButtonClass}
        >
          {busy ? '刪除中…' : '確定刪除'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={buttonClass}>
          取消
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export function Rooms() {
  const [draftFilters, setDraftFilters] = useState<AdminRoomFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<AdminRoomFilters>(EMPTY_FILTERS)
  const [editing, setEditing] = useState<AdminRoom | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AdminRoom | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const ids = useId()

  const load = useCallback((signal: AbortSignal) => api.admin.rooms.list(filters, signal), [filters])
  const { status, data, error, reload } = useAsync<AdminRoom[]>(load)

  const rooms = useMemo(() => data ?? [], [data])

  function finish(text: string) {
    setMessage(text)
    setEditing(null)
    setDeleting(null)
    reload()
  }

  async function toggleStatus(room: AdminRoom) {
    setMessage(null)
    try {
      await api.admin.rooms.setStatus(
        room.id,
        room.status === 'maintenance' ? 'available' : 'maintenance',
      )
      reload()
    } catch (cause) {
      setMessage(messageFor(cause).detail)
    }
  }

  return (
    <div>
      <ModuleHeading
        title="房源管理"
        actions={
          <>
            {/* ⚠️ 帶入的是**已套用**的篩選（`filters`）而不是輸入中的
                `draftFilters`——匯出的筆數 MUST 等於畫面上的筆數（SC-033）。 */}
            <ExportButton
              module="rooms"
              params={{
                keyword: filters.keyword,
                type: filters.type,
                minPrice: filters.minPrice,
                maxPrice: filters.maxPrice,
              }}
            />
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                setDeleting(null)
                setEditing('new')
              }}
            >
              新增房源
            </button>
          </>
        }
      />

      <FilterBar
        onReset={() => {
          setDraftFilters(EMPTY_FILTERS)
          setFilters(EMPTY_FILTERS)
        }}
      >
        <Field label="關鍵字" htmlFor={`${ids}-kw`}>
          <input
            id={`${ids}-kw`}
            value={draftFilters.keyword ?? ''}
            placeholder="房名或房型"
            onChange={(e) => {
              setDraftFilters({ ...draftFilters, keyword: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="價格下限" htmlFor={`${ids}-min`} className="w-28">
          <input
            id={`${ids}-min`}
            type="number"
            min={0}
            value={draftFilters.minPrice ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              setDraftFilters({ ...draftFilters, minPrice: raw === '' ? undefined : Number(raw) })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="價格上限" htmlFor={`${ids}-max`} className="w-28">
          <input
            id={`${ids}-max`}
            type="number"
            min={0}
            value={draftFilters.maxPrice ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              setDraftFilters({ ...draftFilters, maxPrice: raw === '' ? undefined : Number(raw) })
            }}
            className={inputClass}
          />
        </Field>
        {/* 房態依**區間**推導，含頭含尾（FR-051b）。未指定時後端以今日計。 */}
        <Field label="房態起日" htmlFor={`${ids}-start`} className="w-44">
          <input
            id={`${ids}-start`}
            type="date"
            value={draftFilters.startDate ?? ''}
            onChange={(e) => {
              setDraftFilters({ ...draftFilters, startDate: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="房態迄日" htmlFor={`${ids}-end`} className="w-44" hint="含頭含尾">
          <input
            id={`${ids}-end`}
            type="date"
            value={draftFilters.endDate ?? ''}
            onChange={(e) => {
              setDraftFilters({ ...draftFilters, endDate: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setFilters(draftFilters)
          }}
        >
          套用
        </button>
      </FilterBar>

      {message !== null && <Notice tone="ok">{message}</Notice>}

      {editing !== null && (
        <RoomForm
          room={editing === 'new' ? null : editing}
          onDone={finish}
          onCancel={() => {
            setEditing(null)
          }}
        />
      )}

      {deleting !== null && (
        <DeletePanel
          room={deleting}
          onDone={finish}
          onCancel={() => {
            setDeleting(null)
          }}
        />
      )}

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入房源…" />
      ) : rooms.length === 0 ? (
        <EmptyState
          title="沒有符合條件的房源"
          hint="放寬價格或關鍵字後再試一次，或直接新增一間房源。"
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>房名</Th>
              <Th>房型</Th>
              <Th align="right">每晚房價</Th>
              <Th align="right">可住</Th>
              <Th>營運狀態</Th>
              <Th>所查區間房態</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <Td>
                  <span className="font-medium text-ink">{room.name}</span>
                  <span className="ml-gap-2 text-tiny text-ink-muted">
                    {room.images.length} 張照片
                  </span>
                </Td>
                <Td>{room.type}</Td>
                <Td align="right">{formatTWD(room.nightlyPrice)}</Td>
                <Td align="right">{room.maxGuests}</Td>
                <Td>{roomStatusLabel(room.status)}</Td>
                <Td>
                  <Badge tone={availabilityTone(room.availability)}>
                    {availabilityLabel(room.availability)}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-gap-1">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        setDeleting(null)
                        setEditing(room)
                      }}
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        void toggleStatus(room)
                      }}
                    >
                      {room.status === 'maintenance' ? '恢復開放' : '設為維護中'}
                    </button>
                    <button
                      type="button"
                      className={dangerButtonClass}
                      onClick={() => {
                        setEditing(null)
                        setDeleting(room)
                      }}
                    >
                      刪除
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  )
}
