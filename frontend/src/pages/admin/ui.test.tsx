/**
 * 篩選列的對齊不變式。
 *
 * ## 為什麼要為「版面」寫測試
 *
 * jsdom 不做排版，量不到座標，所以這裡驗的不是像素，而是**讓對齊成立的那個
 * 結構條件**：`FilterBar` 是 `items-end`（底邊對齊），因此每一格的最後一個
 * 子元素必須是輸入框的容器。
 *
 * 這條被打破過一次：`hint` 原本放在輸入框之後，於是「入住迄日」（有 hint）
 * 的底邊變成 hint 的底邊，它的輸入框被往上推一整行，同一列的「入住起日」
 * 與搜尋按鈕就全部對不齊。畫面上一眼看得出來，**但沒有任何測試會失敗**，
 * 型別與 lint 也都是綠的。
 *
 * 把「hint 在控制項之前」寫成斷言，是這個錯唯一會自己浮出來的方式。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Field, FilterBar } from './ui'

/** 該格最外層的 `div`。`Field` 的 `className` 掛在它身上，也是 flex 的子項。 */
function fieldBox(labelText: string): HTMLElement {
  const label = screen.getByText(labelText)
  const box = label.parentElement
  expect(box).not.toBeNull()
  return box!
}

describe('Field 的排列（篩選列對齊）', () => {
  it('⚠️ 有 hint 時，輸入框仍是最後一個子元素', () => {
    render(
      <FilterBar>
        <Field label="入住迄日" htmlFor="end" hint="含頭含尾">
          <input id="end" type="date" />
        </Field>
      </FilterBar>,
    )

    const box = fieldBox('入住迄日')

    // 底邊落在輸入框上，而不是落在 hint 上
    expect(box.lastElementChild?.querySelector('input')?.id).toBe('end')

    // 也就是說 hint 必須排在控制項之前（見檔頭）
    const children = [...box.children]
    expect(children.indexOf(screen.getByText('含頭含尾'))).toBeLessThan(children.length - 1)
  })

  it('有 hint 與沒有 hint 的兩格，結構層數相同', () => {
    // 層數不同就代表底邊落在不同的東西上，`items-end` 也就對不齊了
    render(
      <FilterBar>
        <Field label="入住起日" htmlFor="start">
          <input id="start" type="date" />
        </Field>
        <Field label="入住迄日" htmlFor="end" hint="含頭含尾">
          <input id="end" type="date" />
        </Field>
      </FilterBar>,
    )

    const withoutHint = fieldBox('入住起日')
    const withHint = fieldBox('入住迄日')

    // 兩格的最後一個子元素都必須是包著 input 的那一層
    expect(withoutHint.lastElementChild?.querySelector('input')?.id).toBe('start')
    expect(withHint.lastElementChild?.querySelector('input')?.id).toBe('end')
  })
})
