/**
 * T128：訂單管理（FR-053、FR-054）。
 *
 * ## 「—」與「0」是兩件事
 *
 * `conversionRate` 與 `averageOrderValue` 在系統無訂單時為 `null`
 * （`schemas/admin.py`），畫面顯示「—」。**MUST NOT 當成 0**：0% 成交率會被
 * 讀成「來了很多人但一筆都沒成交」，而實際上是還沒有人下單過——那兩件事會
 * 導向完全相反的決定。
 *
 * ## 兩種取消要分得開
 *
 * 「未付款取消」把逾時未付款與會員主動取消加在一起（FR-035a 要求兩者可區分）。
 * 因此列表上的每一筆都顯示它自己的取消原因，指標只給總數。
 *
 * ## 日期區間比對的是入住日
 *
 * 不是下訂日。業者查「這個週末有誰要來」時想的是入住，而含頭含尾
 * （`routers/admin_orders.py`）——迄日當天入住的那幾筆算在裡面。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { AdminOrder, AdminOrderFilters, OrderStatus } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { messageFor } from '../../lib/errors'
import {
  cancelReasonLabel,
  ORDER_STATUSES,
  orderStatusLabel,
  orderStatusTone,
} from '../../lib/labels'
import { formatTWD } from '../../lib/money'
import { panelClass } from '../../lib/surfaces'
import {
  Badge,
  buttonClass,
  Field,
  FilterBar,
  inputClass,
  ModuleHeading,
  Notice,
  TableShell,
  Td,
  Th,
} from './ui'

const EMPTY: AdminOrderFilters = {}

/** 成交率。⚠️ `null` MUST 顯示為「—」，MUST NOT 顯示 0%。 */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate.toFixed(1)}%`
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${panelClass} p-gap-3`}>
      <p className="text-tiny text-ink-muted">{label}</p>
      <p className="mt-gap-1 font-display text-h3 tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-gap-1 text-tiny text-ink-muted">{hint}</p>}
    </div>
  )
}

function Stats() {
  const load = useCallback((signal: AbortSignal) => api.admin.orders.stats(signal), [])
  const { data, status, error, reload } = useAsync(load)

  if (status === 'error') return <ErrorState error={error} onRetry={reload} title="無法載入指標" />
  if (!data) return <LoadingState label="載入營運指標…" />

  return (
    <section aria-label="營運指標" className="mt-gap-4 grid gap-gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Metric label="訂單總數" value={String(data.totalOrders)} hint="含各種狀態" />
      <Metric label="已成立" value={String(data.placedOrders)} hint="不含已取消" />
      <Metric label="已付款" value={String(data.paidOrders)} />
      <Metric
        label="未付款取消"
        value={String(data.unpaidCancelledOrders)}
        hint="逾時與會員取消合計"
      />
      <Metric label="成交率" value={formatRate(data.conversionRate)} hint="已付款 ÷ 已成立" />
      <Metric
        label="總營業額"
        value={formatTWD(data.revenue)}
        hint={`平均客單價 ${data.averageOrderValue === null ? '—' : formatTWD(data.averageOrderValue)}`}
      />
    </section>
  )
}

export function Orders() {
  const [draft, setDraft] = useState<AdminOrderFilters>(EMPTY)
  const [filters, setFilters] = useState<AdminOrderFilters>(EMPTY)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [statsKey, setStatsKey] = useState(0)
  const ids = useId()

  const load = useCallback(
    (signal: AbortSignal) => api.admin.orders.search(filters, signal),
    [filters],
  )
  const { status, data, error, reload } = useAsync<AdminOrder[]>(load)

  async function changeStatus(order: AdminOrder, next: OrderStatus) {
    setMessage(null)
    setFailure(null)
    try {
      await api.admin.orders.setStatus(order.id, next)
      setMessage(`訂單 ${order.orderNo} 已改為「${orderStatusLabel(next)}」。`)
      reload()
      // 指標跟著變。不重載的話業者會看到「已付款 3」但列表上有四筆已付款。
      setStatsKey((n) => n + 1)
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    }
  }

  return (
    <div>
      {/* ⚠️ 帶入的是**已套用**的篩選，不是輸入中的 `draft`——匯出的筆數
          MUST 等於畫面上的筆數（SC-033）。 */}
      <ModuleHeading
        title="訂單管理"
        actions={
          <ExportButton
            module="orders"
            params={{
              orderNo: filters.orderNo,
              status: filters.status,
              roomId: filters.roomId,
              startDate: filters.startDate,
              endDate: filters.endDate,
            }}
          />
        }
      />

      {/* `key` 讓狀態變更後的重新掛載真的重新取數，而不是沿用舊的指標。 */}
      <Stats key={statsKey} />

      <FilterBar
        onReset={() => {
          setDraft(EMPTY)
          setFilters(EMPTY)
        }}
      >
        <Field label="訂單編號" htmlFor={`${ids}-no`}>
          <input
            id={`${ids}-no`}
            value={draft.orderNo ?? ''}
            placeholder="SN…"
            onChange={(e) => {
              setDraft({ ...draft, orderNo: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="狀態" htmlFor={`${ids}-status`}>
          <select
            id={`${ids}-status`}
            value={draft.status ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setDraft({ ...draft, status: value === '' ? undefined : (value as OrderStatus) })
            }}
            className={inputClass}
          >
            <option value="">全部</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {orderStatusLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="入住起日" htmlFor={`${ids}-start`} className="w-44">
          <input
            id={`${ids}-start`}
            type="date"
            value={draft.startDate ?? ''}
            onChange={(e) => {
              setDraft({ ...draft, startDate: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="入住迄日" htmlFor={`${ids}-end`} className="w-44">
          <input
            id={`${ids}-end`}
            type="date"
            value={draft.endDate ?? ''}
            onChange={(e) => {
              setDraft({ ...draft, endDate: e.target.value })
            }}
            className={inputClass}
          />
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
      {failure !== null && <Notice tone="danger">{failure}</Notice>}

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入訂單…" />
      ) : data.length === 0 ? (
        <EmptyState title="沒有符合條件的訂單" hint="換一組日期或清除條件後再試一次。" />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>訂單編號</Th>
              <Th>房源</Th>
              <Th>入住 / 退房</Th>
              <Th align="right">夜數</Th>
              <Th>聯絡人</Th>
              <Th align="right">金額</Th>
              <Th>狀態</Th>
              <Th>變更狀態</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((order) => (
              <tr key={order.id}>
                <Td>
                  <span className="font-mono text-tiny text-ink">{order.orderNo}</span>
                </Td>
                <Td>{order.roomName ?? '（房源已刪除）'}</Td>
                <Td>
                  {order.checkIn} → {order.checkOut}
                </Td>
                <Td align="right">{order.nights}</Td>
                <Td>
                  {order.contactName}
                  <span className="block text-tiny text-ink-muted">{order.phone}</span>
                </Td>
                <Td align="right">{formatTWD(order.totalAmount)}</Td>
                <Td>
                  <Badge tone={orderStatusTone(order.status)}>
                    {orderStatusLabel(order.status)}
                  </Badge>
                  {/* ⚠️ 兩種取消 MUST 可區分（FR-035a）。 */}
                  {order.cancelReason !== null && (
                    <span className="mt-gap-1 block text-tiny text-ink-muted">
                      {cancelReasonLabel(order.cancelReason)}
                    </span>
                  )}
                </Td>
                <Td>
                  {/*
                    每一次變更都會寫入稽核日誌（FR-054、`routers/admin_orders.py`）。
                    因此這裡刻意沒有「批次變更」——一次改十筆會產生十筆看起來
                    一模一樣的日誌，而事後沒有人分得出那是不是誤操作。
                  */}
                  <label className="sr-only" htmlFor={`${ids}-set-${order.id}`}>
                    變更 {order.orderNo} 的狀態
                  </label>
                  <select
                    id={`${ids}-set-${order.id}`}
                    value=""
                    onChange={(e) => {
                      const next = e.target.value
                      if (next !== '') void changeStatus(order, next as OrderStatus)
                    }}
                    className={inputClass}
                  >
                    <option value="">選擇…</option>
                    {ORDER_STATUSES.filter((value) => value !== order.status).map((value) => (
                      <option key={value} value={value}>
                        {orderStatusLabel(value)}
                      </option>
                    ))}
                  </select>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  )
}
