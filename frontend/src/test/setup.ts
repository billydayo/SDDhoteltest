/**
 * Vitest 全域 setup（T010）。
 *
 * `@testing-library/jest-dom` 提供 `toBeInTheDocument`、`toHaveAccessibleName`
 * 等斷言。後者對本專案特別重要：憲章原則 V 要求可及性，而「按鈕有沒有可讀的
 * 名稱」用一般的 DOM 斷言寫起來很囉嗦，囉嗦的斷言就不會有人寫。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// 每個測試後卸載元件。不清理的話前一個測試殘留的 DOM 會被 `getByRole` 找到，
// 症狀是「單獨跑會過、一起跑會失敗」這種最難查的形態。
afterEach(() => {
  cleanup()
})

/**
 * ⚠️ jsdom **沒有實作 `matchMedia`**，而 TypeScript 認為它一定存在
 * （lib.dom 宣告它是必有的）。因此正式碼裡不該加防禦性判斷——那既會被
 * `no-unnecessary-condition` 擋下來，也等於為了測試環境去汙染正式碼。
 * 缺的東西補在這裡。
 *
 * ⚠️ **`typeof window` 這道判斷不能省。** 這份 setup 對**每一個**測試檔都會跑，
 * 而其中有四個標了 `@vitest-environment node`（掃原始碼、算對比度，不需要 DOM）。
 * 在那個環境裡 `window` 根本不存在，少了判斷會是 `ReferenceError`，
 * 而且那四個檔案會整包失敗在 setup 階段——錯誤訊息指向這裡，看起來卻像是
 * 那些測試自己壞了。
 *
 * 不再多判斷 `window.matchMedia === undefined`：型別上它永遠有值，
 * 那個比較會被 `no-unnecessary-condition` 擋下來。直接覆寫即可。
 *
 * `matches: false` 表示「不減少動態」，也就是測試看到的是預設行為。真要測
 * reduce-motion 的分支，由該測試自己覆寫這個 stub。
 */
const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
})

if (typeof window !== 'undefined') {
  window.matchMedia = matchMediaStub
}
