/**
 * 無障礙檢測的浮球與浮窗。**外殼是我們的，內容是外部的。**
 *
 * 取代原本的 `/risk-check` 獨立頁面（憲章 4.0.0 起改嵌外部元件）。改成浮球之後
 * 檢測隨時可叫出來，不必離開正在看的房源——而「離開房源頁去查無障礙，回來時
 * 篩選條件還在不在」正是獨立頁面最容易出錯的地方。
 *
 * ## 為什麼外殼要自己寫
 *
 * 上游其實有一個浮動版本（`src/components/FloatingWidget.tsx`），但**它沒有進
 * embed 的打包**：`vite.widget.config.ts` 的進入點是 `src/embed/mount.tsx`，
 * 而那支渲染的是內嵌面板版的 `Widget`。要用上游的浮動版就得改上游的進入點，
 * 那是他們的檔案。
 *
 * 因此這裡只做外殼——浮球、浮窗、焦點管理、Esc 關閉——內容仍然原封不動地
 * 交給 `wr-widget.js`。這條界線 MUST 保持：**我們不改寫、不重新詮釋、也不
 * 遮蓋它的任何輸出**，包含它自己掛的免責聲明（那是它的 FR-006）。
 *
 * ## 掛載時機與重複開關
 *
 * 上游的 `boot()` 在 script 執行當下就掃 `[data-within-reach]`，掃到什麼掛
 * 什麼，**它不會等**。所以容器 MUST 先進 DOM，script 才能附加——也就是浮窗
 * 打開後才在 effect 裡插 script 的原因。
 *
 * 關閉時把 script 元素移除；下次打開再插一個新的。同一個 src 的 script 元素
 * 重新插入會重新執行（檔案由瀏覽器快取供應），這正是重新掛載所需要的——上游
 * 沒有匯出任何可重複呼叫的 mount API。
 *
 * ## 來源與查核（憲章原則 VI「嵌入的第三方元件」）
 *
 * 上游：https://github.com/CHUN9701/within-reach
 * 建置：`npm run build:widget` → `dist-widget/wr-widget.js`
 * 落點：`frontend/public/wr-widget.js`(進版控，隨我們的站台一起部署)
 * 來源 commit：46341f1c93e0625ba916d460edeac7590d5267cc(2026-08-05)
 *
 * ⚠️ **MUST NOT 改成指向對方主機的網址。** `<script src>` 每次載入都抓當下
 * 最新的檔案，指向外部等於把「這頁跑什麼程式」的決定權長期讓出去。更新版本
 * 就重跑一次上游的 `build:widget`，換掉檔案並更新上面的 commit。
 *
 * 逐檔追過 `src/embed/mount.tsx` 的相依圖，**這一版**的事實：
 *
 * - 無 `fetch`／`XMLHttpRequest`／`WebSocket`／`sendBeacon`，評估資料全部打包
 *   在 bundle 裡（`data/hotels.ts`）
 * - 無 `localStorage`／`sessionStorage`／`document.cookie`。這點是關鍵：我們的
 *   JWT 存在 `localStorage`(`api/client.ts`)，同頁的第三方程式讀得到
 * - ⚠️ **但它會載入外部圖片。** 房源照片指向 `https://images.unsplash.com`，
 *   Unsplash 會拿到訪客的 IP 與 referrer。沒有資料被送出去，但有訪客被暴露，
 *   兩者不一樣。MUST NOT 把本元件描述為「零外部請求」
 *
 * 這些是這一版的事實，不是承諾。**每次更新版本 MUST 重跑一次這個查核**——
 * 「上一版是乾淨的」不構成略過的理由。真正的邊界仍然只有一道：它跟我們在
 * 同一個 document 裡，拿得到 `window`。要更強的隔離只能改成 sandboxed iframe，
 * 那是上游一旦開始送資料時 MUST 走的路。
 */
import { useEffect, useId, useRef, useState } from 'react'

import { panelClass } from '../lib/surfaces'

/** ⚠️ 絕對路徑。`./wr-widget.js` 會相對**當前網址**解析，在 `/rooms/:id`
 *  這種巢狀路由下會去要 `/rooms/wr-widget.js` 而 404。 */
const WIDGET_SRC = '/wr-widget.js'

/** 對應上游 `src/data/hotels.ts` 的 `id`。找不到時上游只在 console 記一筆並
 *  靜默返回，浮窗裡會是一片空白——因此這個值改動時 MUST 對照上游確認。 */
const HOTEL_ID = 'sunmoon-hanguang'

/**
 * 無障礙標章（輪椅圖示）。
 *
 * 沿用國際通用的 International Symbol of Access 的構圖——頭、身體、推行的手臂
 * 與輪圈——但**是自己畫的路徑，不是官方檔案**。理由：專案沒有圖示函式庫，
 * 而憲章的前端約束是「UI 函式庫預設不引入」；為了一顆按鈕裝一整包
 * `lucide-react` 不划算（上游的 `FloatingWidget` 是那樣做的，那是他們的取捨）。
 *
 * `aria-hidden`：圖示不提供無障礙名稱，名稱在按鈕的 `aria-label` 上。兩邊都給
 * 會讓讀屏唸兩次。
 */
function AccessibilityMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7">
      {/* 頭 */}
      <circle cx="13" cy="3.5" r="2.2" fill="currentColor" />
      {/* 軀幹 → 座面 → 小腿與踏板，一筆到底。
          `strokeLinejoin="round"` 讓兩個轉角圓潤，接近標章的實心剪影，
          又不必維護一整塊填色路徑。 */}
      <path
        d="M13 6.6v5h4.5l2 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 輪圈。⚠️ **刻意畫成完整的圓，且與軀幹交疊。**
          試過把輪子改成弧線來避開交疊，結果那個缺口在小尺寸下看起來像圖沒畫完；
          交疊反而正是標章原本的樣子——人坐在輪子裡。 */}
      <circle cx="10.8" cy="16.6" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export function WithinReachFab() {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  // --- 載入 widget。浮窗打開時才插，關閉時移除。
  useEffect(() => {
    if (!open) return

    const script = document.createElement('script')
    script.src = WIDGET_SRC
    // 載不到時要說出來。靜靜留一塊空白，使用者只會看到浮窗壞了而不知道為什麼。
    script.addEventListener('error', () => {
      setFailed(true)
    })
    document.body.appendChild(script)

    return () => {
      script.remove()
    }
  }, [open])

  // --- Esc 關閉，並把焦點還給浮球（憲章原則 V）。
  //
  // ⚠️ 焦點 MUST 交還。少了這一步，鍵盤使用者關掉浮窗後焦點落在 `<body>`，
  // 下一次 Tab 會從整頁最上面重新開始——他得再走一次整排導覽才回得到原處。
  useEffect(() => {
    if (!open) return

    // 在 effect 內取出節點再用於 cleanup。cleanup 執行時 `triggerRef.current`
    // 可能已經換人——這裡的浮球其實一直掛著、不會換，但依賴那個事實等於把
    // 正確性寄託在別處的渲染條件上。
    const trigger = triggerRef.current

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)

    closeRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [open])

  return (
    <>
      {/* ---------- 浮球 ---------- */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        // `bottom-6 right-6`：避開頁尾內容。z-40 在 Header 的 z-10 之上、
        // 浮窗的 z-50 之下。
        //
        // `size-14` + `rounded-full`：正圓。⚠️ 尺寸 MUST NOT 再縮——56px 是
        // 觸控目標的下限附近，而浮球正是拇指要按的東西。
        //
        // ⚠️ 這裡**刻意不用 `primaryButtonClass`**：那個常數帶著
        // `px-gap-5 py-gap-2` 與 `rounded-pill`，套在固定尺寸的正圓上，內距會
        // 把圖示擠小，而兩個圓角 utility 誰贏取決於產生的 CSS 順序——那種
        // 「看起來對了但沒有人決定過」的東西正是版面條文要避免的。
        // 顏色仍用同一組 token，所以它跟主要按鈕還是同一套視覺語彙。
        className="fixed right-6 bottom-6 z-40 grid size-14 place-items-center rounded-full bg-brand text-ink-invert shadow-soft transition-colors hover:bg-brand-strong"
        // ⚠️ 圖示按鈕沒有文字，無障礙名稱只能靠這裡。少了它，讀屏使用者聽到的
        // 是「按鈕」兩個字——而這顆按鈕的整個用途就是無障礙。
        aria-label="無障礙檢測"
        title="無障礙檢測"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <AccessibilityMark />
      </button>

      {/* ---------- 浮窗 ---------- */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-gap-4">
          {/*
            遮罩。點擊關閉是滑鼠使用者的期待。

            ⚠️ 用 `<button>` 而不是 `<div onClick>`：後者對鍵盤與讀屏使用者
            等於不存在，而 T171 的稽核（`__tests__/accessibility.test.ts`）
            正是擋這件事。讀屏使用者因此會多聽到一個關閉鈕——比起一個按不到
            的關閉方式，多一個是比較好的那一邊。
          */}
          <button
            type="button"
            className="absolute inset-0 bg-ink/50"
            onClick={() => {
              setOpen(false)
            }}
          >
            <span className="sr-only">關閉無障礙檢測</span>
          </button>

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`relative flex max-h-[90dvh] w-full max-w-3xl flex-col ${panelClass}`}
          >
            <div className="flex items-center justify-between gap-gap-3 border-b border-line-soft p-gap-4">
              <div>
                <h2 id={titleId} className="font-display text-md text-ink">
                  無障礙檢測
                </h2>
                {/* 憲章原則 VI「嵌入的第三方元件」：MUST 標明由外部服務提供。 */}
                <p className="mt-gap-1 text-tiny text-ink-muted">
                  由 Within Reach 提供，檢測結果與量測標準由該服務負責。
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => {
                  setOpen(false)
                }}
                className="rounded-xs px-gap-2 py-gap-1 text-small text-ink-muted hover:text-ink"
              >
                關閉
              </button>
            </div>

            {/* 內容可能很長（實測 1500px 以上），因此浮窗固定高度、內部自己捲。 */}
            <div className="overflow-y-auto p-gap-4">
              {failed ? (
                <p role="alert" className="text-small text-ink">
                  檢測元件載入失敗，請關閉後再試一次。
                </p>
              ) : (
                /*
                 * ⚠️ 這個 `<div>` 的內部由外部程式碼接管（它會在上面
                 * `attachShadow`)。MUST NOT 給它 children，也 MUST NOT 讓
                 * React 依狀態改寫它的內容——React 的 reconciler 與 Shadow DOM
                 * 各自為政，兩邊同時動同一個節點會讓 widget 憑空消失。
                 */
                <div data-within-reach data-hotel={HOTEL_ID} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
