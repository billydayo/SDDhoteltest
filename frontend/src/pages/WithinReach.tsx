/**
 * 無障礙檢測（Within Reach）。**本頁不做檢測，只負責把外部系統掛上來。**
 *
 * 取代原本自建的照片安全檢測（舊 T146，`pages/RiskCheck.tsx`）。憲章 4.0.0
 * 的決定是「檢測系統不自己架構」——因此這一頁的職責從「算分數」縮到
 * 「提供一個容器，並確保外部程式碼只能在它的邊界內活動」。
 *
 * 來源：https://github.com/CHUN9701/within-reach
 * 產物：`npm run build:widget` → `dist-widget/wr-widget.js`
 * 落點：`frontend/public/wr-widget.js`（進版控，隨我們的站台一起部署）
 *
 * ## 為什麼是自己 host，不是指向對方的網址
 *
 * `<script src>` 每一次載入都抓當下最新的檔案。指向別人的主機，等於把
 * 「這頁上跑什麼程式」的決定權長期交出去——對方任何一次改版都會直接生效在
 * 我們的正式站上，而我們不會知道。自己 host 之後，換版本是一次 commit，
 * 看得到 diff，也退得回去。
 *
 * ⚠️ 因此 `frontend/public/wr-widget.js` MUST NOT 改成遠端網址。
 * 要更新版本就重跑一次上游的 `build:widget`，把檔案換掉並記下來源 commit。
 *
 * ## 這支外部程式碼能做什麼、不能做什麼
 *
 * 嵌入前逐檔追過它的相依圖（`src/embed/mount.tsx` → `Widget.tsx` →
 * `components/AnnotationLayer`、`components/Disclaimer`、`data/hotels`、
 * `constants/*`、`lib/measure`），確認：
 *
 * - **沒有 `fetch`／`XMLHttpRequest`／`WebSocket`／`sendBeacon`** —— 評估資料全部
 *   打包在 bundle 裡（`data/hotels.ts`），不對外要任何資料
 * - ⚠️ **但它會載入外部圖片。** 房源照片指向 `https://images.unsplash.com`
 *   （`data/hotels.ts` 組出的網址）。那是一個真實的跨站請求：Unsplash 會拿到
 *   訪客的 IP 與 referrer。**沒有資料被送出去，但有訪客被暴露**，兩者不一樣。
 *   要消掉這一項，得請上游把示範圖改成打包進 bundle 的本機資產。
 *   在那之前，這是本頁已知且被接受的外部連線，MUST NOT 被描述為「零外部請求」。
 * - **沒有 `localStorage`／`sessionStorage`／`document.cookie`** —— 這點是關鍵：
 *   我們的 JWT 存在 `localStorage`（`api/client.ts`），同頁的第三方程式碼
 *   讀得到。它沒讀，但**「這一版沒讀」不等於「下一版不會讀」**，所以每次
 *   換版本 MUST 重跑一次這個確認
 * - 畫面掛在 **Shadow DOM**（上游 `mount.tsx` 自己 `attachShadow`），因此它的
 *   Tailwind preflight 不會外溢弄壞我們的全站樣式
 *
 * 這些是**這一版**的事實，不是承諾。真正的邊界仍然只有一道：它跟我們在同一個
 * document 裡，拿得到 `window`。要更強的隔離只能改成 sandboxed iframe，那是
 * 日後若上游開始連網時 MUST 走的路。
 *
 * ## 掛載時機
 *
 * 上游的 `boot()` 在 script 執行當下就 `querySelectorAll('[data-within-reach]')`，
 * 掃到什麼掛什麼——**它不會等**。所以 script MUST 在容器進 DOM 之後才附加，
 * 也就是這裡放在 `useEffect` 而不是 JSX 裡的原因。
 *
 * 離開頁面時把 script 元素移除；下次進來再插一個新的。同一個 src 的 script
 * 元素重新插入會重新執行（檔案由瀏覽器快取供應，不會再下載一次），這正是
 * 重新掛載所需要的——上游沒有匯出任何可重複呼叫的 mount API。
 */
import { useEffect, useRef, useState } from 'react'

import { panelClass } from '../lib/surfaces'

/** ⚠️ 絕對路徑。`./wr-widget.js` 會相對**當前網址**解析，在 `/rooms/:id` 這種
 *  巢狀路由下會去要 `/rooms/wr-widget.js` 而 404。 */
const WIDGET_SRC = '/wr-widget.js'

/** 對應上游 `src/data/hotels.ts` 的 `id`。找不到時上游只在 console 記一筆並
 *  靜默返回，畫面上不會有任何東西——因此這個值改動時 MUST 對照上游確認。 */
const HOTEL_ID = 'sunmoon-hanguang'

export function WithinReach() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const script = document.createElement('script')
    script.src = WIDGET_SRC
    // 載不到時要說出來。靜靜留一塊空白，使用者只會看到頁面壞了而不知道為什麼。
    script.addEventListener('error', () => {
      setFailed(true)
    })
    document.body.appendChild(script)

    return () => {
      script.remove()
    }
  }, [])

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-lg text-ink">無障礙檢測</h1>
      <p className="mt-gap-2 text-small text-ink-muted">
        由 Within Reach 提供的空間可及性評估。檢測結果與量測標準由該服務負責，
        Sunny 不修改也不重新詮釋其判定。
      </p>

      {failed ? (
        <div role="alert" className={`mt-gap-4 ${panelClass} p-gap-4`}>
          <p className="text-small text-ink">檢測元件載入失敗，請重新整理頁面再試一次。</p>
        </div>
      ) : (
        /*
         * ⚠️ 這個 `<div>` 的內部由外部程式碼接管（它會在上面 `attachShadow`）。
         * MUST NOT 給它 children，也 MUST NOT 讓 React 依狀態改寫它的內容——
         * React 的 reconciler 與 Shadow DOM 各自為政，兩邊同時動同一個節點
         * 會讓 widget 在重新渲染後憑空消失。
         */
        <div
          ref={hostRef}
          className="mt-gap-4"
          data-within-reach
          data-hotel={HOTEL_ID}
        />
      )}
    </div>
  )
}
