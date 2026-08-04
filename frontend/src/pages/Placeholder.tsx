/**
 * 尚未建立的頁面的暫時內容。
 *
 * ⚠️ **這是過渡物件，每一個都會被對應任務的真實頁面取代。**
 * 路由表（T040）必須先完整存在，守衛才有東西可守；但頁面本身分屬 US1–US12。
 * 與其讓路由表殘缺、之後再回頭補，不如先把骨架接通，讓每個頁面任務只需
 * 替換 `element`。
 *
 * 明白寫出「尚未建立」而不是留白：留白的畫面會被當成壞掉。
 *
 * `level` 供後台使用：後台是一個主控台的十二個區塊，`h1` 是「後台」本身，
 * 各模組為 `h2`（`pages/admin/AdminLayout.tsx`）。一頁兩個 `h1` 會讓讀屏
 * 使用者的標題大綱失去層次（憲章原則 V）。
 */
export function Placeholder({
  title,
  task,
  level = 1,
}: {
  title: string
  task: string
  level?: 1 | 2
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <section className="mx-auto max-w-2xl py-gap-8 text-center">
      <Heading className={`font-display text-ink ${level === 1 ? 'text-h1' : 'text-h2'}`}>
        {title}
      </Heading>
      <p className="mt-gap-3 text-ink-muted">此頁面尚未建立，將由 {task} 完成。</p>
    </section>
  )
}
