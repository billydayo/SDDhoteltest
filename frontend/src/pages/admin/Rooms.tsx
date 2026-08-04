/**
 * T127：房源管理——CRUD、房態調整與照片管理（FR-050 ~ FR-053a）。
 *
 * ## 「已預訂」不是一個可以設定的房態
 *
 * ⚠️ **可人工設定的只有「可販售」與「整理中」**（FR-051）。「已預訂」由當日
 * 的有效訂單推導，MUST NOT 出現在任何一個 `<select>` 裡。
 *
 * 因此這張表有**兩欄狀態**，而它們不是重複：
 *
 * - 「房態」＝ `status`，業者設定的營運狀態，不分日期
 * - 「所查期間」＝ `availability`，依查詢的日期區間推導（FR-051b）
 *
 * 一間房可以同時是「可販售」與「已預訂」——那正是正常營運的樣子。合併成一欄
 * 就得二選一，而無論選哪個都會讓另一件事看不見。
 *
 * ## 篩「已預訂」要先選日期
 *
 * FR-053a：沒有日期的「已預訂」不成立——已預訂是相對於某一天說的。這裡在送出
 * 前就擋下並說明，而不是送一個註定被拒的請求。
 *
 * ## 刪除是兩段式
 *
 * FR-052：先問後端影響範圍，列出受影響的訂單，確認後才帶 `confirm=true` 執行。
 * ⚠️ 二次確認**由伺服器端落實**——前端這個對話框只是把理由講給人聽，
 * 真正擋下未確認刪除的是後端（見 `api.admin.rooms.remove`）。
 */
import { useCallback, useMemo, useState } from 'react'

import { api } from '../../api/client'
import type {
  AdminRoom,
  AdminRoomSearchParams,
  AffectedOrder,
  RoomStatus,
  RoomWriteInput,
} from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Field } from '../../components/Field'
import { ImageManager } from '../../components/ImageManager'
import { LoadingState } from '../../components/LoadingState'
import { TD, TD_NUM, TH, TableScroll } from '../../components/TableScroll'
import { formatDisplayDate } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { inputClass } from '../../lib/form'
import { AVAILABILITY_LABELS, ORDER_STATUS_LABELS, ROOM_STATUS_LABELS, labelOf } from '../../lib/labels'
import { formatAmount } from '../../lib/money'
import { useAsync } from '../../lib/useAsync'
import { AdminPageHeader } from './AdminLayout'

interface RoomFilters {
  keyword: string
  type: string
  minPrice: string
  maxPrice: string
  startDate: string
  endDate: string
  status: string
}

const EMPTY_FILTERS: RoomFilters = {
  keyword: '',
  type: '',
  minPrice: '',
  maxPrice: '',
  startDate: '',
  endDate: '',
  status: '',
}

/** 表單值 → 查詢參數。空字串 MUST NOT 被送出（同 `lib/filters.ts` 的作法）。 */
function toQuery(values: RoomFilters): AdminRoomSearchParams {
  const query: AdminRoomSearchParams = {}
  if (values.keyword.trim()) query.keyword = values.keyword.trim()
  if (values.type) query.type = values.type
  if (values.minPrice) query.minPrice = Number(values.minPrice)
  if (values.maxPrice) query.maxPrice = Number(values.maxPrice)
  if (values.startDate) query.startDate = values.startDate
  if (values.endDate) query.endDate = values.endDate
  if (values.status) query.status = values.status
  return query
}

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

/** 編輯中的對象：`null` 為關閉，`'new'` 為新增，否則為該房源。 */
type Editing = null | 'new' | AdminRoom

export function AdminRooms() {
  const [filters, setFilters] = useState<RoomFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<RoomFilters>(EMPTY_FILTERS)
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AdminRoom | null>(null)

  const rooms = useAsync(
    (signal) => api.admin.rooms.list(toQuery(applied), signal),
    [JSON.stringify(applied)],
  )

  const done = useCallback(() => {
    setEditing(null)
    setDeleting(null)
    rooms.reload()
  }, [rooms])

  return (
    <div>
      <AdminPageHeader
        title="房源管理"
        description="新增、編輯與下架房源。「已預訂」由訂單推導，不可人工設定。"
        actions={
          <button
            type="button"
            onClick={() => {
              setEditing('new')
            }}
            className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
          >
            新增房源
          </button>
        }
      />

      {editing !== null ? (
        <RoomForm
          room={editing === 'new' ? null : editing}
          onCancel={() => {
            setEditing(null)
          }}
          onSaved={done}
        />
      ) : deleting !== null ? (
        <DeletePanel
          room={deleting}
          onCancel={() => {
            setDeleting(null)
          }}
          onDeleted={done}
        />
      ) : (
        <>
          <RoomFilterForm
            values={filters}
            onChange={setFilters}
            onSearch={() => {
              setApplied(filters)
            }}
            onClear={() => {
              setFilters(EMPTY_FILTERS)
              setApplied(EMPTY_FILTERS)
            }}
          />

          {rooms.error ? (
            <ErrorState error={rooms.error} onRetry={rooms.reload} />
          ) : rooms.loading && !rooms.data ? (
            <LoadingState label="載入房源…" />
          ) : rooms.data?.length === 0 ? (
            <EmptyState
              title="沒有符合條件的房源"
              hint="試著清除篩選條件，或先新增一間房源。"
            />
          ) : (
            <>
              <p aria-live="polite" className="mb-gap-2 text-small text-ink-muted">
                共 {rooms.data?.length ?? 0} 間房源
                {applied.startDate || applied.endDate ? '（房態依所查期間推導）' : ''}
              </p>
              <TableScroll label="房源清單">
                <table className="w-full border-collapse">
                  <thead className="border-b border-line-soft bg-surface-alt">
                    <tr>
                      <th className={TH}>房源</th>
                      <th className={TH}>房型</th>
                      <th className={`${TH} text-right`}>每晚價格</th>
                      <th className={`${TH} text-right`}>可住人數</th>
                      <th className={TH}>房態</th>
                      <th className={TH}>所查期間</th>
                      <th className={TH}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.data?.map((room) => (
                      <RoomRow
                        key={room.id}
                        room={room}
                        onEdit={() => {
                          setEditing(room)
                        }}
                        onDelete={() => {
                          setDeleting(room)
                        }}
                        onChanged={rooms.reload}
                      />
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 篩選
// ---------------------------------------------------------------------------
function RoomFilterForm({
  values,
  onChange,
  onSearch,
  onClear,
}: {
  values: RoomFilters
  onChange: (next: RoomFilters) => void
  onSearch: () => void
  onClear: () => void
}) {
  const [hint, setHint] = useState<string | null>(null)

  function set<K extends keyof RoomFilters>(key: K, value: RoomFilters[K]) {
    onChange({ ...values, [key]: value })
  }

  function submit() {
    // FR-053a：沒有日期的「已預訂」不成立——已預訂是相對於某一天說的
    if (values.status === 'booked' && !values.startDate && !values.endDate) {
      setHint('篩選「已預訂」需要先選定日期或日期區間。')
      return
    }
    setHint(null)
    onSearch()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="mb-gap-5 grid gap-gap-3 rounded-lg border border-line-soft bg-surface p-gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="關鍵字" htmlFor="room-keyword" hint="比對房名與房型">
        <input
          id="room-keyword"
          name="keyword"
          value={values.keyword}
          onChange={(e) => {
            set('keyword', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <Field label="每晚價格下限" htmlFor="minPrice">
        <input
          id="minPrice"
          name="minPrice"
          type="number"
          min={0}
          value={values.minPrice}
          onChange={(e) => {
            set('minPrice', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <Field label="每晚價格上限" htmlFor="maxPrice">
        <input
          id="maxPrice"
          name="maxPrice"
          type="number"
          min={0}
          value={values.maxPrice}
          onChange={(e) => {
            set('maxPrice', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <Field
        label="房態"
        htmlFor="room-status"
        error={hint}
        hint="「已預訂」由訂單推導，需先選定日期"
      >
        <select
          id="room-status"
          name="status"
          value={values.status}
          onChange={(e) => {
            set('status', e.target.value)
          }}
          className={inputClass}
        >
          <option value="">全部</option>
          <option value="available">空房</option>
          <option value="booked">已預訂</option>
          <option value="maintenance">整理中</option>
        </select>
      </Field>

      <Field label="查詢期間起" htmlFor="room-start" hint="只填一端視為單日">
        <input
          id="room-start"
          name="startDate"
          type="date"
          value={values.startDate}
          onChange={(e) => {
            set('startDate', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <Field label="查詢期間迄" htmlFor="room-end">
        <input
          id="room-end"
          name="endDate"
          type="date"
          value={values.endDate}
          onChange={(e) => {
            set('endDate', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <div className="flex items-end gap-gap-2 lg:col-span-2">
        <button
          type="submit"
          className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong"
        >
          搜尋
        </button>
        <button
          type="button"
          onClick={() => {
            setHint(null)
            onClear()
          }}
          className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          清除
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 列
// ---------------------------------------------------------------------------
function RoomRow({
  room,
  onEdit,
  onDelete,
  onChanged,
}: {
  room: AdminRoom
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function setStatus(status: RoomStatus) {
    setSaving(true)
    setError(null)
    try {
      await api.admin.rooms.setStatus(room.id, status)
      onChanged()
    } catch (cause) {
      setError(cause)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className={TD}>
        <div className="flex items-center gap-gap-2">
          {room.images[0] ? (
            <img
              src={room.images[0]}
              alt=""
              aria-hidden="true"
              className="size-10 shrink-0 rounded-xs bg-surface-alt object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="size-10 shrink-0 rounded-xs bg-surface-alt"
            />
          )}
          <span>{room.name}</span>
        </div>
        {error != null && (
          <p role="alert" className="mt-gap-1 text-tiny text-danger">
            {messageFor(error).detail}
          </p>
        )}
      </td>
      <td className={TD}>{room.type}</td>
      <td className={TD_NUM}>{formatAmount(room.nightlyPrice)}</td>
      <td className={TD_NUM}>{room.maxGuests}</td>
      <td className={TD}>
        {/* ⚠️ 只有兩個選項。「已預訂」不在這裡，也不該在這裡（FR-051） */}
        <select
          aria-label={`${room.name} 的房態`}
          value={room.status}
          disabled={saving}
          onChange={(e) => {
            void setStatus(e.target.value as RoomStatus)
          }}
          className="rounded-xs border border-line-strong bg-surface px-gap-2 py-gap-1 text-tiny text-ink"
        >
          <option value="available">{ROOM_STATUS_LABELS.available}</option>
          <option value="maintenance">{ROOM_STATUS_LABELS.maintenance}</option>
        </select>
      </td>
      <td className={TD}>
        <span className="text-tiny whitespace-nowrap text-ink-muted">
          {labelOf(AVAILABILITY_LABELS, room.availability)}
        </span>
      </td>
      <td className={TD}>
        <div className="flex gap-gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-xs border border-line-strong px-gap-2 py-gap-1 text-tiny whitespace-nowrap text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            編輯
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-xs border border-line-strong px-gap-2 py-gap-1 text-tiny whitespace-nowrap text-danger transition-colors hover:bg-danger-soft"
          >
            刪除
          </button>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// 新增／編輯
// ---------------------------------------------------------------------------
function RoomForm({
  room,
  onCancel,
  onSaved,
}: {
  room: AdminRoom | null
  onCancel: () => void
  onSaved: () => void
}) {
  const vocabulary = useAsync((signal) => api.vocabulary.get(signal), [])

  const [values, setValues] = useState<RoomWriteInput>(() =>
    room
      ? {
          name: room.name,
          type: room.type,
          maxGuests: room.maxGuests,
          nightlyPrice: room.nightlyPrice,
          description: room.description,
          images: [...room.images],
          amenities: [...room.amenities],
          features: [...room.features],
          status: room.status,
        }
      : BLANK_ROOM,
  )
  /** 本次編輯期間上傳到伺服器的路徑，供取消時清除（FR-050f）。 */
  const [uploaded, setUploaded] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function set<K extends keyof RoomWriteInput>(key: K, value: RoomWriteInput[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  /**
   * 清掉本次上傳但沒有留在 `images` 裡的檔案。
   *
   * 取消時全部都算「沒留下」；儲存成功時只清被移除的那幾張。找不到檔案不是
   * 錯誤，因此這裡不理會失敗——真正要避免的是**沒有人引用的檔案留在磁碟上**，
   * 而那種垃圾不會有任何症狀（FR-050f）。
   */
  const discardUnused = useCallback(
    (keep: readonly string[]) => {
      for (const path of uploaded) {
        if (!keep.includes(path)) void api.admin.photos.discard(path)
      }
    },
    [uploaded],
  )

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      if (room) await api.admin.rooms.update(room.id, values)
      else await api.admin.rooms.create(values)
      discardUnused(values.images)
      onSaved()
    } catch (cause) {
      // MUST NOT 靜默失敗，且已填內容 MUST 保留（FR-083）
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
      className="rounded-lg border border-line-soft bg-surface p-gap-5"
    >
      <h2 className="mb-gap-4 font-display text-h3 text-ink">
        {room ? `編輯房源：${room.name}` : '新增房源'}
      </h2>

      <div className="grid gap-gap-4 sm:grid-cols-2">
        <Field label="房源名稱" htmlFor="name">
          <input
            id="name"
            name="name"
            required
            maxLength={120}
            value={values.name}
            onChange={(e) => {
              set('name', e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="房型" htmlFor="type" hint="例如：雙人房、家庭房">
          <input
            id="type"
            name="type"
            required
            maxLength={60}
            value={values.type}
            onChange={(e) => {
              set('type', e.target.value)
            }}
            className={inputClass}
          />
        </Field>

        <Field label="每晚價格（新臺幣元）" htmlFor="nightlyPrice" hint="整數，不含小數">
          <input
            id="nightlyPrice"
            name="nightlyPrice"
            type="number"
            required
            min={1}
            step={1}
            value={values.nightlyPrice}
            onChange={(e) => {
              set('nightlyPrice', Number(e.target.value))
            }}
            className={inputClass}
          />
        </Field>

        <Field label="可住人數" htmlFor="maxGuests">
          <input
            id="maxGuests"
            name="maxGuests"
            type="number"
            required
            min={1}
            max={20}
            value={values.maxGuests}
            onChange={(e) => {
              set('maxGuests', Number(e.target.value))
            }}
            className={inputClass}
          />
        </Field>

        <Field
          label="房態"
          htmlFor="status"
          hint="「已預訂」由訂單推導，不在此設定"
        >
          <select
            id="status"
            name="status"
            value={values.status}
            onChange={(e) => {
              set('status', e.target.value as RoomStatus)
            }}
            className={inputClass}
          >
            <option value="available">{ROOM_STATUS_LABELS.available}</option>
            <option value="maintenance">{ROOM_STATUS_LABELS.maintenance}</option>
          </select>
        </Field>
      </div>

      <div className="mt-gap-4">
        <Field label="房源介紹" htmlFor="description">
          <textarea
            id="description"
            name="description"
            rows={4}
            maxLength={4000}
            value={values.description}
            onChange={(e) => {
              set('description', e.target.value)
            }}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-gap-5">
        <ImageManager
          images={values.images}
          onChange={(next) => {
            set('images', next)
          }}
          onUploaded={(path) => {
            setUploaded((current) => [...current, path])
          }}
        />
      </div>

      <div className="mt-gap-5 grid gap-gap-4 sm:grid-cols-2">
        <CheckboxGroup
          legend="設施"
          options={vocabulary.data?.amenities ?? []}
          selected={values.amenities}
          onChange={(next) => {
            set('amenities', next)
          }}
        />
        <CheckboxGroup
          legend="房型特色"
          options={vocabulary.data?.features ?? []}
          selected={values.features}
          onChange={(next) => {
            set('features', next)
          }}
        />
      </div>

      {error != null && (
        <p role="alert" className="mt-gap-4 text-small text-danger">
          {messageFor(error).detail}
        </p>
      )}

      <div className="mt-gap-5 flex flex-wrap gap-gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button
          type="button"
          onClick={() => {
            // FR-050f：取消時清掉本次上傳但未保存的檔案
            discardUnused([])
            onCancel()
          }}
          className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          取消
        </button>
      </div>
    </form>
  )
}

/**
 * 詞彙表的多選。
 *
 * ⚠️ **選項為現有詞彙表與目前值的聯集。** 只列詞彙表的話，管理員在系統參數裡
 * 移除某個設施之後，所有還掛著它的房源一編輯就會安靜地掉掉那一項——
 * 沒有提示，儲存後才發現少了東西。
 */
function CheckboxGroup({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string
  options: readonly string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const all = useMemo(() => [...new Set([...options, ...selected])], [options, selected])

  return (
    <fieldset className="rounded-lg border border-line-soft p-gap-3">
      <legend className="px-gap-1 text-small text-ink-muted">{legend}</legend>
      {all.length === 0 ? (
        <p className="text-tiny text-ink-muted">
          尚未設定可選項目。可於「系統與參數設定」新增。
        </p>
      ) : (
        <div className="flex flex-wrap gap-gap-3">
          {all.map((item) => (
            <label key={item} className="flex items-center gap-gap-1 text-small text-ink">
              <input
                type="checkbox"
                checked={selected.includes(item)}
                onChange={(e) => {
                  onChange(
                    e.target.checked ? [...selected, item] : selected.filter((v) => v !== item),
                  )
                }}
                className="accent-brand"
              />
              {item}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// 刪除
// ---------------------------------------------------------------------------
/**
 * 刪除前的影響範圍與二次確認（FR-052）。
 *
 * ⚠️ 這個畫面**不是**安全機制。後端不帶 `confirm=true` 一律拒絕，
 * 因此就算有人直接呼叫 API 也不會誤刪——這裡負責的是「讓人看得到代價」。
 */
function DeletePanel({
  room,
  onCancel,
  onDeleted,
}: {
  room: AdminRoom
  onCancel: () => void
  onDeleted: () => void
}) {
  const affected = useAsync<AffectedOrder[]>(
    (signal) => api.admin.rooms.affectedOrders(room.id, signal),
    [room.id],
  )
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function confirm() {
    setDeleting(true)
    setError(null)
    try {
      await api.admin.rooms.remove(room.id, true)
      onDeleted()
    } catch (cause) {
      // 例如 `ROOM_HAS_ORDER_HISTORY`：有歷史訂單時二次確認也沒有用，
      // 後端會說明理由並建議改設為「整理中」
      setError(cause)
      setDeleting(false)
    }
  }

  return (
    <section className="rounded-lg border border-danger/20 bg-danger-soft p-gap-5">
      <h2 className="font-display text-h3 text-danger">刪除房源：{room.name}</h2>

      {affected.loading ? (
        <LoadingState label="檢查影響範圍…" />
      ) : affected.error ? (
        <ErrorState error={affected.error} onRetry={affected.reload} />
      ) : affected.data && affected.data.length > 0 ? (
        <>
          <p className="mt-gap-3 text-body text-ink">
            此房源尚有 {affected.data.length} 筆未結束的訂單。刪除後這些訂單將失去對應房源。
          </p>
          <ul className="mt-gap-3 space-y-gap-1">
            {affected.data.map((order) => (
              <li key={order.id} className="text-small text-ink-muted">
                <span className="font-mono">{order.orderNo}</span>
                {` ${order.contactName}／`}
                {formatDisplayDate(order.checkIn)} – {formatDisplayDate(order.checkOut)}
                {`／${labelOf(ORDER_STATUS_LABELS, order.status)}`}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-gap-3 text-body text-ink">
          此房源目前沒有未結束的訂單。刪除後無法復原。
        </p>
      )}

      {error != null && (
        <p role="alert" className="mt-gap-3 text-small text-danger">
          {messageFor(error).detail}
        </p>
      )}

      <div className="mt-gap-5 flex flex-wrap gap-gap-3">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={deleting}
          className="rounded-pill bg-danger px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-danger/90 disabled:opacity-50"
        >
          {deleting ? '刪除中…' : '確認刪除'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-pill border border-line-strong bg-surface px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          取消
        </button>
      </div>
    </section>
  )
}
