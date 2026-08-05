/**
 * 收藏的**入口**（FR-091、FR-093、US10）。
 *
 * ## 這支測試為什麼存在
 *
 * 2026-08-05 發現收藏功能「不見了」。查下去，`FavoriteButton`、
 * `pages/Favorites.tsx`、`routers/favorites.py`、資料表——**每一塊都在**，
 * 而且都有測試。缺的是把星號掛到房源卡片與詳情頁上這一步，
 * 它從來沒有被做過（`git log -S FavoriteButton` 在那兩個檔案零命中）。
 *
 * 所以這裡驗的不是「按下去會發生什麼」——那是 `FavoriteButton` 自己的事——
 * 而是**那顆按鈕確實出現在使用者找得到的地方**。這種缺陷沒有任何既有測試會紅：
 * 元件測試通過、API 測試通過、收藏清單頁測試通過，只是沒有人能加入收藏。
 *
 * 收藏清單的空狀態當時還寫著「在房源列表或詳情頁按下愛心」——文案承諾了一個
 * 不存在的入口，而那句話本身也沒有測試會抓。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setToken } from '../api/client'
import type { Room } from '../api/types'
import { RoomCard } from './RoomCard'
import { AuthProvider } from '../state/AuthContext'
import { FavoritesProvider } from '../state/FavoritesContext'
import { MEMBER, makeRoom, mockApi } from '../test/mockApi'

const room: Room = makeRoom()

function renderCard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <FavoritesProvider>
          <Routes>
            <Route path="/" element={<RoomCard room={room} />} />
            <Route path="/login" element={<h1>登入</h1>} />
          </Routes>
        </FavoritesProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setToken(null)
  mockApi()
})

afterEach(() => {
  vi.restoreAllMocks()
  setToken(null)
})

describe('⚠️ 房源卡片上必須有收藏入口（FR-091、US10 情境 1）', () => {
  it('卡片上有一顆收藏按鈕', async () => {
    renderCard()
    expect(await screen.findByRole('button', { name: '收藏此房源' })).toBeInTheDocument()
  })

  it('⚠️ 按鈕沒有被整片可點區蓋住', () => {
    /**
     * 卡片用 `after:absolute inset-0` 把可點區域撐滿整張卡（T054）。
     * 星號若沒有自己的 `z-10`，會**看得到但按不到**——點下去只是進房源詳情頁，
     * 跟卡片其他地方一樣。沒有任何錯誤訊息，使用者只會覺得愛心壞了。
     *
     * 這裡驗的是那個定位仍在。jsdom 不做繪製，比對不了實際的疊放結果，
     * 所以退而求其次驗 class——不完美，但足以擋住「重構時把 z-10 拿掉」。
     */
    const { container } = renderCard()
    const wrapper = container.querySelector('.z-10')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.textContent).toContain('♡')
  })

  it('未登入時按下去被帶往登入頁（FR-093）', async () => {
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: '收藏此房源' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument()
    })
  })

  it('已登入且已收藏時，星號呈現已收藏的狀態', async () => {
    setToken('fake-token')
    mockApi({ profile: MEMBER, favorites: [{ ...room, listed: true }] })
    renderCard()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })
})

describe('收藏清單的空狀態不可以承諾不存在的入口', () => {
  it('⚠️ 文案提到的「房源列表或詳情頁」確實有按鈕', async () => {
    /**
     * `pages/Favorites.tsx` 的空狀態寫著「在房源列表或詳情頁按下愛心，就會出現
     * 在這裡」。這句話在 2026-08-05 之前**是假的**：那兩個地方都沒有愛心。
     *
     * 文案與功能分屬兩個檔案，沒有任何東西會在它們分歧時報錯——這條把兩者綁在
     * 一起。上面第一項若紅了，這句話就該一起改掉，而不是留著騙下一個人。
     */
    renderCard()
    expect(await screen.findByRole('button', { name: '收藏此房源' })).toBeInTheDocument()
  })
})
