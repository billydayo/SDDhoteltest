/**
 * T128：後台訂單管理——搜尋、篩選與營運指標（FR-053、FR-054）。
 *
 * ## 指標是全站的，不是篩選結果的
 *
 * ⚠️ 六個指標來自 `GET /admin/orders/stats`，**與下方的篩選條件無關**。
 * 這是刻意的：成交率與平均客單價要拿全站的分母才有意義，篩出「八月的已取消
 * 訂單」再算成交率會得到 0%，而那個數字沒有任何意義。
 *
 * 但這件事在畫面上看不出來——指標區塊就在篩選列上方，任何人都會預設它們連動。
 * 因此標題明寫「全站累計」。少了那三個字，管理員會拿一個他以為是篩選結果的
 * 數字去做決策。
 *
 * ## 成交率與平均客單價的 `null`
 *
 * 無訂單時後端回 `null` 而非 0（T117）。`StatTile` 會把它渲染成「—」。
 * **MUST NOT 在這裡用 `?? 0` 補上預設值**——那正是 T117 要防的事。
 *
 * ## 狀態變更
 *
 * 每一次變更都由後端寫入 `admin_logs`（FR-054、T122），因此介面上提供備註欄：
 * 三個月後有人問「這筆訂單為什麼被改成已取消」，日誌裡有備註才答得出來。
 */
import { useCallback, useMemo, useState } from 'react'

import { api } from '../../api/client'
import type { AdminOrder, AdminOrderSearchParams, OrderStatus } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Field } from '../../components/Field'
import { LoadingState } from '../../components/LoadingState'
import { StatTile } from '../../components/StatTile'
import { TD, TD_NUM, TH, TableScroll } from '../../components/TableScroll'
import { formatDisplayDate, formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { inputClass } from '../../lib/form'
import {
  CANCEL_REASON_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  labelOf,
} from '../../lib/labels'
import { formatAmount, formatTWD } from '../../lib/money'
import { useAsync } from '../../lib/useAsync'
import { AdminPageHeader } from './AdminLayout'

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]

interface Filters {
  orderNo: string
  status: string
  roomId: string
  startDate: string
  endDate: string
}

const EMPTY_FILTERS: Filters = {
  orderNo: '',
  status: '',
  roomId: '',
  startDate: '',
  endDate: '',
}

/**
 * 表單值 → 查詢參數。**空字串 MUST NOT 被送出**。
 *
 * `?status=` 這種空值查詢在後端是「篩選狀態等於空字串」，結果是零筆——
 * 而使用者只是沒有選那一欄。逐欄判斷（與 `lib/filters.ts` 同一個作法）
 * 讓「沒填」與「填了空的」不會變成同一件事。
 */
function toQuery(values: Filters): AdminOrderSearchParams {
  const query: AdminOrderSearchParams = {}
  if (values.orderNo.trim()) query.orderNo = values.orderNo.trim()
  if (values.status) query.status = values.status
  if (values.roomId) query.roomId = values.roomId
  if (values.startDate) query.startDate = values.startDate
  if (values.endDate) query.endDate = values.endDate
  return query
}

export function AdminOrders() {
  /** 編輯中的表單值。改動它**不會**觸發查詢——按下「搜尋」才會。 */
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  /** 上一次送出的條件。查詢只看這個。 */
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS)

  const stats = useAsync((signal) => api.admin.orders.stats(signal), [])
  const rooms = useAsync((signal) => api.admin.rooms.list({}, signal), [])
  const orders = useAsync(
    (signal) => api.admin.orders.list(toQuery(applied), signal),
    [JSON.stringify(applied)],
  )

  const reloadAll = useCallback(() => {
    orders.reload()
    stats.reload()
  }, [orders, stats])

  return (
    <div>
      <AdminPageHeader title="訂單管理" description="搜尋訂單、檢視營運指標與變更訂單狀態。" />

      <Metrics stats={stats.data} loading={stats.loading} />

      <FilterForm
        values={filters}
        rooms={rooms.data ?? []}
        onChange={setFilters}
        onSearch={() => {
          setApplied(filters)
        }}
        onClear={() => {
          setFilters(EMPTY_FILTERS)
          setApplied(EMPTY_FILTERS)
        }}
      />

      <Results state={orders} onChanged={reloadAll} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 指標
// ---------------------------------------------------------------------------
function Metrics({
  stats,
  loading,
}: {
  stats: import('../../api/types').OrderStats | null
  loading: boolean
}) {
  if (loading && !stats) return <LoadingState label="載入營運指標…" />
  if (!stats) return null

  return (
    <section aria-labelledby="metrics" className="mb-gap-6">
      <h2 id="metrics" className="mb-gap-3 text-small text-ink-muted">
        營運指標（全站累計，不受下方篩選條件影響）
      </h2>
      <div className="grid gap-gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="訂單總數" value={stats.totalOrders} />
        <StatTile label="已付款訂單數" value={stats.paidOrders} />
        <StatTile
          label="未付款取消數"
          value={stats.unpaidCancelledOrders}
          hint="含逾時未付與會員自行取消"
        />
        <StatTile label="總營業額" value={formatTWD(stats.revenue)} />
        {/* ⚠️ null MUST NOT 補成 0：那會被讀成「一筆都沒成交」（T117） */}
        <StatTile
          label="成交率"
          value={stats.conversionRate === null ? null : `${(stats.conversionRate * 100).toFixed(1)}%`}
          hint={stats.conversionRate === null ? '尚無訂單，無法計算' : '已付款 ÷ 訂單總數'}
        />
        <StatTile
          label="平均客單價"
          value={stats.averageOrderValue === null ? null : formatTWD(stats.averageOrderValue)}
          hint={
            stats.averageOrderValue === null ? '尚無訂單，無法計算' : '總營業額 ÷ 已付款訂單數'
          }
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 篩選
// ---------------------------------------------------------------------------
function FilterForm({
  values,
  rooms,
  onChange,
  onSearch,
  onClear,
}: {
  values: Filters
  rooms: readonly { id: string; name: string }[]
  onChange: (next: Filters) => void
  onSearch: () => void
  onClear: () => void
}) {
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...values, [key]: value })
  }

  return (
    <form
      className="mb-gap-5 grid gap-gap-3 rounded-lg border border-line-soft bg-surface p-gap-4 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch()
      }}
    >
      <Field label="訂單編號" htmlFor="orderNo">
        <input
          id="orderNo"
          name="orderNo"
          value={values.orderNo}
          onChange={(e) => {
            set('orderNo', e.target.value)
          }}
          className={inputClass}
          placeholder="SN20260804001"
        />
      </Field>

      <Field label="訂單狀態" htmlFor="status">
        <select
          id="status"
          name="status"
          value={values.status}
          onChange={(e) => {
            set('status', e.target.value)
          }}
          className={inputClass}
        >
          <option value="">全部</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="房源" htmlFor="roomId">
        <select
          id="roomId"
          name="roomId"
          value={values.roomId}
          onChange={(e) => {
            set('roomId', e.target.value)
          }}
          className={inputClass}
        >
          <option value="">全部</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="入住日期起" htmlFor="startDate">
        <input
          id="startDate"
          name="startDate"
          type="date"
          value={values.startDate}
          onChange={(e) => {
            set('startDate', e.target.value)
          }}
          className={inputClass}
        />
      </Field>

      <Field label="入住日期迄" htmlFor="endDate">
        <input
          id="endDate"
          name="endDate"
          type="date"
          value={values.endDate}
          onChange={(e) => {
            set('endDate', e.target.value)
          }}
          className={inputClass}
        />
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
          onClick={onClear}
          className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
        >
          清除
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------
function Results({
  state,
  onChanged,
}: {
  state: import('../../lib/useAsync').AsyncState<AdminOrder[]>
  onChanged: () => void
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />
  if (state.loading && !state.data) return <LoadingState label="載入訂單…" />
  if (state.data?.length === 0) {
    return <EmptyState title="沒有符合條件的訂單" hint="試著放寬日期區間或清除狀態篩選。" />
  }

  return (
    <>
      <p aria-live="polite" className="mb-gap-2 text-small text-ink-muted">
        共 {state.data?.length ?? 0} 筆訂單
      </p>
      <TableScroll label="訂單清單">
        <table className="w-full border-collapse">
          <thead className="border-b border-line-soft bg-surface-alt">
            <tr>
              <th className={TH}>訂單編號</th>
              <th className={TH}>房源</th>
              <th className={TH}>住宿期間</th>
              <th className={TH}>人數</th>
              <th className={TH}>聯絡人</th>
              <th className={TH}>付款方式</th>
              <th className={`${TH} text-right`}>金額</th>
              <th className={TH}>狀態</th>
              <th className={TH}>建立時間</th>
              <th className={TH}>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.data?.map((order) => (
              <OrderRow key={order.id} order={order} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  )
}

function OrderRow({ order, onChanged }: { order: AdminOrder; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)

  return (
    <>
      <tr className="border-b border-line-soft last:border-0">
        <td className={`${TD} font-mono whitespace-nowrap`}>{order.orderNo}</td>
        <td className={TD}>{order.roomName ?? '—'}</td>
        <td className={`${TD} whitespace-nowrap`}>
          {formatDisplayDate(order.checkIn)} – {formatDisplayDate(order.checkOut)}
          <span className="block text-tiny text-ink-muted">{order.nights} 晚</span>
        </td>
        <td className={TD_NUM}>{order.guestCount}</td>
        <td className={TD}>
          {order.contactName}
          {/* 電話與信箱是業者聯繫客人的唯一途徑，但不必占一整欄 */}
          <span className="block text-tiny text-ink-muted">{order.phone}</span>
        </td>
        <td className={TD}>{labelOf(PAYMENT_METHOD_LABELS, order.paymentMethod)}</td>
        <td className={TD_NUM}>{formatAmount(order.totalAmount)}</td>
        <td className={TD}>
          <StatusBadge status={order.status} cancelReason={order.cancelReason} />
        </td>
        <td className={`${TD} whitespace-nowrap`}>{formatTimestamp(order.createdAt)}</td>
        <td className={TD}>
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v)
            }}
            aria-expanded={editing}
            className="rounded-xs border border-line-strong px-gap-2 py-gap-1 text-tiny text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            {editing ? '取消' : '變更狀態'}
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-line-soft bg-surface-alt">
          <td colSpan={10} className="px-gap-3 py-gap-3">
            <StatusForm
              order={order}
              onDone={() => {
                setEditing(false)
                onChanged()
              }}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function StatusBadge({
  status,
  cancelReason,
}: {
  status: OrderStatus
  cancelReason: AdminOrder['cancelReason']
}) {
  return (
    <span className="whitespace-nowrap">
      <span
        className={`rounded-pill px-gap-2 py-gap-1 text-tiny ${labelOf(ORDER_STATUS_TONES, status)}`}
      >
        {labelOf(ORDER_STATUS_LABELS, status)}
      </span>
      {/* FR-035a：逾時未付與會員自行取消 MUST 可區分 */}
      {cancelReason && (
        <span className="mt-gap-1 block text-tiny text-ink-muted">
          {labelOf(CANCEL_REASON_LABELS, cancelReason)}
        </span>
      )}
    </span>
  )
}

/**
 * 狀態變更表單。
 *
 * 送出中時停用按鈕：連按兩次會送出兩次 PATCH，日誌裡就會出現兩筆看似重複的
 * 變更紀錄，而看紀錄的人得自己判斷那是誤點還是真的改了兩次。
 */
function StatusForm({ order, onDone }: { order: AdminOrder; onDone: () => void }) {
  const [status, setStatus] = useState<OrderStatus>(order.status)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const unchanged = status === order.status
  const message = useMemo(() => (error ? messageFor(error) : null), [error])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.admin.orders.setStatus(order.id, { status, ...(note ? { note } : {}) })
      onDone()
    } catch (cause) {
      // ⚠️ MUST NOT 靜默失敗（FR-084）。失敗時保留表單內容，讓他改完再送一次。
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
      <div>
        <label htmlFor={`status-${order.id}`} className="mb-gap-1 block text-tiny text-ink-muted">
          新狀態
        </label>
        <select
          id={`status-${order.id}`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrderStatus)
          }}
          className={inputClass}
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-64 flex-1">
        <label htmlFor={`note-${order.id}`} className="mb-gap-1 block text-tiny text-ink-muted">
          備註（會寫進操作日誌）
        </label>
        <input
          id={`note-${order.id}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
          }}
          maxLength={500}
          className={inputClass}
          placeholder="例如：客人來電要求改期，改由新訂單承接"
        />
      </div>

      <button
        type="submit"
        disabled={saving || unchanged}
        className="rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? '儲存中…' : '確認變更'}
      </button>

      {unchanged && <p className="text-tiny text-ink-muted">狀態未變更</p>}
      {message && (
        <p role="alert" className="w-full text-small text-danger">
          {message.detail}
        </p>
      )}
    </form>
  )
}
