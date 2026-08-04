/**
 * T170：後台的會員訊息（FR-123 ~ FR-128）。
 *
 * ## 管理員端看得出每則回覆出自哪一位管理員（FR-127）
 *
 * 任一管理員都能回覆所有討論串——**刻意沒有「指派給誰」**，因為指派會讓被
 * 指派者休假時整串無人回覆，而這項功能要解決的正是不漏接
 * （`models/message.py`）。
 *
 * 但沒有指派就必須有署名：接手的人得知道前一句是誰說的，否則同一串裡會出現
 * 互相矛盾的答覆而沒有人察覺。因此後台的 `AdminMessage` 帶 `senderName`，
 * 而前台的 `Message` 沒有——**是兩個型別，不是一個帶旗標的型別**。
 *
 * ## 未讀數是客服的待辦
 *
 * `unread` 只算**會員送出而尚未被讀**的則數。把管理員自己送出的也算進去的話，
 * 每回覆一次待辦就多一筆。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { AdminMessage, ThreadSummary } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { MessageThread, type ThreadBubble } from '../../components/MessageThread'
import { useAsync } from '../../hooks/useAsync'
import { formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { Badge, buttonClass, inputClass, ModuleHeading, Notice, primaryButtonClass } from './ui'

const MAX_LENGTH = 2000

/**
 * ⚠️ `mine` 在後台的意思是「這一則出自管理員」，不是「出自我本人」。
 *
 * 客服是一個團隊，畫面上該分的是「我們」與「客人」，不是「我」與「其他同事」。
 * 因此靠右的一側是所有管理員的回覆，而每一則都掛著自己的署名。
 */
function toBubbles(messages: AdminMessage[]): ThreadBubble[] {
  return messages.map((message) => ({
    id: message.id,
    mine: message.senderRole === 'admin',
    senderLabel:
      message.senderRole === 'admin' ? (message.senderName ?? '（已刪除的管理員）') : '會員',
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt,
  }))
}

// ---------------------------------------------------------------------------
// 一串對話
// ---------------------------------------------------------------------------
function Thread({ thread, onReplied }: { thread: ThreadSummary; onReplied: () => void }) {
  const load = useCallback(
    (signal: AbortSignal) => api.admin.messages.thread(thread.userId, signal),
    [thread.userId],
  )
  const { status, data, error, reload } = useAsync<AdminMessage[]>(load)

  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const ids = useId()

  async function reply() {
    const text = body.trim()
    if (!text) return
    setSending(true)
    setFailure(null)
    try {
      await api.admin.messages.reply(thread.userId, { body: text })
      setBody('')
      reload()
      onReplied()
    } catch (cause) {
      // ⚠️ 已填內容 MUST 保留（FR-083）。
      setFailure(messageFor(cause).detail)
    } finally {
      setSending(false)
    }
  }

  async function markRead() {
    setFailure(null)
    try {
      await api.admin.messages.markRead(thread.userId)
      setMessage('已將這串標記為已讀。')
      reload()
      onReplied()
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    }
  }

  return (
    <section aria-label={`與 ${thread.userName ?? '會員'} 的對話`} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-gap-2">
        <h3 className="text-md text-ink">{thread.userName ?? '（已刪除的會員）'}</h3>
        {thread.unread > 0 && (
          <button type="button" onClick={() => void markRead()} className={buttonClass}>
            標記為已讀
          </button>
        )}
      </div>

      {message !== null && <Notice tone="ok">{message}</Notice>}
      {failure !== null && <Notice tone="danger">{failure}</Notice>}

      <div className="mt-gap-3">
        {status === 'error' ? (
          <ErrorState error={error} onRetry={reload} />
        ) : data === null ? (
          <LoadingState label="載入對話…" />
        ) : (
          <MessageThread bubbles={toBubbles(data)} emptyHint="這串還沒有任何訊息。" />
        )}
      </div>

      <div className="mt-gap-3">
        <label htmlFor={`${ids}-reply`} className="block text-small text-ink">
          回覆
        </label>
        <textarea
          id={`${ids}-reply`}
          rows={3}
          maxLength={MAX_LENGTH}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          className={`mt-gap-1 ${inputClass}`}
        />
        <div className="mt-gap-2 flex items-center justify-between gap-gap-3">
          {/* 會員看到的署名是「客服人員」，不是這裡的名字（FR-127）。
              寫出來是為了讓管理員知道自己的姓名不會外流。 */}
          <span className="text-tiny text-ink-muted">
            您的姓名只會出現在後台；會員看到的署名一律是「客服人員」。
          </span>
          <button
            type="button"
            disabled={sending || body.trim() === ''}
            onClick={() => {
              void reply()
            }}
            className={primaryButtonClass}
          >
            {sending ? '送出中…' : '送出回覆'}
          </button>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export function Messages() {
  const load = useCallback((signal: AbortSignal) => api.admin.messages.threads(signal), [])
  const { status, data, error, reload } = useAsync<ThreadSummary[]>(load)
  const [selected, setSelected] = useState<string | null>(null)

  const threads = data ?? []
  const current = threads.find((t) => t.userId === selected) ?? threads[0]

  return (
    <div>
      <ModuleHeading title="會員訊息" />

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入討論串…" />
      ) : threads.length === 0 ? (
        <EmptyState
          title="目前沒有任何對話"
          hint="會員從「聯絡客服」送出訊息後，討論串會出現在這裡。"
        />
      ) : (
        <div className="mt-gap-4 grid gap-gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label="討論串">
            <ul className="grid gap-gap-1">
              {threads.map((thread) => {
                const active = current?.userId === thread.userId
                return (
                  <li key={thread.userId}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setSelected(thread.userId)
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-gap-2 rounded-xs px-gap-3 py-gap-2 text-left text-small',
                        active ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:bg-surface-alt',
                      ].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{thread.userName ?? '（已刪除）'}</span>
                        {thread.lastMessageAt !== null && (
                          <span className="block text-tiny text-ink-muted">
                            {formatTimestamp(thread.lastMessageAt)}
                          </span>
                        )}
                      </span>
                      {thread.unread > 0 && <Badge tone="warn">{thread.unread}</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {current && <Thread key={current.userId} thread={current} onReplied={reload} />}
        </div>
      )}
    </div>
  )
}
