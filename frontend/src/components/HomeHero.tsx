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
 */
import type { SiteContent } from '../api/types'

export function HomeHero({ content }: { content: SiteContent }) {
  const hasImage = content.heroImage !== ''

  return (
    <section
      // `w-screen` + `left-1/2 -translate-x-1/2`：破出 `<main>` 的內容欄，
      // 回到視窗寬度。橫向溢出由 body 的 `overflow-x: clip` 裁掉。
      className="relative left-1/2 -mt-gap-6 w-screen -translate-x-1/2 overflow-hidden bg-forest"
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
