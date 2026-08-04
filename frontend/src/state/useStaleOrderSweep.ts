/**
 * T093a：應用開啟期間主動觸發逾期訂單清理（FR-099a）。
 *
 * ## 為什麼前端也要做這件事
 *
 * 後端的 `expire_stale_orders()` 掛在三個查詢點上（查房況前、建單前、讀訂單
 * 列表前，T081）。那保證了「任何一次查詢看到的資料都是最新的」，但**它需要
 * 有人來查**。使用者停在房源列表上不動時，一筆訂單在他眼前逾期了，畫面卻
 * 還是「已預訂」——直到他自己重新整理。
 *
 * 這裡補的就是那個空隙：定期打一次公開查詢，讓後端順手把逾期的單清掉。
 * 兩個機制是不同層次的，**兩者皆需**——只有前端輪詢的話，沒開網頁的期間
 * 就沒有人清；只有後端呼叫點的話，開著網頁不動的人看到的是舊資料。
 *
 * ## 三條約束，每一條都對應一種擾民
 *
 * 1. **至多每分鐘一次。** 更密只是替後端加負擔，逾期粒度本來就是分鐘級。
 * 2. **分頁不可見時 MUST 暫停。** 背景分頁繼續打 API 會吃掉電池與行動數據，
 *    而使用者看不到任何好處——他根本沒在看這一頁。
 * 3. **⚠️ MUST NOT 在使用者填寫表單的頁面上觸發重繪。** 訂房流程與各表單頁
 *    要把 `enabled` 關掉。一次背景刷新讓輸入框重新掛載，使用者打到一半的
 *    字就沒了——而他完全不會知道發生了什麼事。
 *
 * ## 為什麼用 `rooms.list`
 *
 * 它是**公開**端點，未登入的訪客也能觸發清理，而房源列表正是最需要即時反映
 * 逾期釋出的畫面。回傳值刻意丟棄：這裡要的是伺服器端的副作用，不是資料。
 * 拿它去更新畫面反而會違反上面第 3 條。
 */
import { useEffect, useRef } from 'react'

import { api } from '../api/client'

/** FR-099a 的「至多每分鐘一次」。 */
export const SWEEP_INTERVAL_MS = 60_000

interface Options {
  /** `false` 時完全不執行。表單頁 MUST 關掉（見上方第 3 條）。 */
  enabled: boolean
  /**
   * 清理完成後通知呼叫端。
   *
   * ⚠️ 只有「顯示房況的唯讀畫面」該用它去重新查詢。表單頁不該傳，
   * 傳了就等於自己違反第 3 條。
   */
  onSwept?: () => void
}

export function useStaleOrderSweep({ enabled, onSwept }: Options): void {
  // 回呼放進 ref，讓它不參與 effect 的相依比較——呼叫端每次繪製都會給一個
  // 新的函式實體，列進相依等於每次繪製都重設計時器，實際上就再也不會觸發。
  //
  // ⚠️ 更新寫在 effect 裡而非繪製過程中：繪製期間改 ref 在 React 的並行模式下
  // 可能發生在一次被丟棄的繪製上，而丟棄的那一次改動不會被還原。
  const onSweptRef = useRef(onSwept)
  useEffect(() => {
    onSweptRef.current = onSwept
  })

  const lastRunRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const sweep = () => {
      if (cancelled || document.hidden) return
      const now = Date.now()
      // ⚠️ 節流用的是**實際經過的時間**，不是計時器的次數。分頁從背景切回來時
      // 會立刻嘗試一次，這道檢查擋掉「剛跑完就切走再切回」的重複呼叫。
      if (now - lastRunRef.current < SWEEP_INTERVAL_MS) return
      lastRunRef.current = now

      api.rooms
        .list({})
        .then(() => {
          if (!cancelled) onSweptRef.current?.()
        })
        .catch(() => {
          // 清理失敗不該打擾使用者——他沒有要求做這件事，也幫不上忙。
          // 下一輪會再試。
        })
    }

    const timer = setInterval(sweep, SWEEP_INTERVAL_MS)

    // 切回這個分頁時立刻補一次：離開期間逾期的訂單，回來就該看到已釋出。
    const onVisible = () => {
      if (!document.hidden) sweep()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}
