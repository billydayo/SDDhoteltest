/**
 * 無障礙檢測的浮球與浮窗。**外殼是我們的，內容在對方的 origin 上。**
 *
 * 取代原本的 `/risk-check` 獨立頁面（憲章 4.0.0 起改嵌外部元件）。改成浮球之後
 * 檢測隨時可叫出來，不必離開正在看的房源——而「離開房源頁去查無障礙，回來時
 * 篩選條件還在不在」正是獨立頁面最容易出錯的地方。
 *
 * ## 2026-08-05：從自行 host 的 bundle 改為跨來源 iframe
 *
 * 舊做法是把上游 `npm run build:widget` 的產物（`public/wr-widget.js`）進版控，
 * 浮窗打開時插一個 `<script>` 讓它在**我們的 document 裡**渲染。那個做法換到的
 * 是「這頁跑什麼程式由我們決定」，付出的是「那段程式跟我們的 JWT 在同一個
 * `localStorage` 裡」——所以才需要每次更新都逐檔查核相依圖。
 *
 * 現在指向對方的線上部署，兩邊都反過來了。**這不是升級，是換一種代價**，
 * 兩個方向都要說清楚：
 *
 * - 換到的：程式跑在 `within-reach-phi.vercel.app` 的 origin 上。同源政策讓它
 *   碰不到我們的 `localStorage`、`document.cookie` 與 DOM。相依圖查核因此不再
 *   是安全邊界所繫之處——邊界改由瀏覽器強制，而不是靠我們讀完他們的程式碼
 * - 付出的：**內容會隨對方改版即時變動，我們無從得知也無法回退。** 舊註解裡
 *   那句「MUST NOT 改成指向對方主機」講的正是這件事，而本次是刻意放棄它。
 *   影響範圍被限縮成「那塊畫面顯示什麼」，不再是「我們的頁面跑什麼程式」——
 *   代價變小了，但 MUST NOT 說成不存在
 * - 一併付出的：訪客的 IP 與 referrer 會給到 Vercel 與該站載入的第三方
 *   （目前為 Google Fonts 與 `images.unsplash.com`）。`referrerPolicy` 只擋得住
 *   referrer，擋不住 IP
 *
 * 憲章原則 VI「嵌入的第三方元件」v4.1.0 起把這兩種形式分開規範；本檔屬形式 B。
 *
 * ## 上游
 *
 * repo：https://github.com/CHUN9701/within-reach
 * 嵌入：https://within-reach-phi.vercel.app/ （上游自行部署於 Vercel）
 *
 * ⚠️ 那是**整個平台**，不是單一飯店的 widget。上游的線上版沒有路由、也不讀
 * query string（打包產物裡 `URLSearchParams` 只用於組出站的訂房連結），因此
 * **無法深連到某一間飯店**——舊做法的 `data-hotel="sunmoon-hanguang"` 沒有等
 * 價物，使用者會落在平台首頁自己找。要恢復深連得等上游提供帶參數的網址。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { panelClass } from '../lib/surfaces'

/**
 * ⚠️ 這個常數是本專案唯一允許被嵌入的外部來源（憲章原則 VI 形式 B 的具名白
 * 名單）。改動它等於換掉一個信任對象，MUST 同步更新憲章與 `spec.md` 的 FR-129。
 */
const WIDGET_ORIGIN = 'https://within-reach-phi.vercel.app'

/**
 * 逾時多久算「載不出來」。
 *
 * ⚠️ 跨來源 iframe **沒有可靠的失敗事件**：`onError` 幾乎不會觸發，而對方回
 * 500 錯誤頁時 `onLoad` 照樣會觸發。所以偵測不到「載壞了」，只偵測得到
 * 「到現在還沒載完」——這個逾時就是那條線。
 *
 * 12 秒偏長是刻意的：太短會讓行動網路上正常載入的人看到錯誤訊息，而那比多等
 * 幾秒更糟——他會直接關掉，以為這個功能壞了。
 */
const LOAD_TIMEOUT_MS = 12_000

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
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  /** 關閉並把載入狀態歸零。⚠️ 三個 setter MUST 一起——少歸零 `timedOut` 的話，
   *  逾時過一次之後再打開會直接顯示錯誤訊息，而那次其實還沒開始載。
   *
   *  用 `useCallback` 是因為下面的 Esc effect 要把它列進相依陣列。setter 本身
   *  就是穩定的，所以 `[]` 是對的；寫成一般函式則每次渲染都是新的一個，
   *  effect 會跟著重掛——而重掛的副作用是 `closeRef.current?.focus()` 再跑一次，
   *  使用者正在浮窗裡操作時焦點會被拉回關閉鈕。 */
  const close = useCallback(() => {
    setOpen(false)
    setLoaded(false)
    setTimedOut(false)
  }, [])

  // --- 載入逾時。見 `LOAD_TIMEOUT_MS`：這裡量的是「還沒載完」，不是「載壞了」。
  useEffect(() => {
    if (!open || loaded) return

    const timer = window.setTimeout(() => {
      setTimedOut(true)
    }, LOAD_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open, loaded])

  // --- Esc 關閉，並把焦點還給浮球（憲章原則 V）。
  //
  // ⚠️ 焦點 MUST 交還。少了這一步，鍵盤使用者關掉浮窗後焦點落在 `<body>`，
  // 下一次 Tab 會從整頁最上面重新開始——他得再走一次整排導覽才回得到原處。
  //
  // ⚠️ **已知限制：焦點進到 iframe 之後，Esc 不會傳到這裡。** 鍵盤事件由對方的
  // document 接走，我們的 `document` 收不到。關閉鈕仍然按得到（Shift+Tab 退出
  // frame 即可），但「Esc 隨時關得掉」這個期待在 frame 內不成立。這是跨來源
  // 隔離的直接後果，MUST NOT 用 `allow-same-origin` 以外的方式繞——沒有繞法。
  useEffect(() => {
    if (!open) return

    // 在 effect 內取出節點再用於 cleanup。cleanup 執行時 `triggerRef.current`
    // 可能已經換人——這裡的浮球其實一直掛著、不會換，但依賴那個事實等於把
    // 正確性寄託在別處的渲染條件上。
    const trigger = triggerRef.current

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)

    closeRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [open, close])

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
          <button type="button" className="absolute inset-0 bg-ink/50" onClick={close}>
            <span className="sr-only">關閉無障礙檢測</span>
          </button>

          {/*
            ⚠️ `max-w-6xl` + `h-[90dvh]`，比舊版的 `max-w-3xl` 大一號。

            舊版裝的是單一飯店的 widget，768px 綽綽有餘。現在裝的是對方的**整個
            平台**（有自己的頁首、導覽與清單），塞進 768px 會讓它自己先進入手機
            版排版，再被我們的浮窗夾一次。

            高度改成固定的 `h-[90dvh]` 而非 `max-h-`：iframe 要有確定的高度才撐
            得開，`max-h-` 之下內容高度由子元素決定，而跨來源的子元素量不到。
          */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`relative flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden ${panelClass}`}
          >
            <div className="flex items-center justify-between gap-gap-3 border-b border-line-soft p-gap-4">
              <div>
                <h2 id={titleId} className="font-display text-md text-ink">
                  無障礙檢測
                </h2>
                {/* 憲章原則 VI「嵌入的第三方元件」：MUST 標明由外部服務提供。
                    ⚠️ 這行字現在還多擔一件事：下方畫面**即時來自對方站台**，
                    我們沒有留存副本，內容可能隨時改變。 */}
                <p className="mt-gap-1 text-tiny text-ink-muted">
                  以下畫面即時載入自外部服務 Within Reach，檢測結果與量測標準由該服務負責。
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="rounded-xs px-gap-2 py-gap-1 text-small text-ink-muted hover:text-ink"
              >
                關閉
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              {timedOut && !loaded ? (
                <p role="alert" className="p-gap-4 text-small text-ink">
                  檢測服務目前連不上，請稍後再試。
                </p>
              ) : (
                <>
                  {/*
                   * ⚠️ `sandbox` 的每一項都是刻意的，MUST NOT 為了「先讓它動」
                   * 而整個拿掉：
                   *
                   * - `allow-scripts`：對方是 SPA，沒有它是一片空白
                   * - `allow-same-origin`：讓 frame 保有**它自己的** origin，
                   *   它才用得了自己的儲存。⚠️ 這一項在**同源**內容上會等於
                   *   完全解除沙箱，但這裡是跨來源，因此它給的仍然是對方的
                   *   origin，碰不到我們
                   * - `allow-forms`／`allow-popups`：站上有搜尋與外連的訂房連結
                   * - **沒有** `allow-top-navigation`：這是本組裡最要緊的一項。
                   *   少了它，frame 裡的程式可以把**我們的**整頁導去別處，而
                   *   使用者看到的網址列從頭到尾都是我們的網域
                   * - **沒有** `allow-modals`／`allow-downloads`
                   *
                   * `referrerPolicy`：不把使用者正在看哪一間房的網址交出去。
                   * 擋不住 IP——那個沒有辦法，見檔頭。
                   */}
                  <iframe
                    src={WIDGET_ORIGIN}
                    title="Within Reach 無障礙檢測"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    referrerPolicy="no-referrer"
                    className="size-full border-0"
                    onLoad={() => {
                      setLoaded(true)
                    }}
                  />
                  {!loaded && (
                    // 蓋在 iframe 上而不是取代它——取代的話 iframe 要等這個狀態
                    // 變了才開始載，而它永遠不會變（`onLoad` 來自那個 iframe）。
                    <p className="absolute inset-0 grid place-items-center bg-surface text-small text-ink-muted">
                      載入中…
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
