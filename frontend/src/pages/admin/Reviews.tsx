/**
 * T134：評論審核（FR-056、FR-103a ~ FR-103d）。
 *
 * ## 自動審核給的是**初判與依據**，不是結論
 *
 * 每一則都顯示判定（`autoVerdict`）**與觸發的規則**（`autoRules`）。只給結論
 * 不給依據的話，覆寫就變成憑感覺推翻——那跟沒有初判是一樣的（FR-103b）。
 *
 * ⚠️ **介面上 MUST 標示為「自動審核（規則式）」，MUST NOT 描述為 AI**
 * （FR-103a、憲章原則 VI）。這不是措辭潔癖：說成 AI 會讓業者以為它讀得懂
 * 語意，而它只是一組關鍵字規則。
 *
 * ## 回覆入口只在「已通過」時出現（FR-103d）
 *
 * 待審核與已駁回的評論**沒有回覆入口**。對一則還沒公開的評論寫公開回覆，
 * 業者會以為客人看得到，而實際上沒有任何人看得到。
 *
 * 清空內容送出**等同收回**——不另設一個「收回」按鈕，因為那會變成兩條路徑，
 * 而其中一條遲早會漏掉稽核紀錄。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { AdminReview, AdminReviewFilters, ReviewStatus } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { autoVerdictLabel, moderationTone, reviewStatusLabel } from '../../lib/labels'
import {
  Badge,
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
} from './ui'

const TABS: { value: ReviewStatus | ''; label: string }[] = [
  { value: 'pending', label: '待審核' },
  { value: 'approved', label: '已通過' },
  { value: 'rejected', label: '已駁回' },
  { value: '', label: '全部' },
]

function Stars({ rating }: { rating: number }) {
  // 星星是裝飾，真正被宣讀的是 `aria-label`——一排「★★★☆☆」對讀屏使用者
  // 只是五個符號（憲章原則 V）。
  return (
    <span aria-label={`${String(rating)} 分，滿分 5 分`} className="text-brand-accent">
      <span aria-hidden="true">{'★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// 一則評論
// ---------------------------------------------------------------------------
function ReviewCard({
  review,
  onChanged,
  onFailed,
}: {
  review: AdminReview
  onChanged: (message: string) => void
  onFailed: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const [reply, setReply] = useState(review.adminReply ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const ids = useId()

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      onChanged(success)
    } catch (cause) {
      onFailed(messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  const decide = (status: ReviewStatus, verb: string) =>
    run(
      () => api.admin.reviews.decide(review.id, { status, ...(note ? { note } : {}) }),
      `已${verb}「${review.roomName ?? '房源'}」的評論。`,
    )

  const trimmedReply = reply.trim()
  const replyChanged = trimmedReply !== (review.adminReply ?? '')

  return (
    <article className="rounded-base border border-line-soft bg-surface p-gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-gap-2">
        <div>
          <h3 className="text-md text-ink">{review.roomName ?? '（房源已刪除）'}</h3>
          <p className="text-tiny text-ink-muted">
            {review.userName ?? '（會員已刪除）'}．{formatTimestamp(review.createdAt)}．
            {review.category}
          </p>
        </div>
        <div className="flex items-center gap-gap-2">
          <Stars rating={review.rating} />
          <Badge tone={moderationTone(review.status)}>{reviewStatusLabel(review.status)}</Badge>
        </div>
      </div>

      <p className="mt-gap-3 whitespace-pre-line text-body text-ink">{review.comment}</p>

      {/* ⚠️ 規則式，MUST NOT 稱為 AI（FR-103a）。 */}
      <div className="mt-gap-3 rounded-base bg-surface-alt px-gap-3 py-gap-2 text-small">
        <p className="text-ink-muted">
          自動審核（規則式）：
          <span className="text-ink">
            {review.autoVerdict === null ? '尚未初判' : autoVerdictLabel(review.autoVerdict)}
          </span>
        </p>
        {review.autoRules.length > 0 ? (
          <p className="mt-gap-1 text-ink-muted">觸發規則：{review.autoRules.join('、')}</p>
        ) : (
          <p className="mt-gap-1 text-ink-muted">未觸發任何規則。</p>
        )}
        {review.adminNote !== null && (
          <p className="mt-gap-1 text-ink-muted">審核備註：{review.adminNote}</p>
        )}
      </div>

      <div className="mt-gap-3 flex flex-wrap items-end gap-gap-2">
        <Field label="審核備註（選填）" htmlFor={`${ids}-note`} className="min-w-56 flex-1">
          <input
            id={`${ids}-note`}
            value={note}
            maxLength={500}
            placeholder="覆寫自動判定時，寫下原因會讓日後查閱有依據"
            onChange={(e) => {
              setNote(e.target.value)
            }}
            className={inputClass}
          />
        </Field>
        {review.status !== 'approved' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void decide('approved', '通過')
            }}
            className={primaryButtonClass}
          >
            通過
          </button>
        )}
        {review.status !== 'rejected' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void decide('rejected', '駁回')
            }}
            className={buttonClass}
          >
            駁回
          </button>
        )}
        {review.status !== 'pending' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void decide('pending', '退回待審')
            }}
            className={buttonClass}
          >
            退回待審
          </button>
        )}
      </div>

      {/* FR-103d：只有已公開的評論才有回覆入口。 */}
      {review.status === 'approved' && (
        <div className="mt-gap-3 border-t border-line-soft pt-gap-3">
          <Field
            label="業者公開回覆"
            htmlFor={`${ids}-reply`}
            className="w-full"
            hint="清空後送出即為收回。回覆會公開顯示在房源詳情頁。"
          >
            <textarea
              id={`${ids}-reply`}
              rows={2}
              maxLength={1000}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value)
              }}
              className={inputClass}
            />
          </Field>
          <div className="mt-gap-2 flex items-center gap-gap-2">
            <button
              type="button"
              disabled={busy || !replyChanged}
              onClick={() => {
                void run(
                  () =>
                    api.admin.reviews.setReply(review.id, {
                      reply: trimmedReply === '' ? null : trimmedReply,
                    }),
                  trimmedReply === '' ? '已收回業者回覆。' : '已更新業者回覆。',
                )
              }}
              className={primaryButtonClass}
            >
              {trimmedReply === '' ? '收回回覆' : review.adminReply === null ? '送出回覆' : '更新回覆'}
            </button>
            {review.adminReplyAt !== null && (
              <span className="text-tiny text-ink-muted">
                上次回覆於 {formatTimestamp(review.adminReplyAt)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ⚠️ 刪除不可逆，且會重新計算房源平均評分（FR-103c）。 */}
      <div className="mt-gap-3 border-t border-line-soft pt-gap-3">
        {confirmingDelete ? (
          <div role="alertdialog" aria-label="刪除評論" className="flex flex-wrap items-center gap-gap-2">
            <span className="text-small text-danger">
              刪除後無法復原，且該房源的平均評分會重新計算。
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(() => api.admin.reviews.remove(review.id), '已刪除該則評論。')
              }}
              className={dangerButtonClass}
            >
              確定刪除
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false)
              }}
              className={buttonClass}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(true)
            }}
            className={dangerButtonClass}
          >
            刪除評論
          </button>
        )}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export function Reviews() {
  const [tab, setTab] = useState<ReviewStatus | ''>('pending')
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(
    (signal: AbortSignal) => {
      const filters: AdminReviewFilters = tab === '' ? {} : { status: tab }
      return api.admin.reviews.list(filters, signal)
    },
    [tab],
  )
  const { status, data, error, reload } = useAsync<AdminReview[]>(load)

  function changed(text: string) {
    setMessage(text)
    setFailure(null)
    reload()
  }

  return (
    <div>
      <ModuleHeading
        title="評論審核"
        actions={<ExportButton module="reviews" params={tab === '' ? {} : { status: tab }} />}
      />

      {/* 分頁用 `tablist` 的語意會需要完整的鍵盤模型；這裡是一組互斥的篩選，
          用一般按鈕加 `aria-pressed` 即可，而且行為對鍵盤使用者是標準的。 */}
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
        <LoadingState label="載入評論…" />
      ) : data.length === 0 ? (
        // 引導性空狀態：說出「這是好事」而不是只留一片空白（FR-018 的同一個道理）。
        <EmptyState
          title={tab === 'pending' ? '目前沒有待審核的評論' : '這個分頁沒有評論'}
          hint={
            tab === 'pending'
              ? '新的評論送出後會出現在這裡，並附上自動審核（規則式）的初判與依據。'
              : '換一個分頁看看，或稍後再回來。'
          }
        />
      ) : (
        <div className="mt-gap-4 grid gap-gap-3">
          {data.map((review) => (
            <ReviewCard key={review.id} review={review} onChanged={changed} onFailed={setFailure} />
          ))}
        </div>
      )}
    </div>
  )
}
