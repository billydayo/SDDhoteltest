/**
 * T055 的驗證（FR-010、FR-010a）。
 *
 * 每一條都對應一個具體的誤導：標成「必填」讓人以為非填不可、邊打字邊驗證
 * 在人還沒填完時就報錯、焦點不動讓「逐欄提示」形同虛設、空的篩選群組
 * 看起來像壞掉。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api/client'
import { EMPTY_FILTERS, type FilterValues } from '../lib/filters'
import { FilterBar } from './FilterBar'

interface SetupOptions {
  amenityOptions?: string[]
  featureOptions?: string[]
  error?: unknown
}

function setup(options: SetupOptions = {}) {
  const onSearch = vi.fn()
  const onClear = vi.fn()

  function Harness() {
    const [values, setValues] = useState<FilterValues>(EMPTY_FILTERS)
    return (
      <FilterBar
        values={values}
        onChange={setValues}
        onSearch={onSearch}
        onClear={onClear}
        amenityOptions={options.amenityOptions ?? ['免費 Wi-Fi', '浴缸']}
        featureOptions={options.featureOptions ?? ['採光佳']}
        {...(options.error === undefined ? {} : { error: options.error })}
      />
    )
  }

  render(<Harness />)
  return { onSearch, onClear }
}

describe('標籤措辭（FR-010）', () => {
  it('⚠️ 任何欄位標籤 MUST NOT 出現「必填」', () => {
    setup()
    // 三者皆空是合法搜尋。標成必填會讓只想按設施篩選的訪客隨便填一組日期，
    // 得到被日期縮限過的結果卻不知道。
    expect(screen.queryByText(/必填/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('入住日')).toBeInTheDocument()
    expect(screen.getByLabelText('退房日')).toBeInTheDocument()
    expect(screen.getByLabelText('入住人數')).toBeInTheDocument()
  })

  it('以說明文字交代三者連動', () => {
    setup()
    expect(screen.getByText(/入住日、退房日與入住人數需一併填寫/)).toBeInTheDocument()
    expect(screen.getByText(/不填任何條件即可瀏覽全部房源/)).toBeInTheDocument()
  })
})

describe('條件檢查時機', () => {
  it('⚠️ 只填了入住日的當下 MUST NOT 出現驗證錯誤', async () => {
    setup()

    // 他什麼都還沒做錯，只是還沒填完
    fireEvent.change(screen.getByLabelText('入住日'), { target: { value: '2026-12-01' } })

    await waitFor(() => {
      expect(screen.getByLabelText('入住日')).toHaveValue('2026-12-01')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('按下搜尋才觸發 onSearch', async () => {
    const user = userEvent.setup()
    const { onSearch } = setup()

    await user.type(screen.getByLabelText('關鍵字'), '海景')
    expect(onSearch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '搜尋' }))
    expect(onSearch).toHaveBeenCalledTimes(1)
  })
})

describe('逐欄錯誤與焦點（FR-010）', () => {
  it('⚠️ 後端的 snake_case field 要能定位到 camelCase 的輸入框', async () => {
    // 後端送的是 `check_out`，輸入框叫 `checkOut`。不轉換的話焦點會安靜地不動。
    setup({
      error: new ApiError(400, {
        detail: '填寫入住日時，退房日也需一併填寫。',
        code: 'INCOMPLETE_DATE_FILTER',
        field: 'check_out',
      }),
    })

    await waitFor(() => {
      expect(screen.getByLabelText('退房日')).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('退房日也需一併填寫')
  })

  it('人數缺漏定位到人數欄', async () => {
    setup({
      error: new ApiError(400, {
        detail: '填寫日期時，入住人數也需一併填寫。',
        code: 'GUEST_COUNT_REQUIRED',
        field: 'guest_count',
      }),
    })

    await waitFor(() => {
      expect(screen.getByLabelText('入住人數')).toHaveFocus()
    })
  })

  it('沒有對應欄位的錯誤也 MUST 說出來，MUST NOT 靜默', () => {
    setup({
      error: new ApiError(400, { detail: '不支援的排序方式。', code: 'INVALID_SORT' }),
    })
    expect(screen.getByRole('alert')).toHaveTextContent('不支援的排序方式')
  })
})

describe('詞彙表為空（FR-010a）', () => {
  it('⚠️ 兩組皆空時整個展開區隱藏', () => {
    setup({ amenityOptions: [], featureOptions: [] })
    expect(screen.queryByRole('button', { name: /設施與特色/ })).not.toBeInTheDocument()
  })

  it('只有一組有值時，只顯示那一組', async () => {
    const user = userEvent.setup()
    setup({ amenityOptions: ['免費 Wi-Fi'], featureOptions: [] })

    await user.click(screen.getByRole('button', { name: '展開設施與特色' }))
    expect(screen.getByText('設施（需同時具備）')).toBeInTheDocument()
    // 留一個標題底下什麼都沒有的區塊，看起來就是壞了
    expect(screen.queryByText('房型特色（需同時具備）')).not.toBeInTheDocument()
  })
})

describe('生效條件摘要與一鍵清除', () => {
  it('無條件時不顯示摘要列', () => {
    setup()
    expect(screen.queryByText('目前條件：')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除全部條件' })).not.toBeInTheDocument()
  })

  it('有條件時列出並提供一鍵清除', async () => {
    const user = userEvent.setup()
    const { onClear } = setup()

    await user.type(screen.getByLabelText('關鍵字'), '海景')
    expect(screen.getByText('關鍵字：海景')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清除全部條件' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
