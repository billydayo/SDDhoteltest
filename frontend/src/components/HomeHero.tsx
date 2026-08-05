/**
 * T142：首頁的滿版主視覺（FR-061、FR-061a）。
 *
 * ⚠️ **這是元件，不是頁面。** 首頁本身（`pages/Home.tsx`）屬於 T056。
 * 主視覺的內容由後台編輯（`pages/admin/Content.tsx`），因此它跟著內容編輯
 * 一起做，Home 只要把它放在最上面。
 *
 * ## 三個硬性條件（FR-061a）
 *
 * 1. **滿版**——寬度是視窗寬度，不是內容欄的寬度
 * 2. **隨視窗寬度連續縮放**——`clamp()` 而非幾個斷點之間的跳動
 * 3. **MUST NOT 產生橫向捲動**
 *
 * 第 1 與第 3 點會互相打架：`100vw` **含捲軸寬度**，在有捲軸的視窗上會比可用
 * 寬度多出約 15px。解法在 `styles/index.css` 的 `body { overflow-x: clip }`
 * ——用 `clip` 而不是 `hidden`，因為 `hidden` 會建立捲動容器，而那會讓頁首的
 * `position: sticky` 失效。
 *
 * ## 標題與頁面其餘內容對齊同一條量測線
 *
 * 底圖破出到視窗邊緣，**文字沒有**：內層再收回 `max-w-7xl px-gap-5`，
 * 與 `router.tsx` 的 `<main>` 完全相同。少了這一步，標題會比下方的內容更靠
 * 左邊一截，而那種一兩公分的錯位看起來就是「沒做完」。
 *
 * ## `fullBleed` 為什麼要能關掉
 *
 * `w-screen` + `left-1/2 -translate-x-1/2` 這組手法有一個**沒有寫出來的前提**：
 * 父層在視窗裡是置中的。那時父層中心等於視窗中心，往左推 50vw 剛好落在 0。
 *
 * 前台成立，後台的預覽框不成立——側邊欄把內容欄推向右邊。實測 1425px 視窗：
 * 預覽框中心在 849px，視窗中心 712.5px，差 136.5px，於是整塊主視覺右移，
 * 右邊 136px 掉到視窗外，左邊被預覽框的 `overflow-hidden` 裁掉同樣的 136px，
 * **標題兩側各少一截**（responsive-audit 於 1024／1440／1920px 各記一筆）。
 *
 * 那個 `overflow-hidden` 擋得住滿版外溢，擋不住**偏移**，而偏移才是問題。
 * 因此把 full-bleed 變成可關閉的，關掉時單純填滿父層——這讓「父層是否置中」
 * 從一個藏在 class 名稱裡的假設，變成呼叫端要明講的一件事。
 */
import type { SiteContent } from '../api/types'

export function HomeHero({
  content,
  fullBleed = true,
}: {
  content: SiteContent
  /** 破出內容欄回到視窗寬度。**僅在父層於視窗中置中時成立**，後台預覽 MUST 關閉。 */
  fullBleed?: boolean
}) {
  const hasImage = content.heroImage !== ''

  return (
    <section
      // `w-screen` + `left-1/2 -translate-x-1/2`：破出 `<main>` 的內容欄，
      // 回到視窗寬度。橫向溢出由 body 的 `overflow-x: clip` 裁掉。
      className={`relative -mt-gap-6 overflow-hidden bg-forest ${
        fullBleed ? 'left-1/2 w-screen -translate-x-1/2' : 'w-full'
      }`}
      aria-label="主視覺"
    >
      {hasImage && (
        <img
          src={content.heroImage}
          // ⚠️ 主視覺沒有 `alt` 是最常見的無障礙缺失（憲章原則 V）。
          // 它承載的是氛圍而非資訊，但「氛圍」也要說得出來。
          alt={`${content.heroTitle}的情境照片`}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* 圖片上的白字需要一層壓暗才可能達到 4.5:1。沒有圖時底色本身已經夠深。 */}
      {hasImage && <div aria-hidden="true" className="absolute inset-0 bg-forest-strong/55" />}

      <div className="relative mx-auto max-w-7xl px-gap-5 py-[clamp(4rem,14vw,10rem)]">
        {/* `text-display` 是 `clamp(2.2rem, 5.5vw, 3.4rem)`——**連續**縮放，
            不是幾個斷點之間的跳動（`styles/index.css`）。 */}
        <h1 className="max-w-measure font-display text-display text-ink-invert">
          {content.heroTitle}
        </h1>
        {content.heroSubtitle !== '' && (
          <p className="mt-gap-4 max-w-measure text-md text-ink-invert/90">
            {content.heroSubtitle}
          </p>
        )}
      </div>
    </section>
  )
}
