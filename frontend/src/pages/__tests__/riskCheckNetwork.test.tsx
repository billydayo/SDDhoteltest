/**
 * T144a：**執行期**的網路驗證（SC-015、FR-066、FR-086）。
 *
 * ## 與 T144 是不同的驗證面
 *
 * - T144（`lib/__tests__/riskCheckIsolation`）驗**靜態相依**：送不出去
 * - 本檔驗**執行期流量**：完成一次完整分析後，夾帶照片內容的請求數為 0
 *
 * 兩者都需要。相依圖乾淨的頁面仍然可能在某個 `useEffect` 裡呼叫一個全域的
 * 追蹤函式；而執行期沒送出去也只證明「這一次沒有」。
 *
 * ## 攔截器包住的是四個出口，不是一個
 *
 * `fetch` 之外還有 `XMLHttpRequest`、`navigator.sendBeacon` 與 `WebSocket`。
 * 只擋 `fetch` 的測試會讓一個用 `sendBeacon` 送出去的實作安靜地通過——
 * 而 `sendBeacon` 正是分析工具最常用的那一個。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RiskCheck } from '../RiskCheck'

/** 每一次被攔下來的外送。`body` 用來確認裡面沒有夾帶照片。 */
interface Outbound {
  via: string
  url: string
  body: unknown
}

let outbound: Outbound[] = []

/** 一張 4×4 的假照片。內容不重要——重要的是它有沒有離開瀏覽器。 */
const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

function makeFile(type = 'image/jpeg', size = PHOTO_BYTES.length): File {
  const file = new File([PHOTO_BYTES], 'bedroom.jpg', { type })
  // jsdom 不會讓 `size` 可寫，因此需要覆寫時走 defineProperty。
  if (size !== PHOTO_BYTES.length) {
    Object.defineProperty(file, 'size', { value: size })
  }
  return file
}

beforeEach(() => {
  outbound = []

  // -- 四個網路出口全部攔下 ------------------------------------------------
  vi.stubGlobal('fetch', (input: unknown, init?: { body?: unknown }) => {
    outbound.push({ via: 'fetch', url: String(input), body: init?.body })
    return Promise.resolve(new Response('{}'))
  })

  class BlockedXHR {
    private url = ''
    open(_method: string, url: string) {
      this.url = url
    }
    send(body?: unknown) {
      outbound.push({ via: 'xhr', url: this.url, body })
    }
    setRequestHeader() {
      /* 攔截器不需要真的記錄標頭 */
    }
    addEventListener() {
      /* 同上 */
    }
  }
  vi.stubGlobal('XMLHttpRequest', BlockedXHR)

  // ⚠️ 以 `navigator` 為原型而不是把它展開：展開會丟掉 `Navigator.prototype`，
  // 於是頁面讀 `navigator.language` 之類的屬性時拿到 undefined——而那是一個
  // 與本檔要驗的事情無關的失敗。
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      sendBeacon: {
        value: (url: string, body?: unknown) => {
          outbound.push({ via: 'sendBeacon', url, body })
          return true
        },
      },
    }),
  )

  class BlockedWebSocket {
    constructor(private readonly url: string) {
      outbound.push({ via: 'websocket', url, body: undefined })
    }
    // 連上之後才送出去的那條路徑同樣要記下來——只記 `new WebSocket(...)`
    // 會讓「先開連線、稍後才把照片推出去」的實作看起來是乾淨的。
    send(body?: unknown) {
      outbound.push({ via: 'websocket', url: this.url, body })
    }
    close() {
      /* 攔截器不需要真的關閉任何東西 */
    }
  }
  vi.stubGlobal('WebSocket', BlockedWebSocket)

  // -- 影像 API：jsdom 沒有 Canvas，這裡給一個最小的替身 --------------------
  // ⚠️ 替身回傳的是**固定的像素**。本檔測的是「有沒有送出去」，不是分數算得
  // 對不對——那由 T143 的 `riskScore.test.ts` 以合成像素驗證。
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 4, height: 4, close: () => undefined }),
  )
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:local-only',
    revokeObjectURL: () => undefined,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(140),
      width,
      height,
    }),
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function analyzeOnce() {
  render(<RiskCheck />)
  const input: HTMLInputElement = screen.getByLabelText(/選擇照片|換一張照片/)
  await userEvent.upload(input, makeFile())
  await waitFor(() => {
    expect(screen.getByText('整體風險評分')).toBeInTheDocument()
  })
}

describe('安全檢測頁的執行期流量', () => {
  it('⚠️ 完成一次完整分析後，外送請求數為 0（SC-015）', async () => {
    await analyzeOnce()
    expect(outbound).toEqual([])
  })

  it('連續分析兩張照片仍然是 0', async () => {
    render(<RiskCheck />)
    const input: HTMLInputElement = screen.getByLabelText(/選擇照片/)

    await userEvent.upload(input, makeFile())
    await waitFor(() => {
      expect(screen.getByText('整體風險評分')).toBeInTheDocument()
    })
    await userEvent.upload(input, makeFile('image/png'))
    await waitFor(() => {
      expect(screen.getByText('整體風險評分')).toBeInTheDocument()
    })

    expect(outbound).toEqual([])
  })

  it('預覽圖用的是本機 Blob 位址，不是遠端網址', async () => {
    await analyzeOnce()
    const preview: HTMLImageElement = screen.getByAltText('您上傳的照片預覽')
    expect(preview.src.startsWith('blob:')).toBe(true)
  })

  it('被拒絕的檔案同樣不會產生任何請求（FR-065）', async () => {
    render(<RiskCheck />)
    const input: HTMLInputElement = screen.getByLabelText(/選擇照片/)

    // `userEvent.upload` 會尊重 `accept`，因此直接改 `files` 再觸發 change，
    // 才測得到「使用者用拖放或舊瀏覽器繞過 accept」的那條路徑。
    await userEvent.upload(input, makeFile('application/pdf'))
    Object.defineProperty(input, 'files', { value: [makeFile('application/pdf')] })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('僅接受 JPEG、PNG 或 WebP 圖片')
    })
    expect(outbound).toEqual([])
  })

  it('顯示的分析結果會完全取代前一次，不會兩份並存', async () => {
    await analyzeOnce()
    expect(screen.getAllByText('整體風險評分')).toHaveLength(1)
  })
})
