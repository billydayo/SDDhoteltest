/**
 * 「向後端取一份資料」的共同形狀。
 *
 * 每個頁面各自寫一份 `useState` + `useEffect` 的問題不是重複，而是**每一份都會
 * 漏掉不同的東西**：有的忘了取消請求，有的把 `AbortError` 當成真的錯誤顯示
 * 「載入失敗」，有的沒有錯誤狀態所以 API 掛掉時只留下一片空白——而空白會被
 * 讀成「沒有資料」（FR-084 禁止靜默失敗）。
 *
 * ## 為什麼 `load` 要由呼叫端 `useCallback` 包起來
 *
 * 本 hook 刻意**不收相依陣列**。收了的話，相依項是由呼叫端手寫的一串值，
 * 而 `react-hooks` 的檢查看不進自訂 hook 的參數裡——漏掉一項不會有任何警告，
 * 症狀是改了篩選條件而列表不更新。改成傳一個 `useCallback` 的函式之後，
 * 那串相依項回到 lint 看得見的地方。
 *
 * ## 「載入中」是算出來的，不是設出來的
 *
 * 效果裡**不同步呼叫 `setState`**（`react-hooks/set-state-in-effect`）——那會
 * 多觸發一輪繪製。改為記下「最後一次完成的請求屬於哪一組輸入」，再於繪製時
 * 與當下的輸入比對：不相符就是還在載入。
 *
 * 附帶的好處是重新載入期間 `data` **不會清空**。清空的話，每改一個篩選條件
 * 整張表格都會消失再出現，畫面高度隨之抽動——使用者正要點的那一列會跑掉。
 */
import { useCallback, useEffect, useState } from 'react'

export type AsyncStatus = 'loading' | 'ready' | 'error'

export interface AsyncResult<T> {
  status: AsyncStatus
  /** 尚未取得任何資料時為 `null`。重新載入期間會保留上一次的內容。 */
  data: T | null
  /** `status` 為 `error` 時才有意義。轉成文字請用 `lib/errors.ts` 的 `messageFor`。 */
  error: unknown
  /** 重新取一次。用於錯誤畫面的「重新載入」與寫入成功後的刷新。 */
  reload: () => void
}

/** 最後一次**完成**的請求，連同它是為了哪一組輸入而發的。 */
interface Snapshot<T> {
  load: (signal: AbortSignal) => Promise<T>
  nonce: number
  data: T | null
  error: unknown
}

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>): AsyncResult<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    load(controller.signal)
      .then((data) => {
        setSnapshot({ load, nonce, data, error: null })
      })
      .catch((cause: unknown) => {
        // 使用者切換頁面或改了篩選條件而取消的請求**不是錯誤**。當成錯誤處理
        // 會讓正常操作的過程中閃出「載入失敗」。
        //
        // 也因此這裡不寫入 snapshot：被取消的那一次沒有結果，而接手的那一次
        // 會寫入它自己的。
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setSnapshot({ load, nonce, data: null, error: cause })
      })

    return () => {
      controller.abort()
    }
  }, [load, nonce])

  // 手上的結果是不是**這一組輸入**的。不是的話就還在載入——包含第一次
  // （尚無任何結果）與改了條件之後（結果屬於上一組條件）兩種情況。
  const current =
    snapshot !== null && snapshot.load === load && snapshot.nonce === nonce ? snapshot : null

  const status: AsyncStatus = current === null ? 'loading' : current.error !== null ? 'error' : 'ready'

  const reload = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  return {
    status,
    // 重新載入期間沿用上一次的內容，避免整塊畫面消失再出現。
    data: snapshot?.data ?? null,
    error: current?.error ?? null,
    reload,
  }
}
