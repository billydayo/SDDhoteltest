/**
 * T135：退款審核（FR-038、FR-039、FR-041、FR-057）。
 *
 * ## 金額不重算
 *
 * 顯示的是申請當下**分級後**的實付退款額（`schemas/moderation.py`）。
 * 距入住日的天數會隨時間變動，前端若自己按今天的日期重算一次，管理員看到的
 * 數字就會與申請人當初被告知的不同——爭議正是這樣產生的。
 *
 * ## 核准與駁回的後果不一樣，畫面要說出來
 *
 * - **核准** → 訂單轉 `refunded` 並**立即釋回該區間**，下一次搜尋就能訂到
 * - **駁回** → 訂單回到 `confirmed`，而且會員**可以再次申請**
 *
 * 只寫「核准／駁回」兩個字的話，業者不會知道駁回並不是「結案」。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { Refund, RefundFilters, RefundStatus } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { moderationTone, refundStatusLabel } from '../../lib/labels'
import { formatTWD } from '../../lib/money'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
} from './ui'

const TABS: { value: RefundStatus | ''; label: string }[] = [
  { value: 'pending', label: '待審核' },
  { value: 'approved', label: '已核准' },
  { value: 'rejected', label: '已駁回' },
  { value: '', label: '全部' },
]

function RefundCard({
  refund,
  onChanged,
  onFailed,
}: {
  refund: Refund
  onChanged: (message: string) => void
  onFailed: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ids = useId()

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    try {
      await api.admin.refunds.decide(refund.id, { decision, ...(note ? { note } : {}) })
      onChanged(
        decision === 'approve'
          ? `已核准 ${refund.orderNo ?? '該筆'} 的退款，該區間已釋回。`
          : `已駁回 ${refund.orderNo ?? '該筆'} 的退款，訂單回到已確認。`,
      )
    } catch (cause) {
      onFailed(messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-base border border-line-soft bg-surface p-gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-gap-2">
        <div>
          <h3 className="text-md text-ink">
            <span className="font-mono text-small">{refund.orderNo ?? '（訂單已刪除）'}</span>
          </h3>
          <p className="text-tiny text-ink-muted">
            申請人：{refund.applicantName ?? '（會員已刪除）'}．申請於{' '}
            {formatTimestamp(refund.createdAt)}
          </p>
          {refund.checkIn !== null && refund.checkOut !== null && (
            <p className="text-tiny text-ink-muted">
              住宿區間：{refund.checkIn} → {refund.checkOut}
            </p>
          )}
        </div>
        <div className="text-right">
          <Badge tone={moderationTone(refund.status)}>{refundStatusLabel(refund.status)}</Badge>
          <p className="mt-gap-1 font-display text-h3 tabular-nums text-ink">
            {formatTWD(refund.amount)}
          </p>
          {/* FR-041：金額是申請當下依規則分級後算定的，不隨時間改變。 */}
          <p className="text-tiny text-ink-muted">申請當下分級後金額</p>
        </div>
      </div>

      <p className="mt-gap-3 whitespace-pre-line text-body text-ink">{refund.reason}</p>

      {refund.adminNote !== null && (
        <p className="mt-gap-2 text-small text-ink-muted">審核備註：{refund.adminNote}</p>
      )}
      {refund.reviewedAt !== null && (
        <p className="mt-gap-1 text-tiny text-ink-muted">
          審核於 {formatTimestamp(refund.reviewedAt)}
        </p>
      )}

      {refund.status === 'pending' && (
        <>
          <div className="mt-gap-3">
            <Field label="審核備註（選填）" htmlFor={`${ids}-note`} className="w-full">
              <input
                id={`${ids}-note`}
                value={note}
                maxLength={500}
                onChange={(e) => {
                  setNote(e.target.value)
                }}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-gap-3 flex flex-wrap items-center gap-gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void decide('approve')
              }}
              className={primaryButtonClass}
            >
              核准退款
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void decide('reject')
              }}
              className={buttonClass}
            >
              駁回
            </button>
            <span className="text-tiny text-ink-muted">
              核准後該區間立即釋回；駁回後訂單回到已確認，會員仍可再次申請。
            </span>
          </div>
        </>
      )}
    </article>
  )
}

export function Refunds() {
  const [tab, setTab] = useState<RefundStatus | ''>('pending')
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(
    (signal: AbortSignal) => {
      const filters: RefundFilters = tab === '' ? {} : { status: tab }
      return api.admin.refunds.list(filters, signal)
    },
    [tab],
  )
  const { status, data, error, reload } = useAsync<Refund[]>(load)

  function changed(text: string) {
    setMessage(text)
    setFailure(null)
    reload()
  }

  return (
    <div>
      <ModuleHeading
        title="退款審核"
        actions={<ExportButton module="refunds" params={tab === '' ? {} : { status: tab }} />}
      />

      <div className="mt-gap-4 flex flex-wrap gap-gap-2" role="group" aria-label="依狀態篩選">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => {
              setTab(item.value)
            }}
            className={
              tab === item.value
                ? 'rounded-pill bg-brand px-gap-4 py-gap-2 text-small text-ink-invert'
                : buttonClass
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {message !== null && <Notice tone="ok">{message}</Notice>}
      {failure !== null && <Notice tone="danger">{failure}</Notice>}

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入退款申請…" />
      ) : data.length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? '目前沒有待審核的退款申請' : '這個分頁沒有退款申請'}
          hint={
            tab === 'pending'
              ? '會員送出申請後會出現在這裡，並附上申請當下分級後的退款金額。'
              : '換一個分頁看看，或稍後再回來。'
          }
        />
      ) : (
        <div className="mt-gap-4 grid gap-gap-3">
          {data.map((refund) => (
            <RefundCard key={refund.id} refund={refund} onChanged={changed} onFailed={setFailure} />
          ))}
        </div>
      )}
    </div>
  )
}
