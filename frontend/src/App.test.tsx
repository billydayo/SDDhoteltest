/**
 * T010 的煙霧測試：確認 Vitest + React Testing Library + jsdom 這條鏈能跑。
 *
 * 用 `getByRole` 而不是 `getByText`——role 查詢走的是可及性樹，
 * 標題若被寫成 `<div class="title">` 就查不到。這讓測試順便守住語意化標記
 * （憲章原則 V），而不是只確認畫面上有那幾個字。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('渲染站名為一級標題', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Sunny 訂房平台' })).toBeInTheDocument()
  })

  it('主要內容包在 main 地標中', () => {
    render(<App />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
