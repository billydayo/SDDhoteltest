/**
 * 非同步取資料的共用 hook。
 *
 * 存在的理由是**一致性**，不是省行數：每個頁面都要處理載入中、錯誤、
 * 元件卸載後才回來的回應這三件事，各寫一次必然有幾處漏掉其中一項。
 * 漏掉錯誤處理的那一頁會在後端沒開時無限轉圈（FR-084 明訂 MUST NOT）。
 *
 * ⚠️ **取消是必要的，不是最佳化。** 使用者改了搜尋條件會連續送出數個請求，
 * 而它們**不保證按送出順序回來**。不取消舊的，較慢的第一個請求可能後到並
 * 覆蓋掉正確的結果——畫面顯示的是上一組條件的房源，而網址列與篩選器都
 * 顯示新條件。這種錯不會報錯，也很難重現。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  error: unknown
  loading: boolean
  /** 重新執行一次。供 `ErrorState` 的重試按鈕使用。 */
  reload: () => void
}

export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // fetcher 每次繪製都是新的函式實體。放進 ref 讓它不參與相依比較——
  // 否則每次繪製都會重跑，變成無限迴圈。真正決定何時重跑的是 `deps`。
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        // 取消不是錯誤——是我們自己主動放棄的請求。當成錯誤顯示的話，
        // 使用者每改一次篩選條件就會看到一次錯誤畫面。
        if (controller.signal.aborted) return
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError(cause)
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由呼叫端明確決定；fetcher 走 ref
  }, [...deps, nonce])

  const reload = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  return { data, error, loading, reload }
}
