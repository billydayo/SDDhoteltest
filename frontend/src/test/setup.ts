/**
 * Vitest 全域 setup（T010）。
 *
 * `@testing-library/jest-dom` 提供 `toBeInTheDocument`、`toHaveAccessibleName`
 * 等斷言。後者對本專案特別重要：憲章原則 V 要求可及性，而「按鈕有沒有可讀的
 * 名稱」用一般的 DOM 斷言寫起來很囉嗦，囉嗦的斷言就不會有人寫。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 每個測試後卸載元件。不清理的話前一個測試殘留的 DOM 會被 `getByRole` 找到，
// 症狀是「單獨跑會過、一起跑會失敗」這種最難查的形態。
afterEach(() => {
  cleanup()
})

/**
 * ⚠️ jsdom **沒有實作 `matchMedia`**，而 TypeScript 認為它一定存在
 * （lib.dom 宣告它是必有的）。因此production 程式碼裡不該加防禦性判斷——
 * 那會被 `no-unnecessary-condition` 擋下來，而且是為了測試環境去汙染正式碼。
 * 缺的東西在這裡補。
 *
 * 回傳「不減少動態」：測試要看到的是預設行為。真的要測 reduce-motion 的分支，
 * 由該測試自己覆寫這個 stub。
 */
if (typeof window !== 'undefined' && window.matchMedia === undefined) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
