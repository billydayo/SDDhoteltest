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
 * 一律覆寫，不做「存在才補」的判斷：那個判斷在型別上永遠不成立。
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

// 這個 cast 省不掉：`MediaQueryList.addEventListener` 是多載簽章，
// 用 `vi.fn()` 填不出一個結構上相容的型別。
window.matchMedia = matchMediaStub as unknown as typeof window.matchMedia
