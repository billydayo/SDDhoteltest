/**
 * 首頁相簿——橫向滑動的影像帶，位置在房源列表之後、頁尾之前。
 *
 * ## 為什麼不用輪播套件
 *
 * 需要的東西（snap、拖曳、觸控、箭頭、進度）加起來不到兩百行，而任何一個
 * 輪播套件都是數十 KB 的外部依賴，還要花時間覆蓋它的預設樣式。**觸控滑動
 * 根本不需要 JS**——瀏覽器原生的慣性捲動比任何模擬都好，所以下面那段拖曳
 * 處理刻意只接非觸控的指標裝置。
 *
 * ## 圖片是靜態檔，不是 API 資料
 *
 * 七張圖住在 `public/gallery/`，說明文字在下面的 `GALLERY` 裡。這是刻意的：
 * 它們是**場域氛圍**（大廳、走廊、餐點、海岸），不是房源——房源已經在這一區
 * 上方列過一次了，再放一次只是同一批照片出現兩遍。
 *
 * ⚠️ 因此它**不隨後台內容變動**。要換圖就換 `public/gallery/` 下的檔案並改
 * 這裡的 `caption`／`place`。檔名不承載語意，換圖時只動 `file` 那一欄。
 */
// ⚠️ `PointerEvent` MUST 從 react 具名匯入，MUST NOT 寫成 `React.PointerEvent`。
// 專案是 `jsx: react-jsx`，檔案裡沒有 `import React`，而 `React.` 會被當成
// UMD 全域引用——在模組檔案裡那是型別錯誤，訊息看起來像是 React 沒裝好。
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

import { shellClass } from '../lib/surfaces'

interface GalleryItem {
  /** `public/gallery/` 底下的檔名 */
  readonly file: string
  readonly caption: string
  /** 場域標籤，全大寫小字。刻意用英文——它是裝飾性的層次標記，不是內容 */
  readonly place: string
}

const GALLERY: readonly GalleryItem[] = [
  { file: 'pexels-cheng-shi-song-427082720-35022074.jpg', caption: '雅致室內休憩區', place: 'Lounge' },
  { file: '1.jpg', caption: '挑高奢華大廳', place: 'Lobby' },
  { file: '2.jpg', caption: '典雅走廊燈飾', place: 'Corridor' },
  { file: '3.jpg', caption: '精緻點心與鮮果汁', place: 'Dining' },
  { file: '4.jpg', caption: '河畔景觀早餐', place: 'Breakfast' },
  { file: 'pexels-samlin-32574212.jpg', caption: '東北角陰陽海海岸', place: 'Northeast Coast' },
  { file: 'pexels-worawat-li-2154715066-33474517.jpg', caption: '池上伯朗大道田園', place: 'Chishang' },
]

/** 卡片間距。**MUST 與軌道的 `gap-gap-4`（1rem = 16px）一致**——捲動一次要移動
 *  「幾張卡的寬度」，算式裡少了間距就會每捲一次偏移一點，捲到後面整個對不齊。 */
const GAP_PX = 16

/** 使用者要求減少動態時，平滑捲動要真的關掉。
 *
 *  ⚠️ `styles/index.css` 那條 `scroll-behavior: auto !important` 管不到這裡：
 *  CSS 的 scroll-behavior 只在捲動請求沒有指定 behavior 時生效，而 JS 明寫
 *  `behavior: 'smooth'` 會蓋過它。所以要在 JS 這一側自己判斷。 */
function scrollBehavior(): ScrollBehavior {
  // jsdom 沒有實作 `matchMedia`，缺的那一份補在 `test/setup.ts`——
  // 測試環境的缺口不該讓正式碼多一道判斷。
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

// ---------------------------------------------------------------------------
/**
 * 單張影像。載入失敗時把 `<img>` 藏起來，露出底下的漸層底色。
 *
 * ⚠️ **不留破圖。** 外部檔案缺失時瀏覽器畫的是一個裂圖示與 alt 文字，
 * 在一整排照片中間特別顯眼，看起來像網站壞了——而實際上只是少一個檔案。
 */
function GalleryImage({ item, eager, className }: { item: GalleryItem; eager: boolean; className: string }) {
  const [failed, setFailed] = useState(false)

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-linear-to-br from-surface-deep to-surface-alt shadow-soft ${className}`}
    >
      {!failed && (
        <img
          src={`/gallery/${item.file}`}
          alt={item.caption}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // 少了這行，拖曳滑動會被瀏覽器接管成「拖曳圖片」，軌道就不動了
          draggable={false}
          onError={() => {
            setFailed(true)
          }}
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-brand group-hover:scale-105"
        />
      )}
    </div>
  )
}

function Caption({ item }: { item: GalleryItem }) {
  return (
    <span className="flex flex-col gap-gap-1 text-left">
      <span className="text-tiny font-semibold uppercase tracking-[0.18em] text-brand">
        {item.place}
      </span>
      <span className="text-body text-ink">{item.caption}</span>
    </span>
  )
}

function ChevronIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-4 ${flipped ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
/**
 * 全部影像的燈箱。
 *
 * 用原生 `<dialog>` + `showModal()`，**不是自己刻的浮層**：焦點鎖定、Esc 關閉、
 * 背景 inert 與 `::backdrop` 全都由瀏覽器提供。自己刻這四件事大概兩百行，
 * 而其中「焦點跑到背景去了」這種錯誤只有純鍵盤使用者會遇到，幾乎不會被回報。
 */
function Lightbox({
  openIndex,
  onClose,
}: {
  /** `null` 表示關閉；數字表示開啟並捲到第幾張 */
  openIndex: number | null
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    if (openIndex === null) {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.showModal()
    // 捲到被點擊的那一張，使用者才不會失去位置感。要等版面完成才量得到。
    requestAnimationFrame(() => {
      gridRef.current?.children[openIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    })
  }, [openIndex])

  return (
    <dialog
      ref={dialogRef}
      aria-label="全部影像"
      // ⚠️ `close` 事件涵蓋 Esc 與 `close()` 兩種來源。只監聽 `cancel`（Esc）
      // 的話，按了關閉鈕之後 React 狀態仍是「開著」，再點同一張圖不會有反應。
      onClose={onClose}
      className="m-auto max-h-[90dvh] w-[min(92vw,80rem)] rounded-lg bg-bg p-0 text-ink shadow-float backdrop:bg-forest-strong/60"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex items-start justify-between gap-gap-4 border-b border-line px-gap-5 py-gap-4">
          <div>
            <p className="text-tiny font-semibold uppercase tracking-[0.18em] text-brand">Gallery</p>
            <h2 className="font-display text-h2">全部影像</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉相簿"
            className="rounded-pill border border-line-strong px-gap-4 py-gap-1 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            關閉
          </button>
        </div>

        <div
          ref={gridRef}
          className="grid flex-1 gap-gap-4 overflow-y-auto p-gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]"
        >
          {GALLERY.map((item, i) => (
            <figure key={item.file} className="m-0 flex flex-col gap-gap-2">
              <GalleryImage item={item} eager={i < 4} className="h-[clamp(12rem,26vh,18rem)]" />
              <figcaption>
                <Caption item={item} />
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </dialog>
  )
}

// ---------------------------------------------------------------------------
export function HomeGallery() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const [ratio, setRatio] = useState(0)
  const [current, setCurrent] = useState(1)

  /** 拖曳中的暫存。放 ref 不放 state——它每次 pointermove 都變，
   *  進 state 會讓整個相簿在拖曳過程中每幀重繪一次。 */
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false })

  const cardWidth = useCallback(() => {
    const first = trackRef.current?.querySelector<HTMLElement>('[data-gallery-card]')
    return first === null || first === undefined ? 320 : first.offsetWidth + GAP_PX
  }, [])

  /** 一次捲動幾張：填滿可視寬度，至少一張。 */
  const step = useCallback(() => {
    const track = trackRef.current
    if (track === null) return cardWidth()
    return Math.max(1, Math.floor(track.clientWidth / cardWidth())) * cardWidth()
  }, [cardWidth])

  const sync = useCallback(() => {
    const track = trackRef.current
    if (track === null) return

    const max = track.scrollWidth - track.clientWidth
    // 1px 容差：`scrollLeft` 在部分縮放比例下是小數，嚴格比較會讓箭頭在真正
    // 到底時仍然可按——按了沒反應比直接停用更讓人以為是壞了。
    setAtStart(track.scrollLeft <= 1)
    setAtEnd(track.scrollLeft >= max - 1)
    // 取到小數三位。`scrollLeft` 每一幀都是新的小數，不四捨五入的話整個相簿
    // 會在捲動期間每幀重繪一次，而畫面上根本看不出那點差別。
    setRatio(max > 0 ? Math.round((track.scrollLeft / max) * 1000) / 1000 : 0)
    setCurrent(Math.min(GALLERY.length, Math.max(1, Math.round(track.scrollLeft / cardWidth()) + 1)))
  }, [cardWidth])

  useEffect(() => {
    sync()
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('resize', sync)
    }
  }, [sync])

  const scrollByStep = useCallback(
    (dir: 1 | -1) => {
      trackRef.current?.scrollBy({ left: dir * step(), behavior: scrollBehavior() })
    },
    [step],
  )

  // ---- 滑鼠拖曳。觸控不接：原生慣性捲動比任何模擬都好 ----
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return
    const track = trackRef.current
    if (track === null) return
    drag.current = { active: true, startX: e.clientX, startScroll: track.scrollLeft, moved: false }
    // scroll-snap 會在拖曳中一直把位置吸回去，拖起來會頓。放手再開回來。
    track.style.scrollSnapType = 'none'
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!drag.current.active || track === null) return
    const dx = e.clientX - drag.current.startX
    // 6px 門檻：低於這個距離視為手抖，仍然算點擊
    if (Math.abs(dx) > 6) drag.current.moved = true
    track.scrollLeft = drag.current.startScroll - dx
  }

  const endDrag = () => {
    const track = trackRef.current
    if (!drag.current.active || track === null) return
    drag.current.active = false
    track.style.scrollSnapType = ''

    // `scroll-snap-type: mandatory` 會把「不到半張」的拖曳整個彈回原位。
    // 規範上正確，手感上錯誤——使用者明明拖了快半張，放手後什麼都沒發生。
    // 超過四分之一張就順著方向補進一張，讓意圖被實現。
    const moved = track.scrollLeft - drag.current.startScroll
    const cw = cardWidth()
    if (Math.abs(moved) > cw * 0.25 && Math.abs(moved) < cw * 0.5) {
      track.scrollTo({
        left: drag.current.startScroll + (moved > 0 ? cw : -cw),
        behavior: scrollBehavior(),
      })
    }
  }

  return (
    // 破出 `<main>` 的內容欄回到視窗寬度，讓砂色底成為一條通欄的帶子。
    // 手法與 `HomeHero` 相同，前提也相同：父層在視窗中置中。
    <section
      aria-labelledby="galleryTitle"
      className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden bg-surface-alt py-gap-8"
    >
      <div className={`flex flex-wrap items-end justify-between gap-gap-4 ${shellClass}`}>
        <div>
          <p className="text-tiny font-semibold uppercase tracking-[0.18em] text-brand">Sunny Hotel</p>
          <h2 id="galleryTitle" className="font-display text-h1">
            Gallery
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpenIndex(0)
          }}
          className="flex items-center gap-gap-2 text-small text-ink-muted transition-colors hover:text-ink"
        >
          View all
          <ChevronIcon />
        </button>
      </div>

      {/*
        軌道刻意放在外殼**之外**並自帶左右內距：卡片因此能一路滑到螢幕邊緣，
        而第一張仍與上方標題切齊同一條左緣。放進外殼裡的話兩側會各留一段空白，
        看起來像被框住的縮圖列而不是一條影像帶。
      */}
      <div
        ref={trackRef}
        role="group"
        aria-label="相簿橫向捲動區，可拖曳或使用左右方向鍵"
        tabIndex={0}
        onScroll={sync}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            scrollByStep(1)
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            scrollByStep(-1)
          }
        }}
        className={`no-scrollbar mt-gap-6 flex cursor-grab snap-x snap-mandatory gap-gap-4 overflow-x-auto overflow-y-hidden py-gap-1 active:cursor-grabbing ${shellClass}`}
      >
        {GALLERY.map((item, i) => (
          <button
            key={item.file}
            type="button"
            data-gallery-card
            aria-label={`放大檢視：${item.caption}`}
            onClick={() => {
              // 拖曳結束後瀏覽器仍會補一次 click。沒有這道防線的話，
              // 每次拖完放手都會跳出燈箱。
              if (drag.current.moved) {
                drag.current.moved = false
                return
              }
              setOpenIndex(i)
            }}
            // `flex-none` 不可省：flex 子項預設會被壓縮，七張卡會擠成七條細線。
            // `items-stretch` 也不可省：Chromium 的 UA 樣式表對 button 套了
            // `align-items: center`，少了它圖片盒不會在交叉軸拉伸。
            className="group flex w-[clamp(15.5rem,27vw,23.75rem)] flex-none snap-start flex-col items-stretch gap-gap-3 text-left"
          >
            <GalleryImage item={item} eager={i < 3} className="h-[clamp(18.75rem,34vw,25rem)]" />
            <Caption item={item} />
          </button>
        ))}
      </div>

      <div className={`mt-gap-5 flex items-center gap-gap-4 ${shellClass}`}>
        <div aria-hidden="true" className="h-0.5 min-w-16 flex-1 overflow-hidden rounded-pill bg-surface-deep">
          <div
            className="h-full origin-left bg-brand transition-transform duration-300 ease-brand"
            // 最低 0.08：進度條完全空掉時看起來像沒載入，而不是「在最前面」
            style={{ transform: `scaleX(${Math.max(0.08, ratio).toFixed(3)})` }}
          />
        </div>
        {/* ⚠️ 刻意**沒有** aria-live。它每捲一點就變一次，宣告出來會變成讀屏
            使用者耳邊持續不斷的「三之七、四之七⋯⋯」。方向資訊由兩顆箭頭的
            停用狀態表達，那個才是他們真正需要知道的。 */}
        <span className="shrink-0 text-tiny tabular-nums text-ink-muted">
          {current} / {GALLERY.length}
        </span>
        <button
          type="button"
          onClick={() => {
            scrollByStep(-1)
          }}
          disabled={atStart}
          aria-label="上一組影像"
          className={ARROW_CLASS}
        >
          <ChevronIcon flipped />
        </button>
        <button
          type="button"
          onClick={() => {
            scrollByStep(1)
          }}
          disabled={atEnd}
          aria-label="下一組影像"
          className={ARROW_CLASS}
        >
          <ChevronIcon />
        </button>
      </div>

      <Lightbox
        openIndex={openIndex}
        onClose={() => {
          setOpenIndex(null)
        }}
      />
    </section>
  )
}

/** 兩顆箭頭完全相同。停用時用實色淡化而非 `opacity`——半透明的框在砂色底上
 *  仍然看起來可以按。 */
const ARROW_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-pill border border-line-strong text-ink-muted' +
  ' transition-colors hover:border-brand hover:text-brand-strong' +
  ' disabled:cursor-not-allowed disabled:border-line disabled:text-line-strong'
