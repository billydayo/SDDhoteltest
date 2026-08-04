/**
 * T169：一串對話的呈現（FR-123 ~ FR-128）。
 *
 * ## 這個元件不知道「管理員叫什麼名字」
 *
 * 它收到的是已經決定好的 `senderLabel`。前台傳入的一律是「客服人員」
 * （FR-127：會員 MUST NOT 看到管理員姓名），後台傳入真實姓名。
 *
 * 做成「收一個 `Message` 再自己決定要不要顯示名字」的話，那個判斷就會有一次
 * 寫錯的機會，而症狀是會員看到客服人員的真實姓名——沒有錯誤訊息，也不會有人
 * 發現，直到有客人記下了名字。**這裡拿不到那個名字**（見 `schemas/message.py`
 * 為什麼是兩個輸出模型）。
 *
 * ## 為什麼是 `ul` 而不是一堆 `div`
 *
 * 讀屏使用者會被告知「清單，共 12 項」，並能逐項瀏覽。一疊 `div` 只是一片
 * 連續的文字，聽不出哪裡是一則的開始（憲章原則 V）。
 */
import { useEffect, useRef } from 'react'

import { formatTimestamp } from '../lib/dates'

/** ⚠️ 前台一律以此稱呼管理員（FR-127）。與後端 `SUPPORT_DISPLAY_NAME` 同義。 */
export const SUPPORT_DISPLAY_NAME = '客服人員'

export interface ThreadBubble {
  id: string
  /** 是不是「我」送的。決定靠左或靠右，以及讀屏聽到的稱呼。 */
  mine: boolean
  /** 顯示在氣泡上方的名字。⚠️ 前台傳入時 MUST 是「客服人員」。 */
  senderLabel: string
  body: string
  createdAt: string
  readAt: string | null
}

export function MessageThread({
  bubbles,
  emptyHint,
}: {
  bubbles: ThreadBubble[]
  emptyHint: string
}) {
  const bottom = useRef<HTMLDivElement>(null)

  // 新訊息在最下面。捲到底是對話介面的標準行為——不捲的話，送出一則訊息之後
  // 使用者看到的還是舊的內容，會以為沒送出去。
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [bubbles.length])

  if (bubbles.length === 0) {
    return (
      <p className="rounded-base border border-dashed border-line-strong px-gap-4 py-gap-6 text-center text-small text-ink-muted">
        {emptyHint}
      </p>
    )
  }

  return (
    <div className="max-h-[28rem] overflow-y-auto rounded-base border border-line-soft bg-surface p-gap-3">
      <ul className="grid gap-gap-3">
        {bubbles.map((bubble) => (
          <li
            key={bubble.id}
            className={bubble.mine ? 'flex justify-end' : 'flex justify-start'}
          >
            <div className="max-w-[85%]">
              <p className="text-tiny text-ink-muted">
                {bubble.senderLabel}．{formatTimestamp(bubble.createdAt)}
                {/* 已讀只對「我送出的」有意義。對方送的訊息標「已讀」是
                    在說我自己讀了它，那對使用者沒有任何用處。 */}
                {bubble.mine && bubble.readAt !== null && <span className="ml-gap-1">已讀</span>}
              </p>
              <p
                className={[
                  'mt-gap-1 rounded-lg px-gap-3 py-gap-2 text-body whitespace-pre-line',
                  bubble.mine ? 'bg-brand text-ink-invert' : 'bg-surface-alt text-ink',
                ].join(' ')}
              >
                {bubble.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div ref={bottom} />
    </div>
  )
}
