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
