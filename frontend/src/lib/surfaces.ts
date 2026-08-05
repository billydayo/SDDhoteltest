/**
 * 全站共用的容器與按鈕樣式。
 *
 * ## 為什麼要有這個檔案
 *
 * 首頁那一套（拱形卡片、`rounded-lg` 的白底面板、`shadow-soft`、膠囊按鈕）
 * 原本只寫在 `components/RoomCard.tsx` 與 `components/FilterBar.tsx` 的行內
 * class 字串裡。後台與後來加的幾頁各自抄了一份**近似但不相同**的版本——
 * 圓角小一級、少了陰影、字級小一級、內距緊一級。
 *
 * 每一處單獨看都合理，合在一起就是「這一頁看起來不像同一個網站」。而這種
 * 落差不會有任何錯誤、不會有測試失敗，只有人眼看得出來，因此它會一直留著。
 *
 * ⚠️ **新的容器 MUST 引用這裡的常數，MUST NOT 再抄一份字串。**
 * 抄一份的成本是零，維護的成本是下一次有人只改了其中三處。
 *
 * ## 兩種面板的分工
 *
 * - `panelClass`：**浮在頁面上的東西**。白底、有陰影。卡片、篩選列、表格。
 * - `insetClass`：**嵌在頁面裡的東西**。砂色底、無陰影。摘要區塊、說明框。
 *
 * 兩者都給陰影的話，畫面會變成一堆互相競爭的浮層；都不給的話，主要內容
 * 與附註就分不出層次。
 */

/**
 * 頁面外殼的量測線：**寬度隨視窗，只留左右內距**。
 *
 * ⚠️ **這裡 MUST NOT 出現 `max-w-*`**（憲章原則 V「版面寬度隨視窗調整」）。
 * 原本四處各寫一份 `mx-auto max-w-7xl px-gap-5`，在 1920px 螢幕上兩側各留
 * 320px 空白，而使用者要看的房源被擠在中間。
 *
 * 需要收窄的是**個別區塊**——長文、單欄表單——由該區塊自己用
 * `max-w-(--container-measure)` 或 `max-w-2xl` 收，而不是把整個外殼封頂。
 * 兩者的差別是「這頁的內容適合多寬」與「這個網站最寬只能多寬」。
 *
 * 頁首、`<main>`、頁尾與首頁主視覺的內層 MUST 共用這一個常數。四處各寫一份的
 * 話，下次只會有三處被改到，於是主視覺標題比下方內容偏一兩公分——那種錯位
 * 不會有測試發現，只有人眼看得出來。
 */
export const shellClass = 'w-full px-gap-5'

/** 浮起的白底面板：卡片、篩選列、表格外殼。 */
export const panelClass = 'rounded-lg border border-line-soft bg-surface shadow-soft'

/**
 * 拱頂卡片：底色、框線、陰影與 `panelClass` 完全相同，只有頂端是拱形。
 * 首頁房源卡與其載入骨架用它。
 *
 * ⚠️ **MUST NOT 寫成 `` `${panelClass} arch-panel` ``。** 兩者都設 border-radius，
 * 誰贏取決於 CSS 產生順序而不是 class 字串順序——會變成偶爾是圓角、偶爾是拱。
 * 因此這裡重列一份不含 `rounded-lg` 的字串；**改動 `panelClass` 時要一併改這裡。**
 */
export const archPanelClass = 'arch-panel border border-line-soft bg-surface shadow-soft'

/** 嵌入的砂色區塊：摘要、說明、次要資訊。**刻意沒有陰影。** */
export const insetClass = 'rounded-lg border border-line-soft bg-surface-alt'

/**
 * 主要行動按鈕。
 *
 * ⚠️ 停用時用 `bg-line-strong` 而非 `opacity-50`：半透明的黃銅在砂色底上
 * 仍然看起來像可以按，而灰色不會。
 */
export const primaryButtonClass =
  'rounded-pill bg-brand px-gap-5 py-gap-2 text-small text-ink-invert transition-colors' +
  ' hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line-strong'

/** 次要按鈕：外框膠囊。 */
export const subtleButtonClass =
  'rounded-pill border border-line-strong px-gap-5 py-gap-2 text-small text-ink-muted' +
  ' transition-colors hover:border-brand hover:text-brand-strong' +
  ' disabled:cursor-not-allowed disabled:opacity-50'

/** 危險操作：**外框而非填色**——填滿的紅色按鈕會吸引誤觸。 */
export const dangerButtonClass =
  'rounded-pill border border-danger/40 px-gap-5 py-gap-2 text-small text-danger transition-colors' +
  ' hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50'

/** 條件標籤、房型標籤那一類的小膠囊。 */
export const tagClass = 'rounded-pill bg-surface-alt px-gap-3 py-gap-1 text-small text-ink-muted'
