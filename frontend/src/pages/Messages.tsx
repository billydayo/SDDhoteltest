/**
 * T169：會員的客服訊息（FR-123 ~ FR-128）。
 *
 * ## 會員只看得到「客服人員」
 *
 * FR-127：**MUST NOT 顯示管理員姓名。** 這裡做不到違反它——前台的 `Message`
 * 型別裡根本沒有 `senderName` 欄位（`api/types.ts`、`schemas/message.py`）。
 * 不是「記得不要顯示」，是「沒有東西可以顯示」。
 *
 * ## 端點上沒有 `threadId`
 *
 * 每位會員只有一串，由 token 決定是哪一串。因此「看別人的對話」在介面上
 * 不可表達，而不只是會被拒絕（`routers/messages.py`）。
 *
 * ## 進來就標記已讀
 *
 * 標的是**客服送出而我還沒讀**的那些。做在開啟頁面時而不是送出訊息時：
 * 使用者可能只是進來看看而不回覆，那也算讀過了。
 */
import { useCallback, useEffect, useId, useState } from 'react'

import { api } from '../api/client'
import type { Message } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { MessageThread, SUPPORT_DISPLAY_NAME, type ThreadBubble } from '../components/MessageThread'
import { useAsync } from '../hooks/useAsync'
import { messageFor } from '../lib/errors'
import { primaryButtonClass } from '../lib/surfaces'

const MAX_LENGTH = 2000

function toBubbles(messages: Message[]): ThreadBubble[] {
  return messages.map((message) => ({
    id: message.id,
    mine: message.mine,
    // ⚠️ 只有兩種可能的稱呼。管理員一律是「客服人員」（FR-127）。
    senderLabel: message.mine ? '我' : SUPPORT_DISPLAY_NAME,
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt,
  }))
}

export function Messages() {
  const load = useCallback((signal: AbortSignal) => api.messages.list(signal), [])
  const { status, data, error, reload } = useAsync<Message[]>(load)

  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const ids = useId()

  // 已讀標記失敗不影響閱讀，因此不顯示錯誤——那只會讓使用者困惑於一件他沒有
  // 做過的操作失敗了。
  useEffect(() => {
    void api.messages.markRead().catch(() => undefined)
  }, [])

  async function send() {
    const text = body.trim()
    if (!text) return
    setSending(true)
    setFailure(null)
    try {
      await api.messages.send({ body: text })
      setBody('')
      reload()
    } catch (cause) {
      // ⚠️ 失敗時**保留已填內容**（FR-083）。清掉的話使用者剛打的一段話就沒了。
      setFailure(messageFor(cause).detail)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 text-ink">聯絡客服</h1>
      <p className="mt-gap-2 text-small text-ink-muted">
        有任何訂房相關的問題都可以留言，客服人員會在這裡回覆您。
      </p>

      <div className="mt-gap-5">
        {status === 'error' ? (
          <ErrorState error={error} onRetry={reload} />
        ) : data === null ? (
          <LoadingState label="載入訊息…" />
        ) : (
          <MessageThread
            bubbles={toBubbles(data)}
            emptyHint="還沒有任何訊息。在下方寫下您的問題，客服人員收到後會回覆您。"
          />
        )}
      </div>

      <div className="mt-gap-4">
        <label htmlFor={`${ids}-body`} className="block text-small text-ink">
          您的訊息
        </label>
        <textarea
          id={`${ids}-body`}
          rows={3}
          maxLength={MAX_LENGTH}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          className="mt-gap-1 w-full rounded-xs border border-line-strong bg-surface px-gap-3 py-gap-2 text-body"
        />
        <div className="mt-gap-2 flex items-center justify-between gap-gap-3">
          <span className="text-tiny text-ink-muted">
            {body.length} / {MAX_LENGTH}
          </span>
          <button
            type="button"
            disabled={sending || body.trim() === ''}
            onClick={() => {
              void send()
            }}
            className={primaryButtonClass}
          >
            {sending ? '送出中…' : '送出'}
          </button>
        </div>
        {failure !== null && (
          <p role="status" className="mt-gap-2 text-small text-danger">
            {failure}
          </p>
        )}
      </div>
    </div>
  )
}
