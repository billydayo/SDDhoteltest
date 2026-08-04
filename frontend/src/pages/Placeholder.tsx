/**
 * 尚未建立的頁面的暫時內容。
 *
 * ⚠️ **這是過渡物件，每一個都會被對應任務的真實頁面取代。**
 * 路由表（T040）必須先完整存在，守衛才有東西可守；但頁面本身分屬 US1–US12。
 * 與其讓路由表殘缺、之後再回頭補，不如先把骨架接通，讓每個頁面任務只需
 * 替換 `element`。
 *
 * 明白寫出「尚未建立」而不是留白：留白的畫面會被當成壞掉。
 */
export function Placeholder({ title, task }: { title: string; task: string }) {
  return (
    <section className="mx-auto max-w-2xl py-gap-8 text-center">
      <h1 className="font-display text-h1 text-ink">{title}</h1>
      <p className="mt-gap-3 text-ink-muted">此頁面尚未建立，將由 {task} 完成。</p>
    </section>
  )
}
